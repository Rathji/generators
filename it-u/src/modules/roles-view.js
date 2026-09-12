// src/modules/roles-view.js — the People & access working surface (roadmap
// task 54).
//
// The Settings station hosts this card. It shows the IT-U role model — viewer /
// technician / administrator — and, when the realtime hub is connected, lets an
// administrator grant a role to a person at a SCOPE: the whole repository, one
// client (a documentation set), or one service (a record inside a client).
//
// Two things this card is careful to say, because they surprise people:
//   • The server is the authorization gate. The controls here call the hub's
//     grant/revoke RPCs; hiding a button is never what stops an action.
//   • Roles are additive most-specific-wins: a person can be a technician for a
//     whole client and a viewer on one service inside it, and the service grant
//     wins there.
//
// Everything degrades gracefully: with no hub the repository is single-user and
// the owner holds every permission, and a signed-in non-admin sees a read-only
// account of their own assignments.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal } from "./shared.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";
import { ROLES, GLOBAL_SCOPE, clientScope, serviceScope, scopeLabel, parseScope } from "../framework/roles.js";

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

function roleChip(role, { removable = false, onRemove = null } = {}) {
  const def = ROLES.find((r) => r.id === role) || { id: role, label: role };
  const chip = h(
    "span",
    { class: "kb-role-chip kb-role-chip--" + def.id },
    h("span", { class: "kb-role-chip-name" }, def.label),
  );
  if (removable && onRemove) {
    const x = h("button", { class: "kb-role-chip-x", type: "button", title: "Remove this grant", "aria-label": "Remove" }, "×");
    x.addEventListener("click", onRemove);
    chip.append(x);
  }
  return chip;
}

function scopeChip(scope, { removable = false, onRemove = null } = {}) {
  const p = parseScope(scope);
  const kind = p.kind === "global" ? "Repository" : p.kind === "service" ? "Service" : "Client";
  const label = p.kind === "service" ? p.serviceId : p.kind === "client" ? p.clientId : "whole repository";
  const sub = p.kind === "service" ? p.clientId : "";
  const chip = h(
    "span",
    { class: "kb-scope-pill kb-scope-pill--" + p.kind, title: scopeLabel(scope) },
    h("span", { class: "kb-scope-pill-kind" }, kind),
    h("span", { class: "kb-scope-pill-name" }, label),
    sub ? h("span", { class: "kb-scope-pill-sub" }, sub) : null,
  );
  if (removable && onRemove) {
    const x = h("button", { class: "kb-role-chip-x", type: "button", title: "Revoke this grant", "aria-label": "Revoke" }, "×");
    x.addEventListener("click", onRemove);
    chip.append(x);
  }
  return chip;
}

function roleLegend() {
  const wrap = h("div", { class: "kb-role-legend" });
  for (const r of ROLES) {
    wrap.append(
      h(
        "div",
        { class: "kb-role-legend-item kb-role-legend--" + r.id },
        h("span", { class: "kb-role-legend-dot" }),
        h(
          "div",
          { class: "kb-role-legend-text" },
          h("span", { class: "kb-role-legend-name" }, r.label),
          h("span", { class: "kb-role-legend-desc" }, r.summary),
        ),
      ),
    );
  }
  return wrap;
}

export function renderRolesCard(ctx, data = {}, reload) {
  const body = h("div", { class: "kb-roles-body" });
  const card = h(
    "section",
    { class: "kb-card kb-settings-card", dataset: { card: "roles" } },
    cardHead(icons.user, "People & access", null),
    h(
      "p",
      { class: "kb-muted" },
      "Three roles — viewer, technician and administrator — are enforced by the server and granted per client and per service. A viewer reads; a technician edits the records and runbooks they are assigned; an administrator manages templates, groups and publication. Grants are most-specific-wins: a service grant overrides a client grant, which overrides the repository-wide one.",
    ),
    roleLegend(),
    body,
  );
  paint(ctx, body, reload);
  return card;
}

