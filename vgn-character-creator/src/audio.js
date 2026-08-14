// ============================================================================
//  src/audio.js — tiny WebAudio chiptune engine for the VGN shell
//  ----------------------------------------------------------------------------
//  Two layers:
//    1. Named one-shot SFX  — audio.sfx('coin'), audio.sfx('gameover'), ...
//    2. A looping music step-sequencer (bass + lead arpeggio + kick + hats)
//       that starts automatically when a run begins and ducks on pause.
//  Browser autoplay rules: sound is blocked until the first user gesture, so
//  the shell calls audio.unlock() from the START button / keypress. Every
//  other method is guarded by `this.ready` and is safe to call any time.
//  To add a sound: append a definition to SFX below, e.g.
//      laser: { type: 'square', vol: 0.1, notes: [{ f: 880, d: 0.06 }] }
//  then call ctx.audio.sfx('laser') from your game.
//  ============================================================================

const MUSIC_TEMPO = 132;                       // quarter notes per minute
const STEP_DUR = 60 / MUSIC_TEMPO / 4;         // one sixteenth note
const PATTERN = 32;                            // 2 bars of 16 sixteenths

// Chord roots (Hz) per quarter note — Am, F, C, G | Am, F, G, E
const ROOTS = [55, 43.65, 32.7, 49, 55, 49, 58.27, 65.4];
const BASS = new Array(PATTERN).fill(0);
ROOTS.forEach((root, i) => {
  BASS[i * 4] = root;                          // root on the beat
  BASS[i * 4 + 2] = root * 1.5;                // fifth on the off-beat
});

// A-minor pentatonic arpeggio line (16 sixteenths, loops twice per pattern)
const ARP = [
  220, 329.63, 261.63, 392, 220, 329.63, 261.63, 440,
  220, 392, 329.63, 523.25, 220, 261.63, 329.63, 261.63,
];

// One-shot sound effects. Each note: { f: start freq (Hz), t: start offset,
// d: duration (s), f2: optional slide-to freq }.
const SFX = {
  start: { type: 'square', vol: 0.10, notes: [
    { f: 523.25, d: 0.08 }, { f: 659.25, t: 0.08, d: 0.08 },
    { f: 783.99, t: 0.16, d: 0.08 }, { f: 1046.5, t: 0.24, d: 0.16 } ] },
  select: { type: 'square', vol: 0.08, notes: [ { f: 880, d: 0.05 } ] },
  move: { type: 'square', vol: 0.05, notes: [ { f: 196, d: 0.035 } ] },
  jump: { type: 'square', vol: 0.09, notes: [
    { f: 262, d: 0.07, f2: 420 }, { f: 392, t: 0.06, d: 0.1, f2: 620 } ] },
  coin: { type: 'square', vol: 0.09, notes: [
    { f: 987.77, d: 0.05 }, { f: 1318.5, t: 0.05, d: 0.16 } ] },
  pause: { type: 'square', vol: 0.08, notes: [
    { f: 440, d: 0.05 }, { f: 220, t: 0.06, d: 0.09 } ] },
  gameover: { type: 'sawtooth', vol: 0.09, notes: [
    { f: 440, d: 0.2, f2: 300 }, { f: 330, t: 0.22, d: 0.2, f2: 210 },
    { f: 220, t: 0.44, d: 0.55, f2: 110 } ] },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;                 // AudioContext (created on first unlock)
    this.master = null;              // master gain → destination
    this.musicBus = null;            // gain for the music sequencer
    this.muted = false;
    this.musicOn = false;
    this._schedTimer = null;
    this._step = 0;
    this._nextStepTime = 0;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  // Create/resume the AudioContext. MUST be called from a user gesture
  // (click / keypress) — the shell does this when the player presses START.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  // Play a named one-shot effect, e.g. ctx.audio.sfx('coin').
  sfx(name) {
    if (!this.ready) return;
    const def = SFX[name];
    if (!def) return;
    const t0 = this.ctx.currentTime + 0.001;
    for (const n of def.notes) {
      this._tone(t0 + (n.t || 0), n.f, n.d, def.type, def.vol, n.f2);
    }
  }

  // One synthesized oscillator with a volume envelope and optional freq slide.
  _tone(t, f, dur, type, vol, slideTo) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f), t);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  // Start the looping music. Idempotent — calling while running is a no-op.
  startMusic() {
    this.unlock();
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this._step = 0;
    this._nextStepTime = this.ctx.currentTime + 0.08;
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.08);
    }
    this._schedTimer = setInterval(() => this._schedule(), 30);
  }

  stopMusic() {
    this.musicOn = false;
    if (this._schedTimer) {
      clearInterval(this._schedTimer);
      this._schedTimer = null;
    }
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
    }
  }

  // Adjust music loudness (0..0.5). The shell ducks it while paused.
  setMusicLevel(v) {
    if (this.musicBus) {
      this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
    }
  }

  // Look-ahead scheduler: keeps ~0.12 s of steps queued on the audio clock so
  // the loop never gaps, even if the browser throttles this JS timer.
  _schedule() {
    if (!this.musicOn || !this.ctx) return;
    while (this._nextStepTime < this.ctx.currentTime + 0.12) {
      this._playStep(this._step, this._nextStepTime);
      this._step = (this._step + 1) % PATTERN;
      this._nextStepTime += STEP_DUR;
    }
  }

  _playStep(step, t) {
    if (this.muted) return;
    if (step % 4 === 0) this._pulse(t, 80, 0.1, 'sine', 0.12, 40);      // kick
    if (step % 2 === 1) this._pulse(t, 6200, 0.02, 'square', 0.012);    // hat
    if (BASS[step]) {
      this._pulse(t, BASS[step], 0.16, 'sawtooth', 0.075, BASS[step] * 0.5);
    }
    if (step % 2 === 1) this._pulse(t, ARP[step % 16], 0.09, 'square', 0.03);
  }

  _pulse(t, f, dur, type, vol, slideTo) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f), t);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
