// Validation tests for Task #110: Airship Arc End-to-End Integration.
// The full chain: inventor → tunnels → iron sentinel → engine → airship →
// wind shrine → wind fiend, using the real dialogue/event/travel/quest
// systems together.

import { DialogueEngine } from "../engine/dialogue.js";
import { DIALOGUE } from "../data/dialogue.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { TravelAccessSystem, TRAVEL_ACCESS } from "../engine/travel.js";
import { SideQuestSystem } from "../engine/side-quests.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

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

  // Real systems over a shared state + inventory.
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
  const events = new WorldEventSystem(WORLD_EVENTS, { world, state });
  const travel = new TravelAccessSystem(TRAVEL_ACCESS, { state, world });
  const sideQuests = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });

  // The arc opens after the Marsh Guardian is quieted.
  check("arc starts after marsh guardian", DIALOGUE["elfheim.inventor"].branches.some((b) => b.when?.flag === "story_marsh_guardian_defeated"));
  state.setFlag("story_marsh_guardian_defeated", true);
  check("airship locked at arc start", travel.canUse("air") === false);

  // 1. Inventor points the party into the tunnels.
  dialogue.start("elfheim.inventor");
  const hint = allText(dialogue);
  check("inventor sends party to tunnels", hint.includes("tunnels") && hint.includes("airship"));

  // 2. The side quest starts and accepts the hint step.
  check("missing engine quest can start", sideQuests.canStart("the_missing_engine") === true);
  const qStart = sideQuests.start("the_missing_engine");
  check("quest started", qStart.ok === true);
  const s1 = sideQuests.completeStep("the_missing_engine", "sq_missing_engine_hint");
  check("hint step completes", s1.ok === true && s1.done === false);

  // 3. The Iron Sentinel guards the engine in the vault.
  const boss = events.pending("gnome_tunnels_b2", 3, 5, "step");
  check("iron sentinel pending in vault", boss?.id === "iron_sentinel_boss");
  let battle = null;
  events.trigger(boss, { bossBattle: (act) => (battle = act) });
  check("sentinel battle routed", battle?.group === "iron_sentinel_guard");
  state.setFlag(boss.event.onWinFlag, true); // battle-won handler
  check("airship granted on sentinel win", state.getFlag("airship_obtained") === true);

  // 4. The engine drops as loot and the party recovers it.
  inv.add("airshipEngine", 1);
  const s2 = sideQuests.completeStep("the_missing_engine", "sq_missing_engine_recovered");
  check("recovery step completes", s2.ok === true);
  check("airship now usable", travel.canUse("air") === true);

  // 5. Returning to the inventor completes the quest (reward granted).
  dialogue.bindWorld({ ...world, getFlag: (n) => !!state.getFlag(n), hasItem: (n) => inv.has(n), getLeaderClass: () => "warrior" });
  const s3 = sideQuests.completeStep("the_missing_engine", "sq_missing_engine_returned");
  check("returned step completes", s3.ok === true);
  const done = sideQuests.checkComplete("the_missing_engine");
  check("quest rewards granted", done.ok === true && done.reward.gold === 200 && inv.count("ether") === 2);
  dialogue.start("elfheim.inventor");
  const inventorAfter = allText(dialogue);
  check("inventor celebrates engine return", inventorAfter.includes("engine") && inventorAfter.includes("airship"));

  // 6. The Wind Shrine keeper welcomes an airship traveler.
  dialogue.start("wind_shrine.keeper");
  const keeperWelcome = allText(dialogue);
  check("keeper welcomes airship traveler", keeperWelcome.includes("airship"));

  // 7. The Wind Fiend stays locked until the main story is complete.
  check("fiend gated without restored crystals", events.pending("wind_shrine_b2", 3, 5, "step") === null);
  state.setFlag("story_crystals_restored", true);
  const fiend = events.pending("wind_shrine_b2", 3, 5, "step");
  check("fiend pending post-game", fiend?.id === "wind_fiend_boss");
  let fiBattle = null;
  events.trigger(fiend, { bossBattle: (act) => (fiBattle = act) });
  check("fiend battle routed", fiBattle?.group === "wind_fiend_guard");
  state.setFlag(fiend.event.onWinFlag, true);
  check("fiend defeated", state.getFlag("story_wind_fiend_defeated") === true);

  // 8. The shrine keeper thanks the heroes; the king rejoices.
  dialogue.start("wind_shrine.keeper");
  check("keeper thanks heroes", allText(dialogue).includes("storms") || allText(dialogue).includes("quiet"));
  const king = dialogue.start("plot.wind_fiend_defeated");
  check("king celebrates wind fiend defeat", king && allText(dialogue).includes("peace"));

  return out;
}
