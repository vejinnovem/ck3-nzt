import { expect, test } from "vitest";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractMilitary } from "../src/extract/military.js";
import { correctRaidDomainRelevance } from "../src/snapshot.js";

const RAID_GS = Buffer.from(`
date=871.12.23
played_character={ character=13015 player=1 }
living={
13015={
  first_name="Siemowit"
  playable_data={ knights={} }
  landed_data={ domain={ 3302 3303 } levy=1805 strength=2308 current_strength=2282 strength_without_hires=2308 }
}
}
landed_titles={
landed_titles={
3302={ key="c_kaliska" name="Kalisz" }
3303={ key="b_kalisz" name="Kalisz" de_jure_liege=3302 province=4909 }
9001={ key="b_foreign" name="Foreign" province=7777 }
}
}
raid={
raid={
486539284={ progress=239.47 army=100663413 province=4909 }
486539285={ progress=100 army=100663414 province=7777 }
}
}
armies={ armies={} }
wars={ active_wars={} }
`);

test("marks a raid on a province belonging to the player's domain as relevant", async () => {
  const military = await queryGamestate(RAID_GS, (q) =>
    correctRaidDomainRelevance(q, extractMilitary(q, new Localizer(null))),
  );

  expect(military.raids.activeCount).toBe(2);
  expect(military.raids.playerRelevantCount).toBe(1);
  expect(military.raids.records[0]?.id).toBe("486539284");
  expect(military.raids.records[0]?.playerRelevant).toBe(true);
  expect(military.raids.records[0]?.fields["province"]).toBe(4909);
  expect(military.raids.records[1]?.playerRelevant).toBe(false);
});
