/* ══════════════════════════════════════════════════════════════════
   ALL ABOARD! — game engine core (Tasks 2–22: state model, validators,
   state machine, NA map, seeded PRNG, train-card deck, face-up row,
   destination-ticket deck, ticket draw routine, hand integrity, turn
   actions, ticket completion detection, longest-path bonus, final
   scoring & winner resolution, AI opponent policies, full-game
   integration tests)
   Loaded via <script src="src/game-core.js"> before the app script.
   Exposes window.TtR. Later tasks extend this module (rendering,
   online).

   Rule facts pinned from the official rulebook (Days of Wonder 2004):
   - 110 Train Car cards = 12 each of the 8 types (purple, blue,
     orange, white, green, yellow, black, red) + 14 Locomotives.
   - The 8 card types match the 8 route colors on the board; gray
     routes accept any single color.
   - Setup: deal 4 train cards each; deal 3 destination tickets and
     keep at least two (mid-game draws keep at least one).
   - Face-up locomotive: taking it limits the turn to 1 card; a loco
     revealed as a replacement can't be taken immediately; if 3 of
     the 5 face-up cards are locos, discard all 5 and replace.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ── constants ────────────────────────────────────────────────────
  var COLORS = ["purple", "blue", "orange", "white", "green", "yellow", "black", "red"];
  var LOCOMOTIVE = "locomotive";
  var CARD_TYPES = COLORS.concat([LOCOMOTIVE]); // 9 types: 8 route colors + locomotive
  var TRAIN_CARDS_PER_COLOR = 12;
  var LOCO_COUNT = 14;
  var TOTAL_TRAIN_CARDS = 110; // official: 8×12 + 14
  var TRAINS_START = 45;       // train pieces per player
  var PLAYER_MIN = 2;
  var PLAYER_MAX = 5;
  var FACEUP_SIZE = 5;
  var PHASES = ["setup", "playing", "gameOver"];
  var SUBSTATES = ["chooseAction", "drawingCards", "claimingRoute", "drawingTickets"];
  var TICKET_STATES = ["unstarted", "connected", "complete"];
  var LONGEST_PATH_BONUS = 10;   // official longest-continuous-path bonus
  // render colors for each player's train pieces (index by colorIndex)
  var PLAYER_COLORS = ["#e23b3b", "#2f6fd6", "#2fae8c", "#e0a53a", "#8b5cf6"];

  // ── helpers ──────────────────────────────────────────────────────
  function fail(msg) { throw new Error("TtR state invalid: " + msg); }
  function reject(msg) { throw new Error("TtR transition rejected: " + msg); }
  function isStr(s) { return typeof s === "string" && s.length > 0; }
  function isNum(n) { return typeof n === "number" && isFinite(n); }

  // ── seeded deterministic PRNG (Task 5) ───────────────────────────
  // mulberry32 (D. Lemire): small, fast, high-quality 32-bit PRNG.
  // The game's own randomness lives in `state.rng.state`, so every
  // random decision is part of the serialized state and any game
  // replays identically given the same seed.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // rng methods bound to a live {state: uint32} holder object.
  function makeRng(holder) {
    return {
      next: function () {           // float in [0, 1)
        holder.state = ((holder.state + 0x6D2B79F5) | 0) >>> 0;  // keep the uint32 state unsigned
        var t = Math.imul(holder.state ^ (holder.state >>> 15), 1 | holder.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int: function (n) { return Math.floor(this.next() * n); },  // [0, n)
      pick: function (arr) { return arr[this.int(arr.length)]; },
      shuffle: function (arr) {    // in-place Fisher-Yates
        for (var i = arr.length - 1; i > 0; i--) {
          var j = this.int(i + 1), tmp = arr[i];
          arr[i] = arr[j];
          arr[j] = tmp;
        }
        return arr;
      }
    };
  }

  // Standalone RNG (not attached to a game state) — for tests/utility.
  function createRng(seed) { return makeRng({ state: seed >>> 0 }); }
  // RNG bound to a live game state: advances state.rng.state so the
  // whole game remains serializable and replayable from its seed.
  function gameRng(state) { return makeRng(state.rng); }

  // ── factory: a brand-new, structurally valid skeleton state ─────
  // House-rule options (Task 44), all defaulting to the official game:
  function mergeRules(opt) {
    var r = {
      allowDoubleFor23: false,  // parallel double-route pairs usable with 2–3 players
      endTrains: 2,             // end-game trigger: a player at ≤ this many trains
      startTickets: 2           // opening deal keeps at least this many of 3 tickets
    };
    if (opt && typeof opt === "object") {
      if (typeof opt.allowDoubleFor23 === "boolean") r.allowDoubleFor23 = opt.allowDoubleFor23;
      if ([0, 1, 2].indexOf(opt.endTrains) !== -1) r.endTrains = opt.endTrains;
      if ([2, 3].indexOf(opt.startTickets) !== -1) r.startTickets = opt.startTickets;
    }
    return r;
  }
  function createState(opts) {
    opts = opts || {};
    var names = (Array.isArray(opts.players) && opts.players.length > 0)
      ? opts.players
      : [{ name: "Player 1" }, { name: "Player 2" }];
    var seed = isNum(opts.seed) ? opts.seed : Math.floor(Math.random() * 0x7fffffff);
    var players = names.map(function (p, i) {      return {
        id: i,
        name: String((p && p.name) || ("Player " + (i + 1))),
        kind: (p && p.kind === "ai") ? "ai" : "human",
        role: (p && p.role) || null, // "host" | "guest" | null (online only)
        colorIndex: i % PLAYER_COLORS.length,
        trains: TRAINS_START,
        hand: { purple: 0, blue: 0, orange: 0, white: 0, green: 0, yellow: 0, black: 0, red: 0, locomotive: 0 },
        score: 0,
        routePoints: 0,       // points from claimed routes (kept separate from tickets)
        claimedRoutes: [],    // route ids (catalog in state.routes, Task 4)
        ticketIds: [],        // ticket ids (catalog in state.tickets, Task 8)
        ticketState: {},      // ticketId -> "unstarted" | "connected" | "complete" (Tasks 16/18)
        longestPathPoints: 0  // 10 if this player owns the longest path (Task 17)
      };
    });
    return {
      version: 1,
      seed: seed,
      rng: { seed: seed >>> 0, state: seed >>> 0 },   // live seeded-PRNG state (Task 5)
      phase: "setup",
      players: players,
      rules: mergeRules(opts.rules),
      turn: {
        active: 0,          // index into players
        count: 0,           // completed turns so far (incremented when a turn ends)
        substate: "chooseAction",
        cardsDrawn: 0,      // cards drawn by the active player this turn (0..2)
        locoLock: false,    // true = a face-up locomotive was taken this turn → only 1 card allowed
        claimedRouteId: null // route claimed by the current claimingRoute action (Task 11)
      },
      decks: {
        train: { draw: [], discard: [] },    // draw pile (top = last element)
        tickets: { draw: [], discard: [] }   // ticket ids
      },
      pendingTickets: [],    // tickets drawn and awaiting a keep/discard decision (Task 9)
      faceUp: [],            // exactly FACEUP_SIZE card types while playing
      faceUpFresh: [],       // parallel to faceUp: slot revealed this turn (fresh loco can't be taken)
      faceUpStuck: false,    // true when flushing couldn't converge (all-loco deck tail); row stays ≥3 locos
      routes: JSON.parse(JSON.stringify(MAP.routes)),  // routeId -> {a, b, color, length} (Task 4)
      tickets: JSON.parse(JSON.stringify(TICKET_CATALOG)),  // ticketId -> {a, b, value}
      gameEnd: {
        triggered: false,          // set when a player ends a turn with ≤2 trains
        triggerPlayerId: null,
        stopAtTurnCount: null,     // final turn count at which play halts (fair round)
        winnerId: null,            // set when phase === "gameOver"
        winnerIds: null,           // all tied winners (shared victory), set by final scoring
        reason: null,              // "score" | "resign" | "forfeit"
        breakdown: null,           // per-player final score breakdown (Task 18)
        longestPath: null          // {lengths, best, winnerIds} computed at end (Task 17)
      },
      log: []                // {turn, playerId, action, detail}
    };
  }

  // ── deep invariant validator ─────────────────────────────────────
  // Throws on any violation; returns state on success. Structural +
  // counting rules only — scoring formulas and legality-of-move live in
  // the action tasks (12/13/18); this guarantees state never *becomes*
  // structurally illegal.
  function assertState(state) {
    if (!state || typeof state !== "object") fail("state is not an object");
    if (state.version !== 1) fail("unsupported version " + state.version);
    if (!state.rng || !isNum(state.rng.seed) || !isNum(state.rng.state) || state.rng.state < 0)
      fail("rng state missing/invalid");
    if (PHASES.indexOf(state.phase) === -1) fail("bad phase '" + state.phase + "'");

    var players = state.players;
    if (!Array.isArray(players)) fail("players is not an array");
    if (players.length < PLAYER_MIN || players.length > PLAYER_MAX)
      fail("players must be " + PLAYER_MIN + ".." + PLAYER_MAX + ", got " + players.length);

    // catalogs
    if (!state.routes || typeof state.routes !== "object") fail("routes catalog missing");
    if (!state.tickets || typeof state.tickets !== "object") fail("tickets catalog missing");

    var routeOwners = new Map();
    var ticketOwners = new Map();
    var heldTickets = new Set();
    var totalCards = 0;

    // face-up row
    if (!Array.isArray(state.faceUp)) fail("faceUp is not an array");
    if (state.faceUp.length !== FACEUP_SIZE && state.phase !== "setup")
      fail("faceUp must have " + FACEUP_SIZE + " cards while playing, got " + state.faceUp.length);
    state.faceUp.forEach(function (c) {
      if (CARD_TYPES.indexOf(c) === -1) fail("bad faceUp card '" + c + "'");
    });
    if (!Array.isArray(state.faceUpFresh)) fail("faceUpFresh is not an array");
    if (state.faceUpFresh.length !== state.faceUp.length) fail("faceUpFresh must be parallel to faceUp");
    state.faceUpFresh.forEach(function (f) { if (typeof f !== "boolean") fail("bad faceUpFresh flag"); });
    if (typeof state.faceUpStuck !== "boolean") fail("faceUpStuck must be a boolean");
    if (state.faceUp.length === FACEUP_SIZE && locoCount(state.faceUp) >= 3 && !state.faceUpStuck)
      fail("face-up row has " + locoCount(state.faceUp) + " locomotives (3+ must be flushed)");
    totalCards += state.faceUp.length;

    // house rules (Task 44)
    if (!state.rules || typeof state.rules !== "object") fail("rules object missing");
    if (typeof state.rules.allowDoubleFor23 !== "boolean") fail("rules.allowDoubleFor23 must be boolean");
    if ([0, 1, 2].indexOf(state.rules.endTrains) === -1) fail("rules.endTrains must be 0, 1 or 2");
    if ([2, 3].indexOf(state.rules.startTickets) === -1) fail("rules.startTickets must be 2 or 3");

    // players
    players.forEach(function (pl) {
      if (!pl || typeof pl !== "object") fail("player entry is not an object");
      if (!isNum(pl.id) || pl.id < 0 || pl.id >= players.length) fail("player '" + pl.name + "' bad id");
      if (!isNum(pl.trains) || pl.trains < 0 || pl.trains > TRAINS_START)
        fail("player '" + pl.name + "' trains out of range: " + pl.trains);
      if (!isNum(pl.score)) fail("player '" + pl.name + "' bad score " + pl.score);
      if (!isNum(pl.routePoints) || pl.routePoints < 0) fail("player '" + pl.name + "' bad routePoints");
      if (!isNum(pl.longestPathPoints) || pl.longestPathPoints < 0 || pl.longestPathPoints > LONGEST_PATH_BONUS)
        fail("player '" + pl.name + "' bad longestPathPoints " + pl.longestPathPoints);
      if (pl.kind !== "human" && pl.kind !== "ai") fail("player '" + pl.name + "' bad kind '" + pl.kind + "'");

      if (!pl.hand || typeof pl.hand !== "object") fail("player '" + pl.name + "' hand missing");
      var handKeys = Object.keys(pl.hand).sort().join(",");
      if (handKeys !== CARD_TYPES.slice().sort().join(","))
        fail("player '" + pl.name + "' hand keys mismatch: " + handKeys);
      var handTotal = 0;
      CARD_TYPES.forEach(function (t) {
        var n = pl.hand[t];
        if (!isNum(n) || n < 0) fail("player '" + pl.name + "' hand." + t + " invalid: " + n);
        handTotal += n;
      });
      totalCards += handTotal;

      if (!Array.isArray(pl.claimedRoutes)) fail("player '" + pl.name + "' claimedRoutes not an array");
      pl.claimedRoutes.forEach(function (rid) {
        if (!isStr(rid)) fail("player '" + pl.name + "' bad route id");
        if (!state.routes[rid]) fail("route '" + rid + "' is not in the map catalog");
        if (routeOwners.has(rid)) fail("route '" + rid + "' claimed by two players");
        routeOwners.set(rid, pl.id);
      });

      if (!Array.isArray(pl.ticketIds)) fail("player '" + pl.name + "' ticketIds not an array");
      pl.ticketIds.forEach(function (tid) {
        if (!isStr(tid)) fail("player '" + pl.name + "' bad ticket id");
        if (ticketOwners.has(tid)) fail("ticket '" + tid + "' held by two players");
        ticketOwners.set(tid, pl.id);
        heldTickets.add(tid);
        if (!state.tickets[tid]) fail("ticket '" + tid + "' not in catalog");
        if (TICKET_STATES.indexOf(pl.ticketState[tid]) === -1)
          fail("ticket '" + tid + "' has bad state '" + pl.ticketState[tid] + "'");
      });
      // ticketState must not reference unknown tickets
      Object.keys(pl.ticketState || {}).forEach(function (tid) {
        if (pl.ticketIds.indexOf(tid) === -1) fail("player '" + pl.name + "' ticketState key '" + tid + "' not in ticketIds");
      });
    });

    // train deck + discard
    if (!state.decks || !state.decks.train || !state.decks.tickets) fail("decks structure missing");
    var trainPile = state.decks.train.draw.concat(state.decks.train.discard);
    trainPile.forEach(function (c) { if (CARD_TYPES.indexOf(c) === -1) fail("bad train deck card '" + c + "'"); });
    totalCards += trainPile.length;

    // ticket deck + discard (ids must exist in catalog, never duplicate,
    // and never overlap a player's hand)
    var deckTickets = new Set();
    state.decks.tickets.draw.concat(state.decks.tickets.discard).forEach(function (tid) {
      if (!isStr(tid)) fail("bad ticket id in deck");
      if (!state.tickets[tid]) fail("ticket '" + tid + "' in deck but not in catalog");
      if (deckTickets.has(tid)) fail("ticket '" + tid + "' duplicated in the ticket deck");
      if (heldTickets.has(tid)) fail("ticket '" + tid + "' is both in the deck and in a player's hand");
      deckTickets.add(tid);
    });
    // pending tickets (a draw awaiting its keep/discard decision)
    if (!Array.isArray(state.pendingTickets)) fail("pendingTickets is not an array");
    var pendingSeen = new Set();
    state.pendingTickets.forEach(function (tid) {
      if (!isStr(tid)) fail("bad pending ticket id");
      if (!state.tickets[tid]) fail("pending ticket '" + tid + "' not in catalog");
      if (pendingSeen.has(tid) || deckTickets.has(tid) || heldTickets.has(tid))
        fail("pending ticket '" + tid + "' duplicated or overlapping deck/hand");
      pendingSeen.add(tid);
    });
    if (state.pendingTickets.length > 0 && state.phase === "playing" && state.turn.substate !== "drawingTickets")
      fail("pending tickets require the drawingTickets substate");

    // card conservation: once any cards exist, the total must be exactly the full deck
    if (totalCards > 0 && totalCards !== TOTAL_TRAIN_CARDS)
      fail("card conservation broken: total " + totalCards + " != " + TOTAL_TRAIN_CARDS);

    // turn
    var turn = state.turn;
    if (!turn || typeof turn !== "object") fail("turn missing");
    if (!isNum(turn.active) || turn.active < 0 || turn.active >= players.length) fail("bad active player " + turn.active);
    if (SUBSTATES.indexOf(turn.substate) === -1) fail("bad substate '" + turn.substate + "'");
    if (!isNum(turn.count) || turn.count < 0) fail("bad turn count " + turn.count);
    if (!isNum(turn.cardsDrawn) || turn.cardsDrawn < 0 || turn.cardsDrawn > 2) fail("cardsDrawn out of range");
    if (turn.locoLock && turn.cardsDrawn > 1) fail("locomotive lock violated (drew " + turn.cardsDrawn + " cards)");
    if (turn.claimedRouteId != null && !state.routes[turn.claimedRouteId])
      fail("bad claimedRouteId '" + turn.claimedRouteId + "'");

    // game-end block
    var ge = state.gameEnd || {};
    if (ge.triggered && state.phase === "setup") fail("gameEnd triggered during setup");
    if (ge.triggered && !isNum(ge.triggerPlayerId)) fail("gameEnd triggered without triggerPlayerId");
    if (ge.triggerPlayerId != null && (ge.triggerPlayerId < 0 || ge.triggerPlayerId >= players.length)) fail("bad triggerPlayerId");
    if (ge.stopAtTurnCount != null && !isNum(ge.stopAtTurnCount)) fail("bad stopAtTurnCount");
    if (ge.longestPath != null) {
      var lp = ge.longestPath;
      if (!Array.isArray(lp.lengths) || lp.lengths.length !== players.length)
        fail("longestPath.lengths must match the player count");
      lp.lengths.forEach(function (len) { if (!isNum(len) || len < 0) fail("bad longestPath length " + len); });
      if (!isNum(lp.best) || lp.best < 0) fail("bad longestPath.best " + lp.best);
      if (!Array.isArray(lp.winnerIds)) fail("longestPath.winnerIds must be an array");
      lp.winnerIds.forEach(function (pid) {
        if (!isNum(pid) || pid < 0 || pid >= players.length) fail("bad longestPath winnerId " + pid);
        if (lp.lengths[pid] !== lp.best) fail("longestPath winner " + pid + " does not match best length");
      });
    }
    if (state.phase === "gameOver") {
      if (ge.winnerId == null) fail("gameOver without winnerId");
      if (ge.winnerId < 0 || ge.winnerId >= players.length) fail("bad winnerId " + ge.winnerId);
      if (ge.reason !== "score" && ge.reason !== "resign" && ge.reason !== "forfeit") fail("bad gameOver reason '" + ge.reason + "'");
      if (ge.breakdown != null) {
        var bd = ge.breakdown;
        if (!Array.isArray(bd.players) || bd.players.length !== players.length) fail("bad breakdown.players");
        if (!Array.isArray(bd.winners) || bd.winners.length === 0) fail("bad breakdown.winners");
        bd.players.forEach(function (bp) {
          if (!isNum(bp.playerId) || bp.playerId < 0 || bp.playerId >= players.length) fail("bad breakdown player id");
          if (!isNum(bp.routePoints) || !isNum(bp.ticketPoints) || !isNum(bp.longestPathPoints) || !isNum(bp.total))
            fail("bad breakdown totals for player " + bp.playerId);
        });
        if (bd.winners.indexOf(ge.winnerId) === -1) fail("gameEnd.winnerId not among breakdown winners");
      }
      if (ge.winnerIds != null) {
        if (!Array.isArray(ge.winnerIds) || ge.winnerIds.length === 0) fail("bad winnerIds");
        ge.winnerIds.forEach(function (pid) {
          if (!isNum(pid) || pid < 0 || pid >= players.length) fail("bad winnerId " + pid);
        });
        if (ge.winnerIds.indexOf(ge.winnerId) === -1) fail("gameEnd.winnerId not in winnerIds");
      }
    }

    if (!Array.isArray(state.log)) fail("log is not an array");
    state.log.forEach(function (entry) {
      if (!entry || (entry.playerId !== null && !isNum(entry.playerId)) || typeof entry.action !== "string") fail("bad log entry");
    });

    return state;
  }

  // ── mutation gate: every change to the state goes through here ──
  function mutate(state, label, fn) {
    try { assertState(state); }
    catch (e) { throw new Error("mutation '" + label + "' entered with an invalid state: " + (e && e.message ? e.message : e)); }
    var out;
    try {
      out = fn(state);
    } catch (e) {
      throw new Error("mutation '" + label + "' failed: " + (e && e.message ? e.message : e));
    }
    try { assertState(state); }
    catch (e) { throw new Error("mutation '" + label + "' left an invalid state: " + (e && e.message ? e.message : e)); }
    return out;
  }

  // ── serialization ────────────────────────────────────────────────
  function toJSON(state) { return JSON.stringify(state); }
  function fromJSON(json) { var s = JSON.parse(json); return assertState(s); }
  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }

  // Compact form for online snapshots (Task 34): every MUTABLE piece of
  // state but not the static catalogs (routes/tickets/version are
  // rebuilt locally on each client, cutting the payload ~5x so it fits
  // the room slot). Both clients run the same engine, so the rebuilt
  // catalogs are identical. The acting player's snapshot is the
  // authoritative shared state for both clients.
  function compactState(state) {
    return {
      version: state.version,
      phase: state.phase,
      seed: state.seed,
      rng: state.rng,
      players: state.players,
      rules: state.rules,
      turn: state.turn,
      decks: state.decks,
      pendingTickets: state.pendingTickets,
      faceUp: state.faceUp,
      faceUpFresh: state.faceUpFresh,
      faceUpStuck: state.faceUpStuck,
      gameEnd: state.gameEnd
    };
  }
  function toCompact(state) { return JSON.stringify(compactState(state)); }
  function rehydrateCompact(o) {
    var map = buildNorthAmericaMap();
    var st = {
      version: o.version,
      phase: o.phase,
      seed: o.seed,
      rng: o.rng,
      players: o.players,
      rules: mergeRules(o.rules),
      turn: o.turn,
      decks: o.decks,
      pendingTickets: o.pendingTickets,
      faceUp: o.faceUp,
      faceUpFresh: o.faceUpFresh,
      faceUpStuck: !!o.faceUpStuck,
      routes: JSON.parse(JSON.stringify(map.routes)),
      tickets: JSON.parse(JSON.stringify(ticketCatalog(map.tickets))),
      gameEnd: o.gameEnd,
      log: []
    };
    return assertState(st);
  }
  function fromCompact(json) { return rehydrateCompact(JSON.parse(json)); }

  // ── test fixtures (shared by the test suites) ────────────────────
  // Build the official 110-card deck in fixed composition order.
  function buildTrainDeck() {
    var deck = [];
    CARD_TYPES.forEach(function (c) {
      var n = (c === LOCOMOTIVE) ? LOCO_COUNT : TRAIN_CARDS_PER_COLOR;
      for (var i = 0; i < n; i++) deck.push(c);
    });
    return deck;
  }
  // A setup-complete state: 5 face-up + 4 starting cards per player,
  // still in phase "setup" — ready for startGame().
  function makeSetupReady(numPlayers, seed) {
    var arr = [];
    for (var i = 0; i < (numPlayers || 2); i++) arr.push({ name: "P" + (i + 1) });
    var s = createState({ players: arr, seed: (seed != null) ? seed : 7 });
    var deck = buildTrainDeck();
    s.faceUp = deck.splice(deck.length - FACEUP_SIZE, FACEUP_SIZE);
    // keep the face-up row legal: 3+ locomotives must be flushed (re-dealt)
    while (locoCount(s.faceUp) >= 3) {
      for (var i = 0; i < s.faceUp.length; i++) s.decks.train.discard.push(s.faceUp[i]);
      s.faceUp = [];
      for (var i = 0; i < FACEUP_SIZE; i++) s.faceUp.push(deck.pop());
    }
    s.faceUpFresh = [false, false, false, false, false];
    for (var p = 0; p < s.players.length; p++) {
      for (var k = 0; k < 4; k++) s.players[p].hand[deck.pop()]++;
    }
    s.decks.train.draw = deck;
    s.decks.tickets.draw = gameRng(s).shuffle(buildTicketDeck());
    return s;
  }
  // A legal mid-game state (goes through the real startGame transition).
  function makePlaying(numPlayers, seed) {
    var s = makeSetupReady(numPlayers, seed);
    startGame(s);
    return s;
  }

  // ── train-card deck ops (Task 6) ─────────────────────────────────
  // decks.train.draw is the draw pile with its top card at the end.
  // Internal: pops the top card, reshuffling the discard pile into the
  // draw pile first when the draw pile is empty. Runs inside a mutate.
  function popTopCard(st) {
    var draw = st.decks.train.draw;
    if (draw.length === 0) {
      var discard = st.decks.train.discard;
      if (discard.length === 0) reject("drawTrainCard: both train piles are empty");
      gameRng(st).shuffle(discard);            // reshuffle discard -> draw
      while (discard.length) draw.push(discard.pop());
    }
    return draw.pop();
  }

  // Draw the top train card. `place(st, card)` puts the card somewhere
  // (hand / face-up / discard) inside the same mutation so the card
  // conservation invariant holds at every step. Returns the card.
  function drawTrainCard(state, place) {
    return mutate(state, "drawTrainCard", function (st) {
      var card = popTopCard(st);
      if (place) place(st, card);
      return card;
    });
  }

  // ── face-up row + locomotive rules (Task 7) ──────────────────────
  // The face-up row is 5 cards, one per slot. faceUpFresh[i] is true
  // when slot i was revealed during the current turn (a replacement or
  // a flush) — such a slot's locomotive cannot be taken until the next
  // turn. If 3+ of the 5 face-up cards are locomotives, all 5 are
  // discarded and 5 fresh ones dealt.
  function locoCount(faceUp) {
    var n = 0;
    faceUp.forEach(function (c) { if (c === LOCOMOTIVE) n++; });
    return n;
  }
  // True when every card still in the train piles is a locomotive. Any
  // five-card row dealt from such a deck would also be all locomotives,
  // so flushing can never converge — the row is kept as-is instead.
  function trainPilesAllLocos(st) {
    for (var i = 0; i < st.decks.train.draw.length; i++) if (st.decks.train.draw[i] !== LOCOMOTIVE) return false;
    for (var i = 0; i < st.decks.train.discard.length; i++) if (st.decks.train.discard[i] !== LOCOMOTIVE) return false;
    return true;
  }
  // Internal: flush the face-up row whenever 3+ of its 5 cards are
  // locomotives (official rule: discard all 5, deal 5 new). `fresh`
  // marks the newly dealt slots as un-takeable-this-turn (true during
  // play; false for the initial setup deal). Runs inside a mutate.
  // If flushing cannot converge — the train piles hold nothing but
  // locomotives, or the row stays ≥3-loco after many redeals — the row
  // is kept and faceUpStuck lets the validator accept the rare ≥3-loco
  // row so the game keeps going (each loco stays takeable, 1 per turn).
  function flushFaceUpIfNeeded(st, fresh) {
    st.faceUpStuck = false;
    var guard = 0;
    while (locoCount(st.faceUp) >= 3) {
      if (trainPilesAllLocos(st)) { st.faceUpStuck = true; break; }
      if (++guard > 50) { st.faceUpStuck = true; break; }
      for (var i = 0; i < st.faceUp.length; i++) st.decks.train.discard.push(st.faceUp[i]);
      st.faceUp = [];
      st.faceUpFresh = [];
      for (var i = 0; i < FACEUP_SIZE; i++) {
        st.faceUp.push(popTopCard(st));
        st.faceUpFresh.push(fresh);
      }
    }
  }

  // Take the face-up card at `index` into the active player's hand and
  // refill the slot from the deck (reshuffling the discard pile if the
  // draw pile empties). Taking a face-up locomotive locks the turn to
  // one card. A locomotive revealed by this refill (or by a flush)
  // cannot be taken until the next turn.
  function takeFaceUpCard(state, index) {
    return mutate(state, "takeFaceUpCard", function (st) {
      if (st.phase !== "playing") reject("takeFaceUpCard requires phase 'playing', got '" + st.phase + "'");
      if (st.turn.substate !== "drawingCards") reject("takeFaceUpCard requires substate 'drawingCards', got '" + st.turn.substate + "'");
      if (st.turn.cardsDrawn >= 2) reject("takeFaceUpCard: already drew " + st.turn.cardsDrawn + " cards this turn");
      if (st.turn.locoLock) reject("takeFaceUpCard: a face-up locomotive was taken this turn (1 card max)");
      if (!Number.isInteger(index) || index < 0 || index >= FACEUP_SIZE || st.faceUp[index] == null)
        reject("takeFaceUpCard: invalid face-up index " + index);
      var card = st.faceUp[index];
      if (card === LOCOMOTIVE && st.faceUpFresh[index])
        reject("takeFaceUpCard: this locomotive was just revealed and can't be taken this turn");
      if (card === LOCOMOTIVE && st.turn.cardsDrawn > 0)
        reject("takeFaceUpCard: a face-up locomotive may only be taken as the single card of a turn");
      if (st.decks.train.draw.length + st.decks.train.discard.length === 0)
        reject("takeFaceUpCard: both train piles are empty — cannot refill the face-up row");
      st.players[st.turn.active].hand[card]++;
      if (card === LOCOMOTIVE) st.turn.locoLock = true;
      st.turn.cardsDrawn++;
      st.faceUp[index] = popTopCard(st);
      st.faceUpFresh[index] = true;
      flushFaceUpIfNeeded(st, true);
    });
  }

  // Blind-draw the top card of the deck into the active player's hand.
  // Does not touch the face-up row. Honors the 2-card and locomotive
  // limits.
  function drawBlindCard(state) {
    return mutate(state, "drawBlindCard", function (st) {
      if (st.phase !== "playing") reject("drawBlindCard requires phase 'playing', got '" + st.phase + "'");
      if (st.turn.substate !== "drawingCards") reject("drawBlindCard requires substate 'drawingCards', got '" + st.turn.substate + "'");
      if (st.turn.cardsDrawn >= 2) reject("drawBlindCard: already drew " + st.turn.cardsDrawn + " cards this turn");
      if (st.turn.locoLock) reject("drawBlindCard: a face-up locomotive was taken this turn (1 card max)");
      if (st.decks.train.draw.length + st.decks.train.discard.length === 0)
        reject("drawBlindCard: both train piles are empty");
      st.players[st.turn.active].hand[popTopCard(st)]++;
      st.turn.cardsDrawn++;
    });
  }

  // ── destination-ticket deck (Task 8) ─────────────────────────────
  // The 30 official NA destination tickets (values 4–22), keyed by
  // their canonical city-pair id. decks.tickets.draw is the draw pile
  // with its top card at the end; like the train deck, an empty draw
  // pile is refilled from the shuffled discard pile. (Dealing tickets
  // to players is Task 9.)
  function buildTicketDeck() {
    return Object.keys(TICKET_CATALOG);
  }
  // Internal: pops the top ticket id, reshuffling the discard pile into
  // the draw pile first when it is empty. Runs inside a mutate.
  function popTicket(st) {
    var draw = st.decks.tickets.draw;
    if (draw.length === 0) {
      var discard = st.decks.tickets.discard;
      if (discard.length === 0) reject("drawTicket: both ticket piles are empty");
      gameRng(st).shuffle(discard);
      while (discard.length) draw.push(discard.pop());
    }
    return draw.pop();
  }
  // Draw the top destination ticket. `place(st, ticketId)` puts the
  // ticket somewhere (a player's hand / a presented buffer / the
  // discard pile) inside the same mutation. Returns the ticket id.
  function drawTicket(state, place) {
    return mutate(state, "drawTicket", function (st) {
      var tid = popTicket(st);
      if (place) place(st, tid);
      return tid;
    });
  }

  // ── shared test helpers ──────────────────────────────────────────
  function handSize(player) {
    var n = 0;
    CARD_TYPES.forEach(function (c) { n += player.hand[c]; });
    return n;
  }
  // Replace the face-up row with `cards`, pulling them out of the draw
  // pile and parking the old row in the discard pile (conservation kept).
  // The forced row must keep <3 locos (assertState enforces it).
  function testForceFaceUp(state, cards) {
    mutate(state, "test-forceFaceUp", function (st) {
      var newRow = [];
      cards.forEach(function (c) {
        var idx = st.decks.train.draw.indexOf(c);
        if (idx === -1) throw new Error("wanted card '" + c + "' not in draw pile");
        newRow.push(st.decks.train.draw.splice(idx, 1)[0]);
      });
      while (st.faceUp.length) st.decks.train.discard.push(st.faceUp.pop());
      st.faceUp = newRow;
      st.faceUpFresh = newRow.map(function () { return false; });
    });
  }
  // Move a locomotive to the top (end) of the draw pile.
  function testMoveLocoToTop(state) {
    mutate(state, "test-loco-top", function (st) {
      var draw = st.decks.train.draw;
      var idx = draw.indexOf(LOCOMOTIVE);
      if (idx === -1) throw new Error("no locomotive in draw pile");
      draw.splice(idx, 1);
      draw.push(LOCOMOTIVE);
    });
  }
  // Take any currently-takeable face-up card (skips fresh locomotives).
  function testTakeAny(state) {
    for (var i = 0; i < FACEUP_SIZE; i++) {
      var ok = false;
      try { takeFaceUpCard(state, i); ok = true; } catch (e) {}
      if (ok) return i;
    }
    throw new Error("no takeable face-up card");
  }

  // ── destination-ticket draw routine (Task 9) ─────────────────────
  // A ticket draw happens in two phases so the UI can present the drawn
  // tickets: beginTicketDraw pulls up to 3 tickets into
  // state.pendingTickets; resolveTicketDraw accepts a non-empty keep
  // subset (min 1 mid-game) and returns the rest to the ticket discard.
  // Kept tickets start in state "unstarted".
  function beginTicketDraw(state) {
    return mutate(state, "beginTicketDraw", function (st) {
      if (st.phase !== "playing") reject("beginTicketDraw requires phase 'playing', got '" + st.phase + "'");
      if (st.turn.substate !== "drawingTickets") reject("beginTicketDraw requires substate 'drawingTickets', got '" + st.turn.substate + "'");
      if (st.pendingTickets.length > 0) reject("beginTicketDraw: a ticket draw is already pending");
      while (st.pendingTickets.length < 3 &&
             (st.decks.tickets.draw.length + st.decks.tickets.discard.length) > 0) {
        st.pendingTickets.push(popTicket(st));
      }
      if (st.pendingTickets.length === 0) reject("beginTicketDraw: no tickets available");
      return st.pendingTickets.slice();
    });
  }
  function resolveTicketDraw(state, keepIds) {
    return mutate(state, "resolveTicketDraw", function (st) {
      if (st.pendingTickets.length === 0) reject("resolveTicketDraw: no pending ticket draw");
      if (!Array.isArray(keepIds)) reject("resolveTicketDraw: keepIds must be an array");
      if (keepIds.length < 1) reject("resolveTicketDraw: must keep at least 1 ticket");
      var keepSet = new Set();
      keepIds.forEach(function (tid) {
        if (!isStr(tid) || st.pendingTickets.indexOf(tid) === -1)
          reject("resolveTicketDraw: '" + tid + "' was not drawn");
        if (keepSet.has(tid)) reject("resolveTicketDraw: duplicate keep '" + tid + "'");
        keepSet.add(tid);
      });
      var pid = st.turn.active;
      st.pendingTickets.forEach(function (tid) {
        if (keepSet.has(tid)) {
          st.players[pid].ticketIds.push(tid);
          st.players[pid].ticketState[tid] = "unstarted";
        } else {
          st.decks.tickets.discard.push(tid);
        }
      });
      st.pendingTickets = [];
      updateTicketCompletions(st, pid);
      return keepSet.size;
    });
  }
  // The initial setup deal: for each player, draw 3 tickets (or fewer if
  // the deck runs short) and keep at least 2 (all, if fewer were drawn).
  // keepChoices[i] is the subset of the drawn tickets player i keeps.
  function setupInitialTickets(state, keepChoices) {
    return mutate(state, "setupInitialTickets", function (st) {
      if (st.phase !== "setup") reject("setupInitialTickets requires phase 'setup', got '" + st.phase + "'");
      if (!Array.isArray(keepChoices) || keepChoices.length !== st.players.length)
        reject("setupInitialTickets: need one keep list per player");
      var summary = [];
      for (var p = 0; p < st.players.length; p++) {
        var drawn = [];
        while (drawn.length < 3 && (st.decks.tickets.draw.length + st.decks.tickets.discard.length) > 0)
          drawn.push(popTicket(st));
        var keep = keepChoices[p] || [];
        if (drawn.length < 2) {
          if (keep.length !== drawn.length)
            reject("setupInitialTickets: player " + p + " must keep all " + drawn.length + " drawn ticket(s)");
        } else if (keep.length < 2) {
          reject("setupInitialTickets: player " + p + " must keep at least 2 tickets");
        }
        var keepSet = new Set();
        keep.forEach(function (tid) {
          if (drawn.indexOf(tid) === -1) reject("setupInitialTickets: '" + tid + "' was not drawn by player " + p);
          if (keepSet.has(tid)) reject("setupInitialTickets: duplicate keep '" + tid + "'");
          keepSet.add(tid);
        });
        drawn.forEach(function (tid) {
          if (keepSet.has(tid)) {
            st.players[p].ticketIds.push(tid);
            st.players[p].ticketState[tid] = "unstarted";
          } else {
            st.decks.tickets.discard.push(tid);
          }
        });
        summary.push({ playerId: p, drawn: drawn, kept: keep.slice() });
      }
      return summary;
    });
  }

  // ── hand integrity primitives (Task 10) ──────────────────────────
  // Remove `cards` from a player's hand into the train discard pile,
  // validating that the hand actually contains them. The basis for
  // route claims (Task 13) and any other payment.
  function payCards(state, playerId, cards) {
    return mutate(state, "payCards", function (st) {
      if (!st.players[playerId]) reject("payCards: bad player id " + playerId);
      if (!Array.isArray(cards)) reject("payCards: cards must be an array");
      var counts = {};
      cards.forEach(function (c) {
        if (CARD_TYPES.indexOf(c) === -1) reject("payCards: bad card '" + c + "'");
        counts[c] = (counts[c] || 0) + 1;
      });
      Object.keys(counts).forEach(function (c) {
        if (st.players[playerId].hand[c] < counts[c])
          reject("payCards: player " + playerId + " lacks " + counts[c] + " " + c + "(s)");
      });
      cards.forEach(function (c) {
        st.players[playerId].hand[c]--;
        st.decks.train.discard.push(c);
      });
    });
  }

  // ── newGame(seed): deterministic game entry point (Task 5) ───────
  // Builds + shuffles the official 110-card deck with the seeded PRNG,
  // deals the 5 face-up cards and 4 starting cards per player, then
  // starts the game (destination-ticket setup dealing arrives in
  // Task 9).
  function newGame(opts) {
    opts = opts || {};
    var names = (Array.isArray(opts.players) && opts.players.length > 0)
      ? opts.players
      : [{ name: "Player 1" }, { name: "Player 2" }];
    var seed = isNum(opts.seed) ? opts.seed : Math.floor(Math.random() * 0x7fffffff);
    var s = createState({ players: names, seed: seed, rules: opts.rules });
    var deck = buildTrainDeck();
    gameRng(s).shuffle(deck);
    s.decks.train.draw = deck;
    mutate(s, "newGame-setup", function (st) {
      for (var i = 0; i < FACEUP_SIZE; i++) st.faceUp.push(popTopCard(st));
      st.faceUpFresh = [false, false, false, false, false];
      flushFaceUpIfNeeded(st, false);
      for (var p = 0; p < st.players.length; p++)
        for (var k = 0; k < 4; k++) st.players[p].hand[popTopCard(st)]++;
      st.decks.tickets.draw = gameRng(st).shuffle(buildTicketDeck());
    });
    startGame(s);
    return s;
  }

  // ── North America map data (Task 4) ─────────────────────────────
  // Source: read from the official board art (repo: Rob217/
  // TicketToRideAnalysis), spot-verified against the board image.
  // 36 cities · 78 distinct city pairs = 56 single routes + 22
  // double routes = 100 route segments. Route ids are canonical
  // ("A-B", alphabetical); the second segment of a double route gets
  // a "#2" suffix.
  var CITY_POS = [
  ["Atlanta",0.7805523828125,0.3668687598828697],
  ["Boston",0.94517291015625,0.7935577642752563],
  ["Calgary",0.234723779296875,0.8714704143484626],
  ["Charleston",0.87193072265625,0.3564106925329429],
  ["Chicago",0.68394244140625,0.5964232693997071],
  ["Dallas",0.55454796875,0.22097883308931188],
  ["Denver",0.390276162109375,0.4510562122986823],
  ["Duluth",0.56361603515625,0.6858397408491947],
  ["El Paso",0.377720390625,0.18542142459736466],
  ["Helena",0.33272876953125,0.6774732693997072],
  ["Houston",0.59535431640625,0.1629365344070277],
  ["Kansas City",0.554896708984375,0.47720138067349926],
  ["Las Vegas",0.20751951171875,0.3354946310395316],
  ["Little Rock",0.623256083984375,0.3443839136163982],
  ["Los Angeles",0.14474048828125,0.25026140995607615],
  ["Miami",0.90366900390625,0.1252875007320644],
  ["Montreal",0.875418486328125,0.8777451727672035],
  ["Nashville",0.731026708984375,0.418636168374817],
  ["New Orleans",0.68603509765625,0.1801923323572474],
  ["New York",0.89390337890625,0.6837481010248903],
  ["Oklahoma City",0.535365458984375,0.35013591947291356],
  ["Omaha",0.53466791015625,0.5514536354319179],
  ["Phoenix",0.26157921875,0.24032625622254766],
  ["Pittsburgh",0.811593115234375,0.6178623030746706],
  ["Portland",0.0823102666015625,0.6905459194729135],
  ["Raleigh",0.84472650390625,0.45210198096632503],
  ["Saint Louis",0.638253271484375,0.47458687115666176],
  ["Salt Lake City",0.262625546875,0.49654884773060026],
  ["San Francisco",0.068359375,0.4024262855051244],
  ["Santa Fe",0.38295197265625,0.3182388330893118],
  ["Sault St. Marie",0.68847650390625,0.7825767979502196],
  ["Seattle",0.103585380859375,0.7668897701317716],
  ["Toronto",0.7952008203125,0.7517255095168375],
  ["Vancouver",0.108119423828125,0.8458481595900439],
  ["Washington",0.901576396484375,0.5509306778916545],
  ["Winnipeg",0.453404013671875,0.8552603411420204]
  ];
  var ROUTE_SEGMENTS = [
  ["Vancouver","Calgary",3,"gray"],
  ["Vancouver","Seattle",1,"gray"],
  ["Vancouver","Seattle",1,"gray"],
  ["Seattle","Calgary",4,"gray"],
  ["Seattle","Helena",6,"yellow"],
  ["Seattle","Portland",1,"gray"],
  ["Seattle","Portland",1,"gray"],
  ["Portland","Salt Lake City",6,"blue"],
  ["Portland","San Francisco",5,"green"],
  ["Portland","San Francisco",5,"purple"],
  ["San Francisco","Salt Lake City",5,"orange"],
  ["San Francisco","Salt Lake City",5,"white"],
  ["San Francisco","Los Angeles",3,"yellow"],
  ["San Francisco","Los Angeles",3,"purple"],
  ["Los Angeles","Las Vegas",2,"gray"],
  ["Los Angeles","Phoenix",3,"gray"],
  ["Los Angeles","El Paso",6,"black"],
  ["Calgary","Winnipeg",6,"white"],
  ["Calgary","Helena",4,"gray"],
  ["Helena","Winnipeg",4,"blue"],
  ["Helena","Salt Lake City",3,"purple"],
  ["Helena","Denver",4,"green"],
  ["Helena","Duluth",6,"orange"],
  ["Helena","Omaha",5,"red"],
  ["Salt Lake City","Denver",3,"red"],
  ["Salt Lake City","Denver",3,"yellow"],
  ["Las Vegas","Salt Lake City",3,"orange"],
  ["Phoenix","Denver",5,"white"],
  ["Phoenix","Santa Fe",3,"gray"],
  ["Phoenix","El Paso",3,"gray"],
  ["Winnipeg","Sault St. Marie",6,"gray"],
  ["Winnipeg","Duluth",4,"black"],
  ["Duluth","Sault St. Marie",3,"gray"],
  ["Duluth","Toronto",6,"purple"],
  ["Duluth","Chicago",3,"red"],
  ["Duluth","Omaha",2,"gray"],
  ["Duluth","Omaha",2,"gray"],
  ["Omaha","Chicago",4,"blue"],
  ["Omaha","Kansas City",1,"gray"],
  ["Omaha","Kansas City",1,"gray"],
  ["Kansas City","Saint Louis",2,"blue"],
  ["Kansas City","Saint Louis",2,"purple"],
  ["Kansas City","Oklahoma City",2,"gray"],
  ["Kansas City","Oklahoma City",2,"gray"],
  ["Oklahoma City","Little Rock",2,"gray"],
  ["Oklahoma City","Dallas",2,"gray"],
  ["Oklahoma City","Dallas",2,"gray"],
  ["Dallas","Little Rock",2,"gray"],
  ["Dallas","Houston",1,"gray"],
  ["Dallas","Houston",1,"gray"],
  ["Houston","New Orleans",2,"gray"],
  ["El Paso","Houston",6,"green"],
  ["El Paso","Dallas",4,"red"],
  ["El Paso","Oklahoma City",5,"yellow"],
  ["El Paso","Santa Fe",2,"gray"],
  ["Santa Fe","Oklahoma City",3,"blue"],
  ["Oklahoma City","Denver",4,"red"],
  ["Santa Fe","Denver",2,"gray"],
  ["Denver","Kansas City",4,"black"],
  ["Denver","Kansas City",4,"orange"],
  ["Denver","Omaha",4,"purple"],
  ["New Orleans","Miami",6,"red"],
  ["New Orleans","Atlanta",4,"orange"],
  ["New Orleans","Atlanta",4,"yellow"],
  ["New Orleans","Little Rock",3,"green"],
  ["Little Rock","Nashville",3,"white"],
  ["Little Rock","Saint Louis",2,"gray"],
  ["Saint Louis","Nashville",2,"gray"],
  ["Saint Louis","Pittsburgh",5,"green"],
  ["Saint Louis","Chicago",2,"green"],
  ["Saint Louis","Chicago",2,"white"],
  ["Chicago","Pittsburgh",3,"black"],
  ["Chicago","Pittsburgh",3,"orange"],
  ["Chicago","Toronto",4,"white"],
  ["Sault St. Marie","Montreal",5,"black"],
  ["Toronto","Montreal",3,"gray"],
  ["Sault St. Marie","Toronto",2,"gray"],
  ["Toronto","Pittsburgh",2,"gray"],
  ["Pittsburgh","New York",2,"white"],
  ["Pittsburgh","New York",2,"green"],
  ["Pittsburgh","Washington",2,"gray"],
  ["Pittsburgh","Raleigh",2,"gray"],
  ["Nashville","Raleigh",3,"black"],
  ["Nashville","Atlanta",1,"gray"],
  ["Nashville","Pittsburgh",4,"yellow"],
  ["Atlanta","Miami",5,"blue"],
  ["Atlanta","Charleston",2,"gray"],
  ["Atlanta","Raleigh",2,"gray"],
  ["Atlanta","Raleigh",2,"gray"],
  ["Charleston","Miami",4,"purple"],
  ["Raleigh","Charleston",2,"gray"],
  ["Raleigh","Washington",2,"gray"],
  ["Raleigh","Washington",2,"gray"],
  ["Washington","New York",2,"orange"],
  ["Washington","New York",2,"black"],
  ["New York","Boston",2,"yellow"],
  ["New York","Boston",2,"red"],
  ["New York","Montreal",3,"blue"],
  ["Boston","Montreal",2,"gray"],
  ["Boston","Montreal",2,"gray"]
  ];
  var TICKET_DESTINATIONS = [
  ["Los Angeles","New York",21],
  ["Duluth","Houston",8],
  ["Sault St. Marie","Nashville",8],
  ["New York","Atlanta",6],
  ["Portland","Nashville",17],
  ["Vancouver","Montreal",20],
  ["Duluth","El Paso",10],
  ["Toronto","Miami",10],
  ["Portland","Phoenix",11],
  ["Dallas","New York",11],
  ["Calgary","Salt Lake City",7],
  ["Calgary","Phoenix",13],
  ["Los Angeles","Miami",20],
  ["Winnipeg","Little Rock",11],
  ["San Francisco","Atlanta",17],
  ["Kansas City","Houston",5],
  ["Los Angeles","Chicago",16],
  ["Denver","Pittsburgh",11],
  ["Chicago","Santa Fe",9],
  ["Vancouver","Santa Fe",13],
  ["Boston","Miami",12],
  ["Chicago","New Orleans",7],
  ["Montreal","Atlanta",9],
  ["Seattle","New York",22],
  ["Denver","El Paso",4],
  ["Helena","Los Angeles",8],
  ["Winnipeg","Houston",12],
  ["Montreal","New Orleans",13],
  ["Sault St. Marie","Oklahoma City",9],
  ["Seattle","Los Angeles",9]
  ];

  function pairId(a, b) { return a <= b ? (a + "-" + b) : (b + "-" + a); }

  // Validate a {cities, routes, tickets} map. Throws on any violation:
  // coordinates, endpoint existence, route uniqueness (≤2 per pair),
  // length bounds (1–6), color validity, double-route length parity,
  // ticket endpoints/values, and full graph connectivity.
  function validateMap(map) {
    if (!map || !map.cities || !map.routes) fail("map missing cities/routes");
    var cityKeys = Object.keys(map.cities);
    if (cityKeys.length < 30) fail("map has only " + cityKeys.length + " cities");
    cityKeys.forEach(function (name) {
      var c = map.cities[name];
      if (!c || !isNum(c.x) || !isNum(c.y) || c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1)
        fail("city '" + name + "' has out-of-bounds coordinates");
    });
    var pairCount = {};
    Object.keys(map.routes).forEach(function (rid) {
      var r = map.routes[rid];
      if (!r || !isStr(r.a) || !isStr(r.b)) fail("route '" + rid + "' missing endpoints");
      if (!map.cities[r.a]) fail("route '" + rid + "' endpoint '" + r.a + "' is not a city");
      if (!map.cities[r.b]) fail("route '" + rid + "' endpoint '" + r.b + "' is not a city");
      if (r.a === r.b) fail("route '" + rid + "' is a self-loop");
      if (COLORS.indexOf(r.color) === -1 && r.color !== "gray") fail("route '" + rid + "' has bad color '" + r.color + "'");
      if (!isNum(r.length) || !Number.isInteger(r.length) || r.length < 1 || r.length > 6)
        fail("route '" + rid + "' has bad length " + r.length);
      var key = pairId(r.a, r.b);
      pairCount[key] = (pairCount[key] || 0) + 1;
      if (pairCount[key] > 2) fail("city pair " + key + " has " + pairCount[key] + " route segments");
      if (rid !== key && rid !== key + "#2") fail("route id '" + rid + "' does not match its pair '" + key + "'");
    });
    // double-route segments of the same pair must have equal length
    var lenByPair = {};
    Object.keys(map.routes).forEach(function (rid) {
      var r = map.routes[rid];
      var key = pairId(r.a, r.b);
      if (lenByPair[key] != null && lenByPair[key] !== r.length)
        fail("double route " + key + " has mismatched lengths (" + lenByPair[key] + " vs " + r.length + ")");
      lenByPair[key] = r.length;
    });
    if (map.tickets) {
      if (!Array.isArray(map.tickets)) fail("tickets is not an array");
      map.tickets.forEach(function (t) {
        if (!t || !map.cities[t.a] || !map.cities[t.b]) fail("ticket endpoint is not a city");
        if (t.a === t.b) fail("ticket '" + t.a + "-" + t.b + "' is a self-pair");
        if (!isNum(t.value) || !Number.isInteger(t.value) || t.value < 4 || t.value > 22)
          fail("ticket '" + t.a + "-" + t.b + "' has out-of-range value " + t.value);
      });
    }
    // graph connectivity: every city reachable from the first
    var adj = {};
    cityKeys.forEach(function (n) { adj[n] = []; });
    Object.keys(map.routes).forEach(function (rid) {
      var r = map.routes[rid];
      adj[r.a].push(r.b);
      adj[r.b].push(r.a);
    });
    var seen = {}, stack = [cityKeys[0]];
    seen[cityKeys[0]] = true;
    while (stack.length) {
      var cur = stack.pop();
      adj[cur].forEach(function (nb) { if (!seen[nb]) { seen[nb] = true; stack.push(nb); } });
    }
    if (Object.keys(seen).length !== cityKeys.length) fail("map graph is disconnected");
    return map;
  }

  // Build the validated North America map. Route ids: canonical
  // alphabetical "A-B", doubled segments get "#2".
  function buildNorthAmericaMap() {
    var cities = {};
    CITY_POS.forEach(function (c) { cities[c[0]] = { x: c[1], y: c[2] }; });
    var pairSeen = {};
    var routes = {};
    ROUTE_SEGMENTS.forEach(function (seg) {
      var key = pairId(seg[0], seg[1]);
      var n = (pairSeen[key] = (pairSeen[key] || 0) + 1);
      routes[key + (n > 1 ? "#" + n : "")] = { a: seg[0], b: seg[1], color: seg[3], length: seg[2] };
    });
    var tickets = TICKET_DESTINATIONS.map(function (t) { return { a: t[0], b: t[1], value: t[2] }; });
    return validateMap({ cities: cities, routes: routes, tickets: tickets });
  }

  // Turn the ticket array into a state catalog keyed by canonical id.
  function ticketCatalog(tickets) {
    var cat = {};
    tickets.forEach(function (t) { cat[pairId(t.a, t.b)] = { a: t.a, b: t.b, value: t.value }; });
    return cat;
  }

  var MAP = buildNorthAmericaMap();   // built + validated once at load
  var TICKET_CATALOG = ticketCatalog(MAP.tickets);   // ticketId -> {a, b, value}

  // ── phase & substate state machine (Task 3) ─────────────────────
  // Phases: setup → playing → gameOver (gameOver is terminal).
  // Per-turn substates: chooseAction → one of {drawingCards,
  // claimingRoute, drawingTickets} → (turn completes) → chooseAction.
  // Every transition validates its preconditions and throws a reason
  // ("TtR transition rejected: ...") when illegal. The ≤2-trains
  // end-of-game trigger + stopAtTurnCount rounding is wired in Task 30.
  var PHASE_TRANSITIONS = {
    setup: ["playing"],
    playing: ["gameOver"],
    gameOver: []
  };
  var SUBSTATE_TRANSITIONS = {
    chooseAction: ["drawingCards", "claimingRoute", "drawingTickets"],
    drawingCards: [],      // only completeTurn() leaves these
    claimingRoute: [],
    drawingTickets: []
  };

  function startGame(state) {
    return mutate(state, "startGame", function (st) {
      if (st.phase !== "setup") reject("startGame requires phase 'setup', got '" + st.phase + "'");
      st.phase = "playing";
      st.turn.active = 0;
      st.turn.count = 0;
      st.turn.substate = "chooseAction";
      st.turn.cardsDrawn = 0;
      st.turn.locoLock = false;
      st.turn.claimedRouteId = null;
      st.faceUpFresh = st.faceUpFresh.map(function () { return false; });
    });
  }

  function endGame(state, winnerId, reason) {
    return mutate(state, "endGame", function (st) {
      if (st.phase !== "playing") reject("endGame requires phase 'playing', got '" + st.phase + "'");
      if (!isNum(winnerId) || winnerId < 0 || winnerId >= st.players.length) reject("endGame: invalid winnerId " + winnerId);
      if (reason !== "score" && reason !== "resign" && reason !== "forfeit") reject("endGame: invalid reason '" + reason + "'");
      st.phase = "gameOver";
      st.gameEnd.winnerId = winnerId;
      st.gameEnd.reason = reason;
    });
  }

  function enterAction(state, action) {
    return mutate(state, "enterAction", function (st) {
      if (st.phase !== "playing") reject("enterAction requires phase 'playing', got '" + st.phase + "'");
      if (isRoundComplete(st)) reject("enterAction: the fair final round is complete");
      if (st.turn.substate !== "chooseAction") reject("enterAction requires substate 'chooseAction', got '" + st.turn.substate + "'");
      if (SUBSTATE_TRANSITIONS.chooseAction.indexOf(action) === -1) reject("enterAction: '" + action + "' is not a legal action");
      st.turn.substate = action;
    });
  }

  function completeTurn(state) {
    return mutate(state, "completeTurn", function (st) {
      if (st.phase !== "playing") reject("completeTurn requires phase 'playing', got '" + st.phase + "'");
      if (isRoundComplete(st)) reject("completeTurn: the fair final round is complete");
      if (st.turn.substate === "chooseAction") reject("completeTurn: no action in progress (substate 'chooseAction')");
      // Task 11: a turn may only end once its chosen action has completed.
      var sub = st.turn.substate;
      if (sub === "drawingCards") {
        var pilesEmpty = st.decks.train.draw.length + st.decks.train.discard.length === 0;
        if (!(st.turn.cardsDrawn === 2 || (st.turn.locoLock && st.turn.cardsDrawn === 1) || pilesEmpty))
          reject("completeTurn: drawing action incomplete (drew " + st.turn.cardsDrawn + " of 2)");
      } else if (sub === "claimingRoute") {
        if (st.turn.claimedRouteId == null) reject("completeTurn: no route claimed this turn");
      } else if (sub === "drawingTickets") {
        if (st.pendingTickets.length > 0) reject("completeTurn: destination tickets still pending");
      }
      // Task 14: completing a turn with ≤2 trains triggers the end of the
      // game. Play continues until every player (triggerer included) has
      // played an equal number of turns — i.e. the completed-turn count
      // reaches the next multiple of the player count.
      var triggerEnd = st.players[st.turn.active].trains <= (st.rules ? st.rules.endTrains : 2);
      // Stall guard (safety valve): a turn that drew 0 cards from an
      // already-empty deck, with no route left claimable by this player
      // and no tickets to draw, is a dead board — the game cannot progress,
      // so end it with the same fair-round rule.
      if (!triggerEnd && sub === "drawingCards" && st.turn.cardsDrawn === 0 &&
          st.decks.train.draw.length + st.decks.train.discard.length === 0 &&
          st.decks.tickets.draw.length + st.decks.tickets.discard.length === 0) {
        var anyClaim = false;
        for (var rid in st.routes) { if (claimEligible(st, rid)) { anyClaim = true; break; } }
        if (!anyClaim) triggerEnd = true;
      }
      if (!st.gameEnd.triggered && triggerEnd) {
        st.gameEnd.triggered = true;
        st.gameEnd.triggerPlayerId = st.turn.active;
        st.gameEnd.stopAtTurnCount =
          Math.ceil((st.turn.count + st.players.length) / st.players.length) * st.players.length;
      }
      st.turn.count++;
      st.turn.active = (st.turn.active + 1) % st.players.length;
      st.turn.substate = "chooseAction";
      st.turn.cardsDrawn = 0;
      st.turn.locoLock = false;
      st.turn.claimedRouteId = null;
      st.faceUpFresh = st.faceUpFresh.map(function () { return false; });
    });
  }

  // Last-resort recovery for a broken turn (used by the app when an AI
  // decision throws unexpectedly): finalize whatever partial state exists
  // so a stuck substate can never freeze the game. Normal play never
  // reaches this — it only un-sticks a turn whose action failed mid-way.
  function forceCompleteTurn(state) {
    return mutate(state, "forceCompleteTurn", function (st) {
      if (st.phase !== "playing" || st.turn.substate === "chooseAction")
        reject("forceCompleteTurn: no action in progress");
      var sub = st.turn.substate;
      if (sub === "claimingRoute" && st.turn.claimedRouteId == null) {
        st.turn.substate = "chooseAction";              // nothing claimed — cancel the action
        return;
      }
      if (sub === "drawingTickets") {
        while (st.pendingTickets.length) st.decks.tickets.discard.push(st.pendingTickets.pop());  // return unkept tickets
      }
      st.turn.count++;
      st.turn.active = (st.turn.active + 1) % st.players.length;
      st.turn.substate = "chooseAction";
      st.turn.cardsDrawn = 0;
      st.turn.locoLock = false;
      st.turn.claimedRouteId = null;
      st.faceUpFresh = st.faceUpFresh.map(function () { return false; });
    });
  }

  // ── predicates (for UI enable/disable and tests) ─────────────────
  function canStartGame(state) { return state.phase === "setup"; }
  function canEndGame(state) { return state.phase === "playing"; }
  function canCompleteTurn(state) {
    if (state.phase !== "playing" || state.turn.substate === "chooseAction") return false;
    var sub = state.turn.substate;
    if (sub === "drawingCards") {
      var pilesEmpty = state.decks.train.draw.length + state.decks.train.discard.length === 0;
      return state.turn.cardsDrawn === 2 || (state.turn.locoLock && state.turn.cardsDrawn === 1) || pilesEmpty;
    }
    if (sub === "claimingRoute") return state.turn.claimedRouteId != null;
    if (sub === "drawingTickets") return state.pendingTickets.length === 0;
    return false;
  }
  function legalActions(state) {
    if (state.phase !== "playing" || state.turn.substate !== "chooseAction") return [];
    if (isRoundComplete(state)) return [];
    // Honest legality: only actions that are actually executable right now
    // (train/ticket piles non-empty; at least one route the active player
    // can afford). Keeps the UI buttons, keyboard shortcuts and the AI's
    // random fallback from entering a dead-end substate.
    var actions = [];
    if (state.decks.train.draw.length + state.decks.train.discard.length > 0) actions.push("drawingCards");
    for (var rid in state.routes) { if (claimEligible(state, rid)) { actions.push("claimingRoute"); break; } }
    if (state.decks.tickets.draw.length + state.decks.tickets.discard.length > 0) actions.push("drawingTickets");
    return actions;
  }

  // ── fair turn sequencing (Task 14) ───────────────────────────────
  // Once the end has been triggered, play continues until the completed
  // turn count reaches stopAtTurnCount — one final turn for every other
  // player — then all actions are blocked (final scoring resolves the
  // game, Tasks 18/30).
  function isRoundComplete(state) {
    return state.phase === "playing" && state.gameEnd.triggered &&
           state.turn.count >= state.gameEnd.stopAtTurnCount;
  }

  // ── route claims (Tasks 12–13) ───────────────────────────────────
  var ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };

  // Which player currently owns `routeId` (or null).
  function routeOwner(state, routeId) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].claimedRoutes.indexOf(routeId) !== -1) return state.players[i];
    }
    return null;
  }
  // The pair id a route belongs to (strips any "#N" suffix).
  function routePairId(routeId) {
    return routeId.replace(/#\d+$/, "");
  }
  // Double-route rule: with 2-3 players only one of a pair's two parallel
  // segments may be claimed board-wide. Returns true when the other
  // segment of routeId's pair is already taken.
  function doubleRouteLocked(state, routeId) {
    if (state.players.length >= 4) return false;
    if (state.rules && state.rules.allowDoubleFor23) return false;   // house rule (Task 44)
    var id = routePairId(routeId);
    if (!state.routes[id + "#2"]) return false;   // not a double route
    var otherId = (routeId === id) ? (id + "#2") : id;
    return routeOwner(state, otherId) !== null;
  }
  // Every legal card payment for `route`: {color, locos}, where locos is
  // the number of locomotives paid alongside the color's cards. For a
  // colored route, color is fixed; for a gray route any single color
  // works, and all-locomotives (color null) is allowed. Locomotives are
  // wildcards that substitute for any color.
  function cardPaymentOptions(pl, route) {
    var options = [];
    if (route.color === "gray") {
      COLORS.forEach(function (color) {
        for (var l = 0; l < route.length; l++) {
          if (pl.hand.locomotive >= l && pl.hand[color] >= route.length - l)
            options.push({ color: color, locos: l });
        }
      });
      if (pl.hand.locomotive >= route.length) options.push({ color: null, locos: route.length });
    } else {
      for (var l = 0; l <= route.length; l++) {
        if (pl.hand.locomotive >= l && pl.hand[route.color] >= route.length - l)
          options.push({ color: route.color, locos: l });
      }
    }
    return options;
  }
  // Returns null when the active player may currently claim `routeId`,
  // else a human-readable reason.
  function claimBlockedReason(state, routeId) {
    var r = state.routes[routeId];
    if (!r) return "route '" + routeId + "' is not in the catalog";
    if (state.phase !== "playing") return "game is not in progress";
    if (isRoundComplete(state)) return "the fair final round is complete";
    if (state.turn.substate !== "claimingRoute") return "not in the claimingRoute action";
    var pl = state.players[state.turn.active];
    if (routeOwner(state, routeId)) return "route '" + routeId + "' is already claimed";
    if (pl.trains < r.length) return "not enough trains (" + pl.trains + " < " + r.length + ")";
    if (doubleRouteLocked(state, routeId))
      return "the parallel route of this pair is already claimed (2-3 players)";
    if (cardPaymentOptions(pl, r).length === 0) return "not enough cards of a matching color";
    return null;
  }
  // All legal payments the active player could make for `routeId`.
  // Empty when the claim is currently illegal or unaffordable.
  function claimPayments(state, routeId) {
    if (claimBlockedReason(state, routeId)) return [];
    return cardPaymentOptions(state.players[state.turn.active], state.routes[routeId]);
  }
  // Claim `routeId` for the active player using one exact legal payment.
  // Deducts the paid cards (to the discard pile) and trains, marks the
  // route claimed, scores via the official table, and logs the move.
  function claimRoute(state, routeId, payment) {
    return mutate(state, "claimRoute", function (st) {
      var reason = claimBlockedReason(st, routeId);
      if (reason) reject("claimRoute: " + reason);
      var options = cardPaymentOptions(st.players[st.turn.active], st.routes[routeId]);
      var pColor = (payment && payment.color != null) ? String(payment.color) : null;
      var pLocos = Number(payment && payment.locos);
      var match = null;
      options.forEach(function (o) {
        if ((o.color == null ? null : o.color) === pColor && o.locos === pLocos) match = o;
      });
      if (!match) reject("claimRoute: invalid payment (need one matching color card set)");
      var r = st.routes[routeId];
      var pl = st.players[st.turn.active];
      var color = match.color;
      var locos = match.locos;
      var colorCards = r.length - locos;
      if (color) {
        pl.hand[color] -= colorCards;
        for (var k = 0; k < colorCards; k++) st.decks.train.discard.push(color);
      }
      pl.hand.locomotive -= locos;
      for (var k = 0; k < locos; k++) st.decks.train.discard.push(LOCOMOTIVE);
      pl.trains -= r.length;
      pl.claimedRoutes.push(routeId);
      st.turn.claimedRouteId = routeId;
      var pts = ROUTE_POINTS[r.length];
      pl.score += pts;
      pl.routePoints += pts;
      st.log.push({ turn: st.turn.count, playerId: pl.id, action: "claimRoute", detail: routeId + " +" + pts });
      // Task 16: ticket completion is detected immediately, within the
      // same mutation as the claim that may have connected the cities.
      updateTicketCompletions(st, pl.id);
    });
  }

  // ── connectivity over claimed routes (Task 15) ───────────────────
  // The claimed-route graph of a player: city -> [neighbor cities].
  function playerGraph(state, playerId) {
    var adj = {};
    state.players[playerId].claimedRoutes.forEach(function (rid) {
      var r = state.routes[rid];
      (adj[r.a] = adj[r.a] || []).push(r.b);
      (adj[r.b] = adj[r.b] || []).push(r.a);
    });
    return adj;
  }
  // Are cities a and b connected through this player's claimed routes?
  // Iterative DFS, O(V+E) per query.
  function citiesConnected(state, playerId, a, b) {
    if (a === b) return true;
    var adj = playerGraph(state, playerId);
    if (!adj[a] || !adj[b]) return false;
    var seen = {};
    var stack = [a];
    seen[a] = true;
    while (stack.length) {
      var cur = stack.pop();
      if (cur === b) return true;
      (adj[cur] || []).forEach(function (nb) {
        if (!seen[nb]) { seen[nb] = true; stack.push(nb); }
      });
    }
    return false;
  }

  // ── ticket completion detection (Task 16) ───────────────────────
  // Flip every held ticket of a player to "connected" as soon as its
  // two cities are connected in the player's claimed-route graph.
  // Routes are never unclaimed, so a ticket's state never regresses.
  // Called inside claimRoute's mutation (and after mid-game ticket
  // keeps) so ticket states are always current; final scoring later
  // promotes "connected" tickets to "complete" (Task 18). Expects the
  // state object `st` directly (runs inside an enclosing mutate).
  function updateTicketCompletions(st, playerId) {
    var pl = st.players[playerId];
    pl.ticketIds.forEach(function (tid) {
      if (pl.ticketState[tid] !== "unstarted") return;
      var t = st.tickets[tid];
      if (citiesConnected(st, playerId, t.a, t.b)) pl.ticketState[tid] = "connected";
    });
  }

  // ── longest continuous path (Task 17) ───────────────────────────
  // Official rule: the longest chain of train pieces in which a route
  // segment may be used at most once and a city may be passed through
  // at most twice (revisits are only ever needed at junctions/loops).
  // Exact DFS over all such trails; the NA map's low city degree keeps
  // this fast. Returns the train count of the player's longest path.
  function longestPathLength(state, playerId) {
    var pl = state.players[playerId];
    var adj = {};                        // city -> [{rid, len, to}]
    pl.claimedRoutes.forEach(function (rid) {
      var r = state.routes[rid];
      (adj[r.a] = adj[r.a] || []).push({ rid: rid, len: r.length, to: r.b });
      (adj[r.b] = adj[r.b] || []).push({ rid: rid, len: r.length, to: r.a });
    });
    var best = 0;
    var used = {};                       // route ids already on the trail
    var visits = {};                     // city -> times on the trail
    function dfs(city, len) {
      if (len > best) best = len;
      var edges = adj[city] || [];
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (used[e.rid]) continue;
        if ((visits[e.to] || 0) >= 2) continue;
        used[e.rid] = true;
        visits[e.to] = (visits[e.to] || 0) + 1;
        dfs(e.to, len + e.len);
        visits[e.to]--;
        delete used[e.rid];
      }
    }
    Object.keys(adj).forEach(function (city) {
      visits[city] = 1;
      dfs(city, 0);
      visits[city] = 0;
    });
    return best;
  }
  function longestPathLengths(state) {
    return state.players.map(function (pl, i) { return longestPathLength(state, i); });
  }

  // ── end-of-game bonus (Task 17) + final scoring (Task 18) ───────
  // Longest-path award: every player tied for the single longest path
  // receives LONGEST_PATH_BONUS points. Idempotent — stored in
  // state.gameEnd.longestPath so final scoring can read it.
  function applyLongestPathBonusUnchecked(st) {
    if (st.gameEnd.longestPath) return st.gameEnd.longestPath;
    var lengths = longestPathLengths(st);
    var best = Math.max.apply(null, lengths);
    var winnerIds = [];
    if (best > 0) {
      for (var i = 0; i < lengths.length; i++) if (lengths[i] === best) winnerIds.push(i);
    }
    var lp = { lengths: lengths, best: best, winnerIds: winnerIds };
    st.gameEnd.longestPath = lp;
    if (best > 0) {
      winnerIds.forEach(function (pid) {
        st.players[pid].longestPathPoints = LONGEST_PATH_BONUS;
        st.players[pid].score += LONGEST_PATH_BONUS;
      });
      st.log.push({ turn: st.turn.count, playerId: null, action: "longestPath", detail: "winnerIds=" + winnerIds.join(",") + " +" + LONGEST_PATH_BONUS });
    }
    return lp;
  }
  function applyLongestPathBonus(state) {
    return mutate(state, "applyLongestPathBonus", function (st) {
      if (!(isRoundComplete(st) || st.phase === "gameOver"))
        reject("applyLongestPathBonus: the fair final round is not complete");
      return applyLongestPathBonusUnchecked(st);
    });
  }

  // Tie-break ordering for final scores: highest total, then most
  // completed tickets, then longest path. Returns <0 when `a` ranks
  // before `b` (standard sort comparator).
  function rankCompare(a, b) {
    if (b.total !== a.total) return b.total - a.total;
    if (b.completedTickets !== a.completedTickets) return b.completedTickets - a.completedTickets;
    if (b.longestPathLength !== a.longestPathLength) return b.longestPathLength - a.longestPathLength;
    return 0;
  }

  // Final scoring: routePoints + completed ticket values − incomplete
  // ticket values + longest-path bonus, then winner resolution with
  // tie-breaks (more completed tickets, then longer longest path, then
  // shared victory). Freezes satisfied tickets to "complete" and writes
  // a full breakdown into gameEnd.breakdown. Idempotent.
  function finalScores(state) {
    return mutate(state, "finalScores", function (st) {
      if (st.phase === "playing") {
        if (!isRoundComplete(st)) reject("finalScores: the fair final round is not complete");
      } else if (st.phase !== "gameOver") {
        reject("finalScores: requires phase 'playing' (round complete) or 'gameOver'");
      }
      if (st.phase === "gameOver" && st.gameEnd.breakdown) return st.gameEnd.breakdown;
      applyLongestPathBonusUnchecked(st);
      st.players.forEach(function (pl) {
        pl.ticketIds.forEach(function (tid) {
          if (pl.ticketState[tid] === "connected") pl.ticketState[tid] = "complete";
        });
      });
      var bdPlayers = st.players.map(function (pl, i) {
        var tickets = pl.ticketIds.map(function (tid) {
          var t = st.tickets[tid];
          var satisfied = pl.ticketState[tid] === "complete";
          return { ticketId: tid, a: t.a, b: t.b, value: t.value, satisfied: satisfied, points: satisfied ? t.value : -t.value };
        });
        var ticketPoints = 0, completed = 0;
        tickets.forEach(function (tk) { ticketPoints += tk.points; if (tk.satisfied) completed++; });
        return {
          playerId: i, name: pl.name,
          routePoints: pl.routePoints,
          ticketPoints: ticketPoints,
          tickets: tickets,
          completedTickets: completed,
          longestPathLength: st.gameEnd.longestPath.lengths[i],
          longestPathPoints: pl.longestPathPoints,
          total: pl.routePoints + ticketPoints + pl.longestPathPoints
        };
      });
      var ranked = bdPlayers.slice().sort(rankCompare);
      var top = ranked[0];
      var winnerIds = [];
      ranked.forEach(function (p, idx) {
        p.rank = idx + 1;
        p.winner = p.total === top.total && p.completedTickets === top.completedTickets &&
                   p.longestPathLength === top.longestPathLength;
        if (p.winner) winnerIds.push(p.playerId);
      });
      var breakdown = { players: bdPlayers, ranked: ranked, winners: winnerIds };
      st.gameEnd.breakdown = breakdown;
      st.gameEnd.winnerId = winnerIds[0];
      st.gameEnd.winnerIds = winnerIds;
      st.gameEnd.reason = "score";
      st.phase = "gameOver";
      st.players.forEach(function (pl, i) { pl.score = bdPlayers[i].total; });
      st.log.push({ turn: st.turn.count, playerId: winnerIds[0], action: "gameOver", detail: "winners=" + winnerIds.join(",") });
      return breakdown;
    });
  }

  // ── AI opponent policies (Tasks 19–21) ──────────────────────────
  // Every AI decision only ever produces an action the engine's own
  // validation accepts, and all randomness flows through gameRng(state)
  // so a seeded game (including its AI) replays identically.
  // difficulty: "easy" | "normal" | "hard" (greedy with less/more noise).
  var AI_DIFFICULTIES = ["easy", "normal", "hard"];

  // Shortest path from a to b for `playerId` over the routes still
  // available to them: own claimed routes cost 0 (already built),
  // unclaimed routes cost their train length, other players' routes are
  // impassable. Returns {length, colors, edges} (colors/edges = those of
  // the unclaimed edges on the path, gray edges contribute length but no
  // forced color) or null when the two cities are not reachable. The
  // basis for every "how much do I still need this" heuristic.
  function aiShortestPath(st, playerId, a, b) {
    if (a === b) return { length: 0, colors: [], edges: [] };
    var owner = {};
    st.players.forEach(function (pl, i) {
      pl.claimedRoutes.forEach(function (rid) { owner[rid] = i; });
    });
    var dist = {}, prev = {}, done = {};
    Object.keys(st.routes).forEach(function (rid) {
      dist[st.routes[rid].a] = Infinity;
      dist[st.routes[rid].b] = Infinity;
    });
    dist[a] = 0;
    while (true) {
      var cur = null, best = Infinity;
      for (var city in dist) {
        if (!done[city] && dist[city] < best) { best = dist[city]; cur = city; }
      }
      if (cur == null) break;
      done[cur] = true;
      for (var rid in st.routes) {
        var r = st.routes[rid];
        var nb = null;
        if (r.a === cur) nb = r.b; else if (r.b === cur) nb = r.a;
        if (nb == null || done[nb]) continue;
        var o = owner[rid];
        var cost;
        if (o === playerId) cost = 0;          // my own route is already built
        else if (o == null) cost = r.length;   // open route
        else continue;                         // claimed by someone else
        var nd = dist[cur] + cost;
        if (nd < dist[nb]) { dist[nb] = nd; prev[nb] = { from: cur, rid: rid, color: r.color, cost: cost }; }
      }
    }
    if (!isFinite(dist[b])) return null;
    var colors = [], edges = [], cur2 = b;
    while (cur2 !== a) {
      var step = prev[cur2];
      if (step.cost > 0) {
        edges.push(step.rid);
        if (step.color !== "gray") colors.push(step.color);
      }
      cur2 = step.from;
    }
    return { length: dist[b], colors: colors, edges: edges };
  }

  // Per-route bonus map: each unclaimed route that lies on the shortest
  // available path of one of the player's unconnected tickets earns a
  // share of that ticket's value, so claims naturally build toward the
  // player's destinations.
  function aiTicketPathBonuses(st, playerId) {
    var bonus = {};
    var pl = st.players[playerId];
    pl.ticketIds.forEach(function (tid) {
      if (pl.ticketState[tid] !== "unstarted") return;
      var t = st.tickets[tid];
      var path = aiShortestPath(st, playerId, t.a, t.b);
      if (!path || path.edges.length === 0) return;
      var w = t.value / path.edges.length;
      path.edges.forEach(function (rid) { bonus[rid] = (bonus[rid] || 0) + w; });
    });
    return bonus;
  }

  // Weighted palette of colors the player most needs, gathered from the
  // shortest available paths toward each unconnected ticket (heavier
  // for higher-value tickets).
  function aiNeededColors(st, playerId) {
    var needed = {};
    COLORS.forEach(function (c) { needed[c] = 0; });
    var pl = st.players[playerId];
    pl.ticketIds.forEach(function (tid) {
      if (pl.ticketState[tid] !== "unstarted") return;
      var path = aiShortestPath(st, playerId, st.tickets[tid].a, st.tickets[tid].b);
      if (!path) return;
      var w = Math.max(1, st.tickets[tid].value / 4);
      path.colors.forEach(function (c) { needed[c] += w; });
    });
    return needed;
  }

  // Task 19 — card-draw policy. Returns {type:"faceUp", index} or
  // {type:"blind"}, or null when no draw is currently legal (turn full
  // or piles empty). Honors the locomotive rules (fresh locos and locos
  // as a second draw are never chosen).
  function aiChooseDraw(state, playerId, difficulty) {
    return mutate(state, "aiChooseDraw", function (st) {
      if (st.phase !== "playing" || st.turn.active !== playerId) reject("aiChooseDraw: not " + st.players[playerId].name + "'s turn");
      var turn = st.turn;
      if (turn.substate !== "drawingCards") reject("aiChooseDraw requires substate 'drawingCards'");
      if (turn.locoLock || turn.cardsDrawn >= 2) return null;
      var needed = aiNeededColors(st, playerId);
      var options = [];
      for (var i = 0; i < FACEUP_SIZE; i++) {
        var card = st.faceUp[i];
        if (card === LOCOMOTIVE) {
          if (st.faceUpFresh[i] || turn.cardsDrawn > 0) continue;   // illegal: fresh, or a loco as the 2nd card
          options.push({ kind: "faceUp", idx: i, value: 8 + (needed[card] || 0) });
        } else {
          options.push({ kind: "faceUp", idx: i, value: (needed[card] || 0) + 1.5 });
        }
      }
      var pile = st.decks.train.draw.concat(st.decks.train.discard);
      if (pile.length > 0) {
        var blindValue = 0;
        pile.forEach(function (c) { blindValue += (c === LOCOMOTIVE) ? 8 : ((needed[c] || 0) + 1.5); });
        options.push({ kind: "blind", value: blindValue / pile.length });
      }
      if (options.length === 0) return null;
      var best = options[0];
      options.forEach(function (o) { if (o.value > best.value) best = o; });
      var randChance = difficulty === "easy" ? 0.7 : difficulty === "normal" ? 0.3 : 0;
      if (gameRng(st).next() < randChance) {
        var pick = options[gameRng(st).int(options.length)];
        return pick.kind === "faceUp" ? { type: "faceUp", index: pick.idx } : { type: "blind" };
      }
      return best.kind === "faceUp" ? { type: "faceUp", index: best.idx } : { type: "blind" };
    });
  }

  // Score one route claim for a player: base route points + the value of
  // any tickets it would newly connect (ticket-connectivity gain) + a
  // share of the value of every ticket whose shortest path uses this
  // route (ticket-progress gain) + length feasibility (keeping trains in
  // reserve) + color surplus of the payment (prefer paying with a color
  // the hand overflows).
  function aiRouteScore(st, playerId, rid, color, locos, edgeBonus) {
    var r = st.routes[rid];
    var pl = st.players[playerId];
    var score = ROUTE_POINTS[r.length];
    if (edgeBonus && edgeBonus[rid]) score += edgeBonus[rid];
    var sim = cloneState(st);
    sim.players[playerId].claimedRoutes.push(rid);
    sim.players[playerId].ticketIds.forEach(function (tid) {
      if (sim.players[playerId].ticketState[tid] !== "unstarted") return;
      var t = sim.tickets[tid];
      if (citiesConnected(sim, playerId, t.a, t.b)) score += t.value * 0.9;
    });
    var trainsLeft = pl.trains - r.length;
    if (trainsLeft <= 8) score += 1;
    if (pl.trains <= 12 && r.length > 4) score -= 2;
    var surplus = color ? pl.hand[color] - r.length : pl.hand.locomotive - r.length;
    if (surplus >= 0) score += Math.min(3, surplus * 0.5);
    return score;
  }

  // Substate-agnostic version of claimBlockedReason for route evaluation:
  // true when the active player may legally claim `routeId` right now,
  // regardless of the turn's substate (the AI evaluates candidates while
  // it is still choosing its action). The claim itself is later validated
  // by the full claimBlockedReason/claimRoute path.
  function claimEligible(st, routeId) {
    var r = st.routes[routeId];
    if (!r) return false;
    if (st.phase !== "playing") return false;
    if (isRoundComplete(st)) return false;
    var pl = st.players[st.turn.active];
    if (routeOwner(st, routeId)) return false;
    if (pl.trains < r.length) return false;
    if (doubleRouteLocked(st, routeId)) return false;
    return cardPaymentOptions(pl, r).length > 0;
  }

  // Task 20 — route-claim policy. Returns {routeId, payment} for a
  // claim the engine would accept right now, or null when nothing is
  // claimable. Greedy (hard) or noisy (easy).
  function aiChooseRoute(state, playerId, difficulty) {
    return mutate(state, "aiChooseRoute", function (st) {
      if (st.phase !== "playing" || st.turn.active !== playerId) reject("aiChooseRoute: not " + st.players[playerId].name + "'s turn");
      if (st.turn.substate !== "claimingRoute") reject("aiChooseRoute requires substate 'claimingRoute'");
      var edgeBonus = aiTicketPathBonuses(st, playerId);
      var candidates = [];
      for (var rid in st.routes) {
        if (!claimEligible(st, rid)) continue;
        var payments = cardPaymentOptions(st.players[playerId], st.routes[rid]);
        if (payments.length === 0) continue;
        var bestPay = null, bestVal = -Infinity;
        payments.forEach(function (p) {
          var v = aiRouteScore(st, playerId, rid, p.color, p.locos, edgeBonus);
          if (v > bestVal) { bestVal = v; bestPay = p; }
        });
        candidates.push({ routeId: rid, payment: bestPay, value: bestVal });
      }
      if (candidates.length === 0) return null;
      candidates.sort(function (a, b) { return b.value - a.value; });
      var randChance = difficulty === "easy" ? 0.65 : difficulty === "normal" ? 0.3 : 0;
      if (gameRng(st).next() < randChance) {
        return candidates[gameRng(st).int(candidates.length)];
      }
      return candidates[0];
    });
  }

  // Task 21 — ticket-draw keep policy. Scores each pending ticket by its
  // value minus the remaining cost to connect it (shortest path priced
  // down by the colors the hand already holds — the "expected
  // connectivity of the hand"). Always returns at least 1 ticket.
  function aiTicketFit(st, playerId, tid) {
    var t = st.tickets[tid];
    var pl = st.players[playerId];
    var path = aiShortestPath(st, playerId, t.a, t.b);
    if (!path) return -Infinity;
    if (path.length === 0) return 1000;   // endpoints already connected
    var cost = path.length;
    path.colors.forEach(function (c) {
      var have = pl.hand[c];
      if (have > 0) cost -= Math.min(have, path.colors.length) * 0.75;
    });
    return t.value - cost;
  }
  function aiChooseTicketKeep(state, playerId, difficulty) {
    return mutate(state, "aiChooseTicketKeep", function (st) {
      if (st.phase !== "playing" || st.turn.active !== playerId) reject("aiChooseTicketKeep: not " + st.players[playerId].name + "'s turn");
      if (st.pendingTickets.length === 0) reject("aiChooseTicketKeep: no pending ticket draw");
      var scored = st.pendingTickets.map(function (tid) { return { ticketId: tid, fit: aiTicketFit(st, playerId, tid) }; });
      scored.sort(function (a, b) { return b.fit - a.fit; });
      var keep = [scored[0].ticketId];
      var randChance = difficulty === "easy" ? 0.6 : difficulty === "normal" ? 0.25 : 0;
      var r = gameRng(st).next();
      scored.slice(1).forEach(function (sc) {
        if (sc.fit <= 0) return;
        if (r < randChance && gameRng(st).next() < 0.5) return;   // noisy difficulty occasionally discards a marginal ticket
        keep.push(sc.ticketId);
      });
      return keep;
    });
  }

  // Choose the action to start the player's turn: "drawingCards",
  // "claimingRoute", or "drawingTickets" (or null when no legal action
  // remains). Weighs a good claim vs. still-needed tickets vs. card
  // stockpiling, then applies difficulty noise.
  function aiChooseAction(state, playerId, difficulty) {
    return mutate(state, "aiChooseAction", function (st) {
      if (st.phase !== "playing" || st.turn.active !== playerId) reject("aiChooseAction: not " + st.players[playerId].name + "'s turn");
      var legal = legalActions(st);
      if (legal.length === 0) return null;
      var edgeBonus = aiTicketPathBonuses(st, playerId);
      var bestClaim = null;
      for (var rid in st.routes) {
        if (!claimEligible(st, rid)) continue;
        var payments = cardPaymentOptions(st.players[playerId], st.routes[rid]);
        if (payments.length === 0) continue;
        var val = -Infinity;
        payments.forEach(function (p) { var v = aiRouteScore(st, playerId, rid, p.color, p.locos, edgeBonus); if (v > val) val = v; });
        if (!bestClaim || val > bestClaim.value) bestClaim = { routeId: rid, value: val };
      }
      var pl = st.players[playerId];
      var ticketsLeft = 0;
      pl.ticketIds.forEach(function (tid) { if (pl.ticketState[tid] === "unstarted") ticketsLeft++; });
      var ticketsAvailable = st.decks.tickets.draw.length + st.decks.tickets.discard.length > 0;
      // Endgame urgency: with the train deck exhausted (or trains running
      // low) drawing cards is pointless — claim anything affordable, or
      // gamble on tickets if nothing is claimable at all.
      var deckEmpty = st.decks.train.draw.length + st.decks.train.discard.length === 0;
      var urgent = deckEmpty || pl.trains <= 5;
      var wantTickets = ticketsAvailable && (ticketsLeft < 3 || urgent);
      var action;
      if (bestClaim && (bestClaim.value >= 3 || urgent)) {
        action = "claimingRoute";
      } else if (wantTickets && (bestClaim === null || bestClaim.value < 2)) {
        action = "drawingTickets";
      } else {
        action = "drawingCards";
      }
      var randChance = difficulty === "easy" ? 0.6 : difficulty === "normal" ? 0.25 : 0;
      if (gameRng(st).next() < randChance) {
        var options = [];
        if (legal.indexOf("drawingCards") !== -1) options.push("drawingCards");
        if (legal.indexOf("claimingRoute") !== -1 && bestClaim) options.push("claimingRoute");
        if (legal.indexOf("drawingTickets") !== -1 && wantTickets) options.push("drawingTickets");
        if (options.length === 0) return legal[gameRng(st).int(legal.length)];
        return options[gameRng(st).int(options.length)];
      }
      return action;
    });
  }

  // Play the player's entire current turn through the validated engine
  // (resuming a mid-action substate if one is open). Returns a small
  // summary. Because every step goes through enterAction / takeFaceUpCard /
  // drawBlindCard / claimRoute / beginTicketDraw / resolveTicketDraw /
  // completeTurn, an AI can never produce an illegal move.
  function aiTakeTurn(state, playerId, difficulty) {
    if (state.phase !== "playing" || state.turn.active !== playerId)
      reject("aiTakeTurn: not " + state.players[playerId].name + "'s turn");
    var summary = { playerId: playerId, action: null, detail: null };
    var sub = state.turn.substate;
    if (sub === "chooseAction") {
      var action = aiChooseAction(state, playerId, difficulty);
      if (!action) {
        // Dead board: nothing is executable (no cards, no affordable route,
        // no tickets). Complete an empty card-draw so completeTurn's stall
        // guard flags the end of the game and the final round plays out.
        enterAction(state, "drawingCards");
        completeTurn(state);
        summary.action = "none";
        return summary;
      }
      enterAction(state, action);
      sub = action;
    }
    if (sub === "drawingCards") {
      var draws = 0;
      while (true) {
        if (state.turn.locoLock || state.turn.cardsDrawn >= 2) break;
        if (state.decks.train.draw.length + state.decks.train.discard.length === 0) break;
        var choice = aiChooseDraw(state, playerId, difficulty);
        if (!choice) break;
        if (choice.type === "faceUp") takeFaceUpCard(state, choice.index);
        else drawBlindCard(state);
        if (++draws > 4) throw new Error("aiTakeTurn: draw loop runaway");
      }
      summary.action = "drawingCards";
      summary.detail = draws + " card(s)";
      completeTurn(state);
    } else if (sub === "claimingRoute") {
      var claim = aiChooseRoute(state, playerId, difficulty);
      if (!claim) throw new Error("aiTakeTurn: in claimingRoute but no legal claim exists");
      claimRoute(state, claim.routeId, claim.payment);
      summary.action = "claimingRoute";
      summary.detail = claim.routeId;
      completeTurn(state);
    } else if (sub === "drawingTickets") {
      if (state.pendingTickets.length === 0) {
        beginTicketDraw(state);
        if (state.pendingTickets.length === 0) throw new Error("aiTakeTurn: ticket deck empty");
      }
      var keep = aiChooseTicketKeep(state, playerId, difficulty);
      resolveTicketDraw(state, keep);
      summary.action = "drawingTickets";
      summary.detail = keep.join(",");
      completeTurn(state);
    }
    return summary;
  }

  // Test helper: move `cards` from the draw pile into a player's hand
  // (conservation kept).
  function testGiveCards(state, playerId, cards) {
    mutate(state, "test-give-cards", function (st) {
      var pl = st.players[playerId];
      cards.forEach(function (c) {
        var idx = st.decks.train.draw.indexOf(c);
        if (idx === -1) throw new Error("wanted card '" + c + "' not in draw pile");
        st.decks.train.draw.splice(idx, 1);
        pl.hand[c]++;
      });
    });
  }
  // Test helper: move a specific ticket from the ticket draw pile into
  // a player's hand as "unstarted" (mirrors testGiveCards).
  function testGiveTicket(state, playerId, ticketId) {
    mutate(state, "test-give-ticket", function (st) {
      var pl = st.players[playerId];
      var idx = st.decks.tickets.draw.indexOf(ticketId);
      if (idx === -1) throw new Error("wanted ticket '" + ticketId + "' not in ticket draw pile");
      st.decks.tickets.draw.splice(idx, 1);
      pl.ticketIds.push(ticketId);
      pl.ticketState[ticketId] = "unstarted";
    });
  }

  // ── validation test suite ────────────────────────────────────────
  // Returns {passed, failed, results:[{name, ok, error}]}. Pure, no
  // page dependencies — safe to run from browser_eval.
  function runStateModelTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectThrow(name, fn) {
      t(name, function () {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        if (!threw) throw new Error("expected assertion to throw");
      });
    }

    // Build a legal mid-game state via the shared module-level fixture
    // `makePlaying` (full official 110-card deck, 5 face-up + 4 per player).

    t("createState yields a valid state", function () { assertState(createState()); });
    t("official deck composition is 8×12 + 14 = 110", function () {
      var deck = buildTrainDeck();
      if (deck.length !== TOTAL_TRAIN_CARDS) throw new Error("deck length " + deck.length + " != " + TOTAL_TRAIN_CARDS);
      if (CARD_TYPES.length !== 9) throw new Error("expected 8 colors + locomotive");
      var counts = {};
      deck.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
      if (counts[LOCOMOTIVE] !== LOCO_COUNT) throw new Error("loco count " + counts[LOCOMOTIVE]);
      COLORS.forEach(function (c) { if (counts[c] !== TRAIN_CARDS_PER_COLOR) throw new Error(c + " count " + counts[c]); });
    });
    t("createState honors player names/kinds", function () {
      var s = createState({ players: [{ name: "Alice" }, { name: "Bob", kind: "ai" }] });
      if (s.players[0].name !== "Alice") throw new Error("name lost");
      if (s.players[1].kind !== "ai") throw new Error("kind lost");
      if (s.players.length !== 2) throw new Error("player count");
    });
    t("3-5 players valid", function () {
      [3, 4, 5].forEach(function (n) {
        var arr = []; for (var i = 0; i < n; i++) arr.push({ name: "P" + i });
        assertState(createState({ players: arr }));
      });
    });
    t("one and six players rejected", function () {
      expectThrow("one player rejected", function () { assertState(createState({ players: [{ name: "P" }] })); });
      var six = []; for (var k = 0; k < 6; k++) six.push({ name: "P" + k });
      expectThrow("six players rejected", function () { assertState(createState({ players: six })); });
    });
    t("bad phase rejected", function () {
      var s = createState(); s.phase = "bogus";
      expectThrow("bad phase", function () { assertState(s); });
    });
    t("negative trains rejected", function () {
      var s = createState(); s.players[0].trains = -1;
      expectThrow("negative trains", function () { assertState(s); });
    });
    t("legal mid-game state passes (conservation = 110)", function () {
      var s = makePlaying();
      var held = s.faceUp.length + s.decks.train.draw.length + s.decks.train.discard.length;
      s.players.forEach(function (p) {
        Object.keys(p.hand).forEach(function (c) { held += p.hand[c]; });
      });
      if (held !== TOTAL_TRAIN_CARDS) throw new Error("held " + held);
      assertState(s);
    });
    t("phantom cards in a hand break conservation", function () {
      var s = makePlaying(); s.players[0].hand.red = 99;
      expectThrow("phantom cards", function () { assertState(s); });
    });
    t("same route claimed twice rejected", function () {
      var s = makePlaying();
      s.players[0].claimedRoutes.push("Denver-Oklahoma City");
      s.players[1].claimedRoutes.push("Denver-Oklahoma City");
      expectThrow("double claim", function () { assertState(s); });
    });
    t("same ticket held twice rejected", function () {
      var s = makePlaying();
      s.tickets["t1"] = { a: "A", b: "B", value: 5 };
      s.players[0].ticketIds.push("t1"); s.players[0].ticketState["t1"] = "unstarted";
      s.players[1].ticketIds.push("t1"); s.players[1].ticketState["t1"] = "unstarted";
      expectThrow("double ticket", function () { assertState(s); });
    });
    t("ticket in hand must exist in catalog and have a state", function () {
      var s = makePlaying();
      s.players[0].ticketIds.push("nope"); s.players[0].ticketState["nope"] = "unstarted";
      expectThrow("unknown ticket", function () { assertState(s); });
    });
    t("faceUp must be exactly 5 while playing", function () {
      var s = makePlaying(); s.faceUp = ["red", "blue", "black"];
      expectThrow("short faceUp", function () { assertState(s); });
    });
    t("cardsDrawn can't exceed 2", function () {
      var s = makePlaying(); s.turn.cardsDrawn = 3;
      expectThrow("cardsDrawn 3", function () { assertState(s); });
    });
    t("locoLock caps turn at 1 drawn card", function () {
      var s = makePlaying(); s.turn.locoLock = true; s.turn.cardsDrawn = 2;
      expectThrow("locoLock + 2 draws", function () { assertState(s); });
    });
    t("gameOver requires a winner + reason", function () {
      var s = makePlaying(); s.phase = "gameOver";
      expectThrow("gameOver w/o winner", function () { assertState(s); });
      s.gameEnd.winnerId = 0; s.gameEnd.reason = "score";
      assertState(s);
    });
    t("gameEnd triggered block is valid during playing", function () {
      var s = makePlaying();
      s.gameEnd.triggered = true; s.gameEnd.triggerPlayerId = 0;
      assertState(s);
      expectThrow("trigger during setup rejected", function () {
        var s2 = createState(); s2.gameEnd.triggered = true; s2.gameEnd.triggerPlayerId = 0;
        assertState(s2);
      });
    });
    t("mutate() rejects illegal mutations with the label", function () {
      var s = makePlaying();
      var err = null;
      try { mutate(s, "cheat-card", function (st) { st.players[0].hand.red = 99; }); }
      catch (e) { err = e.message; }
      if (!err || err.indexOf("cheat-card") === -1) throw new Error("no labeled error: " + err);
      if (err.indexOf("conservation") === -1) throw new Error("wrong error: " + err);
    });
    t("mutate() allows legal changes", function () {
      var s = makePlaying();
      mutate(s, "legal-claim", function (st) { st.players[0].trains -= 2; });
      if (s.players[0].trains !== TRAINS_START - 2) throw new Error("mutation not applied");
    });
    t("mutate() validates the pre-state too (corrupt input rejected)", function () {
      var s = makePlaying(); s.turn.active = 99;
      expectThrow("corrupt pre-state", function () { mutate(s, "x", function (st) {}); });
    });
    t("serialization round-trip preserves the state", function () {
      var s = makePlaying();
      s.players[0].claimedRoutes.push("Denver-Oklahoma City");
      s.players[0].routePoints = 7;
      var back = fromJSON(toJSON(s));
      if (toJSON(back) !== toJSON(s)) throw new Error("round-trip mismatch");
      assertState(back);
    });
    t("cloneState is a deep independent copy", function () {
      var s = makePlaying();
      var c = cloneState(s);
      c.players[0].score = 5;
      if (s.players[0].score !== 0) throw new Error("clone shares state");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    var failed = results.length - passed;
    return { passed: passed, failed: failed, total: results.length, results: results };
  }

  // ── state machine test suite ─────────────────────────────────────
  // Returns {passed, failed, results}. Uses the same result shape as
  // runStateModelTests.
  function runStateMachineTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectThrow(name, fn) {
      t(name, function () {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        if (!threw) throw new Error("expected transition to be rejected");
      });
    }
    function expectReason(name, fn, needle) {
      t(name, function () {
        var err = null;
        try { fn(); } catch (e) { err = e.message; }
        if (!err) throw new Error("expected a rejection mentioning '" + needle + "'");
        if (err.indexOf(needle) === -1) throw new Error("rejection reason missing '" + needle + "': " + err);
      });
    }

    t("startGame flips setup→playing and resets turn fields", function () {
      var s = makeSetupReady();
      startGame(s);
      if (s.phase !== "playing") throw new Error("phase " + s.phase);
      if (s.turn.active !== 0 || s.turn.count !== 0 || s.turn.substate !== "chooseAction" ||
          s.turn.cardsDrawn !== 0 || s.turn.locoLock) throw new Error("turn fields not reset");
    });
    expectReason("startGame from playing rejected", function () { startGame(makePlaying()); }, "setup");
    expectReason("startGame from gameOver rejected", function () {
      var s = makePlaying(); endGame(s, 0, "score"); startGame(s);
    }, "setup");
    t("enterAction accepts each of the three legal actions", function () {
      SUBSTATE_TRANSITIONS.chooseAction.forEach(function (a) {
        var s = cloneState(makePlaying());
        enterAction(s, a);
        if (s.turn.substate !== a) throw new Error("substate for " + a);
      });
    });
    expectReason("enterAction mid-action rejected", function () {
      var s = makePlaying(); enterAction(s, "drawingCards"); enterAction(s, "claimingRoute");
    }, "chooseAction");
    expectReason("enterAction during setup rejected", function () {
      enterAction(createState(), "drawingCards");
    }, "playing");
    expectReason("enterAction with bogus action rejected", function () {
      enterAction(makePlaying(), "bogus");
    }, "not a legal action");
    expectReason("enterAction with chooseAction itself rejected", function () {
      enterAction(makePlaying(), "chooseAction");
    }, "not a legal action");
    t("completeTurn advances count + player and resets the substate", function () {
      var s = makePlaying();
      enterAction(s, "drawingCards");
      s.turn.cardsDrawn = 2;
      completeTurn(s);
      if (s.turn.count !== 1) throw new Error("count " + s.turn.count);
      if (s.turn.active !== 1) throw new Error("active " + s.turn.active);
      if (s.turn.substate !== "chooseAction") throw new Error("substate " + s.turn.substate);
      if (s.turn.cardsDrawn !== 0 || s.turn.locoLock) throw new Error("draw fields not reset");
    });
    t("turn rotation wraps around with 3 players", function () {
      var s = makePlaying(3, 5);
      var seen = [];
      for (var i = 0; i < 3; i++) { enterAction(s, "drawingTickets"); seen.push(s.turn.active); completeTurn(s); }
      if (s.turn.active !== 0) throw new Error("active " + s.turn.active);
      if (JSON.stringify(seen) !== JSON.stringify([0, 1, 2])) throw new Error("rotation " + JSON.stringify(seen));
    });
    t("full action cycle is legal across many turns", function () {
      var s = makePlaying(3, 9);
      var acts = ["drawingCards", "claimingRoute", "drawingTickets"];
      for (var i = 0; i < 6; i++) {
        var a = acts[i % 3];
        enterAction(s, a);
        if (a === "drawingCards") s.turn.cardsDrawn = 2;
        if (a === "claimingRoute") s.turn.claimedRouteId = "Seattle-Vancouver";
        completeTurn(s);
      }
      if (s.turn.count !== 6) throw new Error("count " + s.turn.count);
      if (s.turn.active !== 0) throw new Error("active " + s.turn.active);
    });
    expectReason("completeTurn during setup rejected", function () { completeTurn(createState()); }, "playing");
    expectReason("completeTurn in chooseAction rejected", function () { completeTurn(makePlaying()); }, "no action in progress");
    expectReason("completeTurn after gameOver rejected", function () {
      var s = makePlaying(); endGame(s, 0, "score"); completeTurn(s);
    }, "playing");
    t("endGame works from playing", function () {
      var s = makePlaying();
      endGame(s, 1, "score");
      if (s.phase !== "gameOver") throw new Error("phase " + s.phase);
      if (s.gameEnd.winnerId !== 1 || s.gameEnd.reason !== "score") throw new Error("gameEnd fields");
      assertState(s);
    });
    expectReason("endGame during setup rejected", function () { endGame(createState(), 0, "score"); }, "playing");
    expectReason("endGame with bad winnerId rejected", function () { endGame(makePlaying(), 9, "score"); }, "winnerId");
    expectReason("endGame with bad reason rejected", function () { endGame(makePlaying(), 0, "nope"); }, "reason");
    expectReason("endGame twice rejected (gameOver terminal)", function () {
      var s = makePlaying(); endGame(s, 0, "score"); endGame(s, 0, "score");
    }, "playing");
    t("gameOver is terminal: no actions or turns after", function () {
      var s = makePlaying(); endGame(s, 0, "score");
      var errs = 0;
      try { enterAction(s, "drawingCards"); } catch (e) { errs++; }
      try { completeTurn(s); } catch (e) { errs++; }
      try { startGame(s); } catch (e) { errs++; }
      if (errs !== 3) throw new Error("expected 3 rejections, got " + errs);
    });
    t("predicates reflect legality", function () {
      var s = makeSetupReady();
      if (!canStartGame(s) || legalActions(s).length !== 0 || canCompleteTurn(s)) throw new Error("setup predicates");
      startGame(s);
      if (canStartGame(s)) throw new Error("canStartGame after start");
      if (legalActions(s).length !== 3) throw new Error("legalActions " + legalActions(s).length);
      if (canCompleteTurn(s)) throw new Error("canCompleteTurn in chooseAction");
      enterAction(s, "drawingCards");
      if (legalActions(s).length !== 0) throw new Error("legalActions mid-action");
      if (canCompleteTurn(s)) throw new Error("canCompleteTurn before the action completes");
      s.turn.cardsDrawn = 2;
      if (!canCompleteTurn(s)) throw new Error("canCompleteTurn mid-action");
    });
    t("rejection messages carry a reason", function () {
      var s = makePlaying();
      var msg = null;
      try { endGame(s, 2, "score"); } catch (e) { msg = e.message; }
      if (!msg || msg.indexOf("rejected") === -1 || msg.indexOf("winnerId") === -1) throw new Error("bad message: " + msg);
    });
    t("state remains valid after each transition", function () {
      var s = makeSetupReady(3, 11);
      startGame(s);
      enterAction(s, "drawingTickets");
      completeTurn(s);
      enterAction(s, "claimingRoute");
      s.turn.claimedRouteId = "Denver-Oklahoma City";
      completeTurn(s);
      enterAction(s, "drawingCards");
      s.turn.cardsDrawn = 2;
      completeTurn(s);
      endGame(s, 2, "score");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    var failed = results.length - passed;
    return { passed: passed, failed: failed, total: results.length, results: results };
  }

  // ── map data test suite ──────────────────────────────────────────
  function runMapTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectThrow(name, fn) {
      t(name, function () {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        if (!threw) throw new Error("expected validation to throw");
      });
    }

    t("map has 36 cities, each with valid coordinates", function () {
      if (Object.keys(MAP.cities).length !== 36) throw new Error("cities " + Object.keys(MAP.cities).length);
      Object.keys(MAP.cities).forEach(function (n) {
        var c = MAP.cities[n];
        if (c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1) throw new Error(n + " coords out of bounds");
      });
    });
    t("map has 100 route segments across 78 distinct city pairs", function () {
      var segs = Object.keys(MAP.routes).length;
      var pairs = new Set();
      Object.keys(MAP.routes).forEach(function (rid) { pairs.add(rid.replace(/#\d+$/, "")); });
      if (segs !== 100) throw new Error("segments " + segs);
      if (pairs.size !== 78) throw new Error("pairs " + pairs.size);
    });
    t("22 double routes exist and each pair has at most 2 segments", function () {
      var count = {};
      Object.keys(MAP.routes).forEach(function (rid) {
        var key = rid.replace(/#\d+$/, "");
        count[key] = (count[key] || 0) + 1;
        if (count[key] > 2) throw new Error("3 segments for " + key);
      });
      var doubles = Object.keys(count).filter(function (k) { return count[k] === 2; }).length;
      if (doubles !== 22) throw new Error("doubles " + doubles);
    });
    t("every route has valid color + length 1..6", function () {
      Object.keys(MAP.routes).forEach(function (rid) {
        var r = MAP.routes[rid];
        if (r.color !== "gray" && COLORS.indexOf(r.color) === -1) throw new Error(rid + " color " + r.color);
        if (!Number.isInteger(r.length) || r.length < 1 || r.length > 6) throw new Error(rid + " length " + r.length);
      });
    });
    t("double-route segments of a pair share the same length", function () {
      var len = {};
      Object.keys(MAP.routes).forEach(function (rid) {
        var r = MAP.routes[rid];
        var key = pairId(r.a, r.b);
        if (len[key] != null && len[key] !== r.length) throw new Error("mismatch " + key);
        len[key] = r.length;
      });
    });
    t("map graph is fully connected (all 36 cities reachable)", function () {
      validateMap(MAP);
      var adj = {};
      Object.keys(MAP.cities).forEach(function (n) { adj[n] = []; });
      Object.keys(MAP.routes).forEach(function (rid) {
        adj[MAP.routes[rid].a].push(MAP.routes[rid].b);
        adj[MAP.routes[rid].b].push(MAP.routes[rid].a);
      });
      var seen = { Atlanta: true }, stack = ["Atlanta"];
      while (stack.length) {
        adj[stack.pop()].forEach(function (nb) { if (!seen[nb]) { seen[nb] = true; stack.push(nb); } });
      }
      if (Object.keys(seen).length !== 36) throw new Error("reachable " + Object.keys(seen).length);
    });
    t("spot-checked official routes match the board", function () {
      function r(a, b, n) { return MAP.routes[pairId(a, b) + (n ? "#" + n : "")]; }
      var chk = [
        r("Seattle", "Vancouver"), r("Seattle", "Vancouver", 2), r("Portland", "San Francisco"),
        r("Portland", "San Francisco", 2), r("New York", "Boston"), r("New York", "Boston", 2),
        r("Toronto", "Pittsburgh"), r("Denver", "Salt Lake City"), r("Denver", "Salt Lake City", 2)
      ];
      chk.forEach(function (rr) { if (!rr) throw new Error("missing expected route"); });
      if (r("Seattle", "Vancouver").color !== "gray" || r("Seattle", "Vancouver").length !== 1) throw new Error("Sea-Van");
      if (r("Portland", "San Francisco").color !== "green" || r("Portland", "San Francisco", 2).color !== "purple") throw new Error("Pdx-SF");
      if (r("New York", "Boston").color !== "yellow" || r("New York", "Boston", 2).color !== "red") throw new Error("NY-Bos");
      if (r("Toronto", "Pittsburgh").color !== "gray" || r("Toronto", "Pittsburgh", 2)) throw new Error("Tor-Pit");
      if (r("Denver", "Salt Lake City").color !== "red" || r("Denver", "Salt Lake City", 2).color !== "yellow") throw new Error("Den-SLC");
    });
    t("30 destination tickets, values 4..22, valid endpoints", function () {
      if (MAP.tickets.length !== 30) throw new Error("tickets " + MAP.tickets.length);
      MAP.tickets.forEach(function (t) {
        if (!MAP.cities[t.a] || !MAP.cities[t.b]) throw new Error("bad endpoint " + t.a + "-" + t.b);
        if (t.value < 4 || t.value > 22) throw new Error("bad value " + t.value);
      });
    });
    t("createState installs the map + ticket catalogs and stays valid", function () {
      var s = createState();
      if (Object.keys(s.routes).length !== 100) throw new Error("routes catalog " + Object.keys(s.routes).length);
      if (Object.keys(s.tickets).length !== 30) throw new Error("tickets catalog " + Object.keys(s.tickets).length);
      assertState(s);
      var s2 = makePlaying();
      if (Object.keys(s2.routes).length !== 100) throw new Error("playing catalog");
      assertState(s2);
    });
    t("a claimed route must exist in the map catalog", function () {
      var s = makePlaying();
      s.players[0].claimedRoutes.push("Nowhere-Somewhere");
      expectThrow("ghost route", function () { assertState(s); });
    });
    t("validateMap rejects corrupt maps", function () {
      expectThrow("missing city", function () {
        var m = JSON.parse(JSON.stringify(MAP)); delete m.cities["Denver"]; validateMap(m);
      });
      expectThrow("bad color", function () {
        var m = JSON.parse(JSON.stringify(MAP)); m.routes["Seattle-Vancouver"].color = "teal"; validateMap(m);
      });
      expectThrow("bad length", function () {
        var m = JSON.parse(JSON.stringify(MAP)); m.routes["Seattle-Vancouver"].length = 9; validateMap(m);
      });
      expectThrow("off-board coords", function () {
        var m = JSON.parse(JSON.stringify(MAP)); m.cities["Boston"].x = 2.5; validateMap(m);
      });
      expectThrow("triple route", function () {
        var m = JSON.parse(JSON.stringify(MAP));
        m.routes["Seattle-Vancouver#3"] = { a: "Seattle", b: "Vancouver", color: "gray", length: 1 };
        validateMap(m);
      });
      expectThrow("mismatched double length", function () {
        var m = JSON.parse(JSON.stringify(MAP));
        m.routes["Seattle-Vancouver#2"].length = 2;
        validateMap(m);
      });
      expectThrow("disconnected map", function () {
        var m = JSON.parse(JSON.stringify(MAP));
        Object.keys(m.routes).forEach(function (rid) {
          if (m.routes[rid].a === "Vancouver" || m.routes[rid].b === "Vancouver") delete m.routes[rid];
        });
        validateMap(m);
      });
    });
    t("serialization round-trip keeps catalogs intact", function () {
      var s = makePlaying();
      var back = fromJSON(toJSON(s));
      if (Object.keys(back.routes).length !== 100) throw new Error("routes lost");
      if (Object.keys(back.tickets).length !== 30) throw new Error("tickets lost");
      if (toJSON(back) !== toJSON(s)) throw new Error("round-trip mismatch");
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    var failed = results.length - passed;
    return { passed: passed, failed: failed, total: results.length, results: results };
  }

  // ── seeded PRNG test suite (Task 5) ──────────────────────────────
  function runPrngTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectThrow(name, fn) {
      t(name, function () {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        if (!threw) throw new Error("expected to throw");
      });
    }

    t("same seed produces the same sequence", function () {
      var a = createRng(12345), b = createRng(12345);
      for (var i = 0; i < 1000; i++) if (a.next() !== b.next()) throw new Error("diverged at " + i);
    });
    t("different seeds diverge quickly", function () {
      var a = createRng(1), b = createRng(2), same = 0;
      for (var i = 0; i < 100; i++) if (a.next() === b.next()) same++;
      if (same > 5) throw new Error(same + " identical draws of 100");
    });
    t("next() yields floats in [0,1) with both halves covered", function () {
      var r = createRng(7), lo = 0, hi = 0;
      for (var i = 0; i < 2000; i++) {
        var v = r.next();
        if (v < 0 || v >= 1) throw new Error("out of range " + v);
        if (v < 0.5) lo++; else hi++;
      }
      if (lo < 800 || hi < 800) throw new Error("lopsided " + lo + "/" + hi);
    });
    t("int(n) stays in [0,n)", function () {
      var r = createRng(9);
      for (var i = 0; i < 2000; i++) {
        var v = r.int(6);
        if (v < 0 || v >= 6 || v !== Math.floor(v)) throw new Error("bad int " + v);
      }
    });
    t("pick returns a member of the array", function () {
      var arr = ["a", "b", "c", "d"];
      for (var i = 0; i < 100; i++) {
        var v = createRng(i).pick(arr);
        if (arr.indexOf(v) === -1) throw new Error("pick returned " + v);
      }
    });
    t("shuffle is a permutation of the input", function () {
      var src = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      var out = createRng(3).shuffle(src.slice()).slice().sort(function (a, b) { return a - b; });
      if (out.join() !== "0,1,2,3,4,5,6,7,8,9") throw new Error("not a permutation: " + out.join());
    });
    t("same seed shuffles identically, different seed differs", function () {
      var a = createRng(42).shuffle(["a", "b", "c", "d", "e", "f"]).join();
      var b = createRng(42).shuffle(["a", "b", "c", "d", "e", "f"]).join();
      if (a !== b) throw new Error("same-seed shuffle diverged");
      var c = createRng(43).shuffle(["a", "b", "c", "d", "e", "f"]).join();
      if (a === c) throw new Error("different seeds matched");
    });
    t("gameRng advances the state's rng record", function () {
      var s = createState({ seed: 5 });
      var before = s.rng.state;
      gameRng(s).next();
      if (s.rng.state === before) throw new Error("rng state did not advance");
    });
    t("rng state round-trips through serialization and replay", function () {
      var s = createState({ seed: 11 });
      gameRng(s).int(100);
      var back = fromJSON(toJSON(s));
      if (back.rng.state !== s.rng.state) throw new Error("rng state lost");
      if (gameRng(back).next() !== gameRng(cloneState(s)).next()) throw new Error("replay diverged after clone");
    });
    t("assertState accepts the rng record", function () { assertState(createState({ seed: 1 })); });
    t("newGame(seed) is fully deterministic", function () {
      var a = newGame({ seed: 2024, players: [{ name: "A" }, { name: "B" }] });
      var b = newGame({ seed: 2024, players: [{ name: "A" }, { name: "B" }] });
      if (toJSON(a) !== toJSON(b)) throw new Error("determinism violated");
    });
    t("newGame with different seeds produces a different game", function () {
      var a = newGame({ seed: 1 }), b = newGame({ seed: 2 });
      if (toJSON(a) === toJSON(b)) throw new Error("identical games from different seeds");
    });
    t("newGame deals 5 face-up + 4 starting cards per player", function () {
      var s = newGame({ seed: 99, players: [{ name: "A" }, { name: "B" }, { name: "C" }] });
      if (s.phase !== "playing") throw new Error("phase " + s.phase);
      if (s.faceUp.length !== FACEUP_SIZE) throw new Error("faceUp " + s.faceUp.length);
      s.players.forEach(function (p) {
        var n = 0;
        CARD_TYPES.forEach(function (c) { n += p.hand[c]; });
        if (n !== 4) throw new Error(p.name + " hand " + n);
      });
      var total = s.faceUp.length + s.decks.train.draw.length + s.decks.train.discard.length;
      s.players.forEach(function (p) {
        CARD_TYPES.forEach(function (c) { total += p.hand[c]; });
      });
      if (total !== TOTAL_TRAIN_CARDS) throw new Error("conservation " + total);
    });
    t("newGame leaves a valid playing state", function () { assertState(newGame({ seed: 7 })); });
    t("a seeded game replays identically through 40 draws", function () {
      function run() {
        var s = newGame({ seed: 555 });
        for (var i = 0; i < 40; i++) drawTrainCard(s, function (st, c) { st.decks.train.discard.push(c); });
        return toJSON(s);
      }
      if (run() !== run()) throw new Error("draw sequence not deterministic");
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── train-card deck test suite (Task 6) ──────────────────────────
  function runDeckTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectThrow(name, fn) {
      t(name, function () {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        if (!threw) throw new Error("expected draw to throw");
      });
    }

    t("drawTrainCard returns the top card of the draw pile", function () {
      var s = newGame({ seed: 21 });
      var top = s.decks.train.draw[s.decks.train.draw.length - 1];
      var before = s.decks.train.draw.length;
      var card = drawTrainCard(s, function (st, c) { st.decks.train.discard.push(c); });
      if (card !== top) throw new Error("top card " + card + " != " + top);
      if (s.decks.train.draw.length !== before - 1) throw new Error("pile length");
      assertState(s);
    });
    t("drawTrainCard leaves the face-up row and hands untouched", function () {
      var s = newGame({ seed: 8 });
      var faceUpBefore = s.faceUp.slice().join();
      var handBefore = JSON.stringify(s.players.map(function (p) { return p.hand; }));
      drawTrainCard(s, function (st, c) { st.decks.train.discard.push(c); });
      if (s.faceUp.join() !== faceUpBefore) throw new Error("faceUp changed");
      if (JSON.stringify(s.players.map(function (p) { return p.hand; })) !== handBefore) throw new Error("hands changed");
      assertState(s);
    });
    t("drawTrainCard can place a card directly into a hand", function () {
      var s = newGame({ seed: 77 });
      var h0 = s.players[0].hand;
      drawTrainCard(s, function (st, c) { st.players[0].hand[c]++; });
      var n = 0;
      CARD_TYPES.forEach(function (c) { n += h0[c]; });
      if (n !== 5) throw new Error("hand size " + n);
      assertState(s);
    });
    t("drawing until the deck empties reshuffles the discard pile", function () {
      var s = newGame({ seed: 31 });
      var startDraw = s.decks.train.draw.length;
      var seen = [];
      for (var i = 0; i <= startDraw; i++) {
        seen.push(drawTrainCard(s, function (st, c) { st.decks.train.discard.push(c); }));
      }
      seen.forEach(function (c) { if (CARD_TYPES.indexOf(c) === -1) throw new Error("bad drawn card " + c); });
      if (s.decks.train.draw.length === 0) throw new Error("deck not refilled after reshuffle");
      var total = s.faceUp.length + s.decks.train.draw.length + s.decks.train.discard.length;
      s.players.forEach(function (p) { CARD_TYPES.forEach(function (c) { total += p.hand[c]; }); });
      if (total !== TOTAL_TRAIN_CARDS) throw new Error("conservation " + total);
      assertState(s);
    });
    t("drawTrainCard rejects when both train piles are empty", function () {
      var s = createState({ seed: 3 });
      s.faceUp = buildTrainDeck(); // all 110 cards parked off-deck (setup phase allows any faceUp length)
      expectThrow("both empty", function () { drawTrainCard(s, function (st, c) {}); });
    });
    t("the drawn sequence preserves the official 110-card composition", function () {
      var s = createState({ seed: 3 });
      s.decks.train.draw = buildTrainDeck();
      var drawn = [];
      for (var i = 0; i < 110; i++) drawn.push(drawTrainCard(s, function (st, c) { st.decks.train.discard.push(c); }));
      var counts = {};
      drawn.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
      if (drawn.length !== TOTAL_TRAIN_CARDS) throw new Error("drawn " + drawn.length);
      if (counts[LOCOMOTIVE] !== LOCO_COUNT) throw new Error("loco count " + counts[LOCOMOTIVE]);
      COLORS.forEach(function (c) { if (counts[c] !== TRAIN_CARDS_PER_COLOR) throw new Error(c + " " + counts[c]); });
      assertState(s);
    });
    t("deck state survives a serialization round-trip", function () {
      var s = newGame({ seed: 44 });
      drawTrainCard(s, function (st, c) { st.decks.train.discard.push(c); });
      var back = fromJSON(toJSON(s));
      if (toJSON(back) !== toJSON(s)) throw new Error("deck round-trip mismatch");
      assertState(back);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── face-up row + locomotive rules test suite (Task 7) ───────────
  function runFaceUpTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectThrow(name, fn) {
      t(name, function () {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        if (!threw) throw new Error("expected to throw");
      });
    }
    function expectReason(name, fn, needle) {
      t(name, function () {
        var err = null;
        try { fn(); } catch (e) { err = e.message; }
        if (!err) throw new Error("expected rejection mentioning '" + needle + "'");
        if (err.indexOf(needle) === -1) throw new Error("missing '" + needle + "' in: " + err);
      });
    }
    // handSize / testForceFaceUp / testMoveLocoToTop / testTakeAny are
    // module-level shared helpers (used by several suites).

    t("setup deals keep the face-up row under 3 locomotives", function () {
      [2, 3, 4, 5].forEach(function (n) {
        var arr = [];
        for (var i = 0; i < n; i++) arr.push({ name: "P" + i });
        var s = newGame({ seed: 100 + n, players: arr });
        if (s.faceUp.length !== FACEUP_SIZE) throw new Error("faceUp length");
        if (locoCount(s.faceUp) >= 3) throw new Error("setup row has " + locoCount(s.faceUp) + " locos");
        assertState(s);
      });
      assertState(makeSetupReady(2, 7));
    });
    t("takeFaceUpCard puts the card in hand and refills the slot", function () {
      var s = newGame({ seed: 21 });
      var p0 = s.players[0];
      var card = s.faceUp[0];
      var before = p0.hand[card];
      enterAction(s, "drawingCards");
      takeFaceUpCard(s, 0);
      if (p0.hand[card] !== before + 1) throw new Error("card not credited");
      if (handSize(p0) !== 5) throw new Error("hand size " + handSize(p0));
      if (s.faceUp.length !== FACEUP_SIZE) throw new Error("row not refilled");
      if (s.turn.cardsDrawn !== 1) throw new Error("cardsDrawn " + s.turn.cardsDrawn);
      assertState(s);
    });
    t("a locomotive revealed by refill cannot be taken this turn", function () {
      var s = newGame({ seed: 33 });
      testForceFaceUp(s, ["red", "blue", "orange", "white", "green"]);
      testMoveLocoToTop(s);
      enterAction(s, "drawingCards");
      takeFaceUpCard(s, 0);
      if (s.faceUp[0] !== LOCOMOTIVE) throw new Error("expected loco at slot 0, got " + s.faceUp[0]);
      if (!s.faceUpFresh[0]) throw new Error("slot 0 should be marked fresh");
      expectReason("fresh loco rejected", function () { takeFaceUpCard(s, 0); }, "just revealed");
      testTakeAny(s); // the other (non-fresh) slots are still drawable this turn
      if (s.turn.cardsDrawn !== 2) throw new Error("second draw not credited");
      assertState(s);
    });
    t("a fresh non-locomotive refill is takeable the same turn", function () {
      var s = newGame({ seed: 33 });
      testForceFaceUp(s, ["red", "blue", "orange", "white", "green"]);
      mutate(s, "test-top-red", function (st) {
        var draw = st.decks.train.draw;
        var idx = draw.indexOf("red");
        if (idx === -1) throw new Error("no red in draw pile");
        draw.splice(idx, 1);
        draw.push("red");
      });
      enterAction(s, "drawingCards");
      takeFaceUpCard(s, 0);
      if (s.faceUp[0] !== "red" || !s.faceUpFresh[0]) throw new Error("expected fresh red at slot 0");
      takeFaceUpCard(s, 0);
      if (s.turn.cardsDrawn !== 2) throw new Error("cardsDrawn " + s.turn.cardsDrawn);
      assertState(s);
    });
    t("taking a face-up locomotive locks the turn to 1 card", function () {
      var s = newGame({ seed: 44 });
      testForceFaceUp(s, ["locomotive", "red", "blue", "orange", "white"]);
      enterAction(s, "drawingCards");
      takeFaceUpCard(s, 0);
      if (!s.turn.locoLock) throw new Error("locoLock not set");
      if (s.turn.cardsDrawn !== 1) throw new Error("cardsDrawn " + s.turn.cardsDrawn);
      expectReason("second face-up draw rejected", function () { takeFaceUpCard(s, 1); }, "locomotive was taken");
      expectReason("blind draw rejected", function () { drawBlindCard(s); }, "locomotive was taken");
      assertState(s);
    });
    t("a player can draw at most 2 cards per turn", function () {
      var s = newGame({ seed: 55 });
      enterAction(s, "drawingCards");
      testTakeAny(s);
      testTakeAny(s);
      expectReason("third draw rejected", function () { takeFaceUpCard(s, 1); }, "already drew");
      expectReason("blind draw rejected at limit", function () { drawBlindCard(s); }, "already drew");
      assertState(s);
    });
    t("three locomotives flush the row and deal 5 fresh cards", function () {
      var s = newGame({ seed: 66 });
      testForceFaceUp(s, ["locomotive", "locomotive", "red", "blue", "white"]);
      testMoveLocoToTop(s); // the refill will be a locomotive → 3 in the row → flush
      var discardBefore = s.decks.train.discard.length;
      var handBefore = handSize(s.players[0]);
      enterAction(s, "drawingCards");
      takeFaceUpCard(s, 2);
      if (handSize(s.players[0]) !== handBefore + 1) throw new Error("taken card not in hand");
      if (s.faceUp.length !== FACEUP_SIZE) throw new Error("row length");
      if (locoCount(s.faceUp) >= 3) throw new Error("flushed row still has " + locoCount(s.faceUp) + " locos");
      if (s.decks.train.discard.length < discardBefore + FACEUP_SIZE) throw new Error("flush should discard at least 5");
      s.faceUpFresh.forEach(function (f) { if (!f) throw new Error("flushed row should be all-fresh"); });
      var li = s.faceUp.indexOf(LOCOMOTIVE);
      if (li !== -1) expectReason("fresh flush loco rejected", function () { takeFaceUpCard(s, li); }, "just revealed");
      assertState(s);
    });
    t("drawing is impossible when both train piles are empty", function () {
      var s = newGame({ seed: 77, players: [{ name: "A" }, { name: "B" }, { name: "C" }] });
      mutate(s, "test-drain-piles", function (st) {
        var h = st.players[0].hand;
        while (st.decks.train.draw.length) h[st.decks.train.draw.pop()]++;
        while (st.decks.train.discard.length) h[st.decks.train.discard.pop()]++;
      });
      enterAction(s, "drawingCards");
      expectReason("blind draw rejected", function () { drawBlindCard(s); }, "piles are empty");
      expectReason("face-up draw rejected", function () { takeFaceUpCard(s, 1); }, "piles are empty");
      assertState(s);
    });
    t("completeTurn resets draw limits and fresh flags", function () {
      var s = newGame({ seed: 88 });
      testForceFaceUp(s, ["locomotive", "red", "blue", "orange", "white"]);
      enterAction(s, "drawingCards");
      takeFaceUpCard(s, 0);
      completeTurn(s);
      if (s.turn.locoLock) throw new Error("locoLock not reset");
      if (s.turn.cardsDrawn !== 0) throw new Error("cardsDrawn not reset");
      if (s.turn.substate !== "chooseAction") throw new Error("substate");
      if (s.turn.active !== 1) throw new Error("active " + s.turn.active);
      s.faceUpFresh.forEach(function (f) { if (f) throw new Error("fresh flags not reset"); });
      assertState(s);
    });
    t("draw actions require the drawingCards substate", function () {
      var s = newGame({ seed: 9 });
      expectReason("take during chooseAction rejected", function () { takeFaceUpCard(s, 0); }, "drawingCards");
      expectReason("blind during chooseAction rejected", function () { drawBlindCard(s); }, "drawingCards");
      expectReason("take during setup rejected", function () { takeFaceUpCard(createState(), 0); }, "playing");
    });
    t("draw actions reject invalid face-up indices", function () {
      var s = newGame({ seed: 9 });
      enterAction(s, "drawingCards");
      expectReason("negative index", function () { takeFaceUpCard(s, -1); }, "invalid");
      expectReason("too-high index", function () { takeFaceUpCard(s, 5); }, "invalid");
    });
    t("assertState rejects a row with 3+ locomotives", function () {
      var s = newGame({ seed: 1 });
      s.faceUp = ["locomotive", "locomotive", "locomotive", "red", "blue"];
      expectThrow("3 locos invalid", function () { assertState(s); });
      s.faceUp = ["locomotive", "locomotive", "red", "blue", "white"];
      assertState(s);
    });
    t("serialization round-trips the face-up row and fresh flags", function () {
      var s = newGame({ seed: 22 });
      testForceFaceUp(s, ["locomotive", "red", "blue", "orange", "white"]);
      enterAction(s, "drawingCards");
      takeFaceUpCard(s, 0);
      var back = fromJSON(toJSON(s));
      if (toJSON(back) !== toJSON(s)) throw new Error("round-trip mismatch");
      assertState(back);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── destination-ticket deck test suite (Task 8) ──────────────────
  function runTicketDeckTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectThrow(name, fn) {
      t(name, function () {
        var threw = false;
        try { fn(); } catch (e) { threw = true; }
        if (!threw) throw new Error("expected to throw");
      });
    }
    function expectReason(name, fn, needle) {
      t(name, function () {
        var err = null;
        try { fn(); } catch (e) { err = e.message; }
        if (!err) throw new Error("expected rejection mentioning '" + needle + "'");
        if (err.indexOf(needle) === -1) throw new Error("missing '" + needle + "' in: " + err);
      });
    }
    function toDiscard(st, tid) { st.decks.tickets.discard.push(tid); }

    t("buildTicketDeck holds all 30 official tickets, no duplicates", function () {
      var deck = buildTicketDeck();
      if (deck.length !== 30) throw new Error("deck " + deck.length);
      var seen = new Set();
      deck.forEach(function (tid) {
        if (!TICKET_CATALOG[tid]) throw new Error("'" + tid + "' not in catalog");
        if (seen.has(tid)) throw new Error("duplicate " + tid);
        seen.add(tid);
      });
    });
    t("ticket values span 4..22 like the official set", function () {
      var min = 99, max = -1;
      buildTicketDeck().forEach(function (tid) {
        var v = TICKET_CATALOG[tid].value;
        if (v < min) min = v;
        if (v > max) max = v;
      });
      if (min !== 4 || max !== 22) throw new Error("range " + min + ".." + max);
    });
    t("newGame shuffles the ticket deck with the seeded PRNG", function () {
      var s = newGame({ seed: 7 });
      var sorted = s.decks.tickets.draw.slice().sort();
      var base = buildTicketDeck().sort();
      if (sorted.join() !== base.join()) throw new Error("ticket deck is not a permutation of the 30");
      if (s.decks.tickets.draw.length !== 30) throw new Error("draw len " + s.decks.tickets.draw.length);
      assertState(s);
    });
    t("ticket deck is deterministic per seed and differs between seeds", function () {
      var a = newGame({ seed: 123 }), b = newGame({ seed: 123 });
      if (a.decks.tickets.draw.join() !== b.decks.tickets.draw.join()) throw new Error("same seed diverged");
      var c = newGame({ seed: 124 });
      if (c.decks.tickets.draw.join() === a.decks.tickets.draw.join()) throw new Error("different seeds matched");
    });
    t("drawTicket returns the top ticket of the draw pile", function () {
      var s = newGame({ seed: 21 });
      var top = s.decks.tickets.draw[s.decks.tickets.draw.length - 1];
      var before = s.decks.tickets.draw.length;
      var tid = drawTicket(s, toDiscard);
      if (tid !== top) throw new Error("got " + tid + " want " + top);
      if (s.decks.tickets.draw.length !== before - 1) throw new Error("length");
      if (s.decks.tickets.discard[s.decks.tickets.discard.length - 1] !== tid) throw new Error("not placed");
      assertState(s);
    });
    t("drawing all 30 empties the deck, then reshuffles the discard", function () {
      var s = newGame({ seed: 31 });
      for (var i = 0; i < 30; i++) drawTicket(s, toDiscard);
      if (s.decks.tickets.draw.length !== 0) throw new Error("deck not empty");
      if (s.decks.tickets.discard.length !== 30) throw new Error("discard " + s.decks.tickets.discard.length);
      var tid = drawTicket(s, toDiscard);
      if (s.decks.tickets.draw.length !== 29) throw new Error("deck not refilled");
      if (s.decks.tickets.discard.length !== 1) throw new Error("discard after refill " + s.decks.tickets.discard.length);
      if (!TICKET_CATALOG[tid]) throw new Error("bad drawn ticket");
      assertState(s);
    });
    t("drawTicket rejects when both ticket piles are empty", function () {
      var s = newGame({ seed: 41 });
      mutate(s, "test-drain-tickets", function (st) {
        while (st.decks.tickets.draw.length) {
          var tid = st.decks.tickets.draw.pop();
          st.players[0].ticketIds.push(tid);
          st.players[0].ticketState[tid] = "unstarted";
        }
        while (st.decks.tickets.discard.length) {
          var tid2 = st.decks.tickets.discard.pop();
          st.players[1].ticketIds.push(tid2);
          st.players[1].ticketState[tid2] = "unstarted";
        }
      });
      expectReason("empty ticket piles", function () { drawTicket(s, toDiscard); }, "both ticket piles are empty");
      assertState(s);
    });
    t("drawTicket can place a ticket directly into a player's hand", function () {
      var s = newGame({ seed: 51 });
      drawTicket(s, function (st, tid) {
        st.players[0].ticketIds.push(tid);
        st.players[0].ticketState[tid] = "unstarted";
      });
      if (s.players[0].ticketIds.length !== 1) throw new Error("hand " + s.players[0].ticketIds.length);
      if (!s.players[0].ticketState[s.players[0].ticketIds[0]]) throw new Error("no ticketState");
      assertState(s);
    });
    t("a ticket cannot be both in the deck and in a player's hand", function () {
      var s = newGame({ seed: 61 });
      var tid = s.decks.tickets.draw[0];
      s.players[0].ticketIds.push(tid);
      s.players[0].ticketState[tid] = "unstarted";
      expectThrow("overlap invalid", function () { assertState(s); });
    });
    t("duplicate tickets in the deck are rejected", function () {
      var s = newGame({ seed: 61 });
      s.decks.tickets.draw.push(s.decks.tickets.draw[0]);
      expectThrow("duplicate invalid", function () { assertState(s); });
    });
    t("ticket deck survives a serialization round-trip", function () {
      var s = newGame({ seed: 71 });
      drawTicket(s, function (st, tid) {
        st.players[0].ticketIds.push(tid);
        st.players[0].ticketState[tid] = "unstarted";
      });
      var back = fromJSON(toJSON(s));
      if (toJSON(back) !== toJSON(s)) throw new Error("round-trip mismatch");
      assertState(back);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── destination-ticket draw routine tests (Task 9) ───────────────
  function runTicketDrawTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectReason(name, fn, needle) {
      t(name, function () {
        var err = null;
        try { fn(); } catch (e) { err = e.message; }
        if (!err) throw new Error("expected rejection mentioning '" + needle + "'");
        if (err.indexOf(needle) === -1) throw new Error("missing '" + needle + "' in: " + err);
      });
    }

    t("beginTicketDraw draws up to 3 tickets into pendingTickets", function () {
      var s = newGame({ seed: 5 });
      enterAction(s, "drawingTickets");
      var drawn = beginTicketDraw(s);
      if (drawn.length !== 3) throw new Error("drawn " + drawn.length);
      if (s.pendingTickets.length !== 3) throw new Error("pending " + s.pendingTickets.length);
      if (s.decks.tickets.draw.length !== 27) throw new Error("deck " + s.decks.tickets.draw.length);
      assertState(s);
    });
    t("beginTicketDraw requires the drawingTickets substate", function () {
      var s = newGame({ seed: 5 });
      expectReason("chooseAction rejected", function () { beginTicketDraw(s); }, "drawingTickets");
      expectReason("setup rejected", function () { beginTicketDraw(createState()); }, "playing");
    });
    t("resolveTicketDraw keeps a non-empty subset and discards the rest", function () {
      var s = newGame({ seed: 6 });
      enterAction(s, "drawingTickets");
      var drawn = beginTicketDraw(s);
      var keep = [drawn[0]];
      resolveTicketDraw(s, keep);
      if (s.players[0].ticketIds.join() !== keep.join()) throw new Error("kept " + s.players[0].ticketIds.join());
      if (s.players[0].ticketState[keep[0]] !== "unstarted") throw new Error("state " + s.players[0].ticketState[keep[0]]);
      if (s.decks.tickets.discard.length !== 2) throw new Error("discard " + s.decks.tickets.discard.length);
      if (s.pendingTickets.length !== 0) throw new Error("pending not cleared");
      assertState(s);
    });
    t("resolveTicketDraw rejects keeping 0 mid-game", function () {
      var s = newGame({ seed: 7 });
      enterAction(s, "drawingTickets");
      beginTicketDraw(s);
      expectReason("empty keep", function () { resolveTicketDraw(s, []); }, "at least 1");
      assertState(s);
    });
    t("resolveTicketDraw rejects tickets that were not drawn", function () {
      var s = newGame({ seed: 8 });
      enterAction(s, "drawingTickets");
      var drawn = beginTicketDraw(s);
      var other = null;
      Object.keys(s.tickets).forEach(function (tid) { if (drawn.indexOf(tid) === -1 && !other) other = tid; });
      expectReason("foreign ticket", function () { resolveTicketDraw(s, [other]); }, "was not drawn");
      assertState(s);
    });
    t("kept tickets accept the unstarted/connected/complete lifecycle", function () {
      var s = newGame({ seed: 9 });
      enterAction(s, "drawingTickets");
      var drawn = beginTicketDraw(s);
      resolveTicketDraw(s, drawn);
      var tid = drawn[0];
      if (s.players[0].ticketState[tid] !== "unstarted") throw new Error("initial state");
      s.players[0].ticketState[tid] = "connected"; assertState(s);
      s.players[0].ticketState[tid] = "complete"; assertState(s);
    });
    t("setupInitialTickets deals 3 and keeps ≥2 per player", function () {
      var s = makeSetupReady(2, 1);
      var d = s.decks.tickets.draw;
      var p0 = [d[d.length - 3], d[d.length - 2], d[d.length - 1]];
      var p1 = [d[d.length - 6], d[d.length - 5], d[d.length - 4]];
      var summary = setupInitialTickets(s, [[p0[0], p0[1]], [p1[0], p1[1]]]);
      var k0 = [p0[0], p0[1]].slice().sort().join();
      var k1 = [p1[0], p1[1]].slice().sort().join();
      if (s.players[0].ticketIds.slice().sort().join() !== k0) throw new Error("p0 kept");
      if (s.players[1].ticketIds.slice().sort().join() !== k1) throw new Error("p1 kept");
      if (s.players[0].ticketState[p0[0]] !== "unstarted") throw new Error("p0 state");
      if (s.decks.tickets.discard.length !== 2) throw new Error("discard " + s.decks.tickets.discard.length);
      if (s.decks.tickets.draw.length !== 24) throw new Error("deck " + s.decks.tickets.draw.length);
      if (summary.length !== 2) throw new Error("summary length");
      assertState(s);
    });
    t("setupInitialTickets rejects keeping fewer than 2", function () {
      var s = makeSetupReady(2, 2);
      var d = s.decks.tickets.draw;
      var p0 = [d[d.length - 3], d[d.length - 2], d[d.length - 1]];
      expectReason("one ticket rejected", function () {
        setupInitialTickets(s, [[p0[0]], [p0[1], p0[2]]]);
      }, "at least 2");
      assertState(s);
    });
    t("setupInitialTickets requires the setup phase", function () {
      expectReason("playing rejected", function () { setupInitialTickets(newGame({ seed: 3 }), [[], []]); }, "setup");
    });
    t("setupInitialTickets rejects tickets the player did not draw", function () {
      var s = makeSetupReady(2, 3);
      var d = s.decks.tickets.draw;
      var p0 = [d[d.length - 3], d[d.length - 2], d[d.length - 1]];
      expectReason("undrawn keep", function () {
        setupInitialTickets(s, [[p0[0], d[0]], [p0[1], p0[2]]]);
      }, "was not drawn");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── hand integrity test suite (Task 10) ──────────────────────────
  function runHandIntegrityTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectReason(name, fn, needle) {
      t(name, function () {
        var err = null;
        try { fn(); } catch (e) { err = e.message; }
        if (!err) throw new Error("expected rejection mentioning '" + needle + "'");
        if (err.indexOf(needle) === -1) throw new Error("missing '" + needle + "' in: " + err);
      });
    }
    function totalCardsIn(state) {
      var total = state.faceUp.length + state.decks.train.draw.length + state.decks.train.discard.length;
      state.players.forEach(function (p) {
        CARD_TYPES.forEach(function (c) { total += p.hand[c]; });
      });
      return total;
    }

    t("handSize sums a player's hand", function () {
      var s = newGame({ seed: 10 });
      if (handSize(s.players[0]) !== 4) throw new Error("start hand " + handSize(s.players[0]));
      s.players[0].hand.red++;
      if (handSize(s.players[0]) !== 5) throw new Error("after bump");
    });
    t("hands and piles stay conserved across many blind draws", function () {
      var s = newGame({ seed: 11 });
      for (var i = 0; i < 25; i++) {
        enterAction(s, "drawingCards");
        drawBlindCard(s);
        drawBlindCard(s);
        completeTurn(s);
      }
      if (totalCardsIn(s) !== TOTAL_TRAIN_CARDS) throw new Error("conservation " + totalCardsIn(s));
      assertState(s);
    });
    t("face-up draws and payments keep every hand consistent", function () {
      var s = newGame({ seed: 12 });
      enterAction(s, "drawingCards");
      testTakeAny(s);
      testTakeAny(s);
      completeTurn(s);
      var p0 = s.players[0];
      var pay = [];
      CARD_TYPES.forEach(function (c) { if (p0.hand[c] > 0) pay.push(c); });
      payCards(s, 0, pay.slice(0, 2));
      if (totalCardsIn(s) !== TOTAL_TRAIN_CARDS) throw new Error("conservation " + totalCardsIn(s));
      assertState(s);
    });
    t("payCards deducts only what the hand actually contains", function () {
      var s = newGame({ seed: 13 });
      enterAction(s, "drawingCards");
      drawBlindCard(s);
      drawBlindCard(s);
      completeTurn(s);
      var p0 = s.players[0];
      var c = CARD_TYPES.filter(function (t) { return p0.hand[t] > 0; })[0];
      var before = p0.hand[c];
      payCards(s, 0, [c]);
      if (p0.hand[c] !== before - 1) throw new Error("card not deducted");
      if (s.decks.train.discard[s.decks.train.discard.length - 1] !== c) throw new Error("not discarded");
      assertState(s);
    });
    t("payCards rejects when the hand is short", function () {
      var s = newGame({ seed: 14 });
      expectReason("over-pay rejected", function () { payCards(s, 0, ["red", "red", "red", "red", "red", "red", "red", "red", "red"]); }, "lacks");
    });
    t("payCards rejects unknown card types and bad players", function () {
      var s = newGame({ seed: 15 });
      expectReason("bad card", function () { payCards(s, 0, ["teal"]); }, "bad card");
      expectReason("bad player", function () { payCards(s, 9, ["red"]); }, "bad player");
    });
    t("hand keys must match the exact card vocabulary", function () {
      var s = newGame({ seed: 16 });
      s.players[0].hand.redd = 0;
      var err = null;
      try { assertState(s); } catch (e) { err = e.message; }
      if (!err || err.indexOf("hand keys") === -1) throw new Error("typo key not caught: " + err);
      delete s.players[0].hand.redd;
      assertState(s);
    });
    t("a drawn card always lands in the active player's hand", function () {
      var s = newGame({ seed: 17 });
      enterAction(s, "drawingCards");
      var activeBefore = handSize(s.players[s.turn.active]);
      drawBlindCard(s);
      if (handSize(s.players[s.turn.active]) !== activeBefore + 1) throw new Error("wrong hand credited");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── turn action test suite (Task 11) ─────────────────────────────
  function runTurnActionTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectReason(name, fn, needle) {
      t(name, function () {
        var err = null;
        try { fn(); } catch (e) { err = e.message; }
        if (!err) throw new Error("expected rejection mentioning '" + needle + "'");
        if (err.indexOf(needle) === -1) throw new Error("missing '" + needle + "' in: " + err);
      });
    }

    t("a drawingCards turn completes only after its 2 draws", function () {
      var s = newGame({ seed: 20 });
      enterAction(s, "drawingCards");
      drawBlindCard(s);
      expectReason("incomplete", function () { completeTurn(s); }, "incomplete");
      drawBlindCard(s);
      completeTurn(s);
      if (s.turn.active !== 1 || s.turn.count !== 1) throw new Error("turn not advanced");
      assertState(s);
    });
    t("a drawingCards turn completes after taking a face-up locomotive", function () {
      var s = newGame({ seed: 21 });
      testForceFaceUp(s, ["locomotive", "red", "blue", "orange", "white"]);
      enterAction(s, "drawingCards");
      takeFaceUpCard(s, 0);
      if (!s.turn.locoLock) throw new Error("locoLock");
      completeTurn(s);
      if (s.turn.active !== 1) throw new Error("active " + s.turn.active);
      assertState(s);
    });
    t("a drawingTickets turn completes only after resolving", function () {
      var s = newGame({ seed: 22 });
      enterAction(s, "drawingTickets");
      beginTicketDraw(s);
      expectReason("pending", function () { completeTurn(s); }, "still pending");
      resolveTicketDraw(s, [s.pendingTickets[0]]);
      completeTurn(s);
      if (s.turn.active !== 1) throw new Error("active " + s.turn.active);
      assertState(s);
    });
    t("a claimingRoute turn cannot complete without a claim", function () {
      var s = newGame({ seed: 23 });
      enterAction(s, "claimingRoute");
      expectReason("no claim", function () { completeTurn(s); }, "no route claimed");
      assertState(s);
    });
    t("canCompleteTurn mirrors the action-completion gates", function () {
      var s = newGame({ seed: 24 });
      if (canCompleteTurn(s)) throw new Error("chooseAction");
      enterAction(s, "drawingCards");
      if (canCompleteTurn(s)) throw new Error("0 draws");
      drawBlindCard(s);
      drawBlindCard(s);
      if (!canCompleteTurn(s)) throw new Error("2 draws");
      completeTurn(s);
    });
    t("completing an action resets all turn fields", function () {
      var s = newGame({ seed: 25 });
      enterAction(s, "drawingCards");
      drawBlindCard(s);
      drawBlindCard(s);
      completeTurn(s);
      if (s.turn.substate !== "chooseAction") throw new Error("substate");
      if (s.turn.cardsDrawn !== 0 || s.turn.locoLock || s.turn.claimedRouteId != null) throw new Error("not reset");
      if (s.turn.count !== 1 || s.turn.active !== 1) throw new Error("not advanced");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── route claim validation + application tests (Tasks 12–13) ─────
  function runRouteClaimTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectReason(name, fn, needle) {
      t(name, function () {
        var err = null;
        try { fn(); } catch (e) { err = e.message; }
        if (!err) throw new Error("expected rejection mentioning '" + needle + "'");
        if (err.indexOf(needle) === -1) throw new Error("missing '" + needle + "' in: " + err);
      });
    }
    // Claim a route for player 0 with an exact payment, in a fresh game.
    function claimFor(seed, routeId, payment) {
      var s = newGame({ seed: seed });
      enterAction(s, "claimingRoute");
      var r = s.routes[routeId];
      var cards = [];
      for (var i = 0; i < r.length - (payment.locos || 0); i++) cards.push(payment.color);
      for (var j = 0; j < (payment.locos || 0); j++) cards.push("locomotive");
      testGiveCards(s, 0, cards);
      claimRoute(s, routeId, payment);
      return s;
    }

    t("claiming a gray route scores +4, deducts cards and trains", function () {
      var s = claimFor(1, "Duluth-Sault St. Marie", { color: "red", locos: 0 });
      var p0 = s.players[0];
      if (p0.trains !== TRAINS_START - 3) throw new Error("trains " + p0.trains);
      if (p0.score !== 4 || p0.routePoints !== 4) throw new Error("score " + p0.score);
      if (p0.claimedRoutes.indexOf("Duluth-Sault St. Marie") === -1) throw new Error("route not claimed");
      if (s.turn.claimedRouteId !== "Duluth-Sault St. Marie") throw new Error("claimedRouteId");
      if (s.decks.train.discard.length !== 3) throw new Error("discard " + s.decks.train.discard.length);
      if (handSize(p0) !== 4) throw new Error("hand size " + handSize(p0)); // 4 start + 3 given - 3 paid
      var last = s.log[s.log.length - 1];
      if (!last || last.action !== "claimRoute" || last.detail.indexOf("+4") === -1) throw new Error("no log");
      completeTurn(s); // the claim completes the claimingRoute action
      assertState(s);
    });
    t("locomotives substitute for the route color", function () {
      var s = claimFor(2, "Calgary-Seattle", { color: "red", locos: 2 });
      var p0 = s.players[0];
      if (p0.hand.locomotive !== 0) throw new Error("locos " + p0.hand.locomotive);
      if (handSize(p0) !== 4) throw new Error("hand size " + handSize(p0)); // net card change 0
      if (p0.score !== 7) throw new Error("score " + p0.score);
      assertState(s);
    });
    t("an all-locomotive payment claims a gray route", function () {
      var s = claimFor(3, "Atlanta-Nashville", { color: null, locos: 1 });
      if (s.players[0].score !== 1) throw new Error("score " + s.players[0].score);
      if (handSize(s.players[0]) !== 4) throw new Error("hand size " + handSize(s.players[0]));
      assertState(s);
    });
    t("a colored route requires its own color", function () {
      var s = newGame({ seed: 4 });
      enterAction(s, "claimingRoute");
      testGiveCards(s, 0, ["red", "red", "red", "red", "red", "red",
                           "locomotive", "locomotive", "locomotive", "locomotive", "locomotive", "locomotive"]);
      expectReason("mismatched color rejected", function () {
        claimRoute(s, "Helena-Seattle", { color: "red", locos: 0 }); // yellow route
      }, "invalid payment");
      assertState(s);
    });
    t("claimPayments lists only legal, affordable options", function () {
      var s = newGame({ seed: 8 });
      enterAction(s, "claimingRoute");
      testGiveCards(s, 0, ["red", "red", "locomotive", "locomotive", "locomotive"]);
      var opts = claimPayments(s, "Duluth-Sault St. Marie"); // gray, length 3
      if (claimBlockedReason(s, "Duluth-Sault St. Marie") !== null) throw new Error("should be claimable");
      if (!opts.some(function (o) { return o.color === "red" && o.locos === 1; })) throw new Error("red+1loco missing");
      if (!opts.some(function (o) { return o.color === null && o.locos === 3; })) throw new Error("all-loco missing");
      // too few cards → no options
      var s2 = newGame({ seed: 9 });
      mutate(s2, "test-clear-hand", function (st) {
        CARD_TYPES.forEach(function (c) {
          while (st.players[0].hand[c] > 0) {
            st.players[0].hand[c]--;
            st.decks.train.draw.push(c);
          }
        });
      });
      enterAction(s2, "claimingRoute");
      testGiveCards(s2, 0, ["red", "red"]);
      if (claimPayments(s2, "Duluth-Sault St. Marie").length !== 0) throw new Error("should be unaffordable");
      if (claimBlockedReason(s2, "Duluth-Sault St. Marie").indexOf("matching color") === -1) throw new Error("reason");
    });
    t("official scoring table across lengths 1-6", function () {
      var table = [
        ["Atlanta-Nashville", 1, "gray"],
        ["Little Rock-Oklahoma City", 2, "gray"],
        ["Duluth-Sault St. Marie", 3, "gray"],
        ["Calgary-Seattle", 4, "gray"],
        ["Pittsburgh-Saint Louis", 5, "green"],
        ["Sault St. Marie-Winnipeg", 6, "gray"]
      ];
      var expected = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };
      table.forEach(function (row, i) {
        var s = claimFor(100 + i, row[0], { color: row[2] === "gray" ? "red" : row[2], locos: 0 });
        if (s.players[0].score !== expected[row[1]]) throw new Error(row[0] + " scored " + s.players[0].score);
        if (s.players[0].trains !== TRAINS_START - row[1]) throw new Error(row[0] + " trains");
      });
    });
    t("already-claimed routes are rejected", function () {
      var s = claimFor(5, "Atlanta-Nashville", { color: "red", locos: 0 });
      completeTurn(s);
      enterAction(s, "claimingRoute");
      expectReason("second claim rejected", function () {
        claimRoute(s, "Atlanta-Nashville", { color: "red", locos: 0 });
      }, "already claimed");
    });
    t("insufficient trains are rejected", function () {
      var s = newGame({ seed: 6 });
      s.players[0].trains = 2;
      enterAction(s, "claimingRoute");
      testGiveCards(s, 0, ["red", "red", "red"]);
      expectReason("too few trains", function () {
        claimRoute(s, "Duluth-Sault St. Marie", { color: "red", locos: 0 });
      }, "not enough trains");
      assertState(s);
    });
    t("the second segment of a double route is blocked for 2 players", function () {
      var s = claimFor(7, "Seattle-Vancouver", { color: "red", locos: 0 });
      completeTurn(s);
      enterAction(s, "claimingRoute");
      testGiveCards(s, 1, ["red"]);
      expectReason("parallel segment rejected", function () {
        claimRoute(s, "Seattle-Vancouver#2", { color: "red", locos: 0 });
      }, "parallel route");
      assertState(s);
    });
    t("both segments of a double route are usable with 5 players", function () {
      var arr = [];
      for (var i = 0; i < 5; i++) arr.push({ name: "P" + i });
      var s = newGame({ seed: 11, players: arr });
      enterAction(s, "claimingRoute");
      testGiveCards(s, 0, ["red"]);
      claimRoute(s, "Seattle-Vancouver", { color: "red", locos: 0 });
      completeTurn(s);
      enterAction(s, "claimingRoute");
      testGiveCards(s, 1, ["red"]);
      claimRoute(s, "Seattle-Vancouver#2", { color: "red", locos: 0 });
      if (s.players[1].claimedRoutes.indexOf("Seattle-Vancouver#2") === -1) throw new Error("second segment");
      assertState(s);
    });
    t("house rule: allowDoubleFor23 lets 2 players use both double segments", function () {
      var s = newGame({ seed: 8, rules: { allowDoubleFor23: true } });
      enterAction(s, "claimingRoute");
      testGiveCards(s, 0, ["red"]);
      claimRoute(s, "Seattle-Vancouver", { color: "red", locos: 0 });
      completeTurn(s);
      enterAction(s, "claimingRoute");
      testGiveCards(s, 1, ["red"]);
      claimRoute(s, "Seattle-Vancouver#2", { color: "red", locos: 0 });
      if (s.players[1].claimedRoutes.indexOf("Seattle-Vancouver#2") === -1) throw new Error("second segment still blocked");
      assertState(s);
    });
    t("house rule: endTrains changes the end-of-game threshold", function () {
      var s = newGame({ seed: 9, rules: { endTrains: 0 } });
      s.players[0].trains = 2;
      enterAction(s, "drawingCards");
      drawBlindCard(s); drawBlindCard(s);
      completeTurn(s);
      if (s.gameEnd.triggered) throw new Error("triggered too early with endTrains=0");
      assertState(s);
      var s2 = newGame({ seed: 9, rules: { endTrains: 2 } });
      s2.players[0].trains = 2;
      enterAction(s2, "drawingCards");
      drawBlindCard(s2); drawBlindCard(s2);
      completeTurn(s2);
      if (!s2.gameEnd.triggered) throw new Error("not triggered with official endTrains=2");
      assertState(s2);
    });
    t("house rules merge from newGame opts and survive the compact roundtrip", function () {
      var s = newGame({ seed: 10, rules: { startTickets: 3 } });
      if (s.rules.startTickets !== 3) throw new Error("startTickets not merged");
      if (s.rules.endTrains !== 2) throw new Error("endTrains default lost");
      if (s.rules.allowDoubleFor23 !== false) throw new Error("allowDoubleFor23 default lost");
      var s2 = fromCompact(toCompact(s));
      if (!s2.rules || s2.rules.startTickets !== 3) throw new Error("rules lost in compact roundtrip");
      assertState(s2);
    });
    t("claims outside the claimingRoute action are rejected", function () {
      var s = newGame({ seed: 12 });
      expectReason("no substate", function () {
        claimRoute(s, "Atlanta-Nashville", { color: "red", locos: 0 });
      }, "claimingRoute");
      expectReason("unknown route", function () {
        enterAction(s, "claimingRoute");
        claimRoute(s, "Nowhere-Somewhere", { color: "red", locos: 0 });
      }, "not in the catalog");
      expectReason("during setup", function () { claimRoute(createState(), "Atlanta-Nashville", { color: "red", locos: 0 }); }, "in progress");
    });
    t("the paid cards land in the discard pile in order", function () {
      var s = claimFor(13, "Calgary-Seattle", { color: "blue", locos: 1 });
      var disc = s.decks.train.discard;
      var tail = disc.slice(disc.length - 4);
      if (tail.filter(function (c) { return c === "blue"; }).length !== 3) throw new Error("blue count");
      if (tail.filter(function (c) { return c === "locomotive"; }).length !== 1) throw new Error("loco count");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── connectivity test suite (Task 15) ────────────────────────────
  function runConnectivityTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    // Build a 3-route chain for player 0 with player 1 passing between turns.
    function buildChain(seed) {
      var s = newGame({ seed: seed });
      function claim(rid, color, cards) {
        enterAction(s, "claimingRoute");
        testGiveCards(s, 0, cards);
        claimRoute(s, rid, { color: color, locos: 0 });
        completeTurn(s);
        enterAction(s, "drawingCards");
        drawBlindCard(s);
        drawBlindCard(s);
        completeTurn(s);
      }
      claim("Denver-Kansas City", "black", ["black", "black", "black", "black"]);
      claim("Kansas City-Oklahoma City", "red", ["red", "red"]);
      claim("Little Rock-Oklahoma City", "red", ["red", "red"]);
      return s;
    }

    t("a claimed chain connects its endpoints both ways", function () {
      var s = buildChain(20);
      if (!citiesConnected(s, 0, "Denver", "Little Rock")) throw new Error("forward");
      if (!citiesConnected(s, 0, "Little Rock", "Denver")) throw new Error("backward");
      if (!citiesConnected(s, 0, "Denver", "Oklahoma City")) throw new Error("mid");
      if (!citiesConnected(s, 0, "Denver", "Denver")) throw new Error("same city");
      assertState(s);
    });
    t("disconnected pairs are not connected", function () {
      var s = buildChain(21);
      if (citiesConnected(s, 0, "Denver", "Atlanta")) throw new Error("Denver-Atlanta");
      if (citiesConnected(s, 0, "Denver", "Houston")) throw new Error("Denver-Houston");
      if (citiesConnected(s, 0, "Los Angeles", "New York")) throw new Error("LA-NY");
      // board-adjacent but unclaimed routes don't count
      if (citiesConnected(s, 0, "Dallas", "Houston")) throw new Error("unclaimed adjacent");
    });
    t("each player's connectivity is independent", function () {
      var s = buildChain(22);
      if (citiesConnected(s, 1, "Denver", "Little Rock")) throw new Error("player 1 must not connect");
      assertState(s);
    });
    t("playerGraph exposes the adjacency of claimed routes", function () {
      var s = buildChain(23);
      var g = playerGraph(s, 0);
      if (!g["Denver"] || g["Denver"].indexOf("Kansas City") === -1) throw new Error("Denver adj");
      if (!g["Little Rock"] || g["Little Rock"].indexOf("Oklahoma City") === -1) throw new Error("Little Rock adj");
      if (g["Houston"]) throw new Error("Houston should have no claimed routes");
    });
    t("connectivity through a branch (junction city)", function () {
      var s = newGame({ seed: 24 });
      function claim(rid, color, cards) {
        enterAction(s, "claimingRoute");
        testGiveCards(s, 0, cards);
        claimRoute(s, rid, { color: color, locos: 0 });
        completeTurn(s);
        enterAction(s, "drawingCards");
        drawBlindCard(s);
        drawBlindCard(s);
        completeTurn(s);
      }
      claim("Kansas City-Oklahoma City", "red", ["red", "red"]);
      claim("Kansas City-Saint Louis", "blue", ["blue", "blue"]);
      claim("Nashville-Saint Louis", "red", ["red", "red"]);
      if (!citiesConnected(s, 0, "Oklahoma City", "Nashville")) throw new Error("through Kansas City");
      if (!citiesConnected(s, 0, "Oklahoma City", "Saint Louis")) throw new Error("Oklahoma City-Saint Louis");
      if (citiesConnected(s, 0, "Oklahoma City", "Chicago")) throw new Error("not connected");
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── fair turn sequencing test suite (Task 14) ────────────────────
  function runTurnSequenceTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function expectReason(name, fn, needle) {
      t(name, function () {
        var err = null;
        try { fn(); } catch (e) { err = e.message; }
        if (!err) throw new Error("expected rejection mentioning '" + needle + "'");
        if (err.indexOf(needle) === -1) throw new Error("missing '" + needle + "' in: " + err);
      });
    }
    function passTurn(s) {
      enterAction(s, "drawingCards");
      drawBlindCard(s);
      drawBlindCard(s);
      completeTurn(s);
    }

    t("active player advances after every completed action", function () {
      var s = newGame({ seed: 30, players: [{ name: "A" }, { name: "B" }, { name: "C" }] });
      var seen = [];
      for (var i = 0; i < 6; i++) { seen.push(s.turn.active); passTurn(s); }
      if (JSON.stringify(seen) !== JSON.stringify([0, 1, 2, 0, 1, 2])) throw new Error("rotation " + JSON.stringify(seen));
      if (s.turn.count !== 6) throw new Error("count " + s.turn.count);
    });
    t("completing a turn with ≤2 trains triggers the fair final round", function () {
      var s = newGame({ seed: 31, players: [{ name: "A" }, { name: "B" }, { name: "C" }] });
      s.players[0].trains = 2;
      passTurn(s); // player 0 ends their turn with 2 trains
      if (!s.gameEnd.triggered) throw new Error("not triggered");
      if (s.gameEnd.triggerPlayerId !== 0) throw new Error("triggerer " + s.gameEnd.triggerPlayerId);
      if (s.gameEnd.stopAtTurnCount !== 3) throw new Error("stopAt " + s.gameEnd.stopAtTurnCount);
      if (isRoundComplete(s)) throw new Error("should not be complete yet");
      passTurn(s); // player 1
      if (isRoundComplete(s)) throw new Error("complete too early");
      passTurn(s); // player 2 — the last equalizing turn
      if (!isRoundComplete(s)) throw new Error("round should be complete");
      if (s.turn.count !== 3) throw new Error("count " + s.turn.count);
      if (s.turn.active !== 0) throw new Error("active " + s.turn.active);
      if (legalActions(s).length !== 0) throw new Error("actions must be blocked");
      expectReason("actions blocked after the fair round", function () { enterAction(s, "drawingCards"); }, "final round");
      assertState(s);
    });
    t("the trigger fires only once", function () {
      var s = newGame({ seed: 32, players: [{ name: "A" }, { name: "B" }] });
      s.players[0].trains = 1;
      passTurn(s); // trigger
      var stopAt = s.gameEnd.stopAtTurnCount;
      s.players[1].trains = 0;
      passTurn(s);
      if (s.gameEnd.stopAtTurnCount !== stopAt) throw new Error("re-triggered");
      assertState(s);
    });
    t("no trigger while every player has more than 2 trains", function () {
      var s = newGame({ seed: 33, players: [{ name: "A" }, { name: "B" }] });
      passTurn(s);
      passTurn(s);
      if (s.gameEnd.triggered) throw new Error("triggered early");
      if (s.turn.count !== 2) throw new Error("count");
      assertState(s);
    });
    t("all players reach an equal turn count when the round completes", function () {
      var s = newGame({ seed: 34, players: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] });
      s.players[2].trains = 2; // player C triggers on their second-round turn
      passTurn(s); // A (1)
      passTurn(s); // B (2)
      passTurn(s); // C (3) — triggers
      if (!s.gameEnd.triggered) throw new Error("triggered " + JSON.stringify(s.gameEnd));
      if (s.gameEnd.stopAtTurnCount !== 8) throw new Error("stopAt " + s.gameEnd.stopAtTurnCount);
      if (isRoundComplete(s)) throw new Error("complete too early");
      passTurn(s); // D (4)
      passTurn(s); // A (5)
      passTurn(s); // B (6)
      passTurn(s); // C (7)
      if (isRoundComplete(s)) throw new Error("complete too early");
      passTurn(s); // D (8) — final equalizing turn
      if (!isRoundComplete(s)) throw new Error("not complete");
      if (s.turn.count !== 8) throw new Error("count " + s.turn.count);
      if (s.turn.active !== 0) throw new Error("active " + s.turn.active);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── ticket completion test suite (Task 16) ──────────────────────
  function runTicketCompletionTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function pass(s) {
      enterAction(s, "drawingCards");
      drawBlindCard(s);
      drawBlindCard(s);
      completeTurn(s);
    }
    function claimFor(s, pid, rid) {
      var guard = 0;
      while (s.turn.active !== pid) { pass(s); if (++guard > 20) throw new Error("turn rotation stuck"); }
      enterAction(s, "claimingRoute");
      var r = s.routes[rid];
      var color = r.color;
      if (color === "gray") {
        // pay a gray route with whichever color is most plentiful in the draw pile
        var counts = {};
        COLORS.forEach(function (c) { counts[c] = 0; });
        s.decks.train.draw.forEach(function (card) { if (card !== LOCOMOTIVE) counts[card]++; });
        var order = COLORS.slice().sort(function (a, b) { return counts[b] - counts[a]; });
        color = null;
        for (var j = 0; j < order.length; j++) {
          if (counts[order[j]] >= r.length) { color = order[j]; break; }
        }
        if (!color) throw new Error("no color with " + r.length + " cards left in the draw pile");
      }
      var cards = [];
      for (var i = 0; i < r.length; i++) cards.push(color);
      testGiveCards(s, pid, cards);
      claimRoute(s, rid, { color: color, locos: 0 });
      completeTurn(s);
    }
    var KC_HOUSTON = pairId("Kansas City", "Houston");
    var NY_ATLANTA = pairId("New York", "Atlanta");
    var DEN_ELPASO = pairId("Denver", "El Paso");
    var SSM_NASH = pairId("Sault St. Marie", "Nashville");

    t("a ticket flips to connected exactly when its final route is claimed", function () {
      var s = newGame({ seed: 40 });
      testGiveTicket(s, 0, KC_HOUSTON);
      claimFor(s, 0, pairId("Kansas City", "Oklahoma City"));
      if (s.players[0].ticketState[KC_HOUSTON] !== "unstarted") throw new Error("premature completion");
      claimFor(s, 0, pairId("Oklahoma City", "Dallas"));
      if (s.players[0].ticketState[KC_HOUSTON] !== "unstarted") throw new Error("premature completion");
      claimFor(s, 0, pairId("Dallas", "Houston"));
      if (s.players[0].ticketState[KC_HOUSTON] !== "connected")
        throw new Error("expected 'connected', got '" + s.players[0].ticketState[KC_HOUSTON] + "'");
      claimFor(s, 0, pairId("Denver", "Santa Fe"));   // unrelated later claim
      if (s.players[0].ticketState[KC_HOUSTON] !== "connected") throw new Error("ticket state regressed");
      assertState(s);
    });
    t("unconnected tickets stay unstarted", function () {
      var s = newGame({ seed: 41 });
      testGiveTicket(s, 0, NY_ATLANTA);
      claimFor(s, 0, pairId("Kansas City", "Oklahoma City"));
      claimFor(s, 0, pairId("Oklahoma City", "Dallas"));
      claimFor(s, 0, pairId("Dallas", "Houston"));
      if (s.players[0].ticketState[NY_ATLANTA] !== "unstarted") throw new Error("got " + s.players[0].ticketState[NY_ATLANTA]);
      assertState(s);
    });
    t("only the claiming player's tickets update", function () {
      var s = newGame({ seed: 42 });
      testGiveTicket(s, 0, KC_HOUSTON);
      testGiveTicket(s, 1, NY_ATLANTA);
      claimFor(s, 0, pairId("Kansas City", "Oklahoma City"));
      claimFor(s, 0, pairId("Oklahoma City", "Dallas"));
      claimFor(s, 0, pairId("Dallas", "Houston"));
      if (s.players[0].ticketState[KC_HOUSTON] !== "connected") throw new Error("p0 not completed");
      if (s.players[1].ticketState[NY_ATLANTA] !== "unstarted") throw new Error("p1 was affected");
      assertState(s);
    });
    t("a mid-game ticket already connected is marked at keep time", function () {
      var s = newGame({ seed: 43 });
      claimFor(s, 0, pairId("Kansas City", "Oklahoma City"));
      claimFor(s, 0, pairId("Oklahoma City", "Dallas"));
      claimFor(s, 0, pairId("Dallas", "Houston"));
      var guard = 0;
      while (s.turn.active !== 0) { pass(s); if (++guard > 20) throw new Error("rotation stuck"); }
      s.decks.tickets.draw = [KC_HOUSTON, SSM_NASH, DEN_ELPASO];
      enterAction(s, "drawingTickets");
      var drawn = beginTicketDraw(s);
      if (drawn.length !== 3 || drawn.indexOf(KC_HOUSTON) === -1) throw new Error("drawn " + JSON.stringify(drawn));
      resolveTicketDraw(s, [KC_HOUSTON]);
      if (s.players[0].ticketState[KC_HOUSTON] !== "connected")
        throw new Error("kept-and-connected ticket not marked: " + s.players[0].ticketState[KC_HOUSTON]);
      if (s.decks.tickets.discard.indexOf(SSM_NASH) === -1 || s.decks.tickets.discard.indexOf(DEN_ELPASO) === -1)
        throw new Error("discarded tickets were not returned to the discard pile");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── longest continuous path test suite (Task 17) ────────────────
  function runLongestPathTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function pass(s) {
      enterAction(s, "drawingCards");
      drawBlindCard(s);
      drawBlindCard(s);
      completeTurn(s);
    }
    function claimFor(s, pid, rid) {
      var guard = 0;
      while (s.turn.active !== pid) { pass(s); if (++guard > 20) throw new Error("turn rotation stuck"); }
      enterAction(s, "claimingRoute");
      var r = s.routes[rid];
      var color = r.color;
      if (color === "gray") {
        // pay a gray route with whichever color is most plentiful in the draw pile
        var counts = {};
        COLORS.forEach(function (c) { counts[c] = 0; });
        s.decks.train.draw.forEach(function (card) { if (card !== LOCOMOTIVE) counts[card]++; });
        var order = COLORS.slice().sort(function (a, b) { return counts[b] - counts[a]; });
        color = null;
        for (var j = 0; j < order.length; j++) {
          if (counts[order[j]] >= r.length) { color = order[j]; break; }
        }
        if (!color) throw new Error("no color with " + r.length + " cards left in the draw pile");
      }
      var cards = [];
      for (var i = 0; i < r.length; i++) cards.push(color);
      testGiveCards(s, pid, cards);
      claimRoute(s, rid, { color: color, locos: 0 });
      completeTurn(s);
    }
    // End the game-triggering fair round so end-of-game scoring is legal.
    function finishRound(s) {
      s.players[s.turn.active].trains = 2;
      var guard = 0;
      while (!isRoundComplete(s)) { pass(s); if (++guard > 12) throw new Error("round did not finish"); }
    }

    t("a single claimed route scores its length", function () {
      var s = newGame({ seed: 50 });
      claimFor(s, 0, pairId("Duluth", "Toronto"));
      if (longestPathLength(s, 0) !== 6) throw new Error("p0 got " + longestPathLength(s, 0));
      if (longestPathLength(s, 1) !== 0) throw new Error("p1 got " + longestPathLength(s, 1));
    });
    t("a straight chain sums all its trains", function () {
      var s = newGame({ seed: 51 });
      [pairId("Kansas City", "Saint Louis"), pairId("Saint Louis", "Nashville"),
       pairId("Nashville", "Atlanta"), pairId("Atlanta", "Charleston"), pairId("Charleston", "Raleigh")]
        .forEach(function (rid) { claimFor(s, 0, rid); });
      if (longestPathLength(s, 0) !== 9) throw new Error("got " + longestPathLength(s, 0));
    });
    t("a junction path takes both branches through the junction city", function () {
      var s = newGame({ seed: 52 });
      [pairId("Denver", "Kansas City"), pairId("Kansas City", "Saint Louis"), pairId("Saint Louis", "Nashville"),
       pairId("Nashville", "Atlanta"), pairId("Kansas City", "Oklahoma City"), pairId("Oklahoma City", "Dallas"),
       pairId("Dallas", "Houston")].forEach(function (rid) { claimFor(s, 0, rid); });
      if (longestPathLength(s, 0) !== 10) throw new Error("got " + longestPathLength(s, 0));
    });
    t("a loop with a tail revisits a city only at the junction", function () {
      var s = newGame({ seed: 53 });
      [pairId("Denver", "Santa Fe"), pairId("Oklahoma City", "Santa Fe"), pairId("Denver", "Oklahoma City"),
       pairId("Santa Fe", "El Paso")].forEach(function (rid) { claimFor(s, 0, rid); });
      if (longestPathLength(s, 0) !== 11) throw new Error("got " + longestPathLength(s, 0));
    });
    t("disconnected chains use the longest component", function () {
      var s = newGame({ seed: 54 });
      [pairId("Duluth", "Chicago"), pairId("Chicago", "Saint Louis")].forEach(function (rid) { claimFor(s, 0, rid); });
      [pairId("Denver", "Santa Fe"), pairId("Santa Fe", "El Paso"), pairId("El Paso", "Dallas")]
        .forEach(function (rid) { claimFor(s, 0, rid); });
      if (longestPathLength(s, 0) !== 8) throw new Error("got " + longestPathLength(s, 0));
    });
    t("lengths are computed for every player independently", function () {
      var s = newGame({ seed: 55 });
      claimFor(s, 0, pairId("Duluth", "Toronto"));   // 6
      claimFor(s, 1, pairId("Denver", "Santa Fe"));  // 2
      claimFor(s, 1, pairId("Santa Fe", "El Paso")); // 4 total
      var lens = longestPathLengths(s);
      if (lens[0] !== 6 || lens[1] !== 4) throw new Error("lengths " + JSON.stringify(lens));
    });
    t("the longest-path bonus goes to every tied player", function () {
      var s = newGame({ seed: 56 });
      claimFor(s, 0, pairId("Duluth", "Toronto")); // 6
      claimFor(s, 1, pairId("Sault St. Marie", "Toronto"));
      claimFor(s, 1, pairId("Pittsburgh", "Toronto"));
      claimFor(s, 1, pairId("Pittsburgh", "Washington")); // 6
      finishRound(s);
      var lp = applyLongestPathBonus(s);
      if (lp.best !== 6) throw new Error("best " + lp.best);
      if (JSON.stringify(lp.winnerIds) !== "[0,1]") throw new Error("winners " + JSON.stringify(lp.winnerIds));
      if (s.players[0].longestPathPoints !== 10 || s.players[1].longestPathPoints !== 10) throw new Error("bonus not applied");
      if (s.players[0].score !== 25 || s.players[1].score !== 16) throw new Error("scores not credited: " + s.players[0].score + " / " + s.players[1].score);
      assertState(s);
    });
    t("a single owner of the longest path receives the bonus alone", function () {
      var s = newGame({ seed: 57 });
      claimFor(s, 0, pairId("Duluth", "Toronto")); // 6
      claimFor(s, 1, pairId("Denver", "Santa Fe"));
      claimFor(s, 1, pairId("Santa Fe", "El Paso")); // 4
      finishRound(s);
      var lp = applyLongestPathBonus(s);
      if (lp.best !== 6 || JSON.stringify(lp.winnerIds) !== "[0]") throw new Error("winners " + JSON.stringify(lp.winnerIds));
      if (s.players[0].longestPathPoints !== 10 || s.players[1].longestPathPoints !== 0) throw new Error("bonus split wrong");
      assertState(s);
    });
    t("no claimed routes means no bonus at all", function () {
      var s = newGame({ seed: 58 });
      finishRound(s);
      var lp = applyLongestPathBonus(s);
      if (lp.best !== 0 || lp.winnerIds.length !== 0) throw new Error("unexpected " + JSON.stringify(lp));
      if (s.players[0].longestPathPoints !== 0 || s.players[1].longestPathPoints !== 0) throw new Error("bonus given");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── final scoring test suite (Task 18) ──────────────────────────
  function runFinalScoringTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function pass(s) {
      enterAction(s, "drawingCards");
      drawBlindCard(s);
      drawBlindCard(s);
      completeTurn(s);
    }
    function claimFor(s, pid, rid) {
      var guard = 0;
      while (s.turn.active !== pid) { pass(s); if (++guard > 20) throw new Error("turn rotation stuck"); }
      enterAction(s, "claimingRoute");
      var r = s.routes[rid];
      var color = r.color;
      if (color === "gray") {
        // pay a gray route with whichever color is most plentiful in the draw pile
        var counts = {};
        COLORS.forEach(function (c) { counts[c] = 0; });
        s.decks.train.draw.forEach(function (card) { if (card !== LOCOMOTIVE) counts[card]++; });
        var order = COLORS.slice().sort(function (a, b) { return counts[b] - counts[a]; });
        color = null;
        for (var j = 0; j < order.length; j++) {
          if (counts[order[j]] >= r.length) { color = order[j]; break; }
        }
        if (!color) throw new Error("no color with " + r.length + " cards left in the draw pile");
      }
      var cards = [];
      for (var i = 0; i < r.length; i++) cards.push(color);
      testGiveCards(s, pid, cards);
      claimRoute(s, rid, { color: color, locos: 0 });
      completeTurn(s);
    }
    function finishRound(s) {
      s.players[s.turn.active].trains = 2;
      var guard = 0;
      while (!isRoundComplete(s)) { pass(s); if (++guard > 12) throw new Error("round did not finish"); }
    }

    t("final score = routes + completed tickets - incomplete tickets + longest path", function () {
      var s = newGame({ seed: 60 });
      testGiveTicket(s, 0, pairId("Kansas City", "Houston"));
      testGiveTicket(s, 0, pairId("Denver", "El Paso"));
      testGiveTicket(s, 1, pairId("New York", "Atlanta"));
      [pairId("Kansas City", "Oklahoma City"), pairId("Oklahoma City", "Dallas"), pairId("Dallas", "Houston"),
       pairId("Denver", "Kansas City")].forEach(function (rid) { claimFor(s, 0, rid); });
      [pairId("Kansas City", "Saint Louis"), pairId("Saint Louis", "Nashville"), pairId("Nashville", "Atlanta"),
       pairId("Kansas City", "Omaha"), pairId("Duluth", "Omaha")].forEach(function (rid) { claimFor(s, 1, rid); });
      finishRound(s);
      var bd = finalScores(s);
      var p0 = bd.players[0], p1 = bd.players[1];
      if (p0.routePoints !== 12) throw new Error("p0 routes " + p0.routePoints);
      if (p0.ticketPoints !== 1) throw new Error("p0 tickets " + p0.ticketPoints);
      if (p0.longestPathLength !== 9) throw new Error("p0 longest " + p0.longestPathLength);
      if (p0.longestPathPoints !== 10) throw new Error("p0 bonus " + p0.longestPathPoints);
      if (p0.total !== 23) throw new Error("p0 total " + p0.total);
      if (p1.routePoints !== 8) throw new Error("p1 routes " + p1.routePoints);
      if (p1.ticketPoints !== -6) throw new Error("p1 tickets " + p1.ticketPoints);
      if (p1.longestPathPoints !== 0) throw new Error("p1 bonus " + p1.longestPathPoints);
      if (p1.total !== 2) throw new Error("p1 total " + p1.total);
      if (s.phase !== "gameOver") throw new Error("phase " + s.phase);
      if (s.gameEnd.reason !== "score") throw new Error("reason " + s.gameEnd.reason);
      if (JSON.stringify(s.gameEnd.winnerIds) !== "[0]") throw new Error("winners " + JSON.stringify(s.gameEnd.winnerIds));
      if (s.gameEnd.winnerId !== 0) throw new Error("winnerId");
      if (!p0.winner || p1.winner) throw new Error("winner flags");
      if (s.players[0].ticketState[pairId("Kansas City", "Houston")] !== "complete") throw new Error("satisfied ticket not frozen complete");
      if (s.players[0].ticketState[pairId("Denver", "El Paso")] !== "unstarted") throw new Error("unsatisfied ticket state");
      if (s.players[0].score !== 23) throw new Error("final score field " + s.players[0].score);
      assertState(s);
    });
    t("rankCompare: total decides first, then completed tickets, then longest path", function () {
      if (rankCompare({ total: 11, completedTickets: 0, longestPathLength: 0 }, { total: 10, completedTickets: 3, longestPathLength: 3 }) >= 0)
        throw new Error("higher total must rank first");
      if (rankCompare({ total: 10, completedTickets: 2, longestPathLength: 1 }, { total: 10, completedTickets: 1, longestPathLength: 9 }) >= 0)
        throw new Error("more completed tickets must rank first");
      if (rankCompare({ total: 10, completedTickets: 1, longestPathLength: 4 }, { total: 10, completedTickets: 1, longestPathLength: 9 }) <= 0)
        throw new Error("longer path must rank first");
      if (rankCompare({ total: 10, completedTickets: 1, longestPathLength: 4 }, { total: 10, completedTickets: 1, longestPathLength: 4 }) !== 0)
        throw new Error("a full tie must compare equal");
    });
    t("an unbreakable tie is a shared victory", function () {
      var s = newGame({ seed: 63 });
      [pairId("Duluth", "Omaha"), pairId("Kansas City", "Omaha"), pairId("Kansas City", "Oklahoma City"),
       pairId("Oklahoma City", "Dallas"), pairId("Dallas", "Houston")].forEach(function (rid) { claimFor(s, 0, rid); }); // 8 route pts, longest 8
      [pairId("Sault St. Marie", "Toronto"), pairId("Pittsburgh", "Toronto"), pairId("Pittsburgh", "Washington"),
       pairId("Washington", "Raleigh")].forEach(function (rid) { claimFor(s, 1, rid); });   // 8 route pts, longest 8
      finishRound(s);
      var bd = finalScores(s);
      if (bd.players[0].total !== 18 || bd.players[1].total !== 18) throw new Error("totals " + bd.players[0].total + " / " + bd.players[1].total);
      if (bd.players[0].longestPathLength !== 8 || bd.players[1].longestPathLength !== 8) throw new Error("longest paths must tie");
      if (JSON.stringify(s.gameEnd.winnerIds) !== "[0,1]") throw new Error("winners " + JSON.stringify(s.gameEnd.winnerIds));
      if (s.gameEnd.winnerId !== 0) throw new Error("first winnerId " + s.gameEnd.winnerId);
      if (!bd.players[0].winner || !bd.players[1].winner) throw new Error("winner flags");
      assertState(s);
    });
    t("finalScores rejects before the fair final round is complete", function () {
      var s = newGame({ seed: 64 });
      var err = null;
      try { finalScores(s); } catch (e) { err = e.message; }
      if (!err || err.indexOf("final round") === -1) throw new Error("expected rejection, got '" + err + "'");
      err = null;
      try { applyLongestPathBonus(s); } catch (e) { err = e.message; }
      if (!err || err.indexOf("final round") === -1) throw new Error("expected bonus rejection, got '" + err + "'");
    });
    t("final scoring and the longest-path bonus are idempotent", function () {
      var s = newGame({ seed: 65 });
      claimFor(s, 0, pairId("Duluth", "Toronto"));
      finishRound(s);
      var bd1 = finalScores(s);
      var bd2 = finalScores(s);
      if (bd1 !== bd2) throw new Error("breakdown not cached");
      var lp = applyLongestPathBonus(s);
      if (lp !== s.gameEnd.longestPath) throw new Error("bonus not idempotent");
      assertState(s);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── AI opponent policy test suite (Tasks 19–21) ─────────────────
  function runAiPolicyTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    function pass(s) {
      enterAction(s, "drawingCards");
      drawBlindCard(s);
      drawBlindCard(s);
      completeTurn(s);
    }
    function claimFor(s, pid, rid) {
      var guard = 0;
      while (s.turn.active !== pid) { pass(s); if (++guard > 20) throw new Error("turn rotation stuck"); }
      enterAction(s, "claimingRoute");
      var r = s.routes[rid];
      var color = r.color;
      if (color === "gray") {
        var counts = {};
        COLORS.forEach(function (c) { counts[c] = 0; });
        s.decks.train.draw.forEach(function (card) { if (card !== LOCOMOTIVE) counts[card]++; });
        var order = COLORS.slice().sort(function (a, b) { return counts[b] - counts[a]; });
        color = null;
        for (var j = 0; j < order.length; j++) {
          if (counts[order[j]] >= r.length) { color = order[j]; break; }
        }
        if (!color) throw new Error("no color with " + r.length + " cards left in the draw pile");
      }
      var cards = [];
      for (var i = 0; i < r.length; i++) cards.push(color);
      testGiveCards(s, pid, cards);
      claimRoute(s, rid, { color: color, locos: 0 });
      completeTurn(s);
    }
    // Rebuild the entire train-card system deterministically: face-up row,
    // every player's hand, and a fresh shuffled draw pile (conservation
    // kept — the system is redefined as a whole, so any seed's unlucky
    // card distribution can't strand a test).
    function setTrainState(s, faceUp, handSets) {
      var deck = buildTrainDeck();
      faceUp.forEach(function (c) {
        var i = deck.indexOf(c);
        if (i === -1) throw new Error("setTrainState: '" + c + "' not in the base deck");
        deck.splice(i, 1);
      });
      handSets.forEach(function (counts) {
        Object.keys(counts || {}).forEach(function (c) {
          for (var i = 0; i < counts[c]; i++) {
            var j = deck.indexOf(c);
            if (j === -1) throw new Error("setTrainState: too many '" + c + "' requested");
            deck.splice(j, 1);
          }
        });
      });
      gameRng(s).shuffle(deck);
      s.decks.train.draw = deck;
      s.decks.train.discard = [];
      s.faceUp = faceUp.slice();
      s.faceUpFresh = faceUp.map(function () { return false; });
      s.players.forEach(function (pl, i) {
        var counts = handSets[i] || {};
        CARD_TYPES.forEach(function (c) { pl.hand[c] = counts[c] || 0; });
      });
    }
    var KC_HOUSTON = pairId("Kansas City", "Houston");

    t("hard draw policy takes the face-up card its tickets need", function () {
      var s = makePlaying(2, 70);
      testGiveTicket(s, 0, pairId("Chicago", "New Orleans"));   // needs green (Chicago-Saint Louis + Little Rock-New Orleans)
      setTrainState(s, ["green", "red", "purple", "orange", "yellow"], [{}, {}]);
      enterAction(s, "drawingCards");
      var choice = aiChooseDraw(s, 0, "hard");
      if (choice.type !== "faceUp") throw new Error("expected a face-up pick, got " + JSON.stringify(choice));
      if (s.faceUp[choice.index] !== "green") throw new Error("expected the green slot, got index " + choice.index + " = " + s.faceUp[choice.index]);
      takeFaceUpCard(s, choice.index);
      if (s.players[0].hand.green < 1) throw new Error("green not added to hand");
      assertState(s);
    });
    t("draw policy honors the locomotive rules (fresh / single-card / never 2nd)", function () {
      var s = makePlaying(2, 71);
      setTrainState(s, ["locomotive", "red", "green", "blue", "yellow"], [{}, {}]);
      enterAction(s, "drawingCards");
      var c1 = aiChooseDraw(s, 0, "hard");
      if (c1.type !== "faceUp" || s.faceUp[c1.index] !== "locomotive")
        throw new Error("hard AI should take an available locomotive first");
      takeFaceUpCard(s, c1.index);
      if (s.turn.locoLock !== true || s.turn.cardsDrawn !== 1) throw new Error("loco lock not applied");
      if (aiChooseDraw(s, 0, "hard") !== null) throw new Error("no second draw may follow a locomotive");
      completeTurn(s);
      assertState(s);

      // a freshly revealed locomotive must never be picked
      var s2 = makePlaying(2, 71);
      setTrainState(s2, ["locomotive", "red", "green", "blue", "yellow"], [{}, {}]);
      s2.faceUpFresh[0] = true;
      enterAction(s2, "drawingCards");
      var c2 = aiChooseDraw(s2, 0, "hard");
      if (c2.type === "faceUp" && s2.faceUp[c2.index] === "locomotive") throw new Error("picked a fresh locomotive");
      if (c2.type === "faceUp") takeFaceUpCard(s2, c2.index); else drawBlindCard(s2);
      if (s2.turn.cardsDrawn !== 1) throw new Error("cardsDrawn " + s2.turn.cardsDrawn);
      s2.turn.locoLock = false;
      var c3 = aiChooseDraw(s2, 0, "hard");
      if (c3.type === "faceUp" && s2.faceUp[c3.index] === "locomotive") throw new Error("picked a locomotive as the second card");
      assertState(s2);

      // the engine itself must reject a locomotive as the second card of a turn
      var s3 = makePlaying(2, 71);
      setTrainState(s3, ["locomotive", "red", "green", "blue", "yellow"], [{}, {}]);
      enterAction(s3, "drawingCards");
      s3.turn.cardsDrawn = 1;   // a first draw already made this turn
      var err = null;
      try { takeFaceUpCard(s3, 0); } catch (e) { err = e.message; }
      if (!err || err.indexOf("single card") === -1) throw new Error("engine allowed a loco as the 2nd card: " + err);
      assertState(s3);
    });
    t("hard route policy completes a ticket when it is clearly the best claim", function () {
      var s = makePlaying(2, 72);
      testGiveTicket(s, 0, KC_HOUSTON);
      claimFor(s, 0, pairId("Kansas City", "Oklahoma City"));
      claimFor(s, 0, pairId("Oklahoma City", "Dallas"));
      setTrainState(s, ["red", "blue", "orange", "white", "green"], [{ red: 1 }, {}]);   // only 1 train card
      var guard = 0;
      while (s.turn.active !== 0) { pass(s); if (++guard > 20) throw new Error("rotation stuck"); }
      enterAction(s, "claimingRoute");
      var claim = aiChooseRoute(s, 0, "hard");
      if (!claim) throw new Error("no claimable route found");
      if (claim.routeId !== pairId("Dallas", "Houston"))
        throw new Error("expected the ticket-completing route, got " + claim.routeId);
      claimRoute(s, claim.routeId, claim.payment);
      if (s.players[0].ticketState[KC_HOUSTON] !== "connected") throw new Error("ticket not completed by AI claim");
      assertState(s);
    });
    t("route policy never returns an illegal claim", function () {
      var s = makePlaying(2, 73);
      setTrainState(s, ["red", "blue", "orange", "white", "green"],
        [{ black: 3, red: 3, green: 3, blue: 3, orange: 3, purple: 3, white: 3, yellow: 3, locomotive: 2 }, {}]);
      enterAction(s, "claimingRoute");
      for (var i = 0; i < 20; i++) {
        var claim = aiChooseRoute(s, 0, "easy");
        if (!claim) throw new Error("expected a claimable route with a full hand");
        if (claimBlockedReason(s, claim.routeId)) throw new Error("chose a blocked route " + claim.routeId);
        var ok = cardPaymentOptions(s.players[0], s.routes[claim.routeId]).some(function (p) {
          return (p.color == null ? null : p.color) === (claim.payment.color == null ? null : claim.payment.color) && p.locos === claim.payment.locos;
        });
        if (!ok) throw new Error("chose an invalid payment for " + claim.routeId);
      }
    });
    t("route policy returns null when nothing is claimable", function () {
      var s = makePlaying(2, 74);
      setTrainState(s, ["red", "blue", "orange", "white", "green"], [{}, {}]);   // no cards at all
      enterAction(s, "claimingRoute");
      if (aiChooseRoute(s, 0, "hard") !== null) throw new Error("expected no claimable route");
    });
    t("ticket keep always keeps at least one drawn ticket, and prefers a near-complete one", function () {
      var s = makePlaying(2, 75);
      claimFor(s, 0, pairId("Denver", "Santa Fe"));   // half of the Denver-El Paso path
      while (s.turn.active !== 0) pass(s);
      var tidA = pairId("Denver", "El Paso"), tidB = pairId("Winnipeg", "Little Rock"), tidC = pairId("Vancouver", "Montreal");
      [tidA, tidB, tidC].forEach(function (tid) {
        var i = s.decks.tickets.draw.indexOf(tid);
        if (i !== -1) s.decks.tickets.draw.splice(i, 1);
        i = s.decks.tickets.discard.indexOf(tid);
        if (i !== -1) s.decks.tickets.discard.splice(i, 1);
      });
      s.pendingTickets = [tidA, tidB, tidC];
      s.turn.substate = "drawingTickets";
      var keep = aiChooseTicketKeep(s, 0, "hard");
      if (!Array.isArray(keep) || keep.length < 1) throw new Error("kept nothing");
      keep.forEach(function (tid) {
        if (s.pendingTickets.indexOf(tid) === -1) throw new Error("kept a ticket that was not drawn");
      });
      if (keep.indexOf(tidA) === -1) throw new Error("did not keep the near-complete ticket");
      resolveTicketDraw(s, keep);
      if (s.players[0].ticketIds.indexOf(tidA) === -1) throw new Error("keep not applied");
      assertState(s);
    });
    t("action policy returns a legal action, or none when the round is complete", function () {
      var s = makePlaying(2, 76);
      var action = aiChooseAction(s, 0, "hard");
      if (["drawingCards", "claimingRoute", "drawingTickets"].indexOf(action) === -1)
        throw new Error("unexpected action " + action);
      enterAction(s, action);
      if (action === "drawingCards") {
        drawBlindCard(s);
        drawBlindCard(s);
      } else if (action === "drawingTickets") {
        beginTicketDraw(s);
        resolveTicketDraw(s, [s.pendingTickets[0]]);
      } else {
        var c = aiChooseRoute(s, 0, "hard");
        if (!c) throw new Error("claimingRoute chosen but nothing is claimable");
        claimRoute(s, c.routeId, c.payment);
      }
      completeTurn(s);
      assertState(s);
      s.players[s.turn.active].trains = 2;
      pass(s);   // trigger the fair final round
      var guard = 0;
      while (!isRoundComplete(s)) { pass(s); if (++guard > 6) throw new Error("round did not finish"); }
      if (aiChooseAction(s, s.turn.active, "hard") !== null) throw new Error("actions must be blocked after the final round");
    });
    t("a deadlocked board (empty deck, nothing claimable, no tickets) ends the game", function () {
      var s = makePlaying(2, 80);
      var p0 = s.players[0], p1 = s.players[1];
      CARD_TYPES.forEach(function (c) {
        p1.hand[c] += p0.hand[c];                       // park p0's starting cards with p1
        p0.hand[c] = 0;
        p1.hand[c] += s.decks.train.draw.filter(function (x) { return x === c; }).length;
        p1.hand[c] += s.decks.train.discard.filter(function (x) { return x === c; }).length;
      });
      s.decks.train.draw = [];
      s.decks.train.discard = [];
      s.decks.tickets.draw = [];
      s.decks.tickets.discard = [];
      p0.trains = 3;   // above the ≤2 train trigger, so only the stall guard can end the game
      enterAction(s, "drawingCards");
      if (s.decks.train.draw.length + s.decks.train.discard.length !== 0) throw new Error("deck should be empty");
      completeTurn(s);
      if (!s.gameEnd.triggered) throw new Error("stall did not trigger the end");
      if (s.gameEnd.triggerPlayerId !== 0) throw new Error("trigger " + s.gameEnd.triggerPlayerId);
      if (s.gameEnd.stopAtTurnCount !== 2) throw new Error("stopAt " + s.gameEnd.stopAtTurnCount);
      assertState(s);
    });
    t("aiTakeTurn drives full turns legally with mixed difficulties", function () {
      var s = makePlaying(2, 77);
      var diffs = ["easy", "normal", "hard"];
      var count0 = 0;
      for (var i = 0; i < 24; i++) {
        var pid = s.turn.active;
        var before = s.turn.count;
        var sum = aiTakeTurn(s, pid, diffs[i % 3]);
        if (sum.action === "none") throw new Error("turn stalled at turn " + s.turn.count);
        if (s.turn.count !== before + 1) throw new Error("turn did not complete");
        if (s.turn.active === 0) count0++;
        assertState(s);
      }
      if (count0 < 8) throw new Error("unbalanced rotation");
    });
    t("a seeded AI game is deterministic", function () {
      var s1 = newGame({ seed: 99 }), s2 = newGame({ seed: 99 });
      for (var i = 0; i < 10; i++) {
        aiTakeTurn(s1, s1.turn.active, "hard");
        aiTakeTurn(s2, s2.turn.active, "hard");
      }
      function snap(s) {
        return JSON.stringify({
          rng: s.rng.state,
          count: s.turn.count,
          active: s.turn.active,
          hands: s.players.map(function (p) { return p.hand; }),
          routes: s.players.map(function (p) { return p.claimedRoutes; }),
          tickets: s.players.map(function (p) { return p.ticketIds; })
        });
      }
      if (snap(s1) !== snap(s2)) throw new Error("two runs with the same seed diverged");
      assertState(s1);
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── full-game integration tests (Task 22) ────────────────────────
  // Plays complete seeded games vs 1–3 AI through the public engine
  // (deal tickets, aiTakeTurn until the ≤2-trains end trigger fires,
  // fair final round, finalScores) and asserts: every AI decision goes
  // through the validated action engine without ever throwing, turn
  // counts stay bounded, final scores are internally consistent, and
  // the same seed replays to an identical state with a deterministic
  // winner.
  function runFullGameTests() {
    var results = [];
    function t(name, fn) {
      try { fn(); results.push({ name: name, ok: true }); }
      catch (e) { results.push({ name: name, ok: false, error: (e && e.message) || String(e) }); }
    }
    // Deal the initial 3-keep-≥2 destination tickets to every player by
    // going around the table once through the mid-game draw path (newGame
    // starts in phase "playing", where setupInitialTickets cannot run).
    function dealSetupTickets(s) {
      for (var i = 0; i < s.players.length; i++) {
        if (s.turn.active !== i) throw new Error("setup dealing out of turn order");
        enterAction(s, "drawingTickets");
        beginTicketDraw(s);
        var keep = aiChooseTicketKeep(s, i, "hard");
        resolveTicketDraw(s, keep);
        completeTurn(s);
      }
    }
    function playToEnd(seed, playerCount) {
      var players = [];
      for (var i = 0; i < playerCount; i++) players.push({ name: "Bot " + (i + 1), kind: "ai" });
      var s = newGame({ seed: seed, players: players });
      dealSetupTickets(s);
      var diffs = ["easy", "normal", "hard"];
      var guard = 0, aiSteps = 0;
      while (s.phase !== "gameOver") {
        if (++guard > 600) throw new Error("game did not end after 600 turns (seed " + seed + ")");
        if (isRoundComplete(s)) { finalScores(s); break; }
        var pid = s.turn.active;
        var before = s.turn.count;
        var sum = aiTakeTurn(s, pid, diffs[aiSteps++ % 3]);
        if (sum.action === "none") throw new Error("AI stalled at turn " + s.turn.count + " (seed " + seed + ")");
        if (s.turn.count !== before + 1) throw new Error("turn did not complete (seed " + seed + ")");
        assertState(s);
      }
      return s;
    }
    function snapshot(s) {
      return JSON.stringify({
        rng: s.rng.state,
        count: s.turn.count,
        active: s.turn.active,
        players: s.players.map(function (p) {
          return {
            hand: p.hand, trains: p.trains, score: p.score, routePoints: p.routePoints,
            claimedRoutes: p.claimedRoutes, ticketIds: p.ticketIds,
            ticketState: p.ticketState, longestPathPoints: p.longestPathPoints
          };
        }),
        breakdown: s.gameEnd.breakdown
      });
    }
    function verifyBreakdown(s) {
      var bd = s.gameEnd.breakdown;
      if (!bd || !Array.isArray(bd.players)) throw new Error("no score breakdown");
      if (bd.players.length !== s.players.length) throw new Error("breakdown player count mismatch");
      bd.players.forEach(function (p) {
        var calc = p.routePoints + p.ticketPoints + p.longestPathPoints;
        if (calc !== p.total) throw new Error(p.name + ": breakdown total " + p.total + " != " + calc);
        if (p.total !== s.players[p.playerId].score) throw new Error(p.name + ": player score != breakdown total");
        var tkSum = 0;
        p.tickets.forEach(function (tk) { tkSum += tk.points; });
        if (tkSum !== p.ticketPoints) throw new Error(p.name + ": ticket points mismatch");
      });
      if (!bd.winners || bd.winners.length === 0) throw new Error("no winner resolved");
      var top = bd.players[bd.winners[0]];
      bd.winners.forEach(function (wid) {
        if (bd.players[wid].total !== top.total) throw new Error("winner total mismatch");
      });
    }
    t("a seeded 4-player game vs 3 AI completes legally end-to-end", function () {
      var s = playToEnd(101, 4);
      if (s.phase !== "gameOver") throw new Error("game did not reach gameOver");
      if (s.turn.count >= 600) throw new Error("turn count out of bounds");
      if (!s.gameEnd.breakdown) throw new Error("no final breakdown");
    });
    t("full games complete vs 1 and 2 AI opponents", function () {
      playToEnd(202, 2);
      playToEnd(303, 3);
    });
    t("final scores are internally consistent (breakdown sums match)", function () {
      verifyBreakdown(playToEnd(404, 3));
    });
    t("same seed replays to an identical final state and winner", function () {
      var s1 = playToEnd(505, 4), s2 = playToEnd(505, 4);
      if (snapshot(s1) !== snapshot(s2)) throw new Error("seeded replays diverged");
      if (s1.gameEnd.winnerId !== s2.gameEnd.winnerId) throw new Error("winner not deterministic");
    });
    t("different seeds produce different games", function () {
      var s1 = playToEnd(606, 3), s2 = playToEnd(607, 3);
      if (snapshot(s1) === snapshot(s2)) throw new Error("different seeds produced identical games");
    });

    var passed = results.filter(function (r) { return r.ok; }).length;
    return { passed: passed, failed: results.length - passed, total: results.length, results: results };
  }

  // ── aggregate runner ─────────────────────────────────────────────
  function runAllTests() {
    var suites = [runStateModelTests(), runStateMachineTests(), runMapTests(), runPrngTests(), runDeckTests(), runFaceUpTests(), runTicketDeckTests(), runTicketDrawTests(), runHandIntegrityTests(), runTurnActionTests(), runRouteClaimTests(), runConnectivityTests(), runTurnSequenceTests(), runTicketCompletionTests(), runLongestPathTests(), runFinalScoringTests(), runAiPolicyTests(), runFullGameTests()];
    var failures = [];
    suites.forEach(function (s) { failures = failures.concat(s.results.filter(function (r) { return !r.ok; })); });
    return {
      passed: suites.reduce(function (a, s) { return a + s.passed; }, 0),
      failed: suites.reduce(function (a, s) { return a + s.failed; }, 0),
      total: suites.reduce(function (a, s) { return a + s.total; }, 0),
      model: suites[0].passed + "/" + suites[0].total,
      machine: suites[1].passed + "/" + suites[1].total,
      map: suites[2].passed + "/" + suites[2].total,
      prng: suites[3].passed + "/" + suites[3].total,
      deck: suites[4].passed + "/" + suites[4].total,
      faceUp: suites[5].passed + "/" + suites[5].total,
      ticketDeck: suites[6].passed + "/" + suites[6].total,
      ticketDraw: suites[7].passed + "/" + suites[7].total,
      handIntegrity: suites[8].passed + "/" + suites[8].total,
      turnActions: suites[9].passed + "/" + suites[9].total,
      routeClaims: suites[10].passed + "/" + suites[10].total,
      connectivity: suites[11].passed + "/" + suites[11].total,
      turnSequence: suites[12].passed + "/" + suites[12].total,
      ticketCompletion: suites[13].passed + "/" + suites[13].total,
      longestPath: suites[14].passed + "/" + suites[14].total,
      finalScoring: suites[15].passed + "/" + suites[15].total,
      aiPolicies: suites[16].passed + "/" + suites[16].total,
      fullGame: suites[17].passed + "/" + suites[17].total,
      failures: failures
    };
  }

  window.TtR = {
    COLORS: COLORS, LOCOMOTIVE: LOCOMOTIVE, CARD_TYPES: CARD_TYPES,
    TRAIN_CARDS_PER_COLOR: TRAIN_CARDS_PER_COLOR, LOCO_COUNT: LOCO_COUNT,
    TOTAL_TRAIN_CARDS: TOTAL_TRAIN_CARDS, TRAINS_START: TRAINS_START,
    PLAYER_MIN: PLAYER_MIN, PLAYER_MAX: PLAYER_MAX, FACEUP_SIZE: FACEUP_SIZE,
    PHASES: PHASES, SUBSTATES: SUBSTATES, TICKET_STATES: TICKET_STATES,
    PLAYER_COLORS: PLAYER_COLORS,
    PHASE_TRANSITIONS: PHASE_TRANSITIONS, SUBSTATE_TRANSITIONS: SUBSTATE_TRANSITIONS,
    MAP: MAP, validateMap: validateMap, buildNorthAmericaMap: buildNorthAmericaMap,
    ticketCatalog: ticketCatalog, pairId: pairId,
    createState: createState, assertState: assertState, mutate: mutate,
    toJSON: toJSON, fromJSON: fromJSON, cloneState: cloneState,
    toCompact: toCompact, fromCompact: fromCompact, compactState: compactState, rehydrateCompact: rehydrateCompact,
    buildTrainDeck: buildTrainDeck,
    mulberry32: mulberry32, createRng: createRng, gameRng: gameRng,
    newGame: newGame, drawTrainCard: drawTrainCard,
    takeFaceUpCard: takeFaceUpCard, drawBlindCard: drawBlindCard,
    testGiveCards: testGiveCards, testGiveTicket: testGiveTicket,
    buildTicketDeck: buildTicketDeck, drawTicket: drawTicket,
    beginTicketDraw: beginTicketDraw, resolveTicketDraw: resolveTicketDraw,
    setupInitialTickets: setupInitialTickets, payCards: payCards, handSize: handSize,
    ROUTE_POINTS: ROUTE_POINTS, routeOwner: routeOwner, routePairId: routePairId,
    doubleRouteLocked: doubleRouteLocked, cardPaymentOptions: cardPaymentOptions,
    claimBlockedReason: claimBlockedReason, claimPayments: claimPayments, claimRoute: claimRoute,
    claimEligible: claimEligible,
    playerGraph: playerGraph, citiesConnected: citiesConnected, isRoundComplete: isRoundComplete,
    updateTicketCompletions: updateTicketCompletions, longestPathLength: longestPathLength,
    longestPathLengths: longestPathLengths, applyLongestPathBonus: applyLongestPathBonus,
    finalScores: finalScores, rankCompare: rankCompare, LONGEST_PATH_BONUS: LONGEST_PATH_BONUS,
    startGame: startGame, endGame: endGame, enterAction: enterAction, completeTurn: completeTurn,
    forceCompleteTurn: forceCompleteTurn,
    canStartGame: canStartGame, canEndGame: canEndGame, canCompleteTurn: canCompleteTurn,
    legalActions: legalActions,
    runStateModelTests: runStateModelTests, runStateMachineTests: runStateMachineTests,
    runMapTests: runMapTests, runPrngTests: runPrngTests, runDeckTests: runDeckTests,
    runFaceUpTests: runFaceUpTests, runTicketDeckTests: runTicketDeckTests,
    runTicketDrawTests: runTicketDrawTests, runHandIntegrityTests: runHandIntegrityTests,
    runTurnActionTests: runTurnActionTests, runRouteClaimTests: runRouteClaimTests,
    runConnectivityTests: runConnectivityTests, runTurnSequenceTests: runTurnSequenceTests,
    runTicketCompletionTests: runTicketCompletionTests, runLongestPathTests: runLongestPathTests,
    runFinalScoringTests: runFinalScoringTests,
    runFullGameTests: runFullGameTests,
    AI_DIFFICULTIES: AI_DIFFICULTIES, aiShortestPath: aiShortestPath, aiNeededColors: aiNeededColors,
    aiChooseAction: aiChooseAction, aiChooseDraw: aiChooseDraw, aiChooseRoute: aiChooseRoute,
    aiChooseTicketKeep: aiChooseTicketKeep, aiTakeTurn: aiTakeTurn, runAiPolicyTests: runAiPolicyTests,
    runAllTests: runAllTests
  };
})();
