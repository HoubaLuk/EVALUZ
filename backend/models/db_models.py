from sqlalchemy import (
    Column, Integer, String, Text, Float, Boolean, ForeignKey, DateTime, UniqueConstraint,
)
from sqlalchemy.orm import declarative_base
from models.types import JSONType

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
    funkcni_zarazeni = Column(String, default="")
    is_superadmin = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    must_change_password = Column(Boolean, default=False)

class EvaluationCriteria(Base):
    __tablename__ = "evaluation_criteria"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id", ondelete="CASCADE"))
    scenario_name = Column(String, index=True) # e.g., 'MS2'
    markdown_content = Column(Text)

class Criterion(Base):
    __tablename__ = "criteria"
    id = Column(Integer, primary_key=True, index=True)
    evaluation_criteria_id = Column(Integer, ForeignKey("evaluation_criteria.id", ondelete="CASCADE"))
    nazev = Column(String)
    popis = Column(Text)
    body = Column(Integer)

class ClassRoom(Base):
    __tablename__ = "classes"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id", ondelete="CASCADE"))
    name = Column(String, index=True)

class StudentEvaluation(Base):
    __tablename__ = "student_evaluations"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id", ondelete="CASCADE"))
    student_name = Column(String, index=True)
    class_id = Column(Integer, ForeignKey("classes.id", ondelete="CASCADE"))
    scenario_name = Column(String, index=True, default="scen-1")
    scenario_display_name = Column(String, default="")  # Čitelný název scénáře, např. "MS2: Vstup do obydlí"
    json_result = Column(JSONType)
    cleaned_name = Column(String, index=True) # "Příjmení Jméno, hodnost"
    student_identity = Column(JSONType) # JSON structure from LLM
    source_text = Column(Text) # Extracted text from the original document
    source_filename = Column(String) # Original filename
    created_at = Column(DateTime)
    is_approved = Column(Boolean, default=False)
    # Auditní stopa lektorského zásahu (ADR-025). Man-in-the-Loop je pojistkou jen tehdy,
    # když po zásahu člověka zůstane stopa — jinak nelze zpětně zjistit, co řekla AI,
    # kdo to změnil, ani jak často se model s lektory rozchází.
    ai_original_json = Column(JSONType)  # Původní hodnocení AI, uloží se při PRVNÍ úpravě
    modified_at = Column(DateTime)
    modified_by = Column(Integer, ForeignKey("lecturers.id", ondelete="SET NULL"))

class AppSettings(Base):
    __tablename__ = "app_settings"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    value = Column(String)

class ClassAnalysis(Base):
    __tablename__ = "class_analyses"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id", ondelete="CASCADE"), index=True)
    class_id = Column(Integer, ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    scenario_id = Column(String, index=True) # REMOVED unique=True to allow different lecturers to have their own analysis for the same scenario
    content_json = Column(JSONType)
    created_at = Column(DateTime)
    computed_at = Column(DateTime)       # Kdy byla AI analýza naposledy vypočítána
    version = Column(Integer, default=1) # Inkrementuje se při každé regeneraci

class StudyGroup(Base):
    """„Třída" ve stromu vlevo — složka sdružující modelové situace (ADR-033).

    POZOR na jméno: tabulka `classes` (`ClassRoom`) je něco JINÉHO — analytický kbelík,
    jeden na lektora, na který se váže `class_id` u vyhodnocení. V českém UI se obojímu
    říká „třída", v kódu se to nesmí plést. Proto `study_groups`.
    """
    __tablename__ = "study_groups"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id", ondelete="CASCADE"), index=True)
    name = Column(String, default="")
    position = Column(Integer, default=0)
    created_at = Column(DateTime)


class Scenario(Base):
    """Modelová situace jako DATA, ne jako položka stromu v prohlížeči (ADR-033).

    Dřív situace nikde neexistovala: `scenario_id` se generovalo na klientovi
    (`scen-${Date.now()}`) a jediným záznamem o tom, že situace vůbec je, byl strom
    v `localStorage`, později JSON blob v `lecturer_workspaces` (ADR-031). Kritéria
    a vyhodnocení se na klíč jen odkazovaly — takže když se strom ztratil nebo přepsal,
    data v DB zůstala, ale nevedla k nim žádná cesta.

    `scenario_key` odpovídá `scenario_name` v `evaluation_criteria` i `student_evaluations`
    (backend se na něj váže na desítkách míst, ta vazba se nemění). U nově založených situací
    ho generuje SERVER, takže kolize mezi klienty nemůže vzniknout ani teoreticky.

    Unikátní je ale jen **v rámci lektora**, ne globálně. Historické klíče vznikaly na
    klientovi z pevné výchozí šablony (`scen-1`, `scen-2`), takže je má v datech každý lektor,
    který kdy něco vyhodnotil. Globální UNIQUE by migraci na takových datech shodil — a shodil
    ji (v3.17.0). Sémanticky je per-lektor správně i bez té historie: ke klíči se přistupuje
    vždy přes `apply_data_isolation`, nikdy napříč lektory.
    """
    __tablename__ = "scenarios"
    __table_args__ = (
        UniqueConstraint("lecturer_id", "scenario_key", name="uq_scenarios_lecturer_key"),
    )
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id", ondelete="CASCADE"), index=True)
    group_id = Column(Integer, ForeignKey("study_groups.id", ondelete="CASCADE"), index=True)
    scenario_key = Column(String, index=True)
    display_name = Column(String, default="")
    position = Column(Integer, default=0)
    created_at = Column(DateTime)


class ExportHistory(Base):
    __tablename__ = "export_history"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("lecturers.id", ondelete="CASCADE"), index=True)
    scenario_name = Column(String)
    type = Column(String)
    download_url = Column(String)
    created_at = Column(DateTime, index=True)

class GoldenExample(Base):
    __tablename__ = "golden_examples"
    id = Column(Integer, primary_key=True, index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id", ondelete="CASCADE"), index=True)
    scenario_id = Column(String, index=True)
    source_text = Column(Text)
    perfect_json = Column(JSONType)
    created_at = Column(DateTime)

