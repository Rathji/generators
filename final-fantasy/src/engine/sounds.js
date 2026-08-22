// Task #47: Combat Sound Trigger System — event-to-cue mapping for attacks,
// spells, items, victory and defeat, backed by a tiny WebAudio synth so no
// audio files are needed.

const CUES = {
  battleStart: { freqs: [330, 415, 494], wave: "sawtooth", interval: 0.1, dur: 0.15 },
  attack: { freqs: [220, 180, 140], wave: "square", interval: 0.06, dur: 0.09 },
  hit: { freqs: [90, 60], wave: "sawtooth", interval: 0.04, dur: 0.12 },
  miss: { freqs: [300, 260], wave: "square", interval: 0.05, dur: 0.05 },
  spell: { freqs: [440, 550, 660, 880], wave: "triangle", interval: 0.07, dur: 0.12 },
  heal: { freqs: [523, 659, 784], wave: "sine", interval: 0.08, dur: 0.14 },
  item: { freqs: [392, 523, 659], wave: "square", interval: 0.06, dur: 0.08 },
  menuMove: { freqs: [520], wave: "square", interval: 0, dur: 0.04 },
  menuSelect: { freqs: [780, 1046], wave: "square", interval: 0.05, dur: 0.07 },
  levelUp: { freqs: [523, 659, 784, 1047, 784, 1047], wave: "square", interval: 0.09, dur: 0.11 },
  victory: { freqs: [523, 659, 784, 1047], wave: "square", interval: 0.12, dur: 0.16 },
  defeat: { freqs: [392, 330, 262, 196], wave: "sawtooth", interval: 0.16, dur: 0.22 },
};

// WebAudio beep synth. No-op when no AudioContext is available.
export class SynthAudio {
  constructor(opts = {}) {
    this.ctx = null;
    // Task #227: audio is off by default — the player turns it on.
    this.muted = opts.startMuted ?? true;
    this.volume = opts.volume ?? 0.2;
  }

  _ensure() {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    return this.ctx;
  }

  unlock() {
    const ctx = this._ensure();
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  setMuted(m) {
    this.muted = !!m;
  }

  // Play a sequence of frequencies (nulls become rests). Returns a play record.
  play(freqs, opts = {}) {
    if (this.muted) return null;
    const ctx = this._ensure();
    if (!ctx) return null;
    const interval = opts.interval ?? 0.08;
    const dur = opts.dur ?? 0.12;
    const wave = opts.wave ?? "square";
    const gain = opts.gain ?? this.volume;
    const t0 = ctx.currentTime + 0.01;
    let notes = 0;
    freqs.forEach((f, i) => {
      if (!f) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = wave;
      osc.frequency.value = f;
      const t = t0 + i * interval;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      notes++;
    });
    return { notes, at: t0 };
  }
}

export const CUES_DEFS = CUES;

export class SoundTriggerSystem {
  constructor(opts = {}) {
    this.engine = opts.engine ?? new SynthAudio();
    this.enabled = opts.enabled ?? true;
    this.last = null;
  }

  cue(event) {
    const c = CUES[event];
    return c ? { ...c } : null;
  }

  cueNames() {
    return Object.keys(CUES);
  }

  // Fire a sound cue for a combat/game event.
  trigger(event, opts = {}) {
    const cue = CUES[event];
    if (!cue) return { ok: false, error: "unknown cue", event };
    if (!this.enabled) return { ok: true, event, played: false, muted: true };
    const record = this.engine.play(cue.freqs, { ...cue, ...opts });
    this.last = { event, at: Date.now(), played: record !== null };
    return { ok: true, event, played: record !== null };
  }

  setEnabled(on) {
    this.enabled = !!on;
    return this;
  }

  // Call on a user gesture so the WebAudio context can start.
  unlock() {
    if (this.engine && typeof this.engine.unlock === "function") this.engine.unlock();
    return this;
  }

  mute() {
    this.engine.setMuted(true);
    return this;
  }

  unmute() {
    this.engine.setMuted(false);
    return this;
  }

  setMuted(m) {
    this.engine.setMuted(!!m);
    return this;
  }

  setVolume(v) {
    this.engine.volume = Math.max(0, Math.min(1, v));
    return this;
  }

  get muted() {
    return this.engine.muted;
  }
}
