import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { extractCharacter } from "./characters.js";
import {
  countyContextsHeldBy,
  extractCountyContext,
  type CountyContextInfo,
} from "./countyContext.js";

export interface FactionInfo {
  id: number | null;
  type: string;
  power: number | null;
  threshold: number | null;
  discontent: number | null;
  members: number;
  leaderId: number | null;
  leaderName: string | null;
  leaderDynastyHouseId: number | null;
  leaderDynastyHouseName: string | null;
  titleMembers: CountyContextInfo[];
}
export interface VassalInfo {
  id: number;
  name: string;
  dynastyHouseId: number | null;
  dynastyHouseName: string | null;
  strengthForLiege: number;
  opinion: number | null;
  councilSeat: boolean;
  inFaction: boolean;
  counties: CountyContextInfo[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function numberList(v: unknown): number[] {
  if (typeof v === "number" && Number.isFinite(v)) return [v];
  if (!Array.isArray(v)) return [];
  return v.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
}

function referenceNumber(v: unknown, preferredKeys: string[]): number | null {
  const direct = num(v);
  if (direct !== null) return direct;
  if (Array.isArray(v)) {
    for (const entry of v) {
      const found = referenceNumber(entry, preferredKeys);
      if (found !== null) return found;
    }
    return null;
  }
  const record = obj(v);
  if (!record) return null;
  for (const key of preferredKeys) {
    const found = num(record[key]);
    if (found !== null) return found;
  }
  return null;
}

function collectionEntries(value: unknown): Array<[string, Record<string, unknown>]> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const record = obj(entry);
      return record ? [[String(index), record] as [string, Record<string, unknown>]] : [];
    });
  }
  const record = obj(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, entry]) => {
    const child = obj(entry);
    return child ? [[key, child] as [string, Record<string, unknown>]] : [];
  });
}

function strengthForLiege(q: Query, vassalId: number): number {
  const sfl = q.at(`/living/${vassalId}/landed_data/strength_for_liege`);
  if (typeof sfl === "number") return sfl;
  const strength = q.at(`/living/${vassalId}/landed_data/strength`);
  return typeof strength === "number" ? strength : 0;
}

function titleMemberIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const entry of value) {
    const id = referenceNumber(entry, ["county", "title", "landed_title", "id", "value"]);
    if (id !== null) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Returns factions targeting the player + the set of their member char ids */
export function extractFactions(
  q: Query,
  loc: Localizer,
): { factions: FactionInfo[]; memberIds: Set<number> } {
  const playerId = q.at("/played_character/character") as number;
  const factionsObj = q.at("/faction_manager/factions") as Record<string, unknown> | undefined;

  const factions: FactionInfo[] = [];
  const memberIds = new Set<number>();

  if (!factionsObj || typeof factionsObj !== "object") return { factions, memberIds };

  for (const [factionIdText, value] of Object.entries(factionsObj)) {
    // Skip "none" strings (sparse placeholders)
    if (typeof value !== "object" || value === null) continue;
    const f = value as Record<string, unknown>;

    if ((f["target"] as number | undefined) !== playerId) continue;

    const members = f["members"] as Array<Record<string, unknown>> | undefined;
    const countyMemberIds = titleMemberIds(f["title_members"]);
    let characterMemberCount = 0;
    if (Array.isArray(members)) {
      characterMemberCount = members.length;
      for (const m of members) {
        const charId = m["character"];
        if (typeof charId === "number") memberIds.add(charId);
      }
    }

    const leaderId = referenceNumber(f["leader"], ["character", "id", "value"]);
    const leader = leaderId === null ? null : extractCharacter(q, loc, leaderId);
    const titleMembers = countyMemberIds
      .map((titleId) => extractCountyContext(q, loc, titleId))
      .filter((county): county is CountyContextInfo => county !== null);

    factions.push({
      id: Number.isFinite(Number(factionIdText)) ? Number(factionIdText) : null,
      type: typeof f["type"] === "string" ? f["type"] : String(f["type"] ?? ""),
      power: num(f["power"]),
      threshold: num(f["power_threshold"]) ?? null,
      discontent: num(f["discontent"]),
      members: characterMemberCount + countyMemberIds.length,
      leaderId,
      leaderName: leader?.name ?? null,
      leaderDynastyHouseId: leader?.dynastyHouseId ?? null,
      leaderDynastyHouseName: leader?.dynastyHouseName ?? null,
      titleMembers,
    });
  }

  return { factions, memberIds };
}

/** topN vassals by strengthForLiege; uses contracts plus de-facto title links */
export function extractVassals(
  q: Query,
  loc: Localizer,
  factionMemberIds: Set<number>,
  topN = 8,
): { vassals: VassalInfo[]; total: number } {
  const playerId = q.at("/played_character/character") as number;

  type VassalEntry = { id: number; strength: number };
  const byId = new Map<number, VassalEntry>();
  const addVassal = (vassalId: number): void => {
    if (vassalId === playerId || byId.has(vassalId)) return;
    byId.set(vassalId, { id: vassalId, strength: strengthForLiege(q, vassalId) });
  };

  // 1. Preferred source: contract IDs referenced by the player.
  const contractIds = numberList(q.at(`/living/${playerId}/landed_data/vassal_contracts`));
  for (const cid of contractIds) {
    const contract = obj(q.at(`/vassal_contracts/active/${cid}`));
    if (!contract) continue;
    const liegeId = referenceNumber(contract["liege"], ["character", "id", "value"]);
    const vassalId = referenceNumber(contract["vassal"], ["character", "id", "value"]);
    if ((liegeId === null || liegeId === playerId) && vassalId !== null) addVassal(vassalId);
  }

  // 2. Some live saves retain the global contract but do not mirror its ID in the
  // ruler's landed_data.vassal_contracts list. Scan the bounded active-contract DB too.
  for (const [, contract] of collectionEntries(q.at("/vassal_contracts/active"))) {
    const liegeId = referenceNumber(contract["liege"], ["character", "id", "value"]);
    if (liegeId !== playerId) continue;
    const vassalId = referenceNumber(contract["vassal"], ["character", "id", "value"]);
    if (vassalId !== null) addVassal(vassalId);
  }

  // 3. Fallback for governments/situations where a direct vassal does not have a
  // serialized vassal_contract entry (observed after granting a tribal county).
  // CK3 normally stores holder/de_facto_liege as numbers, but some parser/save layouts
  // expose a small reference object. Accept both without treating arbitrary nested
  // numbers as title links.
  const landedTitles = obj(q.at("/landed_titles/landed_titles"));
  if (landedTitles) {
    const playerHeldTitles = new Set(numberList(q.at(`/living/${playerId}/landed_data/domain`)));
    for (const [titleIdText, rawTitle] of Object.entries(landedTitles)) {
      const title = obj(rawTitle);
      const titleId = Number(titleIdText);
      if (!title || !Number.isFinite(titleId)) continue;
      const holder = referenceNumber(title["holder"], ["character", "id", "value"]);
      if (holder === playerId) playerHeldTitles.add(titleId);
    }

    if (playerHeldTitles.size > 0) {
      for (const rawTitle of Object.values(landedTitles)) {
        const title = obj(rawTitle);
        if (!title) continue;
        const holder = referenceNumber(title["holder"], ["character", "id", "value"]);
        const deFactoLiege = referenceNumber(title["de_facto_liege"], [
          "title",
          "landed_title",
          "id",
          "value",
        ]);
        if (holder === null || deFactoLiege === null) continue;
        if (!playerHeldTitles.has(deFactoLiege)) continue;
        addVassal(holder);
      }
    }
  }

  // 4. Sort desc by strength, take topN; record total before cap.
  const entries = [...byId.values()].sort((a, b) => b.strength - a.strength);
  const total = entries.length;
  const topEntries = entries.slice(0, topN);
  const topIds = new Set(topEntries.map((e) => e.id));

  // 5. Council seat set
  const council = numberList(q.at(`/living/${playerId}/landed_data/council`));
  const councilSet = new Set(council);

  // 6. Single pass over active_opinions — accumulate only for topN vassals targeting player
  const activeOpinions =
    (q.at("/opinions/active_opinions") as Record<string, unknown>[] | undefined) ?? [];
  const opinionMap = new Map<number, number>();
  for (const entry of activeOpinions) {
    if (!entry || typeof entry !== "object") continue;
    if ((entry["target"] as number | undefined) !== playerId) continue;
    const owner = entry["owner"] as number | undefined;
    if (typeof owner !== "number" || !topIds.has(owner)) continue;
    const tempOpinion = entry["temporary_opinion"] as Record<string, unknown> | undefined;
    const value = tempOpinion?.["value"];
    if (typeof value !== "number") continue;
    opinionMap.set(owner, (opinionMap.get(owner) ?? 0) + value);
  }

  // 7. Build final vassal list with their held counties. This keeps granted frontier
  // counties visible after they leave the player's personal domain.
  const vassals = topEntries.map(({ id, strength }) => {
    const character = extractCharacter(q, loc, id);
    const raw = q.at(`/living/${id}/first_name`);
    const name = character?.name ?? (typeof raw === "string" ? raw : String(raw ?? id));
    return {
      id,
      name,
      dynastyHouseId: character?.dynastyHouseId ?? null,
      dynastyHouseName: character?.dynastyHouseName ?? null,
      strengthForLiege: strength,
      opinion: opinionMap.has(id) ? opinionMap.get(id)! : null,
      councilSeat: councilSet.has(id),
      inFaction: factionMemberIds.has(id),
      counties: countyContextsHeldBy(q, loc, id),
    };
  });
  return { vassals, total };
}
