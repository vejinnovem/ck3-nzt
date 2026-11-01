import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractRealmEconomy } from "../src/extract/domain.js";
import { Localizer } from "../src/localization.js";

const GS = Buffer.from(`date=867.1.1
played_character={ character=10 player=1 }
landed_titles={
 landed_titles={
  1={ key="d_test" name="Test Duchy" holder=10 }
  2={ key="c_alpha" name="Alpha" holder=10 de_jure_liege=1 capital=3 }
  3={ key="b_alpha" name="Alpha Hold" holder=10 de_jure_liege=2 capital_barony=yes }
 }
}
county_manager={ counties={ c_alpha={ development=8 control=77 culture=12 faith=34 mystery=900 } } }
provinces={
 provinces={
  900={ strange_link=3 terrain=5 }
  901={ nested={ county_ref=2 } }
 }
}
living={
 10={ alive_data={ gold={ value=10 } income=1 } landed_data={ domain={ 1 2 3 } domain_limit=2 vassal_limit=20 balance=1 realm_capital=3 laws={ "tribal_authority_0" } } }
}
`);

test("unavailable holdings emit bounded diagnostics for real-save schema mapping", async () => {
  const economy = await queryGamestate(GS, (q) => extractRealmEconomy(q, new Localizer(null)));
  const holding = economy.holdings[0]!;

  expect(holding.dataAvailable).toBe(false);
  expect(holding.provinceId).toBeNull();
  expect(holding.diagnostics).toBeDefined();
  expect(holding.diagnostics?.provinceDatabase).toBe("nested");
  expect(holding.diagnostics?.provinceRecordCount).toBe(2);
  expect(holding.diagnostics?.titleFieldNames).toContain("de_jure_liege");
  expect(holding.diagnostics?.countyFieldNames).toContain("development");
  expect(holding.diagnostics?.provinceReferenceMatches).toEqual([
    { provinceId: 900, matched: "barony", fieldPath: "strange_link" },
    { provinceId: 901, matched: "county", fieldPath: "nested.county_ref" },
  ]);
});
