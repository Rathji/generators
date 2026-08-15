
// 30-mario.js — Bucket 4: Mario. Movement feel, procedural sprites, state.
//
// Owns: Mario's physics/feel, his pixel-art sprite table, power state
// (small/big/fire), damage + death + respawn, and the *triggers* for two
// things other buckets own — Actors.strikeBlock() on a block headed from
// below, and Finish.trigger() on touching the flagpole.
//
// Units: vx/vy are PIXELS PER FIXED TICK (the game runs a fixed 1/60s step
// and Physics.moveBody does not multiply by dt). Every constant below is a
// flat per-frame amount. Timers (invuln, star, animation phases) are in
// SECONDS and use dt, because they are wall-clock things, not motion.
//
// Style rule (CONTRACT.md #1): no bare top-level const/let anywhere; the
// whole file is one IIFE that assigns only window.Mario, and no other
// namespace is referenced at file scope.
(function () {
  'use strict';

  // ==========================================================================
  // Tuning constants — the whole "feel" of the game is these fourteen numbers.
  // ==========================================================================
  var WALK_MAX = 1.6;        // px/tick top speed, no run button      (96 px/s)
  var RUN_MAX = 2.6;         // px/tick top speed, run held          (156 px/s)
  var ACCEL = 0.08;          // px/tick^2 ground acceleration
  var AIR_ACCEL = 0.05;      // px/tick^2 mid-air steering (partial control)
  var FRICTION = 0.09;       // px/tick^2 ground decel, no input held
  var SKID_DECEL = 0.20;     // px/tick^2 decel when reversing at speed
  var AIR_TURN = 0.10;       // px/tick^2 decel when reversing mid-air

  var JUMP_V = 5.0;          // px/tick initial upward speed, standing
  var JUMP_V_RUN_BONUS = 0.6;// px/tick extra at full run -> run jumps go higher
  var G_RISE = 0.18;         // px/tick^2 gravity while rising WITH jump held
  var G_FALL = 0.45;         // px/tick^2 gravity falling, or after jump release
  var MAX_FALL = 8.0;        // px/tick terminal velocity (< 16 so no tunneling)

  var BOUNCE_V = 3.6;        // px/tick stomp recoil, jump not held
  var BOUNCE_V_HELD = 5.2;   // px/tick stomp recoil, jump held

  // Arithmetic sanity check on the above (verified numerically in the harness):
  //   standing apex = sum(JUMP_V - G_RISE*k) for k=1..27  ~= 67 px  ~= 4.2 tiles
  //   jump cut after 3 ticks                              ~= 34 px  ~= 2.1 tiles
  //   full-run jump: ~51 ticks airborne * 2.6 px          ~= 132 px ~= 8.2 tiles

  var DEATH_FREEZE = 0.4;    // s of hang time before the death pop-up
  var DEATH_POP_V = 8.0;     // px/tick upward pop when the death anim starts
  var DEATH_GRAV = 0.4;      // px/tick^2 during the death fall
  var INVULN_TIME = 2.0;     // s of post-damage flicker
  var STAR_TIME = 10.0;      // s of star invincibility
  var TRANSFORM_TIME = 0.6;  // s of frozen grow/shrink animation

  var SMALL_H = 16, BIG_H = 32;
  var BODY_W = 12;           // narrower than the 16px sprite so Mario does not
                             // jam in a 16px-wide corridor; sprite is drawn
                             // centred over the body via SPRITE_INSET.
  var SPRITE_W = 16;
  var SPRITE_INSET = (SPRITE_W - BODY_W) / 2;

  var WALK_FRAME_PX = 6;     // px of travel per walk-cycle frame

  // ==========================================================================
  // Sprite table — procedurally blitted pixel art. One char per pixel, every
  // row exactly SPRITE_W chars. Legend is resolved from Palette at init().
  //
  //   .  transparent      R  hat + shirt (red / white when fire)
  //   B  overalls (blue / red when fire)      S  skin
  //   K  hair + moustache      Y  shoes       N  overall buttons
  //
  // Idle + walk frames are assembled as UPPER ++ LEGS so the three-frame walk
  // cycle is three small leg blocks rather than three near-duplicate sprites.
  // ==========================================================================
  var SMALL_UPPER = [
    '.....RRRRR......',
    '....RRRRRRRRR...',
    '....KKKSSSSSS...',
    '...KSKSSDSSDSSS.',
    '...KSKSSSSSSSS..',
    '...KKSSSSKKKK...',
    '......SSSSSS....',
    '.....RRBRRR.....',
    '....RRRBRRBRR...',
    '...RRRRBBBBRRR..',
    '..SSRRBNBBNBRSS.',
    '..SSSBBBBBBBSSS.',
    '..SSBBBBBBBBBSS.'
  ];
  var SMALL_LEGS_IDLE = [
    '....BBB...BBB...',
    '...YYYY...YYYY..',
    '..YYYYY...YYYYY.'
  ];
  var SMALL_LEGS_W0 = [
    '...BBB....BBB...',
    '..YYYY.....YYYY.',
    '.YYYYY.....YYYY.'
  ];
  var SMALL_LEGS_W1 = [
    '.....BBBBBB.....',
    '....YYYYYYYY....',
    '...YYYYYYYYYY...'
  ];
  var SMALL_LEGS_W2 = [
    '....BBBB..BB....',
    '...YYYYY..YYY...',
    '..YYYYY....YY...'
  ];

  var SMALL_SKID = [
    '......RRRRR.....',
    '.....RRRRRRRRR..',
    '.....KKKSSSSSS..',
    '....KSKSSDSSDSSS',
    '....KSKSSSSSSSS.',
    '....KKSSSSKKKK..',
    '.......SSSSS....',
    '..SS..RRBRR.....',
    '.SSSSRRRBRRB....',
    '..SSRRRRBBBBR...',
    '.....RRBNBBNB...',
    '....SSBBBBBBS...',
    '...SSBBBBBBBB...',
    '.....BBB..BB....',
    '....YYYY..YYY...',
    '...YYYY....YY...'
  ];
  var SMALL_JUMP = [
    '.....RRRRR......',
    '....RRRRRRRRR...',
    '....KKKSSSSSS...',
    '...KSKSSDSSDSSS.',
    '...KSKSSSSSSSS..',
    '...KKSSSSKKKK...',
    '......SSSSSS....',
    '..RR.RRBRRR..SS.',
    '.RRRRRRRBRRBRSS.',
    '.RRRRRRRBBBBRS..',
    '..SSRRBNBBNBR...',
    '..SSSBBBBBBB....',
    '....BBBBBBBBB...',
    '...BBB....BBB...',
    '..YYYY.....YYY..',
    '.YYYY.......YY..'
  ];
  var SMALL_DEATH = [
    '.....RRRRR......',
    '....RRRRRRRRR...',
    '....KKKSSSSSS...',
    '...KSKSSDSSDSSS.',
    '...KSKSSSSSSSS..',
    '...KKSSSSKKKK...',
    'SS....SSSSSS..SS',
    'SSS..RRRRRR..SSS',
    '.SS.RRRBBRRR.SS.',
    '....RRRBBRRR....',
    '....RBBBBBBR....',
    '....BBBBBBBB....',
    '...BBBBBBBBBB...',
    '...BBB....BBB...',
    '..YYYY....YYYY..',
    '.YYYYY....YYYYY.'
  ];
  var SMALL_CLIMB = [
    '.....RRRRR......',
    '....RRRRRRRRR...',
    '....KKKSSSSSS...',
    '...KSKSSDSSDSSS.',
    '...KSKSSSSSSSS..',
    '...KKSSSSKKKK...',
    '..SS..SSSSSS....',
    '..SSSRRBRRR.....',
    '...SRRRBRRBR....',
    '....RRRBBBBR....',
    '....RRBNBBNB....',
    '...SSBBBBBBB....',
    '..SSSBBBBBBBB...',
    '.....BBB.BBB....',
    '....YYYY.YYY....',
    '...YYYY...YY....'
  ];

  var BIG_UPPER = [
    '......RRRRRR....',
    '.....RRRRRRRRR..',
    '.....RRRRRRRRRR.',
    '.....KKKSSSKS...',
    '....KKKKSSWDKS..',
    '....KKSSSSSSKSS.',
    '....KKSSSSSSKS..',
    '......SSSSSSS...',
    '.......SSSSS....',
    '......RSSSSSR...',
    '....RRRRRRRRRR..',
    '...RRRRRRRRRRRR.',
    '..SSRRRBBRRRRSS.',
    '..SSRRRBBRRRRSS.',
    '..SSRRBBBBBBRSS.',
    '..SS..BBBBBBB...',
    '......BBNBBNB...',
    '.....BBBBBBBBB..',
    '....BBBBBBBBBBB.',
    '....BBBBBBBBBBB.'
  ];
  var BIG_LEGS_IDLE = [
    '....BBBB..BBBB..',
    '....BBBB..BBBB..',
    '....BBBB..BBBB..',
    '....BBBB..BBBB..',
    '....BBBB..BBBB..',
    '....BBBB..BBBB..',
    '...BBBBB..BBBBB.',
    '...BBBB....BBBB.',
    '..YYYYY....YYYYY',
    '..YYYYYY..YYYYYY',
    '..YYYYYY..YYYYYY',
    '...YYYY....YYYY.'
  ];
  var BIG_LEGS_W0 = [
    '...BBBB...BBBB..',
    '...BBBB...BBBB..',
    '..BBBB.....BBBB.',
    '..BBBB.....BBBB.',
    '..BBB.......BBB.',
    '..BBB.......BBB.',
    '.BBBB.......BBBB',
    '.BBB.........BBB',
    'YYYYY.......YYYY',
    'YYYYYY.....YYYYY',
    'YYYYY.......YYYY',
    '.YYY.........YY.'
  ];
  var BIG_LEGS_W1 = [
    '.....BBBBBB.....',
    '.....BBBBBB.....',
    '.....BBBBBB.....',
    '.....BBBBBB.....',
    '....BBBBBBBB....',
    '....BBBBBBBB....',
    '....BBB..BBB....',
    '....BBB..BBB....',
    '...YYYY..YYYY...',
    '..YYYYY..YYYYY..',
    '..YYYYY..YYYYY..',
    '...YYY....YYY...'
  ];
  var BIG_LEGS_W2 = [
    '....BBBB..BBB...',
    '....BBBB..BBB...',
    '...BBBB....BBB..',
    '...BBBB....BBB..',
    '..BBBB......BB..',
    '..BBB.......BB..',
    '.BBBB.......BB..',
    '.BBB........BB..',
    'YYYYY......YYY..',
    'YYYYYY....YYYY..',
    'YYYYY......YYY..',
    '.YYY........YY..'
  ];

  var BIG_SKID_UPPER = [
    '.......RRRRRR...',
    '......RRRRRRRRR.',
    '......RRRRRRRRRR',
    '......KKKSSSKS..',
    '.....KKKKSSWDKS.',
    '.....KKSSSSSSKSS',
    '.....KKSSSSSSKS.',
    '.......SSSSSSS..',
    '........SSSSS...',
    '..SS...RSSSSSR..',
    '.SSSSRRRRRRRRR..',
    '..SSRRRRRRRRRR..',
    '...RRRRBBRRRRS..',
    '...RRRRBBRRRRS..',
    '....RRBBBBBBRS..',
    '.....BBBBBBB....',
    '.....BBNBBNB....',
    '....BBBBBBBBB...',
    '...BBBBBBBBBBB..',
    '...BBBBBBBBBBB..'
  ];
  var BIG_SKID_LEGS = [
    '...BBBB..BBBB...',
    '...BBBB..BBBB...',
    '...BBBB...BBB...',
    '...BBBB...BBB...',
    '..BBBB....BBB...',
    '..BBBB....BBB...',
    '.BBBB.....BBB...',
    '.BBB......BBB...',
    'YYYYY....YYYY...',
    'YYYYYY...YYYY...',
    'YYYYY.....YY....',
    '.YYY.......Y....'
  ];

  var BIG_JUMP_UPPER = [
    '......RRRRRR....',
    '.....RRRRRRRRR..',
    '.....RRRRRRRRRR.',
    '.....KKKSSSKS...',
    '....KKKKSSWDKS..',
    '....KKSSSSSSKSS.',
    '....KKSSSSSSKS..',
    '......SSSSSSS...',
    '..RR...SSSSS..SS',
    '.RRRR.RSSSSSRSSS',
    '.RRRRRRRRRRRRSS.',
    '..RRRRRRRRRRRR..',
    '..SSRRRBBRRRRS..',
    '..SSRRRBBRRRRS..',
    '..SSRRBBBBBBR...',
    '......BBBBBBB...',
    '......BBNBBNB...',
    '.....BBBBBBBBB..',
    '....BBBBBBBBBBB.',
    '....BBBBBBBBBBB.'
  ];
  var BIG_JUMP_LEGS = [
    '....BBBB..BBBB..',
    '....BBBB..BBBB..',
    '...BBBB....BBBB.',
    '...BBBB....BBBB.',
    '..BBBB......BBB.',
    '..BBB.......BBB.',
    '.BBBB.......BB..',
    '.BBB.........B..',
    'YYYYY......YYY..',
    'YYYYYY....YYYY..',
    'YYYY.......YY...',
    '.YY.............'
  ];

  var BIG_CLIMB_UPPER = [
    '......RRRRRR....',
    '.....RRRRRRRRR..',
    '.....RRRRRRRRRR.',
    '.....KKKSSSKS...',
    '....KKKKSSWDKS..',
    '....KKSSSSSSKSS.',
    '....KKSSSSSSKS..',
    '......SSSSSSS...',
    '..SS...SSSSS....',
    '..SSS.RSSSSSR...',
    '..SSRRRRRRRRR...',
    '...RRRRRRRRRR...',
    '...RRRRBBRRRRS..',
    '...RRRRBBRRRSS..',
    '....RRBBBBBBSS..',
    '......BBBBBBB...',
    '......BBNBBNB...',
    '.....BBBBBBBBB..',
    '....BBBBBBBBBB..',
    '....BBBBBBBBBB..'
  ];
  var BIG_CLIMB_LEGS = [
    '....BBBB.BBBB...',
    '....BBBB.BBBB...',
    '....BBBB.BBB....',
    '....BBBB.BBB....',
    '....BBB..BBB....',
    '....BBB..BBB....',
    '...BBBB..BBBB...',
    '...BBB....BBB...',
    '..YYYY....YYYY..',
    '..YYYYY..YYYYY..',
    '..YYYYY..YYYYY..',
    '...YYY....YYY...'
  ];

  // Crouch is drawn feet-anchored, so a short frame is all it needs.
  var BIG_CROUCH = [
    '......RRRRRR....',
    '.....RRRRRRRRR..',
    '.....RRRRRRRRRR.',
    '.....KKKSSSKS...',
    '....KKKKSSWDKS..',
    '....KKSSSSSSKSS.',
    '....KKSSSSSSKS..',
    '......SSSSSSS...',
    '.....RRSSSSRR...',
    '..SSRRRRRRRRRSS.',
    '..SSRBBBBBBBRSS.',
    '...BBBBBBBBBB...',
    '..YYYYYYYYYYYY..',
    '..YYYY....YYYY..'
  ];

  var SMALL = null, BIG = null;   // built in init()
  var LEGEND = null;              // { small: {...}, fire: {...} }
  var STAR_LEGENDS = null;        // array of legends cycled during star

  // ==========================================================================
  // Mario namespace
  // ==========================================================================
  var Mario = {
    x: 32, y: 0,
    vx: 0, vy: 0,
    w: BODY_W, h: SMALL_H,
    facing: 1,                 // 1 right, -1 left
    power: 'small',            // 'small' | 'big' | 'fire'
    onGround: false,
    invuln: 0,                 // seconds of post-damage flicker remaining
    // --- additive to the contract, documented for buckets 5 and 6 ---
    star: 0,                   // seconds of star invincibility remaining
    dying: false,              // true for the whole death animation
    climbing: false,           // true once the flagpole has been grabbed
    // moveBody writes these:
    hitLeft: false, hitRight: false, hitCeil: false, hitTiles: []
  };
  window.Mario = Mario;

  // Internal animation phase. NOT a parallel state machine: core's tick()
  // only calls Mario.update() while Game.state === 'play', so a death
  // animation driven off Game.setState('dying') would never advance a single
  // frame. The animation therefore runs under 'play' and only hands control
  // to core's state machine when it finishes.
  var phase = 'normal';        // 'normal' | 'grow' | 'shrink' | 'dying' | 'clear'
  var phaseT = 0;              // seconds inside the current phase
  var deathStage = 'freeze';   // 'freeze' | 'fall'
  var jumpHeld = false;        // latched at takeoff, cleared on jump release
  var skidding = false;
  var walkAnim = 0;            // accumulated px of travel
  var walkFrame = 0;
  var finishLatched = false;
  var spawnX = 32, spawnY = 0;

  function ns(name) { return window[name]; }

  function sfx(name) {
    var S = ns('Sfx');
    if (S && typeof S.play === 'function') S.play(name);
  }

  function sign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }

  // ---------- sprite table assembly + audit ----------
  function pad16(row) {
    var s = String(row);
    if (s.length > SPRITE_W) return s.slice(0, SPRITE_W);
    while (s.length < SPRITE_W) s += '.';
    return s;
  }

  // Normalise every row to exactly SPRITE_W chars AND warn about any row that
  // was not already the right width. Normalising keeps a typo from corrupting
  // the render; the warning keeps the typo from going unnoticed.
  function auditFrame(name, rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].length !== SPRITE_W && typeof console !== 'undefined' && console.warn) {
        console.warn('[Mario] sprite "' + name + '" row ' + i + ' is ' +
          rows[i].length + ' px wide, expected ' + SPRITE_W);
      }
      out.push(pad16(rows[i]));
    }
    if (out.length === 0 || out.length > BIG_H) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[Mario] sprite "' + name + '" has ' + out.length +
          ' rows, expected 1..' + BIG_H);
      }
    }
    return out;
  }

  function buildSprites() {
    SMALL = {
      idle: auditFrame('small.idle', SMALL_UPPER.concat(SMALL_LEGS_IDLE)),
      walk: [
        auditFrame('small.walk0', SMALL_UPPER.concat(SMALL_LEGS_W0)),
        auditFrame('small.walk1', SMALL_UPPER.concat(SMALL_LEGS_W1)),
        auditFrame('small.walk2', SMALL_UPPER.concat(SMALL_LEGS_W2))
      ],
      skid: auditFrame('small.skid', SMALL_SKID),
      jump: auditFrame('small.jump', SMALL_JUMP),
      death: auditFrame('small.death', SMALL_DEATH),
      climb: auditFrame('small.climb', SMALL_CLIMB),
      crouch: auditFrame('small.crouch', SMALL_UPPER.concat(SMALL_LEGS_IDLE))
    };
    BIG = {
      idle: auditFrame('big.idle', BIG_UPPER.concat(BIG_LEGS_IDLE)),
      walk: [
        auditFrame('big.walk0', BIG_UPPER.concat(BIG_LEGS_W0)),
        auditFrame('big.walk1', BIG_UPPER.concat(BIG_LEGS_W1)),
        auditFrame('big.walk2', BIG_UPPER.concat(BIG_LEGS_W2))
      ],
      skid: auditFrame('big.skid', BIG_SKID_UPPER.concat(BIG_SKID_LEGS)),
      jump: auditFrame('big.jump', BIG_JUMP_UPPER.concat(BIG_JUMP_LEGS)),
      death: auditFrame('small.death', SMALL_DEATH),
      climb: auditFrame('big.climb', BIG_CLIMB_UPPER.concat(BIG_CLIMB_LEGS)),
      crouch: auditFrame('big.crouch', BIG_CROUCH)
    };
  }

  function buildLegends() {
    var P = ns('Palette') || {};
    var hair = '#6b3e0a';
    LEGEND = {
      // small + big share the red/blue suit
      suit: {
        R: P.marioRed || '#e40000',
        B: P.marioBlue || '#0058f8',
        S: P.marioSkin || '#fcbcac',
        K: hair,
        Y: P.groundDark || '#7a3b10',
        N: P.question || '#fcbc3c',
        W: P.white || '#fcfcfc',
        D: '#2a1203'
      },
      // fire Mario is white + red in the original
      fire: {
        R: P.white || '#fcfcfc',
        B: P.marioRed || '#e40000',
        S: P.marioSkin || '#fcbcac',
        K: hair,
        Y: P.castleRed || '#a83c1c',
        N: P.question || '#fcbc3c',
        W: P.white || '#fcfcfc',
        D: '#2a1203'
      }
    };
    // Star invincibility cycles the suit colours.
    STAR_LEGENDS = [
      LEGEND.suit,
      { R: P.white || '#fcfcfc', B: P.question || '#fcbc3c', S: P.white || '#fcfcfc', K: hair, Y: P.question || '#fcbc3c', N: P.white || '#fcfcfc', W: P.white || '#fcfcfc', D: '#2a1203' },
      { R: P.question || '#fcbc3c', B: P.koopaGreen || '#00ac00', S: P.white || '#fcfcfc', K: hair, Y: P.koopaGreen || '#00ac00', N: P.white || '#fcfcfc', W: P.white || '#fcfcfc', D: '#2a1203' },
      { R: P.koopaGreen || '#00ac00', B: P.marioRed || '#e40000', S: P.question || '#fcbc3c', K: hair, Y: P.marioRed || '#e40000', N: P.white || '#fcfcfc', W: P.white || '#fcfcfc', D: '#2a1203' }
    ];
  }

  // ---------- geometry helpers ----------
  Mario.bbox = function () {
    return { x: Mario.x, y: Mario.y, w: Mario.w, h: Mario.h };
  };

  function tilePx() { var G = ns('Game'); return (G && G.TILE_PX) || 16; }

  function overlapsSolid() {
    var L = ns('Level');
    if (!L || typeof L.solidAt !== 'function') return false;
    var T = tilePx();
    var c0 = Math.floor(Mario.x / T);
    var c1 = Math.floor((Mario.x + Mario.w - 0.01) / T);
    var r0 = Math.floor(Mario.y / T);
    var r1 = Math.floor((Mario.y + Mario.h - 0.01) / T);
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        if (L.solidAt(c, r)) return true;
      }
    }
    return false;
  }

  // After growing, Mario's new head may be inside a block. Nudge him DOWN
  // (never up — up would push him through the floor) until he is clear.
  function unstick() {
    for (var i = 0; i < BIG_H && overlapsSolid(); i++) Mario.y += 1;
  }

  function setPower(p) {
    var newH = (p === 'small') ? SMALL_H : BIG_H;
    var oldH = Mario.h;
    Mario.power = p;
    if (newH !== oldH) {
      Mario.y -= (newH - oldH);   // keep the feet planted
      Mario.h = newH;
      if (newH > oldH) unstick();
    }
  }

  // ==========================================================================
  // Public state transitions
  // ==========================================================================
  Mario.hurt = function () {
    if (phase !== 'normal') return;
    if (Mario.invuln > 0 || Mario.star > 0) return;   // single guarded entry point
    if (Mario.power === 'fire' || Mario.power === 'big') {
      // BUCKET 7 / FIX B: SMB1 has no intermediate step — a hit drops fire
      // Mario straight to small, exactly like it drops big Mario. (This file
      // originally stepped fire -> big -> small, which is a level of damage
      // resistance the original never gave you.)
      setPower('small');
      Mario.invuln = INVULN_TIME;
      phase = 'shrink';
      phaseT = 0;
      sfx('powerdown');
    } else {
      startDeath(false);
    }
  };

  Mario.powerUp = function (kind) {
    if (phase === 'dying') return;
    var G = ns('Game');
    if (kind === '1up') {
      if (G) G.lives += 1;
      sfx('1up');
      return;
    }
    if (kind === 'star') {
      Mario.star = STAR_TIME;
      sfx('powerup');
      return;
    }
    if (kind === 'flower') {
      if (Mario.power === 'small') { setPower('fire'); phase = 'grow'; phaseT = 0; }
      else { Mario.power = 'fire'; }
      sfx('powerup');
      return;
    }
    if (kind === 'mushroom') {
      if (Mario.power === 'small') {
        setPower('big');
        phase = 'grow';
        phaseT = 0;
        sfx('powerup');
      } else if (G && G.addScore) {
        G.addScore(1000, Mario.x, Mario.y);
      }
    }
  };

  Mario.bounce = function () {
    var I = ns('Input');
    var held = !!(I && I.jump);
    Mario.vy = -(held ? BOUNCE_V_HELD : BOUNCE_V);
    jumpHeld = held;
    Mario.onGround = false;
  };

  function startDeath(fromPit) {
    if (phase === 'dying') return;
    phase = 'dying';
    phaseT = 0;
    Mario.dying = true;
    Mario.climbing = false;
    Mario.vx = 0;
    Mario.invuln = 0;
    Mario.star = 0;
    if (fromPit) {
      deathStage = 'fall';           // already falling; don't pop back up
    } else {
      deathStage = 'freeze';
      Mario.vy = 0;
    }
    sfx('die');
  }

  function respawn() {
    var G = ns('Game');
    // BUCKET 7 / FIX A: the level itself is restored by core, not here.
    // Game.resetLevel() rebuilds tiles + block contents (Level.init) and
    // rearms every enemy spawn (Actors.init, in that order), resets the
    // clock, and — as its own documented exception to CONTRACT.md rule 4 —
    // puts the camera back to 0, because SMB restarts the level from the
    // left on death. That is what lets us respawn at the real start point
    // instead of at the current screen edge.
    var levelReset = !!(G && typeof G.resetLevel === 'function');
    if (levelReset) G.resetLevel();
    phase = 'normal';
    phaseT = 0;
    Mario.dying = false;
    Mario.climbing = false;
    finishLatched = false;
    Mario.power = 'small';
    Mario.w = BODY_W;
    Mario.h = SMALL_H;
    if (levelReset) {
      // Camera is back at 0, level is back to its shipped state: restart from
      // the real spawn point, feet on the ground, as the original does.
      Mario.x = spawnX;
      Mario.y = spawnY;
    } else {
      // Fallback for a build without core's resetLevel (bucket 4 standalone):
      // resume at the left edge of the current view, dropped in from above so
      // whatever geometry is there resolves under gravity instead of wedging
      // Mario inside it.
      Mario.x = (G ? G.camera.x : 0) + 32;
      Mario.y = 0;
    }
    Mario.vx = 0;
    Mario.vy = 0;
    Mario.facing = 1;
    Mario.invuln = INVULN_TIME;
    Mario.star = 0;
    jumpHeld = false;
    if (G && G.state !== 'play') G.setState('play');
  }

  function finishDeath() {
    var G = ns('Game');
    if (G) G.lives -= 1;
    if (!G || G.lives <= 0) {
      phase = 'normal';
      Mario.dying = false;
      if (G) { G.lives = 0; G.setState('gameover'); }
    } else {
      respawn();
    }
  }

  // ==========================================================================
  // Movement
  // ==========================================================================
  function horizontal(I) {
    var dir = 0;
    if (I.left) dir -= 1;
    if (I.right) dir += 1;
    var maxSpeed = I.run ? RUN_MAX : WALK_MAX;
    var spd = Math.abs(Mario.vx);
    skidding = false;

    if (Mario.onGround) {
      if (dir !== 0) {
        if (spd > 0.01 && sign(Mario.vx) !== dir) {
          // Skid: distinct, slower-than-instant reversal.
          skidding = true;
          Mario.vx += dir * SKID_DECEL;
        } else if (spd > maxSpeed) {
          // Was running, run released: bleed down to the walk cap gradually
          // rather than snapping, which would read as a dead stop.
          Mario.vx -= sign(Mario.vx) * FRICTION;
          if (Math.abs(Mario.vx) < maxSpeed) Mario.vx = dir * maxSpeed;
        } else {
          Mario.vx += dir * ACCEL;
          if (Math.abs(Mario.vx) > maxSpeed) Mario.vx = dir * maxSpeed;
        }
      } else {
        if (Mario.vx > 0) Mario.vx = Math.max(0, Mario.vx - FRICTION);
        else if (Mario.vx < 0) Mario.vx = Math.min(0, Mario.vx + FRICTION);
      }
    } else {
      // Air: momentum is preserved (no friction, no cap-down), steering is
      // partial. Reversing mid-air bleeds speed instead of flipping.
      if (dir !== 0) {
        if (spd > 0.01 && sign(Mario.vx) !== dir) {
          Mario.vx += dir * AIR_TURN;
        } else if (spd < maxSpeed) {
          Mario.vx += dir * AIR_ACCEL;
          if (Math.abs(Mario.vx) > maxSpeed) Mario.vx = dir * maxSpeed;
        }
      }
    }

    if (dir !== 0 && !skidding) Mario.facing = dir;
    else if (skidding) Mario.facing = -dir;   // still facing the old direction
  }

  function vertical(I) {
    if (I.jumpTapped && Mario.onGround && phase === 'normal') {
      var boost = JUMP_V_RUN_BONUS * Math.min(1, Math.abs(Mario.vx) / RUN_MAX);
      Mario.vy = -(JUMP_V + boost);
      jumpHeld = true;
      Mario.onGround = false;
      sfx('jump');
    }
    if (!I.jump) jumpHeld = false;

    var g = (Mario.vy < 0 && jumpHeld) ? G_RISE : G_FALL;
    Mario.vy += g;
    if (Mario.vy > MAX_FALL) Mario.vy = MAX_FALL;
  }

  // A block headed from below produces one or two side:'bottom' entries (two
  // when Mario straddles a seam). SMB strikes exactly ONE block: the one
  // nearest Mario's centre. Firing on every entry would double-call bucket 5.
  function reportStrikes() {
    var hits = Mario.hitTiles;
    if (!hits || hits.length === 0) return;
    var T = tilePx();
    var cx = Mario.x + Mario.w / 2;
    var best = null, bestD = Infinity;
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].side !== 'bottom') continue;
      var d = Math.abs((hits[i].col * T + T / 2) - cx);
      if (d < bestD) { bestD = d; best = hits[i]; }
    }
    if (!best) return;
    var A = ns('Actors');
    if (A && typeof A.strikeBlock === 'function') {
      A.strikeBlock(best.col, best.row, Mario.power);
    }
  }

  function checkFlagpole() {
    if (finishLatched) return;
    var L = ns('Level');
    var F = ns('Finish');
    if (!L || !L.TILE || typeof L.tileAt !== 'function') return;
    if (!F || typeof F.trigger !== 'function') return;   // bucket 6 absent: skip
    var T = tilePx();
    var c0 = Math.floor(Mario.x / T);
    var c1 = Math.floor((Mario.x + Mario.w - 0.01) / T);
    var r0 = Math.floor(Mario.y / T);
    var r1 = Math.floor((Mario.y + Mario.h - 0.01) / T);
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var t = L.tileAt(c, r);
        if (t === L.TILE.FLAGPOLE || t === L.TILE.FLAGTOP) {
          finishLatched = true;
          Mario.climbing = true;
          phase = 'clear';
          phaseT = 0;
          Mario.vx = 0;
          Mario.vy = 0;
          F.trigger();
          return;
        }
      }
    }
  }

  function clampToCamera() {
    var G = ns('Game');
    if (!G) return;
    if (Mario.x < G.camera.x) {
      Mario.x = G.camera.x;
      if (Mario.vx < 0) Mario.vx = 0;
    }
  }

  function pitFloor() {
    var G = ns('Game');
    var rows = (G && G.LEVEL_ROWS) || 15;
    return rows * tilePx();
  }

  // Grow/shrink freezes CONTROL, not physics. SMB freezes the whole screen
  // for the transformation, which this file cannot do from the inside; if we
  // froze gravity too, a Mario hit by an enemy mid-jump (the common case —
  // bucket 5 calls hurt() on side contact) would hang motionless in the air
  // for TRANSFORM_TIME and then resume falling. Horizontal momentum is kept
  // for the same reason: an abrupt dead stop reads as a hitch.
  function frozenPhysics() {
    var g = (Mario.vy < 0 && jumpHeld) ? G_RISE : G_FALL;
    Mario.vy += g;
    if (Mario.vy > MAX_FALL) Mario.vy = MAX_FALL;
    var Ph = ns('Physics');
    if (Ph && typeof Ph.moveBody === 'function') Ph.moveBody(Mario);
    clampToCamera();
    if (Mario.y > pitFloor()) startDeath(true);
  }

  // Distance-driven walk cycle: one frame per WALK_FRAME_PX of travel, so it
  // speeds up with Mario instead of running on a fixed clock. Called from the
  // normal ground path AND (fix C) from the clear phase, where Finish moves
  // Mario for us.
  function advanceWalkAnim() {
    if (Math.abs(Mario.vx) > 0.08) {
      walkAnim += Math.abs(Mario.vx);
      while (walkAnim >= WALK_FRAME_PX) {
        walkAnim -= WALK_FRAME_PX;
        walkFrame = (walkFrame + 1) % 3;
      }
    } else {
      walkAnim = 0;
      walkFrame = 0;
    }
  }

  function updateDying(dt) {
    phaseT += dt;
    if (deathStage === 'freeze') {
      if (phaseT >= DEATH_FREEZE) {
        deathStage = 'fall';
        Mario.vy = -DEATH_POP_V;
      }
      return;
    }
    Mario.vy += DEATH_GRAV;
    if (Mario.vy > 10) Mario.vy = 10;
    Mario.y += Mario.vy;                   // no collision during the death fall
    var G = ns('Game');
    var bottom = ((G && G.NES_H) || 240) + 48;
    if (Mario.y > bottom) finishDeath();
  }

  // ==========================================================================
  Mario.init = function () {
    var G = ns('Game');
    var L = ns('Level');
    buildSprites();
    buildLegends();

    spawnX = 32;
    spawnY = (G ? G.onGroundY : 208) - SMALL_H;
    // Honour an explicit start marker if the level ships one; the contract
    // does not require it, so this is opportunistic only.
    if (L && L.SPAWNS) {
      for (var i = 0; i < L.SPAWNS.length; i++) {
        var s = L.SPAWNS[i];
        if (s && (s.kind === 'mario' || s.kind === 'start')) {
          spawnX = (G ? G.col2px(s.col) : s.col * 16);
          spawnY = (G ? G.col2px(s.row) : s.row * 16);
        }
      }
    }

    phase = 'normal';
    phaseT = 0;
    Mario.power = 'small';
    Mario.w = BODY_W;
    Mario.h = SMALL_H;
    Mario.x = spawnX;
    Mario.y = spawnY;
    Mario.vx = 0;
    Mario.vy = 0;
    Mario.facing = 1;
    Mario.onGround = false;
    Mario.invuln = 0;
    Mario.star = 0;
    Mario.dying = false;
    Mario.climbing = false;
    Mario.hitTiles = [];
    jumpHeld = false;
    skidding = false;
    walkAnim = 0;
    walkFrame = 0;
    finishLatched = false;
    unstick();
  };

  Mario.update = function (dt) {
    var G = ns('Game');
    var I = ns('Input');
    if (!G || !I) return;

    // Core only drives us during 'play'. We also accept 'dying' so this file
    // keeps working if core is ever changed to tick during that state.
    if (G.state !== 'play' && G.state !== 'dying') return;

    if (Mario.invuln > 0) Mario.invuln = Math.max(0, Mario.invuln - dt);
    if (Mario.star > 0) Mario.star = Math.max(0, Mario.star - dt);

    if (phase === 'dying') { updateDying(dt); return; }
    if (phase === 'clear') {
      // Bucket 6 (Finish) owns Mario's position for the whole ending. It can
      // set Mario.vx, but the walk-cycle frame index is private to this file
      // and used to only advance in the normal-movement path below — so the
      // walk to the castle played with Mario's legs frozen.
      // BUCKET 7 / FIX C: keep animating while Finish drives him, but only
      // once he is off the pole (climbing false), since the pole slide uses
      // the climb frame.
      phaseT += dt;
      if (!Mario.climbing) advanceWalkAnim();
      return;
    }

    if (phase === 'grow' || phase === 'shrink') {
      phaseT += dt;
      if (phaseT >= TRANSFORM_TIME) { phase = 'normal'; phaseT = 0; }
      frozenPhysics();                                 // control frozen, not gravity
      return;
    }

    horizontal(I);
    vertical(I);

    var Ph = ns('Physics');
    if (Ph && typeof Ph.moveBody === 'function') Ph.moveBody(Mario);

    clampToCamera();
    reportStrikes();
    checkFlagpole();

    // Walk-cycle animation is distance-driven, so it speeds up with Mario.
    if (Mario.onGround) advanceWalkAnim();

    if (Mario.y > pitFloor()) startDeath(true);
  };

  // ==========================================================================
  // Drawing
  // ==========================================================================
  function pickFrame() {
    var set = (Mario.power === 'small') ? SMALL : BIG;
    if (phase === 'dying') return SMALL.death;
    if (Mario.climbing) return set.climb;
    // BUCKET 7 / FIX C: during the clear phase Mario is off the pole and
    // walking to the castle, so he must use the ground frames — returning the
    // climb frame here is what made the advancing walkFrame invisible.
    if (phase === 'clear') {
      return (Math.abs(Mario.vx) > 0.08) ? set.walk[walkFrame] : set.idle;
    }
    if (phase === 'grow' || phase === 'shrink') {
      // Flicker between the two sizes for the transition.
      return (Math.floor(phaseT * 20) % 2 === 0 ? SMALL : BIG).idle;
    }
    if (!Mario.onGround) return set.jump;
    if (skidding) return set.skid;
    if (Math.abs(Mario.vx) > 0.08) return set.walk[walkFrame];
    return set.idle;
  }

  function pickLegend() {
    if (Mario.star > 0) {
      return STAR_LEGENDS[Math.floor(Mario.star * 16) % STAR_LEGENDS.length];
    }
    return (Mario.power === 'fire') ? LEGEND.fire : LEGEND.suit;
  }

  // Run-length blit: one fillRect per horizontal run of identical pixels.
  function blit(ctx, rows, dx, dy, flip, legend) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var c = 0;
      while (c < row.length) {
        var ch = row.charAt(c);
        if (ch === '.') { c++; continue; }
        var len = 1;
        while (c + len < row.length && row.charAt(c + len) === ch) len++;
        var color = legend[ch];
        if (color) {
          ctx.fillStyle = color;
          var px = flip ? (SPRITE_W - (c + len)) : c;
          ctx.fillRect(dx + px, dy + r, len, 1);
        }
        c += len;
      }
    }
  }

  Mario.draw = function () {
    var G = ns('Game');
    if (!G || !G.ctx || !SMALL) return;
    if (G.state === 'title' || G.state === 'gameover') return;

    // Damage flicker: ~15 blinks/sec while invuln is counting down. Star
    // invincibility recolours instead of blinking, so Mario stays visible.
    if (Mario.invuln > 0 && Mario.star <= 0 &&
        Math.floor(Mario.invuln * 30) % 2 === 0) return;

    var frame = pickFrame();
    var legend = pickLegend();
    // Integer positions only, or the sprite shimmers against the tilemap.
    var dx = Math.round(Mario.x - G.camera.x - SPRITE_INSET);
    var dy = Math.round(Mario.y + Mario.h - frame.length);   // feet-anchored
    blit(G.ctx, frame, dx, dy, Mario.facing < 0, legend);
  };

  // ---- verification-only hooks (read-only, not part of the frozen contract;
  // same convention as Actors.debugPending / Sfx._activeCount / Finish._phase).
  Mario._phase = function () { return phase; };
  Mario._walkFrame = function () { return walkFrame; };
  Mario._sprites = function () { return { small: SMALL, big: BIG }; };

})();
