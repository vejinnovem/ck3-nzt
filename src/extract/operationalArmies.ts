import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName } from "./titleUtils.js";

type Obj = Record<string, unknown>;
type Primitive = string | number | boolean;

export type ArmyRelation = "player" | "friendly" | "hostile" | "unknown";

export interface OperationalArmyInfo {
  id: number;
  relation: ArmyRelation;
  ownerId: number | null;
  ownerName: string | null;
  commanderId: number | null;
  commanderName: string | null;
  commanderMartial: number | null;
  commanderProwess: number | null;
  currentSoldiers: number | null;
  maxSoldiers: number | null;
  locationProvinceId: number | null;
  locationName: string | null;
  destinationProvinceId: number | null;
  destinationName: string | null;
  movementPathProvinceIds: number[];
  movementPathNames: Array<string | null>;
  moving: boolean;
  supply: number | null;
  maxSupply: number | null;
  siegeId: number | null;
  combatId: number | null;
  raiding: boolean | null;
  warIds: number[];
  diagnostics: Record<string, Primitive> | null;
}

export interface OperationalArmiesSummary {
  playerArmyCount: number;
  friendlyArmyCount: number;
  hostileArmyCount: number;
  armies: OperationalArmyInfo[];
  source: "armies_save_best_effort" | "unavailable";
}

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

function numberArray(value: unknown): number[] {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
  );
}

function firstDirectNumber(record: Obj, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function firstNumberForKeys(value: unknown, keys: Set<string>, depth = 0): number | null {
  if (depth > 5 || value === null || value === undefined) return null;
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
    if (keys.has(key)) {
      const found = num(entry);
      if (found !== null) return found;
    }
  }
  for (const entry of Object.values(record)) {
    if (entry === null || typeof entry !== "object") continue;
    const found = firstNumberForKeys(entry, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function numbersForKey(value: unknown, key: string, depth = 0): number[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => numbersForKey(entry, key, depth + 1));
  }
  const record = obj(value);
  if (!record) return [];
  const result: number[] = [];
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (entryKey === key) {
      const direct = num(entryValue);
      if (direct !== null) result.push(direct);
      result.push(...numberArray(entryValue));
    }
    if (entryValue !== null && typeof entryValue === "object") {
      result.push(...numbersForKey(entryValue, key, depth + 1));
    }
  }
  return result;
}

function objectNodes(value: unknown, depth = 0): Obj[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => objectNodes(entry, depth + 1));
  const record = obj(value);
  if (!record) return [];
  return [
    record,
    ...Object.values(record).flatMap((entry) =>
      entry !== null && typeof entry === "object" ? objectNodes(entry, depth + 1) : [],
    ),
  ];
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

function characterName(q: Query, characterId: number | null): string | null {
  if (characterId === null) return null;
  const living = q.at(`/living/${characterId}/first_name`);
  if (typeof living === "string") return living;
  const dead = q.at(`/dead_unprunable/${characterId}/first_name`);
  return typeof dead === "string" ? dead : null;
}

