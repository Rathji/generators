// Validation tests for Task #137: Dwarfholm Village + Dwarven Forge Mapping.

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

  // Town + interiors exist and are square.
  for (const id of ["dwarfholm", "dwarfholm_house", "dwarfholm_inn", "dwarfholm_shop", "forge_upper", "forge_core"]) {
    const m = byId(id);
    check(id + " map exists", !!m);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
  }
  const town = byId("dwarfholm");
  const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
  check("dwarfholm has building fronts", town.rows.some((r) => /[HSIP]/.test(r)));
  check("dwarfholm has brazier tiles", town.rows.some((r) => /@/.test(r)));

  // Buildings registered, doors walkable, interiors exist.
  const bldgs = BUILDINGS.dwarfholm ?? [];
  check("dwarfholm has buildings", bldgs.length >= 3);
  const bIds = bldgs.map((b) => b.id);
  check("dwarfholm inn building", bIds.includes("dwarfholm_inn"));
  check("dwarfholm shop building", bIds.includes("dwarfholm_shop"));
  check("dwarfholm house building", bIds.includes("dwarfholm_house"));
  for (const b of bldgs) {
    check("dwarfholm interior map exists: " + b.id, !!byId(b.interior.mapId));
    check("dwarfholm door tile walkable: " + b.id, tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y));
    const tmI = TileMap.fromAscii(byId(b.interior.mapId).rows, { tiles: byId(b.interior.mapId).tiles, solid: byId(b.interior.mapId).solid });
    check("dwarfholm interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
  }

  // NPC placements on walkable tiles with dialogue data.
  const npcs = NPC_PLACEMENTS.dwarfholm ?? [];
  check("dwarfholm has resident NPCs", npcs.length >= 5);
  for (const npc of npcs) {
    check("dwarfholm npc placement walkable: " + npc.id, tm.inBounds(npc.x, npc.y) && tm.canStand(npc.x, npc.y));
    check("dwarfholm npc dialogue in data: " + npc.id, typeof npc.dialogueId === "string" && npc.dialogueId in DIALOGUE);
  }

  // The forge door tile is walkable.
  check("forge door tile walkable", tm.inBounds(10, 1) && tm.canStand(10, 1));
  // The mount-gulg door tile (dwarven gate) is walkable.
  const gulgTm = TileMap.fromAscii(byId("mount_gulg_b2").rows, { tiles: byId("mount_gulg_b2").tiles, solid: byId("mount_gulg_b2").solid });
  check("mount_gulg_b2 door tile walkable", gulgTm.inBounds(1, 1) && gulgTm.canStand(1, 1));

  // The village has a shop.
  check("dwarfholm shop defined", !!SHOPS.dwarfholm_smith && SHOPS.dwarfholm_smith.stock.length > 0);

  // Transition links: mount_gulg_b2 door <-> dwarfholm, dwarfholm -> forge.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "mount_gulg_b2", fromX: 1, fromY: 1, toMap: "dwarfholm", toX: 7, toY: 6, facing: "N" });
  tman.addLink({ fromMap: "dwarfholm", fromX: 7, fromY: 7, toMap: "mount_gulg_b2", toX: 1, toY: 1, facing: "S" });
  tman.addLink({ fromMap: "dwarfholm", fromX: 10, fromY: 1, toMap: "forge_upper", toX: 7, toY: 5, facing: "N" });
  tman.start("mount_gulg_b2", 1, 1, "N");
  const into = tman.transitionAt(1, 1);
  check("link forge depths -> dwarfholm", into && into.to.mapId === "dwarfholm" && into.to.x === 7 && into.to.y === 6);
  const backOut = tman.transitionAt(7, 7);
  check("link dwarfholm -> forge depths", backOut && backOut.to.mapId === "mount_gulg_b2" && backOut.to.x === 1 && backOut.to.y === 1);
  const toForge = tman.start("dwarfholm", 10, 1, "N") && tman.transitionAt(10, 1);
  check("link dwarfholm -> dwarven forge", toForge && toForge.to.mapId === "forge_upper" && toForge.to.x === 7 && toForge.to.y === 5);

  // Dwarven Forge dungeon def.
  const forge = DUNGEONS.dwarven_forge;
  check("dwarven forge dungeon defined", !!forge);
  check("forge has two levels", forge && forge.levels.length === 2);
  const tms = {
    forge_upper: TileMap.fromAscii(byId("forge_upper").rows, { tiles: byId("forge_upper").tiles, solid: byId("forge_upper").solid }),
    forge_core: TileMap.fromAscii(byId("forge_core").rows, { tiles: byId("forge_core").tiles, solid: byId("forge_core").solid }),
  };
  for (const id of ["forge_upper", "forge_core"]) {
    check(id + " themed", byId(id).theme === "dungeon_forge");
  }
  const entry = forge.entry;
  check("forge entry walkable", tms[entry.mapId].inBounds(entry.x, entry.y) && tms[entry.mapId].canStand(entry.x, entry.y));
  for (const s of forge.stairs) {
    check("forge stair tile walkable: " + s.id, tms[s.fromMap].inBounds(s.x, s.y) && tms[s.fromMap].canStand(s.x, s.y));
    check("forge stair destination walkable: " + s.id, tms[s.toMap].inBounds(s.toX, s.toY) && tms[s.toMap].canStand(s.toX, s.toY));
  }
  for (const ex of forge.exits) {
    check("forge exit tile walkable", tms[ex.mapId].inBounds(ex.x, ex.y) && tms[ex.mapId].canStand(ex.x, ex.y));
  }

  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("dwarven_forge", "forge_upper", 14, 10);
  check("forge stairs descend", down && down.to.mapId === "forge_core");
  const up = sys.useStairs("dwarven_forge", "forge_core", 14, 4);
  check("forge stairs ascend", up && up.to.mapId === "forge_upper");
  const exit = sys.exit("dwarven_forge", "forge_upper", 7, 1);
  check("forge exit returns to dwarfholm", exit && exit.to.mapId === "dwarfholm" && exit.to.x === 10 && exit.to.y === 1);

  // Chests sit on walkable tiles.
  const chests = CHESTS.filter((c) => c.mapId === "forge_upper" || c.mapId === "forge_core");
  check("forge has chests", chests.length >= 3);
  for (const c of chests) {
    check("forge chest on walkable tile: " + c.id, tms[c.mapId].inBounds(c.x, c.y) && tms[c.mapId].canStand(c.x, c.y));
  }

  // Boss lair tile in the forge heart is walkable (Forge Colossus, #134).
  check("forge boss tile walkable", tms.forge_core.inBounds(3, 5) && tms.forge_core.canStand(3, 5));

  // The arc's items exist.
  check("luminary item exists", !!ITEMS.luminary && ITEMS.luminary.type === "weapon");
  check("runePlate item exists", !!ITEMS.runePlate && ITEMS.runePlate.type === "armor");
  check("adamantiteOre key exists", !!ITEMS.adamantiteOre && ITEMS.adamantiteOre.keyId === "adamant");
  check("hearthstone key exists", !!ITEMS.hearthstone && ITEMS.hearthstone.keyId === "hearth");

  return out;
}
