// src/gantt.js — Gantt chart tab (Phase 11, task 83).
//
// A real Gantt bar chart for a project's tasks + milestones: day-grid columns,
// planned bars (created → due, with project target date as the end when a task
// has no due date), an actual overlay for completed tasks (created → completed),
// milestone diamonds, dependency arrows between linked tasks, and a today line.
//
// Pure helpers (ganttRows / ganttSpan) are covered by runPhase11Tests.

import { $, esc } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, addDays, dayDiff, parseIso, msToIso, formatDay, formatWeekday } from "./dates.js";
import { isBlocked, depRecords } from "./taskTools.js";

const G_DAYW = 26, G_LABELW = 196, G_ROWH = 34, G_BARH = 16;

// ── pure data (tested) ───────────────────────────────────────────
// One row per task/milestone with planned [start,end], optional actual end,
// and the linked dependency ids (for arrows).
export function ganttRows(store, projectId) {
  const tasks = store.all("task").filter((t) => (t.projectId ?? null) === (projectId ?? null));
  const proj = store.get("project", projectId);
  const rows = [];
  for (const t of tasks) {
    const start = t.plannedStart || msToIso(t.created || Date.now());
    const end = t.due || proj?.targetDate || addDays(todayLocal(), 7);
    const done = t.status === "Done";
    const actualEnd = done && t.completedAt ? msToIso(t.completedAt) : null;
    rows.push({
      id: t.id, kind: "task", title: t.title, done, blocked: !done && isBlocked(store, t),
      priority: t.priority || "low", color: "#8b5cf6",
      start, end, actualEnd,
      deps: depRecords(store, t).filter((d) => (d.projectId ?? null) === (projectId ?? null)).map((d) => d.id),
    });
  }
  for (const m of (proj?.milestones || [])) {
    if (!m.due) continue;
    rows.push({ id: "m:" + m.id, kind: "milestone", title: m.name, due: m.due, color: "#22d3ee" });
  }
  rows.sort((a, b) => {
    const sa = a.kind === "milestone" ? a.due : a.start;
    const sb = b.kind === "milestone" ? b.due : b.start;
    return (sa < sb ? -1 : sa > sb ? 1 : String(a.title || "").localeCompare(String(b.title || "")));
  });
  return rows;
}

// [startIso, endIso] spanning every row + today (with a little padding).
export function ganttSpan(rows, project) {
  let start = todayLocal(), end = todayLocal();
  const consider = (d) => { if (d && d < start) start = d; if (d && d > end) end = d; };
  for (const r of rows) { consider(r.start); consider(r.end); consider(r.due); }
  if (project?.targetDate) consider(project.targetDate);
  consider(addDays(todayLocal(), -7));
  consider(addDays(todayLocal(), 14));
  return { start, end };
}

