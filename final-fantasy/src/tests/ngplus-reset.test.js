// Validation tests for Task #194: New Game+ world reset — story and quest
// flags are cleared, meta flags (waystones, trials, bestiary, tokens, ng+)
// survive, and the replay state is a clean slate at carried strength.

import { NgPlusSystem } from "../engine/ngplus.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const party = new PartyManager({ gold: 500 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior", level: 8 }));
  const inv = new Inventory();
  inv.add("potion", 3);

  // Pre-seed every kind of flag.
  state.setFlag("intro_seen", true);
  state.setFlag("story_chrono_defeated", true);
  state.setFlag("story_garland_defeated", true);
  state.setFlag("crystal_key_found", true);
  state.setFlag("sq_the_waystone_pilgrim_done", true);
  state.setFlag("sq_herbalists_request_done", true);
  state.setFlag("waystone_cornelia", true);
  state.setFlag("waystone_pravog", true);
  state.setFlag("trial_garland_cleared", true);
  state.setFlag("trial_apex_cleared", true);
  state.setFlag("any_trial_cleared", true);
  state.setFlag("bestiary_goblin_seen", true);
  state.setFlag("keeper_tokens", 7);
  state.setFlag("ngplus_echo_unlocked", true);
  state.setFlag("random_other_thing", true);
  state.setStoryPhase(4);

  const ng = new NgPlusSystem({ state, party, inventory: inv });
  const r = ng.startCycle();

  check("cycle 2", r.ok === true && ng.cycle() === 2);
  const flags = state.flags;

  check("story flags cleared", flags.story_chrono_defeated === undefined && flags.story_garland_defeated === undefined);
  check("quest flags cleared", flags.sq_the_waystone_pilgrim_done === undefined && flags.sq_herbalists_request_done === undefined);
  check("plot flags cleared", flags.crystal_key_found === undefined);
  check("misc flags cleared", flags.random_other_thing === undefined);
  check("intro kept", flags.intro_seen === true);
  check("waystones kept", flags.waystone_cornelia === true && flags.waystone_pravog === true);
  check("trials kept", flags.trial_garland_cleared === true && flags.trial_apex_cleared === true);
  check("bestiary kept", flags.bestiary_goblin_seen === true);
  check("tokens kept", flags.keeper_tokens === 7);
  check("story phase reset", state.getStoryPhase() === 0);
  check("party rebuilt in place", party.members.length === 1 && party.members[0].level === 8);

  return out;
}
