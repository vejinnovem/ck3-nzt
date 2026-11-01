import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveDynastyHouseName } from "./characters.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

type Obj = Record<string, unknown>;
type Primitive = string | number | boolean;

export interface ImportantActionCharacterRef {
  field: string;
  id: number;
  name: string | null;
  dynastyHouseId: number | null;
  dynastyHouseName: string | null;
  primaryTitle: string | null;
}

export interface ImportantActionTitleRef {
  field: string;
  id: number;
  name: string | null;
  key: string | null;
}

export interface ImportantActionInfo {
  id: number | null;
  type: string | null;
  playerReferenced: boolean;
  characterRefs: ImportantActionCharacterRef[];
  titleRefs: ImportantActionTitleRef[];
  targetCharacterRefs: ImportantActionCharacterRef[];
  targetTitleRefs: ImportantActionTitleRef[];
  primitiveFields: Record<string, Primitive>;
  scopePrimitiveFields: Record<string, Primitive>;
  fieldNames: string[];
}

export interface ImportantActionsInfo {
  activeCount: number;
  shownCount: number;
  playerReferencedCount: number;
  actions: ImportantActionInfo[];
  source: "important_action_manager.active" | "unavailable";
  limitation: string | null;
}

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberList(value: unknown): number[] {
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
}

function collectionEntries(value: unknown): Array<[string, Obj]> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const record = obj(entry);
      return record ? [[String(index), record] as [string, Obj]] : [];
    });
  }
  const record = obj(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([key, entry]) => {
    const child = obj(entry);
    return child ? [[key, child] as [string, Obj]] : [];
  });
}

function primitiveFields(record: Obj, limit = 48): Record<string, Primitive> {
  const result: Record<string, Primitive> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Object.keys(result).length >= limit) break;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function flattenPrimitiveFields(
  value: unknown,
  prefix = "scope",
  limit = 96,
  maxDepth = 8,
): Record<string, Primitive> {
  const result: Record<string, Primitive> = {};

  const visit = (current: unknown, path: string, depth: number) => {
    if (Object.keys(result).length >= limit || depth > maxDepth) return;
    if (
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      result[path] = current;
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    const record = obj(current);
    if (!record) return;
    for (const [key, entry] of Object.entries(record)) {
      visit(entry, path ? `${path}.${key}` : key, depth + 1);
      if (Object.keys(result).length >= limit) break;
    }
  };

  visit(value, prefix, 0);
  return result;
}

function referenceNumber(value: unknown, preferredKeys: string[]): number | null {
  const direct = num(value);
  if (direct !== null) return direct;
  const record = obj(value);
  if (!record) return null;
  for (const key of preferredKeys) {
    const found = num(record[key]);
    if (found !== null) return found;
  }
  return null;
}

function characterName(q: Query, id: number): string | null {
  const value = q.at(`/living/${id}/first_name`);
  return typeof value === "string" ? value : null;
}

function primaryTitleName(q: Query, loc: Localizer, id: number): string | null {
  const domain = numberList(q.at(`/living/${id}/landed_data/domain`));
  const primaryTitleId = domain[0];
  return primaryTitleId === undefined ? null : resolveTitleName(q, loc, primaryTitleId);
}

function characterRef(
  q: Query,
  loc: Localizer,
  field: string,
  id: number,
): ImportantActionCharacterRef | null {
  const name = characterName(q, id);
  if (name === null) return null;
  const dynastyHouseId = num(q.at(`/living/${id}/dynasty_house`));
  return {
    field,
    id,
    name,
    dynastyHouseId,
    dynastyHouseName: resolveDynastyHouseName(q, loc, dynastyHouseId),
    primaryTitle: primaryTitleName(q, loc, id),
  };
}

function titleKey(q: Query, id: number): string | null {
  const value = q.at(`/landed_titles/landed_titles/${id}/key`);
  return typeof value === "string" ? value : null;
}

function titleRef(
  q: Query,
  loc: Localizer,
  field: string,
  id: number,
): ImportantActionTitleRef | null {
  const key = titleKey(q, id);
  if (key === null || titleTierFromKey(key) === "other") return null;
  return {
    field,
    id,
    name: resolveTitleName(q, loc, id),
    key,
  };
}

function pushUniqueCharacter(
  target: ImportantActionCharacterRef[],
  reference: ImportantActionCharacterRef | null,
) {
  if (!reference) return;
  if (target.some((entry) => entry.field === reference.field && entry.id === reference.id)) return;
  target.push(reference);
}

function pushUniqueTitle(target: ImportantActionTitleRef[], reference: ImportantActionTitleRef | null) {
  if (!reference) return;
  if (target.some((entry) => entry.field === reference.field && entry.id === reference.id)) return;
  target.push(reference);
}

const CHARACTER_SCOPE_TYPES = new Set(["char", "character"]);
const TITLE_SCOPE_TYPES = new Set([
  "lt",
  "title",
  "landed_title",
  "barony",
  "county",
  "duchy",
  "kingdom",
  "empire",
]);

function resolveScopeReferences(
  q: Query,
  loc: Localizer,
  scope: unknown,
): {
  characterRefs: ImportantActionCharacterRef[];
  titleRefs: ImportantActionTitleRef[];
} {
  const characterRefs: ImportantActionCharacterRef[] = [];
  const titleRefs: ImportantActionTitleRef[] = [];

  const visit = (current: unknown, path: string, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }

    const record = obj(current);
    if (record) {
      const scopeType = typeof record["type"] === "string" ? record["type"] : null;
      const identity = num(record["identity"]);
      if (scopeType !== null && identity !== null) {
        const identityPath = `${path}.identity`;
        if (CHARACTER_SCOPE_TYPES.has(scopeType)) {
          pushUniqueCharacter(characterRefs, characterRef(q, loc, identityPath, identity));
        } else if (TITLE_SCOPE_TYPES.has(scopeType)) {
          pushUniqueTitle(titleRefs, titleRef(q, loc, identityPath, identity));
        }

        for (const [key, entry] of Object.entries(record)) {
          if (key === "type" || key === "identity") continue;
          visit(entry, path ? `${path}.${key}` : key, depth + 1);
        }
        return;
      }

      for (const [key, entry] of Object.entries(record)) {
        visit(entry, path ? `${path}.${key}` : key, depth + 1);
      }
      return;
    }

    const id = num(current);
    if (id !== null) {
      // Untyped legacy/wrapper values remain best-effort: resolve against both namespaces.
      // Typed scope objects above must not be cross-resolved because character IDs and
      // landed-title IDs are independent namespaces and can legitimately collide.
      pushUniqueCharacter(characterRefs, characterRef(q, loc, path, id));
      pushUniqueTitle(titleRefs, titleRef(q, loc, path, id));
    }
  };

  visit(scope, "scope", 0);
  return { characterRefs, titleRefs };
}

