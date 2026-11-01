import type { Query } from "../parser.js";

export type Obj = Record<string, unknown>;

export function asObject(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

/**
 * CK3 renamed vassal contracts to subject contracts when tributaries were introduced.
 * Older saves / parser fixtures can still expose the legacy vassal_contracts path,
 * while current 1.20 saves may use subject_contracts. Keep both for compatibility.
 */
export function activeSubjectContracts(q: Query): {
  active: Obj | null;
  source: "subject_contracts" | "vassal_contracts" | "unavailable";
} {
  const subjectContracts = asObject(q.at("/subject_contracts/active"));
  if (subjectContracts) return { active: subjectContracts, source: "subject_contracts" };

  const legacyContracts = asObject(q.at("/vassal_contracts/active"));
  if (legacyContracts) return { active: legacyContracts, source: "vassal_contracts" };

  return { active: null, source: "unavailable" };
}
