"""
MODUL: ANALYTIKA TŘÍDY (ANALYTICS SERVICE)
Tento modul má dva hlavní úkoly:
1. EXAKTNÍ STATISTIKA: Matematicky spočítat úspěšnost třídy v jednotlivých kritériích (heatmapy, grafy).
2. AI INSIGHT (Fáze 3): Předat tato tvrdá data AI modelu, aby je interpretoval a dal lektorovi pedagogické rady.
"""

from sqlalchemy.orm import Session
import json
from models.db_models import SystemPrompt, EvaluationCriteria, StudentEvaluation, ClassAnalysis
from services.llm_engine import chat_completion

async def generate_class_summary(class_id: int, scenario_id: str, force: bool, db: Session) -> dict:
    """
    HLAVNÍ FUNKCE ANALÝZY.
    Agreguje data z hodnocení všech studentů v dané třídě a modelové situaci.
    """
    
    # 1. CACHE: Pokud už analýza existuje a uživatel si nevynutil novou (force=True), vrátíme tu uloženou.
    if not force:
        cached_analysis = db.query(ClassAnalysis).filter(ClassAnalysis.scenario_id == scenario_id).first()
        if cached_analysis:
            try:
                return json.loads(cached_analysis.content_json)
            except Exception:
                pass
                
    # Načteme všechna vyhodnocení pro tuto třídu a situaci.
    raw_evals = db.query(StudentEvaluation).filter(
        StudentEvaluation.class_id == class_id,
        StudentEvaluation.scenario_name == scenario_id
    ).all()
    
    # Odfiltrujeme záznamy, které ještě nejsou vyhodnocené (nemají json_result).
    evaluations = []
    for e in raw_evals:
        try:
            data = json.loads(e.json_result) if e.json_result else {}
            if data and data.get("vysledky"):
                evaluations.append(e)
        except:
            pass
    
    # Získání definic kritérií z DB, abychom věděli, co přesně jsme měli hodnotit.
    criteria_record = db.query(EvaluationCriteria).filter(EvaluationCriteria.scenario_name == scenario_id).first()
    db_criteria = []
    if criteria_record:
        from models.db_models import Criterion
        db_criteria = db.query(Criterion).filter(Criterion.evaluation_criteria_id == criteria_record.id).all()

    # Fallback: Pokud v DB definice kritérií chybí, pokusíme se je odvodit z již hotových výsledků.
    if not db_criteria and evaluations:
        class PseudoCriterion:
            def __init__(self, nazev, body):
                self.nazev = nazev
                self.body = body
                
        # Fallback: extraction of unique criteria and their max points from evaluations json
        crit_maxes = {}
        for eval_record in evaluations:
            try:
                data = json.loads(eval_record.json_result)
                for crit in data.get("vysledky", []):
                    name = crit.get("nazev", "Neznámé")
                    pts = crit.get("body", 0)
                    # Use max points encountered, assume 1 as baseline if failed
                    if name not in crit_maxes:
                        crit_maxes[name] = pts if pts > 0 else 1
                    elif pts > crit_maxes[name]:
                        crit_maxes[name] = pts
            except Exception:
                continue
                
        for name, max_pts in crit_maxes.items():
            db_criteria.append(PseudoCriterion(name, max_pts))

    # Žádná data -> vrátíme prázdnou strukturu.
    if not evaluations or not db_criteria:
        max_possible_sc = sum([c.body for c in db_criteria]) if db_criteria else 0
        return {
            "stats": [],
            "top_errors": [],
            "ai_insight": "Není dostatek dat pro analýzu. Zatím nebyla vyhodnocena žádná modelová situace nebo chybí kritéria.",
            "score_distribution": {"0_50": 0, "51_80": 0, "81_100": 0},
            "average_score": 0,
            "max_score": max_possible_sc,
            "needs_help": [],
            "criterion_failures": {}
        }
        
    total_students = len(evaluations)
    
    # --- A. DETERMINISTICKÁ AGREGACE (Tvrdá matematika) ---
    criteria_totals = {}
    criterion_failures = {}
    for c in db_criteria:
        criteria_totals[c.nazev] = {
            "short_name": c.nazev[:20] + "..." if len(c.nazev) > 20 else c.nazev,
            "passes": 0,
            "total_pts": 0,
            "max_pts": c.body
        }
        criterion_failures[c.nazev] = []
        
    student_scores = []
    
    # Procházíme JSON výsledek každého studenta a sčítáme úspěšnost per kritérium.
    for eval_record in evaluations:
        try:
            data = json.loads(eval_record.json_result)
            total_score = data.get("celkove_skore", 0)
            student_scores.append(total_score)
            
            for criteria in data.get("vysledky", []):
                name = criteria.get("nazev", "Neznámé")
                # Párování názvu kritéria z AI (může se mírně lišit) s verzí v DB.
                matched_key = None
                for c_name in criteria_totals.keys():
                    if c_name.lower().strip() == name.lower().strip():
                        matched_key = c_name
                        break
                if not matched_key: # Fallback - částečná shoda
                    for c_name in criteria_totals.keys():
                        if c_name.lower() in name.lower() or name.lower() in c_name.lower():
                            matched_key = c_name
                            break
                            
                if matched_key:
                    is_met = criteria.get("splneno", False)
                    bod_award = criteria.get("body", 0)
                    
                    if is_met:
                        criteria_totals[matched_key]["passes"] += 1
                    else:
                        # Pokud student kritérium nesplnil, uložíme si jeho jméno a důvod pro detailní náhled v analýze.
                        criterion_failures[matched_key].append({
                            "id": eval_record.id,
                            "name": eval_record.cleaned_name if eval_record.cleaned_name else eval_record.student_name.replace(',', ''),
                            "oduvodneni": criteria.get("oduvodneni", "")
                        })
                    criteria_totals[matched_key]["total_pts"] += bod_award
                
        except Exception as e:
            print(f"Error parsing evaluation {eval_record.id}: {e}")
            continue
            
    # Výpočet finálních procentuálních úspěšností.
    stats = []
    error_rates = []
    for criterion, counts in criteria_totals.items():
        success_rate = round((counts["passes"] / total_students) * 100) if total_students > 0 else 0
        stats.append({
            "name": counts["short_name"],
            "full_name": criterion,
            "success_rate": success_rate,
            "avg_score": round(counts["total_pts"] / total_students, 1) if total_students > 0 else 0
        })
        error_rates.append({
            "name": criterion,
            "error_rate": 100 - success_rate
        })
        
    # Seřazení největších chyb (kritéria, kde třída nejvíc "hoří").
    sorted_errors = sorted(error_rates, key=lambda x: x["error_rate"], reverse=True)
    top_errors = [e["name"] for e in sorted_errors[:3] if e["error_rate"] > 0]
    
    # Distribuce skóre (kolik studentů je pod 50 %, kolik v elitě atd.).
    max_possible_sc = sum([c.body for c in db_criteria])
    if max_possible_sc == 0: max_possible_sc = 1
    
    dist = {"0_50": 0, "51_80": 0, "81_100": 0}
    needs_help = []
    
    for score in student_scores:
        percent = (score / max_possible_sc) * 100
        if percent < 50:
            dist["0_50"] += 1
        elif percent <= 80:
            dist["51_80"] += 1
        else:
            dist["81_100"] += 1

    # Seznam studentů, kteří potřebují doučování (úspěšnost pod 50 %).
    for eval_record in evaluations:
        try:
            data = json.loads(eval_record.json_result)
            percent = (data.get("celkove_skore", 0) / max_possible_sc) * 100
            if percent < 50:
                needs_help.append((eval_record.cleaned_name if eval_record.cleaned_name else eval_record.student_name).replace(',', ''))
        except Exception:
            pass

    # --- 2. Request AI Insight via vLLM ---
    average_score = round(sum(student_scores) / total_students, 1) if total_students > 0 else 0
    
    # Fetch phase 3 prompt
    prompt_record = db.query(SystemPrompt).filter(SystemPrompt.phase_name == "prompt3").first()
    db_system_prompt = prompt_record.content if prompt_record else "Zhodnoť trendy třídy na základě dodaných a pevně vypočtených přesných statistik."
    temperature = prompt_record.temperature if prompt_record else 0.7
    
    system_prompt = f"{db_system_prompt}\n\nDŮLEŽITÉ POKYNY:\nTvá role je OMEZENA POUZE NA PEDAGOGICKOU INTERPRETACI.\nNic nepočítej! Procenta jsou již deterministicky vypočtena a jsou nezpochybnitelná.\nNIKDY nepoužívej Markdown tabulky (v PDF se rozpadají).\nStrukturu tvoř výhradně pomocí nadpisů třetí úrovně (### Celkové zhodnocení, ### Nejčastější chyby, ### Pedagogická doporučení)."
    
    # Build payload string for LLM se VŠEMI daty, na které nesmí LLM sahat, jen je interpretovat
    criteria_text = criteria_record.markdown_content if criteria_record else "Nezadána kritéria."
    data_payload = f"EXAKTNÍ STATISTIKY (N={total_students} studentů):\n"
    for s in stats:
        data_payload += f"- Kritérium: '{s['full_name']}' -> Jistá úspěšnost: {s['success_rate']}%\n"
        
    data_payload += f"\nNejčastější problémové body napříč třídou: {', '.join(top_errors) if top_errors else 'Vše skvělé'}"
    data_payload += f"\nCelkový průměrný počet bodů: {average_score} z max {max_possible_sc}"
    data_payload += f"\n\nProsím o sepsání pedagogického shrnutí na základě TĚCHTO přesných čísel. K textu připoj metodiku pro kontext, jak kritéria vypadala:\n{criteria_text}"
    
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
        "max_score": max_possible_sc,
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
