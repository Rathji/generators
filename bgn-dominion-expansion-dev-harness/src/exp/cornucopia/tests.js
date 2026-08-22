/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/exp/cornucopia/tests.js
   The Cornucopia test suite, registered into the shared runner as
   "exp:cornucopia". Runs via ?tests=1&suite=exp:cornucopia (core +
   this suite) or ?tests=1&suite=all. The runner inits the shipped
   installed sets plus "cornucopia" before this suite runs, so its
   tests can lean on base-game cards as scaffolding.

   The tests here are the first users of the scenario() fixture DSL:
   an exact position is set up, a card is played/bought, and the
   resulting zones are asserted deterministically.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  if (!global.DominionTest) return;

  global.DominionTest.defineSuite("exp:cornucopia", { set: "cornucopia" }, (t, h) => {
    const { assert, eq, deepEq, scenario } = h;

    t("cornucopia: catalog is installed", async () => {
      const data = await fetch("src/exp/cornucopia/data.json").then((r) => r.json());
      eq(Dominion.cards.byExpansion("cornucopia").length, data.cards.length,
        "registered cornucopia count matches the data file");
      assert(Dominion.cards.has("fairgrounds"), "fairgrounds is registered");
    });

    t("scenario: exact hand -> play Smithy -> assert zones", () => {
      const g = scenario({
        seed: 1,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x", "y", "z"]],
        hand: [["smithy"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.hand, ["e", "d", "c"], "+3 Cards drawn top-first");
      deepEq(p1.deck, ["a", "b"], "deck keeps the rest");
      deepEq(p1.play, ["smithy"], "smithy sits in the play area");
      eq(p1.actions, 0, "the single action was spent");
    });

    t("scenario: buy Province with 8 coins", () => {
      const g = scenario({
        seed: 2,
        players: 2,
        supply: { province: 8 },
        hand: [["copper", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.apply(g, "p1", { coins: 8 });
      Dominion.engine.buy(g, "p1", "province");
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.discard, ["province"], "gained to discard");
      eq(g.supply.province, 7, "supply decremented");
      eq(p1.coins, 0, "8 coins spent");
    });

    t("scenario: played Duration resolves on the next turn", () => {
      const g = scenario({
        seed: 3,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], ["x"]],
        hand: [["caravan", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "caravan" });
      eq(Dominion.engine.player(g, "p1").hand.length, 5, "+1 Card on the play turn");
      Dominion.engine.advancePhase(g); // action -> buy
      Dominion.engine.advancePhase(g); // buy -> cleanup -> draw -> p2 beginTurn
      const p1 = Dominion.engine.player(g, "p1");
      assert(p1.duration.includes("caravan"), "cleanup kept the Duration in play");
      eq(p1.hand.length, 5, "fresh 5-card hand drawn");
      Dominion.engine.advancePhase(g); // p2 action -> buy
      Dominion.engine.advancePhase(g); // p2 buy -> cleanup -> draw -> p1 beginTurn
      eq(p1.hand.length, 6, "the start-of-next-turn resolution drew +1 Card");
      assert(p1.oldDur.includes("caravan"), "the Duration resolved and moved to oldDur");
    });

    t("scenario: activeDurations seeds an in-flight Duration", () => {
      const g = scenario({
        seed: 4,
        players: 2,
        hand: [[], []],
        activeDurations: [["caravan"], []],
        deck: [["a", "b", "c", "d", "e", "f"], ["x"]]
      });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.duration, ["caravan"], "caravan seeded into the duration zone");
      Dominion.engine.beginTurn(g, "p1");
      eq(p1.hand.length, 1, "the start-of-turn resolution drew +1 Card");
      assert(p1.oldDur.includes("caravan"), "caravan resolved and moved to oldDur");
    });
  });

})(typeof self !== "undefined" ? self : globalThis);
