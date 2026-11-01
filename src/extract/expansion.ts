import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { formatCk3Date } from "../format.js";
import type { War } from "./military.js";
import { collectConfederationCoMemberIds } from "./confederations.js";
import { forEachRelation, forEachWar } from "./scan.js";
import { resolveTitleName, titleTierFromKey, type TitleTier } from "./titleUtils.js";

export interface ClaimRef {
  title: string;
  pressed: boolean;
}

export interface StrategicCasusBelliCandidate {
  type: string;
  scope: "title" | "realm";
  availability: "candidate" | "blocked";
  targetTitleId: number | null;
  targetTitle: string | null;
  blockers: string[];
  evidence: string[];
  limitations: string[];
}

export interface StrategicTargetTitle {
  id: number;
  title: string;
  tier: TitleTier;
  confirmedCasusBelli: string[];
  /** Partially evaluated CK3 CBs. These are deliberately separate from confirmedCasusBelli. */
  candidateCasusBelli: StrategicCasusBelliCandidate[];
}

export interface StrategicTargetAlly {
  id: number;
  name: string;
  realm: string | null;
}

export type StrategicTargetSupportSource = "alliance" | "confederation";

export interface StrategicTargetDefensiveBacker extends StrategicTargetAlly {
  currentStrength: number | null;
  sources: StrategicTargetSupportSource[];
}

export interface StrategicTargetWar {
  side: "attacker" | "defender";
  cbType: string;
  targetTitle: string | null;
}

export interface StrategicExpansionTarget {
  realmTitleId: number;
  realmName: string;
  rulerId: number;
  rulerName: string;
  strength: number | null;
  currentStrength: number | null;
  playerToTargetStrengthRatio: number | null;
  /** Direct CK3 alliance relations only. */
  allies: StrategicTargetAlly[];
  /** Character co-members of the ruler's CK3 confederation(s). */
  confederationMembers: StrategicTargetAlly[];
  /** Unique defenders expected from direct alliances and character confederation membership. */
  defensiveBackers: StrategicTargetDefensiveBacker[];
  /** Ruler + defensiveBackers current_strength, null if any component is unavailable. */
  defensiveCurrentStrength: number | null;
  /** Player + directly allied rulers current_strength (confederations are defensive-only). */
  playerWithAlliesCurrentStrength: number | null;
  playerToDefensiveStrengthRatio: number | null;
  wars: StrategicTargetWar[];
  relevantTitles: StrategicTargetTitle[];
  /** Realm-scoped CBs such as tribal subjugation, evaluated conservatively. */
  candidateCasusBelli: StrategicCasusBelliCandidate[];
  /** A serialized truce blocks declaration but does not erase the underlying CB from CK3's UI. */
  truceUntil: string | null;
  basis: "same_de_jure_kingdom";
}

export interface ExpansionInfo {
  claims: ClaimRef[];
  pressedCount: number;
  deJureUnheld: { title: string }[];
  warTargets: { title: string; cbType: string }[];
  /**
   * Save-derived expansion candidates inside the same de-jure kingdom as the
   * player's primary title. This is deliberately not called `neighbors`:
   * exact geographic adjacency requires static map/province data.
   */
  strategicTargets: StrategicExpansionTarget[];
  targetScope: {
    deJureKingdomId: number | null;
    deJureKingdomName: string | null;
    exactAdjacencyAvailable: boolean;
    casusBelliCoverage: "claims_direct_de_jure_and_partial_tribal_rules";
    casusBelliLimitations: string[];
  };
}

const CB_LIMITATIONS = [
  "Tribal conquest candidates do not yet evaluate CK3's neighbor_land/static-map requirement or every scripted culture, faith, struggle and government trigger.",
  "Tribal subjugation candidates evaluate tribal governments, defender independence, truces and a best-effort lifetime-use flag; prestige-level and special scripted exclusions remain unresolved.",
];

