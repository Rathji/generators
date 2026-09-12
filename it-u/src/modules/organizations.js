// src/modules/organizations.js — the Organizations station (roadmap Phase 1
// tasks 2–4; later phases extend it).
//
// An "organization" IS a documentation set: one versioned JSON document holding
// every record for that client, with first-class typed links between records.
// This station is the working surface for that model:
//   • list every documentation set, and create a new one;
//   • open a set and see its records grouped by type;
//   • add a record (which MUST carry an information model + provenance);
//   • link two records with a typed relationship, and unlink them;
//   • remove a record (its links cascade away) or the whole set.
//
// The heavy lifting lives in src/framework/docsets.js,
// classification.js and relationships.js — this module is presentation.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, confirmDialog, promptPanel, relTime, fmtDate, fmtBytes, openModal } from "./shared.js";
import { INFORMATION_MODELS, PROVENANCE, provenanceDef, classificationOf } from "../framework/classification.js";
import { RELATIONSHIP_KINDS, relationshipKind, findRecord, refKey } from "../framework/relationships.js";
import { RECORD_TYPE_META, CLASSIFIED_TYPES, RECORD_KIND_LABELS } from "../framework/docsets.js";
import { STANDARDIZED_TYPES, recordDetailLine } from "../framework/standardized.js";
import {
  COMPLETENESS_RULES,
  completenessRule,
  configurationCompleteness,
  completenessReport,
  normalizeCompletenessConfig,
} from "../framework/configuration.js";
import { checklistProgress } from "../framework/checklist.js";
import { openChecklistEditor } from "./checklist-view.js";
import { openAssetProfile } from "./asset-profile.js";
import { openCredentialDialog } from "./credential-view.js";
import { openDocumentEditor } from "./document-view.js";
import { buildStandardizedFields, parseRefValue } from "./std-fields.js";
import { openSiteView } from "./site-view.js";
import { openDiagramEditor } from "./diagram-view.js";
import { openDomainEditor, openCertificateEditor } from "./tracker-view.js";

const DESC =
  "Clients, departments and business units — each a container for its locations, people, assets and services, held as one versioned document.";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const typeMeta = (t) => RECORD_TYPE_META[t] || { label: t, singular: t, icon: "box" };

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------
export default {
  id: "organizations",
  label: "Organizations",
  desc: DESC,
  icon: icons.building,
  render(ctx) {
    renderList(ctx);
  },
  renderDetail(ctx, sub) {
    renderDetail(ctx, decodeURIComponent(sub));
  },
};

// ---------------------------------------------------------------------------
// list view
// ---------------------------------------------------------------------------
function renderList(ctx) {
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading documentation sets…" }));
  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewDocSetBtn", onClick: () => newSet(ctx) }, "New documentation set"),
  );
  ctx.container.append(
    viewPanel({ crumb: "IT-U", title: "Organizations", desc: DESC, actions, body }),
  );
  loadList(ctx, body);
}

async function loadList(ctx, body, tab = "active") {
  let all;
  try {
    all = await ctx.docs.summaries({ includeArchived: true });
  } catch (e) {
    clear(body);
    body.append(
      errorState({
        title: "Couldn’t load documentation sets",
        description: String((e && e.message) || e),
        onRetry: () => loadList(ctx, body, tab),
      }),
    );
    return;
  }
  const active = all.filter((s) => !s.archived);
  const archived = all.filter((s) => s.archived);
  const list = tab === "archived" ? archived : active;
  const reload = () => loadList(ctx, body, tab);

  clear(body);
  const tabs = h(
    "div",
    { class: "kb-tabs", role: "tablist" },
    tabButton("active", "Active", active.length, tab, () => loadList(ctx, body, "active")),
    tabButton("archived", "Archived", archived.length, tab, () => loadList(ctx, body, "archived")),
  );
  body.append(tabs);

  if (!list.length) {
    body.append(
      emptyState({
        icon: icons.building,
        title: tab === "archived" ? "No archived sets" : "No organizations yet",
        description:
          tab === "archived"
            ? "Archived clients appear here — fully preserved and restorable."
            : "A documentation set holds everything IT-U records about one client — its sites, people, hardware, credentials, documents and services — as one versioned document. Create the first one to begin.",
        action:
          tab === "archived"
            ? null
            : h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newSet(ctx) }, "New documentation set"),
      }),
    );
    return;
  }
  const grid = h("div", { class: "kb-docset-grid" });
  for (const s of list) grid.append(cardFor(s, ctx, reload));
  body.append(
    h("div", { class: "kb-docset-count" }, list.length + " documentation set" + (list.length === 1 ? "" : "s")),
    grid,
  );
}

function tabButton(id, label, count, active, onClick) {
  return h(
    "button",
    {
      class: "kb-tab" + (active === id ? " active" : ""),
      type: "button",
      role: "tab",
      dataset: { tab: id },
      "aria-selected": active === id ? "true" : "false",
      onClick,
    },
    label,
    h("span", { class: "kb-tab-count" }, String(count)),
  );
}

