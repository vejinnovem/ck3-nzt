import { queryGamestate, type Query } from "./parser.js";
import type { Localizer } from "./localization.js";
import { formatCk3Date } from "./format.js";
import { extractMilitary, type MilitaryInfo } from "./extract/military.js";
import {
  extractOperationalArmies,
  type OperationalArmiesSummary,
} from "./extract/operationalArmies.js";
import {
  correctMilitaryLiveFields,
  correctOperationalArmiesLiveFields,
} from "./extract/liveSaveCorrections.js";
import { extractSuccession, type SuccessionInfo } from "./extract/succession.js";
import { extractDiplomacy, type DiplomacyInfo } from "./extract/diplomacy.js";
import {
  extractFactions,
  extractVassals,
  type FactionInfo,
  type VassalInfo,
} from "./extract/vassals.js";
import { extractExpansion, type ExpansionInfo } from "./extract/expansion.js";
import { extractTitles, type TitlesInfo } from "./extract/titles.js";
import {
  extractCharacter,
  extractImmediateFamily,
  type CharacterInfo,
  type ImmediateFamilyInfo,
} from "./extract/characters.js";
import { extractRealmEconomy, type RealmEconomyInfo } from "./extract/domain.js";
import { extractCouncil, type CouncilInfo } from "./extract/council.js";
import {
  extractCourtPositions,
  type CourtPositionsInfo,
} from "./extract/courtPositions.js";
import { extractGameInfo, type GameInfo } from "./extract/game.js";

export interface RealmOverview {
  rulerName: string;
  date: string;
  primaryTitle: string;
  tier: number;
  house: string;
  gold: number | null;
  prestige: number | null;
  piety: number | null;
}

export interface WarScoreCapability {
  /** CK3 computes the player-visible total in runtime; active_wars does not serialize it directly. */
  fullPlayerVisibleWarScoreAvailable: false;
  source: "runtime_computed_not_serialized";
  reconstruction: "not_implemented";
  knownSerializedComponents: ["ticking_war_score", "controls_all", "battle_results"];
  limitation: string;
}

export interface MenAtArmsReliability {
  /** Whether the recovered global-regiment breakdown reconciles with realm mobilisation totals. */
  breakdownReliable: boolean;
  /** Number of MAA regiment records actually linked to the player by the extractor. */
  recoveredRegimentCount: number;
  /**
   * strength_without_hires - levy - champions. This is an exact arithmetic remainder from
   * serialized realm totals, but it can include special troops as well as Men-at-Arms.
   */
  nonLevyNonChampionMaxStrength: number | null;
  /** Max soldiers represented by the recovered MAA records, when known. */
  recoveredMaxSoldiers: number | null;
  /** Arithmetic remainder minus recovered MAA max soldiers (or zero recovered records). */
  discrepancy: number | null;
  /** Human-readable warning when slotsUsed/regiments must not be treated as authoritative. */
  limitation: string | null;
}

export interface SnapshotMilitaryInfo extends MilitaryInfo {
  menAtArmsReliability: MenAtArmsReliability;
  warScoreCapability: WarScoreCapability;
}

export interface Snapshot {
  date: string;
  parsedAt: number;
  overview: RealmOverview;
  // Optional in the TypeScript interface so older stored/test snapshots remain readable.
  // buildSnapshot always emits these advisory sections for new snapshots.
  game?: GameInfo;
  ruler?: CharacterInfo | null;
  family?: ImmediateFamilyInfo;
  economy?: RealmEconomyInfo;
  council?: CouncilInfo;
  courtPositions?: CourtPositionsInfo;
  military: SnapshotMilitaryInfo;
  operationalArmies?: OperationalArmiesSummary;
  succession: SuccessionInfo;
  diplomacy: DiplomacyInfo;
  factions: FactionInfo[];
  vassals: VassalInfo[];
  vassalCount: number;
  expansion: ExpansionInfo;
  titles: TitlesInfo;
}

