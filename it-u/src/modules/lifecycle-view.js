// src/modules/lifecycle-view.js — the Trackers station's lifecycle surface
// (roadmap tasks 26–27).
//
// Task 26 aggregates every dated item in a client's documentation set into one
// lifecycle view (framework/lifecycle.js). Task 27 turns that into work
// (framework/workflow.js): due-soon and overdue queues, owner assignment,
// snoozing, escalation, a recorded action log and an exportable renewal
// schedule. This module is the UI for both — the queues, the item list with its
// per-item actions, the per-asset roll-up, the schedule export and the
// lifecycle settings dialog. It reads only the workflow object the Trackers
// station already fetched, and every mutation goes back through the docs
// service so the workflow versions with the rest of the client's documentation.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal, downloadCsv, promptPanel } from "./shared.js";
import { expiryBadge } from "./tracker-view.js";
import { LIFECYCLE_KINDS, lifecycleKind, groupByAsset } from "../framework/lifecycle.js";
import { lifecycleActionDef } from "../framework/workflow.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

const KPI_TONE = { overdue: "bad", "due-soon": "warn", upcoming: "info", ok: "", none: "" };

// A lifecycle badge — shared with the domain/certificate editors.
export const lifecycleBadge = (item) => expiryBadge(item);

function sectionCard({ icon, name, count, id, actions = [], body }) {
  return h(
    "section",
    { class: "kb-card kb-record-section", id },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons[icon] || icons.clock }),
      h("h2", { class: "kb-section-name" }, name),
      count != null ? h("span", { class: "kb-count-pill" }, String(count)) : null,
      ...actions,
    ),
    body,
  );
}

function emptyLine(text) {
  return h("p", { class: "kb-muted kb-lifecycle-empty" }, text);
}

// One clickable lifecycle item row (name, kind, due, badge, owner).
function itemRow(ctx, set, item, opts, { compact = false } = {}) {
  const open = () => openLifecycleItem(ctx, set, item.id, opts);
  return h(
    "button",
    { class: "kb-lifecycle-row" + (compact ? " kb-lifecycle-row--compact" : ""), type: "button", dataset: { id: item.id, kind: item.kind }, onClick: open },
    h("span", { class: "kb-lifecycle-row-icon", html: icons[item.icon] || icons.clock }),
    h(
      "span",
      { class: "kb-lifecycle-row-main" },
      h("span", { class: "kb-lifecycle-row-name" }, item.sourceName),
      h(
        "span",
        { class: "kb-lifecycle-row-meta" },
        h("span", { class: "kb-lifecycle-row-kind" }, item.kindDef.label),
        item.typeName ? h("span", { class: "kb-muted" }, " · " + item.typeName) : null,
        item.escalation ? h("span", { class: "kb-badge kb-badge-danger" }, "Escalated") : null,
        item.snoozed ? h("span", { class: "kb-badge" }, "Snoozed") : null,
        compact ? lifecycleBadge(item) : null,
      ),
    ),
    compact ? null : h("span", { class: "kb-lifecycle-row-owner kb-muted" }, item.owner || "Unassigned"),
    compact ? null : h("span", { class: "kb-lifecycle-row-when" }, item.iso || "—"),
    compact ? null : lifecycleBadge(item),
  );
}

// ---- the whole lifecycle surface -------------------------------------------
export function renderLifecycle(ctx, set, wf, opts = {}) {
  const readonly = !!opts.readonly;
  const out = [];
  out.push(queueSection(ctx, set, wf, opts));
  out.push(itemsSection(ctx, set, wf, opts));
  out.push(assetSection(ctx, set, wf, opts));
  out.push(scheduleSection(ctx, set, wf, opts, readonly));
  return out;
}

