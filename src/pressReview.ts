import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Snapshot } from "./snapshot.js";

export type PressReviewPriority = "action_required" | "watch" | "informational";
export type PressReviewCategory =
  | "territory"
  | "war"
  | "family"
  | "faction"
  | "diplomacy"
  | "control";

export interface PressReviewItem {
  category: PressReviewCategory;
  priority: PressReviewPriority;
  summary: string;
  actorIds?: number[];
  titleIds?: number[];
}

export interface PressReview {
  fromDate: string | null;
  toDate: string;
  source: "snapshot_diff";
  limitation: string;
  items: PressReviewItem[];
}

interface SnapshotRow {
  id: number;
  snapshot_json: string;
}

function countyName(name: string, titleId: number): string {
  return name || `title ${titleId}`;
}

function holderLabel(name: string | null, id: number | null): string {
  if (name) return name;
  return id === null ? "unknown holder" : `character ${id}`;
}

function warKey(war: Snapshot["military"]["wars"][number]): string {
  return [war.startDate, war.playerSide, war.cbType, war.targetTitle ?? ""].join("|");
}

function tributaryWarKey(war: Snapshot["diplomacy"]["tributaryWars"][number]): string {
  if (war.warId !== null) return `id:${war.warId}`;
  return [
    war.startDate ?? "",
    war.cbType ?? "",
    [...war.targetTitleIds].sort((a, b) => a - b).join(","),
    [...war.attackerIds].sort((a, b) => a - b).join(","),
    [...war.defenderIds].sort((a, b) => a - b).join(","),
  ].join("|");
}

function joinNames(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "unknown side";
}

function reviewTerritory(previous: Snapshot, current: Snapshot, items: PressReviewItem[]): void {
  const before = new Map((previous.realm?.counties ?? []).map((county) => [county.titleId, county]));
  const after = new Map((current.realm?.counties ?? []).map((county) => [county.titleId, county]));

  for (const [titleId, county] of after) {
    const old = before.get(titleId);
    if (!old) {
      items.push({
        category: "territory",
        priority: "informational",
        summary: `Realm gained ${countyName(county.name, titleId)} (holder: ${holderLabel(county.holderName, county.holderId)}).`,
        actorIds: county.holderId === null ? undefined : [county.holderId],
        titleIds: [titleId],
      });
      continue;
    }

    if (old.holderId !== county.holderId) {
      items.push({
        category: "territory",
        priority: "informational",
        summary: `${countyName(county.name, titleId)} changed holder: ${holderLabel(old.holderName, old.holderId)} -> ${holderLabel(county.holderName, county.holderId)}.`,
        actorIds: [old.holderId, county.holderId].filter((id): id is number => id !== null),
        titleIds: [titleId],
      });
    }

    if (old.control !== null && county.control !== null) {
      const drop = old.control - county.control;
      if (drop >= 8) {
        items.push({
          category: "control",
          priority: county.heldByPlayer && county.control < 50 ? "action_required" : "watch",
          summary: `Control in ${countyName(county.name, titleId)} fell ${old.control.toFixed(1)} -> ${county.control.toFixed(1)}.`,
          actorIds: county.holderId === null ? undefined : [county.holderId],
          titleIds: [titleId],
        });
      }
    }
  }

  for (const [titleId, county] of before) {
    if (after.has(titleId)) continue;
    items.push({
      category: "territory",
      priority: county.heldByPlayer ? "action_required" : "watch",
      summary: `Realm lost ${countyName(county.name, titleId)} (previous holder: ${holderLabel(county.holderName, county.holderId)}).`,
      actorIds: county.holderId === null ? undefined : [county.holderId],
      titleIds: [titleId],
    });
  }
}

