// Validation tests for Task #158: Labyrinth of Time Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const rift = ENCOUNTERS.time_rift;
  check("time_rift table defined", !!rift);
  check("time_rift table has rate", typeof rift.rate === "number" && rift.rate > 0);
  check("time_rift table has groups", Array.isArray(rift.table) && rift.table.length >= 3);

  const missing = [];
  for (const entry of rift.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("time_rift references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Difficulty: the realm's toughest regular monsters — above the glacier
  // and ember arcs.
  const maxMonsterHp = (table) =>
    Math.max(...table.flatMap((e) => (ENEMY_GROUPS[e.group] ?? []).map((m) => ENEMIES[m.id].hp ?? 0)));
  const riftTough = maxMonsterHp(rift.table);
  const frozenTough = maxMonsterHp(ENCOUNTERS.frozen_upper.table);
  const emberTough = maxMonsterHp(ENCOUNTERS.ember_sanctum.table);
  check("time monsters are tougher than the frozen caverns", riftTough > frozenTough, `rift=${riftTough} frozen=${frozenTough}`);
  check("time monsters are tougher than the ember sanctum", riftTough > emberTough, `rift=${riftTough} ember=${emberTough}`);

  // The deeper levels use the dungeon_time theme.
  for (const id of ["time_labyrinth", "chrono_throne"]) {
    const def = ENCOUNTERS[id];
    check(id + " uses time theme", def && def.theme === "dungeon_time");
  }
  const theme = ENCOUNTERS.dungeon_time;
  check("dungeon_time theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Time monsters have stats/elements and all share the holy weakness
  // (time-torn flesh unmade by the crystals' light).
  const ids = new Set();
  for (const g of [...rift.table, ...theme.table].map((e) => e.group)) {
    for (const m of ENEMY_GROUPS[g] ?? []) ids.add(m.id);
  }
  for (const id of ids) {
    const e = ENEMIES[id];
    check("time monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("time monster has elements: " + id, e && e.elements && typeof e.elements === "object");
    check("time monster weak to holy: " + id, e && (e.elements.weak ?? []).includes("holy"));
  }

  return out;
}
