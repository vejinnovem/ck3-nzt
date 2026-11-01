import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractPlayerRealm } from "../src/extract/realm.js";

const GS = Buffer.from(`
date=900.1.1
played_character={ character=10 }
landed_titles={ landed_titles={
 1={ key="d_player" name="Player Duchy" holder=10 }
 2={ key="c_capital" name="Capital" holder=10 de_facto_liege=1 }
 3={ key="c_vassal" name="Vassal County" holder=20 de_facto_liege=1 }
 4={ key="d_nested" name="Nested Duchy" holder=20 de_facto_liege=1 }
 5={ key="c_nested" name="Nested County" holder=30 de_facto_liege=4 }
 6={ key="c_foreign" name="Foreign County" holder=40 }
}}
county_manager={ counties={
 c_capital={ county_control=100 culture=1 }
 c_vassal={ county_control=70 culture=2 }
 c_nested={ county_control=55 culture=3 }
 c_foreign={ county_control=90 culture=4 }
}}
living={
 10={ first_name="Player" dynasty_house=100 landed_data={ domain={ 1 2 } } }
 20={ first_name="Direct" dynasty_house=200 }
 30={ first_name="Nested" dynasty_house=300 }
 40={ first_name="Foreign" dynasty_house=400 }
}
`);

test("extractPlayerRealm follows de-facto title links instead of a geographic allow-list", async () => {
  const realm = await queryGamestate(GS, (q) => extractPlayerRealm(q, new Localizer(null)));
  expect(realm).not.toBeNull();
  expect(realm?.countyCount).toBe(3);
  expect(realm?.playerHeldCountyCount).toBe(1);
  expect(realm?.vassalHeldCountyCount).toBe(2);
  expect(realm?.counties.map((county) => county.name).sort()).toEqual([
    "Capital",
    "Nested County",
    "Vassal County",
  ]);
  expect(realm?.counties.find((county) => county.name === "Nested County")).toMatchObject({
    holderId: 30,
    holderName: "Nested",
    heldByPlayer: false,
    deFactoPathToPlayer: [5, 4, 1],
  });
  expect(realm?.counties.some((county) => county.name === "Foreign County")).toBe(false);
});
