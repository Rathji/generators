// Validation tests for Task #113: class-restricted consumables.

import { ConsumableSystem, itemRestrictedFor } from "../engine/consumables.js";
import { ITEMS } from "../data/items.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const draught = ITEMS.warriorsDraught;
  check("warriorsDraught exists as consumable", draught && draught.type === "consumable");
  check("warriorsDraught restricted to warrior", Array.isArray(draught.classes) && draught.classes.includes("warrior"));

  check("itemRestrictedFor allows warrior", itemRestrictedFor(draught, "warrior") === null);
  const restr = itemRestrictedFor(draught, "blackMage");
  check("itemRestrictedFor blocks blackMage", restr && restr.itemId === "warriorsDraught" && restr.classes.includes("warrior"));
  check("itemRestrictedFor unrestricted item null", itemRestrictedFor(ITEMS.potion, "blackMage") === null);
  check("itemRestrictedFor no classes null", itemRestrictedFor(ITEMS.potion, null) === null);

  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });

  const onlyMage = new PartyManager();
  onlyMage.add(mage);
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  inv.add("warriorsDraught", 2);
  inv.add("potion", 1);
  const cs = new ConsumableSystem({ inventory: inv, party: onlyMage });

  check("no warrior: canUse class restricted", (() => {
    const r = cs.canUse("warriorsDraught");
    return r.ok === false && r.error === "class restricted";
  })());
  check("no warrior: use class restricted + not consumed", (() => {
    const r = cs.use("warriorsDraught");
    return r.ok === false && inv.count("warriorsDraught") === 2;
  })());
  check("unrestricted potion usable by mage-only party", (() => {
    mage.damage(10);
    const r = cs.use("potion");
    return r.ok === true && r.targetId === "mage";
  })());
  mage.heal(999);

  const both = new PartyManager();
  both.add(mage);
  both.add(hero);
  const inv2 = new Inventory({ maxSlots: 30, maxWeight: 100 });
  inv2.add("warriorsDraught", 2);
  const cs2 = new ConsumableSystem({ inventory: inv2, party: both });

  hero.damage(20);
  mage.damage(5);
  const used = cs2.use("warriorsDraught");
  check("warrior in party: use auto-targets warrior", used.ok === true && used.targetId === "hero");
  check("consumed on success", inv2.count("warriorsDraught") === 1);

  hero.heal(999);
  check("explicit wrong-class target denied", (() => {
    const r = cs2.use("warriorsDraught", { target: mage });
    return r.ok === false && r.error === "class restricted" && inv2.count("warriorsDraught") === 1;
  })());
  check("explicit warrior target works", (() => {
    hero.damage(5);
    const before = hero.hp;
    const r = cs2.use("warriorsDraught", { target: hero });
    return r.ok === true && hero.hp > before;
  })());

  const mageOnlyInv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  mageOnlyInv.add("warriorsDraught", 1);
  const cs3 = new ConsumableSystem({ inventory: mageOnlyInv, party: onlyMage });
  check("canUse restricted error shape carries classes", (() => {
    const r = cs3.canUse("warriorsDraught");
    return r.classes && r.classes.length === 1 && r.classes[0] === "warrior";
  })());

  check("other class-restricted consumables unaffected by unrestricted flow", (() => {
    const p = new PartyManager();
    const w = new Character({ id: "w", name: "W", classId: "warrior" });
    p.add(w);
    const iv = new Inventory({ maxSlots: 30, maxWeight: 100 });
    iv.add("cottage", 1);
    const c = new ConsumableSystem({ inventory: iv, party: p });
    w.damage(10);
    return c.canUse("cottage").ok === true;
  })());

  return out;
}
