import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractFactions, extractVassals } from "../src/extract/vassals.js";

const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));

test("extracts vassals and factions with cross-referenced flags", async () => {
  const snap = await buildSnapshot(GS, new Localizer(null));
  expect(snap.factions).toHaveLength(1);
  expect(snap.factions[0]).toMatchObject({
    id: 8001,
    type: "independence_faction",
    power: 30,
    threshold: 70,
    discontent: null,
    members: 1,
    leaderId: 22222,
    leaderName: "Adela",
    titleMembers: [],
  });
  expect(snap.vassals).toHaveLength(1);
  expect(snap.vassals[0]).toMatchObject({
    id: 22222,
    name: "Adela",
    dynastyHouseId: 4872,
    strengthForLiege: 500,
    opinion: -30,
    councilSeat: true,
    inFaction: true,
  });
  expect(snap.vassalCount).toBe(1);
});

test("populist faction exposes county control, culture, faith, rite and popular opinion", async () => {
  const gamestate = Buffer.from(`
date=877.2.16
played_character={ character=10 }
landed_titles={ landed_titles={
 100={ key="c_opole" name="Opole" holder=20 }
}}
county_manager={ counties={
 c_opole={ county_control=0 development=2 culture=1 faith=2 rite="roman_rite" popular_opinion=-25 }
}}
living={
 10={ first_name="Siemowit" culture=1 faith=3 rite="slavic_rite" }
 20={ first_name="Niemir" dynasty_house=55 landed_data={ strength_for_liege=33 } }
}
faction_manager={ factions={
 800={ type="populist_faction" target=10 power=21.5 power_threshold=80 title_members={ { county=100 } } }
}}
`);

  const result = await queryGamestate(gamestate, (q) => extractFactions(q, new Localizer(null)));
  expect(result.factions).toHaveLength(1);
  expect(result.factions[0]).toMatchObject({
    id: 800,
    type: "populist_faction",
    members: 1,
    titleMembers: [
      {
        titleId: 100,
        key: "c_opole",
        name: "Opole",
        holderId: 20,
        holderName: "Niemir",
        control: 0,
        development: 2,
        cultureId: 1,
        faith: 2,
        rite: "roman_rite",
        sameCultureAsRuler: true,
        sameFaithAsRuler: false,
        sameRiteAsRuler: false,
        popularOpinion: -25,
      },
    ],
  });
});

test("detects a direct vassal when de-facto liege is a held duchy outside personal domain", async () => {
  const gamestate = Buffer.from(`
played_character={ character=10 }
landed_titles={
 landed_titles={
  1={ key="d_test" holder=10 }
  2={ key="c_capital" holder=10 de_facto_liege=1 }
  3={ key="c_granted" name="Granted" holder=20 de_facto_liege=1 }
 }
}
county_manager={ counties={ c_granted={ county_control=0 culture=1 rite="roman_rite" } } }
living={
 10={ first_name="Ruler" culture=1 rite="slavic_rite" landed_data={ domain={ 2 } council={} } }
 20={ first_name="Child" dynasty_house=7 landed_data={ strength_for_liege=123 } }
}
`);

  const result = await queryGamestate(gamestate, (q) =>
    extractVassals(q, new Localizer(null), new Set()),
  );

  expect(result.total).toBe(1);
  expect(result.vassals[0]).toMatchObject({
    id: 20,
    name: "Child",
    dynastyHouseId: 7,
    strengthForLiege: 123,
    opinion: null,
    councilSeat: false,
    inFaction: false,
    counties: [
      {
        titleId: 3,
        name: "Granted",
        control: 0,
        cultureId: 1,
        rite: "roman_rite",
        sameCultureAsRuler: true,
        sameRiteAsRuler: false,
      },
    ],
  });
});

test("detects a global active vassal contract even when player contract IDs are absent", async () => {
  const gamestate = Buffer.from(`
played_character={ character=10 }
living={
 10={ first_name="Ruler" landed_data={ domain={ 1 } council={} } }
 20={ first_name="Child" landed_data={ strength_for_liege=77 } }
}
vassal_contracts={ active={
 900={ liege=10 vassal=20 }
}}
`);

  const result = await queryGamestate(gamestate, (q) =>
    extractVassals(q, new Localizer(null), new Set()),
  );

  expect(result.total).toBe(1);
  expect(result.vassals[0]).toMatchObject({ id: 20, name: "Child", strengthForLiege: 77 });
});

test("accepts object-shaped holder and de-facto liege references", async () => {
  const gamestate = Buffer.from(`
played_character={ character=10 }
landed_titles={ landed_titles={
 1={ key="d_test" holder={ character=10 } }
 2={ key="c_granted" holder={ character=20 } de_facto_liege={ title=1 } }
}}
living={
 10={ first_name="Ruler" landed_data={ domain={ 1 } council={} } }
 20={ first_name="Child" landed_data={ strength_for_liege=55 } }
}
`);

  const result = await queryGamestate(gamestate, (q) =>
    extractVassals(q, new Localizer(null), new Set()),
  );

  expect(result.total).toBe(1);
  expect(result.vassals[0]).toMatchObject({ id: 20, name: "Child", strengthForLiege: 55 });
});
