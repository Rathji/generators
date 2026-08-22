/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/exp/menagerie/cards.js
   Menagerie card implementations, registered onto the engine's
   additive registries (effects / triggers / vp). Loaded by
   cards.init() via the shared set loader whenever "menagerie" is
   part of the catalog — never by the shipped boot. Safe to load
   repeatedly: every registry is a Map keyed by card id, so
   re-registering overwrites in place (idempotent).

   Task 395 — the 20 Ways. A Way is a landscape that gives Action
   cards an alternate ability: engine.actions.play(state, pid,
   { cardId, way: "way_of_the_x" }) resolves the Way's text instead
   of the card's own. Each Way effect receives ctx.cardId = the
   Action card being played "for" the Way (its "this"). The turn-
   scoped hooks (Chameleon swap, Frog topdeck, Seal topdeck,
   Squirrel draw, Turtle replay) live in src/engine.js; the setups
   (g.ways, g.mouseCard) are done by engine.setup().
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = global.Dominion;
  const engine = Dominion.engine;

  function safeDecide(state, prompt) {
    try {
      const out = state.decide(state, prompt);
      return out === undefined ? null : out;
    } catch (e) {
      return null;
    }
  }

  function costCoins(id) {
    const d = Dominion.cards.get(id);
    return d && d.cost ? d.cost.coins : 0;
  }

  /* returnThisToPile — a Way says "return this to its pile": the
     card being played via the Way goes back to its supply pile. The
     card just needs a tracked pile (state.supply[cardId] present) —
     this covers ordinary kingdom cards and Menagerie's Horse, which is a
     pile even though it is not a supply pile. */
  function returnThisToPile(state, pid, cardId) {
    const p = engine.player(state, pid);
    const idx = p.play.indexOf(cardId);
    if (idx === -1) return;
    const d = Dominion.cards.get(cardId);
    const hasPile = !!d && state.supply[cardId] != null;
    if (hasPile) {
      engine.zones.move(state, engine.loc(pid, "play"), engine.zoneRef.supply, { index: idx });
      state.log.push({ t: "wayReturnToPile", player: pid, card: cardId });
    }
  }

  /* Task 396 — the Horse pile. Horse is a non-supply Action gained only
     by effects: when you play it, +2 Cards, +1 Action, and return
     it to its pile. */
  engine.effects.register("horse", (state, pid, ctx) => {
    engine.apply(state, pid, { cards: 2, actions: 1 });
    returnThisToPile(state, pid, ctx.cardId);
  });

  /* ── Task 395: the 20 Ways ── */

  /* Way of the Butterfly: "You may return this to its pile to gain
     a card costing exactly $1 more than it." */
  engine.effects.register("way_of_the_butterfly", (state, pid, ctx) => {
    const thisCard = ctx.cardId;
    const yes = safeDecide(state, { type: "butterflyReturn", player: pid, card: thisCard });
    if (yes === true) {
      returnThisToPile(state, pid, thisCard);
      const targetCost = costCoins(thisCard) + 1;
      const pickable = Object.keys(state.supply).filter((id) =>
        state.supply[id] > 0 && costCoins(id) === targetCost &&
        (Dominion.cards.get(id).cost.potion || 0) === 0);
      const choice = engine.primitives.choose(state, pid, { type: "gainCard", maxCost: targetCost, exactCost: targetCost }, pickable);
      if (pickable.indexOf(choice) !== -1) engine.primitives.gain(state, pid, choice);
    }
  });

  /* Way of the Camel: "Exile a Gold from the Supply." */
  engine.effects.register("way_of_the_camel", (state, pid) => {
    if (engine.zones.supplyCount(state, "gold") > 0) {
      engine.primitives.exile(state, pid, { cardId: "gold", from: engine.zoneRef.supply });
    }
  });

  /* Way of the Chameleon: "Follow this card's instructions; each
     time that would give you +Cards this turn, you get +$1 instead,
     and vice-versa." (The swap is engine.apply-aware via
     p.chameleonSwap, reset each turn in beginTurn.) */
  engine.effects.register("way_of_the_chameleon", (state, pid, ctx) => {
    engine.player(state, pid).chameleonSwap = true;
    engine.effects.resolve(state, pid, ctx.cardId, { cardId: ctx.cardId });
  });

  /* Way of the Frog: "+1 Action. When you discard this from play
     this turn, put it onto your deck." (cleanup topdecks it.) */
  engine.effects.register("way_of_the_frog", (state, pid, ctx) => {
    engine.apply(state, pid, { actions: 1 });
    const p = engine.player(state, pid);
    if (p.frogTopdeck.indexOf(ctx.cardId) === -1) p.frogTopdeck.push(ctx.cardId);
  });

  /* Way of the Goat: "Trash a card from your hand." */
  engine.effects.register("way_of_the_goat", (state, pid) => {
    const p = engine.player(state, pid);
    if (p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) {
      engine.primitives.trash(state, pid, { index: asked });
    }
  });

  /* Way of the Horse: "+2 Cards; +1 Action; Return this to its pile." */
  engine.effects.register("way_of_the_horse", (state, pid, ctx) => {
    engine.apply(state, pid, { cards: 2, actions: 1 });
    returnThisToPile(state, pid, ctx.cardId);
  });

  /* Way of the Mole: "+1 Action; Discard your hand; +3 Cards." */
  engine.effects.register("way_of_the_mole", (state, pid) => {
    engine.apply(state, pid, { actions: 1 });
    const p = engine.player(state, pid);
    if (p.hand.length) engine.primitives.discard(state, pid, p.hand.map((_, i) => i));
    engine.zones.draw(state, pid, 3);
  });

  /* Way of the Monkey: "+1 Buy; +$1" */
  engine.effects.register("way_of_the_monkey", (state, pid) => engine.apply(state, pid, { buys: 1, coins: 1 }));

  /* Way of the Mouse: "Play the set-aside card, leaving it there."
     Setup (engine.setup): set aside an unused Action costing $2 or
     $3, tracked as state.mouseCard. */
  engine.effects.register("way_of_the_mouse", (state, pid) => {
    const mouseCard = state.mouseCard;
    if (!mouseCard) return;
    engine.effects.resolve(state, pid, mouseCard, { cardId: mouseCard });
  });

  /* Way of the Mule: "+1 Action; +$1" */
  engine.effects.register("way_of_the_mule", (state, pid) => engine.apply(state, pid, { actions: 1, coins: 1 }));

  /* Way of the Otter: "+2 Cards" */
  engine.effects.register("way_of_the_otter", (state, pid) => engine.apply(state, pid, { cards: 2 }));

  /* Way of the Owl: "Draw until you have 6 cards in hand." */
  engine.effects.register("way_of_the_owl", (state, pid) => {
    const p = engine.player(state, pid);
    let guard = 0;
    while (p.hand.length < 6 && guard++ < 60) engine.zones.draw(state, pid, 1);
  });

  /* Way of the Ox: "+2 Actions" */
  engine.effects.register("way_of_the_ox", (state, pid) => engine.apply(state, pid, { actions: 2 }));

  /* Way of the Pig: "+1 Card; +1 Action" */
  engine.effects.register("way_of_the_pig", (state, pid) => engine.apply(state, pid, { cards: 1, actions: 1 }));

  /* Way of the Rat: "You may discard a Treasure to gain a copy of
     this." (this = the Action being played via the Way.) */
  engine.effects.register("way_of_the_rat", (state, pid, ctx) => {
    const p = engine.player(state, pid);
    const thisCard = ctx.cardId;
    const treasures = p.hand.map((c, i) => ({ c, i })).filter((x) => Dominion.cards.get(x.c) && Dominion.cards.get(x.c).types.indexOf("Treasure") !== -1);
    const asked = safeDecide(state, { type: "ratDiscardTreasure", player: pid, card: thisCard, options: treasures.map((x) => x.i) });
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length &&
        Dominion.cards.get(p.hand[asked]) && Dominion.cards.get(p.hand[asked]).types.indexOf("Treasure") !== -1) {
      engine.primitives.discard(state, pid, [asked]);
      if (state.supply[thisCard] != null && state.supply[thisCard] > 0) {
        engine.primitives.gain(state, pid, thisCard);
      }
    }
  });

  /* Way of the Seal: "+$1. This turn, when you gain a card, you may
     put it onto your deck." (hook in engine.afterGain.) */
  engine.effects.register("way_of_the_seal", (state, pid) => {
    engine.apply(state, pid, { coins: 1 });
    engine.player(state, pid).sealTopdeck = true;
  });

  /* Way of the Sheep: "+$2" */
  engine.effects.register("way_of_the_sheep", (state, pid) => engine.apply(state, pid, { coins: 2 }));

  /* Way of the Squirrel: "+2 Cards at the end of this turn."
     (drawn in engine.cleanup, kept for the next turn.) */
  engine.effects.register("way_of_the_squirrel", (state, pid) => {
    engine.player(state, pid).squirrelDraw += 2;
  });

  /* Way of the Turtle: "Set this aside. If you did, play it at the
     start of your next turn." (beginTurn replays it.) */
  engine.effects.register("way_of_the_turtle", (state, pid, ctx) => {
    const p = engine.player(state, pid);
    const idx = p.play.indexOf(ctx.cardId);
    if (idx === -1) return;
    engine.zones.move(state, engine.loc(pid, "play"), engine.loc(pid, "setAside"), { index: idx });
    if (p.turtleAside.indexOf(ctx.cardId) === -1) p.turtleAside.push(ctx.cardId);
  });

  /* Way of the Worm: "Exile an Estate from the Supply." */
  engine.effects.register("way_of_the_worm", (state, pid) => {
    if (engine.zones.supplyCount(state, "estate") > 0) {
      engine.primitives.exile(state, pid, { cardId: "estate", from: engine.zoneRef.supply });
    }
  });

})(typeof self !== "undefined" ? self : globalThis);
