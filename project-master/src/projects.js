// src/projects.js — Projects hub + workspace (Roadmap Phase 2: tasks 17–21)
//  - 17: hub cards grouped by status (progress, open/overdue, milestones, next)
//  - 18: create/edit project modal (name, color, status, target date, description)
//  - 19: delete project with "move tasks to Default" vs "delete tasks too"
//  - 20: project workspace tabs, active tab preserved per project
//  - 21: Overview tab — mini-stats, quick-add task, due-today & upcoming lists,
//        milestone manager (auto-checked when all linked tasks are done), details
//
// The pure logic helpers (projectStats, milestones, deleteProject, …) are
// exported and covered by runPhase2Tests() — they don't touch the DOM.

import { $, esc, toast, openModal, confirmDialog } from "./ui.js";
import { ICONS } from "./icons.js";
import { uid } from "./store.js";
import { todayLocal, addDays, dayDiff, formatDay, formatWeekday, parseIso, dueHighlight } from "./dates.js";
import { openTaskEditor, subtaskStats } from "./taskEditor.js";
import { onTaskCompleted, blockDependents, isBlocked, openDeps, taskTimeMs, formatMs, recurrenceLabel } from "./taskTools.js";
import { ganttHTML, wireGantt } from "./gantt.js";

export const PROJECT_STATUSES = ["Active", "On hold", "Completed", "Archived"];
export const PROJECT_COLORS = ["#8b5cf6", "#22d3ee", "#ec4899", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#14b8a6", "#f97316", "#64748b"];

const TASK_STATUS_COLOR = { Active: "#22d3ee", Doing: "#8b5cf6", Blocked: "#f87171", Done: "#4ade80" };
const PHASE_FOR_TAB = { tasks: 3, board: 3, notes: 6 };
function statusClass(s) { return String(s || "Active").replace(/\s+/g, ""); }

// Blocked/time/recurring chips shared by task rows, board cards, etc.
function taskMetaChips(store, tk) {
  const blocked = tk.status !== "Done" && isBlocked(store, tk);
  const n = blocked ? openDeps(store, tk).length : 0;
  const tm = taskTimeMs(tk);
  return [
    blocked ? `<span class="tv-blocked" title="Waiting on ${n} open task${n === 1 ? "" : "s"}">${ICONS.link2} ${n}</span>` : "",
    tk.recurrence ? `<span class="tv-recur" title="${esc(recurrenceLabel(tk.recurrence))}">${ICONS.repeat}</span>` : "",
    tm ? `<span class="tv-time" title="${formatMs(tm)} tracked">${ICONS.clock} ${formatMs(tm)}</span>` : "",
  ].join("");
}

// ── pure logic (tested) ──────────────────────────────────────────
export function projectTasks(store, projectId) {
  const want = projectId ?? null;
  return store.all("task").filter((t) => (t.projectId ?? null) === want);
}

export const BOARD_STATUSES = ["Active", "Doing", "Blocked", "Done"];
// Kanban columns (task 29): tasks of a project grouped by status, each column
// sorted by due date (undated last) then title. Pure — covered by tests.
export function boardColumns(store, projectId) {
  const tasks = projectTasks(store, projectId);
  return BOARD_STATUSES.map((st) => ({
    status: st,
    tasks: tasks
      .filter((t) => (t.status || "Active") === st)
      .sort((a, b) => {
        const da = a.due || "9999-99-99", db = b.due || "9999-99-99";
        if (da !== db) return da < db ? -1 : 1;
        return String(a.title || "").localeCompare(String(b.title || ""));
      }),
  }));
}

export function projectStats(store, projectId) {
  const t = todayLocal();
  const tasks = projectTasks(store, projectId);
  let open = 0, done = 0, overdue = 0, completedToday = 0;
  const dueToday = [], upcoming = [];
  let nearest = null;
  const consider = (tk) => { if (!nearest || tk.due < nearest.due) nearest = tk; };
  for (const tk of tasks) {
    const isDone = tk.status === "Done";
    if (isDone) done++; else open++;
    if (isDone && tk.completedAt) { const d = new Date(tk.completedAt); const ds = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); if (ds === t) completedToday++; }
    if (!isDone && tk.due) {
      if (tk.due < t) { overdue++; }
      else if (tk.due === t) { dueToday.push(tk); consider(tk); }
      else { upcoming.push(tk); consider(tk); }
    }
  }
  upcoming.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const otherOpen = tasks.filter((tk) => tk.status !== "Done" && !(tk.due && tk.due >= t));
  otherOpen.sort((a, b) => {
    const aO = a.due && a.due < t ? 0 : 1;
    const bO = b.due && b.due < t ? 0 : 1;
    if (aO !== bO) return aO - bO;
    const da = a.due || "9999-99-99", db = b.due || "9999-99-99";
    return da < db ? -1 : da > db ? 1 : 0;
  });
  const project = projectId ? store.get("project", projectId) : null;
  const milestones = project?.milestones || [];
  const milestonesDone = milestones.filter((m) => milestoneDone(store, projectId, m)).length;
  return {
    total: tasks.length, open, done, overdue, completedToday,
    dueToday, upcoming, otherOpen, nearest,
    progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    milestonesTotal: milestones.length, milestonesDone,
  };
}

export function milestoneTasks(store, milestoneId) {
  return store.all("task").filter((t) => t.milestoneId === milestoneId);
}
// A milestone counts as done only once at least one task is linked AND every
// linked task is Done ("checked off when all linked tasks complete").
export function milestoneDone(store, projectId, milestone) {
  const linked = milestoneTasks(store, milestone.id);
  return linked.length > 0 && linked.every((t) => t.status === "Done");
}
export function milestoneMeta(store, milestone) {
  const linked = milestoneTasks(store, milestone.id);
  const doneCount = linked.filter((t) => t.status === "Done").length;
  return { linked: linked.length, doneCount, done: linked.length > 0 && doneCount === linked.length };
}

export function markTaskDone(store, task, done) {
  store.upsert("task", task.id, { status: done ? "Done" : "Active", completedAt: done ? Date.now() : null, autoBlocked: false });
  if (done) onTaskCompleted(store, store.get("task", task.id));
  else blockDependents(store, store.get("task", task.id));
}
export function linkTaskToMilestone(store, taskId, milestoneId) {
  store.upsert("task", taskId, { milestoneId: milestoneId || null });
}

