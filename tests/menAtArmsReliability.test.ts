import { expect, test } from "vitest";
import { assessMenAtArmsReliability } from "../src/snapshot.js";
import type { MilitaryInfo, MenAtArmsRegimentInfo } from "../src/extract/military.js";

function regiment(id: number, type: string, soldiers: number): MenAtArmsRegimentInfo {
  return {
    id,
    type,
    ownerId: 13015,
    current: soldiers,
    max: soldiers,
    linkedRegimentIds: [],
    originTitleIds: [],
    owningTitleIds: [],
    stationed: null,
    diagnostics: null,
  };
}

function militaryWithMenAtArms(
  regiments: MenAtArmsRegimentInfo[],
  totalCurrentSoldiers: number,
  totalMaxSoldiers: number | null,
): MilitaryInfo {
  return {
    levy: 1826,
    strength: 2329,
    currentStrength: 2316,
    strengthWithoutHires: 2329,
    power: 52860,
    maxPower: 53120,
    effectiveStrength: null,
    strengthSource: "landed_data_raw",
    strengthScope: "realm_mobilisation_aggregate_not_stack_size",
    champions: { ids: [1, 2, 3], current: 3, max: null },
    menAtArms: {
      slotsUsed: regiments.length,
      slotsMax: null,
      totalCurrentSoldiers,
      totalMaxSoldiers,
      regiments,
      source: "global_armies_best_effort",
    },
    rallyPoints: { references: [], count: 0, source: "unavailable" },
    raids: {
      activeCount: 0,
      playerRelevantCount: 0,
      records: [],
      truncated: false,
      source: "unavailable",
    },
    unattributedCurrentStrength: null,
    wars: [],
  };
}

test("flags an empty MAA breakdown when mobilisation totals prove missing non-levy strength", () => {
  const reliability = assessMenAtArmsReliability(militaryWithMenAtArms([], 0, null));

  expect(reliability.breakdownReliable).toBe(false);
  expect(reliability.recoveredRegimentCount).toBe(0);
  expect(reliability.nonLevyNonChampionMaxStrength).toBe(500);
  expect(reliability.recoveredMaxSoldiers).toBeNull();
  expect(reliability.discrepancy).toBe(500);
  expect(reliability.limitation).toContain("do not interpret slotsUsed=0");
});

test("accepts a recovered MAA breakdown that reconciles with mobilisation totals", () => {
  const regiments = [regiment(5001, "bowmen", 300), regiment(5002, "light_footmen", 200)];
  const reliability = assessMenAtArmsReliability(militaryWithMenAtArms(regiments, 500, 500));

  expect(reliability.breakdownReliable).toBe(true);
  expect(reliability.recoveredRegimentCount).toBe(2);
  expect(reliability.nonLevyNonChampionMaxStrength).toBe(500);
  expect(reliability.recoveredMaxSoldiers).toBe(500);
  expect(reliability.discrepancy).toBe(0);
  expect(reliability.limitation).toBeNull();
});
