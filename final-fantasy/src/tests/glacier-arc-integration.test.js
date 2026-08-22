// Validation tests for Task #149: Glacier Arc End-to-End Integration.
// The full chain: Forge Colossus falls → the Glacier Isle opens → ship docks
// at Glacierport → Sunstone quest → Frozen Caverns → Frost Wyrm → Frost
// Scale → the Frozen Blade, using the real dialogue/event/quest/chest/
// dungeon/transition systems.

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
  tman.addLink({ fromMap: "overworld", fromX: 24, fromY: 11, toMap: "glacierport", toX: 7, toY: 6, facing: "N" });
  tman.addLink({ fromMap: "glacierport", fromX: 7, fromY: 7, toMap: "overworld", toX: 24, toY: 11, facing: "S" });
  tman.addLink({ fromMap: "glacierport", fromX: 10, fromY: 1, toMap: "frozen_upper", toX: 7, toY: 5, facing: "N" });

  // 1. The isle is gated behind the ship; the blade quest behind the colossus.
  check("sunstone quest gated before ship", sideQuests.canStart("the_sunstone") === false);
  check("frozen blade quest gated before colossus", sideQuests.canStart("the_frozen_blade") === false);
  state.setFlag("ship_obtained", true);
  check("sunstone quest unlocked with the ship", sideQuests.canStart("the_sunstone") === true);

  // 2. The glacier dock leads into Glacierport.
  tman.start("overworld", 24, 11, "N");
  const toTown = tman.transitionAt(24, 11);
  check("glacier dock -> glacierport", toTown && toTown.to.mapId === "glacierport" && toTown.to.x === 7 && toTown.to.y === 6);

  // 3. The Elder welcomes the party and the quest starts.
  dialogue.start("glacierport.elder");
  check("elder welcomes to the isle", allText(dialogue).includes("Glacierport"));
  const q1 = sideQuests.start("the_sunstone");
  check("sunstone quest started", q1.ok === true);

  // 4. The cavern door leads into the Frozen Caverns.
  tman.start("glacierport", 10, 1, "N");
  const toCaverns = tman.transitionAt(10, 1);
  check("cavern door -> frozen caverns", toCaverns && toCaverns.to.mapId === "frozen_upper" && toCaverns.to.x === 7 && toCaverns.to.y === 5);

  // 5. The Sunstone rests in the upper ice.
  const sunChest = chests.open("frozen_upper", 12, 5);
  check("sun chest grants sunstone", sunChest.ok === true && sunChest.items.some((i) => i.itemId === "sunstone"));
  dialogue.start("glacierport.elder");
  check("elder acknowledges the sunstone", allText(dialogue).includes("Sunstone"));
  const goldBefore1 = party.gold;
  const xpBefore1 = hero.xp;
  sideQuests.completeStep("the_sunstone", "sq_sunstone_found");
  sideQuests.completeStep("the_sunstone", "sq_sunstone_returned");
  const done1 = sideQuests.checkComplete("the_sunstone");
  check("sunstone quest rewarded", done1.ok === true && party.gold - goldBefore1 === 350 && inv.count("elixir") === 2 && hero.xp - xpBefore1 === 140);

  // 6. The Forge Colossus's fall unlocks the blade quest.
  state.setFlag("story_forge_colossus_defeated", true);
  check("frozen blade quest unlocked", sideQuests.canStart("the_frozen_blade") === true);
  const q2 = sideQuests.start("the_frozen_blade");
  check("frozen blade quest started", q2.ok === true);

  // 7. The stairs descend to the cavern's heart.
  const down = dungeon.useStairs("frozen_caverns", "frozen_upper", 14, 10);
  check("cavern stairs descend", down && down.to.mapId === "frozen_core");

  // 8. The Frost Wyrm wakes in the heart of the ice.
  const wyrm = events.pending("frozen_core", 3, 5, "step");
  check("frost wyrm pending", wyrm?.id === "frost_wyrm_boss");
  let battle = null;
  events.trigger(wyrm, { bossBattle: (act) => (battle = act) });
  check("wyrm battle routed", battle?.bossId === "frostWyrm");
  state.setFlag(wyrm.event.onWinFlag, true);
  check("wyrm win flag set", state.getFlag("story_frost_wyrm_defeated") === true);
  check("wyrm drops frost scale", (ENEMIES.frostWyrm.loot || []).some((l) => l.itemId === "frostScale"));

  // 9. The Rime Mail rests in the wyrm's hoard.
  const rimeChest = chests.open("frozen_core", 12, 5);
  check("hoard chest grants rimeMail", rimeChest.ok === true && rimeChest.items.some((i) => i.itemId === "rimeMail"));

  // 10. The Frozen Blade closes the captain's saga.
  inv.add("frostScale", 1);
  dialogue.start("glacierport.captain");
  check("captain acknowledges the deed", allText(dialogue).includes("Frost Wyrm"));
  const xpBefore2 = hero.xp;
  sideQuests.completeStep("the_frozen_blade", "sq_frozen_blade_scale");
  sideQuests.completeStep("the_frozen_blade", "sq_frozen_blade_claimed");
  const done2 = sideQuests.checkComplete("the_frozen_blade");
  check("blade quest rewards the Frost Blade", done2.ok === true && inv.count("frozenBlade") === 1 && hero.xp - xpBefore2 === 220);

  // 11. The victory plot dialogue exists.
  check("wyrm victory dialogue wired", !!DIALOGUE["plot.frost_wyrm_defeated"]);

  return out;
}
