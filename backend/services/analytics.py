from sqlalchemy.orm import Session
import json
from models.db_models import SystemPrompt, EvaluationCriteria, StudentEvaluation
from services.llm_engine import chat_completion

def generate_class_summary(class_id: int, db: Session) -> dict:
    """
    Agreguje data z hodnocení třídy, vypočítá statistiky pro frontend a zavolá 
    lokální vLLM pro vytvoření pedagogického shrnutí/insightu na základě Fáze 3 promptu.
    """
    evaluations = db.query(StudentEvaluation).filter(StudentEvaluation.class_id == class_id).all()
    
    if not evaluations:
        return {
            "stats": [],
            "top_errors": [],
            "ai_insight": "Není dostatek dat pro analýzu. Zatím nebyla vyhodnocena žádná modelová situace.",
            "score_distribution": {"0_50": 0, "51_80": 0, "81_100": 0}
        }
        
    # --- 1. Aggregation of frontend chart stats ---
    criteria_totals = {}
    criteria_counts = {}
    student_scores = []
    
    for eval_record in evaluations:
        try:
            data = json.loads(eval_record.json_result)
            total_score = data.get("celkove_skore", 0)
            student_scores.append(total_score)
            
            for criteria in data.get("vysledky", []):
                name = criteria.get("nazev", "Neznámé")
                # Truncate long names for chart labels
                short_name = name[:20] + "..." if len(name) > 20 else name
                is_met = criteria.get("splneno", False)
                bod_award = criteria.get("body", 0)
                
                if name not in criteria_totals:
                    criteria_totals[name] = {"short_name": short_name, "passes": 0, "total": 0, "total_pts": 0}
                    
                criteria_totals[name]["total"] += 1
                if is_met:
                    criteria_totals[name]["passes"] += 1
                criteria_totals[name]["total_pts"] += bod_award
                
        except Exception:
            continue
            
    # Calculate percentages
    stats = []
    error_rates = []
    for criterion, counts in criteria_totals.items():
        success_rate = round((counts["passes"] / counts["total"]) * 100) if counts["total"] > 0 else 0
        stats.append({
            "name": counts["short_name"],
            "full_name": criterion,
            "success_rate": success_rate,
            "avg_score": round(counts["total_pts"] / counts["total"], 1) if counts["total"] > 0 else 0
        })
        error_rates.append({
            "name": criterion,
            "error_rate": 100 - success_rate
        })
        
    # Top Errors
    sorted_errors = sorted(error_rates, key=lambda x: x["error_rate"], reverse=True)
    top_errors = [e["name"] for e in sorted_errors[:3] if e["error_rate"] > 0]
    
    # Score distribution for pie chart (assuming max is 25 based on mockup, ideally should be dynamic)
    # We will compute percentage using the max score found or default 25
    max_score = max(student_scores) if student_scores and max(student_scores) > 0 else 25
    dist = {"0_50": 0, "51_80": 0, "81_100": 0}
    for score in student_scores:
        percent = (score / max_score) * 100
        if percent <= 50:
            dist["0_50"] += 1
        elif percent <= 80:
            dist["51_80"] += 1
        else:
            dist["81_100"] += 1

    # --- 2. Request AI Insight via vLLM ---
    # Fetch phase 3 prompt
    prompt_record = db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt3").first()
    system_prompt = prompt_record.content if prompt_record else "Jsi analytik ÚZ. Zhodnoť trendy třídy."
    temperature = prompt_record.temperature if prompt_record else 0.7
    
    # Fetch criteria for MS2 to give the LLM exact context
    criteria_record = db.query(EvaluationCriteria).filter(EvaluationCriteria.scenario_name == "MS2").first()
    criteria_text = criteria_record.markdown_content if criteria_record else "Nezadána kritéria."
    
    # Build payload string for LLM
    data_payload = "Data o úspěšnosti třídy v jednotlivých kritériích:\n"
    for s in stats:
        data_payload += f"- Kritérium: '{s['full_name']}' -> Úspěšnost: {s['success_rate']}%\n"
        
    data_payload += f"\nNejčastější problémové body: {', '.join(top_errors) if top_errors else 'Žádné výrazné chyby'}"
    data_payload += f"\n\nKontext (původní zadání a metodika kritérií, podle kterých se bodovalo):\n{criteria_text}"
    
    messages = [
        {"role": "user", "content": data_payload}
    ]
    
    try:
        ai_insight = chat_completion(
            messages=messages,
            system_prompt=system_prompt,
            temperature=temperature,
            db=db
        )
    except Exception as e:
        print(f"Failed to generate insight: {e}")
        ai_insight = "Nepodařilo se spojit s asistentem pro vygenerování analýzy. Zkontrolujte připojení k vLLM."

    return {
        "stats": stats,
        "top_errors": top_errors,
        "ai_insight": ai_insight,
        "score_distribution": dist
    }
