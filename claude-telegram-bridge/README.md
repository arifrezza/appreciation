# Claude-Telegram Bridge 🤖

Run whitelisted shell commands on your Mac from your iPhone via Telegram.
Optionally pipe output through Claude CLI for intelligent summaries.

## Architecture

```
iPhone (Telegram) → Telegram Bot API → bot.py on your Mac → shell → response back
                                              ↓ (optional)
                                         Claude CLI
```

## Setup

### 1. Create a Telegram Bot
1. Open Telegram → search **@BotFather**
2. Send `/newbot` and follow prompts
3. Copy the **token** you receive

### 2. Get your Telegram User ID
1. Search **@userinfobot** on Telegram
2. Send `/start` — it replies with your numeric ID

### 3. Install

```bash
# Clone or copy files to your Mac, then:
chmod +x setup.sh
./setup.sh
```

### 4. Configure

```bash
nano ~/claude-telegram-bridge/.env
```

Fill in:
```
TELEGRAM_BOT_TOKEN=123456:ABC-your-token
ALLOWED_USER_IDS=987654321
WORK_DIR=~/your-scala-project
USE_CLAUDE=false
```

### 5. Restart the agent

```bash
launchctl unload  ~/Library/LaunchAgents/com.yourname.claude-telegram-bridge.plist
launchctl load    ~/Library/LaunchAgents/com.yourname.claude-telegram-bridge.plist
```

### 6. Test from Telegram

Send to your bot:
```
git status
git log --oneline -5
ls -la
sbt compile
```

For Claude-powered summaries:
```
!claude git status
!claude sbt test
```

Or set `USE_CLAUDE=true` in `.env` to always use Claude.

---

## Commands

| Telegram message | Action |
|---|---|
| `git status` | Raw output |
| `!claude git status` | Claude summarizes output |
| `/setdir ~/other-project` | Change working directory |
| `/help` | Show allowed commands |

## Whitelisted Prefixes (edit `bot.py` to customize)

`git`, `ls`, `pwd`, `cat`, `echo`, `sbt`, `scala`, `java`, `javac`, `mvn`, `gradle`, `curl`, `ping`, `df`, `du`, `ps`, `uname`, `whoami`, `date`, `which`, `find`, `grep`, `head`, `tail`, `wc`

## Logs

```bash
tail -f ~/claude-telegram-bridge/logs/bot.log
tail -f ~/claude-telegram-bridge/logs/bot.error.log
```

## Security Notes

- Only your Telegram user ID can send commands (enforced in `bot.py`)
- Commands are prefix-whitelisted — no arbitrary shell execution
- Explicit blocklist for dangerous patterns (`rm -rf /`, `sudo rm`, etc.)
- Bot token is stored in `.env`, never commit this file
