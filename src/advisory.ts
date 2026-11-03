import type { Snapshot } from "./snapshot.js";
import { skillSemantics, type SkillSemantics } from "./skills.js";

export interface ChampionQualityProfile {
  id: number;
  prowess: number | null;
}

export interface RegimentQualityProfile {
  id: number;
  type: string;
  current: number | null;
  max: number | null;
  reinforcementMissing: number | null;
  /** Serialized max is the current regiment cap, not the UI's maximum size-level headroom. */
  sizeUpgradeHeadroomAvailable: false;
  stationed: Snapshot["military"]["menAtArms"]["regiments"][number]["stationed"];
}

export interface ArmyQualityDiagnostics {
  source: "save_derived_best_effort";
  qualityIndicator: {
    uiDiamonds: null;
    uiEquivalentAvailable: false;
    limitation: string;
  };
  levyCurrent: number | null;
  menAtArmsCurrent: number;
  menAtArmsMax: number | null;
  championCount: number;
  levyShareOfCurrentStrength: number | null;
  menAtArmsShareOfCurrentStrength: number | null;
  levyToMenAtArmsRatio: number | null;
  professionalCoreUnderrepresented: boolean | null;
  slotsUsed: number;
  slotsMax: number | null;
  freeSlots: number | null;
  champions: ChampionQualityProfile[];
  regiments: RegimentQualityProfile[];
  creationAndUpgradeCostsAvailable: false;
  exactCombatStatsAvailable: false;
  limitations: string[];
}

export interface PrimarySpouseAdvisory {
  id: number;
  name: string;
  dynastyHouseId: number | null;
  dynastyHouseName: string | null;
  isLowborn: boolean;
  serializedSkills: Snapshot["family"] extends infer _T
    ? {
        diplomacy: number;
        martial: number;
        stewardship: number;
        intrigue: number;
        learning: number;
        prowess: number;
      }
    : never;
  skillSemantics: SkillSemantics;
}

export interface MarriageAdvisory {
  source: "snapshot_and_ck3_1_20_rule";
  primaryTitleTier: number;
  currentPrimarySpouse: PrimarySpouseAdvisory | null;
  lowbornPrimarySpouseRisk: "none" | "action_required";
  estimatedLegitimacyLoss: number | null;
  estimateBasis: string | null;
  warning: string | null;
  candidateRules: {
    lowbornDetection: string;
    skillValues: string;
  };
}

export interface AdvisoryContext {
  armyQuality: ArmyQualityDiagnostics;
  marriage: MarriageAdvisory;
}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function collectProwess(value: unknown, out: Map<number, number>, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectProwess(item, out, depth + 1);
    return;
  }
  const record = obj(value);
  if (!record) return;
  const id = typeof record["id"] === "number" ? record["id"] : null;
  const skills = obj(record["skills"]);
  const prowess = skills && typeof skills["prowess"] === "number" ? skills["prowess"] : null;
  if (id !== null && prowess !== null && !out.has(id)) out.set(id, prowess);
  for (const entry of Object.values(record)) {
    if (entry !== null && typeof entry === "object") collectProwess(entry, out, depth + 1);
  }
}

function safeShare(value: number | null, total: number | null): number | null {
  if (value === null || total === null || total <= 0) return null;
  return value / total;
}

