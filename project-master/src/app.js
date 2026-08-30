// src/app.js — Project Master boot + app shell
// Wires the rathji-style nav/sidebar, theme system, save indicator, settings
// view (with backup/import/clear-all), and the search palette. Every view is
// rendered from the cached store state and refreshes on store change
// (single source of truth — Roadmap task 16).

import { Store, ENTITY_TYPES } from "./store.js";
import { $, esc, toast, confirmDialog } from "./ui.js";
import { Palette } from "./palette.js";
import { ICONS } from "./icons.js";
import { projectsHubHTML, wireProjectsHub, projectWorkspaceHTML, wireProjectWorkspace, resolveTab } from "./projects.js";
import { tasksViewHTML, wireTasksView } from "./tasks.js";
import { calendarViewHTML, wireCalendarView } from "./calendar.js";
import { checklistsViewHTML, wireChecklistsView } from "./checklists.js";
import { notesViewHTML, wireNotesView } from "./notes.js";
import { habitsViewHTML, wireHabitsView } from "./habits.js";
import { focusViewHTML, wireFocusView } from "./focus.js";
import { boardsHubHTML, wireBoardsHub, boardViewHTML, wireBoardView } from "./boards.js";
import { todayViewHTML, wireTodayView } from "./today.js";
import { portfolioViewHTML, wirePortfolioView } from "./portfolio.js";
import { tagsViewHTML, wireTagsView } from "./tags.js";

window.pm = {};
window.pm.renderView = renderView;

const store = (window.pm.store = new Store({ kv: (typeof root !== "undefined" && root.kv) || null, folder: "pm" }));
await store.load();
store.attachFlush();

function setIcon(btn, name) {
  if (!btn) return;
  const slot = btn.querySelector(".ico");
  if (slot) slot.innerHTML = ICONS[name] || "";
}

const TYPE_ICON = { project: "folder", task: "check", event: "calendar", checklist: "checkSquare", note: "file", habit: "zap", board: "grid" };
const VIEW_META = {
  dashboard: ["home", "Dashboard"], today: ["timer", "Today"], portfolio: ["chart", "Portfolio"], projects: ["folder", "Projects"], tasks: ["check", "Tasks"],
  calendar: ["calendar", "Calendar"], checklists: ["checkSquare", "Checklists"], notes: ["file", "Notes"],
  habits: ["zap", "Habits"], focus: ["timer", "Focus"], boards: ["grid", "Boards"],
  tags: ["tag", "Tags"],
  assistant: ["sparkle", "Assistant"], settings: ["settings", "Settings"],
};

// ── theme (task 7) ───────────────────────────────────────────────
const THEME_ORDER = ["dark", "light", "system"];
const THEME_ICON = { dark: "moon", light: "sun", system: "moon" };
function applyTheme() {
  const t = store.settings.theme || "system";
  document.documentElement.setAttribute("data-theme", t);
  setIcon($("#themeBtn"), THEME_ICON[t] || "moon");
}
function cycleTheme() {
  const cur = store.settings.theme || "system";
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  store.setSetting("theme", next);
  applyTheme();
  toast(next === "system" ? "Theme: system (follows device)" : "Theme: " + next);
}

// ── save indicator (task 2) ──────────────────────────────────────
function renderSaveInd(state) {
  const el = $("#saveInd");
  if (!el) return;
  const map = { saving: "Saving…", saved: "Saved locally", error: "Save error", idle: "…" };
  el.classList.toggle("saving", state === "saving");
  el.classList.toggle("error", state === "error");
  el.querySelector(".txt").textContent = map[state] || map.idle;
  el.title = state === "error" ? "Click to retry the failed write" : "All data is stored locally in your browser";
  el.setAttribute("aria-label", el.querySelector(".txt").textContent);
}
store.subscribe((evt) => { if (evt.type === "savestate") { renderSaveInd(evt.state); if (evt.state === "saved") import("./backup.js").then((B) => B.maybeAutoSnapshot(store)).catch(() => {}); } });
document.addEventListener("click", (e) => {
  if (e.target.closest("#saveInd") && store.saveState === "error") { toast("Retrying save…"); store.save(); }
});

