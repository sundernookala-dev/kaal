# ⏳ Kaal — Time is Everything

Local-first time management agent for your MacBook.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up Telegram bot (optional — skip if not ready yet)
cp .env.example .env
# Edit .env with your Telegram bot token and chat ID

# 3. Set up Google Calendar (optional — skip if not ready yet)
# Place your credentials.json from Google Cloud Console in this folder, then:
npm run auth

# 4. Start the server
npm start
```

Open **http://localhost:3000** in your browser.

## Chrome Extension

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Click the Kaal icon in your toolbar

## Telegram Commands

| Command | What it does |
|---------|-------------|
| Send any text | Adds it as a task |
| `/tasks` | Shows today's tasks |
| `/meetings` | Shows upcoming meetings |
| `/add <task>` | Adds a specific task |

## Files

| File | Purpose |
|------|---------|
| `server.js` | Main backend — runs everything |
| `auth-test.js` | One-time Google Calendar auth |
| `kaal.db` | Your data (auto-created) |
| `.env` | Secrets (never share this) |
| `credentials.json` | Google OAuth creds (never share) |
| `token.json` | Google auth token (auto-created) |
| `extension/` | Chrome extension files |
| `public/` | Frontend files (place Kaal UI here) |
