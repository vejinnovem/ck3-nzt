import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractDiplomacy } from "../src/extract/diplomacy.js";

test("lists every active war involving a player tributary and classifies internal wars", async () => {
  const gamestate = Buffer.from(`
date=900.1.1
played_character={ character=10 }
landed_titles={ landed_titles={
 100={ key="k_player" name="Playerland" holder=10 }
 200={ key="c_one" name="One" holder=20 }
 300={ key="c_two" name="Two" holder=30 }
 400={ key="c_external" name="External" holder=40 }
}}
living={
 10={ first_name="Player" landed_data={ domain={ 100 } } }
 20={ first_name="TribOne" landed_data={ domain={ 200 } } }
 30={ first_name="TribTwo" landed_data={ domain={ 300 } } }
 40={ first_name="External" landed_data={ domain={ 400 } } }
}
vassal_contracts={ active={
 1={ liege=10 vassal=20 levels={ 4 0 1 } }
 2={ liege=10 vassal=30 levels={ 4 0 1 } }
}}
wars={ active_wars={
 700={
  start_date=899.1.1
  casus_belli={ type="county_conquest_cb" targeted_titles={ 300 } }
  attacker={ participants={ { character=20 } } }
  defender={ participants={ { character=30 } } }
 }
 701={
  start_date=899.2.1
  casus_belli={ type="county_conquest_cb" targeted_titles={ 200 } }
  attacker={ participants={ { character=40 } } }
  defender={ participants={ { character=20 } } }
 }
}}
`);

  const diplomacy = await queryGamestate(gamestate, (q) =>
    extractDiplomacy(q, new Localizer(null)),
  );

  expect(diplomacy.tributaries.map((tributary) => tributary.id)).toEqual([20, 30]);
  expect(diplomacy.tributaryWars).toHaveLength(2);
  expect(diplomacy.tributaryWars[0]).toMatchObject({
    warId: 700,
    startDate: "899.1.1",
    cbType: "county_conquest_cb",
    targetTitleIds: [300],
    targetTitles: ["Two"],
    attackerIds: [20],
    defenderIds: [30],
    playerTributaryAttackerIds: [20],
    playerTributaryDefenderIds: [30],
    betweenPlayerTributaries: true,
    classification: "between_player_tributaries",
  });
  expect(diplomacy.tributaryWars[1]).toMatchObject({
    warId: 701,
    attackerIds: [40],
    defenderIds: [20],
    playerTributaryAttackerIds: [],
    playerTributaryDefenderIds: [20],
    betweenPlayerTributaries: false,
    classification: "player_tributary_vs_external",
  });
});
