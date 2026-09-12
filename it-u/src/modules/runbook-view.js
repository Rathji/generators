// src/modules/runbook-view.js — the deployment-runbook editor (roadmap task 37).
//
// The Deployments station opens a runbook here. A runbook records the ORDERED
// BUILD of a service so a technician who did not design it can execute it: the
// editor authors its markdown body (with a live preview), governs its type,
// status, version, tags and review cadence, shows how much of a VoIP runbook's
// required structure it actually covers, surfaces the gaps the generator found,
// lets a VoIP runbook be regenerated from its voice asset, and tracks its
// independent revisions with restore.
//
// Editing commits through saveRunbook(), which appends a revision; so the
// revision rail grows with every save and nothing is ever lost.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal, confirmDialog, relTime } from "./shared.js";
import {
  RUNBOOK_TYPES,
  runbookType,
  runbookTypeLabel,
  RUNBOOK_STATUSES,
  runbookStatus,
  runbookReviewStatus,
  runbookVersionList,
  runbookRevision,
  normalizeRunbookTags,
  generateVoipRunbook,
  voipRunbookCoverage,
  VOIP_RUNBOOK_SECTIONS,
} from "../framework/runbook.js";
import { renderMarkdown } from "../framework/markdown.js";
import { findRecord, relationshipKind } from "../framework/relationships.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";
import { collabBar, conflictNotice } from "./collab-bar.js";
import { recordStamp, classifyRemoteChange, mergeRecords, describeField, previewValue } from "../framework/collab.js";
import { scopeFor, clientScope } from "../framework/roles.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

// The typed links a runbook offers. A runbook→service link is the one the
// generator writes; the rest keep the procedure discoverable from the records
// it concerns.
const LINK_KINDS = [
  { kind: "runbook-service", label: "Service / asset", types: ["flexibleAssets"] },
  { kind: "runbook-configuration", label: "Configuration", types: ["configurations"] },
  { kind: "runbook-location", label: "Location", types: ["locations"] },
  { kind: "runbook-organization", label: "Organization", types: ["organizations"] },
  { kind: "runbook-contact", label: "Responsible contact", types: ["contacts"] },
  { kind: "runbook-document", label: "Supporting document", types: ["documents"] },
];

