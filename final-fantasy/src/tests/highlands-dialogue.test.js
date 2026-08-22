// Validation tests for Task #183: The Highlands Dialogue Set — the duke and
// duchess of Stormhold, the herald at the gates, and the patrols that watch
// the wind-swept roads.

import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";

function fakeWorld(flags = {}, items = [], leader = "warrior") {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: (n) => items.includes(n),
    getLeaderClass: () => leader,
  };
}

const HIGHLANDS_IDS = [
  "highlands.scout",
  "highlands.guard",
  "highlands.herald",
  "highlands.duke",
  "highlands.duchess",
  "highlands.captain",
];

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // All highland ids exist.
  for (const id of HIGHLANDS_IDS) check("highlands dialogue present: " + id, id in DIALOGUE);

  // Every node resolves to text through the engine.
  const engine = new DialogueEngine({
    world: fakeWorld({}, []),
    state: { getFlag: () => false, setFlag: () => {} },
  });
  for (const id of HIGHLANDS_IDS) {
    engine.bindWorld(fakeWorld({}, []));
    const ok = engine.start(id);
    const p = engine.getPage();
    check("highlands node resolves to text: " + id, ok && p && typeof p.text === "string" && p.text.length > 0);
  }

  // The duke speaks from the throne room; the herald from the gates.
  engine.bindWorld(fakeWorld({}));
  engine.start("highlands.duke");
  check("duke resolves as a plain node", engine.getPage().text.length > 0);
  engine.bindWorld(fakeWorld({}));
  engine.start("highlands.herald");
  const heraldText = (engine.getPage()?.text ?? "").toLowerCase();
  check("herald welcomes to Stormhold", heraldText.includes("stormhold") || heraldText.includes("castle"));
  engine.bindWorld(fakeWorld({}));
  engine.start("highlands.duchess");
  check("duchess resolves", engine.getPage().text.length > 0);

  return out;
}
