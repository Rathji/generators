// src/modules/integrations.js — the Integrations station (roadmap task 28).
//
// A PSA or RMM is a client's system of record. This station connects one to a
// documentation set and keeps the set's organizations, contacts and
// configurations & devices in step with it. Each connection is an *integration
// definition* stored on the set (framework/integration.js), and a sync is a
// deterministic reconciliation against a remote snapshot a provider adapter
// returns — the same records are never duplicated, an existing record is matched
// by external id (or adopted by name when the integration opts in), and a
// provider's push is recorded back so records it creates remotely get their id.
//
// The station lists the documentation sets; opening one (`#/integrations/<id>`)
// shows that client's integrations, each with its per-entity direction, its last
// sync and a full run log, plus the whole run history. Because there is no live
// PSA/RMM API here, "Sync now" runs against a clearly-labelled SIMULATED
// provider (see demoProvider) that fabricates a deterministic remote snapshot —
// a real adapter is just an object implementing the same `{ sync, push }` shape,
// and is injected the same way (docs.syncIntegration(..., { provider })).

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, openModal, confirmDialog, relTime, fmtDate } from "./shared.js";
import {
  INTEGRATION_KINDS,
  integrationKind,
  SYNC_DIRECTIONS,
  syncDirection,
  SYNC_ENTITIES,
  syncEntity,
  runSummaryLine,
  CONFLICT_POLICIES,
  conflictPolicy,
  ownedFields,
} from "../framework/integration.js";

const DESC =
  "Connect each client's PSA or RMM to their documentation set and keep organizations, contacts and configurations in step with the system of record — matched by external id, mapped field by field, with direction, ownership and pruning under your control and every run logged.";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

const ENTITY_ICONS = { organizations: "building", contacts: "user", configurations: "server" };
const KIND_ICON = { psa: "clipboard", rmm: "server", identity: "user", other: "database" };

export default {
  id: "integrations",
  label: "Integrations",
  desc: DESC,
  icon: icons.link,
  render(ctx) {
    renderList(ctx);
  },
  renderDetail(ctx, sub) {
    renderDetail(ctx, decodeURIComponent(sub));
  },
};

// ---------------------------------------------------------------------------
// list view — the client picker
// ---------------------------------------------------------------------------
function renderList(ctx) {
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading documentation sets…" }));
  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newSet(ctx) }, "New documentation set"),
  );
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Integrations", desc: DESC, actions, body }));
  loadList(ctx, body);
}

async function loadList(ctx, body) {
  let sets;
  try {
    sets = (await ctx.docs.summaries({ includeArchived: false })) || [];
  } catch (e) {
    clear(body);
    body.append(errorState({ title: "Couldn’t load documentation sets", description: String((e && e.message) || e), onRetry: () => loadList(ctx, body) }));
    return;
  }
  const counts = {};
  for (const s of sets) counts[s.id] = await ctx.docs.listIntegrations(s.id).then((i) => i.length).catch(() => 0);
  clear(body);
  if (!sets.length) {
    body.append(
      emptyState({
        icon: icons.link,
        title: "No clients to connect yet",
        description:
          "Integrations attach to a client's documentation set. Create a documentation set for a client, then connect their PSA or RMM so the set stays in step with the system of record.",
        action: h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newSet(ctx) }, "New documentation set"),
      }),
    );
    return;
  }
  const grid = h("div", { class: "kb-docset-grid" });
  for (const s of sets) grid.append(setCard(s, counts[s.id] || 0));
  body.append(h("div", { class: "kb-docset-count" }, sets.length + " documentation set" + (sets.length === 1 ? "" : "s")), grid);
}

function setCard(s, integrationCount) {
  const chips = [];
  chips.push(integrationCount ? h("span", { class: "kb-chip" }, integrationCount + " integration" + (integrationCount === 1 ? "" : "s")) : h("span", { class: "kb-chip kb-chip-empty" }, "No integrations"));
  return h(
    "a",
    { class: "kb-docset-card", href: "#/integrations/" + s.id, dataset: { id: s.id } },
    h(
      "div",
      { class: "kb-docset-card-head" },
      h("span", { class: "kb-docset-avatar", html: icons.link }),
      h("div", { class: "kb-docset-card-id" }, h("h3", { class: "kb-docset-name" }, s.name), h("div", { class: "kb-docset-kind" }, "Documentation set")),
    ),
    h("div", { class: "kb-docset-meta" }, integrationCount ? "Connected systems of record" : "Not connected to a system of record yet"),
    h("div", { class: "kb-chips" }, chips),
  );
}

