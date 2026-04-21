#!/bin/bash
KAAL_DIR="$HOME/kaal"
PORT=3000
NODE="/opt/homebrew/bin/node"
GIT="/opt/homebrew/bin/git"

mkdir -p "$KAAL_DIR/logs"
cd "$KAAL_DIR" || { open "http://localhost:$PORT"; exit 0; }

# Pull latest from GitHub (silent, safe — skips if offline or local changes exist)
CODE_UPDATED=0
if [ -d "$KAAL_DIR/.git" ] && [ -x "$GIT" ]; then
    OLD_HEAD=$("$GIT" rev-parse HEAD 2>/dev/null)
    "$GIT" pull --quiet --ff-only origin main >> "$KAAL_DIR/logs/kaal.log" 2>> "$KAAL_DIR/logs/kaal-error.log"
    NEW_HEAD=$("$GIT" rev-parse HEAD 2>/dev/null)
    [ "$OLD_HEAD" != "$NEW_HEAD" ] && CODE_UPDATED=1
fi

SERVER_RUNNING=0
curl -s http://localhost:$PORT/api/health > /dev/null 2>&1 && SERVER_RUNNING=1

# If new code was pulled AND server is already running, restart it to pick up changes
if [ "$SERVER_RUNNING" = "1" ] && [ "$CODE_UPDATED" = "1" ]; then
    lsof -i :$PORT -t 2>/dev/null | xargs kill 2>/dev/null
    sleep 1
    SERVER_RUNNING=0
fi

# Start server if not running
if [ "$SERVER_RUNNING" = "0" ]; then
    "$NODE" server.js >> "$KAAL_DIR/logs/kaal.log" 2>> "$KAAL_DIR/logs/kaal-error.log" &

    for i in {1..20}; do
        if curl -s http://localhost:$PORT/api/health > /dev/null 2>&1; then
            break
        fi
        sleep 0.5
    done
fi

open "http://localhost:$PORT"
