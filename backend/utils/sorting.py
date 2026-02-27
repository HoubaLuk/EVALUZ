import json

def get_surname_from_evaluation(eval_record) -> str:
    """
    Extracts the surname from the evaluation record to be used for sorting.
    Handles StudentEvaluation objects and dictionaries (e.g. from frontend Data).
    """
    # If it's a dictionary
    if isinstance(eval_record, dict):
        identita = eval_record.get('identita') or {}
        if identita.get('prijmeni'):
            return identita.get('prijmeni').upper()
            
        cleaned_name = eval_record.get('cleaned_name') or eval_record.get('cleanedName')
        if cleaned_name:
            parts = cleaned_name.split()
            if parts:
                return parts[0].upper()
                
        name = eval_record.get('jmeno_studenta') or eval_record.get('name')
        return str(name).upper() if name else ""

    # If it's an SQLAlchemy object
    if hasattr(eval_record, 'student_identity') and eval_record.student_identity:
        try:
            identita = json.loads(eval_record.student_identity)
            if identita.get('prijmeni'):
                return identita.get('prijmeni').upper()
        except Exception:
            pass
            
    # Fallback to cleaned_name
    if hasattr(eval_record, 'cleaned_name') and eval_record.cleaned_name:
        parts = eval_record.cleaned_name.split()
        if parts:
            return parts[0].upper()
            
    # Fallback to student_name
    if hasattr(eval_record, 'student_name') and eval_record.student_name:
        return eval_record.student_name.upper()
        
    return ""

def sort_evaluations_by_surname(evaluations: list) -> list:
    """
    Sorts a list of evaluation records alphabetically by student surname.
    """
    return sorted(evaluations, key=get_surname_from_evaluation)
