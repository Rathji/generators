// src/portfolio.js — Portfolio view (Phase 11, task 85).
//
// Cross-project dashboard: progress bars for every project, a 14-day
// burn-down of the overdue-task count, and a capacity heat map of focus
// minutes per day. All pure data helpers are covered by runPhase11Tests.

import { $, esc } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, addDays, msToIso, formatWeekday } from "./dates.js";
import { milestoneDone } from "./projects.js";

// ── pure data (tested) ───────────────────────────────────────────
export function portfolioData(store) {
  const projects = store.all("project").map((p) => {
    const tasks = store.all("task").filter((t) => (t.projectId ?? null) === (p.id ?? null));
    const done = tasks.filter((t) => t.status === "Done").length;
    const open = tasks.length - done;
    const overdue = tasks.filter((t) => t.status !== "Done" && t.due && t.due < todayLocal()).length;
    const ms = (p.milestones || []).length;
    const msDone = (p.milestones || []).filter((m) => milestoneDone(store, p.id, m)).length;
    return {
      id: p.id, name: p.name || "Untitled", color: p.color || "#8b5cf6", status: p.status || "Active",
      total: tasks.length, done, open, overdue, ms, msDone,
      pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    };
  }).sort((a, b) => b.pct - a.pct || b.total - a.total);

  const allTasks = store.all("task");
  return {
    projects,
    overdueBurn: overdueBurnDown(store, 14),
    heat: focusHeat(store, 14),
    totalTasks: allTasks.length,
    doneTasks: allTasks.filter((t) => t.status === "Done").length,
  };
}

// Number of open tasks that were already overdue on each of the last N days.
export function overdueBurnDown(store, days = 14) {
  const today = todayLocal();
  const tasks = store.all("task");
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    let count = 0;
    for (const t of tasks) {
      if (!t.due || t.due >= day) continue;
      const doneDay = t.completedAt ? msToIso(t.completedAt) : null;
      if (!doneDay || doneDay > day) count++;
    }
    out.push({ day, count });
  }
  return out;
}

// Focus minutes per day for the last N days (0..N-1 oldest first).
export function focusHeat(store, days = 14) {
  const today = todayLocal();
  const logs = store.all("focuslog");
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const mins = logs
      .filter((f) => f && f.started && msToIso(f.started) === day)
      .reduce((n, f) => n + (Number(f.durationMin) || 0), 0);
    out.push({ day, mins });
  }
  return out;
}

// ── view ─────────────────────────────────────────────────────────
export function portfolioViewHTML(store) {
  const d = portfolioData(store);
  const maxBurn = Math.max(1, ...d.overdueBurn.map((b) => b.count));
  const maxHeat = Math.max(1, ...d.heat.map((h) => h.mins));

  const projCards = d.projects.length
    ? d.projects.map((p) => `
      <div class="pf-proj card" data-pf-proj="${p.id}">
        <div class="pf-proj-top">
          <span class="pf-dot" style="background:${p.color}"></span>
          <span class="pf-proj-name">${esc(p.name)}</span>
          <span class="status-badge ${p.status.replace(/\s+/g, "")}">${esc(p.status)}</span>
        </div>
        <div class="pf-bar"><i style="width:${p.pct}%;background:${p.color}"></i></div>
        <div class="pf-bar-label"><span>${p.pct}% complete</span><span>${p.done}/${p.total} tasks</span></div>
        <div class="pf-chips">
          <span class="pf-chip">${p.open} open</span>
          ${p.overdue ? `<span class="pf-chip warn">${p.overdue} overdue</span>` : ""}
          ${p.ms ? `<span class="pf-chip">${p.msDone}/${p.ms} milestones</span>` : ""}
        </div>
      </div>`).join("")
    : `<div class="proj-empty">${ICONS.briefcase}<h2>No projects yet</h2><p>Projects you create will show their progress here.</p></div>`;

  const burnBars = d.overdueBurn.map((b) => `
    <div class="pf-burn-col" title="${b.day} — ${b.count} overdue">
      <div class="pf-burn-bar" style="height:${b.count ? Math.max(6, (b.count / maxBurn) * 100) : 2}%"></div>
      <span class="pf-burn-n">${b.count}</span>
      <span class="pf-burn-day">${formatWeekday(b.day)[0]}</span>
    </div>`).join("");

  const heatCells = d.heat.map((h) => {
    const lvl = h.mins ? Math.min(4, 1 + Math.round((h.mins / maxHeat) * 3)) : 0;
    return `<div class="pf-heat-cell lvl${lvl}" title="${h.day} — ${h.mins} focus min"></div>`;
  }).join("");
  const heatDays = d.heat.map((h) => `<span class="pf-heat-day">${formatWeekday(h.day)[0]}</span>`).join("");

  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.chart}</span> Portfolio</h1>
        <p class="sub">${d.projects.length} project${d.projects.length === 1 ? "" : "s"} · ${d.doneTasks}/${d.totalTasks} tasks done across everything</p></div>
      </div>
    </div>
    <div class="pf-grid">
      <div class="card">
        <h3 style="margin:0 0 10px;">Projects</h3>
        <div class="pf-projs">${projCards}</div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 10px;">Overdue burn-down · last 14 days</h3>
        <div class="pf-burn">${burnBars}</div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 10px;">Focus capacity · last 14 days</h3>
        <div class="pf-heat">${heatCells}</div>
        <div class="pf-heat-days">${heatDays}</div>
        <p class="muted small">Cell intensity = focus minutes that day (${maxHeat} min max in range).</p>
      </div>
    </div>`;
}

export function wirePortfolioView(store, ctx) {
  document.querySelectorAll("[data-pf-proj]").forEach((c) => c.addEventListener("click", () => {
    const id = c.dataset.pfProj;
    if (id && store.get("project", id)) ctx.navigate("projects", { id });
  }));
}
