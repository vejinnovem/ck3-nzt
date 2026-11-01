import type { Query } from "../parser.js";

export interface GameInfo {
  achievementsEligible: boolean | null;
  ironman: boolean | null;
}

function parseYesNo(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes" || normalized === "true" || normalized === "1") return true;
    if (normalized === "no" || normalized === "false" || normalized === "0") return false;
  }
  if (Array.isArray(value)) {
    const parsed = value
      .map((entry) => parseYesNo(entry))
      .filter((entry): entry is boolean => entry !== null);
    if (parsed.length === 0) return null;
    if (parsed.every((entry) => entry === parsed[0])) return parsed[0] ?? null;
  }
  return null;
}

function firstKnown(...values: unknown[]): boolean | null {
  for (const value of values) {
    const parsed = parseYesNo(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function extractGameInfo(q: Query): GameInfo {
  return {
    achievementsEligible: firstKnown(
      q.at("/can_get_achievements"),
      q.at("/meta_data/can_get_achievements"),
    ),
    ironman: firstKnown(q.at("/ironman"), q.at("/meta_data/ironman")),
  };
}
