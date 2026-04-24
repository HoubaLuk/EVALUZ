# Architectural Decisions Log

---

## 2026-04-24: Phase 3 analytics — filtrování kritérií pro AI prompt (v3.8.6)

**Status:** Decided & Implemented

**Kontext:** Phase 3 (`generate_class_summary`) posílala do LLM promptu statistiky **všech** kritérií (25 řádků) + kompletní markdown definic kritérií. To neodpovídá pedagogické realitě — lektor nepotřebuje slyšet o kritériích, která třída zvládá na 95 %. Zároveň se blížíme context window limitu při větším počtu kritérií nebo studentů.

**Rozhodnutí:**
1. **Filtrovat prompt, ne výstupní data:** Frontend dostává kompletní `stats[]` pro heatmapu a grafy — to se nemění. Filtruje se pouze obsah LLM promptu.
2. **Kombinace Top-5 + práh:** Vždy posílat 5 nejhůře splněných kritérií (absolutní záchytka i pro výbornou třídu) + všechna kritéria pod prahem úspěšnosti. Deduplikace union operací.
3. **Default práh 80 %:** Policejní výcvik vyžaduje vysokou compliance — 80 % je důstojný standard. Oproti generickým 60 % eliminuje situaci „vše zelené" při průměrném výkonu.
4. **`ANALYTICS_THRESHOLD` konfigurovatelný v DB:** Lektor si může práh upravit v Administraci dle náročnosti konkrétní MS — jednoduchá MS → přísnější práh (90 %), komplexní MS → mírnější (70 %).
5. **Prázdná množina = pozitivní feedback:** Pokud jsou všechna kritéria nad prahem, LLM dostane zprávu „třída podává výborný výkon" — neposílá se zbytečně celý seznam.

**Dopad:**
- Prompt Phase 3 se zkrátí z `N_kritérií × ~40 zn` na typicky `3–8 kritérií × ~40 zn` = úspora ~700 tokenů na 25 kritériích
- LLM se soustředí na reálné problémy, ne na přepisování dobrých výsledků
- Eliminuje budoucí token overflow při rozšíření na 20+ studentů × bohatší odůvodnění

---

## 2026-04-23: Adaptivní token budget kalibrovaný na českou tokenizaci (v3.8.5)

**Status:** Decided & Implemented

**Kontext:** Produkční logy odhalily, že Jarošův chunk 1 konzistentně generuje ~5 100–5 170 znaků a padá s `Expecting ',' delimiter: line 28 column 10`. Původní odhad 350 tokenů/kritérium byl kalibrovaný na anglický ASCII text (~2,5 zn/token). Česká diakritika (š, č, ž…) tokenizuje hustěji (~1,5–1,7 zn/token) — pro 6 kritérií potřeboval model ~3 040 tokenů, ale dostal limit 2 400. vLLM JSON mode při dosažení limitu vložil `"}]` doprostřed 4. kritéria → syntaktická chyba vypadající jako chyba obsahu, nikoli truncation.

**Rozhodnutí:**
1. **Token budget: 350 → 500 tokenů/kritérium.** Nový vzorec: `min(global_max, n_criteria * 500 + 300)`. Pro 6 kritérií = 3 300 tokenů — pokrývá i dialogicky bohaté ÚZ s četnými právními citacemi.
2. **Retry mechanismus jako doplněk, ne primární ochrana.** Retry s `temperature=0.3` funguje dobře pro chyby způsobené náhodným sampling (zachránil 6/6 v run 1 Jaroše), ale nefunguje pro deterministické truncation (runs 2+3). Primární ochranou je dostatečný token budget.

**Dopad:** Jarošův chunk 1 se vejde do limitu s rezervou 260 tokenů. Retry mechanismus zůstává jako sekundární záchrana pro samplované chyby.

---

## 2026-04-23: Retry chunku + overflow retry Phase 3 (v3.8.4)

**Status:** Decided & Implemented

**Kontext:** Dvě nezávislé chyby ve stejném commit okně:
1. `_evaluate_chunk` vrací méně kritérií než chunk obsahuje → lektor vidí 22/25.
2. `chat_completion` (Phase 3) padá na HTTP 400 při prompt_tokens + max_tokens > 16 384.

