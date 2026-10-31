import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractCouncil } from "../src/extract/council.js";
import { Localizer } from "../src/localization.js";

const GS = Buffer.from(`date=867.1.1
played_character={ character=10 player=1 }
traits_lookup={ "diligent" }
council_task_manager={
 active={
  100={ type="task_manage_domain" owner=11 court_owner=10 }
 }
}
living={
 10={ first_name="Ruler" birth=830.1.1 landed_data={ council={ 11 12 } } }
 11={
  first_name="Steward"
  birth=835.1.1
  traits={ 0 }
  skill={ 4 3 15 4 5 2 }
  court_data={ employer=10 council_task=100 }
 }
 12={
  first_name="Marshal"
  birth=836.1.1
  skill={ 3 14 5 4 3 8 }
  court_data={ employer=10 }
 }
 13={
  first_name="Diplomat"
  birth=837.1.1
  skill={ 17 4 4 4 5 2 }
  court_data={ employer=10 }
 }
 14={
  first_name="Child"
  birth=860.1.1
  skill={ 20 20 20 20 20 20 }
  court_data={ employer=10 }
 }
 15={
  first_name="Foreigner"
  birth=830.1.1
  skill={ 30 30 30 30 30 30 }
  court_data={ employer=99 }
 }
}
`);

test("extractCouncil returns councillors, active tasks and adult court candidates", async () => {
  const council = await queryGamestate(GS, (q) => extractCouncil(q, new Localizer(null)));
  expect(council.memberIds).toEqual([11, 12]);
  expect(council.members.map((member) => member.name)).toEqual(["Steward", "Marshal"]);
  expect(council.members[0]?.activeTask).toEqual({
    id: 100,
    type: "task_manage_domain",
    ownerId: 11,
    courtOwnerId: 10,
  });
  expect(council.courtSize).toBe(4);
  expect(council.candidates.map((candidate) => candidate.name)).toEqual([
    "Diplomat",
    "Steward",
    "Marshal",
  ]);
  expect(council.candidates.find((candidate) => candidate.name === "Steward")?.isCouncillor).toBe(
    true,
  );
});
