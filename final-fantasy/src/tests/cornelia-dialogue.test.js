// Validation tests for Task #83: Cornelia NPC Dialogue Set.

import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";

function fakeWorld(flags = {}, items = [], leader = "warrior") {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: (n) => items.includes(n),
    getLeaderClass: () => leader,
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const keys = Object.keys(DIALOGUE);
  check("dialogue database non-empty", keys.length > 0);

  // Every cornelia NPC has dialogue content.
  const npcIds = ["cornelia.guard", "cornelia.elder", "cornelia.woman", "cornelia.child", "cornelia.innkeeper", "cornelia.blacksmith", "cornelia.mayor", "cornelia.townsman", "cornelia.castle_guard"];
  for (const id of npcIds) {
    check("dialogue present for " + id, id in DIALOGUE);
  }

  // Dialogue engine can start every cornelia node and get text.
  const flags = { king_met: true };
  const items = ["crystalKey"];
  const engine = new DialogueEngine({
    world: fakeWorld(flags, items),
    state: {
      getFlag: (n) => !!flags[n],
      setFlag: (n, v) => {
        flags[n] = v ?? true;
      },
    },
  });

  // Branching guard: with crystalKey it picks the "open" branch.
  engine.start("cornelia.castle_guard");
  const page = engine.getPage();
  check("castle guard branches to open with key", page && page.text.includes("throne room"));

  engine.bindWorld(fakeWorld({}, []));
  engine.start("cornelia.castle_guard");
  const page2 = engine.getPage();
  check("castle guard barred without key", page2 && page2.text.includes("barred"));

  // Each cornelia node resolves to a page with text.
  for (const id of npcIds) {
    engine.bindWorld(fakeWorld({ king_met: true }, ["crystalKey"]));
    const ok = engine.start(id);
    const p = engine.getPage();
    check("node resolves to text: " + id, ok && p && typeof p.text === "string" && p.text.length > 0);
  }

  // Plot king plea branches by leader class and choices set flags.
  engine.bindWorld(fakeWorld({}));
  engine.start("plot.king_plea");
  const choices = engine.getChoices();
  check("king plea offers choices", choices.length === 2);
  engine.choose(0);
  check("accept choice set flag", flags.plot_accept === true);

  return out;
}
