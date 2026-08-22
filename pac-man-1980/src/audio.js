// src/audio.js — WebAudio SFX synth (Phase 6, tasks 26-27).
// Every sound is synthesized (no assets). The AudioContext is created lazily
// on the first user gesture (autoplay policy), the master gain doubles as the
// mute toggle, and the context is suspended while the tab is hidden or the
// game is paused. Set muted via setMuted() / the constructor option; the
// engine persists that flag itself.

export class GameAudio {
  constructor({ muted = false } = {}) {
    this.muted = muted;
    this.ctx = null;
    this.master = null;
    this.droneNodes = null;
    this._onVis = () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.stopDrone();
        if (this.ctx.state === "running") this.ctx.suspend().catch(() => {});
      } else if (this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", this._onVis);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.01);
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  _tone({ freq = 440, dur = 0.1, type = "square", vol = 0.3, delay = 0, slideTo = null }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (slideTo != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  waka(high) {
    this._tone({ freq: high ? 235 : 175, dur: 0.08, type: "square", vol: 0.2 });
  }

  powerDrone(on) {
    if (!this.ctx) return;
    if (!on) { this.stopDrone(); return; }
    this.stopDrone();
    if (this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(155, ctx.currentTime);
    lfo.type = "triangle";
    lfo.frequency.setValueAtTime(2.5, ctx.currentTime);
    depth.gain.setValueAtTime(42, ctx.currentTime);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 0.06);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    lfo.start();
    this.droneNodes = { osc, lfo, g };
  }

  stopDrone() {
    if (!this.droneNodes) return;
    const { osc, lfo, g } = this.droneNodes;
    this.droneNodes = null;
    if (this.ctx) g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
    const stopAt = this.ctx ? this.ctx.currentTime + 0.35 : 0;
    osc.stop(stopAt);
    lfo.stop(stopAt);
  }

  eatGhost() {
    this._tone({ freq: 720, slideTo: 160, dur: 0.26, type: "sawtooth", vol: 0.32 });
    this._tone({ freq: 1300, slideTo: 320, dur: 0.18, type: "square", vol: 0.16, delay: 0.02 });
  }

  fruit() {
    [660, 880, 1100].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.07, type: "square", vol: 0.26, delay: i * 0.06 }));
  }

  extraLife() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.1, type: "square", vol: 0.26, delay: i * 0.09 }));
  }

  death() {
    [523, 466, 392, 330, 262, 196].forEach((f, i) =>
      this._tone({ freq: f, slideTo: f * 0.85, dur: 0.14, type: "sawtooth", vol: 0.3, delay: i * 0.11 }));
  }

  levelStart() {
    [392, 523, 659, 784].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.1, type: "square", vol: 0.28, delay: i * 0.08 }));
  }
}
