// Validation tests for Task #167: Town of Pravog Layout Mapping — the
// expanded harbor town: docks, a second residence, an armory, and a proper
// chapel interior.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { SHOPS } from "../data/shops.js";
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

  // The expanded interiors exist and are square.
  for (const id of ["pravog_house2", "pravog_armory", "pravog_church"]) {
    const m = byId(id);
    check(id + " map exists", !!m);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
  }

  // Docks: the harbor gained walkable dock planks (D) at the water's edge.
  const town = byId("pravog");
  const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
  const dockCount = (town.rows.join("").match(/D/g) ?? []).length;
  check("pravog has dock planks", dockCount >= 3, "D count=" + dockCount);
  check("dock plank walkable", tm.canStand(13, 5) && tm.canStand(13, 7));
  check("dock tile in tiles table", typeof town.tiles.D === "number");
  check("harbor water retained", (town.rows.join("").match(/~/g) ?? []).length >= 3);

  // Buildings: the armory, second residence, and real chapel all registered.
  const bldgs = BUILDINGS.pravog ?? [];
  const bIds = bldgs.map((b) => b.id);
  check("armory building", bIds.includes("pravog_armory"));
  check("second house building", bIds.includes("pravog_house2"));
  check("chapel building", bIds.includes("pravog_church"));
  for (const b of bldgs) {
    check("pravog door walkable: " + b.id, tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y));
    check("pravog interior exists: " + b.id, !!byId(b.interior.mapId));
    const mI = byId(b.interior.mapId);
    if (mI) {
      const tmI = TileMap.fromAscii(mI.rows, { tiles: mI.tiles, solid: mI.solid });
      check("pravog interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
    }
  }
  check("chapel has real interior", bldgs.find((b) => b.id === "pravog_church")?.interior.mapId === "pravog_church");

  // The armory is a real shop.
  check("armory shop defined", !!SHOPS.pravog_armory && SHOPS.pravog_armory.stock.length > 0);

  // New residents stand on walkable tiles.
  const npcs = NPC_PLACEMENTS.pravog ?? [];
  check("pravog has residents", npcs.length >= 8);
  for (const npc of npcs) {
    check("pravog npc walkable: " + npc.id, tm.inBounds(npc.x, npc.y) && tm.canStand(npc.x, npc.y));
  }
  for (const id of ["pravog_dockworker", "pravog_fisherman", "pravog_fisherwife", "pravog_dockchild"]) {
    check("harbor npc present: " + id, npcs.some((n) => n.id === id));
  }
  // Interior NPCs exist for the new buildings.
  check("armorer placed", (NPC_PLACEMENTS.pravog_armory ?? []).some((n) => n.id === "pravog_armorer"));
  check("priest placed", (NPC_PLACEMENTS.pravog_church ?? []).some((n) => n.id === "pravog_priest"));
  check("resident placed", (NPC_PLACEMENTS.pravog_house2 ?? []).some((n) => n.id === "pravog_resident"));

  // The ship dock tile carries the northward passage.
  check("dock passage tile walkable", tm.inBounds(13, 7) && tm.canStand(13, 7));

  return out;
}
