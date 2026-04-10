const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
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

const config = loadJson(CONFIG_PATH, { discord_webhook_env: 'DISCORD_WEBHOOK', targets: [], notify_file_changes: false, notify_branch_updates: false });
const snapshots = loadJson(SNAP_PATH, {});

const webhookUrl = process.env[config.discord_webhook_env] || process.env.DISCORD_WEBHOOK;

async function fetchRssItem(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'steamdb-discord-monitor/1.0' },
    timeout: 30000,
    responseType: 'text'
  });
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const json = parser.parse(res.data);
  let items = [];
  if (json.rss && json.rss.channel && json.rss.channel.item) items = json.rss.channel.item;
  else if (json.channel && json.channel.item) items = json.channel.item;
  else if (json.feed && json.feed.entry) items = json.feed.entry;
  if (!items) items = [];
  if (!Array.isArray(items)) items = [items];
  if (items.length === 0) throw new Error('No items in RSS');
  const item = items[0];
  const title = item.title && (typeof item.title === 'object' ? item.title['#text'] || item.title : item.title) || '';
  let link = '';
  if (item.link) {
    if (typeof item.link === 'string') link = item.link;
    else if (Array.isArray(item.link)) {
      const l = item.link[0];
      link = l && (l['#text'] || l['@_href'] || l.href || l.url) || '';
    } else if (typeof item.link === 'object') {
      link = item.link['#text'] || item.link['@_href'] || item.link.href || item.link.url || '';
    }
  }
  const guid = (item.guid && (typeof item.guid === 'object' ? item.guid['#text'] || item.guid : item.guid)) || item.id || link || (title + '|' + (item.pubDate || item.published || ''));
  const pubDate = item.pubDate || item.pubdate || item.published || item.updated || '';
  const description = item.description || item.summary || item['content:encoded'] || item.content || '';
  const snippet = String(description).replace(/\s+/g, ' ').trim().slice(0, 1000);
  return { id: String(guid), title, link: link || url, pubDate, snippet };
}


async function sendWebhook(embeds, content = '', allowed_mentions = undefined) {
  if (!webhookUrl) {
    console.log('No webhook configured; set environment variable', config.discord_webhook_env || 'DISCORD_WEBHOOK');
    return;
  }
  const payload = { embeds };
  if (content) payload.content = content;
  if (allowed_mentions) payload.allowed_mentions = allowed_mentions;
  try {
    const res = await axios.post(webhookUrl, payload, { timeout: 10000 });
    console.log('Posted', embeds.length, 'embed(s) to Discord');
    if (res && res.status) console.log('Webhook response status', res.status);
  } catch (err) {
    console.error('Failed to post to webhook', err.message);
  }
}

function shouldMentionEveryoneForText(text) {
  const defaults = ['game update', 'game patch', 'client update', 'major update'];
  const keys = (config.everyone_keywords && Array.isArray(config.everyone_keywords) && config.everyone_keywords.length)
    ? config.everyone_keywords
    : defaults;
  const hay = (text || '').toLowerCase();
  for (const k of keys) {
    if (!k) continue;
    if (hay.includes(String(k).toLowerCase())) return true;
  }
  return false;
}

(async () => {
  const embeds = [];
  let changed = false;

  for (const target of config.targets) {
    console.log('Checking', target.id, target.url);
    try {
      if ((target.type && target.type === 'rss') || /PatchnotesRSS|\.xml$|rss\//i.test(target.url)) {
        const item = await fetchRssItem(target.url);
        const prevId = snapshots[target.id] || '';
        if (item.id !== prevId) {
          changed = true;
          const when = item.pubDate || new Date().toISOString();

          const titleAndSnippet = `${item.title || ''} ${item.snippet || ''}`;
          const isFileUpdate = /\bfiles?\s+updated\b/i.test(titleAndSnippet);
          const isBranchUpdate = /\bbranch\s+updated\b/i.test(titleAndSnippet);

          if ((isFileUpdate && !config.notify_file_changes) || (isBranchUpdate && !config.notify_branch_updates)) {
            console.log(`Skipping ${isFileUpdate ? 'file' : 'branch'} update for`, target.id);
            snapshots[target.id] = item.id;
            continue;
          }

          // Try to extract a changelist id from snippet/title/link
          let changelistId = null;
          const hay = `${item.snippet || ''} ${item.title || ''} ${item.link || ''}`;
          const m = hay.match(/changelist\s*[:#]?\s*(\d{5,})/i);
          if (m) changelistId = m[1];
          else {
            const m2 = (item.link || '').match(/changelist\/(\d+)/i);
            if (m2) changelistId = m2[1];
          }

          const embed = {
            title: `${target.label || target.id} — ${item.title || 'update detected'}`,
            url: changelistId ? `https://steamdb.info/changelist/${changelistId}/` : (item.link || target.url),
            description: `**When:** ${when}\n**Summary:** ${item.snippet}${changelistId ? `\n\nChangelist: https://steamdb.info/changelist/${changelistId}/` : ''}`,
            timestamp: when
          };
          const textToCheck = `${item.title || ''} ${item.snippet || ''}`;
          embed.__mentionEveryone = shouldMentionEveryoneForText(textToCheck);
          embeds.push(embed);
          snapshots[target.id] = item.id;
        } else {
          console.log('No change for', target.id);
        }
      } else {
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
          const textToCheck = `${target.label || ''} ${snippet}`;
          embed.__mentionEveryone = shouldMentionEveryoneForText(textToCheck);
          embeds.push(embed);
          snapshots[target.id] = current;
        } else {
          console.log('No change for', target.id);
        }
      }
    } catch (err) {
      console.error('Error checking', target.id, err.message);
    }
  }

  if (embeds.length > 0) {
    const shouldMention = embeds.some(e => e.__mentionEveryone);
    const content = shouldMention ? '@everyone' : '';
    const allowed = shouldMention ? { parse: ['everyone'] } : undefined;
    const finalEmbeds = embeds.map(e => {
      const copy = Object.assign({}, e);
      delete copy.__mentionEveryone;
      return copy;
    });
    await sendWebhook(finalEmbeds, content, allowed);
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
