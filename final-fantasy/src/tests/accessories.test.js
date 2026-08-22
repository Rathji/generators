// Validation tests for Task #71: Accessory Slot System.

import { AccessorySystem } from "../engine/accessories.js";
import { EquipSystem, SLOTS } from "../engine/equipment.js";
import { StatusEffectSystem } from "../engine/status.js";
import { Character } from "../engine/character.js";
import { ITEMS } from "../data/items.js";

const CUSTOM_ITEMS = {
  ribbon: { id: "ribbon", name: "Ribbon", type: "accessory", slot: "accessory", mods: { mdef: 2 }, statusImmune: ["poison", "sleep"] },
  gauntlet: { id: "gauntlet", name: "Gauntlet", type: "accessory", slot: "accessory", mods: { atk: 5, str: 2 } },
  ring: { id: "ring", name: "Ring", type: "accessory", slot: "accessory", mods: { int: 3 } },
  sword: { id: "sword", name: "Sword", type: "weapon", slot: "weapon", mods: { atk: 8 } },
};

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new AccessorySystem(CUSTOM_ITEMS);
  const hero = new Character({ id: "h", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });

  check("accessory slot exists", SLOTS.includes("accessory"));
  check("canEquip accessory", sys.canEquip(hero, "ribbon"));
  check("weapon is not an accessory", !sys.canEquip(hero, "sword"));
  check("no accessory by default", sys.accessory(hero) === null);
  check("mods empty by default", Object.keys(sys.mods(hero)).length === 0);

  hero.equipment.accessory = "gauntlet";
  const acc = sys.accessory(hero);
  check("equipped accessory readable", acc?.id === "gauntlet");
  const mods = sys.mods(hero);
  check("stat buffs from accessory", mods.atk === 5 && mods.str === 2);
  check("no status immunities from gauntlet", sys.statusImmunities(hero).length === 0);

  hero.equipment.accessory = "ribbon";
  check("ribbon grants status immunities", sys.statusImmunities(hero).includes("poison") && sys.statusImmunities(hero).includes("sleep"));
  check("immunityFor true for ribbon status", sys.immunityFor(hero, "poison") === true);
  check("immunityFor false for others", sys.immunityFor(hero, "stone") === false);

  // Integration: status system immunity hook (Ribbon blocks status affliction).
  const status = new StatusEffectSystem({ immunityHook: (t, s) => sys.immunityFor(t, s) });
  const wearer = new Character({ id: "w", name: "Wearer", classId: "warrior" });
  wearer.equipment.accessory = "ribbon";
  const bare = new Character({ id: "b", name: "Bare", classId: "warrior" });
  const r1 = status.apply(wearer, "poison", { chance: 1 });
  const r2 = status.apply(bare, "poison", { chance: 1 });
  check("ribbon wearer immune to poison", r1.ok === false && r1.error === "immune");
  check("unprotected character still afflicted", r2.ok === true && status.has(bare, "poison"));

  // EquipSystem handles the accessory slot end-to-end.
  const inv = { _items: { ribbon: 1, gauntlet: 1 }, has: (id) => !!this._items?.[id] };
  const inv2 = { has: (id) => id === "ribbon", remove: (id) => { inv2.gone = id; return true; }, add: () => true };
  const eq = new EquipSystem(inv2);
  const char2 = new Character({ id: "c", name: "C", classId: "warrior" });
  const e1 = eq.equip(char2, "ribbon");
  check("equip accessory via EquipSystem", e1.ok === true && char2.equipment.accessory === "ribbon");
  const e2 = eq.unequip(char2, "accessory");
  check("unequip accessory", e2.ok === true && char2.equipment.accessory === null);

  // describe produces a readable line.
  const wearer2 = new Character({ id: "x", name: "X", classId: "warrior" });
  wearer2.equipment.accessory = "ribbon";
  const desc = sys.describe(wearer2);
  check("describe mentions accessory", typeof desc === "string" && desc.includes("Ribbon"));

  // Real item database includes accessory items.
  const realSys = new AccessorySystem(ITEMS);
  const realAccs = Object.values(ITEMS).filter((i) => i.type === "accessory");
  check("real item db has accessory items", realAccs.length >= 4);
  check("real ribbon blocks poison+sleep+paralysis+stone", realAccs.find((i) => i.id === "ribbon")?.statusImmune?.length === 4);

  return out;
}
