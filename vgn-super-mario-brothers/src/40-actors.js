
// 40-actors.js — Bucket 5: everything that moves except Mario.
//
// Owns: Goombas, Koopa Troopas (+ shells), power-up items, block debris,
// score-chain bookkeeping, and — the linchpin — Actors.strikeBlock(), the
// single owner of block-strike resolution (CONTRACT.md hard rule 6). Mario,
// Tiles and the assembly bucket all delegate block behaviour here rather than
// each inventing their own, so this file is the only place that reads
// Level.CONTENTS, spawns items, or turns a struck tile into USED/EMPTY.
//
// Units: vx/vy are PIXELS PER FIXED TICK. Physics.moveBody() does not
// multiply by dt (00-core.js:93-95), so every motion constant below is a flat
// per-frame amount. Timers (squash linger, shell revive, coin-block window)
// are in SECONDS and use dt, because they are wall-clock things.
//
// Direction authority: Physics.stepX() zeroes b.vx on wall contact, so an
// actor whose heading lives only in vx would stop dead instead of reversing.
// Every walker therefore keeps `dir` (+1/-1) as the authority and re-derives
// vx from it at the top of each update.
//
// Style rule (CONTRACT.md #1): no bare top-level const/let; the whole file is
// one IIFE assigning only window.Actors, and no other namespace is touched at
// file scope.
(function () {
  'use strict';

  // ==========================================================================
  // Tuning
  // ==========================================================================
  var GRAV = 0.32;           // px/tick^2 for walkers and items
  var MAX_FALL = 8.0;        // px/tick terminal velocity (< 16 => no tunneling)

  var GOOMBA_SPEED = 0.40;   // px/tick (24 px/s) — a quarter of Mario's walk
  var KOOPA_SPEED = 0.45;    // px/tick
  var SHELL_SPEED = 3.0;     // px/tick — faster than running Mario (2.6)
  var MUSH_SPEED = 0.60;     // px/tick
  var STAR_SPEED = 1.30;     // px/tick
  var STAR_BOUNCE = 4.0;     // px/tick upward kick each time the star lands

  var EMERGE_PX_PER_TICK = 16 / 30;   // one tile in ~0.5 s — signature SMB rise

  var SQUASH_TIME = 0.5;     // s a flattened Goomba lingers
  var SHELL_REVIVE = 5.0;    // s before an untouched shell walks again
  var TURN_CD = 0.15;        // s of reversal cooldown so two enemies unstick
  var KICK_GRACE = 0.18;     // s after a kick during which a shell can't hurt

  var FLIP_POP = 3.6;        // px/tick upward pop when an enemy is flipped
  var FLIP_DRIFT = 0.5;      // px/tick sideways drift while flipping away

  var ACTIVATE_MARGIN = 16;  // px past the right screen edge where spawns wake
  var CULL_BEHIND = 64;      // px behind the camera before an actor is culled
  var CULL_BELOW = 64;       // px below the level before an actor is culled

  var COIN10_WINDOW = 2.0;   // s the multi-coin brick stays live
  var COIN10_MAX = 10;       // coins before it retires early

  var BRICK_SCORE = 50;
  var ITEM_SCORE = 1000;

  // 100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000, then a 1-up.
  var CHAIN = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];

  var SPRITE_W = 16;

  // ==========================================================================
  // Sprite art — one char per pixel, blitted as 1x1..Nx1 fillRects. No images,
  // no sheets, no base64. Rows are normalised to SPRITE_W in init() and any
  // wrong-width row is reported rather than silently mangled.
  //
  //   K outline   B body   W white   k pupil   D dark/feet
  //   G green     Y trim/skin   R cap   S stem   O petal
  // ==========================================================================
  var GOOMBA_A = [
    '.....KKKKKK.....',
    '...KKBBBBBBKK...',
    '..KBBBBBBBBBBK..',
    '..KBWWBBBBWWBK..',
    '.KBBWkWBBWkWBBK.',
    '.KBBWkWBBWkWBBK.',
    '.KBBWWBBBBWWBBK.',
    'KBBBBBBBBBBBBBBK',
    'KBBBBBBBBBBBBBBK',
    'KBBBKKKKKKKKBBBK',
    '.KBBBBBBBBBBBBK.',
    '..KKBBBBBBBBKK..',
    '...KKKKKKKKKK...',
    '..DDDD....DDDD..',
    '.DDDDDD..DDDDDD.',
    '..DDDD....DDDD..'
  ];
  var GOOMBA_B = [
    '.....KKKKKK.....',
    '...KKBBBBBBKK...',
    '..KBBBBBBBBBBK..',
    '..KBWWBBBBWWBK..',
    '.KBBWkWBBWkWBBK.',
    '.KBBWkWBBWkWBBK.',
    '.KBBWWBBBBWWBBK.',
    'KBBBBBBBBBBBBBBK',
    'KBBBBBBBBBBBBBBK',
    'KBBBKKKKKKKKBBBK',
    '.KBBBBBBBBBBBBK.',
    '..KKBBBBBBBBKK..',
    '...KKKKKKKKKK...',
    '.DDDD......DDDD.',
    'DDDDDD....DDDDDD',
    '.DDDD......DDDD.'
  ];
  // Flattened Goomba: 8 rows, drawn feet-anchored so it sits on the ground.
  var GOOMBA_FLAT = [
    '................',
    '................',
    '.....KKKKKK.....',
    '..KKBBBBBBBBKK..',
    '.KBWWBBBBBBWWBK.',
    '.KBBBBBBBBBBBBK.',
    'KKKKKKKKKKKKKKKK',
    '.DDDD......DDDD.'
  ];

  // Koopa Troopa: 24 px tall, assembled head ++ shell ++ legs so the two-frame
  // walk cycle is two small leg blocks rather than two near-duplicate sprites.
  var KOOPA_HEAD = [
    '......DDDD......',
    '.....DGGGGD.....',
    '.....DGWkGD.....',
    '.....DGWkGD.....',
    '.....DGGGGD.....',
    '......DGGD......',
    '.....DDGGDD.....',
    '....DYYYYYYD....'
  ];
  var KOOPA_SHELLBODY = [
    '...DYGGGGGGYD...',
    '..DYGGGGGGGGYD..',
    '..DYGDGGGGDGYD..',
    '..DYGGDGGDGGYD..',
    '..DYGGDGGDGGYD..',
    '..DYGDGGGGDGYD..',
    '..DYGGGGGGGGYD..',
    '...DYGGGGGGYD...',
    '....DYYYYYYD....',
    '.....DDDDDD.....'
  ];
  var KOOPA_LEGS_A = [
    '...YY......YY...',
    '..YYY......YYY..',
    '..WWW......WWW..',
    '..WWWW....WWWW..',
    '...WW......WW...',
    '................'
  ];
  var KOOPA_LEGS_B = [
    '....YY....YY....',
    '...YYY....YYY...',
    '...WWW....WWW...',
    '..WWWW....WWWW..',
    '..WW........WW..',
    '................'
  ];
  var SHELL = [
    '................',
    '................',
    '.....DDDDDD.....',
    '...DDYYYYYYDD...',
    '..DYYGGGGGGYYD..',
    '.DYGGGGGGGGGGYD.',
    '.DYGGDGGGGDGGYD.',
    'DYGGGDGGGGDGGGYD',
    'DYGGGDGGGGDGGGYD',
    '.DYGGDGGGGDGGYD.',
    '.DYGGGGGGGGGGYD.',
    '..DYYGGGGGGYYD..',
    '...DDYYYYYYDD...',
    '.....DDDDDD.....',
    '................',
    '................'
  ];

  var MUSHROOM = [
    '.....KKKKKK.....',
    '...KKRRRRRRKK...',
    '..KRRWWRRWWRRK..',
    '.KRRWWWWRWWWWRK.',
    '.KRWWWWRRRWWWWK.',
    'KRRWWRRRRRRWWRRK',
    'KRWWRRRRRRRRWWRK',
    'KRRRRRRRRRRRRRRK',
    '.KKRRRRRRRRRRKK.',
    '...KKKKKKKKKK...',
    '....KSSSSSSK....',
    '....KSKSSKSK....',
    '....KSKSSKSK....',
    '....KSSSSSSK....',
    '....KSSSSSSK....',
    '.....KKKKKK.....'
  ];

  var FLOWER = [
    '....KKKKKKKK....',
    '..KKWWOOOOWWKK..',
    '.KWWOOOOOOOOWWK.',
    '.KWOOKOOOOKOOWK.',
    '.KWOOKOOOOKOOWK.',
    '.KWOOOOOOOOOOWK.',
    '.KWWOOOOOOOOWWK.',
    '..KKWWOOOOWWKK..',
    '....KKKKKKKK....',
    '.......GG.......',
    '......GGGG......',
    '.....GG..GG.....',
    '....GG....GG....',
    '...GG..GG..GG...',
    '..GG...GG...GG..',
    '...G...GG...G...'
  ];

  var STAR = [
    '.......KK.......',
    '......KYYK......',
    '......KYYK......',
    '.....KKYYKK.....',
    'KKKKKKYYYYKKKKKK',
    'KYYYYYYYYYYYYYYK',
    '.KYYYYYYYYYYYYK.',
    '..KYYkYYYYkYYK..',
    '...KYYkYYkYYK...',
    '...KYYYYYYYYK...',
    '..KYYYYYYYYYYK..',
    '..KYYYKYYKYYYK..',
    '.KYYYK.KK.KYYYK.',
    '.KYYK...KK...KYK',
    '.KK.....KK.....K',
    '................'
  ];

  var SPR = null;      // normalised sprite table, built in init()
  var LEG = null;      // { goomba, koopa, shell, mushroom, oneup, flower[], star[] }

  // ==========================================================================
  // Namespace
  // ==========================================================================
  var list = [];       // live actors (contract: Actors.list)
  var pending = [];    // dormant spawn records, woken near the camera
  var coinBlocks = {}; // "col,row" -> { col, row, n, t } for the multi-coin brick
  var chainIdx = 0;    // stomp-chain position; reset when Mario lands
  var clock = 0;       // seconds, for colour pulses

  var Actors = { list: list };
  window.Actors = Actors;

  function ns(n) { return window[n]; }
  function tp() { var G = ns('Game'); return (G && G.TILE_PX) || 16; }

  function sfx(name) {
    var S = ns('Sfx');
    if (S && typeof S.play === 'function') S.play(name);
  }
  function bumpTile(col, row) {
    var T = ns('Tiles');
    if (T && typeof T.bumpBlock === 'function') T.bumpBlock(col, row);
  }
  function popCoinTile(col, row) {
    var T = ns('Tiles');
    if (T && typeof T.popCoin === 'function') T.popCoin(col, row);
  }
  function addScore(n, x, y) {
    var G = ns('Game');
    if (G && typeof G.addScore === 'function') G.addScore(n, x, y);
  }
  function addCoin() {
    var G = ns('Game');
    if (G && typeof G.addCoin === 'function') G.addCoin();
  }

  // ---------- sprite table assembly + audit ----------
  function padRow(row) {
    var s = String(row);
    if (s.length > SPRITE_W) return s.slice(0, SPRITE_W);
    while (s.length < SPRITE_W) s += '.';
    return s;
  }
  function audit(name, rows) {
    var out = [], i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].length !== SPRITE_W && typeof console !== 'undefined' && console.warn) {
        console.warn('[Actors] sprite "' + name + '" row ' + i + ' is ' +
          rows[i].length + ' px wide, expected ' + SPRITE_W);
      }
      out.push(padRow(rows[i]));
    }
    return out;
  }

  function buildSprites() {
    SPR = {
      goomba: [audit('goomba.a', GOOMBA_A), audit('goomba.b', GOOMBA_B)],
      goombaFlat: audit('goomba.flat', GOOMBA_FLAT),
      koopa: [
        audit('koopa.a', KOOPA_HEAD.concat(KOOPA_SHELLBODY, KOOPA_LEGS_A)),
        audit('koopa.b', KOOPA_HEAD.concat(KOOPA_SHELLBODY, KOOPA_LEGS_B))
      ],
      shell: audit('shell', SHELL),
      mushroom: audit('mushroom', MUSHROOM),
      flower: audit('flower', FLOWER),
      star: audit('star', STAR)
    };
  }

  function buildLegends() {
    var P = ns('Palette') || {};
    var brown = P.goombaBrown || '#a0522d';
    var green = P.koopaGreen || '#00ac00';
    var white = P.white || '#fcfcfc';
    var black = P.black || '#000000';
    var trim = P.question || '#fcbc3c';
    var deepGreen = '#00641c';
    var darkBrown = '#4c2408';

    LEG = {
      goomba: { K: black, B: brown, W: white, k: black, D: darkBrown },
      koopa: { D: deepGreen, G: green, Y: trim, W: white, k: black },
      shell: { D: deepGreen, G: green, Y: trim, W: white, k: black },
      mushroom: { K: black, R: P.marioRed || '#e40000', W: white, S: P.marioSkin || '#fcbcac' },
      oneup: { K: black, R: green, W: white, S: P.marioSkin || '#fcbcac' },
      // Fire flower pulses its petals; four legends cycled ~8x/sec.
      flower: [
        { K: black, W: white, O: trim, G: green },
        { K: black, W: white, O: P.marioRed || '#e40000', G: green },
        { K: black, W: white, O: white, G: green },
        { K: black, W: white, O: P.questionDark || '#c88820', G: green }
      ],
      // Star cycles like the original's flashing palette.
      star: [
        { K: black, Y: trim, k: black },
        { K: black, Y: white, k: black },
        { K: black, Y: P.questionDark || '#c88820', k: black },
        { K: black, Y: P.marioRed || '#e40000', k: black }
      ]
    };
  }

  // ==========================================================================
  // Actor construction
  // ==========================================================================
  function makeActor(kind, x, y, w, h) {
    return {
      kind: kind,        // 'goomba' | 'koopa' | 'mushroom' | '1up' | 'flower' | 'star' | 'debris'
      state: 'walk',     // 'walk' | 'shell' | 'slide' | 'squashed' | 'flipped' | 'emerge' | 'idle' | 'debris'
      x: x, y: y, w: w, h: h,
      vx: 0, vy: 0,
      dir: -1,
      gravity: true,
      collide: true,
      onGround: false,
      hitLeft: false, hitRight: false, hitCeil: false, hitTiles: [],
      anim: 0, frame: 0,
      timer: 0,
      turnCd: 0,
      noHurt: 0,
      chain: 0,          // per-shell chain-kill counter
      homeRow: 0, homeCol: 0,
      emergeTo: 0,
      dead: false
    };
  }

  function isEnemy(a) {
    return (a.kind === 'goomba' || a.kind === 'koopa') &&
      (a.state === 'walk' || a.state === 'shell' || a.state === 'slide');
  }
  function isItem(a) {
    return a.kind === 'mushroom' || a.kind === '1up' || a.kind === 'flower' || a.kind === 'star';
  }
  function isSliding(a) { return a.kind === 'koopa' && a.state === 'slide'; }

  function speedOf(a) {
    if (a.kind === 'goomba') return GOOMBA_SPEED;
    if (a.kind === 'koopa') {
      if (a.state === 'slide') return SHELL_SPEED;
      if (a.state === 'shell') return 0;
      return KOOPA_SPEED;
    }
    if (a.kind === 'mushroom' || a.kind === '1up') return MUSH_SPEED;
    if (a.kind === 'star') return STAR_SPEED;
    return 0;
  }

  // Contract: Actors.spawn(kind, col, row). Enemies land on `row`; items
  // emerge out of the block AT `row` and end up standing on top of it.
  Actors.spawn = function (kind, col, row) {
    var T = tp();
    var bx = col * T;
    var a;
    if (kind === 'goomba') {
      a = makeActor('goomba', bx + 1, row * T + T - 16, 14, 16);
      a.dir = -1;
    } else if (kind === 'koopa') {
      a = makeActor('koopa', bx + 1, row * T + T - 24, 14, 24);
      a.dir = -1;
    } else if (kind === 'mushroom' || kind === '1up' || kind === 'flower' || kind === 'star') {
      // Starts fully inside the block; rises one tile before becoming active.
      a = makeActor(kind, bx, row * T, 16, 16);
      a.state = 'emerge';
      a.gravity = false;
      a.collide = false;
      a.dir = 1;
      a.homeCol = col;
      a.homeRow = row;
      a.emergeTo = (row - 1) * T;
    } else {
      return null;
    }
    list.push(a);
    return a;
  };

  function spawnDebris(col, row) {
    var T = tp();
    var bx = col * T, by = row * T;
    var offs = [
      [2, 2, -1.1, -4.4], [10, 2, 1.1, -4.4],
      [2, 9, -0.8, -2.8], [10, 9, 0.8, -2.8]
    ];
    var i, a;
    for (i = 0; i < offs.length; i++) {
      a = makeActor('debris', bx + offs[i][0], by + offs[i][1], 4, 4);
      a.state = 'debris';
      a.collide = false;
      a.vx = offs[i][2];
      a.vy = offs[i][3];
      list.push(a);
    }
  }

  // ==========================================================================
  // Scoring
  // ==========================================================================
  // The stomp/chain ladder. Past the end of the table SMB awards a 1-up.
  function chainAward(idx, x, y) {
    if (idx >= CHAIN.length) {
      var M = ns('Mario');
      if (M && typeof M.powerUp === 'function') M.powerUp('1up');
      return '1up';
    }
    addScore(CHAIN[idx], x, y);
    return CHAIN[idx];
  }

  // ==========================================================================
  // Deaths
  // ==========================================================================
  // Flip an enemy onto its back: no collision, pops up, tumbles off-screen.
  // Used by star contact, sliding shells, and blocks struck from below.
  function flipEnemy(a, awayDir) {
    a.state = 'flipped';
    a.collide = false;
    a.gravity = false;
    a.vy = -FLIP_POP;
    a.vx = (awayDir || 1) * FLIP_DRIFT;
    a.timer = 0;
  }

  function squashGoomba(a) {
    a.state = 'squashed';
    a.y = a.y + a.h - 8;
    a.h = 8;
    a.vx = 0;
    a.vy = 0;
    a.collide = false;
    a.gravity = false;
    a.timer = SQUASH_TIME;
  }

  function koopaToShell(a) {
    var bottom = a.y + a.h;
    a.state = 'shell';
    a.h = 16;
    a.y = bottom - 16;
    a.vx = 0;
    a.timer = SHELL_REVIVE;
  }

  function shellToKoopa(a) {
    var bottom = a.y + a.h;
    a.state = 'walk';
    a.h = 24;
    a.y = bottom - 24;
    a.chain = 0;
    a.timer = 0;
  }

  function kickShell(a, dir) {
    a.state = 'slide';
    a.dir = dir;
    a.vx = dir * SHELL_SPEED;
    a.chain = 0;
    a.noHurt = KICK_GRACE;
    sfx('kick');
  }

  // ==========================================================================
  // Spawn activation / culling
  // ==========================================================================
  function rebuildPending() {
    var L = ns('Level');
    var T = tp();
    pending.length = 0;
    if (!L || !L.SPAWNS) return;
    var i, s;
    for (i = 0; i < L.SPAWNS.length; i++) {
      s = L.SPAWNS[i];
      if (!s) continue;
      // 'flagpole' and 'castle' are bucket 3's drawing anchors, not actors.
      if (s.kind !== 'goomba' && s.kind !== 'koopa') continue;
      pending.push({ kind: s.kind, col: s.col, row: s.row, px: s.col * T, done: false });
    }
  }

  // SMB wakes an enemy as its column reaches the right edge of the view.
  // Waking all 16 Goombas at load means most have walked into a pit before
  // Mario ever arrives, so this gate is behaviour, not an optimisation.
  function activateSpawns() {
    var G = ns('Game');
    if (!G) return;
    var limit = G.camera.x + G.NES_W + ACTIVATE_MARGIN;
    var i, s;
    for (i = 0; i < pending.length; i++) {
      s = pending[i];
      if (s.done) continue;
      if (s.px <= limit) {
        s.done = true;
        Actors.spawn(s.kind, s.col, s.row);
      }
    }
  }

  function cull() {
    var G = ns('Game');
    var camX = G ? G.camera.x : 0;
    var floorY = ((G && G.LEVEL_ROWS) || 15) * tp() + CULL_BELOW;
    var i, a;
    for (i = list.length - 1; i >= 0; i--) {
      a = list[i];
      if (a.dead || a.y > floorY || (a.x + a.w) < camX - CULL_BEHIND) list.splice(i, 1);
    }
  }

  // ==========================================================================
  // Per-actor update
  // ==========================================================================
  function moveWithPhysics(a) {
    var Ph = ns('Physics');
    if (Ph && typeof Ph.moveBody === 'function') {
      Ph.moveBody(a);
    } else {
      a.x += a.vx;
      a.y += a.vy;
    }
  }

  function animate(a, dt) {
    a.anim += dt;
    if (a.anim >= 0.16) { a.anim -= 0.16; a.frame = (a.frame + 1) % 2; }
  }

  function updateActor(a, dt) {
    if (a.dead) return;
    if (a.turnCd > 0) a.turnCd = Math.max(0, a.turnCd - dt);
    if (a.noHurt > 0) a.noHurt = Math.max(0, a.noHurt - dt);

    // ---- non-colliding, purely ballistic states
    if (a.state === 'flipped' || a.state === 'debris') {
      a.vy += GRAV;
      if (a.vy > MAX_FALL + 4) a.vy = MAX_FALL + 4;
      a.x += a.vx;
      a.y += a.vy;
      a.timer += dt;
      return;
    }
    if (a.state === 'squashed') {
      a.timer -= dt;
      if (a.timer <= 0) a.dead = true;
      return;
    }
    if (a.state === 'emerge') {
      a.y -= EMERGE_PX_PER_TICK;
      if (a.y <= a.emergeTo) {
        a.y = a.emergeTo;
        if (a.kind === 'flower') {
          a.state = 'idle';          // stationary on top of its block
          a.gravity = false;
          a.collide = false;
        } else {
          a.state = 'walk';
          a.gravity = true;
          a.collide = true;
          a.vx = a.dir * speedOf(a);
        }
      }
      return;
    }
    if (a.state === 'idle') return;   // fire flower: sits still, pulses

    // ---- walkers: goomba, walking koopa, shell (still or sliding), items
    if (a.kind === 'koopa' && a.state === 'shell') {
      a.timer -= dt;
      if (a.timer <= 0) { shellToKoopa(a); }
    }

    var spd = speedOf(a);
    a.vx = a.dir * spd;
    if (a.gravity) {
      a.vy += GRAV;
      if (a.vy > MAX_FALL) a.vy = MAX_FALL;
    }

    moveWithPhysics(a);

    // Physics zeroed vx on the wall hit; `dir` is the authority, so flip it.
    if (a.hitLeft || a.hitRight) {
      a.dir = -a.dir;
      a.vx = a.dir * spd;
    }

    // The star bounces along the ground instead of walking flat.
    if (a.kind === 'star' && a.onGround) a.vy = -STAR_BOUNCE;

    if (spd > 0) animate(a, dt);
  }

  // ==========================================================================
  // Overlap helpers
  // ==========================================================================
  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function actorsOverlap(a, b) {
    return overlap(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h);
  }

  // ==========================================================================
  // Enemy vs enemy — reverse both, or chain-kill if one is a sliding shell
  // ==========================================================================
  function shellKill(shell, victim) {
    var away = (victim.x + victim.w / 2 < shell.x + shell.w / 2) ? -1 : 1;
    flipEnemy(victim, away);
    chainAward(shell.chain, victim.x, victim.y);
    shell.chain++;
    sfx('stomp');
  }

  function enemyVsEnemy() {
    var i, j, a, b;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a.dead || !isEnemy(a)) continue;
      for (j = i + 1; j < list.length; j++) {
        b = list[j];
        if (b.dead || !isEnemy(b)) continue;
        if (!actorsOverlap(a, b)) continue;
        if (isSliding(a) && !isSliding(b)) { shellKill(a, b); continue; }
        if (isSliding(b) && !isSliding(a)) { shellKill(b, a); continue; }
        if (a.state === 'shell' || b.state === 'shell') continue;  // still shell is scenery
        if (a.turnCd > 0 || b.turnCd > 0) continue;
        a.dir = -a.dir; a.turnCd = TURN_CD;
        b.dir = -b.dir; b.turnCd = TURN_CD;
      }
    }
  }

  // ==========================================================================
  // Mario vs actors
  // ==========================================================================
  function collectItem(a, M) {
    a.dead = true;
    var cx = a.x, cy = a.y;
    if (a.kind === '1up') {
      if (M.powerUp) M.powerUp('1up');           // Mario adds the life + sfx
      return;
    }
    if (a.kind === 'mushroom') {
      // Mario.powerUp('mushroom') already awards 1000 itself when he is not
      // small (30-mario.js), so adding it here too would double-count.
      var wasSmall = (M.power === 'small');
      if (M.powerUp) M.powerUp('mushroom');
      if (wasSmall) addScore(ITEM_SCORE, cx, cy);
      return;
    }
    if (M.powerUp) M.powerUp(a.kind);            // 'flower' | 'star'
    addScore(ITEM_SCORE, cx, cy);
  }

  function doStomp(a, M) {
    var cx = a.x, cy = a.y;
    if (a.kind === 'goomba') {
      squashGoomba(a);
      chainAward(chainIdx, cx, cy);
      chainIdx++;
      sfx('stomp');
      if (M.bounce) M.bounce();
      return;
    }
    // koopa
    if (a.state === 'walk') {
      koopaToShell(a);
      chainAward(chainIdx, cx, cy);
      chainIdx++;
      sfx('stomp');
      if (M.bounce) M.bounce();
      return;
    }
    if (a.state === 'shell') {
      kickShell(a, (a.x + a.w / 2 >= M.x + M.w / 2) ? 1 : -1);
      if (M.bounce) M.bounce();
      return;
    }
    // stomping a sliding shell stops it dead
    a.state = 'shell';
    a.vx = 0;
    a.chain = 0;
    a.timer = SHELL_REVIVE;
    sfx('stomp');
    if (M.bounce) M.bounce();
  }

  function sideContact(a, M) {
    // A stationary shell is kicked, not lethal.
    if (a.kind === 'koopa' && a.state === 'shell') {
      kickShell(a, (a.x + a.w / 2 >= M.x + M.w / 2) ? 1 : -1);
      return;
    }
    if (a.noHurt > 0) return;         // brief grace right after Mario kicks it
    if (M.hurt) M.hurt();             // self-guards on invuln AND star
  }

  function marioVsActors() {
    var M = ns('Mario');
    if (!M || typeof M.bbox !== 'function') return;
    var mb = M.bbox();
    var feet = mb.y + mb.h;
    // Snapshotted with `feet`, NOT re-read per actor: doStomp calls
    // Mario.bounce(), which sets vy negative. Reading vy live would make the
    // SECOND enemy of an overlapping pair register as a side hit, so landing
    // between two adjacent Goombas (cols 54/55, 80/82, 100/101, 117/118,
    // 127/128, 131/132, 177/178 — 1-1 is full of them) would stomp one and be
    // killed by the other in the same tick.
    var descending = (M.vy > 0);
    var i, a;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a.dead) continue;
      if (a.state === 'emerge' || a.state === 'flipped' ||
        a.state === 'squashed' || a.state === 'debris') continue;
      if (!overlap(mb.x, mb.y, mb.w, mb.h, a.x, a.y, a.w, a.h)) continue;

      if (isItem(a)) { collectItem(a, M); continue; }
      if (!isEnemy(a)) continue;

      if (M.star > 0) {
        var away = (a.x + a.w / 2 < mb.x + mb.w / 2) ? -1 : 1;
        flipEnemy(a, away);
        chainAward(chainIdx, a.x, a.y);
        chainIdx++;
        sfx('kick');
        continue;
      }

      // Standard test: descending, and his feet are above the actor's midline.
      var stomping = descending && (feet <= a.y + a.h / 2 + 4);
      if (stomping) doStomp(a, M);
      else sideContact(a, M);
    }
  }

  // ==========================================================================
  // Block strikes — the sole owner (CONTRACT.md hard rule 6)
  // ==========================================================================
  // A struck block kills or flips whatever is standing on it. moveBody lands
  // an actor at exactly row*TILE_PX - h, so a tight tolerance is enough and
  // avoids flipping enemies on the neighbouring block.
  function killEnemiesOn(col, row) {
    var T = tp();
    var top = row * T;
    var i, a, away;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a.dead || !isEnemy(a)) continue;
      if (!a.onGround) continue;
      if (Math.abs((a.y + a.h) - top) > 4) continue;
      if (a.x + a.w <= col * T || a.x >= col * T + T) continue;
      away = (a.x + a.w / 2 < col * T + T / 2) ? -1 : 1;
      flipEnemy(a, away);
      chainAward(0, a.x, a.y);
      sfx('kick');
    }
  }

  function closeCoinBlock(key) {
    var cb = coinBlocks[key];
    if (!cb) return;
    var L = ns('Level');
    if (L) {
      L.setTile(cb.col, cb.row, L.TILE.USED);
      if (L.CONTENTS) delete L.CONTENTS[key];
    }
    delete coinBlocks[key];
  }

  function updateCoinBlocks(dt) {
    var k;
    for (k in coinBlocks) {
      if (!Object.prototype.hasOwnProperty.call(coinBlocks, k)) continue;
      coinBlocks[k].t -= dt;
      if (coinBlocks[k].t <= 0) closeCoinBlock(k);
    }
  }

  // The multi-coin brick: one coin per strike for ~2 s or ~10 coins, whichever
  // ends first. It stays a live tile (and keeps its CONTENTS entry) until the
  // window closes, which is the one exception to the delete-on-strike rule.
  function strikeCoinBlock(col, row, key) {
    var cb = coinBlocks[key];
    if (!cb) {
      cb = { col: col, row: row, n: 0, t: COIN10_WINDOW };
      coinBlocks[key] = cb;
    }
    cb.n++;
    bumpTile(col, row);
    popCoinTile(col, row);
    addCoin();
    sfx('coin');
    if (cb.n >= COIN10_MAX) closeCoinBlock(key);
  }

  Actors.strikeBlock = function (col, row, fromPower) {
    var L = ns('Level');
    if (!L || !L.TILE) return;
    var T = tp();
    var key = col + ',' + row;
    var t = L.tileAt(col, row);
    var content = L.CONTENTS ? L.CONTENTS[key] : null;
    var power = fromPower || 'small';
    var cx = col * T + T / 2;
    var cy = row * T;

    // Happens first: geometry, not tile state, so it is right for every branch
    // (including the branch where the brick is about to be destroyed).
    killEnemiesOn(col, row);

    if (content) {
      if (content === 'coin10') { strikeCoinBlock(col, row, key); return; }
      bumpTile(col, row);
      if (content === 'coin') {
        popCoinTile(col, row);
        addCoin();
        sfx('coin');
      } else {
        // SMB stores one power-up code and resolves it at strike time: a
        // mushroom for small Mario, a fire flower once he is already big.
        // 1-1's data has no dedicated flower block; this is why one exists.
        var kind = content;
        if (kind === 'mushroom' && (power === 'big' || power === 'fire')) kind = 'flower';
        Actors.spawn(kind, col, row);
        sfx('powerup');
      }
      delete L.CONTENTS[key];
      // INVIS_1UP included: turning it USED is what makes it appear.
      L.setTile(col, row, L.TILE.USED);
      return;
    }

    // Empty brick (no CONTENTS entry): breakable by big/fire Mario only.
    // Checking CONTENTS first is what keeps (101,9)'s star from being smashed.
    if (t === L.TILE.BRICK || t === L.TILE.COIN_BRICK) {
      if (power !== 'small') {
        L.setTile(col, row, L.TILE.EMPTY);
        spawnDebris(col, row);
        sfx('break');
        addScore(BRICK_SCORE, cx, cy);
      } else {
        bumpTile(col, row);
        sfx('bump');
      }
      return;
    }

    // Defensive: a QUESTION/INVIS_1UP with no CONTENTS entry would otherwise
    // stay a live-looking block forever. Retire it rather than absorb the gap.
    if (t === L.TILE.QUESTION || t === L.TILE.INVIS_1UP) {
      bumpTile(col, row);
      L.setTile(col, row, L.TILE.USED);
      sfx('bump');
      return;
    }

    // SOLID / STAIR / USED / GROUND / pipes: sound only, no state change.
    sfx('bump');
  };

  // ==========================================================================
  // Lifecycle
  // ==========================================================================
  // Idempotent, and doubles as the level-reset hook bucket 7 needs.
  Actors.init = function () {
    buildSprites();
    buildLegends();
    list.length = 0;
    var k;
    for (k in coinBlocks) {
      if (Object.prototype.hasOwnProperty.call(coinBlocks, k)) delete coinBlocks[k];
    }
    chainIdx = 0;
    clock = 0;
    rebuildPending();
  };

  Actors.update = function (dt) {
    var G = ns('Game');
    if (!G) return;
    if (G.state !== 'play' && G.state !== 'dying') return;
    clock += dt;

    activateSpawns();
    updateCoinBlocks(dt);

    var M = ns('Mario');
    // Chain resets the moment Mario touches the ground. Checked before stomps
    // are resolved: on a stomp frame he is descending, so onGround is false.
    if (M && M.onGround) chainIdx = 0;

    var i;
    for (i = 0; i < list.length; i++) updateActor(list[i], dt);

    enemyVsEnemy();

    // Bucket 4 keeps Game.state === 'play' through the death animation, so we
    // are still ticked; all interaction must stop for its duration.
    if (M && !M.dying && !M.climbing) marioVsActors();

    cull();
  };

  // ==========================================================================
  // Drawing — integer pixel positions only, or sprites shimmer while scrolling
  // ==========================================================================
  // Run-length blit: one fillRect per horizontal run of identical pixels.
  // `flip` mirrors horizontally; `clipAboveY` draws only rows strictly above
  // that absolute y, which is how an emerging item stays hidden inside its
  // block (Actors.draw runs after Tiles.drawLevel, so it cannot draw behind).
  function blit(ctx, rows, dx, dy, flip, legend, clipAboveY) {
    var r, row, c, ch, len, color, px;
    for (r = 0; r < rows.length; r++) {
      if (clipAboveY !== null && clipAboveY !== undefined && (dy + r) >= clipAboveY) continue;
      row = rows[r];
      c = 0;
      while (c < row.length) {
        ch = row.charAt(c);
        if (ch === '.') { c++; continue; }
        len = 1;
        while (c + len < row.length && row.charAt(c + len) === ch) len++;
        color = legend[ch];
        if (color) {
          ctx.fillStyle = color;
          px = flip ? (SPRITE_W - (c + len)) : c;
          ctx.fillRect(dx + px, dy + r, len, 1);
        }
        c += len;
      }
    }
  }

  function pickFrame(a) {
    if (a.kind === 'goomba') {
      if (a.state === 'squashed') return SPR.goombaFlat;
      return SPR.goomba[a.frame];
    }
    if (a.kind === 'koopa') {
      if (a.state === 'shell' || a.state === 'slide') return SPR.shell;
      return SPR.koopa[a.frame];
    }
    if (a.kind === 'mushroom' || a.kind === '1up') return SPR.mushroom;
    if (a.kind === 'flower') return SPR.flower;
    if (a.kind === 'star') return SPR.star;
    return null;
  }

  function pickLegend(a) {
    if (a.kind === 'goomba') return LEG.goomba;
    if (a.kind === 'koopa') return (a.state === 'shell' || a.state === 'slide') ? LEG.shell : LEG.koopa;
    if (a.kind === 'mushroom') return LEG.mushroom;
    if (a.kind === '1up') return LEG.oneup;
    if (a.kind === 'flower') return LEG.flower[Math.floor(clock * 8) % LEG.flower.length];
    if (a.kind === 'star') return LEG.star[Math.floor(clock * 12) % LEG.star.length];
    return null;
  }

  function drawActor(ctx, a, camX) {
    if (a.dead) return;

    if (a.kind === 'debris') {
      ctx.fillStyle = (ns('Palette') || {}).brickDark || '#8a3208';
      ctx.fillRect(Math.round(a.x - camX), Math.round(a.y), a.w, a.h);
      return;
    }

    var frame = pickFrame(a);
    var legend = pickLegend(a);
    if (!frame || !legend) return;

    // Sprites are 16 wide; bodies are narrower, so centre the art over the
    // body. Feet-anchored vertically so short frames (flat goomba) sit right.
    var dx = Math.round(a.x + a.w / 2 - SPRITE_W / 2 - camX);
    var dy = Math.round(a.y + a.h - frame.length);
    var flip = false;
    var clipAbove = null;

    if (a.state === 'flipped') {
      // Upside-down: reuse the frame reversed row-order.
      dy = Math.round(a.y);
      blitFlipped(ctx, frame, dx, dy, legend);
      return;
    }
    if (a.state === 'emerge') clipAbove = a.homeRow * tp();
    if (a.kind === 'koopa' && a.state === 'walk') flip = (a.dir > 0);

    blit(ctx, frame, dx, dy, flip, legend, clipAbove);
  }

  function blitFlipped(ctx, rows, dx, dy, legend) {
    var r, row, c, ch, len, color;
    for (r = 0; r < rows.length; r++) {
      row = rows[rows.length - 1 - r];
      c = 0;
      while (c < row.length) {
        ch = row.charAt(c);
        if (ch === '.') { c++; continue; }
        len = 1;
        while (c + len < row.length && row.charAt(c + len) === ch) len++;
        color = legend[ch];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(dx + c, dy + r, len, 1);
        }
        c += len;
      }
    }
  }

  Actors.draw = function () {
    var G = ns('Game');
    if (!G || !G.ctx) return;
    if (!SPR || !LEG) { buildSprites(); buildLegends(); }
    var ctx = G.ctx;
    var camX = G.camera.x;
    var i;
    for (i = 0; i < list.length; i++) drawActor(ctx, list[i], camX);
  };

  // ---- small surface for the harness / bucket 7 diagnostics (read-only).
  Actors.debugPending = function () { return pending; };

})();
