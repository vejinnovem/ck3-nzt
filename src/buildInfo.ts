import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  appVersion: string;
  gitCommit: string | null;
  gitShortCommit: string | null;
  gitBranch: string | null;
  gitDirty: boolean | null;
  buildId: string;
}

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function command(projectDir: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function packageVersion(projectDir: string): string {
  try {
    const raw = readFileSync(resolve(projectDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function getBuildInfo(projectDir = PROJECT_DIR): BuildInfo {
  const appVersion = packageVersion(projectDir);
  const gitCommit = command(projectDir, ["rev-parse", "HEAD"]);
  const gitShortCommit = gitCommit?.slice(0, 12) ?? null;
  const gitBranch = command(projectDir, ["branch", "--show-current"]) || null;
  const status = command(projectDir, ["status", "--porcelain"]);
  const gitDirty = status === null ? null : status.length > 0;
  const buildId = gitShortCommit ? `${appVersion}+${gitShortCommit}` : appVersion;

  return {
    appVersion,
    gitCommit,
    gitShortCommit,
    gitBranch,
    gitDirty,
    buildId,
  };
}
