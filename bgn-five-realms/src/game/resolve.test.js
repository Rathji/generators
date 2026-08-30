// Spell resolution & fizzle tests (roadmap Phase 6, task 22): Alpha spells resolve
// through the plugin's effect engine (the full Alpha DB is injected at newGame — see
// src/cards/db.js — so instants/sorceries apply their declared effects and permanents
// enter natively), and the fizzle layer in src/game/resolve.js re-checks a resolving
// object's chosen targets against the current board, trimming to the legal subset and
// emptying the list entirely (fizzle) when every target became illegal. Covered here:
//   • baseline effect application (Bolt to a player / to a creature, Giant Growth pump,
//     Dark Ritual mana, Ancestral Recall draw, Counterspell, creature entry, modal
//     modes) — proving the DB injection removed the old "Alpha cards leak on the stack",
//   • fizzle when a target left the battlefield before resolution,
//   • fizzle-on-counterspell (a spell countered before its counter resolves),
//   • partial legality (one of two targets remains legal — only the legal subset is hit),
//   • Aura resolution + Aura fizzle when its enchant target is destroyed.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import * as mana from "./mana.js";
import { castSpell } from "./cast.js";
import { resolveTop, resolveAll, checkTargetsAtResolve } from "./resolve.js";
import { ALPHA_TO_PLUGIN } from "../cards/plugin.js";

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
// permanents injected (player 0 unless inj.player says otherwise).
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

// The single battlefield object of cardId controlled by player (asserts exactly one).
function thePermanent(game, player, cardId) {
  const list = battlefieldOf(game, player, cardId);
  Test.assertEqual(list.length, 1, "exactly one " + cardId + " on the battlefield");
  return list[0].id;
}

// The raw top stack entry (or null).
function stackTopEntry(game) {
  const arr = game.raw.stack || [];
  return arr.length ? arr[arr.length - 1] : null;
}

// ── baseline: Alpha effects resolve through the plugin engine ─────────────────────────
Test.test("t22: Lightning Bolt deals 3 to a player (effect from the injected Alpha DB)", () => {
  const { game, atMain } = setup(["lightning-bolt"], []);
  Test.assert(atMain);
  const bolt = handOf(game, 0, "lightning-bolt")[0];
  mana.addMana(game, 0, "R", 1, "test");
  const r = castSpell(game, 0, bolt, { targets: [1] });
  Test.assert(r.ok, "bolt cast: " + (r.reason || ""));
  const p1Before = engine.life(game, 1);
  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 1);
  const res = out.resolutions[0];
  Test.assertEqual(res.cardId, "lightning-bolt");
  Test.assertEqual(res.fizzled, false, "no fizzle — the player is a legal target");
  Test.assertEqual(res.targets, [1], "effective targets match");
  Test.assertEqual(res.illegalTargets.length, 0);
  Test.assertEqual(engine.life(game, 1), p1Before - 3, "3 damage from the bolt");
  Test.assertEqual(game.raw.objects[bolt].zone, "graveyard", "instant to the graveyard");
});

Test.test("t22: Bolt kills a 2/2 — damage, then the SBA pass sends it to the graveyard", () => {
  const { game, atMain } = setup(["lightning-bolt"], [
    { cardId: "gray-ogre", count: 1, player: 1 },
  ]);
  Test.assert(atMain);
  const ogre = thePermanent(game, 1, "gray-ogre");
  const p1Life = engine.life(game, 1);
  mana.addMana(game, 0, "R", 1, "test");
  const r = castSpell(game, 0, handOf(game, 0, "lightning-bolt")[0], { targets: [ogre] });
  Test.assert(r.ok, "bolt at the ogre: " + (r.reason || ""));
  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 1);
  const res = out.resolutions[0];
  Test.assertEqual(res.fizzled, false);
  Test.assertEqual(res.targets, [ogre]);
  Test.assertEqual(game.raw.objects[ogre].zone, "graveyard", "lethal damage → SBA death");
  Test.assertEqual(engine.life(game, 1), p1Life, "creature damage does not hit the player");
});

