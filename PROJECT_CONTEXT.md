# Projektový Kontext - Evaluátor ÚZ
**Verze: 3.6.0 | Poslední aktualizace: 2026-04-02**

## 📅 Aktuální Stav
Všechny hlavní moduly jsou dokončeny a otestovány. Systém je v produkčním provozu na ÚPVSP.

## 1. Vize a Cíl
Automatizace vyhodnocování Úředních záznamů (ÚZ) na ÚPVSP. AI asistent pomáhá lektorům standardizovat hodnocení, přičemž lektor má vždy poslední slovo díky Man-in-the-Loop schvalovacímu workflow.

## 2. Architektura
- **Frontend:** React + Vite + TypeScript (Optimistické UI, sidebar-driven context).
- **Backend:** FastAPI (Python) + Deterministické výpočetní jádro.
- **Databáze:** SQLite (lokální) / PostgreSQL (produkce) — alembic migrace.
- **Exporty:** Excel (openpyxl) a PDF (fpdf2).

## 3. Implementované Moduly
- **Precizace:** Tvorba kritérií z PDF zadání (Sokratovský AI asistent).
- **Evaluace:** Hromadné AI vyhodnocování s Man-in-the-Loop schvalováním — badge "K revizi"/"Schváleno", zamčené vstupy, analytická gate.
- **Analýza třídy:** Dashboard s grafy, police 5-stupňová škála, PDF Protokol o hodnocení skupiny, Excel export — třída a modelová situace předávány z frontendu.
- **Monitor (TabMonitor):** Statistiky využití pro Adminy a Superadminy, Excel export aktivity.

## 4. Klíčové technické detaily
- **JSON parsing:** Všechny `json_result` / `content_json` TEXT sloupce jsou parsovány přes `_parse_json_field()` (safe double-decode).
- **Identita studenta:** Prioritní řetězec `student_identity` JSON → `cleaned_name` → `student_name`.
- **PDF/Excel context:** Frontend posílá `class_name` + `scenario_display_name` jako query params — nezávislé na stáří DB záznamů.
- **Verze:** `backend/__version__.py` → `GET /api/v1/version` → `Header.tsx` dynamicky.
