# CHANGELOG — EVALUZ

---

## [v3.10.9] — 2026-06-04 — Ochrana evaluace bez kritérií + vizuální počet kritérií

### Problém

Lektor mohl spustit dávkové vyhodnocování i bez uložených kritérií — v UI nebyl nikde vidět počet uložených kritérií a frontend přítomnost kritérií před odesláním dávky nekontroloval. Backend navíc mohl při NULL hodnotě `markdown_content` selhat s HTTP 500 místo čistého 404.

### Backend

- **`backend/api/evaluate.py`** — oprava potenciálního `AttributeError`: `(criteria_record.markdown_content or '').strip()`. Sloupec `markdown_content` je `nullable=True`; při NULL hodnotě dříve hrozila 500 místo korektní 404. Blokace evaluace bez kritérií tím zůstává spolehlivá.
- **`backend/api/criteria.py`** — `GET /criteria/{scenario}` nově vrací `criteria_count` (počet rozparsovaných kritérií z tabulky `Criterion`). `POST /criteria/save` vrací `criteria_count` (= počet rozparsovaných položek). Prázdný/NULL markdown vrací `criteria_count: 0`.

### Frontend

- **`src/components/TabCriteria.tsx`** — state `criteriaCount`, badge v hlavičce editoru: **„Uloženo: X kritérií"** (zvýrazněné červeně při 0). Po uložení s 0 kritérii se zobrazí varování *„Kritéria uložena jako prázdná — evaluace nebude možná."* Reset countu při změně scénáře.
- **`src/components/TabEvaluation.tsx`** — state `criteriaCount`, chip v action baru **„Kritéria: X"** (zelený při >0, červený s ikonou varování při 0). `handleBatchEvaluate()` před spuštěním dávky provede čerstvý fetch počtu kritérií ze serveru a při 0 zobrazí error toast + evaluaci nezahájí (chrání i případ zastaralého stavu po editaci v jiné záložce). Nový `isActive` prop obnoví počet při přepnutí na záložku.
- **`src/App.tsx`** — předání `isActive={activeTab === 'evaluation'}` do `TabEvaluation`.

Bez potvrzovacích dialogů, pouze vizuální zpětná vazba + tvrdá blokace při 0 kritérií. Existující vyhodnocení se nemění.

---

## [v3.10.8] — 2026-06-03 — Page Visibility API fix (UI zaseknutí při vyhodnocování)

### TabEvaluation.tsx — visibilitychange listener

- Přidán `document.addEventListener('visibilitychange', ...)` v `useEffect` závislém na `isEvaluating`. Pokud uživatel přepne záložku a vrátí se zpět *v době aktivního vyhodnocování*, browser mohl pozastavit JS timery (setTimeout reconnect WS). Po návratu záložky do popředí (`visibilityState === 'visible'`) se okamžitě zavolá `fetchEvaluations()` — výsledky se načtou z DB bez nutnosti manuálního refreshe.
- Listener se registruje jen pokud `isEvaluating === true`, takže nemá dopad na výkon při nečinnosti.

**Kontext:** Single-call evaluace trvá ~105 s. WS timer pro auto-reconnect (3 s) mohl být prohlížečem pozastaven při přepnutí záložky → uživatel viděl loading bez výsledků i po dokončení, dokud neprovedl F5.

---

## [v3.10.7] — 2026-06-03 — Oprava matching kritérií pro multi-person ÚZ (PARTIAL RECOVERY fix)

### llm_engine.py — _canonicalize_criterion_name + _PERSON_SUFFIX_RE + fallback match

Tři koordinované změny řeší `PARTIAL RECOVERY: 6/25` na scénářích kde kritéria
obsahují jméno osoby jako součást názvu (multi-person ÚZ, např. scen-2 s
Ivana Horáková + Tadeáš Kadlec).

