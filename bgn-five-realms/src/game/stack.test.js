// Stack & resolution tests (roadmap Phase 6, task 20): LIFO ordering of spells and
// abilities on the stack, all-pass resolving the topmost object (triggers firing between
// resolutions) vs. all-pass advancing the step when the stack is empty, counterspell
// removal before resolution, and the resolve/report layer in src/game/stack.js.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import * as mana from "./mana.js";
import { castSpell } from "./cast.js";
import { resolveTop, resolveAll } from "./resolve.js";
import {
  stackEntries, stackCount, stackIsEmpty, stackTop,
  allPassRound, describeEntry,
} from "./stack.js";

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

// Replace a player's opening hand with exactly the given cards (deterministic: no shuffle
// dependency). Old hand cards go back to the top of the library so zone flags stay true.
function setHand(game, player, cardIds) {
  const raw = game.raw;
  const pl = raw.players[player];
  for (const id of pl.hand) {
    if (raw.objects[id]) {
      raw.objects[id].zone = "library";
      pl.library.push(id);
    }
  }
  pl.hand = [];
  for (const cardId of cardIds) {
    const id = "obj" + raw.nextObjectId++;
    raw.objects[id] = {
      id, cardId, owner: player, controller: player, zone: "hand",
      tapped: false, summoningSickness: false, counters: {}, attachments: [],
      buffsUntilEot: { power: 0, toughness: 0 }, attachedTo: null, damage: 0,
      attacking: false, blocking: null,
    };
    pl.hand.push(id);
  }
  return pl.hand;
}

// Fresh game walked to P0's precombat_main, with P0's hand set to cardIds and any extra
// permanents injected for P0.
function setup(cardIds, inject) {
  const deck = Array(30).fill("vast-plains");
  const game = engine.newGame({ seed: 7, decks: [deck.slice(), deck.slice()] });
  turn.initTurnTracker(game);
  for (const inj of inject || []) {
    for (let i = 0; i < inj.count; i++) injectPermanent(game, inj.player || 0, inj.cardId);
  }
  setHand(game, 0, cardIds);
  const r = turn.walkToStep(game, "precombat_main");
  return { game, atMain: r.atStep && !r.gameOver };
}

function handOf(game, player, cardId) {
  const out = [];
  for (const objId of engine.zoneIds(game, "hand", player)) {
    const c = engine.cardInstance(game, objId);
    if (c.card && c.card.id === cardId) out.push(objId);
  }
  return out;
}

function battlefieldOf(game, player, cardId) {
  return Object.values(game.raw.objects).filter(
    (o) => o.zone === "battlefield" && o.controller === player && o.cardId === cardId
  );
}

// ── task 20: LIFO ordering ──
Test.test("t20: a two-spell stack resolves in reverse cast order (LIFO)", () => {
  const { game, atMain } = setup(["cinder-bolt", "cinder-bolt"], [
    { cardId: "volcanic-peak", count: 2 },
  ]);
  Test.assert(atMain, "reached P0's precombat_main");
  const bolts = handOf(game, 0, "cinder-bolt");
  Test.assertEqual(bolts.length, 2, "two bolts in hand");
  const r1 = castSpell(game, 0, bolts[0], { targets: [1] });
  Test.assert(r1.ok, "first bolt: " + (r1.reason || ""));
  const r2 = castSpell(game, 0, bolts[1], { targets: [1] });
  Test.assert(r2.ok, "second bolt: " + (r2.reason || ""));

  Test.assertEqual(stackCount(game), 2);
  Test.assert(!stackIsEmpty(game));
  const view = stackEntries(game);
  Test.assertEqual(view.length, 2);
  Test.assertEqual(view[0].cardId, "cinder-bolt", "bottom = first cast");
  Test.assertEqual(view[1].cardId, "cinder-bolt", "top = second cast");
  Test.assertEqual(view[0].top, false);
  Test.assertEqual(view[1].top, true);
  Test.assertEqual(view[0].depth, 2);
  Test.assertEqual(view[1].depth, 1);
  Test.assertEqual(stackTop(game).objId, bolts[1], "top is the most recent cast");

  const before = engine.life(game, 1);
  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 2, "both objects resolved");
  Test.assertEqual(out.resolutions[0].stackSizeWhenResolved, 2, "first to resolve had 2 on the stack");
  Test.assertEqual(out.resolutions[1].stackSizeWhenResolved, 1, "second to resolve had 1 left");
  Test.assertEqual(out.resolutions[0].objId, bolts[1], "the TOP (second cast) resolved first");
  Test.assertEqual(out.resolutions[1].objId, bolts[0], "the BOTTOM (first cast) resolved last");
  Test.assertEqual(engine.life(game, 1), before - 4, "4 damage from two bolts");
  Test.assertEqual(stackCount(game), 0);
  Test.assertEqual(out.stepAdvanced, true, "empty stack + all pass advances the step");
});

