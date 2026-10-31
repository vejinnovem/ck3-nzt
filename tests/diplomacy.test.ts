import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));

test("extracts alliances, truces, hostility, independence", async () => {
  const d = (await buildSnapshot(GS, new Localizer(null))).diplomacy;
  expect(d.independent).toBe(true);
  expect(d.alliances).toEqual([
    { id: 22222, name: "Adela", throughCharacterIds: [33564206, 22222] },
  ]);
  expect(d.truces).toEqual([{ id: 22222, name: "Adela", until: "1135.6.1", result: "victory" }]);
  expect(d.hostile).toEqual([{ id: 22222, name: "Adela", opinion: -30 }]);
});

test("does not expose an unlanded marriage participant as a separate ally", async () => {
  const gs = Buffer.from(`date=867.1.1
meta_data={ meta_player_name="Ruler" meta_title_name="Realm" meta_player_tier=3 meta_house_name="House" }
played_character={ character=1 player=1 }
landed_titles={ landed_titles={ 10={ key="d_player" holder=1 } 20={ key="d_ally" holder=2 } } }
living={
 1={ first_name="Ruler" landed_data={ domain={ 10 } } }
 2={ first_name="Allied Ruler" landed_data={ domain={ 20 } } }
 3={ first_name="Bride" court_data={ employer=1 } }
}
relations={ active_relations={
 { first=1 second=2 alliances={ { allied_through_0=4 allied_through_1=3 } } }
 { first=1 second=3 alliances={ { allied_through_0=4 allied_through_1=3 } } }
} }
`);
  const d = (await buildSnapshot(gs, new Localizer(null))).diplomacy;
  expect(d.alliances).toEqual([{ id: 2, name: "Allied Ruler", throughCharacterIds: [4, 3] }]);
});
