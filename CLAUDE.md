# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Telegram Channel — Reply Rules (ALWAYS follow these)

When a message arrives via the Telegram channel (shown as `← telegram · ...`), you MUST:
1. Use the `mcp__plugin_telegram_telegram__reply` tool to send your response back — never just output to terminal
2. Pass the `chat_id` from the incoming message tag
3. Keep replies concise and conversational

## Playwright Testing — Video & Screenshot Rules (ALWAYS follow these)

### Video: Segmented screen recording
ALWAYS start recording before any Playwright test and stop after. The Telegram bot auto-sends each 60s chunk as it completes.

```bash
# 1. Start recording BEFORE the test
REC_PID=$(bash claude-telegram-bridge/record_test.sh start)

# 2. Run Playwright test (do NOT use recordVideo in browser context)

# 3. Stop AFTER the test completes
bash claude-telegram-bridge/record_test.sh stop $REC_PID
```

- Videos saved to `~/.playwright-mcp/videos/` as 60s `.mp4` chunks
- Bot auto-sends each chunk to Telegram as it completes

### Screenshots: Capture on every significant UI event
ALWAYS save screenshots to `~/.playwright-mcp/` — the bot auto-sends them to Telegram.

Take a screenshot whenever ANY of the following happens:

| Event | Example |
|---|---|
| Page navigation / route change | Login → employee list, modal opens |
| User action completed | Employee selected, button clicked |
| API response received | Quality score updated, AI rewrite returned |
| UI state changes visibly | Abusive warning appears, score jumps, ghost text shows |
| Error or warning shown | POST disabled, abusive detected, validation fails |
| Popover / tooltip appears | Spell check suggestion popover, hover tooltip |
| Score changes significantly | 0% → any%, or crosses 40%, 70% thresholds |
| AI suggestion box appears or is used | "Enhance with AI" result shown, "Use Suggestion" clicked |
| Tab key appends ghost text | Before and after |
| Final result / success state | "Appreciation posted" alert, congratulations message |

#### Screenshot helper pattern (use in every test):
```javascript
const ss = (name) => page.screenshot({ path: `/Users/arifrezza/.playwright-mcp/${name}.png` });
// Usage: await ss('event-description');
```

#### DOM mutation watcher (use for automatic event-driven screenshots):
```javascript
// Add this inside browser_run_code to auto-screenshot on UI changes
let ssIndex = 0;
const autoSS = async (label) => {
  await page.screenshot({ path: `/Users/arifrezza/.playwright-mcp/auto-${String(ssIndex++).padStart(2,'0')}-${label}.png` });
};

// Watch for score ring color changes
await page.exposeFunction('onScoreChange', async (score) => {
  await autoSS(`score-changed-${score}pct`);
});

// After each API response, take screenshot
// After abusive warning appears
await page.waitForSelector('[class*="abusive"], [class*="warning"]', { timeout: 5000 })
  .then(() => autoSS('abusive-warning'))
  .catch(() => {});
```

## Test Login Credentials (ALWAYS use these — do not ask the user)

| Field | Value |
|---|---|
| Email | `arif@company.com` |
| Password | `123` |

These are the default test credentials for all Playwright tests on this app.

## Project Overview

An employee appreciation platform with comprehensive AI features: real-time content moderation, appreciation quality scoring & coaching, AI-powered message rewriting, inline autocomplete with spell checking, and speech-to-text via Whisper. Employees can log in, select a colleague, write/dictate appreciation messages that are analyzed and improved through a multi-layer AI pipeline.

## Tech Stack

- **Backend:** Scala 2.13.14 + Play Framework 2.9.4, Quill 4.8.0 ORM, MySQL 8.0
- **Frontend:** Angular 17, TypeScript 5.2, RxJS 7.8, Quill rich-text editor, Typo.js (spell check)
- **Build Tools:** SBT 1.11.7 (backend), Angular CLI 17 + npm (frontend)
- **Testing:** ScalaTest+Play (backend), Jasmine + Karma (frontend)
- **AI/ML:** OpenAI GPT-4o-mini (quality scoring, rewriting, autocomplete), OpenAI Moderation API, local Whisper service (speech-to-text)

