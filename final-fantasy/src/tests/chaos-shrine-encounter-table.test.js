// Validation tests for Task #98: Chaos Shrine Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const shrine = ENCOUNTERS.chaos_shrine;
  check("chaos_shrine table defined", !!shrine);
  check("chaos_shrine table has rate", typeof shrine.rate === "number" && shrine.rate > 0);
  check("chaos_shrine table has groups", Array.isArray(shrine.table) && shrine.table.length >= 3);

  const missing = [];
  for (const entry of shrine.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("chaos_shrine references valid groups/monsters", missing.length === 0, missing.join(", "));

  // End-game difficulty: tougher than Mount Gulg.
  const avgHp = (group) => ENEMY_GROUPS[group].reduce((s, m) => s + (ENEMIES[m.id].hp ?? 0) * m.count, 0) / ENEMY_GROUPS[group].reduce((s, m) => s + m.count, 0);
  const shrineGroups = shrine.table.map((e) => e.group);
  const gulgGroups = ENCOUNTERS.mount_gulg.table.map((e) => e.group);
  const shrineAvg = shrineGroups.reduce((s, g) => s + avgHp(g), 0) / shrineGroups.length;
  const gulgAvg = gulgGroups.reduce((s, g) => s + avgHp(g), 0) / gulgGroups.length;
  check("chaos monsters are tougher than gulg", shrineAvg > gulgAvg, `shrine=${shrineAvg.toFixed(1)} gulg=${gulgAvg.toFixed(1)}`);
  check("chaos monsters have solid HP", shrineGroups.every((g) => avgHp(g) > 30));

  // Dark Altar uses the dungeon_chaos theme.
  const b2 = ENCOUNTERS.chaos_shrine_b2;
  check("dark altar uses chaos theme", b2 && b2.theme === "dungeon_chaos");
  const theme = ENCOUNTERS.dungeon_chaos;
  check("dungeon_chaos theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Chaos monsters have defined elements/xp/gold.
  const chaosMonsterIds = new Set();
  for (const g of [...shrineGroups, ...theme.table.map((e) => e.group)]) {
    for (const m of ENEMY_GROUPS[g] ?? []) chaosMonsterIds.add(m.id);
  }
  for (const id of chaosMonsterIds) {
    const e = ENEMIES[id];
    check("chaos monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("chaos monster has elements: " + id, e && e.elements && typeof e.elements === "object");
    // The final dungeon's fiends all bear the holy weakness.
    check("chaos monster weak to holy: " + id, e && Array.isArray(e.elements.weak) && e.elements.weak.includes("holy"));
  }

  return out;
}
