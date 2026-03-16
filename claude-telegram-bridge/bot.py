#!/usr/bin/env python3
"""
Claude-Telegram Bridge
Executes whitelisted commands on your local Mac and returns results via Telegram.
Optionally pipes through Claude CLI for intelligent responses.

Commands:
  /start        - Welcome message
  /help         - Show allowed commands
  /setdir       - Change working directory
  /conflicts    - Scan & summarize ALL current merge conflicts via Claude
  /merge        - Merge a branch: /merge feature-branch
  /resolve      - Auto-resolve all conflicts via Claude and commit
  /gitstatus    - Quick decorated git status
"""

import os
import sys
import site
# Ensure user site-packages are on path (needed when launched via launchd)
_user_site = site.getusersitepackages()
if _user_site not in sys.path:
    sys.path.insert(0, _user_site)
import re
import subprocess
import logging
import asyncio
import shlex
import time
import tempfile
import glob
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes

load_dotenv()

BOT_START_TIME = datetime.now(timezone.utc)

# ── Config ────────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN   = os.getenv("TELEGRAM_BOT_TOKEN")
ALLOWED_USER_IDS = set(map(int, os.getenv("ALLOWED_USER_IDS", "").split(",")))
WORK_DIR         = os.path.expanduser(os.getenv("WORK_DIR", "~"))
USE_CLAUDE       = os.getenv("USE_CLAUDE", "false").lower() == "true"
MAX_OUTPUT_CHARS = 4000   # Telegram message limit is ~4096

# Stores pending !ai commands awaiting user confirmation: { user_id: (command, explanation) }
PENDING_COMMANDS: dict[int, tuple[str, str]] = {}

# Playwright MCP folder watcher
PLAYWRIGHT_DIR = os.path.expanduser("~/.playwright-mcp")
_seen_videos: set[str] = set()   # tracks already-sent videos

# Per-user terminal mode: True = terminal ON (command mode), False = chat mode (default)
TERMINAL_MODE: dict[int, bool] = {}

# Stores the active remote-control session (if any)
REMOTE_SESSION: dict = {}  # keys: "process" (Popen), "started_at" (datetime)

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO
)
log = logging.getLogger(__name__)

# ── Whitelisted commands ───────────────────────────────────────────────────────
# Add or remove commands you want to allow.
# Supports prefix matching: "git" allows all git subcommands.
ALLOWED_PREFIXES = {
    "git",
    "ls",
    "pwd",
    "cat",
    "echo",
    "sbt",
    "scala",
    "java",
    "javac",
    "mvn",
    "gradle",
    "curl",
    "ping",
    "df",
    "du",
    "ps",
    "top",          # will run non-interactively
    "uname",
    "whoami",
    "date",
    "which",
    "env",
    "printenv",
    "find",
    "grep",
    "head",
    "tail",
    "wc",
}

# Explicit full commands always blocked regardless of prefix
BLOCKED_COMMANDS = {
    "rm -rf /",
    "sudo rm",
    "shutdown",
    "reboot",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_allowed(raw_cmd: str) -> bool:
    """Check if command is whitelisted and not blocked."""
    stripped = raw_cmd.strip().lower()
    for blocked in BLOCKED_COMMANDS:
        if stripped.startswith(blocked):
            return False
    try:
        parts = shlex.split(stripped)
    except ValueError:
        return False
    if not parts:
        return False
    first = parts[0].split("/")[-1]   # handle full paths like /usr/bin/git
    return first in ALLOWED_PREFIXES


def run_command(raw_cmd: str) -> str:
    """Run the command in WORK_DIR and return stdout+stderr."""
    try:
        result = subprocess.run(
            raw_cmd,
            shell=True,
            cwd=WORK_DIR,
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "TERM": "dumb"}
        )
        output = result.stdout + result.stderr
        return output.strip() if output.strip() else "(no output)"
    except subprocess.TimeoutExpired:
        return "⏱ Command timed out after 30 seconds."
    except Exception as e:
        return f"❌ Error: {e}"


def chat_with_claude(user_text: str) -> str:
    """Send text to Claude CLI as normal conversation, return response."""
    prompt = f"User message:\n{user_text}\n\nRespond helpfully and in detail."
    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=60, cwd=WORK_DIR,
            env=clean_env,
        )
        return result.stdout.strip() or result.stderr.strip() or "(no response from Claude)"
    except FileNotFoundError:
        return "❌ Claude CLI not found."
    except subprocess.TimeoutExpired:
        return "⏱ Claude timed out."


def make_hindi_summary(full_reply: str) -> str:
    """Ask Claude to create a short Hindi spoken summary (60–100 words)."""
    if len(full_reply) < 500:
        # Short enough — use as-is for TTS (still request Hindi translation)
        prompt = (
            "Translate the following English text into natural spoken Hindi. "
            "Output Hindi text only, no explanations.\n\n"
            f"{full_reply}"
        )
    else:
        prompt = (
            "Convert the following English response into a short Hindi summary for audio playback.\n"
            "Rules:\n"
            "- Natural spoken Hindi\n"
            "- Focus on overall outcome, key changes, warnings, next steps\n"
            "- Avoid reading long file lists or code blocks\n"
            "- Mention filenames only if critical\n"
            "- 60–100 words max\n"
            "- Output Hindi text only\n\n"
            f"English response:\n{full_reply}"
        )
    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=60, cwd=WORK_DIR,
            env=clean_env,
        )
        return result.stdout.strip() or full_reply
    except Exception:
        return full_reply


def generate_playwright_script(user_prompt: str) -> str:
    """Ask Claude to generate a standalone Node.js Playwright test script."""
    prompt = f"""Write a complete standalone Node.js Playwright test script for the following test:

{user_prompt}

Rules:
- Use: const {{ chromium }} = require('playwright');
- If the user mentions "localhost" without a port, use "http://localhost:4200"
- Enable video recording using: process.env.VIDEO_DIR as the video output directory
- Add console.log() for every step (e.g. "Step 1: Opening browser", "Step 2: Navigating to login")
- Add console.log("PASS: <description>") for successful assertions
- Add console.log("FAIL: <description>") before throwing errors
- Use headless: false so the browser is visible during recording
- Include try/catch with browser.close() in a finally block
- Output ONLY raw JavaScript — no markdown code fences, no explanation

Use this exact structure:
const {{ chromium }} = require('playwright');
(async () => {{
  const videoDir = process.env.VIDEO_DIR || '/tmp/pw-videos';
  const browser = await chromium.launch({{ headless: false }});
  const context = await browser.newContext({{
    recordVideo: {{ dir: videoDir, size: {{ width: 1280, height: 720 }} }}
  }});
  const page = await context.newPage();
  try {{
    // test steps here
  }} finally {{
    await context.close();
    await browser.close();
  }}
}})().catch(e => {{ console.error('ERROR:', e.message); process.exit(1); }});"""
    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=60, cwd=WORK_DIR,
            env=clean_env,
        )
        script = result.stdout.strip()
        # Strip markdown fences if Claude added them anyway
        if script.startswith("```"):
            lines = script.splitlines()
            start = 1
            end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
            script = "\n".join(lines[start:end])
        return script
    except Exception as e:
        return ""


