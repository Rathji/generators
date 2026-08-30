// src/today.js — Today / daily planner view (Phase 11, task 84).
//
// Merges events, focus sessions and due tasks into one time-ordered day
// timeline: timed events + focus sessions sit on a 24h ruler (with a "now"
// line on today), and everything without a specific time (tasks due that day,
// untimed events) is collected below as an "all day / anytime" list, together
// with overdue items carried over from previous days.

import { $, esc, toast, openModal } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, parseIso, addDays, msToIso, isoDay, formatWeekday } from "./dates.js";
import { openEventEditor, eventsForDay, EVENT_COLORS } from "./events.js";
import { markTaskDone } from "./projects.js";
import { openTaskEditor } from "./taskEditor.js";

export const todayState = { date: todayLocal() };

// ── pure data (tested) ───────────────────────────────────────────
export function todayData(store, date) {
  const tasks = store.all("task").filter((t) => t.due === date && t.status !== "Done");
  const overdue = store.all("task")
    .filter((t) => t.status !== "Done" && t.due && t.due < date)
    .sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")));
  const focusLogs = store.all("focuslog").filter((f) => f && f.started && msToIso(f.started) === date);
  const events = eventsForDay(store, date);
  const timed = [];
  const anytime = [];
  for (const e of events) {
    if (e.startTime) timed.push({ kind: "event", rec: e, t: e.startTime, minutes: e.durationMin || 60 });
    else anytime.push({ kind: "event", rec: e });
  }
  for (const f of focusLogs) {
    const d = new Date(f.started);
    const t = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    timed.push({ kind: "focus", rec: f, t, minutes: Number(f.durationMin) || 25 });
  }
  timed.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.kind === "focus" ? 1 : -1));
  const tasksSorted = tasks.slice().sort((a, b) => {
    const pr = { high: 0, med: 1, low: 2 };
    const pa = pr[a.priority] ?? 1, pb = pr[b.priority] ?? 1;
    return pa - pb || String(a.title || "").localeCompare(String(b.title || ""));
  });
  return {
    date,
    isToday: date === todayLocal(),
    timed,                 // [{kind:"event"|"focus", rec, t:"HH:MM", minutes}]
    anytime,               // untimed events
    tasks: tasksSorted,    // tasks due that day
    overdue,               // overdue tasks carried in
    eventsCount: events.length,
    focusCount: focusLogs.length,
    focusMinutes: focusLogs.reduce((n, f) => n + (Number(f.durationMin) || 0), 0),
    tasksCount: tasks.length,
    overdueCount: overdue.length,
  };
}

