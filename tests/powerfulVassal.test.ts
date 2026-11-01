import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractVassals } from "../src/extract/vassals.js";

const GS = Buffer.from(`
date=900.1.1
played_character={ character=10 }
council_task_manager={ active={
 500={ type="task_collect_taxes" owner=30 court_owner=10 }
}}
living={
 10={ first_name="Player" landed_data={ council={ 500 } } }
 20={ first_name="Maciej" birth=880.1.1 skill={ 2 3 8 4 6 2 } landed_data={ strength_for_liege=40 is_powerful_vassal=yes vassal_power_value=120 } }
 30={ first_name="Other" birth=870.1.1 skill={ 4 4 5 4 4 4 } landed_data={ strength_for_liege=30 is_powerful_vassal=yes vassal_power_value=100 } }
}
vassal_contracts={ active={
 1={ liege=10 vassal=20 }
 2={ liege=10 vassal=30 }
}}
`);

test("powerful vassals use character council membership rather than council task IDs", async () => {
  const result = await queryGamestate(GS, (q) =>
    extractVassals(q, new Localizer(null), new Set()),
  );
  const maciej = result.vassals.find((vassal) => vassal.id === 20);
  const other = result.vassals.find((vassal) => vassal.id === 30);

  expect(maciej).toMatchObject({
    name: "Maciej",
    powerfulVassal: true,
    powerfulVassalWithoutCouncilSeat: true,
    councilSeat: false,
    vassalPowerValue: 120,
    skills: { stewardship: 8 },
  });
  expect(other).toMatchObject({
    powerfulVassal: true,
    powerfulVassalWithoutCouncilSeat: false,
    councilSeat: true,
  });
});
