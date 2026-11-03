import { expect, test } from "vitest";
import { buildArmyQualityDiagnostics, type AdvisoryContext } from "../src/advisory.js";
import { enrichLowbornPrimarySpouse } from "../src/pressReviewEnrichment.js";
import type { PressReview } from "../src/pressReview.js";
import type { Snapshot } from "../src/snapshot.js";

function militaryRegressionSnapshot(): Snapshot {
  return {
    military: {
      levy: 6662,
      strength: 6662,
      currentStrength: 6002,
      strengthWithoutHires: 6662,
      effectiveStrength: null,
      strengthSource: "landed_data_raw",
      strengthScope: "realm_mobilisation_aggregate_not_stack_size",
      champions: { ids: [], current: 0, max: null },
      menAtArms: {
        slotsUsed: 3,
        slotsMax: null,
        totalCurrentSoldiers: 600,
        totalMaxSoldiers: 600,
        regiments: [],
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
      menAtArmsReliability: {
        breakdownReliable: false,
        recoveredRegimentCount: 0,
        nonLevyNonChampionMaxStrength: 0,
        recoveredMaxSoldiers: 600,
        discrepancy: -600,
        limitation: "fixture",
      },
      warScoreCapability: {
        fullPlayerVisibleWarScoreAvailable: false,
        source: "runtime_computed_not_serialized",
        reconstruction: "not_implemented",
        knownSerializedComponents: ["ticking_war_score", "controls_all", "battle_results"],
        limitation: "fixture",
      },
    },
    succession: { heirProfiles: [] },
    diplomacy: {
      independent: true,
      alliances: [],
      truces: [],
      hostile: [],
      tributaries: [],
      tributaryWars: [],
      puppets: [],
    },
    factions: [],
    vassals: [],
  } as unknown as Snapshot;
}

function spouse(id: number, name: string): NonNullable<Snapshot["family"]>["spouses"][number] {
  return {
    id,
    name,
    dynastyHouseId: null,
    dynastyHouseName: null,
    skills: { diplomacy: 3, martial: 3, stewardship: 3, intrigue: 3, learning: 3, prowess: 3 },
  } as NonNullable<Snapshot["family"]>["spouses"][number];
}

function spouseSnapshot(date: string, primary: ReturnType<typeof spouse>): Snapshot {
  return {
    date,
    overview: { tier: 4 },
    family: {
      primarySpouse: primary,
      spouses: [primary],
      betrothed: null,
      children: [],
      primaryHeirId: null,
    },
  } as unknown as Snapshot;
}

test("#89 does not present serialized levy divided by current strength as troop composition share", () => {
  const quality = buildArmyQualityDiagnostics(militaryRegressionSnapshot());

  expect(quality.levyCurrent).toBe(6662);
  expect(quality.levyShareOfCurrentStrength).toBeNull();
  expect(quality.menAtArmsShareOfCurrentStrength).toBeCloseTo(600 / 6002, 8);
  expect(quality.limitations).toContain(
    "The serialized realm levy scalar is not a UI-equivalent current-levy count. levyShareOfCurrentStrength is therefore intentionally null instead of mixing incompatible quantities.",
  );
});

test("#93 downgrades a lowborn spouse-to-spouse checkpoint change to reload-safe information", () => {
  const iliana = spouse(12697, "Iliana");
  const adelajda = spouse(22001, "Adelajda");
  const previous = spouseSnapshot("889.10.12", iliana);
  const current = spouseSnapshot("889.11.9", adelajda) as Snapshot & { advisory: AdvisoryContext };
  current.advisory = {
    armyQuality: {} as AdvisoryContext["armyQuality"],
    marriage: {
      source: "snapshot_and_ck3_1_20_rule",
      primaryTitleTier: 4,
      currentPrimarySpouse: {
        id: adelajda.id,
        name: adelajda.name,
        dynastyHouseId: null,
        dynastyHouseName: null,
        isLowborn: true,
        serializedSkills: adelajda.skills,
        skillSemantics: {} as AdvisoryContext["marriage"]["currentPrimarySpouse"] extends infer T
          ? T extends { skillSemantics: infer S }
            ? S
            : never
          : never,
      },
      lowbornPrimarySpouseRisk: "action_required",
      estimatedLegitimacyLoss: 400,
      estimateBasis: "fixture",
      warning: "fixture",
      candidateRules: { lowbornDetection: "fixture", skillValues: "fixture" },
    },
  };
  const review: PressReview = {
    fromDate: previous.date,
    toDate: current.date,
    source: "snapshot_diff",
    limitation: "fixture",
    items: [],
  };

  enrichLowbornPrimarySpouse(previous, current, review);

  expect(review.items).toHaveLength(1);
  expect(review.items[0]).toMatchObject({
    category: "family",
    priority: "informational",
    actorIds: [iliana.id, adelajda.id],
  });
  expect(review.items[0]?.summary).toContain("timeline may have been reloaded");
  expect(review.items[0]?.summary).not.toContain("expected legitimacy penalty");
});
