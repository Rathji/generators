/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/exp/cornucopia/cards.js
   Cornucopia card implementations, registered onto the engine's
   additive registries (effects / durations / triggers / reactions /
   vp). Loaded by cards.init() via the shared set loader (see
   src/sets.js) whenever "cornucopia" is part of the catalog — never
   by the shipped boot, which only loads installed sets. Safe to
   load repeatedly: every registry is a Map keyed by card id, so
   re-registering overwrites in place (idempotent).

   Implemented (roadmap order):
     Fairgrounds     (vp)     — task 164: official 1E per-5 formula.
     Young Witch     (attack) — task 163: +2 Cards; discard 2; each
                                other player may reveal a Bane card or
                                gains a Curse. The Bane pile is chosen
                                at setup by engine.setupGame (pickBane)
                                and tracked as state.bane.
     Menagerie       — +1 Action; no duplicate hand → +3 Cards.
     Hamlet          — +1 Card/+1 Action, two optional discards for
                        +1 Action / +1 Buy.
     Farming Village — +2 Actions; reveal until an Action/Treasure.
     Harvest         — reveal & discard top 4, +$1 per different name.
     Hunting Party   — +1 Card/+1 Action; reveal until a non-duplicate.
     Remake          — twice: trash a card, gain one costing exactly
                        $1 more.
     Jester          — +$2; each other player discards the top card;
                        Victory → Curse, else the attacker or the
                        target gains a copy (attacker's choice).
     Fortune Teller  — +$2; each other player reveals until a Victory
                        or Curse, which goes on top; the rest discard.
     Horn of Plenty  — when played: gain up to $1 per different card
                        in play; a Victory gain trashes this.
     Horse Traders   — +1 Buy; +3 Coins; discard 2. Reaction: set
                        aside vs an Attack; at your next turn start
                        +1 Card and return to hand.
     Tournament      — may reveal a Province for a Prize/Duchy on the
                        deck; +1 Card/+$1 if no other player revealed.
     Prizes          — Bag of Gold, Diadem, Followers, Princess,
                        Trusty Steed (gained via Tournament; the Prize
                        pile is state.prizes, seeded at setup).
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

  function isType(id, type) {
    const d = Dominion.cards.get(id);
    return !!d && d.types.indexOf(type) !== -1;
  }

  function costCoins(id) {
    const d = Dominion.cards.get(id);
    return d && d.cost ? d.cost.coins : 0;
  }

  function costPotion(id) {
    const d = Dominion.cards.get(id);
    return d && d.cost ? d.cost.potion : 0;
  }

  engine.vp.register("fairgrounds", (state, pid) =>
    2 * Math.floor(new Set(engine.playerCards(state, pid)).size / 5));

  engine.effects.register("young_witch", (state, pid) => {
    engine.apply(state, pid, { cards: 2 });
    const p = engine.player(state, pid);
    const asked = safeDecide(state, { type: "discardExactly", player: pid, count: 2, hand: p.hand.slice() });
    const idx = [];
    if (Array.isArray(asked)) {
      for (const i of asked) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && idx.indexOf(i) === -1) idx.push(i);
      }
    }
    engine.primitives.discard(state, pid, idx.slice(0, 2));
    engine.attack.dispatch(state, pid, "young_witch", (s, t) => {
      const tplayer = engine.player(s, t);
      const bane = s.bane || null;
      const baneIdx = bane ? tplayer.hand.indexOf(bane) : -1;
      const reveal = safeDecide(s, {
        type: "youngWitchBane", player: t, attack: "young_witch",
        bane: bane, hasBane: baneIdx !== -1
      });
      if (reveal === true && baneIdx !== -1) {
        engine.primitives.reveal(s, t, bane);
      } else if (engine.zones.supplyCount(s, "curse") > 0) {
        engine.primitives.gain(s, t, "curse");
      }
    });
  });

  engine.effects.register("menagerie", (state, pid) => {
    engine.apply(state, pid, { actions: 1 });
    const p = engine.player(state, pid);
    engine.primitives.reveal(state, pid, p.hand.slice());
    const dupes = new Set(p.hand).size !== p.hand.length;
    engine.apply(state, pid, dupes ? { cards: 1 } : { cards: 3 });
  });

  /* hamlet — two optional "discard a card" steps; the first grants
     +1 Action, the second +1 Buy. */
  engine.effects.register("hamlet", (state, pid) => {
    engine.apply(state, pid, { cards: 1, actions: 1 });
    hamletDiscardStep(state, pid, "action");
    hamletDiscardStep(state, pid, "buy");
  });

  function hamletDiscardStep(state, pid, bonus) {
    const p = engine.player(state, pid);
    if (p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "hamletDiscard", player: pid, bonus: bonus, hand: p.hand.slice() });
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) {
      engine.primitives.discard(state, pid, [asked]);
      engine.apply(state, pid, bonus === "action" ? { actions: 1 } : { buys: 1 });
    }
  }

  /* farming_village — reveal from the top of the deck until an Action
     or Treasure appears; it goes to hand, the rest are discarded. */
  engine.effects.register("farming_village", (state, pid) => {
    engine.apply(state, pid, { actions: 2 });
    const p = engine.player(state, pid);
    while (p.deck.length > 0) {
      const id = engine.zones.top(state, pid, "deck");
      engine.primitives.reveal(state, pid, id);
      if (isType(id, "Action") || isType(id, "Treasure")) {
        engine.zones.move(state, engine.loc(pid, "deck"), engine.loc(pid, "hand"), { fromTop: true });
        break;
      }
      engine.zones.move(state, engine.loc(pid, "deck"), engine.loc(pid, "discard"), { fromTop: true });
    }
  });

  /* harvest — reveal the top 4, discard them, +$1 per different name. */
  engine.effects.register("harvest", (state, pid) => {
    const p = engine.player(state, pid);
    const revealed = [];
    for (let i = 0; i < 4 && p.deck.length > 0; i++) {
      const id = engine.zones.top(state, pid, "deck");
      engine.primitives.reveal(state, pid, id);
      engine.zones.move(state, engine.loc(pid, "deck"), engine.loc(pid, "discard"), { fromTop: true });
      revealed.push(id);
    }
    engine.apply(state, pid, { coins: new Set(revealed).size });
  });

  /* hunting_party — +1 Card/+1 Action; reveal until a card that is
     not a duplicate of one in your hand, which goes to hand. */
  engine.effects.register("hunting_party", (state, pid) => {
    engine.apply(state, pid, { cards: 1, actions: 1 });
    const p = engine.player(state, pid);
    while (p.deck.length > 0) {
      const id = engine.zones.top(state, pid, "deck");
      engine.primitives.reveal(state, pid, id);
      if (p.hand.indexOf(id) === -1) {
        engine.zones.move(state, engine.loc(pid, "deck"), engine.loc(pid, "hand"), { fromTop: true });
        break;
      }
      engine.zones.move(state, engine.loc(pid, "deck"), engine.loc(pid, "discard"), { fromTop: true });
    }
  });

  /* remake — twice: trash a card from hand, gain one costing exactly
     $1 more (coin cost). */
  engine.effects.register("remake", (state, pid) => {
    for (let n = 0; n < 2; n++) {
      const p = engine.player(state, pid);
      if (p.hand.length === 0) break;
      const asked = safeDecide(state, { type: "trashAny", player: pid, card: "remake", hand: p.hand.slice() });
      if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) break;
      const trashed = p.hand[asked];
      engine.primitives.trash(state, pid, { index: asked });
      const target = costCoins(trashed) + 1;
      const pickable = Object.keys(state.supply)
        .filter((id) => state.supply[id] > 0 && costCoins(id) === target && costPotion(id) === 0);
      const choice = engine.primitives.choose(state, pid, { type: "gainCard", exact: target, maxCost: target }, pickable);
      if (pickable.indexOf(choice) !== -1) engine.primitives.gain(state, pid, choice);
    }
  });

  /* jester — +$2; each other player discards the top card: a Victory
     means they gain a Curse; otherwise a copy is gained by the
     attacker or the target, attacker's choice. */
  engine.effects.register("jester", (state, pid) => {
    engine.apply(state, pid, { coins: 2 });
    engine.attack.dispatch(state, pid, "jester", (s, t) => {
      const tp = engine.player(s, t);
      if (tp.deck.length === 0) return;
      const id = engine.zones.top(s, t, "deck");
      engine.primitives.reveal(s, t, id);
      engine.zones.move(s, engine.loc(t, "deck"), engine.loc(t, "discard"), { fromTop: true });
      if (isType(id, "Victory")) {
        if (engine.zones.supplyCount(s, "curse") > 0) engine.primitives.gain(s, t, "curse");
        return;
      }
      if (engine.zones.supplyCount(s, id) < 1) return;
      const choice = safeDecide(s, { type: "jesterChoice", player: pid, attack: "jester", target: t, card: id });
      if (choice === "target") engine.primitives.gain(s, t, id);
      else engine.primitives.gain(s, pid, id);
    });
  });

  /* fortune_teller — +$2; each other player reveals from the deck
     until a Victory or Curse appears (it stays on top); the other
     revealed cards are discarded. */
  engine.effects.register("fortune_teller", (state, pid) => {
    engine.apply(state, pid, { coins: 2 });
    engine.attack.dispatch(state, pid, "fortune_teller", (s, t) => {
      const tp = engine.player(s, t);
      while (tp.deck.length > 0) {
        const id = engine.zones.top(s, t, "deck");
        engine.primitives.reveal(s, t, id);
        if (isType(id, "Victory") || isType(id, "Curse")) break;
        engine.zones.move(s, engine.loc(t, "deck"), engine.loc(t, "discard"), { fromTop: true });
      }
    });
  });

  /* horn_of_plenty — when played, gain a card costing up to $1 per
     differently named card in play (counting this). A gained Victory
     card trashes this. */
  engine.effects.register("horn_of_plenty", (state, pid) => {
    const p = engine.player(state, pid);
    const budget = new Set(p.play).size;
    const pickable = Object.keys(state.supply)
      .filter((id) => state.supply[id] > 0 && costCoins(id) <= budget && costPotion(id) === 0);
    const choice = engine.primitives.choose(state, pid, { type: "gainCard", maxCost: budget }, pickable);
    if (pickable.indexOf(choice) !== -1) {
      engine.primitives.gain(state, pid, choice);
      if (isType(choice, "Victory")) {
        engine.primitives.trash(state, pid, { from: engine.loc(pid, "play"), cardId: "horn_of_plenty" });
      }
    }
  });

  /* horse_traders — Action-Reaction: +1 Buy; +3 Coins; discard 2.
     When attacked, it may be set aside from hand; at the start of
     your next turn it draws +1 Card and returns to hand. */
  engine.effects.register("horse_traders", (state, pid) => {
    engine.apply(state, pid, { buys: 1, coins: 3 });
    const p = engine.player(state, pid);
    const asked = safeDecide(state, { type: "discardExactly", player: pid, count: 2, hand: p.hand.slice() });
    const idx = [];
    if (Array.isArray(asked)) {
      for (const i of asked) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && idx.indexOf(i) === -1) idx.push(i);
      }
    }
    engine.primitives.discard(state, pid, idx.slice(0, 2));
  });

  engine.reactions.register("horse_traders", () => ({ setAside: true }));

  engine.triggers.register("horse_traders", {
    onTurnStart(state, pid) {
      const p = engine.player(state, pid);
      const count = p.setAside.filter((c) => c === "horse_traders").length;
      if (count === 0) return;
      engine.apply(state, pid, { cards: count });
      while (p.setAside.indexOf("horse_traders") !== -1) {
        engine.zones.move(state, engine.loc(pid, "setAside"), engine.loc(pid, "hand"), { cardId: "horse_traders" });
      }
    }
  });

  /* tournament — each player may reveal a Province from hand; if you
     do, discard it and gain a Prize (or a Duchy once the Prize pile
     is empty) on top of your deck. If no other player revealed, you
     get +1 Card and +$1. */
  engine.effects.register("tournament", (state, pid) => {
    engine.apply(state, pid, { actions: 1 });
    const p = engine.player(state, pid);
    const ownHas = p.hand.indexOf("province") !== -1;
    const ownReveals = ownHas && safeDecide(state, { type: "tournamentRevealProvince", player: pid, hasProvince: true, hand: p.hand.slice() }) === true;
    if (ownReveals) {
      engine.primitives.reveal(state, pid, "province");
      engine.primitives.discard(state, pid, [p.hand.indexOf("province")]);
      tournamentGain(state, pid);
    }
    let othersRevealed = false;
    for (const other of state.players) {
      if (other.id === pid) continue;
      const op = engine.player(state, other.id);
      const has = op.hand.indexOf("province") !== -1;
      const reveals = has && safeDecide(state, { type: "tournamentRevealProvince", player: other.id, hasProvince: true, hand: op.hand.slice() }) === true;
      if (reveals) {
        othersRevealed = true;
        engine.primitives.reveal(state, other.id, "province");
        engine.primitives.discard(state, other.id, [op.hand.indexOf("province")]);
        tournamentGain(state, other.id);
      }
    }
    if (!othersRevealed) engine.apply(state, pid, { cards: 1, coins: 1 });
  });

  function tournamentGain(state, pid) {
    const prizes = state.prizes || [];
    let choice = null;
    if (prizes.length) {
      choice = engine.primitives.choose(state, pid, { type: "gainPrize" }, prizes.slice());
    }
    if (choice != null && prizes.indexOf(choice) !== -1) {
      state.prizes.splice(state.prizes.indexOf(choice), 1);
      const p = engine.player(state, pid);
      p.deck.push(choice);
      state.log.push({ t: "gain", player: pid, card: choice, from: "prizes", to: "deck" });
    } else if (engine.zones.supplyCount(state, "duchy") > 0) {
      engine.primitives.gain(state, pid, "duchy", { to: engine.loc(pid, "deck") });
    }
  }

  /* ── The five Prizes (gained only via Tournament) ── */
  engine.effects.register("bag_of_gold", (state, pid) => {
    engine.apply(state, pid, { actions: 1 });
    if (engine.zones.supplyCount(state, "gold") > 0) {
      engine.primitives.gain(state, pid, "gold", { to: engine.loc(pid, "deck") });
    }
  });

  engine.effects.register("diadem", (state, pid) => {
    const p = engine.player(state, pid);
    if (p.actions > 0) engine.apply(state, pid, { coins: p.actions });
  });

  engine.effects.register("followers", (state, pid) => {
    engine.apply(state, pid, { cards: 2 });
    if (engine.zones.supplyCount(state, "estate") > 0) engine.primitives.gain(state, pid, "estate");
    engine.attack.dispatch(state, pid, "followers", (s, t) => {
      if (engine.zones.supplyCount(s, "curse") > 0) engine.primitives.gain(s, t, "curse");
      const tp = engine.player(s, t);
      const count = Math.max(0, tp.hand.length - 3);
      if (count === 0) return;
      const asked = safeDecide(s, { type: "discardDown", player: t, attack: "followers", count: count, hand: tp.hand.slice() });
      const chosen = [];
      if (Array.isArray(asked)) {
        for (const i of asked) {
          if (Number.isInteger(i) && i >= 0 && i < tp.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
        }
      }
      engine.primitives.discard(s, t, chosen);
    });
  });

  engine.effects.register("princess", (state, pid) => {
    engine.apply(state, pid, { buys: 1 });
    engine.player(state, pid).princessActive = true;
  });

  engine.effects.register("trusty_steed", (state, pid) => {
    const modes = ["cards", "actions", "coins", "silvers"];
    const asked = safeDecide(state, { type: "trustySteedChoices", player: pid, options: modes.slice() });
    const picked = [];
    if (Array.isArray(asked)) {
      for (const m of asked) if (modes.indexOf(m) !== -1 && picked.indexOf(m) === -1) picked.push(m);
    }
    for (const m of picked.slice(0, 2)) {
      if (m === "cards") engine.apply(state, pid, { cards: 2 });
      else if (m === "actions") engine.apply(state, pid, { actions: 2 });
      else if (m === "coins") engine.apply(state, pid, { coins: 2 });
      else if (m === "silvers") {
        for (let i = 0; i < 4 && engine.zones.supplyCount(state, "silver") > 0; i++) {
          engine.primitives.gain(state, pid, "silver");
        }
        const p = engine.player(state, pid);
        p.discard.push.apply(p.discard, p.deck.splice(0));
      }
    }
  });

})(typeof self !== "undefined" ? self : globalThis);
