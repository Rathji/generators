// Validation tests for Task #172: the Artificer's recipes.

import { RECIPES } from "../data/recipes.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("recipes populated", RECIPES.length === 11);
  check("ids unique", new Set(RECIPES.map((r) => r.id)).size === RECIPES.length);

  const categories = ["consumable", "weapon", "armor", "accessory"];
  const typeForCat = { consumable: "consumable", weapon: "weapon", armor: "armor", accessory: "accessory" };
  const madeItems = {};
  for (const r of RECIPES) {
    check(r.id + " category valid", categories.includes(r.category));
    check(r.id + " has name+description", typeof r.name === "string" && typeof r.description === "string");
    check(r.id + " has ingredients", Array.isArray(r.ingredients) && r.ingredients.length >= 1);
    for (const ing of r.ingredients) {
      check(r.id + " ingredient exists: " + ing.item, !!ITEMS[ing.item]);
      check(r.id + " ingredient count positive", (ing.count ?? 0) >= 1);
    }
    check(r.id + " result exists", !!ITEMS[r.result.item]);
    check(r.id + " result count positive", (r.result.count ?? 0) >= 1);
    check(r.id + " result type matches category", ITEMS[r.result.item]?.type === typeForCat[r.category]);
    check(r.id + " result is not an ingredient", !r.ingredients.some((i) => i.item === r.result.item));
    check(r.id + " gold cost sane", typeof r.goldCost === "number" && r.goldCost >= 0);
    madeItems[r.result.item] = (madeItems[r.result.item] ?? 0) + 1;
  }

  // Every crafted equipment piece has exactly one recipe.
  const crafted = ["runeSabre", "wyrmEdge", "voidBrand", "runeCuirass", "tideMail", "frostCloak", "emberSigil", "pearlCharm"];
  for (const id of crafted) {
    check(id + " craftable exactly once", madeItems[id] === 1, String(madeItems[id]));
    check(id + " item exists", !!ITEMS[id]);
  }

  // Equipment recipes use at least one material.
  for (const r of RECIPES) {
    if (r.category === "consumable") continue;
    check(r.id + " ingredients include a material", r.ingredients.some((i) => ITEMS[i.item]?.type === "material"));
  }

  return out;
}
