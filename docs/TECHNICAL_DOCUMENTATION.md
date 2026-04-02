# Technická dokumentace EVALUZ
**Verze:** 3.6.0 (Man-in-the-Loop + PDF/Excel Professional Refactor)
**Poslední aktualizace:** 2. dubna 2026

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
- **Phase 1 (Precizace)**: Ladění kritérií s lektorem. Podpora Sokratovského dotazování.
- **Phase 2 (Evaluace)**: Samotné hodnocení textu studenta. Klade důraz na přesné citace.
- **Phase 3 (Analýza)**: Pedagogický vhled do dat celé třídy.

### 2.2 Sokratovský AI Asistent
V komponentě `TabCriteria` je implementován asistent, který:
- Filtruje konverzaci od samotného návrhu kritérií pomocí oddělovače `---`.
- Klade doplňující otázky postupně po jedné (na základě instrukce v systémovém promptu).

---

## 💾 3. Databázová vrstva

### 3.1 Migrace na PostgreSQL 17
V milníku 2.0.0 proběhl přechod ze SQLite na PostgreSQL. Klíčové body:
- **Skript `backend/scripts/migrate_to_postgres.py`**: Zajišťuje bezpečný přenos všech dat.
- **Integrita**: Jsou vynuceny cizí klíče (`Lecturer` -> `Class` -> `Evaluation`).

### 3.2 Klíčové tabulky
- `lecturers`: Správa identit lektorů a SuperAdminů (včetně `must_change_password`).
- `evaluation_criteria`: Definice metodik pro jednotlivé modelové situace, filtrováno podle `lecturer_id`.
- `student_evaluations`: Výsledky AI a manuálních korekcí. Obsahuje `json_result` s detaily o každém splněném bodu a `lecturer_id`.
- `class_analyses`: Globální (výkonové) statistiky třídy, izolované podle `lecturer_id` a `class_id`.
- `app_settings`: Dynamická konfigurace systému (LLM URL, Klíče, Modely).

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

### v3.4.1 (Aktuální) - Statistics Dashboard & Excel Export
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
*Poslední aktualizace dokumentace: 18. března 2026*
