import { expect, test, vi } from "vitest";
import {
  MAIN_UPDATE_FETCH_ARGS,
  SaveStabilityTracker,
  checkForSelfUpdate,
} from "../src/watcher.js";

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

test("self-update explicitly refreshes origin/main and restarts when clean main is behind", async () => {
  const projectDir = "C:\\CK3-NZT\\app";
  const localHead = "1111111111111111111111111111111111111111";
  const remoteHead = "2222222222222222222222222222222222222222";
  const commandOutput = vi.fn(async (_command: string, args: string[]): Promise<string> => {
    const key = args.join(" ");
    if (key === "branch --show-current") return "main";
    if (key === "status --porcelain") return "";
    if (key === MAIN_UPDATE_FETCH_ARGS.join(" ")) return "";
    if (key === "rev-parse HEAD") return localHead;
    if (key === "rev-parse origin/main") return remoteHead;
    if (key === "rev-list --left-right --count HEAD...origin/main") return "0 1";
    throw new Error(`Unexpected git command: ${key}`);
  });
  const runUpdateSetup = vi.fn(async (): Promise<void> => undefined);

  await expect(
    checkForSelfUpdate(projectDir, { commandOutput, runUpdateSetup }),
  ).resolves.toBe("restart");

  expect(commandOutput).toHaveBeenCalledWith("git", [...MAIN_UPDATE_FETCH_ARGS], projectDir);
  expect(runUpdateSetup).toHaveBeenCalledTimes(1);
  expect(runUpdateSetup).toHaveBeenCalledWith(projectDir);
});
