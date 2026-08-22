// Validation tests for Task #182: Stormhold Castle — the highlands keep,
// with its throne room and barracks interiors, its herald and guards, and
// the road links back to the highlands pass.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DIALOGUE } from "../data/dialogue.js";
import { TileMap } from "../engine/grid.js";
import { MapManager, TransitionManager } from "../engine/transitions.js";

const CASTLE = "highlands_castle";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };
  const byId = (id) => MAPS.find((m) => m.id === id);

  const m = byId(CASTLE);
  check("castle map exists", !!m);
  check("castle rows square", !!m && m.rows.every((r) => r.length === m.rows[0].length));
  const tm = TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid });

  // The north gate (V, 13,1) leads back to the highlands road.
  check("castle gate walkable", tm.inBounds(13, 1) && tm.canStand(13, 1));
  check("castle has building fronts", m.rows.some((r) => /[KSB]/.test(r)));

  // Throne room and barracks — doors walkable, interiors with walkable exits.
  const bldgs = BUILDINGS[CASTLE] ?? [];
  check("castle has buildings", bldgs.length === 2);
  const bIds = bldgs.map((b) => b.id);
  check("throne room building", bIds.includes("highlands_castle_throne"));
  check("barracks building", bIds.includes("highlands_castle_barracks"));
  for (const b of bldgs) {
    check("castle interior map exists: " + b.id, !!byId(b.interior.mapId));
    check("castle door walkable: " + b.id, tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y));
    const interior = byId(b.interior.mapId);
    const tmI = TileMap.fromAscii(interior.rows, { tiles: interior.tiles, solid: interior.solid });
    check("castle interior exit walkable: " + b.id, tmI.inBounds(b.exit.x, b.exit.y) && tmI.canStand(b.exit.x, b.exit.y));
    check("castle interior spawn walkable: " + b.id, tmI.inBounds(b.interior.x, b.interior.y) && tmI.canStand(b.interior.x, b.interior.y));
  }

  // Castle NPCs stand on walkable ground and speak real dialogue.
  for (const mapId of [CASTLE, "highlands_castle_throne", "highlands_castle_barracks"]) {
    const npcs = NPC_PLACEMENTS[mapId] ?? [];
    check(mapId + " has residents", npcs.length >= 1);
    for (const n of npcs) {
      const m2 = byId(mapId);
      const tm2 = TileMap.fromAscii(m2.rows, { tiles: m2.tiles, solid: m2.solid });
      check(mapId + " npc walkable: " + n.id, tm2.inBounds(n.x, n.y) && tm2.canStand(n.x, n.y));
      check(mapId + " npc dialogue present: " + n.id, typeof n.dialogueId === "string" && n.dialogueId in DIALOGUE);
    }
  }

  // Transitions: the highlands gate (3,1) <-> castle north gate (13,1).
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "west_highlands", fromX: 3, fromY: 1, toMap: CASTLE, toX: 13, toY: 1, facing: "S" });
  tman.addLink({ fromMap: CASTLE, fromX: 13, fromY: 1, toMap: "west_highlands", toX: 3, toY: 1, facing: "N" });
  tman.start("west_highlands", 3, 1, "S");
  const into = tman.transitionAt(3, 1);
  check("highlands gate -> castle", into && into.to.mapId === CASTLE && into.to.x === 13 && into.to.y === 1);
  const back = tman.start(CASTLE, 13, 1, "N") && tman.transitionAt(13, 1);
  check("castle gate -> highlands", back && back.to.mapId === "west_highlands" && back.to.x === 3 && back.to.y === 1);

  return out;
}