function hourLabel(h) {
  const d = new Date(2026, 0, 1, h, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function minutesOf(t) {
  const [h, m] = String(t || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── view ─────────────────────────────────────────────────────────
export function todayViewHTML(store) {
  const d = todayData(store, todayState.date);
  const title = parseIso(d.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const dayLabel = d.isToday ? "Today" : formatWeekday(d.date);

  // timed items on the 24h ruler
  const timedHtml = d.timed.length
    ? d.timed.map((it) => {
        const start = minutesOf(it.t);
        const mins = Math.max(20, Math.round(Number(it.minutes) || 60));
        if (it.kind === "event") {
          const e = it.rec;
          const col = EVENT_COLORS.indexOf(e.color) >= 0 ? e.color : "#8b5cf6";
          return `<div class="td-item td-event" data-td-event="${e.id}" style="top:${start * 2}px;height:${mins * 2}px;--tdc:${col}" title="${esc(e.title)} · ${it.t}${e.notes ? " — " + esc(e.notes) : ""}">
            <span class="td-t">${esc(it.t)}</span><span class="td-name">${esc(e.title)}</span></div>`;
        }
        return `<div class="td-item td-focus" style="top:${start * 2}px;height:${mins * 2}px;" title="Focus session · ${mins} min${it.rec.taskId ? "" : ""}">
          <span class="td-t">${esc(it.t)}</span><span class="td-name">${ICONS.timer} Focus · ${mins} min</span></div>`;
      }).join("")
    : `<div class="td-none">Nothing scheduled at a specific time.</div>`;

  const hourRows = [];
  for (let h = 0; h < 24; h++) {
    hourRows.push(`<div class="td-hour" style="top:${h * 120}px" data-h="${h}"><span>${hourLabel(h)}</span></div>`);
  }

  const taskRow = (tk) => {
    const hl = tk.due && tk.due < todayLocal() ? " over" : "";
    return `<div class="td-task ${hl}">
      <button class="mini-btn" data-td-done="${tk.id}" title="Mark done">${ICONS.check}</button>
      <span class="td-task-title" data-td-edit="${tk.id}">${esc(tk.title)}</span>
      ${tk.due && tk.due < todayLocal() ? `<span class="td-overdue">overdue</span>` : ""}
      ${tk.priority === "high" ? `<span class="pri high">high</span>` : ""}
    </div>`;
  };

  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.timer}</span> ${esc(dayLabel)}</h1>
        <p class="sub">${esc(title)} · ${d.tasksCount} due · ${d.eventsCount} events · ${d.focusMinutes} focus min</p></div>
        <div class="td-nav">
          <button class="btn" id="tdPrev" title="Previous day">${ICONS.arrowLeft}</button>
          <button class="btn" id="tdToday" title="Jump to today">Today</button>
          <button class="btn" id="tdNext" title="Next day">${ICONS.arrowRight}</button>
        </div>
      </div>
    </div>
    <div class="td-layout">
      <div class="td-timeline card">
        <h3 style="margin:0 0 8px;">Timeline</h3>
        <div class="td-scale">
          <div class="td-inner">
            <div class="td-hours">${hourRows.join("")}</div>
            <div class="td-items">${d.isToday ? `<div class="td-now" style="top:${nowTopPx()}px" title="Now"></div>` : ""}${timedHtml}</div>
          </div>
        </div>
      </div>
      <div class="td-side">
        <div class="card">
          <h3 style="margin:0 0 8px;">${ICONS.inbox} All day · anytime</h3>
          ${d.overdue.length ? `<div class="td-group"><div class="td-group-label">Carried over (overdue)</div>${d.overdue.map(taskRow).join("")}</div>` : ""}
          <div class="td-group"><div class="td-group-label">Tasks due ${d.isToday ? "today" : esc(formatWeekday(d.date))}</div>${d.tasks.length ? d.tasks.map(taskRow).join("") : `<div class="td-none">No tasks due.</div>`}</div>
          ${d.anytime.length ? `<div class="td-group"><div class="td-group-label">Untimed events</div>${d.anytime.map((it) => `<div class="td-task"><button class="mini-btn" data-td-event="${it.rec.id}" title="Edit event">${ICONS.calendar}</button><span class="td-task-title" data-td-event="${it.rec.id}">${esc(it.rec.title)}</span></div>`).join("")}</div>` : ""}
        </div>
        <div class="card td-summary">
          <h3 style="margin:0 0 8px;">${ICONS.chart} Day summary</h3>
          <div class="td-sum-row"><span>Tasks due</span><b>${d.tasksCount}</b></div>
          <div class="td-sum-row"><span>Events</span><b>${d.eventsCount}</b></div>
          <div class="td-sum-row"><span>Focus sessions</span><b>${d.focusCount}</b></div>
          <div class="td-sum-row"><span>Focus minutes</span><b>${d.focusMinutes}</b></div>
        </div>
      </div>
    </div>`;
}

function nowTopPx() {
  const d = new Date();
  return ((d.getHours() * 60 + d.getMinutes()) * 2);
}

export function wireTodayView(store, ctx) {
  document.querySelectorAll("[data-td-event]").forEach((b) => b.addEventListener("click", () => {
    const e = store.get("event", b.dataset.tdEvent);
    if (e) openEventEditor(store, { event: e });
  }));
  document.querySelectorAll("[data-td-done]").forEach((b) => b.addEventListener("click", () => {
    const tk = store.get("task", b.dataset.tdDone);
    if (tk) markTaskDone(store, tk, tk.status !== "Done");
  }));
  document.querySelectorAll("[data-td-edit]").forEach((b) => b.addEventListener("click", () => {
    const tk = store.get("task", b.dataset.tdEdit);
    if (tk) openTaskEditor(store, { task: tk });
  }));
  const go = (d) => { todayState.date = d; ctx.render(); };
  $("#tdPrev")?.addEventListener("click", () => go(addDays(todayState.date, -1)));
  $("#tdNext")?.addEventListener("click", () => go(addDays(todayState.date, 1)));
  $("#tdToday")?.addEventListener("click", () => go(todayLocal()));

  // bring "now" (or 7am on other days) into view inside the scrollable timeline
  const scale = document.querySelector(".td-scale");
  if (scale) {
    const now = document.querySelector(".td-now");
    const target = now ? nowTopPx() : 7 * 120 + 60;
    scale.scrollTop = Math.max(0, target - 150);
  }
}
