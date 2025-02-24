import asyncio
import traceback
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple, TYPE_CHECKING, Union

from pydantic import ValidationError

from ..nodes.base import BaseNode, BaseNodeOutput
from ..nodes.factory import NodeFactory
from ..nodes.logic.human_intervention import HumanInterventionNode, HumanInterventionNodeOutput, PauseException
from ..schemas.workflow_schemas import (
    WorkflowDefinitionSchema,
    WorkflowNodeSchema,
)
from .task_recorder import TaskRecorder, TaskStatus
from ..models.task_model import TaskStatus
from ..models.workflow_model import WorkflowModel
from .workflow_execution_context import WorkflowExecutionContext
from ..models.run_model import RunModel, RunStatus

if TYPE_CHECKING:
    from .task_recorder import TaskRecorder
    from sqlalchemy.orm import Session


class UpstreamFailure(Exception):
    pass


class UnconnectedNode(Exception):
    pass


class WorkflowExecutor:
    """
    Handles the execution of a workflow.
    """

    def __init__(
        self,
        workflow: Union[WorkflowModel, WorkflowDefinitionSchema],
        initial_inputs: Optional[Dict[str, Dict[str, Any]]] = None,
        task_recorder: Optional["TaskRecorder"] = None,
        context: Optional[WorkflowExecutionContext] = None,
    ):
        # Convert WorkflowModel to WorkflowDefinitionSchema if needed
        if isinstance(workflow, WorkflowModel):
            self.workflow = WorkflowDefinitionSchema.model_validate(workflow.definition)
        else:
            self.workflow = workflow
        self._initial_inputs = initial_inputs or {}
        self.task_recorder = task_recorder
        self.context = context
        self._node_dict: Dict[str, WorkflowNodeSchema] = {}
        self._dependencies: Dict[str, Set[str]] = {}
        self._outputs: Dict[str, Optional[BaseNodeOutput]] = {}
        self._failed_nodes: Set[str] = set()
        self.node_instances: Dict[str, BaseNode] = {}

        # Build node dictionary and dependencies
        for node in self.workflow.nodes:
            self._node_dict[node.id] = node
            self._dependencies[node.id] = set()

        for link in self.workflow.links:
            if link.target_id in self._dependencies:
                self._dependencies[link.target_id].add(link.source_id)

        self._node_tasks: Dict[str, asyncio.Task[Optional[BaseNodeOutput]]] = {}
        self._build_node_dict()
        self._build_dependencies()

    @property
    def outputs(self) -> Dict[str, Optional[BaseNodeOutput]]:
        """Get the current outputs of the workflow execution."""
        return self._outputs

    @outputs.setter
    def outputs(self, value: Dict[str, Optional[BaseNodeOutput]]):
        """Set the outputs of the workflow execution."""
        self._outputs = value

    def _process_subworkflows(self, workflow: WorkflowDefinitionSchema) -> WorkflowDefinitionSchema:
        # Group nodes by parent_id
        nodes_by_parent: Dict[Optional[str], List[WorkflowNodeSchema]] = {}
        for node in workflow.nodes:
            parent_id = node.parent_id
            if parent_id not in nodes_by_parent:
                nodes_by_parent[parent_id] = []
            node_copy = node.model_copy(update={"parent_id": None})
            nodes_by_parent[parent_id].append(node_copy)

        # Get root level nodes (no parent)
        root_nodes = nodes_by_parent.get(None, [])

        # Process each parent node's children into subworkflows
        for parent_id, child_nodes in nodes_by_parent.items():
            if parent_id is None:
                continue

            # Find the parent node in root nodes
            parent_node = next((node for node in root_nodes if node.id == parent_id), None)
            if not parent_node:
                continue

            # Get links between child nodes
            child_node_ids = {node.id for node in child_nodes}
            subworkflow_links = [
                link
                for link in workflow.links
                if link.source_id in child_node_ids and link.target_id in child_node_ids
            ]

            # Create subworkflow
            subworkflow = WorkflowDefinitionSchema(nodes=child_nodes, links=subworkflow_links)

            # Update parent node's config with subworkflow
            parent_node.config = {
                **parent_node.config,
                "subworkflow": subworkflow.model_dump(),
            }

        # Return new workflow with only root nodes
        return WorkflowDefinitionSchema(
            nodes=root_nodes,
            links=[
                link
                for link in workflow.links
                if not any(
                    node.parent_id
                    for node in workflow.nodes
                    if node.id in (link.source_id, link.target_id)
                )
            ],
        )

    def _build_node_dict(self):
        self._node_dict = {node.id: node for node in self.workflow.nodes}

    def _build_dependencies(self):
        dependencies: Dict[str, Set[str]] = {node.id: set() for node in self.workflow.nodes}
        for link in self.workflow.links:
            dependencies[link.target_id].add(link.source_id)
        self._dependencies = dependencies

    def _get_source_handles(self) -> Dict[Tuple[str, str], str]:
        """Build a mapping of (source_id, target_id) -> source_handle for router nodes only"""
        source_handles: Dict[Tuple[str, str], str] = {}
        for link in self.workflow.links:
            source_node = self._node_dict[link.source_id]
            if source_node.node_type == "RouterNode":
                if not link.source_handle:
                    raise ValueError(
                        f"Missing source_handle in link from router node {link.source_id} to {link.target_id}"
                    )
                source_handles[(link.source_id, link.target_id)] = link.source_handle
        return source_handles

    def _get_async_task_for_node_execution(
        self, node_id: str
    ) -> asyncio.Task[Optional[BaseNodeOutput]]:
        if node_id in self._node_tasks:
            return self._node_tasks[node_id]
        # Start task for the node
        task = asyncio.create_task(self._execute_node(node_id))
        self._node_tasks[node_id] = task

        # Record task
        if self.task_recorder:
            self.task_recorder.create_task(node_id, {})
        return task

    async def _execute_node(self, node_id: str) -> Optional[BaseNodeOutput]:
        node = self._node_dict[node_id]
        node_input = {}
        try:
            if node_id in self._outputs:
                return self._outputs[node_id]

            # Check if any predecessor nodes failed
            dependency_ids = self._dependencies.get(node_id, set())

            # Wait for dependencies
            predecessor_outputs: List[Optional[BaseNodeOutput]] = []
            if dependency_ids:
                try:
                    predecessor_outputs = await asyncio.gather(
                        *(
                            self._get_async_task_for_node_execution(dep_id)
                            for dep_id in dependency_ids
                        ),
                    )
                except Exception:
                    raise UpstreamFailure(f"Node {node_id} skipped due to upstream failure")

            # Check if this node is blocked by any paused nodes
            for dep_id in dependency_ids:
                output = self._outputs.get(dep_id)
                if output is not None and isinstance(output, HumanInterventionNodeOutput):
                    if not output.resume_time and node_id in output.blocked_nodes:
                        if self.task_recorder:
                            self.task_recorder.update_task(
                                node_id=node_id,
                                status=TaskStatus.PENDING,
                                end_time=datetime.now(),
                                is_downstream_of_pause=True
                            )
                        return None

            if any(dep_id in self._failed_nodes for dep_id in dependency_ids):
                print(f"Node {node_id} skipped due to upstream failure")
                self._failed_nodes.add(node_id)
                raise UpstreamFailure(f"Node {node_id} skipped due to upstream failure")

            if node.node_type != "CoalesceNode" and any(
                [output is None for output in predecessor_outputs]
            ):
                self._outputs[node_id] = None
                if self.task_recorder:
                    self.task_recorder.update_task(
                        node_id=node_id,
                        status=TaskStatus.CANCELED,
                        end_time=datetime.now(),
                    )
                return None

            # Get source handles mapping
            source_handles = self._get_source_handles()

            # Build node input, handling router outputs specially
            for dep_id, output in zip(dependency_ids, predecessor_outputs):
                predecessor_node = self._node_dict[dep_id]
                if predecessor_node.node_type == "RouterNode":
                    # For router nodes, we must have a source handle
                    source_handle = source_handles.get((dep_id, node_id))
                    if not source_handle:
                        raise ValueError(
                            f"Missing source_handle in link from router node {dep_id} to {node_id}"
                        )
                    # Get the specific route's output from the router
                    route_output = getattr(output, source_handle, None)
                    if route_output is not None:
                        node_input[dep_id] = route_output
                    else:
                        self._outputs[node_id] = None
                        if self.task_recorder:
                            self.task_recorder.update_task(
                                node_id=node_id,
                                status=TaskStatus.CANCELED,
                                end_time=datetime.now(),
                            )
                        return None
                else:
                    node_input[dep_id] = output

            # Special handling for InputNode - use initial inputs
            if node.node_type == "InputNode":
                node_input = self._initial_inputs.get(node_id, {})

            # Remove None values from input
            node_input = {k: v for k, v in node_input.items() if v is not None}

            # update task recorder with inputs
            if self.task_recorder:
                self.task_recorder.update_task(
                    node_id=node_id,
                    status=TaskStatus.RUNNING,
                    inputs={
                        dep_id: output.model_dump()
                        for dep_id, output in node_input.items()
                        if node.node_type != "InputNode"
                    },
                )

            # If node_input is empty, return None
            if not node_input:
                self._outputs[node_id] = None
                raise UnconnectedNode(f"Node {node_id} has no input")

            node_instance = NodeFactory.create_node(
                node_name=node.title,
                node_type_name=node.node_type,
                config=node.config,
            )
            self.node_instances[node_id] = node_instance

            # Set workflow definition in node context if available
            if hasattr(node_instance, 'context'):
                node_instance.context = WorkflowExecutionContext(
                    workflow_id=self.context.workflow_id if self.context else "",
                    run_id=self.context.run_id if self.context else "",
                    parent_run_id=self.context.parent_run_id if self.context else None,
                    run_type=self.context.run_type if self.context else "interactive",
                    db_session=self.context.db_session if self.context else None,
                    workflow_definition=self.workflow.model_dump()
                )

            # Update task recorder
            if self.task_recorder:
                self.task_recorder.update_task(
                    node_id=node_id,
                    status=TaskStatus.RUNNING,
                    subworkflow=node_instance.subworkflow,
                )

            # Execute node
            try:
                output = await node_instance(node_input)

                # Update task recorder
                if self.task_recorder:
                    current_time = datetime.now()
                    self.task_recorder.update_task(
                        node_id=node_id,
                        status=TaskStatus.COMPLETED,
                        outputs=self._serialize_output(output),
                        end_time=current_time,
                        subworkflow=node_instance.subworkflow,
                        subworkflow_output=node_instance.subworkflow_output,
                    )

                # Store output
                self._outputs[node_id] = output
                return output
            except PauseException as e:
                # Store the output and update status
                self._outputs[node_id] = e.output
                if self.task_recorder:
                    current_time = datetime.now()
                    self.task_recorder.update_task(
                        node_id=node_id,
                        status=TaskStatus.PAUSED,
                        end_time=current_time,
                        outputs=self._serialize_output(e.output) if e.output else None,
                    )

                # Update run status if we have a context
                if self.context and self.context.db_session:
                    run = self.context.db_session.query(RunModel).filter(
                        RunModel.id == self.context.run_id
                    ).first()
                    if run:
                        run.status = RunStatus.PAUSED
                        self.context.db_session.commit()

                # Return the output but don't raise the exception
                # This allows other branches to continue running
                return e.output

        except UpstreamFailure as e:
            self._failed_nodes.add(node_id)
            self._outputs[node_id] = None
            if self.task_recorder:
                current_time = datetime.now()
                self.task_recorder.update_task(
                    node_id=node_id,
                    status=TaskStatus.CANCELED,
                    end_time=current_time,
                    error="Upstream failure",
                )
            raise e
        except Exception as e:
            error_msg = (
                f"Node execution failed:\n"
                f"Node ID: {node_id}\n"
                f"Node Type: {node.node_type}\n"
                f"Node Title: {node.title}\n"
                f"Inputs: {node_input}\n"
                f"Error: {traceback.format_exc()}"
            )
            print(error_msg)
            self._failed_nodes.add(node_id)
            if self.task_recorder:
                current_time = datetime.now()
                self.task_recorder.update_task(
                    node_id=node_id,
                    status=TaskStatus.FAILED,
                    end_time=current_time,
                    error=traceback.format_exc(limit=5),
                )
            raise e

    def _serialize_output(self, output: Optional[BaseNodeOutput]) -> Optional[Dict[str, Any]]:
        """Helper method to serialize node outputs, handling datetime objects."""
        if output is None:
            return None

        data = output.model_dump()

        def _serialize_value(val: Any) -> Any:
            """Recursively serialize values, handling datetime objects and sets."""
            if isinstance(val, datetime):
                return val.isoformat()
            elif isinstance(val, set):
                return list(val)  # Convert sets to lists
            elif isinstance(val, dict):
                return {str(key): _serialize_value(value) for key, value in val.items()}
            elif isinstance(val, list):
                return [_serialize_value(item) for item in val]
            return val

        return {str(key): _serialize_value(value) for key, value in data.items()}

    async def run(
        self,
        input: Dict[str, Any] = {},
        node_ids: List[str] = [],
        precomputed_outputs: Dict[str, Dict[str, Any] | List[Dict[str, Any]]] = {},
    ) -> Dict[str, BaseNodeOutput]:
        # Handle precomputed outputs first
        if precomputed_outputs:
            for node_id, output in precomputed_outputs.items():
                try:
                    if isinstance(output, dict):
                        self._outputs[node_id] = NodeFactory.create_node(
                            node_name=self._node_dict[node_id].title,
                            node_type_name=self._node_dict[node_id].node_type,
                            config=self._node_dict[node_id].config,
                        ).output_model.model_validate(output)
                    else:
                        # If output is a list of dicts, do not validate the output
                        # these are outputs of loop nodes, their precomputed outputs are not supported yet
                        continue

                except ValidationError as e:
                    print(
                        f"[WARNING]: Precomputed output validation failed for node {node_id}: {e}\n skipping precomputed output"
                    )
                except AttributeError as e:
                    print(
                        f"[WARNING]: Node {node_id} does not have an output_model defined: {e}\n skipping precomputed output"
                    )
                except KeyError as e:
                    print(
                        f"[WARNING]: Node {node_id} not found in the predecessor workflow: {e}\n skipping precomputed output"
                    )

        # Store input in initial inputs to be used by InputNode
        input_node = next(
            (
                node
                for node in self.workflow.nodes
                if node.node_type == "InputNode" and not node.parent_id
            ),
        )
        self._initial_inputs[input_node.id] = input
        # also update outputs for input node
        input_node_obj = NodeFactory.create_node(
            node_name=input_node.title,
            node_type_name=input_node.node_type,
            config=input_node.config,
        )
        self._outputs[input_node.id] = await input_node_obj(input)

        nodes_to_run = set(self._node_dict.keys())
        if node_ids:
            nodes_to_run = set(node_ids)

        # skip nodes that have parent nodes, as they will be executed as part of their parent node
        for node in self.workflow.nodes:
            if node.parent_id:
                nodes_to_run.discard(node.id)

        # drop outputs for nodes that need to be run
        for node_id in nodes_to_run:
            self._outputs.pop(node_id, None)

        # Start tasks for all nodes
        for node_id in nodes_to_run:
            self._get_async_task_for_node_execution(node_id)

        # Wait for all tasks to complete, but don't propagate exceptions
        results = await asyncio.gather(*self._node_tasks.values(), return_exceptions=True)

        # Process results to handle any exceptions
        paused_node_id = None
        for node_id, result in zip(self._node_tasks.keys(), results):
            if isinstance(result, PauseException):
                # Handle pause state - don't mark as failed
                paused_node_id = result.node_id
                print(f"Node {node_id} paused: {str(result)}")
                # Don't add to failed nodes since this is a pause state
                continue
            elif isinstance(result, Exception):
                print(f"Node {node_id} failed with error: {str(result)}")
                if paused_node_id and self.task_recorder:
                    # Check if this node is downstream of the paused node
                    is_downstream = False
                    current_node = node_id
                    while current_node in self._dependencies:
                        if paused_node_id in self._dependencies[current_node]:
                            is_downstream = True
                            break
                        # Check next level of dependencies
                        deps = self._dependencies[current_node]
                        if not deps:
                            break
                        current_node = next(iter(deps))

                    if is_downstream:
                        # Update task status without marking as failed
                        self.task_recorder.update_task(
                            node_id=node_id,
                            status=TaskStatus.PENDING,
                            end_time=datetime.now(),
                            is_downstream_of_pause=True
                        )
                        continue

                self._failed_nodes.add(node_id)
                self._outputs[node_id] = None

        # If we have a paused node, re-raise the pause exception
        if paused_node_id:
            for result in results:
                if isinstance(result, PauseException) and result.node_id == paused_node_id:
                    raise result

        # return the non-None outputs
        return {node_id: output for node_id, output in self._outputs.items() if output is not None}

    async def __call__(
        self,
        input: Dict[str, Any] = {},
        node_ids: List[str] = [],
        precomputed_outputs: Dict[str, Dict[str, Any] | List[Dict[str, Any]]] = {},
    ) -> Dict[str, BaseNodeOutput]:
        """
        Execute the workflow with the given input data.
        input: input for the input node of the workflow. Dict[<field_name>: <value>]
        node_ids: list of node_ids to run. If empty, run all nodes.
        precomputed_outputs: precomputed outputs for the nodes. These nodes will not be executed again.
        """
        return await self.run(input, node_ids, precomputed_outputs)

    async def run_batch(
        self, input_iterator: Iterator[Dict[str, Any]], batch_size: int = 100
    ) -> List[Dict[str, BaseNodeOutput]]:
        """
        Run the workflow on a batch of inputs.
        """
        results: List[Dict[str, BaseNodeOutput]] = []
        batch_tasks: List[asyncio.Task[Dict[str, BaseNodeOutput]]] = []
        for input in input_iterator:
            batch_tasks.append(asyncio.create_task(self.run(input)))
            if len(batch_tasks) == batch_size:
                results.extend(await asyncio.gather(*batch_tasks))
                batch_tasks = []
        if batch_tasks:
            results.extend(await asyncio.gather(*batch_tasks))
        return results


