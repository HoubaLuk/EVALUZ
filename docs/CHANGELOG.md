# CHANGELOG — EVALUZ

---

## [v3.15.2] — 2026-09-04 — Míra jistoty u dílčího hodnocení

### Problém

Rozptyl modelu je pro lektora neviditelný: u každého kritéria vidí jeden verdikt s jedním sebejistě znějícím odůvodněním a nic neoznačuje, že šlo o hraniční případ. Manuální oprava je přitom pojistkou jen do té míry, do jaké si lektor problému všimne — napříč 25 kritérii × N studentů si tiše překlopeného kritéria nevšimne skoro nikdy. Produkční `prompt2` navíc rozlišuje tři stavy nesplnění, ale schéma má jen boolean `splneno`, takže se ta rozlišovací práce ztrácela.

### Pole `jistota` (ADR-029)

- **`backend/services/llm_engine.py`** — do schématu JSON v obou promptech (jednorázové volání i chunkovaná cesta) přidáno `"jistota": 1-5` se stručnou definicí škály: nižší hodnota tam, kde se splnění dovozuje z kontextu nebo záleží na právním výkladu; vyšší tam, kde je údaj uveden výslovně — a to i u nesplněných kritérií, protože zjevná absence je jednoznačná také.
- **`backend/services/llm_engine.py`** — `_normalize_jistota()` převádí odpověď na celé číslo 1–5 (zvládá `"4"`, `"4/5"`, hodnoty mimo škálu, `bool` odmítne). Chybějící hodnota se vědomě **nedoplňuje náhradním číslem** — vymyšlený odhad by v UI vypadal stejně jako skutečný. Placeholder za kritérium, které model vůbec nevrátil, dostává `jistota: 1`.
- **`backend/services/llm_engine.py`** — `WARNING` do logu, když model pole nevyplnil. Bez toho by tichá ignorace nového pole vypadala stejně jako „všechno je jednoznačné".
- **`src/types.ts`, `src/components/TabEvaluation.tsx`** — u hodnot ≤ 2 se zobrazí výstražná ikona s vysvětlením. Po zásahu vyučujícího se neukazuje — rozhodl člověk, odhad modelu je bezpředmětný.

**Hranice platnosti:** model tímhle reportuje své **tvrzení** o obtížnosti, ne skutečnou tokenovou nejistotu. Nízká jistota je vodítko, kam se podívat; vysoká **není** důkazem správnosti. Jistota neovlivňuje body ani skóre.

### Opraven zdvojený příznak zásahu vyučujícího

- **`backend/api/analytics.py`** — v3.15.0 zavedla vlastní příznak `_lecturer_modified`, přestože pro tentýž pojem už existoval `upraveno_lektorem`, který frontend nastavuje a vykresluje ikonou. Vznikl tak jeden fakt pod dvěma jmény. Sjednoceno na existující název, přičemž **autoritou je server**: klientovo tvrzení se nepřebírá a nepodložený příznak se zahazuje. Optimistické nastavení ve frontendu zůstává kvůli odezvě v UI, ale o uloženém stavu rozhoduje diff proti uložené verzi.

### Testy

- **`backend/tests/test_jistota.py`** (nový, 24 testů) — normalizace hodnot i nepoužitelných vstupů, `bool` neprojde jako 1, chybějící pole zůstane `None` místo dohadu, placeholder dostane nejnižší jistotu, logování chybějícího pole, a kontrola, že jistota neovlivňuje skóre.
- **`backend/tests/test_manual_override.py`** — 2 nové testy: příznak odvozuje server (nepodložené tvrzení klienta se zahodí) a přežije pozdější vrácení hodnoty zpět.
- Celkem 148 testů.

---

## [v3.15.1] — 2026-09-04 — Seeder už nepřepisuje prompty vytvořené správcem

### Problém

Při kontrole promptů vyšlo najevo, že `_upsert_prompt()` u existujícího řádku bezpodmínečně přepsal **obsah i teplotu** továrními hodnotami ze `seeder.py`. Spouštělo se to při startu backendu, kdykoli se konstanta `PROMPT_VERSION` v kódu lišila od hodnoty v `app_settings`. Mechanismus nerozlišoval prompt upravený správcem od nedotčeného a `system_prompts` nemá historii ani verzování — přepsaný text tedy nešlo obnovit. V UI se neobjevilo nic, jedinou stopou byl `print()` v logu.

Reálná sázka: produkční `prompt2` je rozsáhlý instruktážní text s deseti očíslovanými pravidly, který vznikl mimo repozitář. Zvýšení konstanty by ho nahradilo patnáctiřádkovým výchozím zněním. Po v3.15.0 by navíc reset zasáhl i teplotu, která už ovlivňuje chování hodnocení.

K přepsání zatím nedošlo — konstanta zůstala od svého zavedení na `"3.10"`. Šlo o nastraženou past, ne o incident.

### Prompty se doplňují, nikdy nepřepisují (ADR-028)

- **`backend/core/seeder.py`** — `_upsert_prompt()` nahrazeno `_ensure_prompt()`, které u existujícího řádku okamžitě vrací `False` a nesahá na něj. Prompty i teploty administrují správci v UI a texty vznikají mimo repozitář, takže tovární znění nemá co „vylepšovat".
- **`backend/core/seeder.py`** — konstanta `PROMPT_VERSION` a její záznam v `app_settings` odstraněny. Nepoužívaly se nikde jinde než v této bráně; bez přepisování šlo o mrtvý kód. (Osiřelý řádek `PROMPT_VERSION` v existujících databázích je neškodný a nemaže se.)
- **`backend/core/seeder.py`** — doplňování chybějících promptů běží nově při **každém** startu, ne jen při změně verze. Dřív se smazaný nebo nezaložený prompt sám neobnovil a příslušná fáze tiše běžela na nouzovém jednořádkovém textu z kódu.

### Testy

- **`backend/tests/test_seeder_prompts.py`** (nový, 8 testů) — upravený obsah i teplota přežijí opakované seedování, ochrana platí pro všechny čtyři fáze, chybějící prompt se obnoví a obnova jednoho nesmí sáhnout na ostatní. Dvojice testů míří přímo na `_ensure_prompt()`, protože opakované `seed_database()` samo o sobě starou chybu nereprodukuje — ta se spouštěla až změnou konstanty v kódu. Ověřeno dočasným vrácením původního chování: 5 z 8 testů selže.
- Celkem 122 testů.

### Dokumentace

- **`docs/TECHNICAL_DOCUMENTATION.md`** — ADR-028 včetně zdůvodnění, proč nebyla zvolena varianta s příznakem „upraveno správcem": riziko zvolené varianty je malé, protože **struktura JSON odpovědi je v kódu, ne v promptu**, takže budoucí změny schématu na obsahu `prompt2` nezávisí.

---

## [v3.15.0] — 2026-09-04 — Auditní stopa lektorského zásahu a determinismus statistiky

### Problém

Lektor nahlásil, že tatáž sada ÚZ vykázala na dvou strojích v kartě Analýza třídy různou procentuální úspěšnost u jednotlivých kritérií. Podrobná kontrola ukázala, že model u jednoho kritéria skutečně rozhodl v obou bězích jinak — statistika tedy počítala správně a nález sám o sobě chybou nebyl. Čtení kódu při té příležitosti ale odhalilo pět nezávislých vad, které tenhle incident nezpůsobily, a jednu z nich přímo v mechanismu manuální opravy lektorem, tedy v pojistce, na které stojí celý Man-in-the-Loop. Společné mají to, že tiše ztrácejí informaci nebo tiše lžou o číslech — nic z toho nevyhodí chybu ani se neobjeví v logu.

### Manuální zásah lektora už neničí data a nechává stopu (ADR-025)

- **`backend/api/analytics.py`** — `patch_evaluation_score` dosud přepsal celý `json_result` tím, co poslal klient. Frontend přitom staví nový objekt jen ze čtyř klíčů, takže se uložením ztratily `max_skore` a `identita`; frontend pak spadl na fallback výpočet maxima, chybný u kritérií za víc než 1 bod (vada odstraněná v v3.9.10, sem se vracela zadními vrátky). Nově se úprava **slučuje** a serverem vlastněné klíče se berou z uložené verze.
- **`backend/api/analytics.py`** — `celkove_skore` **přepočítává server** ze samotných verdiktů; klientem poslaná hodnota se ignoruje. Skóre je odvozená veličina, ne vstup.
- **`backend/api/analytics.py`, `backend/models/db_models.py`, `backend/core/database.py`, `backend/alembic/versions/c7d8e9f0a1b2_add_lecturer_audit_trail.py`** — nové sloupce `ai_original_json`, `modified_at`, `modified_by`. Původní hodnocení AI se uchová při **první** úpravě a další úpravy ho nepřepíšou. Změněná kritéria dostanou příznak `_lecturer_modified`. Migrace bez unique constraintů a bez mazání dat; existující záznamy mají ve všech třech sloupcích NULL, což pravdivě znamená „nebylo ručně upravováno".

