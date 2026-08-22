// Card schema validator tests (roadmap task 4). Register, then run: window.Test.run()
import { SET_CODE, validateCard, isValidCard, parseManaCost, colorIdentityFromCost } from "./schema.js";

const lions = {
  name: "Savannah Lions",
  manaCost: "{W}",
  colorIdentity: ["W"],
  types: ["creature"],
  subtypes: [],
  rulesText: "",
  power: 2,
  toughness: 1,
  rarity: "common",
  collectorNumber: 1,
  set: SET_CODE,
};

Test.test("schema: valid vanilla creature passes", () => {
  Test.assertEqual(validateCard(lions), []);
  Test.assert(isValidCard(lions));
});

Test.test("schema: valid artifact creature passes", () => {
  const c = { ...lions, name: "Ornithopter", manaCost: "{0}", colorIdentity: [], types: ["artifact", "creature"], rulesText: "Flying", power: 0, toughness: 2 };
  Test.assertEqual(validateCard(c), []);
});

Test.test("schema: valid basic land passes", () => {
  const c = { name: "Forest", manaCost: "", colorIdentity: [], supertypes: ["basic"], types: ["land"], subtypes: ["Forest"], rulesText: "", rarity: "common", collectorNumber: 2 };
  Test.assertEqual(validateCard(c), []);
});

Test.test("schema: valid dual land (colorless identity) passes", () => {
  const c = { name: "Tundra", manaCost: "", colorIdentity: [], types: ["land"], subtypes: [], rulesText: "", rarity: "rare", collectorNumber: 3 };
  Test.assertEqual(validateCard(c), []);
});

Test.test("schema: valid enchantment with subtype passes", () => {
  const c = { name: "Holy Strength", manaCost: "{W}", colorIdentity: ["W"], types: ["enchantment"], subtypes: ["Aura"], rulesText: "Enchant creature. Enchanted creature gets +1/+2.", rarity: "common", collectorNumber: 4 };
  Test.assertEqual(validateCard(c), []);
});

Test.test("schema: valid X-cost sorcery passes", () => {
  const c = { name: "Fireball", manaCost: "{X}{R}", colorIdentity: ["R"], types: ["sorcery"], subtypes: [], rulesText: "", rarity: "common", collectorNumber: 5 };
  Test.assertEqual(validateCard(c), []);
});

Test.test("parseManaCost: accepts well-formed costs", () => {
  for (const c of ["", "{0}", "{1}", "{7}", "{W}", "{U}", "{B}", "{R}", "{G}", "{2}{W}{W}", "{X}", "{X}{B}{B}", "{1}{T}", "{3}{T}"]) {
    Test.assert(parseManaCost(c) !== null, "should parse " + JSON.stringify(c));
  }
});

Test.test("parseManaCost: rejects malformed costs", () => {
  for (const c of ["{", "}", "1", "R", "{1R}", "{W}{", "{1R}abc", "{{W}}", "{W} {U}", "{}", "hello", "{1}{1"]) {
    Test.assertEqual(parseManaCost(c), null, "should reject " + JSON.stringify(c));
  }
});

Test.test("parseManaCost: cmc, X count and colors", () => {
  Test.assertEqual(parseManaCost("{2}{W}{W}").cmc, 2);
  Test.assertEqual(parseManaCost("{2}{W}{W}").colored, ["W"]);
  Test.assertEqual(parseManaCost("{X}{B}{B}").cmc, 0);
  Test.assertEqual(parseManaCost("{X}{B}{B}").xCount, 1);
  Test.assertEqual(parseManaCost("{2}{B}{B}").cmc, 2);
  Test.assertEqual(parseManaCost("{X}{R}").colored, ["R"]);
  Test.assertEqual(parseManaCost("").colored, []);
  Test.assertEqual(parseManaCost("").cmc, 0);
});

Test.test("colorIdentityFromCost derives from cost", () => {
  Test.assertEqual(colorIdentityFromCost("{2}{U}{U}"), ["U"]);
  Test.assertEqual(colorIdentityFromCost("{X}{R}"), ["R"]);
  Test.assertEqual(colorIdentityFromCost(""), []);
});

