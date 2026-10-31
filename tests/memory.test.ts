import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { buildChanges, persistSnapshot, resolveOutputDir } from "../src/memory.js";
import type { Snapshot } from "../src/snapshot.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function makeSnapshot(date: string, gold: number, strength: number): Snapshot {
  return {
    date,
    parsedAt: Date.now(),
    overview: {
      rulerName: "Test Ruler",
      date,
      primaryTitle: "Test Realm",
      tier: 2,
      house: "Test House",
      gold,
      prestige: 100,
      piety: 50,
    },
    military: {
      levy: 1000,
      strength,
      currentStrength: strength,
      strengthWithoutHires: strength,
      wars: [],
    },
    succession: {} as Snapshot["succession"],
    diplomacy: {} as Snapshot["diplomacy"],
    factions: [],
    vassals: [],
    vassalCount: 3,
    expansion: {} as Snapshot["expansion"],
    titles: {} as Snapshot["titles"],
  };
}

test("first snapshot establishes a baseline without synthetic changes", () => {
  const current = makeSnapshot("1066.9.15", 100, 2000);
  expect(buildChanges(null, current).changes).toEqual([]);
});

test("strategic changes include numeric deltas", () => {
  const previous = makeSnapshot("1066.9.15", 100, 2000);
  const current = makeSnapshot("1067.1.1", 140, 2300);
  const changes = buildChanges(previous, current).changes;

  expect(changes).toContainEqual({
    key: "economy.gold",
    before: 100,
    after: 140,
    delta: 40,
  });
  expect(changes).toContainEqual({
    key: "military.strength",
    before: 2000,
    after: 2300,
    delta: 300,
  });
});

test("persistent local config can select the AI export directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "ck3-nzt-output-config-"));
  temporaryDirectories.push(root);
  const configPath = join(root, "config.json");
  const configuredOutput = join(root, "drive", "CK3-NZT");

  await writeFile(
    configPath,
    JSON.stringify({ saveDir: null, gameDir: null, outputDir: configuredOutput }),
    "utf8",
  );

  expect(resolveOutputDir({ CK3_NZT_CONFIG_FILE: configPath })).toBe(configuredOutput);
  expect(
    resolveOutputDir({
      CK3_NZT_CONFIG_FILE: configPath,
      CK3_NZT_OUTPUT_DIR: join(root, "override"),
    }),
  ).toBe(join(root, "override"));
});

test("persistent memory stores SQLite history and compact AI exports", async () => {
  const root = await mkdtemp(join(tmpdir(), "ck3-nzt-"));
  temporaryDirectories.push(root);
  const dataDir = join(root, "data");
  const outputDir = join(root, "export");

  const first = makeSnapshot("1066.9.15", 100, 2000);
  const firstResult = await persistSnapshot(first, {
    sourceFingerprint: "first",
    dataDir,
    outputDir,
  });
  expect(firstResult.written).toBe(true);
  expect(firstResult.changeCount).toBe(0);
  await expect(stat(firstResult.databasePath)).resolves.toBeDefined();

  const second = makeSnapshot("1067.1.1", 140, 2300);
  const secondResult = await persistSnapshot(second, {
    sourceFingerprint: "second",
    dataDir,
    outputDir,
  });
  expect(secondResult.written).toBe(true);
  expect(secondResult.changeCount).toBeGreaterThan(0);

  const current = JSON.parse(await readFile(join(outputDir, "current.json"), "utf8"));
  const changes = JSON.parse(await readFile(join(outputDir, "changes.json"), "utf8"));
  const trends = JSON.parse(await readFile(join(outputDir, "trends.json"), "utf8"));

  expect(current.date).toBe("1067.1.1");
  expect(changes.changes).toContainEqual({
    key: "economy.gold",
    before: 100,
    after: 140,
    delta: 40,
  });
  expect(trends.window.snapshots).toBe(2);
  expect(trends.metrics.gold.delta).toBe(40);

  const duplicate = await persistSnapshot(second, {
    sourceFingerprint: "second",
    dataDir,
    outputDir,
  });
  expect(duplicate.written).toBe(false);
});