## Build & Run Commands

### Backend (from `backend/` directory)
```bash
sbt run                          # Start Play server on port 9000
sbt compile                      # Compile only
sbt clean                        # Clean build artifacts
sbt test                         # Run all tests
sbt "testOnly *AuthServiceSpec"  # Run a single test class
```

### Frontend (from `frontend/` directory)
```bash
ng serve                         # Dev server on port 4200 (proxies /api to :9000)
npm run build:play               # Production build → backend/public/angular/
npm run build                    # Standard ng build
npm test                         # Run Karma/Jasmine tests
ng test --include=**/auth.service.spec.ts  # Single test file
```

### Development Mode (two terminals)
- Terminal 1: `cd backend && sbt run`
- Terminal 2: `cd frontend && ng serve`
- Access at http://localhost:4200

### Production Mode
```bash
cd frontend && npm run build:play
cd ../backend && sbt run
# Access at http://localhost:9000
```

## Project Structure

```
backend/
  app/
    controllers/    # HTTP handlers:
                    #   AuthController, UserController, AppreciationController
                    #   AbusiveWordsController, AppreciationQualityController
                    #   AppreciationRewriteController, AutocompleteController
                    #   TranscribeController (speech-to-text proxy)
    services/       # Business logic:
                    #   AuthService, PasswordService
                    #   AbusiveWordsService (local word list)
                    #   SlangCheckService (OpenAI Moderation API)
                    #   SlangFilterService
                    #   AppreciationQualityService (GPT-4o-mini, 4-criteria scoring)
                    #   AppreciationRewriteService (GPT-4o-mini, criteria-driven rewrite)
                    #   AutocompleteService (GPT-4o-mini, ghost text + spell check)
    repositories/   # Data access via Quill ORM (UserRepository)
    models/         # Case classes (User, LoginRequest)
    database/       # DatabaseContext (Quill config with MySQL + SnakeCase naming)
  conf/
    application.conf    # Play config (CORS, DB, JWT secret, thread pools, whisper.service.url)
    routes              # API route definitions
    evolutions/         # SQL schema migrations
    abusive_word_list.txt  # Moderation word list
  build.sbt             # SBT dependencies

frontend/
  src/app/
    login/          # Login component
    modal/          # AppreciationModalComponent (user selection)
                    # AppreciationEditorModalComponent (Quill editor, all AI integration)
    quill/          # Custom Quill blots / rich-text editor config
    services/       # AuthService, UserService, LanguageService
                    # SpeechToTextService (MediaRecorder → /api/transcribe)
                    # SpellCheckService (Typo.js en_US + localStorage custom words)
                    # AbbreviationDictionaryService (101 informal→formal mappings)
  angular.json      # Angular CLI configuration
  tsconfig.json     # TypeScript config (strict mode enabled)
  src/proxy.conf.json  # Dev proxy: /api → localhost:9000
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/login` | Authenticate user (email + password) |
| GET | `/api/users/:currentUserId` | List employees (excluding current user) |
| POST | `/api/check-abusive-words` | Dual-layer content moderation (local list → OpenAI Moderation API) |
| POST | `/api/check-appreciation-quality` | GPT-4o-mini quality scoring across 4 criteria (0–100 score, tone, guidance) |
| POST | `/api/rewrite-appreciation` | GPT-4o-mini rewrites message targeting failing criteria |
| POST | `/api/autocomplete` | GPT-4o-mini ghost-text completion + spell-check corrections |
| POST | `/api/transcribe` | Proxies audio file to local Whisper service for speech-to-text |

## Architecture Patterns

