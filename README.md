<<<<<<< HEAD
# SteamDB → Discord monitor

This project polls configured SteamDB pages and posts concise embed updates to a Discord webhook when content changes.

Quick start

1. Install deps locally:

```bash
npm install
```

2. Add or adjust targets in `config.json` (URLs + optional CSS selector).

3. Run locally (use your webhook URL):

```bash
DISCORD_WEBHOOK="https://discord.com/api/webhooks/..." node src/checker.js
```

Recommended hosting (free):
- GitHub Actions: the included workflow (`.github/workflows/check-steamdb.yml`) runs every 15 minutes. Add a repository secret named `DISCORD_WEBHOOK` with your webhook URL.

Notes about Vercel and hosting:
- This project posts to a Discord webhook and is designed to run on a scheduler (GitHub Actions). Running a persistent Discord bot (using the Gateway) requires a long-running process which is not suitable for Vercel serverless functions. If you want a Gateway-based bot hosted elsewhere, I can adapt the code.

If you want, I can:
- Push this repo to GitHub and help set the `DISCORD_WEBHOOK` secret.
- Adapt the monitor to run as a Vercel cron function with external storage (if you prefer Vercel).
=======
# cs2-update-discord-bot
discord bot that sends updates about the game CS2
>>>>>>> origin/main
