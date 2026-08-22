// Validation tests for Task #173: the crafting engine.

import { CraftingSystem } from "../engine/crafting.js";
import { RECIPES } from "../data/recipes.js";
import { ITEMS } from "../data/items.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

function partyWith(gold) {
  const p = new PartyManager({ gold });
  p.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  return p;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = fakeState({});
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const party = partyWith(1000);
  const sys = new CraftingSystem(RECIPES, { inventory: inv, party, state });

  check("recipe lookup", sys.recipe("runeSabre")?.category === "weapon");
  check("categories listed", sys.categories().includes("weapon") && sys.categories().includes("consumable"));
  check("recipesFor filters", sys.recipesFor("weapon").length === 3);

  // Nothing craftable with an empty inventory.
  check("nothing craftable empty", sys.craftable().length === 0);
  check("missing lists shortages", sys.missing(sys.recipe("pearlCharm")).some((m) => m.item === "coralPearl" && m.have === 0));

  // Stock materials and craft a Pearl Charm (3 coralPearl, 120g).
  inv.add("coralPearl", 3);
  check("craftable now", sys.canCraft(sys.recipe("pearlCharm")).ok === true);
  const r1 = sys.craft("pearlCharm");
  check("craft succeeds", r1.ok === true && r1.result.item === "pearlCharm");
  check("materials consumed", inv.count("coralPearl") === 0);
  check("result added", inv.count("pearlCharm") === 1);
  check("gold charged", party.gold === 880);
  check("craft flag set", state.getFlag("crafted_pearlCharm") === true);
  check("not craftable twice without materials", sys.canCraft(sys.recipe("pearlCharm")).ok === false);

  // Craft a weapon: Rune Sabre (3 runeShard + 2 goblinFang, 200g).
  inv.add("runeShard", 3);
  inv.add("goblinFang", 2);
  const r2 = sys.craft("runeSabre");
  check("weapon crafted", r2.ok === true && inv.count("runeSabre") === 1);
  check("gold total 680", party.gold === 680);
  check("rune sabre is a real weapon", ITEMS.runeSabre?.type === "weapon" && ITEMS.runeSabre.mods.atk === 24);

  // Not enough gold.
  const poor = new CraftingSystem(RECIPES, { inventory: inv, party: partyWith(10) });
  inv.add("runeShard", 3);
  inv.add("goblinFang", 2);
  const before = inv.count("runeShard");
  const r3 = poor.craft("runeSabre");
  check("too poor to craft", r3.ok === false && r3.error === "not enough gold");
  check("no materials lost on failed craft", inv.count("runeShard") === before);

  // Full inventory blocks crafting.
  const tiny = new Inventory({ maxSlots: 0, maxWeight: 100 });
  tiny.add("coralPearl", 3);
  const sys2 = new CraftingSystem(RECIPES, { inventory: tiny, party: partyWith(1000) });
  check("full inventory blocks", sys2.canCraft(sys2.recipe("pearlCharm")).ok === false);

  // Consumable recipe produces a stack.
  const st = fakeState({});
  const inv3 = new Inventory();
  const sys3 = new CraftingSystem(RECIPES, { inventory: inv3, party: partyWith(1000), state: st });
  inv3.add("spiritEssence", 2);
  const r4 = sys3.craft("spiritEther");
  check("ether x2 crafted", r4.ok === true && inv3.count("ether") === 2);

  // Unknown recipe is safe.
  check("unknown recipe safe", sys.craft("bogus").ok === false && sys.recipe("bogus") === null);

  return out;
}
