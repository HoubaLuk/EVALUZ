# EVALUZ

**Systém pro inteligentní vyhodnocování úředních záznamů pomocí AI**

EVALUZ je specializovaná platforma pro automatizovanou analýzu úředních záznamů (ÚZ) v prostředí ÚPVSP. Kombinuje moderní webové technologie s lokálními LLM modely pro standardizaci a urychlení hodnocení studentů — přičemž lektor má vždy poslední slovo prostřednictvím manuální korekce.

---

## Obsah

1. [Architektura](#architektura)
2. [Požadavky](#požadavky)
3. [Rychlý start — lokální vývoj](#rychlý-start--lokální-vývoj)
4. [Produkční nasazení](#produkční-nasazení)
5. [Proměnné prostředí](#proměnné-prostředí)
6. [Databáze a migrace](#databáze-a-migrace)
7. [Vzdušná instalace (Air-Gapped)](#vzdušná-instalace-air-gapped)
8. [Role a přístupová práva](#role-a-přístupová-práva)
9. [Bezpečnost](#bezpečnost)
10. [Přehled API](#přehled-api)
11. [Struktura projektu](#struktura-projektu)

---

## Architektura

```
PRODUKCE:
[Uživatel / Prohlížeč]
        │
        ▼
[Externý reverse proxy / nginx hostitele]   ← HTTPS terminace zde
        │
        ▼ :3000
[nginx proxy kontejner]
   ├── /api/*  →  [FastAPI backend :8000]  ←→  [PostgreSQL]
   └── /*      →  [React frontend :80]

LOKÁLNÍ VÝVOJ:
[Uživatel / Prohlížeč]
        │
        ▼
  [Vite dev server :3000]  ← proxy /api/* → backend:8000
        │
        ▼
[FastAPI backend :8000]  ←→  [SQLite]
```

### Technologický zásobník

| Vrstva | Technologie |
|--------|-------------|
| **Frontend** | React 19, Vite 6, TypeScript, Tailwind CSS, Recharts |
| **Backend** | FastAPI (Python 3.10+), SQLAlchemy 2, Alembic |
| **Databáze** | PostgreSQL 15+ (produkce) / SQLite (lokální vývoj) |
| **AI** | vLLM / OpenAI-compatible API (Qwen 2.5, DeepSeek) |
| **Exporty** | openpyxl (Excel .xlsx), fpdf2 (PDF) |
| **Kontejnery** | Docker, Docker Compose |

### Tok dat

1. Lektor nahraje ÚZ (PDF / DOCX / RTF)
2. Backend extrahuje text, AI identifikuje identitu studenta (fáze 1)
3. Požadavek vstoupí do asynchronní fronty `EvaluationQueue` izolované per `lecturer_id`
4. LLM vyhodnotí text oproti kritériím a vrátí strukturovaný JSON (fáze 2)
5. Výsledky se uloží do DB a real-time doručí výhradně danému lektorovi přes WebSocket
6. Deterministická Python analytika (bez LLM) agreguje výsledky celé třídy (fáze 3 — LLM pouze interpretuje hotová čísla)

---

## Požadavky

### Produkce
- Docker ≥ 24.0 a Docker Compose ≥ 2.20
- Přístup k LLM serveru (vLLM s OpenAI-compatible API)
- Min. 2 GB RAM pro backend kontejner

### Lokální vývoj
- Python 3.10+ (doporučeno 3.13+; vyžadováno pro union type syntax `X | None`)
- Node.js 20+
- SQLite (součástí Pythonu — bez další instalace)

---

## Rychlý start — lokální vývoj

### Backend

```bash
cd backend

# Virtuální prostředí
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Závislosti
pip install -r requirements.txt

# Nastavení prostředí pro lokální vývoj (SQLite)
cp .env.example .env
# Upravit .env: DATABASE_URL=sqlite:///./upvsp_evaluator.db
#               CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Spuštění — migrace proběhnou automaticky
python3 main.py
```

Backend poběží na `http://localhost:8000`.
Interaktivní API dokumentace: `http://localhost:8000/docs`

### Frontend

```bash
# V kořenovém adresáři projektu
npm install
npm run dev
```

Frontend poběží na `http://localhost:5173`.

---

## Produkční nasazení

### 1. Příprava prostředí

```bash
# Naklonuj repozitář
git clone https://github.com/HoubaLuk/EVALUZ.git
cd EVALUZ

# Zkopíruj šablonu a vyplň hodnoty
cp .env.example .env
nano .env
```

### 2. Spuštění produkčního stacku

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Aplikace bude dostupná na `http://<IP-serveru>:3000`.
Externý reverse proxy / nginx hostitele by měl směrovat HTTPS provoz na tento port.

### 3. Ověření nasazení

```bash
# Stav kontejnerů
docker compose -f docker-compose.prod.yml ps

# Health check — ověří i připojení k databázi
curl http://localhost:3000/api/v1/health
# Očekávaná odpověď: {"status":"healthy","db":"ok"}

# Logy backendu
docker logs evaluz_backend --tail 50 -f
```

### 4. Aktualizace na novou verzi

```bash
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
# Alembic migrace proběhnou automaticky při restartu backendu
```

> **Zamčené závislosti:** `backend/Dockerfile` instaluje z `backend/requirements.lock.txt`
> (přesné verze ověřené proti test suite v `python:3.10-slim`), ne z volného `requirements.txt`.
> Po přidání/změně balíčku v `requirements.txt` je nutné lock přegenerovat — postup je
> v hlavičce `requirements.lock.txt`. Bez toho `--build` prostě znovu použije zamčené verze
> z posledního commitu, i kdyby `requirements.txt` mezitím povolil novější verzi.

### Kontejnery a porty

| Kontejner | Interní port | Exponovaný | Popis |
|-----------|-------------|------------|-------|
| `evaluz_proxy` | 80 | **3000:80** | nginx — jediný vstupní bod zvenčí |
| `evaluz_backend` | 8000 | — | FastAPI, přístupný pouze přes proxy |
| `evaluz_frontend` | 80 | — | React SPA, přístupný pouze přes proxy |
| `evaluz_db` | 5432 | — | PostgreSQL, přístupný pouze interně |

> **Bezpečnost:** Backend ani Frontend nejsou přímo exponovány na hostitele.
> Veškerý provoz prochází přes `evaluz_proxy`.

### Přechod z verze před v4.0.0 (bez Alembicu)

Pokud existující databáze vznikla před tímto releasem (manuální migrace přes `run_migrations()`), spusť po prvním deployi jednorázově:

```bash
docker exec evaluz_backend alembic stamp head
```

Tím označíš aktuální schéma jako "head" bez opakovaného spouštění migrací.

---

## Proměnné prostředí

Všechny hodnoty nastavuj v souboru `.env` (nikdy necommituj do gitu — je v `.gitignore`).

```bash
# ── Databáze ─────────────────────────────────────────────────────────────────
# Produkce (PostgreSQL) — heslo musí odpovídat POSTGRES_PASSWORD
DATABASE_URL=postgresql://evaluz_admin:CHANGEME@db:5432/evaluz_db
POSTGRES_PASSWORD=CHANGEME

# Lokální vývoj (SQLite)
# DATABASE_URL=sqlite:///./upvsp_evaluator.db

# ── LLM server ───────────────────────────────────────────────────────────────
VLLM_API_URL=http://gpu-server:8000/v1
VLLM_MODEL_NAME=qwen2.5-32b-instruct

# ── CORS ─────────────────────────────────────────────────────────────────────
# Produkce: konkrétní doména (bez trailing slash)
# Více domén oddělených čárkou: https://a.cz,https://b.cz
# Lokální vývoj: http://localhost:5173,http://localhost:3000
CORS_ORIGINS=https://your-domain.com
```

Vzorový soubor se všemi možnostmi: [`.env.example`](.env.example)

---

## Databáze a migrace

EVALUZ používá **Alembic** pro verzované migrace schématu databáze.
Migrace se **spouštějí automaticky** při každém startu backendu — není nutný žádný ruční zásah.

### Ruční správa (pokročilé)

```bash
# Vstup do kontejneru
docker exec -it evaluz_backend bash

# Aktuální stav migrací
alembic current

# Historie všech migrací
alembic history --verbose

# Aplikovat všechny pending migrace (normálně automatické)
alembic upgrade head

# Vrátit poslední migraci
alembic downgrade -1
```

### Vytvoření nové migrace při vývoji

```bash
cd backend

# Generovat migraci z rozdílu SQLAlchemy modelů a DB
DATABASE_URL=sqlite:///./upvsp_evaluator.db \
  alembic revision --autogenerate -m "popis_zmeny"

# Zkontrolovat vygenerovaný soubor v alembic/versions/
# Aplikovat:
DATABASE_URL=sqlite:///./upvsp_evaluator.db alembic upgrade head
```

### Historie migrací

| Revize | Popis |
|--------|-------|
| `203eafd47370` | Baseline — kompletní schéma (11 tabulek) |
| `35e3a28e8797` | `created_at`: `VARCHAR` → `DateTime` (4 tabulky) |
| `03bbfb3db9b0` | JSON sloupce: `TEXT` → `JSONB` na PostgreSQL |
| `53fae6cde19e` | NOT NULL constraints + ClassAnalysis cache versioning |
| `b4e9f1a2c3d5` | `is_approved` na `student_evaluations` |
| `a1b2c3d4e5f6` | `scenario_display_name` na `student_evaluations` |

---

## Vzdušná instalace (Air-Gapped)

Pro nasazení v uzavřených sítích bez přístupu k internetu:

### Metoda A — Docker (doporučeno)

**Na stroji s internetem:**
```bash
docker compose -f docker-compose.prod.yml build

docker save -o evaluz_images.tar \
  evaluz-backend evaluz-frontend \
  nginx:1.25-alpine postgres:15-alpine
```

**Na cílovém serveru (offline):**
```bash
docker load -i evaluz_images.tar
cp .env.example .env && nano .env
docker compose -f docker-compose.prod.yml up -d
# Bez --build: obrazy jsou již načteny z archivu
```

### Metoda B — Ruční instalace

**Na stroji s internetem:**
```bash
# Backend — stáhnout závislosti offline
cd backend && mkdir vendor
pip download -d ./vendor -r requirements.txt

# Frontend — sestavit statické soubory
npm install && npm run build
# Výstup ve složce: dist/
```

**Na cílovém serveru:**
```bash
# Backend
pip install --no-index --find-links=./vendor -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend — zkopíruj dist/ a servíruj přes nginx nebo jiný HTTP server
```

---

## Role a přístupová práva

| Role | Co vidí a může dělat |
|------|----------------------|
| **Vyučující** | Pouze vlastní evaluace, kritéria a exporty — izolováno per `lecturer_id` |
| **Admin** | Přehled dat v rámci svého organizačního článku (`school_location`) |
| **SuperAdmin** | Globální přístup, správa lektorů, konfigurace LLM a systémových promptů |

RBAC je vynucen na úrovni databázových dotazů pomocí `apply_data_isolation()`.
Žádný lektor **nemůže vidět data jiného lektora** — ani přímým dotazem na API.

**První spuštění:** SuperAdmin účet se vytvoří seedem automaticky při startu.
Přihlašovací údaje jsou nastaveny v `backend/core/seeder.py`. Změna hesla je vyžadována při prvním přihlášení.

---

## Bezpečnost

| Oblast | Implementace |
|--------|-------------|
| **Autentizace** | JWT Bearer tokeny na všech API endpointech (kromě `/login`) |
| **Hesla** | bcrypt hash — nikdy uložena v plaintextu |
| **CORS** | Konfigurovatelné přes `CORS_ORIGINS` v `.env` — v produkci nastavit na konkrétní doménu |
| **Data isolation** | DB-level filtrování per `lecturer_id` na každém endpointu |
| **Kaskádové mazání** | Smazání lektora odstraní všechna jeho data (`ondelete="CASCADE"`) |
| **DB constraints** | NOT NULL na kritických sloupcích, FK integrita |
| **Síťová izolace** | Backend/Frontend nejsou exponovány přímo — pouze přes nginx proxy |
| **HDD Sync** | Vyžaduje Secure Context (HTTPS nebo localhost); na HTTP je blokováno prohlížečem |
| **Prompt Injection** | Text studenta je modelu předán jako čistá datová proměnná, oddělená od systémového promptu |

---

## Přehled API

Interaktivní dokumentace (Swagger UI): `http://localhost:8000/docs`
Alternativní dokumentace (ReDoc): `http://localhost:8000/redoc`

```
# Autentizace
POST   /api/v1/auth/login              Přihlášení → JWT token

# Evaluace
POST   /api/v1/evaluate/upload         Nahrání ÚZ, spuštění AI evaluace
POST   /api/v1/evaluate/fast-scan      Hromadné zpracování dávky souborů

# Analytika
GET    /api/v1/analytics/list          Seznam evaluací pro třídu/scénář
GET    /api/v1/analytics/class         Třídní analýza (s cache)
PATCH  /api/v1/analytics/{id}          Manuální korekce výsledku lektorem

# Kritéria
GET    /api/v1/criteria/               Seznam kritérií lektora
POST   /api/v1/criteria/               Vytvoření/aktualizace kritérií

# Exporty
GET    /api/v1/export/pdf/{id}         PDF report pro studenta
GET    /api/v1/export/class-pdf/{id}   PDF report celé třídy
GET    /api/v1/export/excel/{id}       Excel export třídy

# Statistiky (Admin/SuperAdmin)
GET    /api/v1/statistics/dashboard    Přehled využití napříč organizací
GET    /api/v1/statistics/export/excel Excel export statistik

# Systém
GET    /api/v1/health                  Health check — ověří i DB připojení
WS     /ws/{lecturer_id}               WebSocket — real-time průběh evaluace
```

---

## Struktura projektu

```
EVALUZ/
├── backend/
│   ├── alembic/               # Alembic konfigurace a migrace
│   │   └── versions/          # Migrační skripty (verzované)
│   ├── api/                   # FastAPI routery
│   │   ├── auth.py            # JWT autentizace, RBAC helpers
│   │   ├── evaluate.py        # Evaluace ÚZ (upload, fast-scan)
│   │   ├── analytics.py       # Třídní analytika, korekce
│   │   ├── export.py          # PDF a Excel exporty
│   │   ├── criteria.py        # Správa hodnotících kritérií
│   │   ├── admin.py           # Administrace (lektoři, nastavení)
│   │   └── statistics.py      # Dashboard statistik
│   ├── core/
│   │   ├── config.py          # Konfigurace (pydantic-settings)
│   │   └── database.py        # SQLAlchemy engine, Alembic init_db()
│   ├── models/
│   │   ├── db_models.py       # SQLAlchemy modely
│   │   └── types.py           # JSONType (JSONB/TEXT TypeDecorator)
│   ├── services/
│   │   ├── llm_engine.py      # vLLM integrace, prompt engineering
│   │   ├── analytics.py       # Deterministická třídní analytika
│   │   ├── pdf_generator.py   # PDF generátor (fpdf2)
│   │   └── evaluation_queue.py # Asynchronní fronta evaluací
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py                # Vstupní bod, CORS, router registrace
├── src/                       # React frontend (TypeScript)
│   ├── components/            # UI komponenty
│   ├── contexts/              # React Context (auth, stav)
│   └── utils/                 # Pomocné funkce
├── nginx/
│   └── evaluz.conf            # nginx reverse proxy konfigurace
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions CI pipeline
├── docs/
│   ├── ARCHITECTURE.md        # Architekturní přehled
│   ├── CHANGELOG.md           # Historie změn
│   └── TECHNICAL_DOCUMENTATION.md
├── docker-compose.yml         # Vývojový stack
├── docker-compose.prod.yml    # Produkční stack (nginx proxy)
├── Dockerfile                 # Frontend multistage build
├── .env.example               # Šablona proměnných prostředí
└── README.md
```

---

*EVALUZ — Vyvinuto na ÚPVSP. Verze 3.12.0.*
