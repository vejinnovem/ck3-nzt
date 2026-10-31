# CK3-NZT

Persistent strategic memory and AI advisory bridge for **Crusader Kings III**.

CK3-NZT is an experimental, read-only companion that turns CK3 saves into compact strategic state, keeps a long-term history of the campaign, and prepares model-friendly context for an AI adviser. The player still makes every decision and performs every action in the game.

> **Alpha:** the project is usable for local testing, but the storage schema and workflows may still change.

## What it does

CK3-NZT currently:

- reads the newest parseable CK3 save;
- extracts realm, military, succession, diplomacy, vassals, factions, titles and expansion data;
- keeps persistent campaign history in a local SQLite database;
- computes strategic changes between snapshots;
- computes lightweight trends from recent snapshots;
- exports compact JSON files that can be synced or supplied to an AI model;
- retains the original read-only MCP tools from CK3 Strategy Advisor.

The intended architecture is:

```text
CK3 save
   |
   v
CK3-NZT parser / extractors
   |
   +--> local SQLite memory
   |      snapshots + strategic changes
   |
   +--> compact AI export
          current.json
          changes.json
          trends.json
          manifest.json
               |
               +--> local AI / MCP
               +--> synced folder (for example Google Drive)
```

SQLite is the durable source of historical data. The AI does not need to ingest the whole campaign history on every question; CK3-NZT can precompute the small state/change/trend views that matter for the next decision.

## Windows quick start

CK3-NZT includes an idempotent PowerShell installer/updater. It installs Git and a current Node.js LTS release through WinGet when necessary, clones the repository, installs npm dependencies and runs the verification suite locally.

Download and run it from PowerShell:

```powershell
iwr https://raw.githubusercontent.com/vejinnovem/ck3-nzt/main/setup.ps1 -OutFile "$env:TEMP\ck3-nzt-setup.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\ck3-nzt-setup.ps1"
```

Default application location:

```text
%LOCALAPPDATA%\CK3-NZT\app
```

After installation, capture the newest CK3 state with:

```powershell
cd "$env:LOCALAPPDATA\CK3-NZT\app"
npm run export
```

Future updates can be applied by double-clicking `update.cmd` in the application directory or by running `setup.ps1` again.

## Local verification

GitHub-hosted CI is intentionally not used. Installation and every normal update run `verify.ps1` locally.

The checks are executed independently:

```text
lint
build
tests
```

A failure in one check does not prevent the remaining checks from running. A combined PASS/FAIL summary is printed at the end and the installer/updater exits with an error if any check failed.

You can also run the verification manually:

```powershell
.\verify.ps1
```

Formatting remains available as a separate developer check:

```powershell
npm run format:check
```

## Local data and privacy

No OpenAI, Google, GitHub or other API token is required for the core parser, memory database or exporter.

By default, runtime data is kept outside the Git repository:

```text
%LOCALAPPDATA%\CK3-NZT\data\memory.sqlite
%LOCALAPPDATA%\CK3-NZT\export\current.json
%LOCALAPPDATA%\CK3-NZT\export\changes.json
%LOCALAPPDATA%\CK3-NZT\export\trends.json
%LOCALAPPDATA%\CK3-NZT\export\manifest.json
```

The source fingerprint written to the export deliberately excludes the absolute CK3 save path and Windows username.

If you use Google Drive for Desktop (or another folder-sync tool), point only the export directory at a synced folder. The SQLite database can remain local, so CK3-NZT does not need Google OAuth credentials at all.

Example for the current PowerShell session:

```powershell
$env:CK3_NZT_OUTPUT_DIR = "X:\Some Synced Folder\CK3-NZT"
npm run export
```

Do not commit local exports, databases, `.env` files or credentials. The repository `.gitignore` excludes common secret and runtime files.

## Configuration

Environment variables:

| Variable | Purpose |
| --- | --- |
| `CK3_SAVE_DIR` | Override the CK3 save directory. |
| `CK3_GAME_DIR` | Override the CK3 `game` directory used for localization. |
| `CK3_NZT_DATA_DIR` | Override the private local SQLite data directory. |
| `CK3_NZT_OUTPUT_DIR` | Override the compact export directory; this can be a synced folder. |

On Windows CK3-NZT first checks the current user's Documents/OneDrive Documents locations. The original WSL `/mnt/c/...` discovery remains as a fallback.

## Build from source

Requirements:

- Node.js **22.13+**
- Git

```bash
npm ci
npm run build
npm test
```

Useful commands:

```bash
npm run export       # parse newest save and update persistent memory/export
npm run dev:export   # same from TypeScript source
npm run dev          # run the inherited MCP server from source
npm run lint
npm run format:check
```

## Save format limitation

The current parser supports normal text-format CK3 saves. CK3 autosaves and Ironman saves use the binary token format and are currently skipped/not decoded. Keep a normal manual save when you want a fresh strategic snapshot.

## Upstream project and license

CK3-NZT is built on **CK3 Strategy Advisor** by Thom Andretti:

https://github.com/thomandretti/ck3-strategy-advisor

The original repository history was preserved when CK3-NZT was created. Its save parsing, schema research, extractors and MCP tools form the initial technical foundation of this project.

The upstream project is MIT licensed. See [LICENSE](LICENSE). The original copyright and license notice are preserved.

This is an unofficial fan-made project. Crusader Kings III is a trademark of Paradox Interactive AB. CK3-NZT is not affiliated with or endorsed by Paradox Interactive.
