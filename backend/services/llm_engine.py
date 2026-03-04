import json
import httpx
from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from core.config import settings
from models.db_models import AppSettings

async def evaluate_report(report_text: str, criteria_markdown: str, system_prompt: str, db: Session, scenario_id: str = None, student_log_prefix: str = "") -> dict:
    """
    Evaluates a police report against criteria using a local vLLM model dynamically configured from DB.
    """
    
    # 1. Fetch dynamic settings from DB. NO env fallbacks allowed.
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    api_url = db_url.value if db_url and db_url.value else ""
    model_name = db_model.value if db_model and db_model.value else ""
    api_key = db_key.value if db_key and db_key.value else ""
    
    if not api_url or not model_name:
        raise ValueError("LLM konfigurace (URL nebo Model) chybí v databázi. Nastavte je v Administraci.")

    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    prefix = f"[LOG - {student_log_prefix}] " if student_log_prefix else ""
    print(f"{prefix}LLM volání směřuje na: {api_url} s modelem: {model_name}")

    # Initialize OpenAI client dynamically per request to ensure latest URL is used
    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=300.0)
    )
    
    strict_system_prompt = system_prompt
    
    # User prompt containing the report and the criteria
    user_prompt = f"""
    ### SEZNAM KRITÉRIÍ K VYHODNOCENÍ (TOTO JSOU JEDINÉ POLOŽKY, KTERÉ CHCI V JSONU):
    {criteria_markdown}
    
    ### TEXT ÚŘEDNÍHO ZÁZNAMU (ÚZ) K VYHODNOCENÍ:
    {report_text}
    
    Požadovaná struktura JSON odpovědi (identita je POVINNÁ):
    Vždy přesně identifikuj PŘÍJMENÍ (to bude sloužit jako hlavní řadící klíč). Očekávaný formát identity v JSONu musí striktně odlišit jméno a příjmení.
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
    
    IMPORTANT: Bez ohledu na předchozí instrukce o analýze, výsledkem tvé odpovědi MUSÍ být validní JSON výše popsané struktury! Vždy musíš vyhodnotit ÚPLNĚ VŠECHNA kritéria ze seznamu nahoře.
    OUTPUT MUST BE STRICTLY IN JSON FORMAT. No preamble. Your output must cleanly parse via json.loads(). 
    NEPIŠ ŽÁDNÝ JINÝ TEXT OKOLO, ŽÁDNÉ VYSVĚTLIVKY ANI MARKDOWN BLOKY (např. ```json).
    """

    # print(f"{prefix}FINAL PROMPT TO LLM:\n{user_prompt}\n<<< END OF PROMPT")

    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": strict_system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1, # Low temperature for analytical consistency
            max_tokens=16384,
            # If the vLLM supports JSON mode formatting, we can try to force it, otherwise prompt engineering handles it
            response_format={"type": "json_object"} 
        )
        
        # Extract the raw text response safely, treating None as empty
        msg_content = response.choices[0].message.content or ""
        raw_response = msg_content.strip()

        
        import re
        # Odstraníme myšlenkové bloky z uvažujících modelů (qwen, deepseek, mistral) vč. neukončených
        clean_text = re.sub(r"<(think|thought)>.*?(</\1>|$)", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()
        
        start_idx = clean_text.find('{')
        end_idx = clean_text.rfind('}')
        
        if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
            print(f"{prefix}V odpovědi LLM nebyl nalezen žádný JSON objekt. Raw Response: {raw_response}")
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
    db_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    api_url = db_url.value if db_url and db_url.value else ""
    model_name = db_model.value if db_model and db_model.value else ""
    api_key = db_key.value if db_key and db_key.value else ""
    
    if not api_url or not model_name:
        print("Fast-scan: LLM konfigurace chybí.")
        return {}

    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

    client = AsyncOpenAI(
        base_url=api_url,
        api_key=api_key or "sk-no-key-required",
        default_headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
        http_client=httpx.AsyncClient(timeout=60.0)
    )
    
    system_prompt = "Jsi asistent pro vytěžování dat z textu. Tvým úkolem je najít jméno, příjmení a hodnost studenta."
    user_prompt = f"""
    Z následujícího úředního záznamu (podpis a identifikace autora bývá většinou na konci) extrahuj hodnost, jméno a příjmení autora/studenta.
    
    TEXT ÚŘEDNÍHO ZÁZNAMU:
    {report_text}
    
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
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.0,
            max_tokens=200,
            response_format={"type": "json_object"} 
        )
        
        raw_response = response.choices[0].message.content.strip()
        import re
        clean_text = re.sub(r"<(think|thought)>.*?</\1>", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()
        
        start_idx = clean_text.find('{')
        end_idx = clean_text.rfind('}')
        if start_idx == -1 or end_idx == -1 or start_idx > end_idx:
            return {}
            
        clean_response = clean_text[start_idx:end_idx+1]
        data = json.loads(clean_response)
        return data.get("identita", {})
    except Exception as e:
        print(f"Fast-scan identity exception: {e}")
        return {}

async def chat_completion(messages: list, system_prompt: str, temperature: float, db: Session) -> str:
    """
    Sends a chat history to the local vLLM model.
    """
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    db_platform = db.query(AppSettings).filter(AppSettings.key == "VLLM_PLATFORM").first()
    db_thinking = db.query(AppSettings).filter(AppSettings.key == "VLLM_ENABLE_THINKING").first()
    db_top_p = db.query(AppSettings).filter(AppSettings.key == "VLLM_TOP_P").first()
    db_presence = db.query(AppSettings).filter(AppSettings.key == "VLLM_PRESENCE_PENALTY").first()
    db_freq = db.query(AppSettings).filter(AppSettings.key == "VLLM_FREQUENCY_PENALTY").first()
    db_max_tokens = db.query(AppSettings).filter(AppSettings.key == "VLLM_MAX_TOKENS").first()
    
    api_url = db_url.value if db_url and db_url.value else ""
    platform = db_platform.value if db_platform and db_platform.value else "vllm"
    model_name = db_model.value if db_model and db_model.value else ""
    api_key = db_key.value if db_key and db_key.value else ""
    
    enable_thinking = (db_thinking.value.lower() == 'true') if db_thinking and db_thinking.value else True
    
    if not api_url or not model_name:
        raise ValueError("LLM konfigurace chybí v databázi.")

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
        response = await client.chat.completions.create(
            model=model_name,
            messages=formatted_messages,
            temperature=temperature,
            max_tokens=16384
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error in chat_completion with vLLM at {api_url}: {e}")
        raise ValueError(f"Nepodařilo se spojit s LLM: {str(e)}")
