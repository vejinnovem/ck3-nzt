import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { extractCharacter, type CharacterFocus, type CharacterInfo } from "./characters.js";

type Obj = Record<string, unknown>;

export interface EducationChildInfo {
  id: number;
  name: string;
  age: number | null;
  successionPosition: number | null;
  focus: CharacterFocus | null;
  skills: CharacterInfo["skills"];
  traits: string[];
  guardianIds: number[];
  guardianNames: string[];
  guardianStatus: "present" | "not_found";
}

export interface EducationInfo {
  children: EducationChildInfo[];
  childrenWithoutGuardian: number;
  source: "succession_and_descendants_plus_scripted_relations";
  limitation: string;
}

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberList(value: unknown): number[] {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function involvedCharacter(value: unknown): number | null {
  const direct = num(value);
  if (direct !== null) return direct;
  const record = obj(value);
  if (!record) return null;
  for (const key of ["involved_character", "character", "id", "value"]) {
    const found = num(record[key]);
    if (found !== null) return found;
  }
  return null;
}

function descendantIds(q: Query, rootId: number, maxDepth = 4): Set<number> {
  const result = new Set<number>();
  const visited = new Set<number>();

  function walk(id: number, depth: number): void {
    if (depth > maxDepth || visited.has(id)) return;
    visited.add(id);
    for (const childId of numberList(q.at(`/living/${id}/family_data/child`))) {
      result.add(childId);
      walk(childId, depth + 1);
    }
  }

  walk(rootId, 0);
  return result;
}

function guardianMap(q: Query, relevantChildren: Set<number>): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  const add = (childId: number, guardianId: number): void => {
    if (!relevantChildren.has(childId) || childId === guardianId) return;
    const current = result.get(childId) ?? new Set<number>();
    current.add(guardianId);
    result.set(childId, current);
  };

  const opinions = q.at("/opinions/active_opinions");
  if (!Array.isArray(opinions)) return result;

  for (const rawEntry of opinions) {
    const entry = obj(rawEntry);
    if (!entry) continue;
    const owner = num(entry["owner"]);
    const target = num(entry["target"]);
    const scripted = obj(entry["scripted_relations"]);
    if (!scripted) continue;

    const guardian = scripted["guardian"];
    if (guardian !== undefined) {
      const involved = involvedCharacter(guardian) ?? target;
      if (owner !== null && involved !== null) add(owner, involved);
    }

    const ward = scripted["ward"];
    if (ward !== undefined) {
      const involved = involvedCharacter(ward) ?? target;
      if (owner !== null && involved !== null) add(involved, owner);
    }
  }

  return result;
}

/**
 * Education context for the played ruler's minor descendants who are in succession or
 * still in the family tree. Guardianship is best-effort because the save's scripted
 * relation serialization has changed between CK3 versions.
 */
export function extractEducation(q: Query, loc: Localizer): EducationInfo {
  const playerId = num(q.at("/played_character/character"));
  if (playerId === null) {
    return {
      children: [],
      childrenWithoutGuardian: 0,
      source: "succession_and_descendants_plus_scripted_relations",
      limitation: "played character unavailable",
    };
  }

  const succession = numberList(q.at(`/living/${playerId}/landed_data/succession`));
  const successionPosition = new Map(succession.map((id, index) => [id, index + 1]));
  const candidates = descendantIds(q, playerId);
  for (const heirId of succession) candidates.add(heirId);

  const profiles = [...candidates]
    .map((id) => extractCharacter(q, loc, id))
    .filter((character): character is CharacterInfo => character !== null)
    .filter((character) => character.age !== null && character.age >= 6 && character.age < 16);
  const relevantIds = new Set(profiles.map((profile) => profile.id));
  const guardians = guardianMap(q, relevantIds);

  const children = profiles
    .map((profile): EducationChildInfo => {
      const guardianIds = [...(guardians.get(profile.id) ?? [])];
      return {
        id: profile.id,
        name: profile.name,
        age: profile.age,
        successionPosition: successionPosition.get(profile.id) ?? null,
        focus: profile.focusKind === "education" ? profile.focus : null,
        skills: profile.skills,
        traits: profile.traits,
        guardianIds,
        guardianNames: guardianIds.map((guardianId) => {
          const raw = q.at(`/living/${guardianId}/first_name`);
          return typeof raw === "string" ? raw : String(guardianId);
        }),
        guardianStatus: guardianIds.length > 0 ? "present" : "not_found",
      };
    })
    .sort((a, b) => {
      const aPos = a.successionPosition ?? Number.POSITIVE_INFINITY;
      const bPos = b.successionPosition ?? Number.POSITIVE_INFINITY;
      if (aPos !== bPos) return aPos - bPos;
      return (b.age ?? 0) - (a.age ?? 0);
    });

  return {
    children,
    childrenWithoutGuardian: children.filter((child) => child.guardianStatus === "not_found").length,
    source: "succession_and_descendants_plus_scripted_relations",
    limitation:
      "guardianStatus=not_found means no guardian relation was recovered from serialized scripted relations; treat it as a warning, not proof, until the Important Action/UI state agrees.",
  };
}
