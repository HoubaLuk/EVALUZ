"""convert_json_columns_to_jsonb

Revision ID: 03bbfb3db9b0
Revises: 35e3a28e8797
Create Date: 2026-03-27 07:35:54.664339

Převede JSON text sloupce na JSONB na PostgreSQL.
SQLite: žádná změna (TypeDecorator JSONType řeší transparentně).

Dotčené sloupce:
- student_evaluations.json_result       TEXT -> JSONB
- student_evaluations.student_identity  TEXT -> JSONB
- class_analyses.content_json           TEXT -> JSONB
- golden_examples.perfect_json          TEXT -> JSONB
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '03bbfb3db9b0'
down_revision: Union[str, Sequence[str], None] = '35e3a28e8797'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (tabulka, sloupec) páry k převodu
JSON_COLUMNS = [
    ('student_evaluations', 'json_result'),
    ('student_evaluations', 'student_identity'),
    ('class_analyses', 'content_json'),
    ('golden_examples', 'perfect_json'),
]


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'postgresql':
        for table, column in JSON_COLUMNS:
            # Vyčistit nevalidní hodnoty (None string, prázdné)
            bind.execute(sa.text(
                f"UPDATE {table} SET {column} = NULL "
                f"WHERE {column} IN ('None', '', 'null') OR {column} IS NULL"
            ))
            # Převést TEXT na JSONB
            bind.execute(sa.text(
                f"ALTER TABLE {table} ALTER COLUMN {column} TYPE JSONB "
                f"USING {column}::jsonb"
            ))
    # SQLite: žádná změna schématu — JSONType TypeDecorator řeší serializaci transparentně


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'postgresql':
        for table, column in JSON_COLUMNS:
            bind.execute(sa.text(
                f"ALTER TABLE {table} ALTER COLUMN {column} TYPE TEXT "
                f"USING {column}::text"
            ))
