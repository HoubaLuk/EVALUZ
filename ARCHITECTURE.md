# EVALUZ — Technická architektura a dokumentace

> **Upozornění:** Tento soubor je archivní snímek z verze 3.8.7 (23. 4. 2026).  
> Aktuální a autoritativní dokumentace je v **[docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md)** (v3.10.5).  
> Historie rozhodnutí: [docs/CHANGELOG.md](docs/CHANGELOG.md) | [.memory/decisions.md](.memory/decisions.md)

**Verze systému (archiv):** 3.8.7  
**Datum dokumentace (archiv):** 23. 4. 2026  
**Provozovatel:** ÚPVSP (Útvar policejního vzdělávání a služební přípravy)

---

## Obsah

1. [Přehled systému](#1-přehled-systému)
2. [Architektura komponent](#2-architektura-komponent)
3. [Docker Compose a deployment](#3-docker-compose-a-deployment)
4. [Datový tok](#4-datový-tok)
5. [Backend — struktura modulů](#5-backend--struktura-modulů)
6. [API endpointy](#6-api-endpointy)
7. [Databázové schéma](#7-databázové-schéma)
8. [AI pipeline — klíčová sekce](#8-ai-pipeline--klíčová-sekce)
9. [Frontend — struktura a workflow](#9-frontend--struktura-a-workflow)
10. [Konfigurace a AppSettings](#10-konfigurace-a-appsettings)
11. [Bezpečnost](#11-bezpečnost)
12. [Decision Log (ADR)](#12-decision-log-adr)

---

## 1. Přehled systému

EVALUZ je webová aplikace pro **automatizované vyhodnocování policejních úředních záznamů (ÚZ)** pomocí lokálně provozovaného LLM. Lektor nahraje soubory PDF/DOCX/RTF se studentskými záznamy, systém je AI automaticky ohodnotí dle předem definovaných kritérií a vygeneruje hodnotící listy v PDF nebo Excel.

**Klíčové vlastnosti:**
- Tří-fázový workflow: tvorba kritérií → evaluace → analytika
- Provoz výhradně v uzavřené síti HERMES (bez internetu) na GPU serveru ÚPVSP
- Multi-tenant: každý lektor vidí pouze vlastní data (RBAC s rolemi Vyučující / Admin / SuperAdmin)
- Man-in-the-Loop: lektor musí schválit každé AI hodnocení před jeho zahrnutím do analytiky
- Export do PDF (individuální hodnotící listy) a Excel (třídní protokoly)

---

## 2. Architektura komponent

```
┌─────────────────────────────────────────────────────────────────┐
│  Klient (prohlížeč — HERMES síť)                                │
│  React SPA (Vite + TypeScript)                                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS (přes HAProxy / nginx hostitele)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Docker Host (GPU Server ÚPVSP — NVIDIA L40S)                   │
│                                                                  │
│  ┌──────────────┐   HTTP /api/  ┌───────────────────────────┐   │
│  │  nginx       │──────────────▶│  FastAPI backend          │   │
│  │  (frontend   │               │  Python 3.13 / Uvicorn    │   │
│  │   + proxy)   │               │  port 8000 (interní)      │   │
│  │  port 8001   │               └───────────┬───────────────┘   │
│  │  port 8443   │                           │                   │
│  └──────────────┘               ┌───────────▼───────────────┐   │
│                                 │  PostgreSQL 15             │   │
│                                 │  (evaluz_db)              │   │
│                                 └───────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  vLLM server  (mimo Docker Compose — samostatný proces)  │   │
│  │  model: qwen3-30b-fp8 na NVIDIA L40S                     │   │
│  │  port 8001/v1  (OpenAI-compatible API)                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Vzájemné vztahy:**
- `nginx` (frontend container) přijímá veškerý provoz zvenčí a routuje: `/api/*` → backend, `/` → React SPA
- `backend` nikdy neposlouchá navenek — přístupný pouze přes nginx proxy
- `db` (PostgreSQL) dostupná pouze pro backend (Docker interní síť)
- vLLM server běží mimo Docker Compose, backend se k němu připojuje přes HTTP na konfigurovanou URL

---

## 3. Docker Compose a deployment

Soubor: `/docker-compose.yml`

### Služby

| Služba | Obraz | Port (host) | Účel |
|--------|-------|-------------|------|
| `db` | `postgres:15-alpine` | 5432 | PostgreSQL databáze |
| `backend` | vlastní Dockerfile | - (pouze interně) | FastAPI API server |
| `frontend` | vlastní Dockerfile | 8001 (HTTP), 8443 (HTTPS) | nginx + React SPA |

### Spuštění

```bash
# Produkce
docker compose up -d

# S vlastní DB heslem
POSTGRES_PASSWORD=MojeHeslo docker compose up -d
```

### Pořadí startu

`db` (healthcheck `pg_isready`) → `backend` → `frontend`

Backend při startu provede:
1. Alembic migrace (`alembic upgrade head` v Dockerfile CMD)
2. Seed výchozích dat (prompty, AppSettings) — viz `backend/core/seeder.py`
3. Spuštění async evaluation workeru (`eval_queue.worker`)

### Nginx konfigurace

Soubor: `/nginx/evaluz.conf`

```
/api/*      → backend:8000  (FastAPI, timeout 300s pro AI operace)
/api/v1/evaluate/ws  → backend:8000  (WebSocket upgrade)
/           → frontend:80   (React SPA, SPA fallback na index.html)
```

- Upload limit: 15 MB (aplikačně omezeno na 10 MB)
- Bezpečnostní hlavičky: `X-Content-Type-Options`, `X-Frame-Options`, `CSP`, `Permissions-Policy`
- Real IP forwarding z HAProxy/nginx hostitele

---

## 4. Datový tok

### Fáze 1: Nahrání souborů → Fast-Scan

```
Lektor vybere PDF/DOCX/RTF soubory
        ↓
POST /api/v1/evaluate/fast-scan (multipart/form-data)
        ↓
doc_parser.extract_text() → _cleanup_text()
        ↓
security_scanner.scan_text()  ← bezpečnostní audit vstupu
        ↓
llm_engine.extract_identity()  ← LLM extrahuje jméno z konce dokumentu
        ↓
DB INSERT StudentEvaluation (source_text, cleaned_name, student_identity)
        ↓
WebSocket → EVAL_START (real-time notifikace do UI)
        ↓
Frontend zobrazí seznam studentů s extrahovanými jmény
```

### Fáze 2: AI evaluace (batch)

```
Lektor klikne "Spustit vyhodnocení"
        ↓
POST /api/v1/evaluate/batch  → vrátí 202 Accepted
        ↓
eval_queue.add_task() — úkoly do asyncio.Queue
        ↓
eval_queue.worker() — Semaphore(concurrency) paralelní zpracování
        ↓
  pro každý soubor:
    llm_engine.evaluate_report()
      ↓
    _split_criteria_chunks()  — rozdělení kritérií na chunky po 6
      ↓
    asyncio.gather(*tasks)  — paralelní posílání chunků do vLLM
      ↓
    vLLM continuous batching  — GPU zpracuje všechny requesty najednou
      ↓
    _merge_chunk_results()  — sloučení výsledků chunků
      ↓
    _generate_individual_feedback()  — samostatné LLM volání pro zpětnou vazbu studenta
        ↓
DB UPDATE StudentEvaluation.json_result
        ↓
WebSocket → EVAL_SUCCESS / EVAL_ERROR
```

### Fáze 3: Analytika

```
Lektor klikne "Zobrazit analytiku"
        ↓
GET /api/v1/analytics/class/{class_id}/summary?scenario_id=...
        ↓
Kontrola: všechna hodnocení musí být is_approved=True (Man-in-the-Loop)
        ↓
Cache check: ClassAnalysis v DB (invaliduje se při editaci hodnocení)
        ↓
analytics_service.generate_class_summary()
  - agregace skóre per kritérium
  - výpočet úspěšnosti (%)
  - sestavení kontextu pro LLM (Phase 3 prompt)
        ↓
llm_engine.chat_completion()  — AI pedagogický vhled
        ↓
DB UPSERT ClassAnalysis.content_json
        ↓
Frontend zobrazí grafy + AI shrnutí + export tlačítka
```

---

## 5. Backend — struktura modulů

```
backend/
├── main.py                  # FastAPI aplikace, middleware, routery, lifespan
├── __version__.py           # Centralizovaná verze ("3.8.7")
├── alembic/                 # DB migrace
├── alembic.ini
│
├── api/                     # HTTP endpointy (FastAPI routery)
│   ├── auth.py              # Autentizace (JWT), RBAC, registrace
│   ├── evaluate.py          # Nahrávání, fast-scan, batch evaluace, WebSocket
│   ├── criteria.py          # CRUD kritérií, AI asistent (Phase 1 chat)
│   ├── analytics.py         # Čtení výsledků, třídní analytika, approve
│   ├── admin.py             # SuperAdmin: prompty, AppSettings, správa uživatelů
│   ├── export.py            # PDF/Excel export (student/třída/dashboard)
│   └── statistics.py        # Dashboard statistik pro Admin/SuperAdmin
│
├── core/
│   ├── config.py            # Pydantic Settings (.env → Settings objekt)
│   ├── database.py          # SQLAlchemy engine, SessionLocal, init_db
│   ├── security.py          # bcrypt hash, JWT create/verify
│   ├── seeder.py            # Seed výchozích promptů a AppSettings
│   └── logging_config.py    # Strukturované logování (JSON v produkci)
│
├── models/
│   ├── db_models.py         # SQLAlchemy ORM modely (viz sekce 7)
│   ├── evaluation.py        # Pydantic response modely (EvaluationResponse)
│   └── types.py             # JSONType (TEXT/JSONB kompatibilní typ)
│
├── services/
│   ├── llm_engine.py        # AI jádro: evaluace, identity extraction, chat
│   ├── doc_parser.py        # PDF/DOCX/RTF → čistý text
│   ├── pdf_generator.py     # Export: student PDF, třídní PDF, Excel
│   ├── analytics.py         # Agregace statistik + Phase 3 AI insight
│   ├── criteria_service.py  # Parsování markdown kritérií → Criterion záznamy
│   ├── evaluation_queue.py  # asyncio.Queue + WebSocket broadcaster
│   └── security_scanner.py  # Bezpečnostní audit vstupního textu
│
├── utils/
│   └── sorting.py           # Řazení evaluací dle příjmení
│
└── static/
    └── fonts/               # DejaVuSans TTF fonty (česká diakritika v PDF)
```

---

## 6. API endpointy

Všechny endpointy jsou pod prefixem `/api/v1`.

### Auth (`/auth`)

| Metoda | Cesta | Popis |
|--------|-------|-------|
| GET | `/auth/check` | Vrátí `needs_setup: true` pokud je DB prázdná |
| POST | `/auth/setup` | Vytvoří první SuperAdmin účet (jednou) |
| POST | `/auth/login` | JSON login, vrátí JWT Bearer token |
| GET | `/auth/me` | Profil přihlášeného lektora |
| PUT | `/auth/me` | Aktualizace profilu |
| PUT | `/auth/password` | Změna hesla |
| POST | `/auth/register` | Veřejná registrace (role: Vyučující) |
| GET | `/auth/school-locations` | Seznam org. článků z AppSettings |

### Evaluate (`/evaluate`)

| Metoda | Cesta | Popis |
|--------|-------|-------|
| WS | `/evaluate/ws?lecturer_id=N` | WebSocket pro real-time stav evaluace |
| POST | `/evaluate/fast-scan` | Rychlá extrakce jmen z nahraných souborů |
| POST | `/evaluate/batch` | Spuštění AI evaluace (202 Accepted, async) |
| DELETE | `/evaluate/batch` | Zastavení fronty (zrušení čekajících úkolů) |
| POST | `/evaluate/classes/ensure` | Vytvoří třídu pokud neexistuje (idempotentní) |
| POST | `/evaluate/golden-example` | Uloží vzorový ÚZ do RAG paměti (je-li povolen) |

### Criteria (`/criteria`)

| Metoda | Cesta | Popis |
|--------|-------|-------|
| POST | `/criteria/chat` | AI konverzace pro tvorbu kritérií (Phase 1) |
| GET | `/criteria/{scenario_id}` | Načte kritéria pro daný scénář |
| POST | `/criteria/save` | Uloží kritéria a rozparsuje je do tabulky `criteria` |
| POST | `/criteria/extract-context` | Vytěží text z nahraného souboru metodiky |

### Analytics (`/analytics`)

| Metoda | Cesta | Popis |
|--------|-------|-------|
| GET | `/analytics/class/{class_id}` | Všechna hodnocení pro třídu (volitelně filtr scénáře) |
| GET | `/analytics/class/{class_id}/summary` | Agregovaná analytika + AI insight (Phase 3) |
| GET | `/analytics/class/{class_id}/status` | Které scénáře mají hotovou analýzu |
| DELETE | `/analytics/evaluation/{id}` | Smazání záznamu |
| PATCH | `/analytics/evaluation/{id}/score` | Manuální korekce výsledků (invaliduje cache) |
| PATCH | `/analytics/evaluation/{id}/approve` | Schválení / zrušení schválení (Man-in-the-Loop) |
| PATCH | `/analytics/evaluation/{id}/name` | Ruční oprava jména studenta |

### Export (`/export`)

| Metoda | Cesta | Popis |
|--------|-------|-------|
| GET | `/export/student/by-name/{name}/pdf` | PDF hodnotící list studenta |
| GET | `/export/class/{class_id}/excel` | Excel protokol třídy (4 listy) |
| GET | `/export/class/{class_id}/pdf` | PDF protokol třídy s AI insightem |

### Admin (`/admin`) — pouze SuperAdmin

| Metoda | Cesta | Popis |
|--------|-------|-------|
| GET/PUT | `/admin/prompts` | Správa systémových promptů |
| GET/PUT | `/admin/settings` | Správa AppSettings (LLM konfigurace) |
| POST | `/admin/test-llm` | Test připojení k LLM provideru |
| GET/POST | `/admin/users` | Správa uživatelů |
| PUT | `/admin/users/{id}/toggle-active` | Aktivace/deaktivace účtu |
| PUT | `/admin/users/{id}/role` | Změna role |
| PUT | `/admin/users/{id}/reset-password` | Reset hesla |

### Statistics (`/statistics`) — Admin + SuperAdmin

| Metoda | Cesta | Popis |
|--------|-------|-------|
| GET | `/statistics/filter-options` | Dostupné filtry (útvary, třídy, scénáře) |
| GET | `/statistics/dashboard` | Agregované statistiky využití (RBAC filtr) |
| GET | `/statistics/export/excel` | Excel export dashboard statistik |

---

## 7. Databázové schéma

Soubor: `backend/models/db_models.py`

```
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│   lecturers     │    │  evaluation_criteria  │    │    criteria     │
├─────────────────┤    ├──────────────────────┤    ├─────────────────┤
│ id (PK)         │───▶│ id (PK)              │───▶│ id (PK)         │
│ email (unique)  │    │ lecturer_id (FK)     │    │ eval_crit_id FK │
│ password_hash   │    │ scenario_name        │    │ nazev           │
│ title_before    │    │ markdown_content     │    │ popis           │
│ first_name      │    └──────────────────────┘    │ body (int)      │
│ last_name       │                                └─────────────────┘
│ title_after     │    ┌──────────────────────┐
│ rank_shortcut   │    │  student_evaluations  │
│ rank_full       │    ├──────────────────────┤
│ school_location │───▶│ id (PK)              │
│ funkcni_zarazeni│    │ lecturer_id (FK)     │
│ is_superadmin   │    │ student_name         │
│ is_admin        │    │ class_id (FK)        │
│ is_active       │    │ scenario_name        │
│ must_change_pw  │    │ scenario_display_name│
└─────────────────┘    │ json_result (JSON)   │
                       │ cleaned_name         │
┌─────────────────┐    │ student_identity JSON│
│    classes      │    │ source_text (Text)   │
├─────────────────┤    │ source_filename      │
│ id (PK)         │───▶│ created_at           │
│ lecturer_id FK  │    │ is_approved (bool)   │
│ name            │    └──────────────────────┘
└─────────────────┘
                       ┌──────────────────────┐
┌─────────────────┐    │   class_analyses     │
│  system_prompts │    ├──────────────────────┤
├─────────────────┤    │ id (PK)              │
│ id (PK)         │    │ lecturer_id (FK)     │
│ phase_name      │    │ class_id (FK)        │
│ content (Text)  │    │ scenario_id          │
│ temperature     │    │ content_json (JSON)  │
└─────────────────┘    │ created_at           │
                       │ computed_at          │
┌─────────────────┐    │ version              │
│  app_settings   │    └──────────────────────┘
├─────────────────┤
│ id (PK)         │    ┌──────────────────────┐
│ key (unique)    │    │   export_history     │
│ value (String)  │    ├──────────────────────┤
└─────────────────┘    │ id, user_id, type... │
                       └──────────────────────┘
                       ┌──────────────────────┐
                       │   golden_examples    │
                       ├──────────────────────┤
                       │ id, lecturer_id,     │
                       │ scenario_id,         │
                       │ source_text,         │
                       │ perfect_json (JSON)  │
                       └──────────────────────┘
```

### Klíčové vztahy

- `evaluation_criteria.lecturer_id` + `scenario_name` — každý lektor má vlastní sadu kritérií per scénář
- `student_evaluations.is_approved` — příznak Man-in-the-Loop; neschválené záznamy blokují analytiku
- `class_analyses` — cache AI analytiky; invaliduje se při `PATCH /score` nebo `PATCH /approve`
- `app_settings` — runtime konfigurace LLM bez nutnosti restartu (klíč-hodnota store)

---

## 8. AI pipeline — klíčová sekce

Soubor: `backend/services/llm_engine.py`

### 8.1 Funkce a jejich role

| Funkce | Vstup | Výstup | Účel |
|--------|-------|--------|------|
| `evaluate_report()` | text ÚZ, kritéria MD, system prompt | dict s `vysledky` | Hlavní evaluace (Phase 2) |
| `extract_identity()` | text ÚZ | dict `{hodnost, jmeno, prijmeni}` | Fast-scan extrakce jména |
| `chat_completion()` | seznam zpráv, system prompt | string | Phase 1 (tvorba kritérií) a Phase 3 (analytika) |
| `_split_criteria_chunks()` | markdown kritérií, chunk_size=6 | list[str] | Chunking pro přetečení kontextu |
| `_evaluate_chunk()` | chunk kritérií + text ÚZ | partial dict | Vyhodnocení jednoho chunku (s retry) |
| `_generate_individual_feedback()` | merged dict, db, client, ... | string | Individuální zpětná vazba pro studenta (Phase 2b) |
| `_merge_chunk_results()` | list[dict] | sloučený dict | Merge výsledků ze všech chunků |
| `_repair_truncated_json()` | raw string | dict nebo None | Recovery při oříznutém JSON |
| `_llm_call_with_overflow_retry()` | kwargs, client | response | Retry při HTTP 400 context overflow |
| `_resolve_platform()` | platform, api_url | string | URL má přednost před nastavenou platformou |
| `_build_llm_kwargs()` | platform, enable_thinking, ... | dict | Platform-specifické extra parametry |

### 8.2 Chunking kritérií

**Problém:** Model qwen3-30b-fp8 má context window 16 384 tokenů. Při 25 kritériích × průměrný popis + text ÚZ (typicky 1–2 strany) dojde k přetečení.

**Řešení:** Funkce `_split_criteria_chunks()` rozdělí kritéria na skupiny po max. 6.

```python
CHUNK_SIZE = 6
chunks = _split_criteria_chunks(criteria_markdown, CHUNK_SIZE)
# 25 kritérií → 5 chunků: [K1-K6, K7-K12, K13-K18, K19-K24, K25]
```

**Primární strategie — regex lookahead na hlavičku kritéria:**
```python
parts = re.split(r'\n+(?=\*\*\d+\.\s*Kritérium)', criteria_markdown)
```
Lookahead `(?=...)` zachovává hlavičku `**N. Kritérium` v pravé části splitu, takže každý chunk začíná svou vlastní hlavičkou. Tato strategie je robustní vůči nekonzistentnímu formátování oddělovačů `---`.

**Fallback:** Pokud regex nenajde žádná kritéria ve formátu `**N. Kritérium`, použije se split na prázdné řádky (starší formát).

**Chunky jsou znovu spojeny oddělovačem `\n\n---\n\n`** pro přehlednost v promptu.

### 8.3 Paralelizace chunků

```python
tasks = [
    _evaluate_chunk(client, chunk, report_text, ...)
    for i, chunk in enumerate(chunks)
]
chunk_results = await asyncio.gather(*tasks)
```

`asyncio.gather()` odešle všechny chunky současně do vLLM serveru. vLLM continuous batching zpracuje tyto requesty jako jednu dávku na GPU — maximální využití NVIDIA L40S.

**Příklad:** 3 studenti × 5 chunků = 15 paralelních requestů zpracovaných v jedné GPU dávce.

### 8.4 Adaptivní max_tokens

**Problém:** Globální `max_tokens=6144` způsoboval verbose anomálie — model psal odůvodnění na 14 000 znaků, inference trvala 66 s a JSON byl oříznut.

**Řešení:** Pro každý chunk se vypočítá adaptivní limit:

```python
n_criteria = len(re.findall(r'\*\*\d+\.\s*Kritérium', chunk_criteria))
chunk_max_tokens = min(max_tokens, n_criteria * 500 + 300)
# Pro 6 kritérií: min(6144, 6*500+300) = min(6144, 3300) = 3300 tokenů
# Pro 4 kritéria: min(6144, 4*500+300) = min(6144, 2300) = 2300 tokenů
```

- `500 tokenů/kritérium` — empiricky kalibrováno pro českou diakritiku (~1,5–1,7 zn/token vs. původně předpokládaných 2,5 zn/token). Původní hodnota 350 způsobovala truncation u obsáhlejších ÚZ (dialog, právní citace).
- `+300` — overhead pro identitu, JSON strukturu a closing brackets
- `min(global_max, ...)` — nikdy nepřekročí globální limit nastavený v Administraci

### 8.5 JSON resilience

**`_repair_truncated_json(text)`** — recovery při oříznutí výstupu tokenovým limitem:
1. Najde `"vysledky": [` v surové odpovědi
2. Iteruje znaky a sbírá kompletní `{...}` objekty (sleduje hloubku závorek)
3. Pokusí se extrahovat `"identita"` z dostupného textu
4. Sestaví validní JSON z nalezených kompletních záznamů
5. Přidá zprávu `[Odpověď modelu byla zkrácena tokenovým limitem — obnoveno N kritérií]`

**`_llm_call_with_overflow_retry(client, kwargs, prefix)`** — retry při context overflow:
```
HTTP 400 "maximum context length exceeded"
  → parsuje "limit is X ... Y in the messages"
  → safe_tokens = max(512, limit - input_tokens - 300)
  → retry s redukovaným max_tokens
```

**Čištění think bloků:** Modely Qwen a DeepSeek píší interní reasoning do `<think>...</think>` nebo `<thought>...</thought>`. Před parsováním JSON se tyto bloky odstraní:
```python
clean_text = re.sub(r"<(think|thought)>.*?(</\1>|$)", "", raw, flags=re.DOTALL|re.IGNORECASE)
```

**JSON extrakce:** Po vyčištění se najde první `{` a poslední `}` — odstraní balast okolo (prose, markdown code fences):
```python
start_idx = clean_text.find('{')
end_idx = clean_text.rfind('}')
clean_response = clean_text[start_idx:end_idx + 1]
```

### 8.6 Platform abstrakce

Systém podporuje více LLM providerů přes OpenAI-compatible API. Funkce `_resolve_platform()` detekuje platformu z URL (URL má přednost před nastavením):

| Platforma | URL vzor | Extra params |
|-----------|----------|--------------|
| `vllm` | lokální (výchozí) | `extra_body: {enable_thinking, chat_template_kwargs}`, JSON mode |
| `ollama` | lokální | `extra_body: {num_ctx: context_window}` |
| `openrouter` | `openrouter.ai` v URL | bez extra params, normalizace na `/api/v1` |
| `openai` | `openai.com` v URL | JSON mode |
| `lmstudio` | jiné | bez extra params |

### 8.7 Per-phase model konfigurace

Každá fáze může používat jiný model a nastavení thinking:

```
MODEL_PHASE1        → model pro tvorbu kritérií (Phase 1 chat)
THINKING_PHASE1     → thinking on/off pro Phase 1
MODEL_PHASE2        → model pro evaluaci ÚZ (Phase 2 + Phase 2b zpětná vazba)
THINKING_PHASE2     → thinking on/off pro Phase 2
MODEL_EXTRACTION    → model pro fast-scan extrakci identity
THINKING_EXTRACTION → thinking on/off pro extraction
VLLM_MODEL_NAME     → globální fallback pro všechny fáze
VLLM_ENABLE_THINKING → globální fallback thinking
```

Lookup priority: Phase-specific → Global fallback.

**Phase 2b (individuální zpětná vazba)** sdílí model a nastavení Phase 2. Prompt se načítá samostatně z tabulky `system_prompts` (`phase_name='prompt_feedback'`), teplota z jeho záznamu (výchozí 0,5), `max_tokens=600`.

### 8.8 Parsování dokumentů

Soubor: `backend/services/doc_parser.py`

**`extract_text(file_bytes, filename)`** — dispatch dle přípony:

| Přípona | Knihovna | Poznámka |
|---------|----------|----------|
| `.docx` | `python-docx` | Iterace `doc.paragraphs` |
| `.pdf` | `PyMuPDF (fitz)` | `page.get_text("text")` — plain text bez souřadnic |
| `.rtf` | `striprtf` | Dekódování UTF-8 + rtf_to_text |
| `.txt`, `.csv`, `.md`, `.html` | built-in | UTF-8 decode |

**`_cleanup_text(text)`** — sdílené čištění pro všechny formáty:
1. Řídící znaky C0 oblasti (0x00–0x1F) kromě `\t`, `\n`, `\r`
2. Tabulátor → mezera, trailing whitespace
3. **Dekorativní letter-spacing** — PDF artefakt: `"Ú ř e d n í z á z n a m"` (nadpisy renderované s mezerou mezi každým znakem). Detekce: řádek s ≥4 tokeny, kde každý token má délku 1 → řádek se přeskočí
4. Vícenásobné mezery uvnitř řádku → jedna mezera
5. Maximálně jeden prázdný řádek (normalizace odstavců)

---

## 9. Frontend — struktura a workflow

Stack: **React 18 + TypeScript + Vite + SCSS**. SPA bez routeru — navigace přes tab state.

### 9.1 Struktura komponent

```
src/
├── App.tsx                  # Root: autentizace, globální stav, layout
├── main.tsx                 # React DOM render
├── types.ts                 # TypeScript typy (Tab, ClassData, ScenarioData...)
├── data.ts                  # DEFAULT_CLASS_DATA (výchozí třídy a scénáře)
│
├── components/
│   ├── Header.tsx           # Horní lišta: logo, stepper (3 fáze), uživatel
│   ├── Sidebar.tsx          # Levý panel: výběr třídy a scénáře
│   ├── TabCriteria.tsx      # Fáze 1: chat + editor kritérií
│   ├── TabEvaluation.tsx    # Fáze 2: nahrávání, seznam studentů, detaily
│   ├── TabAnalytics.tsx     # Fáze 3: grafy, AI insight, export
│   ├── TabMonitor.tsx       # Dashboard statistik (Admin/SuperAdmin)
│   ├── AdminModal.tsx       # Modální okno Administrace (SuperAdmin)
│   ├── ProfileModal.tsx     # Modální okno profilu lektora
│   └── Icon.tsx             # Wrapper pro FontAwesome ikony
│
├── contexts/
│   └── DialogContext.tsx    # Global dialog/alert kontext
│
├── utils/
│   └── api.ts               # API_BASE_URL konstanta
│
└── styles/
    ├── main.scss            # Import všech dílčích stylů
    ├── base/                # Reset, typografie, CSS proměnné
    ├── components/          # Styly komponent (card, btn, badge, table...)
    └── layouts/             # Layouty (main-layout, sidebar, header)
```

### 9.2 Tří-fázový workflow

**Fáze 1 — Tvorba kritérií (`TabCriteria`)**
- Dvoupanelový layout: levý = AI chat, pravý = live preview kritérií
- AI asistent (Phase 1 prompt) vede lektora Sokratovskou metodou: klade doplňující otázky a automaticky generuje návrh kritérií pod oddělovačem `---`
- Lektor může nahrát soubor metodiky (PDF/DOCX/RTF) — text se extrahuje a přidá do kontextu konverzace
- Po schválení návrhu lektor klikne "Uložit kritéria" → `POST /criteria/save` → backend kritéria rozparsuje a uloží do tabulky `criteria`
- Header Stepper zobrazí fázi 1 jako dokončenou (zlatá fajfka) po úspěšném uložení

**Fáze 2 — Evaluace (`TabEvaluation`)**
- Drag & drop nebo výběr souborů (PDF/DOCX/RTF)
- Po výběru automaticky spustí Fast-Scan (WS spojení → real-time progress)
- Seznam studentů se zobrazí okamžitě po fast-scanu s extrahovanými jmény
- Tlačítko "Spustit vyhodnocení" → POST /evaluate/batch → 202 Accepted
- WebSocket (`/evaluate/ws`) zobrazuje real-time stav (zelená/červená ikona per student)
- Detailní výsledky: tabulka kritérií, odůvodnění, citace, celkové skóre
- Manuální korekce skóre, oprava jména, schválení/zrušení schválení
- Po schválení zobrazena individuální zpětná vazba vygenerovaná samostatným LLM voláním (Phase 2b)
- Tlačítko ↑ (scroll-to-top) vedle tlačítka "Vyhodnocení schváleno" — lektor se jedním klikem vrátí na seznam studentů pro přechod na další hodnocení
- Export PDF individuálního hodnotícího listu

**Fáze 3 — Analytika (`TabAnalytics`)**
- Podmínka vstupu: všechna hodnocení musí mít `is_approved=true`
- Zobrazí agregované statistiky: průměrné skóre, histogram, úspěšnost per kritérium (heatmapa)
- Tlačítko "Generovat AI insight" → POST /analytics/class/{id}/summary
- AI pedagogické shrnutí (Phase 3 prompt): zhodnocení, nejčastější chyby, doporučení
- Export: PDF protokol třídy, Excel (4 listy: Souhrn, Výsledky, Analýza s grafem, Metodika)

### 9.3 Autentizace a stavy

```
CHECKING → RECOGNIZED_EMPTY_DB  → Setup wizard (AdminModal)
         → LOGIN_REQUIRED        → Přihlašovací formulář
         → AUTHENTICATED         → Hlavní aplikace
         → FORCE_PASSWORD_CHANGE → Vynucená změna hesla
```

JWT token se ukládá do `localStorage` pod klíčem `upvsp_token`. Každý API request přidá `Authorization: Bearer <token>`.

### 9.4 Vizuální standard NCIKT v1.1

Frontend implementuje závazný vizuální standard NCIKT (Národní centrum informatiky a komunikačních technologií):
- **Barevná paleta:** Primární `#0F527D` (modrá PČR), `#E6A800` (zlatá EVALUZ), slate grays
- **Typografie:** Systémový font stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`)
- **Komponenty:** `.card`, `.btn`, `.badge`, `.alert`, `.form-group`, `.table` — BEM-like CSS třídy
- **Layouty:** `.main-layout` (flex column), `.content-area` (sidebar + main), `.card__header--primary/warning/positive`
- **Responzivita:** Mobilní menu (hamburger), sidebar overlay

---

## 10. Konfigurace a AppSettings

### 10.1 Prostředí (.env / Docker environment)

| Proměnná | Výchozí | Popis |
|----------|---------|-------|
| `DATABASE_URL` | `sqlite:///./upvsp_evaluator.db` | Produkce: `postgresql://...` |
| `VLLM_API_URL` | `""` | Počáteční hodnota seedovaná do AppSettings |
| `VLLM_MODEL_NAME` | `""` | Počáteční hodnota seedovaná do AppSettings |
| `JWT_SECRET_KEY` | `CHANGE_ME...` | **Povinné** změnit v produkci: `openssl rand -hex 32` |
| `APP_ENV` | `dev` | `dev` nebo `production` |
| `CORS_ORIGINS` | `*` | V produkci musí být konkrétní doména(y) |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |

Validátor odmítne spuštění v produkci s výchozím `JWT_SECRET_KEY` nebo `CORS_ORIGINS=*`.

### 10.2 AppSettings v databázi

Klíče spravované přes Admin UI (`/admin/settings`), změna je okamžitě účinná bez restartu:

**LLM Provider:**

| Klíč | Popis | Příklad |
|------|-------|---------|
| `VLLM_API_URL` | URL OpenAI-compatible API | `http://gpu-server:8001/v1` |
| `VLLM_MODEL_NAME` | Globální fallback model ID | `qwen3-30b-fp8` |
| `VLLM_API_KEY` | API klíč (pro OpenRouter apod.) | `sk-...` |
| `LLM_PLATFORM` | `vllm` / `ollama` / `openrouter` / `openai` | `vllm` |
| `LLM_CONTEXT_WINDOW` | Context window v tokenech | `16384` |

**Inference parametry:**

| Klíč | Popis | Výchozí |
|------|-------|---------|
| `VLLM_MAX_TOKENS` | Globální max výstupních tokenů | `6144` |
| `VLLM_ENABLE_THINKING` | Globální thinking on/off | `true` |
| `VLLM_TOP_P` | Top-P sampling | `0.95` |
| `VLLM_PRESENCE_PENALTY` | Presence penalty | `0.0` |
| `VLLM_FREQUENCY_PENALTY` | Frequency penalty | `0.0` |

**Per-phase model:**

| Klíč | Popis |
|------|-------|
| `MODEL_PHASE1` | Model pro AI asistenta tvorby kritérií |
| `THINKING_PHASE1` | Thinking pro Phase 1 |
| `MODEL_PHASE2` | Model pro evaluaci ÚZ |
| `THINKING_PHASE2` | Thinking pro Phase 2 |
| `MODEL_EXTRACTION` | Model pro fast-scan (extrakce identity) |
| `THINKING_EXTRACTION` | Thinking pro fast-scan (výchozí: false) |

**Concurrency:**

| Klíč | Popis | Výchozí |
|------|-------|---------|
| `LLM_CONCURRENCY_VLLM` | Počet paralelních workerů pro vLLM | `8` |
| `LLM_CONCURRENCY_OPENROUTER` | Počet paralelních workerů pro OpenRouter | `2` |

**Analytics:**

| Klíč | Popis | Výchozí |
|------|-------|---------|
| `ANALYTICS_THRESHOLD` | Práh úspěšnosti (%) pro filtrování kritérií v Phase 3 LLM promptu. Kritéria pod prahem + vždy top 5 nejhorších jdou do LLM; ostatní jdou pouze do heatmapy ve frontendu. | `80` |

**Ostatní:**

| Klíč | Popis |
|------|-------|
| `SCHOOL_LOCATIONS` | JSON pole organizačních článků | `["ÚPVSP","VZ Holešov",...]` |
| `ENABLE_RAG_MODULE` | Povolení RAG / Golden examples modulu | `false` |

### 10.3 Systémové prompty

Uloženy v tabulce `system_prompts`, editovatelné v Admin UI:

| `phase_name` | Účel |
|--------------|------|
| `prompt1` | Sokratovský AI asistent pro tvorbu kritérií |
| `prompt2` | Expertní instruktor-hodnotitel pro evaluaci ÚZ (Phase 2) |
| `prompt_feedback` | Lektor-zpětnovazební asistent pro individuální zpětnou vazbu studenta (Phase 2b); teplota 0,5, max_tokens 600 |
| `prompt3` | Analytik pro pedagogické shrnutí třídy (Phase 3) |

---

## 11. Bezpečnost

### RBAC model

| Role | Přístup |
|------|---------|
| **Vyučující** | Pouze vlastní záznamy (`lecturer_id = current_user.id`) |
| **Admin** | Záznamy všech lektorů ve stejném `school_location` |
| **SuperAdmin** | Vše — bez omezení |

Funkce `apply_data_isolation()` v `api/auth.py` automaticky filtruje DB dotazy dle role. Používá se ve všech endpointech pracujících s citlivými daty.

### Další bezpečnostní opatření

- **JWT** s expirací, bcrypt hash hesel (min. 12 znaků, velká+malá+číslice)
- **Rate limiting:** `slowapi` — login endpoint 10/min, register 5/min, globální 200/min
- **Security headers middleware:** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, HSTS (v produkci)
- **nginx CSP:** `default-src 'self'`, `frame-ancestors 'none'`
- **`security_scanner.scan_text()`** — audit vstupního textu před odesláním do LLM (ochrana před prompt injection)
- **Upload limit:** 10 MB aplikačně, 15 MB na nginx
- **Vynucená změna hesla** (`must_change_password=True`) pro nové účty vytvořené adminem
- **API docs skryté v produkci** (`docs_url=None` pokud `APP_ENV=production`)
- **Backend neposlouchá navenek** — pouze přes nginx proxy

---

## 12. Decision Log (ADR)

### ADR-001: Chunking kritérií místo ořezávání

**Kontext:** Model qwen3-30b-fp8 má 16 384 tokenů context window. 25 kritérií × průměrný popis (50 tokenů) + text ÚZ (800 tokenů) + system prompt = přibližně 5 000–10 000 tokenů vstupu. Při 6 144 tokenech `max_tokens` pro výstup docházelo k přetečení.

**Možnosti:**
1. Ořezat délku kritérií — ztrácí se kontext, model hodnotí neúplně
2. Ořezat text ÚZ — student může mít důležité informace na konci
3. Rozdělit kritéria do chunků a zpracovat paralelně

**Rozhodnutí:** Chunking. Každý chunk obsahuje max. 8 kritérií + celý text ÚZ. Chunky se zpracují paralelně přes `asyncio.gather()`, výsledky se sloučí.

**Důsledky:** Zachován plný kontext ÚZ pro každé hodnocení. Paralelní zpracování využívá vLLM continuous batching — celková doba evaluace se nesčítá, ale průměruje.

---

### ADR-002: Regex split na `**N. Kritérium` místo `---` separátorů

**Kontext:** Původní chunking splitoval na prázdné řádky nebo `---` oddělovače. AI asistent v Phase 1 generuje kritéria s nekonzistentní frekvencí oddělovačů — někdy `---` chybí, někdy je na špatném místě.

**Rozhodnutí:** Primární split pomocí regex lookahead na hlavičku kritéria:
```python
re.split(r'\n+(?=\*\*\d+\.\s*Kritérium)', criteria_markdown)
```
Lookahead zachovává hlavičku v pravé části splitu. Formát `**N. Kritérium` je povinný strukturou promptu Phase 1, tedy spolehlivý.

**Fallback:** Pokud regex nenarazí na žádné kritérium v tomto formátu, použije se split na prázdné řádky (legacy kompatibilita).

---

### ADR-003: vLLM continuous batching pro paralelizaci

**Kontext:** Naivní sekvenční zpracování 25 kritérií × 1 request = 25 LLM volání. Při průměrné latenci 3–5 s = 75–125 s na jednoho studenta. Třída 15 studentů = 19–31 minut.

**Rozhodnutí:** `asyncio.gather()` odešle všechny chunky pro všechny studenty současně. vLLM continuous batching je navržen přesně pro tento use case — přijímá více requestů a zpracuje je jako jednu GPU dávku na NVIDIA L40S.

**Výsledek:** 15 studentů × 4 chunky = 60 paralelních requestů. vLLM je zpracuje v čase přibližném jednomu sekvenčnímu requestu (GPU parallel decode). Praktická latence: 15–25 s pro celou třídu.

---

### ADR-004: Adaptivní max_tokens místo globálního

**Kontext:** Globální `max_tokens=6144` způsobil verbose anomálii: model psal odůvodnění 14 231 znaků, inference trvala 66 s a výsledný JSON byl oříznut. Příčina: model "ví", že má k dispozici 6144 tokenů a snaží se je využít.

**Rozhodnutí:** `chunk_max_tokens = min(global_max, n_criteria × 350 + 300)`. Pro 8 kritérií cap = 3 100 tokenů — dostatečné pro věcné odůvodnění bez verbose balast.

**Empirická kalibrace:** 350 tokenů/kritérium pokrývá: název (10), splneno/body (5), odůvodnění (200), citace (135). Overhead 300 tokenů pro identitu a JSON strukturu.

---

### ADR-005: Man-in-the-Loop schválení před analytikou

**Kontext:** LLM může udělat chybu — špatně identifikovat studenta, chybně ohodnotit kritérium. Bez kontroly by se chybná data promítla do třídní analytiky a AI pedagogického shrnutí.

**Rozhodnutí:** Každý záznam musí mít `is_approved=true` (lektor ho ručně schválí v UI) než se zahrne do analytiky. Endpoint `/analytics/class/{id}/summary` vrátí `error: "pending_approvals"` dokud existují neschválené záznamy.

**Důsledky:** Větší pracovní zátěž pro lektora (musí projet každé hodnocení), ale garantovaná kvalita dat. Lektor může manuálně korigovat skóre i jméno před schválením.

---

### ADR-006: AppSettings v DB místo statického .env pro LLM konfiguraci

**Kontext:** LLM model, URL a parametry se mění v závislosti na dostupnosti GPU, testování různých modelů a optimalizaci inference.

**Rozhodnutí:** LLM konfigurace (URL, model ID, max_tokens, thinking, platform) je uložena v tabulce `app_settings` a editovatelná přes Admin UI bez restartu aplikace. `.env` obsahuje pouze infrastrukturní konstanty (DB URL, JWT klíč).

**Důsledky:** Změna modelu nebo URL trvá 5 sekund (uloží v UI), bez nutnosti přístupu k serveru nebo redeploymentu. Trade-off: konfigurace není verzionovaná v gitu — je záměrná (obsahuje citlivé API klíče).

---

### ADR-007: Navýšení token budgetu na 500 tokenů/kritérium (v3.8.5)

**Kontext:** Původní hodnota 350 tokenů/kritérium způsobovala JSON truncation u obsáhlejších ÚZ. Diagnostika odhalila, že česká diakritika tokenizuje hustěji (~1,5–1,7 zn/token) než původně předpokládaných 2,5 zn/token. Pro 6 kritérií × 350 = 2 400 tokenů, ale reálná potřeba byla ~3 040 tokenů → vLLM JSON mode truncoval výstup uprostřed 4. kritéria, přidával `"}]` na místě ořezu → parse error se jevil jako chyba obsahu, ne jako overflow.

**Rozhodnutí:** `chunk_max_tokens = min(global_max, n_criteria × 500 + 300)`. Hodnota 500 tokenů/kritérium pokrývá ~750–850 znaků výstupu — dostatečná rezerva i pro dialog-heavy ÚZ s právními citacemi.

**Důsledky:** Eliminace JSON truncation chyb (Jaroš: 22/25 → 25/25). Mírně vyšší spotřeba VRAM na výstupní tokeny, ale v rámci kapacity L40S (48 GB).

---

### ADR-008: Individuální zpětná vazba jako samostatné LLM volání (v3.8.7)

**Kontext:** Původní design měl pole `zpetna_vazba` součástí hlavního evaluačního JSON (Phase 2 prompt). Problém: při chunkingu model vidí pouze část kritérií per chunk — zpětná vazba na konci každého chunku by byla nekompletní. Alternativa — přidat zpětnou vazbu do merge funkce — by vyžadovala předávání celého promptu do utility funkce.

**Rozhodnutí:** Separátní LLM volání `_generate_individual_feedback()` po `_merge_chunk_results()`. Funkce vidí kompletní sloučený výsledek (všechna kritéria), sestaví user_content se jménem studenta, skóre, splněnými a nesplněnými kritérii a zavolá model s `max_tokens=600`. Prompt je konfigurovatelný v Admin UI (`phase_name='prompt_feedback'`).

**Důsledky:** Fail-safe design — selhání feedback volání vrátí prázdný string, evaluace se uloží bez zpětné vazby (neblokuje pipeline). Lektor může zpětnou vazbu vidět v detailu hodnocení. Přidá ~1–2 s latence na studenta (vLLM continuous batching to zvládá paralelně s ostatními studenty).

---

### ADR-009: Phase 3 filtrování kritérií před LLM promptem (v3.8.6)

**Kontext:** Při rostoucím počtu kritérií (20–25) a třídě 15+ studentů by Phase 3 prompt obsahoval kompletní stats pro všechna kritéria — z nichž velká část (ta s >80% úspěšností) nepřináší pedagogicky hodnotnou informaci. Velký prompt → více tokenů → pomalejší inference → riziko context overflow.

**Rozhodnutí:** Filtrování v `analytics.py/generate_class_summary()`: seřadit kritéria vzestupně dle `success_rate` → vzít top 5 nejhorších + všechna pod `ANALYTICS_THRESHOLD` (výchozí 80 %) → deduplikovat → do LLM promptu poslat pouze tuto množinu. Kompletní stats všech kritérií se stále vrátí frontendu pro heatmapu.

**Důsledky:** LLM prompt zůstane konstantně malý bez ohledu na počet kritérií. `ANALYTICS_THRESHOLD` je konfigurovatelný v Admin UI. Pedagogický obsah AI shrnutí se soustředí na problémová kritéria — pro lektora relevantnější. Trade-off: AI nikdy neokomentuje kritéria s vysokou úspěšností (záměrné).
