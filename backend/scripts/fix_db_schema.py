import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "upvsp_evaluator.db")

def fix_schema():
    print(f"Připojování k databázi: {DB_PATH}")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        try:
            cursor.execute("ALTER TABLE student_evaluations ADD COLUMN cleaned_name TEXT;")
            print("Sloupec 'cleaned_name' úspěšně přidán.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print("Sloupec 'cleaned_name' již existuje.")
            else:
                print(f"Chyba při přidávání 'cleaned_name': {e}")

        try:
            cursor.execute("ALTER TABLE student_evaluations ADD COLUMN student_identity JSON;")
            print("Sloupec 'student_identity' úspěšně přidán.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print("Sloupec 'student_identity' již existuje.")
            else:
                print(f"Chyba při přidávání 'student_identity': {e}")

        conn.commit()
        conn.close()
        print("Migrace dokončena.")
    except Exception as e:
        print(f"Kritická chyba: {e}")

if __name__ == "__main__":
    fix_schema()