### Analytika hlásí rozpor místo tichého 0 % (ADR-026)

- **`backend/services/analytics.py`** — statistika se počítá proti **aktuálním** kritériím, ale výsledky studentů jsou zamrzlé z doby vyhodnocení. Po přejmenování kritéria párování selhalo, `passes` nenaskočil, jmenovatel zůstal — a kritérium se zobrazilo jako 0% úspěšnost, k nerozeznání od legitimní nuly. Nový čítač `seen` obojí odliší a odpověď nese `criteria_mismatch` se dvěma seznamy: kritéria bez jediného výsledku a výsledky bez kritéria.
- **`src/components/TabAnalytics.tsx`** — varovný banner vypisuje obě strany rozporu jmenovitě. Výpočet **neblokuje**. Drobné rozšíření názvu zachytí stávající částečná shoda a varování se pro ně záměrně nespustí, aby si na něj lektor nezvykl.

### Deterministické pořadí kritérií a zapojení teploty fáze 2 (ADR-027)

- **`backend/services/analytics.py`** — v celém souboru dosud nebyl `order_by` ani jednou. `db_criteria` se načítalo bez `ORDER BY`, přičemž frontend popisuje sloupce v grafu **podle pozice** (`K${i + 1}`). PostgreSQL pořadí bez `ORDER BY` negarantuje a `save_criteria` dělá delete+insert — „K7" tak mohlo na dvou strojích označovat jiné kritérium. Doplněno `ORDER BY Criterion.id` (= pořadí z markdownu, které lektor vidí v editoru) i `ORDER BY id` u obou `.first()` dotazů.
- **`src/components/TabAnalytics.tsx`** — tooltip ukazuje `full_name` místo názvu useknutého na 20 znaků, který u dvojic kritérií lišících se jen jménem osoby vykresloval identický popisek.
- **`backend/services/llm_engine.py`, `backend/api/evaluate.py`** — teplota pro evaluaci ÚZ se v Administraci uložila, zobrazila zpět, a při vyhodnocování **ignorovala** (natvrdo `0.1` na obou volacích místech). Zbylé tři fáze ji z DB čtou správně. `evaluate_report` a `_evaluate_chunk` nově přebírají `temperature` z `prompt2`, protaženou frontou v `task_data`. **Hodnota se nemění** — 0,1 v seederu i jako fallback, takže chování zůstává beze změny; volba hodnoty je nadále na lektorovi v UI.

### Testy

- **`backend/tests/test_manual_override.py`** (nový, 8 testů) — zachování `max_skore`/`identita`, uložení a neměnnost `ai_original_json`, záznam kdo/kdy, příznak u změněného kritéria (a jeho absence u nezměněného), serverový přepočet skóre.
- **`backend/tests/test_analytics_determinism.py`** (nový, 6 testů) — skutečné přejmenování se ohlásí, kosmetická úprava ne, osiřelý výsledek se ohlásí, legitimní 0 % nevaruje, pořadí `stats` odpovídá sadě a je stabilní přes opakovaná volání.
- Celkem 114 testů.

### Dokumentace

- **`docs/TECHNICAL_DOCUMENTATION.md`** — nová tabulka, která fáze čte prompt a teplotu odkud (sekce 2.3), včetně upozornění, že struktura JSON odpovědi je natvrdo v kódu a přes UI do ní nelze přidat pole. Doplněn metodický pokyn k označování sporných posouzení v `prompt2`: podmínku formulovat jako vlastnost textu ÚZ, ne jako dotaz na jistotu modelu (introspekci model neumí, vrátí vyprávění o obtížnosti).
- **`docs/TECHNICAL_DOCUMENTATION.md`** — sekce 3.3 nově výslovně uvádí, že **Alembic migrace není volitelná**: v produkci se `run_migrations()` vůbec nespouští (`main.py` ho volá jen pro SQLite, na PostgreSQL běží `alembic upgrade head` v Dockerfile CMD), takže sloupec přidaný jen do modelu a `run_migrations()` v produkci nikdy nevznikne a aplikace spadne na `UndefinedColumn`. Při vývoji na SQLite se to neprojeví. Zároveň zdokumentováno, že Alembic řetěz je Postgres-only (migrace `a1b2c3d4e5f6` obsahuje `DO $$`), takže novou migraci nelze ověřit proti SQLite — je nutná dočasná instance PostgreSQL.
- **`docs/TECHNICAL_DOCUMENTATION.md`** — přehled příznaků v `json_result` (`_llm_omitted`, `_llm_actual_name`, `_lecturer_modified`) a popis chování `PATCH /analytics/evaluation/{id}/score` v toku dat.

### Otevřeno

Reprodukovatelnost vyhodnocení zůstává vědomým rozhodnutím, ne chybou: po zapojení ADR-027 lze teplotu nastavit v Administraci, ale `temperature=0` (greedy decoding) rozptyl jen sníží — continuous batching ve vLLM mění pořadí sčítání v pohyblivé řádové čárce, takže bitově shodné výsledky nezaručí ani ono.

---

## [v3.14.1] — 2026-09-01 — Viditelný pád nahrávání místo tiché ztráty

### Problém

Lektorka Ivona Palová nahlásila, že jí vyhodnocování nešlo spustit — EVALUZ hlásil holé „Failed to fetch" bez jakéhokoli vodítka. U Lukáše Hřibňáka a Lukáše Zvěřiny dávky ve stejnou dobu proběhly bez potíží. Z backend logu vyplynulo, že její požadavek na server vůbec nedorazil — ani řádek, ani chyba — což ukazuje na něco mezi jejím prohlížečem a backendem (velikost nahrávaného balíku vs. `client_max_body_size 15M` v nginxu, nebo síťová politika na jejím segmentu — je na jiné podsíti než oba fungující lektoři). Kořenová příčina na síťové/infrastrukturní úrovni tímto nasazením není prokázaná; oprava níže cílí na dvě samostatná zjištění z auditu kódu, která k nesrozumitelnosti chyby přispívala.

### Nahrávání souboru nad limit už nemizí beze stopy (ADR-024)

- **`backend/api/evaluate.py`** — `fast_scan_batch` soubor nad `MAX_UPLOAD_SIZE` (10 MB) dosud jen vypsal `print()` na stdout a vrátil `None` — student z odpovědi zmizel bez jakékoli zmínky, ať uplynul limit z jakéhokoli důvodu. Endpoint nově vrací i pole `skipped` se jmény nezpracovaných souborů; totéž platí pro soubor, u kterého scan spadne na výjimku (dřív `print`, nyní `logger.error(..., exc_info=True)`).
- **`src/components/TabEvaluation.tsx`** — když `skipped` není prázdné, optimisticky vykreslené řádky těchto studentů se odstraní a lektor dostane jmenovitý seznam, co se nenahrálo a proč to bývá (poškozený/naskenovaný PDF bez textové vrstvy).
- **`src/utils/api.ts`** — nové `MAX_FILE_BYTES` (10 MB, zrcadlí `MAX_UPLOAD_SIZE`) a `MAX_UPLOAD_BATCH_BYTES` (14 MB, pod nginx limitem) kontrolují velikost **před** odesláním, takže běžný případ nikdy nedorazí až k nginx limitu. `describeFetchError()` převádí `TypeError: Failed to fetch` (a příbuzné síťové chyby) na srozumitelnou českou větu místo prázdné anglické hlášky.
- **`src/components/TabEvaluation.tsx`** — fast-scan i dávkové vyhodnocení nově používají `describeFetchError()` v catch větvi; fast-scan navíc při `!res.ok` vyhodí chybu (dřív selhal potichu do `console.error`) a rollbackne optimistické řádky.

### Testy

- **`backend/tests/test_fast_scan_limits.py`** (nový, 3 testy) — soubor nad limit se objeví v `skipped`, klíč je v odpovědi vždy přítomný, `MAX_UPLOAD_SIZE` je synchronizováno s frontendovou konstantou `MAX_FILE_BYTES`.
- Celkem 100 testů.

### Otevřeno

