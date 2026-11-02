import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractCharacter } from "../src/extract/characters.js";
import { Localizer } from "../src/localization.js";
import {
  attachSnapshotSkillSemantics,
  skillSemantics,
  snapshotSkillSemantics,
} from "../src/skills.js";

const GS = Buffer.from(`date=883.2.16
traits_lookup={ "learning_modifier_trait" }
played_character={ character=1 player=1 }
living={
1={
  first_name="Wiedunia"
  skill={ 6 4 5 3 11 2 }
  traits={ 0 }
  alive_data={
    focus={ type="learning_theology_focus" date=882.1.1 changes=1 progress=50 }
    lifestyle_xp={ learning_lifestyle=500 }
  }
}
}
`);

test("serialized character skills remain explicitly non-UI-equivalent", async () => {
  const character = await queryGamestate(GS, (q) =>
    extractCharacter(q, new Localizer(null), 1),
  );

  expect(character).not.toBeNull();
  expect(character!.skills.learning).toBe(11);
  expect(character!.focus?.type).toBe("learning_theology_focus");

  const semantics = skillSemantics(character!.skills);
  expect(semantics.rawSaveValues.learning).toBe(11);
  expect(semantics.effectiveAvailable).toBe(false);
  expect(semantics.effectiveValues).toBeNull();
  expect(semantics.modifierBreakdownAvailable).toBe(false);
  expect(semantics.scope).toBe("serialized_skill_array_not_ui_equivalent");
  expect(semantics.limitation).toContain("do not treat serialized skill values as effective skills");
});

test("snapshot metadata covers every exported character skill field", () => {
  const semantics = snapshotSkillSemantics();
  expect(semantics.effectiveAvailable).toBe(false);
  expect(semantics.affectedFields).toEqual([
    "ruler.skills",
    "family.*.skills",
    "council.members[*].skills",
    "council.candidates[*].skills",
    "education.children[*].skills",
    "vassals[*].skills",
    "succession.heirProfiles[*].profile.skills",
  ]);

  const snapshot = attachSnapshotSkillSemantics({ date: "883.2.16" });
  expect(snapshot.characterSkillSemantics.scope).toBe(
    "all_exported_character_skills_are_serialized_not_ui_equivalent",
  );
  expect(snapshot.characterSkillSemantics.modifierBreakdownAvailable).toBe(false);
});
