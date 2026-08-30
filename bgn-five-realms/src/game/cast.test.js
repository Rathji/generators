// Casting pipeline tests (roadmap Phase 5, task 19): timing legality (sorcery vs instant,
// main phase, empty stack, priority), the full pay-tap-cast flow through the plugin
// reducer, mode/target/X handling, clear rejection reasons, and castableFromHand
// enumeration. Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import * as mana from "./mana.js";
import { timingLegality, cardSpeed, castableFromHand, validateCast, castSpell } from "./cast.js";
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
// Any card id is safe now (task 22 injected the full Alpha DB into the engine), so the
// injected ids here are just whatever each test wants on the battlefield.
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

// A game where P0's opening hand is all copies of spellId, walked to P0's precombat_main.
function gameAtMain(spellId, extra = {}) {
  const deck0 = Array(10).fill(spellId);
  const deck1 = Array(10).fill("vast-plains");
  const game = engine.newGame({ seed: 7, decks: [deck0, deck1] });
  turn.initTurnTracker(game);
  for (const inj of extra.inject || []) {
    for (let i = 0; i < inj.count; i++) injectPermanent(game, inj.player, inj.cardId);
  }
  const r = turn.walkToStep(game, "precombat_main");
  return { game, atMain: r.atStep && !r.gameOver };
}

// Find the object id of the first card in player's hand with the given cardId.
function inHand(game, player, cardId) {
  for (const objId of engine.zoneIds(game, "hand", player)) {
    const c = engine.cardInstance(game, objId);
    if (c.card && c.card.id === cardId) return objId;
  }
  return null;
}

// Force-pass until the given player is active in their precombat_main.
function walkToPlayerMain(game, player) {
  let passes = 0;
  while (!game.raw.gameOver && passes < 400) {
    if (game.raw.activePlayer === player && game.raw.step === "precombat_main") break;
    turn.pass(game, game.raw.priorityPlayer);
    passes += 1;
  }
  return { passes, gameOver: !!game.raw.gameOver, atMain: game.raw.activePlayer === player && game.raw.step === "precombat_main" };
}

// ── task 19: speed classification & timing legality ──
Test.test("t19: cardSpeed classifies types correctly", () => {
  Test.assertEqual(cardSpeed(root.fr("card", "sunward-sentinel")), "sorcery", "creature -> sorcery speed");
  Test.assertEqual(cardSpeed(root.fr("card", "verdant-call")), "sorcery", "sorcery -> sorcery speed");
  Test.assertEqual(cardSpeed(root.fr("card", "vow-of-radiance")), "sorcery", "enchantment -> sorcery speed");
  Test.assertEqual(cardSpeed(root.fr("card", "faceted-ember-core")), "sorcery", "artifact -> sorcery speed");
  Test.assertEqual(cardSpeed(root.fr("card", "cinder-bolt")), "instant", "instant -> instant speed");
});

Test.test("t19: instant & sorcery both legal on the caster's own main phase", () => {
  const { game, atMain } = gameAtMain("verdant-surge", { inject: [{ player: 0, cardId: "ancient-forest", count: 2 }] });
  Test.assert(atMain, "reached P0's precombat_main");
  Test.assert(timingLegality(game, 0, inHand(game, 0, "verdant-surge")).ok, "instant legal on own main");
  const g2 = gameAtMain("verdant-call", { inject: [{ player: 0, cardId: "ancient-forest", count: 2 }] });
  Test.assert(g2.atMain);
  Test.assert(timingLegality(g2.game, 0, inHand(g2.game, 0, "verdant-call")).ok, "sorcery legal on own main");
});

Test.test("t19: a sorcery is rejected on the opponent's main phase", () => {
  const { game } = gameAtMain("verdant-call", { inject: [{ player: 0, cardId: "ancient-forest", count: 2 }] });
  const r = walkToPlayerMain(game, 1); // advance to P1's precombat_main
  Test.assert(r.atMain, "at P1's main");
  turn.pass(game, 1); // P1 passes so P0 holds priority
  const obj = inHand(game, 0, "verdant-call");
  Test.assert(obj, "P0 still holds the sorcery");
  const t = timingLegality(game, 0, obj);
  Test.assertEqual(t.ok, false);
  Test.assertEqual(t.reason, "sorcery-speed spell requires being the active player");
});

