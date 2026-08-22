/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/engine.js  (Task 1: skeleton + harness)
   Pure, DOM-free core: seeded RNG, shuffling, and the player/game
   state shapes. Zones hold card id strings; their definitions live
   in the cards registry (src/cards.js + src/data/*.json).

   Loads as a plain <script> in the page and attaches to
   globalThis.Dominion.engine — the same IIFE pattern lets it run
   in isolated worker test contexts (execute_js), which keeps the
   game logic testable without a DOM.

   Files:
     engine.js  — this file: RNG, shuffle, state shapes
     cards.js   — card schema + registry (Task 2)
     ai.js      — AI opponent interfaces (Phase 4)
     ui.js      — tabletop UI interfaces (Phase 3)
     net.js     — multiplayer interfaces (Phase 23)
     tests.js   — deterministic rule-assertion suite
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = (global.Dominion = global.Dominion || {});
  const engine = {};
  Dominion.engine = engine;

  engine.VERSION = "1.37.0";
  engine.RELEASE = "0.1";

  /* ── Seeded PRNG: mulberry32 ──────────────────────────────── */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  engine.mulberry32 = mulberry32;

  /* rng(seed) → callable rand() in [0,1), plus helpers. */
  function rng(seed) {
    const rand = mulberry32(typeof seed === "number" ? seed : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    const api = function () { return rand(); };
    api.sequence = function (n) { const out = []; for (let i = 0; i < n; i++) out.push(rand()); return out; };
    api.shuffle = function (arr) { return shuffle(arr, rand); };
    return api;
  }
  engine.rng = rng;

  /* ── Fisher–Yates shuffle (returns a new array) ───────────── */
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  engine.shuffle = shuffle;

  /* ── Official card type vocabulary (validated by cards.js) ── */
  engine.CARD_TYPES = [
    "Action", "Treasure", "Victory", "Curse",
    "Reaction", "Attack", "Duration", "Reserve", "Night",
    "Fate", "Doom", "Looter", "Traveler", "Shelter", "Ruins",
    "Knight", "Prize", "Spirit", "Zombie", "Shadow", "Liaison",
    "Heirloom", "Omen", "Prophecy"
  ];

  /* ── Player state shape.
     Zones are arrays of card id strings; resources are numbers.
     The zone movement / turn machinery lands in later tasks.  ── */
  function createPlayer(id, name) {
    return {
      id: String(id),
      name: String(name || ""),
      deck: [], hand: [], discard: [], play: [],
      duration: [], reserve: [], setAside: [], exile: [],
      oldDur: [], havenAside: [], blockadeAside: [], nativeMat: [], islandMat: [],
      actions: 0, buys: 0, coins: 0, potions: 0, debt: 0,
      coffers: 0, villagers: 0, vpTokens: 0, actionsPlayed: 0,
      lighthouseImmune: false, monkeyActive: false, sailorCount: 0, sailorUsed: 0,
      piratePending: false, outpostUsed: false, wantsExtraTurn: false, isExtraTurn: false,
      drawCount: undefined, tacticianActive: false, victoryGainedThisTurn: false,
      lastTurnGains: [], corsairActive: false, corsairTrashed: false, corsairFrom: null,
      quarryActive: false, collectionActive: false, hoardActive: false, tiaraActive: false,
      warChestNamed: [], buyGainedId: null
    };
  }
  engine.createPlayer = createPlayer;

  /* ── Minimal game state shape (fleshed out by later tasks).
     supply: { cardId: remainingCount }; rand is the seeded rng. ── */
  function createGame(opts) {
    opts = opts || {};
    const seed = opts.seed == null ? (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 : opts.seed;
    return {
      version: engine.VERSION,
      seed: seed,
      rand: rng(seed),
      players: [],
      supply: {},
      trash: [],
      turn: 0,
      turnPlayer: null,
      phase: "none",
      log: [],
      over: false,
      decide: opts.decide || defaultDecide
    };
  }
  engine.createGame = createGame;

  /* ═══════════════════════════════════════════════════════════════
     ZONES & PILE MOVEMENT (Task 3)
     Player zones: deck, hand, discard, play, duration, reserve,
     setAside, exile (each an array of card id strings). Shared
     zones: trash (array) and supply (map cardId → remaining).

     A "location" (ref) identifies a zone:
       loc(playerId, zoneName)   a player zone
       zoneRef.trash             the shared trash
       zoneRef.supply            the supply (count-based)
     Deck convention: the TOP of a deck is the END of the array.

     move() enforces invariants and throws on impossible moves:
       - the source card must exist / supply pile must not be empty
       - no-op same-zone moves are rejected
       - supply cannot move into supply
       - index selections must be in range
     ═══════════════════════════════════════════════════════════════ */
  const PLAYER_ZONES = ["deck", "hand", "discard", "play", "duration", "oldDur", "havenAside", "blockadeAside", "nativeMat", "islandMat", "reserve", "setAside", "exile"];
  engine.PLAYER_ZONES = PLAYER_ZONES;

  const zoneRef = {
    trash: Object.freeze({ zone: "trash" }),
    supply: Object.freeze({ zone: "supply" })
  };
  engine.zoneRef = zoneRef;

  function refLabel(ref) {
    if (ref === zoneRef.trash) return "trash";
    if (ref === zoneRef.supply) return "supply";
    return ref.player + "." + ref.zone;
  }

  /* loc(playerId, zoneName) — a player-zone location. */
  function loc(playerId, zone) {
    if (PLAYER_ZONES.indexOf(zone) === -1) throw new Error("unknown player zone: " + zone);
    return { player: String(playerId), zone: zone };
  }
  engine.loc = loc;

  /* player(state, playerId) — resolve a player or throw. */
  function player(state, playerId) {
    const p = state.players.find((x) => x.id === String(playerId));
    if (!p) throw new Error("no player with id: " + playerId);
    return p;
  }
  engine.player = player;

  /* zoneArray(state, ref) — the backing array for a zone ref. */
  function zoneArray(state, ref) {
    if (!ref || typeof ref !== "object") throw new Error("invalid zone location");
    if (ref === zoneRef.supply || ref.zone === "supply") throw new Error("supply is count-based, not an array");
    if (ref.zone === "trash") return state.trash;
    if (ref.player != null && ref.zone != null) {
      if (PLAYER_ZONES.indexOf(ref.zone) === -1) throw new Error("unknown player zone: " + ref.zone);
      return player(state, ref.player)[ref.zone];
    }
    throw new Error("invalid zone location");
  }

  const zones = {};

  /* count(state, ref[, cardId]) — cards in a player zone/trash, or
     the remaining count of a supply pile when cardId is given. */
  function count(state, ref, cardId) {
    if (ref === zoneRef.supply || (ref && ref.zone === "supply")) {
      if (typeof cardId !== "string" || !cardId) throw new Error("supply count requires a cardId");
      return state.supply[cardId] || 0;
    }
    return zoneArray(state, ref).length;
  }
  zones.count = count;

  function supplyCount(state, cardId) { return state.supply[cardId] || 0; }
  zones.supplyCount = supplyCount;

  /* move(state, fromRef, toRef, opts) — move one card.
     opts: { cardId, index, fromTop, fromBottom, place }
       cardId       first matching card in the source zone
       index        exact position in the source zone
       fromTop      last element (top of a deck)
       fromBottom   first element (bottom of a deck)
       place        "top" (default) or "bottom" for array destinations */
  function move(state, fromRef, toRef, opts) {
    opts = opts || {};
    if (refLabel(fromRef) === refLabel(toRef)) throw new Error("no-op move between identical zones");
    const fromSupply = fromRef === zoneRef.supply;
    const toSupply = toRef === zoneRef.supply;
    if (fromSupply && toSupply) throw new Error("cannot move between supply piles");

    let cardId = opts.cardId;
    let removed;
    if (fromSupply) {
      if (typeof cardId !== "string" || !cardId) throw new Error("moving from supply requires opts.cardId");
      if (supplyCount(state, cardId) < 1) throw new Error("supply pile '" + cardId + "' is empty");
      state.supply[cardId]--;
      removed = cardId;
    } else {
      const fromArr = zoneArray(state, fromRef);
      let idx = null;
      if (opts.index != null) {
        idx = opts.index;
        if (!Number.isInteger(idx) || idx < 0 || idx >= fromArr.length) throw new Error("index out of range: " + idx);
      } else if (opts.cardId != null) {
        idx = fromArr.indexOf(opts.cardId);
        if (idx === -1) throw new Error("card '" + opts.cardId + "' not in source zone");
      } else if (opts.fromTop) {
        if (fromArr.length === 0) throw new Error("cannot move from an empty zone");
        idx = fromArr.length - 1;
      } else if (opts.fromBottom) {
        if (fromArr.length === 0) throw new Error("cannot move from an empty zone");
        idx = 0;
      } else {
        throw new Error("move requires opts.cardId, opts.index, opts.fromTop or opts.fromBottom");
      }
      removed = fromArr.splice(idx, 1)[0];
    }

    if (toSupply) {
      state.supply[removed] = (state.supply[removed] || 0) + 1;
    } else {
      const toArr = zoneArray(state, toRef);
      if (opts.place === "bottom") toArr.unshift(removed);
      else toArr.push(removed);
    }

    state.log.push({ t: "move", player: (fromRef && fromRef.player) || (toRef && toRef.player) || null, card: removed, from: refLabel(fromRef), to: refLabel(toRef) });
    return removed;
  }
  zones.move = move;

  /* reshuffle(state, playerId) — shuffle the discard pile into the
     deck (empty discard is an error). Uses the game's seeded rng. */
  function reshuffle(state, playerId) {
    const p = player(state, playerId);
    if (p.discard.length === 0) throw new Error("cannot reshuffle an empty discard");
    const cards = p.discard.splice(0);
    p.deck.push.apply(p.deck, shuffle(cards, state.rand));
    state.log.push({ t: "reshuffle", player: playerId, count: cards.length });
    return cards.length;
  }
  zones.reshuffle = reshuffle;

  /* draw(state, playerId, n) — move the top n cards of the deck to
     the hand, in order. Cards are drawn one at a time: when the
     deck empties mid-draw the discard pile is shuffled into the
     deck and drawing continues; when both are empty, drawing stops
     (the draw just ends short). All randomness goes through the
     game's seeded rng, so identical seeds draw identically. */
  function draw(state, playerId, n) {
    if (!Number.isInteger(n) || n < 0) throw new Error("draw count must be a non-negative integer");
    const p = player(state, playerId);
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (p.deck.length === 0) {
        if (p.discard.length === 0) break;
        reshuffle(state, playerId);
      }
      drawn.push(p.deck.pop());
    }
    for (const c of drawn) p.hand.push(c);
    state.log.push({ t: "draw", player: playerId, count: drawn.length });
    return drawn;
  }
  zones.draw = draw;

  /* gain(state, playerId, cardId, opts) — gain a card from the
     supply into a player zone (discard by default). */
  function gain(state, playerId, cardId, opts) {
    opts = opts || {};
    const toRef = opts.to || loc(playerId, "discard");
    if (toRef.player !== String(playerId)) throw new Error("gain destination must be the gaining player's zone");
    return move(state, zoneRef.supply, toRef, { cardId: cardId, place: opts.place });
  }
  zones.gain = gain;

  /* top / bottom — peek the end (top of deck) or start of a zone. */
  function top(state, playerId, zone) {
    const arr = zoneArray(state, loc(playerId, zone));
    return arr.length ? arr[arr.length - 1] : null;
  }
  zones.top = top;

  function bottom(state, playerId, zone) {
    const arr = zoneArray(state, loc(playerId, zone));
    return arr.length ? arr[0] : null;
  }
  zones.bottom = bottom;

  engine.zones = zones;

  /* ═══════════════════════════════════════════════════════════════
     TURN STATE MACHINE & RESOURCES (Task 5)
     Phase order: start → action → buy → night → cleanup → draw.
     The night phase is skipped unless the current player has Night
     cards (added with Nocturne). Entering cleanup discards hand +
     play area; entering draw refills a 5-card hand; the turn then
     hands over to the next player automatically.

     Resources: actions/buys reset each turn, coins/potions are
     zeroed each turn, coffers/villagers persist across turns. The
     one-action-per-turn limit is enforced by spendAction().
     Phase-entry/lifecycle hooks: engine.hooks.emit(...) with
     events "turnStart", "turnEnd", "enterPhase", "cleanup",
     "drawHand". A hook that throws never breaks the engine.
     ═══════════════════════════════════════════════════════════════ */
  const TURN_PHASES = ["start", "action", "buy", "night", "cleanup", "draw"];
  engine.TURN_PHASES = TURN_PHASES;

  const RESOURCES = ["actions", "buys", "coins", "potions", "coffers", "villagers"];
  engine.RESOURCES = RESOURCES;

  /* ── Minimal hook emitter ── */
  const listeners = {};
  function emitHook(event, data) {
    (listeners[event] || []).slice().forEach((fn) => {
      try { fn(data); } catch (e) { /* a hook error must never break the engine */ }
    });
  }
  const hooks = {
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return () => this.off(event, fn);
    },
    off(event, fn) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
    },
    emit: emitHook
  };
  engine.hooks = hooks;

  function nextPlayer(state, playerId) {
    if (state.players.length === 0) throw new Error("no players in game");
    const i = state.players.findIndex((p) => p.id === String(playerId));
    if (i === -1) throw new Error("player not in game: " + playerId);
    return state.players[(i + 1) % state.players.length].id;
  }
  engine.nextPlayer = nextPlayer;

  /* addResource — apply a delta to a resource; the result clamps at 0. */
  function addResource(state, playerId, res, delta) {
    if (RESOURCES.indexOf(res) === -1) throw new Error("unknown resource: " + res);
    if (!Number.isInteger(delta)) throw new Error("resource delta must be an integer");
    const p = player(state, playerId);
    p[res] = Math.max(0, p[res] + delta);
    state.log.push({ t: "res", player: playerId, res: res, delta: delta });
    return p[res];
  }
  engine.addResource = addResource;

  /* apply — the standard "+X Cards / +X Actions / ..." effect
     primitive used by card implementations. fx keys: cards,
     actions, buys, coins, potions, coffers, villagers. +Cards
     draws immediately via the draw rules. */
  const FX_KEYS = ["cards", "actions", "buys", "coins", "potions", "coffers", "villagers"];
  function apply(state, playerId, fx) {
    fx = fx || {};
    for (const k of Object.keys(fx)) {
      if (FX_KEYS.indexOf(k) === -1) throw new Error("unknown effect key: " + k);
      if (!Number.isInteger(fx[k]) || fx[k] < 0) throw new Error("effect '" + k + "' must be a non-negative integer");
    }
    if (fx.cards) zones.draw(state, playerId, fx.cards);
    for (const res of RESOURCES) if (fx[res]) addResource(state, playerId, res, fx[res]);
    return player(state, playerId);
  }
  engine.apply = apply;

  function spendAction(state, playerId) {
    const p = player(state, playerId);
    if (p.actions < 1) throw new Error("no actions left to play");
    p.actions--;
    state.log.push({ t: "spend", player: playerId, res: "actions" });
    return p.actions;
  }
  engine.spendAction = spendAction;

  function spendBuy(state, playerId) {
    const p = player(state, playerId);
    if (p.buys < 1) throw new Error("no buys left");
    p.buys--;
    state.log.push({ t: "spend", player: playerId, res: "buys" });
    return p.buys;
  }
  engine.spendBuy = spendBuy;

  /* Does the current player have Night cards to play? (Night phase
     is skipped otherwise. The Night phase itself arrives later.) */
  function nightCardsInHand(state, playerId) {
    const p = player(state, playerId);
    const reg = (typeof Dominion.cards !== "undefined") ? Dominion.cards : null;
    if (!reg) return false;
    const hasNight = (id) => { const d = reg.get(id); return !!d && d.types.indexOf("Night") !== -1; };
    return p.hand.some(hasNight) || p.play.some(hasNight) || p.duration.some(hasNight);
  }

  function cleanup(state, playerId) {
    const p = player(state, playerId);
    for (const id of p.play.slice()) {
      const def = durations.get(id);
      if (def && typeof def.cleanup === "function") def.cleanup(state, playerId, { cardId: id });
    }
    const kept = [];
    const rest = [];
    for (const id of p.play) {
      if (durations.keep(id, state, playerId)) kept.push(id);
      else rest.push(id);
    }
    for (const id of p.hand) rest.push(id);
    p.hand.length = 0;
    p.play.length = 0;
    for (const id of kept) p.duration.push(id);
    for (const id of rest) p.discard.push(id);
    while (p.oldDur.length) zones.move(state, loc(playerId, "oldDur"), loc(playerId, "discard"), { fromTop: true });
    const count = kept.length + rest.length;
    state.log.push({ t: "cleanup", player: playerId, count: count, kept: kept.slice() });
    hooks.emit("cleanup", { player: playerId, count: count, kept: kept.slice() });
  }

  function drawHand(state, playerId) {
    const p = player(state, playerId);
    const n = (p.drawCount == null || p.drawCount < 1) ? 5 : p.drawCount;
    p.drawCount = undefined;
    zones.draw(state, playerId, n);
    hooks.emit("drawHand", { player: playerId, count: n });
  }

  function advancePhase(state) {
    const from = state.phase;
    const pi = TURN_PHASES.indexOf(from);
    if (pi === -1) throw new Error("unknown phase: " + from);
    let i = pi + 1;
    if (TURN_PHASES[i] === "night" && !nightCardsInHand(state, state.turnPlayer)) i++;
    if (i >= TURN_PHASES.length) { endTurn(state); return; }
    if (from === "buy") endBuyPhase(state);
    state.phase = TURN_PHASES[i];
    hooks.emit("enterPhase", { player: state.turnPlayer, from: from, to: state.phase });
    if (state.phase === "cleanup") { cleanup(state, state.turnPlayer); advancePhase(state); }
    else if (state.phase === "draw") { drawHand(state, state.turnPlayer); advancePhase(state); }
  }
  engine.advancePhase = advancePhase;

  function endBuyPhase(state) {
    const p = player(state, state.turnPlayer);
    if (!p.victoryGainedThisTurn) {
      let idx = p.play.indexOf("treasury");
      while (idx !== -1) {
        zones.move(state, loc(state.turnPlayer, "play"), loc(state.turnPlayer, "deck"), { cardId: "treasury" });
        state.log.push({ t: "treasuryTopdeck", player: state.turnPlayer });
        idx = p.play.indexOf("treasury");
      }
    }
  }
  engine.endBuyPhase = endBuyPhase;

  function endTurn(state) {
    hooks.emit("turnEnd", { player: state.turnPlayer });
    if (isGameOver(state)) { endGame(state); return; }
    const p = player(state, state.turnPlayer);
    const extra = p.wantsExtraTurn === true;
    p.wantsExtraTurn = false;
    beginTurn(state, extra ? p.id : nextPlayer(state, p.id));
  }
  engine.endTurn = endTurn;

  function beginTurn(state, playerId) {
    const prev = state.turnPlayer;
    state.lastTurnPlayer = prev;
    state.turn++;
    state.turnPlayer = String(playerId);
    const p = player(state, playerId);
    for (const o of state.players) o.isExtraTurn = false;
    p.actions = 1; p.buys = 1; p.coins = 0; p.potions = 0;
    p.merchantSilver = false; p.actionsPlayed = 0;
    p.isExtraTurn = prev === p.id;
    p.lighthouseImmune = false;
    p.monkeyActive = false;
    p.sailorCount = 0; p.sailorUsed = 0;
    p.piratePending = false;
    p.outpostUsed = false;
    p.tacticianActive = false;
    p.victoryGainedThisTurn = false;
    p.lastTurnGains = [];
    p.quarryActive = false;
    p.collectionActive = false;
    p.hoardActive = false;
    p.tiaraActive = false;
    p.warChestNamed = [];
    for (const other of state.players) {
      if (other.id === p.id) continue;
      if (other.corsairFrom === p.id) {
        other.corsairActive = false;
        other.corsairTrashed = false;
        other.corsairFrom = null;
      }
    }
    state.phase = "start";
    state.log.push({ t: "turnStart", player: state.turnPlayer, extra: p.isExtraTurn });
    hooks.emit("turnStart", { player: state.turnPlayer, turn: state.turn, extra: p.isExtraTurn });
    hooks.emit("enterPhase", { player: state.turnPlayer, from: "none", to: "start" });
    fireTrigger("turnStart", state, state.turnPlayer, {});
    durations.resolve(state, playerId);
    advancePhase(state); // start → action
  }
  engine.beginTurn = beginTurn;

  /* ═══════════════════════════════════════════════════════════════
     TREASURE PLAY & COIN TOTALS (Task 6)
     Playing Treasures moves them from hand to the play area and
     adds their catalog treasure value to the player's coins.
       treasures.play(state, playerId, { cardIds: [...] })  — specific
       treasures.playAll(state, playerId)                    — auto-play
     Auto-play is the UI hook: call it when the buy phase begins.
     Emits "treasuresPlayed" { player, cards, coins }.
     ═══════════════════════════════════════════════════════════════ */
  function cardDef(id) {
    const reg = (typeof Dominion.cards !== "undefined" && typeof Dominion.cards.get === "function") ? Dominion.cards : null;
    return reg ? reg.get(id) : null;
  }

  function isType(id, type) {
    const d = cardDef(id);
    return !!d && d.types.indexOf(type) !== -1;
  }

  /* treasureValue(id) — coins a Treasure produces, or null when the
     card is not a Treasure (or has no definition). */
  function treasureValue(id) {
    const d = cardDef(id);
    return (d && d.types.indexOf("Treasure") !== -1) ? (d.treasure || 0) : null;
  }

  function playTreasures(state, playerId, opts) {
    opts = opts || {};
    const p = player(state, playerId);
    let want;
    if (Array.isArray(opts.cardIds)) want = opts.cardIds.slice();
    else if (opts.all) want = p.hand.filter((id) => isType(id, "Treasure") || (state.charlatan === true && id === "curse"));
    else throw new Error("playTreasures requires opts.all or opts.cardIds");

    const played = [];
    let coins = 0;
    for (const id of want) {
      const idx = p.hand.indexOf(id);
      if (idx === -1) throw new Error("card '" + id + "' is not in hand");
      const val = (id === "curse" && state.charlatan === true) ? 1 : treasureValue(id);
      if (val === null) throw new Error("card '" + id + "' is not a Treasure (or has no definition)");
      if (p.corsairActive && !p.corsairTrashed && (id === "silver" || id === "gold")) {
        zones.move(state, loc(playerId, "hand"), zoneRef.trash, { index: idx });
        p.corsairTrashed = true;
        state.log.push({ t: "corsairTrash", player: playerId, card: id });
        continue;
      }
      let bonus = 0;
      if (id === "silver" && p.merchantSilver) { bonus = 1; p.merchantSilver = false; }
      p.hand.splice(idx, 1);
      p.play.push(id);
      played.push(id);
      if (id === "potion") { addResource(state, playerId, "potions", 1); continue; }
      if (id === "philosophers_stone") {
        const pstone = player(state, playerId);
        coins += Math.floor((pstone.deck.length + pstone.discard.length) / 5);
        continue;
      }
      coins += val + bonus;
    }
    addResource(state, playerId, "coins", coins);
    for (const id of played) effects.resolve(state, playerId, id, { cardId: id });
    if (played.length) {
      state.log.push({ t: "playTreasure", player: playerId, cards: played, coins: coins });
      hooks.emit("treasuresPlayed", { player: playerId, cards: played.slice(), coins: coins });
    }
    return { cards: played, coins: coins };
  }

  function autoPlayTreasures(state, playerId) {
    return playTreasures(state, playerId, { all: true });
  }

  engine.treasures = {
    play: playTreasures,
    playAll: autoPlayTreasures,
    value: treasureValue
  };

  /* ═══════════════════════════════════════════════════════════════
     ACTION PLAY & EFFECT RESOLUTION (Task 7)
     Playing an Action from hand:
       actions.play(state, playerId, { index } | { cardId })
       1. legality — the card must be in hand and typed Action
       2. the one-action cost is spent (spendAction, throws when 0)
       3. the card moves hand → play area
       4. its effect resolves through the effects registry
     The effects registry maps card ids to effect functions
     (state, playerId, ctx) => …; ctx is { cardId, index } of the
     played card. An Action with no registered effect plays
     harmlessly (catalog pins precede per-card implementations).
     Emits "actionPlayed" { player, cardId }. Played cards leave
     the play area at cleanup (see Task 5) into the discard.
     ═══════════════════════════════════════════════════════════════ */
  const effectFns = new Map();

  const effects = {
    register(cardId, fn) {
      if (typeof fn !== "function") throw new Error("effect for '" + cardId + "' must be a function");
      effectFns.set(String(cardId), fn);
    },
    resolve(state, playerId, cardId, ctx) {
      const fn = effectFns.get(String(cardId));
      return fn ? fn(state, playerId, ctx || {}) : null;
    },
    has(cardId) { return effectFns.has(String(cardId)); }
  };
  engine.effects = effects;

  /* ── Durations registry ──
     A Duration card is played normally; on Cleanup it is kept in
     play (keptFn controls whether it stays — e.g. Outpost comes
     back). At the start of the owner's next turn its `resolve` fn
     runs (the "start of your next turn" effect) and the card moves
     to the oldDur zone, from which the following Cleanup discards
     it. `cleanup` fns run at the start of Cleanup while the card
     is still in play. */
  const durationDefs = new Map();
  const durations = {
    register(cardId, def) {
      durationDefs.set(String(cardId), def || {});
    },
    get(cardId) { return durationDefs.get(String(cardId)); },
    has(cardId) { return durationDefs.has(String(cardId)); },
    keep(cardId, state, playerId) {
      const def = durationDefs.get(String(cardId));
      if (!def) return false;
      if (typeof def.keepFn === "function") return !!def.keepFn(state, playerId);
      return true;
    },
    resolve(state, playerId) {
      const p = player(state, playerId);
      const toResolve = p.duration.slice();
      for (const id of toResolve) {
        const idx = p.duration.indexOf(id);
        if (idx === -1) continue;
        p.duration.splice(idx, 1);
        p.play.push(id);
        const def = durationDefs.get(id);
        if (def && typeof def.resolve === "function") def.resolve(state, playerId, { cardId: id });
      }
      for (const id of p.play.slice()) {
        if (!durations.has(id)) continue;
        const idx = p.play.indexOf(id);
        if (idx === -1) continue;
        p.play.splice(idx, 1);
        p.oldDur.push(id);
      }
    }
  };
  engine.durations = durations;

  /* inPlayCount — copies of a card among play + duration + oldDur
     (used by Sea Chart and Oracle-style "in play" checks). */
  function inPlayCount(state, playerId, cardId) {
    const p = player(state, playerId);
    return p.play.filter((c) => c === cardId).length +
      p.duration.filter((c) => c === cardId).length +
      p.oldDur.filter((c) => c === cardId).length;
  }
  engine.inPlayCount = inPlayCount;

  function playAction(state, playerId, opts) {
    opts = opts || {};
    const p = player(state, playerId);
    let idx;
    if (opts.index != null) {
      idx = opts.index;
      if (!Number.isInteger(idx) || idx < 0 || idx >= p.hand.length) throw new Error("action index out of range: " + idx);
    } else if (opts.cardId != null) {
      idx = p.hand.indexOf(opts.cardId);
      if (idx === -1) throw new Error("card '" + opts.cardId + "' is not in hand");
    } else {
      throw new Error("actions.play requires opts.index or opts.cardId");
    }
    const id = p.hand[idx];
    if (!isType(id, "Action")) throw new Error("card '" + id + "' is not an Action");
    if (opts.charge !== false) spendAction(state, playerId);
    zones.move(state, loc(playerId, "hand"), loc(playerId, "play"), { index: idx });
    player(state, playerId).actionsPlayed++;
    const resolved = effects.resolve(state, playerId, id, { cardId: id, index: idx });
    state.log.push({ t: "playAction", player: playerId, card: id });
    hooks.emit("actionPlayed", { player: playerId, cardId: id });
    fireTrigger("play", state, playerId, { cardId: id, index: idx });
    return { cardId: id, from: idx, effect: resolved !== null };
  }

  engine.actions = { play: playAction };

  /* ── Base-set kingdom Actions (data in src/data/base-kingdom.json) ── */
  effects.register("village", (state, pid) => apply(state, pid, { cards: 1, actions: 2 }));
  effects.register("smithy", (state, pid) => apply(state, pid, { cards: 3 }));

  /* ═══════════════════════════════════════════════════════════════
     THE BUY STEP (Task 8)
       engine.buy(state, playerId, cardId)
       1. the card must exist, be in the supply, and its pile not
          be empty (empty piles are un-buyable)
       2. affordability — coins cover cost.coins, potions cover
          cost.potion (debt costs are reserved for a later task)
       3. the buy-count limit is spent (spendBuy, throws when 0)
       4. coins/potions are paid, the card is gained to discard
     The whole transaction is atomic: a failed check spends nothing.
     Emits "bought" { player, cardId, cost }. canBuy() is the
     non-throwing predicate the UI can use to grey out purchases.
     ═══════════════════════════════════════════════════════════════ */
  /* ── dynamic card costs ──
     Peddler: during a Buy phase, costs $2 less per Action card the
     buying player has in play. Quarry: Actions cost $1 less this
     turn while it is in play. Only the buy step consults dynamic
     costs; gain/replace comparisons use the printed cost. */
  function dynamicCost(state, playerId, cardId) {
    let coins = costCoins(cardId);
    const p = player(state, playerId);
    if (cardId === "peddler") {
      const actionsInPlay = p.play.filter((id) => isType(id, "Action")).length;
      coins = Math.max(0, coins - 2 * actionsInPlay);
    } else if (p.quarryActive && isType(cardId, "Action")) {
      coins = Math.max(0, coins - 1);
    }
    return coins;
  }
  engine.dynamicCost = dynamicCost;

  function buyCheck(state, playerId, cardId) {
    const d = cardDef(cardId);
    if (!d) return { ok: false, reason: "unknown card '" + cardId + "'" };
    if (!(cardId in state.supply)) return { ok: false, reason: "'" + cardId + "' is not in the supply" };
    if (state.supply[cardId] < 1) return { ok: false, reason: "the " + d.name + " pile is empty" };
    const p = player(state, playerId);
    if (cardId === "grand_market" && p.play.indexOf("copper") !== -1) return { ok: false, reason: "Grand Market can't be bought with Copper in play" };
    const coins = dynamicCost(state, playerId, cardId);
    if (p.coins < coins) return { ok: false, reason: "not enough coins (" + p.coins + " < " + coins + ")" };
    if (p.potions < d.cost.potion) return { ok: false, reason: "not enough potions (" + p.potions + " < " + d.cost.potion + ")" };
    if (p.buys < 1) return { ok: false, reason: "no buys left" };
    return { ok: true };
  }

  function buy(state, playerId, cardId) {
    const check = buyCheck(state, playerId, cardId);
    if (!check.ok) throw new Error(check.reason);
    const d = cardDef(cardId);
    const coins = dynamicCost(state, playerId, cardId);
    spendBuy(state, playerId);
    addResource(state, playerId, "coins", -coins);
    addResource(state, playerId, "potions", -d.cost.potion);
    player(state, playerId).buyGainedId = cardId;
    primitives.gain(state, playerId, cardId);
    player(state, playerId).buyGainedId = null;
    const cost = { coins: coins, potion: d.cost.potion };
    if (d.types && d.types.indexOf("Victory") !== -1) player(state, playerId).victoryGainedThisTurn = true;
    state.log.push({ t: "buy", player: playerId, card: cardId, coins: cost.coins, potion: cost.potion });
    hooks.emit("bought", { player: playerId, cardId: cardId, cost: cost });
    fireTrigger("buy", state, playerId, { cardId: cardId, cost: cost });
    return { cardId: cardId, cost: cost };
  }

  engine.buy = buy;
  engine.canBuy = function (state, playerId, cardId) {
    return buyCheck(state, playerId, cardId).ok;
  };

  /* payDebt(state, playerId, max) — pay off up to `max` debt during
     the Buy phase (official rule: you may pay off any amount of
     debt when you have coins). Returns the amount paid. */
  function payDebt(state, playerId, max) {
    const p = player(state, playerId);
    const paid = Math.min(Math.max(0, p.debt), Math.max(0, p.coins));
    const capped = max == null ? paid : Math.min(paid, Math.max(0, max));
    if (capped <= 0) return 0;
    p.coins -= capped;
    p.debt -= capped;
    state.log.push({ t: "res", player: playerId, res: "debt", delta: -capped });
    return capped;
  }
  engine.payDebt = payDebt;

  /* ═══════════════════════════════════════════════════════════════
     THE ATTACK FRAMEWORK (Task 9)
     An Attack card affects "each other player". Before the attack
     resolves against a given player, that player gets a reaction
     window: they may reveal Reaction cards (e.g. Moat) from their
     hand; if a revealed reaction blocks the attack, they are
     unaffected. Revealed cards return to hand (official rule).

     Decisions — which reactions to reveal, which cards to discard
     under an attack — come from state.decide(state, prompt), a
     pluggable callback set at createGame (default: a deterministic
     bot). The UI will replace it later; a throwing decide never
     breaks the engine (treated as "no choice").

     Card effects run the framework themselves:
       attack.dispatch(state, attackerId, attackCardId, perTargetFn)
     perTargetFn(state, targetId) runs only for players who are not
     unaffected. Attack cards in base-kingdom.json:
       Witch   +2 Cards; each other player gains a Curse.
       Militia +2 Coins; each other player discards down to 3.
       Moat    +2 Cards; may reveal vs an Attack to be unaffected.
     ═══════════════════════════════════════════════════════════════ */
  function safeDecide(state, prompt) {
    try {
      const out = state.decide(state, prompt);
      const res = out === undefined ? null : out;
      state.log.push({ t: "decide", player: prompt ? prompt.player : null, kind: prompt ? prompt.type : null, choice: res });
      return res;
    } catch (e) {
      state.log.push({ t: "decide", player: prompt ? prompt.player : null, kind: prompt ? prompt.type : null, choice: null, error: true });
      return null;
    }
  }

  /* defaultDecide — deterministic bot so the engine works with no
     UI attached. Reveals every available reaction; under a
     "discard down to N" attack discards the highest-cost cards. */
  function costCoins(id) {
    const d = cardDef(id);
    return d && d.cost ? d.cost.coins : 0;
  }

  function costPotion(id) {
    const d = cardDef(id);
    return d && d.cost ? d.cost.potion : 0;
  }

  function defaultDecide(state, prompt) {
    if (prompt.type === "react") return prompt.options.slice();
    if (prompt.type === "discardDown") {
      const order = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => b.cost - a.cost)
        .map((o) => o.i);
      return order.slice(0, prompt.count);
    }
    if (prompt.type === "discardAny") {
      return prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .filter((o) => o.cost === 0)
        .map((o) => o.i);
    }
    if (prompt.type === "gainToHand" || prompt.type === "trashRevealed" || prompt.type === "gainTreasure" || prompt.type === "gainCard") {
      const best = prompt.options.slice().sort((a, b) => costCoins(b) - costCoins(a))[0];
      return best || null;
    }
    if (prompt.type === "trashTreasure") {
      const idx = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .filter((o) => isType(o.id, "Treasure"))
        .sort((a, b) => b.cost - a.cost)
        .map((o) => o.i);
      return idx.length ? idx[0] : null;
    }
    if (prompt.type === "trashCopper") {
      return prompt.options && prompt.options.length ? prompt.options[0] : null;
    }
    if (prompt.type === "trashAny") {
      const idx = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      return idx.length ? idx[0] : null;
    }
    if (prompt.type === "playActionTwice") {
      const best = prompt.options.slice().sort((a, b) => costCoins(b) - costCoins(a))[0];
      return best || null;
    }
    if (prompt.type === "sentryLook") {
      const trash = [];
      const discard = [];
      for (const c of prompt.cards) {
        if (c === "curse") trash.push(c);
        else if (c === "copper" || c === "estate") discard.push(c);
      }
      return { trash: trash, discard: discard };
    }
    if (prompt.type === "discardPerEmpty") {
      const order = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      return order.slice(0, prompt.count);
    }
    if (prompt.type === "topdeckVictory") {
      return prompt.options[0] || null;
    }
    if (prompt.type === "trashUpTo") {
      return prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .filter((o) => o.cost === 0)
        .slice(0, prompt.max)
        .map((o) => o.i);
    }
    if (prompt.type === "baronDiscard") {
      return prompt.canDiscard === true;
    }
    if (prompt.type === "courtierChoice") {
      const order = ["gold", "coins", "action", "buy"];
      return order.find((o) => prompt.options.indexOf(o) !== -1) || null;
    }
    if (prompt.type === "revealCard" || prompt.type === "courtyardTopdeck") {
      const idx = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => (prompt.type === "courtyardTopdeck" ? a.cost - b.cost : b.cost - a.cost))
        .map((o) => o.i);
      return idx.length ? idx[0] : null;
    }
    if (prompt.type === "diplomatDiscard") {
      const order = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      return order.slice(0, prompt.count != null ? prompt.count : 3);
    }
    if (prompt.type === "farmlandTrash") {
      const worst = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)[0];
      return !!(worst && worst.cost <= 2);
    }
    if (prompt.type === "lurkerMode") {
      return prompt.options.indexOf("trashSupply") !== -1 ? "trashSupply" : "gainTrash";
    }
    if (prompt.type === "lurkerTrashSupply" || prompt.type === "lurkerGainTrash") {
      const best = prompt.options.slice().sort((a, b) => costCoins(b) - costCoins(a))[0];
      return best || null;
    }
    if (prompt.type === "masqueradePass") {
      const order = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      return order.length ? order[0] : null;
    }
    if (prompt.type === "masqueradeTrash") {
      return prompt.hand.some((id) => costCoins(id) === 0);
    }
    if (prompt.type === "millDiscard") {
      return prompt.hand.filter((id) => costCoins(id) === 0).length >= 2;
    }
    if (prompt.type === "discardExactly") {
      const order = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      return order.slice(0, prompt.count != null ? prompt.count : 2);
    }
    if (prompt.type === "miningVillageTrash") return true;
    if (prompt.type === "minionMode") return "coins";
    if (prompt.type === "noblesChoice") return "cards";
    if (prompt.type === "pawnChoices") return ["card", "action"];
    if (prompt.type === "patrolOrder") return prompt.cards.slice();
    if (prompt.type === "secretPassageCard") {
      const order = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      return order.length ? order[0] : null;
    }
    if (prompt.type === "secretPassageDepth") return 0;
    if (prompt.type === "stewardMode") return "cards";
    if (prompt.type === "trashTwo") {
      const order = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      return order.slice(0, prompt.count != null ? prompt.count : 2);
    }
    if (prompt.type === "swindlerGain") {
      return prompt.options.indexOf("curse") !== -1 ? "curse" : (prompt.options[0] || null);
    }
    if (prompt.type === "wishName") {
      const best = prompt.options.slice().sort((a, b) => costCoins(b) - costCoins(a))[0];
      return best || null;
    }
    if (prompt.type === "nativeVillageMode") return "deck";
    if (prompt.type === "havenSetAside" || prompt.type === "islandSetAside") {
      const order = prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      return order.length ? order[0] : null;
    }
    if (prompt.type === "sailorPlay" || prompt.type === "piratePlay") return true;
    if (prompt.type === "alchemistTopdeck" || prompt.type === "treasuryTopdeck") return true;
    if (prompt.type === "herbalistReturn") {
      const order = prompt.options.slice().sort((a, b) => costCoins(b) - costCoins(a))[0];
      return order || null;
    }
    if (prompt.type === "scryingTop") return "discard";
    if (prompt.type === "golemOrder" || prompt.type === "apothecaryOrder") return prompt.cards ? prompt.cards.slice() : [];
    if (prompt.type === "lookoutDispose") {
      const order = prompt.cards
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .sort((a, b) => a.cost - b.cost)
        .map((o) => o.i);
      if (order.length < 3) return { trash: null, discard: null };
      return { trash: order[0], discard: order[1] };
    }
    if (prompt.type === "torturerChoice") {
      return prompt.hand && prompt.hand.length >= 2 ? "discard" : "curse";
    }
    if (prompt.type === "anvilDiscard") {
      return prompt.options && prompt.options.length ? prompt.options[0] : null;
    }
    if (prompt.type === "crystalBallUse") {
      if (prompt.card === "curse") return "trash";
      if (isType(prompt.card, "Treasure")) return "play";
      if (isType(prompt.card, "Action")) return "play";
      return "discard";
    }
    if (prompt.type === "investmentMode") return "coins";
    if (prompt.type === "warChestName") {
      const best = prompt.options.slice().sort((a, b) => costCoins(b) - costCoins(a))[0];
      return best || null;
    }
    if (prompt.type === "vaultDiscard") {
      return prompt.hand
        .map((id, i) => ({ id, i, cost: costCoins(id) }))
        .filter((o) => o.cost === 0)
        .map((o) => o.i);
    }
    if (prompt.type === "vaultOpp") return false;
    if (prompt.type === "tiaraTopdeck" || prompt.type === "clerkPlay") return true;
    if (prompt.type === "watchtowerUse") {
      const cost = costCoins(prompt.card);
      if (prompt.card === "curse" || cost === 0) return "trash";
      if (cost >= 5) return "topdeck";
      return null;
    }
    if (prompt.type === "tiaraDouble" || prompt.type === "mintCopy") {
      return prompt.options && prompt.options.length ? prompt.options[0] : null;
    }
    if (prompt.type === "playActionThrice") {
      const best = prompt.options.slice().sort((a, b) => costCoins(b) - costCoins(a))[0];
      return best == null ? null : Number(best);
    }
    return null;
  }
  engine.defaultDecide = defaultDecide;

  const reactionFns = new Map();
  const reactions = {
    register(cardId, fn) {
      if (typeof fn !== "function") throw new Error("reaction for '" + cardId + "' must be a function");
      reactionFns.set(String(cardId), fn);
    },
    resolve(state, playerId, cardId, ctx) {
      const fn = reactionFns.get(String(cardId));
      return fn ? fn(state, playerId, ctx || {}) : null;
    }
  };
  engine.reactions = reactions;

  /* Reaction cards currently in hand that can react to an attack. */
  function reactableInHand(state, playerId) {
    const p = player(state, playerId);
    return p.hand.filter((id) => isType(id, "Reaction") && reactionFns.has(id));
  }

  /* The reaction window for one defender. Returns
     { player, revealed, unaffected }. */
  function attackOutcome(state, targetId, attackerId, attackCardId) {
    const tplayer = player(state, targetId);
    if (tplayer.lighthouseImmune === true) return { player: targetId, revealed: [], unaffected: true, reason: "lighthouse" };
    const reactable = reactableInHand(state, targetId);
    const revealed = [];
    let blocked = false;
    if (reactable.length) {
      const asked = safeDecide(state, {
        type: "react", player: targetId, attack: attackCardId, options: reactable.slice()
      });
      if (Array.isArray(asked)) {
        for (const id of asked) {
          if (reactable.indexOf(id) === -1) continue;
          const p = player(state, targetId);
          const idx = p.hand.indexOf(id);
          if (idx === -1) continue;
          const c = p.hand.splice(idx, 1)[0];
          state.log.push({ t: "reveal", player: targetId, card: c });
          fireTrigger("reveal", state, targetId, { cardId: c });
          const r = reactions.resolve(state, targetId, c, { attacker: attackerId, attack: attackCardId });
          if (r && r.block) blocked = true;
          p.hand.push(c);
          revealed.push(c);
        }
      }
    }
    return { player: targetId, revealed: revealed, unaffected: blocked };
  }

  /* Iterate each other player; the attack applies to those who are
     not unaffected by a revealed reaction. Returns one outcome per
     other player. */
  function dispatchAttack(state, attackerId, attackCardId, perTargetFn) {
    const attacker = String(attackerId);
    const results = [];
    for (const other of state.players) {
      if (other.id === attacker) continue;
      const outcome = attackOutcome(state, other.id, attacker, attackCardId);
      results.push(outcome);
      if (!outcome.unaffected && typeof perTargetFn === "function") perTargetFn(state, other.id, outcome);
    }
    return results;
  }

  const attack = { dispatch: dispatchAttack };
  engine.attack = attack;

  /* ── Base-set kingdom cards (data in src/data/base-kingdom.json) ── */
  effects.register("village", (state, pid) => apply(state, pid, { cards: 1, actions: 2 }));
  effects.register("smithy", (state, pid) => apply(state, pid, { cards: 3 }));
  effects.register("witch", (state, pid) => {
    apply(state, pid, { cards: 2 });
    attack.dispatch(state, pid, "witch", (s, t) => {
      if (zones.supplyCount(s, "curse") > 0) primitives.gain(s, t, "curse");
    });
  });
  effects.register("militia", (state, pid) => {
    apply(state, pid, { coins: 2 });
    attack.dispatch(state, pid, "militia", (s, t) => {
      const p = player(s, t);
      const count = Math.max(0, p.hand.length - 3);
      if (count === 0) return;
      const asked = safeDecide(s, {
        type: "discardDown", player: t, attack: "militia", count: count, hand: p.hand.slice()
      });
      const chosen = [];
      if (Array.isArray(asked)) {
        for (const i of asked) {
          if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
        }
      }
      primitives.discard(s, t, chosen);
    });
  });
  effects.register("moat", (state, pid) => apply(state, pid, { cards: 2 }));
  reactions.register("moat", () => ({ block: true }));

  /* ── More base-set kingdom Actions (see base-kingdom.json) ── */
  effects.register("cellar", (state, pid) => {
    apply(state, pid, { actions: 1 });
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "discardAny", player: pid, hand: p.hand.slice() });
    const idx = [];
    if (Array.isArray(asked)) {
      for (const i of asked) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && idx.indexOf(i) === -1) idx.push(i);
      }
    }
    primitives.discard(state, pid, idx);
    zones.draw(state, pid, idx.length);
  });
  effects.register("festival", (state, pid) => apply(state, pid, { actions: 2, buys: 1, coins: 2 }));
  effects.register("laboratory", (state, pid) => apply(state, pid, { cards: 2, actions: 1 }));
  effects.register("library", (state, pid) => {
    const p = player(state, pid);
    while (p.hand.length < 7) {
      if (p.deck.length === 0 && p.discard.length === 0) break;
      zones.draw(state, pid, 1);
      const drawn = p.hand[p.hand.length - 1];
      if (isType(drawn, "Action")) {
        const yes = safeDecide(state, { type: "setAsideAction", player: pid, card: drawn });
        if (yes === true) zones.move(state, loc(pid, "hand"), loc(pid, "setAside"), { cardId: drawn });
      }
    }
    while (p.setAside.length) zones.move(state, loc(pid, "setAside"), loc(pid, "discard"), { fromTop: true });
  });
  effects.register("merchant", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    player(state, pid).merchantSilver = true;
  });
  effects.register("mine", (state, pid) => {
    const p = player(state, pid);
    const treasureIdx = p.hand.map((id, i) => ({ id, i })).filter((o) => isType(o.id, "Treasure")).map((o) => o.i);
    const asked = safeDecide(state, { type: "trashTreasure", player: pid, hand: p.hand.slice(), options: treasureIdx.slice() });
    let chosen = null;
    if (Number.isInteger(asked) && treasureIdx.indexOf(asked) !== -1) chosen = asked;
    if (chosen === null) return;
    const trashed = p.hand[chosen];
    primitives.trash(state, pid, { index: chosen });
    const maxCost = costCoins(trashed) + 3;
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && isType(id, "Treasure") && costCoins(id) <= maxCost && costPotion(id) === 0);
    const choice = primitives.choose(state, pid, { type: "gainTreasure", maxCost: maxCost }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice, { to: loc(pid, "hand") });
  });
  effects.register("moneylender", (state, pid) => {
    apply(state, pid, { actions: 1 });
    const p = player(state, pid);
    const copperIdx = [];
    for (let i = 0; i < p.hand.length; i++) if (p.hand[i] === "copper") copperIdx.push(i);
    if (copperIdx.length === 0) return;
    const asked = safeDecide(state, { type: "trashCopper", player: pid, hand: p.hand.slice(), options: copperIdx.slice() });
    let chosen = null;
    if (Number.isInteger(asked) && copperIdx.indexOf(asked) !== -1) chosen = asked;
    if (chosen === null) return;
    primitives.trash(state, pid, { index: chosen });
    addResource(state, pid, "coins", 3);
  });
  effects.register("poacher", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1, coins: 1 });
    const p = player(state, pid);
    const empty = Object.keys(state.supply).filter((id) => state.supply[id] <= 0).length;
    if (empty === 0 || p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "discardPerEmpty", player: pid, count: empty, hand: p.hand.slice() });
    const idx = [];
    if (Array.isArray(asked)) {
      for (const i of asked) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && idx.indexOf(i) === -1) idx.push(i);
      }
    }
    primitives.discard(state, pid, idx.slice(0, empty));
  });
  effects.register("remodel", (state, pid) => {
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    let chosen = null;
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) chosen = asked;
    if (chosen === null) return;
    const trashed = p.hand[chosen];
    primitives.trash(state, pid, { index: chosen });
    const maxCost = costCoins(trashed) + 2;
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= maxCost && costPotion(id) === 0);
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
  });
  effects.register("sentry", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    const p = player(state, pid);
    const looked = [];
    for (let i = 0; i < 2 && p.deck.length > 0; i++) looked.push(p.deck.pop());
    if (looked.length === 0) return;
    p.setAside.push.apply(p.setAside, looked);
    const decided = safeDecide(state, { type: "sentryLook", player: pid, cards: looked.slice() });
    let trash = [], discard = [];
    if (decided && typeof decided === "object" && Array.isArray(decided.trash) && Array.isArray(decided.discard)) {
      trash = decided.trash;
      discard = decided.discard;
    }
    const trashSet = [], discSet = [];
    for (const c of looked) {
      if (trash.indexOf(c) !== -1) trashSet.push(c);
      else if (discard.indexOf(c) !== -1) discSet.push(c);
    }
    for (const c of trashSet) zones.move(state, loc(pid, "setAside"), zoneRef.trash, { cardId: c });
    for (const c of discSet) zones.move(state, loc(pid, "setAside"), loc(pid, "discard"), { cardId: c });
    const keep = looked.filter((c) => trashSet.indexOf(c) === -1 && discSet.indexOf(c) === -1);
    for (let i = keep.length - 1; i >= 0; i--) zones.move(state, loc(pid, "setAside"), loc(pid, "deck"), { cardId: keep[i] });
  });
  effects.register("throne_room", (state, pid) => {
    const p = player(state, pid);
    const actions = p.hand.filter((id) => isType(id, "Action"));
    const choice = safeDecide(state, { type: "playActionTwice", player: pid, hand: p.hand.slice(), options: actions.slice() });
    if (actions.indexOf(choice) === -1) return;
    const idx = p.hand.indexOf(choice);
    zones.move(state, loc(pid, "hand"), loc(pid, "play"), { index: idx });
    for (let i = 0; i < 2; i++) {
      player(state, pid).actionsPlayed++;
      effects.resolve(state, pid, choice, { cardId: choice, index: idx });
      state.log.push({ t: "playAction", player: pid, card: choice });
      hooks.emit("actionPlayed", { player: pid, cardId: choice });
      fireTrigger("play", state, pid, { cardId: choice, index: idx });
    }
  });
  effects.register("vassal", (state, pid) => {
    apply(state, pid, { coins: 1 });
    const p = player(state, pid);
    if (p.deck.length === 0) {
      if (p.discard.length === 0) return;
      zones.reshuffle(state, pid);
    }
    const top = p.deck.pop();
    p.setAside.push(top);
    state.log.push({ t: "reveal", player: pid, card: top });
    fireTrigger("reveal", state, pid, { cardId: top });
    if (isType(top, "Action")) {
      zones.move(state, loc(pid, "setAside"), loc(pid, "hand"), { cardId: top });
      primitives.playAnother(state, pid, { cardId: top });
    } else {
      zones.move(state, loc(pid, "setAside"), loc(pid, "discard"), { cardId: top });
    }
  });
  effects.register("market", (state, pid) => apply(state, pid, { cards: 1, actions: 1, buys: 1, coins: 1 }));
  effects.register("artisan", (state, pid) => {
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= 5 && costPotion(id) === 0);
    const choice = primitives.choose(state, pid, { type: "gainToHand", maxCost: 5 }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice, { to: loc(pid, "hand") });
  });
  effects.register("bandit", (state, pid) => {
    if (zones.supplyCount(state, "gold") > 0) primitives.gain(state, pid, "gold");
    attack.dispatch(state, pid, "bandit", (s, t) => {
      const p = player(s, t);
      const revealed = [];
      for (let i = 0; i < 2; i++) {
        if (p.deck.length === 0) {
          if (p.discard.length === 0) break;
          zones.reshuffle(s, t);
        }
        revealed.push(p.deck.pop());
      }
      if (revealed.length) p.setAside.push.apply(p.setAside, revealed);
      for (const c of revealed) {
        s.log.push({ t: "reveal", player: t, card: c });
        fireTrigger("reveal", s, t, { cardId: c });
      }
      const trashable = revealed.filter((id) => isType(id, "Treasure") && id !== "copper");
      let toTrash = null;
      if (trashable.length) {
        const pick = primitives.choose(s, t, { type: "trashRevealed", attack: "bandit", revealed: revealed.slice() }, trashable);
        if (trashable.indexOf(pick) !== -1) toTrash = pick;
      }
      if (toTrash) primitives.trash(s, t, { cardId: toTrash, from: loc(t, "setAside") });
      for (const c of revealed) {
        if (c === toTrash) continue;
        zones.move(s, loc(t, "setAside"), loc(t, "discard"), { cardId: c });
      }
    });
  });
  effects.register("bureaucrat", (state, pid) => {
    if (zones.supplyCount(state, "silver") > 0) primitives.gain(state, pid, "silver", { to: loc(pid, "deck") });
    attack.dispatch(state, pid, "bureaucrat", (s, t) => {
      const p = player(s, t);
      const victories = p.hand.filter((id) => isType(id, "Victory"));
      if (victories.length) {
        const pick = primitives.choose(s, t, { type: "topdeckVictory", attack: "bureaucrat" }, victories);
        if (victories.indexOf(pick) !== -1) {
          s.log.push({ t: "reveal", player: t, card: pick });
          fireTrigger("reveal", s, t, { cardId: pick });
          zones.move(s, loc(t, "hand"), loc(t, "deck"), { cardId: pick });
        }
      } else {
        for (const c of p.hand.slice()) {
          s.log.push({ t: "reveal", player: t, card: c });
          fireTrigger("reveal", s, t, { cardId: c });
        }
      }
    });
  });
  effects.register("chapel", (state, pid) => {
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashUpTo", player: pid, max: 4, hand: p.hand.slice() });
    const idx = [];
    if (Array.isArray(asked)) {
      for (const i of asked) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && idx.indexOf(i) === -1) idx.push(i);
      }
    }
    const chosen = idx.slice(0, 4).sort((a, b) => b - a);
    for (const i of chosen) primitives.trash(state, pid, { index: i });
  });
  effects.register("council_room", (state, pid) => {
    apply(state, pid, { cards: 4, buys: 1 });
    for (const other of state.players) {
      if (other.id !== String(pid)) zones.draw(state, other.id, 1);
    }
  });
  effects.register("harbinger", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    const p = player(state, pid);
    if (p.discard.length === 0) return;
    const top = p.discard[p.discard.length - 1];
    const yes = safeDecide(state, { type: "topdeckTop", player: pid, card: top });
    if (yes === true) zones.move(state, loc(pid, "discard"), loc(pid, "deck"), { cardId: top });
  });

  /* ══════════════ Intrigue (2nd Ed) cards pinned by Task 64 ══════
     Baron and Conspirator are implemented now (the rest of the
     catalog is pinned in src/data/intrigue.json and implemented by
     their own Phase 7 tasks). Conspirator counts every Action played
     this turn via the player's actionsPlayed counter (incremented in
     actions.play and by Throne Room's double play). */
  effects.register("baron", (state, pid) => {
    apply(state, pid, { buys: 1 });
    const p = player(state, pid);
    const hasEstate = p.hand.indexOf("estate") !== -1;
    const asked = safeDecide(state, { type: "baronDiscard", player: pid, hand: p.hand.slice(), canDiscard: hasEstate });
    if (asked === true && hasEstate) {
      primitives.discard(state, pid, [p.hand.indexOf("estate")]);
      addResource(state, pid, "coins", 4);
    } else if (zones.supplyCount(state, "estate") > 0) {
      primitives.gain(state, pid, "estate");
    }
  });
  effects.register("conspirator", (state, pid) => {
    apply(state, pid, { coins: 2 });
    if (player(state, pid).actionsPlayed >= 3) apply(state, pid, { cards: 1, actions: 1 });
  });

  /* ══════════════ Intrigue (2nd Ed) — Tasks 66-68 ══════════════ */
  effects.register("courtier", (state, pid) => {
    const p = player(state, pid);
    if (p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "revealCard", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    const revealed = p.hand[asked];
    primitives.reveal(state, pid, [revealed]);
    const d = cardDef(revealed);
    if (!d || !d.types || !d.types.length) return;
    const remaining = ["action", "buy", "coins", "gold"];
    const results = { action: 0, buy: 0, coins: 0, gold: 0 };
    for (const t of d.types) {
      if (remaining.length === 0) break;
      const ch = primitives.choose(state, pid, { type: "courtierChoice", card: revealed, cardType: t }, remaining);
      if (ch == null) break;
      results[ch]++;
      remaining.splice(remaining.indexOf(ch), 1);
    }
    apply(state, pid, { actions: results.action, buys: results.buy, coins: results.coins * 3 });
    for (let i = 0; i < results.gold; i++) {
      if (zones.supplyCount(state, "gold") > 0) primitives.gain(state, pid, "gold");
    }
  });
  effects.register("courtyard", (state, pid) => {
    apply(state, pid, { cards: 3 });
    const p = player(state, pid);
    if (p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "courtyardTopdeck", player: pid, hand: p.hand.slice() });
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) {
      primitives.topdeck(state, pid, p.hand[asked]);
    }
  });
  effects.register("diplomat", (state, pid) => {
    apply(state, pid, { cards: 2 });
    if (player(state, pid).hand.length <= 5) apply(state, pid, { actions: 2 });
  });
  reactions.register("diplomat", (state, pid) => {
    const p = player(state, pid);
    if (p.hand.length + 1 < 5) return {};
    zones.draw(state, pid, 2);
    const count = Math.min(3, p.hand.length);
    if (count === 0) return {};
    const asked = safeDecide(state, { type: "diplomatDiscard", player: pid, count: count, hand: p.hand.slice() });
    const chosen = [];
    if (Array.isArray(asked)) {
      for (const i of asked) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
      }
    }
    primitives.discard(state, pid, chosen.slice(0, count));
    return {};
  });

  /* ══════════════ Intrigue — Tasks 71-75 ══════════════
     Harem is data-only (a Treasure-Victory); its dual-type handling
     is exercised by playTreasures (Treasure) and score (Victory). */
  effects.register("ironworks", (state, pid) => {
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= 4 && costPotion(id) === 0);
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: 4 }, pickable);
    if (pickable.indexOf(choice) === -1) return;
    primitives.gain(state, pid, choice);
    const fx = {};
    if (isType(choice, "Action")) fx.actions = 1;
    if (isType(choice, "Treasure")) fx.coins = 1;
    if (isType(choice, "Victory")) fx.cards = 1;
    apply(state, pid, fx);
  });
  effects.register("lurker", (state, pid) => {
    apply(state, pid, { actions: 1 });
    const supplyActions = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && isType(id, "Action"));
    const trashActions = [];
    for (const c of state.trash) if (isType(c, "Action") && trashActions.indexOf(c) === -1) trashActions.push(c);
    const modes = [];
    if (supplyActions.length) modes.push("trashSupply");
    if (trashActions.length) modes.push("gainTrash");
    if (modes.length === 0) return;
    const mode = primitives.choose(state, pid, { type: "lurkerMode" }, modes);
    if (mode === "trashSupply" && supplyActions.length) {
      const pick = primitives.choose(state, pid, { type: "lurkerTrashSupply" }, supplyActions);
      if (supplyActions.indexOf(pick) !== -1) {
        zones.move(state, zoneRef.supply, zoneRef.trash, { cardId: pick });
        fireTrigger("trash", state, pid, { cardId: pick });
      }
    } else if (mode === "gainTrash" && trashActions.length) {
      const pick = primitives.choose(state, pid, { type: "lurkerGainTrash" }, trashActions);
      if (trashActions.indexOf(pick) !== -1) {
        zones.move(state, zoneRef.trash, loc(pid, "discard"), { cardId: pick });
        fireTrigger("gain", state, pid, { cardId: pick });
      }
    }
  });
  effects.register("masquerade", (state, pid) => {
    apply(state, pid, { cards: 2 });
    const pass = new Map();
    for (const pl of state.players) {
      const p = player(state, pl.id);
      if (p.hand.length === 0) { pass.set(pl.id, null); continue; }
      const asked = safeDecide(state, { type: "masqueradePass", player: pl.id, hand: p.hand.slice() });
      let chosen = null;
      if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) chosen = p.hand[asked];
      pass.set(pl.id, chosen);
    }
    for (const pl of state.players) {
      const card = pass.get(pl.id);
      if (card == null) continue;
      zones.move(state, loc(pl.id, "hand"), loc(nextPlayer(state, pl.id), "hand"), { cardId: card });
    }
    const p = player(state, pid);
    if (p.hand.length === 0) return;
    const yes = safeDecide(state, { type: "masqueradeTrash", player: pid, hand: p.hand.slice() });
    if (yes !== true || p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) primitives.trash(state, pid, { index: asked });
  });
  effects.register("mill", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    const p = player(state, pid);
    if (p.hand.length < 2) return;
    const yes = safeDecide(state, { type: "millDiscard", player: pid, hand: p.hand.slice() });
    if (yes !== true) return;
    const asked = safeDecide(state, { type: "discardExactly", player: pid, count: 2, hand: p.hand.slice() });
    const chosen = [];
    if (Array.isArray(asked)) {
      for (const i of asked) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
      }
    }
    if (chosen.length < 2) return;
    primitives.discard(state, pid, chosen.slice(0, 2));
    addResource(state, pid, "coins", 2);
  });

  /* ══════════════ Intrigue — Tasks 76-85 ══════════════ */
  effects.register("mining_village", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 2 });
    const p = player(state, pid);
    if (p.play.indexOf("mining_village") === -1) return;
    const yes = safeDecide(state, { type: "miningVillageTrash", player: pid });
    if (yes !== true) return;
    primitives.trash(state, pid, { from: loc(pid, "play"), cardId: "mining_village" });
    addResource(state, pid, "coins", 2);
  });
  effects.register("minion", (state, pid) => {
    apply(state, pid, { actions: 1 });
    const mode = primitives.choose(state, pid, { type: "minionMode" }, ["coins", "draw"]);
    if (mode !== "draw") { addResource(state, pid, "coins", 2); return; }
    const p = player(state, pid);
    if (p.hand.length) primitives.discard(state, pid, p.hand.map((_, i) => i));
    zones.draw(state, pid, 4);
    attack.dispatch(state, pid, "minion", (s, t) => {
      const tp = player(s, t);
      if (tp.hand.length < 5) return;
      if (tp.hand.length) primitives.discard(s, t, tp.hand.map((_, i) => i));
      zones.draw(s, t, 4);
    });
  });
  effects.register("nobles", (state, pid) => {
    const mode = primitives.choose(state, pid, { type: "noblesChoice" }, ["cards", "actions"]);
    if (mode === "cards") apply(state, pid, { cards: 3 });
    else apply(state, pid, { actions: 2 });
  });
  effects.register("pawn", (state, pid) => {
    const asked = safeDecide(state, { type: "pawnChoices", player: pid, count: 2 });
    const options = ["card", "action", "buy", "coin"];
    const chosen = [];
    if (Array.isArray(asked)) {
      for (const o of asked) {
        if (options.indexOf(o) !== -1 && chosen.indexOf(o) === -1) chosen.push(o);
      }
    }
    const fx = {};
    for (const o of chosen.slice(0, 2)) {
      if (o === "card") fx.cards = (fx.cards || 0) + 1;
      else if (o === "action") fx.actions = (fx.actions || 0) + 1;
      else if (o === "buy") fx.buys = (fx.buys || 0) + 1;
      else if (o === "coin") fx.coins = (fx.coins || 0) + 1;
    }
    apply(state, pid, fx);
  });
  effects.register("patrol", (state, pid) => {
    apply(state, pid, { cards: 3 });
    const p = player(state, pid);
    const revealed = [];
    for (let i = 0; i < 4; i++) {
      if (p.deck.length === 0) {
        if (p.discard.length === 0) break;
        zones.reshuffle(state, pid);
      }
      revealed.push(p.deck.pop());
    }
    if (revealed.length === 0) return;
    p.setAside.push.apply(p.setAside, revealed);
    for (const c of revealed) {
      state.log.push({ t: "reveal", player: pid, card: c });
      fireTrigger("reveal", state, pid, { cardId: c });
    }
    const toHand = revealed.filter((id) => isType(id, "Victory") || id === "curse");
    for (const c of toHand) zones.move(state, loc(pid, "setAside"), loc(pid, "hand"), { cardId: c });
    const rest = revealed.filter((id) => toHand.indexOf(id) === -1);
    if (rest.length === 0) return;
    let seq = rest.slice();
    const asked = safeDecide(state, { type: "patrolOrder", player: pid, cards: rest.slice() });
    if (Array.isArray(asked)) {
      const ded = [];
      for (const id of asked) if (rest.indexOf(id) !== -1 && ded.indexOf(id) === -1) ded.push(id);
      if (ded.length === rest.length) seq = ded;
    }
    for (let i = seq.length - 1; i >= 0; i--) zones.move(state, loc(pid, "setAside"), loc(pid, "deck"), { cardId: seq[i] });
  });
  effects.register("replace", (state, pid) => {
    const p = player(state, pid);
    if (p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    const trashed = p.hand[asked];
    primitives.trash(state, pid, { index: asked });
    const maxCost = costCoins(trashed) + 2;
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= maxCost && costPotion(id) === 0);
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
    if (pickable.indexOf(choice) === -1) return;
    if (isType(choice, "Action") || isType(choice, "Treasure")) {
      primitives.gain(state, pid, choice, { to: loc(pid, "deck") });
    } else {
      primitives.gain(state, pid, choice);
      if (isType(choice, "Victory")) {
        attack.dispatch(state, pid, "replace", (s, t) => {
          if (zones.supplyCount(s, "curse") > 0) primitives.gain(s, t, "curse");
        });
      }
    }
  });
  effects.register("secret_passage", (state, pid) => {
    apply(state, pid, { cards: 2, actions: 1 });
    const p = player(state, pid);
    if (p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "secretPassageCard", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    const card = p.hand[asked];
    zones.move(state, loc(pid, "hand"), loc(pid, "deck"), { cardId: card });
    const deck = player(state, pid).deck;
    const n = deck.length - 1;
    const depth = safeDecide(state, { type: "secretPassageDepth", player: pid, card: card, maxDepth: n });
    const above = Math.min(Math.max(0, depth == null ? 0 : depth), n);
    const moved = deck.pop();
    deck.splice(deck.length - above, 0, moved);
  });
  effects.register("shanty_town", (state, pid) => {
    apply(state, pid, { actions: 2 });
    const p = player(state, pid);
    primitives.reveal(state, pid, p.hand.slice());
    if (!p.hand.some((id) => isType(id, "Action"))) apply(state, pid, { cards: 2 });
  });
  effects.register("steward", (state, pid) => {
    const mode = primitives.choose(state, pid, { type: "stewardMode" }, ["cards", "coins", "trash"]);
    if (mode === "cards") { apply(state, pid, { cards: 2 }); return; }
    if (mode === "coins") { apply(state, pid, { coins: 2 }); return; }
    const p = player(state, pid);
    if (p.hand.length === 0) return;
    const asked = safeDecide(state, { type: "trashTwo", player: pid, count: 2, hand: p.hand.slice() });
    const idx = [];
    if (Array.isArray(asked)) {
      for (const i of asked) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && idx.indexOf(i) === -1) idx.push(i);
      }
    }
    const chosen = idx.slice(0, 2).sort((a, b) => b - a);
    for (const i of chosen) primitives.trash(state, pid, { index: i });
  });
  effects.register("swindler", (state, pid) => {
    apply(state, pid, { coins: 2 });
    attack.dispatch(state, pid, "swindler", (s, t) => {
      const tp = player(s, t);
      if (tp.deck.length === 0) {
        if (tp.discard.length === 0) return;
        zones.reshuffle(s, t);
      }
      const top = tp.deck[tp.deck.length - 1];
      s.log.push({ t: "reveal", player: t, card: top });
      fireTrigger("reveal", s, t, { cardId: top });
      zones.move(s, loc(t, "deck"), zoneRef.trash, { cardId: top });
      const pickable = Object.keys(s.supply).filter((id) => s.supply[id] > 0 && costCoins(id) === costCoins(top) && costPotion(id) === costPotion(top));
      const choice = primitives.choose(s, pid, { type: "swindlerGain", attack: "swindler", target: t, trashCard: top, cost: costCoins(top) }, pickable);
      if (pickable.indexOf(choice) !== -1) primitives.gain(s, t, choice);
    });
  });

  /* ═══════════════════════════════════════════════════════════════
     END-OF-GAME DETECTION & SCORING (Task 10)
     The game ends when the Province pile is empty OR at least three
     supply piles are empty. The condition is checked when a turn
     ends (endTurn), never mid-turn, per the official rules.
     engine.endGame() sets state.over, scores everyone, and emits
     "gameOver" { scores, winners, turn }.

     engine.score(state, playerId) counts every card the player owns
     (all zones), scoring each via the vp registry:
       - static cards use def.vp (Estate 1, Duchy 3, Province 6,
         Curse -1, Treasures/Actions 0)
       - dynamic cards register a function of the whole deck
         (Gardens, Duke, Vineyard, Fairgrounds)
       - VP tokens are added on top
     Returns { cardCount, total, <per-source breakdown>, tokens }.
     ═══════════════════════════════════════════════════════════════ */
  function emptyPileCount(state) {
    let n = 0;
    for (const k of Object.keys(state.supply)) if (state.supply[k] === 0) n++;
    return n;
  }
  engine.emptyPileCount = emptyPileCount;

  function isGameOver(state) {
    return state.supply.province === 0 || (state.supply.colony === 0) || emptyPileCount(state) >= 3;
  }
  engine.isGameOver = isGameOver;

  function playerCards(state, playerId) {
    const p = player(state, playerId);
    return PLAYER_ZONES.reduce((acc, z) => acc.concat(p[z]), []);
  }
  engine.playerCards = playerCards;

  const vpFns = new Map();
  const vp = {
    register(cardId, fn) {
      if (typeof fn !== "function") throw new Error("vp function for '" + cardId + "' must be a function");
      vpFns.set(String(cardId), fn);
    },
    resolve(state, playerId, cardId, count) {
      const fn = vpFns.get(String(cardId));
      return fn ? fn(state, playerId, count) : null;
    }
  };
  engine.vp = vp;

  function countOwned(state, playerId, cardId) {
    return playerCards(state, playerId).filter((c) => c === cardId).length;
  }

  function countOwnedByType(state, playerId, type) {
    return playerCards(state, playerId).filter((c) => isType(c, type)).length;
  }

  function uniqueCount(state, playerId) {
    return new Set(playerCards(state, playerId)).size;
  }

  function score(state, playerId) {
    const p = player(state, playerId);
    const all = playerCards(state, playerId);
    const counts = {};
    for (const c of all) counts[c] = (counts[c] || 0) + 1;
    const breakdown = { cardCount: all.length };
    let total = p.vpTokens || 0;
    for (const cardId of Object.keys(counts)) {
      const n = counts[cardId];
      const d = cardDef(cardId);
      let v = 0;
      if (d && vpFns.has(cardId)) v = vp.resolve(state, playerId, cardId, n) * n;
      else if (d && typeof d.vp === "number") v = d.vp * n;
      if (v !== 0) breakdown[cardId] = v;
      total += v;
    }
    breakdown.tokens = p.vpTokens || 0;
    breakdown.total = total;
    return breakdown;
  }
  engine.score = score;

  function scoreAll(state) {
    return state.players.map((p) => {
      const breakdown = score(state, p.id);
      return { player: p.id, total: breakdown.total, breakdown: breakdown };
    });
  }
  engine.scoreAll = scoreAll;

  function topPlayers(state, scores) {
    const max = scores.reduce((m, s) => (s.total > m ? s.total : m), -Infinity);
    return scores.filter((s) => s.total === max).map((s) => s.player);
  }

  function endGame(state) {
    if (state.over) return null;
    state.over = true;
    const scores = scoreAll(state);
    const winners = topPlayers(state, scores);
    state.log.push({ t: "gameOver", winners: winners });
    hooks.emit("gameOver", { scores: scores, winners: winners, turn: state.turn });
    return { scores: scores, winners: winners };
  }
  engine.endGame = endGame;

  /* ── Dynamic VP cards (data in their expansion set files) ── */
  vp.register("gardens", (state, pid) => Math.floor(playerCards(state, pid).length / 10));
  vp.register("duke", (state, pid) => countOwned(state, pid, "duchy"));
  vp.register("vineyard", (state, pid) => Math.floor(countOwnedByType(state, pid, "Action") / 3));
  vp.register("fairgrounds", (state, pid) => 2 * Math.floor(uniqueCount(state, pid) / 10));

  /* ═══════════════════════════════════════════════════════════════
     SUPPLY SETUP BY PLAYER COUNT (Task 11)
       engine.setup({ players, kingdom, seed })
     - players: a count (1–6) or an array of {id, name}
     - kingdom: a card-id array, an expansion id, or omitted (base)
     Builds the game: starting decks of 7 Copper + 3 Estate
     (seeded-shuffled, then a 5-card opening hand is dealt),
     basic piles (Copper 60, Silver 40, Gold 30; Estate/Duchy/
     Province/Curse 8 at 2p, 12 at 3–4p) and the kingdom piles
     (pileSize per def, default 10). Validates the kingdom list
     and player count, and returns the ready game.
     ═══════════════════════════════════════════════════════════════ */
  const BASIC_PILES = ["copper", "silver", "gold", "estate", "duchy", "province", "curse"];
  engine.BASIC_PILES = BASIC_PILES;

  const BASIC_PILE_SIZES = {
    copper: 60, silver: 40, gold: 30,
    estate: { "2": 8, "3": 12 },
    duchy: { "2": 8, "3": 12 },
    province: { "2": 8, "3": 12 },
    curse: { "2": 8, "3": 12 },
    colony: { "2": 8, "3": 12 },
    platinum: 12
  };

  /* Prosperity's Colony & Platinum only appear when a kingdom card
     comes from Prosperity. They are excluded from random-kingdom
     draws (they are set up explicitly below, not chosen). */
  const PROSPERITY_EXTRAS = ["colony", "platinum"];

  /* sizeFromSpec — a pile-size spec is a number or a player-count
     map like { "2": 8, "3": 12 }; the largest key <= n wins. */
  function sizeFromSpec(spec, nPlayers) {
    if (typeof spec === "number") return spec;
    if (spec && typeof spec === "object") {
      let size = 10;
      for (const k of Object.keys(spec)) if (nPlayers >= Number(k)) size = spec[k];
      return size;
    }
    return 10;
  }

  function resolvePileSize(def, nPlayers) {
    return sizeFromSpec(def.pileSize == null ? 10 : def.pileSize, nPlayers);
  }

  function setupGame(opts) {
    opts = opts || {};
    const cards = (typeof Dominion.cards !== "undefined") ? Dominion.cards : null;
    if (!cards) throw new Error("setup requires the card catalog (src/cards.js) to be loaded");

    const g = createGame({ seed: opts.seed, decide: opts.decide });

    let list = opts.players;
    if (Array.isArray(list)) {
      list.forEach((p, i) => {
        if (!p || (p.id == null && p.name == null)) throw new Error("each player entry needs an id or a name");
        g.players.push(createPlayer(p.id == null ? "p" + (i + 1) : p.id, p.name == null ? "Player " + (i + 1) : p.name));
      });
    } else {
      const n = list == null ? 2 : Number(list);
      if (!Number.isInteger(n) || n < 1 || n > 6) throw new Error("player count must be an integer from 1 to 6");
      for (let i = 1; i <= n; i++) g.players.push(createPlayer("p" + i, "Player " + i));
    }
    if (g.players.length === 0) throw new Error("setup requires at least one player");
    const n = g.players.length;

    let kingdom;
    if (opts.kingdom == null) {
      kingdom = g.rand.shuffle(cards.byExpansion("base").filter((c) => c.inSupply && BASIC_PILES.indexOf(c.id) === -1 && c.id !== "potion" && PROSPERITY_EXTRAS.indexOf(c.id) === -1)).slice(0, 10).map((c) => c.id);
    } else if (typeof opts.kingdom === "string") {
      kingdom = g.rand.shuffle(cards.byExpansion(opts.kingdom).filter((c) => c.inSupply && BASIC_PILES.indexOf(c.id) === -1 && c.id !== "potion" && PROSPERITY_EXTRAS.indexOf(c.id) === -1)).slice(0, 10).map((c) => c.id);
    } else if (Array.isArray(opts.kingdom)) {
      kingdom = opts.kingdom.slice();
    } else {
      throw new Error("opts.kingdom must be a card-id array, an expansion id, or omitted");
    }
    if (kingdom.length === 0) throw new Error("no kingdom cards available for setup");
    for (const id of kingdom) {
      const d = cards.get(id);
      if (!d) throw new Error("unknown kingdom card: '" + id + "'");
      if (!d.inSupply) throw new Error("kingdom card is not a supply pile: '" + id + "'");
    }
    if (new Set(kingdom).size !== kingdom.length) throw new Error("kingdom cards must be unique");

    g.supply = {};
    for (const id of BASIC_PILES) {
      if (!cards.get(id)) throw new Error("basic pile card missing from catalog: '" + id + "'");
      g.supply[id] = sizeFromSpec(BASIC_PILE_SIZES[id], n);
    }
    for (const id of kingdom) g.supply[id] = resolvePileSize(cards.get(id), n);
    if (kingdom.some((id) => costPotion(id) > 0)) {
      g.supply.potion = 16;
    }
    if (kingdom.some((id) => (cards.get(id).expansion || "") === "prosperity")) {
      g.supply.colony = sizeFromSpec(BASIC_PILE_SIZES.colony, n);
      g.supply.platinum = 12;
    }
    g.charlatan = kingdom.indexOf("charlatan") !== -1;
    g.aiDifficulty = opts.aiDifficulty || null;

    for (const p of g.players) {
      for (let i = 0; i < 7; i++) p.deck.push("copper");
      for (let i = 0; i < 3; i++) p.deck.push("estate");
      p.deck = g.rand.shuffle(p.deck);
    }
    for (const p of g.players) zones.draw(g, p.id, 5);

    g.kingdom = kingdom;
    g.playerCount = n;
    g.log.push({ t: "setup", players: n, kingdom: kingdom.length });
    return g;
  }
  engine.setup = setupGame;

  /* ═══════════════════════════════════════════════════════════════
     STATE SERIALIZATION (Task 60 — autosave/resume)
       engine.serialize(state)    — JSON-safe plain snapshot. The two
                                    function fields (rand, decide) are
                                    deliberately dropped; everything
                                    else on the game state is plain
                                    data (players/supply/trash/log/
                                    kingdom/aiDifficulty/turn/phase…).
       engine.deserialize(data)   — rebuild a live game state from a
                                    snapshot: a fresh seeded rand() is
                                    re-derived from the saved seed, so
                                    the resumed game continues the same
                                    deterministic RNG stream it would
                                    have used without the pause. The
                                    caller re-wires state.decide (the
                                    UI does this on mount).
     ═══════════════════════════════════════════════════════════════ */
  function serialize(state) {
    const out = {};
    const order = ["version", "seed", "players", "supply", "trash", "turn", "turnPlayer", "phase", "log", "over", "aiDifficulty", "kingdom", "playerCount", "charlatan"];
    for (const k of order) if (state[k] !== undefined) out[k] = state[k];
    return JSON.parse(JSON.stringify(out));
  }
  engine.serialize = serialize;

  function deserialize(data) {
    if (!data || typeof data !== "object") throw new Error("deserialize requires a saved state object");
    if (!Array.isArray(data.players)) throw new Error("saved state is missing players");
    if (!data.supply || typeof data.supply !== "object") throw new Error("saved state is missing supply");
    const g = createGame({ seed: data.seed });
    for (const k of ["players", "supply", "trash", "turn", "turnPlayer", "phase", "log", "over", "kingdom", "playerCount", "aiDifficulty", "charlatan"]) {
      if (data[k] !== undefined) g[k] = data[k];
    }
    g.version = engine.VERSION;
    return g;
  }
  engine.deserialize = deserialize;

  /* ═══════════════════════════════════════════════════════════════
     EFFECT PRIMITIVES & TRIGGER REGISTRY (Task 12)
     Primitives are the canonical ways cards change the game, and
     they fire trigger events so expansion cards can react:
       primitives.gain        — supply → player zone, fires "gain"
       primitives.trash       — any zone → trash, fires "trash"
       primitives.reveal      — show owned cards (they stay put)
       primitives.topdeck     — move a card to the top of the deck
       primitives.discard     — discard given hand indices
       primitives.playAnother — play an Action without spending one
                                (Throne Room building block)
       primitives.choose      — safe decide() wrapper with option check

     Triggers: engine.triggers.register(cardId, { onGain, onTrash,
     onBuy, onPlay, onDiscard, onReveal, onTurnStart }). When an
     event fires for a player:
       - the event's subject card runs its own handler first
         (e.g. "when you gain this, …")
       - continuous events (turnStart, reveal, discard) also run
         handlers on every other card the player owns
         (e.g. "at the start of your turn, …")
     Gain/trash/buy/play are subject-only, matching the official
     wording ("when you gain THIS") — an already-owned card never
     re-triggers on later gains. Chains resolve depth-first in a
     deterministic order; a recursion guard stops runaway loops.
     ═══════════════════════════════════════════════════════════════ */
  const triggerHandlers = new Map();
  let fireDepth = 0;
  const CONTINUOUS_EVENTS = ["turnStart", "reveal", "discard"];

  function fireTrigger(event, state, playerId, ctx) {
    fireDepth++;
    try {
      if (fireDepth > 100) throw new Error("trigger recursion limit exceeded (" + event + ")");
      ctx = ctx || {};
      const key = "on" + event.charAt(0).toUpperCase() + event.slice(1);
      if (ctx.cardId != null) {
        const own = triggerHandlers.get(ctx.cardId);
        if (own && typeof own[key] === "function") own[key](state, playerId, ctx);
      }
      if (CONTINUOUS_EVENTS.indexOf(event) !== -1) {
        for (const id of playerCards(state, playerId)) {
          if (id === ctx.cardId) continue;
          const h = triggerHandlers.get(id);
          if (h && typeof h[key] === "function") h[key](state, playerId, ctx);
        }
      }
    } finally {
      fireDepth--;
    }
  }

  const triggers = {
    register(cardId, handlers) {
      if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) {
        throw new Error("triggers for '" + cardId + "' must be a handler object");
      }
      const prev = triggerHandlers.get(String(cardId)) || {};
      triggerHandlers.set(String(cardId), Object.assign({}, prev, handlers));
    },
    fire: fireTrigger,
    has(cardId) { return triggerHandlers.has(String(cardId)); }
  };
  engine.triggers = triggers;

  /* ══════════════ Hinterlands preview — Farmland (Task 70) ═══════
     Farmland is a Hinterlands card the roadmap schedules inside the
     Intrigue phase; it is implemented here with its official on-buy
     trigger and lives in src/data/hinterlands.json. The rest of the
     Hinterlands set ships in its own phase. */
  triggers.register("farmland", {
    onBuy(state, pid, ctx) {
      const p = player(state, pid);
      if (p.hand.length === 0) return;
      const yes = safeDecide(state, { type: "farmlandTrash", player: pid, hand: p.hand.slice() });
      if (yes !== true) return;
      const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
      if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
      const trashed = p.hand[asked];
      primitives.trash(state, pid, { index: asked });
      const maxCost = costCoins(trashed) + 2;
      const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= maxCost && costPotion(id) === 0);
      const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
      if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
    }
  });

  /* ══════════════ on-gain reactions (Seaside) ══════════════════
     afterGain runs after every gain (wired into primitives.gain):
       Blockade — other players who gain a copy of the set-aside
                  card gain a Curse
       Monkey   — the monkey's owner draws when the player to
                  their right gains a card
       Pirate   — when any player gains a Treasure, other players
                  may play Pirate from hand as a reaction
       Sailor   — once per turn, the sailor's owner may play a
                  gained Duration card immediately
     gainDepth guards against runaway recursion (e.g. a chain of
     gains each triggering further gains). */
  let gainDepth = 0;

  function playGainedDuration(state, playerId, cardId) {
    const p = player(state, playerId);
    const idx = p.discard.indexOf(cardId);
    if (idx === -1) return;
    p.discard.splice(idx, 1);
    p.play.push(cardId);
    state.log.push({ t: "playAction", player: playerId, card: cardId, via: "sailor" });
    effects.resolve(state, playerId, cardId, { cardId: cardId });
    fireTrigger("play", state, playerId, { cardId: cardId });
  }

  function afterGain(state, playerId, cardId) {
    if (gainDepth > 20) return;
    gainDepth++;
    try {
      const p = player(state, playerId);
      if (p.lastTurnGains && p.lastTurnGains.length < 40) p.lastTurnGains.push(cardId);
      for (const other of state.players) {
        if (other.id === playerId) continue;
        if (other.blockadeAside.indexOf(cardId) !== -1) {
          if (zones.supplyCount(state, "curse") > 0) primitives.gain(state, playerId, "curse");
          break;
        }
      }
      for (const other of state.players) {
        if (other.id === playerId) continue;
        if (other.monkeyActive === true && nextPlayer(state, other.id) === playerId) {
          zones.draw(state, other.id, 1);
          state.log.push({ t: "monkeyDraw", player: other.id });
          break;
        }
      }
      if (isType(cardId, "Treasure")) {
        for (const other of state.players) {
          if (other.id === playerId) continue;
          const idx = other.hand.indexOf("pirate");
          if (idx === -1) continue;
          const yes = safeDecide(state, { type: "piratePlay", player: other.id, card: cardId, attacker: playerId });
          if (yes === true) {
            zones.move(state, loc(other.id, "hand"), loc(other.id, "play"), { index: idx });
            other.piratePending = true;
            state.log.push({ t: "pirateReaction", player: other.id });
          }
        }
      }
      if (p.collectionActive === true && isType(cardId, "Action")) {
        addResource(state, playerId, "coins", 1);
        state.log.push({ t: "collection", player: playerId, card: cardId });
      }
      if (p.hoardActive === true && p.buyGainedId === cardId && isType(cardId, "Victory")) {
        if (zones.supplyCount(state, "gold") > 0) {
          primitives.gain(state, playerId, "gold");
          state.log.push({ t: "hoard", player: playerId });
        }
      }
      if (p.tiaraActive === true) {
        const idx = p.discard.indexOf(cardId);
        if (idx !== -1) {
          const yes = safeDecide(state, { type: "tiaraTopdeck", player: playerId, card: cardId });
          if (yes === true) {
            p.discard.splice(idx, 1);
            p.deck.push(cardId);
            state.log.push({ t: "tiaraTopdeck", player: playerId, card: cardId });
          }
        }
      }
      if (p.hand.indexOf("watchtower") !== -1 && p.discard.indexOf(cardId) !== -1) {
        const mode = safeDecide(state, { type: "watchtowerUse", player: playerId, card: cardId, options: ["trash", "topdeck"] });
        const idx = p.discard.indexOf(cardId);
        if (idx !== -1 && mode === "trash") {
          p.discard.splice(idx, 1);
          state.trash.push(cardId);
          state.log.push({ t: "watchtowerTrash", player: playerId, card: cardId });
        } else if (idx !== -1 && mode === "topdeck") {
          p.discard.splice(idx, 1);
          p.deck.push(cardId);
          state.log.push({ t: "watchtowerTopdeck", player: playerId, card: cardId });
        }
      }
      if (p.sailorCount > p.sailorUsed && durations.has(cardId)) {
        const yes = safeDecide(state, { type: "sailorPlay", player: playerId, card: cardId });
        if (yes === true) {
          p.sailorUsed++;
          playGainedDuration(state, playerId, cardId);
        }
      }
    } finally {
      gainDepth--;
    }
  }
  engine.afterGain = afterGain;

  /* ═══════════════════════════════════════════════════════════════
     INTRIGUE — Torturer, Trading Post, Upgrade, Wishing Well
     (the rest of Intrigue shipped in earlier tasks)
     ═══════════════════════════════════════════════════════════════ */
  effects.register("torturer", (state, pid) => {
    apply(state, pid, { cards: 2 });
    attack.dispatch(state, pid, "torturer", (s, t) => {
      const p = player(s, t);
      const asked = safeDecide(s, { type: "torturerChoice", player: t, attack: "torturer", hand: p.hand.slice() });
      if (asked === "curse") {
        if (zones.supplyCount(s, "curse") > 0) primitives.gain(s, t, "curse", { to: loc(t, "hand") });
      } else {
        const count = Math.min(2, p.hand.length);
        if (count > 0) {
          const asked2 = safeDecide(s, { type: "discardDown", player: t, attack: "torturer", count: count, hand: p.hand.slice() });
          const chosen = [];
          if (Array.isArray(asked2)) for (const i of asked2) if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
          primitives.discard(s, t, chosen.slice(0, count));
        }
      }
    });
  });

  effects.register("trading_post", (state, pid) => {
    apply(state, pid, { buys: 1 });
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashTwo", player: pid, count: 2, hand: p.hand.slice() });
    const chosen = [];
    if (Array.isArray(asked)) for (const i of asked) if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
    chosen.sort((a, b) => b - a);
    let trashed = 0;
    for (const i of chosen) { if (trashed >= 2) break; primitives.trash(state, pid, { index: i }); trashed++; }
    if (trashed >= 2 && zones.supplyCount(state, "silver") > 0) primitives.gain(state, pid, "silver", { to: loc(pid, "hand") });
  });

  effects.register("upgrade", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    const trashed = p.hand[asked];
    primitives.trash(state, pid, { index: asked });
    const maxCost = costCoins(trashed) + 1;
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) === maxCost && costPotion(id) === costPotion(trashed));
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
  });

  effects.register("wishing_well", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    const nameable = Object.keys(state.supply).filter((id) => state.supply[id] > 0);
    const named = safeDecide(state, { type: "wishName", player: pid, options: nameable });
    const p = player(state, pid);
    const top = p.deck[p.deck.length - 1];
    if (top == null) return;
    if (top === named) zones.move(state, loc(pid, "deck"), loc(pid, "hand"), { fromTop: true });
    else zones.move(state, loc(pid, "deck"), loc(pid, "discard"), { fromTop: true });
  });

  /* ═══════════════════════════════════════════════════════════════
     SEASIDE (2nd Edition) — 27 cards (data in src/data/seaside.json)
     ═══════════════════════════════════════════════════════════════ */
  effects.register("astrolabe", (state, pid) => apply(state, pid, { buys: 1, coins: 1 }));
  durations.register("astrolabe", { resolve(state, pid) { apply(state, pid, { buys: 1, coins: 1 }); } });

  effects.register("bazaar", (state, pid) => apply(state, pid, { cards: 1, actions: 2, coins: 1 }));

  effects.register("blockade", (state, pid) => {
    const maxCost = 4;
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= maxCost && costPotion(id) === 0);
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
    if (pickable.indexOf(choice) === -1) return;
    primitives.gain(state, pid, choice);
    const p = player(state, pid);
    const idx = p.discard.indexOf(choice);
    if (idx !== -1) {
      p.discard.splice(idx, 1);
      p.blockadeAside.push(choice);
      state.log.push({ t: "blockadeSetAside", player: pid, card: choice });
    }
  });
  durations.register("blockade", {
    resolve(state, pid) {
      const p = player(state, pid);
      while (p.blockadeAside.length) {
        const id = p.blockadeAside.pop();
        p.hand.push(id);
        state.log.push({ t: "blockadeReturn", player: pid, card: id });
      }
    }
  });

  effects.register("caravan", (state, pid) => apply(state, pid, { cards: 1, actions: 1 }));
  durations.register("caravan", { resolve(state, pid) { zones.draw(state, pid, 1); } });

  effects.register("corsair", (state, pid) => {
    apply(state, pid, { coins: 2 });
    attack.dispatch(state, pid, "corsair", (s, t) => {
      const tp = player(s, t);
      tp.corsairActive = true;
      tp.corsairFrom = pid;
      tp.corsairTrashed = false;
    });
  });
  durations.register("corsair", { resolve(state, pid) { zones.draw(state, pid, 1); } });

  effects.register("cutpurse", (state, pid) => {
    apply(state, pid, { coins: 2 });
    attack.dispatch(state, pid, "cutpurse", (s, t) => {
      const p = player(s, t);
      const idx = p.hand.indexOf("copper");
      if (idx === -1) primitives.reveal(s, t, p.hand.slice());
      else primitives.discard(s, t, [idx]);
    });
  });

  effects.register("fishing_village", (state, pid) => apply(state, pid, { actions: 2, coins: 1 }));
  durations.register("fishing_village", { resolve(state, pid) { apply(state, pid, { actions: 1, coins: 1 }); } });

  effects.register("haven", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "havenSetAside", player: pid, hand: p.hand.slice() });
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) {
      const id = p.hand.splice(asked, 1)[0];
      p.havenAside.push(id);
      state.log.push({ t: "havenSetAside", player: pid, card: id });
    }
  });
  durations.register("haven", {
    resolve(state, pid) {
      const p = player(state, pid);
      while (p.havenAside.length) p.hand.push(p.havenAside.pop());
    }
  });

  effects.register("island", (state, pid) => {
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "islandSetAside", player: pid, hand: p.hand.slice() });
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) {
      const id = p.hand.splice(asked, 1)[0];
      p.islandMat.push(id);
      state.log.push({ t: "islandMat", player: pid, card: id });
    }
    const idx = p.play.indexOf("island");
    if (idx !== -1) {
      p.play.splice(idx, 1);
      p.islandMat.push("island");
      state.log.push({ t: "islandMat", player: pid, card: "island" });
    }
  });

  effects.register("lighthouse", (state, pid) => {
    apply(state, pid, { actions: 1, coins: 1 });
    player(state, pid).lighthouseImmune = true;
  });
  durations.register("lighthouse", { resolve(state, pid) { apply(state, pid, { coins: 1 }); } });

  effects.register("lookout", (state, pid) => {
    apply(state, pid, { actions: 1 });
    const p = player(state, pid);
    const looked = [];
    for (let i = 0; i < 3 && p.deck.length; i++) looked.push(p.deck.pop());
    if (!looked.length) return;
    const decided = safeDecide(state, { type: "lookoutDispose", player: pid, cards: looked.slice() });
    let trashI = (decided && Number.isInteger(decided.trash)) ? decided.trash : -1;
    let discI = (decided && Number.isInteger(decided.discard)) ? decided.discard : -1;
    if (trashI === discI) discI = -1;
    if (trashI < 0 || trashI >= looked.length) trashI = -1;
    if (discI < 0 || discI >= looked.length) discI = -1;
    const remaining = [];
    for (let i = 0; i < looked.length; i++) {
      if (i === trashI) { state.trash.push(looked[i]); state.log.push({ t: "trash", player: pid, card: looked[i] }); }
      else if (i === discI) { p.discard.push(looked[i]); state.log.push({ t: "discard", player: pid, card: looked[i] }); }
      else remaining.push(looked[i]);
    }
    for (const id of remaining) p.deck.push(id);
    state.log.push({ t: "lookout", player: pid, trash: trashI, discard: discI });
  });

  effects.register("merchant_ship", (state, pid) => apply(state, pid, { coins: 2 }));
  durations.register("merchant_ship", { resolve(state, pid) { apply(state, pid, { coins: 2 }); } });

  effects.register("monkey", (state, pid) => { player(state, pid).monkeyActive = true; });
  durations.register("monkey", { resolve(state, pid) { zones.draw(state, pid, 1); } });

  effects.register("native_village", (state, pid) => {
    apply(state, pid, { actions: 2 });
    const p = player(state, pid);
    const mode = safeDecide(state, { type: "nativeVillageMode", player: pid });
    if (mode === "hand") {
      while (p.nativeMat.length) p.hand.push(p.nativeMat.pop());
      state.log.push({ t: "nativeVillage", player: pid, mode: "hand" });
    } else if (p.deck.length) {
      const id = p.deck.pop();
      p.nativeMat.push(id);
      state.log.push({ t: "nativeMat", player: pid, card: id });
    }
  });

  effects.register("outpost", (state, pid) => {
    const p = player(state, pid);
    if (!p.outpostUsed && !p.isExtraTurn) {
      p.outpostUsed = true;
      p.wantsExtraTurn = true;
      p.drawCount = 3;
      state.log.push({ t: "outpost", player: pid, extraTurn: true });
    }
  });
  durations.register("outpost", {});

  effects.register("pirate", (state, pid) => { player(state, pid).piratePending = true; });
  durations.register("pirate", {
    resolve(state, pid) {
      const maxCost = 5;
      const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && isType(id, "Treasure") && costCoins(id) <= maxCost && costPotion(id) === 0);
      const choice = primitives.choose(state, pid, { type: "gainTreasure", maxCost: maxCost }, pickable);
      if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice, { to: loc(pid, "hand") });
    }
  });

  effects.register("sailor", (state, pid) => {
    apply(state, pid, { actions: 1 });
    player(state, pid).sailorCount++;
  });
  durations.register("sailor", {
    resolve(state, pid) {
      apply(state, pid, { coins: 1 });
      const p = player(state, pid);
      if (!p.hand.length) return;
      const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
      if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) primitives.trash(state, pid, { index: asked });
    }
  });

  effects.register("salvager", (state, pid) => {
    apply(state, pid, { buys: 1 });
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    const trashed = p.hand[asked];
    primitives.trash(state, pid, { index: asked });
    addResource(state, pid, "coins", costCoins(trashed));
  });

  effects.register("sea_chart", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    const p = player(state, pid);
    const top = p.deck[p.deck.length - 1];
    if (top == null) return;
    primitives.reveal(state, pid, top);
    if (inPlayCount(state, pid, top) > 0) zones.move(state, loc(pid, "deck"), loc(pid, "hand"), { fromTop: true });
  });

  effects.register("sea_witch", (state, pid) => {
    apply(state, pid, { cards: 2 });
    attack.dispatch(state, pid, "sea_witch", (s, t) => {
      if (zones.supplyCount(s, "curse") > 0) primitives.gain(s, t, "curse");
    });
  });
  durations.register("sea_witch", {
    resolve(state, pid) {
      apply(state, pid, { cards: 2 });
      const p = player(state, pid);
      const count = Math.min(2, p.hand.length);
      if (count > 0) {
        const asked = safeDecide(state, { type: "discardExactly", player: pid, count: count, hand: p.hand.slice() });
        const chosen = [];
        if (Array.isArray(asked)) for (const i of asked) if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
        primitives.discard(state, pid, chosen.slice(0, count));
      }
    }
  });

  effects.register("smugglers", (state, pid) => {
    const right = nextPlayer(state, pid);
    const rp = player(state, right);
    const gains = (rp.lastTurnGains || []).filter((id) => costCoins(id) <= 6 && costPotion(id) === 0);
    const pickable = gains.filter((id) => state.supply[id] > 0);
    if (!pickable.length) return;
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: 6 }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
  });

  effects.register("tactician", (state, pid) => {
    const p = player(state, pid);
    if (p.hand.length === 0) return;
    while (p.hand.length) zones.move(state, loc(pid, "hand"), loc(pid, "discard"), { fromTop: true });
    p.tacticianActive = true;
  });
  durations.register("tactician", {
    keepFn(state, pid) { return player(state, pid).tacticianActive === true; },
    resolve(state, pid) { apply(state, pid, { cards: 5, actions: 1, buys: 1 }); }
  });

  effects.register("tide_pools", (state, pid) => apply(state, pid, { cards: 3, actions: 1 }));
  durations.register("tide_pools", {
    resolve(state, pid) {
      const p = player(state, pid);
      const count = Math.min(2, p.hand.length);
      if (count > 0) {
        const asked = safeDecide(state, { type: "discardExactly", player: pid, count: count, hand: p.hand.slice() });
        const chosen = [];
        if (Array.isArray(asked)) for (const i of asked) if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
        primitives.discard(state, pid, chosen.slice(0, count));
      }
    }
  });

  effects.register("treasure_map", (state, pid) => {
    const p = player(state, pid);
    let trashed = 0;
    const fromHand = p.hand.indexOf("treasure_map");
    if (fromHand !== -1) {
      primitives.trash(state, pid, { index: fromHand });
      trashed++;
    }
    const idx = p.play.indexOf("treasure_map");
    if (idx !== -1) {
      p.play.splice(idx, 1);
      state.trash.push("treasure_map");
      state.log.push({ t: "trash", player: pid, card: "treasure_map" });
      trashed++;
    }
    if (trashed >= 2) {
      for (let i = 0; i < 4; i++) {
        if (zones.supplyCount(state, "gold") > 0) {
          zones.move(state, zoneRef.supply, loc(pid, "deck"), { cardId: "gold" });
          state.log.push({ t: "treasureMapGold", player: pid });
        }
      }
    }
  });

  effects.register("treasury", (state, pid) => apply(state, pid, { cards: 1, actions: 1, coins: 1 }));

  effects.register("warehouse", (state, pid) => {
    apply(state, pid, { cards: 3, actions: 1 });
    const p = player(state, pid);
    const count = Math.min(3, p.hand.length);
    if (count > 0) {
      const asked = safeDecide(state, { type: "discardExactly", player: pid, count: count, hand: p.hand.slice() });
      const chosen = [];
      if (Array.isArray(asked)) for (const i of asked) if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
      primitives.discard(state, pid, chosen.slice(0, count));
    }
  });

  effects.register("wharf", (state, pid) => apply(state, pid, { cards: 2, buys: 1 }));
  durations.register("wharf", { resolve(state, pid) { apply(state, pid, { cards: 2, buys: 1 }); } });

  /* ═══════════════════════════════════════════════════════════════
     ALCHEMY — 12 cards (data in src/data/alchemy.json)
     ═══════════════════════════════════════════════════════════════ */
  effects.register("alchemist", (state, pid) => apply(state, pid, { cards: 2, actions: 1 }));
  durations.register("alchemist", {
    keepFn() { return false; },
    cleanup(state, pid, ctx) {
      const p = player(state, pid);
      if (p.play.indexOf("potion") === -1) return;
      const yes = safeDecide(state, { type: "alchemistTopdeck", player: pid });
      if (yes === true) {
        const idx = p.play.indexOf("alchemist");
        if (idx !== -1) {
          p.play.splice(idx, 1);
          p.deck.push("alchemist");
          state.log.push({ t: "alchemistTopdeck", player: pid });
        }
      }
    }
  });

  effects.register("apothecary", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    const p = player(state, pid);
    const looked = [];
    for (let i = 0; i < 4 && p.deck.length; i++) looked.push(p.deck.pop());
    if (!looked.length) return;
    const keep = [];
    for (const id of looked) {
      if (id === "copper" || id === "potion") p.hand.push(id);
      else keep.push(id);
    }
    state.log.push({ t: "apothecary", player: pid, drew: looked.slice() });
    if (keep.length) {
      const order = safeDecide(state, { type: "apothecaryOrder", player: pid, cards: keep.slice() });
      const ordered = (Array.isArray(order) ? order : keep).filter((id) => keep.indexOf(id) !== -1);
      for (const id of ordered) p.deck.push(id);
    }
  });

  effects.register("apprentice", (state, pid) => {
    apply(state, pid, { actions: 1 });
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    const trashed = p.hand[asked];
    primitives.trash(state, pid, { index: asked });
    const draw = costCoins(trashed) + (costPotion(trashed) > 0 ? 2 : 0);
    if (draw > 0) zones.draw(state, pid, draw);
  });

  effects.register("familiar", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 1 });
    attack.dispatch(state, pid, "familiar", (s, t) => {
      if (zones.supplyCount(s, "curse") > 0) primitives.gain(s, t, "curse");
    });
  });

  effects.register("golem", (state, pid) => {
    const p = player(state, pid);
    const found = [];
    const revealed = [];
    while (found.length < 2 && p.deck.length) {
      const id = p.deck.pop();
      revealed.push(id);
      if (isType(id, "Action") && id !== "golem") found.push(id);
    }
    state.log.push({ t: "golem", player: pid, revealed: revealed.slice(), found: found.slice() });
    for (const id of revealed) {
      if (found.indexOf(id) === -1) p.discard.push(id);
    }
    if (found.length) {
      const order = safeDecide(state, { type: "golemOrder", player: pid, cards: found.slice() });
      const ordered = (Array.isArray(order) ? order : found).filter((id) => found.indexOf(id) !== -1);
      for (const id of ordered) {
        p.play.push(id);
        effects.resolve(state, pid, id, { cardId: id });
        fireTrigger("play", state, pid, { cardId: id });
      }
    }
  });

  effects.register("herbalist", (state, pid) => apply(state, pid, { buys: 1, coins: 1 }));
  durations.register("herbalist", {
    keepFn() { return false; },
    cleanup(state, pid, ctx) {
      const p = player(state, pid);
      const treasures = p.play.filter((id) => isType(id, "Treasure"));
      if (!treasures.length) return;
      const asked = safeDecide(state, { type: "herbalistReturn", player: pid, options: treasures });
      if (!asked || treasures.indexOf(asked) === -1) return;
      const idx = p.play.indexOf(asked);
      if (idx !== -1) {
        p.play.splice(idx, 1);
        p.deck.push(asked);
        state.log.push({ t: "herbalistReturn", player: pid, card: asked });
      }
    }
  });

  effects.register("philosophers_stone", (state, pid) => {});
  effects.register("scrying_pool", (state, pid) => {
    apply(state, pid, { actions: 1 });
    for (const pl of state.players) {
      const top = pl.deck[pl.deck.length - 1];
      if (top == null) continue;
      primitives.reveal(state, pl.id, top);
      const asked = safeDecide(state, { type: "scryingTop", player: pid, target: pl.id, card: top });
      if (asked !== "keep") zones.move(state, loc(pl.id, "deck"), loc(pl.id, "discard"), { fromTop: true });
    }
    const p = player(state, pid);
    const keep = [];
    let action = null;
    while (p.deck.length && action == null) {
      const id = p.deck.pop();
      if (isType(id, "Action")) action = id;
      else keep.push(id);
    }
    for (const id of keep) p.hand.push(id);
    if (action != null) {
      p.discard.push(action);
      state.log.push({ t: "scryingPool", player: pid, action: action, nonActions: keep.slice() });
    }
  });

  effects.register("transmute", (state, pid) => {
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    const trashed = p.hand[asked];
    primitives.trash(state, pid, { index: asked });
    if (isType(trashed, "Action")) {
      if (zones.supplyCount(state, "duchy") > 0) primitives.gain(state, pid, "duchy");
    } else if (isType(trashed, "Treasure")) {
      if (zones.supplyCount(state, "transmute") > 0) primitives.gain(state, pid, "transmute");
    } else if (isType(trashed, "Victory")) {
      if (zones.supplyCount(state, "gold") > 0) primitives.gain(state, pid, "gold");
    }
  });

  effects.register("university", (state, pid) => {
    apply(state, pid, { actions: 2 });
    const maxCost = 5;
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && isType(id, "Action") && costCoins(id) <= maxCost && costPotion(id) === 0);
    if (!pickable.length) return;
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
  });

  /* ══════ Prosperity basics: Colony + Platinum (effects later) ════ */
  effects.register("colony", (state, pid) => {});
  effects.register("platinum", (state, pid) => {});

  /* ═══════════════════════════════════════════════════════════════
     PROSPERITY (2nd Edition) — VP tokens + all 25 kingdom cards
     (data in src/data/prosperity.json)
     ═══════════════════════════════════════════════════════════════ */
  function addVpTokens(state, playerId, n) {
    const p = player(state, playerId);
    p.vpTokens = Math.max(0, (p.vpTokens || 0) + n);
    state.log.push({ t: "vp", player: playerId, delta: n, total: p.vpTokens });
    return p.vpTokens;
  }
  engine.addVpTokens = addVpTokens;

  effects.register("anvil", (state, pid) => {
    const p = player(state, pid);
    const treasureIdx = p.hand.map((id, i) => ({ id, i })).filter((o) => isType(o.id, "Treasure")).map((o) => o.i);
    const asked = safeDecide(state, { type: "anvilDiscard", player: pid, hand: p.hand.slice(), options: treasureIdx.slice() });
    if (Number.isInteger(asked) && treasureIdx.indexOf(asked) !== -1) {
      const discarded = p.hand[asked];
      primitives.discard(state, pid, [asked]);
      const maxCost = 4;
      const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= maxCost && costPotion(id) === 0);
      const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
      if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
      state.log.push({ t: "anvil", player: pid, discarded: discarded, gained: choice });
    }
  });

  effects.register("bank", (state, pid) => {
    const p = player(state, pid);
    const n = p.play.filter((id) => isType(id, "Treasure")).length;
    addResource(state, pid, "coins", n);
  });

  effects.register("bishop", (state, pid) => {
    apply(state, pid, { coins: 1 });
    addVpTokens(state, pid, 1);
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) {
      const trashed = p.hand[asked];
      primitives.trash(state, pid, { index: asked });
      addVpTokens(state, pid, Math.floor(costCoins(trashed) / 2));
    }
    for (const other of state.players) {
      if (other.id === pid) continue;
      if (other.hand.length === 0) continue;
      const asked2 = safeDecide(state, { type: "trashAny", player: other.id, hand: other.hand.slice() });
      if (Number.isInteger(asked2) && asked2 >= 0 && asked2 < other.hand.length) {
        primitives.trash(state, other.id, { index: asked2 });
      }
    }
  });

  effects.register("charlatan", (state, pid) => {
    apply(state, pid, { coins: 2 });
    attack.dispatch(state, pid, "charlatan", (s, t) => {
      if (zones.supplyCount(s, "curse") > 0) primitives.gain(s, t, "curse");
    });
  });

  effects.register("city", (state, pid) => {
    apply(state, pid, { cards: 1, actions: 2 });
    const empties = Object.keys(state.supply).filter((k) => state.supply[k] === 0).length;
    if (empties >= 1) apply(state, pid, { cards: 1 });
    if (empties >= 2) apply(state, pid, { buys: 1, coins: 1 });
  });

  effects.register("clerk", (state, pid) => {
    apply(state, pid, { coins: 2 });
    attack.dispatch(state, pid, "clerk", (s, t) => {
      const p = player(s, t);
      if (p.hand.length < 5) return;
      const asked = safeDecide(s, { type: "topdeckTop", player: t, attack: "clerk", hand: p.hand.slice() });
      if (Number.isInteger(asked) && asked >= 0 && asked < p.hand.length) {
        const id = p.hand.splice(asked, 1)[0];
        p.deck.push(id);
        state.log.push({ t: "clerkTopdeck", player: t, card: id });
      }
    });
  });
  triggers.register("clerk", {
    onTurnStart(state, pid) {
      const p = player(state, pid);
      const idx = p.hand.indexOf("clerk");
      if (idx === -1) return;
      const yes = safeDecide(state, { type: "clerkPlay", player: pid });
      if (yes === true) {
        zones.move(state, loc(pid, "hand"), loc(pid, "play"), { index: idx });
        effects.resolve(state, pid, "clerk", { cardId: "clerk" });
        state.log.push({ t: "clerkPlay", player: pid });
      }
    }
  });

  effects.register("collection", (state, pid) => {
    apply(state, pid, { buys: 1 });
    player(state, pid).collectionActive = true;
  });

  effects.register("crystal_ball", (state, pid) => {
    const p = player(state, pid);
    const top = p.deck[p.deck.length - 1];
    if (top == null) return;
    const mode = safeDecide(state, { type: "crystalBallUse", player: pid, card: top, options: ["trash", "discard", "play"] });
    if (mode === "trash") zones.move(state, loc(pid, "deck"), zoneRef.trash, { fromTop: true });
    else if (mode === "discard") zones.move(state, loc(pid, "deck"), loc(pid, "discard"), { fromTop: true });
    else if (mode === "play" && (isType(top, "Action") || isType(top, "Treasure"))) {
      zones.move(state, loc(pid, "deck"), loc(pid, "play"), { fromTop: true });
      effects.resolve(state, pid, top, { cardId: top });
      fireTrigger("play", state, pid, { cardId: top });
    }
  });

  effects.register("expand", (state, pid) => {
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    const trashed = p.hand[asked];
    primitives.trash(state, pid, { index: asked });
    const maxCost = costCoins(trashed) + 3;
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= maxCost && costPotion(id) === 0);
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
  });

  effects.register("forge", (state, pid) => {
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashUpTo", player: pid, max: p.hand.length, hand: p.hand.slice() });
    const chosen = [];
    if (Array.isArray(asked)) for (const i of asked) if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
    chosen.sort((a, b) => b - a);
    let totalCoins = 0;
    let totalPotion = 0;
    for (const i of chosen) {
      totalCoins += costCoins(p.hand[i]);
      totalPotion += costPotion(p.hand[i]);
      primitives.trash(state, pid, { index: i });
    }
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) === totalCoins && costPotion(id) === totalPotion);
    const choice = primitives.choose(state, pid, { type: "gainCard", totalCost: totalCoins, totalPotion: totalPotion }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
  });

  effects.register("grand_market", (state, pid) => apply(state, pid, { cards: 1, actions: 1, buys: 1, coins: 2 }));

  effects.register("hoard", (state, pid) => {
    player(state, pid).hoardActive = true;
  });

  effects.register("investment", (state, pid) => {
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "trashAny", player: pid, hand: p.hand.slice() });
    if (!Number.isInteger(asked) || asked < 0 || asked >= p.hand.length) return;
    primitives.trash(state, pid, { index: asked });
    const mode = safeDecide(state, { type: "investmentMode", player: pid, options: ["coins", "reveal"] });
    if (mode === "reveal") {
      const idx = p.play.indexOf("investment");
      if (idx !== -1) {
        p.play.splice(idx, 1);
        state.trash.push("investment");
        state.log.push({ t: "trash", player: pid, card: "investment" });
      }
      const named = new Set(p.hand.filter((id) => isType(id, "Treasure")));
      addResource(state, pid, "coins", named.size);
    } else {
      addResource(state, pid, "coins", 2);
    }
  });

  effects.register("kings_court", (state, pid) => {
    const p = player(state, pid);
    const actions = p.hand.map((id, i) => ({ id, i })).filter((o) => isType(o.id, "Action")).map((o) => o.i);
    if (!actions.length) return;
    const asked = safeDecide(state, { type: "playActionThrice", player: pid, hand: p.hand.slice(), options: actions.slice() });
    if (!Number.isInteger(asked) || actions.indexOf(asked) === -1) return;
    const id = p.hand[asked];
    const idx = p.hand.indexOf(id);
    zones.move(state, loc(pid, "hand"), loc(pid, "play"), { index: idx });
    for (let i = 0; i < 3; i++) {
      player(state, pid).actionsPlayed++;
      effects.resolve(state, pid, id, { cardId: id, index: idx });
      state.log.push({ t: "playAction", player: pid, card: id });
      hooks.emit("actionPlayed", { player: pid, cardId: id });
      fireTrigger("play", state, pid, { cardId: id, index: idx });
    }
    state.log.push({ t: "kingsCourt", player: pid, card: id, times: 3 });
  });

  effects.register("magnate", (state, pid) => {
    const p = player(state, pid);
    const treasures = p.hand.filter((id) => isType(id, "Treasure")).length;
    primitives.reveal(state, pid, p.hand.slice());
    if (treasures > 0) zones.draw(state, pid, treasures);
  });

  effects.register("mint", (state, pid) => {
    const p = player(state, pid);
    const treasureIdx = p.hand.map((id, i) => ({ id, i })).filter((o) => isType(o.id, "Treasure")).map((o) => o.i);
    if (!treasureIdx.length) return;
    const asked = safeDecide(state, { type: "mintCopy", player: pid, hand: p.hand.slice(), options: treasureIdx.slice() });
    if (Number.isInteger(asked) && treasureIdx.indexOf(asked) !== -1) {
      const id = p.hand[asked];
      primitives.reveal(state, pid, id);
      if (zones.supplyCount(state, id) > 0) primitives.gain(state, pid, id);
    }
  });
  triggers.register("mint", {
    onGain(state, pid) {
      const p = player(state, pid);
      const trashed = [];
      for (const id of p.play.slice()) {
        if (isType(id, "Treasure") && !isType(id, "Duration")) {
          const idx = p.play.indexOf(id);
          p.play.splice(idx, 1);
          state.trash.push(id);
          trashed.push(id);
        }
      }
      if (trashed.length) state.log.push({ t: "mintTrash", player: pid, cards: trashed });
    }
  });

  effects.register("monument", (state, pid) => {
    apply(state, pid, { coins: 2 });
    addVpTokens(state, pid, 1);
  });

  effects.register("peddler", (state, pid) => apply(state, pid, { cards: 1, actions: 1, coins: 1 }));

  effects.register("quarry", (state, pid) => { player(state, pid).quarryActive = true; });

  effects.register("rabble", (state, pid) => {
    apply(state, pid, { cards: 3 });
    attack.dispatch(state, pid, "rabble", (s, t) => {
      const p = player(s, t);
      const looked = [];
      for (let i = 0; i < 3 && p.deck.length; i++) looked.push(p.deck.pop());
      if (!looked.length) return;
      const keep = [];
      for (const id of looked) {
        if (isType(id, "Action") || isType(id, "Treasure")) p.discard.push(id);
        else keep.push(id);
      }
      for (const id of keep) p.deck.push(id);
      state.log.push({ t: "rabble", player: t, revealed: looked.slice(), kept: keep.slice() });
    });
  });

  effects.register("tiara", (state, pid) => {
    apply(state, pid, { buys: 1 });
    const p = player(state, pid);
    p.tiaraActive = true;
    const treasureIdx = p.hand.map((id, i) => ({ id, i })).filter((o) => isType(o.id, "Treasure")).map((o) => o.i);
    const asked = safeDecide(state, { type: "tiaraDouble", player: pid, hand: p.hand.slice(), options: treasureIdx.slice() });
    if (Number.isInteger(asked) && treasureIdx.indexOf(asked) !== -1) {
      const id = p.hand[asked];
      p.hand.splice(asked, 1);
      p.play.push(id);
      state.log.push({ t: "tiaraDouble", player: pid, card: id });
      if (id === "potion") addResource(state, pid, "potions", 2);
      else if (id === "philosophers_stone") addResource(state, pid, "coins", 2 * Math.floor((p.deck.length + p.discard.length) / 5));
      else {
        addResource(state, pid, "coins", (treasureValue(id) || 0) * 2);
        effects.resolve(state, pid, id, { cardId: id });
        effects.resolve(state, pid, id, { cardId: id });
      }
    }
  });

  effects.register("vault", (state, pid) => {
    apply(state, pid, { cards: 2 });
    const p = player(state, pid);
    const asked = safeDecide(state, { type: "vaultDiscard", player: pid, hand: p.hand.slice() });
    const chosen = [];
    if (Array.isArray(asked)) for (const i of asked) if (Number.isInteger(i) && i >= 0 && i < p.hand.length && chosen.indexOf(i) === -1) chosen.push(i);
    primitives.discard(state, pid, chosen);
    addResource(state, pid, "coins", chosen.length);
    for (const other of state.players) {
      if (other.id === pid) continue;
      if (other.hand.length < 2) continue;
      const yes = safeDecide(state, { type: "vaultOpp", player: other.id, attack: "vault" });
      if (yes === true) {
        const idx = other.hand.map((id, i) => ({ id, i })).sort((a, b) => costCoins(a.id) - costCoins(b.id)).map((o) => o.i).slice(0, 2);
        primitives.discard(state, other.id, idx);
        zones.draw(state, other.id, 1);
      }
    }
  });

  effects.register("war_chest", (state, pid) => {
    const left = nextPlayer(state, pid);
    const nameable = Object.keys(state.supply).filter((id) => state.supply[id] > 0);
    const named = safeDecide(state, { type: "warChestName", player: left, options: nameable });
    const banned = (player(state, pid).warChestNamed || []).slice();
    if (named && banned.indexOf(named) === -1) banned.push(named);
    player(state, pid).warChestNamed = banned;
    const maxCost = 5;
    const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && costCoins(id) <= maxCost && costPotion(id) === 0 && banned.indexOf(id) === -1);
    const choice = primitives.choose(state, pid, { type: "gainCard", maxCost: maxCost }, pickable);
    if (pickable.indexOf(choice) !== -1) primitives.gain(state, pid, choice);
  });

  effects.register("watchtower", (state, pid) => {
    const p = player(state, pid);
    while (p.hand.length < 6) {
      if (p.deck.length === 0 && p.discard.length === 0) break;
      zones.draw(state, pid, 1);
    }
  });

  effects.register("workers_village", (state, pid) => apply(state, pid, { cards: 1, actions: 2, buys: 1 }));

  const primitives = {
    gain(state, playerId, cardId, opts) {
      const moved = zones.gain(state, playerId, cardId, opts);
      fireTrigger("gain", state, playerId, Object.assign({ cardId: cardId }, opts || {}));
      afterGain(state, playerId, cardId);
      return moved;
    },
    trash(state, playerId, opts) {
      opts = opts || {};
      const from = opts.from || loc(playerId, "hand");
      const moved = zones.move(state, from, zoneRef.trash, opts);
      fireTrigger("trash", state, playerId, Object.assign({ cardId: moved }, opts));
      return moved;
    },
    reveal(state, playerId, cardIds) {
      const list = Array.isArray(cardIds) ? cardIds : [cardIds];
      const shown = [];
      const owned = playerCards(state, playerId);
      for (const id of list) {
        if (owned.indexOf(id) === -1) throw new Error("cannot reveal a card the player does not own: " + id);
        shown.push(id);
        state.log.push({ t: "reveal", player: playerId, card: id });
        fireTrigger("reveal", state, playerId, { cardId: id });
      }
      return shown;
    },
    topdeck(state, playerId, cardId, opts) {
      opts = opts || {};
      const from = opts.from || loc(playerId, "hand");
      return zones.move(state, from, loc(playerId, "deck"), Object.assign({ cardId: cardId }, opts));
    },
    discard(state, playerId, indices) {
      const p = player(state, playerId);
      const list = Array.isArray(indices) ? indices : [indices];
      const idx = [];
      for (const i of list) {
        if (Number.isInteger(i) && i >= 0 && i < p.hand.length && idx.indexOf(i) === -1) idx.push(i);
      }
      idx.sort((a, b) => b - a);
      const discarded = [];
      for (const i of idx) discarded.push(zones.move(state, loc(playerId, "hand"), loc(playerId, "discard"), { index: i }));
      fireTrigger("discard", state, playerId, { cardIds: discarded });
      return discarded;
    },
    playAnother(state, playerId, opts) {
      return playAction(state, playerId, Object.assign({}, opts, { charge: false }));
    },
    choose(state, playerId, prompt, options) {
      const out = safeDecide(state, Object.assign({ player: playerId, options: options }, prompt));
      if (out == null) return null;
      if (!Array.isArray(options)) return out;
      if (Array.isArray(out)) return out.filter((o) => options.indexOf(o) !== -1);
      return options.indexOf(out) !== -1 ? out : null;
    }
  };
  engine.primitives = primitives;

})(typeof self !== "undefined" ? self : globalThis);
