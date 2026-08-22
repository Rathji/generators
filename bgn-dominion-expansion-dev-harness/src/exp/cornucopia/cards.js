/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/exp/cornucopia/cards.js
   Cornucopia card implementations, registered onto the engine's
   additive registries (effects / durations / triggers / reactions /
   vp). Loaded by cards.init() via the shared set loader (see
   src/sets.js) whenever "cornucopia" is part of the catalog — never
   by the shipped boot, which only loads installed sets. Safe to
   load repeatedly: every registry is a Map keyed by card id, so
   re-registering overwrites in place (idempotent).

   Fairgrounds (VP) is currently the only Cornucopia card pinned in
   src/exp/cornucopia/data.json — the rest of the set ships in its
   own phase.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = global.Dominion;
  const engine = Dominion.engine;

  engine.vp.register("fairgrounds", (state, pid) =>
    2 * Math.floor(new Set(engine.playerCards(state, pid)).size / 10));

})(typeof self !== "undefined" ? self : globalThis);
