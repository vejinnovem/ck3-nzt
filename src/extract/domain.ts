import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

export interface DomainCountyInfo {
  titleId: number;
  key: string;
  name: string;
  development: number | null;
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
  counties: DomainCountyInfo[];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function numberList(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function titleKey(q: Query, titleId: number): string {
  const value = q.at(`/landed_titles/landed_titles/${titleId}/key`);
  return typeof value === "string" ? value : "";
}

function capitalBaronyForCounty(q: Query, countyId: number, domain: number[]): number | null {
  const explicit = numberOrNull(q.at(`/landed_titles/landed_titles/${countyId}/capital`));
  if (explicit !== null) return explicit;

  for (const titleId of domain) {
    const key = titleKey(q, titleId);
    if (titleTierFromKey(key) !== "barony") continue;
    const liege = numberOrNull(q.at(`/landed_titles/landed_titles/${titleId}/de_jure_liege`));
    if (liege !== countyId) continue;
    if (q.at(`/landed_titles/landed_titles/${titleId}/capital_barony`) === true) return titleId;
  }
  return null;
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
      counties: [],
    };
  }

  const landed = `/living/${playerId}/landed_data`;
  const alive = `/living/${playerId}/alive_data`;
  const domain = numberList(q.at(`${landed}/domain`));
  const realmCapitalTitleId = numberOrNull(q.at(`${landed}/realm_capital`));

  const counties: DomainCountyInfo[] = [];
  for (const titleId of domain) {
    const key = titleKey(q, titleId);
    if (titleTierFromKey(key) !== "county") continue;

    const countyPath = `/county_manager/counties/${key}`;
    const capitalTitleId = capitalBaronyForCounty(q, titleId, domain);
    counties.push({
      titleId,
      key,
      name: resolveTitleName(q, loc, titleId),
      development: numberOrNull(q.at(`${countyPath}/development`)),
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
    counties,
  };
}
