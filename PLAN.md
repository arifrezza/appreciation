# Autocomplete Feature — Implementation Plan (v2)

## What We're Building

A smart ghost-text autocomplete that works in **two modes**:

1. **Keyword trigger:** When the user types a phrase from "Consider phrases such as:", the AI auto-completes the sentence to satisfy **that specific criterion**
2. **Always-on trigger:** Even without typing a keyword, the AI detects which failing criterion best matches the user's current context and auto-completes to satisfy it

The completion appears as **ghosted gray text**. **Tab** accepts, any other key dismisses.

---

## Architecture Overview

```
USER TYPES IN TEXTAREA
       |
       v
 Frontend checks TWO triggers:
       |
       |--- Trigger A: Text contains a suggested phrase?
       |    YES -> send text + matched criterion name
       |
       |--- Trigger B: No keyword match, but criteria are still failing?
       |    YES -> send text + all failing criteria names
       |
       v
 POST /api/autocomplete                (NEW endpoint)
 Body: { text, failingCriteria, targetCriterion? }
       |
       v
 Backend: gpt-4o-mini (max_tokens: 60)
 Completes sentence to satisfy the targeted criterion
       |
       v
 Frontend renders ghost text           (gray overlay)
       |
       v
 Tab -> accept | Any key -> dismiss
```

**Existing flow is untouched.** The autocomplete is a separate, independent layer.

---

## How Criteria Targeting Works

The backend quality check already tells us which criterion each phrase belongs to. When `guidanceType === "question"`, the guidance targets the **single weakest criterion** and the 4 phrases are specifically for that criterion.

**Example:** If "Be specific" is failing, backend returns:
```
guidance: "What specific project did they contribute to? Consider phrases such as:
           project deadline, sprint delivery, code review, deployment pipeline"
```

These 4 phrases all target "Be specific". So when the user types "sprint delivery", we know the autocomplete should complete the sentence to satisfy "Be specific".

For the always-on trigger, the backend receives all failing criteria and picks the one that best fits what the user is currently writing.

---

## Step-by-Step Implementation

### Step 1: Backend — Create `AutocompleteService`

**File:** `backend/app/services/AutocompleteService.scala`

- `@Singleton` service, injected with `WSClient` and `ExecutionContext`
- Method: `complete(text: String, failingCriteria: Seq[String], targetCriterion: Option[String]): Future[Either[String, String]]`
- Calls OpenAI Chat API (`gpt-4o-mini`) with:
  - `max_tokens: 60` (fast — just a sentence fragment)
  - `temperature: 0.3`
  - **Dynamic system prompt** that changes based on whether a target criterion is provided:

**When `targetCriterion` is provided (keyword trigger):**
```
You are an autocomplete engine for employee appreciation messages.
The user is writing an appreciation and has just used a phrase related to
the criterion: "{targetCriterion}".

Criterion definition:
- Be specific: mention a concrete action, task, project, or achievement
- Highlight impact: explain the effect on the team, project, or organization
- Acknowledge effort: recognize dedication, perseverance, or hard work
- Reinforce consistency: encourage continued behavior or express future confidence

Complete the current sentence so that the criterion "{targetCriterion}"
would clearly pass. Output ONLY the remaining words — do not repeat
what is already written. Keep it concise (one sentence fragment).
```

**When `targetCriterion` is NOT provided (always-on trigger):**
```
You are an autocomplete engine for employee appreciation messages.
The user is writing an appreciation. The following criteria are NOT yet satisfied:
{failingCriteria as bullet list}

Read the user's text and determine which of the failing criteria best fits
what the user appears to be writing about right now. Complete the current
sentence to satisfy that criterion.

Output ONLY the remaining words — do not repeat what is already written.
Keep it concise (one sentence fragment).
```

- Uses same `OPENAI_API_KEY` env var already configured

### Step 2: Backend — Create `AutocompleteController`

**File:** `backend/app/controllers/AutocompleteController.scala`

- `POST /api/autocomplete`
- Request body:
  ```json
  {
    "text": "Sarah helped with the sprint delivery",
    "failingCriteria": ["Be specific", "Highlight impact"],
    "targetCriterion": "Be specific"
  }
  ```
  - `text` — required, the full user text so far
  - `failingCriteria` — required, array of failing criterion names
  - `targetCriterion` — optional, present only when a keyword was matched
- Response:
  ```json
  { "success": true, "completion": " by resolving 12 critical bugs before the release." }
  ```
- Validates: text not empty, at least 10 characters, at least 1 failing criterion
- Guice-injected `AutocompleteService`

### Step 3: Backend — Add Route

**File:** `backend/conf/routes`

Add one line:
```
POST   /api/autocomplete   controllers.AutocompleteController.autocomplete
```

### Step 4: Frontend — Add `autocomplete()` to `LanguageService`

**File:** `frontend/src/app/services/language.service.ts`

