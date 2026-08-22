// Validation tests for Task #148: Glacierport + Frozen Caverns Mapping.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { SHOPS } from "../data/shops.js";
import { CHESTS } from "../data/chests.js";
import { ITEMS } from "../data/items.js";
import { DIALOGUE } from "../data/dialogue.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { TransitionManager, MapManager } from "../engine/transitions.js";

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

  // Town + interiors + cavern maps exist and are square.
  for (const id of ["glacierport", "glacierport_house", "glacierport_inn", "glacierport_shop", "frozen_upper", "frozen_core"]) {
    const m = byId(id);
    check(id + " map exists", !!m);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
  }
  const town = byId("glacierport");
  const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
  check("glacierport has building fronts", town.rows.some((r) => /[HSID]/.test(r)));
  check("glacierport has brazier tiles", town.rows.some((r) => /@/.test(r)));

  // Buildings registered, doors walkable, interiors exist.
  const bldgs = BUILDINGS.glacierport ?? [];
  check("glacierport has buildings", bldgs.length >= 3);
  const bIds = bldgs.map((b) => b.id);
  check("glacierport inn building", bIds.includes("glacierport_inn"));
  check("glacierport shop building", bIds.includes("glacierport_shop"));
  check("glacierport house building", bIds.includes("glacierport_house"));
  for (const b of bldgs) {
    check("glacierport interior map exists: " + b.id, !!byId(b.interior.mapId));
    check("glacierport door tile walkable: " + b.id, tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y));
    const tmI = TileMap.fromAscii(byId(b.interior.mapId).rows, { tiles: byId(b.interior.mapId).tiles, solid: byId(b.interior.mapId).solid });
    check("glacierport interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
  }

  // NPC placements on walkable tiles with dialogue data.
  const npcs = NPC_PLACEMENTS.glacierport ?? [];
  check("glacierport has resident NPCs", npcs.length >= 5);
  for (const npc of npcs) {
    check("glacierport npc placement walkable: " + npc.id, tm.inBounds(npc.x, npc.y) && tm.canStand(npc.x, npc.y));
    check("glacierport npc dialogue in data: " + npc.id, typeof npc.dialogueId === "string" && npc.dialogueId in DIALOGUE);
  }

  // The cavern door tile and the dock tile are walkable.
  check("cavern door tile walkable", tm.inBounds(10, 1) && tm.canStand(10, 1));
  check("dock tile walkable", tm.inBounds(7, 6) && tm.canStand(7, 6) && tm.inBounds(7, 7) && tm.canStand(7, 7));

  // The port has a shop.
  check("glacierport shop defined", !!SHOPS.glacierport_supply && SHOPS.glacierport_supply.stock.length > 0);

  // Transition links: overworld dock <-> glacierport, glacierport -> caverns.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "overworld", fromX: 24, fromY: 11, toMap: "glacierport", toX: 7, toY: 6, facing: "N" });
  tman.addLink({ fromMap: "glacierport", fromX: 7, fromY: 7, toMap: "overworld", toX: 24, toY: 11, facing: "S" });
  tman.addLink({ fromMap: "glacierport", fromX: 10, fromY: 1, toMap: "frozen_upper", toX: 7, toY: 5, facing: "N" });
  tman.start("overworld", 24, 11, "N");
  const into = tman.transitionAt(24, 11);
  check("link glacier dock -> glacierport", into && into.to.mapId === "glacierport" && into.to.x === 7 && into.to.y === 6);
  const backOut = tman.start("glacierport", 7, 7, "S") && tman.transitionAt(7, 7);
  check("link glacierport -> glacier dock", backOut && backOut.to.mapId === "overworld" && backOut.to.x === 24 && backOut.to.y === 11);
  const toCaverns = tman.start("glacierport", 10, 1, "N") && tman.transitionAt(10, 1);
  check("link glacierport -> frozen caverns", toCaverns && toCaverns.to.mapId === "frozen_upper" && toCaverns.to.x === 7 && toCaverns.to.y === 5);

  // Frozen Caverns dungeon def.
  const caverns = DUNGEONS.frozen_caverns;
  check("frozen caverns dungeon defined", !!caverns);
  check("caverns has two levels", caverns && caverns.levels.length === 2);
  const tms = {
    frozen_upper: TileMap.fromAscii(byId("frozen_upper").rows, { tiles: byId("frozen_upper").tiles, solid: byId("frozen_upper").solid }),
    frozen_core: TileMap.fromAscii(byId("frozen_core").rows, { tiles: byId("frozen_core").tiles, solid: byId("frozen_core").solid }),
  };
  for (const id of ["frozen_upper", "frozen_core"]) {
    check(id + " themed", byId(id).theme === "dungeon_ice");
  }
  const entry = caverns.entry;
  check("caverns entry walkable", tms[entry.mapId].inBounds(entry.x, entry.y) && tms[entry.mapId].canStand(entry.x, entry.y));
  for (const s of caverns.stairs) {
    check("cavern stair tile walkable: " + s.id, tms[s.fromMap].inBounds(s.x, s.y) && tms[s.fromMap].canStand(s.x, s.y));
    check("cavern stair destination walkable: " + s.id, tms[s.toMap].inBounds(s.toX, s.toY) && tms[s.toMap].canStand(s.toX, s.toY));
  }
  for (const ex of caverns.exits) {
    check("cavern exit tile walkable", tms[ex.mapId].inBounds(ex.x, ex.y) && tms[ex.mapId].canStand(ex.x, ex.y));
  }

  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("frozen_caverns", "frozen_upper", 14, 10);
  check("cavern stairs descend", down && down.to.mapId === "frozen_core");
  const up = sys.useStairs("frozen_caverns", "frozen_core", 14, 4);
  check("cavern stairs ascend", up && up.to.mapId === "frozen_upper");
  const exit = sys.exit("frozen_caverns", "frozen_upper", 7, 1);
  check("cavern exit returns to glacierport", exit && exit.to.mapId === "glacierport" && exit.to.x === 10 && exit.to.y === 1);

  // Chests sit on walkable tiles.
  const chests = CHESTS.filter((c) => c.mapId === "frozen_upper" || c.mapId === "frozen_core");
  check("caverns have chests", chests.length >= 3);
  for (const c of chests) {
    check("cavern chest on walkable tile: " + c.id, tms[c.mapId].inBounds(c.x, c.y) && tms[c.mapId].canStand(c.x, c.y));
  }

  // Boss lair tile in the cavern heart is walkable (Frost Wyrm, #145).
  check("frost wyrm boss tile walkable", tms.frozen_core.inBounds(3, 5) && tms.frozen_core.canStand(3, 5));

  // The arc's items exist.
  check("frozenBlade item exists", !!ITEMS.frozenBlade && ITEMS.frozenBlade.type === "weapon");
  check("rimeMail item exists", !!ITEMS.rimeMail && ITEMS.rimeMail.type === "armor");
  check("sunstone key exists", !!ITEMS.sunstone && ITEMS.sunstone.keyId === "sun");
  check("frostScale key exists", !!ITEMS.frostScale && ITEMS.frostScale.keyId === "frost");

  return out;
}
