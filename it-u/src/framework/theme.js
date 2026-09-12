// src/framework/theme.js — the appearance system: light/dark mode, preset
// themes, and user-authored custom themes.
//
// The whole UI is painted from CSS custom properties declared in
// src/styles.css `:root` (--primary, --bg, --surface, --text, …). A "theme" is
// simply a map of those properties; applying one writes them as inline styles
// on <html>, which override the stylesheet defaults. That keeps theming a
// single-source-of-truth operation: change the map, the whole app repaints —
// no per-component CSS, no class-toggling.
//
// A theme has a light and a dark palette. Presets (PRESETS) are defined by an
// accent colour and built into a full, coherent palette for each mode on top of
// the neutral scales below (buildPalette) — so a preset is a handful of numbers,
// not 40 hand-tuned hexes, yet every preset ships both a light and a dark
// variant. Users can also author a fully custom theme by editing the 17 editable
// tokens per mode; custom themes are saved (name + light/dark token maps) and
// re-applied by id.
//
// Persistence is localStorage (a UI preference, read synchronously so the boot
// script in index.html can paint the saved theme before first render — no
// flash). The active state + a resolved token map are stored together; see
// bootScript() for the inline snippet that mirrors it at parse time.

import { h } from "./dom.js";

export const STORAGE_KEY = "kb:theme:v1";

