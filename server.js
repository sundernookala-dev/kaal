/**
 * Kaal — Backend Server
 * 
 * Runs locally on your MacBook. Connects to:
 *   - Google Calendar API (reads all your meetings including ICS-subscribed ones)
 *   - Telegram Bot API (receives tasks via text/voice, sends meeting reminders)
 *   - SQLite database (stores tasks, settings — local file, no cloud)
 *
 * Usage:  npm start   (or:  node server.js)
 * 
 * The server runs at http://localhost:3000
 */

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { google } = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════
// SQLite stores everything in a single local file.
// No cloud, no network — your data stays on your Mac.

const db = new Database(path.join(__dirname, 'kaal.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    status TEXT DEFAULT 'todo' CHECK(status IN ('todo','inprogress','completed')),
    date TEXT DEFAULT (date('now','localtime')),
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS default_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sent_reminders (
    event_id TEXT,
    reminder_type TEXT,
    sent_at DATETIME DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (event_id, reminder_type)
  );

  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    UNIQUE(habit_id, date),
    FOREIGN KEY(habit_id) REFERENCES habits(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    task_text TEXT,
    duration INTEGER DEFAULT 25,
    started_at DATETIME DEFAULT (datetime('now','localtime')),
    completed INTEGER DEFAULT 0,
    date TEXT DEFAULT (date('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS vitamins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    schedule_type TEXT DEFAULT 'daily',
    schedule_value INTEGER DEFAULT 1,
    time_slots TEXT DEFAULT 'morning',
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS vitamin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vitamin_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    taken INTEGER DEFAULT 0,
    UNIQUE(vitamin_id, date, time_slot),
    FOREIGN KEY(vitamin_id) REFERENCES vitamins(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS hobby_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hobby TEXT NOT NULL,
    lesson_id INTEGER DEFAULT 0,
    completed_at DATETIME DEFAULT (datetime('now','localtime')),
    date TEXT DEFAULT (date('now','localtime')),
    data TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS saved_phrases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english TEXT NOT NULL,
    kannada TEXT NOT NULL,
    transliteration TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sadhana_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT DEFAULT 'per day',
    phases TEXT NOT NULL,
    current_phase INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sadhana_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    count REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    UNIQUE(item_id, date),
    FOREIGN KEY(item_id) REFERENCES sadhana_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS weight_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    weight REAL NOT NULL,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  );
`);

// Initialize default settings
function initSetting(key, val) {
  const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!existing) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, val);
}
initSetting('birth_date', '1975-03-31');
initSetting('death_date', '2065-03-31');
initSetting('pomodoro_work', '25');
initSetting('pomodoro_break', '5');
initSetting('pomodoro_long_break', '15');
initSetting('vitamin_morning', '08:00');
initSetting('vitamin_noon', '13:00');
initSetting('vitamin_night', '21:00');
initSetting('weight_goal', '70');

// Seed sadhana items if not exist
const sadhanaCount = db.prepare('SELECT COUNT(*) as c FROM sadhana_items').get().c;
if (sadhanaCount === 0) {
  db.prepare("INSERT INTO sadhana_items (name, unit, phases) VALUES (?, ?, ?)").run(
    'Nicotex', 'gums/day',
    JSON.stringify([
      {target:10,label:'Current: 10-12/day',desc:'Awareness phase — just track honestly'},
      {target:6,label:'Phase 1: Max 6/day',desc:'Cut to half. Replace urges with water or deep breaths.'},
      {target:4,label:'Phase 2: Max 4/day',desc:'Morning, lunch, evening, night — structured only.'},
      {target:2,label:'Phase 3: Max 2/day',desc:'Morning and evening only. You are almost free.'},
      {target:0,label:'Freedom',desc:'No more Nicotex. You did it.'},
    ])
  );
  db.prepare("INSERT INTO sadhana_items (name, unit, phases) VALUES (?, ?, ?)").run(
    'Babaji Ka Booti', 'per period',
    JSON.stringify([
      {target:7,label:'Current: Daily',desc:'Half a day. Awareness phase — track without judgment.', unit:'per week'},
      {target:2,label:'Phase 1: 2/week',desc:'Weekends only. Find other ways to unwind.', unit:'per week'},
      {target:1,label:'Phase 2: 1/week',desc:'Once a week max. You are building discipline.', unit:'per week'},
      {target:2,label:'Phase 3: 1/15 days',desc:'Twice a month. The pull is weakening.', unit:'per month'},
      {target:1,label:'Phase 4: 1/month',desc:'Monthly at most. Nearly free.', unit:'per month'},
      {target:0,label:'Freedom',desc:'Babaji is proud. You are free.'},
    ])
  );
}

// Initialize default daily tasks if empty
const dtCount = db.prepare('SELECT COUNT(*) as c FROM default_tasks').get().c;
if (dtCount === 0) {
  const defaults = [
    'Morning meditation — 10 min',
    'Review calendar & plan day',
    'Check & respond to emails',
    'Deep work block — 90 min',
    'Evening reflection journal',
  ];
  const insert = db.prepare('INSERT INTO default_tasks (text, sort_order) VALUES (?, ?)');
  defaults.forEach((t, i) => insert.run(t, i));
}

console.log('✅ Database ready (kaal.db)');

// ═══════════════════════════════════════════════════
// GOOGLE CALENDAR
// ═══════════════════════════════════════════════════
// Connects via OAuth to your personal Gmail.
// Since office calendars are ICS-subscribed into your Gmail,
// this single connection shows ALL your meetings.

let calendarAuth = null;

async function initGoogleCalendar() {
  try {
    if (!fs.existsSync('./credentials.json')) {
      console.log('⚠️  Google Calendar: credentials.json not found');
      console.log('   Run "npm run auth" to set up calendar access');
      return;
    }
    if (!fs.existsSync('./token.json')) {
      console.log('⚠️  Google Calendar: not yet authorized');
      console.log('   Run "npm run auth" to authorize');
      return;
    }

    const creds = JSON.parse(fs.readFileSync('./credentials.json'));
    const { client_id, client_secret } = creds.installed || creds.web || {};
    const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, 'http://localhost:3001/callback'
    );
    const tokens = JSON.parse(fs.readFileSync('./token.json'));
    oAuth2Client.setCredentials(tokens);

    // Auto-refresh token if expired
    oAuth2Client.on('tokens', (newTokens) => {
      const updated = { ...tokens, ...newTokens };
      fs.writeFileSync('./token.json', JSON.stringify(updated, null, 2));
      console.log('🔄 Calendar token refreshed');
    });

    calendarAuth = oAuth2Client;
    console.log('✅ Google Calendar connected');
  } catch (err) {
    console.error('❌ Calendar init error:', err.message);
  }
}

async function getEvents(timeMin, timeMax) {
  if (!calendarAuth) return [];
  const calendar = google.calendar({ version: 'v3', auth: calendarAuth });

  try {
    // Fetch from primary calendar (includes ICS subscriptions)
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || undefined,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 200,
    });

    // Also fetch from subscribed calendars
    let allEvents = res.data.items || [];

    // Try to get list of all calendars and fetch from each
    try {
      const calList = await calendar.calendarList.list();
      const otherCals = (calList.data.items || []).filter(c => c.id !== 'primary' && !c.primary);
      
      for (const cal of otherCals) {
        try {
          const calRes = await calendar.events.list({
            calendarId: cal.id,
            timeMin: timeMin || new Date().toISOString(),
            timeMax: timeMax || undefined,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 100,
          });
          allEvents = allEvents.concat(calRes.data.items || []);
        } catch (e) {
          // Skip calendars we can't access
        }
      }
    } catch (e) {
      // If calendar list fails, we still have primary
    }

    return allEvents.map(e => ({
      id: e.id,
      title: e.summary || '(No title)',
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      link: extractMeetingLink(e),
      platform: detectPlatform(e),
      calendar: e.organizer?.displayName || 'Personal',
      description: e.description || '',
    })).sort((a, b) => a.start.localeCompare(b.start));
  } catch (err) {
    console.error('❌ Calendar fetch error:', err.message);
    if (err.message.includes('invalid_grant') || err.message.includes('Token has been expired')) {
      console.log('🔄 Token expired. Run "npm run auth" to re-authorize.');
      calendarAuth = null;
    }
    return [];
  }
}

function extractMeetingLink(event) {
  // Priority: hangoutLink > location with URL > description with URL
  if (event.hangoutLink) return event.hangoutLink;
  if (event.conferenceData?.entryPoints) {
    const video = event.conferenceData.entryPoints.find(e => e.entryPointType === 'video');
    if (video) return video.uri;
  }
  // Check location for Teams/Zoom/Meet URLs
  const urlPattern = /https?:\/\/[^\s<>"]+(?:teams|zoom|meet|webex)[^\s<>"]*/i;
  if (event.location) {
    const match = event.location.match(urlPattern);
    if (match) return match[0];
  }
  if (event.description) {
    const match = event.description.match(urlPattern);
    if (match) return match[0];
  }
  return '';
}

function detectPlatform(event) {
  const text = JSON.stringify(event).toLowerCase();
  if (text.includes('teams.microsoft') || text.includes('teams.live')) return 'teams';
  if (text.includes('meet.google') || event.hangoutLink) return 'meet';
  if (text.includes('zoom.us')) return 'zoom';
  if (text.includes('webex')) return 'webex';
  return 'other';
}

// ═══════════════════════════════════════════════════
// TELEGRAM BOT
// ═══════════════════════════════════════════════════
// Receives messages/voice from you, sends reminders.
// Locked to your chat ID — only YOU can interact with it.

let bot = null;

function initTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || token === 'your_bot_token_here') {
    console.log('⚠️  Telegram: not configured');
    console.log('   1. Message @BotFather on Telegram to create a bot');
    console.log('   2. Copy the token to .env file');
    console.log('   3. Restart the server');
    return;
  }

  bot = new TelegramBot(token, { polling: true });

  // Security: only respond to your chat ID
  function isAuthorized(msg) {
    if (!chatId || chatId === 'your_chat_id_here') {
      // First message — tell user their chat ID
      console.log(`\n📱 Telegram message from chat ID: ${msg.chat.id}`);
      console.log(`   Add this to your .env file: TELEGRAM_CHAT_ID=${msg.chat.id}\n`);
      bot.sendMessage(msg.chat.id,
        `👋 Hi! Your chat ID is: \`${msg.chat.id}\`\n\n` +
        `Add this to your .env file:\n` +
        `\`TELEGRAM_CHAT_ID=${msg.chat.id}\`\n\n` +
        `Then restart the server.`,
        { parse_mode: 'Markdown' }
      );
      return false;
    }
    return msg.chat.id.toString() === chatId.toString();
  }

  // ─── /start command ───
  bot.onText(/\/start/, (msg) => {
    if (!isAuthorized(msg)) return;
    bot.sendMessage(chatId,
      '⏳ Kaal Bot — Time is everything\n\n' +
      'Voice or text commands:\n' +
      '  Say/type anything → adds as task\n' +
      '  "complete <task>" → marks as done\n' +
      '  "start <task>" → moves to in-progress\n' +
      '  "delete <task>" → removes task\n' +
      '  "move back <task>" → back to to-do\n' +
      '  "help" → full command list\n\n' +
      'Slash commands:\n' +
      '  /tasks → today\'s list\n' +
      '  /meetings → upcoming meetings\n' +
      '  /add <task> → add a task\n' +
      '  /digest → daily summary\n' +
      '  /sadhana → sadhana status\n\n' +
      'Quick: "nicotex" "booti" → log +1\n' +
      '"weight 72.5" → log weight'
    );
  });

  // ─── Text messages → smart command parsing ───
  bot.on('message', (msg) => {
    console.log('MSG RECEIVED:', msg.text, 'from', msg.chat.id);
    if (!isAuthorized(msg)) { console.log('AUTH FAILED'); return; }
    if (!msg.text || msg.text.startsWith('/')) { console.log('SKIPPED'); return; }

    const text = msg.text.trim().replace(/[\s.!?,;:]+$/g, ''); // strip trailing punctuation
    const lower = text.toLowerCase();

    // ── MOVE X TO DONE/COMPLETED/IN PROGRESS/TODO ──
    const moveMatch = lower.match(/^move\s+(.+?)\s+to\s+(done|completed|complete|in progress|in-progress|todo|to do|to-do)\.?$/i);
    if (moveMatch) {
      const taskName = moveMatch[1].trim();
      const target = moveMatch[2].toLowerCase();
      let status, icon;
      if (target.match(/done|complete/)) { status = 'completed'; icon = '●'; }
      else if (target.match(/progress/)) { status = 'inprogress'; icon = '◐'; }
      else { status = 'todo'; icon = '○'; }
      const fromStatuses = status === 'completed' ? ['todo','inprogress'] : status === 'inprogress' ? ['todo'] : ['inprogress','completed'];
      const task = findTask(taskName, fromStatuses);
      if (task) {
        db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, task.id);
        bot.sendMessage(chatId, icon + ' Moved: "' + task.text + '" → ' + target);
      } else {
        bot.sendMessage(chatId, '⚠️ Could not find task: "' + taskName + '"\nSend /tasks to see your list.');
      }
      return;
    }

    // ── COMPLETE / DONE ──
    if (lower.match(/^(complete|done|finish|finished|mark done|mark complete|mark as done|mark as complete)\s+/i)) {
      const taskName = text.replace(/^(complete|done|finish|finished|mark done|mark complete|mark as done|mark as complete)\s+/i, '').trim();
      const task = findTask(taskName, ['todo', 'inprogress']);
      if (task) {
        db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(task.id);
        bot.sendMessage(chatId, '● Done: "' + task.text + '"');
      } else {
        bot.sendMessage(chatId, '⚠️ Could not find task: "' + taskName + '"\nSend /tasks to see your list.');
      }
      return;
    }

    // ── START / IN PROGRESS ──
    if (lower.match(/^(start|begin|move to in progress|in progress|working on)\s+/i)) {
      const taskName = text.replace(/^(start|begin|move to in progress|in progress|working on)\s+/i, '').trim();
      const task = findTask(taskName, ['todo']);
      if (task) {
        db.prepare("UPDATE tasks SET status = 'inprogress' WHERE id = ?").run(task.id);
        bot.sendMessage(chatId, '◐ Started: "' + task.text + '"');
      } else {
        bot.sendMessage(chatId, '⚠️ Could not find task: "' + taskName + '"\nSend /tasks to see your list.');
      }
      return;
    }

    // ── DELETE / REMOVE ──
    if (lower.match(/^(delete|remove|cancel|drop)\s+/i)) {
      const taskName = text.replace(/^(delete|remove|cancel|drop)\s+/i, '').trim();
      const task = findTask(taskName);
      if (task) {
        db.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
        bot.sendMessage(chatId, '🗑 Deleted: "' + task.text + '"');
      } else {
        bot.sendMessage(chatId, '⚠️ Could not find task: "' + taskName + '"\nSend /tasks to see your list.');
      }
      return;
    }

    // ── MOVE BACK / UNDO ──
    if (lower.match(/^(move back|undo|reopen|move to todo)\s+/i)) {
      const taskName = text.replace(/^(move back|undo|reopen|move to todo)\s+/i, '').trim();
      const task = findTask(taskName, ['inprogress', 'completed']);
      if (task) {
        db.prepare("UPDATE tasks SET status = 'todo' WHERE id = ?").run(task.id);
        bot.sendMessage(chatId, '○ Moved back to To-Do: "' + task.text + '"');
      } else {
        bot.sendMessage(chatId, '⚠️ Could not find task: "' + taskName + '"\nSend /tasks to see your list.');
      }
      return;
    }

    // ── POSTPONE / MOVE TASK TO FUTURE DATE ──
    const postponeMatch = lower.match(/^(postpone|reschedule|move|shift)\s+(.+?)\s+to\s+(tomorrow|day after|next week|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday|\d{1,2}\s+\w+|\w+\s+\d{1,2})$/i);
    if (postponeMatch && !lower.match(/to\s+(done|completed|in progress|todo)/i)) {
      const taskName = postponeMatch[2].trim();
      const dateStr = postponeMatch[3].trim();
      const newDate = parseNaturalDate(dateStr);
      if (!newDate) {
        bot.sendMessage(chatId, '⚠️ Could not understand the date: "' + dateStr + '"\nTry: tomorrow, next Monday, 15 April');
        return;
      }
      const task = findTask(taskName);
      if (task) {
        db.prepare("UPDATE tasks SET date = ? WHERE id = ?").run(newDate, task.id);
        const d = new Date(newDate);
        const formatted = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
        bot.sendMessage(chatId, '📅 Moved: "' + task.text + '" → ' + formatted);
      } else {
        bot.sendMessage(chatId, '⚠️ Could not find task: "' + taskName + '"\nSend /tasks to see your list.');
      }
      return;
    }

    // ── ADD TASK FOR FUTURE DATE (flexible patterns) ──
    // Handles: "add book tickets for April 13th", "add for April 13th book tickets", 
    // "book tickets for tomorrow", "schedule meeting for next Monday"
    const datePattern = '(tomorrow|day after tomorrow|day after|next week|next\\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\\d{1,2}(?:st|nd|rd|th)?\\s+\\w+|\\w+\\s+\\d{1,2}(?:st|nd|rd|th)?)';
    
    // Pattern 1: "add/schedule <task> for/on <date>"
    const futureMatch1 = text.match(new RegExp('^(?:add|create|schedule)\\s+(.+?)\\s+(?:for|on)\\s+' + datePattern + '[.,]?$', 'i'));
    // Pattern 2: "add for <date>, <task>" or "add for <date> <task>"
    const futureMatch2 = text.match(new RegExp('^(?:add|create|schedule)\\s+(?:for|on)\\s+' + datePattern + '[,\\s]+(.+)$', 'i'));
    // Pattern 3: trailing "<task> for <date>" (no add prefix needed)
    const futureMatch3 = text.match(new RegExp('^(.+?)\\s+(?:for|on)\\s+' + datePattern + '[.,]?$', 'i'));
    
    const fMatch = futureMatch1 || futureMatch2;
    if (fMatch) {
      const taskText = (futureMatch1 ? fMatch[1] : fMatch[2]).replace(/^[,\s]+|[,\s]+$/g, '').trim();
      const dateStr = (futureMatch1 ? fMatch[2] : fMatch[1]).trim();
      const newDate = parseNaturalDate(dateStr);
      if (newDate && taskText) {
        db.prepare("INSERT INTO tasks (text, status, date) VALUES (?, 'todo', ?)").run(taskText, newDate);
        const d = new Date(newDate);
        const formatted = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
        bot.sendMessage(chatId, '✅ Task added for ' + formatted + ': "' + taskText + '"');
        return;
      }
    }
    // Pattern 3 only triggers if task doesn't look like a command
    if (futureMatch3 && !lower.match(/^(complete|done|finish|start|begin|delete|remove|move|postpone|help)/)) {
      const taskText = futureMatch3[1].replace(/^[,\s]+|[,\s]+$/g, '').trim();
      const dateStr = futureMatch3[2].trim();
      const newDate = parseNaturalDate(dateStr);
      if (newDate && taskText) {
        db.prepare("INSERT INTO tasks (text, status, date) VALUES (?, 'todo', ?)").run(taskText, newDate);
        const d = new Date(newDate);
        const formatted = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
        bot.sendMessage(chatId, '✅ Task added for ' + formatted + ': "' + taskText + '"');
        return;
      }
    }

    // ── HELP ──
    if (lower === 'help' || lower === 'commands') {
      bot.sendMessage(chatId,
        '⏳ Kaal Bot Commands\n\n' +
        'Voice or text:\n' +
        '  Just say/type anything → adds as task\n' +
        '  "complete <task>" → marks as done\n' +
        '  "move <task> to done" → marks as done\n' +
        '  "<task> is done" → marks as done\n' +
        '  "start <task>" → moves to in-progress\n' +
        '  "move <task> to in progress" → in-progress\n' +
        '  "delete <task>" → removes task\n' +
        '  "move back <task>" → back to to-do\n' +
        '  "postpone <task> to tomorrow" → future date\n' +
        '  "add <task> for next Monday" → schedule ahead\n\n' +
        'Slash commands:\n' +
        '  /tasks → today\'s list\n' +
        '  /meetings → upcoming meetings\n' +
        '  /add <task> → add a task\n' +
        '  /digest → daily summary\n' +
        '  /sadhana → sadhana status\n\n' +
        'Sadhana quick log:\n' +
        '  "nicotex" → log +1\n' +
        '  "nicotex 5" → set to 5\n' +
        '  "booti" → log +1\n' +
        '  "babaji" → log +1\n\n' +
        'Weight: "weight 72.5" → log today'
      );
      return;
    }

    // ── TRAILING PATTERNS: "X is done", "X is completed" ──
    const trailingDone = lower.match(/^(.+?)\s+(is|are)\s+(done|completed|complete|finished)\.?$/i);
    if (trailingDone) {
      const taskName = trailingDone[1].trim();
      const task = findTask(taskName, ['todo', 'inprogress']);
      if (task) {
        db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(task.id);
        bot.sendMessage(chatId, '● Done: "' + task.text + '"');
        return;
      }
    }

    // ── WEIGHT LOG ──
    const weightMatch = lower.match(/^(?:weight|kaaya|wt)\s+([\d.]+)(?:\s*kg)?$/);
    if (weightMatch) {
      const weight = parseFloat(weightMatch[1]);
      if (weight > 20 && weight < 300) {
        const today = new Date().toLocaleDateString('en-CA');
        const existing = db.prepare('SELECT * FROM weight_logs WHERE date = ?').get(today);
        if (existing) {
          db.prepare('UPDATE weight_logs SET weight = ? WHERE date = ?').run(weight, today);
        } else {
          db.prepare('INSERT INTO weight_logs (date, weight) VALUES (?, ?)').run(today, weight);
        }
        const prev = db.prepare("SELECT * FROM weight_logs WHERE date < ? ORDER BY date DESC LIMIT 1").get(today);
        let trend = '';
        if (prev) {
          const diff = +(weight - prev.weight).toFixed(1);
          trend = diff > 0 ? ' (↑' + diff + ' kg)' : diff < 0 ? ' (↓' + Math.abs(diff) + ' kg)' : ' (no change)';
        }
        bot.sendMessage(chatId, '⚖️ Weight logged: ' + weight + ' kg' + trend);
      } else {
        bot.sendMessage(chatId, '⚠️ Invalid weight. Use: weight 72.5');
      }
      return;
    }

    // ── SADHANA QUICK LOG ──
    const sadhanaMatch = lower.match(/^(nicotex|booti|babaji)(?:\s+(\d+))?$/);
    if (sadhanaMatch) {
      const keyword = sadhanaMatch[1];
      const setValue = sadhanaMatch[2] ? parseInt(sadhanaMatch[2]) : null;
      const itemName = keyword === 'nicotex' ? 'Nicotex' : 'Babaji Ka Booti';
      const item = db.prepare("SELECT * FROM sadhana_items WHERE name = ? AND active = 1").get(itemName);
      if (item) {
        const today = new Date().toLocaleDateString('en-CA');
        const existing = db.prepare('SELECT * FROM sadhana_logs WHERE item_id = ? AND date = ?').get(item.id, today);
        let newCount;
        if (setValue !== null) {
          newCount = setValue;
        } else {
          newCount = existing ? existing.count + 1 : 1;
        }
        if (existing) {
          db.prepare('UPDATE sadhana_logs SET count = ? WHERE item_id = ? AND date = ?').run(newCount, item.id, today);
        } else {
          db.prepare('INSERT INTO sadhana_logs (item_id, date, count) VALUES (?, ?, ?)').run(item.id, today, newCount);
        }
        const phases = JSON.parse(item.phases);
        const phase = phases[item.current_phase] || phases[0];
        const target = phase.target;
        const emoji = newCount <= target ? '✓' : '⚠️';
        bot.sendMessage(chatId, '🧘 ' + itemName + ': ' + newCount + ' today ' + emoji + '\nTarget: max ' + target + ' ' + (phase.unit || item.unit));
      }
      return;
    }

    // ── DEFAULT: ADD AS NEW TASK ──
    try {
      db.prepare("INSERT INTO tasks (text, status, date) VALUES (?, ?, date('now','localtime'))")
        .run(text, 'todo');
      console.log('DB INSERT OK');
    } catch(e) { console.log('DB ERROR:', e.message); }

    const todayCount = db.prepare(
      "SELECT COUNT(*) as c FROM tasks WHERE date = date('now','localtime') AND status = 'todo'"
    ).get().c;

    bot.sendMessage(chatId,
      '✅ Task added: "' + text + '"\n📋 ' + todayCount + ' tasks in To-Do'
    ).then(() => console.log('REPLY SENT OK')).catch(e => console.log('SEND ERROR:', e.message));
  });

  // ─── Helper: fuzzy find a task by name ───
  function findTask(name, statuses) {
    const lower = name.toLowerCase().replace(/['".,!?]+/g, '').replace(/\s+/g, ' ').trim();
    const where = statuses ? " AND status IN ('" + statuses.join("','") + "')" : '';

    // First try exact match
    const exact = db.prepare(
      "SELECT * FROM tasks WHERE date = date('now','localtime') AND LOWER(text) = ?" + where
    ).get(lower);
    if (exact) return exact;

    // Then try contains match
    const partial = db.prepare(
      "SELECT * FROM tasks WHERE date = date('now','localtime') AND LOWER(text) LIKE ?" + where + " ORDER BY id DESC"
    ).get('%' + lower + '%');
    if (partial) return partial;

    // Try matching just the first few words
    const words = lower.split(' ').slice(0, 3).join('%');
    const fuzzy = db.prepare(
      "SELECT * FROM tasks WHERE date = date('now','localtime') AND LOWER(text) LIKE ?" + where + " ORDER BY id DESC"
    ).get('%' + words + '%');
    return fuzzy || null;
  }

  // ─── Helper: parse natural date strings ───
  function parseNaturalDate(str) {
    // Strip ordinal suffixes and clean up
    const s = str.toLowerCase().trim().replace(/(\d+)(?:st|nd|rd|th)/g, '$1').replace(/[.,]+$/g, '');
    const now = new Date();
    let target = new Date();

    if (s === 'tomorrow') {
      target.setDate(now.getDate() + 1);
    } else if (s === 'day after' || s === 'day after tomorrow') {
      target.setDate(now.getDate() + 2);
    } else if (s === 'next week') {
      target.setDate(now.getDate() + 7);
    } else if (s.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i)) {
      const dayName = s.replace('next ', '');
      const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
      const targetDay = dayNames.indexOf(dayName);
      if (targetDay === -1) return null;
      let daysAhead = targetDay - now.getDay();
      if (daysAhead <= 0) daysAhead += 7;
      target.setDate(now.getDate() + daysAhead);
    } else {
      // Try "15 April" or "April 15" patterns
      const monthNames = {jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
      const m1 = s.match(/^(\d{1,2})\s+(\w+)$/);
      const m2 = s.match(/^(\w+)\s+(\d{1,2})$/);
      if (m1 && monthNames[m1[2]] !== undefined) {
        target = new Date(now.getFullYear(), monthNames[m1[2]], parseInt(m1[1]));
        if (target < now) target.setFullYear(target.getFullYear() + 1);
      } else if (m2 && monthNames[m2[1]] !== undefined) {
        target = new Date(now.getFullYear(), monthNames[m2[1]], parseInt(m2[2]));
        if (target < now) target.setFullYear(target.getFullYear() + 1);
      } else {
        return null;
      }
    }
    return target.toLocaleDateString('en-CA'); // YYYY-MM-DD
  }

  // ─── /tasks — show today's tasks ───
  bot.onText(/\/tasks/, (msg) => {
    if (!isAuthorized(msg)) return;

    const tasks = db.prepare(
      "SELECT * FROM tasks WHERE date = date('now','localtime') ORDER BY status DESC, id"
    ).all();

    if (tasks.length === 0) {
      bot.sendMessage(chatId, '📋 No tasks for today. Send a message to add one!');
      return;
    }

    const icon = { todo: '○', inprogress: '◐', completed: '●' };
    const grouped = { todo: [], inprogress: [], completed: [] };
    tasks.forEach(t => (grouped[t.status] || grouped.todo).push(t));

    let msg_text = '📋 Today\'s Tasks\n\n';
    if (grouped.inprogress.length) {
      msg_text += 'In Progress:\n';
      grouped.inprogress.forEach((t, i) => { msg_text += '  ◐ ' + t.text + '\n'; });
      msg_text += '\n';
    }
    if (grouped.todo.length) {
      msg_text += 'To Do:\n';
      grouped.todo.forEach((t, i) => { msg_text += '  ○ ' + t.text + '\n'; });
      msg_text += '\n';
    }
    if (grouped.completed.length) {
      msg_text += 'Done:\n';
      grouped.completed.forEach(t => { msg_text += '  ● ' + t.text + '\n'; });
    }

    bot.sendMessage(chatId, msg_text);
  });

  // ─── /add <task> — explicit task add ───
  bot.onText(/\/add (.+)/, (msg, match) => {
    if (!isAuthorized(msg)) return;
    const text = match[1].trim();
    db.prepare("INSERT INTO tasks (text, status, date) VALUES (?, ?, date('now','localtime'))")
      .run(text, 'todo');
    bot.sendMessage(chatId, `✅ Added: "${text}"`);
  });

  // ─── /meetings — upcoming meetings ───
  bot.onText(/\/meetings/, async (msg) => {
    if (!isAuthorized(msg)) return;

    const events = await getEvents();
    if (events.length === 0) {
      bot.sendMessage(chatId, '📅 No upcoming meetings.');
      return;
    }

    let text = '📅 Upcoming Meetings\n\n';
    events.slice(0, 8).forEach(e => {
      const d = new Date(e.start);
      const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const plat = e.platform !== 'other' ? ' (' + e.platform + ')' : '';
      text += date + ' ' + time + plat + '\n' + e.title + '\n';
      if (e.link) text += e.link + '\n';
      text += '\n';
    });

    bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  });

  // ─── /digest — daily summary on demand ───
  bot.onText(/\/digest/, async (msg) => {
    if (!isAuthorized(msg)) return;
    await sendDigest();
  });

  // ─── /sadhana — show today's sadhana status ───
  bot.onText(/\/sadhana/, (msg) => {
    if (!isAuthorized(msg)) return;
    const today = new Date().toLocaleDateString('en-CA');
    const items = db.prepare('SELECT * FROM sadhana_items WHERE active = 1 ORDER BY id').all();
    if (items.length === 0) {
      bot.sendMessage(chatId, '🧘 No sadhana items configured.');
      return;
    }
    let text = '🧘 Today\'s Sadhana\n\n';
    items.forEach(item => {
      const phases = JSON.parse(item.phases);
      const phase = phases[item.current_phase] || phases[0];
      const log = db.prepare('SELECT count FROM sadhana_logs WHERE item_id = ? AND date = ?').get(item.id, today);
      const count = log ? log.count : 0;
      const target = phase.target;
      const emoji = count <= target ? '✓' : '⚠️';
      text += item.name + ': ' + count + '/' + target + ' ' + emoji + '\n';
      text += '  ' + phase.label + '\n\n';
    });
    text += 'Quick log: type "nicotex" or "booti" to add +1\nOr "nicotex 3" to set count';
    bot.sendMessage(chatId, text);
  });

  // ─── Voice messages — transcribe with Whisper ───
  bot.on('voice', async (msg) => {
    if (!isAuthorized(msg)) return;

    bot.sendMessage(chatId, '🎤 Voice received — transcribing...');

    try {
      // Get file info from Telegram
      const file = await bot.getFile(msg.voice.file_id);
      const fileUrl = 'https://api.telegram.org/file/bot' + process.env.TELEGRAM_BOT_TOKEN + '/' + file.file_path;

      // Download voice file
      const voiceDir = path.join(__dirname, 'voice');
      if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir);
      const oggPath = path.join(voiceDir, 'voice_' + Date.now() + '.ogg');

      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(oggPath);
        https.get(fileUrl, (res) => {
          res.pipe(out);
          out.on('finish', () => { out.close(); resolve(); });
        }).on('error', reject);
      });

      // Transcribe with Whisper
      const result = execSync(
        'whisper not found "' + oggPath + '" --model small --language en --output_format txt --output_dir "' + voiceDir + '"',
        { timeout: 60000, encoding: 'utf-8' }
      );

      // Read the transcription
      const txtPath = oggPath.replace('.ogg', '.txt');
      let text = '';
      if (fs.existsSync(txtPath)) {
        text = fs.readFileSync(txtPath, 'utf-8').trim();
        fs.unlinkSync(txtPath); // cleanup
      }
      fs.unlinkSync(oggPath); // cleanup voice file

      if (!text) {
        bot.sendMessage(chatId, '⚠️ Could not understand the voice message. Please try again or type your task.');
        return;
      }

      // Route through the smart command parser by emitting as a text message
      bot.sendMessage(chatId, '🎤 Heard: "' + text + '"');
      bot.emit('message', { chat: { id: msg.chat.id }, text: text });

    } catch (e) {
      console.log('Voice error:', e.message);
      if (e.message.includes('whisper')) {
        bot.sendMessage(chatId, '⚠️ Whisper is not installed. Run:\npip3 install openai-whisper --break-system-packages');
      } else {
        bot.sendMessage(chatId, '⚠️ Voice transcription failed: ' + e.message.slice(0, 100));
      }
    }
  });

  // Handle polling errors gracefully
  bot.on('polling_error', (err) => {
    if (err.code === 'ETELEGRAM' && err.response?.statusCode === 409) {
      console.log('⚠️  Another Telegram bot instance is running. Stop it first.');
    } else if (err.code !== 'EFATAL') {
      // Ignore transient network errors
    }
  });

  console.log('✅ Telegram bot connected');
}

