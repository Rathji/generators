// src/engine.js — game shell (Phase 1-3) + Ghosts & AI (Phase 4).
// Fixed-timestep loop + state machine (title/ready/playing/dying/pause/gameover).
// Phase 4: four named ghosts with the classic intersection AI (scatter/chase
// targets, no-reversal rule, dead-end reversal, tunnel straight-through),
// scatter/chase schedule with level-based durations, frightened mode with
// eat-ghost combos, eyes return + house re-entry, ghost-house release timers,
// one-way door, and Elroy speed-ups.

import { Maze, TILE, COLS, ARENA_W, ARENA_H } from "./maze.js";
import { FruitSlot } from "./fruit.js";
import { GameAudio } from "./audio.js";

const STEP = 1 / 60;
const DEATH_TIME = 1.6;
const DOOR_TILE = [14, 12];

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const REV = { up: "down", down: "up", left: "right", right: "left" };

// 1980 speed model (Pac-Man Dossier): all speeds are percentages of this
// "normal" speed. Pac: L1 80% / L2-4 90% / L5-20 100% / L21+ 90%; ghosts
// 75/85/95/95%; frightened pac 90/95/100%; frightened ghosts 50/55/60%;
// tunnel ghosts 40/45/50%; eyes 160%; Elroy 85/95%. Pac-Man also stops for
// 1 frame per dot (3 per power pellet), slowing him ~10% while eating.
const NORMAL = 8.4 * TILE;

const GHOST_DEFS = [
  { name: "blinky", color: "#ff2020", scatter: [25, 0] },
  { name: "pinky", color: "#ffb8ff", scatter: [2, 0] },
  { name: "inky", color: "#00ffff", scatter: [25, 30] },
  { name: "clyde", color: "#ffb852", scatter: [2, 30] }
];

export class Game {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.stage = opts.stage;
    this.scoreEl = opts.scoreEl;
    this.highScoreEl = opts.highScoreEl;
    this.livesEl = opts.livesEl;
    this.overlays = opts.overlays;
    this.highScoreTitleEl = opts.highScoreTitleEl;
    this.goScoreEl = opts.goScoreEl;
    this.newHighEl = opts.newHighEl;

    this.maze = this.loadMaze();
    this.fruit = new FruitSlot(this.maze.fruitSlot);

    this.highScore = Number(localStorage.getItem("pm80HighScore")) || 0;
    this.state = "title";
    this.paused = false;
    this.time = 0;
    this.acc = 0;
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.dotsEaten = 0;
    this.dotCounterActive = false;
    this.waka = false;
    this.fright = 0;
    this.ghostCombo = 0;
    this.phase = "scatter";
    this.phaseIndex = 0;
    this.phaseTimer = 0;
    this.readyTimer = 0;
    this.dyingTimer = 0;
    this.intermissionTimer = 0;
    this.goTimer = 0;
    this.extraLifeFlash = 0;
    this.nextLifeAt = 10000;
    try { this.muted = localStorage.getItem("pm80Muted") === "1"; } catch (e) { this.muted = false; }
    this.audio = new GameAudio({ muted: this.muted });
    try { this.startLevel = Number(new URLSearchParams(location.search).get("level")) || 0; } catch (e) { this.startLevel = 0; }
    this.soundBtn = opts.soundBtn;
    this.fullscreenBtn = opts.fullscreenBtn;
    this.crtBtn = opts.crtBtn;
    this.crtOverlay = opts.crtOverlay;
    this.levelIntroTitleEl = opts.levelIntroTitleEl;
    this.onLevelIntro = opts.onLevelIntro || null;
    try { this.crt = localStorage.getItem("pm80CRT") === "1"; } catch (e) { this.crt = false; }

    this.pac = null;
    this.ghosts = [];
    this.resetEntities();
    this.resetPhase();

    this.resize();
    this.bindInput();
    this.updateHUD();
    this.setState("title");
    this.updateSoundBtn();
    this.updateFullscreenBtn();
    this.updateCrtBtn();

