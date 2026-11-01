import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractOperationalArmies } from "../src/extract/operationalArmies.js";

const GS = Buffer.from(`
date=869.5.28
played_character={ character=13015 player=1 }
living={
13015={ first_name="Siemowit" skill={ 6 6 6 4 3 1 } }
15503={ first_name="Gardomir" skill={ 8 12 5 4 4 8 } }
14491={ first_name="Wratislaw" skill={ 5 9 4 3 3 7 } }
16414={ first_name="Jaromil" skill={ 4 10 5 4 4 6 } }
18664={ first_name="Rodislav" skill={ 11 25 10 8 8 13 } }
}
landed_titles={ landed_titles={
3292={ key="b_poznan" name="Poznań" }
3298={ key="b_gniezno" name="Gniezno" }
3311={ key="b_znin" name="Żnin" }
} }
provinces={
4900={ title=3292 }
4905={ title=3298 }
4910={ title=3311 }
}
armies={
regiments={
1001={ owner=13015 }
1002={ owner=14491 }
1003={ owner=16414 }
1004={ owner=15503 }
}
army_regiments={
5001={ army=700 cached={ current=1931 max=1939 } chunks={ { regiment=1001 } } }
5002={ army=800 cached={ current=153 max=639 } chunks={ { regiment=1002 } } }
5003={ army=801 cached={ current=2100 max=2150 } chunks={ { regiment=1003 } } }
5004={ army=900 cached={ current=2800 max=2823 } chunks={ { regiment=1004 } } }
}
armies={
700={ owner=13015 commander=18664 location=4905 movement={ destination=4910 path={ 4910 } } supply=78 max_supply=100 war=71 }
800={ owner=14491 commander=14491 location=4910 war=71 }
801={ owner=16414 commander=16414 location=4900 movement={ destination=4905 path={ 4905 } } war=71 }
900={ owner=15503 commander=15503 location=4900 war=71 }
}
}
wars={ active_wars={
71={
attacker={ participants={ { character=13015 } { character=15503 } } }
defender={ participants={ { character=14491 } { character=16414 } } }
casus_belli={ type="county_conquest_cb" targeted_titles={ 3310 } }
start_date=869.1.17
}
} }
`);

test("exports player, allied and hostile army positions and movement", async () => {
  const result = await queryGamestate(GS, (q) =>
    extractOperationalArmies(q, new Localizer(null)),
  );

  expect(result.source).toBe("armies_save_best_effort");
  expect(result.playerArmyCount).toBe(1);
  expect(result.friendlyArmyCount).toBe(1);
  expect(result.hostileArmyCount).toBe(2);
  expect(result.armies).toHaveLength(4);

  const player = result.armies.find((army) => army.id === 700);
  expect(player?.relation).toBe("player");
  expect(player?.ownerName).toBe("Siemowit");
  expect(player?.commanderName).toBe("Rodislav");
  expect(player?.commanderMartial).toBe(25);
  expect(player?.currentSoldiers).toBe(1931);
  expect(player?.maxSoldiers).toBe(1939);
  expect(player?.locationProvinceId).toBe(4905);
  expect(player?.locationName).toBe("Gniezno");
  expect(player?.destinationProvinceId).toBe(4910);
  expect(player?.destinationName).toBe("Żnin");
  expect(player?.movementPathProvinceIds).toEqual([4910]);
  expect(player?.movementPathNames).toEqual(["Żnin"]);
  expect(player?.moving).toBe(true);
  expect(player?.supply).toBe(78);
  expect(player?.maxSupply).toBe(100);
  expect(player?.warIds).toEqual([71]);

  const enemyAlly = result.armies.find((army) => army.id === 801);
  expect(enemyAlly?.relation).toBe("hostile");
  expect(enemyAlly?.ownerName).toBe("Jaromil");
  expect(enemyAlly?.locationName).toBe("Poznań");
  expect(enemyAlly?.destinationName).toBe("Gniezno");

  const friendly = result.armies.find((army) => army.id === 900);
  expect(friendly?.relation).toBe("friendly");
  expect(friendly?.ownerName).toBe("Gardomir");
});
