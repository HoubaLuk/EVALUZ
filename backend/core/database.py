import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models.db_models import Base

# DB configuration (SQLite locally for now)
SQLALCHEMY_DATABASE_URL = "sqlite:///./upvsp_evaluator.db"

# Setting check_same_thread=False for SQLite used in FastAPI
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    # Will create tables if they do not exist
    Base.metadata.create_all(bind=engine)
