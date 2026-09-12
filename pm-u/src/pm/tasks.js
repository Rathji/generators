// src/tasks.js — Global tasks view with list-mode filters & sorting
// (Roadmap Phase 3: tasks 24, 25, 26).
//
//  - 24: global tasks view across all projects (with a "Default" group for
//        unassigned tasks), quick done-toggle and delete per row
//  - 25: filters — text search, status, priority, project, tag, date range
//  - 26: sorting — by due date / priority / title / created / project / status,
//        ascending or descending
//
// filterAndSortTasks() is pure (no DOM) and covered by runPhase3Tests().

import { $, esc, toast, confirmDialog } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, dueHighlight, msToIso } from "./dates.js";
import { markTaskDone } from "./projects.js";
import { openTaskEditor, subtaskStats } from "./taskEditor.js";
import { taskTimeMs, formatMs, startTracking, stopTracking, isBlocked, openDeps, recurrenceLabel } from "./taskTools.js";
import { tagColor } from "./tags.js";
import { h, clear } from "../framework/dom.js";
import { textInput, selectInput, actionButton, pmIcon } from "./formkit.js";

export const TASK_STATUSES = ["Active", "Doing", "Blocked", "Done"];
export const PRIORITIES = ["high", "med", "low"];
export const DATE_RANGES = [
  ["all", "Any date"], ["overdue", "Overdue"], ["today", "Due today"],
  ["upcoming", "Upcoming"], ["undated", "No date"], ["past", "Any past date"],
  ["doneToday", "Completed today"], ["doneAny", "Completed (any time)"],
];
export const SORT_KEYS = [
  ["due", "Due date"], ["priority", "Priority"], ["title", "Title"],
  ["created", "Created"], ["project", "Project"], ["status", "Status"],
];

// module-level view state — survives within-session navigation, resets on reload
export const tvState = { q: "", status: "all", priority: "all", project: "all", tag: "all", daterange: "all", sort: "due", dir: "asc" };
let tvTicker = null;

