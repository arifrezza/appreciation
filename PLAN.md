# Autocomplete Feature — Implementation Plan

## What We're Building

When the AI quality check returns guidance with **"Consider phrases such as: phrase1, phrase2, phrase3, phrase4"**, and the user types one of those phrases in the textarea, a lightweight AI auto-completes the sentence. The completion appears as **ghosted (gray) text** after the cursor. Pressing **Tab** accepts it.

---

## Architecture Overview

```
USER TYPES KEYWORD
       |
       v
 Frontend detects match          (no backend call yet)
 against stored phrases
       |
       v
 Calls POST /api/autocomplete    (NEW endpoint - fast, lightweight)
       |
       v
 Backend: gpt-4o-mini            (max_tokens: 60, temperature: 0.3)
 completes the sentence
       |
       v
 Frontend renders ghost text     (gray overlay behind textarea)
       |
       v
 Tab -> accept | Any key -> dismiss
```

**Existing flow is untouched.** The autocomplete is a separate, independent layer.

---

## Step-by-Step Implementation

### Step 1: Backend — Create `AutocompleteService`

**File:** `backend/app/services/AutocompleteService.scala`

- `@Singleton` service injected with `WSClient` and `ExecutionContext`
- Method: `complete(text: String): Future[Either[String, String]]`
- Calls OpenAI Chat API (`gpt-4o-mini`) with:
  - `max_tokens: 60` (keeps it fast — just a sentence fragment)
  - `temperature: 0.3` (deterministic enough, slightly creative)
  - System prompt: *"You are an autocomplete engine for employee appreciation messages. Given the text so far, output ONLY the natural completion of the current sentence. Do not repeat what's already written. Output just the remaining words to finish the thought — nothing else."*
  - User message: the full `text` the user has typed so far
- Returns just the completion fragment (e.g., user typed `"which significantly improved"` -> returns `" the team's delivery timeline."`)
- Uses same `OPENAI_API_KEY` env var already configured

### Step 2: Backend — Create `AutocompleteController`

**File:** `backend/app/controllers/AutocompleteController.scala`

- `POST /api/autocomplete`
- Request: `{ "text": "John helped refactor the auth module which improved" }`
- Response: `{ "success": true, "completion": " the team's deployment speed significantly." }`
- Validates: text not empty, at least 10 characters
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
autocomplete(text: string): Observable<{ success: boolean; completion: string }> {
  return this.http.post<{ success: boolean; completion: string }>(
    '/api/autocomplete', { text }
  );
}
```

No new interfaces needed — response shape is simple.

### Step 5: Frontend — Component State & Keyword Tracking

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.ts`

New state variables:
```typescript
ghostText = '';                              // the autocomplete suggestion
private suggestedPhrases: string[] = [];     // extracted from AI guidance
private autocompleteSubject = new Subject<string>();
```

**Extract keywords from guidance:**

In `handleCombinedResults`, when `guidanceType === 'question'` and guidance contains "Consider phrases such as:", parse and store the phrases:
```typescript
private extractPhrases(guidance: string): void {
  const marker = 'Consider phrases such as:';
  const idx = guidance.indexOf(marker);
  if (idx === -1) return;
  const raw = guidance.substring(idx + marker.length);
  this.suggestedPhrases = raw
    .split(',')
    .map(p => p.trim().replace(/['"]/g, '').toLowerCase())
    .filter(p => p.length > 0);
}
```

This reuses the same parsing logic already in `getGuidancePhrases()`.

**Detect keyword match in `onTextChange()`:**

After the existing logic, add a check: does the tail end of `userText` contain any of the `suggestedPhrases`? If yes, push to `autocompleteSubject`.

```typescript
// After existing typingSubject.next(text):
const lowerText = text.toLowerCase();
const matched = this.suggestedPhrases.some(phrase => lowerText.includes(phrase));
if (matched && !this.ghostText) {
  this.autocompleteSubject.next(text);
}
```

**Set up autocomplete stream in `ngAfterViewInit()`:**