- **`_PERSON_SUFFIX_RE`** — regex rozšířen o volitelnou závorku za jménem osoby:
  `(?:\s*\([^)]*\))?` na konci. Předchozí pattern `\s*$` selhal pokud za jménem
  následovala závorka, např. `– Ivana Horáková (negativní)` nebo
  `– Tadeáš Kadlec (Příkaz k dodání do VTOS jako důvod)`. Suffix se nestripoval →
  kanonická jména nesedět → 19/25 kritérií označeno `llm_omitted`.

- **`_canonicalize_criterion_name()`** — přidána normalizace pomlček před aplikací
  suffix regexu: em-dash (—) a en-dash (–) → hyphen (-). LLM (Qwen3.6 i jiné)
  konzistentně mění typ pomlčky v názvech kritérií, což způsobovalo neshodu i
  při jinak správném obsahu. Pořadí kroků: strip prefix → strip bold → normalizace
  pomlček → strip person suffix → lowercase.

- **`_validate_and_fix_vysledky()`** — přidán fallback substring match jako záchrana
  pro zbývající edge-cases: pokud přesná kanonická shoda selže, hledáme expected
  kritérium jehož canonical je podřetězcem LLM canonical nebo naopak. Loguje na DEBUG.

**Potvrzeno testováním:**
```
"7. Kritérium: Ztotožnění osoby – ... – Ivana Horáková"  → match ✓
"8. Kritérium: Výsledek lustrace – PATROS - Ivana Horáková (negativní)"  → match ✓
```

**Zbývající omezení:** Pokud LLM zkrátí název kritéria (parafráze místo doslovné kopie),
matching selže i po těchto opravách. Příklad z testování:
LLM vrátil `"podání vysvětlení"`, expected bylo `"poučení před podáním vysvětlení"`.
Jedná se o LLM halucinaci/zkrácení — řeší se na úrovni promptu, ne matchingu.

---

## [v3.10.6] — 2026-06-02 — vLLM overflow fix + přesnější token odhad + UX chybových notifikací

### llm_engine.py — overflow retry pro vLLM

- **`_llm_call_with_overflow_retry()`** — opravena regex podmínka detekce překročení kontextu. Původní pattern `(\d+) in the messages` odpovídal pouze OpenAI formátu chybové zprávy; vLLM vrací `your prompt contains at least (\d+) input tokens`, takže retry se nikdy nespustil a volání okamžitě selhalo s HTTP 400. Nový regex zachytí obě varianty: OpenAI i vLLM. Mechanismus nyní správně sníží `max_tokens` na `limit − input_tokens − 300` a zopakuje volání.

### llm_engine.py — konzervativnější token odhad pro češtinu

- **`_estimate_tokens()`** — koeficient změněn z `3,5 zn/token` na `2,5 zn/token`. Česká diakritika se v modelech (Qwen, Mistral) tokenizuje hustěji než angličtina (~2,0–2,5 zn/token). Původní hodnota 3,5 podhodnocovala vstupní tokeny o 30–40 %, což mohlo způsobit chybné rozhodnutí single-call vs. chunking (model dostával prompt příliš velký pro kontext). Při ostrém provozu s 25 kritérii a 10 normostranami (≈ 9 000 skutečných tokenů vstupního textu) je přesný odhad kritický.
- **`_evaluate_chunk()`** — přidán log `est_input≈X, total≈Y` per chunk. Umožňuje okamžitou diagnostiku tokenového rozpočtu v produkčních logách bez nutnosti externího tokenizéru.

### TabEvaluation.tsx — vizuální rozlišení chybových notifikací

- **`toastMessage` state** — typ změněn z `string | null` na `{ text: string; type: 'success' | 'error' } | null`. Všechna volání `setToastMessage()` aktualizována.
- **Toast render** — chybová zpráva (typ `error`) zobrazena s červeným pozadím (`--color-negative`) a ikonou `faTriangleExclamation`; úspěch zůstává beze změny (sekundární barva, `faCircleCheck`). Dříve všechny notifikace vypadaly vizuálně stejně — chyba vyhodnocení se zobrazila jako zelená "success" hláška.

### Doporučení pro vLLM deployment (ostrý provoz)

