---
name: data-integrity-guardian
description: Database integrity and migration standards for robust intranet deployments.
---

# Data Integrity Guardian (UPVSP Standard)

Use this skill to design and audit database models and migration logic to prevent data loss, `ForeignKeyViolation` errors, and orphaned records in production.

## Structural Integrity

### 1. The Cascade Rule
- **Standard:** Use `ondelete="CASCADE"` for every `ForeignKey` that has a strict parent-child relationship (e.g., `Lecturer` -> `Class` -> `Evaluation`).
- **Why:** In production, clearing test data or deleting a lecturer must not leave orphaned records that break consistency.

### 2. Relationship Definition
- **Standard:** Define both sides of the relationship in SQLAlchemy (`relationship(..., back_populates=...)`).
- **Consistency:** Use clear, descriptive names for relationships (e.g., `evaluations` instead of `children`).

## Runtime Stability (The "Plug & Play" Pattern)

### 1. Assertive Initialization
- **Strict Rule:** NEVER assume the database is pre-populated with default IDs.
- **Action:** Before any critical write operation (e.g., saving an evaluation), check if the target parent record (e.g., `Class(id=1)`) exists. If it doesn't, initialize it "on-the-fly".
- **Benefit:** Eliminates 90% of `ForeignKeyViolation` errors in fresh intranet deployments.

### 2. Migration Awareness
- **Logic:** Always provide a migration script (`migrate_to_postgres.py`) or use Alembic if the project is large.
- **Fallbacks:** In small projects, auto-create tables on startup (`Base.metadata.create_all(bind=engine)`).

## Data Quality & Cleanup

### 1. Duplicate Prevention
- **Constraint:** Use `UniqueConstraint` on logical keys (e.g., `student_name` + `scenario_id` + `lecturer_id`).
- **Upsert Logic:** Implement "Check-before-Insert" or "Update-on-Conflict" logic to prevent duplicate evaluation records.

### 2. Unicode Normalization
- **Strict Rule:** All string keys (usernames, filenames) MUST be normalized (NFC) before database queries.
- **Why:** Prevents "ghost duplicates" caused by different OS encodings (Mac NFD vs Linux NFC).

## How to use this skill
Audit the `db_models.py` and API endpoints. Ensure every ForeignKey has a cascade delete and every write operation includes assertive initialization for default values.