Test.test("t19: an instant IS legal on the opponent's main phase", () => {
  const { game } = gameAtMain("cinder-bolt", { inject: [{ player: 0, cardId: "volcanic-peak", count: 1 }] });
  const r = walkToPlayerMain(game, 1);
  Test.assert(r.atMain, "at P1's main");
  turn.pass(game, 1);
  const obj = inHand(game, 0, "cinder-bolt");
  const res = castSpell(game, 0, obj, { targets: [1] });
  Test.assert(res.ok, "instant cast during opponent's main: " + (res.reason || ""));
  Test.assertEqual(game.raw.stack.length, 1);
  Test.assertEqual(game.raw.stack[0].target, 1, "targeted the player");
});

Test.test("t19: a sorcery is rejected during combat, an instant is not", () => {
  const { game } = gameAtMain("verdant-call", { inject: [{ player: 0, cardId: "ancient-forest", count: 2 }] });
  turn.walkToStep(game, "declare_attackers");
  Test.assert(game.raw.step === "declare_attackers");
  const t = timingLegality(game, 0, inHand(game, 0, "verdant-call"));
  Test.assertEqual(t.ok, false);
  Test.assertEqual(t.reason, "sorcery-speed spell requires a main phase");

  const g2 = gameAtMain("cinder-bolt", { inject: [{ player: 0, cardId: "volcanic-peak", count: 1 }] });
  turn.walkToStep(g2.game, "declare_attackers");
  Test.assert(g2.game.raw.step === "declare_attackers");
  Test.assert(timingLegality(g2.game, 0, inHand(g2.game, 0, "cinder-bolt")).ok, "instant legal in combat");
});

Test.test("t19: a sorcery is rejected while the stack is non-empty", () => {
  const mixed = ["cinder-bolt", "verdant-call", "cinder-bolt", "verdant-call", "cinder-bolt", "verdant-call", "cinder-bolt", "verdant-call", "cinder-bolt", "verdant-call"];
  const game = engine.newGame({ seed: 7, decks: [mixed, Array(10).fill("vast-plains")] });
  turn.initTurnTracker(game);
  injectPermanent(game, 0, "volcanic-peak");
  turn.walkToStep(game, "precombat_main");
  const inst = inHand(game, 0, "cinder-bolt");
  const sorc = inHand(game, 0, "verdant-call");
  Test.assert(inst && sorc, "both the instant and the sorcery in hand");
  const r = castSpell(game, 0, inst, { targets: [1] });
  Test.assert(r.ok, "instant on the stack");
  Test.assertEqual(game.raw.stack.length, 1);
  const t = timingLegality(game, 0, sorc);
  Test.assertEqual(t.ok, false);
  Test.assertEqual(t.reason, "sorcery-speed spell requires an empty stack");
});

Test.test("t19: timingLegality rejects lands and no-priority casts", () => {
  const { game } = gameAtMain("vast-plains");
  const landObj = inHand(game, 0, "vast-plains");
  const t = timingLegality(game, 0, landObj);
  Test.assertEqual(t.ok, false);
  Test.assertEqual(t.reason, "lands are played, not cast");
  const np = timingLegality(game, 1, landObj);
  Test.assertEqual(np.ok, false);
  Test.assertEqual(np.reason, "player does not have priority");
});

