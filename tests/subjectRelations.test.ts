import { expect, test } from "vitest";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";

test("extracts independent legacy subject contracts as tributaries and player puppet refs", async () => {
  const gs = Buffer.from(`date=880.3.29
meta_data={ meta_player_name="King" meta_title_name="Poland" meta_player_tier=4 meta_house_name="Piast" }
played_character={ character=1 player=1 }
landed_titles={ landed_titles={
 10={ key="k_player" holder=1 }
 20={ key="c_tributary" holder=2 }
 30={ key="c_vassal" holder=3 de_facto_liege=10 }
} }
living={
 1={ first_name="Siemowit" puppet={ theological_agent_puppet=4 } landed_data={ domain={ 10 } } }
 2={ first_name="Walenty" landed_data={ domain={ 20 } } }
 3={ first_name="Waclaw" landed_data={ domain={ 30 } } }
 4={ first_name="Gracja" }
}
vassal_contracts={ active={
 100={ vassal=2 liege=1 levels={ 1 2 3 4 } }
 101={ vassal=3 liege=1 levels={ 5 6 } }
} }
relations={ active_relations={
 { first=1 second=4 theological_agent_puppet=yes }
} }
`);

  const diplomacy = (await buildSnapshot(gs, new Localizer(null))).diplomacy;

  expect(diplomacy.tributaries).toEqual([
    {
      contractId: 100,
      id: 2,
      name: "Walenty",
      playerRole: "suzerain",
      independentSubject: true,
      levels: [1, 2, 3, 4],
      classificationSource: "independent_subject_contract",
      evidence: ["vassal_contracts"],
    },
  ]);

  expect(diplomacy.puppets).toContainEqual({
    id: 4,
    name: "Gracja",
    type: "realm_priest",
    playerRole: "puppeteer",
    source: "player_character",
    evidence: ["puppet.theological_agent_puppet"],
  });
});

test("reads CK3 1.20 subject_contracts and classifies clerical puppet cooldown evidence", async () => {
  const gs = Buffer.from(`date=880.3.30
meta_data={ meta_player_name="King" meta_title_name="Poland" meta_player_tier=4 meta_house_name="Piast" }
played_character={ character=1 player=1 }
landed_titles={ landed_titles={
 10={ key="k_player" holder=1 }
 20={ key="c_tributary" holder=2 }
} }
living={
 1={ first_name="Siemowit" landed_data={ domain={ 10 } } }
 2={ first_name="Lucjan" landed_data={ domain={ 20 } } }
 4={ first_name="Gracja" }
}
subject_contracts={ active={
 200={ subject=2 suzerain=1 levels={ 7 8 } }
} }
relations={ active_relations={
 { first=1 second=4 cooldown_against_recipient_0={ make_clerical_puppet_interaction=881.1.1 } }
} }
`);

  const diplomacy = (await buildSnapshot(gs, new Localizer(null))).diplomacy;

  expect(diplomacy.tributaries).toEqual([
    {
      contractId: 200,
      id: 2,
      name: "Lucjan",
      playerRole: "suzerain",
      independentSubject: true,
      levels: [7, 8],
      classificationSource: "independent_subject_contract",
      evidence: ["subject_contracts", "suzerain"],
    },
  ]);

  expect(diplomacy.puppets).toContainEqual({
    id: 4,
    name: "Gracja",
    type: "realm_priest",
    playerRole: "unknown",
    source: "active_relations",
    evidence: ["cooldown_against_recipient_0.make_clerical_puppet_interaction"],
  });
});
