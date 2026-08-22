// Validation tests for Task #102: Gnome Tunnels Mapping.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { LANDMARKS } from "../data/landmarks.js";

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

  const tunnels = DUNGEONS.gnome_tunnels;
  check("gnome tunnels dungeon defined", !!tunnels);
  check("tunnels has two levels", tunnels && tunnels.levels.length === 2);
  check("level 1 map exists", !!byId("gnome_tunnels"));
  check("level 2 map exists", !!byId("gnome_tunnels_b2"));

  for (const id of ["gnome_tunnels", "gnome_tunnels_b2"]) {
    const m = byId(id);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " themed", m && typeof m.theme === "string");
  }

  // Entry/exit/stairs on walkable tiles.
  const tm1 = TileMap.fromAscii(byId("gnome_tunnels").rows, { tiles: byId("gnome_tunnels").tiles, solid: byId("gnome_tunnels").solid });
  const tm2 = TileMap.fromAscii(byId("gnome_tunnels_b2").rows, { tiles: byId("gnome_tunnels_b2").tiles, solid: byId("gnome_tunnels_b2").solid });
  const entry = tunnels.entry;
  check("tunnels entry walkable", tm1.inBounds(entry.x, entry.y) && tm1.canStand(entry.x, entry.y));
  for (const s of tunnels.stairs) {
    const tm = s.fromMap === "gnome_tunnels" ? tm1 : tm2;
    const toTm = s.toMap === "gnome_tunnels" ? tm1 : tm2;
    check("tunnels stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    check("tunnels stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of tunnels.exits) {
    const tm = ex.mapId === "gnome_tunnels" ? tm1 : tm2;
    check("tunnels exit tile walkable", tm.inBounds(ex.x, ex.y) && tm.canStand(ex.x, ex.y));
  }

  // DungeonSystem resolves transitions.
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("gnome_tunnels", "gnome_tunnels", 14, 10);
  check("tunnels stairs descend", down && down.to.mapId === "gnome_tunnels_b2");
  const up = sys.useStairs("gnome_tunnels", "gnome_tunnels_b2", 14, 4);
  check("tunnels stairs ascend", up && up.to.mapId === "gnome_tunnels");
  const exit = sys.exit("gnome_tunnels", "gnome_tunnels", 7, 1);
  check("tunnels exit returns to overworld", exit && exit.to.mapId === "overworld");

  // The overworld entrance tile is walkable and near Elfheim.
  const ow = byId("overworld");
  const owTm = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  check("overworld tunnels entrance walkable", owTm.inBounds(14, 13) && owTm.canStand(14, 13));
  const lm = LANDMARKS.find((l) => l.id === "gnome_tunnels");
  check("gnome tunnels landmark placed at entrance", lm && lm.x === 14 && lm.y === 13);

  // Decorative gear tiles are non-solid and walkable.
  check("gear tile at (13,4) walkable", tm1.inBounds(13, 4) && tm1.canStand(13, 4));
  check("gear tile at (2,5) walkable", tm1.inBounds(2, 5) && tm1.canStand(2, 5));
  check("gear tile at (3,3) walkable", tm2.inBounds(3, 3) && tm2.canStand(3, 3));
  check("gear tile at (8,5) walkable", tm2.inBounds(8, 5) && tm2.canStand(8, 5));

  // Chests sit on walkable tiles.
  const chests = CHESTS.filter((c) => c.mapId === "gnome_tunnels" || c.mapId === "gnome_tunnels_b2");
  check("tunnels has chests", chests.length >= 2);
  for (const c of chests) {
    const tm = c.mapId === "gnome_tunnels" ? tm1 : tm2;
    check("tunnels chest on walkable tile: " + c.id, tm.inBounds(c.x, c.y) && tm.canStand(c.x, c.y));
  }

  return out;
}
