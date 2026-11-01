import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { formatCk3Date } from "../format.js";
import { resolveTitleName } from "./titleUtils.js";
import { forEachWar } from "./scan.js";

export interface WarScoreEvent {
  /** Province where CK3 recorded a resolved battle/siege result. */
  provinceId: number | null;
  /** War-score contribution stored on the result record. */
  warScore: number | null;
  attackerWon: boolean | null;
  attackerInitiated: boolean | null;
}

export interface War {
  playerSide: "attacker" | "defender";
  cbType: string;
  targetTitle: string | null;
  /**
   * CK3's ticking_war_score is only the ticking objective-control component. It is NOT
   * the full player-visible war score, so keep the name explicit and nullable.
   */
  attackerTickingWarScore: number | null;
  defenderTickingWarScore: number | null;
  /** controls_all is only present/true when that side controls every war objective. */
  attackerControlsAllObjectives: boolean;
  defenderControlsAllObjectives: boolean;
  /** Resolved battle/siege records stored by CK3 for this war. */
  warScoreEvents: WarScoreEvent[];
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

type DiagnosticPrimitive = string | number | boolean;

export interface MenAtArmsRegimentInfo {
  /** ID in the global army_regiments save block. */
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
  /**
   * Small, sanitized set of primitive source fields. Emitted only when some useful
   * regiment detail is still unresolved, so a real save can teach us new CK3 layouts
   * without dumping an entire save section.
   */
  diagnostics: Record<string, DiagnosticPrimitive> | null;
}

export interface MenAtArmsSummary {
  /** Number of player-owned MAA army_regiment records recovered from the global save DB. */
  slotsUsed: number;
  /** Effective MAA slot cap depends on modifiers and is not reconstructed yet. */
  slotsMax: number | null;
  totalCurrentSoldiers: number;
  /** Null when at least one recovered regiment lacks a max value. */
  totalMaxSoldiers: number | null;
  regiments: MenAtArmsRegimentInfo[];
  /**
   * CK3 has used both top-level and armies-nested regiment databases across saves/tools.
   * Linking remains best-effort because global records vary by game version.
   */
  source: "global_armies_best_effort" | "unavailable";
}

export interface RallyPointSummary {
  /** Raw numeric references under played_character/rally_points. */
  references: number[];
  count: number;
  source: "played_character" | "unavailable";
}

export interface RaidRecordInfo {
  /** Key/index of the record in raid/raid. */
  id: string;
  /** Best-effort match against the player character or personally held title IDs. */
  playerRelevant: boolean;
  /** All numeric references in the record, useful until CK3 raid schema is fully mapped. */
  numericReferences: number[];
  /** Sanitized primitive fields only; nested paths are flattened. */
  fields: Record<string, DiagnosticPrimitive>;
}

export interface RaidSummary {
  activeCount: number;
  playerRelevantCount: number;
  /** Relevant records first, then other active records, capped to keep snapshots bounded. */
  records: RaidRecordInfo[];
  truncated: boolean;
  source: "raid_save" | "unavailable";
}

export interface MilitaryInfo {
  /** Raw realm-level mobilisation values stored in living/<ruler>/landed_data. */
  levy: number | null;
  strength: number | null;
  /** Realm mobilisation aggregate; NOT the soldier count of any particular raised stack. */
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
  /** Prevent consumers from treating landed_data current_strength as an army-stack count. */
  strengthScope: "realm_mobilisation_aggregate_not_stack_size";
  champions: ChampionSummary;
  menAtArms: MenAtArmsSummary;
  rallyPoints: RallyPointSummary;
  raids: RaidSummary;
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

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
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

function objectNodes(value: unknown, depth = 0): Obj[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => objectNodes(item, depth + 1));
  }
  const record = obj(value);
  if (!record) return [];
  return [
    record,
    ...Object.values(record).flatMap((entry) =>
      entry !== null && typeof entry === "object" ? objectNodes(entry, depth + 1) : [],
    ),
  ];
}

