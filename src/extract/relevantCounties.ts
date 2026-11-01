import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { DiplomacyInfo } from "./diplomacy.js";
import { extractCountyContext, type CountyContextInfo } from "./countyContext.js";
import type { PlayerRealmInfo } from "./realm.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

type Obj = Record<string, unknown>;

export type CountyRelevance =
  | "player_realm"
  | "same_de_jure_kingdom"
  | "ally_realm"
  | "truce_realm"
  | "hostile_opinion_realm"
  | "active_war_enemy_realm";

export interface RelevantCountyInfo extends CountyContextInfo {
  realmTitleId: number | null;
  realmName: string | null;
  realmRulerId: number | null;
  relevance: CountyRelevance[];
}

export interface RelevantCountiesInfo {
  countyCount: number;
  countsByRelevance: Record<CountyRelevance, number>;
  counties: RelevantCountyInfo[];
  exactAdjacencyAvailable: false;
  source: "title_graph_relations_de_jure_and_wars";
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

function titleRef(value: unknown): number | null {
  return referenceNumber(value, ["title", "landed_title", "id", "value"]);
}

function titleKey(q: Query, titleId: number): string {
  const value = q.at(`/landed_titles/landed_titles/${titleId}/key`);
  return typeof value === "string" ? value : "";
}

function deJureKingdomId(q: Query, startTitleId: number): number | null {
  const seen = new Set<number>();
  let current: number | null = startTitleId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    if (titleTierFromKey(titleKey(q, current)) === "kingdom") return current;
    current = titleRef(q.at(`/landed_titles/landed_titles/${current}/de_jure_liege`));
  }
  return null;
}

function topDeFactoTitleId(q: Query, startTitleId: number): number {
  const seen = new Set<number>();
  let current = startTitleId;
  while (!seen.has(current)) {
    seen.add(current);
    const liege = titleRef(q.at(`/landed_titles/landed_titles/${current}/de_facto_liege`));
    if (liege === null) return current;
    current = liege;
  }
  return current;
}

function holderIdForTitle(q: Query, titleId: number): number | null {
  return referenceNumber(q.at(`/landed_titles/landed_titles/${titleId}/holder`), [
    "character",
    "id",
    "value",
  ]);
}

function participantIds(side: unknown): number[] {
  const record = obj(side);
  const participants = record?.["participants"];
  if (!Array.isArray(participants)) return [];
  const result: number[] = [];
  for (const participant of participants) {
    const entry = obj(participant);
    const character = entry ? referenceNumber(entry["character"], ["id", "value"]) : null;
    if (character !== null) result.push(character);
  }
  return result;
}

function activeWarEnemyIds(q: Query, playerId: number): Set<number> {
  const result = new Set<number>();
  const wars = obj(q.at("/wars/active_wars"));
  if (!wars) return result;

  for (const rawWar of Object.values(wars)) {
    const war = obj(rawWar);
    if (!war) continue;
    const attackers = participantIds(war["attacker"]);
    const defenders = participantIds(war["defender"]);
    if (attackers.includes(playerId)) {
      for (const id of defenders) result.add(id);
    } else if (defenders.includes(playerId)) {
      for (const id of attackers) result.add(id);
    }
  }
  return result;
}

function emptyCounts(): Record<CountyRelevance, number> {
  return {
    player_realm: 0,
    same_de_jure_kingdom: 0,
    ally_realm: 0,
    truce_realm: 0,
    hostile_opinion_realm: 0,
    active_war_enemy_realm: 0,
  };
}

/**
 * Build a bounded strategic geography view around the player. Unlike PlayerRealmInfo,
 * this intentionally includes foreign counties when they are relevant through de-jure
 * structure, diplomacy or an active war. Exact physical adjacency is not claimed because
 * it requires static map/province-neighbour data rather than the save's title graph alone.
 */
