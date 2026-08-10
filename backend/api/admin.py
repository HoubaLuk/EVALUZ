from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import logging
import openai
from openai import AsyncOpenAI
import httpx

from core.database import get_db
from core.security import get_password_hash
from models.db_models import SystemPrompt, AppSettings, Lecturer

logger = logging.getLogger("evaluz.admin")
from api.auth import get_current_lecturer

router = APIRouter(
    prefix="/admin",
    tags=["admin"]
)

def verify_superadmin(current_user: Lecturer):
    if not getattr(current_user, 'is_superadmin', False):
        raise HTTPException(status_code=403, detail="Nedostatečná oprávnění. Tato sekce vyžaduje roli SuperAdmin.")

# --- Pydantic Schemas for Admin ---

class PromptUpdateInfo(BaseModel):
    phase_name: str
    content: str
    temperature: float

class AppSettingUpdateInfo(BaseModel):
    key: str
    value: str

class TestConfigRequest(BaseModel):
    base_url: str
    model_id: str
    api_key: Optional[str] = "sk-no-key-required"

class UserCreateRequest(BaseModel):
    email: str
    first_name: str
    last_name: str
    password: str
    role: str = "vyucujici"

class UserRoleUpdateRequest(BaseModel):
    role: str

class UserResponse(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    is_superadmin: bool
    is_admin: bool
    is_active: bool
    must_change_password: bool

# --- Endpoints ---

@router.get("/prompts", response_model=List[PromptUpdateInfo])
def get_all_prompts(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Fetch all system prompts."""
    verify_superadmin(current_user)
    prompts = db.query(SystemPrompt).all()
    return [{"phase_name": p.phase_name, "content": p.content, "temperature": p.temperature} for p in prompts]


@router.put("/prompts")
def update_prompts(updates: List[PromptUpdateInfo], db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Update multiple system prompts."""
    verify_superadmin(current_user)
    for update in updates:
        prompt = db.query(SystemPrompt).filter(SystemPrompt.phase_name == update.phase_name).first()
        if prompt:
            prompt.content = update.content
            prompt.temperature = update.temperature
        else:
            new_prompt = SystemPrompt(phase_name=update.phase_name, content=update.content, temperature=update.temperature)
            db.add(new_prompt)
    db.commit()
    return {"message": "Prompts updated successfully"}


@router.get("/settings", response_model=List[AppSettingUpdateInfo])
def get_all_settings(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Fetch all App settings (e.g., vLLM configuration)."""
    verify_superadmin(current_user)
    settings_list = db.query(AppSettings).all()
    return [{"key": s.key, "value": s.value} for s in settings_list]


@router.put("/settings")
def update_settings(updates: List[AppSettingUpdateInfo], db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Update multiple app settings."""
    verify_superadmin(current_user)
    for update in updates:
        setting = db.query(AppSettings).filter(AppSettings.key == update.key).first()
        if setting:
            setting.value = update.value
        else:
            new_setting = AppSettings(key=update.key, value=update.value)
            db.add(new_setting)
    db.commit()
    return {"message": "Settings updated successfully"}


@router.post("/test-llm")
async def test_connection(
    config: TestConfigRequest,
    db: Session = Depends(get_db),
    current_user: Lecturer = Depends(get_current_lecturer),
):
    """
    Tests connection to a vLLM/OpenAI-compatible provider.
    Používá AsyncOpenAI — neblokuje event loop.

    Kromě dostupnosti modelu ověří i kontextové okno (ADR-018): serverový `max_model_len`
    je tvrdý limit, nastavení `VLLM_CONTEXT_WINDOW` v Administraci ho nemůže zvýšit.
    Když je nastavené vyšší, admin to musí vidět tady — jinak se to projeví až chybou
    HTTP 400 uprostřed vyhodnocování delšího ÚZ.
    """
    try:
        api_url = config.base_url.strip()
        if not api_url:
            raise HTTPException(status_code=400, detail="URL LLM providera není nastavena.")

        if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
            api_url = "https://openrouter.ai/api/v1"

        api_key = config.api_key or "sk-no-key-required"

        logger.info(f"Test LLM: url={api_url}, model={config.model_id}")

        client = AsyncOpenAI(
            api_key=api_key,
            base_url=api_url,
            default_headers={"Authorization": f"Bearer {api_key}"},
            http_client=httpx.AsyncClient(timeout=20.0),
            max_retries=0,  # Bez retries — test musí být rychlý
        )

        response = await client.chat.completions.create(
            model=config.model_id,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=5,
        )

        if response:
            from services.llm_engine import fetch_server_max_model_len

            message = f"Připojení k modelu '{config.model_id}' je v pořádku."
            # force_refresh: po restartu vLLM s jiným --max-model-len musí test ukázat
            # aktuální hodnotu, ne tu z cache.
            server_ctx = await fetch_server_max_model_len(api_url, api_key, force_refresh=True)
            configured_row = db.query(AppSettings).filter(
                AppSettings.key == "VLLM_CONTEXT_WINDOW"
            ).first()
            configured_ctx = int(configured_row.value) if configured_row and configured_row.value else None

            if server_ctx:
                message += f" Kontextové okno serveru: {server_ctx} tokenů."
                if configured_ctx and configured_ctx > server_ctx:
                    message += (
                        f" ⚠ V Administraci je nastaveno {configured_ctx}, což server neumí —"
                        f" aplikace bude počítat s {server_ctx}. Snižte nastavení,"
                        f" nebo spusťte vLLM s vyšším --max-model-len."
                    )

            return {
                "status": "success",
                "message": message,
                "max_model_len": server_ctx,
                "configured_context_window": configured_ctx,
            }

    except openai.AuthenticationError as e:
        logger.warning(f"Test LLM — auth chyba: {e}")
        raise HTTPException(status_code=401, detail="Neplatný API klíč (AuthenticationError).")
    except openai.NotFoundError as e:
        logger.warning(f"Test LLM — model nenalezen: {e}")
        raise HTTPException(status_code=404, detail=f"Model '{config.model_id}' nebyl na tomto URL nalezen.")
    except openai.BadRequestError as e:
        logger.warning(f"Test LLM — špatný model nebo parametry: {e}")
        raise HTTPException(status_code=400, detail=f"Neplatné ID modelu nebo parametry: {str(e)}")
    except openai.RateLimitError as e:
        logger.warning(f"Test LLM — rate limit: {e}")
        raise HTTPException(status_code=429, detail="Překročen rate limit poskytovatele. Zkuste za chvíli.")
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Test LLM — neočekávaná chyba: {error_msg}", exc_info=True)
        if "Connection" in error_msg or "Connect" in error_msg or "connect" in error_msg:
            raise HTTPException(status_code=503, detail=f"Nepodařilo se připojit k URL: {config.base_url} — {error_msg}")
        raise HTTPException(status_code=500, detail=f"Chyba při testování: {error_msg}")


# --- User Management (SuperAdmin Only) ---

@router.get("/users", response_model=List[UserResponse])
def get_users(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    verify_superadmin(current_user)
    users = db.query(Lecturer).all()
    return users

@router.post("/users", response_model=UserResponse)
def create_user(user_data: UserCreateRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    verify_superadmin(current_user)
    
    existing = db.query(Lecturer).filter(Lecturer.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Uživatel s tímto e-mailem již existuje.")
        
    new_user = Lecturer(
        email=user_data.email,
        password_hash=get_password_hash(user_data.password.strip()),
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        is_superadmin=(user_data.role == "superadmin"),
        is_admin=(user_data.role == "admin" or user_data.role == "superadmin"),
        is_active=True,
        must_change_password=True # Donutíme ho změnit si heslo při prvním přihlášení
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@router.put("/users/{user_id}/toggle-active")
def toggle_user_active(user_id: int, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    verify_superadmin(current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Nemůžete deaktivovat sami sebe.")
        
    user = db.query(Lecturer).filter(Lecturer.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
        
    user.is_active = not user.is_active
    db.commit()
    return {"status": "success", "is_active": user.is_active}

@router.put("/users/{user_id}/role")
def update_user_role(user_id: int, request: UserRoleUpdateRequest, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    verify_superadmin(current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Nemůžete změnit roli sami sobě.")
    
    user = db.query(Lecturer).filter(Lecturer.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
        
    if request.role == "superadmin":
        user.is_superadmin = True
        user.is_admin = True
    elif request.role == "admin":
        user.is_superadmin = False
        user.is_admin = True
    else:  # vyucujici anebo cokoli jiného
        user.is_superadmin = False
        user.is_admin = False
        
    db.commit()
    return {"status": "success", "message": "Role úspěšně změněna."}

@router.put("/users/{user_id}/reset-password")
def reset_user_password_endpoint(user_id: int, passwords: dict, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    SuperAdmin passes {"new_password": "..."} to forcefully reset a user's password.
    """
    verify_superadmin(current_user)
    new_password = passwords.get("new_password")
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Nové heslo musí mít alespoň 6 znaků.")
        
    user = db.query(Lecturer).filter(Lecturer.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
        
    user.password_hash = get_password_hash(new_password.strip())
    user.must_change_password = True
    db.commit()
    return {"status": "success", "message": "Heslo bylo úspěšně resetováno."}
