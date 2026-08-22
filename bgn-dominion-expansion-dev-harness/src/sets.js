/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/sets.js  (expansion isolation layer)
   The canonical expansion list for the SHIPPED game. sets.js must
   load before src/cards.js.

   Dominion.SETS.installed — the sets the shipped game boots with.
   This is the hard gate: cards.init() may load ANY set's data (the
   test harness uses that to develop the next expansion in
   isolation), but the shipped boot (index.html ensureCards) only
   ever requests sets on this list — so in-development expansions
   under src/exp/ never reach players until they graduate onto
   this list.

   A set is "in development" when it has a src/exp/<set>/ folder:
     data.json — its card catalog (cards.init loads this instead of
                 src/data/<set>.json)
     cards.js  — its card implementations (effects/durations/
                 triggers/reactions/vp), dynamically injected by
                 cards.init() after the set's data registers
     tests.js  — its test suite, statically loaded by index.html
                 and registered into DominionTest as "exp:<set>"
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = (global.Dominion = global.Dominion || {});

  Dominion.SETS = {
    /* The shipped game's catalog. NEVER add an in-development set
       here: expansions graduate onto this list only when their
       phase ships. */
    installed: [
      "base",
      "base-kingdom",
      "intrigue",
      "alchemy",
      "seaside",
      "prosperity"
    ],

    /* The base-game framework an expansion is tested against, e.g.
       cards.init(Dominion.SETS.installed.concat(["cornucopia"])). */
    base: ["base", "base-kingdom"]
  };

  Dominion.SETS.isInstalled = function (setId) {
    return Dominion.SETS.installed.indexOf(setId) !== -1;
  };

})(typeof self !== "undefined" ? self : globalThis);
