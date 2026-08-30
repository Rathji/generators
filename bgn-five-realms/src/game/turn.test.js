// Turn & phases tests (roadmap Phase 4, tasks 11-15): turn lifecycle/step log, priority
// & stack-before-advance, untap step & summoning sickness, draw step & deck-out, and the
// foundational state-based actions. Driven through the five-realms-plugin engine.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import { PLUGIN_CARD_MAP } from "../cards/plugin.js";

function fixtureDecks() {
  // engine.newGame merges the Alpha DB over the fixtures (task 22), so filter to
  // plugin-known fixture cards only — deterministic decks, no Alpha cards in play.
  const ids = root.fr("cards").map((c) => c.id).filter((id) => !PLUGIN_CARD_MAP[id]);
  const deck = [];
  for (let i = 0; i < 40; i++) deck.push(ids[i % ids.length]);
  return [deck.slice(), deck.slice()];
}

function findSentinelObj(game) {
  for (const objId of engine.zoneIds(game, "battlefield", 0)) {
    const c = engine.cardInstance(game, objId);
    if (c.card && c.card.types.includes("Creature")) return objId;
  }
  return null;
}

function firstCreatureInHand(game) {
  for (const objId of engine.zoneIds(game, "hand", 0)) {
    const c = engine.cardInstance(game, objId);
    if (c.card && c.card.types.includes("Creature")) return objId;
  }
  return null;
}

// The plugin's state.stack array holds the spell entry plus a zone-marker string for the
// object (frZoneMove pushes the id; resolution pops the entry then removes the marker).
// Spell-entry counting is the meaningful measure of stack depth.
function stackSpells(game) {
  return game.raw.stack.filter((e) => e && typeof e === "object" && e.kind === "spell");
}

// Seeds a pool large enough for any fixture card cost, so Phase-4 tests can concentrate
// on turn/priority/stack rules without depending on the mana layer (Phase 5).
function seedBigPool(game) {
  engine.addMana(game, 0, "W", 6, "test setup");
  engine.addMana(game, 0, "U", 6, "test setup");
  engine.addMana(game, 0, "B", 6, "test setup");
  engine.addMana(game, 0, "R", 6, "test setup");
  engine.addMana(game, 0, "G", 6, "test setup");
  engine.addMana(game, 0, "C", 6, "test setup");
}

