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
