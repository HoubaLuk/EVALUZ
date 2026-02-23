from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any
import json

from core.database import get_db
from models.db_models import StudentEvaluation
from models.evaluation import EvaluationResponse
from services.analytics import generate_class_summary

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"]
)

@router.get("/class/{class_id}", response_model=List[EvaluationResponse])
def get_class_evaluations(class_id: int, db: Session = Depends(get_db)):
    """
    Retrieves all stored evaluations for a specific class ID.
    Parses the JSON strings from the DB and returns them as structured Pydantic models.
    """
    evaluations = db.query(StudentEvaluation).filter(StudentEvaluation.class_id == class_id).all()
    
    results = []
    for eval_record in evaluations:
        try:
            # Reconstruct the dict from stored JSON so it matches EvaluationResponse
            data = json.loads(eval_record.json_result)
            # Make sure we inject the student_name into the payload just like the frontend expects it
            data["jmeno_studenta"] = eval_record.student_name
            results.append(EvaluationResponse(**data))
        except Exception as e:
            print(f"Error parsing json for evaluation {eval_record.id}: {e}")
            # Skip invalid records
            continue
            
    return results

@router.get("/class/{class_id}/summary")
def get_class_summary(class_id: int, db: Session = Depends(get_db)):
    """
    Computes aggregated stats from student evaluations and requests
    an AI pedagogical insight from the vLLM engine based on Phase 3 prompt
    and context.
    """
    return generate_class_summary(class_id, db)
