// Validation tests for Task #184: The Highland Peak — the storm-wracked
// summit behind the highlands' crown: two levels, the gale blasts that claw
// at the unwary, the summit hoard, and the way back to the uplands.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { HAZARD_ZONES } from "../data/hazard-zones.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";

const L1 = "highland_peak";
const L2 = "highland_peak_b2";
const ENTRY = { x: 7, y: 13 };

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };
  const byId = (id) => MAPS.find((m) => m.id === id);
  const tms = {};
  for (const id of [L1, L2]) {
    const m = byId(id);
    check(id + " map exists", !!m);
    check(id + " rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " is a peak theme", !!m && m.theme === "dungeon_peak");
    tms[id] = m ? TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid }) : null;
  }

  // BFS from the entry must reach the stairway (8,1) and the exit (13,13).
  const tm = tms[L1];
  const width = tm.width, height = tm.height;
  const reachable = new Set();
  const q = [[ENTRY.x, ENTRY.y]];
  reachable.add(ENTRY.y * width + ENTRY.x);
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!tm.canStand(nx, ny)) continue;
      const k = ny * width + nx;
      if (reachable.has(k)) continue;
      reachable.add(k);
      q.push([nx, ny]);
    }
  }
  check("stairway reachable on foot", reachable.has(1 * width + 8));
  check("exit reachable on foot", reachable.has(13 * width + 13));

  // The dungeon: two levels, working stairs, and the exit to the uplands.
  const d = DUNGEONS.highland_peak;
  check("highland peak dungeon defined", !!d);
  check("peak has two levels", !!d && d.levels.length === 2);
  const sys = new DungeonSystem(DUNGEONS, {});
  const up = sys.useStairs("highland_peak", L1, 8, 1);
  check("stairs ascend to the storm summit", up && up.to.mapId === L2 && up.to.x === 7 && up.to.y === 5);
  const down = sys.useStairs("highland_peak", L2, 13, 1);
  check("stairs descend to the peak", down && down.to.mapId === L1 && down.to.x === 8 && down.to.y === 1);
  const exit = sys.exit("highland_peak", L1, 13, 13);
  check("peak exit returns to the highlands", exit && exit.to.mapId === "west_highlands" && exit.to.x === 14 && exit.to.y === 1);

  // Chests: one on each level, on walkable tiles.
  const peakChests = CHESTS.filter((c) => c.mapId === L1 || c.mapId === L2);
  check("peak has chests", peakChests.length === 2);
  for (const c of peakChests) {
    check("peak chest walkable: " + c.id, tms[c.mapId].inBounds(c.x, c.y) && tms[c.mapId].canStand(c.x, c.y));
  }
  const hoard = CHESTS.find((c) => c.id === "peak_hoard");
  const hoardFeather = hoard && (hoard.contents.loot ?? []).some((l) => l.itemId === "stormFeather");
  check("summit hoard holds storm feathers", !!hoardFeather);

  // The gale blasts are wind-element and need the Gale Cloak.
  for (const zid of ["peak_gale", "summit_gale"]) {
    const z = HAZARD_ZONES.find((zz) => zz.id === zid);
    check(zid + " zone defined", !!z);
    check(zid + " is wind-element", z && z.element === "wind");
    check(zid + " protected by the Gale Cloak", z && z.protectedBy === "Gale Cloak");
    const mapId = z?.mapId;
    for (const tile of z?.tiles ?? []) {
      check(zid + " tile walkable: " + tile.x + "," + tile.y, tms[mapId] && tms[mapId].inBounds(tile.x, tile.y) && tms[mapId].canStand(tile.x, tile.y));
    }
  }

  return out;
}
