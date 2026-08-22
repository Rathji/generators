// Validation tests for Task #185: the Waystone Keeper — NPC placement,
// dialogue branches, and the Waystone Pilgrim quest definition.

import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { GameState } from "../engine/state.js";
import { ITEMS } from "../data/items.js";
import { MAPS } from "../data/maps.js";

function mkWorld(flags = {}, items = []) {
  const state = new GameState();
  for (const [k, v] of Object.entries(flags)) state.setFlag(k, v);
  return { state, getFlag: (n) => state.getFlag(n), hasItem: (n) => items.includes(n) };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const keeper = NPC_PLACEMENTS.cornelia?.find((n) => n.id === "cornelia_waystone_keeper");
  check("keeper placed in cornelia", !!keeper);
  check("keeper dialogue id", keeper?.dialogueId === "cornelia.waystone_keeper");
  const corn = MAPS.find((m) => m.id === "cornelia");
  check("keeper on a walkable cornelia tile", !!keeper && !!corn && corn.rows[keeper.y]?.[keeper.x] === "." && !corn.solid?.[corn.rows[keeper.y]?.[keeper.x]]);

  const q = SIDE_QUESTS.the_waystone_pilgrim;
  check("quest defined", !!q);
  check("quest name", q?.name === "The Waystone Pilgrim");
  check("single step", q?.steps?.length === 1 && q?.steps?.[0]?.flag === "sq_waystone_pilgrim_all");
  check("reward item exists", !!ITEMS[q?.reward?.item]);
  check("reward is the charm", q?.reward?.item === "wayfarerCharm" && q?.reward?.gold === 300);

  const world = mkWorld({});
  const d = new DialogueEngine({ data: DIALOGUE, world, state: world.state });
  check("keeper default branch", d.start("cornelia.waystone_keeper") && d.current?.id === "cornelia.waystone_keeper.default");
  check("offer choice starts quest", d.getChoices()?.some((c) => c.text.includes("light them all") && c.flag === "sq_the_waystone_pilgrim_started"));
  const choice = d.getChoices().find((c) => c.flag === "sq_the_waystone_pilgrim_started");
  const chosen = d.choose(choice.index);
  check("accepting sets started flag", chosen.ok === true && world.state.getFlag("sq_the_waystone_pilgrim_started"));
  check("routed to accepted node", chosen.next === "cornelia.waystone_keeper.accepted");

  const w2 = mkWorld({ sq_the_waystone_pilgrim_started: true });
  const d2 = new DialogueEngine({ data: DIALOGUE, world: w2, state: w2.state });
  check("progress branch mid-quest", d2.start("cornelia.waystone_keeper") && d2.current?.id === "cornelia.waystone_keeper.progress");

  const w3 = mkWorld({ sq_waystone_pilgrim_all: true });
  const d3 = new DialogueEngine({ data: DIALOGUE, world: w3, state: w3.state });
  check("done branch when all lit", d3.start("cornelia.waystone_keeper") && d3.current?.id === "cornelia.waystone_keeper.done");

  const w4 = mkWorld({ sq_the_waystone_pilgrim_done: true });
  const d4 = new DialogueEngine({ data: DIALOGUE, world: w4, state: w4.state });
  check("after branch when quest done", d4.start("cornelia.waystone_keeper") && d4.current?.id === "cornelia.waystone_keeper.after");

  return out;
}
