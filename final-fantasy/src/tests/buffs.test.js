// Validation tests for Task #128: Party-Wide Buff/Debuff System.

import { BuffSystem } from "../engine/buffs.js";
import { Character } from "../engine/character.js";
import { CombatResolver } from "../engine/combat.js";
import { setExtraBuffMods } from "../engine/stats.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new BuffSystem();
  const hero = new Character({ id: "h", name: "Hero", classId: "warrior" });
  const ally = new Character({ id: "a", name: "Ally", classId: "whiteMage" });
  const enemy = { id: "e", name: "Goblin", hp: 20, maxHp: 20, agi: 4, str: 3, def: 1 };

  const r = sys.apply(hero, "haste");
  check("haste applied", r.ok === true && r.name === "Haste" && r.turns === 3);
  check("haste raises agi statMods", sys.statMods(hero).agi === 3);
  check("speedMod from haste", sys.speedMod(hero) === 3);
  check("active lists buff", sys.active(hero).length === 1 && sys.active(hero)[0].name === "Haste");
  check("remaining turns", sys.remaining(hero, "haste") === 3);

  // Party-wide application.
  const party = { members: [hero, ally] };
  const pw = sys.applyToParty(party, "might");
  check("party-wide might", pw.ok === true && pw.results.length === 2 && sys.has(ally, "might"));
  check("might str +3", sys.statMods(ally).str === 3);

  // Blind reduces hit chance.
  sys.apply(enemy, "blind");
  check("blind hit mod", sys.hitChanceMod(enemy) === -0.25);
  check("blind no stat mods", Object.keys(sys.statMods(enemy)).length === 0);

  // Turn ticking + expiry.
  sys.apply(enemy, "slow");
  sys.tick(enemy);
  check("slow ticks down", sys.remaining(enemy, "slow") === 2);
  sys.tick(enemy);
  sys.tick(enemy);
  check("slow expires", !sys.has(enemy, "slow"));
  sys.apply(enemy, "guard", { turns: 1 });
  const evs = sys.tick(enemy);
  check("woreOff event fires", evs.some((e) => e.type === "woreOff" && e.buff === "guard"));

  // remove / clear.
  sys.remove(hero, "haste");
  check("removed", !sys.has(hero, "haste"));
  sys.clear(ally);
  check("cleared", sys.active(ally).length === 0);

  // Merged multi-stat mods (Rage: +4 STR, -2 DEF) on a clean target.
  sys.clear(hero);
  sys.apply(hero, "rage");
  const mods = sys.statMods(hero);
  check("rage merges mods", mods.str === 4 && mods.def === -2);

  // refresh resets duration.
  sys.apply(hero, "focus", { turns: 1 });
  sys.refresh(hero, "focus");
  check("refresh resets turns", sys.remaining(hero, "focus") === 4);

  // CombatResolver hit-chance integration (Blind).
  const cr = new CombatResolver({ random: () => 0.5, buffs: sys, crits: false });
  const blindHero = new Character({ id: "bh", name: "BH", classId: "thief" });
  sys.apply(blindHero, "blind");
  const baseHit = cr.hitChance(blindHero.getStats(), { agi: 1 }, null);
  const blindHit = cr.hitChance(blindHero.getStats(), { agi: 1 }, blindHero);
  check("blind reduces hit chance", blindHit < baseHit && Math.abs(blindHit - (baseHit - 0.25)) < 1e-9);

  // CombatResolver initiative integration (Haste).
  const spBefore = new CombatResolver({ random: () => 0 }).speedOf(hero);
  sys.apply(hero, "haste");
  const spAfter = new CombatResolver({ random: () => 0, buffs: sys }).speedOf(hero);
  check("haste raises initiative", spAfter === spBefore + 3);

  // getEffectiveStats integration: buff stat deltas flow through the hook.
  let statsOk = null;
  try {
    setExtraBuffMods((ch) => sys.statMods(ch));
    const w = new Character({ id: "w", name: "W", classId: "warrior" });
    sys.apply(w, "haste");
    // Warrior base AGI 6 + Haste 3 = 9.
    statsOk = w.getStats().agi === 9;
  } finally {
    setExtraBuffMods(null);
  }
  check("buff mods flow into effective stats", statsOk === true);

  check("tickAll returns events array", Array.isArray(sys.tickAll([hero, ally])));

  // audit.
  const audit = sys.audit();
  check("audit ok", audit.ok === true && audit.errors.length === 0);
  const bad = new BuffSystem({ defs: { broken: { name: "x", turns: 0, statMods: { bogus: 1 } } } });
  const ba = bad.audit();
  check("audit flags bad def", ba.ok === false && ba.errors.length === 2);

  check("defs include party buffs", sys.def("haste") !== null && sys.def("blind") !== null);

  return out;
}
