// Alpha: The Gathering — card data schema & validator (roadmap task 4).
// A card record is a plain object describing one Alpha (LEA) card. Every record
// must satisfy the fields below; validateCard() reports EVERY violation found.

export const SET_CODE = "LEA";

export const COLORS = Object.freeze(["W", "U", "B", "R", "G"]);

export const COLOR_NAMES = Object.freeze({
  W: "white", U: "blue", B: "black", R: "red", G: "green",
});

export const CARD_TYPES = Object.freeze(["artifact", "creature", "enchantment", "instant", "land", "sorcery"]);

export const CARD_SUPERTYPES = Object.freeze(["basic", "legendary", "snow", "world"]);

export const CARD_RARITIES = Object.freeze(["common", "uncommon", "rare"]);

const SYMBOL_BODY = /^([WUBRGTX]|\d+)$/;

// parseManaCost("{2}{W}{X}") -> { symbols, cmc, xCount, colored }
// X counts 0 toward cmc; {T} counts nothing. Returns null on malformed input.
export function parseManaCost(str) {
  if (typeof str !== "string") return null;
  const bodies = [];
  const re = /\{([^}]*)\}/g;
  let cursor = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index !== cursor) return null;
    cursor = re.lastIndex;
    bodies.push(m[1]);
  }
  if (cursor !== str.length) return null;
  const symbols = [];
  let cmc = 0;
  let xCount = 0;
  const colored = [];
  for (const b of bodies) {
    if (!SYMBOL_BODY.test(b)) return null;
    const sym = "{" + b + "}";
    symbols.push(sym);
    if (b === "X") xCount += 1;
    else if (/^\d+$/.test(b)) cmc += parseInt(b, 10);
    else if (b === "T") continue;
    else if (!colored.includes(b)) colored.push(b);
  }
  return { symbols, cmc, xCount, colored };
}

// Color identity is derived strictly from the mana cost (Alpha-era rule): a card's
// identity is exactly the set of colored symbols in its cost. Lands have [].
export function colorIdentityFromCost(manaCost) {
  const p = parseManaCost(manaCost);
  if (!p) return null;
  return [...p.colored].sort();
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function hasDuplicates(arr) {
  return new Set(arr).size !== arr.length;
}

// validateCard(record) -> string[] of violations (empty array = valid).
export function validateCard(record) {
  const violations = [];
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return ["record must be a plain object"];
  }

  if (typeof record.name !== "string" || record.name.trim() === "") {
    violations.push("name: required non-empty string");
  }

  if (typeof record.manaCost !== "string") {
    violations.push("manaCost: must be a string");
  }
  const manaCost = typeof record.manaCost === "string" ? record.manaCost : "";
  const parsed = parseManaCost(manaCost);
  if (parsed === null) {
    violations.push("manaCost: malformed (" + JSON.stringify(manaCost) + ")");
  }

  if (!isStringArray(record.supertypes || [])) {
    violations.push("supertypes: array of strings required (may be empty)");
  } else {
    const st = record.supertypes || [];
    for (const s of st) {
      if (!CARD_SUPERTYPES.includes(s)) violations.push("supertypes: unknown supertype " + JSON.stringify(s));
    }
    if (hasDuplicates(st)) violations.push("supertypes: duplicates not allowed");
  }

  const types = record.types;
  if (!Array.isArray(types) || types.length === 0 || types.some((t) => !CARD_TYPES.includes(t))) {
    violations.push("types: non-empty array of " + CARD_TYPES.join("/"));
  }

  if (!isStringArray(record.subtypes || [])) {
    violations.push("subtypes: array of strings required (may be empty)");
  } else {
    const sb = record.subtypes || [];
    for (const s of sb) {
      if (s.trim() === "") violations.push("subtypes: empty subtype string");
    }
    if (hasDuplicates(sb)) violations.push("subtypes: duplicates not allowed");
  }

  if (!isStringArray(record.colorIdentity || [])) {
    violations.push("colorIdentity: array of color letters required (may be empty)");
  } else {
    const ci = record.colorIdentity || [];
    for (const c of ci) {
      if (!COLORS.includes(c)) violations.push("colorIdentity: invalid color " + JSON.stringify(c));
    }
    if (hasDuplicates(ci)) violations.push("colorIdentity: duplicate colors");
    if (parsed !== null) {
      const declared = [...ci].sort().join("");
      const derived = [...parsed.colored].sort().join("");
      if (declared !== derived) {
        violations.push("colorIdentity: " + JSON.stringify(declared) + " does not match mana cost identity " + JSON.stringify(derived));
      }
    }
  }

  if (typeof record.rulesText !== "string") {
    violations.push("rulesText: string required (may be empty)");
  }

  const isCreature = Array.isArray(types) && types.includes("creature");
  if (isCreature) {
    for (const field of ["power", "toughness"]) {
      const n = record[field];
      const isNumber = typeof n === "number" && Number.isFinite(n) && n >= 0;
      const isVariable = n === "*"; // Alpha's variable-P/T creatures (e.g. Nightmare */*)
      if (!isNumber && !isVariable) {
        violations.push(field + ": non-negative number or \"*\" required for creatures");
      }
    }
  } else {
    if ("power" in record) violations.push("power: only allowed when types includes creature");
    if ("toughness" in record) violations.push("toughness: only allowed when types includes creature");
  }

  if (!CARD_RARITIES.includes(record.rarity)) {
    violations.push("rarity: must be one of " + CARD_RARITIES.join("/") + " (got " + JSON.stringify(record.rarity) + ")");
  }

  if (!Number.isInteger(record.collectorNumber) || record.collectorNumber < 1) {
    violations.push("collectorNumber: positive integer required");
  }

  if (record.set !== undefined && record.set !== SET_CODE) {
    violations.push("set: expected " + JSON.stringify(SET_CODE) + " (got " + JSON.stringify(record.set) + ")");
  }

  return violations;
}

export function isValidCard(record) {
  return validateCard(record).length === 0;
}
