import os
from datetime import datetime, timedelta
from jose import jwt, JWTError
import bcrypt

# Secret key should ideally be loaded from environment variables
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "b3a1a6b4d3d4b68ef5a4c9b9a67a0a03dcdfc7eab79883")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 7 days validity for local apps

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
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