Test.test("t22: Giant Growth applies an until-end-of-turn pump effect", () => {
  const { game, atMain } = setup(["giant-growth"], [
    { cardId: "gray-ogre", count: 1 },
  ]);
  Test.assert(atMain);
  const ogre = thePermanent(game, 0, "gray-ogre");
  mana.addMana(game, 0, "G", 1, "test");
  const r = castSpell(game, 0, handOf(game, 0, "giant-growth")[0], { targets: [ogre] });
  Test.assert(r.ok, "growth cast: " + (r.reason || ""));
  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 1);
  Test.assertEqual(out.resolutions[0].fizzled, false, "creature still legal at resolution");
  const buff = game.raw.effects.find((e) => e.targetId === ogre);
  Test.assert(buff, "a pump effect targeting the ogre exists");
  Test.assertEqual(buff.power, 3);
  Test.assertEqual(buff.toughness, 3);
  Test.assertEqual(buff.untilEot, true, "until end of turn");
  Test.assertEqual(game.raw.objects[ogre].zone, "battlefield", "ogre survives");
});

Test.test("t22: Dark Ritual adds BBB to the caster's pool (resolveTop: step not advanced)", () => {
  const { game, atMain } = setup(["dark-ritual"], []);
  Test.assert(atMain);
  mana.addMana(game, 0, "B", 1, "test");
  const r = castSpell(game, 0, handOf(game, 0, "dark-ritual")[0]);
  Test.assert(r.ok, "ritual cast: " + (r.reason || ""));
  const res = resolveTop(game);
  Test.assert(res, "ritual resolved");
  Test.assertEqual(res.fizzled, false);
  Test.assertEqual(engine.manaPool(game, 0).B, 3, "BBB added by the effect");
});

Test.test("t22: Ancestral Recall draws three cards for its controller", () => {
  const { game, atMain } = setup(["ancestral-recall"], []);
  Test.assert(atMain);
  const recall = handOf(game, 0, "ancestral-recall")[0];
  mana.addMana(game, 0, "U", 1, "test");
  const r = castSpell(game, 0, recall, { targets: [0] });
  Test.assert(r.ok, "recall cast: " + (r.reason || ""));
  Test.assertEqual(engine.zoneIds(game, "hand", 0).length, 0, "recall left the hand");
  const res = resolveTop(game);
  Test.assert(res, "recall resolved");
  Test.assertEqual(engine.zoneIds(game, "hand", 0).length, 3, "drew three");
});

Test.test("t22: Counterspell counters an Alpha spell (no leak — the bolt is removed)", () => {
  const { game, atMain } = setup(["lightning-bolt", "counterspell"], []);
  Test.assert(atMain);
  mana.addMana(game, 0, "R", 1, "test");
  const r1 = castSpell(game, 0, handOf(game, 0, "lightning-bolt")[0], { targets: [1] });
  Test.assert(r1.ok, "bolt cast: " + (r1.reason || ""));
  const boltId = r1.objId;
  const p1Life = engine.life(game, 1);
  mana.addMana(game, 0, "U", 2, "test");
  const r2 = castSpell(game, 0, handOf(game, 0, "counterspell")[0], { targets: [boltId] });
  Test.assert(r2.ok, "counter cast: " + (r2.reason || ""));
  Test.assertEqual(game.raw.stack.length, 2, "both spells on the stack");

  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 1, "only the counter resolves");
  const res = out.resolutions[0];
  Test.assertEqual(res.cardId, "counterspell");
  Test.assertEqual(res.countered, [boltId], "the bolt was removed from the stack");
  Test.assertEqual(game.raw.objects[boltId].zone, "graveyard", "countered bolt to the graveyard");
  Test.assertEqual(engine.life(game, 1), p1Life, "no damage leaked through");
  Test.assertEqual(res.fizzled, false, "the counter's target was still a legal spell");
});

Test.test("t22: an Alpha creature resolves to the battlefield with summoning sickness", () => {
  const { game, atMain } = setup(["serra-angel"], []);
  Test.assert(atMain);
  mana.addMana(game, 0, "W", 5, "test");
  const r = castSpell(game, 0, handOf(game, 0, "serra-angel")[0]);
  Test.assert(r.ok, "serra cast: " + (r.reason || ""));
  const res = resolveTop(game);
  Test.assert(res, "serra resolved");
  Test.assertEqual(res.outcome, "permanent-entered");
  Test.assertEqual(res.entered.length, 1);
  Test.assertEqual(res.entered[0].cardId, "serra-angel");
  Test.assertEqual(res.entered[0].name, "Serra Angel");
  const angel = thePermanent(game, 0, "serra-angel");
  Test.assertEqual(game.raw.objects[angel].summoningSickness, true, "new permanent has sickness");
});

