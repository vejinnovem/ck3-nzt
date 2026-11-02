import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { formatCk3Date } from "../format.js";
import { resolveDynastyHouseName } from "./characters.js";
import { forEachRelation } from "./scan.js";
import { activeSubjectContracts } from "./subjectContracts.js";
import { resolveTitleName } from "./titleUtils.js";

export interface DipRef {
  id: number;
  name: string;
  /** Characters whose marriage/betrothal/relationship created the alliance, when saved by CK3. */
  throughCharacterIds: number[];
}
export interface TruceRef {
  id: number;
  name: string;
  until: string;
  result: string;
}
export interface ThreatRef {
  id: number;
  name: string;
  opinion: number;
}

export interface TributaryRef {
  contractId: number;
  id: number;
  name: string;
  /** Player's side of the subject relationship. */
  playerRole: "suzerain" | "tributary";
  /** True when the counterpart's top-level held title is de-facto independent. */
  independentSubject: boolean;
  /** Serialized obligation level ids; names require static subject-contract data. */
  levels: number[];
  /** Why the extractor classified this subject contract as tributary. */
  classificationSource: "serialized_marker" | "independent_subject_contract";
  /** Matching serialized field paths, useful when Paradox changes the save schema. */
  evidence: string[];
}

export interface TributaryWarRef {
  warId: number | null;
  startDate: string | null;
  cbType: string | null;
  targetTitleIds: number[];
  targetTitles: string[];
  attackerIds: number[];
  attackerNames: string[];
  defenderIds: number[];
  defenderNames: string[];
  playerTributaryAttackerIds: number[];
  playerTributaryDefenderIds: number[];
  /** True when at least one of the player's tributaries fights on each side. */
  betweenPlayerTributaries: boolean;
  classification: "between_player_tributaries" | "player_tributary_vs_external";
}

export interface PuppetRef {
  id: number;
  name: string;
  type: "realm_priest" | "clerical_ruler" | "secular_ruler" | "unknown";
  /** Best-effort direction. Player-character markers are authoritative; pair relations are inferred. */
  playerRole: "puppeteer" | "puppet" | "unknown";
  source: "player_character" | "active_relations";
  /** Serialized field paths that caused the match. */
  evidence: string[];
}

export type PersonalRelationContext =
  | "direct_vassal"
  | "councillor"
  | "courtier"
  | "tributary"
  | "independent_ruler"
  | "landed";

export interface PersonalRelationRef {
  id: number;
  name: string;
  primaryTitle: string | null;
  dynastyHouseId: number | null;
  dynastyHouseName: string | null;
  relationTypes: string[];
  contexts: PersonalRelationContext[];
  evidence: string[];
}

export interface DiplomacyInfo {
  independent: boolean;
  /** Actual allied rulers/realms. Unlanded relatives used to create the alliance are excluded. */
  alliances: DipRef[];
  truces: TruceRef[];
  hostile: ThreatRef[]; // top-N lowest summed opinion of the player
  /** Independent subjects tied to the player by a CK3 subject contract. */
  tributaries: TributaryRef[];
  /** Every serialized active war involving at least one of the player's tributaries. */
  tributaryWars: TributaryWarRef[];
  /** Puppet relations involving the player, including the Realm Priest Puppet added in 1.20. */
  puppets: PuppetRef[];
  /**
   * Permanent scripted personal relations involving the player (rival/friend/etc.).
   * Optional for backwards compatibility with stored snapshots created before this field existed.
   */
  personalRelations?: PersonalRelationRef[];
}

const HOSTILE_CAP = 5;
const SPECIAL_SUBJECT_PATTERN = /(tribut|suzerain)/i;
const PUPPET_PATTERN = /(puppet|theological_agent)/i;

type Obj = Record<string, unknown>;

function resolveCharName(q: Query, id: number): string {
  return String(q.at(`/living/${id}/first_name`) ?? "unknown");
}

function numberList(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function asObject(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function collectionEntries(value: unknown): Array<[string, Obj]> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const record = asObject(entry);
      return record ? [[String(index), record] as [string, Obj]] : [];
    });
  }
  const record = asObject(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, entry]) => {
    const child = asObject(entry);
    return child ? [[key, child] as [string, Obj]] : [];
  });
}

