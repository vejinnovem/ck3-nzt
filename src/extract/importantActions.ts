import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

type Obj = Record<string, unknown>;
type Primitive = string | number | boolean;

export interface ImportantActionCharacterRef {
  field: string;
  id: number;
  name: string | null;
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
  primitiveFields: Record<string, Primitive>;
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

function titleKey(q: Query, id: number): string | null {
  const value = q.at(`/landed_titles/landed_titles/${id}/key`);
  return typeof value === "string" ? value : null;
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
 * bounded direct-field diagnostics instead of hard-coding one campaign or UI hint.
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
      characterRefs.push({ field, id, name: characterName(q, id) });
    }

    for (const field of TITLE_FIELDS) {
      const id = referenceNumber(record[field], ["title", "landed_title", "county", "id", "value"]);
      if (id === null) continue;
      const key = titleKey(q, id);
      if (key === null || titleTierFromKey(key) === "other") continue;
      titleRefs.push({
        field,
        id,
        name: resolveTitleName(q, loc, id),
        key,
      });
    }

    return {
      id: Number.isFinite(Number(idText)) ? Number(idText) : null,
      type: actionType(record),
      playerReferenced:
        playerId !== null && characterRefs.some((reference) => reference.id === playerId),
      characterRefs,
      titleRefs,
      primitiveFields: primitiveFields(record),
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
        : "Important Action records are UI/advisory state. Their fields are exposed for diagnosis, but the parser does not assume every suggestion is strategically correct.",
  };
}
