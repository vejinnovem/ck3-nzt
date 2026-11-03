#!/usr/bin/env node
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { attachAdvisoryContext } from "./advisory.js";
import { getBuildInfo } from "./buildInfo.js";
import { formatProgress, type ConsoleTone } from "./consoleUi.js";
import { resolveConfig, discoverGameDir, discoverSaveDir } from "./config.js";
import { extractGamestate, IronmanError } from "./envelope.js";
import { attachRulerHealthSemantics } from "./health.js";
import { Localizer } from "./localization.js";
import { persistSnapshot } from "./memory.js";
import { augmentChangesWithPressReview } from "./pressReview.js";
import { enrichPressReviewWithLiveEvidence } from "./pressReviewEnrichment.js";
import { attachSnapshotSkillSemantics } from "./skills.js";
import { buildSnapshot } from "./snapshot.js";
import { SaveFileSource } from "./source.js";

export interface ExportProgressEvent {
  date: string | null;
  message: string;
  tone?: ConsoleTone;
}

export interface ExportLatestOptions {
  onProgress?: (event: ExportProgressEvent) => void;
}

function achievementLabel(value: boolean | null | undefined): string {
  if (value === true) return "ENABLED";
  if (value === false) return "DISABLED";
  return "UNKNOWN";
}

function emitProgress(options: ExportLatestOptions, event: ExportProgressEvent): void {
  if (options.onProgress) {
    options.onProgress(event);
    return;
  }
  console.log(formatProgress(event.date, event.message, event.tone ?? "info"));
}

export async function exportLatest(options: ExportLatestOptions = {}): Promise<void> {
  const cfg = resolveConfig();
  const saveDir = cfg.saveDir ?? (await discoverSaveDir());
  if (!saveDir) {
    throw new Error("No CK3 save directory found. Set CK3_SAVE_DIR and try again.");
  }

  const source = new SaveFileSource({ saveDir });
  const ref = await source.latest();
  if (!ref) throw new Error("No CK3 save found. Make a normal save and try again.");

  emitProgress(options, { date: null, message: `Reading ${basename(ref.path)}...`, tone: "info" });
  const save = await source.read(ref);

  emitProgress(options, { date: null, message: "Extracting gamestate...", tone: "muted" });
  const gamestate = extractGamestate(save);
  const gameDir = cfg.gameDir ?? (await discoverGameDir());

  emitProgress(options, {
    date: null,
    message: "Parsing ruler / realm / military / diplomacy / succession...",
    tone: "info",
  });
  const snapshot = attachAdvisoryContext(
    attachSnapshotSkillSemantics(
      attachRulerHealthSemantics(await buildSnapshot(gamestate, new Localizer(gameDir))),
    ),
  );
  const build = getBuildInfo();
  Object.assign(snapshot, { build });

  emitProgress(options, {
    date: snapshot.date,
    message: `${snapshot.overview.rulerName} | ${snapshot.overview.primaryTitle} | build ${build.buildId}`,
    tone: "info",
  });
  emitProgress(options, {
    date: snapshot.date,
    message: `Achievements: ${achievementLabel(snapshot.game?.achievementsEligible)}`,
    tone: snapshot.game?.achievementsEligible === false ? "warning" : "muted",
  });

  // Intentionally excludes the absolute save path and Windows username.
  const sourceFingerprint = createHash("sha256")
    .update(`${ref.mtimeMs}:${save.length}:${snapshot.date}:${snapshot.overview.primaryTitle}`)
    .digest("hex");

  emitProgress(options, {
    date: snapshot.date,
    message: "Computing changes / writing AI export...",
    tone: "info",
  });
  const result = await persistSnapshot(snapshot, { sourceFingerprint });
  await augmentChangesWithPressReview(result.databasePath, result.outputDir, sourceFingerprint);
  const pressReviewCount = await enrichPressReviewWithLiveEvidence(
    result.databasePath,
    result.outputDir,
    sourceFingerprint,
    gamestate,
  );

  if (result.written) {
    emitProgress(options, {
      date: snapshot.date,
      message: `Export complete: ${result.changeCount} changes, ${pressReviewCount} news.`,
      tone: "success",
    });
  } else if (result.refreshed) {
    emitProgress(options, {
      date: snapshot.date,
      message: `Export refreshed: ${result.changeCount} changes, ${pressReviewCount} news.`,
      tone: "success",
    });
  } else {
    emitProgress(options, {
      date: snapshot.date,
      message: `Already current: ${pressReviewCount} news in press review.`,
      tone: "muted",
    });
  }

  if (!options.onProgress) {
    console.log(`AI export: ${result.outputDir}`);
    console.log(`Memory DB: ${result.databasePath}`);
  }
}

async function main(): Promise<void> {
  try {
    await exportLatest();
  } catch (error: unknown) {
    if (error instanceof IronmanError) {
      console.error(error.message);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
