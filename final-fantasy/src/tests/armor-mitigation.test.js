// Validation tests for Task #70: Armor Defense Mitigation.

import { ArmorMitigationSystem } from "../engine/armor-mitigation.js";
import { CombatResolver } from "../engine/combat.js";
import { Character } from "../engine/character.js";

const ARMOR_DB = {
  plate: { id: "plate", name: "Plate Armor", type: "armor", slot: "armor", mods: { def: 12, block: 0.5 } },
  cloth: { id: "cloth", name: "Cloth", type: "armor", slot: "armor", mods: { def: 2 } },
};

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const arm = new ArmorMitigationSystem({ itemDb: ARMOR_DB });

  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  warrior.equipment.armor = "plate";
  const goblin = { id: "g", name: "Goblin", hp: 200, maxHp: 200, str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1 };

  check("armor found", arm.armor(warrior).id === "plate");
  check("defense reads stats", arm.defense(warrior) === warrior.getStats().def); // 8 + 12 = 20
  check("flat reduction = def", arm.flatReduction(warrior) === 20);
  check("explicit block mod", arm.blockPct(warrior) === 0.5);
  check("cloth derives block", arm.blockPct({ ...warrior, equipment: { armor: "cloth" } }) === 0.02);

  const blocked = arm.apply(100, warrior, () => 0);
  check("block halves damage", blocked.blocked === true && blocked.damage === 40); // (100 - 20) * 0.5
  const pass = arm.apply(100, warrior, () => 0.99);
  check("no block keeps flat-only", pass.blocked === false && pass.damage === 80);

  check("unarmored no block", arm.apply(50, goblin, () => 0).blocked === false);

  // --- Integration: CombatResolver with armor system ---
  const cr = new CombatResolver({ random: () => 0, armor: arm, crits: false });
  const w2 = new Character({ id: "w2", name: "Warrior2", classId: "warrior" });
  w2.equipment.armor = "plate";
  cr.begin([goblin], [w2]);
  const res = cr.attack(goblin, w2);
  const atk = goblin.str + goblin.atk;
  const flat = arm.flatReduction(w2);
  const base = Math.max(1, atk - flat);
  const raw = Math.round(base * 0.8);
  const expected = Math.max(1, Math.round(raw * 0.5)); // rng 0 blocks
  check("armor reduces combat damage", res.damage === expected && res.armorBlocked === true);

  const crPlain = new CombatResolver({ random: () => 0, crits: false });
  const w3 = new Character({ id: "w3", name: "Warrior3", classId: "warrior" });
  crPlain.begin([goblin], [w3]);
  const plainRes = crPlain.attack(goblin, w3);
  const plainBase = Math.max(1, atk - w3.getStats().def);
  check("no armor system keeps legacy", plainRes.damage === Math.round(plainBase * 0.8));

  return out;
}
