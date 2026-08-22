// Validation tests for Task #88: Pravog NPC Dialogue Set.

import { DIALOGUE } from "../data/dialogue.js";
import { DialogueEngine } from "../engine/dialogue.js";

function fakeWorld(flags = {}, items = [], leader = "warrior") {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: (n) => items.includes(n),
    getLeaderClass: () => leader,
  };
}

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // Every pravog NPC has dialogue content.
  const pravoIds = ["pravo.harbormaster", "pravo.sailor", "pravo.merchant", "pravo.mayor", "pravo.housewife", "pravo.ship_offer", "pravo.ship_grant"];
  for (const id of pravoIds) {
    check("pravog dialogue present: " + id, id in DIALOGUE);
  }

  // Nodes resolve to text through the engine.
  const flags = {};
  const engine = new DialogueEngine({ world: fakeWorld(flags), state: { setFlag: (n, v) => (flags[n] = v ?? true), getFlag: (n) => !!flags[n] } });
  for (const id of pravoIds) {
    const page = engine.start(id);
    check("pravog node resolves: " + id, page && typeof page.text === "string" && page.text.length > 0);
  }

  // The harbor master's ship offer/grant chain is coherent.
  const offer = engine.start("pravo.ship_offer");
  check("ship offer mentions the ship", offer && offer.text.includes("Dawnbreaker"));
  const grant = engine.start("pravo.ship_grant");
  check("ship grant mentions the dock", grant && grant.text.toLowerCase().includes("dock"));

  // Weather/rumor flavor about the sea exists elsewhere in the game.
  const { FLAVOR_TEXTS } = await import("../data/flavor.js");
  check("sea flavor exists", "sea" in FLAVOR_TEXTS);
  check("marsh flavor exists", "marsh" in FLAVOR_TEXTS);

  return out;
}
