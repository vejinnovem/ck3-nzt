import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { extractCharacter, type CharacterInfo } from "./characters.js";
import {
  resolveTitleName,
  titleTierFromKey,
  type TitleTier,
} from "./titleUtils.js";

export interface HeirRef {
  id: number;
  name: string;
}

export interface LineageStep {
  id: number;
  name: string;
  living: boolean;
}

export interface PartnerRef {
  id: number;
  name: string;
  dynastyHouseId: number | null;
  female: boolean | null;
}

export type HeirRelation =
  | "child"
  | "grandchild"
  | "great_grandchild"
  | "descendant"
  | "other_or_unknown";

export interface HeirProfile {
  id: number;
  position: number;
  name: string;
  relationToRuler: HeirRelation;
  lineage: LineageStep[];
  dynastyHouseId: number | null;
  sameDynastyHouseAsRuler: boolean | null;
  profile: CharacterInfo | null;
  spouses: PartnerRef[];
  betrothed: PartnerRef | null;
}

export interface TitleInheritance {
  titleId: number;
  title: string;
  key: string | null;
  tier: TitleTier;
  deJureLiegeId: number | null;
  deJureLiege: string | null;
  isPrimaryTitle: boolean;
  isRealmCapital: boolean;
  heirId: number | null;
  heirName: string | null;
}

export interface HeirTitleAssignment {
  heirId: number;
  heirName: string;
  titles: Array<Pick<TitleInheritance, "titleId" | "title" | "key" | "tier">>;
}

export interface CreatableEqualRankTitleCandidate {
  titleId: number;
  title: string;
  key: string;
  tier: TitleTier;
  holderId: null;
  deJureCountyCount: number;
  realmHeldDeJureCountyCount: number;
  realmHeldDeJureCountyFraction: number;
  /** CK3 Confederate Partition uses a more-than-half de-jure land condition. */
  landThresholdMet: boolean;
  /** Extra title-specific/scripted requirements are deliberately not reconstructed. */
  specialCreationRulesEvaluated: false;
}

export interface SuccessionRisk {
  currentHeldTitleSplitRisk: boolean;
  currentHeldTitleSplitReason: string | null;
  /**
   * Best-effort risk from currently unheld titles of the primary title's rank that
   * Confederate Partition could create. Null means the case could not be evaluated.
   */
  creatableEqualRankSplitRisk: boolean | null;
  creatableEqualRankCandidates: CreatableEqualRankTitleCandidate[];
  confederateEqualRankTitleCreationRiskEvaluated: boolean;
  limitation: string | null;
}

export interface SuccessionInfo {
  primaryTitle: string;
  primaryTitleId: number | null;
  successionLaw: string;
  genderLaw: string;
  heirs: HeirRef[];
  heirProfiles: HeirProfile[];
  totalHeirs: number;
  claimants: HeirRef[];
  totalClaimants: number;
  titleInheritance: TitleInheritance[];
  titleAssignmentsByHeir: HeirTitleAssignment[];
  titleInheritanceSource: "landed_title_heir";
  unresolvedHeldTitleIds: number[];
  risk: SuccessionRisk;
}

