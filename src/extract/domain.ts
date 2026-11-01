import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

export interface DomainBuildingInfo {
  type: string;
  name: string;
}

export interface DomainHoldingInfo {
  titleId: number;
  key: string;
  name: string;
  provinceId: number | null;
  holdingType: string | null;
  holdingTypeName: string | null;
  buildings: DomainBuildingInfo[];
  dataAvailable: boolean;
  dataSource: "province" | "landed_title_legacy" | "unavailable";
}

export interface RealmLawInfo {
  key: string;
  name: string;
}

export interface RealmAuthorityInfo {
  key: string;
  name: string;
  level: number | null;
  kind: "tribal" | "crown" | "other";
}

export interface RealmRulesInfo {
  governmentKey: string | null;
  governmentName: string | null;
  governmentSource: "save" | "law_inference" | "unavailable";
  authority: RealmAuthorityInfo | null;
  laws: RealmLawInfo[];
}

export interface DomainCountyInfo {
  titleId: number;
  key: string;
  name: string;
  development: number | null;
  control: number | null;
  cultureId: number | null;
  faithId: number | null;
  capitalTitleId: number | null;
  capitalName: string | null;
  isRealmCapital: boolean;
}

export interface RealmEconomyInfo {
  gold: number | null;
  monthlyIncome: number | null;
  monthlyBalance: number | null;
  domainLimit: number | null;
  vassalLimit: number | null;
  heldTitleCount: number;
  heldCountyCount: number;
  realmCapitalTitleId: number | null;
  realmCapitalName: string | null;
  realmRules: RealmRulesInfo;
  counties: DomainCountyInfo[];
  holdings: DomainHoldingInfo[];
}

type Obj = Record<string, unknown>;

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

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

function localizedKey(loc: Localizer, key: string): string {
  const direct = loc.resolve(key);
  if (direct !== key) return direct;

  const candidates = [
    `${key}_name`,
    key.endsWith("_government") ? `${key}_name` : "",
    key.endsWith("_holding") ? `${key}_name` : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = loc.resolve(candidate);
    if (resolved !== candidate) return resolved;
  }
  return key;
}

function titleKey(q: Query, titleId: number): string {
  const value = q.at(`/landed_titles/landed_titles/${titleId}/key`);
  return typeof value === "string" ? value : "";
}

function capitalBaronyForCounty(q: Query, countyId: number, domain: number[]): number | null {
  const explicit = numberOrNull(q.at(`/landed_titles/landed_titles/${countyId}/capital`));
  if (
    explicit !== null &&
    explicit !== countyId &&
    titleTierFromKey(titleKey(q, explicit)) === "barony"
  ) {
    return explicit;
  }

  for (const titleId of domain) {
    const key = titleKey(q, titleId);
    if (titleTierFromKey(key) !== "barony") continue;
    const liege = numberOrNull(q.at(`/landed_titles/landed_titles/${titleId}/de_jure_liege`));
    if (liege !== countyId) continue;
    if (q.at(`/landed_titles/landed_titles/${titleId}/capital_barony`) === true) return titleId;
  }
  return null;
}

function buildingTypes(value: unknown): string[] {
  const result: string[] = [];
  const add = (entry: unknown, depth = 0): void => {
    if (depth > 3 || entry === null || entry === undefined) return;
    if (typeof entry === "string") {
      result.push(entry);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item) => add(item, depth + 1));
      return;
    }
    const record = obj(entry);
    if (!record) return;
    const type = stringOrNull(record["type"]);
    if (type) {
      result.push(type);
      return;
    }
    Object.values(record).forEach((item) => add(item, depth + 1));
  };

  add(value);
  return [...new Set(result)];
}

function provinceRecord(q: Query, provinceId: number): Obj | null {
  return obj(q.at(`/provinces/${provinceId}`)) ?? obj(q.at(`/provinces/provinces/${provinceId}`));
}

function provinceIdForBarony(q: Query, titleId: number): number | null {
  const title = obj(q.at(`/landed_titles/landed_titles/${titleId}`));
  const candidates = [
    title ? numberOrNull(title["province"]) : null,
    title ? numberOrNull(title["capital_province"]) : null,
    title ? numberOrNull(title["capital"]) : null,
    titleId,
  ].filter((value): value is number => value !== null);

  for (const candidate of [...new Set(candidates)]) {
    if (provinceRecord(q, candidate)) return candidate;
  }

  const provinces = obj(q.at("/provinces")) ?? obj(q.at("/provinces/provinces"));
  if (!provinces) return null;
  for (const [provinceIdText, rawProvince] of Object.entries(provinces)) {
    const province = obj(rawProvince);
    if (!province) continue;
    const linkedTitle =
      numberOrNull(province["title"]) ??
      numberOrNull(province["title_id"]) ??
      numberOrNull(province["barony"]) ??
      numberOrNull(province["holding_title"]);
    if (linkedTitle !== titleId) continue;
    const provinceId = Number(provinceIdText);
    if (Number.isFinite(provinceId)) return provinceId;
  }
  return null;
}