    this.lastT = performance.now() / 1000;
    this.loopFn = (t) => this.loop(t);
    this.raf = requestAnimationFrame(this.loopFn);
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("fullscreenchange", () => this.updateFullscreenBtn());
  }

  loadMaze() {
    let rows = [];
    try {
      rows = (root.mazeMap.selectAll || []).map(i => i.evaluateItem);
    } catch (e) {}
    return new Maze(rows);
  }

  ghostDotLimits() {
    if (this.level >= 3) return { pinky: 0, inky: 0, clyde: 0 };
    if (this.level === 2) return { pinky: 0, inky: 0, clyde: 50 };
    return { pinky: 0, inky: 30, clyde: 60 };
  }

  pacSpeed() {
    const lvl = this.level;
    const base = lvl >= 21 ? 90 : lvl >= 5 ? 100 : lvl >= 2 ? 90 : 80;
    const fright = lvl >= 5 ? 100 : lvl >= 2 ? 95 : 90;
    return (NORMAL * (this.fright > 0 ? fright : base)) / 100;
  }

  frightDuration() {
    const lvl = this.level;
    if (lvl === 1) return 6;
    if (lvl === 2) return 5;
    if (lvl === 3) return 4;
    if (lvl === 4) return 3;
    if (lvl <= 8) return 2;
    if (lvl <= 16) return 1;
    return 0;
  }

  resetEntities() {
    const [px, py] = this.maze.pacStart;
    this.pac = { kind: "pac", x: px * TILE + TILE / 2, y: py * TILE + TILE / 2, dx: -1, dy: 0, speed: this.pacSpeed(), color: "#ffe000", wish: null, tileX: px, tileY: py, centered: false, freeze: 0 };
    this.fright = 0;
    this.ghostCombo = 0;
    const limits = this.ghostDotLimits();
    this.ghosts = this.maze.ghostStarts.map((start, i) => {
      const def = GHOST_DEFS[i] || GHOST_DEFS[0];
      const [x, y] = start;
      const aboveHouse = y <= 11;
      return {
        ...def,
        x: x * TILE + TILE / 2,
        y: y * TILE + TILE / 2,
        startTile: [x, y],
        respawnTile: [13, 14],
        dx: 0,
        dy: aboveHouse ? 0 : -1,
        centered: false,
        mode: aboveHouse ? "scatter" : "house",
        inHouse: !aboveHouse,
        released: aboveHouse,
        byDotCount: !aboveHouse,
        dotLimit: aboveHouse ? 0 : limits[def.name],
        exitTimer: 0.75,
        elroy: 0
      };
    });
  }

  resetPhase() {
    this.phase = "scatter";
    this.phaseIndex = 0;
    this.phaseTimer = this.schedule(this.level)[0];
  }

  schedule(level) {
    if (level === 1) return [7, 20, 7, 20, 5, 20, 5];
    if (level <= 4) return [7, 20, 7, 20, 5, 1033, 1 / 60];
    return [5, 20, 5, 20, 5, 1037, 1 / 60];
  }

  setState(s) {
    this.state = s;
    this.paused = false;
    this.overlays.title.hidden = s !== "title";
    this.overlays.ready.hidden = s !== "ready";
    this.overlays.gameover.hidden = s !== "gameover";
    this.overlays.pause.hidden = true;
    if (this.overlays.levelIntro) this.overlays.levelIntro.hidden = s !== "intermission";
  }

  startGame() {
    this.score = 0;
    this.lives = 3;
    this.level = this.startLevel > 0 ? this.startLevel : 1;
    this.dotsEaten = 0;
    this.dotCounterActive = this.level >= 3;
    this.waka = false;
    this.nextLifeAt = 10000;
    this.maze = this.loadMaze();
    this.fruit = new FruitSlot(this.maze.fruitSlot);
    this.resetEntities();
    this.resetPhase();
    this.updateHUD();
    this.audio.unlock();
    this.audio.powerDrone(false);
    this.audio.levelStart();
    this.setState("ready");
    this.readyTimer = 1.5;
  }

  startAtLevel(n) {
    this.startLevel = Math.max(1, Math.min(99, n | 0));
    this.startGame();
  }

  addScore(n) {
    this.score += n;
    if (this.score >= this.nextLifeAt) {
      this.lives++;
      this.nextLifeAt += 10000;
      this.extraLifeFlash = 1.4;
      this.audio.extraLife();
      this.updateHUD();
    }
  }

  toggleMuted() {
    this.muted = !this.muted;
    try { localStorage.setItem("pm80Muted", this.muted ? "1" : "0"); } catch (e) {}
    this.audio.unlock();
    this.audio.setMuted(this.muted);
    this.updateSoundBtn();
  }

  toggleCrt() {
    this.crt = !this.crt;
    try { localStorage.setItem("pm80CRT", this.crt ? "1" : "0"); } catch (e) {}
    this.updateCrtBtn();
  }

  updateCrtBtn() {
    if (this.crtOverlay) this.crtOverlay.hidden = !this.crt;
    if (this.crtBtn) this.crtBtn.textContent = "CRT: " + (this.crt ? "ON" : "OFF");
  }

  updateSoundBtn() {
    if (this.soundBtn) this.soundBtn.textContent = this.muted ? "SOUND OFF" : "SOUND ON";
  }

  toggleFullscreen() {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
    } else if (this.stage.requestFullscreen) {
      this.stage.requestFullscreen();
    }
    this.updateFullscreenBtn();
  }

  updateFullscreenBtn() {
    if (this.fullscreenBtn) {
      this.fullscreenBtn.textContent = document.fullscreenElement ? "EXIT FS" : "FULLSCREEN";
    }
  }

  togglePause() {
    if (this.state !== "playing") return;
    this.paused = !this.paused;
    this.overlays.pause.hidden = !this.paused;
    if (this.paused) {
      this.audio.powerDrone(false);
      this.audio.suspend();
    } else {
      this.audio.resume();
      this.audio.powerDrone(this.fright > 0);
    }
  }

  endGame() {
    this.audio.powerDrone(false);
    const isNewHigh = this.score > this.highScore;
    if (isNewHigh) {
      this.highScore = this.score;
      try { localStorage.setItem("pm80HighScore", String(this.highScore)); } catch (e) {}
    }
    this.goScoreEl.textContent = String(this.score).padStart(6, "0");
    this.newHighEl.hidden = !isNewHigh;
    this.updateHUD();
    this.setState("gameover");
  }

  updateHUD() {
    this.scoreEl.textContent = String(this.score).padStart(6, "0");
    this.highScoreEl.textContent = String(this.highScore).padStart(6, "0");
    if (this.highScoreTitleEl) this.highScoreTitleEl.textContent = "HIGH SCORE  " + String(this.highScore).padStart(6, "0");
    this.livesEl.innerHTML = "";
    for (let i = 0; i < Math.max(0, this.lives); i++) {
      const s = document.createElement("span");
      s.className = "life";
      this.livesEl.appendChild(s);
    }
  }

  bindInput() {
    const DIR_KEYS = {
      ArrowUp: "up", KeyW: "up",
      ArrowDown: "down", KeyS: "down",
      ArrowLeft: "left", KeyA: "left",
      ArrowRight: "right", KeyD: "right"
    };
    window.addEventListener("keydown", (e) => {
      this.audio.unlock();
      if (DIR_KEYS[e.code]) {
        e.preventDefault();
        if (this.state === "playing" || this.state === "ready") this.setWish(DIR_KEYS[e.code]);
        return;
      }
      if (this.state === "playing" && (e.key === "p" || e.key === "P" || e.key === "Escape")) {
        e.preventDefault();
        this.togglePause();
        return;
      }
      if (this.paused) return;
      if (e.key === "m" || e.key === "M") {
        if (this.state === "title" || this.state === "playing" || this.state === "gameover") this.toggleMuted();
        return;
      }
      if (e.key === "c" || e.key === "C") {
        if (this.state === "title" || this.state === "playing" || this.state === "gameover") this.toggleCrt();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        if (this.state === "title" || this.state === "playing" || this.state === "gameover") this.toggleFullscreen();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (this.state === "title") { e.preventDefault(); this.startGame(); }
        else if (this.state === "gameover") { e.preventDefault(); this.setState("title"); }
      }
    });
    let swipeStart = null;
    this.stage.addEventListener("pointerdown", (e) => {
      this.audio.unlock();
      swipeStart = { x: e.clientX, y: e.clientY, moved: false };
    });
    this.stage.addEventListener("pointermove", (e) => {
      if (!swipeStart) return;
      const dx = e.clientX - swipeStart.x;
      const dy = e.clientY - swipeStart.y;
      if (Math.hypot(dx, dy) > 24) {
        swipeStart.moved = true;
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
        this.setWish(dir);
        swipeStart = { x: e.clientX, y: e.clientY, moved: true };
      }
    });
    this.stage.addEventListener("pointerup", () => {
      const wasTap = swipeStart && !swipeStart.moved;
      swipeStart = null;
      if (!wasTap) return;
      if (this.state === "title") this.startGame();
      else if (this.state === "gameover") this.setState("title");
      else if (this.state === "playing") this.togglePause();
    });
    for (const b of document.querySelectorAll("[data-dir]")) {
      b.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this.audio.unlock();
        this.setWish(b.dataset.dir);
      });
    }
  }

  setWish(dir) {
    if (this.state !== "playing" && this.state !== "ready") return;
    if (this.pac) this.pac.wish = dir;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = ARENA_W * dpr;
    this.canvas.height = ARENA_H * dpr;
  }

  loop(t) {
    this.raf = requestAnimationFrame(this.loopFn);
    const now = t / 1000;
    let dt = now - this.lastT;
    this.lastT = now;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render();
  }

  update(dt) {
    this.time += dt;
    if (this.paused) return;
    if (this.state === "intermission") {
      this.intermissionTimer -= dt;
      if (this.intermissionTimer <= 0) {
        this.setState("ready");
        this.readyTimer = 1.5;
      }
      return;
    }
    if (this.state === "ready") {
      this.readyTimer -= dt;
      if (this.readyTimer <= 0) {
        this.setState("playing");
        this.goTimer = 0.6;
      }
      return;
    }
    if (this.state === "dying") {
      this.dyingTimer -= dt;
      if (this.dyingTimer <= 0) this.finishDeath();
      return;
    }
    if (this.state !== "playing") return;
    if (this.goTimer > 0) this.goTimer -= dt;
    if (this.extraLifeFlash > 0) this.extraLifeFlash -= dt;
    if (this.fright > 0) {
      this.fright -= dt;
      if (this.fright <= 0) {
        this.fright = 0;
        this.audio.powerDrone(false);
        for (const g of this.ghosts) {
          if (g.mode === "frightened") g.mode = this.phase;
        }
      }
    }
    this.updatePhase(dt);
    this.updateElroy();
    this.pac.speed = this.pacSpeed();
    this.stepMover(this.pac, dt, true);
    for (const g of this.ghosts) {
      g.speed = this.ghostSpeed(g);
      this.stepGhost(g, dt);
    }
    this.fruit.update(dt);
    this.checkGhostCollisions();
  }

  updatePhase(dt) {
    if (this.fright > 0) return;
    if (this.phaseTimer >= 1e9) return;
    this.phaseTimer -= dt;
    if (this.phaseTimer > 0) return;
    this.phaseIndex++;
    const sched = this.schedule(this.level);
    if (this.phaseIndex >= sched.length) {
      this.phase = "chase";
      this.phaseTimer = 1e9;
    } else {
      this.phase = this.phase === "scatter" ? "chase" : "scatter";
      this.phaseTimer = sched[this.phaseIndex];
    }
    for (const g of this.ghosts) {
      if (!g.inHouse && g.mode !== "frightened" && g.mode !== "eyes") this.reverseGhost(g);
    }
  }

  updateElroy() {
    const b = this.ghosts[0];
    const e1 = Math.min(100, 20 + (this.level - 1) * 10);
    const e2 = e1 / 2;
    if (this.dotCounterActive) {
      let elroy = 0;
      if (this.maze.dotsLeft <= e2) elroy = 2;
      else if (this.maze.dotsLeft <= e1) elroy = 1;
      b.elroy = elroy;
    } else {
      b.elroy = 0;
    }
  }

  reverseGhost(g) {
    g.dx = -g.dx;
    g.dy = -g.dy;
    g.centered = false;
  }

  ghostSpeed(g) {
    const lvl = this.level;
    const ghostPct = lvl >= 5 ? 95 : lvl >= 2 ? 85 : 75;
    const frightPct = lvl >= 5 ? 60 : lvl >= 2 ? 55 : 50;
    const tunnelPct = lvl >= 5 ? 50 : lvl >= 2 ? 45 : 40;
    let s;
    if (this.onTunnelRow(g)) s = (NORMAL * tunnelPct) / 100;
    else if (g.mode === "frightened") s = (NORMAL * frightPct) / 100;
    else if (g.mode === "eyes") s = (NORMAL * 160) / 100;
    else if (g.name === "blinky" && g.elroy === 2) s = (NORMAL * 95) / 100;
    else if (g.name === "blinky" && g.elroy === 1) s = (NORMAL * 85) / 100;
    else s = (NORMAL * ghostPct) / 100;
    return s;
  }

  onTunnelRow(g) {
    const ty = Math.floor(g.y / TILE);
    return this.maze.cell(0, ty) !== "#" && this.maze.cell(COLS - 1, ty) !== "#";
  }

  wrapTile(x, y) {
    let tx = Math.floor(x / TILE);
    let ty = Math.floor(y / TILE);
    if (tx < 0) tx += COLS;
    if (tx >= COLS) tx -= COLS;
    return [tx, ty];
  }

  pacTile() {
    return this.wrapTile(this.pac.x, this.pac.y);
  }

  dirKey(dx, dy) {
    if (dx === -1) return "left";
    if (dx === 1) return "right";
    if (dy === -1) return "up";
    return "down";
  }

  isHouseInterior(x, y) {
    return x >= 11 && x <= 16 && y >= 13 && y <= 16;
  }

  canGhostAtDir(g, x, y, dx, dy) {
    const c = this.maze.cell(x, y);
    if (c === "#") return false;
    if (c === "D") {
      if (g.mode === "eyes") return true;
      return g.inHouse && dy < 0 && Math.floor(g.y / TILE) >= 12;
    }
    if (this.isHouseInterior(x, y) && !g.inHouse && g.mode !== "eyes") return false;
    return true;
  }

  stepGhost(g, dt) {
    if (g.inHouse && !g.released && g.mode !== "eyes") {
      let go = false;
      if (g.byDotCount) {
        const count = this.dotsEaten;
        if (count >= g.dotLimit) go = true;
      } else {
        g.exitTimer -= dt;
        if (g.exitTimer <= 0) go = true;
      }
      if (go) {
        g.released = true;
        const [sx, sy] = g.startTile;
        g.x = sx * TILE + TILE / 2;
        g.y = sy * TILE + TILE / 2;
        g.dx = 0;
        g.dy = -1;
        g.centered = false;
        if (!this.ghosts.some(x => x.inHouse && !x.released)) this.dotCounterActive = true;
      }
    }
    this.stepMover(g, dt, false);
    if (g.mode === "eyes") {
      if (!g.inHouse && Math.floor(g.y / TILE) > DOOR_TILE[1]) g.inHouse = true;
      const [tx, ty] = this.wrapTile(g.x, g.y);
      if (g.inHouse && tx === g.respawnTile[0] && ty === g.respawnTile[1]) {
        this.respawnGhost(g);
        return;
      }
    }
    if (g.inHouse && g.released && g.mode !== "eyes") {
      if (Math.floor(g.y / TILE) <= 11) {
        g.inHouse = false;
        g.mode = this.phase;
      }
    }
  }

  respawnGhost(g) {
    const [sx, sy] = g.respawnTile;
    g.x = sx * TILE + TILE / 2;
    g.y = sy * TILE + TILE / 2;
    g.dx = 0;
    g.dy = 1;
    g.centered = false;
    g.inHouse = true;
    g.released = false;
    g.byDotCount = false;
    g.mode = this.phase;
    g.exitTimer = 0.75;
  }

  stepMover(e, dt, isPac) {
    if (isPac && e.freeze > 0) {
      e.freeze -= dt;
      return;
    }
    const maze = this.maze;
    const tx = Math.floor(e.x / TILE);
    const ty = Math.floor(e.y / TILE);
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    const cur = this.dirKey(e.dx, e.dy);
    const near = isPac ? 3.5 : 1.5;
    const atCenter = Math.abs(e.x - cx) <= near && Math.abs(e.y - cy) <= near;

    if (isPac) {
      const [cdx, cdy] = DIRS[cur];
      const blocked = !maze.canPac(tx + cdx, ty + cdy);
      if (e.wish && e.wish !== cur) {
        if (e.wish === REV[cur]) {
          if (atCenter || blocked) {
            e.x = cx;
            e.y = cy;
            e.dx = DIRS[e.wish][0];
            e.dy = DIRS[e.wish][1];
          }
        } else {
          const [wx, wy] = DIRS[e.wish];
          const aligned = wx !== 0 ? Math.abs(e.y - cy) <= near : Math.abs(e.x - cx) <= near;
          if ((aligned || blocked) && maze.canPac(tx + wx, ty + wy)) {
            e.dx = wx;
            e.dy = wy;
            if (wx !== 0) e.y = cy; else e.x = cx;
          }
        }
      }
    } else {
      if (atCenter && !e.centered) {
        e.x = cx;
        e.y = cy;
        e.centered = true;
        const nd = this.pickGhostDir(e, tx, ty, cur);
        if (nd) {
          e.dx = DIRS[nd][0];
          e.dy = DIRS[nd][1];
          if (nd === "left" || nd === "right") e.y = cy; else e.x = cx;
        }
      } else if (!atCenter) {
        e.centered = false;
      }
    }

    const ox = e.x;
    const oy = e.y;
    let nx = e.x + e.dx * e.speed * dt;
    let ny = e.y + e.dy * e.speed * dt;
    const can = (x, y) => (isPac ? maze.canPac(x, y) : this.canGhostAtDir(e, x, y, e.dx, e.dy));
    if (e.dx !== 0) {
      const t = Math.floor(nx / TILE);
      if (!can(t, Math.floor(e.y / TILE))) nx = e.dx > 0 ? t * TILE - 0.1 : (t + 1) * TILE + 0.1;
    }
    if (e.dy !== 0) {
      const t = Math.floor(ny / TILE);
      if (!can(Math.floor(e.x / TILE), t)) ny = e.dy > 0 ? t * TILE - 0.1 : (t + 1) * TILE + 0.1;
    }
    e.x = nx;
    e.y = ny;

    if (!isPac && !atCenter) {
      const stuck =
        (e.dx === 0 && e.dy === 0) ||
        (e.dx !== 0 && Math.abs(nx - ox) < 0.001) ||
        (e.dy !== 0 && Math.abs(ny - oy) < 0.001);
      if (stuck) {
        e.x = Math.floor(nx / TILE) * TILE + TILE / 2;
        e.y = Math.floor(ny / TILE) * TILE + TILE / 2;
        e.centered = false;
      }
    }

    if (e.x < -TILE / 2) e.x += ARENA_W + TILE;
    else if (e.x > ARENA_W + TILE / 2) e.x -= ARENA_W + TILE;

    if (isPac) {
      let txx = Math.floor(e.x / TILE);
      let tyy = Math.floor(e.y / TILE);
      if (txx < 0) txx += COLS;
      if (txx >= COLS) txx -= COLS;
      if (txx !== e.tileX || tyy !== e.tileY) {
        e.tileX = txx;
        e.tileY = tyy;
        this.onTileEnter(txx, tyy);
      }
    }
  }

  pickGhostDir(g, tx, ty, cur) {
    const maze = this.maze;
    if (g.mode === "eyes" && ty === 11 && tx === 14) return "down";
    const inTunnel = maze.cell(0, ty) !== "#" && maze.cell(COLS - 1, ty) !== "#";
    const opts = [];
    for (const d of Object.keys(DIRS)) {
      if (d === REV[cur]) continue;
      const [ddx, ddy] = DIRS[d];
      if (g.inHouse && !g.released && maze.cell(tx + ddx, ty + ddy) === "D") continue;
      if (this.canGhostAtDir(g, tx + ddx, ty + ddy, ddx, ddy)) opts.push(d);
    }
    if (!opts.length) return REV[cur];
    if (inTunnel && !g.inHouse && opts.includes(cur)) return cur;
    if (g.mode === "frightened") return opts[Math.floor(Math.random() * opts.length)];
    const target = this.ghostTarget(g, tx, ty);
    if (target) {
      let best = null;
      let bestD = Infinity;
      for (const d of ["up", "left", "down", "right"]) {
        if (!opts.includes(d)) continue;
        const [ddx, ddy] = DIRS[d];
        const dist = Math.abs(tx + ddx - target[0]) + Math.abs(ty + ddy - target[1]);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (best) return best;
    }
    return opts[Math.floor(Math.random() * opts.length)];
  }

  ghostTarget(g, tx, ty) {
    const [ptx, pty] = this.pacTile();
    const pdx = this.pac.dx;
    const pdy = this.pac.dy;
    if (g.mode === "eyes") {
      if (ty <= DOOR_TILE[1]) return DOOR_TILE;
      return g.respawnTile;
    }
    if (g.inHouse) {
      if (g.released) return DOOR_TILE;
      return null;
    }
    if (g.mode === "scatter") {
      if (g.name === "blinky" && g.elroy > 0) return [ptx, pty];
      return g.scatter;
    }
    switch (g.name) {
      case "blinky":
        return [ptx, pty];
      case "pinky":
        if (pdy === -1) return [ptx - 4, pty - 4];
        return [ptx + pdx * 4, pty + pdy * 4];
      case "inky": {
        let px = ptx + pdx * 2;
        let py = pty + pdy * 2;
        if (pdy === -1) { px = ptx - 2; py = pty - 2; }
        const [bx, by] = this.wrapTile(this.ghosts[0].x, this.ghosts[0].y);
        return [px * 2 - bx, py * 2 - by];
      }
      case "clyde": {
        const dist = Math.abs(tx - ptx) + Math.abs(ty - pty);
        return dist > 8 ? [ptx, pty] : g.scatter;
      }
    }
    return [ptx, pty];
  }

  onTileEnter(tx, ty) {
    const res = this.maze.eatDot(tx, ty);
    if (res) {
      this.addScore(res === 2 ? 50 : 10);
      this.dotsEaten++;
      this.pac.freeze = res === 2 ? 3 / 60 : 1 / 60;
      this.waka = !this.waka;
      this.audio.waka(this.waka);
      if (res === 2) this.triggerFright();
      this.updateHUD();
      if (this.maze.dotsLeft === 0) { this.levelClear(); return; }
      if (this.dotsEaten === 70 || this.dotsEaten === 170) this.fruit.spawn(this.level);
    }
    if (this.fruit.active && tx === this.fruit.tile[0] && ty === this.fruit.tile[1]) {
      this.addScore(this.fruit.points());
      this.fruit.despawn();
      this.audio.fruit();
      this.updateHUD();
    }
  }

  triggerFright() {
    const dur = this.frightDuration();
    this.ghostCombo = 0;
    for (const g of this.ghosts) {
      if (!g.inHouse && g.mode !== "eyes") this.reverseGhost(g);
    }
    if (dur <= 0) return;
    this.fright = dur;
    for (const g of this.ghosts) {
      if (!g.inHouse && g.mode !== "eyes") g.mode = "frightened";
    }
    this.audio.powerDrone(true);
  }

  levelClear() {
    this.level++;
    this.dotsEaten = 0;
    this.dotCounterActive = this.level >= 3;
    this.maze = this.loadMaze();
    this.fruit = new FruitSlot(this.maze.fruitSlot);
    this.resetEntities();
    this.resetPhase();
    this.setState("intermission");
    this.intermissionTimer = 2.0;
    this.audio.powerDrone(false);
    this.audio.levelStart();
    if (this.levelIntroTitleEl) this.levelIntroTitleEl.textContent = "LEVEL " + this.level;
    if (this.onLevelIntro) this.onLevelIntro(this.level);
  }

  checkGhostCollisions() {
    for (const g of this.ghosts) {
      if (g.inHouse || g.mode === "eyes") continue;
      if (Math.hypot(g.x - this.pac.x, g.y - this.pac.y) < 12) {
        if (g.mode === "frightened") this.eatGhost(g);
        else { this.startDeath(); return; }
      }
    }
  }

  eatGhost(g) {
    this.addScore(200 << Math.min(this.ghostCombo, 3));
    this.ghostCombo++;
    g.mode = "eyes";
    g.inHouse = false;
    this.reverseGhost(g);
    this.audio.eatGhost();
    this.updateHUD();
  }

  startDeath() {
    this.state = "dying";
    this.dyingTimer = DEATH_TIME;
    this.fruit.despawn();
    this.audio.powerDrone(false);
    this.audio.death();
  }

  finishDeath() {
    this.lives--;
    this.updateHUD();
    if (this.lives <= 0) {
      this.endGame();
      return;
    }
    this.resetEntities();
    this.setState("ready");
    this.readyTimer = 1.5;
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    this.maze.render(ctx, this.time);
    this.fruit.draw(ctx, this.time);
    if (this.state === "dying") {
      this.renderPacDeath();
    } else if (this.state === "playing" || this.state === "ready" || this.paused) {
      this.renderPac();
      this.renderGhosts();
    }
    if (this.state === "playing" && this.goTimer > 0) this.renderText("GO!", 22, "#ffe000");
    if (this.state === "playing" && this.extraLifeFlash > 0) this.renderText("EXTRA LIFE", 15, "#00ffff");
  }

  renderText(text, size, color) {
    const ctx = this.ctx;
    ctx.font = size + "px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(text, ARENA_W / 2, 23 * TILE + TILE / 2);
  }

  renderPac() {
    const ctx = this.ctx;
    const p = this.pac;
    const r = 8;
    const ang = Math.atan2(p.dy, p.dx);
    let open;
    if (this.fright > 0) {
      open = 0.6;
    } else {
      const freq = (2 * p.speed) / TILE;
      open = Math.floor(this.time * freq) % 2 === 0 ? 0.25 : 0.05;
    }
    ctx.fillStyle = "#ffe000";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, r, ang - open, ang + open, true);
    ctx.closePath();
    ctx.fill();
  }

  renderPacDeath() {
    const ctx = this.ctx;
    const p = this.pac;
    const t = 1 - this.dyingTimer / DEATH_TIME;
    const r = 8 * (1 - 0.9 * t);
    const ang = t * Math.PI * 4;
    const open = Math.floor(t * 14) % 2 === 0 ? 0.6 : 0.1;
    ctx.fillStyle = "#ffe000";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, Math.max(r, 0.01), ang - open, ang + open, true);
    ctx.closePath();
    ctx.fill();
  }

  renderGhosts() {
    for (const g of this.ghosts) this.drawGhost(g);
  }

  drawGhost(g) {
    const ctx = this.ctx;
    const bob = g.inHouse ? Math.sin(this.time * 7) * 1.5 : 0;
    const x = g.x;
    const y = g.y + bob;
    if (g.mode === "eyes") {
      this.drawEyes(x, y, g.dx, g.dy);
      return;
    }
    const frightened = g.mode === "frightened";
    const flash = frightened && this.fright < 2 && Math.floor(this.time * 8) % 2 === 0;
    const bodyColor = frightened ? (flash ? "#ffffff" : "#1414d8") : g.color;
    const s = 9;
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.4);
    ctx.quadraticCurveTo(x - s, y - s, x - s * 0.4, y - s);
    ctx.lineTo(x + s * 0.4, y - s);
    ctx.quadraticCurveTo(x + s, y - s, x + s, y - s * 0.4);
    ctx.lineTo(x + s, y + s * 0.8);
    ctx.lineTo(x + s * 0.6, y + s * 0.5);
    ctx.lineTo(x + s * 0.2, y + s * 0.8);
    ctx.lineTo(x - s * 0.2, y + s * 0.5);
    ctx.lineTo(x - s * 0.6, y + s * 0.8);
    ctx.lineTo(x - s, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
    const ex = g.dx * 1.5;
    const ey = g.dy * 1.5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x - s * 0.3 + ex, y - s * 0.35 + ey, 2.8, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + s * 0.3 + ex, y - s * 0.35 + ey, 2.8, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (frightened) {
      ctx.fillStyle = flash ? "#2121ff" : "#ffffff";
    } else {
      ctx.fillStyle = "#2b2bd6";
    }
    ctx.beginPath();
    ctx.arc(x - s * 0.2 + ex, y - s * 0.3 + ey, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + s * 0.4 + ex, y - s * 0.3 + ey, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  drawEyes(x, y, dx, dy) {
    const ctx = this.ctx;
    const ox = dx * 2;
    const oy = dy * 2;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x - 3 + ox, y - 1 + oy, 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 3 + ox, y - 1 + oy, 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2121ff";
    ctx.beginPath();
    ctx.arc(x - 3 + ox * 1.5, y - 1 + oy * 1.5, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 3 + ox * 1.5, y - 1 + oy * 1.5, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
}
