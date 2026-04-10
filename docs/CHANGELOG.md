# CHANGELOG - EVALUZ

## [v3.7.3] - 2026-04-10

### Opraveno
- **Crash loop při startu s více uvicorn workery (`--workers N`):** Každý worker volal `run_alembic_migrations()` nezávisle při startu. Při první instalaci (nebo po `alembic stamp`) se všechny workery potkaly u DDL příkazů a PostgreSQL vyhodil `DuplicateTable` / `DuplicateColumn` → worker padal → crash loop.
  - **Řešení:** `run_alembic_migrations()` nyní používá PostgreSQL session-level advisory lock (`pg_advisory_lock`). První worker, který lock získá, spustí migrace. Ostatní workery čekají na uvolnění zámku, poté zkontrolují verzi DB — pokud je již na `head`, migrace přeskočí. Lock je vždy uvolněn v bloku `finally`, i při výjimce — nehrozí deadlock.
  - **Bezpečná detekce verze:** Po získání locku se před spuštěním migrací zkontroluje aktuální revize DB přes `MigrationContext` — migrace se spustí jen pokud DB ještě není na aktuálním `head`.

## [v3.7.2] - 2026-04-10

### Přidáno
- **Samoregistrace nového uživatele:** Nový veřejný endpoint `POST /api/v1/auth/register` — vytvoří účet s rolí `vyučující` (hardcoded, nikdy admin/superadmin). Validace hesla (min. 12 znaků, A, a, 1), kontrola duplicity e-mailu, rate-limit 5/min.
- **Registrační formulář na login obrazovce:** Link "Nemám účet — registrovat se jako Vyučující" zobrazuje formulář s polem pro jméno, příjmení, tituly, funkční zařazení, org. článek, e-mail a heslo. Info box jasně informuje, že povýšení role může provést pouze SuperAdmin.

### Opraveno
- **Šipka v role selectu (AdminModal — Správa uživatelů):** Inline styl `padding: '3px 6px'` přepisoval `padding-right: 32px` z CSS — šipka dropdownu nebyla viditelná. Opraveno na `padding: '3px 28px 3px 6px'`.

### Bezpečnost / RBAC
- **Role management** — potvrzeno: backend chrání všechny `/admin/users/*` endpointy pomocí `verify_superadmin()`. Změna role na Admin nebo SuperAdmin je možná výhradně pro SuperAdmina — jak v UI (sekce Správa uživatelů je za `profile.is_superadmin` guardem), tak na backendu (HTTP 403 pro nižší role).

## [v3.7.1] - 2026-04-10

### Přidáno
- **`ProfileModal.tsx` — samostatný profil uživatele:** Nová komponenta dostupná z dropdownu uživatele v záhlaví. Obsahuje: editaci osobních údajů (tituly, hodnosti, org. článek, funkční zařazení), živý náhled podpisové doložky, historii exportů a sekci **Změna hesla** (dříve zcela chyběla v UI). Volá `PUT /api/v1/auth/me` a `PUT /api/v1/auth/password`.
- **Filtry v TabMonitor:** Panel filtrů (datum od/do, vzdělávací zařízení, třída, modelová situace) nyní viditelný i při načítání — loading/error stav je inline pod filtry.

### Změněno
- **Záhlaví — jednotná barva:** Oba pruhy (`header-appbar` i `header-navbar`) nyní sdílejí jednu barvu pozadí `$header-bg: #003057` (námořnická modrá, dle vzoru CZ Anonymizer). Nová proměnná v `_colors.scss` — primární barva tlačítek a ostatních prvků zůstává `#0f527d`.
- **Záhlaví — světlejší text záložek:** Navigační záložky mají barvu `rgba(255,255,255,0.88)` (dříve 0.75) pro lepší čitelnost na tmavém pozadí.
- **Jméno uživatele v záhlaví:** `max-width` zvětšen z 160 px na 280 px — plné jméno s titulem a rolí se zobrazuje bez ořezu.
- **AdminModal — přejmenování:** Titulek změněn z "Administrace systému EVALUZ & Prompt Engineering" na "Administrace systému EVALUZ".
- **AdminModal — odstranění profilu ze sidebaru:** Sekce "Profil a podpisová doložka" přesunuta do samostatného `ProfileModal`. V AdminModal zůstává pouze správa systému (prompty, LLM, uživatelé).
- **Header — "Můj profil":** Tlačítko nyní otevírá přímo `ProfileModal` místo obcházení přes `AdminModal` + custom event `openProfileTab`.
- **Header — "Administrace":** Tlačítko se zobrazuje pouze správcům (`isAdminUser = is_admin || is_superadmin`). Běžný Vyučující ho nevidí.

