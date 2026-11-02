import { expect, test } from "vitest";
import { extractCharacter } from "../src/extract/characters.js";
import {
  attachRulerHealthSemantics,
  healthSemantics,
  HEALTH_LIMITATION,
} from "../src/health.js";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";

const BEFORE = Buffer.from(`date=879.11.17
traits_lookup={ "heart_failure" }
living={
1={
  first_name="Siemowit"
  skill={ 1 1 1 1 1 1 }
  alive_data={ health=3.1352 }
}
}
`);

const AFTER = Buffer.from(`date=879.11.18
traits_lookup={ "heart_failure" }
living={
1={
  first_name="Siemowit"
  traits={ 0 }
  skill={ 1 1 1 1 1 1 }
  alive_data={ health=3.1352 }
}
}
`);

test("health-affecting trait changes do not make the unchanged save scalar effective health", async () => {
  const loc = new Localizer(null);
  const before = await queryGamestate(BEFORE, (q) => extractCharacter(q, loc, 1));
  const after = await queryGamestate(AFTER, (q) => extractCharacter(q, loc, 1));

  expect(before?.health).toBe(3.1352);
  expect(after?.health).toBe(3.1352);
  expect(before?.traits).toEqual([]);
  expect(after?.traits).toEqual(["heart_failure"]);

  const semantics = healthSemantics(after?.health ?? null);
  expect(semantics).toEqual({
    rawSaveValue: 3.1352,
    effectiveValue: null,
    effectiveAvailable: false,
    source: "living.alive_data.health",
    scope: "serialized_scalar_not_ui_equivalent",
    modifierBreakdownAvailable: false,
    limitation: HEALTH_LIMITATION,
  });
});

test("export attachment adds machine-readable ruler health semantics", async () => {
  const loc = new Localizer(null);
  const ruler = await queryGamestate(AFTER, (q) => extractCharacter(q, loc, 1));
  const exported = attachRulerHealthSemantics({ ruler });

  expect(exported.rulerHealth.rawSaveValue).toBe(3.1352);
  expect(exported.rulerHealth.effectiveValue).toBeNull();
  expect(exported.rulerHealth.effectiveAvailable).toBe(false);
  expect(exported.rulerHealth.modifierBreakdownAvailable).toBe(false);
  expect(exported.rulerHealth.scope).toBe("serialized_scalar_not_ui_equivalent");
  expect(exported.rulerHealth.limitation).toBe(HEALTH_LIMITATION);
});
