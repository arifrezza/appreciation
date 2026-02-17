# Plan: Context-Aware AI Suggestion That Satisfies All Remaining Criteria

## Problem

When 3+ criteria pass, `rewriteWithAI()` fires but uses a **generic** prompt ("improve clarity, professionalism, and structure"). It has **no knowledge** of which criteria are still failing. So the AI suggestion often doesn't satisfy the remaining criteria — the user clicks "Use Suggestion Text" and still sees red ticks.

## Root Cause

The rewrite endpoint (`/api/rewrite-appreciation`) only receives `{ text }`. The backend `AppreciationRewriteService` prompt never mentions the 4 quality criteria. It simply polishes the text generically.

## Solution

Pass the **failing criteria names** from the frontend to the backend so the OpenAI rewrite prompt can specifically target them.

## Changes (4 files)

### 1. Frontend: `language.service.ts`
- Update `rewriteAppreciation(text, failingCriteria)` to accept a `string[]` of failing criteria labels
- Send `{ text, failingCriteria }` in the POST body

### 2. Frontend: `appreciation-editor-modal.component.ts`
- In `rewriteWithAI()`, compute the list of failing criteria from `guideItems` (items where `status !== 'success'`, excluding "Abusive Check")
- Pass them to `languageService.rewriteAppreciation(text, failingCriteria)`

### 3. Backend: `AppreciationRewriteController.scala`
- Parse `failingCriteria` (as `Seq[String]`) from the request JSON alongside `text`
- Pass both to `rewriteService.rewrite(text, failingCriteria)`

### 4. Backend: `AppreciationRewriteService.scala`
- Update `rewrite(text, failingCriteria)` signature
- Build a **dynamic prompt** that:
  - Keeps the existing rules (preserve meaning, don't invent details, etc.)
  - Adds a section: "The following quality criteria are NOT yet met. You MUST specifically address each one:"
  - Lists each failing criterion with its definition (e.g., "Be specific: mention a concrete action, task, project, or achievement")
  - Instructs the AI: "Keep parts of the message that already satisfy passing criteria. Only add/modify what's needed for the failing ones."

## Example Flow After Fix

1. User writes: "Thanks John for your great work on the project, it really helped the team."
2. Quality check: beSpecific ✅, highlightImpact ✅, acknowledgeEffort ✅, reinforceConsistency ❌
3. `rewriteWithAI()` sends `{ text: "...", failingCriteria: ["Reinforce consistency"] }`
4. Backend prompt tells OpenAI: "This message is missing forward-looking encouragement. Add a sentence that encourages continued behavior."
5. AI returns: "Thanks John for your great work on the project, it really helped the team. Looking forward to more of your excellent contributions."
6. User clicks "Use Suggestion Text" → re-check passes all 4 criteria → congratulation shown
