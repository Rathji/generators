// Validation tests for Task #129: Ember Arc End-to-End Integration.
// The full chain: airship → Ember Sanctum peak → magma halls → molten core →
// Ember Fiend → Inferno Brand → side quests, using the real
// dialogue/event/travel/quest/chest/dungeon systems together.

import { DialogueEngine } from "../engine/dialogue.js";
import { DIALOGUE } from "../data/dialogue.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { TravelAccessSystem, TRAVEL_ACCESS } from "../engine/travel.js";
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
  const travel = new TravelAccessSystem(TRAVEL_ACCESS, { state, world });
  const sideQuests = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });
  const chests = new ChestSystem(CHESTS, { state, inventory: inv, party, random: () => 0 });
  const dungeon = new DungeonSystem(DUNGEONS, {});

  // Real transition wiring (mirrors main.js).
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "overworld", fromX: 18, fromY: 2, toMap: "ember_sanctum", toX: 7, toY: 5, facing: "N" });

  // 1. The airship (engine + flag) opens the northern peaks.
  check("airship locked without engine", travel.canUse("air") === false);
  inv.add("airshipEngine", 1);
  state.setFlag("airship_obtained", true);
  check("airship usable", travel.canUse("air") === true);

  // 2. The Ember Fiend stays gated until the Wind Fiend falls.
  check("ember fiend gated without wind fiend", events.pending("ember_sanctum_core", 3, 5, "step") === null);
  state.setFlag("story_wind_fiend_defeated", true);

  // 3. The mountain peak door leads into the sanctum.
  tman.start("overworld", 18, 2, "N");
  const toSanctum = tman.transitionAt(18, 2);
  check("peak door -> ember sanctum", toSanctum && toSanctum.to.mapId === "ember_sanctum" && toSanctum.to.x === 7 && toSanctum.to.y === 5);

  // 4. The stairs descend through all three levels.
  const l2 = dungeon.useStairs("ember_sanctum", "ember_sanctum", 14, 10);
  check("descend to magma halls", l2 && l2.to.mapId === "ember_sanctum_b2");
  const l3 = dungeon.useStairs("ember_sanctum", "ember_sanctum_b2", 1, 5);
  check("descend to molten core", l3 && l3.to.mapId === "ember_sanctum_core");

  // 5. The Ember Fiend rises in the Molten Core.
  const fiend = events.pending("ember_sanctum_core", 3, 5, "step");
  check("ember fiend pending", fiend?.id === "ember_fiend_boss");
  let battle = null;
  events.trigger(fiend, { bossBattle: (act) => (battle = act) });
  check("fiend battle routed", battle?.bossId === "emberFiend");
  state.setFlag(fiend.event.onWinFlag, true);
  check("fiend win flag set", state.getFlag("story_ember_fiend_defeated") === true);
  check("fiend drops inferno brand", (ENEMIES.emberFiend.loot || []).some((l) => l.itemId === "infernoBrand"));
  check("one-shot", events.pending("ember_sanctum_core", 3, 5, "step") === null);

  // 6. The core chest holds the Magma Heart and Ember Core.
  const coreChest = chests.open("ember_sanctum_core", 12, 5);
  check("core chest grants magmaHeart", coreChest.ok === true && coreChest.items.some((i) => i.itemId === "magmaHeart"));
  check("core chest grants emberCore", coreChest.items.some((i) => i.itemId === "emberCore"));

  // 7. The blacksmith quest closes with the Ember Core.
  check("ember core quest unlocked after wind fiend", sideQuests.canStart("the_ember_core") === true);
  const q1 = sideQuests.start("the_ember_core");
  check("ember core quest started", q1.ok === true);
  dialogue.start("cornelia.blacksmith");
  check("blacksmith covets the core", allText(dialogue).includes("Ember Core"));
  const goldBefore1 = party.gold;
  const xpBefore1 = hero.xp;
  sideQuests.completeStep("the_ember_core", "sq_ember_core_found");
  sideQuests.completeStep("the_ember_core", "sq_ember_core_returned");
  const done1 = sideQuests.checkComplete("the_ember_core");
  check("ember core quest rewarded", done1.ok === true && party.gold - goldBefore1 === 400 && inv.count("elixir") === 2 && hero.xp - xpBefore1 === 150);
  dialogue.start("cornelia.blacksmith");
  check("blacksmith thanks after return", allText(dialogue).includes("forge"));

  // 8. The fiend slayer quest closes with the mayor.
  check("fiend slayer quest unlocked", sideQuests.canStart("the_fiend_slayer") === true);
  const q2 = sideQuests.start("the_fiend_slayer");
  check("fiend slayer quest started", q2.ok === true);
  const goldBefore2 = party.gold;
  const xpBefore2 = hero.xp;
  sideQuests.completeStep("the_fiend_slayer", "sq_fiend_slayer_defeated");
  sideQuests.completeStep("the_fiend_slayer", "sq_fiend_slayer_reported");
  const done2 = sideQuests.checkComplete("the_fiend_slayer");
  check("fiend slayer quest rewarded", done2.ok === true && party.gold - goldBefore2 === 500 && inv.count("cottage") === 2 && hero.xp - xpBefore2 === 200);
  dialogue.start("cornelia.mayor");
  check("mayor hails the fiend slayer", allText(dialogue).includes("hearth"));

  // 9. The victory plot dialogue exists.
  check("fiend victory dialogue wired", !!DIALOGUE["plot.ember_fiend_defeated"]);

  return out;
}