function queueSection(ctx, set, wf, opts) {
  const cols = [
    { key: "overdue", label: "Overdue", tone: "bad" },
    { key: "dueSoon", label: "Due soon", tone: "warn" },
    { key: "unassigned", label: "Unassigned", tone: "" },
    { key: "escalated", label: "Escalated", tone: "bad" },
  ];
  const grid = h("div", { class: "kb-lifecycle-queues" });
  for (const col of cols) {
    const items = (wf.queues && wf.queues[col.key]) || [];
    const body = items.length
      ? h("div", { class: "kb-lifecycle-queue-list", id: "kbQueue-" + col.key }, items.slice(0, 6).map((it) => itemRow(ctx, set, it, opts, { compact: true })))
      : emptyLine("Nothing here.");
    grid.append(
      h(
        "div",
        { class: "kb-lifecycle-queue kb-lifecycle-queue--" + (col.tone || "plain"), dataset: { queue: col.key } },
        h("div", { class: "kb-lifecycle-queue-head" }, h("span", { class: "kb-lifecycle-queue-count" }, String(items.length)), h("span", { class: "kb-lifecycle-queue-label" }, col.label)),
        body,
        items.length > 6 ? h("div", { class: "kb-muted kb-lifecycle-more" }, "+" + (items.length - 6) + " more") : null,
      ),
    );
  }
  return sectionCard({ icon: "bell", name: "Renewal queues", count: wf.counts.attention, id: "kbLifecycleQueues", body: grid });
}

function itemsSection(ctx, set, wf, opts) {
  const kinds = LIFECYCLE_KINDS.filter((k) => (wf.byKind && wf.byKind[k.id] && wf.byKind[k.id].items.length) || wf.items.some((i) => i.kind === k.id));
  const select = h("select", { class: "kb-input kb-lifecycle-filter", id: "kbLifecycleFilter" }, h("option", { value: "" }, "All kinds"));
  for (const k of kinds) select.append(h("option", { value: k.id }, k.label));
  const tbody = h("tbody", { id: "kbLifecycleItemsBody" });
  const table = h(
    "table",
    { class: "kb-table kb-record-table" },
    h("thead", null, h("tr", null, h("th", null, "Asset"), h("th", null, "Item"), h("th", null, "Field"), h("th", null, "Due"), h("th", null, "Status"), h("th", null, "Owner"))),
    tbody,
  );
  const renderRows = () => {
    clear(tbody);
    const filter = select.value;
    const items = wf.items.filter((i) => !filter || i.kind === filter);
    if (!items.length) {
      tbody.append(h("tr", null, h("td", { colSpan: 6 }, emptyLine("No dated items for this filter."))));
      return;
    }
    for (const it of items) {
      tbody.append(
        h(
          "tr",
          { class: "kb-record-row", dataset: { id: it.id, kind: it.kind } },
          h(
            "td",
            null,
            h(
              "div",
              { class: "kb-record-name-row" },
              h("span", { class: "kb-record-name" }, it.sourceName),
              it.escalation ? h("span", { class: "kb-badge kb-badge-danger" }, "Escalated") : null,
              it.snoozed ? h("span", { class: "kb-badge" }, "Snoozed") : null,
            ),
            it.typeName ? h("div", { class: "kb-muted kb-record-sub" }, it.typeName) : null,
          ),
          h("td", null, h("span", { class: "kb-chip" }, it.kindDef.label)),
          h("td", { class: "kb-record-details" }, it.fieldLabel),
          h("td", null, it.iso || h("span", { class: "kb-muted" }, "—")),
          h("td", null, lifecycleBadge(it)),
          h("td", null, it.owner || h("span", { class: "kb-muted" }, "Unassigned")),
        ),
      );
    }
  };
  select.addEventListener("change", renderRows);
  const body = h("div", null, h("div", { class: "kb-lifecycle-toolbar" }, h("span", { class: "kb-lifecycle-toolbar-icon", html: icons.filter }), select), table);
  const card = sectionCard({ icon: "clock", name: "Lifecycle items", count: wf.items.length, id: "kbLifecycleItems", body });
  renderRows();
  return card;
}