export function addMilestone(store, projectId, name, due = "") {
  const p = store.get("project", projectId);
  if (!p) return null;
  const m = { id: uid(), name: String(name).trim(), due: due || "" };
  store.upsert("project", projectId, { milestones: [...(p.milestones || []), m] });
  return m;
}
export function updateMilestone(store, projectId, mid, patch) {
  const p = store.get("project", projectId);
  if (!p) return;
  store.upsert("project", projectId, { milestones: (p.milestones || []).map((m) => (m.id === mid ? Object.assign({}, m, patch) : m)) });
}
export function removeMilestone(store, projectId, mid) {
  const p = store.get("project", projectId);
  if (!p) return;
  store.upsert("project", projectId, { milestones: (p.milestones || []).filter((m) => m.id !== mid) });
  for (const tk of milestoneTasks(store, mid)) linkTaskToMilestone(store, tk.id, null);
}

// Delete a project; mode "move" reassigns its tasks to Default (projectId null),
// mode "delete" removes the tasks too.
export function deleteProject(store, project, mode) {
  const tasks = store.all("task").filter((t) => t.projectId === project.id);
  for (const tk of tasks) {
    if (mode === "move") store.upsert("task", tk.id, { projectId: null });
    else store.remove("task", tk.id);
  }
  store.remove("project", project.id);
  return tasks.length;
}

// ── timeline (task 22) ───────────────────────────────────────────
// Pure data for the project timeline: a day-indexed range plus dated tasks &
// milestones (markers) and undated leftovers. Exported for tests.
export function timelineData(store, projectId) {
  const today = todayLocal();
  const tasks = projectTasks(store, projectId);
  const milestones = store.get("project", projectId)?.milestones || [];
  const datedTasks = tasks.filter((t) => t.due);
  const datedMs = milestones.filter((m) => m.due);
  let start = addDays(today, -6), end = addDays(today, 28);
  for (const t of datedTasks) {
    const s = addDays(t.due, -6); if (s < start) start = s;
    const e = addDays(t.due, 28); if (e > end) end = e;
  }
  for (const m of datedMs) {
    const s = addDays(m.due, -6); if (s < start) start = s;
    const e = addDays(m.due, 28); if (e > end) end = e;
  }
  const dayCount = dayDiff(start, end) + 1;
  const items = datedTasks.map((t) => ({
    kind: "task", id: t.id, title: t.title, due: t.due, idx: dayDiff(start, t.due),
    status: t.status, priority: t.priority || "low", done: t.status === "Done",
    overdue: t.due < today, isToday: t.due === today,
  }));
  const ms = datedMs.map((m) => ({
    kind: "ms", id: m.id, title: m.name, due: m.due, idx: dayDiff(start, m.due),
    done: milestoneDone(store, projectId, m), isToday: m.due === today,
  }));
  items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  ms.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const undatedTasks = tasks.filter((t) => !t.due);
  const undatedMs = milestones.filter((m) => !m.due);
  return {
    today, start, end, dayCount, items, ms, undatedTasks, undatedMs,
    counts: {
      dated: items.length + ms.length,
      overdue: items.filter((i) => !i.done && i.overdue).length + ms.filter((m) => !m.done && m.overdue).length,
      todayCount: items.filter((i) => i.isToday && !i.done).length + ms.filter((m) => m.isToday && !m.done).length,
      upcoming: items.filter((i) => !i.done && i.due > today).length + ms.filter((m) => !m.done && m.due > today).length,
      undated: undatedTasks.length + undatedMs.length,
    },
  };
}

// ── brainstorm (task 23) — idea cards stored on the project record ──
export function ideasByProject(store, projectId) { return store.get("project", projectId)?.brainstorm || []; }
export function addIdea(store, projectId, text, tags = []) {
  const p = store.get("project", projectId);
  if (!p) return null;
  const idea = { id: uid(), text: String(text).trim(), tags: (Array.isArray(tags) ? tags : []).map((s) => String(s).trim()).filter(Boolean), created: Date.now(), adopted: false, taskId: null };
  store.upsert("project", projectId, { brainstorm: [...(p.brainstorm || []), idea] });
  return idea;
}
export function removeIdea(store, projectId, ideaId) {
  const p = store.get("project", projectId);
  if (!p) return;
  store.upsert("project", projectId, { brainstorm: (p.brainstorm || []).filter((i) => i.id !== ideaId) });
}
// Turn an idea into a real task in this project; marks the idea adopted.
export function promoteIdea(store, projectId, ideaId) {
  const p = store.get("project", projectId);
  if (!p) return null;
  const idea = (p.brainstorm || []).find((i) => i.id === ideaId);
  if (!idea || idea.adopted) return null;
  const task = store.create("task", { title: idea.text, priority: "low", status: "Active", due: "", tags: idea.tags || [], notes: idea.text, projectId, milestoneId: null });
  store.upsert("project", projectId, { brainstorm: (p.brainstorm || []).map((i) => (i.id === ideaId ? Object.assign({}, i, { adopted: true, taskId: task.id }) : i)) });
  return task;
}

// ── active-tab memory (task 20: preserved per project across navigation) ──
const activeTabs = {};
export function resolveTab(projectId, param) { return param || activeTabs[projectId] || "overview"; }
function rememberTab(projectId, tab) { activeTabs[projectId] = tab; }

