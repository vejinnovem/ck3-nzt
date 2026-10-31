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

CK3-NZT includes an idempotent PowerShell installer/updater. It installs Git and a current Node.js LTS release through WinGet when necessary, clones the repository, installs npm dependencies, runs the verification suite locally and stores CK3 paths in a persistent local configuration file.

Open **Windows PowerShell** and run:

```powershell
iwr https://raw.githubusercontent.com/vejinnovem/ck3-nzt/main/setup.ps1 -OutFile "$env:TEMP\ck3-nzt-setup.ps1"
Set-ExecutionPolicy -Scope Process Bypass -Force
& "$env:TEMP\ck3-nzt-setup.ps1"
```

Run the script in the current PowerShell session as shown above. This matters on the first install: if Git or Node.js has just been installed, the script refreshes `PATH` for that session so `git`, `node` and `npm` are immediately available afterwards.

If you previously launched setup through a separate command such as `powershell.exe -File ...`, the parent PowerShell window can still have the old `PATH`. Either open a new PowerShell window or refresh it manually:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
```

Default application location:

```text
%LOCALAPPDATA%\CK3-NZT\app
```

Persistent local configuration:

```text
%LOCALAPPDATA%\CK3-NZT\config.json
```

The installer first tries to locate the real Windows Documents folder (including redirected/OneDrive Documents) and the CK3 save directory. If it cannot find the saves, it asks for the full path to the `save games` folder. It also tries to locate the CK3 `game` directory for localization and can ask for it separately.

After installation, capture the newest CK3 state with:

```powershell
cd "$env:LOCALAPPDATA\CK3-NZT\app"
npm run export
```

Future updates can be applied by double-clicking `update.cmd` in the application directory or by running `setup.ps1` again. Existing path configuration is preserved. To change the saved paths later:

```powershell
.\setup.ps1 -Reconfigure
```

or directly:

```powershell
.\configure.ps1 -Force
```

## First test on Windows

For the first alpha test, use a small throwaway CK3 campaign rather than an important long-running save.

1. Start Crusader Kings III and create or load a normal **non-Ironman** game.
2. Play briefly if you want the first snapshot to contain some game history.
3. Create a **manual save**. Do not rely on an autosave for the first test; the current parser cannot decode CK3's binary autosave/Ironman format.
4. Close CK3 or leave it running. CK3-NZT only reads the save file and does not modify the game or save.
5. Open PowerShell and run the three-command installer from the Windows quick start section above.
6. A successful installation ends with a local verification summary. `Lint`, `Build` and `Tests` should each report `PASS`.
7. During first-time configuration, confirm the automatically detected save directory or paste the full path to the CK3 `save games` folder when prompted.
8. Then run:

```powershell
cd "$env:LOCALAPPDATA\CK3-NZT\app"
npm run export
```

A successful first export creates:

```text
%LOCALAPPDATA%\CK3-NZT\data\memory.sqlite
%LOCALAPPDATA%\CK3-NZT\export\current.json
%LOCALAPPDATA%\CK3-NZT\export\changes.json
%LOCALAPPDATA%\CK3-NZT\export\trends.json
%LOCALAPPDATA%\CK3-NZT\export\manifest.json
```

On the first snapshot, `changes.json` may contain no changes because there is no previous state to compare with. To test memory and deltas, return to CK3, let something meaningful change (gold, military strength, vassals, factions, wars, etc.), make another manual save and run `npm run export` again. The second export should preserve both snapshots in SQLite and describe detected differences in `changes.json`.

You can inspect the generated files directly from PowerShell:

```powershell
Get-Content "$env:LOCALAPPDATA\CK3-NZT\export\manifest.json"
Get-Content "$env:LOCALAPPDATA\CK3-NZT\export\changes.json"
```

If the configured path is wrong or you move the CK3 data later, run:

```powershell
.\configure.ps1 -Force
```

Environment variables can still override the saved configuration for one session, for example:

```powershell
$env:CK3_SAVE_DIR = "D:\path\to\Crusader Kings III\save games"
npm run export
```

Do not put a personal Windows path into repository files or commit it to Git. The persistent config lives outside the repository under `%LOCALAPPDATA%\CK3-NZT`.

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
%LOCALAPPDATA%\CK3-NZT\config.json
%LOCALAPPDATA%\CK3-NZT\data\memory.sqlite
%LOCALAPPDATA%\CK3-NZT\export\current.json
%LOCALAPPDATA%\CK3-NZT\export\changes.json
%LOCALAPPDATA%\CK3-NZT\export\trends.json
%LOCALAPPDATA%\CK3-NZT\export\manifest.json
```

The source fingerprint written to the export deliberately excludes the absolute CK3 save path and Windows username.

If you use Google Drive for Desktop (or another folder-sync tool), point only the export directory at a synced folder. The SQLite database and local configuration can remain local, so CK3-NZT does not need Google OAuth credentials at all.

Example for the current PowerShell session:

```powershell
$env:CK3_NZT_OUTPUT_DIR = "X:\Some Synced Folder\CK3-NZT"
npm run export
```

Do not commit local exports, databases, `.env` files or credentials. The repository `.gitignore` excludes common secret and runtime files.

## Configuration

Persistent Windows configuration is stored in `%LOCALAPPDATA%\CK3-NZT\config.json`. Environment variables take precedence over that file and are useful for temporary overrides.

| Variable | Purpose |
| --- | --- |
| `CK3_SAVE_DIR` | Override the CK3 save directory. |
| `CK3_GAME_DIR` | Override the CK3 `game` directory used for localization. |
| `CK3_NZT_CONFIG_FILE` | Override the local configuration file path. |
| `CK3_NZT_DATA_DIR` | Override the private local SQLite data directory. |
| `CK3_NZT_OUTPUT_DIR` | Override the compact export directory; this can be a synced folder. |

On Windows the configurator checks the actual Documents location from the current user's Windows shell settings, OneDrive locations and common Steam paths before prompting. The original WSL `/mnt/c/...` discovery remains as a fallback inside the application.

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