function assetSection(ctx, set, wf, opts) {
  const assets = groupByAsset(wf.items);
  if (!assets.length) return sectionCard({ icon: "server", name: "By asset", count: 0, id: "kbLifecycleAssets", body: emptyLine("No dated items yet.") });
  const list = h("div", { class: "kb-lifecycle-assets" });
  for (const a of assets) {
    const next = a.next;
    list.append(
      h(
        "div",
        { class: "kb-lifecycle-asset", dataset: { id: a.ref.id } },
        h(
          "div",
          { class: "kb-lifecycle-asset-head" },
          h("span", { class: "kb-lifecycle-asset-name" }, a.name),
          a.detail ? h("span", { class: "kb-muted" }, " · " + a.detail) : null,
          h("span", { class: "kb-lifecycle-asset-when" }, next ? next.iso : "no date"),
        ),
        h("div", { class: "kb-lifecycle-asset-items" }, a.items.map((it) => itemRow(ctx, set, it, opts, { compact: true }))),
      ),
    );
  }
  return sectionCard({ icon: "layers", name: "By asset", count: assets.length, id: "kbLifecycleAssets", body: list });
}

function scheduleSection(ctx, set, wf, opts, readonly) {
  const rows = (wf.items || []).filter((i) => i.daysUntil != null).sort((a, b) => a.daysUntil - b.daysUntil);
  const table = h(
    "table",
    { class: "kb-table kb-record-table" },
    h("thead", null, h("tr", null, h("th", null, "Item"), h("th", null, "Asset"), h("th", null, "Due"), h("th", null, "Status"), h("th", null, "Owner"), h("th", null, "Last action"))),
  );
  const tbody = h("tbody");
  for (const it of rows) {
    tbody.append(
      h(
        "tr",
        { class: "kb-record-row" },
        h("td", null, h("span", { class: "kb-chip" }, it.kindDef.label), h("span", { class: "kb-muted" }, " " + it.fieldLabel)),
        h("td", null, it.sourceName),
        h("td", null, it.iso || "—"),
        h("td", null, lifecycleBadge(it)),
        h("td", null, it.owner || h("span", { class: "kb-muted" }, "—")),
        h("td", { class: "kb-record-details" }, it.lastAction ? actionText(it.lastAction) : h("span", { class: "kb-muted" }, "—")),
      ),
    );
  }
  table.append(tbody);
  const body = h("div", { class: "kb-lifecycle-schedule" }, rows.length ? table : emptyLine("No dated items to schedule yet."));
  const actions = [
    h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbLifecycleSettingsBtn", onClick: () => openLifecycleSettings(ctx, set, wf, opts) }, "Lifecycle settings"),
    h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbLifecycleExportBtn", onClick: () => exportRenewalSchedule(ctx, set, opts) }, "Export schedule"),
  ];
  if (readonly) actions.pop(); // settings still allowed? archived sets are read-only for records; keep export only
  return sectionCard({ icon: "download", name: "Renewal schedule", count: rows.length, id: "kbLifecycleSchedule", actions, body });
}

const actionText = (action) => {
  const def = lifecycleActionDef(action.action);
  const when = new Date(action.at).toLocaleDateString();
  const who = action.by && action.by !== "owner" ? " · " + action.by : "";
  return (def ? def.label : action.action) + (action.note ? " — " + action.note : "") + " (" + when + who + ")";
};

