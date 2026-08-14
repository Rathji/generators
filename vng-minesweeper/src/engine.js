// ============================================================================
//  src/engine.js — the game engine of the VGN shell
//  ----------------------------------------------------------------------------
//  Owns the pieces every game shares, regardless of genre:
//    • The requestAnimationFrame loop with a FIXED timestep — game physics
//      always advances at exactly STEP (1/60 s) regardless of the display's
//      refresh rate, so the same inputs produce the same game on any screen.
//    • The state machine: BOOT → TITLE → PLAYING → PAUSED → GAME_OVER.
//    • The "game context" (gameCtx) handed to the game module, plus the
//      module's init/reset/update/render lifecycle.
//    • Retina-aware canvas sizing (logical 480×270 units; see LOGICAL_W/H).
//  The shell knows nothing about your genre — it just calls the four hooks of
//  whatever module src/main.js imports. See index.html, "GAME MODULE API".
//  ============================================================================

export const LOGICAL_W = 480;
export const LOGICAL_H = 270;
export const STEP = 1 / 60;                    // fixed physics timestep (s)

export const STATES = Object.freeze({
  BOOT: 'BOOT',
  TITLE: 'TITLE',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER',
});

export class GameEngine {
  constructor({ canvas, input, audio, hud, game, onTick, onStateChange }) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.game = game;
    this.onTick = onTick || (() => {});        // per-frame hook (menu input)
    this.onStateChange = onStateChange || (() => {});

    this.state = STATES.BOOT;
    this.running = false;
    this.time = 0;                             // seconds since engine start
    this.runTime = 0;                          // seconds in the current run
    this.finalScore = 0;                       // set when a run ends
    this.acc = 0;                              // fixed-timestep accumulator
    this._last = 0;
    this._raf = 0;
    this._watchdog = 0;
    this._lastFrameAt = 0;

    // The object every game module hook receives (ctx). Your game can reach
    // the whole shell through it — see index.html's GAME MODULE API section.
    this.gameCtx = {
      width: LOGICAL_W,
      height: LOGICAL_H,
      input,
      audio,
      hud,
      time: () => this.runTime,                // paused-safe run clock
      wallTime: () => this.time,               // real clock (animation only)
      gameOver: () => this.gameOver(),         // end the current run
    };

    this._size();
    window.addEventListener('resize', () => this._size());
  }

  // Retina-aware sizing: the internal buffer is logical resolution × dpr
  // (capped at 2) while CSS stretches it to fit the window. Game code draws
  // in plain 480×270 units — no math needed, pixels stay crisp.
  _size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(LOGICAL_W * dpr);
    const bh = Math.round(LOGICAL_H * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.g.imageSmoothingEnabled = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._lastFrameAt = this._last;
    this._raf = requestAnimationFrame((t) => this._loop(t));
    // Watchdog: some embedded/background contexts throttle rAF to nothing.
    // If no frame has arrived in a while, drive the loop from a timer instead.
    // Because update() runs at a FIXED timestep, the game stays consistent
    // even at a low fallback frame rate — this is exactly why we don't tie
    // physics to rAF deltas.
    this._watchdog = setInterval(() => {
      if (!this.running) return;
      const now = performance.now();
      if (now - this._lastFrameAt > 400) this._loop(now);
    }, 100);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    clearInterval(this._watchdog);
  }

  _loop(t) {
    if (!this.running) return;
    this._raf = requestAnimationFrame((t) => this._loop(t));
    this._lastFrameAt = performance.now();

    let dt = (t - this._last) / 1000;
    this._last = t;
    if (dt > 0.25) dt = 0.25;                  // clamp after tab-switch hiccups
    this.time += dt;

    this.onTick(dt);                           // shell menu input, HUD upkeep

    if (this.state === STATES.PLAYING) {
      // Fixed-timestep stepping: run the game's update() exactly at STEP
      // intervals, catching up with however much real time has passed.
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) {
        this.game.update(STEP, this.gameCtx);
        this.runTime += STEP;
        this.acc -= STEP;
        steps++;
      }
      if (steps >= 8) this.acc = 0;            // drop the backlog, don't spiral
    }

    this.render();
    this.input.endFrame();
  }

  render() {
    const g = this.g;
    g.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    if (this.state !== STATES.BOOT) {
      // alpha = interpolation factor between the last two fixed steps; most
      // games ignore it, but it's there for buttery-smooth rendering.
      this.game.render(g, Math.min(1, this.acc / STEP), this.gameCtx);
    }
  }

  _enter(prev, next) {
    this.state = next;
    this.onStateChange(prev, next);
  }

  // BOOT → TITLE (after the CRT power-on sequence ends). The world is reset
  // so it doubles as an attract-mode backdrop behind the title overlay.
  finishBoot() {
    this.game.reset(this.gameCtx);
    this._enter(this.state, STATES.TITLE);
  }

  // TITLE or GAME_OVER → a fresh PLAYING run. Resets the game module.
  startRun() {
    this.runTime = 0;
    this.acc = 0;
    this.game.reset(this.gameCtx);
    this._enter(this.state, STATES.PLAYING);
  }

  // PAUSED → PLAYING, continuing the same run.
  resume() {
    if (this.state !== STATES.PAUSED) return;
    this.acc = 0;
    this._enter(STATES.PAUSED, STATES.PLAYING);
  }

  // PLAYING → PAUSED.
  pause() {
    if (this.state !== STATES.PLAYING) return;
    this._enter(STATES.PLAYING, STATES.PAUSED);
  }

  // Anywhere → TITLE (also resets the world so it doubles as an attract
  // backdrop behind the title overlay).
  toTitle() {
    this.game.reset(this.gameCtx);
    this._enter(this.state, STATES.TITLE);
  }

  // PLAYING → GAME_OVER. Called by the game module via ctx.gameOver().
  gameOver() {
    if (this.state !== STATES.PLAYING) return;
    this.finalScore = this.hud.score;
    this._enter(STATES.PLAYING, STATES.GAME_OVER);
  }
}