Pro spolehlivý provoz s 25 kritérii a dokumenty o 10+ normostranách je třeba spustit vLLM s:
```
--max-model-len 32768
```
Hodnota 4096 (vLLM default) nestačí: 10 normostran generuje ≈ 7 200 vstupních tokenů; spolu s výstupem 3 300 tokenů/chunk by byl celkový limit překročen i při 16 384.

---

## [v3.10.5] — 2026-05-06 — Analytics prázdný stav UX

- **`src/components/TabAnalytics.tsx`** — Explicitní prázdný stav při `data=null`: card s ikonou, vysvětlujícím textem a tlačítkem "Generovat analýzu" (volá `fetchAnalytics(force=true)`). Dříve se zobrazila prázdná plocha bez jakékoli výzvy k akci.

---

## [v3.10.4] — 2026-05-06 — Analytics force gate

- **`backend/services/analytics.py`** — `generate_class_summary()`: bez `force=True` se AI generování nikdy nespustí. Pokud cache neexistuje a `force=False`, vrátí `{"status":"no_analysis"}`. Opravuje race condition: page refresh během generování spouštěl druhé souběžné LLM volání (force=False bez cache propadl k AI generování).
- **`src/components/TabAnalytics.tsx`** — Handler pro `status="no_analysis"`: `setData(null)` bez erroru. Zobrazí prázdný stav (viz v3.10.5).

---

## [v3.10.3] — 2026-05-06 — Queue deduplicace + seeder fix

- **`backend/services/evaluation_queue.py`** — `EvaluationQueue` dostala `_active_keys: Set[str]` sledující klíče `{lecturer_id}:{scenario_id}:{filename}`. `add_task()` vrátí `False` a přeskočí studenta pokud je klíč aktivní. `_run_task()` finally uvolní klíč. `clear_queue()` čistí i `_active_keys`. Zabraňuje duplicitnímu vyhodnocení při jakémkoli re-submitu dávky.
- **`backend/core/seeder.py`** — Nový helper `_seed_setting(db, key, value)`: každý `AppSettings` klíč dostane vlastní `db.commit()` + `try/except rollback`. Odstraňuje batch commit způsobující `IntegrityError` při unique violation (nový klíč FEEDBACK_MAX_TOKENS nebyl seeded na existujících DB). Prompt upgrade sekce dostala vlastní `db.commit()`.

---

## [v3.10.2] — 2026-05-06 — WS reconnect fix

- **`src/components/TabEvaluation.tsx`** — Přidán `wsConnectCountRef` (useRef) počítající připojení. `ws.onopen` při reconnectu (count > 1) volá pouze `fetchEvaluations()` bez resetu stavů. Starý kód resetoval `'evaluating' → 'pending'` před fetchem, čímž ničil logiku zachování evaluating statusu a způsoboval automatické re-odesílání dávek po reconnectu.
- **`src/components/TabEvaluation.tsx`** — Opraven self-healing `useEffect`: odstraněna podmínka `evaluatedCount === 0` (bránila správnému self-healingu po WS reconnectu).

---

## [v3.10.1] — 2026-05-06 — Feedback mimo critical path (O2+O3)

### O2 — FEEDBACK_MAX_TOKENS konfigurovatelný

- **`backend/services/llm_engine.py`** — `_generate_individual_feedback()`: `max_tokens=600` (hardcoded) nahrazeno čtením z DB klíče `FEEDBACK_MAX_TOKENS`. Výchozí hodnota 250 (3–5 vět v češtině ≈ 150–180 tokenů). Čteno při každém volání — bez restartu.
- **`backend/core/seeder.py`** — seed `FEEDBACK_MAX_TOKENS=250` při prvním startu (INSERT IF NOT EXISTS).

### O3 — Decoupling zpětné vazby od critical path

