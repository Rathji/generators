// src/modules/assets.js — the Assets station (roadmap Phase 3, tasks 12–13).
//
// The Assets station is the Flexible Asset *template engine*: the global library
// of asset types (Applications, Licensing, Virtualization and the service
// templates), the template designer that defines each type's fields, field
// types, required fields and allowed references, and the instances of those
// types across every client's documentation set.
//
// Types live in ONE shared library document (ctx.assetTypes), so a house
// standard defined here is immediately available to every client. Instances
// live inside each client's documentation set as `flexibleAssets` records,
// carrying a classification and typed links like any other record.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, confirmDialog, promptPanel, relTime, openModal, copyText } from "./shared.js";
import { PROVENANCE, provenanceDef } from "../framework/classification.js";
import { ASSET_CATEGORIES, ASSET_FIELD_TYPES, REFERENCE_TYPES, assetCategory, referenceType, validateAssetType, validateAssetRecord, assetDetailLine, normalizeAssetFields } from "../framework/flexible.js";
import { renderAssetFields } from "./asset-fields.js";
import { openAssetProfile } from "./asset-profile.js";
import { renewalsReport, expiryFieldOf, renewalStateDef, renewalPhrase, DEFAULT_ALERT_DAYS } from "../framework/renewals.js";

const DESC =
  "The Flexible Asset template library — user-defined structured records (applications, licensing, virtualization and every service template) whose fields, required fields and allowed references you define, shared across all clients.";

const ICON_CHOICES = ["layers", "box", "server", "database", "folder", "shield", "eye", "chat", "rocket", "clipboard", "building", "article", "print", "star", "clock"];

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const typeIcon = (t) => icons[(t && t.icon) || "layers"] || icons.layers;

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------
export default {
  id: "assets",
  label: "Assets",
  desc: DESC,
  icon: icons.layers,
  render(ctx) {
    renderLibrary(ctx);
  },
  renderDetail(ctx, sub) {
    renderTypeDetail(ctx, decodeURIComponent(sub));
  },
};

// ---------------------------------------------------------------------------
// shared reads
// ---------------------------------------------------------------------------
async function collectInstances(ctx, typeId = null) {
  const summaries = await ctx.docs.summaries({ includeArchived: true });
  const out = [];
  for (const s of summaries) {
    const set = await ctx.docs.get(s.id);
    if (!set || !set.records) continue;
    for (const r of set.records.flexibleAssets || []) {
      if (typeId && r.assetTypeId !== typeId) continue;
      out.push({ setId: s.id, setName: set.name, archived: !!set.archived, set, record: r });
    }
  }
  return out;
}

function instanceCounts(instances) {
  const map = new Map();
  for (const i of instances) map.set(i.record.assetTypeId, (map.get(i.record.assetTypeId) || 0) + 1);
  return map;
}

