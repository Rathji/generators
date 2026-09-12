// src/modules/documents.js — the Documents station (roadmap tasks 21–22).
//
// Documents hold narrative, procedures and diagrams. Two ideas meet here:
//   • the task-14 guidance — structured facts belong in a structured asset, not
//     buried in prose, and a free-text "what are you documenting?" becomes a
//     one-click structured template; and
//   • the task-21/22 authoring model — long-form documents with a type, a seeded
//     template, an independent revision history and a review cadence, including
//     the SOPs and deployment procedures that concern specific assets and
//     services.
//
// The station lists the client documentation sets; opening one (`#/documents/<id>`)
// shows that client's documents grouped by type group, each opening the editor in
// document-view.js. The Organizations station's record table also offers an
// "Open" action for documents, so the editor is reachable from either place.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, confirmDialog, relTime, openModal } from "./shared.js";
import { openDocumentEditor } from "./document-view.js";
import { openInstanceDialog } from "./assets.js";
import { STRUCTURED_GUIDANCE, suggestAssetTypes } from "../framework/guidance.js";
import { INFORMATION_MODELS, PROVENANCE, provenanceDef } from "../framework/classification.js";
import {
  DOCUMENT_GROUPS,
  documentsOfGroup,
  documentType,
  documentReviewStatus,
  isSopDoc,
} from "../framework/document.js";

const DESC =
  "Procedures, guides, SOPs, deployment instructions and reference material — plus the guidance to record structured facts as structured assets.";
const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

export default {
  id: "documents",
  label: "Documents",
  desc: DESC,
  icon: icons.article,
  render(ctx) {
    renderList(ctx);
  },
  renderDetail(ctx, sub) {
    renderDetail(ctx, decodeURIComponent(sub));
  },
};

// ---------------------------------------------------------------------------
// list view — the client picker + the task-14 guidance
// ---------------------------------------------------------------------------
function renderList(ctx) {
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading documentation sets…" }));
  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewDocSetBtn", onClick: () => newSet(ctx) }, "New documentation set"),
  );
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Documents", desc: DESC, actions, body }));
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
  clear(body);
  if (!sets.length) {
    body.append(
      emptyState({
        icon: icons.article,
        title: "No documents yet",
        description:
          "Documents live inside a client's documentation set. Create a documentation set, then author its procedures, guides and SOPs — each with a type, a seeded template, independent revisions and a review cadence.",
        action: h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newSet(ctx) }, "New documentation set"),
      }),
    );
    body.append(guidancePanel(), suggestionPanel(ctx));
    return;
  }
  const grid = h("div", { class: "kb-docset-grid" });
  for (const s of sets) grid.append(setCard(s));
  body.append(
    h("div", { class: "kb-docset-count" }, sets.length + " documentation set" + (sets.length === 1 ? "" : "s")),
    grid,
    guidancePanel(),
    suggestionPanel(ctx),
  );
}

function setCard(s) {
  const counts = s.counts || {};
  const docCount = counts.documents || 0;
  return h(
    "a",
    { class: "kb-docset-card", href: "#/documents/" + s.id, dataset: { id: s.id } },
    h(
      "div",
      { class: "kb-docset-card-head" },
      h("span", { class: "kb-docset-avatar", html: icons.article }),
      h("div", { class: "kb-docset-card-id" }, h("h3", { class: "kb-docset-name" }, s.name), h("div", { class: "kb-docset-kind" }, countPhrase(s))),
    ),
    h("div", { class: "kb-docset-meta" }, docCount + " document" + (docCount === 1 ? "" : "s") + " · v" + s.version + " · " + relTime(s.updatedAt)),
  );
}

function countPhrase(s) {
  const c = s.counts || {};
  const others = (c.organizations || 0) + (c.locations || 0) + (c.configurations || 0) + (c.flexibleAssets || 0);
  return others ? others + " linked record" + (others === 1 ? "" : "s") : "documentation set";
}

