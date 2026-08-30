// Triggered abilities tests (roadmap Phase 7, task 23). The local trigger runtime in
// src/game/triggers.js fires the conditions the five-realms-plugin does NOT fire natively
// — upkeep, death (a permanent's own "death" + the battlefield watchers "creatureDies" /
// "landDies") and draw — reading card.triggers (src/cards/triggers.js declares three real
// Alpha triggers: Copper Tablet upkeep, Sengir Vampire creatureDies, Dingus Egg landDies).
// The engine itself fires "enter"/"attack"/"combatDamageToPlayer" immediately. A config
// toggle (game._rules.triggersImmediate, default true = classic Alpha) routes local
// triggers straight through the applier (immediate) or queues them onto the plugin's
// stack, resolved by turn.doAction's pass interception (stack mode).
// Covered here:
//   • upkeep: Copper Tablet deals 1 to the active player at every player's upkeep,
//   • upkeep draw: a synthetic "draw on your upkeep" card draws only for its controller,
//   • enter: a synthetic "deals 2 to target opponent on entry" card (fired natively),
//   • death: Dingus Egg's landDies fires when a land is destroyed (not for creatures),
//   • death: Sengir Vampire's creatureDies pumps it when any creature dies,
//   • death: a synthetic self-death trigger draws for its controller,
//   • draw: a synthetic draw-watcher gains life when a player draws cards,
//   • stack mode: upkeep + death triggers queue on the plugin's stack, don't apply at the
//     event, and resolve on an all-pass round (via resolveTop) without choking the engine.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import * as mana from "./mana.js";
import * as stack from "./stack.js";
import { triggersImmediate, triggerLog } from "./triggers.js";
import { castSpell } from "./cast.js";
import { resolveTop } from "./resolve.js";
import { ALPHA_TO_PLUGIN } from "../cards/plugin.js";

// Synthetic cards for conditions with no clean Alpha representative (draw on upkeep,
// damage on enter, self-death, draw watcher). They carry their own `triggers` fields
// (attachTriggers only wires the named Alpha set) and are injected via newGame's cards map.
const SYN_CARDS = {
  "sage-of-dawn": {
    id: "sage-of-dawn", name: "Sage of the Dawn", manaCost: "{2}{U}", cmc: 3,
    colors: ["U"], colorIdentity: ["U"], supertypes: [], types: ["Creature"],
    subtypes: ["Human", "Wizard"], rulesText: "At the beginning of your upkeep, draw a card.",
    rarity: "Marked", frame: "marked", glyph: "tide", power: 1, toughness: 1,
    triggers: [{ when: "upkeep", effects: [{ op: "draw", amount: 1, player: "controller" }] }],
  },
  "ember-sparker": {
    id: "ember-sparker", name: "Ember Sparker", manaCost: "{1}{R}", cmc: 2,
    colors: ["R"], colorIdentity: ["R"], supertypes: [], types: ["Creature"],
    subtypes: ["Elemental"], rulesText: "When Ember Sparker enters the battlefield, it deals 2 damage to target opponent.",
    rarity: "Marked", frame: "marked", glyph: "ember", power: 2, toughness: 1,
    triggers: [{ when: "enter", effects: [{ op: "damage", targets: ["opponent"], amount: 2 }] }],
  },
  "ash-phoenix": {
    id: "ash-phoenix", name: "Ash Phoenix", manaCost: "{2}{R}", cmc: 3,
    colors: ["R"], colorIdentity: ["R"], supertypes: [], types: ["Creature"],
    subtypes: ["Phoenix"], rulesText: "When Ash Phoenix dies, draw a card.",
    rarity: "Vaulted", frame: "vaulted", glyph: "ember", power: 3, toughness: 2,
    triggers: [{ when: "death", effects: [{ op: "draw", amount: 1, player: "controller" }] }],
  },
  "water-diviner": {
    id: "water-diviner", name: "Water Diviner", manaCost: "{2}{U}", cmc: 3,
    colors: ["U"], colorIdentity: ["U"], supertypes: [], types: ["Creature"],
    subtypes: ["Merfolk"], rulesText: "Whenever a player draws a card, you gain 1 life.",
    rarity: "Marked", frame: "marked", glyph: "tide", power: 1, toughness: 3,
    triggers: [{ when: "draw", player: "each", effects: [{ op: "life", targets: ["controller"], amount: 1, gain: true }] }],
  },
};

// ── helpers ───────────────────────────────────────────────────────────────────────────
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

