// Validation tests for Task #157: Labyrinth of Time Mapping.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
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

  // Maps exist and are square.
  for (const id of ["chaos_shrine_b2", "time_rift", "time_labyrinth", "chrono_throne"]) {
    const m = byId(id);
    check(id + " map exists", !!m);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
  }
  for (const id of ["time_rift", "time_labyrinth", "chrono_throne"]) {
    check(id + " themed", byId(id).theme === "dungeon_time");
  }

  const tms = {
    chaos_shrine_b2: TileMap.fromAscii(byId("chaos_shrine_b2").rows, { tiles: byId("chaos_shrine_b2").tiles, solid: byId("chaos_shrine_b2").solid }),
    time_rift: TileMap.fromAscii(byId("time_rift").rows, { tiles: byId("time_rift").tiles, solid: byId("time_rift").solid }),
    time_labyrinth: TileMap.fromAscii(byId("time_labyrinth").rows, { tiles: byId("time_labyrinth").tiles, solid: byId("time_labyrinth").solid }),
    chrono_throne: TileMap.fromAscii(byId("chrono_throne").rows, { tiles: byId("chrono_throne").tiles, solid: byId("chrono_throne").solid }),
  };

  // The rift tile in the Dark Altar is walkable.
  check("rift tile walkable", tms.chaos_shrine_b2.inBounds(1, 5) && tms.chaos_shrine_b2.canStand(1, 5));

  // The Timekeeper NPC at the shrine's entrance is placed on walkable ground
  // and its dialogue exists.
  const npcs = NPC_PLACEMENTS.chaos_shrine ?? [];
  check("chaos shrine has the Timekeeper", npcs.some((n) => n.id === "shrine_timekeeper" && n.dialogueId === "timekeeper"));
  const shrineTm = TileMap.fromAscii(byId("chaos_shrine").rows, { tiles: byId("chaos_shrine").tiles, solid: byId("chaos_shrine").solid });
  for (const npc of npcs) {
    check("timekeeper placement walkable: " + npc.id, shrineTm.inBounds(npc.x, npc.y) && shrineTm.canStand(npc.x, npc.y));
    check("timekeeper dialogue in data: " + npc.id, typeof npc.dialogueId === "string" && npc.dialogueId in DIALOGUE);
  }

  // Transition link: the Dark Altar rift -> the Time Rift.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "chaos_shrine_b2", fromX: 1, fromY: 5, toMap: "time_rift", toX: 7, toY: 5, facing: "N" });
  tman.start("chaos_shrine_b2", 1, 5, "N");
  const riftLink = tman.transitionAt(1, 5);
  check("link dark altar -> time rift", riftLink && riftLink.to.mapId === "time_rift" && riftLink.to.x === 7 && riftLink.to.y === 5);

  // Labyrinth dungeon def: three levels, stairs, exit back to the altar.
  const lab = DUNGEONS.time_labyrinth;
  check("time labyrinth dungeon defined", !!lab);
  check("labyrinth has three levels", lab && lab.levels.length === 3);
  const entry = lab.entry;
  check("labyrinth entry walkable", tms[entry.mapId].inBounds(entry.x, entry.y) && tms[entry.mapId].canStand(entry.x, entry.y));
  for (const s of lab.stairs) {
    check("labyrinth stair tile walkable: " + s.id, tms[s.fromMap].inBounds(s.x, s.y) && tms[s.fromMap].canStand(s.x, s.y));
    check("labyrinth stair destination walkable: " + s.id, tms[s.toMap].inBounds(s.toX, s.toY) && tms[s.toMap].canStand(s.toX, s.toY));
  }
  for (const ex of lab.exits) {
    check("labyrinth exit tile walkable", tms[ex.mapId].inBounds(ex.x, ex.y) && tms[ex.mapId].canStand(ex.x, ex.y));
  }

  const sys = new DungeonSystem(DUNGEONS, {});
  const d1 = sys.useStairs("time_labyrinth", "time_rift", 14, 10);
  check("rift stairs descend to labyrinth", d1 && d1.to.mapId === "time_labyrinth");
  const u1 = sys.useStairs("time_labyrinth", "time_labyrinth", 14, 4);
  check("labyrinth stairs ascend to rift", u1 && u1.to.mapId === "time_rift");
  const d2 = sys.useStairs("time_labyrinth", "time_labyrinth", 1, 5);
  check("labyrinth stairs descend to throne", d2 && d2.to.mapId === "chrono_throne");
  const u2 = sys.useStairs("time_labyrinth", "chrono_throne", 7, 1);
  check("throne stairs ascend to labyrinth", u2 && u2.to.mapId === "time_labyrinth");
  const exit = sys.exit("time_labyrinth", "time_rift", 7, 1);
  check("labyrinth exit returns to dark altar", exit && exit.to.mapId === "chaos_shrine_b2" && exit.to.x === 1 && exit.to.y === 5);

  // Chests sit on walkable tiles.
  const chests = CHESTS.filter((c) => c.mapId === "time_rift" || c.mapId === "time_labyrinth" || c.mapId === "chrono_throne");
  check("labyrinth has chests", chests.length >= 3);
  for (const c of chests) {
    check("labyrinth chest on walkable tile: " + c.id, tms[c.mapId].inBounds(c.x, c.y) && tms[c.mapId].canStand(c.x, c.y));
  }

  // Boss lair tile in the throne is walkable (Chrono, #154).
  check("chrono boss tile walkable", tms.chrono_throne.inBounds(3, 5) && tms.chrono_throne.canStand(3, 5));

  // The arc's items exist.
  check("eternalBlade item exists", !!ITEMS.eternalBlade && ITEMS.eternalBlade.type === "weapon");
  check("chronoMail item exists", !!ITEMS.chronoMail && ITEMS.chronoMail.type === "armor");
  check("chronoCore accessory exists", !!ITEMS.chronoCore && ITEMS.chronoCore.type === "accessory");
  check("voidRelic key exists", !!ITEMS.voidRelic && ITEMS.voidRelic.keyId === "void");

  return out;
}