function cardFor(s, ctx, reload) {
  const counts = s.counts || {};
  const chips = CLASSIFIED_TYPES.filter((t) => counts[t])
    .slice(0, 4)
    .map((t) => h("span", { class: "kb-chip" }, counts[t] + " " + (counts[t] === 1 ? typeMeta(t).singular : typeMeta(t).label).toLowerCase()));
  const head = h(
    "div",
    { class: "kb-docset-card-head" },
    h("span", { class: "kb-docset-avatar", html: icons.building }),
    h(
      "div",
      { class: "kb-docset-card-id" },
      h("h3", { class: "kb-docset-name" }, s.name),
      h("div", { class: "kb-docset-kind" }, RECORD_KIND_LABELS[s.kind] || s.kind),
    ),
    s.archived ? h("span", { class: "kb-badge kb-badge-archived kb-docset-attic-badge" }, "Archived") : null,
  );
  const meta = h(
    "div",
    { class: "kb-docset-meta" },
    s.recordCount + " record" + (s.recordCount === 1 ? "" : "s") + " · v" + s.version +
      (s.archived ? " · archived " + relTime(s.archivedAt) : " · " + relTime(s.updatedAt)),
  );
  if (s.archived) {
    return h(
      "div",
      { class: "kb-docset-card kb-docset-card--archived", dataset: { id: s.id } },
      h("a", { class: "kb-docset-card-link", href: "#/organizations/" + s.id }, head, meta, chips.length ? h("div", { class: "kb-chips" }, chips) : h("div", { class: "kb-chips" }, h("span", { class: "kb-chip kb-chip-empty" }, "No records yet"))),
      h(
        "div",
        { class: "kb-docset-card-actions" },
        h(
          "button",
          {
            class: "kb-btn kb-btn-ghost kb-btn-sm",
            type: "button",
            onClick: async () => {
              await ctx.archive.unarchive(s.id, { updatedBy: whoami(ctx) });
              ctx.toast("Restored “" + s.name + "”", "success");
              reload();
            },
          },
          "Restore",
        ),
      ),
    );
  }
  return h(
    "a",
    { class: "kb-docset-card", href: "#/organizations/" + s.id, dataset: { id: s.id } },
    head,
    meta,
    chips.length ? h("div", { class: "kb-chips" }, chips) : h("div", { class: "kb-chips" }, h("span", { class: "kb-chip kb-chip-empty" }, "No records yet")),
  );
}

async function newSet(ctx) {
  const starters = ctx.templates && ctx.templates.listBuiltin ? ctx.templates.listBuiltin() : [];
  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "Client, department or business unit name" });
  let selected = null; // null = a blank set
  const optionList = h("div", { class: "kb-starter-list" });
  const options = [
    { id: null, name: "Blank set", description: "Start with no records." },
    ...starters,
  ];
  const buttons = [];
  const renderSelection = () => {
    for (const b of buttons) b.classList.toggle("is-selected", b.dataset.id === (selected == null ? "" : selected));
  };
  for (const o of options) {
    const btn = h(
      "button",
      { class: "kb-starter-option", type: "button", dataset: { id: o.id == null ? "" : o.id }, onClick: () => { selected = o.id; renderSelection(); } },
      h("span", { class: "kb-starter-option-name" }, o.name),
      h(
        "span",
        { class: "kb-starter-option-desc" },
        o.id == null
          ? o.description
          : (o.description || "") + " · " + ((o.counts && o.counts.records) || 0) + " records",
      ),
    );
    buttons.push(btn);
    optionList.append(btn);
  }
  renderSelection();

  const m = openModal({
    title: "New documentation set",
    description: "Name the set, then start blank or from a starter template.",
    children: [
      h("label", { class: "kb-field-label kb-newset-label" }, "Name"),
      nameInput,
      h("label", { class: "kb-field-label kb-newset-label" }, "Start from"),
      optionList,
    ],
    wide: true,
  });
  const create = h(
    "button",
    {
      class: "kb-btn kb-btn-primary",
      type: "button",
      id: "kbNewSetCreateBtn",
      onClick: async () => {
        const name = nameInput.value.trim();
        if (!name) {
          m.showError("A documentation set needs a name.");
          return;
        }
        m.clearError();
        create.disabled = true;
        clear(create);
        create.append(h("span", { class: "spinner spinner-sm" }), document.createTextNode(" Creating…"));
        try {
          if (selected) {
            const res = await ctx.templates.apply(selected, { name, createdBy: whoami(ctx) });
            ctx.toast("Created “" + res.set.name + "”", "success");
            ctx.go("#/organizations/" + res.set.id);
          } else {
            const set = await ctx.docs.create({ name, createdBy: whoami(ctx), actor: whoami(ctx) });
            ctx.toast("Created “" + set.name + "”", "success");
            ctx.go("#/organizations/" + set.id);
          }
          m.close();
        } catch (e) {
          clear(create);
          create.append(document.createTextNode("Create"));
          create.disabled = false;
          m.showError(String((e && e.message) || e));
        }
      },
    },
    "Create",
  );
  m.actions.append(h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"), create);
  nameInput.focus();
}

// ---------------------------------------------------------------------------
// detail view
// ---------------------------------------------------------------------------
function renderDetail(ctx, id) {
  const titleEl = h("h1", { class: "kb-view-title" }, "…");
  const crumbEl = h("div", { class: "kb-breadcrumb" }, "IT-U / Organizations");
  const actions = h("div", { class: "kb-actions-row" });
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading documentation set…" }));
  ctx.container.append(
    h(
      "div",
      { class: "kb-view" },
      h(
        "header",
        { class: "kb-view-head" },
        crumbEl,
        h("div", { class: "kb-view-title-row" }, titleEl, actions),
        h(
          "p",
          { class: "kb-view-desc" },
          "One versioned document holding every record for this client, with typed links between records.",
        ),
      ),
      body,
    ),
  );
  loadDetail(ctx, id, { titleEl, crumbEl, actions, body });
}