const HEIR_CAP = 6;
const CLAIMANT_CAP = 6;
const REALM_GRAPH_DEPTH = 16;

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numberList(v: unknown): number[] {
  if (typeof v === "number" && Number.isFinite(v)) return [v];
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function titleReference(value: unknown): number | null {
  const direct = numberOrNull(value);
  if (direct !== null) return direct;
  const record = obj(value);
  if (!record) return null;
  for (const key of ["title", "landed_title", "id", "value"]) {
    const nested = numberOrNull(record[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function titleKey(title: Obj | null): string {
  return title && typeof title["key"] === "string" ? title["key"] : "";
}

function characterBasePath(q: Query, id: number): string | null {
  const candidates = [
    `/living/${id}`,
    `/dead_unprunable/${id}`,
    `/characters/dead_prunable/${id}`,
  ];
  for (const base of candidates) {
    if (q.at(`${base}/first_name`) !== undefined) return base;
  }
  return null;
}

function isLivingCharacter(q: Query, id: number): boolean {
  return q.at(`/living/${id}/first_name`) !== undefined;
}

function resolveCharName(q: Query, id: number): string {
  const base = characterBasePath(q, id);
  return String((base ? q.at(`${base}/first_name`) : undefined) ?? "unknown");
}

function dynastyHouseId(q: Query, id: number): number | null {
  const base = characterBasePath(q, id);
  return base ? numberOrNull(q.at(`${base}/dynasty_house`)) : null;
}

function childIds(q: Query, id: number): number[] {
  const base = characterBasePath(q, id);
  return base ? numberList(q.at(`${base}/family_data/child`)) : [];
}

function findDescendantPath(q: Query, rootId: number, targetId: number): number[] | null {
  if (rootId === targetId) return [rootId];
  const visited = new Set<number>();

  function walk(currentId: number, path: number[], depth: number): number[] | null {
    if (depth > 8 || visited.has(currentId)) return null;
    visited.add(currentId);

    for (const childId of childIds(q, currentId)) {
      const next = [...path, childId];
      if (childId === targetId) return next;
      const found = walk(childId, next, depth + 1);
      if (found) return found;
    }
    return null;
  }

  return walk(rootId, [rootId], 0);
}

function relationFromPath(path: number[] | null): HeirRelation {
  if (!path) return "other_or_unknown";
  const generations = path.length - 1;
  if (generations === 1) return "child";
  if (generations === 2) return "grandchild";
  if (generations === 3) return "great_grandchild";
  if (generations > 3) return "descendant";
  return "other_or_unknown";
}

function partnerRef(q: Query, id: number): PartnerRef {
  const base = characterBasePath(q, id);
  return {
    id,
    name: resolveCharName(q, id),
    dynastyHouseId: dynastyHouseId(q, id),
    female: base === null ? null : q.at(`${base}/female`) === true,
  };
}

function buildHeirProfile(
  q: Query,
  loc: Localizer,
  rulerId: number,
  rulerDynastyHouseId: number | null,
  id: number,
  position: number,
): HeirProfile {
  const profile = extractCharacter(q, loc, id);
  const base = characterBasePath(q, id);
  const houseId = dynastyHouseId(q, id);
  const spouseIds = base ? numberList(q.at(`${base}/family_data/spouse`)) : [];
  const primarySpouseId = base ? numberOrNull(q.at(`${base}/family_data/primary_spouse`)) : null;
  if (primarySpouseId !== null && !spouseIds.includes(primarySpouseId)) spouseIds.unshift(primarySpouseId);
  const betrothedId = base ? numberOrNull(q.at(`${base}/family_data/betrothed`)) : null;
  const path = findDescendantPath(q, rulerId, id);

  return {
    id,
    position,
    name: resolveCharName(q, id),
    relationToRuler: relationFromPath(path),
    lineage: (path ?? [id]).map((lineageId) => ({
      id: lineageId,
      name: resolveCharName(q, lineageId),
      living: isLivingCharacter(q, lineageId),
    })),
    dynastyHouseId: houseId,
    sameDynastyHouseAsRuler:
      houseId === null || rulerDynastyHouseId === null ? null : houseId === rulerDynastyHouseId,
    profile,
    spouses: spouseIds.map((spouseId) => partnerRef(q, spouseId)),
    betrothed: betrothedId === null ? null : partnerRef(q, betrothedId),
  };
}

function tierRank(tier: TitleTier): number {
  switch (tier) {
    case "empire":
      return 5;
    case "kingdom":
      return 4;
    case "duchy":
      return 3;
    case "county":
      return 2;
    case "barony":
      return 1;
    default:
      return 0;
  }
}

function extractTitleInheritance(
  q: Query,
  loc: Localizer,
  domain: number[],
  primaryTitleId: number | null,
  realmCapitalTitleId: number | null,
): TitleInheritance[] {
  return domain.map((titleId) => {
    const base = `/landed_titles/landed_titles/${titleId}`;
    const keyValue = q.at(`${base}/key`);
    const key = typeof keyValue === "string" ? keyValue : null;
    const heirIds = numberList(q.at(`${base}/heir`));
    const heirId = heirIds[0] ?? null;
    const deJureLiegeId = numberOrNull(q.at(`${base}/de_jure_liege`));
    return {
      titleId,
      title: resolveTitleName(q, loc, titleId),
      key,
      tier: key === null ? "other" : titleTierFromKey(key),
      deJureLiegeId,
      deJureLiege:
        deJureLiegeId === null ? null : resolveTitleName(q, loc, deJureLiegeId),
      isPrimaryTitle: titleId === primaryTitleId,
      isRealmCapital: titleId === realmCapitalTitleId,
      heirId,
      heirName: heirId === null ? null : resolveCharName(q, heirId),
    };
  });
}

function groupTitleAssignments(
  successionIds: number[],
  titles: TitleInheritance[],
  q: Query,
): HeirTitleAssignment[] {
  const order = new Map(successionIds.map((id, index) => [id, index]));
  const grouped = new Map<number, HeirTitleAssignment>();

  for (const title of titles) {
    if (title.heirId === null) continue;
    let assignment = grouped.get(title.heirId);
    if (!assignment) {
      assignment = {
        heirId: title.heirId,
        heirName: resolveCharName(q, title.heirId),
        titles: [],
      };
      grouped.set(title.heirId, assignment);
    }
    assignment.titles.push({
      titleId: title.titleId,
      title: title.title,
      key: title.key,
      tier: title.tier,
    });
  }

  return [...grouped.values()].sort(
    (a, b) => (order.get(a.heirId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.heirId) ?? Number.MAX_SAFE_INTEGER),
  );
}

function pathReachesTitle(
  titles: Obj,
  startTitleId: number,
  targetTitleIds: Set<number>,
  relation: "de_facto_liege" | "de_jure_liege",
): boolean {
  const visited = new Set<number>();
  let current: number | null = startTitleId;
  for (let depth = 0; depth < REALM_GRAPH_DEPTH && current !== null; depth += 1) {
    if (targetTitleIds.has(current)) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const title = obj(titles[String(current)]);
    if (!title) return false;
    current = titleReference(title[relation]);
  }
  return false;
}

function playerRealmCountyIds(titles: Obj, playerHeldTitleIds: Set<number>): Set<number> {
  const result = new Set<number>();
  for (const [idText, rawTitle] of Object.entries(titles)) {
    const titleId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(titleId) || !title) continue;
    if (titleTierFromKey(titleKey(title)) !== "county") continue;
    if (pathReachesTitle(titles, titleId, playerHeldTitleIds, "de_facto_liege")) {
      result.add(titleId);
    }
  }
  return result;
}

function deJureCountyIds(titles: Obj, ancestorTitleId: number): number[] {
  const target = new Set([ancestorTitleId]);
  const result: number[] = [];
  for (const [idText, rawTitle] of Object.entries(titles)) {
    const countyId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(countyId) || !title) continue;
    if (titleTierFromKey(titleKey(title)) !== "county") continue;
    if (countyId === ancestorTitleId) {
      result.push(countyId);
      continue;
    }
    if (pathReachesTitle(titles, countyId, target, "de_jure_liege")) result.push(countyId);
  }
  return result.sort((a, b) => a - b);
}

function supportsConfederateCreationEvaluation(tier: TitleTier): boolean {
  return tier === "duchy" || tier === "kingdom" || tier === "empire";
}

function creatableEqualRankCandidates(
  q: Query,
  loc: Localizer,
  playerId: number,
  primaryTier: TitleTier,
  domain: number[],
): CreatableEqualRankTitleCandidate[] | null {
  const titles = obj(q.at("/landed_titles/landed_titles"));
  if (!titles || !supportsConfederateCreationEvaluation(primaryTier)) return null;

  const playerHeldTitleIds = new Set(domain);
  for (const [idText, rawTitle] of Object.entries(titles)) {
    const titleId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(titleId) || !title) continue;
    if (numberOrNull(title["holder"]) === playerId) playerHeldTitleIds.add(titleId);
  }
  const realmCounties = playerRealmCountyIds(titles, playerHeldTitleIds);
  const candidates: CreatableEqualRankTitleCandidate[] = [];

  for (const [idText, rawTitle] of Object.entries(titles)) {
    const titleId = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(titleId) || !title || playerHeldTitleIds.has(titleId)) continue;
    const key = titleKey(title);
    if (!key || titleTierFromKey(key) !== primaryTier) continue;
    if (numberOrNull(title["holder"]) !== null) continue;

    const counties = deJureCountyIds(titles, titleId);
    if (counties.length === 0) continue;
    const realmHeldCount = counties.filter((countyId) => realmCounties.has(countyId)).length;
    const fraction = realmHeldCount / counties.length;
    const landThresholdMet = realmHeldCount * 2 > counties.length;
    if (!landThresholdMet) continue;

    candidates.push({
      titleId,
      title: resolveTitleName(q, loc, titleId),
      key,
      tier: primaryTier,
      holderId: null,
      deJureCountyCount: counties.length,
      realmHeldDeJureCountyCount: realmHeldCount,
      realmHeldDeJureCountyFraction: fraction,
      landThresholdMet,
      specialCreationRulesEvaluated: false,
    });
  }

  return candidates.sort((a, b) => {
    const fractionDiff = b.realmHeldDeJureCountyFraction - a.realmHeldDeJureCountyFraction;
    return fractionDiff !== 0 ? fractionDiff : a.title.localeCompare(b.title);
  });
}

export function extractSuccession(q: Query, loc: Localizer): SuccessionInfo {
  const playerId = q.at("/played_character/character") as number;
  const landedData = `/living/${playerId}/landed_data`;

  const domain = numberList(q.at(`${landedData}/domain`));
  const primaryTitleId: number | null = domain.length > 0 ? domain[0]! : null;
  const realmCapitalTitleId = numberOrNull(q.at(`${landedData}/realm_capital`));

  const primaryTitle: string =
    primaryTitleId !== null ? resolveTitleName(q, loc, primaryTitleId) : "unknown";

  const laws = (q.at(`${landedData}/laws`) as string[] | undefined) ?? [];
  const successionLaw = laws.find((l) => l.endsWith("_succession_law")) ?? "unknown";
  const genderLaw =
    laws.find((l) => /_(preference|only)_law$/.test(l) || l === "gender_equal_law") ?? "unknown";

  const successionIds = numberList(q.at(`${landedData}/succession`));
  const totalHeirs = successionIds.length;
  const visibleSuccessionIds = successionIds.slice(0, HEIR_CAP);
  const heirs: HeirRef[] = visibleSuccessionIds.map((id) => ({
    id,
    name: resolveCharName(q, id),
  }));
  const rulerDynastyHouseId = dynastyHouseId(q, playerId);
  const heirProfiles = visibleSuccessionIds.map((id, index) =>
    buildHeirProfile(q, loc, playerId, rulerDynastyHouseId, id, index + 1),
  );

  const resolvedSuccessionLaw = loc.resolve(successionLaw);
  const resolvedGenderLaw = loc.resolve(genderLaw);

  const claimantIds: number[] =
    primaryTitleId !== null
      ? numberList(q.at(`/landed_titles/landed_titles/${primaryTitleId}/claim`))
      : [];
  const totalClaimants = claimantIds.length;
  const claimants: HeirRef[] = claimantIds.slice(0, CLAIMANT_CAP).map((id) => ({
    id,
    name: resolveCharName(q, id),
  }));

  const titleInheritance = extractTitleInheritance(
    q,
    loc,
    domain,
    primaryTitleId,
    realmCapitalTitleId,
  );
  const titleAssignmentsByHeir = groupTitleAssignments(successionIds, titleInheritance, q);
  const unresolvedHeldTitleIds = titleInheritance
    .filter((title) => title.heirId === null)
    .map((title) => title.titleId);

  const primaryTitleEntry = titleInheritance.find((title) => title.isPrimaryTitle);
  const primaryTier = primaryTitleEntry?.tier ?? "other";
  const primaryHeirId = successionIds[0] ?? null;
  const splitTitle = titleInheritance.find(
    (title) =>
      title.heirId !== null &&
      primaryHeirId !== null &&
      title.heirId !== primaryHeirId &&
      tierRank(title.tier) >= tierRank(primaryTier),
  );
  const isConfederatePartition = successionLaw.includes("confederate_partition");
  const creationCandidates = isConfederatePartition
    ? creatableEqualRankCandidates(q, loc, playerId, primaryTier, domain)
    : [];
  const creationRiskEvaluated = creationCandidates !== null;
  const creatableEqualRankSplitRisk = !isConfederatePartition
    ? false
    : !creationRiskEvaluated
      ? null
      : successionIds.length < 2
        ? false
        : creationCandidates.length > 0;

  const creationLimitation = isConfederatePartition
    ? !creationRiskEvaluated
      ? "Confederate Partition is active, but equal-rank creation risk could not be evaluated because the primary tier or landed-title graph is unsupported/unavailable."
      : "Creatable equal-rank title risk uses the save's succession queue plus serialized de-jure/de-facto title graphs and the Confederate Partition more-than-half de-jure county rule. Title-specific scripted creation restrictions, special governments, title laws and runtime-only exceptions are not reconstructed, so candidates are best-effort rather than guaranteed creations."
    : null;

  return {
    primaryTitle,
    primaryTitleId,
    successionLaw: resolvedSuccessionLaw,
    genderLaw: resolvedGenderLaw,
    heirs,
    heirProfiles,
    totalHeirs,
    claimants,
    totalClaimants,
    titleInheritance,
    titleAssignmentsByHeir,
    titleInheritanceSource: "landed_title_heir",
    unresolvedHeldTitleIds,
    risk: {
      currentHeldTitleSplitRisk: splitTitle !== undefined,
      currentHeldTitleSplitReason:
        splitTitle === undefined
          ? null
          : `${splitTitle.heirName ?? splitTitle.heirId} is currently the save-computed heir to ${splitTitle.title}, which is ${splitTitle.tier}-rank while the primary title is ${primaryTier}-rank.`,
      creatableEqualRankSplitRisk,
      creatableEqualRankCandidates: creationCandidates ?? [],
      confederateEqualRankTitleCreationRiskEvaluated: creationRiskEvaluated,
      limitation: creationLimitation,
    },
  };
}
