// Validation tests for Task #159: Time Arc End-to-End Integration.
// The final chain: Ember Fiend falls → the rift opens beneath the Dark
// Altar → the Timekeeper's quests → the Labyrinth of Time → Chrono → the
// Eternal Blade and the Chrono Core, using the real dialogue/event/quest/
// chest/dungeon/transition systems.

import { DialogueEngine } from "../engine/dialogue.js";
import { DIALOGUE } from "../data/dialogue.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { ChestSystem } from "../engine/chests.js";
import { SideQuestSystem } from "../engine/side-quests.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { DUNGEONS } from "../data/dungeons.js";
import { MAPS } from "../data/maps.js";
import { CHESTS } from "../data/chests.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { TransitionManager, MapManager } from "../engine/transitions.js";
import { ENEMIES } from "../data/enemies.js";

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
  const sideQuests = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });
  const chests = new ChestSystem(CHESTS, { state, inventory: inv, party, random: () => 0 });
  const dungeon = new DungeonSystem(DUNGEONS, {});

  // Real transition wiring (mirrors main.js).
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "chaos_shrine_b2", fromX: 1, fromY: 5, toMap: "time_rift", toX: 7, toY: 5, facing: "N" });

  // 1. Before the Ember Fiend falls, the rift stays hidden.
  dialogue.start("timekeeper");
  check("timekeeper speaks of the stopped clock", allText(dialogue).includes("altar"));
  check("hourglass quest gated before ember fiend", sideQuests.canStart("the_shattered_hourglass") === false);
  check("temporal master quest gated before ember fiend", sideQuests.canStart("the_temporal_master") === false);

  // 2. The Ember Fiend's fall opens the rift.
  state.setFlag("story_ember_fiend_defeated", true);
  dialogue.start("timekeeper");
  check("timekeeper warns of the rift", allText(dialogue).includes("rift"));
  check("hourglass quest unlocked", sideQuests.canStart("the_shattered_hourglass") === true);
  check("temporal master quest unlocked", sideQuests.canStart("the_temporal_master") === true);

  // 3. The Dark Altar rift leads into the Time Rift.
  tman.start("chaos_shrine_b2", 1, 5, "N");
  const riftLink = tman.transitionAt(1, 5);
  check("dark altar -> time rift", riftLink && riftLink.to.mapId === "time_rift" && riftLink.to.x === 7 && riftLink.to.y === 5);

  // 4. The Void Relic rests in the rift's upper ice-time.
  const q1 = sideQuests.start("the_shattered_hourglass");
  check("hourglass quest started", q1.ok === true);
  const relicChest = chests.open("time_rift", 12, 5);
  check("rift chest grants void relic", relicChest.ok === true && relicChest.items.some((i) => i.itemId === "voidRelic"));

  // 5. The stairs descend through the labyrinth to the throne.
  const d1 = dungeon.useStairs("time_labyrinth", "time_rift", 14, 10);
  check("rift stairs descend to labyrinth", d1 && d1.to.mapId === "time_labyrinth");
  const d2 = dungeon.useStairs("time_labyrinth", "time_labyrinth", 1, 5);
  check("labyrinth stairs descend to throne", d2 && d2.to.mapId === "chrono_throne");

  // 6. Chrono wakes in the Throne of Eternity.
  const chronoEv = events.pending("chrono_throne", 3, 5, "step");
  check("chrono pending", chronoEv?.id === "chrono_boss");
  let battle = null;
  events.trigger(chronoEv, { bossBattle: (act) => (battle = act) });
  check("chrono battle routed", battle?.bossId === "chrono");
  state.setFlag(chronoEv.event.onWinFlag, true);
  check("chrono win flag set", state.getFlag("story_chrono_defeated") === true);
  check("chrono drops eternal blade", (ENEMIES.chrono.loot || []).some((l) => l.itemId === "eternalBlade"));
  check("chrono victory dialogue wired", !!DIALOGUE["plot.chrono_defeated"]);

  // 7. The Chrono Mail rests beside the throne.
  const mailChest = chests.open("chrono_throne", 12, 5);
  check("throne chest grants chronoMail", mailChest.ok === true && mailChest.items.some((i) => i.itemId === "chronoMail"));

  // 8. The Timekeeper rewards the relic's return with the Chrono Core.
  dialogue.start("timekeeper");
  check("timekeeper hails the closing rift", allText(dialogue).includes("rift"));
  sideQuests.completeStep("the_shattered_hourglass", "sq_shattered_hourglass_found");
  sideQuests.completeStep("the_shattered_hourglass", "sq_shattered_hourglass_returned");
  const done1 = sideQuests.checkComplete("the_shattered_hourglass");
  check("hourglass quest rewards the chrono core", done1.ok === true && inv.count("chronoCore") === 1);

  // 9. The King honors the end of the age of darkness.
  const q2 = sideQuests.start("the_temporal_master");
  check("temporal master quest started", q2.ok === true);
  const goldBefore = party.gold;
  const xpBefore = hero.xp;
  const elixirBefore = inv.count("elixir");
  sideQuests.completeStep("the_temporal_master", "sq_temporal_master_defeated");
  sideQuests.completeStep("the_temporal_master", "sq_temporal_master_reported");
  const done2 = sideQuests.checkComplete("the_temporal_master");
  check("temporal master quest rewarded", done2.ok === true && party.gold - goldBefore === 600 && inv.count("elixir") - elixirBefore === 3 && hero.xp - xpBefore === 250);

  // 10. The labyrinth exit returns to the Dark Altar.
  const exit = dungeon.exit("time_labyrinth", "time_rift", 7, 1);
  check("labyrinth exit returns to dark altar", exit && exit.to.mapId === "chaos_shrine_b2" && exit.to.x === 1 && exit.to.y === 5);

  return out;
}