Skutečná příčina „Failed to fetch" u Ivony Palové zůstává neprokázaná — vyžaduje z jejího prohlížeče (DevTools → Network) přesný `net::ERR_*` kód a velikost/počet nahrávaných souborů. Tahle oprava dělá selhání viditelným a odstraňuje jeden konkrétní tichý propad v kódu; neopravuje síťovou vrstvu, kterou EVALUZ sám neřídí.

---

## [v3.14.0] — 2026-08-12 — Viditelnost fronty a úplnost sady pro analytiku

### Problém

Po v3.13.1 dávky doběhly oběma lektorům, ale u dávky 5 ÚZ zůstal pátý zdánlivě nevyhodnocený a musel se spouštět znovu. Z logu plyne, že ztracený nebyl: při `concurrency=4/proces` se rozeběhly 4 úkoly a pátý čekal na volný slot — jakmile první doběhl (08:01:21), pátý se ve stejnou vteřinu rozeběhl sám. Čekal ~112 s, ale v UI vypadal stejně jako nezahájený. Souběžně vznikl požadavek, aby se globální analýza třídy nedala vygenerovat dřív, než jsou všechny ÚZ pod modelovou situací vyhodnocené a schválené.

### Fronta — čekající úkoly jsou vidět a jdou zrušit (ADR-022)

- **`backend/services/evaluation_queue.py`** — `worker()` rezervuje slot semaforu **před** `queue.get()`; slot přebírá vytvořený task a uvolní ho ve `finally`. Dřív si smyčka vytáhla všechny úkoly naráz a na semafor čekala až uvnitř tasku, takže fronta byla prázdná: čekající ÚZ nešel spočítat ani zrušit. „Zastavit" (`clear_queue`) proto neměl co rušit — a lektor, který mezitím dávku odeslal znovu, ji nechtěně vyhodnotil dvakrát.
- **`backend/services/evaluation_queue.py`** — `add_task()` odesílá novou WS událost `EVAL_QUEUED`. Její selhání je jen zalogováno, aby nikdy nezabránilo zařazení úkolu.
- **`src/types.ts`, `src/components/TabEvaluation.tsx`** — nový stav `'queued'` s odznakem „Ve frontě". Počítá se jako běžící (self-healing, preservation logic při pollingu, filtr výběru), takže polling už čekající ÚZ nepřepíše zpět na „Nezpracováno".

### Analytika jen z úplné a schválené sady (ADR-023)

- **`backend/services/analytics.py`** — brána dosud kontrolovala jen to, zda nejsou **vyhodnocené** záznamy neschválené; záznamy bez výsledku se z kontroly tiše vypadly a analýza se spočítala jen z části skupiny, aniž by to lektor poznal. Nově blokuje i na nevyhodnocené záznamy a vrací `unevaluated_count` a `total_records` vedle stávajícího `pending_count`. Klíč `error: "pending_approvals"` zůstal kvůli zpětné kompatibilitě.
- **`backend/services/analytics.py`** — deserializace odolná vůči `json_result` jako JSON stringu (starší TEXT záznamy). `.get()` na stringu dosud vyhodilo `AttributeError` a shodilo celou analytiku na HTTP 500.
- **`src/components/TabAnalytics.tsx`** — hláška rozlišuje „ještě není vyhodnoceno" od „čeká na schválení", ať lektor ví, co má udělat.

### Testy

- **`backend/tests/test_analytics_gate.py`** (nový, 4 testy) — nevyhodnocený záznam blokuje, neschválený blokuje dál, úplná a schválená sada projde, legacy string v `json_result` bránu neshodí.
- **`backend/tests/test_evaluation_queue.py`** — 2 nové testy: `EVAL_QUEUED` se odešle při zařazení, a úkol nad limit souběžnosti zůstane ve frontě a jde zrušit. Ověřeno, že se starým chováním zbývá ve frontě 0 položek.
- Celkem 97 testů.

---

## [v3.13.1] — 2026-08-12 — Chybějící zpětná vazba a neviditelné výsledky u části lektorů

### Problém

Dvě nezávislá hlášení z testovacího provozu po nasazení v3.13.0: (1) u dávky 3 ÚZ se individuální zpětná vazba vygenerovala jen jednomu studentovi, u dvou zůstalo pole prázdné — bez chyby v logu; (2) druhý lektor viděl své kompletně vyhodnocené ÚZ v UI jako „Nezpracováno", bez skóre a bez tlačítka pro schválení, přestože v DB byl záznam v pořádku (`pocet_vysledku=25`, `skore=17`) a backend log hlásil úspěch.

### Zpětná vazba se tiše ztrácela (ADR-020)

- **`backend/utils/tasks.py`** (nový) — `spawn_background()` drží na fire-and-forget tasky silnou referenci až do dokončení a loguje jejich nezachycené výjimky. `asyncio.create_task()` drží referenci pouze **slabou** (dokumentace asyncio to uvádí výslovně), takže garbage collector mohl task uprostřed běhu zlikvidovat — tiše, bez chyby, bez tracebacku. Odtud nedeterministické „jednomu se vygenerovala, dvěma ne".
- **`backend/api/evaluate.py`, `backend/services/evaluation_queue.py`** — převedena všechna čtyři fire-and-forget spuštění: zpětná vazba, doručení WS zprávy, úklid fronty a spuštění samotné evaluace. To poslední bylo nejzávažnější — zahozený task uprostřed evaluace by porušil invariant terminální události z ADR-017. Riziko navíc vzrostlo právě opravou fronty v3.13.0: dokud běžela jedna evaluace naráz, vznikal jeden task; nyní jich vzniká N těsně po sobě.

### Výsledky neviditelné pro část lektorů (ADR-021)

- **`src/utils/api.ts`** (nová funkce `getClassId`) — frontend měl na devíti místech natvrdo `/analytics/class/1`, jenže `ClassRoom` se zakládá zvlášť pro každého lektora (auto-increment ID). Backend filtruje `class_id` **a zároveň** `lecturer_id` (ADR-014), takže data v UI viděl jedině lektor, jehož třída měla shodou okolností ID 1. Ostatním se korektně vrátilo prázdné pole → `finalStatus` nikdy nepřeskočil na `evaluated` → odznak „Nezpracováno" a nevykreslené schvalovací tlačítko. Nově se ID rezolvuje přes idempotentní `POST /evaluate/classes/ensure`, cache je klíčovaná tokenem (sama se zneplatní při přihlášení jiného lektora).
- **`src/App.tsx`, `src/components/TabEvaluation.tsx`, `src/components/TabAnalytics.tsx`** — nahrazeno všech devět výskytů včetně Excel exportu, odkazu v historii exportů a názvu staženého souboru. `App.tsx` navíc načítá stav analýz při změně tokenu (dřív `[]`, takže se po přihlášení už nikdy nenačetlo znovu).
- **Nejde o regresi z v3.13.0** — v nginx logu z 10. 8. je vidět, že týž lektor dostával na `/analytics/class/1?scenario_id=scen-2` odpověď o velikosti 2 bajtů (`[]`) i po dokončení svých evaluací, zatímco druhý lektor desítky kilobajtů. Chyba existovala od zavedení izolace dat.

### Testy

- **`backend/tests/test_class_scoping.py`** (nový, 6 testů) — zamyká kontrakt, na kterém oprava stojí: `classes/ensure` vrací per lektora vlastní třídu, je idempotentní, vrátí **tutéž** třídu, do které zapisuje fast-scan, a nevrátí cizí. Reprodukce nahlášené chyby (`class/1` prázdné vs. rezolvované ID s daty) i kontrola, že se izolace dat opravou neprolomila.
- Fixture používá `StaticPool` — `sqlite:///:memory:` dává každému spojení vlastní prázdnou databázi a TestClient obsluhuje requesty v jiném vlákně, takže bez něj aplikace spadne na „no such table". Ověřeno empiricky.

---

## [v3.13.0] — 2026-08-10 — Provozní robustnost dávkového vyhodnocování

### Problém

Z dávky 3 ÚZ se na testovacím serveru vyhodnotil jen první; zbylé se musely spouštět opakovaně ručně a kolečko v UI zůstalo viset. Log ukazoval deterministický vzorec (dávka 3 → 1 přežije, dávka 4 → 1 přežije, dávka 1 → vždy OK) s hláškou `cannot perform operation: another operation is in progress`. Diagnostika: čtení kódu proti backend/frontend/vLLM logům, kořenová příčina nalezena bez spekulace a ověřena regresním testem, který bez opravy prokazatelně selhává.

### Kritické — fronta vyhodnocování (ADR-017)

