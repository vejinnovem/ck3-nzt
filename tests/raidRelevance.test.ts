import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractMilitary } from "../src/extract/military.js";
import { extractPlayerRealm } from "../src/extract/realm.js";
import { correctRaidDomainRelevance } from "../src/snapshot.js";

const GAME_DIR = fileURLToPath(new URL("./fixtures/gamedir", import.meta.url));

const RAID_GS = Buffer.from(`
date=883.2.16
played_character={ character=13015 player=1 }
living={
13015={
  first_name="Siemowit"
  playable_data={ knights={} }
  landed_data={ domain={ 1000 2000 } levy=1805 strength=2308 current_strength=2282 strength_without_hires=2308 }
}
200={ first_name="DirectVassal" }
300={ first_name="Duke" }
400={ first_name="NestedVassal" }
900={ first_name="ForeignRuler" }
}
landed_titles={
landed_titles={
1000={ key="k_poland" name="Poland" holder=13015 }
2000={ key="c_player" name="Player County" holder=13015 de_facto_liege=1000 }
2001={ key="b_alpha" name="Player Barony" holder=13015 de_jure_liege=2000 }
3000={ key="d_vassal" name="Vassal Duchy" holder=300 de_facto_liege=1000 }
4000={ key="c_nested_vassal" name="Nested Vassal County" holder=400 de_facto_liege=3000 }
4001={ key="b_beta" name="Nested Vassal Barony" holder=400 de_jure_liege=4000 }
9000={ key="k_foreign" name="Foreign Kingdom" holder=900 }
9100={ key="c_foreign" name="Foreign County" holder=900 de_facto_liege=9000 }
9101={ key="b_foreign" name="Foreign Barony" holder=900 de_jure_liege=9100 province=7777 }
}
}
raid={
raid={
486539284={ progress=239.47 army=100663413 province=101 }
486539285={ progress=150 army=100663414 province=102 }
486539286={ progress=100 army=100663415 province=7777 }
}
}
armies={ armies={} }
wars={ active_wars={} }
`);

test("marks raids across the player's de-facto realm and excludes foreign targets", async () => {
  const loc = new Localizer(GAME_DIR);
  const military = await queryGamestate(RAID_GS, (q) => {
    const realm = extractPlayerRealm(q, loc);
    return correctRaidDomainRelevance(q, extractMilitary(q, loc), realm, loc);
  });

  expect(military.raids.activeCount).toBe(3);
  expect(military.raids.playerRelevantCount).toBe(2);

  const personal = military.raids.records.find((record) => record.id === "486539284");
  expect(personal?.playerRelevant).toBe(true);
  expect(personal?.fields["province"]).toBe(101);
  expect(personal?.fields["target_title_id"]).toBe(2001);
  expect(personal?.fields["target_county_id"]).toBe(2000);
  expect(personal?.fields["player_relevance"]).toBe("player_domain");

  const nestedVassal = military.raids.records.find((record) => record.id === "486539285");
  expect(nestedVassal?.playerRelevant).toBe(true);
  expect(nestedVassal?.fields["province"]).toBe(102);
  expect(nestedVassal?.fields["target_title_id"]).toBe(4001);
  expect(nestedVassal?.fields["target_county_id"]).toBe(4000);
  expect(nestedVassal?.fields["player_relevance"]).toBe("player_realm_vassal");

  const foreign = military.raids.records.find((record) => record.id === "486539286");
  expect(foreign?.playerRelevant).toBe(false);
  expect(foreign?.fields["target_county_id"]).toBe(9100);
  expect(foreign?.fields["player_relevance"]).toBe("foreign");
});
