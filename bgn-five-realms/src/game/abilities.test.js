// Activated abilities tests (roadmap Phase 8, task 25). The five-realms-plugin already
// implements a card.abilities framework (costs {T}/mana/life, summoning-sickness
// enforcement, a targeting subset, and resolution through its template library);
// src/cards/abilities.js declares every Alpha activated ability that fits the current
// engine, src/game/abilities.js layers the rich Alpha targeting filters + activation
// timing on top, and src/game/regenerate.js implements the 1993 regeneration rule the
// plugin lacks (the plugin's template library has no "regenerate" op). Covered here:
//   • the plugin enumerates tap-to-damage in legalActions and resolves a "zap" entry,
//   • tap costs: source taps, already-tapped sources and summoning-sick creatures throw,
//   • instant-speed timing (activate during combat), and the Disrupting Scepter's
//     yourTurn-only restriction (rejected on an opponent's turn),
//   • mana costs (Granite Gargoyle {R} pump pays from the pool; pool empties),
//   • life costs via a synthetic card (pays at activation, applies at resolution,
//     rejected when the pool-of-life is short),
//   • rich local targeting: Royal Assassin rejects untapped targets, Northern Paladin
//     rejects non-black permanents,
//   • damage abilities: zap kills a 1/1, Orcish Artillery hits target + controller,
//     Ley Druid untaps a tapped land, Icy Manipulator taps, Demonic Hordes destroys a
//     land, Samite Healer's prevention shield absorbs the next point of damage,
//   • regeneration: a shield is granted on resolution, lethal damage and destroy both
//     save the creature (tapped, damage cleared, shield consumed), no shield = death,
//     two shields = two saves, and snapshot/restore preserves shields.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import * as resolve from "./resolve.js";
import * as stack from "./stack.js";
import * as regenerate from "./regenerate.js";
import * as continuous from "./continuous.js";
import { ALPHA_TO_PLUGIN } from "../cards/plugin.js";

// A synthetic artifact with a life-cost activated ability — validates the life-cost
// machinery the Alpha set exercises through no clean standalone card.
const SYN_CARDS = {
  "life-pain": {
    id: "life-pain", name: "Life Pain", manaCost: "{0}", cmc: 0,
    colors: ["B"], colorIdentity: ["B"], supertypes: [], types: ["Artifact"],
    subtypes: [], rulesText: "Pay 3 life: You lose 3 life.",
    rarity: "Marked", frame: "marked", glyph: "umbra",
    abilities: [{
      name: "pay-life", cost: { life: 3 },
      effects: [{ op: "life", amount: 3, gain: false, targets: ["controller"] }],
    }],
  },
};

// ── helpers ───────────────────────────────────────────────────────────────────────────
function injectPermanent(game, player, cardId, opts = {}) {
  const id = "obj" + game.raw.nextObjectId++;
  game.raw.objects[id] = {
    id, cardId, owner: player, controller: player, zone: "battlefield",
    tapped: !!opts.tapped, summoningSickness: !!opts.sick, counters: {}, attachments: [],
    buffsUntilEot: { power: 0, toughness: 0 }, attachedTo: null, damage: 0,
    attacking: false, blocking: null,
  };
  game.raw.battlefield.push(id);
  return id;
}

// A fresh game at P0's turn-1 upkeep with permanents injected, then walked to a priority
// step (default precombat_main) and given a mana pool. opts: { inject, tap, cards, mana,
// step }.
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
    for (let i = 0; i < inj.count; i++) {
      injected.push(injectPermanent(game, inj.player || 0, inj.cardId, inj));
    }
  }
  for (const id of opts.tap || []) {
    if (game.raw.objects[id]) game.raw.objects[id].tapped = true;
  }
  const step = opts.step || "precombat_main";
  if (game.raw.step !== step) turn.walkToStep(game, step);
  if (opts.mana) {
    for (const sym of Object.keys(opts.mana)) game.raw.players[0].manaPool[sym] = opts.mana[sym];
  }
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

function activate(game, player, objectId, abilityName, targets) {
  turn.doAction(game, { type: "activateAbility", player, objectId, abilityName, targets: targets || [] });
}