def run_playwright_test(script_content: str) -> tuple[str, str]:
    """Run a Playwright Node.js script, return (console_output, video_mp4_path)."""
    import glob
    import tempfile

    video_dir = tempfile.mkdtemp(prefix="pw-videos-")
    script_fd, script_path = tempfile.mkstemp(suffix=".js")
    try:
        with os.fdopen(script_fd, "w") as f:
            f.write(script_content)

        env = {
            **os.environ,
            "VIDEO_DIR": video_dir,
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + os.environ.get("PATH", ""),
        }

        result = subprocess.run(
            ["node", script_path],
            capture_output=True, text=True,
            timeout=120, cwd=WORK_DIR,
            env=env,
        )
        output = result.stdout.strip()
        if result.stderr.strip():
            output += "\n\nSTDERR:\n" + result.stderr.strip()

        # Find the recorded video
        videos = glob.glob(os.path.join(video_dir, "*.webm"))
        if not videos:
            return output, ""

        webm_path = videos[0]
        mp4_path = webm_path.replace(".webm", ".mp4")
        subprocess.run(
            ["ffmpeg", "-i", webm_path, "-c:v", "libx264", "-preset", "fast", "-y", mp4_path],
            capture_output=True, timeout=60,
        )
        video_path = mp4_path if os.path.exists(mp4_path) else webm_path
        return output, video_path

    except subprocess.TimeoutExpired:
        return "⏱ Test timed out after 120 seconds.", ""
    except Exception as e:
        return f"❌ Error running test: {e}", ""
    finally:
        if os.path.exists(script_path):
            os.unlink(script_path)


def generate_test_report(test_output: str, user_prompt: str) -> str:
    """Ask Claude to generate a structured test report from Playwright output."""
    prompt = f"""You are a senior QA engineer. Generate a beautiful structured test report.

Original test request:
{user_prompt}

Playwright console output:
{test_output}

Format the report exactly like this:

## 🧪 Test Report

### 📋 Summary
[One paragraph: what was tested, overall PASS or FAIL, key outcome]

### ✅ Steps Completed
[Bullet list of each step that ran successfully]

### ❌ Failures / Bugs Found
[For each failure:
- **Bug:** What happened
- **Expected:** What should have happened
- **Severity:** Critical / High / Medium / Low]

### 🔧 How to Fix
[For each bug, specific fix with code example if relevant]

### 📊 Result
**Overall: PASS ✅ / FAIL ❌**
- Total steps: X
- Passed: X
- Failed: X

Keep it concise and mobile-friendly."""
    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=60, cwd=WORK_DIR,
            env=clean_env,
        )
        return result.stdout.strip() or test_output
    except Exception:
        return test_output


def text_to_speech_hindi(text: str, output_file: str):
    """Generate Hindi TTS audio using edge-tts."""
    async def _tts(t: str, path: str):
        import edge_tts
        try:
            communicate = edge_tts.Communicate(t, "hi-IN-SwaraNeural")
            await communicate.save(path)
        except Exception:
            # Fallback voice
            communicate = edge_tts.Communicate(t, "en-IN-NeerjaNeural")
            await communicate.save(path)

    asyncio.run(_tts(text, output_file))


def natural_language_to_command(user_input: str) -> tuple[str, str]:
    """
    Ask Claude to convert natural language to a shell command.
    Returns (command, explanation) or raises on failure.
    """
    prompt = (
        f"Convert this natural language request into a single shell command for a Scala/Git project on macOS.\n"
        f"Request: {user_input}\n\n"
        f"Rules:\n"
        f"- Output ONLY the shell command on the first line, nothing else\n"
        f"- Second line onward: one-sentence explanation of what it does\n"
        f"- Use only safe, read-oriented commands (git, ls, cat, grep, find, ps, df, etc.)\n"
        f"- Never output rm, sudo, shutdown, or destructive commands\n"
        f"- If the request is ambiguous, pick the most likely intent\n"
        f"Example output:\n"
        f"git log --oneline -5\n"
        f"Shows the last 5 commits in compact form."
    )
    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=30, cwd=WORK_DIR,
            env=clean_env,
        )
        output = result.stdout.strip()
        if not output:
            return "", "Claude returned no response."
        lines = output.splitlines()
        command = lines[0].strip().strip("`")
        explanation = " ".join(lines[1:]).strip() if len(lines) > 1 else ""
        return command, explanation
    except FileNotFoundError:
        return "", "Claude CLI not found."
    except subprocess.TimeoutExpired:
        return "", "Claude timed out."