async function newSet(ctx) {
  const name = await promptName();
  if (!name) return;
  try {
    const set = await ctx.docs.create({ name, createdBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Created “" + set.name + "”", "success");
    ctx.go("#/documents/" + set.id);
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
// detail view — this client's documents
// ---------------------------------------------------------------------------
function renderDetail(ctx, id) {
  const titleEl = h("h1", { class: "kb-view-title" }, "…");
  const crumbEl = h("div", { class: "kb-breadcrumb" }, "IT-U / Documents");
  const actions = h("div", { class: "kb-actions-row" });
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading documents…" }));
  ctx.container.append(
    h(
      "div",
      { class: "kb-view" },
      h("header", { class: "kb-view-head" }, crumbEl, h("div", { class: "kb-view-title-row" }, titleEl, actions), h("p", { class: "kb-view-desc" }, "This client's documents, grouped by purpose. Open one to author its body, govern its review and link the records it concerns.")),
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
        action: h("a", { class: "kb-btn kb-btn-ghost", href: "#/documents" }, "Back to Documents"),
      }),
    );
    return;
  }
  ui.titleEl.textContent = set.name;
  ui.crumbEl.replaceChildren(
    h("a", { class: "kb-bc-link", href: "#/documents" }, "IT-U / Documents"),
    h("span", { class: "kb-bc-current" }, " / " + set.name),
  );
  const reload = () => loadDetail(ctx, id, ui);
  const archived = !!set.archived;
  clear(ui.actions);
  ui.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => ctx.go("#/organizations/" + set.id) }, "Open full set"),
    archived
      ? null
      : h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewDocumentBtn", onClick: () => newDocument(ctx, set, reload) }, "+ New document"),
  );
  clear(ui.body);
  ui.body.append(...renderDocuments(ctx, set, reload, { archived }));
}

function renderDocuments(ctx, set, reload, opts = {}) {
  const readonly = !!opts.archived;
  const all = set.records.documents || [];
  const out = [];
  if (readonly) {
    out.push(
      h(
        "div",
        { class: "kb-banner kb-banner-archived" },
        h("span", { class: "kb-banner-icon", html: icons.history }),
        h("div", { class: "kb-banner-text" }, h("strong", null, "This documentation set is archived and read-only.")),
      ),
    );
  }
  if (!all.length) {
    out.push(
      emptyState({
        icon: icons.article,
        title: "No documents in this set",
        description: "Author the client's procedures, troubleshooting guides, SOPs, deployment instructions and reference material here.",
        action: readonly ? null : h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newDocument(ctx, set, reload) }, "+ New document"),
      }),
    );
    return out;
  }
  for (const group of DOCUMENT_GROUPS) {
    const groupTypes = documentsOfGroup(group).map((t) => t.id);
    const docs = all.filter((d) => groupTypes.includes(d.docType) || (group === "Reference" && !documentType(d.docType)));
    if (!docs.length) continue;
    out.push(documentGroup(ctx, set, docs, group, reload, readonly));
  }
  return out;
}

function documentGroup(ctx, set, docs, group, reload, readonly) {
  const table = h("table", { class: "kb-table kb-record-table" });
  table.append(
    h(
      "thead",
      null,
      h("tr", null, h("th", null, "Document"), h("th", null, "Type"), h("th", null, "Details"), h("th", null, "Review"), h("th", null, "Links"), h("th", null, "")),
    ),
  );
  const tbody = h("tbody", null);
  for (const d of docs) tbody.append(documentRow(ctx, set, d, reload, readonly));
  table.append(tbody);
  return h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.article }),
      h("h2", { class: "kb-section-name" }, group),
      h("span", { class: "kb-count-pill" }, String(docs.length)),
    ),
    table,
  );
}

