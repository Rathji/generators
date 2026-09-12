// src/modules/theme-view.js — the Appearance & theme card (Settings station).
//
// Hosts the theme engine's shared controls (src/framework/theme.js): the
// light/dark/system mode switch, the preset theme grid, and the custom theme
// editor where a user can set any colour by hex code or picker, preview it
// live, and save it under a name. The header also carries a quick light/dark
// toggle — both surfaces go through the same engine, so they never disagree.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { renderThemeControls, getTheme, PRESETS } from "../framework/theme.js";

function cardHead(icon, title, badge) {
  return h(
    "div",
    { class: "kb-section-head" },
    h("span", { class: "kb-section-icon", html: icon }),
    h("h2", { class: "kb-section-name" }, title),
    badge ? (typeof badge === "string" ? h("span", { class: "kb-count-pill" }, badge) : badge) : null,
  );
}

// The human name of the active theme — a preset's name, a saved custom theme's
// name, or a fallback.
function themeName(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (p) return p.name;
  const c = getTheme().custom.find((x) => x.id === id);
  return c ? c.name : "Custom";
}

export function renderAppearanceCard() {
  const badge = h("span", { class: "kb-count-pill" });
  const body = h("div", { class: "kb-theme-body" });

  const syncBadge = () => {
    const t = getTheme();
    badge.textContent = themeName(t.themeId) + " · " + t.resolvedMode;
  };
  renderThemeControls(body, { onApplied: syncBadge });
  syncBadge();

  return h(
    "section",
    { class: "kb-card kb-settings-card", dataset: { card: "appearance" } },
    cardHead(icons.palette, "Appearance & theme", badge),
    h(
      "p",
      { class: "kb-muted" },
      "Choose the colour mode and theme for this workspace. Presets ship with IT-U and apply instantly; you can also author your own by editing any colour — type a hex code or use the picker — and save it under a name. Themes are stored on this device, so each device can keep its own.",
    ),
    body,
  );
}