function referenceNumber(value: unknown, preferredKeys: string[]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const record = asObject(value);
  if (!record) return null;
  for (const key of preferredKeys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function hasRealm(q: Query, id: number): boolean {
  const domain = q.at(`/living/${id}/landed_data/domain`);
  return numberList(domain).length > 0;
}

function isIndependentRuler(q: Query, id: number): boolean {
  const domain = numberList(q.at(`/living/${id}/landed_data/domain`));
  if (domain.length === 0) return false;
  return domain.some(
    (titleId) => q.at(`/landed_titles/landed_titles/${titleId}/de_facto_liege`) === undefined,
  );
}

function primaryTitleName(q: Query, loc: Localizer, id: number): string | null {
  const titleId = numberList(q.at(`/living/${id}/landed_data/domain`))[0];
  return titleId === undefined ? null : resolveTitleName(q, loc, titleId);
}

function playerCouncilMemberIds(q: Query, playerId: number): Set<number> {
  const result = new Set<number>();
  for (const rawId of numberList(q.at(`/living/${playerId}/landed_data/council`))) {
    const ownerId = referenceNumber(q.at(`/council_task_manager/active/${rawId}/owner`), [
      "character",
      "id",
      "value",
    ]);
    if (ownerId !== null) {
      result.add(ownerId);
      continue;
    }
    if (q.at(`/living/${rawId}/first_name`) !== undefined) result.add(rawId);
  }
  return result;
}

function isDirectVassal(q: Query, playerId: number, otherId: number): boolean {
  const playerTitles = new Set(numberList(q.at(`/living/${playerId}/landed_data/domain`)));
  if (playerTitles.size === 0) return false;
  return numberList(q.at(`/living/${otherId}/landed_data/domain`)).some((titleId) => {
    const liegeId = referenceNumber(q.at(`/landed_titles/landed_titles/${titleId}/de_facto_liege`), [
      "title",
      "landed_title",
      "id",
      "value",
    ]);
    return liegeId !== null && playerTitles.has(liegeId);
  });
}

function personalRelationContexts(
  q: Query,
  playerId: number,
  otherId: number,
  councilIds: Set<number>,
  tributaryIds: Set<number>,
): PersonalRelationContext[] {
  const contexts: PersonalRelationContext[] = [];
  if (isDirectVassal(q, playerId, otherId)) contexts.push("direct_vassal");
  if (councilIds.has(otherId)) contexts.push("councillor");
  if (
    referenceNumber(q.at(`/living/${otherId}/court_data/employer`), ["character", "id", "value"]) ===
    playerId
  ) {
    contexts.push("courtier");
  }
  if (tributaryIds.has(otherId)) contexts.push("tributary");
  if (isIndependentRuler(q, otherId)) contexts.push("independent_ruler");
  else if (hasRealm(q, otherId)) contexts.push("landed");
  return contexts;
}

function collectMarkerPaths(
  value: unknown,
  pattern: RegExp,
  path = "",
  depth = 0,
  out = new Set<string>(),
): string[] {
  if (depth > 7 || value === null || value === undefined) return [...out];
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectMarkerPaths(entry, pattern, `${path}[${index}]`, depth + 1, out),
    );
    return [...out];
  }
  if (typeof value !== "object") {
    if (typeof value === "string" && pattern.test(value)) out.add(path || "<value>");
    return [...out];
  }

  for (const [key, child] of Object.entries(value as Obj)) {
    const childPath = path ? `${path}.${key}` : key;
    if (pattern.test(key)) out.add(childPath);
    collectMarkerPaths(child, pattern, childPath, depth + 1, out);
  }
  return [...out];
}

