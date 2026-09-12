let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let unlocked = false;
let currentMusic = null;
let musicTimer = null;

const state = { master: 0.8, music: 0.5, sfx: 0.9, muted: false };

function ac() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = state.muted ? 0 : state.master;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = state.music;
  musicGain.connect(master);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = state.sfx;
  sfxGain.connect(master);
  return ctx;
}

function unlock() {
  const c = ac();
  if (!c) return;
  if (c.state === "suspended") c.resume();
  unlocked = true;
}

function env(node, t0, a, d, peak) {
  node.gain.cancelScheduledValues(t0);
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
  node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function tone(type, f0, f1, dur, vol, t0) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
  env(g, t0, Math.min(0.012, dur * 0.15), dur, vol);
  o.connect(g).connect(sfxGain);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur, vol, filterType, freq, q, t0) {
  const c = ac();
  if (!c) return;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const flt = c.createBiquadFilter();
  flt.type = filterType || "lowpass";
  flt.frequency.setValueAtTime(freq || 1200, t0);
  flt.frequency.exponentialRampToValueAtTime(Math.max((freq || 1200) * 0.2, 60), t0 + dur);
  flt.Q.value = q || 0.8;
  const g = c.createGain();
  env(g, t0, 0.008, dur, vol);
  src.connect(flt).connect(g).connect(sfxGain);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const SFX = {
  click: (t) => tone("square", 520, 680, 0.06, 0.14, t),
  hover: (t) => tone("sine", 700, 760, 0.03, 0.05, t),
  build: (t) => { tone("sawtooth", 180, 420, 0.16, 0.2, t); tone("square", 620, 880, 0.12, 0.1, t + 0.04); },
  sell: (t) => { tone("triangle", 700, 260, 0.22, 0.18, t); },
  upgrade: (t) => { tone("square", 440, 880, 0.14, 0.16, t); tone("square", 660, 1320, 0.16, 0.12, t + 0.08); },
  error: (t) => { tone("sawtooth", 200, 110, 0.2, 0.2, t); },
  laser: (t) => { tone("sawtooth", 1400, 380, 0.14, 0.12, t); tone("sine", 2400, 900, 0.09, 0.05, t); },
  blaster: (t) => { tone("square", 900, 300, 0.08, 0.08, t); },
  missile: (t) => { noise(0.28, 0.12, "bandpass", 900, 1.2, t); tone("sawtooth", 160, 90, 0.25, 0.08, t); },
  ion: (t) => { tone("sine", 300, 1500, 0.18, 0.1, t); tone("triangle", 1500, 400, 0.2, 0.07, t + 0.05); },
  explode: (t) => { noise(0.5, 0.34, "lowpass", 1500, 0.7, t); tone("sine", 120, 40, 0.4, 0.22, t); },
  hit: (t) => { noise(0.07, 0.1, "highpass", 1800, 0.8, t); },
  wave: (t) => { tone("sawtooth", 120, 300, 0.5, 0.16, t); tone("sawtooth", 180, 450, 0.5, 0.1, t + 0.02); },
  ability: (t) => { tone("sawtooth", 90, 500, 0.4, 0.22, t); noise(0.5, 0.22, "bandpass", 1400, 1.4, t); },
  nova: (t) => { tone("sine", 60, 900, 0.6, 0.24, t); noise(0.7, 0.2, "lowpass", 2400, 0.6, t); },
  win: (t) => { [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.35, 0.16, t + i * 0.13)); },
  lose: (t) => { [392, 349, 294, 220].forEach((f, i) => tone("sawtooth", f, f * 0.98, 0.5, 0.14, t + i * 0.18)); },
};

export function play(name) {
  if (state.muted) return;
  const c = ac();
  if (!c) return;
  if (c.state === "suspended") c.resume();
  const fn = SFX[name];
  if (fn) fn(c.currentTime + 0.001);
}

function stopMusic() {
  if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
  if (currentMusic) {
    currentMusic.forEach((n) => { try { n.stop(); } catch (e) {} });
    currentMusic = null;
  }
}

function pad(freq, dur, t0, vol, type, dest) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type || "sine";
  o.frequency.value = freq;
  o.detune.value = (Math.random() * 8 - 4);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.1);
  return o;
}

const SCALES = {
  menu: [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66],
  combat: [98, 116.54, 130.81, 155.56, 174.61, 196, 233.08, 261.63],
};

function scheduleMusic(mode) {
  const c = ac();
  if (!c) return;
  const scale = SCALES[mode] || SCALES.menu;
  const t = c.currentTime + 0.05;
  const chord = mode === "combat"
    ? [scale[0], scale[2], scale[4]]
    : [scale[0], scale[3], scale[5]];
  const nodes = [];
  chord.forEach((f, i) => nodes.push(pad(f, 4.6, t, mode === "combat" ? 0.05 : 0.045, i === 0 ? "sine" : "triangle", musicGain)));
  const steps = mode === "combat" ? 8 : 5;
  for (let i = 0; i < steps; i++) {
    if (Math.random() < (mode === "combat" ? 0.85 : 0.5)) {
      const f = scale[Math.floor(Math.random() * scale.length)];
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = mode === "combat" ? "sawtooth" : "sine";
      o.frequency.value = f * 2;
      const st = t + i * (mode === "combat" ? 0.55 : 0.9);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(mode === "combat" ? 0.035 : 0.03, st + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, st + (mode === "combat" ? 0.5 : 0.8));
      o.connect(g).connect(musicGain);
      o.start(st);
      o.stop(st + 1);
      nodes.push(o);
    }
  }
  currentMusic = nodes;
  musicTimer = setTimeout(() => scheduleMusic(mode), mode === "combat" ? 4200 : 4400);
}

export function music(mode) {
  if (state.muted || !unlocked) return;
  stopMusic();
  if (mode === "off") return;
  scheduleMusic(mode);
}

export function applySettings(s) {
  if (s.master != null) state.master = s.master;
  if (s.music != null) state.music = s.music;
  if (s.sfx != null) state.sfx = s.sfx;
  if (s.muted != null) state.muted = s.muted;
  if (master) master.gain.value = state.muted ? 0 : state.master;
  if (musicGain) musicGain.gain.value = state.music;
  if (sfxGain) sfxGain.gain.value = state.sfx;
  if (state.muted) stopMusic();
}

export function initAudio() {
  unlock();
  const c = ac();
  if (c && c.state === "suspended") c.resume();
  return unlocked;
}

export function isUnlocked() { return unlocked; }
