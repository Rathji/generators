/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/ai.js  (Phase 4: AI opponents)
   Difficulty tiers (per-game via setup's aiDifficulty, or globally):
     easy   — noisy buy picks (low weight + randomness)
     normal — greedy per-card value buys
     hard   — tuned value buys with greening
     brutal — short next-turn lookahead layered on hard values
   ai.playTurn orchestrates actions → treasures → buys → cleanup and
   is what the UI's "Run bot turn" button calls. In-effect questions
   route through ai.choose, which applies per-card policies
   (Task 51). Special-state handling (Task 52): villagers/coffers/debt
   are spent when useful, and greening flips engine buys into Victory
   buys as the game matures. Hardening (Task 53): loop guards, seeded
   noise (state.rand), async play speed, difficulty wired into setup.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = (global.Dominion = global.Dominion || {});
  const ai = { difficulty: "normal", speed: 0 };
  Dominion.ai = ai;

  const get = (id) => (Dominion.cards && typeof Dominion.cards.get === "function" ? Dominion.cards.get(id) : null);
  const isType = (id, t) => { const d = get(id); return d ? d.types.indexOf(t) !== -1 : false; };
  const costCoins = (id) => { const d = get(id); return d && d.cost ? (d.cost.coins || 0) : 0; };
  const costPotion = (id) => { const d = get(id); return d && d.cost ? (d.cost.potion || 0) : 0; };
  const treasureVal = (id) => { const d = get(id); return d && d.treasure != null ? d.treasure : 0; };
  const playerOf = (state, pid) => state.players.find((p) => p.id === String(pid));

  /* ── action-play selection (Task 48) ────────────────────────── */
  const ACTION_RANK = {
    bandit: 62, witch: 60, militia: 58, torturer: 58, sea_witch: 46, corsair: 42,
    familiar: 42, bureaucrat: 50, wharf: 48, golem: 44, tactician: 44, bazaar: 44,
    festival: 45, laboratory: 42, village: 40, treasury: 40, cutpurse: 40,
    throne_room: 36, smithy: 35, council_room: 33, fishing_village: 38, scrying_pool: 32,
    library: 32, market: 30, trading_post: 30, university: 30, tide_pools: 30,
    apprentice: 30, upgrade: 28, sailor: 28, apothecary: 28, merchant: 25,
    moneylender: 24, lookout: 24, mine: 22, native_village: 22, smugglers: 22,
    warehouse: 22, artisan: 20, wishing_well: 20, herbalist: 20, vassal: 18,
    transmute: 18, haven: 18, cellar: 16, treasure_map: 16, outpost: 14,
    poacher: 15, sentry: 14, harbinger: 13, remodel: 12, island: 12,
    chapel: 10, pirate: 36, lighthouse: 22, monkey: 26, blockade: 34,
    merchant_ship: 30, caravan: 32, salvager: 26, sea_chart: 24, moat: 1,
    bishop: 30, charlatan: 55, city: 38, clerk: 30, expand: 22, forge: 18,
    grand_market: 45, kings_court: 34, magnate: 28, mint: 16, monument: 24,
    peddler: 26, rabble: 42, vault: 30, workers_village: 38, watchtower: 12
  };

  ai.actionScore = function (state, pid, id, context) {
    context = context || {};
    const d = get(id);
    if (!d || d.types.indexOf("Action") === -1) return -1;
    let s = ACTION_RANK[id] != null ? ACTION_RANK[id] : 8;
    if (id === "militia") {
      const oppHands = state.players.filter((p) => p.id !== String(pid)).reduce((m, p) => m + p.hand.length, 0);
      s += oppHands;
    }
    if ((id === "witch" || id === "bandit") && context.actionsPlayed === 0) s += 6;
    if (context.actionsPlayed === 0 && context.handActions === 1) s += 20;
    return s;
  };

  ai.chooseActions = function (state, pid) {
    const p = playerOf(state, pid);
    if (!p) return [];
    const acts = p.hand.filter((id) => isType(id, "Action"));
    if (!acts.length) return [];
    const ranked = acts
      .map((id) => ({ id: id, score: ai.actionScore(state, pid, id, { actionsPlayed: 0, handActions: acts.length }) }))
      .sort((a, b) => b.score - a.score);
    return ranked.map((r) => ({ cardId: r.id, zone: "hand" }));
  };

  /* ── buy decision model (Task 49) ───────────────────────────── */
  const TIER = {
    easy: { weight: 0.7, noise: 0.35 },
    normal: { weight: 1.0, noise: 0 },
    hard: { weight: 1.2, noise: 0 },
    brutal: { weight: 1.2, noise: 0 }
  };

  const BUY_BASE = {
    province: 8, duchy: 4, estate: 1, curse: -10, potion: 6, colony: 10, platinum: 8,
    gold: 5, silver: 3, copper: 0,
    witch: 7, bandit: 7, militia: 6, festival: 5, laboratory: 5, market: 5,
    smithy: 4, council_room: 4, library: 4, throne_room: 4,
    merchant: 3, moneylender: 3, mine: 3, artisan: 3, bureaucrat: 3,
    poacher: 2, sentry: 2, harbinger: 2, remodel: 2, vassal: 2, chapel: 2, cellar: 1, moat: 0,
    torturer: 6, trading_post: 3, upgrade: 3, wishing_well: 2,
    bazaar: 5, blockade: 4, caravan: 4, corsair: 5, cutpurse: 4,
    fishing_village: 4, haven: 2, island: 2, lighthouse: 3, lookout: 3,
    merchant_ship: 4, monkey: 3, native_village: 2, outpost: 2, pirate: 3,
    sailor: 3, salvager: 4, sea_chart: 3, sea_witch: 6, smugglers: 2,
    tactician: 4, tide_pools: 4, treasure_map: 2, treasury: 5,
    warehouse: 3, wharf: 6, astrolabe: 4, alchemist: 4, apothecary: 3,
    apprentice: 3, familiar: 5, golem: 5, herbalist: 2, philosophers_stone: 2,
    scrying_pool: 4, transmute: 2, university: 4,
    bishop: 4, charlatan: 5, city: 4, clerk: 4, collection: 5, crystal_ball: 3,
    expand: 5, forge: 6, grand_market: 7, hoard: 5, investment: 5,
    kings_court: 6, magnate: 4, mint: 5, monument: 4, peddler: 4, quarry: 3,
    rabble: 5, tiara: 4, vault: 5, war_chest: 4, watchtower: 3, workers_village: 4
  };

  function moneyDensity(state, pid) {
    const p = playerOf(state, pid);
    if (!p) return 0;
    let v = 0, n = 0;
    for (const zone of ["hand", "deck", "discard"]) {
      for (const id of p[zone]) v += treasureVal(id);
      n += p[zone].length;
    }
    return n ? v / n : 0;
  }

  ai.buyScore = function (state, pid, id) {
    const d = get(id);
    if (!d) return -Infinity;
    if (id !== "potion" && costPotion(id) > 0) return -Infinity;
    let s = BUY_BASE[id] != null ? BUY_BASE[id] : 1 + costCoins(id);
    const dens = moneyDensity(state, pid);
    const provLeft = state.supply.province || 0;
    if (id === "province") s = 7 + (dens >= 1.1 ? 2 : 0) + ((provLeft <= 4 || Object.keys(state.supply).filter((k) => state.supply[k] === 0).length >= 1) ? 4 : 0);
    else if (id === "duchy") s = dens >= 1.5 ? 6 : 4;
    else if (id === "estate") s = (dens >= 2.2 || provLeft === 0) ? 4 : 1;
    if (isType(id, "Treasure") && id !== "potion") s += costCoins(id) * 0.8;
    s *= (TIER[ai.difficultyFor(state, pid)] || TIER.normal).weight;
    return s;
  };

  function lookaheadValue(state, pid, id) {
    const p = playerOf(state, pid);
    if (!p) return 0;
    const total = p.hand.length + p.deck.length + p.discard.length + 1;
    const drawProb = Math.min(1, 5 / Math.max(1, total));
    return treasureVal(id) * drawProb + moneyDensity(state, pid) * 0.2;
  }

  ai.chooseBuys = function (state, pid) {
    const p = playerOf(state, pid);
    if (!p) return [];
    const tier = TIER[ai.difficultyFor(state, pid)] || TIER.normal;
    const needsPotion = Object.keys(state.supply).some((id) => costPotion(id) > 0 && (state.supply[id] || 0) > 0);
    const affordable = Object.keys(state.supply).filter((id) => {
      const d = get(id);
      if (!d || state.supply[id] <= 0) return false;
      if (id === "potion") return needsPotion && p.potions === 0 && Dominion.engine.canBuy(state, pid, id);
      if (costPotion(id) > 0) return false;
      return Dominion.engine.canBuy(state, pid, id);
    });
    if (!affordable.length) return [];
    let ranked = affordable
      .map((id) => ({ id: id, score: ai.buyScore(state, pid, id) }))
      .sort((a, b) => b.score - a.score);
    if (ai.difficultyFor(state, pid) === "brutal") {
      ranked = ranked
        .map((r) => ({ id: r.id, score: r.score + lookaheadValue(state, pid, r.id) }))
        .sort((a, b) => b.score - a.score);
    }
    const buys = [];
    if (tier.noise > 0 && state.rand && state.rand() < tier.noise && ranked.length) {
      buys.push(ranked[Math.floor(state.rand() * ranked.length)].id);
    }
    if (!buys.length && ranked.length) buys.push(ranked[0].id);
    return buys;
  };

  /* ── per-card choice policies (Task 51) ───────────────────────
     A "hand value" heuristic ranks what to keep, trash and discard:
     Curses are deeply negative, Treasures worth their coin value
     twice, good Actions keep their action rank, Victories their VP. */
  function cardValue(id) {
    const d = get(id);
    if (!d) return 0;
    if (d.types.indexOf("Curse") !== -1) return -5;
    let v = costCoins(id) + (costPotion(id) > 0 ? 3 : 0);
    if (d.treasure != null) v += d.treasure * 2;
    if (d.types.indexOf("Action") !== -1) v += (ACTION_RANK[id] != null ? ACTION_RANK[id] / 10 : 0.8);
    if (d.types.indexOf("Victory") !== -1) v += (d.vp || 0) * 1.2;
    if (d.types.indexOf("Reaction") !== -1) v -= 0.4;
    return v;
  }
  ai.cardValue = cardValue;

  function bestOption(prompt) { return prompt.options.slice().sort((a, b) => cardValue(b) - cardValue(a))[0] || null; }

  ai.choose = function (state, playerId, q) {
    if (!q || !q.type) return null;
    const handIdx = () => q.hand.map((id, i) => ({ id, i }));
    const byValueAsc = () => handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id)).map((o) => o.i);
    try {
      switch (q.type) {
        case "react": return q.options.slice();
        case "discardDown":
        case "discardPerEmpty":
          return byValueAsc().slice(0, q.count != null ? q.count : q.max);
        case "discardAny":
          return byValueAsc().filter((i) => cardValue(q.hand[i]) <= 2.5);
        case "trashUpTo":
          return byValueAsc().slice(0, q.max);
        case "trashAny":
          return byValueAsc()[0] != null ? byValueAsc()[0] : null;
        case "trashTreasure": {
          const idx = handIdx().filter((o) => isType(o.id, "Treasure"))
            .sort((a, b) => (costCoins(b.id) - costCoins(a.id)) || (treasureVal(b.id) - treasureVal(a.id)))
            .map((o) => o.i);
          return idx.length ? idx[0] : null;
        }
        case "trashCopper": return q.options && q.options.length ? q.options[0] : null;
        case "trashRevealed": {
          const best = q.options.slice().sort((a, b) => (treasureVal(b) - treasureVal(a)) || (costCoins(b) - costCoins(a)))[0];
          return best || null;
        }
        case "gainToHand":
        case "gainTreasure":
        case "gainCard":
          return bestOption(q);
        case "playActionTwice": {
          const best = q.options.slice().sort((a, b) => ai.actionScore(state, playerId, b, {}) - ai.actionScore(state, playerId, a, {}))[0];
          return best || null;
        }
        case "sentryLook": {
          const trash = [], discard = [];
          for (const c of q.cards) {
            if (c === "curse") trash.push(c);
            else if (cardValue(c) <= 3) discard.push(c);
          }
          return { trash: trash, discard: discard };
        }
        case "topdeckTop": return q.card ? cardValue(q.card) >= 6 : false;
        case "setAsideAction": return q.card ? cardValue(q.card) <= 3 : false;
        case "baronDiscard": return q.canDiscard === true;
        case "courtierChoice": return ["gold", "coins", "action", "buy"].find((o) => q.options.indexOf(o) !== -1) || null;
        case "revealCard":
        case "courtyardTopdeck": {
          const order = handIdx().sort((a, b) => (q.type === "courtyardTopdeck" ? cardValue(a.id) - cardValue(b.id) : cardValue(b.id) - cardValue(a.id))).map((o) => o.i);
          return order.length ? order[0] : null;
        }
        case "diplomatDiscard": {
          const order = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id)).map((o) => o.i);
          return order.slice(0, q.count != null ? q.count : 3);
        }
        case "farmlandTrash": {
          const worst = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id))[0];
          return !!(worst && cardValue(worst.id) <= 2);
        }
        case "lurkerMode": return q.options.indexOf("trashSupply") !== -1 ? "trashSupply" : "gainTrash";
        case "lurkerTrashSupply":
        case "lurkerGainTrash":
          return bestOption(q);
        case "masqueradePass": {
          const order = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id)).map((o) => o.i);
          return order.length ? order[0] : null;
        }
        case "masqueradeTrash": {
          const worst = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id))[0];
          return !!(worst && cardValue(worst.id) <= 2);
        }
        case "millDiscard": {
          const junk = handIdx().filter((o) => cardValue(o.id) <= 2).length;
          return junk >= 2;
        }
        case "discardExactly": {
          const order = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id)).map((o) => o.i);
          return order.slice(0, q.count != null ? q.count : 2);
        }
        case "miningVillageTrash": return true;
        case "youngWitchBane": return q.hasBane === true;
        case "hamletDiscard": {
          const order = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id));
          return order.length && cardValue(order[0].id) <= 1 ? order[0].i : null;
        }
        case "jesterChoice": return "self";
        case "tournamentRevealProvince": return q.hasProvince === true;
        case "gainPrize": {
          const pref = ["bag_of_gold", "followers", "trusty_steed", "diadem", "princess"];
          for (const p of pref) if (q.options.indexOf(p) !== -1) return p;
          return q.options[0] || null;
        }
        case "trustySteedChoices": return ["cards", "actions"];
        case "minionMode": return "coins";
        case "noblesChoice": return "cards";
        case "pawnChoices": return ["card", "action"];
        case "patrolOrder": return q.cards.slice();
        case "secretPassageCard": {
          const order = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id)).map((o) => o.i);
          return order.length ? order[0] : null;
        }
        case "secretPassageDepth": return 0;
        case "stewardMode": return "cards";
        case "trashTwo": {
          const order = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id)).map((o) => o.i);
          return order.slice(0, q.count != null ? q.count : 2);
        }
        case "swindlerGain": {
          const worst = q.options.slice().sort((a, b) => cardValue(a) - cardValue(b))[0];
          return worst != null ? worst : null;
        }
        case "topdeckVictory": {
          const dens = moneyDensity(state, playerId);
          const provLeft = state.supply.province || 0;
          if (dens < 1.4 && provLeft > 3) return null;
          return bestOption(q);
        }
        case "wishName": return bestOption(q);
        case "nativeVillageMode": return "deck";
        case "havenSetAside":
        case "islandSetAside": {
          const order = handIdx().sort((a, b) => cardValue(a.id) - cardValue(b.id)).map((o) => o.i);
          return order.length ? order[0] : null;
        }
        case "sailorPlay":
        case "piratePlay": return true;
        case "alchemistTopdeck":
        case "treasuryTopdeck": return true;
        case "herbalistReturn": return bestOption(q);
        case "scryingTop": return "discard";
        case "golemOrder":
        case "apothecaryOrder": return q.cards ? q.cards.slice() : [];
        case "lookoutDispose": {
          const order = q.cards.map((id, i) => ({ id, i })).sort((a, b) => cardValue(a.id) - cardValue(b.id)).map((o) => o.i);
          return { trash: order[0] != null ? order[0] : null, discard: order[1] != null ? order[1] : null };
        }
        case "torturerChoice": {
          return q.hand && q.hand.length >= 2 ? "discard" : "curse";
        }
        case "anvilDiscard": {
          const order = handIdx().filter((o) => isType(o.id, "Treasure"))
            .sort((a, b) => (costCoins(b.id) - costCoins(a.id)) || (treasureVal(b.id) - treasureVal(a.id)))
            .map((o) => o.i);
          return order.length ? order[0] : null;
        }
        case "crystalBallUse": {
          if (q.options.indexOf("trash") !== -1) return "trash";
          if (q.options.indexOf("play") !== -1) return "play";
          return q.options.length ? q.options[0] : "discard";
        }
        case "investmentMode": return "coins";
        case "warChestName": {
          const best = q.options.slice().sort((a, b) => (costCoins(b) - costCoins(a)) || (cardValue(b) - cardValue(a)))[0];
          return best || null;
        }
        case "vaultDiscard": {
          const idx = handIdx().filter((o) => isType(o.id, "Treasure") && costCoins(o.id) === 0).map((o) => o.i);
          return idx.length ? idx : [];
        }
        case "vaultOpp": return false;
        case "tiaraTopdeck":
        case "clerkPlay": return true;
        case "watchtowerUse": {
          if (q.gained && q.gained === "curse") return "trash";
          if (q.cost != null && q.cost >= 5) return "topdeck";
          return "trash";
        }
        case "tiaraDouble": return q.options && q.options.length ? q.options[0] : null;
        case "mintCopy": {
          const order = handIdx().filter((o) => isType(o.id, "Treasure"))
            .sort((a, b) => (costCoins(b.id) - costCoins(a.id)) || (treasureVal(b.id) - treasureVal(a.id)))
            .map((o) => o.i);
          return order.length ? order[0] : null;
        }
        case "playActionThrice": {
          const best = q.options.slice().sort((a, b) => ai.actionScore(state, playerId, b, {}) - ai.actionScore(state, playerId, a, {}))[0];
          return best || null;
        }
        default: return null;
      }
    } catch (e) { return null; }
  };

  /* ── difficulty + play speed (Task 53) ──────────────────────── */
  ai.setDifficulty = function (d) {
    if (TIER[d]) ai.difficulty = d;
    return ai.difficulty;
  };
  ai.difficultyFor = function (state, pid) {
    if (state && state.aiDifficulty) {
      if (typeof state.aiDifficulty === "string" && TIER[state.aiDifficulty]) return state.aiDifficulty;
      const d = state.aiDifficulty[String(pid)];
      if (d && TIER[d]) return d;
    }
    return ai.difficulty;
  };
  ai.wait = function (ms) { return (ms > 0) ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); };

  /* ── full turn orchestrator (async, speed-steppable) ────────── */
  ai.playTurn = async function (state, pid) {
    const eng = Dominion.engine;
    const p = playerOf(state, pid);
    if (!p) return { actionsPlayed: 0, buys: 0 };
    const stepMs = ai.speed === 2 ? 650 : ai.speed === 1 ? 250 : 0;
    let actionsPlayed = 0, buys = 0;
    let guard = 0;
    while (guard++ < 80) {
      if (p.actions <= 0 && p.villagers > 0) {
        p.villagers--;
        eng.addResource(state, pid, "actions", 1);
        state.log.push({ t: "res", player: pid, res: "actions", delta: 1 });
      }
      if (p.actions <= 0) break;
      const plan = ai.chooseActions(state, pid);
      if (!plan || !plan.length) break;
      let done = false;
      for (const play of plan) {
        try {
          eng.actions.play(state, pid, { cardId: play.cardId });
          actionsPlayed++;
          done = true;
          break;
        } catch (e) { /* card may no longer be in hand; try the next */ }
      }
      if (!done) break;
      await ai.wait(stepMs);
    }
    while (p.coffers > 0 && guard++ < 200) {
      p.coffers--;
      eng.addResource(state, pid, "coins", 1);
    }
    try { eng.payDebt(state, pid); } catch (e) { /* ignore */ }
    try { eng.treasures.playAll(state, pid); } catch (e) { /* ignore */ }
    guard = 0;
    while (p.buys > 0 && guard++ < 30) {
      const plan = ai.chooseBuys(state, pid);
      if (!plan || !plan.length) break;
      let done = false;
      for (const id of plan) {
        try { eng.buy(state, pid, id); buys++; done = true; break; }
        catch (e) { /* not affordable anymore; try the next */ }
      }
      if (!done) break;
      await ai.wait(stepMs);
    }
    guard = 0;
    while (state.turnPlayer === String(pid) && !state.over && guard++ < 12) {
      try { eng.advancePhase(state); } catch (e) { break; }
    }
    return { actionsPlayed: actionsPlayed, buys: buys };
  };

})(typeof self !== "undefined" ? self : globalThis);
