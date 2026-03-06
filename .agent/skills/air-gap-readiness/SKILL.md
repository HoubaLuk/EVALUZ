---
name: air-gap-readiness
description: Audit and enforce stability for offline / intranet deployments.
---

# Air-Gap & Intranet Readiness Skill

Use this skill whenever you are preparing the EVALUZ application for deployment to restricted, offline, or intranet environments where access to the internet, CDNs, or HTTPS might be limited or nonexistent.

## Core Audit Principles

### 1. Zero External Dependencies
- **Strict Rule:** NEVER use external CDNs for fonts, icons, or scripts.
- **Action:** Verify that all assets (Google Fonts, Lucide icons, etc.) are hosted locally within the project.

### 2. Environment-Aware JavaScript
- **Strict Rule:** Detect browser API availability before use (Feature Detection).
- **Action:** Check for APIs like `showDirectoryPicker`, `navigator.clipboard`, or `Web Crypto API` which are often blocked in non-secure (HTTP) intranet contexts.
- **UI Fallback:** Always provide a clear, user-friendly message explaining why a certain feature is unavailable due to "Insecure Context (HTTP)" instead of letting it fail silently.

### 3. Database Autonomy
- **Strict Rule:** The system must be "Plug & Play" on a fresh production database.
- **Action:** Ensure "Assertive Initialization" is present. The code should actively check and initialize critical default records (e.g., `Class(id=1)`) during first use to prevent `ForeignKeyViolation`.
- **Integrity:** Ensure `ondelete="CASCADE"` is set on all foreign keys to simplify production data operations.

### 4. Cross-Platform Filename Handling
- **Strict Rule:** filenames from different OS (Mac NFD vs Linux NFC) must always match.
- **Action:** Apply `.normalize('NFC')` to all filename comparisons in both Frontend (WebSockets) and Backend (API).

### 5. LLM Provider Flexibility
- **Strict Rule:** Don't break on local providers like LM Studio or Ollama.
- **Action:** Make `response_format: json_object` optional based on the detected platform.
- **Robust Cleaning:** Always use regex to trim response objects and remove "thought" markers (`<think>`) before parsing JSON.

### 6. UI Data Persistence
- **Strict Rule:** Tab switching must not clear transient user data.
- **Action:** Prefer `display: hidden/block` (persistence) over conditional `mount/unmount` for key tabs like Evaluation and Analytics.

## How to use this skill
Call this audit before finalizing any release. If a violation is found, fix it immediately to ensure a "seamless intranet transition".
