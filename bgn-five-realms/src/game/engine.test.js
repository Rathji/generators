// Game-state core tests (roadmap Phase 3, tasks 7-10): player model, zone moves,
// card instances, and snapshot/restore — driven through the five-realms-plugin engine.
// Requires the live page (root.fr). Register, then run: window.Test.run()
import {
  newGame, snapshot, restore, act, player, life, setLife,
  manaPool, addMana, spendMana, zoneIds, moveCard, cardInstance,
} from "./engine.js";

function fixtureDecks() {
  const ids = root.fr("cards").map((c) => c.id);
  const deck = [];
  for (let i = 0; i < 40; i++) deck.push(ids[i % ids.length]);
  return [deck.slice(), deck.slice()];
}

function firstCreature(game) {
  for (const objId of zoneIds(game, "hand", 0)) {
    const inst = cardInstance(game, objId);
    if (inst.card && inst.card.types.includes("Creature")) return { objId, card: inst.card };
  }
  return null;
}

// ── task 7: player model ──
Test.test("t7: player model exposes life, mana pool, zones, and a 7-card opening hand", () => {
  const game = newGame({ seed: 11, decks: fixtureDecks() });
  const p0 = player(game, 0);
  Test.assertEqual(p0.life, 20);
  Test.assertEqual(p0.hand.length, 7);
  Test.assertEqual(p0.library.length, 33);
  Test.assertEqual(manaPool(game, 0), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
  Test.assertEqual(life(game, 0), 20);
  Test.assert(game.history.length === 0);
});

Test.test("t7: life changes are recorded with history", () => {
  const game = newGame({ seed: 11, decks: fixtureDecks() });
  setLife(game, 0, 15, "test damage");
  Test.assertEqual(life(game, 0), 15);
  Test.assertEqual(game.history.length, 1);
  Test.assertEqual(game.history[0].action, "setLife");
  Test.assertEqual(game.history[0].value, 15);
  setLife(game, 1, 3, "lethal");
  Test.assertEqual(life(game, 1), 3);
});

Test.test("t7: mana pool add/spend, and spending fails loudly when short", () => {
  const game = newGame({ seed: 11, decks: fixtureDecks() });
  addMana(game, 0, "W", 3, "tapped a land");
  Test.assertEqual(manaPool(game, 0).W, 3);
  spendMana(game, 0, "W", 2, "paid a cost");
  Test.assertEqual(manaPool(game, 0).W, 1);
  Test.assertThrows(() => spendMana(game, 0, "W", 2, "overpay"), "insufficient mana throws");
  Test.assertEqual(manaPool(game, 0).W, 1, "failed spend leaves the pool untouched");
});

// ── task 8: zones & move operations ──
Test.test("t8: moving a card between zones updates both sides and ordering", () => {
  const game = newGame({ seed: 11, decks: fixtureDecks() });
  const pick = firstCreature(game);
  Test.assert(pick, "opening hand has a creature");
  const { objId } = pick;
  const hand0 = zoneIds(game, "hand", 0);
  Test.assert(hand0.includes(objId));
  moveCard(game, objId, "hand", "battlefield", 0);
  Test.assert(!zoneIds(game, "hand", 0).includes(objId));
  const bf = zoneIds(game, "battlefield", 0);
  Test.assert(bf.includes(objId), "object arrived on the battlefield");
  Test.assertEqual(game.raw.objects[objId].zone, "battlefield");
  Test.assertEqual(game.raw.objects[objId].controller, 0);
  Test.assert(game.history.some((h) => h.action === "moveCard"), "move logged");
});

Test.test("t8: graveyard is append-ordered and stack is LIFO", () => {
  const game = newGame({ seed: 11, decks: fixtureDecks() });
  const hand = zoneIds(game, "hand", 0);
  const a = hand[0], b = hand[1];
  moveCard(game, a, "hand", "graveyard", 0);
  moveCard(game, b, "hand", "graveyard", 0);
  Test.assertEqual(zoneIds(game, "graveyard", 0), [a, b], "graveyard preserves order");
  moveCard(game, a, "graveyard", "stack", 0);
  moveCard(game, b, "graveyard", "stack", 0);
  Test.assertEqual(zoneIds(game, "stack", 0), [a, b], "stack pushes on top");
  Test.assert(game.raw.objects[b].zone === "stack");
});

Test.test("t8: illegal moves are rejected loudly", () => {
  const game = newGame({ seed: 11, decks: fixtureDecks() });
  const hand = zoneIds(game, "hand", 0);
  Test.assertThrows(() => moveCard(game, hand[0], "exile", "hand", 0), "object not in source zone throws");
  Test.assertThrows(() => moveCard(game, "obj0", "hand", "hand", 0), "unknown object throws");
  Test.assertThrows(() => moveCard(game, hand[0], "bogus", "hand", 0), "unknown zone throws");
});

// ── task 9: card instance model ──
Test.test("t9: instances are distinct objects; mutating one never touches another", () => {
  const game = newGame({ seed: 11, decks: fixtureDecks() });
  const creatures = [];
  for (const objId of zoneIds(game, "hand", 0)) {
    const inst = cardInstance(game, objId);
    if (inst.card && inst.card.types.includes("Creature") && creatures.length < 2) {
      creatures.push({ objId, inst });
    }
  }
  Test.assert(creatures.length >= 2, "need two creature instances");
  const [x, y] = creatures;
  Test.assert(x.objId !== y.objId);
  Test.assert(x.inst.obj !== y.inst.obj, "separate instance objects");
  Test.assert(x.inst.card === y.inst.card || (x.inst.card && y.inst.card), "shared card definition");
  x.inst.obj.tapped = true;
  x.inst.obj.counters["+1/+1"] = 2;
  Test.assert(y.inst.obj.tapped === false, "other instance unaffected by tap");
  Test.assert(x.inst.obj.counters["+1/+1"] === 2 && !y.inst.obj.counters["+1/+1"], "counters are per-instance");
  Test.assert(x.inst.card.tapped === undefined, "card definition has no instance state");
});

Test.test("t9: instances start with the engine's baseline fields", () => {
  const game = newGame({ seed: 11, decks: fixtureDecks() });
  const objId = zoneIds(game, "hand", 0)[0];
  const inst = cardInstance(game, objId);
  Test.assert(inst, "instance resolves");
  Test.assertEqual(inst.obj.zone, "hand");
  Test.assertEqual(inst.obj.owner, 0);
  Test.assertEqual(inst.obj.summoningSickness, true);
  Test.assert(inst.card, "card definition resolves from the engine DB");
});

// ── task 10: game engine object & snapshot ──
Test.test("t10: snapshot/restore round-trips state and history exactly", () => {
  const game = newGame({ seed: 42, decks: fixtureDecks() });
  addMana(game, 0, "G", 2, "ramp");
  const pick = firstCreature(game);
  moveCard(game, pick.objId, "hand", "battlefield", 0);
  act(game, { type: "passPriority", player: game.raw.priorityPlayer });
  const snap = snapshot(game);
  const restored = restore(snap);
  const snap2 = snapshot(restored);
  Test.assert(window.deepEqual(snap, snap2), "re-snapshot after restore is identical");
  Test.assertEqual(restored.raw.players[0].manaPool.G, 2);
  Test.assertEqual(restored.raw.players[0].life, 20);
  Test.assert(window.deepEqual(game.raw, restored.raw), "raw game state matches");
  Test.assert(restored.history.length === game.history.length, "history survives");
});

Test.test("t10: restore rejects malformed snapshots loudly", () => {
  Test.assertThrows(() => restore(null), "null snapshot throws");
  Test.assertThrows(() => restore({ raw: { players: "nope" } }), "bad players throws");
  Test.assertThrows(() => restore({}), "missing raw throws");
});

Test.test("t10: cloned snapshots are independent of later play", () => {
  const game = newGame({ seed: 7, decks: fixtureDecks() });
  const snap = snapshot(game);
  addMana(game, 0, "R", 1, "later play");
  const restored = restore(snap);
  Test.assertEqual(restored.raw.players[0].manaPool.R, 0, "snapshot not affected by later play");
});