Test.test("t20: stackEntries exposes targets, mode, x and controller metadata", () => {
  const { game, atMain } = setup(["ember-reckoning"], [
    { cardId: "volcanic-peak", count: 2 },
  ]);
  Test.assert(atMain);
  const r = castSpell(game, 0, handOf(game, 0, "ember-reckoning")[0], { mode: "player", targets: [1] });
  Test.assert(r.ok, "modal cast: " + (r.reason || ""));
  const top = stackTop(game);
  Test.assertEqual(top.kind, "spell");
  Test.assertEqual(top.name, "Ember Reckoning");
  Test.assertEqual(top.mode, "player");
  Test.assertEqual(top.targets, [1]);
  Test.assertEqual(top.controller, 0);
  Test.assertEqual(top.x, 0);
});

// ── task 20: triggers between resolutions ──
Test.test("t20: resolving a creature fires its enter trigger immediately between resolutions", () => {
  const { game, atMain } = setup(["sunward-sentinel", "cinder-bolt"], [
    { cardId: "vast-plains", count: 2 },
    { cardId: "volcanic-peak", count: 1 },
  ]);
  Test.assert(atMain);
  const sentinel = handOf(game, 0, "sunward-sentinel")[0];
  const bolt = handOf(game, 0, "cinder-bolt")[0];
  Test.assert(castSpell(game, 0, sentinel).ok, "creature cast");
  Test.assert(castSpell(game, 0, bolt, { targets: [1] }).ok, "instant cast on top");
  Test.assertEqual(stackCount(game), 2);

  const p0Life = engine.life(game, 0);
  const p1Life = engine.life(game, 1);
  const out = resolveAll(game);

  Test.assertEqual(out.resolutions.length, 2);
  Test.assertEqual(out.resolutions[0].cardId, "cinder-bolt", "instant resolves first (top)");
  Test.assertEqual(out.resolutions[1].cardId, "sunward-sentinel", "creature resolves last (bottom)");
  const creature = out.resolutions[1];
  Test.assertEqual(creature.outcome, "permanent-entered");
  Test.assertEqual(creature.entered.length, 1);
  Test.assertEqual(creature.entered[0].cardId, "sunward-sentinel");
  Test.assertEqual(creature.triggersFired.length, 1, "the enter trigger fired between resolutions");
  Test.assertEqual(creature.triggersFired[0].when, "enter");
  Test.assertEqual(creature.triggersFired[0].effects[0].op, "life");
  Test.assertEqual(creature.triggersFired[0].effects[0].amount, 2);
  Test.assertEqual(engine.life(game, 0), p0Life + 2, "trigger gained its controller 2 life");
  Test.assertEqual(engine.life(game, 1), p1Life - 2, "bolt dealt 2");
});

Test.test("t20: a draw-then-discard enter trigger fires exactly once on resolution", () => {
  const { game, atMain } = setup(["nautilus-seer"], [
    { cardId: "deep-ocean", count: 3 },
  ]);
  Test.assert(atMain);
  const libBefore = engine.zoneIds(game, "library", 0).length;
  const gyBefore = engine.zoneIds(game, "graveyard", 0).length;
  const handBefore = engine.zoneIds(game, "hand", 0).length;
  Test.assert(castSpell(game, 0, handOf(game, 0, "nautilus-seer")[0]).ok, "seer cast");
  Test.assertEqual(engine.zoneIds(game, "hand", 0).length, handBefore - 1, "spell left the hand");

  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 1);
  const seer = out.resolutions[0];
  Test.assertEqual(seer.outcome, "permanent-entered");
  Test.assertEqual(seer.triggersFired.length, 1);
  Test.assertEqual(seer.triggersFired[0].effects.map((e) => e.op), ["draw", "discard"]);
  Test.assertEqual(engine.zoneIds(game, "library", 0).length, libBefore - 1, "drew one card");
  Test.assertEqual(engine.zoneIds(game, "graveyard", 0).length, gyBefore + 1, "discarded one card");
  Test.assertEqual(engine.zoneIds(game, "hand", 0).length, handBefore - 1, "hand: -1 cast, +1 draw, -1 discard");
});

