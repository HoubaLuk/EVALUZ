#!/usr/bin/env bash
#
# Ověří Alembic migrace proti DOČASNÉ instanci PostgreSQL.
#
# PROČ: Alembic řetěz v tomhle projektu je Postgres-only — migrace a1b2c3d4e5f6
# obsahuje `DO $$ ... END $$;`, takže proti SQLite `alembic upgrade head` vůbec
# neproběhne. Zároveň se `run_migrations()` v produkci nespouští (main.py ho volá
# jen pro SQLite, na PostgreSQL běží `alembic upgrade head` v Dockerfile CMD), takže
# sloupec přidaný jen do db_models.py v produkci nikdy nevznikne a aplikace spadne
# na UndefinedColumn. Testy na SQLite to neodhalí — `create_all()` tabulku vytvoří
# rovnou z modelu.
#
# Skript proto postaví čistou databázi, projede celý řetěz od nuly a ověří i
# downgrade + opětovný upgrade (odhalí migraci, která nejde vzít zpět).
#
# POUŽITÍ:
#   backend/scripts/verify_migrations.sh
#
# VYŽADUJE: PostgreSQL binárky (initdb, pg_ctl, psql) a alembic v backend/venv.
# Na macOS s Homebrew je postgresql keg-only — skript si cestu najde sám.

set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PGPORT_TEST:-55432}"
WORKDIR="$(mktemp -d)"
# Unix socket má limit 103 bajtů na cestu; mktemp -d pod /var/folders je moc dlouhý,
# takže socket musí jinam. Bez tohohle Postgres nenastartuje.
SOCKDIR="$(mktemp -d /tmp/evzpg.XXXXXX)"

cleanup() {
    if [ -d "$WORKDIR/pgdata" ]; then
        # LC_ALL=C jen pro pg_ctl — viz poznámka u startu.
        LC_ALL=C "$PGBIN/pg_ctl" -D "$WORKDIR/pgdata" stop -m immediate >/dev/null 2>&1 || true
    fi
    rm -rf "$WORKDIR" "$SOCKDIR"
}
trap cleanup EXIT

# --- 1. Najít PostgreSQL binárky -------------------------------------------------
PGBIN=""
if command -v initdb >/dev/null 2>&1; then
    PGBIN="$(dirname "$(command -v initdb)")"