// A fresh game at P0's turn-1 upkeep (the plugin's initial state) with permanents injected
// and P0's hand set. opts: { inject: [{cardId, count, player}], hand: [ids], cards, rules }.
function freshGame(opts = {}) {
  const deck = Array(30).fill("vast-plains");
  const game = engine.newGame({
    seed: 7,
    decks: [deck.slice(), deck.slice()],
    cards: Object.assign({}, SYN_CARDS, opts.cards || {}),
    rules: opts.rules,
  });
  turn.initTurnTracker(game);
  for (const inj of opts.inject || []) {
    for (let i = 0; i < inj.count; i++) injectPermanent(game, inj.player || 0, inj.cardId);
  }
  setHand(game, 0, opts.hand || []);
  return game;
}

// idsOf(...names) -> Alpha projection ids by card name.
function idsOf(...names) {
  return names.map((n) => {
    const rec = ALPHA_TO_PLUGIN.find((c) => c.name === n);
    Test.assert(rec, "projection has " + n);
    return rec.id;
  });
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

function thePermanent(game, player, cardId) {
  const list = battlefieldOf(game, player, cardId);
  Test.assertEqual(list.length, 1, "exactly one " + cardId + " on the battlefield");
  return list[0].id;
}

function logsWith(game, when, name) {
  return triggerLog(game).filter((e) => e.when === when && e.name === name);
}

// ── the toggle ────────────────────────────────────────────────────────────────────────
Test.test("t23: triggers resolve immediately by default; the toggle switches to stack mode", () => {
  const g1 = freshGame({});
  Test.assert(triggersImmediate(g1) === true, "default is immediate (classic Alpha)");
  const g2 = freshGame({ rules: { triggersImmediate: false } });
  Test.assert(triggersImmediate(g2) === false, "toggle routes triggers through the stack");
});

// ── upkeep ────────────────────────────────────────────────────────────────────────────
Test.test("t23: Copper Tablet deals 1 to the active player at each player's upkeep", () => {
  const game = freshGame({ inject: [{ cardId: idsOf("Copper Tablet")[0], count: 1 }] });
  const p1Life = engine.life(game, 1);
  turn.walkToStep(game, "precombat_main"); // consume P0's turn-1 initial upkeep (no transition)
  turn.walkToStep(game, "upkeep");         // next upkeep entered = P1's turn 2
  Test.assertEqual(engine.life(game, 1), p1Life - 1, "P1 took 1 from Copper Tablet at their upkeep");
  const entries = logsWith(game, "upkeep", "Copper Tablet");
  Test.assertEqual(entries.length, 1, "one Copper Tablet upkeep trigger fired");
  Test.assertEqual(entries[0].immediate, true, "immediate resolution by default");
  Test.assertEqual(game.raw.gameOver, false, "game continues");
});

Test.test("t23: an upkeep-draw trigger fires only in its controller's own upkeep", () => {
  const game = freshGame({ inject: [{ cardId: "sage-of-dawn", count: 1 }] });
  const p0HandBefore = engine.zoneIds(game, "hand", 0).length;
  // Walk to P0's NEXT upkeep (turn 3): the walk passes P1's turn-2 upkeep, where the
  // P0-controlled sage (firesFor "controller") must NOT fire.
  const r = turn.walk(game, { until: (g) => g.raw.turnNumber === 3 && g.raw.step === "upkeep", max: 400 });
  Test.assert(game.raw.step === "upkeep" && game.raw.turnNumber === 3, "reached P0's turn-3 upkeep: " + r.passes);
  const entries = logsWith(game, "upkeep", "Sage of the Dawn");
  Test.assertEqual(entries.length, 1, "exactly one sage upkeep fire (not at P1's upkeep)");
  Test.assertEqual(engine.zoneIds(game, "hand", 0).length, p0HandBefore + 1, "P0 drew 1");
});

// ── enter (plugin-native) ─────────────────────────────────────────────────────────────
Test.test("t23: an enter trigger deals 2 to the opponent when its creature enters", () => {
  const game = freshGame({ inject: [], hand: ["ember-sparker"] });
  const p1Life = engine.life(game, 1);
  turn.walkToStep(game, "precombat_main");
  mana.addMana(game, 0, "R", 2, "test");
  const r = castSpell(game, 0, handOf(game, 0, "ember-sparker")[0]);
  Test.assert(r.ok, "ember-sparker cast: " + (r.reason || ""));
  const res = resolveTop(game);
  Test.assert(res, "resolved");
  Test.assertEqual(res.outcome, "permanent-entered");
  Test.assertEqual(engine.life(game, 1), p1Life - 2, "the enter trigger dealt 2 to P1");
  Test.assertEqual(res.triggersFired.length, 1, "report lists the enter trigger");
  Test.assertEqual(res.triggersFired[0].name, "Ember Sparker");
  Test.assertEqual(res.triggersFired[0].when, "enter");
});

// ── death ─────────────────────────────────────────────────────────────────────────────
Test.test("t23: Dingus Egg's landDies deals 2 to the land's controller when a land is destroyed", () => {
  const game = freshGame({
    inject: [
      { cardId: idsOf("Dingus Egg")[0], count: 1 },
      { cardId: "mountain", count: 1, player: 1 },
    ],
    hand: ["stone-rain"],
  });
  const p1Life = engine.life(game, 1);
  const land = thePermanent(game, 1, "mountain");
  turn.walkToStep(game, "precombat_main");
  mana.addMana(game, 0, "R", 3, "test");
  const r = castSpell(game, 0, handOf(game, 0, "stone-rain")[0], { targets: [land] });
  Test.assert(r.ok, "stone rain cast: " + (r.reason || ""));
  resolveTop(game);
  Test.assertEqual(game.raw.objects[land].zone, "graveyard", "the land was destroyed");
  Test.assertEqual(engine.life(game, 1), p1Life - 2, "Dingus Egg dealt 2 to the land's controller");
  const entries = logsWith(game, "landDies", "Dingus Egg");
  Test.assertEqual(entries.length, 1, "one landDies trigger fired");
});

Test.test("t23: Dingus Egg does NOT fire when a creature dies (landDies watcher filters by type)", () => {
  const game = freshGame({
    inject: [
      { cardId: idsOf("Dingus Egg")[0], count: 1 },
      { cardId: "gray-ogre", count: 1, player: 1 },
    ],
    hand: ["terror"],
  });
  const p1Life = engine.life(game, 1);
  const ogre = thePermanent(game, 1, "gray-ogre");
  turn.walkToStep(game, "precombat_main");
  mana.addMana(game, 0, "B", 2, "test");
  const r = castSpell(game, 0, handOf(game, 0, "terror")[0], { targets: [ogre] });
  Test.assert(r.ok, "terror cast: " + (r.reason || ""));
  resolveTop(game);
  Test.assertEqual(game.raw.objects[ogre].zone, "graveyard", "the creature died");
  Test.assertEqual(engine.life(game, 1), p1Life, "no landDies trigger from a creature death");
  Test.assertEqual(logsWith(game, "landDies", "Dingus Egg").length, 0);
});

Test.test("t23: Sengir Vampire's creatureDies grows it when another player's creature dies", () => {
  const game = freshGame({
    inject: [
      { cardId: idsOf("Sengir Vampire")[0], count: 1 },
      { cardId: "gray-ogre", count: 1, player: 1 },
    ],
    hand: ["terror"],
  });
  const ogre = thePermanent(game, 1, "gray-ogre");
  turn.walkToStep(game, "precombat_main");
  mana.addMana(game, 0, "B", 2, "test");
  const r = castSpell(game, 0, handOf(game, 0, "terror")[0], { targets: [ogre] });
  Test.assert(r.ok, "terror cast: " + (r.reason || ""));
  resolveTop(game);
  const vamp = thePermanent(game, 0, "sengir-vampire");
  Test.assertEqual(game.raw.objects[vamp].counters.p1p1, 1, "the vampire gained a +1/+1 counter");
  Test.assertEqual(logsWith(game, "creatureDies", "Sengir Vampire").length, 1);
});

Test.test("t23: a self-death trigger draws a card for its controller when it dies", () => {
  const game = freshGame({
    inject: [{ cardId: "ash-phoenix", count: 1 }],
    hand: ["terror"],
  });
  const phoenix = thePermanent(game, 0, "ash-phoenix");
  turn.walkToStep(game, "precombat_main");
  mana.addMana(game, 0, "B", 2, "test");
  const r = castSpell(game, 0, handOf(game, 0, "terror")[0], { targets: [phoenix] });
  Test.assert(r.ok, "terror cast: " + (r.reason || ""));
  const handBeforeResolve = engine.zoneIds(game, "hand", 0).length;
  resolveTop(game);
  Test.assertEqual(game.raw.objects[phoenix].zone, "graveyard", "the phoenix died");
  Test.assertEqual(engine.zoneIds(game, "hand", 0).length, handBeforeResolve + 1, "its death trigger drew a card");
  Test.assertEqual(logsWith(game, "death", "Ash Phoenix").length, 1);
});

// ── draw ──────────────────────────────────────────────────────────────────────────────
Test.test("t23: a draw watcher gains 1 life per card its controller draws", () => {
  const game = freshGame({
    inject: [{ cardId: "water-diviner", count: 1 }],
    hand: ["ancestral-recall"],
  });
  const p0Life = engine.life(game, 0);
  turn.walkToStep(game, "precombat_main");
  mana.addMana(game, 0, "U", 1, "test");
  const r = castSpell(game, 0, handOf(game, 0, "ancestral-recall")[0], { targets: [0] });
  Test.assert(r.ok, "recall cast: " + (r.reason || ""));
  resolveTop(game);
  Test.assertEqual(engine.zoneIds(game, "hand", 0).length, 3, "drew three");
  Test.assertEqual(engine.life(game, 0), p0Life + 3, "one life per card drawn");
  Test.assertEqual(logsWith(game, "draw", "Water Diviner").length, 3, "three draw fires logged");
});

// ── stack mode ────────────────────────────────────────────────────────────────────────
Test.test("t23: stack mode queues an upkeep trigger and resolves it on an all-pass round", () => {
  const game = freshGame({
    inject: [{ cardId: idsOf("Copper Tablet")[0], count: 1 }],
    rules: { triggersImmediate: false },
  });
  const p1Life = engine.life(game, 1);
  turn.walkToStep(game, "precombat_main");
  turn.walkToStep(game, "upkeep"); // P1's turn-2 upkeep entered
  Test.assertEqual(engine.life(game, 1), p1Life, "no damage applied at the event in stack mode");
  Test.assertEqual(stack.stackCount(game), 1, "the trigger is on the stack");
  const top = stack.stackTop(game);
  Test.assertEqual(top.kind, "trigger", "stack top is a local trigger entry");
  Test.assertEqual(top.when, "upkeep");
  Test.assert(/upkeep trigger/.test(stack.describeEntry(top, game)), "describeEntry names the upkeep trigger");
  Test.assertEqual(game.raw.lastActionError, null, "engine never choked on the trigger entry");

  const res = resolveTop(game);
  Test.assert(res, "trigger resolved");
  Test.assertEqual(res.kind, "trigger");
  Test.assertEqual(res.outcome, "trigger-resolved");
  Test.assertEqual(res.triggerWhen, "upkeep");
  Test.assert(Array.isArray(res.triggerEffects) && res.triggerEffects.length === 1);
  Test.assertEqual(engine.life(game, 1), p1Life - 1, "the queued trigger applied its damage on resolution");
  Test.assertEqual(stack.stackCount(game), 0, "stack empty after resolution");
  Test.assertEqual(game.raw.lastActionError, null, "still clean after resolution");
});

Test.test("t23: stack mode queues a death trigger; the pump applies only on resolution", () => {
  const game = freshGame({
    inject: [
      { cardId: idsOf("Sengir Vampire")[0], count: 1 },
      { cardId: "gray-ogre", count: 1, player: 1 },
    ],
    hand: ["terror"],
    rules: { triggersImmediate: false },
  });
  const ogre = thePermanent(game, 1, "gray-ogre");
  turn.walkToStep(game, "precombat_main");
  mana.addMana(game, 0, "B", 2, "test");
  const r = castSpell(game, 0, handOf(game, 0, "terror")[0], { targets: [ogre] });
  Test.assert(r.ok, "terror cast: " + (r.reason || ""));
  const res = resolveTop(game); // the terror resolves; the death trigger is queued
  Test.assertEqual(res.kind, "spell", "the terror itself resolves as a spell");
  const vamp = thePermanent(game, 0, "sengir-vampire");
  Test.assertEqual(game.raw.objects[ogre].zone, "graveyard", "the creature died");
  Test.assertEqual(stack.stackCount(game), 1, "the creatureDies trigger is queued, not applied");
  Test.assertEqual((game.raw.objects[vamp].counters.p1p1 || 0), 0, "not pumped yet");

  const res2 = resolveTop(game);
  Test.assert(res2, "trigger resolved");
  Test.assertEqual(res2.kind, "trigger");
  Test.assertEqual(res2.outcome, "trigger-resolved");
  Test.assertEqual(game.raw.objects[vamp].counters.p1p1, 1, "pump applied on resolution");
  Test.assertEqual(stack.stackCount(game), 0);
});
