// src/taskEditor.js — Full task editor modal (Roadmap task 27) + nested subtasks (task 28).
//
//  27: a single editor for create/edit covering every task field — title, notes,
//      priority, status, due date, tags, project, milestone.
//  28: subtasks live on the task record as `subtasks: [{id, title, done}]`; the
//      editor embeds a small subtask manager, and progress ("2/5") is surfaced
//      in task rows, board cards and the project tasks list.
//
// Phase 2 (task 7): the form is built from the template-u input suite
// (src/pm/formkit.js → src/components/inputs.js) instead of hand-rolled markup.
//
// Pure helpers (covered by runPhase3bTests): parseTags, subtaskStats, updateTask.
// Subtask mutations are pure-ish (store in / out) so tests can drive them too.

import { esc, toast, confirmDialog } from "./ui.js";
import { ICONS } from "./icons.js";
import { uid } from "./store.js";
import { h, clear } from "../framework/dom.js";
import { taskTimeMs, formatMs, timeEntries, startTracking, stopTracking, logManualTime } from "./taskTools.js";
import { attachmentSectionHTML, wireAttachmentSection } from "./attachments.js";
import {
  textInput,
  textareaInput,
  selectInput,
  checkboxField,
  fieldStack,
  fieldGrid,
  blockField,
  formModal,
  actionButton,
  submitOnEnter,
  focusFirst,
  pmIcon,
} from "./formkit.js";

export const TASK_STATUSES = ["Active", "Doing", "Blocked", "Done"];
export const PRIORITIES = ["high", "med", "low"];

