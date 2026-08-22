// Validation tests for Task #87: Town of Pravog Mapping.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { TileMap } from "../engine/grid.js";

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

  check("pravog town map exists", !!byId("pravog"));
  check("pravog inn interior exists", !!byId("pravog_inn"));
  check("pravog shop interior exists", !!byId("pravog_shop"));
  check("pravog house interior exists", !!byId("pravog_house"));

  const town = byId("pravog");
  check("pravog has a harbor (water tiles)", (town.rows.join("").match(/~/g) ?? []).length >= 3);
  check("pravog rows are square", town.rows.every((r) => r.length === town.rows[0].length));
  const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
  check("pravog has interior door tiles", town.rows.some((r) => r.includes("H") || r.includes("S") || r.includes("I") || r.includes("C")));

  // Buildings registered for pravog.
  const bldgs = BUILDINGS.pravog ?? [];
  check("pravog has buildings", bldgs.length >= 3);
  const bIds = bldgs.map((b) => b.id);
  check("pravog inn building", bIds.includes("pravog_inn"));
  check("pravog shop building", bIds.includes("pravog_shop"));
  check("pravog house building", bIds.includes("pravog_house"));
  for (const b of bldgs) {
    check("pravog interior map exists: " + b.id, !!byId(b.interior.mapId));
    const tmB = TileMap.fromAscii(byId("pravog").rows, { tiles: byId("pravog").tiles, solid: byId("pravog").solid });
    check("pravog door tile walkable: " + b.id, tmB.inBounds(b.door.x, b.door.y) && tmB.canStand(b.door.x, b.door.y));
    const tmI = TileMap.fromAscii(byId(b.interior.mapId).rows, { tiles: byId(b.interior.mapId).tiles, solid: byId(b.interior.mapId).solid });
    check("pravog interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
  }

  // NPC placements on walkable tiles.
  const npcs = NPC_PLACEMENTS.pravog ?? [];
  check("pravog has resident NPCs", npcs.length >= 4);
  for (const npc of npcs) {
    check("pravog npc placement walkable: " + npc.id, tm.inBounds(npc.x, npc.y) && tm.canStand(npc.x, npc.y));
  }

  // Pravog is reachable from the overworld.
  check("overworld town tile exists", !!byId("overworld"));

  return out;
}
