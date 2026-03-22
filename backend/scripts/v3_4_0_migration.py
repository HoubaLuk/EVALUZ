import sqlite3
import datetime

def migrate():
    print("Spouštím migraci v3.4.0 (Statistiky evaluací)...")
    try:
        conn = sqlite3.connect('upvsp_evaluator.db')
        cursor = conn.cursor()

        # 1. Přidání sloupce is_admin do lecturers
        try:
            cursor.execute("ALTER TABLE lecturers ADD COLUMN is_admin BOOLEAN DEFAULT 0")
            print("INFO: Sloupec 'is_admin' přidán do 'lecturers'.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e).lower():
                print("INFO: Sloupec 'is_admin' už existuje.")
            else:
                print(f"ERROR: Nelze přidat 'is_admin': {e}")

        # 2. Přidání sloupce created_at do student_evaluations
        try:
            cursor.execute("ALTER TABLE student_evaluations ADD COLUMN created_at VARCHAR")
            print("INFO: Sloupec 'created_at' přidán do 'student_evaluations'.")
            
            # Zpětně nastavit datum těm existujícím
            now_iso = datetime.datetime.now().isoformat()
            cursor.execute(f"UPDATE student_evaluations SET created_at = '{now_iso}' WHERE created_at IS NULL")
            print(f"INFO: Stávající vyhodnocení dostala časové razítko {now_iso}.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e).lower():
                print("INFO: Sloupec 'created_at' už existuje.")
            else:
                print(f"ERROR: Nelze přidat 'created_at': {e}")

        conn.commit()
        conn.close()
        print("Migrace úspěšně dokončena.")
    except Exception as e:
        print(f"FATAL ERROR během migrace: {e}")

if __name__ == "__main__":
    migrate()
