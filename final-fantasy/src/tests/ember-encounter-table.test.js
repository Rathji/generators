// Validation tests for Task #128: Ember Sanctum Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ember = ENCOUNTERS.ember_sanctum;
  check("ember_sanctum table defined", !!ember);
  check("ember_sanctum table has rate", typeof ember.rate === "number" && ember.rate > 0);
  check("ember_sanctum table has groups", Array.isArray(ember.table) && ember.table.length >= 3);

  const missing = [];
  for (const entry of ember.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("ember_sanctum references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Difficulty: the toughest tier yet — harder than the sea arc, and the
  // Molten Core theme edges out the other dungeon themes.
  const maxMonsterHp = (table) =>
    Math.max(...table.flatMap((e) => (ENEMY_GROUPS[e.group] ?? []).map((m) => ENEMIES[m.id].hp ?? 0)));
  const emberTough = maxMonsterHp(ember.table);
  const seaTough = maxMonsterHp(ENCOUNTERS.sea_shrine.table);
  const phantomTough = maxMonsterHp(ENCOUNTERS.lighthouse.table);
  check("ember monsters are tougher than sea shrine", emberTough > seaTough, `ember=${emberTough} sea=${seaTough}`);
  check("ember monsters are tougher than lighthouse", emberTough > phantomTough, `ember=${emberTough} lighthouse=${phantomTough}`);

  // Magma Halls and Molten Core use the dungeon_ember theme.
  for (const id of ["ember_sanctum_b2", "ember_sanctum_core"]) {
    const def = ENCOUNTERS[id];
    check(id + " uses ember theme", def && def.theme === "dungeon_ember");
  }
  const theme = ENCOUNTERS.dungeon_ember;
  check("dungeon_ember theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Ember monsters have stats/elements and all share the ice weakness
  // (volcanic flesh is shattered by frost).
  const ids = new Set();
  for (const g of [...ember.table, ...theme.table].map((e) => e.group)) {
    for (const m of ENEMY_GROUPS[g] ?? []) ids.add(m.id);
  }
  for (const id of ids) {
    const e = ENEMIES[id];
    check("ember monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("ember monster has elements: " + id, e && e.elements && typeof e.elements === "object");
    check("ember monster weak to ice: " + id, e && (e.elements.weak ?? []).includes("ice"));
    check("ember monster resists fire: " + id, e && (e.elements.resist ?? []).includes("fire"));
  }

  return out;
}
