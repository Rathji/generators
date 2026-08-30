// Cost payment engine tests (roadmap Phase 5, task 18): cost parsing, pool-feasibility,
// mana-source enumeration, payment planning (pool-first / sources-first strategies), X
// resolution (free X=0, max X, {X}{X}), dual-land colour choice, and the end-to-end
// pay-then-cast flow through the five-realms-plugin reducer. Since task 22 injected the
// full Alpha DB into the engine, injected Alpha cards are safe even through reducer
// rounds; pure-plan tests still prefer them for their simple, hand-rolled costs.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import * as mana from "./mana.js";
import { parseCost, canPayPool, manaSources, buildPayment, executePayment, payCost, maxAffordableX } from "./cost.js";
import { PLUGIN_CARD_MAP } from "../cards/plugin.js";

function fixtureDecks() {
  // engine.newGame merges the Alpha DB over the fixtures (task 22), so filter to
  // plugin-known fixture cards only — deterministic decks, no Alpha cards in play.
  const ids = root.fr("cards").map((c) => c.id).filter((id) => !PLUGIN_CARD_MAP[id]);
  const deck = [];
  for (let i = 0; i < 40; i++) deck.push(ids[i % ids.length]);
  return [deck.slice(), deck.slice()];
}

// Injects a permanent directly into the raw state (owner/controller = player, untapped).
// Any card id is safe now (task 22 injected the full Alpha DB into the engine).
function injectPermanent(game, player, cardId) {
  const id = "obj" + game.raw.nextObjectId++;
  game.raw.objects[id] = {
    id, cardId, owner: player, controller: player, zone: "battlefield",
    tapped: false, summoningSickness: false, counters: {}, attachments: [],
    buffsUntilEot: { power: 0, toughness: 0 }, attachedTo: null, damage: 0,
    attacking: false, blocking: null,
  };
  game.raw.battlefield.push(id);
  return id;
}

function costOf(id) {
  return root.fr("card", id).manaCost;
}

// A game where P0's opening hand is all copies of spellId, a plugin-known land (if any)
// sits untapped on P0's battlefield, walked to P0's precombat_main. Returns
// { game, landId, atMain }.
function gameAtMainForCast(spellId, landId) {
  const deck0 = Array(10).fill(spellId);
  const deck1 = Array(10).fill("vast-plains");
  const game = engine.newGame({ seed: 7, decks: [deck0, deck1] });
  turn.initTurnTracker(game);
  const injected = landId ? injectPermanent(game, 0, landId) : null;
  const r = turn.walkToStep(game, "precombat_main");
  return { game, landId: injected, atMain: r.atStep && !r.gameOver };
}

// ── task 18: parseCost ──
Test.test("t18: parseCost parses every supported symbol shape", () => {
  const g = parseCost("{2}{W}{W}");
  Test.assertEqual(g.cmc, 4);
  Test.assertEqual(g.xCount, 0);
  Test.assertEqual(g.colors, ["W"]);
  const x = parseCost("{X}{G}");
  Test.assertEqual(x.cmc, 1);
  Test.assertEqual(x.xCount, 1);
  Test.assertEqual(x.colors, ["G"]);
  const xx = parseCost("{X}{X}{U}");
  Test.assertEqual(xx.xCount, 2);
  Test.assertEqual(xx.colors, ["U"]);
  const hy = parseCost("{W/U}");
  Test.assertEqual(hy.cmc, 1);
  Test.assertEqual(hy.colors, ["W", "U"]);
  const c = parseCost("{C}");
  Test.assertEqual(c.cmc, 1);
  Test.assertEqual(c.colors, []);
  Test.assertEqual(parseCost("").cmc, 0, "an empty cost is legal");
  Test.assertThrows(() => parseCost("{T}"), "{T} is the tap symbol, not a mana symbol");
  Test.assertThrows(() => parseCost("1W"), "malformed — symbols need braces");
  Test.assertThrows(() => parseCost("{W"), "unterminated brace");
  Test.assertThrows(() => parseCost("{W/}"), "malformed hybrid");
});

