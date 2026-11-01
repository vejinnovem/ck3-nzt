import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractRealmEconomy } from "../src/extract/domain.js";
import { Localizer } from "../src/localization.js";

const COLLIDING_IDS_GS = Buffer.from(`
date=867.1.1
played_character={ character=10 player=1 }
landed_titles={
 landed_titles={
  1={ key="d_test" name="Test" holder=10 }
  2={ key="c_alpha" name="Alpha" holder=10 de_jure_liege=1 capital=3 }
  3={ key="b_alpha" name="Alpha Hold" holder=10 de_jure_liege=2 capital_barony=yes }
 }
}
provinces={
 3={ holding={ type="city_holding" buildings={ { type="city_01" } } } }
 101={ title=3 holding={ type="tribal_holding" buildings={ { type="palisades_01" } } } }
}
county_manager={ counties={ c_alpha={ development=1 county_control=100 culture=1 faith=1 } } }
living={
 10={
  alive_data={ gold={ value=10 } income=1 }
  landed_data={ domain={ 1 2 3 } domain_limit=3 vassal_limit=20 balance=1 realm_capital=3 laws={ "tribal_authority_0" } }
 }
}
`);

test("does not mistake a barony title id for an unrelated province id", async () => {
  const economy = await queryGamestate(COLLIDING_IDS_GS, (q) =>
    extractRealmEconomy(q, new Localizer(null)),
  );

  expect(economy.holdings).toHaveLength(1);
  expect(economy.holdings[0]?.provinceId).toBe(101);
  expect(economy.holdings[0]?.holdingType).toBe("tribal_holding");
  expect(economy.holdings[0]?.buildings).toEqual([
    { type: "palisades_01", name: "palisades_01" },
  ]);
});
