
// 00-core.js — Bucket 1: Game, Input, Palette, Physics
//
// Owns: backing canvas + integer upscale, fixed timestep loop, HUD, camera,
// title/game-over overlays, keyboard + touch input, mute button wiring,
// and the shared collision resolver every actor (including Mario, later)
// must use. See CONTRACT.md for the frozen interface this file implements.
//
// Style rule: no bare top-level const/let — everything below is declared
// with `var` so this file is safe to concatenate with the others (bucket 7)
// without triggering a global-lexical-scope redeclaration SyntaxError.
(function () {

  // ---------- Game namespace + constants ----------
  var Game = {
    NES_W: 256,
    NES_H: 240,
    TILE_PX: 16,
    LEVEL_ROWS: 15,       // row 0 top, ground occupies rows 13-14
    ctx: null,
    camera: { x: 0 },
    state: 'title',       // 'title' | 'play' | 'dying' | 'clear' | 'gameover'
    score: 0,
    coins: 0,
    lives: 3,
    time: 400,
    onGroundY: 13 * 16,   // top surface of the ground band (row 13 * TILE_PX)
    _popups: [],
    _timeAcc: 0
  };
  window.Game = Game;

  Game.col2px = function (c) { return c * Game.TILE_PX; };
  Game.px2col = function (x) { return Math.floor(x / Game.TILE_PX); };

  Game.addScore = function (n, x, y) {
    Game.score += n;
    Game._popups.push({
      x: x, y: y,
      text: (n >= 0 ? '+' : '') + n,
      life: 0.8,
      vy: -40 // px/sec, rises then fades
    });
  };

  Game.addCoin = function () {
    Game.coins += 1;
    Game.score += 200;
  };

  Game.setState = function (s) {
    Game.state = s;
    if (titleOverlay) titleOverlay.classList.toggle('hidden', s !== 'title');
    if (gameOverOverlay) gameOverOverlay.classList.toggle('hidden', s !== 'gameover');
  };

  function resetStats() {
    Game.score = 0;
    Game.coins = 0;
    Game.lives = 3;
    Game.time = 400;
    Game._timeAcc = 0;
    Game._popups.length = 0;
    Game.camera.x = 0;
  }

  // ---------- level restore (bucket 7 / fix A) ----------
  //
  // Game.resetLevel() — the full "put 1-1 back the way it shipped" hook.
  // Restores broken bricks, spent ? blocks, collected coin contents (Level),
  // rearms every enemy spawn (Actors), and resets the core-owned clock and
  // camera. Mario's own state stays his business; 30-mario.js calls this from
  // its respawn path and then places himself.
  //
  // ORDER IS LOAD-BEARING: Level.init() must run BEFORE Actors.init().
  // Actors.init() rebuilds its dormant spawn list from Level.SPAWNS, so the
  // reverse order hands it an emptied table and the level comes back with no
  // enemies in it at all.
  //
  // CAMERA: CONTRACT.md hard rule 4 says the camera scrolls right only and
  // never left. This function is the single, explicit, sanctioned relaxation
  // of that rule, and the reason is fidelity plus renderability: SMB restarts
  // the whole level from the left when you die, and because the camera cannot
  // scroll back, a mid-level respawn would have to drop Mario into whatever
  // geometry happens to sit at the current screen edge — a pipe wall, a pit,
  // the inside of a staircase. Resetting to 0 here is the only way a death
  // respawn is both faithful and visually coherent. Nothing else in the
  // codebase may write Game.camera.x; that rule is unchanged.
  Game.resetLevel = function () {
    if (window.Level && typeof window.Level.init === 'function') window.Level.init();
    if (window.Actors && typeof window.Actors.init === 'function') window.Actors.init();
    Game.time = 400;
    Game._timeAcc = 0;
    Game._popups.length = 0;
    Game.camera.x = 0;      // see CAMERA note above — deliberate rule-4 exception
  };

  // Game.restart() — a brand-new game: stats, level, actors, Mario, ending
  // state, then straight into play. Both the title START and the game-over
  // RETRY button route through here. Without it, RETRY resumed a level that
  // was still broken/consumed from the previous run, with Mario left wherever
  // his death fall had put him.
  Game.restart = function () {
    resetStats();
    Game.resetLevel();
    if (window.Tiles) window.Tiles.flagHeight = 1;
    if (window.Finish && typeof window.Finish.init === 'function') window.Finish.init();
    if (window.Mario && typeof window.Mario.init === 'function') window.Mario.init();
    Game.setState('play');
  };

  // ---------- Palette ----------
  var Palette = {
    sky: '#5c94fc',
    ground: '#b45a1c',
    groundDark: '#7a3b10',
    brick: '#c84c0c',
    brickDark: '#8a3208',
    pipe: '#00a800',
    pipeLight: '#5cdc5c',
    question: '#fcbc3c',
    questionDark: '#c88820',
    marioRed: '#e40000',
    marioBlue: '#0058f8',
    marioSkin: '#fcbcac',
    goombaBrown: '#a0522d',
    koopaGreen: '#00ac00',
    white: '#fcfcfc',
    black: '#000000',
    flagGreen: '#00a800',
    castleRed: '#a83c1c'
  };
  window.Palette = Palette;

  // ---------- Physics: the shared collision resolver ----------
  //
  // Physics.moveBody(b) — b = {x,y,w,h,vx,vy,onGround,hitLeft,hitRight,hitCeil,hitTiles}
  //
  // Units: b.x/b.y/b.w/b.h are pixel floats; b.vx/b.vy are pixels-PER-FIXED-TICK
  // (this game runs a fixed 1/60s step, so callers just add gravity/speed as a
  // flat px-per-frame constant to vx/vy — moveBody does not multiply by dt).
  //
  // side convention (read this before bucket 4/5 touch hitTiles):
  //   `side` is the side of the TILE that the body struck, not the side of the
  //   body. A body moving up into a block hits the tile's UNDERSIDE, so that
  //   produces side:'bottom'. A body landing on a tile hits the tile's TOP,
  //   so that produces side:'top'. Moving right into a wall strikes the
  //   tile's LEFT face -> side:'left'. Moving left strikes the tile's RIGHT
  //   face -> side:'right'.
  //
  // Level.solidAt(col,row) is looked up at call time via window.Level so this
  // file never caches a reference to a namespace that may not exist yet.
  var Physics = {};
  window.Physics = Physics;

  function solidAt(col, row) {
    if (!window.Level || typeof window.Level.solidAt !== 'function') return false;
    return !!window.Level.solidAt(col, row);
  }

  // Move the body one axis-step of `amt` pixels along `axis` ('x' or 'y').
  // Returns true if a collision stopped the move (caller should not attempt
  // further sub-steps on this axis this call).
  function stepX(b, amt) {
    if (amt === 0) return false;
    var newX = b.x + amt;
    var top = b.y;
    var bottom = b.y + b.h - 0.01;
    var rowStart = Math.floor(top / Game.TILE_PX);
    var rowEnd = Math.floor(bottom / Game.TILE_PX);
    var row;

    if (amt > 0) {
      var rightEdge = newX + b.w;
      var col = Math.floor(rightEdge / Game.TILE_PX);
      var hit = false;
      for (row = rowStart; row <= rowEnd; row++) {
        if (solidAt(col, row)) { hit = true; b.hitTiles.push({ col: col, row: row, side: 'left' }); }
      }
      if (hit) {
        b.x = col * Game.TILE_PX - b.w;
        b.vx = 0;
        b.hitRight = true;
        return true;
      }
      b.x = newX;
      return false;
    } else {
      var col2 = Math.floor(newX / Game.TILE_PX);
      var hit2 = false;
      for (row = rowStart; row <= rowEnd; row++) {
        if (solidAt(col2, row)) { hit2 = true; b.hitTiles.push({ col: col2, row: row, side: 'right' }); }
      }
      if (hit2) {
        b.x = (col2 + 1) * Game.TILE_PX;
        b.vx = 0;
        b.hitLeft = true;
        return true;
      }
      b.x = newX;
      return false;
    }
  }

  function stepY(b, amt) {
    if (amt === 0) return false;
    var newY = b.y + amt;
    var left = b.x;
    var right = b.x + b.w - 0.01;
    var colStart = Math.floor(left / Game.TILE_PX);
    var colEnd = Math.floor(right / Game.TILE_PX);
    var col;

    if (amt > 0) {
      var bottomEdge = newY + b.h;
      var row = Math.floor(bottomEdge / Game.TILE_PX);
      var hit = false;
      for (col = colStart; col <= colEnd; col++) {
        if (solidAt(col, row)) { hit = true; b.hitTiles.push({ col: col, row: row, side: 'top' }); }
      }
      if (hit) {
        b.y = row * Game.TILE_PX - b.h;
        b.vy = 0;
        b.onGround = true;
        return true;
      }
      b.y = newY;
      return false;
    } else {
      var row2 = Math.floor(newY / Game.TILE_PX);
      var hit2 = false;
      for (col = colStart; col <= colEnd; col++) {
        if (solidAt(col, row2)) { hit2 = true; b.hitTiles.push({ col: col, row: row2, side: 'bottom' }); }
      }
      if (hit2) {
        b.y = (row2 + 1) * Game.TILE_PX;
        b.vy = 0;
        b.hitCeil = true;
        return true;
      }
      b.y = newY;
      return false;
    }
  }

  function moveAxis(b, axis) {
    var vel = axis === 'x' ? b.vx : b.vy;
    if (vel === 0) return;
    var steps = Math.max(1, Math.ceil(Math.abs(vel) / Game.TILE_PX));
    var stepAmt = vel / steps;
    for (var i = 0; i < steps; i++) {
      var blocked = axis === 'x' ? stepX(b, stepAmt) : stepY(b, stepAmt);
      if (blocked) break;
    }
  }

  Physics.moveBody = function (b) {
    b.hitLeft = false;
    b.hitRight = false;
    b.hitCeil = false;
    b.onGround = false;
    b.hitTiles = [];
    moveAxis(b, 'x');
    moveAxis(b, 'y');
  };

  // ---------- Input ----------
  var Input = { left: false, right: false, run: false, jump: false, jumpTapped: false };
  window.Input = Input;

  var LEFT_CODES = ['ArrowLeft', 'KeyA'];
  var RIGHT_CODES = ['ArrowRight', 'KeyD'];
  var RUN_CODES = ['ShiftLeft', 'ShiftRight', 'KeyX'];
  var JUMP_CODES = ['Space', 'ArrowUp', 'KeyW', 'KeyZ'];
  var ALL_GAME_CODES = LEFT_CODES.concat(RIGHT_CODES, RUN_CODES, JUMP_CODES);

  var keysDown = {};
  var touch = { left: false, right: false, run: false, jump: false };

  // jumpQueued is latched (edge-triggered) at the moment the key/touch first
  // goes down, NOT recomputed by comparing held-state between ticks. A tap
  // that presses and releases entirely between two fixed ticks would vanish
  // from keysDown before sampleInput() ever looked at it if we did the
  // naive "was it down last sample vs now" comparison -- that's a real way
  // to drop jump inputs at 60Hz, so the event handlers set this flag
  // directly instead of leaving edge-detection to the sampler.
  var jumpQueued = false;

  function isDown(codes) {
    for (var i = 0; i < codes.length; i++) if (keysDown[codes[i]]) return true;
    return false;
  }

  function sampleInput() {
    Input.left = isDown(LEFT_CODES) || touch.left;
    Input.right = isDown(RIGHT_CODES) || touch.right;
    Input.run = isDown(RUN_CODES) || touch.run;
    Input.jump = isDown(JUMP_CODES) || touch.jump;
    Input.jumpTapped = jumpQueued;
    jumpQueued = false;
  }

  window.addEventListener('keydown', function (e) {
    if (JUMP_CODES.indexOf(e.code) !== -1 && !keysDown[e.code]) jumpQueued = true;
    keysDown[e.code] = true;
    if (ALL_GAME_CODES.indexOf(e.code) !== -1 && e.preventDefault) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) {
    keysDown[e.code] = false;
  });

  function bindTouchZone(id, prop, isJump) {
    var el = document.getElementById(id);
    if (!el) return;
    var setOn = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (isJump && !touch[prop]) jumpQueued = true;
      touch[prop] = true;
    };
    var setOff = function (e) { if (e && e.preventDefault) e.preventDefault(); touch[prop] = false; };
    el.addEventListener('touchstart', setOn, { passive: false });
    el.addEventListener('touchend', setOff, { passive: false });
    el.addEventListener('touchcancel', setOff, { passive: false });
    el.addEventListener('mousedown', setOn);
    el.addEventListener('mouseup', setOff);
    el.addEventListener('mouseleave', setOff);
  }
  bindTouchZone('touchLeft', 'left');
  bindTouchZone('touchRight', 'right');
  bindTouchZone('touchJump', 'jump', true);
  bindTouchZone('touchRun', 'run');

  // ---------- canvas + integer pixel scaling ----------
  var canvas = document.getElementById('game');
  var ctx = null;
  if (canvas) {
    canvas.width = Game.NES_W;
    canvas.height = Game.NES_H;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
  }
  Game.ctx = ctx;

  function resize() {
    if (!canvas) return;
    var scale = Math.max(1, Math.floor(Math.min(window.innerWidth / Game.NES_W, window.innerHeight / Game.NES_H)));
    canvas.style.width = (Game.NES_W * scale) + 'px';
    canvas.style.height = (Game.NES_H * scale) + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- overlays + mute button ----------
  var titleOverlay = document.getElementById('titleOverlay');
  var gameOverOverlay = document.getElementById('gameOverOverlay');
  var startBtn = document.getElementById('startBtn');
  var restartBtn = document.getElementById('restartBtn');
  var muteBtn = document.getElementById('muteBtn');

  if (startBtn) startBtn.addEventListener('click', function () { Game.restart(); });
  if (restartBtn) restartBtn.addEventListener('click', function () { Game.restart(); });
  if (muteBtn) muteBtn.addEventListener('click', function () {
    if (window.Sfx) {
      window.Sfx.muted = !window.Sfx.muted;
      muteBtn.textContent = window.Sfx.muted ? '🔇' : '🔊';
    } else {
      var isMuted = muteBtn.getAttribute('data-muted') === '1';
      muteBtn.setAttribute('data-muted', isMuted ? '0' : '1');
      muteBtn.textContent = isMuted ? '🔊' : '🔇';
    }
  });

  // ---------- debug body (stands in for Mario until bucket 4 lands) ----------
  // Gated behind `if (!window.Mario)` everywhere it is touched, so it silently
  // disappears the moment 30-mario.js defines window.Mario.
  var debugBody = { x: 32, y: 0, w: 16, h: 16, vx: 0, vy: 0, onGround: false, hitLeft: false, hitRight: false, hitCeil: false, hitTiles: [] };
  var DEBUG_WALK = 1.3, DEBUG_RUN = 2.6, DEBUG_GRAV = 0.45, DEBUG_JUMP_V = -6.8, DEBUG_MAX_FALL = 8;

  function updateDebugBody() {
    var speed = Input.run ? DEBUG_RUN : DEBUG_WALK;
    debugBody.vx = 0;
    if (Input.left) debugBody.vx -= speed;
    if (Input.right) debugBody.vx += speed;

    debugBody.vy += DEBUG_GRAV;
    if (debugBody.vy > DEBUG_MAX_FALL) debugBody.vy = DEBUG_MAX_FALL;
    if (Input.jumpTapped && debugBody.onGround) debugBody.vy = DEBUG_JUMP_V;

    Physics.moveBody(debugBody);

    // Verification hook: log a strike when the debug box heads a ? block
    // from below. This is the mechanism the contract's "done when" section
    // asks for; bucket 5's Actors.strikeBlock() is the real owner later.
    for (var i = 0; i < debugBody.hitTiles.length; i++) {
      var h = debugBody.hitTiles[i];
      if (h.side === 'bottom' && window.Level && window.Level.TILE && window.Level.tileAt) {
        var t = window.Level.tileAt(h.col, h.row);
        if (t === window.Level.TILE.QUESTION) {
          console.log('[debug] struck QUESTION block from below at col=' + h.col + ' row=' + h.row);
        }
      }
    }

    // Fell into a pit — respawn for demo convenience.
    if (debugBody.y > Game.NES_H + 64) {
      debugBody.x = 32;
      debugBody.y = 0;
      debugBody.vx = 0;
      debugBody.vy = 0;
    }
  }

  function drawDebugBody() {
    if (!Game.ctx) return;
    Game.ctx.fillStyle = '#ff00ff';
    Game.ctx.fillRect(Math.round(debugBody.x - Game.camera.x), Math.round(debugBody.y), debugBody.w, debugBody.h);
  }

  // ---------- camera (right-only scroll; the only writer of Game.camera.x) ----------
  function updateCamera() {
    var target = window.Mario ? window.Mario : debugBody;
    var screenX = target.x - Game.camera.x;
    var DEADZONE_RIGHT = 112;
    if (screenX > DEADZONE_RIGHT) {
      Game.camera.x += screenX - DEADZONE_RIGHT;
    }
    var widthCols = (window.Level && typeof window.Level.WIDTH_COLS === 'number') ? window.Level.WIDTH_COLS : (Game.NES_W / Game.TILE_PX);
    var maxX = Math.max(0, widthCols * Game.TILE_PX - Game.NES_W);
    if (Game.camera.x > maxX) Game.camera.x = maxX;
    if (Game.camera.x < 0) Game.camera.x = 0;
  }

  // ---------- timer + popups ----------
  function updateTimer(dt) {
    if (Game.state !== 'play' || Game.time <= 0) return;
    Game._timeAcc += dt;
    while (Game._timeAcc >= 0.4 && Game.time > 0) {
      Game._timeAcc -= 0.4;
      Game.time -= 1;
    }
  }

  function updatePopups(dt) {
    for (var i = Game._popups.length - 1; i >= 0; i--) {
      var p = Game._popups[i];
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) Game._popups.splice(i, 1);
    }
  }

  function drawPopups() {
    if (!Game.ctx || Game._popups.length === 0) return;
    var ctx2 = Game.ctx;
    ctx2.save();
    ctx2.font = '8px monospace';
    ctx2.textBaseline = 'bottom';
    for (var i = 0; i < Game._popups.length; i++) {
      var p = Game._popups[i];
      ctx2.globalAlpha = Math.max(0, Math.min(1, p.life / 0.8));
      ctx2.fillStyle = Palette.white;
      ctx2.fillText(p.text, Math.round(p.x - Game.camera.x), Math.round(p.y));
    }
    ctx2.globalAlpha = 1;
    ctx2.restore();
  }

  // ---------- HUD ----------
  function pad(n, len) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < len) s = '0' + s;
    return s;
  }

  function drawHUD() {
    if (!Game.ctx) return;
    var ctx2 = Game.ctx;
    ctx2.save();
    ctx2.font = '8px monospace';
    ctx2.textBaseline = 'top';
    ctx2.fillStyle = Palette.white;
    ctx2.fillText('MARIO', 16, 8);
    ctx2.fillText(pad(Game.score, 6), 16, 17);
    ctx2.fillStyle = Palette.question;
    ctx2.fillRect(88, 17, 6, 7);
    ctx2.fillStyle = Palette.white;
    ctx2.fillText('×' + pad(Game.coins, 2), 97, 17);
    ctx2.fillText('WORLD', 160, 8);
    ctx2.fillText('1-1', 168, 17);
    ctx2.fillText('TIME', 216, 8);
    ctx2.fillText(pad(Game.time, 3), 216, 17);
    ctx2.restore();
  }

  // ---------- namespace boot (init() hooks) ----------
  function hasFn(ns, fn) { return !!(window[ns] && typeof window[ns][fn] === 'function'); }

  function bootNamespaces() {
    var names = ['Level', 'Tiles', 'Mario', 'Actors', 'Finish'];
    for (var i = 0; i < names.length; i++) {
      if (hasFn(names[i], 'init')) window[names[i]].init();
    }
  }

  // ---------- fixed-timestep loop ----------
  var STEP = 1 / 60;
  var MAX_STEPS_PER_FRAME = 5;
  var acc = 0;
  var lastTime = null;

  function tick(dt) {
    sampleInput();
    if (Game.state === 'play') {
      if (hasFn('Mario', 'update')) window.Mario.update(dt); else updateDebugBody();
      if (hasFn('Actors', 'update')) window.Actors.update(dt);
      if (hasFn('Tiles', 'update')) window.Tiles.update(dt);
      if (hasFn('Finish', 'update')) window.Finish.update(dt);
      updateCamera();
      updateTimer(dt);
      updatePopups(dt);
    }
    Input.jumpTapped = false;
  }

  function drawSceneLayers() {
    if (hasFn('Tiles', 'drawBackdrop')) window.Tiles.drawBackdrop();
    if (hasFn('Tiles', 'drawLevel')) window.Tiles.drawLevel();
    if (hasFn('Actors', 'draw')) window.Actors.draw();
    if (hasFn('Mario', 'draw')) window.Mario.draw(); else drawDebugBody();
    if (hasFn('Finish', 'draw')) window.Finish.draw();
    if (hasFn('Tiles', 'drawForeground')) window.Tiles.drawForeground();
    drawPopups();
  }

  function render() {
    if (!Game.ctx) return;
    Game.ctx.clearRect(0, 0, Game.NES_W, Game.NES_H);
    Game.ctx.fillStyle = Palette.sky;
    Game.ctx.fillRect(0, 0, Game.NES_W, Game.NES_H);
    if (Game.state === 'play' || Game.state === 'dying' || Game.state === 'clear') {
      drawSceneLayers();
    }
    drawHUD();
  }

  function frame(now) {
    if (lastTime === null) lastTime = now;
    var delta = (now - lastTime) / 1000;
    lastTime = now;
    acc += delta;
    var steps = 0;
    while (acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      tick(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) acc = 0; // backgrounded-tab catch-up guard
    render();
    window.requestAnimationFrame(frame);
  }

  function boot() {
    bootNamespaces();
    Game.setState('title');
    window.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