Test.test("t18: canPayPool mirrors the reducer's feasibility check", () => {
  const c1 = parseCost("{1}{R}");
  Test.assert(canPayPool({ R: 1, C: 1 }, c1, 0), "R + generic from pool");
  Test.assert(!canPayPool({ U: 1, C: 1 }, c1, 0), "the R symbol needs red mana");
  const cx = parseCost("{X}{W}");
  Test.assert(canPayPool({ W: 1 }, cx, 0), "X=0 leaves only the W to pay");
  Test.assert(!canPayPool({ W: 1 }, cx, 2), "X=2 needs 2 extra generic mana");
  Test.assert(canPayPool({ W: 1, C: 2 }, cx, 2));
  Test.assert(!canPayPool({ W: 1 }, cx, -1), "negative X is not a legal choice");
  Test.assert(!canPayPool({ W: 1 }, cx, 1.5), "fractional X is not a legal choice");
  const cxx = parseCost("{X}{X}{U}");
  Test.assert(canPayPool({ U: 1, C: 4 }, cxx, 2), "{X}{X} at X=2 needs 4 generic plus U");
  Test.assert(!canPayPool({ U: 1, C: 3 }, cxx, 2));
  const hg = parseCost("{2/W}");
  Test.assert(canPayPool({ W: 1 }, hg, 0), "hybrid generic paid by its colour");
  Test.assert(canPayPool({ C: 2 }, hg, 0), "hybrid generic falls back to generic");
});

// ── task 18: manaSources ──
Test.test("t18: manaSources lists only usable untapped sources", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const t1 = injectPermanent(game, 0, "tundra");
  const t2 = injectPermanent(game, 0, "tundra");
  game.raw.objects[t2].tapped = true;
  const elves = injectPermanent(game, 0, "llanowar-elves");
  game.raw.objects[elves].summoningSickness = true;
  const mtn = injectPermanent(game, 1, "mountain");
  const srcs = manaSources(game, 0);
  Test.assertEqual(srcs.length, 1, "only the untapped, non-sick, own source remains");
  Test.assertEqual(srcs[0].objId, t1);
  Test.assertEqual(srcs[0].colors, ["W", "U"]);
  Test.assert(manaSources(game, 1).every((s) => s.objId === mtn), "opponent sees only their own source");
});

// ── task 18: pool-first planning ──
Test.test("t18: pool-first taps the minimum number of sources", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const p1 = injectPermanent(game, 0, "plains");
  const p2 = injectPermanent(game, 0, "plains");
  injectPermanent(game, 0, "island");
  mana.addMana(game, 0, "W", 2, "test");
  const plan = buildPayment(game, 0, "{2}{W}{W}");
  Test.assert(plan.ok, "2WW payable from pool {W}{W} + 3 lands");
  Test.assertEqual(plan.taps.length, 2, "both plains tapped for the two W symbols");
  Test.assertEqual(plan.taps.map((t) => t.objId).sort(), [p1, p2].sort());
  Test.assertEqual(plan.taps.every((t) => t.chosenColor === "W"), true);
});

Test.test("t18: pool-first taps more when the pool is thinner", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  injectPermanent(game, 0, "plains");
  injectPermanent(game, 0, "plains");
  injectPermanent(game, 0, "island");
  mana.addMana(game, 0, "W", 1, "test");
  const plan = buildPayment(game, 0, "{2}{W}{W}");
  Test.assert(plan.ok, "2WW payable from pool {W} + 3 lands");
  Test.assertEqual(plan.taps.length, 3, "one W from pool, two W from plains, generic from the island");
});

Test.test("t18: pool-first uses floating mana before tapping lands", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const mtn = injectPermanent(game, 0, "mountain");
  mana.addMana(game, 0, "R", 1, "test");
  let plan = buildPayment(game, 0, "{1}{R}");
  Test.assert(plan.ok);
  Test.assertEqual(plan.taps.length, 1, "R pool covers the red symbol, mountain taps for the generic");
  Test.assertEqual(plan.taps[0].objId, mtn);
  mana.addMana(game, 0, "C", 1, "test");
  plan = buildPayment(game, 0, "{1}{R}");
  Test.assertEqual(plan.taps.length, 0, "pool {R}{C} pays 1R outright");
});

// ── task 18: X resolution ──
Test.test("t18: X resolves to a chosen integer; X=0 is a legal free payment", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  let plan = buildPayment(game, 0, "{X}");
  Test.assert(plan.ok, "X=0 is a legal payment for a free X spell");
  Test.assertEqual(plan.x, 0);
  Test.assertEqual(plan.taps.length, 0);
  mana.addMana(game, 0, "C", 3, "test");
  plan = buildPayment(game, 0, "{X}", { x: "max" });
  Test.assert(plan.ok);
  Test.assertEqual(plan.x, 3, "max X spends all three floating mana");
  Test.assertEqual(plan.taps.length, 0);
  Test.assertEqual(maxAffordableX(game, 0, "{X}"), 3);
  Test.assertEqual(maxAffordableX(game, 0, "{X}{X}"), 1, "{X}{X} needs 2 mana per X");
  Test.assertEqual(maxAffordableX(game, 0, "{1}"), null, "no X in the cost -> null");
  Test.assertThrows(() => buildPayment(game, 0, "{X}", { x: -1 }), "negative X throws");
  Test.assertThrows(() => buildPayment(game, 0, "{X}", { x: 1.5 }), "fractional X throws");
});

