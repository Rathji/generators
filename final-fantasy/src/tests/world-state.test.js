// Validation tests for Task #103: WorldStateSystem — the Crystal Bridges and
// the sealed gates of the eastern sea. Verifies the data tiles sit on the
// real overworld map (bridges over water, gates on land), that bridges open
// exactly when their crystal flag is set, that the terrain override makes
// bridged water walkable on foot, and that gates scale with crystal count.

import { WORLD_BRIDGES, WORLD_GATES } from "../data/world-state.js";
import { WorldStateSystem } from "../engine/world-state.js";
import { TerrainRules } from "../engine/terrain.js";
import { MAPS } from "../data/maps.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = fakeState();
  const sys = new WorldStateSystem(WORLD_BRIDGES, WORLD_GATES, { state });

  // --- data integrity ---
  check("four bridges defined", WORLD_BRIDGES.length === 4);
  check("two gates defined", WORLD_GATES.length === 2);
  check(
    "every bridge has a crystal requirement",
    WORLD_BRIDGES.every((b) => b.require?.flag && /^crystal_/.test(b.require.flag))
  );
  check(
    "gate requirements are crystal counts",
    WORLD_GATES.every((g) => typeof g.require?.crystals === "number" && g.require.crystals >= 2)
  );

  const ow = MAPS.find((m) => m.id === "overworld");
  const rows = ow.rows;
  const char = (x, y) => rows[y]?.[x] ?? "?";
  const isWalkableBase = (x, y) => {
    const ch = char(x, y);
    return ch === "." || ch === "@" || ch === "E" || ch === "W" || ch === "+";
  };
  for (const b of WORLD_BRIDGES) {
    for (const t of b.tiles) {
      check("bridge tile is water on the map (" + b.id + " " + t.x + "," + t.y + ")", char(t.x, t.y) === "~", char(t.x, t.y));
    }
  }
  for (const g of WORLD_GATES) {
    check("gate tile is land on the map (" + g.id + ")", isWalkableBase(g.x, g.y), char(g.x, g.y));
  }
  // Bridge end tiles (neighbours) must be land so a bridge actually connects.
  const ends = {
    fire_bridge: [[14, 10], [20, 10]],
    water_bridge: [[16, 12], [19, 12]],
    earth_bridge: [[15, 11], [19, 11]],
    wind_bridge: [[22, 12], [24, 12]],
  };
  for (const [id, tiles] of Object.entries(ends)) {
    for (const [x, y] of tiles) {
      check("bridge end is land (" + id + " " + x + "," + y + ")", isWalkableBase(x, y), char(x, y));
    }
  }

  // --- gating ---
  check("no bridge open initially", sys.openBridges().length === 0 && sys.pendingBridges().length === 4);
  check("no gate open initially", sys.openGates().length === 0 && sys.pendingGates().length === 2);

  state.setFlag("crystal_fire", true);
  check("fire bridge opens", sys.isBridgeOpen("fire_bridge"));
  check("others still sealed", sys.pendingBridges().map((b) => b.id).join(",") === "water_bridge,earth_bridge,wind_bridge");
  check("fire tile bridged", sys.isBridged("overworld", 16, 10));
  check("non-bridge water untouched", sys.isBridged("overworld", 15, 11) === false);
  check("terrain override returns land", sys.terrainOverride("overworld", 17, 10, "water") === "land");
  check("override null off-bridge", sys.terrainOverride("overworld", 15, 11, "water") === null);
  check("override null other maps", sys.terrainOverride("cornelia", 16, 10, "water") === null);
  check("sealed gate blocks at 1 crystal", sys.sealedGateAt("overworld", 20, 10)?.id === "east_causeway_gate");
  check("deep gate also sealed", sys.sealedGateAt("overworld", 20, 12)?.id === "deep_channel_gate");

  state.setFlag("crystal_water", true);
  check("water bridge opens at 2", sys.isBridgeOpen("water_bridge"));
  check("east gate opens at 2", sys.isGateOpen("east_causeway_gate") && sys.sealedGateAt("overworld", 20, 10) === null);
  check("deep gate still sealed at 2", sys.sealedGateAt("overworld", 20, 12)?.id === "deep_channel_gate");

  state.setFlag("crystal_earth", true);
  check("deep gate opens at 3", sys.isGateOpen("deep_channel_gate") && sys.sealedGateAt("overworld", 20, 12) === null);
  check("earth bridge opens", sys.isBridgeOpen("earth_bridge"));

  state.setFlag("crystal_wind", true);
  check("wind bridge opens at 4", sys.isBridgeOpen("wind_bridge") && sys.openBridges().length === 4);
  check("status reports all open", sys.status().bridges.every((b) => b.open) && sys.status().gates.every((g) => g.open));
  check("describe mentions names", sys.describe().includes("Fire Bridge") && sys.describe().includes("Sealed gates: none"));

  // --- terrain integration (only the fire crystal open) ---
  const sysF = new WorldStateSystem(WORLD_BRIDGES, WORLD_GATES, { state: fakeState({ crystal_fire: true }) });
  const terrF = new TerrainRules(ow, { terrainOverride: (x, y, t) => sysF.terrainOverride("overworld", x, y, t) });
  check("bridged tile walkable on foot", terrF.canTraverse("land", 16, 10));
  check("bridged tile reads land", terrF.terrainAt(16, 10) === "land");
  check("sealed bridge tile stays water", terrF.terrainAt(16, 11) === "water" && terrF.canTraverse("land", 16, 11) === false);
  check("unbridged water blocks land", terrF.canTraverse("land", 17, 12) === false);
  check("land still walkable", terrF.canTraverse("land", 14, 10) === true);
  check("ice walkable on foot", terrF.canTraverse("land", 24, 12));

  // --- full walk: with every crystal, the party can cross from the
  // continent to the Glacier Isle entirely on foot (no ship, no airship). ---
  const canCross = (x, y) => {
    const ch = char(x, y);
    if (isWalkableBase(x, y)) return true;
    return sys.isBridged("overworld", x, y);
  };
  const start = [14, 10];
  const goal = [24, 12];
  const seen = new Set(["14,10"]);
  const queue = [start];
  let reached = false;
  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === goal[0] && y === goal[1]) {
      reached = true;
      break;
    }
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= 27 || ny < 0 || ny >= 15) continue;
      const key = nx + "," + ny;
      if (seen.has(key)) continue;
      if (!canCross(nx, ny)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  check("foot path to Glacier with all crystals", reached);
  check("every bridge tile reachable on foot", WORLD_BRIDGES.every((b) =>
    b.tiles.every((t) => seen.has(t.x + "," + t.y))
  ));
  // Without any crystal, the sea seals the east — no foot crossing.
  const sys0 = new WorldStateSystem(WORLD_BRIDGES, WORLD_GATES, { state: fakeState() });
  const canCross0 = (x, y) => isWalkableBase(x, y) || sys0.isBridged("overworld", x, y);
  const seen0 = new Set(["14,10"]);
  const q0 = [[14, 10]];
  let reached0 = false;
  while (q0.length) {
    const [x, y] = q0.shift();
    if (x === 24 && y === 12) {
      reached0 = true;
      break;
    }
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= 27 || ny < 0 || ny >= 15) continue;
      const key = nx + "," + ny;
      if (seen0.has(key)) continue;
      if (!canCross0(nx, ny)) continue;
      seen0.add(key);
      q0.push([nx, ny]);
    }
  }
  check("sea seals the east without crystals", reached0 === false);

  return out;
}
