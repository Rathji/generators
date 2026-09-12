const NAMED_COLORS = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", gray: "#808080",
  grey: "#808080", silver: "#c0c0c0", maroon: "#800000", olive: "#808000", lime: "#00ff00",
  aqua: "#00ffff", cyan: "#00ffff", teal: "#008080", navy: "#000080", fuchsia: "#ff00ff",
  magenta: "#ff00ff", brown: "#a52a2a", coral: "#ff7f50", crimson: "#dc143c", gold: "#ffd700",
  indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa", salmon: "#fa8072",
  tan: "#d2b48c", tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee", beige: "#f5f5dc",
  ivory2: "#fffff0", mint: "#98ff98", plum: "#dda0dd", orchid: "#da70d6", skyblue: "#87ceeb",
  slateblue: "#6a5acd", seagreen: "#2e8b57", forestgreen: "#228b22", firebrick: "#b22222",
  midnightblue: "#191970", royalblue: "#4169e1", steelblue: "#4682b4", chocolate: "#d2691e",
  darkred: "#8b0000", darkblue: "#00008b", darkgreen: "#006400", darkgray: "#a9a9a9", lightgray: "#d3d3d3"
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function hex2(n) {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return "#" + hex2((r + m) * 255) + hex2((g + m) * 255) + hex2((b + m) * 255);
}

export function normalizeColor(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  const named = NAMED_COLORS[raw];
  if (named) return named;
  if (raw === "transparent" || raw === "currentcolor" || raw === "inherit" || raw === "none") return null;

  let m = /^#([0-9a-f]{3,8})$/i.exec(raw);
  if (m) {
    const hex = m[1];
    if (hex.length === 3 || hex.length === 4) {
      return "#" + hex.slice(0, 3).split("").map(c => c + c).join("");
    }
    if (hex.length === 6 || hex.length === 8) return "#" + hex.slice(0, 6);
    return null;
  }

  m = /^rgba?\(([^)]+)\)$/.exec(raw);
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const chans = parts.slice(0, 3).map(p => {
      if (p.endsWith("%")) return (parseFloat(p) / 100) * 255;
      return parseFloat(p);
    });
    if (chans.some(n => !Number.isFinite(n))) return null;
    return "#" + hex2(chans[0]) + hex2(chans[1]) + hex2(chans[2]);
  }

  m = /^hsla?\(([^)]+)\)$/.exec(raw);
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    const l = parseFloat(parts[2]);
    if (![h, s, l].every(Number.isFinite)) return null;
    return hslToHex(h, s, l);
  }

  return null;
}

export function colorsFromText(text) {
  const out = [];
  const seen = new Set();
  const push = value => {
    const hex = normalizeColor(value);
    if (hex && !seen.has(hex)) { seen.add(hex); out.push(hex); }
  };
  const src = String(text == null ? "" : text);
  const re = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b[a-z]{3,20}\b/gi;
  let m;
  while ((m = re.exec(src))) push(m[0]);
  return out;
}

function firstColor(value) {
  const list = colorsFromText(value);
  return list.length ? list[0] : null;
}

export function parseTheme(theme) {
  const out = {};
  for (const raw of String(theme == null ? "" : theme).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z0-9 /_&-]*?)\s*:\s*(.*\S)\s*$/.exec(raw);
    if (m) out[m[1].trim().toUpperCase()] = m[2].trim();
  }
  return out;
}

export function themeField(theme, ...labels) {
  const map = parseTheme(theme);
  for (const label of labels) {
    const key = String(label).toUpperCase();
    if (map[key] != null) return map[key];
  }
  return "";
}

export function cardColors(card) {
  const out = [];
  const seen = new Set();
  const push = hex => {
    if (hex && !seen.has(hex)) { seen.add(hex); out.push(hex); }
  };
  const vars = (card && card.cssVars) || {};
  for (const key of Object.keys(vars)) push(firstColor(vars[key]));
  const styles = (card && card.keyStyles) || {};
  for (const key of Object.keys(styles)) push(firstColor(styles[key]));
  const paletteLine = String((card && card.theme) || "").split(/\r?\n/).find(l => /^\s*COLOR PALETTE\s*:/i.test(l));
  if (paletteLine) {
    for (const hex of colorsFromText(paletteLine.slice(paletteLine.indexOf(":") + 1))) push(hex);
  }
  return out.slice(0, 16);
}

