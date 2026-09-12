// src/tests/theme.test.js — validation tests for the appearance system
// (src/framework/theme.js and src/modules/theme-view.js).
// Run in the live page:
//   await import("./src/tests/theme.test.js").then((m) => m.run())
//
// Covers: the colour helpers (parse/format/mix/luminance/contrast/readable ink);
// buildPalette completeness and validity for every preset in both modes; the
// editable-token catalog; applyTokens writing inline custom properties + the
// mode attribute; mode/theme mutations (set/toggle/reset) and their persistence;
// the custom-theme save/list/delete/apply round-trip; and the shared controls'
// DOM (mode switch, preset grid, hex + picker fields, save, saved list).

import { runTests, assert, assertEq } from "./harness.js";
import * as theme from "../framework/theme.js";
import { renderAppearanceCard } from "../modules/theme-view.js";

const CORE_TOKENS = [
  "--primary", "--primary-strong", "--primary-soft",
  "--bg", "--surface", "--surface-2", "--border",
  "--text", "--muted", "--muted-2",
  "--success", "--success-soft", "--warning", "--warning-soft", "--danger", "--danger-soft",
];
const DERIVED = ["--primary-grad", "--on-primary", "--primary-border", "--warning-tint", "--overlay", "--toast-bg", "--toast-text"];
const HEX = /^#[0-9a-f]{6}$/;