// ── task 19: full cast pipeline ──
Test.test("t19: cast a creature end-to-end — tap source, spell on stack, pool spent", () => {
  const { game } = gameAtMain("sunward-sentinel", { inject: [{ player: 0, cardId: "vast-plains", count: 2 }] });
  const obj = inHand(game, 0, "sunward-sentinel");
  Test.assert(obj, "creature in hand");
  const r = castSpell(game, 0, obj);
  Test.assert(r.ok, "cast succeeded: " + (r.reason || ""));
  Test.assertEqual(game.raw.stack.length, 1);
  Test.assertEqual(game.raw.stack[0].kind, "spell");
  Test.assertEqual(game.raw.stack[0].objId, obj);
  Test.assert(!engine.zoneIds(game, "hand", 0).includes(obj), "spell left the hand");
  Test.assertEqual(game.raw.objects[obj].zone, "stack");
  const tapped = Object.values(game.raw.objects).filter((o) => o.cardId === "vast-plains" && o.tapped).length;
  Test.assertEqual(tapped, 2, "both plains tapped for {1}{W}");
  Test.assertEqual(engine.manaPool(game, 0), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, "reducer spent the pool");
  const announce = game.history.filter((h) => h.action === "announceCast");
  Test.assertEqual(announce.length, 1, "the cast was announced");
  Test.assertEqual(announce[0].name, "Sunward Sentinel");
});

Test.test("t19: an instant with a creature target records the target on the stack", () => {
  const { game } = gameAtMain("verdant-surge", {
    inject: [
      { player: 0, cardId: "ancient-forest", count: 2 },
      { player: 0, cardId: "sunward-sentinel", count: 1 },
    ],
  });
  const creature = Object.values(game.raw.objects).find((o) => o.cardId === "sunward-sentinel" && o.zone === "battlefield");
  Test.assert(creature, "a creature to target");
  const r = castSpell(game, 0, inHand(game, 0, "verdant-surge"), { targets: [creature.id] });
  Test.assert(r.ok, "cast: " + (r.reason || ""));
  Test.assertEqual(game.raw.stack[0].targets, [creature.id]);
});

Test.test("t19: a target-less instant casts cleanly", () => {
  const { game } = gameAtMain("tidefall-rebuke", { inject: [{ player: 0, cardId: "deep-ocean", count: 1 }] });
  const r = castSpell(game, 0, inHand(game, 0, "tidefall-rebuke"));
  Test.assert(r.ok, "cast: " + (r.reason || ""));
  Test.assertEqual(game.raw.stack.length, 1);
  Test.assertEqual((game.raw.stack[0].targets || []).length, 0, "no targets needed");
});

