import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface AdvisorConfig {
  saveDir: string | null;
  gameDir: string | null;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AdvisorConfig {
  return {
    saveDir: env.CK3_SAVE_DIR ?? null,
    gameDir: env.CK3_GAME_DIR ?? null,
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
