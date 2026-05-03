# CHANGELOG - EVALUZ

## [v3.9.6] - 2026-05-03

### Fáze A — Most k novému modelu (z hloubkové revize 3. 5. 2026)

Diagnostika z testovacích logů 29. 4. 2026 ukázala, že FIX A v3.9.5 paradoxně zhoršila UX u multi-person ÚZ a u scénářů s person-specific kritérii: Kořař/Kubisz dostali 4–6/25 splněných kritérií, zatímco zbytek byl placeholder. Skutečnou příčinou nebyla halucinace modelu, ale **interakce mezi způsobem psaní kritérií + chunkingem + příliš striktní exact-match validací**.

#### Přidáno

- **Kanonizační match v `_validate_and_fix_vysledky()`** (`backend/services/llm_engine.py`): Místo exact match na string nyní porovnává **kanonickou** podobu názvu — nová helper funkce `_canonicalize_criterion_name()` aplikuje:
  1. Strip prefixu `**N. Kritérium:` (LLM někdy zkopíruje formát z promptu).
  2. Strip trailing markdown bold `**`.
  3. Strip person-specific suffixu `– Jméno Příjmení` (heuristika kotvená na konec stringu, neporušuje popisné pomlčky uprostřed jako `– minimálně jméno, příjmení, datum narození`).
  4. Lower-case + trim.
  
  **Důsledek:** Když LLM vrátí "Ztotožnění osoby – Ivana Horáková" a expected je "Ztotožnění osoby", oba se kanonizují na `ztotožnění osoby` → match. Položka zachována, `nazev` v UI normalizován na expected, původní LLM verze se ukládá do `_llm_actual_name` (audit/diagnostika).

- **Multi-person duplikát detection**: Pokud model aplikoval stejné kritérium víckrát (jednou pro každou osobu v ÚZ), v `_validate_and_fix_vysledky()` se ponechá pouze první výskyt; další duplikáty jsou logovány jako `ℹ Multi-person duplikáty`. To řeší případ Kořař/Kubisz, kde model vracel "Ztotožnění – Kadlec" a "Ztotožnění – Horáková" jako 2 položky pro 1 expected.

- **Unikátní oddělovač kritérií `#############`** (`backend/services/llm_engine.py`, `backend/services/criteria_service.py`, `backend/api/evaluate.py`): Mezi jednotlivá kritéria v promptu vkládán řetězec `#############`. Modelu dává jasný signál "tady je další kritérium", což snižuje pravděpodobnost halucinace nebo splývání kritérií. Konstanta `CRITERIA_DELIMITER` v `llm_engine.py`.
  - `_split_criteria_chunks()` má nyní **dvě cesty**: primárně `text.split(delimiter)` (od v3.9.6), legacy regex lookahead na `**N. Kritérium` jako fallback pro zpětnou kompatibilitu se staršími daty.
  - `parse_criteria_markdown()` v `criteria_service.py` synchronizována — pokud markdown obsahuje delimiter, použije ho přímo; jinak legacy regex.
  - Phase 2 prompt rozšířen o explicitní instrukci: "Jednotlivá kritéria jsou oddělena řetězcem `#############`. Vrať PRÁVĚ N položek. Každé kritérium hodnotíš JEN JEDNOU, i když se v textu ÚZ vyskytuje více osob — kritéria se týkají hlavního subjektu zákroku, ne vedlejších osob. Do `nazev` zkopíruj DOSLOVA název z hlavičky bez přidávání jmen osob."

- **Pytest regression suite** (`backend/tests/`, fáze B z plánu): Vytvořena minimální test infrastruktura (`pytest.ini`, `conftest.py`, `requirements-dev.txt`). Soubor `test_llm_pipeline.py` obsahuje **36 testů** pokrývajících:
  - Kanonizační logiku (strip prefix, person suffix, popisné pomlčky)
  - Validaci a doplňování placeholderů
  - Multi-person duplikát detection
  - Sanitizér (regress na v3.9.1 quotes, v3.9.5 lone backslash, control chars)
  - `_repair_truncated_json` (regress na v3.7.8)
  - `_split_criteria_chunks` (delimiter primární + legacy fallback)
  - `_merge_chunk_results` (`_json_repaired` propagace, regress na v3.9.5)
  - `parse_criteria_markdown` (delimiter + legacy)
  - Integrační test reprodukující reálný case Kořař z 29. 4. 2026

  Spuštění: `cd backend && pip install -r requirements-dev.txt && pytest tests/ -v`. Test suite je nutná infrastruktura pro budoucí refactor v rámci fáze C (radikální zjednodušení s reasoning modelem).