// ── hub (task 17) ────────────────────────────────────────────────
export function projectsHubHTML(store) {
  const projects = store.all("project");
  const groups = PROJECT_STATUSES
    .map((g) => ({ g, list: projects.filter((p) => p.status === g).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))) }))
    .filter((x) => x.list.length);
  const card = (p) => {
    const st = projectStats(store, p.id);
    return `<button class="proj-card" data-open="${p.id}" aria-label="Open ${esc(p.name)}">
      <div class="proj-bar" style="background:${p.color}"></div>
      <div class="proj-body">
        <div class="proj-name">${esc(p.name)}</div>
        <div class="proj-sub">${esc(p.status)}${p.targetDate ? " · target " + esc(p.targetDate) : ""}</div>
        ${p.description ? `<div class="proj-desc">${esc(p.description)}</div>` : ""}
        <div class="progress-row"><div class="progress-track"><div class="progress-fill" style="width:${st.progress}%"></div></div><span class="progress-pct">${st.progress}%</span></div>
        <div class="proj-chips">
          <span class="pchip">${st.open} open</span>
          ${st.overdue ? `<span class="pchip over">${st.overdue} overdue</span>` : ""}
          <span class="pchip">${st.milestonesDone}/${st.milestonesTotal} milestones</span>
        </div>
        <div class="proj-next">${ICONS.calendar}<span>${st.nearest ? "next: " + esc(st.nearest.title) + " · " + esc(st.nearest.due) : st.total ? "no upcoming dated tasks" : ""}</span></div>
      </div>
    </button>`;
  };
  const sections = groups.map(({ g, list }) => `
    <div class="proj-group">
      <div class="proj-group-h"><h2>${esc(g)}</h2><span class="cnt">${list.length}</span></div>
      <div class="proj-grid">${list.map(card).join("")}</div>
    </div>`).join("");
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.folder}</span> Projects</h1><p class="sub">${projects.length} project${projects.length === 1 ? "" : "s"} — grouped by status.</p></div>
        <button class="btn btn-primary" id="newProjectBtn">${ICONS.plus} New project</button>
      </div>
    </div>
    ${projects.length ? `<div class="proj-groups">${sections}</div>` : `
      <div class="proj-empty">
        ${ICONS.folder}
        <h2>No projects yet</h2>
        <p>Create your first project to start organizing tasks, milestones and plans.</p>
      </div>`}`;
}

export function wireProjectsHub(store, ctx) {
  $("#newProjectBtn")?.addEventListener("click", () => openProjectModal(store, {}));
  document.querySelectorAll(".proj-card").forEach((c) => c.addEventListener("click", () => ctx.navigate("projects", { id: c.dataset.open })));
}

// ── create/edit project modal (task 18) ──────────────────────────
export function openProjectModal(store, { project = null } = {}) {
  const isEdit = !!project;
  const name = project?.name || "";
  const color = project?.color || PROJECT_COLORS[0];
  const status = project?.status || "Active";
  const targetDate = project?.targetDate || "";
  const description = project?.description || "";
  const { el, close } = openModal(`
    <div class="modal-card proj-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "Edit project" : "New project"}">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>${isEdit ? "Edit project" : "New project"}</h3>
      <p class="modal-sub">${isEdit ? "Update the project details." : "Set up a project to organize its tasks, milestones and plans."}</p>
      <div class="field"><label for="pmNameInput">Name *</label><input type="text" id="pmNameInput" value="${esc(name)}" placeholder="e.g. Website redesign" maxlength="80"></div>
      <div class="field"><label>Color</label>
        <div class="swatches">${PROJECT_COLORS.map((c) => `<button class="swatch ${c === color ? "sel" : ""}" data-color="${c}" style="background:${c}" title="${c}" aria-label="Color ${c}"></button>`).join("")}</div>
      </div>
      <div class="field"><label for="pmStatusSelect">Status</label>
        <select id="pmStatusSelect">${PROJECT_STATUSES.map((s) => `<option ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="pmTargetInput">Target date</label><input type="date" id="pmTargetInput" value="${esc(targetDate)}"></div>
      <div class="field"><label for="pmDescInput">Description</label><textarea id="pmDescInput" placeholder="What is this project about?">${esc(description)}</textarea></div>
      <div class="modal-btns">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-save>${isEdit ? "Save changes" : "Create project"}</button>
      </div>
    </div>`);
  let selColor = color;
  el.querySelectorAll(".swatch").forEach((s) => s.addEventListener("click", () => { selColor = s.dataset.color; el.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("sel", x === s)); }));
  const save = () => {
    const nm = el.querySelector("#pmNameInput").value.trim();
    if (!nm) { toast("Please give the project a name", "error"); return; }
    store.upsert("project", project ? project.id : uid(), {
      name: nm,
      color: selColor,
      status: el.querySelector("#pmStatusSelect").value,
      targetDate: el.querySelector("#pmTargetInput").value || "",
      description: el.querySelector("#pmDescInput").value.trim(),
    });
    toast(isEdit ? "Project updated" : "Project created", "success");
    close();
  };
  el.querySelector("[data-save]").addEventListener("click", save);
  el.querySelector("[data-cancel]").addEventListener("click", close);
  el.querySelector("#pmNameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  setTimeout(() => el.querySelector("#pmNameInput")?.focus(), 30);
}

// ── delete project modal (task 19) ───────────────────────────────
export function deleteProjectModal(store, project, ctx) {
  const n = store.all("task").filter((t) => t.projectId === project.id).length;
  const { el, close } = openModal(`
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Delete project">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>Delete “${esc(project.name)}”?</h3>
      <p class="modal-sub">This project has ${n} task${n === 1 ? "" : "s"}. Choose what happens to them:</p>
      <div class="modal-btns stack">
        <button class="btn btn-primary" data-move>${ICONS.folder} Move ${n} task${n === 1 ? "" : "s"} to Default</button>
        <button class="btn btn-danger" data-delete>${ICONS.trash} Delete ${n} task${n === 1 ? "" : "s"} too</button>
        <button class="btn" data-cancel>Cancel</button>
      </div>
    </div>`);
  el.querySelector("[data-move]").addEventListener("click", () => {
    deleteProject(store, project, "move");
    toast("Project deleted — " + n + " task" + (n === 1 ? "" : "s") + " moved to Default", "success");
    close(); ctx.navigate("projects");
  });
  el.querySelector("[data-delete]").addEventListener("click", () => {
    deleteProject(store, project, "delete");
    toast("Project and " + n + " task" + (n === 1 ? "" : "s") + " deleted", "success");
    close(); ctx.navigate("projects");
  });
  el.querySelector("[data-cancel]").addEventListener("click", close);
}

