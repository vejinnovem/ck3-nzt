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
    domain={ 3292 }
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
armies={ armies={} }
regiments={
1001={ owner=13015 origin=3292 owning_title=3292 deployment={ stationed_title=3292 } }
1002={ owner=13015 origin=3292 owning_title=3292 }
2001={ owner=99999 origin=3292 }
}
army_regiments={
5001={
  type="bowmen"
  chunks={
    { regiment=1001 current=150 max=150 index=0 }
    { regiment=1001 current=150 max=150 index=1 }
  }
}
5002={
  type="light_footmen"
  chunks={
    { regiment=1002 size=100 index=0 }
    { regiment=1002 size=100 index=1 }
  }
}
5003={ type="outside" current=999 max=999 chunks={ { regiment=2001 index=0 } } }
}
raid={
raid={
71={ raider=99999 defender=13015 target=3292 army=7001 loot=15 }
72={ raider=88888 defender=77777 target=4444 army=7002 loot=5 }
}
}
wars={ active_wars={} }
`);

const NESTED_DETAIL_GS = Buffer.from(`
date=867.3.1
played_character={ character=13015 player=1 }
living={
13015={
  first_name="Siemowit"
  skill={ 6 6 6 4 3 1 }
  playable_data={ knights={} }
  landed_data={ levy=100 strength=200 current_strength=200 strength_without_hires=200 }
}
}
armies={
regiments={ 1001={ owner=13015 } }
army_regiments={ 5001={ type="bowmen" current=100 max=100 chunks={ { regiment=1001 index=0 } } } }
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
  expect(snap.military.raids.source).toBe("unavailable");
  expect(snap.military.wars).toHaveLength(1);
  const w = snap.military.wars[0];
  expect(w.playerSide).toBe("attacker");
  expect(w.cbType).toBe("claim_cb");
  expect(w.targetTitle).toBe("Bohemia"); // title 2 -> name
  expect(w.attackerScore).toBe(12.5);
  expect(w.defenderScore).toBe(3.0);
});

test("links player Men-at-Arms and derives strength from regiment chunks", async () => {
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
  expect(military.menAtArms.regiments[0]?.current).toBe(300);
  expect(military.menAtArms.regiments[0]?.max).toBe(300);
  expect(military.menAtArms.regiments[1]?.current).toBe(200);
  expect(military.menAtArms.regiments[1]?.max).toBe(200);
  expect(military.menAtArms.regiments[0]?.linkedRegimentIds).toEqual([1001]);
  expect(military.menAtArms.regiments[0]?.originTitleIds).toEqual([3292]);
  expect(military.menAtArms.regiments[0]?.owningTitleIds).toEqual([3292]);
  expect(military.menAtArms.regiments[0]?.stationed).toEqual({
    field: "stationed_title",
    id: 3292,
    titleName: "Poznań",
  });
  expect(military.menAtArms.regiments[1]?.stationed).toBeNull();
  expect(military.menAtArms.regiments[1]?.diagnostics).not.toBeNull();

  expect(military.rallyPoints).toEqual({
    references: [3292],
    count: 1,
    source: "played_character",
  });
  expect(military.unattributedCurrentStrength).toBe(0);
});

test("exports active raid records and prioritizes player-relevant raids", async () => {
  const military = await queryGamestate(DETAIL_GS, (q) =>
    extractMilitary(q, new Localizer(null)),
  );

  expect(military.raids.source).toBe("raid_save");
  expect(military.raids.activeCount).toBe(2);
  expect(military.raids.playerRelevantCount).toBe(1);
  expect(military.raids.truncated).toBe(false);
  expect(military.raids.records[0]?.id).toBe("71");
  expect(military.raids.records[0]?.playerRelevant).toBe(true);
  expect(military.raids.records[0]?.fields["defender"]).toBe(13015);
  expect(military.raids.records[0]?.fields["loot"]).toBe(15);
});

test("keeps nested regiment blocks as a compatibility fallback", async () => {
  const military = await queryGamestate(NESTED_DETAIL_GS, (q) =>
    extractMilitary(q, new Localizer(null)),
  );

  expect(military.menAtArms.slotsUsed).toBe(1);
  expect(military.menAtArms.totalCurrentSoldiers).toBe(100);
  expect(military.unattributedCurrentStrength).toBe(0);
});
