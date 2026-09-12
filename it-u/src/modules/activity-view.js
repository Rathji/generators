// src/modules/activity-view.js — the Activity & rate-control working surface
// (roadmap task 56).
//
// The Settings station hosts this card. It shows the multi-user picture for a
// hub-connected repository:
//   • who is connected right now, their role and the coarse network they are on;
//   • how the server's rate limiter is loaded, by activity and by network;
//   • the durable AUDIT TRAIL — every sign-in, role change, published change and
//     allowed/denied action — with the actor the SERVER recorded, so a remote
//     change is attributed to the person who really made it.
//
// Everything degrades gracefully: offline or signed out it says so, and a
// signed-in non-administrator is told the trail is administrator-only (the
// server refuses the read regardless of what this card shows).

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { relTime } from "./shared.js";
import {
  AUDIT_GROUPS,
  classifyAudit,
  describeAudit,
  filterAudit,
  summarizeAudit,
  rateSummary,
  networkLabel,
} from "../framework/audit.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

function cardHead(icon, title, badge) {
  return h(
    "div",
    { class: "kb-section-head" },
    h("span", { class: "kb-section-icon", html: icon }),
    h("h2", { class: "kb-section-name" }, title),
    badge ? h("span", { class: "kb-count-pill" }, badge) : null,
  );
}

export function renderActivityCard(ctx, data = {}, reload) {
  const body = h("div", { class: "kb-audit-body" });
  const card = h(
    "section",
    { class: "kb-card kb-settings-card", dataset: { card: "activity" } },
    cardHead(icons.history, "Activity & rate control", null),
    h(
      "p",
      { class: "kb-muted" },
      "Who is connected, how the hub is limiting traffic, and the durable trail of every sign-in, role change, published change and allowed or denied action. The server records the actor, so a change made on another session is attributed to the person who really made it.",
    ),
    body,
  );
  paint(ctx, body, reload);
  return card;
}

async function paint(ctx, body, reload) {
  const hub = ctx.hub;
  const me = whoami(ctx);
  clear(body);

  if (!hub || !hub.connected) {
    body.append(h("p", { class: "kb-muted kb-audit-note" }, "The realtime hub is offline, so this is a single-user repository — there is no shared activity or rate limiting to show. Connect a hub and sign in to see the audit trail."));
    return;
  }
  if (!hub.authenticated) {
    body.append(h("p", { class: "kb-muted kb-audit-note" }, "Sign in to a hub account to see the activity and rate-control picture."));
    return;
  }
  if (!hub.isAdmin) {
    body.append(h("p", { class: "kb-muted kb-audit-note" }, "The audit trail and the connection list are administrator-only. Your own activity is still recorded server-side."));
    return;
  }

  body.append(h("p", { class: "kb-muted kb-audit-note" }, "Loading activity…"));
  let audit = { records: [], max: 0 };
  let sessions = { sessions: [], online: 0 };
  let stats = null;
  try {
    [audit, sessions, stats] = await Promise.all([hub.audit({ limit: 200 }), hub.sessions(), hub.rateStats()]);
  } catch (e) {
    clear(body);
    body.append(h("p", { class: "kb-form-error" }, String((e && e.message) || e)));
    return;
  }
  clear(body);

  body.append(sessionsBlock(sessions, me));
  body.append(rateBlock(stats));
  body.append(trailBlock(audit, reload));
}

// ---- live sessions ---------------------------------------------------------
function sessionsBlock({ sessions, online }, me) {
  const list = h("div", { class: "kb-session-list" });
  if (!sessions.length) {
    list.append(h("p", { class: "kb-muted" }, "No one is connected."));
  } else {
    for (const s of sessions) list.append(sessionRow(s, me));
  }
  const byNet = summarizeNetworks(sessions);
  return h(
    "div",
    { class: "kb-audit-section" },
    h(
      "div",
      { class: "kb-audit-section-head" },
      h("span", { class: "kb-subhead" }, "Connected now"),
      h("span", { class: "kb-count-pill" }, String(online != null ? online : sessions.length)),
    ),
    list,
    byNet.length > 1 ? h("p", { class: "kb-audit-netnote" }, "Across " + byNet.length + " networks: " + byNet.map((n) => n.label + " (" + n.connections + ")").join(", ")) : null,
  );
}

function sessionRow(s, me) {
  return h(
    "div",
    { class: "kb-session-row" + (s.isAdmin ? " kb-session-row--admin" : "") },
    h("span", { class: "kb-avatar" }, (s.username || "?").slice(0, 2).toUpperCase()),
    h(
      "div",
      { class: "kb-session-id" },
      h("span", { class: "kb-session-name" }, s.username === me ? s.username + " (you)" : s.username),
      h(
        "span",
        { class: "kb-session-meta" },
        h("span", { class: "kb-role-chip kb-role-chip--" + (s.isAdmin ? "administrator" : s.role || "viewer") }, s.isAdmin ? "Administrator" : capitalize(s.role)),
        s.cat ? h("span", { class: "kb-audit-scope" }, s.cat) : null,
      ),
    ),
    h("span", { class: "kb-audit-net", title: "Coarse network group" }, networkLabel(s.net)),
    h("span", { class: "kb-session-seen" }, s.lastSeen ? "seen " + relTime(s.lastSeen) : ""),
  );
}

