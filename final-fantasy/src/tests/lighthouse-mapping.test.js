// Validation tests for Task #117: Pravo Lighthouse Mapping (Phantom Light).

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { ITEMS } from "../data/items.js";
import { DIALOGUE } from "../data/dialogue.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
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

  const tower = DUNGEONS.pravo_lighthouse;
  check("pravo lighthouse dungeon defined", !!tower);
  check("lighthouse has two levels", tower && tower.levels.length === 2);
  check("level 1 map exists", !!byId("lighthouse"));
  check("level 2 map exists", !!byId("lighthouse_top"));

  for (const id of ["lighthouse", "lighthouse_top"]) {
    const m = byId(id);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " themed", m && m.theme === "dungeon_phantom");
  }

  // Entry/stairs/exits on walkable tiles.
  const tm1 = TileMap.fromAscii(byId("lighthouse").rows, { tiles: byId("lighthouse").tiles, solid: byId("lighthouse").solid });
  const tm2 = TileMap.fromAscii(byId("lighthouse_top").rows, { tiles: byId("lighthouse_top").tiles, solid: byId("lighthouse_top").solid });
  const entry = tower.entry;
  check("lighthouse entry walkable", tm1.inBounds(entry.x, entry.y) && tm1.canStand(entry.x, entry.y));
  for (const s of tower.stairs) {
    const tm = s.fromMap === "lighthouse" ? tm1 : tm2;
    const toTm = s.toMap === "lighthouse" ? tm1 : tm2;
    check("lighthouse stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    check("lighthouse stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of tower.exits) {
    check("lighthouse exit tile walkable", tm1.inBounds(ex.x, ex.y) && tm1.canStand(ex.x, ex.y));
  }

  // DungeonSystem resolves transitions; exit returns to the overworld headland.
  const sys = new DungeonSystem(DUNGEONS, {});
  const up = sys.useStairs("pravo_lighthouse", "lighthouse", 14, 10);
  check("lighthouse stairs ascend", up && up.to.mapId === "lighthouse_top");
  const down = sys.useStairs("pravo_lighthouse", "lighthouse_top", 14, 4);
  check("lighthouse stairs descend", down && down.to.mapId === "lighthouse");
  const exit = sys.exit("pravo_lighthouse", "lighthouse", 7, 1);
  check("lighthouse exit returns to overworld", exit && exit.to.mapId === "overworld" && exit.to.x === 2 && exit.to.y === 10);

  // Overworld headland door links into the lighthouse.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "overworld", fromX: 2, fromY: 10, toMap: "lighthouse", toX: 7, toY: 5, facing: "N" });
  tman.start("overworld", 2, 10, "N");
  const into = tman.transitionAt(2, 10);
  check("overworld headland -> lighthouse", into && into.to.mapId === "lighthouse" && into.to.x === 7 && into.to.y === 5);

  // Decorative stair tiles are walkable.
  check("stair tile (14,10) walkable", tm1.inBounds(14, 10) && tm1.canStand(14, 10));
  check("stair tile (14,4) walkable", tm2.inBounds(14, 4) && tm2.canStand(14, 4));

  // Chests sit on walkable tiles.
  const chests = CHESTS.filter((c) => c.mapId === "lighthouse" || c.mapId === "lighthouse_top");
  check("lighthouse has chests", chests.length >= 1);
  for (const c of chests) {
    const tm = c.mapId === "lighthouse" ? tm1 : tm2;
    check("lighthouse chest on walkable tile: " + c.id, tm.inBounds(c.x, c.y) && tm.canStand(c.x, c.y));
  }

  // Boss lair tile in the lamp room is walkable (Phantom Light, Task #117).
  check("lamp room boss tile walkable", tm2.inBounds(3, 5) && tm2.canStand(3, 5));

  // Encounter tables and theme wiring.
  check("lighthouse encounter table", !!ENCOUNTERS.lighthouse && ENCOUNTERS.lighthouse.rate === 0.15);
  check("lighthouse_top uses phantom theme", ENCOUNTERS.lighthouse_top && ENCOUNTERS.lighthouse_top.theme === "dungeon_phantom");
  check("dungeon_phantom table", !!ENCOUNTERS.dungeon_phantom);

  // The Phantom Light boss + guard.
  check("phantomLight boss defined", !!ENEMIES.phantomLight && ENEMIES.phantomLight.boss === true);
  check("phantomLight drops starlightCrest", (ENEMIES.phantomLight.loot || []).some((l) => l.itemId === "starlightCrest"));
  check("phantom_light_guard group", Array.isArray(ENEMY_GROUPS.phantom_light_guard));

  // World event gates the boss.
  const ev = WORLD_EVENTS.find((e) => e.id === "phantom_light_boss");
  check("phantom_light_boss event defined", !!ev);
  check("event at lamp room lair", ev && ev.mapId === "lighthouse_top" && ev.x === 3 && ev.y === 5);
  check("event requires marsh guardian", ev && ev.require && ev.require.flag === "story_marsh_guardian_defeated");
  check("event once + flags", ev && ev.once === true && ev.doneFlag === "story_phantom_light_defeated" && ev.event.onWinFlag === "story_phantom_light_defeated");
  check("victory dialogue exists", !!DIALOGUE["plot.phantom_light_defeated"]);

  // New items.
  check("starlightCrest exists", !!ITEMS.starlightCrest && ITEMS.starlightCrest.type === "accessory" && ITEMS.starlightCrest.rarity === "legendary");
  check("sunkenIdol exists", !!ITEMS.sunkenIdol && ITEMS.sunkenIdol.type === "key" && ITEMS.sunkenIdol.keyId === "offering");

  return out;
}
