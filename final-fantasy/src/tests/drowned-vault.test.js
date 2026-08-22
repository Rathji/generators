// Validation tests for Task #116: The Drowned Vault (tide-sealed treasure).

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMY_GROUPS } from "../data/enemies.js";
import { ITEMS } from "../data/items.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { GateSystem } from "../engine/gates.js";

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

  const vault = byId("sea_vault");
  check("vault map exists", !!vault);
  check("vault rows square", vault && vault.rows.every((r) => r.length === vault.rows[0].length));
  check("vault themed", vault && typeof vault.theme === "string");
  const tm = TileMap.fromAscii(vault.rows, { tiles: vault.tiles, solid: vault.solid });

  // The sea shrine has three levels now.
  const shrine = DUNGEONS.sea_shrine;
  check("sea shrine has three levels", shrine && shrine.levels.length === 3);
  check("vault is level 3", shrine?.levels[2].mapId === "sea_vault");

  // Vault stairs resolve both ways.
  const sys = new DungeonSystem(DUNGEONS, {});
  const into = sys.useStairs("sea_shrine", "sea_shrine_b2", 1, 5);
  check("vault stairs descend", into && into.to.mapId === "sea_vault" && into.to.x === 7 && into.to.y === 5);
  const outv = sys.useStairs("sea_shrine", "sea_vault", 7, 1);
  check("vault stairs ascend", outv && outv.to.mapId === "sea_shrine_b2" && outv.to.x === 1 && outv.to.y === 5);

  // Vault chest on a walkable tile, holding the Triton Crown.
  const chest = CHESTS.find((c) => c.id === "vault_chest_crown");
  check("vault chest exists", !!chest && chest.mapId === "sea_vault");
  check("vault chest on walkable tile", chest && tm.inBounds(chest.x, chest.y) && tm.canStand(chest.x, chest.y));
  check("vault chest holds triton crown", !!chest && chest.contents.items?.some((i) => i.itemId === "tritonCrown"));
  check("tritonCrown item exists", !!ITEMS.tritonCrown);

  // The Tide Key gate seals the vault door (sea_shrine_b2 1,5).
  const gates = new GateSystem({ getFlag: () => false, hasItem: () => false });
  gates.add({ id: "vault_gate", mapId: "sea_shrine_b2", x: 1, y: 5, require: { item: "tideKey" }, deniedDialogue: "sealed" });
  const denied = gates.canPass("sea_shrine_b2", 1, 5);
  check("vault door sealed without tide key", denied.allowed === false && denied.gate.id === "vault_gate");
  const openGates = new GateSystem({ getFlag: () => false, hasItem: (id) => id === "tideKey" });
  openGates.add({ id: "vault_gate", mapId: "sea_shrine_b2", x: 1, y: 5, require: { item: "tideKey" }, deniedDialogue: "sealed" });
  check("vault door opens with tide key", openGates.canPass("sea_shrine_b2", 1, 5).allowed === true);
  check("ungated tile unaffected", gates.canPass("sea_shrine_b2", 3, 5).allowed === true);

  // Vault encounter table references valid groups.
  const table = ENCOUNTERS.sea_vault;
  check("vault encounter table defined", !!table && Array.isArray(table.table));
  const missing = [];
  for (const entry of table?.table ?? []) {
    if (!ENEMY_GROUPS[entry.group]) missing.push(entry.group);
  }
  check("vault table groups valid", missing.length === 0, missing.join(", "));

  return out;
}
