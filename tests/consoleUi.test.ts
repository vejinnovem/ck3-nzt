import { expect, test } from "vitest";
import {
  formatProgress,
  highlightGameDate,
  highlightSaveFilename,
  shouldUseColor,
} from "../src/consoleUi.js";

test("game dates and save filename dates are blue when colors are enabled", () => {
  expect(highlightGameDate("886.5.15", true)).toBe("\u001b[94m886.5.15\u001b[0m");
  expect(highlightSaveFilename("Krol_Siemowit_(Polska)_886_05_15.ck3", true)).toContain(
    "\u001b[94m886_05_15\u001b[0m",
  );
});

test("progress formatting degrades to plain text", () => {
  expect(formatProgress("886.5.15", "Export complete.", "success", false)).toBe(
    "886.5.15  Export complete.",
  );
});

test("NO_COLOR disables output colors", () => {
  expect(shouldUseColor({ NO_COLOR: "1" }, true)).toBe(false);
  expect(shouldUseColor({ FORCE_COLOR: "1" }, false)).toBe(true);
});