- **`backend/services/llm_engine.py`** — `evaluate_report()` vrací `zpetna_vazba=""` (obě cesty — chunking i single-call). Nová public funkce `generate_feedback_for_record(merged, db, student_log_prefix)` — čte LLM nastavení z DB, sestaví klienta, zavolá `_generate_individual_feedback()`.
- **`backend/api/evaluate.py`** — nová funkce `_run_feedback_task(eval_record_id, lecturer_id, student_name, scen_id)` (module-level, vlastní DB session). Po `EVAL_SUCCESS` broadcastu spuštěn `asyncio.create_task(_run_feedback_task(...))`. Task: načte `json_result` z DB, zavolá `generate_feedback_for_record()`, provede partial update `json_result.zpetna_vazba`, odešle `FEEDBACK_DONE` WebSocket zprávu.
- **`src/components/TabEvaluation.tsx`** — handler `FEEDBACK_DONE` → `fetchEvaluations()`.

### Výsledek

- EVAL_SUCCESS přichází ~3–5 s po zahájení evaluace (chunking fáze hotová).
- Zpětná vazba se doplní async za dalších ~15–60 s (závisí na modelu a rate limitingu).
- 52/52 testů pass.

---

## [v3.10.0] — 2026-05-05 — LLM engine refactor (E1–E7)

7-etapový refaktor `llm_engine.py`. Cíl: zjednodušení kódu budovaného pro 8k kontext, který je s 128k vLLM zbytečně složitý.

### E1 — Integration test suite

- **`backend/tests/integration/mock_llm.py`** — `MockLLMRouter`: FIFO fronta odpovědí, respx interceptor pro `http://mock-vllm:8001/v1/chat/completions`. Metody: `respond_clean`, `respond_truncated` (deterministický cut před `}}`), `respond_with_extra_criteria`, `respond_chunk_pattern`, `respond_identity`, `respond_empty`.
- **`backend/tests/integration/conftest.py`** — fixtures: `db_engine` (SQLite `:memory:`), `db` (seeded session per test), `client` (FastAPI bez lifespan), `auth_headers`, `mock_llm`. Seed: VLLM_API_URL=`http://mock-vllm:8001/v1`, LLM_PLATFORM=vllm, CHUNK_SIZE=6, CHUNK_THRESHOLD_TOKENS_PCT=0.7, sample criteria CRITERIA_3/6/12.
- **`backend/tests/integration/test_evaluate_endpoint.py`** — 10 integračních testů (viz sekce Test suite v TECHNICAL_DOCUMENTATION.md).

### E2 — Adaptivní chunking

- **`_estimate_tokens(text)`** — `max(1, len(text) // 3)` (~3.5 chars/token pro češtinu).
- **`PLATFORM_CONTEXT_DEFAULTS`** — výchozí kontextová okna: vllm=131072, openai=128000, openrouter/ollama/lmstudio=8192.
- **`_get_setting(db, key, default)`** — helper pro čtení `AppSettings` s fallbackem.
- `evaluate_report()` rozhoduje adaptivně: `est_tokens > budget × threshold_pct` → chunking; jinak přímé volání.
- `CHUNK_SIZE` a `CHUNK_THRESHOLD_TOKENS_PCT` čteny z DB per volání.
- **`seeder.py`**: automatický seed `CHUNK_SIZE=6` a `CHUNK_THRESHOLD_TOKENS_PCT=0.7` při startu.
- **`backend/pytest.ini`**: přidán `asyncio_default_fixture_loop_scope = function`, definice `integration` markeru.
- **`backend/requirements-dev.txt`**: přidán `respx>=0.21`.

### E3 — Bugfixy a helper

- **`backend/utils/text.py`** (nový soubor): `clean_filename_to_display(filename)` — strip šumových prefixů (ÚZ, VTOS, hlaseni), podtržítka → mezery, trim.
- **`backend/api/evaluate.py`**: `clean_filename_to_display` použit v fast-scan i batch display name (2 místa).
- **Oprava identity update podmínky**: `existing_eval.student_identity or {}` + explicitní `bool(identita.get("prijmeni","").strip())` — prázdný `{}` byl dříve falsy, identita se nepřepisovala.
- **OpenRouter reasoning kwargs**: `_build_llm_kwargs()` přidává `reasoning` parametry pouze pro OpenRouter platformu.

### E4 — Logging infrastruktura

