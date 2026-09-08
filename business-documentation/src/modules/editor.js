// src/modules/editor.js — article authoring (hidden module, routes #/editor/<id>
// and #/editor/new). Markdown editing with a formatting toolbar + live preview,
// generated TOC, article cross-linking with search-as-you-type, reusable
// snippet insertion, image/file attachments, structured SOP blocks, process
// links, version history (view + restore as new draft), review log, feedback
// summary, AI drafting/polish assist, a pre-submission consistency check, and
// the full review-workflow action set.

import { h, esc } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, errorState } from "../framework/states.js";
import { renderMarkdown, titleLookup } from "../framework/markdown.js";
import {
  viewPanel,
  fmtDate,
  statusBadge,
  categoryOptions,
  flattenTree,
  confirmDialog,
  promptPanel,
} from "./shared.js";

const DOC_TYPES = ["sop", "policy", "how-to", "reference", "faq"];
const DOC_TYPE_LABELS = { sop: "SOP", policy: "Policy", "how-to": "How-to", reference: "Reference", faq: "FAQ" };
const PROCESS_TOOLS = ["project-master", "crm", "psa", "support-flow"];

export default {
  id: "editor",
  label: "Editor",
  desc: "Author and edit articles",
  icon: icons.edit,
  hidden: true,
  render(ctx) {
    ctx.container.append(
      errorState({
        title: "No article open",
        description: "Choose an article to edit, or start a new one.",
        onRetry: () => ctx.go("#/editor/new"),
      }),
    );
  },
  async renderDetail(ctx, id) {
    const isNew = id === "new";
    let existing = null;
    if (!isNew) {
      ctx.container.append(loadingState({ label: "Loading editor…" }));
      existing = await ctx.content.getArticle(id).catch(() => null);
      if (!existing) {
        ctx.container.replaceChildren(
          errorState({ title: "Article not found", description: "It may have been deleted.", onRetry: () => ctx.go("#/browse") }),
        );
        return;
      }
    }

    const tree = await ctx.content.getCategoryTree().catch(() => []);
    const allArticles = await ctx.content.listArticles().catch(() => []);
    const snippets = await ctx.content.listSnippets().catch(() => []);
    const identity = (await ctx.content.getIdentity().catch(() => "")) || "";
    const by = () => identity || "system";
    // Phase 9: role gate — offline/single-user mode always allows; online the
    // server decides based on the signed-in user's role for the category.
    const require = async (action, msg) => {
      if (!ctx.hub) return true;
      return ctx.hub.require(action, catSel.value || (rec && rec.categoryId) || "", { msg });
    };

    // ---- form state -------------------------------------------------------
    let rec = existing ? ctx.content.normRecord(existing) : null;
    let previewOn = false;
    let bodyDirty = false;
    const dismissed = new Set();

    // ---- elements ---------------------------------------------------------
    const titleInput = h("input", { class: "kb-input kb-input-lg", id: "edTitle", placeholder: "Article title", value: rec ? rec.title : "" });
    const docTypeSel = h("select", { class: "kb-input", id: "edDocType" }, DOC_TYPES.map((d) => h("option", { value: d, selected: rec && rec.docType === d ? true : null }, DOC_TYPE_LABELS[d])));
    const catSel = h("select", { class: "kb-input", id: "edCategory" }, categoryOptions(tree, rec ? rec.categoryId : ""));
    const ownerInput = h("input", { class: "kb-input", id: "edOwner", placeholder: "Owner name (optional)", value: rec ? rec.owner : "" });
    const tagsInput = h("input", { class: "kb-input", id: "edTags", placeholder: "comma, separated, tags", value: rec ? (rec.tags || []).join(", ") : "" });
    const intervalInput = h("input", { class: "kb-input", id: "edInterval", type: "number", min: "1", placeholder: "365", value: rec && rec.reviewIntervalDays ? rec.reviewIntervalDays : "" });
    const summaryInput = h("textarea", { class: "kb-input", id: "edSummary", rows: 3, placeholder: "One-paragraph summary — shown in lists, search results and bundles." });
    summaryInput.value = rec ? rec.summary || "" : "";
    const bodyInput = h("textarea", { class: "kb-input kb-editor-body", id: "edBody", rows: 16, spellcheck: "true" });
    bodyInput.value = rec ? rec.body || "" : "";

    const previewBox = h("div", { class: "kb-prose kb-editor-preview", id: "edPreview", hidden: true });
    const previewHint = h("div", { class: "kb-editor-hint", id: "edHint" }, "Preview will appear here as you type.");

    const renderPreview = () => {
      previewBox.innerHTML = renderMarkdown(bodyInput.value, titleLookup(allArticles)).html;
      previewHint.hidden = !previewBox.innerHTML.trim() ? false : true;
    };
    bodyInput.addEventListener("input", () => {
      bodyDirty = true;
      if (previewOn) renderPreview();
    });

    const historyBox = h("div", { class: "kb-editor-tab-body" });
    const reviewLogBox = h("div", { class: "kb-editor-tab-body" });
    const feedbackBox = h("div", { class: "kb-editor-tab-body" });
    const aiBox = h("div", { class: "kb-editor-tab-body" });

    // ---- actions ----------------------------------------------------------
    const statusLine = h("div", { class: "kb-editor-statusline" });
    const statusText = () => (rec ? statusBadge(rec.status) : statusBadge("draft"));

    // collect form → record
    const collect = () => {
      const base = rec ? rec : {};
      return {
        ...base,
        id: rec ? rec.id : undefined,
        title: titleInput.value.trim(),
        docType: docTypeSel.value || "sop",
        categoryId: catSel.value || "",
        owner: ownerInput.value.trim(),
        tags: tagsInput.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
        reviewIntervalDays: intervalInput.value ? Number(intervalInput.value) : null,
        summary: summaryInput.value.trim(),
        body: bodyInput.value,
        blocks: blocksState.value,
        processRefs: processRefsState.value,
      };
    };

    const save = async ({ submit = false, summary = null } = {}) => {
      const record = collect();
      if (!record.title) {
        ctx.toast("Give the article a title before saving", "warning");
        titleInput.focus();
        return null;
      }
      if (!(await require(submit ? "submit" : "edit", submit ? "Your role doesn't allow submitting for review" : "Your role doesn't allow editing this category"))) return null;
      try {
        const saved = await ctx.content.saveArticle(record, { by: by(), summary });
        ctx.toast(submit ? "Saved & submitted for review" : "Saved", "success");
        ctx.go("#/editor/" + saved.id);
        return saved;
      } catch (e) {
        ctx.toast(String((e && e.message) || e), "error", 5600);
        return null;
      }
    };

    const actionBar = h("div", { class: "kb-editor-actions" });
    const act = (label, cls, cb) => h("button", { class: "kb-btn " + cls + " kb-btn-sm", type: "button", onClick: cb }, label);

    actionBar.append(
      rec
        ? act("View article", "kb-btn-ghost", () => ctx.go("#/article/" + rec.id))
        : null,
      act("Save draft", "kb-btn-primary", () => save({})),
      act(rec && rec.status === "in_review" ? "Save & approve" : "Save & submit", "kb-btn-ghost", async () => {
        const saved = await save({ submit: true });
        if (saved && saved.status === "in_review") {
          if (!(await require("approve", "Your role doesn't allow approving"))) return;
          try {
            await ctx.content.approveArticle(saved.id, by(), "Approved from editor");
            ctx.toast("Approved & published", "success");
            ctx.go("#/article/" + saved.id);
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        }
      }),
    );
    if (rec) {
      if (rec.status === "draft")
        actionBar.append(act("Submit for review", "kb-btn-ghost", async () => {
          if (!(await require("submit", "Your role doesn't allow submitting for review"))) return;
          try {
            await ctx.content.submitForReview(rec.id, by());
            ctx.toast("Submitted for review", "success");
            ctx.go("#/article/" + rec.id);
          } catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
        }));
      else if (rec.status === "in_review")
        actionBar.append(
          act("Approve", "kb-btn-primary", async () => {
            if (!(await require("approve", "Your role doesn't allow approving"))) return;
            try {
              await ctx.content.approveArticle(rec.id, by(), "");
              ctx.toast("Approved & published", "success");
              ctx.go("#/article/" + rec.id);
            } catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
          }),
          act("Return…", "kb-btn-danger", async () => {
            if (!(await require("return", "Your role doesn't allow returning articles"))) return;
            const comment = await promptPanel({ title: "Return with comment", placeholder: "What needs to change?", confirmLabel: "Return" });
            if (comment === null) return;
            try {
              await ctx.content.returnArticle(rec.id, by(), comment);
              ctx.toast("Returned to draft", "success");
              ctx.go("#/editor/" + rec.id);
            } catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
          }),
        );
      else if (rec.status === "published")
        actionBar.append(act("Archive", "kb-btn-danger", async () => {
          if (!(await require("archive", "Your role doesn't allow archiving"))) return;
          if (!(await confirmDialog({ title: "Archive?", message: "Move this article to the read-only archive.", confirmLabel: "Archive", danger: true }))) return;
          try { await ctx.content.archiveArticle(rec.id, by()); ctx.toast("Archived", "success"); ctx.go("#/article/" + rec.id); }
          catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
        }));
      else if (rec.status === "archived")
        actionBar.append(act("Restore", "kb-btn-ghost", async () => {
          if (!(await require("restore", "Your role doesn't allow restoring"))) return;
          try { await ctx.content.restoreArticle(rec.id, by()); ctx.toast("Restored as draft", "success"); ctx.go("#/editor/" + rec.id); }
          catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
        }));
    }

    // ---- SOP blocks editor (task 9) ----------------------------------------
    const blocksState = { value: rec && Array.isArray(rec.blocks) ? JSON.parse(JSON.stringify(rec.blocks)) : [] };
    const processRefsState = { value: rec && Array.isArray(rec.processRefs) ? JSON.parse(JSON.stringify(rec.processRefs)) : [] };

    const blocksBox = h("div", { class: "kb-blocks-editor" });
    const renderBlocks = () => {
      blocksBox.replaceChildren();
      blocksBox.append(h("div", { class: "kb-section-title" }, h("h3", null, "SOP steps"), h("span", { class: "kb-section-note" }, "Structured blocks — step, owner/role, expected outcome, safety notes, checklist")));
      const list = h("div", { class: "kb-blocks-list" });
      blocksState.value.forEach((b, i) => list.append(blockRow(i)));
      const addBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => { blocksState.value.push({ step: "", ownerRole: "", expectedOutcome: "", safety: "", notes: "", checklist: [] }); renderBlocks(); } }, "+ Add step");
      blocksBox.append(list, addBtn);
    };
    const blockRow = (i) => {
      const b = blocksState.value[i];
      const row = h("div", { class: "kb-block-row" });
      row.append(h("span", { class: "kb-sop-step-num" }, String(i + 1)));
      const body = h("div", { class: "kb-block-fields" });
      const mkField = (label, key, placeholder, rows = 1) => {
        const wrap = h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, label));
        const el = h("textarea", { class: "kb-input", rows, placeholder });
        el.value = b[key] || "";
        el.addEventListener("input", () => (b[key] = el.value));
        wrap.append(el);
        return wrap;
      };
      const stepField = mkField("Step", "step", "What must happen in this step?", 2);
      const ownerField = mkField("Owner / role", "ownerRole", "Who performs this step?", 1);
      const outcomeField = mkField("Expected outcome", "expectedOutcome", "How do you know the step succeeded?", 1);
      const safetyField = mkField("Safety / compliance", "safety", "Safety or compliance notes (optional)", 1);
      const notesField = mkField("Notes", "notes", "Notes (optional)", 1);
      const checkWrap = h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Checklist"));
      const checkList = h("div", { class: "kb-checklist-editor" });
      const renderChecks = () => {
        checkList.replaceChildren();
        (b.checklist || []).forEach((c, j) => {
          const inp = h("input", { class: "kb-input", value: c, placeholder: "Checklist item" });
          inp.addEventListener("input", () => (b.checklist[j] = inp.value));
          const rm = h("button", { class: "kb-icon-btn kb-btn-sm", type: "button", title: "Remove item" }, "×");
          rm.addEventListener("click", () => { b.checklist.splice(j, 1); renderChecks(); });
          checkList.append(h("div", { class: "kb-checklist-item" }, inp, rm));
        });
        checkList.append(h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => { b.checklist = b.checklist || []; b.checklist.push(""); renderChecks(); } }, "+ Item"));
      };
      renderChecks();
      checkWrap.append(checkList);
      body.append(stepField, ownerField, outcomeField, safetyField, notesField, checkWrap);
      const del = h("button", { class: "kb-btn kb-btn-danger kb-btn-sm", type: "button", title: "Delete step" }, "Delete");
      del.addEventListener("click", () => { blocksState.value.splice(i, 1); renderBlocks(); });
      const up = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", title: "Move up" }, "↑");
      up.addEventListener("click", () => { if (i > 0) { [blocksState.value[i - 1], blocksState.value[i]] = [blocksState.value[i], blocksState.value[i - 1]]; renderBlocks(); } });
      const down = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", title: "Move down" }, "↓");
      down.addEventListener("click", () => { if (i < blocksState.value.length - 1) { [blocksState.value[i + 1], blocksState.value[i]] = [blocksState.value[i], blocksState.value[i + 1]]; renderBlocks(); } });
      row.append(body, h("div", { class: "kb-block-actions" }, up, down, del));
      return row;
    };
    renderBlocks();

    // ---- process refs (task 28) --------------------------------------------
    const procrefBox = h("div", { class: "kb-procref-editor" });
    const renderProcrefs = () => {
      procrefBox.replaceChildren();
      procrefBox.append(h("div", { class: "kb-section-title" }, h("h3", null, "Related business objects"), h("span", { class: "kb-section-note" }, "Link this doc to a project-master project, CRM deal, PSA project or support flow.")));
      const list = h("div", { class: "kb-blocks-list" });
      processRefsState.value.forEach((p, i) => {
        const row = h("div", { class: "kb-block-row kb-procref-row" });
        const tool = h("select", { class: "kb-input" }, PROCESS_TOOLS.map((t) => h("option", { value: t, selected: p.tool === t ? true : null }, t)));
        const labelIn = h("input", { class: "kb-input", placeholder: "Label, e.g. Project Phoenix", value: p.label || "" });
        const urlIn = h("input", { class: "kb-input", placeholder: "URL (optional)", value: p.url || "" });
        tool.addEventListener("change", () => (p.tool = tool.value));
        labelIn.addEventListener("input", () => (p.label = labelIn.value));
        urlIn.addEventListener("input", () => (p.url = urlIn.value));
        const del = h("button", { class: "kb-btn kb-btn-danger kb-btn-sm", type: "button" }, "Remove");
        del.addEventListener("click", () => { processRefsState.value.splice(i, 1); renderProcrefs(); });
        row.append(tool, labelIn, urlIn, del);
        list.append(row);
      });
      procrefBox.append(list, h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => { processRefsState.value.push({ tool: "project-master", label: "", url: "" }); renderProcrefs(); } }, "+ Add process link"));
    };
    renderProcrefs();

    // ---- attachments (task 10) ----------------------------------------------
    const attBox = h("div", { class: "kb-att-editor" });
    let attachments = rec && Array.isArray(rec.attachments) ? [...rec.attachments] : [];
    const renderAtts = () => {
      attBox.replaceChildren();
      attBox.append(h("div", { class: "kb-section-title" }, h("h3", null, "Attachments"), h("span", { class: "kb-section-note" }, "Images and files stored under this article.")));
      const list = h("ul", { class: "kb-attachment-list" });
      attachments.forEach((at, i) => {
        const rm = h("button", { class: "kb-icon-btn kb-btn-sm", type: "button", title: "Remove" }, "×");
        rm.addEventListener("click", () => { attachments.splice(i, 1); renderAtts(); });
        list.append(h("li", { class: "kb-att-row" },
          h("a", { class: "kb-attachment", href: at.url, target: "_blank", rel: "noopener" }, at.name || "attachment"),
          h("span", { class: "kb-att-meta" }, at.type || ""),
          rm,
        ));
      });
      attBox.append(list);
      const addBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbAttAdd" }, "+ Attach file or image");
      attBox.append(addBtn);
      const fileInput = h("input", { type: "file", hidden: true, id: "kbAttFile" });
      attBox.append(fileInput);
      addBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        addBtn.disabled = true;
        addBtn.textContent = "Uploading…";
        try {
          const up = window.root && window.root.uploadPlugin;
          if (!up) { ctx.toast("Upload unavailable until the generator is saved", "warning", 5200); return; }
          const { url, error } = await up(file, { expires: Date.now() + 1000 * 60 * 60 * 24 * 365 });
          if (error) { ctx.toast("Upload failed: " + error, "error", 5200); return; }
          attachments.push({ name: file.name, url, type: file.type, size: file.size, at: Date.now() });
          if (file.type && file.type.startsWith("image/")) insertIntoBody(`\n![${file.name}](${url})\n`);
          renderAtts();
        } catch (e) {
          ctx.toast(String((e && e.message) || e), "error", 5200);
        } finally {
          addBtn.disabled = false;
          addBtn.textContent = "+ Attach file or image";
          fileInput.value = "";
        }
      });
    };
    renderAtts();

    // ---- toolbar --------------------------------------------------------------
    const insertIntoBody = (text) => {
      const s = bodyInput.selectionStart, e = bodyInput.selectionEnd;
      bodyInput.value = bodyInput.value.slice(0, s) + text + bodyInput.value.slice(e);
      bodyInput.focus();
      bodyInput.selectionStart = bodyInput.selectionEnd = s + text.length;
      bodyInput.dispatchEvent(new Event("input"));
    };
    const wrapSel = (before, after, placeholder) => {
      const s = bodyInput.selectionStart, e = bodyInput.selectionEnd;
      const sel = bodyInput.value.slice(s, e) || placeholder;
      insertIntoBody(before + sel + after);
      bodyInput.focus();
      bodyInput.selectionStart = s + before.length;
      bodyInput.selectionEnd = s + before.length + sel.length;
    };
    const toolbarBtn = (label, title, cb) => h("button", { class: "kb-tb-btn", type: "button", title, onClick: cb }, label);
    const toolbar = h("div", { class: "kb-editor-toolbar" });
    toolbar.append(
      toolbarBtn("B", "Bold", () => wrapSel("**", "**", "bold text")),
      toolbarBtn("I", "Italic", () => wrapSel("_", "_", "italic text")),
      toolbarBtn("H2", "Heading 2", () => wrapSel("## ", "", "Heading")),
      toolbarBtn("H3", "Heading 3", () => wrapSel("### ", "", "Heading")),
      toolbarBtn("•", "Bullet list", () => insertIntoBody("\n- item\n")),
      toolbarBtn("1.", "Numbered list", () => insertIntoBody("\n1. item\n")),
      toolbarBtn("☑", "Checklist", () => insertIntoBody("\n- [ ] task\n")),
      toolbarBtn("`", "Inline code", () => wrapSel("`", "`", "code")),
      toolbarBtn("Code block", "Fenced code block", () => insertIntoBody("\n```\ncode here\n```\n")),
      toolbarBtn("Link", "External link", () => insertIntoBody("[link text](https://…)")),
      toolbarBtn("Article", "Link to another article", () => openArticlePicker()),
      toolbarBtn("Snippet", "Insert a saved snippet", () => openSnippetPicker()),
      toolbarBtn("Image", "Embed an image by URL", async () => {
        const url = await promptPanel({ title: "Embed image by URL", placeholder: "https://…", confirmLabel: "Embed" });
        if (url) insertIntoBody(`\n![image](${url})\n`);
      }),
    );

    function openArticlePicker() {
      const overlay = h("div", { class: "kb-modal-overlay" });
      const search = h("input", { class: "kb-input", placeholder: "Search articles…", autocomplete: "off" });
      const results = h("div", { class: "kb-picker-results" });
      const render = () => {
        const q = search.value.trim().toLowerCase();
        const matches = allArticles
          .filter((a) => !q || (a.title || "").toLowerCase().includes(q))
          .slice(0, 12);
        results.replaceChildren(...matches.map((a) => {
          const row = h("button", { class: "kb-picker-row", type: "button" }, h("span", null, a.title), h("span", { class: "kb-picker-meta" }, (a.status || "") + " · " + a.id));
          row.addEventListener("click", () => {
            insertIntoBody(`[[${a.title}|${a.id}]]`);
            overlay.remove();
          });
          return row;
        }));
        if (!matches.length) results.append(h("p", { class: "kb-picker-empty" }, "No matching articles."));
      };
      search.addEventListener("input", render);
      render();
      const box = h("div", { class: "kb-modal kb-picker" }, h("h3", { class: "kb-modal-title" }, "Link to an article"), search, results,
        h("div", { class: "kb-modal-actions" }, h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Cancel")));
      box.querySelector("button").addEventListener("click", () => overlay.remove());
      overlay.append(box);
      document.body.append(overlay);
      search.focus();
    }

    function openSnippetPicker() {
      const overlay = h("div", { class: "kb-modal-overlay" });
      const results = h("div", { class: "kb-picker-results" });
      results.append(...snippets.map((sn) => {
        const row = h("button", { class: "kb-picker-row", type: "button" }, h("span", null, sn.title || sn.id), h("span", { class: "kb-picker-meta" }, (sn.text || "").slice(0, 60)));
        row.addEventListener("click", () => { insertIntoBody("\n" + (sn.text || "") + "\n"); overlay.remove(); });
        return row;
      }));
      if (!snippets.length) results.append(h("p", { class: "kb-picker-empty" }, "No snippets yet — add them in Admin → Snippets."));
      const box = h("div", { class: "kb-modal kb-picker" }, h("h3", { class: "kb-modal-title" }, "Insert snippet"), results,
        h("div", { class: "kb-modal-actions" }, h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Cancel")));
      box.querySelector("button").addEventListener("click", () => overlay.remove());
      overlay.append(box);
      document.body.append(overlay);
    }

    const previewBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "edPreviewBtn" }, "Preview");
    const tocBtn = h("span", { class: "kb-toc-chips", id: "edToc" });
    previewBtn.addEventListener("click", () => {
      previewOn = !previewOn;
      previewBtn.textContent = previewOn ? "Edit" : "Preview";
      bodyInput.hidden = previewOn;
      previewBox.hidden = !previewOn;
      previewHint.hidden = true;
      if (previewOn) renderPreview();
    });

    // ---- consistency check (task 25) ----------------------------------------
    const checkBox = h("div", { class: "kb-consistency", id: "kbConsistency" });
    const runCheck = async () => {
      checkBox.replaceChildren();
      checkBox.append(loadingState({ label: "Checking…" }));
      const res = await ctx.content.consistencyCheck(collect()).catch((e) => ({ ok: false, issues: [{ level: "error", message: String((e && e.message) || e) }] }));
      checkBox.replaceChildren();
      checkBox.append(h("div", { class: "kb-check-head" },
        h("strong", null, res.ok ? "✓ No blocking issues" : "✗ " + res.issues.filter((i) => i.level === "error").length + " issue(s) to resolve before submit"),
      ));
      const list = h("ul", { class: "kb-check-list-full" });
      for (const i of res.issues) {
        if (dismissed.has(i.code)) continue;
        const li = h("li", { class: "kb-check-item kb-check-" + i.level });
        const txt = h("span", null, (i.level === "error" ? "Error: " : i.level === "warning" ? "Warning: " : "Note: ") + i.message);
        const dis = h("button", { class: "kb-check-dismiss", type: "button" }, "Dismiss");
        dis.addEventListener("click", () => { if (i.code) dismissed.add(i.code); runCheck(); });
        li.append(txt, i.code ? dis : null);
        list.append(li);
      }
      if (!res.issues.length) list.append(h("li", { class: "kb-check-item" }, "All good."));
      checkBox.append(list);
    };

    // ---- AI assist (tasks 23, 24) --------------------------------------------
    const aiTopic = h("input", { class: "kb-input", placeholder: "Topic or outline, e.g. “Onboarding a new hire in Finance”" });
    const aiDraftBtn = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", id: "edAiDraft" }, "Generate draft");
    const aiPolishBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "edAiPolish" }, "Polish summary & tags");
    const aiChangeBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "edAiChange" }, "Write “what changed”");
    const aiBusy = h("span", { class: "kb-ai-busy", hidden: true }, h("span", { class: "spinner spinner-sm" }), " Generating…");
    aiBox.append(
      h("div", { class: "kb-ai-row" }, aiTopic, aiDraftBtn),
      h("div", { class: "kb-ai-row" }, aiPolishBtn, aiChangeBtn, aiBusy),
    );

    const gen = window.root && window.root.generateText;
    const docTypeBlurb = () => {
      const d = docTypeSel.value || "sop";
      const outlines = {
        sop: "Standard Operating Procedure — markdown with # Purpose, ## Scope, ## Prerequisites, ## Procedure (numbered steps), ## Roles & responsibilities, ## Safety & compliance notes, ## References.",
        policy: "Policy document — # Purpose, ## Policy statements (numbered statements), ## Compliance & enforcement, ## Review.",
        "how-to": "How-to guide — # Overview, ## What you need, ## Steps (numbered), ## Troubleshooting.",
        reference: "Reference — # Overview, ## Definitions (table), ## Details.",
        faq: "FAQ — # Questions with ## question headings and concise answers that link to related articles.",
      };
      return outlines[d] || "";
    };
    const aiRun = async (task) => {
      if (!gen) { ctx.toast("AI is unavailable until the generator is saved", "warning", 5200); return; }
      aiBusy.hidden = false;
      try {
        if (task === "draft") {
          const topic = aiTopic.value.trim() || titleInput.value.trim();
          if (!topic) { ctx.toast("Enter a topic first", "warning"); aiBusy.hidden = true; return; }
          const prompt = `You are a technical writer for a company knowledge base. Draft a first version of a ${DOC_TYPE_LABELS[docTypeSel.value] || "document"} article.\nStructure (markdown): ${docTypeBlurb()}\nFor the procedure section, break it into clear numbered steps, each with an owner/role and expected outcome.\nWrite in practical, specific business language. Do not invent regulations, names, or external citations. Use markdown headings and lists.\nTopic: ${topic}`;
          bodyInput.value = "";
          await gen({ instruction: prompt, onChunk: (d) => { bodyInput.value += d.textChunk; } });
          bodyDirty = true;
          if (previewOn) renderPreview();
          ctx.toast("Draft generated — review and refine before submitting", "success");
        } else if (task === "polish") {
          const body = bodyInput.value.trim();
          if (!body) { ctx.toast("Write some body text first", "warning"); aiBusy.hidden = true; return; }
          const existingSummary = summaryInput.value.trim() ? `Existing summary (improve it): ${summaryInput.value.trim()}\n` : "";
          const prompt = `Below is the body of a knowledge-base article. Produce a response in this exact format:\nSUMMARY: <one or two sentences, plain text>\nTAGS: <3-6 comma-separated lowercase tags>\n\nBody:\n${body.slice(0, 12000)}`;
          const result = await gen({ instruction: prompt });
          const m = result.text.match(/SUMMARY:\s*([\s\S]*?)(?:\nTAGS:\s*([\s\S]*))?$/);
          if (m && m[1]) summaryInput.value = m[1].trim();
          if (m && m[2]) tagsInput.value = m[2].trim();
          ctx.toast("Summary & tags updated — tweak before saving", "success");
        } else if (task === "change") {
          const prev = rec && rec.versions && rec.versions.length ? rec.versions[rec.versions.length - 1].data.body : "";
          if (!prev) { ctx.toast("No previous version to compare", "warning"); aiBusy.hidden = true; return; }
          const prompt = `Compare these two versions of a knowledge-base article and write a short plain-language "what changed" note (1-3 sentences) a reviewer would find useful.\n--- PREVIOUS ---\n${prev.slice(0, 8000)}\n--- NEW ---\n${bodyInput.value.slice(0, 8000)}`;
          const result = await gen({ instruction: prompt });
          const note = result.text.trim();
          await ctx.content.saveArticle(collect(), { by: by(), summary: note });
          ctx.toast("Saved with an AI-written change note", "success");
          ctx.go("#/editor/" + (rec ? rec.id : ""));
        }
      } catch (e) {
        ctx.toast("AI failed: " + String((e && e.message) || e), "error", 5200);
      } finally {
        aiBusy.hidden = true;
      }
    };
    aiDraftBtn.addEventListener("click", () => aiRun("draft"));
    aiPolishBtn.addEventListener("click", () => aiRun("polish"));
    aiChangeBtn.addEventListener("click", () => aiRun("change"));

    // ---- tabs ------------------------------------------------------------------
    const tabs = h("div", { class: "kb-tabs" });
    const tabDefs = [
      ["versions", "Versions", historyBox],
      ["reviewlog", "Review log", reviewLogBox],
      ["feedback", "Feedback", feedbackBox],
      ["ai", "AI assist", aiBox],
    ];
    const tabBtns = {};
    const showTab = (key) => {
      for (const [k, , box] of tabDefs) {
        box.hidden = k !== key;
        tabBtns[k].classList.toggle("active", k === key);
      }
    };
    for (const [k, label, box] of tabDefs) {
      const b = h("button", { class: "kb-tab", type: "button", onClick: () => showTab(k) }, label);
      tabBtns[k] = b;
      tabs.append(b);
    }

    const renderHistory = async () => {
      if (!rec) { historyBox.append(h("p", { class: "kb-muted" }, "Version history appears after the first save.")); return; }
      historyBox.replaceChildren();
      const versions = (rec.versions || []).slice().reverse();
      if (!versions.length) { historyBox.append(h("p", { class: "kb-muted" }, "No versions yet.")); return; }
      const list = h("div", { class: "kb-history-list" });
      for (const v of versions) {
        const item = h("div", { class: "kb-history-item" });
        item.append(h("span", { class: "kb-badge kb-badge-version" }, "v" + v.n));
        const body = h("div", { class: "kb-history-body" });
        body.append(h("p", { class: "kb-history-summary" }, v.summary || "—"), h("p", { class: "kb-history-meta" }, (v.by || "system") + " · " + fmtDate(v.at)));
        const act = h("div", { class: "kb-history-actions" });
        const viewBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "View");
        viewBtn.addEventListener("click", () => showVersion(v));
        const restoreBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Restore as new draft");
        restoreBtn.addEventListener("click", async () => {
          if (!(await confirmDialog({ title: "Restore version " + v.n + "?", message: "This creates a NEW draft from that version — current live content is never overwritten.", confirmLabel: "Restore" }))) return;
          try {
            await ctx.content.restoreVersion(rec.id, v.n, by());
            ctx.toast("Restored as a new draft", "success");
            ctx.go("#/editor/" + rec.id);
          } catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
        });
        act.append(viewBtn, restoreBtn);
        item.append(body, act);
        list.append(item);
      }
      historyBox.append(list);
    };
    const showVersion = (v) => {
      const overlay = h("div", { class: "kb-modal-overlay" });
      const md = renderMarkdown(v.data.body || "", titleLookup(allArticles));
      overlay.append(h("div", { class: "kb-modal kb-version-modal" },
        h("h3", { class: "kb-modal-title" }, "Version " + v.n + " — " + (v.summary || "")),
        h("p", { class: "kb-modal-meta" }, (v.by || "system") + " · " + fmtDate(v.at)),
        h("div", { class: "kb-prose kb-version-preview" }, null),
        h("div", { class: "kb-modal-actions" }, h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Close")),
      ));
      overlay.querySelector(".kb-version-preview").innerHTML = md.html;
      overlay.querySelector("button").addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.append(overlay);
    };

    const renderReviewLog = async () => {
      reviewLogBox.replaceChildren();
      if (!rec) { reviewLogBox.append(h("p", { class: "kb-muted" }, "Review history appears once the article enters the workflow.")); return; }
      const entries = await ctx.content.reviewHistory(rec.id).catch(() => []);
      if (!entries.length) { reviewLogBox.append(h("p", { class: "kb-muted" }, "No review activity yet.")); return; }
      reviewLogBox.append(h("div", { class: "kb-history-list" }, entries.map((e) =>
        h("div", { class: "kb-history-item" },
          h("span", { class: "kb-badge kb-badge-" + (e.action || "draft") }, e.action || ""),
          h("div", { class: "kb-history-body" },
            h("p", { class: "kb-history-summary" }, (e.comment || (e.from && e.to ? e.from + " → " + e.to : e.action))),
            h("p", { class: "kb-history-meta" }, (e.actor || "system") + " · " + fmtDate(e.at)),
          ),
        ),
      )));
    };

    const renderFeedback = () => {
      feedbackBox.replaceChildren();
      if (!rec) { feedbackBox.append(h("p", { class: "kb-muted" }, "Reader feedback appears once the article is published.")); return; }
      const fb = (rec.feedback || []);
      if (!fb.length) { feedbackBox.append(h("p", { class: "kb-muted" }, "No feedback yet.")); return; }
      const good = fb.filter((f) => f.helpful).length;
      const bad = fb.filter((f) => !f.helpful).length;
      const commented = fb.filter((f) => f.comment);
      feedbackBox.append(h("p", { class: "kb-feedback-summary" }, good + " helpful · " + bad + " not helpful"));
      feedbackBox.append(h("div", { class: "kb-history-list" }, commented.map((f) =>
        h("div", { class: "kb-history-item" },
          h("span", { class: "kb-badge " + (f.helpful ? "kb-badge-published" : "kb-badge-draft") }, f.helpful ? "helpful" : "not helpful"),
          h("div", { class: "kb-history-body" },
            h("p", { class: "kb-history-summary" }, f.comment),
            h("p", { class: "kb-history-meta" }, (f.by || "reader") + " · " + fmtDate(f.at)),
          ),
        ),
      )));
    };

    renderHistory();
    renderReviewLog();
    renderFeedback();
    showTab("versions");

    // ---- live concurrent-edit banner (Phase 9, task 40) ---------------------
    // While editing an existing article, watch the hub for a newer remote
    // version and offer to load it. Unsubscribed automatically on navigation.
    const liveBanner = h("div", { class: "kb-live-banner", hidden: true });
    let liveVersion = rec ? Math.max(0, ...(rec.versions || []).map((v) => v.n)) : 0;
    const applyRecord = (nr) => {
      rec = nr;
      titleInput.value = nr.title || "";
      docTypeSel.value = nr.docType || "sop";
      catSel.value = nr.categoryId || "";
      ownerInput.value = nr.owner || "";
      tagsInput.value = (nr.tags || []).join(", ");
      intervalInput.value = nr.reviewIntervalDays || "";
      summaryInput.value = nr.summary || "";
      bodyInput.value = nr.body || "";
      blocksState.value = JSON.parse(JSON.stringify(Array.isArray(nr.blocks) ? nr.blocks : []));
      processRefsState.value = JSON.parse(JSON.stringify(Array.isArray(nr.processRefs) ? nr.processRefs : []));
      renderBlocks();
      renderProcrefs();
      renderPreview();
      updateToc();
    };
    if (rec && ctx.hub && !isNew) {
      const off = ctx.hub.watchArticle(rec.id, rec.categoryId, () => ctx.content.getArticle(rec.id), (evt) => {
        const v = evt.version || 0;
        if (v <= liveVersion) return;
        if (evt.by && evt.by === identity) return;
        liveVersion = v;
        liveBanner.hidden = false;
        liveBanner.replaceChildren(
          h("span", { class: "kb-live-banner-msg" }, `Updated by ${evt.by || "someone"} just now`),
          h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", onClick: async () => {
            const fresh = await ctx.content.getArticle(rec.id).catch(() => null);
            if (fresh) {
              applyRecord(ctx.content.normRecord(fresh));
              ctx.toast("Loaded the updated version", "success");
            }
            liveBanner.hidden = true;
          } }, "Load updated copy"),
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => (liveBanner.hidden = true) }, "Dismiss"),
        );
      });
      ctx.onUnmount(off);
    }

    // ---- assemble --------------------------------------------------------------
    const bodyEditor = h(
      "div",
      { class: "kb-editor-body-wrap" },
      h("div", { class: "kb-editor-pane" }, toolbar, bodyInput, previewBtn),
      previewBox,
      previewHint,
    );

    const panel = viewPanel({
      crumb: "Knowledge base / " + (isNew ? "New article" : "Edit"),
      title: isNew ? "New article" : (rec.title || "Untitled"),
      desc: isNew ? "Create a new article from a document-type template." : "Author and review this article.",
      body: h(
        "div",
        { class: "kb-editor" },
        h("div", { class: "kb-editor-statusline" }, rec ? statusBadge(rec.status) : statusBadge("draft"), actionBar),
        liveBanner,
        rec && rec.status === "in_review" && rec.publishedVersion
          ? h("div", { class: "kb-banner kb-banner-warn" }, h("strong", null, "A revision is pending review. "), "Readers still see the last approved version until a reviewer approves this draft.")
          : null,
        h("div", { class: "kb-editor-grid" },
          h("div", { class: "kb-editor-form" },
            h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Title"), titleInput),
            h("div", { class: "kb-field-row" },
              h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Document type"), docTypeSel),
              h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Category"), catSel),
            ),
            h("div", { class: "kb-field-row" },
              h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Owner"), ownerInput),
              h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Review interval (days)"), intervalInput),
            ),
            h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Tags (comma separated)"), tagsInput),
            h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Summary"), summaryInput),
          ),
          h("div", { class: "kb-editor-main" },
            h("div", { class: "kb-editor-labelrow" }, h("span", { class: "kb-field-label" }, "Body (markdown)"), tocBtn),
            bodyEditor,
            docTypeSel.value === "sop" ? blocksBox : null,
            procrefBox,
            attBox,
            h("div", { class: "kb-editor-subsection" },
              h("div", { class: "kb-section-title" }, h("h3", null, "Consistency check"), h("span", { class: "kb-section-note" }, "Before submitting — run this to catch likely inconsistencies.")),
              h("div", { class: "kb-consistency-actions" }, h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: runCheck }, "Run check")),
              checkBox,
            ),
            tabs,
            historyBox,
            reviewLogBox,
            feedbackBox,
            aiBox,
          ),
        ),
      ),
    });

    // keep SOP block editor in sync with docType selection
    docTypeSel.addEventListener("change", () => {
      const wrap = panel.querySelector(".kb-editor-main");
      const existing = wrap.querySelector(".kb-blocks-editor");
      if (docTypeSel.value === "sop") {
        if (!existing) {
          const insertBefore = wrap.querySelector(".kb-procref-editor");
          wrap.insertBefore(blocksBox, insertBefore);
        }
      } else if (existing) existing.remove();
    });

    const updateToc = () => {
      const toc = renderMarkdown(bodyInput.value).toc;
      tocBtn.replaceChildren(...toc.slice(0, 8).map((t) => h("span", { class: "kb-toc-chip kb-toc-" + t.level }, t.text)));
    };
    bodyInput.addEventListener("input", updateToc);
    updateToc();

    ctx.container.replaceChildren(panel);

    // new-article template seeding: load the doc-type template on first pick
    if (isNew) {
      const seedTemplate = async (dt) => {
        if (bodyDirty) return;
        const tpl = await ctx.content.getTemplate(dt).catch(() => null);
        if (tpl && !bodyDirty) {
          bodyInput.value = tpl.body || "";
          updateToc();
        }
      };
      seedTemplate(docTypeSel.value);
      docTypeSel.addEventListener("change", () => seedTemplate(docTypeSel.value));
    }
  },
};
