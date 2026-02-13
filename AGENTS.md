# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Build and Run Commands

### Backend (Scala Play)
```bash
cd backend
sbt run              # Start Play server on localhost:9000
sbt compile          # Compile without running
sbt clean            # Clean build artifacts
sbt test             # Run all tests
sbt "testOnly *AuthServiceSpec"  # Run single test class
```

### Frontend (Angular 17)
```bash
cd frontend
ng serve             # Dev server on localhost:4200 (proxies /api to backend)
npm run build:play   # Production build → backend/public/angular/
npm test             # Run Karma/Jasmine tests
ng test --include=**/auth.service.spec.ts  # Run single test file
```

### Development Mode (Two Terminals)
Terminal 1: `cd backend && sbt run`
Terminal 2: `cd frontend && ng serve`
Access at: http://localhost:4200 (Angular proxies API calls to Play)

### Production Mode
```bash
cd frontend && npm run build:play
cd ../backend && sbt run
```
Access at: http://localhost:9000

## Architecture

### Backend Structure (Scala Play with Quill)
- **controllers/**: HTTP handlers (parse JSON → call service → return response)
- **services/**: Business logic layer (AuthService, AbusiveWordsService, etc.)
- **repositories/**: Database access via Quill (e.g., UserRepository.findByEmail)
- **models/**: Case classes for domain objects and JSON serialization
- **database/DatabaseContext.scala**: Quill context wrapping Play's DataSource with MySQL dialect and SnakeCase naming

### Frontend Structure (Angular 17)
- **login/**: Login component with form handling
- **modal/**: AppreciationModalComponent (user selection), AppreciationEditorModalComponent (write appreciation)
- **services/**: Angular services (AuthService, UserService, LanguageService)

### Data Flow
1. Angular → `/api/*` → proxy.conf.json → Play backend
2. Controller parses JSON into case class (e.g., LoginRequest)
3. Service executes business logic
4. Repository uses Quill to query MySQL
5. Response mapped back through the chain

## Key Patterns

### Backend
- All database operations run on `db-dispatcher` thread pool (see `application.conf`)
- Quill queries are synchronous but wrapped in Future for non-blocking execution
- Password hashing uses BCrypt via `scala-bcrypt`
- CORS configured for localhost:4200 in development

### Frontend
- Services use RxJS Observables for HTTP calls
- AuthService stores JWT token in localStorage
- proxy.conf.json redirects `/api` requests to backend during development

## Database
- MySQL with HikariCP connection pool
- Quill ORM with SnakeCase naming strategy (Scala `passwordHash` → DB `password_hash`)
- Schema defined via Quill querySchema in DatabaseContext

## API Endpoints
- `POST /api/login` - Authentication (email/password → JWT token)
- `GET /api/users/:currentUserId` - List all users except current
- `POST /api/check-abusive-words` - Content moderation check