def run_via_claude(raw_cmd: str) -> str:
    """Pipe command + output through Claude CLI for a smart summary."""
    raw_output = run_command(raw_cmd)
    prompt = (
        f"I ran `{raw_cmd}` in my project directory.\n"
        f"Output:\n{raw_output}\n\n"
        "Summarize concisely what this tells me. Flag any issues."
    )
    try:
        clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        result = subprocess.run(
            ["/opt/homebrew/bin/claude", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=WORK_DIR,
            env=clean_env,
        )
        return result.stdout.strip() or result.stderr.strip() or "(no response from Claude)"
    except FileNotFoundError:
        return f"⚠️ Claude CLI not found. Raw output:\n{raw_output}"
    except subprocess.TimeoutExpired:
        return f"⏱ Claude timed out. Raw output:\n{raw_output}"


def chunk(text: str, size: int = MAX_OUTPUT_CHARS):
    """Split long messages into chunks for Telegram."""
    for i in range(0, len(text), size):
        yield text[i:i + size]


def auth_required(func):
    """Decorator: only allow messages from ALLOWED_USER_IDS."""
    async def wrapper(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        uid = update.effective_user.id
        if uid not in ALLOWED_USER_IDS:
            log.warning(f"Blocked unauthorized user {uid}")
            await update.message.reply_text("⛔ Unauthorized.")
            return
        return await func(update, ctx)
    return wrapper


# ── Conflict helpers ──────────────────────────────────────────────────────────

def get_conflicted_files() -> list[str]:
    """Return list of files currently in conflict state."""
    result = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=U"],
        cwd=WORK_DIR, capture_output=True, text=True
    )
    files = [f.strip() for f in result.stdout.strip().splitlines() if f.strip()]
    return files


def read_conflict_block(filepath: str) -> str:
    """Read a conflicted file and return its raw content."""
    full_path = os.path.join(WORK_DIR, filepath)
    try:
        with open(full_path, "r") as f:
            return f.read()
    except Exception as e:
        return f"(could not read file: {e})"


def parse_conflict_sections(content: str) -> list[dict]:
    """
    Parse conflict markers into structured sections.
    Returns list of: { ours, theirs, context_before }
    """
    pattern = re.compile(
        r'(?P<before>[^\n]*)\n?'
        r'<{7} (?P<ours_label>[^\n]+)\n'
        r'(?P<ours>.*?)'
        r'={7}\n'
        r'(?P<theirs>.*?)'
        r'>{7} (?P<theirs_label>[^\n]+)',
        re.DOTALL
    )
    sections = []
    for m in pattern.finditer(content):
        sections.append({
            "ours_label":   m.group("ours_label").strip(),
            "theirs_label": m.group("theirs_label").strip(),
            "ours":         m.group("ours").strip(),
            "theirs":       m.group("theirs").strip(),
        })
    return sections


def summarize_conflicts_via_claude(conflicted_files: list[str]) -> str:
    """
    Build a detailed prompt for Claude CLI covering all conflicted files
    and return Claude's plain-English summary + recommendations.
    """
    if not conflicted_files:
        return "✅ No merge conflicts found in the repository."

    file_sections = []
    for f in conflicted_files:
        content = read_conflict_block(f)
        sections = parse_conflict_sections(content)
        section_text = ""
        for i, s in enumerate(sections, 1):
            section_text += (
                f"\n  Conflict #{i}:\n"
                f"    OURS   ({s['ours_label']}):\n      {s['ours'][:300]}\n"
                f"    THEIRS ({s['theirs_label']}):\n      {s['theirs'][:300]}\n"
            )
        file_sections.append(f"File: {f}{section_text}")

    all_conflicts = "\n\n".join(file_sections)

    prompt = f"""I have merge conflicts in my Git repository.
Here are all the conflicted files and their conflict blocks:

{all_conflicts}

Please:
1. For each file, explain in plain English WHAT is conflicting (what changed on each side)
2. Give a clear recommendation: keep OURS, keep THEIRS, or merge both
3. Flag any conflicts that look risky or need manual review
4. End with a one-line summary: how many files, complexity (simple/moderate/complex)

Keep the response concise and mobile-friendly."""

    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=90, cwd=WORK_DIR,
            env=clean_env,
        )
        return result.stdout.strip() or result.stderr.strip() or "(no response from Claude)"
    except FileNotFoundError:
        # Fallback: return structured raw summary without Claude
        lines = [f"⚠️ Claude CLI not found. Raw conflict summary:\n"]
        for f in conflicted_files:
            sections = parse_conflict_sections(read_conflict_block(f))
            lines.append(f"📄 *{f}* — {len(sections)} conflict(s)")
            for i, s in enumerate(sections, 1):
                lines.append(
                    f"  #{i} OURS: {s['ours'][:80]}...\n"
                    f"      THEIRS: {s['theirs'][:80]}..."
                )
        return "\n".join(lines)
    except subprocess.TimeoutExpired:
        return "⏱ Claude timed out analyzing conflicts. Try /conflicts again."


def auto_resolve_via_claude(conflicted_files: list[str]) -> str:
    """Ask Claude CLI to resolve all conflicts and rewrite files."""
    if not conflicted_files:
        return "✅ No conflicts to resolve."

    results = []
    for filepath in conflicted_files:
        content = read_conflict_block(filepath)
        prompt = f"""This file has merge conflicts. Resolve them intelligently,
preserving correct logic from both sides where possible.
Return ONLY the fully resolved file content with NO conflict markers.
Do not explain — just output the clean file.

File: {filepath}
Content:
{content}"""
        clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        try:
            result = subprocess.run(
                ["/opt/homebrew/bin/claude", "-p", prompt],
                capture_output=True, text=True,
                timeout=90, cwd=WORK_DIR,
                env=clean_env,
            )
            resolved = result.stdout.strip()
            if resolved and "<<<<<<" not in resolved:
                full_path = os.path.join(WORK_DIR, filepath)
                with open(full_path, "w") as f:
                    f.write(resolved)
                # Stage the resolved file
                subprocess.run(["git", "add", filepath], cwd=WORK_DIR)
                results.append(f"✅ Resolved & staged: `{filepath}`")
            else:
                results.append(f"⚠️ Could not auto-resolve: `{filepath}` — needs manual review")
        except Exception as e:
            results.append(f"❌ Error resolving `{filepath}`: {e}")

    # Attempt commit
    commit_result = subprocess.run(
        ["git", "commit", "-m", "resolve: auto-resolved merge conflicts via Claude"],
        cwd=WORK_DIR, capture_output=True, text=True
    )
    if commit_result.returncode == 0:
        results.append("\n✅ *Committed successfully!*")
        results.append("`git push` when ready.")
    else:
        results.append(f"\n⚠️ Commit skipped: {commit_result.stderr.strip()}")

    return "\n".join(results)


def solution_via_claude(conflicted_files: list[str]) -> str:
    """
    Deep educational analysis of each conflict:
    - What exactly changed on each side and WHY it conflicts
    - Step-by-step resolution options with pros/cons
    - Which option is safest for a Scala backend project
    - What the final resolved code would look like
    """
    if not conflicted_files:
        return "✅ No merge conflicts found — nothing to solve."

    file_sections = []
    for f in conflicted_files:
        content = read_conflict_block(f)
        sections = parse_conflict_sections(content)
        section_text = ""
        for i, s in enumerate(sections, 1):
            section_text += (
                f"\n  Conflict #{i}:\n"
                f"    OURS   ({s['ours_label']}):\n{s['ours']}\n"
                f"    THEIRS ({s['theirs_label']}):\n{s['theirs']}\n"
            )
        file_sections.append(f"File: {f}{section_text}")

    all_conflicts = "\n\n".join(file_sections)

    prompt = f"""I am a Scala backend developer. I have merge conflicts I want to UNDERSTAND
before resolving them myself. Do NOT resolve them for me — teach me how.

Conflicted files:
{all_conflicts}

For EACH conflict block in EACH file, give me:

1. 📖 WHAT HAPPENED
   - What did MY branch (OURS) change and why?
   - What did the INCOMING branch (THEIRS) change and why?
   - Why exactly do these two changes conflict?

2. 🔀 RESOLUTION OPTIONS
   For each option (keep ours / keep theirs / merge both / rewrite):
   - What would the final code look like?
   - What is the risk of choosing this?
   - What functionality might break?

3. ✅ RECOMMENDATION
   - Which option is safest given this is Scala backend code?
   - Any Scala-specific concerns (type safety, implicits, traits, etc.)?
   - Exact final code I should write to resolve this conflict

4. ⚠️ RISK LEVEL: Low / Medium / High
   Explain why.

Be detailed and educational. Format clearly for mobile reading.
Use short paragraphs, not walls of text."""

    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=120, cwd=WORK_DIR,
            env=clean_env,
        )
        return result.stdout.strip() or result.stderr.strip() or "(no response from Claude)"
    except FileNotFoundError:
        return "❌ Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
    except subprocess.TimeoutExpired:
        return "⏱ Claude timed out. Try again — conflicts may be too large for one request."


# ── Handlers ──────────────────────────────────────────────────────────────────

