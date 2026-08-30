// Webuntu OS — UI sounds (Phase 5, Task 27; sound themes added in Task 63)
// Subtle optional UI feedback, synthesized entirely with WebAudio — no audio
// assets. Sound names: open, close, error, startup (chime), notify (blip used
// as the Settings preview) and ok. Sounds are off by default
// (webuntu.settings.uiSounds) and gated behind the browser autoplay policy:
// the AudioContext is only ever created/resumed on the first user gesture, and
// a sound requested before any gesture (e.g. the boot chime) is queued and
// released on that interaction. Output level scales with
// webuntu.settings.volume (default 70).
//
// Sound themes (Task 63): each theme remaps every recipe, selected via
// webuntu.settings.soundTheme ("default" | "retro" | "ocean" | "mechanical" |
// "muted"). Sounds.preview(themeId) plays a three-note preview of a theme
// regardless of the uiSounds toggle (so you can audition themes before enabling
// sound), still gated on the first user gesture.

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";

  let ctx = null;
  let interacted = false;
  let enabled = false;
  let volume = 70;
  let currentTheme = "default";

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function refreshSettings() {
    const s = loadSettings();
    enabled = !!s.uiSounds;
    const v = Math.round(Number(s.volume));
    volume = (v >= 0 && v <= 100) ? v : 70;
    currentTheme = Object.prototype.hasOwnProperty.call(THEMES, s.soundTheme) ? s.soundTheme : "default";
  }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // Master level: everything scales with the OS volume slider.
  function masterGain() { return (volume / 100) * 0.6; }

  // One oscillator + click-free gain envelope (fast attack, exp decay).
  function tone(opts) {
    const ac = ctx;
    if (!ac) return;
    const type = opts.type || "sine";
    const from = opts.from;
    const to = opts.to;
    const dur = opts.dur || 0.15;
    const delay = opts.delay || 0;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    if (from !== undefined) {
      osc.frequency.setValueAtTime(from, t);
      if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    } else if (to !== undefined) {
      osc.frequency.setValueAtTime(to, t);
    }
    const peak = (opts.vol !== undefined ? opts.vol : 0.5) * masterGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Each theme remaps every recipe (Task 63). `default` preserves the original
  // Task-27 sounds and adds an `ok` blip (used by the Welcome screen).
  const THEMES = {
    // Soft, modern Webuntu blips.
    default: {
      open:   () => tone({ from: 330, to: 660, dur: 0.09, vol: 0.16 }),
      close:  () => tone({ from: 660, to: 330, dur: 0.09, vol: 0.14 }),
      error:  () => {
        tone({ type: "square", from: 185, to: 150, dur: 0.16, vol: 0.08 });
        tone({ type: "square", from: 150, to: 125, dur: 0.18, vol: 0.07, delay: 0.13 });
      },
      startup: () => {
        tone({ from: 523.25, to: 523.25, dur: 0.3,  vol: 0.14 });
        tone({ from: 659.25, to: 659.25, dur: 0.3,  vol: 0.14, delay: 0.13 });
        tone({ from: 783.99, to: 783.99, dur: 0.3,  vol: 0.14, delay: 0.26 });
        tone({ from: 1046.5, to: 1046.5, dur: 0.55, vol: 0.16, delay: 0.39 });
      },
      notify: () => tone({ from: 880, to: 1320, dur: 0.12, vol: 0.18 }),
      ok:     () => tone({ from: 660, to: 880,  dur: 0.12, vol: 0.14 }),
    },
    // Crisp 8-bit square-wave bleeps.
    retro: {
      open:   () => tone({ type: "square", from: 392, to: 784, dur: 0.07, vol: 0.1 }),
      close:  () => tone({ type: "square", from: 784, to: 392, dur: 0.07, vol: 0.09 }),
      error:  () => {
        tone({ type: "square", from: 160, to: 120, dur: 0.09, vol: 0.07 });
        tone({ type: "square", from: 120, to: 90,  dur: 0.12, vol: 0.06, delay: 0.09 });
      },
      startup: () => {
        tone({ type: "square", from: 660,    to: 660,    dur: 0.09, vol: 0.09 });
        tone({ type: "square", from: 783.99, to: 783.99, dur: 0.09, vol: 0.09, delay: 0.09 });
        tone({ type: "square", from: 1046.5, to: 1046.5, dur: 0.09, vol: 0.09, delay: 0.18 });
        tone({ type: "square", from: 1318.5, to: 1318.5, dur: 0.18, vol: 0.1,  delay: 0.27 });
      },
      notify: () => tone({ type: "square", from: 1046.5, to: 1046.5, dur: 0.06, vol: 0.1 }),
      ok:     () => tone({ type: "square", from: 784,    to: 1046.5, dur: 0.07, vol: 0.09 }),
    },
    // Slow, gentle low sines — easy on the ears.
    ocean: {
      open:   () => tone({ from: 220, to: 330, dur: 0.28, vol: 0.15 }),
      close:  () => tone({ from: 330, to: 220, dur: 0.28, vol: 0.13 }),
      error:  () => tone({ type: "triangle", from: 150, to: 110, dur: 0.3, vol: 0.08 }),
      startup: () => {
        tone({ from: 261.63, to: 261.63, dur: 0.5,  vol: 0.11 });
        tone({ from: 329.63, to: 329.63, dur: 0.5,  vol: 0.11, delay: 0.1 });
        tone({ from: 392,    to: 392,    dur: 0.7,  vol: 0.12, delay: 0.2 });
        tone({ from: 523.25, to: 523.25, dur: 0.9,  vol: 0.1,  delay: 0.35 });
      },
      notify: () => tone({ from: 660, to: 880, dur: 0.2, vol: 0.15 }),
      ok:     () => tone({ from: 440, to: 550, dur: 0.18, vol: 0.13 }),
    },
    // Sharp clicky ticks — like a synth workstation.
    mechanical: {
      open:   () => tone({ type: "sawtooth", from: 1400, to: 700, dur: 0.035, vol: 0.07 }),
      close:  () => tone({ type: "sawtooth", from: 500,  to: 900, dur: 0.035, vol: 0.06 }),
      error:  () => {
        tone({ type: "square", from: 220, to: 170, dur: 0.05, vol: 0.07 });
        tone({ type: "square", from: 170, to: 130, dur: 0.06, vol: 0.06, delay: 0.06 });
      },
      startup: () => {
        tone({ type: "sawtooth", from: 900,  to: 900,  dur: 0.03, vol: 0.07 });
        tone({ type: "sawtooth", from: 1100, to: 1100, dur: 0.03, vol: 0.07, delay: 0.06 });
        tone({ type: "sawtooth", from: 1400, to: 1400, dur: 0.03, vol: 0.07, delay: 0.12 });
      },
      notify: () => tone({ type: "square", from: 1600, to: 1900, dur: 0.04, vol: 0.08 }),
      ok:     () => tone({ type: "square", from: 1200, to: 1200, dur: 0.04, vol: 0.06 }),
    },
    // Barely-there whispers for near-silent use.
    muted: {
      open:   () => tone({ from: 330, to: 440, dur: 0.08, vol: 0.03 }),
      close:  () => tone({ from: 440, to: 330, dur: 0.08, vol: 0.03 }),
      error:  () => tone({ from: 200, to: 170, dur: 0.1,  vol: 0.025 }),
      startup: () => {
        tone({ from: 523.25, to: 523.25, dur: 0.2,  vol: 0.025 });
        tone({ from: 659.25, to: 659.25, dur: 0.2,  vol: 0.025, delay: 0.12 });
        tone({ from: 783.99, to: 783.99, dur: 0.25, vol: 0.03,  delay: 0.24 });
      },
      notify: () => tone({ from: 880, to: 880, dur: 0.08, vol: 0.03 }),
      ok:     () => tone({ from: 660, to: 660, dur: 0.07, vol: 0.025 }),
    },
  };

  // Chip metadata for the Settings picker (Task 63).
  const THEME_META = {
    default:    { name: "Rathji",      desc: "The Webuntu default — soft, modern blips." },
    retro:      { name: "Retro",       desc: "Crisp 8-bit square-wave bleeps." },
    ocean:      { name: "Ocean",       desc: "Slow, gentle low sines — easy on the ears." },
    mechanical: { name: "Mechanical",  desc: "Sharp clicky ticks — like a synth workstation." },
    muted:      { name: "Muted",       desc: "Barely-there whispers for near-silent use." },
  };

  const queue = [];
  function flushQueue() {
    refreshSettings();
    if (!enabled || !ensureCtx()) { queue.length = 0; return; }
    const pending = queue.slice();
    queue.length = 0;
    for (const name of pending) {
      const fn = recipe(name);
      if (fn) fn();
    }
  }

  // Resolve a recipe through the active theme, falling back to `default`.
  function recipe(name) {
    return (THEMES[currentTheme] && THEMES[currentTheme][name]) ||
           (THEMES.default && THEMES.default[name]);
  }

  // First user gesture: mark interaction, create the context, and release any
  // queued sound (e.g. the startup chime queued at boot).
  function onFirstInteraction() {
    interacted = true;
    ensureCtx();
    flushQueue();
  }
  window.addEventListener("pointerdown", onFirstInteraction, { once: true });
  window.addEventListener("keydown", onFirstInteraction, { once: true });

  window.Sounds = {
    // Gated UI sound: only when the toggle is on AND after a user gesture.
    play(name) {
      refreshSettings();
      if (!enabled) return;
      if (!interacted) { queue.push(name); return; }
      if (!ensureCtx()) return;
      const fn = recipe(name);
      if (fn) fn();
    },
    // Un-gated volume feedback (the tray slider): always sounds once the user
    // has interacted, scaled to the chosen volume — independent of uiSounds.
    blip(freqA, freqB, dur, vol) {
      refreshSettings();
      if (!interacted) return;
      if (!ensureCtx()) return;
      tone({ from: freqA, to: freqB, dur: dur || 0.1, vol: (vol !== undefined ? vol : 0.5) });
    },
    // Three-note audition of a theme (Task 63) — ignores the uiSounds toggle so
    // a theme can be previewed before enabling sound, but still needs a gesture.
    preview(themeId) {
      refreshSettings();
      if (!interacted) return;
      if (!ensureCtx()) return;
      const t = THEMES[themeId] || THEMES.default;
      if (t.notify) t.notify();
      if (t.open) t.open();
      if (t.ok) t.ok();
    },
    // Chip metadata for the Settings picker: [{id, name, desc}, ...].
    get themes() { return Object.keys(THEMES).map(id => ({ id, ...THEME_META[id] })); },
    get theme() { return currentTheme; },
    get enabled() { return enabled; },
    get contextReady() { return !!ctx; },
  };

  refreshSettings();
})();
