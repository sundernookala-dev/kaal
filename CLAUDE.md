# Kaal — Project Context for Claude Code

## What Kaal Is
A personal time management agent for Sunder. Runs locally on iMac.
- **Tasks** with dates and status (todo / in-progress / done)
- **Habits** with daily tracking
- **Vitamins** schedule
- **Hobbies** tracker
- **Sadhana** (personal spiritual practice tracking — keep names discreet)
- **Kaaya** (body/weight tracking)
- **Telegram bot** — Sunder sends tasks by text or voice message from phone
- **Google Calendar** — reads upcoming meetings and sends reminders via Telegram

## Location
```
~/kaal/
├── server.js          ← the entire backend (Express + SQLite + Telegram + Google Calendar)
├── public/
│   └── index.html     ← the entire frontend (single HTML file, all CSS+JS inside)
├── kaal.db            ← SQLite database — DO NOT DELETE
├── .env               ← secrets — DO NOT DELETE OR COMMIT
├── credentials.json   ← Google OAuth credentials — DO NOT DELETE OR COMMIT
├── token.json         ← Google auth token (auto-created on first auth)
├── extension/         ← Chrome extension files
│   ├── manifest.json
│   ├── popup.html
│   └── icons
├── package.json
└── scripts/
    └── Start_Kaal.command   ← double-click to launch on Mac
```

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: SQLite via `better-sqlite3`
- **Telegram**: `node-telegram-bot-api`
- **Calendar**: `googleapis`
- **Cron jobs**: `node-cron`
- **Voice transcription**: Whisper (Python, path below)

## How to Run
```bash
cd ~/kaal
npm install    # first time only
npm start      # starts at http://localhost:3000
```

## How to Stop
```bash
lsof -ti:3000 | xargs kill -9
```

## Environment Variables (in `.env`)
```
TELEGRAM_BOT_TOKEN=...    ← from @BotFather on Telegram
TELEGRAM_CHAT_ID=...      ← Sunder's personal chat ID
PORT=3000
```

## Google Calendar Setup
- `credentials.json` must be in `~/kaal/` (downloaded from Google Cloud Console)
- First time: run `npm run auth` — opens browser for OAuth
- Token saved to `token.json` automatically

## Whisper (Voice Transcription)
- Path: `/Users/sunder/Library/Python/3.9/bin/whisper`
- **Critical**: After any edit to `server.js`, run this to fix the path:
  ```bash
  sed -i '' "s|'whisper |'/Users/sunder/Library/Python/3.9/bin/whisper |g" ~/kaal/server.js
  ```

## Telegram Bot Commands
| What Sunder sends | What happens |
|---|---|
| Any text | Added as a task |
| Voice message | Transcribed by Whisper, added as task |
| "complete/done [task]" | Marks task done |
| "start [task]" | Marks in-progress |
| "delete [task]" | Removes task |
| "postpone [task] to tomorrow" | Reschedules |
| "nicotex" / "booti" / "babaji" | Increments Sadhana counter |
| "weight 72.5" | Logs body weight |
| /tasks | Shows today's tasks |
| /meetings | Shows upcoming calendar events |
| /digest | Morning summary |
| /sadhana | Shows sadhana log |

## The 8 Tabs in the UI
1. Meetings — Google Calendar events
2. Tasks — daily tasks with status
3. Habits — daily habit tracker
4. Vitamins — supplement schedule
5. Hobbies — hobby tracking
6. Kaaya — body metrics (weight etc.)
7. Sadhana — personal practice (discreet names: Nicotex, Booti, Babaji)
8. Settings

## Sadhana Privacy Note
- "Nicotex" = nicotine gum replacement
- "Babaji Ka Booti" / "Booti" = cannabis (keep names as-is, don't rename or expose)
- "Babaji" = Sunder's spiritual practice
- The tab is labelled "Sadhana" in the UI (not the actual item names)

## Database Schema (key tables)
- `tasks` — id, text, status, date, is_default, created_at
- `habits` — id, name, sort_order
- `habit_logs` — habit_id, date, done
- `vitamins` — id, name, schedule_type, time_slots, notes, active
- `settings` — key, value

## Common Tasks Claude Code Will Do
- Add new fields or columns to the UI
- Add new Telegram commands
- Fix cron job timing
- Add new habit or vitamin types
- Debug Google Calendar auth issues
- Add new database tables

## What NOT to Touch
- `.env` file
- `kaal.db` (unless explicitly asked to modify data)
- `credentials.json` and `token.json`
- The Sadhana item names (keep them private)
