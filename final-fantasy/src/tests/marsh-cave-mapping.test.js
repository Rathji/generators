// Validation tests for Task #89: The Marsh Cave Mapping.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { TerrainRules } from "../engine/terrain.js";

function byId(id) {
  return MAPS.find((m) => m.id === id);
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const marsh = DUNGEONS.marsh_cave;
  check("marsh cave dungeon defined", !!marsh);
  check("marsh has two levels", marsh.levels.length === 2);
  check("marsh level 1 map exists", !!byId("marsh_cave"));
  check("marsh level 2 map exists", !!byId("marsh_cave_b2"));

  for (const id of ["marsh_cave", "marsh_cave_b2"]) {
    const m = byId(id);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
  }

  // Water/land terrain constraints in the marsh.
  const rules = new TerrainRules(byId("marsh_cave"));
  const hasWater = (() => {
    for (let y = 0; y < rules.height; y++) for (let x = 0; x < rules.width; x++) if (rules.isWater(x, y)) return true;
    return false;
  })();
  check("marsh has water tiles", hasWater);
  check("land tiles exist in marsh", (() => {
    for (let y = 0; y < rules.height; y++) for (let x = 0; x < rules.width; x++) if (rules.terrainAt(x, y) === "land") return true;
    return false;
  })());

  // Stairs and exits on walkable tiles.
  const tm1 = TileMap.fromAscii(byId("marsh_cave").rows, { tiles: byId("marsh_cave").tiles, solid: byId("marsh_cave").solid });
  const tm2 = TileMap.fromAscii(byId("marsh_cave_b2").rows, { tiles: byId("marsh_cave_b2").tiles, solid: byId("marsh_cave_b2").solid });
  for (const s of marsh.stairs) {
    const tm = s.fromMap === "marsh_cave" ? tm1 : tm2;
    const toTm = s.toMap === "marsh_cave" ? tm1 : tm2;
    check("marsh stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    check("marsh stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of marsh.exits) {
    const tm = ex.mapId === "marsh_cave" ? tm1 : tm2;
    check("marsh exit tile walkable", tm.inBounds(ex.x, ex.y) && tm.canStand(ex.x, ex.y));
    check("marsh exit destination walkable", tm1.inBounds(ex.toX, ex.toY));
  }

  // DungeonSystem resolves marsh transitions.
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("marsh_cave", "marsh_cave", 14, 9);
  check("marsh stairs descend", down && down.to.mapId === "marsh_cave_b2");
  const up = sys.useStairs("marsh_cave", "marsh_cave_b2", 14, 4);
  check("marsh stairs ascend", up && up.to.mapId === "marsh_cave");
  const exit = sys.exit("marsh_cave", "marsh_cave", 7, 1);
  check("marsh exit returns to overworld", exit && exit.to.mapId === "overworld");

  // Chests in the marsh sit on walkable tiles.
  const marshChests = CHESTS.filter((c) => c.mapId === "marsh_cave" || c.mapId === "marsh_cave_b2");
  check("marsh has chests", marshChests.length >= 2);
  for (const c of marshChests) {
    const tm = c.mapId === "marsh_cave" ? tm1 : tm2;
    check("marsh chest on walkable tile: " + c.id, tm.inBounds(c.x, c.y) && tm.canStand(c.x, c.y));
  }

  // Entry tile reachable.
  const entry = marsh.entry;
  check("marsh entry walkable", tm1.inBounds(entry.x, entry.y) && tm1.canStand(entry.x, entry.y));

  // The boss tile in the depths is walkable.
  check("boss lair tile walkable", tm2.inBounds(3, 5) && tm2.canStand(3, 5));

  return out;
}
