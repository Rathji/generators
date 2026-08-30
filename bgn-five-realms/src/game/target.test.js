// Target selection tests (roadmap Phase 6, task 21): every Alpha spell/Aura/ability that
// targets declares its target requirements (type, count, distinctness, legality); the
// query in src/game/target.js returns all legal targets and rejects illegal ones (wrong
// zone/type/subtype/color, hexproof, protected cards, wrong count, non-distinct) across a
// representative set of real Alpha cards — plus a reducer tie-in confirming the local
// query agrees with the plugin's authoritative cast-time validation.
// Register, then run: window.Test.run()
import * as engine from "./engine.js";
import * as turn from "./turn.js";
import { castSpell } from "./cast.js";
import {
  targetingForId, abilityTargetingFor, cardDefFor,
  slotTargetLegal, legalTargetsForSlot, targetSetLegal, legalTargetSets,
  sourceColorsFor, targetName,
} from "./target.js";
import { ALPHA_TO_PLUGIN, PLUGIN_CARD_MAP } from "../cards/plugin.js";
import { ALPHA_CARDS } from "../cards/data/alpha.js";
import { describeTargeting } from "../cards/targeting.js";

// ── helpers ───────────────────────────────────────────────────────────────────────────
function freshGame() {
  const deck = Array(30).fill("vast-plains");
  return engine.newGame({ seed: 7, decks: [deck.slice(), deck.slice()] });
}

// Inject a card object into any zone (Alpha or plugin-fixture ids). Returns the object id.
function injectObject(game, player, cardId, zone = "battlefield", extra = {}) {
  const id = "obj" + game.raw.nextObjectId++;
  game.raw.objects[id] = Object.assign({
    id, cardId, owner: player, controller: player, zone,
    tapped: false, summoningSickness: false, counters: {}, attachments: [],
    buffsUntilEot: { power: 0, toughness: 0 }, attachedTo: null, damage: 0,
    attacking: false, blocking: null,
  }, extra);
  if (zone === "battlefield") game.raw.battlefield.push(id);
  else if (zone === "stack") game.raw.stack.push({ kind: "spell", objId: id, player });
  else if (zone === "graveyard") game.raw.players[player].graveyard.push(id);
  else if (zone === "hand") game.raw.players[player].hand.push(id);
  return id;
}

// ids() for a list of card names straight from the projection.
function idsOf(...names) {
  return names.map((n) => {
    const rec = ALPHA_TO_PLUGIN.find((c) => c.name === n);
    Test.assert(rec, "projection has " + n);
    return rec.id;
  });
}

// Names an object id resolves to (for readable assertions).
function nameOf(game, id) {
  return targetName(game, id);
}

// ── group A: declarations for real Alpha cards ────────────────────────────────────────
Test.test("t21: representative spell targeting declarations", () => {
  const g = freshGame();
  const spec = (id, mode) => targetingForId(g, id, mode);

  let t = spec("lightning-bolt");
  Test.assertEqual(t.min, 1); Test.assertEqual(t.max, 1);
  Test.assertEqual(t.slots[0].player, true, "any target includes players");
  Test.assertEqual(t.slots[0].types, ["Creature"], "any target includes creatures");

  t = spec("counterspell");
  Test.assertEqual(t.slots[0].spell, true, "counterspell targets a spell");

  t = spec("terror");
  Test.assertEqual(t.slots[0].types, ["Creature"]);
  Test.assertEqual(t.slots[0].notTypes, ["Artifact"], "nonartifact");
  Test.assertEqual(t.slots[0].notColors, ["B"], "nonblack");

  t = spec("giant-growth");
  Test.assertEqual(t.slots[0].types, ["Creature"]);

  t = spec("disenchant");
  Test.assertEqual(t.slots[0].types, ["Artifact", "Enchantment"]);

  t = spec("shatter");
  Test.assertEqual(t.slots[0].types, ["Artifact"]);

  t = spec("sinkhole");
  Test.assertEqual(t.slots[0].types, ["Land"]);

  t = spec("ancestral-recall");
  Test.assertEqual(t.slots[0].player, true);
  Test.assert(!t.slots[0].types, "a player-only slot has no type filter");

  t = spec("unsummon");
  Test.assertEqual(t.slots[0].types, ["Creature"]);

  t = spec("swords-to-plowshares");
  Test.assertEqual(t.slots[0].types, ["Creature"]);

  t = spec("fireball");
  Test.assertEqual(t.min, 1);
  Test.assertEqual(t.max, "X", "any number of targets, capped by X");
  Test.assertEqual(t.slots[0].player, true);
  Test.assertEqual(t.slots[0].types, ["Creature"]);

  t = spec("twiddle");
  Test.assertEqual(t.slots[0].types, ["Artifact", "Creature", "Land"]);

  t = spec("raise-dead");
  Test.assertEqual(t.slots[0].zone, "graveyard");
  Test.assertEqual(t.slots[0].types, ["Creature"]);
  Test.assertEqual(t.slots[0].owner, "self", "your graveyard only");

  t = spec("regrowth");
  Test.assertEqual(t.slots[0].zone, "graveyard");
  Test.assertEqual(t.slots[0].owner, "self");

  t = spec("volcanic-eruption");
  Test.assertEqual(t.min, 1);
  Test.assertEqual(t.max, "X");
  Test.assertEqual(t.slots[0].types, ["Land"]);
  Test.assertEqual(t.slots[0].subtypes, ["Mountain"], "targets Mountains");

  t = spec("word-of-command");
  Test.assertEqual(t.slots[0].player, true);
  Test.assertEqual(t.slots[0].opponent, true, "target opponent only");
});

