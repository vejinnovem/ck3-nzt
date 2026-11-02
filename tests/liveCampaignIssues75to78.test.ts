import { expect, test } from "vitest";
import { buildSnapshot, type Snapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
import { buildPressReview } from "../src/pressReview.js";

function baseHeader(): string {
  return `date=888.2.17
meta_data={ meta_player_name="Król Siemowit" meta_title_name="Królestwo Polska" meta_player_tier=4 meta_house_name="Piastów" }
played_character={ character=1 player=1 }
`;
}

test("exports exact character identity for same-name personal rivals", async () => {
  const gs = Buffer.from(`${baseHeader()}
landed_titles={ landed_titles={
 10={ key="k_poland" name="Polska" holder=1 }
 20={ key="c_belz" name="Bełz" holder=3 }
 30={ key="c_other" name="Inne" holder=2 }
} }
living={
 1={ first_name="Siemowit" dynasty_house=100 landed_data={ domain={ 10 } } }
 2={ first_name="Piotr" dynasty_house=200 landed_data={ domain={ 30 } } }
 3={ first_name="Piotr" dynasty_house=300 landed_data={ domain={ 20 } } }
}
opinions={ active_opinions={
 { owner=3 target=1 scripted_relations={ rival=yes } }
} }
`);

  const diplomacy = (await buildSnapshot(gs, new Localizer(null))).diplomacy;
  expect(diplomacy.personalRelations).toHaveLength(1);
  expect(diplomacy.personalRelations?.[0]).toEqual(
    expect.objectContaining({
      id: 3,
      name: "Piotr",
      primaryTitle: "Bełz",
      relationTypes: ["rival"],
    }),
  );
  expect(diplomacy.personalRelations?.some((relation) => relation.id === 2)).toBe(false);
});

test("populates warTargets from confirmed available-CB action and flags tributary offer collision", async () => {
  const gs = Buffer.from(`${baseHeader()}
landed_titles={ landed_titles={
 10={ key="k_poland" name="Polska" holder=1 }
 20={ key="d_bohemia" name="Bohemia" holder=2 }
} }
living={
 1={ first_name="Siemowit" landed_data={ domain={ 10 } } }
 2={ first_name="Smil" landed_data={ domain={ 20 } } }
}
important_action_manager={ active={
 77={
  important_action_type="action_has_any_display_cb_on"
  player=1
  character=1
  visible=yes
  scope={ root={ type="char" identity=1 } event_targets={ recipient={ type="char" identity=2 } } }
 }
 78={
  important_action_type="action_offer_tributary"
  player=1
  character=1
  visible=yes
  scope={ root={ type="char" identity=1 } event_targets={ recipient={ type="char" identity=2 } } }
 }
} }
`);

  const expansion = (await buildSnapshot(gs, new Localizer(null))).expansion;
  expect(expansion.warTargets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "Bohemia",
        cbType: "available_cb",
        targetRulerId: 2,
        targetRulerName: "Smil",
        confirmedAvailable: true,
        source: "important_action",
      }),
    ]),
  );
  expect(expansion.tributaryTruceWarnings).toEqual([
    expect.objectContaining({
      targetRulerId: 2,
      targetRulerName: "Smil",
      offerActionId: 78,
      cbActionIds: [77],
    }),
  ]);
});

function reviewSnapshot(date: string): Snapshot {
  return {
    date,
    parsedAt: Date.now(),
    overview: {
      rulerName: "Król Siemowit",
      date,
      primaryTitle: "Królestwo Polska",
      tier: 4,
      house: "Piastów",
      gold: 900,
      prestige: 5000,
      piety: 2000,
    },
    military: { wars: [] } as Snapshot["military"],
    succession: { heirProfiles: [] } as unknown as Snapshot["succession"],
    diplomacy: {
      independent: true,
      alliances: [],
      truces: [],
      hostile: [],
      tributaries: [],
      tributaryWars: [],
      puppets: [],
      personalRelations: [],
    },
    factions: [],
    vassals: [],
    vassalCount: 0,
    expansion: {
      claims: [],
      pressedCount: 0,
      deJureUnheld: [],
      warTargets: [],
      tributaryTruceWarnings: [],
      strategicTargets: [],
      targetScope: {
        deJureKingdomId: null,
        deJureKingdomName: null,
        exactAdjacencyAvailable: false,
        casusBelliCoverage: "claims_direct_de_jure_and_partial_tribal_rules",
        casusBelliLimitations: [],
      },
    },
    titles: {} as Snapshot["titles"],
  };
}

test("press review reports tributary membership, exact rival identity and tributary/CB warning", () => {
  const previous = reviewSnapshot("887.4.6");
  const current = reviewSnapshot("887.12.18");

  current.diplomacy.tributaries = [
    {
      contractId: 500,
      id: 2,
      name: "Dobrosław",
      playerRole: "suzerain",
      independentSubject: true,
      levels: [1, 2],
      classificationSource: "independent_subject_contract",
      evidence: ["vassal_contracts.database"],
    },
  ];
  current.diplomacy.personalRelations = [
    {
      id: 3,
      name: "Piotr",
      primaryTitle: "Bełz",
      dynastyHouseId: 300,
      dynastyHouseName: "Kutwa",
      relationTypes: ["rival"],
      contexts: ["independent_ruler"],
      evidence: ["opinions.active_opinions.0.scripted_relations.rival"],
    },
  ];
  current.expansion.tributaryTruceWarnings = [
    {
      targetRulerId: 4,
      targetRulerName: "Smil",
      targetRealm: "Bohemia",
      offerActionId: 90,
      cbActionIds: [91],
      evidence: ["important_action:90", "available_cb_action:91"],
      summary:
        "Tributary offer from Smil (Bohemia) overlaps a confirmed available CB; accepting the tributary interaction can create a truce and block expansion.",
    },
  ];

  const review = buildPressReview(previous, current);
  expect(review.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ summary: "New tributary: Dobrosław (character 2)." }),
      expect.objectContaining({
        priority: "watch",
        summary: "Personal relation gained: Piotr (Bełz), character 3 -> rival.",
        actorIds: [3],
      }),
      expect.objectContaining({
        priority: "action_required",
        summary: expect.stringContaining("Smil (Bohemia)"),
        actorIds: [4],
      }),
    ]),
  );
});
