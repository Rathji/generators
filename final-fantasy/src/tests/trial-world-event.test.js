// Validation tests for Task #166: Trial Gate world event wiring.

import { WORLD_EVENTS } from "../data/world-events.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { TrialSystem } from "../engine/trials.js";
import { TRIALS } from "../data/trials.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { Inventory } from "../engine/inventory.js";

function fakeWorld(flags = {}) {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: () => false,
  };
}

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

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

  const gate = WORLD_EVENTS.find((e) => e.id === "trial_gate");
  check("trial gate event defined", !!gate);
  check("in the hall of trials", gate?.mapId === "trial_hall");
  check("on the pedestal (7,3)", gate?.x === 7 && gate?.y === 3);
  check("step trigger", gate?.on === "step");
  check("gated on chrono", gate?.require?.flag === "story_chrono_defeated");
  check("reusable (not once)", gate?.once === false);
  check("trialBattle type", gate?.event?.type === "trialBattle");

  // Pending only once Chrono falls.
  const flags = {};
  const sys = new WorldEventSystem(WORLD_EVENTS, { world: fakeWorld(flags), state: fakeState(flags) });
  check("gated before chrono", sys.pending("trial_hall", 7, 3, "step") === null);
  flags.story_chrono_defeated = true;
  check("pending after chrono", sys.pending("trial_hall", 7, 3, "step")?.id === "trial_gate");
  check("not on other tile", sys.pending("trial_hall", 7, 4, "step") === null);

  // End-to-end: trigger -> TrialSystem summons the first echo -> win records it.
  const state = fakeState(fullStoryFlags());
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const trials = new TrialSystem(TRIALS, { state, inventory: inv, enemySystem: new EnemyTemplateSystem() });
  let battle = null;
  const triggerOut = sys.trigger(gate, {
    trialBattle: () => {
      const cur = trials.currentTrial();
      if (!cur) return { ok: false };
      battle = { group: "trial_" + cur.id, bossId: cur.bossId, enc: trials.buildEncounter(cur.id) };
      trials.recordWin(cur.id);
      return { ok: true, id: cur.id };
    },
  });
  check("trialBattle routed", battle?.group === "trial_garland" && battle?.bossId === "garland");
  check("trigger reports started", triggerOut.started === true);
  check("win recorded via handler", state.getFlag("trial_garland_cleared") === true);
  check("tokens granted", state.flags.keeper_tokens === 1);
  check("gate stays reusable after use", sys.pending("trial_hall", 7, 3, "step")?.id === "trial_gate");

  // A second trigger summons the next trial in sequence.
  sys.trigger(gate, {
    trialBattle: () => {
      const cur = trials.currentTrial();
      if (!cur) return { ok: false };
      battle = { group: "trial_" + cur.id, bossId: cur.bossId };
      return { ok: true, id: cur.id };
    },
  });
  check("second trigger summons marsh guardian", battle?.bossId === "marshGuardian");

  // Empty handler is safe.
  const out2 = sys.trigger(gate, {});
  check("no handler -> not started", out2.started === false);

  return out;
}