// ── task 20: abilities on the stack ──
Test.test("t20: an activated ability sits on the stack (kind: ability) and resolves", () => {
  const { game, atMain } = setup([], []);
  Test.assert(atMain);
  const hound = injectPermanent(game, 0, "ember-hound");
  mana.addMana(game, 0, "R", 1, "test");
  turn.doAction(game, { type: "activateAbility", player: 0, objectId: hound, abilityName: "snap", targets: [1] });
  Test.assertEqual(stackCount(game), 1);
  const top = stackTop(game);
  Test.assertEqual(top.kind, "ability");
  Test.assertEqual(top.name, "Ember Hound");
  Test.assertEqual(top.abilityName, "snap");
  Test.assertEqual(top.targets, [1]);

  const p1Life = engine.life(game, 1);
  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 1);
  Test.assertEqual(out.resolutions[0].kind, "ability");
  Test.assertEqual(out.resolutions[0].abilityName, "snap");
  Test.assertEqual(engine.life(game, 1), p1Life - 1, "ability dealt 1");
  Test.assertEqual(game.raw.objects[hound].tapped, true, "tap cost paid");
});

Test.test("t20: a mixed stack resolves the ability (top) before the spell (bottom)", () => {
  const { game, atMain } = setup(["cinder-bolt"], [
    { cardId: "volcanic-peak", count: 1 },
  ]);
  Test.assert(atMain);
  const hound = injectPermanent(game, 0, "ember-hound");
  const bolt = handOf(game, 0, "cinder-bolt")[0];
  Test.assert(castSpell(game, 0, bolt, { targets: [1] }).ok, "spell cast first");
  mana.addMana(game, 0, "R", 1, "test");
  turn.doAction(game, { type: "activateAbility", player: 0, objectId: hound, abilityName: "snap", targets: [1] });
  Test.assertEqual(stackCount(game), 2);
  Test.assertEqual(stackTop(game).kind, "ability", "ability on top");

  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.map((r) => r.kind), ["ability", "spell"], "LIFO: ability then spell");
  Test.assertEqual(out.resolutions.map((r) => r.name), ["Ember Hound", "Cinder Bolt"]);
});

// ── task 20: counterspell ──
Test.test("t20: a counter spell removes its target from the stack before it resolves", () => {
  const { game, atMain } = setup(["sunward-sentinel", "tide-banishment"], [
    { cardId: "vast-plains", count: 2 },
    { cardId: "deep-ocean", count: 2 },
  ]);
  Test.assert(atMain);
  Test.assert(castSpell(game, 0, handOf(game, 0, "sunward-sentinel")[0]).ok, "sentinel cast");
  Test.assertEqual(stackCount(game), 1);
  const sentinelId = stackTop(game).objId;
  const p0Life = engine.life(game, 0);
  const r = castSpell(game, 0, handOf(game, 0, "tide-banishment")[0], { targets: [sentinelId] });
  Test.assert(r.ok, "counter cast targeting the spell: " + (r.reason || ""));
  Test.assertEqual(stackCount(game), 2, "both spells on the stack");

  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 1, "only the counter resolved");
  Test.assertEqual(out.resolutions[0].cardId, "tide-banishment");
  Test.assertEqual(out.resolutions[0].countered, [sentinelId], "the sentinel was removed from the stack");
  Test.assertEqual(battlefieldOf(game, 0, "sunward-sentinel").length, 0, "the countered spell never entered");
  Test.assertEqual(game.raw.objects[sentinelId].zone, "graveyard", "countered spell went to the graveyard");
  Test.assertEqual(engine.life(game, 0), p0Life, "no enter trigger fired");
  Test.assertEqual(stackCount(game), 0);
  Test.assertEqual(out.stepAdvanced, true);
});

