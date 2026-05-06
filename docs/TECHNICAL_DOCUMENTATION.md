# Technická dokumentace EVALUZ
**Verze:** 3.10.1  
**Poslední aktualizace:** 6. května 2026  
**Provozovatel:** ÚPVSP (Útvar policejního vzdělávání a služební přípravy)

## Obsah
1. [Přehled systému a architektura](#1-přehled-systému-a-architektura)
2. [AI & LLM pipeline](#2-ai--llm-pipeline)
3. [Databázová vrstva](#3-databázová-vrstva)
4. [Bezpečnost a RBAC](#4-bezpečnost-a-rbac)
5. [Air-Gap & Intranet Readiness](#5-air-gap--intranet-readiness)
6. [Produkční nasazení](#6-produkční-nasazení)
7. [Test suite](#7-test-suite)
8. [Architektonická rozhodnutí (ADR)](#8-architektonická-rozhodnutí-adr)
9. [Historie vývoje (Changelog)](#9-historie-vývoje-changelog)

---

## 1. Přehled systému a architektura

EVALUZ je webová aplikace pro AI-asistované hodnocení úředních záznamů (ÚZ) studentů policejní školy. Lektor definuje hodnotící kritéria, nahraje ÚZ studentů a AI model vyhodnotí každý záznam oproti kritériím. Lektor výsledky zkontroluje, případně upraví, a schválí (Man-in-the-Loop).

### 1.1 Technologický zásobník

| Vrstva | Technologie |
|---|---|
| Frontend | React 18, Vite, TypeScript, Vanilla CSS (bez frameworku) |
| Backend | FastAPI (Python 3.13+), SQLAlchemy 2.x ORM |
| Databáze | PostgreSQL 17 (produkce), SQLite (dev/fallback) |
| AI integrace | vLLM (primární, 128k ctx), OpenRouter, Ollama, LM Studio — rozhraní kompatibilní s OpenAI |
| Containerizace | Docker Compose (nginx + backend + PostgreSQL) |
| Autentizace | JWT Bearer tokeny (python-jose) |
| WebSocket | FastAPI WebSocket, per-lektor izolace |
| Testy | pytest + pytest-asyncio + respx (mock httpx) |

### 1.2 Komponenty a hranice

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React SPA — HERMES intranet)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │TabCriteria│ │TabEval.  │ │TabAnalyt.│ │TabStatistics     │  │
│  │(Phase 1) │ │(Phase 2) │ │(Phase 3) │ │(Admin/Superadmin)│  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
│          │          │  WebSocket (eval progress)  │             │
└──────────┼──────────┼─────────────────────────────┼─────────────┘
           │ REST API │                             │
┌──────────▼──────────▼─────────────────────────────▼─────────────┐
│  FastAPI Backend                                                 │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ api/evaluate │  │ api/analytics │  │ api/statistics       │  │
│  │ api/auth     │  │ api/criteria  │  │ api/admin            │  │
│  └──────┬───────┘  └───────────────┘  └──────────────────────┘  │
│         │ EvaluationQueue (asyncio)                              │
│  ┌──────▼────────────────────────────────────────────────────┐  │
│  │ services/llm_engine.py  (~600 řádků)                      │  │
│  │  evaluate_report() → adaptive chunking → asyncio.gather   │  │
│  │  JSON fallback: parse → sanitize → ValueError (fail-fast) │  │
│  │  _validate_and_fix_vysledky() — kanonizační match        │  │
│  └──────┬────────────────────────────────────────────────────┘  │
│         │                                                        │
└─────────┼──────────────────────────────────────────────────────-┘
          │
┌─────────▼──────────┐    ┌────────────────────────┐
│  PostgreSQL 17      │    │  vLLM server (GPU)     │
│  (Docker volume)    │    │  128k kontextové okno  │
└────────────────────┘    └────────────────────────┘
```

### 1.3 Tok dat — evaluace ÚZ

1. **Fast-scan**: Lektor nahraje soubory. Backend okamžitě vytvoří `StudentEvaluation` záznam v DB (`json_result=NULL`) a extrahuje identitu studenta (`extract_identity()`). Frontend zobrazí studenta jako `pending` v reálném čase (WebSocket).
2. **Fronta**: Každý soubor je přidán do `EvaluationQueue` jako task. Queue zpracovává úlohy asynchronně (asyncio), izolovaně podle `lecturer_id`.
3. **LLM evaluace**: `evaluate_report()` vezme text ÚZ a kritéria. Odhadne počet tokenů (`_estimate_tokens`) a porovná s kontextovým budgetem. Pokud se vše vejde do jednoho promptu, pošle jeden request. Jinak rozdělí kritéria na chunky a pošle paralelně do LLM.
4. **JSON pipeline**: Odpověď LLM projde 2-úrovňovým fallbackem (přímý parse → sanitizace). Truncovaný JSON vyhodí `ValueError` (fail-fast — viz ADR-009). Po parsování proběhne validace kritérií (`_validate_and_fix_vysledky`).
5. **Uložení**: `json_result` je aktualizován v DB. WebSocket notifikuje lektora → frontend přejde na `evaluated`.
6. **Man-in-the-Loop**: Lektor zkontroluje výsledky, případně opraví odůvodnění nebo body, pak záznamy schválí (`is_approved=true`). Teprve schválené záznamy vstupují do analytiky (Phase 3).

### 1.4 Asynchronní fronta (EvaluationQueue)

`EvaluationQueue` v `api/evaluate.py` zajišťuje:
- **Izolaci**: Každý lektor má samostatnou frontu — evaluace jiného lektora neblokuje.
- **Souběžnost**: Konfigurovatelná přes `LLM_CONCURRENCY_VLLM` / `LLM_CONCURRENCY_OPENROUTER` (výchozí 4). Asyncio semaphore limituje počet paralelních LLM volání.
- **Fail-safe**: Chyba u jednoho studenta neukončí celou dávku. Chyba je broadcastována přes WebSocket; ostatní úlohy pokračují.
- **Zrušení**: `DELETE /evaluate/batch` vyčistí frontu nevyřízených úloh.

### 1.5 WebSocket a real-time UX

Endpoint `/evaluate/ws?lecturer_id=X&token=Y` — duplex spojení per-lektor.

Typy zpráv (server → client):
- `EVAL_START` — student začal zpracování
- `EVAL_SUCCESS` — kritéria vyhodnocena a uložena do DB (bez zpětné vazby); frontend volá `fetchEvaluations()`
- `FEEDBACK_DONE` — zpětná vazba doplněna do DB; frontend volá `fetchEvaluations()` znovu
- `EVAL_ERROR` — student selhal (neblokuje ostatní)

`EVAL_SUCCESS` přichází ihned po dokončení chunking+validace (typicky ~3–5 s). `FEEDBACK_DONE` přichází asynchronně po dalších ~15–60 s. Lektor vidí výsledky kritérií okamžitě; pole `zpetna_vazba` se doplní při druhém refresh.

Frontend při odpojení WebSocket automaticky se reconnectuje a resetuje zaseknuté `evaluating` stavy.

---

## 2. AI & LLM pipeline

### 2.1 Konfigurace modelů

Systém podporuje různé modely pro různé fáze, konfigurovatelné v Admin UI (AppSettings):

| Klíč | Účel |
|---|---|
| `VLLM_MODEL_NAME` | Výchozí model pro všechny fáze |
| `MODEL_EXTRACTION` | Phase 1a: Fast-scan identita (může být lehčí model) |
| `MODEL_PHASE2` | Phase 2: Evaluace kritérií (priorita před globálním) |
| `VLLM_API_URL` | URL vLLM serveru nebo cloud API |
| `VLLM_MAX_TOKENS` | Max výstupní tokeny (výchozí 4096) |
| `VLLM_ENABLE_THINKING` | Thinking mode (QwQ/R1 modely) |
| `LLM_PLATFORM` | `vllm` / `openai` / `openrouter` / `ollama` / `lmstudio` |
| `CHUNK_SIZE` | Počet kritérií na chunk (výchozí 6) |
| `CHUNK_THRESHOLD_TOKENS_PCT` | Prahová hodnota pro přepnutí na chunking (výchozí 0.7) |
| `FEEDBACK_MAX_TOKENS` | Max výstupní tokeny pro zpětnou vazbu (výchozí 250) |

### 2.2 Kontextová okna platforem (PLATFORM_CONTEXT_DEFAULTS)

Adaptivní chunking čte kontextové okno z DB nastavení nebo z výchozích hodnot:

```python
PLATFORM_CONTEXT_DEFAULTS = {
    "vllm":       131072,   # 128k — produkční vLLM
    "openai":     128000,   # GPT-4o
    "openrouter": 8192,     # konzervativní výchozí
    "ollama":     8192,
    "lmstudio":   8192,
}
```

Platforma se detekuje automaticky z `VLLM_API_URL` (OpenRouter URL má přednost před nastavením v DB). Uživatel může přepsat kontextové okno hodnotou v DB (`LLM_CONTEXT_WINDOW`).

### 2.3 Fáze AI zpracování

#### Phase 1 — Precizace kritérií (Sokratovský asistent)
`TabCriteria` komponenta. LLM hraje roli Sokratovského asistenta — klade lektorovi upřesňující otázky jednu po druhé, aby kritéria byla jasně měřitelná. Konverzace je filtrována oddělovačem `---`: do pole kritérií se propisuje pouze část za oddělovačem (samotná definovaná kritéria, bez dialogu).

#### Phase 1a — Fast-scan identity
`extract_identity()` — rychlé LLM volání extrahující pouze hodnost, jméno a příjmení studenta z textu ÚZ (šetrné na tokeny). Výsledek uložen do `student_identity` (JSONB) a `cleaned_name` (normalizovaný řetěz pro třídění). Název souboru je normalizován pomocí `clean_filename_to_display()` (`utils/text.py`) — odstraňuje prefixové šumy (ÚZ, VTOS, hlaseni) a podtržítka.

#### Phase 2 — Evaluace ÚZ (hlavní pipeline)
`evaluate_report()` v `llm_engine.py`. Podrobně viz sekce 2.4.

#### Phase 2b — Individuální zpětná vazba (async)
`_generate_individual_feedback()` — samostatné LLM volání po sloučení chunk výsledků. Model vidí kompletní výsledek (seznam splněných/nesplněných kritérií), generuje personalizovanou zpětnou vazbu (3–5 vět). Prompt editovatelný v Admin UI (`prompt_feedback`).

**Od v3.10.1 běží mimo critical path (ADR-010):** `evaluate_report()` vrátí `zpetna_vazba=""`. Po odeslání `EVAL_SUCCESS` je spuštěn `asyncio.create_task(_run_feedback_task(...))` — ten volá `generate_feedback_for_record()` (public wrapper čtoucí nastavení z DB), provede partial update `json_result.zpetna_vazba` v DB, a odešle `FEEDBACK_DONE` WebSocket notifikaci.

`FEEDBACK_MAX_TOKENS` konfigurovatelný v DB (výchozí 250 — 3–5 vět v češtině ≈ 150–180 tokenů). Chyba zpětné vazby neblokuje uložení výsledků evaluace.

#### Phase 3 — Analýza třídy
LLM dostane agregovaná data celé třídy a generuje pedagogický komentář. Kritéria s úspěšností nad `ANALYTICS_THRESHOLD` (výchozí 80 %) jsou z LLM promptu filtrována — LLM se soustředí na problematické oblasti. Frontend heatmapa zobrazuje kompletní statistiky všech kritérií bez ohledu na threshold.

### 2.4 Adaptivní chunking

Před sestavením promptu `evaluate_report()` odhadne tokeny:

```python
def _estimate_tokens(text: str) -> int:
    """~3.5 chars/token pro česky psaný text (konzervativní odhad)."""
    return max(1, len(text) // 3)
```

Rozhodovací logika:
```
est_tokens = _estimate_tokens(criteria_markdown + report_text)
budget     = context_window × CHUNK_THRESHOLD_TOKENS_PCT  (výchozí 0.7)

if est_tokens <= budget:
    → přímé volání (1 LLM request)
else:
    → _split_criteria_chunks(criteria_markdown, CHUNK_SIZE)
    → asyncio.gather(*[_evaluate_chunk(chunk, ...) for chunk])
    → _merge_chunk_results(results)
```

`CHUNK_SIZE` a `CHUNK_THRESHOLD_TOKENS_PCT` jsou čteny z DB (`AppSettings`) při každém volání — lze měnit za běhu bez restartu.

### 2.5 JSON parse pipeline (Phase 2 — detailní)

```
criteria_markdown
       │
       ▼
Adaptive chunking decision (sekce 2.4)
       │
  len(chunks) > 1?
  ┌────┴─────┐
  │ ANO      │ NE
  ▼          ▼
asyncio.gather()    přímá cesta
[_evaluate_chunk()  (1 LLM volání)
  × N chunků]
  │
  ▼
_merge_chunk_results()
  • sloučí vysledky[]
  • přepočítá celkove_skore
       │
       └──────────┐
                  ▼
    [VALIDACE — po parsování, obě cesty]
       │
       ▼
_validate_and_fix_vysledky()   ← FIX A
  • kanonizační match (odfiltruje halucinovaná kritéria)
  • doplní chybějící jako placeholder (_llm_omitted=True, body=0)
  • přepočítá celkove_skore
       │
       ▼
    return parsed  ← zpetna_vazba="" (feedback není v critical path)
       │
       ▼ (po EVAL_SUCCESS broadcast — asyncio.create_task)
_run_feedback_task()           ← Phase 2b (ADR-010)
  generate_feedback_for_record()
  → partial DB update json_result.zpetna_vazba
  → FEEDBACK_DONE broadcast
```

**Průchod `_evaluate_chunk()` — JSON fallback pipeline:**

```
LLM response
    │
    ▼
strip <think>...</think> bloky (reasoning modely)
    │
    ▼
najít první { a poslední } → json_slice
    │
    ▼
json.loads(json_slice)
    │ JSONDecodeError?
    ├─ ANO ─► [DEBUG] _dump_raw_llm_output()  ← raw dump do souboru
    │          _sanitize_json_string_values()
    │               │
    │          json.loads(sanitized)
    │               │ JSONDecodeError?
    │               └─ ANO ─► raise ValueError  ← fail-fast (ADR-009)
    │                          (logováno jako ERROR)
    └─ NE ─► úspěch
```

S 128k kontextovým oknem je truncace JSON prakticky nemožná. Fail-fast je správnější než polo-opravený výsledek (viz ADR-009).

**`_sanitize_json_string_values()` — co opravuje:**

Scannuje znak po znaku. Uvnitř JSON string hodnoty:
- `"` — look-ahead: pokud za ní (přes whitespace) následuje `{[]},:` nebo vzor `"key":` → legitimní konec stringu; jinak → escapovat na `\"`
- `\n`, `\r`, `\t` → escape sekvence
- `\` + non-escape-char → `\\`
- kontrolní znaky `0x00–0x1F` (kromě `\n\r\t`) → `\uXXXX`

### 2.6 Kanonizační match (FIX A — podrobně)

`_canonicalize_criterion_name()` normalizuje název kritéria pro porovnání:
1. Strip prefixu `**N. Kritérium:` (LLM někdy zkopíruje formát z promptu)
2. Strip trailing markdown bold `**`
3. Strip person-specific suffixu `– Jméno Příjmení` (heuristika kotvená na konec stringu — nenarušuje popisné pomlčky uprostřed jako `– minimálně jméno, příjmení`)
4. Lower-case + strip

Příklad: LLM vrátí `"Ztotožnění osoby – Ivana Horáková"`, expected je `"Ztotožnění osoby"` → oba kanonizují na `"ztotožnění osoby"` → match. `nazev` v DB/UI je normalizován na expected verzi, původní LLM verze zachována v `_llm_actual_name` pro audit.

**Multi-person duplikát**: Model může stejné kritérium vrátit víckrát (jednou pro každou osobu v ÚZ). Zachovává se první výskyt; duplicity jsou logovány.

**Oddělovač kritérií**: Mezi kritéria v promptu je vkládán řetězec `#############` (konstanta `CRITERIA_DELIMITER`). `_split_criteria_chunks()` má primární cestu přes delimiter, legacy regex lookahead jako fallback pro starší data.

### 2.7 Diagnostika — raw dump

`_dump_raw_llm_output()` se volá pouze při JSON parse erroru a pouze pokud je aktivní DEBUG log level:

```python
if logger.isEnabledFor(logging.DEBUG):
    _dump_raw_llm_output(...)
```

Soubory v `/app/logs/llm_parse_errors/<timestamp>_<student>.txt` — obsahují typ chyby, pozici chybného znaku s kontextem ±50 znaků a kompletní raw output. Volume mount v docker-compose.yml zajišťuje persistenci přes restarty.

### 2.8 Logging

Celý `llm_engine.py` používá strukturovaný logger:

```python
logger = logging.getLogger("evaluz.llm")
```

Úrovně:
- `DEBUG` — finální prompt, raw LLM dump, token odhady
- `INFO` — normální průchod (student zpracován, chunk sloučen)
- `WARNING` — kanonizační záchrana, duplikát, placeholder
- `ERROR` — JSON parse error, ValueError, LLM exception

`httpx` a `httpcore` jsou ztišeny na `WARNING` — nevydávají INFO řádky při každém HTTP requestu.

---

## 3. Databázová vrstva

### 3.1 Klíčové tabulky

| Tabulka | Popis |
|---|---|
| `lecturers` | Identita lektorů, adminů, superadminů. Sloupce: `is_admin`, `is_superadmin`, `school_location`, `must_change_password`, `rank_shortcut`, `rank_full`, `funkcni_zarazeni`. |
| `class_rooms` | Třídy (kurzy) přiřazené lektorovi. |
| `evaluation_criteria` | Hodnotící metodiky (markdown). Filtrováno podle `lecturer_id`. |
| `criteria` | Rozparsovaná jednotlivá kritéria z `evaluation_criteria`. Používána pro chunking a pro `expected_criteria_names`. |
| `student_evaluations` | Výsledky evaluací. Klíčové sloupce: `json_result` (JSONB), `source_text` (text ÚZ), `student_identity` (JSONB), `cleaned_name`, `scenario_name`, `scenario_display_name`, `is_approved`, `created_at`. |
| `class_analyses` | AI analytika třídy (Phase 3). `content_json` (JSONB), izolováno podle `lecturer_id` + `class_id`. |
| `app_settings` | Dynamická konfigurace (LLM URL, klíče, modely, prahy, feature flags, CHUNK_SIZE, CHUNK_THRESHOLD_TOKENS_PCT). |
| `system_prompts` | Prompty pro jednotlivé fáze (`phase_name`). Editovatelné v Admin UI. |
| `golden_examples` | MLOps: příklady správných evaluací pro RAG-based few-shot learning. |

### 3.2 JSON sloupce — pravidla

`json_result` a `content_json` jsou deklarovány jako `JSONType` (custom SQLAlchemy type). SQLAlchemy vrací Python dict/list přímo. Přesto vždy ošetřit double-encoding (starší záznamy):

```python
result = eval_record.json_result
if isinstance(result, str):
    result = json.loads(result)
if isinstance(result, str):  # double-encoded
    result = json.loads(result)
```

**Metadata v JSONB bez migrace**: Nová pole jako `_llm_omitted`, `_llm_actual_name` jsou vkládána přímo do `json_result` dict. Nevyžadují DB migraci — JSONB je schemaless. Frontend je čte podmíněně.

> **Poznámka k v3.10.0**: Pole `_partial_recovery` a `_json_repaired` byla odstraněna z kódu (smazány funkce `_check_partial_recovery` a `_repair_truncated_json`). Starší záznamy v DB je mohou stále obsahovat — frontend je ignoruje (pole bylo odstraněno z TypeScript interface).

### 3.3 Migrační strategie

- **PostgreSQL (prod):** `run_alembic_migrations()` → `alembic upgrade head`. Záložní `run_migrations()` se volá při selhání Alembic.
- **SQLite (dev):** `init_db()` + `run_migrations()` — "kobercový nálet" přidává chybějící sloupce při každém startu.
- **Nové sloupce** musí být přidány na TŘECH místech: `db_models.py`, `database.py` (SQLite + PostgreSQL větve v `run_migrations()`), a nová Alembic migrace v `alembic/versions/`.

### 3.4 Fast-scan pattern

Při nahrání souborů backend **okamžitě** vytvoří `StudentEvaluation` záznam s `json_result=NULL`. Důvod: UX — lektor vidí studenty v seznamu okamžitě, indikátor průběhu funguje. `json_result` je vyplněn až po dokončení LLM evaluace.

Tento pattern má dopad na filtrování: **všechny dotazy na dokončené výsledky musí filtrovat `json_result IS NOT NULL`** — viz statistiky, dashboard, filter-options. Záznamy s `json_result=NULL` jsou platné DB záznamy, nikoliv chyby.

### 3.5 URL state persistence

Fast-scan záznamy mají uložen `source_text` — text ÚZ extrahovaný z původního souboru. `fetchEvaluations()` je načte jako `pending` záznamy i po refreshi prohlížeče. Re-evaluace funguje bez opětovného uploadu souborů — backend vezme `source_text` z DB záznamu místo nahraného souboru.

---

## 4. Bezpečnost a RBAC

### 4.1 Autentizace

JWT Bearer token v hlavičce `Authorization: Bearer <token>`. Každý chráněný endpoint používá `Depends(get_current_lecturer)`. Token expirace konfigurovatelná. Přihlášení: `POST /auth/login` → token.

Prvotní heslo každého nového lektora má příznak `must_change_password=True` — API vrací 403 s instrukcí pro změnu hesla.

### 4.2 Role a oprávnění (RBAC)

| Role | Podmínka | Vidí data |
|---|---|---|
| Lektor (Vyučující) | výchozí | Pouze vlastní záznamy (`lecturer_id`) |
| Admin | `is_admin=True` | Záznamy všech lektorů na stejném `school_location` |
| Superadmin | `is_superadmin=True` | Vše — všechny útvary |

Pomocná funkce `_get_allowed_lecturer_ids()` vrací seznam povolených `lecturer_id` pro aktuálního uživatele (nebo `None` pro superadmina = bez omezení). `apply_data_isolation()` v `api/auth.py` je centrální helper pro RBAC filtry na SQLAlchemy query.

### 4.3 Izolace dat lektorů

Každý lektor vidí pouze:
- Vlastní `ClassRoom` záznamy
- Vlastní `EvaluationCriteria` a `StudentEvaluation` záznamy
- Vlastní `ClassAnalysis` výsledky
- WebSocket notifikace pouze pro vlastní evaluační frontu

Superadmin nemá tato omezení a navíc spravuje `AppSettings` a systémové prompty.

---

## 5. Air-Gap & Intranet Readiness

### 5.1 Databázová autonomie

Backend nečeká na externí skripty pro základní data. Při každém zápisu aktivně kontroluje existenci výchozí třídy (`id=1`) a v případě potřeby ji založí "za běhu". Všechny cizí klíče používají `ondelete="CASCADE"` pro snadnou správu při promazávání testovacích dat.

`seeder.py` při každém startu:
- Zkontroluje `PROMPT_VERSION` a případně přepíše výchozí prompty
- Zajistí existenci `CHUNK_SIZE`, `CHUNK_THRESHOLD_TOKENS_PCT` a `FEEDBACK_MAX_TOKENS` v `AppSettings`

### 5.2 Unicode & Cross-Platform kompatibilita

NFC normalizace všech názvů souborů a textových vstupů na backendu i ve WebSocket handleru. Řeší konflikty mezi macOS (NFD) a Linux/Windows (NFC) při porovnávání jmen studentů.

### 5.3 Environment-Aware UI

- **Secure Context Fallback:** HDD Sync (`showDirectoryPicker`) vyžaduje HTTPS. V HTTP prostředí je funkce detekována a uživateli srozumitelně vysvětlena.
- **Tab Persistence:** UI používá `display: none/block` místo unmount komponent. Rozpracovaná data (nahrané soubory, rozpracovaný dialog) přežijí přepnutí záložky.
- **URL state persistence:** `activeTab` a `activeScenarioId` jsou synchronizovány do URL search params (`?tab=...&scenario=...`) přes `window.history.replaceState`. SPA přežije browser refresh.

### 5.4 LLM kompatibilita

- **JSON mode**: Parametr `response_format: json_object` nastaven pouze pro platformy `vllm` a `openai`. OpenRouter, Ollama a LM Studio ho nepodporují spolehlivě.
- **Thinking bloky**: `re.sub(<think>...</think>)` odstraní reasoning bloky modelů (QwQ, DeepSeek) před parsováním JSON.
- **Platform detection**: `_resolve_platform()` detekuje platformu z URL (OpenRouter URL má přednost před nastavením v DB).
- **OpenRouter reasoning**: `_build_llm_kwargs()` přidává reasoning kwargs (budget, effort) pouze pro OpenRouter platformu.

---

## 6. Produkční nasazení

### 6.1 Docker Compose

Tři služby: `db` (PostgreSQL 17-alpine), `backend` (FastAPI), `frontend` (Nginx + React SPA).

Porty:
- `8001:80` — HTTP (redirect na HTTPS)
- `8443:443` — HTTPS (self-signed nebo vlastní certifikát, volume `./ssl:/etc/nginx/ssl`)
- Port 8000 (backend) není exponován navenek — přístup pouze přes Nginx proxy.

Volumes:
- `pgdata` — PostgreSQL data (named volume)
- `./backend/data:/app/data` — uploadovaná data
- `./logs/llm_parse_errors:/app/logs/llm_parse_errors` — diagnostické dumpy JSON chyb

### 6.2 Generování SSL certifikátu

```bash
./generate-ssl.sh
```
Generuje self-signed certifikát pro intranetové nasazení. Pro produkci nahradit vlastním certifikátem (Let's Encrypt nebo CA organizace).

### 6.3 Environment variables

Citlivé hodnoty (DB heslo, LLM API klíče) v `backend/.env`. Tento soubor se NIKDY nesmí nahrávat do Gitu. LLM konfigurace je také editovatelná za běhu přes Admin UI (uložena v `app_settings`).

### 6.4 Inicializace a migrace

Při každém startu backend:
1. Spustí Alembic migrace (`alembic upgrade head`)
2. Záloha: `run_migrations()` přidá chybějící sloupce (kobercový nálet)
3. `seeder.py` zkontroluje `PROMPT_VERSION` a případně přepíše výchozí prompty; zajistí existenci `CHUNK_SIZE`, `CHUNK_THRESHOLD_TOKENS_PCT`, `FEEDBACK_MAX_TOKENS`

---

## 7. Test suite

### 7.1 Struktura testů

```
backend/tests/
├── conftest.py                  # sys.path, sdílené fixtures pro unit testy
├── test_llm_pipeline.py         # unit testy (36 testů)
└── integration/
    ├── __init__.py
    ├── conftest.py              # in-memory SQLite, MockLLMRouter, FastAPI client
    ├── mock_llm.py              # MockLLMRouter — FIFO respx interceptor
    └── test_evaluate_endpoint.py  # integrační testy (10 testů)
```

Celkem: **52 testů** (spuštění: `cd backend && pytest tests/ -v`)

### 7.2 Unit testy (`test_llm_pipeline.py` — 36 testů)

Pokrývají klíčové vrstvy `llm_engine.py` bez sítě, DB ani vLLM:
- `_canonicalize_criterion_name`: strip prefix, person suffix, popisné pomlčky
- `_validate_and_fix_vysledky`: validace, multi-person duplikáty, `_llm_actual_name`
- `_sanitize_json_string_values`: regress na v3.9.1 quotes, v3.9.5 lone backslash + control chars
- `_split_criteria_chunks`: delimiter primární + legacy fallback
- `_merge_chunk_results`: sloučení chunků
- `parse_criteria_markdown`: delimiter + legacy
- Integrační test reprodukující reálný case Kořař z 29. 4. 2026

### 7.3 Integrační testy (`test_evaluate_endpoint.py` — 10 testů)

Používají **in-memory SQLite** (izolace per-test, bez I/O), **respx** pro interceptaci httpx volání na `http://mock-vllm:8001/v1`, a fresh FastAPI app bez lifespan (bez zapisování na disk).

**MockLLMRouter** (`mock_llm.py`):
- FIFO fronta odpovědí — každý `respond_*` přidá odpověď do fronty
- `respond_clean(criteria_names, ...)` — validní JSON s vyplněnými kritérii
- `respond_truncated()` — JSON uříznutý před posledním `}}` (deterministické, testuje fail-fast)
- `respond_with_extra_criteria(...)` — halucinovaná kritéria nad rámec sady
- `respond_chunk_pattern(...)` — pro chunking scénáře

**Pokryté scénáře:**
1. `test_evaluate_clean_single_call` — 3 kritéria, validní JSON, správné skóre
2. `test_evaluate_truncated_json_raises` — truncation → ValueError → HTTP 500
3. `test_evaluate_chunked_missing_criterion` — 12 kritérií, chybějící → placeholder `_llm_omitted=True`
4. `test_missing_criteria_get_placeholders` — 6 kritérií, 4 vrácena, 2 placeholder
5. `test_no_partial_recovery_flag_anywhere` — `_partial_recovery` nikdy není v odpovědi (E6)
6. `test_fast_scan_identity_not_overwritten` — E3b regress (identita nepřepíše platnou)
7–9. E2 adaptivní chunking testy (budget vs. single-call path)

### 7.4 Konfigurace

```ini
# backend/pytest.ini
[pytest]
testpaths = tests
asyncio_mode = auto
asyncio_default_fixture_loop_scope = function

[pytest:markers]
integration: integrační testy (mock vLLM + in-memory SQLite)
```

Produkční `requirements.txt` neobsahuje testovací závislosti. `requirements-dev.txt` přidává:
```
pytest>=8
pytest-asyncio>=0.23
respx>=0.21
```

---

## 8. Architektonická rozhodnutí (ADR)

### ADR-001: Chunking kritérií místo sliding window

**Kontext:** LLM má kontextové okno, do kterého se při 20+ kritériích a dlouhém textu ÚZ nemusí vše vejít.

**Možnosti:**
- *Sliding window*: Rozdělit text ÚZ — kritérium může být doloženo citací z různých částí textu.
- *Chunking kritérií*: Rozdělit kritéria na skupiny (`CHUNK_SIZE`), každý chunk hodnotit oproti **celému** textu ÚZ.

**Rozhodnutí:** Chunking kritérií. Celý text ÚZ je vždy k dispozici pro každé kritérium. vLLM continuous batching zpracuje N chunků jako jednu GPU dávku. 25 kritérií → 5 chunků × ~2 s/chunk = ~2 s celkem (paralelně).

**Kompromis:** LLM nevidí, jak hodnotí jiná kritéria z jiného chunku — nemůže detekovat konzistenci. Akceptovatelné pro daný use-case.

---

### ADR-002: 2-úrovňový JSON fallback (od v3.10.0; dříve 3-úrovňový)

**Kontext:** LLM občas vrací syntakticky nevalidní JSON (neescapované uvozovky, literální newlines, osamocená zpětná lomítka).

**Rozhodnutí (v3.10.0):** 2-úrovňový fallback:
1. `json.loads()` — bez zásahu
2. `_sanitize_json_string_values()` + `json.loads()` — oprava běžných chyb uvnitř string hodnot

Pokud selže i úroveň 2 → `ValueError` (fail-fast, viz ADR-009). Level 3 (`_repair_truncated_json`) byl odstraněn v E6 — s 128k kontextem je truncace prakticky nemožná.

**Historie:** Do v3.9.10 existoval Level 3 jako strukturální rekonstrukce z částečného výstupu.

---

### ADR-003: Metadata v JSONB bez DB migrace

**Kontext:** Diagnostická metadata (`_llm_omitted`, `_llm_actual_name`) mají různou granularitu — `_llm_omitted` je na úrovni kritéria, ostatní na úrovni evaluace.

**Rozhodnutí:** Metadata v JSONB. `json_result` je schemaless — libovolná nová pole lze přidat bez migrace. Frontend je čte podmíněně. Nulová migrační zátěž.

**Kompromis:** Nelze na tato pole dělat efektivní DB dotazy (JSONB operátory). Akceptovatelné — jde o diagnostická metadata, ne o primární data pro reporting.

**Poznámka:** Pole `_partial_recovery` a `_json_repaired` byla v v3.10.0 odstraněna (funkce smazány). Existující záznamy v DB je mohou stále obsahovat.

---

### ADR-004: Man-in-the-Loop schválení před analytikou

**Rozhodnutí:** Schválení (`is_approved=true`) je povinné před vstupem záznamu do Phase 3 analytiky a do statistik. Lektor může výsledky opravit a pak schválit. Re-evaluace je povolena pro záznamy `is_approved=false`.

**Kompromis:** Lektor musí kliknout "Schválit" pro každého studenta — manuální práce u větších tříd. Záměrná kontrolní brána.

---

### ADR-005: Criteria validation (FIX A) jako post-parse krok

**Kontext:** LLM vrací více kritérií než bylo v promptu (halucinace), nebo je přejmenuje.

**Rozhodnutí:** Post-parse validace. Po parsování JSON porovnat `vysledky[*].nazev` s `expected_criteria_names`. Odfiltrovat neznámé, doplnit chybějící. Deterministická, nezávisí na LLM chování.

**Aktualizace v3.9.6:** Exact-match nahrazen kanonizačním matchem (viz ADR-007).

---

### ADR-006: EvaluationQueue — asyncio, ne Celery/RQ

**Rozhodnutí:** asyncio in-process queue. Aplikace běží jako jeden Docker kontejner — distribuovaná fronta je over-engineering. FastAPI je nativně asyncio. `asyncio.Semaphore` limituje souběžnost.

**Kompromis:** Restart kontejneru ztratí nevyřízené úlohy. Akceptovatelné pro daný scale.

---

### ADR-007: Kanonizační match místo exact match (v3.9.6)

**Kontext:** Model systematicky modifikuje názvy kritérií — přidává prefix `**N. Kritérium:`, trailing `**`, nebo person-specific suffix `– Jméno Příjmení`. Exact-match způsoboval 10–20 placeholderů u scénářů s více osobami.

**Rozhodnutí:** `_canonicalize_criterion_name()` normalizuje obě strany (expected i actual) na společný klíč. Původní LLM hodnota zachována v `_llm_actual_name` pro audit.

**Kompromis:** Heuristika strippingu person suffixu závisí na patternech jmen (Velké + Velké písmeno).

---

### ADR-008: Adaptivní chunking — kontextové okno z DB, ne fixní konstanta (v3.9.10)

**Kontext:** `CHUNK_SIZE=6` bylo hardcoded. S přechodem na 128k kontextové okno (vLLM) je fixní chunking zbytečně restriktivní pro malé sady kritérií.

**Možnosti:**
- *Fixní chunking vždy*: Jednoduché, ale zbytečné volání × N requestů pro 6 kritérií.
- *Fixní single-call vždy*: Riskantní při přepnutí na model s menším kontextem.
- *Adaptivní*: Odhadni tokeny, porovnej s budgetem, rozhoduj dynamicky.

**Rozhodnutí:** Adaptivní chunking. `_estimate_tokens()` (~3.5 chars/token pro češtinu) odhadne celkový objem. Pokud `est ≤ context × threshold_pct` → přímé volání; jinak chunking. `CHUNK_SIZE` a `CHUNK_THRESHOLD_TOKENS_PCT` jsou čteny z DB — konfigurovatelné za běhu. `PLATFORM_CONTEXT_DEFAULTS` zajistí rozumné výchozí hodnoty pro každou platformu.

**Kompromis:** Odhad tokenů je přibližný (~3.5 chars/token, reálně může být 2.5–4). Konzervativní threshold (0.7 = 70 % kontextového okna) dává dostatečnou rezervu. Chybný odhad způsobí jen zbytečné chunking (nikdy přetečení kontextu).

---

### ADR-009: Fail-fast na truncovaném JSON (v3.10.0)

**Kontext:** `_repair_truncated_json()` (~120 řádků) rekonstruovala JSON z oříznutého výstupu. Vyžadovala to existence `_check_partial_recovery()` a `_partial_recovery` metadat v celém stacku (backend → DB → frontend). S přechodem na 128k kontextové okno je truncace prakticky nemožná.

**Možnosti:**
- *Zachovat repair*: Komplexní kód, který se nikdy nespustí. Dead code s udržovacím nákladem.
- *Fail-fast ValueError*: Jednoduché, čisté. Pokud truncace přece nastane, lektor uvidí chybu a re-evaluuje.

**Rozhodnutí:** Fail-fast. `_repair_truncated_json`, `_check_partial_recovery` a chunk retry loop odstraněny. `_partial_recovery` flag odstraněn z frontend TypeScript interface i UI komponent. `llm_engine.py` zkrácen z ~1000 na ~600 řádků.

**Kompromis:** Pokud uživatel přepne na model s malým kontextem (< 8k) a zapomene nastavit `CHUNK_SIZE`, může evaluace selhat. Mitigace: `PLATFORM_CONTEXT_DEFAULTS` nastavuje konzervativní výchozí hodnoty pro non-vLLM platformy (8192 tokenů = chunking se zapne brzy).

---

### ADR-010: Feedback mimo critical path evaluace (v3.10.1)

**Kontext:** Testování na OpenRouter + gemma4 256k ukázalo, že `_generate_individual_feedback()` trvá 60–80 s při souběžné evaluaci (OpenRouter rate limiting po burst chunking requestů). Funkce byla volána uvnitř `evaluate_report()` — blokovalo to `EVAL_SUCCESS` notifikaci a tím zobrazení výsledků lektorovi.

**Možnosti:**
- *Zachovat current path*: Jednoduché, ale lektor čeká 90+ s i když kritéria jsou vyhodnocena za 3–5 s.
- *Oddělit feedback od critical path*: `evaluate_report()` vrátí `zpetna_vazba=""`. Feedback se generuje asynchronně po `EVAL_SUCCESS`.

**Rozhodnutí:** Feedback mimo critical path.
1. `evaluate_report()` vrací `zpetna_vazba=""` (obě cesty — chunking i single-call).
2. Nová funkce `generate_feedback_for_record(merged, db, student_log_prefix)` v `llm_engine.py` — public wrapper čtoucí LLM nastavení z DB a volající `_generate_individual_feedback()`.
3. Nová funkce `_run_feedback_task(eval_record_id, lecturer_id, student_name, scen_id)` v `api/evaluate.py` — vlastní DB session, partial update `json_result.zpetna_vazba`, broadcast `FEEDBACK_DONE`.
4. `asyncio.create_task(_run_feedback_task(...))` spuštěno v `process_single_file_bg` ihned po `EVAL_SUCCESS` broadcastu.
5. Frontend: handler `FEEDBACK_DONE` → `fetchEvaluations()`.
6. `FEEDBACK_MAX_TOKENS` snížen z 600 na 250 (výchozí), konfigurovatelný v DB.

**Výsledek:** Lektor vidí výsledky kritérií za ~3–5 s (chunking fáze). Zpětná vazba se doplní async za dalších ~15–60 s bez blokování dalších evaluací.

**Kompromis:** Mezi `EVAL_SUCCESS` a `FEEDBACK_DONE` lektor vidí prázdné pole zpětné vazby. To je vědomý UX trade-off — pole je jasně označeno jako „generuji…" nebo je jednoduše prázdné. Partial DB update (přepis `json_result`) je atomický na úrovni ORM — žádný souběžný problém (feedback task je jediný zapisovatel tohoto pole po EVAL_SUCCESS).

---

## 9. Historie vývoje (Changelog)

### v3.10.1 (6. 5. 2026) — Feedback mimo critical path (O2+O3)

- **O2:** `FEEDBACK_MAX_TOKENS` konfigurovatelný v DB (výchozí 250, bylo 600). Seeded v `seeder.py`, čteno v `_generate_individual_feedback()` bez restartu.
- **O3:** `_generate_individual_feedback()` odstraněna z `evaluate_report()`. Po `EVAL_SUCCESS` spuštěn `asyncio.create_task(_run_feedback_task(...))`. Feedback generován paralelně, partial DB update `json_result.zpetna_vazba`, nová WS zpráva `FEEDBACK_DONE`. Frontend: handler `FEEDBACK_DONE` → `fetchEvaluations()`.
- `generate_feedback_for_record()` — nový public wrapper v `llm_engine.py`.
- **Výsledek:** EVAL_SUCCESS přichází ~3–5 s po zahájení (chunking fáze). Zpětná vazba doplněna async. 52/52 testů pass.

---

### v3.10.0 (5. 5. 2026) — LLM engine refactor: repair/recovery vrstvy smazány, frontend cleanup

Dokončení 7-etapového refaktoru `llm_engine.py`. Cílem bylo zjednodušení kódu budovaného pro 8k kontextové okno, nyní zbytečného s 128k vLLM.

**E1 — Integration test suite:**
- `MockLLMRouter` (`backend/tests/integration/mock_llm.py`) — FIFO fronta odpovědí, respx interceptor pro `http://mock-vllm:8001/v1`
- `conftest.py` — in-memory SQLite per test, fresh FastAPI app bez lifespan, `auth_headers`, `mock_llm` fixtures
- 10 integračních testů pokrývajících clean path, truncation fail-fast, chunking, identity update, partial placeholders

**E2 — Adaptivní chunking (ADR-008):**
- `_estimate_tokens()` — odhad ~3.5 chars/token
- `PLATFORM_CONTEXT_DEFAULTS` — výchozí kontextová okna per platforma
- `CHUNK_SIZE` a `CHUNK_THRESHOLD_TOKENS_PCT` čteny z DB (konfigurovatelné za běhu)
- `seeder.py`: automatický seed obou klíčů při startu

**E3 — Bugfixy a helper:**
- `utils/text.py`: `clean_filename_to_display()` — normalizace názvů souborů (strip ÚZ/VTOS šumů)
- `api/evaluate.py`: použití helperu na 2 místech (fast-scan + batch display name)
- Opravena podmínka aktualizace identity (prázdný `{}` byl falsy → identita se nepřepisovala)
- OpenRouter reasoning kwargs v `_build_llm_kwargs()`

**E4 — Logging infrastruktura:**
- `logger = logging.getLogger("evaluz.llm")` v `llm_engine.py`
- `httpx` a `httpcore` ztišeny na WARNING v `core/logging_config.py`

**E5 — Kompletní migrace print → logger:**
- 41× `print()` nahrazeno `logger.info/warning/error/debug`
- `_dump_raw_llm_output` volání chráněno `if logger.isEnabledFor(logging.DEBUG):`

**E6 — Smazání repair/recovery vrstev (ADR-009):**
- `_repair_truncated_json()` — smazána (~120 řádků)
- `_check_partial_recovery()` — smazána (~30 řádků)
- Chunk retry loop — smazán (~15 řádků)
- `test_llm_pipeline.py`: odstraněny testy smazaných funkcí
- Celkem: −121 řádků z `llm_engine.py`

**E7 — Frontend cleanup:**
- `TabEvaluation.tsx`: odstraněn partial_recovery badge v student listu i detail view
- `src/types.ts`: odstraněno `partial_recovery` z TypeScript interface

**Výsledek:** `llm_engine.py` ~600 řádků (vs. ~1000 před refaktorem). 52/52 testů pass.

---

### v3.9.8 (4. 5. 2026) — Bugfixy: fronta místo dict, body z DB, řazení výstupu

- **`evaluate_batch`**: Záznamy studentů čteny z fronty (ne dict) — opravena race condition při souběžné evaluaci.
- **Body z DB**: Při re-evaluaci se body kritérií čtou z DB definice, ne z předchozího výsledku.
- **Řazení výstupu**: `vysledky[]` v `json_result` jsou seřazeny dle pořadí vstupních kritérií (konzistentní zobrazení).

---

### v3.9.7 (4. 5. 2026) — Bugfix: přepočet skóre ignoruje body u splneno=false

- `_merge_chunk_results()`: `celkove_skore` se počítá pouze ze záznamů kde `splneno=True`. Dříve mohl model vrátit `splneno=false` a `body>0` a tyto body se chybně sčítaly. Opravena normalizace: záznamy s `splneno=false` mají `body` nastaveno na 0.

---

### v3.9.6 (3. 5. 2026) — Fáze A: kanonizační match a oddělovač kritérií

- **`_canonicalize_criterion_name()`**: Strip prefixu `**N. Kritérium:`, trailing `**`, person suffix `– Jméno Příjmení`. Nahrazuje exact-match v `_validate_and_fix_vysledky()`.
- **Multi-person duplikát detection**: Zachová první výskyt stejného kritéria pro různé osoby.
- **`_llm_actual_name`**: Původní LLM název zachován pro audit.
- **`CRITERIA_DELIMITER = "#############"`**: Vkládán mezi kritéria v promptu.  `_split_criteria_chunks()` primárně dělí přes delimiter, legacy regex jako fallback.
- **Pytest regression suite**: `backend/tests/test_llm_pipeline.py`, 36 testů.
- **fontTools log noise potlačen**: `core/logging_config.py` — WARNING úroveň.

---

### v3.9.5 (29. 4. 2026) — JSON pipeline diagnostika a robustnost

- **FIX B** — `_dump_raw_llm_output()`: Raw dump při parse erroru do `/app/logs/llm_parse_errors/`.
- **FIX A** — `_validate_and_fix_vysledky()`: Post-parse validace kritérií, placeholdery pro chybějící.
- **FIX C** — `_check_partial_recovery()`: Metadata o částečném zachránění (odstraněno v v3.10.0).
- **FIX D** — Sanitizer: lone backslash → `\\`, kontrolní znaky → `\uXXXX`.

---

### v3.9.4 (29. 4. 2026) — URL state persistence, analytics refresh, scroll-to-top, statistics fix

- URL state persistence (`?tab=...&scenario=...`).
- Analytics auto-refresh při přepnutí záložky.
- Scroll-to-top button opraveno na správný panel (student list).
- Statistics filter-options: filtr `json_result IS NOT NULL` pro scénáře.

---

### v3.9.3 (28. 4. 2026) — Bugfixy: statistiky, scroll, re-evaluace

- Statistiky: `json_result IS NOT NULL` filtr v `/statistics/dashboard`.
- Scroll v panelu kritérií: `overflow-y: auto`.
- Re-evaluace povolena pro `is_approved=false` záznamy.

---

### v3.9.0–v3.9.2 — Prompt optimalizace pro qwen3-30b + JSON sanitizace

- v3.9.0: `DEFAULT_PROMPT_PHASE2` přepis pro qwen3-30b-instruct; `PROMPT_VERSION` upgrade systém.
- v3.9.1: `_sanitize_json_string_values()` — oprava neescapovaných uvozovek v citacích.
- v3.9.2: Oprava look-aheadu sanitizace + per-block sanitizace v `_repair_truncated_json`.

---

### v3.8.7 (24. 4. 2026) — Individuální zpětná vazba + Admin prompt

- `_generate_individual_feedback()`: Separátní LLM volání po merge, max 600 tokenů.
- `prompt_feedback` editovatelný v Administraci.

---

### v3.8.4–v3.8.6 — Token budget, retry, Phase 3 filtrování

- v3.8.6: Filtrování kritérií pro Phase 3 dle `ANALYTICS_THRESHOLD` (výchozí 80 %).
- v3.8.5: Token budget 500 tokenů/kritérium (česká tokenizace ~1.5 zn/token).
- v3.8.4: Chunk retry s `temperature=0.3`; `_llm_call_with_overflow_retry()` pro HTTP 400.

---

### v3.8.2–v3.8.3 — Chunking kritérií + JSON recovery

- `_split_criteria_chunks()`: regex lookahead split, `CHUNK_SIZE=6`, `asyncio.gather` parallelismus.
- `_repair_truncated_json()`: Recovery z oříznutého JSON výstupu (odstraněno v v3.10.0).
- `_llm_call_with_overflow_retry()`: HTTP 400 → automatické snížení max_tokens.

---

### v3.7.x — Export, Statistiky, Migrace

- v3.7.7: Oprava `VLLM_API_URL` default, `POST /admin/test-llm` stabilizace.
- v3.7.5: Migrace přesunuty z `lifespan()` do `Dockerfile CMD` — eliminuje race condition.
- v3.7.0: `TabStatistics`, `scenario_display_name` v DB, rozdělená LLM souběžnost.
- v3.6.0: Man-in-the-Loop schvalovací workflow; PDF/Excel refactoring.

---

### v3.3.0–v3.5.x — Multi-tenancy, RBAC, WebSocket izolace

- v3.5.0: RBAC třídy (Vyučující / Admin / SuperAdmin), `apply_data_isolation()`.
- v3.3.0–v3.3.1: Kompletní izolace dat mezi lektory, WebSocket fronta per `lecturer_id`.
- v3.2.2: `EvaluationQueue` se semaphore souběžnosti, vLLM batching.

---

### v2.x — Počátky

- v2.0.2: Google Gemini podpora, filtr AI chatu (`---` oddělovač do pole kritérií).

---

*Poslední aktualizace dokumentace: 6. května 2026*
