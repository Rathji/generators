// ============================================================================
//  Validation tests — theming engine + branding (Phase 1 task 2 · Phase 4 tasks 16-17)
// ============================================================================

import { createSuite, assert, assertEqual } from "./harness.js";
import { THEMES, LIGHT_BASE, DARK_BASE, DEFAULT_THEME, resolveTheme, themeList, createTheme } from "../framework/theme.js";
import { createBranding, contrastText, mix } from "../framework/branding.js";
import { createStorage } from "../framework/storage.js";

function fakeBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

export function themeSuite() {
  return createSuite("theme · tokens, palettes, branding")
    .test("navy is the light-mode default", () => {
      assertEqual(DEFAULT_THEME, "navy");
      assertEqual(THEMES.navy.mode, "light");
      const resolved = resolveTheme(DEFAULT_THEME);
      assertEqual(resolved.mode, "light");
      assertEqual(resolved.themeId, "navy");
    })
    .test("every theme resolves a complete token set", () => {
      const required = Object.keys(LIGHT_BASE);
      for (const theme of themeList()) {
        const { tokens } = resolveTheme(theme.id);
        for (const key of required) {
          assert(tokens[key], `${theme.id} is missing ${key}`);
        }
        assertEqual(theme.swatch.length, 3, `${theme.id} needs a 3-colour swatch`);
      }
    })
    .test("light and dark palettes are distinct", () => {
      const light = resolveTheme("navy").tokens;
      const dark = resolveTheme("midnight").tokens;
      assertEqual(light["--pu-bg"], LIGHT_BASE["--pu-bg"]);
      assertEqual(dark["--pu-bg"], DARK_BASE["--pu-bg"]);
      assert(light["--pu-text"] !== dark["--pu-text"]);
    })
    .test("unknown themes fall back to the default", () => {
      assertEqual(resolveTheme("does-not-exist").themeId, "navy");
    })
    .test("theme controller persists and toggles modes", () => {
      const storage = createStorage({ namespace: "t", backend: fakeBackend() });
      const target = document.createElement("div");
      const theme = createTheme({ storage, target });
      assertEqual(theme.get().themeId, "navy");
      assertEqual(theme.get().mode, "light");

      theme.set("sky");
      assertEqual(target.getAttribute("data-theme"), "sky");
      assertEqual(target.getAttribute("data-mode"), "light");
      assertEqual(storage.get("theme:v1").themeId, "sky");

      theme.toggleMode();
      assertEqual(theme.get().mode, "dark");
      assertEqual(theme.get().themeId, "midnight");
      theme.toggleMode();
      assertEqual(theme.get().themeId, "sky", "toggling back returns to the preferred light theme");

      theme.reset();
      assertEqual(theme.get().themeId, "navy");
    })
    .test("branding overrides feed the theme tokens", () => {
      const branding = createBranding({}, { config: { appTitle: "Acme" } });
      assertEqual(branding.get().appTitle, "Acme");

      const custom = createBranding({ primary: "#ff8800", accent: "#00b0ff" });
      const tokens = custom.tokens();
      assertEqual(tokens["--pu-primary"], "#ff8800");
      assertEqual(tokens["--pu-accent"], "#00b0ff");
      assert(tokens["--pu-primary-soft"].includes("color-mix"));

      const resolved = resolveTheme("navy", custom.tokens());
      assertEqual(resolved.tokens["--pu-primary"], "#ff8800");
      assert(resolved.tokens["--pu-primary-soft"].includes("color-mix"));
    })
    .test("invalid colours are ignored, not applied", () => {
      const branding = createBranding({ primary: "not-a-colour" });
      assert(!branding.tokens()["--pu-primary"], "invalid hex must not produce a token");
    })
    .test("colour helpers compute contrast and mixing", () => {
      assertEqual(contrastText("#ffffff"), "#0b1220");
      assertEqual(contrastText("#000000"), "#ffffff");
      assertEqual(mix("#000000", "#ffffff", 0.5), "#808080");
    })
    .test("theme data is exposed on the runtime namespace", () => {
      assert(THEMES.navy && THEMES.midnight);
      assertEqual(typeof createTheme, "function");
    });
}
