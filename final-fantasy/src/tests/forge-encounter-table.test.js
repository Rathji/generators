// Validation tests for Task #138: Dwarven Forge Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const forge = ENCOUNTERS.forge_upper;
  check("forge_upper table defined", !!forge);
  check("forge_upper table has rate", typeof forge.rate === "number" && forge.rate > 0);
  check("forge_upper table has groups", Array.isArray(forge.table) && forge.table.length >= 3);

  const missing = [];
  for (const entry of forge.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("forge_upper references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Difficulty: tougher than the sea arc, on par with the ember sanctum.
  const maxMonsterHp = (table) =>
    Math.max(...table.flatMap((e) => (ENEMY_GROUPS[e.group] ?? []).map((m) => ENEMIES[m.id].hp ?? 0)));
  const forgeTough = maxMonsterHp(forge.table);
  const seaTough = maxMonsterHp(ENCOUNTERS.sea_shrine.table);
  const emberTough = maxMonsterHp(ENCOUNTERS.ember_sanctum.table);
  check("forge monsters are tougher than sea shrine", forgeTough > seaTough, `forge=${forgeTough} sea=${seaTough}`);
  check("forge monsters are near ember tier", forgeTough >= emberTough - 5, `forge=${forgeTough} ember=${emberTough}`);

  // The forge heart uses the dungeon_forge theme.
  const core = ENCOUNTERS.forge_core;
  check("forge_core uses forge theme", core && core.theme === "dungeon_forge");
  const theme = ENCOUNTERS.dungeon_forge;
  check("dungeon_forge theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Forge monsters have stats/elements and all share the lightning weakness
  // (metal and stone are conductors under thunder).
  const ids = new Set();
  for (const g of [...forge.table, ...theme.table].map((e) => e.group)) {
    for (const m of ENEMY_GROUPS[g] ?? []) ids.add(m.id);
  }
  for (const id of ids) {
    const e = ENEMIES[id];
    check("forge monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("forge monster has elements: " + id, e && e.elements && typeof e.elements === "object");
    check("forge monster weak to lightning: " + id, e && (e.elements.weak ?? []).includes("lightning"));
  }

  return out;
}
