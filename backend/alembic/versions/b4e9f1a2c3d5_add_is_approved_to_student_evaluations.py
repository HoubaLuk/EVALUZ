"""add_is_approved_to_student_evaluations

Revision ID: b4e9f1a2c3d5
Revises: 53fae6cde19e
Create Date: 2026-03-30 00:00:00.000000

Man-in-the-Loop: přidá sloupec is_approved (BOOLEAN DEFAULT FALSE) do tabulky
student_evaluations. Existující záznamy získají hodnotu FALSE — vyžadují explicitní
schválení lektorem před zahrnutím do analytiky.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4e9f1a2c3d5'
down_revision: Union[str, Sequence[str], None] = '53fae6cde19e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('student_evaluations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_approved', sa.Boolean(), nullable=True, server_default='0'))

    # Existující záznamy: is_approved = FALSE
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE student_evaluations SET is_approved = FALSE WHERE is_approved IS NULL"))


def downgrade() -> None:
    with op.batch_alter_table('student_evaluations', schema=None) as batch_op:
        batch_op.drop_column('is_approved')