async function loadDetail(ctx, id, ui) {
  let set;
  let meta;
  try {
    [set, meta] = await Promise.all([
      ctx.docs.get(id, { force: true }),
      ctx.docs.meta(id).catch(() => null),
    ]);
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
        action: h("a", { class: "kb-btn kb-btn-ghost", href: "#/organizations" }, "Back to Organizations"),
      }),
    );
    return;
  }
  ui.titleEl.textContent = set.name;
  ui.crumbEl.replaceChildren();
  ui.crumbEl.append(
    h("a", { class: "kb-bc-link", href: "#/organizations" }, "IT-U / Organizations"),
    h("span", { class: "kb-bc-current" }, " / " + set.name),
  );
  clear(ui.actions);
  const reload = () => loadDetail(ctx, id, ui);
  const archived = !!set.archived;
  if (archived) {
    ui.actions.append(
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbRestoreSetBtn", onClick: () => restoreSet(ctx, set, reload) }, "Restore set"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => duplicateSet(ctx, set) }, "Duplicate"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => showHistory(ctx, set, meta, reload) }, "History"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-danger-text", type: "button", id: "kbDeleteSetBtn", onClick: () => deleteSet(ctx, set) }, "Delete"),
    );
  } else {
    ui.actions.append(
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbAddRecordBtn", onClick: () => addRecordDialog(ctx, set, reload, meta) }, "+ Add record"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbLinkRecordsBtn", onClick: () => linkDialog(ctx, set, reload) }, "Link records"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbCompRulesBtn", onClick: () => completenessRulesDialog(ctx, set, reload) }, "Completeness rules"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => duplicateSet(ctx, set) }, "Duplicate"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => saveAsTemplate(ctx, set) }, "Save as template"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => showHistory(ctx, set, meta, reload) }, "History"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => archiveSet(ctx, set) }, "Archive"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-danger-text", type: "button", id: "kbDeleteSetBtn", onClick: () => deleteSet(ctx, set) }, "Delete"),
    );
  }
  clear(ui.body);
  ui.body.append(...(await renderSetBody(ctx, set, reload, meta, { archived })));
}

async function renderSetBody(ctx, set, reload, meta, opts = {}) {
  const readonly = !!opts.archived;
  const assetTypes = await ctx.assetTypes.list().catch(() => []);
  const out = [];
  if (readonly) {
    out.push(
      h(
        "div",
        { class: "kb-banner kb-banner-archived" },
        h("span", { class: "kb-banner-icon", html: icons.history }),
        h(
          "div",
          { class: "kb-banner-text" },
          h("strong", null, "This documentation set is archived and read-only."),
          h("span", null, " Archived " + relTime(set.archivedAt) + (set.archiveReason ? " · " + set.archiveReason : "") + ". Restore it to make changes."),
        ),
      ),
    );
  }
  const total = CLASSIFIED_TYPES.reduce((n, t) => n + (set.records[t] || []).length, 0);
  const relCount = (set.records.relationships || []).length;
  const bytes = (meta && meta.bytes) || 0;
  const ceiling = ctx.archive.ceiling || 1;
  const pct = Math.min(100, Math.round((bytes / ceiling) * 100));

  out.push(
    h(
      "div",
      { class: "kb-kpi-row" },
      kpi(String(total), "Records"),
      kpi(String(relCount), "Relationships"),
      kpi("v" + setVersion(set, meta), "Version", set.id),
      kpi(relTime(set.updatedAt), "Last updated", "by " + (set.updatedBy || "—")),
      kpi(String((meta && meta.history ? meta.history.length : 0)), "Versions kept"),
    ),
  );
  out.push(
    h(
      "div",
      { class: "kb-capacity-strip" },
      h("span", { class: "kb-capacity-label" }, "Storage"),
      h("div", { class: "kb-progress" }, h("div", { class: "kb-progress-fill kb-progress-fill--" + (bytes >= ceiling ? "over" : pct >= 80 ? "near" : "ok"), style: "width:" + pct + "%" })),
      h("span", { class: "kb-capacity-val" }, fmtBytes(bytes) + " of " + fmtBytes(ceiling) + " (" + pct + "%)"),
    ),
  );

  // Task 10: configuration completeness at a glance.
  if ((set.records.configurations || []).length) {
    const rep = completenessReport(set);
    out.push(
      h(
        "div",
        { class: "kb-capacity-strip kb-comp-strip", id: "kbCompStrip" },
        h("span", { class: "kb-capacity-label" }, "Config completeness"),
        h("div", { class: "kb-progress" }, h("div", { class: "kb-progress-fill kb-progress-fill--" + (rep.incompleteCount ? "near" : "ok"), style: "width:" + (rep.total ? Math.round((rep.completeCount / rep.total) * 100) : 100) + "%" })),
        h("span", { class: "kb-capacity-val" }, rep.completeCount + " of " + rep.total + " complete" + (rep.incompleteCount ? " · " + rep.incompleteCount + " incomplete" : "")),
        readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => completenessRulesDialog(ctx, set, reload) }, "Rules"),
      ),
    );
  }

  const addBtn = () => h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => addRecordDialog(ctx, set, reload, meta) }, "Add record");
  const withRecords = CLASSIFIED_TYPES.filter((t) => (set.records[t] || []).length);
  if (!withRecords.length) {
    out.push(
      emptyState({
        icon: icons.box,
        title: "No records yet",
        description:
          "Add the first record — a site, a contact, a device, a credential or a document. Every record is classified by information model and provenance.",
        action: readonly ? null : addBtn(),
      }),
    );
  } else {
    for (const t of withRecords) out.push(recordSection(ctx, set, t, reload, { readonly, assetTypes }));
  }
  out.push(relationshipSection(ctx, set, reload, { readonly }));
  return out;
}