export function extractRelevantCounties(
  q: Query,
  loc: Localizer,
  realm: PlayerRealmInfo | null,
  diplomacy: DiplomacyInfo,
): RelevantCountiesInfo {
  const playerId = num(q.at("/played_character/character"));
  const countsByRelevance = emptyCounts();
  if (playerId === null) {
    return {
      countyCount: 0,
      countsByRelevance,
      counties: [],
      exactAdjacencyAvailable: false,
      source: "title_graph_relations_de_jure_and_wars",
      limitation: "Played character is unavailable; no relevant-county scope could be built.",
    };
  }

  const titles = obj(q.at("/landed_titles/landed_titles"));
  if (!titles) {
    return {
      countyCount: 0,
      countsByRelevance,
      counties: [],
      exactAdjacencyAvailable: false,
      source: "title_graph_relations_de_jure_and_wars",
      limitation: "landed_titles database unavailable",
    };
  }

  const playerRealmCountyIds = new Set(realm?.counties.map((county) => county.titleId) ?? []);
  const allyIds = new Set(diplomacy.alliances.map((entry) => entry.id));
  const truceIds = new Set(diplomacy.truces.map((entry) => entry.id));
  const hostileOpinionIds = new Set(diplomacy.hostile.map((entry) => entry.id));
  const warEnemyIds = activeWarEnemyIds(q, playerId);

  const domain = numberList(q.at(`/living/${playerId}/landed_data/domain`));
  const primaryTitleId = domain[0] ?? null;
  const playerKingdomId = primaryTitleId === null ? null : deJureKingdomId(q, primaryTitleId);

  const counties: RelevantCountyInfo[] = [];
  for (const [idText, rawTitle] of Object.entries(titles)) {
    const titleId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(titleId) || !title) continue;
    const key = typeof title["key"] === "string" ? title["key"] : "";
    if (titleTierFromKey(key) !== "county") continue;

    const realmTitleId = topDeFactoTitleId(q, titleId);
    const realmRulerId = holderIdForTitle(q, realmTitleId) ?? holderIdForTitle(q, titleId);
    const relevance: CountyRelevance[] = [];

    if (playerRealmCountyIds.has(titleId)) relevance.push("player_realm");
    if (playerKingdomId !== null && deJureKingdomId(q, titleId) === playerKingdomId) {
      relevance.push("same_de_jure_kingdom");
    }
    if (realmRulerId !== null && allyIds.has(realmRulerId)) relevance.push("ally_realm");
    if (realmRulerId !== null && truceIds.has(realmRulerId)) relevance.push("truce_realm");
    if (realmRulerId !== null && hostileOpinionIds.has(realmRulerId)) {
      relevance.push("hostile_opinion_realm");
    }
    if (realmRulerId !== null && warEnemyIds.has(realmRulerId)) {
      relevance.push("active_war_enemy_realm");
    }
    if (relevance.length === 0) continue;

    const county = extractCountyContext(q, loc, titleId);
    if (!county) continue;
    for (const tag of relevance) countsByRelevance[tag] += 1;
    counties.push({
      ...county,
      realmTitleId,
      realmName: resolveTitleName(q, loc, realmTitleId),
      realmRulerId,
      relevance,
    });
  }

  counties.sort((a, b) => {
    const aEnemy = a.relevance.includes("active_war_enemy_realm") ? 0 : 1;
    const bEnemy = b.relevance.includes("active_war_enemy_realm") ? 0 : 1;
    if (aEnemy !== bEnemy) return aEnemy - bEnemy;
    const aPlayer = a.relevance.includes("player_realm") ? 0 : 1;
    const bPlayer = b.relevance.includes("player_realm") ? 0 : 1;
    if (aPlayer !== bPlayer) return aPlayer - bPlayer;
    return a.name.localeCompare(b.name);
  });

  return {
    countyCount: counties.length,
    countsByRelevance,
    counties,
    exactAdjacencyAvailable: false,
    source: "title_graph_relations_de_jure_and_wars",
    limitation:
      "Exact geographic neighbours are not yet derived because CK3 adjacency lives in static map/province data. This view includes the player's realm, same-de-jure-kingdom counties, allied realms, truce realms, hostile-opinion realms and active-war enemy realms.",
  };
}
