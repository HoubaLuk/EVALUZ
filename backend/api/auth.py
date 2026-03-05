from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
from typing import Optional
from pydantic import BaseModel

from core.database import get_db
from core.security import verify_password, get_password_hash, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES, SECRET_KEY, ALGORITHM
from models.db_models import Lecturer
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


@router.post("/login", response_model=Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Standard OAuth2 Login endpoint.
    """
    user = db.query(Lecturer).filter(Lecturer.email == form_data.username).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    is_valid = verify_password(form_data.password, user.password_hash)
    
    if not is_valid:
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