### Opraveno
- **TabMonitor crash (prázdná obrazovka):** Chart data (`lineChartData`, `orgBarData`, `lecBarData`) se počítala při každém renderu i když `data === null` — způsobovalo pád celé stránky. Opraveno ternárním guardem `data ? {...} : null`. Přístup `data.org_unit` mimo ochrannou podmínku ošetřen wrappem `{data && ...}`.

## [v3.7.0] - 2026-04-09

### Přidáno
- **`scenario_display_name` v DB:** Nový sloupec `StudentEvaluation.scenario_display_name` — čitelný název scénáře (např. "MS2: Vstup do obydlí") se nyní ukládá do DB při každém fast-scan i vyhodnocení. Alembic migrace `a1b2c3d4e5f6` pro PostgreSQL produkci. Frontend posílá `scenario_display_name` jako Form param do `/evaluate/fast-scan` i `/evaluate/batch` (včetně Sidebar hromadného importu).
- **Statistiky — filter-options + dashboard:** Endpoint `/api/v1/statistics/dashboard` a `/api/v1/statistics/filter-options` plně funkční.
- **Rozdělenou souběžnost LLM:** Admin nastavení `LLM_CONCURRENCY_OPENROUTER` (výchozí 2, Rate-limit) a `LLM_CONCURRENCY_VLLM` (výchozí 8, Batch) — konfigurace zobrazena ve 2-sloupcovém gridu v `AdminModal`.

### Opraveno
- **PDF export třídy (422 → 200):** Endpoint `/export/class-report/{scenario_id}` používal `get_current_lecturer_export` (URL query token) místo `get_current_lecturer` (Authorization header). Frontend volá přes `fetch()` s hlavičkou — opraveno.
- **PDF export třídy (500 — dict):** `content_json` v `ClassAnalysis` je ukládán jako dict (SQLAlchemy JSON type), ne string — `json.loads(dict)` způsobovalo `TypeError`. Ošetřeno `isinstance(raw, dict)`.
- **PDF export třídy (500 — scenario_display_name):** Fallback dotaz v `export.py` se odkazoval na `StudentEvaluation.scenario_display_name` který neexistoval v DB modelu — odstraněno, nahrazeno DB fallbackem přes nový sloupec.
- **Excel B2 (Třída) a B3 (Modelová situace):** Frontend nyní předává `class_name` a `scenario_display_name` jako query params do `/export/class/1/excel` — generátor je zapíše do správných buněk.
- **Statistiky (500 — datetime[:10]):** `created_at` je `datetime` objekt (ne string) — `eval_record.created_at[:10]` způsobovalo `TypeError: 'datetime.datetime' object is not subscriptable`. Opraveno na `ca.strftime('%Y-%m-%d')`.
- **Statistiky — date range filtr:** `start_date` / `end_date` jsou URL string parametry porovnávané s `DateTime` sloupcem — parsovány přes `datetime.fromisoformat()` s ošetřením výjimek.
- **Re-evaluace neresetovala schválení:** Při opakovaném vyhodnocení existujícího záznamu zůstal `is_approved = True` — přidáno `existing_eval.is_approved = False` při uložení nového `json_result`.
- **Student PDF — spolehlivý endpoint:** Tlačítka "Schválit a uložit PDF" a "Znovu uložit PDF" volala `/export/student/by-name/{name}/pdf` (náchylné na diakritiku) — přepnuto na `/export/evaluation/{id}/pdf`.
- **`datetime.utcnow()` deprecated:** Dva výskyty v `evaluate.py` nahrazeny `datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)`.
- **`scenario_display_name` neexistoval v ORM modelu:** Sloupec přidán do `StudentEvaluation` v `db_models.py` (migrace v `database.py` už existovala pro oba DB typy).

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
