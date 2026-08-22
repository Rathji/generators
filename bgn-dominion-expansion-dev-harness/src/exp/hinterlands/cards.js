/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/exp/hinterlands/cards.js
   Hinterlands card implementations, registered onto the engine's
   additive registries (effects / durations / triggers / reactions /
   vp). Loaded by cards.init() via the shared set loader (see
   src/sets.js) whenever "hinterlands" is part of the catalog —
   never by the shipped boot, which only loads installed sets. Safe
   to load repeatedly: every registry is a Map keyed by card id, so
   re-registering overwrites in place (idempotent).

   Farmland (on-buy trigger) is currently the only Hinterlands card
   pinned in src/exp/hinterlands/data.json — the rest of the set
   ships in its own phase.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = global.Dominion;
  const engine = Dominion.engine;

  function costCoins(id) {
    const d = Dominion.cards.get(id);
    return d && d.cost ? d.cost.coins : 0;
  }

  function costPotion(id) {
    const d = Dominion.cards.get(id);
    return d && d.cost ? d.cost.potion : 0;
  }

  function safeDecide(state, prompt) {
    try {
      const out = state.decide(state, prompt);
      return out === undefined ? null : out;
    } catch (e) {
      return null;
    }
  }

  engine.triggers.register("farmland", {
    onBuy(state, pid) {
      const p = engine.player(state, pid);
      if (p.hand.length === 0) return;
      if (safeDecide(state, { type: "farmlandTrash", player: pid, hand: p.hand.slice() }) !== true) return;
      const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
      if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
      const trashed = p.hand[asked];
      engine.primitives.trash(state, pid, { index: asked });
      const maxCost = costCoins(trashed) + 2;
      const pickable = Object.keys(state.supply)
        .filter((id) => state.supply[id] > 0 && costCoins(id) <= maxCost && costPotion(id) === 0);
      const choice = engine.primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
      if (pickable.indexOf(choice) !== -1) engine.primitives.gain(state, pid, choice);
    }
  });

})(typeof self !== "undefined" ? self : globalThis);
