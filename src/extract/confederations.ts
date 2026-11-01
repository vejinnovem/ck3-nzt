import type { Query } from "../parser.js";

export interface CharacterConfederation {
  id: number;
  name: string | null;
  memberIds: number[];
}

function numberList(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

/**
 * CK3 stores confederations separately from ordinary alliance relations at
 * /confederation_manager/database. Character-based confederations expose their
 * rulers in `members`; house-based blocs additionally use `houses` and are not
 * expanded here because a house id is not itself a guaranteed war participant.
 */
export function findCharacterConfederations(
  q: Query,
  characterId: number,
): CharacterConfederation[] {
  const database = q.at("/confederation_manager/database");
  if (!database || typeof database !== "object" || Array.isArray(database)) return [];

  const out: CharacterConfederation[] = [];
  for (const [idText, raw] of Object.entries(database as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const memberIds = numberList(entry["members"]);
    if (!memberIds.includes(characterId)) continue;

    const id = Number(idText);
    if (!Number.isFinite(id)) continue;
    out.push({
      id,
      name: typeof entry["name"] === "string" ? entry["name"] : null,
      memberIds,
    });
  }
  return out;
}

export function collectConfederationCoMemberIds(q: Query, characterId: number): number[] {
  const out = new Set<number>();
  for (const confederation of findCharacterConfederations(q, characterId)) {
    for (const memberId of confederation.memberIds) {
      if (memberId !== characterId) out.add(memberId);
    }
  }
  return [...out];
}
