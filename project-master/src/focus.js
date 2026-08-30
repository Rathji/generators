// src/focus.js — Focus (Pomodoro) timer (Roadmap Phase 8: tasks 57–62).
//
//  57: timer modes — work / short break / long break with an auto-cycle
//      (4 work sessions → long break)
//  58: animated circular ring — SVG ring shows remaining time, ticks each 250ms
//  59: start / pause / reset controls
//  60: session completion — a finished work session is logged as a focuslog
//      record (drives Focus analytics, task 95), a subtle chime plays, and the
//      timer auto-advances to the next mode
//  61: focus task attachment — pick an open task to focus on; it's shown on the
//      card and stamped on each completed session
//  62: configurable durations — read live from settings (work/short/long mins)
//
// Pure helpers (modeDurations, sessionAdvance, focusToday, focusTotals) covered
// by runPhase8Tests().

import { $, esc, toast } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, msToIso } from "./dates.js";

export const MODES = ["work", "short", "long"];
export const MODE_LABEL = { work: "Focus", short: "Short break", long: "Long break" };
export const MODE_COLOR = { work: "#8b7cff", short: "#22d3ee", long: "#ec4899" };

// Durations in minutes from settings; pure + injectable for tests.
export function modeDurations(settings) {
  return {
    work: Math.max(1, parseInt(settings.focusWork, 10) || 25),
    short: Math.max(1, parseInt(settings.focusShort, 10) || 5),
    long: Math.max(1, parseInt(settings.focusLong, 10) || 15),
  };
}

// Which mode comes next, given how many work sessions completed in this cycle.
export function sessionAdvance(mode, workDoneInCycle) {
  if (mode === "short" || mode === "long") return "work";
  return workDoneInCycle >= 4 ? "long" : "short";
}

export const focusState = { mode: "work", running: false, remainMs: 0, durMs: 0, taskId: "", workDoneInCycle: 0, timer: null };

function durations(store) { return modeDurations(store.settings); }

function loadMode(store, mode) {
  const d = durations(store);
  const min = d[mode];
  focusState.mode = mode;
  focusState.durMs = min * 60000;
  focusState.remainMs = focusState.durMs;
  focusState.running = false;
  stopTick();
  return min;
}

// ── pure summaries (tested) ──────────────────────────────────────
export function focusTotals(store) {
  const t = todayLocal();
  const all = store.all("focuslog");
  let todayMin = 0, sessionsToday = 0, totalMin = 0, sessionsTotal = 0;
  for (const s of all) {
    if (s.mode !== "work") continue;
    const m = Number(s.durationMin) || 0;
    totalMin += m; sessionsTotal++;
    if (msToIso(s.started) === t) { todayMin += m; sessionsToday++; }
  }
  return { todayMin, sessionsToday, totalMin, sessionsTotal };
}

// ── ring + view ──────────────────────────────────────────────────
function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
function ringHTML(pct) {
  const R = 84, C = 2 * Math.PI * R;
  const off = C * (1 - pct);
  return `<svg class="fz-ring" viewBox="0 0 200 200" role="img" aria-label="Focus timer ring">
    <defs><linearGradient id="fzgrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b7cff"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient></defs>
    <circle class="ring-bg" cx="100" cy="100" r="${R}"/>
    <circle class="ring-fg" cx="100" cy="100" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${off}"/>
  </svg>`;
}

