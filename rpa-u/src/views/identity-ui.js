import { el } from "../framework/dom.js";
import { roleLabel, roleRank, RBAC_ROLES } from "../core/identity/rbac.js";

export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function roleChip(id) {
  const role = RBAC_ROLES[id];
  const label = role ? role.label : roleLabel(id);
  const chip = el("span.pu-chip", { class: role ? `pu-role pu-role-${id}` : "pu-role", text: label });
  chip.setAttribute("data-rank", String(role ? role.rank : 0));
  return chip;
}

export function rolePills(roles) {
  const wrap = el("div.pu-chips");
  if (!roles || !roles.length) {
    wrap.appendChild(el("span.pu-chip.warn", { text: "No role" }));
    return wrap;
  }
  const sorted = roles.slice().sort((a, b) => roleRank(b) - roleRank(a));
  for (const id of sorted) wrap.appendChild(roleChip(id));
  return wrap;
}

export function connectivityChip(hub) {
  const state = hub.auth.connectivity();
  const map = {
    connected: { tone: "ok", label: "Connected" },
    offline: { tone: "fail", label: "Offline" },
    degraded: { tone: "warn", label: "Degraded" },
    unconfigured: { tone: "", label: "Demo directory" },
    unknown: { tone: "", label: "Unknown" },
  };
  const info = map[state.status] || map.unknown;
  const chip = el("span.pu-chip", { class: info.tone, text: info.label });
  if (state.latencyMs != null) chip.appendChild(el("span.pu-small.pu-muted", { text: ` · ${state.latencyMs}ms` }));
  return chip;
}

export function identityIndicator(hub, { onSignOut = null, onOpen = null } = {}) {
  const snap = hub.auth.snapshot();
  const wrap = el("div.pu-identity-inline");
  if (!snap.authenticated) {
    wrap.appendChild(el("span.pu-chip", { text: snap.status === "authenticating" ? "Signing in…" : "Signed out" }));
    return wrap;
  }
  const button = el("button.pu-user-chip", { type: "button", title: "Identity & access" });
  button.appendChild(el("span.pu-avatar", { text: initialsOf(snap.user && snap.user.name) }));
  const meta = el("span.pu-user-meta");
  meta.appendChild(el("span.pu-user-name", { text: (snap.user && snap.user.name) || "Signed-in user" }));
  meta.appendChild(el("span.pu-user-role", { text: snap.highestRoleLabel || "No role" }));
  button.appendChild(meta);
  if (onOpen) button.addEventListener("click", onOpen);
  wrap.appendChild(button);
  if (onSignOut) {
    const out = el("button.pu-icon-btn.pu-signout", { type: "button", title: "Sign out", "aria-label": "Sign out" });
    out.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
    out.addEventListener("click", onSignOut);
    wrap.appendChild(out);
  }
  return wrap;
}
