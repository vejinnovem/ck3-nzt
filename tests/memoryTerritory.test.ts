import { expect, test } from "vitest";
import { buildChanges } from "../src/memory.js";
import type { Snapshot } from "../src/snapshot.js";

function snapshot(
  date: string,
  counties: Array<{ id: number; name: string; deJureLiege: string | null }>,
  assignments: Snapshot["succession"]["titleAssignmentsByHeir"],
): Snapshot {
  return {
    date,
    parsedAt: Date.now(),
    overview: {
      rulerName: "Test Ruler",
      date,
      primaryTitle: "Test Realm",
      tier: 3,
      house: "Test House",
      gold: 100,
      prestige: 100,
      piety: 100,
    },
    economy: {
      heldTitleCount: counties.length * 2 + 1,
      heldCountyCount: counties.length,
    } as Snapshot["economy"],
    military: {
      levy: 1000,
      strength: 1500,
      currentStrength: 1500,
      strengthWithoutHires: 1500,
      wars: [],
    } as Snapshot["military"],
    succession: {
      titleAssignmentsByHeir: assignments,
    } as Snapshot["succession"],
    diplomacy: {} as Snapshot["diplomacy"],
    factions: [],
    vassals: [],
    vassalCount: 0,
    expansion: {} as Snapshot["expansion"],
    titles: {
      empires: [],
      kingdoms: [],
      duchies: [{ id: 1, name: "Test Duchy", deJureLiege: "Test Kingdom" }],
      counties,
      baronies: [],
      total: counties.length * 2 + 1,
    },
  };
}

test("changes track gained counties and resulting succession redistribution", () => {
  const previous = snapshot(
    "873.4.1",
    [{ id: 10, name: "Poznań", deJureLiege: "Polania" }],
    [
      {
        heirId: 100,
        heirName: "Dobromir",
        titles: [{ titleId: 10, title: "Poznań", key: "c_poznan", tier: "county" }],
      },
    ],
  );
  const current = snapshot(
    "873.4.2",
    [
      { id: 10, name: "Poznań", deJureLiege: "Polania" },
      { id: 20, name: "Płock", deJureLiege: "Mazowsze" },
    ],
    [
      {
        heirId: 100,
        heirName: "Dobromir",
        titles: [{ titleId: 10, title: "Poznań", key: "c_poznan", tier: "county" }],
      },
      {
        heirId: 200,
        heirName: "Siemomysł",
        titles: [{ titleId: 20, title: "Płock", key: "c_plock", tier: "county" }],
      },
    ],
  );

  const changes = buildChanges(previous, current).changes;

  expect(changes).toContainEqual({
    key: "realm.heldCountyCount",
    before: 1,
    after: 2,
    delta: 1,
  });
  expect(changes).toContainEqual({
    key: "realm.heldCounties",
    before: "10:Poznań",
    after: "10:Poznań|20:Płock",
  });
  expect(changes).toContainEqual({
    key: "succession.titleAssignments",
    before: "100:Dobromir=10",
    after: "100:Dobromir=10|200:Siemomysł=20",
  });
});
