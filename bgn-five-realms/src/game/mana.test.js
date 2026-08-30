// Mana pool & mana abilities tests (roadmap Phase 5, tasks 16-17): pool add/remove math
// with loud failures, per-turn production/spend tracking, the optional mana-burn rule at
// the cleanup transition, and mana-producing activated abilities (basic lands, dual lands,
// and the stack-free tap-for-mana path). Driven through the five-realms-plugin engine.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import { MANA_TYPES, manaAbilityColors, totalProducedThisTurn, totalSpentThisTurn } from "./mana.js";
import * as mana from "./mana.js";
import { PLUGIN_CARD_MAP } from "../cards/plugin.js";

function fixtureDecks() {
  // engine.newGame merges the Alpha DB over the fixtures (task 22), so filter to
  // plugin-known fixture cards only — deterministic decks, no Alpha cards in play.
  const ids = root.fr("cards").map((c) => c.id).filter((id) => !PLUGIN_CARD_MAP[id]);
  const deck = [];
  for (let i = 0; i < 40; i++) deck.push(ids[i % ids.length]);
  return [deck.slice(), deck.slice()];
}

function firstCreatureInHand(game, player = 0) {
  for (const objId of engine.zoneIds(game, "hand", player)) {
    const c = engine.cardInstance(game, objId);
    if (c.card && c.card.types.includes("Creature")) return objId;
  }
  return null;
}

function firstLandInHand(game, player = 0) {
  for (const objId of engine.zoneIds(game, "hand", player)) {
    const c = engine.cardInstance(game, objId);
    if (c.card && c.card.types.includes("Land")) return objId;
  }
  return null;
}

function seedBigPool(game) {
  for (const s of MANA_TYPES) engine.addMana(game, 0, s, 6, "test setup");
}

// Casts the first creature in P0's hand on one of P0's main phases (seeded pool), walking
// turns until one can be cast. Returns { objId, card } or null.
function castFirstCreatureOnP0Main(game) {
  for (let i = 0; i < 8; i++) {
    if (game.raw.activePlayer === 0) {
      const r = turn.walkToStep(game, "precombat_main");
      if (r.gameOver) return null;
      if (r.atStep) {
        const objId = firstCreatureInHand(game);
        if (objId) {
          try {
            seedBigPool(game);
            turn.doAction(game, { type: "castSpell", player: 0, objectId: objId });
            return { objId, card: engine.cardInstance(game, objId).card };
          } catch (e) {
            return null;
          }
        }
      }
    }
    turn.walkTurn(game, 1);
  }
  return null;
}