// Walks to a main phase on Player 0's own turn and casts the first creature in hand using
// a seeded pool. Returns the cast object id, or null if none could be cast.
function castFirstCreatureOnP0Main(game) {
  for (let i = 0; i < 8; i++) {
    if (game.raw.activePlayer === 0) {
      const r = turn.walkToStep(game, "precombat_main");
      if (r.gameOver) return null;
      if (r.atStep) {
        seedBigPool(game);
        const objId = firstCreatureInHand(game);
        if (objId) {
          try {
            turn.doAction(game, { type: "castSpell", player: 0, objectId: objId });
            return objId;
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

// ── task 11: turn structure & phase events ──
Test.test("t11: a full turn visits every priority step exactly once in order", () => {
  const game = engine.newGame({ seed: 1, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  const out = turn.walkTurn(game, 1);
  const steps = turn.stepLogOfTurn(game, 1, 0).map((e) => e.step);
  Test.assertEqual(steps, turn.PRIORITY_STEPS, "the 10 priority steps in order");
  Test.assertEqual(steps.length, 10);
  Test.assertEqual(game.raw.turnNumber, 2, "turn number rolled over");
  Test.assertEqual(game.raw.activePlayer, 1, "active player switched");
  Test.assertEqual(out.passes, 20, "each of 10 steps needs 2 passes");
  Test.assertEqual(out.advancedTurns, 1);
});

Test.test("t11: onStep fires exactly once per observable step transition", () => {
  const game = engine.newGame({ seed: 2, decks: fixtureDecks() });
  let count = 0;
  turn.onStep(game, () => count++);
  turn.walkTurn(game, 1);
  Test.assertEqual(count, 10, "10 transitions: 9 within the turn, 1 into the next turn's upkeep");
});

Test.test("t11: bindTurnIndicator keeps the phase bar in sync", () => {
  const el = document.getElementById("phaseBar");
  if (!el) return; // no game shell in this context — engine-only assertion below
  const game = engine.newGame({ seed: 3, decks: fixtureDecks() });
  turn.bindTurnIndicator(game, el);
  const span = document.getElementById("frPhaseText");
  Test.assert(span && span.textContent.includes("Turn 1"), "indicator starts at turn 1");
  Test.assert(span.textContent.includes("Main Phase 1") === false, "starts at upkeep, not main");
  turn.walkTurn(game, 1);
  Test.assert(span.textContent.includes("Turn 2"), "indicator advances with the game");
});

// ── task 12: priority & stack-before-advance ──
Test.test("t12: all-pass with a non-empty stack resolves it before the step advances", () => {
  const game = engine.newGame({ seed: 5, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  const castId = castFirstCreatureOnP0Main(game);
  Test.assert(castId, "cast a creature on player 0's main phase");
  Test.assertEqual(game.raw.step, "precombat_main");
  Test.assertEqual(stackSpells(game).length, 1, "spell sits on the stack");
  turn.pass(game, 0);
  turn.pass(game, 1);
  Test.assertEqual(game.raw.stack.length, 0, "all-pass resolved the stack");
  Test.assertEqual(game.raw.step, "precombat_main", "step did NOT advance while the stack was non-empty");
  Test.assertEqual(game.raw.objects[castId].zone, "battlefield", "resolved permanent is on the battlefield");
  turn.pass(game, 0);
  turn.pass(game, 1);
  Test.assertEqual(game.raw.step, "begin_combat", "empty-stack all-pass advances to the next step");
});

Test.test("t12: autopass declines priority when the player has no meaningful actions", () => {
  const game = engine.newGame({ seed: 4, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  turn.walkTurn(game, 1); // turn 2, Player 1 active at upkeep with an empty board
  Test.assertEqual(game.raw.priorityPlayer, 1);
  Test.assert(!turn.hasMeaningfulActions(game), "player 1 has nothing meaningful to do");
  turn.setAutopass(game, 1, true);
  turn.autopass(game);
  Test.assertEqual(game.raw.priorityPlayer, 0, "autopass passed priority to player 0");
});

Test.test("t12: autopass is a no-op when disabled or when actions exist", () => {
  const game = engine.newGame({ seed: 4, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  Test.assert(!turn.autopass(game), "no pass without autopass enabled");
  Test.assertEqual(game.raw.priorityPlayer, 0);
  turn.setAutopass(game, 0, true);
  turn.walkToStep(game, "precombat_main");
  seedBigPool(game);
  Test.assert(turn.hasMeaningfulActions(game), "player 0 can cast at their main phase");
  Test.assert(!turn.autopass(game), "no auto-pass while meaningful actions exist");
});

// ── task 13: untap step & summoning sickness ──
Test.test("t13: sick creatures cannot attack, and the untap step clears it", () => {
  const game = engine.newGame({ seed: 6, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  const castId = castFirstCreatureOnP0Main(game);
  Test.assert(castId, "cast a creature on player 0's main phase");
  turn.pass(game, 0);
  turn.pass(game, 1); // resolve: the creature enters the battlefield, summoning sick
  const sid = findSentinelObj(game);
  Test.assertEqual(sid, castId, "resolved creature is the one we cast");
  Test.assertEqual(game.raw.objects[sid].summoningSickness, true);
  turn.doAction(game, { type: "tapPermanent", player: 0, objectId: sid });
  Test.assertEqual(game.raw.objects[sid].tapped, true);
  turn.walkToStep(game, "declare_attackers");
  const atk = engine.legalActions(game).filter((a) => a.type === "declareAttackers");
  Test.assert(
    !atk.some((a) => a.attackers && a.attackers.includes(sid)),
    "sick (and tapped) creature cannot be declared as an attacker"
  );
  turn.walkTurn(game, 1); // Player 1's turn
  turn.walkTurn(game, 1); // back to Player 0's turn — untap ran at its start
  Test.assertEqual(game.raw.objects[sid].summoningSickness, false, "untap cleared summoning sickness");
  Test.assertEqual(game.raw.objects[sid].tapped, false, "untap untapped the permanent");
  turn.walkToStep(game, "declare_attackers");
  const atk2 = engine.legalActions(game).filter((a) => a.type === "declareAttackers");
  Test.assert(
    atk2.some((a) => a.attackers && a.attackers.includes(sid)),
    "sentinel can attack on the next turn"
  );
});

// ── task 14: draw step & deck-out ──
Test.test("t14: the draw step draws one card for the active player", () => {
  const game = engine.newGame({ seed: 7, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  turn.walkTurn(game, 1); // → turn 2, Player 1 active
  const libBefore = engine.zoneIds(game, "library", 1).length;
  const handBefore = engine.zoneIds(game, "hand", 1).length;
  turn.walkToStep(game, "draw");
  Test.assertEqual(engine.zoneIds(game, "library", 1).length, libBefore - 1, "library shrinks by one");
  Test.assertEqual(engine.zoneIds(game, "hand", 1).length, handBefore + 1, "hand grows by one");
});

Test.test("t14: drawing from an empty library loses the game immediately", () => {
  const tiny = [];
  for (let i = 0; i < 7; i++) tiny.push("halo-reliquary"); // opening hand empties the library
  const game = engine.newGame({ seed: 9, decks: [fixtureDecks()[0], tiny] });
  turn.initTurnTracker(game);
  turn.walkTurn(game, 1); // → turn 2, Player 1 active
  Test.assertEqual(engine.zoneIds(game, "library", 1).length, 0);
  turn.walkToStep(game, "draw");
  Test.assertEqual(game.raw.players[1].lost, true, "empty-library draw marks the player lost");
  Test.assertEqual(game.raw.gameOver, true);
  Test.assertEqual(game.raw.winner, 0);
});

// ── task 15: core state-based actions ──
Test.test("t15: a player at 0 or less life loses immediately (via changeLife)", () => {
  const game = engine.newGame({ seed: 3, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  turn.changeLife(game, 0, -3, "chip damage");
  Test.assertEqual(game.raw.gameOver, false, "not lethal");
  Test.assert(game.history.some((h) => h.action === "setLife"), "life change logged");
  turn.changeLife(game, 0, -17, "lethal");
  Test.assertEqual(game.raw.players[0].lost, true);
  Test.assertEqual(game.raw.gameOver, true);
  Test.assertEqual(game.raw.winner, 1);
  turn.runSba(game);
  Test.assertEqual(game.raw.winner, 1, "SBA pass is idempotent after the game ends");
});

Test.test("t15: runSba is a repeatable pass; direct setLife + pass also triggers loss", () => {
  const game = engine.newGame({ seed: 3, decks: fixtureDecks() });
  turn.initTurnTracker(game);
  engine.setLife(game, 1, 4, "test");
  turn.runSba(game);
  turn.runSba(game);
  Test.assertEqual(game.raw.gameOver, false, "non-lethal life is stable across passes");
  engine.setLife(game, 1, -1, "lethal");
  turn.runSba(game);
  Test.assertEqual(game.raw.players[1].lost, true);
  Test.assertEqual(game.raw.gameOver, true);
  Test.assertEqual(game.raw.winner, 0);
});