#### Změněno

- **fontTools log noise potlačen**: `backend/core/logging_config.py` nyní nastavuje `logging.getLogger("fontTools").setLevel(logging.WARNING)` (a podlogy `fontTools.subset`, `fontTools.ttLib`). Při PDF exportu se v Docker logs už neobjevují stovky řádků o subset glyphů — pouze skutečné problémy s fonty (WARNING+).

#### Out of scope (zadokumentováno pro pozdější fáze)

Fáze C (radikální zjednodušení s reasoning modelem qwen3.5) **nebyla** v této verzi součástí — bude provedena, jakmile bude nový model k dispozici. Plán: smazat chunking infrastrukturu (~250 řádků), `_repair_truncated_json` (~150 řádků), zjednodušit FIX A na safety net. Cílem je `evaluate_report` ~100 řádků, `llm_engine.py` < 700 řádků (vs. dnešních 992).

Detailní strategický plán je v `~/.claude/plans/compressed-frolicking-dijkstra.md`.

---

## [v3.9.5] - 2026-04-29

### Přidáno

- **FIX B — Logování syrového LLM výstupu při JSON parse erroru (`llm_engine.py`):** Při každém selhání `json.loads()` (jak v `_evaluate_chunk`, tak v přímé cestě `evaluate_report`) se syrový obsah LLM odpovědi automaticky uloží do souboru v `/app/logs/llm_parse_errors/`. Soubor obsahuje typ chyby, pozici chybného znaku s kontextem (±50 znaků) a kompletní raw output. V Docker deploymentu je adresář namountován jako persistentní volume (`./logs/llm_parse_errors:/app/logs/llm_parse_errors`), takže dumpy přežijí restart kontejneru. Umožňuje post-mortem analýzu: bez vzorků nebylo možné určit, jaký konkrétní znak/sekvence JSON rozbila (viz logy Pavelec/Kořar 29. 4. 2026).

- **FIX A — Validace shody LLM výstupu s vstupními kritérii (`llm_engine.py`):** Po úspěšném parsování JSON odpovědi (všemi fallbacky) proběhne validace pole `vysledky` oproti `expected_criteria_names` — seznamu názvů kritérií z DB předaných do promptu. Halucinovaná kritéria (LLM vrátil název, který nebyl v promptu) jsou odfiltrována. Chybějící kritéria (LLM je vynechal) jsou doplněna jako placeholdery: `splneno=false`, `body=0`, `oduvodneni="⚠ Kritérium nebylo v odpovědi LLM..."`, `_llm_omitted=true`. Celkové skóre je po validaci přepočítáno. Řeší zdokumentovanou anomálii (1 kritérium v promptu → 19+ položek v odpovědi u některých studentů).

- **FIX C — Detekce a varování při partial recovery (`llm_engine.py`, `evaluate.py`, `src/`):** Když po FIX A validaci existují placeholder položky (`_llm_omitted=true`), je do `json_result` vložen klíč `_partial_recovery` se statistikami (`expected`, `recovered`, `lost`, `reason`). Tento klíč je persistován v DB jako součást `json_result` (JSONB, bez migrace). Frontend (`TabEvaluation.tsx`, `types.ts`) čte `_partial_recovery` při načítání studentů a zobrazuje: (1) oranžový badge `⚠ X/N` v levém seznamu studentů s tooltipem, (2) varující panel přímo v oblasti hodnocení ("Hodnocení je neúplné — LLM nebo parser ztratil X z N kritérií. Doporučujeme spustit re-evaluaci."). Záznamy opravené `_repair_truncated_json` jsou označeny `_json_repaired=true` a vyústí v `reason="json_repair"`.

