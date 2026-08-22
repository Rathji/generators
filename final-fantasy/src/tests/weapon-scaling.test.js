// Validation tests for Task #69: Weapon Damage Scaling.

import { WeaponScalingSystem, WEAPON_TYPE_MODS } from "../engine/weapon-scaling.js";
import { Character } from "../engine/character.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ws = new WeaponScalingSystem();

  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });

  check("type mods present", WEAPON_TYPE_MODS.sword && WEAPON_TYPE_MODS.dagger && WEAPON_TYPE_MODS.knuckles && WEAPON_TYPE_MODS.staff);

  check("unarmed type", ws.type(warrior) === "unarmed");
  check("unarmed attack is raw", ws.effectiveAttack(warrior) === warrior.getStats().str + warrior.getStats().atk);

  warrior.equipment.weapon = "ironSword";
  check("sword type", ws.type(warrior) === "sword");
  const stats = warrior.getStats();
  check("sword keeps legacy formula", ws.effectiveAttack(warrior) === stats.str + stats.atk); // str + 8

  warrior.equipment.weapon = "dagger";
  const dStats = warrior.getStats();
  check("dagger scales 0.8 str", ws.effectiveAttack(warrior) === Math.floor(dStats.str * 0.8) + dStats.atk);

  warrior.equipment.weapon = "knuckles";
  const kStats = warrior.getStats();
  check("knuckles scale 1.2 str", ws.effectiveAttack(warrior) === Math.floor(kStats.str * 1.2) + kStats.atk);

  mage.equipment.weapon = "staff";
  const mStats = mage.getStats();
  check("staff scales off int", ws.effectiveAttack(mage) === Math.floor(mStats.int * 0.7) + mStats.atk);

  // Enemies / weaponless use raw STR + ATK.
  const goblin = { id: "g", name: "Goblin", str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1 };
  check("enemy raw attack", ws.effectiveAttack(goblin) === 10);

  // Full formula vs defender DEF.
  const zombie = { id: "z", name: "Zombie", str: 6, atk: 4, int: 1, agi: 3, def: 5, mdef: 4 };
  const f = ws.formula(goblin, zombie);
  check("formula base", f.base === 5 && f.type === "unarmed");

  check("crit bonus by type", ws.critBonus(warrior) === 0.06); // knuckles
  warrior.equipment.weapon = "ironSword";
  check("sword crit bonus", ws.critBonus(warrior) === 0.02);

  check("power from weapon", ws.power({ equipment: { weapon: "ironSword" } }) === ITEMS.ironSword.mods.atk);

  return out;
}
