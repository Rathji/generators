// Validation tests for Task #143: Equipment Set Bonuses — wearing a gear
// combination grants hidden stat bonuses.

import { GearSetBonusSystem } from "../engine/gear-sets.js";
import { GEAR_SETS } from "../data/gear-sets.js";
import { ITEMS } from "../data/items.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sets = new GearSetBonusSystem(GEAR_SETS, ITEMS);

  check("sets defined", sets.all().length >= 4);
  check("iron set exists", sets.set("iron_set")?.pieces.includes("ironSword") === true);

  const hero = new Character({ id: "h", name: "Hero", classId: "warrior" });
  check("no gear -> no bonuses", sets.activeBonuses(hero).length === 0 && Object.keys(sets.statMods(hero)).length === 0);

  // Half an Iron Set grants nothing.
  hero.equipment.weapon = "ironSword";
  check("one piece alone grants nothing", sets.activeBonuses(hero).length === 0);
  check("one-piece set not reported equipped bonus", sets.equipped(hero)[0]?.id === "iron_set");

  // Full Iron Set (ironSword + chain) grants +1 DEF.
  hero.equipment.armor = "chain";
  const active = sets.activeBonuses(hero);
  check("full iron set active", active.length === 1 && active[0].set.id === "iron_set" && active[0].tier === 2);
  check("iron set bonus +1 def", sets.statMods(hero).def === 1);
  const modded = sets.applyMods(hero, { def: 10, str: 5 });
  check("applyMods composes", modded.def === 11 && modded.str === 5);

  // Dwarven Set grants STR +2 / DEF +3.
  const dwarf = new Character({ id: "d", name: "Dwarf", classId: "warrior" });
  dwarf.equipment.weapon = "runeSabre";
  dwarf.equipment.armor = "runeCuirass";
  const dm = sets.statMods(dwarf);
  check("dwarven set mods", dm.str === 2 && dm.def === 3);

  // Wyrm Set has a 2-piece and a 3-piece tier — both stack at 3 pieces.
  const wyrm = new Character({ id: "w", name: "Wyrm", classId: "warrior" });
  wyrm.equipment.weapon = "wyrmEdge";
  wyrm.equipment.armor = "tideMail";
  const w2 = sets.statMods(wyrm);
  check("wyrm 2-piece bonus", w2.agi === 1 && w2.def === 2);
  wyrm.equipment.accessory = "pearlCharm";
  const w3 = sets.statMods(wyrm);
  check("wyrm 3-piece bonus stacks", w3.agi === 1 && w3.def === 2 && w3.hp === 20 && w3.mdef === 3);

  check("describe mentions set", sets.describe(hero).some((d) => d.includes("Iron Set")));

  // Audit of shipped data.
  check("sets audit clean", sets.audit().length === 0);
  const bad = new GearSetBonusSystem([{ id: "x", name: "X", pieces: ["nope", "chain"], bonuses: [{ count: 2, mods: { def: 1 } }] }], ITEMS);
  check("audit flags unknown piece", bad.audit().length === 1 && bad.audit()[0].error === "unknown piece nope");
  const badTier = new GearSetBonusSystem([{ id: "y", name: "Y", pieces: ["chain", "plate"], bonuses: [{ count: 3, mods: { def: 1 } }] }], ITEMS);
  check("audit flags over-limit tier", badTier.audit().some((r) => r.error === "bad tier count 3"));

  return out;
}