function collectMarkedCharacterRefs(
  value: unknown,
  pattern: RegExp,
  path = "",
  depth = 0,
  out: Array<{ id: number; path: string }> = [],
): Array<{ id: number; path: string }> {
  if (depth > 7 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectMarkedCharacterRefs(entry, pattern, `${path}[${index}]`, depth + 1, out),
    );
    return out;
  }
  if (typeof value !== "object") return out;

  for (const [key, child] of Object.entries(value as Obj)) {
    const childPath = path ? `${path}.${key}` : key;
    if (pattern.test(key)) {
      if (typeof child === "number" && Number.isFinite(child)) {
        out.push({ id: child, path: childPath });
      } else if (Array.isArray(child)) {
        for (const entry of child) {
          if (typeof entry === "number" && Number.isFinite(entry)) {
            out.push({ id: entry, path: childPath });
          }
        }
      } else if (child && typeof child === "object") {
        for (const [nestedKey, nestedValue] of Object.entries(child as Obj)) {
          if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
            out.push({ id: nestedValue, path: `${childPath}.${nestedKey}` });
          }
        }
      }
    }
    collectMarkedCharacterRefs(child, pattern, childPath, depth + 1, out);
  }
  return out;
}

function puppetType(evidence: string[]): PuppetRef["type"] {
  const joined = evidence.join("|").toLowerCase();
  if (joined.includes("external_theological_agent_puppet")) return "clerical_ruler";
  if (joined.includes("theological_agent_puppet")) return "realm_priest";
  if (joined.includes("make_clerical_puppet_interaction")) return "realm_priest";
  if (joined.includes("secular") && joined.includes("puppet")) return "secular_ruler";
  return "unknown";
}

function extractPuppets(q: Query, playerId: number): PuppetRef[] {
  const result = new Map<string, PuppetRef>();

  const playerRaw = q.at(`/living/${playerId}`);
  for (const ref of collectMarkedCharacterRefs(playerRaw, PUPPET_PATTERN)) {
    if (!hasRealm(q, ref.id) && q.at(`/living/${ref.id}/first_name`) === undefined) continue;
    const evidence = [ref.path];
    const item: PuppetRef = {
      id: ref.id,
      name: resolveCharName(q, ref.id),
      type: puppetType(evidence),
      playerRole: "puppeteer",
      source: "player_character",
      evidence,
    };
    result.set(`${item.id}:${item.type}:${item.playerRole}`, item);
  }

  forEachRelation(q, playerId, (otherId, entry) => {
    const evidence = collectMarkerPaths(entry, PUPPET_PATTERN);
    if (evidence.length === 0) return;
    const type = puppetType(evidence);
    const key = `${otherId}:${type}`;
    if (result.has(`${otherId}:${type}:puppeteer`)) return;
    result.set(key, {
      id: otherId,
      name: resolveCharName(q, otherId),
      type,
      playerRole: "unknown",
      source: "active_relations",
      evidence,
    });
  });

  return [...result.values()].sort((a, b) => a.id - b.id || a.type.localeCompare(b.type));
}

function extractTributaries(q: Query, playerId: number): TributaryRef[] {
  const { active, source } = activeSubjectContracts(q);
  if (!active) return [];
  const result: TributaryRef[] = [];

  for (const [contractIdText, rawContract] of Object.entries(active)) {
    const contract = asObject(rawContract);
    const contractId = Number(contractIdText);
    if (!contract || !Number.isFinite(contractId)) continue;

    const subjectId =
      typeof contract["vassal"] === "number"
        ? contract["vassal"]
        : typeof contract["subject"] === "number"
          ? contract["subject"]
          : typeof contract["tributary"] === "number"
            ? contract["tributary"]
            : null;
    const liegeId =
      typeof contract["liege"] === "number"
        ? contract["liege"]
        : typeof contract["suzerain"] === "number"
          ? contract["suzerain"]
          : null;
    if (subjectId === null || liegeId === null) continue;
    if (subjectId !== playerId && liegeId !== playerId) continue;

    const evidence = [source, ...collectMarkerPaths(contract, SPECIAL_SUBJECT_PATTERN)];
    const independentSubject = isIndependentRuler(q, subjectId);
    const explicitTributaryMarker = evidence.some((path) => /tribut/i.test(path));

    if (!explicitTributaryMarker && !independentSubject) continue;

    const otherId = subjectId === playerId ? liegeId : subjectId;
    result.push({
      contractId,
      id: otherId,
      name: resolveCharName(q, otherId),
      playerRole: liegeId === playerId ? "suzerain" : "tributary",
      independentSubject,
      levels: numberList(contract["levels"]),
      classificationSource: explicitTributaryMarker
        ? "serialized_marker"
        : "independent_subject_contract",
      evidence,
    });
  }

  return result.sort((a, b) => a.id - b.id || a.contractId - b.contractId);
}

function participantIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value.flatMap((entry): number[] => {
    const record = asObject(entry);
    const id = record?.["character"];
    return typeof id === "number" && Number.isFinite(id) ? [id] : [];
  });
  return [...new Set(ids)];
}

function extractTributaryWars(
  q: Query,
  loc: Localizer,
  tributaries: TributaryRef[],
): TributaryWarRef[] {
  const playerTributaryIds = new Set(
    tributaries.filter((tributary) => tributary.playerRole === "suzerain").map((tributary) => tributary.id),
  );
  if (playerTributaryIds.size === 0) return [];

  const activeWars = asObject(q.at("/wars/active_wars"));
  if (!activeWars) return [];

  const result: TributaryWarRef[] = [];
  for (const [warIdText, rawWar] of Object.entries(activeWars)) {
    const war = asObject(rawWar);
    if (!war) continue;
    const attacker = asObject(war["attacker"]);
    const defender = asObject(war["defender"]);
    const attackerIds = participantIds(attacker?.["participants"]);
    const defenderIds = participantIds(defender?.["participants"]);
    const playerTributaryAttackerIds = attackerIds.filter((id) => playerTributaryIds.has(id));
    const playerTributaryDefenderIds = defenderIds.filter((id) => playerTributaryIds.has(id));
    if (playerTributaryAttackerIds.length === 0 && playerTributaryDefenderIds.length === 0) continue;

    const cb = asObject(war["casus_belli"]);
    const targetTitleIds = numberList(cb?.["targeted_titles"]);
    const betweenPlayerTributaries =
      playerTributaryAttackerIds.length > 0 && playerTributaryDefenderIds.length > 0;
    const startDateRaw = war["start_date"];

    result.push({
      warId: Number.isFinite(Number(warIdText)) ? Number(warIdText) : null,
      startDate:
        startDateRaw === undefined || startDateRaw === null ? null : formatCk3Date(startDateRaw),
      cbType: typeof cb?.["type"] === "string" ? cb["type"] : null,
      targetTitleIds,
      targetTitles: targetTitleIds.map((titleId) => resolveTitleName(q, loc, titleId)),
      attackerIds,
      attackerNames: attackerIds.map((id) => resolveCharName(q, id)),
      defenderIds,
      defenderNames: defenderIds.map((id) => resolveCharName(q, id)),
      playerTributaryAttackerIds,
      playerTributaryDefenderIds,
      betweenPlayerTributaries,
      classification: betweenPlayerTributaries
        ? "between_player_tributaries"
        : "player_tributary_vs_external",
    });
  }

  return result.sort(
    (a, b) => (a.warId ?? Number.MAX_SAFE_INTEGER) - (b.warId ?? Number.MAX_SAFE_INTEGER),
  );
}

function collectAllianceThroughIds(value: unknown, out = new Set<number>()): number[] {
  if (Array.isArray(value)) {
    for (const item of value) collectAllianceThroughIds(item, out);
    return [...out];
  }
  if (!value || typeof value !== "object") return [...out];

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "allied_through_0" || key === "allied_through_1") && typeof child === "number") {
      out.add(child);
      continue;
    }
    if (child && typeof child === "object") collectAllianceThroughIds(child, out);
  }
  return [...out];
}

