import { queryGamestate } from "./parser.js";
import type { Snapshot } from "./snapshot.js";
import {
  extractLifestyleAdvisory,
  type LifestyleAdvisoryInfo,
} from "./extract/lifestyle.js";

export async function attachLifestyleAdvisoryContext<T extends Snapshot>(
  snapshot: T,
  gamestate: Buffer,
): Promise<T & { lifestyleAdvisory: LifestyleAdvisoryInfo }> {
  const lifestyleAdvisory = await queryGamestate(gamestate, (q) => {
    const playerId = q.at("/played_character/character");
    if (typeof playerId !== "number") {
      throw new Error("CK3 save does not contain a numeric played_character/character id");
    }
    return extractLifestyleAdvisory(q, playerId);
  });

  return Object.assign(snapshot, { lifestyleAdvisory });
}
