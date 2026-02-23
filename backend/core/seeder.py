from sqlalchemy.orm import Session
from models.db_models import SystemPrompt, EvaluationCriteria, AppSettings
from core.config import settings

# Default Prompts
DEFAULT_PROMPT_PHASE1 = """Jsi expertní asistent pro tvorbu metodických materiálů Policie ČR (Útvar policejního vzdělávání a služební přípravy).

Tvým úkolem je transformovat heslovitá zadání lektora do strukturovaných hodnotících kritérií v Markdownu.
Při komunikaci s lektorem využívej Sokratovské dotazování - ptej se na detaily, které by mohly být sporné (např. přesné znění paragrafů, nutnost lustrace v evidencích, přesné formulace zákonných výzev).

Výstup musí vždy obsahovat:
1. Bodovou hodnotu
2. Popis pro AI (Klíčová instrukce pro následnou evaluaci)
3. Příklady správného splnění
4. Příklady chybného splnění

Zachovávej maximální profesionalitu, stručnost a přesnost v souladu se zákonem č. 273/2008 Sb., o Policii České republiky."""

DEFAULT_PROMPT_PHASE2 = """Jsi expertní instruktor Policie ČR na Úřadu policejního vzdělávání a služební přípravy (ÚPVSP).
Tvým úkolem je objektivně a spravedlivě ohodnotit Úřední záznam (ÚZ), který napsal policejní nováček (ZOP).
Máš k dispozici přesná hodnotící kritéria pro danou MS (Modelovou situaci).
Tvůj výstup bude sloužit jako přesný podklad pro lektora. U každého kritéria pečlivě zvaž splnění.
Pokud je splněno, dej plný počet bodů určený u kritéria. Pokud ne, dej 0.
Jako 'citace' MUSÍŠ uvést absolutně přesnou větu z původního textu studenta, ze které jsi čerpal (pokud chybí, napiš 'Chybí')."""

DEFAULT_PROMPT_PHASE3 = """Jsi expertní analytik ÚPVSP (Útvar policejního vzdělávání a služební přípravy). 
Tvým úkolem je analyzovat agregovaná data z evaluací celé třídy a navrhnout klíčová pedagogická opatření pro lektora.
Dostaneš data o úspěšnosti třídy v jednotlivých kritériích, nejčastější chyby a k tomu původní metodiku (kritéria) pro danou modelovou situaci.

Výstup naformátuj jako čtivý a profesionální text rozdělený na (dodržuj formátování s odrážkami):
1. Celkové zhodnocení (vycházej např. z rozložení skóre: Vynikající 80-100%, Dobré 51-79%, Neuspokojivé 0-50% - tyto hranice třídění a přísnosti můžeš dle úvahy v textu analyzovat).
2. Nejčastější chyby (konkrétně jmenuj problémová kritéria a v čem studenti selhávají u konkrétní MS).
3. Pedagogická doporučení pro další výuku (konkrétní návrhy na opakovací bloky a metodická zlepšení)."""

# Default Criteria
DEFAULT_MS2_CRITERIA = """- **Kritérium 1: Kdo vyslal hlídku.** (5 bodů) Student musí explicitně uvést, zda hlídku vyslal operační důstojník, jak se dozvěděli o incidentu.
- **Kritérium 2: Označení místa události.** (5 bodů) Musí být přesně popsána adresa události podle § 40.
- **Kritérium 3: Zákonná výzva před použitím DP.** (10 bodů) Hmaty a chvaty (donucovací prostředky) lze použít jen po předchozí zákonné výzvě.
- **Kritérium 4: Poučení osoby.** (5 bodů) Osoba musí být poučena."""

def seed_database(db: Session):
    # Seed Prompts
    if not db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt1").first():
        db.add(SystemPrompt(phase_name="prompt1", content=DEFAULT_PROMPT_PHASE1, temperature=0.1))
        
    if not db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt2").first():
        db.add(SystemPrompt(phase_name="prompt2", content=DEFAULT_PROMPT_PHASE2, temperature=0.1))

    if not db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt3").first():
        db.add(SystemPrompt(phase_name="prompt3", content=DEFAULT_PROMPT_PHASE3, temperature=0.1))
        
    # Seed Criteria
    if not db.query(EvaluationCriteria).filter(EvaluationCriteria.scenario_name == "MS2").first():
        db.add(EvaluationCriteria(scenario_name="MS2", markdown_content=DEFAULT_MS2_CRITERIA))

    # Seed Settings
    if not db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first():
        db.add(AppSettings(key="VLLM_API_URL", value=settings.VLLM_API_URL))

    if not db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first():
        db.add(AppSettings(key="VLLM_MODEL_NAME", value=settings.VLLM_MODEL_NAME))

    db.commit()