// ═══════════════════════════════════════════════════
// SCHEDULED JOBS
// ═══════════════════════════════════════════════════

// Meeting reminders — check every minute
cron.schedule('* * * * *', async () => {
  if (!bot) return;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId || chatId === 'your_chat_id_here') return;
  const now = new Date();

  // ── Meeting reminders (only if calendar connected) ──
  if (calendarAuth) {
    try {
      const in35 = new Date(now.getTime() + 35 * 60000);
      const events = await getEvents(now.toISOString(), in35.toISOString());

      events.forEach(event => {
        const start = new Date(event.start);
        const minsUntil = Math.round((start - now) / 60000);

        let reminderType = null;
        if (minsUntil >= 28 && minsUntil <= 32) reminderType = '30min';
        else if (minsUntil >= 3 && minsUntil <= 7) reminderType = '5min';
        if (!reminderType) return;

        const already = db.prepare(
          'SELECT 1 FROM sent_reminders WHERE event_id = ? AND reminder_type = ?'
        ).get(event.id, reminderType);
        if (already) return;

        const emoji = reminderType === '5min' ? '🚨' : '🔔';
        let msg = emoji + ' Meeting in ' + minsUntil + ' minutes!\n\n';
        msg += '📌 ' + event.title + '\n';
        msg += '🕐 ' + start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) + '\n';
        if (event.platform !== 'other') msg += '💻 ' + event.platform.toUpperCase() + '\n';
        if (event.link) msg += '\n🔗 ' + event.link;

        bot.sendMessage(chatId, msg);

        db.prepare('INSERT OR IGNORE INTO sent_reminders (event_id, reminder_type) VALUES (?, ?)')
          .run(event.id, reminderType);
      });
    } catch (e) {
      console.log('Meeting reminder error:', e.message);
    }
  }

  // Clean up old reminders (older than 24h)
  db.prepare("DELETE FROM sent_reminders WHERE sent_at < datetime('now','-1 day')").run();
});

