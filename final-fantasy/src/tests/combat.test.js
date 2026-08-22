// Validation tests for Task #4: Turn-Based Combat Resolver.

import { CombatResolver } from "../engine/combat.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";

function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function goblin() {
  return { id: "goblin", name: "Goblin", hp: 18, maxHp: 18, mp: 0, maxMp: 0, str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1 };
}

function imp() {
  return { id: "imp", name: "Imp", hp: 12, maxHp: 12, mp: 0, maxMp: 0, str: 5, atk: 3, int: 3, agi: 14, def: 1, mdef: 1 };
}

function tank() {
  return { id: "tank", name: "Tank", hp: 100, maxHp: 100, mp: 0, maxMp: 0, str: 5, atk: 3, int: 1, agi: 8, def: 2, mdef: 1 };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // ---- Turn order by agility (seeded rng => deterministic) ----
  const c1 = new CombatResolver({ random: () => 0 });
  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  const thief = new Character({ id: "t", name: "Thief", classId: "thief" });
  const g = goblin();
  const i = imp();
  c1.begin([warrior, thief], [g, i]);
  const order = c1.turnOrder();
  check("turn order length", order.length === 4);
  check("agility sorts turn order", order[0] === thief && order[1] === i && order[2] === warrior && order[3] === g);

  // ---- Attack resolution ----
  const c2 = new CombatResolver({ random: lcg(1), crits: false });
  const w2 = new Character({ id: "w2", name: "Warrior", classId: "warrior" });
  w2.equipment.weapon = "ironSword";
  const g2 = goblin();
  c2.begin([w2], [g2]);
  const res = c2.attack(w2, g2);
  const atk = w2.getStats().str + w2.getStats().atk;
  const base = Math.max(1, atk - g2.def);
  check("attack deals damage", res.damage >= 1 && g2.hp === 18 - res.damage);
  check("damage within variance band", res.damage >= Math.floor(base * 0.8) && res.damage <= Math.ceil(base * 1.2));
  check("attack returns log message", res.messages.length === 1);

  // ---- Miss when the target is much faster ----
  const fast = { id: "f", name: "Fast", hp: 50, maxHp: 50, mp: 0, maxMp: 0, str: 1, atk: 1, int: 1, agi: 200, def: 0, mdef: 0 };
  const missSeq = [0.99];
  const c3 = new CombatResolver({ random: () => missSeq.shift() ?? 0 });
  const slow = new Character({ id: "s", name: "Slow", classId: "warrior" });
  c3.begin([slow], [fast]);
  const missRes = c3.attack(slow, fast);
  check("miss possible", missRes.missed === true && missRes.damage === 0 && fast.hp === 50);

  // ---- Spell (damage) ----
  const c4 = new CombatResolver({ random: lcg(1) });
  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });
  const tk = tank();
  c4.begin([mage], [tk]);
  const sres = c4.spell(mage, "fire", tk);
  check("spell ok", sres.ok === true);
  check("spell costs MP", mage.mp === mage.getStats().maxMp - 4);
  check("spell element reported", sres.element === "fire");
  const sBase = Math.max(1, 22 + mage.getStats().int - tk.mdef);
  check("spell damage within variance", sres.damage >= Math.floor(sBase * 0.8) && sres.damage <= Math.ceil(sBase * 1.2));
  check("spell log message", sres.messages.length === 1);

  // ---- Insufficient MP blocks casting ----
  const mage2 = new Character({ id: "m2", name: "Mage2", classId: "blackMage" });
  mage2.spendMp(mage2.getStats().maxMp);
  const c5 = new CombatResolver();
  c5.begin([mage2], [goblin()]);
  const noMp = c5.spell(mage2, "fire", goblin());
  check("insufficient MP blocked", noMp.ok === false && mage2.mp === 0);

  // ---- Spell (heal) ----
  const c6 = new CombatResolver();
  const healer = new Character({ id: "h", name: "Healer", classId: "whiteMage" });
  const w6 = new Character({ id: "w6", name: "W6", classId: "warrior" });
  w6.damage(25);
  c6.begin([healer, w6], [goblin()]);
  const cureRes = c6.spell(healer, "cure", w6);
  check("cure heals ally", cureRes.ok === true && w6.hp === w6.getStats().maxHp);
  check("heal consumes MP", healer.mp === healer.getStats().maxMp - 4);

  // ---- Item action in combat ----
  const inv = new Inventory();
  inv.add("potion", 2);
  const c7 = new CombatResolver({ inventory: inv });
  const w7 = new Character({ id: "w7", name: "W7", classId: "warrior" });
  w7.damage(15);
  c7.begin([w7], [goblin()]);
  const itemRes = c7.item(w7, "potion", w7);
  check("combat item ok", itemRes.ok === true && inv.count("potion") === 1 && w7.hp === w7.getStats().maxHp);
  check("unusable item rejected", c7.item(w7, "crystalKey", w7).ok === false);

  // ---- Victory ----
  const c8 = new CombatResolver({ random: () => 0, crits: false });
  const w8 = new Character({ id: "w8", name: "W8", classId: "warrior" });
  w8.equipment.weapon = "ironSword";
  const g8 = goblin();
  c8.begin([w8], [g8]);
  c8.attack(w8, g8);
  check("not over after first hit", g8.hp === 4 && c8.isOver === false);
  c8.attack(w8, g8);
  check("victory when all enemies fall", c8.isVictory === true && c8.isOver === true);
  check("dead enemies excluded from combatants", c8.combatants().length === 1);

  // ---- Defeat ----
  const c9 = new CombatResolver({ random: () => 0 });
  const w9 = new Character({ id: "w9", name: "W9", classId: "warrior" });
  const boss = goblin();
  boss.str = 100;
  boss.atk = 100;
  c9.begin([w9], [boss]);
  c9.attack(boss, w9);
  check("defeat on party wipe", c9.isDefeat === true && c9.isOver === true);

  // ---- Run ----
  const c10 = new CombatResolver({ random: () => 0 });
  const w10 = new Character({ id: "w10", name: "W10", classId: "thief" });
  c10.begin([w10], [goblin()]);
  const runOk = c10.tryRun();
  check("run can succeed", runOk.ok === true && c10.outcome === "fled" && c10.isOver === true);

  const c11 = new CombatResolver({ random: () => 0.99 });
  const w11 = new Character({ id: "w11", name: "W11", classId: "thief" });
  c11.begin([w11], [goblin()]);
  check("run can fail", c11.tryRun().ok === false && c11.isOver === false);

  return out;
}