function extractPersonalRelations(
  q: Query,
  loc: Localizer,
  playerId: number,
  tributaries: TributaryRef[],
): PersonalRelationRef[] {
  const byId = new Map<
    number,
    { relationTypes: Set<string>; evidence: Set<string> }
  >();

  for (const [entryId, entry] of collectionEntries(q.at("/opinions/active_opinions"))) {
    const owner = referenceNumber(entry["owner"], ["character", "id", "value"]);
    const target = referenceNumber(entry["target"], ["character", "id", "value"]);
    if (owner === null || target === null) continue;
    if (owner !== playerId && target !== playerId) continue;
    const otherId = owner === playerId ? target : owner;
    if (otherId === playerId) continue;

    const scripted = asObject(entry["scripted_relations"]);
    if (!scripted) continue;
    const current = byId.get(otherId) ?? {
      relationTypes: new Set<string>(),
      evidence: new Set<string>(),
    };
    for (const relationType of Object.keys(scripted)) {
      current.relationTypes.add(relationType);
      current.evidence.add(
        `opinions.active_opinions.${entryId}.scripted_relations.${relationType}`,
      );
    }
    byId.set(otherId, current);
  }

  const councilIds = playerCouncilMemberIds(q, playerId);
  const tributaryIds = new Set(tributaries.map((tributary) => tributary.id));
  return [...byId.entries()]
    .map(([id, relation]) => {
      const dynastyHouseRaw = q.at(`/living/${id}/dynasty_house`);
      const dynastyHouseId =
        typeof dynastyHouseRaw === "number" && Number.isFinite(dynastyHouseRaw)
          ? dynastyHouseRaw
          : null;
      return {
        id,
        name: resolveCharName(q, id),
        primaryTitle: primaryTitleName(q, loc, id),
        dynastyHouseId,
        dynastyHouseName: resolveDynastyHouseName(q, loc, dynastyHouseId),
        relationTypes: [...relation.relationTypes].sort(),
        contexts: personalRelationContexts(q, playerId, id, councilIds, tributaryIds),
        evidence: [...relation.evidence].sort(),
      };
    })
    .sort((a, b) => a.id - b.id);
}

export function extractDiplomacy(q: Query, loc: Localizer): DiplomacyInfo {
  const playerId = q.at("/played_character/character") as number;

  const domain = (q.at(`/living/${playerId}/landed_data/domain`) as number[] | undefined) ?? [];
  const primaryId: number | undefined = domain[0];
  const independent =
    primaryId === undefined
      ? true
      : q.at(`/landed_titles/landed_titles/${primaryId}/de_facto_liege`) === undefined;

  const alliances: DipRef[] = [];
  const allianceIds = new Set<number>();
  const truces: TruceRef[] = [];

  forEachRelation(q, playerId, (otherId, entry) => {
    if (entry["alliances"] != null && hasRealm(q, otherId) && !allianceIds.has(otherId)) {
      allianceIds.add(otherId);
      alliances.push({
        id: otherId,
        name: resolveCharName(q, otherId),
        throughCharacterIds: collectAllianceThroughIds(entry["alliances"]),
      });
    }
    const truceSlot =
      (entry["truce_0"] as Record<string, unknown> | undefined) ??
      (entry["truce_1"] as Record<string, unknown> | undefined);
    if (truceSlot && typeof truceSlot === "object") {
      truces.push({
        id: otherId,
        name: resolveCharName(q, otherId),
        until: formatCk3Date(truceSlot["date"]),
        result: typeof truceSlot["result"] === "string" ? truceSlot["result"] : "?",
      });
    }
  });

  const activeOpinions =
    (q.at("/opinions/active_opinions") as Record<string, unknown>[] | undefined) ?? [];

  const opinionMap = new Map<number, number>();
  for (const entry of activeOpinions) {
    if (!entry || typeof entry !== "object") continue;
    if ((entry["target"] as number | undefined) !== playerId) continue;
    const owner = entry["owner"] as number | undefined;
    if (typeof owner !== "number") continue;
    const tempOpinion = entry["temporary_opinion"] as Record<string, unknown> | undefined;
    const value = tempOpinion?.["value"];
    if (typeof value !== "number") continue;
    opinionMap.set(owner, (opinionMap.get(owner) ?? 0) + value);
  }

  const hostile: ThreatRef[] = Array.from(opinionMap.entries())
    .filter(([, opinion]) => opinion < 0)
    .sort(([, a], [, b]) => a - b)
    .slice(0, HOSTILE_CAP)
    .map(([id, opinion]) => ({ id, name: resolveCharName(q, id), opinion }));

  const tributaries = extractTributaries(q, playerId);
  return {
    independent,
    alliances,
    truces,
    hostile,
    tributaries,
    tributaryWars: extractTributaryWars(q, loc, tributaries),
    puppets: extractPuppets(q, playerId),
    personalRelations: extractPersonalRelations(q, loc, playerId, tributaries),
  };
}