// ── router (task 16) ─────────────────────────────────────────────
let currentView = "dashboard";
let viewParams = {};
function navigate(view, params = {}) {
  currentView = view;
  viewParams = params;
  document.querySelectorAll(".side-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  closeDrawer();
  renderView(view);
  window.scrollTo({ top: 0 });
}
// views refresh on any store change (cached state is the single source of truth)
let refreshTimer = null;
store.subscribe((evt) => {
  if (evt.type === "savestate" || evt.type === "loaded") return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (currentView === "settings" || currentView === "dashboard" || currentView === "projects" || currentView === "tasks" || currentView === "calendar" || currentView === "checklists" || currentView === "notes" || currentView === "habits" || currentView === "focus" || currentView === "boards" || currentView === "today" || currentView === "portfolio" || currentView === "tags") renderView(currentView);
  }, 30);
});

function renderProjects() {
  const main = $("#main");
  if (!main) return;
  const id = viewParams.id;
  const project = id ? store.get("project", id) : null;
  if (id && !project) { navigate("projects"); return; }
  if (project) {
    const tab = resolveTab(project.id, viewParams.tab);
    main.innerHTML = projectWorkspaceHTML(store, project, tab);
    wireProjectWorkspace(store, project, {
      tab,
      navigate: (v, p) => navigate(v, p),
      render: () => renderProjects(),
    });
    return;
  }
  main.innerHTML = projectsHubHTML(store);
  wireProjectsHub(store, { navigate: (v, p) => navigate(v, p) });
}

function renderBoards() {
  const main = $("main");
  if (!main) return;
  const id = viewParams.id;
  const board = id ? store.get("board", id) : null;
  if (id && !board) { navigate("boards"); return; }
  if (board) {
    main.innerHTML = boardViewHTML(store, board);
    wireBoardView(store, board, {
      render: () => renderBoards(),
      back: () => navigate("boards"),
    });
    return;
  }
  main.innerHTML = boardsHubHTML(store);
  wireBoardsHub(store, { open: (bid) => navigate("boards", { id: bid }) });
}

function renderView(view) {
  const main = $("#main");
  if (!main) return;
  if (view === "dashboard") { main.innerHTML = dashboardHTML(); wireDashboard(); return; }
  if (view === "today") { main.innerHTML = todayViewHTML(store); wireTodayView(store, { render: () => { if (currentView === "today") renderView("today"); } }); return; }
  if (view === "portfolio") { main.innerHTML = portfolioViewHTML(store); wirePortfolioView(store, { navigate }); return; }
  if (view === "settings") { main.innerHTML = settingsHTML(); wireSettings(); return; }
  if (view === "projects") { renderProjects(); return; }
  if (view === "tasks") { main.innerHTML = tasksViewHTML(store); wireTasksView(store, { navigate }); return; }
  if (view === "calendar") { main.innerHTML = calendarViewHTML(store); wireCalendarView(store, { navigate, render: () => renderView("calendar") }); return; }
  if (view === "checklists") { main.innerHTML = checklistsViewHTML(store); wireChecklistsView(store, { render: () => renderView("checklists") }); return; }
  if (view === "notes") { main.innerHTML = notesViewHTML(store); wireNotesView(store, { render: () => renderView("notes") }); return; }
  if (view === "habits") { main.innerHTML = habitsViewHTML(store); wireHabitsView(store, { render: () => renderView("habits") }); return; }
  if (view === "focus") { main.innerHTML = focusViewHTML(store); wireFocusView(store, { render: () => { if (currentView === "focus") renderView("focus"); } }); return; }
  if (view === "boards") { renderBoards(); return; }
  if (view === "tags") { main.innerHTML = tagsViewHTML(store); wireTagsView(store, { render: () => { if (currentView === "tags") renderView("tags"); } }); return; }
  if (view === "assistant") {
    import("./assistant.js").then((A) => {
      main.innerHTML = A.assistantViewHTML(store);
      A.wireAssistantView(store, { render: () => { if (currentView === "assistant") renderView("assistant"); } });
    });
    return;
  }
  const [ico, label] = VIEW_META[view] || ["folder", view];
  main.innerHTML = `
    <div class="view-head"><h1><span class="vh-ico">${ICONS[ico] || ""}</span> ${label}</h1></div>
    <div class="coming">
      <div class="coming-ico">${ICONS[ico] || ""}</div>
      <h2>${label} is next on the roadmap</h2>
      <p>This module hasn't been built yet — it'll appear here as its roadmap phase is implemented.</p>
    </div>`;
}

