# Technická dokumentace EVALUZ
**Verze:** 3.13.1  
**Poslední aktualizace:** 5. srpna 2026  
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
- **Deduplicace (od v3.10.3)**: `_active_keys: Set[str]` sleduje klíče `{lecturer_id}:{scenario_id}:{filename}`. `add_task()` přeskočí studenta pokud je klíč aktivní (vrátí `False`). Klíč se uvolní v `_run_task()` finally — i při chybě. Zabraňuje duplicitnímu vyhodnocení při re-submitu dávky (např. page refresh).
- **Zrušení**: `DELETE /evaluate/batch` vyčistí frontu nevyřízených úloh.

### 1.5 WebSocket a real-time UX

Endpoint `/evaluate/ws?lecturer_id=X&token=Y` — duplex spojení per-lektor.

Typy zpráv (server → client):
- `EVAL_START` — student začal zpracování
- `EVAL_SUCCESS` — kritéria vyhodnocena a uložena do DB (bez zpětné vazby); frontend volá `fetchEvaluations()`
- `FEEDBACK_DONE` — zpětná vazba doplněna do DB; frontend volá `fetchEvaluations()` znovu
- `EVAL_ERROR` — student selhal (neblokuje ostatní)

`EVAL_SUCCESS` přichází ihned po dokončení chunking+validace (typicky ~3–5 s). `FEEDBACK_DONE` přichází asynchronně po dalších ~15–60 s. Lektor vidí výsledky kritérií okamžitě; pole `zpetna_vazba` se doplní při druhém refresh.

**WS reconnect (od v3.10.2):** `wsConnectCountRef` počítá připojení; při reconnectu (count > 1) `onopen` volá pouze `fetchEvaluations()` bez jakéhokoli resetu stavů. Zamezuje automatickému re-submitu dávky po reconnectu. Self-healing `useEffect` monitoruje `students` pole a resetuje `isEvaluating` jakmile žádný student nemá status `'evaluating'`.

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

**Od v3.10.1 běží mimo critical path (ADR-010):** `evaluate_report()` vrátí `zpetna_vazba=""`. Po odeslání `EVAL_SUCCESS` je spuštěn `spawn_background(_run_feedback_task(...))` — ten volá `generate_feedback_for_record()` (public wrapper čtoucí nastavení z DB), provede partial update `json_result.zpetna_vazba` v DB, a odešle `FEEDBACK_DONE` WebSocket notifikaci.

> **Od v3.13.1 (ADR-020) přes `utils/tasks.py::spawn_background()`, ne přes holé `asyncio.create_task()`.** Event loop drží na tasky jen slabé reference, takže GC mohl zpětnou vazbu zlikvidovat uprostřed běhu — tiše, bez chyby v logu. Projevovalo se to tím, že se u dávky feedback uložil jen některým studentům.

`FEEDBACK_MAX_TOKENS` konfigurovatelný v DB (výchozí 250 — 3–5 vět v češtině ≈ 150–180 tokenů). Chyba zpětné vazby neblokuje uložení výsledků evaluace.

#### Phase 3 — Analýza třídy
LLM dostane agregovaná data celé třídy a generuje pedagogický komentář. Kritéria s úspěšností nad `ANALYTICS_THRESHOLD` (výchozí 80 %) jsou z LLM promptu filtrována — LLM se soustředí na problematické oblasti. Frontend heatmapa zobrazuje kompletní statistiky všech kritérií bez ohledu na threshold.

**Analytics force gate (od v3.10.4):** `generate_class_summary()` spustí AI generování pouze s `force=True`. Bez force a bez cache vrátí `{"status":"no_analysis"}` — frontend zobrazí card s tlačítkem "Generovat analýzu". Zabraňuje duplicitnímu LLM volání při page refresh.

### 2.4 Adaptivní chunking

Před sestavením promptu `evaluate_report()` odhadne tokeny:

```python
def _estimate_tokens(text: str) -> int:
    """Odhadne počet tokenů podle délky textu.

    Používáme 2,5 znaků/token — konzervativní odhad pro českou diakritiku.
    Qwen a podobné modely tokenizují češtinu hustěji než angličtinu (cca 2,0–2,5 zn/token),
    hodnota 3,5 původně kalibrovaná na angličtinu podhodnocovala vstup až o 40 %.
    """
    return max(1, int(len(text) / 2.5))
```

Rozhodovací logika:
```
est_tokens = _estimate_tokens(system_prompt + report_text + criteria_markdown) + max_tokens
budget     = context_window × CHUNK_THRESHOLD_TOKENS_PCT  (výchozí 0.7)

if est_tokens <= budget:
    → přímé volání (1 LLM request)
else:
    → _split_criteria_chunks(criteria_markdown, CHUNK_SIZE)
    → asyncio.gather(*[_evaluate_chunk(chunk, ...) for chunk])
    → _merge_chunk_results(results)
```

`CHUNK_SIZE` a `CHUNK_THRESHOLD_TOKENS_PCT` jsou čteny z DB (`AppSettings`) při každém volání — lze měnit za běhu bez restartu.

#### Token budget — ostrý provoz (25 kritérií + 10 normostran)

| Složka | Znaky | Tokeny (`/2.5`) |
|---|---|---|
| 10 normostran (10 × 1 800 zn.) | 18 000 | ~7 200 |
| System prompt | ~3 500 | ~1 400 |
| User instrukce + boilerplate | ~1 400 | ~560 |
| 6 kritérií (chunk) | ~2 500 | ~1 000 |
| **Input celkem/chunk** | | **~10 160** |
| Output/chunk (6 × 500 + 300) | | 3 300 |
| **Celkem/chunk** | | **~13 460** |

Pro spolehlivý provoz je doporučeno spustit vLLM s `--max-model-len 32768`. Hodnota 16 384 je pro 10+ normostran těsná; 4 096 (vLLM default) nestačí vůbec.

#### Overflow retry (`_llm_call_with_overflow_retry`)

Při HTTP 400 "context length exceeded" mechanismus automaticky sníží `max_tokens` na `limit − input_tokens − 300` a zopakuje volání. Od v3.10.6 regex detekuje obě varianty chybové zprávy:

