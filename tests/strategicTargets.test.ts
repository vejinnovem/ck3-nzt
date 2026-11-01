import { describe, expect, it } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractExpansion } from "../src/extract/expansion.js";
import { Localizer } from "../src/localization.js";

const GS = Buffer.from(`
played_character={ character=100 }
landed_titles={ landed_titles={
  10={ key="k_poland" name="Poland" }
  20={ key="d_polania" name="Polania" holder=100 de_jure_liege=10 }
  21={ key="c_poznan" name="Poznan" holder=100 de_jure_liege=20 de_facto_liege=20 }
  30={ key="d_silesia" name="Silesia" holder=200 de_jure_liege=10 }
  31={ key="c_wroclaw" name="Wroclaw" holder=200 de_jure_liege=30 de_facto_liege=30 }
  32={ key="c_opole" name="Opole" holder=201 de_jure_liege=30 de_facto_liege=30 }
  40={ key="d_pomerania" name="Pomerania" holder=300 de_jure_liege=10 }
  41={ key="c_szczecin" name="Szczecin" holder=300 de_jure_liege=40 de_facto_liege=40 }
  50={ key="k_bohemia" name="Bohemia" holder=400 }
  51={ key="c_prague" name="Prague" holder=400 de_jure_liege=50 de_facto_liege=50 }
} }
living={
  100={ first_name="Siemowit" alive_data={ claim={ { title=31 pressed=yes } } } landed_data={ domain={ 20 21 } current_strength=2000 strength=2000 } }
  200={ first_name="Gardomir" landed_data={ domain={ 30 31 } current_strength=1400 strength=1600 } }
  201={ first_name="Vassal" landed_data={ domain={ 32 } } }
  300={ first_name="Boguslaw" landed_data={ domain={ 40 41 } current_strength=2500 strength=2700 } }
  400={ first_name="Vratislav" landed_data={ domain={ 50 51 } current_strength=5000 strength=5200 } }
  500={ first_name="Ally" landed_data={ domain={ 50 } } }
}
relations={ active_relations={
  { first=200 second=500 alliances={ { allied_through_0=200 allied_through_1=500 } } }
} }
wars={ active_wars={
  1={ casus_belli={ type="conquest_cb" targeted_titles={ 41 } } attacker={ participants={ { character=300 } } } defender={ participants={ { character=999 } } } }
} }
`);

const GS_PRIMARY_REALM = Buffer.from(`
played_character={ character=100 }
landed_titles={ landed_titles={
  10={ key="k_poland" name="Poland" }
  20={ key="d_polania" name="Polania" holder=100 de_jure_liege=10 }
  21={ key="c_poznan" name="Poznan" holder=100 de_jure_liege=20 de_facto_liege=20 }
  60={ key="c_chelmno" name="Chelmno" holder=600 }
  61={ key="c_kujawy" name="Kujawy" holder=600 de_jure_liege=10 }
  62={ key="c_dobrzyn" name="Dobrzyn" holder=600 de_jure_liege=10 }
} }
living={
  100={ first_name="Siemowit" landed_data={ domain={ 20 21 } current_strength=2100 strength=2100 } }
  600={ first_name="Stefan" landed_data={ domain={ 60 61 62 } current_strength=1200 strength=1300 } }
}
`);

const run = () =>
  queryGamestate(GS, (q) => extractExpansion(q, new Localizer(null), []));

const runPrimaryRealm = () =>
  queryGamestate(GS_PRIMARY_REALM, (q) => extractExpansion(q, new Localizer(null), []));

describe("strategic expansion targets", () => {
  it("groups foreign counties in the player's de-jure kingdom by independent realm", async () => {
    const e = await run();
    expect(e.targetScope).toEqual({
      deJureKingdomId: 10,
      deJureKingdomName: "Poland",
      exactAdjacencyAvailable: false,
      casusBelliCoverage: "claims_and_direct_de_jure_only",
    });
    expect(e.strategicTargets.map((t) => t.realmName)).toEqual(["Silesia", "Pomerania"]);
    expect(e.strategicTargets[0]!.relevantTitles.map((t) => t.title)).toEqual([
      "Wroclaw",
      "Opole",
    ]);
    expect(e.strategicTargets[0]!.currentStrength).toBe(1400);
    expect(e.strategicTargets[0]!.playerToTargetStrengthRatio).toBeCloseTo(2000 / 1400);
    expect(e.strategicTargets[0]!.relevantTitles[0]!.confirmedCasusBelli).toEqual(["claim"]);
  });

  it("includes target alliances and active wars, but excludes realms outside the kingdom", async () => {
    const e = await run();
    const silesia = e.strategicTargets.find((t) => t.realmName === "Silesia")!;
    const pomerania = e.strategicTargets.find((t) => t.realmName === "Pomerania")!;
    expect(silesia.allies).toEqual([{ id: 500, name: "Ally", realm: "Bohemia" }]);
    expect(pomerania.wars).toEqual([
      { side: "attacker", cbType: "conquest_cb", targetTitle: "Szczecin" },
    ]);
    expect(e.strategicTargets.some((t) => t.realmName === "Bohemia")).toBe(false);
  });

  it("uses the ruler's primary title for realm identity when relevant counties have different roots", async () => {
    const e = await runPrimaryRealm();
    expect(e.strategicTargets).toHaveLength(2);
    expect(e.strategicTargets.every((target) => target.rulerId === 600)).toBe(true);
    expect(e.strategicTargets.every((target) => target.realmTitleId === 60)).toBe(true);
    expect(e.strategicTargets.every((target) => target.realmName === "Chelmno")).toBe(true);
    expect(e.strategicTargets.flatMap((target) => target.relevantTitles.map((title) => title.title))).toEqual([
      "Kujawy",
      "Dobrzyn",
    ]);
  });
});
