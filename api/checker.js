const axios = require('axios');
const { runMonitor } = require('../src/monitor');

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

    // run up to 3 times in case of snapshot conflicts
    for (let attempt = 0; attempt < 3; attempt++) {
      let snapshots = {};
      let snapshotsSha = null;
      try {
        const snap = await getRepoFile(api, owner, repo, 'snapshots.json');
        snapshotsSha = snap.sha;
        if (snap && snap.content) snapshots = JSON.parse(Buffer.from(snap.content, 'base64').toString('utf8'));
      } catch (e) {
        // if missing, we'll create it
        snapshots = {};
      }

      const webhookUrl = DISCORD_WEBHOOK || process.env[config.discord_webhook_env] || process.env.DISCORD_WEBHOOK;
      const result = await runMonitor({ config, snapshots, webhookUrl });

      if (!result.changed) {
        res.status(200).json({ ok: true, changed: false });
        return;
      }

      const newContent = Buffer.from(JSON.stringify(result.snapshots, null, 2), 'utf8').toString('base64');
      try {
        await updateRepoFile(api, owner, repo, 'snapshots.json', newContent, snapshotsSha);
        res.status(200).json({ ok: true, changed: true });
        return;
      } catch (e) {
        // Conflict or other error — try again (re-fetch snapshots)
        console.warn('Failed to update snapshots (attempt', attempt + 1, ')', e && e.message ? e.message : e);
        if (attempt === 2) {
          res.status(500).json({ ok: false, error: 'Failed to update snapshots after retries', details: e && e.message ? e.message : e });
          return;
        }
      }
    }
  } catch (err) {
    console.error('API handler error', err && err.message ? err.message : err);
    res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