function numberList(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function charName(q: Query, id: number): string {
  return String(q.at(`/living/${id}/first_name`) ?? "unknown");
}

function titleKey(q: Query, id: number): string {
  return String(q.at(`/landed_titles/landed_titles/${id}/key`) ?? "");
}

function deJureKingdomId(q: Query, startId: number): number | null {
  let current = startId;
  const seen = new Set<number>();
  while (!seen.has(current)) {
    seen.add(current);
    const key = titleKey(q, current);
    if (titleTierFromKey(key) === "kingdom") return current;
    const liege = q.at(`/landed_titles/landed_titles/${current}/de_jure_liege`);
    if (typeof liege !== "number") return null;
    current = liege;
  }
  return null;
}

function topDeFactoTitleId(q: Query, startId: number): number {
  let current = startId;
  const seen = new Set<number>();
  while (!seen.has(current)) {
    seen.add(current);
    const liege = q.at(`/landed_titles/landed_titles/${current}/de_facto_liege`);
    if (typeof liege !== "number") return current;
    current = liege;
  }
  return current;
}

function realmTitleForCharacter(
  q: Query,
  loc: Localizer,
  characterId: number,
): { id: number; name: string } | null {
  const domain = numberList(q.at(`/living/${characterId}/landed_data/domain`));
  const primaryTitleId = domain[0];
  if (primaryTitleId === undefined) return null;
  return { id: primaryTitleId, name: resolveTitleName(q, loc, primaryTitleId) };
}

function realmNameForCharacter(q: Query, loc: Localizer, characterId: number): string | null {
  return realmTitleForCharacter(q, loc, characterId)?.name ?? null;
}

function currentStrengthForCharacter(q: Query, characterId: number): number | null {
  const value = q.at(`/living/${characterId}/landed_data/current_strength`);
  return typeof value === "number" ? value : null;
}

function governmentKeyForCharacter(q: Query, characterId: number): string | null {
  const landed = `/living/${characterId}/landed_data`;
  for (const value of [
    q.at(`${landed}/government`),
    q.at(`/living/${characterId}/government`),
    q.at(`/living/${characterId}/alive_data/government`),
  ]) {
    if (typeof value === "string" && value.length > 0) return value;
  }

  const laws = stringList(q.at(`${landed}/laws`));
  if (laws.some((law) => law.startsWith("tribal_authority_"))) return "tribal_government";
  return null;
}

function isIndependentRuler(q: Query, characterId: number): boolean {
  const domain = numberList(q.at(`/living/${characterId}/landed_data/domain`));
  const primaryTitleId = domain[0];
  if (primaryTitleId === undefined) return false;
  const liege = q.at(`/landed_titles/landed_titles/${primaryTitleId}/de_facto_liege`);
  return typeof liege !== "number";
}

function containsToken(value: unknown, token: string, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === "string") return value === token;
  if (Array.isArray(value)) return value.some((item) => containsToken(item, token, depth + 1));
  if (typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === token || containsToken(child, token, depth + 1)) return true;
  }
  return false;
}

function truceUntilBetween(q: Query, playerId: number, otherId: number): string | null {
  let result: string | null = null;
  forEachRelation(q, playerId, (relationOtherId, entry) => {
    if (relationOtherId !== otherId || result !== null) return;
    const slot =
      (entry["truce_0"] as Record<string, unknown> | undefined) ??
      (entry["truce_1"] as Record<string, unknown> | undefined);
    if (!slot || typeof slot !== "object" || slot["date"] === undefined) return;
    result = formatCk3Date(slot["date"]);
  });
  return result;
}

function collectAllies(q: Query, loc: Localizer, rulerId: number): StrategicTargetAlly[] {
  const out: StrategicTargetAlly[] = [];
  const seen = new Set<number>();
  forEachRelation(q, rulerId, (otherId, entry) => {
    if (entry["alliances"] == null || seen.has(otherId)) return;
    const realm = realmNameForCharacter(q, loc, otherId);
    if (realm === null) return;
    seen.add(otherId);
    out.push({ id: otherId, name: charName(q, otherId), realm });
  });
  return out;
}

function collectConfederationMembers(
  q: Query,
  loc: Localizer,
  rulerId: number,
): StrategicTargetAlly[] {
  const out: StrategicTargetAlly[] = [];
  for (const memberId of collectConfederationCoMemberIds(q, rulerId)) {
    const realm = realmNameForCharacter(q, loc, memberId);
    if (realm === null) continue;
    out.push({ id: memberId, name: charName(q, memberId), realm });
  }
  return out;
}

