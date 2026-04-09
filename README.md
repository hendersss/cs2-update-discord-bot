# cs2 update discord bot

This project checks for CS2 updates using SteamDB (RSS or page scraping) and posts concise embed messages to a Discord webhook when changes occur.

## Setup

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/hendersss/cs2-update-webhook-for-discord.git
cd cs2-update-webhook-for-discord
npm install
```

2. Create a Discord webhook for the channel where you want updates.

3. Add the webhook URL as a repository secret (recommended) or use it locally as an env var:

- GitHub: Repository → Settings → Secrets and variables → Actions → New repository secret
- Name: `DISCORD_WEBHOOK`
- Value: the full webhook URL

4. Configure `config.json` to point at the SteamDB resource you want to monitor. Example (Patchnotes RSS):

```json
{
	"discord_webhook_env": "DISCORD_WEBHOOK",
	"everyone_keywords": ["game update","game patch","client update","major update"],
	"targets": [
		{
			"id": "cs2-steamdb-patchnotes",
			"label": "CS2 Patchnotes (SteamDB RSS)",
			"url": "https://steamdb.info/api/PatchnotesRSS/?appid=730",
			"type": "rss"
		}
	]
}
```

Notes:
- Use `type: "rss"` for SteamDB Patchnotes RSS to avoid scraping issues.
- `everyone_keywords` controls which updates trigger an `@everyone` mention (case-insensitive substring match).

## Running

Run locally (one-off):

PowerShell
```powershell
npm install
$env:DISCORD_WEBHOOK='https://discord.com/api/webhooks/...'
node src/checker.js
```

Bash
```bash
npm install
export DISCORD_WEBHOOK='https://discord.com/api/webhooks/...'
node src/checker.js
```

Recommended hosting: GitHub Actions. The repository includes `.github/workflows/check-steamdb.yml` which runs every 15 minutes by default (cron `*/15 * * * *`), on push to `main`, and can be dispatched manually.

## Avoid the initial notification

On first run the monitor will treat the current content as new and post it. To seed `snapshots.json` without sending webhooks:

PowerShell
```powershell
npm install
$env:DISCORD_WEBHOOK=$null
node src/checker.js
git add snapshots.json
git commit -m "Initialize snapshots"
git push
```

Bash
```bash
npm install
DISCORD_WEBHOOK= node src/checker.js
git add snapshots.json && git commit -m "Initialize snapshots" && git push
```

## Testing (how to test yourself)

There are three safe ways to test webhook delivery and mention behavior:

1) Local simulator (recommended): uses `simulate-update` and does not change snapshots

PowerShell
```powershell
npm install
$env:DISCORD_WEBHOOK='https://discord.com/api/webhooks/...'
npm run simulate-update -- --title "Simulated update" --snippet "Test patch (should ping everyone)" --mention
```

Bash
```bash
export DISCORD_WEBHOOK='https://discord.com/api/webhooks/...'
npm run simulate-update -- --title "Simulated update" --snippet "Test patch (should ping everyone)" --mention
```

Flags:
- `--title` / `-t`: embed title
- `--snippet` / `-s`: embed description
- `--mention` / `-m`: force `@everyone`

2) Manual GitHub Actions simulate (from Actions UI):

- Open Actions → select **Simulate update (manual)** → **Run workflow**
- Fill `title`, `snippet`, and `mention` (true/false), then run.

3) Direct webhook test (simple curl):

```bash
curl -H "Content-Type: application/json" \
	-d '{"embeds":[{"title":"test","description":"Hello from test"}]}' \
	'https://discord.com/api/webhooks/...'
```

## @everyone behaviour

- The monitor includes `@everyone` only when the update text contains any keyword from `everyone_keywords` (from `config.json`), or when you explicitly force it via the simulator with `--mention`. The monitor sends `allowed_mentions: { parse: ["everyone"] }` so only intended pings occur.

## Troubleshooting

- If Actions fails to commit `snapshots.json`, ensure workflow permissions allow write access: Repository → Settings → Actions → General → Workflow permissions → **Read and write**.
- If scraping returns 403 for HTML targets, prefer the RSS feed target.
- If you see lockfile mismatch errors in CI, run `npm install` locally and commit the updated `package-lock.json`.

If you want a short badge or extra examples in the README, tell me where you'd like it.