Test.test("t21: modal cards declare per-mode targeting, none at card level", () => {
  const g = freshGame();
  Test.assertEqual(targetingForId(g, "blue-elemental-blast"), null, "modal card needs a mode");
  const counter = targetingForId(g, "blue-elemental-blast", "counter");
  Test.assertEqual(counter.slots[0].spell, true);
  Test.assertEqual(counter.slots[0].spellColors, ["R"], "counter target red spell");
  const destroy = targetingForId(g, "blue-elemental-blast", "destroy");
  Test.assertEqual(destroy.slots[0].permanent, true);
  Test.assertEqual(destroy.slots[0].colors, ["R"], "destroy target red permanent");
  Test.assertEqual(targetingForId(g, "red-elemental-blast", "counter").slots[0].spellColors, ["U"]);
  Test.assertEqual(targetingForId(g, "red-elemental-blast", "destroy").slots[0].colors, ["U"]);
  Test.assertEqual(targetingForId(g, "healing-salve", "life-gain").slots[0].player, true);
  Test.assertEqual(targetingForId(g, "healing-salve", "damage-prevention").slots[0].types, ["Creature"]);
});

Test.test("t21: fork targets only instant/sorcery spells", () => {
  const g = freshGame();
  const t = targetingForId(g, "fork");
  Test.assertEqual(t.slots[0].spell, true);
  Test.assertEqual(t.slots[0].spellTypes, ["Instant", "Sorcery"]);
});

Test.test("t21: activated-ability targeting is declared", () => {
  const g = freshGame();
  const check = (id, ability, expect) => {
    const t = abilityTargetingFor(g, id, ability);
    Test.assert(t, id + "." + ability + " has targeting");
    Test.assertEqual(t.slots[0], expect);
  };
  check("prodigal-sorcerer", "zap", { player: true, types: ["Creature"] });
  check("samite-healer", "guard", { player: true, types: ["Creature"] });
  check("rod-of-ruin", "zap", { player: true, types: ["Creature"] });
  check("royal-assassin", "murder", { types: ["Creature"], tapped: true });
  check("ley-druid", "untap", { types: ["Land"] });
  check("demonic-hordes", "ravage", { types: ["Land"] });
  check("icy-manipulator", "freeze", { types: ["Artifact", "Creature", "Land"] });
  check("dwarven-demolition-team", "demolish", { types: ["Creature"], subtypes: ["Wall"] });
  check("dwarven-warriors", "harry", { types: ["Creature"], powerLE: 2 });
  check("nettling-imp", "taunt", { types: ["Creature"], notSubtypes: ["Wall"] });
  check("northern-paladin", "smite", { permanent: true, colors: ["B"] });
  check("deathgrip", "counter-green", { spell: true, spellColors: ["G"] });
  check("lifeforce", "counter-black", { spell: true, spellColors: ["B"] });
  check("cyclopean-tomb", "mire", { types: ["Land"], notSubtypes: ["Swamp"] });
  check("stone-giant", "hurl", { types: ["Creature"], owner: "self" });
  Test.assertEqual(abilityTargetingFor(g, "simulacrum", "hurl"), null, "simulacrum has no abilities here");
});

Test.test("t21: innate protection is declared (target-legality gate)", () => {
  const wk = PLUGIN_CARD_MAP["white-knight"];
  const bk = PLUGIN_CARD_MAP["black-knight"];
  Test.assert(wk && wk.protections, "White Knight declared");
  Test.assertEqual(wk.protections, ["B"], "White Knight: protection from black");
  Test.assertEqual(bk.protections, ["W"], "Black Knight: protection from white");
  Test.assert(!PLUGIN_CARD_MAP["serra-angel"].protections, "no innate protection elsewhere");
});