function mergeDefensiveBackers(
  q: Query,
  allies: StrategicTargetAlly[],
  confederationMembers: StrategicTargetAlly[],
  excludedCharacterId: number,
): StrategicTargetDefensiveBacker[] {
  const byId = new Map<number, StrategicTargetDefensiveBacker>();
  const add = (supporter: StrategicTargetAlly, source: StrategicTargetSupportSource) => {
    if (supporter.id === excludedCharacterId) return;
    const existing = byId.get(supporter.id);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    byId.set(supporter.id, {
      ...supporter,
      currentStrength: currentStrengthForCharacter(q, supporter.id),
      sources: [source],
    });
  };
  for (const ally of allies) add(ally, "alliance");
  for (const member of confederationMembers) add(member, "confederation");
  return [...byId.values()];
}

function sumCurrentStrengths(q: Query, characterIds: number[]): number | null {
  let total = 0;
  for (const id of characterIds) {
    const strength = currentStrengthForCharacter(q, id);
    if (strength === null) return null;
    total += strength;
  }
  return total;
}

function collectWars(q: Query, loc: Localizer, rulerId: number): StrategicTargetWar[] {
  const out: StrategicTargetWar[] = [];
  forEachWar(q, rulerId, (side, war) => {
    const cb = war["casus_belli"] as Record<string, unknown> | undefined;
    const cbType = typeof cb?.["type"] === "string" ? cb["type"] : "";
    const targeted = numberList(cb?.["targeted_titles"]);
    out.push({
      side,
      cbType,
      targetTitle: targeted[0] !== undefined ? resolveTitleName(q, loc, targeted[0]) : null,
    });
  });
  return out;
}

function confirmedCbTypes(
  titleId: number,
  q: Query,
  playerClaims: Set<number>,
  playerHeldTitles: Set<number>,
): string[] {
  const out: string[] = [];
  if (playerClaims.has(titleId)) out.push("claim");
  const deJureLiege = q.at(`/landed_titles/landed_titles/${titleId}/de_jure_liege`);
  if (typeof deJureLiege === "number" && playerHeldTitles.has(deJureLiege)) out.push("de_jure");
  return out;
}

function countyConquestCandidate(
  q: Query,
  playerId: number,
  rulerId: number,
  titleId: number,
  title: string,
  truceUntil: string | null,
): StrategicCasusBelliCandidate[] {
  if (governmentKeyForCharacter(q, playerId) !== "tribal_government") return [];
  if (rulerId === playerId) return [];

  const blockers = truceUntil ? [`truce_until:${truceUntil}`] : [];
  return [
    {
      type: "county_conquest",
      scope: "title",
      availability: blockers.length > 0 ? "blocked" : "candidate",
      targetTitleId: titleId,
      targetTitle: title,
      blockers,
      evidence: ["attacker_government=tribal_government", "foreign_county"],
      limitations: [
        "Exact neighbor_land/static-map eligibility and remaining scripted CK3 triggers are not evaluated yet.",
      ],
    },
  ];
}

function subjugationCandidate(
  q: Query,
  playerId: number,
  rulerId: number,
  truceUntil: string | null,
): StrategicCasusBelliCandidate[] {
  if (governmentKeyForCharacter(q, playerId) !== "tribal_government") return [];
  if (governmentKeyForCharacter(q, rulerId) !== "tribal_government") return [];
  if (!isIndependentRuler(q, rulerId)) return [];

  const blockers: string[] = [];
  if (truceUntil) blockers.push(`truce_until:${truceUntil}`);
  const playerRecord = q.at(`/living/${playerId}`);
  if (containsToken(playerRecord, "used_lifetime_subjugation")) {
    blockers.push("used_lifetime_subjugation");
  }

  return [
    {
      type: "tribal_subjugation",
      scope: "realm",
      availability: blockers.length > 0 ? "blocked" : "candidate",
      targetTitleId: null,
      targetTitle: null,
      blockers,
      evidence: [
        "attacker_government=tribal_government",
        "defender_government=tribal_government",
        "defender_independent=true",
      ],
      limitations: [
        "Neighbor-realm, prestige-level, culture/faith modifiers and special scripted exclusions are not fully evaluated yet.",
        "Lifetime-use detection is best-effort because CK3 can serialize flags differently between versions.",
      ],
    },
  ];
}

