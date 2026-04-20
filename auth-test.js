/**
 * Kaal — Google Calendar Authentication
 * 
 * Run this ONCE to authorize Kaal to read your Google Calendar.
 * It will open a browser window for you to sign in and grant permission.
 * After that, a token.json file is saved locally — you won't need to do this again.
 *
 * Usage:  node auth-test.js
 * 
 * Prerequisites:
 *   1. You have credentials.json from Google Cloud Console (see setup guide Step 4)
 *   2. credentials.json is in this same folder
 */

const { google } = require('googleapis');
const fs = require('fs');
const http = require('http');
const url = require('url');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = './token.json';
const CREDS_PATH = './credentials.json';

async function authorize() {
  // Check credentials file exists
  if (!fs.existsSync(CREDS_PATH)) {
    console.error('\n❌ credentials.json not found!\n');
    console.log('To fix this:');
    console.log('  1. Go to console.cloud.google.com');
    console.log('  2. Select your "Kaal" project');
    console.log('  3. Go to APIs & Services → Credentials');
    console.log('  4. Download your OAuth 2.0 Client ID as JSON');
    console.log('  5. Rename it to credentials.json');
    console.log('  6. Place it in this folder:', __dirname);
    console.log('  7. Run this script again\n');
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(CREDS_PATH));
  const { client_id, client_secret } = creds.installed || creds.web || {};

  if (!client_id || !client_secret) {
    console.error('\n❌ Invalid credentials.json format.');
    console.log('Make sure you downloaded an OAuth 2.0 Client ID (Desktop app type).\n');
    process.exit(1);
  }

  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, 'http://localhost:3005/callback'
  );

  // Check if already authenticated
  if (fs.existsSync(TOKEN_PATH)) {
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
    console.log('✅ Already authenticated! Token found at', TOKEN_PATH);
    return oAuth2Client;
  }

  // Generate auth URL and open browser
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n🔗 Opening browser for Google Calendar authorization...\n');
  console.log('If the browser doesn\'t open, visit this URL manually:');
  console.log(authUrl + '\n');

  // Open browser (macOS)
  try {
    require('child_process').execSync(`open "${authUrl}"`);
  } catch (e) {
    // If open command fails, user can use the URL above
  }

  // Start temporary server to catch the OAuth callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const query = url.parse(req.url, true).query;
      if (query.error) {
        res.end('❌ Authorization denied. You can close this tab.');
        server.close();
        reject(new Error('Authorization denied: ' + query.error));
        return;
      }
      if (query.code) {
        try {
          const { tokens } = await oAuth2Client.getToken(query.code);
          oAuth2Client.setCredentials(tokens);
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
          res.end('✅ Kaal is authorized! You can close this tab.');
          server.close();
          console.log('✅ Token saved to', TOKEN_PATH);
          resolve(oAuth2Client);
        } catch (err) {
          res.end('❌ Error getting token. Check your terminal.');
          server.close();
          reject(err);
        }
      }
    }).listen(3005, () => {
      console.log('⏳ Waiting for authorization... (listening on port 3005)\n');
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out after 2 minutes'));
    }, 120000);
  });
}

// Test: fetch next 5 events
async function test() {
  try {
    const auth = await authorize();
    const calendar = google.calendar({ version: 'v3', auth });

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 5,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = res.data.items;
    if (events && events.length) {
      console.log('\n📅 Your next 5 meetings:\n');
      events.forEach(event => {
        const start = event.start.dateTime || event.start.date;
        const time = new Date(start).toLocaleString('en-IN', {
          weekday: 'short', day: 'numeric', month: 'short',
          hour: '2-digit', minute: '2-digit',
        });
        console.log(`  ${time}  —  ${event.summary || '(No title)'}`);
      });
      console.log('\n✅ Calendar connection working! You can now run: npm start\n');
    } else {
      console.log('\n📅 No upcoming events found (calendar is empty or synced calendars haven\'t updated yet).');
      console.log('✅ But the connection works! You can now run: npm start\n');
    }
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.message.includes('invalid_grant')) {
      console.log('\nYour token has expired. Deleting token.json — run this script again.');
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    }
  }
}

test();