// The store keeps the version on the document meta, not the data; we read it
// via the docs service (meta) and fall back to the record's own data.
function setVersion(set, meta) {
  if (meta && meta.version != null) return meta.version;
  return set.version || set._version || 1;
}

function kpi(value, label, title) {
  return h("div", { class: "kb-kpi", title: title || null }, h("span", { class: "kb-kpi-value" }, value), h("span", { class: "kb-kpi-label" }, label));
}

// The progress badge a checklist row shows (task 11).
function checklistBadge(record) {
  const p = checklistProgress(record);
  if (!p.total) return h("span", { class: "kb-badge kb-badge-checklist kb-badge-checklist--empty" }, "No steps");
  return h(
    "span",
    {
      class: "kb-badge kb-badge-checklist" + (p.complete ? " kb-badge-checklist--done" : ""),
      title: p.done + " of " + p.total + " steps complete" + (p.remaining ? " · " + p.remaining + " remaining" : ""),
    },
    p.done + "/" + p.total + (p.complete ? " done" : ""),
  );
}

function assetTypeBadge(record, types) {
  const t = (types || []).find((x) => x.id === record.assetTypeId);
  return h("span", { class: "kb-badge kb-badge-custom" }, t ? t.name : "No template");
}

function recordSection(ctx, set, type, reload, opts = {}) {
  const readonly = !!opts.readonly;
  const meta = typeMeta(type);
  const records = set.records[type] || [];
  const showDetails = STANDARDIZED_TYPES.includes(type);
  const table = h("table", { class: "kb-table kb-record-table" });
  table.append(
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        h("th", null, "Name"),
        showDetails ? h("th", null, "Details") : null,
        h("th", null, "Information model"),
        h("th", null, "Provenance"),
        h("th", null, "Links"),
        h("th", null, ""),
      ),
    ),
  );
  const tbody = h("tbody", null);
  for (const r of records) {
    const info = classificationOf(r);
    const links = relationsFor(set, r);
    const detail = recordDetailLine(r, set, { assetTypes: opts.assetTypes });
    const ft = type === "flexibleAssets" ? (opts.assetTypes || []).find((t) => t.id === r.assetTypeId) : null;
    const comp = type === "configurations" ? configurationCompleteness(r, set, set.completeness) : null;
    const incomplete = !!(comp && !comp.complete);
    const nameRow = h(
      "div",
      { class: "kb-record-name-row" },
      h("span", { class: "kb-record-name" }, r.name),
      incomplete
        ? h(
            "span",
            { class: "kb-badge kb-badge-incomplete", title: "Missing: " + comp.missingLabels.join(", ") },
            "Incomplete · " + comp.missing.length,
          )
        : null,
      comp && comp.complete && comp.exempt.length
        ? h(
            "span",
            { class: "kb-badge kb-badge-exempt", title: "Recorded as not applicable: " + comp.exempt.map((x) => x.rule.label).join(", ") },
            comp.exempt.length + " N/A",
          )
        : null,
      type === "checklists" ? checklistBadge(r) : null,
      type === "flexibleAssets" ? assetTypeBadge(r, opts.assetTypes) : null,
    );
    tbody.append(
      h(
        "tr",
        { class: "kb-record-row" + (incomplete ? " kb-record-row--incomplete" : ""), dataset: { id: r.id, type: r.type } },
        h("td", null, nameRow, r.origin && r.origin.source ? h("span", { class: "kb-record-sub" }, "· " + r.origin.source) : null),
        showDetails ? h("td", { class: "kb-record-details" }, detail || "—") : null,
        h("td", null, h("span", { class: "kb-badge kb-badge-model kb-badge-model--" + (info.informationModel || "none") }, info.modelLabel)),
        h("td", null, h("span", { class: "kb-badge kb-badge-prov kb-badge-prov--" + (info.provenance || "none"), title: info.provenanceDef ? info.provenanceDef.description : "" }, info.provenanceLabel)),
        h("td", null, String(links.length)),
        h(
          "td",
          { class: "kb-record-actions" },
          readonly
            ? null
            : [
                type === "checklists"
                  ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openChecklistEditor(ctx, set, r, reload) }, "Open")
                  : null,
                type === "passwords"
                  ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openCredentialDialog(ctx, { setId: set.id, record: r, reload }) }, "Open")
                  : null,
                type === "documents"
                  ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openDocumentEditor(ctx, { setId: set.id, record: r, reload }) }, "Open")
                  : null,
                type === "sites"
                  ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openSiteView(ctx, { setId: set.id, record: r, reload }) }, "Open")
                  : null,
                type === "diagrams"
                  ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openDiagramEditor(ctx, { setId: set.id, record: r, reload }) }, "Open")
                  : null,
                type === "domains"
                  ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openDomainEditor(ctx, { setId: set.id, record: r, reload }) }, "Open")
                  : null,
                type === "certificates"
                  ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openCertificateEditor(ctx, { setId: set.id, record: r, reload }) }, "Open")
                  : null,
                type === "flexibleAssets" && ft
                  ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openAssetProfile(ctx, { setId: set.id, record: r, type: ft, reload }) }, "Open")
                  : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => editRecordDialog(ctx, set, r, reload) }, "Edit"),
                h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => linkDialog(ctx, set, reload, { type: r.type, id: r.id }) }, "Link"),
                h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeRecord(ctx, set, r, reload) }, "Remove"),
              ].filter(Boolean),
        ),
      ),
    );
  }
  table.append(tbody);
  return h(
    "section",
    { class: "kb-card kb-record-section", dataset: { type } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons[meta.icon] || icons.box }),
      h("h2", { class: "kb-section-name" }, meta.label),
      h("span", { class: "kb-count-pill" }, String(records.length)),
    ),
    table,
  );
}

