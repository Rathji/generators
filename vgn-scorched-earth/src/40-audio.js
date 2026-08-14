// 40-audio.js — WebAudio sound effects (all synthesized, no files)
(function () {
  "use strict";

  const SE = window.SE;
  let ac = null, master = null;

  function ctx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.32;
      master.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }

  function tone(freq, dur, o) {
    o = o || {};
    if (!SE.audioOn) return;
    const c = ctx();
    if (!c) return;
    const t0 = c.currentTime + (o.when || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
    g.gain.setValueAtTime(o.vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, o) {
    o = o || {};
    if (!SE.audioOn) return;
    const c = ctx();
    if (!c) return;
    const t0 = c.currentTime + (o.when || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = o.type || "lowpass";
    filt.frequency.setValueAtTime(o.fFrom || 2000, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(10, o.fTo || 200), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol || 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start(t0);
  }

  SE.audio = {
    play(name, opt) {
      opt = opt || {};
      if (name === "fire") {
        noise(0.18, { vol: 0.35, fFrom: 900, fTo: 120 });
        tone(260, 0.15, { type: "triangle", vol: 0.22, to: 60 });
      } else if (name === "explode") {
        const big = Math.min(1, (opt.size || 26) / 70);
        noise(0.3 + big * 0.55, { vol: 0.5, fFrom: 500 + big * 900, fTo: 40 });
        tone(120, 0.3 + big * 0.4, { type: "sawtooth", vol: 0.18, to: 40 });
      } else if (name === "click") {
        tone(600, 0.05, { vol: 0.12 });
      } else if (name === "switch") {
        tone(420, 0.06, { vol: 0.16 });
        tone(660, 0.08, { vol: 0.16, when: 0.06 });
      } else if (name === "kill") {
        noise(0.5, { vol: 0.5, fFrom: 600, fTo: 40 });
        tone(300, 0.5, { type: "sawtooth", vol: 0.28, to: 30 });
      } else if (name === "hurt") {
        tone(200, 0.15, { type: "sawtooth", vol: 0.22, to: 90 });
      } else if (name === "win") {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { vol: 0.2, when: i * 0.14 }));
      }
    },
  };
})();