Test.test("t21: every Alpha card that targets declares its requirements (completeness sweep)", () => {
  // Allowlist: cards whose text mentions "target"/"Enchant " but which never target —
  // White/Black Knight (their protection text mentions being "targeted") and Darkpact
  // (ante-zone targeting, out of scope).
  const exempt = new Set(["White Knight", "Black Knight", "Darkpact"]);
  const declared = [];
  const missed = [];
  for (const a of ALPHA_CARDS) {
    const rt = a.rulesText || "";
    const mentionsTarget = /\btarget\b/i.test(rt) || /^\s*Enchant\b/i.test(rt);
    if (!mentionsTarget) continue;
    if (exempt.has(a.name)) continue;
    const proj = ALPHA_TO_PLUGIN.find((c) => c.name === a.name);
    const has = proj && (proj.targeting || (Array.isArray(proj.modes) && proj.modes.length) ||
      (Array.isArray(proj.abilityTargeting) && proj.abilityTargeting.length));
    if (has) declared.push(a.name);
    else missed.push(a.name);
  }
  Test.assertEqual(missed, [], "every targeting card declares requirements");
  Test.assert(declared.length >= 80, "a large representative set is declared: " + declared.length);
});

Test.test("t21: describeTargeting reads naturally", () => {
  const g = freshGame();
  Test.assertEqual(describeTargeting(targetingForId(g, "lightning-bolt")), "target creature or player");
  Test.assertEqual(describeTargeting(targetingForId(g, "counterspell")), "target spell");
  Test.assertEqual(describeTargeting(targetingForId(g, "giant-growth")), "target creature");
  Test.assertEqual(describeTargeting(targetingForId(g, "ancestral-recall")), "target player");
  Test.assertEqual(describeTargeting(targetingForId(g, "fireball"), { x: 3 }), "up to 3 targets");
  Test.assertEqual(describeTargeting(targetingForId(g, "terror")), "target nonblack, nonartifact creature");
});

// ── group B: the query returns legal targets and rejects illegal ones ─────────────────
Test.test("t21: any-target spells hit players and creatures, never non-creature permanents", () => {
  const g = freshGame();
  const bolt = idsOf("Lightning Bolt")[0];
  const angel = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const enchant = injectObject(g, 0, idsOf("Holy Strength")[0]);
  const land = injectObject(g, 0, "plains");
  const artifact = injectObject(g, 0, "mox-pearl");
  const slot = targetingForId(g, bolt).slots[0];

  const legal = legalTargetsForSlot(g, slot, 0, { sourceColors: sourceColorsFor(g, bolt) });
  Test.assertEqual(legal.includes(0), true, "can target player 0 (self)");
  Test.assertEqual(legal.includes(1), true, "can target player 1");
  Test.assertEqual(legal.includes(angel), true, "can target a creature");
  Test.assertEqual(legal.includes(enchant), false, "can't target an enchantment");
  Test.assertEqual(legal.includes(land), false, "can't target a land");
  Test.assertEqual(legal.includes(artifact), false, "can't target an artifact");

  const v = targetSetLegal(g, targetingForId(g, bolt), [enchant], 0, { sourceColors: sourceColorsFor(g, bolt) });
  Test.assertEqual(v.ok, false);
  Test.assert(/enchant|type/i.test(v.reason), "reason names the problem: " + v.reason);
  Test.assertEqual(targetSetLegal(g, targetingForId(g, bolt), [angel], 0, { sourceColors: sourceColorsFor(g, bolt) }).ok, true);
});

