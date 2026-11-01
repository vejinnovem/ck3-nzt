import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractVassals } from "../src/extract/vassals.js";

const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));

test("extracts vassals and factions with cross-referenced flags", async () => {
  const snap = await buildSnapshot(GS, new Localizer(null));
  expect(snap.factions).toEqual([
    {
      type: "independence_faction",
      power: 30,
      threshold: 70,
      discontent: null,
      members: 1,
      leaderName: "Adela",
    },
  ]);
  expect(snap.vassals).toEqual([
    {
      id: 22222,
      name: "Adela",
      strengthForLiege: 500,
      opinion: -30,
      councilSeat: true,
      inFaction: true,
    },
  ]);
  expect(snap.vassalCount).toBe(1);
});

test("detects a direct vassal when de-facto liege is a held duchy outside personal domain", async () => {
  const gamestate = Buffer.from(`
played_character={ character=10 }
landed_titles={
 landed_titles={
  1={ key="d_test" holder=10 }
  2={ key="c_capital" holder=10 de_facto_liege=1 }
  3={ key="c_granted" holder=20 de_facto_liege=1 }
 }
}
living={
 10={ first_name="Ruler" landed_data={ domain={ 2 } council={} } }
 20={ first_name="Child" landed_data={ strength_for_liege=123 } }
}
`);

  const result = await queryGamestate(gamestate, (q) =>
    extractVassals(q, new Localizer(null), new Set()),
  );

  expect(result.total).toBe(1);
  expect(result.vassals).toEqual([
    {
      id: 20,
      name: "Child",
      strengthForLiege: 123,
      opinion: null,
      councilSeat: false,
      inFaction: false,
    },
  ]);
});
