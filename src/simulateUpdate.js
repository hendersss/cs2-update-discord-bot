const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
let config = {};
try {
  if (fs.existsSync(CONFIG_PATH)) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  // ignore
}

const defaultKeywords = ['game update', 'game patch', 'client update', 'major update'];
const keywords = (config.everyone_keywords && Array.isArray(config.everyone_keywords) && config.everyone_keywords.length)
  ? config.everyone_keywords
  : defaultKeywords;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { title: null, snippet: null, mention: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--title' || a === '-t') out.title = args[++i];
    else if (a === '--snippet' || a === '-s') out.snippet = args[++i];
    else if (a === '--mention' || a === '-m') out.mention = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node src/simulateUpdate.js --title "..." --snippet "..." [--mention]');
      process.exit(0);
    }
  }
  return out;
}

const { title, snippet, mention } = parseArgs();
const t = title || 'Simulated CS2 update';
const desc = snippet || 'This is a simulated update message for testing @everyone mention behavior.';
const hay = (t + ' ' + desc).toLowerCase();
let shouldMention = mention;
if (!shouldMention) shouldMention = keywords.some(k => k && hay.includes(String(k).toLowerCase()));

const webhookEnvName = config.discord_webhook_env || 'DISCORD_WEBHOOK';
const webhookUrl = process.env[webhookEnvName] || process.env.DISCORD_WEBHOOK;
if (!webhookUrl) {
  console.error('No webhook configured; set DISCORD_WEBHOOK env var');
  process.exit(1);
}

const embed = { title: t, description: desc, timestamp: new Date().toISOString() };
const payload = { embeds: [embed] };
if (shouldMention) {
  payload.content = '@everyone';
  payload.allowed_mentions = { parse: ['everyone'] };
}

axios.post(webhookUrl, payload)
  .then(res => {
    console.log('Simulated message sent', res && res.status);
    process.exit(0);
  })
  .catch(err => {
    console.error('Failed to send simulated message', err && err.message ? err.message : err);
    process.exit(2);
  });
