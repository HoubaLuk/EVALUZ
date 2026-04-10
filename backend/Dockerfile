FROM python:3.10-slim

WORKDIR /app

# Systémové závislosti pro psycopg2, PyMuPDF a curl (healthcheck)
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Závislosti nainstalovat před kopírováním kódu (cache layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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
# --workers 2: 2 procesy pro paralelní requesty (eval worker je async, takže 2 stačí)
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn main:app \
     --host 0.0.0.0 \
     --port 8000 \
     --workers 2 \
     --proxy-headers \
     --forwarded-allow-ips '*' \
     --log-level info \
     --access-log"]
