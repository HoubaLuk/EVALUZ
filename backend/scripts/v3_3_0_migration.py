import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
POSTGRES_URL = os.getenv("DATABASE_URL")

def migrate():
    if not POSTGRES_URL:
        print("CHYBA: DATABASE_URL nebyla nalezena v .env souboru.")
        print("Pokud běžíte na serveru, ujistěte se, že máte nastavenu proměnnou prostředí.")
        return

    print(f"Připojování k databázi pro opravu schématu (v3.3.0)...")
    try:
        conn = psycopg2.connect(POSTGRES_URL)
        cur = conn.cursor()

        # 1. Oprava tabulky ClassAnalysis (v kódu class_analyses)
        print("Kontrola tabulky 'class_analyses'...")
        cur.execute("""
            DO $$ 
            BEGIN 
                -- Přidání lecturer_id pokud neexistuje
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='class_analyses' AND column_name='lecturer_id') THEN
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') THEN
                        ALTER TABLE class_analyses ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                        CREATE INDEX IF NOT EXISTS idx_class_analyses_lecturer_id ON class_analyses(lecturer_id);
                        RAISE NOTICE 'Sloupec lecturer_id přidán do class_analyses.';
                    END IF;
                END IF;

                -- Ošetření starého názvu tabulky (pokud existuje)
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analysis') AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='class_analyses') THEN
                    ALTER TABLE class_analysis RENAME TO class_analyses;
                    RAISE NOTICE 'Tabulka class_analysis přejmenována na class_analyses.';
                END IF;

                -- Odstranění unique constraintu na scenario_id pokud existuje
                IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_analyses_scenario_id_key') THEN
                    ALTER TABLE class_analyses DROP CONSTRAINT class_analyses_scenario_id_key;
                    RAISE NOTICE 'Unikátní constraint na scenario_id odstraněn.';
                END IF;
                
                -- Fallback pro unikátní index pokud nebyl constraint ale index
                IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_class_analyses_scenario_id' AND indexdef LIKE '%UNIQUE%') THEN
                    DROP INDEX ix_class_analyses_scenario_id;
                    CREATE INDEX ix_class_analyses_scenario_id ON class_analyses(scenario_id);
                END IF;
            END $$;
        """)

        # 2. Kontrola student_evaluations
        print("Kontrola tabulky 'student_evaluations'...")
        cur.execute("""
            DO $$ 
            BEGIN 
                -- lecturer_id
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='lecturer_id') THEN
                    ALTER TABLE student_evaluations ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                    CREATE INDEX IF NOT EXISTS idx_student_evaluations_lecturer_id ON student_evaluations(lecturer_id);
                END IF;
                
                -- cleaned_name
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='cleaned_name') THEN
                    ALTER TABLE student_evaluations ADD COLUMN cleaned_name TEXT;
                END IF;
                
                -- student_identity
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_evaluations' AND column_name='student_identity') THEN
                    ALTER TABLE student_evaluations ADD COLUMN student_identity TEXT;
                END IF;
            END $$;
        """)

        # 3. Kontrola classes
        print("Kontrola tabulky 'classes'...")
        cur.execute("""
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='classes' AND column_name='lecturer_id') THEN
                    ALTER TABLE classes ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                    CREATE INDEX idx_classes_lecturer_id ON classes(lecturer_id);
                    RAISE NOTICE 'Sloupec lecturer_id přidán do classes.';
                END IF;
            END $$;
        """)

        # 4. Kontrola evaluation_criteria
        print("Kontrola tabulky 'evaluation_criteria'...")
        cur.execute("""
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluation_criteria' AND column_name='lecturer_id') THEN
                    ALTER TABLE evaluation_criteria ADD COLUMN lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                    CREATE INDEX idx_evaluation_criteria_lecturer_id ON evaluation_criteria(lecturer_id);
                    RAISE NOTICE 'Sloupec lecturer_id přidán do evaluation_criteria.';
                END IF;
            END $$;
        """)

        # 5. Kontrola golden_examples
        print("Kontrola tabulky 'golden_examples'...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS golden_examples (
                id SERIAL PRIMARY KEY,
                lecturer_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE,
                scenario_id VARCHAR(255),
                source_text TEXT,
                perfect_json TEXT,
                created_at VARCHAR(255)
            );
            CREATE INDEX IF NOT EXISTS idx_golden_examples_lecturer_id ON golden_examples(lecturer_id);
            CREATE INDEX IF NOT EXISTS idx_golden_examples_scenario_id ON golden_examples(scenario_id);
        """)

        # 6. Kontrola export_history (v kódu user_id)
        print("Kontrola tabulky 'export_history'...")
        cur.execute("""
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='export_history' AND column_name='user_id') THEN
                    ALTER TABLE export_history ADD COLUMN user_id INTEGER REFERENCES lecturers(id) ON DELETE CASCADE;
                    CREATE INDEX idx_export_history_user_id ON export_history(user_id);
                    RAISE NOTICE 'Sloupec user_id přidán do export_history.';
                END IF;
            END $$;
        """)

        conn.commit()
        print("\n✅ DATABÁZOVÁ MIGRACE DOKONČENA ÚSPĚŠNĚ!")
        
        # Bonus: Backfill existing data
        print("Provádím backfill ID lektora pro stávající data (nastavení na ID=1)...")
        cur.execute("UPDATE class_analyses SET lecturer_id = 1 WHERE lecturer_id IS NULL;")
        cur.execute("UPDATE student_evaluations SET lecturer_id = 1 WHERE lecturer_id IS NULL;")
        cur.execute("UPDATE classes SET lecturer_id = 1 WHERE lecturer_id IS NULL;")
        cur.execute("UPDATE evaluation_criteria SET lecturer_id = 1 WHERE lecturer_id IS NULL;")
        cur.execute("UPDATE export_history SET user_id = 1 WHERE user_id IS NULL;")
        conn.commit()
        print("✅ Backfill dokončen.")

        cur.close()
        conn.close()

    except Exception as e:
        print(f"❌ CHYBA PŘI MIGRACI: {e}")
        if 'conn' in locals() and conn:
            conn.rollback()

if __name__ == "__main__":
    migrate()