- **FIX D — Vylepšená sanitizace edge cases (`llm_engine.py`):** `_sanitize_json_string_values()` rozšířena o dvě kategorie problémových znaků: (1) **Osamocené zpětné lomítko** — pokud `\` nenásleduje validní JSON escape znak (`"\\/bfnrtu`), je escapováno na `\\`; dříve zůstalo jako lone backslash a rozbilo JSON strukturu. (2) **Kontrolní znaky (0x00–0x1F)** — znaky nižší než `0x20` jiné než `\n`, `\r`, `\t` jsou nyní escapovány na `\uXXXX`; dříve procházely do výstupu a způsobovaly parse error. Oba případy se vyskytují u specifických typů ÚZ (fragmenty z Wordu, embedded objekty).

### Technické změny

- `backend/services/llm_engine.py`: přidány pomocné funkce `_validate_and_fix_vysledky()`, `_check_partial_recovery()`, `_dump_raw_llm_output()`; rozšířen podpis `evaluate_report()` o parametr `expected_criteria_names`; `_merge_chunk_results()` propaguje příznak `_json_repaired`; sanitizer rozšířen o lone backslash a control chars.
- `backend/api/evaluate.py`: `evaluate_batch` sestavuje `expected_criteria_names` z `individual_criteria` a předává je přes task dict do `process_single_file_bg` → `evaluate_report`.
- `docker-compose.yml`: přidán volume mount `./logs/llm_parse_errors:/app/logs/llm_parse_errors` pro backend.
- `src/types.ts`: rozšířen `CriterionResult` o `_llm_omitted?: boolean`; rozšířen `Student` o `partial_recovery`.
- `src/components/TabEvaluation.tsx`: mapování `partial_recovery` v `fetchEvaluations`; badge v seznamu studentů; varující panel v detailu.

---

## [v3.9.4] - 2026-04-29

### Opraveno

- **Tlačítko "Přejít nahoru" po hodnocení nefungovalo (`TabEvaluation.tsx`):** Tlačítko ↑ (vedle Schválit hodnocení) scrollovalo pravý panel s tabulkou hodnocení (`evalDetailScrollRef`), namísto levého panelu se seznamem studentů. Záměr tlačítka je přejít na začátek seznamu studentů pro výběr dalšího hodnoceného. Přidán nový `studentListScrollRef` na div se seznamem studentů; button nyní scrolluje správný element.

- **Záložka Analýza třídy nezobrazila aktuální data po přepnutí záložky (`TabAnalytics.tsx`, `App.tsx`):** Po schválení hodnocení v záložce Vyhodnocování a přepnutí na Analýza třídy se stále zobrazovala hláška o neschválených záznamech. Příčina: `TabAnalytics` je vždy namountovaná (display: none/block), `useEffect` s prázdným dependency array se spustí pouze jednou při mountu. Přidán prop `isActive: boolean` a nový `useEffect([isActive])` — při přepnutí na záložku se data automaticky přenačtou z backendu.

- **Refresh prohlížeče vracel na základní obrazovku (`App.tsx`):** SPA nemělo URL routing → `activeTab` a `activeScenarioId` byly uloženy pouze v React state, který se při refresh zresetoval. Přidána persistence do URL search params (`?tab=...&scenario=...`): při startu aplikace se state inicializuje z URL, při každé změně se URL aktualizuje přes `window.history.replaceState`. Jako vedlejší efekt: student list se po refresh obnoví z DB (fast-scan záznamy s `source_text` jsou dostupné přes `/analytics/class/1`), studenty lze re-evaluovat bez opětovného uploadu souborů.

- **Statistiky — filter-options zobrazoval scénáře bez dokončených evaluací (`statistics.py`):** Dropdown scénářů v záložce Statistiky zobrazoval i scénáře, kde proběhl pouze fast-scan (0 dokončených evaluací). Přidán filtr `json_result IS NOT NULL` do `scenario_query` v endpointu `/statistics/filter-options` — shodný s filtrem v `/statistics/dashboard`. Dashboard počítal správně (filtr přidán v v3.9.3), nyní je konzistentní i dropdown.

---

## [v3.9.3] - 2026-04-28

> **Poznámka:** Toto je poslední verze před zásadním přepracováním fáze precizace kritérií (Phase 1).
> Plánovaný přechod na model s kontextovým oknem 256k tokenů (Qwen3.5 nebo ekvivalent) umožní
> kompletní redesign Sokratovského dialogu bez omezení délky konverzace.

