import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { queryGamestate } from "./parser.js";
import type { PressReview, PressReviewItem, PressReviewPriority } from "./pressReview.js";
import type { Snapshot } from "./snapshot.js";
import type { AdvisoryContext } from "./advisory.js";

interface SnapshotRow {
  id: number;
  snapshot_json: string;
}

type AdvisorySnapshot = Snapshot & { advisory?: AdvisoryContext };

const PRIORITY_ORDER: Record<PressReviewPriority, number> = {
  action_required: 0,
  watch: 1,
  informational: 2,
};

function parseSnapshot(row: SnapshotRow | undefined): AdvisorySnapshot | null {
  if (!row) return null;
  try {
    return JSON.parse(row.snapshot_json) as AdvisorySnapshot;
  } catch {
    return null;
  }
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

/**
 * Conservative death probe for exact character IDs that mattered in the previous
 * checkpoint. A missing living character alone is not enough: at least one known CK3
 * dead-character store must contain the same ID.
 */
export async function detectDeadCharacterIds(
  gamestate: Buffer,
  characterIds: readonly number[],
): Promise<Set<number>> {
  return queryGamestate(gamestate, (q) => {
    const dead = new Set<number>();
    const deadRoots = ["dead_unprunable", "dead_prunable", "dead", "dead_characters"];
    for (const id of characterIds) {
      if (q.at(`/living/${id}/first_name`) !== undefined) continue;
      if (deadRoots.some((root) => q.at(`/${root}/${id}`) !== undefined)) dead.add(id);
    }
    return dead;
  });
}

function enrichAllianceDeaths(
  previous: Snapshot,
  current: Snapshot,
  review: PressReview,
  deadIds: ReadonlySet<number>,
): void {
  const currentAllies = new Set((current.diplomacy?.alliances ?? []).map((ally) => ally.id));
  for (const ally of previous.diplomacy?.alliances ?? []) {
    if (currentAllies.has(ally.id) || !deadIds.has(ally.id)) continue;
    const item = review.items.find(
      (candidate) =>
        candidate.category === "diplomacy" &&
        candidate.actorIds?.includes(ally.id) === true &&
        candidate.summary === `Alliance with ${ally.name} ended.`,
    );
    if (item) {
      item.summary = `Alliance with ${ally.name} ended: ruler died.`;
      continue;
    }
    review.items.push({
      category: "diplomacy",
      priority: "watch",
      summary: `Alliance with ${ally.name} ended: ruler died.`,
      actorIds: [ally.id],
    });
  }
}

function enrichLowbornPrimarySpouse(
  previous: AdvisorySnapshot,
  current: AdvisorySnapshot,
  review: PressReview,
): void {
  const previousSpouseId = previous.family?.primarySpouse?.id ?? null;
  const spouse = current.family?.primarySpouse ?? null;
  if (!spouse || spouse.id === previousSpouseId) return;

  const advisory = current.advisory?.marriage;
  const isLowborn = advisory?.currentPrimarySpouse?.id === spouse.id
    ? advisory.currentPrimarySpouse.isLowborn
    : spouse.dynastyHouseId === null;
  if (!isLowborn) return;

  const estimatedLoss = advisory?.estimatedLegitimacyLoss ?? null;
  const alreadyPresent = review.items.some(
    (item) =>
      item.actorIds?.includes(spouse.id) === true &&
      /lowborn|legitimacy/i.test(item.summary),
  );
  if (alreadyPresent) return;

  review.items.push({
    category: "family",
    priority: "action_required",
    summary:
      estimatedLoss === null
        ? `Primary spouse changed to lowborn ${spouse.name}; check the primary-spouse legitimacy penalty.`
        : `Primary spouse changed to lowborn ${spouse.name}; expected legitimacy penalty is about ${estimatedLoss} at title tier ${current.overview.tier}.`,
    actorIds: [spouse.id],
  });
}

function sortItems(items: PressReviewItem[]): void {
  items.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.category.localeCompare(b.category) ||
      a.summary.localeCompare(b.summary),
  );
}

/**
 * Add evidence that a pure snapshot diff cannot know on its own. This runs immediately
 * after the base press review while the current raw gamestate is still available.
 */
export async function enrichPressReviewWithLiveEvidence(
  databasePath: string,
  outputDir: string,
  sourceFingerprint: string,
  gamestate: Buffer,
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

    const changesPath = join(outputDir, "changes.json");
    const raw = JSON.parse(await readFile(changesPath, "utf8")) as Record<string, unknown>;
    const review = raw["pressReview"] as PressReview | undefined;
    if (!review || !previous) return review?.items.length ?? 0;

    const lostAllianceIds = (previous.diplomacy?.alliances ?? [])
      .filter(
        (ally) => !(current.diplomacy?.alliances ?? []).some((candidate) => candidate.id === ally.id),
      )
      .map((ally) => ally.id);
    const deadIds = await detectDeadCharacterIds(gamestate, lostAllianceIds);
    enrichAllianceDeaths(previous, current, review, deadIds);
    enrichLowbornPrimarySpouse(previous, current, review);
    sortItems(review.items);

    raw["pressReview"] = review;
    await writeJsonAtomic(changesPath, raw);
    return review.items.length;
  } finally {
    db.close();
  }
}
