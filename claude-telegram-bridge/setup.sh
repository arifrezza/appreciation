#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — One-time setup for Claude-Telegram Bridge on macOS
# Usage: chmod +x setup.sh && ./setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="$HOME/claude-telegram-bridge"
PLIST_NAME="com.yourname.claude-telegram-bridge"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "📦 Setting up Claude-Telegram Bridge..."

# 1. Copy files to home directory if not already there
if [ "$(pwd)" != "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR/logs"
    cp bot.py requirements.txt .env.example "$INSTALL_DIR/"
    cp "$PLIST_NAME.plist" "$INSTALL_DIR/"
fi
mkdir -p "$INSTALL_DIR/logs"
cd "$INSTALL_DIR"

# 2. Create virtualenv
echo "🐍 Creating Python virtual environment..."
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo "✅ Dependencies installed."

# 3. Setup .env
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo "⚠️  Edit $INSTALL_DIR/.env and fill in:"
    echo "    TELEGRAM_BOT_TOKEN=..."
    echo "    ALLOWED_USER_IDS=..."
    echo "    WORK_DIR=~/your-project"
    echo ""
fi

# 4. Patch plist with real username
REAL_PYTHON="$INSTALL_DIR/venv/bin/python"
sed -i '' "s|/Users/YOUR_USERNAME|$HOME|g" "$INSTALL_DIR/$PLIST_NAME.plist"
echo "✅ Plist patched with your home directory."

# 5. Install launchd agent
cp "$INSTALL_DIR/$PLIST_NAME.plist" "$PLIST_DST"
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"
echo "✅ LaunchAgent installed and loaded."

echo ""
echo "────────────────────────────────────────"
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit $INSTALL_DIR/.env with your tokens"
echo "  2. Restart the agent:"
echo "     launchctl unload $PLIST_DST"
echo "     launchctl load   $PLIST_DST"
echo ""
echo "Useful commands:"
echo "  Logs:    tail -f $INSTALL_DIR/logs/bot.log"
echo "  Errors:  tail -f $INSTALL_DIR/logs/bot.error.log"
echo "  Stop:    launchctl unload $PLIST_DST"
echo "  Start:   launchctl load   $PLIST_DST"
echo "────────────────────────────────────────"
