// Validation tests for Task #165: Keeper Token vault — items & purchases.

import { TrialSystem } from "../engine/trials.js";
import { TRIALS, TRIAL_REWARDS } from "../data/trials.js";
import { ITEMS } from "../data/items.js";
import { Inventory } from "../engine/inventory.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // The vault items exist with real stats.
  check("timeweaver exists", !!ITEMS.timeweaver);
  check("timeweaver is a legendary weapon", ITEMS.timeweaver.type === "weapon" && ITEMS.timeweaver.rarity === "legendary");
  check("timeweaver atk 38", ITEMS.timeweaver.mods?.atk === 38);
  check("oathRing exists", !!ITEMS.oathRing);
  check("oathRing wards all statuses", (ITEMS.oathRing.statusImmune ?? []).length === 4);
  check("megalixir exists", !!ITEMS.megalixir);
  check("megalixir restores all", ITEMS.megalixir.effect?.kind === "healAll");
  check("masamune atk 42 beats everything", ITEMS.masamune.mods?.atk === 42 && ITEMS.masamune.mods.atk > ITEMS.eternalBlade.mods.atk);

  // Purchasing flow.
  const flags = { keeper_tokens: 10 };
  const state = fakeState(flags);
  const inventory = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const sys = new TrialSystem(TRIALS, { state, inventory, enemySystem: null, rewards: TRIAL_REWARDS });

  check("tokens read from state", sys.tokens() === 10);
  check("rewards listed", sys.listRewards().length === 4);
  check("no reward bought yet", sys.listRewards().every((r) => r.bought === false));

  // Can't afford the Timeweaver at 10 tokens... it costs 6, so can afford. Test a too-expensive case first.
  check("cannot afford unknown reward", sys.purchase("bogus").ok === false);
  const poor = new TrialSystem(TRIALS, { state: fakeState({ keeper_tokens: 1 }), inventory: new Inventory(), rewards: TRIAL_REWARDS });
  const denied = poor.purchase("timeweaver");
  check("cannot afford timeweaver with 1 token", denied.ok === false && denied.error === "not enough tokens");
  check("no deduction on failed buy", poor.tokens() === 1);

  // Buy the Oath Ring (4) -> balance 6, item in inventory.
  const b1 = sys.purchase("oathRing");
  check("oath ring bought", b1.ok === true && b1.item === "oathRing" && b1.balance === 6);
  check("inventory has oath ring", inventory.count("oathRing") === 1);
  check("flagged as bought", sys.isRewardBought("oathRing") === true);
  check("can't rebuy", sys.purchase("oathRing").ok === false);

  // Buy the Timeweaver (6) -> balance 0.
  const b2 = sys.purchase("timeweaver");
  check("timeweaver bought", b2.ok === true && b2.balance === 0);
  check("inventory has timeweaver", inventory.count("timeweaver") === 1);

  // No tokens left.
  const b3 = sys.purchase("megalixir");
  check("empty balance denies", b3.ok === false && b3.error === "not enough tokens");

  // Multi-count reward.
  const phx = new TrialSystem(TRIALS, { state: fakeState({ keeper_tokens: 1 }), inventory: new Inventory(), rewards: TRIAL_REWARDS });
  const b4 = phx.purchase("phoenixPair");
  check("phoenix pair buys two", b4.ok === true && b4.count === 2 && phx.tokens() === 0);

  // Full inventory denies without charging.
  const tiny = new Inventory({ maxSlots: 0, maxWeight: 100 });
  const full = new TrialSystem(TRIALS, { state: fakeState({ keeper_tokens: 10 }), inventory: tiny, rewards: TRIAL_REWARDS });
  const b5 = full.purchase("megalixir");
  check("full inventory denies", b5.ok === false && b5.error === "inventory full");
  check("tokens not spent on failed buy", full.tokens() === 10);

  // Winning trials funds purchases (13 base tokens pays for timeweaver + ring).
  const flags2 = {
    story_garland_defeated: true, story_marsh_guardian_defeated: true, story_gulg_guardian_defeated: true,
    story_chaos_defeated: true, story_iron_sentinel_defeated: true, story_tide_serpent_defeated: true,
    story_phantom_light_defeated: true, story_wind_fiend_defeated: true, story_forge_colossus_defeated: true,
    story_frost_wyrm_defeated: true, story_ember_fiend_defeated: true, story_chrono_defeated: true,
  };
  const st2 = fakeState(flags2);
  const inv2 = new Inventory();
  const sys2 = new TrialSystem(TRIALS, { state: st2, inventory: inv2, rewards: TRIAL_REWARDS });
  for (const t of sys2.all()) sys2.recordWin(t.id);
  check("full gauntlet = 18 tokens", sys2.tokens() === 18);
  const tw = sys2.purchase("timeweaver");
  check("timeweaver affordable from trials alone", tw.ok === true && sys2.tokens() === 12);
  const ring = sys2.purchase("oathRing");
  check("oath ring affordable after", ring.ok === true && sys2.tokens() === 8);

  return out;
}