Test.test("t19: an illegal target is rejected with a clear reason before anything taps", () => {
  const { game } = gameAtMain("verdant-surge", {
    inject: [
      { player: 0, cardId: "ancient-forest", count: 2 },
      { player: 0, cardId: "vast-plains", count: 1 },
    ],
  });
  const plains = Object.values(game.raw.objects).find((o) => o.cardId === "vast-plains" && o.zone === "battlefield");
  const before = Object.values(game.raw.objects).filter((o) => o.zone === "battlefield" && o.tapped).length;
  const r = castSpell(game, 0, inHand(game, 0, "verdant-surge"), { targets: [plains.id] });
  Test.assertEqual(r.ok, false, "a land is not a creature target");
  Test.assert(r.reason, "reason provided: " + r.reason);
  Test.assertEqual(game.raw.stack.length, 0, "nothing on the stack");
  Test.assertEqual(Object.values(game.raw.objects).filter((o) => o.zone === "battlefield" && o.tapped).length, before, "no source was tapped");
  Test.assertEqual(engine.manaPool(game, 0), { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, "nothing spent");
});

Test.test("t19: a spell with a target can't be cast without one", () => {
  const { game } = gameAtMain("verdant-surge", { inject: [{ player: 0, cardId: "ancient-forest", count: 2 }] });
  const r = castSpell(game, 0, inHand(game, 0, "verdant-surge"));
  Test.assertEqual(r.ok, false);
  Test.assert(r.reason.indexOf("target") !== -1, "reason mentions targets: " + r.reason);
});

Test.test("t19: an unpayable cost is rejected with a clear reason, nothing tapped", () => {
  const { game } = gameAtMain("sunward-sentinel"); // no W source, empty pool
  const r = castSpell(game, 0, inHand(game, 0, "sunward-sentinel"));
  Test.assertEqual(r.ok, false);
  Test.assert(r.reason.indexOf("cannot pay") !== -1, "reason: " + r.reason);
  Test.assertEqual(game.raw.stack.length, 0);
});

Test.test("t19: casting without priority is rejected", () => {
  const { game } = gameAtMain("sunward-sentinel", { inject: [{ player: 0, cardId: "vast-plains", count: 2 }] });
  const obj = inHand(game, 0, "sunward-sentinel");
  const r = castSpell(game, 1, obj);
  Test.assertEqual(r.ok, false);
  Test.assertEqual(r.reason, "player does not have priority");
});

// ── task 19: X costs ──
Test.test("t19: an X instant casts at a chosen X and records it on the stack", () => {
  const { game } = gameAtMain("solara-benediction", { inject: [{ player: 0, cardId: "halo-reliquary", count: 1 }] });
  mana.addMana(game, 0, "C", 2, "test");
  const r = castSpell(game, 0, inHand(game, 0, "solara-benediction"), { x: 2 });
  Test.assert(r.ok, "cast: " + (r.reason || ""));
  Test.assertEqual(r.x, 2);
  Test.assertEqual(game.raw.stack[0].x, 2, "X recorded on the stack entry");
  Test.assertEqual(engine.manaPool(game, 0).C, 0, "X mana spent");
  Test.assertEqual(game.raw.objects[Object.values(game.raw.objects).find((o) => o.cardId === "halo-reliquary" && o.zone === "battlefield").id].tapped, true);
});

Test.test("t19: an X instant casts at max X", () => {
  const { game } = gameAtMain("solara-benediction", { inject: [{ player: 0, cardId: "halo-reliquary", count: 1 }] });
  mana.addMana(game, 0, "C", 2, "test");
  const r = castSpell(game, 0, inHand(game, 0, "solara-benediction"), { x: "max" });
  Test.assert(r.ok, "cast: " + (r.reason || ""));
  Test.assertEqual(r.x, 2, "max X spends the 2 floating C");
});

Test.test("t19: an X spell at X=0 is a legal free cast", () => {
  const { game } = gameAtMain("solara-benediction", { inject: [{ player: 0, cardId: "halo-reliquary", count: 1 }] });
  const r = castSpell(game, 0, inHand(game, 0, "solara-benediction"), { x: 0 });
  Test.assert(r.ok, "X=0 cast: " + (r.reason || ""));
  Test.assertEqual(game.raw.stack[0].x, 0);
});

// ── task 19: modal spells ──
Test.test("t19: a modal spell casts with a chosen mode", () => {
  const { game } = gameAtMain("ember-reckoning", { inject: [{ player: 0, cardId: "volcanic-peak", count: 2 }] });
  const r = castSpell(game, 0, inHand(game, 0, "ember-reckoning"), { mode: "player", targets: [1] });
  Test.assert(r.ok, "cast: " + (r.reason || ""));
  Test.assertEqual(game.raw.stack[0].mode, "player");
  Test.assertEqual(game.raw.stack[0].target, 1);
});

Test.test("t19: an invalid mode is rejected", () => {
  const { game } = gameAtMain("ember-reckoning", { inject: [{ player: 0, cardId: "volcanic-peak", count: 2 }] });
  const r = castSpell(game, 0, inHand(game, 0, "ember-reckoning"), { mode: "bogus", targets: [1] });
  Test.assertEqual(r.ok, false);
  Test.assert(r.reason.indexOf("mode") !== -1, "reason mentions mode: " + r.reason);
  Test.assertEqual(game.raw.stack.length, 0);
});

// ── task 19: two-target spell (twin-dart) ──
Test.test("t19: a two-target instant requires two distinct creatures", () => {
  const { game } = gameAtMain("twin-dart", {
    inject: [
      { player: 0, cardId: "volcanic-peak", count: 2 },
      { player: 0, cardId: "sunward-sentinel", count: 2 },
    ],
  });
  const creatures = Object.values(game.raw.objects).filter((o) => o.cardId === "sunward-sentinel" && o.zone === "battlefield");
  Test.assertEqual(creatures.length, 2);
  const r = castSpell(game, 0, inHand(game, 0, "twin-dart"), { targets: creatures.map((c) => c.id) });
  Test.assert(r.ok, "two distinct targets: " + (r.reason || ""));
  Test.assertEqual(game.raw.stack[0].targets.length, 2);

  const { game: g2 } = gameAtMain("twin-dart", {
    inject: [
      { player: 0, cardId: "volcanic-peak", count: 2 },
      { player: 0, cardId: "sunward-sentinel", count: 1 },
    ],
  });
  const one = Object.values(g2.raw.objects).find((o) => o.cardId === "sunward-sentinel" && o.zone === "battlefield");
  const r2 = castSpell(g2, 0, inHand(g2, 0, "twin-dart"), { targets: [one.id, one.id] });
  Test.assertEqual(r2.ok, false, "same target twice is not distinct");
});

// ── task 19: castableFromHand ──
Test.test("t19: castableFromHand lists affordable, timing-legal casts with reasons", () => {
  const { game } = gameAtMain("verdant-call", { inject: [{ player: 0, cardId: "ancient-forest", count: 1 }] });
  let list = castableFromHand(game, 0);
  Test.assertEqual(list.length, 7, "all seven hand cards enumerated");
  Test.assert(list.every((e) => e.timing.ok), "sorcery is timing-legal on own main");
  Test.assert(list.every((e) => !e.canPay), "one forest can't pay {2}{G}");
  Test.assertEqual(list[0].timing.reason, undefined, "no timing reason when legal");
  Test.assertEqual(list[0].maxX, null, "no X in the cost");

  injectPermanent(game, 0, "ancient-forest");
  list = castableFromHand(game, 0);
  Test.assert(list.every((e) => !e.canPay), "two forests still can't pay {2}{G} (cmc 3)");
  injectPermanent(game, 0, "ancient-forest");
  list = castableFromHand(game, 0);
  Test.assert(list.every((e) => e.canPay), "three forests pay {2}{G}");
});

Test.test("t19: castableFromHand reflects timing on the opponent's main", () => {
  const { game } = gameAtMain("verdant-call", { inject: [{ player: 0, cardId: "ancient-forest", count: 2 }] });
  turn.walkTurn(game, 1);
  turn.pass(game, 1);
  const list = castableFromHand(game, 0);
  Test.assertEqual(list.length, 7);
  Test.assert(list.every((e) => !e.timing.ok), "sorcery not timing-legal on opponent's main");
  Test.assertEqual(list[0].timing.reason, "sorcery-speed spell requires being the active player");
  Test.assert(list.every((e) => !e.canPay), "canPay stays false when timing is illegal");
});

Test.test("t19: castableFromHand computes maxX for an X-cost instant", () => {
  const { game } = gameAtMain("solara-benediction", { inject: [{ player: 0, cardId: "halo-reliquary", count: 1 }] });
  mana.addMana(game, 0, "C", 2, "test");
  const list = castableFromHand(game, 0);
  Test.assertEqual(list[0].card.id, "solara-benediction");
  Test.assertEqual(list[0].canPay, true);
  Test.assertEqual(list[0].maxX, 2, "max X from 2 floating C plus W source");
});

Test.test("t19: validateCast gives the reducer's exact rejection reason", () => {
  const { game } = gameAtMain("verdant-surge", { inject: [{ player: 0, cardId: "ancient-forest", count: 2 }] });
  const obj = inHand(game, 0, "verdant-surge");
  const v = validateCast(game, 0, obj, { targets: [] });
  Test.assertEqual(v.ok, false);
  Test.assertEqual(v.reason, "requires at least 1 target");
  const v2 = validateCast(game, 0, obj, { targets: ["nope"] });
  Test.assertEqual(v2.ok, false);
  Test.assertEqual(v2.reason, "invalid target #1");
  const v3 = validateCast(game, 0, obj);
  Test.assertEqual(v3.reason, "requires at least 1 target");
});