async function newSet(ctx) {
  const name = await promptName();
  if (!name) return;
  try {
    const set = await ctx.docs.create({ name, createdBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Created “" + set.name + "”", "success");
    ctx.go("#/integrations/" + set.id);
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

function promptName() {
  return new Promise((resolve) => {
    const input = h("input", { class: "kb-input", type: "text", placeholder: "Client, department or business unit name" });
    const m = openModal({ title: "New documentation set", children: [h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), input)] });
    m.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => { m.close(); resolve(null); } }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => { const v = input.value.trim(); m.close(); resolve(v || null); } }, "Create"),
    );
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const v = input.value.trim(); m.close(); resolve(v || null); }
    });
    input.focus();
  });
}

// ---------------------------------------------------------------------------
// detail view — this client's integrations + run log
// ---------------------------------------------------------------------------
function renderDetail(ctx, id) {
  const titleEl = h("h1", { class: "kb-view-title" }, "…");
  const crumbEl = h("div", { class: "kb-breadcrumb" }, "IT-U / Integrations");
  const actions = h("div", { class: "kb-actions-row" });
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading integrations…" }));
  ctx.container.append(
    h(
      "div",
      { class: "kb-view" },
      h(
        "header",
        { class: "kb-view-head" },
        crumbEl,
        h("div", { class: "kb-view-title-row" }, titleEl, actions),
        h("p", { class: "kb-view-desc" }, "The systems of record this client's documentation is synchronized with — each connection's entities, direction, field mapping and run history."),
      ),
      body,
    ),
  );
  loadDetail(ctx, id, { titleEl, crumbEl, actions, body });
}

async function loadDetail(ctx, id, ui) {
  let set;
  try {
    set = await ctx.docs.get(id, { force: true });
  } catch (e) {
    clear(ui.body);
    ui.body.append(errorState({ title: "Couldn’t load this documentation set", description: String((e && e.message) || e), onRetry: () => loadDetail(ctx, id, ui) }));
    return;
  }
  if (!set) {
    ui.titleEl.textContent = "Not found";
    clear(ui.body);
    ui.body.append(
      emptyState({
        icon: icons.alert,
        title: "Documentation set not found",
        description: "It may have been deleted.",
        action: h("a", { class: "kb-btn kb-btn-ghost", href: "#/integrations" }, "Back to Integrations"),
      }),
    );
    return;
  }
  const integrations = await ctx.docs.listIntegrations(set.id).catch(() => []);
  const runs = await ctx.docs.integrationRuns(set.id).catch(() => []);
  const governance = await ctx.docs.integrationGovernance(set.id).catch(() => null);
  ui.titleEl.textContent = set.name;
  ui.crumbEl.replaceChildren(
    h("a", { class: "kb-bc-link", href: "#/integrations" }, "IT-U / Integrations"),
    h("span", { class: "kb-bc-current" }, " / " + set.name),
  );
  const reload = () => loadDetail(ctx, id, ui);
  const archived = !!set.archived;
  clear(ui.actions);
  ui.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => ctx.go("#/organizations/" + set.id) }, "Open full set"),
    archived ? null : h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbAddIntegrationBtn", onClick: () => openIntegrationDialog(ctx, set, null, reload) }, "+ Integration"),
  );
  clear(ui.body);
  ui.body.append(...renderIntegrations(ctx, set, integrations, runs, reload, { archived, governance }));
}