### Opraveno
- **Statistiky — filtr nevyhodnocených záznamů (`statistics.py`):** Endpoint `/statistics/dashboard` nyní počítá pouze záznamy s dokončeným výsledkem (`json_result IS NOT NULL`). Fast-scan vytváří DB záznam okamžitě (pro real-time UX), ale `json_result` je `NULL` dokud LLM nedokončí evaluaci — tyto "prázdné" záznamy se dříve chybně započítávaly do celkového počtu hodnocení a do agregací skóre.

- **Scroll v panelu Hodnotící kritéria (`TabCriteria.tsx`):** Po AI odpovědi v chatu volá `scrollIntoView` na konci chatu, čímž přesune scroll-context prohlížeče na levý panel. Textarea pro kritéria (pravý panel) pak nereagovala na mousewheel, protože neměla explicitní `overflow-y`. Přidáno `overflowY: 'auto'` na textarea element — prohlížeč nyní správně přiřadí wheel event bez ohledu na focus context.

- **Re-evaluace neschválených záznamů (`TabEvaluation.tsx`):** Tlačítko Vyhodnotit bylo disabled pro všechny záznamy ve stavu `evaluated`, včetně neschválených. Lektor tak nemohl znovu vyhodnotit studenta po změně kritérií bez předchozího schválení. Nová logika `canEvaluate`: re-evaluace je povolena pro neschválené záznamy (`is_approved=false`), zakázána pro schválené (`is_approved=true`) a probíhající evaluace (`evaluating`). Backend re-evaluaci již dříve podporoval (přepisuje `json_result`), frontend nyní toto chování odemkne.

---

## [v3.9.2] - 2026-04-24

### Opraveno
- **`_sanitize_json_string_values()` — opravena chyba look-aheadu při chybějící čárce:** Předchozí implementace nezachytila případ, kdy string hodnota končí `"` a hned za ní (bez oddělující čárky) následuje začátek dalšího JSON klíče — tedy vzor `"value""key":`. Scanner nerozpoznal `"` jako konec stringu (protože `"` není v `JSON_STRUCTURAL`) a pokračoval konzumovat i klíč jako součást hodnoty → výsledek byl znehodnocen.

  Oprava: při detekci `"` → whitespace → `"` scanner dál zkoumá, zda jde o vzor `"key":` (uzavírací uvozovka klíče + `:`) → pokud ano, ukončí aktuální string. Tím je správně ošetřen případ chybějící čárky mezi key-value páry.

- **`_repair_truncated_json()` — sanitizace na úrovni jednotlivých bloků:** Při selhání `json.loads(block)` pro dílčí `{...}` blok se nyní provede druhý pokus s `_sanitize_json_string_values(block)`. Dříve se poškozené bloky tichce zahazovaly, čímž docházelo ke ztrátě kritérií i po úspěšném strukturálním parsování.

  Výsledek: Kubisz chunk 2 (a podobné případy) by měly dosáhnout 6/6 namísto 4/6.

---

## [v3.9.1] - 2026-04-24

### Opraveno
- **`_sanitize_json_string_values()` — sanitizace neescapovaných znaků v JSON citacích:** Nová funkce vložena do parse pipeline jako druhý pokus po selhání `json.loads()` (před strukturální opravou `_repair_truncated_json`). Řeší deterministickou chybu `Expecting ',' delimiter`, která nastane, když model zkopíruje větu z ÚZ obsahující uvozovky (např. `"Řekl: "Vstaňte!""`) nebo literální odřádkování do pole `citace` bez escapování — JSON parser ukončí string na první vnitřní uvozovce a pak narazí na text místo `,`.

  Algoritmus: scanner znak po znaku detekuje string hodnoty; uvnitř stringu každé `"` testuje look-aheadem — pokud za ním (přes whitespace) následuje JSON strukturální znak (`{[]},:`) → legitimní konec stringu; jinak → interní uvozovka → escapovat na `\"`. Literální `\n`, `\r`, `\t` uvnitř stringů jsou také escapovány.

  Výsledek: 3-úrovňový fallback: přímý parse → sanitizace + parse → strukturální oprava. Log: `JSON opraven sanitizací ✓`.

---

## [v3.9.0] - 2026-04-23

### Přidáno
- **Automatický upgrade promptů při startu (`PROMPT_VERSION`):** `seeder.py` nyní sleduje verzi promptů v `AppSettings` (klíč `PROMPT_VERSION`). Při každém startu porovná uloženou verzi s aktuální — pokud je starší, přepíše všechny výchozí prompty na nové hodnoty. Administrátor nemusí prompty měnit ručně při upgrade. Vlastní úpravy promptu v Admin UI jsou přepsány upgradovým seedem (záměrné — nová verze = nový výchozí stav).

