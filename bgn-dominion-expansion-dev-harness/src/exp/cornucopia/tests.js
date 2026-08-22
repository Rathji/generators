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

    /* ── Young Witch (task 163: Bane pile setup + attack) ── */
    t("young witch: setup adds an extra $2/$3 Bane pile when it is in the kingdom", () => {
      const g = Dominion.engine.setup({ players: 2, kingdom: ["young_witch"], seed: 50 });
      assert(g.bane, "a Bane card is chosen");
      const d = Dominion.cards.get(g.bane);
      assert(d && d.inSupply, "the Bane is a real supply card");
      assert(d.cost.coins === 2 || d.cost.coins === 3, "costs $2 or $3 (got $" + d.cost.coins + ")");
      eq(d.cost.potion, 0, "no potion cost");
      assert(g.kingdom.indexOf(g.bane) === -1, "the Bane is an extra pile, not one of the ten");
      const size = typeof d.pileSize === "object" ? (d.pileSize["2"] != null ? d.pileSize["2"] : 10) : (d.pileSize == null ? 10 : d.pileSize);
      eq(g.supply[g.bane], size, "the Bane pile is stocked for 2 players");
    });

    t("young witch: the Bane choice is deterministic per seed", () => {
      const a = Dominion.engine.setup({ players: 2, kingdom: ["young_witch"], seed: 54 });
      const b = Dominion.engine.setup({ players: 2, kingdom: ["young_witch"], seed: 54 });
      eq(a.bane, b.bane, "same seed picks the same Bane");
    });

    t("young witch: no Bane pile without the card in the kingdom", () => {
      const g = Dominion.engine.setup({ players: 2, kingdom: ["village"], seed: 53 });
      eq(g.bane, null, "no bane set");
      assert(!g.supply.potion && g.supply.province === 8, "ordinary 2-player supply");
    });

    t("young witch: +2 Cards, discard 2, and a target without a Bane gains a Curse", () => {
      const g = scenario({
        seed: 51,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g"], ["x"]],
        hand: [["young_witch", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]],
        supply: { curse: 10 }
      });
      g.bane = "hamlet";
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "young_witch" });
      const p1 = Dominion.engine.player(g, "p1");
      const p2 = Dominion.engine.player(g, "p2");
      eq(p1.hand.length, 4, "two drawn, then two discarded (card itself in play)");
      eq(p1.discard.length, 2, "two cards discarded");
      deepEq(p1.deck, ["a", "b", "c", "d", "e"], "two cards drawn off the deck");
      deepEq(p2.discard, ["curse"], "the Bane-less target gains a Curse");
      eq(g.supply.curse, 9, "curse pile decremented");
      assert(p2.hand.length === 5, "the target keeps its hand");
    });

    t("young witch: a target who reveals a Bane card avoids the Curse", () => {
      const g = scenario({
        seed: 52,
        players: 2,
        deck: [["a", "b", "c", "d", "e", "f", "g"], ["x"]],
        hand: [["young_witch", "copper", "copper", "copper", "copper"], ["hamlet", "copper", "copper", "copper", "copper"]],
        supply: { curse: 10 }
      });
      g.bane = "hamlet";
      g.decide = (s, q) => {
        if (q.type === "discardExactly") return [1, 2];
        if (q.type === "youngWitchBane") return true;
        return null;
      };
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "young_witch" });
      const p2 = Dominion.engine.player(g, "p2");
      eq(p2.discard.length, 0, "no Curse gained");
      assert(p2.hand.indexOf("hamlet") !== -1, "the revealed Bane stays in hand");
      eq(g.supply.curse, 10, "curse pile untouched");
    });

    t("young witch: AI game with the card completes and the AI reveals the Bane", async () => {
      await Dominion.cards.init(Dominion.SETS.installed.concat(["cornucopia"]));
      const g = Dominion.engine.setup({ players: 2, kingdom: ["young_witch", "village", "smithy", "market", "moat", "cellar", "merchant", "mine", "remodel", "witch"], seed: 77 });
      assert(g.bane, "the Bane pile is set up");
      g.decide = (s, q) => Dominion.ai.choose(s, q.player, q);
      Dominion.engine.beginTurn(g, "p1");
      let guard = 0;
      while (!g.over && guard++ < 300) await Dominion.ai.playTurn(g, g.turnPlayer);
      assert(g.over, "the AI game ran to completion");
      assert(typeof Dominion.engine.score(g, "p1").total === "number", "game was scored");
    });

    /* ── Simple Cornucopia Actions (task 165 batch) ── */
    t("menagerie: no duplicate hand → +3 Cards", () => {
      const g = scenario({
        seed: 10, players: 2,
        deck: [["a", "b", "c", "d"], ["x"]],
        hand: [["menagerie", "copper", "estate"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "menagerie" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.hand, ["copper", "estate", "d", "c", "b"], "+3 Cards, top-first");
      deepEq(p1.deck, ["a"], "three drawn");
      eq(p1.actions, 1, "the spent action was refunded");
    });

    t("menagerie: a duplicate hand → only +1 Card", () => {
      const g = scenario({
        seed: 11, players: 2,
        deck: [["a", "b", "c", "d"], ["x"]],
        hand: [["menagerie", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "menagerie" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.hand, ["copper", "copper", "d"], "+1 Card only");
      deepEq(p1.deck, ["a", "b", "c"], "one drawn");
    });

    t("hamlet: discards fuel +1 Action and +1 Buy", () => {
      const g = scenario({
        seed: 20, players: 2,
        deck: [["copper"], ["x"]],
        hand: [["hamlet", "copper", "estate"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      let calls = 0;
      g.decide = (s, q) => {
        if (q.type === "hamletDiscard") {
          calls++;
          return calls === 1 ? q.hand.indexOf("copper") : q.hand.indexOf("estate");
        }
        return null;
      };
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "hamlet" });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.actions, 2, "+1 Action from the first discard (1 + 1)");
      eq(p1.buys, 2, "+1 Buy from the second discard");
      deepEq(p1.hand, ["copper"], "both discards left exactly the Copper");
      deepEq(p1.discard, ["copper", "estate"], "the drawn Copper and the Estate were the discards");
    });

    t("hamlet: the default bot discards a zero-cost card and no more", () => {
      const g = scenario({
        seed: 21, players: 2,
        deck: [["copper"], ["x"]],
        hand: [["hamlet", "copper", "estate"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "hamlet" });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.actions, 2, "discarded once for +1 Action");
      eq(p1.buys, 2, "discarded once for +1 Buy");
      deepEq(p1.discard, ["copper", "copper"], "only zero-cost cards were discarded");
    });

    t("farming_village: +2 Actions and finds an Action/Treasure", () => {
      const g = scenario({
        seed: 12, players: 2,
        deck: [["estate", "copper", "village", "estate"], ["x"]],
        hand: [["farming_village"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "farming_village" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.hand, ["village"], "the revealed Action went to hand");
      deepEq(p1.deck, ["estate", "copper"], "the earlier cards were skipped");
      deepEq(p1.discard, ["estate"], "the non-Action/Treasure card was discarded");
      eq(p1.actions, 2, "+2 Actions");
    });

    t("harvest: +$1 per differently named revealed card", () => {
      const g = scenario({
        seed: 13, players: 2,
        deck: [["copper", "copper", "silver", "gold", "copper", "silver"], ["x"]],
        hand: [["harvest"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "harvest" });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.coins, 3, "silver+gold+copper = 3 different names");
      deepEq(p1.deck, ["copper", "copper"], "top 4 revealed");
      deepEq(p1.discard, ["silver", "copper", "gold", "silver"], "the revealed 4 were discarded");
    });

    t("hunting_party: reveals until a non-duplicate, discarding the rest", () => {
      const g = scenario({
        seed: 14, players: 2,
        deck: [["copper", "estate", "village", "copper", "copper"], ["x"]],
        hand: [["hunting_party", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "hunting_party" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.hand, ["copper", "copper", "village"], "+1 Card, then the first non-duplicate");
      deepEq(p1.deck, ["copper", "estate"], "the duplicate was skipped");
      deepEq(p1.discard, ["copper"], "one duplicate discarded");
      eq(p1.actions, 1, "+1 Action");
    });

    t("remake: twice — trash a card, gain one costing exactly $1 more", () => {
      const g = scenario({
        seed: 15, players: 2,
        supply: { silver: 20 },
        deck: [["x"], ["x"]],
        hand: [["remake", "estate", "estate"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      g.decide = (s, q) => {
        if (q.type === "trashAny") return 0;
        if (q.type === "gainCard") return "silver";
        return null;
      };
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "remake" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.discard, ["silver", "silver"], "two Silvers gained (Estate $2 → Silver $3)");
      deepEq(p1.hand, [], "both Estates were trashed");
      deepEq(g.trash, ["estate", "estate"], "the Estates are in the trash");
    });

    t("jester: non-Victory card — attacker chooses who gains the copy", () => {
      const g = scenario({
        seed: 16, players: 2,
        deck: [["x"], ["estate", "silver"]],
        hand: [["jester", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      g.decide = (s, q) => (q.type === "jesterChoice" ? "self" : null);
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "jester" });
      const p1 = Dominion.engine.player(g, "p1");
      const p2 = Dominion.engine.player(g, "p2");
      eq(p1.coins, 2, "+$2");
      deepEq(p2.discard, ["silver"], "the target discarded the top card");
      deepEq(p1.discard, ["silver"], "the attacker chose to gain the copy");
    });

    t("jester: a Victory on top makes the target gain a Curse", () => {
      const g = scenario({
        seed: 17, players: 2,
        deck: [["x"], ["copper", "estate"]],
        hand: [["jester", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "jester" });
      const p2 = Dominion.engine.player(g, "p2");
      deepEq(p2.discard, ["estate", "curse"], "Estate discarded, Curse gained");
      eq(g.supply.curse, 7, "curse pile decremented");
    });

    t("fortune_teller: reveal until a Victory or Curse, which stays on top", () => {
      const g = scenario({
        seed: 18, players: 2,
        deck: [["x"], ["estate", "copper", "village"]],
        hand: [["fortune_teller", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "fortune_teller" });
      const p1 = Dominion.engine.player(g, "p1");
      const p2 = Dominion.engine.player(g, "p2");
      eq(p1.coins, 2, "+$2");
      deepEq(p2.deck, ["estate"], "the Victory card stays on top");
      deepEq(p2.discard, ["village", "copper"], "the rest are discarded");
    });

    t("cornucopia: AI game completes with the new Actions in the kingdom", async () => {
      await Dominion.cards.init(Dominion.SETS.installed.concat(["cornucopia"]));
      const g = Dominion.engine.setup({ players: 2, kingdom: ["young_witch", "hamlet", "menagerie", "hunting_party", "farming_village", "harvest", "jester", "fortune_teller", "remake", "moat"], seed: 79 });
      g.decide = (s, q) => Dominion.ai.choose(s, q.player, q);
      Dominion.engine.beginTurn(g, "p1");
      let guard = 0;
      while (!g.over && guard++ < 300) await Dominion.ai.playTurn(g, g.turnPlayer);
      assert(g.over, "the AI game ran to completion");
      assert(typeof Dominion.engine.score(g, "p1").total === "number", "game was scored");
    });

    /* ── Horn of Plenty, Horse Traders, Tournament & the Prizes ── */
    t("horn of plenty: gains nothing above its in-play budget", () => {
      const g = scenario({
        seed: 30, players: 2,
        deck: [["x"], ["x"]],
        hand: [["horn_of_plenty", "gold"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      g.decide = (s, q) => (q.type === "gainCard" ? "gold" : null);
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.treasures.play(g, "p1", { cardIds: ["horn_of_plenty"] });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.play.length, 1, "only the horn in play → budget $1");
      deepEq(p1.discard, [], "Gold ($6) is not affordable");
      eq(g.supply.gold, 30, "gold pile untouched");
    });

    t("horn of plenty: a gained Victory card trashes the horn", () => {
      const g = scenario({
        seed: 31, players: 2,
        deck: [["x"], ["x"]],
        hand: [["horn_of_plenty", "silver", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      g.decide = (s, q) => (q.type === "gainCard" ? "estate" : null);
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.treasures.play(g, "p1", { cardIds: ["horn_of_plenty", "silver", "copper"] });
      const p1 = Dominion.engine.player(g, "p1");
      eq(new Set(p1.play).size, 2, "silver + copper remain in play (the horn was trashed)");
      deepEq(p1.discard, ["estate"], "the Estate ($2) was gained");
      assert(p1.play.indexOf("horn_of_plenty") === -1, "the horn left the play area");
      assert(g.trash.indexOf("horn_of_plenty") !== -1, "the horn was trashed");
    });

    t("horse traders: +1 Buy, +3 Coins, discard 2", () => {
      const g = scenario({
        seed: 32, players: 2,
        deck: [["x"], ["x"]],
        hand: [["horse_traders", "copper", "copper", "estate", "gold"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "horse_traders" });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.buys, 2, "+1 Buy");
      eq(p1.coins, 3, "+3 Coins");
      deepEq(p1.discard, ["copper", "copper"], "two cards discarded");
      eq(p1.hand.length, 2, "five minus the played card minus two discards");
    });

    t("horse traders: sets aside vs an Attack and returns next turn with +1 Card", () => {
      const g = scenario({
        seed: 33, players: 2,
        deck: [["a", "b", "c", "d", "e"], ["x"]],
        hand: [["smithy", "horse_traders", "copper", "copper", "copper"], ["witch", "copper", "copper", "copper", "copper"]]
      });
      g.decide = (s, q) => (q.type === "react" ? ["horse_traders"] : null);
      Dominion.engine.beginTurn(g, "p2");
      Dominion.engine.actions.play(g, "p2", { cardId: "witch" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.setAside, ["horse_traders"], "set aside from hand during the attack");
      assert(p1.hand.indexOf("horse_traders") === -1, "no longer in hand");
      Dominion.engine.advancePhase(g); // p2 action -> buy
      Dominion.engine.advancePhase(g); // p2 buy -> cleanup -> draw -> p1 beginTurn
      eq(p1.hand.length, 6, "4 cards + the trigger's +1 Card + the returned horse traders");
      assert(p1.hand.indexOf("horse_traders") !== -1, "horse traders returned to hand");
      deepEq(p1.setAside, [], "set-aside zone cleared");
      assert(p1.discard.indexOf("curse") !== -1, "the Witch still Cursed p1");
    });

    t("tournament: Province → Prize on the deck for each revealing player", () => {
      const g = scenario({
        seed: 35, players: 2,
        deck: [["a", "b", "c"], ["x"]],
        hand: [["tournament", "province", "copper", "copper", "copper"], ["province", "copper", "copper", "copper", "copper"]]
      });
      g.prizes = ["bag_of_gold", "diadem", "followers", "princess", "trusty_steed"];
      g.decide = (s, q) => {
        if (q.type === "tournamentRevealProvince") return true;
        if (q.type === "gainPrize") return q.player === "p1" ? "bag_of_gold" : "followers";
        return null;
      };
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "tournament" });
      const p1 = Dominion.engine.player(g, "p1");
      const p2 = Dominion.engine.player(g, "p2");
      deepEq(p1.deck, ["a", "b", "c", "bag_of_gold"], "Prize on top of p1's deck");
      deepEq(p2.deck, ["x", "followers"], "Prize on top of p2's deck");
      deepEq(p1.discard, ["province"], "p1's Province discarded");
      deepEq(p2.discard, ["province"], "p2's Province discarded");
      eq(p1.coins, 0, "no +$1: another player revealed");
      eq(g.prizes.length, 3, "two Prizes left the pile");
    });

    t("tournament: +1 Card and +$1 when no other player reveals", () => {
      const g = scenario({
        seed: 36, players: 2,
        deck: [["a", "b", "c"], ["x"]],
        hand: [["tournament", "province", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      g.prizes = ["bag_of_gold", "diadem", "followers", "princess", "trusty_steed"];
      g.decide = (s, q) => {
        if (q.type === "tournamentRevealProvince") return true;
        if (q.type === "gainPrize") return "bag_of_gold";
        return null;
      };
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "tournament" });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.coins, 1, "+$1");
      assert(p1.hand.indexOf("bag_of_gold") !== -1, "the +1 Card drew the just-gained Prize");
      deepEq(p1.deck, ["a", "b", "c"], "the Prize was drawn off the top");
    });

    t("tournament: an empty Prize pile means a Duchy instead", () => {
      const g = scenario({
        seed: 37, players: 2,
        deck: [["a", "b", "c"], ["x"]],
        hand: [["tournament", "province", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      g.prizes = [];
      g.decide = (s, q) => (q.type === "tournamentRevealProvince" ? true : null);
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "tournament" });
      const p1 = Dominion.engine.player(g, "p1");
      assert(p1.hand.indexOf("duchy") !== -1, "the Duchy was gained and drawn by the +1 Card");
      deepEq(p1.deck, ["a", "b", "c"], "the Duchy was on top, then drawn off");
      deepEq(p1.discard, ["province"], "Province discarded");
    });

    t("bag of gold: +1 Action and a Gold on the deck", () => {
      const g = scenario({
        seed: 38, players: 2,
        deck: [["a", "b"], ["x"]],
        hand: [["bag_of_gold"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "bag_of_gold" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.deck, ["a", "b", "gold"], "Gold on top of the deck");
      eq(p1.actions, 1, "+1 Action");
    });

    t("diadem: +$1 per unused Action when played as a Treasure", () => {
      const g = scenario({
        seed: 39, players: 2,
        deck: [["x"], ["x"]],
        hand: [["diadem", "diadem"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.treasures.play(g, "p1", { cardIds: ["diadem"] });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.coins, 1, "+$1 for the single unused Action");
      eq(p1.actions, 1, "Treasures do not spend Actions");
      Dominion.engine.treasures.play(g, "p1", { cardIds: ["diadem"] });
      eq(p1.coins, 2, "a second Diadem pays again");
    });

    t("followers: +2 Cards, an Estate, and Curses + discard-down for others", () => {
      const g = scenario({
        seed: 40, players: 2,
        deck: [["a", "b", "c", "d"], ["x"]],
        hand: [["followers"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "followers" });
      const p1 = Dominion.engine.player(g, "p1");
      const p2 = Dominion.engine.player(g, "p2");
      deepEq(p1.discard, ["estate"], "an Estate was gained");
      eq(p1.hand.length, 2, "+2 Cards");
      deepEq(p2.discard, ["curse", "copper", "copper"], "Curse gained, then discard down to 3");
    });

    t("princess: +1 Buy and cards cost $2 less while it is in play", () => {
      const g = scenario({
        seed: 41, players: 2,
        deck: [["x"], ["x"]],
        hand: [["princess", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "princess" });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.buys, 2, "+1 Buy");
      Dominion.engine.apply(g, "p1", { coins: 2 });
      Dominion.engine.buy(g, "p1", "silver");
      deepEq(p1.discard, ["silver"], "Silver ($3) bought for the discounted $1");
    });

    t("trusty steed: choose two — cards and actions", () => {
      const g = scenario({
        seed: 42, players: 2,
        deck: [["a", "b", "c", "d"], ["x"]],
        hand: [["trusty_steed"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      g.decide = (s, q) => (q.type === "trustySteedChoices" ? ["cards", "actions"] : null);
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "trusty_steed" });
      const p1 = Dominion.engine.player(g, "p1");
      deepEq(p1.hand, ["d", "c"], "+2 Cards");
      eq(p1.actions, 2, "+2 Actions");
    });

    t("trusty steed: gain 4 Silvers, deck into discard, plus the coins option", () => {
      const g = scenario({
        seed: 43, players: 2,
        deck: [["a", "b", "c"], ["x"]],
        supply: { silver: 10 },
        hand: [["trusty_steed", "copper", "copper", "copper", "copper"], ["copper", "copper", "copper", "copper", "copper"]]
      });
      g.decide = (s, q) => (q.type === "trustySteedChoices" ? ["silvers", "coins"] : null);
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "trusty_steed" });
      const p1 = Dominion.engine.player(g, "p1");
      eq(p1.discard.filter((c) => c === "silver").length, 4, "four Silvers gained");
      deepEq(p1.deck, [], "the deck was put into the discard pile");
      eq(p1.coins, 2, "+$2 from the coins option");
    });

    t("cornucopia: AI game completes with the prize batch in the kingdom", async () => {
      await Dominion.cards.init(Dominion.SETS.installed.concat(["cornucopia"]));
      const g = Dominion.engine.setup({ players: 2, kingdom: ["tournament", "horn_of_plenty", "horse_traders", "menagerie", "farming_village", "harvest", "jester", "fortune_teller", "remake", "young_witch"], seed: 81 });
      eq(g.prizes.length, 5, "the Prize pile is set up");
      assert(g.bane, "Young Witch still sets up its Bane");
      g.decide = (s, q) => Dominion.ai.choose(s, q.player, q);
      Dominion.engine.beginTurn(g, "p1");
      let guard = 0;
      while (!g.over && guard++ < 300) await Dominion.ai.playTurn(g, g.turnPlayer);
      assert(g.over, "the AI game ran to completion");
      assert(typeof Dominion.engine.score(g, "p1").total === "number", "game was scored");
    });
  });

})(typeof self !== "undefined" ? self : globalThis);
