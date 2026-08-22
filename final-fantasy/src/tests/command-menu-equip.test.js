// Validation tests for Task #215: the Equip screen — member listing, slot
// submenu, class-restricted gear from inventory, stat-delta previews, and
// equip/unequip moving items between inventory and equipment.

import { CommandMenuSystem } from "../engine/command-menu.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { ConsumableSystem } from "../engine/consumables.js";
import { SpellCastingSystem } from "../engine/spellcasting.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const party = new PartyManager({ gold: 500 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  party.add(hero);
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage" }));
  const inv = new Inventory();
  inv.add("ironSword", 1);
  inv.add("chain", 1);
  inv.add("plate", 1); // warrior-only armor
  inv.add("robe", 1); // mage-only armor
  inv.add("staff", 1); // mage-only weapon
  inv.add("wayfarerCharm", 1);
  inv.add("potion", 2);
  const cm = new CommandMenuSystem({
    party,
    inventory: inv,
    consumables: new ConsumableSystem({ inventory: inv, party }),
    spells: new SpellCastingSystem(),
    log: () => {},
  });

  const toRoot = () => { while (cm.menu.depth > 1) cm.handleKey("Escape"); };
  const openEquipMember = (id) => {
    toRoot();
    cm.menu.select("equip");
    cm.menu.confirm();
    cm.menu.select("member_" + id);
    cm.menu.confirm();
  };

  // Equip screen lists members with current gear.
  cm.open();
  cm.menu.select("equip");
  cm.menu.confirm();
  let view = cm.render();
  check("equip screen lists hero", view.items.some((i) => i.id === "member_hero"));

  // Hero slots.
  openEquipMember("hero");
  view = cm.render();
  check("slots screen lists weapon/armor/accessory", view.items.map((i) => i.id).join(",") === "slot_weapon,slot_armor,slot_accessory");
  check("empty slots say None", view.items.every((i) => i.hint === "None"));

  // Gear screen for weapon: class-restricted.
  cm.menu.select("slot_weapon");
  cm.menu.confirm();
  view = cm.render();
  const gear = view.items.map((i) => i.id);
  check("iron sword offered", gear.includes("gear_ironSword"));
  check("staff not offered to warrior", !gear.includes("gear_staff"));
  check("remove offered", gear.includes("gear_none"));
  const ironHint = view.items.find((i) => i.id === "gear_ironSword").hint;
  check("stat delta hint shown", typeof ironHint === "string" && ironHint.length > 0 && ironHint.includes("Atk"));

  // Equip the iron sword.
  cm.menu.select("gear_ironSword");
  cm.menu.confirm();
  check("iron sword equipped", hero.equipment.weapon === "ironSword");
  check("sword left inventory", inv.count("ironSword") === 0);
  check("stat delta applied", hero.getStats().atk === 8, "atk=" + hero.getStats().atk);
  check("message mentions equipped", (cm.lastMessage ?? "").includes("Equipped"));

  // Gear screen now reflects the equipped sword.
  view = cm.render();
  check("equipped sword no longer offered", !view.items.some((i) => i.id === "gear_ironSword"));
  check("remove still offered", view.items.some((i) => i.id === "gear_none"));
  cm.handleKey("Escape");
  view = cm.render();
  check("slot hint now shows sword", view.items.find((i) => i.id === "slot_weapon").hint === "Iron Sword");

  // Remove unequips and returns the item to inventory.
  cm.menu.select("slot_weapon");
  cm.menu.confirm();
  cm.menu.select("gear_none");
  cm.menu.confirm();
  check("sword unequipped", hero.equipment.weapon === null);
  check("sword returned to inventory", inv.count("ironSword") === 1);
  check("atk back to 0", hero.getStats().atk === 0);

  // Class-restriction: healer cannot wear plate, can wear robe.
  openEquipMember("healer");
  cm.menu.select("slot_armor");
  cm.menu.confirm();
  const armorGear = cm.render().items.map((i) => i.id);
  check("robe offered to healer", armorGear.includes("gear_robe"));
  check("plate NOT offered to healer", !armorGear.includes("gear_plate"));

  // Accessory slot: wayfarer charm (all classes).
  cm.handleKey("Escape");
  cm.menu.select("slot_accessory");
  cm.menu.confirm();
  check("wayfarer charm offered", cm.render().items.some((i) => i.id === "gear_wayfarerCharm"));

  // Consumables are never offered as gear.
  cm.handleKey("Escape");
  cm.menu.select("slot_weapon");
  cm.menu.confirm();
  check("consumables not offered as gear", !cm.render().items.some((i) => i.id === "gear_potion"));

  return out;
}