### Změněno
- **`DEFAULT_PROMPT_PHASE2` — zásadní přepis pro qwen3-30b-instruct (non-reasoning):**
  Nový prompt explicitně instruuje model krok-za-krokem pro každé kritérium: (1) přečti popis, (2) prohledej text ÚZ, (3) napiš odůvodnění 1–2 věty, (4) binárně rozhodni, (5) přesná citace nebo "Chybí". Pole `oduvodneni` slouží jako chain-of-thought kotva — model nejdříve verbalizuje hledání, pak rozhodne. Nová pravidla zdůrazňují, že v pochybnostech = false a citace musí být doslova (ne parafráze).
- **`DEFAULT_PROMPT_FEEDBACK` — vazba na konkrétní kritéria:**
  Doplněna instrukce jmenovat nedostatky NÁZVEM nesplněného kritéria (ne obecným popisem). Přidán explicitní limit 120 slov — qwen3 instruct respektuje číselné limity spolehlivěji než "3–5 vět".
- **`DEFAULT_PROMPT_PHASE3` — délkový limit a explicitní sekce:**
  Nová instrukce: 200–350 slov celkem, každá sekce 2–4 věty. Sekce mají tučný název (`**Celkové zhodnocení:**` atd.) — zajišťuje konzistentní formátování výstupu bez ohledu na teplotu modelu.
- **`_evaluate_chunk` user_prompt — instrukce na začátek, explicitní počet:**
  JSON-only instrukce přesunuta na **začátek** user prompty (vyšší váha). Přidán řádek `"Vyhodnoť PRÁVĚ {n_criteria} kritérií — ne méně, ne více."` — snižuje pravděpodobnost vynechání kritéria. Výpočet `n_criteria` přesunut před sestavení promptu.

---

## [v3.8.7] - 2026-04-24

### Přidáno
- **Individuální zpětná vazba pro studenta — samostatné LLM volání po evaluaci:** Po sloučení výsledků chunků (`_merge_chunk_results`) se automaticky spouští `_generate_individual_feedback()`. Model dostane jméno studenta, celkové skóre a seznam splněných/nesplněných kritérií a vrátí 3–5 vět personalizovaného hodnocení. Výsledek se uloží do pole `zpetna_vazba` — lektor ho vidí v detailu hodnocení a může ho před schválením upravit.
- **Admin prompt "Fáze 2b: Individuální zpětná vazba":** Nová záložka v Administraci promptů mezi Evaluací ÚZ a Globální analýzou. `phase_name='prompt_feedback'`, temperature=0.5. SuperAdmin může upravit tón, délku i požadavky na obsah zpětné vazby.
- **Scroll-to-top tlačítko v detailu hodnocení:** Kulatá šipka ↑ vpravo od tlačítka "Vyhodnocení schváleno". Po schválení lektor klikne ↑ a panel se plynule scrolluje na začátek — může rovnou vybrat dalšího studenta ze seznamu.

### Změněno
- **`seeder.py`:** Přidán seed pro `prompt_feedback` s výchozím promptem (profesionální, přímý, motivující tón, vykání studentovi).
- **`_generate_individual_feedback()` je robustní:** Chyba při generování zpětné vazby nevyhodí výjimku — vrátí prázdný string, evaluace se uloží normálně. Log: `[feedback] Chyba při generování: ...`.

---

## [v3.8.6] - 2026-04-24

### Přidáno
- **Phase 3 analytics — filtrování kritérií pro AI prompt:** Do LLM promptu při generování třídní analýzy se nyní posílají pouze *problémová* kritéria: vždy top 5 nejhůře splněných + všechna kritéria pod konfigurovaným prahem úspěšnosti (default **80 %**). Kritéria nad prahem jsou vynechána — LLM se nesoustředí na to, co třída zvládá. Frontend stále dostává kompletní statistiky pro heatmapu a grafy.
- **Konfigurovatelný práh `ANALYTICS_THRESHOLD`:** Nový klíč v `AppSettings` (default `80`). Nastavitelný v Administraci — lektor si může práh upravit dle náročnosti konkrétní modelové situace. Výchozí 80 % reflektuje vysoký standard compliance policejního výcviku.
- **Diagnostický log filtrování:** `[ANALYTICS] Filtrování: threshold=80%, pod prahem=N, top5=5, do promptu=X/25 kritérií` — okamžitě viditelné v `docker logs evaluz_backend`.

