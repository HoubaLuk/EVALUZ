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
    if len(sys.argv) < 3:
        print("Usage: python reset_user_password.py <email> <new_password>")
        sys.exit(1)
    
    target_email = sys.argv[1]
    new_pw = sys.argv[2]
    reset_password(target_email, new_pw)
