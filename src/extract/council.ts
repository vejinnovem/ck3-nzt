import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { formatCk3Date } from "../format.js";
import { extractCharacter, type CharacterInfo } from "./characters.js";
import { extractCountyContext, type CountyContextInfo } from "./countyContext.js";
import { resolveTitleName, titleTierFromKey } from "./titleUtils.js";

export type CouncilOffice = "chancellor" | "steward" | "marshal" | "spymaster" | "court_chaplain";
export type CourtStatus = "courtier" | "guest";
export type CharacterPresenceStatus =
  | "ruler"
  | "at_player_court"
  | "visiting_player_court"
  | "travelling"
  | "in_army"
  | "unknown";
export type CouncilAvailabilityStatus =
  | "likely_unavailable_travelling"
  | "likely_unavailable_in_army"
  | "not_evaluated";

type Obj = Record<string, unknown>;
type Primitive = string | number | boolean;

export interface CouncilTaskDiagnostics {
  fieldNames: string[];
  primitiveFields: Record<string, Primitive>;
  unresolvedTarget: boolean;
}

export interface CouncilTaskInfo {
  id: number;
  type: string | null;
  ownerId: number | null;
  courtOwnerId: number | null;
  office: CouncilOffice | null;
  targetTitleId: number | null;
  targetTitle: string | null;
  targetCounty: CountyContextInfo | null;
  diagnostics?: CouncilTaskDiagnostics;
}

export interface TravelReferenceInfo {
  planId: string | null;
  role: string;
  path: string;
}

export interface CharacterAvailabilityInfo {
  presenceStatus: CharacterPresenceStatus;
  councilAvailability: CouncilAvailabilityStatus;
  employerId: number | null;
  hostId: number | null;
  armyId: number | null;
  wantsToLeaveCourt: boolean;
  leaveCourtDate: string | null;
  travelling: boolean;
  travelPlanIds: string[];
  travelRoles: string[];
  travelReferences: TravelReferenceInfo[];
  unclassifiedTravelReferencePaths: string[];
  source: "court_data_and_travel_plans_best_effort";
  limitation: string;
}

export interface CouncillorInfo {
  id: number;
  name: string;
  dynastyHouseId: number | null;
  dynastyHouseName: string | null;
  age: number | null;
  skills: CharacterInfo["skills"];
  traits: string[];
  primaryTitle: string | null;
  councilTaskId: number | null;
  activeTask: CouncilTaskInfo | null;
  availability: CharacterAvailabilityInfo;
}

export interface CourtCandidateInfo {
  id: number;
  name: string;
  dynastyHouseId: number | null;
  dynastyHouseName: string | null;
  age: number | null;
  female: boolean;
  skills: CharacterInfo["skills"];
  traits: string[];
  isCouncillor: boolean;
  courtStatus: CourtStatus;
  /** We cannot infer office eligibility reliably without doctrine/static game data. */
  councilEligibility: "current_councillor" | "unknown";
  availability: CharacterAvailabilityInfo;
}

export interface CouncilOfficeInfo {
  office: CouncilOffice;
  vacant: boolean;
  memberId: number | null;
  taskId: number | null;
  taskType: string | null;
}

export interface CouncilInfo {
  /** Raw IDs stored in landed_data/council when they resolve as council tasks. */
  taskIds: number[];
  /** Character IDs of the resolved councillors. */
  memberIds: number[];
  members: CouncillorInfo[];
  offices: CouncilOfficeInfo[];
  courtSize: number;
  courtierCount: number;
  guestCount: number;
  candidates: CourtCandidateInfo[];
}

const STANDARD_OFFICES: CouncilOffice[] = [
  "chancellor",
  "steward",
  "marshal",
  "spymaster",
  "court_chaplain",
];

const TARGETED_TASKS = new Set([
  "task_integrate_title",
  "task_develop_county",
  "task_promote_culture",
  "task_increase_control",
  "task_fabricate_claim",
  "task_convert_county",
]);

const CHARACTER_TRAVEL_PATH =
  /(owner|character|entourage|participant|travel[_-]?leader|leader|companion|guest|ward|guardian|travell?er)/i;

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function numberList(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function referenceNumber(value: unknown, keys: string[]): number | null {
  const direct = numberOrNull(value);
  if (direct !== null) return direct;
  const record = obj(value);
  if (!record) return null;
  for (const key of keys) {
    const found = numberOrNull(record[key]);
    if (found !== null) return found;
  }
  return null;
}

function primitiveFields(record: Obj, limit = 32): Record<string, Primitive> {
  const result: Record<string, Primitive> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Object.keys(result).length >= limit) break;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function containsNumberReference(value: unknown, target: number, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === "number") return value === target;
  if (Array.isArray(value)) {
    return value.some((item) => containsNumberReference(item, target, depth + 1));
  }
  if (typeof value !== "object") return false;
  return Object.values(value as Obj).some((child) =>
    containsNumberReference(child, target, depth + 1),
  );
}