// Plays the first land from P0's hand on one of P0's main phases. Returns the object id.
function playFirstLandOnP0Main(game) {
  for (let i = 0; i < 8; i++) {
    if (game.raw.activePlayer === 0) {
      const r = turn.walkToStep(game, "precombat_main");
      if (r.gameOver) return null;
      if (r.atStep) {
        const landId = firstLandInHand(game);
        if (landId) {
          try {
            turn.doAction(game, { type: "playLand", player: 0, objectId: landId });
            return landId;
          } catch (e) {
            return null;
          }
        }
      }
    }
    turn.walkTurn(game, 1);
  }
  return null;
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

// ── task 16: mana pool & types ──
Test.test("t16: pool add/spend math, loud failures, and per-turn tracking", () => {
  const game = engine.newGame({ seed: 3, decks: fixtureDecks() });
  mana.addMana(game, 0, "W", 2, "test");
  mana.addMana(game, 0, "C", 1, "test");
  Test.assertEqual(engine.manaPool(game, 0).W, 2);
  Test.assertEqual(engine.manaPool(game, 0).C, 1);
  mana.spendMana(game, 0, "W", 1, "test");
  Test.assertEqual(engine.manaPool(game, 0).W, 1);
  Test.assertThrows(() => mana.spendMana(game, 0, "W", 2, "too much"), "short spend fails loudly");
  Test.assertThrows(() => mana.addMana(game, 0, "Z", 1, "bogus"), "unknown symbol fails loudly");
  Test.assertEqual(engine.manaPool(game, 0).W, 1, "failed ops leave the pool untouched");
  Test.assertEqual(mana.producedThisTurn(game, 0), { W: 2, U: 0, B: 0, R: 0, G: 0, C: 1 });
  Test.assertEqual(mana.spentThisTurn(game, 0), { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 });
});

Test.test("t16: a plugin mana-ability activation is tracked as production", () => {
  const game = engine.newGame({ seed: 9, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  const landId = playFirstLandOnP0Main(game);
  Test.assert(landId, "played a land on P0's main phase");
  turn.doAction(game, { type: "activateAbility", player: 0, objectId: landId });
  const pool = engine.manaPool(game, 0);
  const made = MANA_TYPES.filter((s) => pool[s] === 1);
  Test.assertEqual(made.length, 1, "exactly one mana produced");
  Test.assertEqual(mana.producedThisTurn(game, 0)[made[0]], 1, "tracker matches the produced symbol");
  Test.assertEqual(totalSpentThisTurn(game, 0), 0, "nothing spent yet");
});

Test.test("t16: a reducer castSpell is tracked as spend matching the card's cmc", () => {
  const game = engine.newGame({ seed: 6, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  const cast = castFirstCreatureOnP0Main(game);
  Test.assert(cast, "cast a creature on P0's main phase");
  Test.assertEqual(totalSpentThisTurn(game, 0), cast.card.cmc, "spend equals the paid cmc");
  Test.assertEqual(totalProducedThisTurn(game, 0), 0, "seeded pool is not counted as produced");
});

Test.test("t16: unspent mana at the end step is burned at the cleanup transition", () => {
  const game = engine.newGame({ seed: 5, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  turn.walkToStep(game, "end_step");
  Test.assertEqual(game.raw.step, "end_step");
  mana.addMana(game, 0, "W", 2, "leftover");
  mana.addMana(game, 1, "G", 1, "leftover");
  turn.pass(game, 0);
  turn.pass(game, 1);
  Test.assertEqual(game.raw.turnNumber, 2, "the all-pass advanced the turn");
  Test.assertEqual(engine.life(game, 0), 18, "P0 took 2 burn from a 2-mana pool");
  Test.assertEqual(engine.life(game, 1), 19, "P1 took 1 burn from a 1-mana pool");
  Test.assertEqual(engine.manaPool(game, 0), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
  Test.assertEqual(engine.manaPool(game, 1), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
});

Test.test("t16: mana burn can be disabled via the rules config", () => {
  const game = engine.newGame({ seed: 5, decks: fixtureDecks(), rules: { manaBurn: false } });
  turn.initTurnTracker(game);
  turn.walkToStep(game, "end_step");
  mana.addMana(game, 0, "W", 2, "leftover");
  turn.pass(game, 0);
  turn.pass(game, 1);
  Test.assertEqual(game.raw.turnNumber, 2);
  Test.assertEqual(engine.life(game, 0), 20, "no burn when the rule is off");
  Test.assertEqual(engine.manaPool(game, 0).W, 0, "the pool still empties at end of turn");
});

Test.test("t16: lethal mana burn triggers the loss state-based action", () => {
  const game = engine.newGame({ seed: 5, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  turn.walkToStep(game, "end_step");
  engine.setLife(game, 1, 1, "set up");
  mana.addMana(game, 1, "R", 1, "leftover");
  turn.pass(game, 0);
  turn.pass(game, 1);
  Test.assertEqual(engine.life(game, 1), 0);
  Test.assertEqual(game.raw.players[1].lost, true);
  Test.assertEqual(game.raw.gameOver, true);
  Test.assertEqual(game.raw.winner, 0);
});

Test.test("t16: per-turn tracking resets when the turn rolls over", () => {
  const game = engine.newGame({ seed: 5, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  turn.walkToStep(game, "end_step");
  mana.addMana(game, 0, "G", 1, "leftover");
  Test.assertEqual(totalProducedThisTurn(game, 0), 1);
  turn.pass(game, 0);
  turn.pass(game, 1);
  Test.assertEqual(game.raw.turnNumber, 2);
  Test.assertEqual(totalProducedThisTurn(game, 0), 0, "a fresh turn starts with an empty tracker");
});

// ── task 17: mana abilities ──
Test.test("t17: tapping a basic land adds its colour and taps the land", () => {
  const game = engine.newGame({ seed: 9, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  const landId = playFirstLandOnP0Main(game);
  Test.assert(landId, "played a land on P0's main phase");
  Test.assertEqual(game.raw.objects[landId].tapped, false);
  const colors = manaAbilityColors(game, landId);
  Test.assert(colors && colors.length === 1, "basic land has one mana colour");
  mana.activateManaAbility(game, 0, landId, colors[0]);
  Test.assertEqual(game.raw.objects[landId].tapped, true, "land becomes tapped");
  Test.assertEqual(engine.manaPool(game, 0)[colors[0]], 1, "correct colour added to the pool");
  Test.assertEqual(totalProducedThisTurn(game, 0), 1);
});

Test.test("t17: a single-colour source needs no colour choice", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const rel = injectPermanent(game, 0, "halo-reliquary");
  mana.activateManaAbility(game, 0, rel);
  Test.assertEqual(engine.manaPool(game, 0).W, 1);
  Test.assertEqual(game.raw.objects[rel].tapped, true);
});

Test.test("t17: a dual land taps for either of its two colours", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const t1 = injectPermanent(game, 0, "tundra");
  const t2 = injectPermanent(game, 0, "tundra");
  Test.assertEqual(manaAbilityColors(game, t1), ["W", "U"]);
  mana.activateManaAbility(game, 0, t1, "U");
  Test.assertEqual(game.raw.objects[t1].tapped, true, "tapped after activation");
  Test.assertEqual(engine.manaPool(game, 0).U, 1);
  Test.assertEqual(engine.manaPool(game, 0).W, 0);
  mana.activateManaAbility(game, 0, t2, "W");
  Test.assertEqual(engine.manaPool(game, 0).W, 1);
  Test.assertEqual(engine.manaPool(game, 0).U, 1, "both colours reachable across activations");
  Test.assertThrows(() => mana.activateManaAbility(game, 0, t1, "W"), "an already-tapped land throws");
  Test.assertThrows(() => mana.activateManaAbility(game, 0, t2, "G"), "a dual land can't produce a third colour");
  Test.assertEqual(totalProducedThisTurn(game, 0), 2);
});

Test.test("t17: a dual land requires the activator to name a colour", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const t = injectPermanent(game, 0, "tundra");
  Test.assertThrows(() => mana.activateManaAbility(game, 0, t), "multi-colour source without a choice throws");
  Test.assertEqual(game.raw.objects[t].tapped, false, "the failed activation taps nothing");
  Test.assertEqual(engine.manaPool(game, 0).W + engine.manaPool(game, 0).U, 0);
});

Test.test("t17: mana-ability legality fails loudly", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const t = injectPermanent(game, 0, "tundra");
  Test.assertThrows(() => mana.activateManaAbility(game, 1, t, "U"), "a player without priority throws");
  const theirs = injectPermanent(game, 1, "halo-reliquary");
  Test.assertThrows(() => mana.activateManaAbility(game, 0, theirs, "W"), "someone else's permanent throws");
  Test.assertThrows(() => mana.activateManaAbility(game, 0, "obj1", "W"), "an object off the battlefield throws");
});

Test.test("t17: summoning sickness blocks a creature's tap-mana ability", () => {
  const game = engine.newGame({ seed: 11, decks: fixtureDecks() });
  const elves = injectPermanent(game, 0, "llanowar-elves");
  Test.assertEqual(manaAbilityColors(game, elves), ["G"]);
  game.raw.objects[elves].summoningSickness = true;
  Test.assertThrows(() => mana.activateManaAbility(game, 0, elves, "G"), "a sick mana dork can't tap for mana");
  Test.assertEqual(game.raw.objects[elves].tapped, false);
  game.raw.objects[elves].summoningSickness = false;
  mana.activateManaAbility(game, 0, elves, "G");
  Test.assertEqual(engine.manaPool(game, 0).G, 1);
  Test.assertEqual(game.raw.objects[elves].tapped, true);
});