Test.test("t18: {X}{G} pays the G symbol from a source and X from the pool", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const forest = injectPermanent(game, 0, "forest");
  mana.addMana(game, 0, "C", 1, "test");
  const plan = buildPayment(game, 0, "{X}{G}", { x: "max" });
  Test.assert(plan.ok);
  Test.assertEqual(plan.x, 1, "one C covers X=1, the forest covers G");
  Test.assertEqual(plan.taps.length, 1);
  Test.assertEqual(plan.taps[0].objId, forest);
  Test.assertEqual(plan.taps[0].chosenColor, "G");
});

// ── task 18: dual lands ──
Test.test("t18: dual lands tap for the needed colour", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const lag1 = injectPermanent(game, 0, "tundra");
  const lag2 = injectPermanent(game, 0, "tundra");
  const plan = buildPayment(game, 0, "{W}{U}");
  Test.assert(plan.ok, "two tundras cover WU");
  Test.assertEqual(plan.taps.length, 2);
  Test.assertEqual(plan.taps.map((t) => t.chosenColor).sort().join(""), "UW", "each dual produces a different colour");
  Test.assertEqual(new Set([lag1, lag2]).size, 2, "two distinct sources tapped");

  const lone = engine.newGame({ seed: 11, decks: fixtureDecks() });
  injectPermanent(lone, 0, "tundra");
  Test.assertEqual(buildPayment(lone, 0, "{W}{U}").ok, false, "one WU source can't pay both W and U");

  const withPool = engine.newGame({ seed: 11, decks: fixtureDecks() });
  injectPermanent(withPool, 0, "tundra");
  mana.addMana(withPool, 0, "W", 1, "test");
  const plan3 = buildPayment(withPool, 0, "{W}{U}");
  Test.assert(plan3.ok);
  Test.assertEqual(plan3.taps.length, 1, "pool covers W, the dual taps U");
  Test.assertEqual(plan3.taps[0].chosenColor, "U");
});

// ── task 18: payment strategies ──
Test.test("t18: sources-first taps lands even when the pool alone pays", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const mtn = injectPermanent(game, 0, "mountain");
  mana.addMana(game, 0, "C", 1, "test");
  const pf = buildPayment(game, 0, "{1}");
  Test.assert(pf.ok);
  Test.assertEqual(pf.taps.length, 0, "pool-first uses the floating C");
  const sf = buildPayment(game, 0, "{1}", { strategy: "sources-first" });
  Test.assert(sf.ok);
  Test.assertEqual(sf.taps.length, 1, "sources-first taps the mountain");
  Test.assertEqual(sf.taps[0].objId, mtn);
  Test.assertEqual(sf.taps[0].chosenColor, "R");
});

// ── task 18: unpayable costs ──
Test.test("t18: unpayable costs fail with ok:false", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  injectPermanent(game, 0, "plains");
  const p1 = buildPayment(game, 0, "{2}{W}{W}");
  Test.assertEqual(p1.ok, false, "one plains can't pay 2WW");
  Test.assert(p1.reason, "a reason is provided");
  injectPermanent(game, 0, "island");
  const p2 = buildPayment(game, 0, "{1}{R}");
  Test.assertEqual(p2.ok, false, "no red source, can't pay 1R");
});

// ── task 18: pay-then-cast through the reducer (plugin-known fixtures) ──
Test.test("t18: pay {X}{W} with max X, then cast the instant", () => {
  const { game, landId, atMain } = gameAtMainForCast("solara-benediction", "halo-reliquary");
  Test.assert(atMain, "reached P0's precombat_main");
  mana.addMana(game, 0, "C", 2, "test");
  const plan = buildPayment(game, 0, costOf("solara-benediction"), { x: "max" });
  Test.assert(plan.ok, "solara-benediction payable at max X");
  Test.assertEqual(plan.x, 2, "reliquary's W pays the W symbol, C x2 pays X=2");
  Test.assertEqual(plan.taps.length, 1);
  Test.assertEqual(plan.taps[0].objId, landId);
  payCost(game, 0, costOf("solara-benediction"), { x: "max" });
  const spellId = engine.zoneIds(game, "hand", 0)[0];
  turn.doAction(game, { type: "castSpell", player: 0, objectId: spellId, x: plan.x });
  Test.assertEqual(game.raw.stack.length, 1, "the spell is on the stack");
  Test.assertEqual(game.raw.stack[0].x, 2, "the chosen X is recorded on the stack entry");
  Test.assertEqual(game.raw.objects[landId].tapped, true, "the land was tapped");
  Test.assertEqual(engine.manaPool(game, 0), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, "the reducer spent the pool");
});

