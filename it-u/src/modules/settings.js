// src/modules/settings.js — the Settings station.
//
// Task 5's working surface lives here: the storage & sync status, the conflict
// resolver (keep-mine / keep-theirs / field-level merge), full backup &
// validated restore (download, publish a hosted backup document, restore from
// either with a previewed plan), and the capacity view that guides archival.
// Templates are listed here too (save-as-template lives on a set's page; the
// template designer/library arrives with Phase 3 tasks 12–13).

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, emptyState, errorState } from "../framework/states.js";
import { viewPanel, promptPanel, relTime, fmtBytes, copyText, openModal, downloadText } from "./shared.js";
import { RECORD_TYPE_META, RECORD_TYPES } from "../framework/docsets.js";
import { renderGroupsCard } from "./groups-view.js";
import { renderRolesCard } from "./roles-view.js";
import { renderIdpCard } from "./idp-view.js";
import { renderActivityCard } from "./activity-view.js";
import { renderAppearanceCard } from "./theme-view.js";
import { runIntegritySuiteAll, integrityReportToMarkdown } from "../framework/integrity.js";
import { attachSectionHelp } from "../framework/help.js";
import { attachSectionAsk } from "../framework/ai.js";
import { fixtureCatalog, seedFixture } from "../framework/fixtures.js";
import {
  contentModelReference,
  provenanceReference,
  RELATIONSHIP_CONVENTIONS,
  relationshipReference,
  DEPLOYMENT_FLOW,
  REDACTION_RULES,
  extensionGuides,
  playbookToMarkdown,
  playbookCoverage,
} from "../framework/playbook.js";

const DESC =
  "Storage, synchronization, conflicts, backup and restore, capacity and templates — the operational controls for this documentation repository.";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const typeLabel = (t) => (RECORD_TYPE_META[t] && RECORD_TYPE_META[t].label) || t;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export default {
  id: "settings",
  label: "Settings",
  desc: DESC,
  icon: icons.gear,
  render(ctx) {
    renderSettings(ctx);
  },
};

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------
function renderSettings(ctx) {
  const body = h("div", { class: "kb-settings-body" }, loadingState({ label: "Loading storage status…" }));
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Settings", desc: DESC, body }));
  load(ctx, body);
}

async function load(ctx, body) {
  let data;
  try {
    const [status, overview, capacity, published, templates, groups, accessMeta] = await Promise.all([
      ctx.store.getStatus().catch(() => null),
      ctx.sync.getOverview().catch(() => null),
      ctx.archive.capacity().catch(() => null),
      ctx.backup.listPublished().catch(() => []),
      ctx.templates.listAll().catch(() => []),
      ctx.access ? ctx.access.list().catch(() => []) : Promise.resolve([]),
      ctx.access ? ctx.access.libraryMeta().catch(() => null) : Promise.resolve(null),
    ]);
    data = { status, overview, capacity, published, templates, groups, accessMeta };
  } catch (e) {
    clear(body);
    body.append(errorState({ title: "Couldn’t load settings", description: String((e && e.message) || e), onRetry: () => load(ctx, body) }));
    return;
  }
  const reload = () => load(ctx, body);
  clear(body);
  body.append(
    renderAppearanceCard(ctx, data, reload),
    storageCard(ctx, data, reload),
    conflictsCard(ctx, data, reload),
    capacityCard(ctx, data, reload),
    backupCard(ctx, data, reload),
    templatesCard(ctx, data, reload),
    renderGroupsCard(ctx, data, reload),
    renderRolesCard(ctx, data, reload),
    renderIdpCard(ctx, data, reload),
    renderActivityCard(ctx, data, reload),
    integrityCard(ctx, data, reload),
    playbookCard(ctx),
  );
  attachSectionHelp(body);
  attachSectionAsk(body, { ctx });
}

