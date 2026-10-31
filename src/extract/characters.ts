import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { formatCk3Date } from "../format.js";
import { resolveTitleName } from "./titleUtils.js";

export interface CharacterFocus {
  type: string | null;
  date: string | null;
  changes: number | null;
  progress: number | null;
}

export interface CharacterInfo {
  id: number;
  name: string;
  birth: string | null;
  age: number | null;
  female: boolean;
  cultureId: number | null;
  faithId: number | null;
  spouseIds: number[];
  betrothedId: number | null;
  isMarried: boolean;
  employerId: number | null;
  councilTaskId: number | null;
  skills: {
    diplomacy: number;
    martial: number;
    stewardship: number;
    intrigue: number;
    learning: number;
    prowess: number;
  };
  traits: string[];
  gold: number | null;
  income: number | null;
  prestige: number | null;
  prestigeCurrency: number | null;
  piety: number | null;
  pietyCurrency: number | null;
  health: number | null;
  fertility: number | null;
  stress: number | null;
  focus: CharacterFocus | null;
  perks: string[];
  primaryTitle: string | null;
  claims: { title: string; pressed: boolean }[];
}

export interface FamilyMemberInfo extends CharacterInfo {
  relation: "spouse" | "child" | "betrothed";
  successionPosition: number | null;
}

export interface ImmediateFamilyInfo {
  primarySpouse: FamilyMemberInfo | null;
  spouses: FamilyMemberInfo[];
  betrothed: FamilyMemberInfo | null;
  children: FamilyMemberInfo[];
  primaryHeirId: number | null;
}

export interface CharacterMatch {
  id: number;
  name: string;
  primaryTitle: string | null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function numberList(v: unknown): number[] {
  if (typeof v === "number") return [v];
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is number => typeof item === "number");
}

function stringList(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (!Array.isArray(v)) return [];
  return v.map(String);
}