function renderIntegrations(ctx, set, integrations, runs, reload, opts = {}) {
  const archived = !!opts.archived;
  const out = [];
  if (archived) {
    out.push(
      h(
        "div",
        { class: "kb-banner kb-banner-archived" },
        h("span", { class: "kb-banner-icon", html: icons.history }),
        h("div", { class: "kb-banner-text" }, h("strong", null, "This documentation set is archived and read-only.")),
      ),
    );
  }

  const enabled = integrations.filter((i) => i.enabled).length;
  const lastRun = integrations.map((i) => i.lastRunAt).filter(Boolean).sort((a, b) => b - a)[0] || null;
  const failing = integrations.filter((i) => i.lastStatus && i.lastStatus !== "ok").length;
  out.push(
    h(
      "div",
      { class: "kb-kpi-row", id: "kbIntegrationKpis" },
      kpi(String(integrations.length), "Integrations"),
      kpi(String(enabled), "Enabled", enabled ? "ok" : ""),
      kpi(String(runs.length), "Sync runs"),
      kpi(lastRun ? relTime(lastRun) : "—", "Last sync"),
      kpi(String(failing), "Needing attention", failing ? "bad" : ""),
    ),
  );

  if (!integrations.length) {
    out.push(
      h(
        "section",
        { class: "kb-card kb-record-section", id: "kbIntegrationEmpty" },
        h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.link }), h("h2", { class: "kb-section-name" }, "Integrations")),
        h("p", { class: "kb-muted" }, "No systems of record connected yet. Add a PSA or RMM integration and IT-U will keep this client's organizations, contacts and configurations in step with it — matched by external id, mapped field by field, and logged on every run."),
        archived ? null : h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", onClick: () => openIntegrationDialog(ctx, set, null, reload) }, "+ Integration"),
      ),
    );
    return out;
  }

  for (const integration of integrations) out.push(integrationCard(ctx, set, integration, reload, { archived }));

  out.push(governanceSection(ctx, set, integrations, opts.governance, reload, { archived }));
  out.push(runsSection(ctx, set, runs));
  return out;
}

function kpi(value, label, tone) {
  return h("div", { class: "kb-kpi" + (tone ? " kb-kpi--" + tone : "") }, h("span", { class: "kb-kpi-value" }, value), h("span", { class: "kb-kpi-label" }, label));
}

function integrationCard(ctx, set, integration, reload, opts = {}) {
  const archived = !!opts.archived;
  const kind = integrationKind(integration.kind) || { short: "Other", label: integration.kind };
  const head = h(
    "div",
    { class: "kb-section-head" },
    h("span", { class: "kb-section-icon", html: icons[KIND_ICON[integration.kind]] || icons.link }),
    h("h2", { class: "kb-section-name" }, integration.name),
    h("span", { class: "kb-badge kb-badge-model--integration" }, kind.short),
    integration.enabled ? h("span", { class: "kb-badge kb-badge-prov--authored" }, "Enabled") : h("span", { class: "kb-badge kb-badge-archived" }, "Disabled"),
  );
  if (!archived) {
    head.append(
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", dataset: { action: "edit", id: integration.id }, onClick: () => openIntegrationDialog(ctx, set, integration, reload) }, "Edit"),
      h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", dataset: { action: "sync", id: integration.id }, onClick: () => syncNow(ctx, set, integration, reload) }, "Sync now"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeIntegration(ctx, set, integration, reload) }, "Remove"),
    );
  }

  const metaBits = [];
  if (integration.baseUrl) metaBits.push(integration.baseUrl);
  const cred = integration.credentialId ? (set.records.passwords || []).find((p) => p.id === integration.credentialId) : null;
  metaBits.push(cred ? "Credential: " + cred.name : "No credential");
  metaBits.push("Match on " + (integration.matchOn === "name" ? "name" : "external id"));
  if (integration.prune) metaBits.push("prunes removed records");
  const policy = conflictPolicy(integration.conflictPolicy) || conflictPolicy("external");
  metaBits.push("On conflict: " + policy.short.toLowerCase() + " wins");

  const entityGrid = h("div", { class: "kb-integration-entities" });
  for (const entity of SYNC_ENTITIES) {
    entityGrid.append(entityRow(integration, entity.id));
  }

  const last = integration.lastRunAt
    ? h(
        "div",
        { class: "kb-integration-last" },
        statusBadge(integration.lastStatus || "ok"),
        h("span", { class: "kb-integration-last-summary" }, integration.lastSummary || "Synced"),
        h("span", { class: "kb-muted" }, " · " + relTime(integration.lastRunAt)),
      )
    : h("div", { class: "kb-integration-last kb-muted" }, "Never synced.");

  return h(
    "section",
    { class: "kb-card kb-record-section kb-integration-card", dataset: { id: integration.id } },
    head,
    h("div", { class: "kb-integration-meta kb-muted" }, metaBits.join(" · ")),
    entityGrid,
    last,
  );
}

