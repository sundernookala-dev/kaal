# KAAL — Personal Time Management Agent

## Tech Stack
- Node.js/Express backend (server.js)
- SQLite database (kaal.db) via better-sqlite3
- Single-page frontend (public/index.html)
- Telegram bot (node-telegram-bot-api)
- Whisper for voice transcription
- Google Calendar API for meetings

## Key Files
- ~/kaal/server.js — backend (all APIs, bot, crons)
- ~/kaal/public/index.html — entire frontend (single file)
- ~/kaal/kaal.db — SQLite database
- ~/kaal/.env — TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PORT=3000
- ~/kaal/credentials.json — Google OAuth
- ~/kaal/token.json — Google auth token

## Whisper Path
CRITICAL: Whisper is at /Users/sunder/Library/Python/3.9/bin/whisper
After any server.js change, run:
sed -i '' "s|'whisper |'/Users/sunder/Library/Python/3.9/bin/whisper |g" server.js

## 8 Tabs
Meetings, Tasks, Habits, Vitamins, Hobbies, Kaaya, Sadhana, Settings

## Telegram Bot Commands
- Text/voice → adds as task
- "complete/done <task>" — marks done
- "start <task>" — in-progress
- "delete <task>" — removes
- "postpone <task> to tomorrow/next Monday"
- "add <task> for <date>"
- "nicotex" / "booti" / "babaji" — sadhana +1
- "weight 72.5" — log weight
- /tasks /meetings /digest /sadhana /add

## Sadhana Items
- Nicotex = nicotine gum (tab says "Sadhana", discreet)
- Babaji Ka Booti = weed (code name, keep private)

## Owner
Sunder, Udupi, Karnataka. Non-developer. MacBook user.
