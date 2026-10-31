import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { extractCharacter, type CharacterInfo } from "./characters.js";

export interface CouncilTaskInfo {
  id: number;
  type: string | null;
  ownerId: number | null;
  courtOwnerId: number | null;
}

export interface CouncillorInfo {
  id: number;
  name: string;
  age: number | null;
  skills: CharacterInfo["skills"];
  traits: string[];
  primaryTitle: string | null;
  councilTaskId: number | null;
  activeTask: CouncilTaskInfo | null;
}

export interface CourtCandidateInfo {
  id: number;
  name: string;
  age: number | null;
  female: boolean;
  skills: CharacterInfo["skills"];
  traits: string[];
  isCouncillor: boolean;
}

export interface CouncilInfo {
  /** Raw IDs stored in landed_data/council when they resolve as council tasks. */
  taskIds: number[];
  /** Character IDs of the resolved councillors. */
  memberIds: number[];
  members: CouncillorInfo[];
  courtSize: number;
  candidates: CourtCandidateInfo[];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function numberList(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function councilTask(q: Query, taskId: number | null): CouncilTaskInfo | null {
  if (taskId === null) return null;
  const base = `/council_task_manager/active/${taskId}`;
  const type = q.at(`${base}/type`);
  const ownerId = numberOrNull(q.at(`${base}/owner`));
  const courtOwnerId = numberOrNull(q.at(`${base}/court_owner`));

  if (type === undefined && ownerId === null && courtOwnerId === null) return null;
  return {
    id: taskId,
    type: typeof type === "string" ? type : null,
    ownerId,
    courtOwnerId,
  };
}

function toCouncillor(
  q: Query,
  loc: Localizer,
  id: number,
  knownTask: CouncilTaskInfo | null = null,
): CouncillorInfo | null {
  const character = extractCharacter(q, loc, id);
  if (!character) return null;
  const storedTaskId = numberOrNull(q.at(`/living/${id}/court_data/council_task`));
  const councilTaskId = knownTask?.id ?? storedTaskId;
  return {
    id,
    name: character.name,
    age: character.age,
    skills: character.skills,
    traits: character.traits,
    primaryTitle: character.primaryTitle,
    councilTaskId,
    activeTask: knownTask ?? councilTask(q, storedTaskId),
  };
}

function candidateScore(character: CharacterInfo): number {
  const s = character.skills;
  return Math.max(s.diplomacy, s.martial, s.stewardship, s.intrigue, s.learning);
}

export function extractCouncil(q: Query, loc: Localizer, candidateLimit = 30): CouncilInfo {
  const playerId = numberOrNull(q.at("/played_character/character"));
  if (playerId === null)
    return { taskIds: [], memberIds: [], members: [], courtSize: 0, candidates: [] };

  // In current CK3 saves landed_data/council contains council-task IDs, not
  // character IDs. Older fixtures/saves can expose character IDs directly, so
  // retain a fallback for that representation.
  const rawCouncilIds = numberList(q.at(`/living/${playerId}/landed_data/council`));
  const taskIds: number[] = [];
  const members: CouncillorInfo[] = [];
  const seenMembers = new Set<number>();

  for (const rawId of rawCouncilIds) {
    const task = councilTask(q, rawId);
    if (task?.ownerId !== null && task?.ownerId !== undefined) {
      taskIds.push(rawId);
      const member = toCouncillor(q, loc, task.ownerId, task);
      if (member && !seenMembers.has(member.id)) {
        seenMembers.add(member.id);
        members.push(member);
      }
      continue;
    }

    // Compatibility fallback: raw value itself is a character ID.
    const member = toCouncillor(q, loc, rawId);
    if (member && !seenMembers.has(member.id)) {
      seenMembers.add(member.id);
      members.push(member);
      if (member.councilTaskId !== null) taskIds.push(member.councilTaskId);
    }
  }

  const memberIds = members.map((member) => member.id);
  const councillorSet = new Set(memberIds);

  const living = q.at("/living") as Record<string, Record<string, unknown>> | undefined;
  const courtIds: number[] = [];
  if (living) {
    for (const [idText, raw] of Object.entries(living)) {
      const id = Number(idText);
      if (!Number.isFinite(id) || id === playerId || !raw || typeof raw !== "object") continue;
      const court = raw["court_data"] as Record<string, unknown> | undefined;
      if (!court) continue;
      const employer = numberOrNull(court["employer"]);
      const host = numberOrNull(court["host"]);
      if (employer === playerId || host === playerId) courtIds.push(id);
    }
  }

  const candidates = courtIds
    .map((id) => extractCharacter(q, loc, id))
    .filter((character): character is CharacterInfo => character !== null)
    .filter((character) => character.age === null || character.age >= 16)
    .sort((a, b) => candidateScore(b) - candidateScore(a))
    .slice(0, candidateLimit)
    .map((character) => ({
      id: character.id,
      name: character.name,
      age: character.age,
      female: character.female,
      skills: character.skills,
      traits: character.traits,
      isCouncillor: councillorSet.has(character.id),
    }));

  return {
    taskIds,
    memberIds,
    members,
    courtSize: courtIds.length,
    candidates,
  };
}
