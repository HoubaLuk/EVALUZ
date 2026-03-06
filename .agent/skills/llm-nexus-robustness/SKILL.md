---
name: llm-nexus-robustness
description: Strategy for resilient and flexible Large Language Model (LLM) integrations in intranet and local environments.
---

# LLM Nexus Robustness (UPVSP Standard)

Use this skill to ensure LLM connections are stable across various environments (Online, Intranet, Offline) and compatible with multiple providers (vLLM, LM Studio, Ollama, OpenRouter).

## Provider Adaptivity

### 1. The Local Provider Paradox
- **Rule:** Never force `response_format: json_object` for local providers unless verified.
- **Action:** detect `platform` (e.g., `lmstudio`, `ollama`) and make JSON mode optional.
- **Why:** Some versions of LM Studio return 400 Errors if `response_format` is provided but not fully compliant.

### 2. Parameter Normalization
- **Strict Rule:** Always map parameters like `top_p`, `presence_penalty`, and `frequency_penalty` to the standard OpenAI API specification.
- **Defaulting:** Use sane defaults for analytical tasks (e.g., `temperature=0.0` or `0.1`) to ensure consistency in reports.

### 3. vLLM & Advanced Features
- **Thinking Mode:** Safely send `extra_body` for reasoning models (e.g., Qwen, DeepSeek) to enable thinking without breaking other providers.
- **Template Kwargs:** Support `chat_template_kwargs` if the provider supports them.

## Parsing & Cleaning (LLM "Sanitizer")

### 1. The Regex Wall
- **Rule:** NEVER trust the raw LLM output. Always clean it before parsing.
- **Thought Markers:** Automatically remove reasoning blocks (e.g., `<think>`, `<thought>`, `[thought]`).
- **Markdown Stripping:** Remove triple backticks (```json ... ```) or other preamble text.

### 2. The JSON Extractor
- **Logic:** Find the first `{` and last `}` in the cleaned text. Extract only the portion between them.
- **Why:** Models often add "Here is the JSON object you requested:" which breaks standard parsiers.

## Backend Service Structure

### 1. Logging and Prefixing
- **Strict Rule:** Every LLM call must be logged with a unique `prefix` (e.g., student name, report ID).
- **Why:** Essential for debugging "silent failures" in the intranet where you can't access model server logs directly.

### 2. Asynchronous Workers
- **Queueing:** Use an `asyncio.Queue` (EvaluationQueue) to ensure the backend never blocks during long LLM sessions.
- **Semaphore:** Use an `asyncio.Semaphore(1)` to limit concurrent AI calls and prevent GPU memory exhaustion on local servers.

## How to use this skill
Audit the `llm_engine.py` or equivalent services before and after any modification. Ensure every call uses the "Sanitizer" and follows the "Provider Adaptivity" logic.