function emptyTargetScope(
  q: Query,
  loc: Localizer,
  kingdomId: number | null,
): ExpansionInfo["targetScope"] {
  return {
    deJureKingdomId: kingdomId,
    deJureKingdomName: kingdomId === null ? null : resolveTitleName(q, loc, kingdomId),
    exactAdjacencyAvailable: false,
    casusBelliCoverage: "claims_direct_de_jure_and_partial_tribal_rules",
    casusBelliLimitations: [...CB_LIMITATIONS],
  };
}

function extractStrategicTargets(
  q: Query,
  loc: Localizer,
  playerId: number,
  primaryTitleId: number | undefined,
): Pick<ExpansionInfo, "strategicTargets" | "targetScope"> {
  if (primaryTitleId === undefined) {
    return {
      strategicTargets: [],
      targetScope: emptyTargetScope(q, loc, null),
    };
  }

  const kingdomId = deJureKingdomId(q, primaryTitleId);
  if (kingdomId === null) {
    return {
      strategicTargets: [],
      targetScope: emptyTargetScope(q, loc, null),
    };
  }

  const playerHeldTitles = new Set(numberList(q.at(`/living/${playerId}/landed_data/domain`)));
  const rawClaims = q.at(`/living/${playerId}/alive_data/claim`);
  const claimRecords = Array.isArray(rawClaims)
    ? rawClaims
    : rawClaims && typeof rawClaims === "object"
      ? [rawClaims]
      : [];
  const playerClaims = new Set<number>();
  for (const raw of claimRecords) {
    if (!raw || typeof raw !== "object") continue;
    const title = (raw as Record<string, unknown>)["title"];
    if (typeof title === "number") playerClaims.add(title);
  }

  const titles = q.at("/landed_titles/landed_titles") as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!titles) {
    return {
      strategicTargets: [],
      targetScope: emptyTargetScope(q, loc, kingdomId),
    };
  }

  const playerStrengthRaw = q.at(`/living/${playerId}/landed_data/current_strength`);
  const playerStrength = typeof playerStrengthRaw === "number" ? playerStrengthRaw : null;
  const playerAllies = collectAllies(q, loc, playerId).filter((ally) => ally.id !== playerId);
  const playerWithAlliesCurrentStrength =
    playerStrength === null
      ? null
      : sumCurrentStrengths(q, [playerId, ...new Set(playerAllies.map((ally) => ally.id))]);
  const grouped = new Map<number, StrategicExpansionTarget>();

  for (const [idStr, title] of Object.entries(titles)) {
    const id = Number(idStr);
    if (!Number.isFinite(id) || !title || typeof title !== "object") continue;
    const key = typeof title["key"] === "string" ? title["key"] : "";
    if (titleTierFromKey(key) !== "county") continue;
    if (deJureKingdomId(q, id) !== kingdomId) continue;
    if (playerHeldTitles.has(id)) continue;

    const holderId = typeof title["holder"] === "number" ? title["holder"] : null;
    if (holderId === null || holderId === playerId) continue;

    const topTitleId = topDeFactoTitleId(q, id);
    const topHolderRaw = q.at(`/landed_titles/landed_titles/${topTitleId}/holder`);
    const rulerId = typeof topHolderRaw === "number" ? topHolderRaw : holderId;
    if (rulerId === playerId) continue;

    let target = grouped.get(topTitleId);
    if (!target) {
      const strengthRaw = q.at(`/living/${rulerId}/landed_data/strength`);
      const currentStrengthRaw = q.at(`/living/${rulerId}/landed_data/current_strength`);
      const strength = typeof strengthRaw === "number" ? strengthRaw : null;
      const currentStrength = typeof currentStrengthRaw === "number" ? currentStrengthRaw : null;
      const ratio =
        playerStrength !== null && currentStrength !== null && currentStrength > 0
          ? playerStrength / currentStrength
          : null;
      const realmTitle = realmTitleForCharacter(q, loc, rulerId);
      const allies = collectAllies(q, loc, rulerId).filter((ally) => ally.id !== playerId);
      const confederationMembers = collectConfederationMembers(q, loc, rulerId).filter(
        (member) => member.id !== playerId,
      );
      const defensiveBackers = mergeDefensiveBackers(
        q,
        allies,
        confederationMembers,
        playerId,
      );
      const defensiveCurrentStrength = sumCurrentStrengths(q, [
        rulerId,
        ...defensiveBackers.map((backer) => backer.id),
      ]);
      const playerToDefensiveStrengthRatio =
        playerWithAlliesCurrentStrength !== null &&
        defensiveCurrentStrength !== null &&
        defensiveCurrentStrength > 0
          ? playerWithAlliesCurrentStrength / defensiveCurrentStrength
          : null;
      const truceUntil = truceUntilBetween(q, playerId, rulerId);
      target = {
        realmTitleId: realmTitle?.id ?? topTitleId,
        realmName: realmTitle?.name ?? resolveTitleName(q, loc, topTitleId),
        rulerId,
        rulerName: charName(q, rulerId),
        strength,
        currentStrength,
        playerToTargetStrengthRatio: ratio,
        allies,
        confederationMembers,
        defensiveBackers,
        defensiveCurrentStrength,
        playerWithAlliesCurrentStrength,
        playerToDefensiveStrengthRatio,
        wars: collectWars(q, loc, rulerId),
        relevantTitles: [],
        candidateCasusBelli: subjugationCandidate(q, playerId, rulerId, truceUntil),
        truceUntil,
        basis: "same_de_jure_kingdom",
      };
      grouped.set(topTitleId, target);
    }

    const titleName = resolveTitleName(q, loc, id);
    target.relevantTitles.push({
      id,
      title: titleName,
      tier: "county",
      confirmedCasusBelli: confirmedCbTypes(id, q, playerClaims, playerHeldTitles),
      candidateCasusBelli: countyConquestCandidate(
        q,
        playerId,
        rulerId,
        id,
        titleName,
        target.truceUntil,
      ),
    });
  }

  const strategicTargets = [...grouped.values()].sort((a, b) => {
    const aStrength = a.defensiveCurrentStrength ?? a.currentStrength;
    const bStrength = b.defensiveCurrentStrength ?? b.currentStrength;
    if (aStrength === null && bStrength === null) return a.realmName.localeCompare(b.realmName);
    if (aStrength === null) return 1;
    if (bStrength === null) return -1;
    return aStrength - bStrength;
  });

  return {
    strategicTargets,
    targetScope: emptyTargetScope(q, loc, kingdomId),
  };
}

