export interface CharacterSkills {
  diplomacy: number;
  martial: number;
  stewardship: number;
  intrigue: number;
  learning: number;
  prowess: number;
}

export interface SkillSemantics {
  /** Values serialized directly by CK3 under living/<character>/skill. */
  rawSaveValues: CharacterSkills;
  /** Null until CK3-NZT can reconstruct all runtime/UI modifiers reliably. */
  effectiveValues: null;
  effectiveAvailable: false;
  /** Stable machine-readable source label for snapshot consumers. */
  source: "living.skill";
  /** Prevent consumers from interpreting rawSaveValues as UI-equivalent effective skills. */
  scope: "serialized_skill_array_not_ui_equivalent";
  modifierBreakdownAvailable: false;
  limitation: string;
}

export const SKILL_LIMITATION =
  "CK3-NZT exposes the serialized living/<character>/skill values but does not reconstruct reliable UI-equivalent effective skills. Lifestyle focus, traits, council/court effects, temporary modifiers and other runtime effects can make the CK3 UI value higher or lower, so do not treat rawSaveValues as effective skills.";

export function skillSemantics(rawSaveValues: CharacterSkills): SkillSemantics {
  return {
    rawSaveValues: { ...rawSaveValues },
    effectiveValues: null,
    effectiveAvailable: false,
    source: "living.skill",
    scope: "serialized_skill_array_not_ui_equivalent",
    modifierBreakdownAvailable: false,
    limitation: SKILL_LIMITATION,
  };
}
