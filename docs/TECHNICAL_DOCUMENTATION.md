# Komplexní# Technická dokumentace EVALUZ
**Verze:** 3.1.1 (Air-Gap Robust)
**Poslední aktualizace:** 6. března 2026

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
3. Požadavek na evaluaci je zařazen do asynchronní fronty (`EvaluationQueue`).
4. AI evaluátor analyzuje text oproti kritériím a vrací strukturovaný JSON.
5. Výsledky jsou uloženy v DB a real-time odeslány na frontend přes WebSockets.

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
- `evaluation_criteria`: Definice metodik pro jednotlivé modelové situace.
- `student_evaluations`: Výsledky AI a manuálních korekcí. Obsahuje `json_result` s detaily o každém splněném bodu.
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

### v3.0.0 (Aktuální) - Humanizace codebase
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
*Poslední aktualizace dokumentace: 2026-03-05*
