// Validation tests for Task #92: Town of Elfheim Mapping.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { TileMap } from "../engine/grid.js";
import { TerrainRules } from "../engine/terrain.js";

function byId(id) {
  return MAPS.find((m) => m.id === id);
}

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ow = byId("overworld");
  check("overworld town tile exists", !!ow);
  check("overworld rows are square", ow.rows.every((r) => r.length === ow.rows[0].length));

  check("elfheim town map exists", !!byId("elfheim"));
  check("elfheim inn interior exists", !!byId("elfheim_inn"));
  check("elfheim shop interior exists", !!byId("elfheim_shop"));
  check("elfheim house interior exists", !!byId("elfheim_house"));
  check("elfheim royal hall interior exists", !!byId("elfheim_royal"));

  const town = byId("elfheim");
  check("elfheim rows are square", town && town.rows.every((r) => r.length === town.rows[0].length));
  const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
  check("elfheim has building front tiles", town.rows.some((r) => /[HSIP]/.test(r)));

  // The mountain-pass gate tile is a walkable land tile in the real map.
  const owTm = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  const owTerr = new TerrainRules(ow);
  check("elfheim gate tile walkable", owTm.inBounds(14, 9) && owTm.canStand(14, 9));
  check("elfheim gate tile is land", owTerr.terrainAt(14, 9) === "land");

  // A land path leads from the mountain gate down to the Elfheim town entrance.
  const reachable = (() => {
    const goal = [16, 13];
    const seen = new Set(["14,9"]);
    const q = [[14, 9]];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === goal[0] && y === goal[1]) return true;
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        const k = nx + "," + ny;
        if (seen.has(k)) continue;
        if (!owTm.inBounds(nx, ny) || !owTm.canStand(nx, ny)) continue;
        if (owTerr.terrainAt(nx, ny) !== "land") continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    return false;
  })();
  check("land path from gate to Elfheim entrance", reachable);
  // The entrance tile itself (overworld link target) is walkable land.
  check("elfheim entrance tile walkable", owTm.inBounds(16, 13) && owTm.canStand(16, 13) && owTerr.terrainAt(16, 13) === "land");
  // The Elfheim landmark sits on a walkable tile.
  const { LANDMARKS } = await import("../data/landmarks.js");
  const elfheimLm = LANDMARKS.find((m) => m.id === "elfheim");
  check("elfheim landmark walkable", elfheimLm && owTm.inBounds(elfheimLm.x, elfheimLm.y) && owTm.canStand(elfheimLm.x, elfheimLm.y));

  // Buildings registered for elfheim, doors/exits walkable.
  const bldgs = BUILDINGS.elfheim ?? [];
  check("elfheim has buildings", bldgs.length >= 4);
  const bIds = bldgs.map((b) => b.id);
  check("elfheim inn building", bIds.includes("elfheim_inn"));
  check("elfheim shop building", bIds.includes("elfheim_shop"));
  check("elfheim house building", bIds.includes("elfheim_house"));
  check("elfheim royal building", bIds.includes("elfheim_royal"));
  for (const b of bldgs) {
    check("elfheim interior map exists: " + b.id, !!byId(b.interior.mapId));
    const tmB = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
    check("elfheim door tile walkable: " + b.id, tmB.inBounds(b.door.x, b.door.y) && tmB.canStand(b.door.x, b.door.y));
    const tmI = TileMap.fromAscii(byId(b.interior.mapId).rows, { tiles: byId(b.interior.mapId).tiles, solid: byId(b.interior.mapId).solid });
    check("elfheim interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
  }

  // NPC placements on walkable tiles.
  const npcs = NPC_PLACEMENTS.elfheim ?? [];
  check("elfheim has resident NPCs", npcs.length >= 5);
  for (const npc of npcs) {
    check("elfheim npc placement walkable: " + npc.id, tm.inBounds(npc.x, npc.y) && tm.canStand(npc.x, npc.y));
  }
  const royalNpcs = NPC_PLACEMENTS.elfheim_royal ?? [];
  check("royal hall has occupants", royalNpcs.length >= 1);
  const tmR = TileMap.fromAscii(byId("elfheim_royal").rows, { tiles: byId("elfheim_royal").tiles, solid: byId("elfheim_royal").solid });
  for (const npc of royalNpcs) {
    check("royal hall npc placement walkable: " + npc.id, tmR.inBounds(npc.x, npc.y) && tmR.canStand(npc.x, npc.y));
  }

  return out;
}
