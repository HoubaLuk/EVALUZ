import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models.db_models import Base
from core.config import settings

SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    # PostgreSQL produkční nastavení connection poolu:
    # pool_pre_ping=True zajistí, že se po restartu DB nepoužijí mrtvé spojení.
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,   # kritické pro Docker restart DB
        pool_recycle=3600,    # recyklace spojení každou hodinu
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from sqlalchemy import text

def run_migrations(engine):
    """
    Spouští SQL migrace pro zajištění konzistence schématu (v3.3.1+, Postgres/SQLite).
    Řeší automatické přidání chybějících sloupců pro izolaci lektorů.
    """
    is_sqlite = str(engine.url).startswith("sqlite")
    
    with engine.connect() as conn:
        # 1. TABULKA: class_analyses
        if not is_sqlite:
            # POSTGRES: lecturer_id & table rename
            conn.execute(text("""
                DO $$ 
                BEGIN 
                    -- Rename if old name exists
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analysis') AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') THEN
                        ALTER TABLE class_analysis RENAME TO class_analyses;
                    END IF;
                    
                    -- Add lecturer_id
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='class_analyses' AND column_name='lecturer_id') THEN
                        ALTER TABLE class_analyses ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                        CREATE INDEX IF NOT EXISTS idx_class_analyses_lecturer_id ON class_analyses(lecturer_id);
                    END IF;

                    -- Add class_id
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='class_analyses' AND column_name='class_id') THEN
                        ALTER TABLE class_analyses ADD COLUMN class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE;
                        CREATE INDEX IF NOT EXISTS idx_class_analyses_class_id ON class_analyses(class_id);
                    END IF;
                    
                    -- Add scenario_id
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='class_analyses' AND column_name='scenario_id') THEN
                        ALTER TABLE class_analyses ADD COLUMN scenario_id VARCHAR;
                        CREATE INDEX IF NOT EXISTS idx_class_analyses_scenario_id ON class_analyses(scenario_id);
                    END IF;

                    -- Add content_json
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='class_analyses' AND column_name='content_json') THEN
                        ALTER TABLE class_analyses ADD COLUMN content_json TEXT;
                    END IF;

                    -- Add created_at
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='class_analyses' AND column_name='created_at') THEN
                        ALTER TABLE class_analyses ADD COLUMN created_at VARCHAR;
                    END IF;

                    -- Add computed_at
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='class_analyses' AND column_name='computed_at') THEN
                        ALTER TABLE class_analyses ADD COLUMN computed_at TIMESTAMP;
                    END IF;

                    -- Add version
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='class_analyses' AND column_name='version') THEN
                        ALTER TABLE class_analyses ADD COLUMN version INTEGER DEFAULT 1;
                    END IF;

                    -- Drop unique scenario_id
                    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_analyses_scenario_id_key') THEN
                        ALTER TABLE class_analyses DROP CONSTRAINT class_analyses_scenario_id_key;
                    END IF;
                END $$;
            """))
        else:
            # SQLITE: přidáme všechny chybějící sloupce class_analyses
            for col_name, col_def in [
                ("lecturer_id", "INTEGER REFERENCES lecturers(id) ON DELETE CASCADE"),
                ("class_id",    "INTEGER REFERENCES classes(id) ON DELETE CASCADE"),
                ("computed_at", "DATETIME"),
                ("version",     "INTEGER DEFAULT 1"),
            ]:
                try:
                    conn.execute(text(f"ALTER TABLE class_analyses ADD COLUMN {col_name} {col_def};"))
                except Exception:
                    pass
            try:
                conn.execute(text("DROP INDEX IF EXISTS ix_class_analyses_scenario_id;"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_class_analyses_scenario_id ON class_analyses(scenario_id);"))
            except Exception:
                pass

        # 2. TABULKA: student_evaluations
        if not is_sqlite:
            conn.execute(text("""
                DO $$ 
                BEGIN 
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='student_evaluations') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='lecturer_id') THEN
                            ALTER TABLE student_evaluations ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                            CREATE INDEX IF NOT EXISTS idx_student_evaluations_lecturer_id ON student_evaluations(lecturer_id);
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='cleaned_name') THEN
                            ALTER TABLE student_evaluations ADD COLUMN cleaned_name TEXT;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='student_identity') THEN
                            ALTER TABLE student_evaluations ADD COLUMN student_identity TEXT;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='source_text') THEN
                            ALTER TABLE student_evaluations ADD COLUMN source_text TEXT;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='source_filename') THEN
                            ALTER TABLE student_evaluations ADD COLUMN source_filename VARCHAR;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='created_at') THEN
                            ALTER TABLE student_evaluations ADD COLUMN created_at VARCHAR;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='class_id') THEN
                            ALTER TABLE student_evaluations ADD COLUMN class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='scenario_name') THEN
                            ALTER TABLE student_evaluations ADD COLUMN scenario_name VARCHAR DEFAULT 'scen-1';
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='scenario_display_name') THEN
                            ALTER TABLE student_evaluations ADD COLUMN scenario_display_name VARCHAR DEFAULT '';
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='is_approved') THEN
                            ALTER TABLE student_evaluations ADD COLUMN is_approved BOOLEAN DEFAULT FALSE;
                        END IF;
                    END IF;
                END $$;
            """))
        else:
            cols = [
                ("source_text", "TEXT"),
                ("source_filename", "VARCHAR"),
                ("created_at", "VARCHAR"),
                ("class_id", "INTEGER REFERENCES classes(id) ON DELETE CASCADE"),
                ("scenario_name", "VARCHAR DEFAULT 'scen-1'"),
                ("scenario_display_name", "VARCHAR DEFAULT ''"),
                ("cleaned_name", "TEXT"),
                ("student_identity", "TEXT"),
                ("lecturer_id", "INTEGER REFERENCES lecturers(id) ON DELETE CASCADE"),
                ("is_approved", "BOOLEAN DEFAULT FALSE"),
            ]
            for c_name, c_type in cols:
                try:
                    conn.execute(text(f"ALTER TABLE student_evaluations ADD COLUMN {c_name} {c_type};"))
                except Exception:
                    pass
            
        # 3. TABULKA: classes
        if not is_sqlite:
            conn.execute(text("""
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='classes' AND column_name='lecturer_id') THEN
                        ALTER TABLE classes ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                        CREATE INDEX IF NOT EXISTS idx_classes_lecturer_id ON classes(lecturer_id);
                    END IF;
                END $$;
            """))

        # 4. TABULKA: evaluation_criteria
        if not is_sqlite:
            conn.execute(text("""
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluation_criteria' AND column_name='lecturer_id') THEN
                        ALTER TABLE evaluation_criteria ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                        CREATE INDEX IF NOT EXISTS idx_evaluation_criteria_lecturer_id ON evaluation_criteria(lecturer_id);
                    END IF;
                END $$;
            """))

        # 5. TABULKA: golden_examples
        if not is_sqlite:
            conn.execute(text("""
                DO $$ 
                BEGIN 
                    -- Create table if not exists
                    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='golden_examples') THEN
                        CREATE TABLE golden_examples (
                            id SERIAL PRIMARY KEY,
                            lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE,
                            scenario_id VARCHAR(255),
                            source_text TEXT,
                            perfect_json TEXT,
                            created_at VARCHAR(255)
                        );
                    END IF;
                    
                    -- Check lecturer_id
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='golden_examples' AND column_name='lecturer_id') THEN
                        ALTER TABLE golden_examples ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                    END IF;
                    
                    -- Ensure index
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golden_examples_lecturer_id') THEN
                        CREATE INDEX idx_golden_examples_lecturer_id ON golden_examples(lecturer_id);
                    END IF;
                END $$;
            """))

        # 6. TABULKA: export_history
        if not is_sqlite:
            conn.execute(text("""
                DO $$ 
                BEGIN 
                    -- Check user_id
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='export_history') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='export_history' AND column_name='user_id') THEN
                        ALTER TABLE export_history ADD COLUMN user_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                        CREATE INDEX IF NOT EXISTS idx_export_history_user_id ON export_history(user_id);
                    END IF;
                END $$;
            """))

        # 7. TABULKA: lecturers
        if not is_sqlite:
            conn.execute(text("""
                DO $$ 
                BEGIN 
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='lecturers') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='is_admin') THEN
                            ALTER TABLE lecturers ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='is_superadmin') THEN
                            ALTER TABLE lecturers ADD COLUMN is_superadmin BOOLEAN DEFAULT FALSE;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='is_active') THEN
                            ALTER TABLE lecturers ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='must_change_password') THEN
                            ALTER TABLE lecturers ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='title_after') THEN
                            ALTER TABLE lecturers ADD COLUMN title_after VARCHAR DEFAULT '';
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='rank_shortcut') THEN
                            ALTER TABLE lecturers ADD COLUMN rank_shortcut VARCHAR DEFAULT '';
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='rank_full') THEN
                            ALTER TABLE lecturers ADD COLUMN rank_full VARCHAR DEFAULT '';
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='school_location') THEN
                            ALTER TABLE lecturers ADD COLUMN school_location VARCHAR DEFAULT '';
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lecturers' AND column_name='funkcni_zarazeni') THEN
                            ALTER TABLE lecturers ADD COLUMN funkcni_zarazeni VARCHAR DEFAULT '';
                        END IF;
                    END IF;
                END $$;
            """))
        else:
            cols = [
                ("is_admin", "BOOLEAN DEFAULT FALSE"),
                ("is_superadmin", "BOOLEAN DEFAULT FALSE"),
                ("is_active", "BOOLEAN DEFAULT TRUE"),
                ("must_change_password", "BOOLEAN DEFAULT FALSE"),
                ("title_after", "VARCHAR DEFAULT ''"),
                ("rank_shortcut", "VARCHAR DEFAULT ''"),
                ("rank_full", "VARCHAR DEFAULT ''"),
                ("school_location", "VARCHAR DEFAULT ''"),
                ("funkcni_zarazeni", "VARCHAR DEFAULT ''"),
            ]
            for c_name, c_type in cols:
                try:
                    conn.execute(text(f"ALTER TABLE lecturers ADD COLUMN {c_name} {c_type};"))
                except Exception:
                    pass

        # Commit migrations
        conn.commit()

def init_db():
    """
    Inicializace DB schématu.
    - SQLite (dev): create_all + run_migrations (rychlé, bez Alembic overhead)
    - PostgreSQL (prod): Alembic je primární, init_db() se nevolá z lifespan
    """
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)


def run_alembic_migrations() -> None:
    """
    Spustí Alembic migrace na PostgreSQL produkční DB.
    Volá se jako první věc v lifespan() POUZE pro PostgreSQL.
    SQLite dev prostředí používá init_db() + run_migrations() místo toho.

    Bezpečnost při více uvicorn workerech (--workers N):
    Každý worker zavolá tuto funkci nezávisle při startu.
    Používáme PostgreSQL session-level advisory lock (pg_advisory_lock),
    aby migrace provedl právě jeden worker — ostatní čekají na uvolnění
    zámku, pak zkontrolují verzi a případně přeskočí (DB je již na head).
    Zámek je vždy uvolněn v bloku finally, i při výjimce.
    """
    import logging
    import os
    logger = logging.getLogger("evaluz.migrations")

    # Unikátní číslo zámku pro tuto aplikaci (libovolné int64, musí být konzistentní)
    _ADVISORY_LOCK_ID = 8_473_625_190  # EVALUZ migration lock

    try:
        from alembic.config import Config
        from alembic import command
        from alembic.script import ScriptDirectory
        from alembic.runtime.migration import MigrationContext

        # Cesta k alembic.ini relativně od tohoto souboru (backend/alembic.ini)
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        alembic_cfg_path = os.path.join(backend_dir, "alembic.ini")

        if not os.path.exists(alembic_cfg_path):
            logger.warning(f"alembic.ini nenalezen na {alembic_cfg_path}, přeskakuji Alembic migrace.")
            return

        alembic_cfg = Config(alembic_cfg_path)
        # Přepsat URL z nastavení (env.py to dělá taky, ale pro jistotu)
        alembic_cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

        # Zjistit head revizi ze skriptů (bez přístupu do DB)
        script = ScriptDirectory.from_config(alembic_cfg)
        head_revision = script.get_current_head()

        # ── Advisory lock: blokuje ostatní workery, dokud jsme hotovi ──────────
        with engine.connect() as lock_conn:
            logger.info(
                f"Čekám na advisory lock pro Alembic migrace (lock_id={_ADVISORY_LOCK_ID})…"
            )
            lock_conn.execute(
                text("SELECT pg_advisory_lock(:lock_id)"),
                {"lock_id": _ADVISORY_LOCK_ID},
            )
            logger.info("Advisory lock získán.")

            try:
                # Zkontrolovat aktuální verzi DB (po získání zámku)
                try:
                    migration_ctx = MigrationContext.configure(lock_conn)
                    current_heads = migration_ctx.get_current_heads()
                    current_revision = current_heads[0] if current_heads else None
                except Exception:
                    current_revision = None

                if current_revision == head_revision:
                    logger.info(
                        f"DB je již na aktuální verzi ({head_revision}), "
                        "přeskakuji migrace."
                    )
                    return

                logger.info(
                    f"Spouštím Alembic migrace: {current_revision} → {head_revision}"
                )
                command.upgrade(alembic_cfg, "head")
                logger.info("Alembic migrace dokončeny.")

            except Exception as e:
                logger.error(f"Alembic migrace selhaly: {e}", exc_info=True)
                raise

            finally:
                # Explicitní uvolnění — session-level lock se jinak drží do
                # konce spojení, které může pooler recyklovat mnohem později.
                try:
                    lock_conn.execute(
                        text("SELECT pg_advisory_unlock(:lock_id)"),
                        {"lock_id": _ADVISORY_LOCK_ID},
                    )
                    logger.info("Advisory lock uvolněn.")
                except Exception as unlock_err:
                    logger.warning(f"pg_advisory_unlock selhal: {unlock_err}")

    except Exception as e:
        logger.error(f"run_alembic_migrations: neočekávaná chyba: {e}", exc_info=True)
        raise
