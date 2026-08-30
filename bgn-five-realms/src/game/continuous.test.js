// Continuous effects & static abilities tests (roadmap Phase 7, task 24). The
// five-realms-plugin has no global static effects (its frPower/frToughness fold only
// exact-target layer-7 effect entries); src/game/continuous.js implements them by syncing
// each active "powerToughness" declaration (src/cards/continuous.js — Crusade, Bad Moon,
// Lord of Atlantis, Goblin King, Castle) into state.effects as per-target entries on
// every state change, so the plugin's own combat/SBA math and the local queries see the
// buffs. Keyword grants (islandwalk/mountainwalk/flying) live on a per-object overlay
// (grantedKeywords), and Mana Flare's "mana" layer adds bonus mana on land taps.
// Covered here:
//   • Crusade-style global pump: white creatures +1/+1, other colours untouched, applies
//     regardless of who controls the creature,
//   • type-based pumps: Bad Moon (black), Lord of Atlantis (other Merfolk) + Goblin King
//     (other Goblins) with the "other"/self-exclusion rule,
//   • Lord-style keyword grant: a Merfolk next to Lord of Atlantis has islandwalk,
//   • re-evaluation: the pump appears when the source enters, vanishes when it leaves,
//     and stale synced entries are purged,
//   • conditional pump: Castle only pumps untapped creatures its controller controls,
//   • stacking: Crusade + Castle both apply to the same creature,
//   • plugin integration: the engine's SBA sees the buff (a 2/1 with 1 damage survives
//     under Crusade but dies without it),
//   • generic keyword grant via a synthetic card ("creatures you control gain flying"),
//   • Mana Flare: tapping a Mountain through the plugin produces 2 red; a dual land
//     through the local path produces 2 of the chosen colour,
//   • durability: snapshot/restore preserves global pumps and granted keywords.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import * as mana from "./mana.js";
import * as continuous from "./continuous.js";
import { ALPHA_TO_PLUGIN } from "../cards/plugin.js";

// A synthetic enchantment carrying a keyword-only continuous declaration — validates the
// framework's generic capability ("creatures you control gain flying") with no Alpha
// representative. It has no P/T modifier, so it must grant keywords only.
const SYN_CARDS = {
  "wind-banner": {
    id: "wind-banner", name: "Wind Banner", manaCost: "{3}{W}", cmc: 4,
    colors: ["W"], colorIdentity: ["W"], supertypes: [], types: ["Enchantment"],
    subtypes: [], rulesText: "Creatures you control have flying.",
    rarity: "Marked", frame: "marked", glyph: "solara",
    continuous: [{ layer: "powerToughness", keywords: ["flying"], filter: { types: ["Creature"] }, controller: "self" }],
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

function removeFromBattlefield(game, id) {
  const raw = game.raw;
  const obj = raw.objects[id];
  if (!obj || obj.zone !== "battlefield") return;
  const idx = raw.battlefield.indexOf(id);
  if (idx !== -1) raw.battlefield.splice(idx, 1);
  obj.zone = "graveyard";
  raw.players[obj.owner].graveyard.push(id);
}

// A fresh game at P0's turn-1 (the plugin's initial state) with permanents injected and
// the continuous layer synced, so P/T/keyword queries are valid immediately. opts:
// { inject: [{cardId, count, player}], cards, tap: [objIds] }.
function freshGame(opts = {}) {
  const deck = Array(30).fill("vast-plains");
  const game = engine.newGame({
    seed: 7,
    decks: [deck.slice(), deck.slice()],
    cards: Object.assign({}, SYN_CARDS, opts.cards || {}),
  });
  turn.initTurnTracker(game);
  const injected = [];
  for (const inj of opts.inject || []) {
    for (let i = 0; i < inj.count; i++) injected.push(injectPermanent(game, inj.player || 0, inj.cardId));
  }
  for (const id of opts.tap || []) {
    if (game.raw.objects[id]) game.raw.objects[id].tapped = true;
  }
  continuous.syncContinuousEffects(game);
  return game;
}

function idsOf(...names) {
  return names.map((n) => {
    const rec = ALPHA_TO_PLUGIN.find((c) => c.name === n);
    Test.assert(rec, "projection has " + n);
    return rec.id;
  });
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

// ── Crusade-style global pumps ─────────────────────────────────────────────────────────
Test.test("t24: Crusade pumps every white creature +1/+1, other colours untouched", () => {
  const [crusade, lions, ogre] = idsOf("Crusade", "Savannah Lions", "Gray Ogre");
  const game = freshGame({ inject: [{ cardId: crusade, count: 1 }, { cardId: lions, count: 1 }, { cardId: ogre, count: 1 }] });
  const l = thePermanent(game, 0, lions);
  const o = thePermanent(game, 0, ogre);
  Test.assertEqual(continuous.derivedPower(game, l), 3, "white lion is 3/2 under Crusade");
  Test.assertEqual(continuous.derivedToughness(game, l), 2, "white lion toughness 2");
  Test.assertEqual(continuous.derivedPower(game, o), 2, "red ogre stays 2/2");
  Test.assertEqual(continuous.derivedToughness(game, o), 2, "red ogre toughness 2");
  const cId = thePermanent(game, 0, crusade);
  const synced = game.raw.effects.filter((e) => e.global && e.targetId === l && e.sourceId === cId);
  Test.assertEqual(synced.length, 1, "a per-target layer-7 entry targets the lion");
  Test.assertEqual(synced[0].power, 1, "entry carries the +1 power");
  Test.assertEqual(synced[0].toughness, 1, "entry carries the +1 toughness");
  const sum = continuous.effectSummary(game).find((e) => e.sourceName === "Crusade");
  Test.assert(sum, "summary lists Crusade");
  Test.assertEqual(sum.applied.length, 1, "Crusade applies only to the white creature");
});

Test.test("t24: Crusade pumps a white creature regardless of who controls it", () => {
  const [crusade, lions] = idsOf("Crusade", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: crusade, count: 1 }, { cardId: lions, count: 1, player: 1 }] });
  const l = thePermanent(game, 1, lions);
  Test.assertEqual(continuous.derivedPower(game, l), 3, "opponent's white creature is pumped too (no controller clause)");
});

