// Validation tests for Task #176: The Southern Jungles map — the green
// southern coast reached by boat from Pravog, with its dock, village gate,
// ruin door, and the highlands pass.

import { MAPS } from "../data/maps.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DIALOGUE } from "../data/dialogue.js";
import { LANDMARKS } from "../data/landmarks.js";
import { TileMap } from "../engine/grid.js";
import { TerrainRules } from "../engine/terrain.js";

const JUNGLE = "south_jungle";
const DOCK = { x: 17, y: 11 };
const VILLAGE_GATE = { x: 7, y: 4 };
const RUIN_DOOR = { x: 17, y: 8 };
const HIGHLANDS_PASS = { x: 1, y: 1 };

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const m = MAPS.find((mm) => mm.id === JUNGLE);
  check("south jungle map exists", !!m);
  check("south jungle rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
  check("south jungle is world-scale", !!m && m.scale === 2);

  const tm = TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid });
  const tr = new TerrainRules(m);

  // The dock, village gate, ruin door, and highlands pass are all walkable.
  for (const [label, p] of [["dock", DOCK], ["village gate", VILLAGE_GATE], ["ruin door", RUIN_DOOR], ["highlands pass", HIGHLANDS_PASS]]) {
    check(label + " walkable", tm.inBounds(p.x, p.y) && tm.canStand(p.x, p.y));
  }

  // Jungle trees ('*') classify as forest terrain.
  const forestTiles = m.rows.flatMap((r, y) => [...r].map((ch, x) => (ch === "*" ? { x, y } : null)).filter(Boolean));
  check("jungle has forest tiles", forestTiles.length >= 20);
  check("forest tiles are forest terrain", forestTiles.every((t) => tr.terrainAt(t.x, t.y) === "forest"));

  // BFS from the dock must reach the village gate, ruin door, and the pass.
  const width = tm.width, height = tm.height;
  const reachable = new Set();
  const q = [[DOCK.x, DOCK.y]];
  reachable.add(DOCK.y * width + DOCK.x);
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
  check("village gate reachable from dock", reachable.has(VILLAGE_GATE.y * width + VILLAGE_GATE.x));
  check("ruin door reachable from dock", reachable.has(RUIN_DOOR.y * width + RUIN_DOOR.x));
  check("highlands pass reachable from dock", reachable.has(HIGHLANDS_PASS.y * width + HIGHLANDS_PASS.x));

  // The jungles are charted as a ship-obtained landmark.
  check("south jungle landmark exists", LANDMARKS.some((l) => l.id === JUNGLE && l.revealFlag === "ship_obtained"));

  // The guide greets arrivals at the dock; the hunter roams the treeline.
  const npcs = NPC_PLACEMENTS[JUNGLE] ?? [];
  check("jungle has residents", npcs.length >= 2);
  for (const n of npcs) {
    check("jungle npc walkable: " + n.id, tm.inBounds(n.x, n.y) && tm.canStand(n.x, n.y));
    check("jungle npc dialogue present: " + n.id, typeof n.dialogueId === "string" && n.dialogueId in DIALOGUE);
  }

  return out;
}