function rejectMessage(game, action) {
  try {
    turn.doAction(game, action);
    return null;
  } catch (e) {
    return e.message;
  }
}

function drawCards(game, player, n) {
  for (let i = 0; i < n; i++) {
    const pl = game.raw.players[player];
    if (pl.library.length === 0) break;
    const id = pl.library.shift();
    pl.hand.push(id);
    game.raw.objects[id].zone = "hand";
  }
}

// ── plugin integration: enumeration + resolution shape ────────────────────────────────
Test.test("t25: legalActions offers the zap ability on an untapped Prodigal Sorcerer", () => {
  const [sorc] = idsOf("Prodigal Sorcerer");
  const game = freshGame({ inject: [{ cardId: sorc, count: 1 }] });
  const s = thePermanent(game, 0, sorc);
  const acts = engine.legalActions(game);
  const zaps = acts.filter((a) => a.type === "activateAbility" && a.abilityName === "zap" && a.objectId === s);
  Test.assert(zaps.length > 0, "zap appears in legalActions");
  Test.assert(Array.isArray(zaps[0].targets) && zaps[0].targets.length >= 1, "zap enumerates target sets");
});

Test.test("t25: activating zap pushes a stack entry and resolveTop reports the ability", () => {
  const [sorc, lions] = idsOf("Prodigal Sorcerer", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: sorc, count: 1 }, { cardId: lions, count: 1, player: 1 }] });
  const s = thePermanent(game, 0, sorc);
  const l = thePermanent(game, 1, lions);
  activate(game, 0, s, "zap", [l]);
  const top = stack.stackTop(game);
  Test.assertEqual(top.kind, "ability", "stack top is an ability");
  Test.assertEqual(top.abilityName, "zap", "abilityName is zap");
  Test.assertEqual(top.cardId, sorc, "source card is the sorcerer");
  Test.assertEqual(top.targets.length, 1, "one target chosen");
  const r = resolve.resolveTop(game);
  Test.assert(r, "resolution report returned");
  Test.assertEqual(r.kind, "ability", "report kind is ability");
  Test.assertEqual(r.abilityName, "zap", "report abilityName is zap");
});

// ── tap costs ─────────────────────────────────────────────────────────────────────────
Test.test("t25: zap deals 1 damage, kills a 2/1, and taps the source", () => {
  const [sorc, lions] = idsOf("Prodigal Sorcerer", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: sorc, count: 1 }, { cardId: lions, count: 1, player: 1 }] });
  const s = thePermanent(game, 0, sorc);
  const l = thePermanent(game, 1, lions);
  activate(game, 0, s, "zap", [l]);
  Test.assertEqual(game.raw.objects[s].tapped, true, "sorcerer tapped by the cost");
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[l].zone, "graveyard", "1 damage is lethal to the 2/1 lion");
  Test.assertEqual(game.raw.objects[l].damage, 0, "death clears damage");
});

Test.test("t25: a summoning-sick creature cannot activate a tap ability", () => {
  const [sorc, lions] = idsOf("Prodigal Sorcerer", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: sorc, count: 1, sick: true }, { cardId: lions, count: 1, player: 1 }] });
  const s = thePermanent(game, 0, sorc);
  const l = thePermanent(game, 1, lions);
  const msg = rejectMessage(game, { type: "activateAbility", player: 0, objectId: s, abilityName: "zap", targets: [l] });
  Test.assert(msg && msg.indexOf("summoning sickness") !== -1, "sickness rejection: " + msg);
  Test.assertEqual(game.raw.objects[s].tapped, false, "tap cost not paid on rejection");
});

Test.test("t25: an already-tapped source cannot activate a tap ability", () => {
  const [sorc, lions] = idsOf("Prodigal Sorcerer", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: sorc, count: 1 }, { cardId: lions, count: 1, player: 1 }] });
  const s = thePermanent(game, 0, sorc);
  const l = thePermanent(game, 1, lions);
  game.raw.objects[s].tapped = true;
  const msg = rejectMessage(game, { type: "activateAbility", player: 0, objectId: s, abilityName: "zap", targets: [l] });
  Test.assert(msg && msg.indexOf("already tapped") !== -1, "already-tapped rejection: " + msg);
});

