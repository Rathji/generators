// ============================================================================
//  Project U — theme engine (Phase 1 task 2 · Phase 4 task 17)
//  Semantic design tokens + named themes. The DEFAULT theme is `navy`, a
//  LIGHT-mode navy palette. `midnight` (dark) is one toggle away. Member
//  generators rebrand by overriding `--pu-primary` / `--pu-accent` (see
//  branding.js) — no CSS edits required.
// ============================================================================

export const STORAGE_KEY = "theme:v1";
export const THEME_ATTR = "data-theme";
export const MODE_ATTR = "data-mode";

// ------------------------------------------------------------- light base ---
export const LIGHT_BASE = {
  "--pu-bg": "#f4f6fb",
  "--pu-bg-alt": "#eaeef7",
  "--pu-surface": "#ffffff",
  "--pu-surface-2": "#f7f9fd",
  "--pu-surface-3": "#eef2f9",
  "--pu-border": "#dce3ef",
  "--pu-border-strong": "#c3cfe2",
  "--pu-text": "#122036",
  "--pu-text-muted": "#4c5d75",
  "--pu-text-subtle": "#78889e",
  "--pu-text-inverse": "#ffffff",
  "--pu-primary": "#1e3a8a",
  "--pu-primary-hover": "#17306f",
  "--pu-primary-active": "#122654",
  "--pu-primary-contrast": "#ffffff",
  "--pu-primary-soft": "#e6ecfb",
  "--pu-accent": "#0d9488",
  "--pu-accent-contrast": "#ffffff",
  "--pu-accent-soft": "#d9f2ef",
  "--pu-success": "#15803d",
  "--pu-success-soft": "#dcfce7",
  "--pu-success-text": "#14532d",
  "--pu-warning": "#b45309",
  "--pu-warning-soft": "#fef3c7",
  "--pu-warning-text": "#78350f",
  "--pu-danger": "#b91c1c",
  "--pu-danger-soft": "#fee2e2",
  "--pu-danger-text": "#7f1d1d",
  "--pu-info": "#0369a1",
  "--pu-info-soft": "#e0f2fe",
  "--pu-info-text": "#0c4a6e",
  "--pu-ring": "#1e3a8a",
  "--pu-header-bg": "#ffffff",
  "--pu-header-border": "#dce3ef",
  "--pu-sidebar-bg": "#fbfcfe",
  "--pu-overlay": "rgba(15,26,45,0.45)",
  "--pu-shadow-sm": "0 1px 2px rgba(16,32,54,0.06)",
  "--pu-shadow-md": "0 4px 12px rgba(16,32,54,0.10)",
  "--pu-shadow-lg": "0 12px 32px rgba(16,32,54,0.16)",
};

// -------------------------------------------------------------- dark base ---
export const DARK_BASE = {
  "--pu-bg": "#0b1220",
  "--pu-bg-alt": "#090f1b",
  "--pu-surface": "#111a2e",
  "--pu-surface-2": "#16203a",
  "--pu-surface-3": "#1b2745",
  "--pu-border": "#26324c",
  "--pu-border-strong": "#36466a",
  "--pu-text": "#e8eefb",
  "--pu-text-muted": "#a3b3ce",
  "--pu-text-subtle": "#7386a6",
  "--pu-text-inverse": "#0b1220",
  "--pu-primary": "#6d9bff",
  "--pu-primary-hover": "#8bb0ff",
  "--pu-primary-active": "#a6c4ff",
  "--pu-primary-contrast": "#08122a",
  "--pu-primary-soft": "#1b2b4d",
  "--pu-accent": "#2dd4bf",
  "--pu-accent-contrast": "#04211c",
  "--pu-accent-soft": "#123a37",
  "--pu-success": "#4ade80",
  "--pu-success-soft": "#10321f",
  "--pu-success-text": "#a7f3c5",
  "--pu-warning": "#fbbf24",
  "--pu-warning-soft": "#3a2c0b",
  "--pu-warning-text": "#fde68a",
  "--pu-danger": "#f87171",
  "--pu-danger-soft": "#3d1618",
  "--pu-danger-text": "#fecaca",
  "--pu-info": "#38bdf8",
  "--pu-info-soft": "#0d2c40",
  "--pu-info-text": "#bae6fd",
  "--pu-ring": "#6d9bff",
  "--pu-header-bg": "#0e1729",
  "--pu-header-border": "#26324c",
  "--pu-sidebar-bg": "#0d1526",
  "--pu-overlay": "rgba(3,7,15,0.6)",
  "--pu-shadow-sm": "0 1px 2px rgba(0,0,0,0.4)",
  "--pu-shadow-md": "0 6px 16px rgba(0,0,0,0.45)",
  "--pu-shadow-lg": "0 16px 40px rgba(0,0,0,0.55)",
};

