// Validation tests for Task #118: Sea Arc Side Quests — the Sunken Offering
// (Windfall) and the Lighthouse Flame (Pravog).

import { DialogueEngine } from "../engine/dialogue.js";
import { DIALOGUE } from "../data/dialogue.js";
import { SideQuestSystem } from "../engine/side-quests.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { ITEMS } from "../data/items.js";

function allText(d) {
  const pages = [];
  while (d.isActive()) {
    const p = d.getPage();
    if (p) pages.push(p.text);
    d.advance();
  }
  return pages.join(" ");
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const inv = new Inventory();
  const party = new PartyManager({ gold: 0 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  party.add(hero);
  const world = {
    getFlag: (n) => !!state.getFlag(n),
    hasItem: (n) => inv.has(n),
    getLeaderClass: () => "warrior",
  };
  const dialogue = new DialogueEngine({ world, state: { getFlag: (n) => !!state.getFlag(n), setFlag: (n, v) => state.setFlag(n, v) } });
  const sq = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });

  // Defs present.
  const offering = SIDE_QUESTS.the_sunken_offering;
  const flame = SIDE_QUESTS.the_lighthouse_flame;
  check("sunken offering quest defined", !!offering && offering.steps.length === 2);
  check("lighthouse flame quest defined", !!flame && flame.steps.length === 2);
  check("offering reward", offering.reward.gold === 300 && offering.reward.item === "ether" && offering.reward.count === 3 && offering.reward.xp === 120);
  check("flame reward", flame.reward.gold === 250 && flame.reward.item === "cottage" && flame.reward.count === 2 && flame.reward.xp === 90);
  check("sunkenIdol key item exists", !!ITEMS.sunkenIdol && ITEMS.sunkenIdol.keyId === "offering");

  // Quest gating.
  check("offering gated on ship", sq.canStart("the_sunken_offering") === false);
  check("flame gated on marsh guardian", sq.canStart("the_lighthouse_flame") === false);
  state.setFlag("ship_obtained", true);
  state.setFlag("story_marsh_guardian_defeated", true);
  check("offering starts after ship", sq.canStart("the_sunken_offering") === true);
  check("flame starts after marsh guardian", sq.canStart("the_lighthouse_flame") === true);

  // --- The Sunken Offering ---
  dialogue.start("windfall.elder");
  check("elder default before quest", allText(dialogue).includes("Sea Shrine"));
  const q1 = sq.start("the_sunken_offering");
  check("offering quest started", q1.ok === true);

  // Recovering the idol lets the elder acknowledge it.
  inv.add("sunkenIdol", 1);
  dialogue.bindWorld({ ...world, getFlag: (n) => !!state.getFlag(n), hasItem: (n) => inv.has(n), getLeaderClass: () => "warrior" });
  dialogue.start("windfall.elder");
  check("elder acknowledges idol", allText(dialogue).includes("Sunken Idol"));

  const s1 = sq.completeStep("the_sunken_offering", "sq_sunken_offering_found");
  check("found step completes", s1.ok === true && s1.done === false);
  const s2 = sq.completeStep("the_sunken_offering", "sq_sunken_offering_returned");
  check("returned step completes", s2.ok === true && s2.done === true);
  const done1 = sq.checkComplete("the_sunken_offering");
  check("offering rewards granted", done1.ok === true && party.gold === 300 && inv.count("ether") === 3 && hero.xp === 120);
  check("offering quest complete", sq.isComplete("the_sunken_offering") === true);

  // --- The Lighthouse Flame ---
  dialogue.start("pravo.mayor");
  check("mayor default before quest", allText(dialogue).includes("light"));
  const q2 = sq.start("the_lighthouse_flame");
  check("flame quest started", q2.ok === true);
  dialogue.start("pravo.mayor");
  check("mayor reminds of the task", allText(dialogue).includes("beacon"));
  state.setFlag("story_phantom_light_defeated", true);
  dialogue.start("pravo.mayor");
  check("mayor celebrates phantom light fall", allText(dialogue).includes("headland"));
  const f1 = sq.completeStep("the_lighthouse_flame", "sq_lighthouse_flame_cleared");
  check("cleared step completes", f1.ok === true && f1.done === false);
  const f2 = sq.completeStep("the_lighthouse_flame", "sq_lighthouse_flame_reported");
  check("reported step completes", f2.ok === true && f2.done === true);
  const done2 = sq.checkComplete("the_lighthouse_flame");
  check("flame rewards granted", done2.ok === true && party.gold === 550 && inv.count("cottage") === 2 && hero.xp === 210);
  check("flame quest complete", sq.isComplete("the_lighthouse_flame") === true);
  check("no repeat rewards", sq.checkComplete("the_sunken_offering").ok === false && sq.checkComplete("the_lighthouse_flame").ok === false);

  return out;
}
