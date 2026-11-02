import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractVassals } from "../src/extract/vassals.js";

test("falls back to the five highest vassal_power_value entries when powerful flags are absent", async () => {
  const gamestate = Buffer.from(`
date=900.1.1
played_character={ character=10 }
council_task_manager={ active={
 500={ type="task_disrupt_schemes" owner=30 court_owner=10 }
}}
living={
 10={ first_name="Player" landed_data={ council={ 500 } } }
 20={ first_name="A" landed_data={ strength_for_liege=60 vassal_power_value=600 } }
 30={ first_name="B" landed_data={ strength_for_liege=50 vassal_power_value=500 } }
 40={ first_name="C" landed_data={ strength_for_liege=40 vassal_power_value=400 } }
 50={ first_name="D" landed_data={ strength_for_liege=30 vassal_power_value=300 } }
 60={ first_name="E" landed_data={ strength_for_liege=20 vassal_power_value=200 } }
 70={ first_name="F" landed_data={ strength_for_liege=10 vassal_power_value=100 } }
}
vassal_contracts={ active={
 1={ liege=10 vassal=20 }
 2={ liege=10 vassal=30 }
 3={ liege=10 vassal=40 }
 4={ liege=10 vassal=50 }
 5={ liege=10 vassal=60 }
 6={ liege=10 vassal=70 }
}}
`);

  const result = await queryGamestate(gamestate, (q) =>
    extractVassals(q, new Localizer(null), new Set()),
  );

  const byId = new Map(result.vassals.map((vassal) => [vassal.id, vassal]));
  for (const id of [20, 30, 40, 50, 60]) {
    expect(byId.get(id)).toMatchObject({
      powerfulVassal: true,
      powerfulVassalSource: "vassal_power_value_rank_fallback",
    });
  }
  expect(byId.get(30)?.powerfulVassalWithoutCouncilSeat).toBe(false);
  expect(byId.get(20)?.powerfulVassalWithoutCouncilSeat).toBe(true);
  expect(byId.get(70)).toMatchObject({
    powerfulVassal: false,
    powerfulVassalWithoutCouncilSeat: false,
    powerfulVassalSource: "vassal_power_value_rank_fallback",
  });
});

test("exposes serialized temporary opinion modifiers without claiming they are the full UI opinion", async () => {
  const gamestate = Buffer.from(`
date=900.1.1
played_character={ character=10 }
living={
 10={ first_name="Player" landed_data={ council={} } }
 20={ first_name="Vassal" landed_data={ strength_for_liege=40 vassal_power_value=100 } }
}
vassal_contracts={ active={ 1={ liege=10 vassal=20 } } }
opinions={ active_opinions={
 { owner=20 target=10 temporary_opinion={ modifier="recently_fought_opinion" value=-20 start_date=899.1.1 expiration_date=901.1.1 converging={ opinion=0 } } }
 { owner=20 target=10 temporary_opinion={ modifier="gift_opinion" value=10 expiration_date=900.6.1 } scripted_relations={ rival={ reason="test" involved_character=10 } } }
}}
`);

  const result = await queryGamestate(gamestate, (q) =>
    extractVassals(q, new Localizer(null), new Set()),
  );
  const vassal = result.vassals[0];

  expect(vassal).toMatchObject({
    opinion: -10,
    opinionSource: "serialized_temporary_modifiers_only",
    scriptedRelations: ["rival"],
  });
  expect(vassal.opinionModifiers).toEqual([
    {
      modifier: "recently_fought_opinion",
      value: -20,
      startDate: "899.1.1",
      expirationDate: "901.1.1",
      convergingOpinion: 0,
    },
    {
      modifier: "gift_opinion",
      value: 10,
      startDate: null,
      expirationDate: "900.6.1",
      convergingOpinion: null,
    },
  ]);
});