Test.test("t21: creature-only spells reject enchantments, non-creatures and protected cards", () => {
  const g = freshGame();
  const growth = idsOf("Giant Growth")[0];
  const swords = idsOf("Swords to Plowshares")[0];
  const angel = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const enchant = injectObject(g, 0, idsOf("Holy Strength")[0]);
  const land = injectObject(g, 0, "plains");
  const blackKnight = injectObject(g, 1, idsOf("Black Knight")[0]);

  const growthSlot = targetingForId(g, growth).slots[0];
  Test.assertEqual(targetSetLegal(g, targetingForId(g, growth), [enchant], 0, { sourceColors: ["G"] }).ok, false, "can't target an enchantment");
  Test.assertEqual(targetSetLegal(g, targetingForId(g, growth), [land], 0, { sourceColors: ["G"] }).ok, false, "can't target a land");
  Test.assertEqual(targetSetLegal(g, targetingForId(g, growth), [angel], 0, { sourceColors: ["G"] }).ok, true);

  // Protection: a white spell can't target Black Knight (protection from white).
  const v = targetSetLegal(g, targetingForId(g, swords), [blackKnight], 0, { sourceColors: ["W"] });
  Test.assertEqual(v.ok, false, "protection blocks the target");
  Test.assert(/protection/i.test(v.reason), "reason names protection: " + v.reason);
  // The same board, but Terror (black) CAN target Black Knight's controller's other stuff — no, black-knight is protected from WHITE only, so a green spell targets it fine.
  Test.assertEqual(targetSetLegal(g, targetingForId(g, growth), [blackKnight], 0, { sourceColors: ["G"] }).ok, true, "no protection vs green");
});

Test.test("t21: Terror rejects black/artifact creatures and White Knight (protection)", () => {
  const g = freshGame();
  const terror = idsOf("Terror")[0];
  const angel = injectObject(g, 0, idsOf("Serra Angel")[0]);      // white, legal
  const zombie = injectObject(g, 0, idsOf("Scathe Zombies")[0]);  // black, illegal
  const juggernaut = injectObject(g, 0, "juggernaut");            // artifact creature, illegal
  const whiteKnight = injectObject(g, 0, idsOf("White Knight")[0]); // prot black, illegal
  const enchant = injectObject(g, 0, idsOf("Holy Strength")[0]);  // not a creature
  const t = targetingForId(g, terror);
  const src = { sourceColors: ["B"] };

  const legal = legalTargetsForSlot(g, t.slots[0], 0, src);
  Test.assertEqual(legal.includes(angel), true);
  Test.assertEqual(legal.includes(zombie), false, "nonblack: black creature rejected");
  Test.assertEqual(legal.includes(juggernaut), false, "nonartifact: artifact creature rejected");
  Test.assertEqual(legal.includes(whiteKnight), false, "protection from black rejects Terror");
  Test.assertEqual(legal.includes(enchant), false, "enchantment is not a creature");

  Test.assertEqual(targetSetLegal(g, t, [zombie], 0, src).ok, false);
  Test.assertEqual(targetSetLegal(g, t, [juggernaut], 0, src).ok, false);
  Test.assertEqual(targetSetLegal(g, t, [whiteKnight], 0, src).ok, false);
  Test.assertEqual(targetSetLegal(g, t, [angel], 0, src).ok, true);
});

Test.test("t21: hexproof blocks opponent targeting, not your own", () => {
  const g = freshGame();
  const growth = idsOf("Giant Growth")[0];
  const mine = injectObject(g, 0, idsOf("Savannah Lions")[0], "battlefield", { keywords: ["hexproof"] });
  const theirs = injectObject(g, 1, idsOf("Savannah Lions")[0], "battlefield", { keywords: ["hexproof"] });
  const t = targetingForId(g, growth);
  const src = { sourceColors: ["G"] };

  const legal = legalTargetsForSlot(g, t.slots[0], 0, src);
  Test.assertEqual(legal.includes(mine), true, "your own hexproof creature is targetable");
  Test.assertEqual(legal.includes(theirs), false, "an opponent's hexproof creature is not");

  const v = targetSetLegal(g, t, [theirs], 0, src);
  Test.assertEqual(v.ok, false);
  Test.assert(/hexproof/i.test(v.reason), "reason names hexproof: " + v.reason);
  Test.assertEqual(targetSetLegal(g, t, [mine], 0, src).ok, true);
});

Test.test("t21: spells-on-the-stack targeting (Counterspell) rejects non-spells", () => {
  const g = freshGame();
  const counterspell = idsOf("Counterspell")[0];
  const boltSpell = injectObject(g, 0, idsOf("Lightning Bolt")[0], "stack");
  const growthSpell = injectObject(g, 1, idsOf("Giant Growth")[0], "stack");
  const angel = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const t = targetingForId(g, counterspell);

  const legal = legalTargetsForSlot(g, t.slots[0], 0, {});
  Test.assertEqual(legal.includes(boltSpell), true, "a spell on the stack is legal");
  Test.assertEqual(legal.includes(growthSpell), true, "any player's spell on the stack");
  Test.assertEqual(legal.includes(angel), false, "a permanent is not a spell target");
  Test.assertEqual(legal.includes(0), false, "a player is not a spell target");

  const v = targetSetLegal(g, t, [angel], 0, {});
  Test.assertEqual(v.ok, false);
  Test.assert(/stack/i.test(v.reason), "reason names the stack: " + v.reason);
  Test.assertEqual(targetSetLegal(g, t, [boltSpell], 0, {}).ok, true);
});

