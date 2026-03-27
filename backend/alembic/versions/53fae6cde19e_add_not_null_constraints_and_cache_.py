"""add_not_null_constraints_and_cache_versioning

Revision ID: 53fae6cde19e
Revises: 03bbfb3db9b0
Create Date: 2026-03-27 11:30:43.319089

Dvě věci v jedné migraci:

1. NOT NULL constraints na kritické sloupce (selektivně — pouze bezpečné):
   - lecturers: email, password_hash, is_active, is_admin, is_superadmin, must_change_password
   - classes: lecturer_id
   - student_evaluations: lecturer_id, scenario_name
   - evaluation_criteria: lecturer_id

2. ClassAnalysis cache versioning (fáze 7):
   - Přidá computed_at (DateTime) — kdy byl AI výsledek naposledy vypočítán
   - Přidá version (Integer, default=1) — počítadlo regenerací pro debugging
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '53fae6cde19e'
down_revision: Union[str, Sequence[str], None] = '03bbfb3db9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # ─── 1. ClassAnalysis: přidat computed_at a version ──────────────────────
    with op.batch_alter_table('class_analyses', schema=None) as batch_op:
        batch_op.add_column(sa.Column('computed_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('version', sa.Integer(), nullable=True, server_default='1'))

    # Naplnit computed_at z created_at pro existující záznamy
    bind.execute(sa.text(
        "UPDATE class_analyses SET computed_at = created_at, version = 1 WHERE computed_at IS NULL"
    ))

    # ─── 2. NOT NULL constraints ───────────────────────────────────────────────
    if dialect == 'postgresql':
        # Nejdříve opravit NULL hodnoty
        bind.execute(sa.text("UPDATE lecturers SET is_active = TRUE WHERE is_active IS NULL"))
        bind.execute(sa.text("UPDATE lecturers SET is_admin = FALSE WHERE is_admin IS NULL"))
        bind.execute(sa.text("UPDATE lecturers SET is_superadmin = FALSE WHERE is_superadmin IS NULL"))
        bind.execute(sa.text("UPDATE lecturers SET must_change_password = FALSE WHERE must_change_password IS NULL"))
        bind.execute(sa.text(
            "UPDATE student_evaluations SET scenario_name = 'scen-1' WHERE scenario_name IS NULL"
        ))
        # Přidat NOT NULL
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN email SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN password_hash SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN is_active SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN is_active SET DEFAULT TRUE"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN is_admin SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN is_admin SET DEFAULT FALSE"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN is_superadmin SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN is_superadmin SET DEFAULT FALSE"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN must_change_password SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE lecturers ALTER COLUMN must_change_password SET DEFAULT FALSE"))
        bind.execute(sa.text("ALTER TABLE classes ALTER COLUMN lecturer_id SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE student_evaluations ALTER COLUMN lecturer_id SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE student_evaluations ALTER COLUMN scenario_name SET NOT NULL"))
        bind.execute(sa.text("ALTER TABLE student_evaluations ALTER COLUMN scenario_name SET DEFAULT 'scen-1'"))
        bind.execute(sa.text("ALTER TABLE evaluation_criteria ALTER COLUMN lecturer_id SET NOT NULL"))
    else:
        # SQLite: opravit NULLy a použít batch_alter_table
        bind.execute(sa.text("UPDATE lecturers SET is_active = 1 WHERE is_active IS NULL"))
        bind.execute(sa.text("UPDATE lecturers SET is_admin = 0 WHERE is_admin IS NULL"))
        bind.execute(sa.text("UPDATE lecturers SET is_superadmin = 0 WHERE is_superadmin IS NULL"))
        bind.execute(sa.text("UPDATE lecturers SET must_change_password = 0 WHERE must_change_password IS NULL"))
        bind.execute(sa.text(
            "UPDATE student_evaluations SET scenario_name = 'scen-1' WHERE scenario_name IS NULL"
        ))
        with op.batch_alter_table('lecturers', schema=None) as batch_op:
            batch_op.alter_column('is_active', existing_type=sa.Boolean(), nullable=False, server_default='1')
            batch_op.alter_column('is_admin', existing_type=sa.Boolean(), nullable=False, server_default='0')
            batch_op.alter_column('is_superadmin', existing_type=sa.Boolean(), nullable=False, server_default='0')
            batch_op.alter_column('must_change_password', existing_type=sa.Boolean(), nullable=False, server_default='0')
        with op.batch_alter_table('student_evaluations', schema=None) as batch_op:
            batch_op.alter_column('scenario_name', existing_type=sa.String(), nullable=False, server_default='scen-1')


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # Odstranit computed_at a version
    with op.batch_alter_table('class_analyses', schema=None) as batch_op:
        batch_op.drop_column('computed_at')
        batch_op.drop_column('version')

    # Zrušit NOT NULL constraints
    if dialect == 'postgresql':
        for col in ['email', 'password_hash', 'is_active', 'is_admin', 'is_superadmin', 'must_change_password']:
            bind.execute(sa.text(f"ALTER TABLE lecturers ALTER COLUMN {col} DROP NOT NULL"))
        bind.execute(sa.text("ALTER TABLE classes ALTER COLUMN lecturer_id DROP NOT NULL"))
        bind.execute(sa.text("ALTER TABLE student_evaluations ALTER COLUMN lecturer_id DROP NOT NULL"))
        bind.execute(sa.text("ALTER TABLE student_evaluations ALTER COLUMN scenario_name DROP NOT NULL"))
        bind.execute(sa.text("ALTER TABLE evaluation_criteria ALTER COLUMN lecturer_id DROP NOT NULL"))
    else:
        with op.batch_alter_table('lecturers', schema=None) as batch_op:
            batch_op.alter_column('is_active', existing_type=sa.Boolean(), nullable=True)
            batch_op.alter_column('is_admin', existing_type=sa.Boolean(), nullable=True)
            batch_op.alter_column('is_superadmin', existing_type=sa.Boolean(), nullable=True)
            batch_op.alter_column('must_change_password', existing_type=sa.Boolean(), nullable=True)
        with op.batch_alter_table('student_evaluations', schema=None) as batch_op:
            batch_op.alter_column('scenario_name', existing_type=sa.String(), nullable=True)