function documentRow(ctx, set, d, reload, readonly) {
  const type = documentType(d.docType);
  const review = documentReviewStatus(d);
  const links = (set.records.relationships || []).filter((r) => r.from.id === d.id && r.from.type === "documents");
  const nameRow = h(
    "div",
    { class: "kb-record-name-row" },
    h("span", { class: "kb-record-name" }, d.name),
    isSopDoc(d) ? h("span", { class: "kb-badge kb-badge-sop" }, "SOP") : null,
    h("span", { class: "kb-badge kb-badge-model" }, "v" + (Number(d.revision) || 1)),
  );
  return h(
    "tr",
    { class: "kb-record-row", dataset: { id: d.id, type: "documents", docType: d.docType } },
    h("td", null, nameRow, d.summary ? h("span", { class: "kb-record-sub" }, d.summary) : null),
    h("td", null, type ? type.label : "Unknown"),
    h("td", { class: "kb-record-details" }, detailLine(d)),
    h("td", null, reviewChip(review)),
    h("td", null, String(links.length)),
    h(
      "td",
      { class: "kb-record-actions" },
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openDocumentEditor(ctx, { setId: set.id, record: d, reload }) }, "Open"),
      readonly
        ? null
        : h(
            "button",
            { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeDocument(ctx, set, d, reload) },
            "Remove",
          ),
    ),
  );
}

function detailLine(d) {
  const words = String(d.body || "").trim().split(/\s+/).filter(Boolean).length;
  const type = documentType(d.docType);
  return [type ? type.label : "Document", words ? words + " word" + (words === 1 ? "" : "s") : null].filter(Boolean).join(" · ");
}

function reviewChip(review) {
  const tone = review.state === "overdue" ? "danger" : review.state === "due-soon" ? "warn" : review.state === "due" ? "info" : "muted";
  return h("span", { class: "kb-doc-review kb-doc-review--" + tone, title: review.dueAt ? "Next review " + review.dueAt : "" }, review.label);
}

async function removeDocument(ctx, set, record, reload) {
  const ok = await confirmDialog({
    title: "Remove “" + record.name + "”?",
    message: "The document and its revision history are removed from this set. The set's version advances, so the removal can itself be recovered from history.",
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.docs.removeRecord(set.id, { type: "documents", id: record.id }, { updatedBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Removed “" + record.name + "”", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

// ---------------------------------------------------------------------------
// new-document dialog
// ---------------------------------------------------------------------------
function newDocument(ctx, set, reload) {
  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Office setup procedure, M365 onboarding SOP" });
  const typeSel = h("select", { class: "kb-input", id: "kbNewDocType" });
  for (const group of DOCUMENT_GROUPS) {
    const og = h("optgroup", { label: group });
    for (const t of documentsOfGroup(group)) og.append(h("option", { value: t.id }, t.label));
    typeSel.append(og);
  }
  typeSel.value = "reference";
  const summaryInput = h("input", { class: "kb-input", type: "text", placeholder: "One line saying what this document is for" });
  const modelSel = h("select", { class: "kb-input" });
  for (const mm of INFORMATION_MODELS) modelSel.append(h("option", { value: mm.id }, mm.label));
  modelSel.value = "document";
  const provSel = h("select", { class: "kb-input" });
  for (const p of PROVENANCE) provSel.append(h("option", { value: p.id }, p.label));
  provSel.value = "authored";
  const originRow = h("div", { class: "kb-field-row" });
  const originBox = h("div", { class: "kb-origin-box", hidden: true });
  originBox.append(h("span", { class: "kb-field-label" }, "Origin"), originRow);
  function syncOrigin() {
    const p = provenanceDef(provSel.value);
    originRow.replaceChildren();
    const required = (p && p.requires) || [];
    originBox.hidden = required.length === 0;
    for (const f of required) {
      originRow.append(h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, p.requireLabel || f), h("input", { class: "kb-input", type: "text", placeholder: p.placeholder || "", dataset: { origin: f } })));
    }
  }
  provSel.addEventListener("change", syncOrigin);
  syncOrigin();

  const templateHint = h("p", { class: "kb-field-help" }, "");
  const updateHint = () => {
    const t = documentType(typeSel.value);
    templateHint.textContent = t ? "Starts from the “" + t.label + "” template — " + t.description : "";
  };
  typeSel.addEventListener("change", updateHint);
  updateHint();

  const m = openModal({
    title: "New document",
    description: "Give the document a title and a type. IT-U seeds the type's template, and the document's revisions are tracked independently.",
    children: [
      h("div", { class: "kb-field-row" }, h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Title"), nameInput), h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Document type"), typeSel)),
      templateHint,
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Summary"), summaryInput),
      h("div", { class: "kb-field-row" }, h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Information model"), modelSel), h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Provenance"), provSel)),
      originBox,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewDocSaveBtn" }, "Create document"),
  );
  m.actions.querySelector("#kbNewDocSaveBtn").addEventListener("click", async () => {
    m.clearError();
    if (!nameInput.value.trim()) {
      m.showError("Give the document a title.");
      return;
    }
    const origin = {};
    for (const inp of originRow.querySelectorAll("[data-origin]")) origin[inp.dataset.origin] = inp.value.trim();
    const input = {
      name: nameInput.value.trim(),
      docType: typeSel.value,
      summary: summaryInput.value.trim(),
      informationModel: modelSel.value,
      provenance: provSel.value,
      origin,
    };
    try {
      const res = await ctx.docs.addDocument(set.id, input, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      m.close();
      ctx.toast("Created “" + res.record.name + "”", "success");
      reload();
      openDocumentEditor(ctx, { setId: set.id, record: res.record, reload });
    } catch (e) {
      m.showError(String((e && e.message) || e) + (e && e.hint ? " " + e.hint : ""));
    }
  });
  nameInput.focus();
}

// ---------------------------------------------------------------------------
// guidance (task 14) — kept on the list view so the habit starts here
// ---------------------------------------------------------------------------
function guidancePanel() {
  const column = (title, items, tone) =>
    h(
      "div",
      { class: "kb-guidance-col kb-guidance-col--" + tone },
      h("h3", { class: "kb-guidance-col-h" }, title),
      h(
        "ul",
        { class: "kb-guidance-list" },
        items.map((it) => h("li", { class: "kb-guidance-item" }, h("span", { class: "kb-guidance-item-title" }, it.title), h("span", { class: "kb-guidance-item-detail" }, it.detail))),
      ),
    );
  return h(
    "section",
    { class: "kb-card kb-guidance" },
    h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.layers }), h("h2", { class: "kb-section-name" }, "Record it as structure, not prose")),
    h("p", { class: "kb-muted" }, "Before you write a document, check whether the fact belongs in a structured asset. A linked record is reusable everywhere; a sentence in a document is not."),
    h("div", { class: "kb-guidance-grid" }, column("Record as a structured asset", STRUCTURED_GUIDANCE.structured, "structured"), column("Leave it as a document", STRUCTURED_GUIDANCE.documents, "documents")),
  );
}

