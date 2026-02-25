from sqlalchemy import Column, Integer, String, Text, Float, Boolean, ForeignKey
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class SystemPrompt(Base):
    __tablename__ = "system_prompts"
    id = Column(Integer, primary_key=True, index=True)
    phase_name = Column(String, unique=True, index=True) # e.g., 'phase1', 'phase2'
    content = Column(Text)
    temperature = Column(Float, default=0.1)

class Lecturer(Base):
    __tablename__ = "lecturers"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    title_before = Column(String, default="")
    first_name = Column(String, default="")
    last_name = Column(String, default="")
    title_after = Column(String, default="")
    rank_shortcut = Column(String, default="")
    rank_full = Column(String, default="")
    school_location = Column(String, default="")

class EvaluationCriteria(Base):
    __tablename__ = "evaluation_criteria"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id"))
    scenario_name = Column(String, index=True) # e.g., 'MS2'
    markdown_content = Column(Text)

class Criterion(Base):
    __tablename__ = "criteria"
    id = Column(Integer, primary_key=True, index=True)
    evaluation_criteria_id = Column(Integer, ForeignKey("evaluation_criteria.id"))
    nazev = Column(String)
    popis = Column(Text)
    body = Column(Integer)

class ClassRoom(Base):
    __tablename__ = "classes"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id"))
    name = Column(String, index=True)

class StudentEvaluation(Base):
    __tablename__ = "student_evaluations"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id"))
    student_name = Column(String, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"))
    json_result = Column(Text) # Store output as JSON string
    
class AppSettings(Base):
    __tablename__ = "app_settings"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    value = Column(String)

class ClassAnalysis(Base):
    __tablename__ = "class_analyses"
    id = Column(Integer, primary_key=True, index=True)
    scenario_id = Column(String, index=True, unique=True)
    content_json = Column(Text)
    created_at = Column(String)