// Pure filter + sort. `state` mirrors tvState. Returns a new sorted array.
export function filterAndSortTasks(tasks, state) {
  const t = todayLocal();
  const q = (state.q || "").toLowerCase().trim();
  const pri = { high: 0, med: 1, low: 2 };
  let list = tasks.filter((tk) => {
    const st = tk.status || "Active";
    const prio = tk.priority || "low";
    const due = tk.due || "";
    if (state.status === "done" && st !== "Done") return false;
    if (state.status === "active" && st === "Done") return false;
    if (state.status === "open" && st === "Done") return false;
    if (state.priority !== "all" && prio !== state.priority) return false;
    if (state.project === "none") { if ((tk.projectId ?? null) !== null) return false; }
    else if (state.project && state.project !== "all" && tk.projectId !== state.project) return false;
    if (state.tag !== "all" && !(tk.tags || []).includes(state.tag)) return false;
    if (state.daterange !== "all") {
      if (state.daterange === "overdue") { if (!(due && due < t && st !== "Done")) return false; }
      else if (state.daterange === "today") { if (due !== t) return false; }
      else if (state.daterange === "upcoming") { if (!(due && due > t)) return false; }
      else if (state.daterange === "undated") { if (due) return false; }
      else if (state.daterange === "past") { if (!(due && due < t)) return false; }
      else if (state.daterange === "doneToday") { if (!tk.completedAt || msToIso(tk.completedAt) !== t) return false; }
      else if (state.daterange === "doneAny") { if (!tk.completedAt) return false; }
    }
    if (q) {
      const hay = (((tk.title || "") + " " + (tk.notes || "") + " " + (tk.tags || []).join(" "))).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const dir = state.dir === "desc" ? -1 : 1;
  const key = state.sort || "due";
  list.sort((a, b) => {
    let r = 0;
    if (key === "due") r = ((a.due || "9999-99-99") < (b.due || "9999-99-99")) ? -1 : ((a.due || "9999-99-99") > (b.due || "9999-99-99")) ? 1 : 0;
    else if (key === "priority") r = ((pri[a.priority || "low"]) ?? 2) - ((pri[b.priority || "low"]) ?? 2);
    else if (key === "title") r = String(a.title || "").localeCompare(String(b.title || ""));
    else if (key === "created") r = (a.created || 0) - (b.created || 0);
    else if (key === "project") r = String(a.projectId || "").localeCompare(String(b.projectId || ""));
    else if (key === "status") r = String(a.status || "").localeCompare(String(b.status || ""));
    if (r === 0) r = String(a.title || "").localeCompare(String(b.title || ""));
    return r * dir;
  });
  return list;
}

// Completed-today tracking (Roadmap task 31) — pure summary used by the stats strip.
export function tvStats(store) {
  const t = todayLocal();
  const all = store.all("task");
  let open = 0, overdue = 0, dueToday = 0, doneToday = 0;
  for (const tk of all) {
    const done = tk.status === "Done";
    if (done) {
      if (tk.completedAt && msToIso(tk.completedAt) === t) doneToday++;
    } else {
      open++;
      if (tk.due && tk.due < t) overdue++;
      if (tk.due === t) dueToday++;
    }
  }
  return { open, overdue, dueToday, doneToday, total: all.length };
}

function statsStripHTML(store) {
  const s = tvStats(store);
  const cur = tvState.daterange;
  const chip = (key, cls, label, n) => `<button class="ts-chip ${cls}${cur === key ? " on" : ""}" data-ts-range="${key}">${label} <b>${n}</b></button>`;
  return `<div class="tv-stats">
    ${chip("all", "", "Open", s.open)}
    ${chip("overdue", "over", "Overdue", s.overdue)}
    ${chip("today", "due", "Due today", s.dueToday)}
    ${chip("doneToday", "ok", "Completed today", s.doneToday)}
  </div>`;
}

// ── view ─────────────────────────────────────────────────────────
function projectById(store) {
  const m = new Map();
  for (const p of store.all("project")) m.set(p.id, p);
  return m;
}
function projName(pmap, id) { return id && pmap.get(id) ? pmap.get(id).name : "Default"; }
function projColor(pmap, id) { return id && pmap.get(id) ? pmap.get(id).color : "#64748b"; }

function dueTagCls(due, done) {
  if (done || !due) return "";
  const t = todayLocal();
  if (due < t) return "over";
  if (due === t) return "today";
  return "";
}

function taskRowHTML(store, pmap, tk) {
  const done = tk.status === "Done";
  const blocked = !done && isBlocked(store, tk);
  const effStatus = blocked ? "Blocked" : (tk.status || "Active");
  const blockedN = blocked ? openDeps(store, tk).length : 0;
  const hl = dueHighlight(tk.due, done);
  const tags = (tk.tags || []).map((g) => {
    const c = tagColor(store, g);
    return `<span class="tv-tag${c ? " tv-tag-c" : ""}"${c ? ` style="--tcol:${c}"` : ""}>${esc(g)}</span>`;
  }).join("");
  const ms = tk.milestoneId ? `<span class="tv-ms">${ICONS.flag} ${esc(msName(store, tk.milestoneId))}</span>` : "";
  const subs = subtaskStats(tk);
  const subChip = subs.total ? `<span class="tv-subs">${ICONS.checkSquare} ${subs.done}/${subs.total}</span>` : "";
  const tracking = tk.tracking;
  const tm = taskTimeMs(tk);
  const timeChip = `<button class="mini-btn tv-time ${tracking ? "on" : ""}" data-tv-time="${tk.id}" title="${tracking ? "Stop timer" : "Start a timer for this task"} · ${tm ? formatMs(tm) + " logged" : "no time logged yet"}">${ICONS.clock} ${tracking ? "live" : formatMs(tm)}</button>`;
  const blockedChip = blocked ? `<span class="tv-blocked" title="Waiting on ${blockedN} open task${blockedN === 1 ? "" : "s"}">${ICONS.link2} ${blockedN}</span>` : "";
  const recChip = tk.recurrence ? `<span class="tv-recur" title="${esc(recurrenceLabel(tk.recurrence))}">${ICONS.repeat}</span>` : "";
  return `<div class="tv-row ${done ? "done" : ""}${hl.over ? " row-over" : ""}${hl.today ? " row-today" : ""}" data-tid="${tk.id}">
    <button class="mini-btn tv-done ${done ? "on" : ""}" data-tv-done="${tk.id}" title="${done ? "Mark open" : "Mark done"}">${ICONS.check}</button>
    <span class="tv-title" data-tv-edit="${tk.id}" title="Edit task">${esc(tk.title)}${done ? `<span class="tv-status-label">done</span>` : ""}</span>
    <button class="mini-btn tv-edit" data-tv-edit="${tk.id}" title="Edit task">${ICONS.pencil}</button>
    <span class="pri ${tk.priority || "low"}">${esc(tk.priority || "low")}</span>
    <span class="tv-status st-${effStatus}">${esc(effStatus)}</span>
    ${tk.due ? `<span class="due-tag ${dueTagCls(tk.due, done)}">${esc(tk.due)}</span>` : `<span class="due-tag">—</span>`}
    <span class="tv-proj"><span class="tv-dot" style="background:${projColor(pmap, tk.projectId)}"></span>${esc(projName(pmap, tk.projectId))}</span>
    ${tags ? `<span class="tv-tags">${tags}</span>` : ""}
    ${ms}
    ${blockedChip}
    ${recChip}
    ${subChip}
    ${timeChip}
    <button class="mini-btn danger tv-del" data-tv-del="${tk.id}" title="Delete task">${ICONS.trash}</button>
  </div>`;
}

function msName(store, id) {
  for (const p of store.all("project")) {
    const m = (p.milestones || []).find((x) => x.id === id);
    if (m) return m.name;
  }
  return "";
}

export function tasksViewHTML(store) {
  const pmap = projectById(store);
  const all = store.all("task");
  const shown = filterAndSortTasks(all, tvState);
  const openCount = all.filter((t) => t.status !== "Done").length;
  const rows = shown.map((tk) => taskRowHTML(store, pmap, tk)).join("") ||
    `<div class="ws-empty" style="padding:26px 0;text-align:center;">No tasks match these filters.</div>`;
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.check}</span> Tasks</h1><p class="sub">${shown.length} of ${all.length} task${all.length === 1 ? "" : "s"} shown · ${openCount} open</p></div>
        <div class="ws-actions">
          <button class="btn" id="tvExportBtn" title="Export all tasks as CSV">${ICONS.download} Export CSV</button>
        </div>
      </div>
    </div>
    ${statsStripHTML(store)}
    <div class="tv-toolbar card" id="tvToolbar"></div>
    <div class="tv-list">${rows}</div>`;
}

// Filter / sort toolbar built from the template-u input suite (Phase 2, task 7).
function buildTasksToolbar(store, renderList) {
  const toolbar = $("#tvToolbar");
  if (!toolbar) return null;
  const pmap = projectById(store);
  const tags = [...new Set(store.all("task").flatMap((t) => t.tags || []))].sort();

  const search = textInput({ name: "search", label: "Search", value: tvState.q, placeholder: "Search title, notes, tags…", type: "search" });
  const status = selectInput({ name: "status", label: "Status", value: tvState.status, options: [["all", "All"], ["active", "Active"], ["done", "Done"]].map(([value, label]) => ({ value, label })) });
  const pri = selectInput({ name: "priority", label: "Priority", value: tvState.priority, options: [["all", "All"], ["high", "High"], ["med", "Med"], ["low", "Low"]].map(([value, label]) => ({ value, label })) });
  const proj = selectInput({
    name: "project",
    label: "Project",
    value: tvState.project,
    options: [{ value: "all", label: "All" }, { value: "none", label: "Default (no project)" }, ...[...pmap.values()].map((p) => ({ value: p.id, label: p.name }))],
  });
  const tag = selectInput({ name: "tag", label: "Tag", value: tvState.tag, options: [{ value: "all", label: "All tags" }, ...tags.map((t) => ({ value: t, label: t }))] });
  const dateR = selectInput({ name: "daterange", label: "When", value: tvState.daterange, options: DATE_RANGES.map(([value, label]) => ({ value, label })) });
  const sort = selectInput({ name: "sort", label: "Sort", value: tvState.sort, options: SORT_KEYS.map(([value, label]) => ({ value, label })) });
  const dirBtn = actionButton({
    variant: "secondary",
    icon: tvState.dir === "asc" ? "arrowUp" : "arrowDown",
    title: "Toggle sort direction (asc/desc)",
    onClick: () => {
      tvState.dir = tvState.dir === "asc" ? "desc" : "asc";
      renderList();
    },
  });
  dirBtn.id = "tvDirBtn";
  dirBtn.classList.add("tv-dir");

  toolbar.append(
    h("div", { class: "tv-search-row" }, search.el),
    h("div", { class: "tv-controls" }, status.el, pri.el, proj.el, tag.el, dateR.el, sort.el, dirBtn)
  );

  let debounce = null;
  search.input.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      tvState.q = e.target.value;
      renderList();
    }, 140);
  });
  const bindSel = (field, setter) => field.input.addEventListener("change", () => { setter(field.value); renderList(); });
  bindSel(status, (v) => { tvState.status = v; });
  bindSel(pri, (v) => { tvState.priority = v; });
  bindSel(proj, (v) => { tvState.project = v; });
  bindSel(tag, (v) => { tvState.tag = v; });
  bindSel(dateR, (v) => { tvState.daterange = v; });
  bindSel(sort, (v) => { tvState.sort = v; });

  return { search, status, pri, proj, tag, dateR, sort, dirBtn };
}

export function wireTasksView(store, ctx) {
  $("#tvExportBtn")?.addEventListener("click", () => {
    import("./exports.js").then((X) => { X.downloadTasksCSV(store); toast("Tasks exported as CSV — check your downloads", "success"); });
  });
  const bindRows = () => {
    document.querySelectorAll("[data-tv-done]").forEach((b) => b.addEventListener("click", () => {
      const tk = store.get("task", b.dataset.tvDone);
      if (tk) markTaskDone(store, tk, tk.status !== "Done");
    }));
    document.querySelectorAll("[data-tv-edit]").forEach((b) => b.addEventListener("click", () => {
      const tk = store.get("task", b.dataset.tvEdit);
      if (tk) openTaskEditor(store, { task: tk });
    }));
    document.querySelectorAll("[data-tv-del]").forEach((b) => b.addEventListener("click", async () => {
      const tk = store.get("task", b.dataset.tvDel);
      if (!tk) return;
      const sure = await confirmDialog({ title: "Delete task?", message: "“" + tk.title + "” will be permanently removed.", confirmText: "Delete task", danger: true });
      if (!sure) return;
      store.remove("task", tk.id);
      toast("Task deleted", "success");
    }));
    document.querySelectorAll("[data-tv-time]").forEach((b) => b.addEventListener("click", () => {
      const tk = store.get("task", b.dataset.tvTime);
      if (!tk) return;
      if (tk.tracking) { const r = stopTracking(store, tk.id); if (r) toast(formatMs(r.ms) + " logged", "success"); }
      else startTracking(store, tk.id);
    }));
  };

  let suite = null;
  const renderList = () => {
    const all = store.all("task");
    const pmap = projectById(store);
    const shown = filterAndSortTasks(all, tvState);
    const list = $(".tv-list");
    if (list) list.innerHTML = shown.map((tk) => taskRowHTML(store, pmap, tk)).join("") || `<div class="ws-empty" style="padding:26px 0;text-align:center;">No tasks match these filters.</div>`;
    const sub = document.querySelector(".view-head .sub");
    if (sub) sub.textContent = `${shown.length} of ${all.length} task${all.length === 1 ? "" : "s"} shown · ${all.filter((t) => t.status !== "Done").length} open`;
    if (suite && suite.dirBtn) {
      clear(suite.dirBtn);
      suite.dirBtn.appendChild(pmIcon(tvState.dir === "asc" ? "arrowUp" : "arrowDown", 15));
    }
    if (suite && suite.dateR) suite.dateR.value = tvState.daterange;
    document.querySelectorAll("[data-ts-range]").forEach((c) => c.classList.toggle("on", c.dataset.tsRange === tvState.daterange));
    bindRows();
  };

  suite = buildTasksToolbar(store, renderList);

  document.querySelectorAll("[data-ts-range]").forEach((c) => c.addEventListener("click", () => {
    tvState.daterange = c.dataset.tsRange;
    if (suite && suite.dateR) suite.dateR.value = tvState.daterange;
    renderList();
  }));

  bindRows();
  renderList();

  // live tick for running timers (cleared on every re-render so we never stack)
  if (tvTicker) { clearInterval(tvTicker); tvTicker = null; }
  tvTicker = setInterval(() => {
    document.querySelectorAll("[data-tv-time]").forEach((b) => {
      const tk = store.get("task", b.dataset.tvTime);
      if (tk && tk.tracking) b.innerHTML = `${ICONS.clock} ${formatMs(taskTimeMs(tk) + (Date.now() - tk.tracking.start))}`;
    });
  }, 1000);
}