- `logger = logging.getLogger("evaluz.llm")` v `llm_engine.py`.
- `logging.getLogger("httpx").setLevel(logging.WARNING)` a `logging.getLogger("httpcore").setLevel(logging.WARNING)` v `core/logging_config.py`.

### E5 — Kompletní migrace print → logger

- 41× `print()` v `llm_engine.py` nahrazeno `logger.info/warning/error/debug`.
- `_dump_raw_llm_output` chráněno `if logger.isEnabledFor(logging.DEBUG):`.

### E6 — Smazání repair/recovery vrstev (−121 řádků z llm_engine.py)

- **`_repair_truncated_json()`** — smazána (~120 řádků). S 128k kontextem je truncace prakticky nemožná; fail-fast přes `ValueError` je správnější.
- **`_check_partial_recovery()`** — smazána (~30 řádků). `_partial_recovery` flag se již nevytváří.
- **Chunk retry loop** — smazán (~15 řádků). Při neúplném výsledku se vrátí placeholdery, lektor re-evaluuje.
- **`backend/tests/test_llm_pipeline.py`**: odstraněny importy a testy smazaných funkcí (`TestCheckPartialRecovery`, `TestRepairTruncatedJson`).
- **`backend/tests/integration/test_evaluate_endpoint.py`**: `test_partial_recovery_flag_in_response` → přepracován na `test_missing_criteria_get_placeholders` (ověřuje, že `_partial_recovery` NENÍ v odpovědi).

### E7 — Frontend cleanup

- **`src/components/TabEvaluation.tsx`**: odstraněn partial_recovery badge v listu studentů a varující panel v detailu hodnocení.
- **`src/types.ts`**: odstraněno `partial_recovery?: { expected, recovered, lost, reason } | null` z rozhraní `Student`.

### Výsledek

- `llm_engine.py`: ~1000 → ~600 řádků.
- 52/52 testů pass.
- `backend/__version__.py`: 3.9.10 → 3.10.0.

---

## [v3.9.8] — 2026-05-04

### Opraveno

- **`evaluate_batch` — fronta místo dict**: Záznamy studentů jsou čteny z asyncio fronty správně za sebou. Dřívější implementace používala dict s race condition při souběžné evaluaci více studentů.
- **Body z DB**: Při sestavení `expected_criteria_bodies` se body čtou z definice kritérií v DB, ne z předchozího `json_result` — eliminuje drift při re-evaluaci po změně kritérií.
- **Řazení výstupu**: `vysledky[]` v `json_result` jsou seřazeny dle pořadí vstupních kritérií. Konzistentní pořadí v UI, PDF i Excel bez ohledu na pořadí v LLM odpovědi.

---

## [v3.9.7] — 2026-05-04

### Opraveno

- **Přepočet `celkove_skore` ignoruje body u `splneno=false`**: Normalizace v `_merge_chunk_results()` nastavuje `body=0` pro všechny záznamy kde `splneno=False`. Model mohl vrátit `splneno=false, body=3` — tyto body se dříve chybně sčítaly do celkového skóre.

---

## [v3.9.6] — 2026-05-03

### Přidáno

- **Kanonizační match v `_validate_and_fix_vysledky()`**: `_canonicalize_criterion_name()` — strip prefixu `**N. Kritérium:`, trailing `**`, person suffix `– Jméno Příjmení`. Nahrazuje exact-match. Původní LLM název uložen do `_llm_actual_name`.
- **Multi-person duplikát detection**: První výskyt zachován, duplikáty logovány.
- **`CRITERIA_DELIMITER = "#############"`**: Vkládán mezi kritéria v promptu. `_split_criteria_chunks()` primárně dělí přes delimiter, legacy regex lookahead jako fallback. `parse_criteria_markdown()` synchronizována.
- **Pytest regression suite** (`backend/tests/test_llm_pipeline.py`, 36 testů): kanonizace, validace, sanitizer, chunking, merge, parser, integrační case Kořař.
- **fontTools log noise potlačen**: `core/logging_config.py` — `WARNING` úroveň pro `fontTools.*`.

---

## [v3.9.5] — 2026-04-29

### Přidáno

