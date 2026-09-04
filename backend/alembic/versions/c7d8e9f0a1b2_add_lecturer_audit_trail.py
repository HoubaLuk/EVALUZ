"""add_lecturer_audit_trail

Revision ID: c7d8e9f0a1b2
Revises: f1e2d3c4b5a6
Create Date: 2026-09-04 00:00:00.000000

Auditní stopa lektorského zásahu (ADR-025). Přidává do `student_evaluations`:

- `ai_original_json` — původní hodnocení od AI, uloží se při PRVNÍ ruční úpravě.
  Bez něj po zásahu lektora nezůstala stopa po tom, co model původně rozhodl, a nešlo
  zpětně zjistit, jak často se AI s lektory rozchází.
- `modified_at`, `modified_by` — kdo a kdy do hodnocení zasáhl.

Existující záznamy zůstávají s NULL ve všech třech sloupcích: znamená to „hodnocení
nebylo ručně upravováno", což je pro data z doby před touto migrací pravdivé tvrzení.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'f1e2d3c4b5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'
    # JSONB na Postgresu (shodně s `json_result`), TEXT na SQLite — odpovídá chování
    # `JSONType` v models/types.py.
    json_type = postgresql.JSONB() if is_postgres else sa.Text()

    with op.batch_alter_table('student_evaluations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ai_original_json', json_type, nullable=True))
        batch_op.add_column(sa.Column('modified_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('modified_by', sa.Integer(), nullable=True))

    # FK na lektora jen tam, kde ho lze pojmenovat; SQLite ho v batch režimu neřeší.
    if is_postgres:
        op.create_foreign_key(
            'fk_student_evaluations_modified_by',
            'student_evaluations', 'lecturers',
            ['modified_by'], ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.drop_constraint(
            'fk_student_evaluations_modified_by', 'student_evaluations', type_='foreignkey'
        )

    with op.batch_alter_table('student_evaluations', schema=None) as batch_op:
        batch_op.drop_column('modified_by')
        batch_op.drop_column('modified_at')
        batch_op.drop_column('ai_original_json')
