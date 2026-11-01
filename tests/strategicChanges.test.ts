import { expect, test } from "vitest";
import { buildChanges } from "../src/memory.js";
import type { Snapshot } from "../src/snapshot.js";

function baseSnapshot(date: string): Snapshot {
  return {
    date,
    parsedAt: Date.now(),
    overview: {
      rulerName: "Siemowit",
      date,
      primaryTitle: "Polania",
      tier: 3,
      house: "Piastów",
      gold: 500,
      prestige: 1000,
      piety: 500,
    },
    military: {
      levy: 1000,
      strength: 1500,
      currentStrength: 1500,
      strengthWithoutHires: 1500,
      wars: [],
    } as Snapshot["military"],
    succession: {} as Snapshot["succession"],
    diplomacy: {} as Snapshot["diplomacy"],
    factions: [],
    vassals: [],
    vassalCount: 0,
    expansion: {} as Snapshot["expansion"],
    titles: {} as Snapshot["titles"],
  };
}

const atCourt = {
  presenceStatus: "at_player_court",
  councilAvailability: "not_evaluated",
  employerId: 10,
  hostId: null,
  armyId: null,
  wantsToLeaveCourt: false,
  leaveCourtDate: null,
  travelling: false,
  travelPlanIds: [],
  travelRoles: [],
  travelReferences: [],
  unclassifiedTravelReferencePaths: [],
  source: "court_data_and_travel_plans_best_effort",
  limitation: "test",
} as const;

const travelling = {
  ...atCourt,
  presenceStatus: "travelling",
  councilAvailability: "likely_unavailable_travelling",
  travelling: true,
  travelPlanIds: ["500"],
  travelRoles: ["entourage"],
} as const;

test("changes include council seats guardians and important-character availability", () => {
  const previous = baseSnapshot("877.3.20");
  const current = baseSnapshot("877.5.6");

  previous.council = {
    taskIds: [100],
    memberIds: [18664],
    members: [
      {
        id: 18664,
        name: "Rodislav",
        dynastyHouseId: null,
        dynastyHouseName: null,
        age: 41,
        skills: { diplomacy: 11, martial: 14, stewardship: 10, intrigue: 8, learning: 8, prowess: 13 },
        traits: [],
        primaryTitle: null,
        councilTaskId: 100,
        activeTask: null,
        availability: atCourt,
      },
    ],
    offices: [
      { office: "marshal", vacant: false, memberId: 18664, taskId: 100, taskType: "task_increase_control" },
    ],
    courtSize: 1,
    courtierCount: 1,
    guestCount: 0,
    candidates: [
      {
        id: 18664,
        name: "Rodislav",
        dynastyHouseId: null,
        dynastyHouseName: null,
        age: 41,
        female: false,
        skills: { diplomacy: 11, martial: 14, stewardship: 10, intrigue: 8, learning: 8, prowess: 13 },
        traits: [],
        isCouncillor: true,
        courtStatus: "courtier",
        councilEligibility: "current_councillor",
        availability: atCourt,
      },
    ],
  } as Snapshot["council"];

  current.council = {
    ...previous.council,
    taskIds: [],
    memberIds: [],
    members: [],
    offices: [{ office: "marshal", vacant: true, memberId: null, taskId: null, taskType: null }],
    candidates: [
      {
        ...previous.council.candidates[0]!,
        isCouncillor: false,
        councilEligibility: "unknown",
        availability: travelling,
      },
    ],
  } as Snapshot["council"];

  previous.education = {
    children: [
      {
        id: 42735,
        name: "Niemir",
        age: 7,
        successionPosition: 4,
        focus: null,
        skills: { diplomacy: 5, martial: 3, stewardship: 1, intrigue: 2, learning: 3, prowess: 1 },
        traits: [],
        guardianIds: [],
        guardianNames: [],
        guardianStatus: "not_found",
      },
    ],
    childrenWithoutGuardian: 1,
    source: "succession_and_descendants_plus_scripted_relations",
    limitation: "test",
  };
  current.education = {
    ...previous.education,
    childrenWithoutGuardian: 0,
    children: [
      {
        ...previous.education.children[0]!,
        guardianIds: [18664],
        guardianNames: ["Rodislav"],
        guardianStatus: "present",
      },
    ],
  };

  const changes = buildChanges(previous, current).changes;

  expect(changes).toContainEqual({
    key: "council.office.marshal",
    before: "18664:Rodislav",
    after: null,
  });
  expect(changes).toContainEqual({
    key: "education.guardians.42735",
    before: null,
    after: "18664:Rodislav",
  });
  expect(changes.find((change) => change.key === "characters.availability.18664")).toMatchObject({
    before: expect.stringContaining("at_player_court"),
    after: expect.stringContaining("travelling"),
  });
});
