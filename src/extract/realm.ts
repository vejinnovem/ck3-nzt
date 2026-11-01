import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { extractCharacter } from "./characters.js";
import { extractCountyContext, type CountyContextInfo } from "./countyContext.js";
import { titleTierFromKey } from "./titleUtils.js";

type Obj = Record<string, unknown>;

export interface RealmCountyInfo extends CountyContextInfo {
  heldByPlayer: boolean;
  holderDynastyHouseId: number | null;
  holderDynastyHouseName: string | null;
  /** County -> ... -> a title personally held by the player. Includes the county itself. */
  deFactoPathToPlayer: number[];
}

export interface PlayerRealmInfo {
  playerId: number;
  playerHeldTitleIds: number[];
  countyCount: number;
  playerHeldCountyCount: number;
  vassalHeldCountyCount: number;
  counties: RealmCountyInfo[];
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

/**
 * Extract every county in the player's de-facto realm, irrespective of geography,
 * culture, de-jure kingdom or campaign start. Realm membership is derived from the
 * landed-title de-facto graph and titles actually held by the played character.
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
      source: "de_facto_title_graph",
      limitation: "landed_titles database unavailable",
    };
  }

  const playerHeldTitleIds = new Set(numberList(q.at(`/living/${playerId}/landed_data/domain`)));
  for (const [idText, rawTitle] of Object.entries(titles)) {
    const titleId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(titleId) || !title) continue;
    const holderId = referenceNumber(title["holder"], ["character", "id", "value"]);
    if (holderId === playerId) playerHeldTitleIds.add(titleId);
  }

  const counties: RealmCountyInfo[] = [];
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

  return {
    playerId,
    playerHeldTitleIds: [...playerHeldTitleIds].sort((a, b) => a - b),
    countyCount: counties.length,
    playerHeldCountyCount,
    vassalHeldCountyCount: counties.length - playerHeldCountyCount,
    counties,
    source: "de_facto_title_graph",
    limitation:
      "Realm membership follows serialized de_facto_liege title links. If a mod stores vassalage outside that graph, affected counties can be missing until a mod-specific fallback is added.",
  };
}