async function paint(ctx, body, reload) {
  const hub = ctx.hub;
  const me = whoami(ctx);
  body.replaceChildren();

  // The signed-in identity and its repository-wide role.
  const role = ctx.access ? ctx.access.scopedRole(me, GLOBAL_SCOPE) : null;
  body.append(
    h(
      "div",
      { class: "kb-roles-me" },
      h("span", { class: "kb-roles-me-label" }, hub && hub.authenticated ? "Signed in as " + me : "Local mode"),
      role && !role.owner ? roleChip(role.role) : null,
      h("span", { class: "kb-roles-me-scope" }, role ? (role.owner ? "Full access (owner)" : "at " + scopeLabel(role.scope)) : ""),
    ),
  );

  if (!hub || !hub.connected) {
    body.append(
      h(
        "p",
        { class: "kb-muted kb-roles-note" },
        "The realtime hub is offline, so this is a single-user repository: the owner holds every permission. Sign in to a connected hub to grant scoped roles.",
      ),
    );
    return;
  }
  if (!hub.authenticated) {
    body.append(h("p", { class: "kb-muted kb-roles-note" }, "Sign in to see and manage roles. Until then the server treats you as a viewer."));
    return;
  }

  if (!hub.isAdmin) {
    body.append(h("p", { class: "kb-muted kb-roles-note" }, "Only an administrator can change roles. These are your current grants:"));
    body.append(myAssignments(hub));
    return;
  }

  const loading = h("p", { class: "kb-muted kb-roles-note" }, "Loading people…");
  body.append(loading);
  let users = [];
  try {
    users = await hub.listUsers();
  } catch (e) {
    loading.replaceWith(h("p", { class: "kb-form-error" }, String((e && e.message) || e)));
    return;
  }
  loading.remove();
  if (!users.length) {
    body.append(h("p", { class: "kb-muted kb-roles-note" }, "No one has registered on this hub yet. Share the generator: the first person to sign in and register becomes a user you can grant a role to."));
    return;
  }
  body.append(peopleTable(ctx, users, reload, me));
}

function myAssignments(hub) {
  const wrap = h("div", { class: "kb-role-grants" });
  const roles = (hub.user && hub.user.roles) || [];
  if (hub.isAdmin) {
    wrap.append(h("span", { class: "kb-muted" }, "Server administrator — full access everywhere."));
    return wrap;
  }
  if (!roles.length) {
    wrap.append(h("span", { class: "kb-muted" }, "No roles assigned yet — you can read, but not change anything."));
    return wrap;
  }
  for (const r of roles) {
    wrap.append(h("span", { class: "kb-grant-pair" }, roleChip(r.role), scopeChip(r.scope)));
  }
  return wrap;
}

function peopleTable(ctx, users, reload, me) {
  const wrap = h("div", { class: "kb-people" });
  for (const u of users.slice().sort((a, b) => a.username.localeCompare(b.username))) {
    wrap.append(personRow(ctx, u, reload, me));
  }
  return wrap;
}

function personRow(ctx, user, reload, me) {
  const chips = h("div", { class: "kb-role-grants" });
  if (user.isAdmin) {
    chips.append(h("span", { class: "kb-muted" }, "Server administrator — full access everywhere."));
  } else if (!user.roles || !user.roles.length) {
    chips.append(h("span", { class: "kb-muted" }, "No roles — read-only."));
  } else {
    for (const r of user.roles) {
      chips.append(
        h(
          "span",
          { class: "kb-grant-pair" },
          roleChip(r.role),
          scopeChip(r.scope, {
            removable: true,
            onRemove: async () => {
              try {
                await ctx.hub.revokeRole(user.username, r.scope);
                ctx.toast(`Removed ${r.role} at ${scopeLabel(r.scope)} from ${user.username}`, "success");
                reload();
              } catch (e) {
                ctx.toast(String((e && e.message) || e), "error", 5200);
              }
            },
          }),
        ),
      );
    }
  }

  const actions = h("div", { class: "kb-person-actions" });
  const grantBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Grant role");
  grantBtn.addEventListener("click", () => openGrantDialog(ctx, user, reload));
  actions.append(grantBtn);
  if (user.username !== me) {
    const banBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, user.banned ? "Enable account" : "Disable account");
    banBtn.addEventListener("click", async () => {
      try {
        await ctx.hub.setBanned(user.username, !user.banned);
        ctx.toast((user.banned ? "Enabled " : "Disabled ") + user.username, "success");
        reload();
      } catch (e) {
        ctx.toast(String((e && e.message) || e), "error", 5200);
      }
    });
    actions.append(banBtn);
  }

  return h(
    "div",
    { class: "kb-person" + (user.banned ? " kb-person--banned" : "") },
    h(
      "div",
      { class: "kb-person-id" },
      h("span", { class: "kb-avatar" }, (user.username || "?").slice(0, 2).toUpperCase()),
      h(
        "div",
        { class: "kb-person-meta" },
        h("span", { class: "kb-person-name" }, user.username === me ? user.username + " (you)" : user.username),
        user.isAdmin ? h("span", { class: "kb-badge kb-badge-admin" }, "Administrator") : null,
        user.banned ? h("span", { class: "kb-badge kb-badge-banned" }, "Disabled") : null,
      ),
    ),
    chips,
    actions,
  );
}