function extractHolding(q: Query, loc: Localizer, titleId: number): DomainHoldingInfo {
  const key = titleKey(q, titleId);
  const provinceId = provinceIdForBarony(q, titleId);
  const province = provinceId === null ? null : provinceRecord(q, provinceId);
  const provinceHolding = province ? obj(province["holding"]) : null;
  const provinceItselfIsHolding =
    province !== null &&
    (stringOrNull(province["type"]) !== null || province["buildings"] !== undefined)
      ? province
      : null;
  const legacyHolding = obj(q.at(`/landed_titles/landed_titles/${titleId}/holding`));
  const holding = provinceHolding ?? provinceItselfIsHolding ?? legacyHolding;
  const dataSource: DomainHoldingInfo["dataSource"] =
    provinceHolding || provinceItselfIsHolding
      ? "province"
      : legacyHolding
        ? "landed_title_legacy"
        : "unavailable";
  const holdingType = holding ? stringOrNull(holding["type"]) : null;
  const buildings = holding
    ? buildingTypes(holding["buildings"]).map((type) => ({
        type,
        name: localizedKey(loc, type),
      }))
    : [];

  return {
    titleId,
    key,
    name: resolveTitleName(q, loc, titleId),
    provinceId,
    holdingType,
    holdingTypeName: holdingType === null ? null : localizedKey(loc, holdingType),
    buildings,
    dataAvailable: holding !== null,
    dataSource,
  };
}

function extractRealmRules(q: Query, loc: Localizer, playerId: number): RealmRulesInfo {
  const landed = `/living/${playerId}/landed_data`;
  const lawKeys = stringList(q.at(`${landed}/laws`));
  const laws = lawKeys.map((key) => ({ key, name: localizedKey(loc, key) }));

  const authorityKey = lawKeys.find((key) => /authority_\d+$/.test(key)) ?? null;
  let authority: RealmAuthorityInfo | null = null;
  if (authorityKey) {
    const levelMatch = /authority_(\d+)$/.exec(authorityKey);
    authority = {
      key: authorityKey,
      name: localizedKey(loc, authorityKey),
      level: levelMatch ? Number(levelMatch[1]) : null,
      kind: authorityKey.startsWith("tribal_authority_")
        ? "tribal"
        : authorityKey.startsWith("crown_authority_")
          ? "crown"
          : "other",
    };
  }

  const directGovernment =
    stringOrNull(q.at(`${landed}/government`)) ??
    stringOrNull(q.at(`/living/${playerId}/government`)) ??
    stringOrNull(q.at(`/living/${playerId}/alive_data/government`));

  let governmentKey = directGovernment;
  let governmentSource: RealmRulesInfo["governmentSource"] = directGovernment
    ? "save"
    : "unavailable";

  if (!governmentKey && authority?.kind === "tribal") {
    governmentKey = "tribal_government";
    governmentSource = "law_inference";
  }

  return {
    governmentKey,
    governmentName: governmentKey === null ? null : localizedKey(loc, governmentKey),
    governmentSource,
    authority,
    laws,
  };
}

export function extractRealmEconomy(q: Query, loc: Localizer): RealmEconomyInfo {
  const playerId = numberOrNull(q.at("/played_character/character"));
  if (playerId === null) {
    return {
      gold: null,
      monthlyIncome: null,
      monthlyBalance: null,
      domainLimit: null,
      vassalLimit: null,
      heldTitleCount: 0,
      heldCountyCount: 0,
      realmCapitalTitleId: null,
      realmCapitalName: null,
      realmRules: {
        governmentKey: null,
        governmentName: null,
        governmentSource: "unavailable",
        authority: null,
        laws: [],
      },
      counties: [],
      holdings: [],
    };
  }

  const landed = `/living/${playerId}/landed_data`;
  const alive = `/living/${playerId}/alive_data`;
  const domain = numberList(q.at(`${landed}/domain`));
  const realmCapitalTitleId = numberOrNull(q.at(`${landed}/realm_capital`));

  const counties: DomainCountyInfo[] = [];
  const holdings: DomainHoldingInfo[] = [];
  for (const titleId of domain) {
    const key = titleKey(q, titleId);
    const tier = titleTierFromKey(key);
    if (tier === "barony") {
      holdings.push(extractHolding(q, loc, titleId));
      continue;
    }
    if (tier !== "county") continue;

    const countyPath = `/county_manager/counties/${key}`;
    const capitalTitleId = capitalBaronyForCounty(q, titleId, domain);
    const control =
      numberOrNull(q.at(`${countyPath}/county_control`)) ??
      numberOrNull(q.at(`${countyPath}/control`));
    counties.push({
      titleId,
      key,
      name: resolveTitleName(q, loc, titleId),
      development: numberOrNull(q.at(`${countyPath}/development`)),
      control,
      cultureId: numberOrNull(q.at(`${countyPath}/culture`)),
      faithId: numberOrNull(q.at(`${countyPath}/faith`)),
      capitalTitleId,
      capitalName: capitalTitleId === null ? null : resolveTitleName(q, loc, capitalTitleId),
      isRealmCapital:
        realmCapitalTitleId !== null &&
        (realmCapitalTitleId === titleId || realmCapitalTitleId === capitalTitleId),
    });
  }

  return {
    gold: numberOrNull(q.at(`${alive}/gold/value`)),
    monthlyIncome: numberOrNull(q.at(`${alive}/income`)),
    monthlyBalance: numberOrNull(q.at(`${landed}/balance`)),
    domainLimit: numberOrNull(q.at(`${landed}/domain_limit`)),
    vassalLimit: numberOrNull(q.at(`${landed}/vassal_limit`)),
    heldTitleCount: domain.length,
    heldCountyCount: counties.length,
    realmCapitalTitleId,
    realmCapitalName:
      realmCapitalTitleId === null ? null : resolveTitleName(q, loc, realmCapitalTitleId),
    realmRules: extractRealmRules(q, loc, playerId),
    counties,
    holdings,
  };
}
