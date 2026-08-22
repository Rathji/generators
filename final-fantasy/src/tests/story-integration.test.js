// Validation tests for Task #100: Main Story Integration — the full arc from
// the king's plea to the restored crystals, driven through the same wiring the
// demo uses (plot chain + story milestones + world-event boss battles).

import { GameState } from "../engine/state.js";
import { PlotSequenceSystem } from "../engine/plot.js";
import { PLOT } from "../data/plot.js";
import { StoryDirector } from "../engine/events.js";
import { MAIN_STORY } from "../data/story.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const world = { getFlag: (n) => state.getFlag(n), hasItem: () => false };
  const dialogues = [];
  const plot = new PlotSequenceSystem(PLOT, { state, handlers: { dialogue: (id) => dialogues.push(id) } });
  const director = new StoryDirector({ state });
  director.registerMilestones(MAIN_STORY);
  const events = new WorldEventSystem(WORLD_EVENTS, { world, state });

  // Demo wiring helpers (mirror of rpg-demo.js advancePlot/advanceStory).
  const advancePlot = () => {
    let fired = false;
    let guard = 0;
    while (guard++ < 12) {
      const r = plot.advance();
      if (!r || r.triggered !== true) break;
      fired = true;
      let g2 = 0;
      while (plot.isRunning() && g2++ < 10) plot.resume();
    }
    return fired;
  };
  const advanceStory = () => {
    let ms = director.advanceMilestones();
    let guard = 0;
    while (ms && guard++ < 20) {
      if (director.isRunning()) director.advance();
      ms = director.advanceMilestones();
    }
  };
  const defeatBoss = (mapId, x, y) => {
    const def = events.pending(mapId, x, y, "step");
    if (!def) return false;
    let battleAct = null;
    events.trigger(def, { bossBattle: (act) => { battleAct = act; } });
    if (battleAct?.onWinFlag) state.setFlag(battleAct.onWinFlag, true);
    const plotFired = advancePlot();
    if (battleAct?.onWinDialogue && !plotFired) dialogues.push(battleAct.onWinDialogue);
    advanceStory();
    return true;
  };

  // Fresh arc: no chapter fired, no milestone started.
  check("arc not started", plot.progress().done === 0 && director.nextMilestone().id === "meet_the_king");

  // Opening: the king's plea (ch1), the dark knight (ch2), and the king met.
  state.setFlag("intro_seen", true);
  state.setFlag("crystal_key_found", true);
  advancePlot();
  check("ch1 fired (king's plea)", plot.isDone("ch1_kings_plea") && dialogues.includes("plot.king_plea"));
  advancePlot();
  check("ch2 fired (dark knight)", plot.isDone("ch2_dark_knight") && dialogues.includes("plot.garland_warning"));
  advanceStory();
  check("story started", state.getFlag("story_met_king") && state.getFlag("story_started"));

  // Garland blocks the shrine (overworld 13,2).
  check("garland boss pending", events.pending("overworld", 13, 2, "step")?.id === "chaos_shrine_boss");
  defeatBoss("overworld", 13, 2);
  check("garland defeat flag set", state.getFlag("story_garland_defeated"));
  check("ch3 fired (garland falls)", plot.isDone("ch3_garland_falls") && dialogues.includes("plot.garland_defeated"));
  check("fire crystal recovered", state.getFlag("crystal_fire") && state.getFlag("crystal_fire_dungeon_unlocked"));
  check("rescue milestone done", director.isMilestoneDone("rescue_the_princess"));
  check("crystal quest opened", director.isMilestoneStarted("find_the_four_crystals"));

  // Marsh Guardian (marsh_cave_b2 3,5).
  defeatBoss("marsh_cave_b2", 3, 5);
  check("ch4 fired (guardian slain)", plot.isDone("ch4_marsh_guardian_falls") && dialogues.includes("plot.marsh_guardian_defeated"));
  check("water crystal recovered", state.getFlag("crystal_water") && state.getFlag("crystal_water_dungeon_unlocked"));

  // Forge Golem (mount_gulg_b2 3,5).
  defeatBoss("mount_gulg_b2", 3, 5);
  check("ch5 fired (golem slain)", plot.isDone("ch5_gulg_guardian_falls") && dialogues.includes("plot.gulg_guardian_defeated"));
  check("earth crystal recovered", state.getFlag("crystal_earth"));
  check("ch6 fires after earth crystal", plot.isDone("ch6_chaos_awaits") && state.getFlag("chaos_awaited"));
  check("face chaos milestone started", director.isMilestoneStarted("face_chaos"));
  check("face chaos not yet done", director.isMilestoneDone("face_chaos") === false);

  // Chaos (chaos_shrine_b2 3,5) — now pending because chaos_awaited is set.
  check("chaos boss pending after earth crystal", events.pending("chaos_shrine_b2", 3, 5, "step")?.id === "chaos_boss");
  defeatBoss("chaos_shrine_b2", 3, 5);
  check("chaos defeat flag set", state.getFlag("story_chaos_defeated"));
  check("ch7 fired (chaos falls)", plot.isDone("ch7_chaos_defeated") && dialogues.includes("plot.chaos_defeated"));
  check("wind crystal recovered", state.getFlag("crystal_wind"));
  check("ch8 fires (light returns)", plot.isDone("ch8_light_restored") && dialogues.includes("plot.crystals_restored"));
  check("crystals restored", state.getFlag("story_crystals_restored"));

  // Endgame state.
  check("all four crystals", ["crystal_fire", "crystal_water", "crystal_earth", "crystal_wind"].every((f) => state.getFlag(f)));
  check("all plot chapters done", plot.progress().done === plot.progress().total);
  check("no chapters remain", plot.nextChapter() === null);
  check("all milestones done", director.nextMilestone() === null);
  check("all boss events consumed", events.pending("overworld", 13, 2, "step") === null && events.pending("chaos_shrine_b2", 3, 5, "step") === null);

  return out;
}
