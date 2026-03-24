import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models.db_models import Base
from core.config import settings

SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)

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
                    
                    -- Drop unique scenario_id
                    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_analyses_scenario_id_key') THEN
                        ALTER TABLE class_analyses DROP CONSTRAINT class_analyses_scenario_id_key;
                    END IF;
                END $$;
            """))
        else:
            # SQLITE: lecturer_id & class_id
            try:
                conn.execute(text("ALTER TABLE class_analyses ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;"))
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE class_analyses ADD COLUMN class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE;"))
            except Exception:
                pass
            try:
                # Remove unique index if exists (SQLite specific)
                conn.execute(text("DROP INDEX IF EXISTS ix_class_analyses_scenario_id;"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_class_analyses_scenario_id ON class_analyses(scenario_id);"))
            except Exception:
                pass

        # 2. TABULKA: student_evaluations
        if not is_sqlite:
            conn.execute(text("""
                DO $$ 
                BEGIN 
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
                END $$;
            """))
            
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
    # 1. Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    # 2. Run schema migrations for existing tables (adding missing columns)
    run_migrations(engine)