export function buildArmyQualityDiagnostics(snapshot: Snapshot): ArmyQualityDiagnostics {
  const military = snapshot.military;
  const maa = military.menAtArms;
  const levy = military.levy;
  const currentStrength = military.currentStrength;
  const maaCurrent = maa?.totalCurrentSoldiers ?? 0;
  const maaMax = maa?.totalMaxSoldiers ?? null;
  const championIds = military.champions?.ids ?? [];
  const prowessById = new Map<number, number>();
  for (const section of [
    snapshot.ruler,
    snapshot.family,
    snapshot.council,
    snapshot.vassals,
    snapshot.succession,
  ]) {
    collectProwess(section, prowessById);
  }

  const slotsUsed = maa?.slotsUsed ?? 0;
  const slotsMax = maa?.slotsMax ?? null;
  const freeSlots = slotsMax === null ? null : Math.max(0, slotsMax - slotsUsed);
  const levyToMenAtArmsRatio =
    levy !== null && maaCurrent > 0 ? levy / maaCurrent : maaCurrent === 0 ? null : 0;
  const compositionTotal = levy === null ? null : levy + maaCurrent;
  const professionalCoreUnderrepresented =
    compositionTotal === null || compositionTotal <= 0 ? null : maaCurrent / compositionTotal < 0.2;

  const champions = championIds.map((id) => ({ id, prowess: prowessById.get(id) ?? null }));
  const regiments = (maa?.regiments ?? []).map((regiment) => ({
    id: regiment.id,
    type: regiment.type,
    current: regiment.current,
    max: regiment.max,
    reinforcementMissing:
      regiment.current === null || regiment.max === null
        ? null
        : Math.max(0, regiment.max - regiment.current),
    sizeUpgradeHeadroomAvailable: false as const,
    stationed: regiment.stationed,
  }));

  const limitations = [
    "CK3's player-visible army quality diamonds are runtime-derived and are not reconstructed; the export reports the underlying composition instead.",
    "Serialized regiment max is the current regiment soldier cap, not the maximum UI size level, so size-upgrade headroom is unknown.",
    "Men-at-Arms creation/upgrade/upkeep costs and fully modified combat stats require static/runtime game data and are not inferred from save totals.",
  ];
  if (slotsMax === null) limitations.push("Men-at-Arms slot cap is not serialized/reconstructed for this snapshot.");
  if (champions.some((champion) => champion.prowess === null)) {
    limitations.push("Prowess is unavailable for some champion IDs because their character profile is not present in the exported advisory sections.");
  }
  if (regiments.some((regiment) => regiment.stationed === null)) {
    limitations.push("Stationing is unresolved for one or more Men-at-Arms regiments.");
  }
  if (military.menAtArmsReliability?.breakdownReliable === false) {
    limitations.push(military.menAtArmsReliability.limitation ?? "Men-at-Arms breakdown does not reconcile with realm mobilisation totals.");
  }

  return {
    source: "save_derived_best_effort",
    qualityIndicator: {
      uiDiamonds: null,
      uiEquivalentAvailable: false,
      limitation:
        "The diamonds are an advisory UI gauge, not a separate combat modifier. Use troop composition and combat stats for decisions.",
    },
    levyCurrent: levy,
    menAtArmsCurrent: maaCurrent,
    menAtArmsMax: maaMax,
    championCount: military.champions?.current ?? championIds.length,
    levyShareOfCurrentStrength: safeShare(levy, currentStrength),
    menAtArmsShareOfCurrentStrength: safeShare(maaCurrent, currentStrength),
    levyToMenAtArmsRatio,
    professionalCoreUnderrepresented,
    slotsUsed,
    slotsMax,
    freeSlots,
    champions,
    regiments,
    creationAndUpgradeCostsAvailable: false,
    exactCombatStatsAvailable: false,
    limitations,
  };
}

export function buildMarriageAdvisory(snapshot: Snapshot): MarriageAdvisory {
  const spouse = snapshot.family?.primarySpouse ?? null;
  const primaryTitleTier = snapshot.overview.tier;
  const currentPrimarySpouse = spouse
    ? {
        id: spouse.id,
        name: spouse.name,
        dynastyHouseId: spouse.dynastyHouseId,
        dynastyHouseName: spouse.dynastyHouseName,
        isLowborn: spouse.dynastyHouseId === null,
        serializedSkills: { ...spouse.skills },
        skillSemantics: skillSemantics(spouse.skills),
      }
    : null;
  const isLowborn = currentPrimarySpouse?.isLowborn === true;

  // CK3 1.20 scripted marriage effect: medium_legitimacy_loss (100) * primary title tier.
  // Keep this explicitly labelled as a version-scoped estimate rather than pretending the
  // save serializes the prospective interaction cost.
  const estimatedLegitimacyLoss =
    isLowborn && primaryTitleTier > 0 ? 100 * primaryTitleTier : null;
  const estimateBasis = isLowborn
    ? "CK3 1.20 primary-spouse lowborn marriage rule: medium legitimacy loss (100) x primary title tier. Static scripted values are not re-read from the installed game at export time."
    : null;

  return {
    source: "snapshot_and_ck3_1_20_rule",
    primaryTitleTier,
    currentPrimarySpouse,
    lowbornPrimarySpouseRisk: isLowborn ? "action_required" : "none",
    estimatedLegitimacyLoss,
    estimateBasis,
    warning: isLowborn
      ? `Primary spouse ${currentPrimarySpouse!.name} is lowborn. A primary-spouse marriage at title tier ${primaryTitleTier} is expected to cost about ${estimatedLegitimacyLoss ?? "unknown"} legitimacy under the supported CK3 1.20 rule.`
      : null,
    candidateRules: {
      lowbornDetection:
        "Treat a marriage candidate with no dynasty/house as lowborn and check the primary-spouse legitimacy penalty before recommending the match.",
      skillValues:
        "Use CK3 UI values for candidate comparison when visible. Exported character skills are serialized/base values and are not UI-equivalent unless effective skill reconstruction becomes available.",
    },
  };
}

export function attachAdvisoryContext<T extends Snapshot>(
  snapshot: T,
): T & { advisory: AdvisoryContext } {
  return Object.assign(snapshot, {
    advisory: {
      armyQuality: buildArmyQualityDiagnostics(snapshot),
      marriage: buildMarriageAdvisory(snapshot),
    },
  });
}
