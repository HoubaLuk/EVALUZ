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