// ---------------------------------------------------------------------------
// storage & sync
// ---------------------------------------------------------------------------
function storageCard(ctx, { status, overview }, reload) {
  const docs = (status && status.docCount) || 0;
  const bytes = (status && status.totalBytes) || 0;
  const conflicts = (overview && overview.conflicts.length) || 0;
  const drafts = (overview && overview.drafts.length) || 0;
  const last = overview && overview.lastReconciledAt ? relTime(overview.lastReconciledAt) : "never";
  const grid = h(
    "div",
    { class: "kb-kpi-row" },
    kpi(String(docs), "Documents"),
    kpi(fmtBytes(bytes), "Stored"),
    kpi((status && status.namespace) || "—", "Namespace"),
    kpi(conflicts ? String(conflicts) : "0", "Conflicts", conflicts ? "needs attention" : "all clear"),
    kpi(String(drafts), "Pending drafts"),
    kpi(last, "Last reconciled"),
  );
  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h(
      "button",
      {
        class: "kb-btn kb-btn-primary",
        type: "button",
        id: "kbReconcileBtn",
        onClick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const res = await ctx.sync.reconcile();
            const n = (res && res.conflicts.length) || 0;
            ctx.toast(n ? `${n} conflict${n === 1 ? "" : "s"} to resolve` : "Everything is up to date", n ? "warning" : "success");
          } catch (err) {
            ctx.toast(String((err && err.message) || err), "error", 5200);
          } finally {
            reload();
          }
        },
      },
      "Check for updates now",
    ),
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: reload }, "Refresh"),
  );
  return h("section", { class: "kb-card kb-settings-card", dataset: { card: "storage" } },
    cardHead(icons.server, "Storage & synchronization", String(docs) + " documents"),
    h("p", { class: "kb-muted" }, "Documents live in the versioned cloud store with a local cache. Changes made while offline are staged as drafts and pushed automatically once the connection returns."),
    grid,
    actions,
  );
}

// ---------------------------------------------------------------------------
// conflicts
// ---------------------------------------------------------------------------
function conflictsCard(ctx, { overview }, reload) {
  const conflicts = (overview && overview.conflicts) || [];
  const list = h("div", { class: "kb-conflict-list" });
  if (!conflicts.length) {
    list.append(h("p", { class: "kb-muted" }, "No conflicts. When two devices change the same document, both versions are preserved here until you choose what to keep."));
  } else {
    for (const { id, conflict } of conflicts) {
      list.append(conflictRow(ctx, id, conflict, reload));
    }
  }
  return h("section", { class: "kb-card kb-settings-card", dataset: { card: "conflicts" } },
    cardHead(icons.alert, "Conflicts", conflicts.length ? String(conflicts.length) + " open" : "none"),
    list,
  );
}

function conflictRow(ctx, id, conflict, reload) {
  const mine = conflict.mine || {};
  const theirs = conflict.theirs || {};
  return h(
    "div",
    { class: "kb-conflict-item", dataset: { id } },
    h("span", { class: "kb-conflict-icon", html: icons.alert }),
    h(
      "div",
      { class: "kb-conflict-main" },
      h("span", { class: "kb-conflict-name" }, id),
      h(
        "span",
        { class: "kb-conflict-meta" },
        "detected " + relTime(conflict.detectedAt) + " · mine v" + ((mine.baseVersion || 0) + 1) + " · theirs v" + (theirs.version || "?"),
      ),
    ),
    h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", onClick: () => resolveDialog(ctx, id, conflict, reload) }, "Resolve"),
  );
}

