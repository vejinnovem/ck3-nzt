import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import {
  collectConfederationCoMemberIds,
  findCharacterConfederations,
} from "../src/extract/confederations.js";

const GS = Buffer.from(`
confederation_manager={
  database={
    12={
      name="Konfederacja Polska"
      members={ 16042 15701 15730 14405 15316 }
    }
    13=none
  }
}
`);

test("extracts character confederation members from confederation_manager", async () => {
  const result = await queryGamestate(GS, (q) => ({
    confederations: findCharacterConfederations(q, 16042),
    coMembers: collectConfederationCoMemberIds(q, 16042),
  }));

  expect(result.confederations).toEqual([
    {
      id: 12,
      name: "Konfederacja Polska",
      memberIds: [16042, 15701, 15730, 14405, 15316],
    },
  ]);
  expect(result.coMembers).toEqual([15701, 15730, 14405, 15316]);
});
