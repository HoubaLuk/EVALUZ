from sqlalchemy import Column, Integer, String, Text, Float, Boolean, ForeignKey
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class SystemPrompt(Base):
    __tablename__ = "system_prompts"
    id = Column(Integer, primary_key=True, index=True)
    phase_name = Column(String, unique=True, index=True) # e.g., 'phase1', 'phase2'
    content = Column(Text)
    temperature = Column(Float, default=0.1)

class EvaluationCriteria(Base):
    __tablename__ = "evaluation_criteria"
    id = Column(Integer, primary_key=True, index=True)
    scenario_name = Column(String, unique=True, index=True) # e.g., 'MS2'
    markdown_content = Column(Text)

class ClassRoom(Base):
    __tablename__ = "classes"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

class StudentEvaluation(Base):
    __tablename__ = "student_evaluations"
    id = Column(Integer, primary_key=True, index=True)
    student_name = Column(String, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"))
    json_result = Column(Text) # Store output as JSON string
    
class AppSettings(Base):
    __tablename__ = "app_settings"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    value = Column(String)