// ── sidebar / responsive shell (tasks 9 & 10) ────────────────────
function closeDrawer() {
  $("#sidebar")?.classList.remove("open");
  const ov = $("#overlay");
  if (ov) ov.hidden = true;
}

// ── dashboard ────────────────────────────────────────────────────
// one illustration per entity type — generated as static assets, hosted on uploads.dev
// (focuslog is deliberately not a card: it's telemetry produced by the Focus timer, not
// a first-class item users create.)
const CARD_IMG = {
  project: "https://user.uploads.dev/file/adf3d20c3df25f1a00dbf54b7eff4f80.jpg",
  task: "https://user.uploads.dev/file/c58939a5df2d322ba2ddf2c87611b0e4.jpg",
  event: "https://user.uploads.dev/file/2b6f27262c26db6533e8af3784d56714.jpg",
  checklist: "https://user.uploads.dev/file/95f115f42474fea4c547dac0b565f58b.jpg",
  note: "https://user.uploads.dev/file/ccd94471cfc7fc90704faefe9d2794f7.jpg",
  habit: "https://user.uploads.dev/file/0fe8a2371fe3ce37406dd0b8441ffe48.jpg",
  board: "https://user.uploads.dev/file/a13f5f4ee24ad33e45c87a97810a5234.png",
};
const CARD_TYPES = ["project", "task", "event", "checklist", "note", "habit", "board"];

function dashboardHTML() {
  const today = new Date();
  const dateStr = today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const name = (store.settings.profileName || "").trim();
  const greet = name ? "Hey, " + esc(name) : "Welcome";
  const total = ENTITY_TYPES.reduce((n, t) => n + store.count(t), 0);
  const cards = CARD_TYPES.map((t) => {
    const n = store.count(t);
    const view = t === "event" ? "calendar" : t === "board" ? "boards" : t;
    const label = t[0].toUpperCase() + t.slice(1) + (n === 1 ? "" : "s");
    return `<button class="stat-card" data-view="${view}" aria-label="${label} — ${n}">
      <div class="stat-img-wrap">
        <img class="stat-img" src="${CARD_IMG[t]}" alt="" decoding="async">
        <div class="stat-tint"></div>
      </div>
      <div class="stat-body">
        <div class="stat-num">${n}</div>
        <div class="stat-label">${label}</div>
        <div class="stat-go">Open ${label} <span class="arr">→</span></div>
      </div>
    </button>`;
  }).join("");

  return `
    <div class="view-head">
      <h1>${greet}</h1>
      <p class="sub">${dateStr} · your local workspace</p>
    </div>
    <div class="stat-grid">${cards}</div>
    <div class="dash-cols">
      <section class="panel">
        <h2>Import / export</h2>
        <p class="muted">Take your workspace anywhere — export everything as a JSON backup, or restore from a previous one. All data stays in this browser.</p>
        <div class="backup-row">
          <button class="btn" id="dashExportBtn">${ICONS.download} Export JSON backup</button>
          <button class="btn" id="dashImportBtn">${ICONS.upload} Import backup</button>
          <input type="file" id="dashImportFile" accept=".json,application/json" hidden>
        </div>
        <p class="muted small">Current dataset: <b>${total}</b> record${total === 1 ? "" : "s"} across ${ENTITY_TYPES.length} entity types · schema v1.</p>
        <button class="btn ghost" id="dashSettingsBtn">${ICONS.settings} Settings & backup</button>
      </section>
      <section class="panel">
        <h2>Export & weekly report</h2>
        <p class="muted">Download your data in other formats, or get an AI summary of the last 7 days.</p>
        <div class="backup-row">
          <button class="btn" id="dashTasksCsvBtn">${ICONS.check} Tasks CSV</button>
          <button class="btn" id="dashEventsCsvBtn">${ICONS.clock} Events CSV</button>
          <button class="btn" id="dashIcsBtn">${ICONS.calendar} Calendar .ics</button>
        </div>
        <div class="backup-row">
          <button class="btn" id="dashNotesMdBtn">${ICONS.file} Notes .md</button>
          <button class="btn" id="dashChecksMdBtn">${ICONS.checkSquare} Checklists .md</button>
          <button class="btn btn-primary" id="dashReportBtn">${ICONS.sparkle} Weekly report</button>
        </div>
        <p class="muted small">CSV opens in spreadsheets, .ics imports into Google Calendar / Outlook / Apple Calendar, Markdown into any editor.</p>
      </section>
      <section class="panel" style="grid-column:1/-1;">
        <h2>Roadmap status</h2>
        <p class="muted">This build follows <b>src/TODO.pjs</b> — 101 tasks across 10 phases, one at a time.</p>
        <ul class="todo-mini">
          <li class="done">✓ Phase 1 · Core system — all 16 tasks (persistence, indicator, settings, backup, restore, clear-all, theme, fullscreen, responsive layout, search palette, toasts, modals, cached views)</li>
          <li class="done">✓ Phase 2 · Projects hub + workspace — all 7 tasks (hub, project modal, delete, tabs, overview, timeline, brainstorm)</li>
          <li class="done">✓ Phase 3 · Tasks — all 8 tasks (global view, filters, sorting, editor, subtasks, kanban, highlighting, completed-today)</li>
          <li class="done">✓ Phase 4 · Calendar — month grid, day panel, week view, navigation, events CRUD, tasks-on-calendar</li>
          <li class="done">✓ Phase 5 · Checklists · Phase 6 · Notes</li>
          <li class="done">✓ Phase 7 · Habits · Phase 8 · Focus timer</li>
          <li class="done">✓ Phase 9 · Boards — all 9 brainstorming tools</li>
          <li class="done">✓ Phase 10 · AI assistant — data-aware chat, quick actions, goal breakdown, focus planner</li>
          <li class="done">✓ Phase 11 · Feature backlog — 80–91 done (recurring tasks, dependencies, time tracking, Gantt, Today planner, Portfolio, attachments, tag manager, versioned backups, exports, weekly report, quick capture)</li>
          <li>○ Phase 11 · 92–101 — 10 more backlog features</li>
        </ul>
      </section>
    </div>`;
}

