// Validation tests for Task #175: enchant data.

import { ENCHANTS } from "../data/enchants.js";
import { ITEMS } from "../data/items.js";
import { FLAT_MOD_KEYS } from "../engine/equip-stats.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("five enchantments", ENCHANTS.length === 5);
  check("ids unique", new Set(ENCHANTS.map((e) => e.id)).size === ENCHANTS.length);
  for (const e of ENCHANTS) {
    check(e.id + " name", typeof e.name === "string" && e.name.length > 0);
    check(e.id + " gem exists", !!ITEMS[e.gem]);
    check(e.id + " gem is a material", ITEMS[e.gem]?.type === "material");
    check(e.id + " gold cost sane", typeof e.goldCost === "number" && e.goldCost > 0);
    check(e.id + " has mods", typeof e.mods === "object" && Object.keys(e.mods).length >= 1);
    for (const key of Object.keys(e.mods)) {
      check(e.id + " mod " + key + " is a flat stat", FLAT_MOD_KEYS.includes(key));
      check(e.id + " mod " + key + " positive", e.mods[key] > 0);
    }
    check(e.id + " has description", typeof e.description === "string");
  }

  // Every gem maps to exactly one enchantment.
  const gemCounts = {};
  for (const e of ENCHANTS) gemCounts[e.gem] = (gemCounts[e.gem] ?? 0) + 1;
  check("gems unique to enchantments", Object.values(gemCounts).every((c) => c === 1));

  return out;
}
