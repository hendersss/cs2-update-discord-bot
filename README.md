# cs2 update discord bot

Monitor CS2 patchnotes via SteamDB Patchnotes RSS and post updates to a Discord webhook.

## PowerShell (local test)

1. Install dependencies:

```powershell
cd "c:/Users/jakub/Downloads/discord bot"
npm install
```

2. Set your webhook and run the monitor once:

```powershell
$env:DISCORD_WEBHOOK='https://discord.com/api/webhooks/...'
node src/checker.js
```

3. To avoid the initial notification (seed snapshots without sending):

```powershell
$env:DISCORD_WEBHOOK=$null
node src/checker.js
git add snapshots.json
git commit -m "Initialize snapshots"
git push
```

## GitHub Actions (recommended hosting)

1. Add webhook secret:

- Repository → Settings → Secrets and variables → Actions → New repository secret
- Name: `DISCORD_WEBHOOK`
- Value: your webhook URL

2. The workflow `.github/workflows/check-steamdb.yml` runs on schedule (every 15 minutes), on push, and can be run manually from Actions → Check SteamDB and Post to Discord → Run workflow.

3. If Actions must push `snapshots.json`, enable workflow write access:

- Repository → Settings → Actions → General → Workflow permissions → set to Read and write