// ── workspace (tasks 20 & 21) ────────────────────────────────────
const TABS = [["overview", "Overview"], ["tasks", "Tasks"], ["board", "Board"], ["timeline", "Timeline"], ["gantt", "Gantt"], ["notes", "Notes"], ["brainstorm", "Brainstorm"]];

export function projectWorkspaceHTML(store, project, tab) {
  const st = projectStats(store, project.id);
  const tabsHtml = TABS.map(([k, l]) => `<button class="tab ${k === tab ? "active" : ""}" data-tab="${k}">${l}</button>`).join("");
  const body = tab === "overview" ? overviewHTML(store, project, st)
    : tab === "tasks" ? projectTasksHTML(store, project)
    : tab === "board" ? boardHTML(store, project)
    : tab === "timeline" ? timelineHTML(store, project)
    : tab === "gantt" ? ganttHTML(store, project)
    : tab === "brainstorm" ? brainstormHTML(store, project)
    : tabComingHTML(tab);
  return `
    <a class="ws-back" href="#" data-back>${ICONS.arrowLeft} All projects</a>
    <div class="ws-head">
      <span class="dot" style="background:${project.color}"></span>
      <h1>${esc(project.name)}</h1>
      <span class="status-badge ${statusClass(project.status)}">${esc(project.status)}</span>
      <div class="ws-actions">
        <button class="btn" id="wsEditBtn">${ICONS.pencil} Edit</button>
        <button class="btn btn-danger" id="wsDeleteBtn">${ICONS.trash} Delete</button>
      </div>
    </div>
    <div class="tabs">${tabsHtml}</div>
    <div class="ws-body">${body}</div>`;
}

function tabComingHTML(tab) {
  const phase = PHASE_FOR_TAB[tab];
  const label = TABS.find(([k]) => k === tab)?.[1] || tab;
  return `<div class="coming" style="padding:44px 20px;">
    ${ICONS.grid}
    <h2>${label} lands in Phase ${phase}</h2>
    <p>This tab's full implementation arrives with its roadmap phase — Overview (above) is live now.</p>
  </div>`;
}

// ── timeline tab (task 22) ───────────────────────────────────────
const TL_COLW = 44, TL_LABELW = 214;
function timelineHTML(store, project) {
  const tl = timelineData(store, project.id);
  const c = tl.counts;
  const totalW = TL_LABELW + tl.dayCount * TL_COLW;
  const todayIdx = dayDiff(tl.start, tl.today);

  // month band + day cells
  const months = [];
  let i = 0;
  while (i < tl.dayCount) {
    const ym = addDays(tl.start, i).slice(0, 7);
    let j = i;
    while (j < tl.dayCount && addDays(tl.start, j).slice(0, 7) === ym) j++;
    const d0 = parseIso(addDays(tl.start, i));
    months.push(`<div class="tl-month" style="left:${i * TL_COLW}px;width:${(j - i) * TL_COLW}px">${d0.toLocaleDateString(undefined, { month: "short" })}${d0.getMonth() === 0 ? " " + d0.getFullYear() : ""}</div>`);
    i = j;
  }
  const days = [];
  for (let k = 0; k < tl.dayCount; k++) {
    const d = addDays(tl.start, k);
    const dow = new Date(parseIso(d)).getDay();
    const cls = ["tl-day"];
    if (k === todayIdx) cls.push("today");
    if (dow === 0 || dow === 6) cls.push("wknd");
    days.push(`<div class="${cls.join(" ")}" style="left:${k * TL_COLW}px"><span class="dow">${formatWeekday(d)}</span><span class="dom">${Number(d.slice(8, 10))}</span></div>`);
  }
  // weekend background stripes across the rows area
  const wkndBands = [];
  for (let k = 0; k < tl.dayCount; k++) {
    const dow = new Date(parseIso(addDays(tl.start, k))).getDay();
    if (dow === 6) wkndBands.push(`<div class="tl-wknd" style="left:${TL_LABELW + k * TL_COLW}px;width:${2 * TL_COLW}px"></div>`);
  }

  const rows = [];
  const all = [...tl.items, ...tl.ms];
  all.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  for (const it of all) {
    const left = it.idx * TL_COLW;
    const tip = `${it.title} · ${it.due}${it.done ? " · done" : it.overdue ? " · overdue" : ""}`;
    const label = it.kind === "ms"
      ? `<span class="tl-flag">${ICONS.flag}</span>`
      : `<span class="tdot" style="background:${TASK_STATUS_COLOR[it.status] || "#22d3ee"}"></span>`;
    const marker = it.kind === "ms"
      ? `<div class="tl-ms ${it.done ? "done" : ""}" style="left:${left}px" title="${esc(tip)}">${it.done ? ICONS.check : ""}<span class="nm">${esc(it.title)}</span><span class="due">${formatDay(it.due)}</span></div>`
      : `<div class="tl-pill ${it.done ? "done" : ""} pri-${it.priority}" style="left:${left}px" title="${esc(tip)}"><span class="nm">${esc(it.title)}</span><span class="due">${formatDay(it.due)}</span></div>`;
    rows.push(`<div class="tl-row">
      <div class="tl-label">${label}<span class="nm">${esc(it.title)}</span>${it.kind === "ms" ? `<span class="ms-badge">MS</span>` : ""}</div>
      <div class="tl-band" style="width:${tl.dayCount * TL_COLW}px">${marker}</div>
    </div>`);
  }

  const undated = [...tl.undatedTasks.map((t) => ({ name: t.title, done: t.status === "Done", tag: "task" })), ...tl.undatedMs.map((m) => ({ name: m.name, done: m.done, tag: "milestone" }))];
  const undatedHTML = undated.length
    ? `<div class="tl-undated"><h3>Undated</h3><div class="tl-undated-list">${undated.map((u) => `<span class="tl-undated-chip ${u.done ? "done" : ""}">${u.tag === "milestone" ? ICONS.flag : ""} ${esc(u.name)}</span>`).join("")}</div></div>`
    : "";

  const empty = all.length === 0
    ? `<div class="proj-empty" style="margin:14px 0;">${ICONS.calendar}<h2>Nothing on the timeline yet</h2><p>Give tasks or milestones a due date and they'll appear on the timeline here.</p></div>`
    : "";

  return `
    <div class="tl-chips">
      <span class="pchip">${c.dated} dated</span>
      ${c.overdue ? `<span class="pchip over">${c.overdue} overdue</span>` : ""}
      ${c.todayCount ? `<span class="pchip due">${c.todayCount} due today</span>` : ""}
      ${c.upcoming ? `<span class="pchip">${c.upcoming} upcoming</span>` : ""}
      ${c.undated ? `<span class="pchip">${c.undated} undated</span>` : ""}
    </div>
    ${empty}
    ${all.length ? `<div class="tl-scroll">
      <div class="tl-head" style="width:${totalW}px">
        <div class="tl-corner">${ICONS.calendar} <span>Project timeline</span></div>
        <div class="tl-months" style="width:${tl.dayCount * TL_COLW}px">${months.join("")}</div>
        <div class="tl-days" style="width:${tl.dayCount * TL_COLW}px">${days.join("")}</div>
      </div>
      <div class="tl-rows" style="width:${totalW}px">
        ${wkndBands.join("")}
        <div class="tl-todayline" style="left:${TL_LABELW + todayIdx * TL_COLW}px"><span>${formatDay(tl.today)}</span></div>
        ${rows.join("")}
      </div>
    </div>` : ""}
    ${undatedHTML}`;
}

