#!/usr/bin/env node
import { createHash } from "node:crypto";
import { resolveConfig, discoverGameDir, discoverSaveDir } from "./config.js";
import { extractGamestate, IronmanError } from "./envelope.js";
import { Localizer } from "./localization.js";
import { persistSnapshot } from "./memory.js";
import { buildSnapshot } from "./snapshot.js";
import { SaveFileSource } from "./source.js";

async function main(): Promise<void> {
  const cfg = resolveConfig();
  const saveDir = cfg.saveDir ?? (await discoverSaveDir());
  if (!saveDir) {
    throw new Error("No CK3 save directory found. Set CK3_SAVE_DIR and try again.");
  }

  const source = new SaveFileSource({ saveDir });
  const ref = await source.latest();
  if (!ref) throw new Error("No CK3 save found. Make a normal save and try again.");

  const save = await source.read(ref);
  const gamestate = extractGamestate(save);
  const gameDir = cfg.gameDir ?? (await discoverGameDir());
  const snapshot = await buildSnapshot(gamestate, new Localizer(gameDir));

  // Intentionally excludes the absolute save path and Windows username.
  const sourceFingerprint = createHash("sha256")
    .update(`${ref.mtimeMs}:${save.length}:${snapshot.date}:${snapshot.overview.primaryTitle}`)
    .digest("hex");

  const result = await persistSnapshot(snapshot, { sourceFingerprint });

  if (result.written) {
    console.log(
      `CK3-NZT snapshot ${snapshot.date} stored (${result.changeCount} strategic changes).`,
    );
  } else if (result.refreshed) {
    console.log(`CK3-NZT snapshot ${snapshot.date} was already stored; AI export refreshed.`);
  } else {
    console.log(`CK3-NZT is already up to date for ${snapshot.date}.`);
  }
  console.log(`AI export: ${result.outputDir}`);
  console.log(`Memory DB: ${result.databasePath}`);
}

main().catch((error: unknown) => {
  if (error instanceof IronmanError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
});
