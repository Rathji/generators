// Validation tests for Task #197: the Remembrance Sage — placed in Castle
// Cornelia, with dialogue that offers the next cycle once Chrono falls.

import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";
import { GameState } from "../engine/state.js";
import { MAPS } from "../data/maps.js";

function mkWorld(flags = {}) {
  const state = new GameState();
  for (const [k, v] of Object.entries(flags)) state.setFlag(k, v);
  return { state, getFlag: (n) => state.getFlag(n), hasItem: () => false };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sage = NPC_PLACEMENTS.cornelia_castle?.find((n) => n.id === "cornelia_sage");
  check("sage placed in castle", !!sage);
  check("sage dialogue id", sage?.dialogueId === "cornelia.sage");
  const castle = MAPS.find((m) => m.id === "cornelia_castle");
  check("sage on walkable tile", !!sage && !!castle && castle.rows[sage.y]?.[sage.x] === "." && !castle.solid?.[castle.rows[sage.y]?.[sage.x]]);

  const world = mkWorld({});
  const d = new DialogueEngine({ data: DIALOGUE, world, state: world.state });
  check("before branch", d.start("cornelia.sage") && d.current?.id === "cornelia.sage.before");

  const w2 = mkWorld({ story_chrono_defeated: true });
  const d2 = new DialogueEngine({ data: DIALOGUE, world: w2, state: w2.state });
  check("offer branch after chrono", d2.start("cornelia.sage") && d2.current?.id === "cornelia.sage.offer");
  const offer = d2.getChoices();
  check("offer has begin-cycle choice", offer?.some((c) => c.text.includes("Begin the next cycle") && c.flag === "ngplus_begin_requested"));
  const beginIdx = offer.findIndex((c) => c.flag === "ngplus_begin_requested");
  const chose = d2.choose(beginIdx);
  check("begin sets request flag", chose.ok === true && w2.state.getFlag("ngplus_begin_requested") === true);
  check("routes to begin node", chose.next === "cornelia.sage.begin");

  const w3 = mkWorld({ ngplus_cycle: 2 });
  const d3 = new DialogueEngine({ data: DIALOGUE, world: w3, state: w3.state });
  check("cycle branch in a cycle", d3.start("cornelia.sage") && d3.current?.id === "cornelia.sage.cycle");

  const w4 = mkWorld({ ngplus_cycle: 2, ngplus_echo_defeated: true });
  const d4 = new DialogueEngine({ data: DIALOGUE, world: w4, state: w4.state });
  check("after-echo branch", d4.start("cornelia.sage") && d4.current?.id === "cornelia.sage.after_echo");

  return out;
}
