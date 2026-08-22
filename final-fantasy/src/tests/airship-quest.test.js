// Validation tests for Task #101: Airship Engine quest + Gnome Inventor.

import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { ITEMS } from "../data/items.js";

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

  check("airshipEngine item exists", !!ITEMS.airshipEngine);
  check("airshipEngine is a key item", ITEMS.airshipEngine.type === "key" && ITEMS.airshipEngine.keyId === "airship");
  check("windBlade weapon exists", !!ITEMS.windBlade && ITEMS.windBlade.type === "weapon");
  check("windBlade is legendary", ITEMS.windBlade.rarity === "legendary" && ITEMS.windBlade.mods.atk === 22);

  const quest = SIDE_QUESTS.the_missing_engine;
  check("missing engine quest defined", !!quest);
  if (quest) {
    check("quest id/name", quest.id === "the_missing_engine" && quest.name === "The Missing Engine");
    check("quest requires marsh guardian", quest.requiredFlags.includes("story_marsh_guardian_defeated"));
    check("quest has 3 steps", quest.steps.length === 3);
    const stepFlags = quest.steps.map((s) => s.flag);
    check(
      "quest step order",
      stepFlags[0] === "sq_missing_engine_hint" &&
        stepFlags[1] === "sq_missing_engine_recovered" &&
        stepFlags[2] === "sq_missing_engine_returned"
    );
    check("quest reward", quest.reward.item === "ether" && quest.reward.count === 2 && quest.reward.gold === 200);
  }

  const engine = new DialogueEngine({ world: fakeWorld({}, []), state: { getFlag: () => false, setFlag: () => {} } });
  const ids = [
    "elfheim.inventor",
    "elfheim.inventor.default",
    "elfheim.inventor.engine",
    "elfheim.inventor.after",
    "plot.engine_obtained",
  ];
  for (const id of ids) {
    const page = engine.start(id);
    check("dialogue node resolves: " + id, page && typeof page.text === "string" && page.text.length > 0);
  }

  // Inventor branch gating.
  engine.bindWorld(fakeWorld({}, []));
  engine.start("elfheim.inventor");
  const t1 = allText(engine);
  check("inventor default hints at engine loss", t1.includes("engine") || t1.includes("tunnels"));

  engine.bindWorld(fakeWorld({ story_marsh_guardian_defeated: true }, []));
  engine.start("elfheim.inventor");
  const t2 = allText(engine);
  check("inventor asks for recovery after marsh", t2.includes("tunnels") && t2.includes("airship"));

  engine.bindWorld(fakeWorld({}, ["airshipEngine"]));
  engine.start("elfheim.inventor");
  const t3 = allText(engine);
  check("inventor celebrates engine return", t3.includes("engine") && t3.includes("airship"));

  engine.start("plot.engine_obtained");
  check("king points to Wind Shrine", allText(engine).includes("Wind Shrine"));

  return out;
}