// A human summary of the differences between the two sides of a conflict.
function diffRows(mine, theirs) {
  const rows = [];
  if (!isObj(mine) || !isObj(theirs)) {
    rows.push({ field: "(document)", mine: JSON.stringify(mine).slice(0, 120), theirs: JSON.stringify(theirs).slice(0, 120) });
    return rows;
  }
  if ((mine.name || "") !== (theirs.name || "")) rows.push({ field: "Name", mine: mine.name || "—", theirs: theirs.name || "—" });
  if ((mine.kind || "") !== (theirs.kind || "")) rows.push({ field: "Kind", mine: mine.kind || "—", theirs: theirs.kind || "—" });
  for (const t of RECORD_TYPES) {
    const ma = (mine.records && mine.records[t]) || [];
    const ta = (theirs.records && theirs.records[t]) || [];
    const mn = new Set(ma.map((r) => r.name));
    const tn = new Set(ta.map((r) => r.name));
    const onlyMine = [...mn].filter((n) => !tn.has(n));
    const onlyTheirs = [...tn].filter((n) => !mn.has(n));
    if (onlyMine.length) rows.push({ field: typeLabel(t) + " · only mine", mine: onlyMine.slice(0, 5).join(", "), theirs: "—" });
    if (onlyTheirs.length) rows.push({ field: typeLabel(t) + " · only theirs", mine: "—", theirs: onlyTheirs.slice(0, 5).join(", ") });
  }
  if (!rows.length) rows.push({ field: "Content", mine: "identical", theirs: "identical" });
  return rows;
}

function resolveDialog(ctx, id, conflict, reload) {
  const rows = diffRows(conflict.mine && conflict.mine.data, conflict.theirs && conflict.theirs.data);
  const table = h(
    "table",
    { class: "kb-table kb-diff-table" },
    h("thead", null, h("tr", null, h("th", null, "Field"), h("th", null, "Mine"), h("th", null, "Theirs"))),
    h("tbody", null, rows.map((r) => h("tr", null, h("td", { class: "kb-diff-field" }, r.field), h("td", null, String(r.mine)), h("td", null, String(r.theirs))))),
  );
  const m = openModal({
    title: "Resolve conflict",
    description: "Both versions are preserved. Choose which to keep, or merge field-by-field.",
    wide: true,
    children: [table],
  });
  const resolve = async (choice, label) => {
    m.clearError();
    try {
      const out = await ctx.sync.resolveConflict(id, choice);
      m.close();
      ctx.toast(`${label} — ${out.action}`, "success");
      reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  };
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbConflictMine", onClick: () => resolve("mine", "Kept mine") }, "Keep mine"),
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => resolve("theirs", "Kept theirs") }, "Keep theirs"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbConflictMerge", onClick: () => resolve("merge", "Merged") }, "Merge both"),
  );
}

// ---------------------------------------------------------------------------
// capacity
// ---------------------------------------------------------------------------
function capacityCard(ctx, { capacity }, reload) {
  const list = h("div", { class: "kb-capacity-list" });
  if (!capacity || !capacity.docsets.length) {
    list.append(h("p", { class: "kb-muted" }, "No documentation sets yet."));
  } else {
    for (const d of capacity.docsets) list.append(capacityRow(ctx, d, capacity.ceiling));
  }
  return h("section", { class: "kb-card kb-settings-card", dataset: { card: "capacity" } },
    cardHead(icons.layers, "Capacity", capacity ? fmtBytes(capacity.totalBytes) + " of " + fmtBytes(capacity.ceiling) + " per set" : ""),
    h("p", { class: "kb-muted" }, "Each client’s documentation is one versioned document. When a set approaches the ceiling, archive retired clients to keep the active repository lean — archived sets stay fully readable and restorable."),
    list,
  );
}

function capacityRow(ctx, d, ceiling) {
  const pct = ceiling > 0 ? Math.min(100, Math.round((d.bytes / ceiling) * 100)) : 0;
  const state = d.archived ? "archived" : d.state;
  return h(
    "div",
    { class: "kb-capacity-item", dataset: { id: d.id, state } },
    h(
      "div",
      { class: "kb-capacity-head" },
      h("a", { class: "kb-capacity-name", href: "#/organizations/" + d.id }, d.name),
      h("span", { class: "kb-capacity-num" }, fmtBytes(d.bytes) + " · " + d.records + " records"),
      h("span", { class: "kb-badge kb-badge-cap kb-badge-cap--" + state }, state === "over" ? "Over ceiling" : state === "near" ? "Near ceiling" : state === "archived" ? "Archived" : "OK"),
    ),
    h("div", { class: "kb-progress" }, h("div", { class: "kb-progress-fill kb-progress-fill--" + state, style: "width:" + pct + "%" })),
  );
}