function slugTokenName(name, index) {
  let s = String(name == null ? "" : name).replace(/^--/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  if (!s) s = "token-" + (index + 1);
  if (/^[0-9]/.test(s)) s = "c-" + s;
  return s;
}

function uniqueName(base, used) {
  let name = base;
  let n = 2;
  while (used.has(name)) { name = base + "-" + n; n++; }
  used.add(name);
  return name;
}

export function designTokens(card) {
  const c = card || {};
  const vars = c.cssVars || {};
  const styles = c.keyStyles || {};

  const colors = [];
  const usedNames = new Set();
  const seenValues = new Set();
  const addColor = (rawValue, nameHint) => {
    const hex = firstColor(rawValue);
    if (!hex || seenValues.has(hex)) return;
    seenValues.add(hex);
    colors.push({ name: uniqueName(slugTokenName(nameHint), usedNames), value: hex });
  };
  for (const key of Object.keys(vars)) addColor(vars[key], key);
  for (const key of Object.keys(styles)) addColor(styles[key], key + "x");

  const paletteLine = String(c.theme || "").split(/\r?\n/).find(l => /^\s*COLOR PALETTE\s*:/i.test(l));
  if (paletteLine) {
    const parts = paletteLine.slice(paletteLine.indexOf(":") + 1).split(/[,;]+/);
    parts.forEach((p, i) => addColor(p, "palette-" + (i + 1)));
  }

  const resolvedStyles = {};
  for (const key of Object.keys(styles)) {
    resolvedStyles[key] = resolveVars(styles[key], vars);
  }

  const radius = resolvedStyles["border-radius"] || null;
  const shadow = resolvedStyles["box-shadow"] || null;
  const background = resolvedStyles["background-color"] || resolvedStyles["background"] || null;
  const textColor = resolvedStyles["color"] || null;
  const firstFont = (c.fonts || [])[0];
  const fontFamily = resolvedStyles["font-family"] || (firstFont ? firstFont + ", sans-serif" : null);

  return {
    name: c.name || "",
    title: c.title || c.name || "",
    palette: colors.map(x => x.value),
    colors,
    fonts: Array.isArray(c.fonts) ? c.fonts.slice() : [],
    fontLinks: Array.isArray(c.fontLinks) ? c.fontLinks.slice() : [],
    cssVars: { ...vars },
    styles: resolvedStyles,
    radius,
    shadow,
    background,
    textColor,
    fontFamily,
    generatedAt: new Date().toISOString()
  };
}

export function resolveVars(value, vars) {
  return String(value == null ? "" : value).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (m, name, fb) => {
    const found = (vars || {})[name];
    return found != null ? found : (fb != null ? fb.trim() : m);
  });
}

export function tokensToJson(tokens) {
  return JSON.stringify(tokens, null, 2);
}

export function tokensToCssVars(tokens) {
  const lines = [":root {"];
  if (tokens.fontFamily) lines.push("  --font-theme: " + tokens.fontFamily + ";");
  for (const c of tokens.colors) lines.push("  --" + c.name + ": " + c.value + ";");
  if (tokens.radius) lines.push("  --radius-theme: " + tokens.radius + ";");
  if (tokens.shadow) lines.push("  --shadow-theme: " + tokens.shadow + ";");
  if (tokens.background) lines.push("  --bg-theme: " + tokens.background + ";");
  if (tokens.textColor) lines.push("  --text-theme: " + tokens.textColor + ";");
  lines.push("}");
  return lines.join("\n");
}

export function tokensToScss(tokens) {
  const lines = [];
  if (tokens.fontFamily) lines.push("$font-theme: " + tokens.fontFamily + ";");
  for (const c of tokens.colors) lines.push("$" + c.name + ": " + c.value + ";");
  if (tokens.radius) lines.push("$radius-theme: " + tokens.radius + ";");
  if (tokens.shadow) lines.push("$shadow-theme: " + tokens.shadow + ";");
  if (tokens.background) lines.push("$bg-theme: " + tokens.background + ";");
  return lines.join("\n");
}

export function tokensToTailwind(tokens) {
  const colorLines = tokens.colors.map(c => '        "' + c.name + '": "' + c.value + '"');
  const fontStack = tokens.fontFamily
    ? tokens.fontFamily.split(",").map(f => '"' + f.trim().replace(/^["']|["']$/g, "") + '"').join(", ")
    : '"sans-serif"';
  const lines = [
    "module.exports = {",
    "  theme: {",
    "    extend: {",
    "      colors: {",
    colorLines.join(",\n") || '        "theme": "#000000"',
    "      },",
    "      fontFamily: {",
    "        theme: [" + fontStack + "]",
    "      },",
    "      borderRadius: {",
    '        theme: "' + (tokens.radius || "0.5rem") + '"',
    "      },",
    "      boxShadow: {",
    '        theme: "' + (tokens.shadow || "none").replace(/"/g, "'") + '"',
    "      }",
    "    }",
    "  }",
    "};"
  ];
  return lines.join("\n");
}

export function tokensToMarkdown(card, tokens) {
  const t = tokens || designTokens(card);
  const lines = ["# Design tokens — " + (t.title || t.name || "theme"), ""];
  if (t.fontFamily) lines.push("- **Font stack:** " + t.fontFamily);
  if (t.background) lines.push("- **Background:** " + t.background);
  if (t.textColor) lines.push("- **Text color:** " + t.textColor);
  if (t.radius) lines.push("- **Radius:** " + t.radius);
  if (t.shadow) lines.push("- **Shadow:** " + t.shadow);
  lines.push("");
  if (t.colors.length) {
    lines.push("## Palette", "");
    for (const c of t.colors) lines.push("- `" + c.value + "` — " + c.name);
    lines.push("");
  }
  if (t.fonts.length) {
    lines.push("## Fonts", "");
    for (const f of t.fonts) lines.push("- " + f);
    lines.push("");
  }
  return lines.join("\n");
}

export function tokensSummary(tokens) {
  if (!tokens) return "";
  const bits = [];
  if (tokens.colors.length) bits.push(tokens.colors.length + " colors");
  if (tokens.fonts.length) bits.push(tokens.fonts.length + " fonts");
  if (tokens.radius) bits.push("radius");
  return bits.join(" · ");
}
