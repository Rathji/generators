// Validation tests for Task #169: Trial of the Keeper — full arc integration.
// Gate -> hall -> gauntlet -> apex -> codex -> vault, end to end.

import { MAPS } from "../data/maps.js";
import { MapManager, TransitionManager } from "../engine/transitions.js";
import { BuildingSystem } from "../engine/buildings.js";
import { BUILDINGS } from "../data/buildings.js";
import { GateSystem } from "../engine/gates.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { TrialSystem } from "../engine/trials.js";
import { TRIALS, TRIAL_REWARDS } from "../data/trials.js";
import { BestiarySystem } from "../engine/bestiary.js";
import { BESTIARY } from "../data/bestiary.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { Inventory } from "../engine/inventory.js";
import { ENEMIES } from "../data/enemies.js";

function fullStoryFlags() {
  return {
    story_garland_defeated: true, story_marsh_guardian_defeated: true, story_gulg_guardian_defeated: true,
    story_chaos_defeated: true, story_iron_sentinel_defeated: true, story_tide_serpent_defeated: true,
    story_phantom_light_defeated: true, story_wind_fiend_defeated: true, story_forge_colossus_defeated: true,
    story_frost_wyrm_defeated: true, story_ember_fiend_defeated: true, story_chrono_defeated: true,
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const flags = fullStoryFlags();
  const state = {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const trials = new TrialSystem(TRIALS, { state, inventory: inv, enemySystem: new EnemyTemplateSystem(), rewards: TRIAL_REWARDS });
  const bestiary = new BestiarySystem(BESTIARY, { state });
  const worldEvents = new WorldEventSystem(WORLD_EVENTS, { world: state, state });

  // The road to the hall.
  const gates = new GateSystem(state);
  gates.add({ id: "trial_hall_gate", mapId: "cornelia", x: 13, y: 1, require: { flag: "story_chrono_defeated" }, deniedDialogue: "sealed" });
  check("hall door open", gates.canPass("cornelia", 13, 1).allowed === true);
  const buildings = new BuildingSystem(BUILDINGS);
  check("hall door resolves", buildings.buildingAt("cornelia", 13, 1)?.id === "trial_hall");
  const maps = new MapManager();
  for (const def of MAPS) maps.register(def);
  const transitions = new TransitionManager(maps);
  buildings.registerTransitions(transitions);
  transitions.start("cornelia", 13, 1, "S");
  check("entering the hall", transitions.transitionAt(13, 1)?.to.mapId === "trial_hall");

  // The gate event sits in the circle.
  const gateEv = worldEvents.pending("trial_hall", 7, 3, "step");
  check("trial gate pending", gateEv?.id === "trial_gate");

  // Run the whole gauntlet through the event handler shape the demo uses.
  const expectedOrder = trials.all().map((t) => t.id);
  const seen = [];
  let guard = 0;
  while (guard++ < 30) {
    const cur = trials.currentTrial();
    if (!cur) break;
    seen.push(cur.id);
    const enc = trials.buildEncounter(cur.id);
    check("echo is the trial's boss: " + cur.id, enc.enemies[0].id === cur.bossId);
    check("echo hp matches scale: " + cur.id, enc.enemies[0].maxHp === Math.round(ENEMIES[cur.bossId].hp * cur.scale), `echo=${enc.enemies[0].maxHp} expected=${Math.round(ENEMIES[cur.bossId].hp * cur.scale)}`);
    trials.recordWin(cur.id);
  }
  check("gauntlet ran in order", seen.join(",") === expectedOrder.join(","));
  check("all thirteen cleared", trials.clearedCount() === 13);
  check("no trial remains", trials.currentTrial() === null);
  check("token balance 18", trials.tokens() === 18);

  // Apex echo met the expectation: double chrono with masamune.
  const apexEnc = trials.buildEncounter("apex");
  check("apex encounter was last", seen[seen.length - 1] === "apex");
  check("apex hp double chrono", apexEnc.enemies[0].maxHp === 2600);

  // The codex closes once the Apex falls.
  check("codex complete after apex", bestiary.complete() === true);
  check("thirteen pages known", bestiary.knownCount() === 13);

  // Vault: 18 tokens buys the top prizes and leaves the rest for elixirs.
  const tw = trials.purchase("timeweaver");
  check("timeweaver bought", tw.ok === true && tw.balance === 12);
  const ring = trials.purchase("oathRing");
  check("oath ring bought", ring.ok === true && ring.balance === 8);
  const mega = trials.purchase("megalixir");
  check("megalixir bought", mega.ok === true && mega.balance === 6);
  const phx = trials.purchase("phoenixPair");
  check("phoenix pair bought", phx.ok === true && phx.balance === 5);
  check("all vault rewards owned", inv.count("timeweaver") === 1 && inv.count("oathRing") === 1 && inv.count("megalixir") === 1 && inv.count("phoenixDown") === 2);
  check("five tokens left over", trials.tokens() === 5);

  // Masamune arrives from the apex hoard through the normal loot roll.
  const es = new EnemyTemplateSystem();
  check("masamune in apex hoard", es.lootFor(apexEnc.enemies[0], () => 0).includes("masamune"));

  return out;
}