// ---------------------------------------------------------------------------
// backup & restore
// ---------------------------------------------------------------------------
function backupCard(ctx, { published }, reload) {
  const fileInput = h("input", { class: "kb-input", type: "file", accept: ".json,application/json", id: "kbBackupFile" });
  const pasteBox = h("textarea", { class: "kb-input", rows: 3, placeholder: "…or paste backup JSON here", id: "kbBackupPaste" });

  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h(
      "button",
      {
        class: "kb-btn kb-btn-primary",
        type: "button",
        id: "kbBackupDownloadBtn",
        onClick: async () => {
          try {
            const res = await ctx.backup.download({ createdBy: whoami(ctx) });
            ctx.toast(`Backup downloaded — ${res.counts.docsets} set(s), ${res.counts.records} records`, "success", 5200);
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        },
      },
      "Download full backup",
    ),
    h(
      "button",
      {
        class: "kb-btn kb-btn-ghost",
        type: "button",
        id: "kbBackupPublishBtn",
        onClick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const entry = await ctx.backup.publish(undefined, { createdBy: whoami(ctx) });
            ctx.toast("Backup published", "success");
            copyText(entry.url, ctx.toast);
            reload();
          } catch (err) {
            ctx.toast(String((err && err.message) || err), "error", 6200);
          } finally {
            btn.disabled = false;
          }
        },
      },
      "Publish backup",
    ),
  );

  const restoreRow = h(
    "div",
    { class: "kb-restore-row" },
    fileInput,
    pasteBox,
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbRestorePreviewBtn", onClick: () => startRestore(ctx, fileInput, pasteBox, reload) }, "Validate & restore…"),
  );

  const publishedList = h("div", { class: "kb-published-list" });
  if (!published.length) {
    publishedList.append(h("p", { class: "kb-muted" }, "No published backups yet."));
  } else {
    for (const p of published) {
      publishedList.append(
        h(
          "div",
          { class: "kb-published-item", dataset: { url: p.url } },
          h(
            "div",
            { class: "kb-published-main" },
            h("span", { class: "kb-published-name" }, relTime(p.at) + " · " + ((p.counts && p.counts.docsets) || 0) + " set(s) · " + fmtBytes(p.bytes)),
            h("a", { class: "kb-published-url", href: p.url, target: "_blank", rel: "noopener" }, p.url),
          ),
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => copyText(p.url, ctx.toast) }, "Copy"),
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: async () => { await ctx.backup.removePublished(p.url); reload(); } }, "Forget"),
        ),
      );
    }
  }

  return h("section", { class: "kb-card kb-settings-card", dataset: { card: "backup" } },
    cardHead(icons.shield, "Backup & restore", published.length ? published.length + " published" : ""),
    h("p", { class: "kb-muted" }, "A backup holds every documentation set exactly as stored. A backup is validated (schema, records and relationship graph) before it is applied, and restore is reversible and idempotent — re-running the same backup changes nothing."),
    actions,
    h("div", { class: "kb-subhead" }, "Restore"),
    restoreRow,
    h("div", { class: "kb-subhead" }, "Published backups"),
    publishedList,
  );
}