// ---------------------------------------------------------------------------
// library view
// ---------------------------------------------------------------------------
function renderLibrary(ctx) {
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading the asset template library…" }));
  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbImportTypeBtn", onClick: () => importTypeDialog(ctx, load) }, "Import template"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewTypeBtn", onClick: () => openDesigner(ctx, null, load) }, "+ New asset type"),
  );
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Assets", desc: DESC, actions, body }));

  async function load(category = "all") {
    let types;
    let instances;
    let meta;
    try {
      [types, instances, meta] = await Promise.all([ctx.assetTypes.list(), collectInstances(ctx), ctx.assetTypes.libraryMeta()]);
    } catch (e) {
      clear(body);
      body.append(errorState({ title: "Couldn’t load the asset library", description: String((e && e.message) || e), onRetry: () => load(category) }));
      return;
    }
    const counts = instanceCounts(instances);
    const reload = () => load(category);

    clear(body);
    const summary = h(
      "div",
      { class: "kb-asset-summary" },
      h("span", { class: "kb-chip" }, meta.count + " templates"),
      h("span", { class: "kb-chip" }, meta.builtinCount + " shipped"),
      h("span", { class: "kb-chip" }, meta.customCount + " custom" + (meta.customizedCount ? " · " + meta.customizedCount + " customised" : "")),
      h("span", { class: "kb-chip kb-chip-empty" }, instances.length + " flexible asset" + (instances.length === 1 ? "" : "s") + " across clients"),
    );
    body.append(summary);
    const renewals = renewalsPanel(ctx, types, instances, reload);
    if (renewals) body.append(renewals);

    const filters = h(
      "div",
      { class: "kb-tabs", role: "tablist" },
      filterBtn("all", "All", types.length, category, reload),
      ...ASSET_CATEGORIES.map((c) => filterBtn(c.id, c.label, types.filter((t) => t.category === c.id).length, category, reload)),
    );
    body.append(filters);

    const list = category === "all" ? types : types.filter((t) => t.category === category);
    if (!list.length) {
      body.append(
        emptyState({
          icon: icons.layers,
          title: "No templates in this category",
          description: "Create an asset type in the template designer — define its fields, which are required, and which records it may reference.",
          action: h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => openDesigner(ctx, null, reload) }, "New asset type"),
        }),
      );
      return;
    }
    const grid = h("div", { class: "kb-asset-grid" });
    for (const t of list) grid.append(typeCard(ctx, t, counts.get(t.id) || 0, reload));
    body.append(grid);
  }

  load("all");
}

function filterBtn(id, label, count, active, onClick) {
  return h(
    "button",
    { class: "kb-tab" + (active === id ? " active" : ""), type: "button", role: "tab", dataset: { cat: id }, onClick: () => onClick(id) },
    label,
    h("span", { class: "kb-tab-count" }, String(count)),
  );
}

// The renewals board (tasks 15–16): the licences, subscriptions and contracts
// across every client whose expiry is overdue, due soon or coming up.
function renewalsPanel(ctx, types, instances, reload) {
  const typeById = new Map((types || []).map((t) => [t.id, t]));
  if (!(types || []).some((t) => expiryFieldOf(t))) return null;
  const report = renewalsReport(instances, (r) => typeById.get(r.assetTypeId) || null);
  const chip = (id, label) => {
    const def = renewalStateDef(id);
    const n = report.counts[id] || 0;
    return h("span", { class: "kb-chip kb-renewal-chip kb-renewal-chip--" + (def ? def.tone : "muted") }, label + ": " + n);
  };
  const section = h(
    "section",
    { class: "kb-card kb-renewals" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.clock }),
      h("h2", { class: "kb-section-name" }, "Renewals"),
      h("span", { class: "kb-count-pill" }, String(report.counts.tracked) + " tracked"),
    ),
    h("div", { class: "kb-renewal-chips" }, chip("overdue", "Overdue"), chip("due-soon", "Due soon"), chip("upcoming", "Upcoming")),
  );
  if (!report.attention.length) {
    section.append(h("p", { class: "kb-muted" }, "Nothing renews in the next " + DEFAULT_ALERT_DAYS + " days. Renewal dates are read from each template's flagged expiry field."));
    return section;
  }
  const list = h("div", { class: "kb-renewal-list" });
  for (const item of report.attention) list.append(renewalCard(ctx, item, reload));
  section.append(list);
  return section;
}

function renewalCard(ctx, item, reload) {
  const def = renewalStateDef(item.status.state);
  const t = item.type;
  return h(
    "button",
    {
      class: "kb-renewal-item kb-renewal-item--" + (def ? def.tone : "muted"),
      type: "button",
      dataset: { id: item.record.id, set: item.setId },
      onClick: () => openAssetProfile(ctx, { setId: item.setId, record: item.record, type: t, reload }),
    },
    h("span", { class: "kb-renewal-item-name" }, item.record.name),
    h("span", { class: "kb-renewal-item-meta" }, (t ? t.name : "—") + " · " + item.setName),
    h("span", { class: "kb-renewal-item-date" }, item.status.iso || "—"),
    def ? h("span", { class: "kb-badge kb-renewal-badge kb-renewal-badge--" + def.tone }, def.label) : null,
    h("span", { class: "kb-renewal-item-phrase" }, renewalPhrase(item.status)),
  );
}