// ── timing ────────────────────────────────────────────────────────────────────────────
Test.test("t25: an untimed ability is instant-speed — zap during declare_attackers", () => {
  const [sorc, lions] = idsOf("Prodigal Sorcerer", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: sorc, count: 1 }, { cardId: lions, count: 1, player: 1 }], step: "declare_attackers" });
  const s = thePermanent(game, 0, sorc);
  const l = thePermanent(game, 1, lions);
  activate(game, 0, s, "zap", [l]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[l].zone, "graveyard", "zap resolved during the combat step");
});

Test.test("t25: Disrupting Scepter's coerce is yourTurn-only — works on own turn", () => {
  const [scepter] = idsOf("Disrupting Scepter");
  const game = freshGame({ inject: [{ cardId: scepter, count: 1 }], mana: { C: 3 } });
  drawCards(game, 1, 1);
  const sc = thePermanent(game, 0, scepter);
  const handBefore = game.raw.players[1].hand.length;
  activate(game, 0, sc, "coerce", [1]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.players[1].hand.length, handBefore - 1, "opponent discarded a card");
  Test.assertEqual(game.raw.players[0].manaPool.C, 0, "the {3} was paid");
  Test.assertEqual(game.raw.objects[sc].tapped, true, "scepter tapped");
});

Test.test("t25: Disrupting Scepter's coerce is rejected on an opponent's turn", () => {
  const [scepter] = idsOf("Disrupting Scepter");
  const game = freshGame({ inject: [{ cardId: scepter, count: 1 }] });
  turn.walk(game, { until: (g) => g.raw.turnNumber === 2 && g.raw.step === "precombat_main", max: 400 });
  const sc = thePermanent(game, 0, scepter);
  const msg = rejectMessage(game, { type: "activateAbility", player: 0, objectId: sc, abilityName: "coerce", targets: [1] });
  Test.assert(msg && msg.indexOf("only during your turn") !== -1, "yourTurn rejection: " + msg);
});

// ── mana costs ────────────────────────────────────────────────────────────────────────
Test.test("t25: Granite Gargoyle's {R} fortify pays from the pool and pumps +0/+1", () => {
  const [garg] = idsOf("Granite Gargoyle");
  const game = freshGame({ inject: [{ cardId: garg, count: 1 }], mana: { R: 1 } });
  const g = thePermanent(game, 0, garg);
  activate(game, 0, g, "fortify");
  resolve.resolveTop(game);
  Test.assertEqual(continuous.derivedToughness(game, g), 3, "2/2 -> 2/3 until end of turn");
  Test.assertEqual(continuous.derivedPower(game, g), 2, "power unchanged");
  Test.assertEqual(game.raw.players[0].manaPool.R, 0, "the {R} was paid");
});

Test.test("t25: a mana-cost ability is rejected when the pool cannot pay", () => {
  const [garg] = idsOf("Granite Gargoyle");
  const game = freshGame({ inject: [{ cardId: garg, count: 1 }], mana: {} });
  const g = thePermanent(game, 0, garg);
  const msg = rejectMessage(game, { type: "activateAbility", player: 0, objectId: g, abilityName: "fortify" });
  Test.assert(msg && msg.indexOf("cannot pay the {R}") !== -1, "unpayable mana rejection: " + msg);
  Test.assert(stack.stackIsEmpty(game), "nothing pushed onto the stack");
});

// ── life costs ────────────────────────────────────────────────────────────────────────
Test.test("t25: a life-cost ability pays at activation and applies at resolution", () => {
  const game = freshGame({ inject: [{ cardId: "life-pain", count: 1 }] });
  const lp = thePermanent(game, 0, "life-pain");
  activate(game, 0, lp, "pay-life");
  Test.assertEqual(game.raw.players[0].life, 17, "3 life paid at activation");
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.players[0].life, 14, "effect loses 3 more at resolution");
});

