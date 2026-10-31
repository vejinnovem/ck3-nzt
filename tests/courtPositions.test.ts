import { expect, test } from "vitest";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractCourtPositions } from "../src/extract/courtPositions.js";

const GS = Buffer.from(`
date=867.3.1
played_character={ character=13015 player=1 }
living={
13015={ first_name="Siemowit" skill={ 6 6 6 4 3 1 } }
222={ first_name="Dobromir" birth=840.1.1 skill={ 4 3 2 1 12 0 } }
333={ first_name="Obcy" birth=838.1.1 skill={ 5 5 5 5 5 5 } }
}
court_positions={
7={
  court_position="court_physician_court_position"
  employee=222
  employer=13015
}
8={
  court_position="bodyguard_court_position"
  employee=333
  employer=99999
}
}
`);

test("extracts only court positions employed by the player", async () => {
  const positions = await queryGamestate(GS, (q) =>
    extractCourtPositions(q, new Localizer(null)),
  );

  expect(positions.source).toBe("court_positions_save");
  expect(positions.filledCount).toBe(1);
  expect(positions.filled).toEqual([
    {
      type: "court_physician_court_position",
      employeeId: 222,
      employeeName: "Dobromir",
      employeeAge: 27,
      employerId: 13015,
    },
  ]);
  expect(positions.vacanciesAvailable).toBe(false);
  expect(positions.candidateCompetencyAvailable).toBe(false);
  expect(positions.salaryAvailable).toBe(false);
});
