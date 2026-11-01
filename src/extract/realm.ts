import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { extractCharacter } from "./characters.js";
import { extractCountyContext, type CountyContextInfo } from "./countyContext.js";
import { forEachRelation } from "./scan.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

type Obj = Record<string, unknown>;

export interface RealmCountyInfo extends CountyContextInfo {
  heldByPlayer: boolean;
  holderDynastyHouseId: number | null;
  holderDynastyHouseName: string | null;
  /** County -> ... -> a title personally held by the player. Includes the county itself. */
  deFactoPathToPlayer: number[];
}

export type CountyRelevance =
  | "same_de_jure_kingdom"
  | "ally_realm"
  | "truce_realm"
  | "hostile_opinion_realm"
  | "active_war_enemy_realm";

export interface RelevantForeignCountyInfo extends CountyContextInfo {
  realmTitleId: number;
  realmName: string;
  realmRulerId: number | null;
  relevance: CountyRelevance[];
}

export interface PlayerRealmInfo {
  playerId: number;
  playerHeldTitleIds: number[];
  countyCount: number;
  playerHeldCountyCount: number;
  vassalHeldCountyCount: number;
  counties: RealmCountyInfo[];
  relevantForeignCountyCount: number;
  relevantForeignCounties: RelevantForeignCountyInfo[];
  relevantForeignCountsByReason: Record<CountyRelevance, number>;
  exactAdjacencyAvailable: false;
  source: "de_facto_title_graph";
  limitation: string | null;
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

function referenceNumber(value: unknown, keys: string[]): number | null {
  const direct = num(value);
  if (direct !== null) return direct;
  const record = obj(value);
  if (!record) return null;
  for (const key of keys) {
    const found = num(record[key]);
    if (found !== null) return found;
  }
  return null;
}

function titleIdRef(value: unknown): number | null {
  return referenceNumber(value, ["title", "landed_title", "id", "value"]);
}

function characterIdRef(value: unknown): number | null {
  return referenceNumber(value, ["character", "id", "value"]);
}

function titleKey(title: Obj | null): string {
  return title && typeof title["key"] === "string" ? title["key"] : "";
}

function pathToPlayerHeldTitle(
  titles: Obj,
  startTitleId: number,
  playerHeldTitleIds: Set<number>,
): number[] | null {
  const path: number[] = [];
  const visited = new Set<number>();
  let current: number | null = startTitleId;

  for (let depth = 0; depth < 16 && current !== null; depth += 1) {
    if (visited.has(current)) return null;
    visited.add(current);
    path.push(current);
    if (playerHeldTitleIds.has(current)) return path;

    const title = obj(titles[String(current)]);
    if (!title) return null;
    current = titleIdRef(title["de_facto_liege"]);
  }

  return null;
}

function deJureKingdomId(titles: Obj, startTitleId: number): number | null {
  const visited = new Set<number>();
  let current: number | null = startTitleId;
  for (let depth = 0; depth < 16 && current !== null; depth += 1) {
    if (visited.has(current)) return null;
    visited.add(current);
    const title = obj(titles[String(current)]);
    if (!title) return null;
    if (titleTierFromKey(titleKey(title)) === "kingdom") return current;
    current = titleIdRef(title["de_jure_liege"]);
  }
  return null;
}

function topDeFactoTitleId(titles: Obj, startTitleId: number): number {
  const visited = new Set<number>();
  let current = startTitleId;
  for (let depth = 0; depth < 16; depth += 1) {
    if (visited.has(current)) return current;
    visited.add(current);
    const title = obj(titles[String(current)]);
    if (!title) return current;
    const liege = titleIdRef(title["de_facto_liege"]);
    if (liege === null) return current;
    current = liege;
  }
  return current;
}

function characterHasRealm(q: Query, characterId: number): boolean {
  return numberList(q.at(`/living/${characterId}/landed_data/domain`)).length > 0;
}

function relationRealmSets(q: Query, playerId: number): {
  allies: Set<number>;
  truces: Set<number>;
} {
  const allies = new Set<number>();
  const truces = new Set<number>();
  forEachRelation(q, playerId, (otherId, entry) => {
    if (entry["alliances"] != null && characterHasRealm(q, otherId)) allies.add(otherId);
    if (entry["truce_0"] != null || entry["truce_1"] != null) truces.add(otherId);
  });
  return { allies, truces };
}

function hostileOpinionRealmIds(q: Query, playerId: number): Set<number> {
  const totals = new Map<number, number>();
  const opinions = q.at("/opinions/active_opinions");
  if (!Array.isArray(opinions)) return new Set();
  for (const raw of opinions) {
    const entry = obj(raw);
    if (!entry || num(entry["target"]) !== playerId) continue;
    const owner = num(entry["owner"]);
    if (owner === null || !characterHasRealm(q, owner)) continue;
    const temporary = obj(entry["temporary_opinion"]);
    const value = temporary ? num(temporary["value"]) : null;
    if (value === null) continue;
    totals.set(owner, (totals.get(owner) ?? 0) + value);
  }
  return new Set([...totals.entries()].filter(([, opinion]) => opinion < 0).map(([id]) => id));
}

function participantIds(side: unknown): number[] {
  const record = obj(side);
  const participants = record?.["participants"];
  if (!Array.isArray(participants)) return [];
  const result: number[] = [];
  for (const raw of participants) {
    const participant = obj(raw);
    if (!participant) continue;
    const id = characterIdRef(participant["character"]);
    if (id !== null) result.push(id);
  }
  return result;
}

function activeWarEnemyRealmIds(q: Query, playerId: number): Set<number> {
  const enemies = new Set<number>();
  const wars = obj(q.at("/wars/active_wars"));
  if (!wars) return enemies;
  for (const rawWar of Object.values(wars)) {
    const war = obj(rawWar);
    if (!war) continue;
    const attackers = participantIds(war["attacker"]);
    const defenders = participantIds(war["defender"]);
    const opposite = attackers.includes(playerId)
      ? defenders
      : defenders.includes(playerId)
        ? attackers
        : [];
    for (const id of opposite) {
      if (characterHasRealm(q, id)) enemies.add(id);
    }
  }
  return enemies;
}

function emptyRelevanceCounts(): Record<CountyRelevance, number> {
  return {
    same_de_jure_kingdom: 0,
    ally_realm: 0,
    truce_realm: 0,
    hostile_opinion_realm: 0,
    active_war_enemy_realm: 0,
  };
}

/**
 * Extract every county in the player's de-facto realm, irrespective of geography,
 * culture, de-jure kingdom or campaign start. Also expose foreign counties that are
 * strategically relevant through the player's de-jure kingdom, alliances, truces,
 * hostile opinions or active wars. Exact physical adjacency is deliberately not claimed
 * until static map/province-neighbour data is available.
 */
export function extractPlayerRealm(q: Query, loc: Localizer): PlayerRealmInfo | null {
  const playerId = num(q.at("/played_character/character"));
  if (playerId === null) return null;
  const titles = obj(q.at("/landed_titles/landed_titles"));
  if (!titles) {
    return {
      playerId,
      playerHeldTitleIds: [],
      countyCount: 0,
      playerHeldCountyCount: 0,
      vassalHeldCountyCount: 0,
      counties: [],
      relevantForeignCountyCount: 0,
      relevantForeignCounties: [],
      relevantForeignCountsByReason: emptyRelevanceCounts(),
      exactAdjacencyAvailable: false,
      source: "de_facto_title_graph",
      limitation: "landed_titles database unavailable",
    };
  }

  const playerHeldTitleIds = new Set(numberList(q.at(`/living/${playerId}/landed_data/domain`)));
  for (const [idText, rawTitle] of Object.entries(titles)) {
    const titleId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(titleId) || !title) continue;
    const holderId = characterIdRef(title["holder"]);
    if (holderId === playerId) playerHeldTitleIds.add(titleId);
  }

