import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractCouncil } from "../src/extract/council.js";
import { Localizer } from "../src/localization.js";

const GS = Buffer.from(`date=867.1.1
played_character={ character=10 player=1 }
traits_lookup={ "diligent" }
landed_titles={ landed_titles={
 200={ key="c_opole" name="Opole" holder=10 }
}}
county_manager={ counties={ c_opole={ county_control=0 culture=1 } } }
council_task_manager={
 active={
  100={ type="task_manage_domain" owner=11 court_owner=10 }
  101={ type="task_train_commanders" owner=12 court_owner=10 }
 }
}
living={
 10={ first_name="Ruler" birth=830.1.1 landed_data={ council={ 100 101 } } }
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
  court_data={ employer=10 council_task=101 }
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
 16={
  first_name="Guest"
  birth=840.1.1
  skill={ 6 6 6 6 6 6 }
  court_data={ host=10 }
 }
}
`);

test("extractCouncil resolves landed council task IDs to councillor characters", async () => {
  const council = await queryGamestate(GS, (q) => extractCouncil(q, new Localizer(null)));
  expect(council.taskIds).toEqual([100, 101]);
  expect(council.memberIds).toEqual([11, 12]);
  expect(council.members.map((member) => member.name)).toEqual(["Steward", "Marshal"]);
  expect(council.members[0]?.activeTask).toMatchObject({
    id: 100,
    type: "task_manage_domain",
    ownerId: 11,
    courtOwnerId: 10,
    office: "steward",
  });
  expect(council.members[1]?.activeTask?.type).toBe("task_train_commanders");
  expect(council.members[1]?.activeTask?.office).toBe("marshal");
  expect(council.courtSize).toBe(5);
  expect(council.courtierCount).toBe(4);
  expect(council.guestCount).toBe(1);
  expect(council.offices).toEqual([
    { office: "chancellor", vacant: true, memberId: null, taskId: null, taskType: null },
    { office: "steward", vacant: false, memberId: 11, taskId: 100, taskType: "task_manage_domain" },
    { office: "marshal", vacant: false, memberId: 12, taskId: 101, taskType: "task_train_commanders" },
    { office: "spymaster", vacant: true, memberId: null, taskId: null, taskType: null },
    { office: "court_chaplain", vacant: true, memberId: null, taskId: null, taskType: null },
  ]);
  expect(council.candidates.map((candidate) => candidate.name)).toEqual([
    "Diplomat",
    "Steward",
    "Marshal",
    "Guest",
  ]);
  expect(council.candidates.find((candidate) => candidate.name === "Steward")?.isCouncillor).toBe(
    true,
  );
  expect(council.candidates.find((candidate) => candidate.name === "Steward")?.courtStatus).toBe(
    "courtier",
  );
  expect(council.candidates.find((candidate) => candidate.name === "Guest")?.courtStatus).toBe(
    "guest",
  );
  expect(council.candidates.find((candidate) => candidate.name === "Guest")?.councilEligibility).toBe(
    "unknown",
  );
});

test("extractCouncil preserves the target county of a targeted task", async () => {
  const gamestate = Buffer.from(`
date=877.2.16
played_character={ character=10 }
landed_titles={ landed_titles={
 200={ key="c_opole" name="Opole" holder=20 }
}}
county_manager={ counties={ c_opole={ county_control=0 culture=1 } } }
council_task_manager={ active={
 500={ type="task_increase_control" owner=12 court_owner=10 target=200 }
}}
living={
 10={ first_name="Siemowit" culture=1 landed_data={ council={ 500 } } }
 12={ first_name="Rodislav" skill={ 1 14 1 1 1 10 } court_data={ employer=10 council_task=500 } }
 20={ first_name="Niemir" }
}
`);

  const council = await queryGamestate(gamestate, (q) => extractCouncil(q, new Localizer(null)));
  expect(council.members[0]?.activeTask).toMatchObject({
    type: "task_increase_control",
    targetTitleId: 200,
    targetTitle: "Opole",
    targetCounty: {
      titleId: 200,
      name: "Opole",
      holderId: 20,
      control: 0,
    },
  });
});

test("extractCouncil recovers a county target by reversing county council_tasks", async () => {
  const gamestate = Buffer.from(`
date=877.3.10
played_character={ character=10 }
landed_titles={ landed_titles={
 200={ key="c_opole" name="Opole" holder=20 }
}}
county_manager={ counties={
 c_opole={ county_control=5.9 culture=1 council_tasks={ 500 } }
}}
council_task_manager={ active={
 500={ type="task_increase_control" owner=12 court_owner=10 target={ opaque_scope=999 } }
}}
living={
 10={ first_name="Siemowit" culture=1 landed_data={ council={ 500 } } }
 12={ first_name="Rodislav" skill={ 1 14 1 1 1 10 } court_data={ employer=10 council_task=500 } }
 20={ first_name="Niemir" }
}
`);

  const council = await queryGamestate(gamestate, (q) => extractCouncil(q, new Localizer(null)));
  expect(council.members[0]?.activeTask).toMatchObject({
    type: "task_increase_control",
    targetTitleId: 200,
    targetTitle: "Opole",
    targetCounty: {
      titleId: 200,
      name: "Opole",
      control: 5.9,
    },
  });
  expect(council.members[0]?.activeTask?.diagnostics).toBeUndefined();
});