function travelRole(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes("entourage")) return "entourage";
  if (lower.includes("travel_leader") || lower.includes("travel-leader")) return "travel_leader";
  if (lower.includes("participant")) return "participant";
  if (lower.includes("companion")) return "companion";
  if (lower.includes("guardian")) return "guardian";
  if (lower.includes("ward")) return "ward";
  if (lower.includes("guest")) return "guest";
  if (lower.includes("owner")) return "owner";
  if (lower.includes("leader")) return "leader";
  if (lower.includes("traveler") || lower.includes("traveller")) return "traveller";
  if (lower.includes("character")) return "character";
  return "unclassified";
}

function travelPlanId(path: string): string | null {
  for (const segment of path.split("/").filter(Boolean)) {
    if (/^\d+$/.test(segment)) return segment;
  }
  return null;
}

function collectTravelReferences(
  value: unknown,
  targetId: number,
  path = "",
  depth = 0,
  out: TravelReferenceInfo[] = [],
  unclassified: string[] = [],
): { classified: TravelReferenceInfo[]; unclassified: string[] } {
  if (depth > 12 || value === null || value === undefined) return { classified: out, unclassified };
  if (typeof value === "number") {
    if (value !== targetId) return { classified: out, unclassified };
    if (CHARACTER_TRAVEL_PATH.test(path)) {
      out.push({ planId: travelPlanId(path), role: travelRole(path), path });
    } else if (unclassified.length < 16) {
      unclassified.push(path);
    }
    return { classified: out, unclassified };
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectTravelReferences(value[index], targetId, `${path}/${index}`, depth + 1, out, unclassified);
    }
    return { classified: out, unclassified };
  }
  if (typeof value !== "object") return { classified: out, unclassified };
  for (const [key, child] of Object.entries(value as Obj)) {
    collectTravelReferences(child, targetId, `${path}/${key}`, depth + 1, out, unclassified);
  }
  return { classified: out, unclassified };
}

function characterAvailability(q: Query, id: number, playerId: number): CharacterAvailabilityInfo {
  const courtBase = `/living/${id}/court_data`;
  const employerId = numberOrNull(q.at(`${courtBase}/employer`));
  const hostId = numberOrNull(q.at(`${courtBase}/host`));
  const armyId = numberOrNull(q.at(`${courtBase}/army`));
  const wantsToLeaveCourt = q.at(`${courtBase}/wants_to_leave_court`) === true;
  const leaveCourtRaw = q.at(`${courtBase}/leave_court_date`);
  const leaveCourtDate = leaveCourtRaw === undefined ? null : formatCk3Date(leaveCourtRaw);

  const travelRoot = q.at("/travel_plans");
  const travel = collectTravelReferences(travelRoot, id, "/travel_plans");
  const unique = new Map<string, TravelReferenceInfo>();
  for (const reference of travel.classified) {
    unique.set(`${reference.planId ?? "?"}|${reference.role}|${reference.path}`, reference);
  }
  const travelReferences = [...unique.values()].slice(0, 32);
  const travelling = travelReferences.length > 0;
  const travelPlanIds = [
    ...new Set(
      travelReferences
        .map((reference) => reference.planId)
        .filter((planId): planId is string => planId !== null),
    ),
  ];
  const travelRoles = [...new Set(travelReferences.map((reference) => reference.role))];

  let presenceStatus: CharacterPresenceStatus = "unknown";
  if (travelling) presenceStatus = "travelling";
  else if (armyId !== null) presenceStatus = "in_army";
  else if (id === playerId) presenceStatus = "ruler";
  else if (employerId === playerId) presenceStatus = "at_player_court";
  else if (hostId === playerId) presenceStatus = "visiting_player_court";

  let councilAvailability: CouncilAvailabilityStatus = "not_evaluated";
  if (travelling) councilAvailability = "likely_unavailable_travelling";
  else if (armyId !== null) councilAvailability = "likely_unavailable_in_army";

  return {
    presenceStatus,
    councilAvailability,
    employerId,
    hostId,
    armyId,
    wantsToLeaveCourt,
    leaveCourtDate,
    travelling,
    travelPlanIds,
    travelRoles,
    travelReferences,
    unclassifiedTravelReferencePaths: travel.unclassified.slice(0, 16),
    source: "court_data_and_travel_plans_best_effort",
    limitation:
      "Travel is confirmed only when the character id occurs under a character-like field in serialized travel_plans. Unclassified numeric matches are diagnostic only. Council eligibility still depends on CK3 runtime rules and is not reconstructed here.",
  };
}