function entityRow(integration, entityId) {
  const entity = integration.entities[entityId] || {};
  const def = syncEntity(entityId) || { label: entityId };
  const dir = syncDirection(entity.direction);
  const badge = !entity.enabled
    ? h("span", { class: "kb-dir kb-dir--off" }, "Off")
    : h("span", { class: "kb-dir kb-dir--" + entity.direction }, dir ? dir.short : entity.direction);
  const fieldCount = (entity.fields || []).length;
  const ownedCount = ownedFields(integration, entityId).length;
  return h(
    "div",
    { class: "kb-integration-entity" + (entity.enabled ? "" : " kb-integration-entity--off") },
    h("span", { class: "kb-integration-entity-icon", html: icons[ENTITY_ICONS[entityId]] || icons.box }),
    h("span", { class: "kb-integration-entity-name" }, def.label),
    badge,
    entity.enabled ? h("span", { class: "kb-muted kb-integration-entity-fields" }, fieldCount + " field" + (fieldCount === 1 ? "" : "s") + " mapped · " + ownedCount + " owned") : h("span", { class: "kb-muted kb-integration-entity-fields" }, "not synchronized"),
  );
}

function statusBadge(status) {
  if (status === "ok") return h("span", { class: "kb-badge kb-badge-prov--authored" }, "OK");
  if (status === "partial") return h("span", { class: "kb-badge kb-badge-warn" }, "Partial");
  if (status === "error") return h("span", { class: "kb-badge kb-badge-danger" }, "Failed");
  return h("span", { class: "kb-badge" }, status || "—");
}

function runsSection(ctx, set, runs) {
  const section = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { type: "sync-runs" } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.history }),
      h("h2", { class: "kb-section-name" }, "Recent sync runs"),
      h("span", { class: "kb-count-pill" }, String(runs.length)),
    ),
  );
  if (!runs.length) {
    section.append(h("p", { class: "kb-muted" }, "No sync runs yet. Use “Sync now” on an integration to reconcile it with the remote system."));
    return section;
  }
  const table = h("table", { class: "kb-table kb-record-table" });
  table.append(h("thead", null, h("tr", null, h("th", null, "When"), h("th", null, "Integration"), h("th", null, "Mode"), h("th", null, "Status"), h("th", null, "Result"))));
  const tbody = h("tbody", null);
  for (const run of runs.slice(0, 12)) {
    tbody.append(
      h(
        "tr",
        { class: "kb-record-row", dataset: { id: run.id } },
        h("td", { class: "kb-record-details", title: fmtDate(run.finishedAt) }, relTime(run.finishedAt)),
        h("td", null, run.integrationName),
        h("td", null, run.mode),
        h("td", null, statusBadge(run.status)),
        h("td", null, runSummaryLine(run)),
      ),
    );
  }
  table.append(tbody);
  section.append(table);
  if (runs.length > 12) section.append(h("p", { class: "kb-muted kb-lifecycle-more" }, "+" + (runs.length - 12) + " earlier run" + (runs.length - 12 === 1 ? "" : "s")));
  return section;
}

