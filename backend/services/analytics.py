from sqlalchemy.orm import Session
import json
from models.db_models import SystemPrompt, EvaluationCriteria, StudentEvaluation, ClassAnalysis
from services.llm_engine import chat_completion

def generate_class_summary_sync(class_id: int, db: Session) -> dict:
    pass

async def generate_class_summary(class_id: int, scenario_id: str, force: bool, db: Session) -> dict:
    """
    Agreguje data z hodnocení třídy, vypočítá statistiky pro frontend a zavolá 
    lokální vLLM pro vytvoření pedagogického shrnutí/insightu na základě Fáze 3 promptu.
    """
    if not force:
        cached_analysis = db.query(ClassAnalysis).filter(ClassAnalysis.scenario_id == scenario_id).first()
        if cached_analysis:
            try:
                return json.loads(cached_analysis.content_json)
            except Exception:
                pass
                
    evaluations = db.query(StudentEvaluation).filter(StudentEvaluation.class_id == class_id).all()
    
    if not evaluations:
        return {
            "stats": [],
            "top_errors": [],
            "ai_insight": "Není dostatek dat pro analýzu. Zatím nebyla vyhodnocena žádná modelová situace.",
            "score_distribution": {"0_50": 0, "51_80": 0, "81_100": 0},
            "average_score": 0,
            "needs_help": [],
            "criterion_failures": {}
        }
        
    # --- 1. Aggregation of frontend chart stats ---
    criteria_totals = {}
    criteria_counts = {}
    student_scores = []
    criterion_failures = {}
    
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
                    criterion_failures[name] = []
                    
                criteria_totals[name]["total"] += 1
                if is_met:
                    criteria_totals[name]["passes"] += 1
                else:
                    criterion_failures[name].append({
                        "id": eval_record.id,
                        "name": eval_record.student_name.replace(',', ''),
                        "oduvodneni": criteria.get("oduvodneni", "")
                    })
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
    needs_help = []
    
    # Needs help threshold = < 50%
    for eval_record in evaluations:
        try:
            data = json.loads(eval_record.json_result)
            total = data.get("celkove_skore", 0)
            percent = (total / max_score) * 100
            if percent < 50:
                needs_help.append(eval_record.student_name.replace(',', ''))
        except Exception:
            pass

    for score in student_scores:
        percent = (score / max_score) * 100
        if percent <= 50:
            dist["0_50"] += 1
        elif percent <= 80:
            dist["51_80"] += 1
        else:
            dist["81_100"] += 1

    # --- 2. Request AI Insight via vLLM ---
    # Overall class average score
    average_score = round(sum(student_scores) / len(student_scores), 1) if student_scores else 0

    # Fetch phase 3 prompt
    prompt_record = db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt3").first()
    db_system_prompt = prompt_record.content if prompt_record else "Jsi analytik ÚZ. Zhodnoť trendy třídy."
    temperature = prompt_record.temperature if prompt_record else 0.7
    
    # Přidání tvrdých formátovacích pravidel proti markdown tabulkám a pro vizuální oddělení
    system_prompt = f"{db_system_prompt}\n\nDŮLEŽITÉ POKYNY K FORMÁTOVÁNÍ:\n1. NIKDY nepoužívej Markdown tabulky (v PDF se rozpadají).\n2. Strukturu tvoř výhradně pomocí nadpisů třetí úrovně (### Celkové zhodnocení, ### Nejčastější chyby, ### Pedagogická doporučení), tučného písma (**text**) a standardních odrážek (- text). Každou logickou sekci MUSÍ oddělovat nadpis ###."
    
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
        from services.llm_engine import chat_completion
        ai_insight = await chat_completion(
            messages=messages,
            system_prompt=system_prompt,
            temperature=temperature,
            db=db
        )
    except Exception as e:
        print(f"Failed to generate insight: {e}")
        ai_insight = "Nepodařilo se spojit s asistentem pro vygenerování analýzy. Zkontrolujte připojení k vLLM."

    res = {
        "scenario_id": str(scenario_id),
        "stats": stats,
        "top_errors": top_errors,
        "ai_insight": ai_insight,
        "score_distribution": dist,
        "average_score": average_score,
        "needs_help": needs_help,
        "criterion_failures": criterion_failures
    }

    import datetime
    cached_analysis = db.query(ClassAnalysis).filter(ClassAnalysis.scenario_id == scenario_id).first()
    if not cached_analysis:
        cached_analysis = ClassAnalysis(scenario_id=scenario_id)
        db.add(cached_analysis)
    
    cached_analysis.content_json = json.dumps(res, ensure_ascii=False)
    cached_analysis.created_at = datetime.datetime.now().isoformat()
    db.commit()

    return res
