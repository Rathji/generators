// Validation tests for Task #104: EndingSystem — the victory ending data,
// readiness gating, the cinematic handoff, one-shot-while-playing guard, and
// the completion handshake that unlocks Free Roam.

import { ENDING_SCENES, CREDITS } from "../data/ending.js";
import { EndingSystem } from "../engine/ending.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

function fakeCinematic() {
  const c = {
    played: null,
    opts: null,
    play(lines, opts) {
      this.played = lines;
      this.opts = opts;
    },
    end() {
      if (this.opts?.onDone) this.opts.onDone();
    },
  };
  return c;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("at least 5 ending scenes", ENDING_SCENES.length >= 5);
  check("at least 5 credits lines", CREDITS.length >= 5);
  check("last scene carries the ending_seen flag", ENDING_SCENES[ENDING_SCENES.length - 1]?.flag === "ending_seen");
  check(
    "every scene has text",
    ENDING_SCENES.every((s) => typeof s.text === "string" && s.text.length > 0)
  );

  const state = fakeState();
  const completion = { calls: 0, isCompleted: () => state.getFlag("game_completed"), complete: () => { completion.calls++; state.setFlag("game_completed", true); state.setFlag("free_roam", true); } };
  const cin = fakeCinematic();
  let doneFired = 0;
  const ending = new EndingSystem({ state, cinematic: cin, completion, onDone: () => doneFired++ });

  check("not ready before light restored", ending.isReady() === false);
  check("begin denied when not ready", ending.begin().ok === false && ending.isStarted() === false);
  check("cinematic untouched", cin.played === null);

  state.setFlag("story_crystals_restored", true);
  check("ready after light restored", ending.isReady() === true);

  const b = ending.begin();
  check("begin ok + started", b.ok === true && ending.isStarted() === true);
  check("cinematic got scenes", Array.isArray(cin.played) && cin.played.length === ENDING_SCENES.length);
  check("speaker prefixes applied", cin.played[1].text.startsWith("King Cornelia: ") && cin.played[0].text === ENDING_SCENES[0].text);
  check("final line carries flag", cin.played[cin.played.length - 1].flag === "ending_seen");

  const dup = ending.begin();
  check("duplicate begin blocked while playing", dup.ok === false && dup.error === "already_started");
  check("nothing completed yet", completion.calls === 0 && doneFired === 0);

  cin.end();
  check("finish clears started", ending.isStarted() === false);
  check("completion marked", completion.calls === 1 && completion.isCompleted() === true);
  check("free roam unlocked", state.getFlag("free_roam") === true);
  check("onDone fired once", doneFired === 1);

  // Headless mode (no cinematic) runs flags and completes immediately.
  const state2 = fakeState({ story_crystals_restored: true });
  const headless = new EndingSystem({ state: state2, cinematic: null });
  const hb = headless.begin();
  check("headless begin ok", hb.ok === true);
  check("headless completes + sets flag", headless.isStarted() === false && state2.getFlag("ending_seen") === true);

  const credits = new EndingSystem({ state, completion });
  const lines = credits.creditLines();
  check("creditLines returns the credits", Array.isArray(lines) && lines.length === CREDITS.length && lines[0] === CREDITS[0]);
  check("creditsRolled flag set", credits.status().creditsRolled === true);
  check("status reflects completion", credits.status().complete === true);

  return out;
}
