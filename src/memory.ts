import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadLocalConfig } from "./config.js";
import type { Snapshot } from "./snapshot.js";

type Scalar = string | number | boolean | null;

export interface StrategicChange {
  key: string;
  before: Scalar;
  after: Scalar;
  delta?: number;
}

export interface ChangeSet {
  fromDate: string | null;
  toDate: string;
  generatedAt: string;
  changes: StrategicChange[];
}

export interface TrendMetric {
  from: number | null;
  to: number | null;
  delta: number | null;
}

export interface TrendSet {
  generatedAt: string;
  window: {
    snapshots: number;
    fromDate: string | null;
    toDate: string | null;
  };
  metrics: {
    gold: TrendMetric;
    militaryStrength: TrendMetric;
    vassalCount: TrendMetric;
    factionCount: TrendMetric;
    maxFactionPowerRatio: TrendMetric;
  };
}

interface MemoryManifest {
  schemaVersion: 1;
  snapshotId: number;
  sourceFingerprint: string;
  gameDate: string;
  generatedAt: string;
  previousGameDate: string | null;
}

export interface PersistOptions {
  sourceFingerprint: string;
  dataDir?: string;
  outputDir?: string;
}

export interface PersistResult {
  outputDir: string;
  databasePath: string;
  written: boolean;
  refreshed: boolean;
  changeCount: number;
}

interface TrendRow {
  game_date: string;
  gold: number | null;
  military_strength: number | null;
  vassal_count: number;
  faction_count: number;
  max_faction_ratio: number | null;
}

interface StoredSnapshotRow {
  id: number;
  game_date: string;
  snapshot_json: string;
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CK3_NZT_DATA_DIR) return env.CK3_NZT_DATA_DIR;
  if (process.platform === "win32" && env.LOCALAPPDATA) {
    return join(env.LOCALAPPDATA, "CK3-NZT", "data");
  }
  if (env.XDG_DATA_HOME) return join(env.XDG_DATA_HOME, "ck3-nzt", "data");
  return join(homedir(), ".local", "share", "ck3-nzt", "data");
}

export function resolveOutputDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CK3_NZT_OUTPUT_DIR) return env.CK3_NZT_OUTPUT_DIR;

  const configured = loadLocalConfig(env).outputDir;
  if (configured) return configured;

  if (process.platform === "win32" && env.LOCALAPPDATA) {
    return join(env.LOCALAPPDATA, "CK3-NZT", "export");
  }
  if (env.XDG_DATA_HOME) return join(env.XDG_DATA_HOME, "ck3-nzt", "export");
  return join(homedir(), ".local", "share", "ck3-nzt", "export");
}

function maxFactionPowerRatio(snapshot: Snapshot): number | null {
  let max: number | null = null;
  for (const faction of snapshot.factions) {
    if (faction.power === null || faction.threshold === null || faction.threshold === 0) continue;
    const ratio = faction.power / faction.threshold;
    if (max === null || ratio > max) max = ratio;
  }
  return max;
}

function titleSignature(
  titles: Array<{ id: number; name: string }> | undefined,
): string | null {
  if (!titles || titles.length === 0) return null;
  return [...titles]
    .sort((a, b) => a.id - b.id)
    .map((title) => `${title.id}:${title.name}`)
    .join("|");
}

function successionAssignmentSignature(snapshot: Snapshot): string | null {
  const assignments = snapshot.succession?.titleAssignmentsByHeir;
  if (!assignments || assignments.length === 0) return null;

  return [...assignments]
    .sort((a, b) => a.heirId - b.heirId)
    .map((assignment) => {
      const titleIds = assignment.titles
        .map((title) => title.titleId)
        .sort((a, b) => a - b)
        .join(",");
      return `${assignment.heirId}:${assignment.heirName}=${titleIds}`;
    })
    .join("|");
}

function importantActionCount(snapshot: Snapshot, type: string): number {
  return snapshot.importantActions?.actions.filter((action) => action.type === type).length ?? 0;
}

function councilAssignmentSummary(snapshot: Snapshot): Record<string, Scalar> {
  const result: Record<string, Scalar> = {};
  const council = snapshot.council;
  if (!council) return result;

  const names = new Map(council.members.map((member) => [member.id, member.name]));
  for (const office of council.offices) {
    result[`council.office.${office.office}`] =
      office.vacant || office.memberId === null
        ? null
        : `${office.memberId}:${names.get(office.memberId) ?? office.memberId}`;
  }
  return result;
}

