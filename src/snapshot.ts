import { queryGamestate, type Query } from "./parser.js";
import type { Localizer } from "./localization.js";
import { formatCk3Date } from "./format.js";
import { extractMilitary, type MilitaryInfo } from "./extract/military.js";
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
export interface Snapshot {
  date: string;
  parsedAt: number;
  overview: RealmOverview;
  // Optional in the TypeScript interface so older stored/test snapshots remain readable.
  // buildSnapshot always emits these advisory sections for new snapshots.
  ruler?: CharacterInfo | null;
  family?: ImmediateFamilyInfo;
  economy?: RealmEconomyInfo;
  council?: CouncilInfo;
  courtPositions?: CourtPositionsInfo;
  military: MilitaryInfo;
  succession: SuccessionInfo;
  diplomacy: DiplomacyInfo;
  factions: FactionInfo[];
  vassals: VassalInfo[];
  vassalCount: number;
  expansion: ExpansionInfo;
  titles: TitlesInfo;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
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
    const ruler = extractCharacter(q, loc, playerId);
    const family = extractImmediateFamily(q, loc, playerId);
    const economy = extractRealmEconomy(q, loc);
    const council = extractCouncil(q, loc);
    const courtPositions = extractCourtPositions(q, loc);
    const military = extractMilitary(q, loc);
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
      ruler,
      family,
      economy,
      council,
      courtPositions,
      military,
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