// Vitamin reminders — separate cron, runs independently
cron.schedule('* * * * *', () => {
  if (!bot) return;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId || chatId === 'your_chat_id_here') return;

  const now = new Date();
  const today = now.toLocaleDateString('en-CA');
  const nowTotal = now.getHours() * 60 + now.getMinutes();

  const vitTimes = {
    morning: db.prepare("SELECT value FROM settings WHERE key = 'vitamin_morning'").get(),
    noon: db.prepare("SELECT value FROM settings WHERE key = 'vitamin_noon'").get(),
    night: db.prepare("SELECT value FROM settings WHERE key = 'vitamin_night'").get(),
  };

  ['morning', 'noon', 'night'].forEach(slot => {
    const timeSetting = vitTimes[slot] ? vitTimes[slot].value : null;
    if (!timeSetting) return;

    const [h, m] = timeSetting.split(':').map(Number);
    const slotTotal = h * 60 + m;
    const minsUntil = slotTotal - nowTotal;

    if (minsUntil < 3 || minsUntil > 7) return;

    const vitamins = db.prepare('SELECT * FROM vitamins WHERE active = 1').all();
    const dueVitamins = vitamins.filter(v => {
      if (!v.time_slots.includes(slot)) return false;
      return isVitaminDue(v, today);
    });
    if (dueVitamins.length === 0) return;

    const untaken = dueVitamins.filter(v => {
      const log = db.prepare('SELECT taken FROM vitamin_logs WHERE vitamin_id = ? AND date = ? AND time_slot = ?').get(v.id, today, slot);
      return !log || !log.taken;
    });
    if (untaken.length === 0) return;

    const reminderKey = 'vit-' + today + '-' + slot;
    const alreadySent = db.prepare('SELECT 1 FROM sent_reminders WHERE event_id = ? AND reminder_type = ?').get(reminderKey, 'vitamin');
    if (alreadySent) return;

    const slotEmoji = { morning: '🌅', noon: '☀️', night: '🌙' };
    let msg = slotEmoji[slot] + ' Vitamin reminder (' + slot + ' in 5 min)\n\n';
    untaken.forEach(v => {
      msg += '💊 ' + v.name + (v.notes ? ' — ' + v.notes : '') + '\n';
    });

    bot.sendMessage(chatId, msg);
    db.prepare('INSERT OR IGNORE INTO sent_reminders (event_id, reminder_type) VALUES (?, ?)').run(reminderKey, 'vitamin');
    console.log('💊 Vitamin reminder sent for ' + slot);
  });
});