Test.test("t22: Healing Salve mode life-gain gives 3 life to the chosen player", () => {
  const { game, atMain } = setup(["healing-salve"], []);
  Test.assert(atMain);
  const p0Before = engine.life(game, 0);
  mana.addMana(game, 0, "W", 1, "test");
  const r = castSpell(game, 0, handOf(game, 0, "healing-salve")[0], { mode: "life-gain", targets: [0] });
  Test.assert(r.ok, "salve cast: " + (r.reason || ""));
  const res = resolveTop(game);
  Test.assert(res, "salve resolved");
  Test.assertEqual(res.mode, "life-gain");
  Test.assertEqual(res.fizzled, false);
  Test.assertEqual(engine.life(game, 0), p0Before + 3, "3 life gained");
});

Test.test("t22: Blue Elemental Blast mode destroy kills a red permanent", () => {
  const { game, atMain } = setup(["blue-elemental-blast"], [
    { cardId: "gray-ogre", count: 1, player: 1 },
  ]);
  Test.assert(atMain);
  const ogre = thePermanent(game, 1, "gray-ogre");
  mana.addMana(game, 0, "U", 1, "test");
  const r = castSpell(game, 0, handOf(game, 0, "blue-elemental-blast")[0], { mode: "destroy", targets: [ogre] });
  Test.assert(r.ok, "blast cast: " + (r.reason || ""));
  const res = resolveTop(game);
  Test.assert(res, "blast resolved");
  Test.assertEqual(res.mode, "destroy");
  Test.assertEqual(res.fizzled, false);
  Test.assertEqual(game.raw.objects[ogre].zone, "graveyard", "red permanent destroyed");
});

// ── fizzle: target became illegal before resolution ───────────────────────────────────
Test.test("t22: a spell whose creature target died fizzles (no effect, still to graveyard)", () => {
  const { game, atMain } = setup(["lightning-bolt", "terror"], [
    { cardId: "gray-ogre", count: 1, player: 1 },
  ]);
  Test.assert(atMain);
  const ogre = thePermanent(game, 1, "gray-ogre");
  const p1Life = engine.life(game, 1);
  mana.addMana(game, 0, "R", 1, "test");
  const r1 = castSpell(game, 0, handOf(game, 0, "lightning-bolt")[0], { targets: [ogre] });
  Test.assert(r1.ok, "bolt at the ogre: " + (r1.reason || ""));
  mana.addMana(game, 0, "B", 2, "test");
  const r2 = castSpell(game, 0, handOf(game, 0, "terror")[0], { targets: [ogre] });
  Test.assert(r2.ok, "terror at the ogre: " + (r2.reason || ""));
  const boltId = r1.objId;
  Test.assertEqual(stackTopEntry(game).cardId, "terror", "terror is on top");

  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 2);

  const terror = out.resolutions[0];
  Test.assertEqual(terror.cardId, "terror");
  Test.assertEqual(terror.fizzled, false, "terror's target was still alive");
  Test.assertEqual(game.raw.objects[ogre].zone, "graveyard", "terror destroyed the ogre");

  const bolt = out.resolutions[1];
  Test.assertEqual(bolt.cardId, "lightning-bolt");
  Test.assertEqual(bolt.fizzled, true, "bolt fizzled — its target is gone");
  Test.assertEqual(bolt.chosenTargets, [ogre], "as cast");
  Test.assertEqual(bolt.targets.length, 0, "no effective targets");
  Test.assertEqual(bolt.illegalTargets.length, 1);
  Test.assertEqual(bolt.illegalTargets[0].target, ogre, "the dead ogre was trimmed");
  Test.assertEqual(engine.life(game, 1), p1Life, "no damage leaked through");
  Test.assertEqual(game.raw.objects[boltId].zone, "graveyard", "the fizzled bolt still goes to the graveyard");
});