function typeCard(ctx, type, count, reload) {
  const cat = assetCategory(type.category);
  const head = h(
    "div",
    { class: "kb-asset-card-head" },
    h("span", { class: "kb-asset-type-icon", html: typeIcon(type) }),
    h(
      "div",
      { class: "kb-asset-card-id" },
      h("h3", { class: "kb-asset-type-name" }, type.name),
      h("div", { class: "kb-asset-type-meta" }, cat ? cat.label : type.category),
    ),
    type.builtin ? h("span", { class: "kb-badge kb-badge-builtin" }, type.customized ? "Shipped · customised" : "Shipped") : h("span", { class: "kb-badge kb-badge-custom" }, "Custom"),
  );
  const meta = h(
    "div",
    { class: "kb-asset-card-meta" },
    (type.fields || []).length + " field" + ((type.fields || []).length === 1 ? "" : "s") +
      " · " + count + " instance" + (count === 1 ? "" : "s") +
      (type.references && type.references.length ? " · references " + type.references.length + " type" + (type.references.length === 1 ? "" : "s") : ""),
  );
  const desc = type.description ? h("p", { class: "kb-asset-card-desc" }, type.description) : null;

  return h(
    "div",
    { class: "kb-asset-card", dataset: { type: type.id } },
    h("a", { class: "kb-asset-card-link", href: "#/assets/" + encodeURIComponent(type.id) }, head, desc, meta),
    h(
      "div",
      { class: "kb-asset-card-actions" },
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openDesigner(ctx, type, reload) }, "Edit"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => cloneType(ctx, type, reload) }, "Clone"),
      type.builtin ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => resetType(ctx, type, reload) }, "Reset") : null,
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => exportType(ctx, type) }, "Export"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeType(ctx, type, reload) }, "Delete"),
    ),
  );
}

// ---------------------------------------------------------------------------
// type detail: field definitions + instances across clients
// ---------------------------------------------------------------------------
async function renderTypeDetail(ctx, typeId) {
  const titleEl = h("h1", { class: "kb-view-title" }, "…");
  const crumbEl = h("div", { class: "kb-breadcrumb" }, "IT-U / Assets");
  const actions = h("div", { class: "kb-actions-row" });
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading asset type…" }));
  ctx.container.append(
    h(
      "div",
      { class: "kb-view" },
      h("header", { class: "kb-view-head" }, crumbEl, h("div", { class: "kb-view-title-row" }, titleEl, actions), h("p", { class: "kb-view-desc" }, "The template's fields define what every instance records.")),
      body,
    ),
  );

  async function load() {
    const type = await ctx.assetTypes.get(typeId).catch(() => null);
    if (!type) {
      titleEl.textContent = "Not found";
      clear(body);
      body.append(emptyState({ icon: icons.alert, title: "Asset type not found", description: "It may have been deleted.", action: h("a", { class: "kb-btn kb-btn-ghost", href: "#/assets" }, "Back to Assets") }));
      return;
    }
    titleEl.textContent = type.name;
    crumbEl.replaceChildren(h("a", { class: "kb-bc-link", href: "#/assets" }, "IT-U / Assets"), h("span", { class: "kb-bc-current" }, " / " + type.name));
    clear(actions);
    actions.append(
      ...[
        h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbAddInstanceBtn", onClick: () => openInstanceDialog(ctx, type, { setSummaries: null, record: null, reload: load }) }, "+ Add asset"),
        h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => openDesigner(ctx, type, () => ctx.navigate("assets")) }, "Edit template"),
        h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => cloneType(ctx, type, () => ctx.navigate("assets")) }, "Clone"),
        type.builtin ? h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => resetType(ctx, type, load) }, "Reset") : null,
        h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => exportType(ctx, type) }, "Export"),
      ].filter(Boolean),
    );

    const instances = await collectInstances(ctx, type.id);
    clear(body);
    body.append(fieldSummary(type));
    body.append(instancesSection(ctx, type, instances, load));
  }

  load();
}

