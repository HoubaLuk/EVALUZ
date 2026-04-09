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
# --proxy-headers: respektovat X-Forwarded-For / X-Forwarded-Proto z nginx
# --forwarded-allow-ips=*: důvěřovat proxy (nginx je ve stejné Docker síti)
# --workers 2: 2 procesy pro paralelní requesty (eval worker je async, takže 2 stačí)
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*", \
     "--log-level", "info", \
     "--access-log"]
