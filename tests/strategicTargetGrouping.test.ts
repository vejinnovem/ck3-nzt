import { describe, expect, it } from "vitest";
import { groupStrategicTargetsByRuler } from "../src/snapshot.js";
import type { ExpansionInfo } from "../src/extract/expansion.js";

function baseExpansion(): ExpansionInfo {
  return {
    claims: [],
    pressedCount: 0,
    deJureUnheld: [],
    warTargets: [],
    targetScope: {
      deJureKingdomId: 1,
      deJureKingdomName: "Poland",
      exactAdjacencyAvailable: false,
      casusBelliCoverage: "claims_and_direct_de_jure_only",
    },
    strategicTargets: [
      {
        realmTitleId: 10,
        realmName: "Stężyca",
        rulerId: 100,
        rulerName: "Maciej",
        strength: 1098,
        currentStrength: 1078,
        playerToTargetStrengthRatio: 1.81,
        allies: [],
        wars: [],
        relevantTitles: [
          { id: 10, title: "Stężyca", tier: "county", confirmedCasusBelli: [] },
        ],
        basis: "same_de_jure_kingdom",
      },
      {
        realmTitleId: 11,
        realmName: "Czersk",
        rulerId: 100,
        rulerName: "Maciej",
        strength: 1098,
        currentStrength: 1078,
        playerToTargetStrengthRatio: 1.81,
        allies: [],
        wars: [],
        relevantTitles: [
          { id: 11, title: "Czersk", tier: "county", confirmedCasusBelli: [] },
        ],
        basis: "same_de_jure_kingdom",
      },
      {
        realmTitleId: 20,
        realmName: "Lubusz",
        rulerId: 200,
        rulerName: "Jaromir",
        strength: 1352,
        currentStrength: 1233,
        playerToTargetStrengthRatio: 1.58,
        allies: [],
        wars: [],
        relevantTitles: [
          { id: 20, title: "Lubusz", tier: "county", confirmedCasusBelli: ["de_jure"] },
        ],
        basis: "same_de_jure_kingdom",
      },
    ],
  };
}

describe("groupStrategicTargetsByRuler", () => {
  it("merges multiple top-level county roots held by the same independent ruler", () => {
    const result = groupStrategicTargetsByRuler(baseExpansion());
    expect(result.strategicTargets).toHaveLength(2);
    const maciej = result.strategicTargets.find((target) => target.rulerId === 100);
    expect(maciej?.relevantTitles.map((title) => title.title)).toEqual(["Stężyca", "Czersk"]);
  });

  it("does not mutate the source expansion object", () => {
    const source = baseExpansion();
    groupStrategicTargetsByRuler(source);
    expect(source.strategicTargets).toHaveLength(3);
    expect(source.strategicTargets[0]?.relevantTitles).toHaveLength(1);
  });
});