- **FIX B** — `_dump_raw_llm_output()`: Raw dump při JSON parse erroru do `/app/logs/llm_parse_errors/`. Volume mount v `docker-compose.yml`.
- **FIX A** — `_validate_and_fix_vysledky()`: Post-parse validace, placeholdery (`_llm_omitted=true`). `evaluate_report()` dostává `expected_criteria_names`.
- **FIX C** — `_check_partial_recovery()`: `_partial_recovery` metadata v `json_result`. Frontend: oranžový badge + varující panel. *(Odstraněno v v3.10.0.)*
- **FIX D** — Sanitizer: lone backslash → `\\`, kontrolní znaky 0x00–0x1F → `\uXXXX`.

---

## [v3.9.4] — 2026-04-29

### Opraveno

- **Scroll-to-top**: `studentListScrollRef` na levý panel (dříve scrollovalo pravý panel).
- **Analytics auto-refresh**: Prop `isActive: boolean` + `useEffect([isActive])` v `TabAnalytics`.
- **URL state persistence**: `activeTab` a `activeScenarioId` synchronizovány do URL search params přes `window.history.replaceState`.
- **Statistics filter-options**: `json_result IS NOT NULL` filtr v `scenario_query`.

---

## [v3.9.3] — 2026-04-28

### Opraveno

- Statistiky: `json_result IS NOT NULL` filtr v `/statistics/dashboard`.
- Scroll v panelu kritérií: `overflow-y: auto` na textarea.
- Re-evaluace: povolena pro `is_approved=false` záznamy (`canEvaluate` logika).

---

## [v3.9.2] — 2026-04-24

### Opraveno

- `_sanitize_json_string_values()`: oprava look-aheadu při chybějící čárce (vzor `"value""key":`).
- `_repair_truncated_json()`: per-block sanitizace — zachrání bloky s neescapovanými znaky.

---

## [v3.9.1] — 2026-04-24

### Přidáno

- `_sanitize_json_string_values()`: scan znak po znaku, escapování vnitřních uvozovek a literálních newlines. Vložena do parse pipeline jako 2. úroveň fallbacku.

---

## [v3.9.0] — 2026-04-23

### Přidáno

- `PROMPT_VERSION` upgrade systém v `seeder.py`.

### Změněno

- `DEFAULT_PROMPT_PHASE2`: zásadní přepis pro qwen3-30b-instruct (non-reasoning). Chain-of-thought přes pole `oduvodneni`.
- `DEFAULT_PROMPT_FEEDBACK`: limit 120 slov, jmenovat nesplněná kritéria.
- `DEFAULT_PROMPT_PHASE3`: 200–350 slov, tučné sekce.
- `_evaluate_chunk` user prompt: JSON-only instrukce na začátek, explicitní počet kritérií.

---

## [v3.8.7] — 2026-04-24

### Přidáno

- `_generate_individual_feedback()`: separátní LLM volání po merge, max 600 tokenů. Fail-safe: chyba neblokuje uložení evaluace.
- `prompt_feedback` editovatelný v Administraci.

---

## [v3.8.6] — 2026-04-24

### Přidáno

- Phase 3 filtrování: top 5 nejhůře splněných + vše pod `ANALYTICS_THRESHOLD` (výchozí 80 %). Frontend dostává kompletní data.
- `ANALYTICS_THRESHOLD` konfigurovatelný v DB.

---

## [v3.8.5] — 2026-04-24

### Opraveno

- Token budget: 350 → 500 tokenů/kritérium. Česká tokenizace ~1.5–1.7 zn/token.

---

## [v3.8.4] — 2026-04-23

### Přidáno

- Chunk retry s `temperature=0.3` při neúplném výsledku.
- `_llm_call_with_overflow_retry()`: HTTP 400 → automatické snížení `max_tokens`.

---

## [v3.8.3] — 2026-04-23

### Změněno

- `CHUNK_SIZE`: 8 → 6.

### Přidáno

- WebSocket self-healing: auto-reset `evaluating` stavu při reconnectu.

---

## [v3.8.2] — 2026-04-22

### Přidáno

