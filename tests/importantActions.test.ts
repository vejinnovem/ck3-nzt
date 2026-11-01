import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractImportantActions } from "../src/extract/importantActions.js";

const GS = Buffer.from(`
played_character={ character=10 }
landed_titles={ landed_titles={ 100={ key="c_test" name="Test County" holder=20 } } }
dynasties={ dynasty_house={ 200={ name="TestHouse" } } }
living={
 10={ first_name="Player" }
 20={ first_name="Maciej" dynasty_house=200 landed_data={ domain={ 100 } } }
 30={ first_name="Dobromir" }
}
important_action_manager={ active={
 500={
   type="action_powerful_vassal_council"
   actor=10
   scope={ target={ character=20 title=100 } marker="nested" }
   priority=100
  }
 501={ action_type="action_educate_child" actor=10 recipient=30 priority=50 }
}}
`);

test("extractImportantActions resolves nested UI advisory scope targets", async () => {
  const info = await queryGamestate(GS, (q) => extractImportantActions(q, new Localizer(null)));
  expect(info.activeCount).toBe(2);
  expect(info.playerReferencedCount).toBe(2);
  expect(info.actions[0]).toMatchObject({
    id: 500,
    type: "action_powerful_vassal_council",
    playerReferenced: true,
    characterRefs: [
      {
        field: "actor",
        id: 10,
        name: "Player",
        dynastyHouseId: null,
        dynastyHouseName: null,
        primaryTitle: null,
      },
      {
        field: "scope.target.character",
        id: 20,
        name: "Maciej",
        dynastyHouseId: 200,
        dynastyHouseName: "TestHouse",
        primaryTitle: "Test County",
      },
    ],
    targetCharacterRefs: [
      {
        field: "scope.target.character",
        id: 20,
        name: "Maciej",
        dynastyHouseId: 200,
        dynastyHouseName: "TestHouse",
        primaryTitle: "Test County",
      },
    ],
    targetTitleRefs: [
      { field: "scope.target.title", id: 100, name: "Test County", key: "c_test" },
    ],
    scopePrimitiveFields: {
      "scope.target.character": 20,
      "scope.target.title": 100,
      "scope.marker": "nested",
    },
  });
  expect(info.actions[1]).toMatchObject({
    id: 501,
    type: "action_educate_child",
    targetCharacterRefs: [],
    targetTitleRefs: [],
    scopePrimitiveFields: {},
  });
});