// ── brainstorm tab (task 23) ─────────────────────────────────────
function brainstormHTML(store, project) {
  const ideas = ideasByProject(store, project.id);
  const open = ideas.filter((i) => !i.adopted);
  const adopted = ideas.filter((i) => i.adopted);
  const card = (idea, isAdopted) => {
    const tags = (idea.tags || []).map((t) => `<span class="bs-tag">${esc(t)}</span>`).join("");
    const created = idea.created ? new Date(idea.created).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    const taskName = isAdopted && idea.taskId ? (store.get("task", idea.taskId)?.title || "task") : "";
    return `<div class="bs-card ${isAdopted ? "adopted" : ""}" data-idea="${idea.id}">
      <div class="bs-body">
        <p class="bs-text">${esc(idea.text)}</p>
        ${tags ? `<div class="bs-tags">${tags}</div>` : ""}
        <div class="bs-meta">${created ? "added " + esc(created) : ""}${isAdopted ? ` · ${ICONS.check} turned into task` : ""}</div>
      </div>
      <div class="bs-actions">
        ${isAdopted
          ? `<span class="bs-tasknote">→ ${esc(taskName)}</span>`
          : `<button class="mini-btn bs-promote" data-promote="${idea.id}" title="Promote to task">${ICONS.plus}</button>`}
        <button class="mini-btn danger" data-idea-del="${idea.id}" title="Delete idea">${ICONS.trash}</button>
      </div>
    </div>`;
  };
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1 style="font-size:1.15rem;"><span class="vh-ico">${ICONS.lightbulb}</span> Brainstorm</h1><p class="sub">${open.length} open idea${open.length === 1 ? "" : "s"}${adopted.length ? " · " + adopted.length + " adopted" : ""} — capture loose ideas, then promote the good ones to tasks.</p></div>
      </div>
    </div>
    <div class="bs-add">
      <input type="text" id="bsTextInput" placeholder="Capture an idea…" maxlength="240">
      <input type="text" id="bsTagsInput" placeholder="tags, comma, separated" maxlength="120">
      <button class="btn btn-primary" id="bsAddBtn">${ICONS.plus} Add idea</button>
    </div>
    ${ideas.length ? `<div class="bs-grid">
      ${open.map((i) => card(i, false)).join("")}
      ${adopted.map((i) => card(i, true)).join("")}
    </div>` : `<div class="proj-empty" style="margin-top:14px;">${ICONS.lightbulb}<h2>No ideas yet</h2><p>Jot down rough thoughts here — later, promote them into real tasks.</p></div>`}`;
}

// ── workspace tasks tab (hosts the task editor — task 27) ───────
function wsMilestoneName(store, mid) {
  if (!mid) return "";
  for (const p of store.all("project")) {
    const m = (p.milestones || []).find((x) => x.id === mid);
    if (m) return m.name;
  }
  return "";
}
function projectTasksHTML(store, project) {
  const t = todayLocal();
  const tasks = projectTasks(store, project.id).sort((a, b) => {
    const aD = a.status === "Done" ? 1 : 0, bD = b.status === "Done" ? 1 : 0;
    if (aD !== bD) return aD - bD;
    const da = a.due || "9999-99-99", db = b.due || "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
  const open = tasks.filter((x) => x.status !== "Done").length;
  const row = (tk) => {
    const done = tk.status === "Done";
    const hl = dueHighlight(tk.due, done);
    const subs = subtaskStats(tk);
    const effStatus = !done && isBlocked(store, tk) ? "Blocked" : (tk.status || "Active");
    return `<div class="tv-row ${done ? "done" : ""}${hl.over ? " row-over" : ""}${hl.today ? " row-today" : ""}" data-tid="${tk.id}">
      <button class="mini-btn tv-done ${done ? "on" : ""}" data-wt-done="${tk.id}" title="${done ? "Mark open" : "Mark done"}">${ICONS.check}</button>
      <span class="tv-title" data-wt-edit="${tk.id}" title="Edit task">${esc(tk.title)}</span>
      <button class="mini-btn tv-edit" data-wt-edit="${tk.id}" title="Edit task">${ICONS.pencil}</button>
      <span class="pri ${tk.priority || "low"}">${esc(tk.priority || "low")}</span>
      <span class="tv-status st-${effStatus}">${esc(effStatus)}</span>
      ${tk.due ? `<span class="due-tag ${hl.over ? "over" : hl.today ? "today" : ""}">${esc(tk.due)}</span>` : `<span class="due-tag">—</span>`}
      ${tk.milestoneId ? `<span class="tv-ms">${ICONS.flag} ${esc(wsMilestoneName(store, tk.milestoneId))}</span>` : ""}
      ${subs.total ? `<span class="tv-subs">${ICONS.checkSquare} ${subs.done}/${subs.total}</span>` : ""}
      ${taskMetaChips(store, tk)}
      <button class="mini-btn danger tv-del" data-wt-del="${tk.id}" title="Delete task">${ICONS.trash}</button>
    </div>`;
  };
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1 style="font-size:1.15rem;"><span class="vh-ico">${ICONS.check}</span> Tasks</h1><p class="sub">${tasks.length} task${tasks.length === 1 ? "" : "s"} · ${open} open in this project</p></div>
        <button class="btn btn-primary" id="wtAddBtn">${ICONS.plus} New task</button>
      </div>
    </div>
    <div class="tv-list">${tasks.length ? tasks.map(row).join("") : `<div class="proj-empty" style="margin-top:6px;">${ICONS.check}<h2>No tasks yet</h2><p>Add one with “New task” — or capture quickly from the Overview tab.</p></div>`}</div>`;
}