// ── view ─────────────────────────────────────────────────────────
export function ganttHTML(store, project) {
  const rows = ganttRows(store, project.id);
  const { start, end } = ganttSpan(rows, project);
  const dayCount = Math.max(1, dayDiff(start, end) + 1);
  const gridW = G_LABELW + dayCount * G_DAYW;
  const todayIdx = dayDiff(start, todayLocal());
  const x = (d) => G_LABELW + dayDiff(start, d) * G_DAYW;

  const dayHeads = [];
  for (let i = 0; i < dayCount; i++) {
    const d = addDays(start, i);
    dayHeads.push(`<div class="g-day" style="left:${i * G_DAYW}px"><b>${formatWeekday(d)[0]}</b><span>${d.slice(8, 10)}</span></div>`);
  }

  const bodyRows = rows.map((r, ri) => {
    const label = `<div class="g-label"><span class="g-ico">${r.kind === "milestone" ? ICONS.flag : ICONS.checkSquare}</span><span>${esc((r.title || "").slice(0, 34))}</span>${r.kind === "milestone" ? `<span class="g-due">${formatDay(r.due)}</span>` : r.done ? `<em>done</em>` : ""}</div>`;
    let bar = "";
    if (r.kind === "milestone") {
      const dx = x(r.due);
      bar = `<div class="g-milestone" style="left:${dx - 7}px;top:${(G_ROWH - 14) / 2}px" title="${esc(r.title)} · ${r.due}"></div>`;
    } else {
      const x0 = x(r.start), w = Math.max(6, (dayDiff(r.start, r.end) + 1) * G_DAYW);
      const cls = ["g-bar", r.done ? "done" : "", r.blocked ? "blocked" : ""].filter(Boolean).join(" ");
      const act = r.actualEnd ? `<div class="g-act" style="left:${x0}px;width:${Math.max(4, (dayDiff(r.start, r.actualEnd) + 1) * G_DAYW)}px" title="Completed ${r.actualEnd}"></div>` : "";
      bar = `<div class="g-bar-wrap" style="left:${x0}px;width:${w}px"><div class="${cls}" title="${esc(r.title)} · ${r.start} → ${r.end}${r.blocked ? " · blocked" : ""}"></div>${act}<span class="g-due">${formatDay(r.end)}</span></div>`;
    }
    return `<div class="g-row" data-gi="${ri}" style="height:${G_ROWH}px">${label}<div class="g-grid" style="width:${dayCount * G_DAYW}px"></div>${bar}</div>`;
  }).join("");

  // dependency arrows (SVG overlay)
  const arrows = [];
  for (const r of rows) {
    if (r.kind !== "task") continue;
    const ri = rows.indexOf(r);
    for (const depId of r.deps) {
      const dep = rows.find((x) => x.id === depId);
      if (!dep) continue;
      const di = rows.indexOf(dep);
      const x1 = x(dep.end) + 2;
      const x2 = x(r.start) - 2;
      if (x2 <= x1) continue;
      const y1 = di * G_ROWH + G_ROWH / 2;
      const y2 = ri * G_ROWH + G_ROWH / 2;
      const mx = (x1 + x2) / 2;
      arrows.push(`<path d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="var(--accent2)" stroke-width="1.5" marker-end="url(#gArrow)"/>`);
    }
  }
  const arrowsSvg = arrows.length
    ? `<svg class="g-arrows" style="width:${gridW}px;height:${rows.length * G_ROWH}px" aria-hidden="true"><defs><marker id="gArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="var(--accent2)"/></marker></defs>${arrows.join("")}</svg>`
    : "";

  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1 style="font-size:1.15rem;"><span class="vh-ico">${ICONS.grid}</span> Gantt</h1><p class="sub">${rows.length} row${rows.length === 1 ? "" : "s"} · planned bars, actual overlay, dependency arrows</p></div>
      </div>
    </div>
    ${rows.length ? `
    <div class="g-scroll card">
      <div class="g-table" style="width:${gridW}px">
        <div class="g-head">
          <div class="g-label" style="width:${G_LABELW}px">Task</div>
          <div class="g-due-head" style="left:${G_LABELW}px;width:${dayCount * G_DAYW}px">
            ${dayHeads.join("")}
            ${todayIdx >= 0 ? `<div class="g-today" style="left:${G_LABELW + todayIdx * G_DAYW}px"></div>` : ""}
          </div>
        </div>
        <div class="g-body">
          <div class="g-grid-rows" style="width:${dayCount * G_DAYW}px"></div>
          ${arrowsSvg}
          ${bodyRows}
        </div>
      </div>
    </div>
    <div class="g-legend card">
      <span><i class="g-lg planned"></i> Planned</span>
      <span><i class="g-lg actual"></i> Completed</span>
      <span><i class="g-lg blocked"></i> Blocked</span>
      <span><i class="g-lg milestone"></i> Milestone</span>
      <span><i class="g-lg today"></i> Today</span>
    </div>` : `<div class="proj-empty" style="margin-top:6px;">${ICONS.grid}<h2>Nothing to chart yet</h2><p>Add dated tasks or milestones to see the Gantt take shape.</p></div>`}`;
}

export function wireGantt(store, project, ctx) {
  document.querySelectorAll(".g-row[data-gi]").forEach((row) => {
    row.addEventListener("click", () => {
      const r = ganttRows(store, project.id)[Number(row.dataset.gi)];
      if (!r) return;
      if (r.kind === "milestone") return;
      const tk = store.get("task", r.id);
      if (tk) import("./taskEditor.js").then((TE) => TE.openTaskEditor(store, { task: tk }));
    });
  });
}
