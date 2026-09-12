import { cardColors, themeField } from "./tokens.js";

const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "a", "an", "of", "to", "in", "on", "is", "it", "as", "at", "by", "or", "be", "are", "was", "its"]);

export function themeFields(card) {
  const theme = (card && card.theme) || "";
  return {
    genre: themeField(theme, "GENRE"),
    mood: themeField(theme, "MOOD/VIBE", "MOOD", "VIBE"),
    aesthetic: themeField(theme, "VISUAL AESTHETIC"),
    palette: themeField(theme, "COLOR PALETTE"),
    core: themeField(theme, "CORE SUBJECT"),
    oneline: themeField(theme, "THEME IN ONE LINE")
  };
}

export function tokenize(text) {
  const out = new Set();
  for (const raw of String(text == null ? "" : text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length > 2 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function tagSet(card) {
  return new Set((Array.isArray(card && card.tags) ? card.tags : []).map(t => String(t).toLowerCase()));
}

function fontSet(card) {
  return new Set((Array.isArray(card && card.fonts) ? card.fonts : []).map(t => String(t).toLowerCase()));
}

export function themeSimilarity(a, b) {
  if (!a || !b) return { score: 0, reasons: [] };
  const fa = themeFields(a);
  const fb = themeFields(b);
  const wordsA = tokenize([fa.genre, fa.mood, fa.aesthetic, fa.palette, fa.core, fa.oneline, a.theme].join(" "));
  const wordsB = tokenize([fb.genre, fb.mood, fb.aesthetic, fb.palette, fb.core, fb.oneline, b.theme].join(" "));

  const tags = jaccard(tagSet(a), tagSet(b));
  const fonts = jaccard(fontSet(a), fontSet(b));
  const colors = jaccard(new Set(cardColors(a)), new Set(cardColors(b)));
  const text = jaccard(wordsA, wordsB);

  const reasons = [];
  if (tags > 0) reasons.push("shared tags");
  if (fonts > 0) reasons.push("shared fonts");
  if (colors > 0) reasons.push("overlapping palette");
  if ((fa.genre && fb.genre && fa.genre.toLowerCase() === fb.genre.toLowerCase())) reasons.push("same genre");
  if (text > 0.25) reasons.push("similar description");

  const score = Math.round((tags * 30 + fonts * 20 + colors * 20 + text * 30) * 100) / 100;
  return { score: Math.min(100, score), reasons };
}

export function findSimilar(cards, target, limit = 4) {
  const list = Array.isArray(cards) ? cards : [];
  const targetId = typeof target === "string" ? target : target && target.id;
  const base = typeof target === "string" || !target ? list.find(c => c.id === targetId) : target;
  if (!base) return [];
  return list
    .filter(c => c && c.id !== base.id)
    .map(c => ({ card: c, ...themeSimilarity(base, c) }))
    .filter(r => r.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

function fieldValue(card, fields, key) {
  const c = card || {};
  switch (key) {
    case "title": return c.title || c.name || "";
    case "genre": return fields.genre;
    case "mood": return fields.mood;
    case "aesthetic": return fields.aesthetic;
    case "palette": return fields.palette;
    case "core": return fields.core;
    case "oneline": return fields.oneline;
    case "tags": return (c.tags || []).join(", ");
    case "fonts": return (c.fonts || []).join(", ");
    case "colors": return cardColors(c).join(", ");
    case "radius": return (c.keyStyles && c.keyStyles["border-radius"]) || "";
    case "shadow": return (c.keyStyles && c.keyStyles["box-shadow"]) || "";
    case "background": return (c.keyStyles && (c.keyStyles["background-color"] || c.keyStyles["background"])) || "";
    case "textColor": return (c.keyStyles && c.keyStyles.color) || "";
    default: return "";
  }
}

const COMPARE_FIELDS = [
  ["title", "Title"],
  ["genre", "Genre"],
  ["mood", "Mood / vibe"],
  ["aesthetic", "Visual aesthetic"],
  ["palette", "Color palette"],
  ["core", "Core subject"],
  ["oneline", "Theme in one line"],
  ["tags", "Tags"],
  ["fonts", "Fonts"],
  ["colors", "Extracted colors"],
  ["radius", "Radius"],
  ["shadow", "Shadow"],
  ["background", "Background"],
  ["textColor", "Text color"]
];

export function compareCards(a, b) {
  const fa = themeFields(a);
  const fb = themeFields(b);
  const rows = COMPARE_FIELDS.map(([key, label]) => {
    const left = fieldValue(a, fa, key);
    const right = fieldValue(b, fb, key);
    return { key, label, a: left, b: right, changed: left !== right };
  });
  const sim = themeSimilarity(a, b);
  return { rows, score: sim.score, reasons: sim.reasons };
}

export function compareToText(a, b, comparison) {
  const cmp = comparison || compareCards(a, b);
  const lines = [
    "# Theme comparison",
    "",
    "**A:** " + ((a && (a.title || a.name)) || "—") + "  ",
    "**B:** " + ((b && (b.title || b.name)) || "—") + "  ",
    "**Similarity:** " + cmp.score + "%" + (cmp.reasons.length ? " (" + cmp.reasons.join(", ") + ")" : ""),
    "",
    "| Field | " + ((a && a.name) || "A") + " | " + ((b && b.name) || "B") + " |",
    "| --- | --- | --- |"
  ];
  for (const r of cmp.rows) {
    const mark = r.changed ? "✗" : "✓";
    lines.push("| " + mark + " " + r.label + " | " + (r.a || "—").replace(/\|/g, "\\|") + " | " + (r.b || "—").replace(/\|/g, "\\|") + " |");
  }
  return lines.join("\n");
}