async function startRestore(ctx, fileInput, pasteBox, reload) {
  let text = pasteBox.value.trim();
  if (!text && fileInput.files && fileInput.files[0]) {
    try {
      text = await fileInput.files[0].text();
    } catch (e) {
      ctx.toast("Couldn’t read that file", "error", 5200);
      return;
    }
  }
  if (!text) {
    ctx.toast("Choose a backup file or paste backup JSON first", "warning", 5200);
    return;
  }
  const report = ctx.backup.validate(text);
  if (!report.ok) {
    const m = openModal({
      title: "Backup failed validation",
      description: "This backup was NOT restored. Fix the problems below and try again.",
      wide: true,
      children: [h("ul", { class: "kb-error-list" }, report.errors.slice(0, 12).map((e) => h("li", null, e)))],
    });
    m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
    return;
  }
  const preview = await ctx.backup.preview(text, { mode: "merge" });
  const rows = preview.plan.map((p) =>
    h("tr", null, h("td", null, p.name), h("td", null, p.action), h("td", null, String(p.records)), h("td", null, p.addedRecords != null ? "+" + p.addedRecords : "—")),
  );
  const m = openModal({
    title: "Restore backup",
    description: `${report.summary.docsets} set(s), ${report.summary.records} records. Choose how to apply it.`,
    wide: true,
    children: [
      h(
        "table",
        { class: "kb-table kb-diff-table" },
        h("thead", null, h("tr", null, h("th", null, "Set"), h("th", null, "Action"), h("th", null, "Records"), h("th", null, "New"))),
        h("tbody", null, rows),
      ),
      report.warnings.length ? h("p", { class: "kb-muted" }, report.warnings.length + " warning(s): " + report.warnings.slice(0, 3).join(" ")) : null,
    ],
  });
  const doRestore = async (mode) => {
    m.clearError();
    try {
      const res = await ctx.backup.restore(text, { mode, updatedBy: whoami(ctx) });
      m.close();
      const changed = res.created.length + res.merged.length + res.replaced.length;
      ctx.toast(`Restore complete — ${changed} set(s) updated, ${res.unchanged.length} unchanged`, "success", 6200);
      reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  };
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbRestoreMergeBtn", onClick: () => doRestore("merge") }, "Restore (merge)"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbRestoreReplaceBtn", onClick: () => doRestore("replace") }, "Replace"),
  );
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------
function templatesCard(ctx, { templates }, reload) {
  const list = h("div", { class: "kb-template-list" });
  if (!templates.length) {
    list.append(h("p", { class: "kb-muted" }, "No templates yet. Open a documentation set and choose “Save as template” to capture its structure for reuse."));
  } else {
    for (const t of templates) {
      list.append(
        h(
          "div",
          { class: "kb-template-item", dataset: { id: t.id } },
          h(
            "div",
            { class: "kb-template-main" },
            h("span", { class: "kb-template-name" }, t.name, t.builtin ? h("span", { class: "kb-badge kb-badge-builtin", title: "Ships with IT-U — copy it by creating a set" }, "Built-in") : null),
            h("span", { class: "kb-template-meta" }, (t.counts.records || 0) + " records · " + (t.counts.links || 0) + " links" + (t.basedOnName ? " · based on " + t.basedOnName : "")),
          ),
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => applyTemplate(ctx, t) }, "Create set"),
          t.builtin ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: async () => { await ctx.templates.remove(t.id); ctx.toast("Template removed", "success"); reload(); } }, "Delete"),
        ),
      );
    }
  }
  const builtinCount = templates.filter((t) => t.builtin).length;
  return h("section", { class: "kb-card kb-settings-card", dataset: { card: "templates" } },
    cardHead(icons.clipboard, "Templates", templates.length ? String(templates.length) : ""),
    builtinCount ? h("p", { class: "kb-muted" }, builtinCount + " built-in starter template" + (builtinCount === 1 ? "" : "s") + " ship with IT-U. Apply one when creating a set, or save your own from any documentation set.") : null,
    list,
  );
}

