// Validation tests for Task #6: Party Management System.

import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

function mk(id) {
  return new Character({ id, name: id, classId: "warrior" });
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const party = new PartyManager({ gold: 100 });
  check("empty party", party.count() === 0);
  const a = mk("a");
  const b = mk("b");
  const c = mk("c");
  const d = mk("d");
  const e = mk("e");
  check("add up to 4 active", party.add(a) && party.add(b) && party.add(c) && party.add(d));
  check("fifth active rejected", party.add(e) === false);
  check("reserve slot accepted", party.add(e, true) === true);
  check("four active members", party.count() === 4);
  check("duplicate rejected", party.add(a) === false);

  check("swap active with reserve", party.swap(0, 0) === true && party.members[0] === e && party.reserve[0] === a);
  check("swap bad index rejected", party.swap(5, 0) === false && party.swap(0, 5) === false);

  party.healAll();
  check("healAll restores everyone", party.allAlive() === true);

  b.damage(9999);
  check("partial wipe", party.allDead() === false && party.anyAlive() === true);
  c.damage(9999);
  d.damage(9999);
  e.damage(9999);
  check("full wipe detected", party.allDead() === true && party.anyAlive() === false);
  check("allAlive false on wipe", party.allAlive() === false);

  check("gold add", party.addGold(50) === 150);
  check("spend gold ok", party.spendGold(80) === true && party.gold === 70);
  check("cannot overspend", party.spendGold(100) === false && party.gold === 70);
  check("cannot spend negative", party.spendGold(-5) === false);

  const p2 = new PartyManager();
  const w = new Character({ id: "w", name: "W", classId: "warrior" });
  const m = new Character({ id: "m", name: "M", classId: "blackMage" });
  p2.add(w);
  p2.add(m);
  const ups = p2.grantXp(1200);
  check("grantXp levels everyone", ups.length === 2);
  check("xp granted to all", w.xp === 1200 && m.xp === 1200);
  check("levels raised by xp", w.level === 5 && m.level === 5);
  check("avg level computed", p2.avgLevel() === 5);

  check("remove active by id", p2.remove("w") === true && p2.count() === 1);
  check("remove reserve by id", p2.remove("m") === true);
  check("remove unknown fails", p2.remove("zzz") === false);
  check("avg level of empty party", new PartyManager().avgLevel() === 0);

  return out;
}
