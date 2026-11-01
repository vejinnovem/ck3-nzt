import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractImportantActions } from "../src/extract/importantActions.js";

const GS = Buffer.from(`
played_character={ character=10 }
landed_titles={ landed_titles={
 100={ key="d_mazovia" name="Mazowsze" holder=20 }
} }
living={
 10={ first_name="Player" }
 20={ first_name="Borzyslaw" landed_data={ domain={ 100 } } }
}
important_action_manager={ active={
 500={
   type="action_can_usurp_title"
   actor=10
   scope={ event_targets={ landed_title={ type="lt" identity=100 } } }
  }
}}
`);

test("extractImportantActions resolves typed lt landed-title targets", async () => {
  const info = await queryGamestate(GS, (q) => extractImportantActions(q, new Localizer(null)));

  expect(info.actions[0]).toMatchObject({
    type: "action_can_usurp_title",
    targetCharacterRefs: [],
    targetTitleRefs: [
      {
        field: "scope.event_targets.landed_title.identity",
        id: 100,
        name: "Mazowsze",
        key: "d_mazovia",
      },
    ],
  });
});
