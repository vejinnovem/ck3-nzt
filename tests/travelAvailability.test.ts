import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractCouncil } from "../src/extract/council.js";
import { Localizer } from "../src/localization.js";

const GS = Buffer.from(`
date=877.5.6
played_character={ character=10 }
travel_plans={
 500={ owner=30 entourage={ 12 31 } destination=9000 }
 501={ destination=13 }
}
living={
 10={ first_name="Siemowit" landed_data={ council={} } }
 12={ first_name="Rodislav" birth=836.1.1 skill={ 11 14 10 8 8 13 } court_data={ employer=10 } }
 13={ first_name="Collision" birth=836.1.1 skill={ 5 5 5 5 5 5 } court_data={ employer=10 } }
 14={ first_name="Commander" birth=836.1.1 skill={ 5 5 5 5 5 5 } court_data={ employer=10 army=700 } }
}
`);

test("extractCouncil identifies travelling courtiers without trusting numeric id collisions", async () => {
  const council = await queryGamestate(GS, (q) => extractCouncil(q, new Localizer(null)));

  const rodislav = council.candidates.find((candidate) => candidate.id === 12);
  expect(rodislav?.availability).toMatchObject({
    presenceStatus: "travelling",
    councilAvailability: "likely_unavailable_travelling",
    travelling: true,
    travelPlanIds: ["500"],
    travelRoles: ["entourage"],
  });
  expect(rodislav?.availability.travelReferences[0]?.path).toContain("/travel_plans/500/entourage");

  const collision = council.candidates.find((candidate) => candidate.id === 13);
  expect(collision?.availability.travelling).toBe(false);
  expect(collision?.availability.presenceStatus).toBe("at_player_court");
  expect(collision?.availability.unclassifiedTravelReferencePaths).toContain(
    "/travel_plans/501/destination",
  );

  const commander = council.candidates.find((candidate) => candidate.id === 14);
  expect(commander?.availability).toMatchObject({
    presenceStatus: "in_army",
    councilAvailability: "likely_unavailable_in_army",
    armyId: 700,
  });
});