// ---------------------------------------------------------------------------
// colour helpers (pure)
// ---------------------------------------------------------------------------

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Parse "#rgb" / "#rrggbb" / "rrggbb" → {r,g,b} (0–255). Returns null on junk.
export function parseHex(input) {
  let s = String(input == null ? "" : input).trim().replace(/^#/, "");
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

export function isHex(input) {
  return parseHex(input) !== null;
}

export function toHex({ r, g, b }) {
  const f = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return "#" + f(r) + f(g) + f(b);
}

// Blend two colours: t=0 → a, t=1 → b.
export function mix(a, b, t) {
  const A = parseHex(a) || { r: 0, g: 0, b: 0 };
  const B = parseHex(b) || { r: 0, g: 0, b: 0 };
  const k = clamp(Number(t) || 0, 0, 1);
  return toHex({ r: A.r + (B.r - A.r) * k, g: A.g + (B.g - A.g) * k, b: A.b + (B.b - A.b) * k });
}

export function lighten(hex, t) {
  return mix(hex, "#ffffff", t);
}

export function darken(hex, t) {
  return mix(hex, "#000000", t);
}

// WCAG relative luminance (0 = black, 1 = white).
export function luminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// The readable ink to place on a coloured background (buttons, avatars, …).
export function readableOn(bg, dark = "#0b1220", light = "#ffffff") {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

// The user-editable tokens, grouped for the editor UI. Every one maps 1:1 to a
// CSS custom property in styles.css.
export const TOKEN_GROUPS = [
  { group: "Accent", tokens: [
    { key: "--primary", label: "Accent" },
    { key: "--primary-strong", label: "Accent strong" },
    { key: "--primary-soft", label: "Accent soft" },
  ] },
  { group: "Surfaces", tokens: [
    { key: "--bg", label: "Page background" },
    { key: "--surface", label: "Card surface" },
    { key: "--surface-2", label: "Raised surface" },
    { key: "--border", label: "Border" },
  ] },
  { group: "Text", tokens: [
    { key: "--text", label: "Text" },
    { key: "--muted", label: "Muted text" },
    { key: "--muted-2", label: "Faint text" },
  ] },
  { group: "Status", tokens: [
    { key: "--success", label: "Success" },
    { key: "--success-soft", label: "Success soft" },
    { key: "--warning", label: "Warning" },
    { key: "--warning-soft", label: "Warning soft" },
    { key: "--danger", label: "Danger" },
    { key: "--danger-soft", label: "Danger soft" },
  ] },
];

export const EDITABLE_TOKENS = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.key));

const TOKEN_LABEL = {};
for (const g of TOKEN_GROUPS) for (const t of g.tokens) TOKEN_LABEL[t.key] = t.label;

export const tokenLabel = (key) => TOKEN_LABEL[key] || key;

// The neutral scales a palette is built on. Dark keeps the same semantic order
// (bg < surface-2 < surface) with a cool near-black base.
const NEUTRAL_LIGHT = {
  "--bg": "#eef1f7",
  "--surface": "#ffffff",
  "--surface-2": "#f4f6fb",
  "--border": "#e2e7f0",
  "--text": "#1b2434",
  "--muted": "#5d6b84",
  "--muted-2": "#93a0b8",
};
const NEUTRAL_DARK = {
  "--bg": "#0f141c",
  "--surface": "#171d27",
  "--surface-2": "#1e2632",
  "--border": "#2a3444",
  "--text": "#e6ebf3",
  "--muted": "#9aa7bd",
  "--muted-2": "#6b788c",
};

const STATUS_LIGHT = {
  "--success": "#1f9d55",
  "--success-soft": "#e7f6ee",
  "--warning": "#b7791f",
  "--warning-soft": "#fbf2e0",
  "--danger": "#d64545",
  "--danger-soft": "#fdecec",
};
const STATUS_DARK = {
  "--success": "#4ade80",
  "--success-soft": "#12241a",
  "--warning": "#f0b429",
  "--warning-soft": "#2a2110",
  "--danger": "#f87171",
  "--danger-soft": "#2a1618",
};

// The semantic tint families used by the many status / info badges, banners and
// chips in styles.css. Each ships a light and a dark pair so a tinted chip stays
// legible in either mode (these are pulled in as tokens rather than literals).
const SEMANTIC_LIGHT = {
  "--info": "#1e6fb8",
  "--info-soft": "#e8f4ff",
  "--violet": "#6b3fc9",
  "--violet-soft": "#f3ecff",
  "--violet-border": "#dccbf5",
  "--mint": "#17795a",
  "--mint-soft": "#e6f7f1",
  "--neutral-soft": "#f0f0f4",
  "--neutral-ink": "#6b7280",
  "--neutral-border": "#d7dbe3",
  "--warning-ink": "#8a6114",
  "--warning-border": "#f0d7a0",
  "--danger-border": "#f3c4c4",
  "--success-border": "#bfe6cf",
  "--mark-bg": "#ffe9a8",
  "--mark-text": "#5c4307",
  "--code-bg": "#101828",
  "--code-text": "#e5e9f2",
  "--code-accent": "#a5f3fc",
};
const SEMANTIC_DARK = {
  "--info": "#7cc0f5",
  "--info-soft": "#12283a",
  "--violet": "#c4a7f5",
  "--violet-soft": "#241a37",
  "--violet-border": "#3f2f5e",
  "--mint": "#6ee7b7",
  "--mint-soft": "#10291f",
  "--neutral-soft": "#232a35",
  "--neutral-ink": "#aab3c2",
  "--neutral-border": "#38414f",
  "--warning-ink": "#f0b429",
  "--warning-border": "#5a4a1e",
  "--danger-border": "#5a2a2e",
  "--success-border": "#1e4630",
  "--mark-bg": "#4a3a10",
  "--mark-text": "#ffe9a8",
  "--code-bg": "#0b1017",
  "--code-text": "#dbe3f0",
  "--code-accent": "#a5f3fc",
};

// Build the full token map for a mode. `spec` carries the accent plus optional
// per-token overrides (a custom theme passes ALL its edited tokens here).
export function buildPalette(mode, spec = {}) {
  const dark = mode === "dark";
  const neutral = dark ? NEUTRAL_DARK : NEUTRAL_LIGHT;
  const p = { ...neutral, ...(dark ? STATUS_DARK : STATUS_LIGHT), ...(dark ? SEMANTIC_DARK : SEMANTIC_LIGHT) };

  const accent = isHex(spec.accent) ? spec.accent : dark ? "#6c8cff" : "#3b5bdb";
  p["--primary"] = accent;
  p["--primary-strong"] = isHex(spec.accentStrong)
    ? spec.accentStrong
    : dark
      ? lighten(accent, 0.14)
      : darken(accent, 0.16);
  p["--primary-soft"] = isHex(spec.accentSoft)
    ? spec.accentSoft
    : dark
      ? mix(accent, neutral["--surface"], 0.84)
      : mix(accent, "#ffffff", 0.9);

  // Derived tokens that keep the UI coherent in both modes.
  p["--primary-grad"] = `linear-gradient(135deg, ${accent}, ${lighten(accent, dark ? 0.08 : 0.22)})`;
  p["--on-primary"] = readableOn(accent);
  p["--primary-border"] = dark ? mix(accent, neutral["--border"], 0.55) : lighten(accent, 0.72);
  p["--warning-tint"] = dark ? mix(p["--warning"], neutral["--surface"], 0.9) : mix(p["--warning"], "#ffffff", 0.92);
  p["--overlay"] = dark ? "rgba(3, 7, 14, 0.62)" : "rgba(15, 23, 42, 0.42)";
  p["--toast-bg"] = dark ? "#2a3444" : "#1b2434";
  p["--toast-text"] = dark ? "#e6ebf3" : "#ffffff";
  p["--mode"] = mode;

  // Explicit token overrides win (this is how a custom theme is applied).
  if (spec.tokens) {
    for (const k of Object.keys(spec.tokens)) {
      if (isHex(spec.tokens[k])) p[k] = spec.tokens[k];
    }
  }
  return p;
}

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------

// A "bunch of themes": each is an accent that the builder expands into a full
// light + dark palette. Add one by appending here; nothing else changes.
export const PRESETS = [
  { id: "indigo", name: "Indigo", accent: "#3b5bdb" },
  { id: "corporate", name: "Corporate Navy", accent: "#1e3a8a" },
  { id: "slate", name: "Slate", accent: "#546a8e" },
  { id: "ocean", name: "Ocean", accent: "#0f7bd1" },
  { id: "teal", name: "Teal", accent: "#0e9488" },
  { id: "emerald", name: "Emerald", accent: "#0f9d6b" },
  { id: "forest", name: "Forest", accent: "#2f7d32" },
  { id: "violet", name: "Violet", accent: "#7c3aed" },
  { id: "grape", name: "Grape", accent: "#9333ea" },
  { id: "rose", name: "Rose", accent: "#db2777" },
  { id: "sunset", name: "Sunset", accent: "#ea580c" },
  { id: "amber", name: "Amber", accent: "#d97706" },
  { id: "nord", name: "Nord", accent: "#5e81ac" },
  { id: "solarized", name: "Solarized", accent: "#268bd2" },
  { id: "midnight", name: "Midnight", accent: "#4f7cff" },
  { id: "mono", name: "Monochrome", accent: "#4b5563" },
];

const PRESET_BY_ID = {};
for (const p of PRESETS) PRESET_BY_ID[p.id] = p;

export const preset = (id) => PRESET_BY_ID[id] || null;
export const DEFAULT_THEME_ID = "indigo";

// The palettes a preset resolves to, for a swatch preview or a quick apply.
export function presetPalettes(id) {
  const p = preset(id);
  if (!p) return null;
  return { light: buildPalette("light", p), dark: buildPalette("dark", p) };
}

// ---------------------------------------------------------------------------
// state + persistence
// ---------------------------------------------------------------------------

export const MODES = ["light", "dark", "system"];

const DEFAULT_STATE = () => ({ mode: "system", themeId: DEFAULT_THEME_ID, custom: [] });

function readStored() {
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const state = DEFAULT_STATE();
    if (MODES.includes(parsed.mode)) state.mode = parsed.mode;
    if (typeof parsed.themeId === "string") state.themeId = parsed.themeId;
    if (Array.isArray(parsed.custom)) state.custom = parsed.custom.filter(isCustomTheme);
    return state;
  } catch {
    return null;
  }
}

