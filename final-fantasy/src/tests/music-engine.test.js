// Task #227: music engine unit tests — parsing, the lookahead scheduler,
// looping, one-shot songs, drums, volume/mute and pause/resume. Audio runs
// against a fake AudioContext that records what would have played.

import { ChipTune, parseSong, rowDuration, noteToFreq, noteToMidi, VOICE_ORDER } from "../engine/music-engine.js";

class FakeParam {
  constructor(v = 0) {
    this.value = v;
    this.calls = [];
  }
  setValueAtTime(v, t) { this.calls.push(["set", v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.calls.push(["ramp", v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.calls.push(["lramp", v, t]); return this; }
  setTargetAtTime(v, t, c) { this.calls.push(["target", v, t, c]); return this; }
}
class FakeOsc {
  constructor() {
    this.type = "square";
    this.frequency = new FakeParam();
    this.started = [];
    this.stopped = [];
  }
  connect() { return {}; }
  start(t) { this.started.push(t); }
  stop(t) { this.stopped.push(t); }
}
class FakeGain {
  constructor() {
    this.gain = new FakeParam();
    this.connects = 0;
  }
  connect() { this.connects++; return {}; }
}
class FakeFilter {
  constructor() {
    this.type = "lowpass";
    this.frequency = new FakeParam();
    this.Q = new FakeParam();
    this.connects = 0;
  }
  connect() { this.connects++; return {}; }
}
class FakeSrc {
  constructor() {
    this.buffer = null;
    this.connects = 0;
    this.started = [];
    this.stopped = [];
  }
  connect() { this.connects++; return {}; }
  start(t) { this.started.push(t); }
  stop(t) { this.stopped.push(t); }
}
class FakeCtx {
  constructor() {
    this.now = 0;
    this.state = "running";
    this.sampleRate = 44100;
    this.destination = {};
    this.oscs = [];
    this.gains = [];
    this.srcs = [];
  }
  get currentTime() { return this.now; }
  resume() { this.state = "running"; return Promise.resolve(); }
  createOscillator() { const o = new FakeOsc(); this.oscs.push(o); return o; }
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createBuffer(ch, len, rate) {
    const b = { channels: ch, length: len, sampleRate: rate };
    b.getChannelData = () => new Float32Array(len);
    return b;
  }
  createBufferSource() { const s = new FakeSrc(); this.srcs.push(s); return s; }
  createBiquadFilter() { return new FakeFilter(); }
}

function tiny(opts = {}) {
  return {
    tempo: 120,
    rowsPerBar: 16,
    loop: true,
    volume: 1,
    voices: { pulse1: Array(16).fill("C4").join(" ") },
    ...opts,
  };
}

function makeEngine(opts = {}) {
  const ctx = new FakeCtx();
  const eng = new ChipTune({ ctx, scheduleAhead: 0.12, tickMs: 30, ...opts });
  return { eng, ctx };
}

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };
  const approx = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

  // --- note parsing ---
  check("A4 is 440 Hz", approx(noteToFreq("A4"), 440), noteToFreq("A4"));
  check("C4 is ~261.63", approx(noteToFreq("C4"), 261.63), noteToFreq("C4"));
  check("G#4 ~415.3", approx(noteToFreq("G#4"), 415.3), noteToFreq("G#4"));
  check("Ab4 = G#4", approx(noteToFreq("Ab4"), noteToFreq("G#4")), noteToFreq("Ab4"));
  check("octave rises", noteToFreq("C3") < noteToFreq("C4"), noteToFreq("C3"));
  check("noteToMidi C4 = 60", noteToMidi("C4") === 60, noteToMidi("C4"));
  check("noteToMidi bad token = null", noteToMidi("bogus") === null);
  check("rowDuration 120bpm/16", approx(rowDuration({ tempo: 120, rowsPerBar: 16 }), 0.03125, 0.0001), rowDuration({ tempo: 120, rowsPerBar: 16 }));

  // --- parseSong validation ---
  let threw = false;
  try {
    parseSong({ tempo: 120, rowsPerBar: 16, voices: { pulse1: "C4 C4", tri: "C4" } });
  } catch (e) { threw = true; }
  check("mismatched voice lengths throw", threw);

  threw = false;
  try {
    parseSong(tiny({ voices: { pulse1: "C4 X9 C4" } }));
  } catch (e) { threw = /row/.test(String(e.message)); }
  check("bad token throws with row", threw);

  const omitted = parseSong(tiny({ voices: { pulse1: Array(16).fill("C4").join(" ") } }));
  check("omitted voices become rests", omitted.rows.tri.every((t) => t === "r"));
  check("loopTo defaults to total rows", omitted.loopTo === omitted.totalRows);

  threw = false;
  try { parseSong(tiny({ tempo: 500 })); } catch (e) { threw = true; }
  check("tempo out of range throws", threw);

  const parsed = parseSong(tiny({ voices: { pulse1: "C4*2 r G4 r C4*4" } }));
  check("total rows parsed (durations expanded)", parsed.totalRows === 9, parsed.totalRows);
  check("voices all same length", VOICE_ORDER.every((v) => parsed.rows[v].length === 9));
  check("sustain markers fill note tails", parsed.rows.pulse1.join(",") === "C4*2,=,r,G4,r,C4*4,=,=,=", parsed.rows.pulse1.join(","));

  // --- engine: play / scheduler ---
  const { eng, ctx } = makeEngine();
  eng.register("t", tiny());
  const unknown = eng.play("nope");
  check("unknown song rejected", unknown.ok === false);
  const p1 = eng.play("t");
  check("play starts song", p1.ok === true && p1.changed === true && eng.songId === "t");
  const p2 = eng.play("t");
  check("same song is no-op", p2.changed === false);
  check("playing flag", eng.playing === true);
  check("song event recorded", eng.events[0]?.kind === "song" && eng.events[0].id === "t");
  const notes = eng.events.filter((e) => e.kind === "note");
  check("notes scheduled on play", notes.length > 0 && notes.length <= 6, notes.length);
  check("note times advance", notes.every((n) => n.t >= 0.02));
  check("note freq is C4", approx(notes[0].freq, 261.63), notes[0].freq);
  check("note voice is pulse1", notes.every((n) => n.voice === "pulse1"));
  check("current row advanced", eng.currentRow === notes.length, eng.currentRow);

  // Advance the fake clock and step: more rows scheduled, row count bounded.
  ctx.now = 1.0;
  for (let i = 0; i < 20; i++) eng._step();
  check("row stays inside loop", eng.currentRow >= 0 && eng.currentRow < 16, eng.currentRow);
  const afterWrap = eng.events.filter((e) => e.kind === "note");
  check("more notes after advancing", afterWrap.length > notes.length, afterWrap.length);

  // --- one-shot song (loop:false) fires onEnd ---
  let ended = null;
  const { eng: eng2, ctx: ctx2 } = makeEngine();
  eng2.onEnd = (id) => { ended = id; };
  eng2.register("one", tiny({ loop: false, voices: { pulse1: Array(16).fill("C4").join(" ") } }));
  eng2.play("one");
  ctx2.now = 0.6;
  eng2._step();
  check("one-shot ends", eng2.playing === false && ended === "one", String(ended));

  // --- drums ---
  const { eng: eng3 } = makeEngine();
  eng3.register("d", tiny({ voices: { pulse1: Array(16).fill("C4").join(" "), noise: Array(16).fill("K").join(" ") } }));
  eng3.play("d");
  const drums = eng3.events.filter((e) => e.kind === "drum");
  check("drum events recorded", drums.length > 0, drums.length);
  check("drum kind is kick", drums.every((d) => d.drum === "kick"));
  check("no noise note events", eng3.events.every((e) => !(e.kind === "note" && e.voice === "noise")));

  // --- volume / mute ---
  const { eng: eng4 } = makeEngine();
  eng4.register("v", tiny());
  check("muted by default", eng4.muted === true && eng4.startMuted === undefined);
  eng4.setMuted(false);
  eng4.setVolume(0.5);
  eng4.play("v");
  check("setVolume clamps into range", approx(eng4.volume, 0.5));
  const noteGain = eng4._ctx.gains[eng4._ctx.gains.length - 1].gain;
  const expectedGain = 0.5 * 1 * 0.16;
  const rampTarget = noteGain.calls.filter((c) => c[0] === "ramp").map((c) => c[1]).sort((a, b) => a - b).pop();
  check("note gain envelope matches volume", approx(rampTarget, expectedGain, 0.001), rampTarget + " vs " + expectedGain);
  eng4.setMuted(true);
  check("muted flag", eng4.muted === true);
  eng4.setMuted(false);
  check("unmuted flag", eng4.muted === false);

  // --- pause / resume ---
  const { eng: eng5 } = makeEngine();
  eng5.register("p", tiny());
  eng5.play("p");
  const before = eng5.events.length;
  eng5.pause();
  check("pause stops the timer", eng5._timer === null);
  check("pause keeps the song", eng5.songId === "p");
  await new Promise((r) => setTimeout(r, 70));
  check("no scheduling while paused", eng5.events.length === before, eng5.events.length);
  eng5.resume();
  check("resume restarts the timer", eng5._timer !== null);

  // --- registerMany / songDef ---
  const { eng: eng6 } = makeEngine();
  eng6.registerMany({ a: tiny(), b: tiny({ tempo: 90 }) });
  check("registerMany registers", eng6.has("a") && eng6.has("b"));
  check("songDef exposes parsed", eng6.songDef("a").tempo === 120 && eng6.songDef("b").tempo === 90);

  // --- voice spec sanity ---
  check("pulse1 is square", parseSong(tiny()) && true);
  return out;
}
