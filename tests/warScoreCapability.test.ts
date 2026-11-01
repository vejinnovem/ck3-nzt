import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";

const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));

test("marks full player-visible war score as runtime-computed and not reconstructed", async () => {
  const snap = await buildSnapshot(GS, new Localizer(null));

  expect(snap.military.warScoreCapability).toEqual({
    fullPlayerVisibleWarScoreAvailable: false,
    source: "runtime_computed_not_serialized",
    reconstruction: "not_implemented",
    knownSerializedComponents: ["ticking_war_score", "controls_all", "battle_results"],
    limitation:
      "Exact UI war score requires reconstruction from occupation state, CB/static game-data scaling, battle results, prisoners/capital and other runtime modifiers; do not sum the serialized components as a total war score.",
  });
});