const CHARACTER_FIELDS = [
  "actor",
  "recipient",
  "secondary_actor",
  "secondary_recipient",
  "character",
  "owner",
  "target_character",
  "court_owner",
  "liege",
  "vassal",
] as const;

const TITLE_FIELDS = [
  "title",
  "target_title",
  "county",
  "target_county",
  "landed_title",
  "secondary_title",
] as const;

function actionType(record: Obj): string | null {
  for (const key of ["type", "action_type", "action", "key", "important_action_type"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * The exact serialized shape of CK3's Important Action manager changes across patches.
 * Keep this extractor deliberately schema-tolerant: expose recognizable references plus
 * bounded diagnostics. Nested scope values are resolved against known character/title IDs
 * so UI actions such as vassalization and powerful-vassal warnings can name their targets.
 */
export function extractImportantActions(
  q: Query,
  loc: Localizer,
  maxActions = 64,
): ImportantActionsInfo {
  const playerId = num(q.at("/played_character/character"));
  const entries = collectionEntries(q.at("/important_action_manager/active"));
  if (entries.length === 0) {
    return {
      activeCount: 0,
      shownCount: 0,
      playerReferencedCount: 0,
      actions: [],
      source: "unavailable",
      limitation:
        "No structured active Important Action records were exposed by jomini for this save. Advisory warnings must be inferred from underlying realm/character data.",
    };
  }

  const actions = entries.slice(0, maxActions).map(([idText, record]): ImportantActionInfo => {
    const characterRefs: ImportantActionCharacterRef[] = [];
    const titleRefs: ImportantActionTitleRef[] = [];

    for (const field of CHARACTER_FIELDS) {
      const id = referenceNumber(record[field], ["character", "id", "value"]);
      if (id === null) continue;
      pushUniqueCharacter(characterRefs, characterRef(q, loc, field, id));
    }

    for (const field of TITLE_FIELDS) {
      const id = referenceNumber(record[field], ["title", "landed_title", "county", "id", "value"]);
      if (id === null) continue;
      pushUniqueTitle(titleRefs, titleRef(q, loc, field, id));
    }

    const scopeRefs = resolveScopeReferences(q, loc, record["scope"]);
    for (const reference of scopeRefs.characterRefs) pushUniqueCharacter(characterRefs, reference);
    for (const reference of scopeRefs.titleRefs) pushUniqueTitle(titleRefs, reference);

    const targetCharacterRefs = scopeRefs.characterRefs.filter(
      (reference) => playerId === null || reference.id !== playerId,
    );
    const targetTitleRefs = scopeRefs.titleRefs;

    return {
      id: Number.isFinite(Number(idText)) ? Number(idText) : null,
      type: actionType(record),
      playerReferenced:
        playerId !== null && characterRefs.some((reference) => reference.id === playerId),
      characterRefs,
      titleRefs,
      targetCharacterRefs,
      targetTitleRefs,
      primitiveFields: primitiveFields(record),
      scopePrimitiveFields: flattenPrimitiveFields(record["scope"]),
      fieldNames: Object.keys(record).slice(0, 64),
    };
  });

  return {
    activeCount: entries.length,
    shownCount: actions.length,
    playerReferencedCount: actions.filter((action) => action.playerReferenced).length,
    actions,
    source: "important_action_manager.active",
    limitation:
      entries.length > maxActions
        ? `Only the first ${maxActions} serialized Important Action records are included; use underlying realm data for authoritative advisory decisions.`
        : "Important Action records are UI/advisory state. Nested scope references are resolved best-effort against typed character/title namespaces; unresolved scope primitives remain exposed for diagnosis.",
  };
}
