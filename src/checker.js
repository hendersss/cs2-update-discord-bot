const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SNAP_PATH = path.join(__dirname, '..', 'snapshots.json');

function loadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read', filePath, e.message);
  }
  return fallback;
}

const config = loadJson(CONFIG_PATH, { discord_webhook_env: 'DISCORD_WEBHOOK', targets: [] });
const snapshots = loadJson(SNAP_PATH, {});

const webhookUrl = process.env[config.discord_webhook_env] || process.env.DISCORD_WEBHOOK;

async function fetchContent(url, selector) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'steamdb-discord-monitor/1.0' },
    timeout: 30000
  });
  const $ = cheerio.load(res.data);
  let text = selector ? $(selector).text() : $('body').text();
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function firstDiffSnippet(oldStr, newStr, context = 200) {
  const minLen = Math.min(oldStr.length, newStr.length);
  let i = 0;
  while (i < minLen && oldStr[i] === newStr[i]) i++;
  const start = Math.max(0, i - context);
  const end = Math.min(newStr.length, i + context);
  let snippet = newStr.slice(start, end).trim();
  snippet = snippet.replace(/\s+/g, ' ');
  if (start > 0) snippet = '... ' + snippet;
  if (end < newStr.length) snippet = snippet + ' ...';
  return snippet || '(content changed)';
}

async function sendWebhook(embeds) {
  if (!webhookUrl) {
    console.log('No webhook configured; set environment variable', config.discord_webhook_env || 'DISCORD_WEBHOOK');
    return;
  }
  try {
    await axios.post(webhookUrl, { embeds }, { timeout: 10000 });
    console.log('Posted', embeds.length, 'embed(s) to Discord');
  } catch (err) {
    console.error('Failed to post to webhook', err.message);
  }
}

(async () => {
  const embeds = [];
  let changed = false;

  for (const target of config.targets) {
    console.log('Checking', target.id, target.url);
    try {
      const current = await fetchContent(target.url, target.selector);
      const prev = snapshots[target.id] || '';
      if (current !== prev) {
        changed = true;
        const snippet = firstDiffSnippet(prev, current, 300);
        const when = new Date().toISOString();
        const embed = {
          title: `${target.label || target.id} — update detected`,
          url: target.url,
          description: `**When:** ${when}\n**Summary:** ${snippet}`,
          timestamp: when
        };
        embeds.push(embed);
        snapshots[target.id] = current;
      } else {
        console.log('No change for', target.id);
      }
    } catch (err) {
      console.error('Error checking', target.id, err.message);
    }
  }

  if (embeds.length > 0) {
    await sendWebhook(embeds);
  }

  if (changed) {
    try {
      fs.writeFileSync(SNAP_PATH, JSON.stringify(snapshots, null, 2));
      console.log('Wrote snapshots to', SNAP_PATH);
    } catch (e) {
      console.error('Failed to write snapshots', e.message);
      process.exitCode = 2;
    }
  } else {
    console.log('No changes detected');
  }
})();
