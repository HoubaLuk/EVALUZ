import sqlite3
import psycopg2
import os
from dotenv import load_dotenv

# Cesty k databázím
SQLITE_DB = 'upvsp_evaluator.db'
load_dotenv()
POSTGRES_URL = os.getenv("DATABASE_URL")

def migrate_table(sqlite_cur, pg_cur, table_name):
    print(f"Migruji tabulku: {table_name}...")
    
    # Získání sloupců z PostgreSQL (naše cílové schéma)
    pg_cur.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table_name}' ORDER BY ordinal_position;")
    columns = [row[0] for row in pg_cur.fetchall()]
    
    if not columns:
        print(f"  Tabulka {table_name} v PostgreSQL nenalezena, přeskakuji.")
        return

    # Získání dat ze SQLite
    try:
        sqlite_cur.execute(f"SELECT * FROM {table_name};")
        rows = sqlite_cur.fetchall()
    except Exception as e:
        print(f"  Tabulka {table_name} v SQLite neexistuje nebo selhala: {e}")
        return

    # Sestavení INSERT dotazu
    col_names = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))
    insert_query = f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING;"

    count = 0
    for row in rows:
        values = []
        for col in columns:
            try:
                val = row[col]
                # Převedení booleanů ze SQLite (0/1) na PostgreSQL True/False
                if isinstance(val, int) and col in ['is_superadmin', 'is_active', 'must_change_password']:
                    val = bool(val)
                values.append(val)
            except:
                values.append(None)
        
        pg_cur.execute(insert_query, tuple(values))
        count += 1
    
    print(f"  Přeneseno {count} záznamů.")

def migrate():
    if not POSTGRES_URL:
        print("Chyba: DATABASE_URL není v .env nastaven.")
        return

    print(f"Zahajuji komplexní migraci do {POSTGRES_URL}")
    
    if not os.path.exists(SQLITE_DB):
        print(f"Chyba: {SQLITE_DB} nebyl nalezen.")
        return
        
    sqlite_conn = sqlite3.connect(SQLITE_DB)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()
    
    try:
        pg_conn = psycopg2.connect(POSTGRES_URL)
        pg_cur = pg_conn.cursor()
        # VYPNUTÍ FOREIGN KEY CHECKS PRO TUTO SESSION
        pg_cur.execute("SET session_replication_role = 'replica';")
    except Exception as e:
        print(f"Chyba při připojení k PostgreSQL: {e}")
        return

    tables = [
        'lecturers',
        'classes',
        'evaluation_criteria',
        'student_evaluations',
        'class_analysis',
        'export_history'
    ]

    for table in tables:
        migrate_table(sqlite_cur, pg_cur, table)

    pg_conn.commit()
    print("\nMigrace úspěšně dokončena! 🎉")
    
    sqlite_conn.close()
    pg_conn.close()

if __name__ == "__main__":
    migrate()