// ---- item detail dialog -----------------------------------------------------
export function openLifecycleItem(ctx, set, itemId, opts = {}) {
  const modal = openModal({ title: "Lifecycle item", wide: true });
  const body = h("div", { class: "kb-lifecycle-detail" });
  const box = modal.overlay.querySelector(".kb-modal");
  box.insertBefore(body, modal.actions);
  modal.actions.append(h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: modal.close }, "Close"));

  const mutate = async (fn) => {
    modal.clearError();
    try {
      const before = (await ctx.docs.lifecycleWorkflow(set.id, { typeOf: opts.typeOf })).actions.length;
      await fn();
      // The docset write lands a beat after the call resolves, so poll until the
      // change is observable before re-reading — otherwise the log renders one
      // action behind.
      for (let i = 0; i < 24; i++) {
        const wf = await ctx.docs.lifecycleWorkflow(set.id, { typeOf: opts.typeOf });
        if (wf.actions.length !== before) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      await refresh();
      if (opts.reload) opts.reload();
    } catch (e) {
      modal.showError(String((e && e.message) || e));
    }
  };

  async function refresh() {
    const wf = await ctx.docs.lifecycleWorkflow(set.id, { typeOf: opts.typeOf });
    const item = wf.items.find((i) => i.id === itemId);
    clear(body);
    if (!item) {
      modal.overlay.querySelector(".kb-modal-title").textContent = "Lifecycle item";
      body.append(h("p", { class: "kb-muted" }, "This item is no longer present — the underlying date may have been removed."));
      return;
    }
    modal.overlay.querySelector(".kb-modal-title").textContent = item.sourceName;
    body.append(renderItemDetail(ctx, set, item, wf, { readonly: opts.readonly, mutate }));
  }

  refresh().catch((e) => modal.showError(String((e && e.message) || e)));
  return modal;
}

