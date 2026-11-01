import { expect, test } from "vitest";
import { extractGameInfo } from "../src/extract/game.js";
import type { Query } from "../src/parser.js";

function query(values: Record<string, unknown>): Query {
  return {
    at(path: string): unknown {
      return values[path];
    },
    root(): unknown {
      return values;
    },
  };
}

test("extractGameInfo reads root achievement and ironman flags", () => {
  expect(
    extractGameInfo(
      query({
        "/can_get_achievements": "yes",
        "/ironman": "no",
      }),
    ),
  ).toEqual({ achievementsEligible: true, ironman: false });
});

test("extractGameInfo falls back to metadata flags", () => {
  expect(
    extractGameInfo(
      query({
        "/meta_data/can_get_achievements": true,
        "/meta_data/ironman": false,
      }),
    ),
  ).toEqual({ achievementsEligible: true, ironman: false });
});

test("extractGameInfo reports unknown when flags are absent", () => {
  expect(extractGameInfo(query({}))).toEqual({ achievementsEligible: null, ironman: null });
});
