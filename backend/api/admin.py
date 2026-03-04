from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import openai
import httpx

from core.database import get_db
from core.security import get_password_hash
from models.db_models import SystemPrompt, AppSettings, Lecturer
from api.auth import get_current_lecturer

router = APIRouter(
    prefix="/admin",
    tags=["admin"]
)

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
    is_superadmin: bool = False
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    is_superadmin: bool
    is_active: bool
    must_change_password: bool

# --- Endpoints ---

@router.get("/prompts", response_model=List[PromptUpdateInfo])
def get_all_prompts(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Fetch all system prompts."""
    prompts = db.query(SystemPrompt).all()
    return [{"phase_name": p.phase_name, "content": p.content, "temperature": p.temperature} for p in prompts]


@router.put("/prompts")
def update_prompts(updates: List[PromptUpdateInfo], db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Update multiple system prompts."""
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
    settings_list = db.query(AppSettings).all()
    return [{"key": s.key, "value": s.value} for s in settings_list]


@router.put("/settings")
def update_settings(updates: List[AppSettingUpdateInfo], db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Update multiple app settings."""
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
async def test_connection(config: TestConfigRequest, current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Tests connection to a vLLM/OpenAI-compatible provider.
    """
    try:
        api_url = config.base_url
        if "openrouter.ai" in api_url and not api_url.endswith("/api/v1"):
            api_url = "https://openrouter.ai/api/v1"

        # We use a short timeout for the test
        client = openai.OpenAI(
            api_key=config.api_key or "sk-no-key-required",
            base_url=api_url,
            default_headers={"Authorization": f"Bearer {config.api_key}"} if config.api_key else None,
            http_client=httpx.Client(timeout=10.0)
        )
        
        # Perform a minimal completion test
        response = client.chat.completions.create(
            model=config.model_id,
            messages=[{"role": "user", "content": "say hi"}],
            max_tokens=1
        )
        
        if response:
            return {
                "status": "success",
                "message": f"Připojení k modelu '{config.model_id}' je v pořádku."
            }
            
    except openai.AuthenticationError:
        raise HTTPException(status_code=401, detail="Neplatný API klíč.")
    except openai.NotFoundError:
        raise HTTPException(status_code=404, detail=f"Model '{config.model_id}' nebyl na tomto URL nalezen.")
    except Exception as e:
        error_msg = str(e)
        if "Connection error" in error_msg or "ConnectError" in error_msg:
            raise HTTPException(status_code=503, detail=f"Nepodařilo se připojit k URL: {config.base_url}")
        raise HTTPException(status_code=500, detail=f"Chyba při testování: {error_msg}")


# --- User Management (SuperAdmin Only) ---

def verify_superadmin(current_user: Lecturer):
    if not getattr(current_user, 'is_superadmin', False):
        raise HTTPException(status_code=403, detail="Nedostatečná oprávnění. Pouze SuperAdmin může spravovat uživatele.")

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
        is_superadmin=user_data.is_superadmin,
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