function guardianAssignmentSummary(snapshot: Snapshot): Record<string, Scalar> {
  const result: Record<string, Scalar> = {};
  for (const child of snapshot.education?.children ?? []) {
    const guardians = child.guardianIds
      .map((id, index) => ({ id, name: child.guardianNames[index] ?? String(id) }))
      .sort((a, b) => a.id - b.id);
    result[`education.guardians.${child.id}`] =
      guardians.length === 0
        ? null
        : guardians.map((guardian) => `${guardian.id}:${guardian.name}`).join("|");
  }
  return result;
}

function characterAvailabilitySummary(snapshot: Snapshot): Record<string, Scalar> {
  const result: Record<string, Scalar> = {};
  const council = snapshot.council;
  if (!council) return result;

  const people = [...council.members, ...council.candidates];
  const seen = new Set<number>();
  for (const person of people) {
    if (seen.has(person.id) || !person.availability) continue;
    seen.add(person.id);
    const availability = person.availability;
    const plans = [...availability.travelPlanIds].sort().join(",");
    const roles = [...availability.travelRoles].sort().join(",");
    result[`characters.availability.${person.id}`] = [
      person.name,
      availability.presenceStatus,
      availability.councilAvailability,
      `travel=${availability.travelling}`,
      `plans=${plans}`,
      `roles=${roles}`,
      `army=${availability.armyId ?? ""}`,
      `employer=${availability.employerId ?? ""}`,
      `host=${availability.hostId ?? ""}`,
      `leaving=${availability.wantsToLeaveCourt}`,
      `leaveDate=${availability.leaveCourtDate ?? ""}`,
    ].join("|");
  }
  return result;
}

export function summarizeSnapshot(snapshot: Snapshot): Record<string, Scalar> {
  const opinions = snapshot.vassals
    .map((vassal) => vassal.opinion)
    .filter((opinion): opinion is number => opinion !== null);

  const titleCount =
    snapshot.economy?.heldTitleCount ??
    (typeof snapshot.titles?.total === "number" ? snapshot.titles.total : null);
  const countyCount =
    snapshot.economy?.heldCountyCount ??
    (Array.isArray(snapshot.titles?.counties) ? snapshot.titles.counties.length : null);

  return {
    "ruler.name": snapshot.overview.rulerName,
    "realm.primaryTitle": snapshot.overview.primaryTitle,
    "realm.house": snapshot.overview.house,
    "economy.gold": snapshot.overview.gold,
    "economy.prestige": snapshot.overview.prestige,
    "economy.prestigeCurrency": snapshot.ruler?.prestigeCurrency ?? null,
    "economy.piety": snapshot.overview.piety,
    "economy.pietyCurrency": snapshot.ruler?.pietyCurrency ?? null,
    "realm.heldTitleCount": titleCount,
    "realm.heldCountyCount": countyCount,
    "realm.countyCount": snapshot.realm?.countyCount ?? null,
    "realm.playerHeldCountyCount": snapshot.realm?.playerHeldCountyCount ?? countyCount,
    "realm.vassalHeldCountyCount": snapshot.realm?.vassalHeldCountyCount ?? null,
    "realm.authority": snapshot.economy?.realmRules.authority?.key ?? null,
    "realm.heldCounties": titleSignature(snapshot.titles?.counties),
    "realm.heldDuchies": titleSignature(snapshot.titles?.duchies),
    "succession.titleAssignments": successionAssignmentSignature(snapshot),
    "military.levy": snapshot.military.levy,
    "military.strength": snapshot.military.strength,
    "military.currentStrength": snapshot.military.currentStrength,
    "military.activeWars": snapshot.military.wars.length,
    "realm.vassals": snapshot.vassalCount,
    "realm.factions": snapshot.factions.length,
    "factions.maxPowerRatio": maxFactionPowerRatio(snapshot),
    "vassals.inFaction": snapshot.vassals.filter((vassal) => vassal.inFaction).length,
    "vassals.lowestTrackedOpinion": opinions.length > 0 ? Math.min(...opinions) : null,
    "importantActions.canVassalize": importantActionCount(snapshot, "action_can_vassalize"),
    "importantActions.powerfulVassalNotOnCouncil": importantActionCount(
      snapshot,
      "action_powerful_vassal_not_on_council",
    ),
    ...councilAssignmentSummary(snapshot),
    ...guardianAssignmentSummary(snapshot),
    ...characterAvailabilitySummary(snapshot),
  };
}

