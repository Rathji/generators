// Task #173: the Artificer's Forge — crafting engine. A recipe consumes its
// ingredients (plus a gold fee) from the party and yields its result item.
// All validation is exposed so UIs can gray out uncraftable recipes.

import { ITEMS } from "../data/items.js";

export class CraftingSystem {
  constructor(recipes = [], opts = {}) {
    this.recipes = recipes;
    this.inventory = opts.inventory ?? null;
    this.party = opts.party ?? null;
    this.state = opts.state ?? null;
  }

  all() {
    return [...this.recipes];
  }

  recipe(id) {
    return this.recipes.find((r) => r.id === id) ?? null;
  }

  recipesFor(category) {
    return this.recipes.filter((r) => r.category === category);
  }

  categories() {
    return [...new Set(this.recipes.map((r) => r.category))];
  }

  // Missing ingredient amounts: { itemId, needed, have }.
  missing(recipe) {
    if (!recipe || !this.inventory) return [];
    return recipe.ingredients
      .map((ing) => ({
        item: ing.item,
        needed: ing.count,
        have: this.inventory.count(ing.item),
        name: ITEMS[ing.item]?.name ?? ing.item,
      }))
      .filter((m) => m.have < m.needed);
  }

  goldCost(recipe) {
    return recipe?.goldCost ?? 0;
  }

  canAfford(recipe) {
    const cost = this.goldCost(recipe);
    return cost === 0 || !!this.party && this.party.gold >= cost;
  }

  canCraft(recipe) {
    if (!recipe) return { ok: false, error: "unknown recipe" };
    if (!this.inventory) return { ok: false, error: "no inventory" };
    if (this.missing(recipe).length > 0) return { ok: false, error: "missing ingredients" };
    if (!this.canAfford(recipe)) return { ok: false, error: "not enough gold" };
    if (!this.inventory.canAdd(recipe.result.item, recipe.result.count ?? 1)) {
      return { ok: false, error: "inventory full" };
    }
    return { ok: true };
  }

  craft(recipeId) {
    const r = this.recipe(recipeId);
    const ready = this.canCraft(r);
    if (!ready.ok) return { ok: false, error: ready.error };
    for (const ing of r.ingredients) this.inventory.remove(ing.item, ing.count);
    const cost = this.goldCost(r);
    if (cost > 0 && this.party) {
      if (!this.party.spendGold(cost)) {
        for (const ing of r.ingredients) this.inventory.add(ing.item, ing.count);
        return { ok: false, error: "not enough gold" };
      }
    }
    this.inventory.add(r.result.item, r.result.count ?? 1);
    if (this.state?.setFlag) this.state.setFlag("crafted_" + recipeId, true);
    return { ok: true, id: recipeId, result: r.result, goldCost: cost, recipe: r };
  }

  // Every recipe the player could craft right now.
  craftable() {
    return this.recipes.filter((r) => this.canCraft(r).ok);
  }

  progressReport(recipeId) {
    const r = this.recipe(recipeId);
    return {
      id: recipeId,
      name: r?.name ?? null,
      category: r?.category ?? null,
      goldCost: this.goldCost(r),
      missing: r ? this.missing(r) : [],
      craftable: r ? this.canCraft(r).ok : false,
      made: this.state?.getFlag ? !!this.state.getFlag("crafted_" + recipeId) : false,
    };
  }
}
