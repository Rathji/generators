// Validation tests for Task #177: The Ancient Ruins — the moss-choked
// relic vaults beneath the jungles: two levels, the Sun-Moss Relic hoard,
// the sealed Sunken Hall, its spore vents, and the way back to the coast.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { ITEMS } from "../data/items.js";
import { HAZARD_ZONES } from "../data/hazard-zones.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { GateSystem } from "../engine/gates.js";

const L1 = "ancient_ruins";
const L2 = "ancient_ruins_b2";
const ENTRY = { x: 7, y: 5 };

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };
  const byId = (id) => MAPS.find((m) => m.id === id);
  const tms = {};
  for (const id of [L1, L2]) {
    const m = byId(id);
    check(id + " map exists", !!m);
    check(id + " rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " is a ruins theme", !!m && m.theme === "dungeon_ruins");
    tms[id] = m ? TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid }) : null;
  }

  // BFS from the entry must reach the Sunken Hall's gate (15,9).
  const tm = tms[L1];
  const width = tm.width, height = tm.height;
  const reachable = new Set();
  const q = [[ENTRY.x, ENTRY.y]];
  reachable.add(ENTRY.y * width + ENTRY.x);
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!tm.canStand(nx, ny)) continue;
      const k = ny * width + nx;
      if (reachable.has(k)) continue;
      reachable.add(k);
      q.push([nx, ny]);
    }
  }
  check("gate tile reachable on foot", reachable.has(9 * width + 15));
  check("exit door reachable on foot", reachable.has(4 * width + 1));

  // The dungeon: two levels, working stairs, and the exit to the jungles.
  const d = DUNGEONS.ancient_ruins;
  check("ancient ruins dungeon defined", !!d);
  check("ruins has two levels", !!d && d.levels.length === 2);
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("ancient_ruins", L1, 15, 9);
  check("stairs descend to the Sunken Hall", down && down.to.mapId === L2 && down.to.x === 8 && down.to.y === 3);
  const up = sys.useStairs("ancient_ruins", L2, 14, 4);
  check("stairs ascend to the upper ruins", up && up.to.mapId === L1 && up.to.x === 15 && up.to.y === 9);
  const exit = sys.exit("ancient_ruins", L1, 1, 4);
  check("ruins exit returns to the jungles", exit && exit.to.mapId === "south_jungle" && exit.to.x === 17 && exit.to.y === 8);

  // The stone gate (15,9) bars the descent until the relic is held.
  const open = new GateSystem({ hasItem: (i) => i === "ruinsRelic" });
  open.add({ id: "g", mapId: L1, x: 15, y: 9, require: { item: "ruinsRelic" }, deniedDialogue: "Sealed." });
  check("gate passes with the relic", open.canPass(L1, 15, 9).allowed === true);
  const shut = new GateSystem({ hasItem: () => false });
  shut.add({ id: "g", mapId: L1, x: 15, y: 9, require: { item: "ruinsRelic" }, deniedDialogue: "The stone door of the Sunken Hall is sealed — only the Sun-Moss Relic may part it." });
  const blocked = shut.canPass(L1, 15, 9);
  check("gate blocks without the relic", blocked.allowed === false);
  check("gate has a denied message", typeof blocked.reason === "string" && blocked.reason.length > 0);

  // Chests: two upstairs, one in the hall — the Sun-Moss Relic in the east
  // hoard, all on walkable tiles.
  const ruinsChests = CHESTS.filter((c) => c.mapId === L1 || c.mapId === L2);
  check("ruins have chests", ruinsChests.length === 3);
  for (const c of ruinsChests) {
    check("ruins chest walkable: " + c.id, tms[c.mapId].inBounds(c.x, c.y) && tms[c.mapId].canStand(c.x, c.y));
  }
  const relicChest = CHESTS.find((c) => c.id === "ruins_relic_hoard");
  const holdsRelic = relicChest && (relicChest.contents.items ?? []).some((i) => i.itemId === "ruinsRelic");
  check("relic hoard holds the relic", !!holdsRelic);
  check("relic item exists", !!ITEMS.ruinsRelic && ITEMS.ruinsRelic.keyId === "ruins");

  // The Sunken Hall's spore vents sit on walkable floor.
  const spores = HAZARD_ZONES.find((z) => z.id === "ruins_spore_trap");
  check("spore vent zone defined", !!spores && spores.mapId === L2);
  check("spore vent poisons", spores && spores.status && spores.status.id === "poison");
  check("spore vent protected by sturdy boots", spores && spores.protectedBy === "sturdy boots");
  for (const tile of spores?.tiles ?? []) {
    check("spore vent tile walkable: " + tile.x + "," + tile.y, tms[L2].inBounds(tile.x, tile.y) && tms[L2].canStand(tile.x, tile.y));
  }

  return out;
}
