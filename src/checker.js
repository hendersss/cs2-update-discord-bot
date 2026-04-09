const axios = require('axios');
const cheerio = require('cheerio');
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
          const embed = {
            title: `${target.label || target.id} — ${item.title || 'update detected'}`,
            url: item.link || target.url,
            description: `**When:** ${when}\n**Summary:** ${item.snippet}`,
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