function summarizeNetworks(sessions) {
  const map = {};
  for (const s of sessions) {
    const key = s.net || "local";
    map[key] = (map[key] || 0) + 1;
  }
  return Object.entries(map)
    .map(([net, connections]) => ({ net, label: networkLabel(net), connections }))
    .sort((a, b) => b.connections - a.connections);
}

// ---- rate control ----------------------------------------------------------
function rateBlock(stats) {
  const r = rateSummary(stats || {});
  const rows = h("div", { class: "kb-rate-list" });
  if (!r.groups.length) {
    rows.append(h("p", { class: "kb-muted" }, "The limiter is idle — no buckets in the last ten minutes."));
  } else {
    for (const g of r.groups) {
      rows.append(
        h(
          "div",
          { class: "kb-rate-row" },
          h("span", { class: "kb-rate-label" }, g.label),
          h("span", { class: "kb-rate-count" }, String(g.events)),
        ),
      );
    }
  }
  const netRow =
    r.openNetworks.length > 1
      ? h(
          "p",
          { class: "kb-audit-netnote" },
          "Open connections per network: " + r.openNetworks.map((n) => n.label + " (" + n.connections + ")").join(", "),
        )
      : null;
  return h(
    "div",
    { class: "kb-audit-section" },
    h(
      "div",
      { class: "kb-audit-section-head" },
      h("span", { class: "kb-subhead" }, "Rate control"),
      h("span", { class: "kb-count-pill" }, r.buckets + " buckets · " + r.events + " events"),
    ),
    h(
      "p",
      { class: "kb-muted" },
      "Connections are limited per connection AND per coarse network, so a single noisy client (or a whole network behind one address) cannot flood the hub. Registration and sign-in are limited hardest.",
    ),
    rows,
    netRow,
  );
}

// ---- audit trail -----------------------------------------------------------
function trailBlock(audit, reload) {
  const records = audit.records || [];
  const summary = summarizeAudit(records);
  const state = { group: "all", query: "" };

  const list = h("div", { class: "kb-audit-list" });
  const countEl = h("span", { class: "kb-count-pill" });

  function render() {
    const rows = filterAudit(records, state);
    countEl.textContent = rows.length === records.length ? String(records.length) : rows.length + " / " + records.length;
    clear(list);
    if (!rows.length) {
      list.append(h("p", { class: "kb-muted" }, records.length ? "No activity matches this filter." : "No activity recorded yet."));
      return;
    }
    for (const rec of rows) list.append(trailRow(rec));
  }

  const chips = h("div", { class: "kb-audit-filters" });
  for (const g of AUDIT_GROUPS) {
    const chip = h(
      "button",
      { class: "kb-audit-filter kb-audit-filter--" + g.tone + (g.id === "all" ? " is-active" : ""), type: "button", dataset: { group: g.id } },
      g.label,
      g.id !== "all" && summary.byGroup[g.id] ? h("span", { class: "kb-audit-filter-n" }, String(summary.byGroup[g.id])) : null,
    );
    chip.addEventListener("click", () => {
      state.group = g.id;
      for (const c of chips.querySelectorAll(".kb-audit-filter")) c.classList.toggle("is-active", c === chip);
      render();
    });
    chips.append(chip);
  }

  const search = h("input", { class: "kb-input kb-input-sm kb-audit-search", type: "search", placeholder: "Filter by person, action or scope…" });
  search.addEventListener("input", () => {
    state.query = search.value;
    render();
  });

  const refresh = h(
    "button",
    { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" },
    "Refresh",
  );
  refresh.addEventListener("click", () => reload && reload());

  render();

  return h(
    "div",
    { class: "kb-audit-section" },
    h(
      "div",
      { class: "kb-audit-section-head" },
      h("span", { class: "kb-subhead" }, "Audit trail"),
      h("span", { class: "kb-muted kb-audit-cap" }, "newest first, last " + (audit.max || records.length)),
    ),
    h("div", { class: "kb-audit-toolbar" }, chips, search, refresh),
    countEl ? h("div", { class: "kb-audit-countline" }, countEl) : null,
    list,
  );
}

function trailRow(rec) {
  const info = classifyAudit(rec.action);
  return h(
    "div",
    { class: "kb-audit-row kb-audit-row--" + info.tone, dataset: { action: rec.action, actor: rec.actor } },
    h("span", { class: "kb-audit-dot kb-audit-dot--" + info.tone }),
    h(
      "div",
      { class: "kb-audit-main" },
      h("span", { class: "kb-audit-sentence" }, describeAudit(rec)),
      h(
        "span",
        { class: "kb-audit-meta" },
        h("span", { class: "kb-audit-tag kb-audit-tag--" + info.tone }, info.label),
        rec.scope ? h("span", { class: "kb-audit-scope" }, rec.scope) : null,
      ),
    ),
    h("span", { class: "kb-audit-time" }, relTime(rec.at)),
  );
}

function capitalize(s) {
  const t = String(s == null ? "" : s);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
