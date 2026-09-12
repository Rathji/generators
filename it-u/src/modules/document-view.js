// src/modules/document-view.js — the document editor (roadmap tasks 21–22).
//
// The Organizations station's record tables show a document's one-line summary
// and an "Open" action; this module is the editor that action opens. It authors
// the markdown body with a live preview, seeds each document type's template,
// governs the document (type, tags, review cadence, review stamp), tracks its
// independent revisions with restore, links it to the organizations, assets,
// services and locations it concerns, and — the task-21 rule made real — offers
// to turn a procedural body into a linked checklist when a checklist fits
// better than prose.
//
// Editing a document commits through saveDocument(), which appends a revision;
// so the revision rail grows with every save and nothing is ever lost.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal, confirmDialog, relTime } from "./shared.js";
import {
  DOCUMENT_GROUPS,
  documentsOfGroup,
  documentType,
  documentTypeLabel,
  documentTemplate,
  documentReviewStatus,
  checklistSuitability,
  documentVersionList,
  documentRevision,
  normalizeTags,
  isSopDoc,
} from "../framework/document.js";
import { renderMarkdown } from "../framework/markdown.js";
import { libraryForDocType, libraryTopicLabel, articleInsertionText } from "../framework/library.js";
import { findRecord, relationshipKind } from "../framework/relationships.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

// The link groups a document offers, mapped onto the document→* relationship
// kinds added in task 21/22. A record of any listed type may be the far end;
// the picker labels each candidate so the user knows what they are linking to.
const LINK_KINDS = [
  { kind: "document-organization", label: "Organization", types: ["organizations"] },
  { kind: "document-asset", label: "Asset", types: ["configurations", "flexibleAssets", "trackers"] },
  { kind: "document-service", label: "Service", types: ["flexibleAssets", "runbooks"] },
  { kind: "document-location", label: "Location", types: ["locations"] },
  { kind: "document-related", label: "Related document", types: ["documents"] },
];

const typeIcon = (id) => icons[(documentType(id) || {}).icon] || icons.article;

