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

## Config options

- `notify_file_changes`: boolean — Set to `true` to receive notifications when SteamDB reports file changes (includes changelist links). Defaults to `false`.
- `notify_branch_updates`: boolean — Set to `true` to receive notifications when SteamDB reports branch updates. Defaults to `false`.
<<<<<<< HEAD
=======


3. To avoid the initial notification (seed snapshots without sending):

```powershell
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

## Config options

- `notify_file_changes`: boolean — Set to `true` to receive notifications when SteamDB reports file changes (includes changelist links). Defaults to `false`.
- `notify_branch_updates`: boolean — Set to `true` to receive notifications when SteamDB reports branch updates. Defaults to `false`.

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

2. The workflow `.github/workflows/check-steamdb.yml` runs on schedule (every 5 minutes), on push, and can be run manually from Actions → Check SteamDB and Post to Discord → Run workflow.

3. If Actions must push `snapshots.json`, enable workflow write access:

- Repository → Settings → Actions → General → Workflow permissions → set to Read and write

## Deploying to Vercel (avoid GitHub scheduling limits)

If GitHub Actions is rate-limited, you can host the monitor as a serverless function on Vercel and call it with an external cron service (e.g. cron-job.org) every 5 minutes.

Steps:

- Deploy the repository to Vercel (import the GitHub repo in Vercel). The `api/checker.js` endpoint will be available at `https://<your-project>.vercel.app/api/checker`.
- In Vercel Dashboard → Project Settings → Environment Variables add:
  - `DISCORD_WEBHOOK` = your webhook URL
  - `GITHUB_TOKEN` = a GitHub Personal Access Token with `repo` scope (needed to read/write `snapshots.json` and read `config.json`)
  - `GITHUB_REPO` = `owner/repo` (for example `hendersss/cs2-update-webhook-for-discord`)
  - (optional) `GITHUB_BRANCH` = branch name (defaults to `main`)

- Create an external cron job (e.g. https://cron-job.org):
  - URL: `https://<your-project>.vercel.app/api/checker`
  - Method: `GET` (or `POST`)
  - Schedule: every 5 minutes

When the endpoint is called it will:

- fetch `config.json` and `snapshots.json` from the repository using the `GITHUB_TOKEN`,
- run the monitor logic (post Discord messages),
- update `snapshots.json` back into the repository to avoid duplicate notifications.

Notes:

- If you prefer not to store `config.json` in the repo, you can still edit the serverless code to read configuration from environment variables instead.
- The serverless function will retry a few times if `snapshots.json` is modified mid-update, but high-concurrency usage may still conflict.