Test.test("t25: a life-cost ability is rejected when life is short", () => {
  const game = freshGame({ inject: [{ cardId: "life-pain", count: 1 }] });
  const lp = thePermanent(game, 0, "life-pain");
  engine.setLife(game, 0, 2, "test");
  const msg = rejectMessage(game, { type: "activateAbility", player: 0, objectId: lp, abilityName: "pay-life" });
  Test.assert(msg && msg.indexOf("cannot pay the life") !== -1, "short-life rejection: " + msg);
  Test.assertEqual(game.raw.players[0].life, 2, "no life lost on rejection");
});

// ── rich local targeting ──────────────────────────────────────────────────────────────
Test.test("t25: Royal Assassin rejects an untapped target but destroys a tapped one", () => {
  const [assassin, lions] = idsOf("Royal Assassin", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: assassin, count: 1 }, { cardId: lions, count: 1, player: 1 }] });
  const a = thePermanent(game, 0, assassin);
  const l = thePermanent(game, 1, lions);
  const msg = rejectMessage(game, { type: "activateAbility", player: 0, objectId: a, abilityName: "murder", targets: [l] });
  Test.assert(msg && msg.indexOf("must be tapped") !== -1, "untapped-target rejection: " + msg);
  game.raw.objects[l].tapped = true;
  activate(game, 0, a, "murder", [l]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[l].zone, "graveyard", "tapped creature destroyed");
  Test.assertEqual(game.raw.objects[a].tapped, true, "assassin tapped");
});

Test.test("t25: Northern Paladin rejects a non-black permanent and destroys a black one", () => {
  const [paladin, wraith, ogre] = idsOf("Northern Paladin", "Bog Wraith", "Gray Ogre");
  const game = freshGame({ inject: [{ cardId: paladin, count: 1 }, { cardId: wraith, count: 1, player: 1 }, { cardId: ogre, count: 1, player: 1 }], mana: { W: 2 } });
  const p = thePermanent(game, 0, paladin);
  const w = thePermanent(game, 1, wraith);
  const o = thePermanent(game, 1, ogre);
  const msg = rejectMessage(game, { type: "activateAbility", player: 0, objectId: p, abilityName: "smite", targets: [o] });
  Test.assert(msg && msg.indexOf("wrong color") !== -1, "non-black rejection: " + msg);
  activate(game, 0, p, "smite", [w]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[w].zone, "graveyard", "black permanent destroyed");
  Test.assertEqual(game.raw.objects[o].zone, "battlefield", "red permanent untouched");
});

// ── the ability zoo ───────────────────────────────────────────────────────────────────
Test.test("t25: Orcish Artillery deals 2 to the target and 3 to its controller", () => {
  const [arty, ogre] = idsOf("Orcish Artillery", "Gray Ogre");
  const game = freshGame({ inject: [{ cardId: arty, count: 1 }, { cardId: ogre, count: 1, player: 1 }] });
  const a = thePermanent(game, 0, arty);
  const o = thePermanent(game, 1, ogre);
  const lifeBefore = game.raw.players[0].life;
  activate(game, 0, a, "bombard", [o]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[o].zone, "graveyard", "2 damage kills the 2/2 ogre");
  Test.assertEqual(game.raw.players[0].life, lifeBefore - 3, "controller took 3 damage");
  Test.assertEqual(game.raw.objects[a].tapped, true, "artillery tapped");
});

Test.test("t25: Ley Druid untaps a tapped land", () => {
  const [druid] = idsOf("Ley Druid");
  const game = freshGame({ inject: [{ cardId: druid, count: 1 }, { cardId: "mountain", count: 1 }] });
  const d = thePermanent(game, 0, druid);
  const mt = thePermanent(game, 0, "mountain");
  game.raw.objects[mt].tapped = true;
  activate(game, 0, d, "untap", [mt]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[mt].tapped, false, "land untapped");
  Test.assertEqual(game.raw.objects[d].tapped, true, "druid tapped");
});