function isCustomTheme(t) {
  return t && typeof t.id === "string" && t.id && t.light && t.dark;
}

let state = readStored() || DEFAULT_STATE();
let listeners = [];

// The concrete mode after resolving "system" against the OS preference.
export function resolveMode(mode = state.mode) {
  if (mode === "dark" || mode === "light") return mode;
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

// The theme's light/dark palettes (a custom theme's own tokens, or a preset's
// built palette).
export function palettesFor(themeId = state.themeId) {
  const custom = state.custom.find((c) => c.id === themeId);
  if (custom) {
    return {
      light: buildPalette("light", { accent: custom.light["--primary"], tokens: custom.light }),
      dark: buildPalette("dark", { accent: custom.dark["--primary"], tokens: custom.dark }),
    };
  }
  return presetPalettes(themeId) || presetPalettes(DEFAULT_THEME_ID);
}

export function activePalettes() {
  return palettesFor(state.themeId);
}

// The token map currently in force (resolved mode).
export function activeTokens() {
  const mode = resolveMode();
  return palettesFor(state.themeId)[mode];
}

export function getTheme() {
  const copy = { mode: state.mode, themeId: state.themeId, custom: state.custom.map((c) => ({ ...c })) };
  copy.resolvedMode = resolveMode();
  copy.isCustom = state.custom.some((c) => c.id === state.themeId);
  return copy;
}

// Apply a token map to <html> and record the mode for mode-specific CSS.
export function applyTokens(tokens, mode) {
  const root = document.documentElement;
  for (const k of Object.keys(tokens)) root.style.setProperty(k, tokens[k]);
  root.setAttribute("data-mode", mode);
  root.style.colorScheme = mode;
  // Let the platform's own chrome (scrollbars, form controls) follow suit.
  root.style.setProperty("--mode", mode);
}

export function applyTheme() {
  const mode = resolveMode();
  applyTokens(palettesFor(state.themeId)[mode], mode);
}

function persist() {
  try {
    if (typeof localStorage === "undefined") return;
    const mode = resolveMode();
    const payload = {
      v: 1,
      mode: state.mode,
      themeId: state.themeId,
      custom: state.custom,
      resolved: { mode, tokens: palettesFor(state.themeId)[mode] },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable — theming still works for this session */
  }
}

function emit() {
  const snap = getTheme();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* a listener must never break theming */
    }
  }
}

