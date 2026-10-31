import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { extractCharacter } from "./characters.js";

export interface FilledCourtPositionInfo {
  type: string;
  employeeId: number;
  employeeName: string;
  employeeAge: number | null;
  employerId: number;
}

export interface CourtPositionsInfo {
  /** Positions that are actually filled and therefore persisted in the save. */
  filled: FilledCourtPositionInfo[];
  filledCount: number;
  source: "court_positions_save" | "unavailable";
  /**
   * Vacant/locked positions and aptitude/salary are evaluated by CK3 script and
   * are not persisted as a ready-made candidate table. A later static-game-data
   * layer must evaluate those definitions rather than guessing them here.
   */
  vacanciesAvailable: false;
  candidateCompetencyAvailable: false;
  salaryAvailable: false;
}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface RawCourtPosition {
  type: string;
  employeeId: number;
  employerId: number;
}

function collectPositionRecords(value: unknown, output: RawCourtPosition[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPositionRecords(item, output, depth + 1);
    return;
  }
  const record = obj(value);
  if (!record) return;

  const type = typeof record["court_position"] === "string" ? record["court_position"] : null;
  const employeeId = num(record["employee"]);
  const employerId = num(record["employer"]);
  if (type && employeeId !== null && employerId !== null) {
    output.push({ type, employeeId, employerId });
  }

  for (const child of Object.values(record)) {
    if (child !== null && typeof child === "object") {
      collectPositionRecords(child, output, depth + 1);
    }
  }
}

export function extractCourtPositions(q: Query, loc: Localizer): CourtPositionsInfo {
  const playerId = num(q.at("/played_character/character"));
  const raw = q.at("/court_positions");
  if (playerId === null || raw === undefined) {
    return {
      filled: [],
      filledCount: 0,
      source: "unavailable",
      vacanciesAvailable: false,
      candidateCompetencyAvailable: false,
      salaryAvailable: false,
    };
  }

  const records: RawCourtPosition[] = [];
  collectPositionRecords(raw, records);
  const seen = new Set<string>();
  const filled: FilledCourtPositionInfo[] = [];

  for (const record of records) {
    if (record.employerId !== playerId) continue;
    const key = `${record.type}:${record.employeeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const employee = extractCharacter(q, loc, record.employeeId);
    filled.push({
      type: record.type,
      employeeId: record.employeeId,
      employeeName: employee?.name ?? String(record.employeeId),
      employeeAge: employee?.age ?? null,
      employerId: playerId,
    });
  }

  filled.sort((a, b) => a.type.localeCompare(b.type) || a.employeeId - b.employeeId);
  return {
    filled,
    filledCount: filled.length,
    source: "court_positions_save",
    vacanciesAvailable: false,
    candidateCompetencyAvailable: false,
    salaryAvailable: false,
  };
}
