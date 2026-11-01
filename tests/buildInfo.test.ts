import { expect, test } from "vitest";
import { getBuildInfo } from "../src/buildInfo.js";

test("build info exposes package version and a stable build id", () => {
  const info = getBuildInfo();
  expect(info.appVersion).toMatch(/^\d+\.\d+\.\d+|unknown$/);
  expect(info.buildId.length).toBeGreaterThan(0);
  if (info.gitCommit !== null) {
    expect(info.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(info.gitShortCommit).toBe(info.gitCommit.slice(0, 12));
    expect(info.buildId).toContain(info.gitShortCommit);
  }
});
