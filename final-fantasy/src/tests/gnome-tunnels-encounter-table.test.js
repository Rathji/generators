// Validation tests for Task #103: Gnome Tunnels Encounter Table.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const gnome = ENCOUNTERS.gnome_tunnels;
  check("gnome_tunnels table defined", !!gnome);
  check("gnome_tunnels table has rate", typeof gnome.rate === "number" && gnome.rate > 0);
  check("gnome_tunnels table has groups", Array.isArray(gnome.table) && gnome.table.length >= 3);

  const missing = [];
  for (const entry of gnome.table) {
    const group = ENEMY_GROUPS[entry.group];
    if (!group) {
      missing.push("missing group " + entry.group);
      continue;
    }
    for (const m of group) {
      if (!ENEMIES[m.id]) missing.push("missing monster " + m.id);
    }
  }
  check("gnome_tunnels references valid groups/monsters", missing.length === 0, missing.join(", "));

  // Mid-game difficulty: tougher than the marsh, weaker than Mount Gulg.
  // (Compare each dungeon's single toughest regular monster — group averages
  // are dragged around by fodder like goblins.)
  const maxMonsterHp = (table) =>
    Math.max(...table.flatMap((e) => (ENEMY_GROUPS[e.group] ?? []).map((m) => ENEMIES[m.id].hp ?? 0)));
  const gnomeGroups = gnome.table.map((e) => e.group);
  const gnomeTough = maxMonsterHp(gnome.table);
  const marshTough = maxMonsterHp(ENCOUNTERS.marsh_cave.table);
  const gulgTough = maxMonsterHp(ENCOUNTERS.mount_gulg.table);
  check("gnome monsters are tougher than marsh", gnomeTough > marshTough, `gnome=${gnomeTough} marsh=${marshTough}`);
  check("gnome monsters are weaker than gulg", gnomeTough < gulgTough, `gnome=${gnomeTough} gulg=${gulgTough}`);
  check("gnome monsters have solid HP", gnomeGroups.every((g) => (ENEMY_GROUPS[g].reduce((s, m) => s + (ENEMIES[m.id].hp ?? 0) * m.count, 0) / ENEMY_GROUPS[g].reduce((s, m) => s + m.count, 0)) > 22));

  // Engine Vault uses the dungeon_gnome theme.
  const b2 = ENCOUNTERS.gnome_tunnels_b2;
  check("engine vault uses gnome theme", b2 && b2.theme === "dungeon_gnome");
  const theme = ENCOUNTERS.dungeon_gnome;
  check("dungeon_gnome theme table exists", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Gnome monsters have defined elements/xp/gold and share the lightning
  // weakness (machines and gears).
  const ids = new Set();
  for (const g of [...gnomeGroups, ...theme.table.map((e) => e.group)]) {
    for (const m of ENEMY_GROUPS[g] ?? []) ids.add(m.id);
  }
  for (const id of ids) {
    const e = ENEMIES[id];
    check("gnome monster statted: " + id, e && typeof e.hp === "number" && typeof e.xp === "number" && typeof e.gold === "number");
    check("gnome monster has elements: " + id, e && e.elements && typeof e.elements === "object");
    check("gnome monster weak to lightning: " + id, e && (e.elements.weak ?? []).includes("lightning"));
  }

  return out;
}
