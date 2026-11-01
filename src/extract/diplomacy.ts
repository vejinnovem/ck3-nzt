import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { formatCk3Date } from "../format.js";
import { forEachRelation } from "./scan.js";
import { activeSubjectContracts } from "./subjectContracts.js";

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

export interface DiplomacyInfo {
  independent: boolean;
  /** Actual allied rulers/realms. Unlanded relatives used to create the alliance are excluded. */
  alliances: DipRef[];
  truces: TruceRef[];
  hostile: ThreatRef[]; // top-N lowest summed opinion of the player
  /** Independent subjects tied to the player by a CK3 subject contract. */
  tributaries: TributaryRef[];
  /** Puppet relations involving the player, including the Realm Priest Puppet added in 1.20. */
  puppets: PuppetRef[];
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

  // Some newer relation types are serialized directly on the character. Prefer these
  // because the direction is unambiguous: a puppet reference on the player means the
  // player is the puppeteer.
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

  // Scripted relations can also be stored in the pairwise relation manager. Capture
  // relation names such as theological_agent_puppet even when Paradox moves the
  // underlying serialization between patches. The make_clerical_puppet interaction
  // cooldown is also enough to classify the counterpart as a realm-priest puppet type,
  // while direction remains unknown unless an authoritative character marker exists.
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

    // CK3 1.20 uses the generic SubjectContract system for tributaries. Even if the
    // contract has no literal "tributary" key in the save, the subject remains an
    // independent ruler, unlike a normal vassal. That distinction is stable and is
    // therefore a useful fallback classifier.
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

export function extractDiplomacy(q: Query, loc: Localizer): DiplomacyInfo {
  void loc; // reserved for future localisation
  const playerId = q.at("/played_character/character") as number;

  // Independent: domain[0] has no de_facto_liege on the title
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
    // CK3 can mark both the allied ruler and unlanded family members used to create
    // that alliance with `alliances`. An alliance is between rulers, so expose only
    // the landed counterpart while retaining the marriage/betrothal participants.
    if (entry["alliances"] != null && hasRealm(q, otherId) && !allianceIds.has(otherId)) {
      allianceIds.add(otherId);
      alliances.push({
        id: otherId,
        name: resolveCharName(q, otherId),
        throughCharacterIds: collectAllianceThroughIds(entry["alliances"]),
      });
    }
    // Truces — emit at most ONE per relation entry (prefer truce_0, fall back to truce_1)
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

  // Single pass over active_opinions: sum temporary_opinion.value per owner (of the player)
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

  // Take the N most-negative (hostile) owners; filter to negative only
  const hostile: ThreatRef[] = Array.from(opinionMap.entries())
    .filter(([, opinion]) => opinion < 0)
    .sort(([, a], [, b]) => a - b)
    .slice(0, HOSTILE_CAP)
    .map(([id, opinion]) => ({ id, name: resolveCharName(q, id), opinion }));

  return {
    independent,
    alliances,
    truces,
    hostile,
    tributaries: extractTributaries(q, playerId),
    puppets: extractPuppets(q, playerId),
  };
}
