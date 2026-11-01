import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { Localizer } from "../src/localization.js";

const GAME_DIR = fileURLToPath(new URL("./fixtures/gamedir", import.meta.url));

test("resolve() prefers Polish localization and falls back to English", () => {
  const loc = new Localizer(GAME_DIR);
  expect(loc.resolve("k_bohemia")).toBe("Czechy");
  expect(loc.resolve("e_hispania")).toBe("Empire of Hispania");
});

test("preferred language can be overridden explicitly", () => {
  const loc = new Localizer(GAME_DIR, "english");
  expect(loc.resolve("k_bohemia")).toBe("Bohemia");
});

test("resolve() falls back to the raw key when missing", () => {
  const loc = new Localizer(GAME_DIR);
  expect(loc.resolve("k_does_not_exist")).toBe("k_does_not_exist");
});

test("a null game dir yields an empty localizer that echoes keys", () => {
  const loc = new Localizer(null);
  expect(loc.resolve("k_bohemia")).toBe("k_bohemia");
  expect(loc.provinceForBarony("b_alpha")).toBeNull();
});

test("resolveTrait() supports direct and trait_-prefixed localization keys", () => {
  const loc = new Localizer(GAME_DIR);
  loc.setTraitLookup(["just", "diligent"]);
  expect(loc.resolveTrait(0)).toBe("Sprawiedliwy");
  expect(loc.resolveTrait(1)).toBe("Diligent");
  expect(loc.resolveTrait(99)).toBe("trait_99");
});

test("provinceForBarony() reads province IDs from static landed-title files", () => {
  const loc = new Localizer(GAME_DIR);
  expect(loc.provinceForBarony("b_alpha")).toBe(101);
  expect(loc.provinceForBarony("b_beta")).toBe(102);
  expect(loc.provinceForBarony("b_missing")).toBeNull();
});
