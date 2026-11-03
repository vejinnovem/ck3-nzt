import { expect, test } from "vitest";
import {
  attachAdvisoryContext,
  buildArmyQualityDiagnostics,
  buildMarriageAdvisory,
} from "../src/advisory.js";
import {
  detectDeadCharacterIds,
  enrichAllianceDeaths,
  enrichLowbornPrimarySpouse,
} from "../src/pressReviewEnrichment.js";
import type { PressReview } from "../src/pressReview.js";
import type { Snapshot } from "../src/snapshot.js";

function baseSnapshot(date = "889.5.18"): Snapshot {
  return {
    date,
    parsedAt: Date.now(),
    overview: {
      rulerName: "Król Siemowit",
      date,
      primaryTitle: "Królestwo Polska",
      tier: 4,
      house: "Piastów",
      gold: 1045,
      prestige: 5500,
      piety: 2400,
    },
    ruler: {
      id: 1,
      name: "Siemowit",
      skills: { diplomacy: 6, martial: 6, stewardship: 6, intrigue: 4, learning: 3, prowess: 1 },
    } as Snapshot["ruler"],
    family: {
      primarySpouse: null,
      spouses: [],
      betrothed: null,
      children: [],
      primaryHeirId: 20,
    } as Snapshot["family"],
    military: {
      levy: 4734,
      strength: 5342,
      currentStrength: 5325,
      strengthWithoutHires: 5342,
      champions: { ids: [7, 8], current: 2, max: null },
      menAtArms: {
        slotsUsed: 3,
        slotsMax: null,
        totalCurrentSoldiers: 578,
        totalMaxSoldiers: 600,
        source: "global_armies_best_effort",
        regiments: [
          {
            id: 101,
            type: "light_footmen",
            ownerId: 1,
            current: 300,
            max: 300,
            linkedRegimentIds: [],
            originTitleIds: [],
            owningTitleIds: [],
            stationed: null,
            diagnostics: null,
          },
          {
            id: 102,
            type: "bowmen",
            ownerId: 1,
            current: 199,
            max: 200,
            linkedRegimentIds: [],
            originTitleIds: [],
            owningTitleIds: [],
            stationed: null,
            diagnostics: null,
          },
          {
            id: 103,
            type: "pikemen",
            ownerId: 1,
            current: 79,
            max: 100,
            linkedRegimentIds: [],
            originTitleIds: [],
            owningTitleIds: [],
            stationed: null,
            diagnostics: null,
          },
        ],
      },
      wars: [],
      menAtArmsReliability: {
        breakdownReliable: true,
        recoveredRegimentCount: 3,
        nonLevyNonChampionMaxStrength: 606,
        recoveredMaxSoldiers: 600,
        discrepancy: 6,
        limitation: null,
      },
    } as Snapshot["military"],
    succession: { heirProfiles: [] } as unknown as Snapshot["succession"],
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
    vassals: [
      {
        id: 7,
        name: "Rodysław",
        skills: { diplomacy: 21, martial: 25, stewardship: 10, intrigue: 11, learning: 10, prowess: 25 },
      },
    ] as unknown as Snapshot["vassals"],
    vassalCount: 1,
    expansion: {} as Snapshot["expansion"],
    titles: {} as Snapshot["titles"],
  };
}

function lowbornIlianaFamily(): Snapshot["family"] {
  const iliana = {
    id: 12697,
    name: "Iliana",
    dynastyHouseId: null,
    dynastyHouseName: null,
    skills: { diplomacy: 3, martial: 7, stewardship: 6, intrigue: 10, learning: 6, prowess: 8 },
  };
  return {
    primarySpouse: iliana,
    spouses: [iliana],
    betrothed: null,
    children: [],
    primaryHeirId: 20,
  } as unknown as Snapshot["family"];
}

test("#81 exports composition diagnostics without inventing UI quality diamonds", () => {
  const snapshot = baseSnapshot();
  const quality = buildArmyQualityDiagnostics(snapshot);

  expect(quality.levyCurrent).toBe(4734);
  expect(quality.menAtArmsCurrent).toBe(578);
  expect(quality.levyToMenAtArmsRatio).toBeCloseTo(4734 / 578, 5);
  expect(quality.professionalCoreUnderrepresented).toBe(true);
  expect(quality.qualityIndicator.uiDiamonds).toBeNull();
  expect(quality.qualityIndicator.uiEquivalentAvailable).toBe(false);
  expect(quality.slotsUsed).toBe(3);
  expect(quality.slotsMax).toBeNull();
  expect(quality.freeSlots).toBeNull();
  expect(quality.champions).toEqual([
    { id: 7, prowess: 25 },
    { id: 8, prowess: null },
  ]);
  expect(quality.regiments.find((regiment) => regiment.type === "pikemen")?.reinforcementMissing).toBe(21);
  expect(quality.regiments.every((regiment) => regiment.sizeUpgradeHeadroomAvailable === false)).toBe(true);
});