function relationshipSection(ctx, set, reload, opts = {}) {
  const readonly = !!opts.readonly;
  const rels = set.records.relationships || [];
  const list = h("div", { class: "kb-rel-list" });
  if (!rels.length) {
    list.append(h("p", { class: "kb-muted" }, "No relationships yet. Link records — an application to its server, a firewall to its security documentation, a circuit to its firewall — instead of duplicating the same fact in two places."));
  } else {
    for (const rel of rels) {
      const k = relationshipKind(rel.kind);
      const from = findRecord(set, rel.from);
      const to = findRecord(set, rel.to);
      list.append(
        h(
          "div",
          { class: "kb-rel-item", dataset: { rel: rel.id } },
          h("span", { class: "kb-rel-kind" }, k ? k.label : rel.kind),
          h(
            "span",
            { class: "kb-rel-ends" },
            h("span", { class: "kb-rel-end" }, from ? from.name : "missing"),
            h("span", { class: "kb-rel-arrow", html: icons.arrow }),
            h("span", { class: "kb-rel-end" }, to ? to.name : "missing"),
          ),
          readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => unlink(ctx, set, rel, reload) }, "Unlink"),
        ),
      );
    }
  }
  return h(
    "section",
    { class: "kb-card kb-rel-section" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.link }),
      h("h2", { class: "kb-section-name" }, "Relationships"),
      h("span", { class: "kb-count-pill" }, String(rels.length)),
    ),
    list,
  );
}

// relationsOf against an in-memory set (avoids an async round-trip per row).
function relationsFor(set, ref) {
  const key = refKey(ref);
  return (set.records.relationships || []).filter((r) => refKey(r.from) === key || refKey(r.to) === key);
}

// ---------------------------------------------------------------------------
// record add dialog
// ---------------------------------------------------------------------------
function addRecordDialog(ctx, set, reload, meta) {
  const typeSel = h("select", { class: "kb-input", id: "recType" });
  for (const t of CLASSIFIED_TYPES) if (t !== "flexibleAssets") typeSel.append(h("option", { value: t }, typeMeta(t).label));
  const nameInput = h("input", { class: "kb-input", id: "recName", type: "text", placeholder: "e.g. web-01, HQ office, Billing App" });
  const modelSel = h("select", { class: "kb-input", id: "recModel" });
  for (const m of INFORMATION_MODELS) modelSel.append(h("option", { value: m.id }, m.label));
  const provSel = h("select", { class: "kb-input", id: "recProv" });
  for (const p of PROVENANCE) provSel.append(h("option", { value: p.id }, p.label));
  const originRow = h("div", { class: "kb-field-row" });
  const originBox = h("div", { class: "kb-origin-box", hidden: true });
  originBox.append(h("span", { class: "kb-field-label" }, "Origin"));
  originBox.append(originRow);

  // Standardized fields for the chosen record type (organizations, locations,
  // contacts, configurations — task 7–9).
  let std = buildStandardizedFields(set, typeSel.value);
  const stdHolder = h("div", { class: "kb-std-holder" }, std.node);
  function renderStd() {
    std = buildStandardizedFields(set, typeSel.value);
    stdHolder.replaceChildren(std.node);
  }
  typeSel.addEventListener("change", renderStd);

  function syncOrigin() {
    const p = provenanceDef(provSel.value);
    originRow.replaceChildren();
    const required = (p && p.requires) || [];
    originBox.hidden = required.length === 0;
    for (const f of required) {
      originRow.append(
        h(
          "div",
          { class: "kb-field" },
          h("span", { class: "kb-field-label" }, p.requireLabel || f),
          h("input", { class: "kb-input", type: "text", placeholder: p.placeholder || "", dataset: { origin: f } }),
        ),
      );
    }
  }
  provSel.addEventListener("change", syncOrigin);
  syncOrigin();

  const m = overlayModal({
    title: "Add a record",
    description: "Every record carries an information model and a provenance classification; IT-U refuses to save an unclassified record. Organizations and locations also carry their standardized fields.",
    children: [
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Record type"), typeSel),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), nameInput),
      ),
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Information model"), modelSel),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Provenance"), provSel),
      ),
      stdHolder,
      originBox,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "recSaveBtn" }, "Add record"),
  );
  const save = m.actions.querySelector("#recSaveBtn");
  let allowDuplicate = false;
  save.addEventListener("click", async () => {
    m.clearError();
    const origin = {};
    for (const inp of originRow.querySelectorAll("[data-origin]")) origin[inp.dataset.origin] = inp.value.trim();
    const input = { type: typeSel.value, name: nameInput.value.trim(), informationModel: modelSel.value, provenance: provSel.value, origin, ...std.collect() };
    if (!input.name) {
      m.showError("Give the record a name.");
      return;
    }
    save.disabled = true;
    try {
      const res = await ctx.docs.addRecord(set.id, input, { allowDuplicate, updatedBy: whoami(ctx), actor: whoami(ctx) });
      m.close();
      ctx.toast("Added “" + res.record.name + "”", "success");
      reload();
    } catch (e) {
      m.showError(String((e && e.message) || e) + (e && e.hint ? " " + e.hint : ""));
      if (e && e.code === "DUPLICATE_RECORD" && !allowDuplicate) {
        allowDuplicate = true;
        save.textContent = "Create anyway";
      }
    } finally {
      save.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// record edit dialog (editing keeps classification + links intact)
// ---------------------------------------------------------------------------
function editRecordDialog(ctx, set, r, reload) {
  const nameInput = h("input", { class: "kb-input", id: "editRecName", type: "text" });
  nameInput.value = r.name;
  const modelSel = h("select", { class: "kb-input" });
  for (const m of INFORMATION_MODELS) modelSel.append(h("option", { value: m.id }, m.label));
  modelSel.value = r.informationModel;
  const provSel = h("select", { class: "kb-input" });
  for (const p of PROVENANCE) provSel.append(h("option", { value: p.id }, p.label));
  provSel.value = r.provenance;
  const originRow = h("div", { class: "kb-field-row" });
  const originBox = h("div", { class: "kb-origin-box", hidden: true });
  originBox.append(h("span", { class: "kb-field-label" }, "Origin"), originRow);
  function syncOrigin() {
    const p = provenanceDef(provSel.value);
    originRow.replaceChildren();
    const required = (p && p.requires) || [];
    originBox.hidden = required.length === 0;
    for (const f of required) {
      const inp = h("input", { class: "kb-input", type: "text", placeholder: p.placeholder || "", dataset: { origin: f } });
      inp.value = r.origin && r.origin[f] != null ? String(r.origin[f]) : "";
      originRow.append(h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, p.requireLabel || f), inp));
    }
  }
  provSel.addEventListener("change", syncOrigin);
  syncOrigin();

  const std = buildStandardizedFields(set, r.type, r);
  const exempt = r.type === "configurations" ? buildExemptionEditor(set, r, whoami(ctx)) : null;

  const m = overlayModal({
    title: "Edit “" + r.name + "”",
    description: "Changing fields keeps the record's classification and its links intact.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), nameInput),
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Information model"), modelSel),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Provenance"), provSel),
      ),
      std.node,
      exempt ? exempt.node : null,
      originBox,
    ].filter(Boolean),
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "editRecSaveBtn" }, "Save changes"),
  );
  const save = m.actions.querySelector("#editRecSaveBtn");
  save.addEventListener("click", async () => {
    m.clearError();
    const origin = {};
    for (const inp of originRow.querySelectorAll("[data-origin]")) origin[inp.dataset.origin] = inp.value.trim();
    const patch = { name: nameInput.value.trim(), informationModel: modelSel.value, provenance: provSel.value, origin, ...std.collect() };
    if (!patch.name) {
      m.showError("Give the record a name.");
      return;
    }
    if (exempt) patch.exemptions = exempt.collect();
    save.disabled = true;
    try {
      const res = await ctx.docs.updateRecord(set.id, { type: r.type, id: r.id }, patch, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      m.close();
      ctx.toast("Saved “" + res.record.name + "”", "success");
      reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    } finally {
      save.disabled = false;
    }
  });
}

