import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { queryGamestate } from "../src/parser.js";
import {
  extractCharacter,
  extractImmediateFamily,
  findCharacters,
} from "../src/extract/characters.js";
import { Localizer } from "../src/localization.js";

const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));

const FAMILY_GS = Buffer.from(`date=867.1.1
played_character={ character=1 player=1 }
living={
1={
  first_name="Siemowit"
  birth=830.5.10
  skill={ 8 11 10 6 7 9 }
  family_data={ primary_spouse=2 spouse=2 child={ 3 4 } }
  alive_data={
    gold={ value=64 }
    income=2.5
    prestige={ currency=120 accumulated=300 }
    piety={ currency=50 accumulated=80 }
    health=5.1
    fertility=0.62
    stress=0
    focus={ type="stewardship_domain_focus" date=866.1.1 changes=1 progress=42.5 }
    lifestyle_xp={ stewardship_lifestyle=725 martial_lifestyle=100 }
    perk={ "tax_man_perk" "cutting_cornerstones_perk" }
  }
  landed_data={ succession={ 3 4 } }
}
2={
  first_name="Dobrawa"
  female=yes
  birth=835.2.1
  skill={ 7 4 9 5 8 2 }
  alive_data={ health=4.8 fertility=0.55 }
}
3={
  first_name="Kazimierz"
  birth=855.3.1
  skill={ 2 3 2 1 2 1 }
  family_data={ spouse=5 }
  court_data={ employer=1 council_task=77 }
  alive_data={ health=5.0 }
}
4={
  first_name="Eufemia"
  female=yes
  birth=858.7.1
  skill={ 1 1 2 2 3 1 }
  family_data={ betrothed=6 }
  alive_data={ health=5.0 focus={ type="education_diplomacy" date=867.1.1 changes=0 progress=3 } }
}
5={ first_name="Mila" female=yes birth=856.1.1 skill={ 1 1 1 1 1 1 } }
6={ first_name="Bogdan" birth=855.1.1 skill={ 1 1 1 1 1 1 } }
}
`);

test("extractCharacter returns a full dossier", async () => {
  const loc = new Localizer(null);
  const c = await queryGamestate(GS, (q) => extractCharacter(q, loc, 33564206));
  expect(c).not.toBeNull();
  expect(c!.name).toBe("Jenec");
  expect(c!.skills.learning).toBe(9); // skill[4]
  expect(c!.traits).toEqual(["just", "temperate", "chaste"]);
  expect(c!.gold).toBe(124.5);
  expect(c!.primaryTitle).toBe("The Holy Roman Empire"); // domain[0]=1 -> name
  expect(c!.claims).toEqual([{ title: "Bohemia", pressed: true }]);
});

test("extractCharacter exposes ruler advisory fields", async () => {
  const loc = new Localizer(null);
  const c = await queryGamestate(FAMILY_GS, (q) => extractCharacter(q, loc, 1));
  expect(c).not.toBeNull();
  expect(c!.birth).toBe("830.5.10");
  expect(c!.age).toBe(36);
  expect(c!.female).toBe(false);
  expect(c!.income).toBe(2.5);
  expect(c!.prestigeCurrency).toBe(120);
  expect(c!.pietyCurrency).toBe(50);
  expect(c!.fertility).toBe(0.62);
  expect(c!.focus?.type).toBe("stewardship_domain_focus");
  expect(c!.focusKind).toBe("lifestyle");
  expect(c!.lifestyleXp).toEqual({ stewardship_lifestyle: 725, martial_lifestyle: 100 });
  expect(c!.perks).toEqual(["tax_man_perk", "cutting_cornerstones_perk"]);
  expect(c!.isMarried).toBe(true);
  expect(c!.spouseIds).toEqual([2]);
});

test("extractCharacter distinguishes education focus from lifestyle focus", async () => {
  const loc = new Localizer(null);
  const daughter = await queryGamestate(FAMILY_GS, (q) => extractCharacter(q, loc, 4));
  expect(daughter?.focus?.type).toBe("education_diplomacy");
  expect(daughter?.focusKind).toBe("education");
});

test("extractCharacter exposes marriage and court status for heirs", async () => {
  const loc = new Localizer(null);
  const heir = await queryGamestate(FAMILY_GS, (q) => extractCharacter(q, loc, 3));
  expect(heir?.isMarried).toBe(true);
  expect(heir?.spouseIds).toEqual([5]);
  expect(heir?.employerId).toBe(1);
  expect(heir?.councilTaskId).toBe(77);

  const daughter = await queryGamestate(FAMILY_GS, (q) => extractCharacter(q, loc, 4));
  expect(daughter?.isMarried).toBe(false);
  expect(daughter?.betrothedId).toBe(6);
});

test("extractImmediateFamily returns spouse, children, and succession positions", async () => {
  const loc = new Localizer(null);
  const family = await queryGamestate(FAMILY_GS, (q) => extractImmediateFamily(q, loc, 1));
  expect(family.primarySpouse?.name).toBe("Dobrawa");
  expect(family.spouses.map((member) => member.id)).toEqual([2]);
  expect(family.primaryHeirId).toBe(3);
  expect(family.children.map((member) => [member.name, member.successionPosition])).toEqual([
    ["Kazimierz", 1],
    ["Eufemia", 2],
  ]);
  expect(family.children[0]?.isMarried).toBe(true);
  expect(family.children[1]?.betrothedId).toBe(6);
});

test("extractCharacter returns null for an unknown id", async () => {
  const loc = new Localizer(null);
  const c = await queryGamestate(GS, (q) => extractCharacter(q, loc, 999));
  expect(c).toBeNull();
});

test("findCharacters matches by partial first name", () => {
  const matches = findCharacters(GS.toString("utf8"), "del"); // 'Adela'
  expect(matches.map((m) => m.id)).toContain(22222);
});

test("findCharacters matches loc-encoded names after normalization", () => {
  // CK3 stores "Críchán" as "CrI_chA_n"; a plain query should still match.
  const text = '\nliving={\n5={\n\tfirst_name="CrI_chA_n"\n}\n}\n';
  const matches = findCharacters(text, "crichan");
  expect(matches).toEqual([{ id: 5, name: "CrI_chA_n", primaryTitle: null }]);
});
