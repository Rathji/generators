// Task #222: Chiptune music engine — a tiny lookahead note scheduler over
// WebAudio that plays tracker-style songs (Task #221's data) with four
// voices: two square pulses, a triangle lead, and a noise kit. No audio
// files needed; everything is synthesized. The engine is deliberately
// context-agnostic: tests inject a fake AudioContext and observe the
// `events` log instead of hearing anything.

export const VOICE_ORDER = ["pulse1", "pulse2", "tri", "noise"];

export const VOICE_SPECS = {
  pulse1: { wave: "square", gain: 0.16 },
  pulse2: { wave: "square", gain: 0.12 },
  tri: { wave: "triangle", gain: 0.2 },
  noise: { drums: true, gain: 0.24 },
};

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-Ga-g])([#b]?)([2-6])$/;
const DRUMS = { K: "kick", S: "snare", H: "hat", C: "crash" };
const TOKEN_RE = /^(?:(?:[A-Ga-g][#b]?[2-6])|r|K|S|H|C)(?:\*\d+)?$/;
const SUSTAIN = "=";

// Convert a note token like "C4" / "G#3" / "Ab2" to a MIDI number.
export function noteToMidi(tok) {
  const m = NOTE_RE.exec(tok);
  if (!m) return null;
  const semis = SEMITONE[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + semis;
}

export function noteToFreq(tok) {
  const midi = noteToMidi(tok);
  return midi === null ? null : 440 * Math.pow(2, (midi - 69) / 12);
}

export function parseSong(def) {
  if (!def || typeof def !== "object") throw new Error("song must be an object");
  const rowsPerBar = def.rowsPerBar ?? 16;
  if (!(rowsPerBar >= 4 && rowsPerBar <= 32)) throw new Error("rowsPerBar must be 4..32");
  const tempo = def.tempo ?? 100;
  if (!(tempo >= 40 && tempo <= 220)) throw new Error("tempo must be 40..220");

  // Expand each voice into one entry per row. A note "C4*4" becomes
  // [C4*4, =, =, =] (first row holds the note, the rest sustain it); rests
  // and drums repeat across their duration. All voices must land on the
  // same total row count so the scheduler stays aligned across voices.
  const expanded = {};
  let totalRows = null;
  for (const voice of VOICE_ORDER) {
    const raw = def.voices?.[voice];
    const toks =
      raw == null
        ? []
        : String(raw)
            .replace(/[|\n\t]/g, " ")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    const out = [];
    if (toks.length) {
      for (let i = 0; i < toks.length; i++) {
        if (!TOKEN_RE.test(toks[i])) throw new Error(`voice "${voice}" row ${i + 1}: bad token "${toks[i]}"`);
      }
      for (const tok of toks) {
        const star = tok.indexOf("*");
        const body = star === -1 ? tok : tok.slice(0, star);
        const n = star === -1 ? 1 : parseInt(tok.slice(star + 1), 10);
        if (body === "r" || DRUMS[body]) {
          for (let k = 0; k < n; k++) out.push(body);
        } else {
          out.push(tok);
          for (let k = 1; k < n; k++) out.push(SUSTAIN);
        }
      }
    }
    if (out.length) {
      if (totalRows === null) {
        totalRows = out.length;
      } else if (out.length !== totalRows) {
        throw new Error(`voice "${voice}" has ${out.length} rows; expected ${totalRows}`);
      }
    }
    expanded[voice] = out;
  }
  if (!totalRows) throw new Error("song has no rows");
  const rows = {};
  for (const voice of VOICE_ORDER) {
    rows[voice] = expanded[voice].length === totalRows ? expanded[voice] : new Array(totalRows).fill("r");
  }

  const loopFrom = def.loopFrom ?? 0;
  const loopTo = def.loopTo ?? totalRows;
  if (!Number.isInteger(loopFrom) || loopFrom < 0 || loopFrom >= totalRows) throw new Error("loopFrom out of range");
  if (!Number.isInteger(loopTo) || loopTo <= loopFrom || loopTo > totalRows) throw new Error("loopTo out of range");
  const volume = def.volume ?? 1;
  if (!(volume > 0 && volume <= 1.2)) throw new Error("volume must be in (0, 1.2]");

  return {
    id: def.id ?? null,
    name: def.name ?? "Unknown",
    tempo,
    rowsPerBar,
    loopFrom,
    loopTo,
    loop: def.loop !== false,
    volume,
    rows,
    totalRows,
  };
}

export function rowDuration(def) {
  return 60 / def.tempo / def.rowsPerBar;
}

// WebAudio chiptune scheduler. Safe to construct anywhere; audio starts on
// the first unlock() (a user gesture), per browser autoplay rules.
export class ChipTune {
  constructor(opts = {}) {
    this.volume = opts.volume ?? 0.22;
    // Audio is off by default — the master gain starts at zero until the
    // player explicitly turns audio on (setMuted(false)).
    this.muted = opts.startMuted ?? true;
    this.songs = new Map();
    this.active = null;
    this.onEnd = opts.onEnd ?? null;
    this.scheduleAhead = opts.scheduleAhead ?? 0.12;
    this.tickMs = opts.tickMs ?? 30;
    this._ctx = opts.ctx ?? null;
    this._master = null;
    this._timer = null;
    this._noiseBuf = null;
    this._curRow = 0;
    this.events = [];
  }

  register(id, def) {
    if (!id || typeof id !== "string") throw new Error("song id must be a string");
    const parsed = parseSong({ ...def, id });
    this.songs.set(id, parsed);
    return this;
  }

  registerMany(defs) {
    for (const [id, def] of Object.entries(defs)) this.register(id, def);
    return this;
  }

  has(id) {
    return this.songs.has(id);
  }

  songDef(id) {
    return this.songs.get(id) ?? null;
  }

  get songId() {
    return this.active?.id ?? null;
  }

  get playing() {
    return !!this.active;
  }

  get currentRow() {
    return this.active?.row ?? 0;
  }

  _ensureCtx() {
    if (this._ctx) return this._ctx;
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    this._ctx = new AC();
    this._master = this._ctx.createGain();
    this._master.gain.value = this.muted ? 0 : this.volume;
    this._master.connect(this._ctx.destination);
    return this._ctx;
  }

  // Call on the first user gesture so the AudioContext can start.
  unlock() {
    const ctx = this._ensureCtx();
    if (ctx && ctx.state === "suspended" && typeof ctx.resume === "function") {
      ctx.resume().catch(() => {});
    }
    if (this.active && ctx) {
      this.active.nextTime = ctx.currentTime + 0.02;
      this._startTimer();
      this._step();
    }
    return ctx !== null;
  }

  play(id, opts = {}) {
    const parsed = this.songs.get(id);
    if (!parsed) return { ok: false, error: "unknown song", id };
    if (this.active?.id === id && !opts.restart) return { ok: true, changed: false };
    const ctx = this._ensureCtx();
    this._stopTimer();
    this.active = {
      id,
      parsed,
      row: opts.from ?? 0,
      nextTime: ctx ? ctx.currentTime + 0.02 : 0,
    };
    this.events.push({ kind: "song", id, at: ctx ? +ctx.currentTime.toFixed(3) : 0 });
    if (ctx) {
      this._startTimer();
      this._step();
    }
    return { ok: true, changed: true };
  }

  stop() {
    this._stopTimer();
    this.active = null;
    return this;
  }

  pause() {
    this._stopTimer();
    return this;
  }

  resume() {
    const ctx = this._ensureCtx();
    if (!this.active || !ctx) return this;
    this.active.nextTime = ctx.currentTime + 0.02;
    this._startTimer();
    this._step();
    return this;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this._master && !this.muted) this._master.gain.value = this.volume;
    return this;
  }

  setMuted(m) {
    this.muted = !!m;
    if (this._master) this._master.gain.value = m ? 0 : this.volume;
    return this;
  }

  _startTimer() {
    if (this._timer !== null) return;
    this._timer = setInterval(() => this._step(), this.tickMs);
  }

  _stopTimer() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _step() {
    const a = this.active;
    const ctx = this._ctx;
    if (!a || !ctx) return;
    const parsed = a.parsed;
    const dur = rowDuration(parsed);
    const horizon = ctx.currentTime + this.scheduleAhead;
    let guard = 0;
    while (a.nextTime < horizon) {
      this._curRow = a.row;
      this._scheduleRow(a, a.row, a.nextTime);
      a.row++;
      a.nextTime += dur;
      if (a.row >= parsed.loopTo) {
        if (parsed.loop) {
          a.row = parsed.loopFrom;
        } else {
          const endedId = a.id;
          this._stopTimer();
          this.active = null;
          if (typeof this.onEnd === "function") this.onEnd(endedId);
          return;
        }
      }
      if (++guard > 20000) break;
    }
  }

  _scheduleRow(a, row, t) {
    const parsed = a.parsed;
    const songVol = parsed.volume;
    for (const voice of VOICE_ORDER) {
      const tok = parsed.rows[voice][row];
      if (tok === "r" || tok === SUSTAIN || !tok) continue;
      if (DRUMS[tok]) {
        this._scheduleDrum(tok, t, songVol);
      } else {
        const freq = noteToFreq(tok);
        if (freq === null) continue;
        const len = parseInt(tok.split("*")[1] ?? "1", 10) || 1;
        this._scheduleNote(voice, freq, t, len, songVol);
      }
    }
  }

  _scheduleNote(voiceName, freq, t, lenRows, songVol) {
    const spec = VOICE_SPECS[voiceName];
    const dur = rowDuration(this.active.parsed) * lenRows;
    const gain = this.volume * songVol * spec.gain * (this.muted ? 0 : 1);
    this.events.push({
      kind: "note",
      row: this._curRow,
      voice: voiceName,
      freq: Math.round(freq * 100) / 100,
      dur: Math.round(dur * 1000) / 1000,
      t: Math.round(t * 1000) / 1000,
    });
    const ctx = this._ctx;
    if (!ctx || typeof ctx.createOscillator !== "function") return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = spec.wave;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this._master ?? ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  _scheduleDrum(tok, t, songVol) {
    const kind = DRUMS[tok];
    const spec = VOICE_SPECS.noise;
    const gain = this.volume * songVol * spec.gain * (this.muted ? 0 : 1);
    const dur = kind === "snare" ? 0.14 : kind === "hat" ? 0.05 : kind === "crash" ? 0.3 : 0.11;
    this.events.push({
      kind: "drum",
      row: this._curRow,
      voice: "noise",
      drum: kind,
      dur,
      t: Math.round(t * 1000) / 1000,
    });
    const ctx = this._ctx;
    if (!ctx || typeof ctx.createOscillator !== "function") return;
    if (kind === "kick") {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(46, t + 0.09);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(g);
      g.connect(this._master ?? ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer(ctx);
      const f = ctx.createBiquadFilter();
      if (kind === "snare") {
        f.type = "bandpass";
        f.frequency.value = 1800;
        f.Q.value = 0.9;
      } else if (kind === "hat") {
        f.type = "highpass";
        f.frequency.value = 6500;
      } else {
        f.type = "highpass";
        f.frequency.value = 4000;
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this._master ?? ctx.destination);
      src.start(t);
      src.stop(t + dur + 0.02);
    }
  }

  _noiseBuffer(ctx) {
    if (this._noiseBuf) return this._noiseBuf;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  }
}
