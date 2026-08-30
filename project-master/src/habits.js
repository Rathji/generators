// src/habits.js — Habits view (Roadmap Phase 7: tasks 51–56).
//
//  51: create habit — name + color (+ optional weekly check-in goal)
//  52: weekly day grid — the current Mon–Sun week, toggle any day
//  53: streak counter — current streak (consecutive days, alive until today
//     OR yesterday is checked but today isn't yet)
//  54: total check-ins — lifetime count of completed days
//  55: 84-day heat grid — the last 12 weeks rendered as a heat map
//  56: dashboard toggle — per-habit "show on dashboard" switch; the dashboard
//     shows a "Today's habits" strip when at least one habit is enabled
//
// Records: {type:"habit", id, name, color, icon, history:{day:true}, target,
//           showDashboard, created}
// Pure helpers (habitStats, weekDays, heatGrid) covered by runPhase7Tests().

import { $, esc, toast, confirmDialog, openModal } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, isoDay, addDays, parseIso, formatWeekday } from "./dates.js";
import { uid } from "./store.js";
import { promptModal } from "./checklists.js";

export const HABIT_COLORS = ["#8b5cf6", "#22d3ee", "#ec4899", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#14b8a6"];
export const HABIT_ICONS = ["zap", "check", "target", "timer", "sparkle", "clock", "flag", "chart"];

// Mon–Sun ISO days for the week containing `iso`.
export function habitWeek(iso) {
  const off = (parseIso(iso).getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(iso, i - off));
}

// The last 84 days as an array of ISO strings, oldest → newest.
export function heatGrid(today = todayLocal()) {
  const out = [];
  for (let i = 83; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

// Pure stats for one habit. today = "YYYY-MM-DD".
export function habitStats(h, today = todayLocal()) {
  const hist = h.history || {};
  const days = Object.keys(hist).filter((d) => hist[d]).sort();
  const total = days.length;
  const isOn = (d) => !!hist[d];
  // current streak: count back from today; if today unchecked but yesterday
  // checked, the streak is still alive (count starts from yesterday).
  let streak = 0;
  let cursor = isOn(today) ? today : addDays(today, -1);
  while (isOn(cursor)) { streak++; cursor = addDays(cursor, -1); }
  // best streak
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  const week = habitWeek(today);
  const thisWeek = week.filter((d) => isOn(d)).length;
  return { total, streak, best, thisWeek, checkedToday: isOn(today) };
}

export function toggleDay(store, id, iso) {
  const h = store.get("habit", id);
  if (!h) return;
  const hist = Object.assign({}, h.history || {});
  if (hist[iso]) delete hist[iso];
  else hist[iso] = true;
  store.upsert("habit", id, { history: hist });
  return !!hist[iso];
}

export function habitCardHTML(store, h, week) {
  const today = todayLocal();
  const s = habitStats(h, today);
  const cells = week.map((iso) => {
    const on = !!(h.history || {})[iso];
    const isToday = iso === today;
    return `<button class="hb-day${on ? " on" : ""}${isToday ? " today" : ""}" data-hb-day="${iso}" title="${iso}${on ? " · done" : ""}" style="${on ? `background:${h.color};border-color:${h.color}` : ""}">${isToday ? "·" : ""}</button>`;
  }).join("");
  return `
    <div class="hb-card" data-hbid="${h.id}" style="--hcolor:${h.color}">
      <div class="hb-head">
        <h3>${ICONS[h.icon || "zap"] || ""} ${esc(h.name)}</h3>
        <button class="mini-btn danger" data-hb-del="${h.id}" title="Delete habit">${ICONS.trash}</button>
      </div>
      <div class="hb-stats">
        <div class="hb-stat"><b>${s.streak}</b><span>day streak</span></div>
        <div class="hb-stat"><b>${s.best}</b><span>best</span></div>
        <div class="hb-stat"><b>${s.thisWeek}/7</b><span>this week</span></div>
        <div class="hb-stat"><b>${s.total}</b><span>check-ins</span></div>
      </div>
      <div class="hb-week">${cells}</div>
      <div class="hb-heat" title="Last 84 days">
        ${heatGrid(today).map((iso) => `<span class="heat-cell" data-heat="${iso}" style="background:${(h.history || {})[iso] ? h.color : ""}"></span>`).join("")}
      </div>
      <div class="hb-foot">
        <label class="hb-dash"><input type="checkbox" data-hb-dash="${h.id}" ${h.showDashboard ? "checked" : ""}> Show on dashboard</label>
      </div>
    </div>`;
}

export function habitsViewHTML(store) {
  const week = habitWeek(todayLocal());
  const cards = store.all("habit").map((h) => habitCardHTML(store, h, week)).join("") ||
    `<div class="proj-empty">${ICONS.zap}<h2>No habits yet</h2><p>Build a streak — start with something small.</p></div>`;
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.zap}</span> Habits</h1><p class="sub">This week · click a day to check it in</p></div>
        <button class="btn btn-primary" id="hbNewBtn">${ICONS.plus} New habit</button>
      </div>
    </div>
    <div class="hb-grid">${cards}</div>`;
}

export function newHabitModal(store, ctx) {
  const { el, close } = openModal(`
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="New habit">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>New habit</h3>
      <p class="modal-sub">Something you want to do (or avoid) regularly.</p>
      <div class="field"><label for="hbNameInput">Name *</label><input type="text" id="hbNameInput" placeholder="e.g. Read 20 pages, No sugar" maxlength="80"></div>
      <div class="field"><label>Icon</label>
        <div class="swatches">${HABIT_ICONS.map((k, i) => `<button class="swatch ico-swatch${i === 0 ? " sel" : ""}" data-icon="${k}" title="${k}">${ICONS[k]}</button>`).join("")}</div></div>
      <div class="field"><label>Color</label>
        <div class="swatches">${HABIT_COLORS.map((c, i) => `<button class="swatch${i === 0 ? " sel" : ""}" data-color="${c}" style="background:${c}" title="Color ${c}"></button>`).join("")}</div></div>
      <div class="modal-btns">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="hbCreateBtn">${ICONS.plus} Create</button>
      </div>
    </div>`);
  let color = HABIT_COLORS[0], icon = HABIT_ICONS[0];
  el.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => { color = b.dataset.color; el.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("sel", x === b)); }));
  el.querySelectorAll("[data-icon]").forEach((b) => b.addEventListener("click", () => { icon = b.dataset.icon; el.querySelectorAll("[data-icon]").forEach((x) => x.classList.toggle("sel", x === b)); }));
  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("#hbCreateBtn")?.addEventListener("click", () => {
    const name = (el.querySelector("#hbNameInput")?.value || "").trim();
    if (!name) { toast("Enter a habit name", "error"); return; }
    store.create("habit", { name, color, icon, history: {}, target: 0, showDashboard: false });
    toast("Habit created", "success");
    close();
    ctx.render();
  });
  setTimeout(() => { const t = el.querySelector("#hbNameInput"); if (t) t.focus(); }, 30);
  return { el, close };
}

export function wireHabitsView(store, ctx) {
  const redraw = () => ctx.render && ctx.render();
  $("#hbNewBtn")?.addEventListener("click", () => newHabitModal(store, { render: redraw }));
  document.querySelectorAll("[data-hb-day]").forEach((b) => b.addEventListener("click", () => {
    const id = b.closest(".hb-card").dataset.hbid;
    toggleDay(store, id, b.dataset.hbDay);
  }));
  document.querySelectorAll("[data-hb-dash]").forEach((b) => b.addEventListener("change", () => {
    const h = store.get("habit", b.dataset.hbDash);
    if (h) store.upsert("habit", h.id, { showDashboard: b.checked });
    toast(b.checked ? "Habit shown on dashboard" : "Habit hidden from dashboard", "success");
  }));
  document.querySelectorAll("[data-hb-del]").forEach((b) => b.addEventListener("click", async () => {
    const h = store.get("habit", b.dataset.hbDel);
    if (!h) return;
    const sure = await confirmDialog({ title: "Delete habit?", message: `“${h.name}” and its check-in history will be removed.`, confirmText: "Delete habit", danger: true });
    if (!sure) return;
    store.remove("habit", h.id);
    toast("Habit deleted", "success");
  }));
}