function wireDashboard() {
  $("#dashExportBtn")?.addEventListener("click", exportBackup);
  $("#dashImportBtn")?.addEventListener("click", () => $("#dashImportFile")?.click());
  $("#dashImportFile")?.addEventListener("change", onImportFileChange);
  $("#dashSettingsBtn")?.addEventListener("click", () => navigate("settings"));
  document.querySelectorAll(".stat-card").forEach((c) => c.addEventListener("click", () => navigate(c.dataset.view)));
  const exp = (id, fn) => $("#" + id)?.addEventListener("click", () => import("./exports.js").then((X) => { X[fn](store); toast("Export started — check your downloads", "success"); }).catch((e) => toast("Export failed: " + e.message, "error", 5000)));
  exp("dashTasksCsvBtn", "downloadTasksCSV");
  exp("dashEventsCsvBtn", "downloadEventsCSV");
  exp("dashIcsBtn", "downloadICS");
  exp("dashNotesMdBtn", "downloadNotesMD");
  exp("dashChecksMdBtn", "downloadChecklistsMD");
  $("#dashReportBtn")?.addEventListener("click", () => import("./report.js").then((R) => R.openWeeklyReportModal(store)));
}

// ── backup export/import (tasks 4 & 5) — shared by Settings and the dashboard box ──
function exportBackup() {
  const payload = store.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "project-master-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Backup exported — " + blob.size + " bytes", "success");
}

async function onImportFileChange(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast("Import failed: not a valid JSON file", "error");
    return;
  }
  // validate before touching anything
  let err = null;
  try { store.validateBackup(data); } catch (ex) { err = ex.message; }
  if (err) { toast("Import failed: " + err, "error", 5000); return; }
  const n = Object.values(data.entities || {}).reduce((a, arr) => a + (arr ? arr.length : 0), 0);
  const sure = await confirmDialog({
    title: "Restore backup?",
    message: "This will REPLACE all current records with the " + n + " records from “" + file.name + "”. This cannot be undone — consider exporting a backup first.",
    confirmText: "Restore backup", danger: true,
  });
  if (!sure) { toast("Import cancelled", "info"); return; }
  try {
    store.restoreFromBackup(data);
    toast("Backup restored — " + n + " records loaded", "success");
    renderView(currentView);
  } catch (ex) {
    toast("Import failed: " + ex.message, "error", 5000);
  }
}

