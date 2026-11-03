import { expect, test } from "vitest";
import { buildCouncilAdvisory } from "../src/councilAdvisory.js";
import type { Snapshot } from "../src/snapshot.js";

function snapshot(): Snapshot {
  return {
    council: {
      taskIds: [100],
      memberIds: [11],
      members: [
        {
          id: 11,
          name: "Steward",
          dynastyHouseId: null,
          dynastyHouseName: null,
          age: 40,
          skills: {
            diplomacy: 4,
            martial: 3,
            stewardship: 15,
            intrigue: 4,
            learning: 5,
            prowess: 2,
          },
          traits: [],
          primaryTitle: null,
          councilTaskId: 100,
          activeTask: {
            id: 100,
            type: "task_manage_domain",
            ownerId: 11,
            courtOwnerId: 10,
            office: "steward",
            targetTitleId: null,
            targetTitle: null,
            targetCounty: null,
          },
          availability: {} as never,
        },
      ],
      offices: [],
      courtSize: 3,
      courtierCount: 2,
      guestCount: 1,
      candidates: [
        {
          id: 11,
          name: "Steward",
          dynastyHouseId: null,
          dynastyHouseName: null,
          age: 40,
          female: false,
          skills: {
            diplomacy: 4,
            martial: 3,
            stewardship: 15,
            intrigue: 4,
            learning: 5,
            prowess: 2,
          },
          traits: [],
          isCouncillor: true,
          courtStatus: "courtier",
          councilEligibility: "current_councillor",
          availability: {} as never,
        },
        {
          id: 12,
          name: "Guest",
          dynastyHouseId: null,
          dynastyHouseName: null,
          age: 30,
          female: false,
          skills: {
            diplomacy: 8,
            martial: 8,
            stewardship: 8,
            intrigue: 8,
            learning: 8,
            prowess: 8,
          },
          traits: [],
          isCouncillor: false,
          courtStatus: "guest",
          councilEligibility: "unknown",
          availability: {} as never,
        },
        {
          id: 13,
          name: "Courtier",
          dynastyHouseId: null,
          dynastyHouseName: null,
          age: 35,
          female: true,
          skills: {
            diplomacy: 14,
            martial: 5,
            stewardship: 6,
            intrigue: 11,
            learning: 9,
            prowess: 3,
          },
          traits: [],
          isCouncillor: false,
          courtStatus: "courtier",
          councilEligibility: "unknown",
          availability: {} as never,
        },
      ],
    },
    vassals: [
      {
        id: 14,
        name: "Direct Vassal",
        age: 45,
        skills: {
          diplomacy: 12,
          martial: 10,
          stewardship: 7,
          intrigue: 6,
          learning: 5,
          prowess: 10,
        },
        councilSeat: false,
      },
      {
        id: 15,
        name: "Minor Vassal",
        age: 14,
        skills: {
          diplomacy: 10,
          martial: 10,
          stewardship: 10,
          intrigue: 10,
          learning: 10,
          prowess: 10,
        },
        councilSeat: false,
      },
    ],
  } as unknown as Snapshot;
}

function office(
  advisory: ReturnType<typeof buildCouncilAdvisory>,
  characterId: number,
  officeName: "chancellor" | "steward" | "marshal" | "spymaster" | "court_chaplain",
) {
  return advisory.candidates
    .find((candidate) => candidate.id === characterId)!
    .officeAssessments.find((entry) => entry.office === officeName)!;
}

test("#85 confirms a current holder only for the occupied council office", () => {
  const advisory = buildCouncilAdvisory(snapshot());
  const steward = advisory.candidates.find((candidate) => candidate.id === 11)!;

  expect(steward.sources).toEqual(["courtier", "current_councillor"]);
  expect(steward.currentOffice).toBe("steward");
  expect(office(advisory, 11, "steward")).toMatchObject({
    relevantSkill: "stewardship",
    serializedSkill: 15,
    effectiveSkill: null,
    effectiveSkillAvailable: false,
    eligibility: "eligible",
    eligibilityReason: "current_office_holder",
  });
  expect(office(advisory, 11, "chancellor").eligibility).toBe("unknown");
});

test("#85 marks unrecruited guests as ineligible instead of generic unknown", () => {
  const advisory = buildCouncilAdvisory(snapshot());
  const guest = advisory.candidates.find((candidate) => candidate.id === 12)!;

  expect(guest.sources).toEqual(["guest"]);
  expect(guest.officeAssessments.every((entry) => entry.eligibility === "ineligible")).toBe(true);
  expect(office(advisory, 12, "marshal").eligibilityReason).toBe("guest_requires_recruitment");
});

test("#85 includes direct vassals outside the player's court candidate list", () => {
  const advisory = buildCouncilAdvisory(snapshot());
  const vassal = advisory.candidates.find((candidate) => candidate.id === 14)!;

  expect(vassal.sources).toEqual(["direct_vassal"]);
  expect(office(advisory, 14, "chancellor")).toMatchObject({
    serializedSkill: 12,
    effectiveSkill: null,
    eligibility: "unknown",
    eligibilityReason: "runtime_rules_not_reconstructed",
  });
  expect(office(advisory, 14, "court_chaplain").eligibilityReason).toBe(
    "faith_runtime_rules_not_reconstructed",
  );
});

test("#85 rejects an underage direct vassal for every standard office", () => {
  const advisory = buildCouncilAdvisory(snapshot());
  const minor = advisory.candidates.find((candidate) => candidate.id === 15)!;

  expect(minor.officeAssessments.every((entry) => entry.eligibility === "ineligible")).toBe(true);
  expect(minor.officeAssessments.every((entry) => entry.eligibilityReason === "underage")).toBe(true);
});