function firstDirectNumber(record: Obj, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function sumDirectNumbers(records: Obj[], keys: string[]): number | null {
  let found = false;
  let total = 0;
  for (const record of records) {
    const value = firstDirectNumber(record, keys);
    if (value === null) continue;
    found = true;
    total += value;
  }
  return found ? total : null;
}

/**
 * CK3 stores MAA strength on regiment chunks in current saves. Older saves could
 * collapse equal current/max soldier counts into a single `size` field, so size is a
 * compatibility fallback for both values. Top-level current/max remains supported for
 * synthetic and older layouts.
 */
function regimentStrength(armyRegiment: Obj, linkedRecords: Obj[]): {
  current: number | null;
  max: number | null;
} {
  const directCurrent = firstDirectNumber(armyRegiment, [
    "current",
    "current_soldiers",
    "soldiers",
  ]);
  const directMax = firstDirectNumber(armyRegiment, ["max", "max_soldiers", "maximum"]);

  const chunkNodes = objectNodes(armyRegiment["chunks"]);
  const chunkCurrent = sumDirectNumbers(chunkNodes, [
    "current",
    "current_soldiers",
    "soldiers",
    "men",
  ]);
  const chunkMax = sumDirectNumbers(chunkNodes, ["max", "max_soldiers", "maximum"]);
  const chunkSize = sumDirectNumbers(chunkNodes, ["size"]);

  const linkedCurrent = sumDirectNumbers(linkedRecords, [
    "current",
    "current_soldiers",
    "soldiers",
    "men",
  ]);
  const linkedMax = sumDirectNumbers(linkedRecords, ["max", "max_soldiers", "maximum"]);
  const linkedSize = sumDirectNumbers(linkedRecords, ["size"]);

  return {
    current: directCurrent ?? chunkCurrent ?? chunkSize ?? linkedCurrent ?? linkedSize,
    max: directMax ?? chunkMax ?? chunkSize ?? linkedMax ?? linkedSize,
  };
}

function findNumericField(
  value: unknown,
  keys: Set<string>,
  depth = 0,
): { field: string; id: number } | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumericField(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = obj(value);
  if (!record) return null;
  for (const [key, entryValue] of Object.entries(record)) {
    if (keys.has(key)) {
      const id = num(entryValue);
      if (id !== null) return { field: key, id };
    }
    if (entryValue !== null && typeof entryValue === "object") {
      const found = findNumericField(entryValue, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function collectPrimitiveHints(
  value: unknown,
  prefix: string,
  out: Record<string, DiagnosticPrimitive>,
  depth = 0,
  limit = 64,
): void {
  if (depth > 4 || Object.keys(out).length >= limit || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out[prefix || "value"] = value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectPrimitiveHints(item, `${prefix}[${index}]`, out, depth + 1, limit);
    });
    return;
  }
  const record = obj(value);
  if (!record) return;
  for (const [key, entryValue] of Object.entries(record)) {
    if (Object.keys(out).length >= limit) break;
    collectPrimitiveHints(
      entryValue,
      prefix ? `${prefix}.${key}` : key,
      out,
      depth + 1,
      limit,
    );
  }
}

function unresolvedRegimentDiagnostics(
  armyRegiment: Obj,
  linkedRecords: Obj[],
): Record<string, DiagnosticPrimitive> {
  const hints: Record<string, DiagnosticPrimitive> = {};
  collectPrimitiveHints(armyRegiment, "armyRegiment", hints);
  linkedRecords.forEach((record, index) => {
    collectPrimitiveHints(record, `linked[${index}]`, hints);
  });
  return hints;
}

function extractMenAtArms(q: Query, playerId: number, loc: Localizer): MenAtArmsSummary {
  // Prefer top-level DBs seen in current campaign saves, retain /armies/* as fallback.
  const armyRegiments = obj(q.at("/army_regiments")) ?? obj(q.at("/armies/army_regiments"));
  const regiments = obj(q.at("/regiments")) ?? obj(q.at("/armies/regiments"));
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
    if (!type) continue; // levies/knights do not carry a MAA type key

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

    const { current, max } = regimentStrength(armyRegiment, linkedRecords);

    const stationKeys = new Set([
      "stationed_title",
      "stationed_holding",
      "stationed_barony",
      "stationed_province",
      "stationed_at",
      "stationed",
      "station",
    ]);
    let stationed: StationedReference | null = null;
    for (const record of [armyRegiment, ...linkedRecords]) {
      const station = findNumericField(record, stationKeys);
      if (!station) continue;
      const titleKey = q.at(`/landed_titles/landed_titles/${station.id}/key`);
      stationed = {
        field: station.field,
        id: station.id,
        titleName: typeof titleKey === "string" ? resolveTitleName(q, loc, station.id) : null,
      };
      break;
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
      diagnostics:
        current === null || max === null || stationed === null
          ? unresolvedRegimentDiagnostics(armyRegiment, linkedRecords)
          : null,
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

function collectionEntries(value: unknown): Array<[string, Obj]> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const record = obj(entry);
      return record ? [[String(index), record] as [string, Obj]] : [];
    });
  }
  const record = obj(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, entry]) => {
    const child = obj(entry);
    return child ? [[key, child] as [string, Obj]] : [];
  });
}

