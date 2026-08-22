// Validation tests for Task #38/#100: Main Story Trigger Sequence.
// Task #100: the chain now hands off to the plot chapters for crystal
// recovery (empty crystal-hunting sequences) and tracks the final arc.

import { StoryDirector } from "../engine/events.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { MAIN_STORY } from "../data/story.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const party = new PartyManager({ gold: 0 });
  const inv = new Inventory();
  const dir = new StoryDirector({ state, party, inventory: inv });
  dir.registerMilestones(MAIN_STORY);

  check("milestones registered", dir.milestoneList().length === MAIN_STORY.length);
  check("five-milestone arc", MAIN_STORY.length === 5);
  check("first milestone is intro", dir.nextMilestone().id === "meet_the_king");
  check("intro ready immediately", dir.isMilestoneReady("meet_the_king") === true);
  check("not started yet", dir.isMilestoneStarted("meet_the_king") === false);

  const ready = dir.nextReadyMilestone();
  check("next ready milestone", ready.id === "meet_the_king");

  const started = dir.advanceMilestones();
  check("advanceMilestones starts intro", started.id === "meet_the_king" && dir.isMilestoneStarted("meet_the_king") === true);
  check("sequence queued", dir.isRunning() === true);

  const run1 = dir.advance();
  check("sequence completes", run1.done === true && run1.milestoneCompleted === "meet_the_king");
  check("intro flag set", state.getFlag("story_met_king") && state.getFlag("story_started"));

  check("intro marked done", dir.isMilestoneDone("meet_the_king") === true);
  check("next milestone progressed", dir.nextMilestone().id === "rescue_the_princess");
  check("rescue now ready", dir.isMilestoneReady("rescue_the_princess") === true);

  const r2 = dir.advanceMilestones();
  check("rescue started", r2.id === "rescue_the_princess" && dir.isMilestoneStarted("rescue_the_princess"));
  check("rescue sequence runs", dir.advance().done === true);

  state.setFlag("story_garland_defeated");
  check("completeOnFlag marks done", dir.isMilestoneDone("rescue_the_princess") === true);

  const r3 = dir.advanceMilestones();
  check("crystal quest next", r3.id === "find_the_four_crystals");
  check("crystal quest starts", dir.isMilestoneStarted("find_the_four_crystals") === true);
  check("crystal quest open until earth found", dir.isMilestoneDone("find_the_four_crystals") === false);
  check("face chaos not ready until earth", dir.isMilestoneReady("face_chaos") === false);
  state.setFlag("crystal_earth");
  check("crystal quest completes on earth crystal", dir.isMilestoneDone("find_the_four_crystals") === true);
  check("face chaos ready on earth crystal", dir.isMilestoneReady("face_chaos") === true);
  const r5 = dir.advanceMilestones();
  check("face chaos started", r5.id === "face_chaos");
  check("face chaos open until chaos falls", dir.isMilestoneDone("face_chaos") === false);
  check("restore not ready yet", dir.isMilestoneReady("restore_the_crystals") === false);
  state.setFlag("story_chaos_defeated");
  check("face chaos completes on chaos defeat", dir.isMilestoneDone("face_chaos") === true);
  state.setFlag("story_chaos_defeated");
  check("restore ready after chaos", dir.isMilestoneReady("restore_the_crystals") === true);
  const r6 = dir.advanceMilestones();
  check("restore started", r6.id === "restore_the_crystals");
  dir.advance();
  check("crystals restored", state.getFlag("story_crystals_restored"));

  check("no more milestones after chain", dir.nextMilestone() === null && dir.nextReadyMilestone() === null);
  check("unknown milestone null", dir.startMilestone("nope") === null);
  check("milestoneDef lookup", dir.milestoneDef("rescue_the_princess").name === "Rescue the Princess from Garland");

  const state2 = new GameState();
  const dir2 = new StoryDirector({ state: state2 });
  dir2.registerMilestones(MAIN_STORY);
  check("fresh director has no ready chain started", dir2.nextReadyMilestone().id === "meet_the_king");
  check("can complete without state", dir2.completeMilestone("meet_the_king")?.id === "meet_the_king");

  return out;
}
