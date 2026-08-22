// Validation tests for Task #23: Inn Restoration System.

import { InnSystem } from "../engine/inn.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  function makeParty(gold) {
    const party = new PartyManager({ gold });
    const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
    const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
    party.add(hero);
    party.add(mage);
    return { party, hero, mage };
  }

  const { party, hero, mage } = makeParty(100);
  const inn = new InnSystem({ party, cost: 40 });
  check("no one needs rest initially", inn.membersNeedingRest().length === 0);
  const already = inn.rest();
  check("rest when already rested rejected", already.ok === false && already.error === "already rested");

  hero.damage(20);
  mage.spendMp(10);
  mage.addStatus("poison");
  check("members needing rest", inn.membersNeedingRest().length === 2);
  const res = inn.rest();
  check("rest succeeds", res.ok === true && res.cost === 40);
  check("gold charged", party.gold === 60);
  check("hp fully restored", hero.hp === hero.getStats().maxHp);
  check("mp fully restored", mage.mp === mage.getStats().maxMp);
  check("status cleared", mage.statuses.length === 0);

  const poor = makeParty(10);
  const poorInn = new InnSystem({ party: poor.party, cost: 40 });
  poor.hero.damage(5);
  const broke = poorInn.rest();
  check("insufficient gold blocks rest", broke.ok === false && broke.error === "insufficient gold");
  check("no gold spent on failure", poor.party.gold === 10);

  const state = new GameState();
  const free = makeParty(50);
  const freeInn = new InnSystem({ party: free.party, cost: 40, freeIfFlag: "free_inn", state });
  free.hero.damage(10);
  state.setFlag("free_inn");
  const freeRes = freeInn.rest();
  check("flag makes stay free", freeRes.ok === true && freeRes.cost === 0 && free.party.gold === 50);

  const noParty = new InnSystem({ cost: 40 });
  check("no party rejected", noParty.rest().error === "no party");
  check("effective cost returns cost", inn.effectiveCost() === 40);

  return out;
}