function suggestionPanel(ctx) {
  const input = h("input", { class: "kb-input", type: "search", id: "kbDocSuggestInput", placeholder: "e.g. “the new M365 licences”, “warehouse access points”, “accountant’s laptop build”" });
  const results = h("div", { class: "kb-suggest-results" });
  let renderSeq = 0;
  const render = async () => {
    const seq = ++renderSeq;
    const q = input.value.trim();
    results.replaceChildren();
    if (!q) {
      results.append(h("p", { class: "kb-muted" }, "Type what you are about to document and IT-U will suggest the matching structured template."));
      return;
    }
    let types = [];
    try {
      types = await ctx.assetTypes.list();
    } catch {
      types = [];
    }
    if (seq !== renderSeq) return;
    const matches = suggestAssetTypes(q, types, { limit: 5 });
    if (!matches.length) {
      results.append(h("p", { class: "kb-muted" }, "No structured template matched. Browse the library, or author a custom asset type in the Assets station."));
      return;
    }
    for (const match of matches) {
      const btn = h(
        "button",
        { class: "kb-suggest-btn", type: "button", dataset: { type: match.type.id } },
        h("span", { class: "kb-suggest-btn-name" }, match.type.name),
        h("span", { class: "kb-suggest-btn-why" }, "matched: " + match.matched.join(", ")),
      );
      btn.addEventListener("click", () => {
        const reload = () => render();
        openInstanceDialog(ctx, match.type, { setId: null, record: null, reload: () => reload() });
      });
      results.append(btn);
    }
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") render();
  });
  const panel = h(
    "section",
    { class: "kb-card kb-suggest" },
    h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.search }), h("h2", { class: "kb-section-name" }, "What are you documenting?")),
    h("div", { class: "kb-suggest-row" }, input, h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: render }, "Suggest templates")),
    results,
  );
  render();
  return panel;
}
