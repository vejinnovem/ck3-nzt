import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { queryGamestate } from "../src/parser.js";
import { extractRealmEconomy } from "../src/extract/domain.js";
import { Localizer } from "../src/localization.js";

const GAME_DIR = fileURLToPath(new URL("./fixtures/gamedir", import.meta.url));

const GS = Buffer.from(`date=867.1.1
played_character={ character=10 player=1 }
landed_titles={
 landed_titles={
  1={ key="d_test" name="Test Duchy" holder=10 }
  2={ key="c_alpha" name="Alpha" holder=10 de_jure_liege=1 capital=3 }
  3={ key="b_alpha" name="Alpha Hold" holder=10 de_jure_liege=2 capital_barony=yes province=101 }
  4={ key="c_beta" name="Beta" holder=10 de_jure_liege=1 capital=5 }
  5={ key="b_beta" name="Beta Hold" holder=10 de_jure_liege=4 capital_barony=yes province=102 }
 }
}
provinces={
 101={ holding={ type="tribal_holding" buildings={ { type="market_villages_01" } { type="palisades_01" } } } }
 102={ holding={ type="tribal_holding" buildings={ { type="war_camps_01" } } } }
}
county_manager={
 counties={
  c_alpha={ development=8 county_control=92 culture=12 faith=34 }
  c_beta={ development=5 control=75 culture=12 faith=35 }
 }
}
living={
 10={
  first_name="Ruler"
  alive_data={ gold={ value=64 } income=2.5 }
  landed_data={
   domain={ 1 2 3 4 5 }
   domain_limit=4
   vassal_limit=20
   balance=1.75
   realm_capital=3
   laws={ "tribal_authority_1" "confederate_partition_succession_law" "male_preference_law" }
  }
 }
}
`);

const GS_STATIC = Buffer.from(`date=867.1.1
played_character={ character=10 player=1 }
landed_titles={
 landed_titles={
  1={ key="d_test" holder=10 }
  2={ key="c_alpha" holder=10 de_jure_liege=1 capital=3 }
  3={ key="b_alpha" holder=10 de_jure_liege=2 capital_barony=yes }
 }
}
provinces={
 101={ holding={ type="tribal_holding" buildings={ { type="market_villages_01" } } } }
}
county_manager={ counties={ c_alpha={ development=8 county_control=92 culture=12 faith=34 } } }
living={ 10={ alive_data={ gold={ value=64 } income=2.5 } landed_data={ domain={ 1 2 3 } realm_capital=3 } } }
`);

test("extractRealmEconomy returns limits, cash flow and county details", async () => {
  const economy = await queryGamestate(GS, (q) => extractRealmEconomy(q, new Localizer(null)));
  expect(economy.gold).toBe(64);
  expect(economy.monthlyIncome).toBe(2.5);
  expect(economy.monthlyBalance).toBe(1.75);
  expect(economy.domainLimit).toBe(4);
  expect(economy.vassalLimit).toBe(20);
  expect(economy.heldTitleCount).toBe(5);
  expect(economy.heldCountyCount).toBe(2);
  expect(economy.realmCapitalTitleId).toBe(3);
  expect(economy.realmCapitalName).toBe("Alpha Hold");
  expect(economy.counties).toEqual([
    {
      titleId: 2,
      key: "c_alpha",
      name: "Alpha",
      development: 8,
      control: 92,
      cultureId: 12,
      faithId: 34,
      capitalTitleId: 3,
      capitalName: "Alpha Hold",
      isRealmCapital: true,
    },
    {
      titleId: 4,
      key: "c_beta",
      name: "Beta",
      development: 5,
      control: 75,
      cultureId: 12,
      faithId: 35,
      capitalTitleId: 5,
      capitalName: "Beta Hold",
      isRealmCapital: false,
    },
  ]);
});

test("extractRealmEconomy exposes realm rules and province-backed domain buildings", async () => {
  const economy = await queryGamestate(GS, (q) => extractRealmEconomy(q, new Localizer(null)));

  expect(economy.realmRules).toEqual({
    governmentKey: "tribal_government",
    governmentName: "tribal_government",
    governmentSource: "law_inference",
    authority: {
      key: "tribal_authority_1",
      name: "tribal_authority_1",
      level: 1,
      kind: "tribal",
    },
    laws: [
      { key: "tribal_authority_1", name: "tribal_authority_1" },
      {
        key: "confederate_partition_succession_law",
        name: "confederate_partition_succession_law",
      },
      { key: "male_preference_law", name: "male_preference_law" },
    ],
  });

  expect(economy.holdings).toEqual([
    {
      titleId: 3,
      key: "b_alpha",
      name: "Alpha Hold",
      provinceId: 101,
      holdingType: "tribal_holding",
      holdingTypeName: "tribal_holding",
      buildings: [
        { type: "market_villages_01", name: "market_villages_01" },
        { type: "palisades_01", name: "palisades_01" },
      ],
      dataAvailable: true,
      dataSource: "province",
    },
    {
      titleId: 5,
      key: "b_beta",
      name: "Beta Hold",
      provinceId: 102,
      holdingType: "tribal_holding",
      holdingTypeName: "tribal_holding",
      buildings: [{ type: "war_camps_01", name: "war_camps_01" }],
      dataAvailable: true,
      dataSource: "province",
    },
  ]);
});

test("extractRealmEconomy falls back to static landed-title province mappings", async () => {
  const economy = await queryGamestate(GS_STATIC, (q) =>
    extractRealmEconomy(q, new Localizer(GAME_DIR)),
  );

  expect(economy.holdings).toHaveLength(1);
  expect(economy.holdings[0]).toMatchObject({
    titleId: 3,
    key: "b_alpha",
    provinceId: 101,
    holdingType: "tribal_holding",
    buildings: [{ type: "market_villages_01", name: "market_villages_01" }],
    dataAvailable: true,
    dataSource: "province",
  });
  expect(economy.holdings[0]?.diagnostics).toBeUndefined();
});
