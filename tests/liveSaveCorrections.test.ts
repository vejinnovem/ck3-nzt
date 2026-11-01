import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractMilitary } from "../src/extract/military.js";
import { extractOperationalArmies } from "../src/extract/operationalArmies.js";
import {
  correctMilitaryLiveFields,
  correctOperationalArmiesLiveFields,
} from "../src/extract/liveSaveCorrections.js";

const GS = Buffer.from(`
date=869.8.10
played_character={ character=13015 player=1 }
living={
13015={ first_name="Siemowit" playable_data={ knights={ 23620 18664 } } landed_data={ levy=1052 strength=1555 current_strength=1504 strength_without_hires=1555 } }
15503={ first_name="Gardomir" skill={ 8 10 5 4 4 7 } }
14491={ first_name="Wratislaw" skill={ 5 9 4 3 3 7 } }
18664={ first_name="Rodislav" skill={ 11 14 10 8 8 13 } }
}
landed_titles={ landed_titles={
3292={ key="b_poznan" name="Poznań" province=4900 }
3298={ key="b_gniezno" name="Gniezno" province=4905 }
3311={ key="b_znin" name="Żnin" province=4910 }
} }
armies={
regiments={
16411={ type="light_footmen" owner=13015 origin=4905 max=300 chunks={ { max=300 } } }
16412={ type="bowmen" owner=13015 origin=4900 max=200 chunks={ { max=200 } } }
2001={ owner=13015 }
3001={ owner=15503 }
4001={ owner=14491 }
}
army_regiments={
33554450={ type="light_footmen" army=33554432 cached={ current=271 max=300 } chunks={ { regiment=16411 } } }
33554451={ type="bowmen" army=33554432 cached={ current=179 max=200 } chunks={ { regiment=16412 } } }
33554447={ army=33554432 cached={ current=1052 max=1052 } chunks={ { regiment=2001 } } }
33554684={ army=33554684 cached={ current=1378 max=1421 } chunks={ { regiment=3001 } } }
50331929={ army=50331929 cached={ current=158 max=639 } chunks={ { regiment=4001 } } }
}
armies={
33554432={ commander=18664 unit=33554437 supply=100 name={ province=4900 } }
33554684={ commander=15503 unit=33554693 supply=95 name={ province=3045 } }
50331929={ commander=14491 unit=16777300 supply=100 name={ province=4916 } }
}
}
units={
33554437={ province=4900 movement={ destination=4905 path={ 4905 } } combat=77 }
33554693={ province=4910 }
16777300={ province=4905 movement={ destination=4900 path={ 4900 } } }
}
wars={ active_wars={
71={
attacker={ participants={ { character=13015 } { character=15503 } } }
defender={ participants={ { character=14491 } } }
casus_belli={ type="county_conquest_cb" targeted_titles={ 3310 } }
start_date=869.1.17
}
} }
`);

test("uses cached current MAA soldiers from live saves", async () => {
  const result = await queryGamestate(GS, (q) =>
    correctMilitaryLiveFields(q, extractMilitary(q, new Localizer(null))),
  );

  expect(result.menAtArms.slotsUsed).toBe(2);
  expect(result.menAtArms.regiments.map((r) => r.current)).toEqual([271, 179]);
  expect(result.menAtArms.totalCurrentSoldiers).toBe(450);
  expect(result.menAtArms.totalMaxSoldiers).toBe(500);
  expect(result.unattributedCurrentStrength).toBe(0);
});

test("follows army.unit for live position, movement, combat and war ids", async () => {
  const result = await queryGamestate(GS, (q) =>
    correctOperationalArmiesLiveFields(
      q,
      new Localizer(null),
      extractOperationalArmies(q, new Localizer(null)),
    ),
  );

  const player = result.armies.find((army) => army.id === 33554432);
  expect(player?.locationProvinceId).toBe(4900);
  expect(player?.locationName).toBe("Poznań");
  expect(player?.destinationProvinceId).toBe(4905);
  expect(player?.destinationName).toBe("Gniezno");
  expect(player?.movementPathProvinceIds).toEqual([4905]);
  expect(player?.movementPathNames).toEqual(["Gniezno"]);
  expect(player?.combatId).toBe(77);
  expect(player?.warIds).toEqual([71]);
  expect(player?.moving).toBe(true);

  const ally = result.armies.find((army) => army.id === 33554684);
  expect(ally?.locationName).toBe("Żnin");
  expect(ally?.warIds).toEqual([71]);

  const hostile = result.armies.find((army) => army.id === 50331929);
  expect(hostile?.locationName).toBe("Gniezno");
  expect(hostile?.destinationName).toBe("Poznań");
  expect(hostile?.warIds).toEqual([71]);
});

test("does not expose a conflicting single-player army aggregate as an exact stack size", async () => {
  const inconsistent = Buffer.from(
    GS.toString()
      .replace("current_strength=1504", "current_strength=2155")
      .replace(
        "33554447={ army=33554432 cached={ current=1052 max=1052 }",
        "33554447={ army=33554432 cached={ current=737 max=737 }",
      ),
  );

  const result = await queryGamestate(inconsistent, (q) =>
    correctOperationalArmiesLiveFields(
      q,
      new Localizer(null),
      extractOperationalArmies(q, new Localizer(null)),
    ),
  );

  const player = result.armies.find((army) => army.id === 33554432);
  expect(player?.currentSoldiers).toBeNull();
  expect(player?.maxSoldiers).toBeNull();
  expect(player?.diagnostics?.["soldierCount.regimentAggregateEstimate"]).toBe(1187);
  expect(player?.diagnostics?.["soldierCount.ownerCurrentStrength"]).toBe(2155);
  expect(player?.diagnostics?.["soldierCount.reliable"]).toBe(false);
});
