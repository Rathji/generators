// Validation tests for Task #172: Northwind Village Mapping — the wastes'
// only settlement, with its house/shop/inn interiors, cave door, and the
// roads that connect it to the wastes and the Ice Cave.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DIALOGUE } from "../data/dialogue.js";
import { SHOPS } from "../data/shops.js";
import { INNS } from "../data/inns.js";
import { TileMap } from "../engine/grid.js";
import { MapManager, TransitionManager } from "../engine/transitions.js";

const TOWN = "north_village";
const INTERIORS = ["north_village_house", "north_village_shop", "north_village_inn"];
const CAVE_DOOR = { x: 8, y: 7 };
const SOUTH_GATE = { x: 7, y: 8 };

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const byId = (id) => MAPS.find((mm) => mm.id === id);
  for (const id of [TOWN, ...INTERIORS]) {
    const m = byId(id);
    check(id + " map exists", !!m);
    check(id + " rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
  }
  const town = byId(TOWN);
  const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
  check("village has building fronts", town.rows.some((r) => /[HSI]/.test(r)));
  check("village has frost braziers", town.rows.some((r) => /@/.test(r)));
  check("village has a waystone", town.rows.some((r) => /W/.test(r)));

  // Buildings registered, doors walkable, interiors exist.
  const bldgs = BUILDINGS.north_village ?? [];
  check("village has buildings", bldgs.length >= 3);
  const bIds = bldgs.map((b) => b.id);
  check("village house building", bIds.includes("north_village_house"));
  check("village shop building", bIds.includes("north_village_shop"));
  check("village inn building", bIds.includes("north_village_inn"));
  for (const b of bldgs) {
    check("village interior map exists: " + b.id, !!byId(b.interior.mapId));
    check("village door tile walkable: " + b.id, tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y));
    const tmI = TileMap.fromAscii(byId(b.interior.mapId).rows, { tiles: byId(b.interior.mapId).tiles, solid: byId(b.interior.mapId).solid });
    check("village interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
  }

  // The cave door and the road south are walkable.
  check("cave door walkable", tm.inBounds(CAVE_DOOR.x, CAVE_DOOR.y) && tm.canStand(CAVE_DOOR.x, CAVE_DOOR.y));
  check("south gate walkable", tm.inBounds(SOUTH_GATE.x, SOUTH_GATE.y) && tm.canStand(SOUTH_GATE.x, SOUTH_GATE.y));

  // NPCs stand on walkable ground and speak real dialogue.
  const npcs = NPC_PLACEMENTS.north_village ?? [];
  check("village has residents", npcs.length >= 4);
  for (const n of npcs) {
    check("village npc walkable: " + n.id, tm.inBounds(n.x, n.y) && tm.canStand(n.x, n.y));
    check("village npc dialogue present: " + n.id, typeof n.dialogueId === "string" && n.dialogueId in DIALOGUE);
  }
  for (const id of INTERIORS) {
    const t = TileMap.fromAscii(byId(id).rows, { tiles: byId(id).tiles, solid: byId(id).solid });
    for (const n of NPC_PLACEMENTS[id] ?? []) {
      check(id + " npc walkable: " + n.id, t.inBounds(n.x, n.y) && t.canStand(n.x, n.y));
      check(id + " npc dialogue present: " + n.id, typeof n.dialogueId === "string" && n.dialogueId in DIALOGUE);
    }
  }

  // The village has a shop and an inn.
  check("village shop defined", !!SHOPS.north_village_supply && SHOPS.north_village_supply.stock.length > 0);
  check("village inn defined", !!INNS.north_village_inn);

  // Roads connect the wastes <-> village and the village -> Ice Cave.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "north_wastes", fromX: 18, fromY: 1, toMap: TOWN, toX: SOUTH_GATE.x, toY: SOUTH_GATE.y, facing: "S" });
  tman.addLink({ fromMap: TOWN, fromX: SOUTH_GATE.x, fromY: SOUTH_GATE.y, toMap: "north_wastes", toX: 18, toY: 1, facing: "N" });
  tman.addLink({ fromMap: TOWN, fromX: CAVE_DOOR.x, fromY: CAVE_DOOR.y, toMap: "ice_cave_upper", toX: 7, toY: 5, facing: "N" });
  tman.start("north_wastes", 18, 1, "S");
  const into = tman.transitionAt(18, 1);
  check("wastes -> village link", into && into.to.mapId === TOWN && into.to.x === SOUTH_GATE.x && into.to.y === SOUTH_GATE.y);
  tman.start(TOWN, SOUTH_GATE.x, SOUTH_GATE.y, "N");
  const back = tman.transitionAt(SOUTH_GATE.x, SOUTH_GATE.y);
  check("village -> wastes link", back && back.to.mapId === "north_wastes" && back.to.x === 18 && back.to.y === 1);
  tman.start(TOWN, CAVE_DOOR.x, CAVE_DOOR.y, "N");
  const toCave = tman.transitionAt(CAVE_DOOR.x, CAVE_DOOR.y);
  check("village -> ice cave link", toCave && toCave.to.mapId === "ice_cave_upper");

  return out;
}
