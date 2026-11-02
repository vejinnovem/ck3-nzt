#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  formatProgress,
  formatStatus,
  highlightSaveFilename,
  type ConsoleTone,
} from "./consoleUi.js";
import { resolveConfig, discoverSaveDir } from "./config.js";
import { exportLatest, type ExportProgressEvent } from "./exporter.js";
import { SaveFileSource } from "./source.js";

const DEFAULT_POLL_MS = 1000;
const DEFAULT_STABLE_POLLS = 2;
const RETRY_DELAY_MS = 5000;
const DEFAULT_UPDATE_CHECK_MS = 5 * 60 * 1000;
export const AUTO_UPDATE_RESTART_EXIT_CODE = 75;
export const MAIN_UPDATE_FETCH_ARGS = [
  "fetch",
  "origin",
  "+refs/heads/main:refs/remotes/origin/main",
  "--quiet",
] as const;

const execFileAsync = promisify(execFile);
const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type StabilityAction = "wait" | "process" | "processed";
type AutoUpdateResult = "current" | "restart" | "skipped";
type CommandOutput = (command: string, args: string[], cwd: string) => Promise<string>;
type UpdateSetup = (projectDir: string) => Promise<void>;

export interface SelfUpdateDependencies {
  commandOutput?: CommandOutput;
  runUpdateSetup?: UpdateSetup;
}

export class SaveStabilityTracker {
  private observedSignature: string | null = null;
  private stablePolls = 0;
  private processedSignature: string | null = null;

  constructor(private readonly requiredStablePolls = DEFAULT_STABLE_POLLS) {}

  observe(signature: string): StabilityAction {
    if (signature !== this.observedSignature) {
      this.observedSignature = signature;
      this.stablePolls = 1;
      return "wait";
    }

    this.stablePolls += 1;
    if (signature === this.processedSignature) return "processed";
    return this.stablePolls >= this.requiredStablePolls ? "process" : "wait";
  }

  markProcessed(signature: string): void {
    this.processedSignature = signature;
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false });
}

function log(message: string, tone: ConsoleTone = "info"): void {
  console.log(`[${timestamp()}] ${formatStatus(message, tone)}`);
}

function logDetectedSave(filename: string): void {
  console.log(
    `[${timestamp()}] ${formatStatus("Save detected:", "info")} ${highlightSaveFilename(filename)}`,
  );
}

function logExportProgress(event: ExportProgressEvent): void {
  console.log(
    `[${timestamp()}] ${formatProgress(event.date, event.message, event.tone ?? "info")}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function commandOutput(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function runUpdateSetup(projectDir: string): Promise<void> {
  const setupPath = resolve(projectDir, "setup.ps1");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        setupPath,
        "-InstallDir",
        projectDir,
        "-SkipVerification",
      ],
      {
        cwd: projectDir,
        stdio: "inherit",
        windowsHide: false,
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          signal
            ? `setup.ps1 terminated by signal ${signal}`
            : `setup.ps1 exited with code ${String(code)}`,
        ),
      );
    });
  });
}

export async function checkForSelfUpdate(
  projectDir = PROJECT_DIR,
  dependencies: SelfUpdateDependencies = {},
): Promise<AutoUpdateResult> {
  const runCommand = dependencies.commandOutput ?? commandOutput;
  const applyUpdate = dependencies.runUpdateSetup ?? runUpdateSetup;

  try {
    const branch = await runCommand("git", ["branch", "--show-current"], projectDir);
    if (branch !== "main") {
      log(`Auto-update skipped: current branch is '${branch || "detached HEAD"}'.`, "warning");
      return "skipped";
    }

    const dirty = await runCommand("git", ["status", "--porcelain"], projectDir);
    if (dirty) {
      log("Auto-update skipped: local repository changes are present.", "warning");
      return "skipped";
    }

    // Update origin/main explicitly. This avoids relying on the caller's remote.fetch
    // mapping when deciding whether the clean local main is behind GitHub main.
    await runCommand("git", [...MAIN_UPDATE_FETCH_ARGS], projectDir);
    const localHead = await runCommand("git", ["rev-parse", "HEAD"], projectDir);
    const remoteHead = await runCommand("git", ["rev-parse", "origin/main"], projectDir);
    if (localHead === remoteHead) return "current";

    const divergence = await runCommand(
      "git",
      ["rev-list", "--left-right", "--count", "HEAD...origin/main"],
      projectDir,
    );
    const [aheadText, behindText] = divergence.split(/\s+/);
    const ahead = Number(aheadText);
    const behind = Number(behindText);

    if (!Number.isFinite(ahead) || !Number.isFinite(behind) || ahead !== 0 || behind <= 0) {
      log(
        `Auto-update skipped: local main is not a clean fast-forward (${divergence}).`,
        "warning",
      );
      return "skipped";
    }

    log(`Update available: ${localHead.slice(0, 8)} -> ${remoteHead.slice(0, 8)}.`, "warning");
    log("Applying update and rebuilding CK3-NZT...", "info");
    await applyUpdate(projectDir);
    log("Update installed; watcher will restart.", "success");
    return "restart";
  } catch (error: unknown) {
    log(
      `Auto-update check failed; retrying later: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "warning",
    );
    return "skipped";
  }
}