- **`backend/services/evaluation_queue.py`** — `broadcast()` volal `execute()` nad JEDNÍM sdíleným asyncpg spojením (`_pg_conn`, zavedeno v ADR-015) z každé úlohy zvlášť. Jedno asyncpg spojení nesmí obsluhovat dvě korutiny naráz, takže při dávce první úloha spojení zabrala a zbylé okamžitě spadly — regrese přímo z ADR-015, předtím `broadcast()` žádné DB spojení nepoužíval. Opraveno `asyncio.Lock` (`_notify_lock`) nad každým `execute()`.
- **`backend/api/evaluate.py`** — `broadcast(EVAL_START)` stál mimo `try` blok, takže selhání notifikace shodilo celou evaluaci ještě před voláním LLM. Přesunuto dovnitř.
- **`backend/services/evaluation_queue.py`** — `_run_task` nahradil `print()` za `logger.error(..., exc_info=True)` a v `except` větvi odesílá `EVAL_ERROR`. Tím vzniká invariant, o který se opírá celé UI: **každý zařazený úkol vyprodukuje právě jednu terminální událost**. Dřív spadlé úlohy neposlaly nic, `evaluatedCount` nikdy nedosáhl `totalToEvaluate` a `isEvaluating` zůstalo natrvalo `true` — odtud i 8s polling běžící 20 minut bez jediného LLM volání.
- **`backend/services/evaluation_queue.py`, `backend/api/evaluate.py`** — `clear_queue()` mazala frontu VŠEM lektorům a jen v tom z `--workers 2` procesů, na který dopadl HTTP request. Nově `clear_queue(lecturer_id)` filtruje podle lektora (cizí úkoly vrací do fronty) a úklid rozesílá kanálem `evaluz_eval_events` jako řídicí zprávu (`__control`), kterou `_on_notify` vykoná lokálně v každém procesu a do prohlížeče ji neposílá.
- **`src/components/TabEvaluation.tsx`** — watchdog na 10 minut ticha jako poslední pojistka proti zaseknutému kolečku, kdyby se WS zpráva ztratila při výpadku spojení. Restartuje se s každým dokončeným ÚZ, polling zůstává na 8 s.
- Nové testy: souběžný `broadcast()` přes `ConcurrencyTrackingPgConn` (bez zámku selže — 2 překryvy, doručena 1 zpráva ze 3), terminální událost při pádu handleru, `clear_queue` per lektor, řídicí zpráva se nedoručí socketům.

**Dopad na výkon:** batching se dosud vůbec neprojevil — dávka 1 ÚZ trvala 96,1 s a „dávka 3" 98,7 s, protože běžel vždy jen jeden požadavek. GPU přitom batching zvládá (starší záznam vLLM: `Running: 5 reqs`, 165 tok/s proti 36 tok/s u jediného požadavku, KV cache na 30 %).

### Kontextové okno — autodetekce ze serveru (ADR-018)

- **`backend/services/llm_engine.py`** — `VLLM_CONTEXT_WINDOW` z Administrace se do vLLM nikdy neposílalo (`_build_llm_kwargs` předává per-request kontext jen Ollamě přes `num_ctx`); je to čistě interní odhad pro rozhodnutí single-call vs. chunking. Na testovacím serveru bylo 64512 proti serverovým `--max-model-len 32768`, takže práh pro chunking (45 158) ležel **nad tvrdým limitem serveru**. Nová `fetch_server_max_model_len()` čte `max_model_len` z `GET /v1/models` a `evaluate_report()` ho uplatní jako strop (`ctx = min(nastavení, server)`) s varováním při rozporu.
- **`backend/api/admin.py`** — „Test LLM" vrací zjištěný `max_model_len` a upozorní, když je nastavení v Administraci vyšší. Cache se pro test obchází (`force_refresh=True`), aby po restartu vLLM ukázal aktuální hodnotu.

### Přiřazení kritérií (ADR-019)

- **`backend/services/llm_engine.py`** — `_canonicalize_criterion_name` odstřihává jméno osoby na konci názvu, takže kritéria lišící se jen osobou sdílí jednu frontu slotů; výběr byl `pop(0)`, tedy poziční podle pořadí odpovědi modelu. V sadě MS2 „Vstup do obydlí" takto kolidují tři dvojice (kritéria 6+12, 7+13, 8+14 — Horáková / Kadlec). Při prohození pořadí by se odůvodnění jedné osoby tiše uložilo pod kritérium druhé, aniž by se změnilo skóre. Nový `_pop_matching_slot()` hledá nejdřív přesnou shodu názvu a na poziční chování spadne až v nouzi — tehdy navíc loguje `WARNING`. Při jediném slotu je chování beze změny, regrese tedy není možná.

### Parser kritérií — viditelnost a úklid

- **`backend/services/criteria_service.py`** — chybějící pole `**Bodová hodnota:** N` tiše dosazovalo 1 bod (měnilo maximum skóre bez jakékoli stopy); nyní `WARNING`. Blok se zahozenou hlavičkou se hlásí jako `WARNING`, pokud obsahuje slovo „Kritérium" (pravděpodobný překlep ve formátu = ztracené kritérium), jinak `INFO`. Přidán souhrn „rozparsováno N kritérií, maximum M bodů".
- **`backend/services/criteria_service.py`** — splitter dělí PŘED hlavičkou dalšího kritéria, takže markdown oddělovač `---` zůstával viset na konci popisu předchozího. Ořez kotvený na konec řetězce, aby nepoškodil pomlčky uvnitř textu. Způsob zápisu kritérií v UI se nemění.

### Hygiena

- **`backend/services/llm_engine.py`, `backend/main.py`** — `AsyncOpenAI` + `httpx.AsyncClient` se vytvářely znovu při každém volání na 4 místech a nikdy se nezavíraly (nový connection pool a TCP handshake pro každý ÚZ). Nahrazeno sdíleným klientem (`_get_llm_client`) s `httpx.Limits`, uzavíraným v `lifespan` shutdownu přes `close_llm_clients()`. `admin.py::test_connection` ponechán samostatně — má záměrně timeout 20 s a `max_retries=0`.

### Infrastruktura (mimo repozitář)

- vLLM přechází na `--max-model-len 65536` **a zároveň** `--gpu-memory-utilization 0.85`. Při dosavadních 0.60 by KV cache (70 054 tokenů) dala pro 65 536 jen `Maximum concurrency 1,07×` a batching by se rozpadl; s 0.85 vychází ~152 000 tokenů → ~2,33× při 65k. Po restartu zůstává `VLLM_CONTEXT_WINDOW = 64512` platnou hodnotou (64512 < 65536) a nemění se; ADR-018 ji nadále hlídá automaticky.

---

## [v3.12.0] — 2026-08-05 — Oprava zaseknutého dávkového vyhodnocení + 2 UX bugy z pilotu

### Problém

Pilotní testování odhalilo tři nahlášené bugy: (1) dávkové vyhodnocení ÚZ se 100% reprodukovatelně zaseklo — kolečko se po ~2-3 minutách zastavilo bez výsledku, i u jediného ÚZ; (2) uložení kritérií po AI-asistovaném chatu uložilo jen poslední kritérium místo všech; (3) nový scénář se needeaktivoval, což vedlo ke ztrátě nahraných ÚZ souborů. Diagnostika: čtení kódu (3 paralelní Explore agenti), root cause nalezen u všech tří bez spekulace.

### Bezpečnost/spolehlivost — WebSocket doručení (ADR-015)

- **`backend/services/evaluation_queue.py`** — `broadcast()` už neiteruje `active_connections` přímo (per-proces registr), publikuje přes Postgres `pg_notify` na kanál `evaluz_eval_events`. Kořenová příčina: backend běží s `--workers 2` (dva nezávislé OS procesy bez sdíleného stavu); pokud `POST /evaluate/batch` a WebSocket spojení téhož lektora skončily na různých procesech, broadcast dokončení tiše zasáhl jen registr toho procesu, co úkol zpracoval — DB byla v pořádku, ale UI se to nikdy nedozvědělo. Ověřeno end-to-end (ruční `NOTIFY` přes `psql` → doručeno připojenému WS klientovi).
- **`backend/main.py`** — `lifespan()` spouští `eval_queue.start_listening(DATABASE_URL)` v každém worker procesu (jen PostgreSQL, SQLite dev prostředí přeskočeno).
- Nová závislost `asyncpg` (`requirements.txt`/`requirements.lock.txt`, přegenerováno uvnitř `python:3.10-slim`).
- **`src/components/TabEvaluation.tsx`** — WebSocket `useEffect` zbytečně přepojoval při každém přepnutí scénáře (`scenarioId` v dependency array, ač se uvnitř nepoužívá) a leakoval reconnect timery při cleanupu (žádný `cancelled` příznak) — způsobovalo desítky zbytečných reconnectů/s v nginx logách a zhoršovalo expozici výše popsaného bugu. Opraveno + přidána polling pojistka (`fetchEvaluations()` každých 8s během `isEvaluating`) jako obrana do hloubky.
- Nové testy: `backend/tests/test_evaluation_queue.py` (10 testů — dedup ADR-011, broadcast fallback/NOTIFY větev, `_on_notify` filtrace podle lektora, souběžný disconnect během doručování).

