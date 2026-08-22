// Validation tests for Task #175: Ice Cave Encounter Table — the frozen
// depths' monster groups and the cold-hearted beasts that fill them.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { ELEMENTS } from "../data/elements.js";
import { ITEMS } from "../data/items.js";
import { SPELLS } from "../data/spells.js";
import { EncounterGenerator } from "../engine/encounters.js";

const ICE_MONSTERS = ["iceBat", "snowWolf", "crystalWisp", "frostWraith"];
const ICE_GROUPS = ["ice_cave_pack", "crystal_swarm", "wraith_cabal", "ice_pack", "ice_wardens"];

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // The upper cave rolls its own table; the chamber uses the shared theme.
  const upper = ENCOUNTERS.ice_cave_upper;
  check("ice cave upper table defined", !!upper);
  check("ice cave upper has a rate", upper && typeof upper.rate === "number" && upper.rate > 0);
  check("ice cave upper has a min gap", upper && typeof upper.minGap === "number");
  check("ice cave upper references groups", upper && Array.isArray(upper.table) && upper.table.length >= 4);
  check("ice cave b2 uses the ice-cave theme", ENCOUNTERS.ice_cave_b2 && ENCOUNTERS.ice_cave_b2.theme === "dungeon_ice_cave");
  const theme = ENCOUNTERS.dungeon_ice_cave;
  check("dungeon_ice_cave theme table defined", !!theme && Array.isArray(theme.table));
  for (const entry of theme.table) {
    check("theme group exists: " + entry.group, !!ENEMY_GROUPS[entry.group]);
  }

  // Every monster the tables can spawn exists.
  const tableGroups = new Set([
    ...(upper?.table ?? []).map((e) => e.group),
    ...(theme?.table ?? []).map((e) => e.group),
  ]);
  for (const g of tableGroups) {
    for (const member of ENEMY_GROUPS[g] ?? []) {
      check("spawnable monster exists: " + member.id, !!ENEMIES[member.id]);
    }
  }

  // The ice-cave monsters: cold-blooded, fire-fearing, with real loot.
  for (const id of ICE_MONSTERS) {
    const m = ENEMIES[id];
    check("ice monster exists: " + id, !!m);
    if (!m) continue;
    const els = [...(m.elements?.weak ?? []), ...(m.elements?.resist ?? [])];
    check("ice monster elements valid: " + id, els.every((e) => ELEMENTS.includes(e)));
    check("ice monster fears fire: " + id, (m.elements?.weak ?? []).includes("fire"));
    check("ice monster resists ice: " + id, (m.elements?.resist ?? []).includes("ice"));
    for (const l of m.loot ?? []) {
      check("ice monster loot exists: " + id + " -> " + l.itemId, !!ITEMS[l.itemId]);
    }
    for (const s of m.ai?.spells ?? []) {
      check("ice monster spell exists: " + id + " -> " + s, !!SPELLS[s]);
      check("ice monster spell is ice-typed: " + id + " -> " + s, SPELLS[s] && SPELLS[s].element === "ice");
    }
  }

  // The ice-cave groups reference only existing monsters.
  for (const g of ICE_GROUPS) {
    check("ice group exists: " + g, !!ENEMY_GROUPS[g]);
    for (const member of ENEMY_GROUPS[g] ?? []) {
      check("ice group member exists: " + g + " -> " + member.id, !!ENEMIES[member.id]);
    }
  }

  // The generator can spawn a pack from either level.
  const gen = new EncounterGenerator({ tables: ENCOUNTERS });
  const picked = gen.pickGroup("ice_cave_upper");
  check("ice cave upper roll picks a group", !!picked && (upper?.table ?? []).some((e) => e.group === picked.group));
  const forced = gen.forceEncounter("ice_cave_upper", "crystal_swarm");
  check("crystal swarm spawns wisps", !!forced && forced.enemies.some((e) => e.id === "crystalWisp"));
  const themeForced = gen.forceEncounter("ice_cave_b2", "wraith_cabal");
  check("chamber spawns frost wraiths", !!themeForced && themeForced.enemies.some((e) => e.id === "frostWraith"));

  return out;
}
