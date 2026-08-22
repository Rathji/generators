// Validation tests for Task #108: Wind Shrine NPC Dialogue Set.

import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { TileMap } from "../engine/grid.js";

function fakeWorld(flags = {}, items = [], leader = "warrior") {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: (n) => items.includes(n),
    getLeaderClass: () => leader,
  };
}

function allText(engine) {
  const texts = [];
  let guard = 0;
  while (engine.isActive() && guard++ < 10) {
    const p = engine.getPage();
    if (p) texts.push(p.text);
    const a = engine.advance();
    if (a && a.waitingForChoice) break;
  }
  return texts.join(" ");
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // Every wind shrine NPC dialogue exists.
  const ids = [
    "wind_shrine.keeper",
    "wind_shrine.keeper.before",
    "wind_shrine.keeper.welcome",
    "wind_shrine.keeper.after",
    "wind_shrine.pilgrim",
    "wind_shrine.acolyte",
    "wind_shrine.chorister",
    "plot.wind_fiend_defeated",
  ];
  for (const id of ids) {
    check("wind shrine dialogue present: " + id, id in DIALOGUE);
  }

  const engine = new DialogueEngine({ world: fakeWorld({}, []), state: { getFlag: () => false, setFlag: () => {} } });
  for (const id of ids) {
    const page = engine.start(id);
    check("wind shrine node resolves: " + id, page && typeof page.text === "string" && page.text.length > 0);
  }

  // Keeper branches on airship/fiend progress.
  engine.bindWorld(fakeWorld({}, []));
  engine.start("wind_shrine.keeper");
  check("keeper default warns of the fiend", allText(engine).includes("Wind Fiend"));
  engine.bindWorld(fakeWorld({ airship_obtained: true }, []));
  engine.start("wind_shrine.keeper");
  check("keeper welcomes airship traveler", allText(engine).includes("airship"));
  engine.bindWorld(fakeWorld({ story_wind_fiend_defeated: true }, ["airshipEngine"]));
  engine.start("wind_shrine.keeper");
  check("keeper celebrates fiend defeat", allText(engine).includes("storms") || allText(engine).includes("quiet"));

  // Acolyte hints at the lightning weakness.
  engine.bindWorld(fakeWorld({}, []));
  engine.start("wind_shrine.acolyte");
  check("acolyte hints at lightning", allText(engine).includes("lightning") || allText(engine).includes("thunder"));

  // NPC placements sit on walkable tiles of the shrine maps.
  const shrineMap = MAPS.find((m) => m.id === "wind_shrine");
  const tm = TileMap.fromAscii(shrineMap.rows, { tiles: shrineMap.tiles, solid: shrineMap.solid });
  const npcs = NPC_PLACEMENTS.wind_shrine ?? [];
  check("wind shrine has resident NPCs", npcs.length >= 3);
  for (const npc of npcs) {
    check("wind shrine npc placement walkable: " + npc.id, tm.inBounds(npc.x, npc.y) && tm.canStand(npc.x, npc.y));
    check("wind shrine npc dialogue in data: " + npc.id, typeof npc.dialogueId === "string" && npc.dialogueId in DIALOGUE);
  }

  return out;
}
