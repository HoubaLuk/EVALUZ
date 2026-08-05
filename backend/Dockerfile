FROM python:3.10-slim

WORKDIR /app

# Systémové závislosti pro psycopg2, PyMuPDF a curl (healthcheck)
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Závislosti nainstalovat před kopírováním kódu (cache layer)
# requirements.lock.txt = zamčené verze ověřené proti test suite (viz komentář v souboru).
COPY requirements.txt requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt

# Kopírovat kód aplikace
COPY . .

# Bezpečnost: spouštět jako neprivilegovaný uživatel (ne root)
RUN addgroup --system evaluz && adduser --system --ingroup evaluz evaluz
RUN chown -R evaluz:evaluz /app
USER evaluz

EXPOSE 8000

# Produkční spuštění:
# Migrace DB proběhnou jako PRVNÍ krok (jeden proces, žádná race condition).
# Teprve po jejich úspěšném dokončení se spustí uvicorn workery.
# Pokud alembic upgrade head selže, kontejner se zastaví s nenulovým exit kódem
# a workery se vůbec nespustí — chyba je jasně viditelná v docker logs.
#
# exec: předání signálů (SIGTERM) přímo uvicornu pro čisté vypnutí.
# --proxy-headers: respektovat X-Forwarded-For / X-Forwarded-Proto z nginx
# --forwarded-allow-ips=*: důvěřovat proxy (nginx je ve stejné Docker síti)
# --workers 2: 2 procesy pro paralelní requesty. Eval worker je async (jeden proces
#   souběžně zpracuje N studentů přes AppSettings.LLM_CONCURRENCY_*), --workers tedy
#   neovlivňuje propustnost vyhodnocování. WebSocket doručení (EvaluationQueue) je
#   ale bezpečné napříč více procesy JEN díky Postgres LISTEN/NOTIFY (ADR-015,
#   backend/services/evaluation_queue.py) — bez něj je in-memory registr spojení
#   per-proces a broadcast na "špatný" proces se tiše ztratí. Necouvat na přímé
#   in-memory broadcast, pokud se --workers zvýší nad 2.
CMD ["sh", "-c", "\
  python -c \"\
import os, psycopg2; \
conn = psycopg2.connect(os.environ['DATABASE_URL']); \
cur = conn.cursor(); \
cur.execute(\\\"SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='alembic_version')\\\"); \
av = cur.fetchone()[0]; \
cur.execute(\\\"SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='app_settings')\\\"); \
tabs = cur.fetchone()[0]; \
conn.close(); \
exit(0 if av or not tabs else 1) \
\" || alembic stamp head && \
  alembic upgrade head && \
  exec uvicorn main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 2 \
    --proxy-headers \
    --forwarded-allow-ips '*' \
    --log-level info \
    --access-log"]
