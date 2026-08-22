// Validation tests for Task #199: the full New Game+ arc — finish the age,
// turn the world, keep your strength, face a stronger realm and the Echo of
// Creation, and carry everything into the final cycle.

import { NgPlusSystem } from "../engine/ngplus.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";
import { EncounterGenerator } from "../engine/encounters.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES } from "../data/enemies.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // The age is finished: Chrono dead, waystones/trials/bestiary earned,
  // a fat inventory.
  const state = new GameState();
  const party = new PartyManager({ gold: 8000 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior", level: 24, xp: 1500, weapon: "shatteredBlade" });
  party.add(hero);
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage", level: 23, xp: 1200, extraSpells: ["firaga", "thundaga"] });
  party.add(mage);
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  inv.add("potion", 9);
  inv.add("elixir", 3);
  inv.add("crystalKey", 1);
  inv.add("airshipEngine", 1);
  inv.add("wayfarerCharm", 1);
  inv.add("masamune", 1);

  state.setFlag("story_chrono_defeated", true);
  state.setFlag("waystone_cornelia", true);
  state.setFlag("waystone_pravog", true);
  state.setFlag("trial_garland_cleared", true);
  state.setFlag("trial_apex_cleared", true);
  state.setFlag("keeper_tokens", 9);
  state.setFlag("bestiary_chrono_seen", true);

  const es = new EnemyTemplateSystem();
  const ng = new NgPlusSystem({ state, party, inventory: inv, enemySystem: es });

  // --- Cycle 1 -> 2 ------------------------------------------------------
  const c2 = ng.startCycle();
  check("cycle 2 begins", c2.ok === true && c2.cycle === 2);
  check("hero carried with weapon", party.members[0].level === 24 && party.members[0].equipment?.weapon === "shatteredBlade");
  check("mage spells carried", party.members[1].extraSpells?.includes("thundaga"));
  check("gold carried (8000+1000)", party.gold === 9000);
  check("key items stripped", inv.count("crystalKey") === 0 && inv.count("airshipEngine") === 0);
  check("gear carried", inv.count("masamune") === 1 && inv.count("wayfarerCharm") === 1);
  check("emblem granted", inv.count("cycleEmblem") === 1);
  check("meta preserved", state.getFlag("waystone_cornelia") && state.getFlag("trial_apex_cleared") && state.flags.keeper_tokens === 9 && state.getFlag("bestiary_chrono_seen"));
  check("story reset", state.getFlag("story_chrono_defeated") === false);
  check("echo unlocked", state.getFlag("ngplus_echo_unlocked") === true);

  // --- The world is harder ------------------------------------------------
  const enc = new EncounterGenerator({ enemySystem: es, scaler: (enemies) => ng.scaleEncounter(enemies) });
  state.setFlag("ngplus_cycle", 2);
  const encounter = enc.forceEncounter("overworld", "goblins");
  check("random encounters scaled", encounter?.enemies?.[0]?.hp >= ENEMIES.goblin.hp * 1.2, "hp=" + encounter?.enemies?.[0]?.hp);
  check("encounter xp scaled", encounter.enemies[0].xp > ENEMIES.goblin.xp);

  // --- Echo of Creation --------------------------------------------------
  const wev = new WorldEventSystem(WORLD_EVENTS, { state, world: { getFlag: (n) => state.getFlag(n), hasItem: () => false } });
  check("echo gate pending", wev.pending("trial_hall", 7, 8, "step") !== null);
  const boss = ng.echoBoss();
  check("echo boss scaled for cycle 2", boss.hp === Math.round(ENEMIES.echoOfCreation.hp * 1.5), "hp=" + boss.hp);
  const win = ng.recordEchoDefeat();
  check("echo victory + hoard", win.ok === true && inv.count("shatteredBlade") === 1);
  check("echo gold (9000+5000)", party.gold === 14000);
  check("echo defeat recorded", state.getFlag("ngplus_echo_defeated") === true);

  // --- Cycle 2 -> 3 ------------------------------------------------------
  state.setFlag("story_chrono_defeated", true);
  const c3 = ng.startCycle();
  check("cycle 3 begins", c3.ok === true && c3.cycle === 3 && c3.reward?.item === "shatteredRelic");
  check("shattered relic granted", inv.count("shatteredRelic") === 1);
  check("blade survives", inv.count("shatteredBlade") === 1);
  check("gold (14000+2000)", party.gold === 16000);
  check("at max cycle", ng.atMaxCycle() === true && ng.canBeginCycle() === false);

  return out;
}
