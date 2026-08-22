// Validation tests for Task #40: Cinematic Text Sequence.

import { CinematicSystem } from "../engine/cinematic.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  let doneCalls = 0;
  const locks = [];
  const cin = new CinematicSystem({
    state,
    onDone: () => doneCalls++,
    onLockChange: (locked) => locks.push(locked),
  });

  const lines = [
    "The four crystals glow.",
    { text: "A great darkness stirs...", flag: "cinematic_prologue_seen" },
    "Heroes of the light, awaken.",
  ];

  check("not playing initially", cin.isPlaying === false && cin.inputLocked === false);
  cin.play(lines, { headless: true });
  check("playing after play", cin.isPlaying === true && cin.inputLocked === true);
  check("lock reported", locks.join(",") === "true");
  check("first line current", cin.current.text === lines[0]);

  cin.advance();
  check("advance to line 2", cin.index === 1 && cin.current.text === lines[1].text);
  check("flag applied on show", state.getFlag("cinematic_prologue_seen") === true);

  cin.advance();
  check("third line", cin.current.text === lines[2]);
  const end = cin.advance();
  check("final advance ends", end.done === true && cin.isPlaying === false && cin.inputLocked === false);
  check("onDone fired", doneCalls === 1);
  check("unlock reported", locks.join(",") === "true,false");

  const cin2 = new CinematicSystem({ state });
  cin2.play(["a", "b"], { headless: true });
  cin2.skip();
  check("skip ends immediately", cin2.isPlaying === false);

  const state3 = new GameState();
  const cin3 = new CinematicSystem({ state: state3 });
  const flagged = [{ text: "x", flag: "flag_a" }, { text: "y", flag: "flag_b" }];
  cin3.play(flagged, { headless: true });
  check("first flag applied on show", state3.getFlag("flag_a") === true && state3.getFlag("flag_b") === false);
  cin3.advance();
  check("advance applies next flag", state3.getFlag("flag_b") === true);
  cin3.skip();
  check("skip ends", cin3.isPlaying === false);

  const cin4 = new CinematicSystem();
  cin4.play(["only line"], { headless: true });
  check("no state handler still fine", cin4.advance().done === true);

  const cin5 = new CinematicSystem({ state: new GameState() });
  const before = cin5.play([{ text: "t", flag: "handled_flag" }], { headless: true, onDone: null });
  check("play returns self", before === cin5);

  // DOM-backed cinematic (document exists in the live page).
  const cin6 = new CinematicSystem({ state: new GameState() });
  cin6.play(["DOM line"], {});
  const overlay = document.querySelector(".cinematic-overlay");
  check("overlay built", overlay !== null && overlay.querySelector(".cin-text").textContent === "DOM line");
  overlay.querySelector(".cin-text");
  cin6.advance();
  check("overlay removed on end", document.querySelector(".cinematic-overlay") === null);
  check("cinematic cleanup", cin6.el === null);

  const cin7 = new CinematicSystem({ state: new GameState() });
  cin7.play(["Enter me"], {});
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  check("enter key advances", cin7.index === 1 && cin7.playing === false);
  check("key handler detached", cin7._keyHandler === null);

  return out;
}