// ---- the grant dialog ------------------------------------------------------

function openGrantDialog(ctx, user, reload) {
  const roleSel = selectEl(
    ROLES.map((r) => [r.id, r.label]),
    "technician",
  );
  const kindSel = selectEl(
    [
      ["global", "Whole repository"],
      ["client", "One client"],
      ["service", "One service"],
    ],
    "client",
  );
  const clientSel = selectEl([], "");
  const serviceSel = selectEl([], "");
  const clientRow = field("Client", clientSel);
  const serviceRow = field("Service", serviceSel);
  const hint = h("p", { class: "kb-muted kb-grant-hint" });

  let clients = [];
  let servicesByClient = {};

  function syncHint() {
    const kind = kindSel.value;
    hint.textContent =
      roleSel.value === "administrator"
        ? "Administrators manage templates, groups and publication" + (kind === "global" ? " across the whole repository." : " at this scope.")
        : roleSel.value === "technician"
          ? "Technicians edit the records and runbooks assigned to them at this scope."
          : "Viewers can read the documentation at this scope and nothing more.";
  }

  function syncVisibility() {
    clientRow.hidden = kindSel.value === "global";
    serviceRow.hidden = kindSel.value !== "service";
    syncHint();
  }

  async function loadClients() {
    try {
      clients = (await ctx.docs.summaries().catch(() => [])) || [];
    } catch {
      clients = [];
    }
    clientSel.replaceChildren();
    for (const c of clients) clientSel.append(h("option", { value: c.id }, c.name));
    if (!clients.length) clientSel.append(h("option", { value: "" }, "No clients yet"));
    await loadServices();
  }

  async function loadServices() {
    const clientId = clientSel.value;
    servicesByClient[clientId] = servicesByClient[clientId] || (await loadServiceOptions(ctx, clientId));
    serviceSel.replaceChildren();
    const list = servicesByClient[clientId] || [];
    for (const s of list) serviceSel.append(h("option", { value: s.id }, s.label));
    if (!list.length) serviceSel.append(h("option", { value: "" }, "No records in this client"));
  }

  const m = openModal({
    title: "Grant a role to " + user.username,
    description: "A role applies at one scope. Grants stack most-specific-wins, so a service grant overrides a client grant, which overrides the repository-wide one.",
    children: [
      h("div", { class: "kb-field-row" }, field("Role", roleSel), field("Applies to", kindSel)),
      clientRow,
      serviceRow,
      hint,
    ],
  });

  kindSel.addEventListener("change", syncVisibility);
  roleSel.addEventListener("change", syncHint);
  clientSel.addEventListener("change", loadServices);
  loadClients();
  syncVisibility();

  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbGrantRole" }, "Grant role"),
  );
  m.actions.querySelector("#kbGrantRole").addEventListener("click", async (ev) => {
    m.clearError();
    const kind = kindSel.value;
    const scope = kind === "global" ? GLOBAL_SCOPE : kind === "client" ? clientScope(clientSel.value) : serviceScope(clientSel.value, serviceSel.value);
    if (kind !== "global" && !clientSel.value) return m.showError("Choose a client.");
    if (kind === "service" && !serviceSel.value) return m.showError("Choose a service record.");
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      await ctx.hub.grantRole(user.username, scope, roleSel.value);
      ctx.toast(`Granted ${roleSel.value} at ${scopeLabel(scope)} to ${user.username}`, "success");
      m.close();
      reload && reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    } finally {
      btn.disabled = false;
    }
  });
  return m;
}

async function loadServiceOptions(ctx, clientId) {
  if (!clientId) return [];
  let set = null;
  try {
    set = await ctx.docs.get(clientId, { force: true });
  } catch {
    return [];
  }
  if (!set || !set.records) return [];
  const out = [];
  for (const [type, records] of Object.entries(set.records)) {
    if (type === "relationships" || !Array.isArray(records)) continue;
    const meta = RECORD_TYPE_META[type] || { singular: type };
    for (const r of records) out.push({ id: r.id, label: (meta.singular || type) + ": " + (r.name || r.id) });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

function field(label, control) {
  return h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, label), control);
}

function selectEl(options, value) {
  const sel = h("select", { class: "kb-input kb-select" });
  for (const [v, l] of options) sel.append(h("option", { value: v }, l));
  if (value) sel.value = value;
  return sel;
}
