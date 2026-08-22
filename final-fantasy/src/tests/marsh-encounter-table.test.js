// Validation tests for Task #90: Marsh Cave Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const marsh = ENCOUNTERS.marsh_cave;
  check("marsh table defined", !!marsh);
  check("marsh table has rate", typeof marsh.rate === "number" && marsh.rate > 0);
  check("marsh table has groups", Array.isArray(marsh.table) && marsh.table.length >= 3);

  const missing = [];
  for (const entry of marsh.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("marsh table references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Mid-game difficulty: HP higher than the caves.
  const avgHp = (group) => ENEMY_GROUPS[group].reduce((s, m) => s + (ENEMIES[m.id].hp ?? 0) * m.count, 0) / ENEMY_GROUPS[group].reduce((s, m) => s + m.count, 0);
  const marshGroups = marsh.table.map((e) => e.group);
  check("marsh monsters are tougher than cave goblins", marshGroups.every((g) => avgHp(g) > 18));

  // Depths uses the dungeon_marsh theme.
  const b2 = ENCOUNTERS.marsh_cave_b2;
  check("depths uses marsh theme", b2 && b2.theme === "dungeon_marsh");
  const theme = ENCOUNTERS.dungeon_marsh;
  check("dungeon_marsh theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Marsh monsters have defined elements/xp/gold.
  const marshMonsterIds = new Set();
  for (const g of [...marshGroups, ...theme.table.map((e) => e.group)]) {
    for (const m of ENEMY_GROUPS[g] ?? []) marshMonsterIds.add(m.id);
  }
  for (const id of marshMonsterIds) {
    const e = ENEMIES[id];
    check("marsh monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("marsh monster has elements: " + id, e && e.elements && typeof e.elements === "object");
  }

  return out;
}