New method:
```typescript
autocomplete(
  text: string,
  failingCriteria: string[],
  targetCriterion?: string
): Observable<{ success: boolean; completion: string }> {
  const body: any = { text, failingCriteria };
  if (targetCriterion) {
    body.targetCriterion = targetCriterion;
  }
  return this.http.post<{ success: boolean; completion: string }>(
    '/api/autocomplete', body
  );
}
```

### Step 5: Frontend — Component State & Phrase-to-Criterion Mapping

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.ts`

New state variables:
```typescript
ghostText = '';                                          // the autocomplete suggestion
private phraseToCriterionMap: Record<string, string> = {};  // "sprint delivery" -> "Be specific"
private autocompleteSubject = new Subject<string>();
```

**Extract phrases AND map them to their criterion:**

The quality check guidance targets one specific criterion. Store that mapping:
```typescript
private currentGuidanceCriterion = '';   // which criterion the guidance phrases target

private extractPhrases(guidance: string, qualityResult: QualityResponse): void {
  const marker = 'Consider phrases such as:';
  const idx = guidance.indexOf(marker);
  if (idx === -1) return;

  // Find which criterion this guidance targets (the weakest failing one)
  const criteriaScores = [
    { label: 'Be specific', score: qualityResult.quality.beSpecific.score, pass: qualityResult.quality.beSpecific.pass },
    { label: 'Highlight impact', score: qualityResult.quality.highlightImpact.score, pass: qualityResult.quality.highlightImpact.pass },
    { label: 'Acknowledge effort', score: qualityResult.quality.acknowledgeEffort.score, pass: qualityResult.quality.acknowledgeEffort.pass },
    { label: 'Reinforce consistency', score: qualityResult.quality.reinforceConsistency.score, pass: qualityResult.quality.reinforceConsistency.pass }
  ];
  const weakest = criteriaScores.filter(c => !c.pass).sort((a, b) => a.score - b.score)[0];
  this.currentGuidanceCriterion = weakest?.label || '';

  // Map each phrase to the criterion
  const raw = guidance.substring(idx + marker.length);
  const phrases = raw.split(',').map(p => p.trim().replace(/['"]/g, '').toLowerCase()).filter(p => p.length > 0);
  phrases.forEach(phrase => {
    this.phraseToCriterionMap[phrase] = this.currentGuidanceCriterion;
  });
}
```

Call `extractPhrases` in `handleCombinedResults` when guidance contains phrases (both `question` and `suggestion` types).

### Step 6: Frontend — Dual-Trigger Detection in `onTextChange()`

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.ts`

```typescript
onTextChange(): void {
  const text = this.userText.trim();

  // Dismiss any existing ghost text on new input
  this.ghostText = '';

  if (text.length === 0) {
    this.resetToInitialState();
    return;
  }

  if (!this.hasStartedTyping) {
    this.hasStartedTyping = true;
  }

  const normalized = this.normalizeText(text);
  if (normalized === this.lastMeaningfulText) {
    return;
  }
  this.lastMeaningfulText = normalized;

  // Existing: push to quality check stream
  this.typingSubject.next(text);

  // NEW: push to autocomplete stream (if there are failing criteria)
  const failingCount = this.guideItems.filter(
    i => i.label !== 'Abusive Check' && i.status !== 'success'
  ).length;
  if (failingCount > 0 && text.length >= 10) {
    this.autocompleteSubject.next(text);
  }
}
```

### Step 7: Frontend — Autocomplete Stream with Smart Targeting

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.ts`

In `ngAfterViewInit()`, add a second reactive stream:

```typescript
this.autocompleteSubject
  .pipe(
    debounceTime(500),        // 500ms — fast, but not on every keystroke
    filter(() => {
      // Don't autocomplete if all criteria already pass or congratulation showing
      return this.countAllPassed() < 5 && !this.showCongratulation;
    }),
    switchMap(text => {
      const lowerText = text.toLowerCase();

      // Gather failing criteria
      const failingCriteria = this.guideItems
        .filter(i => i.label !== 'Abusive Check' && i.status !== 'success')
        .map(i => i.label);

      if (failingCriteria.length === 0) return EMPTY;

      // TRIGGER A: Check if text contains a known phrase -> target that criterion
      let targetCriterion: string | undefined;
      for (const [phrase, criterion] of Object.entries(this.phraseToCriterionMap)) {
        if (lowerText.includes(phrase)) {
          targetCriterion = criterion;
          break;
        }
      }

      // TRIGGER B: No keyword match -> send all failing criteria, let backend decide
      // (targetCriterion stays undefined)

      return this.languageService.autocomplete(text, failingCriteria, targetCriterion);
    }),
    takeUntil(this.destroy$)
  )
  .subscribe({
    next: (res) => {
      if (res.success && res.completion) {
        this.ghostText = res.completion;
      }
    }
  });
```

Note: import `EMPTY` from `rxjs` for the early-exit case.

### Step 8: Frontend — Tab Key Handler

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.ts`

```typescript
onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Tab' && this.ghostText) {
    event.preventDefault();
    this.userText += this.ghostText;
    this.ghostText = '';
    this.onTextChange();    // re-trigger quality check on expanded text
  }
}
```

### Step 9: Frontend — Template Changes

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.html`

Wrap the existing textarea:

```html
<div class="textarea-wrapper">
  <!-- Ghost layer behind textarea -->
  <div class="ghost-layer" *ngIf="ghostText">
    <span class="ghost-hidden">{{ userText }}</span><span class="ghost-completion">{{ ghostText }}</span>
  </div>

  <textarea
    #mainTextarea
    class="main-text"
    [(ngModel)]="userText"
    (input)="onTextChange()"
    (keydown)="onKeydown($event)"
    [class.has-ghost]="ghostText"
    autofocus
  ></textarea>
</div>
```

Add a small hint below the textarea:
```html
<div class="ghost-hint" *ngIf="ghostText">
  Press <kbd>Tab</kbd> to accept
</div>
```

### Step 10: Frontend — CSS

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.css`

```css
.textarea-wrapper {
  position: relative;
}

.ghost-layer {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  padding: /* match .main-text */;
  font-family: /* match .main-text */;
  font-size: /* match .main-text */;
  line-height: /* match .main-text */;
  white-space: pre-wrap;
  word-wrap: break-word;
  pointer-events: none;
  overflow: hidden;
}

.ghost-hidden {
  color: transparent;
}

.ghost-completion {
  color: #9ca3af;
  opacity: 0.7;
}

.main-text.has-ghost {
  background: transparent;
}

.ghost-hint {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
}

.ghost-hint kbd {
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 11px;
}
```

---

## Both Triggers Explained

### Trigger A: User types a keyword phrase

```
Criteria state:  Be specific ❌ | Highlight impact ✓ | Acknowledge effort ✓ | Reinforce consistency ❌
Guidance says:   "Consider phrases such as: sprint delivery, code review, ..."
User types:      "Sarah helped with the sprint delivery"
                                       ^^^ keyword match -> target = "Be specific"
Ghost appears:   " of the payment API, completing it two days ahead of schedule."
                  ^--- completes sentence to pass "Be specific"

User presses Tab -> full text now satisfies "Be specific" -> green tick
```

### Trigger B: User types freely (no keyword match)

```
Criteria state:  Be specific ✓ | Highlight impact ❌ | Acknowledge effort ✓ | Reinforce consistency ❌
User types:      "Sarah refactored the auth module with great dedication"
                  ^--- no keyword match, but user is writing naturally
Backend receives: failingCriteria = ["Highlight impact", "Reinforce consistency"]
Backend decides:  "Highlight impact" best fits the current context (refactoring has clear impact)
Ghost appears:   ", which reduced login errors by 40% and improved team velocity."
                  ^--- completes to pass "Highlight impact"

User presses Tab -> "Highlight impact" passes -> green tick
```

---

## What Stays Untouched

| Component | Changed? | Why |
|-----------|----------|-----|
| Quality check flow (`forkJoin`) | No | Autocomplete is a separate stream |
| `handleCombinedResults()` | Minimal | Adds `extractPhrases()` call |
| `rewriteWithAI()` / `useAiText()` | No | Independent feature |
| Abusive word checking | No | Not related |
| Guide items / score animation | No | Not related |
| Backend quality/rewrite services | No | New endpoint, separate service |

---

## Files to Create (2 new)

1. `backend/app/services/AutocompleteService.scala`
2. `backend/app/controllers/AutocompleteController.scala`

## Files to Modify (5 existing)

1. `backend/conf/routes` — add 1 route
2. `frontend/src/app/services/language.service.ts` — add 1 method
3. `frontend/src/app/modal/appreciation-editor-modal.component.ts` — add state, dual-trigger logic, keyboard handler
4. `frontend/src/app/modal/appreciation-editor-modal.component.html` — wrap textarea with ghost layer
5. `frontend/src/app/modal/appreciation-editor-modal.component.css` — ghost text + hint styles

---

## Flow Summary

```
1. User types appreciation text
2. Quality check fires (existing flow, unchanged)
3. Backend returns quality result with failing criteria + guidance phrases
4. Frontend stores: phraseToCriterionMap + failing criteria list

5a. TRIGGER A (keyword typed):
    User types "sprint delivery" (a suggested phrase)
    -> Frontend finds phrase in map -> targetCriterion = "Be specific"
    -> POST /api/autocomplete { text, failingCriteria, targetCriterion: "Be specific" }
    -> Backend completes sentence to satisfy "Be specific"
    -> Ghost text appears

5b. TRIGGER B (no keyword, always-on):
    User types freely, no keyword match detected
    -> POST /api/autocomplete { text, failingCriteria }  (no targetCriterion)
    -> Backend reads context, picks best-matching failing criterion
    -> Completes sentence to satisfy that criterion
    -> Ghost text appears

6. User presses Tab -> ghost text accepted
7. Quality check re-fires -> targeted criterion now passes -> green tick
```