Test.test("schema: missing/blank name", () => {
  Test.assert(validateCard({ ...lions, name: "" }).some((x) => x.startsWith("name")), "blank name flagged");
  Test.assert(validateCard({ ...lions, name: 42 }).some((x) => x.startsWith("name")), "non-string name flagged");
});

Test.test("schema: malformed mana cost", () => {
  Test.assert(validateCard({ ...lions, manaCost: "{1R}" }).some((x) => x.startsWith("manaCost")), "{1R} flagged");
  Test.assert(validateCard({ ...lions, manaCost: 12 }).some((x) => x.startsWith("manaCost")), "non-string cost flagged");
});

Test.test("schema: unknown/empty types", () => {
  Test.assert(validateCard({ ...lions, types: ["creature", "horse"] }).some((x) => x.startsWith("types")), "unknown type flagged");
  Test.assert(validateCard({ ...lions, types: [] }).some((x) => x.startsWith("types")), "empty types flagged");
});

Test.test("schema: creature without power/toughness", () => {
  const v = validateCard({ ...lions, power: undefined, toughness: undefined });
  Test.assert(v.some((x) => x.startsWith("power")), "power flagged");
  Test.assert(v.some((x) => x.startsWith("toughness")), "toughness flagged");
});

Test.test("schema: non-creature with power/toughness", () => {
  const v = validateCard({ name: "Disenchant", manaCost: "{1}{W}", colorIdentity: ["W"], types: ["instant"], subtypes: [], rulesText: "", rarity: "common", collectorNumber: 6, power: 3, toughness: 5 });
  Test.assert(v.some((x) => x.startsWith("power")), "power flagged");
  Test.assert(v.some((x) => x.startsWith("toughness")), "toughness flagged");
});

Test.test("schema: variable power/toughness (*) accepted on creatures", () => {
  const c = { ...lions, name: "Nightmare", power: "*", toughness: "*", rulesText: "Flying", rarity: "rare" };
  Test.assertEqual(validateCard(c), []);
  const nonCreature = { name: "Disenchant", manaCost: "{1}{W}", colorIdentity: ["W"], types: ["instant"], subtypes: [], rulesText: "", rarity: "common", collectorNumber: 6, power: "*", toughness: "*" };
  Test.assert(validateCard(nonCreature).some((x) => x.startsWith("power")), "star on non-creature flagged");
});

Test.test("schema: bad rarity", () => {
  Test.assert(validateCard({ ...lions, rarity: "mythic" }).some((x) => x.startsWith("rarity")), "mythic flagged");
});

Test.test("schema: bad collector number", () => {
  Test.assert(validateCard({ ...lions, collectorNumber: 0 }).some((x) => x.startsWith("collectorNumber")), "0 flagged");
  Test.assert(validateCard({ ...lions, collectorNumber: 1.5 }).some((x) => x.startsWith("collectorNumber")), "fraction flagged");
});

Test.test("schema: colorIdentity mismatch and invalid letters", () => {
  Test.assert(validateCard({ ...lions, colorIdentity: ["U"] }).some((x) => x.startsWith("colorIdentity")), "mismatch flagged");
  Test.assert(validateCard({ ...lions, colorIdentity: ["P"] }).some((x) => x.startsWith("colorIdentity")), "invalid letter flagged");
});

Test.test("schema: wrong set code", () => {
  Test.assert(validateCard({ ...lions, set: "M15" }).some((x) => x.startsWith("set")), "wrong set flagged");
});

Test.test("schema: reports every violation at once", () => {
  const bad = {
    name: "", manaCost: "nope", types: ["creature", "horse"], subtypes: ["Aura", "Aura"],
    colorIdentity: ["Z", "W"], rarity: "junk", collectorNumber: -2, power: "big", toughness: undefined,
  };
  const v = validateCard(bad);
  Test.assert(v.length >= 8, "expected many violations, got " + v.length + ": " + v.join(" | "));
});
