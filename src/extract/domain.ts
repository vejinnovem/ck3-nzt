import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

export interface DomainBuildingInfo {
  type: string;
  name: string;
}

type DiagnosticPrimitive = string | number | boolean;

export interface HoldingProvinceReferenceDiagnostic {
  provinceId: number;
  matched: "barony" | "county";
  fieldPath: string;
}

export interface DomainHoldingDiagnostics {
  /** Direct field names on the barony title record. */
  titleFieldNames: string[];
  /** Primitive direct fields only; bounded so diagnostics never dump title history. */
  titlePrimitiveFields: Record<string, DiagnosticPrimitive>;
  /** Direct field names on the county_manager record for the barony's de-jure county. */
  countyFieldNames: string[];
  /** Primitive direct county fields only. */
  countyPrimitiveFields: Record<string, DiagnosticPrimitive>;
  /** Which CK3 province namespace was visible through jomini. */
  provinceDatabase: "nested" | "root" | "unavailable";
  provinceRecordCount: number;
  /** Union of field names from a few province records, useful for mapping version-specific schemas. */
  provinceSampleFieldNames: string[];
  /** Numeric references to this barony/county found under province records, regardless of field name. */
  provinceReferenceMatches: HoldingProvinceReferenceDiagnostic[];
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
  /** Emitted only when holding data could not be linked, to teach the parser real-save layouts. */
  diagnostics?: DomainHoldingDiagnostics;
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
  return obj(q.at(`/provinces/provinces/${provinceId}`)) ?? obj(q.at(`/provinces/${provinceId}`));
}

function provinceDatabase(q: Query): {
  source: DomainHoldingDiagnostics["provinceDatabase"];
  records: Obj | null;
} {
  const nested = obj(q.at("/provinces/provinces"));
  if (nested) return { source: "nested", records: nested };
  const root = obj(q.at("/provinces"));
  if (root) return { source: "root", records: root };
  return { source: "unavailable", records: null };
}

function provinceIdForBarony(q: Query, titleId: number): number | null {
  const title = obj(q.at(`/landed_titles/landed_titles/${titleId}`));

  // Only fields whose semantics explicitly identify a province are safe direct candidates.
  // A title ID is NOT a province ID, and `capital` is a title reference in landed_titles.
  const candidates = [
    title ? numberOrNull(title["province"]) : null,
    title ? numberOrNull(title["capital_province"]) : null,
  ].filter((value): value is number => value !== null);

  for (const candidate of [...new Set(candidates)]) {
    if (provinceRecord(q, candidate)) return candidate;
  }

  // Some saves expose an inverse province -> title link instead. Prefer the nested
  // province database when both the wrapper and nested object exist.
  const { records: provinces } = provinceDatabase(q);
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

function directPrimitiveFields(record: Obj | null, limit = 32): Record<string, DiagnosticPrimitive> {
  const result: Record<string, DiagnosticPrimitive> = {};
  if (!record) return result;
  for (const [key, value] of Object.entries(record)) {
    if (Object.keys(result).length >= limit) break;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function findNumericReferencePaths(
  value: unknown,
  targets: Map<number, "barony" | "county">,
  prefix = "",
  depth = 0,
  limit = 12,
): Array<{ matched: "barony" | "county"; fieldPath: string }> {
  if (depth > 4 || value === null || value === undefined || limit <= 0) return [];
  if (typeof value === "number" && Number.isFinite(value)) {
    const matched = targets.get(value);
    return matched ? [{ matched, fieldPath: prefix || "value" }] : [];
  }
  if (Array.isArray(value)) {
    const result: Array<{ matched: "barony" | "county"; fieldPath: string }> = [];
    for (let index = 0; index < value.length && result.length < limit; index += 1) {
      result.push(
        ...findNumericReferencePaths(
          value[index],
          targets,
          `${prefix}[${index}]`,
          depth + 1,
          limit - result.length,
        ),
      );
    }
    return result;
  }
  const record = obj(value);
  if (!record) return [];
  const result: Array<{ matched: "barony" | "county"; fieldPath: string }> = [];
  for (const [key, child] of Object.entries(record)) {
    if (result.length >= limit) break;
    const childPath = prefix ? `${prefix}.${key}` : key;
    result.push(
      ...findNumericReferencePaths(
        child,
        targets,
        childPath,
        depth + 1,
        limit - result.length,
      ),
    );
  }
  return result;
}

function holdingDiagnostics(q: Query, titleId: number): DomainHoldingDiagnostics {
  const title = obj(q.at(`/landed_titles/landed_titles/${titleId}`));
  const countyId = title ? numberOrNull(title["de_jure_liege"]) : null;
  const countyKey = countyId === null ? "" : titleKey(q, countyId);
  const county = countyKey ? obj(q.at(`/county_manager/counties/${countyKey}`)) : null;
  const { source, records: provinces } = provinceDatabase(q);

  const provinceReferenceMatches: HoldingProvinceReferenceDiagnostic[] = [];
  const targets = new Map<number, "barony" | "county">([[titleId, "barony"]]);
  if (countyId !== null) targets.set(countyId, "county");

  const provinceSampleFieldNames = new Set<string>();
  if (provinces) {
    let sampled = 0;
    for (const [provinceIdText, rawProvince] of Object.entries(provinces)) {
      const province = obj(rawProvince);
      if (!province) continue;
      if (sampled < 4) {
        Object.keys(province).slice(0, 24).forEach((field) => provinceSampleFieldNames.add(field));
        sampled += 1;
      }
      if (provinceReferenceMatches.length >= 12) continue;
      const provinceId = Number(provinceIdText);
      if (!Number.isFinite(provinceId)) continue;
      const matches = findNumericReferencePaths(
        province,
        targets,
        "",
        0,
        12 - provinceReferenceMatches.length,
      );
      for (const match of matches) {
        provinceReferenceMatches.push({ provinceId, ...match });
      }
    }
  }

  return {
    titleFieldNames: title ? Object.keys(title).slice(0, 64) : [],
    titlePrimitiveFields: directPrimitiveFields(title),
    countyFieldNames: county ? Object.keys(county).slice(0, 64) : [],
    countyPrimitiveFields: directPrimitiveFields(county),
    provinceDatabase: source,
    provinceRecordCount: provinces ? Object.keys(provinces).length : 0,
    provinceSampleFieldNames: [...provinceSampleFieldNames].slice(0, 64),
    provinceReferenceMatches,
  };
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

  const result: DomainHoldingInfo = {
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
  if (holding === null) result.diagnostics = holdingDiagnostics(q, titleId);
  return result;
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
