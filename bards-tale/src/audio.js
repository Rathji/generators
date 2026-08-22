// A Bard's Tale — audio manager: procedural WebAudio sound effects plus
// streamed background music (uploaded MP3s). The AudioContext is created
// lazily on the first user gesture so browsers never block it.

let ctx = null;
let master = null;
let muted = false;
let musicEl = null;
let musicName = null;
const TRACKS = {};

export function ensureAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);
  return ctx;
}

function tone(type, freq0, freq1, dur, vol, delay) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + (delay || 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq0, t0);
  if (freq1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.06);
}

function noise(dur, vol, filterFreq, delay) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + (delay || 0);
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
}

// Every game event's sound, synthesized on the fly — no asset downloads.
export const sfx = {
  step() { noise(0.07, 0.055, 420); },
  turn() { noise(0.05, 0.035, 280); },
  hit() { tone("square", 165, 70, 0.12, 0.22); noise(0.09, 0.18, 900); },
  miss() { tone("triangle", 520, 300, 0.08, 0.09); },
  spell() { tone("sine", 300, 920, 0.24, 0.16); tone("sine", 460, 1400, 0.3, 0.11, 0.05); },
  heal() { tone("sine", 523, 784, 0.3, 0.15); tone("sine", 659, 988, 0.36, 0.11, 0.1); },
  coin() { tone("square", 880, 880, 0.06, 0.13); tone("square", 1318, 1318, 0.12, 0.13, 0.07); },
  chest() { tone("sine", 330, 620, 0.16, 0.13); tone("sine", 620, 940, 0.18, 0.1, 0.09); },
  door() { tone("triangle", 130, 85, 0.18, 0.18); noise(0.12, 0.1, 480); },
  lock() { tone("square", 220, 170, 0.1, 0.15); tone("square", 160, 110, 0.16, 0.15, 0.12); },
  trap() { tone("sawtooth", 420, 85, 0.25, 0.18); noise(0.2, 0.16, 700); },
  pit() { tone("sawtooth", 320, 55, 0.3, 0.2); noise(0.25, 0.18, 600); },
  dark() { tone("sine", 220, 130, 0.5, 0.08); },
  valve() { tone("square", 700, 350, 0.12, 0.12); tone("square", 350, 150, 0.15, 0.12, 0.12); },
  descend() { tone("sine", 160, 60, 0.7, 0.18); tone("sine", 240, 90, 0.8, 0.1, 0.15); },
  levelup() { [523, 659, 784, 1046].forEach((f, i) => tone("square", f, f, 0.12, 0.13, i * 0.09)); },
  click() { tone("square", 720, 520, 0.05, 0.07); },
  flee() { tone("sawtooth", 300, 55, 0.22, 0.12); },
  rest() { tone("sine", 392, 392, 0.25, 0.1); tone("sine", 494, 494, 0.28, 0.1, 0.12); },
  fight() { tone("sawtooth", 210, 320, 0.16, 0.14); tone("square", 150, 85, 0.22, 0.15, 0.09); noise(0.14, 0.1, 520); },
  boss() { tone("sawtooth", 82, 48, 0.6, 0.2); tone("square", 62, 40, 0.7, 0.16, 0.1); noise(0.5, 0.12, 260); },
  victory() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone("triangle", f, f, 0.34, 0.16, i * 0.13)); },
  buy() { tone("square", 660, 660, 0.07, 0.11); tone("square", 990, 990, 0.1, 0.11, 0.07); },
};

// ── Background music ────────────────────────────────────────────
export function setTrack(name, url) { TRACKS[name] = url; }

export function playMusic(name) {
  if (musicName === name && musicEl && !musicEl.paused) return;
  if (musicEl) { musicEl.pause(); musicEl = null; }
  const url = TRACKS[name];
  if (!url) { musicName = null; return; }
  musicName = name;
  const a = new Audio(url);
  a.loop = true;
  a.volume = muted ? 0 : 0.5;
  a.addEventListener("error", () => { musicName = null; musicEl = null; });
  musicEl = a;
  a.play().catch(() => { /* autoplay blocked — retry on next gesture */ });
}

export function stopMusic() {
  if (musicEl) { musicEl.pause(); musicEl = null; }
  musicName = null;
}

export function currentMusic() { return musicName; }

export function setMuted(m) {
  muted = !!m;
  if (master) master.gain.value = muted ? 0 : 1;
  if (musicEl) musicEl.volume = muted ? 0 : 0.5;
}

export function isMuted() { return muted; }
export function toggleMute() { setMuted(!muted); return muted; }
