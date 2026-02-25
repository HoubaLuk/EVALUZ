import json
import httpx
from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from core.config import settings
from models.db_models import AppSettings

async def evaluate_report(report_text: str, criteria_markdown: str, system_prompt: str, db: Session, student_log_prefix: str = "") -> dict:
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
    
    Požadovaná struktura JSON odpovědi (musí striktně odpovídat schématu Pydantic EvaluationResponse bez klíče jmeno_studenta, ten dodá backend):
    {{
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
        
        # Extract the raw text response
        raw_response = response.choices[0].message.content.strip()

        
        import re
        # Odstraníme myšlenkové bloky z uvažujících modelů (qwen, deepseek, mistral)
        clean_text = re.sub(r"<(think|thought)>.*?</\1>", "", raw_response, flags=re.DOTALL|re.IGNORECASE).strip()
        
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

async def chat_completion(messages: list, system_prompt: str, temperature: float, db: Session) -> str:
    """
    Sends a chat history to the local vLLM model.
    """
    db_url = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_URL").first()
    db_model = db.query(AppSettings).filter(AppSettings.key == "VLLM_MODEL_NAME").first()
    db_key = db.query(AppSettings).filter(AppSettings.key == "VLLM_API_KEY").first()
    
    api_url = db_url.value if db_url and db_url.value else ""
    model_name = db_model.value if db_model and db_model.value else ""
    api_key = db_key.value if db_key and db_key.value else ""
    
    if not api_url or not model_name:
        raise ValueError("LLM konfigurace chybí v databázi.")

    if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
        api_url = "https://openrouter.ai/api/v1"

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
