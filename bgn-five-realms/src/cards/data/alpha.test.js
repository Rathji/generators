// Alpha card database tests (roadmap task 5). Register, then run: window.Test.run()
import { ALPHA_CARDS, ALPHA_COUNT } from "./alpha.js";
import { validateCard, SET_CODE } from "../schema.js";

Test.test("database: exactly 295 Alpha printings", () => {
  Test.assertEqual(ALPHA_CARDS.length, 295);
  Test.assertEqual(ALPHA_COUNT, 295);
});

Test.test("database: every record passes the schema validator", () => {
  const bad = [];
  for (const c of ALPHA_CARDS) {
    const v = validateCard(c);
    if (v.length) bad.push(c.name + " (#" + c.collectorNumber + "): " + v.join("; "));
  }
  Test.assertEqual(bad, []);
});

Test.test("database: collector numbers unique and cover 1..295", () => {
  const cns = ALPHA_CARDS.map((c) => c.collectorNumber);
  Test.assertEqual(new Set(cns).size, 295);
  Test.assertEqual(Math.min(...cns), 1);
  Test.assertEqual(Math.max(...cns), 295);
});

Test.test("database: every card has a non-empty name and the LEA set", () => {
  Test.assert(ALPHA_CARDS.every((c) => typeof c.name === "string" && c.name.trim().length > 0), "blank name found");
  Test.assert(ALPHA_CARDS.every((c) => c.set === SET_CODE), "non-LEA set found");
});

Test.test("database: every card has non-empty types", () => {
  Test.assert(ALPHA_CARDS.every((c) => Array.isArray(c.types) && c.types.length > 0), "missing types found");
});

Test.test("database: every creature has power/toughness", () => {
  const missing = ALPHA_CARDS.filter((c) => c.types.includes("creature") && (c.power === undefined || c.toughness === undefined));
  Test.assertEqual(missing, []);
});

Test.test("database: variable-P/T creatures carry *", () => {
  const stars = ALPHA_CARDS.filter((c) => c.power === "*" || c.toughness === "*").map((c) => c.name).sort();
  Test.assertEqual(stars, ["Gaea's Liege", "Keldon Warlord", "Nightmare", "Plague Rats"]);
});

Test.test("database: five basic lands, two printings each", () => {
  const basics = ALPHA_CARDS.filter((c) => c.supertypes.includes("basic"));
  const byName = {};
  for (const b of basics) byName[b.name] = (byName[b.name] || 0) + 1;
  Test.assertEqual(byName, { Plains: 2, Island: 2, Swamp: 2, Mountain: 2, Forest: 2 });
  for (const b of basics) {
    Test.assert(b.subtypes.length === 1 && b.subtypes[0] === b.name, b.name + " subtype mismatch");
  }
});

Test.test("database: nine dual lands present (Alpha had no Volcanic Island)", () => {
  const duals = ALPHA_CARDS.filter((c) => c.types.includes("land") && !c.supertypes.includes("basic"));
  const names = duals.map((c) => c.name).sort();
  Test.assertEqual(names, [
    "Badlands", "Bayou", "Plateau", "Savannah", "Scrubland",
    "Taiga", "Tropical Island", "Tundra", "Underground Sea",
  ]);
  for (const d of duals) {
    Test.assertEqual(d.subtypes.length, 2, d.name + " should have two subtypes");
    Test.assertEqual(d.colorIdentity, [], d.name + " should be colorless");
  }
});

Test.test("database: no Strip Mine (Antiquities card, not Alpha)", () => {
  Test.assert(!ALPHA_CARDS.some((c) => c.name === "Strip Mine"), "Strip Mine must not be in Alpha");
});
