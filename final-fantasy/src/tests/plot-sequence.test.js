// Validation tests for Task #59/#100: Plot-Critical Dialogue Sequence.
// Task #100 expanded the chain to the full arc (8 chapters, four crystals,
// and the final confrontation with Chaos).

import { PlotSequenceSystem } from "../engine/plot.js";
import { PLOT } from "../data/plot.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const inventory = new Inventory();
  const dialogues = [];
  const plot = new PlotSequenceSystem(PLOT, {
    state,
    handlers: { dialogue: (id) => dialogues.push(id) },
  });

  check("chapters defined", plot.chapterById("ch1_kings_plea")?.name === "The King's Plea");
  check("full arc has 8 chapters", plot.progress().total === 8);
  check("nothing done initially", plot.isDone("ch1_kings_plea") === false);
  check("next chapter is ch1", plot.nextChapter()?.id === "ch1_kings_plea");
  check("triggers unmet -> no fire", plot.advance()?.triggered === false || plot.advance() === null);

  // Chapter 1 — the king's plea.
  state.setFlag("intro_seen", true);
  const started = plot.advance();
  check("chapter starts when triggered", started && started.chapter === "ch1_kings_plea" && started.triggered === true);
  check("chapter marked started", plot.isStarted("ch1_kings_plea") === true);
  check("dialogue handler fired for blocking step", dialogues.includes("plot.king_plea"));
  check("chapter waiting on dialogue", started.waiting === true && plot.isRunning() === true);
  check("not done while waiting", plot.isDone("ch1_kings_plea") === false);

  plot.resume();
  check("chapter completes after resume", plot.isDone("ch1_kings_plea") === true);
  check("sequence set the followup flag", state.getFlag("plot_ch1_reward_ready") === true);
  check("next chapter advances", plot.nextChapter()?.id === "ch2_dark_knight");

  // Chapter 2 — the dark knight.
  state.setFlag("crystal_key_found", true);
  const ch2 = plot.advance();
  check("chapter 2 starts", ch2 && ch2.chapter === "ch2_dark_knight");
  check("garland warning dialogue fired", dialogues.includes("plot.garland_warning"));
  plot.resume();
  check("chapter 2 done", plot.isDone("ch2_dark_knight") === true);
  check("chapter 3 still gated", plot.nextChapter()?.id === "ch3_garland_falls");
  check("chapter 3 not fireable early", (() => {
    const r = plot.advance();
    return r === null || r.triggered === false;
  })());

  // Chapter 3 — Garland falls, Fire Crystal recovered.
  state.setFlag("story_garland_defeated", true);
  const ch3 = plot.advance();
  check("chapter 3 starts after garland", ch3 && ch3.chapter === "ch3_garland_falls");
  check("garland victory dialogue fired", dialogues.includes("plot.garland_defeated"));
  plot.resume();
  check("chapter 3 done", plot.isDone("ch3_garland_falls") === true);
  check("fire crystal set", state.getFlag("crystal_fire") === true);
  check("fire dungeon unlocked", state.getFlag("crystal_fire_dungeon_unlocked") === true);
  check("next is marsh chapter", plot.nextChapter()?.id === "ch4_marsh_guardian_falls");

  // Chapter 4 — Marsh Guardian falls, Water Crystal recovered.
  state.setFlag("story_marsh_guardian_defeated", true);
  const ch4 = plot.advance();
  check("chapter 4 starts after guardian", ch4 && ch4.chapter === "ch4_marsh_guardian_falls");
  check("marsh victory dialogue fired", dialogues.includes("plot.marsh_guardian_defeated"));
  plot.resume();
  check("chapter 4 done", plot.isDone("ch4_marsh_guardian_falls") === true);
  check("water crystal set", state.getFlag("crystal_water") === true);
  check("water dungeon unlocked", state.getFlag("crystal_water_dungeon_unlocked") === true);

  // Chapter 5 — Forge Golem falls, Earth Crystal recovered.
  state.setFlag("story_gulg_guardian_defeated", true);
  const ch5 = plot.advance();
  check("chapter 5 starts after golem", ch5 && ch5.chapter === "ch5_gulg_guardian_falls");
  check("gulg victory dialogue fired", dialogues.includes("plot.gulg_guardian_defeated"));
  plot.resume();
  check("chapter 5 done", plot.isDone("ch5_gulg_guardian_falls") === true);
  check("earth crystal set", state.getFlag("crystal_earth") === true);
  check("wind crystal still locked", state.getFlag("crystal_wind") !== true);

  // Chapter 6 — Chaos awaits.
  const ch6 = plot.advance();
  check("chapter 6 starts on earth crystal", ch6 && ch6.chapter === "ch6_chaos_awaits");
  check("chaos awaits dialogue fired", dialogues.includes("plot.chaos_awaits"));
  plot.resume();
  check("chapter 6 done", plot.isDone("ch6_chaos_awaits") === true);
  check("chaos_awaited set", state.getFlag("chaos_awaited") === true);

  // Chapter 7 — Chaos falls, Wind Crystal recovered.
  state.setFlag("story_chaos_defeated", true);
  const ch7 = plot.advance();
  check("chapter 7 starts after chaos", ch7 && ch7.chapter === "ch7_chaos_defeated");
  check("chaos victory dialogue fired", dialogues.includes("plot.chaos_defeated"));
  plot.resume();
  check("chapter 7 done", plot.isDone("ch7_chaos_defeated") === true);
  check("wind crystal set", state.getFlag("crystal_wind") === true);

  // Chapter 8 — the light returns.
  const ch8 = plot.advance();
  check("chapter 8 fires on wind crystal", ch8 && ch8.chapter === "ch8_light_restored");
  check("restored dialogue fired", dialogues.includes("plot.crystals_restored"));
  plot.resume();
  check("story_crystals_restored set", state.getFlag("story_crystals_restored") === true);

  check("progress complete", (() => { const p = plot.progress(); return p.done === p.total; })());
  check("no more chapters", plot.nextChapter() === null);

  // Strict chronological gating: an out-of-order flag never skips a chapter.
  const state2 = new GameState();
  const plot2 = new PlotSequenceSystem(PLOT, {
    state: state2,
    handlers: { dialogue: () => {} },
  });
  state2.setFlag("intro_seen", true);
  plot2.advance();
  plot2.resume();
  state2.setFlag("story_gulg_guardian_defeated", true); // gulg before ch3/ch4
  const stuck = plot2.nextChapter();
  check("out-of-order flags cannot skip chapters", stuck?.id === "ch2_dark_knight");
  const tried = plot2.advance();
  check("gulg chapter unreachable early", tried === null || tried.triggered === false);
  state2.setFlag("crystal_key_found", true);
  plot2.advance();
  plot2.resume();
  state2.setFlag("story_garland_defeated", true);
  plot2.advance();
  plot2.resume();
  state2.setFlag("story_marsh_guardian_defeated", true);
  plot2.advance();
  plot2.resume();
  const gulg = plot2.advance();
  check("gulg chapter fires in order", gulg && gulg.chapter === "ch5_gulg_guardian_falls");
  plot2.resume();
  check("earth crystal via ordered chain", state2.getFlag("crystal_earth") === true);

  // enterMap trigger style
  const state3 = new GameState();
  const plot3 = new PlotSequenceSystem([
    { id: "arrival", name: "Arrival", triggers: [{ type: "enterMap", mapId: "cornelia", x: 7, y: 5 }], sequence: [{ type: "setFlag", flag: "arrival_done" }] },
  ], { state: state3 });
  const notFired = plot3.advance();
  check("enterMap not fired by advance", notFired === null || notFired.triggered === false);
  const moved = plot3.check("cornelia", 7, 5);
  check("enterMap fires on tile", moved && moved.chapter === "arrival" && moved.triggered === true);
  check("non-blocking sequence completes immediately", plot3.isDone("arrival") === true);
  check("no double fire", plot3.check("cornelia", 7, 5) === null);

  return out;
}
