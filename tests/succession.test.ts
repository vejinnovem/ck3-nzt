import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractSuccession } from "../src/extract/succession.js";

const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));

test("extracts heirs, laws, and claimants", async () => {
  const s = (await buildSnapshot(GS, new Localizer(null))).succession;
  expect(s.primaryTitle).toBe("The Holy Roman Empire");
  expect(s.successionLaw).toBe("single_heir_succession_law");
  expect(s.genderLaw).toBe("male_preference_law");
  expect(s.heirs[0]).toEqual({ id: 22222, name: "Adela" });
  expect(s.claimants.map((c) => c.id)).toContain(22222);
});

test("exports a grandchild heir profile and save-computed title assignments", async () => {
  const gs = Buffer.from(`
date=900.1.1
traits_lookup={ "brave" }
played_character={ character=1 player=1 }
landed_titles={
landed_titles={
100={ key="d_polania" name="Polania" holder=1 heir={ 3 } }
101={ key="c_poznan" name="Poznan" holder=1 de_jure_liege=100 heir={ 3 } }
102={ key="c_krajna" name="Krajna" holder=1 de_jure_liege=100 heir={ 4 } }
}
}
living={
1={
  first_name="Ruler"
  dynasty_house=10
  family_data={ child={ 2 4 } }
  landed_data={
    domain={ 100 101 102 }
    realm_capital=101
    laws={ "confederate_partition_succession_law" "male_preference_law" }
    succession={ 3 4 }
  }
}
3={
  first_name="Grandchild"
  birth=880.1.1
  female=yes
  dynasty_house=10
  traits={ 0 }
  skill={ 1 2 3 4 5 6 }
  family_data={ spouse=5 primary_spouse=5 }
  alive_data={ health=4 }
}
4={
  first_name="YoungerSon"
  birth=885.1.1
  dynasty_house=10
  skill={ 2 2 2 2 2 2 }
}
5={
  first_name="Spouse"
  dynasty_house=20
  skill={ 0 0 0 0 0 0 }
}
}
dead_unprunable={
2={ first_name="DeadSon" family_data={ child={ 3 } } }
}
`);

  const succession = await queryGamestate(gs, (q) =>
    extractSuccession(q, new Localizer(null)),
  );

  expect(succession.heirProfiles[0]?.relationToRuler).toBe("grandchild");
  expect(succession.heirProfiles[0]?.lineage.map((step) => step.name)).toEqual([
    "Ruler",
    "DeadSon",
    "Grandchild",
  ]);
  expect(succession.heirProfiles[0]?.profile?.age).toBe(20);
  expect(succession.heirProfiles[0]?.dynastyHouseId).toBe(10);
  expect(succession.heirProfiles[0]?.sameDynastyHouseAsRuler).toBe(true);
  expect(succession.heirProfiles[0]?.spouses[0]).toMatchObject({
    id: 5,
    name: "Spouse",
    dynastyHouseId: 20,
  });

  expect(succession.titleAssignmentsByHeir).toEqual([
    {
      heirId: 3,
      heirName: "Grandchild",
      titles: [
        { titleId: 100, title: "Polania", key: "d_polania", tier: "duchy" },
        { titleId: 101, title: "Poznan", key: "c_poznan", tier: "county" },
      ],
    },
    {
      heirId: 4,
      heirName: "YoungerSon",
      titles: [{ titleId: 102, title: "Krajna", key: "c_krajna", tier: "county" }],
    },
  ]);
  expect(succession.risk.currentHeldTitleSplitRisk).toBe(false);
  expect(succession.risk.creatableEqualRankSplitRisk).toBe(false);
  expect(succession.risk.confederateEqualRankTitleCreationRiskEvaluated).toBe(true);
});

test("flags an uncreated equal-rank duchy when the realm holds more than half its de-jure counties", async () => {
  const gs = Buffer.from(`
date=900.1.1
played_character={ character=1 player=1 }
landed_titles={
landed_titles={
100={ key="d_primary" name="Primary" holder=1 heir={ 2 } }
101={ key="c_capital" name="Capital" holder=1 de_jure_liege=100 de_facto_liege=100 heir={ 2 } }
200={ key="d_second" name="Second" }
201={ key="c_second_a" name="Second A" holder=1 de_jure_liege=200 de_facto_liege=100 heir={ 2 } }
202={ key="c_second_b" name="Second B" holder=3 de_jure_liege=200 de_facto_liege=100 heir={ 3 } }
203={ key="c_second_c" name="Second C" holder=4 de_jure_liege=200 }
}
}
living={
1={
  first_name="Ruler"
  family_data={ child={ 2 5 } }
  landed_data={
    domain={ 100 101 201 }
    realm_capital=101
    laws={ "confederate_partition_succession_law" "male_preference_law" }
    succession={ 2 5 }
  }
}
2={ first_name="ElderSon" skill={ 1 1 1 1 1 1 } }
3={ first_name="Vassal" skill={ 1 1 1 1 1 1 } }
4={ first_name="ForeignRuler" skill={ 1 1 1 1 1 1 } }
5={ first_name="YoungerSon" skill={ 1 1 1 1 1 1 } }
}
`);

  const succession = await queryGamestate(gs, (q) =>
    extractSuccession(q, new Localizer(null)),
  );

  expect(succession.risk.currentHeldTitleSplitRisk).toBe(false);
  expect(succession.risk.creatableEqualRankSplitRisk).toBe(true);
  expect(succession.risk.confederateEqualRankTitleCreationRiskEvaluated).toBe(true);
  expect(succession.risk.creatableEqualRankCandidates).toEqual([
    expect.objectContaining({
      titleId: 200,
      title: "Second",
      key: "d_second",
      tier: "duchy",
      deJureCountyCount: 3,
      realmHeldDeJureCountyCount: 2,
      landThresholdMet: true,
      specialCreationRulesEvaluated: false,
    }),
  ]);
  expect(succession.risk.limitation).toContain("best-effort");
});