type Obj = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
function obj(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}
function numberList(v: unknown): number[] {
  if (typeof v === "number" && Number.isFinite(v)) return [v];
  if (!Array.isArray(v)) return [];
  return v.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
}

export function assessMenAtArmsReliability(military: MilitaryInfo): MenAtArmsReliability {
  const nonLevyNonChampionMaxStrength =
    military.strengthWithoutHires !== null && military.levy !== null
      ? Math.max(0, military.strengthWithoutHires - military.levy - military.champions.current)
      : null;

  const recoveredRegimentCount = military.menAtArms.regiments.length;
  const recoveredMaxSoldiers = military.menAtArms.totalMaxSoldiers;
  const recoveredForComparison =
    recoveredMaxSoldiers ?? (recoveredRegimentCount === 0 ? 0 : null);
  const discrepancy =
    nonLevyNonChampionMaxStrength !== null && recoveredForComparison !== null
      ? nonLevyNonChampionMaxStrength - recoveredForComparison
      : null;

  const breakdownReliable =
    military.menAtArms.source !== "unavailable" &&
    nonLevyNonChampionMaxStrength !== null &&
    recoveredForComparison !== null &&
    Math.abs(discrepancy ?? Number.POSITIVE_INFINITY) < 0.01;

  return {
    breakdownReliable,
    recoveredRegimentCount,
    nonLevyNonChampionMaxStrength,
    recoveredMaxSoldiers,
    discrepancy,
    limitation: breakdownReliable
      ? null
      : "Global regiment linking does not reconcile with mobilisation totals. nonLevyNonChampionMaxStrength can include Men-at-Arms and special troops; do not interpret slotsUsed=0 or an empty regiments list as confirmed zero Men-at-Arms.",
  };
}

/**
 * Build the same best-effort province -> landed-title mapping used by operational-army
 * extraction. Barony mappings win over county/upper-tier fallbacks when a save exposes
 * more than one title reference for the same province.
 */
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

function titleBelongsToDomain(q: Query, titleId: number, domainIds: Set<number>): boolean {
  let current: number | null = titleId;
  for (let depth = 0; depth < 5 && current !== null; depth += 1) {
    if (domainIds.has(current)) return true;
    current = num(q.at(`/landed_titles/landed_titles/${current}/de_jure_liege`));
  }
  return false;
}

/**
 * Raid records identify their target by province ID, while landed_data.domain contains
 * title IDs. Raw reference matching therefore misses real raids against the player.
 * Reconcile the two namespaces through the landed-title province mapping and keep the
 * most relevant raids first in snapshots.
 */
export function correctRaidDomainRelevance(q: Query, military: MilitaryInfo): MilitaryInfo {
  const playerId = num(q.at("/played_character/character"));
  if (playerId === null || military.raids.source === "unavailable") return military;

  const domainIds = new Set(numberList(q.at(`/living/${playerId}/landed_data/domain`)));
  if (domainIds.size === 0) return military;
  const provinceMap = provinceTitleMap(q);

  const records = military.raids.records.map((record) => {
    const rawProvince = record.fields["province"];
    const provinceId = typeof rawProvince === "number" && Number.isFinite(rawProvince)
      ? rawProvince
      : null;
    if (provinceId === null) return record;
    const titleId = provinceMap.get(provinceId);
    const provinceTargetsDomain =
      titleId !== undefined && titleBelongsToDomain(q, titleId, domainIds);
    return provinceTargetsDomain && !record.playerRelevant
      ? { ...record, playerRelevant: true }
      : record;
  });

  records.sort((a, b) => Number(b.playerRelevant) - Number(a.playerRelevant));
  return {
    ...military,
    raids: {
      ...military.raids,
      records,
      playerRelevantCount: records.filter((record) => record.playerRelevant).length,
    },
  };
}

/**
 * CK3 can represent an independent ruler with several top-level county titles.
 * The save-only extractor initially sees those as separate de-facto roots, but
 * strategically they are one realm because they share the same independent ruler.
 */
