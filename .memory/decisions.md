# Architectural Decisions Log

## 2026-03-17: vLLM Integration & Batch UI Stability

**Status:** Decided & Implemented
**Context:** After switching to vLLM, the backend failed due to missing database queries for inference parameters (`top_p`, penalties). This caused the Fast-Scan (identity extraction) to crash, leading to unsaved student records that disappeared on navigation. UI feedback was too optimistic, reporting success despite background errors.

**Decisions:**
1. **Explicit Parameter Fetching:** All LLM engine calls (`evaluate_report`, `extract_identity`) must now explicitly query `AppSettings` for all relevant inference parameters from the DB to ensure consistency and avoid `NameError`.
2. **Frontend Error Tracking:** The `TabEvaluation` component now implements an `errorCount` state that is incremented via WebSocket `EVAL_ERROR` events.
3. **Conditional Feedback:** completion toast messages must distinguish between 100% success and partial failures.
4. **NFC Normalization enforcement:** Re-verified that all filename comparisons are normalized to NFC to prevent "ghost" records in the UI Roster.

**Impact:**
- Full persistence of newly uploaded records (Fixes "disappearing records" issue).
- Reliable evaluation tracking for lecturers on intranet servers.
- Compatible with vLLM, LM Studio, and Ollama providers.

## 2026-03-17: LLM Parameter Enforcement (v3.2.1)

**Status:** Decided & Implemented
**Context:** vLLM inference servers often have a hard-coded context limit (e.g., 16384 tokens). EVALUZ was previously hard-coding `max_tokens: 16384` for the completion, which, when added to large inputs (11k+ tokens), exceeded the server's capacity even if the model itself supported larger contexts.

**Decisions:**
1. **Dynamic Token Management:** The `max_tokens` parameter for LLM calls is now dynamically fetched from the database (`VLLM_MAX_TOKENS`). This ensures users can tune the "reservation" for output to fit within the server's context window.
2. **Key Deduplication:** Fixed a bug in `llm_engine.py` where `max_tokens` was provided twice in the `kwargs` dictionary, ensuring clean API requests.
3. **Admin Consistency:** The `evaluate_report` function now correctly uses the database setting instead of bypassing it, restoring control to the Lecturers via the Administration panel.

**Impact:**
- Resolved "Error 400 - Context Length Exceeded" for large evaluation tasks.
- Improved reliability on resource-constrained vLLM deployments.
- Restored integrity between UI settings and backend execution.
