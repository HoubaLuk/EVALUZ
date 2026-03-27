"""convert_created_at_to_datetime

Revision ID: 35e3a28e8797
Revises: 203eafd47370
Create Date: 2026-03-27 07:32:45.483316

Převede sloupce created_at z VARCHAR (ISO 8601 string) na TIMESTAMP/DateTime.
- PostgreSQL: ALTER COLUMN TYPE s USING cast
- SQLite: batch_alter_table (SQLite nepodporuje přímý ALTER COLUMN TYPE)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '35e3a28e8797'
down_revision: Union[str, Sequence[str], None] = '203eafd47370'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tabulky a sloupce k převodu
TABLES_WITH_CREATED_AT = [
    'student_evaluations',
    'class_analyses',
    'export_history',
    'golden_examples',
]


def upgrade() -> None:
    """Převede created_at z String na DateTime."""
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'postgresql':
        for table in TABLES_WITH_CREATED_AT:
            # Nejdříve nastavit NULL pro prázdné nebo neplatné hodnoty
            bind.execute(sa.text(
                f"UPDATE {table} SET created_at = NULL WHERE created_at = '' OR created_at IS NULL"
            ))
            bind.execute(sa.text(
                f"ALTER TABLE {table} ALTER COLUMN created_at TYPE TIMESTAMP "
                f"USING created_at::timestamp"
            ))
    else:
        # SQLite: použít batch_alter_table
        for table in TABLES_WITH_CREATED_AT:
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.alter_column(
                    'created_at',
                    existing_type=sa.String(),
                    type_=sa.DateTime(),
                    existing_nullable=True,
                )


def downgrade() -> None:
    """Vrátí created_at zpět na String."""
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'postgresql':
        for table in TABLES_WITH_CREATED_AT:
            bind.execute(sa.text(
                f"ALTER TABLE {table} ALTER COLUMN created_at TYPE VARCHAR "
                f"USING created_at::text"
            ))
    else:
        for table in TABLES_WITH_CREATED_AT:
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.alter_column(
                    'created_at',
                    existing_type=sa.DateTime(),
                    type_=sa.String(),
                    existing_nullable=True,
                )