### Škálovatelnost pro víc souběžných lektorů (ADR-016)

- **`backend/main.py`** — `_resolve_worker_concurrency()` dřív předávala nastavenou `LLM_CONCURRENCY_VLLM`/`OPENROUTER` beze změny do KAŽDÉHO worker procesu (`EvaluationQueue` je per-proces singleton stejně jako u ADR-015) — s `--workers 2` tak mohl efektivní limit souběžných LLM volání proti sdílenému vLLM serveru být 2× vyšší, než admin v Administraci nastavil. Neprojevilo se to u jednoho lektora, ale hrozilo by přetížení serveru při víc lektorech pracujících souběžně. Opraveno dělením nastavené hodnoty počtem workerů.
- **`backend/core/config.py`** — nové nastavení `UVICORN_WORKERS` (výchozí 2).
- **`backend/Dockerfile`** — `ENV UVICORN_WORKERS=2` jako jediný zdroj pravdy, `--workers ${UVICORN_WORKERS}` v CMD z něj čte (dřív hardcoded `2` na dvou nezávislých místech).

### Backend — LLM pipeline

- **`src/components/TabCriteria.tsx`** — `processLLMRequest` po AI-chatu parsoval odpověď jako `responseText.split('---')` + poslední prvek; u delších seznamů kritérií model přirozeně používal `---` i jako vnitřní markdown oddělovač, takže se uložilo jen poslední kritérium. Opraveno na "první výskyt → do konce" (stejný vzor jako existující `###` větev).
- **`backend/core/seeder.py`** — `DEFAULT_PROMPT_PHASE1` doplněn o explicitní zákaz opakování `---` a číslovaný formát hlavičky kritéria (`**N. Kritérium: ...**`) odpovídající `_CRITERION_HEADER_RE` parseru. `PROMPT_VERSION` 3.9 → 3.10.

### UX

- **`src/components/Sidebar.tsx`**, **`src/App.tsx`** — vytvoření nového scénáře nyní scénář rovnou aktivuje a přepne na záložku Kritéria (dřív zůstal needeaktivovaný, což při pozdějším ručním přepnutí resetovalo rozpracované nahrané ÚZ). Uložení kritérií nyní automaticky přepne na záložku Vyhodnocování.

---

## [v3.11.2] — 2026-07-29 — Zamčené závislosti a oprava `.env` propagace pro nasazení

### Problém

Příprava nasazení na testovací server odhalila, že `backend/requirements.txt` neobsahuje žádný exaktní pin a `docker-compose.yml` nepředával backendu `.env` proměnné kromě `DATABASE_URL`.

### Build & Deploy

- **`backend/requirements.lock.txt`** (nový) — zamčené verze závislostí generované uvnitř `python:3.10-slim` (shoda s runtime v `backend/Dockerfile`, ne s lokálním dev venv na Python 3.13). Ověřeno 55/55 testů (`backend/tests/`) v obraze postaveném s tímto lockem před commitem.
- **`backend/Dockerfile`** — instaluje z `requirements.lock.txt` místo volného `requirements.txt`.
- **`docker-compose.yml`** — doplněn `env_file: .env` pro službu `backend`. Dříve se do kontejneru explicitně předávalo pouze `DATABASE_URL` — `JWT_SECRET_KEY`, `CORS_ORIGINS`, `APP_ENV` a další proměnné z `.env` se do kontejneru vůbec nedostaly, takže produkční validace secrets v `core/config.py` (sekce 4) nikdy neproběhla. `docker-compose.prod.yml` měl `env_file` už správně nastavené.
- Viz ADR-013 (zamčené závislosti).

---

## [v3.11.1] — 2026-07-01 — Oprava destruktivní normalizace pomlček v matchingu kritérií

### Backend — LLM pipeline

