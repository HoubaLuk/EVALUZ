# PLAN.md — Náprava RBAC Data Isolation (post-incident, v3.10.9 → v3.11.0)

Status: **HOTOVO (v3.11.0, commit `2378b5a`, 2026-07-01).** Fáze GREEN byla implementována přesně dle návrhu níže — `DataScope` Enum, fail-closed `PERSONAL` default, `statistics.py` explicitně žádá `LOCATION`/`GLOBAL`. `backend/tests/test_data_isolation.py` (3 testy) prochází. Viz ADR-014 v `docs/TECHNICAL_DOCUMENTATION.md` a `docs/CHANGELOG.md`.

## 1. Kontext incidentu (hard-won knowledge z forenzního auditu)

Dne 2026-06-30 došlo k prosáknutí dat mezi lektory (lecturer_id=3 viděla cizí scénáře
`scen-1`/`scen-2` a evaluace patřící lecturer_id=1). Forenzní audit (viz vlákno auditu)
prokázal, že příčinou **není** chyba fronty (`EvaluationQueue`) ani chybějící volání
izolačního filtru — `apply_data_isolation()` je volána důsledně na všech relevantních
endpointech. Příčinou je **návrhová chyba samotné `apply_data_isolation()`**
(`backend/api/auth.py:104-122`):

```python
def apply_data_isolation(query, entity_class, current_user, db):
    if current_user.is_superadmin:
        return query                                   # ŽÁDNÝ filtr — celý systém
    if current_user.is_admin and current_user.school_location:
        lecturer_ids = [...]                            # všichni lektoři lokality
        return query.filter(entity_class.lecturer_id.in_(lecturer_ids))
    return query.filter(entity_class.lecturer_id == current_user.id)
```

Tato jediná funkce je použita jako univerzální brána jak pro **osobní pracovní plochu**
lektora (`GET /api/v1/analytics/class/{id}`, `GET /api/v1/analytics/class/{id}/summary`,
`GET /api/v1/analytics/class/{id}/status`, validace kritérií/`student_ids` v
`evaluate.py`), tak by měla sloužit pro **manažerský přehled**
(`GET /api/v1/statistics/*`). Nerozlišuje kontext volání podle role — jakmile má
uživatel `is_admin`/`is_superadmin`, KAŽDÝ dotaz přes tuto funkci (i ten z běžné
Evaluation obrazovky SPA) se tiše rozšíří na cizí data. Stejný vzor je duplikovaně
zaveden i v `backend/api/statistics.py:17-23` (`_get_allowed_lecturer_ids`).

Druhotný nález: `GET /api/v1/statistics/filter-options`
(`backend/api/statistics.py:26-78`) je jediné místo v backendu, které vrací **množinu**
`scenario_name` napříč lektory — a to bez zúžení na volajícího lektora. To je cesta,
kudy se cizí `scenario_id` (`scen-1`, `scen-2`) vůbec dostaly do frontendu, který je
pak dál použil k dotazům na `/analytics/` a `/criteria/`.

## 2. Architektonické rozhodnutí: Explicitní Data Scope

**Princip: fail-closed by default.** Rozsah viditelnosti dat už nesmí být odvozen
implicitně z role uživatele uvnitř sdílené funkce — musí ho **explicitně deklarovat
volající endpoint**, a výchozí hodnota musí být nejužší možná (`PERSONAL`).

```python
# backend/api/auth.py (návrh signatury — NEIMPLEMENTOVÁNO, fáze RED)

from enum import Enum

class DataScope(str, Enum):
    PERSONAL = "personal"   # výchozí — pouze current_user.id, bez ohledu na roli
    LOCATION = "location"   # pouze lektoři se stejnou school_location
    GLOBAL = "global"       # celý systém, bez omezení

def apply_data_isolation(
    query,
    entity_class,
    current_user: Lecturer,
    db: Session,
    scope: DataScope = DataScope.PERSONAL,   # <-- KLÍČOVÁ ZMĚNA: bezpečný default
):
    """
    PERSONAL (default): vždy jen entity_class.lecturer_id == current_user.id,
        BEZ VÝJIMKY pro Admin/Superadmin. "Vidím jen svoje" platí univerzálně
        pro osobní pracovní plochu.

    LOCATION: vyžaduje is_admin nebo is_superadmin (jinak 403). Vrací záznamy
        všech lektorů se stejnou school_location jako current_user.
        Smí volat POUZE explicitně manažerské endpointy.

    GLOBAL: vyžaduje is_superadmin (jinak 403). Vrací záznamy bez omezení.
        Smí volat POUZE explicitně manažerské/superadmin endpointy.
    """
```

