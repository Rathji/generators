// Validation tests for Task #9: Inventory Management System.

import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const inv = new Inventory({ maxSlots: 3, maxWeight: 10 });
  check("add item", inv.add("potion", 1) === true);
  check("count item", inv.count("potion") === 1);
  check("stacks same item", inv.add("potion", 2) === true && inv.count("potion") === 3);
  check("slot limit enforced", inv.add("ether", 1) === true && inv.add("antidote", 1) === true && inv.add("goblinFang", 1) === false);
  check("used slots tracked", inv.usedSlots() === 3);

  // Task #142: identical consumables now split across multiple stacks (each
  // capped at stackMax), instead of a single stack hard-capping the total.
  const invStack = new Inventory({ maxSlots: 3, maxWeight: 400 });
  invStack.add("potion", 99);
  check("single stack holds 99", invStack.usedSlots() === 1 && invStack.count("potion") === 99);
  const sp = invStack.split("potion", 0, 30);
  check("split detaches a new stack", sp.ok === true && invStack.stackInfo("potion").slots === 2);
  check("partial stacks occupy 2 slots", invStack.usedSlots() === 2 && invStack.count("potion") === 99);
  check("merge consolidates into 1 stack", invStack.merge("potion").ok === true && invStack.usedSlots() === 1 && invStack.count("potion") === 99);
  check("stack cap 99 enforced", invStack.add("potion", 1) === true && invStack.count("potion") === 100 && invStack.stackInfo("potion").slots === 2);
  check("add over cap opens a new stack", invStack.usedSlots() === 2);
  check("non-stackable stays capped", invStack.add("crystalKey", 2) === false);

  const invW = new Inventory({ maxSlots: 99, maxWeight: 2 });
  check("weight allows adds", invW.add("potion", 1) === true && invW.add("ether", 1) === true);
  check("weight limit blocks", invW.add("antidote", 1) === false);
  check("totalWeight computed", invW.totalWeight() === 2);

  check("has/remove", inv.has("potion", 3) === true && inv.remove("potion", 1) === true && inv.count("potion") === 2);
  check("remove too many fails", inv.remove("potion", 99) === false);
  check("remove last deletes stack", inv.remove("ether", 1) === true && inv.has("ether") === false);
  check("key items don't stack", new Inventory().add("crystalKey", 2) === false);
  check("unknown item rejected", inv.add("nope", 1) === false);

  const inv2 = new Inventory({ maxSlots: 30, maxWeight: 100 });
  inv2.add("potion", 3);
  inv2.add("ether", 1);
  inv2.add("antidote", 1);
  inv2.add("cottage", 1);

  const war = new Character({ id: "w", name: "W", classId: "warrior" });
  war.damage(10);
  const res = inv2.use("potion", war);
  check("potion use ok", res.ok === true);
  check("potion heals to cap", res.healed === 10 && war.hp === war.getStats().maxHp);
  check("potion consumed", inv2.count("potion") === 2);
  const full = inv2.use("potion", war);
  check("use on full HP rejected", full.ok === false);
  check("failed use does not consume", inv2.count("potion") === 2);

  const dead = new Character({ id: "d", name: "D", classId: "warrior" });
  dead.damage(9999);
  check("use on downed target rejected", inv2.use("potion", dead).ok === false);

  const mage = new Character({ id: "m", name: "M", classId: "blackMage" });
  mage.spendMp(8);
  const er = inv2.use("ether", mage);
  check("ether restores mp", er.ok === true && mage.mp === mage.getStats().maxMp);

  const poisoned = new Character({ id: "p", name: "P", classId: "warrior" });
  poisoned.addStatus("poison");
  const ar = inv2.use("antidote", poisoned);
  check("antidote cures poison", ar.ok === true && poisoned.hasStatus("poison") === false);
  check("antidote on healthy rejected", inv2.use("antidote", poisoned).ok === false);

  const p2 = new Character({ id: "p2", name: "P2", classId: "whiteMage" });
  p2.damage(5);
  p2.spendMp(4);
  const cr = inv2.use("cottage", [war, p2]);
  check("cottage restores party", cr.ok === true && p2.hp === p2.getStats().maxHp && p2.mp === p2.getStats().maxMp);
  check("cottage consumed", inv2.count("cottage") === 0);
  check("cottage on healthy party rejected", inv2.use("cottage", [war, p2]).ok === false);

  check("key item not usable", inv2.use("crystalKey", war).ok === false);
  check("list reports entries", Array.isArray(inv2.list()) && inv2.list().every((e) => e.name && e.count >= 1));

  return out;
}