// ---------------------------------------------------------------------------
// record governance (task 30) — integration-owned fields, drift & conflicts
// ---------------------------------------------------------------------------
function fieldLabelOf(field) {
  return String(field)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function displayValue(v) {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function governanceSection(ctx, set, integrations, gov, reload, opts = {}) {
  const archived = !!opts.archived;
  const section = h(
    "section",
    { class: "kb-card kb-record-section", id: "kbGovernanceSection", dataset: { type: "governance" } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.shield }),
      h("h2", { class: "kb-section-name" }, "Record governance"),
      h("span", { class: "kb-count-pill" }, String(gov ? gov.managed : 0)),
    ),
    h(
      "p",
      { class: "kb-muted" },
      "Records a connected system maintains are integration-managed: the pulled fields are owned by that system, it is authoritative for them, and a local edit that a sync would overwrite is surfaced here and resolved by the integration's conflict policy.",
    ),
  );
  if (!gov || !gov.managed) {
    section.append(h("p", { class: "kb-muted" }, "No integration-managed records yet — sync an integration and the records it maintains will appear here."));
    return section;
  }
  section.append(
    h(
      "div",
      { class: "kb-kpi-row kb-governance-kpis", id: "kbGovernanceKpis" },
      kpi(String(gov.managed), "Managed records"),
      kpi(String(Object.keys(gov.bySystem).length), "Authoritative systems"),
      kpi(String(gov.driftCount), "Fields drifted", gov.driftCount ? "warn" : ""),
      kpi(String(gov.openCount), "Open conflicts", gov.openCount ? "bad" : ""),
      kpi(String(gov.pushCount), "Push-backs", gov.pushCount ? "warn" : ""),
    ),
  );

  const needsAttention = (it) => it.conflicts.length || it.drift.length;
  const rows = gov.items.filter(needsAttention).concat(gov.items.filter((it) => !needsAttention(it))).slice(0, 40);
  const table = h("table", { class: "kb-table kb-record-table kb-governance-table" });
  table.append(
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        h("th", null, "Record"),
        h("th", null, "Type"),
        h("th", null, "Authoritative system"),
        h("th", null, "Integration-owned fields"),
        h("th", null, "Drift"),
        h("th", null, "Conflicts"),
      ),
    ),
  );
  const tbody = h("tbody", null);
  for (const it of rows) {
    const owned = it.ownedFields.map(fieldLabelOf);
    const drift = it.drift.map((d) => fieldLabelOf(d.field));
    tbody.append(
      h(
        "tr",
        { class: "kb-record-row" + (needsAttention(it) ? " kb-governance-row--attention" : ""), dataset: { id: it.id, collection: it.collection } },
        h("td", { class: "kb-record-details" }, it.name),
        h("td", { class: "kb-muted" }, it.entityLabel),
        h("td", null, h("span", { class: "kb-badge kb-badge-model--integration" }, it.system)),
        h(
          "td",
          { class: "kb-governance-owned" },
          h("span", { title: owned.join(", ") }, String(owned.length) + " field" + (owned.length === 1 ? "" : "s")),
          owned.length ? h("span", { class: "kb-governance-owned-list kb-muted" }, owned.slice(0, 3).join(", ") + (owned.length > 3 ? "…" : "")) : null,
        ),
        h("td", null, drift.length ? h("span", { class: "kb-governance-drift", title: drift.join(", ") }, drift.join(", ")) : h("span", { class: "kb-muted" }, "—")),
        h(
          "td",
          null,
          it.conflicts.length
            ? h(
                "div",
                { class: "kb-governance-conflicts" },
                h("span", { class: "kb-badge kb-badge-danger" }, String(it.conflicts.length) + " open"),
                archived ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", dataset: { action: "resolve", id: it.id }, onClick: () => openConflictDialog(ctx, set, it, reload) }, "Resolve"),
              )
            : h("span", { class: "kb-muted" }, "—"),
        ),
      ),
    );
  }
  table.append(tbody);
  section.append(table);
  if (gov.items.length > rows.length) {
    section.append(h("p", { class: "kb-muted kb-lifecycle-more" }, "Showing " + rows.length + " of " + gov.items.length + " managed record" + (gov.items.length === 1 ? "" : "s") + "."));
  }
  return section;
}

function openConflictDialog(ctx, set, item, reload) {
  const modal = openModal({
    title: "Resolve conflicts",
    description: "“" + item.name + "” is kept in step with " + item.system + ". A local edit collides with an incoming change on these fields — choose which value wins.",
    wide: true,
  });
  const list = h("div", { class: "kb-conflict-list" });
  const openOn = () => item.conflicts.filter((c) => c.state === "open");
  const render = () => {
    clear(list);
    const conflicts = openOn();
    if (!conflicts.length) {
      list.append(h("p", { class: "kb-conflict-done" }, "All conflicts on this record are resolved."));
      return;
    }
    for (const c of conflicts) {
      list.append(
        h(
          "div",
          { class: "kb-conflict", dataset: { field: c.field } },
          h("div", { class: "kb-conflict-field" }, fieldLabelOf(c.field)),
          h(
            "div",
            { class: "kb-conflict-values" },
            h("div", { class: "kb-conflict-value kb-conflict-value--local" }, h("span", { class: "kb-conflict-tag" }, "Local"), h("span", { class: "kb-conflict-text" }, displayValue(c.localValue))),
            h("div", { class: "kb-conflict-value kb-conflict-value--remote" }, h("span", { class: "kb-conflict-tag" }, item.system), h("span", { class: "kb-conflict-text" }, displayValue(c.remoteValue))),
          ),
          h(
            "div",
            { class: "kb-conflict-actions" },
            h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => resolveOne(c.field, "external") }, "Keep " + item.system),
            h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => resolveOne(c.field, "local") }, "Keep local"),
          ),
        ),
      );
    }
  };
  const resolveOne = async (field, choice) => {
    try {
      await ctx.docs.resolveIntegrationConflict(set.id, item.id, field, choice, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      item.conflicts = item.conflicts.map((c) => (c.field === field && c.state === "open" ? { ...c, state: "resolved" } : c));
      ctx.toast(choice === "external" ? "Kept " + item.system + "’s value for “" + fieldLabelOf(field) + "”" : "Kept the local edit for “" + fieldLabelOf(field) + "”", "success", 3200);
      render();
      reload();
    } catch (e) {
      ctx.toast(String((e && e.message) || e), "error", 6000);
    }
  };
  const resolveAll = async (choice) => {
    const fields = openOn().map((c) => c.field);
    for (const field of fields) await resolveOne(field, choice);
  };
  render();
  modal.overlay.querySelector(".kb-modal").insertBefore(list, modal.actions);
  modal.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => resolveAll("external") }, "Keep all external"),
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => resolveAll("local") }, "Keep all local"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: modal.close }, "Done"),
  );
}

