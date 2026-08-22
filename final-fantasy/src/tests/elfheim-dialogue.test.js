// Validation tests for Task #93: Elfheim NPC Dialogue Set.

import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";

function fakeWorld(flags = {}, items = [], leader = "warrior") {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: (n) => items.includes(n),
    getLeaderClass: () => leader,
  };
}

// Join every page of the current node (branch keyword checks must not stop at
// page 1 of multi-page dialogue).
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

  // Every elfheim NPC has dialogue content.
  const elfIds = [
    "elfheim.merchant",
    "elfheim.merchant.deal",
    "elfheim.merchant.none",
    "elfheim.guard",
    "elfheim.guard.before",
    "elfheim.guard.key",
    "elfheim.guard.open",
    "elfheim.elder",
    "elfheim.elder.before",
    "elfheim.elder.after_marsh",
    "elfheim.child",
    "elfheim.villager",
    "elfheim.villager.default",
    "elfheim.villager.earth",
    "elfheim.prince",
    "elfheim.prince.greeting",
    "elfheim.prince.blade",
    "elfheim.prince.after_marsh",
    "elfheim.palace_guard",
    "elfheim.palace_guard.default",
    "elfheim.palace_guard.calm",
  ];
  for (const id of elfIds) {
    check("elfheim dialogue present: " + id, id in DIALOGUE);
  }

  // All elfheim branch targets resolve to nodes with text.
  const flags = {};
  const items = ["crystalKey", "mythrilSword"];
  const engine = new DialogueEngine({
    world: fakeWorld(flags, items),
    state: {
      getFlag: (n) => !!flags[n],
      setFlag: (n, v) => {
        flags[n] = v ?? true;
      },
    },
  });

  for (const id of elfIds) {
    const page = engine.start(id);
    check("elfheim node resolves: " + id, page && typeof page.text === "string" && page.text.length > 0);
  }

  // Guard branches by gate key / unlock flag.
  engine.bindWorld(fakeWorld({}, []));
  engine.start("elfheim.guard");
  check("guard barred before key", allText(engine).includes("key"));
  engine.bindWorld(fakeWorld({}, ["crystalKey"]));
  engine.start("elfheim.guard");
  check("guard opens with key", allText(engine).includes("gate opens"));
  engine.bindWorld(fakeWorld({ elfheim_unlocked: true }));
  engine.start("elfheim.guard");
  check("guard welcomes after unlock", allText(engine).includes("Welcome"));

  // Prince branches on the marsh guardian defeat toward Mount Gulg.
  engine.bindWorld(fakeWorld({ story_marsh_guardian_defeated: true }, []));
  engine.start("elfheim.prince");
  check("prince points to Mount Gulg", allText(engine).includes("Mount Gulg"));
  engine.bindWorld(fakeWorld({}, ["mythrilSword"]));
  engine.start("elfheim.prince");
  check("prince praises mythril blade", allText(engine).includes("mythril blade"));
  engine.bindWorld(fakeWorld({}, []));
  engine.start("elfheim.prince");
  check("prince default greeting", allText(engine).includes("Welcome to Elfheim"));

  // Elder hints at the marsh relic before and the earth crystal after.
  engine.bindWorld(fakeWorld({}, []));
  engine.start("elfheim.elder");
  check("elder mentions the marsh relic", allText(engine).includes("Marsh Cave"));
  engine.bindWorld(fakeWorld({ story_marsh_guardian_defeated: true }));
  engine.start("elfheim.elder");
  check("elder reveals earth crystal", allText(engine).includes("Earth Crystal"));

  // Merchant trades on mythril.
  engine.bindWorld(fakeWorld({}, []));
  engine.start("elfheim.merchant");
  check("merchant sells mythril", allText(engine).includes("mythril"));
  engine.bindWorld(fakeWorld({}, ["mythrilSword"]));
  engine.start("elfheim.merchant");
  check("merchant offers trade with blade", allText(engine).includes("fair trade"));

  return out;
}
