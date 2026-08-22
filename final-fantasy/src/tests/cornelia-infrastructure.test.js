// Validation tests for Task #82: Town of Cornelia Infrastructure.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { TileMap } from "../engine/grid.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const byId = (id) => MAPS.find((m) => m.id === id);

  check("cornelia town map exists", !!byId("cornelia"));
  check("cornelia inn interior exists", !!byId("cornelia_inn"));
  check("cornelia house interior exists", !!byId("cornelia_house"));
  check("cornelia second house interior exists", !!byId("cornelia_house2"));
  check("cornelia shop interior exists", !!byId("cornelia_shop"));
  check("cornelia castle interior exists", !!byId("cornelia_castle"));

  // All maps square and at least 8 tiles wide.
  for (const id of ["cornelia", "cornelia_inn", "cornelia_house", "cornelia_house2", "cornelia_shop", "cornelia_castle"]) {
    const m = byId(id);
    check(id + " rows are square", m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " wide enough", m && m.rows[0].length >= 8);
  }

  // Buildings in cornelia link to existing interior maps.
  const townBuildings = BUILDINGS.cornelia ?? [];
  check("cornelia has multiple buildings", townBuildings.length >= 4);
  const ids = townBuildings.map((b) => b.id);
  check("cornelia has a castle building", ids.includes("cornelia_castle"));
  check("cornelia has two houses", ids.filter((i) => i.startsWith("cornelia_house")).length === 2);
  check("cornelia has a shop", ids.includes("cornelia_shop"));
  for (const b of townBuildings) {
    check("building interior map exists: " + b.id, !!byId(b.interior.mapId));
    check("building door tile walkable: " + b.id, (() => {
      const town = byId(b.town);
      if (!town) return false;
      const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
      return tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y);
    })());
    check("building interior exit walkable: " + b.id, (() => {
      const tm = TileMap.fromAscii(byId(b.interior.mapId).rows, { tiles: byId(b.interior.mapId).tiles, solid: byId(b.interior.mapId).solid });
      return tm.inBounds(b.exit.x, b.exit.y) && tm.canStand(b.exit.x, b.exit.y);
    })());
  }

  // NPC placements on walkable tiles.
  const townNpcs = NPC_PLACEMENTS.cornelia ?? [];
  check("cornelia has resident NPCs", townNpcs.length >= 6);
  for (const npc of townNpcs) {
    const tm = TileMap.fromAscii(byId("cornelia").rows, { tiles: byId("cornelia").tiles, solid: byId("cornelia").solid });
    check("npc placement walkable: " + npc.id, tm.inBounds(npc.x, npc.y) && tm.canStand(npc.x, npc.y));
  }
  const castleNpcs = NPC_PLACEMENTS.cornelia_castle ?? [];
  check("castle has guards", castleNpcs.length >= 2);

  // The demo enters from overworld at (7,9) -> cornelia (6,6) via transition.
  check("inn transition tile exists", byId("cornelia").rows[6]?.[5] !== undefined);

  return out;
}