// ── settings view (task 3) + data management (tasks 4, 5, 6) ────
function settingsHTML() {
  const s = store.settings;
  const seg = (name, opts) => `<div class="seg" data-seg="${name}">${opts.map((o) => `<button data-val="${o.v}" class="${s[name] === o.v ? "on" : ""}">${o.label}</button>`).join("")}</div>`;
  return `
    <div class="view-head"><h1><span class="vh-ico">${ICONS.settings}</span> Settings</h1><p class="sub">Preferences are saved locally and restored on load.</p></div>
    <div class="settings-cols">
      <div>
        <div class="setting-group">
          <h2>Profile</h2>
          <div class="field"><label for="profileNameInput">Name (used in the dashboard greeting)</label>
            <input type="text" id="profileNameInput" value="${esc(s.profileName)}" placeholder="Your name" maxlength="40"></div>
        </div>
        <div class="setting-group">
          <h2>Appearance</h2>
          <div class="field"><label>Theme</label>${seg("theme", [{ v: "light", label: ICONS.sun + " Light" }, { v: "dark", label: ICONS.moon + " Dark" }, { v: "system", label: ICONS.moon + " System" }])}</div>
        </div>
        <div class="setting-group">
          <h2>Focus timer</h2>
          <div class="dur-row">
            <div class="field"><label for="focusWorkInput">Work (min)</label><input type="number" id="focusWorkInput" value="${s.focusWork}" min="1" max="180"></div>
            <div class="field"><label for="focusShortInput">Short break (min)</label><input type="number" id="focusShortInput" value="${s.focusShort}" min="1" max="60"></div>
            <div class="field"><label for="focusLongInput">Long break (min)</label><input type="number" id="focusLongInput" value="${s.focusLong}" min="1" max="90"></div>
          </div>
          <p class="muted" style="font-size:.78rem;">Used by the Focus timer (Phase 8) — new sessions pick these up immediately.</p>
        </div>
      </div>
      <div>
        <div class="setting-group">
          <h2>Backup & restore</h2>
          <p class="muted" style="font-size:.85rem;">Your data never leaves your device. Export a JSON backup of everything, or restore from a previous backup (this replaces all current data).</p>
          <button class="btn" id="exportBtn">${ICONS.download} Export full JSON backup</button>
          <button class="btn" id="importBtn">${ICONS.upload} Import / restore from backup</button>
          <input type="file" id="importFile" accept=".json,application/json" hidden>
        </div>
        <div class="setting-group">
          <h2>Backup history</h2>
          <p class="muted" style="font-size:.85rem;">Snapshots are taken automatically as you work — a fresh one at most every 5 minutes, keeping the latest 30. Restore any snapshot to roll your whole workspace back to that moment.</p>
          <button class="btn" id="snapNowBtn">${ICONS.camera} Snapshot now</button>
          <div class="bh-list" id="bhList"><div class="at-empty">Loading…</div></div>
        </div>
        <div class="setting-group danger-zone">
          <h2 style="color:var(--danger);">Danger zone</h2>
          <p class="muted" style="font-size:.85rem;">Permanently delete every record (projects, tasks, events, checklists, notes, habits, boards). Requires a double confirmation.</p>
          <button class="btn btn-danger" id="clearAllBtn">${ICONS.trash} Clear all data…</button>
        </div>
        <div class="setting-group">
          <h2>About</h2>
          <p class="muted" style="font-size:.85rem;">Project Master — a local-first app built on the <b>rathji-template</b>. v1 · schema v1 · 101-task roadmap tracked in <b>src/TODO.pjs</b>.</p>
        </div>
      </div>
    </div>`;
}

