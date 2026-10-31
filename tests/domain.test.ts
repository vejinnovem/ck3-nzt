import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractRealmEconomy } from "../src/extract/domain.js";
import { Localizer } from "../src/localization.js";

const GS = Buffer.from(`date=867.1.1
played_character={ character=10 player=1 }
landed_titles={
 landed_titles={
  1={ key="d_test" name="Test Duchy" holder=10 }
  2={ key="c_alpha" name="Alpha" holder=10 de_jure_liege=1 capital=2 }
  3={ key="b_alpha" name="Alpha Hold" holder=10 de_jure_liege=2 capital_barony=yes }
  4={ key="c_beta" name="Beta" holder=10 de_jure_liege=1 capital=5 }
  5={ key="b_beta" name="Beta Hold" holder=10 de_jure_liege=4 capital_barony=yes }
 }
}
county_manager={
 counties={
  c_alpha={ development=8 culture=12 faith=34 }
  c_beta={ development=5 culture=12 faith=35 }
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
  }
 }
}
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
      cultureId: 12,
      faithId: 35,
      capitalTitleId: 5,
      capitalName: "Beta Hold",
      isRealmCapital: false,
    },
  ]);
});
