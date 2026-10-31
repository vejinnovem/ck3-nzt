import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { War } from "./military.js";
import { forEachRelation, forEachWar } from "./scan.js";
import { resolveTitleName, titleTierFromKey, type TitleTier } from "./titleUtils.js";

export interface ClaimRef {
  title: string;
  pressed: boolean;
}

export interface StrategicTargetTitle {
  id: number;
  title: string;
  tier: TitleTier;
  confirmedCasusBelli: string[];
}

export interface StrategicTargetAlly {
  id: number;
  name: string;
  realm: string | null;
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
  allies: StrategicTargetAlly[];
  wars: StrategicTargetWar[];
  relevantTitles: StrategicTargetTitle[];
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
    casusBelliCoverage: "claims_and_direct_de_jure_only";
  };
}

function numberList(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
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

function realmNameForCharacter(q: Query, loc: Localizer, characterId: number): string | null {
  const domain = numberList(q.at(`/living/${characterId}/landed_data/domain`));
  return domain[0] !== undefined ? resolveTitleName(q, loc, domain[0]) : null;
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

function extractStrategicTargets(
  q: Query,
  loc: Localizer,
  playerId: number,
  primaryTitleId: number | undefined,
): Pick<ExpansionInfo, "strategicTargets" | "targetScope"> {
  if (primaryTitleId === undefined) {
    return {
      strategicTargets: [],
      targetScope: {
        deJureKingdomId: null,
        deJureKingdomName: null,
        exactAdjacencyAvailable: false,
        casusBelliCoverage: "claims_and_direct_de_jure_only",
      },
    };
  }

  const kingdomId = deJureKingdomId(q, primaryTitleId);
  if (kingdomId === null) {
    return {
      strategicTargets: [],
      targetScope: {
        deJureKingdomId: null,
        deJureKingdomName: null,
        exactAdjacencyAvailable: false,
        casusBelliCoverage: "claims_and_direct_de_jure_only",
      },
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
      targetScope: {
        deJureKingdomId: kingdomId,
        deJureKingdomName: resolveTitleName(q, loc, kingdomId),
        exactAdjacencyAvailable: false,
        casusBelliCoverage: "claims_and_direct_de_jure_only",
      },
    };
  }

  const playerStrengthRaw = q.at(`/living/${playerId}/landed_data/current_strength`);
  const playerStrength = typeof playerStrengthRaw === "number" ? playerStrengthRaw : null;
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
      target = {
        realmTitleId: topTitleId,
        realmName: resolveTitleName(q, loc, topTitleId),
        rulerId,
        rulerName: charName(q, rulerId),
        strength,
        currentStrength,
        playerToTargetStrengthRatio: ratio,
        allies: collectAllies(q, loc, rulerId),
        wars: collectWars(q, loc, rulerId),
        relevantTitles: [],
        basis: "same_de_jure_kingdom",
      };
      grouped.set(topTitleId, target);
    }

    target.relevantTitles.push({
      id,
      title: resolveTitleName(q, loc, id),
      tier: "county",
      confirmedCasusBelli: confirmedCbTypes(id, q, playerClaims, playerHeldTitles),
    });
  }

  const strategicTargets = [...grouped.values()].sort((a, b) => {
    if (a.currentStrength === null && b.currentStrength === null) return a.realmName.localeCompare(b.realmName);
    if (a.currentStrength === null) return 1;
    if (b.currentStrength === null) return -1;
    return a.currentStrength - b.currentStrength;
  });

  return {
    strategicTargets,
    targetScope: {
      deJureKingdomId: kingdomId,
      deJureKingdomName: resolveTitleName(q, loc, kingdomId),
      exactAdjacencyAvailable: false,
      casusBelliCoverage: "claims_and_direct_de_jure_only",
    },
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
