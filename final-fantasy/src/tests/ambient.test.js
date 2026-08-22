// Validation tests for Task #52: Town Ambient Logic.

import { AmbientNpcSystem } from "../engine/ambient.js";
import { NpcPlacementSystem } from "../engine/npcs.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";

function makeAmbient() {
  const maps = new MapManager();
  for (const def of MAPS) maps.register(def);
  const placements = new NpcPlacementSystem(JSON.parse(JSON.stringify(NPC_PLACEMENTS)), maps);
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const ambient = new AmbientNpcSystem({ placements, maps, random: rnd });
  return { maps, placements, ambient, rnd };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const { maps, placements, ambient } = makeAmbient();

  check("no controllers before spawn", ambient.count() === 0);
  ambient.spawn("cornelia");
  check("ambient npcs spawned", ambient.count() === 9);
  check("spawn idempotent", (ambient.spawn("cornelia"), ambient.count() === 9));

  const positions0 = ambient.positions();
  const guard0 = positions0.cornelia_guard;
  check("initial positions match placement", guard0.x === 8 && guard0.y === 3);

  ambient.run(300);
  check("ticks counted", ambient.tickCount === 300);

  const positions1 = ambient.positions();
  const anyMoved = Object.keys(positions1).some((id) => positions1[id].x !== positions0[id].x || positions1[id].y !== positions0[id].y);
  check("some npc wandered", anyMoved === true);

  const steps = Object.keys(positions1).some((id) => ambient.stepsTaken(id) > 0);
  check("steps recorded", steps === true);

  const map = maps.buildTileMap("cornelia");
  const allWalkable = Object.values(positions1).every((p) => map.canStand(p.x, p.y));
  check("all npcs stay on walkable tiles", allWalkable === true);

  const withinRadius = Object.keys(positions1).every((id) => {
    const p = positions1[id];
    const h = positions0[id];
    return h ? Math.abs(p.x - h.x) <= 2 && Math.abs(p.y - h.y) <= 2 : true;
  });
  check("positions near home", withinRadius === true);

  const pos = ambient.position("cornelia_guard");
  check("position() single", pos && typeof pos.mapId === "string");

  ambient.stopAll();
  check("stopAll clears", ambient.count() === 0);

  const a2 = makeAmbient().ambient;
  a2.spawn("nowhere");
  check("unknown map spawn no-op", a2.count() === 0);

  const a3 = new AmbientNpcSystem({ placements: { npcsFor: () => [] }, maps });
  check("no placements no-op", a3.spawn("cornelia") && a3.count() === 0);

  return out;
}
