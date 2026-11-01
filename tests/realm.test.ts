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

test("extractPlayerRealm also indexes strategically relevant foreign counties", async () => {
  const gamestate = Buffer.from(`
date=900.1.1
played_character={ character=10 }
landed_titles={ landed_titles={
 100={ key="k_home" name="Home Kingdom" holder=10 }
 1={ key="d_player" name="Player Duchy" holder=10 de_jure_liege=100 }
 2={ key="c_capital" name="Capital" holder=10 de_facto_liege=1 de_jure_liege=1 }
 200={ key="d_ally" name="Ally Duchy" holder=20 }
 201={ key="c_ally" name="Ally County" holder=20 de_facto_liege=200 de_jure_liege=100 }
 300={ key="k_enemy" name="Enemy Kingdom" holder=30 }
 301={ key="c_enemy" name="Enemy County" holder=30 de_facto_liege=300 de_jure_liege=300 }
}}
county_manager={ counties={
 c_capital={ county_control=100 culture=1 }
 c_ally={ county_control=80 culture=2 }
 c_enemy={ county_control=60 culture=3 }
}}
living={
 10={ first_name="Player" landed_data={ domain={ 1 2 } } }
 20={ first_name="Ally" landed_data={ domain={ 200 201 } } }
 30={ first_name="Enemy" landed_data={ domain={ 300 301 } } }
}
relations={ active_relations={
 { first=10 second=20 alliances={ { allied_through_0=10 allied_through_1=20 } } }
} }
wars={ active_wars={
 1={
  attacker={ participants={ { character=10 } } }
  defender={ participants={ { character=30 } } }
 }
} }
`);

  const realm = await queryGamestate(gamestate, (q) => extractPlayerRealm(q, new Localizer(null)));
  expect(realm?.relevantForeignCountyCount).toBe(2);
  expect(realm?.relevantForeignCounties.find((county) => county.name === "Ally County")).toMatchObject({
    realmRulerId: 20,
    relevance: expect.arrayContaining(["same_de_jure_kingdom", "ally_realm"]),
  });
  expect(realm?.relevantForeignCounties.find((county) => county.name === "Enemy County")).toMatchObject({
    realmRulerId: 30,
    relevance: ["active_war_enemy_realm"],
  });
  expect(realm?.relevantForeignCountsByReason.ally_realm).toBe(1);
  expect(realm?.relevantForeignCountsByReason.active_war_enemy_realm).toBe(1);
  expect(realm?.exactAdjacencyAvailable).toBe(false);
});
