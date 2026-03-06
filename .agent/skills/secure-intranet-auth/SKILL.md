---
name: secure-intranet-auth
description: Standards and patterns for secure local-only and intranet user management.
---

# Secure Intranet Authentication (UPVSP Standard)

Use this skill to implement and audit authentication and authorization in intranet projects. Security must be "by design" even if the application is not accessible from the public internet.

## Authentication Framework

### 1. Bearer Token (JWT)
- **Standard:** Every API endpoint (except `/login` and `/auth/check`) must require a valid JWT `Authorization: Bearer <token>` header.
- **Header Structure:** Use standard `HTTPBearer` in FastAPI or equivalent.
- **Expiration:** Set sane expiration times (e.g., 8–24 hours) for intranet sessions.

### 2. Password Policies
- **Mandatory Change:** Applications must support a `must_change_password` flag for first-time login or administrative resets.
- **Validation:** Minimum 12 characters, mix of types (Uppercase, Lowercase, Numbers, Symbols).
- **Storage:** NEVER store passwords as plain text. Use `bcrypt` or `argon2` hashing.

## Authorization & Roles

### 1. Hierarchical Access (SuperAdmin Pattern)
- **Rule:** Only users with `is_superadmin=true` (e.g., identity #1) can access system-wide settings, LLM configuration, and user creation.
- **Lecturer Role:** Standard users can only manage their own classes, evaluations, and profile.

### 2. The Setup Mode (RECOGNIZED_EMPTY_DB)
- **Rule:** When the database is fresh, the application should detect "no users" and enter a secure "Setup Mode".
- **Action:** The first person to visit the app becomes the SuperAdmin during this phase. This prevents rogue users from taking over if the app is deployed before the admin arrives.

## Secure Intranet Patterns

### 1. Environment Variable Hygiene
- **Rule:** API keys, database URLs, and JWT secrets must reside in `.env` (development) or system environment variables (production).
- **Git Ignore:** Ensure `.env` is always in `.gitignore`. Provide a `.env.example` file.

### 2. Audit Logging
- **Action:** Log failed login attempts with IP address and timestamp.
- **Production Logs:** Ensure sensitive data (like the password itself) is never logged, even in debug mode.

## How to use this skill
Audit the `auth.py` and `db_models.py` modules. If roles or password policies are missing or weak, implement the "SuperAdmin Pattern" and "Mandatory Change" logic immediately.
