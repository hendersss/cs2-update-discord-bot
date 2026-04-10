const fs = require('fs');
const path = require('path');
const { runMonitor } = require('./monitor');

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

(async () => {
  try {
    const result = await runMonitor({ config, snapshots, webhookUrl });
    if (result.changed) {
      try {
        fs.writeFileSync(SNAP_PATH, JSON.stringify(result.snapshots, null, 2));
        console.log('Wrote snapshots to', SNAP_PATH);
      } catch (e) {
        console.error('Failed to write snapshots', e.message);
        process.exitCode = 2;
      }
    } else {
      console.log('No changes detected');
    }
  } catch (err) {
    console.error('Monitor error', err && err.message ? err.message : err);
    process.exitCode = 2;
  }
})();
