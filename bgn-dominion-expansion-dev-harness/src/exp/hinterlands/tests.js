/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/exp/hinterlands/tests.js
   The Hinterlands test suite, registered into the shared runner as
   "exp:hinterlands". Runs via ?tests=1&suite=exp:hinterlands (core
   + this suite) or ?tests=1&suite=all. The runner inits the shipped
   installed sets plus "hinterlands" before this suite runs.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  if (!global.DominionTest) return;

  global.DominionTest.defineSuite("exp:hinterlands", { set: "hinterlands" }, (t, h) => {
    const { assert, eq } = h;

    t("hinterlands: catalog is installed", async () => {
      const data = await fetch("src/exp/hinterlands/data.json").then((r) => r.json());
      eq(Dominion.cards.byExpansion("hinterlands").length, data.cards.length,
        "registered hinterlands count matches the data file");
      assert(Dominion.cards.has("farmland"), "farmland is registered");
    });
  });

})(typeof self !== "undefined" ? self : globalThis);