- **OpenAI formát**: `(\d+) in the messages`
- **vLLM formát**: `your prompt contains at least (\d+) input tokens`

Log per chunk (od v3.10.6): `[chunk N] n_criteria=X, est_input≈Y, max_tokens=Z, total≈W`

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
  • kanonizační match (viz sekce 2.6)
  • doplní chybějící jako placeholder (_llm_omitted=True, body=0)
  • přepočítá celkove_skore
       │
       ▼
    return parsed  ← zpetna_vazba="" (feedback není v critical path)
       │
       ▼ (po EVAL_SUCCESS broadcast — spawn_background, viz ADR-020)
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

`_canonicalize_criterion_name()` normalizuje název kritéria pro porovnání (od v3.10.7):

1. **Strip prefixu** `**N. Kritérium:` — LLM někdy zkopíruje formát z promptu
2. **Strip trailing bold** `**`
3. **Normalizace pomlček** — em-dash (—) a en-dash (–) → hyphen (-); LLM konzistentně mění typ pomlčky
4. **Strip person-suffix** — heuristika `_PERSON_SUFFIX_RE` odstraní poslední ` – Jméno Příjmení` a volitelnou závorku za jménem, např. `– Ivana Horáková (negativní)`. Kotveno na konec stringu — nenarušuje popisné pomlčky uprostřed jako `– minimálně jméno, příjmení`
5. **Lower-case + strip**

```
Příklady (v3.10.7):
"7. Kritérium: Ztotožnění osoby – ... – Ivana Horáková"
  → strip prefix → strip dash-normalize → strip suffix
  → "ztotožnění osoby – minimálně jméno, příjmení, datum narození"  ✓

"8. Kritérium: Výsledek lustrace – PATROS - Ivana Horáková (negativní)"
  → "výsledek lustrace - patros"  ✓  (závorka za jménem tolerována od v3.10.7)
```

`nazev` v DB/UI se normalizuje na expected verzi; původní LLM název zůstane v `_llm_actual_name` pro audit.

**Fronta expected kritérií** (`canonical_queue`): každé expected kritérium = samostatný FIFO slot. Dvě kritéria se stejným kanonickým základem (např. `"ztotožnění osoby – ..."` pro Horáková i Kadlece) mají každé vlastní slot — zabraňuje ztrátě jednoho při merge.

**Fallback substring match** (od v3.10.7): pokud přesná kanonická shoda selže, hledá expected kritérium, jehož canonical je podřetězcem LLM canonical nebo naopak. Loguje na DEBUG. Primární cestou zůstává přesný match.

**Zbývající omezení**: pokud LLM parafráuje název kritéria (zkrátí nebo přepíše), matching selže i po kanonizaci. Jedná se o LLM halucinaci — řeší se na úrovni promptu, ne matchingu.

**Multi-person duplikát**: model může stejné kritérium vrátit vícekrát. Zachovává se první výskyt; duplicity jsou logovány.

**Oddělovač kritérií**: mezi kritéria v promptu je vkládán řetězec `#############` (konstanta `CRITERIA_DELIMITER`). `_split_criteria_chunks()` má primární cestu přes delimiter, legacy regex lookahead jako fallback pro starší data.

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

**Od v3.10.3:** `_seed_setting(db, key, value)` — každý klíč má vlastní `db.commit()` + `try/except rollback`. Odstraňuje batch commit způsobující `IntegrityError` na existujících DB.

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

Existují dva Compose soubory pro dvě různé topologie — použij ten odpovídající cíli nasazení, ne jen výchozí `docker-compose.yml`.

### 6.1 `docker-compose.yml` — jednoduchá topologie (frontend = vlastní nginx)

Tři služby: `db` (PostgreSQL), `backend` (FastAPI), `frontend` (Nginx + React SPA, nginx běží přímo v tomto kontejneru).

Porty:
- `8001:80` — HTTP (redirect na HTTPS)
- `8443:443` — HTTPS (self-signed nebo vlastní certifikát, volume `./ssl:/etc/nginx/ssl`)
- Port 8000 (backend) není exponován navenek — přístup pouze přes frontend kontejner.

Volumes:
- `pgdata` — PostgreSQL data (named volume)
- `./backend/data:/app/data` — uploadovaná data
- `./logs/llm_parse_errors:/app/logs/llm_parse_errors` — diagnostické dumpy JSON chyb

### 6.1b `docker-compose.prod.yml` — topologie se samostatným reverse proxy

Čtyři služby: `db`, `backend`, `frontend` (jen statické soubory) a samostatný `proxy` (nginx, konfigurace v `nginx/evaluz.conf`), který routuje `/api/` na backend a `/` na frontend. Backend i frontend jsou interní (síť `internal`), přístupné pouze přes `proxy`.

Port:
- `3000:80` — jediný exponovaný port (nginx proxy). Externí reverse proxy hostitele/organizace by měl na tento port směrovat HTTPS provoz.

Použití:
```bash
cp .env.example .env && nano .env
docker compose -f docker-compose.prod.yml up -d --build
```
Aktualizace na novou verzi: `git pull origin main && docker compose -f docker-compose.prod.yml up -d --build` (Alembic migrace proběhnou automaticky při restartu backendu).

### 6.2 Generování SSL certifikátu

