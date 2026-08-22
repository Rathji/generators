// Validation tests for Task #49: Town NPC Placement Map.

import { NpcPlacementSystem } from "../engine/npcs.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";

function registry() {
  const m = new MapManager();
  for (const def of MAPS) m.register(def);
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const maps = registry();
  const placements = JSON.parse(JSON.stringify(NPC_PLACEMENTS));
  const sys = new NpcPlacementSystem(placements, maps);

  check("all placements valid", sys.isValid() === true);
  check("no invalid placement records", sys.invalidPlacements.length === 0);

  const cornelia = sys.npcsFor("cornelia");
  check("cornelia has residents", cornelia.length >= 4);
  check("every npc has coords+facing", cornelia.every((n) => Number.isInteger(n.x) && Number.isInteger(n.y) && ["N", "S", "E", "W"].includes(n.facing)));
  check("every npc references dialogue", cornelia.every((n) => typeof n.dialogueId === "string"));

  const guard = sys.npcAt("cornelia", 8, 3);
  check("npcAt finds guard", guard && guard.id === "cornelia_guard");
  check("npcAt empty tile returns null", sys.npcAt("cornelia", 1, 1) === null);

  check("npcById global lookup", sys.npcById("cave_hermit")?.name === "Hermit");
  check("npcById unknown", sys.npcById("nope") === null);

  const moved = sys.moveNpc("cornelia", "cornelia_guard", 2, 2);
  check("moveNpc succeeds on walkable tile", moved.ok === true && sys.npcAt("cornelia", 2, 2)?.id === "cornelia_guard");
  const blocked = sys.moveNpc("cornelia", "cornelia_guard", 0, 0);
  check("moveNpc blocks solid tile", blocked.ok === false && blocked.error === "solid tile");
  const ob = sys.moveNpc("cornelia", "cornelia_guard", 99, 99);
  check("moveNpc blocks out of bounds", ob.ok === false);

  const oldX = sys.npcAt("cornelia", 2, 2).x;
  check("failed move keeps position", oldX === 2);

  const flatCount = Object.values(NPC_PLACEMENTS).reduce((s, list) => s + list.length, 0);
  check("allNpcs flat list", sys.allNpcs().length === flatCount);

  const setF = sys.setFacing("cornelia_guard", "W");
  check("setFacing works", setF === true && sys.npcById("cornelia_guard").facing === "W");

  check("npcsAtAny finds coords", sys.npcsAtAny("cornelia", [[2, 2]]).length === 1);

  const bad = new NpcPlacementSystem({ badtown: [{ id: "x", name: "X", x: 0, y: 0, facing: "S" }] }, maps);
  check("unknown map flagged invalid", bad.isValid() === false);

  const badTile = new NpcPlacementSystem(
    { cornelia: [{ id: "wallnpc", name: "W", x: 0, y: 0, facing: "N" }] },
    maps
  );
  check("solid-tile placement flagged", badTile.invalidPlacements[0].reason === "solid tile");

  return out;
}