@auth_required
async def cmd_test(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/test <prompt> — Generate & run a Playwright test, send video + report."""
    if not ctx.args:
        await update.message.reply_text(
            "Usage: `/test <what to test>`\n"
            "Example: `/test login to the app and submit an appreciation message`",
            parse_mode="Markdown"
        )
        return

    user_prompt = " ".join(ctx.args)
    loop = asyncio.get_event_loop()

    await update.message.reply_text("🤖 Generating Playwright test script...")
    script = await loop.run_in_executor(None, generate_playwright_script, user_prompt)
    if not script:
        await update.message.reply_text("❌ Failed to generate test script.")
        return

    await update.message.reply_text("▶️ Running test in browser — this may take up to 2 minutes...")
    test_output, video_path = await loop.run_in_executor(None, run_playwright_test, script)

    await update.message.reply_text("📝 Generating test report...")
    report = await loop.run_in_executor(None, generate_test_report, test_output, user_prompt)

    for part in chunk(report):
        await update.message.reply_text(part, parse_mode="Markdown")

    if video_path and os.path.exists(video_path):
        await update.message.reply_text("🎥 Sending test recording...")
        with open(video_path, "rb") as f:
            await update.message.reply_video(video=f, caption="🎬 Playwright Test Recording")
        os.unlink(video_path)
    else:
        await update.message.reply_text("⚠️ No video was recorded.")


@auth_required
async def cmd_terminal_on(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/terminal_on — switch to terminal mode (NL → command → Y/N)."""
    uid = update.effective_user.id
    TERMINAL_MODE[uid] = True
    PENDING_COMMANDS.pop(uid, None)
    await update.message.reply_text(
        "⚡ *Terminal mode ON*\n"
        "Voice/text will be converted to shell commands with Y/N confirmation.",
        parse_mode="Markdown"
    )


@auth_required
async def cmd_terminal_off(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/terminal_off — switch to chat mode (Claude conversation + Hindi audio)."""
    uid = update.effective_user.id
    TERMINAL_MODE[uid] = False
    PENDING_COMMANDS.pop(uid, None)
    await update.message.reply_text(
        "💬 *Chat mode ON* (terminal OFF)\n"
        "Voice/text will go to Claude chat. You'll get a full English reply + Hindi audio summary.",
        parse_mode="Markdown"
    )


@auth_required
async def cmd_status(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/status — show current mode and pending command state."""
    uid = update.effective_user.id
    mode = TERMINAL_MODE.get(uid, False)
    mode_str = "⚡ Terminal ON (command mode)" if mode else "💬 Chat mode (terminal OFF)"
    pending = PENDING_COMMANDS.get(uid)
    pending_str = f"\n⏳ Pending command: `{pending[0]}`" if pending else "\n✅ No pending commands."
    await update.message.reply_text(
        f"*Current mode:* {mode_str}{pending_str}",
        parse_mode="Markdown"
    )


async def handle_chat_mode(update: Update, ctx: ContextTypes.DEFAULT_TYPE, user_text: str):
    """Chat mode: send user text to Claude, reply with full English + Hindi audio summary."""
    await update.message.reply_text(f"📝 *You said:* _{user_text}_", parse_mode="Markdown")
    await update.message.reply_text("🧠 Thinking...")

    loop = asyncio.get_event_loop()
    full_reply = await loop.run_in_executor(None, chat_with_claude, user_text)

    for part in chunk(full_reply):
        await update.message.reply_text(part)

    await update.message.reply_text("🔊 Generating audio summary...")
    mp3_path = f"/tmp/{update.effective_user.id}_reply.mp3"
    try:
        await loop.run_in_executor(None, text_to_speech_hindi, full_reply, mp3_path)
        with open(mp3_path, "rb") as f:
            await update.message.reply_audio(audio=f, title="Claude - Hindi Summary")
    except Exception as e:
        await update.message.reply_text(f"⚠️ Hindi audio failed: {e}")
    finally:
        if os.path.exists(mp3_path):
            os.unlink(mp3_path)


@auth_required
async def cmd_remotecontrol(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /remotecontrol [session-name]
    Starts a Claude remote-control session on your Mac.
    Connect via claude.ai/code on mobile after starting.
    Optional: provide a session name, e.g. /remotecontrol my-session
    """
    global REMOTE_SESSION
    if REMOTE_SESSION.get("process") and REMOTE_SESSION["process"].poll() is None:
        await update.message.reply_text(
            "⚠️ A remote session is already running.\n"
            "Use /stopremote to end it first.",
            parse_mode="Markdown"
        )
        return

    name = " ".join(ctx.args) if ctx.args else "telegram-session"
    clean_env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        proc = subprocess.Popen(
            ["/opt/homebrew/bin/claude", "remote-control", "--name", name],
            cwd=WORK_DIR,
            env=clean_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        REMOTE_SESSION["process"] = proc
        REMOTE_SESSION["started_at"] = datetime.now(timezone.utc)
        await update.message.reply_text(
            "🟢 *Remote session started!*\n\n"
            f"📛 *Session name:* `{name}`\n"
            f"📁 *Directory:* `{WORK_DIR}`\n\n"
            "👉 Open *claude.ai/code* on your mobile to connect.\n\n"
            "Use /stopremote to end the session.",
            parse_mode="Markdown"
        )
    except Exception as e:
        await update.message.reply_text(f"❌ Failed to start remote session: {e}")


@auth_required
async def cmd_stopremote(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /stopremote
    Stops the currently running Claude remote-control session.
    """
    global REMOTE_SESSION
    proc = REMOTE_SESSION.get("process")
    if not proc or proc.poll() is not None:
        await update.message.reply_text("ℹ️ No remote session is currently running.")
        return
    proc.terminate()
    REMOTE_SESSION.clear()
    await update.message.reply_text("🔴 Remote session stopped.")


@auth_required
async def cmd_solution(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /solution
    Deep educational breakdown of every conflict — teaches you WHAT happened,
    WHY it conflicts, ALL resolution options with risks, and the exact
    recommended final code. Run this BEFORE /resolve so you understand
    what Claude will do.
    """
    await update.message.reply_text("🎓 Analyzing conflicts in depth — this may take ~30s...")

    loop = asyncio.get_event_loop()
    conflicted_files = await loop.run_in_executor(None, get_conflicted_files)

    if not conflicted_files:
        await update.message.reply_text(
            "✅ *No conflicts found!*\nRun `/merge <branch>` first to trigger a merge.",
            parse_mode="Markdown"
        )
        return

    file_list = "\n".join(f"  • `{f}`" for f in conflicted_files)
    await update.message.reply_text(
        f"📚 *Deep-analyzing {len(conflicted_files)} conflicted file(s):*\n{file_list}\n\n"
        "🤖 Claude is reading all conflict blocks and preparing a detailed explanation...",
        parse_mode="Markdown"
    )

    analysis = await loop.run_in_executor(None, solution_via_claude, conflicted_files)

    for part in chunk(analysis):
        await update.message.reply_text(part, parse_mode="Markdown")

    await update.message.reply_text(
        "💡 *Now you understand the conflicts. Next:*\n\n"
        "• `/resolve` — let Claude apply the recommended fixes & commit\n"
        "• Open *Mobile Claude app* — describe exactly which option to apply per file\n"
        "• Or edit manually on Mac, then `git add . && git commit`",
        parse_mode="Markdown"
    )


@auth_required
async def cmd_commands(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /commands
    Lists every available bot command with a description of what it does,
    when to use it, and any arguments it accepts.
    """
    msg = (
        "📋 *All Available Commands*\n"
        "━━━━━━━━━━━━━━━━━━━━━\n\n"

        "*🔍 Status & Inspection*\n\n"

        "`/online`\n"
        "Checks if the bot and backend services are reachable. "
        "Reports bot uptime, Play backend status (port 9000), and MySQL connectivity.\n\n"

        "`/gitstatus`\n"
        "Quick mobile-friendly snapshot: current branch, conflict list, "
        "short file status, and last 3 commits. Use this any time to get your bearings.\n\n"

        "`/conflicts`\n"
        "Scans for conflicted files and asks Claude for a plain-English summary "
        "of what is clashing on each side, plus a quick recommendation. "
        "Use this right after a merge returns CONFLICT output.\n\n"

        "`/solution`\n"
        "Deep educational breakdown of every conflict block. For each one Claude explains: "
        "what changed on each side, why it conflicts, all resolution options with risks, "
        "and the exact final code to write. "
        "Run this BEFORE `/resolve` so you fully understand what will happen.\n\n"

        "━━━━━━━━━━━━━━━━━━━━━\n"
        "*🔀 Merge & Resolution*\n\n"

        "`/merge <branch>`\n"
        "Merges the given branch into your current branch, then automatically "
        "checks for conflicts and tells you what to do next. "
        "Example: `/merge feature/payment-service`\n\n"

        "`/resolve`\n"
        "Auto-resolves ALL current conflicts using Claude — rewrites each file, "
        "stages it with `git add`, and commits. "
        "Only run this after reading `/solution` and you're confident Claude can handle it. "
        "Always review with `git show HEAD` before pushing.\n\n"

        "━━━━━━━━━━━━━━━━━━━━━\n"
        "*⚙️ Configuration*\n\n"

        "`/setdir <path>`\n"
        "Changes the working directory for all subsequent commands in this session. "
        "Example: `/setdir ~/projects/my-scala-service`\n"
        "Run `/setdir` with no argument to see the current directory.\n\n"

        "`/terminal_on`\n"
        "Switch to terminal mode: voice/text → NL → shell command → Y/N confirmation.\n\n"

        "`/terminal_off`\n"
        "Switch to chat mode (default): voice/text → Claude conversation → full English reply + Hindi female audio summary via edge-tts.\n\n"

        "`/status`\n"
        "Show your current mode (terminal or chat) and whether a command is awaiting confirmation.\n\n"

        "`/commands`\n"
        "Shows this list.\n\n"

        "`/help`\n"
        "Shows allowed raw shell command prefixes and current config.\n\n"

        "━━━━━━━━━━━━━━━━━━━━━\n"
        "*💬 Raw Shell Commands*\n\n"

        "`<any whitelisted command>`\n"
        "Type a shell command directly (e.g. `git log --oneline -5`, `ls -la`, `sbt compile`) "
        "and it runs on your Mac, returning raw output.\n\n"

        "`!claude <command>`\n"
        "Same as above but pipes the output through Claude CLI, which summarizes "
        "and explains the result in plain English. "
        "Example: `!claude git log --oneline -10`\n\n"

        "━━━━━━━━━━━━━━━━━━━━━\n"
        "*🗺 Recommended Workflow*\n"
        "`/gitstatus` → `/merge <branch>` → `/conflicts` → `/solution` → `/resolve` → `git push origin <branch>`"
    )

    for part in chunk(msg):
        await update.message.reply_text(part, parse_mode="Markdown")


@auth_required
async def cmd_conflicts(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /conflicts
    Scans the repo for merge conflicts and asks Claude to summarize each one
    in plain English with resolution recommendations.

    WHEN TO USE:
      After you run `git merge <branch>` and see "CONFLICT" in the output.
    """
    await update.message.reply_text("🔍 Scanning for merge conflicts...")

    loop = asyncio.get_event_loop()
    conflicted_files = await loop.run_in_executor(None, get_conflicted_files)

    if not conflicted_files:
        await update.message.reply_text(
            "✅ *No merge conflicts found!*\n"
            "Your working tree is clean.",
            parse_mode="Markdown"
        )
        return

    file_list = "\n".join(f"  • `{f}`" for f in conflicted_files)
    await update.message.reply_text(
        f"⚠️ *{len(conflicted_files)} conflicted file(s) found:*\n{file_list}\n\n"
        f"🤖 Asking Claude to analyze...",
        parse_mode="Markdown"
    )

    summary = await loop.run_in_executor(None, summarize_conflicts_via_claude, conflicted_files)

    for part in chunk(summary):
        await update.message.reply_text(part, parse_mode="Markdown")

    await update.message.reply_text(
        "💡 *Next steps:*\n"
        "• `/resolve` — let Claude auto-resolve & commit all conflicts\n"
        "• Or open Mobile Claude app to resolve manually with full context",
        parse_mode="Markdown"
    )


@auth_required
async def cmd_merge(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /merge <branch-name>
    Merges the given branch into your current branch and immediately
    runs conflict detection if conflicts occur.

    WHEN TO USE:
      Instead of typing `git merge <branch>` manually — this auto-checks
      for conflicts after the merge attempt.

    Example: /merge feature/payment-service
    """
    if not ctx.args:
        await update.message.reply_text(
            "Usage: `/merge <branch-name>`\nExample: `/merge feature/payment-service`",
            parse_mode="Markdown"
        )
        return

    branch = ctx.args[0].strip()
    await update.message.reply_text(f"🔀 Merging `{branch}` into current branch...", parse_mode="Markdown")

    loop = asyncio.get_event_loop()
    output = await loop.run_in_executor(None, run_command, f"git merge {branch}")

    for part in chunk(output):
        await update.message.reply_text(f"```\n{part}\n```", parse_mode="Markdown")

    # Auto-detect conflicts after merge
    conflicted_files = await loop.run_in_executor(None, get_conflicted_files)
    if conflicted_files:
        await update.message.reply_text(
            f"⚠️ *Merge conflicts detected in {len(conflicted_files)} file(s)!*\n\n"
            "Run `/conflicts` to get a Claude summary\n"
            "Run `/resolve` to auto-resolve with Claude",
            parse_mode="Markdown"
        )
    else:
        await update.message.reply_text("✅ *Merge completed with no conflicts!*", parse_mode="Markdown")


@auth_required
async def cmd_resolve(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /resolve
    Automatically resolves ALL current merge conflicts using Claude CLI.
    Claude reads each conflicted file, picks the best resolution,
    rewrites the file, stages it, and commits.

    WHEN TO USE:
      After `/conflicts` shows you the summary and you're confident
      Claude can handle them. For complex/risky conflicts, use
      Mobile Claude app instead for manual resolution.

    ⚠️ Review the commit before pushing: `git show HEAD`
    """
    await update.message.reply_text("🔍 Checking for conflicts to resolve...")

    loop = asyncio.get_event_loop()
    conflicted_files = await loop.run_in_executor(None, get_conflicted_files)

    if not conflicted_files:
        await update.message.reply_text("✅ No conflicts found — nothing to resolve.")
        return

    file_list = "\n".join(f"  • `{f}`" for f in conflicted_files)
    await update.message.reply_text(
        f"🤖 *Auto-resolving {len(conflicted_files)} file(s) via Claude:*\n{file_list}\n\n"
        "This may take 30–60 seconds...",
        parse_mode="Markdown"
    )

    result = await loop.run_in_executor(None, auto_resolve_via_claude, conflicted_files)

    for part in chunk(result):
        await update.message.reply_text(part, parse_mode="Markdown")

    await update.message.reply_text(
        "💡 *Review before pushing:*\n"
        "`git show HEAD` — see what Claude committed\n"
        "`git push origin <branch>` — push when satisfied",
        parse_mode="Markdown"
    )


@auth_required
async def cmd_gitstatus(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /gitstatus
    Quick decorated git status — shows branch, staged files,
    conflicts, and untracked files in a mobile-friendly format.

    WHEN TO USE: Any time. Your quick pulse check from mobile.
    """
    loop = asyncio.get_event_loop()

    branch    = await loop.run_in_executor(None, run_command, "git branch --show-current")
    status    = await loop.run_in_executor(None, run_command, "git status --short")
    conflicts = await loop.run_in_executor(None, get_conflicted_files)
    log_line  = await loop.run_in_executor(None, run_command, "git log --oneline -3")

    conflict_line = (
        f"⚠️ *Conflicts ({len(conflicts)}):*\n" + "\n".join(f"  • `{f}`" for f in conflicts)
        if conflicts else "✅ No conflicts"
    )

    msg = (
        f"🌿 *Branch:* `{branch.strip()}`\n\n"
        f"{conflict_line}\n\n"
        f"📋 *Status:*\n```\n{status or 'clean'}\n```\n\n"
        f"📜 *Last 3 commits:*\n```\n{log_line}\n```"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")



@auth_required
async def cmd_online(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """
    /online
    Checks if the bot and backend services are reachable.
    Reports bot uptime, Play backend status (port 9000), and DB connectivity.
    """
    now = datetime.now(timezone.utc)
    uptime = now - BOT_START_TIME
    hours, remainder = divmod(int(uptime.total_seconds()), 3600)
    minutes, seconds = divmod(remainder, 60)
    uptime_str = f"{hours}h {minutes}m {seconds}s"

    loop = asyncio.get_event_loop()

    # Check Play backend on port 9000
    backend_out = await loop.run_in_executor(
        None,
        lambda: run_command("curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:9000/api/users/0")
    )
    backend_code = backend_out.strip().strip("'")
    if backend_code in ("200", "400", "401", "403", "404"):
        backend_status = f"✅ Online (HTTP {backend_code})"
    elif backend_code == "(no output)" or not backend_code:
        backend_status = "❌ Unreachable (no response)"
    else:
        backend_status = f"⚠️ Responded with HTTP {backend_code}"

    # Check MySQL on port 3306
    db_out = await loop.run_in_executor(
        None,
        lambda: run_command("nc -z -w 2 localhost 3306 && echo ok || echo fail")
    )
    db_status = "✅ Online" if "ok" in db_out else "❌ Unreachable"

    msg = (
        "🟢 *Bot Status: ONLINE*\n"
        f"⏱ *Uptime:* `{uptime_str}`\n"
        f"🕐 *Started:* `{BOT_START_TIME.strftime('%Y-%m-%d %H:%M:%S')} UTC`\n\n"
        "━━━━━━━━━━━━━━━━━━━━━\n"
        "*🖥 Services*\n\n"
        f"🎮 *Play backend (9000):* {backend_status}\n"
        f"🗄 *MySQL (3306):* {db_status}\n\n"
        f"📁 *Work dir:* `{WORK_DIR}`\n"
        f"🤖 *Claude mode:* {'on' if USE_CLAUDE else 'off'}"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")


@auth_required
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 *Claude Bridge active.*\n\n"
        "Send any whitelisted shell command and I'll run it on your Mac.\n"
        "Prefix with `!claude` to pipe through Claude CLI.\n\n"
        "*🔀 Git conflict workflow:*\n"
        "`/merge <branch>` — merge & auto-detect conflicts\n"
        "`/conflicts` — summarize all conflicts via Claude\n"
        "`/resolve` — auto-resolve & commit all conflicts\n"
        "`/gitstatus` — quick mobile-friendly status\n\n"
        "*⚙️ Raw commands:*\n"
        "`git status` · `git log --oneline -5` · `ls -la`\n"
        "`!claude git status` — Claude-powered summary\n\n"
        "Type `/help` for full command list.",
        parse_mode="Markdown"
    )


@auth_required
async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    allowed_list = ", ".join(f"`{p}`" for p in sorted(ALLOWED_PREFIXES))
    await update.message.reply_text(
        "*📋 How to use this bot:*\n\n"
        "*💬 Plain text → natural language*\n"
        "Just type what you want in plain English:\n"
        "`show me the last 5 commits`\n"
        "`what files changed recently?`\n"
        "Claude will suggest a command and ask for y/n confirmation.\n\n"
        "*⚡ Raw shell commands → prefix with /*\n"
        "`/git status` — runs git status directly\n"
        "`/ls -la` — lists files\n\n"
        "*🤖 Claude summary → prefix with !claude*\n"
        "`!claude git log --oneline -5` — runs + explains output\n\n"
        "*📌 Built-in commands:*\n"
        "`/online` — check bot & service status\n"
        "`/gitstatus` — branch, conflicts, last 3 commits\n"
        "`/merge <branch>` — merge branch + conflict check\n"
        "`/conflicts` — Claude analyzes all conflicts\n"
        "`/solution` — deep educational conflict breakdown\n"
        "`/resolve` — Claude auto-resolves & commits\n"
        "`/remotecontrol [name]` — start Claude remote session\n"
        "`/stopremote` — stop the running remote session\n"
        "`/screenshot` — capture & send desktop screenshot\n"
        "`/setdir <path>` — change working directory\n"
        "`/terminal_on` — switch to terminal/command mode\n"
        "`/terminal_off` — switch to chat mode (Claude + Hindi audio)\n"
        "`/status` — show current mode & pending commands\n"
        "`/test <prompt>` — generate & run Playwright test, get video + report\n"
        "`/commands` — full command reference\n\n"
        f"*✅ Allowed shell prefixes:*\n{allowed_list}\n\n"
        f"*📁 Working directory:* `{WORK_DIR}`",
        parse_mode="Markdown"
    )


@auth_required
async def cmd_setdir(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global WORK_DIR
    if not ctx.args:
        await update.message.reply_text(f"Current dir: `{WORK_DIR}`", parse_mode="Markdown")
        return
    new_dir = os.path.expanduser(" ".join(ctx.args))
    if not os.path.isdir(new_dir):
        await update.message.reply_text(f"❌ Directory not found: `{new_dir}`", parse_mode="Markdown")
        return
    WORK_DIR = new_dir
    await update.message.reply_text(f"✅ Working dir set to `{WORK_DIR}`", parse_mode="Markdown")


@auth_required
async def handle_shell_command(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Catch-all for /xyz style raw shell commands (e.g. /git status, /ls -la)."""
    parts = update.message.text.split()
    cmd = parts[0][1:]  # strip leading /
    if ctx.args:
        cmd = cmd + " " + " ".join(ctx.args)
    if not is_allowed(cmd):
        await update.message.reply_text(
            f"⛔ Command not allowed: `{cmd}`\nUse /help to see whitelisted prefixes.",
            parse_mode="Markdown"
        )
        return
    await update.message.reply_text(f"⚙️ Running: `{cmd}`...", parse_mode="Markdown")
    loop = asyncio.get_event_loop()
    output = await loop.run_in_executor(None, run_command, cmd)
    for part in chunk(output):
        await update.message.reply_text(f"```\n{part}\n```", parse_mode="Markdown")


def transcribe_audio(ogg_path: str) -> str:
    """Transcribe an audio file using local Whisper model."""
    import whisper
    os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "")
    model = whisper.load_model("base")
    result = model.transcribe(ogg_path, language="en")
    return result["text"].strip()


@auth_required
async def handle_voice(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Handle voice messages: transcribe with Whisper, then process as text."""
    await update.message.reply_text("🎙 Transcribing voice message...")

    voice = update.message.voice
    file = await ctx.bot.get_file(voice.file_id)

    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
        ogg_path = tmp.name

    try:
        await file.download_to_drive(ogg_path)
        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(None, transcribe_audio, ogg_path)
    except Exception as e:
        await update.message.reply_text(f"❌ Transcription failed: {e}")
        return
    finally:
        os.unlink(ogg_path)

    if not text:
        await update.message.reply_text("❌ Could not transcribe audio.")
        return

    uid = update.effective_user.id
    if TERMINAL_MODE.get(uid, False):
        await update.message.reply_text(f"📝 *Heard:* _{text}_", parse_mode="Markdown")
        await process_text_message(update, ctx, text)
    else:
        await handle_chat_mode(update, ctx, text)


async def process_text_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE, text: str):
    """Core message processing logic shared by text and voice handlers."""
    uid = update.effective_user.id

    # Handle pending y/n confirmation for NL commands
    if uid in PENDING_COMMANDS:
        answer = text.strip().lower().strip(".,!?")
        if answer in ("y", "yes"):
            command, explanation = PENDING_COMMANDS.pop(uid)
            await update.message.reply_text(f"⚙️ Running: `{command}`...", parse_mode="Markdown")
            loop = asyncio.get_event_loop()
            output = await loop.run_in_executor(None, run_command, command)
            for part in chunk(output):
                await update.message.reply_text(f"```\n{part}\n```", parse_mode="Markdown")
        elif answer in ("n", "no"):
            PENDING_COMMANDS.pop(uid)
            await update.message.reply_text("❌ Cancelled.")
        else:
            await update.message.reply_text("Reply *y / yes* to execute or *n / no* to cancel.", parse_mode="Markdown")
        return

    # !claude prefix: run command + Claude summarizes output
    if text.startswith("!claude "):
        cmd = text[len("!claude "):].strip()
        if not is_allowed(cmd):
            await update.message.reply_text(f"⛔ Not allowed: `{cmd}`", parse_mode="Markdown")
            return
        await update.message.reply_text(f"⚙️ Running: `{cmd}`...", parse_mode="Markdown")
        loop = asyncio.get_event_loop()
        output = await loop.run_in_executor(None, run_via_claude, cmd)
        for part in chunk(output):
            await update.message.reply_text(f"```\n{part}\n```", parse_mode="Markdown")
        return

    # If terminal mode is OFF, route to chat mode
    if not TERMINAL_MODE.get(uid, False):
        if not text:
            return
        await handle_chat_mode(update, ctx, text)
        return

    # Terminal mode ON: natural language → command → y/n confirm
    if not text:
        return
    await update.message.reply_text("🧠 Interpreting...", parse_mode="Markdown")
    loop = asyncio.get_event_loop()
    command, explanation = await loop.run_in_executor(None, natural_language_to_command, text)
    if not command:
        await update.message.reply_text(f"❌ Could not interpret: {explanation}")
        return
    if not is_allowed(command):
        await update.message.reply_text(
            f"⛔ Suggested `{command}` is not whitelisted.\n_{explanation}_",
            parse_mode="Markdown"
        )
        return
    PENDING_COMMANDS[uid] = (command, explanation)
    await update.message.reply_text(
        f"🤖 *Suggested command:*\n`{command}`\n\n"
        f"📖 *What it does:*\n{explanation}\n\n"
        f"Reply *yes* (or say it) to execute, *no* to cancel.",
        parse_mode="Markdown"
    )


@auth_required
async def handle_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await process_text_message(update, ctx, update.message.text.strip())


@auth_required
async def cmd_screenshot(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📸 Capturing screen...")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        path = tmp.name
    try:
        subprocess.run(["screencapture", "-x", path], check=True)
        with open(path, "rb") as f:
            await update.message.reply_photo(photo=f, caption="🖥 Desktop screenshot")
    except Exception as e:
        await update.message.reply_text(f"❌ Screenshot failed: {e}")
    finally:
        os.unlink(path)


# ── Screen recorder (segmented) ───────────────────────────────────────────────

_ffmpeg_proc = None  # type: Optional[subprocess.Popen]


@auth_required
async def cmd_record(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global _ffmpeg_proc
    arg = (ctx.args[0].lower() if ctx.args else "").strip()

    if arg == "start":
        if _ffmpeg_proc and _ffmpeg_proc.poll() is None:
            await update.message.reply_text("⚠️ Recording already in progress.")
            return
        videos_dir = os.path.join(PLAYWRIGHT_DIR, "videos")
        os.makedirs(videos_dir, exist_ok=True)
        ffmpeg_bin = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
        segment_pattern = os.path.join(videos_dir, "rec_%03d.mp4")
        _ffmpeg_proc = subprocess.Popen(
            [
                ffmpeg_bin,
                "-f", "avfoundation", "-capture_cursor", "1", "-r", "15", "-i", "0",
                "-c:v", "libx264", "-crf", "32", "-preset", "ultrafast",
                "-f", "segment", "-segment_time", "60", "-reset_timestamps", "1",
                "-segment_format_options", "movflags=+faststart",
                "-y", segment_pattern
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        await update.message.reply_text("🔴 Screen recording started — sending every 60s segment to you automatically.")

    elif arg == "stop":
        if _ffmpeg_proc and _ffmpeg_proc.poll() is None:
            _ffmpeg_proc.terminate()
            _ffmpeg_proc.wait(timeout=10)
            _ffmpeg_proc = None
            await update.message.reply_text("⏹ Recording stopped. Final segment will be sent shortly.")
        else:
            await update.message.reply_text("⚠️ No recording in progress.")
    else:
        await update.message.reply_text("Usage: /record start  or  /record stop")


# ── Playwright video watcher ──────────────────────────────────────────────────

import shutil

_seen_screenshots: set[str] = set()


async def watch_playwright_videos(app):
    """Background task: poll .playwright-mcp/ and .playwright-mcp/videos/ for new videos, auto-send to Telegram."""
    videos_subdir = os.path.join(PLAYWRIGHT_DIR, "videos")
    os.makedirs(PLAYWRIGHT_DIR, exist_ok=True)
    os.makedirs(videos_subdir, exist_ok=True)
    while True:
        await asyncio.sleep(3)
        search_dirs = [PLAYWRIGHT_DIR, videos_subdir]
        for search_dir in search_dirs:
            for ext in ("*.mp4", "*.webm"):
                for fpath in glob.glob(os.path.join(search_dir, ext)):
                    if fpath in _seen_videos:
                        continue
                    _seen_videos.add(fpath)
                    # Wait until no process has the file open (ffmpeg closed it = fully written)
                    for _ in range(60):  # up to 2 minutes
                        await asyncio.sleep(2)
                        if os.path.getsize(fpath) == 0:
                            continue
                        result = subprocess.run(["lsof", fpath], capture_output=True)
                        if result.returncode != 0:  # no process has it open
                            break
                    if os.path.getsize(fpath) == 0:
                        log.warning(f"Video still empty after wait, skipping: {fpath}")
                        continue
                    # For .webm (Playwright recordings): convert to mp4 with faststart
                    # For .mp4 (screen recordings): already have faststart from segment_format_options
                    send_path = fpath
                    tmp_path = fpath + ".sending.mp4"
                    if fpath.endswith(".webm"):
                        try:
                            ffmpeg_bin = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
                            subprocess.run(
                                [ffmpeg_bin, "-i", fpath, "-c:v", "libx264", "-preset", "fast",
                                 "-movflags", "+faststart", "-y", tmp_path],
                                capture_output=True, timeout=120
                            )
                            if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                                send_path = tmp_path
                                log.info(f"Converted webm to mp4: {tmp_path}")
                        except Exception as e:
                            log.warning(f"ffmpeg conversion failed, sending original: {e}")
                    for attempt in range(3):
                        try:
                            for uid in ALLOWED_USER_IDS:
                                with open(send_path, "rb") as f:
                                    await app.bot.send_video(
                                        chat_id=uid,
                                        video=f,
                                        caption="🎬 Playwright test recording (auto-detected)",
                                        read_timeout=120,
                                        write_timeout=120,
                                        connect_timeout=30,
                                    )
                            log.info(f"Auto-sent video: {send_path}")
                            # Move mp4 to project .playwright-mcp/videos/ for reference
                            project_videos_dir = os.path.join(WORK_DIR, ".playwright-mcp", "videos")
                            os.makedirs(project_videos_dir, exist_ok=True)
                            dest = os.path.join(project_videos_dir, os.path.basename(send_path))
                            shutil.move(send_path, dest)
                            log.info(f"Moved video to project: {dest}")
                            # Clean up temp and original source files
                            for f_del in [fpath, tmp_path]:
                                if f_del != dest and os.path.exists(f_del):
                                    try:
                                        os.unlink(f_del)
                                    except Exception:
                                        pass
                            break
                        except Exception as e:
                            log.warning(f"Attempt {attempt+1} failed for {send_path}: {e}")
                            if attempt < 2:
                                await asyncio.sleep(5)
                            else:
                                log.error(f"All attempts failed for {send_path}")


async def watch_playwright_screenshots(app):
    """Background task: poll .playwright-mcp/ for new screenshots, auto-send to Telegram."""
    os.makedirs(PLAYWRIGHT_DIR, exist_ok=True)
    while True:
        await asyncio.sleep(3)
        for fpath in glob.glob(os.path.join(PLAYWRIGHT_DIR, "*.png")):
            if fpath in _seen_screenshots:
                continue
            _seen_screenshots.add(fpath)
            await asyncio.sleep(1)
            try:
                for uid in ALLOWED_USER_IDS:
                    with open(fpath, "rb") as f:
                        await app.bot.send_photo(
                            chat_id=uid,
                            photo=f,
                            caption=f"📸 {os.path.basename(fpath)}"
                        )
                log.info(f"Auto-sent screenshot: {fpath}")
                # Move to project .playwright-mcp/ for reference
                project_ss_dir = os.path.join(WORK_DIR, ".playwright-mcp")
                os.makedirs(project_ss_dir, exist_ok=True)
                dest = os.path.join(project_ss_dir, os.path.basename(fpath))
                if os.path.abspath(fpath) != os.path.abspath(dest):
                    shutil.move(fpath, dest)
            except Exception as e:
                log.error(f"Failed to send screenshot {fpath}: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not TELEGRAM_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set in .env")
    if not ALLOWED_USER_IDS:
        raise RuntimeError("ALLOWED_USER_IDS not set in .env")

    log.info(f"Starting bot | work_dir={WORK_DIR} | claude_mode={USE_CLAUDE}")

    async def post_init(app):
        asyncio.create_task(watch_playwright_videos(app))
        asyncio.create_task(watch_playwright_screenshots(app))

    app = ApplicationBuilder().token(TELEGRAM_TOKEN).post_init(post_init).build()

    app.add_handler(CommandHandler("start",      cmd_start))
    app.add_handler(CommandHandler("help",       cmd_help))
    app.add_handler(CommandHandler("online",     cmd_online))
    app.add_handler(CommandHandler("setdir",     cmd_setdir))
    app.add_handler(CommandHandler("gitstatus",  cmd_gitstatus))
    app.add_handler(CommandHandler("conflicts",  cmd_conflicts))
    app.add_handler(CommandHandler("solution",   cmd_solution))
    app.add_handler(CommandHandler("commands",   cmd_commands))
    app.add_handler(CommandHandler("merge",      cmd_merge))
    app.add_handler(CommandHandler("resolve",       cmd_resolve))
    app.add_handler(CommandHandler("remotecontrol", cmd_remotecontrol))
    app.add_handler(CommandHandler("stopremote",    cmd_stopremote))
    app.add_handler(CommandHandler("screenshot",    cmd_screenshot))
    app.add_handler(CommandHandler("record",        cmd_record))
    app.add_handler(CommandHandler("terminal_on",   cmd_terminal_on))
    app.add_handler(CommandHandler("terminal_off",  cmd_terminal_off))
    app.add_handler(CommandHandler("status",        cmd_status))
    app.add_handler(CommandHandler("test",          cmd_test))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(MessageHandler(filters.COMMAND, handle_shell_command))

    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()