// Seed daily default tasks at midnight
cron.schedule('0 0 * * *', () => {
  const today = new Date().toISOString().split('T')[0];

  // Check if defaults already added today
  const existing = db.prepare(
    "SELECT COUNT(*) as c FROM tasks WHERE date = ? AND is_default = 1"
  ).get(today).c;

  if (existing > 0) return;

  const defaults = db.prepare('SELECT text FROM default_tasks ORDER BY sort_order, id').all();
  const insert = db.prepare(
    'INSERT INTO tasks (text, status, date, is_default) VALUES (?, ?, ?, 1)'
  );
  defaults.forEach(d => insert.run(d.text, 'todo', today));
  console.log(`📋 Seeded ${defaults.length} default tasks for ${today}`);
});

// Evening digest at 9pm
cron.schedule('0 21 * * *', async () => {
  if (!bot) return;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId || chatId === 'your_chat_id_here') return;
  await sendDigest();
});

async function sendDigest() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId || !bot) return;

  const today = new Date().toLocaleDateString('en-CA');
  let msg = '🌙 Evening Digest\n\n';

  // ── Tasks summary ──
  const tasks = db.prepare("SELECT * FROM tasks WHERE date = ?").all(today);
  const taskStats = { todo: 0, inprogress: 0, completed: 0 };
  tasks.forEach(t => taskStats[t.status] = (taskStats[t.status] || 0) + 1);
  const totalTasks = tasks.length;
  const doneTasks = taskStats.completed;

  if (totalTasks > 0) {
    const pct = Math.round(doneTasks / totalTasks * 100);
    msg += '📋 Tasks: ' + doneTasks + '/' + totalTasks + ' done (' + pct + '%)\n';
    if (taskStats.inprogress > 0) msg += '   ◐ ' + taskStats.inprogress + ' still in progress\n';
    if (taskStats.todo > 0) msg += '   ○ ' + taskStats.todo + ' not started\n';

    // List incomplete tasks
    const incomplete = tasks.filter(t => t.status !== 'completed');
    if (incomplete.length > 0 && incomplete.length <= 5) {
      msg += '   Pending: ' + incomplete.map(t => t.text).join(', ') + '\n';
    }
  } else {
    msg += '📋 No tasks today\n';
  }

  // ── Habits summary ──
  const habits = db.prepare("SELECT * FROM habits ORDER BY sort_order, id").all();
  if (habits.length > 0) {
    const logs = db.prepare("SELECT * FROM habit_logs WHERE date = ? AND done = 1").all(today);
    const doneHabits = logs.length;
    msg += '\n🔥 Habits: ' + doneHabits + '/' + habits.length + ' completed\n';
    habits.forEach(h => {
      const done = logs.find(l => l.habit_id === h.id);
      msg += '   ' + (done ? '●' : '○') + ' ' + h.name + '\n';
    });

    // Show streaks
    const streaksArr = habits.map(h => {
      let streak = 0;
      let d = new Date();
      while (true) {
        const ds = d.toLocaleDateString('en-CA');
        const log = db.prepare('SELECT done FROM habit_logs WHERE habit_id = ? AND date = ?').get(h.id, ds);
        if (log && log.done) { streak++; d.setDate(d.getDate() - 1); }
        else break;
      }
      return { name: h.name, streak };
    }).filter(s => s.streak > 1);

    if (streaksArr.length > 0) {
      msg += '   Streaks: ' + streaksArr.map(s => s.name + ' ' + s.streak + 'd').join(', ') + '\n';
    }
  }

  // ── Pomodoro summary ──
  const pomos = db.prepare("SELECT * FROM pomodoro_sessions WHERE date = ? AND completed = 1").all(today);
  if (pomos.length > 0) {
    const totalMins = pomos.reduce((sum, p) => sum + p.duration, 0);
    msg += '\n🍅 Focus: ' + pomos.length + ' pomodoros (' + totalMins + ' min)\n';
  }

  // ── Tomorrow's meetings ──
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tmrwStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
  const tmrwEnd = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59);

  const tmrwEvents = await getEvents(tmrwStart.toISOString(), tmrwEnd.toISOString());
  if (tmrwEvents.length > 0) {
    msg += '\n📅 Tomorrow: ' + tmrwEvents.length + ' meeting' + (tmrwEvents.length !== 1 ? 's' : '') + '\n';
    tmrwEvents.slice(0, 5).forEach(e => {
      const t = new Date(e.start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      msg += '   ' + t + ' — ' + e.title + '\n';
    });
    if (tmrwEvents.length > 5) msg += '   +' + (tmrwEvents.length - 5) + ' more\n';

    // First meeting time
    const firstMeeting = new Date(tmrwEvents[0].start);
    msg += '   First meeting at ' + firstMeeting.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) + '\n';
  } else {
    msg += '\n📅 Tomorrow: No meetings scheduled\n';
  }

  // ── Tomorrow's pending tasks ──
  const tmrwDate = tomorrow.toLocaleDateString('en-CA');
  const tmrwTasks = db.prepare("SELECT * FROM tasks WHERE date = ? AND status != 'completed'").all(tmrwDate);
  if (tmrwTasks.length > 0) {
    msg += '\n📝 Tomorrow\'s tasks: ' + tmrwTasks.length + '\n';
    tmrwTasks.slice(0, 5).forEach(t => { msg += '   ○ ' + t.text + '\n'; });
  }

  msg += '\nHar Har Mahadev 🔱';

  bot.sendMessage(chatId, msg);
  console.log('📩 Evening digest sent');
}