Test.test("t24: Bad Moon pumps only black creatures", () => {
  const [badMoon, knight, lions] = idsOf("Bad Moon", "Black Knight", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: badMoon, count: 1 }, { cardId: knight, count: 1 }, { cardId: lions, count: 1 }] });
  const k = thePermanent(game, 0, knight);
  const l = thePermanent(game, 0, lions);
  Test.assertEqual(continuous.derivedPower(game, k), 3, "black knight is 3/3 under Bad Moon");
  Test.assertEqual(continuous.derivedToughness(game, k), 3, "black knight toughness 3");
  Test.assertEqual(continuous.derivedPower(game, l), 2, "white lion stays 2/1");
  Test.assertEqual(continuous.derivedToughness(game, l), 1, "white lion toughness 1");
});

// ── Lord-style type pumps + keyword grants ─────────────────────────────────────────────
Test.test("t24: Lord of Atlantis pumps other Merfolk +1/+1 and grants islandwalk, not itself", () => {
  const [lord, merfolk] = idsOf("Lord of Atlantis", "Merfolk of the Pearl Trident");
  const game = freshGame({ inject: [{ cardId: lord, count: 1 }, { cardId: merfolk, count: 1 }] });
  const lo = thePermanent(game, 0, lord);
  const m = thePermanent(game, 0, merfolk);
  Test.assertEqual(continuous.derivedPower(game, m), 2, "other Merfolk is 2/2 under the Lord");
  Test.assertEqual(continuous.derivedToughness(game, m), 2, "Merfolk toughness 2");
  Test.assert(continuous.grantedKeywords(game, m).includes("islandwalk"), "Merfolk gained islandwalk");
  Test.assertEqual(continuous.derivedPower(game, lo), 2, "the Lord itself stays 2/2 (\"Other\")");
  Test.assertEqual(continuous.derivedToughness(game, lo), 2, "Lord toughness 2");
  Test.assert(!continuous.grantedKeywords(game, lo).includes("islandwalk"), "the Lord does not grant itself islandwalk");
});

Test.test("t24: Goblin King pumps other Goblins +1/+1 and grants mountainwalk", () => {
  const king = idsOf("Goblin King")[0];
  const game = freshGame({
    inject: [
      { cardId: king, count: 1 },
      { cardId: "goblin-balloon-brigade", count: 1 },
      { cardId: "gray-ogre", count: 1 },
    ],
  });
  const gob = thePermanent(game, 0, "goblin-balloon-brigade");
  const ogre = thePermanent(game, 0, "gray-ogre");
  Test.assertEqual(continuous.derivedPower(game, gob), 2, "Goblin Balloon Brigade 1/1 -> 2/2 under the King");
  Test.assert(continuous.grantedKeywords(game, gob).includes("mountainwalk"), "Goblin gained mountainwalk");
  Test.assertEqual(continuous.derivedPower(game, ogre), 2, "non-Goblin ogre unpumped");
});