Test.test("t25: Icy Manipulator taps a creature for {1}", () => {
  const [icy, lions] = idsOf("Icy Manipulator", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: icy, count: 1 }, { cardId: lions, count: 1, player: 1 }], mana: { C: 1 } });
  const ic = thePermanent(game, 0, icy);
  const l = thePermanent(game, 1, lions);
  activate(game, 0, ic, "freeze", [l]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[l].tapped, true, "lion tapped");
  Test.assertEqual(game.raw.objects[ic].tapped, true, "manipulator tapped");
  Test.assertEqual(game.raw.players[0].manaPool.C, 0, "the {1} was paid");
});

Test.test("t25: Demonic Hordes destroys a target land", () => {
  const [hordes] = idsOf("Demonic Hordes");
  const game = freshGame({ inject: [{ cardId: hordes, count: 1 }, { cardId: "mountain", count: 1, player: 1 }] });
  const h = thePermanent(game, 0, hordes);
  const mt = thePermanent(game, 1, "mountain");
  activate(game, 0, h, "ravage", [mt]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[mt].zone, "graveyard", "land destroyed");
});

Test.test("t25: Samite Healer's guard shield absorbs the next point of damage", () => {
  const [healer, sorc, lions] = idsOf("Samite Healer", "Prodigal Sorcerer", "Savannah Lions");
  const game = freshGame({ inject: [{ cardId: healer, count: 1 }, { cardId: sorc, count: 1 }, { cardId: lions, count: 1, player: 1 }] });
  const h = thePermanent(game, 0, healer);
  const s = thePermanent(game, 0, sorc);
  const l = thePermanent(game, 1, lions);
  activate(game, 0, h, "guard", [l]);
  resolve.resolveTop(game);
  Test.assert(game.raw.effects.some((e) => e.type === "shield" && e.targets.indexOf(l) !== -1), "prevention shield placed on the lion");
  activate(game, 0, s, "zap", [l]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[l].zone, "battlefield", "lion survives the zapped 1 damage");
  Test.assertEqual(game.raw.objects[l].damage, 0, "damage fully prevented");
});

// ── regeneration (src/game/regenerate.js) ─────────────────────────────────────────────
Test.test("t25: Drudge Skeletons' {B} regenerate grants a shield when it resolves", () => {
  const [drudge] = idsOf("Drudge Skeletons");
  const game = freshGame({ inject: [{ cardId: drudge, count: 1 }], mana: { B: 1 } });
  const d = thePermanent(game, 0, drudge);
  Test.assertEqual(regenerate.shields(game, d), 0, "no shield before");
  activate(game, 0, d, "regenerate");
  Test.assertEqual(game.raw.players[0].manaPool.B, 0, "the {B} was paid at activation");
  Test.assertEqual(regenerate.shields(game, d), 0, "no shield while the ability is on the stack");
  resolve.resolveTop(game);
  Test.assertEqual(regenerate.shields(game, d), 1, "shield granted on resolution");
  Test.assertEqual(regenerate.regenerationLog(game).some((e) => e.action === "shield"), true, "shield logged");
});

Test.test("t25: a lethal zap saves a shielded creature — tapped, damage cleared, shield consumed", () => {
  const [drudge, sorc] = idsOf("Drudge Skeletons", "Prodigal Sorcerer");
  const game = freshGame({ inject: [{ cardId: drudge, count: 1 }, { cardId: sorc, count: 1 }], mana: { B: 1 } });
  const d = thePermanent(game, 0, drudge);
  const s = thePermanent(game, 0, sorc);
  activate(game, 0, d, "regenerate");
  resolve.resolveTop(game);
  Test.assertEqual(regenerate.shields(game, d), 1, "shield up");
  activate(game, 0, s, "zap", [d]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[d].zone, "battlefield", "creature survived the lethal damage");
  Test.assertEqual(game.raw.objects[d].tapped, true, "regenerated creature is tapped");
  Test.assertEqual(game.raw.objects[d].damage, 0, "damage removed");
  Test.assertEqual(regenerate.shields(game, d), 0, "shield consumed");
});