export const DEFAULT_THEME = "navy";

// Named themes. `tokens` are merged over the mode's base palette.
export const THEMES = {
  navy: {
    id: "navy",
    label: "Navy",
    mode: "light",
    description: "The Project U default — deep navy on cool neutral paper.",
    swatch: ["#f4f6fb", "#1e3a8a", "#0d9488"],
    tokens: {},
  },
  sky: {
    id: "sky",
    label: "Sky",
    mode: "light",
    description: "Light palette with an azure primary and violet accent.",
    swatch: ["#f2f7fc", "#0369a1", "#6d28d9"],
    tokens: {
      "--pu-bg": "#f2f7fc",
      "--pu-bg-alt": "#e7f0f9",
      "--pu-surface-2": "#f6fafd",
      "--pu-surface-3": "#ebf3fa",
      "--pu-border": "#d6e4f0",
      "--pu-border-strong": "#b8cee2",
      "--pu-text": "#0f2536",
      "--pu-text-muted": "#426076",
      "--pu-text-subtle": "#6d879b",
      "--pu-primary": "#0369a1",
      "--pu-primary-hover": "#025684",
      "--pu-primary-active": "#014667",
      "--pu-primary-soft": "#e0f0fb",
      "--pu-accent": "#6d28d9",
      "--pu-accent-soft": "#ece2fd",
      "--pu-ring": "#0369a1",
      "--pu-sidebar-bg": "#f8fbfe",
    },
  },
  sand: {
    id: "sand",
    label: "Sand",
    mode: "light",
    description: "Warm, editorial light palette — good for service businesses.",
    swatch: ["#faf6f0", "#92400e", "#0f766e"],
    tokens: {
      "--pu-bg": "#faf6f0",
      "--pu-bg-alt": "#f3ece1",
      "--pu-surface-2": "#fdfaf6",
      "--pu-surface-3": "#f5eee4",
      "--pu-border": "#e7dccb",
      "--pu-border-strong": "#d3c2a8",
      "--pu-text": "#2b2115",
      "--pu-text-muted": "#6b5a45",
      "--pu-text-subtle": "#93816a",
      "--pu-primary": "#92400e",
      "--pu-primary-hover": "#7a350b",
      "--pu-primary-active": "#632a08",
      "--pu-primary-soft": "#f6e6d6",
      "--pu-accent": "#0f766e",
      "--pu-accent-soft": "#dbf0ed",
      "--pu-ring": "#92400e",
      "--pu-sidebar-bg": "#fdfaf5",
    },
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    description: "The Project U dark mode — deep navy black, low glare.",
    swatch: ["#0b1220", "#6d9bff", "#2dd4bf"],
    tokens: {},
  },
  slate: {
    id: "slate",
    label: "Slate",
    mode: "dark",
    description: "Neutral graphite dark palette.",
    swatch: ["#101216", "#a5b4fc", "#f0abfc"],
    tokens: {
      "--pu-bg": "#0f1116",
      "--pu-bg-alt": "#0b0d11",
      "--pu-surface": "#171a21",
      "--pu-surface-2": "#1d212a",
      "--pu-surface-3": "#242a35",
      "--pu-border": "#2c323d",
      "--pu-border-strong": "#3d4553",
      "--pu-text": "#e9ecf2",
      "--pu-text-muted": "#a4adbd",
      "--pu-text-subtle": "#767f90",
      "--pu-primary": "#a5b4fc",
      "--pu-primary-hover": "#c0c9ff",
      "--pu-primary-active": "#d6dcff",
      "--pu-primary-contrast": "#141826",
      "--pu-primary-soft": "#252a48",
      "--pu-accent": "#f0abfc",
      "--pu-accent-soft": "#3a2140",
      "--pu-ring": "#a5b4fc",
      "--pu-header-bg": "#12141a",
      "--pu-sidebar-bg": "#111318",
    },
  },
};

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}

export function themeList() {
  return Object.values(THEMES).map(({ id, label, mode, description, swatch }) => ({
    id,
    label,
    mode,
    description,
    swatch,
  }));
}

