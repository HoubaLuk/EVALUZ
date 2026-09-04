# Projektový Kontext — EVALUZ
**Verze: 3.15.2 | Poslední aktualizace: 2026-09-04**

## Aktuální Stav

Systém v produkčním provozu na ÚPVSP, souběžně v pilotním testování na testovacím serveru. 148 testů pass.

Poslední vývojová linie řešila **provozní robustnost dávkového vyhodnocování** odhalenou pilotem:
- **v3.11.0** — náprava RBAC izolace dat (`DataScope`, fail-closed `PERSONAL`, ADR-014).
- **v3.12.0** — doručování WS zpráv přes Postgres LISTEN/NOTIFY napříč uvicorn procesy (ADR-015), LLM concurrency dělená počtem workerů (ADR-016).
- **v3.13.0** — z dávky N ÚZ se vyhodnocoval jen první: `broadcast()` sahal na jedno sdílené asyncpg spojení ze všech úloh naráz (ADR-017). Doplněn strop kontextového okna čtený ze serveru (ADR-018) a deterministické přiřazení kritérií (ADR-019).
- **v3.13.1** — zpětná vazba se tiše ztrácela vlivem slabých referencí u `asyncio.create_task()` (ADR-020); část lektorů neviděla v UI vlastní výsledky, protože frontend měl natvrdo `class/1` (ADR-021).
- **v3.14.0** — ÚZ čekající na volný slot souběžnosti je nově vidět (`EVAL_QUEUED`, stav „Ve frontě") a jde zrušit (ADR-022); třídní analytika se nespustí, dokud není celá sada vyhodnocená a schválená (ADR-023).
- **v3.14.1** — Soubor nad limit velikosti (10 MB) se ve fast-scanu nově hlásí jmenovitě místo tichého zmizení ze seznamu; kontrola velikosti běží ve frontendu před odesláním, `Failed to fetch` se překládá do srozumitelné hlášky (ADR-024). Skutečná síťová příčina hlášeného „Failed to fetch" u jedné lektorky zůstává neprokázaná.
- **v3.15.0** — Manuální zásah lektora dřív přepsal celé hodnocení tím, co poslal klient: ztratily se `max_skore` a `identita` a po člověku nezůstala stopa. Nově se slučuje, skóre přepočítává server a původní hodnocení AI se uchová v `ai_original_json` (ADR-025). Analytika hlásí rozpor mezi uloženými výsledky a upravenými kritérii místo tichého 0 % (ADR-026) a má deterministické pořadí kritérií; teplota fáze 2 se konečně čte z Administrace (ADR-027).
- **v3.15.1** — Seeder už nikdy nepřepisuje existující prompty. Dřív při zvýšení `PROMPT_VERSION` v kódu tiše nahradil obsah **i teplotu** všech čtyř promptů továrními hodnotami; `system_prompts` nemá historii, takže text vytvořený mimo repozitář nešlo obnovit (ADR-028). Doplňování chybějících promptů nově běží při každém startu, takže smazaný prompt už fázi tiše nedegraduje na nouzový jednořádkový text.
- **v3.15.2** — Každé dílčí hodnocení nese `jistota` 1–5; u hodnot ≤ 2 se v UI zobrazí výstraha, aby lektor věděl, kam se podívat (ADR-029). Je to tvrzení modelu o obtížnosti, ne měření nejistoty — vysoká jistota není důkazem správnosti. Zároveň opraven zdvojený příznak zásahu vyučujícího: `_lecturer_modified` z v3.15.0 sjednocen na existující `upraveno_lektorem`, které nově odvozuje server, ne klient.

## 1. Vize a Cíl

Automatizace vyhodnocování Úředních záznamů (ÚZ) na ÚPVSP. AI asistent pomáhá lektorům standardizovat hodnocení, přičemž lektor má vždy poslední slovo díky Man-in-the-Loop schvalovacímu workflow.

Provoz výhradně v uzavřené síti HERMES (bez internetu) na GPU serveru ÚPVSP s NVIDIA L40S.

## 2. Architektura

- **Frontend:** React 18 + Vite + TypeScript, Vanilla CSS. SPA bez routeru — URL state persistence přes `window.history.replaceState`.
- **Backend:** FastAPI (Python 3.13+) + SQLAlchemy 2.x. Deterministické výpočetní jádro (kanonizační match, adaptivní chunking, 2-úrovňový JSON fallback).
- **Databáze:** SQLite (dev/test) / PostgreSQL 17 (produkce) — Alembic migrace + `run_migrations()` kobercový nálet.
- **LLM:** vLLM (primární), OpenRouter, Ollama, LM Studio — OpenAI-compatible API. Skutečné kontextové okno se čte ze serveru (`GET /v1/models` → `max_model_len`) a slouží jako strop nad nastavením v Administraci (ADR-018).
- **Exporty:** Excel (openpyxl) a PDF (fpdf2).
- **Testy:** pytest + pytest-asyncio + respx. 148 testů. In-memory SQLite (se `StaticPool` tam, kde requesty obsluhuje TestClient v jiném vlákně), MockLLMRouter.
- **Produkce:** Docker Compose (nginx + backend + PostgreSQL), non-root user `evaluz`, nginx reverse proxy s CSP hlavičkami, `SecurityHeadersMiddleware`, slowapi rate limiting.

## 3. Implementované Moduly

- **Precizace kritérií (Phase 1):** Sokratovský AI asistent — klade upřesňující otázky jednu po druhé. Konverzace filtrována oddělovačem `---`.
- **Fast-scan identita (Phase 1a):** `extract_identity()` — LLM extrahuje hodnost, jméno, příjmení ze záznamu. `clean_filename_to_display()` normalizuje název souboru.
- **Evaluace ÚZ (Phase 2):** Hromadné AI vyhodnocování s adaptivním chunkingem. Man-in-the-Loop schvalování — badge "K revizi"/"Schváleno", zamčené vstupy, analytická gate.
- **Individuální zpětná vazba (Phase 2b):** `_generate_individual_feedback()` po sloučení chunků. Konfigurovatelný prompt v Administraci.
- **Analýza třídy (Phase 3):** Dashboard s grafy (Chart.js), PDF Protokol o hodnocení skupiny, Excel export. Filtrování kritérií pro LLM prompt dle `ANALYTICS_THRESHOLD`.
- **Statistiky (TabMonitor):** Přehled využití pro Adminy/Superadminy. Filtry: datum, vzdělávací zařízení, třída, modelová situace. Excel export aktivity.
- **ProfileModal:** Osobní údaje, doložka, změna hesla. Samostatná komponenta oddělená od AdminModal.
- **AdminModal:** Správa systému (prompty, LLM konfigurace, uživatelé). Viditelné pouze správcům.

## 4. LLM Pipeline — Klíčové Principy (v3.14.0)

- **Adaptivní chunking**: `_estimate_tokens()` odhadne objem (2,5 znaku/token — konzervativně kvůli české diakritice); pokud se vše vejde do 70 % kontextového okna → přímé volání; jinak chunky po `CHUNK_SIZE` kritériích + `asyncio.gather` parallelismus.
- **Strop kontextu ze serveru (ADR-018)**: `fetch_server_max_model_len()` čte `max_model_len` z `GET /v1/models`; `ctx = min(nastavení v Administraci, limit serveru)`. Nastavení smí limit jen snížit — do vLLM se totiž vůbec neposílá (per-request kontext přijímá jen Ollama přes `num_ctx`).
- **Fail-fast JSON**: 2-úrovňový fallback (přímý parse → sanitizace → ValueError).
- **Kanonizační match**: `_canonicalize_criterion_name()` — strip prefixu, trailing `**`, person suffix. Eliminuje false-negative placeholdery u multi-person ÚZ.
- **Deterministické přiřazení slotů (ADR-019)**: `_pop_matching_slot()` hledá mezi kritérii se shodným kanonickým základem nejdřív přesnou shodu názvu a teprve pak spadne na poziční `pop(0)` (tehdy s `WARNING`). Bez toho by u dvojic lišících se jen jménem osoby (např. Horáková / Kadlec) rozhodovalo pořadí odpovědi modelu a odůvodnění by se tiše prohodilo mezi osobami.
- **Feedback mimo critical path (ADR-010)**: `evaluate_report()` vrací `zpetna_vazba=""`. Po `EVAL_SUCCESS` broadcastu se spustí `spawn_background(_run_feedback_task(...))`. Frontend dostane `FEEDBACK_DONE` až po doplnění zpětné vazby do DB.
- **Silné reference na background tasky (ADR-020)**: `utils/tasks.py::spawn_background()` — `asyncio.create_task()` drží referenci jen **slabě**, takže GC mohl task zlikvidovat uprostřed běhu (tiše, bez tracebacku). Všechna fire-and-forget spuštění musí jít přes `spawn_background`.
- **`FEEDBACK_MAX_TOKENS`**: Konfigurovatelný v DB (výchozí 250).
- **`EvaluationQueue._active_keys`**: Set klíčů `{lecturer_id}:{scenario_id}:{filename}` — deduplicace fronty. `add_task()` přeskočí studenta pokud je klíč aktivní. Uvolní se v `_run_task()` finally.
- **Sdílený LLM klient**: `_get_llm_client()` cachuje `AsyncOpenAI` podle (URL, klíč, timeout); dřív vznikal nový connection pool při každém volání. Uzavírá se v `lifespan` přes `close_llm_clients()`.
- **Logging**: `logging.getLogger("evaluz.llm")`, httpx/httpcore ztišeny. Žádné print() v produkčním kódu.

## 4a. Fronta vyhodnocování — invariant (v3.13.0+)

- **Každý zařazený úkol vyprodukuje právě jednu terminální událost** (`EVAL_SUCCESS`, nebo `EVAL_ERROR`). Na tomhle invariantu stojí celé UI — bez něj `evaluatedCount` nikdy nedoběhne na `totalToEvaluate`, kolečko zůstane viset a polling běží donekonečna.
- **Rezervace slotu před `queue.get()` (ADR-022)**: `worker()` čeká na semafor ještě před vyzvednutím úkolu, takže úkoly nad limit souběžnosti zůstávají ve frontě — jsou spočitatelné (`qsize`) i zrušitelné přes `clear_queue`. Dřív si smyčka vytáhla vše naráz a čekala na slot až uvnitř tasku; fronta byla prázdná, „Zastavit" neměl co rušit a čekající ÚZ vypadal v UI jako nezahájený.
- **`EVAL_QUEUED`**: `add_task()` oznámí zařazení do fronty; frontend to zobrazí stavem `'queued'` („Ve frontě"). U dávky 5 ÚZ při limitu 4 čekal pátý ~2 minuty a bez tohoto oznámení ho lektor spouštěl znovu.
- **`_notify_lock` (ADR-017)**: jedno sdílené asyncpg spojení nesmí obsluhovat dvě korutiny naráz. Bez zámku první úloha spojení zabrala a zbylé padaly na `cannot perform operation: another operation is in progress` — z dávky 3 ÚZ se vyhodnotil jen první.
- **`clear_queue(lecturer_id)`**: filtruje podle lektora (cizí úkoly vrací do fronty) a úklid rozesílá kanálem `evaluz_eval_events` jako řídicí zprávu s vyhrazeným klíčem `__control`, kterou `_on_notify` odchytí před doručením do prohlížeče a vykoná lokálně v každém procesu.

## 5. Autentizace & RBAC

- **Registrace:** `POST /auth/register` — veřejný, role vždy `vyučující`. Rate-limit 5/min.
- **Povýšení role:** Výhradně SuperAdmin přes AdminModal → Správa uživatelů (`verify_superadmin()` guard).
- **Přihlášení:** `POST /auth/login` (OAuth2 password flow), rate-limit 10/min.
- **Role:** Vyučující (vlastní data) / Admin (útvar `school_location`) / SuperAdmin (vše).

## 6. Klíčové Technické Detaily

- **`CHUNK_SIZE`, `CHUNK_THRESHOLD_TOKENS_PCT`, `FEEDBACK_MAX_TOKENS`**: čteny z `AppSettings` per volání, seeded při startu.
- **`PLATFORM_CONTEXT_DEFAULTS`**: vllm=131072, openai=128000, openrouter/ollama/lmstudio=8192. Používá se jen když `VLLM_CONTEXT_WINDOW` chybí — hodnotu pak stejně shora ořízne limit ze serveru (ADR-018).
- **ID třídy (ADR-021)**: `ClassRoom` se zakládá zvlášť pro každého lektora (auto-increment ID). Frontend si ho proto vyžádá přes idempotentní `POST /evaluate/classes/ensure` (`src/utils/api.ts::getClassId`, cache klíčovaná tokenem) — natvrdo zadané `class/1` způsobovalo, že lektor s jiným ID viděl vlastní vyhodnocené ÚZ jako „Nezpracováno". Konstanta `DEFAULT_CLASS_NAME` musí odpovídat defaultu `class_name` ve fast-scan endpointu.
- **JSON parsing**: `json_result` / `content_json` mohou být dict nebo string (starší záznamy) — vždy `isinstance(raw, dict)`.
- **Identita studenta**: Prioritní řetězec `student_identity` JSON → `cleaned_name` → `student_name`.
- **`scenario_display_name`**: Ukládá se do DB při fast-scan i batch. Export PDF/Excel čte z DB jako fallback, query param má prioritu.
- **Auth pro exporty:** `fetch()` s Authorization header → `get_current_lecturer`. `<a href>` → `get_current_lecturer_export`.
- **`_llm_omitted=true`**: Placeholder pro kritérium, které LLM nevyhodnotil. Lektor vidí varování a může re-evaluovat.
- **`_llm_actual_name`**: Původní LLM název kritéria zachován pro audit (po kanonizaci → normalizovaný `nazev` v UI).
- **Verze:** `backend/__version__.py` → `GET /api/v1/version` → `Header.tsx` dynamicky.

## 7. Stav Testů

```
backend/tests/
├── test_llm_pipeline.py         43  LLM pipeline (offline, bez sítě/DB)
├── test_evaluation_queue.py     16  fronta — dedup, LISTEN/NOTIFY, souběžný broadcast,
│                                    terminální událost při pádu, clear_queue per lektor
├── test_criteria_matching.py    14  parser kritérií + přiřazení výsledků (ADR-019)
├── test_class_scoping.py         6  rozsah třídy, kontrakt classes/ensure (ADR-021)
├── test_analytics_gate.py        4  brána analytiky — úplnost a schválení (ADR-023)
├── test_data_isolation.py        3  RBAC izolace dat (ADR-014)
└── integration/
    └── test_evaluate_endpoint.py 9  integrační (in-memory SQLite + respx)

Spuštění: cd backend && pytest tests/ -v
Výsledek: 97/97 passed
```

## 8. Dokumentace

- `docs/TECHNICAL_DOCUMENTATION.md` — kompletní technická dokumentace (architektura, ADR, pipeline, DB, bezpečnost)
- `docs/CHANGELOG.md` — chronologická historie verzí
- `ARCHITECTURE.md` — přehledová architektura (starší verze, referovat na TECHNICAL_DOCUMENTATION.md)
- `.memory/decisions.md` — ADR log s kontextem rozhodnutí
