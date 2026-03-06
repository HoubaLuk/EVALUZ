"""
MODUL: LLM ENGINE (AI JÁDRO)
Tento soubor je srdcem celé AI analýzy. Obsahuje logiku pro komunikaci s modely (vLLM, Google Gemini atd.),
přípravu promptů a následné čištění (parsování) odpovědí tak, aby z nich systém mohl vyčerpat data.
"""

import json
import httpx
from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from core.config import settings
from models.db_models import AppSettings

async def evaluate_report(report_text: str, criteria_markdown: str, system_prompt: str, db: Session, scenario_id: str = None, student_log_prefix: str = "") -> dict:
    """
    HLAVNÍ FUNKCE PRO EVALUACI (Fáze 2).
    Bere text studenta a zadaná kritéria, posílá je modelu a vrací vyčištěný JSON výsledek.
    """
    
    # 1. NAČTENÍ NASTAVENÍ: Vše se bere z databáze (z Administrace), aby uživatel mohl měnit modely za běhu.
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    # Per-task model: try MODEL_PHASE2 first, then fall back to global VLLM_MODEL_NAME
    db_phase_model = db.query(AppSettings).filter(AppSettings.key == "MODEL_PHASE2").first()
    db_global_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    
    # Per-task thinking: try THINKING_PHASE2 first, then fall back to global VLLM_ENABLE_THINKING
    db_phase_thinking = db.query(AppSettings).filter(AppSettings.key == "THINKING_PHASE2").first()
    db_global_thinking = db.query(AppSettings).filter(AppSettings.key == "VLLM_ENABLE_THINKING").first()
    
    api_url = db_url.value if db_url and db_url.value else ""
    model_name = (db_phase_model.value if db_phase_model and db_phase_model.value else "") or (db_global_model.value if db_global_model and db_global_model.value else "")
    api_key = db_key.value if db_key and db_key.value else ""
    
    enable_thinking = True
    thinking_value = (db_phase_thinking.value if db_phase_thinking and db_phase_thinking.value else "") or (db_global_thinking.value if db_global_thinking and db_global_thinking.value else "true")
    enable_thinking = (thinking_value.lower() == 'true')
    
    db_platform = db.query(AppSettings).filter(AppSettings.key == "LLM_PLATFORM").first()
    db_top_p = db.query(AppSettings).filter(AppSettings.key == "VLLM_TOP_P").first()
    db_presence = db.query(AppSettings).filter(AppSettings.key == "VLLM_PRESENCE_PENALTY").first()
    db_freq = db.query(AppSettings).filter(AppSettings.key == "VLLM_FREQUENCY_PENALTY").first()
    
    platform = db_platform.value if db_platform and db_platform.value else "vllm"
    top_p = float(db_top_p.value) if db_top_p and db_top_p.value else 0.95
    presence_penalty = float(db_presence.value) if db_presence and db_presence.value else 0.0
    frequency_penalty = float(db_freq.value) if db_freq and db_freq.value else 0.0
    
    if not api_url or not model_name:
        raise ValueError("LLM konfigurace (URL nebo Model) chybí v databázi. Nastavte je v Administraci.")

    # Oprava URL pro OpenRouter (pokud uživatel zapomene přidat /api/v1).
    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    # Logování do terminálu pro kontrolu, kam požadavek zrovna teče.
    prefix = f"[LOG - {student_log_prefix}] " if student_log_prefix else ""
    print(f"{prefix}LLM volání směřuje na: {api_url} s modelem: {model_name}")

    # Inicializace klienta dynamicikého pro každý požadavek (aby se projevily změny v URL u stejné instance serveru).
    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=300.0)
    )
    
    strict_system_prompt = system_prompt
    
    # 2. PŘÍPRAVA PROMPTU: Tady dáváme modelu přesné instrukce, jak má JSON vypadat.
    # Používáme F-stringy pro vložení textu ÚZ a kritérií přímo do pokynů.
    user_prompt = f"""
    ### SEZNAM KRITÉRIÍ K VYHODNOCENÍ (TOTO JSOU JEDINÉ POLOŽKY, KTERÉ CHCI V JSONU):
    {criteria_markdown}
    
    ### TEXT ÚŘEDNÍHO ZÁZNAMU (ÚZ) K VYHODNOCENÍ:
    {report_text}
    
    Požadovaná struktura JSON odpovědi (identita je POVINNÁ):
    Vždy přesně identifikuj PŘÍJMENÍ (to bude sloužit jako hlavní řadící klíč).
    {{
        "identita": {{
            "hodnost": "prap.", 
            "jmeno": "Jan", 
            "prijmeni": "Novák"
        }},
        "vysledky": [
            {{
                "nazev": "název kritéria",
                "splneno": true/false,
                "body": počet_bodů,
                "oduvodneni": "tvůj proces myšlení a zdůvodnění zde",
                "citace": "přesná věta z textu dokazující splnění/nesplnění"
            }}
        ],
        "celkove_skore": celkový_součet_bodů,
        "zpetna_vazba": "celkové shrnutí a doporučení pro studenta"
    }}
    
    IMPORTANT: Výsledkem tvé odpovědi MUSÍ být validní JSON! 
    NEPIŠ ŽÁDNÝ JINÝ TEXT OKOLO, ŽÁDNÉ VYSVĚTLIVKY ANI MARKDOWN BLOKY (např. ```json).
    """

    # print(f"{prefix}FINAL PROMPT TO LLM:\n{user_prompt}\n<<< END OF PROMPT")

    try:
        kwargs = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": strict_system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.1, # Low temperature for analytical consistency
            "top_p": top_p,
            "presence_penalty": presence_penalty,
            "frequency_penalty": frequency_penalty,
            "max_tokens": 16384,
            # Pokud model podporuje JSON mode, aktivujeme ho.
            "response_format": {"type": "json_object"}
        }

        # vLLM specifické parametry pro uvažování posíláme jen tam, kde víme, že to API nezahodí s chybou
        if platform == "vllm":
            kwargs["extra_body"] = {
                "enable_thinking": enable_thinking,
                "chat_template_kwargs": {"enable_thinking": enable_thinking}
            }
            
        # Voláme model.
        response = await client.chat.completions.create(**kwargs)
        
        # 3. PARSOVÁNÍ VÝSLEDKU: AI modely občas píší víc, než chceme. Tady odpověď čistíme.
        msg_content = response.choices[0].message.content or ""
        raw_response = msg_content.strip()

        
        import re
        # ODSTRANĚNÍ THOUGHT BLOKŮ: Některé modely (jako Qwen nebo DeepSeek) píší své "myšlenky" mezi <think> a </think>.
        # Tyto bloky musíme odstranit předtím, než se pokusíme text vyparsovat jako JSON.
        clean_text = re.sub(r"<(think|thought)>.*?(</\1>|$)", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()
        
        # Najdeme první '{' a poslední '}', abychom odsekli případný balast okolo (např. pokud model napsal "Here is the JSON: { ... }").
        start_idx = clean_text.find('{')
        end_idx = clean_text.rfind('}')
        
        if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
            raise ValueError("V odpovědi LLM nebyl nalezen žádný JSON objekt.")
            
        clean_response = clean_text[start_idx:end_idx+1]
        
        return json.loads(clean_response)
        
    except json.JSONDecodeError as e:
        print(f"{prefix}Failed to parse LLM response as JSON: {e}\nRaw Response: {raw_response}")
        raise ValueError("Model nevrátil validní JSON. Zkontrolujte logy.")
    except Exception as e:
        print(f"{prefix}Error communicating with vLLM at {api_url}: {e}")
        raise

async def extract_identity(report_text: str, db: Session, student_log_prefix: str = "") -> dict:
    """
    Rychlá extrakce identity studenta (jméno, příjmení a hodnost) pomocí LLM.
    Neprovádí žádnou evaluaci kritérií (šetrné na tokeny a čas).
    """
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    # Per-task model: try MODEL_EXTRACTION first, then fall back to global VLLM_MODEL_NAME
    db_extraction_model = db.query(AppSettings).filter(AppSettings.key == "MODEL_EXTRACTION").first()
    db_global_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    
    # Per-task thinking: try THINKING_EXTRACTION first, then fall back to global VLLM_ENABLE_THINKING
    db_extraction_thinking = db.query(AppSettings).filter(AppSettings.key == "THINKING_EXTRACTION").first()
    db_global_thinking = db.query(AppSettings).filter(AppSettings.key == "VLLM_ENABLE_THINKING").first()
    
    api_url = db_url.value if db_url and db_url.value else ""
    model_name = (db_extraction_model.value if db_extraction_model and db_extraction_model.value else "") or (db_global_model.value if db_global_model and db_global_model.value else "")
    api_key = db_key.value if db_key and db_key.value else ""
    
    enable_thinking = False # Default to false for fast scan
    thinking_value = (db_extraction_thinking.value if db_extraction_thinking and db_extraction_thinking.value else "") or (db_global_thinking.value if db_global_thinking and db_global_thinking.value else "false")
    enable_thinking = (thinking_value.lower() == 'true')
    
    db_platform = db.query(AppSettings).filter(AppSettings.key == "LLM_PLATFORM").first()
    db_top_p = db.query(AppSettings).filter(AppSettings.key == "VLLM_TOP_P").first()
    db_presence = db.query(AppSettings).filter(AppSettings.key == "VLLM_PRESENCE_PENALTY").first()
    db_freq = db.query(AppSettings).filter(AppSettings.key == "VLLM_FREQUENCY_PENALTY").first()
    
    platform = db_platform.value if db_platform and db_platform.value else "vllm"
    top_p = float(db_top_p.value) if db_top_p and db_top_p.value else 0.95
    presence_penalty = float(db_presence.value) if db_presence and db_presence.value else 0.0
    frequency_penalty = float(db_freq.value) if db_freq and db_freq.value else 0.0
    
    if not api_url or not model_name:
        return {}

    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=60.0)
    )
    
    print(f"[FAST-SCAN] Extrakce identity pomocí modelu: {model_name}")
    
    system_prompt = "Jsi asistent pro vytěžování dat z textu. Tvým úkolem je najít jméno, příjmení a hodnost studenta."
    
    # Use only the first and last ~500 chars to save tokens
    if len(report_text) > 1200:
        trimmed_text = report_text[:500] + "\n\n[...zkráceno...]\n\n" + report_text[-500:]
    else:
        trimmed_text = report_text
    
    user_prompt = f"""
    Z následujícího úředního záznamu (podpis a identifikace autora bývá většinou na konci) extrahuj hodnost, jméno a příjmení autora/studenta.
    
    TEXT ÚŘEDNÍHO ZÁZNAMU:
    {trimmed_text}
    
    Musíš vrátit POUZE striktní JSON objekt v tomto formátu (žádný jiný text okolo!):
    {{
        "identita": {{
            "hodnost": "prap.", 
            "jmeno": "Jan", 
            "prijmeni": "Novák"
        }}
    }}
    """
    
    try:
        kwargs = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.0,
            "top_p": top_p,
            "presence_penalty": presence_penalty,
            "frequency_penalty": frequency_penalty,
            "max_tokens": 1000 # Increased margin for reasoning models even if thinking is off
        }
        
        if platform == "vllm":
            kwargs["extra_body"] = {
                "enable_thinking": enable_thinking,
                "chat_template_kwargs": {"enable_thinking": enable_thinking}
            }

        response = await client.chat.completions.create(**kwargs)
        
        msg_content = response.choices[0].message.content
        if not msg_content:
            print(f"[FAST-SCAN] Model vrátil prázdnou odpověď (content=None). Model: {model_name}")
            return {}
        
        raw_response = msg_content.strip()
        import re
        clean_text = re.sub(r"<(think|thought)>.*?</\1>", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()
        
        start_idx = clean_text.find('{')
        end_idx = clean_text.rfind('}')
        if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
            return {}
            
        clean_response = clean_text[start_idx:end_idx+1]
        data = json.loads(clean_response)
        identity = data.get("identita", {})
        if identity:
            print(f"[FAST-SCAN] Identita nalezena: {identity}")
        return identity
    except Exception as e:
        print(f"Fast-scan identity exception: {e}")
        return {}

async def chat_completion(messages: list, system_prompt: str, temperature: float, db: Session, phase: str = None) -> str:
    """
    Sends a chat history to the local vLLM model. Supports phase-specific model configuration (e.g. Phase 1).
    """
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    db_platform = db.query(AppSettings).filter(AppSettings.key == "LLM_PLATFORM").first()
    db_top_p = db.query(AppSettings).filter(AppSettings.key == "VLLM_TOP_P").first()
    db_presence = db.query(AppSettings).filter(AppSettings.key == "VLLM_PRESENCE_PENALTY").first()
    db_freq = db.query(AppSettings).filter(AppSettings.key == "VLLM_FREQUENCY_PENALTY").first()
    db_max_tokens = db.query(AppSettings).filter(AppSettings.key == "VLLM_MAX_TOKENS").first()
    
    # Per-phase model lookup
    model_name = ""
    enable_thinking = True
    
    if phase:
        phase_model_key = f"MODEL_{phase.upper()}"
        phase_thinking_key = f"THINKING_{phase.upper()}"
        
        db_phase_model = db.query(AppSettings).filter(AppSettings.key == phase_model_key).first()
        db_phase_thinking = db.query(AppSettings).filter(AppSettings.key == phase_thinking_key).first()
        
        if db_phase_model and db_phase_model.value:
            model_name = db_phase_model.value
        if db_phase_thinking and db_phase_thinking.value:
            enable_thinking = (db_phase_thinking.value.lower() == 'true')

    # Fallback to global if not found or no phase
    if not model_name:
        db_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
        model_name = db_model.value if db_model and db_model.value else ""
        
        db_thinking = db.query(AppSettings).filter(AppSettings.key == "VLLM_ENABLE_THINKING").first()
        if db_thinking and db_thinking.value:
            enable_thinking = (db_thinking.value.lower() == 'true')
    
    api_url = db_url.value if db_url and db_url.value else ""
    platform = db_platform.value if db_platform and db_platform.value else "vllm"
    api_key = db_key.value if db_key and db_key.value else ""
    
    if not api_url or not model_name:
        raise ValueError(f"LLM konfigurace chybí v databázi (Phase: {phase or 'Global'}).")

    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    top_p = float(db_top_p.value) if db_top_p and db_top_p.value else 0.95
    presence_penalty = float(db_presence.value) if db_presence and db_presence.value else 0.0
    frequency_penalty = float(db_freq.value) if db_freq and db_freq.value else 0.0
    
    # Razantní navýšení hardlimitu pro gpt-oss-120b a thinking modely
    max_tokens = int(db_max_tokens.value) if db_max_tokens and db_max_tokens.value else 6000
    
    print(f">>> LLM volání směřuje na: {api_url} s modelem: {model_name}")

    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=300.0)
    )

    formatted_messages = [{"role": "system", "content": system_prompt}]
    
    # Expecting messages to be dictionaries with 'role' and 'content'
    for msg in messages:
        formatted_messages.append({"role": msg.get("role"), "content": msg.get("content")})

    try:
        kwargs = {
            "model": model_name,
            "messages": formatted_messages,
            "temperature": temperature,
            "top_p": top_p,
            "presence_penalty": presence_penalty,
            "frequency_penalty": frequency_penalty,
            "max_tokens": max_tokens
        }
        
        if platform == "vllm":
            kwargs["extra_body"] = {
                "enable_thinking": enable_thinking,
                "chat_template_kwargs": {"enable_thinking": enable_thinking}
            }

        response = await client.chat.completions.create(**kwargs)
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error in chat_completion with vLLM at {api_url}: {e}")
        raise ValueError(f"Nepodařilo se spojit s LLM: {str(e)}")
