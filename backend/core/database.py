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
                    
                    -- Drop unique scenario_id
                    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_analyses_scenario_id_key') THEN
                        ALTER TABLE class_analyses DROP CONSTRAINT class_analyses_scenario_id_key;
                    END IF;
                END $$;
            """))
        else:
            # SQLITE: lecturer_id (pridani sloupce v sqlite je omezené, ale pro vývoj postačí try/except)
            try:
                conn.execute(text("ALTER TABLE class_analyses ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;"))
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
                CREATE TABLE IF NOT EXISTS golden_examples (
                    id SERIAL PRIMARY KEY,
                    lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE,
                    scenario_id VARCHAR(255),
                    source_text TEXT,
                    perfect_json TEXT,
                    created_at VARCHAR(255)
                );
                CREATE INDEX IF NOT EXISTS idx_golden_examples_lecturer_id ON golden_examples(lecturer_id);
            """))

        # Commit migrations
        conn.commit()

def init_db():
    # 1. Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    # 2. Run schema migrations for existing tables (adding missing columns)
    run_migrations(engine)
