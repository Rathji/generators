// Validation tests for Task #148: Frozen Caverns Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const frozen = ENCOUNTERS.frozen_upper;
  check("frozen_upper table defined", !!frozen);
  check("frozen_upper table has rate", typeof frozen.rate === "number" && frozen.rate > 0);
  check("frozen_upper table has groups", Array.isArray(frozen.table) && frozen.table.length >= 3);

  const missing = [];
  for (const entry of frozen.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("frozen_upper references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Difficulty: tougher than the sea arc, on par with the ember sanctum.
  const maxMonsterHp = (table) =>
    Math.max(...table.flatMap((e) => (ENEMY_GROUPS[e.group] ?? []).map((m) => ENEMIES[m.id].hp ?? 0)));
  const frozenTough = maxMonsterHp(frozen.table);
  const seaTough = maxMonsterHp(ENCOUNTERS.sea_shrine.table);
  const emberTough = maxMonsterHp(ENCOUNTERS.ember_sanctum.table);
  check("frozen monsters are tougher than sea shrine", frozenTough > seaTough, `frozen=${frozenTough} sea=${seaTough}`);
  check("frozen monsters are near ember tier", frozenTough >= emberTough, `frozen=${frozenTough} ember=${emberTough}`);

  // The cavern heart uses the dungeon_ice theme.
  const core = ENCOUNTERS.frozen_core;
  check("frozen_core uses ice theme", core && core.theme === "dungeon_ice");
  const theme = ENCOUNTERS.dungeon_ice;
  check("dungeon_ice theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Frozen monsters have stats/elements and all share the fire weakness
  // (ice-born flesh yields to flame).
  const ids = new Set();
  for (const g of [...frozen.table, ...theme.table].map((e) => e.group)) {
    for (const m of ENEMY_GROUPS[g] ?? []) ids.add(m.id);
  }
  for (const id of ids) {
    const e = ENEMIES[id];
    check("frozen monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("frozen monster has elements: " + id, e && e.elements && typeof e.elements === "object");
    check("frozen monster weak to fire: " + id, e && (e.elements.weak ?? []).includes("fire"));
  }

  return out;
}
