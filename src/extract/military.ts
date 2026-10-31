import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { formatCk3Date } from "../format.js";
import { resolveTitleName } from "./titleUtils.js";
import { forEachWar } from "./scan.js";

export interface War {
  playerSide: "attacker" | "defender";
  cbType: string;
  targetTitle: string | null;
  attackerScore: number;
  defenderScore: number;
  startDate: string;
}

export interface ChampionSummary {
  /** Character IDs stored in living/<ruler>/playable_data/knights. */
  ids: number[];
  current: number;
  /** Effective champion limit depends on modifiers and is not reconstructed yet. */
  max: number | null;
}

export interface StationedReference {
  /** Raw CK3 field name. Kept because the referenced namespace varies by game version. */
  field: string;
  id: number;
  /** Filled only when the reference is also a landed-title ID. */
  titleName: string | null;
}

export interface MenAtArmsRegimentInfo {
  /** ID in armies/army_regiments. */
  id: number;
  /** CK3 Men-at-Arms type key, e.g. bowmen. */
  type: string;
  ownerId: number;
  current: number | null;
  max: number | null;
  linkedRegimentIds: number[];
  originTitleIds: number[];
  owningTitleIds: number[];
  stationed: StationedReference | null;
}

export interface MenAtArmsSummary {
  /** Number of player-owned MAA army_regiment records recovered from the global armies DB. */
  slotsUsed: number;
  /** Effective MAA slot cap depends on modifiers and is not reconstructed yet. */
  slotsMax: number | null;
  totalCurrentSoldiers: number;
  /** Null when at least one recovered regiment lacks a max value. */
  totalMaxSoldiers: number | null;
  regiments: MenAtArmsRegimentInfo[];
  /**
   * CK3 stores regiments globally rather than cleanly under the ruler. We link
   * armies/army_regiments -> chunks/regiment -> armies/regiments.owner. This is
   * intentionally marked best-effort so callers do not treat missing global
   * records as proof that the ruler has no MAA.
   */
  source: "global_armies_best_effort" | "unavailable";
}

export interface RallyPointSummary {
  /** Raw numeric references under played_character/rally_points. */
  references: number[];
  count: number;
  source: "played_character" | "unavailable";
}

export interface MilitaryInfo {
  /** Raw values stored in living/<ruler>/landed_data. */
  levy: number | null;
  strength: number | null;
  currentStrength: number | null;
  strengthWithoutHires: number | null;
  power: number | null;
  maxPower: number | null;
  /**
   * Player-visible strength after dynamic/static modifiers. Save-only extraction cannot
   * reconstruct this reliably yet, so null is intentional rather than pretending raw
   * landed_data strength equals the top-bar value.
   */
  effectiveStrength: number | null;
  strengthSource: "landed_data_raw";
  champions: ChampionSummary;
  menAtArms: MenAtArmsSummary;
  rallyPoints: RallyPointSummary;
  /**
   * Cross-check only: currentStrength - levies - recovered MAA - champions.
   * A non-zero value can represent hired/special troops or an incomplete MAA link.
   */
  unattributedCurrentStrength: number | null;
  wars: War[];
}

type Obj = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function numberList(value: unknown): number[] {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  );
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

/** Collect numeric values of fields with an exact key anywhere in a small record tree. */
function numbersForKey(value: unknown, key: string, depth = 0): number[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => numbersForKey(item, key, depth + 1));
  }
  const record = obj(value);
  if (!record) return [];
  const found: number[] = [];
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (entryKey === key && typeof entryValue === "number" && Number.isFinite(entryValue)) {
      found.push(entryValue);
    }
    if (entryValue !== null && typeof entryValue === "object") {
      found.push(...numbersForKey(entryValue, key, depth + 1));
    }
  }
  return found;
}

function numericReferences(value: unknown, depth = 0): number[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => numericReferences(item, depth + 1));
  }
  const record = obj(value);
  if (!record) return [];
  return Object.values(record).flatMap((entry) => numericReferences(entry, depth + 1));
}