// ── re-evaluation on enter / leave ─────────────────────────────────────────────────────
Test.test("t24: the pump appears when the source enters and vanishes when it leaves", () => {
  const [lord, merfolk] = idsOf("Lord of Atlantis", "Merfolk of the Pearl Trident");
  const game = freshGame({ inject: [{ cardId: merfolk, count: 1 }] });
  const m = thePermanent(game, 0, merfolk);
  Test.assertEqual(continuous.derivedPower(game, m), 1, "Merfolk is 1/1 before any lord");
  const lordId = injectPermanent(game, 0, lord);
  continuous.syncContinuousEffects(game);
  Test.assertEqual(continuous.derivedPower(game, m), 2, "lord enters -> Merfolk is 2/2");
  Test.assert(continuous.grantedKeywords(game, m).includes("islandwalk"), "islandwalk granted on entry");
  removeFromBattlefield(game, lordId);
  continuous.syncContinuousEffects(game);
  Test.assertEqual(continuous.derivedPower(game, m), 1, "lord leaves -> Merfolk back to 1/1");
  Test.assert(!continuous.grantedKeywords(game, m).includes("islandwalk"), "islandwalk removed on leave");
});

Test.test("t24: syncing purges stale global entries when the source is gone", () => {
  const [crusade, lions] = idsOf("Crusade", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: crusade, count: 1 }, { cardId: lions, count: 1 }] });
  Test.assert(game.raw.effects.some((e) => e.global), "global entries present with Crusade");
  removeFromBattlefield(game, thePermanent(game, 0, crusade));
  continuous.syncContinuousEffects(game);
  Test.assertEqual(game.raw.effects.filter((e) => e.global).length, 0, "no stale global entries after the source leaves");
});

// ── conditional pumps ──────────────────────────────────────────────────────────────────
Test.test("t24: Castle pumps only untapped creatures its controller controls", () => {
  const [castle, lions] = idsOf("Castle", "Savannah Lions");
  const game = freshGame({
    inject: [
      { cardId: castle, count: 1 },
      { cardId: lions, count: 3 },
      { cardId: lions, count: 1, player: 1 },
    ],
  });
  const [untapped, tapped, other] = battlefieldOf(game, 0, lions).map((o) => o.id);
  const enemy = thePermanent(game, 1, lions);
  game.raw.objects[tapped].tapped = true;
  continuous.syncContinuousEffects(game);
  Test.assertEqual(continuous.derivedToughness(game, untapped), 3, "untapped own creature is 1/3");
  Test.assertEqual(continuous.derivedToughness(game, tapped), 1, "tapped own creature unpumped");
  Test.assertEqual(continuous.derivedToughness(game, enemy), 1, "opponent's untapped creature unpumped (controller: self)");
});

// ── stacking ───────────────────────────────────────────────────────────────────────────
Test.test("t24: multiple global pumps stack on the same creature (Crusade + Castle)", () => {
  const [crusade, castle, lions] = idsOf("Crusade", "Castle", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: crusade, count: 1 }, { cardId: castle, count: 1 }, { cardId: lions, count: 1 }] });
  const l = thePermanent(game, 0, lions);
  Test.assertEqual(continuous.derivedPower(game, l), 3, "2 + Crusade 1 = 3 power");
  Test.assertEqual(continuous.derivedToughness(game, l), 4, "1 + Crusade 1 + Castle 2 = 4 toughness");
});

// ── plugin integration (the engine's SBA sees the buff) ────────────────────────────────
Test.test("t24: the plugin's SBA sees the buff — a 2/1 with 1 damage survives under Crusade", () => {
  const [crusade, lions] = idsOf("Crusade", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: crusade, count: 1 }, { cardId: lions, count: 1 }] });
  turn.walkToStep(game, "precombat_main");
  const l = thePermanent(game, 0, lions);
  game.raw.objects[l].damage = 1;
  turn.pass(game, 0);
  Test.assertEqual(game.raw.objects[l].zone, "battlefield", "2/1 with 1 damage survives (toughness 2 under Crusade)");
});

Test.test("t24: without the buff the same 2/1 with 1 damage dies to SBA", () => {
  const lions = idsOf("Savannah Lions")[0];
  const game = freshGame({ inject: [{ cardId: lions, count: 1 }] });
  turn.walkToStep(game, "precombat_main");
  const l = thePermanent(game, 0, lions);
  game.raw.objects[l].damage = 1;
  turn.pass(game, 0);
  Test.assertEqual(game.raw.objects[l].zone, "graveyard", "2/1 with 1 damage dies without the buff (toughness 1)");
});