```bash
./generate-ssl.sh
```
Generuje self-signed certifikát pro intranetové nasazení (relevantní pro `docker-compose.yml`; `docker-compose.prod.yml` řeší TLS na úrovni externího reverse proxy hostitele). Pro produkci nahradit vlastním certifikátem (Let's Encrypt nebo CA organizace).

### 6.3 Environment variables

Citlivé hodnoty (DB heslo, JWT secret, CORS, LLM API klíče) v `.env` v **kořeni repozitáře** (ne `backend/.env` — oba docker-compose soubory čtou `.env` relativně ke svému umístění, tedy z rootu). Tento soubor se NIKDY nesmí nahrávat do Gitu (`.gitignore: .env*`). Šablona: `.env.example`. Oba compose soubory musí mít u služby `backend` (a `docker-compose.prod.yml` i u `db`) nastavené `env_file: .env` — bez toho se do kontejneru nedostane nic kromě explicitně vyjmenovaných `environment:` proměnných a validace secrets v `core/config.py` (viz sekce 4) se nikdy neuplatní. LLM konfigurace je také editovatelná za běhu přes Admin UI (uložena v `app_settings`) — `.env` hodnoty `VLLM_API_URL`/`VLLM_MODEL_NAME` slouží jen jako počáteční seed.

`backend/Dockerfile` instaluje závislosti z `backend/requirements.lock.txt` (zamčené verze, viz ADR-013), ne z volného `requirements.txt` — po úpravě `requirements.txt` je nutné lock přegenerovat postupem v hlavičce toho souboru.

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
├── test_llm_pipeline.py         # unit testy (43 testů)
├── test_evaluation_queue.py     # EvaluationQueue: dedup, broadcast/NOTIFY, souběžný přístup
│                                #   ke spojení, terminální událost, clear_queue (16 testů,
│                                #   viz ADR-011, ADR-015, ADR-017)
├── test_criteria_matching.py    # parser kritérií + přiřazení výsledků LLM (14 testů, ADR-019)
├── test_class_scoping.py        # rozsah třídy, kontrakt classes/ensure (6 testů, ADR-021)
├── test_data_isolation.py       # RBAC/cross-tenant regresní testy (3 testy, viz ADR-014)
└── integration/
    ├── __init__.py
    ├── conftest.py              # in-memory SQLite, MockLLMRouter, FastAPI client
    ├── mock_llm.py              # MockLLMRouter — FIFO respx interceptor
    └── test_evaluate_endpoint.py  # integrační testy (9 testů)
```

Celkem: **91 testů** (spuštění: `cd backend && pytest tests/ -v`).

> **Pozor na in-memory SQLite napříč vlákny:** `sqlite:///:memory:` dává KAŽDÉMU spojení
> vlastní prázdnou databázi, a `TestClient` obsluhuje requesty v jiném vlákně než test.
> Fixture, přes kterou aplikace zapisuje, proto musí použít `poolclass=StaticPool`
> (viz `test_class_scoping.py`) — jinak request spadne na `no such table`. Testy je nutné spouštět přes venv/interpreter, který má nainstalované `requirements.txt` + `requirements-dev.txt` (např. `backend/venv/bin/pytest`) — systémový/globální `pytest` bez těchto závislostí selže na `ModuleNotFoundError`.

### 7.2 Unit testy (`test_llm_pipeline.py` — 43 testů)

Pokrývají klíčové vrstvy `llm_engine.py` bez sítě, DB ani vLLM:
- `_canonicalize_criterion_name`: strip prefix, person suffix, popisné pomlčky
- `_validate_and_fix_vysledky`: validace, multi-person duplikáty, `_llm_actual_name`
- `_sanitize_json_string_values`: regress na v3.9.1 quotes, v3.9.5 lone backslash + control chars
- `_split_criteria_chunks`: delimiter primární + legacy fallback
- `_merge_chunk_results`: sloučení chunků
- `parse_criteria_markdown`: delimiter + legacy
- Integrační test reprodukující reálný case Kořař z 29. 4. 2026

### 7.3 Integrační testy (`test_evaluate_endpoint.py` — 9 testů)

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

### 7.3b RBAC regresní testy (`test_data_isolation.py` — 3 testy)

Pokrývají incident z ADR-014 (fail-closed `DataScope`): ověřují, že osobní endpointy (`/analytics/class/{id}` apod.) nikdy nevrátí data jiného vyučujícího ani při roli Admin/SuperAdmin, a že `GET /statistics/filter-options` nezobrazí cizí scénáře, které by šlo zneužít přes osobní endpoint.

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
4. `asyncio.create_task(_run_feedback_task(...))` spuštěno v `process_single_file_bg` ihned po `EVAL_SUCCESS` broadcastu. *(Aktualizace v3.13.1: nahrazeno `spawn_background()` — holé `create_task()` nechávalo task napospas GC, viz ADR-020.)*
5. Frontend: handler `FEEDBACK_DONE` → `fetchEvaluations()`.
6. `FEEDBACK_MAX_TOKENS` snížen z 600 na 250 (výchozí), konfigurovatelný v DB.

**Výsledek:** Lektor vidí výsledky kritérií za ~3–5 s (chunking fáze). Zpětná vazba se doplní async za dalších ~15–60 s bez blokování dalších evaluací.

**Kompromis:** Mezi `EVAL_SUCCESS` a `FEEDBACK_DONE` lektor vidí prázdné pole zpětné vazby. To je vědomý UX trade-off — pole je jasně označeno jako „generuji…" nebo je jednoduše prázdné. Partial DB update (přepis `json_result`) je atomický na úrovni ORM — žádný souběžný problém (feedback task je jediný zapisovatel tohoto pole po EVAL_SUCCESS).

---

### ADR-011: EvaluationQueue deduplicace — Set klíčů místo DB check (v3.10.3)

**Status:** Decided & Implemented

**Kontext:** Page refresh během evaluace způsoboval re-submit dávky → 2 souběžné LLM požadavky na stejný ÚZ → OpenRouter throttloval → 200–400s místo ~50s. WS reconnect fix (v3.10.2) eliminoval automatický re-submit, ale manuální re-submit (nebo programový race condition) byl stále možný.

**Možnosti:**
- A: DB check — před přidáním do fronty ověřit, že `json_result IS NULL` a záznam neexistuje s datem < 5 min. Pomalé (DB query per task) a nepřesné (nezachytí tasks aktivně zpracovávané).
- **B (zvoleno): In-memory Set** — `_active_keys: Set[str]` na instanci `EvaluationQueue`. Přidá se při `add_task()`, odstraní se v `_run_task()` finally. O(1) lookup, žádný DB overhead.

**Rozhodnutí:** Set klíčů `{lecturer_id}:{scenario_id}:{filename}`. Pokrývá jak čekající (v queue) tak aktivně zpracovávané studenty. `add_task()` vrací `False` pro duplicitu — volající může logovat/ignorovat.

**Kompromis:** In-memory stav → ztráta při restartu serveru. Přijatelné: restart vyčistí i asyncio queue; lektor re-submituje vědomě.

---

### ADR-012: Analytics force gate — explicitní oddělit read od generate (v3.10.4)

**Status:** Decided & Implemented

**Kontext:** `GET /analytics/class/1/summary` bez `force=True` měl fallthrough: pokud cache neexistuje → spustí AI generování stejně. Page refresh během generování zavolal endpoint znovu (force=False), cache ještě nebyla zapsána → druhé souběžné LLM volání → 2× ~20s OpenRouter request, 2× zápis do cache.

**Možnosti:**
- A: Generační lock/semafor v backendu — složité, musí být distribuované pro více workerů.
- B: Return 202 Accepted + polling — komplexní frontend logika.
- **C (zvoleno): Striktní oddělení** — `force=False` NIKDY nespouští generování. Pokud cache neexistuje → `{"status":"no_analysis"}`. Generování pouze `force=True` (explicitní klik uživatele).

**Rozhodnutí:** Jednořádková změna v `generate_class_summary()`. Frontend přijme `no_analysis` a zobrazí card s tlačítkem. UX je jasnější: uživatel vědomě spouští generování.

**Kompromis:** Po invalidaci cache (re-evaluace studenta) se analytics neaktualizuje automaticky. Lektor musí kliknout "Generovat analýzu". Přijatelné — Man-in-the-Loop principy zachovány.

---

### ADR-013: Zamčené závislosti generované uvnitř cílového kontejneru (v3.11.2)

**Status:** Decided & Implemented

**Kontext:** Příprava nasazení na testovací server odhalila, že `backend/requirements.txt` neobsahuje žádný exaktní pin (`==`) — pouze holé názvy balíčků nebo `>=` floor. `docker compose build` tak při každém buildu stahuje aktuálně nejnovější kompatibilní verze z PyPI, které se mohou lišit od verzí otestovaných lokálně. Navíc lokální dev venv běží na Python 3.13, zatímco `backend/Dockerfile` je `python:3.10-slim` — lock vygenerovaný z dev venv (`pip freeze`) obsahoval balíčky (např. `numpy==2.5.1`), které pro Python 3.10 na PyPI vůbec neexistují, a build v Dockeru selhal.

**Možnosti:**
- A: Ponechat volné `requirements.txt` — jednoduché, ale nereprodukovatelné (viz Dev/Prod Parity riziko).
- B: Zamknout verze pomocí `pip freeze` z lokálního dev venv — rychlé, ale nekompatibilní s runtime verzí Pythonu v Dockerfile (viz výše).
- **C (zvoleno):** Vygenerovat lock soubor spuštěním `pip install -r requirements.txt && pip freeze` **uvnitř kontejneru se stejným base image jako Dockerfile** (`python:3.10-slim`), ne v lokálním venv.

**Rozhodnutí:** `backend/requirements.lock.txt` obsahuje verze rozřešené přímo v `python:3.10-slim`. `backend/Dockerfile` instaluje z tohoto souboru (`pip install -r requirements.lock.txt`), ne z volného `requirements.txt`. Před commitem ověřeno 55/55 testů v obraze postaveném s tímto lockem.

**Kompromis:** Lock je nutné ručně přegenerovat po každé úpravě `requirements.txt` (postup v hlavičce `requirements.lock.txt`) — bez automatizace (Dependabot/Renovate) hrozí, že lock zestárne a přestane odrážet bezpečnostní opravy upstream balíčků.

---

### ADR-014: RBAC `DataScope` — explicitní a fail-closed místo odvozeného z role (v3.11.0)

**Status:** Decided & Implemented

**Kontext:** Forenzní audit po incidentu z v3.10.9 zjistil, že `apply_data_isolation()` odvozovala viditelnost dat implicitně z role volajícího (`is_admin`/`is_superadmin`). Protože přes stejnou funkci procházely i osobní endpointy (např. `GET /analytics/class/{id}`), Admin/SuperAdmin viděl na vlastním Evaluation tabu i cizí vyhodnocení a scénáře jiných vyučujících. `GET /statistics/filter-options` navíc tato cizí scénář ID vracel do frontendu, který je pak dotazoval přes osobní endpointy — cross-tenant únik dat.

**Možnosti:**
- A: Opravit `apply_data_isolation()` tak, aby detekovala "osobní" vs. "manažerské" endpointy podle URL cesty — křehké, snadno se rozejde při přidání nového endpointu.
- **B (zvoleno):** Explicitní parametr `scope: DataScope` (`PERSONAL` / `LOCATION` / `GLOBAL`) na každém volání, default `PERSONAL` — fail-closed bez ohledu na roli volajícího.

**Rozhodnutí:** Každý endpoint musí explicitně požádat o širší scope. Pouze `backend/api/statistics.py` (manažerský dashboard) opt-in na `scope=LOCATION`/`GLOBAL`. Nový default (`PERSONAL`) znamená, že chybějící/zapomenutý parametr vede k bezpečnějšímu chování (méně dat), ne k úniku.

**Kompromis:** Každé nové volání `apply_data_isolation()` vyžaduje vědomé rozhodnutí o scope — o něco víc psaní na volací straně výměnou za to, že chybějící rozhodnutí selže bezpečně. Regresní kryt: `backend/tests/test_data_isolation.py` (viz sekce 7.3b).

---

### ADR-015: EvaluationQueue WebSocket doručení přes Postgres LISTEN/NOTIFY (v3.12.0)

**Status:** Decided & Implemented

**Kontext:** Pilotní testování odhalilo 100% reprodukovatelný bug — dávkové vyhodnocení ÚZ doběhne na backendu (LLM zavolán, JSON zparsován, DB commit OK), ale UI se to nikdy nedozví: kolečko se po ~2-3 minutách zastaví, ÚZ zůstanou nevyhodnocené. `backend/Dockerfile` spouští `uvicorn main:app --workers 2` — dva nezávislé OS procesy. `EvaluationQueue.active_connections` (registr WebSocket spojení) i `_active_keys` (dedup množina, ADR-011) jsou čistě in-memory objekty na module-level singletonu `eval_queue`, instancovaném **zvlášť v každém procesu**, bez sdíleného stavu. Jádro OS distribuuje příchozí WS spojení i HTTP požadavky mezi oba procesy nedeterministicky (žádná session affinity). Pokud `POST /evaluate/batch` a WS spojení téhož lektora skončí na RŮZNÝCH procesech, broadcast dokončení (`eval_queue.broadcast(...)`) zasáhne jen registr toho procesu, který úkol zpracoval — `broadcast()` u neznámého `lecturer_id` tiše vrátí, žádná výjimka, žádný log. DB je v pořádku (Postgres je sdílený), ale prohlížeč na druhém procesu se nikdy nic nedozví. Efektivně házení mincí při každém páru (WS spojení, HTTP request) — vysvětluje, proč se bug neprojevil při každém testování.

**Možnosti:**
- A: `--workers 1` — eliminuje split-brain okamžitě, jedna řádková změna. Zvažováno jako rychlá provizorní oprava; propustnost vyhodnocování by neklesla (souběžnost je řešená `asyncio.Semaphore` uvnitř jednoho procesu, ne počtem OS procesů), ale neškáluje na budoucí nasazení s vyšší HTTP zátěží/více replikami.
- B: Redis pub/sub — architektonicky čisté, ale nová infrastrukturní závislost bez jiného důvodu k zavedení.
- **C (zvoleno):** Postgres LISTEN/NOTIFY — Postgres už je k dispozici (sdílená DB), žádná nová infrastruktura. Řeší problém trvale i při budoucím zvýšení `--workers`.

**Rozhodnutí:** `backend/services/evaluation_queue.py` — `broadcast()` už neiteruje `active_connections` přímo, vždy publikuje `SELECT pg_notify($1, $2)` na kanál `evaluz_eval_events` přes dedikované `asyncpg` spojení. Každý proces v `main.py`'s `lifespan()` spustí `eval_queue.start_listening(DATABASE_URL)` (jen pro PostgreSQL — SQLite dev prostředí LISTEN/NOTIFY nepodporuje, `broadcast()` tam degraduje na přímé lokální doručení). Synchronní asyncpg callback `_on_notify` naplánuje asynchronní doručení jen socketům registrovaným v TOM procesu, který NOTIFY přijal — což zahrnuje i proces, který NOTIFY sám vyslal (Postgres doručuje všem posluchačům kanálu). Vedlejší oprava zdarma: doručení iteruje kopii listu (`list(...)`), ne živý sdílený list — řeší mutation-during-iteration hazard při souběžném `disconnect()`.

**Kompromis:** O něco vyšší latence per-message (DB round-trip místo přímé in-memory operace) — zanedbatelné pro tento use-case (desítky zpráv, ne tisíce/s). Retry smyčka v `start_listening` (5s backoff) řeší výpadek DB spojení, ale `_active_keys` dedup (ADR-011) zůstává per-proces — teoreticky nedokonalé při souběžném double-submitu napříč procesy ve stejném okamžiku (mimo rozsah nahlášeného bugu, zaznamenáno jako známé omezení).

---

### ADR-016: LLM concurrency dělená počtem uvicorn workerů (v3.12.0)

**Status:** Decided & Implemented

**Kontext:** Při přípravě na nasazení pro víc současně pracujících lektorů se ukázalo, že `EvaluationQueue` je (stejně jako v ADR-015) per-proces singleton — `asyncio.Semaphore(concurrency)` uvnitř `worker()` se vytváří nezávisle v každém ze `--workers N` procesů. `main.py::_resolve_worker_concurrency()` načítá `LLM_CONCURRENCY_VLLM`/`LLM_CONCURRENCY_OPENROUTER` z Administrace (výchozí 8) a předávala ho **beze změny** do každého procesu — s `--workers 2` tedy mohl být na sdílený vLLM/GPU server současně vyslán až 2× vyšší počet požadavků (např. 16 místo 8), než admin skutečně nastavil, bez jakékoli koordinace mezi procesy. Neprojevilo se to při jednom lektorovi (jeho dávka se prostě rozložila mezi procesy), ale s víc lektory pracujícími souběžně by se mohl sdílený LLM server přetížit nad rámec zamýšlené kapacity.

**Možnosti:**
- A: Cross-proces koordinovaný semafor (např. přes Postgres advisory locky nebo Redis) — architektonicky přesné, ale zbytečná složitost pro tento rozsah nasazení.
- **B (zvoleno):** Vydělit nastavenou concurrency počtem worker procesů (`settings.UVICORN_WORKERS`) — jednoduché, žádná nová infrastruktura, přesně obnovuje původně zamýšlený celkový limit.

**Rozhodnutí:** `backend/core/config.py` — nové nastavení `UVICORN_WORKERS` (výchozí 2), čtené ze stejnojmenné env proměnné. `backend/Dockerfile` definuje `ENV UVICORN_WORKERS=2` jako JEDINÝ zdroj pravdy a `--workers ${UVICORN_WORKERS}` v CMD z něj čte — při změně počtu workerů stačí upravit jednu proměnnou, ne dvě nezávislá místa. `main.py::_resolve_worker_concurrency()` dělí načtenou hodnotu `settings.UVICORN_WORKERS` (`max(1, total // workers)`), takže součet napříč všemi procesy odpovídá tomu, co admin nastavil v Administraci.

**Kompromis:** Dělení je celočíselné (`//`) — u malých hodnot concurrency (např. 3 při 2 workerech) může efektivní celkový limit být o trochu nižší než nastavená hodnota (zaokrouhleno dolů, `max(1, ...)` navíc garantuje aspoň 1 na proces). Přijatelné — bezpečnější podhodnotit než přehodnotit kapacitu sdíleného LLM serveru.

---

### ADR-017: Serializovaný přístup ke sdílenému asyncpg spojení + invariant terminální události (v3.13.0)

**Status:** Decided & Implemented

**Kontext:** Testovací provoz odhalil, že z dávky 3 ÚZ se vyhodnotí jen první a zbylé se musí spouštět opakovaně ručně. Log ukazuje deterministický vzorec: dávka 3 → 1 přežije, dávka 4 → 1 přežije, dávka 1 → vždy OK; u ostatních `Chyba při zpracování úkolu: cannot perform operation: another operation is in progress`. Tahle hláška pochází výhradně z asyncpg a v celé aplikaci existuje jediné asyncpg spojení — `EvaluationQueue._pg_conn`, zavedené v ADR-015 pro LISTEN/NOTIFY. Jedno asyncpg spojení **nesmí obsluhovat dvě korutiny naráz**, ale `broadcast()` ho volá z každé úlohy; při dávce běží N úloh souběžně, první spojení zabere a zbylé okamžitě padnou. Regrese pochází přímo z ADR-015 — předtím `broadcast()` doručoval in-memory a žádné DB spojení nepoužíval.

Druhá polovina problému je viditelnost: `broadcast(EVAL_START)` stál **mimo** `try` blok v `process_single_file_bg`, takže výjimka proletěla až do `_run_task`, kde se jen vypsala `print()` na stdout. Do prohlížeče nedorazilo nic — ani `EVAL_ERROR`. Frontend proto nikdy nedopočítal `evaluatedCount` na `totalToEvaluate` a studenti zůstali viset ve stavu `evaluating`, čímž se zablokovaly obě cesty k ukončení dávky (progress efekt i self-healing v `TabEvaluation.tsx`). Kolečko se točilo donekonečna a s ním i 8s polling — v logu 20 minut bez jediného LLM volání.

Důsledek pro výkon: batching se nikdy neprojevil. Dávka 1 ÚZ trvala 96,1 s, „dávka 3" 98,7 s — identicky, protože běžel vždy jen jeden požadavek. Že GPU batching zvládá, dokládá starší záznam vLLM (`Running: 5 reqs`, 165 tok/s proti 36 tok/s u jediného požadavku, KV cache na 30 %).

**Možnosti:**
- A: Vlastní asyncpg spojení pro každou úlohu — korektní, ale N spojení navíc na dávku a nový lifecycle k údržbě.
- B: Malý asyncpg pool jen pro NOTIFY — funkční, ale zbytečná infrastruktura pro operaci trvající zlomek milisekundy.
- **C (zvoleno):** `asyncio.Lock` nad stávajícím spojením. `pg_notify` je sub-milisekundová operace, takže serializace nic nestojí a nepřidává žádnou novou komponentu.

**Rozhodnutí:** `EvaluationQueue._notify_lock` chrání každé `execute()` nad `_pg_conn`. `broadcast(EVAL_START)` se přesunul dovnitř `try`. `_run_task` nově loguje přes `logger.error(..., exc_info=True)` a v `except` větvi odesílá `EVAL_ERROR` jako záchrannou síť. Tím vzniká invariant, o který se opírá celý frontend: **každý zařazený úkol vyprodukuje právě jednu terminální událost (`EVAL_SUCCESS`, nebo `EVAL_ERROR`)**. `TabEvaluation.tsx` má navíc watchdog (10 min ticha) pro případ, že se WS zpráva ztratí při výpadku spojení.

Součástí je i oprava `clear_queue()`, která dosud mazala frontu **všem** lektorům a jen v tom procesu, na který dopadl HTTP request. Nově přijímá `lecturer_id`, úkoly cizích lektorů vrací do fronty a úklid rozesílá stávajícím kanálem `evaluz_eval_events` jako **řídicí zprávu** (vyhrazený klíč `__control`), kterou `_on_notify` odchytí před `_deliver_local` a vykoná lokálně v každém procesu, aniž by ji poslal do prohlížeče.

**Kompromis:** Zámek serializuje notifikace i tehdy, kdy by to nutné nebylo — při desítkách zpráv na dávku neměřitelné. Řídicí zprávy sdílí kanál s uživatelskými, což vyžaduje disciplínu při rozšiřování protokolu (neznámý `__control` se loguje a ignoruje). Regresní test `ConcurrencyTrackingPgConn` souběžné použití spojení aktivně detekuje — ověřeno, že bez zámku selže (2 překryvy, doručena 1 zpráva ze 3).

---

### ADR-018: `max_model_len` ze serveru jako strop nad nastavením v Administraci (v3.13.0)

**Status:** Decided & Implemented

**Kontext:** V Administraci je `VLLM_CONTEXT_WINDOW` a působí jako by nastavovalo kontextové okno modelu. Nenastavuje — `_build_llm_kwargs` posílá per-request kontext jedině Ollamě (`num_ctx`); pro vLLM se v `extra_body` předává pouze `enable_thinking`. U vLLM je okno fixované při startu kontejneru přes `--max-model-len` a podle něj se alokuje KV cache; klient ho přes OpenAI API zvýšit nemůže. Hodnota z Administrace je tedy jen **interní odhad aplikace**, ze kterého se počítá práh pro chunking (`budget = ctx × CHUNK_THRESHOLD_TOKENS_PCT`).

Na testovacím serveru byla nastavena na 64512, zatímco vLLM běželo s `--max-model-len 32768`. Aplikace tak počítala s prahem 45 158 tokenů — **nad tvrdým limitem serveru**. Delší ÚZ by aplikace poslala jako single-call v přesvědčení, že se vejde, a vLLM by ho odmítl HTTP 400. `_llm_call_with_overflow_retry` to částečně zahojí (opakuje s osekaným `max_tokens`), ale za cenu useknuté odpovědi. Riziko roste tím, že prázdná hodnota spadne na `PLATFORM_CONTEXT_DEFAULTS["vllm"] = 131072`.

**Možnosti:**
- A: Jen dokumentovat, že se hodnoty musí ručně srovnat — spoléhá na disciplínu a mlčí, když se rozejdou.
- B: Nastavení z Administrace zrušit a číst výhradně ze serveru — ztratí se možnost ručně snížit strop u providerů, kteří limit nehlásí.
- **C (zvoleno):** Číst `max_model_len` ze serveru a použít ho jako **strop**: `ctx = min(nastavení, server)`. Ruční nastavení zůstává jako pojistka směrem dolů, ale nikdy nemůže slíbit víc, než server umí.

**Rozhodnutí:** `fetch_server_max_model_len()` čte `GET /v1/models` přímo přes `httpx` (pole `max_model_len` je rozšíření vLLM mimo OpenAI spec, typované modely SDK ho nezaručují) a cachuje výsledek podle URL — hodnota se za běhu serveru nemění. `evaluate_report()` strop uplatní a při rozporu loguje varování. `POST /admin/test-llm` zjištěnou hodnotu vrací a explicitně upozorní, když je nastavení v Administraci vyšší, takže to admin uvidí při testu spojení, ne až chybou uprostřed vyhodnocování.

**Kompromis:** Jedno HTTP volání navíc při prvním vyhodnocení po startu procesu (5s timeout, selhání je neškodné — zůstane hodnota z Administrace). Cache znamená, že po restartu vLLM s jiným `--max-model-len` platí stará hodnota do restartu backendu; tlačítko „Test LLM" proto cache obchází (`force_refresh=True`).

---

### ADR-019: Deterministické přiřazení kritérií — přesná shoda před poziční frontou (v3.13.0)

**Status:** Decided & Implemented

**Kontext:** `_canonicalize_criterion_name` záměrně odstřihává jméno osoby na konci názvu kritéria (heuristika proti tomu, aby model „personalizoval" generické kritérium jménem z textu ÚZ). Kritéria lišící se pouze osobou tím spadnou pod jeden kanonický klíč. ADR-011 na to reagovalo frontou N slotů místo dictu, takže se žádné kritérium neztratí — jenže výběr slotu je `pop(0)`, tedy **poziční, podle pořadí odpovědi modelu**.

Reálná sada MS2 „Vstup do obydlí" má tři takové dvojice (kritéria 6+12, 7+13 a 8+14 — prokázání totožnosti, ztotožnění osoby a lustrace PATROS, vždy pro Ivanu Horákovou a Tadeáše Kadlece). Když model obě varianty prohodí, odůvodnění jedné osoby se tiše uloží pod kritérium té druhé. Celkové skóre zůstane správné (počet položek i body z DB sedí), takže chybu nelze zpozorovat ani v UI, ani v logu. Zatím k tomu nedošlo, ale spolehlivost stojí jen na tom, že model dodržuje pořadí promptu.

**Možnosti:**
- A: Přejmenovat kolidující kritéria v UI — obchází příčinu, znehodnocuje didaktický obsah a spoléhá na to, že si to lektor u každé nové sady uhlídá.
- B: Přestat odstřihávat person-suffix — vrátí původní problém s personalizací názvů modelem.
- **C (zvoleno):** Zkusit nejdřív shodu celého názvu mezi zbývajícími sloty a teprve při neúspěchu spadnout na dosavadní `pop(0)`.

**Rozhodnutí:** Helper `_pop_matching_slot()` hledá mezi sloty přesnou shodu názvu (case-insensitive, `strip()`); prompt modelu už dnes ukládá zkopírovat název doslova, takže ve valné většině případů uspěje. Když slotů zbývá víc než jeden a přesná shoda chybí, přiřazení se provede pozičně jako dřív, ale zaloguje se `WARNING` — tichý tip se tím mění v hlasitý. Chování je nezávislé na konkrétní sadě kritérií: řeší libovolnou dvojici lišící se jménem osoby, ať se osoby jmenují jakkoli.

**Kompromis:** Při jediném slotu je výsledek bit po bitu shodný s předchozím chováním a bez přesné shody se nemění nic, takže regrese není možná — cenou je lineární průchod sloty místo `pop(0)`, což je při jednotkách slotů bezvýznamné. Regresní test ověřuje, že prohozené pořadí obou person-variant nyní sedne správně (se starým `pop(0)` prokazatelně selhává).

---

### ADR-020: Silné reference na background tasky (v3.13.1)

**Status:** Decided & Implemented

**Kontext:** Po nasazení v3.13.0 se dávka 3 ÚZ vyhodnotila celá, ale individuální zpětná vazba se uložila jen u některých studentů — u ostatních zůstalo pole prázdné. V logu nebyla žádná chyba ani traceback. Příčina: `_run_feedback_task` se spouštěl přes holé `asyncio.create_task()` a návratová hodnota se zahazovala. Dokumentace asyncio na to upozorňuje výslovně — event loop drží na tasky pouze **slabé** reference, takže je garbage collector může zlikvidovat uprostřed běhu. Projev je nedeterministický a naprosto tichý, což přesně odpovídalo pozorování „jednomu se vygenerovala, dvěma ne". Riziko navíc vzrostlo právě opravou fronty (ADR-017): dokud běžela jen jedna evaluace naráz, vznikal jeden task; po opravě jich vzniká N těsně po sobě.

Stejný vzorec byl i na dalších třech místech — doručení WS zprávy, úklid fronty a spuštění samotné evaluace. To poslední bylo nejzávažnější: zahozený task uprostřed evaluace by porušil invariant terminální události z ADR-017, jen se to zatím neprojevilo.

**Možnosti:**
- A: Awaitovat feedback přímo v evaluačním handleru — zjednodušilo by životní cyklus, ale prodloužilo by dobu držení slotu semaforu a vrátilo zpětnou vazbu do critical path (přesně proti ADR-010).
- B: Ukládat referenci ad hoc v každém volajícím — funkční, ale opakovaná boilerplate, na kterou se dřív nebo později zapomene.
- **C (zvoleno):** Jedna sdílená pomocná funkce, kterou používají všechna fire-and-forget spuštění.

**Rozhodnutí:** `backend/utils/tasks.py::spawn_background()` přidá task do modulového setu a odebere ho až v `add_done_callback`. Navíc loguje nezachycenou výjimku — bez toho by skončila jen jako „Task exception was never retrieved" při GC, tedy prakticky neviditelně. Všechna čtyři místa (`api/evaluate.py`, `services/evaluation_queue.py`) na ni byla převedena; holé `asyncio.create_task()` zůstává jen v `main.py` pro dlouhoběžné tasky, na které si `lifespan` referenci drží sám.

**Kompromis:** Set roste s počtem souběžných tasků, ale položky se odstraňují v callbacku, takže velikost odpovídá skutečné souběžnosti (jednotky). Nové fire-and-forget spuštění musí použít `spawn_background` — to je konvence, kterou hlídá code review, ne typový systém.

---

### ADR-021: Frontend rezolvuje ID vlastní třídy místo natvrdo zadané jedničky (v3.13.1)

**Status:** Decided & Implemented

**Kontext:** Lektor Zvěřina hlásil, že jeho ÚZ se sice kompletně vyhodnotí (backend log i DB v pořádku, `pocet_vysledku=25`, `skore=17`), ale v UI zůstává jako „Nezpracováno" a chybí tlačítko pro schválení. Diagnóza: `ClassRoom` se zakládá **zvlášť pro každého lektora** (`fast_scan_batch`, auto-increment ID), zatímco frontend měl na devíti místech natvrdo `/analytics/class/1`. Backend filtruje `class_id == 1` a zároveň `lecturer_id == current_user.id` (ADR-014), takže data v UI viděl jedině lektor, jehož třída měla shodou okolností ID 1. Ostatním se korektně vrátilo prázdné pole, `finalStatus` nikdy nepřeskočil na `evaluated` a schvalovací tlačítko se nevykreslilo, protože je uvnitř detailu vyhodnoceného záznamu.

Nešlo o regresi z v3.13.0 — v nginx logu z 10. 8. je vidět, že týž lektor dostával na `/analytics/class/1?scenario_id=scen-2` odpověď o velikosti 2 bajtů (`[]`) i po dokončení svých evaluací, zatímco druhý lektor dostával desítky kilobajtů dat. Chyba byla přítomná od zavedení izolace dat, jen ji nikdo nespojil s „Nezpracováno".

**Možnosti:**
- A: Zrušit filtr podle třídy a scopovat jen podle lektora a scénáře — nejmenší zásah, ale zahodilo by dimenzi třídy, kterou používá i cache `ClassAnalysis` a Excel export.
- B: Kompatibilní shim v backendu (při požadavku na cizí třídu tiše použít vlastní) — frontend beze změny, ale skrytá magie v API, která by v kódu zůstala natrvalo.
- **C (zvoleno):** Frontend si ID své třídy vyžádá z backendu a použije ho všude.

**Rozhodnutí:** `src/utils/api.ts::getClassId()` volá existující idempotentní endpoint `POST /evaluate/classes/ensure` (třídu vrátí, a pokud neexistuje, založí ji) a výsledek cachuje. Cache je klíčovaná tokenem, takže se sama zneplatní při přihlášení jiného lektora i po odhlášení — není potřeba ji nikde ručně invalidovat. Nahrazeno bylo všech devět výskytů v `App.tsx`, `TabEvaluation.tsx` a `TabAnalytics.tsx` (včetně Excel exportu a názvu staženého souboru). Třída zůstává reálnou entitou, takže případné budoucí rozšíření na víc tříd na lektora nevyžaduje návrat zpět.

**Kompromis:** Jeden HTTP požadavek navíc při prvním načtení (dál z cache). Konstanta `DEFAULT_CLASS_NAME` v `src/utils/api.ts` musí odpovídat defaultu `class_name` ve fast-scan endpointu — jinak by frontend rezolvoval jinou třídu, než do které se zapisuje. Tuhle vazbu zamyká test `test_ensure_returns_class_used_by_fast_scan`.

---

## 9. Historie vývoje (Changelog)

### v3.10.5 (6. 5. 2026) — Analytics prázdný stav UX

- **`src/components/TabAnalytics.tsx`** — Explicitní prázdný stav při `data=null`: card s ikonou, vysvětlujícím textem a tlačítkem "Generovat analýzu" (volá `fetchAnalytics(force=true)`). Dříve se zobrazila prázdná plocha bez jakékoli výzvy k akci.

---

### v3.10.4 (6. 5. 2026) — Analytics force gate

- **`backend/services/analytics.py`** — `generate_class_summary()`: bez `force=True` se AI generování nikdy nespustí. Pokud cache neexistuje a `force=False`, vrátí `{"status":"no_analysis"}`. Opravuje race condition: page refresh během generování spouštěl druhé souběžné LLM volání.
- **`src/components/TabAnalytics.tsx`** — Handler pro `status="no_analysis"`: `setData(null)` bez erroru. Zobrazí prázdný stav (viz v3.10.5).

---

### v3.10.3 (6. 5. 2026) — Queue deduplicace + seeder fix

- **`backend/services/evaluation_queue.py`** — `EvaluationQueue` dostala `_active_keys: Set[str]` sledující klíče `{lecturer_id}:{scenario_id}:{filename}`. `add_task()` vrátí `False` a přeskočí studenta pokud je klíč aktivní. `_run_task()` finally uvolní klíč. `clear_queue()` čistí i `_active_keys`.
- **`backend/core/seeder.py`** — Nový helper `_seed_setting(db, key, value)`: každý `AppSettings` klíč dostane vlastní `db.commit()` + `try/except rollback`. Odstraňuje batch commit způsobující `IntegrityError` při unique violation na existujících DB.

---

### v3.10.2 (6. 5. 2026) — WS reconnect fix

- **`src/components/TabEvaluation.tsx`** — Přidán `wsConnectCountRef` (useRef) počítající připojení. `ws.onopen` při reconnectu (count > 1) volá pouze `fetchEvaluations()` bez resetu stavů. Starý kód resetoval `'evaluating' → 'pending'` před fetchem, čímž ničil logiku zachování evaluating statusu a způsoboval automatické re-odesílání dávek po reconnectu.
- **`src/components/TabEvaluation.tsx`** — Opraven self-healing `useEffect`: odstraněna podmínka `evaluatedCount === 0` (bránila správnému self-healingu po WS reconnectu).

---

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

*Poslední aktualizace dokumentace: 12. srpna 2026*