function extractMenAtArms(q: Query, playerId: number, loc: Localizer): MenAtArmsSummary {
  const armyRegiments = obj(q.at("/armies/army_regiments"));
  const regiments = obj(q.at("/armies/regiments"));
  if (!armyRegiments || !regiments) {
    return {
      slotsUsed: 0,
      slotsMax: null,
      totalCurrentSoldiers: 0,
      totalMaxSoldiers: null,
      regiments: [],
      source: "unavailable",
    };
  }

  const result: MenAtArmsRegimentInfo[] = [];

  for (const [idText, rawArmyRegiment] of Object.entries(armyRegiments)) {
    const armyRegiment = obj(rawArmyRegiment);
    if (!armyRegiment) continue;
    const type = typeof armyRegiment["type"] === "string" ? armyRegiment["type"] : null;
    if (!type) continue;

    const linkedRegimentIds = unique(numbersForKey(armyRegiment, "regiment"));
    const linkedRecords = linkedRegimentIds
      .map((id) => obj(regiments[String(id)]))
      .filter((entry): entry is Obj => entry !== null);
    const ownerIds = unique([
      ...numbersForKey(armyRegiment, "owner"),
      ...linkedRecords.flatMap((entry) => numbersForKey(entry, "owner")),
    ]);
    if (!ownerIds.includes(playerId)) continue;

    const id = Number(idText);
    if (!Number.isFinite(id)) continue;

    const originTitleIds = unique(
      linkedRecords.flatMap((entry) => numbersForKey(entry, "origin")),
    );
    const owningTitleIds = unique(
      linkedRecords.flatMap((entry) => numbersForKey(entry, "owning_title")),
    );

    const current = num(armyRegiment["current"]);
    const max = num(armyRegiment["max"]);
    let stationed: StationedReference | null = null;
    const stationKeys = [
      "stationed_title",
      "stationed_holding",
      "stationed_barony",
      "stationed_province",
      "stationed_at",
      "stationed",
    ];
    for (const record of [armyRegiment, ...linkedRecords]) {
      for (const key of stationKeys) {
        const stationId = num(record[key]);
        if (stationId === null) continue;
        const titleKey = q.at(`/landed_titles/landed_titles/${stationId}/key`);
        stationed = {
          field: key,
          id: stationId,
          titleName: typeof titleKey === "string" ? resolveTitleName(q, loc, stationId) : null,
        };
        break;
      }
      if (stationed) break;
    }

    result.push({
      id,
      type,
      ownerId: playerId,
      current,
      max,
      linkedRegimentIds,
      originTitleIds,
      owningTitleIds,
      stationed,
    });
  }

  result.sort((a, b) => a.id - b.id);
  const allMaxKnown = result.length > 0 && result.every((regiment) => regiment.max !== null);
  return {
    slotsUsed: result.length,
    slotsMax: null,
    totalCurrentSoldiers: result.reduce((sum, regiment) => sum + (regiment.current ?? 0), 0),
    totalMaxSoldiers: allMaxKnown
      ? result.reduce((sum, regiment) => sum + (regiment.max ?? 0), 0)
      : null,
    regiments: result,
    source: "global_armies_best_effort",
  };
}

export function extractMilitary(q: Query, loc: Localizer): MilitaryInfo {
  const playerId = q.at("/played_character/character") as number;
  const landedData = `/living/${playerId}/landed_data`;

  const levy = num(q.at(`${landedData}/levy`));
  const strength = num(q.at(`${landedData}/strength`));
  const currentStrength = num(q.at(`${landedData}/current_strength`));
  const strengthWithoutHires = num(q.at(`${landedData}/strength_without_hires`));
  const power = num(q.at(`${landedData}/power`));
  const maxPower = num(q.at(`${landedData}/max_power`));

  const championIds = unique(numberList(q.at(`/living/${playerId}/playable_data/knights`)));
  const champions: ChampionSummary = {
    ids: championIds,
    current: championIds.length,
    max: null,
  };

  const menAtArms = extractMenAtArms(q, playerId, loc);
  const rawRallyPoints = q.at("/played_character/rally_points");
  const rallyReferences = unique(numericReferences(rawRallyPoints));
  const rallyPoints: RallyPointSummary = {
    references: rallyReferences,
    count: rallyReferences.length,
    source: rawRallyPoints === undefined ? "unavailable" : "played_character",
  };

  const unattributedCurrentStrength =
    currentStrength !== null && levy !== null && menAtArms.source !== "unavailable"
      ? currentStrength - levy - menAtArms.totalCurrentSoldiers - champions.current
      : null;

  const wars: War[] = [];

  forEachWar(q, playerId, (playerSide, war) => {
    const attackerData = war["attacker"] as Record<string, unknown> | undefined;
    const defenderData = war["defender"] as Record<string, unknown> | undefined;

    const cb = war["casus_belli"] as Record<string, unknown> | undefined;
    const cbType = typeof cb?.["type"] === "string" ? (cb["type"] as string) : "";

    const targetedTitles = (cb?.["targeted_titles"] as number[] | undefined) ?? [];
    const firstTitleId = targetedTitles[0];
    const targetTitle = firstTitleId !== undefined ? resolveTitleName(q, loc, firstTitleId) : null;

    const attackerScore = num(attackerData?.["ticking_war_score"]) ?? 0;
    const defenderScore = num(defenderData?.["ticking_war_score"]) ?? 0;

    const startDate = formatCk3Date(war["start_date"]);

    wars.push({ playerSide, cbType, targetTitle, attackerScore, defenderScore, startDate });
  });

  return {
    levy,
    strength,
    currentStrength,
    strengthWithoutHires,
    power,
    maxPower,
    effectiveStrength: null,
    strengthSource: "landed_data_raw",
    champions,
    menAtArms,
    rallyPoints,
    unattributedCurrentStrength,
    wars,
  };
}
