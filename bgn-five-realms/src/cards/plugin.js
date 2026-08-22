// Alpha card data → Five Realms plugin card-model projection (roadmap reconcile).
// Projects every record in ./data/alpha.js (the 295 Alpha printings — the source of
// truth) into the five-realms-plugin card shape:
//   id, name, manaCost (OMITTED for lands, per the plugin's convention), cmc, colors,
//   colorIdentity, supertypes, types, subtypes, rulesText, power, toughness, rarity
//   (Field/Marked/Vaulted/Sovereign/Ascendant tiers), frame, glyph, producesMana.
// The plugin's engine ($output) consumes records exactly like this; the game layer in
// src/game/ also resolves card defs through this projection.
//
// Rebuild the plugin's paste-ready frCardDb() body (for perchance.org/five-realms-plugin)
// with:  JSON.stringify(Object.fromEntries(ALPHA_TO_PLUGIN.map(c => [c.id, c])), null, 2)

import { ALPHA_CARDS } from "./data/alpha.js";
import { parseManaCost, COLORS } from "./schema.js";

const TYPE_CAP = {
  artifact: "Artifact",
  creature: "Creature",
  enchantment: "Enchantment",
  instant: "Instant",
  land: "Land",
  sorcery: "Sorcery",
};

const SUPERTYPE_CAP = { basic: "Basic", legendary: "Legendary", snow: "Snow", world: "World" };

// Alpha common/uncommon/rare map onto the plugin's tier ladder (Field = basic-land class).
const RARITY_TIER = { common: "Marked", uncommon: "Vaulted", rare: "Sovereign" };

// Mirrors src/realms.js's realm table: W→solara, G→verdant, U→tide, R→ember, B→umbra.
const COLOR_TO_GLYPH = { W: "solara", G: "verdant", U: "tide", R: "ember", B: "umbra" };

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// cmc exactly as the plugin's mana parser computes it: each {digit} counts its value,
// each {W}{U}{B}{R}{G}{C} counts 1, {X} and {T} count 0. (Alpha has no hybrid/{C} costs.)
function pluginCmc(manaCost) {
  const s = typeof manaCost === "string" ? manaCost : "";
  let cmc = 0;
  const re = /\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const b = m[1];
    if (/^\d+$/.test(b)) cmc += parseInt(b, 10);
    else if (/^[WUBRGC]$/.test(b)) cmc += 1;
  }
  return cmc;
}

// extractProducesMana(rulesText) -> union of {WUBRGC} symbols that follow the word "Add",
// in order of appearance, or null when the text has no fixed mana production. E.g.
//   "({T}: Add {G}.)"          -> "G"
//   "({T}: Add {W} or {U}.)"   -> "WU"
//   "{T}: Add {C}{C}."         -> "C"
//   "Add three mana of any one color." -> null
export function extractProducesMana(rulesText) {
  const t = rulesText || "";
  const at = t.indexOf("Add");
  if (at === -1) return null;
  const re = /\{([WUBRGC])\}/g;
  const found = [];
  let m;
  while ((m = re.exec(t.slice(at))) !== null) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found.length ? found.join("") : null;
}

