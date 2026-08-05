FROM python:3.10-slim

WORKDIR /app

# Jediný zdroj pravdy pro počet uvicorn worker procesů — čte ho jak `--workers`
# níže, tak backend/core/config.py (settings.UVICORN_WORKERS), aby EvaluationQueue
# mohla LLM concurrency (main.py _resolve_worker_concurrency) korektně rozdělit
# mezi procesy místo jejího nezáměrného násobení počtem workerů (viz ADR-015/016).
# Při změně počtu workerů měň JEN tuto proměnnou, ne --workers na řádku CMD zvlášť.
ENV UVICORN_WORKERS=2

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
# --workers ${UVICORN_WORKERS}: víc procesů pro paralelní HTTP requesty. Eval worker
#   je async (EvaluationQueue), ale je to PER-PROCES singleton — main.py dělí
#   nastavenou LLM concurrency počtem workerů (settings.UVICORN_WORKERS, ADR-016),
#   takže celkový součet napříč procesy odpovídá tomu, co admin nastavil v
#   Administraci, ne jeho násobku. WebSocket doručení (EvaluationQueue) je bezpečné
#   napříč více procesy JEN díky Postgres LISTEN/NOTIFY (ADR-015,
#   backend/services/evaluation_queue.py) — bez něj je in-memory registr spojení
#   per-proces a broadcast na "špatný" proces se tiše ztratí. Necouvat na přímé
#   in-memory broadcast a NEZAPOMEŇ při změně počtu workerů měnit jen ENV
#   UVICORN_WORKERS výše (ne tento řádek zvlášť).
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
    --workers ${UVICORN_WORKERS} \
    --proxy-headers \
    --forwarded-allow-ips '*' \
    --log-level info \
    --access-log"]