// ── generic keyword grant (synthetic "creatures you control gain flying") ─────────────
Test.test("t24: a keyword-only declaration grants flying only to the source's creatures", () => {
  const game = freshGame({
    inject: [
      { cardId: "wind-banner", count: 1 },
      { cardId: "savannah-lions", count: 1 },
      { cardId: "savannah-lions", count: 1, player: 1 },
    ],
  });
  const mine = thePermanent(game, 0, "savannah-lions");
  const enemy = thePermanent(game, 1, "savannah-lions");
  Test.assert(continuous.grantedKeywords(game, mine).includes("flying"), "own creature gained flying");
  Test.assert(!continuous.grantedKeywords(game, enemy).includes("flying"), "opponent's creature did not");
  Test.assertEqual(continuous.derivedPower(game, mine), 2, "keyword-only grant leaves P/T untouched");
  const banner = thePermanent(game, 0, "wind-banner");
  Test.assert(!continuous.grantedKeywords(game, banner).includes("flying"), "non-creature source gains nothing from its own effect");
});

// ── Mana Flare ("lands produce two mana") ──────────────────────────────────────────────
Test.test("t24: Mana Flare makes a Mountain produce two red through the plugin's tap path", () => {
  const [flare] = idsOf("Mana Flare");
  const game = freshGame({ inject: [{ cardId: flare, count: 1 }, { cardId: "mountain", count: 1 }] });
  turn.walkToStep(game, "precombat_main");
  const mt = thePermanent(game, 0, "mountain");
  turn.doAction(game, { type: "activateAbility", player: 0, objectId: mt });
  Test.assertEqual(game.raw.players[0].manaPool.R, 2, "one tap produces 2 red under Mana Flare");
  Test.assertEqual(mana.producedThisTurn(game, 0).R, 2, "the produced-mana tracker counts the bonus");
  const bonus = continuous.continuousLog(game).filter((e) => e.action === "manaBonus");
  Test.assertEqual(bonus.length, 1, "one manaBonus logged");
  Test.assertEqual(bonus[0].sourceName, "Mana Flare");
});

Test.test("t24: Mana Flare applies to the opponent's land taps too", () => {
  const [flare] = idsOf("Mana Flare");
  const game = freshGame({ inject: [{ cardId: flare, count: 1, player: 1 }, { cardId: "mountain", count: 1, player: 1 }] });
  turn.walk(game, { until: (g) => g.raw.turnNumber === 2 && g.raw.step === "precombat_main", max: 400 });
  const mt = thePermanent(game, 1, "mountain");
  turn.doAction(game, { type: "activateAbility", player: 1, objectId: mt });
  Test.assertEqual(game.raw.players[1].manaPool.R, 2, "P1's Mountain tap produces 2 red under P1's own Mana Flare");
});

Test.test("t24: Mana Flare adds a bonus to a dual land through the local mana path", () => {
  const [flare] = idsOf("Mana Flare");
  const game = freshGame({ inject: [{ cardId: flare, count: 1 }, { cardId: "tundra", count: 1 }] });
  turn.walkToStep(game, "precombat_main");
  const td = thePermanent(game, 0, "tundra");
  mana.activateManaAbility(game, 0, td, "U");
  Test.assertEqual(game.raw.players[0].manaPool.U, 2, "Tundra for {U} produces 2 blue under Mana Flare");
  Test.assertEqual(mana.producedThisTurn(game, 0).U, 2, "produced tracker counts base + bonus");
});

Test.test("t24: no bonus without a flare", () => {
  const game = freshGame({ inject: [{ cardId: "mountain", count: 1 }] });
  turn.walkToStep(game, "precombat_main");
  const mt = thePermanent(game, 0, "mountain");
  turn.doAction(game, { type: "activateAbility", player: 0, objectId: mt });
  Test.assertEqual(game.raw.players[0].manaPool.R, 1, "a plain Mountain tap produces 1 red with no flare");
});

// ── durability ─────────────────────────────────────────────────────────────────────────
Test.test("t24: snapshot/restore preserves global pumps and granted keywords", () => {
  const [lord, merfolk] = idsOf("Lord of Atlantis", "Merfolk of the Pearl Trident");
  const game = freshGame({ inject: [{ cardId: lord, count: 1 }, { cardId: merfolk, count: 1 }] });
  const m = thePermanent(game, 0, merfolk);
  Test.assertEqual(continuous.derivedPower(game, m), 2, "setup: 2/2 before snapshot");
  const snap = engine.snapshot(game);
  const r = engine.restore(snap);
  const m2 = thePermanent(r, 0, merfolk);
  Test.assertEqual(continuous.derivedPower(r, m2), 2, "pump survives the round-trip");
  Test.assertEqual(continuous.derivedToughness(r, m2), 2, "toughness survives");
  Test.assert(continuous.grantedKeywords(r, m2).includes("islandwalk"), "granted keyword survives the round-trip");
});
