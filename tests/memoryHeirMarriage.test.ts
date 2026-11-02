import { expect, test } from "vitest";
import { buildChanges } from "../src/memory.js";
import type { Snapshot } from "../src/snapshot.js";

function makeSnapshot(date: string): Snapshot {
  return {
    date,
    parsedAt: Date.now(),
    overview: {
      rulerName: "Test Ruler",
      date,
      primaryTitle: "Test Realm",
      tier: 2,
      house: "Test House",
      gold: 100,
      prestige: 100,
      piety: 50,
    },
    military: { levy: 1000, strength: 2000, currentStrength: 2000, wars: [] } as Snapshot["military"],
    succession: {} as Snapshot["succession"],
    diplomacy: {} as Snapshot["diplomacy"],
    factions: [],
    vassals: [],
    vassalCount: 0,
    expansion: {} as Snapshot["expansion"],
    titles: {} as Snapshot["titles"],
  };
}

test("reports a heir marriage instead of only looking like a lost betrothal", () => {
  const previous = makeSnapshot("884.4.5");
  const current = makeSnapshot("884.7.23");
  const partner = {
    id: 41730,
    name: "Partner",
    dynastyHouseId: 1594,
    female: true,
  };

  previous.succession = {
    heirProfiles: [
      {
        id: 41559,
        position: 3,
        name: "Siemomysł",
        spouses: [],
        betrothed: partner,
      },
    ],
  } as Snapshot["succession"];
  current.succession = {
    heirProfiles: [
      {
        id: 41559,
        position: 3,
        name: "Siemomysł",
        spouses: [partner],
        betrothed: null,
      },
    ],
  } as Snapshot["succession"];

  const changes = buildChanges(previous, current).changes;

  expect(changes).toContainEqual({
    key: "succession.heirBetrothals",
    before: "41559:Siemomysł=41730:Partner:1594",
    after: "41559:Siemomysł=",
  });
  expect(changes).toContainEqual({
    key: "succession.heirMarriages",
    before: "41559:Siemomysł=",
    after: "41559:Siemomysł=41730:Partner:1594",
  });
});
