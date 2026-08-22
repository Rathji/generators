// Alpha → plugin card-model projection tests (roadmap reconcile, Phase 2.5).
// Register, then run: window.Test.run()
import {
  ALPHA_TO_PLUGIN,
  PLUGIN_CARD_MAP,
  validatePluginCard,
  extractProducesMana,
} from "./plugin.js";
import { ALPHA_CARDS, ALPHA_COUNT } from "./data/alpha.js";

function byName(name) {
  return ALPHA_TO_PLUGIN.filter((c) => c.name === name);
}

Test.test("reconcile: exactly 295 records projected", () => {
  Test.assertEqual(ALPHA_TO_PLUGIN.length, ALPHA_COUNT);
  Test.assertEqual(ALPHA_TO_PLUGIN.length, 295);
});

Test.test("reconcile: every record passes the plugin-model validator", () => {
  for (const c of ALPHA_TO_PLUGIN) {
    const problems = validatePluginCard(c);
    Test.assertEqual(problems, [], c.id + " → " + problems.join("; "));
  }
});

Test.test("reconcile: ids are unique and slugs are stable", () => {
  const ids = ALPHA_TO_PLUGIN.map((c) => c.id);
  Test.assertEqual(new Set(ids).size, ids.length);
  Test.assertEqual(PLUGIN_CARD_MAP["black-lotus"] && PLUGIN_CARD_MAP["black-lotus"].name, "Black Lotus");
  Test.assertEqual(PLUGIN_CARD_MAP["circle-of-protection-blue"] && PLUGIN_CARD_MAP["circle-of-protection-blue"].name, "Circle of Protection: Blue");
});

Test.test("reconcile: names round-trip against the source of truth", () => {
  for (let i = 0; i < ALPHA_CARDS.length; i++) {
    Test.assertEqual(ALPHA_TO_PLUGIN[i].name, ALPHA_CARDS[i].name);
  }
});

Test.test("reconcile: colors match cost identity for every non-land", () => {
  for (const c of ALPHA_TO_PLUGIN) {
    if (c.types.includes("Land")) continue;
    for (const col of c.colors) Test.assert(["W", "U", "B", "R", "G"].includes(col), c.id);
    if (!c.producesMana) {
      Test.assertEqual(c.colors, c.colorIdentity, c.id);
    } else {
      // Mana-source artifacts (Moxen etc.): colors come from the cost, colorIdentity
      // adds the produced color (mirrors the plugin's faceted-ember-core fixture).
      const produced = c.producesMana.split("").filter((x) => x !== "C");
      Test.assert(c.colors.every((x) => c.colorIdentity.includes(x)), c.id + " colors ⊆ identity");
      for (const p of produced) Test.assert(c.colorIdentity.includes(p), c.id + " produced color in identity");
    }
  }
});

Test.test("reconcile: lands omit manaCost and keep cmc 0", () => {
  const lands = ALPHA_TO_PLUGIN.filter((c) => c.types.includes("Land"));
  Test.assertEqual(lands.length, 19); // 10 basic printings + 9 dual lands
  for (const l of lands) {
    Test.assert(l.manaCost === undefined, l.id + " should omit manaCost");
    Test.assertEqual(l.cmc, 0, l.id);
  }
});

Test.test("reconcile: basic lands are Field tier with correct mana and realm glyph", () => {
  const expected = {
    Plains: ["W", "solara"],
    Island: ["U", "tide"],
    Swamp: ["B", "umbra"],
    Mountain: ["R", "ember"],
    Forest: ["G", "verdant"],
  };
  for (const l of byName("Plains")) {
    Test.assertEqual(l.rarity, "Field", l.id);
    Test.assertEqual(l.supertypes, ["Basic"], l.id);
    Test.assertEqual(l.producesMana, "W", l.id);
    Test.assertEqual(l.colorIdentity, ["W"], l.id);
    Test.assertEqual(l.glyph, "solara", l.id);
  }
  const forest = byName("Forest")[0];
  Test.assertEqual(forest.producesMana, "G");
  Test.assertEqual(forest.glyph, "verdant");
  Test.assertEqual(byName("Plains").length + byName("Island").length + byName("Swamp").length + byName("Mountain").length + byName("Forest").length, 10);
});

