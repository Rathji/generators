// Validation tests for Task #149: Secret Wall Detection — walking INTO a
// wall coordinate reveals a hidden path/cache, and the revealed wall opens
// for movement through the passability override.

import { SecretWallSystem } from "../engine/secret-walls.js";
import { SECRET_WALLS } from "../data/secret-walls.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { TileMap } from "../engine/grid.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";
import { MapManager } from "../engine/transitions.js";
import { MAPS } from "../data/maps.js";

function registry() {
  const m = new MapManager();
  for (const d of MAPS) m.register(d);
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const inventory = new Inventory();
  const party = new PartyManager({ gold: 100 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  const walls = new SecretWallSystem(SECRET_WALLS, { state, inventory, party, random: () => 0.2 });

  check("secret wall data present", SECRET_WALLS.length >= 2);
  check("wallAt finds the cave wall", walls.wallAt("caves_of_cornelia", 8, 2)?.id === "cave_north_cache");
  check("wall tile is solid", TileMap.fromAscii(
    MAPS.find((m) => m.id === "caves_of_cornelia").rows,
    { tiles: MAPS.find((m) => m.id === "caves_of_cornelia").tiles, solid: MAPS.find((m) => m.id === "caves_of_cornelia").solid }
  ).isSolid(8, 2) === true);

  // Not revealed yet: the wall still blocks movement.
  check("unrevealed wall has no override", walls.passabilityOverride("caves_of_cornelia", 8, 2) === null);
  const def = MAPS.find((m) => m.id === "caves_of_cornelia");
  const tm = TileMap.fromAscii(def.rows, { tiles: def.tiles, solid: def.solid });
  const sys = new MovementSystem(tm);
  sys.setPassabilityOverride((x, y) => walls.passabilityOverride("caves_of_cornelia", x, y));
  const player = new GridEntity(8, 3, { facing: "N" });
  sys.addEntity(player);
  check("wall blocks before reveal", sys.canMove(player, "N") === false);

  // Probing the wall (walking into it) reveals the hidden path + cache.
  const beforeGold = party.gold;
  const probe = walls.probe("caves_of_cornelia", 8, 2);
  check("probing the wall reveals it", probe.ok === true && probe.wall.id === "cave_north_cache" && probe.line.length > 0);
  check("hidden cache opens", probe.effects.some((e) => e.type === "path"));
  const chest = probe.effects.find((e) => e.type === "chest");
  check("cache grants items + gold + xp", !!chest && chest.items.some((i) => i.itemId === "goblinFang") && chest.gold === 30 && chest.xp === 20);
  check("gold deposited", party.gold === beforeGold + 30);
  check("revealed by flag", state.getFlag("secret_cave_north_cache") === true);
  check("re-probing is a no-op", walls.probe("caves_of_cornelia", 8, 2).error === "already revealed");

  // Now the wall tile opens for movement.
  check("revealed wall opens", walls.passabilityOverride("caves_of_cornelia", 8, 2) === "open");
  check("wall walkable after reveal", sys.canMove(player, "N") === true && sys.isWalkable(8, 2, player) === true);

  check("every secret wall sits on a solid tile", walls.audit(registry()).length === 0);

  return out;
}