if __name__ == "__main__":
    workflow = WorkflowDefinitionSchema.model_validate(
        {
            "nodes": [
                {
                    "id": "input_node",
                    "title": "",
                    "node_type": "InputNode",
                    "config": {"output_schema": {"question": "string"}},
                    "coordinates": {"x": 281.25, "y": 128.75},
                },
                {
                    "id": "bon_node",
                    "title": "",
                    "node_type": "BestOfNNode",
                    "config": {
                        "samples": 1,
                        "output_schema": {
                            "response": "string",
                            "next_potential_question": "string",
                        },
                        "llm_info": {
                            "model": "gpt-4o",
                            "max_tokens": 16384,
                            "temperature": 0.7,
                            "top_p": 0.9,
                        },
                        "system_message": "You are a helpful assistant.",
                        "user_message": "",
                    },
                    "coordinates": {"x": 722.5, "y": 228.75},
                },
                {
                    "id": "output_node",
                    "title": "",
                    "node_type": "OutputNode",
                    "config": {
                        "title": "OutputNodeConfig",
                        "type": "object",
                        "output_schema": {
                            "question": "string",
                            "response": "string",
                        },
                        "output_map": {
                            "question": "bon_node.next_potential_question",
                            "response": "bon_node.response",
                        },
                    },
                    "coordinates": {"x": 1187.5, "y": 203.75},
                },
            ],
            "links": [
                {
                    "source_id": "input_node",
                    "target_id": "bon_node",
                },
                {
                    "source_id": "bon_node",
                    "target_id": "output_node",
                },
            ],
            "test_inputs": [
                {
                    "id": 1733466671014,
                    "question": "<p>Is altruism inherently selfish?</p>",
                }
            ],
        }
    )
    executor = WorkflowExecutor(workflow)
    input = {"question": "Is altruism inherently selfish?"}
    outputs = asyncio.run(executor(input))
    print(outputs)
