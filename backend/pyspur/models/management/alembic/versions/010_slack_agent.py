"""slack_agent

Revision ID: 010
Revises: 009
Create Date: 2025-03-16 15:09:40.938378

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '010'
down_revision: Union[str, None] = '009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('slack_agents',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=True),
    sa.Column('slack_team_id', sa.String(), nullable=True),
    sa.Column('slack_team_name', sa.String(), nullable=True),
    sa.Column('slack_channel_id', sa.String(), nullable=True),
    sa.Column('slack_channel_name', sa.String(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('workflow_id', sa.String(), nullable=True),
    sa.Column('trigger_on_mention', sa.Boolean(), nullable=True),
    sa.Column('trigger_on_direct_message', sa.Boolean(), nullable=True),
    sa.Column('trigger_on_channel_message', sa.Boolean(), nullable=True),
    sa.Column('trigger_keywords', sa.JSON(), nullable=True),
    sa.Column('trigger_enabled', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['workflow_id'], ['workflows.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_slack_agents_id'), 'slack_agents', ['id'], unique=False)
    op.create_index(op.f('ix_slack_agents_name'), 'slack_agents', ['name'], unique=False)
    op.create_index(op.f('ix_slack_agents_slack_team_id'), 'slack_agents', ['slack_team_id'], unique=False)
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index(op.f('ix_slack_agents_slack_team_id'), table_name='slack_agents')
    op.drop_index(op.f('ix_slack_agents_name'), table_name='slack_agents')
    op.drop_index(op.f('ix_slack_agents_id'), table_name='slack_agents')
    op.drop_table('slack_agents')
    # ### end Alembic commands ###
