---
name: branding-upvsp
description: Human-centered design system and visual identity for UPVSP projects.
---

# Branding & UI Design (UPVSP Standard)

Use this skill to ensure all applications have a professional, consistent, and mission-aligned visual identity. All interfaces must feel premium, authoritative, and perfectly legible in all lighting conditions.

## Core Design Tokens

### 1. Colors (The Policie Palette)
- **Primary Navy:** `#002855` (Authority, trust, police core). Use for headers, primary buttons, and navigation.
- **Accent Gold/Yellow:** `#FACC15` (Attention, prestige, department logo matching). Use for status icons, progress bars, and high-impact titles.
- **Pure White/Slate-50:** Use for main application backgrounds to provide a clean, academic feel.
- **Success/Warning/Error:** 
    - Emerald-600 (`#10B981`) for completed AI tasks.
    - Amber-500 (`#F59E0B`) for evaluating/pending tasks.
    - Rose-600 (`#E11D48`) for errors/not processed.

### 2. Typography
- **Primary Sans:** Inter, Roboto, or Outfit (Google Fonts).
- **Secondary Sans:** System-ui fallback.
- **Hierarchy:** 
    - Display-3xl for Main Screen headers.
    - Semi-bold/Bold for criterion names to ensure readability.

## UI Layout Standards

### Header Design (The EVALUZ Pattern)
- **Height:** `h-24` (provides breathing space for large screens).
- **Branding:** Left-aligned Department Logo + Name.
- **Versioning:** Small text below the name (e.g., `v3.1.1`).
- **Legal/Origin:** Information about internal development (e.g., "Vytvořeno interně na ÚPVSP").
- **Personalized Messaging:** Small italicized internal messages can be placed in bottom-right (e.g., team slogans).

### Dark Mode (Critical Readiness)
- **Rule 1:** NEVER use pure black (`#000000`). Use Slate-900 (`#0F172A`) or Slate-800 for the main background.
- **Rule 2:** Flip Navy backgrounds to Slate-800 with subtle borders (`border-slate-700`).
- **Rule 3:** Ensure Gold/Yellow accents remain high-contrast (AA standard) against dark backgrounds.
- **Logic:** Add `dark:` variant to every Tailwind class. Use system-preference detection (`prefers-color-scheme`).

## Component Guidelines

- **Buttons:**
    - Primary: Navy background, white text.
    - Actionable (Admin): Specific blue (`#002855` or slightly lighter) to distinguish management from operation.
    - Hover states: Subtle scaling or color darkening (`hover:bg-[#001f44]`).
- **Cards/Containers:**
    - Use `rounded-xl` for modern, premium look.
    - Subtle `shadow-sm` or `shadow-lg` for elevation.
- **Modals:**
    - Centralized overlay with `bg-black/50` or `backdrop-blur-sm`.
    - Clear "X" or "Close" button.

## How to use this skill
Call this audit before any UI-related commit to ensure the "UPVSP Look & Feel" is maintained. If colors or layout drift from these tokens, correct them immediately.
