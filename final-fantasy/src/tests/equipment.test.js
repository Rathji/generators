// Validation tests for Task #8: Equipment & Slot System.

import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";
import { EquipSystem, SLOTS } from "../engine/equipment.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("weapon + armor + accessory slots", SLOTS.length === 3 && SLOTS.includes("weapon") && SLOTS.includes("armor") && SLOTS.includes("accessory"));

  const inv = new Inventory();
  inv.add("ironSword", 1);
  inv.add("staff", 1);
  inv.add("chain", 1);
  inv.add("mythrilSword", 1);
  const eq = new EquipSystem(inv);
  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });

  check("warrior can equip iron sword", eq.canEquip(warrior, ITEMS.ironSword) === true);
  check("mage cannot equip iron sword", eq.canEquip(mage, ITEMS.ironSword) === false);
  check("mage can equip staff", eq.canEquip(mage, ITEMS.staff) === true);
  check("warrior cannot equip staff", eq.canEquip(warrior, ITEMS.staff) === false);
  check("consumable not equippable", eq.canEquip(warrior, ITEMS.potion) === false);
  check("canEquipId parity", eq.canEquipId(warrior, "ironSword") === true && eq.canEquipId(mage, "ironSword") === false);

  const atkBefore = warrior.getStats().atk;
  const defBefore = warrior.getStats().def;
  const r1 = eq.equip(warrior, "ironSword");
  check("equip weapon ok", r1.ok === true && r1.slot === "weapon" && r1.unequipped === null);
  check("weapon consumed from inventory", inv.has("ironSword") === false);
  check("atk raised by weapon", warrior.getStats().atk === atkBefore + 8);

  const r2 = eq.equip(warrior, "chain");
  check("equip armor ok", r2.ok === true);
  // The Iron Set (ironSword + chain) bonus +1 DEF is composed in by the page
  // wiring, so the exact value includes it.
  check("def raised by armor", warrior.getStats().def === defBefore + 7 + 1);

  const r3 = eq.equip(warrior, "staff");
  check("class restriction blocks equip", r3.ok === false);
  check("failed equip keeps inventory", inv.has("staff") === true);
  check("equip requires ownership", eq.equip(warrior, "plate").ok === false);

  const r5 = eq.equip(warrior, "mythrilSword");
  check("swap returns old weapon", r5.ok === true && r5.unequipped === "ironSword" && inv.has("ironSword") === true);
  check("new weapon equipped", warrior.equipment.weapon === "mythrilSword");

  const r6 = eq.unequip(warrior, "weapon");
  check("unequip ok", r6.ok === true && r6.item === "mythrilSword" && inv.has("mythrilSword") === true);
  check("unequip empty slot fails", eq.unequip(warrior, "weapon").ok === false);
  check("stats revert after unequip", warrior.getStats().atk === atkBefore);
  check("equippedItem reflects state", eq.equippedItem(warrior, "armor") === ITEMS.chain);

  const eqNoInv = new EquipSystem();
  const bare = new Character({ id: "b", name: "B", classId: "warrior" });
  check("equip without inventory works", eqNoInv.equip(bare, "dagger").ok === true && bare.equipment.weapon === "dagger");

  return out;
}
