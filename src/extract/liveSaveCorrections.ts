import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { MilitaryInfo } from "./military.js";
import type {
  OperationalArmyInfo,
  OperationalArmiesSummary,
} from "./operationalArmies.js";
import { resolveTitleName } from "./titleUtils.js";

type Obj = Record<string, unknown>;
type Primitive = string | number | boolean;

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstDirectNumber(record: Obj | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = num(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function numberArray(value: unknown): number[] {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
  );
}

function firstNumberForKeys(value: unknown, keys: Set<string>, depth = 0): number | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstNumberForKeys(entry, keys, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = obj(value);
  if (!record) return null;
  for (const [key, entry] of Object.entries(record)) {
    if (!keys.has(key)) continue;
    const found = num(entry);
    if (found !== null) return found;
  }
  for (const entry of Object.values(record)) {
    if (entry === null || typeof entry !== "object") continue;
    const found = firstNumberForKeys(entry, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function firstNumberArrayForKeys(value: unknown, keys: Set<string>, depth = 0): number[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstNumberArrayForKeys(entry, keys, depth + 1);
      if (found.length > 0) return found;
    }
    return [];
  }
  const record = obj(value);
  if (!record) return [];
  for (const [key, entry] of Object.entries(record)) {
    if (!keys.has(key)) continue;
    const found = numberArray(entry);
    if (found.length > 0) return [...new Set(found)];
  }
  for (const entry of Object.values(record)) {
    if (entry === null || typeof entry !== "object") continue;
    const found = firstNumberArrayForKeys(entry, keys, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

function collectPrimitiveHints(
  value: unknown,
  prefix: string,
  output: Record<string, Primitive>,
  depth = 0,
  limit = 96,
): void {
  if (depth > 4 || Object.keys(output).length >= limit || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output[prefix || "value"] = value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectPrimitiveHints(entry, `${prefix}[${index}]`, output, depth + 1, limit),
    );
    return;
  }
  const record = obj(value);
  if (!record) return;
  for (const [key, entry] of Object.entries(record)) {
    if (Object.keys(output).length >= limit) break;
    collectPrimitiveHints(entry, prefix ? `${prefix}.${key}` : key, output, depth + 1, limit);
  }
}

function provinceTitleMap(q: Query): Map<number, number> {
  const result = new Map<number, { titleId: number; score: number }>();
  const titles = obj(q.at("/landed_titles/landed_titles"));
  if (!titles) return new Map();

  for (const [idText, rawTitle] of Object.entries(titles)) {
    const title = obj(rawTitle);
    const titleId = Number(idText);
    if (!title || !Number.isFinite(titleId)) continue;
    const key = typeof title["key"] === "string" ? title["key"] : "";
    const score = key.startsWith("b_") ? 3 : key.startsWith("c_") ? 2 : 1;
    for (const field of ["province", "capital_province"]) {
      const provinceId = num(title[field]);
      if (provinceId === null) continue;
      const existing = result.get(provinceId);
      if (!existing || score > existing.score) result.set(provinceId, { titleId, score });
    }
  }

  return new Map([...result.entries()].map(([provinceId, value]) => [provinceId, value.titleId]));
}

function resolveProvinceName(
  q: Query,
  loc: Localizer,
  provinceMap: Map<number, number>,
  provinceId: number | null,
): string | null {
  if (provinceId === null) return null;
  const province = obj(q.at(`/provinces/${provinceId}`));
  if (province) {
    const explicitName = province["name"];
    if (typeof explicitName === "string" && explicitName.length > 0) return explicitName;
    const titleId = firstDirectNumber(province, ["title", "landed_title", "barony"]);
    if (titleId !== null) return resolveTitleName(q, loc, titleId);
  }
  const titleId = provinceMap.get(provinceId);
  return titleId === undefined ? null : resolveTitleName(q, loc, titleId);
}

function getUnitRecord(q: Query, army: Obj | null): { id: number | null; record: Obj | null } {
  const unitId = firstDirectNumber(army, ["unit"]);
  if (unitId === null) return { id: null, record: null };
  const record = obj(q.at(`/units/${unitId}`)) ?? obj(q.at(`/units/units/${unitId}`));
  return { id: unitId, record };
}

function warIdsByCharacter(q: Query, playerId: number): Map<number, number[]> {
  const result = new Map<number, number[]>();
  const activeWars = obj(q.at("/wars/active_wars"));
  if (!activeWars) return result;

  for (const [warIdText, rawWar] of Object.entries(activeWars)) {
    const war = obj(rawWar);
    const warId = Number(warIdText);
    if (!war || !Number.isFinite(warId)) continue;
    const attacker = obj(war["attacker"]);
    const defender = obj(war["defender"]);
    const attackerParticipants = Array.isArray(attacker?.["participants"])
      ? (attacker?.["participants"] as unknown[])
          .map((entry) => num(obj(entry)?.["character"]))
          .filter((entry): entry is number => entry !== null)
      : [];
    const defenderParticipants = Array.isArray(defender?.["participants"])
      ? (defender?.["participants"] as unknown[])
          .map((entry) => num(obj(entry)?.["character"]))
          .filter((entry): entry is number => entry !== null)
      : [];
    if (!attackerParticipants.includes(playerId) && !defenderParticipants.includes(playerId)) continue;

    for (const characterId of [...attackerParticipants, ...defenderParticipants]) {
      const existing = result.get(characterId) ?? [];
      if (!existing.includes(warId)) existing.push(warId);
      result.set(characterId, existing);
    }
  }
  return result;
}

export function correctMilitaryLiveFields(q: Query, military: MilitaryInfo): MilitaryInfo {
  const armyRegiments = obj(q.at("/army_regiments")) ?? obj(q.at("/armies/army_regiments"));
  const regiments = obj(q.at("/regiments")) ?? obj(q.at("/armies/regiments"));

  const correctedRegiments = military.menAtArms.regiments.map((regiment) => {
    const rawArmyRegiment = obj(armyRegiments?.[String(regiment.id)]);
    const cached = obj(rawArmyRegiment?.["cached"]);
    let current = regiment.current ?? firstDirectNumber(cached, ["current", "current_soldiers", "soldiers"]);
    let max = regiment.max ?? firstDirectNumber(cached, ["max", "max_soldiers", "maximum"]);

    for (const linkedId of regiment.linkedRegimentIds) {
      const linked = obj(regiments?.[String(linkedId)]);
      if (current === null) {
        current =
          firstDirectNumber(linked, ["current", "current_soldiers", "soldiers"]) ??
          firstNumberForKeys(linked?.["chunks"], new Set(["current", "current_soldiers", "soldiers"]));
      }
      if (max === null) {
        max =
          firstDirectNumber(linked, ["max", "max_soldiers", "maximum"]) ??
          firstNumberForKeys(linked?.["chunks"], new Set(["max", "max_soldiers", "maximum"]));
      }
    }

    return { ...regiment, current, max };
  });

  const totalCurrentSoldiers = correctedRegiments.reduce(
    (sum, regiment) => sum + (regiment.current ?? 0),
    0,
  );
  const allMaxKnown = correctedRegiments.length > 0 && correctedRegiments.every((r) => r.max !== null);
  const totalMaxSoldiers = allMaxKnown
    ? correctedRegiments.reduce((sum, regiment) => sum + (regiment.max ?? 0), 0)
    : null;
  const unattributedCurrentStrength =
    military.currentStrength !== null && military.levy !== null
      ? military.currentStrength - military.levy - totalCurrentSoldiers - military.champions.current
      : military.unattributedCurrentStrength;

  return {
    ...military,
    menAtArms: {
      ...military.menAtArms,
      regiments: correctedRegiments,
      totalCurrentSoldiers,
      totalMaxSoldiers,
    },
    unattributedCurrentStrength,
  };
}

function correctArmy(
  q: Query,
  loc: Localizer,
  provinceMap: Map<number, number>,
  warMap: Map<number, number[]>,
  army: OperationalArmyInfo,
): OperationalArmyInfo {
  const rawArmy = obj(q.at(`/armies/armies/${army.id}`));
  const { id: unitId, record: unit } = getUnitRecord(q, rawArmy);

  const locationProvinceId =
    army.locationProvinceId ??
    firstDirectNumber(unit, ["province", "location", "current_province", "current_location"]) ??
    firstNumberForKeys(unit, new Set(["current_province", "current_location", "location", "province"]));

  const destinationProvinceId =
    army.destinationProvinceId ??
    firstDirectNumber(unit, [
      "destination",
      "target_province",
      "movement_target",
      "movement_destination",
      "next_province",
    ]) ??
    firstNumberForKeys(
      unit,
      new Set(["destination", "target_province", "movement_target", "movement_destination", "next_province"]),
    );

  const movementPathProvinceIds =
    army.movementPathProvinceIds.length > 0
      ? army.movementPathProvinceIds
      : firstNumberArrayForKeys(unit, new Set(["movement_path", "path", "route", "provinces"]));

  const siegeId = army.siegeId ?? firstNumberForKeys(unit, new Set(["siege", "siege_id"]));
  const combatId = army.combatId ?? firstNumberForKeys(unit, new Set(["combat", "combat_id"]));
  const ownerWarIds = army.ownerId === null ? [] : warMap.get(army.ownerId) ?? [];
  const warIds = [...new Set([...army.warIds, ...ownerWarIds])];

  const diagnostics = { ...(army.diagnostics ?? {}) };
  if (
    unit &&
    (locationProvinceId === null || destinationProvinceId === null || combatId === null || siegeId === null)
  ) {
    collectPrimitiveHints(unit, `unit${unitId === null ? "" : `[${unitId}]`}`, diagnostics);
  }

  return {
    ...army,
    locationProvinceId,
    locationName: resolveProvinceName(q, loc, provinceMap, locationProvinceId),
    destinationProvinceId,
    destinationName: resolveProvinceName(q, loc, provinceMap, destinationProvinceId),
    movementPathProvinceIds,
    movementPathNames: movementPathProvinceIds.map((id) => resolveProvinceName(q, loc, provinceMap, id)),
    moving: army.moving || destinationProvinceId !== null || movementPathProvinceIds.length > 0,
    siegeId,
    combatId,
    warIds,
    diagnostics: Object.keys(diagnostics).length > 0 ? diagnostics : null,
  };
}

function invalidateInconsistentSinglePlayerArmyCount(
  q: Query,
  playerId: number,
  armies: OperationalArmyInfo[],
): OperationalArmyInfo[] {
  const playerArmies = armies.filter((army) => army.relation === "player");
  if (playerArmies.length !== 1) return armies;

  const playerArmy = playerArmies[0];
  const realmCurrentStrength = num(q.at(`/living/${playerId}/landed_data/current_strength`));
  if (playerArmy.currentSoldiers === null || realmCurrentStrength === null) return armies;

  const delta = Math.abs(realmCurrentStrength - playerArmy.currentSoldiers);
  const tolerance = Math.max(25, Math.round(realmCurrentStrength * 0.05));
  if (delta <= tolerance) return armies;

  return armies.map((army) => {
    if (army.id !== playerArmy.id) return army;
    const diagnostics = { ...(army.diagnostics ?? {}) };
    diagnostics["soldierCount.regimentAggregateEstimate"] = army.currentSoldiers as number;
    diagnostics["soldierCount.ownerCurrentStrength"] = realmCurrentStrength;
    diagnostics["soldierCount.reliable"] = false;
    diagnostics["soldierCount.warning"] =
      "Single player-army regiment aggregate conflicts with ruler current_strength; do not use as exact stack size.";
    return {
      ...army,
      currentSoldiers: null,
      maxSoldiers: null,
      diagnostics,
    };
  });
}

export function correctOperationalArmiesLiveFields(
  q: Query,
  loc: Localizer,
  summary: OperationalArmiesSummary,
): OperationalArmiesSummary {
  if (summary.source === "unavailable") return summary;
  const playerId = num(q.at("/played_character/character"));
  if (playerId === null) return summary;
  const provinceMap = provinceTitleMap(q);
  const warMap = warIdsByCharacter(q, playerId);
  const correctedArmies = summary.armies.map((army) => correctArmy(q, loc, provinceMap, warMap, army));
  return {
    ...summary,
    armies: invalidateInconsistentSinglePlayerArmyCount(q, playerId, correctedArmies),
  };
}