const isPlainHex = (v) => typeof v === "string" && (HEX.test(v) || /^#[0-9a-f]{3}$/.test(v));

function q(sel, root = document) { return root.querySelector(sel); }
function qa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export async function run() {
  const results = await runTests([
    {
      name: "colour helpers parse and round-trip hex",
      fn: async () => {
        assertEq(theme.isHex("#3b5bdb"), true);
        assertEq(theme.isHex("#abc"), true);
        assertEq(theme.isHex("nope"), false);
        assertEq(theme.isHex(""), false);
        const c = theme.parseHex("#3b5bdb");
        assertEq(c.r, 0x3b); assertEq(c.g, 0x5b); assertEq(c.b, 0xdb);
        assertEq(theme.toHex(c), "#3b5bdb");
        assertEq(theme.toHex(theme.parseHex("abc")), "#aabbcc");
      },
    },
    {
      name: "mix, lighten and darken interpolate",
      fn: async () => {
        assertEq(theme.mix("#000000", "#ffffff", 0.5), "#808080");
        assertEq(theme.mix("#000000", "#ffffff", 0), "#000000");
        assertEq(theme.mix("#000000", "#ffffff", 1), "#ffffff");
        assertEq(theme.lighten("#000000", 0.5), "#808080");
        assertEq(theme.darken("#ffffff", 0.5), "#808080");
      },
    },
    {
      name: "luminance, contrast and readable ink are correct",
      fn: async () => {
        assertEq(Math.round(theme.luminance("#000000") * 100), 0);
        assertEq(Math.round(theme.luminance("#ffffff") * 100), 100);
        assert(theme.contrastRatio("#000000", "#ffffff") > 20, "black on white is max contrast");
        assertEq(theme.readableOn("#ffffff"), "#0b1220", "dark ink on white");
        assertEq(theme.readableOn("#000000"), "#ffffff", "light ink on black");
      },
    },
    {
      name: "buildPalette returns a complete valid palette for every preset and mode",
      fn: async () => {
        assert(theme.PRESETS.length >= 12, "there is a library of presets");
        for (const p of theme.PRESETS) {
          for (const mode of ["light", "dark"]) {
            const pal = theme.buildPalette(mode, p);
            for (const k of CORE_TOKENS) assert(isPlainHex(pal[k]), `preset ${p.id}/${mode} missing ${k}`);
            for (const k of DERIVED) assert(typeof pal[k] === "string" && pal[k].length, `preset ${p.id}/${mode} missing ${k}`);
            assertEq(pal["--mode"], mode);
          }
        }
      },
    },
    {
      name: "every preset resolves to distinct light and dark palettes",
      fn: async () => {
        for (const p of theme.PRESETS) {
          const pal = theme.presetPalettes(p.id);
          assert(pal, "palettes for " + p.id);
          assert(pal.light["--bg"] !== pal.dark["--bg"], p.id + " light/dark backgrounds differ");
        }
        assertEq(theme.preset("does-not-exist"), null);
        assertEq(theme.presetPalettes("does-not-exist"), null);
      },
    },
    {
      name: "the editable-token catalog is consistent",
      fn: async () => {
        assertEq(theme.EDITABLE_TOKENS.length, 16);
        for (const k of theme.EDITABLE_TOKENS) assert(theme.TOKEN_GROUPS.some((g) => g.tokens.some((t) => t.key === k)), "grouped: " + k);
        assertEq(theme.tokenLabel("--primary"), "Accent");
        assertEq(theme.tokenLabel("--unknown"), "--unknown");
      },
    },
    {
      name: "applyTokens writes inline properties and the mode attribute",
      fn: async () => {
        const pal = theme.buildPalette("dark", theme.preset("ocean"));
        theme.applyTokens(pal, "dark");
        const root = document.documentElement;
        assertEq(root.getAttribute("data-mode"), "dark");
        assertEq(root.style.getPropertyValue("--primary").trim(), pal["--primary"]);
        assertEq(root.style.getPropertyValue("--bg").trim(), pal["--bg"]);
      },
    },
    {
      name: "setMode / toggleMode / setThemeId drive state and the DOM",
      fn: async () => {
        theme.setMode("dark");
        assertEq(theme.getTheme().mode, "dark");
        assertEq(theme.resolveMode(), "dark");
        assertEq(document.documentElement.getAttribute("data-mode"), "dark");
        theme.toggleMode();
        assertEq(theme.resolveMode(), "light");
        theme.setMode("light");
        assertEq(theme.setThemeId("emerald").themeId, "emerald");
        assertEq(document.documentElement.style.getPropertyValue("--primary").trim(), theme.getTheme() && theme.presetPalettes("emerald").light["--primary"]);
        assertEq(theme.setThemeId("not-a-theme").themeId, "emerald", "an unknown id is ignored");
      },
    },
    {
      name: "custom themes save, apply, persist and delete",
      fn: async () => {
        const light = theme.draftTokens("light");
        light["--primary"] = "#ff0066";
        light["--bg"] = "#fff5f8";
        const dark = theme.draftTokens("dark");
        dark["--primary"] = "#ff4d94";
        const saved = theme.saveCustomTheme({ name: "Test Rose", light, dark });
        assertEq(saved.name, "Test Rose");
        assertEq(theme.getTheme().themeId, saved.id, "a saved theme becomes active");
        assert(theme.getTheme().isCustom, "the active theme is custom");
        assertEq(theme.activeTokens()["--primary"], theme.resolveMode() === "dark" ? "#ff4d94" : "#ff0066");
        const persisted = JSON.parse(localStorage.getItem(theme.STORAGE_KEY));
        assert(persisted.custom.some((c) => c.id === saved.id), "custom theme persisted");
        assertEq(theme.deleteCustomTheme(saved.id).custom.length, theme.getTheme().custom.length);
        assert(!theme.getTheme().custom.some((c) => c.id === saved.id), "custom theme deleted");
        assertEq(theme.getTheme().themeId, theme.DEFAULT_THEME_ID, "falls back to the default after delete");
      },
    },
    {
      name: "resetTheme restores the shipped default",
      fn: async () => {
        theme.setThemeId("ocean");
        const t = theme.resetTheme();
        assertEq(t.mode, "system");
        assertEq(t.themeId, theme.DEFAULT_THEME_ID);
        assertEq(t.custom.length, 0);
        assertEq(document.documentElement.getAttribute("data-mode"), theme.resolveMode());
      },
    },
    {
      name: "renderThemeControls builds the mode switch, preset grid and editor",
      fn: async () => {
        theme.setMode("light");
        theme.resetTheme();
        const host = document.createElement("div");
        theme.renderThemeControls(host);
        assertEq(qa(".kb-seg-btn", host).length >= 3, true, "mode buttons rendered");
        assertEq(qa(".kb-theme-tile", host).length, theme.PRESETS.length, "a tile per preset");
        assertEq(qa(".kb-theme-color", host).length, 16, "a colour picker per editable token");
        assertEq(qa(".kb-theme-hex", host).length, 16, "a hex field per editable token");
        const saveBtn = qa("button", host).find((b) => /Save (theme|changes)/.test(b.textContent));
        assert(saveBtn, "a save button exists");
      },
    },
    {
      name: "the controls apply a preset and save a custom theme",
      fn: async () => {
        theme.resetTheme();
        theme.setMode("light");
        const host = document.createElement("div");
        theme.renderThemeControls(host);
        const tile = q(".kb-theme-tile[data-theme='violet']", host);
        assert(tile, "violet tile present");
        tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        assertEq(theme.getTheme().themeId, "violet", "clicking a preset applies it");
        // Edit a colour by hex, then save it as a named custom theme.
        const hex = q(".kb-theme-hex", host);
        hex.value = "#123456";
        hex.dispatchEvent(new Event("change", { bubbles: true }));
        const nameInput = q(".kb-theme-name", host);
        nameInput.value = "From the DOM";
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        const saveBtn = qa("button", host).find((b) => /Save (theme|changes)/.test(b.textContent));
        saveBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const custom = theme.getTheme().custom.find((c) => c.name === "From the DOM");
        assert(custom, "the edited theme was saved");
        assertEq(custom.light["--primary"], "#123456", "the hex edit reached the saved light palette");
        assert(q(".kb-theme-saved-row", host), "the saved theme is listed");
      },
    },
    {
      name: "renderAppearanceCard mounts the controls in a settings card",
      fn: async () => {
        theme.resetTheme();
        const card = renderAppearanceCard({}, {}, () => {});
        assertEq(card.dataset.card, "appearance");
        assert(q(".kb-section-name", card), "card has a title");
        assert(q(".kb-theme-seg", card), "card hosts the theme controls");
        assert(q(".kb-theme-grid", card), "card hosts the preset grid");
      },
    },
  ]);
  // Leave the app on a clean default so the tests never strand a test theme.
  try { theme.resetTheme(); } catch { /* ignore */ }
  return results;
}