// ---------------------------------------------------------------------------
// sync (against the simulated provider)
// ---------------------------------------------------------------------------
async function syncNow(ctx, set, integration, reload) {
  const pullCount = pullEntities(integration).length;
  const pushCount = pushEntities(integration).length;
  const provider = demoProvider(integration);
  ctx.toast("Syncing “" + integration.name + "”…", "info", 2200);
  try {
    const res = await ctx.docs.syncIntegration(set.id, integration.id, { provider, updatedBy: whoami(ctx), actor: whoami(ctx) });
    const t = (res.summary && res.summary.totals) || {};
    const created = t.created || 0;
    const updated = t.updated || 0;
    const adopted = t.adopted || 0;
    const skipped = t.skipped || 0;
    const conflicts = t.conflicts || 0;
    const parts = [];
    if (created) parts.push(created + " created");
    if (adopted) parts.push(adopted + " adopted");
    if (updated) parts.push(updated + " updated");
    if (skipped) parts.push(skipped + " skipped");
    if (conflicts) parts.push(conflicts + " conflict" + (conflicts === 1 ? "" : "s"));
    if (!parts.length) parts.push("already current");
    ctx.toast("Synced “" + integration.name + "” — " + parts.join(", "), res.run && res.run.status === "ok" && !conflicts ? "success" : "warning", 5600);
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 6000);
  }
}

const pullEntities = (i) => SYNC_ENTITIES.filter((e) => i.entities[e.id] && i.entities[e.id].enabled && (i.entities[e.id].direction === "pull" || i.entities[e.id].direction === "both")).map((e) => e.id);
const pushEntities = (i) => SYNC_ENTITIES.filter((e) => i.entities[e.id] && i.entities[e.id].enabled && (i.entities[e.id].direction === "push" || i.entities[e.id].direction === "both")).map((e) => e.id);

// The SIMULATED PSA/RMM adapter. There is no live API to call, so this
// fabricates a deterministic remote snapshot keyed by the integration id — the
// same sync run twice is genuinely idempotent, which is exactly what exercises
// the reconciliation. A real adapter is any object with the same shape:
//   sync({ integration, entities })  → { [entityId]: remoteRecord[] }
//   push({ integration, entity, records }) → { pushed, assigned:[{localId, externalId}] }
// and is passed as docs.syncIntegration(setId, integrationId, { provider }).
function demoProvider(integration) {
  const ns = String(integration.id).replace(/[^a-z0-9]/gi, "").slice(-6) || "demo";
  const remote = {
    organizations: [
      {
        externalId: ns + "-org-1",
        name: "Northwind Trading",
        fields: {
          legalName: "Northwind Trading Pty Ltd",
          tradingName: "Northwind",
          taxId: "ABN 12 345 678 901",
          website: "https://northwind.example",
          primaryPhone: "555-0100",
        },
      },
    ],
    contacts: [
      { externalId: ns + "-con-1", name: "Jo Bloggs", fields: { jobTitle: "IT Manager", email: "jo.bloggs@northwind.example", phone: "555-0101", mobile: "0400 000 000" } },
      { externalId: ns + "-con-2", name: "Dana Lee", fields: { jobTitle: "Operations Lead", email: "dana.lee@northwind.example", phone: "555-0102" } },
    ],
    configurations: [
      {
        externalId: ns + "-cfg-1",
        name: "NW-DC01",
        fields: { configType: "Physical Server", manufacturer: "Dell", model: "PowerEdge R650", serialNumber: "SN-" + ns + "-01", hostname: "nw-dc01", ipAddresses: "10.20.0.10", operatingSystem: "Windows Server 2022", supportExpiryDate: "2027-06-30", warrantyExpiryDate: "2027-03-31" },
      },
      {
        externalId: ns + "-cfg-2",
        name: "NW-FW01",
        fields: { configType: "Firewall", manufacturer: "Fortinet", model: "FortiGate 60F", serialNumber: "SN-" + ns + "-02", hostname: "nw-fw01", ipAddresses: "10.20.0.1", operatingSystem: "FortiOS 7.4", supportExpiryDate: "2027-01-15" },
      },
      {
        externalId: ns + "-cfg-3",
        name: "NW-WS-JB",
        fields: { configType: "Desktop", manufacturer: "Lenovo", model: "ThinkCentre M90q", serialNumber: "SN-" + ns + "-03", hostname: "nw-ws-jb", ipAddresses: "10.20.1.42", operatingSystem: "Windows 11 Pro", warrantyExpiryDate: "2028-02-28" },
      },
    ],
  };
  return {
    async sync({ entities }) {
      const out = {};
      for (const e of entities) out[e] = (remote[e] || []).map((r) => ({ ...r, fields: { ...r.fields } }));
      return out;
    },
    async push({ entity, records }) {
      const assigned = records
        .filter((r) => r.isNew)
        .map((r, i) => ({ localId: r.localId, externalId: ns + "-" + String(entity).slice(0, 3) + "-p" + (i + 1) }));
      return { pushed: records.length, assigned };
    },
  };
}

