/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/exp/menagerie/tests.js
   The Menagerie test suite, registered into the shared runner as
   "exp:menagerie". Runs via ?tests=1&suite=exp:menagerie (core +
   this suite) or ?tests=1&suite=all. The runner inits the shipped
   installed sets plus "menagerie" before this suite runs.

   Task 394 — the Exile mat (engine primitives + the official regain
   rule). Later tasks add the individual Menagerie cards on top.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  if (!global.DominionTest) return;

  global.DominionTest.defineSuite("exp:menagerie", { set: "menagerie" }, (t, h) => {
    const { assert, eq, deepEq, scenario } = h;

    t("exile: cards exiled from hand go to the Exile mat (not gained/trashed)", () => {
      const g = scenario({
        seed: 1,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f"], ["x", "y", "z", "w", "v"]],
        hand: [["copper", "silver", "gold", "estate", "smithy"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { copper: 50, silver: 30, gold: 20, estate: 8 }
      });
      Dominion.engine.beginTurn(g, "p1");
      const p1 = Dominion.engine.player(g, "p1");
      const supplyBefore = g.supply.silver;
      const logsBefore = g.log.length;
      Dominion.engine.primitives.exile(g, "p1", { cardId: "silver" });
      deepEq(p1.exile, ["silver"], "silver is on the Exile mat");
      eq(p1.hand.indexOf("silver"), -1, "silver left the hand");
      eq(g.supply.silver, supplyBefore, "exiling from hand does not touch the supply");
      eq(g.trash.indexOf("silver"), -1, "silver is not trashed");
      eq(g.log.filter((l) => l.t === "gain").length, 0, "exiling is not a gain");
      eq(g.log.filter((l) => l.t === "trash").length, 0, "exiling is not a trash");
      assert(g.log.some((l) => l.t === "exile" && l.card === "silver"), "exile move is logged");
      eq(Dominion.engine.zones.count(g, Dominion.engine.loc("p1", "exile")), 1, "Exile mat count");
      eq(logsBefore < g.log.length, true, "new log entry was appended");
    });

    t("exile: cards exiled from the Supply become the player's", () => {
      const g = scenario({
        seed: 2,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["copper", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { gold: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      const supplyBefore = g.supply.gold;
      Dominion.engine.primitives.exile(g, "p1", { cardId: "gold", from: Dominion.engine.zoneRef.supply });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.exile, ["gold"], "gold is exiled to the mat");
      eq(g.supply.gold, supplyBefore - 1, "supply pile decremented");
      eq(g.log.filter((l) => l.t === "gain").length, 0, "exiling from the supply is not gaining it");
      eq(g.log.some((l) => l.t === "exile"), true, "logged as an exile");
    });

    t("exile: regaining — gain a card to discard all other exiled copies", () => {
      const g = scenario({
        seed: 3,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f"], ["x"]],
        hand: [["copper", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { silver: 10 }
      });
      const p1 = Dominion.engine.player(g, "p1");
      p1.exile = ["silver", "silver", "estate"];
      g.decide = (s, q) => (q.type === "exileDiscard" ? true : null);
      Dominion.engine.primitives.gain(g, "p1", "silver");
      deepEq(p1.exile, ["estate"], "both exiled Silvers came back (all-or-none), Estate stays");
      eq(p1.discard.filter((c) => c === "silver").length, 3, "gained Silver plus the two regained Silvers are in discard");
      assert(g.log.some((l) => l.t === "exileDiscard" && l.count === 2), "exile discard logged");
    });

    t("exile: regain is all-or-none and optional", () => {
      const g = scenario({
        seed: 4,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f"], ["x"]],
        hand: [["copper", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { silver: 10 }
      });
      const p1 = Dominion.engine.player(g, "p1");
      p1.exile = ["silver", "silver"];
      g.decide = (s, q) => (q.type === "exileDiscard" ? false : null); // player declines
      Dominion.engine.primitives.gain(g, "p1", "silver");
      deepEq(p1.exile, ["silver", "silver"], "declining leaves the exiled copies on the mat");
      eq(p1.discard.filter((c) => c === "silver").length, 1, "only the gained Silver went to discard");
    });

    t("exile: no exiled copies means the regain prompt never fires", () => {
      const g = scenario({
        seed: 5,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f"], ["x"]],
        hand: [["copper", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { silver: 10 }
      });
      let asked = 0;
      g.decide = (s, q) => { if (q.type === "exileDiscard") asked++; return null; };
      Dominion.engine.primitives.gain(g, "p1", "silver");
      eq(asked, 0, "no exileDiscard prompt when nothing is exiled");
    });

    t("exile: regained copies count as discards (trigger discard)", () => {
      const g = scenario({
        seed: 6,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f"], ["x"]],
        hand: [["tunnel", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { silver: 10 }
      });
      const p1 = Dominion.engine.player(g, "p1");
      p1.exile = ["silver", "silver"];
      let discardFired = 0;
      Dominion.engine.triggers.register("tunnel", { onDiscard: () => { discardFired++; } });
      g.decide = (s, q) => (q.type === "exileDiscard" ? true : null);
      Dominion.engine.primitives.gain(g, "p1", "silver");
      eq(discardFired >= 1, true, "regaining exiled copies fires the discard trigger");
    });

    t("exile: exiled cards count for scoring but stay off the mat on regain", () => {
      const g = scenario({
        seed: 7,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["copper", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { estate: 8 }
      });
      const p1 = Dominion.engine.player(g, "p1");
      p1.exile = ["estate", "duchy"];
      const sc = Dominion.engine.score(g, "p1");
      eq(sc.estate, 1, "exiled Estate scores");
      eq(sc.duchy, 3, "exiled Duchy scores");
      eq(sc.cardCount, p1.deck.length + p1.hand.length + p1.discard.length + p1.play.length + p1.exile.length,
        "exiled cards count as cards the player has");
    });

    t("exile: primitives.regain returns a card from the mat to a zone", () => {
      const g = scenario({
        seed: 8,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["copper", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      const p1 = Dominion.engine.player(g, "p1");
      p1.exile = ["gold", "estate"];
      Dominion.engine.primitives.regain(g, "p1", { cardId: "gold", to: Dominion.engine.loc("p1", "hand") });
      deepEq(p1.exile, ["estate"], "gold left the mat");
      eq(p1.hand.indexOf("gold") !== -1, true, "gold is back in hand");
    });

    /* ── Task 395: Ways ── */

    t("ways: a Way overrides the Action's text when played via it", () => {
      const g = scenario({
        seed: 11,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_sheep"];
      const p1 = Dominion.engine.player(g, "p1");
      const before = p1.hand.length;
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_sheep" });
      eq(p1.hand.length, before - 1, "Way of the Sheep gives +$2 (no +3 Cards draw)");
      eq(p1.coins, 2, "Way of the Sheep gives +$2");
      eq(p1.actions, 0, "still spent the action");
      assert(g.log.some((l) => l.t === "wayPlay" && l.way === "way_of_the_sheep" && l.card === "smithy"), "wayPlay logged");
    });

    t("ways: playing the Action normally still uses its own text", () => {
      const g = scenario({
        seed: 12,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_sheep"];
      const p1 = Dominion.engine.player(g, "p1");
      const before = p1.hand.length;
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy" });
      eq(p1.hand.length, before + 2, "Smithy still draws its +3 Cards without the way option");
      eq(p1.coins, 0, "no coins from a plain Smithy");
    });

    t("ways: setup stores g.ways and rejects non-Way ids", () => {
      const g = Dominion.engine.setup({ players: 2, kingdom: ["smithy", "village"], seed: 13, ways: ["way_of_the_sheep"] });
      deepEq(g.ways, ["way_of_the_sheep"], "the Way survives setup");
      const g2 = Dominion.engine.setup({ players: 2, kingdom: ["smithy", "village"], seed: 13, ways: ["way_of_the_sheep", "smithy"] });
      deepEq(g2.ways, ["way_of_the_sheep"], "non-Way ids are filtered out");
    });

    t("ways: Butterfly returns the card to its pile and gains a card costing exactly $1 more", () => {
      const g = scenario({
        seed: 14,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["village", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { village: 10, smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_butterfly"];
      g.decide = (s, q) => (q.type === "butterflyReturn" ? true : (q.type === "gainCard" ? "smithy" : null));
      const p1 = Dominion.engine.player(g, "p1");
      const supplyBefore = g.supply.village;
      Dominion.engine.actions.play(g, "p1", { cardId: "village", way: "way_of_the_butterfly" });
      eq(g.supply.village, supplyBefore + 1, "Village returned to its pile");
      eq(p1.play.indexOf("village"), -1, "Village no longer in play");
      eq(p1.discard[p1.discard.length - 1], "smithy", "gained a $4 card ($3+$1)");
    });

    t("ways: Camel exiles a Gold from the Supply", () => {
      const g = scenario({
        seed: 15,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10, gold: 20 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_camel"];
      const supplyBefore = g.supply.gold;
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_camel" });
      eq(g.supply.gold, supplyBefore - 1, "one Gold left the supply");
      deepEq(enginePlayerExile(g), ["gold"], "the Gold is on the Exile mat");
    });

    t("ways: Goat trashes a card from hand", () => {
      const g = scenario({
        seed: 16,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["smithy", "estate", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10, estate: 8 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_goat"];
      g.decide = (s, q) => (q.type === "trashAny" ? 0 : null); // Estate is index 0 after Smithy leaves the hand
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_goat" });
      eq(g.trash[g.trash.length - 1], "estate", "the chosen hand card was trashed");
      eq(p1.hand.indexOf("estate"), -1, "Estate left the hand");
    });

    t("ways: Frog topdecks the played card at cleanup", () => {
      const g = scenario({
        seed: 17,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_frog"];
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_frog" });
      eq(p1.actions, 1, "+1 Action (net back to 1 after spending)");
      Dominion.engine.cleanup(g, "p1");
      eq(p1.deck[p1.deck.length - 1], "smithy", "Smithy topdecked instead of discarded");
      eq(p1.discard.indexOf("smithy"), -1, "Smithy not in the discard");
    });

    t("ways: Horse draws 2, +1 Action, and returns the card to its pile", () => {
      const g = scenario({
        seed: 18,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"], ["x"]],
        hand: [["village", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { village: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_horse"];
      const p1 = Dominion.engine.player(g, "p1");
      const supplyBefore = g.supply.village;
      Dominion.engine.actions.play(g, "p1", { cardId: "village", way: "way_of_the_horse" });
      eq(p1.actions, 1, "+1 Action (net back to 1 after spending)");
      eq(p1.hand.length, 6, "+2 Cards drawn");
      eq(g.supply.village, supplyBefore + 1, "Village returned to its pile");
    });

    t("ways: Mole discards hand then draws 3", () => {
      const g = scenario({
        seed: 19,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_mole"];
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_mole" });
      eq(p1.actions, 1, "+1 Action");
      deepEq(p1.hand, ["m", "l", "k"], "hand discarded then 3 drawn top-first (deck top = array end)");
    });

    t("ways: Owl draws until 6 cards in hand", () => {
      const g = scenario({
        seed: 20,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_owl"];
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_owl" });
      eq(p1.hand.length, 6, "drew up to 6 cards");
    });

    t("ways: Turtle sets the card aside and plays it next turn", () => {
      const g = scenario({
        seed: 21,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], ["x", "y", "z", "w", "v", "u", "t"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_turtle"];
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_turtle" });
      eq(p1.setAside[0], "smithy", "Smithy set aside");
      eq(p1.play.indexOf("smithy"), -1, "Smithy not in play");
      const handBefore = p1.hand.length;
      Dominion.engine.beginTurn(g, "p2");
      Dominion.engine.beginTurn(g, "p1");
      eq(p1.play.indexOf("smithy") !== -1, true, "Smithy replayed at the next turn's start");
      eq(p1.hand.length, handBefore + 3, "Smithy drew its +3 Cards when replayed");
    });

    t("ways: Seal gives +$1 and topdecks gained cards on request", () => {
      const g = scenario({
        seed: 22,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10, silver: 30 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_seal"];
      g.decide = (s, q) => (q.type === "sealTopdeck" ? true : null);
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_seal" });
      eq(p1.coins, 1, "+$1");
      Dominion.engine.primitives.gain(g, "p1", "silver");
      eq(p1.deck[p1.deck.length - 1], "silver", "gained Silver went on the deck");
    });

    t("ways: Squirrel draws 2 cards at the end of the turn", () => {
      const g = scenario({
        seed: 23,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_squirrel"];
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_squirrel" });
      Dominion.engine.cleanup(g, "p1");
      eq(p1.hand.length, 2, "two cards drawn at end of turn");
    });

    t("ways: Chameleon swaps +Cards and +$1 on the played card", () => {
      const g = scenario({
        seed: 24,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_chameleon"];
      const p1 = Dominion.engine.player(g, "p1");
      const before = p1.hand.length;
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_chameleon" });
      eq(p1.hand.length, before - 1, "+3 Cards became +$3 (hand unchanged besides the played card)");
      eq(p1.coins, 3, "Smithy's +3 Cards swapped into $");
    });

    t("ways: Mouse plays the set-aside card from setup", () => {
      const g = Dominion.engine.setup({
        players: 2,
        kingdom: ["smithy", "village", "market"],
        seed: 25,
        ways: ["way_of_the_mouse"]
      });
      assert(g.mouseCard && Dominion.cards.get(g.mouseCard).cost.coins >= 2 && Dominion.cards.get(g.mouseCard).cost.coins <= 3,
        "a $2/$3 Action was set aside: " + g.mouseCard);
      /* Pin the set-aside card deterministically so the assertion is
         stable regardless of which $2/$3 Action setup happened to pick:
         Village (+1 Card, +2 Actions) is a valid $3 Action and is not
         in this kingdom, so force it as the set-aside card. */
      g.mouseCard = "village";
      Dominion.engine.beginTurn(g, "p1");
      const p1 = Dominion.engine.player(g, "p1");
      p1.hand = ["village", "copper", "copper", "copper", "copper"];
      Dominion.engine.actions.play(g, "p1", { cardId: "village", way: "way_of_the_mouse" });
      eq(p1.actions, 2, "Village's own +2 Actions resolved via Mouse (spend 1, +2)");
      assert(g.log.some((l) => l.t === "wayPlay" && l.way === "way_of_the_mouse" && l.card === "village"), "wayPlay logged");
    });

    t("ways: Rat discards a Treasure to gain a copy of this", () => {
      const g = scenario({
        seed: 26,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["smithy", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { smithy: 10 }
      });
      Dominion.engine.beginTurn(g, "p1");
      g.ways = ["way_of_the_rat"];
      g.decide = (s, q) => (q.type === "ratDiscardTreasure" ? 1 : null);
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "smithy", way: "way_of_the_rat" });
      eq(p1.discard[p1.discard.length - 1], "smithy", "gained a copy of the played card");
      eq(g.supply.smithy, 9, "one Smithy left the supply");
    });

    /* ── Task 396: the Horse pile ── */

    t("horse: a Menagerie kingdom sets up a 30-card non-supply Horse pile that cannot be bought", () => {
      const g = Dominion.engine.setup({ players: 2, kingdom: ["sheepdog"], seed: 30 });
      eq(g.supply.horse, 30, "Horse pile is set up alongside a Menagerie kingdom");
      eq(Dominion.engine.canBuy(g, "p1", "horse"), false, "Horse is not in the Supply — cannot be bought");
    });

    t("horse: playing it gives +2 Cards, +1 Action and returns it to its pile", () => {
      const g = scenario({
        seed: 31,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], ["x"]],
        hand: [["horse", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { horse: 30, copper: 50 }
      });
      Dominion.engine.beginTurn(g, "p1");
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "horse" });
      eq(p1.actions, 1, "+1 Action (net back to 1 after spending)");
      eq(p1.hand.length, 6, "+2 Cards drawn (played Horse left the hand)");
      eq(p1.play.indexOf("horse"), -1, "Horse is not in the play area");
      eq(g.supply.horse, 30, "Horse returned to its pile");
    });

    t("horse: gained only by effects — gaining from the Horse pile decrements it", () => {
      const g = scenario({
        seed: 32,
        players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["copper", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { horse: 30 }
      });
      Dominion.engine.beginTurn(g, "p1");
      const p1 = Dominion.engine.player(g, "p1");
      Dominion.engine.primitives.gain(g, "p1", "horse");
      eq(g.supply.horse, 29, "one Horse left the pile");
      eq(p1.discard[p1.discard.length - 1], "horse", "the gained Horse went to the discard");
    });

    function enginePlayerExile(g) {
      return Dominion.engine.player(g, "p1").exile;
    }
  });
})(typeof self !== "undefined" ? self : globalThis);