async function applyTemplate(ctx, tpl) {
  const name = await promptPanel({ title: "Create set from “" + tpl.name + "”", placeholder: "New client, department or business unit name", confirmLabel: "Create" });
  if (!name) return;
  // Instantiating a template is a real cloud write (seconds), so keep the user
  // informed with a blocking busy card instead of a silent gap before the toast.
  const busy = h(
    "div",
    { class: "kb-modal-overlay" },
    h(
      "div",
      { class: "kb-modal kb-busy-card", role: "status", "aria-live": "polite" },
      h("span", { class: "spinner" }),
      h("p", {}, "Creating “" + name + "” from “" + tpl.name + "”…"),
    ),
  );
  document.body.append(busy);
  try {
    const res = await ctx.templates.apply(tpl.id, { name, createdBy: whoami(ctx) });
    ctx.toast("Created “" + res.set.name + "”", "success");
    ctx.go("#/organizations/" + res.set.id);
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  } finally {
    busy.remove();
  }
}

// ---------------------------------------------------------------------------
// integrity checks & fixtures (task 52)
// ---------------------------------------------------------------------------
function integrityCard(ctx, data, reload) {
  const resultsEl = h("div", { class: "kb-int-results" }, h("p", { class: "kb-muted" }, "Run the audit to check every client's documentation against all six integrity checks."));
  let audit = null;

  const runBtn = h(
    "button",
    { class: "kb-btn kb-btn-primary", type: "button", id: "kbIntegrityRunBtn" },
    "Run integrity checks",
  );
  const downloadBtn = h(
    "button",
    {
      class: "kb-btn kb-btn-ghost",
      type: "button",
      id: "kbIntegrityDownloadBtn",
      disabled: true,
      onClick: () => audit && downloadText("itu-integrity-report.md", integrityReportToMarkdown(audit), "text/markdown;charset=utf-8"),
    },
    "Download report",
  );

  const fixtureSel = h("select", { class: "kb-input kb-input-sm kb-int-fixture", id: "kbIntegrityFixtureSel" });
  for (const f of fixtureCatalog()) fixtureSel.append(h("option", { value: f.id, title: f.description }, f.label));
  const addFixtureBtn = h(
    "button",
    { class: "kb-btn kb-btn-ghost", type: "button", id: "kbIntegrityFixtureBtn" },
    "Add fixture set",
  );

  function setRow(report) {
    const chips = h("div", { class: "kb-int-checks" });
    for (const check of report.checks) {
      chips.append(
        h(
          "span",
          { class: "kb-int-check kb-int-check--" + check.status, title: check.description + (check.error ? " — " + check.error : "") },
          check.label + (check.count ? " " + check.count : ""),
        ),
      );
    }
    const row = h(
      "div",
      { class: "kb-int-set", dataset: { set: report.setId } },
      h(
        "div",
        { class: "kb-int-set-head" },
        h("span", { class: "kb-int-set-name" }, report.client || report.setId),
        h("span", { class: "kb-badge kb-int-badge--" + (report.ok ? "pass" : "fail") }, report.ok ? "Passed" : "Failed"),
        h("span", { class: "kb-int-set-meta" }, report.counts.errors + " error(s) · " + report.counts.warnings + " warning(s)"),
      ),
      chips,
    );
    const findings = report.findings.filter((f) => f.level === "error").slice(0, 8);
    if (findings.length) {
      row.append(h("ul", { class: "kb-int-findings" }, findings.map((f) => h("li", { class: "kb-int-finding kb-int-finding--" + f.level }, f.message))));
    }
    return row;
  }

  function renderResults() {
    clear(resultsEl);
    const s = audit.summary;
    resultsEl.append(
      h(
        "div",
        { class: "kb-int-summary" },
        h("span", { class: "kb-int-summary-line" }, s.sets + " set(s) checked — " + (s.ok ? "all passed" : s.failing + " failing")),
        h("span", { class: "kb-int-count kb-int-count--err" }, s.errors + " error" + (s.errors === 1 ? "" : "s")),
        h("span", { class: "kb-int-count kb-int-count--warn" }, s.warnings + " warning" + (s.warnings === 1 ? "" : "s")),
      ),
    );
    if (!audit.reports.length) {
      resultsEl.append(h("p", { class: "kb-muted" }, "No documentation sets to audit yet."));
      return;
    }
    for (const report of audit.reports) resultsEl.append(setRow(report));
  }

  async function run() {
    runBtn.disabled = true;
    clear(resultsEl);
    resultsEl.append(loadingState({ label: "Auditing every documentation set…" }));
    try {
      const metas = await ctx.docs.summaries({ includeArchived: true });
      const sets = [];
      for (const m of metas) {
        const set = await ctx.docs.get(m.id, { force: true }).catch(() => null);
        if (set) sets.push(set);
      }
      audit = runIntegritySuiteAll(sets, { now: Date.now() });
      downloadBtn.disabled = false;
      renderResults();
      const s = audit.summary;
      ctx.toast(s.ok ? "Integrity checks passed for " + s.sets + " set(s)" : s.errors + " integrity error(s) across " + s.failing + " set(s)", s.ok ? "success" : "warning", 5200);
    } catch (e) {
      clear(resultsEl);
      resultsEl.append(errorState({ title: "Couldn’t run the integrity checks", description: String((e && e.message) || e) }));
    } finally {
      runBtn.disabled = false;
    }
  }
  runBtn.addEventListener("click", run);

  addFixtureBtn.addEventListener("click", async () => {
    const spec = fixtureCatalog().find((f) => f.id === fixtureSel.value);
    const name = await promptPanel({ title: "Add “" + (spec ? spec.label : "fixture") + "” set", placeholder: "Name for the new documentation set", confirmLabel: "Add fixture set" });
    if (!name) return;
    addFixtureBtn.disabled = true;
    try {
      const res = await seedFixture(ctx.docs, fixtureSel.value, { name, createdBy: whoami(ctx) });
      ctx.toast("Added “" + res.name + "” — " + res.records + " records, " + res.links + " links", "success", 5200);
      reload();
    } catch (e) {
      ctx.toast(String((e && e.message) || e), "error", 6200);
    } finally {
      addFixtureBtn.disabled = false;
    }
  });

  const fixturesAvailable = fixtureCatalog().length > 0;
  return h(
    "section",
    { class: "kb-card kb-settings-card", dataset: { card: "integrity" } },
    cardHead(icons.shield, "Integrity checks", data && data.status ? data.status.docCount + " docs" : ""),
    h(
      "p",
      { class: "kb-muted" },
      "One audit over every client: every record classified, every relationship target present and readable both ways, every required field enforced, no orphan records, no credential leaked into an export, and every export parseable. Fixture sets (a healthy all-model client and an older-schema set) let you see the checks pass and catch a known gap.",
    ),
    h("div", { class: "kb-actions-row" }, runBtn, downloadBtn),
    h("div", { class: "kb-subhead" }, "Fixture sets"),
    h(
      "div",
      { class: "kb-int-fixture-row" },
      fixtureSel,
      fixturesAvailable ? addFixtureBtn : h("span", { class: "kb-muted" }, "No fixtures available."),
    ),
    h("div", { class: "kb-subhead" }, "Results"),
    resultsEl,
  );
}

