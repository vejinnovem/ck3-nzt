import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));

const RAW_STRENGTH_LIMITATION =
  "Save-derived allied-ruler landed_data totals are raw realm mobilisation values and are not guaranteed to equal CK3's player-visible effective strength.";
const UNKNOWN_STRENGTH_LIMITATION =
  "No supported allied-ruler landed_data strength fields were serialized for this alliance; strength remains unknown.";

test("extracts alliances, truces, hostility, independence", async () => {
  const d = (await buildSnapshot(GS, new Localizer(null))).diplomacy;
  expect(d.independent).toBe(true);
  expect(d.alliances).toEqual([
    {
      id: 22222,
      name: "Adela",
      throughCharacterIds: [33564206, 22222],
      provenance: {
        kind: "relationship",
        source: "active_relations",
        throughCharacterIds: [33564206, 22222],
        evidence: ["active_relations.alliances.allied_through:33564206<->22222"],
      },
      realmStrength: {
        levy: null,
        strength: null,
        currentStrength: null,
        strengthWithoutHires: null,
        source: "unavailable",
        uiEquivalent: false,
        limitation: UNKNOWN_STRENGTH_LIMITATION,
      },
    },
  ]);
  expect(d.truces).toEqual([{ id: 22222, name: "Adela", until: "1135.6.1", result: "victory" }]);
  expect(d.hostile).toEqual([{ id: 22222, name: "Adela", opinion: -30 }]);
});

test("keeps actual allied ruler separate from marriage participants and labels raw realm strength", async () => {
  const gs = Buffer.from(`date=867.1.1
meta_data={ meta_player_name="Ruler" meta_title_name="Realm" meta_player_tier=3 meta_house_name="House" }
played_character={ character=1 player=1 }
landed_titles={ landed_titles={ 10={ key="d_player" holder=1 } 20={ key="d_ally" holder=2 } } }
living={
 1={ first_name="Ruler" landed_data={ domain={ 10 } } }
 2={ first_name="Allied Ruler" landed_data={ domain={ 20 } levy=1800 strength=2500 current_strength=2200 strength_without_hires=2500 } }
 3={ first_name="Bride" family_data={ spouse={ 4 } } court_data={ employer=1 } }
 4={ first_name="Groom" family_data={ spouse={ 3 } } court_data={ employer=2 } }
}
relations={ active_relations={
 { first=1 second=2 alliances={ { allied_through_0=4 allied_through_1=3 } } }
 { first=1 second=3 alliances={ { allied_through_0=4 allied_through_1=3 } } }
} }
`);
  const d = (await buildSnapshot(gs, new Localizer(null))).diplomacy;
  expect(d.alliances).toEqual([
    {
      id: 2,
      name: "Allied Ruler",
      throughCharacterIds: [4, 3],
      provenance: {
        kind: "marriage",
        source: "active_relations",
        throughCharacterIds: [4, 3],
        evidence: [
          "active_relations.alliances.allied_through:4<->3",
          "living.*.family_data.spouse/primary_spouse",
        ],
      },
      realmStrength: {
        levy: 1800,
        strength: 2500,
        currentStrength: 2200,
        strengthWithoutHires: 2500,
        source: "landed_data_raw",
        uiEquivalent: false,
        limitation: RAW_STRENGTH_LIMITATION,
      },
    },
  ]);
});