**Rozhodnutí:**
1. **Retry s vyšší teplotou:** Při `recovered < n_criteria` spustit druhý pokus s `temperature=0.3`. Vyšší teplota = jiné tokeny = šance vyhnout se stejné JSON chybě. Vybíráme výsledek s více kritérii — retry selhání neshazuje chunk.
2. **`chat_completion` → `_llm_call_with_overflow_retry`:** Stejný wrapper který chrání Phase 2 chunky. Zachytí HTTP 400, spočítá `available_tokens = context_window - prompt_tokens - 100` a zkusí znovu.

---

## 2026-04-22: Robustní chunking kritérií + asyncio.gather paralelismus (v3.8.2)

**Status:** Decided & Implemented

**Kontext:** Produkční logy (25 kritérií, 3 studenti) odhalily: (1) nespolehlivé dělení na `---` způsobovalo chunk 9 kritérií místo 8; (2) globální `max_tokens=6144` platil pro celý chunk bez ohledu na počet kritérií → verbose output, JSON parse error, 4/8 kritérií.

**Rozhodnutí:**
1. **Regex lookahead split:** `re.split(r'\n+(?=\*\*\d+\.\s*Kritérium)', ...)` — každé kritérium začíná `**N. Kritérium:`, hranice je 100% spolehlivá bez ohledu na `---` a mezery.
2. **`asyncio.gather` paralelismus per student:** Chunky jednoho studenta jdou jako paralelní requesty na vLLM. vLLM continuous batching zpracovává je jako jeden batch → maximální využití L40S GPU. 3 studenti × 5 chunků = 15 simultánních requestů.
3. **Záchranné mechanismy:** `_repair_truncated_json` (scan pro kompletní `{}` bloky), `_llm_call_with_overflow_retry` (HTTP 400 → snížení max_tokens).
4. **chunk_size=6** (bylo 8): Kratší JSON pole → model spolehlivěji dokončí bez chyby struktury.

**Dopad:** Wall clock time 146 s → ~55–90 s pro 3 studenty × 25 kritérií na L40S.

---

## 2026-04-02: Man-in-the-Loop + PDF/Excel refactor (v3.6.0)

**Status:** Decided & Implemented

**Context:** PDF exporty zobrazovaly zastaralá data (třída "Základní kurz", modelová situace "scen-2") protože DB záznamy měly stará `class_id` a prázdný `scenario_display_name`. JSON výsledky byly double-encoded (TEXT v SQLite), způsobovaly "Chyba formátu dat".

**Decisions:**
1. **Frontend jako source of truth pro PDF/Excel context:** `TabAnalytics` přijímá `className` + `scenarioName` props z `App.tsx` (aktivní sidebar výběr) a posílá je jako query params do export endpointů. Backend je použije s nejvyšší prioritou před DB lookupy. Důvod: DB záznamy mohou být stale (starý `class_id`), frontend vždy zná aktuální kontext.
2. **`_parse_json_field()` centrální helper:** Všechny přístupy k `json_result` / `content_json` TEXT sloupcům jdou přes tuto funkci (safe double-decode). Přidána do `pdf_generator.py`.
3. **Man-in-the-Loop gate:** Analýza třídy zahrnuje pouze `is_approved=True` záznamy. Lektor schvaluje explicitně po review — analytics nejsou ovlivněny nevyhodnocenými nebo chybnými záznamy.
4. **`c.nazev` vs `c.popis` v PDF:** Sloupec "Definice kritéria" v Protokolu skupiny zobrazuje `c.nazev` (krátký název kritéria). `c.popis` (AI instrukce pro vyhodnocení) je interní — nesmí se zobrazovat v PDF.

**Impact:** PDF a Excel exporty vždy zobrazují správnou třídu a modelovou situaci. Eliminovány 500 errory z double-encoded JSON.

---

## 2026-03-18: Parallel processing bugfix & Dark Mode Overhaul (v3.2.5)

**Status:** Decided & Implemented
**Context:** In v3.2.4, batch evaluations were still processing sequentially despite the parallel queue worker. The issue was traced to a redundant `Semaphore(1)` in the `evaluate_batch` endpoint. Additionally, the Dark Mode was reported as unreadable due to low-contrast dark blue text on a dark background.