// The per-record "record an exception" editor (task 10). Shows each required
// rule with its status; ticking "not applicable" records who/why/when.
function buildExemptionEditor(set, record, by) {
  const cfg = normalizeCompletenessConfig(set.completeness);
  const comp = configurationCompleteness(record, set, cfg);
  const statusByKey = {};
  for (const rl of comp.satisfied) statusByKey[rl.key] = "ok";
  for (const rl of comp.missing) statusByKey[rl.key] = "missing";
  for (const x of comp.exempt) statusByKey[x.rule.key] = "exempt";
  const existing = record.exemptions || {};
  const rows = cfg.required
    .map(completenessRule)
    .filter(Boolean)
    .map((rule) => {
      const status = statusByKey[rule.key] || "missing";
      const checkbox = h("input", { type: "checkbox", class: "kb-check", dataset: { exempt: rule.key } });
      checkbox.checked = !!existing[rule.key];
      const reason = h("input", { class: "kb-input kb-input-sm", type: "text", placeholder: "Why doesn’t it apply?", dataset: { reason: rule.key } });
      reason.value = existing[rule.key] ? existing[rule.key].reason || "" : "";
      reason.disabled = !checkbox.checked;
      checkbox.addEventListener("change", () => {
        reason.disabled = !checkbox.checked;
      });
      const badge = h(
        "span",
        { class: "kb-badge kb-badge-comp kb-badge-comp--" + status },
        status === "ok" ? "Present" : status === "exempt" ? "N/A" : "Missing",
      );
      return h(
        "div",
        { class: "kb-comp-rule" },
        h("label", { class: "kb-comp-rule-main", title: rule.description || "" }, checkbox, h("span", { class: "kb-comp-rule-label" }, rule.label), badge),
        reason,
      );
    });
  const node = h(
    "div",
    { class: "kb-std-section kb-comp-section" },
    h("div", { class: "kb-subhead" }, "Completeness"),
    h("p", { class: "kb-muted kb-comp-hint" }, "Incomplete configurations are flagged, not blocked. Tick “not applicable” to record an explicit exception (with a reason) where a rule genuinely does not apply."),
    ...rows,
  );
  return {
    node,
    collect: () => {
      const out = {};
      for (const rule of cfg.required.map(completenessRule).filter(Boolean)) {
        const cb = node.querySelector(`[data-exempt="${rule.key}"]`);
        const rs = node.querySelector(`[data-reason="${rule.key}"]`);
        if (cb && cb.checked) out[rule.key] = { reason: rs ? rs.value.trim() : "", by, at: Date.now() };
      }
      return out;
    },
  };
}