Test.test("t21: color-filtered spell targets (Deathgrip vs green, Fork vs instant/sorcery)", () => {
  const g = freshGame();
  const dg = idsOf("Deathgrip")[0];
  const greenSpell = injectObject(g, 0, idsOf("Giant Growth")[0], "stack");
  const blackSpell = injectObject(g, 1, idsOf("Terror")[0], "stack");
  const dgT = abilityTargetingFor(g, dg, "counter-green");

  const legal = legalTargetsForSlot(g, dgT.slots[0], 0, {});
  Test.assertEqual(legal.includes(greenSpell), true, "green spell is legal");
  Test.assertEqual(legal.includes(blackSpell), false, "black spell is not");
  Test.assertEqual(targetSetLegal(g, dgT, [blackSpell], 0, {}).ok, false);
  Test.assertEqual(targetSetLegal(g, dgT, [greenSpell], 0, {}).ok, true);

  const fork = idsOf("Fork")[0];
  const instantSpell = injectObject(g, 0, idsOf("Lightning Bolt")[0], "stack");
  const sorcerySpell = injectObject(g, 0, idsOf("Fireball")[0], "stack");
  const creatureSpell = injectObject(g, 0, idsOf("Serra Angel")[0], "stack");
  const forkT = targetingForId(g, fork);
  const fLegal = legalTargetsForSlot(g, forkT.slots[0], 0, {});
  Test.assertEqual(fLegal.includes(instantSpell), true, "instant spell");
  Test.assertEqual(fLegal.includes(sorcerySpell), true, "sorcery spell");
  Test.assertEqual(fLegal.includes(creatureSpell), false, "a creature spell is not instant/sorcery");
  Test.assertEqual(targetSetLegal(g, forkT, [creatureSpell], 0, {}).ok, false);
});

Test.test("t21: land targeting rejects non-lands; Volcanic Eruption needs Mountains", () => {
  const g = freshGame();
  const sinkhole = idsOf("Sinkhole")[0];
  const mountain = injectObject(g, 0, "mountain");
  const island = injectObject(g, 0, "island");
  const angel = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const t = targetingForId(g, sinkhole);

  const legal = legalTargetsForSlot(g, t.slots[0], 0, {});
  Test.assertEqual(legal.includes(mountain), true);
  Test.assertEqual(legal.includes(island), true);
  Test.assertEqual(legal.includes(angel), false, "a creature is not a land");
  Test.assertEqual(targetSetLegal(g, t, [angel], 0, {}).ok, false);

  // Volcanic Eruption: X target Mountains — Mountain-subtype lands only.
  const er = idsOf("Volcanic Eruption")[0];
  const taiga = injectObject(g, 0, "taiga");       // Mountain Forest
  const plateau = injectObject(g, 0, "plateau");   // Mountain Plains
  const tundra = injectObject(g, 0, "tundra");     // Plains Island — not a Mountain
  const erT = targetingForId(g, er);
  const erLegal = legalTargetsForSlot(g, erT.slots[0], 0, { x: 3 });
  Test.assertEqual(erLegal.includes(mountain), true);
  Test.assertEqual(erLegal.includes(taiga), true, "dual with Mountain subtype");
  Test.assertEqual(erLegal.includes(plateau), true);
  Test.assertEqual(erLegal.includes(island), false);
  Test.assertEqual(erLegal.includes(tundra), false, "non-Mountain land is illegal");
  Test.assertEqual(erLegal.includes(angel), false);

  Test.assertEqual(targetSetLegal(g, erT, [mountain, island], 0, { x: 3 }).ok, false, "island isn't a Mountain");
  Test.assertEqual(targetSetLegal(g, erT, [mountain, taiga, plateau], 0, { x: 3 }).ok, true);
  Test.assertEqual(targetSetLegal(g, erT, [mountain, taiga, plateau, island], 0, { x: 3 }).ok, false, "4 targets > X=3");
});