  const counties: RealmCountyInfo[] = [];
  const realmCountyIds = new Set<number>();
  for (const [idText, rawTitle] of Object.entries(titles)) {
    const titleId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(titleId) || !title) continue;
    if (titleTierFromKey(titleKey(title)) !== "county") continue;

    const path = pathToPlayerHeldTitle(titles, titleId, playerHeldTitleIds);
    if (!path) continue;

    const county = extractCountyContext(q, loc, titleId);
    if (!county) continue;
    const holder = county.holderId === null ? null : extractCharacter(q, loc, county.holderId);
    realmCountyIds.add(titleId);
    counties.push({
      ...county,
      heldByPlayer: county.holderId === playerId,
      holderDynastyHouseId: holder?.dynastyHouseId ?? null,
      holderDynastyHouseName: holder?.dynastyHouseName ?? null,
      deFactoPathToPlayer: path,
    });
  }

  counties.sort((a, b) => a.name.localeCompare(b.name));
  const playerHeldCountyCount = counties.filter((county) => county.heldByPlayer).length;

  const playerPrimaryTitleId = numberList(q.at(`/living/${playerId}/landed_data/domain`))[0] ?? null;
  const playerKingdomId =
    playerPrimaryTitleId === null ? null : deJureKingdomId(titles, playerPrimaryTitleId);
  const { allies, truces } = relationRealmSets(q, playerId);
  const hostileOpinionRealms = hostileOpinionRealmIds(q, playerId);
  const activeWarEnemies = activeWarEnemyRealmIds(q, playerId);
  const relevantForeignCountsByReason = emptyRelevanceCounts();
  const relevantForeignCounties: RelevantForeignCountyInfo[] = [];

  for (const [idText, rawTitle] of Object.entries(titles)) {
    const titleId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(titleId) || !title || realmCountyIds.has(titleId)) continue;
    if (titleTierFromKey(titleKey(title)) !== "county") continue;

    const realmTitleId = topDeFactoTitleId(titles, titleId);
    const realmTitle = obj(titles[String(realmTitleId)]);
    const realmRulerId = realmTitle ? characterIdRef(realmTitle["holder"]) : null;
    const relevance: CountyRelevance[] = [];
    if (playerKingdomId !== null && deJureKingdomId(titles, titleId) === playerKingdomId) {
      relevance.push("same_de_jure_kingdom");
    }
    if (realmRulerId !== null && allies.has(realmRulerId)) relevance.push("ally_realm");
    if (realmRulerId !== null && truces.has(realmRulerId)) relevance.push("truce_realm");
    if (realmRulerId !== null && hostileOpinionRealms.has(realmRulerId)) {
      relevance.push("hostile_opinion_realm");
    }
    if (realmRulerId !== null && activeWarEnemies.has(realmRulerId)) {
      relevance.push("active_war_enemy_realm");
    }
    if (relevance.length === 0) continue;

    const county = extractCountyContext(q, loc, titleId);
    if (!county) continue;
    for (const reason of relevance) relevantForeignCountsByReason[reason] += 1;
    relevantForeignCounties.push({
      ...county,
      realmTitleId,
      realmName: resolveTitleName(q, loc, realmTitleId),
      realmRulerId,
      relevance,
    });
  }

  relevantForeignCounties.sort((a, b) => {
    const aWar = a.relevance.includes("active_war_enemy_realm") ? 0 : 1;
    const bWar = b.relevance.includes("active_war_enemy_realm") ? 0 : 1;
    if (aWar !== bWar) return aWar - bWar;
    return a.name.localeCompare(b.name);
  });

  return {
    playerId,
    playerHeldTitleIds: [...playerHeldTitleIds].sort((a, b) => a - b),
    countyCount: counties.length,
    playerHeldCountyCount,
    vassalHeldCountyCount: counties.length - playerHeldCountyCount,
    counties,
    relevantForeignCountyCount: relevantForeignCounties.length,
    relevantForeignCounties,
    relevantForeignCountsByReason,
    exactAdjacencyAvailable: false,
    source: "de_facto_title_graph",
    limitation:
      "Realm membership follows serialized de_facto_liege title links. Relevant foreign counties additionally use de-jure structure, alliances, truces, hostile opinions and active wars. Exact geographic adjacency still requires static map/province-neighbour data.",
  };
}