// The per-set required-field set editor (task 10, configurable).
function completenessRulesDialog(ctx, set, reload) {
  const cfg = normalizeCompletenessConfig(set.completeness);
  const boxes = [];
  const rows = COMPLETENESS_RULES.map((rule) => {
    const cb = h("input", { type: "checkbox", class: "kb-check", dataset: { rule: rule.key } });
    cb.checked = cfg.required.includes(rule.key);
    boxes.push({ rule, cb });
    return h(
      "label",
      { class: "kb-comp-rule kb-comp-rule--config", title: rule.description || "" },
      cb,
      h("span", { class: "kb-comp-rule-label" }, rule.label),
      h("span", { class: "kb-comp-rule-kind" }, rule.kind === "relationship" ? "linked credential" : "field"),
    );
  });
  const m = openModal({
    title: "Completeness rules — " + set.name,
    description:
      "Choose the fields and links a configuration must carry. Incomplete configurations are flagged, never blocked; an individual record can record an exception per rule.",
    children: [h("div", { class: "kb-comp-config" }, ...rows)],
  });
  m.actions.append(
    h(
      "button",
      {
        class: "kb-btn kb-btn-ghost",
        type: "button",
        onClick: () => {
          const def = normalizeCompletenessConfig(undefined).required;
          for (const b of boxes) b.cb.checked = def.includes(b.rule.key);
        },
      },
      "Restore defaults",
    ),
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "saveCompRulesBtn" }, "Save rules"),
  );
  m.actions.querySelector("#saveCompRulesBtn").addEventListener("click", async () => {
    m.clearError();
    const required = boxes.filter((b) => b.cb.checked).map((b) => b.rule.key);
    try {
      await ctx.docs.configureCompleteness(set.id, { required }, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      m.close();
      ctx.toast("Completeness rules saved", "success");
      reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

// ---------------------------------------------------------------------------
// link dialog
// ---------------------------------------------------------------------------
function linkDialog(ctx, set, reload, presetFrom = null) {
  const kindSel = h("select", { class: "kb-input", id: "linkKind" });
  for (const k of RELATIONSHIP_KINDS) kindSel.append(h("option", { value: k.id }, k.label));
  const fromSel = h("select", { class: "kb-input", id: "linkFrom" });
  const toSel = h("select", { class: "kb-input", id: "linkTo" });

  const refValue = (sel) => {
    const v = sel.value;
    if (!v) return null;
    const i = v.indexOf(":");
    return { type: v.slice(0, i), id: v.slice(i + 1) };
  };
  const fill = (sel, types, exclude) => {
    sel.replaceChildren();
    let any = false;
    for (const t of types) {
      const group = h("optgroup", { label: typeMeta(t).label });
      for (const r of set.records[t] || []) {
        if (exclude && exclude.type === t && exclude.id === r.id) continue;
        group.append(h("option", { value: t + ":" + r.id }, r.name));
        any = true;
      }
      if (group.childNodes.length) sel.append(group);
    }
    if (!any) sel.append(h("option", { value: "" }, "— no matching records —"));
  };
  function syncForKind() {
    const k = relationshipKind(kindSel.value);
    if (!k) return;
    fill(fromSel, k.from, null);
    fill(toSel, k.to, refValue(fromSel));
  }
  fromSel.addEventListener("change", () => {
    const k = relationshipKind(kindSel.value);
    if (k) fill(toSel, k.to, refValue(fromSel));
  });
  kindSel.addEventListener("change", syncForKind);

  const m = overlayModal({
    title: "Link two records",
    description: "A typed link is stored once and is visible from both records — so the same fact is never duplicated.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Relationship"), kindSel),
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "From"), fromSel),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "To"), toSel),
      ),
    ],
  });
  // Preselect the record the user came from, when the chosen kind allows it.
  if (presetFrom) {
    const k = relationshipKind(kindSel.value);
    if (k && !k.from.includes(presetFrom.type)) {
      const alt = RELATIONSHIP_KINDS.find((x) => x.from.includes(presetFrom.type) || x.to.includes(presetFrom.type));
      if (alt) kindSel.value = alt.id;
    }
    syncForKind();
    if ([...fromSel.options].some((o) => o.value === presetFrom.type + ":" + presetFrom.id)) {
      fromSel.value = presetFrom.type + ":" + presetFrom.id;
      const k = relationshipKind(kindSel.value);
      if (k) fill(toSel, k.to, refValue(fromSel));
    } else if ([...toSel.options].some((o) => o.value === presetFrom.type + ":" + presetFrom.id)) {
      toSel.value = presetFrom.type + ":" + presetFrom.id;
    }
  } else {
    syncForKind();
  }

  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "linkSaveBtn" }, "Link records"),
  );
  const save = m.actions.querySelector("#linkSaveBtn");
  save.addEventListener("click", async () => {
    m.clearError();
    const from = refValue(fromSel);
    const to = refValue(toSel);
    if (!from || !to) {
      m.showError("Pick both records to link.");
      return;
    }
    save.disabled = true;
    try {
      await ctx.docs.linkRecords(set.id, { from, to, kind: kindSel.value, createdBy: whoami(ctx) });
      m.close();
      ctx.toast("Linked", "success");
      reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    } finally {
      save.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// destructive actions
// ---------------------------------------------------------------------------
async function removeRecord(ctx, set, record, reload) {
  const links = relationsFor(set, { type: record.type, id: record.id }).length;
  const ok = await confirmDialog({
    title: "Remove “" + record.name + "”?",
    message:
      links > 0
        ? "This also removes " + links + " relationship" + (links === 1 ? " that references" : "s that reference") + " it. This cannot be undone."
        : "This cannot be undone.",
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await ctx.docs.removeRecord(set.id, { type: record.type, id: record.id }, { updatedBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast(res.cascaded ? "Removed (and " + res.cascaded + " link" + (res.cascaded === 1 ? "" : "s") + " cascaded)" : "Record removed", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function unlink(ctx, set, rel, reload) {
  try {
    await ctx.docs.unlinkRecords(set.id, rel.id, { updatedBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Link removed", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function deleteSet(ctx, set) {
  const ok = await confirmDialog({
    title: "Delete “" + set.name + "”?",
    message: "This removes the whole documentation set, every record in it and all its relationships. This cannot be undone.",
    confirmLabel: "Delete set",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.docs.remove(set.id, { updatedBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Documentation set deleted", "success");
    ctx.navigate("organizations");
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

// ---------------------------------------------------------------------------
// task 6 actions: archive, duplicate, save-as-template, version history
// ---------------------------------------------------------------------------
async function archiveSet(ctx, set) {
  const ok = await confirmDialog({
    title: "Archive “" + set.name + "”?",
    message: "The set becomes read-only and drops out of the active client list. Nothing is deleted — every record, relationship and version is preserved, and you can restore it at any time.",
    confirmLabel: "Archive set",
  });
  if (!ok) return;
  try {
    await ctx.archive.archive(set.id, { updatedBy: whoami(ctx), reason: "Archived from the Organizations station" });
    ctx.toast("Archived “" + set.name + "”", "success");
    ctx.navigate("organizations");
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function restoreSet(ctx, set, reload) {
  try {
    await ctx.archive.unarchive(set.id, { updatedBy: whoami(ctx) });
    ctx.toast("Restored “" + set.name + "”", "success");
    reload && reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function duplicateSet(ctx, set) {
  const name = await promptPanel({
    title: "Duplicate “" + set.name + "”",
    placeholder: "Name for the copy",
    confirmLabel: "Duplicate",
    initial: set.name + " (copy)",
  });
  if (!name) return;
  try {
    const res = await ctx.templates.duplicate(set.id, { name, createdBy: whoami(ctx) });
    ctx.toast("Duplicated — " + res.records + " records, " + res.links + " links", "success");
    ctx.go("#/organizations/" + res.set.id);
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function saveAsTemplate(ctx, set) {
  const name = await promptPanel({
    title: "Save “" + set.name + "” as a template",
    placeholder: "Template name (e.g. Standard managed client)",
    confirmLabel: "Save template",
    initial: set.name + " template",
  });
  if (!name) return;
  try {
    const res = await ctx.templates.saveAsTemplate(set.id, { name, createdBy: whoami(ctx) });
    ctx.toast("Template saved — " + res.template.counts.records + " records", "success");
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function showHistory(ctx, set, meta, reload) {
  let hist = [];
  try {
    hist = await ctx.store.history(set.id);
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
    return;
  }
  const rows = hist.map((h0) =>
    h(
      "tr",
      { class: h0.current ? "kb-history-current" : null, dataset: { version: String(h0.version) } },
      h("td", null, "v" + h0.version, h0.current ? h("span", { class: "kb-badge kb-badge-current" }, "current") : null),
      h("td", null, fmtDate(h0.updatedAt)),
      h("td", null, h0.updatedBy || "—"),
      h("td", null, fmtBytes(h0.bytes)),
      h("td", { class: "kb-record-actions" }, h0.current ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbRestoreV" + h0.version, onClick: () => restoreVersion(ctx, set, h0, m, reload) }, "Restore")),
    ),
  );
  const m = openModal({
    title: "Version history — " + set.name,
    description: "Every save is a new version. Restoring an old version adds it back as a new version, so nothing is ever lost.",
    wide: true,
    children: [
      h(
        "table",
        { class: "kb-table kb-history-table" },
        h("thead", null, h("tr", null, h("th", null, "Version"), h("th", null, "When"), h("th", null, "By"), h("th", null, "Size"), h("th", null, ""))),
        h("tbody", null, rows.length ? rows : h("tr", null, h("td", { colspan: "5" }, "No history yet."))),
      ),
    ],
  });
  m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
}

async function restoreVersion(ctx, set, entry, modal, reload) {
  const ok = await confirmDialog({
    title: "Restore version v" + entry.version + "?",
    message: "The content of v" + entry.version + " becomes a new version. The current version stays in history.",
    confirmLabel: "Restore v" + entry.version,
  });
  if (!ok) return;
  try {
    await ctx.store.restoreVersion(set.id, entry.version, { updatedBy: whoami(ctx) });
    modal.close();
    ctx.toast("Restored v" + entry.version, "success");
    reload && reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

// ---------------------------------------------------------------------------
// tiny modal scaffold (no native dialogs — they block the preview)
// ---------------------------------------------------------------------------
function overlayModal({ title, description = "", children = [] }) {
  const errEl = h("div", { class: "kb-form-error", hidden: true });
  const actions = h("div", { class: "kb-modal-actions" });
  const box = h(
    "div",
    { class: "kb-modal kb-modal-form", role: "dialog", "aria-modal": "true" },
    h("h3", { class: "kb-modal-title" }, title),
    description ? h("p", { class: "kb-modal-text" }, description) : null,
    ...children,
    errEl,
    actions,
  );
  const overlay = h("div", { class: "kb-modal-overlay" }, box);
  const esc = (e) => {
    if (e.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", esc);
    overlay.remove();
  };
  document.addEventListener("keydown", esc);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  return {
    overlay,
    actions,
    close,
    showError: (msg) => {
      errEl.hidden = false;
      errEl.textContent = msg;
    },
    clearError: () => {
      errEl.hidden = true;
      errEl.textContent = "";
    },
  };
}
