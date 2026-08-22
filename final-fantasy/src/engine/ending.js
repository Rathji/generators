// Task #104: EndingSystem — the victory ending. Playable only once the light
// is restored (story_crystals_restored); runs the closing scenes through the
// CinematicSystem, then marks the game complete (via GameCompletionSystem),
// granting Free Roam. Idempotent — the ending plays once per save.

import { ENDING_SCENES, CREDITS } from "../data/ending.js";

export class EndingSystem {
  constructor(opts = {}) {
    this.scenes = opts.scenes ?? ENDING_SCENES;
    this.credits = opts.credits ?? CREDITS;
    this.state = opts.state ?? null;
    this.cinematic = opts.cinematic ?? null;
    this.completion = opts.completion ?? null;
    this.onDone = opts.onDone ?? null;
    this.started = false;
    this.creditsRolled = false;
  }

  isReady() {
    return !!(this.state && this.state.getFlag("story_crystals_restored"));
  }

  isStarted() {
    return this.started;
  }

  // Map scenes to cinematic lines ("Speaker: text"; the last scene carries
  // the `ending_seen` flag).
  lines() {
    return this.scenes.map((s) => ({
      text: s.speaker && s.speaker !== "Narrator" ? s.speaker + ": " + s.text : s.text,
      flag: s.flag ?? undefined,
    }));
  }

  begin(opts = {}) {
    if (this.started) return { ok: false, error: "already_started" };
    if (!this.isReady()) return { ok: false, error: "not_ready" };
    this.started = true;
    if (this.cinematic) {
      this.cinematic.play(this.lines(), {
        hint: opts.hint ?? "The age of darkness is over — press Enter to continue",
        onDone: () => this.finish(),
      });
    } else {
      // Headless: run the line flags directly so logic-only callers work.
      for (const l of this.lines()) {
        if (l.flag && this.state?.setFlag) this.state.setFlag(l.flag, l.value ?? true);
      }
      this.finish();
    }
    return { ok: true, started: true };
  }

  finish() {
    if (!this.started) return { ok: false, error: "not_started" };
    this.started = false;
    if (this.completion) this.completion.complete();
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb();
    return { ok: true, completed: true };
  }

  // The credits text block; returns them and marks them rolled so the game
  // only shows them after the scenes (or exactly once).
  creditLines() {
    this.creditsRolled = true;
    return [...this.credits];
  }

  status() {
    return {
      ready: this.isReady(),
      started: this.started,
      creditsRolled: this.creditsRolled,
      complete: this.completion?.isCompleted?.() ?? false,
    };
  }
}