Test.test("reconcile: dual lands carry both colors in colorIdentity", () => {
  const tundra = byName("Tundra")[0];
  Test.assert(tundra, "Tundra present");
  Test.assertEqual(tundra.colorIdentity, ["W", "U"]);
  Test.assertEqual(tundra.producesMana, "WU");
  Test.assertEqual(tundra.colors, []);
  const duals = ALPHA_TO_PLUGIN.filter((c) => c.types.includes("Land") && c.rarity === "Sovereign");
  Test.assertEqual(duals.length, 9, "nine dual lands, all Sovereign-tier");
  for (const d of duals) Test.assertEqual(d.producesMana.length, 2, d.id);
});

Test.test("reconcile: moxen/artifacts carry identity from their produced color", () => {
  const pearl = byName("Mox Pearl")[0];
  Test.assert(pearl, "Mox Pearl present");
  Test.assertEqual(pearl.colors, []);
  Test.assertEqual(pearl.colorIdentity, ["W"]);
  Test.assertEqual(pearl.producesMana, "W");
  Test.assertEqual(pearl.glyph, "solara");
  const ring = byName("Sol Ring")[0];
  Test.assertEqual(ring.producesMana, "C");
  Test.assertEqual(ring.colorIdentity, []);
  Test.assertEqual(ring.glyph, null);
});

Test.test("reconcile: Black Lotus has no fixed mana production", () => {
  const lotus = byName("Black Lotus")[0];
  Test.assertEqual(lotus.manaCost, "{0}");
  Test.assertEqual(lotus.cmc, 0);
  Test.assertEqual(lotus.colors, []);
  Test.assertEqual(lotus.colorIdentity, []);
  Test.assert(lotus.producesMana === undefined, "no producesMana for variable production");
  Test.assertEqual(lotus.glyph, null);
});

Test.test("reconcile: X-cost spells keep their cost and cmc ignores X", () => {
  const fireball = byName("Fireball")[0];
  Test.assertEqual(fireball.manaCost, "{X}{R}");
  Test.assertEqual(fireball.cmc, 1);
  Test.assertEqual(fireball.colors, ["R"]);
});

Test.test("reconcile: cmc matches the plugin's parser for colored and generic costs", () => {
  const samples = [
    ["Black Lotus", 0],
    ["Savannah Lions", 1],   // {W}
    ["Serra Angel", 5],      // {3}{W}{W}
    ["Armageddon", 4],       // {3}{W}
    ["Dark Ritual", 1],      // {B}
    ["Fireball", 1],         // {X}{R} — X counts 0
  ];
  for (const [name, expect] of samples) {
    Test.assertEqual(byName(name)[0].cmc, expect, name);
  }
});

Test.test("reconcile: variable-P/T creatures keep *", () => {
  const nightmare = byName("Nightmare")[0];
  Test.assertEqual(nightmare.power, "*");
  Test.assertEqual(nightmare.toughness, "*");
  Test.assertEqual(nightmare.glyph, "umbra");
  const variable = ALPHA_TO_PLUGIN.filter((c) => c.types.includes("Creature") && (c.power === "*" || c.toughness === "*"));
  Test.assertEqual(variable.length, 4);
});

Test.test("reconcile: rarity tiers map and distribution is sane", () => {
  const count = {};
  for (const c of ALPHA_TO_PLUGIN) count[c.rarity] = (count[c.rarity] || 0) + 1;
  Test.assert(count.Marked > 0 && count.Vaulted > 0 && count.Sovereign > 0, "all three Alpha rarities map into tiers");
  Test.assertEqual(count.Field, 10, "10 basic-land printings");
  Test.assertEqual(count.Marked + count.Vaulted + count.Sovereign, 285);
  Test.assert(count.Ascendant === undefined, "no Alpha card is Ascendant-tier");
  console.log("[reconcile] rarity tiers:", JSON.stringify(count));
});

Test.test("reconcile: extractProducesMana parses the common patterns", () => {
  Test.assertEqual(extractProducesMana("({T}: Add {G}.)"), "G");
  Test.assertEqual(extractProducesMana("({T}: Add {W} or {U}.)"), "WU");
  Test.assertEqual(extractProducesMana("{T}: Add {C}{C}."), "C");
  Test.assertEqual(extractProducesMana("{T}, Sacrifice this artifact: Add three mana of any one color."), null);
  Test.assertEqual(extractProducesMana("Flying"), null);
  Test.assertEqual(extractProducesMana(""), null);
});

Test.test("reconcile: every creature keeps power/toughness, others never carry them", () => {
  for (const c of ALPHA_TO_PLUGIN) {
    if (c.types.includes("Creature")) {
      Test.assert(c.power !== undefined && c.toughness !== undefined, c.id);
    } else {
      Test.assert(c.power === undefined && c.toughness === undefined, c.id);
    }
  }
});