Test.test("t22: a counterspell whose target was already countered fizzles", () => {
  const { game, atMain } = setup(["lightning-bolt", "blue-elemental-blast", "counterspell"], []);
  Test.assert(atMain);
  const p1Life = engine.life(game, 1);
  mana.addMana(game, 0, "R", 1, "test");
  const r1 = castSpell(game, 0, handOf(game, 0, "lightning-bolt")[0], { targets: [1] });
  Test.assert(r1.ok, "bolt cast: " + (r1.reason || ""));
  const boltId = r1.objId;
  mana.addMana(game, 0, "U", 1, "test");
  const r2 = castSpell(game, 0, handOf(game, 0, "blue-elemental-blast")[0], { mode: "counter", targets: [boltId] });
  Test.assert(r2.ok, "blue blast counter: " + (r2.reason || ""));
  mana.addMana(game, 0, "U", 2, "test");
  const r3 = castSpell(game, 0, handOf(game, 0, "counterspell")[0], { targets: [boltId] });
  Test.assert(r3.ok, "counterspell: " + (r3.reason || ""));
  Test.assertEqual(game.raw.stack.length, 3);

  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 2, "counterspell resolves; blue blast fizzles; bolt already gone");

  const cs = out.resolutions[0];
  Test.assertEqual(cs.cardId, "counterspell");
  Test.assertEqual(cs.countered, [boltId], "the topmost counter removed the bolt");
  Test.assertEqual(cs.fizzled, false);

  const beb = out.resolutions[1];
  Test.assertEqual(beb.cardId, "blue-elemental-blast");
  Test.assertEqual(beb.fizzled, true, "the blast's spell target is no longer on the stack");
  Test.assertEqual(beb.illegalTargets.length, 1);
  Test.assertEqual(beb.illegalTargets[0].target, boltId);
  Test.assertEqual(beb.targets.length, 0);
  Test.assertEqual(engine.life(game, 1), p1Life, "no damage leaked");
});

// ── partial legality: one of two targets remains legal ────────────────────────────────
Test.test("t22: Fireball with two targets keeps only the still-legal one (partial)", () => {
  const { game, atMain } = setup(["fireball", "terror"], [
    { cardId: "serra-angel", count: 1 },
    { cardId: "savannah-lions", count: 1, player: 1 },
  ]);
  Test.assert(atMain);
  const angel = thePermanent(game, 0, "serra-angel");
  const lions = thePermanent(game, 1, "savannah-lions");
  mana.addMana(game, 0, "R", 4, "test");
  const r1 = castSpell(game, 0, handOf(game, 0, "fireball")[0], { x: 2, targets: [angel, lions] });
  Test.assert(r1.ok, "fireball cast: " + (r1.reason || ""));
  mana.addMana(game, 0, "B", 2, "test");
  const r2 = castSpell(game, 0, handOf(game, 0, "terror")[0], { targets: [lions] });
  Test.assert(r2.ok, "terror cast: " + (r2.reason || ""));
  Test.assertEqual(stackTopEntry(game).cardId, "terror", "terror on top");

  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 2);

  const terror = out.resolutions[0];
  Test.assertEqual(terror.cardId, "terror");
  Test.assertEqual(game.raw.objects[lions].zone, "graveyard", "terror killed the lions");

  const fb = out.resolutions[1];
  Test.assertEqual(fb.cardId, "fireball");
  Test.assertEqual(fb.fizzled, false, "NOT fizzled — one target is still legal");
  Test.assertEqual(fb.chosenTargets.length, 2, "two targets as cast");
  Test.assertEqual(fb.targets, [angel], "only the surviving target is effective");
  Test.assertEqual(fb.illegalTargets.length, 1);
  Test.assertEqual(fb.illegalTargets[0].target, lions, "the dead lions were trimmed");
  Test.assertEqual(game.raw.objects[angel].damage, 2, "the angel took the full 2 damage");
  Test.assertEqual(game.raw.objects[angel].zone, "battlefield", "4/4 angel survives");
});