### Změněno
- **`seeder.py`:** Přidán seed pro `ANALYTICS_THRESHOLD=80` — správné výchozí nastavení bez nutnosti ruční DB intervence.

---

## [v3.8.5] - 2026-04-24

### Opraveno
- **Token budget 350 → 500 tokenů/kritérium pro českou tokenizaci:** Původní odhad 350 tokenů/kritérium vycházel z anglické tokenizace (~2,5 zn/token). Česká diakritika tokenizuje hustěji (~1,5–1,7 zn/token). U dialogicky bohatých ÚZ (Jaroš: 5 170 znaků ≈ 3 040 tokenů) model narážel na limit 2 400 tokenů — vLLM JSON mode truncoval výstup uprostřed 4. kritéria a „záplatoval" JSON uzavíracími znaky → syntaktická chyba, repair zachránil jen 3/6 kritérií (22/25). Nový budget: 6 × 500 + 300 = **3 300 tokenů/chunk**.

---

## [v3.8.4] - 2026-04-23

### Opraveno
- **Retry chunku při neúplném JSON výsledku:** Pokud `_evaluate_chunk` vrátí méně kritérií než chunk obsahuje (recovered < n_criteria), automaticky provede druhý pokus s `temperature=0.3` (místo 0.1). Vyšší teplota generuje jiné tokeny a vyhne se opakování stejné JSON chyby. Vybírá se výsledek s vyšším počtem kritérií — retry selhání neshazuje chunk, ponechává původní parciálku. Log: `neúplný výsledek: 1/6 → RETRY s temperature=0.3` / `retry úspěšný: 6/6`.
- **`chat_completion` (Phase 3) — overflow retry:** Funkce pro generování třídní analýzy volala `client.chat.completions.create()` přímo bez wrapperu — při prompt_tokens + max_tokens > 16 384 dostávala HTTP 400 a house UI zobrazovalo „Nepodařilo se spojit s asistentem pro generování analýzy". Nahrazeno `_llm_call_with_overflow_retry()` — wrapper zachytí 400 a automaticky sníží max_tokens na co se vejde do context window.

---

## [v3.8.3] - 2026-04-23

### Změněno
- **chunk_size 8 → 6:** Menší chunky (6 kritérií místo 8) snižují délku JSON výstupu per chunk a zvyšují spolehlivost parsování. 25 kritérií → 5 chunků (6+6+6+6+1), 3 studenti → 15 paralelních requestů na vLLM.

### Přidáno
- **WebSocket self-healing v `TabEvaluation.tsx`:** Nový `useEffect` detekuje stav kdy `isEvaluating=true`, ale žádný student nemá `status='evaluating'`. Automaticky resetuje UI bez nutnosti manuálního refreshe. Ochrana proti ztrátě `EVAL_SUCCESS` WebSocket zprávy při reconnectu.

---

## [v3.8.2] - 2026-04-22

### Přidáno
- **Robustní chunking kritérií — regex lookahead split:** `_split_criteria_chunks()` přešla z dělení na `---` separátoru na regex lookahead `\n+(?=\*\*\d+\.\s*Kritérium)`. Každý blok je garantovaně jedno kritérium bez ohledu na přítomnost `---`, mezer nebo nekonzistentního formátování. Fallback na původní blank-line split pokud regex nenajde žádnou hlavičku.
- **Adaptivní `max_tokens` per chunk:** `chunk_max_tokens = min(global_max, n_criteria * 350 + 300)`. Zabraňuje přemrštěnému výstupu u menších chunků (chunk s 1 kritériem = 650 tokenů místo 6 144).
- **`_repair_truncated_json()`:** Záchranná funkce scanující raw output pro kompletní `{}` bloky i při JSON parse erroru — zachrání kritéria z oříznuté odpovědi.
- **`_llm_call_with_overflow_retry()`:** Wrapper pro LLM volání zachytávající HTTP 400 (context overflow) a automaticky snižující `max_tokens` na `context_window - prompt_tokens - 100`.
- **Dynamická verze v záhlaví:** `Header.tsx` volá `GET /api/v1/version` z `backend/__version__.py` — eliminuje nesoulad zobrazené verze s kódem.

