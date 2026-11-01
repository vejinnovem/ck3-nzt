import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

type Obj = Record<string, unknown>;
export type ReligiousRef = number | string | null;

export interface CountyContextDiagnostics {
  countyFieldNames: string[];
  countyPrimitiveFields: Record<string, string | number | boolean>;
  unresolved: string[];
}

export interface CountyContextInfo {
  titleId: number;
  key: string;
  name: string;
  holderId: number | null;
  holderName: string | null;
  control: number | null;
  development: number | null;
  cultureId: number | null;
  faith: ReligiousRef;
  faithName: string | null;
  rite: ReligiousRef;
  riteName: string | null;
  sameCultureAsRuler: boolean | null;
  sameFaithAsRuler: boolean | null;
  sameRiteAsRuler: boolean | null;
  popularOpinion: number | null;
  diagnostics?: CountyContextDiagnostics;
}

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scalarRef(value: unknown): ReligiousRef {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) return value;
  const record = obj(value);
  if (!record) return null;
  for (const key of ["id", "value", "faith", "rite", "type", "key"]) {
    const nested = record[key];
    if (typeof nested === "number" && Number.isFinite(nested)) return nested;
    if (typeof nested === "string" && nested.length > 0) return nested;
  }
  return null;
}

function sameRef(a: ReligiousRef, b: ReligiousRef): boolean | null {
  if (a === null || b === null) return null;
  return a === b;
}

function localizedRef(loc: Localizer, value: ReligiousRef): string | null {
  if (typeof value !== "string") return null;
  const resolved = loc.resolve(value);
  if (resolved !== value) return resolved;
  for (const suffix of ["_name", "_adj"]) {
    const candidate = `${value}${suffix}`;
    const localized = loc.resolve(candidate);
    if (localized !== candidate) return localized;
  }
  return value;
}

function directPrimitiveFields(record: Obj | null, limit = 32): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!record) return out;
  for (const [key, value] of Object.entries(record)) {
    if (Object.keys(out).length >= limit) break;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function titleKey(q: Query, titleId: number): string {
  const value = q.at(`/landed_titles/landed_titles/${titleId}/key`);
  return typeof value === "string" ? value : "";
}

function characterName(q: Query, id: number | null): string | null {
  if (id === null) return null;
  const value = q.at(`/living/${id}/first_name`);
  return typeof value === "string" ? value : null;
}

function rulerReligionContext(q: Query): {
  cultureId: number | null;
  faith: ReligiousRef;
  rite: ReligiousRef;
} {
  const playerId = num(q.at("/played_character/character"));
  if (playerId === null) return { cultureId: null, faith: null, rite: null };
  const base = `/living/${playerId}`;
  const riteCandidates = [
    q.at(`${base}/rite`),
    q.at(`${base}/state_rite`),
    q.at(`${base}/religion_data/rite`),
    q.at(`${base}/alive_data/rite`),
  ];
  return {
    cultureId: num(q.at(`${base}/culture`)),
    faith: scalarRef(q.at(`${base}/faith`)),
    rite: riteCandidates.map(scalarRef).find((value) => value !== null) ?? null,
  };
}

function popularOpinion(record: Obj | null): number | null {
  if (!record) return null;
  for (const key of ["popular_opinion", "popular_opinion_value", "county_popular_opinion"]) {
    const direct = num(record[key]);
    if (direct !== null) return direct;
    const nested = obj(record[key]);
    const nestedValue = nested ? num(nested["value"]) : null;
    if (nestedValue !== null) return nestedValue;
  }
  return null;
}

function countyReligiousRef(record: Obj | null, keys: string[]): ReligiousRef {
  if (!record) return null;
  for (const key of keys) {
    const value = scalarRef(record[key]);
    if (value !== null) return value;
  }
  return null;
}

export function extractCountyContext(
  q: Query,
  loc: Localizer,
  titleId: number,
): CountyContextInfo | null {
  const key = titleKey(q, titleId);
  if (titleTierFromKey(key) !== "county") return null;
  const title = obj(q.at(`/landed_titles/landed_titles/${titleId}`));
  const county = obj(q.at(`/county_manager/counties/${key}`));
  const holderId = title ? num(title["holder"]) : null;
  const ruler = rulerReligionContext(q);
  const cultureId = county ? num(county["culture"]) : null;
  const faith = countyReligiousRef(county, ["faith", "state_faith", "religion"]);
  const rite = countyReligiousRef(county, [
    "rite",
    "state_rite",
    "religious_rite",
    "rite_id",
  ]);
  const control = county
    ? (num(county["county_control"]) ?? num(county["control"]))
    : null;
  const popOpinion = popularOpinion(county);
  const unresolved: string[] = [];
  if (control === null) unresolved.push("control");
  if (cultureId === null) unresolved.push("culture");
  if (faith === null) unresolved.push("faith");
  if (rite === null) unresolved.push("rite");
  if (popOpinion === null) unresolved.push("popular_opinion");

  const result: CountyContextInfo = {
    titleId,
    key,
    name: resolveTitleName(q, loc, titleId),
    holderId,
    holderName: characterName(q, holderId),
    control,
    development: county ? num(county["development"]) : null,
    cultureId,
    faith,
    faithName: localizedRef(loc, faith),
    rite,
    riteName: localizedRef(loc, rite),
    sameCultureAsRuler:
      cultureId === null || ruler.cultureId === null ? null : cultureId === ruler.cultureId,
    sameFaithAsRuler: sameRef(faith, ruler.faith),
    sameRiteAsRuler: sameRef(rite, ruler.rite),
    popularOpinion: popOpinion,
  };

  if (unresolved.length > 0) {
    result.diagnostics = {
      countyFieldNames: county ? Object.keys(county).slice(0, 64) : [],
      countyPrimitiveFields: directPrimitiveFields(county),
      unresolved,
    };
  }
  return result;
}

export function countyContextsHeldBy(
  q: Query,
  loc: Localizer,
  characterId: number,
): CountyContextInfo[] {
  const titles = obj(q.at("/landed_titles/landed_titles"));
  if (!titles) return [];
  const result: CountyContextInfo[] = [];
  for (const [idText, raw] of Object.entries(titles)) {
    const title = obj(raw);
    const titleId = Number(idText);
    if (!title || !Number.isFinite(titleId) || num(title["holder"]) !== characterId) continue;
    if (titleTierFromKey(typeof title["key"] === "string" ? title["key"] : "") !== "county") {
      continue;
    }
    const context = extractCountyContext(q, loc, titleId);
    if (context) result.push(context);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