test("#82 flags a lowborn primary spouse and estimates the king-tier legitimacy penalty", () => {
  const snapshot = baseSnapshot("889.10.12");
  snapshot.family = lowbornIlianaFamily();
  const marriage = buildMarriageAdvisory(snapshot);

  expect(marriage.currentPrimarySpouse?.isLowborn).toBe(true);
  expect(marriage.lowbornPrimarySpouseRisk).toBe("action_required");
  expect(marriage.estimatedLegitimacyLoss).toBe(400);
  expect(marriage.warning).toContain("Iliana");
  expect(marriage.candidateRules.lowbornDetection).toContain("no dynasty/house");
});

test("#83 keeps Iliana serialized skills distinct from the values shown by CK3 UI", () => {
  const snapshot = baseSnapshot("889.10.12");
  snapshot.family = lowbornIlianaFamily();
  const marriage = buildMarriageAdvisory(snapshot);
  const uiValuesObservedInCampaign = {
    diplomacy: 8,
    martial: 12,
    stewardship: 15,
    intrigue: 13,
    learning: 13,
  };

  expect(marriage.currentPrimarySpouse?.serializedSkills).toMatchObject({
    diplomacy: 3,
    martial: 7,
    stewardship: 6,
    intrigue: 10,
    learning: 6,
  });
  expect(marriage.currentPrimarySpouse?.serializedSkills).not.toMatchObject(uiValuesObservedInCampaign);
  expect(marriage.currentPrimarySpouse?.skillSemantics.effectiveAvailable).toBe(false);
  expect(marriage.currentPrimarySpouse?.skillSemantics.effectiveValues).toBeNull();
  expect(marriage.currentPrimarySpouse?.skillSemantics.scope).toBe(
    "serialized_skill_array_not_ui_equivalent",
  );
});

test("#80 identifies a former ally as dead only with positive dead-store evidence", async () => {
  const gamestate = Buffer.from(`date=888.3.28\nplayed_character={ character=1 player=1 }\nliving={\n1={ first_name="Siemowit" }\n2={ first_name="LivingAlly" }\n}\ndead_unprunable={\n13571={ first_name="Rurik" }\n}\n`);

  const dead = await detectDeadCharacterIds(gamestate, [13571, 2, 999]);
  expect([...dead]).toEqual([13571]);
});

test("#80 rewrites the generic alliance-ended news when death evidence exists", () => {
  const previous = baseSnapshot("888.3.18");
  const current = baseSnapshot("888.3.28");
  previous.diplomacy.alliances = [{ id: 13571, name: "Ruryk", throughCharacterIds: [] }];
  const review: PressReview = {
    fromDate: previous.date,
    toDate: current.date,
    source: "snapshot_diff",
    limitation: "test",
    items: [
      {
        category: "diplomacy",
        priority: "watch",
        summary: "Alliance with Ruryk ended.",
        actorIds: [13571],
      },
    ],
  };

  enrichAllianceDeaths(previous, current, review, new Set([13571]));
  expect(review.items[0]?.summary).toBe("Alliance with Ruryk ended: ruler died.");
});

test("#82 adds action-required press news when a new primary spouse is lowborn", () => {
  const previous = baseSnapshot("889.9.24");
  const current = baseSnapshot("889.10.12");
  current.family = lowbornIlianaFamily();
  const enriched = attachAdvisoryContext(current);
  const review: PressReview = {
    fromDate: previous.date,
    toDate: current.date,
    source: "snapshot_diff",
    limitation: "test",
    items: [],
  };

  enrichLowbornPrimarySpouse(previous, enriched, review);
  expect(review.items).toEqual([
    expect.objectContaining({
      category: "family",
      priority: "action_required",
      summary: expect.stringContaining("about 400"),
      actorIds: [12697],
    }),
  ]);
});