Test.test("t21: target-player spells hit players only; Word of Command opponents only", () => {
  const g = freshGame();
  const recall = idsOf("Ancestral Recall")[0];
  const angel = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const t = targetingForId(g, recall);
  const legal = legalTargetsForSlot(g, t.slots[0], 0, {});
  Test.assertEqual(legal, [0, 1], "both players");
  Test.assertEqual(targetSetLegal(g, t, [angel], 0, {}).ok, false);
  Test.assertEqual(targetSetLegal(g, t, [0], 0, {}).ok, true);

  const woc = idsOf("Word of Command")[0];
  const wocT = targetingForId(g, woc);
  const wocLegal = legalTargetsForSlot(g, wocT.slots[0], 0, {});
  Test.assertEqual(wocLegal, [1], "only the opponent");
  Test.assertEqual(targetSetLegal(g, wocT, [0], 0, {}).ok, false, "can't target yourself");
  Test.assertEqual(targetSetLegal(g, wocT, [1], 0, {}).ok, true);
});

Test.test("t21: Disenchant/Twiddle take the right permanent types", () => {
  const g = freshGame();
  const disenchant = idsOf("Disenchant")[0];
  const artifact = injectObject(g, 0, "mox-pearl");
  const enchant = injectObject(g, 0, idsOf("Holy Strength")[0]);
  const creature = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const land = injectObject(g, 0, "plains");

  const d = targetingForId(g, disenchant);
  const dLegal = legalTargetsForSlot(g, d.slots[0], 0, {});
  Test.assertEqual(dLegal.includes(artifact), true);
  Test.assertEqual(dLegal.includes(enchant), true);
  Test.assertEqual(dLegal.includes(creature), false, "a creature is neither artifact nor enchantment");
  Test.assertEqual(dLegal.includes(land), false);

  const twiddle = idsOf("Twiddle")[0];
  const tw = targetingForId(g, twiddle);
  const twLegal = legalTargetsForSlot(g, tw.slots[0], 0, {});
  Test.assertEqual(twLegal.includes(artifact), true);
  Test.assertEqual(twLegal.includes(creature), true);
  Test.assertEqual(twLegal.includes(land), true);
  Test.assertEqual(twLegal.includes(enchant), false, "enchantment is not artifact/creature/land");
});

Test.test("t21: graveyard-card targets (Raise Dead, Regrowth, Animate Dead) check zone/type/owner", () => {
  const g = freshGame();
  const raise = idsOf("Raise Dead")[0];
  const regrowth = idsOf("Regrowth")[0];
  const animateDead = idsOf("Animate Dead")[0];

  const myCreature = injectObject(g, 0, idsOf("Serra Angel")[0], "graveyard");
  const myLand = injectObject(g, 0, "plains", "graveyard");
  const myInstant = injectObject(g, 0, idsOf("Lightning Bolt")[0], "graveyard");
  const theirCreature = injectObject(g, 1, idsOf("Scathe Zombies")[0], "graveyard");
  const onField = injectObject(g, 0, idsOf("Savannah Lions")[0]);

  const r = targetingForId(g, raise);
  const rLegal = legalTargetsForSlot(g, r.slots[0], 0, {});
  Test.assertEqual(rLegal.includes(myCreature), true, "your creature card");
  Test.assertEqual(rLegal.includes(myLand), false, "a land card isn't a creature");
  Test.assertEqual(rLegal.includes(myInstant), false, "an instant card isn't a creature");
  Test.assertEqual(rLegal.includes(theirCreature), false, "not your graveyard");
  Test.assertEqual(rLegal.includes(onField), false, "a battlefield creature isn't a graveyard card");
  Test.assertEqual(targetSetLegal(g, r, [theirCreature], 0, {}).ok, false);
  Test.assertEqual(targetSetLegal(g, r, [myCreature], 0, {}).ok, true);

  const rg = targetingForId(g, regrowth);
  const rgLegal = legalTargetsForSlot(g, rg.slots[0], 0, {});
  Test.assertEqual(rgLegal.includes(myCreature), true, "any card type");
  Test.assertEqual(rgLegal.includes(myLand), true);
  Test.assertEqual(rgLegal.includes(myInstant), true);
  Test.assertEqual(rgLegal.includes(theirCreature), false, "still your graveyard only");

  const ad = targetingForId(g, animateDead);
  const adLegal = legalTargetsForSlot(g, ad.slots[0], 0, {});
  Test.assertEqual(adLegal.includes(myCreature), true);
  Test.assertEqual(adLegal.includes(theirCreature), true, "any graveyard's creature card");
  Test.assertEqual(adLegal.includes(myLand), false);
});

