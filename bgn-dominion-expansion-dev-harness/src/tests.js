/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/tests.js  (Task 1: rule-assertion suite)
   Deterministic test harness. Tests are registered with t(name, fn)
   and run with DominionTest.runAll(). Each task's implementation is
   expected to add its own tests here. Runs in the page via
   ?tests=1 (or location.hash = "#tests"), and in worker contexts
   via the same globals (engine/cards attach to globalThis).
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = global.Dominion;
  const results = { passed: [], failed: [] };
  const coreSuite = { name: "core", opts: {}, cases: [] };
  const suites = [coreSuite];
  let selectedSuites = null;              // null => run every suite
  let lastRanCount = 0;

  function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || "values differ") + " — expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }
  function deepEq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "objects differ") + " — expected " + JSON.stringify(b) + ", got " + JSON.stringify(a)); }

  function t(name, fn) { coreSuite.cases.push({ name, fn, suite: "core" }); }

  /* defineSuite(name, { set }, fn) — register an expansion suite.
     fn receives (t, h): t registers cases tagged with the suite
     name, and h is the shared helper set (assert, eq, deepEq,
     scenario). The suite's opts.set is loaded into the catalog
     (installed sets + that set) by runAll() just before its cases
     run, so exp tests can rely on their set being registered. */
  function defineSuite(name, opts, fn) {
    opts = opts || {};
    const suite = { name: name, opts: opts, cases: [] };
    const helper = { assert: assert, eq: eq, deepEq: deepEq, scenario: scenario };
    const t2 = (n, f) => suite.cases.push({ name: n, fn: f, suite: name });
    fn(t2, helper);
    suites.push(suite);
    return suite;
  }

  /* select("all" | [names]) — choose which suites runAll executes.
     Default (never called) runs everything. */
  function select(names) {
    selectedSuites = (names === "all") ? null : new Set(names);
  }

  /* scenario(opts) — the fixture DSL for exact-position tests.
     Builds a bare game state (no kingdom, no auto-draw) with the
     given zones, so tests can drive beginTurn/play/buy deterministically.
       players          — player count (default 2)
       seed             — rng seed (default 7)
       deck             — [perPlayer: string[]]
       hand             — [perPlayer: string[]]
       activeDurations  — [perPlayer: string[]] seeded into the duration zone
       supply           — {cardId: count} overrides on top of the basic piles */
  function scenario(opts) {
    opts = opts || {};
    const n = opts.players == null ? 2 : opts.players;
    if (!Number.isInteger(n) || n < 1 || n > 6) throw new Error("scenario: players must be an integer from 1 to 6");
    const g = Dominion.engine.createGame({ seed: opts.seed == null ? 7 : opts.seed });
    for (let i = 1; i <= n; i++) g.players.push(Dominion.engine.createPlayer("p" + i, "Player " + i));
    g.supply = {};
    for (const id of Dominion.engine.BASIC_PILES) {
      g.supply[id] = (id === "copper") ? 60 : (id === "silver") ? 40 : (id === "gold") ? 30 : (n >= 3 ? 12 : 8);
    }
    if (opts.supply) for (const k of Object.keys(opts.supply)) g.supply[k] = opts.supply[k];
    const decks = opts.deck || [];
    const hands = opts.hand || [];
    const durs = opts.activeDurations || [];
    for (let i = 0; i < n; i++) {
      const p = g.players[i];
      p.deck = (decks[i] || []).slice();
      p.hand = (hands[i] || []).slice();
      p.duration = (durs[i] || []).slice();
    }
    g.kingdom = [];
    g.playerCount = n;
    return g;
  }

  /* ══════════════════ Task 1: skeleton + harness ═══════════════ */
  t("rng: same seed yields identical sequences", () => {
    deepEq(Dominion.engine.rng(42).sequence(12), Dominion.engine.rng(42).sequence(12), "seed 42 must be deterministic");
  });
  t("rng: different seeds differ", () => {
    assert(JSON.stringify(Dominion.engine.rng(42).sequence(6)) !== JSON.stringify(Dominion.engine.rng(43).sequence(6)), "seeds 42 and 43 must differ");
  });
  t("rng: values are within [0,1)", () => {
    for (const v of Dominion.engine.rng(7).sequence(250)) assert(v >= 0 && v < 1, "out of range: " + v);
  });
  t("shuffle: deterministic per seed", () => {
    const src = ["a", "b", "c", "d", "e", "f", "g", "h"];
    deepEq(Dominion.engine.shuffle(src, Dominion.engine.rng(99)), Dominion.engine.shuffle(src, Dominion.engine.rng(99)), "same seed must shuffle identically");
  });
  t("shuffle: is a permutation of the input", () => {
    const src = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const out = Dominion.engine.shuffle(src, Dominion.engine.rng(123));
    eq(out.length, src.length, "length must match");
    deepEq(out.slice().sort((a, b) => a - b), src.slice().sort((a, b) => a - b), "must be a permutation");
  });
  t("player: state shape has all zones and zeroed resources", () => {
    const p = Dominion.engine.createPlayer("p1", "Alice");
    for (const zone of ["deck", "hand", "discard", "play", "duration", "reserve", "setAside", "exile"]) assert(Array.isArray(p[zone]), zone + " must be an array");
    for (const res of ["actions", "buys", "coins", "potions", "debt", "coffers", "villagers", "vpTokens"]) eq(p[res], 0, res + " must start at 0");
  });
  t("game: state shape", () => {
    const g = Dominion.engine.createGame({ seed: 5 });
    eq(g.seed, 5, "seed stored");
    assert(typeof g.rand === "function", "rand present");
    assert(Array.isArray(g.players) && Array.isArray(g.trash) && Array.isArray(g.log), "collections present");
    assert(g.supply && typeof g.supply === "object", "supply map present");
    eq(g.phase, "none", "initial phase");
    eq(g.version, Dominion.engine.VERSION, "version stamped");
  });

  /* ══════════════════ Task 2: schema + base catalog ═════════════ */
  t("cards: base catalog loads exactly 8 cards", async () => {
    const res = await Dominion.cards.init(["base"]);
    eq(res.count, 8, "base file count");
    eq(Dominion.cards.count(), 8, "registry size");
  });
  t("cards: base card fields are exact", async () => {
    await Dominion.cards.init(["base"]);
    const copper = Dominion.cards.get("copper");
    assert(copper, "copper registered");
    eq(copper.cost.coins, 0, "copper cost");
    eq(copper.cost.potion, 0, "copper potion cost");
    eq(copper.treasure, 1, "copper treasure value");
    eq(copper.pileSize, 60, "copper pile size");
    eq(copper.startDeck, 7, "copper startDeck");
    assert(copper.types.includes("Treasure"), "copper is a Treasure");
    eq(Dominion.cards.get("silver").cost.coins, 3, "silver cost");
    eq(Dominion.cards.get("silver").treasure, 2, "silver value");
    eq(Dominion.cards.get("gold").cost.coins, 6, "gold cost");
    eq(Dominion.cards.get("gold").treasure, 3, "gold value");
    eq(Dominion.cards.get("estate").startDeck, 3, "estate startDeck");
    eq(Dominion.cards.get("estate").vp, 1, "estate VP");
    eq(Dominion.cards.get("duchy").vp, 3, "duchy VP");
    eq(Dominion.cards.get("province").vp, 6, "province VP");
    eq(Dominion.cards.get("curse").vp, -1, "curse VP");
  });
  t("cards: ids are unique across the catalog", async () => {
    await Dominion.cards.init(["base"]);
    const ids = Dominion.cards.all().map((c) => c.id);
    eq(new Set(ids).size, ids.length, "all ids unique");
  });
  t("cards: every registered card passes its own schema", async () => {
    await Dominion.cards.init(["base"]);
    for (const c of Dominion.cards.all()) {
      deepEq(Dominion.cards.validate({ ...c, cost: { coins: c.cost.coins, potion: c.cost.potion } }), [], "card '" + c.id + "' must validate");
    }
  });
  t("cards: registry rejects invalid definitions", () => {
    const bad = [
      { id: "x1", name: "X", cost: { coins: -1, potion: 0 }, types: ["Action"], text: "", expansion: "test" },
      { id: "x2", name: "X", cost: { coins: 1, potion: 0 }, types: ["Bogus"], text: "", expansion: "test" },
      { id: "x3", name: "", cost: { coins: 1, potion: 0 }, types: ["Action"], text: "", expansion: "test" },
      { id: "x4", name: "X", cost: { coins: 1, potion: 0 }, types: [], text: "", expansion: "test" },
      { id: "x5", name: "X", cost: { coins: 1.5, potion: 0 }, types: ["Action"], text: "", expansion: "test" },
      { id: "x6", name: "X", cost: { coins: 1, potion: -2 }, types: ["Action"], text: "", expansion: "test" },
      { id: "x7", name: "X", cost: { coins: 1, potion: 0 }, types: ["Action"], text: "", expansion: "" },
      { id: "x8", name: "X", cost: { coins: 1, potion: 0 }, types: ["Action"], text: 42, expansion: "test" },
      { id: "", name: "X", cost: { coins: 1, potion: 0 }, types: ["Action"], text: "", expansion: "test" }
    ];
    for (const def of bad) {
      let threw = false;
      try { Dominion.cards.register(def); } catch (e) { threw = true; }
      assert(threw, "must reject: " + JSON.stringify(def));
    }
  });
  t("cards: duplicate id is rejected", () => {
    const def = { id: "dup_test", name: "Dup", cost: { coins: 1, potion: 0 }, types: ["Action"], text: "", expansion: "test" };
    Dominion.cards.register(def);
    let threw = false;
    try { Dominion.cards.register(def); } catch (e) { threw = true; }
    assert(threw, "duplicate id must throw");
  });

  /* ══════════════════ Task 3: zones & pile movement ═════════════ */
  function freshGame() {
    const g = Dominion.engine.createGame({ seed: 7 });
    g.players.push(Dominion.engine.createPlayer("p1", "Alice"));
    g.players.push(Dominion.engine.createPlayer("p2", "Bob"));
    return g;
  }

  t("zones: hand→discard by cardId removes exactly one copy in order", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "silver", "copper", "gold"];
    Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "hand"), Dominion.engine.loc("p1", "discard"), { cardId: "copper" });
    deepEq(p1.hand, ["silver", "copper", "gold"], "only the first matching copy leaves");
    deepEq(p1.discard, ["copper"], "discarded card is the moved copy");
  });
  t("zones: move by exact index; out-of-range index rejected", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["a", "b", "c"];
    Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "hand"), Dominion.engine.loc("p1", "discard"), { index: 1 });
    deepEq(p1.hand, ["a", "c"], "index 1 removed");
    deepEq(p1.discard, ["b"], "discard gets 'b'");
    let threw = false;
    try { Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "hand"), Dominion.engine.loc("p1", "discard"), { index: 99 }); } catch (e) { threw = true; }
    assert(threw, "out-of-range index must throw");
  });
  t("zones: fromTop and fromBottom select the right deck ends", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c"];
    Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "deck"), Dominion.engine.loc("p1", "discard"), { fromTop: true });
    deepEq(p1.deck, ["a", "b"], "top (end) removed");
    deepEq(p1.discard, ["c"], "top card discarded");
    Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "deck"), Dominion.engine.loc("p1", "discard"), { fromBottom: true });
    deepEq(p1.deck, ["b"], "bottom (start) removed");
    deepEq(p1.discard, ["c", "a"], "bottom card discarded");
  });
  t("zones: draw moves the top cards to hand in draw order", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c", "d", "e"];
    const drawn = Dominion.engine.zones.draw(g, "p1", 2);
    deepEq(drawn, ["e", "d"], "draw returns cards top-first (draw order)");
    deepEq(p1.hand, ["e", "d"], "hand receives them in draw order");
    deepEq(p1.deck, ["a", "b", "c"], "deck keeps the rest");
  });
  t("zones: draw count validation (negative/non-integer rejected)", () => {
    const g = freshGame();
    Dominion.engine.player(g, "p1").deck = ["a", "b", "c"];
    let threwNeg = false;
    try { Dominion.engine.zones.draw(g, "p1", -1); } catch (e) { threwNeg = true; }
    assert(threwNeg, "negative draw must throw");
    let threwFloat = false;
    try { Dominion.engine.zones.draw(g, "p1", 2.5); } catch (e) { threwFloat = true; }
    assert(threwFloat, "fractional draw must throw");
  });
  t("zones: draw stops short when deck and discard both run out", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c"];
    p1.discard = [];
    const drawn = Dominion.engine.zones.draw(g, "p1", 7);
    deepEq(drawn, ["c", "b", "a"], "draws everything it can, in order");
    deepEq(p1.hand, ["c", "b", "a"], "hand holds the drawn cards");
    deepEq(p1.deck, [], "deck empty");
    assert(g.log[0].t === "draw" && g.log[0].count === 3, "log counts the actual draw");
  });
  t("zones: drawing from empty deck and discard draws nothing", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    const drawn = Dominion.engine.zones.draw(g, "p1", 5);
    deepEq(drawn, [], "nothing drawn");
    deepEq(p1.hand, [], "hand stays empty");
  });
  t("zones: a full draw does not touch the discard (no premature reshuffle)", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c", "d", "e"];
    p1.discard = ["x", "y", "z"];
    const drawn = Dominion.engine.zones.draw(g, "p1", 2);
    deepEq(drawn, ["e", "d"], "drew from the deck only, top-first");
    deepEq(p1.discard, ["x", "y", "z"], "discard untouched");
    deepEq(p1.deck, ["a", "b", "c"], "deck keeps the rest");
  });
  t("zones: mid-draw reshuffle (5-card deck vs 7-card draw)", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c", "d", "e"];
    p1.discard = ["x", "y", "z", "w"];
    const drawn = Dominion.engine.zones.draw(g, "p1", 7);
    eq(drawn.length, 7, "drew all seven");
    deepEq(drawn.slice(0, 5), ["e", "d", "c", "b", "a"], "original deck drawn top-first");
    eq(p1.deck.length, 2, "two cards remain in the deck (5 + 4 - 7)");
    deepEq(p1.discard, [], "discard emptied by the reshuffle");
    eq(p1.hand.length, 7, "hand has all seven");
    assert(g.log.some((e) => e.t === "reshuffle"), "reshuffle logged");
  });
  t("zones: reshuffle uses the seeded rng (same seed, same draw)", () => {
    function run(seed) {
      const g = Dominion.engine.createGame({ seed });
      g.players.push(Dominion.engine.createPlayer("p1", "Alice"));
      const p1 = g.players[0];
      p1.deck = ["c", "b", "a"];
      p1.discard = ["1", "2", "3", "4", "5", "6"];
      return Dominion.engine.zones.draw(g, "p1", 8);
    }
    deepEq(run(123), run(123), "identical seeds draw identically");
    assert(JSON.stringify(run(123)) !== JSON.stringify(run(124)), "different seeds give different orders");
  });
  t("zones: reshuffled portion equals a seeded shuffle of the discard", () => {
    const g = Dominion.engine.createGame({ seed: 99 });
    g.players.push(Dominion.engine.createPlayer("p1", "Alice"));
    const p1 = g.players[0];
    p1.deck = ["a", "b", "c", "d", "e"];
    p1.discard = ["q", "r", "s", "t", "u", "v", "w"];
    const drawn = Dominion.engine.zones.draw(g, "p1", 12);
    const tail = drawn.slice(5);
    const g2 = Dominion.engine.createGame({ seed: 99 });
    g2.players.push(Dominion.engine.createPlayer("p1", "Alice"));
    g2.players[0].discard = ["q", "r", "s", "t", "u", "v", "w"];
    const expected = Dominion.engine.shuffle(["q", "r", "s", "t", "u", "v", "w"], g2.rand).slice().reverse();
    deepEq(tail, expected, "reshuffled cards come off the deck in seeded-shuffle order");
  });
  t("zones: reshuffle on an empty discard is rejected", () => {
    const g = freshGame();
    let threw = false;
    try { Dominion.engine.zones.reshuffle(g, "p1"); } catch (e) { threw = true; }
    assert(threw, "reshuffling an empty discard must throw");
  });
  t("zones: cards stay conserved across reshuffle draws", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c"];
    p1.discard = ["d", "e", "f", "g"];
    const total = () => p1.deck.length + p1.hand.length + p1.discard.length;
    const before = total();
    Dominion.engine.zones.draw(g, "p1", 10);
    eq(total(), before, "no cards created or lost");
  });
  t("zones: gain takes from the supply into the discard", () => {
    const g = freshGame();
    g.supply = { silver: 3, gold: 2 };
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.zones.gain(g, "p1", "silver");
    deepEq(p1.discard, ["silver"], "gained card goes to discard");
    eq(g.supply.silver, 2, "supply decremented");
  });
  t("zones: gain from an empty supply pile is rejected", () => {
    const g = freshGame();
    g.supply = { silver: 1, gold: 0 };
    Dominion.engine.zones.gain(g, "p1", "silver");
    let threw = false;
    try { Dominion.engine.zones.gain(g, "p1", "silver"); } catch (e) { threw = true; }
    assert(threw, "empty pile must reject gaining");
    let threwEmpty = false;
    try { Dominion.engine.zones.gain(g, "p1", "gold"); } catch (e) { threwEmpty = true; }
    assert(threwEmpty, "zero-count pile must reject gaining");
  });
  t("zones: move to the shared trash", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["curse"];
    Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "hand"), Dominion.engine.zoneRef.trash, { cardId: "curse" });
    deepEq(g.trash, ["curse"], "trash holds the card");
    eq(Dominion.engine.zones.count(g, Dominion.engine.zoneRef.trash), 1, "trash count");
    eq(Dominion.engine.zones.count(g, Dominion.engine.loc("p1", "hand")), 0, "hand emptied");
  });
  t("zones: move to supply returns a card to its pile", () => {
    const g = freshGame();
    g.supply = { horse: 2 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["horse"];
    Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "deck"), Dominion.engine.zoneRef.supply, { cardId: "horse" });
    eq(g.supply.horse, 3, "supply incremented");
    deepEq(p1.deck, [], "deck emptied");
  });
  t("zones: no-op same-zone move is rejected", () => {
    const g = freshGame();
    Dominion.engine.player(g, "p1").hand = ["a"];
    let threw = false;
    try { Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "hand"), Dominion.engine.loc("p1", "hand"), { cardId: "a" }); } catch (e) { threw = true; }
    assert(threw, "same-zone move must throw");
  });
  t("zones: unknown player, unknown zone and missing card are rejected", () => {
    const g = freshGame();
    Dominion.engine.player(g, "p1").hand = ["a"];
    let threwPlayer = false;
    try { Dominion.engine.zones.move(g, Dominion.engine.loc("p9", "hand"), Dominion.engine.loc("p1", "hand"), { cardId: "a" }); } catch (e) { threwPlayer = true; }
    assert(threwPlayer, "unknown player must throw");
    let threwZone = false;
    try { Dominion.engine.loc("p1", "bogus"); } catch (e) { threwZone = true; }
    assert(threwZone, "unknown zone must throw");
    let threwCard = false;
    try { Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "hand"), Dominion.engine.loc("p1", "discard"), { cardId: "gold" }); } catch (e) { threwCard = true; }
    assert(threwCard, "missing card must throw");
  });
  t("zones: place bottom of the deck", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a"];
    p1.hand = ["b"];
    Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "hand"), Dominion.engine.loc("p1", "deck"), { cardId: "b", place: "bottom" });
    deepEq(p1.deck, ["b", "a"], "card placed at the bottom");
    eq(Dominion.engine.zones.top(g, "p1", "deck"), "a", "top unchanged");
  });
  t("zones: total card count is conserved across a sequence of moves", () => {
    const g = freshGame();
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.deck = ["copper", "copper", "silver", "gold", "estate"];
    p1.hand = ["copper", "silver"];
    p2.deck = ["silver", "silver", "silver", "copper", "copper"];
    p2.hand = ["estate"];
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, curse: 10 };
    const total = () => [p1.deck, p1.hand, p1.discard, p1.play, p2.deck, p2.hand, p2.discard, p2.play, g.trash].reduce((s, a) => s + a.length, 0)
      + Object.values(g.supply).reduce((s, n) => s + n, 0);
    const before = total();
    Dominion.engine.zones.draw(g, "p1", 2);
    Dominion.engine.zones.move(g, Dominion.engine.loc("p1", "hand"), Dominion.engine.zoneRef.trash, { cardId: "copper" });
    Dominion.engine.zones.gain(g, "p1", "gold");
    Dominion.engine.zones.move(g, Dominion.engine.loc("p2", "deck"), Dominion.engine.loc("p2", "discard"), { fromTop: true });
    Dominion.engine.zones.move(g, Dominion.engine.loc("p2", "hand"), Dominion.engine.zoneRef.supply, { cardId: "estate" });
    eq(total(), before, "no card is created or destroyed");
    assert(g.log.length >= 5, "moves are logged");
  });
  t("zones: supply count helper", () => {
    const g = freshGame();
    g.supply = { copper: 60 };
    eq(Dominion.engine.zones.supplyCount(g, "copper"), 60, "supply count");
    eq(Dominion.engine.zones.count(g, Dominion.engine.zoneRef.supply, "copper"), 60, "count via ref");
    eq(Dominion.engine.zones.count(g, Dominion.engine.zoneRef.supply, "absent"), 0, "unknown pile is 0");
  });

  /* ══════════════════ Task 5: turn machine & resources ══════════ */
  function freshGame2p() {
    const g = Dominion.engine.createGame({ seed: 7 });
    g.players.push(Dominion.engine.createPlayer("p1", "Alice"));
    g.players.push(Dominion.engine.createPlayer("p2", "Bob"));
    return g;
  }

  t("turn: beginTurn sets resources and reaches the action phase", () => {
    const g = freshGame2p();
    Dominion.engine.beginTurn(g, "p1");
    eq(g.phase, "action", "begins in the action phase");
    eq(g.turnPlayer, "p1", "turn player set");
    eq(g.turn, 1, "turn counter incremented");
    const p1 = Dominion.engine.player(g, "p1");
    eq(p1.actions, 1, "one action");
    eq(p1.buys, 1, "one buy");
    eq(p1.coins, 0, "zero coins");
    eq(p1.potions, 0, "zero potions");
  });
  t("turn: apply draws cards and adds resources with exact math", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c", "d", "e"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { cards: 2, actions: 1, buys: 2, coins: 4, potions: 1 });
    deepEq(p1.hand, ["e", "d"], "+2 Cards drawn top-first");
    eq(p1.deck.length, 3, "deck reduced");
    eq(p1.actions, 2, "+1 Action on top of the base 1");
    eq(p1.buys, 3, "+2 Buys on top of the base 1");
    eq(p1.coins, 4, "+4 Coins");
    eq(p1.potions, 1, "+1 Potion");
  });
  t("turn: invalid effects, resources and counts are rejected", () => {
    const g = freshGame2p();
    Dominion.engine.beginTurn(g, "p1");
    let threwKey = false;
    try { Dominion.engine.apply(g, "p1", { bogus: 1 }); } catch (e) { threwKey = true; }
    assert(threwKey, "unknown effect key rejected");
    let threwNeg = false;
    try { Dominion.engine.apply(g, "p1", { coins: -1 }); } catch (e) { threwNeg = true; }
    assert(threwNeg, "negative effect rejected");
    let threwRes = false;
    try { Dominion.engine.addResource(g, "p1", "hitpoints", 5); } catch (e) { threwRes = true; }
    assert(threwRes, "unknown resource rejected");
  });
  t("turn: the one-action-per-turn limit is enforced", () => {
    const g = freshGame2p();
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.spendAction(g, "p1");
    eq(Dominion.engine.player(g, "p1").actions, 0, "the one action is spent");
    let threw = false;
    try { Dominion.engine.spendAction(g, "p1"); } catch (e) { threw = true; }
    assert(threw, "a second action without +Actions must throw");
  });
  t("turn: buys are spent and cannot go below zero", () => {
    const g = freshGame2p();
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.spendBuy(g, "p1");
    eq(Dominion.engine.player(g, "p1").buys, 0, "the one buy is spent");
    let threw = false;
    try { Dominion.engine.spendBuy(g, "p1"); } catch (e) { threw = true; }
    assert(threw, "spending a buy with none left throws");
  });
  t("turn: resources clamp at zero", () => {
    const g = freshGame2p();
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.addResource(g, "p1", "coins", -10);
    eq(Dominion.engine.player(g, "p1").coins, 0, "coins clamp at 0");
  });
  t("turn: full turn runs the phase order and hands over", () => {
    const g = freshGame2p();
    const seen = [];
    const off = Dominion.engine.hooks.on("enterPhase", (e) => seen.push(e.player + ":" + e.to));
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    p1.hand = ["copper", "copper", "copper", "copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    deepEq(seen, ["p1:start", "p1:action"], "start auto-advances into action");
    Dominion.engine.apply(g, "p1", { coins: 3 });
    Dominion.engine.advancePhase(g); // action → buy
    eq(g.phase, "buy", "in the buy phase");
    Dominion.engine.spendBuy(g, "p1");
    Dominion.engine.advancePhase(g); // buy → cleanup → draw → end → p2
    deepEq(seen, ["p1:start", "p1:action", "p1:buy", "p1:cleanup", "p1:draw", "p2:start", "p2:action"], "phase order observed");
    eq(g.turnPlayer, "p2", "next player's turn");
    eq(g.turn, 2, "second turn");
    deepEq(p1.hand, ["j", "i", "h", "g", "f"], "p1 drew a fresh 5-card hand");
    deepEq(p1.discard, ["copper", "copper", "copper", "copper", "copper"], "cleanup discarded the old hand");
    eq(p1.play.length, 0, "play area emptied");
    eq(Dominion.engine.player(g, "p2").actions, 1, "next player has an action");
    off();
  });
  t("turn: night phase is entered when night cards are present", () => {
    const g = freshGame2p();
    Dominion.cards.register({ id: "night_probe", name: "Night Probe", cost: { coins: 3, potion: 0 }, types: ["Night"], text: "test", expansion: "test" });
    Dominion.engine.player(g, "p1").hand = ["night_probe"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.advancePhase(g); // action → buy
    eq(g.phase, "buy", "reached buy");
    Dominion.engine.advancePhase(g); // buy → night (not skipped)
    eq(g.phase, "night", "night phase entered when a Night card is in hand");
    Dominion.engine.advancePhase(g); // night → cleanup → draw → p2
    eq(g.turnPlayer, "p2", "turn still ends normally");
  });
  t("turn: turnStart/turnEnd hooks fire in order", () => {
    const g = freshGame2p();
    const ev = [];
    const off = [
      Dominion.engine.hooks.on("turnStart", (e) => ev.push("start:" + e.player)),
      Dominion.engine.hooks.on("turnEnd", (e) => ev.push("end:" + e.player))
    ];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.advancePhase(g); // action → buy
    Dominion.engine.advancePhase(g); // → cleanup → draw → end → begin p2
    deepEq(ev, ["start:p1", "end:p1", "start:p2"], "lifecycle hooks fire in order");
    off.forEach((f) => f());
  });
  t("turn: resources reset at the start of each new turn", () => {
    const g = freshGame2p();
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 5, actions: 3 });
    Dominion.engine.advancePhase(g); // p1 action → buy
    Dominion.engine.advancePhase(g); // p1 full cycle → p2
    Dominion.engine.advancePhase(g); // p2 action → buy
    Dominion.engine.advancePhase(g); // p2 full cycle → back to p1
    const p1 = Dominion.engine.player(g, "p1");
    eq(p1.actions, 1, "actions reset to 1");
    eq(p1.buys, 1, "buys reset to 1");
    eq(p1.coins, 0, "coins zeroed");
    eq(p1.potions, 0, "potions zeroed");
  });

  /* ══════════════════ Task 6: treasure play & coin totals ═══════ */
  t("treasure: auto-play adds exact coin totals from mixed Treasures", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "silver", "gold", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    const res = Dominion.engine.treasures.playAll(g, "p1");
    eq(res.coins, 1 + 2 + 3 + 1, "coins equal 1+2+3+1");
    eq(p1.coins, 7, "player coins updated");
    eq(p1.hand.length, 0, "all treasures left the hand");
    eq(p1.play.length, 4, "all treasures sit in the play area");
  });
  t("treasure: auto-play skips non-Treasures", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "estate", "silver"];
    Dominion.engine.beginTurn(g, "p1");
    const res = Dominion.engine.treasures.playAll(g, "p1");
    eq(res.coins, 3, "only copper + silver counted");
    deepEq(p1.hand, ["estate"], "estate stays in hand");
  });
  t("treasure: specific cards can be played", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "silver", "silver", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    const res = Dominion.engine.treasures.play(g, "p1", { cardIds: ["silver", "silver"] });
    eq(res.coins, 4, "two silvers = 4 coins");
    deepEq(p1.hand, ["copper", "gold"], "other treasures remain in hand");
  });
  t("treasure: playing a non-Treasure or a missing card is rejected", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    let threwType = false;
    try { Dominion.engine.treasures.play(g, "p1", { cardIds: ["estate"] }); } catch (e) { threwType = true; }
    assert(threwType, "non-Treasure play must throw");
    let threwMissing = false;
    try { Dominion.engine.treasures.play(g, "p1", { cardIds: ["gold"] }); } catch (e) { threwMissing = true; }
    assert(threwMissing, "card not in hand must throw");
  });
  t("treasure: coin totals stack with effect coins", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["gold", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 2 });
    Dominion.engine.treasures.playAll(g, "p1");
    eq(p1.coins, 2 + 6, "effects + treasures combine");
  });
  t("treasure: the treasuresPlayed hook fires with cards and coins", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "silver"];
    let seen = null;
    const off = Dominion.engine.hooks.on("treasuresPlayed", (e) => { seen = e; });
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.treasures.playAll(g, "p1");
    assert(seen, "hook fired");
    eq(seen.player, "p1", "player in payload");
    eq(seen.coins, 3, "coins in payload");
    deepEq(seen.cards, ["copper", "silver"], "cards in payload");
    off();
  });
  t("treasure: treasureValue reads the catalog value", () => {
    eq(Dominion.engine.treasures.value("copper"), 1, "copper = 1");
    eq(Dominion.engine.treasures.value("gold"), 3, "gold = 3");
    eq(Dominion.engine.treasures.value("estate"), null, "non-Treasure has no value");
  });

  /* ══════════════════ Task 7: action play & effect resolution ═══ */
  t("action: the base kingdom Actions (Village, Smithy) are in the catalog", async () => {
    await Dominion.cards.init(["base", "base-kingdom"]);
    const village = Dominion.cards.get("village");
    assert(village, "village registered");
    assert(village.types.includes("Action"), "village is an Action");
    eq(village.cost.coins, 3, "village cost $3");
    eq(village.text, "+1 Card; +2 Actions.", "village official text");
    const smithy = Dominion.cards.get("smithy");
    assert(smithy, "smithy registered");
    assert(smithy.types.includes("Action"), "smithy is an Action");
    eq(smithy.cost.coins, 4, "smithy cost $4");
    eq(smithy.text, "+3 Cards.", "smithy official text");
    eq(Dominion.cards.count(), 33, "8 base + 25 kingdom");
  });
  t("action: village pipeline (legality, move, effect)", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["village", "copper", "copper"];
    p1.deck = ["a", "b", "c"];
    let playedEvent = null;
    const offHook = Dominion.engine.hooks.on("actionPlayed", (e) => { playedEvent = e; });
    Dominion.engine.beginTurn(g, "p1");
    const res = Dominion.engine.actions.play(g, "p1", { cardId: "village" });
    eq(res.cardId, "village", "returned the played card");
    eq(res.effect, true, "effect resolved");
    deepEq(p1.hand, ["copper", "copper", "c"], "drew the +1 Card after village left the hand");
    eq(p1.actions, 2, "spend 1, +2 Actions → 2");
    deepEq(p1.play, ["village"], "village moved to the play area");
    assert(playedEvent && playedEvent.player === "p1" && playedEvent.cardId === "village", "actionPlayed hook fires");
    assert(g.log.some((e) => e.t === "playAction" && e.card === "village"), "play logged");
    offHook();
  });
  t("action: smithy draws exactly +3 Cards", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["smithy"];
    p1.deck = ["a", "b", "c", "d", "e"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "smithy" });
    deepEq(p1.hand, ["e", "d", "c"], "hand holds exactly the 3 draws");
    eq(p1.actions, 0, "the one action is spent");
    deepEq(p1.play, ["smithy"], "smithy in the play area");
  });
  t("action: play by hand index", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "village", "copper"];
    p1.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { index: 1 });
    deepEq(p1.play, ["village"], "index 1 played");
    eq(p1.actions, 2, "village effect applied");
  });
  t("action: illegal plays are rejected", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["village", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    let threwNoAction = false;
    try {
      Dominion.engine.spendAction(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "village" });
    } catch (e) { threwNoAction = true; }
    assert(threwNoAction, "playing with no actions left must throw");
    let threwType = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "estate" }); } catch (e) { threwType = true; }
    assert(threwType, "non-Action play must throw");
    let threwMissing = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "gold" }); } catch (e) { threwMissing = true; }
    assert(threwMissing, "card not in hand must throw");
  });
  t("action: cleanup sends played Actions to the discard", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["village", "copper", "copper", "copper", "copper"];
    p1.deck = ["a", "b", "c", "d", "e", "f"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "village" });
    Dominion.engine.advancePhase(g); // action → buy
    eq(g.phase, "buy", "in the buy phase");
    Dominion.engine.advancePhase(g); // buy → cleanup → draw → p2
    assert(p1.discard.includes("village"), "village discarded at cleanup");
    eq(p1.play.length, 0, "play area emptied");
  });
  t("action: effects registry resolves per-card handlers", () => {
    assert(Dominion.engine.effects.has("village") && Dominion.engine.effects.has("smithy"), "built-in effects registered");
    eq(Dominion.engine.effects.has("gold"), false, "non-Action has no effect handler");
    const g = freshGame2p();
    const seen = [];
    Dominion.engine.effects.register("probe_action", (state, pid, ctx) => { seen.push(pid, ctx.cardId, ctx.index); return "ok"; });
    const out = Dominion.engine.effects.resolve(g, "p1", "probe_action", { cardId: "probe_action", index: 3 });
    eq(out, "ok", "handler return value passes through");
    deepEq(seen, ["p1", "probe_action", 3], "handler receives state, player and context");
    eq(Dominion.engine.effects.resolve(g, "p1", "no_such_card"), null, "unregistered card resolves to null");
  });

  /* ══════════════════ Task 8: the buy step ══════════════════════ */
  function supplyGame() {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, province: 8, curse: 10 };
    return g;
  }

  t("buy: a 0-cost card is gained to discard for nothing", () => {
    const g = supplyGame();
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.beginTurn(g, "p1");
    const res = Dominion.engine.buy(g, "p1", "copper");
    deepEq(res.cost, { coins: 0, potion: 0 }, "copper costs 0");
    deepEq(p1.discard, ["copper"], "gained to discard");
    eq(g.supply.copper, 59, "supply decremented");
    eq(p1.coins, 0, "no coins deducted");
    eq(p1.buys, 0, "one buy spent");
  });
  t("buy: affordability math is exact", () => {
    const g = supplyGame();
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 5 });
    Dominion.engine.buy(g, "p1", "silver");
    eq(p1.coins, 2, "5 − 3 = 2 coins left");
    deepEq(p1.discard, ["silver"], "silver gained");
    eq(g.supply.silver, 39, "silver pile decremented");
    let threw = false;
    try { Dominion.engine.buy(g, "p1", "gold"); } catch (e) { threw = true; }
    assert(threw, "gold (cost 6) is unaffordable with 2 coins");
  });
  t("buy: potion costs are honored", () => {
    const g = freshGame2p();
    g.supply = { potion_probe: 5 };
    Dominion.cards.register({ id: "potion_probe", name: "Potion Probe", cost: { coins: 3, potion: 1 }, types: ["Action"], text: "test", expansion: "test" });
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 3 });
    let threw = false;
    try { Dominion.engine.buy(g, "p1", "potion_probe"); } catch (e) { threw = true; }
    assert(threw, "potions are required for a potion cost");
    Dominion.engine.apply(g, "p1", { potions: 1 });
    Dominion.engine.buy(g, "p1", "potion_probe");
    eq(p1.coins, 0, "coins paid");
    eq(p1.potions, 0, "potion paid");
    deepEq(p1.discard, ["potion_probe"], "card gained");
  });
  t("buy: empty and absent piles are un-buyable", () => {
    const g = freshGame2p();
    g.supply = { gold: 0 };
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 9 });
    let threwEmpty = false;
    try { Dominion.engine.buy(g, "p1", "gold"); } catch (e) { threwEmpty = true; }
    assert(threwEmpty, "an empty pile cannot be bought from");
    let threwAbsent = false;
    try { Dominion.engine.buy(g, "p1", "province"); } catch (e) { threwAbsent = true; }
    assert(threwAbsent, "a pile absent from the supply cannot be bought");
  });
  t("buy: the buy-count limit is enforced", () => {
    const g = supplyGame();
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 9, buys: 2 });
    Dominion.engine.buy(g, "p1", "silver");
    Dominion.engine.buy(g, "p1", "silver");
    Dominion.engine.buy(g, "p1", "silver");
    eq(p1.buys, 0, "all buys spent");
    let threw = false;
    try { Dominion.engine.buy(g, "p1", "silver"); } catch (e) { threw = true; }
    assert(threw, "a fourth buy with none left must throw");
    eq(g.supply.silver, 37, "only 3 silvers gained");
  });
  t("buy: a failed buy spends nothing (atomic transaction)", () => {
    const g = supplyGame();
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 5 });
    const before = { coins: p1.coins, buys: p1.buys, silver: g.supply.silver, discard: p1.discard.length };
    let threw = false;
    try { Dominion.engine.buy(g, "p1", "gold"); } catch (e) { threw = true; }
    assert(threw, "unaffordable purchase rejected");
    eq(p1.coins, before.coins, "coins untouched");
    eq(p1.buys, before.buys, "buy not spent");
    eq(g.supply.silver, before.silver, "supply untouched");
    eq(p1.discard.length, before.discard, "nothing gained");
  });
  t("buy: treasure-to-purchase pipeline works end to end", () => {
    const g = supplyGame();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "silver"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.treasures.playAll(g, "p1");
    eq(p1.coins, 3, "1 + 2 = 3 coins from treasures");
    let bought = null;
    const off = Dominion.engine.hooks.on("bought", (e) => { bought = e; });
    Dominion.engine.buy(g, "p1", "silver");
    eq(p1.coins, 0, "3 − 3 = 0 coins after purchase");
    eq(p1.buys, 0, "buy spent");
    deepEq(p1.discard, ["silver"], "purchase gained to discard");
    assert(bought && bought.player === "p1" && bought.cardId === "silver" && bought.cost.coins === 3, "bought hook fires");
    off();
  });
  t("buy: canBuy predicate covers every un-buyable case", () => {
    const g = supplyGame();
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 3 });
    eq(Dominion.engine.canBuy(g, "p1", "silver"), true, "affordable, in-stock");
    eq(Dominion.engine.canBuy(g, "p1", "gold"), false, "unaffordable");
    eq(Dominion.engine.canBuy(g, "p1", "not_a_card"), false, "unknown card");
    eq(Dominion.engine.canBuy(g, "p1", "province"), false, "pile absent from supply");
    g.supply.silver = 0;
    eq(Dominion.engine.canBuy(g, "p1", "silver"), false, "empty pile");
    g.supply.silver = 40;
    Dominion.engine.spendBuy(g, "p1");
    eq(Dominion.engine.canBuy(g, "p1", "silver"), false, "no buys left");
  });

  /* ══════════════════ Task 9: the attack framework ══════════════ */
  function freshGame3p() {
    const g = Dominion.engine.createGame({ seed: 7 });
    g.players.push(Dominion.engine.createPlayer("p1", "Alice"));
    g.players.push(Dominion.engine.createPlayer("p2", "Bob"));
    g.players.push(Dominion.engine.createPlayer("p3", "Carol"));
    return g;
  }

  t("attack: Witch, Militia and Moat are in the catalog with official stats", async () => {
    await Dominion.cards.init(["base", "base-kingdom"]);
    const witch = Dominion.cards.get("witch");
    assert(witch && witch.types.includes("Attack"), "Witch is an Attack");
    eq(witch.cost.coins, 5, "Witch $5");
    eq(witch.text, "+2 Cards; each other player gains a Curse.", "Witch official text");
    const militia = Dominion.cards.get("militia");
    assert(militia && militia.types.includes("Attack"), "Militia is an Attack");
    eq(militia.cost.coins, 4, "Militia $4");
    const moat = Dominion.cards.get("moat");
    assert(moat && moat.types.includes("Reaction"), "Moat is a Reaction");
    eq(moat.cost.coins, 2, "Moat $2");
  });
  t("attack: Witch hits each other player exactly once", () => {
    const g = freshGame3p();
    g.supply = { curse: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["witch"];
    p1.deck = ["a", "b", "c", "d", "e"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    eq(p1.hand.length, 2, "Witch: +2 Cards for the attacker");
    deepEq(p1.discard, [], "attacker gains no Curse");
    deepEq(Dominion.engine.player(g, "p2").discard, ["curse"], "p2 gains a Curse");
    deepEq(Dominion.engine.player(g, "p3").discard, ["curse"], "p3 gains a Curse");
    eq(g.supply.curse, 8, "two Curses left the pile");
  });
  t("attack: Moat blocks the attack and returns to hand", () => {
    const g = freshGame2p();
    g.supply = { curse: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["witch"];
    p1.deck = ["a", "b"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["moat", "copper", "copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "react" ? ["moat"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    deepEq(p2.discard, [], "p2 unaffected");
    eq(p2.hand.length, 4, "Moat returned to hand after revealing");
    eq(p2.hand.filter((c) => c === "moat").length, 1, "the revealed Moat is back in hand");
    assert(g.log.some((e) => e.t === "reveal" && e.player === "p2" && e.card === "moat"), "reveal logged");
    eq(g.supply.curse, 10, "no Curse gained");
  });
  t("attack: Militia forces a discard down to 3 cards", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["militia"];
    p1.deck = [];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["copper", "copper", "copper", "copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardDown" ? [0, 1] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "militia" });
    eq(p1.coins, 2, "Militia: +2 Coins");
    eq(p2.hand.length, 3, "p2 left with 3 cards");
    eq(p2.discard.length, 2, "two cards discarded");
  });
  t("attack: Moat leaves the defender's hand intact against Militia", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["militia"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["moat", "gold", "gold", "gold", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "react" ? ["moat"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "militia" });
    eq(p1.coins, 2, "attacker still gets +2 Coins");
    eq(p2.hand.length, 5, "defender keeps all 5 cards");
    eq(p2.hand.filter((c) => c === "moat").length, 1, "Moat is back in hand");
    deepEq(p2.discard, [], "nothing discarded");
  });
  t("attack: the attacker is never affected by their own attack", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["militia", "copper", "copper", "copper", "copper"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["copper", "copper", "copper", "copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardDown" ? [0, 1] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "militia" });
    eq(p1.hand.length, 4, "attacker's hand untouched by their own attack");
    eq(p2.hand.length, 3, "defender discarded down to 3");
  });
  t("attack: the reaction window resolves before the attack lands", () => {
    const g = freshGame3p();
    g.supply = { curse: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["witch"];
    p1.deck = ["a", "b"];
    Dominion.engine.player(g, "p2").hand = ["moat", "copper"];
    Dominion.engine.player(g, "p3").hand = ["copper"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "react" ? ["moat"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    const revealIdx = g.log.findIndex((e) => e.t === "reveal");
    const gainIdx = g.log.findIndex((e) => e.t === "move" && e.card === "curse");
    assert(revealIdx !== -1 && gainIdx !== -1, "both the reveal and the gain are logged");
    assert(revealIdx < gainIdx, "p2's Moat reveal precedes p3's Curse gain");
    deepEq(Dominion.engine.player(g, "p2").discard, [], "p2 unaffected");
    deepEq(Dominion.engine.player(g, "p3").discard, ["curse"], "p3 still gains");
  });
  t("attack: the default decide reveals blocking reactions", () => {
    const g = freshGame2p();
    g.supply = { curse: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["witch"];
    p1.deck = ["a", "b"];
    Dominion.engine.player(g, "p2").hand = ["moat", "copper", "copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    deepEq(Dominion.engine.player(g, "p2").discard, [], "default bot reveals Moat → unaffected");
  });
  t("attack: the default decide discards highest-cost cards first", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["militia"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["curse", "gold", "silver", "copper", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "militia" });
    deepEq(p2.hand, ["curse", "copper", "estate"], "gold + silver discarded (costs 6, 3)");
    deepEq(p2.discard, ["silver", "gold"], "discarded in reverse-index order");
  });
  t("attack: Militia does not touch hands of 3 cards or fewer", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["militia"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["gold", "gold", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "militia" });
    deepEq(p2.hand, ["gold", "gold", "gold"], "3-card hand untouched");
    deepEq(p2.discard, [], "nothing discarded");
  });
  t("attack: Witch with an empty Curse pile causes no crash and no gain", () => {
    const g = freshGame2p();
    g.supply = { curse: 0 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["witch"];
    p1.deck = ["a", "b"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    eq(p1.hand.length, 2, "attacker still draws +2 Cards");
    deepEq(Dominion.engine.player(g, "p2").discard, [], "no Curse gained from an empty pile");
  });

  /* ══════════════════ Task 10: endgame & scoring ═══════════════ */
  t("endgame: the dynamic VP cards are in the catalog", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    for (const id of ["gardens", "duke", "vineyard", "fairgrounds"]) assert(Dominion.cards.get(id), id + " registered");
    eq(Dominion.cards.count(), 90, "8 base + 25 base-kingdom + 26 intrigue + 12 alchemy + 18 cornucopia (13 kingdom + 5 prizes) + 1 hinterlands");
  });
  t("endgame: three empty piles end the game", () => {
    const g = freshGame2p();
    g.supply = { province: 2, copper: 0, silver: 0, gold: 0, estate: 5 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["a", "b", "c", "d", "e"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.endTurn(g);
    eq(g.over, true, "game over after the turn ends");
    eq(g.turnPlayer, "p1", "no next turn began");
    eq(Dominion.engine.isGameOver(g), true, "isGameOver agrees");
  });
  t("endgame: an empty Province pile ends the game", () => {
    const g = freshGame2p();
    g.supply = { province: 0, estate: 8, copper: 20 };
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.endTurn(g);
    eq(g.over, true, "game over");
  });
  t("endgame: fewer than three empty piles with Province stocked does not end", () => {
    const g = freshGame2p();
    g.supply = { province: 2, copper: 0, silver: 0, estate: 5 };
    Dominion.engine.beginTurn(g, "p1");
    eq(Dominion.engine.isGameOver(g), false, "two empty piles is not enough");
    Dominion.engine.endTurn(g);
    eq(g.over, false, "turn handed over normally");
    eq(g.turnPlayer, "p2", "next player's turn began");
  });
  t("endgame: piles emptying mid-turn do not end the game early", () => {
    const g = freshGame2p();
    g.supply = { province: 2, copper: 1, silver: 1, gold: 1, estate: 8 };
    const p1 = Dominion.engine.player(g, "p1");
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 9, buys: 2 });
    Dominion.engine.buy(g, "p1", "copper");
    Dominion.engine.buy(g, "p1", "silver");
    Dominion.engine.buy(g, "p1", "gold");
    eq(Dominion.engine.emptyPileCount(g), 3, "three piles are now empty");
    eq(g.over, false, "state not marked over while the turn is still going");
    let overEvent = null;
    const off = Dominion.engine.hooks.on("gameOver", (e) => { overEvent = e; });
    Dominion.engine.endTurn(g);
    eq(g.over, true, "game ends when the turn finishes");
    assert(overEvent && overEvent.turn === 1, "gameOver hook fired with the turn number");
    off();
  });
  t("endgame: a fixture game scores exactly", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["estate", "estate", "copper", "copper"];
    p1.hand = ["gardens", "village", "silver"];
    p1.discard = ["province", "curse", "curse", "silver", "silver"];
    p1.play = ["duchy", "duke", "village"];
    p1.setAside = ["fairgrounds", "vineyard", "village", "silver", "silver"];
    p1.vpTokens = 5;
    const b = Dominion.engine.score(g, "p1");
    eq(b.cardCount, 20, "20 cards owned across all zones");
    eq(b.estate, 2, "2 Estates");
    eq(b.duchy, 3, "1 Duchy");
    eq(b.province, 6, "1 Province");
    eq(b.curse, -2, "2 Curses");
    eq(b.gardens, 2, "Gardens: 20 cards → 2 VP");
    eq(b.duke, 1, "Duke: 1 Duchy → 1 VP");
    eq(b.vineyard, 1, "Vineyard: 3 Action cards → 1 VP");
    eq(b.fairgrounds, 4, "Fairgrounds: 11 different cards → 2×2 VP (per-5, official 1E)");
    eq(b.tokens, 5, "5 VP tokens");
    eq(b.total, 22, "9 static + 2 + 1 + 1 + 4 + 5 = 22");
  });
  t("endgame: Gardens scales exactly at 9/10/19/20 cards", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    const cases = [[9, 0], [10, 1], [19, 1], [20, 2]];
    for (const [n, expected] of cases) {
      const cards = ["gardens"];
      while (cards.length < n) cards.push("copper");
      p1.deck = cards; p1.hand = []; p1.discard = []; p1.play = []; p1.setAside = []; p1.exile = [];
      const gv = Dominion.engine.score(g, "p1").gardens || 0;
      eq(gv, expected, "Gardens at " + n + " cards = " + expected);
    }
  });
  t("endgame: VP tokens score with an empty deck", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.vpTokens = 3;
    const b = Dominion.engine.score(g, "p1");
    eq(b.cardCount, 0, "no cards");
    eq(b.total, 3, "tokens only");
  });
  t("endgame: the highest-scoring player wins", () => {
    const g = freshGame2p();
    Dominion.engine.player(g, "p1").deck = ["estate", "estate"];
    Dominion.engine.player(g, "p2").deck = ["estate", "estate", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    let res = null;
    const off = Dominion.engine.hooks.on("gameOver", (e) => { res = e; });
    Dominion.engine.endGame(g);
    assert(res, "gameOver hook fired");
    deepEq(res.winners, ["p2"], "p2 wins with 3 VP over 2");
    eq(res.scores[0].total, 2, "p1 scored 2");
    eq(res.scores[1].total, 3, "p2 scored 3");
    off();
  });
  t("endgame: tied scores share the win", () => {
    const g = freshGame2p();
    Dominion.engine.player(g, "p1").deck = ["estate", "estate"];
    Dominion.engine.player(g, "p2").deck = ["estate", "estate"];
    const res = Dominion.engine.endGame(g);
    deepEq(res.winners.sort(), ["p1", "p2"], "both players win on a tie");
  });

  /* ══════════════════ Task 11: supply setup ═════════════════════ */
  t("setup: the base set provides a kingdom and setup picks exactly 10", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const king = Dominion.cards.byExpansion("base").filter((c) => c.inSupply && Dominion.engine.BASIC_PILES.indexOf(c.id) === -1);
    assert(king.length >= 10, "at least 10 base 2E kingdom cards");
    const g = Dominion.engine.setup({ players: 2, seed: 42 });
    eq(g.kingdom.length, 10, "setup selects exactly 10 kingdom piles");
    eq(new Set(g.kingdom).size, 10, "kingdom piles are unique");
    for (const id of g.kingdom) assert(king.some((c) => c.id === id), id + " is a base kingdom card");
  });
  t("setup: 2-player supply counts and starting decks", () => {
    const g = Dominion.engine.setup({ players: 2, seed: 42 });
    eq(g.players.length, 2, "two players");
    eq(g.supply.copper, 60, "Copper 60");
    eq(g.supply.silver, 40, "Silver 40");
    eq(g.supply.gold, 30, "Gold 30");
    eq(g.supply.estate, 8, "Estate 8 at 2p");
    eq(g.supply.duchy, 8, "Duchy 8 at 2p");
    eq(g.supply.province, 8, "Province 8 at 2p");
    eq(g.supply.curse, 8, "Curse 8 at 2p");
    eq(g.kingdom.length, 10, "10 kingdom piles");
    for (const id of g.kingdom) eq(g.supply[id], 10, id + " pile of 10");
    for (const p of g.players) {
      eq(p.hand.length, 5, "5-card opening hand dealt");
      const all = p.deck.concat(p.hand);
      eq(all.length, 10, "10 starting cards");
      eq(all.filter((c) => c === "copper").length, 7, "7 Copper");
      eq(all.filter((c) => c === "estate").length, 3, "3 Estate");
    }
  });
  t("setup: counts at 2, 3 and 4 players", () => {
    for (const n of [2, 3, 4]) {
      const g = Dominion.engine.setup({ players: n, seed: 100 + n });
      eq(g.players.length, n, n + " players");
      eq(g.supply.copper, 60, "copper 60 at " + n + "p");
      eq(g.supply.silver, 40, "silver 40 at " + n + "p");
      eq(g.supply.gold, 30, "gold 30 at " + n + "p");
      const vic = n === 2 ? 8 : 12;
      eq(g.supply.estate, vic, "estate " + vic + " at " + n + "p");
      eq(g.supply.duchy, vic, "duchy " + vic + " at " + n + "p");
      eq(g.supply.province, vic, "province " + vic + " at " + n + "p");
      eq(g.supply.curse, vic, "curse " + vic + " at " + n + "p");
      for (const id of g.kingdom) eq(g.supply[id], 10, id + " pile 10 at " + n + "p");
      for (const p of g.players) {
        const all = p.deck.concat(p.hand);
        eq(all.filter((c) => c === "copper").length, 7, "7 Copper each at " + n + "p");
        eq(all.filter((c) => c === "estate").length, 3, "3 Estate each at " + n + "p");
      }
    }
  });
  t("setup: custom players and a custom kingdom are honored", () => {
    const g = Dominion.engine.setup({ players: [{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }], kingdom: ["village", "smithy"], seed: 5 });
    deepEq(g.players.map((p) => p.id), ["alice", "bob"], "custom ids");
    deepEq(g.kingdom, ["village", "smithy"], "custom kingdom");
    eq(g.supply.village, 10, "village pile");
    eq(g.supply.smithy, 10, "smithy pile");
    eq(g.supply.copper, 60, "basic piles still set up");
  });
  t("setup: invalid player counts and kingdoms are rejected", () => {
    let threw0 = false;
    try { Dominion.engine.setup({ players: 0 }); } catch (e) { threw0 = true; }
    assert(threw0, "0 players rejected");
    let threw9 = false;
    try { Dominion.engine.setup({ players: 9 }); } catch (e) { threw9 = true; }
    assert(threw9, "9 players rejected");
    let threwUnknown = false;
    try { Dominion.engine.setup({ players: 2, kingdom: ["not_a_card"] }); } catch (e) { threwUnknown = true; }
    assert(threwUnknown, "unknown kingdom card rejected");
    let threwDup = false;
    try { Dominion.engine.setup({ players: 2, kingdom: ["village", "village"] }); } catch (e) { threwDup = true; }
    assert(threwDup, "duplicate kingdom card rejected");
  });
  t("setup: identical seeds produce identical setups", () => {
    const a = Dominion.engine.setup({ players: 2, seed: 7 });
    const b = Dominion.engine.setup({ players: 2, seed: 7 });
    deepEq(a.players[0].deck, b.players[0].deck, "same seeded deck");
    deepEq(a.players[0].hand, b.players[0].hand, "same seeded opening hand");
    const c = Dominion.engine.setup({ players: 2, seed: 9 });
    assert(JSON.stringify(a.players[0].hand.concat(a.players[0].deck)) !== JSON.stringify(c.players[0].hand.concat(c.players[0].deck)), "different seeds differ");
  });
  t("setup: a full turn plays on a set-up game", () => {
    const g = Dominion.engine.setup({ players: 2, seed: 3 });
    Dominion.engine.beginTurn(g, "p1");
    eq(g.phase, "action", "action phase reached");
    Dominion.engine.advancePhase(g);
    eq(g.phase, "buy", "buy phase reached");
    if (Dominion.engine.canBuy(g, "p1", "copper")) Dominion.engine.buy(g, "p1", "copper");
    Dominion.engine.advancePhase(g);
    eq(g.turnPlayer, "p2", "turn handed over");
    eq(Dominion.engine.player(g, "p1").hand.length, 5, "p1 drew a fresh hand");
    eq(g.over, false, "game not over after one turn");
  });
  t("setup: Cellar discards any number, then draws that many", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["cellar", "copper", "estate", "copper", "curse"];
    p1.deck = ["a", "b", "c", "d", "e"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardAny" ? [1, 3] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "cellar" });
    eq(p1.actions, 1, "spend 1, +1 Action → 1");
    deepEq(p1.hand, ["copper", "copper", "e", "d"], "discarded estate + curse, drew 2");
    deepEq(p1.discard, ["curse", "estate"], "discarded cards land in the discard");
  });

  /* ══════════════ Task 12: primitives & trigger registry ═══════ */
  function probeSetup() {
    const defs = [
      { id: "gain_bonus", name: "Gain Bonus", cost: { coins: 3, potion: 0 }, types: ["Action"], text: "When you gain this, gain a Silver.", expansion: "test" },
      { id: "super_bonus", name: "Super Bonus", cost: { coins: 6, potion: 0 }, types: ["Action"], text: "When you gain this, gain a Gain Bonus.", expansion: "test" },
      { id: "trash_probe", name: "Trash Probe", cost: { coins: 2, potion: 0 }, types: ["Action"], text: "When you trash this, +2 Coins.", expansion: "test" },
      { id: "buy_probe", name: "Buy Probe", cost: { coins: 3, potion: 0 }, types: ["Action"], text: "When you buy this, +1 Action.", expansion: "test" },
      { id: "play_probe", name: "Play Probe", cost: { coins: 2, potion: 0 }, types: ["Action"], text: "When you play this, +1 Coin.", expansion: "test" },
      { id: "start_probe", name: "Start Probe", cost: { coins: 1, potion: 0 }, types: ["Action"], text: "At the start of your turn, +1 Coin.", expansion: "test" }
    ];
    for (const d of defs) if (!Dominion.cards.has(d.id)) Dominion.cards.register(d);
    Dominion.engine.triggers.register("gain_bonus", { onGain: (s, pid) => Dominion.engine.primitives.gain(s, pid, "silver") });
    Dominion.engine.triggers.register("super_bonus", { onGain: (s, pid) => Dominion.engine.primitives.gain(s, pid, "gain_bonus") });
    Dominion.engine.triggers.register("trash_probe", { onTrash: (s, pid) => Dominion.engine.addResource(s, pid, "coins", 2) });
    Dominion.engine.triggers.register("buy_probe", { onBuy: (s, pid) => Dominion.engine.addResource(s, pid, "actions", 1) });
    Dominion.engine.triggers.register("play_probe", { onPlay: (s, pid) => Dominion.engine.addResource(s, pid, "coins", 1) });
    Dominion.engine.triggers.register("start_probe", { onTurnStart: (s, pid) => Dominion.engine.addResource(s, pid, "coins", 1) });
  }

  t("triggers: gaining a card fires its when-gained handler", () => {
    probeSetup();
    const g = freshGame2p();
    g.supply = { silver: 5, gain_bonus: 2 };
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.primitives.gain(g, "p1", "gain_bonus");
    const moves = g.log.filter((e) => e.t === "move").map((e) => e.card);
    deepEq(moves, ["gain_bonus", "silver"], "the bonus Silver is gained immediately after");
    deepEq(Dominion.engine.player(g, "p1").discard, ["gain_bonus", "silver"], "both land in discard");
    eq(g.supply.silver, 4, "supply decremented");
  });
  t("triggers: a gain-with-bonus chain resolves depth-first", () => {
    probeSetup();
    const g = freshGame2p();
    g.supply = { silver: 5, gain_bonus: 2, super_bonus: 1 };
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.primitives.gain(g, "p1", "super_bonus");
    const moves = g.log.filter((e) => e.t === "move").map((e) => e.card);
    deepEq(moves, ["super_bonus", "gain_bonus", "silver"], "super → gain_bonus → silver, in that order");
    deepEq(Dominion.engine.player(g, "p1").discard, ["super_bonus", "gain_bonus", "silver"], "full chain gained");
  });
  t("triggers: an owned when-gained card does not re-trigger", () => {
    probeSetup();
    const g = freshGame2p();
    g.supply = { silver: 5, copper: 20 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.discard = ["gain_bonus"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.primitives.gain(g, "p1", "copper");
    const moves = g.log.filter((e) => e.t === "move").map((e) => e.card);
    deepEq(moves, ["copper"], "gaining a plain card gains nothing extra");
    deepEq(p1.discard, ["gain_bonus", "copper"], "no bonus Silver appeared");
  });
  t("primitives: trash moves to the trash and fires when-trashed", () => {
    probeSetup();
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["trash_probe", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.primitives.trash(g, "p1", { cardId: "trash_probe" });
    deepEq(g.trash, ["trash_probe"], "card is in the trash");
    eq(p1.coins, 2, "when-trashed bonus resolved");
    deepEq(p1.hand, ["copper"], "only the trashed card left the hand");
  });
  t("primitives: reveal logs and leaves the cards in place", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["gold", "estate"];
    const shown = Dominion.engine.primitives.reveal(g, "p1", ["gold"]);
    deepEq(shown, ["gold"], "revealed list returned");
    deepEq(p1.hand, ["gold", "estate"], "hand untouched by revealing");
    assert(g.log.some((e) => e.t === "reveal" && e.card === "gold"), "reveal logged");
    let threw = false;
    try { Dominion.engine.primitives.reveal(g, "p1", ["silver"]); } catch (e) { threw = true; }
    assert(threw, "revealing an unowned card must throw");
  });
  t("primitives: topdeck moves a hand card to the top of the deck", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["gold"];
    p1.deck = ["a"];
    Dominion.engine.primitives.topdeck(g, "p1", "gold");
    deepEq(p1.deck, ["a", "gold"], "gold on top (end) of the deck");
    deepEq(p1.hand, [], "hand emptied");
  });
  t("primitives: discard moves the chosen hand indices to the discard", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["copper", "estate", "gold"];
    const discarded = Dominion.engine.primitives.discard(g, "p1", [0, 2]);
    deepEq(discarded, ["gold", "copper"], "discarded in reverse-index order");
    deepEq(p1.discard, ["gold", "copper"], "discard pile holds them");
    deepEq(p1.hand, ["estate"], "the kept card stays");
  });
  t("primitives: playAnother plays an Action without spending one", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["village", "copper", "copper"];
    p1.deck = ["a", "b", "c"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.primitives.playAnother(g, "p1", { cardId: "village" });
    eq(p1.actions, 3, "no action spent, +2 Actions → 3");
    deepEq(p1.hand, ["copper", "copper", "c"], "+1 Card drawn");
    deepEq(p1.play, ["village"], "village sits in the play area");
  });
  t("triggers: when-bought fires on purchase", () => {
    probeSetup();
    const g = freshGame2p();
    g.supply = { buy_probe: 5 };
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.apply(g, "p1", { coins: 3 });
    Dominion.engine.buy(g, "p1", "buy_probe");
    eq(Dominion.engine.player(g, "p1").actions, 2, "when-bought +1 Action on top of the base 1");
  });
  t("triggers: when-played fires when an Action is played", () => {
    probeSetup();
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["play_probe"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "play_probe" });
    eq(p1.coins, 1, "when-played +1 Coin resolved");
    eq(p1.actions, 0, "the one action was spent");
    deepEq(p1.play, ["play_probe"], "card in the play area");
  });
  t("triggers: start-of-turn triggers fire for owned cards", () => {
    probeSetup();
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["start_probe"];
    Dominion.engine.beginTurn(g, "p1");
    eq(p1.coins, 1, "start-of-turn +1 Coin resolved");
  });
  t("primitives: choose wraps decide and validates against options", () => {
    const g = freshGame2p();
    g.decide = (s, prompt) => (prompt.type === "probe" ? "b" : null);
    eq(Dominion.engine.primitives.choose(g, "p1", { type: "probe" }, ["a", "b", "c"]), "b", "valid option passes through");
    g.decide = (s, prompt) => "zzz";
    eq(Dominion.engine.primitives.choose(g, "p1", { type: "probe" }, ["a", "b", "c"]), null, "choice outside the options is rejected");
    g.decide = (s, prompt) => null;
    eq(Dominion.engine.primitives.choose(g, "p1", { type: "probe" }, ["a", "b", "c"]), null, "no decision returns null");
  });

  /* ══════════════════ Task 13: deterministic RNG & log ══════════ */
  function runScriptedGame(seed) {
    const g = Dominion.engine.setup({ players: 2, seed, decide: (s, p) => Dominion.engine.defaultDecide(s, p) });
    let turnPlayer = "p1";
    for (let t = 0; t < 3; t++) {
      Dominion.engine.beginTurn(g, turnPlayer);
      Dominion.engine.advancePhase(g); // action → buy
      Dominion.engine.advancePhase(g); // buy → cleanup → draw → next player's action
      turnPlayer = g.turnPlayer;
      Dominion.engine.advancePhase(g); // action → buy
      Dominion.engine.advancePhase(g); // buy → cleanup → draw → next player's action
      turnPlayer = g.turnPlayer;
    }
    return g;
  }

  t("log: identical seeds and decisions replay identical games", () => {
    const a = runScriptedGame(42);
    const b = runScriptedGame(42);
    deepEq(a.log, b.log, "identical game logs");
    deepEq(a.players.map((p) => [p.deck, p.hand, p.discard, p.play]),
      b.players.map((p) => [p.deck, p.hand, p.discard, p.play]), "identical end zones");
    deepEq(a.supply, b.supply, "identical supply");
  });
  t("log: different seeds produce different games", () => {
    const a = runScriptedGame(42);
    const c = runScriptedGame(43);
    const zonesA = JSON.stringify(a.players.map((p) => [p.deck, p.hand, p.discard]));
    const zonesC = JSON.stringify(c.players.map((p) => [p.deck, p.hand, p.discard]));
    assert(zonesA !== zonesC, "end zones differ across seeds");
  });
  t("log: no Math.random is used during seeded gameplay", () => {
    const orig = Math.random;
    let hit = false;
    Math.random = () => { hit = true; return 0.5; };
    try { runScriptedGame(7); } finally { Math.random = orig; }
    assert(!hit, "Math.random must never be called during seeded gameplay");
  });
  t("log: every decision is recorded in the game log", () => {
    const g = Dominion.engine.setup({ players: 2, seed: 5, decide: (s, p) => (p.type === "react" ? ["moat"] : null) });
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["witch"];
    p1.deck = ["a", "b"];
    Dominion.engine.player(g, "p2").hand = ["moat", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    const decides = g.log.filter((e) => e.t === "decide");
    assert(decides.length > 0, "decisions logged");
    const react = decides.find((e) => e.kind === "react");
    assert(react && react.player === "p2" && react.choice[0] === "moat", "react decision logged with its choice");
  });

  /* ══════════════════ Task 14: Artisan ══════════════════════════ */
  t("artisan: gains a card costing up to $5 into the hand", () => {
    const g = freshGame2p();
    g.supply = { copper: 10, silver: 5, gold: 4, market: 6, province: 8, estate: 8 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["artisan"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "gainToHand" ? "market" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "artisan" });
    deepEq(p1.hand, ["market"], "market gained into the hand");
    eq(g.supply.market, 5, "supply decremented");
    deepEq(p1.discard, [], "nothing gained to discard");
    deepEq(p1.play, ["artisan"], "artisan sits in the play area");
  });
  t("artisan: a card over $5 or with a potion cost cannot be chosen", () => {
    const g = freshGame2p();
    g.supply = { copper: 10, gold: 4 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["artisan"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "gainToHand" ? "gold" : null); // gold costs $6
    Dominion.engine.actions.play(g, "p1", { cardId: "artisan" });
    deepEq(p1.hand, [], "the $6 card was not gained");
    eq(g.supply.gold, 4, "gold pile untouched");
    const g2 = freshGame2p();
    if (!Dominion.cards.has("potion_probe")) {
      Dominion.cards.register({ id: "potion_probe", name: "Potion Probe", cost: { coins: 3, potion: 1 }, types: ["Action"], text: "test", expansion: "test" });
    }
    g2.supply = { copper: 10, potion_probe: 2 };
    g2.decide = (s, prompt) => (prompt.type === "gainToHand" ? "potion_probe" : null);
    const p2 = Dominion.engine.player(g2, "p1");
    p2.hand = ["artisan"];
    Dominion.engine.beginTurn(g2, "p1");
    Dominion.engine.actions.play(g2, "p1", { cardId: "artisan" });
    deepEq(p2.hand, [], "a potion-cost card is not gainable by $");
    eq(g2.supply.potion_probe, 2, "potion pile untouched");
  });

  /* ══════════════════ Task 15: Bandit ═══════════════════════════ */
  t("bandit: attacker gains a Gold, each other player is attacked", () => {
    const g = freshGame2p();
    g.supply = { gold: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bandit"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.deck = ["copper", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "bandit" });
    deepEq(p1.discard, ["gold"], "attacker gained a Gold");
    eq(g.supply.gold, 9, "supply decremented once");
    deepEq(p2.discard, ["copper"], "revealed Copper discarded");
    deepEq(g.trash, ["gold"], "revealed non-Copper Treasure trashed");
    deepEq(p2.setAside, [], "set-aside area emptied");
    const reveals = g.log.filter((e) => e.t === "reveal" && e.player === "p2").map((e) => e.card);
    deepEq(reveals, ["gold", "copper"], "top 2 revealed in order");
  });
  t("bandit: only Copper revealed means nothing is trashed", () => {
    const g = freshGame2p();
    g.supply = { gold: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bandit"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.deck = ["copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "bandit" });
    deepEq(p2.discard, ["copper", "copper"], "both Coppers discarded");
    deepEq(g.trash, [], "nothing trashed");
  });
  t("bandit: Moat leaves the defender's deck untouched", () => {
    const g = freshGame2p();
    g.supply = { gold: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bandit"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["moat"];
    p2.deck = ["gold", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "react" ? ["moat"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "bandit" });
    deepEq(p1.discard, ["gold"], "attacker still gains a Gold");
    deepEq(p2.deck, ["gold", "gold"], "defender's deck untouched");
    deepEq(g.trash, [], "nothing trashed");
  });
  t("bandit: reveals across a reshuffle when the deck is short", () => {
    const g = freshGame2p();
    g.supply = { gold: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bandit"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.deck = ["gold"];
    p2.discard = ["copper"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "bandit" });
    deepEq(p2.discard, ["copper"], "revealed Copper lands in the discard");
    deepEq(g.trash, ["gold"], "the Gold was trashed");
    deepEq(p2.deck, [], "deck emptied");
    deepEq(p2.setAside, [], "set-aside cleared");
    assert(g.log.some((e) => e.t === "reshuffle"), "reshuffle logged during the reveal");
  });
  t("bandit & artisan: catalog stats are exact", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const artisan = Dominion.cards.get("artisan");
    assert(artisan && artisan.types.includes("Action"), "artisan is an Action");
    eq(artisan.cost.coins, 6, "artisan $6");
    const bandit = Dominion.cards.get("bandit");
    assert(bandit && bandit.types.includes("Attack"), "bandit is an Attack");
    eq(bandit.cost.coins, 5, "bandit $5");
  });

  /* ══════════════════ Task 16: Bureaucrat ═══════════════════════ */
  t("bureaucrat: attacker gains a Silver onto the deck", () => {
    const g = freshGame2p();
    g.supply = { silver: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bureaucrat"];
    p1.deck = ["copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "bureaucrat" });
    deepEq(p1.deck, ["copper", "copper", "silver"], "Silver on top (end) of the deck");
    deepEq(p1.discard, [], "nothing gained to discard");
    eq(g.supply.silver, 9, "supply decremented");
  });
  t("bureaucrat: defenders topdeck a chosen Victory card", () => {
    const g = freshGame2p();
    g.supply = { silver: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bureaucrat"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["estate", "duchy", "copper"];
    p2.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "topdeckVictory" ? "duchy" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "bureaucrat" });
    deepEq(p2.deck, ["a", "duchy"], "chosen Victory card on top of the deck");
    deepEq(p2.hand, ["estate", "copper"], "only the chosen Victory left the hand");
    assert(g.log.some((e) => e.t === "reveal" && e.player === "p2" && e.card === "duchy"), "Victory card revealed first");
  });
  t("bureaucrat: a hand with no Victory cards is revealed whole and unchanged", () => {
    const g = freshGame2p();
    g.supply = { silver: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bureaucrat"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["gold", "copper", "silver"];
    p2.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "bureaucrat" });
    deepEq(p2.hand, ["gold", "copper", "silver"], "hand untouched");
    deepEq(p2.deck, ["a"], "nothing topdecked");
    const reveals = g.log.filter((e) => e.t === "reveal" && e.player === "p2").map((e) => e.card);
    deepEq(reveals, ["gold", "copper", "silver"], "the whole hand was revealed");
  });
  t("bureaucrat: Moat blocks the attack but the attacker still gains Silver", () => {
    const g = freshGame2p();
    g.supply = { silver: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bureaucrat"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["moat", "estate"];
    p2.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "react" ? ["moat"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "bureaucrat" });
    deepEq(p1.deck, ["silver"], "attacker's Silver is still gained onto the deck");
    deepEq(p2.deck, ["a"], "defender's deck untouched");
    deepEq(p2.hand.filter((c) => c === "estate").length, 1, "defender kept their Victory card");
  });

  /* ══════════════════ Task 17: Cellar (verify) ══════════════════ */
  t("cellar: discarding nothing draws nothing", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["cellar", "gold", "gold"];
    p1.deck = ["a", "b", "c"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardAny" ? [] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "cellar" });
    deepEq(p1.hand, ["gold", "gold"], "hand unchanged");
    deepEq(p1.discard, [], "nothing discarded");
    deepEq(p1.deck, ["a", "b", "c"], "deck untouched — no draw happened");
    eq(p1.actions, 1, "still +1 Action");
  });
  t("cellar: discard-then-draw counts match exactly", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["cellar", "copper", "estate", "copper", "curse", "silver"];
    p1.deck = ["a", "b", "c"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardAny" ? [3, 4] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "cellar" });
    deepEq(p1.hand, ["copper", "estate", "copper", "c", "b"], "drew exactly the 2 discarded (top-first)");
    deepEq(p1.discard, ["silver", "curse"], "the discarded cards land in the discard");
  });

  /* ══════════════════ Task 18: Chapel ═══════════════════════════ */
  t("chapel: trashes up to 4 chosen cards", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["chapel", "curse", "estate", "copper", "copper", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "trashUpTo" ? [0, 1, 2, 3] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "chapel" });
    deepEq(p1.hand, ["gold"], "4 cards trashed, gold kept");
    eq(g.trash.length, 4, "exactly 4 cards in the trash");
    assert(g.trash.every((c) => c !== "gold"), "gold was not trashed");
  });
  t("chapel: trashing nothing trashes nothing", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["chapel", "gold", "silver"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "trashUpTo" ? [] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "chapel" });
    deepEq(p1.hand, ["gold", "silver"], "hand unchanged");
    deepEq(g.trash, [], "trash empty");
  });
  t("chapel: the cap at 4 is enforced even for greedy choices", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["chapel", "curse", "estate", "copper", "copper", "gold", "silver"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "trashUpTo" ? [1, 2, 3, 4, 5, 6] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "chapel" });
    eq(p1.hand.length, 2, "only 4 of the 6 chosen cards could be trashed");
    eq(g.trash.length, 4, "exactly 4 trashed");
  });
  t("chapel: 0-to-4 trashing covers every valid count", () => {
    const g = freshGame2p();
    for (let n = 0; n <= 4; n++) {
      const p1 = Dominion.engine.player(g, "p1");
      const cards = ["chapel"];
      for (let i = 0; i < n; i++) cards.push("copper");
      p1.hand = cards;
      g.trash.length = 0;
      g.decide = (s, prompt) => (prompt.type === "trashUpTo" ? [0, 1, 2, 3].slice(0, n) : null);
      Dominion.engine.beginTurn(g, "p1");
      Dominion.engine.actions.play(g, "p1", { cardId: "chapel" });
      eq(g.trash.length, n, "trashed " + n + " of " + n + " available");
      eq(p1.hand.length, 0, "hand emptied after trashing " + n);
      Dominion.engine.endTurn(g); // reset for next iteration
    }
  });
  t("bureaucrat & chapel: catalog stats are exact", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const bureaucrat = Dominion.cards.get("bureaucrat");
    assert(bureaucrat && bureaucrat.types.includes("Attack"), "bureaucrat is an Attack");
    eq(bureaucrat.cost.coins, 4, "bureaucrat $4");
    const chapel = Dominion.cards.get("chapel");
    assert(chapel && chapel.types.includes("Action"), "chapel is an Action");
    eq(chapel.cost.coins, 2, "chapel $2");
  });

  /* ══════════════════ Task 19: Council Room ═════════════════════ */
  t("council room: +4 Cards +1 Buy; each other player draws 1", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["council_room"];
    p1.deck = ["a", "b", "c", "d", "e"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.deck = ["x", "y", "z"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "council_room" });
    deepEq(p1.hand, ["e", "d", "c", "b"], "+4 Cards drawn top-first");
    eq(p1.buys, 2, "+1 Buy on top of the base 1");
    deepEq(p2.hand, ["z"], "each other player draws exactly 1");
    eq(p2.deck.length, 2, "p2's deck reduced by one");
  });
  t("council room: every other player draws in a 3-player game", () => {
    const g = freshGame3p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["council_room"];
    p1.deck = ["a", "b", "c", "d", "e"];
    Dominion.engine.player(g, "p2").deck = ["x"];
    Dominion.engine.player(g, "p3").deck = ["y"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "council_room" });
    deepEq(Dominion.engine.player(g, "p2").hand, ["x"], "p2 drew 1");
    deepEq(Dominion.engine.player(g, "p3").hand, ["y"], "p3 drew 1");
    eq(p1.hand.length, 4, "attacker's own hand is only the +4");
  });
  t("council room: the shared draw is a benefit, not an attack", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["council_room"];
    p1.deck = ["a", "b", "c", "d", "e"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["moat"];
    p2.deck = ["x", "y"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "react" ? ["moat"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "council_room" });
    deepEq(p2.hand, ["moat", "y"], "a Moat in hand does not block the draw");
    assert(!g.log.some((e) => e.t === "reveal"), "no reaction window was opened");
  });

  /* ══════════════════ Task 20: Festival (verify) ════════════════ */
  t("festival: +2 Actions +1 Buy +2 Coins resource math", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["festival"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "festival" });
    eq(p1.actions, 2, "spend 1, +2 Actions → 2");
    eq(p1.buys, 2, "+1 Buy → 2");
    eq(p1.coins, 2, "+2 Coins");
    deepEq(p1.play, ["festival"], "festival in the play area");
  });

  /* ══════════════════ Task 21: Gardens (verify) ═════════════════ */
  t("gardens: catalog card is a $4 Victory with dynamic VP", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const gardens = Dominion.cards.get("gardens");
    assert(gardens && gardens.types.includes("Victory"), "gardens is a Victory");
    eq(gardens.cost.coins, 4, "gardens $4");
  });

  /* ══════════════════ Task 22: Harbinger ════════════════════════ */
  t("harbinger: +1 Card +1 Action; may topdeck the top discard card", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["harbinger"];
    p1.deck = ["a"];
    p1.discard = ["copper", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "topdeckTop" ? true : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "harbinger" });
    eq(p1.actions, 1, "spend 1, +1 Action → 1");
    deepEq(p1.hand, ["a"], "+1 Card drawn");
    deepEq(p1.discard, ["copper"], "the top discard card left the pile");
    deepEq(p1.deck, ["gold"], "it now sits on top of the deck");
  });
  t("harbinger: declining leaves the discard unchanged", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["harbinger"];
    p1.deck = ["a"];
    p1.discard = ["silver"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "topdeckTop" ? false : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "harbinger" });
    deepEq(p1.discard, ["silver"], "discard unchanged after declining");
    deepEq(p1.deck, [], "no topdeck happened");
  });
  t("harbinger: an empty discard pile is safe", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["harbinger"];
    p1.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    let threw = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "harbinger" }); } catch (e) { threw = true; }
    assert(!threw, "no error with an empty discard");
    deepEq(p1.hand, ["a"], "still +1 Card");
  });
  t("council room, harbinger, festival & gardens: catalog stats", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    eq(Dominion.cards.get("council_room").cost.coins, 5, "council room $5");
    assert(Dominion.cards.get("council_room").types.includes("Action"), "council room is an Action");
    eq(Dominion.cards.get("harbinger").cost.coins, 3, "harbinger $3");
    assert(Dominion.cards.get("harbinger").types.includes("Action"), "harbinger is an Action");
    eq(Dominion.cards.get("festival").cost.coins, 5, "festival $5");
    eq(Dominion.cards.get("gardens").cost.coins, 4, "gardens $4");
  });

  /* ══════════════════ Task 23: Laboratory (verify) ══════════════ */
  t("laboratory: +2 Cards +1 Action", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["laboratory"];
    p1.deck = ["a", "b"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "laboratory" });
    eq(p1.actions, 1, "spend 1, +1 Action → 1");
    deepEq(p1.hand, ["b", "a"], "+2 Cards drawn top-first");
    deepEq(p1.play, ["laboratory"], "laboratory in the play area");
  });

  /* ══════════════════ Task 24: Library ═══════════════════════════ */
  t("library: draws until 7 cards in hand", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["library", "copper", "copper"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "library" });
    eq(p1.hand.length, 7, "hand filled to exactly 7");
    eq(p1.deck.length, 1, "only the needed 5 cards were drawn");
    deepEq(p1.setAside, [], "nothing set aside");
    deepEq(p1.discard, [], "nothing discarded");
  });
  t("library: set-aside Actions are discarded when done", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["library"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "copper", "copper", "smithy"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "setAsideAction" ? true : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "library" });
    eq(p1.hand.length, 7, "hand reached 7");
    assert(p1.hand.indexOf("smithy") === -1, "set-aside smithy not in hand");
    deepEq(p1.setAside, [], "set-aside pile emptied");
    deepEq(p1.discard, ["smithy"], "the set-aside Action was discarded");
  });
  t("library: declining keeps the Action in hand", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["library"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "copper", "copper", "smithy"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "setAsideAction" ? false : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "library" });
    eq(p1.hand.length, 7, "hand reached 7 with the smithy kept");
    assert(p1.hand.includes("smithy"), "smithy stayed in hand");
    deepEq(p1.discard, [], "nothing discarded");
    eq(p1.deck.length, 1, "only 7 cards drawn");
  });
  t("library: an exhausted deck stops drawing safely", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["library"];
    p1.deck = ["copper"];
    Dominion.engine.beginTurn(g, "p1");
    let threw = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "library" }); } catch (e) { threw = true; }
    assert(!threw, "no error when deck and discard run out");
    eq(p1.hand.length, 1, "drew what existed and stopped");
    deepEq(p1.setAside, [], "nothing left in set-aside");
  });

  /* ══════════════════ Task 25: Market (verify) ═══════════════════ */
  t("market: +1 Card +1 Action +1 Buy +1 Coin", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["market"];
    p1.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "market" });
    deepEq(p1.hand, ["a"], "+1 Card");
    eq(p1.actions, 1, "spend 1, +1 Action → 1");
    eq(p1.buys, 2, "+1 Buy → 2");
    eq(p1.coins, 1, "+1 Coin");
    deepEq(p1.play, ["market"], "market in the play area");
  });

  /* ══════════════════ Task 26: Merchant ═══════════════════════════ */
  t("merchant: +1 Card +1 Action; first Silver gives +1 Coin", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["merchant"];
    p1.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "merchant" });
    eq(p1.actions, 1, "spend 1, +1 Action → 1");
    deepEq(p1.hand, ["a"], "+1 Card");
    eq(p1.merchantSilver, true, "flag armed");
    p1.hand.push("silver");
    Dominion.engine.treasures.play(g, "p1", { cardIds: ["silver"] });
    eq(p1.coins, 3, "Silver gives 2 + 1 Merchant bonus");
    eq(p1.merchantSilver, false, "flag consumed by the first Silver");
  });
  t("merchant: only the first Silver is boosted this turn", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["merchant"];
    p1.deck = [];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "merchant" });
    p1.hand.push("silver", "silver");
    Dominion.engine.treasures.play(g, "p1", { cardIds: ["silver", "silver"] });
    eq(p1.coins, 5, "first Silver 3 (2+1), second Silver plain 2");
  });
  t("merchant: the Silver flag resets at the start of a new turn", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["merchant"];
    p1.deck = [];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "merchant" });
    eq(p1.merchantSilver, true, "armed during the turn");
    Dominion.engine.beginTurn(g, "p1");
    eq(p1.merchantSilver, false, "disarmed by the next turn's reset");
  });

  /* ══════════════════ Task 27: Militia (verify) ═══════════════════ */
  t("militia (verify): every other player discards down to 3 in 3p", () => {
    const g = freshGame3p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["militia"];
    p1.deck = [];
    Dominion.engine.player(g, "p2").hand = ["copper", "copper", "copper", "copper", "copper"];
    Dominion.engine.player(g, "p3").hand = ["copper", "copper", "copper", "copper", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardDown" ? [0, 1] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "militia" });
    eq(p1.coins, 2, "+2 Coins");
    eq(Dominion.engine.player(g, "p2").hand.length, 3, "p2 down to 3");
    eq(Dominion.engine.player(g, "p3").hand.length, 3, "p3 down to 3");
    eq(p1.hand.length, 0, "attacker's hand untouched");
  });

  /* ══════════════════ Task 28: Mine ═══════════════════════════════ */
  t("mine: trash a Treasure, gain up to $3 more into hand", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["mine", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => {
      if (prompt.type === "trashTreasure") return 0;
      if (prompt.type === "gainTreasure") return "silver";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "mine" });
    deepEq(p1.hand, ["silver"], "gained Silver lands in hand, not discard");
    deepEq(g.trash, ["copper"], "copper trashed");
    eq(g.supply.silver, 39, "Silver taken from the supply");
  });
  t("mine: trashing a Silver enables gaining a Gold (cost 3 → 6)", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["mine", "silver"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => {
      if (prompt.type === "trashTreasure") return 0;
      if (prompt.type === "gainTreasure") return "gold";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "mine" });
    deepEq(p1.hand, ["gold"], "Gold gained into hand");
    deepEq(g.trash, ["silver"], "silver trashed");
    eq(g.supply.gold, 29, "one Gold from the supply");
  });
  t("mine: declining to trash does nothing", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["mine", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "gainTreasure" ? "silver" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "mine" });
    deepEq(p1.hand, ["copper"], "treasure left in hand");
    deepEq(g.trash, [], "nothing trashed");
    eq(g.supply.silver, 40, "nothing gained");
  });
  t("mine: a hand with no Treasure is safe", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["mine", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    let threw = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "mine" }); } catch (e) { threw = true; }
    assert(!threw, "no error when hand has no Treasure");
    deepEq(p1.hand, ["estate"], "nothing trashed");
    deepEq(g.trash, [], "trash untouched");
  });
  t("mine: default bot trashes the highest-cost Treasure and gains the best", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["mine", "silver"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "mine" });
    deepEq(g.trash, ["silver"], "default bot trashed the Silver");
    deepEq(p1.hand, ["gold"], "default bot gained a Gold into hand");
    deepEq(p1.discard, [], "no stray discard");
  });
  t("merchant, mine & militia: catalog stats", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    eq(Dominion.cards.get("merchant").cost.coins, 3, "merchant $3");
    assert(Dominion.cards.get("merchant").types.includes("Action"), "merchant is an Action");
    eq(Dominion.cards.get("mine").cost.coins, 5, "mine $5");
    assert(Dominion.cards.get("mine").types.includes("Action"), "mine is an Action");
    eq(Dominion.cards.get("militia").cost.coins, 4, "militia $4");
    assert(Dominion.cards.get("militia").types.includes("Attack"), "militia is an Attack");
  });

  /* ══════════════════ Task 29: Moat (verify) ══════════════════════ */
  t("moat (verify): catalog card is a $2 Action-Reaction", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const moat = Dominion.cards.get("moat");
    assert(moat && moat.types.includes("Action"), "moat is an Action");
    assert(moat.types.includes("Reaction"), "moat is a Reaction");
    eq(moat.cost.coins, 2, "moat $2");
  });
  t("moat (verify): played as an Action it draws 2 cards", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["moat"];
    p1.deck = ["a", "b"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "moat" });
    deepEq(p1.hand, ["b", "a"], "+2 Cards drawn top-first");
    deepEq(p1.play, ["moat"], "moat in the play area");
  });

  /* ══════════════════ Task 30: Moneylender ════════════════════════ */
  t("moneylender: +1 Action; trash a Copper for +3 Coins", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["moneylender", "copper", "copper", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "trashCopper" ? 0 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "moneylender" });
    eq(p1.actions, 1, "spend 1, +1 Action → 1");
    eq(p1.coins, 3, "+3 Coins from the trashed Copper");
    deepEq(g.trash, ["copper"], "one Copper trashed");
    deepEq(p1.hand, ["copper", "estate"], "only one Copper gone");
  });
  t("moneylender: declining the trash gains nothing", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["moneylender", "copper"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "trashCopper" ? null : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "moneylender" });
    eq(p1.coins, 0, "no bonus without the trash");
    deepEq(p1.hand, ["copper"], "Copper kept");
    deepEq(g.trash, [], "nothing trashed");
  });
  t("moneylender: no Copper in hand is safe and gives no coins", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["moneylender", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    let threw = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "moneylender" }); } catch (e) { threw = true; }
    assert(!threw, "no error without a Copper");
    eq(p1.coins, 0, "no coins");
    deepEq(p1.hand, ["estate"], "nothing trashed");
  });
  t("moneylender: default bot trashes a Copper and takes the coins", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["moneylender", "copper", "silver"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "moneylender" });
    eq(p1.coins, 3, "bot trashed a Copper for +3");
    deepEq(p1.hand, ["silver"], "Copper gone, Silver kept");
    deepEq(g.trash, ["copper"], "Copper trashed");
  });

  /* ══════════════════ Task 31: Poacher ════════════════════════════ */
  t("poacher: +1 Card +1 Action +1 Coin; no discard with a full supply", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["poacher"];
    p1.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "poacher" });
    eq(p1.actions, 1, "spend 1, +1 Action → 1");
    deepEq(p1.hand, ["a"], "+1 Card");
    eq(p1.coins, 1, "+1 Coin");
    deepEq(p1.discard, [], "no empty piles → no discard");
  });
  t("poacher: one card discarded per empty supply pile", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, poacher: 0, smithy: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["poacher", "copper", "copper", "estate"];
    p1.deck = [];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardPerEmpty" ? [1] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "poacher" });
    eq(p1.hand.length, 2, "one card discarded for the one empty pile");
    deepEq(p1.discard, ["copper"], "the chosen card was discarded");
    eq(p1.coins, 1, "+1 Coin still applies");
  });
  t("poacher: two empty piles discard two cards", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, poacher: 0, smithy: 0 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["poacher", "copper", "copper", "copper", "copper"];
    p1.deck = [];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardPerEmpty" ? [0, 2] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "poacher" });
    eq(p1.hand.length, 2, "two cards discarded");
    eq(p1.discard.length, 2, "two cards in the discard");
  });
  t("poacher: opponents are never touched — not an Attack", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, poacher: 0 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["poacher"];
    p1.deck = ["a"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["gold", "gold", "gold", "gold", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "discardPerEmpty" ? [] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "poacher" });
    deepEq(p2.hand, ["gold", "gold", "gold", "gold", "gold"], "p2 untouched");
    assert(!g.log.some((e) => e.t === "reveal"), "no reaction window — poacher is not an Attack");
  });
  t("poacher: default bot discards lowest-cost cards first", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, poacher: 0, smithy: 0 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["poacher", "gold", "curse", "estate", "copper"];
    p1.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "poacher" });
    eq(p1.discard.length, 2, "two cards discarded for two empty piles");
    deepEq(p1.discard, ["copper", "curse"], "the two 0-cost cards went first");
  });
  t("moneylender, poacher & moat: catalog stats", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    eq(Dominion.cards.get("moneylender").cost.coins, 4, "moneylender $4");
    assert(Dominion.cards.get("moneylender").types.includes("Action"), "moneylender is an Action");
    eq(Dominion.cards.get("poacher").cost.coins, 4, "poacher $4");
    assert(Dominion.cards.get("poacher").types.includes("Action"), "poacher is an Action");
    assert(!Dominion.cards.get("poacher").types.includes("Attack"), "poacher is NOT an Attack");
    eq(Dominion.cards.get("moat").cost.coins, 2, "moat $2");
  });

  /* ══════════════════ Task 32: Remodel ════════════════════════════ */
  t("remodel: trash a card, gain a card costing up to $2 more", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, remodel: 10, smithy: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["remodel", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => {
      if (prompt.type === "trashAny") return 0;
      if (prompt.type === "gainCard") return "smithy";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "remodel" });
    deepEq(g.trash, ["estate"], "estate trashed");
    deepEq(p1.discard, ["smithy"], "gained card lands in the discard");
    deepEq(p1.hand, [], "hand emptied");
  });
  t("remodel: trashing a Gold allows up to $8 (cost 6 + 2)", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, remodel: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["remodel", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => {
      if (prompt.type === "trashAny") return 0;
      if (prompt.type === "gainCard") return "province";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "remodel" });
    deepEq(p1.discard, ["province"], "province (8 ≤ 6+2) gained");
    deepEq(g.trash, ["gold"], "gold trashed");
  });
  t("remodel: declining the trash does nothing", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, remodel: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["remodel", "estate"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "gainCard" ? "smithy" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "remodel" });
    deepEq(p1.hand, ["estate"], "nothing trashed");
    deepEq(g.trash, [], "trash untouched");
    deepEq(p1.discard, [], "nothing gained");
  });
  t("remodel: default bot trashes the lowest-cost card and gains the best", () => {
    const g = freshGame2p();
    g.supply = { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, remodel: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["remodel", "gold", "curse"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "remodel" });
    deepEq(g.trash, ["curse"], "bot trashed the curse (cost 0)");
    deepEq(p1.discard, ["estate"], "bot gained the best card up to $2 (estate)");
  });

  /* ══════════════════ Task 33: Sentry ═════════════════════════════ */
  t("sentry: +1 Card +1 Action; trash/discard the looked cards", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["sentry"];
    p1.deck = ["curse", "copper", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "sentryLook" ? { trash: ["curse"], discard: ["copper"] } : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "sentry" });
    eq(p1.actions, 1, "spend 1, +1 Action → 1");
    deepEq(p1.hand, ["gold"], "+1 Card drawn from the top");
    deepEq(g.trash, ["curse"], "curse trashed");
    deepEq(p1.discard, ["copper"], "copper discarded");
    deepEq(p1.deck, [], "both looked cards disposed of");
    deepEq(p1.setAside, [], "set-aside cleared");
  });
  t("sentry: kept cards return to the top in their original order", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["sentry"];
    p1.deck = ["a", "silver", "gold"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "sentryLook" ? { trash: [], discard: [] } : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "sentry" });
    deepEq(p1.hand, ["gold"], "+1 Card drawn");
    deepEq(p1.deck, ["a", "silver"], "silver on top, a below — order preserved");
    deepEq(p1.setAside, [], "set-aside cleared");
    deepEq(g.trash, [], "nothing trashed");
    deepEq(p1.discard, [], "nothing discarded");
  });
  t("sentry: a thin deck is safe", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["sentry"];
    p1.deck = ["copper"];
    Dominion.engine.beginTurn(g, "p1");
    let threw = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "sentry" }); } catch (e) { threw = true; }
    assert(!threw, "no error with a 1-card deck");
    eq(p1.deck.length, 0, "the single card was the +1 draw");
    deepEq(g.trash, [], "nothing trashed");
  });
  t("sentry: default bot trashes Curses and discards Coppers", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["sentry"];
    p1.deck = ["copper", "curse", "silver"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "sentry" });
    deepEq(p1.hand, ["silver"], "+1 Card drawn");
    deepEq(g.trash, ["curse"], "curse trashed by default bot");
    deepEq(p1.discard, ["copper"], "copper discarded by default bot");
    deepEq(p1.deck, [], "nothing left on the deck");
  });

  /* ══════════════════ Task 34: Smithy (verify) ════════════════════ */
  t("smithy (verify): +3 Cards, reshuffling the discard mid-draw", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["smithy"];
    p1.deck = ["a", "b"];
    p1.discard = ["c"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "smithy" });
    eq(p1.hand.length, 3, "drew 3 cards total");
    assert(g.log.some((e) => e.t === "reshuffle" && e.player === "p1"), "discard reshuffled mid-draw");
    deepEq(p1.play, ["smithy"], "smithy in the play area");
  });

  /* ══════════════════ Task 35: Throne Room ════════════════════════ */
  t("throne room: plays an Action from hand twice", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["throne_room", "smithy"];
    p1.deck = ["a", "b", "c", "d", "e", "f"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => (prompt.type === "playActionTwice" ? "smithy" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "throne_room" });
    eq(p1.actions, 0, "throne room cost the one action");
    deepEq(p1.hand, ["f", "e", "d", "c", "b", "a"], "smithy resolved twice → +6 Cards");
    deepEq(p1.play, ["throne_room", "smithy"], "both cards in the play area");
  });
  t("throne room: declining plays nothing", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["throne_room", "smithy"];
    p1.deck = ["a", "b"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => null;
    Dominion.engine.actions.play(g, "p1", { cardId: "throne_room" });
    deepEq(p1.hand, ["smithy"], "no action was played twice");
    deepEq(p1.deck, ["a", "b"], "deck untouched");
    deepEq(p1.play, ["throne_room"], "only throne room in play");
    eq(p1.actions, 0, "throne room still spent the action");
  });
  t("throne room: chained throne rooms cascade", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["throne_room", "throne_room", "smithy", "smithy"];
    p1.deck = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    Dominion.engine.beginTurn(g, "p1");
    g.decide = (s, prompt) => {
      if (prompt.type !== "playActionTwice") return null;
      return prompt.options.find((c) => c === "throne_room") || prompt.options.find((c) => c === "smithy") || null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "throne_room" });
    eq(p1.hand.length, 12, "TR×2 → TR×2 → smithy×2 → smithy×2 = +12 Cards");
    eq(p1.play.length, 4, "throne_room, throne_room, smithy, smithy all in play");
  });
  t("remodel, sentry, throne room & smithy: catalog stats", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    eq(Dominion.cards.get("remodel").cost.coins, 4, "remodel $4");
    assert(Dominion.cards.get("remodel").types.includes("Action"), "remodel is an Action");
    eq(Dominion.cards.get("sentry").cost.coins, 5, "sentry $5");
    eq(Dominion.cards.get("throne_room").cost.coins, 4, "throne room $4");
    assert(Dominion.cards.get("throne_room").types.includes("Action"), "throne room is an Action");
    eq(Dominion.cards.get("smithy").cost.coins, 4, "smithy $4");
  });

  /* ══════════════════ Task 36: Vassal ═════════════════════════════ */
  t("vassal: +1 Coin; plays a revealed Action", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["vassal"];
    p1.deck = ["x", "y", "z", "smithy"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "vassal" });
    eq(p1.coins, 1, "+1 Coin");
    assert(g.log.some((e) => e.t === "reveal" && e.card === "smithy"), "smithy was revealed");
    deepEq(p1.hand, ["z", "y", "x"], "revealed smithy was played, drawing 3");
    deepEq(p1.play, ["vassal", "smithy"], "both cards in the play area");
  });
  t("vassal: a revealed non-Action is discarded", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["vassal"];
    p1.deck = ["gold"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "vassal" });
    eq(p1.coins, 1, "+1 Coin");
    deepEq(p1.discard, ["gold"], "gold discarded");
    deepEq(p1.play, ["vassal"], "only vassal in play");
    deepEq(p1.setAside, [], "set-aside cleared");
  });
  t("vassal: an empty deck reshuffles the discard before revealing", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["vassal"];
    p1.deck = [];
    p1.discard = ["smithy"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "vassal" });
    assert(g.log.some((e) => e.t === "reshuffle" && e.player === "p1"), "reshuffled before revealing");
    assert(g.log.some((e) => e.t === "reveal" && e.card === "smithy"), "smithy revealed and played");
    deepEq(p1.play, ["vassal", "smithy"], "smithy played into the play area");
  });
  t("vassal: a totally empty deck+discard is safe", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["vassal"];
    p1.deck = [];
    p1.discard = [];
    Dominion.engine.beginTurn(g, "p1");
    let threw = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "vassal" }); } catch (e) { threw = true; }
    assert(!threw, "no error with nothing to reveal");
    eq(p1.coins, 1, "+1 Coin still granted");
  });

  /* ══════════════════ Task 37: Village (verify) ═══════════════════ */
  t("village (verify): +1 Card +2 Actions", () => {
    const g = freshGame2p();
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["village"];
    p1.deck = ["a"];
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "village" });
    eq(p1.actions, 2, "spend 1, +2 Actions → 2");
    deepEq(p1.hand, ["a"], "+1 Card");
    deepEq(p1.play, ["village"], "village in the play area");
  });

  /* ══════════════════ Task 38: Witch (verify) ═════════════════════ */
  t("witch (verify): Curse pile depletion leaves later targets unharmed", () => {
    const g = Dominion.engine.setup({ players: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }, { id: "p3", name: "P3" }, { id: "p4", name: "P4" }], kingdom: ["witch"], seed: 1 });
    g.supply = { curse: 2, copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, witch: 10 };
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["witch"];
    p1.deck = ["a", "b"];
    for (const pid of ["p2", "p3", "p4"]) {
      Dominion.engine.player(g, pid).hand = [];
    }
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    deepEq(p1.hand, ["b", "a"], "+2 Cards");
    deepEq(Dominion.engine.player(g, "p2").discard, ["curse"], "p2 gained a curse");
    deepEq(Dominion.engine.player(g, "p3").discard, ["curse"], "p3 gained a curse");
    deepEq(Dominion.engine.player(g, "p4").discard, [], "p4 got nothing — pile was empty");
    eq(g.supply.curse, 0, "curse pile fully depleted");
  });
  t("vassal, village & witch: catalog stats", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    eq(Dominion.cards.get("vassal").cost.coins, 3, "vassal $3");
    assert(Dominion.cards.get("vassal").types.includes("Action"), "vassal is an Action");
    eq(Dominion.cards.get("village").cost.coins, 3, "village $3");
    eq(Dominion.cards.get("witch").cost.coins, 5, "witch $5");
    assert(Dominion.cards.get("witch").types.includes("Attack"), "witch is an Attack");
  });

  /* ══════════════════ Task 47: hotseat smoke test ══════════════ */
  t("hotseat: full 2-player AI game runs from setup to scoring", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    assert(Dominion.ai && typeof Dominion.ai.playTurn === "function", "ai.playTurn exists");
    const g = Dominion.engine.setup({ players: 2, seed: 12345 });
    Dominion.engine.beginTurn(g, "p1");
    let guard = 0;
    let stuck = false;
    while (!g.over && guard++ < 300) {
      const pid = g.turnPlayer;
      await Dominion.ai.playTurn(g, pid);
      if (g.turnPlayer === pid && !g.over) { stuck = true; break; }
    }
    assert(!stuck, "game never stalls");
    assert(g.over, "game reaches scoring (guard " + guard + ")");
    const scores = Dominion.engine.scoreAll(g);
    eq(scores.length, 2, "both players scored");
    assert(scores.every((s) => typeof s.total === "number"), "totals are numbers");
    assert(g.log.some((e) => e.t === "gameOver"), "gameOver logged");
  });

  /* ══════════════════ Task 48: AI action-play selection ═════════ */
  t("ai: chooseActions ranks legal hand actions (village chains before draw)", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    assert(Dominion.ai, "ai module loaded");
    const g = Dominion.engine.setup({ players: 2, seed: 5 });
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["village", "smithy", "moat", "copper"];
    p.actions = 2;
    const plan = Dominion.ai.chooseActions(g, "p1");
    assert(Array.isArray(plan) && plan.length, "returns plays");
    for (const pl of plan) {
      assert(p.hand.includes(pl.cardId), "card is in hand: " + pl.cardId);
      eq(pl.zone, "hand", "zone is hand");
    }
    const order = plan.map((x) => x.cardId);
    assert(order.indexOf("village") < order.indexOf("smithy"), "village ranked above smithy");
    assert(order.indexOf("smithy") < order.indexOf("moat"), "draw ranked above dead reaction");
    assert(!plan.some((x) => x.cardId === "copper"), "no non-actions");
  });
  t("ai: AI completes turns without errors across seeds", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    for (let i = 0; i < 6; i++) {
      const g = Dominion.engine.setup({ players: 2, kingdom: "base", seed: 1000 + i });
      Dominion.engine.beginTurn(g, "p1");
      const res = await Dominion.ai.playTurn(g, "p1");
      assert(typeof res.actionsPlayed === "number" && typeof res.buys === "number", "playTurn returns stats");
      assert(g.turnPlayer !== "p1" || g.over, "turn advanced past the AI (seed " + i + ")");
    }
  });

  /* ══════════════════ Task 49: buy decision model tiers ════════ */
  t("ai: harder buy tiers buy more consistently", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    assert(Dominion.ai && typeof Dominion.ai.chooseBuys === "function", "ai.chooseBuys exists");
    const fixture = () => {
      const g = Dominion.engine.setup({ players: 2, kingdom: ["village", "smithy", "market", "witch", "remodel"], seed: 5 });
      Dominion.engine.beginTurn(g, "p1");
      const p = Dominion.engine.player(g, "p1");
      p.hand = ["copper", "copper", "copper", "silver"];
      p.coins = 7;
      p.buys = 1;
      return g;
    };
    const probe = (diff) => {
      Dominion.ai.setDifficulty(diff);
      const seen = new Set();
      const scores = [];
      for (let i = 0; i < 15; i++) {
        const g = fixture();
        const plan = Dominion.ai.chooseBuys(g, "p1");
        assert(plan.length >= 1, diff + " returns a buy");
        seen.add(plan[0]);
        scores.push(Dominion.ai.buyScore(g, "p1", plan[0]));
      }
      return { distinct: seen.size, mean: scores.reduce((a, b) => a + b, 0) / scores.length };
    };
    const easy = probe("easy"), normal = probe("normal"), hard = probe("hard");
    eq(hard.distinct, 1, "hard buys one consistent card");
    eq(normal.distinct, 1, "normal buys one consistent card");
    assert(hard.mean >= easy.mean, "hard mean (" + hard.mean + ") >= easy mean (" + easy.mean + ")");
    assert(hard.mean >= normal.mean, "hard mean (" + hard.mean + ") >= normal mean (" + normal.mean + ")");
    assert(hard.distinct <= easy.distinct, "hard at most as varied as easy");
  });

  /* ══════════════════ Task 50: brutal lookahead tier ════════════ */
  t("ai: brutal tier's next-turn lookahead changes the buy", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["militia", "smithy", "village"], seed: 5 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["copper", "copper", "copper"];
    p.deck = ["copper", "copper", "copper"];
    p.discard = ["copper"];
    p.coins = 4;
    p.buys = 1;
    Dominion.ai.setDifficulty("normal");
    const normal = Dominion.ai.chooseBuys(g, "p1")[0];
    Dominion.ai.setDifficulty("brutal");
    const brutal = Dominion.ai.chooseBuys(g, "p1")[0];
    eq(normal, "militia", "normal buys the high-value action");
    eq(brutal, "silver", "brutal's draw-probability lookahead prefers the treasure");
    assert(normal !== brutal, "brutal diverges from normal on this fixture");
  });

  /* ══════════════════ Task 51: choice-card policies ═════════════ */
  t("ai: militia discard-down keeps the best cards", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 1 });
    const q = { type: "discardDown", player: "p1", hand: ["curse", "copper", "estate", "silver", "gold"], count: 2 };
    const d = Dominion.ai.choose(g, "p1", q);
    const discarded = d.map((i) => q.hand[i]).sort();
    assert(discarded.join(",") === "copper,curse", "discards the two lowest-value cards: " + discarded.join(","));
    assert(d.every((i) => i >= 0 && i < q.hand.length), "indices are valid");
  });
  t("ai: remodel trashes the curse over better cards", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 1 });
    const q = { type: "trashAny", player: "p1", hand: ["curse", "gold", "estate"] };
    const i = Dominion.ai.choose(g, "p1", q);
    eq(q.hand[i], "curse", "curse trashed first");
  });
  t("ai: sentry trashes curses and discards low-value cards", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 1 });
    const r = Dominion.ai.choose(g, "p1", { type: "sentryLook", cards: ["curse", "gold", "copper"] });
    deepEq(r.trash, ["curse"], "curse trashed");
    deepEq(r.discard, ["copper"], "copper discarded");
    assert(r.trash.indexOf("gold") === -1 && r.discard.indexOf("gold") === -1, "gold kept");
  });
  t("ai: mine upgrades the most expensive treasure", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 1 });
    const q = { type: "trashTreasure", player: "p1", hand: ["copper", "silver", "gold", "estate"] };
    const i = Dominion.ai.choose(g, "p1", q);
    eq(q.hand[i], "gold", "gold trashed for the upgrade");
  });
  t("ai: gainCard picks the best-value card in budget", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 1 });
    const q = { type: "gainCard", player: "p1", options: ["copper", "silver", "estate", "witch"] };
    eq(Dominion.ai.choose(g, "p1", q), "witch", "witch beats silver by hand value");
  });
  t("ai: harbinger topdecks only cards worth keeping", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 1 });
    eq(Dominion.ai.choose(g, "p1", { type: "topdeckTop", card: "silver" }), true, "topdeck silver");
    eq(Dominion.ai.choose(g, "p1", { type: "topdeckTop", card: "curse" }), false, "never topdeck a curse");
  });
  t("ai: militia attack timing rewards fuller opponent hands", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 1 });
    g.players[1].hand = [];
    const small = Dominion.ai.actionScore(g, "p1", "militia", {});
    g.players[1].hand = ["copper", "copper", "copper", "copper", "copper"];
    const big = Dominion.ai.actionScore(g, "p1", "militia", {});
    assert(big > small, "militia scores higher against big hands (" + big + " > " + small + ")");
  });

  /* ══════════════════ Task 52: special-state AI ═════════════════ */
  t("ai: villagers are spent for extra actions", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["village", "smithy"], seed: 3 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["village"];
    p.actions = 0;
    p.villagers = 3;
    const res = await Dominion.ai.playTurn(g, p.id);
    eq(res.actionsPlayed, 1, "village was played using a villager for the action");
    assert(g.players[0].villagers < 3, "villagers spent for actions");
  });
  t("ai: coffers are spent and debt is paid off", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 3 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["silver"];
    p.actions = 0;
    p.coins = 2;
    p.coffers = 3;
    p.debt = 2;
    await Dominion.ai.playTurn(g, p.id);
    eq(g.players[0].debt, 0, "debt fully paid");
    eq(g.players[0].coffers, 0, "coffers spent on coins");
  });
  t("ai: long game greening buys provinces", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 777 });
    Dominion.engine.beginTurn(g, "p1");
    let guard = 0, stuck = false;
    while (!g.over && guard++ < 300) {
      const pid = g.turnPlayer;
      await Dominion.ai.playTurn(g, pid);
      if (g.turnPlayer === pid && !g.over) { stuck = true; break; }
    }
    assert(!stuck && g.over, "long game completes");
    assert(g.log.some((e) => e.t === "buy" && e.card === "province"), "provinces were bought");
    assert(g.supply.province < 8, "province pile was drained by greening");
  });

  /* ══════════════════ Task 53: AI hardening ════════════════════ */
  t("ai: 6-player headless game completes", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({
      players: 6,
      seed: 555,
      aiDifficulty: { p2: "easy", p3: "normal", p4: "hard", p5: "brutal", p6: "easy" }
    });
    Dominion.engine.beginTurn(g, "p1");
    let guard = 0, stuck = false;
    while (!g.over && guard++ < 600) {
      const pid = g.turnPlayer;
      await Dominion.ai.playTurn(g, pid);
      if (g.turnPlayer === pid && !g.over) { stuck = true; break; }
    }
    assert(!stuck, "6p game never stalls");
    assert(g.over, "6p game reaches scoring");
    const scores = Dominion.engine.scoreAll(g);
    eq(scores.length, 6, "all six players scored");
  });
  t("ai: difficulty wired into setup is respected", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    Dominion.ai.setDifficulty("normal");
    const g = Dominion.engine.setup({ players: 2, seed: 5, aiDifficulty: { p2: "brutal" } });
    eq(Dominion.ai.difficultyFor(g, "p1"), "normal", "unset player falls back to the global difficulty");
    eq(Dominion.ai.difficultyFor(g, "p2"), "brutal", "per-player difficulty read from setup");
    Dominion.ai.setDifficulty("easy");
    eq(Dominion.ai.difficultyFor(g, "p2"), "brutal", "per-player overrides the global");
    eq(Dominion.ai.difficultyFor(g, "p1"), "easy", "fallback honors the global");
    Dominion.ai.setDifficulty("normal");
  });
  t("ai: buy decisions are deterministic for a fixed seed", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const run = () => {
      Dominion.ai.setDifficulty("normal");
      const g = Dominion.engine.setup({ players: 2, kingdom: ["village", "smithy", "market", "witch", "remodel"], seed: 9 });
      Dominion.engine.beginTurn(g, "p1");
      const p = Dominion.engine.player(g, "p1");
      p.hand = ["copper", "copper", "copper", "silver"];
      p.coins = 7;
      p.buys = 1;
      return Dominion.ai.chooseBuys(g, "p1")[0];
    };
    eq(run(), run(), "same seed → same buy decision");
  });

  /* ══════════════════ Tasks 54–55: setup + kingdom picker ══════ */
  t("setup: pickableCards excludes basic piles and potion", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const cards = Dominion.ui.pickableCards();
    assert(cards.length >= 25, "at least the base-kingdom pool, got " + cards.length);
    assert(cards.every((c) => c.inSupply), "all are supply cards");
    assert(cards.every((c) => Dominion.engine.BASIC_PILES.indexOf(c.id) === -1), "no basic piles");
    assert(cards.every((c) => c.id !== "potion"), "potion excluded from pickable");
  });
  t("setup: randomKingdom is seeded and expansion-filtered", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const a = Dominion.ui.randomKingdom(["base"], 42);
    const b = Dominion.ui.randomKingdom(["base"], 42);
    const c = Dominion.ui.randomKingdom(["base"], 43);
    eq(a.length, 10, "random kingdom is 10 cards");
    deepEq(a, b, "same seed → same kingdom");
    assert(a.join() !== c.join(), "different seed → different kingdom");
    const only = Dominion.ui.randomKingdom(["alchemy"], 42);
    assert(only.every((id) => Dominion.cards.get(id).expansion === "alchemy"), "alchemy-only pool");
    eq(only.length, 10, "alchemy pool has 12 cards, draws the 10-card maximum");
  });
  t("setup: kingdomExtras flags potion requirement", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const ex = Dominion.ui.kingdomExtras(["village", "smithy", "market", "witch"]);
    eq(ex.potion, false, "no potion needed without potion-cost cards");
    eq(ex.count, 4, "counts the kingdom");
    Dominion.cards.register({ id: "potion_card", name: "Potion Test", cost: { coins: 2, potion: 1 }, types: ["Action"], text: "test", expansion: "test", inSupply: true });
    assert(Dominion.ui.kingdomExtras(["potion_card"]).potion === true, "potion requirement surfaced");
  });

  /* ══════════════════ Task 56: card encyclopedia ═══════════════ */
  t("encyclopedia: catalog lists every registered card", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const list = Dominion.ui.encyclopediaCards();
    const all = Dominion.cards.all();
    eq(list.length, all.length, "encyclopedia covers the whole registry");
    const ids = new Set(list.map((c) => c.id));
    for (const c of all) assert(ids.has(c.id), "missing from encyclopedia: " + c.id);
  });
  t("encyclopedia: every registered card appears in the modal grid", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    if (typeof document === "undefined") return;
    const ctn = Dominion.ui.openEncyclopedia();
    try {
      const shown = new Set([...ctn.querySelectorAll(".encyc-cell")].map((c) => c.dataset.card));
      const expected = new Set(Dominion.cards.all().map((c) => c.id));
      eq(shown.size, expected.size, "grid size matches registry size");
      for (const id of expected) assert(shown.has(id), "card not rendered in encyclopedia: " + id);
    } finally {
      ctn.remove();
    }
  });
  t("encyclopedia: search and filters narrow the grid", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    if (typeof document === "undefined") return;
    const ctn = Dominion.ui.openEncyclopedia();
    try {
      const typeSel = ctn.querySelector(".picker-filters select");
      const shownFor = (value) => {
        typeSel.value = value;
        typeSel.dispatchEvent(new Event("change"));
        return [...ctn.querySelectorAll(".encyc-cell")].map((c) => c.dataset.card);
      };
      const attacks = shownFor("Attack");
      assert(attacks.length >= 4, "base-set attack cards exist, got " + attacks.length);
      assert(attacks.every((id) => Dominion.cards.get(id).types.indexOf("Attack") !== -1), "type filter only shows that type");
      const nonAttacks = shownFor("");
      assert(nonAttacks.length > attacks.length, "clearing the filter restores the grid");
    } finally {
      ctn.remove();
    }
  });

  /* ══════════════════ Task 57: rules & how-to-play ═════════════ */
  t("rules: turn structure covers all five phases in order", () => {
    const phases = Dominion.ui.turnStructure();
    eq(phases.length, 5, "five phases");
    deepEq(phases.map((p) => p.id), ["start", "action", "buy", "cleanup", "draw"], "official phase order");
    for (const p of phases) assert(p.title && p.body, p.id + " has title and body");
  });
  t("rules: glossary covers every engine keyword and card type", () => {
    const terms = new Set(Dominion.ui.glossary().map((g) => g.term.toLowerCase()));
    for (const t of Dominion.engine.CARD_TYPES) assert(terms.has(t.toLowerCase()), "card type missing from glossary: " + t);
    const required = ["gain", "trash", "reveal", "topdeck", "discard", "draw", "reshuffle", "hand", "deck", "supply", "pile", "empty pile", "cost", "coffers", "villagers", "debt", "vp tokens", "each other player", "set aside", "cleanup", "game end"];
    for (const r of required) assert(terms.has(r), "keyword missing from glossary: " + r);
  });
  t("rules: the rules modal renders the phases and every glossary term", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    if (typeof document === "undefined") return;
    const ctn = Dominion.ui.openRules();
    try {
      for (const ph of Dominion.ui.turnStructure()) assert(ctn.textContent.indexOf(ph.title) !== -1, "phase missing from modal: " + ph.title);
      for (const g of Dominion.ui.glossary()) assert(ctn.textContent.indexOf(g.term) !== -1, "term missing from modal: " + g.term);
    } finally {
      ctn.remove();
    }
  });

  /* ══════════════════ Task 58: first-turn onboarding ═══════════ */
  t("onboarding: step data is complete and well-formed", () => {
    const steps = Dominion.ui.onboardingSteps();
    assert(steps.length >= 5, "guides the full first turn, got " + steps.length);
    const ids = new Set(steps.map((s) => s.id));
    eq(ids.size, steps.length, "step ids are unique");
    for (const s of steps) assert(s.title && s.body && s.target, "step has title/body/target: " + s.id);
  });
  t("onboarding: a scripted first turn completes the tutorial", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    if (typeof document === "undefined") return;
    const g = Dominion.engine.setup({ players: 2, kingdom: ["village", "smithy", "market", "witch", "remodel", "moat", "moneylender", "cellar", "chapel", "bandit"], seed: 77 });
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.player(g, "p1").hand = ["village", "copper", "copper", "copper", "copper"];
    const rootEl = document.createElement("div");
    document.body.appendChild(rootEl);
    try {
      Dominion.ui.mount(rootEl, g, { humanId: "p1" });
      const ctl = Dominion.ui.startOnboarding(rootEl, g, "p1");
      eq(ctl.index, 0, "starts at the intro step");
      assert(!ctl.finished, "not finished at start");
      Dominion.engine.actions.play(g, "p1", { cardId: "village" });
      Dominion.ui.update(g);
      assert(ctl.index >= 1, "playing an action advances past the hand step");
      Dominion.engine.treasures.playAll(g, "p1");
      Dominion.engine.advancePhase(g);
      Dominion.ui.update(g);
      assert(ctl.index >= 2, "entering the buy phase advances past treasures");
      Dominion.engine.buy(g, "p1", "smithy");
      Dominion.ui.update(g);
      assert(ctl.index >= 3, "buying a card advances past the buy step");
      Dominion.engine.advancePhase(g);
      Dominion.ui.update(g);
      assert(ctl.finished, "ending the turn completes the tutorial");
    } finally {
      rootEl.remove();
    }
  });

  /* ══════════════════ Task 59: seeded kingdoms & URLs ══════════ */
  t("url: parseKingdomString validates and normalizes ids", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    deepEq(Dominion.ui.parseKingdomString("village,smithy,market,witch,remodel,moat,moneylender,cellar,chapel,bandit"),
      ["village", "smithy", "market", "witch", "remodel", "moat", "moneylender", "cellar", "chapel", "bandit"], "plain list parses");
    deepEq(Dominion.ui.parseKingdomString(" Village ; Smithy\nMarket,cellar "), ["village", "smithy", "market", "cellar"], "mixed separators, lowercased");
    eq(Dominion.ui.parseKingdomString("village,bogus_card"), null, "unknown card rejected");
    eq(Dominion.ui.parseKingdomString("copper,silver,gold"), null, "basic piles rejected");
    eq(Dominion.ui.parseKingdomString("potion"), null, "potion rejected");
    eq(Dominion.ui.parseKingdomString("village,village,smithy,market,witch,remodel,moat,moneylender,cellar,chapel,bandit"), null, "duplicate rejected");
    eq(Dominion.ui.parseKingdomString(""), null, "empty rejected");
    eq(Dominion.ui.parseKingdomString(null), null, "null rejected");
  });
  t("url: kingdomQuery and kingdomFromParams round-trip exactly", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const kingdom = ["village", "smithy", "market", "witch", "remodel", "moat", "moneylender", "cellar", "chapel", "bandit"];
    const q = Dominion.ui.kingdomQuery({ kingdom: kingdom, seed: 12345 });
    eq(q, "kingdom=village,smithy,market,witch,remodel,moat,moneylender,cellar,chapel,bandit&seed=12345", "query format");
    const parsed = Dominion.ui.kingdomFromParams("?" + q);
    deepEq(parsed.kingdom, kingdom, "search string round-trips");
    eq(parsed.seed, 12345, "seed round-trips");
    const viaHash = Dominion.ui.kingdomFromParams("#" + q);
    deepEq(viaHash.kingdom, kingdom, "hash string round-trips too");
    eq(Dominion.ui.kingdomFromParams("?kingdom=nonsense").kingdom, null, "garbage rejected");
  });
  t("url: same seed re-creates the same kingdom and opening hands deterministically", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const kingdom = ["village", "smithy", "market", "witch", "remodel", "moat", "moneylender", "cellar", "chapel", "bandit"];
    const q = Dominion.ui.kingdomQuery({ kingdom: kingdom, seed: 4242 });
    const parsed = Dominion.ui.kingdomFromParams("?" + q);
    const a = Dominion.engine.setup({ players: 2, kingdom: parsed.kingdom, seed: parsed.seed });
    const b = Dominion.engine.setup({ players: 2, kingdom: parsed.kingdom, seed: parsed.seed });
    for (const id of kingdom) eq(a.supply[id], 10, "pile present for " + id);
    deepEq(a.supply, b.supply, "identical supply");
    deepEq(a.players[0].hand, b.players[0].hand, "same seed → same opening hand");
    deepEq(a.players[1].deck, b.players[1].deck, "same seed → same shuffle order");
  });

  /* ══════════════════ Task 60: autosave & resume ═══════════════ */
  const PERSIST_KINGDOM = ["village", "smithy", "market", "witch", "remodel", "moat", "moneylender", "cellar", "chapel", "bandit"];
  function midTurnGame(seed) {
    const g = Dominion.engine.setup({ players: 2, kingdom: PERSIST_KINGDOM, seed: seed });
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.player(g, "p1").hand = ["village", "copper", "copper", "copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "village" });
    Dominion.engine.treasures.playAll(g, "p1");
    return g;
  }
  t("persist: serialize/deserialize round-trips a mid-turn game exactly", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = midTurnGame(99);
    const s1 = Dominion.engine.serialize(g);
    assert(!("rand" in s1) && !("decide" in s1), "functions are stripped from the snapshot");
    const g2 = Dominion.engine.deserialize(s1);
    const s2 = Dominion.engine.serialize(g2);
    deepEq(s2, s1, "restored state matches the saved state exactly");
    eq(g2.phase, g.phase, "phase preserved");
    eq(g2.players[0].play.join(), g.players[0].play.join(), "play area preserved");
    deepEq(g2.supply, g.supply, "supply preserved");
    Dominion.engine.advancePhase(g2);
    eq(g2.phase, "buy", "resumed game can keep playing");
  });
  t("persist: a resumed game continues the same deterministic rng stream", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const s = Dominion.engine.serialize(midTurnGame(123));
    const a = Dominion.engine.deserialize(s);
    const b = Dominion.engine.deserialize(s);
    deepEq(a.rand.shuffle(["x", "y", "z", "w", "v", "u"]), b.rand.shuffle(["x", "y", "z", "w", "v", "u"]), "same save → same rng stream");
    deepEq(Dominion.engine.serialize(a), Dominion.engine.serialize(b), "two resumes of one save are identical");
  });
  t("persist: kv autosave writes and resumes a mid-turn game", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    if (typeof root === "undefined" || !root.kv) return;
    const folder = root.kv.dominion;
    await folder.delete("game");
    try {
      const g = midTurnGame(2024);
      const rec = { saved: Dominion.engine.serialize(g), humanId: "p1", savedAt: Date.now() };
      await folder.set("game", rec);
      const got = await folder.get("game");
      deepEq(got.saved, rec.saved, "saved record survives the kv round-trip");
      const restored = Dominion.engine.deserialize(got.saved);
      deepEq(Dominion.engine.serialize(restored), rec.saved, "resume restores the mid-turn game exactly");
      const play = Dominion.engine.player(restored, "p1").play;
      eq(play[0], "village", "the played Action is in the play area after resume");
      eq(play.length, 5, "village plus the four played Coppers are all in play");
    } finally {
      await folder.delete("game");
    }
  });

  /* ══════════════════ Task 61: settings persistence ═══════════════ */
  t("settings: defaults, save and reload survive localStorage", () => {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem("dominion.settings");
    const d = Dominion.ui.loadSettings();
    eq(d.theme, "dark", "default theme");
    eq(d.animations, true, "default animations on");
    eq(d.sound, false, "default sound off");
    assert(Array.isArray(d.defaultExpansions) && d.defaultExpansions.length > 0, "default expansions list present");
    Dominion.ui.saveSettings({ theme: "light", animations: false, sound: false, defaultExpansions: ["intrigue"] });
    const s = Dominion.ui.loadSettings();
    eq(s.theme, "light", "theme persisted");
    eq(s.animations, false, "animations persisted");
    eq(s.sound, false, "sound persisted");
    deepEq(s.defaultExpansions, ["intrigue"], "default expansions persisted");
    Dominion.ui.saveSettings({ theme: "dark", animations: true, sound: true, defaultExpansions: ["base", "intrigue"] });
  });
  t("settings: corrupt stored JSON falls back to defaults", () => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("dominion.settings", "{not json");
    const s = Dominion.ui.loadSettings();
    eq(s.theme, "dark", "fallback to default theme");
    eq(s.sound, false, "fallback to default sound");
    localStorage.removeItem("dominion.settings");
  });
  t("settings: applySettings toggles body theme and animation classes", () => {
    if (typeof document === "undefined") return;
    Dominion.ui.saveSettings({ theme: "light", animations: false });
    const s = Dominion.ui.applySettings();
    eq(s.theme, "light", "applySettings returns the applied settings");
    assert(document.body.classList.contains("theme-light"), "light theme class applied");
    assert(document.body.classList.contains("no-anim"), "no-anim class applied");
    Dominion.ui.saveSettings({ theme: "dark", animations: true });
    Dominion.ui.applySettings();
    assert(!document.body.classList.contains("theme-light"), "dark theme class removed");
    assert(!document.body.classList.contains("no-anim"), "animations restored");
  });
  t("settings: setup panel checkboxes start from the saved default set", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    if (typeof document === "undefined") return;
    Dominion.ui.saveSettings({ defaultExpansions: ["intrigue"] });
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const panel = Dominion.ui.setupPanel(host, {});
      const checked = [...panel.querySelectorAll(".setup-chk input[type=checkbox]")].filter((cb) => cb.checked).map((cb) => cb.value);
      deepEq(checked, ["intrigue"], "only the saved default expansions are pre-checked");
    } finally {
      host.remove();
      Dominion.ui.saveSettings({ defaultExpansions: ["base", "intrigue"] });
    }
  });

  /* ══════════════════ Task 62: saved kingdoms & stats ════════════ */
  function fakeKvFolder() {
    const store = {};
    return {
      store: store,
      folder: {
        async get(k) { return k in store ? JSON.parse(JSON.stringify(store[k])) : undefined; },
        async set(k, v) { store[k] = JSON.parse(JSON.stringify(v)); },
        async delete(k) { delete store[k]; }
      }
    };
  }
  t("saved-kingdoms: favorites save, load, list and delete via kv entries", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const fake = fakeKvFolder();
    const orig = Dominion.ui.kvFolder;
    Dominion.ui.kvFolder = () => fake.folder;
    try {
      const kingdom = ["village", "smithy", "market", "witch", "remodel", "moat", "moneylender", "cellar", "chapel", "bandit"];
      const name = await Dominion.ui.saveFavorite(kingdom, 1234);
      eq(name, "Kingdom 1", "first favorite is named Kingdom 1");
      const list = await Dominion.ui.favoriteKingdoms();
      eq(list.length, 1, "one favorite saved");
      deepEq(list[0].kingdom, kingdom, "kingdom stored verbatim");
      eq(list[0].seed, 1234, "seed stored");
      const loaded = await Dominion.ui.loadFavorite(name);
      deepEq(loaded.kingdom, kingdom, "favorite loads back");
      await Dominion.ui.saveFavorite(["duke"], null);
      eq((await Dominion.ui.favoriteKingdoms()).length, 2, "second favorite saved");
      await Dominion.ui.deleteFavorite(name);
      const after = await Dominion.ui.favoriteKingdoms();
      eq(after.length, 1, "delete removes exactly one favorite");
      eq(after[0].name, "Kingdom 2", "the other favorite remains");
      assert(fake.store.kingdoms, "kv entry 'kingdoms' was written (validate via kv entries)");
    } finally {
      Dominion.ui.kvFolder = orig;
    }
  });
  t("stats: finished games record win/loss and score per difficulty", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const fake = fakeKvFolder();
    const orig = Dominion.ui.kvFolder;
    Dominion.ui.kvFolder = () => fake.folder;
    try {
      const g = Dominion.engine.setup({ players: 2, kingdom: PERSIST_KINGDOM, seed: 33 });
      g.aiDifficulty = { p2: "normal" };
      Dominion.engine.beginTurn(g, "p1");
      g.over = true;
      Dominion.engine.player(g, "p1").deck = ["province", "province", "province"];
      Dominion.engine.player(g, "p1").hand = [];
      Dominion.engine.player(g, "p2").deck = [];
      Dominion.engine.player(g, "p2").hand = [];
      await Dominion.ui.recordResult(g);
      const stats = await Dominion.ui.playerStats();
      eq(stats.games, 1, "one game recorded");
      assert(stats.perDifficulty.normal, "recorded under difficulty normal");
      eq(stats.perDifficulty.normal.games, 1, "one normal game");
      eq(stats.perDifficulty.normal.wins, 1, "human scored highest → win recorded");
      eq(stats.perDifficulty.normal.losses, 0, "no losses");
      eq(stats.perDifficulty.normal.best, 18, "best score tracked (3 Provinces)");
      assert(fake.store.stats, "kv entry 'stats' was written (validate via kv entries)");
      const g2 = Dominion.engine.setup({ players: 2, kingdom: PERSIST_KINGDOM, seed: 34 });
      g2.aiDifficulty = { p2: "brutal" };
      Dominion.engine.beginTurn(g2, "p1");
      g2.over = true;
      Dominion.engine.player(g2, "p1").deck = [];
      Dominion.engine.player(g2, "p1").hand = [];
      Dominion.engine.player(g2, "p2").deck = ["province", "province", "province", "province"];
      Dominion.engine.player(g2, "p2").hand = [];
      await Dominion.ui.recordResult(g2);
      const s2 = await Dominion.ui.playerStats();
      eq(s2.games, 2, "two games recorded");
      eq(s2.perDifficulty.brutal.losses, 1, "loss recorded under brutal");
      eq(s2.perDifficulty.brutal.wins, 0, "no brutal wins");
      eq(s2.perDifficulty.brutal.avgScore, 0, "average score of the loss");
    } finally {
      Dominion.ui.kvFolder = orig;
    }
  });

  /* ══════════════════ Task 63: export/import ═════════════════════ */
  t("export: JSON round-trips a mid-turn game exactly", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = midTurnGame(7);
    const json = Dominion.ui.exportJSON(g);
    assert(json.indexOf("village") !== -1, "export contains the played card");
    const g2 = Dominion.ui.gameFromJSON(json);
    deepEq(Dominion.engine.serialize(g2), Dominion.engine.serialize(g), "export → import round-trip is byte-exact");
    eq(g2.phase, g.phase, "phase preserved");
    eq(g2.players[0].actionsPlayed, 1, "actionsPlayed counter survives the round trip");
  });
  t("export: malformed or foreign JSON is rejected", () => {
    let threw = false;
    try { Dominion.ui.gameFromJSON("{nope"); } catch (e) { threw = true; }
    assert(threw, "invalid JSON rejected");
    threw = false;
    try { Dominion.ui.gameFromJSON(JSON.stringify({ hello: 1 })); } catch (e) { threw = true; }
    assert(threw, "JSON without a game version rejected");
    threw = false;
    try { Dominion.ui.gameFromJSON(null); } catch (e) { threw = true; }
    assert(threw, "null rejected");
  });

  /* ══════════════════ Task 64: Intrigue 2E catalog ═══════════════ */
  t("intrigue: catalog pins all 26 official 2E kingdom cards", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const set = Dominion.cards.byExpansion("intrigue").filter((c) => c.inSupply);
    eq(set.length, 26, "Intrigue 2E has 26 kingdom cards");
    const byId = {};
    for (const c of set) byId[c.id] = c;
    const expect = {
      baron: { cost: 4, types: ["Action"] },
      bridge: { cost: 4, types: ["Action"] },
      conspirator: { cost: 4, types: ["Action"] },
      courtier: { cost: 5, types: ["Action"] },
      courtyard: { cost: 2, types: ["Action"] },
      diplomat: { cost: 4, types: ["Action", "Reaction"] },
      duke: { cost: 5, types: ["Victory"] },
      harem: { cost: 6, types: ["Treasure", "Victory"] },
      ironworks: { cost: 4, types: ["Action"] },
      lurker: { cost: 2, types: ["Action"] },
      masquerade: { cost: 3, types: ["Action"] },
      mill: { cost: 4, types: ["Action", "Victory"] },
      mining_village: { cost: 4, types: ["Action"] },
      minion: { cost: 5, types: ["Action", "Attack"] },
      nobles: { cost: 6, types: ["Action", "Victory"] },
      patrol: { cost: 5, types: ["Action"] },
      pawn: { cost: 2, types: ["Action"] },
      replace: { cost: 5, types: ["Action", "Attack"] },
      secret_passage: { cost: 4, types: ["Action"] },
      shanty_town: { cost: 3, types: ["Action"] },
      steward: { cost: 3, types: ["Action"] },
      swindler: { cost: 3, types: ["Action", "Attack"] },
      torturer: { cost: 5, types: ["Action", "Attack"] },
      trading_post: { cost: 5, types: ["Action"] },
      upgrade: { cost: 5, types: ["Action"] },
      wishing_well: { cost: 3, types: ["Action"] }
    };
    deepEq(Object.keys(byId).sort(), Object.keys(expect).sort(), "exactly the official 2E roster");
    for (const id of Object.keys(expect)) {
      const c = byId[id];
      assert(c, "card present: " + id);
      eq(c.cost.coins, expect[id].cost, id + " cost");
      eq(c.cost.potion, 0, id + " has no potion cost");
      eq(c.types.length, expect[id].types.length, id + " exact type count");
      for (const t of expect[id].types) assert(c.types.indexOf(t) !== -1, id + " has type " + t);
      assert(c.text && c.text.length > 5, id + " has official text");
      eq(c.pileSize, 10, id + " default pile size");
    }
    assert(!byId.farmland, "Farmland is NOT an Intrigue card (it belongs to Hinterlands)");
    assert(!byId.patron, "Patron is NOT in Intrigue 2E — Patrol is the real 2E card");
    assert(!byId.secret_chamber && !byId.great_hall && !byId.coppersmith && !byId.scout && !byId.saboteur && !byId.tribute,
      "all six 1E-only cards are absent");
    eq(byId.duke.vp, null, "Duke scores dynamically via the vp registry");
    eq(byId.harem.treasure, 2, "Harem produces +$2");
    eq(byId.harem.vp, 2, "Harem is worth 2 VP");
    eq(byId.mill.vp, 1, "Mill is worth 1 VP");
    eq(byId.nobles.vp, 2, "Nobles is worth 2 VP");
    eq(byId.conspirator.text.indexOf("+$2") !== -1, true, "Conspirator pins the official +$2 (not the roadmap's +$1)");
  });

  /* ══════════════════ Task 162: Cornucopia catalog ══════════════ */
  t("cornucopia: catalog pins all 13 official kingdom cards plus the 5 Prizes", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const set = Dominion.cards.byExpansion("cornucopia").filter((c) => c.inSupply);
    eq(set.length, 13, "Cornucopia has 13 kingdom cards");
    const byId = {};
    for (const c of set) byId[c.id] = c;
    const expect = {
      fairgrounds: { cost: 6, types: ["Victory"] },
      farming_village: { cost: 4, types: ["Action"] },
      fortune_teller: { cost: 3, types: ["Action", "Attack"] },
      hamlet: { cost: 2, types: ["Action"] },
      harvest: { cost: 5, types: ["Action"] },
      horn_of_plenty: { cost: 5, types: ["Treasure"] },
      horse_traders: { cost: 4, types: ["Action", "Reaction"] },
      hunting_party: { cost: 5, types: ["Action"] },
      jester: { cost: 5, types: ["Action", "Attack"] },
      menagerie: { cost: 3, types: ["Action"] },
      remake: { cost: 4, types: ["Action"] },
      tournament: { cost: 4, types: ["Action"] },
      young_witch: { cost: 4, types: ["Action", "Attack"] }
    };
    deepEq(Object.keys(byId).sort(), Object.keys(expect).sort(), "exactly the official roster");
    for (const id of Object.keys(expect)) {
      const c = byId[id];
      assert(c, "card present: " + id);
      eq(c.cost.coins, expect[id].cost, id + " cost");
      eq(c.cost.potion, 0, id + " has no potion cost");
      eq(c.types.length, expect[id].types.length, id + " exact type count");
      for (const t of expect[id].types) assert(c.types.indexOf(t) !== -1, id + " has type " + t);
      assert(c.text && c.text.length > 5, id + " has official text");
    }
    const prizes = Dominion.cards.byExpansion("cornucopia").filter((c) => !c.inSupply);
    eq(prizes.length, 5, "exactly the 5 Prizes (Tournament's non-supply pile)");
    deepEq(prizes.map((c) => c.id).sort(), ["bag_of_gold", "diadem", "followers", "princess", "trusty_steed"], "Prize roster");
    for (const c of prizes) {
      eq(c.cost.coins, 0, c.id + " costs $0");
      assert(c.types.indexOf("Prize") !== -1, c.id + " is a Prize");
    }
    /* Official-text corrections vs the roadmap (tasks 164-176) */
    eq(byId.fairgrounds.text.indexOf("per 5 differently named") !== -1, true,
      "Fairgrounds pins the official per-5 formula (not the roadmap's 'per 10')");
    eq(byId.fairgrounds.vp, null, "Fairgrounds scores via the dynamic vp registry");
    deepEq(byId.fairgrounds.pileSize, { 2: 8, 3: 12 }, "Victory pile is 8 (2p) / 12 (3p+)");
    eq(byId.harvest.cost.coins, 5, "Harvest costs $5 (roadmap said $4)");
    assert(byId.harvest.text.indexOf("Reveal the top 4") !== -1, "Harvest reveals the top 4, not the roadmap's 'reveal hand'");
    assert(byId.fortune_teller.text.indexOf("+$2") !== -1 && byId.fortune_teller.text.indexOf("Victory card or a Curse") !== -1,
      "Fortune Teller pins +$2 reveal-until-Victory/Curse (not the roadmap's top-2)");
    assert(byId.hamlet.text.indexOf("+1 Action; You may discard a card") !== -1,
      "Hamlet gives +1 Action (roadmap said +2)");
    assert(byId.farming_village.text.indexOf("until you reveal a Treasure or Action card") !== -1,
      "Farming Village digs until an Action/Treasure (not the roadmap's top-3)");
    assert(byId.horse_traders.text.indexOf("set this aside") !== -1,
      "Horse Traders' Reaction sets itself aside (not the roadmap's discard-2-draw-2)");
    assert(byId.young_witch.text.indexOf("Discard 2 cards") !== -1, "Young Witch pins 'discard 2 cards' (omitted in the roadmap)");
    assert(byId.tournament.text.indexOf("or a Duchy") !== -1 && byId.tournament.text.indexOf("+1 Card and +$1") !== -1,
      "Tournament pins the Duchy fallback and the +1 Card/+$1 bonus");
    assert(byId.jester.text.indexOf("If it's a Victory card") !== -1, "Jester pins the Victory→Curse rule");
    assert(byId.horn_of_plenty.text.indexOf("per differently named card you have in play") !== -1,
      "Horn of Plenty budgets by differently named cards in play (not the roadmap's 'no duplicates')");
    /* Pinned catalog and the in-development copy must agree on the roster */
    const pinned = await fetch("src/data/cornucopia.json").then((r) => r.json());
    const dev = await fetch("src/exp/cornucopia/data.json").then((r) => r.json());
    deepEq(pinned.cards.map((c) => c.id).sort(), dev.cards.map((c) => c.id).sort(),
      "src/data and src/exp catalogs agree on the roster");
  });
  t("menagerie: catalog pins all 30 official kingdom cards plus Horse and the 20 Ways", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "seaside", "prosperity", "cornucopia", "hinterlands", "menagerie"]);
    const set = Dominion.cards.byExpansion("menagerie").filter((c) => c.inSupply);
    eq(set.length, 30, "Menagerie has 30 kingdom cards");
    const byId = {};
    for (const c of set) byId[c.id] = c;
    const expect = {
      animal_fair: { cost: 7, types: ["Action"] },
      barge: { cost: 5, types: ["Action", "Duration"] },
      black_cat: { cost: 2, types: ["Action", "Attack", "Reaction"] },
      bounty_hunter: { cost: 4, types: ["Action"] },
      camel_train: { cost: 3, types: ["Action"] },
      cardinal: { cost: 4, types: ["Action", "Attack"] },
      cavalry: { cost: 4, types: ["Action"] },
      coven: { cost: 5, types: ["Action", "Attack"] },
      destrier: { cost: 6, types: ["Action"] },
      displace: { cost: 5, types: ["Action"] },
      falconer: { cost: 5, types: ["Action", "Reaction"] },
      fisherman: { cost: 5, types: ["Action"] },
      gatekeeper: { cost: 5, types: ["Action", "Duration", "Attack"] },
      goatherd: { cost: 3, types: ["Action"] },
      groom: { cost: 4, types: ["Action"] },
      hostelry: { cost: 4, types: ["Action"] },
      hunting_lodge: { cost: 5, types: ["Action"] },
      kiln: { cost: 5, types: ["Action"] },
      livery: { cost: 5, types: ["Action"] },
      mastermind: { cost: 5, types: ["Action", "Duration"] },
      paddock: { cost: 5, types: ["Action"] },
      sanctuary: { cost: 5, types: ["Action"] },
      scrap: { cost: 3, types: ["Action"] },
      sheepdog: { cost: 3, types: ["Action", "Reaction"] },
      sleigh: { cost: 2, types: ["Action", "Reaction"] },
      snowy_village: { cost: 3, types: ["Action"] },
      stockpile: { cost: 3, types: ["Treasure"] },
      supplies: { cost: 2, types: ["Treasure"] },
      village_green: { cost: 4, types: ["Action", "Duration", "Reaction"] },
      wayfarer: { cost: 6, types: ["Action"] }
    };
    deepEq(Object.keys(byId).sort(), Object.keys(expect).sort(), "exactly the official roster");
    for (const id of Object.keys(expect)) {
      const c = byId[id];
      assert(c, "card present: " + id);
      eq(c.cost.coins, expect[id].cost, id + " cost");
      eq(c.cost.potion, 0, id + " has no potion cost");
      eq(c.types.length, expect[id].types.length, id + " exact type count");
      for (const t of expect[id].types) assert(c.types.indexOf(t) !== -1, id + " has type " + t);
      assert(c.text && c.text.length > 5, id + " has official text");
    }
    /* Non-supply pieces */
    const horse = Dominion.cards.get("horse");
    assert(horse, "Horse is registered");
    eq(horse.inSupply, false, "Horse is not in the Supply");
    eq(horse.pileSize, 30, "Horse pile has 30 copies");
    eq(horse.types.indexOf("Action") !== -1, true, "Horse is an Action");
    assert(horse.text.indexOf("Return this to its pile") !== -1, "Horse returns to its pile");
    const ways = Dominion.cards.byExpansion("menagerie").filter((c) => c.types.indexOf("Way") !== -1);
    eq(ways.length, 20, "exactly the 20 Ways");
    const wayIds = ways.map((c) => c.id).sort();
    deepEq(wayIds.slice(0, 3), ["way_of_the_butterfly", "way_of_the_camel", "way_of_the_chameleon"], "Way roster begins as expected");
    for (const c of ways) {
      eq(c.cost.coins, 0, c.id + " has no coin cost (landscape)");
      eq(c.inSupply, false, c.id + " is not in the Supply");
      assert(c.text && c.text.length > 2, c.id + " has official text");
    }
    /* Spot-check the roadmap's mis-stated card texts (tasks 397-416 marked 'per pinned text') */
    assert(byId.supplies.text.indexOf("Gain a Horse onto your deck") !== -1, "Supplies gains a Horse onto the deck");
    eq(byId.supplies.treasure, 1, "Supplies gives $1");
    eq(byId.stockpile.treasure, 3, "Stockpile gives $3");
    assert(byId.stockpile.text.indexOf("Exile this") !== -1, "Stockpile Exiles itself");
    assert(byId.black_cat.text.indexOf("gains a Curse") !== -1, "Black Cat Curses on others' turns");
    assert(byId.cavalry.text.indexOf("return to your Action phase") !== -1, "Cavalry returns to Action phase");
    assert(byId.mastermind.text.indexOf("three times") !== -1, "Mastermind plays an Action three times");
    assert(byId.scrap.text.indexOf("per $1 it costs") !== -1, "Scrap chooses per cost");
    assert(byId.groom.text.indexOf("If it's an Action card, gain a Horse") !== -1, "Groom's conditional gains");
    assert(byId.fisherman.text.indexOf("this costs $3 less") !== -1, "Fisherman is cheaper with empty discard");
    assert(byId.destrier.text.indexOf("$1 less per card you've gained") !== -1, "Destrier scales down per gained card");
    assert(byId.animal_fair.text.indexOf("trash an Action card from your hand") !== -1, "Animal Fair's alternate payment");
    assert(byId.wayfarer.text.indexOf("same cost as the last other card gained") !== -1, "Wayfarer copies the last gained cost");
    assert(byId.village_green.text.indexOf("When you discard this other than during Clean-up") !== -1, "Village Green's discard reaction");
    assert(byId.barge.text.indexOf("Either now or at the start of your next turn") !== -1, "Barge is a choice Duration");
    /* Pinned catalog matches the in-development copy if it exists (roster only) */
    const pinned = await fetch("src/data/menagerie.json").then((r) => r.json());
    const devFetch = await fetch("src/exp/menagerie/data.json").then((r) => r.json()).catch(() => null);
    if (devFetch) {
      deepEq(pinned.cards.map((c) => c.id).sort(), devFetch.cards.map((c) => c.id).sort(),
        "src/data and src/exp catalogs agree on the roster");
    }
  });
  t("baron: discarding an Estate gives +$4 and +1 Buy", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["baron", "smithy"], seed: 8 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["baron", "estate", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "baronDiscard" ? true : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "baron" });
    eq(p.buys, 2, "baron gives +1 Buy");
    eq(p.coins, 4, "discarding the Estate gives +$4");
    eq(p.hand.join(), "copper,copper,copper", "the Estate left the hand");
    eq(p.discard[p.discard.length - 1], "estate", "the Estate went to the discard");
    eq(g.supply.estate, 8, "no Estate gained from the supply");
  });
  t("baron: without discarding, gain an Estate (and the bot defaults to discarding when it can)", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["baron", "smithy"], seed: 9 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["baron", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "baronDiscard" ? false : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "baron" });
    eq(p.coins, 0, "no +$4 without a discard");
    eq(p.discard[p.discard.length - 1], "estate", "an Estate was gained");
    eq(g.supply.estate, 7, "the Estate came from the supply");
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["baron", "smithy"], seed: 10 });
    Dominion.engine.beginTurn(g2, "p1");
    Dominion.engine.player(g2, "p1").hand = ["baron", "estate", "copper", "copper", "copper"];
    Dominion.engine.actions.play(g2, "p1", { cardId: "baron" });
    eq(Dominion.engine.player(g2, "p1").coins, 4, "default bot decision discards the Estate for +$4");
  });

  /* ══════════════════ Task 65: Conspirator ═══════════════════════ */
  t("conspirator: +$2 base, bonus only once 3+ Actions have been played", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["village", "conspirator", "smithy"], seed: 5 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.deck = ["copper", "copper", "copper", "copper", "copper"];
    p.hand = ["conspirator", "conspirator", "village", "smithy", "copper"];
    p.actions = 3;
    Dominion.engine.actions.play(g, "p1", { cardId: "conspirator" });
    eq(p.coins, 2, "first conspirator: +$2 only");
    eq(p.actionsPlayed, 1, "counter includes the conspirator itself");
    eq(p.hand.length, 4, "no bonus draw below 3 actions played");
    Dominion.engine.actions.play(g, "p1", { cardId: "village" });
    eq(p.actions, 3, "village still plays normally");
    Dominion.engine.actions.play(g, "p1", { cardId: "conspirator" });
    eq(p.coins, 4, "second conspirator: +$2");
    eq(p.actionsPlayed, 3, "three actions played this turn");
    eq(p.hand.length, 4, "bonus drew 1 card");
    eq(p.actions, 3, "bonus +1 Action on top of the one just spent");
  });
  t("conspirator: counts Throne Room double-plays and resets each turn", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["village", "conspirator", "throne_room"], seed: 6 });
    g.decide = (s, q) => (q.type === "playActionTwice" ? "village" : null);
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.deck = ["copper", "copper", "copper", "copper", "copper", "copper"];
    p.hand = ["throne_room", "village", "conspirator", "copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "throne_room" });
    eq(p.actionsPlayed, 3, "throne room (1) + village twice (2) = 3 plays");
    eq(p.actions, 4, "village played twice gives +4 Actions");
    eq(p.hand.length, 5, "village twice drew 2 cards");
    Dominion.engine.actions.play(g, "p1", { cardId: "conspirator" });
    eq(p.coins, 2, "conspirator +$2");
    eq(p.actionsPlayed, 4, "four actions played this turn");
    eq(p.hand.length, 5, "conspirator bonus (+1 Card) applies at 3+ plays");
    eq(p.actions, 4, "conspirator bonus (+1 Action) applies");
    Dominion.engine.beginTurn(g, "p2");
    eq(Dominion.engine.player(g, "p2").actionsPlayed, 0, "counter starts fresh for the next player");
    Dominion.engine.beginTurn(g, "p1");
    eq(Dominion.engine.player(g, "p1").actionsPlayed, 0, "counter resets on the player's next turn");
  });

  /* ══════════════════ Task 66: Courtier ═══════════════════════════ */
  t("courtier: reveals a card and maps each type to a distinct bonus", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["courtier", "minion", "smithy"], seed: 21 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["courtier", "minion", "copper", "copper", "copper"];
    const queue = ["coins", "action"];
    g.decide = (s, q) => {
      if (q.type === "revealCard") return p.hand.indexOf("minion");
      if (q.type === "courtierChoice") return queue.shift() || null;
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "courtier" });
    eq(p.coins, 3, "+$3 chosen for one type");
    eq(p.actions, 1, "+1 Action chosen for the other type (spent 1, gained 1)");
    eq(p.buys, 1, "no +1 Buy chosen");
    assert(g.log.some((e) => e.t === "reveal" && e.card === "minion"), "the revealed card was logged");
  });
  t("courtier: the gain-a-Gold option takes from the supply", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["courtier", "harem", "smithy"], seed: 22 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["courtier", "harem", "copper", "copper", "copper"];
    const queue = ["gold", "coins"];
    g.decide = (s, q) => {
      if (q.type === "revealCard") return p.hand.indexOf("harem");
      if (q.type === "courtierChoice") return queue.shift() || null;
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "courtier" });
    eq(p.discard[p.discard.length - 1], "gold", "a Gold was gained");
    eq(g.supply.gold, 29, "Gold came from the supply");
    eq(p.coins, 3, "+$3 from the second (Treasure) choice");
  });
  t("courtier: a bonus cannot be chosen twice for one card", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["courtier", "minion", "smithy"], seed: 23 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["courtier", "minion", "copper", "copper", "copper"];
    g.decide = (s, q) => {
      if (q.type === "revealCard") return p.hand.indexOf("minion");
      if (q.type === "courtierChoice") return "coins";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "courtier" });
    eq(p.coins, 3, "only the first +$3 applies");
    eq(p.actions, 0, "the second type gets nothing — the bonus was already used");
  });

  /* ══════════════════ Task 67: Courtyard ═════════════════════════ */
  t("courtyard: draws 3 and topdecks the chosen card", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["courtyard", "smithy"], seed: 24 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["courtyard", "copper", "copper", "copper", "copper"];
    p.deck = ["silver", "gold", "estate", "copper"];
    g.decide = (s, q) => (q.type === "courtyardTopdeck" ? 0 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "courtyard" });
    eq(p.hand.length, 6, "drew 3 then put one back");
    eq(p.deck[p.deck.length - 1], "copper", "the chosen card is on top of the deck");
    eq(p.deck[p.deck.length - 2], "silver", "the rest of the deck is below it");
    assert(p.hand.indexOf("copper") !== -1, "the other Coppers stayed in hand");
  });

  /* ══════════════════ Task 68: Diplomat ══════════════════════════ */
  t("diplomat: +2 Actions when 5 or fewer cards are in hand after drawing", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["diplomat", "smithy"], seed: 25 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["diplomat", "copper", "copper"];
    p.deck = ["silver", "gold"];
    Dominion.engine.actions.play(g, "p1", { cardId: "diplomat" });
    eq(p.hand.length, 4, "drew 2 cards");
    eq(p.actions, 2, "+2 Actions at 4 cards in hand");
  });
  t("diplomat: no bonus with 6 or more cards after drawing", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["diplomat", "smithy"], seed: 26 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["diplomat", "copper", "copper", "copper", "copper"];
    p.deck = ["silver", "gold"];
    Dominion.engine.actions.play(g, "p1", { cardId: "diplomat" });
    eq(p.hand.length, 6, "drew 2 → 6 cards");
    eq(p.actions, 0, "no bonus at 6 cards");
  });
  t("diplomat: reaction to an Attack from a 5+ hand draws 2 then discards 3", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["diplomat", "witch", "smithy"], seed: 27 });
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.player(g, "p1").hand = ["witch", "copper", "copper", "copper", "copper"];
    Dominion.engine.player(g, "p1").deck = ["silver"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["diplomat", "copper", "copper", "copper", "copper"];
    p2.deck = ["gold", "silver", "estate", "estate"];
    g.decide = (s, q) => {
      if (q.type === "react") return ["diplomat"];
      if (q.type === "diplomatDiscard") return [0, 1, 2];
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    eq(p2.hand.length, 4, "5 → reveal (+2 draw, −3 discard) = 4, diplomat back in hand");
    assert(p2.discard.indexOf("copper") !== -1, "discarded the three chosen cards");
    assert(p2.discard.filter((c) => c === "copper").length === 3, "exactly three cards discarded");
    assert(p2.discard.indexOf("curse") !== -1, "the Witch still hit (Diplomat does not block)");
  });
  t("diplomat: no reaction effect from a hand of 4 or fewer cards", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["diplomat", "witch", "smithy"], seed: 28 });
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.player(g, "p1").hand = ["witch", "copper", "copper", "copper", "copper"];
    Dominion.engine.player(g, "p1").deck = ["silver"];
    const p2 = Dominion.engine.player(g, "p2");
    p2.hand = ["diplomat", "copper", "copper"];
    p2.deck = ["gold"];
    g.decide = (s, q) => (q.type === "react" ? ["diplomat"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "witch" });
    eq(p2.hand.length, 3, "hand unchanged (draw requires 5+ cards)");
    eq(p2.deck.length, 1, "no cards drawn");
  });

  /* ══════════════════ Task 69: Duke scaling ═══════════════════════ */
  t("duke: worth 1 VP per Duchy, scaling across multiple copies", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 29 });
    const p = Dominion.engine.player(g, "p1");
    const only = (deck) => { p.deck = deck; p.hand = []; p.discard = []; p.play = []; p.setAside = []; p.exile = []; p.duration = []; p.reserve = []; };
    only(["duke", "duke", "duchy", "duchy", "copper"]);
    eq(Dominion.engine.score(g, "p1").duke, 4, "2 Dukes × 2 Duchies = 4 VP");
    only(["duke", "duchy", "copper"]);
    eq(Dominion.engine.score(g, "p1").duke, 1, "1 Duke × 1 Duchy = 1 VP");
    only(["duke"]);
    eq((Dominion.engine.score(g, "p1").duke || 0), 0, "no Duchies → 0 VP");
    only(["duke", "duke", "duke", "duchy", "duchy", "duchy", "copper"]);
    eq(Dominion.engine.score(g, "p1").duke, 9, "3 Dukes × 3 Duchies = 9 VP");
  });

  /* ══════════════════ Task 70: Farmland ══════════════════════════ */
  t("farmland: on-buy you may trash a card and gain one costing up to $2 more", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["farmland", "smithy", "village"], seed: 30 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["copper", "estate", "copper", "copper", "copper"];
    p.coins = 6;
    g.decide = (s, q) => {
      if (q.type === "farmlandTrash") return true;
      if (q.type === "trashAny") return q.hand.indexOf("estate");
      if (q.type === "gainCard") return "village";
      return null;
    };
    Dominion.engine.buy(g, "p1", "farmland");
    assert(p.discard.indexOf("farmland") !== -1, "the bought Farmland went to the discard");
    assert(g.trash.indexOf("estate") !== -1, "the Estate was trashed");
    assert(p.discard.indexOf("village") !== -1, "Village (Estate + $2) was gained");
    eq(p.hand.length, 4, "the Estate left the hand");
  });
  t("farmland: the trash step is optional and non-buy gains do not trigger it", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["farmland", "smithy", "village"], seed: 31 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["copper", "estate", "copper", "copper", "copper"];
    p.coins = 6;
    g.decide = (s, q) => (q.type === "farmlandTrash" ? false : null);
    Dominion.engine.buy(g, "p1", "farmland");
    eq(g.trash.length, 0, "nothing trashed when declined");
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["farmland", "smithy", "village"], seed: 32 });
    Dominion.engine.beginTurn(g2, "p1");
    const p2 = Dominion.engine.player(g2, "p1");
    p2.hand = ["copper", "estate", "copper", "copper", "copper"];
    Dominion.engine.primitives.gain(g2, "p1", "farmland");
    eq(g2.trash.length, 0, "gaining Farmland (not buying) does not fire the on-buy trigger");
  });

  /* ══════════════════ Task 71: Harem ═════════════════════════════ */
  t("harem: dual-type — plays as a $2 Treasure and scores 2 VP", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["harem", "smithy"], seed: 33 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.deck = []; p.discard = []; p.play = []; p.setAside = []; p.exile = []; p.duration = []; p.reserve = [];
    p.hand = ["harem", "copper", "estate", "silver", "gold"];
    const played = Dominion.engine.treasures.playAll(g, "p1");
    assert(played.cards.indexOf("harem") !== -1, "Harem is auto-played as a Treasure");
    eq(p.coins, 8, "2 (harem) + 1 (copper) + 2 (silver) + 3 (gold)");
    eq(p.hand.length, 1, "only the Estate remains (not a Treasure)");
    eq(p.hand[0], "estate", "the Estate was not auto-played");
    eq(Dominion.engine.score(g, "p1").total, 3, "Harem 2 VP + Estate 1 VP, Treasures 0");
    eq(Dominion.engine.score(g, "p1").harem, 2, "the Harem source is its own VP");
  });
  t("harem: a Treasure-Victory is not an Action and cannot be played as one", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const d = Dominion.cards.get("harem");
    assert(d.types.indexOf("Treasure") !== -1 && d.types.indexOf("Victory") !== -1, "both types present");
    assert(d.types.indexOf("Action") === -1, "not an Action");
    const g = Dominion.engine.setup({ players: 2, kingdom: ["harem", "smithy"], seed: 34 });
    Dominion.engine.beginTurn(g, "p1");
    Dominion.engine.player(g, "p1").hand = ["harem", "copper", "copper", "copper", "copper"];
    let threw = false;
    try { Dominion.engine.actions.play(g, "p1", { cardId: "harem" }); } catch (e) { threw = true; }
    assert(threw, "playAction must reject a non-Action");
  });

  /* ══════════════════ Task 72: Ironworks ══════════════════════════ */
  t("ironworks: gains a card up to $4 and an Action gives +1 Action", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["ironworks", "smithy", "village"], seed: 35 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["ironworks", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "gainCard" ? "village" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "ironworks" });
    assert(p.discard.indexOf("village") !== -1, "Village gained to the discard");
    eq(g.supply.village, 9, "Village came from the supply");
    eq(p.actions, 1, "spent 1 to play Ironworks, gained +1 Action (net 1)");
  });
  t("ironworks: a Treasure gives +$1 and a Victory gives +1 Card", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["ironworks", "smithy", "village"], seed: 36 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["ironworks", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "gainCard" ? "silver" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "ironworks" });
    assert(p.discard.indexOf("silver") !== -1, "Silver (Treasure) gained");
    eq(p.coins, 1, "Treasure gained → +$1");
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["ironworks", "smithy", "village"], seed: 37 });
    Dominion.engine.beginTurn(g2, "p1");
    const p2 = Dominion.engine.player(g2, "p1");
    p2.hand = ["ironworks", "copper", "copper", "copper", "copper"];
    g2.decide = (s, q) => (q.type === "gainCard" ? "estate" : null);
    Dominion.engine.actions.play(g2, "p1", { cardId: "ironworks" });
    eq(p2.hand.length, 5, "Victory gained → +1 Card (drew one)");
  });
  t("ironworks: cannot gain a card costing more than $4", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["ironworks", "smithy", "village"], seed: 38 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["ironworks", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "gainCard" ? "province" : null);
    const before = g.supply.province;
    Dominion.engine.actions.play(g, "p1", { cardId: "ironworks" });
    eq(g.supply.province, before, "Province ($8) is out of range and not gained");
    eq(p.discard.length, 0, "nothing was gained");
  });

  /* ══════════════════ Task 73: Lurker ═════════════════════════════ */
  t("lurker: +1 Action and trashes an Action card from the Supply", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["lurker", "village", "smithy"], seed: 39 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["lurker", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => {
      if (q.type === "lurkerMode") return "trashSupply";
      if (q.type === "lurkerTrashSupply") return "village";
      return null;
    };
    const before = g.supply.village;
    Dominion.engine.actions.play(g, "p1", { cardId: "lurker" });
    eq(g.supply.village, before - 1, "a Village left the Supply");
    assert(g.trash.indexOf("village") !== -1, "it went to the trash");
    eq(p.actions, 1, "net +1 Action (played Lurker, gained +1)");
  });
  t("lurker: gains an Action card from the trash", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["lurker", "village", "smithy"], seed: 40 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["lurker", "copper", "copper", "copper", "copper"];
    g.trash = ["smithy", "copper", "smithy"];
    g.decide = (s, q) => {
      if (q.type === "lurkerMode") return "gainTrash";
      if (q.type === "lurkerGainTrash") return "smithy";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "lurker" });
    assert(p.discard.indexOf("smithy") !== -1, "gained Smithy from the trash");
    eq(g.trash.filter((c) => c === "smithy").length, 1, "one Smithy copy remains in the trash");
    eq(g.supply.smithy, 10, "the supply is untouched");
  });
  t("lurker: with no Actions in the Supply or trash it only gives +1 Action", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["lurker", "harem", "duke"], seed: 41 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["lurker", "copper", "copper", "copper", "copper"];
    g.supply.lurker = 0;
    g.trash = ["curse", "copper"];
    g.decide = () => null;
    Dominion.engine.actions.play(g, "p1", { cardId: "lurker" });
    eq(p.actions, 1, "+1 Action only");
    eq(g.trash.length, 2, "the trash is unchanged");
    eq(p.discard.length, 0, "nothing gained");
  });

  /* ══════════════════ Task 74: Masquerade ═════════════════════════ */
  t("masquerade: 2p — each player passes one card to the left, then may trash", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["masquerade", "smithy"], seed: 42 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["masquerade", "copper", "copper", "copper", "copper"];
    p1.deck = ["silver"];
    p2.hand = ["silver", "gold", "estate", "copper"];
    p2.deck = [];
    g.decide = (s, q) => {
      if (q.type === "masqueradePass") {
        if (q.player === "p1") return p1.hand.indexOf("copper");
        return p2.hand.indexOf("estate");
      }
      if (q.type === "masqueradeTrash") return false;
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "masquerade" });
    assert(p1.hand.indexOf("estate") !== -1, "p1 received p2's Estate");
    assert(p2.hand.indexOf("copper") !== -1, "p2 received a Copper");
    eq(p1.hand.length, 5, "drew 2 + received 1 - passed 1 - played 1 = 5");
    eq(p2.hand.length, 4, "passed 1 + received 1");
    eq(g.trash.length, 0, "declined to trash");
  });
  t("masquerade: 3p — cards pass around the table; an empty hand passes nothing", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 3, kingdom: ["masquerade", "smithy"], seed: 43 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    const p3 = Dominion.engine.player(g, "p3");
    p1.hand = ["masquerade", "copper", "copper", "copper", "copper"];
    p1.deck = ["silver"];
    p2.hand = ["gold", "copper"];
    p2.deck = [];
    p3.hand = [];
    p3.deck = [];
    g.decide = (s, q) => {
      if (q.type === "masqueradePass") {
        if (q.player === "p1") return p1.hand.indexOf("copper");
        if (q.player === "p2") return p2.hand.indexOf("gold");
        return null;
      }
      if (q.type === "masqueradeTrash") return false;
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "masquerade" });
    assert(p2.hand.indexOf("copper") !== -1, "p2 received p1's Copper");
    assert(p3.hand.indexOf("gold") !== -1, "p3 received p2's Gold");
    assert(p2.hand.indexOf("gold") === -1, "p2 gave away its Gold");
    assert(p1.hand.indexOf("gold") === -1, "empty-handed p3 passed nothing, so p1 receives nothing");
    eq(p3.hand.length, 1, "p3 only holds the received Gold");
  });
  t("masquerade: the active player may trash a card from hand after the exchange", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["masquerade", "smithy"], seed: 44 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["masquerade", "curse", "copper", "copper", "copper"];
    p1.deck = ["silver"];
    p2.hand = ["gold", "gold", "estate", "estate"];
    p2.deck = [];
    g.decide = (s, q) => {
      if (q.type === "masqueradePass") {
        if (q.player === "p1") return p1.hand.indexOf("copper");
        return p2.hand.indexOf("estate");
      }
      if (q.type === "masqueradeTrash") return true;
      if (q.type === "trashAny") return q.hand.indexOf("curse");
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "masquerade" });
    assert(g.trash.indexOf("curse") !== -1, "the Curse was trashed after the exchange");
    assert(p1.hand.indexOf("curse") === -1, "no Curse left in hand");
    assert(p1.hand.indexOf("estate") !== -1, "p1 kept the Estate it received");
  });

  /* ══════════════════ Task 75: Mill ═══════════════════════════════ */
  t("mill: +1 Card, +1 Action (official), and may discard 2 for +$2", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["mill", "smithy"], seed: 45 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["mill", "copper", "copper", "estate", "gold"];
    p.deck = ["silver"];
    g.decide = (s, q) => {
      if (q.type === "millDiscard") return true;
      if (q.type === "discardExactly") return q.hand.map((id, i) => ({ id, i })).filter((o) => o.id === "copper").map((o) => o.i).slice(0, 2);
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "mill" });
    eq(p.coins, 2, "+$2 for discarding 2");
    eq(p.actions, 1, "+1 Action (spent 1 to play, gained +1)");
    eq(p.hand.length, 3, "6 - 1 played - 2 discarded = 3");
    assert(p.discard.filter((c) => c === "copper").length === 2, "exactly the two Coppers were discarded");
  });
  t("mill: the discard-2-for-$2 step is optional", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["mill", "smithy"], seed: 46 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["mill", "copper", "copper", "estate", "gold"];
    p.deck = ["silver"];
    g.decide = (s, q) => (q.type === "millDiscard" ? false : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "mill" });
    eq(p.coins, 0, "no coins without discarding");
    eq(p.discard.length, 0, "nothing discarded");
    eq(p.hand.length, 5, "drew 1, played Mill");
  });
  t("mill: scores 1 VP as an Action-Victory", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, seed: 47 });
    const p = Dominion.engine.player(g, "p1");
    p.deck = ["mill", "copper"]; p.hand = []; p.discard = []; p.play = []; p.setAside = []; p.exile = []; p.duration = []; p.reserve = [];
    eq(Dominion.engine.score(g, "p1").total, 1, "Mill is worth 1 VP");
    const md = Dominion.cards.get("mill");
    assert(md.types.indexOf("Action") !== -1 && md.types.indexOf("Victory") !== -1, "Mill is an Action-Victory");
  });

  /* ══════════════ Task 76: Mining Village ══════════════ */
  t("mining_village: +1 Card, +2 Actions, and may trash itself for +$2", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["mining_village", "smithy"], seed: 48 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["mining_village", "copper", "copper", "copper", "copper"];
    p.deck = ["silver"];
    g.decide = (s, q) => (q.type === "miningVillageTrash" ? true : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "mining_village" });
    eq(p.actions, 2, "+2 Actions (net)");
    eq(p.coins, 2, "+$2 from trashing");
    eq(p.hand.length, 5, "drew 1 (5 - played + 1)");
    assert(g.trash.indexOf("mining_village") !== -1, "the played card was trashed immediately");
  });
  t("mining_village: declining keeps it in play with no coins", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["mining_village", "smithy"], seed: 49 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["mining_village", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "miningVillageTrash" ? false : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "mining_village" });
    eq(p.coins, 0, "no coins");
    eq(g.trash.length, 0, "nothing trashed");
    assert(p.play.indexOf("mining_village") !== -1, "still in the play area");
  });

  /* ══════════════ Task 77: Minion ══════════════ */
  t("minion: coins mode — +1 Action and +$2, no one attacked", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["minion", "smithy"], seed: 50 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["minion", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "minionMode" ? "coins" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "minion" });
    eq(p.actions, 1, "+1 Action (net)");
    eq(p.coins, 2, "+$2");
    eq(p.hand.length, 4, "no draw in coins mode");
  });
  t("minion: draw mode — everyone with 5+ cards discards and draws 4", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["minion", "smithy"], seed: 51 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["minion", "copper", "copper", "copper", "copper"];
    p1.deck = ["silver", "gold", "estate", "copper", "copper"];
    p2.hand = ["copper", "copper", "copper", "copper", "copper"];
    p2.deck = ["silver", "gold", "estate", "copper", "copper"];
    g.decide = (s, q) => (q.type === "minionMode" ? "draw" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "minion" });
    eq(p1.hand.length, 4, "discarded its 4, drew 4");
    eq(p2.hand.length, 4, "discarded its 5, drew 4");
    eq(p2.discard.filter((c) => c === "copper").length, 5, "p2's whole hand was discarded");
    const g3 = Dominion.engine.setup({ players: 2, kingdom: ["minion", "smithy"], seed: 52 });
    Dominion.engine.beginTurn(g3, "p1");
    const a = Dominion.engine.player(g3, "p1");
    const b = Dominion.engine.player(g3, "p2");
    a.hand = ["minion", "copper", "copper", "copper", "copper"];
    a.deck = ["silver"];
    b.hand = ["copper", "copper", "copper", "copper"];
    b.deck = ["gold", "gold"];
    g3.decide = (s, q) => (q.type === "minionMode" ? "draw" : null);
    Dominion.engine.actions.play(g3, "p1", { cardId: "minion" });
    eq(b.hand.length, 4, "under 5 cards in hand → unaffected");
    eq(b.discard.length, 0, "nothing discarded");
    eq(b.deck.length, 2, "deck untouched");
  });

  /* ══════════════ Task 78: Nobles ══════════════ */
  t("nobles: choose +3 Cards (and it scores 2 VP)", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["nobles", "smithy"], seed: 53 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["nobles", "copper", "copper", "copper", "copper"];
    p.deck = ["silver", "gold", "estate"];
    g.decide = (s, q) => (q.type === "noblesChoice" ? "cards" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "nobles" });
    eq(p.hand.length, 7, "drew 3 (5 - played + 3)");
    eq(Dominion.engine.score(g, "p1").nobles, 2, "Nobles scores 2 VP");
  });
  t("nobles: choose +2 Actions", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["nobles", "smithy"], seed: 54 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["nobles", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "noblesChoice" ? "actions" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "nobles" });
    eq(p.actions, 2, "+2 Actions (net)");
    eq(p.hand.length, 4, "no draw");
  });

  /* ══════════════ Task 79: Pawn ══════════════ */
  t("pawn: costs $2 (official, not $1) and chooses two bonuses", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    eq(Dominion.cards.get("pawn").cost.coins, 2, "official cost is $2");
    const g = Dominion.engine.setup({ players: 2, kingdom: ["pawn", "smithy"], seed: 55 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["pawn", "copper", "copper", "copper", "copper"];
    p.deck = ["silver"];
    g.decide = (s, q) => (q.type === "pawnChoices" ? ["card", "action"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "pawn" });
    eq(p.actions, 1, "+1 Action (net)");
    eq(p.hand.length, 5, "+1 Card");
    eq(p.coins, 0, "no coin bonus chosen");
  });
  t("pawn: choices must be different (duplicates are deduped)", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["pawn", "smithy"], seed: 56 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["pawn", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "pawnChoices" ? ["coin", "coin", "buy"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "pawn" });
    eq(p.coins, 1, "+$1 (once)");
    eq(p.buys, 2, "+1 Buy (1 base + 1)");
  });

  /* ══════════════ Task 80: Patrol ══════════════ */
  t("patrol: +3 Cards, Victory and Curses to hand, the rest back in order", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["patrol", "smithy"], seed: 57 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["patrol", "copper", "copper", "copper", "copper"];
    p.deck = ["copper", "estate", "curse", "silver", "gold", "estate", "copper"];
    g.decide = (s, q) => null;
    Dominion.engine.actions.play(g, "p1", { cardId: "patrol" });
    assert(p.hand.indexOf("curse") !== -1, "the Curse went to hand");
    assert(p.hand.indexOf("estate") !== -1, "the Victory card went to hand");
    deepEq(p.deck, ["copper", "silver"], "the rest went back in their original order (top = silver)");
  });
  t("patrol: the rest can be put back in any order the player picks", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["patrol", "smithy"], seed: 58 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["patrol", "copper", "copper", "copper", "copper"];
    p.deck = ["copper", "estate", "curse", "silver", "gold", "estate", "copper"];
    g.decide = (s, q) => (q.type === "patrolOrder" ? ["copper", "silver"] : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "patrol" });
    deepEq(p.deck, ["silver", "copper"], "the chosen order puts copper on top");
  });

  /* ══════════════ Task 81: Replace ══════════════ */
  t("replace: trash a card, gain one up to $2 more; a Victory gained Curses each other player", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["replace", "smithy", "village"], seed: 59 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p.hand = ["replace", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => {
      if (q.type === "trashAny") return q.hand.indexOf("copper");
      if (q.type === "gainCard") return "estate";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "replace" });
    assert(g.trash.indexOf("copper") !== -1, "the Copper was trashed");
    assert(p.discard.indexOf("estate") !== -1, "Estate (Copper + $2) gained to discard");
    assert(p2.discard.indexOf("curse") !== -1, "each other player gained a Curse");
  });
  t("replace: gaining an Action or Treasure puts it on the deck and Curses no one", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["replace", "smithy", "village"], seed: 60 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p.hand = ["replace", "estate", "copper", "copper", "copper"];
    g.decide = (s, q) => {
      if (q.type === "trashAny") return q.hand.indexOf("estate");
      if (q.type === "gainCard") return "village";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "replace" });
    assert(p.deck[p.deck.length - 1] === "village", "the gained Action went onto the deck");
    eq(p.discard.length, 0, "nothing to discard");
    eq(p2.discard.length, 0, "no Curse was gained by others");
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["replace", "smithy", "village"], seed: 61 });
    Dominion.engine.beginTurn(g2, "p1");
    const p2a = Dominion.engine.player(g2, "p1");
    p2a.hand = ["replace", "estate", "copper", "copper", "copper"];
    g2.decide = (s, q) => {
      if (q.type === "trashAny") return q.hand.indexOf("estate");
      if (q.type === "gainCard") return "silver";
      return null;
    };
    Dominion.engine.actions.play(g2, "p1", { cardId: "replace" });
    assert(p2a.deck[p2a.deck.length - 1] === "silver", "the gained Treasure went onto the deck");
  });

  /* ══════════════ Task 82: Secret Passage ══════════════ */
  t("secret_passage: +2 Cards, +1 Action, and places a hand card on top of the deck", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["secret_passage", "smithy"], seed: 62 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["secret_passage", "copper", "silver", "estate", "gold"];
    p.deck = ["copper", "copper"];
    g.decide = (s, q) => {
      if (q.type === "secretPassageCard") return q.hand.indexOf("silver");
      if (q.type === "secretPassageDepth") return 0;
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "secret_passage" });
    eq(p.actions, 1, "+1 Action (net)");
    eq(p.hand.length, 5, "5 - played + 2 drawn - 1 placed = 5");
    deepEq(p.deck, ["silver"], "the Silver went on top of the deck");
  });
  t("secret_passage: the card can be placed anywhere in the deck (bottom here)", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["secret_passage", "smithy"], seed: 63 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["secret_passage", "copper", "silver"];
    p.deck = ["copper", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => {
      if (q.type === "secretPassageCard") return q.hand.indexOf("silver");
      if (q.type === "secretPassageDepth") return q.maxDepth;
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "secret_passage" });
    eq(p.deck.length, 4, "3 remaining + the placed card");
    eq(p.deck[0], "silver", "the Silver is at the bottom");
    eq(p.deck[p.deck.length - 1], "copper", "the deck top is unaffected");
  });

  /* ══════════════ Task 83: Shanty Town ══════════════ */
  t("shanty_town: +2 Actions; no Actions in hand → +2 Cards (hand revealed)", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["shanty_town", "smithy"], seed: 64 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["shanty_town", "copper", "copper", "copper", "copper"];
    p.deck = ["silver", "gold", "estate", "copper"];
    g.decide = (s, q) => null;
    Dominion.engine.actions.play(g, "p1", { cardId: "shanty_town" });
    eq(p.actions, 2, "+2 Actions (net)");
    eq(p.hand.length, 6, "5 - played + 2 drawn = 6");
    eq(g.log.filter((e) => e.t === "reveal" && e.player === "p1").length, 4, "the 4-card hand was revealed");
  });
  t("shanty_town: with an Action in hand, no extra cards are drawn", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["shanty_town", "village"], seed: 65 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["shanty_town", "village", "copper", "copper", "copper"];
    p.deck = ["silver"];
    g.decide = (s, q) => null;
    Dominion.engine.actions.play(g, "p1", { cardId: "shanty_town" });
    eq(p.actions, 2, "+2 Actions (net)");
    eq(p.hand.length, 4, "no cards drawn (an Action was in hand)");
    eq(p.deck.length, 1, "deck untouched");
  });

  /* ══════════════ Task 84: Steward ══════════════ */
  t("steward: +2 Cards or +$2 modes", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["steward", "smithy"], seed: 66 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["steward", "copper", "copper", "copper", "copper"];
    p.deck = ["silver", "gold"];
    g.decide = (s, q) => (q.type === "stewardMode" ? "cards" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "steward" });
    eq(p.hand.length, 6, "+2 Cards");
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["steward", "smithy"], seed: 67 });
    Dominion.engine.beginTurn(g2, "p1");
    const p2 = Dominion.engine.player(g2, "p1");
    p2.hand = ["steward", "copper", "copper", "copper", "copper"];
    g2.decide = (s, q) => (q.type === "stewardMode" ? "coins" : null);
    Dominion.engine.actions.play(g2, "p1", { cardId: "steward" });
    eq(p2.coins, 2, "+$2");
  });
  t("steward: trash mode trashes exactly 2 chosen cards", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["steward", "smithy"], seed: 68 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    p.hand = ["steward", "curse", "copper", "copper", "gold"];
    g.decide = (s, q) => {
      if (q.type === "stewardMode") return "trash";
      if (q.type === "trashTwo") return [q.hand.indexOf("copper"), q.hand.indexOf("gold")];
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "steward" });
    assert(g.trash.indexOf("copper") !== -1 && g.trash.indexOf("gold") !== -1, "the two chosen cards were trashed");
    eq(g.trash.length, 2, "exactly two cards trashed");
    eq(p.hand.length, 2, "only the Curse and the other Copper remain");
  });

  /* ══════════════ Task 85: Swindler ══════════════ */
  t("swindler: +$2; top card trashed and a same-cost card (attacker's choice) gained", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["swindler", "smithy"], seed: 69 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p.hand = ["swindler", "copper", "copper", "copper", "copper"];
    p2.deck = ["silver", "copper"];
    g.decide = (s, q) => (q.type === "swindlerGain" ? "curse" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "swindler" });
    eq(p.coins, 2, "+$2");
    assert(g.trash.indexOf("copper") !== -1, "the top card of p2's deck was trashed");
    assert(p2.discard.indexOf("curse") !== -1, "p2 gained the attacker-chosen Curse (same cost 0)");
  });
  t("swindler: the gained card must match the trashed card's exact cost", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "alchemy", "cornucopia", "hinterlands"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["swindler", "smithy"], seed: 70 });
    Dominion.engine.beginTurn(g, "p1");
    const p = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p.hand = ["swindler", "copper", "copper", "copper", "copper"];
    p2.deck = ["copper", "gold"];
    g.decide = (s, q) => (q.type === "swindlerGain" ? "gold" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "swindler" });
    assert(g.trash.indexOf("gold") !== -1, "the Gold on top was trashed");
    assert(p2.discard.indexOf("gold") !== -1, "p2 gained the Gold (exactly $6, the same cost)");
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["swindler", "smithy"], seed: 71 });
    Dominion.engine.beginTurn(g2, "p1");
    Dominion.engine.player(g2, "p1").hand = ["swindler", "copper", "copper", "copper", "copper"];
    const p2b = Dominion.engine.player(g2, "p2");
    p2b.deck = ["copper", "gold"];
    g2.decide = (s, q) => (q.type === "swindlerGain" ? "province" : null);
    Dominion.engine.actions.play(g2, "p1", { cardId: "swindler" });
    assert(p2b.discard.filter((c) => c === "gold").length === 0, "Province ($8) does not match $6 — not gained");
  });

  /* ══════════════════ Tasks 86–89: Intrigue additions ══════════ */
  t("intrigue: trading post trashes 2 and gains a Silver to hand", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "seaside", "alchemy", "prosperity"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["trading_post"], seed: 100 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["trading_post", "copper", "copper", "estate"];
    Dominion.engine.actions.play(g, "p1", { cardId: "trading_post" });
    eq(p1.buys, 2, "+1 Buy");
    eq(g.trash.filter((c) => c === "copper").length, 2, "two Coppers trashed");
    assert(p1.hand.indexOf("silver") !== -1, "Silver gained to hand");
    assert(p1.hand.indexOf("estate") !== -1, "Estate untouched");
  });
  t("intrigue: upgrade trashes a card and gains one costing $1 more", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["upgrade", "silver"], seed: 101 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["upgrade", "estate", "copper", "copper"];
    p1.deck = ["copper"];
    g.decide = (s, q) => (q.type === "trashAny" ? 0 : (q.type === "gainCard" ? "silver" : null));
    Dominion.engine.actions.play(g, "p1", { cardId: "upgrade" });
    eq(p1.hand.length, 3, "+1 Card, then trashed one (the gained Silver goes to discard)");
    eq(p1.actions, 1, "+1 Action");
    assert(p1.discard.indexOf("silver") !== -1, "Silver gained ($3 = estate $2 + $1)");
    assert(g.trash.indexOf("estate") !== -1, "Estate trashed");
    // Province is not a valid upgrade target from a $0 Curse
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["upgrade"], seed: 102 });
    Dominion.engine.beginTurn(g2, "p1");
    const q1 = Dominion.engine.player(g2, "p1");
    q1.hand = ["upgrade", "curse"];
    g2.decide = (s, q) => (q.type === "trashAny" ? 0 : (q.type === "gainCard" ? "province" : null));
    Dominion.engine.actions.play(g2, "p1", { cardId: "upgrade" });
    assert(q1.discard.indexOf("province") === -1, "Province costs 8, not 1 — not gained");
    assert(q1.discard.filter((c) => c === "curse").length === 0, "curse trashed, not gained back");
  });
  t("intrigue: wishing well draws a matching named card", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["wishing_well"], seed: 103 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["wishing_well"];
    p1.deck = ["gold", "copper"];
    g.decide = (s, q) => (q.type === "wishName" ? "gold" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "wishing_well" });
    eq(p1.hand.length, 2, "+1 Card + matched gold drawn");
    eq(p1.deck.length, 0, "both deck cards drawn");
    // miss → the revealed card is discarded
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["wishing_well"], seed: 104 });
    Dominion.engine.beginTurn(g2, "p1");
    const q1 = Dominion.engine.player(g2, "p1");
    q1.hand = ["wishing_well"];
    q1.deck = ["gold", "copper"];
    g2.decide = (s, q) => (q.type === "wishName" ? "silver" : null);
    Dominion.engine.actions.play(g2, "p1", { cardId: "wishing_well" });
    assert(q1.hand.indexOf("gold") === -1, "gold not drawn on a miss");
    assert(q1.discard.indexOf("gold") !== -1, "revealed gold discarded");
  });
  t("intrigue: torturer offers discard-2 or curse-to-hand", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["torturer"], seed: 105 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["torturer"];
    p1.deck = ["copper", "copper"];
    g.decide = (s, q) => (q.type === "torturerChoice" ? "discard" : (q.type === "discardDown" ? [0, 1] : null));
    Dominion.engine.actions.play(g, "p1", { cardId: "torturer" });
    eq(p1.hand.length, 2, "+2 Cards");
    eq(p2.hand.length, 5 - 2, "p2 discarded 2");
    // curse branch puts the Curse into the hand
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["torturer"], seed: 106 });
    Dominion.engine.beginTurn(g2, "p1");
    const q1 = Dominion.engine.player(g2, "p1");
    const r2 = Dominion.engine.player(g2, "p2");
    q1.hand = ["torturer"];
    g2.decide = (s, q) => (q.type === "torturerChoice" ? "curse" : null);
    Dominion.engine.actions.play(g2, "p1", { cardId: "torturer" });
    assert(r2.hand.indexOf("curse") !== -1, "Curse gained to p2's hand");
    assert(r2.discard.indexOf("curse") === -1, "not to discard");
  });

  /* ══════════════════════ Tasks 90–119: Seaside 2E ═════════════ */
  t("seaside: pin — 27 official 2nd-edition cards", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "seaside", "alchemy", "prosperity"]);
    const ids = Dominion.cards.all().filter((c) => c.expansion === "seaside").map((c) => c.id).sort();
    deepEq(ids, ["astrolabe","bazaar","blockade","caravan","corsair","cutpurse","fishing_village","haven","island","lighthouse","lookout","merchant_ship","monkey","native_village","outpost","pirate","sailor","salvager","sea_chart","sea_witch","smugglers","tactician","tide_pools","treasure_map","treasury","warehouse","wharf"], "27 seaside cards");
    eq(Dominion.cards.all().filter((c) => c.expansion === "seaside").length, 27, "count is 27");
    const astrolabe = Dominion.cards.get("astrolabe");
    assert(astrolabe.types.indexOf("Treasure") !== -1 && astrolabe.types.indexOf("Duration") !== -1, "astrolabe is Treasure-Duration");
    eq(astrolabe.cost.coins, 3, "astrolabe costs $3");
    eq(Dominion.cards.get("island").vp, 2, "island static VP 2");
    deepEq(Dominion.cards.get("island").pileSize, { "2": 8, "3": 12 }, "island pile scales with players");
    assert(Dominion.cards.get("native_village").types.indexOf("Duration") === -1, "native village is Action-only");
    eq(Dominion.cards.get("wharf").cost.coins, 5, "wharf costs $5");
  });
  t("seaside: all 16 Duration cards cycle through the duration zone", () => {
    const durIds = ["astrolabe","blockade","caravan","corsair","fishing_village","haven","lighthouse","merchant_ship","monkey","outpost","pirate","sailor","sea_witch","tactician","tide_pools","wharf"];
    for (const id of durIds) {
      const d = Dominion.cards.get(id);
      assert(d && d.types.indexOf("Duration") !== -1, id + " is a Duration");
      assert(Dominion.engine.durations.has(id), id + " registered with durations");
    }
    for (const id of durIds) {
      if (id === "outpost") continue;
      assert(typeof Dominion.engine.durations.get(id).resolve === "function", id + " has a next-turn resolve");
    }
  });
  t("seaside: caravan duration cycle", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["caravan"], seed: 107 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["caravan", "copper", "copper", "copper", "copper"];
    p1.deck = ["silver", "gold", "estate", "copper", "copper", "silver", "gold", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "caravan" });
    eq(p1.hand.length, 5, "+1 Card now");
    eq(p1.actions, 1, "+1 Action now");
    eq(p1.play.length, 1, "caravan in play");
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // → cleanup → draw → p2
    eq(p1.duration.length, 1, "caravan kept out as a duration");
    eq(p1.play.length, 0, "play area cleared");
    eq(g.turnPlayer, "p2", "p2's turn");
    Dominion.engine.advancePhase(g); // p2 → buy
    Dominion.engine.advancePhase(g); // → cleanup → draw → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.hand.length, 6, "start-of-turn +1 Card (5 drawn + 1)");
    eq(p1.oldDur.length, 1, "caravan resolved and moved to oldDur");
    Dominion.engine.advancePhase(g); // p1 → buy
    Dominion.engine.advancePhase(g); // → cleanup: oldDur flushed
    eq(p1.oldDur.length, 0, "oldDur flushed at cleanup");
    assert(p1.duration.indexOf("caravan") === -1 && p1.play.indexOf("caravan") === -1 && p1.oldDur.length === 0, "caravan left the duration zone at cleanup");
    assert(p1.hand.concat(p1.deck).concat(p1.discard).indexOf("caravan") !== -1, "caravan back in the draw cycle");
  });
  t("seaside: bazaar gives +1 card, +2 actions, +$1", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["bazaar"], seed: 108 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bazaar"];
    p1.deck = ["copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "bazaar" });
    eq(p1.hand.length, 1, "+1 Card");
    eq(p1.actions, 2, "+2 Actions");
    eq(p1.coins, 1, "+$1");
  });
  t("seaside: blockade sets aside and curses other gainers", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["blockade"], seed: 109 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["blockade"];
    g.decide = (s, q) => (q.type === "gainCard" ? "silver" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "blockade" });
    assert(p1.blockadeAside.length === 1 && p1.blockadeAside[0] === "silver", "silver set aside");
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // → p2
    eq(g.turnPlayer, "p2", "p2's turn");
    const curseBefore = p2.discard.filter((c) => c === "curse").length;
    const ownerBefore = p1.discard.filter((c) => c === "curse").length;
    p2.coins = 3; p2.hand = ["copper"];
    g.decide = (s, q) => null;
    Dominion.engine.buy(g, "p2", "silver");
    eq(p2.discard.filter((c) => c === "curse").length, curseBefore + 1, "the gaining player (p2) gains the Curse");
    eq(p1.discard.filter((c) => c === "curse").length, ownerBefore, "the blockade owner gains nothing");
    Dominion.engine.advancePhase(g); // p2 → buy
    Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    assert(p1.hand.indexOf("silver") !== -1, "set-aside silver returns to hand");
    eq(p1.blockadeAside.length, 0, "blockade aside emptied");
  });
  t("seaside: corsair trashes the first Silver or Gold each turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["corsair"], seed: 110 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["corsair"];
    p1.deck = ["copper", "copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "corsair" });
    eq(p1.coins, 2, "+$2 now");
    eq(p2.corsairActive, true, "p2 under the corsair");
    eq(p2.corsairFrom, "p1", "attacker recorded");
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // → p2
    const trashBefore = g.trash.length;
    p2.hand = ["gold", "silver", "silver"];
    p2.deck = [];
    const res = Dominion.engine.treasures.playAll(g, "p2");
    eq(g.trash.length, trashBefore + 1, "one treasure trashed");
    eq(p2.play.filter((c) => c === "gold").length, 0, "the gold was trashed");
    eq(p2.play.filter((c) => c === "silver").length, 2, "both silvers played");
    eq(p2.corsairTrashed, true, "flag set");
    eq(res.coins, 4, "silvers produced $4 (2+2); the gold produced nothing");
    Dominion.engine.advancePhase(g); // p2 → buy
    Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p2.corsairActive, false, "effect cleared at the corsair owner's next turn");
    eq(p2.corsairFrom, null, "corsairFrom cleared");
    eq(p2.corsairTrashed, false, "trash flag cleared");
  });
  t("seaside: cutpurse discards a Copper or forces a reveal", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["cutpurse"], seed: 111 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["cutpurse"];
    p2.hand = ["copper", "silver"];
    Dominion.engine.actions.play(g, "p1", { cardId: "cutpurse" });
    eq(p1.coins, 2, "+$2");
    assert(p2.discard.indexOf("copper") !== -1, "p2 discarded a Copper");
    eq(p2.hand.length, 1, "one card left");
  });
  t("seaside: fishing village gives actions+coins now and next turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["fishing_village"], seed: 112 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["fishing_village"];
    p1.deck = ["copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "fishing_village" });
    eq(p1.actions, 2, "+2 Actions now");
    eq(p1.coins, 1, "+$1 now");
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.actions, 1 + 1, "extra +1 Action next turn");
    eq(p1.coins, 1, "extra +$1 next turn");
  });
  t("seaside: haven sets aside a card and returns it next turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["haven"], seed: 113 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["haven", "copper", "gold"];
    p1.deck = ["silver"];
    g.decide = (s, q) => (q.type === "havenSetAside" ? 1 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "haven" });
    eq(p1.hand.length, 2, "+1 Card, one set aside");
    assert(p1.havenAside.length === 1 && p1.havenAside[0] === "gold", "gold set aside");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    assert(p1.hand.indexOf("gold") !== -1, "set-aside gold returned to hand");
    eq(p1.havenAside.length, 0, "haven aside emptied");
  });
  t("seaside: island moves itself and a card onto the mat permanently", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["island"], seed: 114 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["island", "copper"];
    g.decide = (s, q) => (q.type === "islandSetAside" ? 0 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "island" });
    assert(p1.islandMat.indexOf("copper") !== -1 && p1.islandMat.indexOf("island") !== -1, "both cards on the mat");
    eq(p1.islandMat.length, 2, "two cards on the mat");
    assert(p1.hand.indexOf("copper") === -1, "copper left the hand");
    eq(Dominion.cards.get("island").vp, 2, "static 2 VP");
    eq(Dominion.engine.playerCards(g, "p1").filter((c) => c === "island").length, 1, "island still owned (on the mat)");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.islandMat.length, 2, "mat cards persist across turns");
  });
  t("seaside: lighthouse gives coins, blocks attacks, persists", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["lighthouse", "witch"], seed: 115 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["lighthouse"];
    p1.deck = ["copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "lighthouse" });
    eq(p1.actions, 1, "+1 Action");
    eq(p1.coins, 1, "+$1");
    eq(p1.lighthouseImmune, true, "attack immunity while in play");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    // p2 plays witch; p1's lighthouse is in the duration zone → immune
    p2.hand = ["witch"];
    p2.deck = ["copper", "copper"];
    Dominion.engine.actions.play(g, "p2", { cardId: "witch" });
    assert(p1.discard.indexOf("curse") === -1 && p1.hand.indexOf("curse") === -1, "lighthouse blocked the witch");
    eq(p2.hand.length, 2, "witch still draws for p2");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.coins, 1, "+$1 next turn from lighthouse");
    eq(p1.lighthouseImmune, false, "immunity reset at turn start");
  });
  t("seaside: lookout trashes, discards, and topdecks from the top 3", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["lookout"], seed: 116 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["lookout"];
    p1.deck = ["gold", "estate", "curse"]; // top = curse
    Dominion.engine.actions.play(g, "p1", { cardId: "lookout" });
    eq(p1.actions, 1, "+1 Action");
    assert(g.trash.indexOf("curse") !== -1, "curse trashed (cheapest)");
    assert(p1.discard.indexOf("estate") !== -1, "estate discarded");
    assert(p1.deck.length === 1 && p1.deck[0] === "gold", "gold back on top");
  });
  t("seaside: merchant ship gives +$2 now and next turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["merchant_ship"], seed: 117 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["merchant_ship"];
    p1.deck = ["copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "merchant_ship" });
    eq(p1.coins, 2, "+$2 now");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.coins, 2, "+$2 next turn");
  });
  t("seaside: monkey draws when the player to your right gains", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["monkey"], seed: 118 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["monkey"];
    p1.deck = ["copper","copper","copper","copper","copper","copper","copper","copper","copper","copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "monkey" });
    eq(p1.monkeyActive, true, "monkey active until next turn");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    const handBefore = p1.hand.length;
    p2.coins = 3; p2.hand = ["copper"];
    Dominion.engine.buy(g, "p2", "silver");
    eq(p1.hand.length, handBefore + 1, "monkey owner drew 1 on the right player's gain");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.monkeyActive, false, "monkeyActive reset");
    eq(p1.hand.length, handBefore + 1 + 1, "+1 Card at the start of the next turn");
  });
  t("seaside: native village deck/hand modes", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["native_village"], seed: 119 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["native_village"];
    p1.deck = ["silver", "gold"];
    g.decide = (s, q) => (q.type === "nativeVillageMode" ? "deck" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "native_village" });
    eq(p1.actions, 2, "+2 Actions");
    assert(p1.nativeMat.length === 1 && p1.nativeMat[0] === "gold", "top card to the mat");
    eq(p1.deck.length, 1, "one card left on deck");
    p1.hand.push("native_village");
    g.decide = (s, q) => (q.type === "nativeVillageMode" ? "hand" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "native_village" });
    eq(p1.nativeMat.length, 0, "mat emptied");
    assert(p1.hand.indexOf("gold") !== -1, "gold back in hand");
  });
  t("seaside: outpost grants an extra turn drawing only 3", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["outpost"], seed: 120 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["outpost"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "silver"];
    Dominion.engine.actions.play(g, "p1", { cardId: "outpost" });
    eq(p1.wantsExtraTurn, true, "extra turn queued");
    eq(p1.drawCount, 3, "draw count 3");
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // → cleanup → draw → extra turn
    eq(g.turnPlayer, "p1", "extra turn is the same player");
    eq(p1.isExtraTurn, true, "marked as an extra turn");
    eq(p1.hand.length, 3, "only 3 cards drawn");
    p1.hand.push("outpost");
    Dominion.engine.actions.play(g, "p1", { cardId: "outpost" });
    eq(p1.wantsExtraTurn, false, "no second extra turn");
    eq(p1.drawCount, undefined, "draw count untouched by the no-op");
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // → cleanup → draw → p2
    eq(g.turnPlayer, "p2", "normal turn follows");
    eq(p1.play.filter((c) => c === "outpost").length, 0, "both outposts left play");
    assert(p1.duration.indexOf("outpost") !== -1, "the extra-turn outpost is still a duration");
    eq(p1.isExtraTurn, false, "extra-turn flag cleared");
  });
  t("seaside: pirate gains a Treasure and reacts to treasure gains", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["pirate"], seed: 121 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["pirate"];
    g.decide = (s, q) => (q.type === "gainTreasure" ? "silver" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "pirate" });
    eq(p1.piratePending, true, "pirate pending");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    assert(p1.hand.indexOf("silver") !== -1, "pirate gained a Treasure to hand");
    // reaction: another player gains a Treasure → p1 may play pirate from hand
    p1.hand.push("pirate");
    p2.coins = 3; p2.hand = ["copper"];
    g.decide = (s, q) => (q.type === "piratePlay" ? true : null);
    Dominion.engine.buy(g, "p2", "silver");
    eq(p1.play.filter((c) => c === "pirate").length, 1, "pirate played via the reaction");
    eq(Dominion.engine.inPlayCount(g, "p1", "pirate"), 2, "in-play count includes play + oldDur");
    eq(p1.discard.indexOf("silver") === -1, true, "reaction pirate did not come from discard");
  });
  t("seaside: sailor plays a gained Duration card once per turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["sailor", "caravan"], seed: 122 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["sailor"];
    p1.deck = ["copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "sailorPlay" ? true : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "sailor" });
    eq(p1.actions, 1, "+1 Action");
    eq(p1.sailorCount, 1, "sailor count");
    p1.buys = 2;
    p1.coins = 5; p1.hand = ["copper"];
    Dominion.engine.buy(g, "p1", "caravan");
    assert(p1.play.indexOf("caravan") !== -1, "gained caravan played via sailor");
    eq(p1.sailorUsed, 1, "sailor used");
    p1.coins = 5; p1.hand = ["copper"];
    Dominion.engine.buy(g, "p1", "caravan");
    eq(p1.play.filter((c) => c === "caravan").length, 1, "second caravan not auto-played (used up)");
    eq(p1.discard.filter((c) => c === "caravan").length, 1, "second caravan in discard");
  });
  t("seaside: salvager trashes a card and gains its cost in coins", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["salvager"], seed: 123 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["salvager", "copper", "silver"];
    g.decide = (s, q) => (q.type === "trashAny" ? 1 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "salvager" });
    eq(p1.buys, 2, "+1 Buy");
    eq(p1.coins, 3, "silver's cost in coins");
    assert(g.trash.indexOf("silver") !== -1, "silver trashed");
  });
  t("seaside: sea chart draws a revealed card you have in play", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["sea_chart"], seed: 124 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["sea_chart"];
    p1.deck = ["estate", "silver"]; // +1C draws silver; reveal estate (not in play) → stays
    Dominion.engine.actions.play(g, "p1", { cardId: "sea_chart" });
    eq(p1.hand.length, 1, "+1 Card (silver)");
    assert(p1.deck.length === 1 && p1.deck[0] === "estate", "estate stays on deck (no copy in play)");
    // now with a silver in play
    p1.hand.push("sea_chart");
    p1.deck.push("silver", "copper"); // deck: estate, silver, copper; +1C draws copper, reveal silver
    p1.play.push("silver");
    Dominion.engine.actions.play(g, "p1", { cardId: "sea_chart" });
    assert(p1.hand.indexOf("silver") !== -1, "revealed silver drawn because a copy is in play");
    assert(p1.hand.indexOf("copper") !== -1, "copper drawn by +1 Card");
    assert(p1.deck.length === 1 && p1.deck[0] === "estate", "estate remains on deck");
  });
  t("seaside: sea witch curses and draws next turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["sea_witch"], seed: 125 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["sea_witch"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "copper", "copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "sea_witch" });
    eq(p1.hand.length, 2, "+2 Cards");
    assert(p2.discard.indexOf("curse") !== -1, "p2 gained a Curse");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.hand.length, 5, "+2 then discard 2 nets the drawn hand");
  });
  t("seaside: smugglers copies the right player's cheap gain", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["smugglers"], seed: 126 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p2.lastTurnGains = ["silver", "gold"];
    p1.hand = ["smugglers"];
    g.decide = (s, q) => (q.type === "gainCard" ? "gold" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "smugglers" });
    assert(p1.discard.indexOf("gold") !== -1, "gained a copy of the right player's gold");
    eq(p1.discard.filter((c) => c === "gold").length, 1, "exactly one gold");
  });
  t("seaside: tactician discards the hand for +5 next turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["tactician"], seed: 127 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["tactician", "copper", "copper"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "copper", "copper", "copper", "copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "tactician" });
    eq(p1.hand.length, 0, "hand discarded");
    eq(p1.tacticianActive, true, "tactician active");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.hand.length, 10, "5 drawn + tactician's 5");
    eq(p1.actions, 1 + 1, "extra action");
    eq(p1.buys, 1 + 1, "extra buy");
    eq(p1.tacticianActive, false, "flag reset at turn start");
    // empty-hand play is a no-op
    p1.hand = ["tactician"];
    Dominion.engine.actions.play(g, "p1", { cardId: "tactician" });
    eq(p1.tacticianActive, false, "not activated on an empty hand");
  });
  t("seaside: tide pools draws 3 and discards 2 next turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["tide_pools"], seed: 128 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["tide_pools"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "silver", "gold"];
    Dominion.engine.actions.play(g, "p1", { cardId: "tide_pools" });
    eq(p1.hand.length, 3, "+3 Cards");
    eq(p1.actions, 1, "+1 Action");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.hand.length, 3, "5 drawn minus 2 discarded");
    eq(p1.discard.filter((c) => c === "copper").length >= 2, true, "two coppers discarded (default)");
  });
  t("seaside: treasure map pair gains 4 Golds onto the deck", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["treasure_map"], seed: 129 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["treasure_map", "treasure_map", "copper"];
    p1.deck = ["estate", "estate", "estate", "estate"];
    Dominion.engine.actions.play(g, "p1", { cardId: "treasure_map" });
    assert(g.trash.filter((c) => c === "treasure_map").length === 2, "both treasure maps trashed");
    eq(p1.deck.filter((c) => c === "gold").length, 4, "4 Golds onto the deck");
    assert(p1.play.indexOf("treasure_map") === -1, "played map not in play");
    assert(p1.hand.indexOf("treasure_map") === -1, "no map left in hand");
  });
  t("seaside: treasury topdecks itself only when no Victory was gained", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["treasury"], seed: 130 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["treasury"];
    p1.deck = ["copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "treasury" });
    eq(p1.coins, 1, "+$1");
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // buy → cleanup → ...
    eq(g.log.some((l) => l.t === "treasuryTopdeck"), true, "treasury topdecked at end of buy");
    assert(p1.play.indexOf("treasury") === -1, "treasury left play");
    // with a Victory gained, it stays put and is discarded at cleanup
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["treasury"], seed: 131 });
    Dominion.engine.beginTurn(g2, "p1");
    const q1 = Dominion.engine.player(g2, "p1");
    q1.hand = ["treasury"];
    q1.deck = ["copper", "copper"];
    Dominion.engine.actions.play(g2, "p1", { cardId: "treasury" });
    Dominion.engine.advancePhase(g2); // → buy
    q1.coins = 8; q1.hand = ["copper"];
    Dominion.engine.buy(g2, "p1", "province");
    Dominion.engine.advancePhase(g2); // buy → cleanup
    eq(g2.log.some((l) => l.t === "treasuryTopdeck"), false, "no topdeck after gaining a Victory");
    assert(q1.duration.indexOf("treasury") === -1 && q1.oldDur.indexOf("treasury") === -1, "treasury not kept out as a duration");
    assert(q1.hand.concat(q1.deck).concat(q1.discard).indexOf("treasury") !== -1, "treasury discarded at cleanup, then drawn back");
  });
  t("seaside: warehouse draws 3 and discards 3", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["warehouse"], seed: 132 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["warehouse", "copper", "copper", "silver"];
    p1.deck = ["gold", "gold", "gold"];
    Dominion.engine.actions.play(g, "p1", { cardId: "warehouse" });
    eq(p1.hand.length, 3, "6 drawn, 3 discarded");
    eq(p1.discard.length, 3, "3 discarded");
  });
  t("seaside: wharf +2 cards +1 buy now and next turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["wharf"], seed: 133 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["wharf"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "copper", "copper", "silver"];
    Dominion.engine.actions.play(g, "p1", { cardId: "wharf" });
    eq(p1.hand.length, 2, "+2 Cards");
    eq(p1.buys, 2, "+1 Buy");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.buys, 1 + 1, "+1 Buy next turn");
    eq(p1.hand.length, 5 + 2, "5 drawn + wharf's 2");
  });
  t("seaside: astrolabe gives +1 Buy +$1 now and next turn", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["astrolabe"], seed: 134 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["astrolabe", "silver"];
    p1.deck = ["copper", "copper"];
    const res = Dominion.engine.treasures.playAll(g, "p1");
    eq(res.coins, 2, "base treasure value: silver $2 (astrolabe grants its $1 via state)");
    eq(p1.coins, 3, "astrolabe +$1 now");
    eq(p1.buys, 2, "+1 Buy now");
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    eq(g.turnPlayer, "p1", "back to p1");
    eq(p1.coins, 1, "+$1 next turn");
    eq(p1.buys, 1 + 1, "+1 Buy next turn");
  });

  /* ══════════════════════ Tasks 120–133: Alchemy ══════════════ */
  t("alchemy: pin — 12 cards, potion costs, vineyard pile", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "seaside", "alchemy", "prosperity"]);
    const ids = Dominion.cards.all().filter((c) => c.expansion === "alchemy").map((c) => c.id).sort();
    deepEq(ids, ["alchemist","apothecary","apprentice","familiar","golem","herbalist","philosophers_stone","possession","scrying_pool","transmute","university","vineyard"], "12 alchemy cards");
    eq(Dominion.cards.get("vineyard").pileSize, 12, "vineyard pile 12");
    assert(Dominion.cards.get("potion").types.indexOf("Treasure") !== -1, "potion is a Treasure");
    eq(Dominion.cards.get("potion").cost.coins, 4, "potion costs $4");
    eq(Dominion.cards.get("possession").cost.coins, 6, "possession costs $6");
    eq(Dominion.cards.get("possession").cost.potion, 1, "possession needs a Potion");
    eq(Dominion.cards.get("transmute").cost.potion, 1, "transmute is Potion-only");
  });
  t("alchemy: potion buying, playing, and paying the potion cost", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["alchemist"], seed: 135 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    eq(Dominion.engine.canBuy(g, "p1", "alchemist"), false, "cannot buy alchemist without a Potion");
    eq(Dominion.engine.canBuy(g, "p1", "potion"), false, "cannot buy a Potion with only $0 income");
    p1.coins = 4; p1.buys = 1;
    Dominion.engine.buy(g, "p1", "potion");
    eq(p1.potions, 0, "buying a Potion does not itself give a Potion");
    eq(Dominion.engine.canBuy(g, "p1", "alchemist"), false, "potion in discard gives no potion yet");
    // next turn: force the potion into hand and play it
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); Dominion.engine.advancePhase(g); // → p1
    p1.hand = ["potion"];
    p1.deck = [];
    Dominion.engine.treasures.playAll(g, "p1");
    eq(p1.potions, 1, "playing the Potion gives a Potion");
    p1.coins = 3;
    eq(Dominion.engine.canBuy(g, "p1", "alchemist"), true, "can buy alchemist with a potion");
    p1.coins = 3;
    Dominion.engine.buy(g, "p1", "alchemist");
    eq(p1.potions, 0, "potion consumed");
    assert(p1.discard.indexOf("alchemist") !== -1, "alchemist gained");
  });
  t("alchemy: artisan-style gainers exclude Potion-cost cards", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["artisan", "alchemist"], seed: 136 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["artisan"];
    g.decide = (s, q) => (q.type === "gainCard" ? "alchemist" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "artisan" });
    assert(p1.discard.indexOf("alchemist") === -1, "alchemist (Potion cost) cannot be gained by artisan");
  });
  t("alchemy: alchemist draws 2 and topdecks itself with a Potion in play", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["alchemist"], seed: 137 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["alchemist", "potion"];
    p1.deck = ["copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "alchemist" });
    eq(p1.hand.length, 3, "+2 Cards (potion still in hand)");
    eq(p1.actions, 1, "+1 Action");
    Dominion.engine.treasures.playAll(g, "p1"); // play the potion
    g.decide = (s, q) => (q.type === "alchemistTopdeck" ? true : null);
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // buy → cleanup (alchemist topdecked)
    assert(g.log.some((l) => l.t === "alchemistTopdeck"), "alchemistTopdeck logged");
    assert(p1.discard.indexOf("alchemist") === -1, "alchemist was topdecked, not discarded");
    assert(p1.hand.indexOf("alchemist") !== -1, "alchemist topdecked then drawn into hand");
    eq(p1.duration.length, 0, "alchemist is not a duration");
  });
  t("alchemy: apothecary reveals top 4 and keeps Coppers and Potions", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["apothecary"], seed: 138 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["apothecary"];
    p1.deck = ["gold", "copper", "potion", "estate", "silver"]; // top 4: estate, potion, copper, gold
    Dominion.engine.actions.play(g, "p1", { cardId: "apothecary" });
    eq(p1.hand.length, 3, "+1 card, + copper, + potion into hand");
    assert(p1.hand.indexOf("copper") !== -1 && p1.hand.indexOf("potion") !== -1, "copper and potion to hand");
    assert(p1.hand.indexOf("gold") === -1 && p1.hand.indexOf("estate") === -1, "gold and estate back on deck");
    eq(p1.deck.length, 2, "gold, estate back on deck (silver drawn by +1 Card)");
  });
  t("alchemy: apprentice draws cost plus 2 for Potion cards", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["apprentice"], seed: 139 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["apprentice", "silver"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "copper", "copper", "copper"];
    g.decide = (s, q) => (q.type === "trashAny" ? 0 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "apprentice" });
    eq(p1.hand.length, 3, "silver ($3) trashed, drew 3, had 1 left");
    // a Potion-cost card draws 2 extra
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["apprentice", "alchemist"], seed: 140 });
    Dominion.engine.beginTurn(g2, "p1");
    const q1 = Dominion.engine.player(g2, "p1");
    q1.hand = ["apprentice", "alchemist"];
    q1.deck = ["copper", "copper", "copper", "copper", "copper", "copper", "copper", "copper"];
    g2.decide = (s, q) => (q.type === "trashAny" ? 0 : null);
    Dominion.engine.actions.play(g2, "p1", { cardId: "apprentice" });
    eq(q1.hand.length, 5, "alchemist ($3+P): 1 left + 3 + 2 extra");
  });
  t("alchemy: familiar gives curses to others", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["familiar"], seed: 141 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["familiar"];
    p1.deck = ["copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "familiar" });
    eq(p1.hand.length, 1, "+1 Card");
    eq(p1.actions, 1, "+1 Action");
    assert(p2.discard.indexOf("curse") !== -1, "p2 gained a Curse");
  });
  t("alchemy: golem reveals two non-Golem actions and plays them free", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["golem", "festival"], seed: 142 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["golem"];
    p1.deck = ["festival", "festival", "copper", "gold"];
    Dominion.engine.actions.play(g, "p1", { cardId: "golem" });
    eq(p1.actions, 4, "2 actions played free + the base action (festival grants +2 each)");
    eq(p1.coins, 4, "two festivals produce $4");
    assert(p1.play.filter((c) => c === "festival").length === 2, "both festivals in play");
    assert(p1.discard.indexOf("copper") !== -1 && p1.discard.indexOf("gold") !== -1, "revealed non-actions discarded");
  });
  t("alchemy: herbalist returns a Treasure from play on top of the deck", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["herbalist"], seed: 143 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["herbalist", "silver"];
    g.decide = (s, q) => (q.type === "herbalistReturn" ? "silver" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "herbalist" });
    eq(p1.buys, 2, "+1 Buy");
    eq(p1.coins, 1, "+$1");
    Dominion.engine.treasures.playAll(g, "p1");
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // buy → cleanup
    assert(g.log.some((l) => l.t === "herbalistReturn" && l.card === "silver"), "silver topdecked by herbalist");
    assert(p1.discard.indexOf("silver") === -1, "silver not discarded");
    assert(p1.hand.concat(p1.deck).indexOf("silver") !== -1, "silver drawn back from the top of the deck");
    eq(p1.duration.length, 0, "herbalist is not kept out");
  });
  t("alchemy: philosopher's stone gives $1 per 5 cards in deck+discard", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["philosophers_stone"], seed: 144 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["philosophers_stone"];
    p1.deck = ["copper", "copper", "copper", "copper", "copper", "copper"];
    p1.discard = ["copper", "copper", "copper", "copper", "copper", "copper", "copper", "copper"];
    const res = Dominion.engine.treasures.playAll(g, "p1");
    eq(res.coins, 2, "14 cards → floor(14/5) = $2");
  });
  t("alchemy: scrying pool screens every player's top card then draws through", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["scrying_pool", "village"], seed: 145 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["scrying_pool"];
    p1.deck = ["village", "copper", "silver", "gold"];
    p2.deck = ["gold", "estate"];
    g.decide = (s, q) => {
      if (q.type !== "scryingTop") return null;
      return q.target === "p1" ? "keep" : "discard";
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "scrying_pool" });
    eq(p1.actions, 1, "+1 Action");
    assert(p2.discard.indexOf("estate") !== -1, "p2's top card discarded");
    assert(p1.hand.indexOf("copper") !== -1 && p1.hand.indexOf("silver") !== -1 && p1.hand.indexOf("gold") !== -1, "non-actions to hand");
    assert(p1.discard.indexOf("village") !== -1, "the revealed action is discarded");
  });
  t("alchemy: transmute maps trashed types to gains", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["transmute", "nobles"], seed: 146 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["transmute", "transmute", "transmute", "transmute", "transmute", "estate", "copper", "nobles", "curse"];
    p1.actions = 10;
    g.decide = (s, q) => {
      if (q.type !== "trashAny") return null;
      const idx = q.hand.map((id, i) => ({ id, i })).filter((o) => o.id !== "transmute").sort((a, b) => a.i - b.i)[0];
      return idx ? idx.i : null;
    };
    for (let k = 0; k < 5; k++) Dominion.engine.actions.play(g, "p1", { cardId: "transmute" });
    eq(p1.actions, 5, "five transmutes at one Action each");
    // order trashed: estate → gold, copper → transmute, nobles → duchy, curse → nothing, then a transmute gained earlier can be replayed
    assert(p1.discard.indexOf("gold") !== -1, "Victory → Gold");
    assert(p1.discard.indexOf("duchy") !== -1, "Action → Duchy");
    eq(p1.discard.filter((c) => c === "transmute").length >= 1, true, "Treasure → Transmute");
  });
  t("alchemy: university gains an Action card up to $5", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["university", "village"], seed: 147 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["university"];
    g.decide = (s, q) => (q.type === "gainCard" ? "village" : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "university" });
    eq(p1.actions, 2, "+2 Actions");
    assert(p1.discard.indexOf("village") !== -1, "gained a village");
    // a Potion-cost action is not gainable
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["university", "alchemist"], seed: 148 });
    Dominion.engine.beginTurn(g2, "p1");
    const q1 = Dominion.engine.player(g2, "p1");
    q1.hand = ["university"];
    g2.decide = (s, q) => (q.type === "gainCard" ? "alchemist" : null);
    Dominion.engine.actions.play(g2, "p1", { cardId: "university" });
    assert(q1.discard.indexOf("alchemist") === -1, "alchemist (Potion cost) not gainable");
  });
  t("alchemy: vineyard scores 1 VP per 3 action cards", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["vineyard"], seed: 149 });
    const p1 = Dominion.engine.player(g, "p1");
    p1.deck = ["vineyard", "village", "village", "village", "smithy", "smithy"];
    const s = Dominion.engine.score(g, "p1");
    eq(s.vineyard, 2, "6 action cards (incl. vineyard itself) → 1 VP per 3");
  });

  /* ═══════════ Tasks 134–135: Prosperity basics ═══════════ */
  t("prosperity: pin — 25 2E kingdom cards plus Colony and Platinum", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "seaside", "alchemy", "prosperity"]);
    const ids = Dominion.cards.all().filter((c) => c.expansion === "prosperity").map((c) => c.id).sort();
    deepEq(ids, ["anvil","bank","bishop","charlatan","city","clerk","collection","colony","crystal_ball","expand","forge","grand_market","hoard","investment","kings_court","magnate","mint","monument","peddler","platinum","quarry","rabble","tiara","vault","war_chest","watchtower","workers_village"], "27 prosperity cards");
    const colony = Dominion.cards.get("colony");
    eq(colony.cost.coins, 11, "colony costs $11");
    eq(colony.vp, 10, "colony is worth 10 VP");
    deepEq(colony.pileSize, { "2": 8, "3": 12 }, "colony pile scales");
    const platinum = Dominion.cards.get("platinum");
    eq(platinum.cost.coins, 9, "platinum costs $9");
    eq(platinum.treasure, 5, "platinum produces $5");
    for (const bad of ["contraband","counting_house","goons","loan","mountebank","royal_seal","talisman","trade_route","venture"]) {
      assert(Dominion.cards.get(bad) === null, bad + " is not in 2nd Edition");
    }
  });
  t("prosperity: colony and platinum supply appear with a prosperity kingdom", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["anvil"], seed: 150 });
    eq(g.supply.colony, 8, "colony pile 8 at 2 players");
    eq(g.supply.platinum, 12, "platinum pile 12");
    const g3 = Dominion.engine.setup({ players: 3, kingdom: ["anvil"], seed: 151 });
    eq(g3.supply.colony, 12, "colony pile 12 at 3 players");
    const gn = Dominion.engine.setup({ players: 2, kingdom: ["village"], seed: 152 });
    assert(!("colony" in gn.supply), "no colony without prosperity");
    assert(!("platinum" in gn.supply), "no platinum without prosperity");
  });
  t("prosperity: random kingdom and pickers exclude colony/platinum", async () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: "prosperity", seed: 153 });
    assert(g.kingdom.indexOf("colony") === -1 && g.kingdom.indexOf("platinum") === -1, "extras never picked into the kingdom");
    assert(g.kingdom.indexOf("platinum") === -1, "platinum not in kingdom");
    eq(g.supply.platinum, 12, "but the platinum pile exists");
  });
  t("prosperity: colony ends the game, scores 10, and is unbuyable when empty", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["anvil"], seed: 154 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["platinum", "platinum", "platinum"];
    const res = Dominion.engine.treasures.playAll(g, "p1");
    eq(res.coins, 15, "three platinums produce $15");
    eq(Dominion.engine.canBuy(g, "p1", "colony"), true, "can buy a colony at $15");
    p1.coins = 11; p1.buys = 1;
    Dominion.engine.buy(g, "p1", "colony");
    assert(p1.discard.indexOf("colony") !== -1, "colony gained");
    // empty the colony pile → game ends at the next turn boundary
    g.supply.colony = 0;
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // buy → cleanup → draw → end
    eq(g.over, true, "game over with the colony pile empty");
    const s = Dominion.engine.score(g, "p1");
    eq(s.colony, 10, "colony scores 10 VP");
    assert(Dominion.engine.canBuy(g, "p1", "colony") === false, "empty colony pile unbuyable");
  });

  /* ══════════════════ Tasks 136–161: Prosperity 2E effects ══════ */
  t("prosperity: monument gives +$2 and a VP token, counted in score", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["monument"], seed: 160 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["monument"];
    p1.deck = ["copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "monument" });
    eq(p1.coins, 2, "+$2");
    eq(p1.vpTokens, 1, "+1 VP token");
    const s = Dominion.engine.score(g, "p1");
    eq(s.tokens, 1, "tokens counted in the score breakdown");
  });
  t("prosperity: bishop trashes a card for VP tokens and makes others trash", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["bishop"], seed: 161 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bishop", "silver"];
    g.decide = (s, q) => {
      if (q.type !== "trashAny") return null;
      return q.hand.indexOf("silver");
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "bishop" });
    eq(p1.coins, 1, "+$1");
    eq(p1.vpTokens, 1 + Math.floor(3 / 2), "1 base + floor(silver cost 3 / 2)");
    assert(g.trash.indexOf("silver") !== -1, "silver trashed");
    eq(g.trash.filter((c) => c === "silver").length, 1, "exactly one silver trashed");
  });
  t("prosperity: bank produces $1 per Treasure in play", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["bank"], seed: 162 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["bank", "copper", "silver"];
    const res = Dominion.engine.treasures.playAll(g, "p1");
    eq(res.coins, 3, "bank $0 + copper $1 + silver $2 base");
    eq(p1.coins, 6, "bank's own effect adds $1 per treasure in play (3) on top");
  });
  t("prosperity: charlatan curses others and Curse becomes a $1 Treasure", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["charlatan"], seed: 163 });
    eq(g.charlatan, true, "charlatan flag set for the kingdom");
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["charlatan"];
    p1.deck = ["copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "charlatan" });
    eq(p1.coins, 2, "+$2");
    assert(p2.discard.indexOf("curse") !== -1, "p2 gained a Curse");
    p2.hand = ["curse"]; p2.deck = [];
    const res = Dominion.engine.treasures.playAll(g, "p2");
    eq(res.coins, 1, "the Curse plays as a $1 Treasure");
    assert(p2.play.indexOf("curse") !== -1, "the Curse is in play");
  });
  t("prosperity: city scales with empty piles", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["city"], seed: 164 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.actions = 5;
    p1.hand = ["city"];
    p1.deck = ["copper", "copper", "copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "city" });
    eq(p1.actions, 5 - 1 + 2, "+2 Actions");
    eq(p1.hand.length, 1, "+1 Card with no empty piles");
    eq(p1.buys, 1, "no extra buy yet");
    g.supply.province = 0;
    p1.hand.push("city");
    Dominion.engine.actions.play(g, "p1", { cardId: "city" });
    eq(p1.hand.length, 3, "+2 Cards with one empty pile (drew +1 more)");
    g.supply.copper = 0;
    p1.hand.push("city");
    p1.deck.push("copper");
    Dominion.engine.actions.play(g, "p1", { cardId: "city" });
    eq(p1.buys, 1 + 1, "+1 Buy with two empty piles");
    eq(p1.coins, 1, "+$1 with two empty piles");
  });
  t("prosperity: clerk attack topdecks and plays again at turn start", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["clerk"], seed: 165 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["clerk"];
    p1.deck = ["copper", "copper", "copper"];
    p2.hand = ["copper", "silver", "gold", "estate", "estate"];
    g.decide = (s, q) => (q.type === "topdeckTop" ? 0 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "clerk" });
    eq(p1.coins, 2, "+$2");
    eq(p2.hand.length, 4, "p2 topdecked a card");
    eq(p2.deck[p2.deck.length - 1], "copper", "topdecked card on top of the deck");
    p1.deck = ["clerk"];
    p1.discard = [];
    g.decide = (s, q) => (q.type === "clerkPlay" ? true : null);
    Dominion.engine.advancePhase(g); // → buy
    Dominion.engine.advancePhase(g); // → p2
    Dominion.engine.advancePhase(g); // p2 → buy
    Dominion.engine.advancePhase(g); // p2 → p1 turn 2
    eq(g.turnPlayer, "p1", "back to p1");
    assert(p1.play.indexOf("clerk") !== -1, "clerk replayed from hand at turn start");
    assert(g.log.some((l) => l.t === "clerkPlay"), "clerkPlay logged");
  });
  t("prosperity: collection pays $1 per gained Action", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["collection", "village"], seed: 166 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["collection"];
    p1.coins = 0;
    Dominion.engine.actions.play(g, "p1", { cardId: "collection" });
    eq(p1.buys, 2, "+1 Buy");
    eq(p1.collectionActive, true, "collection active");
    p1.coins = 3; p1.hand = ["copper"];
    Dominion.engine.buy(g, "p1", "village");
    eq(p1.coins, 1, "village cost 3, collection paid $1 back");
    assert(g.log.some((l) => l.t === "collection"), "collection bonus logged");
  });
  t("prosperity: crystal ball trashes, discards, or plays the top card", () => {
    const trash = Dominion.engine.setup({ players: 2, kingdom: ["crystal_ball"], seed: 167 });
    Dominion.engine.beginTurn(trash, "p1");
    const t1 = Dominion.engine.player(trash, "p1");
    t1.hand = ["crystal_ball"];
    t1.deck = ["curse"];
    trash.decide = (s, q) => (q.type === "crystalBallUse" ? "trash" : null);
    Dominion.engine.actions.play(trash, "p1", { cardId: "crystal_ball" });
    assert(trash.trash.indexOf("curse") !== -1, "curse trashed");
    const play = Dominion.engine.setup({ players: 2, kingdom: ["crystal_ball"], seed: 168 });
    Dominion.engine.beginTurn(play, "p1");
    const t2 = Dominion.engine.player(play, "p1");
    t2.hand = ["crystal_ball"];
    t2.deck = ["copper"];
    play.decide = (s, q) => (q.type === "crystalBallUse" ? "play" : null);
    Dominion.engine.actions.play(play, "p1", { cardId: "crystal_ball" });
    assert(t2.play.indexOf("copper") !== -1, "copper played from the top of the deck");
    const disc = Dominion.engine.setup({ players: 2, kingdom: ["crystal_ball"], seed: 169 });
    Dominion.engine.beginTurn(disc, "p1");
    const t3 = Dominion.engine.player(disc, "p1");
    t3.hand = ["crystal_ball"];
    t3.deck = ["gold"];
    disc.decide = (s, q) => (q.type === "crystalBallUse" ? "discard" : null);
    Dominion.engine.actions.play(disc, "p1", { cardId: "crystal_ball" });
    assert(t3.discard.indexOf("gold") !== -1, "gold discarded");
  });
  t("prosperity: expand gains a card up to $3 more than the trashed card", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["expand", "gold"], seed: 170 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["expand", "silver"];
    p1.deck = ["copper"];
    g.decide = (s, q) => {
      if (q.type === "trashAny") return q.hand.indexOf("silver");
      if (q.type === "gainCard") return "gold";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "expand" });
    assert(g.trash.indexOf("silver") !== -1, "silver trashed");
    assert(p1.discard.indexOf("gold") !== -1, "gold gained (cost 6 = 3 + 3)");
    eq(p1.actions, 0, "expand does not grant actions");
  });
  t("prosperity: forge gains a card costing exactly the trashed total", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["forge"], seed: 171 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["forge", "silver", "copper"];
    p1.deck = ["copper"];
    g.decide = (s, q) => {
      if (q.type === "trashUpTo") return [0, 1];
      if (q.type === "gainCard") return "silver";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "forge" });
    eq(p1.discard.filter((c) => c === "silver").length, 1, "gained a silver worth exactly 3 = 3 + 0");
    eq(p1.discard.filter((c) => c === "copper").length, 0, "both coppers left play (1 trashed, 1 drawn)");
  });
  t("prosperity: grand market is blocked with Copper in play", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["grand_market"], seed: 172 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.play = ["copper"];
    eq(Dominion.engine.canBuy(g, "p1", "grand_market"), false, "cannot buy with Copper in play");
    p1.play = [];
    p1.coins = 6;
    eq(Dominion.engine.canBuy(g, "p1", "grand_market"), true, "buyable without Copper in play");
    Dominion.engine.buy(g, "p1", "grand_market");
    assert(p1.discard.indexOf("grand_market") !== -1, "grand market gained");
  });
  t("prosperity: hoard gains a Gold when you buy a Victory card", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["hoard"], seed: 173 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["hoard"];
    p1.deck = ["copper"];
    Dominion.engine.treasures.playAll(g, "p1");
    eq(p1.coins, 2, "+$2");
    eq(p1.hoardActive, true, "hoard active");
    p1.coins = 4; p1.hand = ["copper"];
    Dominion.engine.buy(g, "p1", "estate");
    assert(p1.discard.indexOf("gold") !== -1, "gold gained from the bought Victory");
  });
  t("prosperity: investment pays $2 or reveals for coins", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["investment"], seed: 174 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["investment", "copper", "silver"];
    p1.deck = ["copper"];
    g.decide = (s, q) => {
      if (q.type === "trashAny") return q.hand.indexOf("copper");
      if (q.type === "investmentMode") return "coins";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "investment" });
    eq(p1.coins, 2, "+$2 coins mode");
    assert(p1.play.indexOf("investment") !== -1, "investment stays in play in coins mode");
    const g2 = Dominion.engine.setup({ players: 2, kingdom: ["investment"], seed: 175 });
    Dominion.engine.beginTurn(g2, "p1");
    const q1 = Dominion.engine.player(g2, "p1");
    q1.hand = ["investment", "copper", "silver"];
    g2.decide = (s, q) => {
      if (q.type === "trashAny") return q.hand.indexOf("copper");
      if (q.type === "investmentMode") return "reveal";
      return null;
    };
    Dominion.engine.actions.play(g2, "p1", { cardId: "investment" });
    eq(q1.coins, 1, "reveal mode: $1 per unique Treasure name in hand (silver)");
    assert(g2.trash.indexOf("investment") !== -1, "investment trashed in reveal mode");
  });
  t("prosperity: kings court plays an action three times", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["kings_court", "festival"], seed: 176 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["kings_court", "festival"];
    p1.deck = ["copper"];
    g.decide = (s, q) => (q.type === "playActionThrice" ? 0 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "kings_court" });
    eq(p1.actions, 6, "festival thrice: +2 Actions each");
    eq(p1.coins, 6, "festival thrice: +$2 each");
    eq(p1.play.filter((c) => c === "festival").length, 1, "one festival in play, its effect resolved three times");
  });
  t("prosperity: magnate draws a card per Treasure in hand", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["magnate"], seed: 177 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["magnate", "copper", "silver"];
    p1.deck = ["gold", "gold"];
    Dominion.engine.actions.play(g, "p1", { cardId: "magnate" });
    eq(p1.hand.length, 4, "2 treasures revealed → 2 cards drawn");
  });
  t("prosperity: mint gains a copy and its gain trashes played Treasures", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["mint"], seed: 178 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["mint", "copper", "silver"];
    p1.deck = ["copper"];
    g.decide = (s, q) => (q.type === "mintCopy" ? 0 : null);
    Dominion.engine.actions.play(g, "p1", { cardId: "mint" });
    assert(p1.discard.indexOf("copper") !== -1, "a copper copied from hand");
    // gaining a mint trashes every non-Duration Treasure in play
    p1.play = ["copper", "silver", "gold"];
    p1.coins = 5; p1.hand = ["copper"];
    Dominion.engine.buy(g, "p1", "mint");
    eq(g.trash.filter((c) => ["copper", "silver", "gold"].indexOf(c) !== -1).length, 3, "all non-Duration Treasures in play trashed");
    assert(g.log.some((l) => l.t === "mintTrash"), "mintTrash logged");
  });
  t("prosperity: peddler and quarry apply dynamic buy costs", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["peddler", "quarry", "village", "market"], seed: 179 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    eq(Dominion.engine.dynamicCost(g, "p1", "peddler"), 8, "peddler costs 8 alone");
    p1.play = ["village", "market"];
    eq(Dominion.engine.dynamicCost(g, "p1", "peddler"), 4, "peddler costs $2 less per Action in play");
    eq(Dominion.engine.canBuy(g, "p1", "peddler"), false, "not affordable at $0");
    p1.coins = 4;
    eq(Dominion.engine.canBuy(g, "p1", "peddler"), true, "affordable at $4 with the discount");
    eq(Dominion.engine.dynamicCost(g, "p1", "village"), 3, "village costs 3 without quarry");
    p1.quarryActive = true;
    eq(Dominion.engine.dynamicCost(g, "p1", "village"), 2, "quarry makes Actions cost $1 less");
    eq(Dominion.engine.dynamicCost(g, "p1", "peddler"), 4, "quarry does not stack onto peddler's own discount");
  });
  t("prosperity: rabble discards Actions and Treasures from opponents' decks", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["rabble"], seed: 180 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["rabble"];
    p1.deck = ["copper", "copper", "copper"];
    p2.deck = ["estate", "curse", "gold", "village"];
    Dominion.engine.actions.play(g, "p1", { cardId: "rabble" });
    eq(p1.hand.length, 3, "+3 Cards");
    assert(p2.discard.indexOf("village") !== -1, "the revealed Action was discarded");
    assert(p2.discard.indexOf("gold") !== -1, "the revealed Treasure was discarded");
    assert(p2.deck.indexOf("curse") !== -1, "the revealed non-Action/Treasure stays on deck");
    assert(p2.deck.indexOf("estate") !== -1, "the untouched card stays on deck");
  });
  t("prosperity: tiara double-plays a Treasure and topdecks gains", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["tiara"], seed: 181 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["tiara", "silver", "copper"];
    p1.deck = ["copper"];
    g.decide = (s, q) => {
      if (q.type === "tiaraDouble") return q.hand.indexOf("silver");
      if (q.type === "tiaraTopdeck") return true;
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "tiara" });
    eq(p1.buys, 2, "+1 Buy");
    eq(p1.coins, 4, "silver double-played for $4");
    assert(p1.play.indexOf("silver") !== -1, "the silver is in play");
    p1.coins = 4; p1.hand = ["copper"];
    Dominion.engine.buy(g, "p1", "estate");
    eq(p1.deck[p1.deck.length - 1], "estate", "the gained estate was topdecked");
    assert(p1.discard.indexOf("estate") === -1, "estate not left in discard");
  });
  t("prosperity: vault draws 2 and trades discarded Treasures for coins", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["vault"], seed: 182 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    const p2 = Dominion.engine.player(g, "p2");
    p1.hand = ["vault", "copper", "silver"];
    p1.deck = ["gold", "gold"];
    p2.hand = ["copper", "silver", "gold", "estate"];
    g.decide = (s, q) => {
      if (q.type === "vaultDiscard") return [0, 1];
      if (q.type === "vaultOpp") return true;
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "vault" });
    eq(p1.hand.length, 2, "+2 Cards, discarded the two starting Treasures");
    eq(p1.coins, 2, "+$1 per discarded Treasure");
    eq(p2.hand.length, 4 - 2 + 1, "p2 discarded 2 and drew 1");
    assert(p2.discard.indexOf("copper") !== -1, "p2's cheapest Treasure discarded");
  });
  t("prosperity: war chest bans a named card and gains another up to $5", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["war_chest", "village"], seed: 183 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["war_chest"];
    p1.deck = ["copper"];
    g.decide = (s, q) => {
      if (q.type === "warChestName") return "village";
      if (q.type === "gainCard") return "silver";
      return null;
    };
    Dominion.engine.actions.play(g, "p1", { cardId: "war_chest" });
    eq(p1.warChestNamed.join(), "village", "the named card is remembered");
    assert(p1.discard.indexOf("silver") !== -1, "a card up to $5 (not the named one) gained");
    assert(p1.discard.indexOf("village") === -1, "the named card was not gained");
  });
  t("prosperity: watchtower draws to 6 and reacts to gains", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["watchtower"], seed: 184 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["watchtower"];
    p1.deck = ["copper", "copper", "copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "watchtower" });
    eq(p1.hand.length, 3, "drew up to a 6-card hand (only 3 in deck)");
    p1.hand = ["watchtower", "copper"];
    p1.deck = [];
    g.decide = (s, q) => (q.type === "watchtowerUse" ? "trash" : null);
    p1.coins = 3;
    Dominion.engine.buy(g, "p1", "silver");
    assert(g.trash.indexOf("silver") !== -1, "the gained silver was trashed by the watchtower reaction");
    assert(p1.discard.indexOf("silver") === -1, "the silver never hit the discard");
  });
  t("prosperity: anvil discards a Treasure and gains up to $4", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["anvil"], seed: 185 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["anvil", "copper", "silver"];
    p1.deck = ["copper"];
    g.decide = (s, q) => {
      if (q.type === "anvilDiscard") return q.hand.indexOf("silver");
      if (q.type === "gainCard") return "silver";
      return null;
    };
    Dominion.engine.treasures.play(g, "p1", { cardIds: ["anvil"] });
    eq(p1.coins, 1, "+$1");
    eq(p1.discard.filter((c) => c === "silver").length, 2, "discarded silver + gained silver");
  });
  t("prosperity: workers village gives +1 card, +2 actions, +1 buy", () => {
    const g = Dominion.engine.setup({ players: 2, kingdom: ["workers_village"], seed: 186 });
    Dominion.engine.beginTurn(g, "p1");
    const p1 = Dominion.engine.player(g, "p1");
    p1.hand = ["workers_village"];
    p1.deck = ["copper"];
    Dominion.engine.actions.play(g, "p1", { cardId: "workers_village" });
    eq(p1.hand.length, 1, "+1 Card");
    eq(p1.actions, 2, "+2 Actions");
    eq(p1.buys, 2, "+1 Buy");
  });
  t("prosperity: AI full game runs with a prosperity kingdom", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "seaside", "alchemy", "prosperity"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["bank", "bishop", "charlatan", "city", "hoard", "kings_court", "peddler", "rabble", "vault", "watchtower"], seed: 201 });
    g.decide = (s, q) => Dominion.ai.choose(s, q.player, q);
    Dominion.engine.beginTurn(g, "p1");
    let guard = 0;
    while (!g.over && guard++ < 300) {
      await Dominion.ai.playTurn(g, g.turnPlayer);
    }
    assert(g.over, "prosperity game finished");
    const res = Dominion.engine.score(g, "p1");
    assert(typeof res.total === "number", "scored");
  });

  /* ══════════ AI game completes with the new sets (smoke) ══════ */
  t("smoke: full AI game runs to completion with the new cards", async () => {
    await Dominion.cards.init(["base", "base-kingdom", "intrigue", "seaside", "alchemy", "prosperity"]);
    const g = Dominion.engine.setup({ players: 2, kingdom: ["torturer", "upgrade", "caravan", "wharf", "treasury", "alchemist", "apothecary", "transmute", "salvager", "fishing_village"], seed: 200 });
    g.decide = (s, q) => Dominion.ai.choose(s, q.player, q);
    Dominion.engine.beginTurn(g, "p1");
    let guard = 0;
    while (!g.over && guard++ < 300) {
      await Dominion.ai.playTurn(g, g.turnPlayer);
    }
    assert(g.over, "game finished");
    const res = Dominion.engine.score(g, "p1");
    assert(typeof res.total === "number", "scored");
  });

  /* ── Runner ── */
  async function runAll() {
    results.passed = [];
    results.failed = [];
    let ran = 0;
    for (const s of suites) {
      if (selectedSuites !== null && !selectedSuites.has(s.name)) continue;
      // Stabilize the catalog before each suite: the core suite runs
      // on the shipped installed sets (mirrors the ?tests=1 page
      // boot), and each exp suite loads installed + its own set. This
      // also guards against the page boot's async ensureCards racing
      // with a direct runAll() call.
      if (s.name === "core") await Dominion.cards.init(Dominion.SETS.installed);
      else if (s.opts && s.opts.set) {
        await Dominion.cards.init(Dominion.SETS.installed.concat([s.opts.set]));
      }
      for (const c of s.cases) {
        ran++;
        try { await c.fn(); results.passed.push(c.name); }
        catch (e) { results.failed.push({ name: c.name, error: (e && e.message) || String(e) }); }
      }
    }
    lastRanCount = ran;
    return summary();
  }

  function summary() {
    return {
      passed: results.passed.length,
      failed: results.failed.length,
      total: lastRanCount,
      failures: results.failed.slice()
    };
  }

  global.DominionTest = { t, defineSuite, select, runAll, summary, results, assert, eq, deepEq, scenario };

})(typeof self !== "undefined" ? self : globalThis);
