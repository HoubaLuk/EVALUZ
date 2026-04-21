"""baseline_schema

Revision ID: 203eafd47370
Revises:
Create Date: 2026-03-27 07:31:13.826059

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '203eafd47370'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables() -> set:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def _existing_indexes(table: str) -> set:
    bind = op.get_bind()
    return {idx['name'] for idx in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    """Upgrade schema."""
    tables = _existing_tables()

    if 'app_settings' not in tables:
        op.create_table('app_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(), nullable=True),
        sa.Column('value', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('app_settings')
    with op.batch_alter_table('app_settings', schema=None) as batch_op:
        if 'ix_app_settings_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_app_settings_id'), ['id'], unique=False)
        if 'ix_app_settings_key' not in indexes:
            batch_op.create_index(batch_op.f('ix_app_settings_key'), ['key'], unique=True)

    if 'lecturers' not in tables:
        op.create_table('lecturers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('password_hash', sa.String(), nullable=True),
        sa.Column('title_before', sa.String(), nullable=True),
        sa.Column('first_name', sa.String(), nullable=True),
        sa.Column('last_name', sa.String(), nullable=True),
        sa.Column('title_after', sa.String(), nullable=True),
        sa.Column('rank_shortcut', sa.String(), nullable=True),
        sa.Column('rank_full', sa.String(), nullable=True),
        sa.Column('school_location', sa.String(), nullable=True),
        sa.Column('funkcni_zarazeni', sa.String(), nullable=True),
        sa.Column('is_superadmin', sa.Boolean(), nullable=True),
        sa.Column('is_admin', sa.Boolean(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('must_change_password', sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('lecturers')
    with op.batch_alter_table('lecturers', schema=None) as batch_op:
        if 'ix_lecturers_email' not in indexes:
            batch_op.create_index(batch_op.f('ix_lecturers_email'), ['email'], unique=True)
        if 'ix_lecturers_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_lecturers_id'), ['id'], unique=False)

    if 'system_prompts' not in tables:
        op.create_table('system_prompts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('phase_name', sa.String(), nullable=True),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('temperature', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('system_prompts')
    with op.batch_alter_table('system_prompts', schema=None) as batch_op:
        if 'ix_system_prompts_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_system_prompts_id'), ['id'], unique=False)
        if 'ix_system_prompts_phase_name' not in indexes:
            batch_op.create_index(batch_op.f('ix_system_prompts_phase_name'), ['phase_name'], unique=True)

    if 'classes' not in tables:
        op.create_table('classes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('classes')
    with op.batch_alter_table('classes', schema=None) as batch_op:
        if 'ix_classes_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_classes_id'), ['id'], unique=False)
        if 'ix_classes_name' not in indexes:
            batch_op.create_index(batch_op.f('ix_classes_name'), ['name'], unique=False)

    if 'evaluation_criteria' not in tables:
        op.create_table('evaluation_criteria',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('scenario_name', sa.String(), nullable=True),
        sa.Column('markdown_content', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('evaluation_criteria')
    with op.batch_alter_table('evaluation_criteria', schema=None) as batch_op:
        if 'ix_evaluation_criteria_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_evaluation_criteria_id'), ['id'], unique=False)
        if 'ix_evaluation_criteria_scenario_name' not in indexes:
            batch_op.create_index(batch_op.f('ix_evaluation_criteria_scenario_name'), ['scenario_name'], unique=False)

    if 'export_history' not in tables:
        op.create_table('export_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('scenario_name', sa.String(), nullable=True),
        sa.Column('type', sa.String(), nullable=True),
        sa.Column('download_url', sa.String(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('export_history')
    with op.batch_alter_table('export_history', schema=None) as batch_op:
        if 'ix_export_history_created_at' not in indexes:
            batch_op.create_index(batch_op.f('ix_export_history_created_at'), ['created_at'], unique=False)
        if 'ix_export_history_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_export_history_id'), ['id'], unique=False)
        if 'ix_export_history_user_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_export_history_user_id'), ['user_id'], unique=False)

    if 'golden_examples' not in tables:
        op.create_table('golden_examples',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('scenario_id', sa.String(), nullable=True),
        sa.Column('source_text', sa.Text(), nullable=True),
        sa.Column('perfect_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('golden_examples')
    with op.batch_alter_table('golden_examples', schema=None) as batch_op:
        if 'ix_golden_examples_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_golden_examples_id'), ['id'], unique=False)
        if 'ix_golden_examples_lecturer_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_golden_examples_lecturer_id'), ['lecturer_id'], unique=False)
        if 'ix_golden_examples_scenario_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_golden_examples_scenario_id'), ['scenario_id'], unique=False)

    if 'class_analyses' not in tables:
        op.create_table('class_analyses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('class_id', sa.Integer(), nullable=True),
        sa.Column('scenario_id', sa.String(), nullable=True),
        sa.Column('content_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('class_analyses')
    with op.batch_alter_table('class_analyses', schema=None) as batch_op:
        if 'ix_class_analyses_class_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_class_analyses_class_id'), ['class_id'], unique=False)
        if 'ix_class_analyses_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_class_analyses_id'), ['id'], unique=False)
        if 'ix_class_analyses_lecturer_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_class_analyses_lecturer_id'), ['lecturer_id'], unique=False)
        if 'ix_class_analyses_scenario_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_class_analyses_scenario_id'), ['scenario_id'], unique=False)

    if 'criteria' not in tables:
        op.create_table('criteria',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('evaluation_criteria_id', sa.Integer(), nullable=True),
        sa.Column('nazev', sa.String(), nullable=True),
        sa.Column('popis', sa.Text(), nullable=True),
        sa.Column('body', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['evaluation_criteria_id'], ['evaluation_criteria.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('criteria')
    with op.batch_alter_table('criteria', schema=None) as batch_op:
        if 'ix_criteria_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_criteria_id'), ['id'], unique=False)

    if 'student_evaluations' not in tables:
        op.create_table('student_evaluations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('student_name', sa.String(), nullable=True),
        sa.Column('class_id', sa.Integer(), nullable=True),
        sa.Column('scenario_name', sa.String(), nullable=True),
        sa.Column('json_result', sa.Text(), nullable=True),
        sa.Column('cleaned_name', sa.String(), nullable=True),
        sa.Column('student_identity', sa.Text(), nullable=True),
        sa.Column('source_text', sa.Text(), nullable=True),
        sa.Column('source_filename', sa.String(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
    indexes = _existing_indexes('student_evaluations')
    with op.batch_alter_table('student_evaluations', schema=None) as batch_op:
        if 'ix_student_evaluations_cleaned_name' not in indexes:
            batch_op.create_index(batch_op.f('ix_student_evaluations_cleaned_name'), ['cleaned_name'], unique=False)
        if 'ix_student_evaluations_id' not in indexes:
            batch_op.create_index(batch_op.f('ix_student_evaluations_id'), ['id'], unique=False)
        if 'ix_student_evaluations_scenario_name' not in indexes:
            batch_op.create_index(batch_op.f('ix_student_evaluations_scenario_name'), ['scenario_name'], unique=False)
        if 'ix_student_evaluations_student_name' not in indexes:
            batch_op.create_index(batch_op.f('ix_student_evaluations_student_name'), ['student_name'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('student_evaluations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_student_evaluations_student_name'))
        batch_op.drop_index(batch_op.f('ix_student_evaluations_scenario_name'))
        batch_op.drop_index(batch_op.f('ix_student_evaluations_id'))
        batch_op.drop_index(batch_op.f('ix_student_evaluations_cleaned_name'))

    op.drop_table('student_evaluations')
    with op.batch_alter_table('criteria', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_criteria_id'))

    op.drop_table('criteria')
    with op.batch_alter_table('class_analyses', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_class_analyses_scenario_id'))
        batch_op.drop_index(batch_op.f('ix_class_analyses_lecturer_id'))
        batch_op.drop_index(batch_op.f('ix_class_analyses_id'))
        batch_op.drop_index(batch_op.f('ix_class_analyses_class_id'))

    op.drop_table('class_analyses')
    with op.batch_alter_table('golden_examples', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_golden_examples_scenario_id'))
        batch_op.drop_index(batch_op.f('ix_golden_examples_lecturer_id'))
        batch_op.drop_index(batch_op.f('ix_golden_examples_id'))

    op.drop_table('golden_examples')
    with op.batch_alter_table('export_history', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_export_history_user_id'))
        batch_op.drop_index(batch_op.f('ix_export_history_id'))
        batch_op.drop_index(batch_op.f('ix_export_history_created_at'))

    op.drop_table('export_history')
    with op.batch_alter_table('evaluation_criteria', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_evaluation_criteria_scenario_name'))
        batch_op.drop_index(batch_op.f('ix_evaluation_criteria_id'))

    op.drop_table('evaluation_criteria')
    with op.batch_alter_table('classes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_classes_name'))
        batch_op.drop_index(batch_op.f('ix_classes_id'))

    op.drop_table('classes')
    with op.batch_alter_table('system_prompts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_system_prompts_phase_name'))
        batch_op.drop_index(batch_op.f('ix_system_prompts_id'))

    op.drop_table('system_prompts')
    with op.batch_alter_table('lecturers', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_lecturers_id'))
        batch_op.drop_index(batch_op.f('ix_lecturers_email'))

    op.drop_table('lecturers')
    with op.batch_alter_table('app_settings', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_app_settings_key'))
        batch_op.drop_index(batch_op.f('ix_app_settings_id'))

    op.drop_table('app_settings')
