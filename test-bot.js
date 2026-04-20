require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');
const db = new Database('kaal.db');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const chatId = process.env.TELEGRAM_CHAT_ID;
console.log('Chat ID from env:', chatId, typeof chatId);
bot.on('message', (msg) => {
  console.log('Msg from:', msg.chat.id, typeof msg.chat.id);
  console.log('Match:', msg.chat.id.toString() === chatId.toString());
  if (msg.chat.id.toString() !== chatId.toString()) { console.log('AUTH FAILED'); return; }
  if (!msg.text || msg.text.startsWith('/')) { console.log('SKIPPED'); return; }
  try {
    db.prepare("INSERT INTO tasks (text, status, date) VALUES (?, ?, date('now','localtime'))").run(msg.text.trim(), 'todo');
    console.log('DB insert OK');
  } catch(e) { console.log('DB ERROR:', e.message); }
  bot.sendMessage(chatId, 'Task added: ' + msg.text).then(() => console.log('Reply sent')).catch(e => console.log('SEND ERROR:', e.message));
});
console.log('Waiting for message...');
