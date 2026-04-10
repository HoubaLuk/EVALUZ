"""ensure_schema_integrity

Revision ID: f1e2d3c4b5a6
Revises: a1b2c3d4e5f6
Create Date: 2026-04-10

Idempotentní záchranná migrace pro případ, že předchozí migrace byly
přeskočeny pomocí 'alembic stamp head' místo skutečného spuštění
(typicky při nasazení na DB se starším schématem bez alembic_version).

Dotčené sloupce (všechny operace s IF NOT EXISTS):
  class_analyses:
    - computed_at  TIMESTAMP  (mělo přidat 53fae6cde19e)
    - version      INTEGER    (mělo přidat 53fae6cde19e)
  student_evaluations:
    - scenario_display_name VARCHAR DEFAULT '' (mělo přidat a1b2c3d4e5f6)
    - is_approved BOOLEAN DEFAULT FALSE        (mělo přidat b4e9f1a2c3d5)

SQLite: batch_alter_table (nevyžaduje IF NOT EXISTS, zachytíme výjimku).
PostgreSQL: čistý DO $$ ... IF NOT EXISTS ... $$ blok.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1e2d3c4b5a6'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == 'postgresql':
        bind.execute(sa.text("""
            DO $$ BEGIN
                -- class_analyses.computed_at
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'class_analyses' AND column_name = 'computed_at'
                ) THEN
                    ALTER TABLE class_analyses ADD COLUMN computed_at TIMESTAMP;
                    UPDATE class_analyses SET computed_at = created_at WHERE computed_at IS NULL;
                END IF;

                -- class_analyses.version
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'class_analyses' AND column_name = 'version'
                ) THEN
                    ALTER TABLE class_analyses ADD COLUMN version INTEGER DEFAULT 1;
                    UPDATE class_analyses SET version = 1 WHERE version IS NULL;
                END IF;

                -- student_evaluations.scenario_display_name
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'student_evaluations' AND column_name = 'scenario_display_name'
                ) THEN
                    ALTER TABLE student_evaluations ADD COLUMN scenario_display_name VARCHAR DEFAULT '';
                END IF;

                -- student_evaluations.is_approved
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'student_evaluations' AND column_name = 'is_approved'
                ) THEN
                    ALTER TABLE student_evaluations ADD COLUMN is_approved BOOLEAN DEFAULT FALSE;
                    UPDATE student_evaluations SET is_approved = FALSE WHERE is_approved IS NULL;
                END IF;
            END $$;
        """))
    else:
        # SQLite: try/except pro každý sloupec zvlášť (ADD COLUMN neexistuje IF NOT EXISTS)
        for table, col, col_def in [
            ('class_analyses',      'computed_at',          'DATETIME'),
            ('class_analyses',      'version',              'INTEGER DEFAULT 1'),
            ('student_evaluations', 'scenario_display_name','VARCHAR DEFAULT ""'),
            ('student_evaluations', 'is_approved',          'BOOLEAN DEFAULT 0'),
        ]:
            try:
                with op.batch_alter_table(table, schema=None) as batch_op:
                    if col == 'computed_at':
                        batch_op.add_column(sa.Column(col, sa.DateTime(), nullable=True))
                    elif col == 'version':
                        batch_op.add_column(sa.Column(col, sa.Integer(), nullable=True, server_default='1'))
                    elif col == 'scenario_display_name':
                        batch_op.add_column(sa.Column(col, sa.String(), nullable=True, server_default=''))
                    elif col == 'is_approved':
                        batch_op.add_column(sa.Column(col, sa.Boolean(), nullable=True, server_default='0'))
            except Exception:
                pass  # sloupec již existuje

        # Naplnit computed_at z created_at pro SQLite
        try:
            bind.execute(sa.text(
                "UPDATE class_analyses SET computed_at = created_at WHERE computed_at IS NULL"
            ))
            bind.execute(sa.text(
                "UPDATE class_analyses SET version = 1 WHERE version IS NULL"
            ))
            bind.execute(sa.text(
                "UPDATE student_evaluations SET is_approved = 0 WHERE is_approved IS NULL"
            ))
        except Exception:
            pass


def downgrade() -> None:
    # Downgrade záměrně nevymazává sloupce — tato migrace je záchranná,
    # rollback by mohl způsobit ztrátu dat v produkci.
    pass
