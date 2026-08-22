// Validation tests for Task #171: The Northern Wastes Map — the frozen
// eastern reaches reached by the Dawnbreaker, with its ice floors, mountain
// passes, village gate, and cave door.

import { MAPS } from "../data/maps.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DIALOGUE } from "../data/dialogue.js";
import { LANDMARKS } from "../data/landmarks.js";
import { TileMap } from "../engine/grid.js";
import { TerrainRules } from "../engine/terrain.js";

const WASTES = "north_wastes";
const ENTRY = { x: 1, y: 12 };
const VILLAGE_GATE = { x: 18, y: 1 };
const CAVE_DOOR = { x: 18, y: 9 };

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const m = MAPS.find((mm) => mm.id === WASTES);
  check("north wastes map exists", !!m);
  check("north wastes rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
  check("north wastes is a world-scale map", !!m && m.scale === 2);

  const tm = TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid });
  const tr = new TerrainRules(m);

  // The dock entry, village gate, and cave door are all walkable.
  check("dock entry walkable", tm.inBounds(ENTRY.x, ENTRY.y) && tm.canStand(ENTRY.x, ENTRY.y));
  check("village gate walkable", tm.inBounds(VILLAGE_GATE.x, VILLAGE_GATE.y) && tm.canStand(VILLAGE_GATE.x, VILLAGE_GATE.y));
  check("cave door walkable", tm.inBounds(CAVE_DOOR.x, CAVE_DOOR.y) && tm.canStand(CAVE_DOOR.x, CAVE_DOOR.y));
  check("village gate sits on the border", m.rows[VILLAGE_GATE.y][VILLAGE_GATE.x] === "." || m.rows[VILLAGE_GATE.y][VILLAGE_GATE.x] === "*");

  // The wastes carry ice floors ('+') and snow-forest groves ('*').
  const hasIce = m.rows.some((r) => r.includes("+"));
  check("wastes have ice floors", hasIce);
  check("ice tiles are ice terrain", m.rows.map((r, y) => [r, y]).filter(([r]) => r.includes("+")).every(([r, y]) => tr.terrainAt(r.indexOf("+"), y) === "ice"));
  check("forest tiles are forest terrain", m.rows.map((r, y) => [r, y]).filter(([r]) => r.includes("*")).every(([r, y]) => tr.terrainAt(r.indexOf("*"), y) === "forest"));

  // BFS from the dock must reach the village gate and the cave door through
  // walkable tiles (the map is a single connected region).
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
  check("village gate reachable by foot", reachable.has(VILLAGE_GATE.y * width + VILLAGE_GATE.x));
  check("cave door reachable by foot", reachable.has(CAVE_DOOR.y * width + CAVE_DOOR.x));

  // The wastes' landmarks are charted.
  check("north wastes landmark exists", LANDMARKS.some((l) => l.id === WASTES));

  // NPCs stand on walkable ground and speak real dialogue.
  const npcs = NPC_PLACEMENTS[WASTES] ?? [];
  check("wastes have scouts", npcs.length >= 2);
  for (const n of npcs) {
    check("wastes npc walkable: " + n.id, tm.inBounds(n.x, n.y) && tm.canStand(n.x, n.y));
    check("wastes npc dialogue present: " + n.id, typeof n.dialogueId === "string" && n.dialogueId in DIALOGUE);
  }

  return out;
}