export function buildChanges(previous: Snapshot | null, current: Snapshot): ChangeSet {
  if (!previous) {
    return {
      fromDate: null,
      toDate: current.date,
      generatedAt: new Date().toISOString(),
      changes: [],
    };
  }

  const before = summarizeSnapshot(previous);
  const after = summarizeSnapshot(current);
  const changes: StrategicChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const oldValue = Object.hasOwn(before, key) ? (before[key] ?? null) : null;
    const value = Object.hasOwn(after, key) ? (after[key] ?? null) : null;
    if (Object.is(oldValue, value)) continue;

    const change: StrategicChange = { key, before: oldValue, after: value };
    if (typeof oldValue === "number" && typeof value === "number") {
      change.delta = value - oldValue;
    }
    changes.push(change);
  }

  return {
    fromDate: previous.date,
    toDate: current.date,
    generatedAt: new Date().toISOString(),
    changes,
  };
}

function metric(from: number | null, to: number | null): TrendMetric {
  return {
    from,
    to,
    delta: from === null || to === null ? null : to - from,
  };
}

function buildTrends(rowsNewestFirst: TrendRow[]): TrendSet {
  const rows = [...rowsNewestFirst].reverse();
  const first = rows[0] ?? null;
  const last = rows.at(-1) ?? null;

  return {
    generatedAt: new Date().toISOString(),
    window: {
      snapshots: rows.length,
      fromDate: first?.game_date ?? null,
      toDate: last?.game_date ?? null,
    },
    metrics: {
      gold: metric(first?.gold ?? null, last?.gold ?? null),
      militaryStrength: metric(
        first?.military_strength ?? null,
        last?.military_strength ?? null,
      ),
      vassalCount: metric(first?.vassal_count ?? null, last?.vassal_count ?? null),
      factionCount: metric(first?.faction_count ?? null, last?.faction_count ?? null),
      maxFactionPowerRatio: metric(
        first?.max_faction_ratio ?? null,
        last?.max_faction_ratio ?? null,
      ),
    },
  };
}

function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_fingerprint TEXT NOT NULL UNIQUE,
      game_date TEXT NOT NULL,
      parsed_at INTEGER NOT NULL,
      ruler_name TEXT NOT NULL,
      primary_title TEXT NOT NULL,
      gold REAL,
      military_strength REAL,
      current_strength REAL,
      vassal_count INTEGER NOT NULL,
      faction_count INTEGER NOT NULL,
      max_faction_ratio REAL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS changes (
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      delta REAL,
      PRIMARY KEY (snapshot_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_game_date ON snapshots(game_date);
    CREATE INDEX IF NOT EXISTS idx_snapshots_parsed_at ON snapshots(parsed_at);
  `);
  return db;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, path);
  } catch {
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

function parseStoredSnapshot(row: StoredSnapshotRow | undefined): Snapshot | null {
  if (!row) return null;
  try {
    return JSON.parse(row.snapshot_json) as Snapshot;
  } catch {
    return null;
  }
}

function previousStoredSnapshot(db: DatabaseSync, beforeId?: number): StoredSnapshotRow | undefined {
  if (beforeId !== undefined) {
    return db
      .prepare(
        "SELECT id, game_date, snapshot_json FROM snapshots WHERE id < ? ORDER BY id DESC LIMIT 1",
      )
      .get(beforeId) as StoredSnapshotRow | undefined;
  }

  return db
    .prepare("SELECT id, game_date, snapshot_json FROM snapshots ORDER BY id DESC LIMIT 1")
    .get() as StoredSnapshotRow | undefined;
}

function insertChanges(db: DatabaseSync, snapshotId: number, changes: ChangeSet): void {
  const insertChange = db.prepare(`
    INSERT INTO changes (snapshot_id, key, before_json, after_json, delta)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const change of changes.changes) {
    insertChange.run(
      snapshotId,
      change.key,
      JSON.stringify(change.before),
      JSON.stringify(change.after),
      change.delta ?? null,
    );
  }
}

