from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
import bcrypt
from core.config import settings

# JWT_SECRET_KEY se načítá z .env nebo Docker environment variable.
# PRODUKCE: vygenerujte silný klíč: openssl rand -hex 32
SECRET_KEY = settings.JWT_SECRET_KEY
ALGORITHM = "HS256"
# Platnost tokenu: 8 hodin (bezpečný kompromis pro interní policejní aplikaci)
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not isinstance(plain_password, str):
        raise ValueError(f"Verifier očekával string, ale dostal {type(plain_password)}")
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password: str) -> str:
    if not isinstance(password, str):
        raise ValueError(f"Hasher očekával string, ale dostal {type(password)}")
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
