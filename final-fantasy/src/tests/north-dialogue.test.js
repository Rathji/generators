// Validation tests for Task #173: Northern Dialogue Set — the wastes' scouts
// and Northwind's villagers, plus the elder's frost-crystal aftermath line.

import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";

function fakeWorld(flags = {}) {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: () => false,
    getLeaderClass: () => "warrior",
  };
}

const NORTH_IDS = [
  "northwastes.scout",
  "northwastes.hunter",
  "northwind.elder",
  "northwind.elder.default",
  "northwind.elder.after",
  "northwind.huntress",
  "northwind.trapper",
  "northwind.child",
  "northwind.villager",
  "northwind.shopkeep",
];

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const flags = {};
  const engine = new DialogueEngine({
    world: fakeWorld(flags),
    state: { setFlag: (n, v) => (flags[n] = v ?? true), getFlag: (n) => !!flags[n] },
  });

  for (const id of NORTH_IDS) {
    check("north dialogue present: " + id, id in DIALOGUE);
    const page = engine.start(id);
    check("north dialogue resolves: " + id, page && typeof page.text === "string" && page.text.length > 0);
  }

  // The elder foreshadows the crystal gate, then turns to praise once the
  // Frost Crystal is claimed.
  check("elder default mentions the crystal wall", DIALOGUE["northwind.elder.default"].pages.some((p) => p.toLowerCase().includes("crystal")));
  check("elder after celebrates the crystal", DIALOGUE["northwind.elder.after"].pages.some((p) => p.toLowerCase().includes("frost crystal")));
  const before = engine.start("northwind.elder");
  check("elder speaks default before crystal", before && before.id === "northwind.elder.default");
  flags.story_frost_crystal_taken = true;
  const after = engine.start("northwind.elder");
  check("elder branches after crystal taken", after && after.id === "northwind.elder.after");

  // The plot milestone for claiming the crystal exists.
  check("frost crystal plot node present", "plot.frost_crystal_taken" in DIALOGUE);
  const plot = engine.start("plot.frost_crystal_taken");
  check("frost crystal plot node resolves", plot && plot.text.length > 0);

  // The wastes' scouts point the way north.
  check("scout mentions the cave", DIALOGUE["northwastes.scout"].pages.some((p) => p.toLowerCase().includes("cave")) || DIALOGUE["northwastes.hunter"].pages.some((p) => p.toLowerCase().includes("cave")));
  check("hunter tells of the crystal light", DIALOGUE["northwastes.hunter"].pages.some((p) => p.toLowerCase().includes("crystal")));

  return out;
}
