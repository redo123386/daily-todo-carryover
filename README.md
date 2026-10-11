# Daily Todo Carryover

A RemNote plugin that moves unfinished todos from previous Daily Documents into today's, automatically once a day. Supports portal mode, Do Not Rollover, Omni Rollover and a look-back limit.

## Scheduling fixes (vs. the original Rollover Daily Todos plugin)

1. **Fresh installs could never start.** The auto-rollover only ran if a "last auto rollover" date already existed *and* was a different day. That date was only ever saved by a successful auto-rollover. On a new install it was empty, so the check failed every 5 minutes forever. The manual command didn't save it either, so running it by hand never unlocked the automatic one.
2. **It compared only the day of the month** (`getDate()`), not the full date.
3. **It marked the day as done even when nothing happened.** If today's Daily Document didn't exist yet, it skipped the move but still recorded the run, so nothing happened until the next day.
4. **The timer could break silently.** The interval was created before the plugin was ready. If the first rollover threw an error during startup, the timer never received the plugin and every later tick failed.

## How scheduling works now

- There is one rollover moment per day at **Daily Rollover Time** (default `00:00`, local time).
- RemNote checks every minute, plus whenever the window becomes visible or focused again (e.g. after the computer wakes from sleep).
- If the latest rollover moment is newer than the last rollover, it runs. That means:
  - it runs within about a minute of the set time while RemNote is open;
  - if RemNote was closed at that time, it **catches up as soon as you open RemNote**;
  - on first install it runs once right away;
  - it never runs twice for the same day. Manual runs count too.
- If today's Daily Document doesn't exist, the plugin creates it (setting: *Create Today's Daily Document If Missing*). With that setting off, it waits and retries each minute until you open today's document. It never marks the day done without doing the rollover.
- Run **Rollover Status** from the command palette to see the last and next rollover times.

> Like every RemNote plugin, this only runs while RemNote is open (desktop app or a browser tab). If RemNote is closed at the set time, the rollover happens the next time you open it.

## Build

Requires Node.js 18 or newer.

```bash
npm install
npm run build        # produces PluginZip.zip in this folder
```

`npm run build` runs RemNote's manifest validator, which only works inside a git repository (`git init` first). `start.bat` uses `npm run build:dist`, which doesn't need git.

## Install in RemNote

**Before installing, disable or uninstall the original "Rollover Daily Todos" plugin**, otherwise both will roll over your todos.

- **Run it locally (Windows):** double-click `start.bat`. It installs dependencies, builds the plugin and serves it at `http://localhost:8080`. In RemNote, go to Settings → Plugins → Build → *Develop from localhost* and enter `http://localhost:8080`. The plugin only loads while that window is open. To have it start automatically, put a shortcut to `start.bat` in your Startup folder (Win+R → `shell:startup`). On other systems, run `npm install && npm run build:dist && npm run serve`. `npm run dev` gives you a hot-reloading server for editing the code.
- **Install permanently (upload to RemNote):** create an empty public GitHub repo, then double-click `prepare-upload.bat`. It saves the repo URL in the manifest, pushes the code to GitHub and builds `PluginZip.zip`. Upload that in Settings → Plugins → Build → *Upload plugin*. The plugin is marked unlisted, so it won't appear in the store. After RemNote approves it, install it from `https://www.remnote.com/plugins/daily-todo-carryover`. Keep the `LICENSE` file in the repo.

Powerup tags such as *Do Not Rollover* and *Omni Rollover* belong to the plugin that registered them. If you used them with the original plugin, re-apply them with this plugin's commands (`dnr`, `or`).

## Settings

| Setting | Default | Notes |
|---|---|---|
| Daily Rollover Time | `00:00` | 24-hour `hh:mm`, local time |
| Disable Auto Rollover | off | Rollover runs only from the command |
| Create Today's Daily Document If Missing | on | |
| Portal Mode | on | Portal todos into today instead of moving them |
| Date Limit | 7 | Days to look back |
| Debug Mode | off | Logs every check to the console; adds *Debug: Reset Last Rollover Time* |
