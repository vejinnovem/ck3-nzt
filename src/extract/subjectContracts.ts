import type { Query } from "../parser.js";

export type Obj = Record<string, unknown>;

export function asObject(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

const SUBJECT_FIELDS = ["vassal", "subject", "tributary"] as const;
const LIEGE_FIELDS = ["liege", "suzerain"] as const;
const CONTRACT_ID_FIELDS = ["id", "contract_id", "subject_contract_id", "vassal_contract_id"] as const;
const INACTIVE_CONTAINER_PATTERN = /(inactive|expired|history|past|terminated|removed)/i;
const PREFERRED_CONTAINER_PATTERN = /^(active|active_contracts|contracts|contract_database|database|entries)$/i;
const CONTRACT_MANAGER_PATTERN = /(?:subject|vassal|tribut).*contract|contract.*(?:subject|vassal|tribut)/i;

function hasNumericField(value: Obj, fields: readonly string[]): boolean {
  return fields.some((field) => typeof value[field] === "number");
}

function looksLikeSubjectContract(value: unknown): value is Obj {
  const obj = asObject(value);
  if (!obj) return false;
  return hasNumericField(obj, SUBJECT_FIELDS) && hasNumericField(obj, LIEGE_FIELDS);
}

function contractIdFrom(key: string | null, contract: Obj): number | null {
  if (key !== null && key.trim() !== "") {
    const keyId = Number(key);
    if (Number.isFinite(keyId)) return keyId;
  }

  for (const field of CONTRACT_ID_FIELDS) {
    const value = contract[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Jomini has exposed CK3 contract managers in more than one shape across patches.
 * Normalise any object/array whose children are actual subject-contract records into
 * the numeric-id map expected by the diplomacy extractor.
 */
function normaliseContractCollection(value: unknown): Obj | null {
  const result: Obj = {};

  if (Array.isArray(value)) {
    for (const child of value) {
      if (!looksLikeSubjectContract(child)) continue;
      const id = contractIdFrom(null, child);
      if (id === null) continue;
      result[String(id)] = child;
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  const obj = asObject(value);
  if (!obj) return null;

  for (const [key, child] of Object.entries(obj)) {
    if (!looksLikeSubjectContract(child)) continue;
    const id = contractIdFrom(key, child);
    if (id === null) continue;
    result[String(id)] = child;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function findNestedContractCollection(
  value: unknown,
  source: string,
  depth = 0,
): { active: Obj; source: string } | null {
  const direct = normaliseContractCollection(value);
  if (direct) return { active: direct, source };
  if (depth >= 6) return null;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findNestedContractCollection(value[index], `${source}[${index}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = asObject(value);
  if (!obj) return null;

  const children = Object.entries(obj)
    .filter(([, child]) => asObject(child) !== null || Array.isArray(child))
    .filter(([key]) => !INACTIVE_CONTAINER_PATTERN.test(key))
    .sort(([a], [b]) => {
      const aPreferred = PREFERRED_CONTAINER_PATTERN.test(a) ? 0 : 1;
      const bPreferred = PREFERRED_CONTAINER_PATTERN.test(b) ? 0 : 1;
      return aPreferred - bPreferred;
    });

  for (const [key, child] of children) {
    const found = findNestedContractCollection(child, `${source}.${key}`, depth + 1);
    if (found) return found;
  }

  return null;
}

function discoverRenamedContractManager(q: Query): { active: Obj; source: string } | null {
  const root = asObject(q.root());
  if (!root) return null;

  for (const [key, value] of Object.entries(root)) {
    if (!CONTRACT_MANAGER_PATTERN.test(key)) continue;
    if (key === "subject_contracts" || key === "vassal_contracts") continue;
    const found = findNestedContractCollection(value, key);
    if (found) return found;
  }

  return null;
}

/**
 * CK3 renamed vassal contracts to subject contracts when tributaries were introduced.
 * Older saves / parser fixtures can still expose the legacy vassal_contracts path.
 * Newer saves can also wrap the actual contract-id map in another manager object or
 * serialize it as an array. Prefer the historical /active paths, then discover records
 * below either known manager, and finally probe renamed top-level contract managers.
 */
export function activeSubjectContracts(q: Query): {
  active: Obj | null;
  source: string;
} {
  const subjectActive = normaliseContractCollection(q.at("/subject_contracts/active"));
  if (subjectActive) return { active: subjectActive, source: "subject_contracts" };

  const subjectRoot = q.at("/subject_contracts");
  const discoveredSubject = findNestedContractCollection(subjectRoot, "subject_contracts");
  if (discoveredSubject) return discoveredSubject;

  const legacyActive = normaliseContractCollection(q.at("/vassal_contracts/active"));
  if (legacyActive) return { active: legacyActive, source: "vassal_contracts" };

  const legacyRoot = q.at("/vassal_contracts");
  const discoveredLegacy = findNestedContractCollection(legacyRoot, "vassal_contracts");
  if (discoveredLegacy) return discoveredLegacy;

  const renamed = discoverRenamedContractManager(q);
  if (renamed) return renamed;

  return { active: null, source: "unavailable" };
}