**Decisions:**
1. **Removed Redundant Locking:** Deleted `evaluate_semaphore = Semaphore(1)` from `backend/api/evaluate.py`. This ensures that multiple requests from the same batch are concurrently added to the global `EvaluationQueue`, which now correctly handles parallelism (concurrency=8).
2. **Visual Contrast Overhaul:** Re-designed the Dark Mode color system. Switched from `text-[#002855]` to `dark:text-[#facc15]` (Gold) for all primary highlights, headings, and active states.
3. **Dynamic Versioning:** Refactored `Header.tsx` to import the version directly from `package.json` using a side-channel import, eliminating the risk of version mismatch between the UI and the codebase.

**Impact:**
- **Performance:** Parallel evaluation on L40S is now fully unlocked (verified by backend logs showing simultaneous AI calls).
- **Usability:** Significant improvement in readability and professional aesthetics in Dark Mode.
- **Maintainability:** Simplified version management.


## 2026-03-17: vLLM Integration & Batch UI Stability

**Status:** Decided & Implemented
**Context:** After switching to vLLM, the backend failed due to missing database queries for inference parameters (`top_p`, penalties). This caused the Fast-Scan (identity extraction) to crash, leading to unsaved student records that disappeared on navigation. UI feedback was too optimistic, reporting success despite background errors.

**Decisions:**
1. **Explicit Parameter Fetching:** All LLM engine calls (`evaluate_report`, `extract_identity`) must now explicitly query `AppSettings` for all relevant inference parameters from the DB to ensure consistency and avoid `NameError`.
2. **Frontend Error Tracking:** The `TabEvaluation` component now implements an `errorCount` state that is incremented via WebSocket `EVAL_ERROR` events.
3. **Conditional Feedback:** completion toast messages must distinguish between 100% success and partial failures.
4. **NFC Normalization enforcement:** Re-verified that all filename comparisons are normalized to NFC to prevent "ghost" records in the UI Roster.

**Impact:**
- Full persistence of newly uploaded records (Fixes "disappearing records" issue).
- Reliable evaluation tracking for lecturers on intranet servers.
- Compatible with vLLM, LM Studio, and Ollama providers.

## 2026-03-17: LLM Parameter Enforcement (v3.2.1)

**Status:** Decided & Implemented
**Context:** vLLM inference servers often have a hard-coded context limit (e.g., 16384 tokens). EVALUZ was previously hard-coding `max_tokens: 16384` for the completion, which, when added to large inputs (11k+ tokens), exceeded the server's capacity even if the model itself supported larger contexts.

**Decisions:**
1. **Dynamic Token Management:** The `max_tokens` parameter for LLM calls is now dynamically fetched from the database (`VLLM_MAX_TOKENS`). This ensures users can tune the "reservation" for output to fit within the server's context window.
2. **Key Deduplication:** Fixed a bug in `llm_engine.py` where `max_tokens` was provided twice in the `kwargs` dictionary, ensuring clean API requests.
3. **Admin Consistency:** The `evaluate_report` function now correctly uses the database setting instead of bypassing it, restoring control to the Lecturers via the Administration panel.

**Impact:**
- Resolved "Error 400 - Context Length Exceeded" for large evaluation tasks.
- Improved reliability on resource-constrained vLLM deployments.
- Restored integrity between UI settings and backend execution.

## 2026-03-18: Parallel Processing & Batching (v3.2.2)

**Status:** Decided & Implemented
**Context:** vLLM inference engines are highly efficient when handling multiple requests concurrently (batching). The previous sequential queue worker was underutilizing the server's throughput, leading to slow mass evaluations. Additionally, reasoning/thinking models were consuming too much output budget in a constrained context window.

**Decisions:**
1. **Concurrency Support:** Refactored `EvaluationQueue` to support parallel task execution using `asyncio.Semaphore`. This allows the Orchestrator to define the degree of parallelism (default set to 4).
2. **Batch Throughput:** Tasks are now spawned as background tasks (`asyncio.create_task`), allowing vLLM to process them as a single batch, significantly reducing total wall time for large classes.
3. **Reasoning Budget Management:** Identified that the "Thinking" Monologue in Qwen-based models counts towards `max_tokens`. In 16k context environments, users are recommended to disable "Enable Thinking" for Phase 2 to prevent JSON truncation.

