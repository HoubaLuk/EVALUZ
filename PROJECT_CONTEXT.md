# Projektový Kontext - Evaluátor ÚZ
**Verze: 3.7.2 | Poslední aktualizace: 2026-04-10**

## 📅 Aktuální Stav
Všechny hlavní moduly jsou dokončeny a otestovány. Systém je v produkčním provozu na ÚPVSP. Verze 3.7.0 uzavírá produkční stabilizaci — opraveny všechny známé chyby exportů, statistik a datového modelu.

## 1. Vize a Cíl
Automatizace vyhodnocování Úředních záznamů (ÚZ) na ÚPVSP. AI asistent pomáhá lektorům standardizovat hodnocení, přičemž lektor má vždy poslední slovo díky Man-in-the-Loop schvalovacímu workflow.

## 2. Architektura
- **Frontend:** React + Vite + TypeScript (Optimistické UI, sidebar-driven context).
- **Backend:** FastAPI (Python 3.13+) + Deterministické výpočetní jádro.
- **Databáze:** SQLite (lokální) / PostgreSQL (produkce) — Alembic migrace + `run_migrations()` kobercový nálet.
- **Exporty:** Excel (openpyxl) a PDF (fpdf2).
- **Produkce:** Docker (non-root user `evaluz`), nginx reverse proxy s CSP hlavičkami, `SecurityHeadersMiddleware`, slowapi rate limiting.

## 3. Implementované Moduly
- **Precizace:** Tvorba kritérií z PDF zadání (Sokratovský AI asistent).
- **Evaluace:** Hromadné AI vyhodnocování s Man-in-the-Loop schvalováním — badge "K revizi"/"Schváleno", zamčené vstupy, analytická gate. Re-evaluace automaticky zruší schválení.
- **Analýza třídy:** Dashboard s grafy (Chart.js), police 5-stupňová škála, PDF Protokol o hodnocení skupiny, Excel export — třída a modelová situace ukládány do DB i předávány z frontendu.
- **Monitor (TabMonitor):** Statistiky využití pro Adminy a Superadminy, Excel export aktivity. Filtry: datum, vzdělávací zařízení (superadmin), třída, modelová situace.
- **ProfileModal:** Samostatná komponenta profilu (osobní údaje, doložka, změna hesla, exporty). Dostupná z user dropdownu v záhlaví — oddělena od AdminModal.

## 4. Autentizace & RBAC
- **Registrace:** `POST /auth/register` — veřejný, role vždy `vyučující`, hardcoded `is_admin=False`, `is_superadmin=False`. Rate-limit 5/min.
- **Povýšení role:** Výhradně SuperAdmin přes AdminModal → Správa uživatelů (`verify_superadmin()` guard na backendu). Nelze ani přes registraci, ani přes profil.
- **Přihlášení:** `POST /auth/login` (OAuth2 password flow), rate-limit 10/min.
- **Správa uživatelů v UI:** Skryta za `profile.is_superadmin` — Admin (is_admin) ji nevidí.

## 5. UI/UX
- **Záhlaví:** Jednotná barva `$header-bg: #003057` (námořnická modrá) pro oba pruhy. Nová proměnná v `_colors.scss` — nedotýká se primárních tlačítek (`$primary-color: #0f527d`).
- **ProfileModal:** Otevírá se přes `setIsProfileOpen` prop v `Header.tsx`. Obsahuje 2 záložky: "Osobní údaje a doložka" + "Změna hesla". AdminModal již profil neobsahuje.
- **Administrace:** Tlačítko v navigaci viditelné pouze pro `isAdminUser` (is_admin || is_superadmin).

## 5. Klíčové technické detaily
- **JSON parsing:** `content_json` / `json_result` mohou být dict nebo string (SQLAlchemy JSON type) — vždy ošetřeno `isinstance(raw, dict)`.
- **Identita studenta:** Prioritní řetězec `student_identity` JSON → `cleaned_name` → `student_name`.
- **scenario_display_name:** Ukládá se do DB (`StudentEvaluation.scenario_display_name`) při fast-scan i batch evaluaci. Export PDF/Excel čte z DB jako fallback, query param má prioritu.
- **Auth pro exporty:** Všechny export endpointy volané přes `fetch()` s Authorization header používají `get_current_lecturer`. Pouze `<a href>` anchor exporty by používaly `get_current_lecturer_export`.
- **Souběžnost LLM:** `LLM_CONCURRENCY_OPENROUTER` (výchozí 2) a `LLM_CONCURRENCY_VLLM` (výchozí 8) — nastavitelné v Administraci.
- **Verze:** `backend/__version__.py` → `GET /api/v1/version` → `Header.tsx` dynamicky.
