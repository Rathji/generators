// Validation tests for Task #47: Combat Sound Trigger System.

import { SoundTriggerSystem, SynthAudio, CUES_DEFS } from "../engine/sounds.js";

class FakeEngine {
  constructor() {
    this.muted = false;
    this.plays = [];
  }
  play(freqs, opts) {
    if (this.muted) return null;
    this.plays.push({ freqs: [...freqs], opts });
    return { notes: freqs.filter(Boolean).length, at: 0 };
  }
  setMuted(m) {
    this.muted = m;
  }
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const eng = new FakeEngine();
  const s = new SoundTriggerSystem({ engine: eng });

  check("cue defs cover combat events", ["attack", "hit", "spell", "heal", "item", "victory", "defeat", "levelUp", "battleStart", "menuMove", "menuSelect", "miss"].every((c) => CUES_DEFS[c]));

  const r = s.trigger("attack");
  check("attack cue plays", r.ok === true && r.played === true);
  check("engine received freqs", eng.plays.length === 1 && eng.plays[0].freqs.length === 3);
  check("last cue tracked", s.last.event === "attack");

  check("unknown cue rejected", s.trigger("bogus").ok === false);

  s.trigger("victory");
  check("victory queued", eng.plays.length === 2);
  s.trigger("menuMove");
  check("menu move queued", eng.plays.length === 3);

  s.setEnabled(false);
  const disabled = s.trigger("heal");
  check("disabled system skips playback", disabled.played === false && eng.plays.length === 3);
  s.setEnabled(true);

  s.mute();
  check("muted state", s.muted === true);
  const muted = s.trigger("spell");
  check("muted trigger does not play", muted.played === false && eng.plays.length === 3);
  s.unmute();
  check("unmuted", s.muted === false);
  s.setMuted(true);
  check("setMuted mutes", s.muted === true);
  s.setMuted(false);
  check("setMuted unmutes", s.muted === false);
  s.trigger("spell");
  check("plays again after unmute", eng.plays.length === 4);

  const sa = new SynthAudio();
  check("synth starts muted by default", sa.muted === true);
  sa._ensure = () => null;
  const noCtx = new SoundTriggerSystem({ engine: sa });
  check("synth no-ops without audio context", noCtx.trigger("attack").played === false);

  const emptyEng = new SynthAudio();
  emptyEng.setMuted(true);
  check("synth muted returns no play", emptyEng.play([440]) === null);

  const eng2 = new FakeEngine();
  eng2.unlock = () => { eng2.unlocked = true; };
  const s2 = new SoundTriggerSystem({ engine: eng2 });
  s2.unlock();
  check("unlock delegates to engine", eng2.unlocked === true);
  s2.setEnabled(false);
  check("setEnabled chained", s2.enabled === false);

  check("cue() returns a copy", (() => {
    const c = s.cue("victory");
    return c && c.freqs.length === 4 && c !== CUES_DEFS.victory;
  })());

  return out;
}
