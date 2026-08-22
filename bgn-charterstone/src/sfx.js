// src/sfx.js — Phase 16 WebAudio-synthesized sound effects (Task 73).
// Pure WebAudio synthesis (no assets): placement, bump, coin gain,
// construction, crate unlock and game end, with a mute toggle. An
// AudioContext is only created lazily, and `unlock()` must be called from
// a user gesture so browsers allow audio to play.

export const SFX_VERSION = 1;

export function createSFX(opts = {}) {
  let ctx = null;
  let muted = false;
  let scheduled = 0; // oscillator count — the mute contract the test checks

  function ensure() {
    if (ctx) return ctx;
    const AC = (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)) || null;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function tone({ freq = 440, end = 880, dur = 0.15, type = "triangle", gain = 0.07, when = 0 } = {}) {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    scheduled++;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, end), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  const sfx = {
    version: SFX_VERSION,
    place() { tone({ freq: 520, end: 720, dur: 0.12 }); },
    bump() { tone({ freq: 260, end: 150, dur: 0.12, type: "square", gain: 0.05 }); },
    coin() { tone({ freq: 880, dur: 0.08, type: "sine" }); tone({ freq: 1318, dur: 0.14, when: 0.07, type: "sine" }); },
    construct() { tone({ freq: 392, dur: 0.1 }); tone({ freq: 523, when: 0.1 }); tone({ freq: 659, when: 0.2 }); tone({ freq: 784, when: 0.3, dur: 0.2 }); },
    crate() { tone({ freq: 220, dur: 0.14, type: "sawtooth", gain: 0.04 }); tone({ freq: 440, when: 0.14, dur: 0.2 }); },
    end() { tone({ freq: 523, dur: 0.15 }); tone({ freq: 659, when: 0.15 }); tone({ freq: 784, when: 0.3 }); tone({ freq: 1046, when: 0.45, dur: 0.4 }); },
    // must be called from a user gesture
    unlock() {
      const c = ensure();
      if (c && c.state === "suspended") { try { c.resume().catch(() => {}); } catch (e) {} }
      return true;
    },
    get muted() { return muted; },
    setMuted(m) { muted = !!m; return sfx; },
    get scheduled() { return scheduled; },
    _tone: tone,
  };
  return sfx;
}
