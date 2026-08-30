// Alpha card database integrity checks (roadmap task 6).
// Compares src/cards/data/alpha.js against the real Alpha (LEA) set: record count,
// name uniqueness, per-rarity / per-color-identity / per-type counts, the basic &
// dual lands, and the absence of non-Alpha cards (Strip Mine). Also produces a
// human-readable QA summary report.
//
// The ALPHA_EXPECTED distribution was verified against the Scryfall API
// (api.scryfall.com/cards/search?q=set:lea&unique=prints, fetched 2026-08): all
// 295 DB records matched Scryfall on name, rarity, colors and mana cost.
//   rarity      common 84 · uncommon 95 · rare 116            (sum 295)
//   colorIdent. W 45 · U 46 · B 46 · R 46 · G 46 · colorless 66  (sum 295)
//   types       artifact 47 · creature 92 · enchantment 68 · instant 43 ·
//               land 19 · sorcery 30            (types overlap for artifact creatures)
//   lands       5 basics × 2 printings, 9 duals (Alpha had no Volcanic Island)
import { ALPHA_CARDS, ALPHA_COUNT } from "./data/alpha.js";
import { validateCard } from "./schema.js";
import { extractProducesMana } from "./plugin.js";

export const ALPHA_EXPECTED = Object.freeze({
  total: 295,
  rarity: Object.freeze({ common: 84, uncommon: 95, rare: 116 }),
  colorIdentity: Object.freeze({ W: 45, U: 46, B: 46, R: 46, G: 46, colorless: 66 }),
  type: Object.freeze({ artifact: 47, creature: 92, enchantment: 68, instant: 43, land: 19, sorcery: 30 }),
  basicLands: Object.freeze(["Plains", "Island", "Swamp", "Mountain", "Forest"]),
  // Each basic land's rules text must produce exactly this color ("({T}: Add {X}.)").
  basicProduces: Object.freeze({ Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" }),
  dualLands: Object.freeze([
    "Badlands", "Bayou", "Plateau", "Savannah", "Scrubland",
    "Taiga", "Tropical Island", "Tundra", "Underground Sea",
  ]),
  // Cards that must NOT appear in the Alpha set (added in later sets).
  forbiddenCards: Object.freeze(["Strip Mine"]),
});

function isBasic(rec) {
  return Array.isArray(rec.supertypes) && rec.supertypes.includes("basic");
}

function isLand(rec) {
  return Array.isArray(rec.types) && rec.types.includes("land");
}

// buildIntegrityReport(records?) — tabulate the given DB (default: the real one)
// into a plain-object summary used by both checkIntegrity and formatIntegrityReport.
export function buildIntegrityReport(records = ALPHA_CARDS) {
  const byRarity = {};
  const byColorIdentity = {};
  const byType = {};
  const nameCounts = {};
  const schemaViolations = [];

  for (const c of records) {
    byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1;
    for (const t of c.types || []) byType[t] = (byType[t] || 0) + 1;
    const identity = Array.isArray(c.colorIdentity) && c.colorIdentity.length
      ? c.colorIdentity.slice().sort().join("")
      : "colorless";
    byColorIdentity[identity] = (byColorIdentity[identity] || 0) + 1;
    nameCounts[c.name] = (nameCounts[c.name] || 0) + 1;
    const v = validateCard(c);
    if (v.length) schemaViolations.push(c.name + " (#" + c.collectorNumber + "): " + v.join("; "));
  }

  const basics = records.filter(isBasic);
  const lands = records.filter(isLand);
  const duals = lands.filter((l) => !isBasic(l));

  return {
    total: records.length,
    uniqueNames: Object.keys(nameCounts).length,
    duplicateNames: Object.entries(nameCounts)
      .filter(([, n]) => n > 1)
      .map(([name, n]) => name + " ×" + n)
      .sort(),
    schemaViolations,
    byRarity,
    byColorIdentity,
    byType,
    basicNames: [...new Set(basics.map((b) => b.name))].sort(),
    basicPrintings: basics.length,
    dualNames: duals.map((d) => d.name).sort(),
    presentNames: new Set(records.map((c) => c.name)),
  };
}

// checkIntegrity(records?, expected?) — array of human-readable violations; an
// empty array means the DB matches the real Alpha set. `records`/`expected` are
// injectable so the checker itself can be tested against corrupted inputs.
export function checkIntegrity(records = ALPHA_CARDS, expected = ALPHA_EXPECTED) {
  const problems = [];
  const rep = buildIntegrityReport(records);

  if (rep.total !== expected.total) {
    problems.push("count: expected " + expected.total + " cards, found " + rep.total);
  }

  const cns = records.map((c) => c.collectorNumber);
  if (new Set(cns).size !== cns.length) problems.push("collector numbers: duplicates found");
  if (cns.length && Math.min(...cns) !== 1) problems.push("collector numbers: minimum is not 1");
  if (cns.length && Math.max(...cns) !== records.length) {
    problems.push("collector numbers: maximum is not " + records.length);
  }

  if (records.some((c) => typeof c.name !== "string" || c.name.trim() === "")) {
    problems.push("names: blank name found");
  }
  const multiPrint = rep.duplicateNames;
  const basicNames = [...expected.basicLands].sort();
  const multiBase = multiPrint.filter((d) => basicNames.includes(d.split(" ×")[0]));
  const multiOther = multiPrint.filter((d) => !basicNames.includes(d.split(" ×")[0]));
  if (multiOther.length) problems.push("names: duplicate non-basic names " + multiOther.join(", "));
  if (multiBase.length !== basicNames.length) {
    problems.push("names: basic lands must be printed twice each — found " + multiPrint.join(", "));
  }

  if (rep.schemaViolations.length) {
    problems.push("schema: " + rep.schemaViolations.length + " record(s) fail validation");
  }

  for (const [rarity, want] of Object.entries(expected.rarity)) {
    if ((rep.byRarity[rarity] || 0) !== want) {
      problems.push("rarity " + rarity + ": expected " + want + ", found " + (rep.byRarity[rarity] || 0));
    }
  }

  for (const [color, want] of Object.entries(expected.colorIdentity)) {
    if ((rep.byColorIdentity[color] || 0) !== want) {
      problems.push("color identity " + color + ": expected " + want + ", found " + (rep.byColorIdentity[color] || 0));
    }
  }

  for (const [type, want] of Object.entries(expected.type)) {
    if ((rep.byType[type] || 0) !== want) {
      problems.push("type " + type + ": expected " + want + ", found " + (rep.byType[type] || 0));
    }
  }

  const basicSet = new Set(records.filter(isBasic).map((b) => b.name));
  for (const want of expected.basicLands) {
    if (!basicSet.has(want)) problems.push("basic land: " + want + " is missing");
    const printings = records.filter((c) => isBasic(c) && c.name === want);
    if (printings.length !== 2) problems.push("basic land: " + want + " should have 2 printings, found " + printings.length);
    for (const p of printings) {
      if (!(p.subtypes || []).includes(want)) problems.push("basic land: " + want + " subtype mismatch");
      if ((p.colorIdentity || []).length !== 0) {
        problems.push("basic land: " + want + " must be colorless in the DB (Alpha-era cost-derived identity)");
      }
      const made = extractProducesMana(p.rulesText);
      if (made !== expected.basicProduces[want]) {
        problems.push("basic land: " + want + " should produce {" + expected.basicProduces[want] + "}, rules text yields " + (made || "nothing"));
      }
    }
  }

  const dualSet = new Set(records.filter((c) => isLand(c) && !isBasic(c)).map((d) => d.name));
  for (const want of expected.dualLands) {
    if (!dualSet.has(want)) problems.push("dual land: " + want + " is missing");
    const d = records.find((c) => isLand(c) && !isBasic(c) && c.name === want);
    if (d && (d.subtypes || []).length !== 2) problems.push("dual land: " + want + " should have 2 subtypes");
    if (d && (d.colorIdentity || []).length !== 0) {
      problems.push("dual land: " + want + " must be colorless in the DB (Alpha-era cost-derived identity)");
    }
  }
  const actualDuals = records.filter((c) => isLand(c) && !isBasic(c)).map((d) => d.name);
  const unexpectedDuals = actualDuals.filter((n) => !expected.dualLands.includes(n));
  for (const n of unexpectedDuals) problems.push("dual land: unexpected " + n + " (Alpha had no Volcanic Island)");

  for (const forbidden of expected.forbiddenCards) {
    if (rep.presentNames.has(forbidden)) problems.push("forbidden: " + forbidden + " must not be in Alpha");
  }

  return problems;
}

// formatIntegrityReport(records?) — human-readable QA checklist text.
export function formatIntegrityReport(records = ALPHA_CARDS) {
  const rep = buildIntegrityReport(records);
  const expected = ALPHA_EXPECTED;
  const problems = checkIntegrity(records);
  const ok = (cond) => (cond ? "✓" : "✗");

  const pad = (n) => String(n).padStart(3);
  const line = (label, n, want) =>
    "  " + label.padEnd(16) + pad(n) + "   (expected " + pad(want) + ") " + ok(n === want);

  let out = "";
  out += "Five Realms — Alpha (LEA) Database Integrity Report\n";
  out += "===================================================\n";
  out += "  records total   : " + pad(rep.total) + "   (expected " + pad(expected.total) + ") " + ok(rep.total === expected.total) + "\n";
  out += "  unique names    : " + pad(rep.uniqueNames) + "   (" + rep.duplicateNames.length + " duplicates = 5 basic lands × 2 printings)\n";
  out += "  schema fails    : " + pad(rep.schemaViolations.length) + "   " + ok(rep.schemaViolations.length === 0) + "\n";
  out += "\n  Rarity distribution\n";
  for (const [r, want] of Object.entries(expected.rarity)) out += line("    " + r, rep.byRarity[r] || 0, want) + "\n";
  out += "\n  Color identity (cost-derived, Alpha era)\n";
  for (const [c, want] of Object.entries(expected.colorIdentity)) out += line("    " + c, rep.byColorIdentity[c] || 0, want) + "\n";
  out += "\n  Card types (cards may have several)\n";
  for (const [t, want] of Object.entries(expected.type)) out += line("    " + t, rep.byType[t] || 0, want) + "\n";
  out += "\n  Basic lands (2 printings each)\n";
  for (const b of expected.basicLands) {
    const printings = records.filter((c) => isBasic(c) && c.name === b);
    const made = printings.length ? extractProducesMana(printings[0].rulesText) : null;
    out += "    " + b.padEnd(12) + "×" + printings.length + "   produces {" + (made || "?") + "}   " + ok(printings.length === 2 && made === expected.basicProduces[b]) + "\n";
  }
  out += "\n  Dual lands (Alpha had 9 — no Volcanic Island)\n";
  const duals = rep.dualNames.length ? rep.dualNames.join(", ") : "(none)";
  out += "    " + duals + "\n";
  for (const forbidden of expected.forbiddenCards) {
    out += "\n  " + forbidden + " absent   " + ok(!rep.presentNames.has(forbidden)) + "\n";
  }
  out += "\n  RESULT: " + (problems.length === 0 ? "CLEAN — DB matches the real Alpha set" : problems.length + " PROBLEM(S) — " + problems.join(" | ")) + "\n";
  return out;
}