### Mapování volajících (cíl fáze GREEN — zatím neprovedeno)

| Endpoint (soubor)                                                        | Dnešní chování                     | Nový `scope`                                                  |
|---------------------------------------------------------------------------|-------------------------------------|-----------------------------------------------------------------|
| `GET /analytics/class/{id}` (`analytics.py`)                              | role-dependentní (bug)              | `DataScope.PERSONAL` (bez parametru — default)                  |
| `GET /analytics/class/{id}/summary` (`services/analytics.py`)             | role-dependentní (bug)              | `DataScope.PERSONAL`                                             |
| `GET /analytics/class/{id}/status` (`analytics.py`)                       | role-dependentní (bug)              | `DataScope.PERSONAL`                                             |
| `PATCH/DELETE /analytics/evaluation/{id}/...` (`analytics.py`)            | role-dependentní (bug)              | `DataScope.PERSONAL`                                             |
| `POST /evaluate/batch` — validace kritérií a `student_ids` (`evaluate.py`)| role-dependentní (bug)              | `DataScope.PERSONAL`                                             |
| `GET /statistics/filter-options` (`statistics.py`)                        | LOCATION/GLOBAL dle role (správně)  | `DataScope.GLOBAL if is_superadmin else DataScope.LOCATION` (explicitně, s 403 guard) |
| `GET /statistics/dashboard` (`statistics.py`)                             | LOCATION/GLOBAL dle role (správně)  | stejně jako výše — ale nyní explicitně, ne implicitně z role uvnitř `apply_data_isolation` |
| `GET /statistics/export/excel` (`statistics.py`)                          | LOCATION/GLOBAL dle role (správně)  | stejně jako výše                                                 |

Klíčový bezpečnostní posun: **manažerské endpointy si o širší rozsah musí explicitně
"říct"** (a zůstávají samy zodpovědné za vlastní 403 kontrolu role — což už dnes dělají
na úrovni endpointu, viz `statistics.py:29-30`, `97-98`). Pokud endpoint `scope`
nespecifikuje, dostane vždy jen `PERSONAL` — i kdyby byl volán superadminem. Tím padá
celá třída chyb "zapomněl jsem, že tenhle endpoint prochází přes stejnou funkci jako
manažerský dashboard".

### Proč Enum a ne bool/flag
Bool (`is_manager_view: bool`) by se dal snadno nastavit `True` omylem nebo z
nesprávné dedukce role. Enum se 3 stavy nutí u každého volání explicitně napsat,
o jaký rozsah jde, a je snadno auditovatelný (grep `scope=DataScope.GLOBAL` najde
všechna riziková místa v jednom kroku).

## 3. Fáze RED — testy uzamykající chybový stav

Soubor: `backend/tests/test_data_isolation.py` (samostatné DB/TestClient fixtures,
nezávislé na sdíleném `tests/integration/conftest.py`, aby nedošlo k ovlivnění
existujících testů).

1. `test_admin_personal_endpoint_must_not_leak_colocated_lecturer_data` —
   replika Q1/Q3 auditu (Admin + `school_location` shoda).
2. `test_superadmin_personal_endpoint_must_not_leak_global_data` —
   replika Q1/Q3 auditu (Superadmin, zcela odlišná lokalita).
3. `test_filter_options_must_not_leak_other_lecturers_scenarios_in_personal_context` —
   replika Q4 auditu (`get_filter_options` vrací scénáře kolegy ze stejné lokality).

Všechny tři testy v této fázi **záměrně SPADNOU** proti současnému
`backend/api/auth.py` — to je očekávaný a žádoucí výsledek fáze RED. Teprve po
zavedení `scope` parametru (fáze GREEN) mají projít.

## 4. Co bude fáze GREEN (příště, po schválení)

1. Přidat `DataScope` Enum a parametr `scope` do `apply_data_isolation()` v `auth.py`.
2. Upravit všechna volání v `analytics.py`, `evaluate.py`, `services/analytics.py` —
   ponechat bez parametru (implicitní `PERSONAL`).
3. Upravit `statistics.py` — explicitně předat `scope=LOCATION`/`GLOBAL` a odstranit
   duplicitní `_get_allowed_lecturer_ids()` (nahradit centrální funkcí).
4. Spustit `backend/tests/test_data_isolation.py` → očekávat 100 % PASS.
5. Regresně spustit celou stávající testovací sadu (`pytest backend/tests`), aby
   zúžení výchozího rozsahu nerozbilo legitimní Admin/Superadmin funkčnost tam, kde
   byla zamýšlená (statistics dashboard).
