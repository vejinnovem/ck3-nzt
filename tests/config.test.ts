import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveConfig } from "../src/config.js";

test("env vars take precedence", () => {
  const cfg = resolveConfig({ CK3_SAVE_DIR: "/saves", CK3_GAME_DIR: "/game" });
  expect(cfg).toEqual({ saveDir: "/saves", gameDir: "/game" });
});

test("missing env yields nulls", () => {
  expect(resolveConfig({})).toEqual({ saveDir: null, gameDir: null });
});

test("loads persistent local config and keeps env overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-nzt-config-"));
  const path = join(dir, "config.json");
  try {
    writeFileSync(path, '\uFEFF{"saveDir":"D:/CK3/saves","gameDir":"E:/CK3/game"}', "utf8");

    expect(resolveConfig({ CK3_NZT_CONFIG_FILE: path })).toEqual({
      saveDir: "D:/CK3/saves",
      gameDir: "E:/CK3/game",
    });

    expect(resolveConfig({ CK3_NZT_CONFIG_FILE: path, CK3_SAVE_DIR: "F:/override" })).toEqual({
      saveDir: "F:/override",
      gameDir: "E:/CK3/game",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accepts CK3 install root and normalizes it to the game directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-nzt-game-root-"));
  const gameDir = join(dir, "game");
  const configPath = join(dir, "config.json");
  try {
    mkdirSync(join(gameDir, "localization"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ saveDir: "D:/saves", gameDir: dir }), "utf8");

    expect(resolveConfig({ CK3_NZT_CONFIG_FILE: configPath })).toEqual({
      saveDir: "D:/saves",
      gameDir,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
