# ARCHITECTURE - EVALUZ

## Datový Model
- **Lecturer:** Příznaky `is_superadmin`, `is_admin`. Vazba `school_location` určuje organ. článek. Atributy hodnosti: `rank_shortcut`, `rank_full`, `title_before`, `title_after`.
- **StudentEvaluation:** Ukládá vyhodnocení ÚZ. Klíčové sloupce: `scenario_name` (ID), `scenario_display_name` (čitelný název od v3.7.0), `json_result` (JSONType dict), `is_approved`, `student_identity` (JSONType), `cleaned_name`, `source_text`, `created_at`.
- **ClassAnalysis:** Globální analýza třídy. `content_json` je JSONType — vždy `isinstance(raw, dict)` před `json.loads()`. Sloupce `computed_at` a `version` pro cache invalidaci.
- **ClassRoom:** Zakládá se **zvlášť pro každého lektora** (fast-scan, výchozí název „Základní kurz", auto-increment ID). ID tedy NENÍ napříč lektory shodné — frontend si ho musí vyžádat přes `POST /evaluate/classes/ensure`, nesmí ho mít natvrdo (ADR-021).

## Analýza & Monitoring
1.  **TabAnalytics (Třída):** Detailní pedagogický pohled na konkrétní třídu/scénář. Generuje `ClassAnalysis` s AI vhledem. Analytická gate: analytika dostupná až po schválení všech hodnocení.
2.  **TabMonitor (Organizační):** Celkový přehled využití AI pro management útvaru. Dostupné pouze Adminům/SuperAdminům. Filtry: datum, vzdělávací zařízení (superadmin only), třída, modelová situace.

## Profil uživatele
- **ProfileModal:** Samostatná komponenta (ne součást AdminModal). Otevírá se z user dropdownu v záhlaví (`setIsProfileOpen` prop). Obsahuje editaci osobních údajů, živý náhled doložky, historii exportů a změnu hesla (`PUT /api/v1/auth/password`).
- **AdminModal:** Po refaktoringu obsahuje pouze systémovou správu (prompty, LLM, uživatelé). Profil byl odstraněn. Titulek: "Administrace systému EVALUZ". Tlačítko "Administrace" v navigaci viditelné pouze správcům.

## Exporty
- **PDF student:** `/export/evaluation/{id}/pdf` — spolehlivý export podle ID záznamu.
- **PDF třída:** `/export/class-report/{scenario_id}` — přijímá `class_name` a `scenario_display_name` jako query params (priorita) nebo čte z DB / markdown fallback.
- **Excel třída:** `/export/class/{class_id}/excel` — `class_name` a `scenario_display_name` zapisovány do buněk B2 a B3.
- **Auth pro fetch() exporty:** Vždy `get_current_lecturer` (Authorization header). `get_current_lecturer_export` pouze pro `<a href>` anchor downloads.

## Autentizace exportů — pravidlo
| Způsob volání | Dependency | Token předáván |
|---|---|---|
| `fetch()` s `Authorization` header | `get_current_lecturer` | v hlavičce |
| `<a href="...?token=...">` | `get_current_lecturer_export` | v URL query param |

## Řízení Přístupu (RBAC) & Izolace Dat [v3.5.0+, DataScope od v3.11.0]
- **Role:** `Vyučující`, `Admin`, `SuperAdmin`.
- **Zabezpečení:** Middleware `verify_superadmin` chrání citlivé systémové operace (prompty, vLLM settings).
- **Izolace:** Helper `apply_data_isolation(query, entity_class, current_user, db, scope: DataScope)` — explicitní parametr `scope` (`PERSONAL`/`LOCATION`/`GLOBAL`), default `PERSONAL` — fail-closed BEZ OHLEDU na roli volajícího (viz ADR-014, `docs/TECHNICAL_DOCUMENTATION.md`). Osobní endpointy (Evaluation tab, analytics) nikdy nevidí cizí data ani u Admin/SuperAdmin — širší scope musí endpoint explicitně vyžádat (jen `backend/api/statistics.py`, manažerský dashboard).

## LLM Robustnost
- **Sanitizer:** Vlastní regex cleaning pro extract JSONu i z modelů s vnitřním uvažováním (Qwen, DeepSeek).
- **vLLM Integration:** Přímé napojení na OpenAI-compatible API s dynamickým managementem tokenů a parametrů v DB.
- **Kontextové okno [od v3.13.0, ADR-018]:** Nastavení `VLLM_CONTEXT_WINDOW` v Administraci se do vLLM **neposílá** — je to jen interní odhad pro rozhodnutí single-call vs. chunking (per-request kontext přijímá z podporovaných platforem jedině Ollama přes `num_ctx`). Skutečný limit je fixovaný při startu vLLM přes `--max-model-len`; `fetch_server_max_model_len()` ho přečte z `GET /v1/models` a použije jako strop (`ctx = min(nastavení, server)`). Nastavení tak smí limit jen snížit, nikdy překročit. „Test LLM" v Administraci zjištěnou hodnotu zobrazí a upozorní na rozpor.
- **Přiřazení kritérií [od v3.13.0, ADR-019]:** Kanonizace odstřihává jméno osoby na konci názvu, takže kritéria lišící se jen osobou sdílí frontu slotů. Výběr slotu hledá nejdřív přesnou shodu názvu a poziční `pop(0)` je až nouzová varianta (s `WARNING`) — jinak by o přiřazení rozhodovalo pořadí odpovědi modelu.

## Škálovatelnost — víc uvicorn worker procesů [od v3.12.0]
- **`--workers ${UVICORN_WORKERS}`** (`backend/Dockerfile`, výchozí 2): `EvaluationQueue` (WebSocket registr, LLM concurrency semafor, dedup fronty) je per-proces singleton, ne sdílený stav.
- **WebSocket doručení:** `broadcast()` publikuje přes Postgres `LISTEN/NOTIFY` (ADR-015) — každý proces poslouchá na vlastním `asyncpg` spojení a doručuje jen svým lokálně registrovaným socketům. Bez toho by broadcast na "špatný" proces tiše zmizel.
- **LLM concurrency:** `main.py::_resolve_worker_concurrency()` dělí nastavenou hodnotu z Administrace počtem workerů (ADR-016), aby celkový součet napříč procesy odpovídal tomu, co admin skutečně nastavil, ne jeho násobku.
- **Souběžný přístup ke spojení [od v3.13.0, ADR-017]:** `_pg_conn` je JEDNO asyncpg spojení a `broadcast()` ho volá ze všech úloh dávky naráz. asyncpg souběžné použití jednoho spojení odmítá (`cannot perform operation: another operation is in progress`), proto je `execute()` pod `_notify_lock`. Bez zámku přežila z dávky vždy jen první úloha.
- **Řídicí zprávy [od v3.13.0]:** Kanál `evaluz_eval_events` přenáší kromě uživatelských zpráv i řídicí, poznané podle vyhrazeného klíče `__control`. `_on_notify` je odchytí PŘED `_deliver_local` a vykoná lokálně, aniž by je poslal do prohlížeče. Používá to `clear_queue(lecturer_id)` — fronta je per-proces, takže HTTP request, který dopadl na jeden proces, musí úklid rozeslat oběma.
- **Známé omezení:** dedup fronty (`_active_keys`, ADR-011) zůstává per-proces.

## Fronta vyhodnocování — invariant terminální události [od v3.13.0, ADR-017]
- **Každý zařazený úkol vyprodukuje právě jednu terminální událost** — `EVAL_SUCCESS`, nebo `EVAL_ERROR`. `_run_task` má `except` větev, která `EVAL_ERROR` odešle i tehdy, když handler spadne dřív, než se dostane ke svému vlastnímu `try`.
- **Proč na tom záleží:** frontend počítá `evaluatedCount` proti `totalToEvaluate`. Chybějící terminální událost znamená navždy běžící kolečko, zablokovaný self-healing a nekonečný 8s polling. `TabEvaluation.tsx` má navíc watchdog na 10 minut ticha jako poslední pojistku pro ztracenou WS zprávu.
- **Background tasky [ADR-020]:** `asyncio.create_task()` drží referenci jen slabě — GC může task zlikvidovat uprostřed běhu, tiše a bez tracebacku. Všechna fire-and-forget spuštění proto jdou přes `utils/tasks.py::spawn_background()`, které drží silnou referenci a loguje nezachycené výjimky.

## Klientská Synchronizace
- **HDD Sync:** Využívá `File System Access API`. 
- **Bezpečnost:** Vyžaduje tzv. **Secure Context** (HTTPS nebo localhost). Na běžném HTTP je funkce prohlížečem blokována.

