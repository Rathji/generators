// Webuntu OS — Theme engine (Phase 1, Task 5)
// The design tokens themselves live in CSS: index.html `:root` is the dark
// Rathji theme (default) and `:root[data-theme="light"]` flips every token
// without touching layout. This module applies the persisted choice before the
// desktop shows, supports `?theme=dark|light` for testing/preview, and exposes
// a small API for the Control Center (Task 24) and power menu.

(function () {
  "use strict";

  // One-time migration: earlier builds stored data under the old "Rathbuntu" keys.
  function migrateKey(oldKey, newKey) {
    try {
      if (localStorage.getItem(newKey) == null && localStorage.getItem(oldKey) != null) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey));
      }
    } catch (e) {}
  }
  window.__migrateKey = migrateKey;
  migrateKey("rathbuntu.settings", "webuntu.settings");

  const STORAGE_KEY = "webuntu.settings";

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  function apply(name, persist) {
    const theme = name === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    if (persist) {
      try {
        const s = loadSettings();
        s.theme = theme;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch (e) {}
    }
    return theme;
  }

  function current() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }

  // ---------- accent (Task 23 base; full swatch polish is Task 24) ----------
  // The Rathji tokens are wired together: --accent (violet), --accent-rgb (for
  // rgba() glows), the focus ring, the selection tint and the gradient all use
  // the accent color, so overriding --accent alone leaves stale variants. A
  // custom accent sets them all on the document root as inline properties
  // (inline beats both theme blocks); null clears them back to the theme's
  // defaults. Persists webuntu.settings.accent.
  function hexRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function setAccent(hex, persist = true) {
    const el = document.documentElement;
    const rgb = hex ? hexRgb(hex) : null;
    if (rgb) {
      const [r, g, b] = rgb;
      el.style.setProperty("--accent", hex);
      el.style.setProperty("--accent-rgb", `${r},${g},${b}`);
      el.style.setProperty("--ring", `rgba(${r},${g},${b},.18)`);
      el.style.setProperty("--selection-bg", `rgba(${r},${g},${b},.20)`);
      el.style.setProperty("--selection-border", `rgba(${r},${g},${b},.55)`);
      // Cyan/blue-ish accents flip the secondary color back to violet so the
      // Rathji gradient stays a distinct two-tone even when accent == --accent2.
      const cyanish = r < 130 && g > 160 && b > 190;
      if (cyanish) {
        el.style.setProperty("--accent2", "#7c6cff");
        el.style.setProperty("--accent2-rgb", "124,108,255");
      } else {
        el.style.removeProperty("--accent2");
        el.style.removeProperty("--accent2-rgb");
      }
      el.style.setProperty("--grad", `linear-gradient(92deg, ${hex}, var(--accent2))`);
    } else {
      for (const p of ["--accent", "--accent-rgb", "--ring", "--selection-bg", "--selection-border", "--accent2", "--accent2-rgb", "--grad"]) {
        el.style.removeProperty(p);
      }
    }
    if (persist) {
      try {
        const s = loadSettings();
        if (hex) s.accent = hex; else delete s.accent;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch (e) {}
    }
    return rgb ? hex : null;
  }

  function getAccent() { return loadSettings().accent || null; }

  // Boot-time: query param wins (no persistence), else the stored choice,
  // else dark (the default). Read-only here — nothing is written on load.
  const qTheme = new URLSearchParams(location.search).get("theme");
  apply(qTheme === "light" || qTheme === "dark" ? qTheme : loadSettings().theme || "dark", false);
  // Stored accent (if any) also applies on load — the Control Center writes it.
  setAccent(getAccent(), false);

  window.Theme = {
    apply: (name) => apply(name, true),
    toggle: () => apply(current() === "dark" ? "light" : "dark", true),
    // setAccent(hex) persists; setAccent(hex, false) applies only (used when
    // re-applying stored settings, e.g. after a reset or at Control Center boot).
    setAccent,
    getAccent,
    get current() { return current(); },
  };
})();