---

## [v3.7.7] - 2026-04-13

### Opraveno
- **Špatný výchozí `VLLM_API_URL = "http://localhost:8000/v1"`:** Default v `config.py` ukazoval na port FastAPI backendu samotného — každé LLM volání (evaluace, fast-scan identity) se posílalo na sebe a vracelo 404. Výchozí hodnota změněna na `""` (prázdný string); správné URL je nutné nastavit v Administraci nebo přes `.env`. Přidán komentář s příklady (`https://openrouter.ai/api/v1`, `http://localhost:8001/v1`).
- **`POST /admin/test-llm` vracel 500 bez informace o příčině:**
  - Synchronní `openai.OpenAI` blokoval async event loop — přepnuto na `AsyncOpenAI`.
  - Přidány specifické handlery pro `AuthenticationError` (401), `NotFoundError` (404), `RateLimitError` (429).
  - Chyba se nyní loguje přes `logger.error(..., exc_info=True)` — viditelná v server logu.
  - Odstraněny automatické retry (`max_retries=0`) pro test endpoint — test musí být rychlý a deterministický.
  - Přidána validace prázdného URL před pokusem o připojení (vrátí 400 místo 500).

## [v3.7.6] - 2026-04-10

### Opraveno
- **Migrace `f1e2d3c4b5a6` — `DatatypeMismatch` při `computed_at = created_at`:** Sloupec `created_at` v tabulce `class_analyses` je uložen jako `VARCHAR` (migrace `35e3a28e8797` ho nepřevedla na TIMESTAMP). Přidán explicitní cast `created_at::TIMESTAMP` + guard `created_at ~ '^\d{4}-\d{2}-\d{2}'` aby se přeskočily prázdné/nevalidní hodnoty.

## [v3.7.5] - 2026-04-10

### Architektura — zásadní změna spuštění migrací
- **Migrace přesunuty z `lifespan()` do `Dockerfile CMD`:** Alembic migrace nyní běží jako separátní krok *před* startem uvicorn workerů: `alembic upgrade head && exec uvicorn ...`. Jeden proces, jedno spuštění, žádná race condition.
- **Odstraněno volání `run_alembic_migrations()` z `lifespan()`:** PostgreSQL workery se při startu migrací vůbec nedotýkají — mohou startovat paralelně bez koordinace. SQLite dev prostředí nadále používá `init_db()`.
- **Odstraněna potřeba advisory locku pro koordinaci workerů:** pg_advisory_lock v `database.py` zůstává jako utility funkce, ale není volána při startu aplikace. Architektonicky správné řešení eliminuje problém u kořene místo symptomatické opravy.
- **Důsledek:** Pokud `alembic upgrade head` selže, kontejner se zastaví s nenulovým exit kódem a workery se vůbec nespustí — chyba je okamžitě viditelná v `docker logs evaluz_backend`, žádný crash loop.

## [v3.7.4] - 2026-04-10

### Opraveno
- **500 na `/analytics/class/{id}/summary`:** Chybějící sloupce `class_analyses.computed_at` a `class_analyses.version` způsobovaly `UndefinedColumn` při každém dotazu na analytiku. Příčina: migrace `53fae6cde19e` byla přeskočena přes `alembic stamp head` (PostgreSQL transactional DDL rollback při prvním selhání).
- **Chybné parsování starých záznamů (`Error parsing json for evaluation X`):** Záznamy uložené před migrací na JSONB měly `json_result` a `student_identity` jako JSON string (TEXT). `dict(string)` → `dictionary update sequence element #0 has length 1`; Pydantic `identita: dict` → `Input should be a valid dictionary`. Přidána defensivní deserializace přes `json.loads()` s try/except před předáním do Pydantic.

### Přidáno
- **Nová Alembic migrace `f1e2d3c4b5a6` — `ensure_schema_integrity`:** Idempotentní záchranná migrace (IF NOT EXISTS pro každý sloupec), která zajistí přítomnost sloupců `computed_at`, `version`, `scenario_display_name` a `is_approved` bez ohledu na historii předchozích nasazení. Bezpečná pro opakované spuštění.

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
