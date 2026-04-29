# Technická dokumentace EVALUZ
**Verze:** 3.9.4 (URL state persistence, analytics refresh, scroll-to-top, statistics filter-options)
**Poslední aktualizace:** 29. dubna 2026

## Obsah
1. [Přehled systému](#přehled-systému)
2. [Technologický zásobník](#technologický-zásobník)
3. [Architektura a datový tok](#architektura-a-datový-tok)
4. [AI Strategie (Fáze 1-3)](#ai-strategie-fáze-1-3)
5. [Databázové schéma](#databázové-schéma)
6. [Air-Gap & Intranet Readiness](#air-gap--intranet-readiness)
7. [Changelog](#changelog)

---

Tento dokument slouží jako centrální technický manuál a historický záznam projektu EVALUZ. Obsahuje detaily o architektuře, implementaci klíčových modulů, databázovém schématu a historii vývoje.

---

## 🏗 1. Architektura systému

EVALUZ využívá dekomponovanou architekturu oddělující prezentační vrstvu (Frontend) od procesní vrstvy (Backend) s důrazem na asynchronní zpracování náročných úloh (AI evaluace).

### 1.1 Technologie (Tech Stack)
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS (minimalisticky) / Vanilla CSS.
- **Backend**: FastAPI (Python 3.10+), SQLAlchemy (ORM).
- **Databáze**: 
    - **PostgreSQL 17** (Produkční/Hlavní): Robustní správa dat, podpora transakcí a cizích klíčů.
    - **SQLite** (Migrační/Vývojová): Původní úložiště, nyní slouží jako fallback nebo pro rychlé dev testy.
- **AI Integrace**: Rozhraní kompatibilní s OpenAI (vLLM, Google AI Studio, OpenRouter).

### 1.2 Tok dat (Data Flow)
1. Lektor nahraje ÚZ (PDF/DOCX/RTF).
2. Backend extrahuje text a pomocí AI/Regexu identifikuje identitu studenta.
3. Požadavek na evaluaci je zařazen do asynchronní fronty (`EvaluationQueue`), která je striktně izolována podle `lecturer_id`.
4. AI evaluátor analyzuje text oproti kritériím a vrací strukturovaný JSON.
5. Výsledky jsou uloženy v DB a real-time odeslány výhradně danému lektorovi přes WebSockets.

---

## 🤖 2. AI & Prompt Engineering

Aplikace využívá několikafázový přístup k ovládání LLM (Large Language Models) pro maximální přesnost.

### 2.1 Konfigurace modelů (v2.0.2+)
Systém umožňuje nastavit různé modely pro různé úkoly v Administraci:
- **Phase 1 (Precizace)**: Sokratovský asistent ladí kritéria s lektorem.
- **Phase 2 (Evaluace)**: Hodnocení ÚZ studenta. Klade důraz na přesné citace z textu.
- **Phase 2b (Individuální zpětná vazba)**: Samostatné LLM volání po sloučení výsledků chunkingem. Model vidí kompletní výsledek (všechna kritéria), generuje personalizovanou zpětnou vazbu pro studenta (3–5 vět, max. 600 tokenů). Prompt editovatelný v Admin UI (`prompt_feedback`).
- **Phase 3 (Analýza třídy)**: Pedagogický vhled do dat celé třídy. Filtruje kritéria před LLM promptem (top 5 nejhorších + pod `ANALYTICS_THRESHOLD`, výchozí 80 %).

### 2.2 Sokratovský AI Asistent
V komponentě `TabCriteria` je implementován asistent, který:
- Filtruje konverzaci od samotného návrhu kritérií pomocí oddělovače `---`.
- Klade doplňující otázky postupně po jedné (na základě instrukce v systémovém promptu).

### 2.3 LLM Robustnost (v3.8.x)

Série vylepšení zaváděných od v3.8.0 řeší spolehlivost AI evaluace u větších sad kritérií a obsáhlých ÚZ:

#### Chunking kritérií (v3.8.2)
Evaluace rozdělí kritéria na skupiny po 6 (`CHUNK_SIZE=6`) pomocí regex lookahead na `**N. Kritérium`. Chunky se zpracují paralelně přes `asyncio.gather()` — vLLM continuous batching zpracuje všechny requesty jako jednu GPU dávku. Výsledky se sloučí funkcí `_merge_chunk_results()`.

Výhoda: Zachování celého textu ÚZ v každém chunku, žádné ořezávání obsahu. 25 kritérií → 5 chunků zpracovaných prakticky současně.

#### Adaptivní token budget (v3.8.5)
`chunk_max_tokens = min(global_max, n_criteria × 500 + 300)`

Česká diakritika tokenizuje hustěji (~1,5–1,7 zn/token) než původně předpokládaných 2,5 zn/token. Původní hodnota 350 způsobovala truncation uprostřed výstupu — vLLM JSON mode přidával `"}]` na místě ořezu → parse error se jevil jako chyba obsahu. Hodnota 500 tokenů/kritérium eliminuje tento problém.

#### Retry mechanismus (v3.8.4)
Pokud chunk vrátí méně kritérií než bylo zadáno, automaticky se provede retry s `temperature=0.3`. Funguje pro sampling-based JSON chyby; deterministické truncation řeší token budget.

#### Context overflow retry (v3.8.4)
`_llm_call_with_overflow_retry()` zachytí HTTP 400 "context length exceeded", parsuje skutečné limity z chybové zprávy a opakuje volání s redukovaným `max_tokens`. Chrání Phase 3 analytiku (velké prompty) i obecné použití.

#### JSON recovery (v3.8.2)
`_repair_truncated_json()` dokáže z partially truncated JSON odpovědi extrahovat kompletní záznamy `{}` (sleduje hloubku závorek) a sestavit validní výsledek. Zpráva informuje lektora o počtu obnovených kritérií.

---

## 💾 3. Databázová vrstva

### 3.1 Migrace na PostgreSQL 17
V milníku 2.0.0 proběhl přechod ze SQLite na PostgreSQL. Klíčové body:
- **Skript `backend/scripts/migrate_to_postgres.py`**: Zajišťuje bezpečný přenos všech dat.
- **Integrita**: Jsou vynuceny cizí klíče (`Lecturer` -> `Class` -> `Evaluation`).

### 3.2 Klíčové tabulky
- `lecturers`: Správa identit lektorů a SuperAdminů (včetně `must_change_password`, `rank_shortcut`, `rank_full`, `funkcni_zarazeni`).
- `evaluation_criteria`: Definice metodik pro jednotlivé modelové situace, filtrováno podle `lecturer_id`.
- `student_evaluations`: Výsledky AI a manuálních korekcí. Klíčové sloupce: `json_result` (JSONType), `scenario_name` (ID scénáře), `scenario_display_name` (čitelný název, ukládán od v3.7.0), `is_approved`, `student_identity` (JSONType), `cleaned_name`, `source_text`.
- `class_analyses`: Globální (výkonové) statistiky třídy, izolované podle `lecturer_id` a `class_id`. `content_json` je JSONType (ne string) — vždy ošetřit `isinstance(raw, dict)` před `json.loads()`.
- `app_settings`: Dynamická konfigurace systému (LLM URL, Klíče, Modely, `LLM_CONCURRENCY_OPENROUTER`, `LLM_CONCURRENCY_VLLM`).

### 3.3 Migrační strategie
- **SQLite (dev):** `init_db()` + `run_migrations()` — "kobercový nálet" přidává chybějící sloupce při každém startu.
- **PostgreSQL (prod):** `run_alembic_migrations()` — `alembic upgrade head`. Záložní `run_migrations()` se volá v případě selhání Alembic.
- **Nové sloupce** musí být přidány na TŘECH místech: `db_models.py`, `database.py` (SQLite + PostgreSQL větve v `run_migrations()`), a nová Alembic migrace v `alembic/versions/`.

### 3.4 Pravidla pro JSON sloupce
`json_result` a `content_json` jsou deklarovány jako `JSONType` (custom type). SQLAlchemy vrací Python dict/list přímo bez nutnosti `json.loads()`. Při čtení vždy:
```python
raw = record.content_json
data = raw if isinstance(raw, dict) else json.loads(raw)
```

---

## 🏗 6. Air-Gap & Intranet Readiness

Pro zajištění stability v uzavřených sítích (intranet) bez přístupu k internetu a HTTPS, dodržuje EVALUZ tyto principy:

### 6.1 Databázová autonomie
- **Assertive Initialization:** Backend nečeká na externí migrační skripty pro základní data. Při každém zápisu (Fast-Scan, Evaluation) aktivně kontroluje existenci výchozí třídy (`id=1`) a v případě potřeby ji založí "za běhu".
- **Cascading Integrity:** Všechny cizí klíče používají `ondelete="CASCADE"`, což zjednodušuje správu dat při promazávání testovacích běhů v produkci.

### 6.2 Unicode & Cross-Platform kompatibilita
- **NFC Normalizace:** Všechny názvy souborů a textové vstupy jsou na backendu i frontendovém WebSocketu normalizovány na **NFC**. Toto řeší konflikty mezi macOS (NFD) a Linux/Windows (NFC) servery, které dříve způsobovaly "zamrzání" indikátorů průběhu.

### 6.3 Environment-Aware UI
- **Secure Context Fallback:** Funkce vyžadující HTTPS (např. synchronizace s HDD přes `showDirectoryPicker`) jsou v nezabezpečeném prostředí detekovány a nepoužitelnost je uživateli srozumitelně vysvětlena varovným textem.
- **Tab Persistence:** UI využívá `display: hidden` místo odpojování komponent (unmount), čímž chrání rozpracovaná data (např. nahrané ÚZ) při navigaci mezi kartami v prohlížeči.

### 6.4 LLM Compatibility
- **Flexible JSON Format:** Pro lokální providery (LM Studio, Ollama) je parametr `response_format: json_object` nastaven jako volitelný. Aplikace spoléhá na vylepšené regex čištění odpovědí, které odstraňuje "thought" bloky modelů před samotným parsováním JSON.

---

## 🕒 7. Historie vývoje (Changelog)

### v3.9.4 (Aktuální) - URL state persistence, analytics refresh, scroll-to-top, statistics filter-options

- **URL state persistence** (`App.tsx`): `activeTab` a `activeScenarioId` jsou inicializovány z URL search params (`?tab=...&scenario=...`) a při každé změně synchronizovány zpět přes `window.history.replaceState`. SPA tak přežije browser refresh — uživatel zůstane na stejné záložce a scénáři. Vedlejší efekt: po refresh se student list obnoví z DB (fast-scan záznamy mají uložený `source_text`, `fetchEvaluations()` je načte jako `pending`, re-evaluace funguje bez opětovného uploadu souborů). Auto-select logika opravena — pokud URL obsahuje platný `scenarioId`, `classId` se odvodí z dat místo přepsání výchozím prvním scénářem.

- **Analytics refresh při přepnutí záložky** (`TabAnalytics.tsx`, `App.tsx`): Přidán prop `isActive: boolean` a `useEffect([isActive])` — `fetchAnalytics()` se spustí při každém přepnutí na záložku Analýza třídy. Řeší Man-in-the-Loop scénář: schválení proběhne v záložce Vyhodnocování, ale `TabAnalytics` zůstane namountovaná (`display: none`), `useEffect([])` by se nespustil znovu → stale hláška "neschválené záznamy" bez page refresh.

- **Tlačítko ↑ "Přejít nahoru"** (`TabEvaluation.tsx`): Přidán `studentListScrollRef` na div se seznamem studentů (levý panel). Tlačítko ↑ nyní scrolluje levý panel — umožňuje výběr dalšího studenta bez nutnosti ručního scrollování. Dříve scrollovalo tabulku hodnocení (pravý panel), což uživatel nepozoroval.

- **Statistics filter-options — scénáře bez evaluací** (`statistics.py`): Filtr `json_result IS NOT NULL` přidán do `scenario_query` v `/statistics/filter-options`. Scénáře, kde proběhl jen fast-scan (0 dokončených evaluací), se nyní nezobrazují v dropdownu. Dashboard endpoint byl opraven v v3.9.3 — dropdown je nyní konzistentní.

### v3.9.3 - Bugfixy: statistiky, scroll, re-evaluace

> ⚠️ **Toto je poslední verze před zásadním přepracováním fáze precizace kritérií (Phase 1).**
> Plánovaný přechod na LLM s kontextovým oknem 256k tokenů (Qwen3.5 nebo ekvivalent) umožní
> kompletní redesign Sokratovského dialogu — bez omezení délky konverzace a bez rizika truncation
> výstupu kritérií při dlouhých sezeních. Tuto migraci zahájit až po potvrzení modelu.

- **Statistiky — filtr `json_result IS NOT NULL`** (`statistics.py`): Endpoint `/statistics/dashboard` nyní ignoruje záznamy bez výsledku evaluace. Fast-scan vytváří DB řádek okamžitě pro UX, ale `json_result` je `NULL` než LLM skončí — tyto záznamy se dříve chybně projevovaly v počtech a agregacích.
- **Scroll v panelu Hodnotící kritéria** (`TabCriteria.tsx`): Přidáno `overflowY: 'auto'` na textarea. Dříve `scrollIntoView` na konci chatu přesouval scroll-context prohlížeče na levý panel a mousewheel nad pravým panelem nereagoval.
- **Re-evaluace neschválených záznamů** (`TabEvaluation.tsx`): `canEvaluate` nyní povoluje znovu vyhodnotit studenta pokud záznam existuje ale nebyl schválen lektorem (`is_approved=false`). Schválené záznamy (`is_approved=true`) zůstávají finální.

### v3.9.0–v3.9.2 - Prompt optimalizace pro qwen3-30b + JSON sanitizace

- **v3.9.0:** Optimalizace promptů pro qwen3-30b-instruct (non-reasoning): krok-za-krokem Phase 2, PROMPT_VERSION upgrade systém, explicitní počet kritérií v user promptu.
- **v3.9.1:** `_sanitize_json_string_values()` — oprava `Expecting ',' delimiter` při doslovné citaci přímé řeči (uvozovky uvnitř `citace`).
- **v3.9.2:** Oprava look-aheadu sanitizace (vzor `"value""key":` bez čárky) + per-block sanitizace v `_repair_truncated_json`.

### v3.8.7 - Individuální zpětná vazba + scroll-to-top + Admin prompt
- **Phase 2b:** Samostatná funkce `_generate_individual_feedback()` generuje personalizovanou zpětnou vazbu pro studenta po merge chunk výsledků. Fail-safe: chyba zpětné vazby neblokuje uložení evaluace.
- **Admin UI:** Nový záložkový panel "Fáze 2b: Individuální zpětná vazba" v AdminModal pro editaci promptu `prompt_feedback`.
- **UX:** Tlačítko ↑ (scroll-to-top) vedle "Vyhodnocení schváleno" — lektor se jedním klikem vrátí na seznam studentů.

### v3.8.6 - Phase 3 filtrování kritérií
- Kritéria s úspěšností nad `ANALYTICS_THRESHOLD` (výchozí 80 %) jsou filtrována z LLM promptu Phase 3; frontend heatmapa zobrazuje kompletní stats všech kritérií.
- Nový AppSettings klíč `ANALYTICS_THRESHOLD` konfigurovatelný v Admin UI.

### v3.8.5 - Token budget pro českou tokenizaci
- Navýšení z 350 → 500 tokenů/kritérium. Eliminuje JSON truncation u obsáhlých ÚZ s dialogem a právními citacemi.

### v3.8.4 - Retry + context overflow ochrana
- `_evaluate_chunk()`: retry s temperature=0.3 při neúplném výsledku.
- `_llm_call_with_overflow_retry()`: automatická redukce max_tokens při HTTP 400.

### v3.8.2–v3.8.3 - Chunking kritérií + JSON recovery
- `_split_criteria_chunks()`: regex lookahead split, CHUNK_SIZE=6, asyncio.gather parallelism.
- `_repair_truncated_json()`: recovery z partially truncated JSON výstupu.

### v3.7.0 - Export opravy + scenario_display_name + Statistics
- **Statistiky (TabMonitor):** Implementace nové analytické karty pro Superadminy a Adminy. Využití knihovny **Recharts** pro vizualizaci aktivity napříč organizačními články.
- **Excel Export:** Robustní generátor `.xlsx` souborů založený na `openpyxl`. Obsahuje sešity pro základní přehled, organizační články, aktivitu lektorů a časový monitoring.
- **Backend API:** Nový router `api/statistics.py` s filtrem podle rolí (`is_superadmin`, `is_admin`) a organizačních článků (`school_location`).
- **DB Schéma:** Přidány sloupce `Lecturer.is_admin` pro střední management a `StudentEvaluation.created_at` pro historický reporting.
- **UI/UX:** Sjednocení designu akčních tlačítek (modrá pro globální dashboard dle logiky Administrace).
- **Bezpečnost:** Dokumentace Secure Context (HTTPS/localhost) pro HDD Sync synchronizaci.

### v3.3.1 - Auto-Migration & WebSocket Fix
- **Fix:** Oprava kritické chyby `403 Forbidden` u WebSocketů. Frontend nyní správně posílá ID lektora v URL.
- **DB Migrace:** Implementována funkce `run_migrations` v jádru backendu. Databáze se nyní při startu aplikace sama zkontroluje a přidá chybějící sloupce, což usnadňuje nasazování nových verzí na server.
- **Robustnost:** Přidána granulární kontrola existence sloupců v tabulkách `class_analyses` (opraven chybějící `class_id`), `golden_examples` a `export_history` pro zamezení chyb `UndefinedColumn`.
- **Verzování:** Sjednocení všech verzí v systému (backend, frontend, package.json) na 3.3.1.

### v3.3.0 - Data Isolation & Multi-Instructor Support
- **Bezpečnost:** Kompletní izolace dat mezi lektory (Multi-Tenancy). Přidány filtry `lecturer_id` do všech dotazů na evaluace, analytiky a exporty.
- **Backend:** Rozdělení WebSocket fronty (`EvaluationQueue`) – notifikace o průběhu vyhodnocování jsou nyní doručovány pouze lektorovi, který úlohu spustil.
- **Databáze:** Rozšíření schématu `ClassAnalysis` a `GoldenExample` o `lecturer_id`. Odstraněn globálně unikátní index na `scenario_id` v tabulce analýz.
- **Logika:** Automatická instance personalizované výchozí třídy ("Základní kurz") pro každého lektora zvlášť (nahrazení globální `id=1`).

### v3.2.5 - Parallel Processing & Dark Mode Overhaul
- **Performance:** Oprava paralelního vyhodnocování (Batch Processing) – odstraněn redundantní zámek v backendu, který způsoboval sekvenční zpracování i při volné kapacitě GPU. Nyní plné využití paralelity L40S.
- **UI/UX:** Kompletní vizuální redesign **Dark Mode** pro maximální čitelnost. Nahrazení tmavě modrých textů vysoce kontrastní zlatou/žlutou (`#facc15`) a bílou barvou.
- **UI/UX:** Zpřehlednění ovládacích prvků (tlačítka pro nahrávání, stepper, výběr studentů) pomocí nového barevného schématu.
- **Versioning:** Verze aplikace v záhlaví je nyní plně dynamická a čerpá se přímo z `package.json`.
- **Toast:** Zkrácena a zpřesněna hláška po dokončení hromadného vyhodnocení.

### v3.2.4 - UI & Export Stability
- **Oprava:** Odstraněno "zasekávání" tlačítka hromadného vyhodnocení po úspěšném dokončení dávky.
- **UI:** Zvětšen prostor pro editaci kritérií v kartě "Precizace kritérií" tak, aby využíval plnou výšku okna.
- **UI:** Přejmenováno pole zpětné vazby na "Zpětná vazba lektora" a navýšena jeho výška pro lepší čitelnost delších textů.
- **Export PDF:** Oprava chyby fontů při generování tloušťkové analýzy třídy (nyní robustní i v Docker prostředí).
- **Export Excel:** Průměrné skóre nyní exportováno jako číslo (zarovnání vpravo) pro čistší profesionální výstup.

### v3.2.3 - L40S Hardware Optimization

### v3.2.2 - vLLM Batching & Parallel Processing
- **Výkon:** Implementace paralelního vyhodnocování ve frontě (`EvaluationQueue`) s nastavitelnou souběžností (výchozí 4).
- **vLLM Integration:** Výrazně vyšší propustnost při hromadném zpracování ÚZ díky využití vLLM batchingu.
- **Fix:** Oprava zasekávání fronty při chybě jednoho studenta (lepší error handling v `_run_task` s využitím Semaphore).
- **Stabilita:** Doporučení pro Qwen modely (vypnutí "Enable Thinking" ve Fázi 2 pro úsporu tokenů při malém kontextovém okně 16k).

### v3.2.1 - LLM Parameter Enforcement
- **Cíl:** Odstranění chyb spojených s limity kontextového okna (Error 400) a respektování nastavení v administraci.
- **Změny:**
  - **Backend**: Respektování hodnoty `Max Output Tokens` (z databáze) v `llm_engine.py` namísto natvrdo zakódovaných 16k.
  - **Backend**: Oprava `NameError` u proměnné `max_tokens` při volání vLLM ve fázi 2.
  - **Backend**: Odstranění duplicitních klíčů v parametrech pro OpenAI client.
  - **Stability**: Zajištění plynulého vyhodnocování i u delších ÚZ na limitovaných vLLM serverech (v rámci 16k okna).

### v3.2.0 - Robust vLLM Integration
- **Cíl:** Odstranění kritických chyb při integraci s vLLM a zlepšení uživatelské zpětné vazby.
- **Změny:**
  - **Backend**: Oprava `NameError` u parametrů `top_p`, `presence_penalty` a `frequency_penalty` v `llm_engine.py`.
  - **Backend**: Korektní dotazování na LLM nastavení z DB pro všechny typy AI úloh.
  - **Frontend**: Implementace error trackingu v dávkovém vyhodnocování (`TabEvaluation`).
  - **Frontend**: Inteligentní toast notifikace rozlišující čistý úspěch od částečného selhání.
  - **Fix**: Oprava chyby, kdy se nově nahraní studenti neukládali při selhání Fast-Scanu.

### v3.1.1 - Humanizace codebase
- **Cíl:** Maximální srozumitelnost kódu pro člověka.
- **Změny:**
  - Kompletní revize komentářů v celém backendu (services, api, core).
  - Přidání vysvětlujících českých dokumentačních bloků do klíčových frontendových komponent (`TabEvaluation`, `TabCriteria`).
  - Podrobný popis asynchronní fronty a AI integrační logiky přímo v kódu.

### v2.0.2 - Update "Google Gemini & UI Filter"
- **AI:** Podpora pro Google AI Studio (Gemini 1.5 Pro/Flash) přes OpenAI kompatibilní rozhraní.
- **UI:** Filtrace AI chatu – do pole kritérií se propisují pouze definovaná kritéria (za oddělovačem `---`), nikoliv celá konverzace.

---

## 🛡 5. Produkční nasazení a bezpečnost

### 5.1 Zabezpečení
- **JWT Autentizace**: Každý požadavek na API (kromě login) vyžaduje platný Bearer Token.
- **Environment Variables**: Citlivé údaje (API klíče, DB hesla) jsou v `backend/.env`. Tento soubor se NIKDY nesmí nahrávat do Gitu.

### 5.2 Správa uživatelů
Pouze uživatel s příznakem `is_superadmin = true` může vytvářet nové lektory a spravovat globální nastavení LLM.

---
*Poslední aktualizace dokumentace: 23. dubna 2026*