// ── Aura resolution & fizzle ──────────────────────────────────────────────────────────
Test.test("t22: Unholy Strength attaches to its creature and grants +2/+1", () => {
  const { game, atMain } = setup(["unholy-strength"], [
    { cardId: "gray-ogre", count: 1 },
  ]);
  Test.assert(atMain);
  const ogre = thePermanent(game, 0, "gray-ogre");
  mana.addMana(game, 0, "B", 1, "test");
  const r = castSpell(game, 0, handOf(game, 0, "unholy-strength")[0], { targets: [ogre] });
  Test.assert(r.ok, "aura cast: " + (r.reason || ""));
  const res = resolveTop(game);
  Test.assert(res, "aura resolved");
  Test.assertEqual(res.fizzled, false);
  Test.assertEqual(res.outcome, "permanent-entered");
  const aura = thePermanent(game, 0, "unholy-strength");
  Test.assertEqual(game.raw.objects[ogre].attachments.indexOf(aura) !== -1, true, "aura attached");
  Test.assertEqual(game.raw.objects[aura].attachedTo, ogre, "aura points at its creature");
  const buff = game.raw.effects.find((e) => e.targetId === ogre && e.sourceId === aura);
  Test.assert(buff, "the aura's buff effect exists");
  Test.assertEqual(buff.power, 2);
  Test.assertEqual(buff.toughness, 1);
});

Test.test("t22: an Aura whose enchant target is destroyed fizzles to the graveyard", () => {
  const { game, atMain } = setup(["unholy-strength", "terror"], [
    { cardId: "gray-ogre", count: 1 },
  ]);
  Test.assert(atMain);
  const ogre = thePermanent(game, 0, "gray-ogre");
  mana.addMana(game, 0, "B", 1, "test");
  const r1 = castSpell(game, 0, handOf(game, 0, "unholy-strength")[0], { targets: [ogre] });
  Test.assert(r1.ok, "aura cast: " + (r1.reason || ""));
  mana.addMana(game, 0, "B", 2, "test");
  const r2 = castSpell(game, 0, handOf(game, 0, "terror")[0], { targets: [ogre] });
  Test.assert(r2.ok, "terror cast: " + (r2.reason || ""));

  const out = resolveAll(game);
  Test.assertEqual(out.resolutions.length, 2);
  Test.assertEqual(out.resolutions[0].cardId, "terror", "terror on top resolved first");
  Test.assertEqual(game.raw.objects[ogre].zone, "graveyard", "ogre destroyed");

  const aura = out.resolutions[1];
  Test.assertEqual(aura.cardId, "unholy-strength");
  Test.assertEqual(aura.fizzled, true, "aura fizzled — nothing to enchant");
  Test.assertEqual(aura.targets.length, 0);
  const auraObj = Object.values(game.raw.objects).find((o) => o.cardId === "unholy-strength");
  Test.assertEqual(auraObj.zone, "graveyard", "the fizzled aura goes to the graveyard");
  Test.assertEqual(battlefieldOf(game, 0, "unholy-strength").length, 0, "no aura left on the battlefield");
});

// ── direct legality re-check ──────────────────────────────────────────────────────────
Test.test("t22: checkTargetsAtResolve reports the still-legal subset and reasons", () => {
  const { game, atMain } = setup(["lightning-bolt"], [
    { cardId: "gray-ogre", count: 1, player: 1 },
  ]);
  Test.assert(atMain);
  const ogre = thePermanent(game, 1, "gray-ogre");
  mana.addMana(game, 0, "R", 1, "test");
  const r = castSpell(game, 0, handOf(game, 0, "lightning-bolt")[0], { targets: [ogre] });
  Test.assert(r.ok, "bolt cast: " + (r.reason || ""));

  const before = checkTargetsAtResolve(game, game.raw.stack[0]);
  Test.assertEqual(before.legal, [ogre], "alive creature is legal");
  Test.assertEqual(before.illegal.length, 0);

  // Kill the creature directly (SBA) — the same check now finds it illegal.
  game.raw.objects[ogre].zone = "graveyard";
  game.raw.battlefield.splice(game.raw.battlefield.indexOf(ogre), 1);
  game.raw.players[1].graveyard.push(ogre);
  const after = checkTargetsAtResolve(game, game.raw.stack[0]);
  Test.assertEqual(after.legal.length, 0, "dead creature is no longer legal");
  Test.assertEqual(after.illegal.length, 1);
  Test.assert(/battlefield/i.test(after.illegal[0].reason), "reason names the zone: " + after.illegal[0].reason);
});