Test.test("t25: without a shield the same lethal zap kills the creature", () => {
  const [drudge, sorc] = idsOf("Drudge Skeletons", "Prodigal Sorcerer");
  const game = freshGame({ inject: [{ cardId: drudge, count: 1 }, { cardId: sorc, count: 1 }] });
  const d = thePermanent(game, 0, drudge);
  const s = thePermanent(game, 0, sorc);
  activate(game, 0, s, "zap", [d]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[d].zone, "graveyard", "1 damage is lethal to the 1/1 drudge");
});

Test.test("t25: a destroy effect saves a shielded creature (Royal Assassin murder)", () => {
  const [drudge, assassin] = idsOf("Drudge Skeletons", "Royal Assassin");
  const game = freshGame({ inject: [{ cardId: drudge, count: 1 }, { cardId: assassin, count: 1 }], mana: { B: 1 } });
  const d = thePermanent(game, 0, drudge);
  const a = thePermanent(game, 0, assassin);
  game.raw.objects[d].tapped = true;
  activate(game, 0, d, "regenerate");
  resolve.resolveTop(game);
  Test.assertEqual(regenerate.shields(game, d), 1, "shield up");
  activate(game, 0, a, "murder", [d]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[d].zone, "battlefield", "destroy was replaced by the shield");
  Test.assertEqual(game.raw.objects[d].tapped, true, "regenerated creature is tapped");
  Test.assertEqual(regenerate.shields(game, d), 0, "shield consumed");
});

Test.test("t25: two regeneration shields save twice, then the third destroy kills", () => {
  const [drudge, assassin] = idsOf("Drudge Skeletons", "Royal Assassin");
  const game = freshGame({ inject: [{ cardId: drudge, count: 1 }, { cardId: assassin, count: 1 }], mana: { B: 2 } });
  const d = thePermanent(game, 0, drudge);
  const a = thePermanent(game, 0, assassin);
  game.raw.objects[d].tapped = true;
  activate(game, 0, d, "regenerate");
  resolve.resolveTop(game);
  activate(game, 0, d, "regenerate");
  resolve.resolveTop(game);
  Test.assertEqual(regenerate.shields(game, d), 2, "two shields stacked");
  for (let n = 0; n < 2; n++) {
    game.raw.objects[a].tapped = false;
    activate(game, 0, a, "murder", [d]);
    resolve.resolveTop(game);
    Test.assertEqual(game.raw.objects[d].zone, "battlefield", "saved on destroy #" + (n + 1));
  }
  Test.assertEqual(regenerate.shields(game, d), 0, "both shields consumed");
  game.raw.objects[a].tapped = false;
  activate(game, 0, a, "murder", [d]);
  resolve.resolveTop(game);
  Test.assertEqual(game.raw.objects[d].zone, "graveyard", "no shields left — the third destroy kills");
});

Test.test("t25: shields expire at end of turn", () => {
  const [drudge] = idsOf("Drudge Skeletons");
  const game = freshGame({ inject: [{ cardId: drudge, count: 1 }], mana: { B: 1 } });
  const d = thePermanent(game, 0, drudge);
  activate(game, 0, d, "regenerate");
  resolve.resolveTop(game);
  Test.assertEqual(regenerate.shields(game, d), 1, "shield up");
  turn.walk(game, { until: (g) => g.raw.turnNumber === 2 && g.raw.step === "upkeep", max: 400 });
  Test.assertEqual(regenerate.shields(game, d), 0, "shield gone at the start of the next turn");
});

Test.test("t25: snapshot/restore preserves regeneration shields", () => {
  const [drudge] = idsOf("Drudge Skeletons");
  const game = freshGame({ inject: [{ cardId: drudge, count: 1 }], mana: { B: 1 } });
  const d = thePermanent(game, 0, drudge);
  activate(game, 0, d, "regenerate");
  resolve.resolveTop(game);
  Test.assertEqual(regenerate.shields(game, d), 1, "setup: shield present");
  const snap = engine.snapshot(game);
  const r = engine.restore(snap);
  const d2 = thePermanent(r, 0, drudge);
  Test.assertEqual(regenerate.shields(r, d2), 1, "shield survives the round-trip");
});
