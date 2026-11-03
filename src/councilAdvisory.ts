import type { CouncilOffice } from "./extract/council.js";
import type { Snapshot } from "./snapshot.js";
import { SKILL_LIMITATION, type CharacterSkills } from "./skills.js";

export type CouncilCandidateSource =
  | "courtier"
  | "guest"
  | "direct_vassal"
  | "current_councillor";

export type CouncilEligibilityState = "eligible" | "ineligible" | "unknown";

export type CouncilRelevantSkill =
  | "diplomacy"
  | "stewardship"
  | "martial"
  | "intrigue"
  | "learning";

export interface CouncilOfficeAssessment {
  office: CouncilOffice;
  relevantSkill: CouncilRelevantSkill;
  serializedSkill: number | null;
  effectiveSkill: null;
  effectiveSkillAvailable: false;
  skillSource: "living.skill";
  skillLimitation: string;
  eligibility: CouncilEligibilityState;
  eligibilityReason:
    | "current_office_holder"
    | "underage"
    | "guest_requires_recruitment"
    | "faith_runtime_rules_not_reconstructed"
    | "runtime_rules_not_reconstructed";
}

export interface CouncilAdvisoryCandidate {
  id: number;
  name: string;
  age: number | null;
  sources: CouncilCandidateSource[];
  currentOffice: CouncilOffice | null;
  serializedSkills: CharacterSkills | null;
  officeAssessments: CouncilOfficeAssessment[];
}

export interface CouncilAdvisoryContext {
  source: "snapshot_derived_best_effort";
  offices: CouncilOffice[];
  candidates: CouncilAdvisoryCandidate[];
  effectiveSkillsAvailable: false;
  exactEligibilityAvailable: false;
  limitation: string;
}

const OFFICES: CouncilOffice[] = [
  "chancellor",
  "steward",
  "marshal",
  "spymaster",
  "court_chaplain",
];

const OFFICE_SKILL: Record<CouncilOffice, CouncilRelevantSkill> = {
  chancellor: "diplomacy",
  steward: "stewardship",
  marshal: "martial",
  spymaster: "intrigue",
  court_chaplain: "learning",
};

interface CandidateSeed {
  id: number;
  name: string;
  age: number | null;
  skills: CharacterSkills | null;
  sources: Set<CouncilCandidateSource>;
}

function assessment(
  candidate: CandidateSeed,
  office: CouncilOffice,
  currentOffice: CouncilOffice | null,
): CouncilOfficeAssessment {
  const relevantSkill = OFFICE_SKILL[office];
  let eligibility: CouncilEligibilityState = "unknown";
  let eligibilityReason: CouncilOfficeAssessment["eligibilityReason"] =
    office === "court_chaplain"
      ? "faith_runtime_rules_not_reconstructed"
      : "runtime_rules_not_reconstructed";

  if (currentOffice === office) {
    eligibility = "eligible";
    eligibilityReason = "current_office_holder";
  } else if (candidate.age !== null && candidate.age < 16) {
    eligibility = "ineligible";
    eligibilityReason = "underage";
  } else if (
    candidate.sources.has("guest") &&
    !candidate.sources.has("courtier") &&
    !candidate.sources.has("direct_vassal") &&
    !candidate.sources.has("current_councillor")
  ) {
    eligibility = "ineligible";
    eligibilityReason = "guest_requires_recruitment";
  }

  return {
    office,
    relevantSkill,
    serializedSkill: candidate.skills?.[relevantSkill] ?? null,
    effectiveSkill: null,
    effectiveSkillAvailable: false,
    skillSource: "living.skill",
    skillLimitation: SKILL_LIMITATION,
    eligibility,
    eligibilityReason,
  };
}

function mergeSeed(
  byId: Map<number, CandidateSeed>,
  seed: Omit<CandidateSeed, "sources"> & { source: CouncilCandidateSource },
): void {
  const existing = byId.get(seed.id);
  if (existing) {
    existing.sources.add(seed.source);
    if (existing.skills === null && seed.skills !== null) existing.skills = seed.skills;
    if (existing.age === null && seed.age !== null) existing.age = seed.age;
    return;
  }
  byId.set(seed.id, {
    id: seed.id,
    name: seed.name,
    age: seed.age,
    skills: seed.skills,
    sources: new Set([seed.source]),
  });
}

export function buildCouncilAdvisory(snapshot: Snapshot): CouncilAdvisoryContext {
  const byId = new Map<number, CandidateSeed>();
  const currentOfficeById = new Map<number, CouncilOffice>();

  for (const member of snapshot.council?.members ?? []) {
    const office = member.activeTask?.office ?? null;
    if (office) currentOfficeById.set(member.id, office);
    mergeSeed(byId, {
      id: member.id,
      name: member.name,
      age: member.age,
      skills: member.skills,
      source: "current_councillor",
    });
  }

  for (const candidate of snapshot.council?.candidates ?? []) {
    mergeSeed(byId, {
      id: candidate.id,
      name: candidate.name,
      age: candidate.age,
      skills: candidate.skills,
      source: candidate.courtStatus,
    });
  }

  // Direct vassals are valid council-candidate context even when they live in their own
  // court and therefore do not occur in council.candidates (which is court/guest based).
  for (const vassal of snapshot.vassals ?? []) {
    mergeSeed(byId, {
      id: vassal.id,
      name: vassal.name,
      age: vassal.age,
      skills: vassal.skills,
      source: "direct_vassal",
    });
    if (vassal.councilSeat && !currentOfficeById.has(vassal.id)) {
      // Seat membership is reliable, but the office is not available on VassalInfo alone.
      byId.get(vassal.id)?.sources.add("current_councillor");
    }
  }

  const candidates = [...byId.values()]
    .map((candidate): CouncilAdvisoryCandidate => {
      const currentOffice = currentOfficeById.get(candidate.id) ?? null;
      return {
        id: candidate.id,
        name: candidate.name,
        age: candidate.age,
        sources: [...candidate.sources].sort(),
        currentOffice,
        serializedSkills: candidate.skills === null ? null : { ...candidate.skills },
        officeAssessments: OFFICES.map((office) => assessment(candidate, office, currentOffice)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  return {
    source: "snapshot_derived_best_effort",
    offices: [...OFFICES],
    candidates,
    effectiveSkillsAvailable: false,
    exactEligibilityAvailable: false,
    limitation:
      "Current office holders are confirmed eligible for their occupied office; underage characters and unrecruited guests are marked ineligible. Other office eligibility depends on CK3 faith, gender, government and scripted runtime rules and therefore remains unknown. Council skill values are serialized living.skill values, not UI-effective values.",
  };
}

export function attachCouncilAdvisoryContext<T extends Snapshot>(
  snapshot: T,
): T & { councilAdvisory: CouncilAdvisoryContext } {
  return Object.assign(snapshot, { councilAdvisory: buildCouncilAdvisory(snapshot) });
}