function reviewPlayerWars(previous: Snapshot, current: Snapshot, items: PressReviewItem[]): void {
  const before = new Map(previous.military.wars.map((war) => [warKey(war), war]));
  const after = new Map(current.military.wars.map((war) => [warKey(war), war]));

  for (const [key, war] of after) {
    if (before.has(key)) continue;
    items.push({
      category: "war",
      priority: "action_required",
      summary: `Player war started: ${war.cbType}${war.targetTitle ? ` for ${war.targetTitle}` : ""} (${war.playerSide}).`,
    });
  }
  for (const [key, war] of before) {
    if (after.has(key)) continue;
    items.push({
      category: "war",
      priority: "informational",
      summary: `Player war ended: ${war.cbType}${war.targetTitle ? ` for ${war.targetTitle}` : ""}.`,
    });
  }
}

function reviewTributaryWars(previous: Snapshot, current: Snapshot, items: PressReviewItem[]): void {
  const before = new Map(
    (previous.diplomacy?.tributaryWars ?? []).map((war) => [tributaryWarKey(war), war]),
  );
  const after = new Map(
    (current.diplomacy?.tributaryWars ?? []).map((war) => [tributaryWarKey(war), war]),
  );

  for (const [key, war] of after) {
    if (before.has(key)) continue;
    const target = war.targetTitles.length > 0 ? ` for ${war.targetTitles.join(", ")}` : "";
    items.push({
      category: "war",
      priority: war.betweenPlayerTributaries ? "informational" : "watch",
      summary: `Tributary war started: ${joinNames(war.attackerNames)} vs ${joinNames(war.defenderNames)}${target}.`,
      actorIds: [...new Set([...war.attackerIds, ...war.defenderIds])],
      titleIds: war.targetTitleIds.length > 0 ? war.targetTitleIds : undefined,
    });
  }

  for (const [key, war] of before) {
    if (after.has(key)) continue;
    const target = war.targetTitles.length > 0 ? ` for ${war.targetTitles.join(", ")}` : "";
    items.push({
      category: "war",
      priority: "informational",
      summary: `Tributary war ended: ${joinNames(war.attackerNames)} vs ${joinNames(war.defenderNames)}${target}.`,
      actorIds: [...new Set([...war.attackerIds, ...war.defenderIds])],
      titleIds: war.targetTitleIds.length > 0 ? war.targetTitleIds : undefined,
    });
  }
}

function reviewFamily(previous: Snapshot, current: Snapshot, items: PressReviewItem[]): void {
  const before = new Map(
    (previous.succession?.heirProfiles ?? []).map((heir) => [heir.id, heir]),
  );

  for (const heir of current.succession?.heirProfiles ?? []) {
    const old = before.get(heir.id);
    if (!old) continue;

    const oldSpouses = new Set((old.spouses ?? []).map((spouse) => spouse.id));
    for (const spouse of heir.spouses ?? []) {
      if (oldSpouses.has(spouse.id)) continue;
      items.push({
        category: "family",
        priority: "informational",
        summary: `${heir.name} married ${spouse.name}.`,
        actorIds: [heir.id, spouse.id],
      });
    }

    if (old.betrothed?.id !== heir.betrothed?.id) {
      if (heir.betrothed) {
        items.push({
          category: "family",
          priority: "informational",
          summary: `${heir.name} became betrothed to ${heir.betrothed.name}.`,
          actorIds: [heir.id, heir.betrothed.id],
        });
      } else if (old.betrothed && !(heir.spouses ?? []).some((spouse) => spouse.id === old.betrothed?.id)) {
        items.push({
          category: "family",
          priority: "watch",
          summary: `${heir.name}'s betrothal to ${old.betrothed.name} ended without a recorded marriage.`,
          actorIds: [heir.id, old.betrothed.id],
        });
      }
    }
  }
}