function dateParts(v: unknown): { year: number; month: number; day: number } | null {
  if (v instanceof Date) {
    return {
      year: v.getUTCFullYear(),
      month: v.getUTCMonth() + 1,
      day: v.getUTCDate(),
    };
  }

  const raw = typeof v === "string" ? v.replace(/"/g, "") : "";
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function ageAt(birthValue: unknown, currentValue: unknown): number | null {
  const birth = dateParts(birthValue);
  const current = dateParts(currentValue);
  if (!birth || !current) return null;

  let age = current.year - birth.year;
  if (current.month < birth.month || (current.month === birth.month && current.day < birth.day)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function extractCharacter(q: Query, loc: Localizer, id: number): CharacterInfo | null {
  const base = `/living/${id}`;
  const firstName = q.at(`${base}/first_name`);
  if (firstName === undefined) return null;

  const traitsLookup = q.at("/traits_lookup") as string[] | null | undefined;
  loc.setTraitLookup(traitsLookup ?? null);

  const skillArr = (q.at(`${base}/skill`) as number[] | undefined) ?? [];
  const skills = {
    diplomacy: skillArr[0] ?? 0,
    martial: skillArr[1] ?? 0,
    stewardship: skillArr[2] ?? 0,
    intrigue: skillArr[3] ?? 0,
    learning: skillArr[4] ?? 0,
    prowess: skillArr[5] ?? 0,
  };

  const traitIndices = (q.at(`${base}/traits`) as number[] | undefined) ?? [];
  const traits = traitIndices.map((idx) => loc.resolveTrait(idx));

  const birthValue = q.at(`${base}/birth`);
  const birth = birthValue === undefined ? null : formatCk3Date(birthValue);
  const age = ageAt(birthValue, q.at("/date"));
  const female = q.at(`${base}/female`) === true;
  const cultureId = numberOrNull(q.at(`${base}/culture`));
  const faithId = numberOrNull(q.at(`${base}/faith`));

  const family = `${base}/family_data`;
  const spouseIds = numberList(q.at(`${family}/spouse`));
  const primarySpouseId = numberOrNull(q.at(`${family}/primary_spouse`));
  if (primarySpouseId !== null && !spouseIds.includes(primarySpouseId)) spouseIds.unshift(primarySpouseId);
  const betrothedId = numberOrNull(q.at(`${family}/betrothed`));

  const court = `${base}/court_data`;
  const employerId = numberOrNull(q.at(`${court}/employer`));
  const councilTaskId = numberOrNull(q.at(`${court}/council_task`));

  const alive = `${base}/alive_data`;
  const gold = numberOrNull(q.at(`${alive}/gold/value`));
  const income = numberOrNull(q.at(`${alive}/income`));
  const prestige = numberOrNull(q.at(`${alive}/prestige/accumulated`));
  const prestigeCurrency = numberOrNull(q.at(`${alive}/prestige/currency`));
  const piety = numberOrNull(q.at(`${alive}/piety/accumulated`));
  const pietyCurrency = numberOrNull(q.at(`${alive}/piety/currency`));
  const health = numberOrNull(q.at(`${alive}/health`));
  const fertility = numberOrNull(q.at(`${alive}/fertility`));
  const stress = numberOrNull(q.at(`${alive}/stress`));

  const rawFocus = q.at(`${alive}/focus`) as
    | { type?: unknown; date?: unknown; changes?: unknown; progress?: unknown }
    | undefined;
  const focus = rawFocus
    ? {
        type: stringOrNull(rawFocus.type),
        date: rawFocus.date === undefined ? null : formatCk3Date(rawFocus.date),
        changes: numberOrNull(rawFocus.changes),
        progress: numberOrNull(rawFocus.progress),
      }
    : null;
  const perks = stringList(q.at(`${alive}/perk`));

  const domain = (q.at(`${base}/landed_data/domain`) as number[] | undefined) ?? [];
  const primaryTitleId = domain[0];
  const primaryTitle =
    primaryTitleId !== undefined ? resolveTitleName(q, loc, primaryTitleId) : null;

  const rawClaims =
    (q.at(`${alive}/claim`) as Array<{ title: number; pressed?: boolean }> | undefined) ?? [];
  const claims = rawClaims.map((c) => ({
    title: resolveTitleName(q, loc, c.title),
    pressed: c.pressed === true,
  }));

  return {
    id,
    name: String(firstName),
    birth,
    age,
    female,
    cultureId,
    faithId,
    spouseIds,
    betrothedId,
    isMarried: spouseIds.length > 0,
    employerId,
    councilTaskId,
    skills,
    traits,
    gold,
    income,
    prestige,
    prestigeCurrency,
    piety,
    pietyCurrency,
    health,
    fertility,
    stress,
    focus,
    perks,
    primaryTitle,
    claims,
  };
}

function familyMember(
  q: Query,
  loc: Localizer,
  id: number,
  relation: FamilyMemberInfo["relation"],
  succession: number[],
): FamilyMemberInfo | null {
  const character = extractCharacter(q, loc, id);
  if (!character) return null;
  const index = succession.indexOf(id);
  return {
    ...character,
    relation,
    successionPosition: index === -1 ? null : index + 1,
  };
}

export function extractImmediateFamily(q: Query, loc: Localizer, id: number): ImmediateFamilyInfo {
  const family = `/living/${id}/family_data`;
  const succession = numberList(q.at(`/living/${id}/landed_data/succession`));

  const primarySpouseId = numberOrNull(q.at(`${family}/primary_spouse`));
  const spouseIds = numberList(q.at(`${family}/spouse`));
  if (primarySpouseId !== null && !spouseIds.includes(primarySpouseId)) {
    spouseIds.unshift(primarySpouseId);
  }

  const spouses = spouseIds
    .map((spouseId) => familyMember(q, loc, spouseId, "spouse", succession))
    .filter((member): member is FamilyMemberInfo => member !== null);

  const primarySpouse =
    primarySpouseId === null
      ? (spouses[0] ?? null)
      : (spouses.find((member) => member.id === primarySpouseId) ?? null);

  const betrothedId = numberOrNull(q.at(`${family}/betrothed`));
  const betrothed =
    betrothedId === null ? null : familyMember(q, loc, betrothedId, "betrothed", succession);

  const children = numberList(q.at(`${family}/child`))
    .map((childId) => familyMember(q, loc, childId, "child", succession))
    .filter((member): member is FamilyMemberInfo => member !== null);

  return {
    primarySpouse,
    spouses,
    betrothed,
    children,
    primaryHeirId: succession[0] ?? null,
  };
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/_/g, "");
}

export function findCharacters(text: string, name: string): CharacterMatch[] {
  const start = text.indexOf("\nliving={");
  if (start === -1) return [];
  const endRe = /\n[a-z_][a-z0-9_]*=\{/g;
  endRe.lastIndex = start + "\nliving={".length;
  const endM = endRe.exec(text);
  const end = endM ? endM.index : text.length;
  const needle = normalizeName(name);
  const re = /(?:^|\n)(\d+)=\{\s*first_name="([^"]*)"/g;
  re.lastIndex = start;
  const out: CharacterMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < end) {
    if (normalizeName(m[2]!).includes(needle))
      out.push({ id: Number(m[1]!), name: m[2]!, primaryTitle: null });
  }
  return out;
}
