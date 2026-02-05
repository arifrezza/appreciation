# Appreciation Platform - Play + Angular

A full-stack employee appreciation platform with AI-powered moderation.

## Architecture

- **Backend**: Scala Play Framework (APIs + Twirl shell)
- **Frontend**: Angular 17 (SPA)
- **Pattern**: Angular served by Play in production, separate dev servers in development

## Project Structure

```
appreciation-platform/
├── backend/                    # Play Framework (Scala)
│   ├── app/
│   │   ├── controllers/       # API controllers
│   │   ├── models/           # Data models
│   │   ├── services/         # Business logic
│   │   └── views/            # Twirl templates (Angular shell only)
│   ├── conf/
│   │   ├── application.conf  # Play configuration
│   │   └── routes           # API routes
│   ├── public/
│   │   └── angular/         # Angular build output (production)
│   └── build.sbt            # SBT build config
│
└── frontend/                  # Angular application
    ├── src/
    │   ├── app/
    │   │   ├── login/       # Login component
    │   │   ├── modal/       # Appreciation modal
    │   │   └── services/    # Angular services
    │   ├── index.html       # Dev only
    │   ├── main.ts         # Bootstrap
    │   ├── styles.css      # Global styles
    │   └── proxy.conf.json # Dev proxy config
    ├── angular.json
    └── package.json
```

## Prerequisites

1. **Java 11 or higher**
   ```bash
   java -version
   ```

2. **SBT (Scala Build Tool)**
   ```bash
   sbt --version
   ```

3. **Node.js 18+ and npm**
   ```bash
   node -v
   npm -v
   ```

4. **Angular CLI**
   ```bash
   npm install -g @angular/cli
   ng version
   ```

## Setup Instructions

### 1. Initial Setup

```bash
# Clone or navigate to project
cd appreciation-platform

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 2. Development Mode (Recommended)

Run Angular and Play separately with hot-reload:

**Terminal 1 - Angular Dev Server:**
```bash
cd frontend
ng serve
```
Angular runs at: `http://localhost:4200`
API calls are proxied to Play backend at `localhost:9000`

**Terminal 2 - Play Backend:**
```bash
cd backend
sbt run
```
Play runs at: `http://localhost:9000`

**Access the app:**
Open `http://localhost:4200` in your browser

**Login credentials (demo):**
- Username: `admin`
- Password: `password`

### 3. Production-Like Mode

Build Angular and serve everything from Play:

```bash
# Step 1: Build Angular
cd frontend
npm run build:play

# This creates files in: backend/public/angular/

# Step 2: Run Play
cd ../backend
sbt run

# Access at: http://localhost:9000
```

## IntelliJ IDEA Setup

### Opening in IntelliJ

1. **Open IntelliJ IDEA**

2. **Import Play Project:**
   - File → Open → Select `appreciation-platform/backend` folder
   - IntelliJ will detect `build.sbt` and import as SBT project
   - Wait for indexing to complete

3. **Run Configuration for Play:**
   - Run → Edit Configurations
   - Add New Configuration → SBT Task
   - Name: "Run Play"
   - Tasks: `run`
   - Working directory: `/path/to/appreciation-platform/backend`
   - Click OK

4. **Run Configuration for Angular (Optional):**
   - Run → Edit Configurations
   - Add New Configuration → npm
   - Name: "Angular Dev"
   - Package.json: `/path/to/appreciation-platform/frontend/package.json`
   - Command: `run`
   - Scripts: `start`
   - Click OK

5. **Running the Application:**
   - Start Play: Click "Run Play" configuration
   - Start Angular: Click "Angular Dev" configuration (or use terminal)

### IntelliJ Tips

- **Scala Plugin**: Make sure Scala plugin is installed
- **Code Navigation**: Use Ctrl+Click (Cmd+Click on Mac) to navigate
- **Auto-import**: Enable auto-import for SBT dependencies
- **Terminal**: Use IntelliJ's built-in terminal (Alt+F12)

## Key Features

✅ Login page with authentication
✅ Modal popup on successful login (URL stays same)
✅ Employee selection UI
✅ CORS configured for dev
✅ Production-ready build process
✅ Clean separation of concerns

## API Endpoints

### Authentication
- `POST /api/login` - User login
  ```json
  Request:
  {
    "username": "admin",
    "password": "password"
  }
  
  Response:
  {
    "success": true,
    "token": "jwt-token",
    "user": {
      "username": "admin",
      "name": "Admin User"
    }
  }
  ```

## Next Steps

After basic setup works, you can add:

1. **AI Moderation** - OpenAI API integration
2. **Tone Analysis** - Sentiment and formality detection
3. **Smart Rewriting** - Hierarchy-aware rewrites
4. **Database** - MySQL with Quill
5. **Recognition Coaching** - Real-time feedback on appreciation quality

## Troubleshooting

### "Page is blank"
- Check browser console for errors
- Verify Angular built files exist in `backend/public/angular/`
- Check Twirl template paths in `index.scala.html`

### "CORS errors in dev"
- Verify `proxy.conf.json` is configured
- Start `ng serve` with proxy: `ng serve --proxy-config src/proxy.conf.json`
- Check Play CORS filter in `application.conf`

### "Can't connect to backend"
- Verify Play is running on port 9000: `sbt run`
- Check no other service is using port 9000

### "SBT compilation errors"
- Run `sbt clean` then `sbt compile`
- Check Scala version compatibility

### "Angular compilation errors"
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Clear Angular cache: `ng cache clean`

## Development Workflow

### Daily Development
```bash
# Terminal 1
cd frontend && ng serve

# Terminal 2  
cd backend && sbt run

# Work on code, both auto-reload
```

### Before Committing
```bash
# Test production build
cd frontend
npm run build:play

cd ../backend
sbt run

# Test at localhost:9000
```

## Project Status

- ✅ Play backend with authentication API
- ✅ Angular login UI
- ✅ Modal popup component
- ✅ Dev and production modes
- ⏳ AI moderation integration
- ⏳ Database integration
- ⏳ Advanced features

## License

Internal company project