export async function watchSaves(
  pollMs = DEFAULT_POLL_MS,
  updateCheckMs = DEFAULT_UPDATE_CHECK_MS,
): Promise<"restart" | never> {
  const cfg = resolveConfig();
  const saveDir = cfg.saveDir ?? (await discoverSaveDir());
  if (!saveDir) {
    throw new Error("No CK3 save directory found. Set CK3_SAVE_DIR and try again.");
  }

  const source = new SaveFileSource({ saveDir });
  const tracker = new SaveStabilityTracker();
  let retrySignature: string | null = null;
  let retryAfter = 0;
  let announcedWaiting = false;
  let nextUpdateCheckAt = 0;

  log("CK3-NZT watcher started. Ctrl+C stops it.", "success");
  log("Auto-update: clean local main only.", "muted");
  log("Waiting for a stable manual CK3 save...", "muted");

  for (;;) {
    if (Date.now() >= nextUpdateCheckAt) {
      nextUpdateCheckAt = Date.now() + updateCheckMs;
      if ((await checkForSelfUpdate()) === "restart") return "restart";
    }

    const ref = await source.latest();
    if (!ref || !(await source.isTextSave(ref))) {
      if (!announcedWaiting) {
        log("No parseable manual save yet; binary autosaves are ignored.", "muted");
        announcedWaiting = true;
      }
      await sleep(pollMs);
      continue;
    }
    announcedWaiting = false;

    let fileStat;
    try {
      fileStat = await stat(ref.path);
    } catch {
      await sleep(pollMs);
      continue;
    }

    const signature = `${ref.path}:${fileStat.mtimeMs}:${fileStat.size}`;
    const action = tracker.observe(signature);
    if (action !== "process") {
      await sleep(pollMs);
      continue;
    }

    if (retrySignature === signature && Date.now() < retryAfter) {
      await sleep(pollMs);
      continue;
    }

    try {
      // Always check immediately before an export so a newly saved checkpoint cannot be
      // exported with a parser version that already has a newer main available.
      if ((await checkForSelfUpdate()) === "restart") return "restart";

      logDetectedSave(basename(ref.path));
      await exportLatest({ onProgress: logExportProgress });
      tracker.markProcessed(signature);
      retrySignature = null;
      retryAfter = 0;
      nextUpdateCheckAt = Date.now() + updateCheckMs;
      log("Waiting for the next save.", "muted");
    } catch (error: unknown) {
      retrySignature = signature;
      retryAfter = Date.now() + RETRY_DELAY_MS;
      log(
        `Export failed; retrying if this save stays current: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    }

    await sleep(pollMs);
  }
}

async function main(): Promise<void> {
  try {
    const result = await watchSaves();
    if (result === "restart") process.exitCode = AUTO_UPDATE_RESTART_EXIT_CODE;
  } catch (error: unknown) {
    console.error(formatStatus(error instanceof Error ? error.message : String(error), "error"));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
