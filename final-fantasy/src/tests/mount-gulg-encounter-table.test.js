// Validation tests for Task #95: Mount Gulg Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const gulg = ENCOUNTERS.mount_gulg;
  check("mount_gulg table defined", !!gulg);
  check("mount_gulg table has rate", typeof gulg.rate === "number" && gulg.rate > 0);
  check("mount_gulg table has groups", Array.isArray(gulg.table) && gulg.table.length >= 3);

  const missing = [];
  for (const entry of gulg.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("mount_gulg references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Mid-to-late-game difficulty: tougher than the marsh cave.
  const avgHp = (group) => ENEMY_GROUPS[group].reduce((s, m) => s + (ENEMIES[m.id].hp ?? 0) * m.count, 0) / ENEMY_GROUPS[group].reduce((s, m) => s + m.count, 0);
  const gulgGroups = gulg.table.map((e) => e.group);
  const marshGroups = ENCOUNTERS.marsh_cave.table.map((e) => e.group);
  const gulgAvg = gulgGroups.reduce((s, g) => s + avgHp(g), 0) / gulgGroups.length;
  const marshAvg = marshGroups.reduce((s, g) => s + avgHp(g), 0) / marshGroups.length;
  check("mount_gulg monsters are tougher than marsh", gulgAvg > marshAvg, `gulg=${gulgAvg.toFixed(1)} marsh=${marshAvg.toFixed(1)}`);
  check("mount_gulg monsters have solid HP", gulgGroups.every((g) => avgHp(g) > 22));

  // Forge depths uses the dungeon_gulg theme.
  const b2 = ENCOUNTERS.mount_gulg_b2;
  check("forge depths uses gulg theme", b2 && b2.theme === "dungeon_gulg");
  const theme = ENCOUNTERS.dungeon_gulg;
  check("dungeon_gulg theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Gulg monsters have defined elements/xp/gold.
  const gulgMonsterIds = new Set();
  for (const g of [...gulgGroups, ...theme.table.map((e) => e.group)]) {
    for (const m of ENEMY_GROUPS[g] ?? []) gulgMonsterIds.add(m.id);
  }
  for (const id of gulgMonsterIds) {
    const e = ENEMIES[id];
    check("gulg monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("gulg monster has elements: " + id, e && e.elements && typeof e.elements === "object");
  }

  return out;
}
