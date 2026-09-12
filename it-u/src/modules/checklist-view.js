// src/modules/checklist-view.js — the checklist editor (roadmap task 11).
//
// The Organizations station's record tables show a checklist's progress and an
// "Open" action; this module is the editor that action opens. It presents the
// ordered steps with per-step completion, delegation (assignee), due date and
// notes, supports adding / reordering / removing steps, and offers the sharing
// paths the roadmap calls for: copy as text, download as CSV, and clone the
// whole checklist into another client's documentation set.
//
// The editor edits a LOCAL copy of the step list and commits the whole items
// array in one updateRecord() on Save — so an accidental click is not persisted
// until the user saves.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal, copyText, downloadCsv, fmtDate } from "./shared.js";
import {
  checklistItems,
  checklistProgress,
  checklistCsvRows,
  formatChecklistText,
  makeChecklistItem,
} from "../framework/checklist.js";
import {
  CUTOVER_PHASES,
  cutoverPhase,
  isCutoverChecklist,
  cutoverSignOff,
  cutoverAcceptanceLine,
  cutoverAcceptanceTone,
  cutoverDecisionOptions,
  cutoverPhaseProgress,
  formatCutoverText,
} from "../framework/cutover.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

export function openChecklistEditor(ctx, set, record, reload) {
  const readonly = !!set.archived;
  const isCutover = isCutoverChecklist(record);
  let items = checklistItems(record).map((s) => ({ ...s }));
  let cloneTargets = [{ id: set.id, name: set.name }];

  const nameInput = h("input", { class: "kb-input", type: "text" });
  nameInput.value = record.name || "";
  const descInput = h("textarea", { class: "kb-input", rows: 2, placeholder: "What is this checklist for?" });
  descInput.value = record.description || "";
  const assigneeInput = h("input", { class: "kb-input", type: "text", placeholder: "Default assignee (optional)" });
  assigneeInput.value = record.defaultAssignee || "";
  const dueInput = h("input", { class: "kb-input", type: "date" });
  dueInput.value = record.dueDate || "";

  const progressBar = h("div", { class: "kb-progress" }, h("div", { class: "kb-progress-fill" }));
  const progressText = h("span", { class: "kb-checklist-progress-text" });
  const listEl = h("div", { class: "kb-checklist-list" });

  function snapshot() {
    return {
      ...record,
      name: nameInput.value.trim() || record.name,
      description: descInput.value.trim(),
      defaultAssignee: assigneeInput.value.trim(),
      dueDate: dueInput.value,
      items,
    };
  }

  function renderProgress() {
    const p = checklistProgress(items);
    const fill = progressBar.firstChild;
    fill.style.width = p.percent + "%";
    fill.className = "kb-progress-fill kb-progress-fill--" + (p.complete ? "ok" : p.total ? "near" : "ok");
    progressText.textContent =
      p.total === 0
        ? "No steps yet"
        : p.done + " of " + p.total + " complete · " + p.remaining + " remaining (" + p.percent + "%)";
  }

  function move(item, delta) {
    const i = items.indexOf(item);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    items.splice(i, 1);
    items.splice(j, 0, item);
    renderList();
  }

  function removeItem(item) {
    items = items.filter((x) => x !== item);
    renderList();
  }

  function stepRow(item, index) {
    const done = h("input", { type: "checkbox", class: "kb-check" });
    done.checked = !!item.done;
    done.disabled = readonly;
    done.addEventListener("change", () => {
      item.done = done.checked;
      if (done.checked) {
        item.doneAt = Date.now();
        item.doneBy = whoami(ctx);
      } else {
        item.doneAt = null;
        item.doneBy = "";
      }
      renderProgress();
    });

    const text = h("input", { class: "kb-input kb-input-sm", type: "text", placeholder: "Step description" });
    text.value = item.text || "";
    text.disabled = readonly;
    text.addEventListener("input", () => {
      item.text = text.value;
    });

    const assignee = h("input", { class: "kb-input kb-input-sm", type: "text", placeholder: "Assignee" });
    assignee.value = item.assignee || "";
    assignee.disabled = readonly;
    assignee.addEventListener("input", () => {
      item.assignee = assignee.value;
    });

    const due = h("input", { class: "kb-input kb-input-sm", type: "date" });
    due.value = item.dueDate || "";
    due.disabled = readonly;
    due.addEventListener("input", () => {
      item.dueDate = due.value;
    });

    const notes = h("input", { class: "kb-input kb-input-sm", type: "text", placeholder: "Notes" });
    notes.value = item.notes || "";
    notes.disabled = readonly;
    notes.addEventListener("input", () => {
      item.notes = notes.value;
    });

    const up = h("button", { class: "kb-icon-btn", type: "button", title: "Move up", disabled: readonly || index === 0 }, "↑");
    up.addEventListener("click", () => move(item, -1));
    const down = h("button", { class: "kb-icon-btn", type: "button", title: "Move down", disabled: readonly || index === items.length - 1 }, "↓");
    down.addEventListener("click", () => move(item, 1));
    const del = h("button", { class: "kb-icon-btn kb-btn-danger-text", type: "button", title: "Remove step", disabled: readonly }, "✕");
    del.addEventListener("click", () => removeItem(item));

    const status =
      item.done && item.doneAt
        ? h("span", { class: "kb-checklist-step-meta", title: "Completed by " + (item.doneBy || "—") + " on " + fmtDate(item.doneAt) }, "done " + fmtDate(item.doneAt))
        : null;

    return h(
      "div",
      { class: "kb-checklist-step" + (item.done ? " kb-checklist-step--done" : ""), dataset: { step: item.id } },
      h("span", { class: "kb-checklist-step-no" }, String(index + 1)),
      done,
      h(
        "div",
        { class: "kb-checklist-step-fields" },
        h("div", { class: "kb-checklist-step-main" }, text, item.hint ? h("span", { class: "kb-checklist-step-hint" }, item.hint) : null, status),
        h("div", { class: "kb-checklist-step-sub" }, assignee, due, notes),
      ),
      h("div", { class: "kb-checklist-step-actions" }, up, down, del),
    );
  }

  function renderList() {
    clear(listEl);
    if (!items.length) {
      listEl.append(h("p", { class: "kb-muted" }, "No steps yet. Add the first step below."));
    } else if (isCutover) {
      const byPhase = cutoverPhaseProgress({ items });
      const phaseGroup = (phase, sub) => {
        const pp = byPhase[phase.id];
        listEl.append(
          h(
            "div",
            { class: "kb-cutover-phase", dataset: { phase: phase.id } },
            h("span", { class: "kb-cutover-phase-name" }, phase.label),
            h("span", { class: "kb-cutover-phase-count" }, pp ? pp.done + "/" + pp.total : ""),
          ),
        );
        for (const item of sub) listEl.append(stepRow(item, items.indexOf(item)));
      };
      for (const phase of CUTOVER_PHASES) {
        const sub = items.filter((it) => it.phase === phase.id);
        if (sub.length) phaseGroup(phase, sub);
      }
      const extras = items.filter((it) => !cutoverPhase(it.phase));
      if (extras.length) phaseGroup({ id: "other", label: "Other" }, extras);
    } else {
      items.forEach((item, i) => listEl.append(stepRow(item, i)));
    }
    renderProgress();
  }

  const foldText = h("input", { class: "kb-input", type: "text", placeholder: "Type a step and press Add (or Enter)" });
  let phaseSel = null;
  if (isCutover) {
    phaseSel = h("select", { class: "kb-input kb-input-sm kb-cutover-phase-select", title: "Phase for a new step" });
    for (const p of CUTOVER_PHASES) phaseSel.append(h("option", { value: p.id }, p.label));
  }
  const addStepBtn = h(
    "button",
    { class: "kb-btn kb-btn-ghost", type: "button", id: "kbAddStepBtn", disabled: readonly },
    h("span", { class: "kb-icon", html: icons.plus }),
    "Add step",
  );
  function addStep() {
    const step = makeChecklistItem({ text: foldText.value.trim() }, Date.now());
    if (isCutover && phaseSel) step.phase = phaseSel.value;
    items.push(step);
    foldText.value = "";
    renderList();
    const inputs = listEl.querySelectorAll(".kb-checklist-step:last-child .kb-checklist-step-main .kb-input");
    if (inputs.length) inputs[0].focus();
  }
  addStepBtn.addEventListener("click", addStep);
  foldText.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addStep();
    }
  });

  function openCloneDialog() {
    const sel = h("select", { class: "kb-input" });
    for (const s of cloneTargets) sel.append(h("option", { value: s.id }, s.name + (s.id === set.id ? " (this set)" : "")));
    const other = cloneTargets.find((s) => s.id !== set.id);
    sel.value = other ? other.id : set.id;
    const cm = openModal({
      title: "Reuse this checklist",
      description:
        "Copy this checklist — fresh step ids, progress reset — into another client's documentation set. The original is untouched.",
      children: [h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Target documentation set"), sel)],
    });
    cm.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: cm.close }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbCloneChecklistSaveBtn" }, "Copy checklist"),
    );
    cm.actions.querySelector("#kbCloneChecklistSaveBtn").addEventListener("click", async () => {
      cm.clearError();
      try {
        const res = await ctx.docs.cloneChecklist(set.id, { type: "checklists", id: record.id }, sel.value, {
          updatedBy: whoami(ctx),
          resetProgress: true,
        });
        cm.close();
        ctx.toast("Copied “" + record.name + "” (" + res.itemCount + " steps)", "success");
      } catch (e) {
        cm.showError(String((e && e.message) || e));
      }
    });
  }

  const toolbar = h(
    "div",
    { class: "kb-checklist-toolbar" },
    phaseSel,
    foldText,
    addStepBtn,
    h("span", { class: "kb-checklist-toolbar-sep" }),
    h(
      "button",
      { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbFieldChecklistBtn", disabled: readonly, title: "A phone-friendly view: tap a step to tick it — each tick saves immediately" },
      h("span", { class: "kb-icon", html: icons.phone }),
      "Field view",
    ),
    h(
      "button",
      { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbShareChecklistBtn", disabled: readonly },
      "Copy as text",
    ),
    h(
      "button",
      { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbCsvChecklistBtn", disabled: readonly },
      "Download CSV",
    ),
    h(
      "button",
      { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbCloneChecklistBtn", disabled: readonly },
      "Copy to client",
    ),
  );
  toolbar.querySelector("#kbShareChecklistBtn").addEventListener("click", () =>
    copyText(isCutover ? formatCutoverText(snapshot(), { set }) : formatChecklistText(snapshot(), set), ctx.toast),
  );
  toolbar.querySelector("#kbFieldChecklistBtn").addEventListener("click", () => openFieldChecklist(ctx, { setId: set.id, recordId: record.id, reload }));
  toolbar.querySelector("#kbCsvChecklistBtn").addEventListener("click", () =>
    downloadCsv((record.name || "checklist").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".csv", checklistCsvRows(snapshot(), set)),
  );
  toolbar.querySelector("#kbCloneChecklistBtn").addEventListener("click", openCloneDialog);

  let acceptance = cutoverSignOff(record) ? { ...cutoverSignOff(record) } : { decision: "pending", acceptedBy: "", notes: "", preparedBy: "" };
  const acceptanceChip = h("span", { class: "kb-cutover-accept" });
  function renderAcceptance() {
    acceptanceChip.textContent = cutoverAcceptanceLine({ signOff: acceptance });
    acceptanceChip.className = "kb-cutover-accept kb-cutover-accept--" + cutoverAcceptanceTone({ signOff: acceptance });
  }
  const decisionSel = h("select", { class: "kb-input" });
  for (const d of cutoverDecisionOptions()) decisionSel.append(h("option", { value: d.id }, d.label));
  decisionSel.value = acceptance.decision || "pending";
  const acceptByInput = h("input", { class: "kb-input", type: "text", placeholder: "Who accepted, on the client side" });
  acceptByInput.value = acceptance.acceptedBy || "";
  const acceptNotesInput = h("input", { class: "kb-input", type: "text", placeholder: "Caveats / notes" });
  acceptNotesInput.value = acceptance.notes || "";
  const recordAcceptBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbRecordAcceptanceBtn", disabled: readonly }, "Save acceptance");
  recordAcceptBtn.addEventListener("click", async () => {
    try {
      const res = await ctx.docs.signOffChecklist(
        set.id,
        { type: "checklists", id: record.id },
        { decision: decisionSel.value, acceptedBy: acceptByInput.value.trim(), notes: acceptNotesInput.value.trim(), preparedBy: acceptance.preparedBy || whoami(ctx) },
        { updatedBy: whoami(ctx) },
      );
      acceptance = res.signOff;
      renderAcceptance();
      ctx.toast("Acceptance saved — " + cutoverAcceptanceLine({ signOff: acceptance }), "success");
    } catch (e) {
      ctx.toast(String((e && e.message) || e), "error", 5200);
    }
  });
  const signOffBox = isCutover
    ? h(
        "div",
        { class: "kb-cutover-signoff" },
        h("div", { class: "kb-cutover-signoff-head" }, h("h3", { class: "kb-cutover-signoff-title" }, "Acceptance & sign-off"), acceptanceChip),
        h("p", { class: "kb-field-help" }, "Record the client's acceptance of the cutover. “Accepted”, “Accepted with issues” and “Rejected” all require the name of who decided."),
        h(
          "div",
          { class: "kb-field-row" },
          h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Decision"), decisionSel),
          h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Accepted by"), acceptByInput),
        ),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Notes"), acceptNotesInput),
        h("div", { class: "kb-cutover-signoff-actions" }, recordAcceptBtn),
      )
    : null;
  renderAcceptance();

  const m = openModal({
    title: "Checklist — " + record.name,
    description: isCutover
      ? "A phased pre-deployment / cutover / post-cutover checklist. Tick each step as it completes, then record the client's acceptance. Save to commit the steps."
      : "Ordered steps with per-step completion, delegation and due dates. Save to commit; share as text or CSV, or copy the whole checklist to another client.",
    wide: true,
    children: [
      h(
        "div",
        { class: "kb-checklist-body" },
        h(
          "div",
          { class: "kb-field-row" },
          h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Checklist name"), nameInput),
          h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Default assignee"), assigneeInput),
          h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Due date"), dueInput),
        ),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Description"), descInput),
        h("div", { class: "kb-checklist-progress-row" }, progressBar, progressText),
        toolbar,
        listEl,
        signOffBox,
      ),
    ],
  });
  m.overlay.querySelector(".kb-modal").classList.add("kb-modal-checklist");
  renderList();

  ctx.docs
    .summaries({ includeArchived: false })
    .then((all) => {
      cloneTargets = all.map((s) => ({ id: s.id, name: s.name }));
      if (!cloneTargets.some((s) => s.id === set.id)) cloneTargets.unshift({ id: set.id, name: set.name });
    })
    .catch(() => {});

  if (readonly) {
    m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
    return m;
  }
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbSaveChecklistBtn" }, "Save checklist"),
  );
  m.actions.querySelector("#kbSaveChecklistBtn").addEventListener("click", async () => {
    m.clearError();
    const next = items.filter((it) => String(it.text || "").trim());
    if (!next.length && items.length) {
      m.showError("Every step needs text — remove the empty ones or type something in them.");
      return;
    }
    if (!nameInput.value.trim()) {
      m.showError("Give the checklist a name.");
      return;
    }
    try {
      const res = await ctx.docs.updateRecord(
        set.id,
        { type: "checklists", id: record.id },
        {
          name: nameInput.value.trim(),
          description: descInput.value.trim(),
          defaultAssignee: assigneeInput.value.trim(),
          dueDate: dueInput.value,
          items: next,
        },
        { updatedBy: whoami(ctx) },
      );
      m.close();
      const p = checklistProgress(next);
      ctx.toast("Saved “" + res.record.name + "” — " + p.done + "/" + p.total + " complete", "success");
      reload && reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
  return m;
}

// ---------------------------------------------------------------------------
// field checklist (roadmap task 51)
// ---------------------------------------------------------------------------
// A full-screen, phone-first view of one checklist. Unlike the editor (which
// edits a local copy and commits on Save), every tap here ticks a step and
// saves it immediately through the per-step API — so a technician can walk a
// checklist on site without a Save button, and a tick made offline is staged
// locally and reconciled when the connection returns.
export async function openFieldChecklist(ctx, { setId, recordId, reload } = {}) {
  const set = await ctx.docs.get(setId, { force: true }).catch(() => null);
  if (!set) {
    ctx.toast("Couldn't load that client's documentation.", "error");
    return null;
  }
  const readonly = !!set.archived;
  const record = (set.records.checklists || []).find((r) => r.id === recordId);
  if (!record) {
    ctx.toast("That checklist no longer exists — it may have been deleted.", "error");
    return null;
  }
  const isCutover = isCutoverChecklist(record);
  const items = checklistItems(record).map((s) => ({ ...s }));
  const byId = new Map(items.map((s) => [s.id, s]));

  const progressBar = h("div", { class: "kb-progress" }, h("div", { class: "kb-progress-fill" }));
  const progressText = h("span", { class: "kb-field-progress-text" });
  const statusEl = h("div", { class: "kb-field-status kb-field-status--muted", id: "kbFieldStatus" }, readonly ? "This checklist is read-only (archived)." : "Tap a step to tick it.");
  const listEl = h("div", { class: "kb-field-steps", id: "kbFieldSteps" });
  const rowEls = new Map();

  function renderProgress() {
    const p = checklistProgress(items);
    const fill = progressBar.firstChild;
    fill.style.width = p.percent + "%";
    fill.className = "kb-progress-fill kb-progress-fill--" + (p.complete ? "ok" : p.total ? "near" : "ok");
    progressText.textContent = p.total ? p.done + " of " + p.total + " done · " + p.remaining + " left" : "No steps yet";
  }

  function setStatus(text, tone = "muted") {
    statusEl.textContent = text;
    statusEl.className = "kb-field-status kb-field-status--" + tone;
  }

  function paintRow(step) {
    const row = rowEls.get(step.id);
    if (!row) return;
    row.classList.toggle("kb-field-step--done", !!step.done);
    row.setAttribute("aria-checked", step.done ? "true" : "false");
    const box = row.querySelector(".kb-field-step-check");
    if (box) box.innerHTML = step.done ? icons.check : "";
  }

  async function tick(step, done) {
    if (readonly) return;
    const previous = !!step.done;
    step.done = done; // optimistic
    paintRow(step);
    renderProgress();
    setStatus("Saving…", "saving");
    try {
      const res = await ctx.docs.toggleChecklistItem(setId, { type: "checklists", id: recordId }, step.id, done, { updatedBy: whoami(ctx) });
      if (res && res.item) Object.assign(step, res.item);
      paintRow(step);
      renderProgress();
      if (res && res.staged) {
        setStatus("Saved on this device — it will sync when the connection returns.", "pending");
      } else {
        setStatus(done ? "Ticked" : "Re-opened", "ok");
      }
      reload && reload();
    } catch (e) {
      step.done = previous; // revert the optimistic tick
      paintRow(step);
      renderProgress();
      setStatus("Couldn't save — " + String((e && e.message) || e), "error");
    }
  }

  function stepRow(step, index) {
    const row = h(
      "button",
      {
        class: "kb-field-step" + (step.done ? " kb-field-step--done" : ""),
        type: "button",
        role: "checkbox",
        "aria-checked": step.done ? "true" : "false",
        dataset: { step: step.id },
        disabled: readonly,
        onClick: () => tick(step, !step.done),
      },
      h("span", { class: "kb-field-step-check", html: step.done ? icons.check : "" }),
      h(
        "span",
        { class: "kb-field-step-body" },
        h("span", { class: "kb-field-step-text" }, (index + 1) + ". " + (step.text || "Untitled step")),
        step.hint ? h("span", { class: "kb-field-step-hint" }, step.hint) : null,
        step.assignee || step.dueDate || step.notes
          ? h(
              "span",
              { class: "kb-field-step-meta" },
              step.assignee ? h("span", { class: "kb-field-step-tag" }, "@" + step.assignee) : null,
              step.dueDate ? h("span", { class: "kb-field-step-tag" }, "due " + step.dueDate) : null,
              step.notes ? h("span", { class: "kb-field-step-notes" }, step.notes) : null,
            )
          : null,
      ),
    );
    rowEls.set(step.id, row);
    return row;
  }

  function renderList() {
    clear(listEl);
    rowEls.clear();
    if (!items.length) {
      listEl.append(h("p", { class: "kb-field-empty" }, "This checklist has no steps yet. Add steps in the checklist editor first."));
      return;
    }
    if (isCutover) {
      for (const phase of CUTOVER_PHASES) {
        const sub = items.filter((it) => it.phase === phase.id);
        if (!sub.length) continue;
        const done = sub.filter((it) => it.done).length;
        listEl.append(h("div", { class: "kb-field-phase" }, h("span", null, phase.label), h("span", { class: "kb-count-pill" }, done + "/" + sub.length)));
        for (const step of sub) listEl.append(stepRow(step, items.indexOf(step)));
      }
      const extras = items.filter((it) => !cutoverPhase(it.phase));
      if (extras.length) {
        listEl.append(h("div", { class: "kb-field-phase" }, h("span", null, "Other")));
        for (const step of extras) listEl.append(stepRow(step, items.indexOf(step)));
      }
    } else {
      items.forEach((step, i) => listEl.append(stepRow(step, i)));
    }
  }

  const closeBtn = h("button", { class: "kb-icon-btn", type: "button", id: "kbFieldCloseBtn", "aria-label": "Close field view" }, "✕");
  const overlay = h(
    "div",
    { class: "kb-field-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Field checklist — " + record.name },
    h(
      "div",
      { class: "kb-field-shell" },
      h(
        "div",
        { class: "kb-field-head" },
        h(
          "div",
          { class: "kb-field-head-text" },
          h("span", { class: "kb-field-head-crumb" }, (set.name || "") + " · field checklist"),
          h("h2", { class: "kb-field-head-name" }, record.name),
        ),
        closeBtn,
      ),
      h("div", { class: "kb-field-progress" }, progressBar, progressText),
      statusEl,
      listEl,
      h("div", { class: "kb-field-foot" }, readonly ? null : h("span", { class: "kb-field-foot-hint" }, "Each tap saves immediately."), h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbFieldDoneBtn", onClick: () => close() }, "Done")),
    ),
  );

  function close() {
    document.removeEventListener("keydown", esc);
    overlay.remove();
    reload && reload();
  }
  function esc(e) {
    if (e.key === "Escape") close();
  }
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", esc);

  renderList();
  renderProgress();
  document.body.append(overlay);
  return { overlay, close };
}