**Impact:**
- Drastically improved performance for batch evaluations.
- Support for high-throughput vLLM backends.
- Mitigation for truncated JSON responses on small context models.

## 2026-03-18: Hardware-Specific Concurrency Tweak (v3.2.3)

**Status:** Decided & Implemented
**Context:** The production environment uses NVIDIA L40S 48GB VRAM cards. Initial concurrency of 4 was too conservative given the 18GB+ of free VRAM after loading the Qwen-30B-FP8 model.

**Decisions:**
1. **Higher Concurrency:** Increased `concurrency` to 8 in the background worker. This allows for better exploitation of vLLM's batching capabilities on high-end hardware.
2. **Resource Validation:** Confirmed that with ~10-12 criteria, the total token budget (Input + Output) fits within the current 16k server limit while allowing for `max_tokens` up to 10,000 for the response.

**Impact:**
- Significant reduction in evaluation latency for large class batches.
- Efficient utilization of L40S GPU resources.

## 2026-03-18: UI & Export Stability Fixes (v3.2.4)

**Status:** Decided & Implemented
**Context:** Production feedback indicated issues with the evaluation button status, PDF font errors in the containerized environment, and sub-optimal UI sizing for criteria editing.

**Decisions:**
1. **Batch Progress Reset:** Fixed the `totalToEvaluate` accumulation bug in `TabEvaluation.tsx` by resetting it for each new batch.
2. **Flexible UI Layout:** Converted the main tab container in `App.tsx` and `TabCriteria.tsx` to a full-height flex column, ensuring the criteria editor expands to fill the screen on large displays.
3. **Robust PDF Generation:** Fixed `BASE_DIR` calculation in `pdf_generator.py` and updated `add_font` parameters to match `fpdf2` standards, resolving the Docker font error.
4. **Excel Data Integrity:** Changed the "Average Score" export to a numeric value with right-alignment for better readability.
5. **Feedback Field UX:** Renamed the final feedback label to "Zpětná vazba lektora" and increased the textarea height to `h-40` (approx 10 lines) for easier proofreading.

**Impact:**
- Eliminates UI hanging during large batch evaluations.
- Significantly improves readability and usability of the criteria editor.
- Fixes critical production crashes during PDF report generation.

## 2026-03-18: Data Isolation & Instructor Partitioning (v3.3.0)

**Status:** Decided & Implemented
**Context:** Reports of "data leaks" or "cross-talk" between instructors on the server. The cause was identified as global, shared states in several database tables (`class_analyses`, `golden_examples`) and missing `lecturer_id` filters in analytics queries. WebSocket broadcasts were also global, showing anyone's evaluation status to any connected user.

**Decisions:**
1. **Schema Partitioning:** Added `lecturer_id` and `class_id` to the `ClassAnalysis` model and `lecturer_id` to `GoldenExample`. Replaced the `unique=True` constraint on `scenario_id` with a non-unique index to allow independent analyses of the same scenario by different instructors.
2. **WebSocket Isolation:** Refactored `EvaluationQueue` to store `active_connections` as a mapping of `{lecturer_id: [WebSocket, ...]}`. Broadcasts are now strictly filtered by the instructor who initiated the task.
3. **Analytics & Export Filtering:** Enforced `lecturer_id` checks across all analytics and export endpoints. `generate_class_summary` now requires the instructor's ID to fetch the correct evaluations and cached results.
4. **Classroom Personalization:** Removed the hard-coded `class_id=1` logic. The system now automatically creates and retrieves a private "Základní kurz" (Default Class) for each instructor individually.
5. **Service Signature Update:** Updated `evaluate_report` and `extract_identity` signatures in `llm_engine.py` to accept `lecturer_id` for potential future context-aware logic (e.g., instructor-specific RAG).