// ── task 20: empty stack advances ──
Test.test("t20: all-pass with an empty stack advances the phase/step", () => {
  const { game, atMain } = setup([], []);
  Test.assert(atMain);
  Test.assertEqual(game.raw.step, "precombat_main");
  const round = allPassRound(game);
  Test.assertEqual(round.resolved, false, "nothing to resolve");
  Test.assertEqual(round.stepAdvanced, true, "empty stack + all pass advances");
  Test.assertEqual(game.raw.step, "begin_combat");
});

Test.test("t20: resolveTop resolves one object at a time and never advances the step", () => {
  const { game, atMain } = setup(["cinder-bolt", "cinder-bolt"], [
    { cardId: "volcanic-peak", count: 2 },
  ]);
  Test.assert(atMain);
  const bolts = handOf(game, 0, "cinder-bolt");
  Test.assert(castSpell(game, 0, bolts[0], { targets: [1] }).ok);
  Test.assert(castSpell(game, 0, bolts[1], { targets: [1] }).ok);
  Test.assertEqual(stackCount(game), 2);

  const r1 = resolveTop(game);
  Test.assert(r1, "resolved the top");
  Test.assertEqual(r1.objId, bolts[1], "the most recent cast went first");
  Test.assertEqual(stackCount(game), 1);
  Test.assertEqual(game.raw.step, "precombat_main", "step unchanged after one resolution");

  const r2 = resolveTop(game);
  Test.assert(r2, "resolved the second");
  Test.assertEqual(r2.objId, bolts[0]);
  Test.assertEqual(stackCount(game), 0);
  Test.assertEqual(game.raw.step, "precombat_main", "step still unchanged, stack now empty");

  Test.assertEqual(resolveTop(game), null, "nothing to resolve on an empty stack");
  Test.assertEqual(game.raw.step, "precombat_main", "still no advance");
  const round = allPassRound(game);
  Test.assertEqual(round.stepAdvanced, true, "passing out an empty stack advances");
});

// ── task 20: token creation & describeEntry ──
Test.test("t20: a token-creating spell reports entered permanents with no triggers", () => {
  const { game, atMain } = setup(["verdant-call"], [
    { cardId: "ancient-forest", count: 3 },
  ]);
  Test.assert(atMain);
  Test.assert(castSpell(game, 0, handOf(game, 0, "verdant-call")[0]).ok, "verdant-call cast");
  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 1);
  const r = out.resolutions[0];
  Test.assertEqual(r.cardId, "verdant-call");
  Test.assertEqual(r.outcome, "resolved", "a sorcery resolves to the graveyard");
  Test.assertEqual(r.entered.length, 2, "two wolf tokens entered");
  Test.assertEqual(r.entered[0].cardId, "wolf-token");
  Test.assertEqual(r.entered[0].name, "Wolf");
  Test.assertEqual(r.triggersFired.length, 0, "tokens have no enter triggers");
  Test.assertEqual(battlefieldOf(game, 0, "wolf-token").length, 2, "both tokens on the battlefield");
});

Test.test("t20: describeEntry renders readable summaries for the game log", () => {
  const { game, atMain } = setup(["sunward-sentinel", "verdant-surge", "tide-banishment"], [
    { cardId: "vast-plains", count: 3 },
    { cardId: "deep-ocean", count: 2 },
    { cardId: "ancient-forest", count: 2 },
  ]);
  Test.assert(atMain);
  const sentinelId = injectPermanent(game, 0, "sunward-sentinel");
  Test.assert(castSpell(game, 0, handOf(game, 0, "sunward-sentinel")[0]).ok);
  Test.assertEqual(describeEntry(stackTop(game), game), "Sunward Sentinel");
  Test.assert(castSpell(game, 0, handOf(game, 0, "verdant-surge")[0], { targets: [sentinelId] }).ok);
  Test.assertEqual(describeEntry(stackTop(game), game), "Verdant Surge targeting Sunward Sentinel");
  Test.assert(castSpell(game, 0, handOf(game, 0, "tide-banishment")[0], { targets: [stackTop(game).objId] }).ok);
  Test.assertEqual(describeEntry(stackTop(game), game), "Tide Banishment targeting the spell Verdant Surge");
});