// ── kanban board tab (task 29) ──────────────────────────────────
function boardHTML(store, project) {
  const cols = boardColumns(store, project.id);
  const card = (tk) => {
    const done = tk.status === "Done";
    const hl = dueHighlight(tk.due, done);
    const subs = subtaskStats(tk);
    const bar = subs.total ? `<div class="kb-subs"><span>${ICONS.checkSquare} ${subs.done}/${subs.total}</span><div class="kb-subbar"><i style="width:${subs.total ? Math.round((subs.done / subs.total) * 100) : 0}%"></i></div></div>` : "";
    return `<div class="kb-card ${done ? "done" : ""}${hl.over ? " over" : ""}${hl.today ? " today" : ""}" draggable="true" data-card="${tk.id}" title="Drag to another column, or click to edit">
      <div class="kb-card-top">
        <span class="pri ${tk.priority || "low"}">${esc(tk.priority || "low")}</span>
        ${tk.due ? `<span class="due-tag ${hl.over ? "over" : hl.today ? "today" : ""}">${formatDay(tk.due)}</span>` : ""}
      </div>
      <div class="kb-title" data-card-open="${tk.id}">${esc(tk.title)}</div>
      ${bar}
      ${taskMetaChips(store, tk)}
      <div class="kb-card-foot">
        <button class="mini-btn" data-card-move="-1" title="Move to previous column">${ICONS.arrowLeft}</button>
        <button class="mini-btn" data-card-move="1" title="Move to next column">${ICONS.arrowRight}</button>
      </div>
    </div>`;
  };
  const col = (c) => `
    <div class="kb-col" data-status="${c.status}">
      <div class="kb-head">
        <span class="kb-dot" style="background:${TASK_STATUS_COLOR[c.status] || "#22d3ee"}"></span>
        <span class="kb-name">${c.status}</span>
        <span class="kb-count">${c.tasks.length}</span>
        <button class="mini-btn kb-add" data-kb-add="${c.status}" title="Add task to ${c.status}">${ICONS.plus}</button>
      </div>
      <div class="kb-body">${c.tasks.length ? c.tasks.map(card).join("") : `<div class="kb-empty">Drop a card here</div>`}</div>
    </div>`;
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1 style="font-size:1.15rem;"><span class="vh-ico">${ICONS.grid}</span> Board</h1><p class="sub">Drag cards between columns to change status.</p></div>
        <button class="btn btn-primary" id="kbAddBtn">${ICONS.plus} New task</button>
      </div>
    </div>
    <div class="kb-board">${cols.map(col).join("")}</div>`;
}

function overviewHTML(store, project, st) {
  const t = todayLocal();
  const taskRow = (tk) => {
    const done = tk.status === "Done";
    const hl = dueHighlight(tk.due, done);
    return `<div class="task-row ${done ? "done" : ""}${hl.over ? " row-over" : ""}${hl.today ? " row-today" : ""}">
    <span class="tdot" style="background:${TASK_STATUS_COLOR[tk.status] || "#22d3ee"}"></span>
    <button class="mini-btn ${done ? "on" : ""}" data-done="${tk.id}" title="${done ? "Mark active" : "Mark done"}">${ICONS.check}</button>
    <span class="ttl ${done ? "done" : ""}">${esc(tk.title)}</span>
    <span class="pri ${tk.priority || "low"}">${esc(tk.priority || "low")}</span>
    ${tk.due ? `<span class="due-tag ${hl.over ? "over" : hl.today ? "today" : ""}">${esc(tk.due)}</span>` : ""}
  </div>`;
  };
  const listHTML = (list, empty) => list.length ? list.map(taskRow).join("") : `<div class="ws-empty">${empty}</div>`;

  const milestones = project.milestones || [];
  const msRows = milestones.map((m) => milestoneRow(store, project, m)).join("");

  return `
    <div class="ov-stats">
      <div class="ov-stat"><div class="n">${st.open}</div><div class="l">Open tasks</div></div>
      <div class="ov-stat"><div class="n ${st.overdue ? "danger" : ""}">${st.overdue}</div><div class="l">Overdue</div></div>
      <div class="ov-stat"><div class="n ok">${st.done}</div><div class="l">Done</div></div>
      <div class="ov-stat"><div class="n">${st.completedToday}</div><div class="l">Done today</div></div>
      <div class="ov-stat"><div class="n">${st.milestonesDone}/${st.milestonesTotal}</div><div class="l">Milestones</div></div>
      <div class="ov-stat"><div class="n">${st.progress}%</div><div class="l">Progress</div></div>
    </div>
    <div class="ov-cols">
      <div>
        <div class="ov-col">
          <h2>Quick add</h2>
          <p class="sub">Capture a task into this project.</p>
          <div class="quick-add">
            <input id="qaTitleInput" placeholder="Task title…" maxlength="120">
            <input type="date" id="qaDueInput" title="Due date (optional)">
            <select id="qaPriSelect"><option value="low">low</option><option value="med">med</option><option value="high">high</option></select>
            <button class="btn btn-primary" id="qaAddBtn">${ICONS.plus} Add</button>
          </div>
        </div>
        <div class="ov-col">
          <h2>Due today</h2>
          <p class="sub">Tasks due ${esc(t)} that aren't done yet.</p>
          ${listHTML(st.dueToday, "Nothing due today. 🎉")}
        </div>
        <div class="ov-col">
          <h2>Upcoming</h2>
          <p class="sub">Next dated tasks, soonest first.</p>
          ${listHTML(st.upcoming.slice(0, 8), "No upcoming dated tasks.")}
          ${st.upcoming.length > 8 ? `<div class="ws-empty muted" style="font-size:.78rem;">+${st.upcoming.length - 8} more…</div>` : ""}
        </div>
        <div class="ov-col">
          <h2>Overdue &amp; undated</h2>
          <p class="sub">Open tasks with no date or a past due date.</p>
          ${listHTML(st.otherOpen.slice(0, 8), "Nothing here.")}
          ${st.otherOpen.length > 8 ? `<div class="ws-empty muted" style="font-size:.78rem;">+${st.otherOpen.length - 8} more…</div>` : ""}
        </div>
      </div>
      <div>
        <div class="ov-col">
          <h2>Milestones</h2>
          <p class="sub">Checked off automatically once all linked tasks are done.</p>
          ${milestones.length ? `<div>${msRows}</div>` : `<div class="ws-empty">No milestones yet — add one below.</div>`}
          <div class="milestone-add">
            <input type="text" id="msNameInput" placeholder="Milestone name…" maxlength="80">
            <input type="date" id="msDueInput">
            <button class="btn" id="msAddBtn">${ICONS.plus} Add</button>
          </div>
        </div>
        <div class="ov-col">
          <h2>Project details</h2>
          ${project.description ? `<p class="muted" style="font-size:.85rem;">${esc(project.description)}</p>` : `<p class="muted" style="font-size:.85rem;">No description set.</p>`}
          <div class="proj-detail-line">${ICONS.calendar}<span>Target date: ${project.targetDate ? esc(project.targetDate) : "none"}</span></div>
          <div class="proj-detail-line">${ICONS.check}<span>Progress: ${st.progress}% — ${st.done}/${st.total} task${st.total === 1 ? "" : "s"} done</span></div>
          <div class="proj-detail-line">${ICONS.folder}<span>${st.open} open · ${st.overdue} overdue</span></div>
          <button class="btn" id="ovEditBtn" style="margin-top:10px;">${ICONS.pencil} Edit project</button>
        </div>
      </div>
    </div>`;
}

let openMilestone = null; // id of the milestone whose "link tasks" panel is open

function milestoneRow(store, project, m) {
  const meta = milestoneMeta(store, m);
  const editing = editingMilestone === m.id;
  const showLink = openMilestone === m.id;
  const linked = showLink ? projectTasks(store, project.id) : [];
  return `
    <div class="ms-row" data-ms="${m.id}">
      <span class="ms-check" style="${meta.done ? "" : "color:var(--muted); border-color:var(--border);"}">${meta.done ? ICONS.check : ""}</span>
      <div class="ms-info">
        ${editing ? `<input class="ms-edit" data-ms-edit value="${esc(m.name)}" maxlength="80">` : `<div class="nm">${esc(m.name)}</div>`}
        <div class="meta">${m.due ? "due " + esc(m.due) : "no due date"} · ${meta.linked} task${meta.linked === 1 ? "" : "s"}${meta.done ? " · done" : meta.linked ? " · " + meta.doneCount + "/" + meta.linked + " done" : " · not started"}</div>
      </div>
      <button class="mini-btn ${showLink ? "on" : ""}" data-ms-link title="Link tasks">${ICONS.link}</button>
      <button class="mini-btn" data-ms-rename title="Rename">${ICONS.pencil}</button>
      <button class="mini-btn danger" data-ms-del title="Delete">${ICONS.trash}</button>
    </div>
    ${showLink ? `<div class="ms-link">${linked.map((tk) => `<label class="ms-link-item"><input type="checkbox" data-link="${tk.id}" ${tk.milestoneId === m.id ? "checked" : ""}> <span>${esc(tk.title)}</span></label>`).join("") || `<span class="ws-empty">This project has no tasks to link yet.</span>`}</div>` : ""}`;
}

let editingMilestone = null; // id of the milestone being renamed inline

export function wireProjectWorkspace(store, project, ctx) {
  const applyBoardStatus = (tk, newStatus) => {
    const old = tk.status || "Active";
    if (old === newStatus) return;
    store.upsert("task", tk.id, { status: newStatus });
    const updated = store.get("task", tk.id);
    if (newStatus === "Done") onTaskCompleted(store, updated);
    else if (old === "Done") blockDependents(store, updated);
  };
  document.querySelector("[data-back]")?.addEventListener("click", (e) => { e.preventDefault(); ctx.navigate("projects"); });
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    rememberTab(project.id, b.dataset.tab);
    ctx.navigate("projects", { id: project.id, tab: b.dataset.tab });
  }));
  $("#wsEditBtn")?.addEventListener("click", () => openProjectModal(store, { project }));
  $("#wsDeleteBtn")?.addEventListener("click", () => deleteProjectModal(store, project, ctx));
  $("#ovEditBtn")?.addEventListener("click", () => openProjectModal(store, { project }));

  // quick-add (task 21)
  const doAdd = () => {
    const input = $("#qaTitleInput");
    const title = (input?.value || "").trim();
    if (!title) { toast("Enter a task title first", "error"); return; }
    store.create("task", { title, priority: $("#qaPriSelect")?.value || "low", status: "Active", due: $("#qaDueInput")?.value || "", tags: [], notes: "", projectId: project.id, milestoneId: null });
    toast("Task added", "success");
  };
  $("#qaAddBtn")?.addEventListener("click", doAdd);
  $("#qaTitleInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });

  // toggle task done
  document.querySelectorAll("[data-done]").forEach((b) => b.addEventListener("click", () => {
    const tk = store.get("task", b.dataset.done);
    if (tk) markTaskDone(store, tk, tk.status !== "Done");
  }));

  // milestones (task 21)
  $("#msAddBtn")?.addEventListener("click", () => {
    const nm = $("#msNameInput");
    const name = (nm?.value || "").trim();
    if (!name) { toast("Enter a milestone name", "error"); return; }
    addMilestone(store, project.id, name, $("#msDueInput")?.value || "");
    toast("Milestone added", "success");
  });
  $("#msNameInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#msAddBtn")?.click(); } });

  document.querySelectorAll("[data-ms-link]").forEach((b) => {
    b.addEventListener("click", () => {
      const mid = b.closest("[data-ms]").dataset.ms;
      openMilestone = openMilestone === mid ? null : mid;
      ctx.render();
    });
  });
  document.querySelectorAll("[data-link]").forEach((c) => c.addEventListener("change", () => {
    linkTaskToMilestone(store, c.dataset.link, c.checked ? c.closest(".ms-link")?.previousElementSibling?.dataset.ms || null : null);
  }));
  document.querySelectorAll("[data-ms-rename]").forEach((b) => b.addEventListener("click", () => {
    const mid = b.closest("[data-ms]").dataset.ms;
    editingMilestone = editingMilestone === mid ? null : mid;
    ctx.render();
    const inp = document.querySelector("[data-ms-edit]");
    if (inp) { inp.focus(); inp.select(); }
  }));
  document.querySelectorAll("[data-ms-edit]").forEach((inp) => {
    const mid = inp.closest("[data-ms]").dataset.ms;
    const commit = () => { const v = inp.value.trim(); if (v) updateMilestone(store, project.id, mid, { name: v }); editingMilestone = null; ctx.render(); };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { editingMilestone = null; ctx.render(); }
    });
    inp.addEventListener("blur", commit);
  });
  document.querySelectorAll("[data-ms-del]").forEach((b) => b.addEventListener("click", async () => {
    const mid = b.closest("[data-ms]").dataset.ms;
    const m = (project.milestones || []).find((x) => x.id === mid);
    if (!m) return;
    const sure = await confirmDialog({
      title: "Delete milestone?",
      message: "“" + m.name + "” will be removed. Its linked tasks stay in the project, just unlinked.",
      confirmText: "Delete milestone", danger: true,
    });
    if (!sure) return;
    removeMilestone(store, project.id, mid);
    toast("Milestone deleted", "success");
  }));

  // brainstorm (task 23)
  const doAddIdea = () => {
    const text = ($("#bsTextInput")?.value || "").trim();
    if (!text) { toast("Write an idea first", "error"); return; }
    const tags = ($("#bsTagsInput")?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    addIdea(store, project.id, text, tags);
    toast("Idea added", "success");
  };
  $("#bsAddBtn")?.addEventListener("click", doAddIdea);
  $("#bsTextInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAddIdea(); } });
  document.querySelectorAll("[data-promote]").forEach((b) => b.addEventListener("click", () => {
    const task = promoteIdea(store, project.id, b.dataset.promote);
    if (task) toast("Promoted — “" + task.title + "” is now a task", "success");
  }));
  document.querySelectorAll("[data-idea-del]").forEach((b) => b.addEventListener("click", async () => {
    const idea = (project.brainstorm || []).find((i) => i.id === b.dataset.ideaDel);
    if (!idea) return;
    const sure = await confirmDialog({ title: "Delete idea?", message: "“" + idea.text + "” will be removed.", confirmText: "Delete idea", danger: true });
    if (!sure) return;
    removeIdea(store, project.id, b.dataset.ideaDel);
    toast("Idea deleted", "success");
  }));

  // gantt tab (task 83)
  if ((ctx.tab || resolveTab(project.id)) === "gantt") wireGantt(store, project, ctx);

  // workspace tasks tab (task 27 — full task editor)
  $("#wtAddBtn")?.addEventListener("click", () => openTaskEditor(store, { defaults: { projectId: project.id } }));
  document.querySelectorAll("[data-wt-done]").forEach((b) => b.addEventListener("click", () => {
    const tk = store.get("task", b.dataset.wtDone);
    if (tk) markTaskDone(store, tk, tk.status !== "Done");
  }));
  document.querySelectorAll("[data-wt-edit]").forEach((b) => b.addEventListener("click", () => {
    const tk = store.get("task", b.dataset.wtEdit);
    if (tk) openTaskEditor(store, { task: tk });
  }));
  document.querySelectorAll("[data-wt-del]").forEach((b) => b.addEventListener("click", async () => {
    const tk = store.get("task", b.dataset.wtDel);
    if (!tk) return;
    const sure = await confirmDialog({ title: "Delete task?", message: "“" + tk.title + "” will be permanently removed.", confirmText: "Delete task", danger: true });
    if (!sure) return;
    store.remove("task", tk.id);
    toast("Task deleted", "success");
  }));

  // kanban board tab (task 29)
  $("#kbAddBtn")?.addEventListener("click", () => openTaskEditor(store, { defaults: { projectId: project.id } }));
  document.querySelectorAll("[data-kb-add]").forEach((b) => b.addEventListener("click", () =>
    openTaskEditor(store, { defaults: { projectId: project.id, status: b.dataset.kbAdd } })));
  document.querySelectorAll("[data-card-open]").forEach((b) => b.addEventListener("click", () => {
    const tk = store.get("task", b.dataset.cardOpen);
    if (tk) openTaskEditor(store, { task: tk });
  }));
  document.querySelectorAll("[data-card-move]").forEach((b) => b.addEventListener("click", () => {
    const card = b.closest("[data-card]");
    const tk = card && store.get("task", card.dataset.card);
    if (!tk) return;
    const cur = BOARD_STATUSES.indexOf(tk.status || "Active");
    const nxt = cur + Number(b.dataset.cardMove);
    if (nxt < 0 || nxt >= BOARD_STATUSES.length) return;
    applyBoardStatus(tk, BOARD_STATUSES[nxt]);
  }));
  // drag & drop between columns (touch users / accessibility: use the arrows)
  let dragId = null;
  document.querySelectorAll(".kb-card").forEach((c) => c.addEventListener("dragstart", () => { dragId = c.dataset.card; }));
  document.querySelectorAll(".kb-card").forEach((c) => c.addEventListener("dragend", () => { dragId = null; document.querySelectorAll(".kb-col").forEach((x) => x.classList.remove("over")); }));
  document.querySelectorAll(".kb-col").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("over");
      if (!dragId) return;
      const tk = store.get("task", dragId);
      if (tk && tk.status !== col.dataset.status) applyBoardStatus(tk, col.dataset.status);
    });
  });
}
