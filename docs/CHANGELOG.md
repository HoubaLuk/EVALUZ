# CHANGELOG - EVALUZ

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
