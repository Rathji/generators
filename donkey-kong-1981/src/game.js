// src/game.js — Donkey Kong (1981) recreation · core module (plain script)
// Phase 1: canvas bootstrap (224×256 arcade res), render loop, input manager,
// arcade-style loading screen.
// Phase 2: world model (girders + ladder notches), Player state machine,
// movement/jumping/ladder physics with a fixed 60 Hz timestep.
// Verify with ?test=loading (freeze splash) or ?test=game (skip splash).

(function () {
  "use strict";

  const W = 224, H = 256; // internal arcade resolution (224 wide × 256 tall)
  const BG = "#060b22";

  const COLORS = {
    bg: BG,
    girder: "#31c7ef",
    girderDark: "#0b7aa0",
    rivet: "#9adff7",
    ladder: "#f0e6c0",
    ladderDark: "#8a6b2a",
    barrel: "#c23b22",
    barrelDark: "#701a0e",
    barrelLight: "rgba(255,255,255,.22)",
    fire: "#ff8c1a",
    fireDark: "#c74d05",
    fireCore: "#ffe24a",
    marioRed: "#e03a3a",
    skin: "#ffd9a6",
    shirt: "#f2f2f2",
    overalls: "#1f4fd6",
    shoe: "#6b3a1f",
    titleRed: "#e43b3b",
    titleDark: "#8f1414",
    ink: "#e8ecf8",
    muted: "#7f8db3",
    hud: "#9fe0ff",
  };

  const CONFIG = { W: W, H: H, colors: COLORS };

  // ── Canvas bootstrap ─────────────────────────────────────────
  const ctn = document.getElementById("gameCtn");
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.id = "gameCanvas";
  ctn.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  function fit() {
    const cw = ctn.clientWidth || 560;
    const ch = ctn.clientHeight || 500;
    const scale = Math.min(cw / W, ch / H);
    canvas.style.width = Math.floor(W * scale) + "px";
    canvas.style.height = Math.floor(H * scale) + "px";
  }
  fit();
  window.addEventListener("resize", fit);

  // ── Input manager ────────────────────────────────────────────
  const Input = {
    keys: Object.create(null),     // held state per action
    pressed: Object.create(null),  // edge-triggered (true for one frame)
    mappings: {
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
      down: ["ArrowDown", "KeyS"],
      jump: ["Space", "KeyX"],
      start: ["Enter"],
      pause: ["KeyP", "Escape"],
    },
    isDown: function (action) { return !!this.keys[action]; },
  };

  function panelOpen() {
    const p = document.getElementById("roadmapPanel");
    return p && !p.hidden;
  }

  window.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (e.code === "KeyM") { Sound.muted = !Sound.muted; if (!Sound.muted) Sound.blip(); return; }
    let action = null;
    for (const [name, codes] of Object.entries(Input.mappings)) {
      if (codes.indexOf(e.code) !== -1) { action = name; break; }
    }
    if (!action) return;
    if (!panelOpen()) e.preventDefault();
    if (!Input.keys[action]) Input.pressed[action] = true;
    Input.keys[action] = true;
  });

  window.addEventListener("keyup", function (e) {
    for (const [name, codes] of Object.entries(Input.mappings)) {
      if (codes.indexOf(e.code) !== -1) Input.keys[name] = false;
    }
  });

  // ── Sound engine (Phase 10) ──────────────────────────────────
  // All SFX and BGM are synthesized with WebAudio (no assets). The context is
  // created/resumed on the first user gesture (a keydown), which satisfies the
  // browser's autoplay policy. M toggles mute.
  const Sound = {
    ctx: null,
    muted: false,
    ensure: function () {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return;
      }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      } catch (e) { this.ctx = null; }
    },
    toneAt: function (freq, dur, type, vol, t) {
      if (this.muted || !this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    tone: function (freq, dur, type, vol, slide) {
      if (this.muted) return;
      this.ensure();
      if (!this.ctx) return;
      let t = this.ctx.currentTime + 0.01;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    seq: function (notes, type, vol) {
      if (this.muted) return;
      this.ensure();
      if (!this.ctx) return;
      let t = this.ctx.currentTime + 0.01;
      for (const n of notes) {
        this.toneAt(n[0], n[1], type, vol, t);
        t += n[1];
      }
    },
    jump: function () { this.tone(300, 0.18, "square", 0.07, 340); },
    walk: function () { this.tone(1150, 0.03, "square", 0.014, -220); },
    death: function () { this.seq([[420, 0.12], [300, 0.12], [180, 0.3]], "square", 0.09); },
    splash: function () { this.tone(150, 0.3, "sawtooth", 0.1, -110); },
    smash: function () { this.tone(260, 0.16, "square", 0.09, -160); },
    rivet: function () { this.seq([[700, 0.06], [1050, 0.09]], "square", 0.06); },
    collapse: function () { this.tone(90, 1.2, "sawtooth", 0.12, -40); },
    clear: function () { this.seq([[523, 0.1], [659, 0.1], [784, 0.12], [1047, 0.26]], "square", 0.07); },
    gameOver: function () { this.seq([[392, 0.16], [330, 0.16], [262, 0.2], [196, 0.42]], "square", 0.08); },
    blip: function () { this.tone(640, 0.05, "square", 0.05); },
    select: function () { this.tone(880, 0.1, "square", 0.06, 180); },
  };

  // Simple chiptune loop (original melody, no copyrighted DK theme) played on
  // a 16-step grid; starts when a game begins, stops on game over/victory.
  const BGM = {
    on: false, step: 0, frame: 0, rate: 13,
    melody: [659, 0, 784, 0, 1047, 0, 784, 0, 698, 0, 587, 0, 659, 784, 1047, 0],
    bass: [220, 0, 220, 0, 262, 0, 262, 0, 175, 0, 175, 0, 165, 0, 165, 0],
    start: function () { this.on = true; this.step = 0; this.frame = 0; },
    stop: function () { this.on = false; },
    tick: function () {
      if (!this.on) return;
      if (++this.frame < this.rate) return;
      this.frame = 0;
      const i = this.step;
      this.step = (this.step + 1) % this.melody.length;
      if (this.melody[i]) Sound.tone(this.melody[i], 0.16, "square", 0.035);
      if (this.bass[i]) Sound.tone(this.bass[i], 0.3, "triangle", 0.055);
    },
  };

  // ── Sprite & draw helpers ────────────────────────────────────
  // Pixel-map sprite renderer. rows: array of strings; colors: char→hex.
  function drawSpriteMap(map, x, y, opts) {
    opts = opts || {};
    const scale = opts.scale || 1;
    for (let r = 0; r < map.rows.length; r++) {
      const row = map.rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === "." || ch === " ") continue;
        const col = map.colors[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        const px = opts.flip ? (row.length - 1 - c) : c;
        ctx.fillRect(x + px * scale, y + r * scale, scale, scale);
      }
    }
  }

  // Jumpman / Mario (16 wide × 17 tall), facing right.
  const MARIO = {
    colors: {
      r: COLORS.marioRed, s: COLORS.skin, w: COLORS.shirt,
      b: COLORS.overalls, o: COLORS.shoe, k: "#141414",
    },
    rows: [
      "................",
      "......rrrrrrrr..",
      ".....rrrrrrrrrrr",
      "....rrrrrrrrrrrr",
      "....ssssssssssss",
      "...sssssssssssss",
      "...sssssssssssss",
      "...sssssssssssss",
      "...sssssssssssss",
      "....wwwwwwwwww..",
      "....bbbbbbbbbb..",
      "....bbbbbbbbbb..",
      "....bbbbbbbbbb..",
      "....bbbbbbbbbb..",
      "...bbbbbbbbbbb..",
      "..oo......oo....",
      ".oooo....oooo...",
    ],
  };

  function drawBarrel(x, y, r, rot) {
    // soft shadow (screen space, does not rotate)
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath(); ctx.ellipse(x + 1.5, y + 2.5, r * 0.9, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    // body (radial highlight)
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, r);
    g.addColorStop(0, "#e5634c");
    g.addColorStop(1, "#9c2816");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // outline
    ctx.strokeStyle = "#4a0e04";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    // horizontal bands (top & bottom third)
    ctx.fillStyle = "#7c1c0c";
    ctx.fillRect(-r + 1, -4.5, (r * 2) - 2, 2.5);
    ctx.fillRect(-r + 1, 2, (r * 2) - 2, 2.5);
    // vertical staves
    ctx.strokeStyle = "#8a2410";
    ctx.lineWidth = 1;
    for (const dx of [-3.5, 0, 3.5]) {
      ctx.beginPath();
      ctx.moveTo(dx, -r + 3);
      ctx.lineTo(dx, r - 3);
      ctx.stroke();
    }
    // highlight
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.beginPath(); ctx.ellipse(-3.5, -3.5, 2.2, 3, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Donkey Kong (16 wide × 18 tall) — drawn at 2× so he towers over Mario.
  const DK = {
    colors: { b: "#5a3a1e", f: "#d9a066", e: "#0f0802", n: "#3a2410", w: "#fff7e8", t: "#c22b2b" },
    rows: [
      "...bbbbbbbbbbbbbb...",
      "..bbbbbbbbbbbbbbbb..",
      "..bbbbbbbbbbbbbbbb..",
      "..bbnnnnnnnnnnnnbb..",
      "..bbfeeeffffeeefbb..",
      "..bbfeeeffffeeefbb..",
      "..bbffffffffffffbb..",
      "..bbffffffffffffbb..",
      "..bbffffnnnnffffbb..",
      "..bbffnnnnnnnnffbb..",
      "..bbffffffffffffbb..",
      "..bbfnnnnnnnnnnfbb..",
      "..bbfwwwnwwwnwwfbb..",
      "..bbfnnnnnnnnnnfbb..",
      "..bbffffffffffffbb..",
      "...bbffffffffffbb...",
      "..bbbbbbbbbbbbbbbb..",
      "..bbbbbbttbbbbbbbb..",
      "..bbbbbbttbbbbbbbb..",
      ".bbbbbbbttbbbbbbbbb.",
    ],
  };

  // Pauline (10 wide × 15 tall).
  const PAULINE = {
    colors: { b: "#5c3a1e", s: "#ffd9a6", w: "#f2f2f2" },
    rows: [
      "....bbbb..",
      "...bbbbbb.",
      "...bbbbbb.",
      "...ssssss.",
      "...ssssss.",
      "..wwwwwwww",
      "..wwwwwwww",
      "..wwwwwwww",
      "..wwwwwwww",
      ".wwwwwwwww",
      ".wwwwwwwww",
      "..wwwwww..",
      "..wwwwww..",
      "..wwwwww..",
      ".w..ww..w.",
    ],
  };

  // Screen 1 collectibles (Phase 4): the Hat, Handbag and Parasol.
  const HAT = {
    colors: { b: "#7a4a22", d: "#4e2c10" },
    rows: [
      "..bbbb..",
      ".bddddb.",
      "bddddddb",
      "bbbbbbbb",
      "bbbbbbbb",
    ],
  };
  const HANDBAG = {
    colors: { p: "#e06fa8", d: "#a63c74", s: "#ffc7de" },
    rows: [
      ".s....s.",
      ".ss..ss.",
      "........",
      "pppppppp",
      "pppppppp",
      ".pppppp.",
    ],
  };
  const PARASOL = {
    colors: { r: "#e03a4e", d: "#a11f30", h: "#f0e6c0" },
    rows: [
      "..rrrr..",
      ".rrrrrr.",
      "rrrrrrrr",
      "rrrrrrrr",
      ".r....r.",
      "........",
      "...hh...",
      "...hh...",
    ],
  };
  const HAMMER_ICON = {
    colors: { g: "#c9d2de", d: "#6a7480", h: "#c22b2b" },
    rows: [
      "gggggg",
      "gggggg",
      "..hh..",
      "..hh..",
      "..hh..",
      "..hh..",
    ],
  };

  function drawFireball(x, y, r, blue) {
    const c = blue
      ? { dark: "#1a5fb4", body: "#4a9eff", core: "#cfe6ff" }
      : { dark: COLORS.fireDark, body: COLORS.fire, core: COLORS.fireCore };
    // flame spikes
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const px = x + Math.cos(a) * (r + 2.5);
      const py = y + Math.sin(a) * (r + 2.5);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    // body
    ctx.fillStyle = c.body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // core
    ctx.fillStyle = c.core;
    ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    // eyes
    ctx.fillStyle = "#141414";
    ctx.fillRect(x - 3, y - 2, 1, 2);
    ctx.fillRect(x + 2, y - 2, 1, 2);
  }

  function drawGirder(x, y, w, opts) {
    opts = opts || {};
    const h = opts.h || 4;
    const rivetEvery = opts.rivetEvery || 8;
    // bar
    ctx.fillStyle = COLORS.girder;
    ctx.fillRect(x, y, w, h);
    // dark bottom edge
    ctx.fillStyle = COLORS.girderDark;
    ctx.fillRect(x, y + h - 1, w, 1);
    // end caps
    ctx.fillStyle = COLORS.girderDark;
    ctx.fillRect(x, y, 2, h);
    ctx.fillRect(x + w - 2, y, 2, h);
    // rivets (small grey circles on the lower half of the bar)
    ctx.fillStyle = "#b6bfce";
    for (let rx = x + 4; rx < x + w - 4; rx += rivetEvery) {
      ctx.beginPath();
      ctx.arc(rx + 1, y + h - 1, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLadder(l) {
    const x0 = l.x - l.w / 2 + 1, x1 = l.x + l.w / 2 - 1;
    // rails
    ctx.fillStyle = COLORS.ladder;
    ctx.fillRect(x0, l.top, 2, l.bottom - l.top);
    ctx.fillRect(x1, l.top, 2, l.bottom - l.top);
    // rungs
    for (let y = l.top + 4; y < l.bottom - 2; y += 7) {
      ctx.fillRect(x0, y, l.w - 2, 1.5);
    }
    // dark edge on the rails
    ctx.fillStyle = COLORS.ladderDark;
    ctx.fillRect(x0, l.top, 2, 1);
    ctx.fillRect(x1, l.top, 2, 1);
  }

  function drawLogo(now) {
    const cx = W / 2;
    const pulse = 1 + 0.02 * Math.sin(now / 320);
    const slant = -0.16;

    function line(text, y, size, red) {
      ctx.save();
      ctx.translate(cx, y);
      ctx.scale(pulse, pulse);
      ctx.transform(1, 0, slant, 1, 0, 0);
      ctx.font = "900 " + size + "px 'Arial Black', Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, size / 8);
      ctx.lineJoin = "round";
      ctx.strokeStyle = COLORS.ink;
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = COLORS.titleDark;
      ctx.fillText(text, 1.5, 2);
      ctx.fillStyle = red;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    line("DONKEY", 32, 21, COLORS.titleRed);
    line("KONG", 62, 29, COLORS.titleRed);
  }

  // ── Loading screen state ─────────────────────────────────────
  const test = new URLSearchParams(location.search).get("test");
  const LOAD_DURATION = 3600; // ms
  let loadStart = performance.now();
  let state = (test === "game") ? "game" : "loading";

  function renderLoading(now) {
    const t = now - loadStart;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0c1334");
    g.addColorStop(1, "#04060f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawLogo(now);

    ctx.fillStyle = "#8fa4cf";
    ctx.font = "6px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("©1981 NINTENDO", W / 2, 86);

    // girder 1 + rolling barrel
    drawGirder(16, 108, W - 32);
    const bx = 20 + ((t * 0.028) % (W - 40));
    drawBarrel(bx, 99, 8);

    // girder 2 + walking Mario (drawn at 2× so he reads clearly)
    drawGirder(16, 162, W - 32);
    const mx = 16 + ((t * 0.018) % (W - 48 - 32));
    drawSpriteMap(MARIO, mx, 128, { scale: 2 });

    // hopping fireball near the plaza
    const hop = Math.max(0, Math.sin(t / 240)) * 16;
    drawFireball(112, 222 - hop, 5);

    // loading text + progress bar
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.ink;
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("LOADING", 34, 234);
    ctx.fillStyle = COLORS.muted;
    const dots = ".".repeat(1 + (Math.floor(t / 380) % 3));
    ctx.fillText(dots, 76, 234);

    const frac = Math.min(1, t / 2500);
    ctx.fillStyle = "#1a2340";
    ctx.fillRect(34, 240, 156, 5);
    ctx.fillStyle = COLORS.girder;
    ctx.fillRect(34, 240, Math.floor(156 * frac), 5);

    // press start blink
    if (t > 2700 && (Math.floor(t / 340) % 2 === 0)) {
      ctx.fillStyle = COLORS.fireCore;
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("PRESS START", W / 2, 253);
    }
  }

  // ── Title screen & menu (Phase 9) ────────────────────────────
  // loading → title → game. The menu offers 1 PLAYER, 2 PLAYER and an
  // INSTRUCTIONS panel; the game starts on the active player's spawn.
  let titleSel = 0;     // 0: 1 PLAYER, 1: 2 PLAYER, 2: INSTRUCTIONS
  let titleHelp = false;

  function startGame(mode) {
    gameMode = mode;
    for (const pl of players) { pl.score = 0; pl.lives = 3; pl.hammerT = 0; }
    switchTo(0);
    goToScreen(1);
    state = "game";
    BGM.start();
    Sound.select();
  }

  function stepTitle() {
    if (titleHelp) {
      if (Input.pressed.start || Input.pressed.jump || Input.pressed.pause) {
        titleHelp = false;
        Sound.blip();
      }
      return;
    }
    if (Input.pressed.up || Input.pressed.down) {
      titleSel = (titleSel + (Input.pressed.down ? 1 : 2)) % 3;
      Sound.blip();
    }
    if (Input.pressed.start || Input.pressed.jump) {
      if (titleSel === 2) { titleHelp = true; Sound.blip(); }
      else startGame(titleSel + 1);
    }
  }

  function renderTitle(now) {
    const t = now - loadStart;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0c1334");
    g.addColorStop(1, "#04060f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawLogo(now);

    ctx.fillStyle = "#8fa4cf";
    ctx.font = "6px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("©1981 NINTENDO", W / 2, 86);

    if (titleHelp) {
      ctx.fillStyle = "#0a1030";
      ctx.fillRect(28, 100, W - 56, 118);
      ctx.strokeStyle = COLORS.girder;
      ctx.lineWidth = 1;
      ctx.strokeRect(28, 100, W - 56, 118);
      ctx.fillStyle = COLORS.ink;
      ctx.font = "8px 'Arial Black', Impact, sans-serif";
      ctx.fillText("HOW TO PLAY", W / 2, 116);
      ctx.font = "6px ui-monospace, monospace";
      ctx.fillStyle = COLORS.hud;
      ctx.textAlign = "left";
      const helpLines = [
        "1P  arrows + SPACE   2P  WASD + X",
        "Climb to the top - rescue Pauline!",
        "Jump over barrels and fireballs.",
        "Hammer smashes anything for 500.",
        "Screen 4: stamp out all 8 rivets.",
        "M mutes sound.",
      ];
      for (let i = 0; i < helpLines.length; i++) ctx.fillText(helpLines[i], 40, 134 + i * 11);
      ctx.textAlign = "center";
      ctx.fillStyle = COLORS.fireCore;
      if (Math.floor(t / 340) % 2 === 0) ctx.fillText("PRESS ENTER TO RETURN", W / 2, 212);
      return;
    }

    const items = ["1 PLAYER", "2 PLAYER", "INSTRUCTIONS"];
    ctx.textAlign = "center";
    ctx.font = "8px 'Arial Black', Impact, sans-serif";
    for (let i = 0; i < items.length; i++) {
      ctx.fillStyle = i === titleSel ? COLORS.fireCore : COLORS.muted;
      ctx.fillText(items[i], W / 2, 132 + i * 16);
      if (i === titleSel && Math.floor(t / 340) % 2 === 0) {
        ctx.fillStyle = COLORS.ink;
        ctx.textAlign = "right";
        ctx.fillText(">", W / 2 - 44, 132 + i * 16);
        ctx.textAlign = "center";
      }
    }
    ctx.fillStyle = COLORS.muted;
    ctx.font = "6px ui-monospace, monospace";
    ctx.fillText("↑↓ select · ENTER confirm", W / 2, 190);
    ctx.fillText("HI-SCORE " + String(hiScore).padStart(6, "0"), W / 2, 206);
  }

  // ── World model & physics (Phase 2) ──────────────────────────
  const STEP = 1 / 60; // fixed physics timestep (60 Hz)
  const PHYS = {
    walkSpeed: 1.15, accel: 0.16, friction: 0.84, airAccel: 0.1,
    gravity: 0.28, jumpV: -3.9, jumpCutV: -1.6, maxFall: 4.5,
    climbSpeed: 1.2,
  };

  // ── Screens (Phase 3 + Phase 6) ──────────────────────────────
  // Each screen is a self-contained layout. WORLD/ITEMS point at the active
  // screen's data, so the rest of the engine (physics, rendering) reads the
  // current screen without knowing which one it is.
  // girders[0] is the TOP girder; girders[plazaIdx] is the plaza floor.
  // ladder.top  = upper girder surface → the ladder carves a NOTCH there
  // ladder.bottom = lower girder surface → the ladder rests ON it (solid)
  // ramps slope down from the end of gTop to the end of gBot ("side" = which end).
  // belts push the player/barrels along a girder (Screen 2 only).
  const SCREENS = {
    1: {
      plazaIdx: 5,
      fires: [{ x: 214 }],
      chute: { x: 64 },
      barrelEvery: 95, fireEvery: 300,
      dk: { x: 18, y: 56 - 20 * 2 },
      pauline: { x: 182, y: 56 - 15 },
      girders: [
        { x: 16, y: 56, w: 192 },
        { x: 16, y: 88, w: 192 },
        { x: 16, y: 120, w: 192 },
        { x: 16, y: 152, w: 192 },
        { x: 16, y: 184, w: 192 },
        { x: 0, y: 224, w: 224 },
      ],
      ladders: [
        { x: 48, w: 8, top: 184, bottom: 224 },
        { x: 80, w: 8, top: 152, bottom: 184 },
        { x: 176, w: 8, top: 152, bottom: 184 },
        { x: 112, w: 8, top: 120, bottom: 152 },
        { x: 144, w: 8, top: 88, bottom: 120 },
        { x: 176, w: 8, top: 56, bottom: 88 },
      ],
      ramps: [
        { gTop: 0, gBot: 1, side: "right" },
        { gTop: 1, gBot: 2, side: "left" },
        { gTop: 2, gBot: 3, side: "right" },
        { gTop: 3, gBot: 4, side: "left" },
      ],
      belts: [],
      items: [
        { name: "parasol", map: PARASOL, x: 196, g: 0, pts: 300, taken: false, timer: 0 },
        { name: "handbag", map: HANDBAG, x: 194, g: 1, pts: 200, taken: false, timer: 0 },
        { name: "hat",     map: HAT,     x: 40,  g: 3, pts: 100, taken: false, timer: 0 },
      ],
    },
    2: {
      // 50m — conveyor belts. Belts alternate direction and carry both the
      // player and barrels; ladders are placed so the belt flow ferries you
      // from one ladder to the next on the way up to Pauline.
      plazaIdx: 5,
      fires: [{ x: 214 }],
      chute: { x: 64 },
      barrelEvery: 88, fireEvery: 280,
      dk: { x: 18, y: 56 - 20 * 2 },
      pauline: { x: 182, y: 56 - 15 },
      girders: [
        { x: 16, y: 56, w: 192 },
        { x: 16, y: 88, w: 192 },
        { x: 16, y: 120, w: 192 },
        { x: 16, y: 152, w: 192 },
        { x: 16, y: 184, w: 192 },
        { x: 0, y: 224, w: 224 },
      ],
      ladders: [
        { x: 48,  w: 8, top: 184, bottom: 224 },
        { x: 176, w: 8, top: 152, bottom: 184 },
        { x: 48,  w: 8, top: 120, bottom: 152 },
        { x: 176, w: 8, top: 88,  bottom: 120 },
        { x: 112, w: 8, top: 56,  bottom: 88 },
      ],
      ramps: [],
      belts: [
        { y: 88, dir: -1 },
        { y: 120, dir: 1 },
        { y: 152, dir: -1 },
        { y: 184, dir: 1 },
      ],
      items: [
        { name: "parasol", map: PARASOL, x: 200, g: 3, pts: 300, taken: false, timer: 0 },
        { name: "handbag", map: HANDBAG, x: 36,  g: 1, pts: 200, taken: false, timer: 0 },
        { name: "hat",     map: HAT,     x: 190, g: 2, pts: 100, taken: false, timer: 0 },
      ],
    },
    3: {
      // 75m — elevators. A blue elevator rides the left shaft (x=64) between
      // g4 and g1, a pink one the right shaft (x=160) between g3 and g0; both
      // carry the player AND barrels. Ladders alternate sides per girder, so
      // each half-rise is elevator-only. Oil-can fires on the plaza are lethal
      // and hatch fireballs.
      plazaIdx: 5,
      chute: { x: 100 },
      barrelEvery: 80, fireEvery: 260,
      dk: { x: 18, y: 56 - 20 * 2 },
      pauline: { x: 182, y: 56 - 15 },
      fires: [{ x: 80 }, { x: 120 }, { x: 160 }],
      gaps: [{ x: 64, w: 10 }, { x: 160, w: 10 }],
      girders: [
        { x: 16, y: 56, w: 192 },
        { x: 16, y: 88, w: 192 },
        { x: 16, y: 120, w: 192 },
        { x: 16, y: 152, w: 192 },
        { x: 16, y: 184, w: 192 },
        { x: 0, y: 224, w: 224 },
      ],
      ladders: [
        { x: 48,  w: 8, top: 184, bottom: 224 },
        { x: 176, w: 8, top: 152, bottom: 184 },
        { x: 104, w: 8, top: 120, bottom: 152 },
        { x: 48,  w: 8, top: 88,  bottom: 120 },
        { x: 176, w: 8, top: 56,  bottom: 88 },
      ],
      ramps: [],
      belts: [],
      elevators: [
        { x: 64,  w: 20, yTop: 88,  yBot: 184, period: 420, t: 0,   y: 88 },
        { x: 160, w: 20, yTop: 56,  yBot: 152, period: 360, t: 180, y: 152 },
      ],
      items: [
        { name: "parasol", map: PARASOL, x: 104, g: 0, pts: 300, taken: false, timer: 0 },
        { name: "handbag", map: HANDBAG, x: 76,  g: 2, pts: 200, taken: false, timer: 0 },
        { name: "hat",     map: HAT,     x: 176, g: 1, pts: 100, taken: false, timer: 0 },
      ],
    },
    4: {
      // 100m — the rivets. Zigzag half-platforms held up by 8 rivets; pop them
      // all to collapse the structure (that's the win — no Pauline rescue).
      // Each girder spans only part of the width, so barrels cascade down the
      // right side while the player zigzags up the ladders on the left.
      plazaIdx: 5,
      chute: { x: 100 },
      barrelEvery: 72, fireEvery: 240,
      dk: { x: 18, y: 56 - 20 * 2 },
      pauline: { x: 182, y: 56 - 15 },
      rivetsWin: true,
      fires: [{ x: 24 }, { x: 190 }],
      girders: [
        { x: 16, y: 56, w: 192 },
        { x: 16, y: 88, w: 128 },
        { x: 80, y: 120, w: 128 },
        { x: 16, y: 152, w: 128 },
        { x: 80, y: 184, w: 128 },
        { x: 0, y: 224, w: 224 },
      ],
      ladders: [
        { x: 144, w: 8, top: 184, bottom: 224 },
        { x: 128, w: 8, top: 152, bottom: 184 },
        { x: 80,  w: 8, top: 120, bottom: 152 },
        { x: 144, w: 8, top: 88,  bottom: 120 },
        { x: 80,  w: 8, top: 56,  bottom: 88 },
      ],
      ramps: [],
      belts: [],
      rivets: [
        { g: 1, x: 60 },  { g: 1, x: 120 },
        { g: 2, x: 100 }, { g: 2, x: 180 },
        { g: 3, x: 48 },  { g: 3, x: 104 },
        { g: 4, x: 100 }, { g: 4, x: 180 },
      ],
      items: [
        { name: "parasol", map: PARASOL, x: 196, g: 0, pts: 300, taken: false, timer: 0 },
        { name: "handbag", map: HANDBAG, x: 180, g: 2, pts: 200, taken: false, timer: 0 },
        { name: "hat",     map: HAT,     x: 60,  g: 3, pts: 100, taken: false, timer: 0 },
      ],
    },
  };

  const screenParam = parseInt(new URLSearchParams(location.search).get("screen"), 10);
  let screenNum = (screenParam && SCREENS[screenParam]) ? screenParam : 1;
  let WORLD = SCREENS[screenNum];
  let ITEMS = SCREENS[screenNum].items;

  const BELT_SPEED = 0.45;

  function beltFor(g) {
    for (const b of WORLD.belts) if (b.y === g.y) return b;
    return null;
  }

  function loadScreen(n) {
    screenNum = n;
    WORLD = SCREENS[n];
    ITEMS = SCREENS[n].items;
    resetScreen();
  }

  function advanceScreen() {
    let next = screenNum + 1;
    if (!SCREENS[next]) next = 1;
    loadScreen(next);
  }

  function goToScreen(n) {
    if (!SCREENS[n]) n = 1;
    loadScreen(n);
  }

  function rampTop(r) {
    const g = WORLD.girders[r.gTop];
    return { x: (r.side === "right") ? g.x + g.w : g.x, y: g.y };
  }
  function rampBottom(r) {
    const g = WORLD.girders[r.gBot];
    // the ramp's lower end extends PAST the girder end so it's a visible slope
    // that barrels roll down (and it catches cascading barrels)
    return { x: (r.side === "right") ? g.x + g.w + 14 : g.x - 14, y: g.y };
  }

  // ── Barrels (Phase 3) ────────────────────────────────────────
  const BARREL = { r: 7, speed: 1.05 };
  const MAX_BARRELS = 6;
  const barrels = [];
  let spawnTimer = 90;
  let sparks = [];

  function spawnBarrel() {
    if (barrels.length >= MAX_BARRELS) return false;
    barrels.push({
      x: WORLD.chute.x, y: WORLD.girders[0].y - BARREL.r,
      r: BARREL.r, dir: 1, speed: BARREL.speed,
      vy: 0, onGirder: WORLD.girders[0], ramp: null, rot: 0, splashed: false,
      jumpScored: false, fellFrom: null, rideEv: null,
    });
    return true;
  }

  // ── Oil-can fires (Phase 3 + Phase 7) ────────────────────────
  // Screen data has `fires: [{x}, ...]` (an oil can on the plaza). Screens 1/2
  // have one, Screen 3 has three. Fireballs hatch from a random one, barrels
  // splash at the nearest, and touching one is lethal.
  function fireList() { return WORLD.fires || [{ x: 214 }]; }
  function nearestFire(x) {
    const fs = fireList();
    let best = fs[0];
    for (const f of fs) if (Math.abs(f.x - x) < Math.abs(best.x - x)) best = f;
    return best;
  }

  function splashBarrel(b) {
    b.splashed = true;
    const f = nearestFire(b.x);
    sparks.push({ x: f.x + 2, y: WORLD.girders[WORLD.plazaIdx].y - 8, t: 30 });
    Sound.splash();
    burstParticles(b.x, b.y, "#ff8c1a", 6);
  }

  // ── Scoring, lives & collectibles (Phase 4) ──────────────────
  // Each player carries their own score + lives; hiScore is shared and
  // persists in localStorage. The active player's values drive the HUD.
  let hiScore = 0;
  let frameCount = 0;
  let overlayTimer = 0;
  let shake = 0;
  const particles = [];
  try { hiScore = parseInt(localStorage.getItem("dk_hi") || "0", 10) || 0; } catch (e) { hiScore = 0; }

  function addScore(n) {
    player.score += n;
    if (player.score > hiScore) {
      hiScore = player.score;
      try { localStorage.setItem("dk_hi", String(hiScore)); } catch (e) { /* storage unavailable */ }
    }
  }

  function burstParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 2.2,
        vy: -Math.random() * 2.2,
        t: 18 + Math.random() * 10,
        color: color,
      });
    }
  }

  // Hat, Handbag, Parasol — positions live in the active screen's `items`
  // (see SCREENS above); resetItems() returns them all to their spots.
  function resetItems() {
    for (const it of ITEMS) { it.taken = false; it.timer = 0; }
  }

  // Hammer power-up: appears at random spots on a ~15s cycle, stays ~5s,
  // grants HAMMER_MODE (8s) that smashes barrels for 500 pts.
  const HAMMER_SPOTS = [
    { g: 1, x: 60 }, { g: 2, x: 170 }, { g: 3, x: 120 }, { g: 4, x: 150 },
  ];
  const hammer = { active: false, g: 0, x: 0, y: 0, life: 0, spawnTimer: 60 };
  const bursts = [];

  function resetScreen() {
    respawn();
    resetItems();
    barrels.length = 0;
    spawnTimer = 90;
    sparks.length = 0;
    fireballs.length = 0;
    fireSpawnTimer = 300;
    hammer.active = false;
    hammer.spawnTimer = 600;
    player.hammerT = 0;
    particles.length = 0;
    if (WORLD.rivets) for (const r of WORLD.rivets) r.active = true;
    collapse = null;
  }

  function gameOver() {
    BGM.stop();
    state = "over"; overlayTimer = 180;
    Sound.gameOver();
  }

  // The active player died: spend a life, then in 2P mode alternate turns on
  // every death (arcade style) while the other player still has lives.
  function handleDeath() {
    player.lives--;
    if (player.lives > 0) {
      if (gameMode === 2 && players[1 - activeIdx].lives > 0) switchTo(1 - activeIdx);
    } else if (gameMode === 2 && players[1 - activeIdx].lives > 0) {
      switchTo(1 - activeIdx);
    } else {
      gameOver();
    }
    resetScreen();
  }

  function triggerLevelClear() {
    addScore(5000);
    state = "clear"; overlayTimer = 220;
    Sound.clear();
    resetScreen();
  }

  // ── Rivets & structure collapse (Phase 8 / Screen 4) ─────────
  // Screen 4's zigzag platforms are held up by rivets. Stepping on a rivet
  // pops it (+100); when the last one is gone the whole structure collapses.
  let collapse = null; // { t, fall: [yOffsetPerGirder|null] }

  function rivetsLeft() {
    return WORLD.rivets ? WORLD.rivets.filter(function (r) { return r.active; }).length : 0;
  }

  function triggerCollapse() {
    if (collapse) return;
    collapse = { t: 0, fall: WORLD.girders.map(function () { return null; }) };
    barrels.length = 0;
    fireballs.length = 0;
    sparks.length = 0;
    hammer.active = false;
    player.hammerT = 0;
    BGM.stop();
    shake = 5;
    Sound.collapse();
    state = "collapse";
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function smashBarrel(b) {
    b.splashed = true;
    addScore(500);
    bursts.push({ x: b.x, y: b.y, t: 18 });
    Sound.smash();
    burstParticles(b.x, b.y, "#ffb02e", 8);
  }

  // ── Fireballs (Phase 5) ──────────────────────────────────────
  // Emerge from the oil cans at the bottom-right, then patrol the girders:
  // wandering with occasional direction flips and random ladder climbs.
  // ~8s after spawning a fireball turns BLUE (faster, worth more points).
  const FIREBALL = { r: 4.5, walk: 0.55, blueWalk: 0.95, climb: 0.5, blueClimb: 0.85 };
  const MAX_FIREBALLS = 3;
  const fireballs = [];
  let fireSpawnTimer = 300;

  function spawnFireball() {
    if (fireballs.length >= MAX_FIREBALLS) return false;
    const plaza = WORLD.girders[WORLD.plazaIdx];
    const fire = fireList()[Math.floor(Math.random() * fireList().length)];
    fireballs.push({
      x: fire.x - 2, y: plaza.y - 6,
      r: FIREBALL.r, dir: -1, vy: -3.4,
      onGirder: null, ladder: null, climbingUp: false, state: "rising",
      born: frameCount, dead: false,
    });
    return true;
  }

  function fireballSpeed(f) {
    const blue = (frameCount - f.born) > 480;
    return { blue: blue, walk: blue ? FIREBALL.blueWalk : FIREBALL.walk,
             climb: blue ? FIREBALL.blueClimb : FIREBALL.climb };
  }

  function startClimbFireball(f, l, up) {
    f.ladder = l;
    f.climbingUp = up;
    f.state = "climbing";
    f.x = l.x;
    if (up) f.y = Math.min(f.y, l.bottom - f.r);
    else f.y = Math.max(f.y, l.top - f.r);
  }

  function ladderForFireball(f, g) {
    for (const l of WORLD.ladders) {
      if (Math.abs(f.x - l.x) < f.r + 3 &&
          (Math.abs(g.y - l.top) < 0.5 || Math.abs(g.y - l.bottom) < 0.5)) return l;
    }
    return null;
  }

  function stepFireball(f) {
    const s = fireballSpeed(f);

    // hopping out of the oil can (no collision while emerging)
    if (f.state === "rising") {
      f.vy = Math.min(f.vy + PHYS.gravity, PHYS.maxFall);
      f.y += f.vy;
      const plaza = WORLD.girders[WORLD.plazaIdx];
      if (f.y + f.r >= plaza.y) {
        f.y = plaza.y - f.r; f.vy = 0;
        f.onGirder = plaza; f.state = "patrol";
      }
      return;
    }

    // climbing a ladder
    if (f.state === "climbing") {
      const l = f.ladder;
      f.y += (f.climbingUp ? -1 : 1) * s.climb;
      if (f.climbingUp && f.y <= l.top - f.r) {
        f.y = l.top - f.r;
        f.onGirder = girderAt(l.top);
        f.ladder = null; f.state = "patrol";
        const g = f.onGirder;
        if (g) {
          const n0 = l.x - l.w / 2, n1 = l.x + l.w / 2;
          const roomL = n0 - g.x, roomR = (g.x + g.w) - n1;
          if (roomL >= roomR) f.x = Math.max(g.x + f.r, n0);
          else f.x = Math.min(g.x + g.w - f.r, n1);
        }
      } else if (!f.climbingUp && f.y >= l.bottom - f.r) {
        f.y = l.bottom - f.r;
        f.onGirder = girderAt(l.bottom);
        f.ladder = null; f.state = "patrol";
      }
      return;
    }

    // patrolling a girder
    const g = f.onGirder;
    f.x += f.dir * s.walk;
    // turn around at girder ends (fireballs never walk off)
    if (f.x - f.r < g.x + 2) { f.x = g.x + 2 + f.r; f.dir = 1; }
    else if (f.x + f.r > g.x + g.w - 2) { f.x = g.x + g.w - 2 - f.r; f.dir = -1; }
    // occasional random reversal (arcade wander)
    if (Math.random() < 1 / 130) f.dir = -f.dir;
    // ladder decisions: climb up from a ladder's base, down from its notch
    const l = ladderForFireball(f, g);
    if (l) {
      const canUp = Math.abs(g.y - l.bottom) < 0.5;
      const canDown = Math.abs(g.y - l.top) < 0.5;
      if ((canUp || canDown) && Math.random() < 0.025) {
        if (canUp && canDown) startClimbFireball(f, l, Math.random() < 0.5);
        else if (canUp) startClimbFireball(f, l, true);
        else startClimbFireball(f, l, false);
      }
    }
  }

  function fireHitsPlayer(f) {
    if (f.state === "rising") return false;
    const p = player;
    const dx = Math.abs(f.x - (p.x + p.w / 2));
    const dy = Math.abs(f.y - (p.y + p.h / 2));
    return dx < f.r + p.w / 2 - 2 && dy < f.r + p.h / 2 - 2;
  }

  // Touching an oil-can fire on the plaza is lethal (Screen 3 has several).
  function fireCanHitsPlayer(f) {
    const p = player;
    const dx = Math.abs(f.x - (p.x + p.w / 2));
    const dy = Math.abs((WORLD.girders[WORLD.plazaIdx].y - 7) - (p.y + p.h / 2));
    return dx < 7 + p.w / 2 - 2 && dy < 8 + p.h / 2 - 2;
  }

  function smashFireball(f) {
    f.dead = true;
    addScore((frameCount - f.born) > 480 ? 500 : 300);
    bursts.push({ x: f.x, y: f.y, t: 18 });
    Sound.smash();
    burstParticles(f.x, f.y, "#ffe24a", 7);
  }

  // Barrel solidity for ROLLING: the barrel can hang over a girder's edge by a
  // couple pixels, and a girder with a ramp at its end catches barrels falling
  // onto that end (the cascade) — matching the arcade.
  function barrelSolidAt(g, xl, xr) {
    const cx = (xl + xr) / 2;
    let left = g.x - 2, right = g.x + g.w + 2;
    for (const r of WORLD.ramps) {
      if (WORLD.girders[r.gTop].y === g.y) {
        const bt = rampBottom(r);
        if (r.side === "right") right = Math.max(right, bt.x + 6);
        else left = Math.min(left, bt.x - 6);
      }
    }
    if (cx < left || cx > right) return false;
    for (const l of WORLD.ladders) {
      if (Math.abs(g.y - l.top) < 0.5) {
        const n0 = l.x - l.w / 2, n1 = l.x + l.w / 2;
        if (xl < n1 && xr > n0) return false;
      }
    }
    return !gapSolidBreak(g, xl, xr);
  }

  // Barrel solidity for LANDING: a falling barrel lands if its span overlaps
  // the girder's span at all — so one that tips just past an edge still gets
  // caught by the girder below (the arcade's end-catch). Notches still swallow
  // barrels that overlap them.
  function barrelLandingAt(g, xl, xr) {
    let left = g.x - 1, right = g.x + g.w + 1;
    for (const r of WORLD.ramps) {
      if (WORLD.girders[r.gTop].y === g.y) {
        const bt = rampBottom(r);
        if (r.side === "right") right = Math.max(right, bt.x + 6);
        else left = Math.min(left, bt.x - 6);
      }
    }
    if (xr <= left || xl >= right) return false;
    for (const l of WORLD.ladders) {
      if (Math.abs(g.y - l.top) < 0.5) {
        const n0 = l.x - l.w / 2, n1 = l.x + l.w / 2;
        if (xl < n1 && xr > n0) return false;
      }
    }
    return !gapSolidBreak(g, xl, xr);
  }

  function stepBarrel(b) {
    // riding an elevator platform (Screen 3 — barrels get carried too)
    if (b.rideEv) {
      const ev = b.rideEv;
      b.y = ev.y - b.r;
      b.x += b.dir * b.speed;
      b.rot += b.dir * b.speed * 0.16;
      // rolled off the platform edge → fall again
      if (b.x < ev.x - 2 || b.x > ev.x + ev.w + 2) {
        b.rideEv = null;
        b.onGirder = null;
        b.vy = 0;
      } else if (b.onGirder === null) {
        // platform flush with a girder and the barrel is over its solid span
        // → roll away on the girder
        for (const gg of WORLD.girders) {
          if (Math.abs(ev.y - gg.y) < 0.6 &&
              barrelSolidAt(gg, b.x - b.r + 1, b.x + b.r - 1)) {
            b.onGirder = gg;
            b.rideEv = null;
            break;
          }
        }
      }
      return;
    }

    if (b.ramp) {
      // rolling down a ramp
      const top = rampTop(b.ramp), bot = rampBottom(b.ramp);
      b.x += b.dir * b.speed;
      b.rot += b.dir * b.speed * 0.16;
      b.y = top.y + (bot.y - top.y) * clamp((b.x - top.x) / (bot.x - top.x || 1), 0, 1);
      if ((b.dir > 0 && b.x >= bot.x) || (b.dir < 0 && b.x <= bot.x)) {
        b.x = bot.x; b.y = bot.y;
        b.ramp = null;
        b.onGirder = girderAt(bot.y);
        b.fellFrom = null;
        b.dir = -b.dir; // ramp deflection: barrels reverse direction
      }
      return;
    }

    if (b.onGirder !== null) {
      const g = b.onGirder;
      // on a conveyor belt the belt governs the barrel's motion (Screen 2 zigzag)
      const belt = beltFor(g);
      const eff = belt ? belt.dir : b.dir;
      b.x += eff * b.speed;
      b.rot += eff * b.speed * 0.16;

      // plaza: barrels converge on the nearest oil-can fire
      if (g.y === WORLD.girders[WORLD.plazaIdx].y) {
        if (b.x < 10 && b.dir < 0) b.dir = 1;
        b.x = clamp(b.x, 8, W - 8);
        for (const f of fireList()) {
          if (Math.abs(b.x - f.x) < b.r + 3) { splashBarrel(b); return; }
        }
      }

      // ramp entrance at the girder end
      for (const r of WORLD.ramps) {
        if (WORLD.girders[r.gTop].y === g.y) {
          const top = rampTop(r);
          if ((b.dir > 0 && r.side === "right" && b.x + b.r >= top.x) ||
              (b.dir < 0 && r.side === "left" && b.x - b.r <= top.x)) {
            b.ramp = r; b.y = top.y;
            return;
          }
        }
      }

      // notch / girder end → fall through (ladder gaps)
      const xl = b.x - b.r + 1, xr = b.x + b.r - 1;
      if (!barrelSolidAt(g, xl, xr)) {
        // rolling off a girder END or into a notch → fall (lift clear of the
        // surface; remember which girder we fell from so we can't re-land on it)
        b.y = g.y - b.r - 1.5;
        b.onGirder = null;
        b.vy = 0;
        b.fellFrom = g;
      }
      return;
    }

    // airborne: fall straight down (barrels don't keep rolling in the air —
    // this is what makes them drop cleanly onto the girder below in a cascade)
    b.vy = Math.min(b.vy + PHYS.gravity, PHYS.maxFall);
    b.y += b.vy;

    const prevBottom = b.y + b.r - b.vy;
    const bottom = b.y + b.r;
    const xl = b.x - b.r + 1, xr = b.x + b.r - 1;
    let landed = false;
    for (const gg of WORLD.girders) {
      if (gg === b.fellFrom) continue;
      if (gg.y >= prevBottom && gg.y <= bottom && barrelLandingAt(gg, xl, xr)) {
        b.y = gg.y - b.r; b.vy = 0;
        b.onGirder = gg;
        b.fellFrom = null;
        // a barrel caught just past the edge is nudged back onto the girder
        if (b.x < gg.x) b.x = gg.x;
        else if (b.x > gg.x + gg.w) b.x = gg.x + gg.w;
        landed = true;
        break;
      }
    }
    // …or onto an elevator platform (Screen 3)
    if (!landed && WORLD.elevators) {
      for (const ev of WORLD.elevators) {
        if (b.x > ev.x - 3 && b.x < ev.x + ev.w + 3 &&
            ev.y >= prevBottom && ev.y <= bottom) {
          b.y = ev.y - b.r; b.vy = 0;
          b.rideEv = ev; b.onGirder = null; b.fellFrom = null;
          break;
        }
      }
    }

    if (b.y > H + 20) b.splashed = true;
  }

  function barrelHitsPlayer(b) {
    const p = player;
    const dx = Math.abs(b.x - (p.x + p.w / 2));
    const dy = Math.abs(b.y - (p.y + p.h / 2));
    return dx < b.r + p.w / 2 - 2 && dy < b.r + p.h / 2 - 2;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function approach(v, target, amt) {
    if (v < target) return Math.min(target, v + amt);
    if (v > target) return Math.max(target, v - amt);
    return v;
  }
  function dirX() { return (Input.isDown("right") ? 1 : 0) - (Input.isDown("left") ? 1 : 0); }

  function girderAt(y) {
    for (const g of WORLD.girders) if (Math.abs(g.y - y) < 0.5) return g;
    return null;
  }

  // Open vertical gaps in the girders (Screen 3 elevator shafts). The plaza
  // stays solid — gaps only split the raised girders.
  function gapSolidBreak(g, xl, xr) {
    if (!WORLD.gaps) return false;
    if (g === WORLD.girders[WORLD.plazaIdx]) return false;
    for (const gp of WORLD.gaps) {
      const n0 = gp.x - gp.w / 2, n1 = gp.x + gp.w / 2;
      if (xl < n1 && xr > n0) return true;
    }
    return false;
  }

  // Is the x-range [xl,xr] solid on girder g? (false inside the girder's span
  // or inside a ladder notch — "hole detection")
  function girderSolidAt(g, xl, xr) {
    if (xl < g.x + 1 || xr > g.x + g.w - 1) return false;
    for (const l of WORLD.ladders) {
      if (Math.abs(g.y - l.top) < 0.5) {
        const n0 = l.x - l.w / 2, n1 = l.x + l.w / 2;
        if (xl < n1 && xr > n0) return false;
      }
    }
    return !gapSolidBreak(g, xl, xr);
  }

  // The girder whose top surface the player's feet rest on, or null.
  function standingGirder(p) {
    const xl = p.x + 2, xr = p.x + p.w - 2;
    for (const g of WORLD.girders) {
      if (Math.abs(p.y + p.h - g.y) < 0.6 && girderSolidAt(g, xl, xr)) return g;
    }
    return null;
  }

  function ladderAtCenter(p) {
    const cx = p.x + p.w / 2;
    const feet = p.y + p.h;
    for (const l of WORLD.ladders) {
      if (cx < l.x - l.w / 2 || cx > l.x + l.w / 2) continue;
      // only ladders the player can actually be at: feet on the ladder's
      // notch girder (top) or base girder (bottom), or passing it while falling
      if (feet >= l.top - 2 && feet <= l.bottom + 2) return l;
    }
    return null;
  }

  // The elevator platform the player's feet are currently on, if any
  // (Screen 3 — elevators bridge the ladder-notch gaps in the shafts).
  function elevatorUnder(p) {
    if (!WORLD.elevators) return null;
    const feet = p.y + p.h;
    const cx = p.x + p.w / 2;
    for (const ev of WORLD.elevators) {
      if (Math.abs(feet - ev.y) < 1.5 &&
          cx > ev.x - p.w * 0.5 + 1 && cx < ev.x + ev.w + p.w * 0.5 - 1) {
        return ev;
      }
    }
    return null;
  }

  const SPAWN = { x: 40, y: 224 - 17 };

  function makePlayer() {
    const p = {
      x: SPAWN.x, y: SPAWN.y, w: 16, h: 17,
      vx: 0, vy: 0, state: "IDLE", facing: 1,
      ladder: null, timer: 0, rot: 0, hammerT: 0,
      score: 0, lives: 3,
    };
    p.die = function () {
      if (this.state === "DYING") return;
      this.state = "DYING"; this.timer = 90;
      this.vy = -2.4; this.vx = this.facing * 1.6; this.rot = 0;
      Sound.death();
      burstParticles(this.x + this.w / 2, this.y + this.h / 2, "#e03a3a", 10);
    };
    return p;
  }
  // Two players (arcade alternating mode — only one is on screen at a time).
  // `player` always points at the ACTIVE one; P1 = arrows+SPACE, P2 = WASD+X.
  const players = [makePlayer(), makePlayer()];
  let activeIdx = 0;
  let currentPlayerNum = 1;
  let gameMode = 1; // 1P or 2P (chosen on the title screen)
  let player = players[0];

  function switchTo(i) {
    activeIdx = i;
    player = players[i];
    currentPlayerNum = i + 1;
  }

  function respawn() {
    player.x = SPAWN.x; player.y = SPAWN.y;
    player.vx = 0; player.vy = 0; player.rot = 0;
    player.state = "IDLE"; player.ladder = null; player.timer = 0;
    player.facing = 1;
    player.hammerT = 0;
  }

  function startClimb(p, l) {
    p.ladder = l;
    p.state = "CLIMBING";
    p.vx = 0; p.vy = 0;
    p.x = l.x - p.w / 2;
    const feet = clamp(p.y + p.h, l.top, l.bottom);
    p.y = feet - p.h;
  }

  function stepClimbing(p) {
    const l = p.ladder;
    const d = (Input.isDown("up") ? -1 : 0) + (Input.isDown("down") ? 1 : 0);
    if (d !== 0) {
      p.y += d * PHYS.climbSpeed;
      if (p.y <= l.top - p.h) {
        // reached the top girder → step off, nudging out of the notch
        p.y = l.top - p.h;
        const g = girderAt(l.top);
        if (g && !girderSolidAt(g, p.x + 2, p.x + p.w - 2)) {
          const n0 = l.x - l.w / 2, n1 = l.x + l.w / 2;
          const roomLeft = n0 - g.x, roomRight = (g.x + g.w) - n1;
          if (roomLeft >= roomRight) p.x = Math.max(g.x, n0 - p.w);
          else p.x = Math.min(g.x + g.w - p.w, n1);
        }
        p.ladder = null; p.vy = 0; p.state = "IDLE";
      } else if (p.y >= l.bottom - p.h) {
        p.y = l.bottom - p.h;
        p.ladder = null; p.vy = 0; p.state = "IDLE";
      }
    }
    if (Input.pressed.jump) {
      p.ladder = null;
      p.state = "JUMPING";
      p.vy = PHYS.jumpV * 0.75;
      p.vx = dirX() * PHYS.walkSpeed;
      Sound.jump();
    }
  }

  function stepPlayer() {
    const p = player;

    if (p.state === "DYING") {
      p.timer--;
      p.vy = Math.min(p.vy + PHYS.gravity, PHYS.maxFall);
      p.x += p.vx; p.y += p.vy; p.rot += 0.22;
      if (p.timer <= 0) handleDeath();
      return;
    }

    if (p.hammerT > 0) p.hammerT--;

    if (p.state === "CLIMBING") { stepClimbing(p); return; }

    let g = standingGirder(p);
    let ev = elevatorUnder(p);

    // riding an elevator platform (no girder under the feet): pinned to the
    // platform while it moves, free to walk/jump/climb off
    if (ev && !g && (p.state === "IDLE" || p.state === "WALKING")) {
      p.y = ev.y - p.h;
      p.vy = 0;
      // climb a ladder whose base sits at this level
      const ladder = ladderAtCenter(p);
      if (ladder && Input.isDown("up") && Math.abs(p.y + p.h - ladder.bottom) < 1.2) {
        startClimb(p, ladder);
        return;
      }
      const move = dirX();
      if (move) p.vx = approach(p.vx, move * PHYS.walkSpeed, PHYS.accel);
      else p.vx *= PHYS.friction;
      if (Math.abs(p.vx) < 0.02) p.vx = 0;
      p.x += p.vx;
      p.x = clamp(p.x, 0, W - p.w);
      if (move) p.facing = move;
      if (Input.pressed.jump) { p.state = "JUMPING"; p.vy = PHYS.jumpV; Sound.jump(); }
      else p.state = (Math.abs(p.vx) > 0.05) ? "WALKING" : "IDLE";
      return;
    }

    // ladder interactions from the ground
    if (g) {
      const ladder = ladderAtCenter(p);
      if (ladder) {
        // climb up: standing on the ladder's lower (solid) girder
        if (Input.isDown("up") && Math.abs(g.y - ladder.bottom) < 0.6) { startClimb(p, ladder); return; }
        // climb down: standing in the ladder's top notch
        const inNotch = !girderSolidAt(g, ladder.x - ladder.w / 2 + 1, ladder.x + ladder.w / 2 - 1);
        if (inNotch && Input.isDown("down") && Math.abs(g.y - ladder.top) < 0.6) { startClimb(p, ladder); return; }
        // hole detection: standing in a notch without pressing down → fall through
        if (inNotch && Math.abs(g.y - ladder.top) < 0.6) g = null;
      }
    }

    // horizontal movement (accel on ground, air control while airborne)
    const move = dirX();
    if (g) {
      if (move) p.vx = approach(p.vx, move * PHYS.walkSpeed, PHYS.accel);
      else p.vx *= PHYS.friction;
    } else {
      p.vx = approach(p.vx, move * PHYS.walkSpeed, PHYS.airAccel);
    }
    if (Math.abs(p.vx) < 0.02) p.vx = 0;
    p.x += p.vx;
    p.x = clamp(p.x, 0, W - p.w);
    if (move) p.facing = move;

    // conveyor belts carry the player while standing on them
    if (g) {
      const belt = beltFor(g);
      if (belt) p.x += belt.dir * BELT_SPEED;
      p.x = clamp(p.x, 0, W - p.w);
    }

    // re-evaluate ground after moving
    g = standingGirder(p);

    // ramps block walking past the girder end they attach to
    if (g) {
      for (const r of WORLD.ramps) {
        if (g.y === WORLD.girders[r.gTop].y) {
          const gt = WORLD.girders[r.gTop];
          if (r.side === "right") p.x = Math.min(p.x, gt.x + gt.w - p.w - 1);
          else p.x = Math.max(p.x, gt.x + 1);
        }
      }
    }

    // jump
    if (g && Input.pressed.jump) { p.state = "JUMPING"; p.vy = PHYS.jumpV; Sound.jump(); }

    if (!g && p.state !== "JUMPING") p.state = "FALLING";

    // gravity & vertical motion
    if (p.state === "JUMPING" || p.state === "FALLING") {
      // variable jump height: releasing jump early cuts the rise
      if (p.state === "JUMPING" && !Input.isDown("jump") && p.vy < PHYS.jumpCutV) p.vy = PHYS.jumpCutV;
      const prevFeet = p.y + p.h;
      p.vy = Math.min(p.vy + PHYS.gravity, PHYS.maxFall);
      p.y += p.vy;

      // landing (feet-crossing detection)
      const xl = p.x + 2, xr = p.x + p.w - 2;
      let landed = false;
      for (const gg of WORLD.girders) {
        if (gg.y >= prevFeet && gg.y <= p.y + p.h && girderSolidAt(gg, xl, xr)) {
          p.y = gg.y - p.h; p.vy = 0;
          p.state = (Math.abs(p.vx) > 0.05) ? "WALKING" : "IDLE";
          landed = true;
          break;
        }
      }
      // …or onto an elevator platform (Screen 3)
      if (!landed && WORLD.elevators) {
        const cx = p.x + p.w / 2;
        for (const ev of WORLD.elevators) {
          if (cx > ev.x - 3 && cx < ev.x + ev.w + 3 &&
              ev.y >= prevFeet && ev.y <= p.y + p.h) {
            p.y = ev.y - p.h; p.vy = 0;
            p.state = (Math.abs(p.vx) > 0.05) ? "WALKING" : "IDLE";
            break;
          }
        }
      }

      // ladder edge grab while falling: press up/down as you pass a ladder top
      if (p.vy >= 0 && p.ladder === null && (Input.isDown("down") || Input.isDown("up"))) {
        const l = ladderAtCenter(p);
        if (l && p.y + p.h >= l.top - 2 && p.y + p.h <= l.top + 18) {
          startClimb(p, l);
          return;
        }
      }
    }

    // walk ↔ idle on the ground
    if (g && (p.state === "IDLE" || p.state === "WALKING")) {
      p.state = (Math.abs(p.vx) > 0.05) ? "WALKING" : "IDLE";
    }

    if (p.y > H + 24) respawn();
  }

  function stepGame() {
    frameCount++;
    BGM.tick();
    if (shake > 0) shake = Math.max(0, shake - 0.35);

    // overlay states (LEVEL CLEAR / GAME OVER / VICTORY) pause the sim
    if (state === "over" || state === "clear" || state === "victory") {
      overlayTimer--;
      if (overlayTimer <= 0) {
        if (state === "victory" || state === "over") {
          // back to the title menu for a fresh game
          state = "title";
          titleSel = 0; titleHelp = false;
        } else if (screenNum === 4) {
          // clearing the rivets stage beats the game
          BGM.stop();
          state = "victory"; overlayTimer = 260;
        } else {
          advanceScreen();
          state = "game";
        }
      }
      return;
    }

    // collapse animation (Screen 4): the platforms fall away one by one, top
    // first, then the LEVEL CLEAR plays
    if (state === "collapse") {
      collapse.t++;
      const gs = WORLD.girders;
      for (let i = 0; i < gs.length - 1; i++) {
        if (collapse.t > 20 + i * 26) {
          if (collapse.fall[i] === null) collapse.fall[i] = 0;
          collapse.fall[i] += 2 + i * 0.12;
          if (collapse.fall[i] > 400) collapse.fall[i] = 400;
        }
      }
      if (collapse.t > 20 + (gs.length - 2) * 26 + 170) {
        collapse = null;
        triggerLevelClear();
      }
      return;
    }

    stepPlayer();

    // soft step ticks while the active player walks
    if (player.state === "WALKING" && frameCount % 9 === 0) Sound.walk();

    // elevator platforms move (Screen 3)
    if (WORLD.elevators) {
      for (const ev of WORLD.elevators) {
        ev.t = (ev.t + 1) % ev.period;
        const u = ev.t / ev.period;
        const p = u < 0.5 ? u * 2 : 2 - 2 * u;
        ev.y = ev.yTop + (ev.yBot - ev.yTop) * p;
      }
    }

    // barrel spawner (chute at top-left)
    if (spawnTimer <= 0) {
      spawnTimer = (WORLD.barrelEvery || 95) + Math.floor(Math.random() * 25);
      spawnBarrel();
    } else {
      spawnTimer--;
    }

    // barrels
    for (const b of barrels) stepBarrel(b);

    // fireball spawner (oil cans at bottom-right)
    if (fireSpawnTimer <= 0) {
      fireSpawnTimer = (WORLD.fireEvery || 300) + Math.floor(Math.random() * 120);
      spawnFireball();
    } else {
      fireSpawnTimer--;
    }

    // fireballs
    for (const f of fireballs) stepFireball(f);

    // jump scoring: hopping over a barrel awards 100 pts (once per barrel)
    if (player.state === "JUMPING" || player.state === "FALLING") {
      for (const b of barrels) {
        if (!b.jumpScored && !b.splashed) {
          const dx = Math.abs(b.x - (player.x + player.w / 2));
          const dy = Math.abs(b.y - (player.y + player.h / 2));
          if (dx < 12 && dy < 26) { b.jumpScored = true; addScore(100); }
        }
      }
    }

    // barrel ↔ player: hammer smashes, otherwise lethal
    if (player.state !== "DYING") {
      for (const b of barrels) {
        if (!b.splashed && barrelHitsPlayer(b)) {
          if (player.hammerT > 0) smashBarrel(b);
          else player.die();
          break;
        }
      }
      // fireball ↔ player: hammer smashes, otherwise lethal
      for (const f of fireballs) {
        if (!f.dead && fireHitsPlayer(f)) {
          if (player.hammerT > 0) smashFireball(f);
          else { player.die(); break; }
        }
      }
      // oil-can fires are lethal
      for (const f of fireList()) {
        if (fireCanHitsPlayer(f)) { player.die(); break; }
      }
    }

    // collectibles (hat / handbag / parasol)
    for (const it of ITEMS) {
      if (it.taken) {
        it.timer--;
        if (it.timer <= 0) it.taken = false;
      } else if (player.state !== "DYING") {
        const gy = WORLD.girders[it.g].y;
        if (rectsOverlap(player.x, player.y, player.w, player.h,
            it.x - 4, gy - 10, 8, 10)) {
          it.taken = true; it.timer = 480;
          addScore(it.pts);
        }
      }
    }

    // hammer power-up cycle + pickup
    if (!hammer.active) {
      hammer.spawnTimer--;
      if (hammer.spawnTimer <= 0) {
        const s = HAMMER_SPOTS[Math.floor(Math.random() * HAMMER_SPOTS.length)];
        hammer.active = true;
        hammer.g = s.g; hammer.x = s.x;
        hammer.y = WORLD.girders[s.g].y - 6;
        hammer.life = 300;
      }
    } else {
      hammer.life--;
      if (hammer.life <= 0) {
        hammer.active = false;
        hammer.spawnTimer = 900 + Math.floor(Math.random() * 300);
      } else if (player.state !== "DYING" &&
          rectsOverlap(player.x, player.y, player.w, player.h,
            hammer.x - 4, hammer.y, 8, 6)) {
        hammer.active = false;
        hammer.spawnTimer = 900 + Math.floor(Math.random() * 300);
        player.hammerT = 480;
        addScore(100);
      }
    }

    // win condition: reach Pauline on the top girder (not the rivets stage)
    if (!WORLD.rivetsWin && WORLD.pauline && player.state !== "DYING" &&
        rectsOverlap(player.x, player.y, player.w, player.h,
          WORLD.pauline.x, WORLD.pauline.y, 10, 15)) {
      triggerLevelClear();
    }

    // rivets (Screen 4): stepping on one pops it; removing the last one
    // brings the whole structure down
    if (WORLD.rivets && player.state !== "DYING") {
      for (const r of WORLD.rivets) {
        if (!r.active) continue;
        const gy = WORLD.girders[r.g].y;
        if (rectsOverlap(player.x, player.y, player.w, player.h,
            r.x - 3, gy - 3, 6, 3)) {
          r.active = false;
          addScore(100);
          bursts.push({ x: r.x, y: gy - 3, t: 18 });
          Sound.rivet();
          burstParticles(r.x, gy - 3, "#d8e6f2", 6);
        }
      }
      if (rivetsLeft() === 0) triggerCollapse();
    }

    // cleanup
    for (let i = barrels.length - 1; i >= 0; i--) {
      if (barrels[i].splashed) barrels.splice(i, 1);
    }
    for (let i = fireballs.length - 1; i >= 0; i--) {
      if (fireballs[i].dead) fireballs.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      sparks[i].t--;
      if (sparks[i].t <= 0) sparks.splice(i, 1);
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      bursts[i].t--;
      if (bursts[i].t <= 0) bursts.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.08; pt.t--;
      if (pt.t <= 0) particles.splice(i, 1);
    }
  }

  // ── Rendering (game state) ───────────────────────────────────
  function drawRamp(r) {
    const top = rampTop(r), bot = rampBottom(r);
    ctx.strokeStyle = COLORS.girder;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(top.x, top.y + 2);
    ctx.lineTo(bot.x, bot.y - 1);
    ctx.stroke();
    ctx.strokeStyle = COLORS.girderDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y + 4);
    ctx.lineTo(bot.x, bot.y + 1);
    ctx.stroke();
    ctx.lineCap = "butt";
    // rivets along the slope
    ctx.fillStyle = COLORS.rivet;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      ctx.fillRect(top.x + (bot.x - top.x) * t - 1, top.y + (bot.y - top.y) * t - 1, 2, 2);
    }
  }

  function drawChute() {
    const ch = WORLD.chute;
    const top = WORLD.girders[0].y;
    ctx.fillStyle = COLORS.girderDark;
    ctx.fillRect(ch.x - 10, top - 14, 20, 3);
    ctx.fillRect(ch.x - 6, top - 11, 12, 3);
    // chute lip where barrels roll out
    ctx.fillStyle = COLORS.girder;
    ctx.fillRect(ch.x - 4, top - 8, 8, 3);
    // a queued barrel waiting in the chute
    drawBarrel(ch.x - 5, top - 7, 5, 0);
  }

  function drawFires(now) {
    const plaza = WORLD.girders[WORLD.plazaIdx].y;
    for (const fire of fireList()) {
      const ox = fire.x;
      drawBarrel(ox + 2, plaza - 7, 7, 0);
      // animated flame
      const f = Math.sin(now / 55 + ox * 0.05) * 1.6 + Math.sin(now / 23 + ox * 0.03) * 0.8;
      ctx.fillStyle = COLORS.fireDark;
      ctx.beginPath();
      ctx.moveTo(ox - 2, plaza - 6);
      ctx.quadraticCurveTo(ox - 2, plaza - 18 - f, ox + 2, plaza - 22 - f);
      ctx.quadraticCurveTo(ox + 5, plaza - 14, ox + 4, plaza - 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = COLORS.fireCore;
      ctx.beginPath();
      ctx.moveTo(ox, plaza - 6);
      ctx.quadraticCurveTo(ox, plaza - 13 - f, ox + 2, plaza - 16 - f);
      ctx.quadraticCurveTo(ox + 4, plaza - 10, ox + 3, plaza - 6);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawElevators() {
    if (!WORLD.elevators) return;
    const topY = WORLD.girders[0].y;
    for (const ev of WORLD.elevators) {
      const pink = ev.color === "pink";
      // cables from the top girder down to the platform
      ctx.strokeStyle = pink ? "#ff9dc2" : "#6fd0ff";
      ctx.lineWidth = 2;
      for (const cx of [ev.x + 3, ev.x + ev.w - 3]) {
        ctx.beginPath();
        ctx.moveTo(cx, topY + 6);
        ctx.lineTo(cx, ev.y - 10);
        ctx.stroke();
      }
      // frame above the platform
      ctx.fillStyle = pink ? "#ff7fa8" : "#8fd7ff";
      ctx.fillRect(ev.x - 1, ev.y - 10, ev.w + 2, 3);
      ctx.fillRect(ev.x, ev.y - 10, 2, 10);
      ctx.fillRect(ev.x + ev.w - 2, ev.y - 10, 2, 10);
      // the platform surface
      ctx.fillStyle = pink ? "#ff9dc2" : "#5cc6f2";
      ctx.fillRect(ev.x, ev.y - 2, ev.w, 3);
      ctx.fillStyle = pink ? "#c74d77" : "#0b7aa0";
      ctx.fillRect(ev.x, ev.y + 1, ev.w, 1);
      ctx.fillStyle = COLORS.rivet;
      ctx.fillRect(ev.x + 2, ev.y - 1, 1, 1);
      ctx.fillRect(ev.x + ev.w - 3, ev.y - 1, 1, 1);
    }
  }

  function drawBelt(sx, gy, sw, belt) {
    const h = 4;
    ctx.fillStyle = "#6b4423";
    ctx.fillRect(sx, gy, sw, h);
    ctx.fillStyle = "#3f260f";
    ctx.fillRect(sx, gy + h - 1, sw, 1);
    // end rollers
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(sx, gy, 2, h);
    ctx.fillRect(sx + sw - 2, gy, 2, h);
    // animated diagonal stripes (slant shows the direction of travel)
    const step = 6;
    const off = (sx + frameCount * 0.6) % step;
    const slant = belt.dir > 0 ? 3 : -3;
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    for (let x = sx - step + off; x < sx + sw + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + 2, gy);
      ctx.lineTo(x + 2 + slant, gy + h);
      ctx.lineTo(x + slant, gy + h);
      ctx.closePath();
      ctx.fill();
    }
    // rivets along the lower edge
    ctx.fillStyle = COLORS.rivet;
    for (let rx = sx + 4; rx < sx + sw - 4; rx += 8) {
      ctx.beginPath();
      ctx.arc(rx + 1, gy + h - 1, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A rivet head bolted to the top of a girder (Screen 4).
  function drawRivet(x, gy) {
    ctx.fillStyle = "#5c86a0";
    ctx.fillRect(x - 4, gy - 1, 8, 2);
    ctx.fillStyle = "#d8e6f2";
    ctx.fillRect(x - 3, gy - 3, 6, 3);
    ctx.fillStyle = "#8fd7ff";
    ctx.fillRect(x - 1, gy - 4, 2, 1);
  }

  function drawScreen(now) {
    // collapse mode (Screen 4): the structure falls away, DK rides the top
    if (collapse) {
      for (let i = 0; i < WORLD.girders.length; i++) {
        const g = WORLD.girders[i];
        const off = (i < WORLD.girders.length - 1 && collapse.fall[i] !== null) ? collapse.fall[i] : 0;
        if (g.y + off < H + 40) drawGirder(g.x, g.y + off, g.w);
      }
      const topOff = collapse.fall[0] || 0;
      drawSpriteMap(DK, WORLD.dk.x, WORLD.dk.y + topOff, { scale: 2 });
      if (WORLD.pauline) drawSpriteMap(PAULINE, WORLD.pauline.x, WORLD.pauline.y + topOff);
      drawPlayer();
      return;
    }

    // girders (split at ladder notches), then belt overlays on the segments
    const segments = [];
    for (const g of WORLD.girders) {
      let x = g.x;
      const notches = [];
      for (const l of WORLD.ladders) {
        if (Math.abs(g.y - l.top) < 0.5) {
          notches.push([l.x - l.w / 2 - 2, l.x + l.w / 2 + 2]);
        }
      }
      if (WORLD.gaps) {
        for (const gp of WORLD.gaps) {
          notches.push([gp.x - gp.w / 2 - 2, gp.x + gp.w / 2 + 2]);
        }
      }
      notches.sort(function (a, b) { return a[0] - b[0]; });
      for (const [n0, n1] of notches) {
        if (n0 > x) segments.push([g, x, n0 - x]);
        x = Math.max(x, n1);
      }
      if (x < g.x + g.w) segments.push([g, x, g.x + g.w - x]);
    }
    for (const [g, sx, sw] of segments) drawGirder(sx, g.y, sw);
    for (const [g, sx, sw] of segments) {
      const belt = beltFor(g);
      if (belt) drawBelt(sx, g.y, sw, belt);
    }
    for (const l of WORLD.ladders) drawLadder(l);
    for (const r of WORLD.ramps) drawRamp(r);
    drawElevators();
    drawChute();
    drawFires(now);
    drawSpriteMap(DK, WORLD.dk.x, WORLD.dk.y, { scale: 2 });
    if (WORLD.pauline) drawSpriteMap(PAULINE, WORLD.pauline.x, WORLD.pauline.y);
    // collectibles resting on their girders
    for (const it of ITEMS) {
      if (it.taken) continue;
      const gy = WORLD.girders[it.g].y;
      const w = it.map.rows[0].length, h = it.map.rows.length;
      drawSpriteMap(it.map, it.x - Math.floor(w / 2), gy - h);
    }
    // rivets holding the structure together (Screen 4)
    if (WORLD.rivets) {
      for (const r of WORLD.rivets) {
        if (!r.active) continue;
        drawRivet(r.x, WORLD.girders[r.g].y);
      }
    }
    // hammer power-up
    if (hammer.active) drawSpriteMap(HAMMER_ICON, hammer.x - 3, hammer.y);
    for (const b of barrels) drawBarrel(b.x, b.y, b.r, b.rot);
    // fireballs (red → blue after ~8s)
    for (const f of fireballs) {
      drawFireball(f.x, f.y, f.r, (frameCount - f.born) > 480);
    }
    // smash bursts
    for (const br of bursts) {
      ctx.strokeStyle = "rgba(255,255,255," + (br.t / 18) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(br.x, br.y, (18 - br.t) * 1.2 + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    // splash sparks
    for (const s of sparks) {
      ctx.strokeStyle = "rgba(255,140,26," + (s.t / 30) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3 + (30 - s.t) * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // debris particles (rivet pops, smashes, death)
    for (const pt of particles) {
      ctx.globalAlpha = Math.min(1, pt.t / 10);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 2, 2);
    }
    ctx.globalAlpha = 1;
    drawPlayer();
  }

  function drawPlayer() {
    const p = player;
    ctx.save();
    if (p.state === "DYING") {
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate(p.rot);
      ctx.translate(-(p.x + p.w / 2), -(p.y + p.h / 2));
      ctx.scale(1, -1);
    }
    drawSpriteMap(MARIO, p.x, p.y, { flip: p.facing < 0 });
    ctx.restore();

    // swinging hammer during HAMMER_MODE
    if (p.hammerT > 0) {
      const sw = Math.sin(frameCount * 0.35) * 0.9;
      ctx.save();
      ctx.translate(p.x + p.w / 2 + p.facing * 8, p.y + 5);
      ctx.scale(p.facing, 1);
      ctx.rotate(sw);
      ctx.fillStyle = COLORS.barrelDark;
      ctx.fillRect(0, -1.5, 8, 3);
      ctx.fillStyle = "#c9d2de";
      ctx.fillRect(7, -3.5, 5, 7);
      ctx.fillStyle = "#6a7480";
      ctx.fillRect(7, 3, 5, 1);
      ctx.restore();
    }
  }

  function renderGame(now) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // screen shake (rivet collapse rumble)
    ctx.save();
    if (shake > 0.5) ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake));
    drawScreen(now);
    ctx.restore();

    // ── Score bar (top) ──
    ctx.fillStyle = "#0a1030";
    ctx.fillRect(0, 0, W, 16);
    ctx.font = "7px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("1UP", 8, 7);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(String(players[0].score).padStart(6, "0"), 8, 15);
    if (gameMode === 2) {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText("2UP", 8, 22);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(String(players[1].score).padStart(6, "0"), 8, 30);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.fireCore;
    ctx.fillText("HIGH SCORE", W / 2, 7);
    ctx.fillText(String(hiScore).padStart(6, "0"), W / 2, 15);
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("LIVES", W - 8, 7);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText((gameMode === 2 ? "P" + currentPlayerNum + " " : "") + player.lives + "x", W - 8, 15);

    // ── debug readout (bottom) ──
    ctx.font = "7px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.hud;
    ctx.fillText("P" + currentPlayerNum + " " + player.state.toLowerCase() +
      (player.hammerT > 0 ? " · HAMMER " + Math.ceil(player.hammerT / 60) + "s" : ""),
      8, 238);
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.fireCore;
    ctx.fillText("(" + Math.round(player.x) + "," + Math.round(player.y) + ")" +
      " · barrels " + barrels.length + " · fire " + fireballs.length + " · S" + screenNum, W - 8, 238);
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("←→ walk · SPACE jump · ↑↓ climb · M mute", W / 2, 251);

    // ── overlay banners ──
    if (state === "clear" || state === "over" || state === "victory") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 62, W, 124);
      ctx.font = "13px 'Arial Black', Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = (state === "clear") ? "#5fd65f" : (state === "victory") ? "#ffd24a" : "#ff4b3a";
      ctx.fillText(state === "clear" ? "LEVEL CLEAR!" : state === "victory" ? "CONGRATULATIONS!" : "GAME OVER", W / 2, 112);
      ctx.font = "7px ui-monospace, monospace";
      ctx.fillStyle = COLORS.ink;
      const clearMsg = screenNum === 4 ? "STRUCTURE COLLAPSED +5000" : "YOU RESCUED PAULINE  +5000";
      ctx.fillText(state === "clear" ? clearMsg : state === "victory" ? "YOU BEAT DONKEY KONG!" : "INSERT COIN - BACK TO TITLE", W / 2, 132);
    }
  }

  // ── Main loop (fixed 60 Hz timestep, render on each tick) ────
  // rAF is primary, but rAF freezes entirely in hidden/throttled tabs, so a
  // fallback pump (setInterval) keeps frames flowing while document is hidden,
  // and we draw the very first frame synchronously so the canvas is never blank.
  let frame = 0;
  let lastTick = 0;
  let acc = 0;
  let lastNow = performance.now();
  window.__frameCount = 0;
  function loop(now) {
    window.__frameCount++;
    lastTick = now;
    try {
      frame++;
      if (frame % 60 === 0) console.log("Frame Rendered");

      // loading → title (the arcade splash), then the player starts the game
      if (state === "loading" && test !== "loading") {
        const t = now - loadStart;
        if (t > LOAD_DURATION || Input.pressed.start || Input.pressed.jump) state = "title";
      }

      let dt = (now - lastNow) / 1000;
      lastNow = now;
      if (dt > 1) dt = 1;      // clamp catch-up
      if (dt < 0) dt = 0;
      acc += dt;

      if (state === "loading") {
        renderLoading(now);
      } else if (state === "title") {
        stepTitle();
        renderTitle(now);
      } else {
        let guard = 0;
        while (acc >= STEP && guard < 240) { stepGame(); acc -= STEP; guard++; }
        renderGame(now);
      }

      // clear edge-triggered inputs at end of frame
      for (const k in Input.pressed) Input.pressed[k] = false;
    } catch (err) {
      console.error("game loop error:", err && err.stack ? err.stack : err);
    }
    requestAnimationFrame(loop);
  }
  loop(performance.now());
  setInterval(function () {
    if (performance.now() - lastTick > 250) loop(performance.now());
  }, 120);

  // ── Public API for the agent / later phases ──────────────────
  function setKeys(actions) {
    for (const k in Input.keys) Input.keys[k] = false;
    for (const k in Input.pressed) Input.pressed[k] = false;
    for (const a in actions) if (actions[a]) Input.keys[a] = true;
  }

  window.Game = {
    CONFIG: CONFIG,
    PHYS: PHYS,
    STEP: STEP,
    get WORLD() { return WORLD; },
    Input: Input,
    canvas: canvas,
    ctx: ctx,
    W: W, H: H,
    get player() { return player; },
    barrels: barrels,
    fireballs: fireballs,
    get items() { return ITEMS; },
    get screenNum() { return screenNum; },
    hammer: hammer,
    bursts: bursts,
    get score() { return player.score; },
    get lives() { return player.lives; },
    get hiScore() { return hiScore; },
    get players() { return players; },
    get gameMode() { return gameMode; },
    get currentPlayerNum() { return currentPlayerNum; },
    get titleSel() { return titleSel; },
    get titleHelp() { return titleHelp; },
    addScore: addScore,
    setKeys: setKeys,
    step: stepGame,
    respawn: respawn,
    spawnBarrel: spawnBarrel,
    spawnFireball: spawnFireball,
    smashFireball: smashFireball,
    goToScreen: goToScreen,
    advanceScreen: advanceScreen,
    clearBarrels: function () { barrels.length = 0; spawnTimer = 90; sparks.length = 0; },
    clearFireballs: function () { fireballs.length = 0; fireSpawnTimer = 300; },
    resetScreen: resetScreen,
    resetItems: resetItems,
    die: function () { player.die(); },
    handleDeath: handleDeath,
    triggerLevelClear: triggerLevelClear,
    triggerCollapse: triggerCollapse,
    startGame: startGame,
    switchTo: switchTo,
    get collapse() { return collapse; },
    get rivets() { return WORLD.rivets; },
    get rivetsLeft() { return rivetsLeft(); },
    Sound: Sound,
    BGM: BGM,
    get state() { return state; },
    setState: function (s) { state = s; },
    restartLoading: function () { loadStart = performance.now(); state = "loading"; },
  };
})();
