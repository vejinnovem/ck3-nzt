import { expect, test } from "vitest";
import { SaveStabilityTracker } from "../src/watcher.js";

test("save watcher waits for a stable file before processing", () => {
  const tracker = new SaveStabilityTracker(2);

  expect(tracker.observe("save-a:1:100")).toBe("wait");
  expect(tracker.observe("save-a:1:100")).toBe("process");

  tracker.markProcessed("save-a:1:100");
  expect(tracker.observe("save-a:1:100")).toBe("processed");
});

test("save watcher resets stability when the file changes", () => {
  const tracker = new SaveStabilityTracker(2);

  expect(tracker.observe("save-a:1:100")).toBe("wait");
  expect(tracker.observe("save-a:2:120")).toBe("wait");
  expect(tracker.observe("save-a:2:120")).toBe("process");
});
