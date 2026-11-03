import type { Query } from "../parser.js";
import { formatCk3Date } from "../format.js";

type Obj = Record<string, unknown>;

export type LifestyleFocusSource =
  | "alive_data.focus"
  | "nested_focus_marker"
  | "unavailable";

export type LifestyleFocusConfidence =
  | "confirmed_direct"
  | "confirmed_unique_marker"
  | "unknown_ambiguous"
  | "unknown_missing";

export interface LifestyleFocusInfo {
  type: string;
  date: string | null;
  changes: number | null;
  progress: number | null;
}

export interface LifestyleAdvisoryInfo {
  activeFocus: LifestyleFocusInfo | null;
  focusSource: LifestyleFocusSource;
  focusConfidence: LifestyleFocusConfidence;
  focusEvidencePaths: string[];
  focusCandidates: string[];
  lifestyleXp: Record<string, number>;
  ownedPerks: string[];
  availablePerkChoices: null;
  availablePerkChoicesKnown: false;
  limitations: string[];
}

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function numberRecord(value: unknown): Record<string, number> {
  const record = obj(value);
  if (!record) return {};
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number" && Number.isFinite(entry)) output[key] = entry;
  }
  return output;
}

function directFocus(value: unknown): LifestyleFocusInfo | null {
  const record = obj(value);
  if (!record || typeof record["type"] !== "string") return null;
  return {
    type: record["type"],
    date: record["date"] === undefined ? null : formatCk3Date(record["date"]),
    changes: num(record["changes"]),
    progress: num(record["progress"]),
  };
}

interface FocusMarker {
  type: string;
  path: string;
}

function collectNestedFocusMarkers(
  value: unknown,
  path: string,
  output: FocusMarker[],
  depth = 0,
): void {
  if (depth > 10 || value === null || value === undefined) return;

  if (typeof value === "string") {
    const lastSegment = path.split("/").filter(Boolean).at(-1) ?? "";
    const parentPath = path.toLowerCase();
    const explicitFocusContext =
      lastSegment.toLowerCase().includes("focus") || parentPath.includes("/focus/");
    if (explicitFocusContext && /^[a-z0-9_]+_focus$/i.test(value)) {
      output.push({ type: value, path });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectNestedFocusMarkers(entry, `${path}/${index}`, output, depth + 1),
    );
    return;
  }

  const record = obj(value);
  if (!record) return;
  for (const [key, entry] of Object.entries(record)) {
    collectNestedFocusMarkers(entry, `${path}/${key}`, output, depth + 1);
  }
}

export function extractLifestyleAdvisory(q: Query, characterId: number): LifestyleAdvisoryInfo {
  const alivePath = `/living/${characterId}/alive_data`;
  const direct = directFocus(q.at(`${alivePath}/focus`));
  const lifestyleXp = numberRecord(q.at(`${alivePath}/lifestyle_xp`));
  const ownedPerks = stringList(q.at(`${alivePath}/perk`));

  const baseLimitations = [
    "Lifestyle XP and owned perks are serialized save values.",
    "Available perk choices depend on runtime/static perk-tree rules and are not reconstructed; no choice is inferred from XP alone.",
  ];

  if (direct) {
    return {
      activeFocus: direct,
      focusSource: "alive_data.focus",
      focusConfidence: "confirmed_direct",
      focusEvidencePaths: [`${alivePath}/focus/type`],
      focusCandidates: [direct.type],
      lifestyleXp,
      ownedPerks,
      availablePerkChoices: null,
      availablePerkChoicesKnown: false,
      limitations: baseLimitations,
    };
  }

  const markers: FocusMarker[] = [];
  collectNestedFocusMarkers(q.at(`/living/${characterId}`), `/living/${characterId}`, markers);

  const uniqueTypes = [...new Set(markers.map((marker) => marker.type))].sort();
  const evidencePaths = [...new Set(markers.map((marker) => marker.path))].sort();

  if (uniqueTypes.length === 1) {
    return {
      activeFocus: {
        type: uniqueTypes[0]!,
        date: null,
        changes: null,
        progress: null,
      },
      focusSource: "nested_focus_marker",
      focusConfidence: "confirmed_unique_marker",
      focusEvidencePaths: evidencePaths,
      focusCandidates: uniqueTypes,
      lifestyleXp,
      ownedPerks,
      availablePerkChoices: null,
      availablePerkChoicesKnown: false,
      limitations: [
        ...baseLimitations,
        "The direct alive_data.focus object was absent/incomplete. Active focus was recovered only because exactly one explicit *_focus marker existed in a focus-labelled serialized path; date/change/progress metadata is unavailable.",
      ],
    };
  }

  return {
    activeFocus: null,
    focusSource: "unavailable",
    focusConfidence: uniqueTypes.length > 1 ? "unknown_ambiguous" : "unknown_missing",
    focusEvidencePaths: evidencePaths,
    focusCandidates: uniqueTypes,
    lifestyleXp,
    ownedPerks,
    availablePerkChoices: null,
    availablePerkChoicesKnown: false,
    limitations: [
      ...baseLimitations,
      uniqueTypes.length > 1
        ? "Multiple explicit focus markers were found, so CK3-NZT does not guess which one is active."
        : "No direct or unique explicit serialized lifestyle-focus marker was found. CK3-NZT does not infer focus from the largest XP pool.",
    ],
  };
}
