# ARCHITECTURE - EVALUZ

## Datový Model
- **Lecturer:** Příznaky `is_superadmin`, `is_admin`. Vazba `school_location` určuje organ. článek. Atributy hodnosti: `rank_shortcut`, `rank_full`, `title_before`, `title_after`.
- **StudentEvaluation:** Ukládá vyhodnocení ÚZ. Klíčové sloupce: `scenario_name` (ID), `scenario_display_name` (čitelný název od v3.7.0), `json_result` (JSONType dict), `is_approved`, `student_identity` (JSONType), `cleaned_name`, `source_text`, `created_at`.
- **ClassAnalysis:** Globální analýza třídy. `content_json` je JSONType — vždy `isinstance(raw, dict)` před `json.loads()`. Sloupce `computed_at` a `version` pro cache invalidaci.

## Analýza & Monitoring
1.  **TabAnalytics (Třída):** Detailní pedagogický pohled na konkrétní třídu/scénář. Generuje `ClassAnalysis` s AI vhledem. Analytická gate: analytika dostupná až po schválení všech hodnocení.
2.  **TabMonitor (Organizační):** Celkový přehled využití AI pro management útvaru. Dostupné pouze Adminům/SuperAdminům.

## Exporty
- **PDF student:** `/export/evaluation/{id}/pdf` — spolehlivý export podle ID záznamu.
- **PDF třída:** `/export/class-report/{scenario_id}` — přijímá `class_name` a `scenario_display_name` jako query params (priorita) nebo čte z DB / markdown fallback.
- **Excel třída:** `/export/class/{class_id}/excel` — `class_name` a `scenario_display_name` zapisovány do buněk B2 a B3.
- **Auth pro fetch() exporty:** Vždy `get_current_lecturer` (Authorization header). `get_current_lecturer_export` pouze pro `<a href>` anchor downloads.

## Autentizace exportů — pravidlo
| Způsob volání | Dependency | Token předáván |
|---|---|---|
| `fetch()` s `Authorization` header | `get_current_lecturer` | v hlavičce |
| `<a href="...?token=...">` | `get_current_lecturer_export` | v URL query param |

## Řízení Přístupu (RBAC) & Izolace Dat [v3.5.0+]
- **Role:** `Vyučující`, `Admin`, `SuperAdmin`.
- **Zabezpečení:** Middleware `verify_superadmin` chrání citlivé systémové operace (prompty, vLLM settings).
- **Izolace:** Helper `apply_data_isolation` vynucuje filtraci dotazů na úrovni DB. Standardní uživatel (Vyučující) nikdy nevidí data z jiných `lecturer_id`. Administrátor vidí data v rámci `school_location`.

## LLM Robustnost
- **Sanitizer:** Vlastní regex cleaning pro extract JSONu i z modelů s vnitřním uvažováním (Qwen, DeepSeek).
- **vLLM Integration:** Přímé napojení na OpenAI-compatible API s dynamickým managementem tokenů a parametrů v DB.

## Klientská Synchronizace
- **HDD Sync:** Využívá `File System Access API`. 
- **Bezpečnost:** Vyžaduje tzv. **Secure Context** (HTTPS nebo localhost). Na běžném HTTP je funkce prohlížečem blokována.