- `_split_criteria_chunks()`: regex lookahead split, `asyncio.gather` parallelismus.
- Adaptivní `max_tokens` per chunk: `min(global_max, n_criteria × 350 + 300)`.
- `_repair_truncated_json()`: recovery z oříznutého JSON výstupu. *(Odstraněno v v3.10.0.)*
- `_llm_call_with_overflow_retry()`: zachytí HTTP 400.
- Dynamická verze v záhlaví: `GET /api/v1/version`.

---

## [v3.7.7] — 2026-04-13

### Opraveno

- `VLLM_API_URL` default: `""` místo `"http://localhost:8000/v1"`.
- `POST /admin/test-llm`: async OpenAI, specifické error handlery, validace prázdného URL.

---

## [v3.7.5] — 2026-04-10

### Architektura

- Alembic migrace přesunuty z `lifespan()` do `Dockerfile CMD`. Eliminuje race condition při více uvicorn workerech.

---

## [v3.7.4] — 2026-04-10

### Opraveno

- `UndefinedColumn` u `class_analyses.computed_at` a `.version`.
- Defensivní deserializace `json_result` (double-encoded TEXT sloupce).

### Přidáno

- Alembic migrace `f1e2d3c4b5a6 ensure_schema_integrity`: idempotentní IF NOT EXISTS záchrana.

---

## [v3.7.3] — 2026-04-10

### Opraveno

- Crash loop při více uvicorn workerech: PostgreSQL advisory lock v `run_alembic_migrations()`.

---

## [v3.7.2] — 2026-04-10

### Přidáno

- Samoregistrace: `POST /auth/register` — role vždy `vyučující`, rate-limit 5/min.
- Registrační formulář na login obrazovce.

---

## [v3.7.1] — 2026-04-10

### Přidáno

- `ProfileModal.tsx`: osobní údaje, doložka, změna hesla. Odděleno od `AdminModal`.
- Tlačítko Administrace: viditelné pouze pro `isAdminUser`.

---

## [v3.7.0] — 2026-04-09

### Přidáno

- `TabStatistics` (TabMonitor): Recharts vizualizace, Excel export, RBAC.
- `scenario_display_name` v DB (`StudentEvaluation`). Alembic migrace.
- Rozdělená LLM souběžnost: `LLM_CONCURRENCY_OPENROUTER` (výchozí 2) a `LLM_CONCURRENCY_VLLM` (výchozí 8).

### Opraveno

- PDF export třídy: správný auth dependency.
- Excel B2/B3: třída a modelová situace z query params.
- Statistiky: `datetime[:10]` → `strftime('%Y-%m-%d')`.
- Re-evaluace: `is_approved` reset na False.

---

## [v3.6.0] — 2026-04-02

### Přidáno

- Man-in-the-Loop schvalovací workflow: `is_approved` sloupec, badge "K revizi"/"Schváleno".
- PDF Protokol o hodnocení studijní skupiny: kompletní refactoring (titulek, tabulka, škála).
- `_parse_json_field()` helper v `pdf_generator.py`.

### Opraveno

- Double-encoded JSON v exportech.
- Jméno studenta v PDF: `student_identity` → `cleaned_name` → `student_name`.

---

## [v3.5.x] — 2026-03-26

- RBAC (Vyučující / Admin / SuperAdmin), `apply_data_isolation()`.

---

## [v3.4.x] — 2026-03-22

- `TabMonitor` (Statistiky), Excel export aktivity.
- Robustní DB migrace: "kobercový nálet" v `database.py`.

---

## [v3.3.x] — 2026-03-18

- Kompletní multi-tenant izolace: `lecturer_id` filtry, WebSocket izolace per lektor.
- `run_migrations()`: automatické ADD COLUMN IF NOT EXISTS při startu.

---

## [v3.2.x] — 2026-03-17

- vLLM integrace, `EvaluationQueue` se semaphore, paralelní batch processing.
- Dark mode redesign.

---

## [v2.x]

- Google Gemini podpora přes OpenAI-compatible rozhraní.
- Filtr AI chatu (`---` oddělovač).
