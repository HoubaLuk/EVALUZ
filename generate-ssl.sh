#!/bin/bash
# Generátor self-signed SSL certifikátu pro EVALUZ
# Spustit jednou před prvním docker-compose up:  bash generate-ssl.sh

set -e

mkdir -p ssl

openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout ssl/nginx.key \
    -out ssl/nginx.crt \
    -subj "/C=CZ/ST=Praha/L=Praha/O=UPVSP/CN=EVALUZ"

chmod 600 ssl/nginx.key
chmod 644 ssl/nginx.crt

echo ""
echo "SSL certifikát úspěšně vygenerován v ./ssl/ (platnost 10 let)."
echo ""
echo "Postup spuštění:"
echo "  docker-compose up -d --build"
echo ""
echo "Při prvním přístupu prohlížeč zobrazí varování o self-signed certifikátu."
echo "Klikněte 'Pokračovat' (nebo 'Advanced → Proceed') — varování se již nezobrazí."
