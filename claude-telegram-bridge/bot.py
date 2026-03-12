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
import re
import subprocess
import logging
import asyncio
import shlex
from pathlib import Path
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN   = os.getenv("TELEGRAM_BOT_TOKEN")
ALLOWED_USER_IDS = set(map(int, os.getenv("ALLOWED_USER_IDS", "").split(",")))
WORK_DIR         = os.path.expanduser(os.getenv("WORK_DIR", "~"))
USE_CLAUDE       = os.getenv("USE_CLAUDE", "false").lower() == "true"
MAX_OUTPUT_CHARS = 4000   # Telegram message limit is ~4096

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


def run_via_claude(raw_cmd: str) -> str:
    """Pipe command + output through Claude CLI for a smart summary."""
    raw_output = run_command(raw_cmd)
    prompt = (
        f"I ran `{raw_cmd}` in my project directory.\n"
        f"Output:\n{raw_output}\n\n"
        "Summarize concisely what this tells me. Flag any issues."
    )
    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=WORK_DIR,
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

    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=90, cwd=WORK_DIR,
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
        try:
            result = subprocess.run(
                ["claude", "-p", prompt],
                capture_output=True, text=True,
                timeout=90, cwd=WORK_DIR,
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

    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True, text=True,
            timeout=120, cwd=WORK_DIR,
        )
        return result.stdout.strip() or result.stderr.strip() or "(no response from Claude)"
    except FileNotFoundError:
        return "❌ Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
    except subprocess.TimeoutExpired:
        return "⏱ Claude timed out. Try again — conflicts may be too large for one request."


# ── Handlers ──────────────────────────────────────────────────────────────────

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
        "*📋 Slash Commands:*\n"
        "`/gitstatus` — branch, conflicts, last 3 commits\n"
        "`/merge <branch>` — merge branch + conflict check\n"
        "`/conflicts` — Claude analyzes all conflicts\n"
        "`/resolve` — Claude auto-resolves & commits\n"
        "`/setdir <path>` — change working directory\n\n"
        f"*✅ Allowed shell prefixes:*\n{allowed_list}\n\n"
        f"*📁 Working directory:* `{WORK_DIR}`\n"
        f"*🤖 Claude mode:* {'on (default)' if USE_CLAUDE else 'off — use `!claude` prefix per message'}",
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
async def handle_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    use_claude = USE_CLAUDE

    # Allow on-demand Claude mode with !claude prefix
    if text.startswith("!claude "):
        use_claude = True
        text = text[len("!claude "):].strip()

    if not text:
        return

    if not is_allowed(text):
        await update.message.reply_text(
            f"⛔ Command not allowed: `{text}`\n"
            "Use /help to see whitelisted prefixes.",
            parse_mode="Markdown"
        )
        return

    await update.message.reply_text(f"⚙️ Running: `{text}`...", parse_mode="Markdown")

    loop = asyncio.get_event_loop()
    if use_claude:
        output = await loop.run_in_executor(None, run_via_claude, text)
    else:
        output = await loop.run_in_executor(None, run_command, text)

    for part in chunk(output):
        await update.message.reply_text(f"```\n{part}\n```", parse_mode="Markdown")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not TELEGRAM_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set in .env")
    if not ALLOWED_USER_IDS:
        raise RuntimeError("ALLOWED_USER_IDS not set in .env")

    log.info(f"Starting bot | work_dir={WORK_DIR} | claude_mode={USE_CLAUDE}")
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start",      cmd_start))
    app.add_handler(CommandHandler("help",       cmd_help))
    app.add_handler(CommandHandler("setdir",     cmd_setdir))
    app.add_handler(CommandHandler("gitstatus",  cmd_gitstatus))
    app.add_handler(CommandHandler("conflicts",  cmd_conflicts))
    app.add_handler(CommandHandler("solution",   cmd_solution))
    app.add_handler(CommandHandler("commands",   cmd_commands))
    app.add_handler(CommandHandler("merge",      cmd_merge))
    app.add_handler(CommandHandler("resolve",    cmd_resolve))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()