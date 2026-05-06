# Projektový Kontext — EVALUZ
**Verze: 3.10.5 | Poslední aktualizace: 2026-05-06**

## Aktuální Stav

Systém v produkčním provozu na ÚPVSP. v3.10.5 — stabilizace pipeline: WS reconnect fix (v3.10.2), deduplicace fronty + seeder fix (v3.10.3), analytics force gate (v3.10.4), analytics UX prázdný stav (v3.10.5). 52 testů pass.

## 1. Vize a Cíl

Automatizace vyhodnocování Úředních záznamů (ÚZ) na ÚPVSP. AI asistent pomáhá lektorům standardizovat hodnocení, přičemž lektor má vždy poslední slovo díky Man-in-the-Loop schvalovacímu workflow.

Provoz výhradně v uzavřené síti HERMES (bez internetu) na GPU serveru ÚPVSP s NVIDIA L40S.

## 2. Architektura

- **Frontend:** React 18 + Vite + TypeScript, Vanilla CSS. SPA bez routeru — URL state persistence přes `window.history.replaceState`.
- **Backend:** FastAPI (Python 3.13+) + SQLAlchemy 2.x. Deterministické výpočetní jádro (kanonizační match, adaptivní chunking, 2-úrovňový JSON fallback).
- **Databáze:** SQLite (dev/test) / PostgreSQL 17 (produkce) — Alembic migrace + `run_migrations()` kobercový nálet.
- **LLM:** vLLM (primární, 128k ctx), OpenRouter, Ollama, LM Studio — OpenAI-compatible API.
- **Exporty:** Excel (openpyxl) a PDF (fpdf2).
- **Testy:** pytest + pytest-asyncio + respx. 52 testů (36 unit + 10 integration). In-memory SQLite, MockLLMRouter.
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

## 4. LLM Pipeline — Klíčové Principy (v3.10.5)

- **Adaptivní chunking**: `_estimate_tokens()` odhadne objem; pokud se vše vejde do 70 % kontextového okna → přímé volání; jinak chunky po `CHUNK_SIZE` kritériích + `asyncio.gather` parallelismus.
- **Fail-fast JSON**: 2-úrovňový fallback (přímý parse → sanitizace → ValueError). S 128k kontextem je truncace prakticky nemožná.
- **Kanonizační match**: `_canonicalize_criterion_name()` — strip prefixu, trailing `**`, person suffix. Eliminuje false-negative placeholdery u multi-person ÚZ.
- **Feedback mimo critical path (ADR-010)**: `evaluate_report()` vrací `zpetna_vazba=""`. Po `EVAL_SUCCESS` broadcastu spuštěn `asyncio.create_task(_run_feedback_task(...))`. Frontend dostane `FEEDBACK_DONE` až po doplnění zpětné vazby do DB.
- **`FEEDBACK_MAX_TOKENS`**: Konfigurovatelný v DB (výchozí 250). Byl 600 — 3× zbytečně velký pro 3–5 vět.
- **`EvaluationQueue._active_keys`**: Set klíčů `{lecturer_id}:{scenario_id}:{filename}` — deduplicace fronty. `add_task()` přeskočí studenta pokud je klíč aktivní. Uvolní se v `_run_task()` finally.
- **Logging**: `logging.getLogger("evaluz.llm")`, httpx/httpcore ztišeny. Žádné print() v produkčním kódu.

## 5. Autentizace & RBAC

- **Registrace:** `POST /auth/register` — veřejný, role vždy `vyučující`. Rate-limit 5/min.
- **Povýšení role:** Výhradně SuperAdmin přes AdminModal → Správa uživatelů (`verify_superadmin()` guard).
- **Přihlášení:** `POST /auth/login` (OAuth2 password flow), rate-limit 10/min.
- **Role:** Vyučující (vlastní data) / Admin (útvar `school_location`) / SuperAdmin (vše).

## 6. Klíčové Technické Detaily

- **`CHUNK_SIZE`, `CHUNK_THRESHOLD_TOKENS_PCT`, `FEEDBACK_MAX_TOKENS`**: čteny z `AppSettings` per volání, seeded při startu.
- **`PLATFORM_CONTEXT_DEFAULTS`**: vllm=131072, openai=128000, openrouter/ollama/lmstudio=8192.
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
├── test_llm_pipeline.py        36 unit testů (offline, bez sítě/DB)
└── integration/
    └── test_evaluate_endpoint.py  10 integračních testů (in-memory SQLite + respx)

Spuštění: cd backend && pytest tests/ -v
Výsledek: 52/52 passed
```

## 8. Dokumentace

- `docs/TECHNICAL_DOCUMENTATION.md` — kompletní technická dokumentace (architektura, ADR, pipeline, DB, bezpečnost)
- `docs/CHANGELOG.md` — chronologická historie verzí
- `ARCHITECTURE.md` — přehledová architektura (starší verze, referovat na TECHNICAL_DOCUMENTATION.md)
- `.memory/decisions.md` — ADR log s kontextem rozhodnutí