- **`backend/services/llm_engine.py`** — `_canonicalize_criterion_name` už neničí popisné pomlčky uprostřed názvu kritéria (např. „Ztotožnění osoby – minimálně jméno, příjmení, datum narození"). Plošný `.replace('—', '-').replace('–', '-')` byl odstraněn — `_PERSON_SUFFIX_RE` sám o sobě matchuje em-dash/en-dash/hyphen přes `[–—-]`, normalizace před stripem person-suffixu byla zbytečná a nerozlišovala mezi suffixem a popisnou pomlčkou uprostřed řetězce.

---

## [v3.11.0] — 2026-07-01 — RBAC: explicitní fail-closed `DataScope` (post-incident)

### Problém

Forenzní audit incidentu z 2026-06-30 (lecturer_id=3 viděla cizí scénáře a evaluace patřící lecturer_id=1) zjistil, že `apply_data_isolation()` odvozovala viditelnost dat implicitně z role volajícího (`is_admin`/`is_superadmin`). Protože přes stejnou funkci procházely i osobní endpointy (např. `GET /analytics/class/{id}`), Admin/SuperAdmin viděl na vlastním Evaluation tabu i cizí vyhodnocení a scénáře jiných vyučujících. `GET /statistics/filter-options` navíc tato cizí scénář ID vracel do frontendu, který je pak dotazoval přes osobní endpointy.

### Bezpečnost

- **`apply_data_isolation()`** (`backend/api/auth.py`) — nový explicitní parametr `scope: DataScope` (`PERSONAL` / `LOCATION` / `GLOBAL`), defaultně `PERSONAL` (fail-closed bez ohledu na roli). Pouze `backend/api/statistics.py` (manažerský dashboard) nově explicitně žádá `scope=LOCATION`/`GLOBAL`.
- Nový regresní kryt: `backend/tests/test_data_isolation.py` (3 testy).
- Plán a forenzní rozbor: `PLAN.md`. Architektonické zdůvodnění: ADR-014.

---

## [v3.10.9] — 2026-06-04 — Ochrana evaluace bez kritérií + vizuální počet kritérií

### Problém

Lektor mohl spustit dávkové vyhodnocování i bez uložených kritérií — v UI nebyl nikde vidět počet uložených kritérií a frontend přítomnost kritérií před odesláním dávky nekontroloval. Backend navíc mohl při NULL hodnotě `markdown_content` selhat s HTTP 500 místo čistého 404.

### Backend

- **`backend/api/evaluate.py`** — oprava potenciálního `AttributeError`: `(criteria_record.markdown_content or '').strip()`. Sloupec `markdown_content` je `nullable=True`; při NULL hodnotě dříve hrozila 500 místo korektní 404. Blokace evaluace bez kritérií tím zůstává spolehlivá.
- **`backend/api/criteria.py`** — `GET /criteria/{scenario}` nově vrací `criteria_count` (počet rozparsovaných kritérií z tabulky `Criterion`). `POST /criteria/save` vrací `criteria_count` (= počet rozparsovaných položek). Prázdný/NULL markdown vrací `criteria_count: 0`.

### Frontend

- **`src/components/TabCriteria.tsx`** — state `criteriaCount`, badge v hlavičce editoru: **„Uloženo: X kritérií"** (zvýrazněné červeně při 0). Po uložení s 0 kritérii se zobrazí varování *„Kritéria uložena jako prázdná — evaluace nebude možná."* Reset countu při změně scénáře.
- **`src/components/TabEvaluation.tsx`** — state `criteriaCount`, chip v action baru **„Kritéria: X"** (zelený při >0, červený s ikonou varování při 0). `handleBatchEvaluate()` před spuštěním dávky provede čerstvý fetch počtu kritérií ze serveru a při 0 zobrazí error toast + evaluaci nezahájí (chrání i případ zastaralého stavu po editaci v jiné záložce). Nový `isActive` prop obnoví počet při přepnutí na záložku.
- **`src/App.tsx`** — předání `isActive={activeTab === 'evaluation'}` do `TabEvaluation`.

Bez potvrzovacích dialogů, pouze vizuální zpětná vazba + tvrdá blokace při 0 kritérií. Existující vyhodnocení se nemění.

---

## [v3.10.8] — 2026-06-03 — Page Visibility API fix (UI zaseknutí při vyhodnocování)

### TabEvaluation.tsx — visibilitychange listener

- Přidán `document.addEventListener('visibilitychange', ...)` v `useEffect` závislém na `isEvaluating`. Pokud uživatel přepne záložku a vrátí se zpět *v době aktivního vyhodnocování*, browser mohl pozastavit JS timery (setTimeout reconnect WS). Po návratu záložky do popředí (`visibilityState === 'visible'`) se okamžitě zavolá `fetchEvaluations()` — výsledky se načtou z DB bez nutnosti manuálního refreshe.
- Listener se registruje jen pokud `isEvaluating === true`, takže nemá dopad na výkon při nečinnosti.

**Kontext:** Single-call evaluace trvá ~105 s. WS timer pro auto-reconnect (3 s) mohl být prohlížečem pozastaven při přepnutí záložky → uživatel viděl loading bez výsledků i po dokončení, dokud neprovedl F5.

---

## [v3.10.7] — 2026-06-03 — Oprava matching kritérií pro multi-person ÚZ (PARTIAL RECOVERY fix)

### llm_engine.py — _canonicalize_criterion_name + _PERSON_SUFFIX_RE + fallback match

Tři koordinované změny řeší `PARTIAL RECOVERY: 6/25` na scénářích kde kritéria
obsahují jméno osoby jako součást názvu (multi-person ÚZ, např. scen-2 s
Ivana Horáková + Tadeáš Kadlec).

- **`_PERSON_SUFFIX_RE`** — regex rozšířen o volitelnou závorku za jménem osoby:
  `(?:\s*\([^)]*\))?` na konci. Předchozí pattern `\s*$` selhal pokud za jménem
  následovala závorka, např. `– Ivana Horáková (negativní)` nebo
  `– Tadeáš Kadlec (Příkaz k dodání do VTOS jako důvod)`. Suffix se nestripoval →
  kanonická jména nesedět → 19/25 kritérií označeno `llm_omitted`.

- **`_canonicalize_criterion_name()`** — přidána normalizace pomlček před aplikací
  suffix regexu: em-dash (—) a en-dash (–) → hyphen (-). LLM (Qwen3.6 i jiné)
  konzistentně mění typ pomlčky v názvech kritérií, což způsobovalo neshodu i
  při jinak správném obsahu. Pořadí kroků: strip prefix → strip bold → normalizace
  pomlček → strip person suffix → lowercase.

- **`_validate_and_fix_vysledky()`** — přidán fallback substring match jako záchrana
  pro zbývající edge-cases: pokud přesná kanonická shoda selže, hledáme expected
  kritérium jehož canonical je podřetězcem LLM canonical nebo naopak. Loguje na DEBUG.

**Potvrzeno testováním:**
```
"7. Kritérium: Ztotožnění osoby – ... – Ivana Horáková"  → match ✓
"8. Kritérium: Výsledek lustrace – PATROS - Ivana Horáková (negativní)"  → match ✓
```

**Zbývající omezení:** Pokud LLM zkrátí název kritéria (parafráze místo doslovné kopie),
matching selže i po těchto opravách. Příklad z testování:
LLM vrátil `"podání vysvětlení"`, expected bylo `"poučení před podáním vysvětlení"`.
Jedná se o LLM halucinaci/zkrácení — řeší se na úrovni promptu, ne matchingu.

---

## [v3.10.6] — 2026-06-02 — vLLM overflow fix + přesnější token odhad + UX chybových notifikací

### llm_engine.py — overflow retry pro vLLM

- **`_llm_call_with_overflow_retry()`** — opravena regex podmínka detekce překročení kontextu. Původní pattern `(\d+) in the messages` odpovídal pouze OpenAI formátu chybové zprávy; vLLM vrací `your prompt contains at least (\d+) input tokens`, takže retry se nikdy nespustil a volání okamžitě selhalo s HTTP 400. Nový regex zachytí obě varianty: OpenAI i vLLM. Mechanismus nyní správně sníží `max_tokens` na `limit − input_tokens − 300` a zopakuje volání.

### llm_engine.py — konzervativnější token odhad pro češtinu

- **`_estimate_tokens()`** — koeficient změněn z `3,5 zn/token` na `2,5 zn/token`. Česká diakritika se v modelech (Qwen, Mistral) tokenizuje hustěji než angličtina (~2,0–2,5 zn/token). Původní hodnota 3,5 podhodnocovala vstupní tokeny o 30–40 %, což mohlo způsobit chybné rozhodnutí single-call vs. chunking (model dostával prompt příliš velký pro kontext). Při ostrém provozu s 25 kritérii a 10 normostranami (≈ 9 000 skutečných tokenů vstupního textu) je přesný odhad kritický.
- **`_evaluate_chunk()`** — přidán log `est_input≈X, total≈Y` per chunk. Umožňuje okamžitou diagnostiku tokenového rozpočtu v produkčních logách bez nutnosti externího tokenizéru.

### TabEvaluation.tsx — vizuální rozlišení chybových notifikací

- **`toastMessage` state** — typ změněn z `string | null` na `{ text: string; type: 'success' | 'error' } | null`. Všechna volání `setToastMessage()` aktualizována.
- **Toast render** — chybová zpráva (typ `error`) zobrazena s červeným pozadím (`--color-negative`) a ikonou `faTriangleExclamation`; úspěch zůstává beze změny (sekundární barva, `faCircleCheck`). Dříve všechny notifikace vypadaly vizuálně stejně — chyba vyhodnocení se zobrazila jako zelená "success" hláška.

### Doporučení pro vLLM deployment (ostrý provoz)

Pro spolehlivý provoz s 25 kritérii a dokumenty o 10+ normostranách je třeba spustit vLLM s:
```
--max-model-len 32768
```
Hodnota 4096 (vLLM default) nestačí: 10 normostran generuje ≈ 7 200 vstupních tokenů; spolu s výstupem 3 300 tokenů/chunk by byl celkový limit překročen i při 16 384.

---

## [v3.10.5] — 2026-05-06 — Analytics prázdný stav UX

- **`src/components/TabAnalytics.tsx`** — Explicitní prázdný stav při `data=null`: card s ikonou, vysvětlujícím textem a tlačítkem "Generovat analýzu" (volá `fetchAnalytics(force=true)`). Dříve se zobrazila prázdná plocha bez jakékoli výzvy k akci.

---

## [v3.10.4] — 2026-05-06 — Analytics force gate

- **`backend/services/analytics.py`** — `generate_class_summary()`: bez `force=True` se AI generování nikdy nespustí. Pokud cache neexistuje a `force=False`, vrátí `{"status":"no_analysis"}`. Opravuje race condition: page refresh během generování spouštěl druhé souběžné LLM volání (force=False bez cache propadl k AI generování).
- **`src/components/TabAnalytics.tsx`** — Handler pro `status="no_analysis"`: `setData(null)` bez erroru. Zobrazí prázdný stav (viz v3.10.5).

---

## [v3.10.3] — 2026-05-06 — Queue deduplicace + seeder fix

- **`backend/services/evaluation_queue.py`** — `EvaluationQueue` dostala `_active_keys: Set[str]` sledující klíče `{lecturer_id}:{scenario_id}:{filename}`. `add_task()` vrátí `False` a přeskočí studenta pokud je klíč aktivní. `_run_task()` finally uvolní klíč. `clear_queue()` čistí i `_active_keys`. Zabraňuje duplicitnímu vyhodnocení při jakémkoli re-submitu dávky.
- **`backend/core/seeder.py`** — Nový helper `_seed_setting(db, key, value)`: každý `AppSettings` klíč dostane vlastní `db.commit()` + `try/except rollback`. Odstraňuje batch commit způsobující `IntegrityError` při unique violation (nový klíč FEEDBACK_MAX_TOKENS nebyl seeded na existujících DB). Prompt upgrade sekce dostala vlastní `db.commit()`.

---

## [v3.10.2] — 2026-05-06 — WS reconnect fix

- **`src/components/TabEvaluation.tsx`** — Přidán `wsConnectCountRef` (useRef) počítající připojení. `ws.onopen` při reconnectu (count > 1) volá pouze `fetchEvaluations()` bez resetu stavů. Starý kód resetoval `'evaluating' → 'pending'` před fetchem, čímž ničil logiku zachování evaluating statusu a způsoboval automatické re-odesílání dávek po reconnectu.
- **`src/components/TabEvaluation.tsx`** — Opraven self-healing `useEffect`: odstraněna podmínka `evaluatedCount === 0` (bránila správnému self-healingu po WS reconnectu).

---

## [v3.10.1] — 2026-05-06 — Feedback mimo critical path (O2+O3)

### O2 — FEEDBACK_MAX_TOKENS konfigurovatelný

- **`backend/services/llm_engine.py`** — `_generate_individual_feedback()`: `max_tokens=600` (hardcoded) nahrazeno čtením z DB klíče `FEEDBACK_MAX_TOKENS`. Výchozí hodnota 250 (3–5 vět v češtině ≈ 150–180 tokenů). Čteno při každém volání — bez restartu.
- **`backend/core/seeder.py`** — seed `FEEDBACK_MAX_TOKENS=250` při prvním startu (INSERT IF NOT EXISTS).

### O3 — Decoupling zpětné vazby od critical path

- **`backend/services/llm_engine.py`** — `evaluate_report()` vrací `zpetna_vazba=""` (obě cesty — chunking i single-call). Nová public funkce `generate_feedback_for_record(merged, db, student_log_prefix)` — čte LLM nastavení z DB, sestaví klienta, zavolá `_generate_individual_feedback()`.
- **`backend/api/evaluate.py`** — nová funkce `_run_feedback_task(eval_record_id, lecturer_id, student_name, scen_id)` (module-level, vlastní DB session). Po `EVAL_SUCCESS` broadcastu spuštěn `asyncio.create_task(_run_feedback_task(...))`. Task: načte `json_result` z DB, zavolá `generate_feedback_for_record()`, provede partial update `json_result.zpetna_vazba`, odešle `FEEDBACK_DONE` WebSocket zprávu.
- **`src/components/TabEvaluation.tsx`** — handler `FEEDBACK_DONE` → `fetchEvaluations()`.

### Výsledek

- EVAL_SUCCESS přichází ~3–5 s po zahájení evaluace (chunking fáze hotová).
- Zpětná vazba se doplní async za dalších ~15–60 s (závisí na modelu a rate limitingu).
- 52/52 testů pass.

---

## [v3.10.0] — 2026-05-05 — LLM engine refactor (E1–E7)

7-etapový refaktor `llm_engine.py`. Cíl: zjednodušení kódu budovaného pro 8k kontext, který je s 128k vLLM zbytečně složitý.

### E1 — Integration test suite

- **`backend/tests/integration/mock_llm.py`** — `MockLLMRouter`: FIFO fronta odpovědí, respx interceptor pro `http://mock-vllm:8001/v1/chat/completions`. Metody: `respond_clean`, `respond_truncated` (deterministický cut před `}}`), `respond_with_extra_criteria`, `respond_chunk_pattern`, `respond_identity`, `respond_empty`.
- **`backend/tests/integration/conftest.py`** — fixtures: `db_engine` (SQLite `:memory:`), `db` (seeded session per test), `client` (FastAPI bez lifespan), `auth_headers`, `mock_llm`. Seed: VLLM_API_URL=`http://mock-vllm:8001/v1`, LLM_PLATFORM=vllm, CHUNK_SIZE=6, CHUNK_THRESHOLD_TOKENS_PCT=0.7, sample criteria CRITERIA_3/6/12.
- **`backend/tests/integration/test_evaluate_endpoint.py`** — 10 integračních testů (viz sekce Test suite v TECHNICAL_DOCUMENTATION.md).

### E2 — Adaptivní chunking

- **`_estimate_tokens(text)`** — `max(1, len(text) // 3)` (~3.5 chars/token pro češtinu).
- **`PLATFORM_CONTEXT_DEFAULTS`** — výchozí kontextová okna: vllm=131072, openai=128000, openrouter/ollama/lmstudio=8192.
- **`_get_setting(db, key, default)`** — helper pro čtení `AppSettings` s fallbackem.
- `evaluate_report()` rozhoduje adaptivně: `est_tokens > budget × threshold_pct` → chunking; jinak přímé volání.
- `CHUNK_SIZE` a `CHUNK_THRESHOLD_TOKENS_PCT` čteny z DB per volání.
- **`seeder.py`**: automatický seed `CHUNK_SIZE=6` a `CHUNK_THRESHOLD_TOKENS_PCT=0.7` při startu.
- **`backend/pytest.ini`**: přidán `asyncio_default_fixture_loop_scope = function`, definice `integration` markeru.
- **`backend/requirements-dev.txt`**: přidán `respx>=0.21`.

### E3 — Bugfixy a helper

- **`backend/utils/text.py`** (nový soubor): `clean_filename_to_display(filename)` — strip šumových prefixů (ÚZ, VTOS, hlaseni), podtržítka → mezery, trim.
- **`backend/api/evaluate.py`**: `clean_filename_to_display` použit v fast-scan i batch display name (2 místa).
- **Oprava identity update podmínky**: `existing_eval.student_identity or {}` + explicitní `bool(identita.get("prijmeni","").strip())` — prázdný `{}` byl dříve falsy, identita se nepřepisovala.
- **OpenRouter reasoning kwargs**: `_build_llm_kwargs()` přidává `reasoning` parametry pouze pro OpenRouter platformu.

### E4 — Logging infrastruktura

- `logger = logging.getLogger("evaluz.llm")` v `llm_engine.py`.
- `logging.getLogger("httpx").setLevel(logging.WARNING)` a `logging.getLogger("httpcore").setLevel(logging.WARNING)` v `core/logging_config.py`.

### E5 — Kompletní migrace print → logger

- 41× `print()` v `llm_engine.py` nahrazeno `logger.info/warning/error/debug`.
- `_dump_raw_llm_output` chráněno `if logger.isEnabledFor(logging.DEBUG):`.

### E6 — Smazání repair/recovery vrstev (−121 řádků z llm_engine.py)

- **`_repair_truncated_json()`** — smazána (~120 řádků). S 128k kontextem je truncace prakticky nemožná; fail-fast přes `ValueError` je správnější.
- **`_check_partial_recovery()`** — smazána (~30 řádků). `_partial_recovery` flag se již nevytváří.
- **Chunk retry loop** — smazán (~15 řádků). Při neúplném výsledku se vrátí placeholdery, lektor re-evaluuje.
- **`backend/tests/test_llm_pipeline.py`**: odstraněny importy a testy smazaných funkcí (`TestCheckPartialRecovery`, `TestRepairTruncatedJson`).
- **`backend/tests/integration/test_evaluate_endpoint.py`**: `test_partial_recovery_flag_in_response` → přepracován na `test_missing_criteria_get_placeholders` (ověřuje, že `_partial_recovery` NENÍ v odpovědi).

### E7 — Frontend cleanup

- **`src/components/TabEvaluation.tsx`**: odstraněn partial_recovery badge v listu studentů a varující panel v detailu hodnocení.
- **`src/types.ts`**: odstraněno `partial_recovery?: { expected, recovered, lost, reason } | null` z rozhraní `Student`.

### Výsledek

- `llm_engine.py`: ~1000 → ~600 řádků.
- 52/52 testů pass.
- `backend/__version__.py`: 3.9.10 → 3.10.0.

---

## [v3.9.8] — 2026-05-04

### Opraveno

- **`evaluate_batch` — fronta místo dict**: Záznamy studentů jsou čteny z asyncio fronty správně za sebou. Dřívější implementace používala dict s race condition při souběžné evaluaci více studentů.
- **Body z DB**: Při sestavení `expected_criteria_bodies` se body čtou z definice kritérií v DB, ne z předchozího `json_result` — eliminuje drift při re-evaluaci po změně kritérií.
- **Řazení výstupu**: `vysledky[]` v `json_result` jsou seřazeny dle pořadí vstupních kritérií. Konzistentní pořadí v UI, PDF i Excel bez ohledu na pořadí v LLM odpovědi.

---

## [v3.9.7] — 2026-05-04

### Opraveno

- **Přepočet `celkove_skore` ignoruje body u `splneno=false`**: Normalizace v `_merge_chunk_results()` nastavuje `body=0` pro všechny záznamy kde `splneno=False`. Model mohl vrátit `splneno=false, body=3` — tyto body se dříve chybně sčítaly do celkového skóre.

---

## [v3.9.6] — 2026-05-03

### Přidáno

- **Kanonizační match v `_validate_and_fix_vysledky()`**: `_canonicalize_criterion_name()` — strip prefixu `**N. Kritérium:`, trailing `**`, person suffix `– Jméno Příjmení`. Nahrazuje exact-match. Původní LLM název uložen do `_llm_actual_name`.
- **Multi-person duplikát detection**: První výskyt zachován, duplikáty logovány.
- **`CRITERIA_DELIMITER = "#############"`**: Vkládán mezi kritéria v promptu. `_split_criteria_chunks()` primárně dělí přes delimiter, legacy regex lookahead jako fallback. `parse_criteria_markdown()` synchronizována.
- **Pytest regression suite** (`backend/tests/test_llm_pipeline.py`, 36 testů): kanonizace, validace, sanitizer, chunking, merge, parser, integrační case Kořař.
- **fontTools log noise potlačen**: `core/logging_config.py` — `WARNING` úroveň pro `fontTools.*`.

---

## [v3.9.5] — 2026-04-29

### Přidáno

- **FIX B** — `_dump_raw_llm_output()`: Raw dump při JSON parse erroru do `/app/logs/llm_parse_errors/`. Volume mount v `docker-compose.yml`.
- **FIX A** — `_validate_and_fix_vysledky()`: Post-parse validace, placeholdery (`_llm_omitted=true`). `evaluate_report()` dostává `expected_criteria_names`.
- **FIX C** — `_check_partial_recovery()`: `_partial_recovery` metadata v `json_result`. Frontend: oranžový badge + varující panel. *(Odstraněno v v3.10.0.)*
- **FIX D** — Sanitizer: lone backslash → `\\`, kontrolní znaky 0x00–0x1F → `\uXXXX`.

---

## [v3.9.4] — 2026-04-29

### Opraveno

- **Scroll-to-top**: `studentListScrollRef` na levý panel (dříve scrollovalo pravý panel).
- **Analytics auto-refresh**: Prop `isActive: boolean` + `useEffect([isActive])` v `TabAnalytics`.
- **URL state persistence**: `activeTab` a `activeScenarioId` synchronizovány do URL search params přes `window.history.replaceState`.
- **Statistics filter-options**: `json_result IS NOT NULL` filtr v `scenario_query`.

---

## [v3.9.3] — 2026-04-28

### Opraveno

- Statistiky: `json_result IS NOT NULL` filtr v `/statistics/dashboard`.
- Scroll v panelu kritérií: `overflow-y: auto` na textarea.
- Re-evaluace: povolena pro `is_approved=false` záznamy (`canEvaluate` logika).

---

## [v3.9.2] — 2026-04-24

### Opraveno

- `_sanitize_json_string_values()`: oprava look-aheadu při chybějící čárce (vzor `"value""key":`).
- `_repair_truncated_json()`: per-block sanitizace — zachrání bloky s neescapovanými znaky.

---

## [v3.9.1] — 2026-04-24

### Přidáno

- `_sanitize_json_string_values()`: scan znak po znaku, escapování vnitřních uvozovek a literálních newlines. Vložena do parse pipeline jako 2. úroveň fallbacku.

---

## [v3.9.0] — 2026-04-23

### Přidáno

- `PROMPT_VERSION` upgrade systém v `seeder.py`.

### Změněno

- `DEFAULT_PROMPT_PHASE2`: zásadní přepis pro qwen3-30b-instruct (non-reasoning). Chain-of-thought přes pole `oduvodneni`.
- `DEFAULT_PROMPT_FEEDBACK`: limit 120 slov, jmenovat nesplněná kritéria.
- `DEFAULT_PROMPT_PHASE3`: 200–350 slov, tučné sekce.
- `_evaluate_chunk` user prompt: JSON-only instrukce na začátek, explicitní počet kritérií.

---

## [v3.8.7] — 2026-04-24

### Přidáno

- `_generate_individual_feedback()`: separátní LLM volání po merge, max 600 tokenů. Fail-safe: chyba neblokuje uložení evaluace.
- `prompt_feedback` editovatelný v Administraci.

---

## [v3.8.6] — 2026-04-24

### Přidáno

- Phase 3 filtrování: top 5 nejhůře splněných + vše pod `ANALYTICS_THRESHOLD` (výchozí 80 %). Frontend dostává kompletní data.
- `ANALYTICS_THRESHOLD` konfigurovatelný v DB.

---

## [v3.8.5] — 2026-04-24

### Opraveno

- Token budget: 350 → 500 tokenů/kritérium. Česká tokenizace ~1.5–1.7 zn/token.

---

## [v3.8.4] — 2026-04-23

### Přidáno

- Chunk retry s `temperature=0.3` při neúplném výsledku.
- `_llm_call_with_overflow_retry()`: HTTP 400 → automatické snížení `max_tokens`.

---

## [v3.8.3] — 2026-04-23

### Změněno

- `CHUNK_SIZE`: 8 → 6.

### Přidáno

- WebSocket self-healing: auto-reset `evaluating` stavu při reconnectu.

---

## [v3.8.2] — 2026-04-22

### Přidáno

- `_split_criteria_chunks()`: regex lookahead split, `asyncio.gather` parallelismus.
- Adaptivní `max_tokens` per chunk: `min(global_max, n_criteria × 350 + 300)`.
- `_repair_truncated_json()`: recovery z oříznutého JSON výstupu. *(Odstraněno v v3.10.0.)*
- `_llm_call_with_overflow_retry()`: zachytí HTTP 400.
- Dynamická verze v záhlaví: `GET /api/v1/version`.

---

## [v3.7.7] — 2026-04-13

### Opraveno

- `VLLM_API_URL` default: `""` místo `"http://localhost:8000/v1"`.
- `POST /admin/test-llm`: async OpenAI, specifické error handlery, validace prázdného URL.

---

## [v3.7.5] — 2026-04-10

### Architektura

- Alembic migrace přesunuty z `lifespan()` do `Dockerfile CMD`. Eliminuje race condition při více uvicorn workerech.

---

## [v3.7.4] — 2026-04-10

### Opraveno

- `UndefinedColumn` u `class_analyses.computed_at` a `.version`.
- Defensivní deserializace `json_result` (double-encoded TEXT sloupce).

### Přidáno

- Alembic migrace `f1e2d3c4b5a6 ensure_schema_integrity`: idempotentní IF NOT EXISTS záchrana.

---

## [v3.7.3] — 2026-04-10

### Opraveno

- Crash loop při více uvicorn workerech: PostgreSQL advisory lock v `run_alembic_migrations()`.

---

## [v3.7.2] — 2026-04-10

### Přidáno

- Samoregistrace: `POST /auth/register` — role vždy `vyučující`, rate-limit 5/min.
- Registrační formulář na login obrazovce.

---

## [v3.7.1] — 2026-04-10

### Přidáno

- `ProfileModal.tsx`: osobní údaje, doložka, změna hesla. Odděleno od `AdminModal`.
- Tlačítko Administrace: viditelné pouze pro `isAdminUser`.

---

## [v3.7.0] — 2026-04-09

### Přidáno

- `TabStatistics` (TabMonitor): Recharts vizualizace, Excel export, RBAC.
- `scenario_display_name` v DB (`StudentEvaluation`). Alembic migrace.
- Rozdělená LLM souběžnost: `LLM_CONCURRENCY_OPENROUTER` (výchozí 2) a `LLM_CONCURRENCY_VLLM` (výchozí 8).

### Opraveno

- PDF export třídy: správný auth dependency.
- Excel B2/B3: třída a modelová situace z query params.
- Statistiky: `datetime[:10]` → `strftime('%Y-%m-%d')`.
- Re-evaluace: `is_approved` reset na False.

---

## [v3.6.0] — 2026-04-02

### Přidáno

- Man-in-the-Loop schvalovací workflow: `is_approved` sloupec, badge "K revizi"/"Schváleno".
- PDF Protokol o hodnocení studijní skupiny: kompletní refactoring (titulek, tabulka, škála).
- `_parse_json_field()` helper v `pdf_generator.py`.

### Opraveno

- Double-encoded JSON v exportech.
- Jméno studenta v PDF: `student_identity` → `cleaned_name` → `student_name`.

---

## [v3.5.x] — 2026-03-26

- RBAC (Vyučující / Admin / SuperAdmin), `apply_data_isolation()`.

---

## [v3.4.x] — 2026-03-22

- `TabMonitor` (Statistiky), Excel export aktivity.
- Robustní DB migrace: "kobercový nálet" v `database.py`.

---

## [v3.3.x] — 2026-03-18

- Kompletní multi-tenant izolace: `lecturer_id` filtry, WebSocket izolace per lektor.
- `run_migrations()`: automatické ADD COLUMN IF NOT EXISTS při startu.

---

## [v3.2.x] — 2026-03-17

- vLLM integrace, `EvaluationQueue` se semaphore, paralelní batch processing.
- Dark mode redesign.

---

## [v2.x]

- Google Gemini podpora přes OpenAI-compatible rozhraní.
- Filtr AI chatu (`---` oddělovač).