export function extractExpansion(q: Query, loc: Localizer, wars: War[]): ExpansionInfo {
  const playerId = q.at("/played_character/character") as number;
  const aliveData = `/living/${playerId}/alive_data`;

  // Claims: alive_data/claim is usually an array of { title, pressed? }, but
  // normalize the single-object case too because Jomini can preserve either form.
  const rawClaimValue = q.at(`${aliveData}/claim`);
  const rawClaims = Array.isArray(rawClaimValue)
    ? (rawClaimValue as Array<Record<string, unknown>>)
    : rawClaimValue && typeof rawClaimValue === "object"
      ? [rawClaimValue as Record<string, unknown>]
      : [];
  const claims: ClaimRef[] = rawClaims
    .filter((c) => typeof c["title"] === "number")
    .map((c) => ({
      title: resolveTitleName(q, loc, c["title"] as number),
      pressed: c["pressed"] === true,
    }));
  const pressedCount = claims.filter((c) => c.pressed).length;

  // De jure unheld: titles in primary title's de_jure_vassals with no holder
  const primaryTitleId = numberList(q.at(`/living/${playerId}/landed_data/domain`))[0];
  const deJureVassals =
    primaryTitleId !== undefined
      ? numberList(q.at(`/landed_titles/landed_titles/${primaryTitleId}/de_jure_vassals`))
      : [];

  const deJureUnheld = deJureVassals
    .filter((tid) => q.at(`/landed_titles/landed_titles/${tid}/holder`) === undefined)
    .map((tid) => ({ title: resolveTitleName(q, loc, tid) }));

  // War targets: reuse already-extracted wars
  const warTargets = wars.map((w) => ({
    title: w.targetTitle ?? "?",
    cbType: w.cbType,
  }));

  const { strategicTargets, targetScope } = extractStrategicTargets(q, loc, playerId, primaryTitleId);

  return { claims, pressedCount, deJureUnheld, warTargets, strategicTargets, targetScope };
}