### Backend
- **Layering:** Controllers → Services → Repositories → Models
- **DI:** Guice `@Inject()` with `@Singleton` services
- **Threading:** Dedicated `db-dispatcher` (16-thread fixed pool) for all blocking DB queries; all DB operations wrapped in `Future`
- **ORM:** Quill with `SnakeCase` naming strategy (`passwordHash` maps to `password_hash`)
- **Auth:** BCrypt password hashing, JWT token generation
- **Moderation:** Local abusive word list checked first, then OpenAI Moderation API (`omni-moderation-latest`) — cost optimization
- **Quality scoring:** GPT-4o-mini evaluates 4 criteria: `beSpecific`, `highlightImpact`, `acknowledgeEffort`, `reinforceConsistency`; returns overall score (0–100), per-criterion scores, tone, and guidance type (question/suggestion/congratulation)
- **Rewriting:** GPT-4o-mini rewrites messages targeting only the failing criteria; temp 0.3, max 400 tokens
- **Autocomplete:** GPT-4o-mini returns ghost-text completion (≤20 words) + spell corrections with edit-distance validation; temp 0.3, max 120 tokens
- **Speech-to-text:** `TranscribeController` proxies multipart audio to local Whisper service (configurable via `whisper.service.url` in application.conf, default `http://localhost:8000`)

### Frontend
- **Components:** NgModule-based (not standalone), component-scoped CSS
- **Communication:** `@Input()`/`@Output()` EventEmitter between parent-child components
- **HTTP:** RxJS Observables via Angular HttpClient
- **State:** Component properties + `localStorage` for auth token (key: `auth_token`)
- **Auth flow:** AuthService with `BehaviorSubject<boolean>` for `isAuthenticated$`
- **AI integration in editor:** Two RxJS streams — typing subject (debounce 1000ms) triggers `forkJoin(checkLanguage, checkQuality)`; autocomplete subject (debounce 400ms) triggers `autocomplete()` for ghost text + spell underlines
- **Spell checking:** Hybrid — client-side Typo.js (en_US dictionary, custom words in `custom_dictionary` localStorage key) + server-side AI corrections from autocomplete endpoint
- **Abbreviation detection:** `AbbreviationDictionaryService` maps 101 informal abbreviations (e.g. `u`→`you`, `pls`→`please`) to formal equivalents; ignored/added words persisted in localStorage
- **Speech recording:** `SpeechToTextService` uses `MediaRecorder` API (WebM format) → POST to `/api/transcribe` → returns `{text: string}`; mic button (animated GIF, 24px) embedded in editor text box area

## Key Conventions

- **Scala:** Case classes for models, Future-based async, type-safe Quill queries in `quote { }` blocks
- **TypeScript:** Strict mode, no implicit returns, ViewChild/EventEmitter patterns
- **CSS:** Plain CSS (no Sass/SCSS), component-scoped styles
- **No linter/formatter configured** — follow existing code style
- **Database:** MySQL with InnoDB, UTF8MB4 charset, Play Evolutions for migrations

## Environment Requirements

- Java 11+, SBT, Node.js 18+, Angular CLI 17, MySQL 8.0+
- `OPENAI_API_KEY` env var required for OpenAI calls (moderation, quality scoring, rewriting, autocomplete)
- Local Whisper HTTP service required for speech-to-text (default: `http://localhost:8000`; override via `whisper.service.url` in `application.conf`)
- MySQL connection configured in `backend/conf/application.conf` (default: localhost:3306, root/12345789)

## Common Pitfalls

- All DB queries must run on the `db-dispatcher` execution context, not the default Play thread pool
- Quill queries require explicit `quote { }` blocks and schema mappings in `DatabaseContext`
- Frontend dev proxy only works with `ng serve`; production builds must go through `npm run build:play`
- CORS is configured for `localhost:4200` only — update `application.conf` if ports change
- Whisper service must be running separately before `/api/transcribe` will work — it is not bundled with the Play app
- OpenAI JSON responses may include markdown fences (` ```json ``` `) — services strip these before parsing
- Autocomplete completions are validated against a refusal-pattern list and edit-distance threshold before being sent to the frontend
- `SpellCheckService` dictionary loads asynchronously; check `isReady$` before calling `check()` or `suggest()`
- `AbbreviationDictionaryService` localStorage keys (`ignored_abbreviations`, `additional_abbreviations`) are user-specific — don't share between test users
