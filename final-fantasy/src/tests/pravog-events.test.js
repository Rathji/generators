// Validation tests for Task #168: Pravog NPC Dialogue & Event Set — the
// harbor town's residents and the harbor master's post-ship event line.

import { DIALOGUE } from "../data/dialogue.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { DialogueEngine } from "../engine/dialogue.js";

function fakeWorld(flags = {}, items = [], leader = "warrior") {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: (n) => items.includes(n),
    getLeaderClass: () => leader,
  };
}

const RESIDENT_IDS = [
  "pravo.dockworker",
  "pravo.fisherman",
  "pravo.fisherwife",
  "pravo.dockchild",
  "pravo.resident",
  "pravo.armorer",
  "pravo.priest",
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

  // Every new resident has dialogue that resolves to readable text.
  for (const id of RESIDENT_IDS) {
    check("resident dialogue present: " + id, id in DIALOGUE);
    const page = engine.start(id);
    check("resident dialogue resolves: " + id, page && typeof page.text === "string" && page.text.length > 0);
  }
  check("harbor after event present", "pravo.harbormaster.after" in DIALOGUE);
  check("harbor after mentions wastes", DIALOGUE["pravo.harbormaster.after"].pages.some((p) => p.includes("wastes")));

  // The harbor master branches to the after-line once the ship is obtained.
  const plain = engine.start("pravo.harbormaster");
  check("harbor master speaks before ship", plain && plain.text.length > 0 && !plain.text.includes("charted"));
  flags.ship_obtained = true;
  const after = engine.start("pravo.harbormaster");
  check("harbor master branches after ship", after && after.id === "pravo.harbormaster.after" && after.text.includes("charted"));

  // The fishermen's lines weave the coast/sea lore together.
  check("fisherman mentions reef serpents", DIALOGUE["pravo.fisherman"].includes("reef serpents"));
  check("dock boy dreams of sailing", DIALOGUE["pravo.dockchild"].includes("sailor"));

  // Every pravog resident NPC is placed and references existing dialogue.
  const townNpcs = NPC_PLACEMENTS.pravog ?? [];
  const withDialogue = townNpcs.filter((n) => RESIDENT_IDS.includes(n.dialogueId));
  check("new residents placed", withDialogue.length >= 4);
  check("existing harbor master kept", townNpcs.some((n) => n.id === "pravog_harbormaster"));

  return out;
}