// Merge the mode base + theme overrides + branding/consumer token overrides.
export function resolveTheme(themeId, extraTokens = {}) {
  const theme = getTheme(themeId);
  const base = theme.mode === "dark" ? DARK_BASE : LIGHT_BASE;
  const tokens = { ...base, ...theme.tokens, ...pickTokenOverrides(extraTokens) };
  return { themeId: theme.id, mode: theme.mode, label: theme.label, tokens };
}

function pickTokenOverrides(extra) {
  const out = {};
  for (const [key, value] of Object.entries(extra || {})) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

// The inline script (mirrored in index.html) that paints the saved theme before
// first render, so a dark-mode session never flashes the light default. Keep
// STORAGE_KEY / payload shape in sync with createTheme().save().
export function bootScript(storageKey = `pu:${STORAGE_KEY}`) {
  return `(function(){try{var r=document.documentElement;var t=JSON.parse(localStorage.getItem(${JSON.stringify(
    storageKey
  )})||"null");if(t&&t.resolved&&t.resolved.tokens){var d=t.resolved;for(var k in d.tokens)if(Object.prototype.hasOwnProperty.call(d.tokens,k))r.style.setProperty(k,d.tokens[k]);if(d.mode){r.setAttribute("data-mode",d.mode);r.style.colorScheme=d.mode;}if(d.themeId)r.setAttribute("data-theme",d.themeId);}}catch(e){}})();`;
}

export function createTheme(options = {}) {
  const {
    storage = null,
    storageKey = STORAGE_KEY,
    defaultTheme = DEFAULT_THEME,
    extraTokens = () => ({}),
    target = null,
  } = options;

  let state = load();
  const subscribers = new Set();

  function load() {
    const saved = storage ? storage.get(storageKey, null) : null;
    const themeId = saved && THEMES[saved.themeId] ? saved.themeId : defaultTheme;
    const prefers = {
      light: saved && saved.preferred && THEMES[saved.preferred.light] ? saved.preferred.light : "navy",
      dark: saved && saved.preferred && THEMES[saved.preferred.dark] ? saved.preferred.dark : "midnight",
    };
    return { themeId, preferred: prefers };
  }

  function persist() {
    if (!storage) return;
    storage.set(storageKey, { themeId: state.themeId, preferred: state.preferred, resolved: resolved() });
  }

  function resolved() {
    return resolveTheme(state.themeId, extraTokens());
  }

  function apply() {
    const { tokens, mode, themeId } = resolved();
    const root = target || document.documentElement;
    for (const [token, value] of Object.entries(tokens)) root.style.setProperty(token, value);
    root.setAttribute(MODE_ATTR, mode);
    root.setAttribute(THEME_ATTR, themeId);
    if (root === document.documentElement) root.style.colorScheme = mode;
    const meta = typeof document !== "undefined" ? document.querySelector('meta[name="theme-color"]') : null;
    if (meta) meta.setAttribute("content", tokens["--pu-header-bg"] || tokens["--pu-bg"]);
    persist();
    notify();
    return { themeId, mode, tokens };
  }

  function notify() {
    const snapshot = get();
    for (const handler of subscribers) {
      try {
        handler(snapshot);
      } catch (error) {
        console.error("[pu:theme] subscriber threw", error);
      }
    }
  }

  function get() {
    const theme = getTheme(state.themeId);
    return {
      themeId: theme.id,
      label: theme.label,
      mode: theme.mode,
      description: theme.description,
      preferred: { ...state.preferred },
    };
  }

  function set(themeId) {
    if (!THEMES[themeId]) {
      console.warn(`[pu:theme] unknown theme "${themeId}"`);
      return get();
    }
    state.themeId = themeId;
    state.preferred[getTheme(themeId).mode] = themeId;
    apply();
    return get();
  }

  function setMode(mode) {
    const target = mode === "dark" ? "dark" : "light";
    return set(current(mode) ? state.themeId : state.preferred[target]);
  }

  function current(mode) {
    return getTheme(state.themeId).mode === mode;
  }

  function toggleMode() {
    return setMode(current("dark") ? "light" : "dark");
  }

  function reset() {
    state = { themeId: defaultTheme, preferred: { light: "navy", dark: "midnight" } };
    apply();
    return get();
  }

  function subscribe(handler, opts = {}) {
    subscribers.add(handler);
    if (opts.immediate) handler(get());
    return () => subscribers.delete(handler);
  }

  return { get, set, setMode, toggleMode, reset, apply, subscribe, resolved, list: themeList, get tokens() { return resolved().tokens; } };
}
