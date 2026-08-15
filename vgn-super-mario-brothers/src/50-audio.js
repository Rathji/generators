
// 50-audio.js -- Bucket 6: the `Sfx` and `Finish` namespaces.
//
// Sfx: synthesized WebAudio only (no external assets, no base64 samples),
// following the mockups/duck-hunt precedent -- an AudioContext created
// lazily on first use (never at load), oscillator/gain (or noise-buffer)
// graphs built fresh per call, and every node stopped + disconnected when
// its envelope finishes. See CONTRACT.md for the frozen interface.
//
// Finish: owns Mario's position from Finish.trigger() (fired once by
// 30-mario.js on flagpole/flagtop overlap) through the slide, flag-lower,
// hop, walk-to-castle, flag-raise, time tally and Game.setState('clear').
//
// Style rule (CONTRACT.md #1): no bare top-level const/let anywhere; the
// whole file is one IIFE assigning only window.Sfx and window.Finish, and
// no other namespace is referenced at file scope (every Game/Level/Mario/
// Tiles touch happens inside a function body, resolved at call time via
// the ns() helper below).
(function () {
  'use strict';

  function ns(name) { return window[name]; }

  // ==========================================================================
  // Sfx
  // ==========================================================================
  var Sfx = {};
  window.Sfx = Sfx;

  var audioCtx = null;
  var masterGain = null;
  var mutedFlag = false;

  // Every live node graph gets an entry here so Sfx.muted = true can kill
  // anything still sounding (a multi-note run like 'clear' or 'flagpole'
  // can still have unstarted-but-scheduled notes queued when muted flips).
  // Entries remove themselves once their node's envelope finishes.
  var activeNodes = [];

  function untrack(entry) {
    var idx = activeNodes.indexOf(entry);
    if (idx !== -1) activeNodes.splice(idx, 1);
  }

  function trackNode(hardStop) {
    var entry = { stop: hardStop };
    activeNodes.push(entry);
    return entry;
  }

  // Lazily create the AudioContext on first use, never at file load --
  // browsers suspend/auto-block an AudioContext created before a user
  // gesture, so constructing one eagerly here would leave the whole game
  // silent. Also resumes a suspended context (e.g. after a tab was
  // backgrounded), matching mockups/duck-hunt's ensureAudio().
  function ensureAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.32; // modest master gain so overlaps don't clip
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // One oscillator note: freq (optionally sweeping to freqEnd), fixed dur,
  // exponential gain decay. `at` is a start offset in seconds from "now".
  function note(freq, at, dur, type, peakGain, freqEnd) {
    var ctx = ensureAudio();
    if (!ctx || !masterGain) return;
    var t0 = ctx.currentTime + (at || 0);
    var osc = ctx.createOscillator();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (typeof freqEnd === 'number') {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    }
    var g = ctx.createGain();
    g.gain.setValueAtTime(peakGain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(masterGain);

    var entry = trackNode(function () {
      try { osc.stop(ctx.currentTime); } catch (e) { /* already stopped */ }
    });
    osc.onended = function () {
      try { osc.disconnect(); } catch (e) {}
      try { g.disconnect(); } catch (e) {}
      untrack(entry);
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  // Filtered white-noise burst, for 'break'. Same lifecycle discipline as
  // note(): stop() scheduled immediately, disconnect on 'ended'.
  function noiseBurst(at, dur, peakGain, filterFreq) {
    var ctx = ensureAudio();
    if (!ctx || !masterGain) return;
    var t0 = ctx.currentTime + (at || 0);
    var frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 2200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(peakGain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);

    var entry = trackNode(function () {
      try { src.stop(ctx.currentTime); } catch (e) {}
    });
    src.onended = function () {
      try { src.disconnect(); } catch (e) {}
      try { filter.disconnect(); } catch (e) {}
      try { g.disconnect(); } catch (e) {}
      untrack(entry);
    };
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  // A short run of notes, each its own oscillator (so muting mid-run still
  // stops cleanly via activeNodes, and nothing leaks).
  function seq(notes, type) {
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      note(n.f, n.at, n.d, type, n.g != null ? n.g : 0.25, n.fend);
    }
  }

  // ---- the twelve sounds ----
  var SOUND_MAKERS = {
    // Signature rising square-wave sweep. Fires constantly -- kept to one
    // oscillator, short envelope.
    jump: function () { note(280, 0, 0.16, 'square', 0.26, 720); },

    // Dull low knock -- struck a solid/used/pipe tile, nothing happens.
    bump: function () { note(150, 0, 0.09, 'triangle', 0.22, 95); },

    // Noise burst for the brick shatter.
    'break': function () { noiseBurst(0, 0.22, 0.28, 1800); },

    // Two-note blip: quick grace note up to a held note, both square.
    coin: function () {
      note(988, 0, 0.05, 'square', 0.22);
      note(1319, 0.045, 0.2, 'square', 0.24);
    },

    // Short percussive downward thump.
    stomp: function () { note(300, 0, 0.1, 'square', 0.28, 90); },

    // Ascending arpeggio run.
    powerup: function () {
      seq([
        { f: 523, d: 0.09, at: 0 },
        { f: 659, d: 0.09, at: 0.07 },
        { f: 784, d: 0.09, at: 0.14 },
        { f: 1047, d: 0.18, at: 0.21 }
      ], 'square');
    },

    // Descending, unhappy mirror of powerup.
    powerdown: function () {
      seq([
        { f: 784, d: 0.09, at: 0 },
        { f: 659, d: 0.09, at: 0.07 },
        { f: 523, d: 0.09, at: 0.14 },
        { f: 392, d: 0.2, at: 0.21 }
      ], 'square');
    },

    // Short bright four-note rising motif -- distinct intervals/timbre
    // (triangle, not square) from powerup so the two are never confused.
    '1up': function () {
      seq([
        { f: 784, d: 0.07, at: 0 },
        { f: 988, d: 0.07, at: 0.06 },
        { f: 1175, d: 0.07, at: 0.12 },
        { f: 1568, d: 0.22, at: 0.18 }
      ], 'triangle');
    },

    // Sharp shell-kick blip -- a single high fast chirp, distinct from
    // stomp's slower downward thump.
    kick: function () { note(900, 0, 0.05, 'square', 0.2, 480); },

    // Descending run as Mario slides down the pole.
    flagpole: function () {
      seq([
        { f: 987, d: 0.08, at: 0 },
        { f: 880, d: 0.08, at: 0.07 },
        { f: 784, d: 0.08, at: 0.14 },
        { f: 698, d: 0.08, at: 0.21 },
        { f: 659, d: 0.08, at: 0.28 },
        { f: 587, d: 0.08, at: 0.35 },
        { f: 523, d: 0.08, at: 0.42 },
        { f: 440, d: 0.16, at: 0.49 }
      ], 'square');
    },

    // Level-complete fanfare, a few seconds.
    clear: function () {
      seq([
        { f: 523, d: 0.12, at: 0 },
        { f: 523, d: 0.12, at: 0.12 },
        { f: 523, d: 0.12, at: 0.24 },
        { f: 659, d: 0.28, at: 0.36 },
        { f: 523, d: 0.12, at: 0.72 },
        { f: 659, d: 0.12, at: 0.84 },
        { f: 784, d: 0.12, at: 0.96 },
        { f: 1047, d: 0.5, at: 1.08 },
        { f: 784, d: 0.12, at: 1.7 },
        { f: 880, d: 0.12, at: 1.82 },
        { f: 988, d: 0.12, at: 1.94 },
        { f: 1319, d: 0.75, at: 2.06 }
      ], 'square');
    },

    // Death jingle -- short, descending, sad.
    die: function () {
      seq([
        { f: 392, d: 0.18, at: 0 },
        { f: 330, d: 0.18, at: 0.18 },
        { f: 262, d: 0.18, at: 0.36 },
        { f: 196, d: 0.5, at: 0.54 }
      ], 'triangle');
    }
  };

  Sfx.play = function (name) {
    if (mutedFlag) return;
    var fn = Object.prototype.hasOwnProperty.call(SOUND_MAKERS, name) ? SOUND_MAKERS[name] : null;
    if (typeof fn !== 'function') return; // unknown name: silent no-op, never throw
    try {
      fn();
    } catch (e) {
      if (window.console) console.warn('[Sfx] play("' + name + '") failed', e);
    }
  };

  // muted is a real accessor (not a plain field) so flipping it true also
  // hard-stops anything currently scheduled/sounding, per the contract:
  // "must not leave scheduled nodes running when toggled on [muted]".
  Object.defineProperty(Sfx, 'muted', {
    get: function () { return mutedFlag; },
    set: function (v) {
      mutedFlag = !!v;
      if (mutedFlag) {
        var live = activeNodes.slice();
        for (var i = 0; i < live.length; i++) {
          try { live[i].stop(); } catch (e) {}
        }
      }
    },
    enumerable: true,
    configurable: true
  });

  // Verification-only hooks -- read-only introspection, harmless to expose,
  // not part of the frozen contract.
  Sfx._audioCtx = function () { return audioCtx; };
  Sfx._activeCount = function () { return activeNodes.length; };

  // ==========================================================================
  // Finish -- the flagpole ending
  // ==========================================================================
  var Finish = {};
  window.Finish = Finish;

  // phase: 'idle' | 'slide' | 'hop' | 'walk' | 'raiseFlag' | 'tally' |
  //        'finishState' | 'complete'
  var phase = 'idle';
  var phaseT = 0;

  var poleX = 0;
  var grabY = 0;
  var slideTargetY = 0;
  var slideStartFlagHeight = 1;
  var walkTargetX = 0;
  var lastGrabScore = 0;

  var tallyRemaining = 0;
  var tallyTimer = 0;

  var SLIDE_SPEED = 130;    // px/sec sliding down the pole
  var HOP_DURATION = 0.35;  // s, brief pause after hopping off the pole
  var WALK_SPEED = 60;      // px/sec walking to the castle
  var WALK_VX = 1.6;        // px/tick-equivalent, just to satisfy Mario's
                             // walk-frame-selection threshold (abs(vx) > 0.08)
  var RAISE_DURATION = 1.2; // s for the castle-side flag raise
  var TALLY_TICK = 0.035;   // s between each time->score tick

  function findSpawn(kind) {
    var L = ns('Level');
    if (!L || !L.SPAWNS) return null;
    for (var i = 0; i < L.SPAWNS.length; i++) {
      if (L.SPAWNS[i] && L.SPAWNS[i].kind === kind) return L.SPAWNS[i];
    }
    return null;
  }

  function tilePx() {
    var G = ns('Game');
    return (G && G.TILE_PX) || 16;
  }

  function sfx(name) {
    var S = ns('Sfx');
    if (S && typeof S.play === 'function') S.play(name);
  }

  // SMB awards more for grabbing higher on the shaft. Flagpole shaft tiles
  // run row 3 (just under the FLAGTOP ball at row 2) to row 11 (just above
  // the SOLID base at row 12) -- see 10-level.js MAP / CONTRACT.md.
  function scoreForRow(row) {
    if (row <= 3) return 5000;
    if (row <= 5) return 2000;
    if (row <= 7) return 800;
    if (row <= 9) return 400;
    return 100;
  }

  Finish.trigger = function () {
    if (phase !== 'idle') return; // bucket 4 already latches this; belt & suspenders
    var G = ns('Game');
    var M = ns('Mario');
    var Tl = ns('Tiles');
    if (!G || !M) return;

    var T = tilePx();
    var poleSpawn = findSpawn('flagpole');
    var castleSpawn = findSpawn('castle');
    var poleCol = poleSpawn ? poleSpawn.col : 198;
    var castleCol = castleSpawn ? castleSpawn.col : 202;
    var baseRow = 12; // SOLID flagpole-base tile row (CONTRACT.md)

    poleX = poleCol * T;
    grabY = M.y;
    slideTargetY = baseRow * T - M.h;
    if (slideTargetY < grabY) slideTargetY = grabY; // never slide "up"

    lastGrabScore = scoreForRow(Math.floor(M.y / T));

    slideStartFlagHeight = (Tl && typeof Tl.flagHeight === 'number') ? Tl.flagHeight : 1;

    // Doorway is around col 204 for a castle anchored at 202-206; walking
    // Mario's world-x into the castle's own drawn footprint (cols 202-206)
    // is what hides him -- Tiles.drawForeground() (which paints the castle)
    // runs AFTER Mario.draw() in core's per-frame order, so once Mario's
    // sprite falls inside that rectangle the castle simply paints over him.
    walkTargetX = (castleCol + 2) * T;

    M.x = poleX + (T - M.w) / 2;
    M.climbing = true;
    M.vx = 0;
    M.vy = 0;

    phase = 'slide';
    phaseT = 0;

    sfx('flagpole');
    if (G.addScore) G.addScore(lastGrabScore, M.x, M.y);
  };

  function stepSlide(dt, G, M, Tl) {
    M.y += SLIDE_SPEED * dt;
    if (M.y >= slideTargetY) M.y = slideTargetY;

    var span = slideTargetY - grabY;
    var progress = span > 0 ? (M.y - grabY) / span : 1;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;
    if (Tl) Tl.flagHeight = slideStartFlagHeight * (1 - progress);

    if (M.y >= slideTargetY) {
      phase = 'hop';
      phaseT = 0;
      var T = tilePx();
      M.x = poleX + T + 2; // hop to the right side of the pole
      M.facing = 1;
      M.vx = 0;
      M.vy = 0;
    }
  }

  function stepHop(dt, M) {
    if (phaseT >= HOP_DURATION) {
      phase = 'walk';
      phaseT = 0;
      M.climbing = false;
      M.onGround = true;
      M.vx = WALK_VX;
    }
  }

  function stepWalk(dt, M) {
    M.x += WALK_SPEED * dt;
    M.vx = WALK_VX;         // walk-cycle art keys off vx (CONTRACT.md note)
    M.facing = 1;
    M.onGround = true;
    if (M.x >= walkTargetX) {
      M.x = walkTargetX;
      M.vx = 0;
      phase = 'raiseFlag';
      phaseT = 0;
      sfx('clear');
    }
  }

  // There is no separate castle-flag asset in this codebase -- Tiles owns
  // exactly one flag, driven by Tiles.flagHeight, anchored at the pole.
  // Reusing that same hook to raise it back up after Mario enters the
  // castle is the closest honest rendering of "the flag on the castle
  // raises" available without inventing new art in a frozen bucket 3 file.
  // Surfaced here as a deliberate interpretation, not silently absorbed.
  function stepRaiseFlag(dt, G, Tl) {
    var p = phaseT / RAISE_DURATION;
    if (p > 1) p = 1;
    if (Tl) Tl.flagHeight = p;
    if (phaseT >= RAISE_DURATION) {
      phase = 'tally';
      phaseT = 0;
      tallyRemaining = G ? Math.max(0, Math.floor(G.time)) : 0;
      tallyTimer = 0;
    }
  }

  function stepTally(dt, G, M) {
    if (tallyRemaining <= 0) {
      if (G) G.time = 0;
      phase = 'finishState';
      phaseT = 0;
      return;
    }
    tallyTimer += dt;
    while (tallyTimer >= TALLY_TICK && tallyRemaining > 0) {
      tallyTimer -= TALLY_TICK;
      tallyRemaining -= 1;
      if (G) G.time = tallyRemaining;
      if (G && G.addScore) G.addScore(50, M ? M.x : 0, M ? M.y - 10 : 0);
      sfx('coin'); // repeating blip, matches the real tally's cadence closely enough
    }
  }

  Finish.update = function (dt) {
    if (phase === 'idle' || phase === 'complete') return;
    var G = ns('Game');
    var M = ns('Mario');
    var Tl = ns('Tiles');
    if (!G || !M) return;

    // Freeze the on-screen clock for the whole ending sequence (authentic
    // SMB behaviour: the timer stops the instant you grab the pole). Core's
    // updateTimer(dt) runs later in the SAME tick (00-core.js tick() calls
    // Finish.update before updateTimer), so zeroing the accumulator here
    // every tick starves it before it can ever cross its 0.4s threshold.
    // Game._timeAcc is not part of the frozen contract's public surface --
    // reaching into it is a deliberate, surfaced deviation; there is no
    // exposed "pause the timer" hook.
    if (phase !== 'tally' && phase !== 'finishState') G._timeAcc = 0;

    phaseT += dt;

    if (phase === 'slide') { stepSlide(dt, G, M, Tl); return; }
    if (phase === 'hop') { stepHop(dt, M); return; }
    if (phase === 'walk') { stepWalk(dt, M); return; }
    if (phase === 'raiseFlag') { stepRaiseFlag(dt, G, Tl); return; }
    if (phase === 'tally') { stepTally(dt, G, M); return; }
    if (phase === 'finishState') {
      G.setState('clear');
      phase = 'complete';
      phaseT = 0;
      return;
    }
  };

  function drawOverlay(G) {
    var ctx = G.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, G.NES_W, G.NES_H);
    ctx.fillStyle = '#fcfcfc';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('COURSE CLEAR', G.NES_W / 2, G.NES_H / 2 - 10);
    ctx.font = '8px monospace';
    ctx.fillText('SCORE ' + Math.floor(G.score), G.NES_W / 2, G.NES_H / 2 + 10);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  Finish.draw = function () {
    if (phase !== 'complete') return; // slide/walk/etc. are all Mario+Tiles art
    var G = ns('Game');
    if (!G || !G.ctx) return;
    drawOverlay(G);
  };

  // Optional, defensive: if core ever re-runs the namespace boot (it does
  // not today -- bootNamespaces() fires once at DOMContentLoaded -- but
  // "inert until trigger()" should survive a future restart hook too).
  Finish.init = function () {
    phase = 'idle';
    phaseT = 0;
    tallyRemaining = 0;
    tallyTimer = 0;
  };

  // Verification-only hook.
  Finish._phase = function () { return phase; };

})();