else
    for candidate in /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin \
                     /usr/lib/postgresql/*/bin; do
        [ -x "$candidate/initdb" ] && PGBIN="$candidate" && break
    done
fi
if [ -z "$PGBIN" ]; then
    echo "CHYBA: nenalezeny PostgreSQL binárky (initdb)." >&2
    echo "       macOS: brew install postgresql@17" >&2
    exit 1
fi

ALEMBIC="$BACKEND_DIR/venv/bin/alembic"
if [ ! -x "$ALEMBIC" ]; then
    echo "CHYBA: $ALEMBIC neexistuje. Spusť: backend/venv/bin/pip install -r requirements.txt" >&2
    exit 1
fi

echo "PostgreSQL: $("$PGBIN/pg_ctl" --version)"
echo "Port: $PORT"
echo

# --- 2. Dočasná instance ---------------------------------------------------------
# --locale=C je na macOS nutné, jinak postgres skončí na "postmaster became
# multithreaded during startup". Encoding ale MUSÍ zůstat UTF8 — s LC_ALL=C by initdb
# založil cluster v SQL_ASCII a migrace s českými texty by spadly na UnicodeEncodeError.
# Ze stejného důvodu nesmí LC_ALL=C prosáknout do Pythonu (tam zase UnicodeDecodeError).
echo "==> Zakládám dočasnou databázi…"
"$PGBIN/initdb" -D "$WORKDIR/pgdata" -U evaluz --auth=trust \
    --encoding=UTF8 --locale=C >/dev/null

LC_ALL=C "$PGBIN/pg_ctl" -D "$WORKDIR/pgdata" \
    -o "-p $PORT -k $SOCKDIR -h 127.0.0.1" \
    -l "$WORKDIR/pg.log" -w start >/dev/null

LC_ALL=C "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U evaluz -d postgres \
    -c "CREATE DATABASE evaluz_migtest;" >/dev/null
echo "    OK"
echo

export DATABASE_URL="postgresql://evaluz@127.0.0.1:$PORT/evaluz_migtest"
cd "$BACKEND_DIR"

count_cols() {
    LC_ALL=C "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U evaluz -d evaluz_migtest -tAc \
        "SELECT count(*) FROM information_schema.columns WHERE table_name='$1';"
}

# --- 3. Celý řetěz od nuly -------------------------------------------------------
echo "==> alembic upgrade head (od nuly)"
"$ALEMBIC" upgrade head
echo "    sloupců ve student_evaluations: $(count_cols student_evaluations)"
echo

# --- 4. Downgrade a zpět ---------------------------------------------------------
# Odhalí migraci, která nejde vzít zpět — typicky chybějící nebo neúplný downgrade().
echo "==> alembic downgrade -1"
"$ALEMBIC" downgrade -1 >/dev/null
echo "    sloupců po downgrade: $(count_cols student_evaluations)"

# --- 4b. Backfill nad REÁLNÝMI daty ----------------------------------------------
# Prázdná databáze datovou cestu migrace neprověří. Konkrétně v3.17.0 prošla tímhle
# skriptem zeleně a v produkci pak spadla na `duplicate key (scenario_key)=(scen-2)`:
# výchozí strom v prohlížeči byl pevně daný (`scen-1`, `scen-2`) a `scenario_name` mělo
# tutéž serverovou default hodnotu, takže ty klíče má v datech každý lektor. Proto se
# sem před posledním upgradem nasypou data dvou lektorů se SDÍLENÝMI klíči.
echo "==> Nasazuji testovací data se sdílenými klíči (scen-1, scen-2)"
LC_ALL=C "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U evaluz -d evaluz_migtest -q <<'SQL'
INSERT INTO lecturers (email, password_hash) VALUES
    ('mig-a@pcr.cz', 'x'), ('mig-b@pcr.cz', 'x');
INSERT INTO classes (lecturer_id, name)
    SELECT id, 'Základní kurz' FROM lecturers WHERE email LIKE 'mig-%@pcr.cz';
INSERT INTO student_evaluations
    (lecturer_id, class_id, student_name, scenario_name, scenario_display_name, created_at)
SELECT c.lecturer_id, c.id, 'novak.pdf', k.klic, k.nazev, now()
FROM classes c
CROSS JOIN (VALUES ('scen-1', 'MS1: Dopravní nehoda'),
                   ('scen-2', 'MS2: Vstup do obydlí')) AS k(klic, nazev)
WHERE c.lecturer_id IN (SELECT id FROM lecturers WHERE email LIKE 'mig-%@pcr.cz');
SQL
echo "    OK"
echo

echo "==> alembic upgrade head (znovu, už nad daty)"
"$ALEMBIC" upgrade head >/dev/null
echo "    sloupců po opětovném upgrade: $(count_cols student_evaluations)"

# Každý lektor musí mít vlastní řádek pro každý svůj klíč — sdílený klíč nesmí
# znamenat sdílenou situaci ani chybu.
ROZPAD="$(LC_ALL=C "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U evaluz -d evaluz_migtest -tAc \
    "SELECT string_agg(l.email || '=' || s.scenario_key, ',' ORDER BY l.email, s.scenario_key)
     FROM scenarios s JOIN lecturers l ON l.id = s.lecturer_id;")"
OCEKAVANO="mig-a@pcr.cz=scen-1,mig-a@pcr.cz=scen-2,mig-b@pcr.cz=scen-1,mig-b@pcr.cz=scen-2"
if [ "$ROZPAD" != "$OCEKAVANO" ]; then
    echo "CHYBA: backfill nerozdělil situace podle lektorů." >&2
    echo "       očekáváno: $OCEKAVANO" >&2
    echo "       nalezeno:  $ROZPAD" >&2
    exit 1
fi
echo "    backfill: každý lektor dostal své scen-1 i scen-2"
echo

# --- 5. Kontrola jednoho headu ---------------------------------------------------
echo "==> Kontrola revizí"
HEADS="$("$ALEMBIC" heads 2>/dev/null | grep -c '(head)' || true)"
if [ "$HEADS" != "1" ]; then
    echo "CHYBA: očekáván právě jeden head, nalezeno: $HEADS" >&2
    "$ALEMBIC" heads >&2
    exit 1
fi
"$ALEMBIC" current
echo
echo "==> HOTOVO — migrace jsou v pořádku."
