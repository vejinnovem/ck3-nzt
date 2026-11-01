import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { buildChanges, persistSnapshot } from "../src/memory.js";
import type { Snapshot } from "../src/snapshot.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function makeSnapshot(date: string, gold: number): Snapshot {
  return {
    date,
    parsedAt: Date.now(),
    overview: {
      rulerName: "Król Siemowit",
      date,
      primaryTitle: "Królestwo Polska",
      tier: 4,
      house: "Piastów",
      gold,
      prestige: 100,
      piety: 50,
    },
    ruler: {
      id: 1,
      name: "Siemowit",
      health: 3.5,
      traits: ["Strateg"],
    } as Snapshot["ruler"],
    military: {
      levy: 1000,
      strength: 2000,
      currentStrength: 2000,
      strengthWithoutHires: 2000,
      wars: [],
    } as Snapshot["military"],
    succession: {
      heirProfiles: [
        {
          id: 2,
          position: 1,
          name: "Dobromir",
          relationToRuler: "grandchild",
          lineage: [],
          dynastyHouseId: 10,
          sameDynastyHouseAsRuler: true,
          profile: null,
          spouses: [],
          betrothed: null,
        },
      ],
      titleAssignmentsByHeir: [],
    } as Snapshot["succession"],
    diplomacy: {} as Snapshot["diplomacy"],
    factions: [],
    vassals: [],
    vassalCount: 3,
    expansion: {} as Snapshot["expansion"],
    titles: {} as Snapshot["titles"],
  };
}

test("strategic changes report ruler health, traits and heir betrothals", () => {
  const previous = makeSnapshot("879.11.18", 150);
  const current = makeSnapshot("879.11.23", 150);

  current.ruler = {
    ...current.ruler!,
    health: 3.1,
    traits: ["Strateg", "Niewydolne serce"],
  };
  current.succession.heirProfiles[0]!.betrothed = {
    id: 42998,
    name: "Věra",
    dynastyHouseId: 3447,
    female: true,
  };

  const changes = buildChanges(previous, current).changes;

  expect(changes).toContainEqual({
    key: "ruler.health",
    before: 3.5,
    after: 3.1,
    delta: -0.3999999999999999,
  });
  expect(changes).toContainEqual({
    key: "ruler.traits",
    before: "Strateg",
    after: "Niewydolne serce|Strateg",
  });
  expect(changes).toContainEqual({
    key: "succession.heirBetrothals",
    before: "2:Dobromir=",
    after: "2:Dobromir=42998:Věra:3447",
  });
});

test("same-date strategically identical refresh preserves the prior meaningful diff", async () => {
  const root = await mkdtemp(join(tmpdir(), "ck3-nzt-refresh-regression-"));
  temporaryDirectories.push(root);
  const dataDir = join(root, "data");
  const outputDir = join(root, "export");

  await persistSnapshot(makeSnapshot("879.8.27", 100), {
    sourceFingerprint: "baseline",
    dataDir,
    outputDir,
  });
  await persistSnapshot(makeSnapshot("879.9.3", 140), {
    sourceFingerprint: "meaningful",
    dataDir,
    outputDir,
  });

  const refreshed = makeSnapshot("879.9.3", 140);
  refreshed.parsedAt += 1000;
  const result = await persistSnapshot(refreshed, {
    sourceFingerprint: "refresh-with-new-fingerprint",
    dataDir,
    outputDir,
  });

  expect(result.written).toBe(false);
  expect(result.refreshed).toBe(true);

  const changes = JSON.parse(await readFile(join(outputDir, "changes.json"), "utf8"));
  const trends = JSON.parse(await readFile(join(outputDir, "trends.json"), "utf8"));

  expect(changes.fromDate).toBe("879.8.27");
  expect(changes.toDate).toBe("879.9.3");
  expect(changes.changes).toContainEqual({
    key: "economy.gold",
    before: 100,
    after: 140,
    delta: 40,
  });
  expect(trends.window.snapshots).toBe(2);
});