function wireSettings() {
  $("#profileNameInput")?.addEventListener("change", (e) => { store.setSetting("profileName", e.target.value.trim()); toast("Profile saved", "success"); });
  document.querySelectorAll('[data-seg="theme"] button').forEach((b) => b.addEventListener("click", () => {
    store.setSetting("theme", b.dataset.val);
    applyTheme();
    document.querySelectorAll('[data-seg="theme"] button').forEach((x) => x.classList.toggle("on", x === b));
    toast("Theme: " + b.dataset.val, "success");
  }));
  const numBind = (id, key) => {
    const el = $("#" + id);
    el?.addEventListener("change", () => {
      const v = Math.max(1, parseInt(el.value, 10) || 1);
      el.value = v;
      store.setSetting(key, v);
      toast("Focus timer saved", "success");
    });
  };
  numBind("focusWorkInput", "focusWork");
  numBind("focusShortInput", "focusShort");
  numBind("focusLongInput", "focusLong");

  // export + import (tasks 4 & 5) — shared with the dashboard box
  $("#exportBtn")?.addEventListener("click", exportBackup);
  $("#importBtn")?.addEventListener("click", () => $("#importFile")?.click());
  $("#importFile")?.addEventListener("change", onImportFileChange);

  // backup history (task 88) — versioned snapshots, auto-taken as you work
  const renderBhList = async () => {
    const ctn = $("#bhList"); if (!ctn) return;
    const B = await import("./backup.js");
    const snaps = await B.listSnapshots(store);
    ctn.innerHTML = B.backupHistoryHTML(snaps);
    B.wireBackupHistory(ctn, store, renderBhList);
  };
  renderBhList();
  $("#snapNowBtn")?.addEventListener("click", async () => {
    const B = await import("./backup.js");
    const s = await B.takeSnapshot(store);
    if (!s) { toast("Snapshots unavailable right now", "error"); return; }
    toast("Snapshot saved — " + s.count + " records", "success");
    renderBhList();
  });

  // clear-all (task 6) — two sequential confirmations, with an export-first option
  $("#clearAllBtn")?.addEventListener("click", async () => {
    const total = store.records.size;
    if (total === 0) { toast("Nothing to clear — your workspace is already empty", "info"); return; }
    const first = await confirmDialog({
      title: "Clear all data?",
      message: "You're about to permanently delete " + total + " records. It's strongly recommended to export a backup first.",
      confirmText: "Continue…", cancelText: "Cancel", danger: true,
      html: `<button class="btn btn-primary" style="width:100%;" data-export>${ICONS.download} Export a backup first, then continue</button>`,
    });
    if (!first) { toast("Cancelled", "info"); return; }
    const second = await confirmDialog({
      title: "Really delete everything?",
      message: "Final confirmation. This wipes every record from this browser. It cannot be undone.",
      confirmText: "Delete everything", cancelText: "Keep my data", danger: true,
    });
    if (!second) { toast("Nothing was deleted", "info"); return; }
    store.wipeAll();
    toast("All data cleared", "success");
    renderView("settings");
  });
}

// ── palette wiring (tasks 11–13) ─────────────────────────────────
const palette = (window.pm.palette = new Palette(store, {
  navigate,
  cycleTheme,
  openItem: (type, rec) => {
    const view = { task: "tasks", note: "notes", event: "calendar", checklist: "checklists", project: "projects", board: "boards" }[type] || "dashboard";
    toast((rec.name || rec.title || "Item") + " — editing opens in its phase", "info");
    navigate(view);
  },
}));

// ── boot wiring ──────────────────────────────────────────────────
function boot() {
  applyTheme();
  renderSaveInd(store.saveState);
  setIcon($("#menuBtn"), "menu");
  setIcon($("#searchBtn"), "search");
  setIcon($("#settingsBtn"), "settings");

  document.querySelectorAll(".side-item").forEach((b) => {
    b.addEventListener("click", (e) => { e.preventDefault(); navigate(b.dataset.view); });
  });
  $("#menuBtn")?.addEventListener("click", () => {
    const sb = $("#sidebar"); if (!sb) return;
    sb.classList.toggle("open");
    const ov = $("#overlay");
    if (ov) ov.hidden = !sb.classList.contains("open");
  });
  $("#overlay")?.addEventListener("click", closeDrawer);
  $("#themeBtn")?.addEventListener("click", cycleTheme);

  const fsBtn = $("#fsBtn");
  const updateFs = () => setIcon(fsBtn, document.fullscreenElement ? "compress" : "expand");
  fsBtn?.addEventListener("click", () => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen?.().catch(() => {}); }
    else { document.exitFullscreen?.(); }
  });
  document.addEventListener("fullscreenchange", updateFs);
  updateFs();

  $("#searchBtn")?.addEventListener("click", () => palette.openPalette());
  $("#settingsBtn")?.addEventListener("click", () => navigate("settings"));
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette.toggle(); }
  });

  import("./quickcapture.js").then((Q) => Q.initQuickCapture(store)).catch(() => {});

  navigate("dashboard");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
