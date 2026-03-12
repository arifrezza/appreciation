#!/usr/bin/env python3
"""
Claude-Telegram Bridge
Executes whitelisted commands on your local Mac and returns results via Telegram.
Optionally pipes through Claude CLI for intelligent responses.
"""

import os
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


# ── Handlers ──────────────────────────────────────────────────────────────────

@auth_required
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 *Claude Bridge active.*\n\n"
        "Send any whitelisted shell command and I'll run it on your Mac.\n"
        "Prefix with `!claude` to pipe through Claude CLI.\n\n"
        "Examples:\n"
        "`git status`\n"
        "`git log --oneline -5`\n"
        "`ls -la`\n"
        "`!claude git status`",
        parse_mode="Markdown"
    )


@auth_required
async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    allowed_list = ", ".join(f"`{p}`" for p in sorted(ALLOWED_PREFIXES))
    await update.message.reply_text(
        f"*Allowed command prefixes:*\n{allowed_list}\n\n"
        f"*Working directory:* `{WORK_DIR}`\n"
        f"*Claude mode:* {'on (default)' if USE_CLAUDE else 'off — prefix with `!claude` to enable'}\n\n"
        "Type `/setdir <path>` to change working directory for this session.",
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

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help",  cmd_help))
    app.add_handler(CommandHandler("setdir", cmd_setdir))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
