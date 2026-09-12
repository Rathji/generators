// ============================================================================
//  Project U — shared view helpers
//  Small building blocks that keep every view visually and structurally
//  consistent (page headers, cards, demo rows, empty states, stat tiles).
// ============================================================================

import { h, svgIcon } from "../framework/dom.js";
import { cx } from "../framework/utils.js";

export function pageHeader({ title, subtitle, actions = null, icon = null }) {
  return h(
    "header",
    { class: "pu-page-head" },
    h(
      "div",
      { class: "pu-page-head-text" },
      h("h1", { class: "pu-page-title" }, icon ? svgIcon(icon, { size: 22, className: "pu-page-title-icon" }) : null, title),
      subtitle ? h("p", { class: "pu-page-subtitle" }, subtitle) : null
    ),
    actions ? h("div", { class: "pu-page-actions" }, actions) : null
  );
}

export function card({ title, subtitle, actions = null, body = null, className = "", padded = true, id = null }) {
  return h(
    "section",
    { class: cx("pu-card", padded && "pu-card--padded", className), id },
    title || subtitle || actions
      ? h(
          "div",
          { class: "pu-card-head" },
          h("div", {}, title ? h("h2", { class: "pu-card-title" }, title) : null, subtitle ? h("p", { class: "pu-card-subtitle" }, subtitle) : null),
          actions ? h("div", { class: "pu-card-actions" }, actions) : null
        )
      : null,
    body
  );
}

export function demoRow({ label, control, hint = null }) {
  return h(
    "div",
    { class: "pu-demo-row" },
    h("div", { class: "pu-demo-label" }, h("span", {}, label), hint ? h("span", { class: "pu-demo-hint" }, hint) : null),
    h("div", { class: "pu-demo-control" }, control)
  );
}

export function statTile({ label, value, hint = null, icon = null, tone = null }) {
  return h(
    "div",
    { class: cx("pu-stat", tone && `pu-stat--${tone}`) },
    h("div", { class: "pu-stat-top" }, icon ? svgIcon(icon, { size: 16, className: "pu-stat-icon" }) : null, h("span", { class: "pu-stat-label" }, label)),
    h("div", { class: "pu-stat-value" }, value),
    hint ? h("div", { class: "pu-stat-hint" }, hint) : null
  );
}

export function codeBlock(text, { label = null } = {}) {
  const pre = h("pre", { class: "pu-code" }, h("code", {}, text));
  return label ? h("div", { class: "pu-code-wrap" }, h("span", { class: "pu-code-label" }, label), pre) : pre;
}

export function emptyState({ icon = "box", title, message, action = null }) {
  return h(
    "div",
    { class: "pu-empty" },
    h("span", { class: "pu-empty-icon" }, svgIcon(icon, { size: 26 })),
    h("h3", { class: "pu-empty-title" }, title),
    message ? h("p", { class: "pu-empty-msg" }, message) : null,
    action
  );
}

export function badge(text, tone = "neutral", { icon = null } = {}) {
  return h(
    "span",
    { class: cx("pu-badge", `pu-badge--${tone}`) },
    icon ? svgIcon(icon, { size: 12 }) : null,
    text
  );
}

export function grid(children, { cols = 2, gap = "md", className = "" } = {}) {
  return h("div", { class: cx("pu-grid", `pu-grid--${cols}`, `pu-gap-${gap}`, className) }, children);
}

// Map a banner tone to a real icon so a tone like "danger" never renders an
// empty <svg>. An explicit `icon` still wins.
const BANNER_ICONS = { info: "info", success: "check", warning: "warning", danger: "error" };

export function banner({ tone = "info", title, children, icon }) {
  return h(
    "div",
    { class: cx("pu-banner", `pu-banner--${tone}`) },
    svgIcon(icon || BANNER_ICONS[tone] || "info", { size: 18, className: "pu-banner-icon" }),
    h("div", { class: "pu-banner-body" }, title ? h("strong", {}, title) : null, children ? h("p", {}, children) : null)
  );
}