function renderItemDetail(ctx, set, item, wf, { readonly, mutate }) {
  const out = [];
  out.push(
    h(
      "div",
      { class: "kb-lifecycle-detail-head" },
      h("span", { class: "kb-lifecycle-detail-icon", html: icons[item.icon] || icons.clock }),
      h(
        "div",
        { class: "kb-lifecycle-detail-titles" },
        h("h3", null, item.kindDef.label),
        h("div", { class: "kb-muted" }, [item.sourceDetail, item.typeName, item.fieldLabel].filter(Boolean).join(" · ")),
      ),
      lifecycleBadge(item),
    ),
  );
  out.push(
    h(
      "div",
      { class: "kb-lifecycle-facts" },
      fact("Asset", item.sourceName),
      fact("Due date", item.iso || "not recorded"),
      fact("Time", item.daysUntil == null ? "—" : item.daysUntil < 0 ? Math.abs(item.daysUntil) + " days overdue" : item.daysUntil + " days away"),
      fact("Lead time", item.leadDays + " days (due-soon at " + item.dueSoonDays + ")"),
    ),
  );
  if (item.escalation) {
    out.push(h("div", { class: "kb-banner kb-banner-warn" }, h("span", { class: "kb-banner-icon", html: icons.alert }), h("div", { class: "kb-banner-text" }, h("strong", null, "Escalated — overdue " + item.escalation.overdueBy + " days."), item.escalation.to ? " Route to " + item.escalation.to + "." : "")));
  }
  if (item.snoozed) {
    out.push(h("div", { class: "kb-banner" }, h("span", { class: "kb-banner-icon", html: icons.clock }), h("div", { class: "kb-banner-text" }, "Snoozed until " + new Date(item.snoozedUntil).toLocaleDateString() + ".")));
  }

  // Owner
  const ownerInput = h("input", { class: "kb-input", type: "text", list: "kbLifecycleOwners", placeholder: "Person, role or team", value: item.owner || "" });
  const owners = [...new Set([...(set.records.contacts || []).map((c) => c.name), "Help desk", "Service desk", "Account manager"].filter(Boolean))];
  const datalist = h("datalist", { id: "kbLifecycleOwners" }, owners.map((o) => h("option", { value: o })));
  out.push(
    h(
      "div",
      { class: "kb-lifecycle-owner-row" },
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Owner"), ownerInput, datalist),
      readonly ? null : h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => mutate(() => ctx.docs.assignLifecycle(set.id, item.id, ownerInput.value, { updatedBy: whoami(ctx), actor: whoami(ctx) })) }, "Assign"),
      readonly || !item.owner ? null : h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => mutate(() => ctx.docs.assignLifecycle(set.id, item.id, "", { updatedBy: whoami(ctx), actor: whoami(ctx) })) }, "Clear"),
    ),
  );

  if (!readonly) {
    const btn = (label, fn, cls = "kb-btn-ghost") => h("button", { class: "kb-btn " + cls + " kb-btn-sm", type: "button", onClick: fn }, label);
    out.push(
      h(
        "div",
        { class: "kb-lifecycle-actions-row" },
        btn("Snooze 7 days", () => mutate(() => ctx.docs.snoozeLifecycle(set.id, item.id, 7, { updatedBy: whoami(ctx), actor: whoami(ctx) }))),
        btn("Snooze 30 days", () => mutate(() => ctx.docs.snoozeLifecycle(set.id, item.id, 30, { updatedBy: whoami(ctx), actor: whoami(ctx) }))),
        item.snoozed ? btn("Clear snooze", () => mutate(() => ctx.docs.snoozeLifecycle(set.id, item.id, 0, { updatedBy: whoami(ctx), actor: whoami(ctx) }))) : null,
        btn("Mark renewed", () => mutate(() => ctx.docs.recordLifecycleAction(set.id, item.id, "renewed", { updatedBy: whoami(ctx), actor: whoami(ctx) })), "kb-btn-primary"),
        btn("Escalate", () => mutate(() => ctx.docs.recordLifecycleAction(set.id, item.id, "escalated", { updatedBy: whoami(ctx), actor: whoami(ctx) }))),
        btn("Dismiss", () => mutate(() => ctx.docs.recordLifecycleAction(set.id, item.id, "dismissed", { updatedBy: whoami(ctx), actor: whoami(ctx) }))),
        btn("Add note", async () => {
          const note = await promptPanel({ title: "Note about " + item.sourceName, placeholder: "What action was taken?", confirmLabel: "Save note" });
          if (note != null && note !== "") await mutate(() => ctx.docs.recordLifecycleAction(set.id, item.id, "noted", { updatedBy: whoami(ctx), actor: whoami(ctx), note }));
        }),
      ),
    );
  }

  const log = (wf.actions || []).filter((a) => a.itemId === item.id).reverse();
  out.push(
    h(
      "div",
      { class: "kb-lifecycle-log" },
      h("h4", null, "Action taken"),
      log.length
        ? h("ul", null, log.map((a) => h("li", { class: "kb-lifecycle-log-item" }, h("span", { class: "kb-lifecycle-log-when kb-muted" }, new Date(a.at).toLocaleString()), h("span", null, actionText(a)))))
        : h("p", { class: "kb-muted" }, "No action recorded yet."),
    ),
  );
  return h("div", null, ...out);
}

function fact(label, value) {
  return h("div", { class: "kb-lifecycle-fact" }, h("span", { class: "kb-lifecycle-fact-label kb-muted" }, label), h("span", { class: "kb-lifecycle-fact-value" }, value));
}

