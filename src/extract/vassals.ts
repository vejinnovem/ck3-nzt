import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";

export interface FactionInfo {
  type: string;
  power: number | null;
  threshold: number | null;
  discontent: number | null;
  members: number;
  leaderName: string | null;
}
export interface VassalInfo {
  id: number;
  name: string;
  strengthForLiege: number;
  opinion: number | null;
  councilSeat: boolean;
  inFaction: boolean;
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

function strengthForLiege(q: Query, vassalId: number): number {
  const sfl = q.at(`/living/${vassalId}/landed_data/strength_for_liege`);
  if (typeof sfl === "number") return sfl;
  const strength = q.at(`/living/${vassalId}/landed_data/strength`);
  return typeof strength === "number" ? strength : 0;
}

/** Returns factions targeting the player + the set of their member char ids */
export function extractFactions(
  q: Query,
  loc: Localizer,
): { factions: FactionInfo[]; memberIds: Set<number> } {
  void loc;
  const playerId = q.at("/played_character/character") as number;
  const factionsObj = q.at("/faction_manager/factions") as Record<string, unknown> | undefined;

  const factions: FactionInfo[] = [];
  const memberIds = new Set<number>();

  if (!factionsObj || typeof factionsObj !== "object") return { factions, memberIds };

  for (const value of Object.values(factionsObj)) {
    // Skip "none" strings (sparse placeholders)
    if (typeof value !== "object" || value === null) continue;
    const f = value as Record<string, unknown>;

    if ((f["target"] as number | undefined) !== playerId) continue;

    // Collect character member ids
    const members = f["members"] as Array<Record<string, unknown>> | undefined;
    const titleMembers = f["title_members"] as unknown[] | undefined;
    // FIX H: count title_members (counties) for peasant factions; only add character ids to memberIds
    let memberCount = 0;
    if (Array.isArray(members)) {
      memberCount = members.length;
      for (const m of members) {
        const charId = m["character"];
        if (typeof charId === "number") memberIds.add(charId);
      }
    } else if (Array.isArray(titleMembers)) {
      memberCount = titleMembers.length;
      // title_members are county ids, not character ids — do NOT add to memberIds
    }

    // Resolve leader name
    const leaderId = f["leader"];
    let leaderName: string | null = null;
    if (typeof leaderId === "number") {
      const raw = q.at(`/living/${leaderId}/first_name`);
      leaderName = typeof raw === "string" ? raw : null;
    }

    factions.push({
      type: typeof f["type"] === "string" ? f["type"] : String(f["type"] ?? ""),
      power: num(f["power"]),
      threshold: num(f["power_threshold"]) ?? null,
      discontent: num(f["discontent"]),
      members: memberCount,
      leaderName,
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
  void loc;
  const playerId = q.at("/played_character/character") as number;

  type VassalEntry = { id: number; strength: number };
  const byId = new Map<number, VassalEntry>();
  const addVassal = (vassalId: number): void => {
    if (vassalId === playerId || byId.has(vassalId)) return;
    byId.set(vassalId, { id: vassalId, strength: strengthForLiege(q, vassalId) });
  };

  // 1. Preferred source: explicit vassal contracts.
  const contractIds = numberList(q.at(`/living/${playerId}/landed_data/vassal_contracts`));
  for (const cid of contractIds) {
    const contract = obj(q.at(`/vassal_contracts/active/${cid}`));
    if (!contract) continue;
    const vassalId = num(contract["vassal"]);
    if (vassalId !== null) addVassal(vassalId);
  }

  // 2. Fallback for governments/situations where a direct vassal does not have a
  // serialized vassal_contract entry (observed after granting a tribal county).
  // A title held by someone else whose de-facto liege is one of the player's held
  // titles identifies that holder as a direct vassal. Deduplicate by character.
  const playerDomain = new Set(numberList(q.at(`/living/${playerId}/landed_data/domain`)));
  const landedTitles = obj(q.at("/landed_titles/landed_titles"));
  if (playerDomain.size > 0 && landedTitles) {
    for (const rawTitle of Object.values(landedTitles)) {
      const title = obj(rawTitle);
      if (!title) continue;
      const holder = num(title["holder"]);
      const deFactoLiege = num(title["de_facto_liege"]);
      if (holder === null || deFactoLiege === null) continue;
      if (!playerDomain.has(deFactoLiege)) continue;
      addVassal(holder);
    }
  }

  // 3. Sort desc by strength, take topN; record total before cap.
  const entries = [...byId.values()].sort((a, b) => b.strength - a.strength);
  const total = entries.length;
  const topEntries = entries.slice(0, topN);
  const topIds = new Set(topEntries.map((e) => e.id));

  // 4. Council seat set
  const council = numberList(q.at(`/living/${playerId}/landed_data/council`));
  const councilSet = new Set(council);

  // 5. Single pass over active_opinions — accumulate only for topN vassals targeting player
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

  // 6. Build final vassal list
  const vassals = topEntries.map(({ id, strength }) => {
    const raw = q.at(`/living/${id}/first_name`);
    const name = typeof raw === "string" ? raw : String(raw ?? id);
    return {
      id,
      name,
      strengthForLiege: strength,
      opinion: opinionMap.has(id) ? opinionMap.get(id)! : null,
      councilSeat: councilSet.has(id),
      inFaction: factionMemberIds.has(id),
    };
  });
  return { vassals, total };
}
