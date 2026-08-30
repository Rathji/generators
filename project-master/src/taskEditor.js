// src/taskEditor.js — Full task editor modal (Roadmap task 27) + nested subtasks (task 28).
//
//  27: a single editor for create/edit covering every task field — title, notes,
//      priority, status, due date, tags, project, milestone.
//  28: subtasks live on the task record as `subtasks: [{id, title, done}]`; the
//      editor embeds a small subtask manager, and progress ("2/5") is surfaced
//      in task rows, board cards and the project tasks list.
//
// Pure helpers (covered by runPhase3bTests): parseTags, subtaskStats, updateTask.
// Subtask mutations are pure-ish (store in / out) so tests can drive them too.

import { $, esc, toast, confirmDialog, openModal } from "./ui.js";
import { ICONS } from "./icons.js";
import { uid } from "./store.js";
import { taskTimeMs, formatMs, timeEntries, startTracking, stopTracking, logManualTime, openDeps } from "./taskTools.js";
import { attachmentSectionHTML, wireAttachmentSection } from "./attachments.js";

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

function projectOptions(store, selectedId) {
  const projects = store.all("project").sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return `<option value="" ${selectedId === null || selectedId === undefined ? "selected" : ""}>Default (no project)</option>` +
    projects.map((p) => `<option value="${esc(p.id)}" ${selectedId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
}

function milestoneOptions(store, projectId, selected) {
  const p = projectId ? store.get("project", projectId) : null;
  const ms = p && p.milestones ? p.milestones : [];
  return `<option value="" ${selected ? "" : "selected"}>No milestone</option>` +
    ms.map((m) => `<option value="${esc(m.id)}" ${selected === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("");
}

// Open the full task editor. `task` null → create mode; `defaults` seeds the
// form for create (projectId, status, priority, due, title).
export function openTaskEditor(store, { task = null, defaults = {} } = {}) {
  const isEdit = !!task;
  const subs = isEdit ? (Array.isArray(task.subtasks) ? task.subtasks.map((s) => Object.assign({}, s)) : []) : [];
  const selectedProject = task ? task.projectId : (defaults.projectId || "");
  const depCandidates = store.all("task")
    .filter((x) => !isEdit || x.id !== task.id)
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  const depSelected = isEdit && Array.isArray(task.dependsOn) ? new Set(task.dependsOn) : new Set();
  const depOptions = depCandidates.length
    ? depCandidates.map((x) => `<option value="${esc(x.id)}" ${depSelected.has(x.id) ? "selected" : ""}>${esc((x.title || "").slice(0, 60))}</option>`).join("")
    : `<option value="">(no other tasks)</option>`;
  let { el, close } = openModal(`
    <div class="modal-card task-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "Edit task" : "New task"}">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>${isEdit ? "Edit task" : "New task"}</h3>
      <p class="modal-sub">${isEdit ? "Update the task details." : "Add a task with the details you have."}</p>
      <div class="field"><label for="teTitleInput">Title *</label><input type="text" id="teTitleInput" value="${esc(task ? task.title : "")}" placeholder="What needs to be done?" maxlength="160"></div>
      <div class="te-grid">
        <div class="field"><label for="teStatusSel">Status</label>
          <select id="teStatusSel">${TASK_STATUSES.map((s) => `<option ${(task ? task.status : defaults.status || "Active") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="field"><label for="tePriSel">Priority</label>
          <select id="tePriSel">${PRIORITIES.map((p) => `<option ${(task ? task.priority : defaults.priority || "med") === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      </div>
      <div class="te-grid">
        <div class="field"><label for="teDueInput">Due date</label><input type="date" id="teDueInput" value="${esc(task && task.due ? task.due : "")}"></div>
        <div class="field"><label for="teTagsInput">Tags (comma separated)</label><input type="text" id="teTagsInput" value="${esc((task && task.tags ? task.tags : []).join(", "))}" placeholder="design, urgent"></div>
      </div>
      <div class="te-grid">
        <div class="field"><label for="teRecSel">Repeats</label>
          <select id="teRecSel">
            <option value="">Never</option>
            <option value="daily" ${task && task.recurrence && task.recurrence.freq === "daily" ? "selected" : ""}>Daily</option>
            <option value="weekly" ${task && task.recurrence && task.recurrence.freq === "weekly" ? "selected" : ""}>Weekly</option>
            <option value="monthly" ${task && task.recurrence && task.recurrence.freq === "monthly" ? "selected" : ""}>Monthly</option>
          </select></div>
        <div class="field"><label for="teRecInterval">Every</label><input type="number" id="teRecInterval" min="1" max="99" value="${task && task.recurrence ? (task.recurrence.interval || 1) : 1}" title="Repeat every N days/weeks/months"></div>
      </div>
      <div class="field">
        <label for="teDepsSel">Depends on</label>
        <select id="teDepsSel" multiple size="3">${depOptions}</select>
        <p class="muted small">${ICONS.link2} The task is blocked while any of these is open. Hold Ctrl/Cmd to select several.</p>
      </div>
      <div class="field"><label for="teProjSel">Project</label>
        <select id="teProjSel">${projectOptions(store, selectedProject)}</select></div>
      <div class="field"><label for="teMsSel">Milestone</label>
        <select id="teMsSel">${milestoneOptions(store, selectedProject, task ? task.milestoneId : "")}</select></div>
      <div class="field"><label for="teNotesInput">Notes</label><textarea id="teNotesInput" placeholder="Context, links, acceptance criteria…">${esc(task ? task.notes : "")}</textarea></div>
      <div class="field">
        <label>Subtasks</label>
        <div class="te-subs" id="teSubsList"></div>
        <div class="te-sub-add"><input type="text" id="teSubInput" placeholder="Add a subtask…" maxlength="120"><button class="mini-btn" id="teSubAddBtn" title="Add subtask">${ICONS.plus}</button></div>
      </div>
      ${isEdit ? `
      <div class="field">
        <label>Time tracked</label>
        <div class="te-time">
          <span class="te-time-total" id="teTimeTotal">…</span>
          <button class="mini-btn" id="teTimeBtn" title="Start / stop a timer for this task">${ICONS.play} Start</button>
          <button class="mini-btn" id="teTimeLogBtn" title="Log time manually">${ICONS.plus}</button>
          <input type="number" id="teTimeMin" min="1" max="9999" placeholder="min" style="width:64px;" title="Minutes to log">
        </div>
        <div class="te-time-log" id="teTimeLog"></div>
      </div>
      <div class="field">${attachmentSectionHTML(store, "task", task.id)}</div>` : ""}
      <div class="modal-btns">
        ${isEdit ? `<button class="btn btn-danger" id="teDelBtn" style="margin-right:auto;">${ICONS.trash} Delete</button>` : ""}
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="teSaveBtn">${isEdit ? "Save changes" : "Create task"}</button>
      </div>
    </div>`);

  const renderSubs = () => {
    const list = el.querySelector("#teSubsList");
    if (!list) return;
    list.innerHTML = subs.length
      ? subs.map((s) => `
        <div class="te-sub" data-sub="${esc(s.id)}">
          <button class="mini-btn sub-done ${s.done ? "on" : ""}" data-sub-done="${esc(s.id)}" title="${s.done ? "Mark open" : "Mark done"}">${ICONS.check}</button>
          <span class="sub-title ${s.done ? "done" : ""}">${esc(s.title)}</span>
          <button class="mini-btn danger" data-sub-del="${esc(s.id)}" title="Remove subtask">${ICONS.x}</button>
        </div>`).join("")
      : `<div class="te-sub-empty">No subtasks yet — break this task down.</div>`;
    el.querySelectorAll("[data-sub-done]").forEach((b) => b.addEventListener("click", () => {
      const s = subs.find((x) => x.id === b.dataset.subDone);
      if (s) s.done = !s.done;
      renderSubs();
    }));
    el.querySelectorAll("[data-sub-del]").forEach((b) => b.addEventListener("click", () => {
      const i = subs.findIndex((x) => x.id === b.dataset.subDel);
      if (i >= 0) subs.splice(i, 1);
      renderSubs();
    }));
  };
  renderSubs();

  const addSub = () => {
    const inp = el.querySelector("#teSubInput");
    const t = (inp?.value || "").trim();
    if (!t) return;
    subs.push({ id: uid(), title: t, done: false });
    if (inp) inp.value = "";
    renderSubs();
    if (inp) inp.focus();
  };
  el.querySelector("#teSubAddBtn")?.addEventListener("click", addSub);
  el.querySelector("#teSubInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } });

  // time tracking (task 82) — writes to the store immediately so a running
  // timer survives closing the modal; only offered when editing an existing task
  const fmtClock = (ms) => {
    ms = Math.max(0, ms);
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 3600)).padStart(2, "0") + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  let timeTicker = null;
  if (isEdit) {
    const renderTime = () => {
      const live = store.get("task", task.id);
      const total = live ? taskTimeMs(live) : 0;
      const totalEl = el.querySelector("#teTimeTotal");
      let text = "Total " + formatMs(total);
      if (live && live.tracking) text += " · tracking " + fmtClock(Date.now() - live.tracking.start);
      if (totalEl) totalEl.textContent = text;
      const logEl = el.querySelector("#teTimeLog");
      if (logEl) {
        const entries = (live ? timeEntries(live) : []).slice().reverse().slice(0, 6);
        logEl.innerHTML = entries.length
          ? entries.map((e) => `<div class="te-time-entry">${ICONS.clock} ${esc(fmtClock(e.end - e.start))}${e.note ? " · " + esc(e.note) : ""} · ${new Date(e.end).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>`).join("")
          : `<div class="te-time-empty">No sessions logged yet.</div>`;
      }
      const btn = el.querySelector("#teTimeBtn");
      if (btn) {
        const tracking = live && live.tracking;
        btn.innerHTML = tracking ? `${ICONS.stop} Stop` : `${ICONS.play} Start`;
        btn.classList.toggle("danger", !!tracking);
      }
    };
    el.querySelector("#teTimeBtn")?.addEventListener("click", () => {
      const live = store.get("task", task.id);
      if (!live) return;
      if (live.tracking) stopTracking(store, task.id);
      else startTracking(store, task.id);
      renderTime();
    });
    el.querySelector("#teTimeLogBtn")?.addEventListener("click", () => {
      const min = Number(el.querySelector("#teTimeMin")?.value || 0);
      if (!min || min <= 0) { toast("Enter how many minutes to log", "error"); return; }
      logManualTime(store, task.id, min);
      if (el.querySelector("#teTimeMin")) el.querySelector("#teTimeMin").value = "";
      renderTime();
      toast(min + " min logged", "success");
    });
    renderTime();
    timeTicker = setInterval(renderTime, 1000);
    const atSection = el.querySelector("[data-at-section]");
    if (atSection) wireAttachmentSection(atSection, store, "task", task.id);
  }
  const origClose = close;
  close = () => { if (timeTicker) { clearInterval(timeTicker); timeTicker = null; } origClose(); };

  // changing project swaps the milestone options
  el.querySelector("#teProjSel")?.addEventListener("change", (e) => {
    const ms = el.querySelector("#teMsSel");
    if (ms) ms.innerHTML = milestoneOptions(store, e.target.value || "", "");
  });

  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("#teSaveBtn")?.addEventListener("click", () => {
    const title = (el.querySelector("#teTitleInput")?.value || "").trim();
    if (!title) { toast("Enter a task title", "error"); el.querySelector("#teTitleInput")?.focus(); return; }
    const projectId = el.querySelector("#teProjSel")?.value || null;
    const milestoneId = projectId ? (el.querySelector("#teMsSel")?.value || null) : null;
    const recFreq = el.querySelector("#teRecSel")?.value || "";
    const recInterval = Math.max(1, Number(el.querySelector("#teRecInterval")?.value) || 1);
    const fields = {
      title,
      status: el.querySelector("#teStatusSel")?.value || "Active",
      priority: el.querySelector("#tePriSel")?.value || "med",
      due: el.querySelector("#teDueInput")?.value || "",
      tags: parseTags(el.querySelector("#teTagsInput")?.value),
      notes: (el.querySelector("#teNotesInput")?.value || "").trim(),
      projectId,
      milestoneId,
      subtasks: subs,
      recurrence: recFreq ? { freq: recFreq, interval: recInterval, count: (isEdit && task.recurrence && task.recurrence.freq === recFreq) ? (task.recurrence.count || 1) : 1 } : null,
      dependsOn: [...(el.querySelector("#teDepsSel")?.selectedOptions || [])].map((o) => o.value),
    };
    if (isEdit) updateTask(store, task.id, fields);
    else store.create("task", fields);
    toast(isEdit ? "Task updated" : "Task added", "success");
    close();
  });

  if (isEdit) {
    el.querySelector("#teDelBtn")?.addEventListener("click", async () => {
      const sure = await confirmDialog({ title: "Delete task?", message: "“" + task.title + "” will be permanently removed.", confirmText: "Delete task", danger: true });
      if (!sure) return;
      store.remove("task", task.id);
      toast("Task deleted", "success");
      close();
    });
  }

  // focus title
  setTimeout(() => { const t = el.querySelector("#teTitleInput"); if (t) t.focus(); }, 30);
  return { el, close };
}