// ═══════════════════════════════════════════════════
// EXPRESS API
// ═══════════════════════════════════════════════════

const app = express();
app.use(express.json());

// Serve the Kaal frontend
app.use(express.static(path.join(__dirname, 'public')));

// CORS — allow Chrome extension and local access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Health check ───
app.get('/api/health', (req, res) => {
  res.json({
    status: 'running',
    calendar: !!calendarAuth,
    telegram: !!bot,
    uptime: process.uptime(),
  });
});

// ─── Calendar ───
app.get('/api/events', async (req, res) => {
  const { start, end } = req.query;
  const events = await getEvents(start, end);
  res.json(events);
});

// ─── Tasks ───
app.get('/api/tasks', (req, res) => {
  const date = req.query.date || new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const tasks = db.prepare('SELECT * FROM tasks WHERE date = ? ORDER BY id').all(date);
  res.json(tasks);
});

app.get('/api/tasks/month', (req, res) => {
  const { year, month } = req.query; // month is 1-12
  const y = parseInt(year) || new Date().getFullYear();
  const m = parseInt(month) || (new Date().getMonth() + 1);
  const prefix = `${y}-${String(m).padStart(2, '0')}`;

  const tasks = db.prepare(
    "SELECT * FROM tasks WHERE date LIKE ? ORDER BY date, id"
  ).all(prefix + '%');

  // Group by date
  const grouped = {};
  tasks.forEach(t => {
    (grouped[t.date] = grouped[t.date] || []).push(t);
  });
  res.json(grouped);
});

