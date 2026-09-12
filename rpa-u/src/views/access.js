import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { matrixRows, RBAC_ROLE_ORDER, RBAC_ROLES, roleLabel, DEFAULT_ROLE_ID } from "../core/identity/rbac.js";
import { entraRoleNameFor } from "../core/identity/provider.js";
import { connectivityChip, initialsOf, rolePills, roleChip } from "./identity-ui.js";

function timeOf(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const accessView = {
  id: "access",
  title: "Identity & access",
  group: "Governance",
  icon: "id",
  nav: true,
  permission: "access.view",
  render({ hub, onDestroy }) {
    const root = el("div");
    const refreshables = [renderSession, renderRoles, renderMatrix, renderDebug, renderGuide];

    function rerender() {
      for (const fn of refreshables) {
        try {
          fn();
        } catch (error) {}
      }
    }

    root.appendChild(
      pageHead({
        eyebrow: "Governance",
        title: "Identity & access",
        subtitle: "Who you are, the roles your Entra ID token resolved to, the permission matrix behind every screen, and the diagnostics an administrator needs to troubleshoot sign-in.",
      })
    );

    const sessionCtn = el("section.pu-card");
    const rolesCtn = el("section.pu-card");
    const matrixCtn = el("section.pu-card");
    const debugCtn = el("section.pu-card");
    const guideCtn = el("section.pu-card");

    function renderSession() {
      const snap = hub.auth.snapshot();
      mount(sessionCtn);
      sessionCtn.appendChild(el("h2", { text: "Current session" }));
      if (!snap.authenticated) {
        sessionCtn.appendChild(
          el("div.pu-alert", { class: "info", text: snap.enabled ? "You are signed out. Sign in to resolve roles and permissions." : "Access control is disabled, so every screen is available." })
        );
        return;
      }
      const head = el("div.pu-session-head");
      head.appendChild(el("span.pu-avatar.lg", { text: initialsOf(snap.user && snap.user.name) }));
      const meta = el("div");
      meta.appendChild(el("span.pu-user-name", { text: (snap.user && snap.user.name) || "Signed-in user" }));
      meta.appendChild(el("span.pu-small.pu-muted", { text: (snap.user && (snap.user.username || snap.user.email)) || "—" }));
      meta.appendChild(el("div.pu-chips", { style: { "margin-top": "0.35rem" } }, rolePills(snap.roles)));
      head.appendChild(meta);
      sessionCtn.appendChild(head);

      const dl = el("dl.pu-kv", { style: { "margin-top": "0.75rem" } });
      const row = (term, value) => {
        dl.appendChild(el("dt", { text: term }));
        dl.appendChild(el("dd", { text: value }));
      };
      row("Provider", `${snap.providerId} (${snap.providerKind})`);
      row("Tenant", (snap.tenant && snap.tenant.tenantId) || "—");
      row("Object id", (snap.user && snap.user.objectId) || "—");
      row("Token expires", snap.token.expiresAt ? `${timeOf(snap.token.expiresAt)}${snap.token.expiresInMs > 0 ? ` · in ${Math.round(snap.token.expiresInMs / 60000)} min` : " · expired"}` : "—");
      row("Refresh token", snap.token.hasRefreshToken ? "available for silent renewal" : "not issued");
      row("Read-only", snap.readOnly ? "yes — mutation controls are disabled" : "no");
      row("Default role", snap.mapping.defaulted ? `applied (${snap.highestRoleLabel})` : "not applied");
      sessionCtn.appendChild(dl);

      const actions = el("div.pu-form-actions");
      const renew = el("button.pu-btn.secondary", { type: "button", text: "Renew token" });
      renew.addEventListener("click", async () => {
        renew.disabled = true;
        try {
          const result = await hub.auth.renew({ reason: "manual" });
          toast(result && result.ok !== false ? "Token renewed" : (result && result.error) || "Renewal failed", { tone: result && result.ok !== false ? "success" : "error" });
          rerender();
        } finally {
          renew.disabled = false;
        }
      });
      const signOut = el("button.pu-btn.secondary", { type: "button", text: "Sign out" });
      signOut.addEventListener("click", async () => {
        await hub.auth.signOut();
      });
      actions.appendChild(renew);
      actions.appendChild(signOut);
      sessionCtn.appendChild(actions);
    }

    function renderRoles() {
      const snap = hub.auth.snapshot();
      mount(rolesCtn);
      rolesCtn.appendChild(el("h2", { text: "Roles resolved from your token" }));
      rolesCtn.appendChild(
        el("p.pu-small", {
          text: "Entra ID app roles and security group claims are translated into the hub's canonical roles. The highest-ranked role normally decides what you can do, though a read-only role always wins for mutation controls.",
        })
      );
      const matched = snap.mapping.matches || [];
      if (matched.length) {
        const list = el("ul.pu-list");
        for (const match of matched) {
          const li = el("li");
          li.appendChild(el("span.pu-chip", { text: match.source === "group" ? "Group" : "App role" }));
          li.appendChild(el("span.pu-mono", { text: match.value }));
          li.appendChild(el("span", { text: "→" }));
          li.appendChild(roleChip(match.role));
          list.appendChild(li);
        }
        rolesCtn.appendChild(list);
      } else {
        rolesCtn.appendChild(el("div.pu-alert", { class: "info", text: `No app-role or group claim matched, so the default role (${roleLabel(snap.config ? snap.config.defaultRole : DEFAULT_ROLE_ID)}) applies.` }));
      }
      const unknown = snap.mapping.unknown || [];
      if (unknown.length) {
        const card = el("div.pu-subcard");
        card.appendChild(el("h3", { text: "Unmapped claims" }));
        card.appendChild(el("p.pu-small.pu-muted", { text: "These claims arrived in the token but are not mapped to a role. Add them to the appRoles or groups block in main.pjs if they should grant access." }));
        const list = el("ul.pu-list");
        for (const entry of unknown) {
          const li = el("li");
          li.appendChild(el("span.pu-chip", { text: entry.source === "group" ? "Group" : "App role" }));
          li.appendChild(el("span.pu-mono", { text: entry.value }));
          list.appendChild(li);
        }
        card.appendChild(list);
        rolesCtn.appendChild(card);
      }
      rolesCtn.appendChild(el("div.pu-chips", { style: { "margin-top": "0.6rem" } }, rolePills(snap.roles)));
    }

    function renderMatrix() {
      const snap = hub.auth.snapshot();
      mount(matrixCtn);
      matrixCtn.appendChild(el("h2", { text: "Permission matrix" }));
      matrixCtn.appendChild(
        el("p.pu-small", {
          text: "Every resource and action in the hub, with the minimum role it requires. A tick in the last column marks what your current roles can do.",
        })
      );
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table.pu-matrix");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Resource", "Action", "Minimum role", "Your access"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const group of matrixRows()) {
        for (const action of group.actions) {
          const allowed = snap.authenticated ? hub.auth.can(action.key) : false;
          const tr = el("tr");
          tr.appendChild(el("td", {}, el("div", { text: group.label }), el("span.pu-small.pu-muted", { text: group.group })));
          tr.appendChild(el("td", {}, el("div", { text: action.label }), el("span.pu-mono.pu-small.pu-muted", { text: action.key })));
          tr.appendChild(el("td", {}, roleChip(action.minRole)));
          tr.appendChild(el("td", {}, el("span.pu-chip", { class: allowed ? "ok" : "muted", text: allowed ? "Allowed" : "Denied" })));
          tbody.appendChild(tr);
        }
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      matrixCtn.appendChild(wrap);
    }

    function renderDebug() {
      const snap = hub.auth.snapshot();
      mount(debugCtn);
      debugCtn.appendChild(el("h2", { text: "Identity debugger" }));
      const allowed = snap.authenticated && hub.auth.can("access.manage");
      if (!allowed) {
        debugCtn.appendChild(el("div.pu-alert", { class: "warn", text: "The identity debugger exposes raw token claims, so it is restricted to the Administrator role." }));
        return;
      }
      debugCtn.appendChild(el("p.pu-small", { text: "Raw claims, token metadata and the resolved endpoints for troubleshooting sign-in. Treat this as untrusted input: it is decoded, not verified, in the browser." }));
      const debug = hub.auth.debug();
      const dl = el("dl.pu-kv");
      const row = (term, value) => {
        dl.appendChild(el("dt", { text: term }));
        dl.appendChild(el("dd", { text: value }));
      };
      row("Configured", debug.configured ? "yes" : "no — demo directory in use");
      if (debug.endpoints) {
        row("Authorize endpoint", debug.endpoints.authorize);
        row("Token endpoint", debug.endpoints.token);
        row("Discovery document", debug.endpoints.metadata);
      }
      if (debug.token) {
        row("Access token", debug.token.hasAccessToken ? "present" : "absent");
        row("Refresh token", debug.token.hasRefreshToken ? "present" : "absent");
        row("Issued", timeOf(debug.token.issuedAt));
        row("Expires", timeOf(debug.token.expiresAt));
      }
      debugCtn.appendChild(dl);

      const claims = (debug.claims && debug.claims.claims) || [];
      const detail = el("details.pu-disclosure");
      detail.appendChild(el("summary", { text: `Raw claims (${claims.length})` }));
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Claim", "Type", "Value"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const claim of claims) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-mono", { text: claim.claim })));
        tr.appendChild(el("td", {}, el("span.pu-small.pu-muted", { text: claim.kind })));
        tr.appendChild(el("td", {}, el("span.pu-small", { text: claim.value })));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      detail.appendChild(wrap);
      debugCtn.appendChild(detail);

      const raw = debug.rawClaims ? JSON.stringify(debug.rawClaims, null, 2) : "{}";
      const rawDetail = el("details.pu-disclosure");
      rawDetail.appendChild(el("summary", { text: "Raw JSON" }));
      rawDetail.appendChild(el("pre.pu-code", { style: { "max-height": "18rem", overflow: "auto" }, text: raw }));
      debugCtn.appendChild(rawDetail);
    }

    function renderGuide() {
      const snap = hub.auth.snapshot();
      const config = hub.auth.config;
      mount(guideCtn);
      guideCtn.appendChild(el("h2", { text: "Role management guide" }));
      guideCtn.appendChild(
        el("p.pu-small", {
          text: "How to wire your Entra ID tenant to the hub's roles. The hub maps app-role values (or security group object ids) onto its canonical roles; assign one per person, plus any extra read-only role they need.",
        })
      );
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Hub role", "What it can do", "Entra ID app role value"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const id of RBAC_ROLE_ORDER) {
        const role = RBAC_ROLES[id];
        const tr = el("tr");
        tr.appendChild(el("td", {}, roleChip(id)));
        tr.appendChild(el("td", {}, el("span.pu-small", { text: role.description })));
        tr.appendChild(el("td", {}, el("span.pu-mono.pu-small", { text: entraRoleNameFor(config, id) })));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      guideCtn.appendChild(wrap);

      const steps = el("ol.pu-help-steps", { style: { "margin-top": "0.75rem" } });
      for (const step of [
        "In the Entra admin centre open App registrations, pick the hub's application, then App roles and create one role for each canonical role you use. Set the value to the app role name shown above.",
        "Under Enterprise applications → your app → Users and groups, assign each person the app role that matches their job. A user can hold several roles; the hub ranks them and a read-only role always disables mutations.",
        "If you prefer security groups, map the group's object id in the groups block of the identity configuration instead, and leave the app-role block for tenant-wide defaults.",
        "Keep the default role at viewer (or the strictest role you can) so an unmapped account lands with read-only access rather than none.",
        "To test the whole model without a live tenant, leave showSimulator on and use the demo directory accounts on the sign-in screen.",
      ]) steps.appendChild(el("li", { text: step }));
      guideCtn.appendChild(steps);

      const facts = el("div.pu-chips", { style: { "margin-top": "0.6rem" } });
      facts.appendChild(el("span.pu-chip", { text: `${config.tenantId || "any tenant"}` }));
      facts.appendChild(el("span.pu-chip", { text: `${Object.keys(config.appRoles || {}).length} app-role mappings` }));
      facts.appendChild(el("span.pu-chip", { text: `${Object.keys(config.groups || {}).length} group mappings` }));
      facts.appendChild(el("span.pu-chip", { text: `default ${roleLabel(config.defaultRole || DEFAULT_ROLE_ID)}` }));
      guideCtn.appendChild(facts);
    }

    function renderConnectivity() {
      const state = hub.auth.connectivity();
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Identity provider connectivity" }));
      const head = el("div.pu-chips");
      head.appendChild(connectivityChip(hub));
      card.appendChild(head);
      if (state.reason) card.appendChild(el("p.pu-small.pu-muted", { text: state.reason }));
      const check = el("button.pu-btn.secondary", { type: "button", text: "Check now" });
      check.addEventListener("click", async () => {
        check.disabled = true;
        try {
          const result = await hub.auth.probe();
          toast(result && result.ok ? "Identity provider reachable" : `Provider check: ${(result && result.error) || "failed"}`, { tone: result && result.ok ? "success" : "error" });
          rerender();
        } finally {
          check.disabled = false;
        }
      });
      card.appendChild(el("div.pu-form-actions", {}, check));
      return card;
    }

    root.appendChild(sessionCtn);
    root.appendChild(rolesCtn);
    root.appendChild(matrixCtn);
    root.appendChild(debugCtn);
    root.appendChild(guideCtn);
    root.appendChild(renderConnectivity());

    rerender();
    const unsubscribe = hub.auth.subscribe(() => rerender());
    if (typeof onDestroy === "function") onDestroy(unsubscribe);
    return root;
  },
};
