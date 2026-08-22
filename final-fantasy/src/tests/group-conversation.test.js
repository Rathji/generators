// Validation tests for Task #139: Group Conversation Logic — interacting
// with one NPC initiates multi-NPC dialogue (per-page speakers + a `with`
// participant list).

import { DialogueEngine } from "../engine/dialogue.js";
import { GroupConversationSystem } from "../engine/group-conversation.js";
import { DIALOGUE } from "../data/dialogue.js";
import { NpcPlacementSystem } from "../engine/npcs.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";
import { GameState } from "../engine/state.js";

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

  const state = new GameState();
  const engine = new DialogueEngine({ data: DIALOGUE, state });
  const placements = new NpcPlacementSystem(NPC_PLACEMENTS, registry(), { state });
  const group = new GroupConversationSystem({ engine, placements });

  // Starting the group dialogue reports both participants.
  const res = group.start("cornelia.group");
  check("group dialogue starts", res !== null && res.text !== undefined);
  check("participants reported", Array.isArray(res.with) && res.with.includes("cornelia_guard") && res.with.includes("cornelia_mayor"));
  check("participants() from node", group.participants(engine.current.node).length === 2);

  // The dialogue passes between speakers page by page.
  const p1 = engine.getPage();
  check("page 1 spoken by the guard", p1.speaker === "Town Guard");
  const p2 = engine.advance();
  check("page 2 spoken by the mayor", p2.speaker === "Mayor");
  const p3 = engine.advance();
  check("page 3 spoken by the guard", p3.speaker === "Town Guard");
  const end = engine.advance();
  check("conversation ends", end.done === true);

  // Plain single-speaker dialogues are unaffected.
  const plain = group.start("cornelia.innkeeper");
  check("plain dialogue has no participants", plain.with.length === 0);
  check("plain dialogue keeps speaker", engine.getPage().speaker === "Innkeeper");

  // nearby() finds the NPCs standing near a tile (guard at 8,3, mayor 11,4).
  const near = group.nearby("cornelia", 9, 3, 3);
  check("nearby finds the guard", near.some((n) => n.id === "cornelia_guard"));
  check("nearby finds the mayor within radius", near.some((n) => n.id === "cornelia_mayor"));
  const far = group.nearby("cornelia", 0, 0, 1);
  check("far-away NPCs excluded", far.length === 0);

  return out;
}