export async function openDocumentEditor(ctx, { setId, record, reload } = {}) {
  if (!setId || !record) return;

  let set = await ctx.docs.get(setId, { force: true }).catch(() => null);
  const readonly = !!(set && set.archived);
  const body = h("div", { class: "kb-doc-editor" });
  const m = openModal({
    title: "Document — " + (record.name || "Untitled"),
    description:
      "Author the document in markdown, govern its review, link the records it concerns, and track its independent revisions.",
    wide: true,
    children: [body],
  });
  const box = m.overlay.querySelector(".kb-modal");
  if (box) box.classList.add("kb-modal-editor");

  let current = record;

  async function rerender() {
    set = await ctx.docs.get(setId, { force: true }).catch(() => null);
    current = ((set && set.records.documents) || []).find((r) => r.id === record.id) || current;
    clear(body);
    body.append(...editorBlocks());
  }

  function liveRecord() {
    return ((set && set.records.documents) || []).find((r) => r.id === record.id) || current;
  }

  // ---- header -----------------------------------------------------------
  function headerBlock() {
    const rec = liveRecord();
    const type = documentType(rec.docType);
    const review = documentReviewStatus(rec);
    const badges = h(
      "div",
      { class: "kb-doc-editor-badges" },
      h("span", { class: "kb-badge kb-badge-custom" }, type ? type.label : "Unknown type"),
      isSopDoc(rec) ? h("span", { class: "kb-badge kb-badge-required" }, "Standard procedure") : null,
      h("span", { class: "kb-badge kb-badge-model" }, "v" + documentRevision(rec)),
      reviewBadge(review),
    );
    return h(
      "div",
      { class: "kb-doc-editor-head" },
      h("span", { class: "kb-doc-editor-icon", html: typeIcon(rec.docType) }),
      h("div", { class: "kb-doc-editor-head-text" }, h("div", { class: "kb-doc-editor-title" }, rec.name), badges),
    );
  }

  function reviewBadge(review) {
    const tone = review.state === "overdue" ? "danger" : review.state === "due-soon" ? "warn" : review.state === "due" ? "info" : "muted";
    return h("span", { class: "kb-doc-review kb-doc-review--" + tone, title: review.dueAt ? "Next review " + review.dueAt : "" }, review.label);
  }

  // ---- form fields ------------------------------------------------------
  function fieldsBlock() {
    const rec = liveRecord();
    const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "Document title" });
    nameInput.value = rec.name || "";
    nameInput.disabled = readonly;

    const typeSel = h("select", { class: "kb-input", id: "kbDocTypeSel" });
    for (const group of DOCUMENT_GROUPS) {
      const og = h("optgroup", { label: group });
      for (const t of documentsOfGroup(group)) og.append(h("option", { value: t.id }, t.label));
      typeSel.append(og);
    }
    typeSel.value = rec.docType || "reference";
    typeSel.disabled = readonly;

    const summaryInput = h("input", { class: "kb-input", type: "text", placeholder: "One line saying what this document is for" });
    summaryInput.value = rec.summary || "";
    summaryInput.disabled = readonly;

    const tagsInput = h("input", { class: "kb-input", type: "text", placeholder: "comma, separated, words" });
    tagsInput.value = (rec.tags || []).join(", ");
    tagsInput.disabled = readonly;

    const reviewInput = h("input", { class: "kb-input", type: "number", min: "0", placeholder: "365" });
    reviewInput.value = rec.reviewIntervalDays != null ? String(rec.reviewIntervalDays) : "";
    reviewInput.disabled = readonly;

    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Title"), nameInput),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Document type"), typeSel),
      ),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Summary"), summaryInput),
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Tags"), tagsInput),
        h(
          "div",
          { class: "kb-field" },
          h("span", { class: "kb-field-label" }, "Review every (days)"),
          h("div", { class: "kb-doc-review-row" }, reviewInput, reviewAction()),
        ),
      ),
    );
    section.inputs = { nameInput, typeSel, summaryInput, tagsInput, reviewInput };
    return section;
  }

  // The review stamp action + status, sized to sit beside the interval field.
  function reviewAction() {
    const rec = liveRecord();
    if (readonly) return h("span", { class: "kb-doc-review-stamp" }, "Reviewed " + (rec.reviewedAt || "—"));
    return h(
      "button",
      {
        class: "kb-btn kb-btn-ghost kb-btn-sm",
        type: "button",
        id: "kbDocMarkReviewedBtn",
        title: "Stamp today as the last review date",
        onClick: async () => {
          try {
            await ctx.docs.markDocumentReviewed(setId, { type: "documents", id: rec.id }, { updatedBy: whoami(ctx) });
            ctx.toast("Marked “" + rec.name + "” reviewed today", "success");
            await rerender();
            reload && reload();
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        },
      },
      h("span", { class: "kb-icon", html: icons.review }),
      "Mark reviewed",
    );
  }

  // ---- body editor + preview -------------------------------------------
  function bodyBlock() {
    const rec = liveRecord();
    const textarea = h("textarea", { class: "kb-input kb-doc-textarea", id: "kbDocBodyInput", rows: 18, spellcheck: "false" });
    textarea.value = rec.body || "";
    textarea.disabled = readonly;
    const previewEl = h("div", { class: "kb-markdown kb-prose kb-doc-preview" });

    const updatePreview = () => {
      previewEl.innerHTML = renderMarkdown(textarea.value || "").html || '<p class="kb-muted">Nothing to preview yet.</p>';
    };
    textarea.addEventListener("input", updatePreview);
    updatePreview();

    const toolbar = h(
      "div",
      { class: "kb-doc-editor-toolbar" },
      h("span", { class: "kb-field-label" }, "Body (markdown)"),
      h(
        "div",
        { class: "kb-doc-editor-toolbar-actions" },
        readonly
          ? null
          : h(
              "button",
              {
                class: "kb-btn kb-btn-ghost kb-btn-sm",
                type: "button",
                id: "kbDocTemplateBtn",
                title: "Replace the body with this type's starter template",
                onClick: async () => {
                  const tpl = documentTemplate((document.querySelector("#kbDocTypeSel") || {}).value || rec.docType);
                  const ok = await confirmDialog({
                    title: "Insert the " + documentTypeLabel(tpl.docType) + " template?",
                    message: "This replaces the body below with the seeded template for this document type. You can still cancel the whole edit before saving.",
                    confirmLabel: "Insert template",
                  });
                  if (!ok) return;
                  textarea.value = tpl.body;
                  updatePreview();
                },
              },
              "Insert template",
            ),
        readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbDocClearBtn", onClick: () => { textarea.value = ""; updatePreview(); } }, "Clear"),
      ),
    );

    const previewPane = h(
      "div",
      { class: "kb-doc-preview-pane" },
      h("span", { class: "kb-field-label" }, "Preview"),
      previewEl,
    );

    const section = h(
      "section",
      { class: "kb-card kb-profile-section kb-doc-body-section" },
      toolbar,
      h("div", { class: "kb-doc-editor-grid" }, textarea, previewPane),
    );
    section.textarea = textarea;
    return section;
  }

  // ---- checklist rule banner -------------------------------------------
  function checklistBanner() {
    const rec = liveRecord();
    const suit = checklistSuitability(rec);
    const already = (set.records.checklists || []).some((c) => c.origin && c.origin.documentId === rec.id);
    const info = h(
      "span",
      { class: "kb-doc-suit-steps" },
      suit.steps.length + " step" + (suit.steps.length === 1 ? "" : "s") + " detected",
    );
    const action = readonly || !suit.suited
      ? null
      : h(
          "button",
          {
            class: "kb-btn kb-btn-primary kb-btn-sm",
            type: "button",
            id: "kbDocConvertBtn",
            disabled: already,
            title: already ? "A checklist has already been generated from this document." : "Create a linked checklist from the document's ordered steps",
            onClick: async () => {
              try {
                const res = await ctx.docs.documentToChecklist(setId, { type: "documents", id: rec.id }, { updatedBy: whoami(ctx) });
                ctx.toast("Created checklist “" + res.record.name + "” (" + res.itemCount + " steps)", "success");
                await rerender();
                reload && reload();
              } catch (e) {
                ctx.toast(String((e && e.message) || e), "error", 5200);
              }
            },
          },
          already ? "Checklist created" : "Convert to checklist",
        );
    if (!suit.suited && !already) {
      return h(
        "section",
        { class: "kb-card kb-profile-section kb-doc-suit kb-doc-suit--quiet" },
        h("span", { class: "kb-doc-suit-icon", html: icons.clipboard }),
        h("p", { class: "kb-muted" }, "This reads as prose. If it is really a procedure a client must follow, write the steps as a numbered list and IT-U will offer to turn them into a checklist."),
      );
    }
    return h(
      "section",
      { class: "kb-card kb-profile-section kb-doc-suit" + (already ? " kb-doc-suit--done" : "") },
      h("span", { class: "kb-doc-suit-icon", html: icons.clipboard }),
      h(
        "div",
        { class: "kb-doc-suit-text" },
        h("strong", null, already ? "A checklist was generated from this document." : "This looks like a procedure."),
        h("p", { class: "kb-muted" }, (already ? "Its ordered steps already exist as a linked checklist." : "IT-U can turn the ordered steps into a linked checklist a technician can work through.") + " " + suit.reasons.join("; ") + "."),
      ),
      h("div", { class: "kb-doc-suit-side" }, info, action),
    );
  }

  // ---- links ------------------------------------------------------------
  function linksBlock() {
    const rec = liveRecord();
    const linked = (set.records.relationships || []).filter((r) => r.from.id === rec.id && r.from.type === "documents");
    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h(
        "div",
        { class: "kb-section-head" },
        h("span", { class: "kb-section-icon", html: icons.link }),
        h("h2", { class: "kb-section-name" }, "Linked records"),
        h("span", { class: "kb-count-pill" }, String(linked.length)),
        readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbDocLinkBtn", onClick: () => openLinkPicker(ctx, setId, rec, set, rerender) }, "+ Link"),
      ),
    );
    if (!linked.length) {
      section.append(
        h("p", { class: "kb-muted" }, "Not linked to anything yet. Link this document to the client, the assets it covers and the services it concerns — so it is discoverable from them."),
      );
      return section;
    }
    const list = h("ul", { class: "kb-rel-list" });
    for (const rel of linked) {
      const other = findRecord(set, rel.to);
      const k = relationshipKind(rel.kind);
      list.append(
        h(
          "li",
          { class: "kb-rel-item" + (other ? "" : " kb-rel-item--dangling") },
          h("span", { class: "kb-rel-item-name" }, other ? other.name : "(missing record)"),
          h("span", { class: "kb-rel-item-meta" }, other ? RECORD_TYPE_META[other.type] ? RECORD_TYPE_META[other.type].singular : other.type : "missing"),
          k ? h("span", { class: "kb-badge kb-rel-kind" }, k.label) : null,
          readonly
            ? null
            : h(
                "button",
                {
                  class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text",
                  type: "button",
                  onClick: async () => {
                    try {
                      await ctx.docs.unlinkRecords(setId, rel.id, { updatedBy: whoami(ctx) });
                      ctx.toast("Unlinked", "success");
                      await rerender();
                      reload && reload();
                    } catch (e) {
                      ctx.toast(String((e && e.message) || e), "error", 5200);
                    }
                  },
                },
                "Unlink",
              ),
        ),
      );
    }
    section.append(list);
    return section;
  }

  // ---- library (task 35): start from a service-process article ---------
  // The library articles that read as this document's type. Insert one as a
  // starting point (it is appended to the body below and can be edited freely),
  // or open it in the Library station to read first.
  function libraryBlock(b) {
    if (readonly) return null;
    const rec = liveRecord();
    const articles = libraryForDocType(rec.docType);
    if (!articles.length) return null;
    const section = h(
      "section",
      { class: "kb-card kb-profile-section", dataset: { block: "library" } },
      h(
        "div",
        { class: "kb-section-head" },
        h("span", { class: "kb-section-icon", html: icons.browse }),
        h("h2", { class: "kb-section-name" }, "Start from the library"),
        h("span", { class: "kb-count-pill" }, String(articles.length)),
      ),
      h("p", { class: "kb-muted" }, "Service processes written for this kind of document. Insert one below as a starting point, or read it in the Library station first."),
    );
    const list = h("div", { class: "kb-library-linklist" });
    for (const a of articles) {
      list.append(
        h(
          "div",
          { class: "kb-library-linkitem kb-library-linkitem--row", dataset: { id: a.id } },
          h(
            "div",
            { class: "kb-library-linkitem-main" },
            h("span", { class: "kb-library-linkitem-title" }, a.title),
            h("span", { class: "kb-library-linkitem-meta" }, libraryTopicLabel(a.topic)),
          ),
          h(
            "div",
            { class: "kb-library-linkitem-actions" },
            h(
              "button",
              {
                class: "kb-btn kb-btn-ghost kb-btn-sm",
                type: "button",
                onClick: () => {
                  m.close();
                  ctx.go("#/library/" + encodeURIComponent(a.id));
                },
              },
              "Read",
            ),
            h(
              "button",
              {
                class: "kb-btn kb-btn-primary kb-btn-sm",
                type: "button",
                dataset: { insert: a.id },
                onClick: () => {
                  const text = articleInsertionText(a);
                  b.textarea.value = b.textarea.value.trim() ? b.textarea.value.replace(/\s*$/, "") + "\n\n" + text : text;
                  b.textarea.dispatchEvent(new Event("input", { bubbles: true }));
                  ctx.toast("Inserted “" + a.title + "” into the body", "success");
                },
              },
              "Insert",
            ),
          ),
        ),
      );
    }
    section.append(list);
    return section;
  }

  // ---- revision history -------------------------------------------------
  function historyBlock() {
    const rec = liveRecord();
    const versions = documentVersionList(rec).slice().reverse();
    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h(
        "div",
        { class: "kb-section-head" },
        h("span", { class: "kb-section-icon", html: icons.history }),
        h("h2", { class: "kb-section-name" }, "Revisions"),
        h("span", { class: "kb-count-pill" }, String(versions.length)),
      ),
      h("p", { class: "kb-muted" }, "Versions are tracked independently of the rest of the set. Restoring an old version writes it back as a new revision, so nothing is lost."),
    );
    const list = h("ul", { class: "kb-doc-revisions" });
    for (const v of versions) {
      list.append(
        h(
          "li",
          { class: "kb-doc-revision" + (v.current ? " kb-doc-revision--current" : "") },
          h("span", { class: "kb-doc-revision-no" }, "v" + v.revision),
          h(
            "span",
            { class: "kb-doc-revision-meta" },
            h("span", { class: "kb-doc-revision-type" }, documentTypeLabel(v.docType)),
            h("span", { class: "kb-muted" }, " · " + (v.current ? "current" : "saved " + relTime(v.savedAt)) + (v.savedBy ? " by " + v.savedBy : "")),
          ),
          !v.current && !readonly
            ? h(
                "button",
                {
                  class: "kb-btn kb-btn-ghost kb-btn-sm",
                  type: "button",
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: "Restore revision " + v.revision + "?",
                      message: "Its content is written back as a NEW revision (v" + (documentRevision(rec) + 1) + "). The current version stays in the history.",
                      confirmLabel: "Restore",
                    });
                    if (!ok) return;
                    try {
                      await ctx.docs.restoreDocumentRevision(setId, { type: "documents", id: rec.id }, v.revision, { updatedBy: whoami(ctx) });
                      ctx.toast("Restored revision " + v.revision, "success");
                      await rerender();
                      reload && reload();
                    } catch (e) {
                      ctx.toast(String((e && e.message) || e), "error", 5200);
                    }
                  },
                },
                "Restore",
              )
            : null,
        ),
      );
    }
    section.append(list);
    return section;
  }

  // Collect the input elements from a rendered form block so Save can read them.
  let form;

  function editorBlocks() {
    const f = fieldsBlock();
    const b = bodyBlock();
    form = { ...f.inputs, textarea: b.textarea };
    return [headerBlock(), f, b, libraryBlock(b), checklistBanner(), linksBlock(), historyBlock()].filter(Boolean);
  }

  // ---- actions ----------------------------------------------------------
  if (readonly) {
    m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
  } else {
    m.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbDocSaveBtn" }, "Save document"),
    );
    m.actions.querySelector("#kbDocSaveBtn").addEventListener("click", async () => {
      m.clearError();
      const rec = liveRecord();
      const name = form.nameInput.value.trim();
      if (!name) {
        m.showError("Give the document a title.");
        return;
      }
      const patch = {
        name,
        docType: form.typeSel.value,
        summary: form.summaryInput.value.trim(),
        body: form.textarea.value,
        tags: normalizeTags(form.tagsInput.value),
        reviewIntervalDays: form.reviewInput.value === "" ? null : Number(form.reviewInput.value),
      };
      try {
        await ctx.docs.saveDocument(setId, { type: "documents", id: rec.id }, patch, { updatedBy: whoami(ctx) });
        m.close();
        ctx.toast("Saved “" + name + "” — revision " + (documentRevision(rec) + 1), "success");
        reload && reload();
      } catch (e) {
        m.showError(String((e && e.message) || e));
      }
    });
  }

  await rerender();
  return m;
}