function fieldSummary(type) {
  const rows = (type.fields || []).map((f, i) =>
    h(
      "tr",
      null,
      h("td", null, String(i + 1)),
      h("td", null, h("span", { class: "kb-asset-field-label" }, f.label), f.required ? h("span", { class: "kb-badge kb-badge-required" }, "required") : null),
      h("td", null, (ASSET_FIELD_TYPES.find((t) => t.id === f.type) || {}).label || f.type),
      h("td", { class: "kb-asset-field-detail" }, fieldDetailText(f)),
    ),
  );
  const refs = (type.references || []).map((r) => h("span", { class: "kb-chip" }, (referenceType(r) || {}).label || r));
  return h(
    "section",
    { class: "kb-card kb-asset-section" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: typeIcon(type) }),
      h("h2", { class: "kb-section-name" }, "Template fields"),
      h("span", { class: "kb-count-pill" }, String((type.fields || []).length)),
    ),
    type.description ? h("p", { class: "kb-muted" }, type.description) : null,
    rows.length
      ? h(
          "table",
          { class: "kb-table kb-asset-field-table" },
          h("thead", null, h("tr", null, h("th", null, "#"), h("th", null, "Field"), h("th", null, "Type"), h("th", null, "Detail"))),
          h("tbody", null, rows),
        )
      : h("p", { class: "kb-muted" }, "No fields defined yet."),
    h("div", { class: "kb-asset-refs" }, h("span", { class: "kb-field-label" }, "Allowed references:"), refs.length ? refs : h("span", { class: "kb-muted" }, "none")),
  );
}

function fieldDetailText(f) {
  if (f.type === "select" || f.type === "multiselect") return (f.options || []).map((o) => o.label).join(", ");
  if (f.type === "record") return "→ " + ((referenceType(f.of) || {}).label || f.of);
  if (f.placeholder) return "placeholder: " + f.placeholder;
  return "—";
}

function instancesSection(ctx, type, instances, reload) {
  const byClient = new Map();
  for (const i of instances) {
    if (!byClient.has(i.setId)) byClient.set(i.setId, { name: i.setName, archived: i.archived, items: [] });
    byClient.get(i.setId).items.push(i.record);
  }
  const rows = [];
  for (const [setId, group] of byClient) {
    for (const r of group.items) {
      rows.push(
        h(
          "tr",
          { dataset: { id: r.id, set: setId } },
          h("td", null, h("span", { class: "kb-record-name-row" }, h("span", { class: "kb-record-name" }, r.name), group.archived ? h("span", { class: "kb-badge kb-badge-archived" }, "archived") : null)),
          h("td", null, h("a", { class: "kb-bc-link", href: "#/organizations/" + setId }, group.name)),
          h("td", { class: "kb-record-details" }, assetDetailLine(r, type) || "—"),
          h("td", null, relTime(r.updatedAt)),
          h(
            "td",
            { class: "kb-record-actions" },
            group.archived
              ? null
              : [
                  h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openAssetProfile(ctx, { setId, record: r, type, reload }) }, "Open"),
                  h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeInstance(ctx, setId, r, reload) }, "Remove"),
                ],
          ),
        ),
      );
    }
  }
  return h(
    "section",
    { class: "kb-card kb-asset-section" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.box }),
      h("h2", { class: "kb-section-name" }, type.name + " assets"),
      h("span", { class: "kb-count-pill" }, String(instances.length)),
    ),
    rows.length
      ? h(
          "table",
          { class: "kb-table kb-record-table" },
          h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Client"), h("th", null, "Details"), h("th", null, "Updated"), h("th", null, ""))),
          h("tbody", null, rows),
        )
      : h("p", { class: "kb-muted" }, "No “" + type.name + "” assets recorded for any client yet. Add one, or record it from a client's documentation set."),
  );
}

// ---------------------------------------------------------------------------
// template designer
// ---------------------------------------------------------------------------
function parseOptions(text) {
  return String(text || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      if (i < 0) return { id: s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""), label: s };
      const label = s.slice(i + 1).trim();
      return { id: s.slice(0, i).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""), label };
    })
    .filter((o) => o.id && o.label);
}