Test.test("t21: special filters — Wall (Nettling Imp), power (Dwarven Warriors), tapped (Royal Assassin), your-control (Stone Giant)", () => {
  const g = freshGame();
  const wall = injectObject(g, 0, idsOf("Wall of Swords")[0]);
  const wallBone = injectObject(g, 0, idsOf("Wall of Bone")[0]);
  const angel = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const lions = injectObject(g, 0, idsOf("Savannah Lions")[0]);
  const zombies = injectObject(g, 0, idsOf("Scathe Zombies")[0]);

  // Nettling Imp: non-Wall creature.
  const ni = abilityTargetingFor(g, "nettling-imp", "taunt");
  const niLegal = legalTargetsForSlot(g, ni.slots[0], 0, {});
  Test.assertEqual(niLegal.includes(angel), true);
  Test.assertEqual(niLegal.includes(wall), false, "a Wall is not a legal non-Wall target");
  Test.assertEqual(niLegal.includes(wallBone), false, "Wall of Bone (Skeleton, Wall) excluded");
  Test.assertEqual(targetSetLegal(g, ni, [wall], 0, {}).ok, false);
  Test.assertEqual(targetSetLegal(g, ni, [angel], 0, {}).ok, true);

  // Dwarven Warriors: power 2 or less.
  const dw = abilityTargetingFor(g, "dwarven-warriors", "harry");
  const dwLegal = legalTargetsForSlot(g, dw.slots[0], 0, {});
  Test.assertEqual(dwLegal.includes(lions), true, "2-power lion");
  Test.assertEqual(dwLegal.includes(zombies), true, "2-power zombie");
  Test.assertEqual(dwLegal.includes(angel), false, "4-power angel too big");
  Test.assertEqual(dwLegal.includes(wall), false, "3-power wall too big");

  // Royal Assassin: tapped creature.
  const ra = abilityTargetingFor(g, "royal-assassin", "murder");
  const tapped = injectObject(g, 0, idsOf("Serra Angel")[0], "battlefield", { tapped: true });
  const raLegal = legalTargetsForSlot(g, ra.slots[0], 0, {});
  Test.assertEqual(raLegal.includes(tapped), true, "tapped creature");
  Test.assertEqual(raLegal.includes(angel), false, "untapped creature is not a legal target");
  Test.assertEqual(raLegal.includes(0), false, "a player is not a creature");

  // Stone Giant: creature you control.
  const sg = abilityTargetingFor(g, "stone-giant", "hurl");
  const theirs = injectObject(g, 1, idsOf("Serra Angel")[0]);
  const sgLegal = legalTargetsForSlot(g, sg.slots[0], 0, {});
  Test.assertEqual(sgLegal.includes(angel), true, "your creature");
  Test.assertEqual(sgLegal.includes(theirs), false, "an opponent's creature is not 'you control'");
});

Test.test("t21: count and distinctness (Fireball up to X, distinct, reject too many)", () => {
  const g = freshGame();
  const fireball = idsOf("Fireball")[0];
  const a = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const b = injectObject(g, 0, idsOf("Savannah Lions")[0]);
  const c = injectObject(g, 0, idsOf("Scathe Zombies")[0]);
  const t = targetingForId(g, fireball);

  // X=2: one or two targets.
  Test.assertEqual(targetSetLegal(g, t, [a], 0, { x: 2 }).ok, true);
  Test.assertEqual(targetSetLegal(g, t, [a, b], 0, { x: 2 }).ok, true);
  Test.assertEqual(targetSetLegal(g, t, [a, b, c], 0, { x: 2 }).ok, false, "three targets > X=2");
  Test.assertEqual(targetSetLegal(g, t, [a, a], 0, { x: 2 }).ok, false, "targets must be distinct");
  Test.assertEqual(targetSetLegal(g, t, [], 0, { x: 2 }).ok, false, "at least one target");
  Test.assertEqual(targetSetLegal(g, t, [a, b, c], 0, { x: 3 }).ok, true, "X=3 allows three");

  // Enumeration: X=3 over 3 creatures + 2 players = sets of 1 (5), 2 (20), 3 (60) — cap at 2 by default.
  const sets = legalTargetSets(g, t, 0, { x: 3 });
  Test.assertEqual(sets.length, 5 + 20, "bounded enumeration: 1- and 2-target sets");
  const big = legalTargetSets(g, t, 0, { x: 3, cap: 3 });
  Test.assertEqual(big.length, 5 + 20 + 60, "raising the cap enumerates 3-target sets");
  for (const s of sets) Test.assertEqual(new Set(s).size, s.length, "every enumerated set is distinct");
});

