// Validation tests for Task #85: Cornelia Dungeon Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const cave = ENCOUNTERS.caves_of_cornelia;
  check("caves encounter table defined", !!cave);
  check("caves table has a rate", typeof cave.rate === "number" && cave.rate > 0);
  check("caves table has a min gap", typeof cave.minGap === "number");
  check("caves table has groups", Array.isArray(cave.table) && cave.table.length >= 3);

  // Every referenced group exists and every monster template exists.
  const missing = [];
  for (const entry of cave.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("caves table references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Lower level uses the dungeon_cave theme.
  const b2 = ENCOUNTERS.caves_of_cornelia_b2;
  check("lower level has a theme", b2 && b2.theme === "dungeon_cave");
  const theme = ENCOUNTERS[b2.theme];
  check("dungeon_cave theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    const group = ENEMY_GROUPS[entry.group];
    check("theme group exists: " + entry.group, !!group);
    if (group) {
      for (const m of group) check("theme monster exists: " + m.id, !!ENEMIES[m.id]);
    }
  }

  // The four cave groups give early-game-appropriate rewards.
  const earlyGroups = ["cave_pack", "cave_dwellers", "imp_pack", "goblin_brigade"];
  for (const g of earlyGroups) {
    check("early group exists: " + g, !!ENEMY_GROUPS[g]);
  }
  const totalXp = (group) => ENEMY_GROUPS[group].reduce((s, m) => s + (ENEMIES[m.id].xp ?? 0) * m.count, 0);
  check("cave groups are low-reward (early game)", earlyGroups.every((g) => totalXp(g) <= 130));

  return out;
}
