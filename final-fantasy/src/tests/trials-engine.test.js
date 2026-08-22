// Validation tests for Task #164: TrialSystem engine — gauntlet flow.

import { TrialSystem } from "../engine/trials.js";
import { TRIALS } from "../data/trials.js";
import { ENEMIES } from "../data/enemies.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

function fakeInventory() {
  const stacks = new Map();
  return {
    add: (item, count = 1) => {
      stacks.set(item, (stacks.get(item) ?? 0) + count);
      return true;
    },
    stacks,
  };
}

// State where every boss story flag is set (post-Chrono player).
function fullStoryFlags() {
  return {
    story_garland_defeated: true,
    story_marsh_guardian_defeated: true,
    story_gulg_guardian_defeated: true,
    story_chaos_defeated: true,
    story_iron_sentinel_defeated: true,
    story_tide_serpent_defeated: true,
    story_phantom_light_defeated: true,
    story_wind_fiend_defeated: true,
    story_forge_colossus_defeated: true,
    story_frost_wyrm_defeated: true,
    story_ember_fiend_defeated: true,
    story_chrono_defeated: true,
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
  const state = fakeState(flags);
  const inv = fakeInventory();
  const sys = new TrialSystem(TRIALS, { state, party: null, inventory: inv, enemySystem: new EnemyTemplateSystem() });

  check("all() sorted by order", sys.all().map((t) => t.order).join(",") === "1,2,3,4,5,6,7,8,9,10,11,12,13");
  check("trial() lookup", sys.trial("chrono")?.bossId === "chrono");

  // Sequential gating: with all story flags, only the first trial is open.
  const report = sys.statusReport();
  check("garland unlocked first", report[0].unlocked === true);
  check("second trial locked until first cleared", report[1].unlocked === false);
  check("apex locked until all base cleared", report[12].unlocked === false);
  check("currentTrial is garland", sys.currentTrial()?.id === "garland");

  // startTrial validates.
  check("start order-2 trial locked", sys.startTrial("marsh_guardian").ok === false);
  const s1 = sys.startTrial("garland");
  check("start garland ok", s1.ok === true);
  check("battle action shape", s1.battle?.type === "bossBattle" && s1.battle?.group === "trial_garland");
  check("battle targets garland", s1.battle?.bossId === "garland");

  // buildEncounter produces a scaled boss.
  const enc = sys.buildEncounter("garland");
  check("encounter has one enemy", enc.enemies.length === 1);
  const echo = enc.enemies[0];
  const base = ENEMIES.garland;
  check("echo hp scaled", echo.maxHp === Math.round(base.hp * 1.15), `echo=${echo.maxHp} base=${base.hp}`);
  check("echo str scaled", echo.str === Math.round(base.str * 1.15));
  check("echo keeps boss flag", echo.boss === true);
  check("echo keeps phases", Array.isArray(echo.phases) && echo.phases.length >= 1);
  check("echo fresh battle state", echo.currentPhase === 0);

  // recordWin grants tokens + unlocks the next trial.
  const w1 = sys.recordWin("garland");
  check("win records cleared flag", flags.trial_garland_cleared === true);
  check("win grants one token", w1.balance === 1);
  check("garland no longer current", sys.currentTrial()?.id === "marsh_guardian");
  check("marsh now unlocked", sys.statusReport()[1].unlocked === true);
  check("re-clearing refused", sys.startTrial("garland").ok === false);

  // Clear through the whole base gauntlet (2 tokens on chrono).
  const order = sys.all();
  for (const t of order.filter((x) => !x.apex).slice(1)) {
    const r = sys.recordWin(t.id);
    check("win " + t.id, r.ok === true);
  }
  check("all base cleared", sys.allBaseCleared() === true);
  check("token total 13 + 5 after apex included later", sys.tokens() === 13);
  check("currentTrial is apex", sys.currentTrial()?.id === "apex");
  check("apex unlocked", sys.statusReport()[12].unlocked === true);
  const apex = sys.buildEncounter("apex");
  check("apex boss named", apex.enemies[0].name === "Apex Chrono, Keeper of Eternity");
  check("apex hp doubled", apex.enemies[0].maxHp === Math.round(ENEMIES.chrono.hp * 2), `echo=${apex.enemies[0].maxHp}`);
  check("apex hoard present", apex.enemies[0].loot.some((l) => l.itemId === "masamune"));
  const wApex = sys.recordWin("apex");
  check("apex grants five tokens", wApex.balance === 18);
  check("gauntlet complete", sys.currentTrial() === null);

  // Without story flags, nothing unlocks.
  const fresh = new TrialSystem(TRIALS, { state: fakeState({}), inventory: fakeInventory(), enemySystem: new EnemyTemplateSystem() });
  check("no story flags -> no trial", fresh.currentTrial() === null);
  check("locked start refused", fresh.startTrial("garland").ok === false);

  // Unknown ids are safe.
  check("unknown trial safe", sys.trial("bogus") === null && sys.startTrial("bogus").ok === false);

  return out;
}
