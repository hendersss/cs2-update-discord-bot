const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

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

async function fetchContent(url) {
  try {
    const res = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': 'steamdb-discord-monitor/1.0' } });
    return String(res.data).replace(/\s+/g, ' ').trim().slice(0, 10000);
  } catch (e) {
    return '';
  }
}

function firstDiffSnippet(prev = '', current = '', maxLen = 300) {
  if (!prev) return String(current || '').slice(0, maxLen);
  if (prev === current) return '';
  let i = 0;
  const min = Math.min(prev.length, current.length);
  while (i < min && prev[i] === current[i]) i++;
  const start = Math.max(0, i - 40);
  const snippet = (current || '').slice(start, start + maxLen);
  return (start > 0 ? '...' : '') + snippet + (snippet.length >= maxLen ? '...' : '');
}

async function sendWebhook(embeds, content = '', allowed_mentions = undefined, webhookUrl) {
  if (!webhookUrl) {
    console.log('No webhook configured; set DISCORD_WEBHOOK');
    return;
  }
  const payload = { embeds };
  if (content) payload.content = content;
  if (allowed_mentions) payload.allowed_mentions = allowed_mentions;
  try {
    // Log the payload we're about to send to help debug 400 responses
    try {
      console.log('Posting webhook payload:', JSON.stringify(payload));
    } catch (e) {
      console.log('Posting webhook payload (stringify failed)');
    }
    const res = await axios.post(webhookUrl, payload, { timeout: 10000 });
    console.log('Posted', embeds.length, 'embed(s) to Discord');
    if (res && res.status) console.log('Webhook response status', res.status);
  } catch (err) {
    // Provide richer error details to diagnose Discord 400 responses
    try {
      if (err.response) {
        console.error('Failed to post to webhook:', err.response.status, err.response.data);
      } else {
        console.error('Failed to post to webhook', err.message);
      }
    } catch (e) {
      console.error('Failed to post to webhook; and error logging failed', e && e.message ? e.message : e);
    }
  }
}

function shouldMentionEveryoneForText(text, config) {
  const defaults = ['game update', 'game patch', 'client update', 'major update'];
  const keys = (config && config.everyone_keywords && Array.isArray(config.everyone_keywords) && config.everyone_keywords.length)
    ? config.everyone_keywords
    : defaults;
  const hay = (text || '').toLowerCase();
  for (const k of keys) {
    if (!k) continue;
    if (hay.includes(String(k).toLowerCase())) return true;
  }
  return false;
}

async function runMonitor({ config = {}, snapshots = {}, webhookUrl, send = true }) {
  const embeds = [];
  let changed = false;
  const newSnapshots = Object.assign({}, snapshots || {});

  for (const target of (config.targets || [])) {
    try {
      console.log('Checking', target.id, target.url);
      if ((target.type && target.type === 'rss') || /PatchnotesRSS|\.xml$|rss\//i.test(target.url)) {
        const item = await fetchRssItem(target.url);
        const prevId = newSnapshots[target.id] || '';
        if (item.id !== prevId) {
          changed = true;
          const when = item.pubDate || new Date().toISOString();

          const titleAndSnippet = `${item.title || ''} ${item.snippet || ''}`;
          const isFileUpdate = /\bfiles?\s+updated\b/i.test(titleAndSnippet);
          const isBranchUpdate = /\bbranch\s+updated\b/i.test(titleAndSnippet);

          if ((isFileUpdate && !config.notify_file_changes) || (isBranchUpdate && !config.notify_branch_updates)) {
            console.log(`Skipping ${isFileUpdate ? 'file' : 'branch'} update for`, target.id);
            newSnapshots[target.id] = item.id;
            continue;
          }

          let changelistId = null;
          const hay = `${item.snippet || ''} ${item.title || ''} ${item.link || ''}`;
          const m = hay.match(/changelist\s*[:#]?\s*(\d{5,})/i);
          if (m) changelistId = m[1];
          else {
            const m2 = (item.link || '').match(/changelist\/(\d+)/i);
            if (m2) changelistId = m2[1];
          }

          // normalize timestamp to ISO8601 string for Discord embeds
          const normalizeTimestamp = (whenVal) => {
            try {
              if (!whenVal) return new Date().toISOString();
              const d = new Date(whenVal);
              if (!isNaN(d.getTime())) return d.toISOString();
              return new Date().toISOString();
            } catch (e) {
              return new Date().toISOString();
            }
          };

          const embed = {
            title: `${target.label || target.id} — ${item.title || 'update detected'}`,
            url: changelistId ? `https://steamdb.info/changelist/${changelistId}/` : (item.link || target.url),
            description: `**When:** ${when}\n**Summary:** ${item.snippet}${changelistId ? `\n\nChangelist: https://steamdb.info/changelist/${changelistId}/` : ''}`,
            timestamp: normalizeTimestamp(when)
          };
          const textToCheck = `${item.title || ''} ${item.snippet || ''}`;
          const isGameUpdate = !isFileUpdate && !isBranchUpdate;
          embed.__mentionEveryone = isGameUpdate && shouldMentionEveryoneForText(textToCheck, config);
          embeds.push(embed);
          newSnapshots[target.id] = item.id;
        } else {
          console.log('No change for', target.id);
        }
      } else {
        const current = await fetchContent(target.url, target.selector);
        const prev = newSnapshots[target.id] || '';
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
          const isFileUpdate = /\bfiles?\s+updated\b/i.test(textToCheck);
          const isBranchUpdate = /\bbranch\s+updated\b/i.test(textToCheck);
          const isGameUpdate = !isFileUpdate && !isBranchUpdate;
          embed.__mentionEveryone = isGameUpdate && shouldMentionEveryoneForText(textToCheck, config);
          embeds.push(embed);
          newSnapshots[target.id] = current;
        } else {
          console.log('No change for', target.id);
        }
      }
    } catch (err) {
      console.error('Error checking', target.id, err && err.message ? err.message : err);
    }
  }

  const mentionEmbeds = embeds.filter(e => e.__mentionEveryone).map(e => {
    const copy = Object.assign({}, e);
    delete copy.__mentionEveryone;
    return copy;
  });
  const otherEmbeds = embeds.filter(e => !e.__mentionEveryone).map(e => {
    const copy = Object.assign({}, e);
    delete copy.__mentionEveryone;
    return copy;
  });

  if (send && mentionEmbeds.length > 0) {
    await sendWebhook(mentionEmbeds, '@everyone', { parse: ['everyone'] }, webhookUrl);
  }
  if (send && otherEmbeds.length > 0) {
    await sendWebhook(otherEmbeds, '', undefined, webhookUrl);
  }

  return { changed, snapshots: newSnapshots, embeds };
}

module.exports = { runMonitor, sendWebhook };
