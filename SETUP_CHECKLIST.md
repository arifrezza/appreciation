# IntelliJ IDEA Setup Checklist

## ✅ Pre-Setup Verification

Before opening IntelliJ, verify you have:

```bash
# Check Java
java -version
# Should show: version 11 or higher

# Check SBT
sbt --version
# Should show: sbt version installed

# Check Node.js
node -v
# Should show: v18+ or higher

# Check npm
npm -v
# Should show: npm version

# Check Angular CLI
ng version
# Should show: Angular CLI version
```

If any are missing, install them first.

## 📂 Step 1: Open Project in IntelliJ

1. **Launch IntelliJ IDEA**

2. **Open Backend Project:**
   - Click: `File` → `Open`
   - Navigate to: `appreciation-platform/backend`
   - Select the `backend` folder
   - Click `OK`

3. **Wait for Import:**
   - IntelliJ will detect `build.sbt`
   - It will show "Import SBT Project" notification
   - Click `Import` or `Enable Auto-Import`
   - Wait for indexing to complete (bottom status bar)

## 🔧 Step 2: Install Required Plugins

1. **Open Plugins:**
   - `File` → `Settings` → `Plugins` (Windows/Linux)
   - `IntelliJ IDEA` → `Preferences` → `Plugins` (Mac)

2. **Install Scala Plugin:**
   - Click `Marketplace` tab
   - Search: "Scala"
   - Install "Scala" by JetBrains
   - Restart IntelliJ when prompted

## ⚙️ Step 3: Configure Run Configurations

### Play Backend Configuration:

1. **Open Run Configurations:**
   - Click: `Run` → `Edit Configurations...`

2. **Add SBT Task:**
   - Click `+` (Add New Configuration)
   - Select: `SBT Task`
   
3. **Configure:**
   - Name: `Run Play Backend`
   - Tasks: `run`
   - Working directory: `/path/to/appreciation-platform/backend`
   - Click `OK`

### Angular Frontend Configuration (Optional):

1. **Add npm Configuration:**
   - Click `+` (Add New Configuration)
   - Select: `npm`
   
2. **Configure:**
   - Name: `Run Angular Dev`
   - package.json: `/path/to/appreciation-platform/frontend/package.json`
   - Command: `run`
   - Scripts: `start`
   - Click `OK`

## 📦 Step 4: Install Frontend Dependencies

Open IntelliJ Terminal (Alt+F12 or View → Tool Windows → Terminal):

```bash
cd ../frontend
npm install
```

Wait for installation to complete.

## 🚀 Step 5: First Run

### Option A: Development Mode (Recommended)

**Terminal 1 (IntelliJ Terminal):**
```bash
cd frontend
ng serve
```
Wait for: `✔ Compiled successfully`

**Terminal 2 (New IntelliJ Terminal Tab):**
```bash
cd backend
sbt run
```
Wait for: `(Server started, use Enter to stop and go back to the console...)`

**Open Browser:**
- Navigate to: `http://localhost:4200`
- You should see the login page

**Test Login:**
- Username: `admin`
- Password: `password`
- Click Login → Modal should appear

### Option B: Production Mode

**Terminal 1:**
```bash
cd frontend
npm run build:play
```
Wait for build to complete.

**Terminal 2:**
```bash
cd backend
sbt run
```

**Open Browser:**
- Navigate to: `http://localhost:9000`
- Login and test

## ✅ Verification Checklist

After setup, verify:

- [ ] IntelliJ opened `backend` folder successfully
- [ ] Scala plugin is installed and enabled
- [ ] SBT imports completed (no errors in `build.sbt`)
- [ ] `npm install` completed in `frontend/`
- [ ] Play backend starts on port 9000
- [ ] Angular dev server starts on port 4200
- [ ] Login page loads in browser
- [ ] Can login with demo credentials
- [ ] Modal popup appears after login
- [ ] No console errors in browser

## 🐛 Common Issues & Fixes

### Issue: "Cannot find Scala library"
**Fix:**
- File → Project Structure → Global Libraries
- Add Scala SDK if missing
- Or: Right-click `build.sbt` → Refresh

### Issue: "Port 9000 already in use"
**Fix:**
```bash
# Find and kill process using port 9000
lsof -ti:9000 | xargs kill -9
# Or use different port in application.conf
```

### Issue: "Angular compilation errors"
**Fix:**
```bash
cd frontend
rm -rf node_modules
npm install
ng serve
```

### Issue: "Play won't start"
**Fix:**
```bash
cd backend
sbt clean
sbt compile
sbt run
```

### Issue: "Page loads blank"
**Fix:**
1. Open browser DevTools (F12)
2. Check Console tab for errors
3. Verify files in `backend/public/angular/` exist
4. Check Network tab - are JS files loading?

## 📚 Next Steps After Setup

Once everything works:

1. **Explore the code:**
   - Backend: `app/controllers/AuthController.scala`
   - Frontend: `src/app/login/login.component.ts`

2. **Add features:**
   - Refer to original ChatGPT conversation
   - Start with OpenAI API integration
   - Add database layer

3. **Customize:**
   - Update demo credentials
   - Add more employees to modal
   - Style adjustments

## 💡 IntelliJ Productivity Tips

- **Quick Search:** Double-tap `Shift` → Search Everywhere
- **Navigate to File:** `Ctrl+Shift+N` (Cmd+Shift+O on Mac)
- **Navigate to Class:** `Ctrl+N` (Cmd+O on Mac)
- **Run Current Configuration:** `Shift+F10` (Ctrl+R on Mac)
- **Debug Current Configuration:** `Shift+F9` (Ctrl+D on Mac)
- **Terminal:** `Alt+F12` (Option+F12 on Mac)
- **Git:** `Alt+9` (Cmd+9 on Mac)

## 📞 Getting Help

If stuck:
1. Check browser console (F12)
2. Check IntelliJ Event Log (bottom right)
3. Check Play logs in terminal
4. Check Angular terminal output
5. Refer to README.md for troubleshooting

## ✨ Success!

If you see the login page and can open the modal, you're ready to start building the AI-powered appreciation features!

---

**Current Status:**
- ✅ Project structure created
- ✅ Play backend with auth API
- ✅ Angular frontend with login & modal
- ✅ Dev and production modes working
- ⏳ Ready for AI features integration
