import React, { useState } from 'react'
import { Button, Chip, Input, Select, SelectItem } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useDispatch } from 'react-redux'
import { deleteEdgeByHandle, updateEdgesOnHandleRename } from '../../../store/flowSlice'
import { convertToPythonVariableName } from '../../../utils/variableNameUtils'

export interface SchemaEditorProps {
    jsonValue: Record<string, any>
    onChange: (value: Record<string, any>) => void
    options: string[]
    nodeId: string
    availableFields?: string[]
    readOnly?: boolean
}

interface JSONSchema {
    $schema: string
    type: string
    properties: Record<string, any>
    required?: string[]
}

interface FieldProps {
    path: string[]
    value: any
    onUpdate: (path: string[], value: any) => void
    onDelete: (path: string[]) => void
    readOnly?: boolean
    availableFields: string[]
    level: number
}

const SchemaField: React.FC<FieldProps> = ({
    path,
    value,
    onUpdate,
    onDelete,
    readOnly,
    availableFields,
    level,
}) => {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState(path[path.length - 1])
    const [isDragOver, setIsDragOver] = useState(false)

    const handleDragStart = (e: React.DragEvent) => {
        e.stopPropagation()
        e.dataTransfer.setData(
            'text/plain',
            JSON.stringify({
                path,
                value,
                fieldName: path[path.length - 1],
            })
        )
    }

    const handleDragOver = (e: React.DragEvent) => {
        const type = getTypeFromValue(value)
        if (type === 'object') {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(true)
        }
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.stopPropagation()
        setIsDragOver(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)

        // Ensure drop is only allowed on fields that are objects.
        const targetType = getTypeFromValue(value)
        if (targetType !== 'object') {
            return
        }

        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'))
            if (data.path.join('.') !== path.join('.')) {
                onUpdate(path, {
                    type: 'move',
                    sourceField: data,
                })
            }
        } catch (err) {
            console.error('Failed to parse drag data:', err)
        }
    }

    const handleKeyEdit = (newKey: string) => {
        if (!newKey.trim() || newKey === path[path.length - 1]) {
            setIsEditing(false)
            return
        }

        const validKey = convertToPythonVariableName(newKey)
        onUpdate(path, { type: 'rename', newKey: validKey })
        setIsEditing(false)
    }

    const getTypeFromValue = (val: any): string => {
        if (typeof val === 'object' && val !== null) {
            if (val.type === 'array') return 'array'
            if (val.type) return val.type
            if (val.properties) return 'object'
            if (Object.keys(val).length === 0) return 'object'
            return 'object'
        }
        return val
    }

    const type = getTypeFromValue(value)
    const isObject = type === 'object'
    // Check whether this object already has fields.
    const isObjectWithFields =
        isObject && value && typeof value === 'object' &&
        ((value.properties && Object.keys(value.properties).length > 0) ||
         (!value.type && !value.properties && Object.keys(value).length > 0))

    const normalizeSchemaValue = (value: any, newType: string) => {
        // Helper to preserve schema metadata
        const preserveSchemaMetadata = (oldValue: any, newValue: any) => {
            const metadataFields = ['description', 'enum', 'nullable', 'minimum', 'maximum', 'properties', 'required'];
            const metadata = {};
            for (const field of metadataFields) {
                if (oldValue && oldValue[field] !== undefined) {
                    metadata[field] = oldValue[field];
                }
            }
            return { ...metadata, ...newValue };
        };

        if (newType === 'object') {
            if (typeof value === 'object' && value !== null) {
                return {
                    ...value,
                    type: 'object',
                    properties: value.properties ? value.properties : {},
                    required: value.required ? value.required : []
                };
            }
            return {
                type: 'object',
                properties: {},
                required: []
            };
        } else if (newType === 'array') {
            const baseArray = {
                type: 'array',
                items: value?.items || { type: 'string' }
            };
            return preserveSchemaMetadata(value, baseArray);
        }
        return preserveSchemaMetadata(value, { type: newType });
    }

    const handleTypeChange = (newType: string) => {
        // Prevent switching type if this object already has nested fields.
        if (isObjectWithFields && newType !== 'object') {
            return
        }

        const normalizedValue = normalizeSchemaValue(value, newType);
        onUpdate(path, {
            type: 'update',
            value: normalizedValue
        })
    }

    const handleTypeChangeWrapper = (e: React.ChangeEvent<HTMLSelectElement>) => {
        handleTypeChange(e.target.value)
    }

    const handleAddNestedField = () => {
        if (!value.properties) {
            value.properties = {}
        }
        onUpdate(path, {
            type: 'add',
            value: 'string'
        })
    }

    // Render nested fields if this is an object type with properties
    const renderNestedFields = () => {
        if (!value || typeof value !== 'object') return null

        // If it has a properties field (JSON Schema format)
        if (value.properties) {
            return Object.entries(value.properties).map(([key, val]) => {
                return (
                    <SchemaField
                        key={key}
                        path={[...path, key]}
                        value={val}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        readOnly={readOnly}
                        availableFields={availableFields}
                        level={level + 1}
                    />
                )
            })
        }

        // If it's a direct object without properties field
        if (!value.type && Object.keys(value).length > 0) {
            return Object.entries(value).map(([key, val]) => {
                return (
                    <SchemaField
                        key={key}
                        path={[...path, key]}
                        value={val}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        readOnly={readOnly}
                        availableFields={availableFields}
                        level={level + 1}
                    />
                )
            })
        }

        return null
    }

    return (
        <div
            className={`mb-2 ${level > 0 ? `ml-${level * 4}` : ''}`}
            draggable={!readOnly}
            onDragStart={handleDragStart}
        >
            <div
                className={`flex flex-col ${
                    isObject
                        ? 'border-2 border-dashed border-default-300 rounded-lg p-2'
                        : ''
                } ${isDragOver ? 'bg-default-200' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <div className="flex items-center gap-2">
                    {isEditing && !readOnly ? (
                        <Input
                            autoFocus
                            value={editValue}
                            size="sm"
                            variant="faded"
                            radius="lg"
                            onChange={(e) =>
                                setEditValue(convertToPythonVariableName(e.target.value))
                            }
                            onBlur={() => handleKeyEdit(editValue)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.currentTarget.blur()
                                } else if (e.key === 'Escape') {
                                    setIsEditing(false)
                                    setEditValue(path[path.length - 1])
                                }
                            }}
                            classNames={{
                                input: 'bg-default-100',
                                inputWrapper: 'shadow-none',
                            }}
                            className="w-40"
                        />
                    ) : (
                        <span
                            className={`mr-2 p-1 border rounded-full bg-default-100 ${
                                !readOnly
                                    ? 'hover:bg-default-200 cursor-pointer'
                                    : ''
                            }`}
                            onClick={() => !readOnly && setIsEditing(true)}
                        >
                            {path[path.length - 1]}
                        </span>
                    )}

                    <Select
                        onChange={handleTypeChangeWrapper}
                        isDisabled={readOnly || isObjectWithFields}
                        value={type}
                        defaultSelectedKeys={[type]}
                        className="w-32"
                        isMultiline={true}
                        renderValue={(items) => (
                            <div className="flex flex-wrap gap-1">
                                {items.map((item) => (
                                    <Chip key={item.key} size="sm">
                                        {item.textValue}
                                    </Chip>
                                ))}
                            </div>
                        )}
                    >
                        {availableFields.map((field) => (
                            <SelectItem key={field} value={field}>
                                {field}
                            </SelectItem>
                        ))}
                    </Select>

                    {!readOnly && (
                        <Button
                            isIconOnly
                            radius="full"
                            variant="light"
                            onClick={() => onDelete(path)}
                            color="primary"
                        >
                            <Icon icon="solar:trash-bin-trash-linear" width={22} />
                        </Button>
                    )}
                </div>

                {isObject && (
                    <div className="ml-4 mt-2">
                        {renderNestedFields()}
                        {!readOnly && (
                            <Button
                                size="sm"
                                variant="light"
                                color="primary"
                                onClick={handleAddNestedField}
                                className="mt-2"
                            >
                                <Icon
                                    icon="solar:add-circle-linear"
                                    className="mr-1"
                                    width={18}
                                />
                                Add Field
                            </Button>
                        )}
                    </div>
                )}

                {type === 'array' && (
                    <div className="ml-4 mt-2">
                        {value.items ? (
                            <SchemaField
                                key={`${path.join('.')}-items`}
                                path={[...path, 'items']}
                                value={value.items}
                                onUpdate={onUpdate}
                                onDelete={() => {}}
                                readOnly={readOnly}
                                availableFields={availableFields}
                                level={level + 1}
                            />
                        ) : (
                            !readOnly && (
                                <Button
                                    size="sm"
                                    variant="light"
                                    color="primary"
                                    onClick={() => onUpdate(path, { type: 'update', value: { ...value, items: { type: availableFields[0] } } })}
                                >
                                    <Icon
                                        icon="solar:add-circle-linear"
                                        className="mr-1"
                                        width={18}
                                    />
                                    Add Items Schema
                                </Button>
                            )
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

const SchemaEditor: React.FC<SchemaEditorProps> = ({
    jsonValue,
    onChange,
    options,
    nodeId,
    availableFields = ['string', 'boolean', 'integer', 'number', 'array', 'object', 'null'],
    readOnly = false,
}) => {
    const [newKey, setNewKey] = useState<string>('')
    const [newType, setNewType] = useState<string>(availableFields[0])
    const dispatch = useDispatch()

    // Update the schema normalization to handle nested structures
    const normalizeSchema = (value: any): any => {
        if (typeof value === 'string') {
            return { type: value }
        }
        if (typeof value === 'object' && value !== null) {
            // If it's already a valid schema object with type and properties
            if (value.type === 'object') {
                return {
                    ...value,  // Preserve all original fields
                    type: 'object',
                    properties: Object.entries(value.properties || {}).reduce((acc, [k, v]) => {
                        acc[k] = normalizeSchema(v)
                        return acc
                    }, {}),
                    required: value.required || []
                }
            }
            // If it has an explicit type but no properties
            if (value.type) {
                return value
            }
            // If it has properties but no type
            if (value.properties) {
                return {
                    type: 'object',
                    properties: Object.entries(value.properties).reduce((acc, [k, v]) => {
                        acc[k] = normalizeSchema(v)
                        return acc
                    }, {}),
                    required: value.required || []
                }
            }
            // If it's a plain object
            return {
                type: 'object',
                properties: Object.entries(value).reduce((acc, [k, v]) => {
                    acc[k] = normalizeSchema(v)
                    return acc
                }, {}),
                required: []
            }
        }
        return { type: 'string' } // fallback
    }

    const schemaForEditing: JSONSchema = {
        $schema: jsonValue?.$schema || 'http://json-schema.org/draft-07/schema#',
        type: jsonValue?.type || 'object',
        properties: jsonValue && jsonValue.properties
            ? Object.entries(jsonValue.properties).reduce((acc, [key, value]) => {
                acc[key] = normalizeSchema(value);
                return acc;
            }, {} as Record<string, any>)
            : Object.entries(jsonValue || {}).reduce((acc, [key, value]) => {
                acc[key] = normalizeSchema(value);
                return acc;
            }, {} as Record<string, any>),
        required: jsonValue?.properties ? Object.keys(jsonValue.properties) : []
    }


    const getPlaceholderExample = (): string => {
        return 'eg. summary'
    }

    const handleAddKey = (): void => {
        const validatedKey = convertToPythonVariableName(newKey);
        if (schemaForEditing.properties.hasOwnProperty(validatedKey)) return;
        const newField =
            newType === 'object'
                ? { type: 'object', properties: {}, required: [] }
                : { type: newType };
        const updatedProperties = {
            ...schemaForEditing.properties,
            [validatedKey]: newField
        };
        const updatedSchema = {
            ...schemaForEditing,
            properties: updatedProperties,
            required: Object.keys(updatedProperties)
        };
        onChange(updatedSchema);
        setNewKey('');
        setNewType(availableFields[0]);
    }

    const handleFieldUpdate = (path: string[], action: { type: string; value?: any; newKey?: string; sourceField?: any }): void => {
        let updatedSchema = { ...schemaForEditing };

        // Helper function to traverse the schema based on a path
        const getContainerAndKey = (schema: any, path: string[]) => {
            let node = schema;
            for (let i = 0; i < path.length - 1; i++) {
                const segment = path[i];
                if (node.type === 'object') {
                    if (!node.properties) {
                        node.properties = {};
                    }
                    if (!node.properties[segment]) {
                        node.properties[segment] = { type: 'object', properties: {}, required: [] };
                    }
                    node = node.properties[segment];
                } else if (node.type === 'array') {
                    // For arrays, we expect the next segment to be 'items'
                    if (segment === 'items') {
                        if (!node.items) {
                            node.items = { type: 'object', properties: {}, required: [] };
                        }
                        node = node.items;
                    } else {
                        console.error(`Unexpected segment '${segment}' in array type`);
                        return null;
                    }
                } else {
                    console.error(`Unknown node type encountered during traversal at segment '${segment}'`);
                    return null;
                }
            }
            return { container: node, key: path[path.length - 1] };
        };

        const traversal = getContainerAndKey(updatedSchema, path);
        if (!traversal) {
            console.error('Failed to traverse schema with path', path);
            return;
        }
        const { container, key } = traversal;
        if (!container.properties) {
            container.properties = {};
        }

        if (action.type === 'move') {
            const sourceField = action.sourceField;
            const sourcePath: string[] = sourceField.path;
            const sourceFieldName = sourceField.fieldName;

            const sourceTraversal = getContainerAndKey(updatedSchema, sourcePath);
            if (!sourceTraversal) {
                console.error('Failed to traverse source path', sourcePath);
                return;
            }
            const { container: sourceContainer } = sourceTraversal;
            if (sourceContainer.properties && sourceContainer.properties[sourceFieldName]) {
                delete sourceContainer.properties[sourceFieldName];
            }

            if (!container.properties[key]) {
                container.properties[key] = { type: 'object', properties: {}, required: [] };
            }
            if (!container.properties[key].properties) {
                container.properties[key].properties = {};
            }
            container.properties[key].properties = {
                ...container.properties[key].properties,
                [sourceFieldName]: sourceField.value
            };
            container.properties[key].required = Object.keys(container.properties[key].properties);

            updatedSchema.required = Object.keys(updatedSchema.properties);

            dispatch(
                updateEdgesOnHandleRename({
                    nodeId,
                    oldHandleId: sourceFieldName,
                    newHandleId: [...path, sourceFieldName].join('.'),
                    schemaType: 'output_schema'
                })
            );
        } else if (action.type === 'rename') {
            if (container.properties[key]) {
                const oldKey = key;
                const newKey = action.newKey!;
                if (oldKey !== newKey) {
                    const value = container.properties[oldKey];
                    delete container.properties[oldKey];
                    container.properties[newKey] = value;

                    dispatch(
                        updateEdgesOnHandleRename({
                            nodeId,
                            oldHandleId: oldKey,
                            newHandleId: newKey,
                            schemaType: 'output_schema'
                        })
                    );
                }
            }
        } else if (action.type === 'add') {
            // Check if the field is nested; if so, target the nested object's properties.
            let targetObj;
            if (container.properties && container.properties[key] && container.properties[key].type === 'object') {
                if (!container.properties[key].properties) {
                    container.properties[key].properties = {};
                }
                targetObj = container.properties[key].properties;
            } else {
                targetObj = container.properties;
            }

            let newFieldName = 'new_field';
            let counter = 1;
            while (newFieldName in targetObj) {
                newFieldName = `new_field_${counter}`;
                counter++;
            }
            const newFieldValue =
                action.value === 'object'
                    ? { type: 'object', properties: {}, required: [] }
                    : { type: action.value || 'string' };
            targetObj[newFieldName] = newFieldValue;

            // Update the required array for the correct container
            if (container.properties && container.properties[key] && container.properties[key].type === 'object') {
                container.properties[key].required = Object.keys(targetObj);
            } else {
                container.required = Object.keys(targetObj);
            }
            onChange(updatedSchema);
            return;
        } else if (action.type === 'update') {
            if (container.properties && container.properties[key]) {
                if (typeof action.value === 'object' && action.value !== null && typeof action.value.type === 'string') {
                    container.properties[key] = action.value;
                } else {
                    container.properties[key] = { type: action.value };
                }
            }
        }
        onChange(updatedSchema);
    };

    const handleFieldDelete = (path: string[]): void => {
        let updatedSchema = { ...schemaForEditing };
        let parent = updatedSchema.properties;
        const lastIndex = path.length - 1;
        for (let i = 0; i < lastIndex; i++) {
            parent = parent[path[i]].properties;
        }
        const key = path[lastIndex];
        delete parent[key];

        if (path.length === 1) {
            // top-level deletion: update required on the schema
            updatedSchema.required = Object.keys(updatedSchema.properties);
        } else {
            // nested deletion: update required on the parent object
            let parentOfDeleted = updatedSchema.properties;
            for (let i = 0; i < path.length - 1; i++) {
                parentOfDeleted = parentOfDeleted[path[i]];
            }
            if (parentOfDeleted.properties) {
                parentOfDeleted.required = Object.keys(parentOfDeleted.properties);
            }
        }

        onChange(updatedSchema);
        dispatch(deleteEdgeByHandle({ nodeId, handleKey: key }));
    }

    const handleDropOnRoot = (e: React.DragEvent<HTMLDivElement>): void => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            let updatedSchema = JSON.parse(JSON.stringify(schemaForEditing));

            // If the dragged field is nested (path length > 1), remove it from its parent's properties
            if (data.path.length > 1) {
                let parentObj = updatedSchema.properties;
                for (let i = 0; i < data.path.length - 1; i++) {
                    parentObj = parentObj[data.path[i]];
                }
                if (parentObj && parentObj.properties) {
                    delete parentObj.properties[data.fieldName];
                    parentObj.required = Object.keys(parentObj.properties);
                }
            }

            // Add the field to the root level
            updatedSchema.properties[data.fieldName] = data.value;
            updatedSchema.required = Object.keys(updatedSchema.properties);

            onChange(updatedSchema);
            dispatch(
                updateEdgesOnHandleRename({
                    nodeId,
                    oldHandleId: data.fieldName,
                    newHandleId: data.fieldName,
                    schemaType: 'output_schema',
                })
            );
        } catch (err) {
            console.error('Failed to handle drop on root:', err);
        }
    };

    return (
        <div
            className={`schema-editor ${readOnly ? 'opacity-75 cursor-not-allowed' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropOnRoot}
        >
            {!readOnly && (
                <div className="mb-4 flex items-center space-x-4">
                    <Input
                        type="text"
                        value={newKey}
                        onChange={(e) => setNewKey(convertToPythonVariableName(e.target.value))}
                        onBlur={(e) => setNewKey(convertToPythonVariableName(e.target.value))}
                        placeholder={getPlaceholderExample()}
                        label="Name"
                        disabled={readOnly}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !readOnly && newKey) {
                                e.currentTarget.blur()
                                handleAddKey()
                            }
                        }}
                        className="p-2 flex-grow w-2/3"
                    />
                    <Select
                        onChange={(e) => setNewType(e.target.value)}
                        disabled={readOnly}
                        label="Type"
                        defaultSelectedKeys={[availableFields[0]]}
                        className="w-32"
                        isMultiline={true}
                        renderValue={(items) => (
                            <div className="flex flex-wrap gap-1">
                                {items.map((item) => (
                                    <Chip key={item.key} size="sm">
                                        {item.textValue}
                                    </Chip>
                                ))}
                            </div>
                        )}
                    >
                        {availableFields.map((field) => (
                            <SelectItem key={field} value={field}>
                                {field}
                            </SelectItem>
                        ))}
                    </Select>
                    <Button
                        isIconOnly
                        radius="full"
                        variant="light"
                        onClick={handleAddKey}
                        color="primary"
                        disabled={readOnly || !newKey}
                    >
                        <Icon icon="solar:add-circle-linear" width={22} />
                    </Button>
                </div>
            )}
            {schemaForEditing &&
                typeof schemaForEditing.properties === 'object' &&
                Object.entries(schemaForEditing.properties).map(([key, value]) => (
                    <SchemaField
                        key={key}
                        path={[key]}
                        value={value}
                        onUpdate={handleFieldUpdate}
                        onDelete={handleFieldDelete}
                        readOnly={readOnly}
                        availableFields={availableFields}
                        level={0}
                    />
                ))}
        </div>
    )
}

export default SchemaEditor
