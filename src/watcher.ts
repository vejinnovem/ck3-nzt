#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig, discoverSaveDir } from "./config.js";
import { exportLatest } from "./exporter.js";
import { SaveFileSource } from "./source.js";

const DEFAULT_POLL_MS = 1000;
const DEFAULT_STABLE_POLLS = 2;
const RETRY_DELAY_MS = 5000;

type StabilityAction = "wait" | "process" | "processed";

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

function log(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function watchSaves(pollMs = DEFAULT_POLL_MS): Promise<void> {
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

  log("CK3-NZT save watcher started. Press Ctrl+C to stop.");
  log("Waiting for a stable manual CK3 save...");

  for (;;) {
    const ref = await source.latest();
    if (!ref || !(await source.isTextSave(ref))) {
      if (!announcedWaiting) {
        log("No parseable manual save found yet; binary autosaves are ignored.");
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
      log(`Stable save detected: ${basename(ref.path)}`);
      await exportLatest();
      tracker.markProcessed(signature);
      retrySignature = null;
      retryAfter = 0;
      log("Export complete; watcher is waiting for the next save.");
    } catch (error: unknown) {
      retrySignature = signature;
      retryAfter = Date.now() + RETRY_DELAY_MS;
      log(
        `Export failed; will retry if the save remains current: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await sleep(pollMs);
  }
}

async function main(): Promise<void> {
  try {
    await watchSaves();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