async function writeExports(
  db: DatabaseSync,
  outputDir: string,
  snapshot: Snapshot,
  snapshotId: number,
  sourceFingerprint: string,
  changes: ChangeSet,
  generatedAt: string,
  previousGameDate: string | null,
): Promise<void> {
  const trendRows = db
    .prepare(`
      SELECT game_date, gold, military_strength, vassal_count, faction_count, max_faction_ratio
      FROM snapshots
      ORDER BY id DESC
      LIMIT 20
    `)
    .all() as unknown as TrendRow[];
  const trends = buildTrends(trendRows);

  const manifest: MemoryManifest = {
    schemaVersion: 1,
    snapshotId,
    sourceFingerprint,
    gameDate: snapshot.date,
    generatedAt,
    previousGameDate,
  };

  await writeJsonAtomic(join(outputDir, "current.json"), snapshot);
  await writeJsonAtomic(join(outputDir, "changes.json"), changes);
  await writeJsonAtomic(join(outputDir, "trends.json"), trends);
  await writeJsonAtomic(join(outputDir, "manifest.json"), manifest);
}

export async function persistSnapshot(
  snapshot: Snapshot,
  options: PersistOptions,
): Promise<PersistResult> {
  const dataDir = options.dataDir ?? resolveDataDir();
  const outputDir = options.outputDir ?? resolveOutputDir();
  await mkdir(dataDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const databasePath = join(dataDir, "memory.sqlite");
  const db = openDatabase(databasePath);

  try {
    const duplicate = db
      .prepare("SELECT id, game_date, snapshot_json FROM snapshots WHERE source_fingerprint = ?")
      .get(options.sourceFingerprint) as StoredSnapshotRow | undefined;

    if (duplicate) {
      const previousRow = previousStoredSnapshot(db, duplicate.id);
      const previous = parseStoredSnapshot(previousRow);
      const changes = buildChanges(previous, snapshot);
      const maxFactionRatio = maxFactionPowerRatio(snapshot);
      const generatedAt = new Date().toISOString();

      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          UPDATE snapshots SET
            game_date = ?, parsed_at = ?, ruler_name = ?, primary_title = ?,
            gold = ?, military_strength = ?, current_strength = ?,
            vassal_count = ?, faction_count = ?, max_faction_ratio = ?, snapshot_json = ?
          WHERE id = ?
        `).run(
          snapshot.date,
          snapshot.parsedAt,
          snapshot.overview.rulerName,
          snapshot.overview.primaryTitle,
          snapshot.overview.gold,
          snapshot.military.strength,
          snapshot.military.currentStrength,
          snapshot.vassalCount,
          snapshot.factions.length,
          maxFactionRatio,
          JSON.stringify(snapshot),
          duplicate.id,
        );
        db.prepare("DELETE FROM changes WHERE snapshot_id = ?").run(duplicate.id);
        insertChanges(db, duplicate.id, changes);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      await writeExports(
        db,
        outputDir,
        snapshot,
        duplicate.id,
        options.sourceFingerprint,
        changes,
        generatedAt,
        previous?.date ?? null,
      );

      return {
        outputDir,
        databasePath,
        written: false,
        refreshed: true,
        changeCount: changes.changes.length,
      };
    }

    const previousRow = previousStoredSnapshot(db);
    const previous = parseStoredSnapshot(previousRow);
    const changes = buildChanges(previous, snapshot);
    const maxFactionRatio = maxFactionPowerRatio(snapshot);
    const createdAt = new Date().toISOString();

    db.exec("BEGIN IMMEDIATE");
    let snapshotId: number;
    try {
      const result = db
        .prepare(`
          INSERT INTO snapshots (
            source_fingerprint, game_date, parsed_at, ruler_name, primary_title,
            gold, military_strength, current_strength, vassal_count, faction_count,
            max_faction_ratio, snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          options.sourceFingerprint,
          snapshot.date,
          snapshot.parsedAt,
          snapshot.overview.rulerName,
          snapshot.overview.primaryTitle,
          snapshot.overview.gold,
          snapshot.military.strength,
          snapshot.military.currentStrength,
          snapshot.vassalCount,
          snapshot.factions.length,
          maxFactionRatio,
          JSON.stringify(snapshot),
          createdAt,
        );
      snapshotId = Number(result.lastInsertRowid);
      insertChanges(db, snapshotId, changes);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    await writeExports(
      db,
      outputDir,
      snapshot,
      snapshotId,
      options.sourceFingerprint,
      changes,
      createdAt,
      previous?.date ?? null,
    );

    return {
      outputDir,
      databasePath,
      written: true,
      refreshed: false,
      changeCount: changes.changes.length,
    };
  } finally {
    db.close();
  }
}
