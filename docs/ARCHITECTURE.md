# ARCHITECTURE - EVALUZ

## Datový Model
- **Lecturer:** Příznaky `is_superadmin` a nově `is_admin`. Vazba `school_location` určuje organ. člena.
- **StudentEvaluation:** Ukládá vyhodnocení ÚZ. Doplněn slot `created_at` (ISO 8601 UTC) pro časové statistiky.

## Analýza & Monitoring
1.  **TabAnalytics (Třída):** Detailní pedagogický pohled na konkrétní třídu/scénář.
2.  **TabMonitor (Organizační):** Celkový přehled využití AI pro management útvaru.

## Exporty
- **PDF:** FPDF generátor (student reporty, class reporty).
- **Excel:** Openpyxl (.xlsx) pro vícestránkové statistické přehledy.

## LLM Robustnost
- **Sanitizer:** Vlastní regex cleaning pro extract JSONu i z modelů s vnitřním uvažováním (Qwen, DeepSeek).

## Klientská Synchronizace
- **HDD Sync:** Využívá `File System Access API`. 
- **Bezpečnost:** Vyžaduje tzv. **Secure Context** (HTTPS nebo localhost). Na běžném HTTP je funkce prohlížečem blokována.

