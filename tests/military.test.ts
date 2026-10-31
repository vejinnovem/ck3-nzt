import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractMilitary } from "../src/extract/military.js";

const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));

const DETAIL_GS = Buffer.from(`
date=867.3.1
played_character={
  character=13015
  player=1
  rally_points={ 3292 }
}
living={
13015={
  first_name="Siemowit"
  skill={ 6 6 6 4 3 1 }
  playable_data={ knights={ 23620 18664 23622 } }
  landed_data={
    levy=1455
    strength=1958
    current_strength=1958
    strength_without_hires=1958
  }
}
}
landed_titles={
landed_titles={
3292={ key="b_poznan" name="Poznań" }
}
}
armies={
regiments={
1001={ owner=13015 origin=3292 owning_title=3292 }
1002={ owner=13015 origin=3292 owning_title=3292 }
2001={ owner=99999 origin=3292 }
}
army_regiments={
5001={ type="bowmen" current=300 max=300 chunks={ { regiment=1001 index=0 } } }
5002={ type="light_footmen" current=200 max=200 chunks={ { regiment=1002 index=0 } } }
5003={ type="outside" current=999 max=999 chunks={ { regiment=2001 index=0 } } }
}
armies={}
}
wars={ active_wars={} }
`);

test("extracts mobilisation totals and the player's war", async () => {
  const snap = await buildSnapshot(GS, new Localizer(null));
  expect(snap.military.levy).toBe(4733.6);
  expect(snap.military.strength).toBe(8098.7);
  expect(snap.military.effectiveStrength).toBeNull();
  expect(snap.military.strengthSource).toBe("landed_data_raw");
  expect(snap.military.champions).toEqual({ ids: [], current: 0, max: null });
  expect(snap.military.menAtArms.source).toBe("unavailable");
  expect(snap.military.rallyPoints.source).toBe("unavailable");
  expect(snap.military.wars).toHaveLength(1);
  const w = snap.military.wars[0];
  expect(w.playerSide).toBe("attacker");
  expect(w.cbType).toBe("claim_cb");
  expect(w.targetTitle).toBe("Bohemia"); // title 2 -> name
  expect(w.attackerScore).toBe(12.5);
  expect(w.defenderScore).toBe(3.0);
});

test("links player Men-at-Arms through the global regiment database", async () => {
  const military = await queryGamestate(DETAIL_GS, (q) =>
    extractMilitary(q, new Localizer(null)),
  );

  expect(military.champions.ids).toEqual([23620, 18664, 23622]);
  expect(military.champions.current).toBe(3);
  expect(military.champions.max).toBeNull();

  expect(military.menAtArms.source).toBe("global_armies_best_effort");
  expect(military.menAtArms.slotsUsed).toBe(2);
  expect(military.menAtArms.slotsMax).toBeNull();
  expect(military.menAtArms.totalCurrentSoldiers).toBe(500);
  expect(military.menAtArms.totalMaxSoldiers).toBe(500);
  expect(military.menAtArms.regiments.map((regiment) => regiment.type)).toEqual([
    "bowmen",
    "light_footmen",
  ]);
  expect(military.menAtArms.regiments[0]?.linkedRegimentIds).toEqual([1001]);
  expect(military.menAtArms.regiments[0]?.originTitleIds).toEqual([3292]);
  expect(military.menAtArms.regiments[0]?.owningTitleIds).toEqual([3292]);

  expect(military.rallyPoints).toEqual({
    references: [3292],
    count: 1,
    source: "played_character",
  });
  expect(military.unattributedCurrentStrength).toBe(0);
});