function characterSkill(q: Query, characterId: number | null, index: number): number | null {
  if (characterId === null) return null;
  const skill = q.at(`/living/${characterId}/skill`);
  if (!Array.isArray(skill)) return null;
  return num(skill[index]);
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
    for (const field of ["province", "capital_province", "capital"]) {
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

interface PlayerWarContext {
  activeWarIds: Set<number>;
  friendlyCharacters: Set<number>;
  hostileCharacters: Set<number>;
}

function playerWarContext(q: Query, playerId: number): PlayerWarContext {
  const context: PlayerWarContext = {
    activeWarIds: new Set<number>(),
    friendlyCharacters: new Set<number>([playerId]),
    hostileCharacters: new Set<number>(),
  };
  const activeWars = obj(q.at("/wars/active_wars"));
  if (!activeWars) return context;

  for (const [warIdText, rawWar] of Object.entries(activeWars)) {
    const war = obj(rawWar);
    if (!war) continue;
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

    const playerAttacks = attackerParticipants.includes(playerId);
    const playerDefends = defenderParticipants.includes(playerId);
    if (!playerAttacks && !playerDefends) continue;

    const warId = Number(warIdText);
    if (Number.isFinite(warId)) context.activeWarIds.add(warId);
    const friendly = playerAttacks ? attackerParticipants : defenderParticipants;
    const hostile = playerAttacks ? defenderParticipants : attackerParticipants;
    friendly.forEach((id) => context.friendlyCharacters.add(id));
    hostile.forEach((id) => context.hostileCharacters.add(id));
  }
  return context;
}

function regimentCurrent(record: Obj): number | null {
  const cached = obj(record["cached"]);
  const cachedCurrent = cached ? firstDirectNumber(cached, ["current", "current_soldiers", "soldiers"]) : null;
  if (cachedCurrent !== null) return cachedCurrent;
  const direct = firstDirectNumber(record, ["current", "current_soldiers", "soldiers"]);
  if (direct !== null) return direct;
  const chunks = objectNodes(record["chunks"]);
  let found = false;
  let total = 0;
  for (const chunk of chunks) {
    const current = firstDirectNumber(chunk, ["current", "current_soldiers", "soldiers", "men", "size"]);
    if (current === null) continue;
    found = true;
    total += current;
  }
  return found ? total : null;
}

function regimentMax(record: Obj): number | null {
  const cached = obj(record["cached"]);
  const cachedMax = cached ? firstDirectNumber(cached, ["max", "max_soldiers", "maximum"]) : null;
  if (cachedMax !== null) return cachedMax;
  const direct = firstDirectNumber(record, ["max", "max_soldiers", "maximum"]);
  if (direct !== null) return direct;
  const chunks = objectNodes(record["chunks"]);
  let found = false;
  let total = 0;
  for (const chunk of chunks) {
    const maximum = firstDirectNumber(chunk, ["max", "max_soldiers", "maximum", "size"]);
    if (maximum === null) continue;
    found = true;
    total += maximum;
  }
  return found ? total : null;
}

function attachedArmyRegiments(armyRegiments: Obj | null, armyId: number): Obj[] {
  if (!armyRegiments) return [];
  return Object.values(armyRegiments)
    .map((entry) => obj(entry))
    .filter((entry): entry is Obj => entry !== null)
    .filter((entry) => firstDirectNumber(entry, ["army"]) === armyId);
}

function ownerIdsForArmy(army: Obj, attached: Obj[], regiments: Obj | null): number[] {
  const ownerIds = [
    ...numbersForKey(army, "owner"),
    ...numbersForKey(army, "controller"),
    ...numbersForKey(army, "character"),
    ...attached.flatMap((record) => numbersForKey(record, "owner")),
  ];

  if (regiments) {
    for (const armyRegiment of attached) {
      for (const regimentId of numbersForKey(armyRegiment, "regiment")) {
        const regiment = obj(regiments[String(regimentId)]);
        if (regiment) ownerIds.push(...numbersForKey(regiment, "owner"));
      }
    }
  }
  return unique(ownerIds);
}

function chooseOwner(
  ownerIds: number[],
  playerId: number,
  friendly: Set<number>,
  hostile: Set<number>,
): number | null {
  if (ownerIds.includes(playerId)) return playerId;
  const friendlyOwner = ownerIds.find((id) => friendly.has(id));
  if (friendlyOwner !== undefined) return friendlyOwner;
  const hostileOwner = ownerIds.find((id) => hostile.has(id));
  if (hostileOwner !== undefined) return hostileOwner;
  return ownerIds[0] ?? null;
}

function relationForOwner(
  ownerId: number | null,
  playerId: number,
  friendly: Set<number>,
  hostile: Set<number>,
): ArmyRelation {
  if (ownerId === playerId) return "player";
  if (ownerId !== null && friendly.has(ownerId)) return "friendly";
  if (ownerId !== null && hostile.has(ownerId)) return "hostile";
  return "unknown";
}

function movementPath(army: Obj): number[] {
  for (const key of ["movement_path", "path", "route"]) {
    const values = numberArray(army[key]);
    if (values.length > 0) return unique(values);
  }
  const movement = obj(army["movement"]);
  if (movement) {
    for (const key of ["path", "route", "provinces"]) {
      const values = numberArray(movement[key]);
      if (values.length > 0) return unique(values);
    }
  }
  return [];
}

export function extractOperationalArmies(q: Query, loc: Localizer): OperationalArmiesSummary {
  const playerId = num(q.at("/played_character/character"));
  if (playerId === null) {
    return {
      playerArmyCount: 0,
      friendlyArmyCount: 0,
      hostileArmyCount: 0,
      armies: [],
      source: "unavailable",
    };
  }

  const armyDb = obj(q.at("/armies/armies"));
  if (!armyDb) {
    return {
      playerArmyCount: 0,
      friendlyArmyCount: 0,
      hostileArmyCount: 0,
      armies: [],
      source: "unavailable",
    };
  }

  const armyRegiments = obj(q.at("/army_regiments")) ?? obj(q.at("/armies/army_regiments"));
  const regiments = obj(q.at("/regiments")) ?? obj(q.at("/armies/regiments"));
  const warContext = playerWarContext(q, playerId);
  const provinceMap = provinceTitleMap(q);
  const result: OperationalArmyInfo[] = [];

  for (const [armyIdText, rawArmy] of Object.entries(armyDb)) {
    const army = obj(rawArmy);
    const armyId = Number(armyIdText);
    if (!army || !Number.isFinite(armyId)) continue;

    const attached = attachedArmyRegiments(armyRegiments, armyId);
    const ownerIds = ownerIdsForArmy(army, attached, regiments);
    const ownerId = chooseOwner(
      ownerIds,
      playerId,
      warContext.friendlyCharacters,
      warContext.hostileCharacters,
    );
    const relation = relationForOwner(
      ownerId,
      playerId,
      warContext.friendlyCharacters,
      warContext.hostileCharacters,
    );
    const warIds = unique([
      ...numbersForKey(army, "war"),
      ...attached.flatMap((record) => numbersForKey(record, "war")),
    ]).filter((id) => warContext.activeWarIds.has(id));

    if (relation === "unknown" && warIds.length === 0) continue;

    const directCurrent = firstDirectNumber(army, ["current_soldiers", "soldiers", "current"]);
    const regimentCurrentValues = attached
      .map(regimentCurrent)
      .filter((value): value is number => value !== null);
    const currentSoldiers =
      directCurrent ??
      (regimentCurrentValues.length > 0
        ? regimentCurrentValues.reduce((sum, value) => sum + value, 0)
        : null);

    const directMax = firstDirectNumber(army, ["max_soldiers", "maximum", "max"]);
    const regimentMaxValues = attached
      .map(regimentMax)
      .filter((value): value is number => value !== null);
    const maxSoldiers =
      directMax ??
      (regimentMaxValues.length > 0
        ? regimentMaxValues.reduce((sum, value) => sum + value, 0)
        : null);

    const commanderId =
      firstDirectNumber(army, ["commander", "leader"]) ??
      firstNumberForKeys(army, new Set(["commander"]));

    const locationProvinceId =
      firstDirectNumber(army, ["location", "current_location", "province", "current_province"]) ??
      firstNumberForKeys(army, new Set(["current_location", "location"]));

    const movement = obj(army["movement"]);
    const destinationProvinceId =
      firstDirectNumber(army, [
        "destination",
        "target_province",
        "movement_target",
        "movement_destination",
        "next_province",
      ]) ??
      (movement
        ? firstDirectNumber(movement, [
            "destination",
            "target",
            "target_province",
            "next_province",
            "to",
          ])
        : null);

    const path = movementPath(army);
    const supplyObject = obj(army["supply"]);
    const supply =
      firstDirectNumber(army, ["current_supply", "supply"]) ??
      (supplyObject ? firstDirectNumber(supplyObject, ["current", "value", "supply"]) : null);
    const maxSupply =
      firstDirectNumber(army, ["max_supply", "supply_limit"]) ??
      (supplyObject ? firstDirectNumber(supplyObject, ["max", "maximum", "limit"]) : null);

    const siegeId =
      firstDirectNumber(army, ["siege", "siege_id"]) ??
      firstNumberForKeys(army, new Set(["siege"]));
    const combatId =
      firstDirectNumber(army, ["combat", "combat_id"]) ??
      firstNumberForKeys(army, new Set(["combat"]));
    const raiding =
      bool(army["raiding"]) ??
      bool(army["is_raiding"]) ??
      (num(army["raid"]) !== null ? true : null);

    const hints: Record<string, Primitive> = {};
    if (
      ownerId === null ||
      currentSoldiers === null ||
      locationProvinceId === null ||
      destinationProvinceId === null
    ) {
      collectPrimitiveHints(army, "army", hints);
    }

    result.push({
      id: armyId,
      relation,
      ownerId,
      ownerName: characterName(q, ownerId),
      commanderId,
      commanderName: characterName(q, commanderId),
      commanderMartial: characterSkill(q, commanderId, 1),
      commanderProwess: characterSkill(q, commanderId, 5),
      currentSoldiers,
      maxSoldiers,
      locationProvinceId,
      locationName: resolveProvinceName(q, loc, provinceMap, locationProvinceId),
      destinationProvinceId,
      destinationName: resolveProvinceName(q, loc, provinceMap, destinationProvinceId),
      movementPathProvinceIds: path,
      movementPathNames: path.map((id) => resolveProvinceName(q, loc, provinceMap, id)),
      moving: destinationProvinceId !== null || path.length > 0 || movement !== null,
      supply,
      maxSupply,
      siegeId,
      combatId,
      raiding,
      warIds,
      diagnostics: Object.keys(hints).length > 0 ? hints : null,
    });
  }

  const relationOrder: Record<ArmyRelation, number> = {
    player: 0,
    friendly: 1,
    hostile: 2,
    unknown: 3,
  };
  result.sort((a, b) => relationOrder[a.relation] - relationOrder[b.relation] || a.id - b.id);

  return {
    playerArmyCount: result.filter((army) => army.relation === "player").length,
    friendlyArmyCount: result.filter((army) => army.relation === "friendly").length,
    hostileArmyCount: result.filter((army) => army.relation === "hostile").length,
    armies: result,
    source: "armies_save_best_effort",
  };
}
