// Validation tests for Task #178: The Jungle Village — the canopy clearing
// behind the jungle's north gate, with its house, shop, and rest-house
// fronts, its waystone and elder, and the supply shop + lodge that serve it.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DIALOGUE } from "../data/dialogue.js";
import { SHOPS } from "../data/shops.js";
import { INNS } from "../data/inns.js";
import { ITEMS } from "../data/items.js";
import { TileMap } from "../engine/grid.js";
import { MapManager, TransitionManager } from "../engine/transitions.js";

const VILLAGE = "jungle_village";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };
  const byId = (id) => MAPS.find((m) => m.id === id);

  const m = byId(VILLAGE);
  check("jungle village map exists", !!m);
  check("jungle village rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
  const tm = TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid });

  // The village gate (V, 8,7) leads back to the jungle; the waystone sits
  // beside the clearing; the inn front is at (5,5).
  check("village gate walkable", tm.inBounds(8, 7) && tm.canStand(8, 7));
  check("village has a waystone", m.rows.some((r) => r.includes("W")));
  check("village has an inn front", m.rows.some((r) => r.includes("I")));

  // Three buildings, doors on walkable tiles, interiors with walkable exits.
  const bldgs = BUILDINGS[VILLAGE] ?? [];
  check("jungle village has buildings", bldgs.length === 3);
  for (const b of bldgs) {
    check("jungle interior map exists: " + b.id, !!byId(b.interior.mapId));
    check("jungle door walkable: " + b.id, tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y));
    const interior = byId(b.interior.mapId);
    const tmI = TileMap.fromAscii(interior.rows, { tiles: interior.tiles, solid: interior.solid });
    check("jungle interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
    check("jungle interior spawn walkable: " + b.id, tmI.inBounds(b.interior.x, b.interior.y) && tmI.canStand(b.interior.x, b.interior.y));
  }

  // NPCs stand on walkable ground and speak real dialogue.
  const npcs = NPC_PLACEMENTS[VILLAGE] ?? [];
  check("jungle village has residents", npcs.length >= 4);
  for (const n of npcs) {
    check("jungle npc walkable: " + n.id, tm.inBounds(n.x, n.y) && tm.canStand(n.x, n.y));
    check("jungle npc dialogue present: " + n.id, typeof n.dialogueId === "string" && n.dialogueId in DIALOGUE);
  }

  // The supply shop stocks real items.
  const shop = SHOPS.jungle_village_supply;
  check("jungle village supply shop defined", !!shop);
  check("jungle shop stock all exist", shop && shop.stock.every((s) => !!ITEMS[s]));

  // The canopy lodge is an inn.
  check("jungle village inn defined", !!INNS.jungle_village_inn && INNS.jungle_village_inn.cost > 0);

  // Transitions: the jungle gate (7,4) -> village (5,8), and back.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "south_jungle", fromX: 7, fromY: 4, toMap: VILLAGE, toX: 5, toY: 8, facing: "S" });
  tman.addLink({ fromMap: VILLAGE, fromX: 8, fromY: 7, toMap: "south_jungle", toX: 7, toY: 4, facing: "N" });
  tman.start("south_jungle", 7, 4, "S");
  const into = tman.transitionAt(7, 4);
  check("jungle gate -> village", into && into.to.mapId === VILLAGE && into.to.x === 5 && into.to.y === 8);
  const back = tman.start(VILLAGE, 8, 7, "N") && tman.transitionAt(8, 7);
  check("village gate -> jungle", back && back.to.mapId === "south_jungle" && back.to.x === 7 && back.to.y === 4);

  // Building links registered for the three fronts.
  const innerIds = bldgs.map((b) => b.id);
  check("house/shop/inn buildings registered", ["jungle_village_house", "jungle_village_shop", "jungle_village_inn"].every((i) => innerIds.includes(i)));

  return out;
}
