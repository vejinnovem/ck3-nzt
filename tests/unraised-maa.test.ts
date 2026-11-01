import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractMilitary } from "../src/extract/military.js";
import { correctMilitaryLiveFields } from "../src/extract/liveSaveCorrections.js";
import { assessMenAtArmsReliability } from "../src/snapshot.js";

const UNRAISED_GS = Buffer.from(`
date=873.8.1
played_character={ character=13015 player=1 }
living={
13015={
  first_name="Siemowit"
  playable_data={ knights={} }
  landed_data={
    levy=1868
    strength=2368
    current_strength=2368
    strength_without_hires=2368
  }
}
}
armies={ armies={} }
army_regiments={}
regiments={
16411={ type="light_footmen" origin=4905 size=300 owner=13015 }
16412={ type="bowmen" origin=4900 size=200 owner=13015 }
20000={ type="bowmen" origin=9999 size=999 owner=99999 }
}
wars={ active_wars={} }
`);

test("recovers persistent Men-at-Arms when no raised army_regiment wrappers exist", async () => {
  const military = await queryGamestate(UNRAISED_GS, (q) =>
    correctMilitaryLiveFields(q, extractMilitary(q, new Localizer(null))),
  );

  expect(military.menAtArms.slotsUsed).toBe(2);
  expect(military.menAtArms.totalCurrentSoldiers).toBe(500);
  expect(military.menAtArms.totalMaxSoldiers).toBe(500);
  expect(military.menAtArms.regiments.map((regiment) => regiment.type)).toEqual([
    "light_footmen",
    "bowmen",
  ]);
  expect(military.menAtArms.regiments.map((regiment) => regiment.linkedRegimentIds)).toEqual([
    [16411],
    [16412],
  ]);

  const reliability = assessMenAtArmsReliability(military);
  expect(reliability.breakdownReliable).toBe(true);
  expect(reliability.nonLevyNonChampionMaxStrength).toBe(500);
  expect(reliability.discrepancy).toBe(0);
});
