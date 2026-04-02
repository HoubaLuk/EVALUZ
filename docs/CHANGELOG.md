# CHANGELOG - EVALUZ

## [v3.6.0] - 2026-04-02
### Přidáno
- **Man-in-the-Loop schvalovací workflow:** Nový sloupec `is_approved` na `StudentEvaluation`. Lektor musí explicitně schválit hodnocení před zahrnutím do globální analýzy třídy. Nové schvalovací endpointy, vizuální odlišení stavů v UI (badge "K revizi" / "Schváleno"), zamčení vstupů pro schválená hodnocení.
- **PDF Protokol o hodnocení studijní skupiny — kompletní refaktoring:**
  - Titulek s modrým bannerem, 5-polní tabulková hlavička (vzdělávací zařízení, studijní skupina, modelová situace, vyučující, datum exportu)
  - Tabulka kritérií se zalamováním textu (`multi_cell`), police 5-stupňová barevná škála pro sloupec "Splnilo"
  - Pedagogické shrnutí plynule navazuje bez `add_page()`
  - Aktualizovaný text patičky
- **PDF individuálního studenta:** Sloupec "Splněno" zúžen o 30 %, sloupec "Kritérium" zobrazuje plný název bez zkrácení.
- **Excel export třídy:** Správné zobrazení třídy a modelové situace (frontend posílá hodnoty jako query params); opraven double-encoded JSON pro AI shrnutí; footer odstraněn z listů Výsledky a Analýza.
- **Dynamická verze v hlavičce:** `Header.tsx` volá `GET /api/v1/version` z `backend/__version__.py`.
- **`_parse_json_field()` helper:** Bezpečné parsování double-encoded JSON TEXT sloupců v celém `pdf_generator.py`.

### Opraveno
- **Double-encoded JSON:** `json_result` a `content_json` uloženy jako TEXT (SQLite) — všechna místa v `pdf_generator.py`, `statistics.py` a `export.py` opravena.
- **Jméno studenta v PDF:** Prioritní řetězec `student_identity` → `cleaned_name` → `student_name` (dříve se zobrazoval název souboru).
- **Podpisová doložka:** Formát "Vyučující: kpt. Mgr. Jméno, Ph.D." bez `funkcni_zarazeni`.
- **Třída a modelová situace v PDF/Excel:** Hodnoty ze sidebar výběru frontendu předány jako query params → vždy aktuální i při zastaralých DB záznamech.
- **Definice kritéria v PDF:** `c.popis` odstraněn ze sloupce "Definice kritéria", zobrazuje se `c.nazev` (krátký název); `c.popis` očištěn od markdown před výstupem.
- **`__pycache__`:** Odstraněno z git trackování (bylo v `.gitignore`, ale stále sledováno).

## [v3.5.1] - 2026-03-28
### Přidáno
- **Man-in-the-Loop (základy):** Schvalovací workflow pro hodnocení ÚZ.

## [v3.4.2] - 2026-03-24
### Přidáno
- **Robustní DB migrace:** Implementován "kobercový nálet" (agresivní kontrola schématu) v `database.py`. Systém nyní při startu automaticky doplňuje všechny chybějící sloupce v tabulkách `lecturers`, `student_evaluations` a `class_analyses` (např. `is_admin`, `created_at`, `source_text`, `is_superadmin`).
- **Resilience:** Oprava kritických chyb `UndefinedColumn` v PostgreSQL po neúplných manuálních zásazích v produkční DB.

### Změněno
- **UI Layout:** Sjednocení maximální šířky všech hlavních karet (`TabCriteria`, `TabEvaluation`, `TabAnalytics`) na sjednocených 1500px pro plynulé přechody a více prostoru pro detaily hodnocení.
- **WebSocket:** Stabilizace spojení po opravě databázových profilů.

## [v3.4.1] - 2026-03-23

## [v3.4.0] - 2026-03-22
### Přidáno
- **Dashboard Statistik (TabMonitor):** Nová analytická karta pro Superadminy a Adminy s vizualizací Recharts.
- **Excel Export:** Možnost stažení strukturovaného .xlsx souboru se sešity (Základní přehled, Organizační články, Aktivita lektorů, Časová osa).
- **Backend API:** Endpoint `/api/statistics/dashboard` a `/api/statistics/export/excel`.
- **Databáze:** Nové sloupce `Lecturer.is_admin` a `StudentEvaluation.created_at`.
- **Migrace:** Skript `v3_4_0_migration.py` pro dotažení DB schématu.

### Změněno
- **UI Terminologie:** Přejmenování "Školní útvar/pracoviště" na "Organizační článek".
- **Hlavička:** Přidáno inteligentní tlačítko "Statistiky evaluací" / "Zpět k evaluacím".
- **Izolace Dat:** Vylepšené filtrování API požadavků podle `lecturer_id` a útvaru pro zvýšení bezpečnosti.
- **LLM Engine:** Zvýšení `vllm_max_tokens` na 16000 pro zamezení uříznutí JSONu u velkých dávkových evaluací.

---
