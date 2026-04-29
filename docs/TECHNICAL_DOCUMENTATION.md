# Technická dokumentace EVALUZ
**Verze:** 3.9.5 (JSON pipeline diagnostika a robustnost: raw LLM dump, criteria validation, partial recovery UI)
**Poslední aktualizace:** 29. dubna 2026

## Obsah
1. [Přehled systému a architektura](#1-přehled-systému-a-architektura)
2. [AI & LLM pipeline](#2-ai--llm-pipeline)
3. [Databázová vrstva](#3-databázová-vrstva)
4. [Bezpečnost a RBAC](#4-bezpečnost-a-rbac)
5. [Air-Gap & Intranet Readiness](#5-air-gap--intranet-readiness)
6. [Produkční nasazení](#6-produkční-nasazení)
7. [Architektonická rozhodnutí (ADR)](#7-architektonická-rozhodnutí-adr)
8. [Historie vývoje (Changelog)](#8-historie-vývoje-changelog)

---

## 1. Přehled systému a architektura

EVALUZ je webová aplikace pro AI-asistované hodnocení úředních záznamů (ÚZ) studentů policejní školy. Lektor definuje hodnotící kritéria, nahraje ÚZ studentů a AI model vyhodnotí každý záznam oproti kritériím. Lektor výsledky zkontroluje, případně upraví, a schválí (Man-in-the-Loop).

### 1.1 Technologický zásobník

| Vrstva | Technologie |
|---|---|
| Frontend | React 18, Vite, TypeScript, Vanilla CSS (bez frameworku) |
| Backend | FastAPI (Python 3.10+), SQLAlchemy 2.x ORM |
| Databáze | PostgreSQL 17 (produkce), SQLite (dev/fallback) |
| AI integrace | vLLM (primární), Google AI Studio, OpenRouter — rozhraní kompatibilní s OpenAI |
| Containerizace | Docker Compose |
| Autentizace | JWT Bearer tokeny (python-jose) |
| WebSocket | FastAPI WebSocket, per-lektor izolace |

### 1.2 Komponenty a hranice

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                            │
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
│  │ services/llm_engine.py                                    │  │
│  │  evaluate_report() → chunking → asyncio.gather → merge   │  │
│  │  3-level JSON fallback: parse → sanitize → repair        │  │
│  │  FIX A: criteria validation | FIX B: raw dump            │  │
│  └──────┬────────────────────────────────────────────────────┘  │
│         │                                                        │
└─────────┼──────────────────────────────────────────────────────-┘
          │
┌─────────▼──────────┐    ┌────────────────────────┐
│  PostgreSQL 17      │    │  vLLM server (GPU)     │
│  (Docker volume)    │    │  nebo cloud LLM API    │
└────────────────────┘    └────────────────────────┘
```

### 1.3 Tok dat — evaluace ÚZ

1. **Fast-scan**: Lektor nahraje soubory. Backend okamžitě vytvoří `StudentEvaluation` záznam v DB (`json_result=NULL`) a extrahuje identitu studenta (`extract_identity()`). Frontend zobrazí studenta jako `pending` v reálném čase (WebSocket).
2. **Fronta**: Každý soubor je přidán do `EvaluationQueue` jako task. Queue zpracovává úlohy asynchronně (asyncio), izolovaně podle `lecturer_id`.
3. **LLM evaluace**: `evaluate_report()` vezme text ÚZ a kritéria, rozdělí kritéria na chunky, pošle paralelně do LLM, výsledky sloučí.
4. **JSON pipeline**: Odpověď LLM projde 3-úrovňovým fallbackem (parse → sanitizace → strukturální oprava). Po parsování proběhne validace kritérií (FIX A) a detekce partial recovery (FIX C).
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
- `EVAL_DONE` — student dokončen, obsahuje výsledky
- `EVAL_ERROR` — student selhal (neblokuje ostatní)

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
| `LLM_PLATFORM` | `vllm` / `openai` / `openrouter` / `ollama` |

### 2.2 Fáze AI zpracování

#### Phase 1 — Precizace kritérií (Sokratovský asistent)
`TabCriteria` komponenta. LLM hraje roli Sokratovského asistenta — klade lektorovi upřesňující otázky jednu po druhé, aby kritéria byla jasně měřitelná. Konverzace je filtrována oddělovačem `---`: do pole kritérií se propisuje pouze část za oddělovačem (samotná definovaná kritéria, bez dialogu).

Konfigurovatelný limit kontextového okna (`LLM_CONTEXT_WINDOW`) chrání před přetečením dlouhých konverzací. Plánovaný upgrade na model s 256k kontextem (Qwen3.5 nebo ekvivalent) umožní kompletní redesign bez limitu délky konverzace.

#### Phase 1a — Fast-scan identity
`extract_identity()` — rychlé LLM volání extrahující pouze hodnost, jméno a příjmení studenta z textu ÚZ (šetrné na tokeny). Výsledek uložen do `student_identity` (JSONB) a `cleaned_name` (normalizovaný řetěz pro třídění).

#### Phase 2 — Evaluace ÚZ (hlavní pipeline)
`evaluate_report()` v `llm_engine.py`. Podrobně viz sekce 2.3.

#### Phase 2b — Individuální zpětná vazba
`_generate_individual_feedback()` — samostatné LLM volání po sloučení chunk výsledků. Model vidí kompletní výsledek (seznam splněných/nesplněných kritérií), generuje personalizovanou zpětnou vazbu pro studenta (3–5 vět, max. 600 tokenů). Prompt editovatelný v Admin UI (`prompt_feedback`). Chyba zpětné vazby neblokuje uložení výsledků evaluace.

#### Phase 3 — Analýza třídy
LLM dostane agregovaná data celé třídy a generuje pedagogický komentář. Kritéria s úspěšností nad `ANALYTICS_THRESHOLD` (výchozí 80 %) jsou z LLM promptu filtrována — LLM se soustředí na problematické oblasti. Frontend heatmapa zobrazuje kompletní statistiky všech kritérií bez ohledu na threshold.

### 2.3 JSON parse pipeline (Phase 2 — detailní)

Celý průchod `evaluate_report()` pro jednoho studenta:

```
criteria_markdown
       │
       ▼
_split_criteria_chunks() — regex lookahead na "**N. Kritérium"
CHUNK_SIZE = 6
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
propaguje _json_repaired
       │
       └──────────┐
                  ▼
    [VALIDACE — po parsování, obě cesty]
       │
       ▼
_validate_and_fix_vysledky()   ← FIX A
  • odfiltruje halucinovaná kritéria (nazev ∉ expected_set)
  • doplní chybějící jako placeholder (_llm_omitted=True, body=0)
  • přepočítá celkove_skore
       │
       ▼
_check_partial_recovery()      ← FIX C
  • detekuje _llm_omitted placeholdery
  • vloží _partial_recovery do json_result
  • reason: "json_repair" | "llm_omitted"
       │
       ▼
_generate_individual_feedback() ← Phase 2b
       │
       ▼
    return parsed
```

**Průchod `_evaluate_chunk()` (nebo přímé `evaluate_report`):**

```
LLM response
    │
    ▼
strip think/thought bloky (re.sub <think>...</think>)
    │
    ▼
najít první { a poslední } → json_slice
    │
    ▼
json.loads(json_slice)
    │ JSONDecodeError?
    ├─ ANO ─► _dump_raw_llm_output()    ← FIX B (uloží raw do souboru)
    │          _sanitize_json_string_values()
    │               │
    │          json.loads(sanitized)
    │               │ JSONDecodeError?
    │               ├─ ANO ─► _repair_truncated_json(sanitized)
    │               │          parsed['_json_repaired'] = True
    │               │          pokud None → ValueError (logováno)
    │               └─ NE ─► "JSON opraven sanitizací ✓"
    └─ NE ─► úspěch při prvním pokusu
```

**`_sanitize_json_string_values()` — co opravuje:**

Scannuje znak po znaku. Uvnitř JSON string hodnoty:
- `"` — look-ahead: pokud za ní (přes whitespace) následuje `{[]},:` nebo vzor `"key":` → legitimní konec stringu; jinak → escapovat na `\"`
- `\n`, `\r`, `\t` → escape sekvence
- `\` + non-escape-char → `\\` *(FIX D, v3.9.5)*
- kontrolní znaky `0x00–0x1F` (kromě `\n\r\t`) → `\uXXXX` *(FIX D, v3.9.5)*

**`_repair_truncated_json()` — co opravuje:**
Strukturálně poškozený nebo uprostřed oříznutý JSON. Extrahuje kompletní `{...}` záznamy z pole `vysledky` sledováním hloubky závorek. Výsledek může mít méně kritérií než bylo zadáno (detekováno FIX C).

### 2.4 Retry a overflow ochrana

**Chunk retry**: Pokud chunk vrátí méně kritérií než bylo zadáno, automaticky se provede retry s `temperature=0.3`. Funguje pro sampling-based chyby; deterministické truncation řeší token budget.

**Token budget**: `chunk_max_tokens = min(global_max, n_criteria × 500 + 300)`. Česká diakritika tokenizuje ~1,5–1,7 zn/token (hustěji než angličtina). Hodnota 500 tokenů/kritérium eliminuje JSON truncation u obsáhlých ÚZ.

**Context overflow retry**: `_llm_call_with_overflow_retry()` zachytí HTTP 400 "context length exceeded", parsuje skutečné limity z chybové zprávy a opakuje volání s redukovaným `max_tokens`. Chrání Phase 3 analytiku (velké prompty).

### 2.5 Diagnostika JSON chyb (FIX B, v3.9.5)

Při každém JSON parse erroru `_dump_raw_llm_output()` uloží:
- typ chyby, pozici chybného znaku, kontext ±50 znaků
- kompletní raw LLM výstup

Soubory v `/app/logs/llm_parse_errors/<timestamp>_<student>.txt`. Namountováno jako Docker volume (`./logs/llm_parse_errors:/app/logs/llm_parse_errors`) → přežije restart kontejneru.

### 2.6 Criteria validation a partial recovery (FIX A + C, v3.9.5)

`evaluate_batch` sestaví `expected_criteria_names` z `individual_criteria` a předá ho každému tasku → `evaluate_report(expected_criteria_names=...)`.

Po parsování (obě cesty — chunked merge i přímá) proběhnou dvě validace:

1. **FIX A** `_validate_and_fix_vysledky()`: Halucinovaná kritéria (LLM vrátil `nazev` mimo vstupní sadu) jsou odfiltrována. Chybějící kritéria jsou doplněna jako placeholdery (`_llm_omitted=true`, `body=0`, varující `oduvodneni`). Celkové skóre je přepočítáno.

2. **FIX C** `_check_partial_recovery()`: Pokud existují `_llm_omitted` placeholdery, vloží do `json_result` metadata:
   ```json
   "_partial_recovery": {
     "expected": 12, "recovered": 10, "lost": 2,
     "reason": "json_repair" | "llm_omitted"
   }
   ```
   `reason="json_repair"` pokud byl použit `_repair_truncated_json` (příznak `_json_repaired=True` propagovaný přes `_merge_chunk_results`).

**Frontend** čte `_partial_recovery` při `fetchEvaluations` a zobrazuje:
- Oranžový badge **⚠ X/N** v levém seznamu studentů (s Tooltip)
- Varující panel přímo v oblasti hodnocení ("Hodnocení je neúplné...")

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
| `app_settings` | Dynamická konfigurace (LLM URL, klíče, modely, prahy, feature flags). |
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

**Metadata v JSONB bez migrace**: Nová pole jako `_partial_recovery`, `_json_repaired`, `_llm_omitted` jsou vkládána přímo do `json_result` dict. Nevyžadují DB migraci — JSONB je schemaless. Frontend je čte podmíněně (`?._partial_recovery ?? null`).

### 3.3 Migrační strategie

- **PostgreSQL (prod):** `run_alembic_migrations()` → `alembic upgrade head`. Záložní `run_migrations()` se volá při selhání Alembic.
- **SQLite (dev):** `init_db()` + `run_migrations()` — "kobercový nálet" přidává chybějící sloupce při každém startu.
- **Nové sloupce** musí být přidány na TŘECH místech: `db_models.py`, `database.py` (SQLite + PostgreSQL větve v `run_migrations()`), a nová Alembic migrace v `alembic/versions/`.

### 3.4 Fast-scan pattern

Při nahrání souborů backend **okamžitě** vytvoří `StudentEvaluation` záznam s `json_result=NULL`. Důvod: UX — lektor vidí studenty v seznamu okamžitě, indikátor průběhu funguje. `json_result` je vyplněn až po dokončení LLM evaluace.

Tento pattern má dopad na filtrování: **všechny dotazy na dokončené výsledky musí filtrovat `json_result IS NOT NULL`** — viz statistiky, dashboard, filter-options. Záznamy s `json_result=NULL` jsou platné DB záznamy, nikoliv chyby.

### 3.5 URL state persistence (v3.9.4)

Fast-scan záznamy mají uložen `source_text` — text ÚZ extrahovaný z původního souboru. `fetchEvaluations()` je načte jako `pending` záznamy i po refreshi prohlížeče. Re-evaluace funguje bez opětovného uploadu souborů — backend vezme `source_text` z DB záznamu místo nahraného souboru.

---

## 4. Bezpečnost a RBAC

### 4.1 Autentizace

JWT Bearer token v hlavičce `Authorization: Bearer <token>`. Každý chráněný endpoint používá `Depends(get_current_lecturer)`. Token expirace konfigurovatelná. Přihlášení: `POST /auth/login` → token.

Prvotní heslo každého nového lektora má příznak `must_change_password=True` — API vrací 403 s instrukcí pro změnu hesla.

### 4.2 Role a oprávnění (RBAC)

| Role | Podmínka | Vidí data |
|---|---|---|
| Lektor | (výchozí) | Pouze vlastní záznamy |
| Admin | `is_admin=True` | Záznamy všech lektorů na stejném `school_location` |
| Superadmin | `is_superadmin=True` | Vše — všechny útvary |

Pomocná funkce `_get_allowed_lecturer_ids()` vrací seznam povolených `lecturer_id` pro aktuálního uživatele (nebo `None` pro superadmina = bez omezení). Filtr se aplikuje na všechny datové endpointy.

`apply_data_isolation()` v `api/auth.py` — centrální helper pro RBAC filtry na SQLAlchemy query.

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
- `./logs/llm_parse_errors:/app/logs/llm_parse_errors` — diagnostické dumpy JSON chyb (přidáno v3.9.5)

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
3. `seeder.py` zkontroluje `PROMPT_VERSION` a případně přepíše výchozí prompty

---

## 7. Architektonická rozhodnutí (ADR)

### ADR-001: Chunking kritérií místo sliding window

**Kontext:** Model qwen3-30b má kontextové okno 16 384 tokenů. Při 20+ kritériích a dlouhém textu ÚZ (10+ stran) se vše nevejde do jednoho promptu.

**Možnosti:**
- *Sliding window*: Rozdělit text ÚZ na části, každou část hodnotit oproti všem kritériím. Problém: kritérium může být doloženo citací z různých částí textu — sliding window kritérium buď nenajde, nebo je duplikuje.
- *Chunking kritérií*: Rozdělit kritéria na skupiny po 6 (`CHUNK_SIZE=6`), každý chunk hodnotit oproti **celému** textu ÚZ.

**Rozhodnutí:** Chunking kritérií. Celý text ÚZ je vždy k dispozici pro každé kritérium. vLLM continuous batching zpracuje N chunků jako jednu GPU dávku — latence je prakticky stejná jako pro jeden request. 25 kritérií → 5 chunků × ~2 s/chunk = ~2 s celkem (paralelně), oproti ~10 s sekvenčně.

**Kompromis:** LLM nevidí, jak hodnotí jiná kritéria z jiného chunku — nemůže detekovat konzistenci mezi kritérii. Akceptovatelné pro daný use-case.

---

### ADR-002: 3-úrovňový JSON fallback místo hard failure

**Kontext:** LLM občas vrací syntakticky nevalidní JSON (neescapované uvozovky v citacích, literální newlines, osamocená zpětná lomítka, oříznutý výstup při token limitu).

**Možnosti:**
- *Hard failure*: Pokud `json.loads()` selže → chyba. Uživatel musí re-evaluovat.
- *Regex extraction*: Extrahovat hodnoty regexem bez parsování. Nespolehlivé pro vnořené struktury.
- *Progressivní fallback*: 3 úrovně pokusů s rostoucí agresivitou opravy.

**Rozhodnutí:** Progressivní fallback:
1. `json.loads()` — bez zásahu
2. `_sanitize_json_string_values()` + `json.loads()` — oprava běžných chyb uvnitř string hodnot
3. `_repair_truncated_json()` — strukturální rekonstrukce z částečného výstupu

Na každé úrovni selhání se od v3.9.5 uloží syrový výstup do souboru pro diagnostiku.

**Kompromis:** Level 3 může zachránit jen část kritérií (pokud byl výstup oříznut uprostřed). To je lepší než ztráta celé evaluace, ale musí být signalizováno lektorovi (FIX C: `_partial_recovery` + UI badge).

---

### ADR-003: Metadata v JSONB bez DB migrace

**Kontext:** V3.9.5 přidává nová metadata do výsledků evaluace (`_partial_recovery`, `_json_repaired`, `_llm_omitted`). Tyto informace mají různou granularitu — `_llm_omitted` je na úrovni jednotlivého kritéria, `_partial_recovery` na úrovni celé evaluace.

**Možnosti:**
- *Nové sloupce v DB*: `partial_recovery_count`, `json_repair_used`, ... Vyžaduje Alembic migraci + SQLite fallback + ORM změny.
- *Nová tabulka*: `evaluation_diagnostics` s FK na `student_evaluations`. Flexibilní, ale komplexní dotazy.
- *Metadata v JSONB*: Vložit prefixovaná pole (`_partial_recovery`, `_llm_omitted`) přímo do existujícího `json_result` (JSONB).

**Rozhodnutí:** Metadata v JSONB. `json_result` je schemaless — libovolná nová pole lze přidat bez migrace. Frontend je čte podmíněně (`?._partial_recovery ?? null`). Backend je zapisuje v-place do dict před uložením. Nulová migrační zátěž.

**Kompromis:** Nelze na tato pole dělat efektivní DB dotazy (např. "všechny evaluace s `_partial_recovery`" by vyžadovaly JSONB operátory). Akceptovatelné — jde o diagnostická metadata, ne o primární data pro reporting.

---

### ADR-004: Man-in-the-Loop schválení před analytikou

**Kontext:** AI evaluace může být nesprávná (halucinace, neúplná kritéria). Nelze nasadit systém, kde by analytika automaticky vstupovala do pedagogického rozhodování bez kontroly lektora.

**Rozhodnutí:** Schválení (`is_approved=true`) je povinné před vstupem záznamu do Phase 3 analytiky a do statistik. Lektor může výsledky opravit (upravit body, odůvodnění) a pak schválit. Schválené záznamy jsou finální — re-evaluace je zakázána (UI disabled).

**Kompromis:** Lektor musí kliknout "Schválit" pro každého studenta. Pro větší třídy (30+ studentů) je to manuální práce. Akceptovatelné — schválení je záměrná kontrolní brána.

**Výjimka**: Re-evaluace je povolena pro záznamy `is_approved=false` (lektor může opravit nesprávné hodnocení opakovanou evaluací). Implementováno v v3.9.3.

---

### ADR-005: Criteria validation (FIX A) jako post-parse krok

**Kontext:** Při testování (29. 4. 2026) bylo zjištěno, že LLM vrací více kritérií než bylo v promptu (1 kritérium v promptu → 19+ položek ve výstupu). Root cause není plně objasněn (hypotéza: LLM extrahuje evaluační šablonu z těla ÚZ).

**Možnosti:**
- *Prompt engineering*: Explicitnější instrukce "TOTO JSOU JEDINÉ POLOŽKY". Částečně implementováno (v3.9.0), ale neřeší halucinace spolehlivě.
- *Pre-filter v promptu*: Nefeasible — nelze předem vědět, co LLM vygeneruje.
- *Post-parse validace*: Po parsování JSON porovnat `vysledky[*].nazev` s `expected_criteria_names`. Odfiltrovat neznámé, doplnit chybějící.

**Rozhodnutí:** Post-parse validace (FIX A). Deterministická, nezávisí na LLM chování. Chybějící kritéria dostávají placeholder s explicitní poznámkou pro lektora, takže Man-in-the-Loop kontrola funguje — lektor vidí, že kritérium nebylo vyhodnoceno a může spustit re-evaluaci.

**Kompromis:** Filtr závisí na přesné shodě `nazev` — pokud LLM nepatrně změní název kritéria (překlep, zkratka), bude položka odfiltrována jako halucinace. V praxi to nenastávalo (model konzistentně kopíruje vstupní `nazev`), ale je to teoretické riziko.

---

### ADR-006: EvaluationQueue — asyncio, ne Celery/RQ

**Kontext:** Hromadná evaluace 30 ÚZ může trvat 10–15 minut. HTTP request nemůže čekat tak dlouho.

**Možnosti:**
- *Celery + Redis*: Distribuovaná fronta. Robustní, ale výrazná infrastrukturní zátěž (Redis, Celery worker, monitoring).
- *Background threads*: `threading.Thread`. Problémy s async/await, GIL, sdílení DB session.
- *asyncio in-process queue*: `asyncio.Queue` + worker coroutine v rámci FastAPI procesu. Jednoduchá, nulová infrastruktura.

**Rozhodnutí:** asyncio in-process queue. Aplikace běží jako jeden Docker kontejner — distribuovaná fronta je over-engineering. FastAPI je nativně asyncio → integrace je přirozená. `asyncio.Semaphore` limituje souběžnost. Celá logika v `EvaluationQueue` třídě.

**Kompromis:** Restart kontejneru ztratí nevyřízené úlohy. Akceptovatelné — lektor to vidí (frontend status) a může dávku pustit znovu. Škálování na více instancí by vyžadovalo přechod na Celery, ale pro daný scale (jedna škola, desítky lektorů) není potřeba.

---

## 8. Historie vývoje (Changelog)

### v3.9.5 (Aktuální) — JSON pipeline diagnostika a robustnost

- **FIX B — Raw LLM dump při parse erroru** (`llm_engine.py`, `docker-compose.yml`): Nová `_dump_raw_llm_output()` ukládá syrový výstup LLM do `/app/logs/llm_parse_errors/` při každém JSON parse erroru. Soubor obsahuje chybový typ, pozici chybného znaku s 100-znakovým kontextem a kompletní raw output. Volume mount `./logs/llm_parse_errors:/app/logs/llm_parse_errors` zajišťuje persistenci přes restarty kontejneru.

- **FIX A — Criteria validation** (`llm_engine.py`, `evaluate.py`): `_validate_and_fix_vysledky()` filtruje halucinovaná kritéria (LLM vrátil název, který nebyl v promptu) a doplňuje chybějící jako placeholdery s `_llm_omitted=true`. `evaluate_report()` má nový parametr `expected_criteria_names: list[str]`. `evaluate_batch` sestavuje jmenný seznam z `individual_criteria` a předává ho každému tasku.

- **FIX C — Partial recovery detection + UI** (`llm_engine.py`, `evaluate.py`, `src/`): `_check_partial_recovery()` detekuje `_llm_omitted` placeholdery a vkládá `_partial_recovery` metadata do `json_result` (JSONB, bez migrace). Příznak `_json_repaired=True` se nastavuje při použití `_repair_truncated_json` a propaguje přes `_merge_chunk_results`. Frontend: oranžový badge `⚠ X/N` v seznamu studentů + varující panel v detailu hodnocení.

- **FIX D — Sanitizer edge cases** (`llm_engine.py`): `_sanitize_json_string_values()` rozšířena o osamocená zpětná lomítka (→ `\\`) a kontrolní znaky `0x00–0x1F` (→ `\uXXXX`).

### v3.9.4 — URL state persistence, analytics refresh, scroll-to-top, statistics filter-options

- **URL state persistence** (`App.tsx`): `activeTab` a `activeScenarioId` inicializovány z URL search params, synchronizovány zpět přes `window.history.replaceState`. SPA přežije browser refresh. Re-evaluace funguje bez opětovného uploadu (fast-scan záznamy mají uložen `source_text`).
- **Analytics refresh při přepnutí záložky** (`TabAnalytics.tsx`, `App.tsx`): Prop `isActive: boolean` + `useEffect([isActive])` — `fetchAnalytics()` se spustí při každém přepnutí na záložku.
- **Tlačítko ↑ "Přejít nahoru"** (`TabEvaluation.tsx`): `studentListScrollRef` na levý panel. Dříve scrollovalo pravý panel (tabulku hodnocení).
- **Statistics filter-options — scénáře bez evaluací** (`statistics.py`): Filtr `json_result IS NOT NULL` přidán do `scenario_query` v `/statistics/filter-options`.

### v3.9.3 — Bugfixy: statistiky, scroll, re-evaluace

> ⚠️ Toto je poslední verze před plánovaným redesignem Phase 1 (přechod na model s 256k kontextem).

- **Statistiky** (`statistics.py`): Filtr `json_result IS NOT NULL` v `/statistics/dashboard` — fast-scan záznamy se nepočítají do statistik.
- **Scroll v panelu Hodnotící kritéria** (`TabCriteria.tsx`): `overflowY: 'auto'` na textarea.
- **Re-evaluace neschválených záznamů** (`TabEvaluation.tsx`): `canEvaluate` povoluje znovu vyhodnotit studenta s `is_approved=false`.

### v3.9.0–v3.9.2 — Prompt optimalizace pro qwen3-30b + JSON sanitizace

- **v3.9.0:** Optimalizace promptů pro qwen3-30b-instruct (non-reasoning). `PROMPT_VERSION` upgrade systém.
- **v3.9.1:** `_sanitize_json_string_values()` — oprava `Expecting ',' delimiter` při přímé řeči v citacích.
- **v3.9.2:** Oprava look-aheadu sanitizace (vzor `"value""key":` bez čárky) + per-block sanitizace v `_repair_truncated_json`.

### v3.8.7 — Individuální zpětná vazba + Admin prompt

- **Phase 2b:** `_generate_individual_feedback()` — personalizovaná zpětná vazba po merge chunk výsledků (max. 600 tokenů). Fail-safe: chyba neblokuje uložení evaluace.
- **Admin UI:** Panel pro editaci promptu `prompt_feedback`.

### v3.8.4–v3.8.6 — Token budget, retry, Phase 3 filtrování

- **v3.8.6:** Filtrování kritérií pro Phase 3 dle `ANALYTICS_THRESHOLD` (výchozí 80 %).
- **v3.8.5:** Token budget 500 tokenů/kritérium — eliminuje JSON truncation u obsáhlých ÚZ.
- **v3.8.4:** Chunk retry s `temperature=0.3`; `_llm_call_with_overflow_retry()` pro HTTP 400.

### v3.8.2–v3.8.3 — Chunking kritérií + JSON recovery

- `_split_criteria_chunks()`: regex lookahead split, `CHUNK_SIZE=6`, `asyncio.gather` parallelism.
- `_repair_truncated_json()`: recovery z partially truncated JSON výstupu.

### v3.7.0 — Export, scenario_display_name, Statistics

- **TabStatistics (TabMonitor):** Analytická karta pro Superadminy a Adminy. Recharts vizualizace. Excel export (`openpyxl`). Router `api/statistics.py` s RBAC.
- **DB:** `Lecturer.is_admin`, `StudentEvaluation.created_at`, `scenario_display_name`.

### v3.3.0–v3.3.1 — Data isolation, Multi-instructor, WebSocket fix

- Kompletní izolace dat mezi lektory (Multi-Tenancy) — filtry `lecturer_id` na všech endpointech.
- WebSocket fronta izolována podle `lecturer_id`.
- `run_migrations()` — kobercový nálet pro SQLite, oprava `403 Forbidden` u WebSocket.

### v3.2.x — Parallel processing, Dark mode, vLLM integration

- **v3.2.5:** Oprava paralelního zpracování (odstraněn redundantní zámek). Dark mode redesign.
- **v3.2.2:** `EvaluationQueue` se semaphore souběžnosti. vLLM batching.
- **v3.2.0–v3.2.1:** Opravy `NameError` v `llm_engine.py`, respektování `Max Output Tokens` z DB.

### v2.0.2 — Google Gemini & UI Filter

- Podpora Google AI Studio (Gemini) přes OpenAI kompatibilní rozhraní.
- Filtrace AI chatu — do pole kritérií se propisuje pouze část za oddělovačem `---`.

---

*Poslední aktualizace dokumentace: 29. dubna 2026*
