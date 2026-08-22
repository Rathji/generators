// Validation tests for Task #62: Critical Hit Logic.

import { CriticalHitSystem, CRIT_MULTIPLIER, CRIT_CAP } from "../engine/criticals.js";
import { CombatResolver } from "../engine/combat.js";
import { Character } from "../engine/character.js";

const CUSTOM_ITEMS = {
  razor: { id: "razor", name: "Razor Dagger", type: "weapon", slot: "weapon", mods: { atk: 5, crit: 0.2 } },
  plain: { id: "plain", name: "Plain Blade", type: "weapon", slot: "weapon", mods: { atk: 6 } },
};

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new CriticalHitSystem({ random: () => 0, items: CUSTOM_ITEMS });

  const thief = new Character({ id: "t", name: "Thief", classId: "thief" });
  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  const goblin = { id: "g", name: "Goblin", hp: 18, maxHp: 18, str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1 };

  const tChance = sys.critChance(thief);
  const wChance = sys.critChance(warrior);
  check("agility raises crit chance", tChance > wChance);
  check("chance capped", sys.critChance({ ...thief.getStats(), agi: 9999 }) <= CRIT_CAP);

  warrior.equipment.weapon = "razor";
  check("weapon crit mod adds chance", sys.critChance(warrior) > wChance);
  check("mod read from item db", Math.abs(sys.critChance(warrior) - (wChance + 0.2)) < 1e-9);

  const yes = sys.roll(thief, goblin);
  check("rng 0 always crits", yes.critical === true && yes.multiplier === CRIT_MULTIPLIER);
  const no = new CriticalHitSystem({ random: () => 0.99, items: CUSTOM_ITEMS }).roll(thief, goblin);
  check("rng 0.99 never crits", no.critical === false && no.multiplier === 1);

  const applied = sys.apply(100, thief, goblin);
  check("apply multiplies damage", applied.damage === 200 && applied.critical === true);
  const appliedNo = new CriticalHitSystem({ random: () => 0.99, items: CUSTOM_ITEMS }).apply(100, thief, goblin);
  check("no-crit apply unchanged", appliedNo.damage === 100);

  // --- Integration: CombatResolver rolls crits and reports them ---
  const cr = new CombatResolver({ random: () => 0, critSystem: new CriticalHitSystem({ random: () => 0, items: CUSTOM_ITEMS }) });
  const w = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  w.equipment.weapon = "razor";
  const g = { id: "g", name: "Goblin", hp: 200, maxHp: 200, str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1 };
  cr.begin([w], [g]);
  const res = cr.attack(w, g);
  check("combat attack reports critical", res.critical === true && res.critMult === CRIT_MULTIPLIER);
  const atk = w.getStats().str + w.getStats().atk;
  const base = Math.max(1, atk - g.def);
  check("crit damage doubled", res.damage === Math.max(1, Math.round(Math.round(base * 0.8) * 2)));

  const crNo = new CombatResolver({ random: () => 0.5 });
  const g2 = { id: "g2", name: "Goblin", hp: 200, maxHp: 200, str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1 };
  crNo.begin([w], [g2]);
  const noCrit = crNo.attack(w, g2);
  check("high roll no crit", noCrit.critical === false);

  const crOff = new CombatResolver({ random: () => 0, crits: false });
  crOff.begin([w], [goblin]);
  check("crits can be disabled", crOff.attack(w, goblin).critical === false);

  return out;
}