function extractRaids(q: Query, playerId: number): RaidSummary {
  const rawRaids = q.at("/raid/raid");
  if (rawRaids === undefined) {
    return {
      activeCount: 0,
      playerRelevantCount: 0,
      records: [],
      truncated: false,
      source: "unavailable",
    };
  }

  const domainIds = new Set(numberList(q.at(`/living/${playerId}/landed_data/domain`)));
  const records = collectionEntries(rawRaids).map(([id, record]): RaidRecordInfo => {
    const numericRefs = unique(numericReferences(record));
    const playerRelevant =
      numericRefs.includes(playerId) || numericRefs.some((reference) => domainIds.has(reference));
    const fields: Record<string, DiagnosticPrimitive> = {};
    collectPrimitiveHints(record, "", fields, 0, 48);
    return {
      id,
      playerRelevant,
      numericReferences: numericRefs,
      fields,
    };
  });

  records.sort((a, b) => Number(b.playerRelevant) - Number(a.playerRelevant));
  const maxRecords = 25;
  return {
    activeCount: records.length,
    playerRelevantCount: records.filter((record) => record.playerRelevant).length,
    records: records.slice(0, maxRecords),
    truncated: records.length > maxRecords,
    source: "raid_save",
  };
}

function extractWarScoreEvents(war: Obj): WarScoreEvent[] {
  const rawResults = war["battle_results"];
  if (!Array.isArray(rawResults)) return [];
  return rawResults.flatMap((rawResult): WarScoreEvent[] => {
    const result = obj(rawResult);
    if (!result) return [];
    return [
      {
        provinceId: num(result["province"]),
        warScore: num(result["war_score"]),
        attackerWon: bool(result["attacker_won"]),
        attackerInitiated: bool(result["attacker_initiated"]),
      },
    ];
  });
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
  const raids = extractRaids(q, playerId);

  const unattributedCurrentStrength =
    currentStrength !== null && levy !== null && menAtArms.source !== "unavailable"
      ? currentStrength - levy - menAtArms.totalCurrentSoldiers - champions.current
      : null;

  const wars: War[] = [];

  forEachWar(q, playerId, (playerSide, war) => {
    const attackerData = obj(war["attacker"]);
    const defenderData = obj(war["defender"]);

    const cb = obj(war["casus_belli"]);
    const cbType = typeof cb?.["type"] === "string" ? (cb["type"] as string) : "";

    const targetedTitles = (cb?.["targeted_titles"] as number[] | undefined) ?? [];
    const firstTitleId = targetedTitles[0];
    const targetTitle = firstTitleId !== undefined ? resolveTitleName(q, loc, firstTitleId) : null;

    const attackerTickingWarScore = num(attackerData?.["ticking_war_score"]);
    const defenderTickingWarScore = num(defenderData?.["ticking_war_score"]);
    const attackerControlsAllObjectives = bool(attackerData?.["controls_all"]) ?? false;
    const defenderControlsAllObjectives = bool(defenderData?.["controls_all"]) ?? false;
    const warScoreEvents = extractWarScoreEvents(war);

    const startDate = formatCk3Date(war["start_date"]);

    wars.push({
      playerSide,
      cbType,
      targetTitle,
      attackerTickingWarScore,
      defenderTickingWarScore,
      attackerControlsAllObjectives,
      defenderControlsAllObjectives,
      warScoreEvents,
      startDate,
    });
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
    strengthScope: "realm_mobilisation_aggregate_not_stack_size",
    champions,
    menAtArms,
    rallyPoints,
    raids,
    unattributedCurrentStrength,
    wars,
  };
}
