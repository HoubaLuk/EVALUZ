# HERMES - AI Evaluátor úředních záznamů ÚPVSP

## 📅 Status Projektu: Stabilní / Beta
Jádro aplikace (Analýza třídy, PDF/Excel exporty a persisence dat) je kompletně implementováno a otestováno.

## 1. Vize a Cíl Projektu
Aplikace slouží Útvaru policejního vzdělávání a služební přípravy (ÚPVSP). Cílem je automatizovat a standardizovat hodnocení "Úředních záznamů" (ÚZ) psaných policejními nováčky (ZOP). 
Při stovkách studentů šetří lektorům čas při rutinní kontrole formálních náležitostí a právní věcnosti.

## 2. Klíčové Principy (Neporušitelné)
- **Bezpečnost a Soukromí:** Aplikace je navržena pro lokální běh nebo zabezpečené API. Žádná data studentů nejsou sdílena s veřejnými modely pro trénování.
- **Human-in-the-Loop:** AI navrhuje body a zdůvodnění, lektor má však vždy finální slovo a možnost editace před uložením.
- **Vysvětlitelnost (Explainable AI):** AI musí každou chybu zdůvodnit na základě konkrétního znění kritérií.

## 3. Technologická Architektura (Stav k únoru 2026)
- **Frontend (Implementováno):** React 18 + Vite + TypeScript. Modulární architektura rozdělující aplikaci na 3 hlavní fáze.
- **Backend (Implementováno):** Python + FastAPI. Zabezpečuje orchestraci LLM, zpracování dokumentů, generování PDF reportů a správu SQLite databáze.
- **Persistence (Implementováno):** SQLite umožňuje kompletní uložení výsledků analýzy třídy, takže lektor může k datům přistupovat i po restartu aplikace.
- **LLM Engine:** Kompatibilní s OpenRouter API nebo lokálním vLLM rozhraním.

## 4. Implementované Fáze Flow
1. **Fáze 1 - Precizace kritérií:** Sokratovský dialog pro vydefinování hodnotícího klíče.
2. **Fáze 2 - Evaluace ÚZ:** Hromadné nahrávání a paralelní vyhodnocování dokumentů studentů.
3. **Fáze 3 - Analýza třídy (Dashboard):** Vizualizace úspěšnosti (heatmapa K1-K25), AI pedagogické shrnutí a exporty (Excel, HERMES PDF Report).

## 5. Budoucí Rozvoj
- Implementace hromadné administrace skupin studentů.
- Pokročilé statistiky v čase (porovnání různých běhů kurzů).
