import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractLifestyleAdvisory } from "../src/extract/lifestyle.js";

async function extract(body: string) {
  const gamestate = Buffer.from(`date=889.1.1\nplayed_character={ character=1 }\nliving={\n1={\n first_name="Ruler"\n ${body}\n}\n}\n`);
  return queryGamestate(gamestate, (q) => extractLifestyleAdvisory(q, 1));
}

test("#86 preserves directly serialized lifestyle focus with source metadata", async () => {
  const lifestyle = await extract(`
 alive_data={
  focus={ type="martial_strategy_focus" date=888.2.3 changes=1 progress=42.5 }
  lifestyle_xp={ martial_lifestyle=490 diplomacy_lifestyle=150 }
  perk={ "bellum_justum_perk" "stalwart_leader_perk" }
 }
 `);

  expect(lifestyle.activeFocus).toEqual({
    type: "martial_strategy_focus",
    date: "888.2.3",
    changes: 1,
    progress: 42.5,
  });
  expect(lifestyle.focusSource).toBe("alive_data.focus");
  expect(lifestyle.focusConfidence).toBe("confirmed_direct");
  expect(lifestyle.focusEvidencePaths).toEqual(["/living/1/alive_data/focus/type"]);
  expect(lifestyle.lifestyleXp).toEqual({ martial_lifestyle: 490, diplomacy_lifestyle: 150 });
  expect(lifestyle.ownedPerks).toEqual(["bellum_justum_perk", "stalwart_leader_perk"]);
  expect(lifestyle.availablePerkChoicesKnown).toBe(false);
  expect(lifestyle.availablePerkChoices).toBeNull();
});

test("#86 recovers one explicit nested focus marker without using XP inference", async () => {
  const lifestyle = await extract(`
 alive_data={
  lifestyle_state={ selected_focus="martial_strategy_focus" }
  lifestyle_xp={ martial_lifestyle=50 stewardship_lifestyle=900 }
 }
 `);

  expect(lifestyle.activeFocus).toEqual({
    type: "martial_strategy_focus",
    date: null,
    changes: null,
    progress: null,
  });
  expect(lifestyle.focusSource).toBe("nested_focus_marker");
  expect(lifestyle.focusConfidence).toBe("confirmed_unique_marker");
  expect(lifestyle.focusCandidates).toEqual(["martial_strategy_focus"]);
  expect(lifestyle.focusEvidencePaths).toEqual([
    "/living/1/alive_data/lifestyle_state/selected_focus",
  ]);
});

test("#86 refuses to choose between multiple explicit focus markers", async () => {
  const lifestyle = await extract(`
 alive_data={
  lifestyle_state={ selected_focus="martial_strategy_focus" previous_focus="diplomacy_majesty_focus" }
  lifestyle_xp={ martial_lifestyle=999 diplomacy_lifestyle=1 }
 }
 `);

  expect(lifestyle.activeFocus).toBeNull();
  expect(lifestyle.focusSource).toBe("unavailable");
  expect(lifestyle.focusConfidence).toBe("unknown_ambiguous");
  expect(lifestyle.focusCandidates).toEqual([
    "diplomacy_majesty_focus",
    "martial_strategy_focus",
  ]);
});

test("#86 never infers active focus from the largest lifestyle XP pool", async () => {
  const lifestyle = await extract(`
 alive_data={
  lifestyle_xp={ stewardship_lifestyle=5000 martial_lifestyle=25 }
  perk="tax_man_perk"
 }
 `);

  expect(lifestyle.activeFocus).toBeNull();
  expect(lifestyle.focusConfidence).toBe("unknown_missing");
  expect(lifestyle.focusCandidates).toEqual([]);
  expect(lifestyle.lifestyleXp.stewardship_lifestyle).toBe(5000);
  expect(lifestyle.ownedPerks).toEqual(["tax_man_perk"]);
  expect(lifestyle.limitations.join(" ")).toContain("does not infer focus from the largest XP pool");
});
