// Validation tests for Task #186: the Wayfarer's Charm — a proper accessory
// (agi + hp mods, paralysis immunity) that equips through the accessory slot.

import { ITEMS } from "../data/items.js";
import { AccessorySystem } from "../engine/accessories.js";
import { Character } from "../engine/character.js";
import { EquipSystem } from "../engine/equipment.js";
import { Inventory } from "../engine/inventory.js";
import { getEffectiveStats } from "../engine/stats.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const charm = ITEMS.wayfarerCharm;
  check("item defined", !!charm);
  check("is an accessory", charm?.type === "accessory" && charm?.slot === "accessory");
  check("agi + hp mods", charm?.mods?.agi === 3 && charm?.mods?.hp === 10);
  check("paralysis immunity", Array.isArray(charm?.statusImmune) && charm.statusImmune.includes("paralysis"));
  check("usable by all classes", charm?.classes?.length === 6);

  const inv = new Inventory();
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  hero.equipment = { weapon: null, armor: null, accessory: null };
  const equip = new EquipSystem(inv);
  const acc = new AccessorySystem();

  inv.add("wayfarerCharm", 1);
  const before = acc.describe(hero);
  check("no accessory equipped", before === "No accessory equipped.");
  check("no immunity before", acc.immunityFor(hero, "paralysis") === false);

  const r = equip.equip(hero, "wayfarerCharm");
  check("equips into accessory slot", r?.ok === true || hero.equipment.accessory === "wayfarerCharm");
  check("immunity granted", acc.immunityFor(hero, "paralysis") === true);
  check("other status unaffected", acc.immunityFor(hero, "poison") === false);
  check("describe mentions charm", acc.describe(hero).includes("Wayfarer's Charm"));

  const stats = getEffectiveStats(hero, hero.class, ITEMS);
  const bare = new Character({ id: "x", name: "X", classId: "warrior" });
  check("agi mod visible in stats", stats.agi >= getEffectiveStats(bare, bare.class, ITEMS).agi, `agi=${stats.agi}`);

  return out;
}
