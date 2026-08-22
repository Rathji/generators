// Validation tests for Task #148: Dynamic Lighting/Darkness Zones — dark
// maps need a light source (lantern item, Light spell, Luminary) to see.

import { LightingSystem } from "../engine/lighting.js";
import { DARK_MAPS, LIGHT_ITEMS, LIGHT_SPELL, LIGHT_WEAPONS } from "../data/lighting.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { SPELLS } from "../data/spells.js";
import { CLASSES } from "../data/classes.js";
import { MapManager } from "../engine/transitions.js";
import { MAPS } from "../data/maps.js";

function registry() {
  const m = new MapManager();
  for (const d of MAPS) m.register(d);
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const inventory = new Inventory();
  const healer = new Character({ id: "healer", name: "Healer", classId: "whiteMage", level: 1 });
  const party = { members: [healer] };
  const light = new LightingSystem(DARK_MAPS, {
    state,
    party,
    inventory,
    lightItems: LIGHT_ITEMS,
    lightSpell: LIGHT_SPELL,
    lightWeapons: LIGHT_WEAPONS,
  });

  check("dark maps include the lighthouse", light.isDark("lighthouse") === true);
  check("overworld stays lit", light.isDark("overworld") === false && light.canSee("overworld", 3, 3, 5, 5) === true);

  check("no light yet", light.hasLight() === false);
  check("cannot see in the dark without light", light.canSee("lighthouse", 4, 4, 5, 5) === false);
  check("describe reports blindness", light.describe("lighthouse").includes("Pitch darkness"));

  // Lantern item grants light with a radius.
  inventory.add("lantern", 1);
  check("lantern is a light source", light.hasLight() === true);
  check("lit radius 2 sees nearby tiles", light.canSee("lighthouse", 5, 3, 5, 5) === true);
  check("beyond the radius stays unseen", light.canSee("lighthouse", 9, 9, 5, 5) === false);

  // The Light spell (white mage level 3) also lights the way.
  const inventory2 = new Inventory();
  const wm3 = new Character({ id: "wm3", name: "Mage3", classId: "whiteMage", level: 3 });
  const l2 = new LightingSystem(DARK_MAPS, { state, party: { members: [wm3] }, inventory: inventory2 });
  check("white mage learns light by level 3", CLASSES.whiteMage.spells.some((s) => s.spell === "light" && s.lvl === 3));
  check("light spell exists in the spellbook", SPELLS.light?.kind === "utility" && SPELLS.light.target === "self");
  check("light spell knowledge lights the dark", wm3.knowsSpell("light") && l2.hasLight() === true);

  // The Luminary blade is a light source too.
  const inventory3 = new Inventory();
  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  warrior.equipment.weapon = "luminary";
  const l3 = new LightingSystem(DARK_MAPS, { state, party: { members: [warrior] }, inventory: inventory3 });
  check("luminary blade sheds light", l3.hasLight() === true);

  // Manual torch flag (demo toggle) works with the lantern covered up.
  inventory.remove("lantern", 1);
  check("removing the lantern darkens again", light.hasLight() === false);
  light.toggleTorch();
  check("torch flag grants light", light.hasLight() === true && state.getFlag("light_torch") === true);
  light.toggleTorch();
  check("torch can be re-shrouded", light.hasLight() === false);

  check("every dark map exists", light.audit(registry()).length === 0);

  return out;
}