export function parseTags(str) {
  return String(str || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function subtaskStats(tk) {
  const subs = Array.isArray(tk && tk.subtasks) ? tk.subtasks : [];
  return { total: subs.length, done: subs.filter((s) => s.done).length };
}

export function addSubtask(store, taskId, title) {
  const tk = store.get("task", taskId);
  const t = String(title || "").trim();
  if (!tk || !t) return null;
  const sub = { id: uid(), title: t, done: false };
  store.upsert("task", taskId, { subtasks: [...(tk.subtasks || []), sub] });
  return sub;
}
export function toggleSubtask(store, taskId, subId) {
  const tk = store.get("task", taskId);
  if (!tk) return;
  store.upsert("task", taskId, { subtasks: (tk.subtasks || []).map((s) => (s.id === subId ? Object.assign({}, s, { done: !s.done }) : s)) });
}
export function removeSubtask(store, taskId, subId) {
  const tk = store.get("task", taskId);
  if (!tk) return;
  store.upsert("task", taskId, { subtasks: (tk.subtasks || []).filter((s) => s.id !== subId) });
}

// upsert a patch onto an existing task, returns the updated record
export function updateTask(store, id, patch) {
  const tk = store.get("task", id);
  if (!tk) return null;
  return store.upsert("task", id, patch);
}

// Option arrays for the template-u select fields.
function projectOptionList(store) {
  const projects = store.all("project").sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return [{ value: "", label: "Default (no project)" }, ...projects.map((p) => ({ value: p.id, label: p.name }))];
}
function milestoneOptionList(store, projectId) {
  const p = projectId ? store.get("project", projectId) : null;
  const ms = p && p.milestones ? p.milestones : [];
  return [{ value: "", label: "No milestone" }, ...ms.map((m) => ({ value: m.id, label: m.name }))];
}
function setSelectOptions(selectEl, list, value) {
  clear(selectEl);
  for (const opt of list) selectEl.appendChild(h("option", { value: opt.value }, opt.label));
  selectEl.value = value == null ? "" : String(value);
}

// Open the full task editor. `task` null → create mode; `defaults` seeds the
// form for create (projectId, status, priority, due, title).
export function openTaskEditor(store, { task = null, defaults = {} } = {}) {
  const isEdit = !!task;
  let subs = isEdit ? (Array.isArray(task.subtasks) ? task.subtasks.map((s) => Object.assign({}, s)) : []) : [];
  const selectedProject = task ? task.projectId : (defaults.projectId || "");

  const titleField = textInput({ name: "title", label: "Title", value: task ? task.title : "", placeholder: "What needs to be done?", maxlength: 160, required: true });
  const statusField = selectInput({ name: "status", label: "Status", value: task ? task.status : (defaults.status || "Active"), options: TASK_STATUSES });
  const priField = selectInput({ name: "priority", label: "Priority", value: task ? task.priority : (defaults.priority || "med"), options: PRIORITIES });
  const dueField = textInput({ name: "due", label: "Due date", type: "date", value: task && task.due ? task.due : "" });
  const tagsField = textInput({ name: "tags", label: "Tags (comma separated)", value: task && task.tags ? task.tags.join(", ") : "", placeholder: "design, urgent" });
  const recField = selectInput({
    name: "recurrence",
    label: "Repeats",
    value: task && task.recurrence ? task.recurrence.freq : "",
    options: [{ value: "", label: "Never" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }],
  });
  const recIntField = textInput({ name: "recInterval", label: "Every", type: "number", min: 1, max: 99, value: task && task.recurrence ? (task.recurrence.interval || 1) : 1, hint: "Repeat every N days / weeks / months" });
  const projField = selectInput({ name: "projectId", label: "Project", value: selectedProject || "", options: projectOptionList(store) });
  const msField = selectInput({ name: "milestoneId", label: "Milestone", value: task && task.milestoneId ? task.milestoneId : "", options: milestoneOptionList(store, selectedProject) });
  const notesField = textareaInput({ name: "notes", label: "Notes", value: task ? task.notes : "", placeholder: "Context, links, acceptance criteria…" });

  // dependencies — a scrollable checklist (touch-friendly, unlike a multi-select)
  const depCandidates = store.all("task")
    .filter((x) => !isEdit || x.id !== task.id)
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  const depSelected = isEdit && Array.isArray(task.dependsOn) ? new Set(task.dependsOn) : new Set();
  const depFields = depCandidates.map((x) => checkboxField({ name: "dep", label: (x.title || "").slice(0, 70) || "Untitled task", checked: depSelected.has(x.id) }));
  const depBox = depFields.length
    ? h("div", { class: "te-deps" }, ...depFields.map((f) => f.el))
    : h("div", { class: "te-sub-empty" }, "No other tasks to depend on yet.");

  // subtasks (task 28)
  const subsList = h("div", { class: "te-subs" });
  const subInput = h("input", { class: "pu-input", type: "text", placeholder: "Add a subtask…", maxlength: 120 });
  const renderSubs = () => {
    clear(subsList);
    if (!subs.length) {
      subsList.appendChild(h("div", { class: "te-sub-empty" }, "No subtasks yet — break this task down."));
      return;
    }
    for (const s of subs) {
      subsList.appendChild(
        h(
          "div",
          { class: "te-sub" },
          h("button", { class: "mini-btn sub-done" + (s.done ? " on" : ""), type: "button", title: s.done ? "Mark open" : "Mark done", html: ICONS.check, onclick: () => { s.done = !s.done; renderSubs(); } }),
          h("span", { class: "sub-title" + (s.done ? " done" : "") }, s.title),
          h("button", { class: "mini-btn danger", type: "button", title: "Remove subtask", html: ICONS.x, onclick: () => { subs = subs.filter((x) => x.id !== s.id); renderSubs(); } })
        )
      );
    }
  };
  const addSub = () => {
    const t = String(subInput.value || "").trim();
    if (!t) return;
    subs.push({ id: uid(), title: t, done: false });
    subInput.value = "";
    renderSubs();
    subInput.focus();
  };
  subInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } });
  renderSubs();

  // time tracking (task 82) — writes straight to the store so a running timer
  // survives closing the modal; only offered when editing an existing task
  const fmtClock = (ms) => {
    ms = Math.max(0, ms);
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 3600)).padStart(2, "0") + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  let timeSection = null;
  let timeTicker = null;
  if (isEdit) {
    const totalEl = h("span", { class: "te-time-total" });
    const toggleBtn = h("button", { class: "pu-btn pu-btn--secondary pu-btn--sm", type: "button", title: "Start / stop a timer for this task" });
    const logBtn = h("button", { class: "pu-btn pu-btn--ghost pu-btn--sm", type: "button", title: "Log time manually" }, pmIcon("plus", 14));
    const minInput = h("input", { class: "pu-input te-time-min", type: "number", min: "1", max: "9999", placeholder: "min" });
    const logList = h("div", { class: "te-time-log" });
    const renderTime = () => {
      const live = store.get("task", task.id);
      const total = live ? taskTimeMs(live) : 0;
      let text = "Total " + formatMs(total);
      if (live && live.tracking) text += " · tracking " + fmtClock(Date.now() - live.tracking.start);
      totalEl.textContent = text;
      const entries = (live ? timeEntries(live) : []).slice().reverse().slice(0, 6);
      clear(logList);
      if (!entries.length) {
        logList.appendChild(h("div", { class: "te-time-empty" }, "No sessions logged yet."));
      } else {
        for (const e of entries) {
          logList.appendChild(
            h("div", {
              class: "te-time-entry",
              html: `${ICONS.clock} ${esc(fmtClock(e.end - e.start))}${e.note ? " · " + esc(e.note) : ""} · ${esc(new Date(e.end).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}`,
            })
          );
        }
      }
      const tracking = live && live.tracking;
      clear(toggleBtn);
      toggleBtn.appendChild(pmIcon(tracking ? "stop" : "play", 14));
      toggleBtn.appendChild(h("span", {}, tracking ? "Stop" : "Start"));
      toggleBtn.classList.toggle("danger", !!tracking);
    };
    toggleBtn.addEventListener("click", () => {
      const live = store.get("task", task.id);
      if (!live) return;
      if (live.tracking) stopTracking(store, task.id);
      else startTracking(store, task.id);
      renderTime();
    });
    logBtn.addEventListener("click", () => {
      const min = Number(minInput.value || 0);
      if (!min || min <= 0) {
        toast("Enter how many minutes to log", "error");
        return;
      }
      logManualTime(store, task.id, min);
      minInput.value = "";
      renderTime();
      toast(min + " min logged", "success");
    });
    timeSection = blockField("Time tracked", h("div", { class: "te-time" }, totalEl, toggleBtn, logBtn, minInput), logList);
    renderTime();
    timeTicker = setInterval(renderTime, 1000);
  }

  const attachCtn = isEdit ? h("div", { html: attachmentSectionHTML(store, "task", task.id) }) : null;

  const subAdd = h("div", { class: "te-sub-add" }, subInput, h("button", { class: "mini-btn", type: "button", title: "Add subtask", html: ICONS.plus, onclick: () => addSub() }));

  const body = [
    fieldStack(
      titleField,
      fieldGrid(statusField, priField),
      fieldGrid(dueField, tagsField),
      fieldGrid(recField, recIntField),
      blockField("Depends on", depBox, h("p", { class: "muted small te-dep-hint", html: `${ICONS.link2} The task is blocked while any of these is open.` })),
      projField,
      msField,
      notesField,
      blockField("Subtasks", subsList, subAdd)
    ),
  ];
  if (timeSection) body.push(timeSection);
  if (attachCtn) body.push(blockField("Attachments", attachCtn));

  const save = () => {
    const title = String(titleField.value || "").trim();
    if (!title) {
      titleField.setError("Please enter a task title");
      titleField.focus();
      return false;
    }
    const projectId = projField.value || null;
    const milestoneId = projectId ? (msField.value || null) : null;
    const recFreq = recField.value || "";
    const recInterval = Math.max(1, Number(recIntField.value) || 1);
    const fields = {
      title,
      status: statusField.value || "Active",
      priority: priField.value || "med",
      due: dueField.value || "",
      tags: parseTags(tagsField.value),
      notes: String(notesField.value || "").trim(),
      projectId,
      milestoneId,
      subtasks: subs,
      recurrence: recFreq ? { freq: recFreq, interval: recInterval, count: (isEdit && task.recurrence && task.recurrence.freq === recFreq) ? (task.recurrence.count || 1) : 1 } : null,
      dependsOn: depFields.reduce((acc, f, i) => {
        if (f.value) acc.push(depCandidates[i].id);
        return acc;
      }, []),
    };
    if (isEdit) updateTask(store, task.id, fields);
    else store.create("task", fields);
    toast(isEdit ? "Task updated" : "Task added", "success");
  };

  const ref = { close: () => {} };
  const leftButtons = isEdit
    ? [
        actionButton({
          label: "Delete",
          variant: "danger",
          icon: "trash",
          className: "fk-left",
          onClick: async () => {
            const sure = await confirmDialog({ title: "Delete task?", message: "“" + task.title + "” will be permanently removed.", confirmText: "Delete task", danger: true });
            if (!sure) return;
            store.remove("task", task.id);
            toast("Task deleted", "success");
            ref.close();
          },
        }),
      ]
    : [];

  const { el, close } = formModal({
    title: isEdit ? "Edit task" : "New task",
    subtitle: isEdit ? "Update the task details." : "Add a task with the details you have.",
    className: "task-modal",
    body,
    leftButtons,
    acceptLabel: isEdit ? "Save changes" : "Create task",
    onAccept: save,
    onClose: () => {
      if (timeTicker) {
        clearInterval(timeTicker);
        timeTicker = null;
      }
    },
  });
  ref.close = close;

  // changing project swaps the milestone options
  projField.input.addEventListener("change", () => setSelectOptions(msField.input, milestoneOptionList(store, projField.value || ""), ""));
  if (attachCtn) {
    const section = attachCtn.querySelector("[data-at-section]");
    if (section) wireAttachmentSection(section, store, "task", task.id);
  }
  submitOnEnter(el, titleField.input);
  focusFirst(el);
  return { el, close };
}