export function onThemeChange(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

// ---- mutations ----

export function setMode(mode) {
  if (!MODES.includes(mode)) return getTheme();
  state.mode = mode;
  applyTheme();
  persist();
  emit();
  return getTheme();
}

// Toggle light ↔ dark (from "system" it flips away from the resolved mode).
export function toggleMode() {
  const next = resolveMode() === "dark" ? "light" : "dark";
  return setMode(next);
}

export function setThemeId(id) {
  if (!preset(id) && !state.custom.some((c) => c.id === id)) return getTheme();
  state.themeId = id;
  applyTheme();
  persist();
  emit();
  return getTheme();
}

export function resetTheme() {
  state = DEFAULT_STATE();
  applyTheme();
  persist();
  emit();
  return getTheme();
}

let customSeq = 0;
export function newCustomId() {
  customSeq += 1;
  return "custom-" + Date.now().toString(36) + "-" + customSeq.toString(36);
}

// Save (or replace) a custom theme from full light/dark token maps, and make it
// active. Returns the saved theme record.
export function saveCustomTheme({ id, name, light, dark } = {}) {
  const clean = (map) => {
    const out = {};
    for (const k of EDITABLE_TOKENS) if (isHex(map && map[k])) out[k] = map[k];
    return out;
  };
  const record = {
    id: id || newCustomId(),
    name: String(name || "Custom").trim() || "Custom",
    light: clean(light),
    dark: clean(dark),
  };
  const i = state.custom.findIndex((c) => c.id === record.id);
  if (i === -1) state.custom.push(record);
  else state.custom[i] = record;
  state.themeId = record.id;
  applyTheme();
  persist();
  emit();
  return { ...record };
}

export function deleteCustomTheme(id) {
  const before = state.custom.length;
  state.custom = state.custom.filter((c) => c.id !== id);
  if (state.themeId === id) state.themeId = DEFAULT_THEME_ID;
  if (state.custom.length !== before) {
    applyTheme();
    persist();
    emit();
  }
  return getTheme();
}

// A fresh editable token map to seed the custom editor — the current theme's
// own resolved values.
export function draftTokens(mode = resolveMode()) {
  const tokens = palettesFor(state.themeId)[mode];
  const out = {};
  for (const k of EDITABLE_TOKENS) out[k] = tokens[k];
  return out;
}

// Boot: apply the stored theme and follow the OS preference while in "system"
// mode. Safe to call once from app.js.
export function initTheme() {
  applyTheme();
  try {
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    if (mq) {
      const onChange = () => {
        if (state.mode === "system") {
          applyTheme();
          persist();
          emit();
        }
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  } catch {
    /* no matchMedia — fixed mode */
  }
  persist();
  return getTheme();
}

// The inline snippet index.html runs before first paint: read the last resolved
// token map straight from localStorage and apply it, so a dark-mode session
// never flashes the light default.
export function bootScript() {
  return (
    "(function(){try{" +
    "var r=document.documentElement,t=JSON.parse(localStorage.getItem('" +
    STORAGE_KEY +
    "')||'null');" +
    "if(t&&t.resolved&&t.resolved.tokens){var d=t.resolved;" +
    "for(var k in d.tokens)r.style.setProperty(k,d.tokens[k]);" +
    "if(d.mode){r.setAttribute('data-mode',d.mode);r.style.colorScheme=d.mode;}" +
    "}}catch(e){}})();"
  );
}

// ---------------------------------------------------------------------------
// shared UI: the appearance controls (used by Settings and the header modal)
// ---------------------------------------------------------------------------

// A two-tone swatch element for a theme card.
function swatch(pal) {
  return h("span", { class: "kb-theme-swatch", style: `--sw-bg:${pal["--bg"]};--sw-surface:${pal["--surface"]};--sw-accent:${pal["--primary"]};--sw-text:${pal["--text"]}` },
    h("span", { class: "kb-theme-swatch-bar" }),
    h("span", { class: "kb-theme-swatch-dot" }),
  );
}

// Build the whole appearance editor into `container`. `onApplied` lets callers
// refresh their own labels after a change.
export function renderThemeControls(container, { onApplied } = {}) {
  const refresh = () => {
    if (typeof onApplied === "function") onApplied();
  };

  const modeSeg = h("div", { class: "kb-seg kb-theme-seg", role: "group", "aria-label": "Colour mode" });
  const presetGrid = h("div", { class: "kb-theme-grid" });
  const customWrap = h("div", { class: "kb-theme-custom" });

  function renderMode() {
    modeSeg.replaceChildren(
      ...MODES.map((m) =>
        h("button", {
          class: "kb-seg-btn" + (getTheme().mode === m ? " active" : ""),
          type: "button",
          "aria-pressed": getTheme().mode === m ? "true" : "false",
          onClick: () => {
            setMode(m);
            renderMode();
            refresh();
          },
        }, m === "system" ? "System" : m === "dark" ? "Dark" : "Light"),
      ),
    );
  }

  function renderPresets() {
    const active = getTheme().themeId;
    const items = PRESETS.map((p) => {
      const pal = palettesFor(p.id)[getTheme().mode === "dark" || resolveMode() === "dark" ? "dark" : "light"];
      return h("button", {
        class: "kb-theme-tile" + (active === p.id ? " active" : ""),
        type: "button",
        dataset: { theme: p.id },
        title: p.name,
        "aria-pressed": active === p.id ? "true" : "false",
        onClick: () => {
          setThemeId(p.id);
          renderPresets();
          renderCustom();
          refresh();
        },
      }, swatch(pal), h("span", { class: "kb-theme-tile-name" }, p.name));
    });
    presetGrid.replaceChildren(...items);
  }

  // ---- custom editor ----
  let editMode = resolveMode(); // which palette the hex fields edit
  let editModePinned = false; // true once the user picks a palette tab manually
  let draft = { light: draftTokens("light"), dark: draftTokens("dark") };
  let name = "";
  let draftFor = null; // the themeId the draft was seeded from

  // Re-seed the draft only when the active theme changes (so switching presets
  // starts from that preset's colours, but editing never clobbers a live draft).
  function seedDraft() {
    const id = getTheme().themeId;
    if (id === draftFor) return;
    draftFor = id;
    draft = { light: draftTokens("light"), dark: draftTokens("dark") };
    const active = getTheme().custom.find((c) => c.id === id);
    name = active ? active.name : "";
  }

  function renderCustom() {
    seedDraft();
    const activeCustom = getTheme().custom.find((c) => c.id === getTheme().themeId);
    const fields = [];
    for (const g of TOKEN_GROUPS) {
      const rows = g.tokens.map((t) => {
        const value = draft[editMode][t.key];
        const color = h("input", {
          class: "kb-theme-color",
          type: "color",
          value,
          "aria-label": t.label,
          onInput: (e) => {
            const v = e.currentTarget.value;
            draft[editMode][t.key] = v;
            hex.value = v;
            preview();
          },
        });
        const hex = h("input", {
          class: "kb-input kb-theme-hex",
          type: "text",
          value,
          spellcheck: "false",
          "aria-label": t.label + " hex",
          onChange: (e) => {
            const v = e.currentTarget.value.trim();
            if (!isHex(v)) {
              e.currentTarget.value = draft[editMode][t.key];
              return;
            }
            const norm = parseHex(v) ? "#" + String(v).replace(/^#/, "").toLowerCase() : v;
            draft[editMode][t.key] = norm;
            color.value = norm;
            e.currentTarget.value = norm;
            preview();
          },
        });
        return h("div", { class: "kb-theme-field" },
          h("label", { class: "kb-theme-field-label" }, t.label),
          h("div", { class: "kb-theme-field-inputs" }, color, hex),
        );
      });
      fields.push(h("div", { class: "kb-theme-group" }, h("div", { class: "kb-theme-group-title" }, g.group), ...rows));
    }

    const nameInput = h("input", { class: "kb-input kb-theme-name", type: "text", placeholder: "Name this theme", value: name, maxlength: "40" });
    nameInput.addEventListener("input", () => { name = nameInput.value; });

    const editSeg = h("div", { class: "kb-seg kb-theme-seg" },
      ...["light", "dark"].map((m) =>
        h("button", { class: "kb-seg-btn" + (editMode === m ? " active" : ""), type: "button", onClick: () => { editMode = m; editModePinned = true; renderCustom(); } }, m === "light" ? "Light palette" : "Dark palette"),
      ),
    );

    const saved = getTheme().custom.length
      ? h("div", { class: "kb-theme-saved" },
          h("div", { class: "kb-theme-group-title" }, "Saved themes"),
          ...getTheme().custom.map((c) =>
            h("div", { class: "kb-theme-saved-row" + (getTheme().themeId === c.id ? " active" : "") },
              h("button", { class: "kb-theme-saved-name", type: "button", onClick: () => { setThemeId(c.id); renderPresets(); renderCustom(); refresh(); } }, c.name),
              h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => { deleteCustomTheme(c.id); renderPresets(); renderCustom(); refresh(); } }, "Delete"),
            ),
          ))
      : null;

    customWrap.replaceChildren(
      ...[
        h("div", { class: "kb-theme-custom-head" },
          h("div", { class: "kb-theme-group-title" }, "Custom theme"),
          h("p", { class: "kb-muted kb-theme-hint" }, "Edit any colour — type a hex code or use the picker. Your changes preview live; save them as a named theme to keep them."),
        ),
        editSeg,
        h("div", { class: "kb-theme-fields" }, ...fields),
        h("div", { class: "kb-theme-actions" },
          nameInput,
          h("button", {
            class: "kb-btn kb-btn-primary",
            type: "button",
            onClick: () => {
              const rec = saveCustomTheme({ id: activeCustom ? activeCustom.id : undefined, name: name || "Custom", light: draft.light, dark: draft.dark });
              name = rec.name;
              renderPresets();
              renderCustom();
              refresh();
            },
          }, activeCustom ? "Save changes" : "Save theme"),
          h("button", {
            class: "kb-btn kb-btn-ghost",
            type: "button",
            onClick: () => { draft = { light: draftTokens("light"), dark: draftTokens("dark") }; applyTheme(); renderCustom(); },
          }, "Reset fields"),
          h("button", {
            class: "kb-btn kb-btn-ghost",
            type: "button",
            onClick: () => { resetTheme(); editModePinned = false; renderMode(); renderPresets(); renderCustom(); refresh(); },
          }, "Restore default"),
        ),
        saved,
      ].filter(Boolean),
    );
  }

  // Live-preview an unsaved draft without persisting it, then re-apply on blur
  // is not needed — the preview IS the applied look until the user saves or
  // resets.
  function preview() {
    const pal = buildPalette(editMode, { accent: draft[editMode]["--primary"], tokens: draft[editMode] });
    applyTokens(pal, resolveMode());
    refresh();
  }

  container.append(
    h("div", { class: "kb-theme-block" },
      h("div", { class: "kb-theme-block-title" }, "Mode"),
      modeSeg,
    ),
    h("div", { class: "kb-theme-block" },
      h("div", { class: "kb-theme-block-title" }, "Preset themes"),
      presetGrid,
    ),
    customWrap,
  );

  renderMode();
  renderPresets();
  renderCustom();

  // Stay in sync when the theme changes from ANOTHER surface (the header's
  // light/dark toggle, or a second appearance editor). Our own actions also
  // emit, which simply re-renders — harmless, and seedDraft keeps any in-progress
  // custom edit intact because the theme id has not changed.
  let offChange = onThemeChange(() => {
    if (!container.isConnected) {
      if (offChange) offChange();
      offChange = null;
      return;
    }
    if (!editModePinned) editMode = resolveMode();
    renderMode();
    renderPresets();
    renderCustom();
    refresh();
  });

  return {
    refresh: () => { renderMode(); renderPresets(); renderCustom(); },
    dispose: () => { if (offChange) offChange(); offChange = null; },
  };
}
