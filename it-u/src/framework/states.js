// src/framework/states.js — the app's ONE consistent set of
// empty / loading / error states. Every module and component uses these,
// so the whole app feels the same whether it's waiting, showing nothing,
// or recovering from a failure.

import { h } from "./dom.js";
import { icons } from "./icons.js";

export function stateCard({ variant = "empty", icon = "", title = "", description = "", action = null } = {}) {
  const cls =
    "kb-state" +
    (variant === "loading" ? " kb-state-loading" : "") +
    (variant === "error" ? " kb-state-error" : "");
  return h(
    "div",
    { class: cls, role: "status" },
    h("div", { class: "kb-state-icon", html: variant === "loading" ? "" : icon || icons.check },
      variant === "loading" ? h("span", { class: "spinner" }) : null,
    ),
    h("div", { class: "kb-state-title" }, title),
    description ? h("div", { class: "kb-state-desc" }, description) : null,
    action ? h("div", { class: "kb-state-action" }, action) : null,
  );
}

export function loadingState({ label = "Loading…" } = {}) {
  return stateCard({ variant: "loading", title: label });
}

export function emptyState({ title = "Nothing here yet", description = "", icon = icons.check, action = null } = {}) {
  return stateCard({ variant: "empty", icon, title, description, action });
}

export function errorState({
  title = "Something went wrong",
  description = "",
  onRetry = null,
  retryLabel = "Try again",
} = {}) {
  const action = onRetry
    ? h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: onRetry }, retryLabel)
    : null;
  return stateCard({ variant: "error", icon: icons.alert, title, description, action });
}