export function groupStrategicTargetsByRuler(expansion: ExpansionInfo): ExpansionInfo {
  const grouped = new Map<number, ExpansionInfo["strategicTargets"][number]>();

  for (const target of expansion.strategicTargets) {
    const existing = grouped.get(target.rulerId);
    if (!existing) {
      grouped.set(target.rulerId, {
        ...target,
        relevantTitles: [...target.relevantTitles],
      });
      continue;
    }

    const knownTitleIds = new Set(existing.relevantTitles.map((title) => title.id));
    for (const title of target.relevantTitles) {
      if (!knownTitleIds.has(title.id)) {
        existing.relevantTitles.push(title);
        knownTitleIds.add(title.id);
      }
    }
  }

  const strategicTargets = [...grouped.values()].sort((a, b) => {
    if (a.currentStrength === null && b.currentStrength === null)
      return a.realmName.localeCompare(b.realmName);
    if (a.currentStrength === null) return 1;
    if (b.currentStrength === null) return -1;
    return a.currentStrength - b.currentStrength;
  });

  return { ...expansion, strategicTargets };
}

export async function buildSnapshot(gamestate: Buffer, loc: Localizer): Promise<Snapshot> {
  return queryGamestate(gamestate, (q: Query): Snapshot => {
    loc.setTraitLookup((q.at("/traits_lookup") as string[]) ?? null);
    const date = formatCk3Date(q.at("/date"));
    const playerId = q.at("/played_character/character");
    if (typeof playerId !== "number") {
      throw new Error("CK3 save does not contain a numeric played_character/character id");
    }
    const alive = `/living/${playerId}/alive_data`;
    const overview: RealmOverview = {
      rulerName: str(q.at("/meta_data/meta_player_name")),
      date,
      primaryTitle: str(q.at("/meta_data/meta_title_name")),
      tier: num(q.at("/meta_data/meta_player_tier")) ?? 0,
      house: str(q.at("/meta_data/meta_house_name")),
      gold: num(q.at(`${alive}/gold/value`)),
      prestige: num(q.at(`${alive}/prestige/accumulated`)),
      piety: num(q.at(`${alive}/piety/accumulated`)),
    };
    const game = extractGameInfo(q);
    const ruler = extractCharacter(q, loc, playerId);
    const family = extractImmediateFamily(q, loc, playerId);
    const economy = extractRealmEconomy(q, loc);
    const council = extractCouncil(q, loc);
    const courtPositions = extractCourtPositions(q, loc);
    const militaryBase = correctRaidDomainRelevance(
      q,
      correctMilitaryLiveFields(q, extractMilitary(q, loc), loc),
    );
    const military: SnapshotMilitaryInfo = {
      ...militaryBase,
      menAtArmsReliability: assessMenAtArmsReliability(militaryBase),
      warScoreCapability: {
        fullPlayerVisibleWarScoreAvailable: false,
        source: "runtime_computed_not_serialized",
        reconstruction: "not_implemented",
        knownSerializedComponents: ["ticking_war_score", "controls_all", "battle_results"],
        limitation:
          "Exact UI war score requires reconstruction from occupation state, CB/static game-data scaling, battle results, prisoners/capital and other runtime modifiers; do not sum the serialized components as a total war score.",
      },
    };
    const operationalArmies = correctOperationalArmiesLiveFields(
      q,
      loc,
      extractOperationalArmies(q, loc),
    );
    const expansion = groupStrategicTargetsByRuler(extractExpansion(q, loc, military.wars));
    const succession = extractSuccession(q, loc);
    const diplomacy = extractDiplomacy(q, loc);
    const { factions, memberIds } = extractFactions(q, loc);
    const { vassals, total: vassalCount } = extractVassals(q, loc, memberIds);
    const titles = extractTitles(q, loc);
    return {
      date,
      parsedAt: Date.now(),
      overview,
      game,
      ruler,
      family,
      economy,
      council,
      courtPositions,
      military,
      operationalArmies,
      expansion,
      succession,
      diplomacy,
      factions,
      vassals,
      vassalCount,
      titles,
    };
  });
}
