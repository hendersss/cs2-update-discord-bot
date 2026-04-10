const axios = require('axios');
const { runMonitor, sendWebhook } = require('../src/monitor');

// Capture Node warnings (including deprecation warnings like DEP0169)
// This logs the full stack to Vercel logs so we can identify the originating module.
process.on('warning', (warning) => {
  try {
    console.warn('Node warning:', warning.name, '-', warning.message);
    if (warning.stack) console.warn(warning.stack);
  } catch (e) {
    // ignore
  }
});

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // owner/repo
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

function githubApi() {
  return axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    },
    timeout: 30000
  });
}

async function getRepoFile(api, owner, repo, path) {
  const res = await api.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`);
  return res.data;
}

async function updateRepoFile(api, owner, repo, path, contentBase64, sha) {
  const body = {
    message: 'Update snapshots [skip ci]',
    content: contentBase64,
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  const res = await api.put(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, body);
  return res.data;
}

module.exports = async (req, res) => {
  try {
    // Log basic incoming request details to help diagnose cron provider behavior
    const method = req.method;
    const url = req.url || req.originalUrl || '';
    const headerKeys = req.headers ? Object.keys(req.headers) : [];
    console.log('Incoming request:', method, url);
    console.log('Incoming header keys:', headerKeys);
    // If present, show X-Forwarded-For to help identify requester
    if (req.headers && req.headers['x-forwarded-for']) {
      console.log('x-forwarded-for:', req.headers['x-forwarded-for']);
    }
  } catch (e) {
    // ignore logging errors
  }
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    res.status(400).json({ ok: false, error: 'GITHUB_TOKEN and GITHUB_REPO env vars are required' });
    return;
  }
  const [owner, repo] = GITHUB_REPO.split('/');
  if (!owner || !repo) {
    res.status(400).json({ ok: false, error: 'GITHUB_REPO must be in owner/repo format' });
    return;
  }

  const api = githubApi();

  try {
    // fetch config.json from repo (optional)
    let config = { discord_webhook_env: 'DISCORD_WEBHOOK', targets: [], notify_file_changes: false, notify_branch_updates: false };
    try {
      const cfg = await getRepoFile(api, owner, repo, 'config.json');
      if (cfg && cfg.content) config = JSON.parse(Buffer.from(cfg.content, 'base64').toString('utf8'));
    } catch (e) {
      console.log('No config.json in repo or failed to fetch; using defaults');
    }

    // Fetch snapshots once, run monitor without sending webhooks, then attempt to persist
    let snapshots = {};
    let snapshotsSha = null;
    try {
      const snap = await getRepoFile(api, owner, repo, 'snapshots.json');
      snapshotsSha = snap.sha;
      if (snap && snap.content) snapshots = JSON.parse(Buffer.from(snap.content, 'base64').toString('utf8'));
    } catch (e) {
      snapshots = {};
    }

    const webhookUrl = DISCORD_WEBHOOK || process.env[config.discord_webhook_env] || process.env.DISCORD_WEBHOOK;
    // Run monitor but do not send webhooks yet — we'll send only after a successful snapshot write
    const result = await runMonitor({ config, snapshots, webhookUrl, send: false });

    if (!result.changed) {
      res.status(200).json({ ok: true, changed: false });
      return;
    }

    let newContent = Buffer.from(JSON.stringify(result.snapshots, null, 2), 'utf8').toString('base64');

    // Try to update snapshots up to 3 times; only send webhooks after a successful write
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await updateRepoFile(api, owner, repo, 'snapshots.json', newContent, snapshotsSha);

        // Persist succeeded — now send the webhook(s) exactly once
        const embeds = Array.isArray(result.embeds) ? result.embeds : [];
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

        if (mentionEmbeds.length > 0) await sendWebhook(mentionEmbeds, '@everyone', { parse: ['everyone'] }, webhookUrl);
        if (otherEmbeds.length > 0) await sendWebhook(otherEmbeds, '', undefined, webhookUrl);

        res.status(200).json({ ok: true, changed: true });
        return;
      } catch (e) {
        console.warn('Failed to update snapshots (attempt', attempt + 1, ')', e && e.message ? e.message : e);
        // If last attempt, fail
        if (attempt === 2) {
          res.status(500).json({ ok: false, error: 'Failed to update snapshots after retries', details: e && e.message ? e.message : e });
          return;
        }

        // Otherwise, re-fetch the latest snapshots and retry
        try {
          const snap2 = await getRepoFile(api, owner, repo, 'snapshots.json');
          snapshotsSha = snap2.sha;
          snapshots = snap2 && snap2.content ? JSON.parse(Buffer.from(snap2.content, 'base64').toString('utf8')) : {};
        } catch (e2) {
          snapshots = {};
          snapshotsSha = null;
        }

        // Re-run monitor (no send) against latest snapshots to get a fresh result
        const fresh = await runMonitor({ config, snapshots, webhookUrl, send: false });
        if (!fresh.changed) {
          res.status(200).json({ ok: true, changed: false });
          return;
        }
        // Use the fresh snapshots and embeds for the next attempt
        newContent = Buffer.from(JSON.stringify(fresh.snapshots, null, 2), 'utf8').toString('base64');
        // Also replace result.embeds with fresh.embeds for final send
        result.embeds = fresh.embeds;
      }
    }
  } catch (err) {
    console.error('API handler error', err && err.message ? err.message : err);
    res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