app.post('/api/tasks', (req, res) => {
  const { text, date, status } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

  const d = date || new Date().toLocaleDateString('en-CA');
  const s = status || 'todo';
  const result = db.prepare(
    'INSERT INTO tasks (text, status, date) VALUES (?, ?, ?)'
  ).run(text.trim(), s, d);

  res.json({ id: result.lastInsertRowid, text: text.trim(), status: s, date: d });
});

app.put('/api/tasks/:id', (req, res) => {
  const { status, text, date } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (status) db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, req.params.id);
  if (text !== undefined) db.prepare('UPDATE tasks SET text = ? WHERE id = ?').run(text.trim(), req.params.id);
  if (date) db.prepare('UPDATE tasks SET date = ? WHERE id = ?').run(date, req.params.id);

  res.json({ ok: true });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Settings ───
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

app.put('/api/settings/:key', (req, res) => {
  const { value } = req.body;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(req.params.key, value);
  res.json({ ok: true });
});

// ─── Default Tasks ───
app.get('/api/default-tasks', (req, res) => {
  res.json(db.prepare('SELECT * FROM default_tasks ORDER BY sort_order, id').all());
});

app.post('/api/default-tasks', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM default_tasks').get().m || 0;
  const result = db.prepare(
    'INSERT INTO default_tasks (text, sort_order) VALUES (?, ?)'
  ).run(text.trim(), maxOrder + 1);

  res.json({ id: result.lastInsertRowid, text: text.trim() });
});

app.put('/api/default-tasks/:id', (req, res) => {
  const { text } = req.body;
  if (text !== undefined) {
    db.prepare('UPDATE default_tasks SET text = ? WHERE id = ?').run(text.trim(), req.params.id);
  }
  res.json({ ok: true });
});