function reviewDiplomacy(previous: Snapshot, current: Snapshot, items: PressReviewItem[]): void {
  const beforeAllies = new Map((previous.diplomacy?.alliances ?? []).map((ally) => [ally.id, ally]));
  const afterAllies = new Map((current.diplomacy?.alliances ?? []).map((ally) => [ally.id, ally]));

  for (const [id, ally] of afterAllies) {
    if (beforeAllies.has(id)) continue;
    items.push({
      category: "diplomacy",
      priority: "informational",
      summary: `Alliance formed with ${ally.name}.`,
      actorIds: [id],
    });
  }
  for (const [id, ally] of beforeAllies) {
    if (afterAllies.has(id)) continue;
    items.push({
      category: "diplomacy",
      priority: "watch",
      summary: `Alliance with ${ally.name} ended.`,
      actorIds: [id],
    });
  }

  const truceKey = (truce: Snapshot["diplomacy"]["truces"][number]): string =>
    `${truce.id}:${truce.until}`;
  const beforeTruces = new Map((previous.diplomacy?.truces ?? []).map((truce) => [truceKey(truce), truce]));
  const afterTruces = new Map((current.diplomacy?.truces ?? []).map((truce) => [truceKey(truce), truce]));

  for (const [key, truce] of afterTruces) {
    if (beforeTruces.has(key)) continue;
    items.push({
      category: "diplomacy",
      priority: "informational",
      summary: `Truce recorded with ${truce.name} until ${truce.until}.`,
      actorIds: [truce.id],
    });
  }
  for (const [key, truce] of beforeTruces) {
    if (afterTruces.has(key)) continue;
    if ((current.diplomacy?.truces ?? []).some((candidate) => candidate.id === truce.id)) continue;
    items.push({
      category: "diplomacy",
      priority: "watch",
      summary: `Truce with ${truce.name} ended or disappeared from the save.`,
      actorIds: [truce.id],
    });
  }
}

function reviewFactions(previous: Snapshot, current: Snapshot, items: PressReviewItem[]): void {
  const before = previous.factions.length;
  const after = current.factions.length;
  if (before === after) return;

  if (before > 0 && after === 0) {
    items.push({
      category: "faction",
      priority: "informational",
      summary: `All tracked factions dissolved (${before} -> 0).`,
    });
    return;
  }

  items.push({
    category: "faction",
    priority: after > before ? "watch" : "informational",
    summary: `Faction count changed ${before} -> ${after}.`,
  });
}

const PRIORITY_ORDER: Record<PressReviewPriority, number> = {
  action_required: 0,
  watch: 1,
  informational: 2,
};

export function buildPressReview(previous: Snapshot | null, current: Snapshot): PressReview {
  const items: PressReviewItem[] = [];
  if (previous) {
    reviewTerritory(previous, current, items);
    reviewPlayerWars(previous, current, items);
    reviewTributaryWars(previous, current, items);
    reviewFamily(previous, current, items);
    reviewDiplomacy(previous, current, items);
    reviewFactions(previous, current, items);
  }

  items.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.category.localeCompare(b.category) ||
      a.summary.localeCompare(b.summary),
  );

  return {
    fromDate: previous?.date ?? null,
    toDate: current.date,
    source: "snapshot_diff",
    limitation:
      "Derived from consecutive saved checkpoints. Events that both start and finish between checkpoints may not be reconstructable unless they leave persistent state changes.",
    items,
  };
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

function parseSnapshot(row: SnapshotRow | undefined): Snapshot | null {
  if (!row) return null;
  try {
    return JSON.parse(row.snapshot_json) as Snapshot;
  } catch {
    return null;
  }
}

export async function augmentChangesWithPressReview(
  databasePath: string,
  outputDir: string,
  sourceFingerprint: string,
): Promise<number> {
  const db = new DatabaseSync(databasePath);
  try {
    const currentRow = db
      .prepare("SELECT id, snapshot_json FROM snapshots WHERE source_fingerprint = ?")
      .get(sourceFingerprint) as SnapshotRow | undefined;
    const current = parseSnapshot(currentRow);
    if (!currentRow || !current) return 0;

    const previousRow = db
      .prepare("SELECT id, snapshot_json FROM snapshots WHERE id < ? ORDER BY id DESC LIMIT 1")
      .get(currentRow.id) as SnapshotRow | undefined;
    const previous = parseSnapshot(previousRow);
    const pressReview = buildPressReview(previous, current);

    const changesPath = join(outputDir, "changes.json");
    const raw = JSON.parse(await readFile(changesPath, "utf8")) as Record<string, unknown>;
    raw["pressReview"] = pressReview;
    await writeJsonAtomic(changesPath, raw);
    return pressReview.items.length;
  } finally {
    db.close();
  }
}