// ---------------------------------------------------------------------------
// add / edit dialog
// ---------------------------------------------------------------------------
function openIntegrationDialog(ctx, set, existing, reload) {
  const isEdit = !!existing;
  const i = existing || { kind: "rmm", matchOn: "externalId", enabled: true, prune: false, typeMap: {}, entities: {} };

  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Datto RMM", value: i.name || "" });
  const kindSel = h("select", { class: "kb-input", id: "kbIntegrationKind" });
  for (const k of INTEGRATION_KINDS) kindSel.append(h("option", { value: k.id, title: k.description }, k.label));
  kindSel.value = i.kind || "other";
  const baseUrlInput = h("input", { class: "kb-input", type: "text", placeholder: "https://api.example.com", value: i.baseUrl || "" });

  const credentials = (set.records.passwords || []).filter((p) => p.scope !== "embedded" && !p.embeddedIn);
  const credSel = h("select", { class: "kb-input" }, h("option", { value: "" }, "— none —"));
  for (const c of credentials) credSel.append(h("option", { value: c.id }, c.name));
  credSel.value = i.credentialId || "";

  const enabledChk = h("input", { class: "kb-check", type: "checkbox" });
  enabledChk.checked = i.enabled !== false;
  const matchSel = h("select", { class: "kb-input" }, h("option", { value: "externalId" }, "External id"), h("option", { value: "name" }, "Name (adopt an existing record)"));
  matchSel.value = i.matchOn || "externalId";
  const pruneChk = h("input", { class: "kb-check", type: "checkbox" });
  pruneChk.checked = !!i.prune;
  const policySel = h("select", { class: "kb-input", id: "kbIntegrationPolicy" });
  for (const p of CONFLICT_POLICIES) policySel.append(h("option", { value: p.id, title: p.description }, p.label));
  policySel.value = i.conflictPolicy || "external";

  const typeMapArea = h("textarea", { class: "kb-input kb-code", rows: 4, placeholder: "Physical Server = server-physical\nFirewall = firewall" });
  typeMapArea.value = typeMapToText(i.typeMap);

  const enableChk = {};
  const dirSel = {};
  const fieldAreas = {};
  const entityRows = h("div", { class: "kb-integration-form-entities" });
  for (const entity of SYNC_ENTITIES) {
    const cfg = (i.entities && i.entities[entity.id]) || {};
    enableChk[entity.id] = h("input", { class: "kb-check", type: "checkbox" });
    enableChk[entity.id].checked = isEdit ? !!cfg.enabled : true;
    dirSel[entity.id] = h("select", { class: "kb-input kb-input-sm" });
    for (const d of SYNC_DIRECTIONS) dirSel[entity.id].append(h("option", { value: d.id }, d.short));
    dirSel[entity.id].value = cfg.direction || "pull";
    fieldAreas[entity.id] = h("textarea", { class: "kb-input kb-code", rows: 4, placeholder: "localField = remoteField" });
    fieldAreas[entity.id].value = fieldsToText(cfg.fields);
    const details = h(
      "details",
      { class: "kb-integration-form-fields" },
      h("summary", null, "Field mapping"),
      fieldAreas[entity.id],
    );
    entityRows.append(
      h(
        "div",
        { class: "kb-integration-form-entity" },
        h(
          "div",
          { class: "kb-integration-form-entity-head" },
          h("label", { class: "kb-check-label" }, enableChk[entity.id], h("span", null, (syncEntity(entity.id) || {}).label || entity.id)),
          dirSel[entity.id],
        ),
        details,
      ),
    );
  }

  const modal = openModal({
    title: isEdit ? "Edit integration" : "New integration",
    description: "Point IT-U at the client's system of record. Each entity is matched by external id; enable a direction per entity. With no field map, the documented defaults are used.",
    wide: true,
  });
  const form = h(
    "div",
    { class: "kb-integration-form" },
    h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), nameInput),
    h(
      "div",
      { class: "kb-field-row" },
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Kind"), kindSel),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Match records on"), matchSel),
    ),
    h(
      "div",
      { class: "kb-field-row" },
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Base URL"), baseUrlInput),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Credential"), credSel),
    ),
    h(
      "div",
      { class: "kb-check-row" },
      h("label", { class: "kb-check-label" }, enabledChk, h("span", null, "Enabled")),
      h("label", { class: "kb-check-label" }, pruneChk, h("span", null, "Prune records removed remotely")),
    ),
    h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "When a local edit conflicts with an incoming change"), policySel),
    h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Configuration-type map (remote = local)"), typeMapArea),
    h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Entities"), entityRows),
  );
  modal.overlay.querySelector(".kb-modal").insertBefore(form, modal.actions);

  modal.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: modal.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbIntegrationSaveBtn" }, isEdit ? "Save changes" : "Add integration"),
  );

  const save = async () => {
    modal.clearError();
    const def = {
      name: nameInput.value.trim(),
      kind: kindSel.value,
      baseUrl: baseUrlInput.value.trim(),
      credentialId: credSel.value || null,
      enabled: enabledChk.checked,
      matchOn: matchSel.value,
      prune: pruneChk.checked,
      conflictPolicy: policySel.value,
      typeMap: textToTypeMap(typeMapArea.value),
      entities: {},
    };
    for (const entity of SYNC_ENTITIES) {
      def.entities[entity.id] = { enabled: enableChk[entity.id].checked, direction: dirSel[entity.id].value, fields: textToFields(fieldAreas[entity.id].value) };
    }
    if (!def.name) {
      modal.showError("Give the integration a name.");
      return;
    }
    try {
      if (isEdit) await ctx.docs.updateIntegration(set.id, i.id, def, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      else await ctx.docs.addIntegration(set.id, def, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      modal.close();
      ctx.toast(isEdit ? "Saved “" + def.name + "”" : "Added “" + def.name + "”", "success");
      reload();
    } catch (e) {
      modal.showError(String((e && e.message) || e) + (e && e.hint ? " " + e.hint : ""));
    }
  };
  modal.actions.querySelector("#kbIntegrationSaveBtn").addEventListener("click", save);
  nameInput.focus();
}

async function removeIntegration(ctx, set, integration, reload) {
  const ok = await confirmDialog({
    title: "Remove “" + integration.name + "”?",
    message: "The connection and its run history are removed from this set. Records already synchronized stay — they are normal records — but they will no longer be kept in step with the remote system.",
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.docs.removeIntegration(set.id, integration.id, { updatedBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Removed “" + integration.name + "”", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

// ---- field-map / type-map text helpers ------------------------------------
function typeMapToText(map) {
  const entries = Object.entries(map || {});
  if (!entries.length) return "";
  return entries.map(([remote, local]) => remote + " = " + local).join("\n");
}

function textToTypeMap(text) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const remote = s.slice(0, eq).trim();
    const local = s.slice(eq + 1).trim();
    if (remote) out[remote] = local;
  }
  return out;
}

function fieldsToText(fields) {
  if (!fields || !fields.length) return "";
  return fields.map((f) => (f.remote && f.remote !== f.local ? f.local + " = " + f.remote : f.local)).join("\n");
}

function textToFields(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) {
      out.push([s, s]);
    } else {
      const local = s.slice(0, eq).trim();
      const remote = s.slice(eq + 1).trim();
      if (local) out.push([local, remote || local]);
    }
  }
  return out.length ? out : undefined;
}
