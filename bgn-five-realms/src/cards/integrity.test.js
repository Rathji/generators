// Alpha database integrity tests (roadmap task 6). Register, then run: window.Test.run()
import { ALPHA_CARDS } from "./data/alpha.js";
import {
  ALPHA_EXPECTED,
  buildIntegrityReport,
  checkIntegrity,
  formatIntegrityReport,
} from "./integrity.js";

const CLONE = () => ALPHA_CARDS.map((c) => ({ ...c, subtypes: [...(c.subtypes || [])], colorIdentity: [...(c.colorIdentity || [])] }));

Test.test("integrity: expected constants are internally consistent", () => {
  const raritySum = Object.values(ALPHA_EXPECTED.rarity).reduce((a, b) => a + b, 0);
  Test.assertEqual(raritySum, ALPHA_EXPECTED.total);
  const colorSum = Object.values(ALPHA_EXPECTED.colorIdentity).reduce((a, b) => a + b, 0);
  Test.assertEqual(colorSum, ALPHA_EXPECTED.total);
  Test.assertEqual(ALPHA_EXPECTED.basicLands.length, 5);
  Test.assertEqual(ALPHA_EXPECTED.dualLands.length, 9);
});

Test.test("integrity: report totals and name uniqueness (basics print twice)", () => {
  const rep = buildIntegrityReport();
  Test.assertEqual(rep.total, 295);
  Test.assertEqual(rep.uniqueNames, 290);
  Test.assertEqual(rep.duplicateNames, ["Forest ×2", "Island ×2", "Mountain ×2", "Plains ×2", "Swamp ×2"]);
  Test.assertEqual(rep.basicPrintings, 10);
});

Test.test("integrity: report rarity distribution matches the real Alpha set", () => {
  const rep = buildIntegrityReport();
  Test.assertEqual(rep.byRarity, { common: 84, uncommon: 95, rare: 116 });
});

Test.test("integrity: report color-identity distribution matches the real Alpha set", () => {
  const rep = buildIntegrityReport();
  Test.assertEqual(rep.byColorIdentity, { W: 45, U: 46, B: 46, R: 46, G: 46, colorless: 66 });
});

Test.test("integrity: report type distribution matches the real Alpha set", () => {
  const rep = buildIntegrityReport();
  Test.assertEqual(rep.byType, { artifact: 47, creature: 92, enchantment: 68, instant: 43, land: 19, sorcery: 30 });
});

Test.test("integrity: five basic lands, 2 printings, correct subtype/identity/production", () => {
  const rep = buildIntegrityReport();
  Test.assertEqual(rep.basicNames, ["Forest", "Island", "Mountain", "Plains", "Swamp"]);
  const expects = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };
  for (const [name, color] of Object.entries(expects)) {
    const printings = ALPHA_CARDS.filter((c) => c.supertypes.includes("basic") && c.name === name);
    Test.assertEqual(printings.length, 2, name + " printings");
    for (const p of printings) {
      Test.assert(p.subtypes.length === 1 && p.subtypes[0] === name, name + " subtype");
      Test.assertEqual(p.colorIdentity, [], name + " identity (Alpha-era cost-derived)");
    }
  }
});

Test.test("integrity: nine dual lands with two subtypes each (no Volcanic Island)", () => {
  const rep = buildIntegrityReport();
  Test.assertEqual(rep.dualNames, [
    "Badlands", "Bayou", "Plateau", "Savannah", "Scrubland",
    "Taiga", "Tropical Island", "Tundra", "Underground Sea",
  ]);
  for (const d of rep.dualNames) {
    const rec = ALPHA_CARDS.find((c) => c.types.includes("land") && !c.supertypes.includes("basic") && c.name === d);
    Test.assertEqual(rec.subtypes.length, 2, d + " subtypes");
    Test.assertEqual(rec.colorIdentity, [], d + " identity (Alpha-era cost-derived)");
  }
});

Test.test("integrity: Strip Mine is absent from Alpha", () => {
  Test.assert(!ALPHA_CARDS.some((c) => c.name === "Strip Mine"), "Strip Mine present");
  Test.assertEqual(checkIntegrity().length, 0);
});

Test.test("integrity: checkIntegrity reports a clean bill of health", () => {
  Test.assertEqual(checkIntegrity(), []);
});

Test.test("integrity: QA report text is complete and human-readable", () => {
  const text = formatIntegrityReport();
  for (const fragment of [
    "records total", "unique names", "Rarity distribution", "common", "uncommon", "rare",
    "Color identity", "Card types", "Basic lands", "Dual lands", "Strip Mine", "RESULT: CLEAN",
  ]) {
    Test.assert(text.includes(fragment), "report missing \"" + fragment + "\"");
  }
  Test.assert(text.includes("✓"), "report should mark passing checks");
});

Test.test("integrity: checker detects a wrong rarity", () => {
  const bad = CLONE();
  const target = bad.find((c) => c.name === "Counterspell");
  target.rarity = target.rarity === "uncommon" ? "common" : "uncommon";
  Test.assert(checkIntegrity(bad).some((p) => p.includes("rarity")), "rarity violation not detected");
});

Test.test("integrity: checker detects a missing basic land", () => {
  const bad = CLONE().filter((c) => !(c.name === "Plains" && c.supertypes.includes("basic")));
  Test.assert(checkIntegrity(bad).some((p) => p.includes("Plains")), "missing Plains not detected");
});

Test.test("integrity: checker detects a duplicate non-basic name", () => {
  const bad = CLONE();
  bad.push({ ...bad.find((c) => c.name === "Counterspell") });
  Test.assert(checkIntegrity(bad).some((p) => p.includes("duplicate")), "duplicate name not detected");
});

Test.test("integrity: checker detects Strip Mine when present", () => {
  const bad = CLONE();
  bad.push({ name: "Strip Mine", manaCost: "", colorIdentity: [], supertypes: [], types: ["land"], subtypes: [], rulesText: "", rarity: "uncommon", collectorNumber: 296, set: "LEA" });
  Test.assert(checkIntegrity(bad).some((p) => p.includes("Strip Mine")), "Strip Mine not detected");
});