// ---------------------------------------------------------------------------
// playbook & reference (task 53)
// ---------------------------------------------------------------------------
function pbDetails(title, hint, children) {
  return h(
    "details",
    { class: "kb-pb-details" },
    h("summary", { class: "kb-pb-summary" }, h("span", { class: "kb-pb-summary-title" }, title), hint ? h("span", { class: "kb-pb-hint" }, hint) : null),
    h("div", { class: "kb-pb-body" }, children),
  );
}

function pbItem(title, sub, detail, files) {
  return h(
    "div",
    { class: "kb-pb-item" },
    h("div", { class: "kb-pb-item-title" }, h("strong", {}, title), sub ? h("code", { class: "kb-pb-code" }, sub) : null),
    h("p", { class: "kb-pb-text" }, detail),
    files && files.length ? h("p", { class: "kb-pb-meta" }, files.map((f) => h("code", { class: "kb-pb-code" }, f.replace("./", "src/")))) : null,
  );
}

function playbookCard(ctx) {
  const models = contentModelReference();
  const prov = provenanceReference();
  const rel = relationshipReference();
  const cov = playbookCoverage();
  const guides = extensionGuides();

  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h(
      "button",
      { class: "kb-btn kb-btn-ghost", type: "button", id: "kbPlaybookDownloadBtn", onClick: () => downloadText("itu-playbook.md", playbookToMarkdown(), "text/markdown;charset=utf-8") },
      "Download playbook",
    ),
    h(
      "button",
      { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => copyText(playbookToMarkdown(), (m) => ctx.toast(typeof m === "string" ? m : "Playbook copied", "success")) },
      "Copy markdown",
    ),
  );

  const refs = h(
    "div",
    { class: "kb-pb-refs" },
    pbDetails("The information model", models.length + " models", models.map((m) => pbItem(m.label, m.id, m.description, m.recordTypes))),
    pbDetails("Provenance classifications", prov.length + " kinds", prov.map((p) => pbItem(p.label, p.id, p.description, p.requires))),
    pbDetails("Relationship conventions", rel.kindCount + " kinds", RELATIONSHIP_CONVENTIONS.map((c) => pbItem(c.title, null, c.detail))),
    pbDetails("Deployment documentation", DEPLOYMENT_FLOW.length + " stages", DEPLOYMENT_FLOW.map((s) => pbItem(s.title, null, s.detail, s.files))),
    pbDetails("Publication envelope & redaction", REDACTION_RULES.length + " rules", REDACTION_RULES.map((r) => pbItem(r.title, null, r.detail))),
  );

  const guideEls = guides.map((g) =>
    h(
      "details",
      { class: "kb-pb-details kb-pb-guide" },
      h("summary", { class: "kb-pb-summary" }, h("span", { class: "kb-pb-summary-title" }, g.label), h("span", { class: "kb-pb-hint" }, g.steps.length + " steps")),
      h(
        "div",
        { class: "kb-pb-body" },
        h("p", { class: "kb-pb-text kb-pb-intro" }, g.intro),
        h(
          "ol",
          { class: "kb-pb-steps" },
          g.steps.map((s) =>
            h(
              "li",
              { class: "kb-pb-step" },
              h("div", { class: "kb-pb-item-title" }, h("strong", {}, s.title)),
              h("p", { class: "kb-pb-text" }, s.detail),
              s.files && s.files.length ? h("p", { class: "kb-pb-meta" }, s.files.map((f) => h("code", { class: "kb-pb-code" }, f.replace("./", "src/")))) : null,
            ),
          ),
        ),
      ),
    ),
  );

  return h(
    "section",
    { class: "kb-card kb-settings-card", dataset: { card: "playbook" } },
    cardHead(icons.article, "Playbook & reference", cov.relationshipKinds + " link kinds"),
    h(
      "p",
      { class: "kb-muted" },
      "The IT-U content model, the conventions every record follows, how deployment documentation is assembled and published, and the checklists for adding a new asset type, template, service runbook or export. The same text ships as src/PLAYBOOK.md.",
    ),
    actions,
    h("div", { class: "kb-subhead" }, "Reference"),
    refs,
    h("div", { class: "kb-subhead" }, "Extension playbooks"),
    h("div", { class: "kb-pb-guides" }, guideEls),
  );
}

// small helpers
// ---------------------------------------------------------------------------
function kpi(value, label, title) {
  return h("div", { class: "kb-kpi", title: title || null }, h("span", { class: "kb-kpi-value" }, value), h("span", { class: "kb-kpi-label" }, label));
}

function cardHead(icon, title, badge) {
  return h(
    "div",
    { class: "kb-section-head" },
    h("span", { class: "kb-section-icon", html: icon }),
    h("h2", { class: "kb-section-name" }, title),
    badge ? h("span", { class: "kb-count-pill" }, badge) : null,
  );
}