Test.test("t21: player + creature 'any target' enumeration covers both kinds", () => {
  const g = freshGame();
  const bolt = idsOf("Lightning Bolt")[0];
  const a = injectObject(g, 0, idsOf("Serra Angel")[0]);
  const b = injectObject(g, 1, idsOf("Savannah Lions")[0]);
  const t = targetingForId(g, bolt);
  const sets = legalTargetSets(g, t, 0, { sourceColors: ["R"] });
  Test.assertEqual(sets.length, 4, "two players + two creatures → four single-target sets");
  const targets = sets.map((s) => s[0]).sort();
  Test.assertEqual(targets.includes(0) && targets.includes(1), true, "both players enumerated");
  Test.assertEqual(targets.includes(a) && targets.includes(b), true, "both creatures enumerated");
});

// ── group C: agreement with the plugin's authoritative cast-time validation ───────────
// A fixture-deck game walked to P0's precombat_main so casts go through the real reducer.
function setupFixture(hand, inject) {
  const deck = Array(30).fill("vast-plains");
  const game = engine.newGame({ seed: 7, decks: [deck.slice(), deck.slice()] });
  turn.initTurnTracker(game);
  for (const inj of inject || []) {
    for (let i = 0; i < inj.count; i++) injectObject(game, inj.player || 0, inj.cardId, "battlefield", inj.extra || {});
  }
  const pl = game.raw.players[0];
  for (const id of pl.hand.slice()) {
    game.raw.objects[id].zone = "library";
    pl.library.push(id);
  }
  pl.hand = [];
  for (const cardId of hand) pl.hand.push(injectObject(game, 0, cardId, "hand"));
  const r = turn.walkToStep(game, "precombat_main");
  return { game, atMain: r.atStep && !r.gameOver };
}

function inHand(game, cardId) {
  for (const objId of engine.zoneIds(game, "hand", 0)) {
    if (game.raw.objects[objId].cardId === cardId) return objId;
  }
  return null;
}

Test.test("t21: local query agrees with the reducer on legal and illegal casts", () => {
  const { game, atMain } = setupFixture(["cinder-bolt"], [
    { cardId: "sunward-sentinel", count: 1 },                 // P0's creature (legal target)
    { cardId: "volcanic-peak", count: 1 },                    // P0's red land (pays the bolt; also the illegal land target)
    { cardId: "aqueduct-recluse", count: 1, player: 1, extra: {} }, // P1's hexproof creature
  ]);
  Test.assert(atMain, "reached P0's precombat_main");
  const bolt = inHand(game, "cinder-bolt");
  Test.assert(bolt, "bolt in hand");
  const peak = Object.values(game.raw.objects).find((o) => o.zone === "battlefield" && o.controller === 0 && o.cardId === "sunward-sentinel").id;
  const hexproof = Object.values(game.raw.objects).find((o) => o.zone === "battlefield" && o.controller === 1 && o.cardId === "aqueduct-recluse").id;
  const land = Object.values(game.raw.objects).find((o) => o.zone === "battlefield" && o.cardId === "volcanic-peak").id;

  const spec = targetingForId(game, "cinder-bolt");
  const src = { sourceColors: sourceColorsFor(game, "cinder-bolt") };

  // Local query agrees on all three first (no state changes).
  Test.assertEqual(targetSetLegal(game, spec, [peak], 0, src).ok, true);
  Test.assertEqual(targetSetLegal(game, spec, [hexproof], 0, src).ok, false);
  Test.assertEqual(targetSetLegal(game, spec, [land], 0, src).ok, false);

  // Hexproof opponent creature: reducer rejects with a target reason (bolt stays in hand).
  const r1 = castSpell(game, 0, bolt, { targets: [hexproof] });
  Test.assertEqual(r1.ok, false, "reducer also rejects the hexproof target");
  Test.assert(/target/i.test(r1.reason), "reducer names the target: " + r1.reason);

  // Land target: reducer rejects.
  const r2 = castSpell(game, 0, bolt, { targets: [land] });
  Test.assertEqual(r2.ok, false, "reducer rejects a land target");

  // Creature target: reducer cast succeeds, spell on the stack.
  const r3 = castSpell(game, 0, bolt, { targets: [peak] });
  Test.assert(r3.ok, "reducer cast to a creature: " + (r3.reason || ""));
  Test.assertEqual(game.raw.stack.length, 1, "spell is on the stack");
});

Test.test("t21: targetName/describeTarget resolve players and objects readably", () => {
  const g = freshGame();
  const angel = injectObject(g, 0, idsOf("Serra Angel")[0]);
  Test.assertEqual(targetName(g, 1), "Player 1");
  Test.assertEqual(targetName(g, angel), "Serra Angel");
  Test.assertEqual(nameOf(g, angel), "Serra Angel");
  Test.assertEqual(describeTargeting(targetingForId(g, "death-ward")), "target creature");
});
