// Validation tests for Task #107: Wind Shrine Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const wind = ENCOUNTERS.wind_shrine;
  check("wind_shrine table defined", !!wind);
  check("wind_shrine table has rate", typeof wind.rate === "number" && wind.rate > 0);
  check("wind_shrine table has groups", Array.isArray(wind.table) && wind.table.length >= 3);

  const missing = [];
  for (const entry of wind.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("wind_shrine references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Post-game difficulty: tougher than the Chaos Shrine.
  const maxMonsterHp = (table) =>
    Math.max(...table.flatMap((e) => (ENEMY_GROUPS[e.group] ?? []).map((m) => ENEMIES[m.id].hp ?? 0)));
  const windGroups = wind.table.map((e) => e.group);
  const windTough = maxMonsterHp(wind.table);
  const chaosTough = maxMonsterHp(ENCOUNTERS.chaos_shrine.table);
  const gulgTough = maxMonsterHp(ENCOUNTERS.mount_gulg.table);
  check("wind monsters are tougher than chaos", windTough > chaosTough, `wind=${windTough} chaos=${chaosTough}`);
  check("wind monsters are tougher than gulg", windTough > gulgTough, `wind=${windTough} gulg=${gulgTough}`);
  check(
    "wind monsters have solid HP",
    windGroups.every(
      (g) =>
        ENEMY_GROUPS[g].reduce((s, m) => s + (ENEMIES[m.id].hp ?? 0) * m.count, 0) /
          ENEMY_GROUPS[g].reduce((s, m) => s + m.count, 0) >
        60
    )
  );

  // Sky Altar uses the dungeon_wind theme.
  const b2 = ENCOUNTERS.wind_shrine_b2;
  check("sky altar uses wind theme", b2 && b2.theme === "dungeon_wind");
  const theme = ENCOUNTERS.dungeon_wind;
  check("dungeon_wind theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Wind monsters have defined elements/xp/gold and share the lightning
  // weakness (storms yield to thunder).
  const ids = new Set();
  for (const g of [...windGroups, ...theme.table.map((e) => e.group)]) {
    for (const m of ENEMY_GROUPS[g] ?? []) ids.add(m.id);
  }
  for (const id of ids) {
    const e = ENEMIES[id];
    check("wind monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("wind monster has elements: " + id, e && e.elements && typeof e.elements === "object");
    check("wind monster weak to lightning: " + id, e && (e.elements.weak ?? []).includes("lightning"));
  }

  return out;
}
