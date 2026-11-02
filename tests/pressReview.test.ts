import { expect, test } from "vitest";
import { buildPressReview } from "../src/pressReview.js";
import type { Snapshot } from "../src/snapshot.js";

function snapshot(date: string): Snapshot {
  return {
    date,
    parsedAt: Date.now(),
    overview: {
      rulerName: "Król Siemowit",
      date,
      primaryTitle: "Królestwo Polska",
      tier: 4,
      house: "Piastów",
      gold: 700,
      prestige: 4700,
      piety: 2200,
    },
    realm: {
      playerId: 1,
      playerHeldTitleIds: [10],
      countyCount: 1,
      playerHeldCountyCount: 1,
      vassalHeldCountyCount: 0,
      counties: [
        {
          titleId: 10,
          key: "c_opole",
          name: "Opole",
          holderId: 2,
          holderName: "Niemir",
          control: 100,
          development: 2,
          cultureId: 1,
          faith: null,
          faithName: null,
          rite: null,
          riteName: null,
          sameCultureAsRuler: true,
          sameFaithAsRuler: null,
          sameRiteAsRuler: null,
          popularOpinion: null,
          heldByPlayer: false,
          holderDynastyHouseId: 1,
          holderDynastyHouseName: "Piastów",
          deFactoPathToPlayer: [10],
        },
      ],
      relevantForeignCountyCount: 0,
      relevantForeignCounties: [],
      relevantForeignCountsByReason: {
        same_de_jure_kingdom: 0,
        ally_realm: 0,
        truce_realm: 0,
        hostile_opinion_realm: 0,
        active_war_enemy_realm: 0,
      },
      exactAdjacencyAvailable: false,
      source: "de_facto_title_graph",
      limitation: null,
    },
    military: {
      levy: 4000,
      strength: 4900,
      currentStrength: 4700,
      strengthWithoutHires: 4900,
      wars: [],
    } as Snapshot["military"],
    succession: {
      heirProfiles: [
        {
          id: 20,
          name: "Dobromir",
          position: 1,
          spouses: [],
          betrothed: { id: 21, name: "Vera", dynastyHouseId: 2 },
        },
      ],
    } as Snapshot["succession"],
    diplomacy: {
      independent: true,
      alliances: [],
      truces: [],
      hostile: [],
      tributaries: [],
      tributaryWars: [],
      puppets: [],
    },
    factions: [{ id: "f1" }] as unknown as Snapshot["factions"],
    vassals: [],
    vassalCount: 0,
    expansion: {} as Snapshot["expansion"],
    titles: {} as Snapshot["titles"],
  };
}

test("press review highlights territory, control, marriage, factions and tributary wars", () => {
  const previous = snapshot("886.1.1");
  const current = snapshot("886.5.15");

  current.realm!.counties[0]!.control = 90.3;
  current.realm!.counties.push({
    ...current.realm!.counties[0]!,
    titleId: 11,
    key: "c_landsberg",
    name: "Santok",
    holderId: 3,
    holderName: "Gardomir",
    control: 0.3,
    heldByPlayer: false,
  });
  current.realm!.countyCount = 2;
  current.realm!.vassalHeldCountyCount = 2;
  current.factions = [];
  current.succession = {
    ...current.succession,
    heirProfiles: [
      {
        ...current.succession.heirProfiles[0]!,
        betrothed: null,
        spouses: [{ id: 21, name: "Vera", dynastyHouseId: 2 }],
      },
    ],
  } as Snapshot["succession"];
  current.diplomacy.tributaryWars = [
    {
      warId: 50,
      startDate: "886.4.1",
      cbType: "county_conquest_cb",
      targetTitleIds: [30],
      targetTitles: ["Świecie"],
      attackerIds: [40],
      attackerNames: ["Jaromil"],
      defenderIds: [41],
      defenderNames: ["Wratislaw"],
      playerTributaryAttackerIds: [40],
      playerTributaryDefenderIds: [41],
      betweenPlayerTributaries: true,
      classification: "between_player_tributaries",
    },
  ];

  const review = buildPressReview(previous, current);

  expect(review.fromDate).toBe("886.1.1");
  expect(review.toDate).toBe("886.5.15");
  expect(review.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ category: "territory", summary: expect.stringContaining("Santok") }),
      expect.objectContaining({ category: "control", priority: "watch", summary: expect.stringContaining("Opole") }),
      expect.objectContaining({ category: "family", summary: "Dobromir married Vera." }),
      expect.objectContaining({ category: "faction", summary: expect.stringContaining("dissolved") }),
      expect.objectContaining({ category: "war", summary: expect.stringContaining("Jaromil") }),
    ]),
  );
});