// A small picker: choose what kind of record to link, then which record. Choices
// are limited to the records that are not already linked.
function openLinkPicker(ctx, setId, record, set, done) {
  const groups = LINK_KINDS.map((k) => {
    const candidates = [];
    for (const t of k.types) {
      for (const r of set.records[t] || []) {
        if (t === "documents" && r.id === record.id) continue;
        candidates.push(r);
      }
    }
    return { ...k, candidates };
  });
  const kindSel = h("select", { class: "kb-input" });
  groups.forEach((g, i) => kindSel.append(h("option", { value: String(i) }, g.label)));
  const recSel = h("select", { class: "kb-input" });
  const renderRecords = () => {
    const g = groups[Number(kindSel.value)] || groups[0];
    clear(recSel);
    const linked = new Set((set.records.relationships || []).filter((r) => r.from.id === record.id).map((r) => r.to.id));
    const avail = g.candidates.filter((r) => !linked.has(r.id));
    if (!avail.length) {
      recSel.append(h("option", { value: "" }, "Nothing available to link"));
    } else {
      avail.forEach((r, i) => {
        const coll = RECORD_TYPE_META[r.type] ? RECORD_TYPE_META[r.type].singular : r.type;
        recSel.append(h("option", { value: String(i) }, r.name + "  —  " + coll));
      });
    }
    recSel._avail = avail;
  };
  kindSel.addEventListener("change", renderRecords);
  renderRecords();

  const m = openModal({
    title: "Link — " + record.name,
    description: "Link this document to the records it concerns. The link is typed, so the relationship is reusable everywhere.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Link to a"), kindSel),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Record"), recSel),
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h(
      "button",
      {
        class: "kb-btn kb-btn-primary",
        type: "button",
        onClick: async () => {
          m.clearError();
          const g = groups[Number(kindSel.value)] || groups[0];
          const other = (recSel._avail || [])[Number(recSel.value)];
          if (!other) {
            m.showError("Pick a record to link.");
            return;
          }
          try {
            await ctx.docs.linkRecords(setId, { from: { type: "documents", id: record.id }, to: { type: other.type, id: other.id }, kind: g.kind, createdBy: whoami(ctx) });
            m.close();
            ctx.toast("Linked “" + other.name + "”", "success");
            done();
          } catch (e) {
            m.showError(String((e && e.message) || e));
          }
        },
      },
      "Link",
    ),
  );
}