export function focusViewHTML(store) {
  const d = durations(store);
  const pct = focusState.durMs ? focusState.remainMs / focusState.durMs : 1;
  const tasks = store.all("task").filter((t) => t.status !== "Done").sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  const tOpts = `<option value="">No task attached</option>` + tasks.map((t) => `<option value="${esc(t.id)}" ${focusState.taskId === t.id ? "selected" : ""}>${esc(t.title)}</option>`).join("");
  const f = focusTotals(store);
  const attached = focusState.taskId ? store.get("task", focusState.taskId) : null;
  const durs = `<label class="fz-dur" data-mode="work"><b>${d.work}</b> min work</label>
    <label class="fz-dur" data-mode="short"><b>${d.short}</b> min short</label>
    <label class="fz-dur" data-mode="long"><b>${d.long}</b> min long</label>`;
  return `
    <div class="view-head"><h1><span class="vh-ico">${ICONS.timer}</span> Focus</h1><p class="sub">Pomodoro focus timer — durations are set in Settings.</p></div>
    <div class="fz-layout">
      <div class="fz-card">
        <div class="fz-modes seg">
          ${MODES.map((m) => `<button data-mode="${m}" class="${focusState.mode === m ? "on" : ""}">${MODE_LABEL[m]}</button>`).join("")}
        </div>
        <div class="fz-ring-wrap" id="fzRingWrap">${ringHTML(pct)}</div>
        <div class="fz-time" id="fzTime">${fmt(focusState.remainMs || focusState.durMs || d.work * 60000)}</div>
        <div class="fz-mode-label" id="fzModeLabel" style="color:${MODE_COLOR[focusState.mode]}">${MODE_LABEL[focusState.mode]}</div>
        <div class="fz-controls">
          <button class="btn btn-primary" id="fzStartBtn">${focusState.running ? ICONS.pause + " Pause" : ICONS.play + " Start"}</button>
          <button class="btn" id="fzResetBtn" title="Reset this session">${ICONS.refresh}</button>
        </div>
        <div class="fz-attach">
          <label class="fz-attach-label">Focus on a task</label>
          <select id="fzTaskSel">${tOpts}</select>
          ${attached ? `<div class="fz-attached"><span class="dot" style="background:${MODE_COLOR.work}"></span> ${esc(attached.title)}</div>` : ""}
        </div>
        <div class="fz-durs">${durs}</div>
      </div>
      <aside class="fz-side">
        <div class="panel">
          <h2>Today</h2>
          <div class="fz-big">${fmt(f.todayMin * 60000)}</div>
          <p class="muted small">focused today</p>
          <p class="muted small">${f.sessionsToday} session${f.sessionsToday === 1 ? "" : "s"} today · ${f.sessionsTotal} all-time · ${Math.round(f.totalMin / 60)}h focused</p>
        </div>
        <div class="panel" style="margin-top:14px;">
          <h2>How it works</h2>
          <p class="muted small">Work until the ring empties, then take a break. After 4 work sessions you earn a long break. Completed work sessions are logged for analytics.</p>
        </div>
      </aside>
    </div>`;
}

function stopTick() {
  if (focusState.timer) { clearInterval(focusState.timer); focusState.timer = null; }
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = "sine";
      o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
      o.start(t0); o.stop(t0 + 0.55);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (e) { /* audio unavailable — ignore */ }
}

export function wireFocusView(store, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = durations(store);

  const paint = () => {
    const timeEl = $("#fzTime");
    if (timeEl) timeEl.textContent = fmt(focusState.remainMs || focusState.durMs || d.work * 60000);
    const wrap = $("#fzRingWrap");
    if (wrap) {
      const pct = focusState.durMs ? focusState.remainMs / focusState.durMs : 1;
      wrap.innerHTML = ringHTML(pct);
    }
    const ml = $("#fzModeLabel");
    if (ml) { ml.textContent = MODE_LABEL[focusState.mode]; ml.style.color = MODE_COLOR[focusState.mode]; }
    const sb = $("#fzStartBtn");
    if (sb) sb.innerHTML = focusState.running ? ICONS.pause + " Pause" : ICONS.play + " Start";
    document.title = (focusState.running ? fmt(focusState.remainMs) + " · " : "") + MODE_LABEL[focusState.mode] + " — Project Master";
  };

  const complete = () => {
    stopTick();
    if (focusState.mode === "work") {
      const started = Date.now();
      const durMin = Math.max(1, Math.round(focusState.durMs / 60000));
      store.create("focuslog", { started, durationMin: durMin, taskId: focusState.taskId || null, mode: "work" });
      focusState.workDoneInCycle++;
      playChime();
      toast("Focus session complete — great work!", "success");
    } else {
      playChime();
      toast(MODE_LABEL[focusState.mode] + " over — back to focus", "info");
    }
    const next = sessionAdvance(focusState.mode, focusState.workDoneInCycle);
    const min = loadMode(store, next);
    toast("Starting " + MODE_LABEL[next] + " (" + min + " min)");
    paint();
    redraw();
  };

  const tick = () => {
    focusState.remainMs -= 250;
    if (focusState.remainMs <= 0) { focusState.remainMs = 0; complete(); return; }
    paint();
  };

  const start = () => {
    if (focusState.running) { focusState.running = false; stopTick(); }
    else {
      if (!focusState.remainMs) loadMode(store, focusState.mode);
      focusState.running = true;
      stopTick();
      focusState.timer = setInterval(tick, 250);
    }
    paint();
  };
  const reset = () => {
    focusState.running = false;
    stopTick();
    loadMode(store, focusState.mode);
    paint();
    redraw();
  };

  $("#fzStartBtn")?.addEventListener("click", start);
  $("#fzResetBtn")?.addEventListener("click", reset);
  document.querySelectorAll(".fz-modes button").forEach((b) => b.addEventListener("click", () => {
    focusState.running = false; stopTick();
    loadMode(store, b.dataset.mode);
    paint();
    redraw();
  }));
  $("#fzTaskSel")?.addEventListener("change", (e) => { focusState.taskId = e.target.value; redraw(); });
  paint();
}
