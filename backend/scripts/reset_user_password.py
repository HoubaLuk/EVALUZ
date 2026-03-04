import sys
import os

# Add backend to path to import models and core
backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(backend_path)

from core.database import SessionLocal
from models.db_models import Lecturer
from core.security import get_password_hash

def reset_password(email: str, new_password: str):
    db = SessionLocal()
    try:
        user = db.query(Lecturer).filter(Lecturer.email == email).first()
        if not user:
            print(f"Error: User with email {email} not found.")
            return

        new_hash = get_password_hash(new_password)
        user.password_hash = new_hash
        db.commit()
        print(f"Success: Password for {email} has been reset.")
    except Exception as e:
        db.rollback()
        print(f"Error during password reset: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    target_email = "lukas.hribnak@pcr.cz"
    new_pw = "Nikolatkopacholatko1985"
    reset_password(target_email, new_pw)
