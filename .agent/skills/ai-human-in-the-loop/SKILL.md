---
name: ai-human-in-the-loop
description: Patterns for human verification and modification of AI-generated results.
---

# AI-Human-In-The-Loop (UPVSP Standard)

Use this skill to design and audit user interfaces where humans must verify, correct, or sign off on AI-generated evaluations and reports. AI should never have the final word.

## UI Verification Patterns

### 1. The "Graduation Cap" Pattern
- **Standard:** Use a "Graduation Cap" (or similar emblem) to visually distinguish data that a human has manually edited.
- **Why:** To ensure transparency – any user can instantly tell if they see the original AI result or a lecturer-validated version.
- **Implementation:** Flip a `upraveno_lektorem` (edited by lecturer) boolean in the DB and display an icon next to the score/feedback.

### 2. Side-by-Side Comparison (Quote Visualization)
- **Standard:** Always show the source text (citation) next to the AI result.
- **Audit Tool:** Implement a "Source Modal" or "Quote View" for every AI claim (citation). 
- **Action:** Help the user verify the AI's "hallucination vs. fact" by highlighting the exact line in the report text.

### 3. Editable Canvas
- **Strict Rule:** Every AI output (total score, feedback text, individual criterion result) MUST be editable by the user.
- **Interaction:** Use inline inputs or "Apply Changes" modals to persist manual corrections.
- **Status Indicator:** Change the status icon (e.g., from orange "evaluating" to green "evaluated") only after a human has had the chance to review AND the system has saved the result.

## Data Schema for Verification

- **Audit Fields:** Include `json_result` for the original AI data and `lecturer_notes` or `manual_overrides` for human changes.
- **Timestamps:** Track `last_evaluated_at` (AI time) and `last_updated_by` (Human time).

## Workflow Logic

### 1. The Golden Example Loop (RAG)
- **Action:** provide a button to "Save as Golden Example" for exceptionally good AI/Human collaborations.
- **Benefit:** Build a treasury of manually validated reports that can improve the AI (via Few-Shot prompting or RAG) over time.

### 2. Batch Operations
- **Bulk Review:** Allow users to select multiple AI-evaluated students and "Approve Selected" in one click if they are satisfied with the results.

## How to use this skill
Audit the `TabEvaluation.tsx` or similar components. Ensure every AI-generated score is editable and visually tagged when a manual change occurs.