Test.test("t18: pay {X}{X}{U} with max X, then cast", () => {
  const { game, landId, atMain } = gameAtMainForCast("tide-vortex", "deep-ocean");
  Test.assert(atMain, "reached P0's precombat_main");
  mana.addMana(game, 0, "C", 4, "test");
  const plan = buildPayment(game, 0, costOf("tide-vortex"), { x: "max" });
  Test.assert(plan.ok, "tide-vortex payable at max X");
  Test.assertEqual(plan.x, 2, "{X}{X} at X=2 needs 4 generic, paid from the pool");
  Test.assertEqual(plan.taps.length, 1, "the ocean taps for U");
  payCost(game, 0, costOf("tide-vortex"), { x: "max" });
  const spellId = engine.zoneIds(game, "hand", 0)[0];
  turn.doAction(game, { type: "castSpell", player: 0, objectId: spellId, x: plan.x });
  Test.assertEqual(game.raw.stack.length, 1);
  Test.assertEqual(game.raw.stack[0].x, 2);
  Test.assertEqual(game.raw.objects[landId].tapped, true);
  Test.assertEqual(engine.manaPool(game, 0), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
});

Test.test("t18: pay {X}{R} sorcery with max X, then cast on the main phase", () => {
  const { game, landId, atMain } = gameAtMainForCast("ember-conflagration", "volcanic-peak");
  Test.assert(atMain, "reached P0's precombat_main");
  mana.addMana(game, 0, "C", 2, "test");
  const plan = buildPayment(game, 0, costOf("ember-conflagration"), { x: "max" });
  Test.assert(plan.ok, "ember-conflagration payable at max X");
  Test.assertEqual(plan.x, 2, "peak's R pays the R symbol, C x2 pays X=2");
  Test.assertEqual(plan.taps.length, 1);
  payCost(game, 0, costOf("ember-conflagration"), { x: "max" });
  const spellId = engine.zoneIds(game, "hand", 0)[0];
  turn.doAction(game, { type: "castSpell", player: 0, objectId: spellId, x: plan.x });
  Test.assertEqual(game.raw.stack.length, 1);
  Test.assertEqual(game.raw.stack[0].x, 2);
  Test.assertEqual(game.raw.objects[landId].tapped, true);
  Test.assertEqual(engine.manaPool(game, 0), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
});

Test.test("t18: a free X spell casts with X=0 and taps nothing", () => {
  const { game, atMain } = gameAtMainForCast("solara-benediction", null);
  Test.assert(atMain, "reached P0's precombat_main");
  mana.addMana(game, 0, "W", 1, "test");
  const plan = buildPayment(game, 0, costOf("solara-benediction"), { x: 0 });
  Test.assert(plan.ok, "X=0 leaves only {W} to pay");
  Test.assertEqual(plan.taps.length, 0, "no land to tap");
  payCost(game, 0, costOf("solara-benediction"), { x: 0 });
  const spellId = engine.zoneIds(game, "hand", 0)[0];
  turn.doAction(game, { type: "castSpell", player: 0, objectId: spellId, x: 0 });
  Test.assertEqual(game.raw.stack.length, 1);
  Test.assertEqual(game.raw.stack[0].x, 0);
  Test.assertEqual(engine.manaPool(game, 0), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
});

Test.test("t18: sources-first leaves floating mana untouched after the cast", () => {
  const { game, landId, atMain } = gameAtMainForCast("solara-benediction", "halo-reliquary");
  Test.assert(atMain, "reached P0's precombat_main");
  mana.addMana(game, 0, "W", 1, "test");
  const plan = buildPayment(game, 0, costOf("solara-benediction"), { x: 0, strategy: "sources-first" });
  Test.assert(plan.ok);
  Test.assertEqual(plan.taps.length, 1, "sources-first taps even though the pool pays");
  payCost(game, 0, costOf("solara-benediction"), { x: 0, strategy: "sources-first" });
  const spellId = engine.zoneIds(game, "hand", 0)[0];
  turn.doAction(game, { type: "castSpell", player: 0, objectId: spellId, x: 0 });
  Test.assertEqual(game.raw.stack.length, 1);
  Test.assertEqual(engine.manaPool(game, 0).W, 1, "the floating W survives the cast");
  Test.assertEqual(game.raw.objects[landId].tapped, true, "the reliquary paid instead");
});

Test.test("t18: executePayment fails loudly without priority", () => {
  const { game, atMain } = gameAtMainForCast("solara-benediction", "halo-reliquary");
  Test.assert(atMain);
  const plan = buildPayment(game, 0, costOf("solara-benediction"), { x: 0 });
  Test.assert(plan.ok);
  game.raw.priorityPlayer = 1;
  Test.assertThrows(() => executePayment(game, 0, plan), "no priority -> cannot tap");
});
