// Validation tests for Task #114: Sea Shrine Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sea = ENCOUNTERS.sea_shrine;
  check("sea_shrine table defined", !!sea);
  check("sea_shrine table has rate", typeof sea.rate === "number" && sea.rate > 0);
  check("sea_shrine table has groups", Array.isArray(sea.table) && sea.table.length >= 3);

  const missing = [];
  for (const entry of sea.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("sea_shrine references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Mid-game difficulty: tougher than the gnome tunnels, weaker than the wind shrine.
  const maxMonsterHp = (table) =>
    Math.max(...table.flatMap((e) => (ENEMY_GROUPS[e.group] ?? []).map((m) => ENEMIES[m.id].hp ?? 0)));
  const seaGroups = sea.table.map((e) => e.group);
  const seaTough = maxMonsterHp(sea.table);
  const gnomeTough = maxMonsterHp(ENCOUNTERS.gnome_tunnels.table);
  const windTough = maxMonsterHp(ENCOUNTERS.wind_shrine.table);
  check("sea monsters are tougher than gnome tunnels", seaTough > gnomeTough, `sea=${seaTough} gnome=${gnomeTough}`);
  check("sea monsters are weaker than wind shrine", seaTough < windTough, `sea=${seaTough} wind=${windTough}`);
  check(
    "sea monsters have solid HP",
    seaGroups.every(
      (g) =>
        ENEMY_GROUPS[g].reduce((s, m) => s + (ENEMIES[m.id].hp ?? 0) * m.count, 0) /
          ENEMY_GROUPS[g].reduce((s, m) => s + m.count, 0) >
        40
    )
  );

  // Sunken Sanctum uses the dungeon_sea theme.
  const b2 = ENCOUNTERS.sea_shrine_b2;
  check("sunken sanctum uses sea theme", b2 && b2.theme === "dungeon_sea");
  const theme = ENCOUNTERS.dungeon_sea;
  check("dungeon_sea theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Sea monsters have defined elements/xp/gold and share the lightning
  // weakness (salt water yields to thunder).
  const ids = new Set();
  for (const g of [...seaGroups, ...theme.table.map((e) => e.group)]) {
    for (const m of ENEMY_GROUPS[g] ?? []) ids.add(m.id);
  }
  for (const id of ids) {
    const e = ENEMIES[id];
    check("sea monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("sea monster has elements: " + id, e && e.elements && typeof e.elements === "object");
    check("sea monster weak to lightning: " + id, e && (e.elements.weak ?? []).includes("lightning"));
  }

  return out;
}
