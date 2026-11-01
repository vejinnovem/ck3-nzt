import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractImportantActions } from "../src/extract/importantActions.js";

const GS = Buffer.from(`
played_character={ character=10 }
landed_titles={ landed_titles={ 100={ key="c_test" name="Test County" holder=20 } } }
living={
 10={ first_name="Player" }
 20={ first_name="Maciej" }
 30={ first_name="Dobromir" }
}
important_action_manager={ active={
 500={ type="action_powerful_vassal_council" actor=10 recipient=20 title=100 priority=100 }
 501={ action_type="action_educate_child" actor=10 recipient=30 priority=50 }
}}
`);

test("extractImportantActions keeps generic UI advisory records and references", async () => {
  const info = await queryGamestate(GS, (q) => extractImportantActions(q, new Localizer(null)));
  expect(info.activeCount).toBe(2);
  expect(info.playerReferencedCount).toBe(2);
  expect(info.actions[0]).toMatchObject({
    id: 500,
    type: "action_powerful_vassal_council",
    playerReferenced: true,
    characterRefs: [
      { field: "actor", id: 10, name: "Player" },
      { field: "recipient", id: 20, name: "Maciej" },
    ],
    titleRefs: [{ field: "title", id: 100, name: "Test County", key: "c_test" }],
  });
  expect(info.actions[1]).toMatchObject({
    id: 501,
    type: "action_educate_child",
  });
});