function countyTitleIdForCouncilTask(q: Query, taskId: number): number | null {
  const counties = obj(q.at("/county_manager/counties"));
  const titles = obj(q.at("/landed_titles/landed_titles"));
  if (!counties || !titles) return null;

  let countyKey: string | null = null;
  for (const [key, rawCounty] of Object.entries(counties)) {
    const county = obj(rawCounty);
    if (!county || !containsNumberReference(county["council_tasks"], taskId)) continue;
    countyKey = key;
    break;
  }
  if (countyKey === null) return null;

  for (const [idText, rawTitle] of Object.entries(titles)) {
    const id = Number(idText);
    const title = obj(rawTitle);
    if (!Number.isFinite(id) || !title || title["key"] !== countyKey) continue;
    if (titleTierFromKey(countyKey) === "county") return id;
  }
  return null;
}

function officeForTask(type: string | null): CouncilOffice | null {
  if (!type) return null;
  if (["task_foreign_affairs", "task_domestic_affairs", "task_integrate_title"].includes(type)) {
    return "chancellor";
  }
  if (
    ["task_collect_taxes", "task_develop_county", "task_promote_culture", "task_manage_domain"].includes(
      type,
    )
  ) {
    return "steward";
  }
  if (["task_organize_levies", "task_train_commanders", "task_increase_control"].includes(type)) {
    return "marshal";
  }
  if (["task_disrupt_schemes", "task_support_schemes", "task_find_secrets"].includes(type)) {
    return "spymaster";
  }
  if (
    ["task_religious_relations", "task_fabricate_claim", "task_convert_county"].includes(type)
  ) {
    return "court_chaplain";
  }
  return null;
}

function targetTitleId(q: Query, task: Obj): number | null {
  for (const field of [
    "target_title",
    "target_county",
    "county",
    "landed_title",
    "target",
    "location",
  ]) {
    const candidate = referenceNumber(task[field], ["title", "landed_title", "county", "id", "value"]);
    if (candidate === null) continue;
    const key = q.at(`/landed_titles/landed_titles/${candidate}/key`);
    if (typeof key === "string" && titleTierFromKey(key) !== "other") return candidate;
  }
  return null;
}

function councilTask(q: Query, loc: Localizer, taskId: number | null): CouncilTaskInfo | null {
  if (taskId === null) return null;
  const base = `/council_task_manager/active/${taskId}`;
  const record = obj(q.at(base));
  const type = q.at(`${base}/type`);
  const ownerId = numberOrNull(q.at(`${base}/owner`));
  const courtOwnerId = numberOrNull(q.at(`${base}/court_owner`));

  if (!record && type === undefined && ownerId === null && courtOwnerId === null) return null;
  const taskType = typeof type === "string" ? type : null;
  let targetId = record ? targetTitleId(q, record) : null;
  if (targetId === null && taskType !== null && TARGETED_TASKS.has(taskType)) {
    targetId = countyTitleIdForCouncilTask(q, taskId);
  }
  const targetKey =
    targetId === null ? null : q.at(`/landed_titles/landed_titles/${targetId}/key`);
  const targetCounty =
    targetId !== null && typeof targetKey === "string" && titleTierFromKey(targetKey) === "county"
      ? extractCountyContext(q, loc, targetId)
      : null;

  const result: CouncilTaskInfo = {
    id: taskId,
    type: taskType,
    ownerId,
    courtOwnerId,
    office: officeForTask(taskType),
    targetTitleId: targetId,
    targetTitle: targetId === null ? null : resolveTitleName(q, loc, targetId),
    targetCounty,
  };

  if (record && taskType !== null && TARGETED_TASKS.has(taskType) && targetId === null) {
    result.diagnostics = {
      fieldNames: Object.keys(record).slice(0, 64),
      primitiveFields: primitiveFields(record),
      unresolvedTarget: true,
    };
  }
  return result;
}

function toCouncillor(
  q: Query,
  loc: Localizer,
  id: number,
  playerId: number,
  knownTask: CouncilTaskInfo | null = null,
): CouncillorInfo | null {
  const character = extractCharacter(q, loc, id);
  if (!character) return null;
  const storedTaskId = numberOrNull(q.at(`/living/${id}/court_data/council_task`));
  const councilTaskId = knownTask?.id ?? storedTaskId;
  return {
    id,
    name: character.name,
    dynastyHouseId: character.dynastyHouseId,
    dynastyHouseName: character.dynastyHouseName,
    age: character.age,
    skills: character.skills,
    traits: character.traits,
    primaryTitle: character.primaryTitle,
    councilTaskId,
    activeTask: knownTask ?? councilTask(q, loc, storedTaskId),
    availability: characterAvailability(q, id, playerId),
  };
}

