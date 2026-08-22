// Validation tests for Task #119: Ocean Arc End-to-End Integration.
// The full chain: ship → Windfall Isle → Sea Shrine → Tide Serpent → Tide Key
// → Drowned Vault → Pravo Lighthouse → Phantom Light → side quests, using the
// real dialogue/event/travel/gate/quest systems together.

import { DialogueEngine } from "../engine/dialogue.js";
import { DIALOGUE } from "../data/dialogue.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { TravelAccessSystem, TRAVEL_ACCESS } from "../engine/travel.js";
import { GateSystem } from "../engine/gates.js";
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
  const gates = new GateSystem(world);
  gates.add({ id: "vault_gate", mapId: "sea_shrine_b2", x: 1, y: 5, require: { item: "tideKey" } });
  const sideQuests = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });
  const chests = new ChestSystem(CHESTS, { state, inventory: inv, party, random: () => 0 });
  const dungeon = new DungeonSystem(DUNGEONS, {});

  // Real transition wiring (mirrors main.js).
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "overworld", fromX: 20, fromY: 11, toMap: "windfall", toX: 7, toY: 6, facing: "N" });
  tman.addLink({ fromMap: "windfall", fromX: 7, fromY: 7, toMap: "overworld", toX: 20, toY: 11, facing: "S" });
  tman.addLink({ fromMap: "windfall", fromX: 10, fromY: 1, toMap: "sea_shrine", toX: 7, toY: 5, facing: "N" });
  tman.addLink({ fromMap: "overworld", fromX: 2, fromY: 10, toMap: "lighthouse", toX: 7, toY: 5, facing: "N" });

  // 1. The ship opens the sea lanes.
  check("ship locked before grant", travel.canUse("ship") === false);
  travel.grant("ship");
  check("ship granted", travel.canUse("ship") === true);

  // 2. The overworld shore ferries the party to Windfall.
  tman.start("overworld", 20, 11, "N");
  const toIsle = tman.transitionAt(20, 11);
  check("shore dock -> windfall", toIsle && toIsle.to.mapId === "windfall" && toIsle.to.x === 7 && toIsle.to.y === 6);

  // 3. The elder offers the Sunken Offering quest.
  check("offering quest unlocked with ship", sideQuests.canStart("the_sunken_offering") === true);
  const q1 = sideQuests.start("the_sunken_offering");
  check("offering quest started", q1.ok === true);
  dialogue.start("windfall.elder");
  check("elder directs to the sea shrine", allText(dialogue).includes("Sea Shrine"));

  // 4. Windfall's shrine door descends into the Sea Shrine.
  tman.start("windfall", 10, 1, "N");
  const intoShrine = tman.transitionAt(10, 1);
  check("village door -> sea shrine", intoShrine && intoShrine.to.mapId === "sea_shrine" && intoShrine.to.x === 7 && intoShrine.to.y === 5);

  // 5. The Sunken Idol rests in a shrine chest.
  const idolChest = chests.open("sea_shrine", 5, 3);
  check("idol chest grants sunkenIdol", idolChest.ok === true && idolChest.items.some((i) => i.itemId === "sunkenIdol"));
  check("elder acknowledges the idol", DIALOGUE["windfall.elder"].branches.some((b) => b.when?.item === "sunkenIdol"));

  // 6. The Tide Serpent blocks the sanctum until both gates clear.
  check("tide serpent gated without garland", events.pending("sea_shrine_b2", 3, 5, "step") === null);
  state.setFlag("story_garland_defeated", true);
  const serpent = events.pending("sea_shrine_b2", 3, 5, "step");
  check("tide serpent pending", serpent?.id === "tide_serpent_boss");
  let battle = null;
  events.trigger(serpent, { bossBattle: (act) => (battle = act) });
  check("serpent battle routed", battle?.group === "tide_serpent_guard");
  state.setFlag(serpent.event.onWinFlag, true);
  check("serpent win flag set", state.getFlag("story_tide_serpent_defeated") === true);

  // 7. The Tide Key (looted from the serpent) opens the vault gate.
  check("vault gate locked without tideKey", gates.canPass("sea_shrine_b2", 1, 5).allowed === false);
  inv.add("tideKey", 1);
  check("vault gate opens with tideKey", gates.canPass("sea_shrine_b2", 1, 5).allowed === true);

  // 8. The Drowned Vault holds the Triton Crown.
  const vaultIn = dungeon.useStairs("sea_shrine", "sea_shrine_b2", 1, 5);
  check("vault door descends", vaultIn && vaultIn.to.mapId === "sea_vault");
  const crown = chests.open("sea_vault", 12, 5);
  check("vault chest grants tritonCrown", crown.ok === true && crown.items.some((i) => i.itemId === "tritonCrown"));

  // 9. Completing the offering quest at the elder's door.
  sideQuests.completeStep("the_sunken_offering", "sq_sunken_offering_found");
  sideQuests.completeStep("the_sunken_offering", "sq_sunken_offering_returned");
  const goldBefore1 = party.gold;
  const xpBefore1 = hero.xp;
  const done1 = sideQuests.checkComplete("the_sunken_offering");
  check("offering quest rewarded", done1.ok === true && party.gold - goldBefore1 === 300 && inv.count("ether") === 3 && hero.xp - xpBefore1 === 120);

  // 10. The headland door climbs the Pravo Lighthouse.
  state.setFlag("story_marsh_guardian_defeated", true);
  check("lighthouse flame quest unlocked", sideQuests.canStart("the_lighthouse_flame") === true);
  const q2 = sideQuests.start("the_lighthouse_flame");
  check("flame quest started", q2.ok === true);
  tman.start("overworld", 2, 10, "N");
  const toTower = tman.transitionAt(2, 10);
  check("headland door -> lighthouse", toTower && toTower.to.mapId === "lighthouse" && toTower.to.x === 7 && toTower.to.y === 5);

  // 11. The Phantom Light dies in the lamp room.
  const phantom = events.pending("lighthouse_top", 3, 5, "step");
  check("phantom light pending", phantom?.id === "phantom_light_boss");
  battle = null;
  events.trigger(phantom, { bossBattle: (act) => (battle = act) });
  check("phantom battle routed", battle?.bossId === "phantomLight");
  state.setFlag(phantom.event.onWinFlag, true);
  check("phantom win flag set", state.getFlag("story_phantom_light_defeated") === true);
  check("phantom drops starlightCrest", (ENEMIES.phantomLight.loot || []).some((l) => l.itemId === "starlightCrest"));

  // 12. Reporting to Pravog closes the flame quest.
  sideQuests.completeStep("the_lighthouse_flame", "sq_lighthouse_flame_cleared");
  sideQuests.completeStep("the_lighthouse_flame", "sq_lighthouse_flame_reported");
  const goldBefore2 = party.gold;
  const xpBefore2 = hero.xp;
  const done2 = sideQuests.checkComplete("the_lighthouse_flame");
  check("flame quest rewarded", done2.ok === true && party.gold - goldBefore2 === 250 && inv.count("cottage") === 2 && hero.xp - xpBefore2 === 90);
  dialogue.start("pravo.mayor");
  check("mayor celebrates the beacon", allText(dialogue).includes("headland"));

  return out;
}
