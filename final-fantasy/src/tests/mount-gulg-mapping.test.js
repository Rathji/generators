// Validation tests for Task #94: Mount Gulg Mapping.

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

  const gulg = DUNGEONS.mount_gulg;
  check("mount gulg dungeon defined", !!gulg);
  check("gulg has two levels", gulg.levels.length === 2);
  check("gulg level 1 map exists", !!byId("mount_gulg"));
  check("gulg level 2 map exists", !!byId("mount_gulg_b2"));

  for (const id of ["mount_gulg", "mount_gulg_b2"]) {
    const m = byId(id);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " themed", m && typeof m.theme === "string");
  }

  // Entry/exit/stairs on walkable tiles.
  const tm1 = TileMap.fromAscii(byId("mount_gulg").rows, { tiles: byId("mount_gulg").tiles, solid: byId("mount_gulg").solid });
  const tm2 = TileMap.fromAscii(byId("mount_gulg_b2").rows, { tiles: byId("mount_gulg_b2").tiles, solid: byId("mount_gulg_b2").solid });
  const entry = gulg.entry;
  check("gulg entry walkable", tm1.inBounds(entry.x, entry.y) && tm1.canStand(entry.x, entry.y));
  for (const s of gulg.stairs) {
    const tm = s.fromMap === "mount_gulg" ? tm1 : tm2;
    const toTm = s.toMap === "mount_gulg" ? tm1 : tm2;
    check("gulg stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    check("gulg stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of gulg.exits) {
    const tm = ex.mapId === "mount_gulg" ? tm1 : tm2;
    check("gulg exit tile walkable", tm.inBounds(ex.x, ex.y) && tm.canStand(ex.x, ex.y));
    check("gulg exit destination walkable", tm1.inBounds(ex.toX, ex.toY));
  }

  // DungeonSystem resolves gulg transitions.
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("mount_gulg", "mount_gulg", 14, 9);
  check("gulg stairs descend", down && down.to.mapId === "mount_gulg_b2");
  const up = sys.useStairs("mount_gulg", "mount_gulg_b2", 14, 4);
  check("gulg stairs ascend", up && up.to.mapId === "mount_gulg");
  const exit = sys.exit("mount_gulg", "mount_gulg", 7, 1);
  check("gulg exit returns to overworld", exit && exit.to.mapId === "overworld");

  // The overworld entrance tile is walkable land.
  const ow = byId("overworld");
  const owTm = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  check("overworld gulg entrance walkable", owTm.inBounds(5, 5) && owTm.canStand(5, 5));

  // Chests in the mine sit on walkable tiles.
  const gulgChests = CHESTS.filter((c) => c.mapId === "mount_gulg" || c.mapId === "mount_gulg_b2");
  check("gulg has chests", gulgChests.length >= 2);
  for (const c of gulgChests) {
    const tm = c.mapId === "mount_gulg" ? tm1 : tm2;
    check("gulg chest on walkable tile: " + c.id, tm.inBounds(c.x, c.y) && tm.canStand(c.x, c.y));
  }

  // Landmark for the mine.
  check("gulg landmark exists", LANDMARKS.some((l) => l.id === "mount_gulg"));
  const lm = LANDMARKS.find((l) => l.id === "mount_gulg");
  check("gulg landmark walkable", lm && owTm.inBounds(lm.x, lm.y) && owTm.canStand(lm.x, lm.y));

  // Boss lair tile in the depths is walkable.
  check("gulg boss lair tile walkable", tm2.inBounds(3, 5) && tm2.canStand(3, 5));

  return out;
}
