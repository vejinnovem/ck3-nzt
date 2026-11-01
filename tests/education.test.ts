import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractEducation } from "../src/extract/education.js";

const GS = Buffer.from(`
date=877.2.16
played_character={ character=10 }
living={
 10={ first_name="Siemowit" family_data={ child={ 11 } } landed_data={ succession={ 12 11 } } }
 11={ first_name="Child" birth=868.2.3 skill={ 1 1 1 1 1 1 } alive_data={ focus={ type="education_learning" date=874.2.4 changes=0 progress=0 } } }
 12={ first_name="Dobromir" birth=868.3.27 skill={ 3 2 2 5 2 2 } alive_data={ focus={ type="education_martial" date=874.3.28 changes=0 progress=0 } } }
 20={ first_name="Guardian" birth=840.1.1 skill={ 5 15 5 5 10 5 } }
}
opinions={ active_opinions={
 { owner=12 target=20 scripted_relations={ guardian={ involved_character=20 } } }
}}
`);

test("extractEducation reports succession minors and recovered guardians", async () => {
  const education = await queryGamestate(GS, (q) => extractEducation(q, new Localizer(null)));
  expect(education.children).toHaveLength(2);
  expect(education.children[0]).toMatchObject({
    id: 12,
    name: "Dobromir",
    age: 8,
    successionPosition: 1,
    focus: { type: "education_martial" },
    guardianIds: [20],
    guardianNames: ["Guardian"],
    guardianStatus: "present",
  });
  expect(education.children.find((child) => child.id === 11)).toMatchObject({
    guardianStatus: "not_found",
  });
  expect(education.childrenWithoutGuardian).toBe(1);
});
