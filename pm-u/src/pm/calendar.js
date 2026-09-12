// src/calendar.js — Calendar view (Roadmap Phase 4: tasks 32–35).
//
//  32: month grid — Monday-first 6×7 grid, other-month days dimmed, today
//     ring, per-day task chips (open tasks, up to 3 + “+N more”)
//  33: day detail panel — tasks due on the selected day with done-toggle,
//     edit, priority + project, and a quick-add task box
//  34: 7-day week view — 7 columns with weekday/day/month headers, task
//     chips per day, today + selected column highlighting
//  35: prev/next/Today navigation + Month/Week mode toggle
//
// Pure helpers (monthGrid, weekDays, firstOfMonth, monthLabel, weekLabel,
// tasksByDue, eventsForDay, calState init) are covered by runPhase4Tests().

import { $, esc, toast, confirmDialog } from "./ui.js";
import { ICONS } from "./icons.js";
import { parseIso, isoDay, addDays, todayLocal, formatDay, dueHighlight } from "./dates.js";
import { markTaskDone } from "./projects.js";
import { openTaskEditor } from "./taskEditor.js";
import { eventsByDate, eventsForDay as dayEvents, openEventEditor } from "./events.js";

// ── pure date helpers (tested) ───────────────────────────────────
export function monthGrid(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const off = (first.getDay() + 6) % 7; // Monday-first: Mon=0
  const start = new Date(y, m - 1, 1 - off);
  const out = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(isoDay(d));
  }
  return out;
}
export function weekDays(iso) {
  const off = (parseIso(iso).getDay() + 6) % 7; // Monday-first
  return Array.from({ length: 7 }, (_, i) => addDays(iso, i - off));
}
export function firstOfMonth(iso) { return String(iso).slice(0, 8) + "01"; }
export function monthLabel(iso) {
  return parseIso(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
export function weekLabel(anchorIso) {
  const days = weekDays(anchorIso);
  const a = parseIso(days[0]), b = parseIso(days[6]);
  const sa = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sb = b.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return a.getFullYear() === b.getFullYear()
    ? sa + " – " + sb + ", " + b.getFullYear()
    : sa + ", " + a.getFullYear() + " – " + sb + ", " + b.getFullYear();
}

// ── data helpers (tested) ────────────────────────────────────────
// Map of due-day → tasks (both open and done) for the whole store.
export function tasksByDue(store) {
  const m = new Map();
  for (const tk of store.all("task")) {
    if (!tk.due) continue;
    if (!m.has(tk.due)) m.set(tk.due, []);
    m.get(tk.due).push(tk);
  }
  return m;
}
// Tasks due on one day, sorted: open first, then by priority, then title.
export function eventsForDay(store, iso) {
  const pri = { high: 0, med: 1, low: 2 };
  return store.all("task")
    .filter((t) => t.due === iso)
    .sort((a, b) => {
      const ad = a.status === "Done" ? 1 : 0, bd = b.status === "Done" ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const ap = pri[a.priority || "low"] ?? 2, bp = pri[b.priority || "low"] ?? 2;
      if (ap !== bp) return ap - bp;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
}

// ── view state (in-session) ──────────────────────────────────────
export const calState = { mode: "month", anchor: null, selected: null };
function ensureInit() {
  const t = todayLocal();
  if (!calState.anchor || !calState.selected) {
    calState.selected = t;
    calState.anchor = calState.mode === "week" ? weekDays(t)[0] : firstOfMonth(t);
  }
}

// ── rendering ────────────────────────────────────────────────────
function projectById(store) {
  const m = new Map();
  for (const p of store.all("project")) m.set(p.id, p);
  return m;
}
function projName(pmap, id) { return id && pmap.get(id) ? pmap.get(id).name : "Default"; }
function projColor(pmap, id) { return id && pmap.get(id) ? pmap.get(id).color : "#64748b"; }
function chipClass(tk) {
  const hl = dueHighlight(tk.due, tk.status === "Done");
  return "cal-chip" + (hl.over ? " over" : "") + (hl.today ? " today" : "");
}
function chipHTML(pmap, tk, iso) {
  return `<button class="${chipClass(tk)}" data-cal-task="${tk.id}" data-day="${iso}" title="${esc(tk.title)}">
    <span class="dot" style="background:${projColor(pmap, tk.projectId)}"></span><span class="nm">${esc(tk.title)}</span>
  </button>`;
}
function evtChipHTML(ev, iso) {
  return `<button class="cal-chip evt" data-cal-event="${ev.id}" data-day="${iso}" title="${esc(ev.title)}${ev.startTime ? " · " + esc(ev.startTime) : ""}" style="border-color:${ev.color || "#8b5cf6"}66">
    ${ICONS.clock}<span class="nm">${esc(ev.title)}</span>${ev.startTime ? `<span class="tm">${esc(ev.startTime)}</span>` : ""}
  </button>`;
}
function dayEventRowHTML(ev) {
  return `<div class="cal-row evt-row" data-event="${ev.id}">
    <span class="cal-dot" style="background:${ev.color || "#8b5cf6"}"></span>
    <span class="cal-etitle" data-cal-edit-event="${ev.id}" title="Edit event">${esc(ev.title)}</span>
    <span class="cal-etime">${esc(ev.startTime || "")}${ev.startTime && ev.endTime ? "–" + esc(ev.endTime) : ""}</span>
    <button class="mini-btn" data-cal-edit-event="${ev.id}" title="Edit event">${ICONS.pencil}</button>
    <button class="mini-btn danger" data-cal-del-event="${ev.id}" title="Delete event">${ICONS.trash}</button>
  </div>`;
}
function dayRowHTML(pmap, tk) {
  const done = tk.status === "Done";
  return `<div class="cal-row${done ? " done" : ""}">
    <button class="mini-btn cal-done${done ? " on" : ""}" data-cal-done="${tk.id}" title="${done ? "Mark open" : "Mark done"}">${ICONS.check}</button>
    <span class="cal-dot" style="background:${projColor(pmap, tk.projectId)}"></span>
    <span class="cal-rtitle" data-cal-edit="${tk.id}" title="Edit task">${esc(tk.title)}</span>
    <span class="pri ${tk.priority || "low"}">${esc(tk.priority || "low")}</span>
    <span class="cal-proj">${esc(projName(pmap, tk.projectId))}</span>
  </div>`;
}

export function calendarViewHTML(store) {
  ensureInit();
  const pmap = projectById(store);
  const t = todayLocal();
  const byDue = tasksByDue(store);
  const byEvents = eventsByDate(store);
  const openFor = (iso) => (byDue.get(iso) || []).filter((x) => x.status !== "Done");
  const eventsFor = (iso) => byEvents.get(iso) || [];
  const grid = calState.mode === "month" ? monthGrid(calState.anchor) : weekDays(calState.anchor);
  const label = calState.mode === "month" ? monthLabel(calState.anchor) : weekLabel(calState.anchor);
  const selTasks = eventsForDay(store, calState.selected);

  let gridHTML;
  if (calState.mode === "month") {
    const cells = grid.map((iso) => {
      const inMonth = iso.slice(0, 7) === calState.anchor.slice(0, 7);
      const open = openFor(iso);
      const evts = eventsFor(iso);
      const items = [...evts.map((ev) => evtChipHTML(ev, iso)), ...open.map((tk) => chipHTML(pmap, tk, iso))];
      const chips = items.slice(0, 3).join("");
      const more = items.length > 3 ? `<span class="cal-more">+${items.length - 3} more</span>` : "";
      const cls = ["cal-cell"]
        .concat(inMonth ? [] : ["other"])
        .concat(iso === t ? ["today"] : [])
        .concat(iso === calState.selected ? ["sel"] : [])
        .join(" ");
      return `<div class="${cls}" data-day="${iso}">
        <div class="cal-dnum">${Number(iso.slice(8))}</div>
        <div class="cal-chips">${chips}${more}</div>
      </div>`;
    }).join("");
    gridHTML = `<div class="cal-weekhead">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-wd">${d}</div>`).join("")}</div>
      <div class="cal-grid">${cells}</div>`;
  } else {
    const cols = grid.map((iso) => {
      const d = parseIso(iso);
      const open = openFor(iso);
      const evts = eventsFor(iso);
      const items = [...evts.map((ev) => evtChipHTML(ev, iso)), ...open.map((tk) => chipHTML(pmap, tk, iso))];
      const chips = items.join("");
      const cls = ["cal-wcol"]
        .concat(iso === t ? ["today"] : [])
        .concat(iso === calState.selected ? ["sel"] : [])
        .join(" ");
      return `<div class="${cls}" data-day="${iso}">
        <div class="cal-whead${iso === t ? " today" : ""}" data-day="${iso}">
          <div class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</div>
          <div class="dom">${d.getDate()}</div>
          <div class="mon">${d.toLocaleDateString(undefined, { month: "short" })}</div>
        </div>
        <div class="cal-wchips">${chips || `<span class="cal-empty-sm">—</span>`}</div>
      </div>`;
    }).join("");
    gridHTML = `<div class="cal-week">${cols}</div>`;
  }

  const selDate = parseIso(calState.selected);
  const selLabel = selDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const selEvents = dayEvents(store, calState.selected);
  const openSel = selTasks.filter((x) => x.status !== "Done");
  const doneSel = selTasks.filter((x) => x.status === "Done");
  const evRows = selEvents.map((ev) => dayEventRowHTML(ev)).join("");
  const rows = evRows
    + (evRows ? `<div class="cal-done-divider" style="padding-bottom:4px;">Events (${selEvents.length})</div>` : "")
    + openSel.map((tk) => dayRowHTML(pmap, tk)).join("")
    + (doneSel.length ? `<div class="cal-done-divider">Completed (${doneSel.length})</div>` + doneSel.map((tk) => dayRowHTML(pmap, tk)).join("") : "");
  const projOpts = `<option value="">Default</option>` + [...pmap.values()].map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");

  return `
    <div class="view-head">
      <h1><span class="vh-ico">${ICONS.calendar}</span> Calendar</h1>
      <p class="sub">Tasks placed on the date grid — click a day for details, or add one right from the side panel.</p>
    </div>
    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="btn" id="calPrevBtn" title="Previous ${calState.mode}">${ICONS.arrowLeft}</button>
        <button class="btn" id="calTodayBtn" title="Jump to today">Today</button>
        <button class="btn" id="calNextBtn" title="Next ${calState.mode}">${ICONS.arrowRight}</button>
        <span class="cal-label">${esc(label)}</span>
      </div>
      <div class="seg cal-mode">
        <button data-mode="month" class="${calState.mode === "month" ? "on" : ""}">Month</button>
        <button data-mode="week" class="${calState.mode === "week" ? "on" : ""}">Week</button>
      </div>
      <button class="btn" id="calExportBtn" title="Export events + dated tasks as an .ics file (importable into Google/Outlook/Apple Calendar)">${ICONS.download} Export .ics</button>
    </div>
    <div class="cal-body">
      <div class="cal-grid-wrap">${gridHTML}</div>
      <aside class="cal-day">
        <h3>${calState.selected === t ? ICONS.target + " " : ""}${esc(selLabel)}${calState.selected === t ? " · Today" : ""}</h3>
        <p class="cal-day-sub">${selEvents.length} event${selEvents.length === 1 ? "" : "s"} · ${openSel.length} open · ${doneSel.length} completed${selTasks.length ? " · " + selTasks.length + " total" : ""}</p>
        <div class="cal-day-list">${rows || `<div class="cal-empty">Nothing due ${esc(formatDay(calState.selected))}. Add a task or event below ↓</div>`}</div>
        <div class="cal-quick">
          <input id="calQInput" type="text" placeholder="Quick add task for this day…" maxlength="120">
          <select id="calQProj" title="Project">${projOpts}</select>
          <button class="btn" id="calQAdd" title="Add task">${ICONS.plus}</button>
          <button class="btn ghost" id="calQEvent" title="Add an event">${ICONS.clock} Event</button>
        </div>
      </aside>
    </div>`;
}

// ── wiring ───────────────────────────────────────────────────────
function shift(dir) {
  if (calState.mode === "month") {
    const [y, m] = calState.anchor.split("-").map(Number);
    calState.anchor = isoDay(new Date(y, m - 1 + dir, 1));
  } else {
    calState.anchor = addDays(calState.anchor, dir * 7);
  }
}
function goToday() {
  const t = todayLocal();
  calState.selected = t;
  calState.anchor = calState.mode === "week" ? weekDays(t)[0] : firstOfMonth(t);
}
function syncAnchorToSelected() {
  const sel = calState.selected || todayLocal();
  calState.anchor = calState.mode === "week" ? weekDays(sel)[0] : firstOfMonth(sel);
}

export function wireCalendarView(store, ctx) {
  const redraw = () => ctx.render && ctx.render();
  $("#calExportBtn")?.addEventListener("click", () => {
    import("./exports.js").then((X) => { X.downloadICS(store); toast("Calendar exported as .ics — import it into Google/Outlook/Apple Calendar", "success"); });
  });
  $("#calPrevBtn")?.addEventListener("click", () => { shift(-1); redraw(); });
  $("#calNextBtn")?.addEventListener("click", () => { shift(1); redraw(); });
  $("#calTodayBtn")?.addEventListener("click", () => { goToday(); redraw(); });
  document.querySelectorAll(".cal-mode button").forEach((b) => b.addEventListener("click", () => {
    calState.mode = b.dataset.mode;
    syncAnchorToSelected();
    redraw();
  }));
  // selecting a day (month cell or week column/header)
  document.querySelectorAll("[data-day]").forEach((cell) => cell.addEventListener("click", (e) => {
    if (e.target.closest("[data-cal-task]") || e.target.closest("[data-cal-event]")) return;
    calState.selected = cell.dataset.day;
    redraw();
  }));
  // chips open the task editor / event editor
  document.querySelectorAll("[data-cal-task]").forEach((chip) => chip.addEventListener("click", (e) => {
    e.stopPropagation();
    calState.selected = chip.dataset.day;
    const tk = store.get("task", chip.dataset.calTask);
    if (tk) openTaskEditor(store, { task: tk });
    redraw();
  }));
  document.querySelectorAll("[data-cal-event]").forEach((chip) => chip.addEventListener("click", (e) => {
    e.stopPropagation();
    calState.selected = chip.dataset.day;
    const ev = store.get("event", chip.dataset.calEvent);
    if (ev) openEventEditor(store, { event: ev });
    redraw();
  }));
  // day-panel event rows: edit + delete
  document.querySelectorAll("[data-cal-edit-event]").forEach((b) => b.addEventListener("click", () => {
    const ev = store.get("event", b.dataset.calEditEvent);
    if (ev) openEventEditor(store, { event: ev });
  }));
  document.querySelectorAll("[data-cal-del-event]").forEach((b) => b.addEventListener("click", async () => {
    const ev = store.get("event", b.dataset.calDelEvent);
    if (!ev) return;
    const sure = await confirmDialog({ title: "Delete event?", message: "“" + ev.title + "” will be removed from the calendar.", confirmText: "Delete event", danger: true });
    if (!sure) return;
    store.remove("event", ev.id);
    toast("Event deleted", "success");
  }));
  $("#calQEvent")?.addEventListener("click", () => openEventEditor(store, { defaults: { date: calState.selected } }));
  // day-panel rows: done-toggle + edit
  document.querySelectorAll("[data-cal-done]").forEach((b) => b.addEventListener("click", () => {
    const tk = store.get("task", b.dataset.calDone);
    if (tk) markTaskDone(store, tk, tk.status !== "Done");
  }));
  document.querySelectorAll("[data-cal-edit]").forEach((b) => b.addEventListener("click", () => {
    const tk = store.get("task", b.dataset.calEdit);
    if (tk) openTaskEditor(store, { task: tk });
  }));
  // quick-add task for the selected day
  const quickAdd = () => {
    const input = $("#calQInput");
    const title = (input?.value || "").trim();
    if (!title) return;
    const pid = $("#calQProj")?.value || "";
    store.create("task", { title, projectId: pid || null, status: "Active", priority: "low", due: calState.selected, tags: [], notes: "", milestoneId: null, subtasks: [] });
    input.value = "";
    toast("Task added for " + formatDay(calState.selected), "success");
  };
  $("#calQAdd")?.addEventListener("click", quickAdd);
  $("#calQInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") quickAdd(); });
}
