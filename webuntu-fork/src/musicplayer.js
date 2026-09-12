// Webuntu OS — Music Player (Phase 6, Task 33)
// A windowed music player with a small built-in set of WebAudio-synthesized
// loops (no audio assets — a lookahead scheduler plays note patterns through
// oscillators). Features: play/pause/next/prev, a per-track volume slider, a
// playlist UI, and an "Add URL" option that adds a custom audio file (served
// via an <audio> element) to the playlist. Output level respects the global
// volume setting (webuntu.settings.volume) — i.e. it follows the OS sound
// level, so muting the volume in the tray silences the player too.
//
// Singleton app; closing the window stops playback.

(function () {
  "use strict";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const GLOBAL_SETTINGS_KEY = "webuntu.settings";

  function globalVolume() {
    try {
      const s = JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY) || "{}");
      const v = Math.round(Number(s.volume));
      return (v >= 0 && v <= 100) ? v / 100 : 0.7;
    } catch (e) { return 0.7; }
  }

  // ---------- note-pattern tracks ----------
  // makeTrack builds a {name, bpm, bars, voices, vol} from a chord progression:
  //   prog   — array of chords, each = array of midi notes (low→high)
  //   bass   — root note (chord[0] - 12) as half notes
  //   pad    — chord tones held for the whole bar (sustained)
  //   arp    — chord tones arpeggiated per beat
  //   lead   — optional melody notes {b, m, d, v} (bar, midi, beats, velocity)
  function makeTrack(opts) {
    const bars = opts.bars || 4;
    const voices = [];
    const prog = opts.prog;
    const beatDurs = opts.arp === 16 ? 0.5 : 1;

    if (opts.bass !== false) {
      const bass = { wave: opts.bassWave || "triangle", vol: opts.bassVol != null ? opts.bassVol : 0.14, notes: [] };
      for (let b = 0; b < bars; b++) {
        const root = prog[b % prog.length][0] - 12;
        bass.notes.push({ t: b * 4 + 0, d: 2, p: root, v: 1 });
        bass.notes.push({ t: b * 4 + 2, d: 2, p: root, v: 0.85 });
      }
      voices.push(bass);
    }

    if (opts.pad !== false) {
      const pad = { wave: opts.padWave || "triangle", vol: opts.padVol != null ? opts.padVol : 0.05, notes: [] };
      for (let b = 0; b < bars; b++) {
        const chord = prog[b % prog.length];
        for (const n of chord.slice(0, 3)) {
          pad.notes.push({ t: b * 4, d: 4, p: n, v: 1 });
        }
      }
      voices.push(pad);
    }

    if (opts.arp !== false) {
      const arp = { wave: opts.arpWave || "sine", vol: opts.arpVol != null ? opts.arpVol : 0.09, notes: [] };
      for (let b = 0; b < bars; b++) {
        const chord = prog[b % prog.length];
        const seq = opts.arpSeq || [0, 1, 2, 3];
        for (let i = 0; i < 4; i++) {
          arp.notes.push({ t: b * 4 + i, d: beatDurs, p: chord[seq[i % seq.length]], v: 1 });
        }
      }
      voices.push(arp);
    }

    if (opts.lead && opts.lead.length) {
      const lead = { wave: opts.leadWave || "sine", vol: opts.leadVol != null ? opts.leadVol : 0.1, notes: [] };
      for (const n of opts.lead) {
        lead.notes.push({ t: n.b * 4 + (n.t || 0), d: n.d || 1, p: n.m, v: n.v != null ? n.v : 1 });
      }
      voices.push(lead);
    }

    return { name: opts.name, bpm: opts.bpm, bars, vol: opts.vol != null ? opts.vol : 0.8, voices };
  }

  const Am = [45, 48, 52, 57];
  const F  = [41, 45, 48, 53];
  const C  = [36, 40, 43, 48];
  const G  = [43, 47, 50, 55];
  const Em = [40, 43, 47, 52];
  const Dm = [38, 41, 45, 50];

  const BUILTINS = [
    makeTrack({
      name: "Perch Fields", bpm: 80, bars: 4, vol: 0.8,
      prog: [Am, F, C, G],
      arpWave: "sine", arpVol: 0.08, arpSeq: [0, 2, 1, 3],
      padWave: "triangle", padVol: 0.05,
      bassWave: "triangle", bassVol: 0.13,
      leadWave: "sine", leadVol: 0.07,
      lead: [
        { b: 0, t: 0, m: 69, d: 1, v: 0.8 }, { b: 0, t: 2, m: 72, d: 1, v: 0.7 },
        { b: 1, t: 0, m: 76, d: 1.5, v: 0.8 }, { b: 1, t: 2.5, m: 72, d: 0.5, v: 0.6 },
        { b: 2, t: 0, m: 74, d: 1, v: 0.8 }, { b: 2, t: 2, m: 71, d: 1, v: 0.7 },
        { b: 3, t: 0, m: 67, d: 2, v: 0.8 },
      ],
    }),
    makeTrack({
      name: "Retro Orbit", bpm: 128, bars: 4, vol: 0.75,
      prog: [C, G, Am, F],
      arp: 16, arpWave: "square", arpVol: 0.06, arpSeq: [0, 1, 2, 3, 2, 1],
      pad: false,
      bassWave: "square", bassVol: 0.11,
      leadWave: "sawtooth", leadVol: 0.07,
      lead: [
        { b: 0, t: 0, m: 72, d: 0.5 }, { b: 0, t: 0.5, m: 76, d: 0.5 }, { b: 0, t: 1, m: 79, d: 1 },
        { b: 1, t: 0, m: 76, d: 0.5 }, { b: 1, t: 0.5, m: 79, d: 0.5 }, { b: 1, t: 1, m: 84, d: 1.5 },
        { b: 2, t: 0, m: 81, d: 0.5 }, { b: 2, t: 0.5, m: 76, d: 0.5 }, { b: 2, t: 1, m: 74, d: 1 },
        { b: 3, t: 0, m: 74, d: 0.5 }, { b: 3, t: 0.5, m: 71, d: 0.5 }, { b: 3, t: 1, m: 69, d: 1.5 },
      ],
    }),
    makeTrack({
      name: "Night Currents", bpm: 96, bars: 4, vol: 0.8,
      prog: [Dm, Am, Em, Am],
      arpWave: "triangle", arpVol: 0.07, arpSeq: [1, 2, 1, 3],
      padWave: "sawtooth", padVol: 0.04,
      bassWave: "sine", bassVol: 0.14,
      leadWave: "sine", leadVol: 0.09,
      lead: [
        { b: 0, t: 0, m: 69, d: 2, v: 0.8 },
        { b: 1, t: 0, m: 74, d: 1 }, { b: 1, t: 2, m: 72, d: 1 },
        { b: 2, t: 0, m: 67, d: 2, v: 0.8 },
        { b: 3, t: 0, m: 71, d: 1 }, { b: 3, t: 2, m: 69, d: 1.5, v: 0.7 },
      ],
    }),
    makeTrack({
      name: "Pixel Rain", bpm: 140, bars: 4, vol: 0.8,
      prog: [Am, F, G, Am],
      arp: 16, arpWave: "sawtooth", arpVol: 0.05, arpSeq: [0, 2, 1, 3],
      padWave: "square", padVol: 0.03,
      bassWave: "square", bassVol: 0.1,
      leadWave: "square", leadVol: 0.06,
      lead: [
        { b: 0, t: 0, m: 69, d: 0.5 }, { b: 0, t: 1, m: 72, d: 0.5 }, { b: 0, t: 2, m: 76, d: 0.5 }, { b: 0, t: 3, m: 79, d: 0.5 },
        { b: 1, t: 0, m: 76, d: 0.5 }, { b: 1, t: 1, m: 79, d: 0.5 }, { b: 1, t: 2, m: 74, d: 0.5 }, { b: 1, t: 3, m: 71, d: 0.5 },
        { b: 2, t: 0, m: 74, d: 0.5 }, { b: 2, t: 1, m: 76, d: 0.5 }, { b: 2, t: 2, m: 79, d: 0.5 }, { b: 2, t: 3, m: 74, d: 0.5 },
        { b: 3, t: 0, m: 69, d: 1 }, { b: 3, t: 2, m: 72, d: 1 }, { b: 3, t: 3.5, m: 76, d: 0.5 },
      ],
    }),
  ];

  // ---------- audio engine ----------
  function ensureCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch (e) { return null; } }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }
  let ctx = null;

  function playNote(ac, out, time, wave, freq, dur, vel, vol) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, time);
    const peak = 0.22 * vel * vol;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + 0.02);
    g.gain.setValueAtTime(Math.max(0.0002, peak), time + Math.max(0.03, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.09);
    osc.connect(g);
    g.connect(out);
    osc.start(time);
    osc.stop(time + dur + 0.12);
  }

  // One built-in loop player: lookahead scheduler over the track's voice map.
  class LoopPlayer {
    constructor(track) {
      this.track = track;
      this.beatDur = 60 / track.bpm;
      this.patternBeats = track.bars * 4;
      this.patternDur = this.patternBeats * this.beatDur;
      this.master = null;
      this.timer = null;
      this.playing = false;
      this.startTime = 0;
      this.nextK = 0;
      this.schedUntil = 0;
      this.volume = 0.8;
      // voice lookup: beatIndex -> [{time, freq, dur, vel, wave, vol}]
      this.byBeat = new Map();
      for (const voice of track.voices) {
        for (const n of voice.notes) {
          const b = n.t;
          if (!this.byBeat.has(b)) this.byBeat.set(b, []);
          this.byBeat.get(b).push({
            wave: voice.wave, freq: midi(n.p), dur: n.d * this.beatDur,
            vel: n.v, vol: voice.vol,
          });
        }
      }
    }
    get level() {
      return Math.max(0, Math.min(1, this.volume)) * Math.max(0, Math.min(1, globalVolume()));
    }
    play() {
      const ac = ensureCtx();
      if (!ac || this.playing) return;
      this.master = ac.createGain();
      this.master.gain.value = 0.0001;
      this.master.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.level * 0.9), ac.currentTime + 0.15);
      this.master.connect(ac.destination);
      const offset = (ac.currentTime - (this._pausedAt || 0)) % this.patternDur;
      this.startTime = ac.currentTime + 0.05 - (this._pausedAt ? offset : 0);
      this.nextK = 0;
      this.schedUntil = this.startTime;
      this.playing = true;
      this.timer = setInterval(() => this.schedule(), 40);
    }
    schedule() {
      const ac = ctx;
      if (!ac || !this.playing) return;
      const ahead = ac.currentTime + 0.18;
      while (this.schedUntil < ahead) {
        const t = this.startTime + this.nextK * this.beatDur;
        const beatInPattern = this.nextK % this.patternBeats;
        const notes = this.byBeat.get(beatInPattern);
        if (notes) {
          for (const n of notes) playNote(ac, this.master, t, n.wave, n.freq, n.dur, n.vel, n.vol * this.level);
        }
        this.nextK++;
        this.schedUntil = t + this.beatDur;
      }
    }
    pause() {
      if (!this.playing) return;
      this.playing = false;
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      const ac = ctx;
      if (ac && this.master) {
        this._pausedAt = ac.currentTime;
        this.master.gain.cancelScheduledValues(ac.currentTime);
        this.master.gain.setValueAtTime(this.master.gain.value, ac.currentTime);
        this.master.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
      }
      if (this.master) {
        const m = this.master;
        setTimeout(() => { try { m.disconnect(); } catch (e) {} }, 250);
      }
      this.master = null;
    }
    setVolume(v) {
      this.volume = v;
      const ac = ctx;
      if (ac && this.master && this.playing) {
        this.master.gain.cancelScheduledValues(ac.currentTime);
        this.master.gain.setValueAtTime(Math.max(0.0002, this.level * 0.9), ac.currentTime);
      }
    }
    stop() {
      this.pause();
      this._pausedAt = 0;
    }
    progress() {
      if (!this.playing || !ctx) return 0;
      const t = (ctx.currentTime - this.startTime) % this.patternDur;
      return Math.max(0, Math.min(1, t / this.patternDur));
    }
    get duration() {
      const s = this.patternDur;
      return Math.round(s) + "s";
    }
  }

  // ---------- URL track player ----------
  class UrlPlayer {
    constructor(url, name) {
      this.url = url;
      this.audio = null;
      this.playing = false;
      this.volume = 0.8;
      this.name = name || url;
    }
    play() {
      if (!this.audio) {
        const a = new Audio(this.url);
        a.loop = true;
        a.crossOrigin = "anonymous";
        a.volume = Math.max(0, Math.min(1, this.level));
        this.audio = a;
      }
      this.audio.volume = Math.max(0, Math.min(1, this.level));
      this.audio.play().catch(() => {});
      this.playing = true;
    }
    pause() {
      if (this.audio) this.audio.pause();
      this.playing = false;
    }
    stop() { this.pause(); }
    setVolume(v) {
      this.volume = v;
      if (this.audio) this.audio.volume = Math.max(0, Math.min(1, this.level));
    }
    get level() {
      return Math.max(0, Math.min(1, this.volume)) * Math.max(0, Math.min(1, globalVolume()));
    }
    progress() {
      if (!this.audio || !this.audio.duration || !this.audio.currentTime) return 0;
      return Math.min(1, this.audio.currentTime / this.audio.duration);
    }
    get duration() {
      if (this.audio && this.audio.duration && isFinite(this.audio.duration)) {
        return Math.round(this.audio.duration) + "s";
      }
      return "∞";
    }
  }

  // ---------- app ----------
  function createPlayer() {
    const p = {
      root: el("div", "mp"),
      tracks: [],   // [{label, player}]
      current: -1,
      w: null,
    };
    for (const t of BUILTINS) p.tracks.push({ label: t.name, player: new LoopPlayer(t), builtin: true });

    // ---- header ----
    const header = el("div", "mp-head");
    const nowPlaying = el("div", "mp-now");
    const titleEl = el("div", "mp-title", "Nothing playing");
    titleEl.classList.add("mp-muted-title");
    const metaEl = el("div", "mp-meta", "");
    nowPlaying.append(titleEl, metaEl);

    // ---- progress ----
    const progressWrap = el("div", "mp-progress");
    const progressFill = el("div", "mp-progress-fill");
    progressFill.style.width = "0%";
    progressWrap.appendChild(progressFill);

    // ---- controls ----
    const controls = el("div", "mp-controls");
    const prevBtn = el("button", "mp-ctl", "⏮");
    prevBtn.type = "button"; prevBtn.title = "Previous track";
    const playBtn = el("button", "mp-ctl mp-play", "▶");
    playBtn.type = "button"; playBtn.title = "Play / pause";
    const nextBtn = el("button", "mp-ctl", "⏭");
    nextBtn.type = "button"; nextBtn.title = "Next track";
    const volIcon = el("span", "mp-vol-icon", "🔊");
    const volInput = el("input", "mp-vol");
    volInput.type = "range";
    volInput.min = 0; volInput.max = 100; volInput.value = 80;
    volInput.setAttribute("aria-label", "Player volume");
    controls.append(prevBtn, playBtn, nextBtn, volIcon, volInput);
    header.append(nowPlaying, controls);
    p.root.append(header, progressWrap);

    // ---- playlist ----
    const list = el("div", "mp-list");
    function renderList() {
      list.textContent = "";
      p.tracks.forEach((t, i) => {
        const row = el("button", "mp-track" + (i === p.current ? " active" : ""), "");
        row.type = "button";
        const nm = el("span", "mp-track-name", t.label);
        const srcTag = el("span", "mp-track-src", t.builtin ? "built-in" : "URL");
        const dur = el("span", "mp-track-dur", t.player.duration);
        row.append(nm, srcTag, dur);
        row.addEventListener("click", () => selectTrack(i, true));
        list.appendChild(row);
      });
    }

    // ---- add URL ----
    const addRow = el("div", "mp-add");
    const addInput = el("input", "mp-add-input");
    addInput.type = "text";
    addInput.placeholder = "Add a custom audio URL…";
    addInput.spellcheck = false;
    const addBtn = el("button", "set-btn", "Add");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => addUrl());
    addInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); addUrl(); }
    });
    addRow.append(addInput, addBtn);

    const note = el("div", "mp-note",
      "Built-in tracks are synthesized live with WebAudio — no audio files needed. The player's volume follows the system sound level, so lowering the OS volume mutes playback too.");

    p.root.append(list, addRow, note);

    // ---------- behavior ----------
    function stopAll() {
      for (const t of p.tracks) t.player.stop();
    }
    function selectTrack(i, autoplay) {
      if (i < 0 || i >= p.tracks.length) return;
      const wasPlaying = p.tracks[p.current] && p.tracks[p.current].player.playing;
      stopAll();
      p.current = i;
      const t = p.tracks[i];
      titleEl.textContent = t.label;
      titleEl.classList.remove("mp-muted-title");
      metaEl.textContent = (t.builtin ? "WebAudio synth loop" : "custom audio URL") + " · " + t.player.duration;
      if (autoplay || wasPlaying) t.player.play();
      refreshUI();
      renderList();
    }
    function togglePlay() {
      if (p.current < 0) { selectTrack(0, true); return; }
      const t = p.tracks[p.current];
      if (t.player.playing) t.player.pause();
      else t.player.play();
      refreshUI();
    }
    function nextTrack() {
      selectTrack((p.current + 1) % p.tracks.length, true);
    }
    function prevTrack() {
      selectTrack((p.current - 1 + p.tracks.length) % p.tracks.length, true);
    }
    function addUrl() {
      const url = addInput.value.trim();
      if (!url) return;
      if (!/^(https?:|data:|blob:)/i.test(url)) {
        metaEl.textContent = "That doesn't look like an audio URL (http/https required).";
        return;
      }
      const label = (function () {
        try { return decodeURIComponent(url.split("/").pop().split("?")[0]) || url; } catch (e) { return url; }
      })();
      const t = { label, player: new UrlPlayer(url, label), builtin: false };
      p.tracks.push(t);
      addInput.value = "";
      renderList();
      selectTrack(p.tracks.length - 1, true);
    }
    function refreshUI() {
      const t = p.current >= 0 ? p.tracks[p.current] : null;
      playBtn.textContent = (t && t.player.playing) ? "⏸" : "▶";
      playBtn.classList.toggle("playing", !!(t && t.player.playing));
      renderList();
    }

    prevBtn.addEventListener("click", prevTrack);
    playBtn.addEventListener("click", togglePlay);
    nextBtn.addEventListener("click", nextTrack);
    volInput.addEventListener("input", () => {
      const v = Number(volInput.value) / 100;
      if (p.current >= 0) p.tracks[p.current].player.setVolume(v);
    });

    // progress ticker
    setInterval(() => {
      if (p.current >= 0 && p.tracks[p.current].player.playing) {
        progressFill.style.width = (p.tracks[p.current].player.progress() * 100) + "%";
      }
    }, 250);

    // stop on close (singleton window)
    p.onMount = function () {
      const winEl = p.root.closest(".window");
      if (!winEl) return;
      const win = (window.WM.windows || []).find((x) => x.el === winEl);
      if (win) {
        p.w = win;
        win.onCloseRequest = () => { stopAll(); };
      }
    };

    renderList();
    return p;
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["music-player"] = function () {
    const p = createPlayer();
    setTimeout(() => p.onMount(), 60);
    return { content: p.root, w: 460, h: 560, minW: 360, minH: 400 };
  };
})();