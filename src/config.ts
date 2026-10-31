import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface AdvisorConfig {
  saveDir: string | null;
  gameDir: string | null;
}

function configFilePath(env: NodeJS.ProcessEnv): string | null {
  if (env.CK3_NZT_CONFIG_FILE) return env.CK3_NZT_CONFIG_FILE;
  if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "CK3-NZT", "config.json");
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "ck3-nzt", "config.json");
  if (env.HOME) return join(env.HOME, ".config", "ck3-nzt", "config.json");
  return null;
}

function loadLocalConfig(env: NodeJS.ProcessEnv): Partial<AdvisorConfig> {
  const path = configFilePath(env);
  if (!path) return {};

  try {
    // Windows PowerShell 5.1 writes UTF-8 with a BOM by default.
    const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      saveDir: typeof parsed.saveDir === "string" && parsed.saveDir ? parsed.saveDir : null,
      gameDir: typeof parsed.gameDir === "string" && parsed.gameDir ? parsed.gameDir : null,
    };
  } catch {
    return {};
  }
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AdvisorConfig {
  const local = loadLocalConfig(env);
  return {
    saveDir: env.CK3_SAVE_DIR ?? local.saveDir ?? null,
    gameDir: env.CK3_GAME_DIR ?? local.gameDir ?? null,
  };
}

const SAVE_TAIL = ["Documents", "Paradox Interactive", "Crusader Kings III", "save games"];

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function discoverSaveDir(): Promise<string | null> {
  const candidates: string[] = [];

  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE;
    const oneDrive = process.env.OneDrive;
    if (userProfile) candidates.push(join(userProfile, ...SAVE_TAIL));
    if (oneDrive) candidates.push(join(oneDrive, ...SAVE_TAIL));
  }

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return candidate;
  }

  // WSL fallback used by the original advisor.
  const usersRoot = "/mnt/c/Users";
  let users: string[];
  try {
    users = await readdir(usersRoot);
  } catch {
    return null;
  }

  for (const user of users) {
    const candidate = join(usersRoot, user, ...SAVE_TAIL);
    if (await isDirectory(candidate)) return candidate;
  }

  return null;
}

export async function discoverGameDir(): Promise<string | null> {
  const candidates: string[] = [];

  if (process.platform === "win32") {
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    const programFiles = process.env.ProgramFiles;
    if (programFilesX86) {
      candidates.push(
        join(
          programFilesX86,
          "Steam",
          "steamapps",
          "common",
          "Crusader Kings III",
          "game",
        ),
      );
    }
    if (programFiles) {
      candidates.push(
        join(programFiles, "Steam", "steamapps", "common", "Crusader Kings III", "game"),
      );
    }
  }

  candidates.push("/mnt/c/Program Files (x86)/Steam/steamapps/common/Crusader Kings III/game");

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return candidate;
  }

  return null;
}
