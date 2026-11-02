import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { queryGamestate } from "../src/parser.js";
import { extractCharacter } from "../src/extract/characters.js";
import { Localizer } from "../src/localization.js";

const GAME_DIR = fileURLToPath(new URL("./fixtures/gamedir", import.meta.url));
const UNSUPPORTED = "[Select_CString( ROOT.GetCharacter.IsAI, 'AI', 'gracz' )]";

const GS = Buffer.from(`date=867.1.1
traits_lookup={ "conditional_hunter" "unsupported_conditional" }
living={
1={
  first_name="Mieszko"
  traits={ 0 1 }
  skill={ 1 1 1 1 1 1 }
}
2={
  first_name="Mila"
  female=yes
  traits={ 0 }
  skill={ 1 1 1 1 1 1 }
}
}
`);

test("safe IsFemale Select_CString expressions resolve for both sexes", () => {
  const loc = new Localizer(GAME_DIR);

  expect(loc.resolveForCharacter("conditional_warrior", false)).toEqual({
    value: "Wytrzymały wojownik",
    raw: "Wytrzymał[Select_CString( ROOT.GetCharacter.IsFemale, 'a', 'y' )] wojownik",
    localizationUnresolved: false,
  });
  expect(loc.resolveForCharacter("conditional_warrior", true).value).toBe(
    "Wytrzymała wojownik",
  );
  expect(loc.resolveForCharacter("conditional_herbalist", false).value).toBe("Zielarz");
  expect(loc.resolveForCharacter("conditional_herbalist", true).value).toBe("Zielarka");
  expect(loc.resolveForCharacter("conditional_hunter", false).value).toBe("Łowca");
  expect(loc.resolveForCharacter("conditional_hunter", true).value).toBe("Łowczyni");
});

test("unsupported scripted localization remains raw and is marked unresolved", () => {
  const loc = new Localizer(GAME_DIR);
  expect(loc.resolveForCharacter("unsupported_conditional", false)).toEqual({
    value: UNSUPPORTED,
    raw: UNSUPPORTED,
    localizationUnresolved: true,
  });
});

test("extractCharacter applies sex context and exports localization diagnostics", async () => {
  const loc = new Localizer(GAME_DIR);
  const [male, female] = await queryGamestate(GS, (q) => [
    extractCharacter(q, loc, 1),
    extractCharacter(q, loc, 2),
  ]);

  expect(male?.traits).toEqual(["Łowca", UNSUPPORTED]);
  expect(female?.traits).toEqual(["Łowczyni"]);

  expect(male?.traitLocalizationDiagnostics).toEqual([
    {
      traitIndex: 0,
      localizationKey: "conditional_hunter",
      raw: "[Select_CString( ROOT.GetCharacter.IsFemale, 'Łowczyni', 'Łowca' )]",
      resolved: "Łowca",
      localizationUnresolved: false,
    },
    {
      traitIndex: 1,
      localizationKey: "unsupported_conditional",
      raw: UNSUPPORTED,
      resolved: UNSUPPORTED,
      localizationUnresolved: true,
    },
  ]);
  expect(female?.traitLocalizationDiagnostics).toEqual([
    {
      traitIndex: 0,
      localizationKey: "conditional_hunter",
      raw: "[Select_CString( ROOT.GetCharacter.IsFemale, 'Łowczyni', 'Łowca' )]",
      resolved: "Łowczyni",
      localizationUnresolved: false,
    },
  ]);
});
