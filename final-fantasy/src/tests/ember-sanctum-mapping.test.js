// Validation tests for Task #127: Ember Sanctum Mapping (Fire Fiend arc).

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { ITEMS } from "../data/items.js";
import { LANDMARKS } from "../data/landmarks.js";
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

  const sanctum = DUNGEONS.ember_sanctum;
  check("ember sanctum dungeon defined", !!sanctum);
  check("sanctum has three levels", sanctum && sanctum.levels.length === 3);
  for (const id of ["ember_sanctum", "ember_sanctum_b2", "ember_sanctum_core"]) {
    check(id + " map exists", !!byId(id));
    const m = byId(id);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " themed", m && m.theme === "dungeon_ember");
  }

  // Entry/stairs/exits on walkable tiles.
  const tms = {};
  for (const id of ["ember_sanctum", "ember_sanctum_b2", "ember_sanctum_core"]) {
    const m = byId(id);
    tms[id] = TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid });
  }
  const entry = sanctum.entry;
  check("sanctum entry walkable", tms[entry.mapId].inBounds(entry.x, entry.y) && tms[entry.mapId].canStand(entry.x, entry.y));
  for (const s of sanctum.stairs) {
    const tm = tms[s.fromMap];
    const toTm = tms[s.toMap];
    check("stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    check("stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of sanctum.exits) {
    check("exit tile walkable", tms[ex.mapId].inBounds(ex.x, ex.y) && tms[ex.mapId].canStand(ex.x, ex.y));
  }

  // DungeonSystem resolves all three levels.
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("ember_sanctum", "ember_sanctum", 14, 10);
  check("sanctum stairs descend", down && down.to.mapId === "ember_sanctum_b2");
  const up = sys.useStairs("ember_sanctum", "ember_sanctum_b2", 14, 4);
  check("sanctum stairs ascend", up && up.to.mapId === "ember_sanctum");
  const intoCore = sys.useStairs("ember_sanctum", "ember_sanctum_b2", 1, 5);
  check("core stairs descend", intoCore && intoCore.to.mapId === "ember_sanctum_core");
  const outCore = sys.useStairs("ember_sanctum", "ember_sanctum_core", 7, 1);
  check("core stairs ascend", outCore && outCore.to.mapId === "ember_sanctum_b2");
  const exit = sys.exit("ember_sanctum", "ember_sanctum", 7, 1);
  check("sanctum exit returns to overworld peak", exit && exit.to.mapId === "overworld" && exit.to.x === 18 && exit.to.y === 2);

  // Overworld peak door links into the sanctum.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "overworld", fromX: 18, fromY: 2, toMap: "ember_sanctum", toX: 7, toY: 5, facing: "N" });
  tman.start("overworld", 18, 2, "N");
  const into = tman.transitionAt(18, 2);
  check("overworld peak -> ember sanctum", into && into.to.mapId === "ember_sanctum" && into.to.x === 7 && into.to.y === 5);

  // The peak is in the north-east mountain range (airship terrain).
  const ow = byId("overworld");
  const owT = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  check("peak tile standable", owT.inBounds(18, 2) && owT.canStand(18, 2));
  check("peak is mountain terrain", ow.terrain?.[ow.rows[2][18]] === "mountain", "char=" + ow.rows[2][18]);

  // Landmark exists and reveals with the airship.
  const landmark = LANDMARKS.find((l) => l.id === "ember_sanctum");
  check("ember landmark defined", !!landmark && landmark.x === 18 && landmark.y === 2);
  check("landmark gated on airship", landmark && landmark.revealFlag === "airship_obtained");

  // Decorative magma vents are walkable.
  check("vent tile (12,2) walkable", tms.ember_sanctum.inBounds(12, 2) && tms.ember_sanctum.canStand(12, 2));
  check("vent tile (2,8) walkable", tms.ember_sanctum.inBounds(2, 8) && tms.ember_sanctum.canStand(2, 8));
  check("vent tile (3,3) walkable", tms.ember_sanctum_b2.inBounds(3, 3) && tms.ember_sanctum_b2.canStand(3, 3));
  check("core vent tile (2,3) walkable", tms.ember_sanctum_core.inBounds(2, 3) && tms.ember_sanctum_core.canStand(2, 3));
  check("core save tile (8,5) walkable", tms.ember_sanctum_core.inBounds(8, 5) && tms.ember_sanctum_core.canStand(8, 5));

  // Chests sit on walkable tiles.
  const chests = CHESTS.filter((c) => c.mapId.startsWith("ember_sanctum"));
  check("sanctum has chests", chests.length >= 3);
  for (const c of chests) {
    check("chest on walkable tile: " + c.id, tms[c.mapId].inBounds(c.x, c.y) && tms[c.mapId].canStand(c.x, c.y));
  }

  // Boss lair tile in the Molten Core is walkable (Ember Fiend, Task #124).
  check("core boss tile walkable", tms.ember_sanctum_core.inBounds(3, 5) && tms.ember_sanctum_core.canStand(3, 5));

  // The arc's items exist.
  check("infernoBrand item exists", !!ITEMS.infernoBrand && ITEMS.infernoBrand.type === "weapon");
  check("magmaHeart item exists", !!ITEMS.magmaHeart && ITEMS.magmaHeart.type === "accessory");
  check("emberCore key exists", !!ITEMS.emberCore && ITEMS.emberCore.keyId === "ember");

  return out;
}
