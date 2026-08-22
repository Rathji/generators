// Validation tests for Task #112: Windfall Isle Village Mapping + NPCs.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { SHOPS } from "../data/shops.js";
import { TileMap } from "../engine/grid.js";
import { TerrainRules } from "../engine/terrain.js";
import { TransitionManager, MapManager } from "../engine/transitions.js";

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

  // Maps exist.
  check("windfall town map exists", !!byId("windfall"));
  check("windfall inn interior exists", !!byId("windfall_inn"));
  check("windfall shop interior exists", !!byId("windfall_shop"));
  check("windfall house interior exists", !!byId("windfall_house"));

  const town = byId("windfall");
  check("windfall rows are square", town && town.rows.every((r) => r.length === town.rows[0].length));
  const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
  check("windfall has building front tiles", town.rows.some((r) => /[HSIP]/.test(r)));
  check("windfall has dock tiles", town.rows.some((r) => /@/.test(r)));

  // The island's overworld gate tile is walkable land.
  const ow = byId("overworld");
  const owTm = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  const owTerr = new TerrainRules(ow);
  check("windfall island gate walkable", owTm.inBounds(20, 11) && owTm.canStand(20, 11));
  check("windfall gate is land", owTerr.terrainAt(20, 11) === "land");

  // Buildings registered, doors/exits walkable, interiors exist.
  const bldgs = BUILDINGS.windfall ?? [];
  check("windfall has buildings", bldgs.length >= 3);
  const bIds = bldgs.map((b) => b.id);
  check("windfall inn building", bIds.includes("windfall_inn"));
  check("windfall shop building", bIds.includes("windfall_shop"));
  check("windfall house building", bIds.includes("windfall_house"));
  for (const b of bldgs) {
    check("windfall interior map exists: " + b.id, !!byId(b.interior.mapId));
    check("windfall door tile walkable: " + b.id, tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y));
    const tmI = TileMap.fromAscii(byId(b.interior.mapId).rows, { tiles: byId(b.interior.mapId).tiles, solid: byId(b.interior.mapId).solid });
    check("windfall interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
  }

  // NPC placements on walkable tiles with dialogue data.
  const { DIALOGUE } = await import("../data/dialogue.js");
  const npcs = NPC_PLACEMENTS.windfall ?? [];
  check("windfall has resident NPCs", npcs.length >= 5);
  for (const npc of npcs) {
    check("windfall npc placement walkable: " + npc.id, tm.inBounds(npc.x, npc.y) && tm.canStand(npc.x, npc.y));
    check("windfall npc dialogue in data: " + npc.id, typeof npc.dialogueId === "string" && npc.dialogueId in DIALOGUE);
  }

  // The shrine door tile (Sea Shrine entrance, Task #113) is walkable.
  check("shrine door tile walkable", tm.inBounds(10, 1) && tm.canStand(10, 1));

  // The village has a shop.
  check("windfall shop defined", !!SHOPS.windfall_merchant && SHOPS.windfall_merchant.stock.length > 0);

  // Transition links: overworld gate <-> windfall town.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "overworld", fromX: 20, fromY: 11, toMap: "windfall", toX: 7, toY: 6, facing: "N" });
  tman.addLink({ fromMap: "windfall", fromX: 7, fromY: 7, toMap: "overworld", toX: 20, toY: 11, facing: "S" });
  tman.start("overworld", 20, 11, "N");
  const into = tman.transitionAt(20, 11);
  check("link island -> village", into && into.to.mapId === "windfall" && into.to.x === 7 && into.to.y === 6);
  const backOut = tman.transitionAt(7, 7);
  check("link village -> island", backOut && backOut.to.mapId === "overworld" && backOut.to.x === 20 && backOut.to.y === 11);

  return out;
}
