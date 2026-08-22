// Validation tests for Task #43: Equipment Stat Modifier Logic.

import { EquipmentStatSystem, equipmentFlatMods, equipmentPctMods } from "../engine/equip-stats.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new EquipmentStatSystem();
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });

  const bare = sys.derive(hero);
  check("bare attack is base STR", bare.attack === 12);
  check("bare magic attack is base INT", bare.magicAttack === 4);

  hero.equipment.weapon = "ironSword"; // +8 ATK
  const sword = sys.derive(hero);
  check("sword +8 -> attack +8", sword.attack === 20);
  check("flat mods picked up", equipmentFlatMods(hero).atk === 8);

  hero.equipment.weapon = "mythrilSword"; // +13 ATK, +5% STR
  const mythril = sys.derive(hero);
  check("pct mod applies to base", mythril.attack === Math.floor(12 * 1.05) + 13);
  check("pct mods picked up", equipmentPctMods(hero).strPct === 0.05);

  hero.equipment.weapon = null;
  hero.equipment.armor = "plate"; // +12 DEF, +5% DEF
  const armored = sys.derive(hero);
  check("plate def applied", armored.defense === Math.floor(8 * 1.05) + 12);
  check("mdef unchanged by plate", armored.magicDefense === 2);

  mage.equipment.weapon = "staff"; // +2 ATK, +2 INT, +3 MATK
  const staff = sys.derive(mage);
  check("staff magic attack", staff.magicAttack === 15);
  check("staff int mod", staff.int === 14);

  hero.equipment.armor = null;
  check("describe lists gear", (() => {
    hero.equipment.weapon = "ironSword";
    const lines = sys.describe(hero);
    return lines.length === 1 && lines[0].includes("Iron Sword") && lines[0].includes("+8 ATK");
  })());

  hero.equipment.weapon = "dagger"; // +3 ATK
  hero.equipment.armor = "cloth"; // +2 DEF
  const summary = sys.modsSummary(hero);
  check("mods summary per slot", summary.length === 2 && summary.some((m) => m.slot === "weapon") && summary.some((m) => m.slot === "armor"));
  const totals = sys.totalMods(hero);
  check("total mods aggregation", totals.count === 2 && totals.flat.atk === 3 && totals.flat.def === 2);

  const empty = sys.totalMods(new Character({ id: "x", name: "X", classId: "monk" }));
  check("no gear -> zero mods", empty.count === 0 && empty.flat.atk === undefined);

  return out;
}