// ---- settings dialog --------------------------------------------------------
export function openLifecycleSettings(ctx, set, wf, opts = {}) {
  const config = wf.config || { leadDays: {}, dueSoonDays: {}, escalation: {} };
  const modal = openModal({
    title: "Lifecycle settings",
    description: "How early each kind of item starts warning, and when a long-overdue item escalates. A single record may still override its own lead time with its renewal-alert field.",
    wide: true,
  });
  const grid = h("div", { class: "kb-lifecycle-settings" });
  grid.append(h("div", { class: "kb-lifecycle-settings-head" }, h("span", null, "Item kind"), h("span", null, "Lead time (days)"), h("span", null, "Due soon at (days)")));
  const leadInputs = {};
  const soonInputs = {};
  for (const kind of LIFECYCLE_KINDS) {
    leadInputs[kind.id] = h("input", { class: "kb-input", type: "number", min: 0, placeholder: String(kind.defaultLeadDays), value: config.leadDays && config.leadDays[kind.id] != null ? String(config.leadDays[kind.id]) : "" });
    soonInputs[kind.id] = h("input", { class: "kb-input", type: "number", min: 0, placeholder: String(kind.dueSoonDays), value: config.dueSoonDays && config.dueSoonDays[kind.id] != null ? String(config.dueSoonDays[kind.id]) : "" });
    grid.append(
      h(
        "div",
        { class: "kb-lifecycle-settings-row" },
        h("span", { class: "kb-lifecycle-settings-name" }, h("span", { class: "kb-lifecycle-settings-icon", html: icons[kind.icon] || icons.clock }), kind.label),
        leadInputs[kind.id],
        soonInputs[kind.id],
      ),
    );
  }
  const afterDays = h("input", { class: "kb-input", type: "number", min: 0, placeholder: "14", value: config.escalation && config.escalation.afterDays != null ? String(config.escalation.afterDays) : "" });
  const escTo = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Help desk", value: (config.escalation && config.escalation.to) || "" });
  grid.append(h("div", { class: "kb-lifecycle-settings-row kb-lifecycle-settings-row--esc" }, h("span", { class: "kb-lifecycle-settings-name" }, h("span", { class: "kb-lifecycle-settings-icon", html: icons.alert }), "Escalate when overdue by"), afterDays, h("span", { class: "kb-muted kb-lifecycle-settings-to" }, "→")));
  grid.append(h("div", { class: "kb-lifecycle-settings-row kb-lifecycle-settings-row--esc2" }, h("span", { class: "kb-lifecycle-settings-name kb-muted" }, "Escalate to"), escTo));
  modal.overlay.querySelector(".kb-modal").insertBefore(grid, modal.actions);

  modal.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: modal.close }, "Cancel"),
    h(
      "button",
      {
        class: "kb-btn kb-btn-primary",
        type: "button",
        onClick: async () => {
          modal.clearError();
          const leadDays = {};
          const dueSoonDays = {};
          for (const kind of LIFECYCLE_KINDS) {
            if (leadInputs[kind.id].value !== "") leadDays[kind.id] = Number(leadInputs[kind.id].value);
            if (soonInputs[kind.id].value !== "") dueSoonDays[kind.id] = Number(soonInputs[kind.id].value);
          }
          try {
            await ctx.docs.configureLifecycle(
              set.id,
              { leadDays, dueSoonDays, escalation: { afterDays: afterDays.value === "" ? undefined : Number(afterDays.value), to: escTo.value.trim() } },
              { updatedBy: whoami(ctx), actor: whoami(ctx) },
            );
            modal.close();
            ctx.toast("Lifecycle settings saved", "success");
            if (opts.reload) opts.reload();
          } catch (e) {
            modal.showError(String((e && e.message) || e));
          }
        },
      },
      "Save settings",
    ),
  );
  return modal;
}

// ---- schedule export --------------------------------------------------------
export async function exportRenewalSchedule(ctx, set, opts = {}) {
  try {
    const res = await ctx.docs.renewalSchedule(set.id, { typeOf: opts.typeOf });
    const rows = res.rows || [];
    const header = ["Kind", "Subject", "Asset", "Asset type", "Field", "Due date", "Days until", "Status", "Owner", "Escalated", "Snoozed until", "Last action", "Last action date"];
    const data = rows.map((r) => [r.kind, r.subject, r.asset, r.assetType, r.field, r.dueDate, r.daysUntil == null ? "" : r.daysUntil, r.status, r.owner, r.escalated, r.snoozedUntil, r.lastAction, r.lastActionAt]);
    downloadCsv((set.name || "documentation-set").replace(/[^\w.-]+/g, "-") + "-renewal-schedule.csv", [header, ...data]);
    ctx.toast("Renewal schedule exported (" + rows.length + " item" + (rows.length === 1 ? "" : "s") + ")", "success");
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}