export async function openRunbookEditor(ctx, { setId, record, reload } = {}) {
  if (!setId || !record) return;

  let set = await ctx.docs.get(setId, { force: true }).catch(() => null);
  const readonly = !!(set && set.archived);
  const body = h("div", { class: "kb-doc-editor" });
  const m = openModal({
    title: "Runbook — " + (record.name || "Untitled"),
    description:
      "Write the build as ordered, executable steps in markdown. Govern its status and review, regenerate it from its voice asset, link the records it concerns, and track its revisions.",
    wide: true,
    children: [body],
  });
  const box = m.overlay.querySelector(".kb-modal");
  if (box) box.classList.add("kb-modal-editor");

  let current = record;

  // ---- collaboration (task 55) ------------------------------------------
  // The editor claims a presence marker on this runbook and subscribes to
  // change events for the whole documentation set, so a save from another
  // session surfaces here as an inline remote-change / conflict banner instead
  // of silently clobbering the form.
  const hub = ctx.hub;
  const editorScope = scopeFor({ setId, record });
  const changeScope = clientScope(setId);
  const collab = collabBar(ctx, { scope: editorScope, recordId: record.id, label: "Runbook" });
  const noticeSlot = h("div", { class: "kb-collab-slot" });
  let baseRec = record;
  let baseStamp = recordStamp(baseRec);
  let offScope = null;
  let pollTimer = null;

  function formRecord() {
    const rec = liveRecord();
    return {
      ...rec,
      name: form.nameInput.value.trim(),
      runbookType: form.typeSel.value,
      status: form.statusSel.value,
      version: form.versionInput.value.trim(),
      summary: form.summaryInput.value.trim(),
      body: form.textarea.value,
      tags: normalizeRunbookTags(form.tagsInput.value),
      reviewIntervalDays: form.reviewInput.value === "" ? null : Number(form.reviewInput.value),
    };
  }

  function clearNotice() {
    clear(noticeSlot);
    for (const el of body.querySelectorAll(".kb-field--conflict")) el.classList.remove("kb-field--conflict");
  }

  // Mark the fields that genuinely conflicted (both sides changed them) so the
  // technician can see, at a glance, exactly what needs their judgement.
  function highlightFields(fields) {
    if (!form) return;
    const byField = {
      name: form.nameInput,
      runbookType: form.typeSel,
      status: form.statusSel,
      version: form.versionInput,
      summary: form.summaryInput,
      tags: form.tagsInput,
      reviewIntervalDays: form.reviewInput,
      body: form.textarea,
    };
    for (const f of fields) {
      const inp = byField[f];
      const fld = inp && (inp.closest(".kb-field") || inp.parentElement);
      if (fld) fld.classList.add("kb-field--conflict");
    }
  }

  async function rerender() {
    set = await ctx.docs.get(setId, { force: true }).catch(() => null);
    current = ((set && set.records.runbooks) || []).find((r) => r.id === record.id) || current;
    clear(body);
    clear(noticeSlot);
    const blocks = editorBlocks();
    // Header, then the live presence strip + any conflict banner, then the form.
    body.append(blocks[0], collab.el, noticeSlot, ...blocks.slice(1));
    baseRec = liveRecord();
    baseStamp = recordStamp(baseRec);
  }

  // Apply a three-way merge result to the form fields, flagging the fields both
  // sides changed. The revision history and other untouched keys come from the
  // re-read set on the next save.
  function applyMerge(merged) {
    if (!form) return;
    if ("name" in merged) form.nameInput.value = merged.name == null ? "" : String(merged.name);
    if ("runbookType" in merged) form.typeSel.value = merged.runbookType || "service-deployment";
    if ("status" in merged) form.statusSel.value = merged.status || "draft";
    if ("version" in merged) form.versionInput.value = merged.version == null ? "" : String(merged.version);
    if ("summary" in merged) form.summaryInput.value = merged.summary || "";
    if ("body" in merged) {
      form.textarea.value = merged.body || "";
      form.textarea.dispatchEvent(new Event("input"));
    }
    if ("tags" in merged) form.tagsInput.value = (merged.tags || []).join(", ");
    if ("reviewIntervalDays" in merged) form.reviewInput.value = merged.reviewIntervalDays == null ? "" : String(merged.reviewIntervalDays);
    highlightFields(merged.conflicts.map((c) => c.field));
    const n = merged.conflicts.length;
    ctx.toast(
      n ? "Merged — " + n + " field" + (n === 1 ? "" : "s") + " kept yours (flagged)" : "Merged cleanly",
      n ? "warning" : "success",
      4200,
    );
  }

  // A remote save landed on this runbook while it was open here.
  async function onRemoteChange(evt) {
    if (!hub) return;
    if (evt && evt.by && hub.username && evt.by === hub.username) return; // our own save
    let fresh;
    try {
      fresh = await ctx.docs.get(setId, { force: true });
    } catch {
      return;
    }
    const theirs = ((fresh && fresh.records.runbooks) || []).find((r) => r.id === record.id);
    if (!theirs) return;
    const kind = classifyRemoteChange({ base: baseStamp, mine: recordStamp(formRecord()), theirs: recordStamp(theirs) });
    if (kind === "unchanged") return;
    if (kind === "converged") {
      baseRec = theirs;
      baseStamp = recordStamp(theirs);
      return;
    }
    if (kind === "remote-only") {
      current = theirs;
      set = fresh;
      baseRec = theirs;
      baseStamp = recordStamp(theirs);
      clear(body);
      clear(noticeSlot);
      const blocks = editorBlocks();
      body.append(blocks[0], collab.el, noticeSlot, ...blocks.slice(1));
      ctx.toast("Reloaded — this runbook changed on another session", "info", 3600);
      return;
    }
    showConflict(theirs);
  }

  function showConflict(theirs) {
    const merged = mergeRecords(baseRec, formRecord(), theirs);
    const fields = merged.conflicts.map(
      (c) => describeField(c.field) + ": yours “" + previewValue(c.mine) + "” · theirs “" + previewValue(c.theirs) + "”",
    );
    const adopted = merged.adopted.length;
    const notice = conflictNotice({
      title: "This runbook changed on another session",
      detail:
        "Someone saved a new version while you were editing." +
        (adopted ? " " + adopted + " field" + (adopted === 1 ? "" : "s") + " (" + merged.adopted.map(describeField).join(", ") + ") can be taken automatically." : " Your edits are still here."),
      fields,
      actions: [
        {
          label: "Merge (keep both)",
          tone: "primary",
          onClick: () => {
            clearNotice();
            applyMerge(merged);
            baseRec = theirs;
            baseStamp = recordStamp(theirs);
          },
        },
        {
          label: "Reload (take theirs)",
          tone: "ghost",
          onClick: async () => {
            clearNotice();
            current = theirs;
            set = await ctx.docs.get(setId, { force: true }).catch(() => set);
            baseRec = ((set && set.records.runbooks) || []).find((r) => r.id === record.id) || theirs;
            baseStamp = recordStamp(baseRec);
            clear(body);
            const blocks = editorBlocks();
            body.append(blocks[0], collab.el, noticeSlot, ...blocks.slice(1));
            ctx.toast("Reloaded to the newer version", "info", 3200);
          },
        },
        {
          label: "Keep mine",
          tone: "ghost",
          onClick: () => {
            baseRec = theirs;
            baseStamp = recordStamp(theirs);
            clearNotice();
            ctx.toast("Your version will overwrite theirs when you save", "warning", 3600);
          },
        },
      ],
    });
    clear(noticeSlot);
    noticeSlot.append(notice);
    highlightFields(merged.conflicts.map((c) => c.field));
  }

  const baseClose = m.close;
  m.close = () => {
    try {
      collab.stop();
    } catch {}
    if (offScope) {
      try {
        offScope();
      } catch {}
      offScope = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    baseClose();
  };

  function startCollab() {
    collab.start();
    if (hub && hub.watchScope) {
      offScope = hub.watchScope(changeScope, (evt) => {
        onRemoteChange(evt);
      });
    }
    // Degrade to polling: while the hub is unreachable (offline, or signed
    // out) the change broadcast cannot reach us, so re-read the set on a timer
    // and surface any remote save the same way a live event would. The hub's
    // own reconnect resumes live delivery automatically.
    pollTimer = setInterval(() => {
      if (hub && hub.connected && hub.authenticated) return;
      onRemoteChange({ by: "", via: "poll" });
    }, 12000);
  }

  function liveRecord() {
    return ((set && set.records.runbooks) || []).find((r) => r.id === record.id) || current;
  }

  // ---- header -----------------------------------------------------------
  function headerBlock() {
    const rec = liveRecord();
    const type = runbookType(rec.runbookType);
    const review = runbookReviewStatus(rec);
    const badges = h(
      "div",
      { class: "kb-doc-editor-badges" },
      h("span", { class: "kb-badge kb-badge-custom" }, type ? type.label : "Unknown type"),
      statusBadge(rec.status),
      h("span", { class: "kb-badge kb-badge-model" }, "v" + runbookRevision(rec)),
      reviewBadge(review),
    );
    return h(
      "div",
      { class: "kb-doc-editor-head" },
      h("span", { class: "kb-doc-editor-icon", html: icons[(type && type.icon) || "rocket"] || icons.rocket }),
      h("div", { class: "kb-doc-editor-head-text" }, h("div", { class: "kb-doc-editor-title" }, rec.name), badges),
    );
  }

  function statusTone(id) {
    return id === "complete" ? "done" : id === "in-progress" ? "info" : id === "ready" ? "ok" : id === "superseded" ? "muted" : "draft";
  }

  function statusBadge(id) {
    const s = runbookStatus(id);
    return h("span", { class: "kb-runbook-status kb-runbook-status--" + statusTone(id) }, s ? s.label : "Draft");
  }

  function reviewBadge(review) {
    const tone = review.state === "overdue" ? "danger" : review.state === "due-soon" ? "warn" : review.state === "due" ? "info" : "muted";
    return h("span", { class: "kb-doc-review kb-doc-review--" + tone, title: review.dueAt ? "Next review " + review.dueAt : "" }, review.label);
  }

  // ---- form fields ------------------------------------------------------
  function fieldsBlock() {
    const rec = liveRecord();
    const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "Runbook title" });
    nameInput.value = rec.name || "";
    nameInput.disabled = readonly;

    const typeSel = h("select", { class: "kb-input", id: "kbRunbookTypeSel" });
    for (const t of RUNBOOK_TYPES) typeSel.append(h("option", { value: t.id }, t.label));
    typeSel.value = rec.runbookType || "service-deployment";
    typeSel.disabled = readonly;

    const statusSel = h("select", { class: "kb-input" });
    for (const s of RUNBOOK_STATUSES) statusSel.append(h("option", { value: s.id }, s.label));
    statusSel.value = rec.status || "draft";
    statusSel.disabled = readonly;

    const versionInput = h("input", { class: "kb-input", type: "text", placeholder: "1.0" });
    versionInput.value = rec.version != null ? String(rec.version) : "";
    versionInput.disabled = readonly;

    const summaryInput = h("input", { class: "kb-input", type: "text", placeholder: "One line saying what this runbook deploys" });
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
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Name"), nameInput),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Runbook type"), typeSel),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Status"), statusSel),
      ),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Summary"), summaryInput),
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Version"), versionInput),
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Tags"), tagsInput),
        h(
          "div",
          { class: "kb-field" },
          h("span", { class: "kb-field-label" }, "Review every (days)"),
          h("div", { class: "kb-doc-review-row" }, reviewInput, reviewAction()),
        ),
      ),
    );
    section.inputs = { nameInput, typeSel, statusSel, versionInput, summaryInput, tagsInput, reviewInput };
    return section;
  }

  function reviewAction() {
    const rec = liveRecord();
    if (readonly) return h("span", { class: "kb-doc-review-stamp" }, "Reviewed " + (rec.reviewedAt || "—"));
    return h(
      "button",
      {
        class: "kb-btn kb-btn-ghost kb-btn-sm",
        type: "button",
        title: "Stamp today as the last review date",
        onClick: async () => {
          try {
            await ctx.docs.markRunbookReviewed(setId, { type: "runbooks", id: rec.id }, { updatedBy: whoami(ctx) });
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

  // ---- coverage & warnings (VoIP runbooks) ------------------------------
  // The generator writes one `## heading` per required section. This shows, at
  // a glance, which of them the body still contains — editing a section out is
  // caught here rather than on site.
  function coverageBlock() {
    const rec = liveRecord();
    if (rec.runbookType !== "voip-deployment") return null;
    const cov = voipRunbookCoverage(rec);
    const warnings = (rec.origin && Array.isArray(rec.origin.warnings) ? rec.origin.warnings : []) || [];
    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h(
        "div",
        { class: "kb-section-head" },
        h("span", { class: "kb-section-icon", html: icons.check }),
        h("h2", { class: "kb-section-name" }, "Deployment coverage"),
        h("span", { class: "kb-count-pill" }, String(VOIP_RUNBOOK_SECTIONS.filter((s) => cov[s.id]).length) + "/" + VOIP_RUNBOOK_SECTIONS.length),
      ),
    );
    const chips = h("div", { class: "kb-runbook-coverage" });
    for (const s of VOIP_RUNBOOK_SECTIONS) {
      const present = !!cov[s.id];
      chips.append(
        h(
          "span",
          { class: "kb-runbook-cov" + (present ? " kb-runbook-cov--on" : s.required ? " kb-runbook-cov--missing" : " kb-runbook-cov--optional"), title: s.required ? "Required section" : "Optional section" },
          present ? h("span", { class: "kb-icon", html: icons.check }) : h("span", { class: "kb-icon", html: icons.alert }),
          s.heading,
        ),
      );
    }
    section.append(chips);
    if (warnings.length) {
      section.append(
        h("p", { class: "kb-muted" }, "The generator flagged these gaps in the source voice asset:"),
        h("ul", { class: "kb-issue-list" }, warnings.map((w) => h("li", { class: "kb-issue kb-issue--warning" }, w.message))),
      );
    }
    return section;
  }

  // ---- body editor + preview -------------------------------------------
  function bodyBlock() {
    const rec = liveRecord();
    const textarea = h("textarea", { class: "kb-input kb-doc-textarea", id: "kbRunbookBodyInput", rows: 22, spellcheck: "false" });
    textarea.value = rec.body || "";
    textarea.disabled = readonly;
    const previewEl = h("div", { class: "kb-markdown kb-prose kb-doc-preview" });

    const updatePreview = () => {
      previewEl.innerHTML = renderMarkdown(textarea.value || "").html || '<p class="kb-muted">Nothing to preview yet.</p>';
    };
    textarea.addEventListener("input", updatePreview);
    updatePreview();

    const canRegenerate = !readonly && rec.runbookType === "voip-deployment" && !!rec.service;
    const toolbar = h(
      "div",
      { class: "kb-doc-editor-toolbar" },
      h("span", { class: "kb-field-label" }, "Runbook body (markdown)"),
      h(
        "div",
        { class: "kb-doc-editor-toolbar-actions" },
        canRegenerate
          ? h(
              "button",
              {
                class: "kb-btn kb-btn-ghost kb-btn-sm",
                type: "button",
                id: "kbRunbookRegenBtn",
                title: "Rebuild this runbook's body from the linked Voice/PBX asset",
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: "Regenerate from the voice asset?",
                    message: "The body below is replaced with a fresh build generated from the linked Voice/PBX asset and its records. The current body is kept as a revision, so this can be undone.",
                    confirmLabel: "Regenerate",
                  });
                  if (!ok) return;
                  try {
                    const voice = findRecord(set, rec.service);
                    const site = rec.site ? findRecord(set, rec.site) : null;
                    if (!voice || voice.type !== "flexibleAssets") {
                      m.showError("The linked service is no longer a Voice/PBX asset.");
                      return;
                    }
                    const gen = generateVoipRunbook({ voice, set, site, preparedBy: whoami(ctx), title: rec.name });
                    const patch = { body: gen.body, summary: gen.summary, runbookType: "voip-deployment" };
                    await ctx.docs.saveRunbook(setId, { type: "runbooks", id: rec.id }, patch, { updatedBy: whoami(ctx) });
                    const fresh = await ctx.docs.get(setId, { force: true });
                    const saved = ((fresh && fresh.records.runbooks) || []).find((r) => r.id === rec.id);
                    if (saved) {
                      saved.origin = { ...(saved.origin || {}), source: "voice-asset", warnings: gen.warnings, generatedAt: gen.generatedAt };
                      await ctx.docs.saveRunbook(setId, { type: "runbooks", id: rec.id }, { origin: saved.origin }, { updatedBy: whoami(ctx) });
                    }
                    ctx.toast("Regenerated — " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged", "success");
                    await rerender();
                    reload && reload();
                  } catch (e) {
                    m.showError(String((e && e.message) || e));
                  }
                },
              },
              h("span", { class: "kb-icon", html: icons.history }),
              "Regenerate from voice asset",
            )
          : null,
        readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => { textarea.value = ""; updatePreview(); } }, "Clear"),
      ),
    );

    const previewPane = h("div", { class: "kb-doc-preview-pane" }, h("span", { class: "kb-field-label" }, "Preview"), previewEl);
    const section = h("section", { class: "kb-card kb-profile-section kb-doc-body-section" }, toolbar, h("div", { class: "kb-doc-editor-grid" }, textarea, previewPane));
    section.textarea = textarea;
    return section;
  }

  // ---- links ------------------------------------------------------------
  function linksBlock() {
    const rec = liveRecord();
    const linked = (set.records.relationships || []).filter((r) => r.from.id === rec.id && r.from.type === "runbooks");
    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h(
        "div",
        { class: "kb-section-head" },
        h("span", { class: "kb-section-icon", html: icons.link }),
        h("h2", { class: "kb-section-name" }, "Linked records"),
        h("span", { class: "kb-count-pill" }, String(linked.length)),
        readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openLinkPicker(ctx, setId, rec, set, rerender) }, "+ Link"),
      ),
    );
    if (!linked.length) {
      section.append(h("p", { class: "kb-muted" }, "Not linked to anything yet. Link this runbook to the voice platform it deploys, and to the circuits, firewalls and people involved."));
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
          h("span", { class: "kb-rel-item-meta" }, other ? (RECORD_TYPE_META[other.type] ? RECORD_TYPE_META[other.type].singular : other.type) : "missing"),
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

  // ---- revision history -------------------------------------------------
  function historyBlock() {
    const rec = liveRecord();
    const versions = runbookVersionList(rec).slice().reverse();
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
            h("span", { class: "kb-doc-revision-type" }, runbookTypeLabel(v.runbookType)),
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
                      message: "Its content is written back as a NEW revision (v" + (runbookRevision(rec) + 1) + "). The current version stays in the history.",
                      confirmLabel: "Restore",
                    });
                    if (!ok) return;
                    try {
                      await ctx.docs.restoreRunbookRevision(setId, { type: "runbooks", id: rec.id }, v.revision, { updatedBy: whoami(ctx) });
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

  let form;

  function editorBlocks() {
    const f = fieldsBlock();
    const b = bodyBlock();
    form = { ...f.inputs, textarea: b.textarea };
    return [headerBlock(), f, b, coverageBlock(), linksBlock(), historyBlock()].filter(Boolean);
  }

  // ---- actions ----------------------------------------------------------
  if (readonly) {
    m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
  } else {
    m.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbRunbookSaveBtn" }, "Save runbook"),
    );
    m.actions.querySelector("#kbRunbookSaveBtn").addEventListener("click", async () => {
      m.clearError();
      const rec = liveRecord();
      const name = form.nameInput.value.trim();
      if (!name) {
        m.showError("Give the runbook a name.");
        return;
      }
      // Collaborative guard (task 55): if another session saved a DIFFERENT
      // version after we opened this editor, stop and make the conflict
      // explicit rather than silently overwriting their work.
      const mineStamp = recordStamp(formRecord());
      let freshNow = null;
      try {
        freshNow = await ctx.docs.get(setId, { force: true });
      } catch {}
      const freshRec = ((freshNow && freshNow.records.runbooks) || []).find((r) => r.id === record.id);
      const liveStamp = freshRec ? recordStamp(freshRec) : baseStamp;
      if (liveStamp !== baseStamp && liveStamp !== mineStamp) {
        if (freshRec) {
          set = freshNow;
          showConflict(freshRec);
        }
        m.showError("This runbook changed on another session — resolve the conflict, then save.");
        return;
      }
      const patch = {
        name,
        runbookType: form.typeSel.value,
        status: form.statusSel.value,
        version: form.versionInput.value.trim(),
        summary: form.summaryInput.value.trim(),
        body: form.textarea.value,
        tags: normalizeRunbookTags(form.tagsInput.value),
        reviewIntervalDays: form.reviewInput.value === "" ? null : Number(form.reviewInput.value),
      };
      try {
        await ctx.docs.saveRunbook(setId, { type: "runbooks", id: rec.id }, patch, { updatedBy: whoami(ctx) });
        m.close();
        ctx.toast("Saved “" + name + "” — revision " + (runbookRevision(rec) + 1), "success");
        reload && reload();
      } catch (e) {
        m.showError(String((e && e.message) || e));
      }
    });
  }

  await rerender();
  startCollab();
  return m;
}

// A small picker: choose what kind of record to link, then which record.
function openLinkPicker(ctx, setId, record, set, done) {
  const groups = LINK_KINDS.map((k) => {
    const candidates = [];
    for (const t of k.types) {
      for (const r of set.records[t] || []) {
        if (t === "runbooks" && r.id === record.id) continue;
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
    description: "Link this runbook to the records it concerns. The link is typed, so the relationship is reusable everywhere.",
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
            await ctx.docs.linkRecords(setId, { from: { type: "runbooks", id: record.id }, to: { type: other.type, id: other.id }, kind: g.kind, createdBy: whoami(ctx) });
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
