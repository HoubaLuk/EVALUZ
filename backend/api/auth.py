from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
from typing import Optional
from enum import Enum
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

from core.database import get_db
from core.security import verify_password, get_password_hash, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES, SECRET_KEY, ALGORITHM
from models.db_models import Lecturer, AppSettings
from jose import jwt, JWTError

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

# Use standard OAuth2 password flow
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# --- Pydantic Schemas ---
class Token(BaseModel):
    access_token: str
    token_type: str

class SetupData(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str
    title_before: str = ""
    title_after: str = ""
    rank_shortcut: str = ""
    rank_full: str = ""
    school_location: str = ""
    funkcni_zarazeni: str = ""

class ProfileUpdate(BaseModel):
    title_before: str = ""
    first_name: str
    last_name: str
    title_after: str = ""
    rank_shortcut: str = ""
    rank_full: str = ""
    school_location: str = ""
    funkcni_zarazeni: str = ""

class PasswordUpdate(BaseModel):
    new_password: str

class RegisterData(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str
    title_before: str = ""
    title_after: str = ""
    school_location: str = ""
    funkcni_zarazeni: str = ""

# --- Dependency ---
def decode_lecturer_token(token: str, db: Session):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(Lecturer).filter(Lecturer.email == email).first()
    if user is None:
        raise credentials_exception
        
    return user

def get_current_lecturer(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """
    Decodes the JWT token and returns the current authenticated Lecturer from Auth header.
    Used as a dependency in all protected endpoints.
    """
    return decode_lecturer_token(token, db)

def get_current_lecturer_export(token: str, db: Session = Depends(get_db)):
    """
    Decodes the JWT token from URL query arguments and returns the logged-in lecturer.
    Used strictly for frontend Anchor <a href> link downloads.
    """
    print(">>> [AUTH] Ověřuji token pro export z URL...")
    return decode_lecturer_token(token, db)


# --- Endpoints ---

class DataScope(str, Enum):
    """
    Explicitní rozsah viditelnosti dat pro apply_data_isolation().
    Viz PLAN.md — princip "Fail-Closed" / "Explicitní Data Scope".
    """
    PERSONAL = "personal"   # výchozí — vždy jen current_user, bez ohledu na roli
    LOCATION = "location"   # pouze explicitně manažerské endpointy (Admin/Superadmin)
    GLOBAL = "global"       # pouze explicitně manažerské endpointy (Superadmin)


def apply_data_isolation(
    query,
    entity_class,
    current_user: Lecturer,
    db: Session,
    scope: DataScope = DataScope.PERSONAL,
):
    """
    Aplikuje izolaci dat podle explicitně požadovaného rozsahu (scope), NIKOLI
    podle role uživatele odvozené implicitně uvnitř této funkce:

    - PERSONAL (výchozí): vždy jen záznamy current_user.id — platí univerzálně,
      i pro Admin/Superadmin. Osobní pracovní plocha nikdy neprosakuje cizí data.
    - LOCATION: vyžaduje is_admin nebo is_superadmin (jinak 403). Vrací záznamy
      všech lektorů se stejnou school_location jako current_user. Smí volat
      pouze explicitně manažerské endpointy.
    - GLOBAL: vyžaduje is_superadmin (jinak 403). Vrací záznamy bez omezení.
      Smí volat pouze explicitně manažerské/superadmin endpointy.
    """
    if scope == DataScope.GLOBAL:
        if not getattr(current_user, 'is_superadmin', False):
            raise HTTPException(status_code=403, detail="Nedostatečná oprávnění pro globální rozsah dat.")
        return query

    if scope == DataScope.LOCATION:
        if not (getattr(current_user, 'is_admin', False) or getattr(current_user, 'is_superadmin', False)):
            raise HTTPException(status_code=403, detail="Nedostatečná oprávnění pro rozsah dat v rámci lokality.")
        if not getattr(current_user, 'school_location', None):
            raise HTTPException(status_code=403, detail="Nedostatečná oprávnění pro rozsah dat v rámci lokality.")
        lecturer_ids = [
            l.id for l in db.query(Lecturer).filter(Lecturer.school_location == current_user.school_location).all()
        ]
        return query.filter(entity_class.lecturer_id.in_(lecturer_ids))

    # DataScope.PERSONAL — fail-closed default, žádná výjimka pro Admin/Superadmin.
    return query.filter(entity_class.lecturer_id == current_user.id)

@router.get("/check")
def check_if_setup_needed(db: Session = Depends(get_db)):
    """
    Returns True if no lecturer exists in the database.
    Used by frontend to decide whether to show the Setup UI or Login UI.
    """
    first_lecturer = db.query(Lecturer).first()
    return {"needs_setup": first_lecturer is None}


@router.post("/setup")
def setup_main_account(data: SetupData, db: Session = Depends(get_db)):
    """
    Creates the first lecturer account. Only allows creation if DB is empty.
    """
    first_lecturer = db.query(Lecturer).first()
    if first_lecturer is not None:
        raise HTTPException(status_code=400, detail="Main account already exists. Use regular login.")
        
    print(f">>> VYTVÁŘÍM PRVNÍHO LEKTORA: {data.email}")
    print(">>> POUŽÍVÁM PŘÍMÝ BCRYPT PRO HASHování")
    password = str(data.password).strip()
    import re
    if len(password) < 12 or not re.search(r"[a-z]", password) or not re.search(r"[A-Z]", password) or not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Heslo musí mít min. 12 znaků a obsahovat velká, malá písmena a číslice.")
        
    hashed_password = get_password_hash(password)
    
    new_lecturer = Lecturer(
        email=data.email,
        password_hash=hashed_password,
        first_name=data.first_name,
        last_name=data.last_name,
        title_before=data.title_before,
        title_after=data.title_after,
        rank_shortcut=data.rank_shortcut,
        rank_full=data.rank_full,
        school_location=data.school_location,
        funkcni_zarazeni=data.funkcni_zarazeni,
        is_superadmin=True
    )
    
    db.add(new_lecturer)
    db.commit()
    db.refresh(new_lecturer)
    
    # Generate token immediately after setup
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": new_lecturer.email}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer", "user": {
        "email": new_lecturer.email,
        "first_name": new_lecturer.first_name,
        "last_name": new_lecturer.last_name
    }}


class LoginData(BaseModel):
    username: str
    password: str

@router.post("/login", response_model=Token)
@limiter.limit("10/minute")
def login_for_access_token(request: Request, data: LoginData, db: Session = Depends(get_db)):
    """
    JSON Login endpoint.
    """
    user = db.query(Lecturer).filter(Lecturer.email == data.username).first()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Tento účet byl deaktivován administrátorem.")

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me")
def read_users_me(current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Returns the profile data of the currently logged-in lecturer.
    """
    return {
        "id": current_user.id,
        "email": current_user.email,
        "title_before": current_user.title_before,
        "first_name": current_user.first_name,
        "last_name": current_user.last_name,
        "title_after": current_user.title_after,
        "rank_shortcut": current_user.rank_shortcut,
        "rank_full": current_user.rank_full,
        "school_location": current_user.school_location,
        "funkcni_zarazeni": current_user.funkcni_zarazeni,
        "is_superadmin": current_user.is_superadmin,
        "is_admin": current_user.is_admin,
        "must_change_password": current_user.must_change_password
    }


@router.put("/me")
def update_profile(profile: ProfileUpdate, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Updates the profile and signature settings for the current lecturer.
    """
    current_user.title_before = profile.title_before
    current_user.first_name = profile.first_name
    current_user.last_name = profile.last_name
    current_user.title_after = profile.title_after
    current_user.rank_shortcut = profile.rank_shortcut
    current_user.rank_full = profile.rank_full
    current_user.school_location = profile.school_location
    current_user.funkcni_zarazeni = profile.funkcni_zarazeni
    
    db.commit()
    return {"status": "success", "message": "Profil byl úspěšně aktualizován."}

@router.put("/password")
def update_password(data: PasswordUpdate, db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """
    Updates the password for the current lecturer and clears the must_change_password flag.
    """
    password = str(data.new_password).strip()
    import re
    if len(password) < 12 or not re.search(r"[a-z]", password) or not re.search(r"[A-Z]", password) or not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Heslo musí mít min. 12 znaků a obsahovat velká, malá písmena a číslice.")
    
    current_user.password_hash = get_password_hash(password)
    current_user.must_change_password = False
    db.commit()
    return {"status": "success", "message": "Heslo bylo úspěšně změněno."}


@router.post("/register")
@limiter.limit("5/minute")
def register_new_user(request: Request, data: RegisterData, db: Session = Depends(get_db)):
    """
    Veřejná registrace nového uživatele — role je vždy 'vyučující'.
    Nelze se sám ustanovit administrátorem ani superadminem.
    Vyžaduje existenci alespoň jednoho uživatele v systému (tzn. setup byl dokončen).
    """
    # Systém musí být nastavený — setup endpoint platí pouze pro prázdnou DB
    if db.query(Lecturer).count() == 0:
        raise HTTPException(status_code=400, detail="Systém ještě nebyl nastaven. Použijte /setup.")

    # Jedinečnost e-mailu
    if db.query(Lecturer).filter(Lecturer.email == data.email).first():
        raise HTTPException(status_code=409, detail="Tento e-mail je již registrován.")

    # Validace hesla
    import re
    password = str(data.password).strip()
    if len(password) < 12 or not re.search(r"[a-z]", password) or not re.search(r"[A-Z]", password) or not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Heslo musí mít min. 12 znaků a obsahovat velká, malá písmena a číslice.")

    new_user = Lecturer(
        email=data.email,
        password_hash=get_password_hash(password),
        first_name=data.first_name,
        last_name=data.last_name,
        title_before=data.title_before,
        title_after=data.title_after,
        school_location=data.school_location,
        funkcni_zarazeni=data.funkcni_zarazeni,
        is_superadmin=False,   # NIKDY nelze přes registraci
        is_admin=False,        # NIKDY nelze přes registraci
        is_active=True,
        must_change_password=False
    )
    db.add(new_user)
    db.commit()
    return {"status": "success", "message": "Účet byl vytvořen. Přihlaste se svými přihlašovacími údaji."}


@router.get("/school-locations")
def get_school_locations(db: Session = Depends(get_db), current_user: Lecturer = Depends(get_current_lecturer)):
    """Returns the list of available school locations from AppSettings."""
    import json as _json
    setting = db.query(AppSettings).filter(AppSettings.key == "SCHOOL_LOCATIONS").first()
    if setting and setting.value:
        try:
            return {"locations": _json.loads(setting.value)}
        except Exception:
            pass
    return {"locations": []}

