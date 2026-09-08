"""add_lecturer_workspaces

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-09-08 00:00:00.000000

Strom tříd a modelových situací lektora (ADR-031). Dřív žil jen v `localStorage`
prohlížeče, takže modelová situace vytvořená na jednom počítači na jiném neexistovala.

Tabulka je prázdná — strom se do ní dostane při prvním uložení z prohlížeče. Existující
data v `evaluation_criteria` a `student_evaluations` se nijak nemění; váží se na
`scenario_name`, které zůstává stejné.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'
    # JSONB na Postgresu, TEXT na SQLite — shodně s chováním `JSONType` (models/types.py).
    json_type = postgresql.JSONB() if is_postgres else sa.Text()

    op.create_table(
        'lecturer_workspaces',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('tree', json_type, nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    # Unikátní index = jeden strom na lektora. Zároveň slouží pro rychlé vyhledání.
    op.create_index(
        'ix_lecturer_workspaces_lecturer_id',
        'lecturer_workspaces', ['lecturer_id'], unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_lecturer_workspaces_lecturer_id', table_name='lecturer_workspaces')
    op.drop_table('lecturer_workspaces')
