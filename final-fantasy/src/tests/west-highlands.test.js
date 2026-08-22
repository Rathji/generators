// Validation tests for Task #181: The Western Highlands map — the wind-swept
// uplands between the jungles and the mountain's crown, with its castle
// gate, peak path, and mountain terrain.

import { MAPS } from "../data/maps.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DIALOGUE } from "../data/dialogue.js";
import { TileMap } from "../engine/grid.js";
import { TerrainRules } from "../engine/terrain.js";

const HIGHLANDS = "west_highlands";
const CASTLE_GATE = { x: 3, y: 1 };
const PEAK_PATH = { x: 14, y: 1 };
const PASS = { x: 17, y: 11 };

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const m = MAPS.find((mm) => mm.id === HIGHLANDS);
  check("west highlands map exists", !!m);
  check("west highlands rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
  check("west highlands is world-scale", !!m && m.scale === 2);

  const tm = TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid });
  const tr = new TerrainRules(m);

  // Castle gate, peak path, and the pass are all walkable.
  for (const [label, p] of [["castle gate", CASTLE_GATE], ["peak path", PEAK_PATH], ["pass", PASS]]) {
    check(label + " walkable", tm.inBounds(p.x, p.y) && tm.canStand(p.x, p.y));
  }

  // The '^' uplands are solid mountain.
  const mountainTiles = m.rows.flatMap((r, y) => [...r].map((ch, x) => (ch === "^" ? { x, y } : null)).filter(Boolean));
  check("highlands have mountain tiles", mountainTiles.length >= 8);
  check("mountain tiles are mountain terrain", mountainTiles.every((t) => tr.terrainAt(t.x, t.y) === "mountain"));
  check("mountain tiles block movement", mountainTiles.every((t) => !tm.canStand(t.x, t.y)));

  // BFS from the castle gate reaches the peak path and the pass.
  const width = tm.width, height = tm.height;
  const reachable = new Set();
  const q = [[CASTLE_GATE.x, CASTLE_GATE.y]];
  reachable.add(CASTLE_GATE.y * width + CASTLE_GATE.x);
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
  check("peak path reachable from the gate", reachable.has(PEAK_PATH.y * width + PEAK_PATH.x));
  check("pass reachable from the gate", reachable.has(PASS.y * width + PASS.x));

  // Scouts patrol the roads; the guard eyes the pass.
  const npcs = NPC_PLACEMENTS[HIGHLANDS] ?? [];
  check("highlands have patrols", npcs.length >= 2);
  for (const n of npcs) {
    check("highlands npc walkable: " + n.id, tm.inBounds(n.x, n.y) && tm.canStand(n.x, n.y));
    check("highlands npc dialogue present: " + n.id, typeof n.dialogueId === "string" && n.dialogueId in DIALOGUE);
  }

  return out;
}
