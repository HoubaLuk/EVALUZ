"""scenarios_as_data

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-09-11 00:00:00.000000

Modelová situace se stává řádkem v databázi (ADR-033), místo aby existovala jen jako
položka stromu v prohlížeči, respektive v JSON blobu `lecturer_workspaces` (ADR-031).

Backfill je zároveň NÁPRAVA: strom se každému lektorovi složí z jeho `student_evaluations`
a `evaluation_criteria`, které jsou podle `lecturer_id` vedené správně. Tím se rozplete
promíchání účtů, ke kterému došlo tím, že se do serverového stromu vytlačil obsah
sdíleného prohlížeče.
"""
from typing import Sequence, Union
import datetime

from alembic import op
import sqlalchemy as sa


revision: str = 'e9f0a1b2c3d4'
down_revision: Union[str, Sequence[str], None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_GROUP_NAME = "Moje třída"


def upgrade() -> None:
    op.create_table(
        'study_groups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_study_groups_lecturer_id', 'study_groups', ['lecturer_id'])

    op.create_table(
        'scenarios',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('group_id', sa.Integer(), nullable=True),
        sa.Column('scenario_key', sa.String(), nullable=True),
        sa.Column('display_name', sa.String(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['group_id'], ['study_groups.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        # Klíč je unikátní JEN v rámci lektora. Globálně být nemůže: historické klíče
        # vznikaly na klientovi z pevné výchozí šablony (`scen-1`, `scen-2`), takže je
        # v datech má každý lektor, který kdy něco vyhodnotil.
        sa.UniqueConstraint('lecturer_id', 'scenario_key', name='uq_scenarios_lecturer_key'),
    )
    op.create_index('ix_scenarios_lecturer_id', 'scenarios', ['lecturer_id'])
    op.create_index('ix_scenarios_group_id', 'scenarios', ['group_id'])
    op.create_index('ix_scenarios_scenario_key', 'scenarios', ['scenario_key'])

    _backfill(op.get_bind())

    op.drop_table('lecturer_workspaces')


def _backfill(bind) -> None:
    """Složí každému lektorovi strom z jeho vlastních dat.

    Zdrojem jsou `student_evaluations` a `evaluation_criteria` — obě tabulky mají
    `lecturer_id` a vedou ho správně, takže výsledek je z definice neprosáklý.
    Lektor bez jediné situace nedostane ani prázdnou třídu; tu si založí sám v UI.
    """
    now = datetime.datetime.utcnow()

    rows = bind.execute(sa.text("""
        SELECT lecturer_id,
               scenario_name AS key,
               MAX(display_name) AS display_name,
               MIN(created_at)  AS created_at
        FROM (
            SELECT lecturer_id, scenario_name,
                   NULLIF(scenario_display_name, '') AS display_name,
                   created_at
            FROM student_evaluations
            WHERE lecturer_id IS NOT NULL AND scenario_name IS NOT NULL
            UNION ALL
            SELECT lecturer_id, scenario_name, NULL, NULL
            FROM evaluation_criteria
            WHERE lecturer_id IS NOT NULL AND scenario_name IS NOT NULL
        ) AS zdroj
        GROUP BY lecturer_id, scenario_name
        ORDER BY lecturer_id, MIN(created_at) NULLS LAST, scenario_name
    """)).fetchall()

    skupiny: dict[int, int] = {}
    poradi: dict[int, int] = {}

    for row in rows:
        lecturer_id, key = row.lecturer_id, row.key

        if lecturer_id not in skupiny:
            skupiny[lecturer_id] = bind.execute(
                sa.text("""
                    INSERT INTO study_groups (lecturer_id, name, position, created_at)
                    VALUES (:lid, :name, 0, :now)
                    RETURNING id
                """),
                {"lid": lecturer_id, "name": DEFAULT_GROUP_NAME, "now": now},
            ).scalar()
            poradi[lecturer_id] = 0

        bind.execute(
            sa.text("""
                INSERT INTO scenarios
                    (lecturer_id, group_id, scenario_key, display_name, position, created_at)
                VALUES (:lid, :gid, :key, :name, :pos, :created)
            """),
            {
                "lid": lecturer_id,
                "gid": skupiny[lecturer_id],
                "key": key,
                # Bez čitelného názvu zbývá klíč — lepší než prázdná položka, kterou
                # by lektor ve stromu nerozeznal.
                "name": row.display_name or key,
                "pos": poradi[lecturer_id],
                "created": row.created_at or now,
            },
        )
        poradi[lecturer_id] += 1


def downgrade() -> None:
    op.create_table(
        'lecturer_workspaces',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecturer_id', sa.Integer(), nullable=True),
        sa.Column('tree', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['lecturer_id'], ['lecturers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_lecturer_workspaces_lecturer_id',
        'lecturer_workspaces', ['lecturer_id'], unique=True,
    )

    op.drop_index('ix_scenarios_scenario_key', table_name='scenarios')
    op.drop_index('ix_scenarios_group_id', table_name='scenarios')
    op.drop_index('ix_scenarios_lecturer_id', table_name='scenarios')
    op.drop_table('scenarios')
    op.drop_index('ix_study_groups_lecturer_id', table_name='study_groups')
    op.drop_table('study_groups')
