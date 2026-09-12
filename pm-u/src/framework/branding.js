// ============================================================================
//  Project U — branding configuration (Phase 4, task 16)
//  One object member generators override to rebrand the whole framework:
//  colours, logo, naming, footer. Colours are converted into semantic theme
//  token overrides (Phase 4, task 17) so nothing else needs to change.
// ============================================================================

import { deepMerge } from "./utils.js";

export const DEFAULT_BRANDING = {
  companyName: "Project U",
  appTitle: "Template-U",
  appShortTitle: "TU",
  tagline: "The Project U shared framework",
  logoMark: "TU",
  logoUrl: "",
  primary: "",
  accent: "",
  fontSans: "Inter",
  footer: "Project U",
  version: "0.1.0",
};

// ------------------------------------------------------------- colour math ---

function normalizeHex(value) {
  let hex = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return `#${hex.toLowerCase()}`;
}

function hexToRgb(hex) {
  const value = normalizeHex(hex);
  if (!value) return null;
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const part = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function mix(colorA, colorB, weight = 0.5) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  if (!a || !b) return normalizeHex(colorA) || normalizeHex(colorB) || "";
  return rgbToHex({
    r: a.r + (b.r - a.r) * weight,
    g: a.g + (b.g - a.g) * weight,
    b: a.b + (b.b - a.b) * weight,
  });
}

export function luminance(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastText(color) {
  return luminance(color) > 0.5 ? "#0b1220" : "#ffffff";
}

// ------------------------------------------------------------- controller ---

export function createBranding(overrides = {}, options = {}) {
  const { config = {} } = options;

  function normalizeInput(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const key of Object.keys(DEFAULT_BRANDING)) {
      const value = input[key];
      if (value == null) continue;
      const str = String(value).trim();
      if (str) out[key] = str;
    }
    return out;
  }

  // Base precedence: defaults < main.pjs `pu.branding` < main.pjs top-level
  // naming values < runtime/stored overrides (applied last so they win).
  const base = deepMerge(DEFAULT_BRANDING, normalizeInput(config.branding));
  for (const key of ["appTitle", "appShortTitle", "tagline", "logoMark", "companyName", "version"]) {
    const value = config[key];
    if (value == null) continue;
    const str = String(value).trim();
    if (str) base[key] = str;
  }
  if (config.footer) base.footer = String(config.footer).trim();
  const stored = deepMerge(base, normalizeInput(overrides));

  function get() {
    return { ...stored };
  }

  // Branding → theme token overrides (consumed by theme.resolveTheme()).
  function tokens() {
    const out = {};
    const primary = normalizeHex(stored.primary);
    if (primary) {
      out["--pu-primary"] = primary;
      out["--pu-primary-hover"] = mix(primary, "#000000", 0.14);
      out["--pu-primary-active"] = mix(primary, "#000000", 0.26);
      out["--pu-primary-contrast"] = contrastText(primary);
      out["--pu-primary-soft"] = `color-mix(in srgb, ${primary} 14%, var(--pu-surface))`;
      out["--pu-ring"] = primary;
    }
    const accent = normalizeHex(stored.accent);
    if (accent) {
      out["--pu-accent"] = accent;
      out["--pu-accent-contrast"] = contrastText(accent);
      out["--pu-accent-soft"] = `color-mix(in srgb, ${accent} 16%, var(--pu-surface))`;
    }
    if (stored.fontSans) out["--pu-font-sans"] = `"${stored.fontSans}", system-ui, sans-serif`;
    return out;
  }

  function applyTo(doc = document) {
    const data = get();
    const root = doc.documentElement;
    for (const [token, value] of Object.entries(tokens())) root.style.setProperty(token, value);
    if (data.appTitle) doc.title = `${data.appTitle} — ${data.tagline || data.companyName}`;
    const setText = (id, value) => {
      const el = doc.getElementById(id);
      if (el && value) el.textContent = value;
    };
    setText("puAppTitle", data.appTitle);
    setText("puTagline", data.tagline);
    setText("puLogoMark", data.logoMark || data.appShortTitle);
    setText("puSidebarFoot", data.footer);
    const mark = doc.getElementById("puLogoMark");
    if (mark && data.logoUrl) {
      mark.textContent = "";
      mark.style.backgroundImage = `url("${data.logoUrl}")`;
      mark.classList.add("pu-logo-mark--image");
    }
    return data;
  }

  function update(partial) {
    Object.assign(stored, normalizeInput(partial));
    applyTo();
    return get();
  }

  return { get, tokens, applyTo, update, defaults: { ...DEFAULT_BRANDING } };
}
