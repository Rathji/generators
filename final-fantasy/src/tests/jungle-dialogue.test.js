// Validation tests for Task #179: The Jungle Dialogue Set — the guide at
// the dock, the villagers' tales, and the plot beat that points to the
// Sun-Moss Relic in the ruins.

import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";

function fakeWorld(flags = {}, items = [], leader = "warrior") {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: (n) => items.includes(n),
    getLeaderClass: () => leader,
  };
}

const JUNGLE_IDS = [
  "jungleguide.greeting",
  "jungle.hunter",
  "jungle.elder",
  "jungle.shaman",
  "jungle.herbalist",
  "jungle.child",
  "jungle.villager",
  "jungle.housewife",
  "jungle.shopkeep",
  "plot.ruins_relic_found",
];

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // All jungle ids exist in the dialogue database.
  for (const id of JUNGLE_IDS) check("jungle dialogue present: " + id, id in DIALOGUE);

  // Every node resolves to text through the engine.
  const engine = new DialogueEngine({
    world: fakeWorld({}, ["ruinsRelic"]),
    state: { getFlag: () => false, setFlag: () => {} },
  });
  for (const id of JUNGLE_IDS) {
    engine.bindWorld(fakeWorld({}, ["ruinsRelic"]));
    const ok = engine.start(id);
    const p = engine.getPage();
    check("jungle node resolves to text: " + id, ok && p && typeof p.text === "string" && p.text.length > 0);
  }

  // The elder speaks in the village proper; the plot beat names the relic.
  engine.bindWorld(fakeWorld({}));
  engine.start("jungle.elder");
  check("jungle elder resolves as a plain node", engine.getPage().text.length > 0);

  engine.bindWorld(fakeWorld({}));
  const ok = engine.start("plot.ruins_relic_found");
  check("ruins relic plot beat resolves", ok);
  const relicTexts = [engine.getPage()?.text ?? ""];
  while (engine.advance()) relicTexts.push(engine.getPage()?.text ?? "");
  check("ruins relic plot beat mentions the ruins", relicTexts.join(" ").toLowerCase().includes("ruin"));

  // The guide's greeting is tied to the dock arrival.
  engine.bindWorld(fakeWorld({}));
  engine.start("jungleguide.greeting");
  check("guide greeting mentions the jungles", engine.getPage().text.toLowerCase().includes("jungle"));

  return out;
}