function optionsText(f) {
  return (f.options || []).map((o) => (o.id === o.label ? o.label : o.id + ": " + o.label)).join(", ");
}

function openDesigner(ctx, existing, onSaved) {
  const editing = !!existing;
  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Point-of-sale system" });
  nameInput.value = existing ? existing.name : "";
  const descInput = h("textarea", { class: "kb-input", rows: 2, placeholder: "What does this asset type describe?" });
  descInput.value = existing ? existing.description || "" : "";
  const catSel = h("select", { class: "kb-input" });
  for (const c of ASSET_CATEGORIES) catSel.append(h("option", { value: c.id }, c.label));
  catSel.value = existing ? existing.category : "custom";
  const iconSel = h("select", { class: "kb-input" });
  for (const n of ICON_CHOICES) iconSel.append(h("option", { value: n }, n));
  iconSel.value = existing && ICON_CHOICES.includes(existing.icon) ? existing.icon : "layers";

  let fields = existing ? existing.fields.map((f) => ({ ...f })) : [];
  let rows = [];
  const fieldListEl = h("div", { class: "kb-designer-fields" });

  function move(f, delta) {
    const i = fields.indexOf(f);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= fields.length) return;
    fields.splice(i, 1);
    fields.splice(j, 0, f);
    renderFields();
  }
  function removeField(f) {
    fields = fields.filter((x) => x !== f);
    renderFields();
  }

  function fieldRow(f, index) {
    const label = h("input", { class: "kb-input kb-input-sm", type: "text", placeholder: "Field label" });
    label.value = f.label || "";
    label.addEventListener("input", () => {
      f.label = label.value;
    });
    const typeSel = h("select", { class: "kb-input kb-input-sm" });
    for (const t of ASSET_FIELD_TYPES) typeSel.append(h("option", { value: t.id }, t.label));
    typeSel.value = f.type || "text";
    typeSel.addEventListener("change", () => {
      f.type = typeSel.value;
      renderFields();
    });
    const reqWrap = h("label", { class: "kb-designer-req" }, h("input", { type: "checkbox", class: "kb-check" }), h("span", null, "required"));
    reqWrap.querySelector("input").checked = !!f.required;
    reqWrap.querySelector("input").addEventListener("change", (e) => {
      f.required = e.target.checked;
    });

    const detail = h("div", { class: "kb-designer-detail" });
    if (f.type === "select" || f.type === "multiselect") {
      const opts = h("input", { class: "kb-input kb-input-sm", type: "text", placeholder: "Options, comma-separated (id: Label optional)" });
      opts.value = optionsText(f);
      opts.addEventListener("input", () => {
        f.options = parseOptions(opts.value);
      });
      detail.append(h("span", { class: "kb-designer-detail-label" }, "Options"), opts);
    } else if (f.type === "record") {
      const sel = h("select", { class: "kb-input kb-input-sm" });
      for (const r of REFERENCE_TYPES) sel.append(h("option", { value: r.id }, r.label));
      sel.value = f.of || "organizations";
      sel.addEventListener("change", () => {
        f.of = sel.value;
      });
      detail.append(h("span", { class: "kb-designer-detail-label" }, "References"), sel);
    }
    const ph = h("input", { class: "kb-input kb-input-sm", type: "text", placeholder: "Placeholder (optional)" });
    ph.value = f.placeholder || "";
    ph.addEventListener("input", () => {
      f.placeholder = ph.value;
    });
    detail.append(h("span", { class: "kb-designer-detail-label" }, "Hint"), ph);

    const help = h("input", { class: "kb-input kb-input-sm", type: "text", placeholder: "Help text (optional)" });
    help.value = f.help || "";
    help.addEventListener("input", () => {
      f.help = help.value;
    });
    detail.append(h("span", { class: "kb-designer-detail-label" }, "Help"), help);

    if (f.type === "date") {
      const expWrap = h("label", { class: "kb-designer-req" }, h("input", { type: "checkbox", class: "kb-check" }), h("span", null, "renewal / expiry date"));
      expWrap.querySelector("input").checked = !!f.expiry;
      expWrap.querySelector("input").addEventListener("change", (e) => {
        f.expiry = e.target.checked;
      });
      detail.append(expWrap);
    }

    const up = h("button", { class: "kb-icon-btn", type: "button", title: "Move up", disabled: index === 0 }, "↑");
    up.addEventListener("click", () => move(f, -1));
    const down = h("button", { class: "kb-icon-btn", type: "button", title: "Move down", disabled: index === fields.length - 1 }, "↓");
    down.addEventListener("click", () => move(f, 1));
    const del = h("button", { class: "kb-icon-btn kb-btn-danger-text", type: "button", title: "Remove field" }, "✕");
    del.addEventListener("click", () => removeField(f));

    return h(
      "div",
      { class: "kb-designer-field" },
      h("div", { class: "kb-designer-field-head" }, h("span", { class: "kb-designer-no" }, String(index + 1)), label, typeSel, reqWrap, h("div", { class: "kb-designer-field-actions" }, up, down, del)),
      detail,
    );
  }

  function renderFields() {
    clear(fieldListEl);
    rows = fields.map((f, i) => fieldRow(f, i));
    if (!rows.length) fieldListEl.append(h("p", { class: "kb-muted" }, "No fields yet. Add the first field below."));
    else rows.forEach((r) => fieldListEl.append(r));
  }

  const addFieldBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbDesignerAddField" }, h("span", { class: "kb-icon", html: icons.plus }), "Add field");
  addFieldBtn.addEventListener("click", () => {
    fields.push({ label: "", type: "text", required: false, placeholder: "", help: "", expiry: false });
    renderFields();
    const last = fieldListEl.querySelector(".kb-designer-field:last-child .kb-designer-field-head .kb-input");
    if (last) last.focus();
  });

  const refChecks = REFERENCE_TYPES.map((r) => {
    const cb = h("input", { type: "checkbox", class: "kb-check", dataset: { ref: r.id } });
    cb.checked = existing ? (existing.references || []).includes(r.id) : false;
    return { id: r.id, label: r.label, cb };
  });

  const m = openModal({
    title: editing ? "Edit template — " + existing.name : "New asset type",
    description:
      "Define the fields this asset type records, each field's type, which are required, and which record types an instance may reference. The template is stored in the shared library, so it is available for every client.",
    wide: true,
    children: [
      h(
        "div",
        { class: "kb-designer-body" },
        h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Asset type name"), nameInput),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Category"), catSel),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Icon"), iconSel),
      ),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Description"), descInput),
      h("div", { class: "kb-designer-section" }, h("div", { class: "kb-subhead" }, "Fields"), fieldListEl, h("div", { class: "kb-designer-addrow" }, addFieldBtn)),
      h(
        "div",
        { class: "kb-designer-section" },
        h("div", { class: "kb-subhead" }, "Allowed references"),
        h("p", { class: "kb-muted" }, "Which record types an instance of this asset type may link to or point at."),
        h("div", { class: "kb-designer-refs" }, ...refChecks.map((r) => h("label", { class: "kb-designer-ref" }, r.cb, h("span", null, r.label)))),
      ),
      ),
    ],
  });
  m.overlay.querySelector(".kb-modal").classList.add("kb-modal-designer");
  renderFields();

  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbSaveTypeBtn" }, editing ? "Save template" : "Create asset type"),
  );
  m.actions.querySelector("#kbSaveTypeBtn").addEventListener("click", async () => {
    m.clearError();
    const input = {
      name: nameInput.value.trim(),
      description: descInput.value.trim(),
      category: catSel.value,
      icon: iconSel.value,
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: !!f.required,
        placeholder: f.placeholder || "",
        help: f.help || "",
        expiry: !!f.expiry,
        options: f.options,
        of: f.of,
      })),
      references: refChecks.filter((r) => r.cb.checked).map((r) => r.id),
      createdBy: whoami(ctx),
    };
    if (!input.name) {
      m.showError("Give the asset type a name.");
      return;
    }
    const v = validateAssetType({ ...input, fields: normalizeAssetFields(input.fields) });
    if (!v.ok) {
      m.showError(v.errors.join(" "));
      return;
    }
    try {
      const res = editing
        ? await ctx.assetTypes.update(existing.id, input, { updatedBy: whoami(ctx) })
        : await ctx.assetTypes.create(input);
      m.close();
      ctx.toast(editing ? "Saved “" + res.type.name + "”" : "Created “" + res.type.name + "”", "success");
      onSaved && onSaved(res.type);
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

// ---------------------------------------------------------------------------
// instance add/edit
// ---------------------------------------------------------------------------
export function openInstanceDialog(ctx, type, { setId = null, record = null, reload } = {}) {
  const editing = !!record;
  let summaries = [];
  const setSel = h("select", { class: "kb-input" });
  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Acme Billing" });
  nameInput.value = record ? record.name : "";
  const provSel = h("select", { class: "kb-input" });
  const originRow = h("div", { class: "kb-field-row" });
  const originBox = h("div", { class: "kb-origin-box", hidden: true }, h("span", { class: "kb-field-label" }, "Origin"), originRow);
  const fieldsHolder = h("div", { class: "kb-asset-fields-holder" });
  let fieldsBlock = null;
  let currentSet = null;

  function syncOrigin() {
    const p = provenanceDef(provSel.value);
    originRow.replaceChildren();
    const required = (p && p.requires) || [];
    originBox.hidden = required.length === 0;
    for (const f of required) {
      const inp = h("input", { class: "kb-input", type: "text", placeholder: p.placeholder || "", dataset: { origin: f } });
      const existing = record && record.origin ? record.origin[f] : "";
      inp.value = existing != null ? String(existing) : "";
      originRow.append(h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, p.requireLabel || f), inp));
    }
  }
  provSel.addEventListener("change", syncOrigin);

  function renderInstance(keepValues) {
    const prior = keepValues && fieldsBlock ? fieldsBlock.collect() : record ? record.assetFields || {} : {};
    fieldsBlock = renderAssetFields(type, prior, currentSet);
    fieldsHolder.replaceChildren(fieldsBlock.node);
  }

  async function selectSet(id) {
    currentSet = await ctx.docs.get(id).catch(() => null);
    renderInstance(true);
  }

  const m = openModal({
    title: (editing ? "Edit " : "Add ") + type.name,
    description: "The asset is stored in the chosen client's documentation set, classified and linkable like any other record.",
    wide: true,
    children: [
      h(
        "div",
        { class: "kb-designer-body" },
        h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Client"), setSel),
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Name"), nameInput),
      ),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Provenance"), provSel),
      originBox,
      fieldsHolder,
      ),
    ],
  });
  m.overlay.querySelector(".kb-modal").classList.add("kb-modal-designer");

  ctx.docs
    .summaries({ includeArchived: false })
    .then((all) => {
      summaries = all;
      setSel.replaceChildren();
      for (const s of all) setSel.append(h("option", { value: s.id }, s.name));
      const chosen = setId || (all[0] && all[0].id) || "";
      setSel.value = chosen;
      setSel.disabled = editing;
      selectSet(chosen);
    })
    .catch(() => {
      fieldsHolder.replaceChildren(h("p", { class: "kb-muted" }, "No client documentation sets yet — create one in Organizations first."));
    });
  setSel.addEventListener("change", () => selectSet(setSel.value));

  for (const p of PROVENANCE) provSel.append(h("option", { value: p.id }, p.label));
  provSel.value = record ? record.provenance : "authored";
  syncOrigin();

  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbSaveInstanceBtn" }, editing ? "Save asset" : "Add asset"),
  );
  m.actions.querySelector("#kbSaveInstanceBtn").addEventListener("click", async () => {
    m.clearError();
    const targetSet = editing ? setId : setSel.value;
    if (!targetSet) {
      m.showError("Choose a client documentation set.");
      return;
    }
    if (!nameInput.value.trim()) {
      m.showError("Give the asset a name.");
      return;
    }
    if (!fieldsBlock) {
      m.showError("The asset fields are still loading — try again in a moment.");
      return;
    }
    const assetFields = fieldsBlock.collect();
    const v = validateAssetRecord(type, { name: nameInput.value.trim(), assetFields });
    if (!v.ok) {
      m.showError(v.errors.join(" "));
      return;
    }
    const origin = {};
    for (const inp of originRow.querySelectorAll("[data-origin]")) origin[inp.dataset.origin] = inp.value.trim();
    const patch = { name: nameInput.value.trim(), assetTypeId: type.id, assetFields, informationModel: "flexible-asset", provenance: provSel.value, origin };
    try {
      const res = editing
        ? await ctx.docs.updateRecord(targetSet, { type: "flexibleAssets", id: record.id }, patch, { updatedBy: whoami(ctx) })
        : await ctx.docs.addRecord(targetSet, { type: "flexibleAssets", ...patch }, { updatedBy: whoami(ctx) });
      m.close();
      ctx.toast((editing ? "Saved " : "Added ") + "“" + res.record.name + "”", "success");
      reload && reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

async function removeInstance(ctx, setId, record, reload) {
  const ok = await confirmDialog({ title: "Remove “" + record.name + "”?", message: "This removes the flexible asset (and any links that reference it) from that client's documentation set.", confirmLabel: "Remove", danger: true });
  if (!ok) return;
  try {
    await ctx.docs.removeRecord(setId, { type: "flexibleAssets", id: record.id }, { updatedBy: whoami(ctx) });
    ctx.toast("Asset removed", "success");
    reload && reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

// ---------------------------------------------------------------------------
// type library actions
// ---------------------------------------------------------------------------
async function cloneType(ctx, type, after) {
  const name = await promptPanel({ title: "Clone “" + type.name + "”", placeholder: "Name for the copy", confirmLabel: "Clone", initial: type.name + " (copy)" });
  if (!name) return;
  try {
    const res = await ctx.assetTypes.clone(type.id, { name, createdBy: whoami(ctx) });
    ctx.toast("Cloned to “" + res.type.name + "”", "success");
    if (typeof after === "function") after(res.type);
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function resetType(ctx, type, reload) {
  const ok = await confirmDialog({
    title: "Reset “" + type.name + "” to shipped?",
    message: "This restores the template IT-U ships, discarding any local changes to its fields. Instances are not affected.",
    confirmLabel: "Reset template",
  });
  if (!ok) return;
  try {
    await ctx.assetTypes.reset(type.id, { updatedBy: whoami(ctx) });
    ctx.toast("Reset to the shipped template", "success");
    reload && reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function removeType(ctx, type, reload) {
  const inUse = (await collectInstances(ctx, type.id)).length;
  const ok = await confirmDialog({
    title: "Delete “" + type.name + "”?",
    message: inUse
      ? inUse + " client asset" + (inUse === 1 ? " uses" : "s use") + " this template and would be left without one. Delete the template anyway?"
      : "This removes the template from the shared library. This cannot be undone.",
    confirmLabel: "Delete template",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.assetTypes.remove(type.id, { force: true, updatedBy: whoami(ctx) });
    ctx.toast("Template deleted", "success");
    reload && reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function exportType(ctx, type) {
  try {
    const json = await ctx.assetTypes.exportType(type.id);
    downloadText((type.name || "asset-type").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".json", json);
    ctx.toast("Exported “" + type.name + "”", "success");
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

function importTypeDialog(ctx, reload) {
  const input = h("textarea", { class: "kb-input", rows: 8, placeholder: "Paste the exported template JSON here" });
  const m = openModal({
    title: "Import an asset template",
    description: "Paste a template exported from IT-U (or another instance) to add it to the shared library as a custom type.",
    wide: true,
    children: [h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Template JSON"), input)],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbImportTypeSaveBtn" }, "Import template"),
  );
  m.actions.querySelector("#kbImportTypeSaveBtn").addEventListener("click", async () => {
    m.clearError();
    try {
      const res = await ctx.assetTypes.importType(input.value, { createdBy: whoami(ctx) });
      m.close();
      ctx.toast("Imported “" + res.type.name + "”", "success");
      reload && reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