```typescript
this.autocompleteSubject
  .pipe(
    debounceTime(300),         // fast - 300ms, not 1000ms
    switchMap(text =>
      this.languageService.autocomplete(text)
    ),
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

**Handle Tab key:**

```typescript
onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Tab' && this.ghostText) {
    event.preventDefault();
    this.userText += this.ghostText;
    this.ghostText = '';
    this.onTextChange();    // trigger quality check on new text
  }
}
```

**Dismiss ghost text on any other input:**

In `onTextChange()`, clear `ghostText` at the top so any new keystroke wipes the old suggestion before re-checking for a new match:
```typescript
// At the top of onTextChange():
this.ghostText = '';
```

### Step 6: Frontend — Template Changes

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.html`

Replace the plain `<textarea>` with a wrapper that supports ghost text overlay:

```html
<!-- Ghost text wrapper -->
<div class="textarea-wrapper">

  <!-- Ghost layer (sits behind textarea, same font/size/padding) -->
  <div class="ghost-layer" *ngIf="ghostText">
    <span class="ghost-hidden">{{ userText }}</span><span class="ghost-completion">{{ ghostText }}</span>
  </div>

  <!-- Actual textarea (transparent background so ghost shows through) -->
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

**How the ghost text technique works:**
1. `.textarea-wrapper` is `position: relative`
2. `.ghost-layer` is `position: absolute`, same size/padding/font as textarea
3. `.ghost-hidden` renders the current user text in **transparent** color (takes up space but invisible — the real textarea text shows on top)
4. `.ghost-completion` renders the autocomplete in **gray** — appears right after where the user's text ends
5. Textarea gets `background: transparent` so the ghost layer shows through

### Step 7: Frontend — CSS

**File:** `frontend/src/app/modal/appreciation-editor-modal.component.css`

```css
.textarea-wrapper {
  position: relative;
}

.ghost-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* Must match .main-text exactly: */
  padding: /* same as .main-text */;
  font-family: /* same as .main-text */;
  font-size: /* same as .main-text */;
  line-height: /* same as .main-text */;
  white-space: pre-wrap;
  word-wrap: break-word;
  pointer-events: none;       /* clicks pass through to textarea */
  overflow: hidden;
}

.ghost-hidden {
  color: transparent;          /* invisible - just takes up space */
}

.ghost-completion {
  color: #9ca3af;              /* gray ghost text */
  opacity: 0.7;
}

.main-text.has-ghost {
  background: transparent;     /* so ghost layer shows through */
}
```

---

## What Stays Untouched

| Component | Changed? | Why |
|-----------|----------|-----|
| Quality check flow (`forkJoin`) | No | Autocomplete is a separate stream |
| `handleCombinedResults()` | Minimal | Only adds `extractPhrases()` call |
| `rewriteWithAI()` / `useAiText()` | No | Independent feature |
| Abusive word checking | No | Not related |
| Guide items / score animation | No | Not related |
| Backend quality/rewrite services | No | Separate new endpoint |

---

## Files to Create (2 new)

1. `backend/app/services/AutocompleteService.scala`
2. `backend/app/controllers/AutocompleteController.scala`

## Files to Modify (5 existing)

1. `backend/conf/routes` — add 1 route
2. `frontend/src/app/services/language.service.ts` — add 1 method
3. `frontend/src/app/modal/appreciation-editor-modal.component.ts` — add state + streams + keyboard handler
4. `frontend/src/app/modal/appreciation-editor-modal.component.html` — wrap textarea with ghost layer
5. `frontend/src/app/modal/appreciation-editor-modal.component.css` — ghost text styles

---

## Flow Summary

```
1. User types appreciation text
2. Quality check fires (existing flow, unchanged)
3. Backend returns: guidanceType: "question"
   guidance: "Does your message mention specifics?
              Consider phrases such as: project deadline,
              team collaboration, code review, sprint delivery"
4. Frontend extracts:
   ["project deadline", "team collaboration", "code review", "sprint delivery"]
5. User keeps typing...
   "Sarah helped with the project deadline"
6. Frontend detects "project deadline" match
   -> calls POST /api/autocomplete with full text
7. Backend (gpt-4o-mini, 60 tokens) returns:
   { completion: " by staying late and coordinating with QA." }
8. Frontend shows ghost text:

   "Sarah helped with the project deadline by staying late and coordinating with QA."
                                           |--- gray ghost text ---|
                                     cursor ^

9. User presses Tab -> ghost text accepted into userText
   Any other key -> ghost text dismissed
10. Quality check re-fires on the expanded text -> more criteria pass
```