function candidateScore(character: CharacterInfo): number {
  const s = character.skills;
  return Math.max(s.diplomacy, s.martial, s.stewardship, s.intrigue, s.learning);
}

export function extractCouncil(q: Query, loc: Localizer, candidateLimit = 30): CouncilInfo {
  const playerId = numberOrNull(q.at("/played_character/character"));
  if (playerId === null) {
    return {
      taskIds: [],
      memberIds: [],
      members: [],
      offices: STANDARD_OFFICES.map((office) => ({
        office,
        vacant: true,
        memberId: null,
        taskId: null,
        taskType: null,
      })),
      courtSize: 0,
      courtierCount: 0,
      guestCount: 0,
      candidates: [],
    };
  }

  const rawCouncilIds = numberList(q.at(`/living/${playerId}/landed_data/council`));
  const taskIds: number[] = [];
  const members: CouncillorInfo[] = [];
  const seenMembers = new Set<number>();

  for (const rawId of rawCouncilIds) {
    const task = councilTask(q, loc, rawId);
    if (task?.ownerId !== null && task?.ownerId !== undefined) {
      taskIds.push(rawId);
      const member = toCouncillor(q, loc, task.ownerId, playerId, task);
      if (member && !seenMembers.has(member.id)) {
        seenMembers.add(member.id);
        members.push(member);
      }
      continue;
    }

    const member = toCouncillor(q, loc, rawId, playerId);
    if (member && !seenMembers.has(member.id)) {
      seenMembers.add(member.id);
      members.push(member);
      if (member.councilTaskId !== null) taskIds.push(member.councilTaskId);
    }
  }

  const memberIds = members.map((member) => member.id);
  const councillorSet = new Set(memberIds);
  const officeMap = new Map<CouncilOffice, CouncilOfficeInfo>();
  for (const office of STANDARD_OFFICES) {
    officeMap.set(office, {
      office,
      vacant: true,
      memberId: null,
      taskId: null,
      taskType: null,
    });
  }
  for (const member of members) {
    const task = member.activeTask;
    if (!task?.office) continue;
    officeMap.set(task.office, {
      office: task.office,
      vacant: false,
      memberId: member.id,
      taskId: task.id,
      taskType: task.type,
    });
  }

  const living = q.at("/living") as Record<string, Record<string, unknown>> | undefined;
  const courtPeople: Array<{ id: number; status: CourtStatus }> = [];
  if (living) {
    for (const [idText, raw] of Object.entries(living)) {
      const id = Number(idText);
      if (!Number.isFinite(id) || id === playerId || !raw || typeof raw !== "object") continue;
      const court = raw["court_data"] as Record<string, unknown> | undefined;
      if (!court) continue;
      const employer = numberOrNull(court["employer"]);
      const host = numberOrNull(court["host"]);
      if (employer === playerId) courtPeople.push({ id, status: "courtier" });
      else if (host === playerId) courtPeople.push({ id, status: "guest" });
    }
  }

  const candidates: CourtCandidateInfo[] = courtPeople
    .map(({ id, status }) => ({ character: extractCharacter(q, loc, id), status }))
    .filter(
      (entry): entry is { character: CharacterInfo; status: CourtStatus } => entry.character !== null,
    )
    .filter(({ character }) => character.age === null || character.age >= 16)
    .sort((a, b) => candidateScore(b.character) - candidateScore(a.character))
    .slice(0, candidateLimit)
    .map(({ character, status }) => ({
      id: character.id,
      name: character.name,
      dynastyHouseId: character.dynastyHouseId,
      dynastyHouseName: character.dynastyHouseName,
      age: character.age,
      female: character.female,
      skills: character.skills,
      traits: character.traits,
      isCouncillor: councillorSet.has(character.id),
      courtStatus: status,
      councilEligibility: councillorSet.has(character.id) ? "current_councillor" : "unknown",
      availability: characterAvailability(q, character.id, playerId),
    }));

  return {
    taskIds,
    memberIds,
    members,
    offices: STANDARD_OFFICES.map((office) => officeMap.get(office)!),
    courtSize: courtPeople.length,
    courtierCount: courtPeople.filter(({ status }) => status === "courtier").length,
    guestCount: courtPeople.filter(({ status }) => status === "guest").length,
    candidates,
  };
}