app.delete('/api/default-tasks/:id', (req, res) => {
  db.prepare('DELETE FROM default_tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Seed today's default tasks (manual trigger) ───
app.post('/api/seed-defaults', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA');

  // Get all default task texts
  const defaults = db.prepare('SELECT text FROM default_tasks ORDER BY sort_order, id').all();

  // Get existing default task texts for today
  const existing = db.prepare(
    "SELECT text FROM tasks WHERE date = ? AND is_default = 1"
  ).all(today).map(t => t.text);

  // Only add defaults that aren't already in today's tasks
  const insert = db.prepare(
    'INSERT INTO tasks (text, status, date, is_default) VALUES (?, ?, ?, 1)'
  );
  let added = 0;
  defaults.forEach(d => {
    if (!existing.includes(d.text)) {
      insert.run(d.text, 'todo', today);
      added++;
    }
  });

  res.json({ ok: true, added, total: defaults.length });
});

// ─── Habits ───
app.get('/api/habits', (req, res) => {
  res.json(db.prepare('SELECT * FROM habits ORDER BY sort_order, id').all());
});

app.post('/api/habits', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM habits').get().m || 0;
  const result = db.prepare('INSERT INTO habits (name, sort_order) VALUES (?, ?)').run(name.trim(), maxOrder + 1);
  res.json({ id: result.lastInsertRowid, name: name.trim() });
});

app.delete('/api/habits/:id', (req, res) => {
  db.prepare('DELETE FROM habits WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM habit_logs WHERE habit_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/habits/today', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA');
  const habits = db.prepare('SELECT * FROM habits ORDER BY sort_order, id').all();
  const logs = db.prepare('SELECT * FROM habit_logs WHERE date = ?').all(today);
  const logMap = {};
  logs.forEach(l => { logMap[l.habit_id] = l.done; });
  res.json(habits.map(h => ({ ...h, done: logMap[h.id] || 0 })));
});

app.post('/api/habits/:id/toggle', (req, res) => {
  const date = req.body.date || new Date().toLocaleDateString('en-CA');
  const existing = db.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?').get(req.params.id, date);
  if (existing) {
    const newVal = existing.done ? 0 : 1;
    db.prepare('UPDATE habit_logs SET done = ? WHERE habit_id = ? AND date = ?').run(newVal, req.params.id, date);
    res.json({ done: newVal });
  } else {
    db.prepare('INSERT INTO habit_logs (habit_id, date, done) VALUES (?, ?, 1)').run(req.params.id, date);
    res.json({ done: 1 });
  }
});

app.get('/api/habits/month', (req, res) => {
  const { year, month } = req.query;
  const y = parseInt(year) || new Date().getFullYear();
  const m = parseInt(month) || (new Date().getMonth() + 1);
  const prefix = y + '-' + String(m).padStart(2, '0');
  const habits = db.prepare('SELECT * FROM habits ORDER BY sort_order, id').all();
  const logs = db.prepare("SELECT * FROM habit_logs WHERE date LIKE ?").all(prefix + '%');
  // Group by date
  const byDate = {};
  logs.forEach(l => {
    if (!byDate[l.date]) byDate[l.date] = {};
    byDate[l.date][l.habit_id] = l.done;
  });
  // Compute streaks
  const streaks = {};
  habits.forEach(h => {
    let streak = 0;
    let d = new Date();
    while (true) {
      const ds = d.toLocaleDateString('en-CA');
      const log = db.prepare('SELECT done FROM habit_logs WHERE habit_id = ? AND date = ?').get(h.id, ds);
      if (log && log.done) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }
    streaks[h.id] = streak;
  });
  res.json({ habits, byDate, streaks });
});

// ─── Pomodoro ───
app.post('/api/pomodoro/start', (req, res) => {
  const { task_id, task_text, duration } = req.body;
  const dur = duration || parseInt(db.prepare("SELECT value FROM settings WHERE key = 'pomodoro_work'").get().value) || 25;
  const result = db.prepare(
    "INSERT INTO pomodoro_sessions (task_id, task_text, duration, date) VALUES (?, ?, ?, date('now','localtime'))"
  ).run(task_id || null, task_text || 'Focus session', dur);
  res.json({ id: result.lastInsertRowid, duration: dur });
});

app.post('/api/pomodoro/:id/complete', (req, res) => {
  db.prepare('UPDATE pomodoro_sessions SET completed = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/pomodoro/today', (req, res) => {
  const sessions = db.prepare(
    "SELECT * FROM pomodoro_sessions WHERE date = date('now','localtime') ORDER BY started_at"
  ).all();
  const completed = sessions.filter(s => s.completed).length;
  const totalMinutes = sessions.filter(s => s.completed).reduce((sum, s) => sum + s.duration, 0);
  res.json({ sessions, completed, totalMinutes });
});

// ─── Vitamins ───
app.get('/api/vitamins', (req, res) => {
  res.json(db.prepare('SELECT * FROM vitamins WHERE active = 1 ORDER BY id').all());
});

app.post('/api/vitamins', (req, res) => {
  const { name, schedule_type, schedule_value, time_slots, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(
    'INSERT INTO vitamins (name, schedule_type, schedule_value, time_slots, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), schedule_type || 'daily', schedule_value || 1, time_slots || 'morning', notes || '');
  res.json({ id: result.lastInsertRowid, name: name.trim() });
});

app.put('/api/vitamins/:id', (req, res) => {
  const { name, schedule_type, schedule_value, time_slots, notes, active } = req.body;
  const fields = [];
  const vals = [];
  if (name !== undefined) { fields.push('name = ?'); vals.push(name); }
  if (schedule_type !== undefined) { fields.push('schedule_type = ?'); vals.push(schedule_type); }
  if (schedule_value !== undefined) { fields.push('schedule_value = ?'); vals.push(schedule_value); }
  if (time_slots !== undefined) { fields.push('time_slots = ?'); vals.push(time_slots); }
  if (notes !== undefined) { fields.push('notes = ?'); vals.push(notes); }
  if (active !== undefined) { fields.push('active = ?'); vals.push(active); }
  if (fields.length > 0) {
    vals.push(req.params.id);
    db.prepare('UPDATE vitamins SET ' + fields.join(', ') + ' WHERE id = ?').run(...vals);
  }
  res.json({ ok: true });
});

app.delete('/api/vitamins/:id', (req, res) => {
  db.prepare('DELETE FROM vitamins WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM vitamin_logs WHERE vitamin_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Get today's vitamins with due status
app.get('/api/vitamins/today', (req, res) => {
  const today = req.query.date || new Date().toLocaleDateString('en-CA');
  const vitamins = db.prepare('SELECT * FROM vitamins WHERE active = 1 ORDER BY id').all();

  const result = [];
  vitamins.forEach(v => {
    const isDue = isVitaminDue(v, today);
    if (!isDue) return;

    const slots = v.time_slots.split(',').map(s => s.trim());
    const logs = db.prepare('SELECT * FROM vitamin_logs WHERE vitamin_id = ? AND date = ?').all(v.id, today);
    const logMap = {};
    logs.forEach(l => { logMap[l.time_slot] = l.taken; });

    slots.forEach(slot => {
      result.push({
        vitamin_id: v.id,
        name: v.name,
        schedule_type: v.schedule_type,
        schedule_desc: getScheduleDesc(v),
        time_slot: slot,
        taken: logMap[slot] || 0,
        notes: v.notes,
      });
    });
  });

  // Sort: morning first, then noon, then night
  const slotOrder = { morning: 0, noon: 1, night: 2 };
  result.sort((a, b) => (slotOrder[a.time_slot] || 0) - (slotOrder[b.time_slot] || 0));

  res.json(result);
});

app.post('/api/vitamins/:id/toggle', (req, res) => {
  const { time_slot } = req.body;
  const date = req.body.date || new Date().toLocaleDateString('en-CA');
  const slot = time_slot || 'morning';

  const existing = db.prepare(
    'SELECT * FROM vitamin_logs WHERE vitamin_id = ? AND date = ? AND time_slot = ?'
  ).get(req.params.id, date, slot);

  if (existing) {
    const newVal = existing.taken ? 0 : 1;
    db.prepare('UPDATE vitamin_logs SET taken = ? WHERE vitamin_id = ? AND date = ? AND time_slot = ?')
      .run(newVal, req.params.id, date, slot);
    res.json({ taken: newVal });
  } else {
    db.prepare('INSERT INTO vitamin_logs (vitamin_id, date, time_slot, taken) VALUES (?, ?, ?, 1)')
      .run(req.params.id, date, slot);
    res.json({ taken: 1 });
  }
});

// Helper: check if vitamin is due on a given date
function isVitaminDue(vitamin, dateStr) {
  if (vitamin.schedule_type === 'daily') return true;

  if (vitamin.schedule_type === 'weekly') {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    return dow === vitamin.schedule_value;
  }

  if (vitamin.schedule_type === 'interval') {
    const created = new Date(vitamin.created_at);
    const target = new Date(dateStr + 'T12:00:00');
    const diffDays = Math.floor((target - created) / 86400000);
    return diffDays >= 0 && diffDays % vitamin.schedule_value === 0;
  }

  return true;
}

// Helper: human readable schedule description
function getScheduleDesc(vitamin) {
  if (vitamin.schedule_type === 'daily') return 'Daily';
  if (vitamin.schedule_type === 'weekly') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return 'Weekly (' + days[vitamin.schedule_value] + ')';
  }
  if (vitamin.schedule_type === 'interval') {
    return 'Every ' + vitamin.schedule_value + ' days';
  }
  return vitamin.schedule_type;
}

// ─── Weight (Kaaya) ───
app.get('/api/weight', (req, res) => {
  const { period } = req.query;
  let days = 30;
  if (period === 'week') days = 7;
  else if (period === 'quarter') days = 90;
  else if (period === 'year') days = 365;
  else if (period === 'all') days = 9999;

  const logs = db.prepare(
    "SELECT * FROM weight_logs WHERE date >= date('now', '-' || ? || ' days', 'localtime') ORDER BY date"
  ).all(days);

  const latest = db.prepare("SELECT * FROM weight_logs ORDER BY date DESC LIMIT 1").get();
  const oldest = logs.length > 0 ? logs[0] : null;
  const change = latest && oldest ? +(latest.weight - oldest.weight).toFixed(1) : 0;
  const min = logs.length > 0 ? Math.min(...logs.map(l => l.weight)) : 0;
  const max = logs.length > 0 ? Math.max(...logs.map(l => l.weight)) : 0;
  const avg = logs.length > 0 ? +(logs.reduce((s, l) => s + l.weight, 0) / logs.length).toFixed(1) : 0;

  res.json({ logs, latest, change, min, max, avg, count: logs.length });
});

app.post('/api/weight', (req, res) => {
  const { weight, date, notes } = req.body;
  if (!weight) return res.status(400).json({ error: 'Weight required' });
  const d = date || new Date().toLocaleDateString('en-CA');
  const existing = db.prepare('SELECT * FROM weight_logs WHERE date = ?').get(d);
  if (existing) {
    db.prepare('UPDATE weight_logs SET weight = ?, notes = ? WHERE date = ?').run(weight, notes || '', d);
  } else {
    db.prepare('INSERT INTO weight_logs (date, weight, notes) VALUES (?, ?, ?)').run(d, weight, notes || '');
  }
  res.json({ ok: true });
});

app.delete('/api/weight/:date', (req, res) => {
  db.prepare('DELETE FROM weight_logs WHERE date = ?').run(req.params.date);
  res.json({ ok: true });
});

// ─── Sadhana (de-addiction) ───
app.get('/api/sadhana', (req, res) => {
  const items = db.prepare('SELECT * FROM sadhana_items WHERE active = 1 ORDER BY id').all();
  items.forEach(item => { item.phases = JSON.parse(item.phases); });
  res.json(items);
});

app.get('/api/sadhana/today', (req, res) => {
  const today = req.query.date || new Date().toLocaleDateString('en-CA');
  const items = db.prepare('SELECT * FROM sadhana_items WHERE active = 1 ORDER BY id').all();
  const result = items.map(item => {
    const phases = JSON.parse(item.phases);
    const phase = phases[item.current_phase] || phases[0];
    const log = db.prepare('SELECT * FROM sadhana_logs WHERE item_id = ? AND date = ?').get(item.id, today);

    // Get last 30 days of logs for chart
    const history = db.prepare(
      "SELECT * FROM sadhana_logs WHERE item_id = ? AND date >= date('now', '-30 days', 'localtime') ORDER BY date"
    ).all(item.id);

    // Calculate streak (days target was met)
    let streak = 0;
    let d = new Date();
    while (true) {
      const ds = d.toLocaleDateString('en-CA');
      const dayLog = db.prepare('SELECT count FROM sadhana_logs WHERE item_id = ? AND date = ?').get(item.id, ds);
      if (dayLog && dayLog.count <= phase.target) { streak++; d.setDate(d.getDate() - 1); }
      else break;
    }

    return {
      id: item.id, name: item.name, unit: item.unit,
      current_phase: item.current_phase, phase, phases,
      today_count: log ? log.count : 0, today_notes: log ? log.notes : '',
      history, streak, total_phases: phases.length,
    };
  });
  res.json(result);
});

app.post('/api/sadhana/:id/log', (req, res) => {
  const { count, notes } = req.body;
  const date = req.body.date || new Date().toLocaleDateString('en-CA');
  const existing = db.prepare('SELECT * FROM sadhana_logs WHERE item_id = ? AND date = ?').get(req.params.id, date);
  if (existing) {
    db.prepare('UPDATE sadhana_logs SET count = ?, notes = ? WHERE item_id = ? AND date = ?')
      .run(count, notes || '', req.params.id, date);
  } else {
    db.prepare('INSERT INTO sadhana_logs (item_id, date, count, notes) VALUES (?, ?, ?, ?)')
      .run(req.params.id, date, count, notes || '');
  }
  res.json({ ok: true });
});

app.post('/api/sadhana/:id/phase', (req, res) => {
  const { phase } = req.body;
  db.prepare('UPDATE sadhana_items SET current_phase = ? WHERE id = ?').run(phase, req.params.id);
  res.json({ ok: true });
});

// ─── Hobbies ───
// Chess: proxy Lichess puzzle API
app.get('/api/hobbies/chess/puzzle', async (req, res) => {
  try {
    const data = await new Promise((resolve, reject) => {
      https.get('https://lichess.org/api/puzzle/daily', {headers:{'Accept':'application/json'}}, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
    res.json(data);
  } catch(e) {
    const fallbacks = [
      {puzzle:{id:'f1',solution:['e7e8','f8e8','d6e8'],themes:['mateIn2'],rating:1200},fen:'3r1k2/4Rp2/3NP1pp/8/8/6PP/5PK1/8 w - - 0 1'},
      {puzzle:{id:'f2',solution:['h5h7','g8f8','h7h8'],themes:['mateIn2'],rating:1100},fen:'6k1/5ppp/8/7Q/8/8/5PPP/6K1 w - - 0 1'},
      {puzzle:{id:'f3',solution:['d1d8','e8d8','e1e8'],themes:['mateIn2'],rating:1300},fen:'3rk3/8/8/8/8/8/8/3QR1K1 w - - 0 1'},
    ];
    res.json(fallbacks[Math.floor(Math.random()*fallbacks.length)]);
  }
});

app.get('/api/hobbies/chess/random', async (req, res) => {
  res.redirect('/api/hobbies/chess/puzzle');
});

// Kannada translation proxy (Google Translate free endpoint)
app.post('/api/hobbies/kannada/translate', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  try {
    const encoded = encodeURIComponent(text);
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=kn&dt=t&dt=rm&q=' + encoded;
    const data = await new Promise((resolve, reject) => {
      https.get(url, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
    const kannada = data[0] ? data[0].map(s => s[0]).join('') : '';
    const translit = data[0] ? data[0].map(s => s[3] || '').join(' ') : '';
    res.json({ kannada, transliteration: translit.trim(), original: text });
  } catch(e) {
    console.log('Translation error:', e.message);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// Saved phrases
app.get('/api/hobbies/kannada/phrases', (req, res) => {
  const { category } = req.query;
  const where = category ? " WHERE category = ?" : "";
  const params = category ? [category] : [];
  res.json(db.prepare('SELECT * FROM saved_phrases' + where + ' ORDER BY created_at DESC').all(...params));
});

app.post('/api/hobbies/kannada/phrases', (req, res) => {
  const { english, kannada, transliteration, category } = req.body;
  if (!english || !kannada) return res.status(400).json({ error: 'English and Kannada required' });
  const result = db.prepare('INSERT INTO saved_phrases (english, kannada, transliteration, category) VALUES (?, ?, ?, ?)')
    .run(english, kannada, transliteration || '', category || 'general');
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/hobbies/kannada/phrases/:id', (req, res) => {
  db.prepare('DELETE FROM saved_phrases WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Astronomy image proxy (Wikipedia + NASA fallback)
app.get('/api/hobbies/astro/image', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    // Try Wikipedia first — has images for everything
    const wikiQuery = q.replace(/\s+/g, '_');
    const wikiUrl = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(wikiQuery);
    console.log('Wiki search:', wikiQuery);
    const wikiRes = await fetch(wikiUrl);
    if (wikiRes.ok) {
      const wikiData = await wikiRes.json();
      if (wikiData.thumbnail && wikiData.thumbnail.source) {
        // Get higher res image
        const hiRes = wikiData.originalimage ? wikiData.originalimage.source : wikiData.thumbnail.source.replace(/\/\d+px-/, '/800px-');
        console.log('Wiki image found:', wikiData.title);
        return res.json([{
          title: wikiData.title || q,
          description: (wikiData.extract || '').slice(0, 200),
          image: hiRes,
        }]);
      }
    }

    // Fallback: try simpler Wikipedia queries
    const words = q.split(' ');
    for (let len = Math.min(3, words.length); len >= 1; len--) {
      const simpler = words.slice(0, len).join('_');
      if (simpler === wikiQuery) continue;
      console.log('Wiki fallback:', simpler);
      const fbRes = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(simpler));
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        if (fbData.thumbnail && fbData.thumbnail.source) {
          const hiRes = fbData.originalimage ? fbData.originalimage.source : fbData.thumbnail.source.replace(/\/\d+px-/, '/800px-');
          console.log('Wiki fallback image found:', fbData.title);
          return res.json([{
            title: fbData.title || simpler,
            description: (fbData.extract || '').slice(0, 200),
            image: hiRes,
          }]);
        }
      }
    }

    console.log('No image found for:', q);
    res.json([]);
  } catch(e) {
    console.log('Image search error:', e.message);
    res.json([]);
  }
});

// Kannada TTS proxy (Google Translate TTS)
app.get('/api/hobbies/kannada/speak', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).send('No text');
  try {
    const encoded = encodeURIComponent(text);
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=' + encoded + '&tl=kn';
    const data = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
        const chunks = [];
        r.on('data', chunk => chunks.push(chunk));
        r.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
    res.set('Content-Type', 'audio/mpeg');
    res.send(data);
  } catch(e) {
    console.log('TTS error:', e.message);
    res.status(500).send('TTS failed');
  }
});

// Hobby progress
app.get('/api/hobbies/progress', (req, res) => {
  const { hobby } = req.query;
  if (hobby) {
    const rows = db.prepare('SELECT * FROM hobby_progress WHERE hobby = ? ORDER BY completed_at DESC').all(hobby);
    res.json(rows);
  } else {
    const chess = db.prepare("SELECT COUNT(*) as c FROM hobby_progress WHERE hobby = 'chess'").get().c;
    const kannada = db.prepare("SELECT MAX(lesson_id) as l FROM hobby_progress WHERE hobby = 'kannada'").get().l || 0;
    const astronomy = db.prepare("SELECT MAX(lesson_id) as l FROM hobby_progress WHERE hobby = 'astronomy'").get().l || 0;
    res.json({ chess, kannada, astronomy });
  }
});

app.post('/api/hobbies/progress', (req, res) => {
  const { hobby, lesson_id, data } = req.body;
  db.prepare("INSERT INTO hobby_progress (hobby, lesson_id, data) VALUES (?, ?, ?)")
    .run(hobby, lesson_id || 0, JSON.stringify(data || {}));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════

app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════╗
║   ⏳  K A A L  — Time is everything ║
║   Running at http://localhost:${PORT}   ║
╚══════════════════════════════════════╝
  `);

  await initGoogleCalendar();
  initTelegram();

  console.log('\n📌 Quick status:');
  console.log(`   Calendar: ${calendarAuth ? '✅ connected' : '⚠️  not configured (run: npm run auth)'}`);
  console.log(`   Telegram: ${bot ? '✅ connected' : '⚠️  not configured (edit .env)'}`);
  console.log(`   Database: ✅ kaal.db`);
  console.log(`   Frontend: http://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏳ Shutting down Kaal...');
  if (bot) bot.stopPolling();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (bot) bot.stopPolling();
  db.close();
  process.exit(0);
});