export function toPluginCard(alpha, index, usedIds) {
  const types = Array.isArray(alpha.types) ? alpha.types : [];
  const isLand = types.includes("land");
  const isCreature = types.includes("creature");
  const supertypes = Array.isArray(alpha.supertypes) ? alpha.supertypes : [];

  const parsed = parseManaCost(typeof alpha.manaCost === "string" ? alpha.manaCost : "");
  const colors = parsed ? parsed.colored : [];
  const cmc = pluginCmc(alpha.manaCost);

  const producesMana = extractProducesMana(alpha.rulesText);

  // colorIdentity = cost colors + colors the card can produce (lands/artifacts), deduped
  // in appearance order (cost first). Matches the plugin's fixtures, where a mana-source
  // artifact carries its identity even though `colors` (from cost) is empty.
  const identity = [];
  for (const c of colors) if (!identity.includes(c)) identity.push(c);
  for (const c of String(producesMana || "")) {
    if (COLORS.includes(c) && !identity.includes(c)) identity.push(c);
  }

  let id = slugify(alpha.name);
  if (usedIds.has(id)) {
    id = slugify(alpha.name) + "-" + alpha.collectorNumber;
    let n = 0;
    while (usedIds.has(id)) id = slugify(alpha.name) + "-" + alpha.collectorNumber + "-" + ++n;
  }
  usedIds.add(id);

  const rec = {
    id,
    name: alpha.name,
    cmc,
    colors,
    colorIdentity: identity,
    supertypes: supertypes.map((s) => SUPERTYPE_CAP[s] || s),
    types: types.map((t) => TYPE_CAP[t] || t),
    subtypes: (Array.isArray(alpha.subtypes) ? alpha.subtypes : []).slice(),
    rulesText: typeof alpha.rulesText === "string" ? alpha.rulesText : "",
    rarity: isLand && supertypes.includes("basic") ? "Field" : RARITY_TIER[alpha.rarity] || alpha.rarity,
  };
  if (!isLand) rec.manaCost = alpha.manaCost;
  if (isCreature) {
    rec.power = alpha.power;
    rec.toughness = alpha.toughness;
  }
  rec.frame = rec.rarity.toLowerCase();
  rec.glyph = identity[0] ? COLOR_TO_GLYPH[identity[0]] || null : null;
  if (producesMana) rec.producesMana = producesMana;
  return rec;
}

export const ALPHA_TO_PLUGIN = (() => {
  const used = new Set();
  const out = [];
  for (let i = 0; i < ALPHA_CARDS.length; i++) out.push(toPluginCard(ALPHA_CARDS[i], i, used));
  return out;
})();

export const PLUGIN_CARD_MAP = Object.fromEntries(ALPHA_TO_PLUGIN.map((c) => [c.id, c]));

const VALID_TYPES = ["Artifact", "Creature", "Enchantment", "Instant", "Land", "Sorcery"];
const VALID_RARITIES = ["Field", "Marked", "Vaulted", "Sovereign", "Ascendant"];
const VALID_GLYPHS = ["solara", "verdant", "tide", "ember", "umbra"];

export function validatePluginCard(rec) {
  const problems = [];
  if (!rec || typeof rec !== "object") return ["record must be an object"];
  if (typeof rec.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rec.id)) problems.push("id: bad slug");
  if (typeof rec.name !== "string" || rec.name.trim() === "") problems.push("name: required");
  if (typeof rec.cmc !== "number" || rec.cmc < 0) problems.push("cmc: non-negative number");
  if (!Array.isArray(rec.colors) || rec.colors.some((c) => !COLORS.includes(c))) problems.push("colors: invalid");
  if (!Array.isArray(rec.colorIdentity) || rec.colorIdentity.some((c) => !COLORS.includes(c))) problems.push("colorIdentity: invalid");
  if (!Array.isArray(rec.supertypes)) problems.push("supertypes: array");
  if (!Array.isArray(rec.types) || rec.types.length === 0 || rec.types.some((t) => !VALID_TYPES.includes(t))) problems.push("types: invalid");
  if (!Array.isArray(rec.subtypes)) problems.push("subtypes: array");
  if (typeof rec.rulesText !== "string") problems.push("rulesText: string");
  if (!VALID_RARITIES.includes(rec.rarity)) problems.push("rarity: invalid tier");
  if (rec.frame !== rec.rarity.toLowerCase()) problems.push("frame: must be lowercase rarity");
  if (!(rec.glyph === null || VALID_GLYPHS.includes(rec.glyph))) problems.push("glyph: invalid realm");
  if (rec.types.includes("Creature")) {
    const okPT = (v) => typeof v === "number" || v === "*";
    if (!okPT(rec.power) || !okPT(rec.toughness)) problems.push("power/toughness: number or *");
  }
  if (rec.manaCost !== undefined && typeof rec.manaCost !== "string") problems.push("manaCost: string");
  if (rec.types.includes("Land") && rec.manaCost !== undefined) problems.push("land must omit manaCost");
  if (!rec.types.includes("Land") && rec.manaCost === undefined) problems.push("non-land must carry manaCost");
  if (rec.producesMana !== undefined && typeof rec.producesMana !== "string") problems.push("producesMana: string");
  return problems;
}
