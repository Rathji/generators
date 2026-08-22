// Validation tests for Task #139: Dwarven Arc End-to-End Integration.
// The full chain: Forge Golem falls → forge-depths door → Dwarfholm →
// Dwarven Forge → Forge Colossus → Adamantite Ore → the Legendary Blade,
// using the real dialogue/event/quest/chest/dungeon/transition systems.

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
  tman.addLink({ fromMap: "mount_gulg_b2", fromX: 1, fromY: 1, toMap: "dwarfholm", toX: 7, toY: 6, facing: "N" });
  tman.addLink({ fromMap: "dwarfholm", fromX: 7, fromY: 7, toMap: "mount_gulg_b2", toX: 1, toY: 1, facing: "S" });
  tman.addLink({ fromMap: "dwarfholm", fromX: 10, fromY: 1, toMap: "forge_upper", toX: 7, toY: 5, facing: "N" });

  // 1. The Forge Golem's fall opens the deep halls.
  check("hearthstone quest gated before gulg", sideQuests.canStart("the_hearthstone") === false);
  state.setFlag("story_gulg_guardian_defeated", true);
  check("hearthstone quest unlocked", sideQuests.canStart("the_hearthstone") === true);

  // 2. The forge-depths door leads into Dwarfholm.
  tman.start("mount_gulg_b2", 1, 1, "N");
  const toTown = tman.transitionAt(1, 1);
  check("forge depths door -> dwarfholm", toTown && toTown.to.mapId === "dwarfholm" && toTown.to.x === 7 && toTown.to.y === 6);

  // 3. The Dwarf King welcomes the party and the quest starts.
  dialogue.start("dwarfholm.king");
  check("king welcomes to the halls", allText(dialogue).includes("Dwarfholm"));
  const q1 = sideQuests.start("the_hearthstone");
  check("hearthstone quest started", q1.ok === true);

  // 4. The Forge front leads into the Dwarven Forge.
  tman.start("dwarfholm", 10, 1, "N");
  const toForge = tman.transitionAt(10, 1);
  check("forge front -> dwarven forge", toForge && toForge.to.mapId === "forge_upper" && toForge.to.x === 7 && toForge.to.y === 5);

  // 5. The Hearthstone rests in the upper forge.
  const hearthChest = chests.open("forge_upper", 12, 5);
  check("hearth chest grants hearthstone", hearthChest.ok === true && hearthChest.items.some((i) => i.itemId === "hearthstone"));
  dialogue.start("dwarfholm.king");
  check("king acknowledges the hearthstone", allText(dialogue).includes("Hearthstone"));
  const goldBefore1 = party.gold;
  const xpBefore1 = hero.xp;
  sideQuests.completeStep("the_hearthstone", "sq_hearthstone_found");
  sideQuests.completeStep("the_hearthstone", "sq_hearthstone_returned");
  const done1 = sideQuests.checkComplete("the_hearthstone");
  check("hearthstone quest rewarded", done1.ok === true && party.gold - goldBefore1 === 350 && inv.count("elixir") === 2 && hero.xp - xpBefore1 === 140);

  // 6. The Forge Colossus wakes in the forge's heart.
  const colossus = events.pending("forge_core", 3, 5, "step");
  check("colossus pending", colossus?.id === "forge_colossus_boss");
  let battle = null;
  events.trigger(colossus, { bossBattle: (act) => (battle = act) });
  check("colossus battle routed", battle?.bossId === "forgeColossus");
  state.setFlag(colossus.event.onWinFlag, true);
  check("colossus win flag set", state.getFlag("story_forge_colossus_defeated") === true);
  check("colossus drops adamantite ore", (ENEMIES.forgeColossus.loot || []).some((l) => l.itemId === "adamantiteOre"));

  // 7. The Rune Plate rests in the forge heart.
  const runeChest = chests.open("forge_core", 12, 5);
  check("rune chest grants runePlate", runeChest.ok === true && runeChest.items.some((i) => i.itemId === "runePlate"));

  // 8. The Legendary Blade closes the blacksmith's saga.
  state.setFlag("sq_the_ember_core_done", true);
  check("blade quest unlocked after ember core", sideQuests.canStart("the_legendary_blade") === true);
  const q2 = sideQuests.start("the_legendary_blade");
  check("blade quest started", q2.ok === true);
  inv.add("adamantiteOre", 1);
  dialogue.start("cornelia.blacksmith");
  check("blacksmith covets the ore", allText(dialogue).includes("Adamantite"));
  const xpBefore2 = hero.xp;
  sideQuests.completeStep("the_legendary_blade", "sq_legendary_blade_ore");
  sideQuests.completeStep("the_legendary_blade", "sq_legendary_blade_forged");
  const done2 = sideQuests.checkComplete("the_legendary_blade");
  check("blade quest rewards the Luminary", done2.ok === true && inv.count("luminary") === 1 && hero.xp - xpBefore2 === 200);
  dialogue.start("cornelia.blacksmith");
  check("blacksmith forges the blade of legend", allText(dialogue).includes("Luminary"));

  // 9. The victory plot dialogue exists.
  check("colossus victory dialogue wired", !!DIALOGUE["plot.forge_colossus_defeated"]);

  return out;
}
