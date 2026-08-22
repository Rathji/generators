// Validation tests for Task #174: The Ice Cave Mapping — the wastes' frozen
// depths: its two levels, slippery ice floors, crystal gate, stairs, chests,
// and the frost vents of the crystal chamber.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { ITEMS } from "../data/items.js";
import { HAZARD_ZONES } from "../data/hazard-zones.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { GateSystem } from "../engine/gates.js";
import { TerrainRules } from "../engine/terrain.js";

const LEVELS = ["ice_cave_upper", "ice_cave_b2"];
const UPPER = "ice_cave_upper";
const B2 = "ice_cave_b2";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const byId = (id) => MAPS.find((m) => m.id === id);
  const tms = {};
  for (const id of LEVELS) {
    const m = byId(id);
    check(id + " map exists", !!m);
    check(id + " rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " is an ice-cave theme", !!m && m.theme === "dungeon_ice_cave");
    tms[id] = m ? TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid }) : null;
  }

  // Ice floors ('+') classify as ice terrain on both levels.
  for (const id of LEVELS) {
    const m = byId(id);
    const tr = new TerrainRules(m);
    const iceTiles = m.rows.flatMap((r, y) => [...r].map((ch, x) => (ch === "+" ? { x, y } : null)).filter(Boolean));
    check(id + " has ice floors", iceTiles.length >= 3);
    check(id + " ice floors are ice terrain", iceTiles.every((t) => tr.terrainAt(t.x, t.y) === "ice"));
    check(id + " clear floors are land", tr.terrainAt(2, 1) === "land");
  }

  // Dungeon def: two levels, working stairs and the way back to the wastes.
  const d = DUNGEONS.ice_cave;
  check("ice cave dungeon defined", !!d);
  check("ice cave has two levels", !!d && d.levels.length === 2);
  check("ice cave entry walkable", tms[UPPER].canStand(d.entry.x, d.entry.y));
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("ice_cave", UPPER, 14, 10);
  check("stairs descend to the chamber", down && down.to.mapId === B2 && down.to.x === 8 && down.to.y === 3);
  const up = sys.useStairs("ice_cave", B2, 14, 4);
  check("stairs ascend to the upper cave", up && up.to.mapId === UPPER && up.to.x === 14 && up.to.y === 10);
  const exit = sys.exit("ice_cave", UPPER, 7, 1);
  check("exit returns to the wastes", exit && exit.to.mapId === "north_wastes" && exit.to.x === 18 && exit.to.y === 9);

  // The crystal gate (14,10) bars the descent until the Frost Crystal is held.
  const open = new GateSystem({ hasItem: (i) => i === "frostCrystal" });
  open.add({ id: "g", mapId: UPPER, x: 14, y: 10, require: { item: "frostCrystal" }, deniedDialogue: "The crystal wall holds fast." });
  check("gate passes with the crystal", open.canPass(UPPER, 14, 10).allowed === true);
  const shut = new GateSystem({ hasItem: () => false });
  shut.add({ id: "g", mapId: UPPER, x: 14, y: 10, require: { item: "frostCrystal" }, deniedDialogue: "A wall of living crystal bars the way." });
  const blocked = shut.canPass(UPPER, 14, 10);
  check("gate blocks without the crystal", blocked.allowed === false);
  check("gate has a denied message", typeof blocked.reason === "string" && blocked.reason.length > 0);

  // Chests: three in the cave, the Frost Crystal in the hoard by the mouth.
  const caveChests = CHESTS.filter((c) => c.mapId === UPPER || c.mapId === B2);
  check("ice cave has chests", caveChests.length === 3);
  for (const c of caveChests) {
    check("ice cave chest walkable: " + c.id, tms[c.mapId].inBounds(c.x, c.y) && tms[c.mapId].canStand(c.x, c.y));
  }
  const crystalChest = CHESTS.find((c) => c.id === "ice_chest_crystal");
  const holdsCrystal = crystalChest && (crystalChest.contents.items ?? []).some((i) => i.itemId === "frostCrystal");
  check("frost crystal chest holds the crystal", !!holdsCrystal);
  check("frost crystal item exists", !!ITEMS.frostCrystal && ITEMS.frostCrystal.keyId === "frost_crystal");

  // The crystal chamber's frost vents sit on walkable ice.
  const frost = HAZARD_ZONES.find((z) => z.id === "ice_cave_frost");
  check("frost vent zone defined", !!frost && frost.mapId === B2);
  check("frost vent is ice-element", frost && frost.element === "ice");
  check("frost vent protected by Frost Cloak", frost && frost.protectedBy === "Frost Cloak");
  for (const tile of frost?.tiles ?? []) {
    check("frost vent tile walkable: " + tile.x + "," + tile.y, tms[B2].inBounds(tile.x, tile.y) && tms[B2].canStand(tile.x, tile.y));
    check("frost vent tile is ice terrain: " + tile.x + "," + tile.y, new TerrainRules(byId(B2)).terrainAt(tile.x, tile.y) === "ice");
  }

  return out;
}
