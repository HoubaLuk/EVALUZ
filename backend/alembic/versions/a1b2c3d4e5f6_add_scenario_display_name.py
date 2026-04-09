"""add scenario_display_name to student_evaluations

Revision ID: a1b2c3d4e5f6
Revises: b4e9f1a2c3d5
Create Date: 2026-04-09

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'b4e9f1a2c3d5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='student_evaluations'
                AND column_name='scenario_display_name'
            ) THEN
                ALTER TABLE student_evaluations ADD COLUMN scenario_display_name VARCHAR DEFAULT '';
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE student_evaluations DROP COLUMN IF EXISTS scenario_display_name;
    """)