**Impact:**
- **Security:** Complete data isolation between instructors. Users can no longer see, delete, or influence each other's data.
- **Privacy:** Status updates via WebSockets are now private.
- **Reliability:** Eliminated cache collisions where one instructor's analysis was overwritten by another.
111: 
112: ## 2026-03-18: WebSocket Fix & Auto-Migration (v3.3.1)
113: 
114: **Status:** Decided & Implemented
115: **Context:** After deploying v3.3.0 to the production server, users reported 403 Forbidden errors on WebSockets and 500 Internal Server Errors in analytics. The causes were identified as (1) the frontend missing the mandatory `lecturer_id` in the WebSocket URL and (2) the PostgreSQL database lacking the new `lecturer_id` columns required by the code.
116: 
117: **Decisions:**
118: 1. **Robust WebSocket Handshake:** Updated `App.tsx` and `TabEvaluation.tsx` to explicitly fetch the `lecturerId` from the authenticated profile and include it in the `/ws/{id}` path.
119: 2. **In-App Schema Migration:** Integrated a `run_migrations(engine)` utility into the backend's `init_db()` sequence. This function uses raw SQL to "ADD COLUMN IF NOT EXISTS" for `lecturer_id` and other recent additions, ensuring that a simple code pull and restart fixes the database on the server without manual SQL intervention.
120: 3. **Version Synchronization:** Unified all version labels (`package.json`, `main.py`, `README.md`, and technical docs) to `v3.3.1` to ensure consistency in logs and UI.
121: 
122: **Impact:**
123: - **Maintenance:** "Zero-touch" updates for system administrators (database fixes itself on boot).
124: - **Stability:** Fixed critical production crashes in analytics and real-time status tracking.
125: - **Robustness:** Added `DO $$ BEGIN ... END $$;` blocks with column existence checks to ensure that `lecturer_id`, `class_id`, and `user_id` are added even if `class_analyses`, `golden_examples`, or `export_history` tables already existed.
126: - **Stability:** Fixed critical production crashes (500 Internal Server Error) caused by missing `class_analyses.class_id`.
127: - **Clarity:** Clear version tracking across the entire stack.

## 2026-03-26: RBAC, Data Isolation & UX Refinement (v3.5.0)

**Status:** Decided & Implemented
**Context:** The system required a transition from a single-user prototype to a multi-role enterprise application. This involved renaming terminology for better organizational fit, implementing strict Role-Based Access Control (RBAC), and ensuring data privacy through role-based isolation. Additionally, user feedback highlighted critical UX flaws in the criteria and evaluation tabs.

**Decisions:**
1. **Terminology Standardization:** Renamed visual instances of "Lektor" to "Vyučující" (Instructor) across the UI and PDF exports. Database schema names (`Lecturer`, `lecturer_id`) remain unchanged to preserve system stability and backward compatibility.
2. **Multi-Role RBAC:** 
    - Introduced three distinct roles: `Vyučující` (Standard), `Admin` (Departmental), and `SuperAdmin` (System).
    - Secured prompts and system settings via `verify_superadmin` middleware in `backend/api/admin.py`.
    - Implemented a role-management interface in `AdminModal.tsx` for SuperAdmins.
3. **Dynamic Data Isolation:** 
    - Implemented `apply_data_isolation` helper in `backend/api/auth.py`.
    - `Vyučující` only see their own records.
    - `Admin` see all records within their `school_location`.
    - `SuperAdmin` have global visibility.
    - Isolation is enforced across analytics, evaluations, and exports.
4. **Criteria UX Hardening:** 
    - Refactored `TabCriteria.tsx` to include a persistent "Save success" state that only resets on manual input (`onChange`).
    - Added `try...catch` blocks to prevent "White Screen of Death" during DB operations, providing visual error feedback on the button.
5. **Evaluation UX & State Stability:**
    - **Dynamic Empty States:** Replaced static "Upload UI" with contextual guidance (empty vs. uploaded vs. selected).
    - **Determinstic Selection Logic:** Removed redundant `selectAll` state in `TabEvaluation.tsx`. Checkbox counters and "Select All" status are now derived directly from the `selectedIds` array, eliminating desynchronization bugs.
    - **Renamed Action Button:** Changed mass evaluation button to "Vyhodnotit označené ÚZ" for clarity.

**Impact:**
- **Security:** Strict departmental data silos prevent unauthorized data access.
- **Scalability:** The system is now ready for multi-department deployment with centralized management.
- **Stability:** Significant reduction in UI crashes and logical desyncs in the evaluation workflow.
- **Usability:** Improved user guidance through the evaluation funnel.

---
*Archived by System Scribe ✍️*
