// ============================================================================
//  PM-U — view adapters
//  Each export is a view module `{ render(outlet, ctx) }` that the template-u
//  router mounts into #puMain. The actual feature markup/logic lives in the
//  vendored project-master modules under src/pm/*; these adapters are the thin
//  glue that gives them the template-u router context (navigate/render/store).
// ============================================================================

import { ICONS } from "./pm/icons.js";
import { $, esc, toast, confirmDialog } from "./pm/ui.js";
import { h } from "./framework/dom.js";
import { formatBytes } from "./framework/utils.js";
import { textInput, textareaInput, selectInput, fieldStack, fieldGrid, actionButton, formModal, focusFirst, submitOnEnter } from "./pm/formkit.js";
import { ENTITY_TYPES, SCHEMA_VERSION } from "./pm/store.js";
import { MEMBERS, member, memberUrl, entityLabel, recordHref, refKey, buildMemberDescriptor, PM_U } from "./pm/integrate.js";
import * as idmod from "./pm/identities.js";
import { todayLocal } from "./pm/dates.js";
import { runAll as runAllFrameworkTests } from "./tests/index.js";
import * as pmTests from "./pm/tests.js";

import * as projectsMod from "./pm/projects.js";
import * as tasksMod from "./pm/tasks.js";
import * as calendarMod from "./pm/calendar.js";
import * as checklistsMod from "./pm/checklists.js";
import * as notesMod from "./pm/notes.js";
import * as habitsMod from "./pm/habits.js";
import * as focusMod from "./pm/focus.js";
import * as boardsMod from "./pm/boards.js";
import * as todayMod from "./pm/today.js";
import * as portfolioMod from "./pm/portfolio.js";
import * as tagsMod from "./pm/tags.js";
import * as assistantMod from "./pm/assistant.js";

// --------------------------------------------------------------- helpers ----
function ctxOf(ctx) {
  const store = ctx.app.store;
  return {
    store,
    navigate: (view, params) => ctx.app.navigate(view, params),
    render: () => ctx.app.render(),
  };
}

const VIEW_ICON = {
  dashboard: "home",
  today: "timer",
  portfolio: "chart",
  projects: "folder",
  tasks: "check",
  calendar: "calendar",
  checklists: "checkSquare",
  notes: "file",
  habits: "zap",
  focus: "play",
  boards: "grid",
  tags: "tag",
  ecosystem: "network",
  assistant: "sparkle",
};

// ═════════════════════════════════════════════════════════════════ Dashboard =
export const dashboard = {
  render(outlet, ctx) {
    const store = ctx.app.store;
    outlet.innerHTML = dashboardHTML(store);
    wireDashboard(store, ctx.app);
  },
};

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

function dashboardHTML(store) {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
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

  const habits = habitsMod.habitsForDashboard(store);
  const habitStrip = habits.length
    ? `
    <section class="panel dash-habits">
      <h2>Today's habits</h2>
      <p class="muted">Tasks you're building into routines — tap to check in for today. Manage them in <b>Habits</b>.</p>
      <div class="hb-strip">
        ${habits
          .map((hb) => {
            const hs = habitsMod.habitStats(hb);
            return `<button class="hb-pill${hs.checkedToday ? " on" : ""}" data-dash-habit="${hb.id}" style="--hcolor:${hb.color || "#8b5cf6"}" title="${hs.checkedToday ? "Checked in today — tap to undo" : "Check in for today"}">
              <span class="hb-pill-ico">${ICONS[hb.icon] || ICONS.zap}</span>
              <span class="hb-pill-name">${esc(hb.name)}</span>
              <span class="hb-pill-streak" title="Current streak (days)">${hs.streak}</span>
            </button>`;
          })
          .join("")}
      </div>
      <button class="btn ghost" id="dashHabitsBtn">${ICONS.zap} Open Habits</button>
    </section>`
    : "";

  return `
    <div class="view-head">
      <h1>${greet}</h1>
      <p class="sub">${dateStr} · your local workspace</p>
    </div>
    <div class="stat-grid">${cards}</div>
    ${habitStrip}
    <div class="dash-cols">
      <section class="panel">
        <h2>Import / export</h2>
        <p class="muted">Take your workspace anywhere — export everything as a JSON backup, or restore from a previous one. All data stays in this browser.</p>
        <div class="backup-row">
          <button class="btn" id="dashExportBtn">${ICONS.download} Export JSON backup</button>
          <button class="btn" id="dashImportBtn">${ICONS.upload} Import backup</button>
          <input type="file" id="dashImportFile" accept=".json,application/json" hidden>
        </div>
        <div class="backup-row">
          <button class="btn ghost" id="dashMigrateBtn">${ICONS.link2 || ICONS.upload} Migrate from Project Master</button>
        </div>
        <p class="muted small">Current dataset: <b>${total}</b> record${total === 1 ? "" : "s"} across ${ENTITY_TYPES.length} entity types · schema v${SCHEMA_VERSION}.</p>
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
        <h2>Getting started</h2>
        <p class="muted">Everything here is stored locally in your browser — nothing is uploaded. A few ways to move fast:</p>
        <ul class="todo-mini">
          <li>Press <b>Ctrl/Cmd + K</b> for the search palette — jump to any record or type <b>/</b> for commands.</li>
          <li>Press <b>N</b> anywhere for Quick capture (e.g. <i>“pay rent tomorrow @home #bills”</i>).</li>
          <li>Create a project in <b>Projects</b>, then add tasks in its workspace — or capture tasks globally in <b>Tasks</b>.</li>
          <li>Theme and branding live in <b>Settings</b>; run the built-in test suites in <b>Diagnostics</b>.</li>
        </ul>
      </section>
    </div>`;
}

function wireDashboard(store, app) {
  app = app || { store, navigate: () => {}, render: () => {} };
  $("#dashExportBtn") && $("#dashExportBtn").addEventListener("click", () => exportBackup(store));
  $("#dashImportBtn") && $("#dashImportBtn").addEventListener("click", () => $("#dashImportFile") && $("#dashImportFile").click());
  $("#dashImportFile") && $("#dashImportFile").addEventListener("change", (e) => onImportFileChange(e, store, app));
  $("#dashSettingsBtn") && $("#dashSettingsBtn").addEventListener("click", () => app.navigate("settings"));
  $("#dashMigrateBtn") &&
    $("#dashMigrateBtn").addEventListener("click", () => import("./pm/migrate.js").then((M) => M.pickAndMigrate(store, () => app.render())));
  document.querySelectorAll(".stat-card").forEach((c) => c.addEventListener("click", () => app.navigate(c.dataset.view)));
  document.querySelectorAll("[data-dash-habit]").forEach((b) => b.addEventListener("click", () => {
    habitsMod.toggleDay(store, b.dataset.dashHabit, todayLocal());
  }));
  $("#dashHabitsBtn") && $("#dashHabitsBtn").addEventListener("click", () => app.navigate("habits"));
  const exp = (id, fn) =>
    $("#" + id) &&
    $("#" + id).addEventListener("click", () =>
      import("./pm/exports.js")
        .then((X) => {
          X[fn](store);
          toast("Export started — check your downloads", "success");
        })
        .catch((e) => toast("Export failed: " + e.message, "error", 5000))
    );
  exp("dashTasksCsvBtn", "downloadTasksCSV");
  exp("dashEventsCsvBtn", "downloadEventsCSV");
  exp("dashIcsBtn", "downloadICS");
  exp("dashNotesMdBtn", "downloadNotesMD");
  exp("dashChecksMdBtn", "downloadChecklistsMD");
  $("#dashReportBtn") &&
    $("#dashReportBtn").addEventListener("click", () => import("./pm/report.js").then((R) => R.openWeeklyReportModal(store)));
}

// ── backup export / import (shared by Dashboard and Settings) ────────────────
function exportBackup(store) {
  const payload = store.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pm-u-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Backup exported — " + blob.size + " bytes", "success");
}

async function onImportFileChange(e, store, app) {
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
  let err = null;
  try {
    store.validateBackup(data);
  } catch (ex) {
    err = ex.message;
  }
  if (err) {
    toast("Import failed: " + err, "error", 5000);
    return;
  }
  const n = Object.values(data.entities || {}).reduce((a, arr) => a + (arr ? arr.length : 0), 0);
  const sure = await confirmDialog({
    title: "Restore backup?",
    message:
      "This will REPLACE all current records with the " + n + " records from “" + file.name + "”. This cannot be undone — consider exporting a backup first.",
    confirmText: "Restore backup",
    danger: true,
  });
  if (!sure) {
    toast("Import cancelled", "info");
    return;
  }
  try {
    store.restoreFromBackup(data);
    toast("Backup restored — " + n + " records loaded", "success");
    app.render();
  } catch (ex) {
    toast("Import failed: " + ex.message, "error", 5000);
  }
}

// ═══════════════════════════════════════════════════════════════════════ Today =
export const today = {
  render(outlet, ctx) {
    const { store, render } = ctxOf(ctx);
    outlet.innerHTML = todayMod.todayViewHTML(store);
    todayMod.wireTodayView(store, { render });
  },
};

// ═════════════════════════════════════════════════════════════════ Portfolio =
export const portfolio = {
  render(outlet, ctx) {
    const { store, navigate } = ctxOf(ctx);
    outlet.innerHTML = portfolioMod.portfolioViewHTML(store);
    portfolioMod.mountPortfolioLedger(outlet, store, { navigate });
    portfolioMod.wirePortfolioView(store, { navigate });
  },
};

// ═════════════════════════════════════════════════════════════════ Projects =
export const projects = {
  render(outlet, ctx) {
    const { store, navigate, render } = ctxOf(ctx);
    const id = ctx.query && ctx.query.id;
    const project = id ? store.get("project", id) : null;
    if (id && !project) {
      navigate("projects");
      return;
    }
    if (project) {
      const tab = projectsMod.resolveTab(project.id, (ctx.query && ctx.query.tab) || "");
      outlet.innerHTML = projectsMod.projectWorkspaceHTML(store, project, tab);
      projectsMod.wireProjectWorkspace(store, project, { tab, navigate, render });
      return;
    }
    outlet.innerHTML = projectsMod.projectsHubHTML(store);
    projectsMod.wireProjectsHub(store, { navigate });
  },
};

// ═════════════════════════════════════════════════════════════════════ Tasks =
export const tasks = {
  render(outlet, ctx) {
    const { store, navigate } = ctxOf(ctx);
    outlet.innerHTML = tasksMod.tasksViewHTML(store);
    tasksMod.wireTasksView(store, { navigate });
  },
};

// ══════════════════════════════════════════════════════════════════ Calendar =
export const calendar = {
  render(outlet, ctx) {
    const { store, navigate, render } = ctxOf(ctx);
    outlet.innerHTML = calendarMod.calendarViewHTML(store);
    calendarMod.wireCalendarView(store, { navigate, render });
  },
};

// ══════════════════════════════════════════════════════════════ Checklists =
export const checklists = {
  render(outlet, ctx) {
    const { store, render } = ctxOf(ctx);
    outlet.innerHTML = checklistsMod.checklistsViewHTML(store);
    checklistsMod.wireChecklistsView(store, { render });
  },
};

// ═══════════════════════════════════════════════════════════════════ Notes =
export const notes = {
  render(outlet, ctx) {
    const { store, render } = ctxOf(ctx);
    outlet.innerHTML = notesMod.notesViewHTML(store);
    notesMod.wireNotesView(store, { render });
  },
};

// ══════════════════════════════════════════════════════════════════ Habits =
export const habits = {
  render(outlet, ctx) {
    const { store, render } = ctxOf(ctx);
    outlet.innerHTML = habitsMod.habitsViewHTML(store);
    habitsMod.wireHabitsView(store, { render });
  },
};

// ═══════════════════════════════════════════════════════════════════ Focus =
export const focus = {
  render(outlet, ctx) {
    const { store, render } = ctxOf(ctx);
    outlet.innerHTML = focusMod.focusViewHTML(store);
    focusMod.wireFocusView(store, { render });
  },
};

// ══════════════════════════════════════════════════════════════════ Boards =
export const boards = {
  render(outlet, ctx) {
    const { store, navigate, render } = ctxOf(ctx);
    const id = ctx.query && ctx.query.id;
    const board = id ? store.get("board", id) : null;
    if (id && !board) {
      navigate("boards");
      return;
    }
    if (board) {
      outlet.innerHTML = boardsMod.boardViewHTML(store, board);
      boardsMod.wireBoardView(store, board, { render, back: () => navigate("boards") });
      return;
    }
    outlet.innerHTML = boardsMod.boardsHubHTML(store);
    boardsMod.wireBoardsHub(store, { open: (bid) => navigate("boards", { id: bid }) });
  },
};

// ════════════════════════════════════════════════════════════════════ Tags =
export const tags = {
  render(outlet, ctx) {
    const { store, render } = ctxOf(ctx);
    outlet.innerHTML = tagsMod.tagsViewHTML(store);
    tagsMod.wireTagsView(store, { render });
  },
};

// ═══════════════════════════════════════════════════════════════ Assistant =
export const assistant = {
  render(outlet, ctx) {
    const { store, render } = ctxOf(ctx);
    outlet.innerHTML = assistantMod.assistantViewHTML(store);
    assistantMod.wireAssistantView(store, { render });
  },
};

// ════════════════════════════════════════════════════════════════ Settings =
export const settings = {
  render(outlet, ctx) {
    renderSettings(outlet, ctx.app.store, ctx.app);
  },
};

function settingGroup(title, ...children) {
  return h("div", { class: "setting-group" }, h("h2", {}, title), ...children.filter(Boolean));
}

function renderSettings(outlet, store, app) {
  const s = store.settings;
  const themeInfo = app.theme.get();
  const brand = app.branding.get();
  const tokens = app.theme.resolved().tokens;

  const nameInput = textInput({ name: "profileName", label: "Name (used in the dashboard greeting)", value: s.profileName, placeholder: "Your name", maxlength: 40 });
  nameInput.input.addEventListener("change", () => {
    store.setSetting("profileName", nameInput.value.trim());
    toast("Profile saved", "success");
  });

  const themeGrid = h(
    "div",
    { class: "theme-grid" },
    app.theme.list().map((t) =>
      h(
        "button",
        { type: "button", class: "theme-opt" + (t.id === themeInfo.themeId ? " on" : ""), "data-theme-pick": t.id, title: t.description || t.label },
        h("span", { class: "theme-swatch" }, (t.swatch || []).map((c) => h("i", { style: `background:${c}` }))),
        h("span", { class: "theme-name" }, t.label),
        h("span", { class: "theme-mode" }, t.mode)
      )
    )
  );
  themeGrid.querySelectorAll("[data-theme-pick]").forEach((b) =>
    b.addEventListener("click", () => {
      app.theme.set(b.dataset.themePick);
      toast(app.theme.get().label + " theme applied", "success");
      app.render();
    })
  );

  const numInput = (label, key, value, max) => {
    const field = textInput({ name: key, label, type: "number", value, min: 1, max });
    field.input.addEventListener("change", () => {
      const v = Math.max(1, parseInt(field.value, 10) || 1);
      field.value = v;
      store.setSetting(key, v);
      toast("Focus timer saved", "success");
    });
    return field;
  };

  // ── branding — reads/updates the template-u branding configuration (task 14) ──
  const primaryInput = textInput({ name: "brandPrimary", label: "Primary brand colour", type: "color", value: brand.primary || tokens["--pu-primary"] || "#1e3a8a" });
  const accentInput = textInput({ name: "brandAccent", label: "Accent brand colour", type: "color", value: brand.accent || tokens["--pu-accent"] || "#0d9488" });
  const titleInput = textInput({ name: "brandTitle", label: "App title", value: brand.appTitle, maxlength: 40 });
  const taglineInput = textInput({ name: "brandTagline", label: "Tagline", value: brand.tagline, maxlength: 90 });
  const applyBrand = (partial, message) => {
    app.saveBranding(partial);
    const badge = $("#puVersionBadge");
    if (badge) badge.textContent = "v" + (app.branding.get().version || app.config.version);
    toast(message, "success");
  };
  primaryInput.input.addEventListener("change", () => applyBrand({ primary: primaryInput.value }, "Primary colour updated"));
  accentInput.input.addEventListener("change", () => applyBrand({ accent: accentInput.value }, "Accent colour updated"));
  titleInput.input.addEventListener("change", () => applyBrand({ appTitle: titleInput.value.trim() }, "App title updated"));
  taglineInput.input.addEventListener("change", () => applyBrand({ tagline: taglineInput.value.trim() }, "Tagline updated"));

  const brandResetBtn = actionButton({
    label: "Reset branding",
    variant: "secondary",
    icon: "refresh",
    onClick: async () => {
      const sure = await confirmDialog({
        title: "Reset branding?",
        message: "This clears your custom colours, title and tagline and restores the values defined in main.pjs.",
        confirmText: "Reset branding",
      });
      if (!sure) return;
      app.resetBranding();
      toast("Branding reset to defaults", "success");
      app.render();
    },
  });

  const exportBtn = actionButton({ label: "Export full JSON backup", variant: "secondary", icon: "download" });
  const importBtn = actionButton({ label: "Import / restore from backup", variant: "secondary", icon: "upload" });
  const importFile = h("input", { type: "file", id: "importFile", accept: ".json,application/json", hidden: true });
  exportBtn.addEventListener("click", () => exportBackup(store));
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", (e) => onImportFileChange(e, store, app));

  const migrateBtn = actionButton({ label: "Import from Project Master", variant: "secondary", icon: "link2" });
  migrateBtn.addEventListener("click", () => import("./pm/migrate.js").then((M) => M.pickAndMigrate(store, () => app.render())));

  const snapBtn = actionButton({ label: "Snapshot now", variant: "secondary", icon: "camera" });
  const bhList = h("div", { class: "bh-list", id: "bhList" }, h("div", { class: "at-empty" }, "Loading…"));
  const clearBtn = actionButton({
    label: "Clear all data…",
    variant: "danger",
    icon: "trash",
    onClick: async () => {
      const total = store.records.size;
      if (total === 0) {
        toast("Nothing to clear — your workspace is already empty", "info");
        return;
      }
      const first = await confirmDialog({
        title: "Clear all data?",
        message: "You're about to permanently delete " + total + " records. It's strongly recommended to export a backup first.",
        confirmText: "Continue…",
        cancelText: "Cancel",
        danger: true,
        html: `<button class="btn btn-primary" style="width:100%;" data-export>${ICONS.download} Export a backup first, then continue</button>`,
      });
      if (!first) {
        toast("Cancelled", "info");
        return;
      }
      const second = await confirmDialog({
        title: "Really delete everything?",
        message: "Final confirmation. This wipes every record from this browser. It cannot be undone.",
        confirmText: "Delete everything",
        cancelText: "Keep my data",
        danger: true,
      });
      if (!second) {
        toast("Nothing was deleted", "info");
        return;
      }
      store.wipeAll();
      toast("All data cleared", "success");
      app.render();
    },
  });

  const renderBhList = async () => {
    const B = await import("./pm/backup.js");
    const snaps = await B.listSnapshots(store);
    bhList.innerHTML = B.backupHistoryHTML(snaps);
    B.wireBackupHistory(bhList, store, renderBhList);
  };
  renderBhList();
  snapBtn.addEventListener("click", async () => {
    const B = await import("./pm/backup.js");
    const snap = await B.takeSnapshot(store);
    if (!snap) {
      toast("Snapshots unavailable right now", "error");
      return;
    }
    toast("Snapshot saved — " + snap.count + " records", "success");
    renderBhList();
  });

  // ── local-first storage status (task 16) ──────────────────────
  // Live proof that everything persists locally through the kv-plugin: record
  // count, where it lives, and (when the browser exposes it) storage usage.
  const storageStats = h("div", { class: "store-stats" }, h("p", { class: "muted small" }, "Checking local storage…"));
  const renderStorageStats = async () => {
    const counts = ENTITY_TYPES.map((t) => [t, store.count(t)]).filter(([, n]) => n > 0);
    const total = counts.reduce((sum, [, n]) => sum + n, 0);
    let estimateLine = null;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        estimateLine = "This site is using about " + formatBytes(usage) + (quota ? " of ~" + formatBytes(quota) + " available" : "") + " (all generator data combined).";
      }
    } catch (e) { /* storage estimate unavailable — older/embedded browsers */ }
    const rows = [
      h("p", { class: "store-line" },
        h("b", {}, total + " record" + (total === 1 ? "" : "s")),
        " stored in ", h("code", {}, "kv-plugin → IndexedDB"),
        " · folder ", h("code", {}, store.folder)),
      counts.length ? h("p", { class: "muted small" }, counts.map(([t, n]) => n + " " + t + (n === 1 ? "" : "s")).join(" · ")) : null,
      estimateLine ? h("p", { class: "muted small" }, estimateLine) : null,
      h("p", { class: "muted small" }, "Everything is written to this browser only — there is no account and no sync, and nothing is uploaded to a server. Export a JSON backup to move your data to another device."),
    ];
    storageStats.replaceChildren(...rows.filter(Boolean));
  };
  renderStorageStats();

  const dangerGroup = settingGroup(
    "Danger zone",
    h("p", { class: "muted", style: "font-size:.85rem;" }, "Permanently delete every record (" + ENTITY_TYPES.join(", ") + "). Requires a double confirmation."),
    h("div", { class: "btn-row" }, clearBtn)
  );
  dangerGroup.classList.add("danger-zone");

  outlet.replaceChildren(
    h(
      "div",
      { class: "view-head" },
      h("h1", {}, h("span", { class: "vh-ico", html: ICONS.settings }), " Settings"),
      h("p", { class: "sub" }, "Preferences are saved locally and restored on load.")
    ),
    h(
      "div",
      { class: "settings-cols" },
      h(
        "div",
        {},
        settingGroup("Profile", fieldStack(nameInput)),
        settingGroup(
          "Appearance",
          h(
            "div",
            { class: "field" },
            h("label", {}, "Theme"),
            themeGrid,
            h("p", { class: "muted small", style: "margin-top:8px;" }, "Themes come from the Template-U framework and style every view. Use the moon/sun button in the header to switch light ↔ dark instantly.")
          )
        ),
        settingGroup(
          "Focus timer",
          fieldGrid(numInput("Work (min)", "focusWork", s.focusWork, 180), numInput("Short break (min)", "focusShort", s.focusShort, 60), numInput("Long break (min)", "focusLong", s.focusLong, 90)),
          h("p", { class: "muted", style: "font-size:.78rem;" }, "Used by the Focus timer — new sessions pick these up immediately.")
        ),
        settingGroup("Local-first storage", storageStats)
      ),
      h(
        "div",
        {},
        settingGroup(
          "Branding",
          h("p", { class: "muted", style: "font-size:.85rem;" }, "These values come from the Template-U branding configuration. Changing them re-skins the whole app instantly and is remembered on this device."),
          fieldGrid(primaryInput, accentInput),
          fieldStack(titleInput, taglineInput),
          h("div", { class: "btn-row" }, brandResetBtn),
          h(
            "p",
            { class: "muted small" },
            "Company ",
            h("b", {}, brand.companyName || "—"),
            " · logo mark ",
            h("b", {}, brand.logoMark || brand.appShortTitle || "—"),
            " · footer ",
            h("b", {}, brand.footer || "—"),
            " · v",
            brand.version || app.config.version
          )
        ),
        settingGroup(
          "Backup & restore",
          h("p", { class: "muted", style: "font-size:.85rem;" }, "Your data never leaves your device. Export a JSON backup of everything, or restore from a previous backup (this replaces all current data)."),
          h("div", { class: "btn-row" }, exportBtn, importBtn, importFile)
        ),
        settingGroup(
          "Migrate from Project Master",
          h("p", { class: "muted", style: "font-size:.85rem;" }, "Coming from the original Project Master app? Open its backup file here. Your old data is upgraded to the current schema, checked for broken links, and shown as a summary before anything is imported — then merged into (or used to replace) this workspace."),
          h("div", { class: "btn-row" }, migrateBtn),
          h("p", { class: "muted small" }, "In Project Master, use Export JSON backup first, then bring that file here.")
        ),
        settingGroup(
          "Backup history",
          h("p", { class: "muted", style: "font-size:.85rem;" }, "Snapshots are taken automatically as you work — a fresh one at most every 5 minutes, keeping the latest 30. Restore any snapshot to roll your whole workspace back to that moment."),
          h("div", { class: "btn-row" }, snapBtn),
          bhList
        ),
        dangerGroup,
        settingGroup(
          "About this app",
          h(
            "p",
            { class: "muted", style: "font-size:.85rem;" },
            brand.appTitle,
            " — the Project Manager member of the ",
            h("b", {}, "Project U"),
            " family, built on the ",
            h("b", {}, "Template-U"),
            " framework. v",
            brand.version || app.config.version,
            " · schema v" + SCHEMA_VERSION + " · local-first (IndexedDB)."
          )
        )
      )
    )
  );
}
// ══════════════════════════════════════════════════════════════ Diagnostics =
export const diagnostics = {
  render(outlet, ctx) {
    outlet.innerHTML = `
      <div class="view-head"><h1><span class="vh-ico">${ICONS.help}</span> Diagnostics</h1>
      <p class="sub">Run the in-browser validation suites. Framework tests cover the Template-U primitives; data tests cover the local-first store and every feature module.</p></div>
      <div class="panel">
        <div class="backup-row">
          <button class="btn btn-primary" id="diagRunBtn">${ICONS.play} Run all tests</button>
          <span class="muted small" id="diagSummary">Not run yet.</span>
        </div>
        <div id="diagResults"></div>
      </div>`;
    const runBtn = $("#diagRunBtn");
    const summary = $("#diagSummary");
    const results = $("#diagResults");
    runBtn.addEventListener("click", async () => {
      runBtn.disabled = true;
      summary.textContent = "Running…";
      results.innerHTML = `<p class="muted" style="margin-top:12px;">Running suites — this exercises the data layer in throwaway storage and may take a few seconds…</p>`;
      let framework;
      let data;
      try {
        framework = await runAllFrameworkTests();
      } catch (e) {
        framework = { ok: false, total: "0/0", error: String(e && e.message ? e.message : e) };
      }
      try {
        data = await pmTests.runAllTests();
      } catch (e) {
        data = { total: "0/0", error: String(e && e.message ? e.message : e) };
      }
      renderDiagnostics(results, framework, data);
      summary.textContent = `Framework ${framework.passed || 0}/${framework.total || 0} · Data ${data.total || "0/0"}`;
      runBtn.disabled = false;
    });
  },
};

function renderDiagnostics(results, framework, data) {
  const fwOk = framework.ok !== false && !framework.error;
  const fwSuites = (framework.suites || [])
    .map((s) => {
      const bad = s.results.filter((r) => !r.ok);
      return `<div class="diag-suite">
        <div class="diag-suite-head"><b>${esc(s.name)}</b>
          <span class="pchip ${s.failed ? "over" : "ok"}">${s.passed}/${s.passed + s.failed}</span></div>
        ${bad.length ? `<ul class="diag-fails">${bad.map((r) => `<li>${esc(r.name)}${r.error ? " — " + esc(r.error) : ""}</li>`).join("")}</ul>` : ""}
      </div>`;
    })
    .join("");
  const dataRows = Object.keys(data || {})
    .filter((k) => k !== "error")
    .map((k) => {
      const v = data[k];
      const [p, t] = String(v).split("/").map(Number);
      const cls = t && p === t ? "ok" : "over";
      return `<div class="diag-row"><span>${esc(k)}</span><span class="pchip ${cls}">${esc(String(v))}</span></div>`;
    })
    .join("");
  results.innerHTML = `
    <div class="diag-block">
      <h2>Template-U framework — ${fwOk ? "pass" : "fail"}</h2>
      ${framework.error ? `<p class="muted">${esc(framework.error)}</p>` : fwSuites}
    </div>
    <div class="diag-block">
      <h2>PM-U data & features — ${data.error ? "fail" : "pass"}</h2>
      ${data.error ? `<p class="muted">${esc(data.error)}</p>` : `<div class="diag-rows">${dataRows}</div>`}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════ About ═══
export const about = {
  render(outlet, ctx) {
    const app = ctx.app;
    const cfg = app.config;
    const features = [
      ["dashboard", "Dashboard", "A live count of every record type, plus one-click exports."],
      ["today", "Today", "A focused planner for what's due today and this week."],
      ["portfolio", "Portfolio", "Roll-up health across all projects, with burn-down and focus heat."],
      ["projects", "Projects", "Project workspaces with overview, timeline, brainstorm and Gantt tabs."],
      ["tasks", "Tasks", "Every task in one filterable, sortable list with a full editor."],
      ["calendar", "Calendar", "Month and week views over tasks and events."],
      ["checklists", "Checklists", "Reusable checklist templates with per-item progress."],
      ["notes", "Notes", "A local notebook with tags, pinning, search and import/export."],
      ["habits", "Habits", "Daily habit tracking with streaks and a heat grid."],
      ["focus", "Focus", "A Pomodoro timer that logs focus sessions against tasks."],
      ["boards", "Boards", "Nine brainstorming tools — mind maps, SWOT, RICE, decision matrices and more."],
      ["tags", "Tags", "A tag manager to color, rename and merge tags everywhere."],
      ["ecosystem", "Project U", "Launch sibling Project U tools and share companies/customers by global id."],
      ["assistant", "Assistant", "An AI assistant that plans and reports from your local data."],
    ];
    outlet.innerHTML = `
      <div class="view-head"><h1><span class="vh-ico">${ICONS.briefcase}</span> About ${esc(cfg.appTitle)}</h1>
      <p class="sub">${esc(cfg.tagline)} · v${esc(cfg.version)}</p></div>
      <div class="panel">
        <h2>Local-first by design</h2>
        <p class="muted">Every project, task, event, checklist, note, habit and board is stored in your browser's IndexedDB via the <b>kv-plugin</b>. Nothing is ever uploaded to a server. Export a JSON backup any time from the dashboard or Settings.</p>
        <h2 style="margin-top:16px;">Built on Template-U</h2>
        <p class="muted">${esc(cfg.appTitle)} is a member of the <b>Project U</b> family of small-business generators. It uses the Template-U framework for its shell, theming, router, registry, storage and shared components — so members share behaviour and can be re-themed without touching feature code.</p>
      </div>
      <div class="panel">
        <h2>What's inside</h2>
        <div class="about-grid">
          ${features
            .map(
              ([view, label, desc]) => `
            <a class="about-card" href="#/${view}">
              <span class="about-ico">${ICONS[VIEW_ICON[view]] || ""}</span>
              <span class="about-body"><span class="about-name">${esc(label)}</span><span class="about-desc">${esc(desc)}</span></span>
            </a>`
            )
            .join("")}
        </div>
      </div>
      <div class="panel">
        <h2>Keyboard shortcuts</h2>
        <div class="diag-rows">
          <div class="diag-row"><span>Search palette</span><span class="pchip">Ctrl/Cmd + K</span></div>
          <div class="diag-row"><span>Quick capture</span><span class="pchip">N</span></div>
          <div class="diag-row"><span>Help for this section</span><span class="pchip">?</span></div>
          <div class="diag-row"><span>Close / cancel</span><span class="pchip">Esc</span></div>
        </div>
        <p class="muted" style="margin-top:10px;">Every section also has a <b>?</b> button in the header (and a <b>/help</b> command in the palette) that opens step-by-step instructions for the screen you're on.</p>
      </div>`;
  },
};

// ═════════════════════════════════════════════════════ Project U (Phase 5) ═
// The ecosystem surface: this app's registration descriptor, the family
// launcher, shared company/customer identities, and cross-app references.
// Reference-not-copy: everything here links OUT to sibling generators by URL
// and global shared id — no sibling code is imported.

function copyText(text) {
  const value = String(text || "");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(() => toast("Copied to clipboard", "success", 1600)).catch(() => toast("Copy failed", "error"));
      return;
    }
  } catch (e) { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("Copied to clipboard", "success", 1600);
  } catch (e) {
    toast("Copy failed", "error");
  }
}

function ecoMemberCard(m, { manager = false } = {}) {
  const isSelf = m.id === PM_U;
  const entities = m.entities || [];
  return `<div class="eco-card${isSelf ? " self" : ""}" style="--eco-accent:${m.accent}">
    <div class="eco-card-top">
      <span class="eco-mark">${esc(m.short)}</span>
      <div class="eco-card-id">
        <div class="eco-card-name">${esc(m.title)}${isSelf ? ' <span class="eco-tag">this app</span>' : ""}</div>
        <div class="eco-card-url">${esc(memberUrl(m.id).replace("https://", ""))}</div>
      </div>
    </div>
    <p class="eco-card-desc">${esc(m.description)}</p>
    <div class="eco-card-chips">${entities.length ? entities.map((e) => `<span class="pchip">${esc(e.label)}</span>`).join("") : `<span class="pchip muted">${esc(m.role || "tool")}</span>`}</div>
    <div class="eco-card-actions">
      <a class="btn btn-primary" href="${esc(memberUrl(m.id))}" target="_blank" rel="noopener">${ICONS.external} Open</a>
      <button class="btn ghost" data-eco-copy-link="${esc(memberUrl(m.id))}" title="Copy link">${ICONS.link} Copy link</button>
    </div>
  </div>`;
}

function ecoIdentityRow(store, rec) {
  const links = idmod.identityLinksFor(rec);
  const projects = idmod.identityProjects(store, rec);
  const kindIcon = rec.type === "company" ? "building" : "users";
  return `<div class="eco-id-row" data-eco-id-kind="${rec.type}">
    <span class="eco-id-ico">${ICONS[kindIcon]}</span>
    <div class="eco-id-main">
      <div class="eco-id-name">${esc(rec.name)}</div>
      <div class="eco-id-sid">
        <code>${esc(rec.sharedId || "—")}</code>
        <button class="mini-btn" data-eco-copy-sid="${esc(rec.sharedId || "")}" title="Copy shared id">${ICONS.copy}</button>
      </div>
      <div class="eco-id-meta">${esc(rec.type)}${projects.length ? " · " + projects.length + " project" + (projects.length === 1 ? "" : "s") : " · not linked to a project yet"}</div>
    </div>
    <div class="eco-id-links">
      ${links.map((l) => `<a class="eco-link" href="${esc(l.href)}" target="_blank" rel="noopener" title="Open in ${esc(l.title)}">${esc(l.title)}<span class="eco-link-ico">${ICONS.external}</span></a>`).join("")}
    </div>
    <div class="eco-id-actions">
      <button class="mini-btn" data-eco-id-edit="${rec.id}" data-eco-id-kind="${rec.type}" title="Edit identity">${ICONS.pencil}</button>
      <button class="mini-btn danger" data-eco-id-del="${rec.id}" data-eco-id-kind="${rec.type}" title="Delete identity">${ICONS.trash}</button>
    </div>
  </div>`;
}

function ecoRefRow(root) {
  const m = member(root.app);
  const href = recordHref(root);
  const key = refKey(root);
  return `<div class="eco-ref-row" data-eco-ref-key="${esc(key)}" data-eco-owner="${esc(root.ownerId)}" data-eco-owner-type="${esc(root.ownerType)}">
    <span class="eco-ref-owner" title="${esc(root.ownerType)}">${esc(root.ownerLabel)}</span>
    <span class="eco-ref-member" style="--eco-accent:${m ? m.accent : "#64748b"}">${esc(m ? m.title : root.app)}</span>
    <span class="eco-ref-type">${esc(entityLabel(root.app, root.type))}</span>
    <code class="eco-ref-id" title="${esc(root.id)}">${esc(root.id)}</code>
    <a class="mini-btn" href="${esc(href)}" target="_blank" rel="noopener" title="Open read-only link in ${esc(m ? m.title : root.app)}">${ICONS.external}</a>
    <button class="mini-btn danger" data-eco-ref-del="${esc(key)}" data-eco-ref-owner="${esc(root.ownerId)}" data-eco-ref-owner-type="${esc(root.ownerType)}" title="Remove reference">${ICONS.trash}</button>
  </div>`;
}

function ecosystemHTML(store, app) {
  const cfg = (app && app.config) || {};
  const descriptor = buildMemberDescriptor({
    title: cfg.appTitle || "PM-U",
    version: cfg.version || "0.1.0",
    accent: (cfg.branding && cfg.branding.accent) || undefined,
  });
  const siblings = MEMBERS.filter((m) => m.id !== PM_U);
  const companies = idmod.identities(store, "company");
  const customers = idmod.identities(store, "customer");
  const identities = [...companies, ...customers].sort((a, b) => (a.type === b.type ? String(a.name).localeCompare(String(b.name)) : a.type < b.type ? -1 : 1));
  const refs = idmod.allRefs(store).sort((a, b) => String(a.ownerLabel).localeCompare(String(b.ownerLabel)));
  const totalLinks = identities.reduce((n, r) => n + idmod.identityLinksFor(r).length, 0);

  const identitySection = identities.length
    ? `<div class="eco-list">${identities.map((r) => ecoIdentityRow(store, r)).join("")}</div>`
    : `<div class="proj-empty" style="margin:0;">${ICONS.building}<h2>No shared identities yet</h2><p>Add a company or customer so CRM-U, PSA-U, Quote-U, IT-U and RMM-U can reference the same real-world entity by one shared id.</p></div>`;

  const refSection = refs.length
    ? `<div class="eco-list">${refs.map(ecoRefRow).join("")}</div>`
    : `<div class="proj-empty" style="margin:0;">${ICONS.network}<h2>No cross-app references yet</h2><p>Link a project or task to a record that lives in another Project U tool (an account in CRM-U, an asset in IT-U, a quote in Quote-U…). The link is read-only — it opens the owning app.</p></div>`;

  return `
    <div class="view-head">
      <h1><span class="vh-ico">${ICONS.network}</span> Project U</h1>
      <p class="sub">${siblings.length} sibling tools · ${identities.length} shared identit${identities.length === 1 ? "y" : "ies"} · ${refs.length} cross-app reference${refs.length === 1 ? "" : "s"}. Reference, never copy — everything links out by URL and shared id.</p>
    </div>

    <div class="eco-grid">
      <section class="panel eco-reg">
        <h2>This app's registration</h2>
        <p class="muted">pm-u publishes a machine-readable member descriptor so the central <b>Project-U</b> dashboard and <b>Integrate-U</b> can list, theme and launch it. Same data as <code>src/member.json</code>.</p>
        <div class="eco-reg-card" style="--eco-accent:${descriptor.accent}">
          <span class="eco-mark">${esc(descriptor.short)}</span>
          <div>
            <div class="eco-card-name">${esc(descriptor.title)} <code>${esc(descriptor.id)}</code></div>
            <div class="eco-card-url">${esc(descriptor.url)}</div>
            <div class="eco-id-meta">v${esc(descriptor.version)} · ${descriptor.entities.length} entities · ${esc(descriptor.$schema)}</div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" id="ecoCopyManifest">${ICONS.copy} Copy member manifest</button>
          <a class="btn ghost" href="${esc(descriptor.url)}" target="_blank" rel="noopener">${ICONS.external} Open published page</a>
        </div>
      </section>

      <section class="panel eco-stats">
        <h2>Integration at a glance</h2>
        <div class="eco-stat"><div class="n">${siblings.length}</div><div class="l">Sibling tools</div></div>
        <div class="eco-stat"><div class="n">${identities.length}</div><div class="l">Shared identities</div></div>
        <div class="eco-stat"><div class="n">${totalLinks}</div><div class="l">Identity links</div></div>
        <div class="eco-stat"><div class="n">${refs.length}</div><div class="l">Cross-app refs</div></div>
        <p class="muted small">Shared ids use the family scheme <code>${esc(descriptor.sharedIdScheme)}</code>; they travel between tools in the <code>${esc(descriptor.refParam)}</code> URL parameter.</p>
      </section>
    </div>

    <section class="panel">
      <h2>Project U family</h2>
      <p class="muted">Launch any sibling tool. They stay separate apps on separate origins — pm-u only references them.</p>
      <div class="eco-cards">${siblings.map((m) => ecoMemberCard(m)).join("")}</div>
    </section>

    <section class="panel">
      <div class="view-head-top" style="margin-bottom:8px;">
        <div><h2 style="margin:0;">Shared identities</h2><p class="muted" style="margin:4px 0 0;">Companies &amp; customers with a global shared id.</p></div>
        <div class="btn-row">
          <button class="btn" id="ecoNewCompany">${ICONS.building} New company</button>
          <button class="btn" id="ecoNewCustomer">${ICONS.users} New customer</button>
        </div>
      </div>
      ${identitySection}
    </section>

    <section class="panel">
      <div class="view-head-top" style="margin-bottom:8px;">
        <div><h2 style="margin:0;">Cross-app references</h2><p class="muted" style="margin:4px 0 0;">Read-only links from your records to records in other tools.</p></div>
        <button class="btn" id="ecoNewRef">${ICONS.plus} Add reference</button>
      </div>
      ${refSection}
    </section>

    <section class="panel">
      <h2>How linking works</h2>
      <ul class="todo-mini">
        <li>Each company or customer gets a <b>shared id</b> — <code>${esc(descriptor.sharedIdScheme)}</code> — that means the same thing in every member.</li>
        <li>A <b>reference</b> stores that id (and where it lives) on one of your records; the link opens the owning app read-only.</li>
        <li>Open another tool and paste the shared id (or use its <code>${esc(descriptor.refParam)}</code> link) to link the same record from the other side.</li>
        <li>Nothing is copied or uploaded — pm-u keeps its own records and only points at the rest of the family.</li>
      </ul>
    </section>`;
}

function wireEcosystem(store, app, ctx) {
  document.querySelectorAll("[data-eco-copy-link], [data-eco-copy-sid]").forEach((b) =>
    b.addEventListener("click", () => copyText(b.dataset.ecoCopyLink || b.dataset.ecoSid))
  );
  document.querySelectorAll("[data-eco-open]").forEach((b) => b.addEventListener("click", () => window.open(b.dataset.ecoOpen, "_blank", "noopener")));

  const manifestBtn = $("#ecoCopyManifest");
  if (manifestBtn) {
    const cfg = app.config || {};
    manifestBtn.addEventListener("click", () =>
      copyText(JSON.stringify(buildMemberDescriptor({ title: cfg.appTitle || "PM-U", version: cfg.version || "0.1.0", accent: (cfg.branding && cfg.branding.accent) || undefined }), null, 2))
    );
  }

  $("#ecoNewCompany")?.addEventListener("click", () => openIdentityModal(store, "company", null, () => app.render()));
  $("#ecoNewCustomer")?.addEventListener("click", () => openIdentityModal(store, "customer", null, () => app.render()));
  document.querySelectorAll("[data-eco-id-edit]").forEach((b) =>
    b.addEventListener("click", () => openIdentityModal(store, b.dataset.ecoIdKind, store.get(b.dataset.ecoIdKind, b.dataset.ecoIdEdit), () => app.render()))
  );
  document.querySelectorAll("[data-eco-id-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const rec = store.get(b.dataset.ecoIdKind, b.dataset.ecoIdDel);
      if (!rec) return;
      const linked = idmod.identityProjects(store, rec).length;
      const sure = await confirmDialog({
        title: "Delete " + rec.type + "?",
        message: "“" + rec.name + "” will be removed from this app" + (linked ? " and unlinked from " + linked + " project" + (linked === 1 ? "" : "s") : "") + ". The shared id stays valid in other tools.",
        confirmText: "Delete",
        danger: true,
      });
      if (!sure) return;
      for (const p of idmod.identityProjects(store, rec)) {
        store.upsert("project", p.id, rec.type === "company" ? { companyId: null } : { customerId: null });
      }
      store.remove(rec.type, rec.id);
      toast(rec.type === "company" ? "Company deleted" : "Customer deleted", "success");
      app.render();
    })
  );

  $("#ecoNewRef")?.addEventListener("click", () => openRefModal(store, () => app.render()));
  document.querySelectorAll("[data-eco-ref-del]").forEach((b) =>
    b.addEventListener("click", () => {
      idmod.removeRef(store, b.dataset.ecoRefOwnerType, b.dataset.ecoRefOwner, b.dataset.ecoRefDel);
      toast("Reference removed", "success");
      app.render();
    })
  );
}

export const ecosystem = {
  render(outlet, ctx) {
    const store = ctx.app.store;
    outlet.innerHTML = ecosystemHTML(store, ctx.app);
    wireEcosystem(store, ctx.app, ctx);
  },
};

// ── identity editor (company / customer) ─────────────────────────
function openIdentityModal(store, kind, identity, onChange) {
  const isEdit = !!identity;
  const label = kind === "company" ? "company" : "customer";
  const nameField = textInput({ name: "name", label: "Name", value: identity ? identity.name : "", placeholder: kind === "company" ? "Acme Ltd" : "Jane Doe", maxlength: 120, required: true });
  const emailField = textInput({ name: "email", label: "Email", type: "email", value: identity ? identity.email || "" : "" });
  const domainField = textInput({ name: "domain", label: "Domain / website", value: identity ? identity.domain || "" : "", placeholder: "acme.com" });
  const phoneField = textInput({ name: "phone", label: "Phone", value: identity ? identity.phone || "" : "" });
  const notesField = textareaInput({ name: "notes", label: "Notes", value: identity ? identity.notes || "" : "" });

  const save = () => {
    const name = String(nameField.value || "").trim();
    if (!name) {
      nameField.setError("Please give it a name");
      nameField.focus();
      return false;
    }
    const fields = { name, email: emailField.value, domain: domainField.value, phone: phoneField.value, notes: notesField.value };
    if (isEdit) store.upsert(kind, identity.id, fields);
    else idmod.createIdentity(store, kind, fields);
    toast((isEdit ? "Updated " : "Added ") + label, "success");
    if (onChange) onChange();
  };

  const { el } = formModal({
    title: (isEdit ? "Edit " : "New ") + label,
    subtitle: isEdit ? "The shared id never changes — other tools keep their links." : "A global shared id is minted so every Project U tool can reference this " + label + ".",
    className: "eco-modal",
    body: [fieldStack(nameField, fieldGrid(emailField, domainField), fieldGrid(phoneField), notesField)],
    acceptLabel: isEdit ? "Save changes" : "Add " + label,
    onAccept: save,
  });
  submitOnEnter(el, nameField.input);
  focusFirst(el);
  return { el };
}

// ── cross-app reference editor ───────────────────────────────────
function openRefModal(store, onChange) {
  const owners = [];
  for (const type of idmod.REF_OWNER_TYPES) {
    for (const rec of store.all(type)) owners.push({ type, id: rec.id, label: idmod.ownerLabel(store, type, rec) });
  }
  owners.sort((a, b) => String(a.label).localeCompare(String(b.label)));

  if (!owners.length) {
    toast("Create a project or task first — references attach to your records", "error", 4000);
    return null;
  }

  const ownerField = selectInput({
    name: "owner",
    label: "Attach to",
    options: owners.map((o) => ({ value: o.type + "|" + o.id, label: (o.type[0].toUpperCase() + o.type.slice(1)) + ": " + o.label })),
  });
  const targets = MEMBERS.filter((m) => m.id !== PM_U && m.entities.length);
  const memberField = selectInput({ name: "app", label: "Linked tool", options: targets.map((m) => ({ value: m.id, label: m.title })) });
  const entityField = selectInput({ name: "type", label: "Record type", options: [] });
  const idField = textInput({ name: "id", label: "Shared id or external reference", placeholder: "puid~crm-u~account~…", required: true });
  const labelField = textInput({ name: "label", label: "Label (optional)", placeholder: "Shown on the chip", maxlength: 80 });

  const syncEntities = () => {
    const m = member(memberField.value);
    const opts = m ? m.entities : [];
    entityField.input.replaceChildren(
      ...opts.map((e) => {
        const o = document.createElement("option");
        o.value = e.type;
        o.textContent = e.label;
        return o;
      })
    );
  };
  memberField.input.addEventListener("change", syncEntities);
  syncEntities();

  const save = () => {
    const owner = String(ownerField.value || "").split("|");
    const ownerType = owner[0];
    const ownerId = owner.slice(1).join("|");
    const id = String(idField.value || "").trim();
    if (!ownerId) {
      ownerField.setError("Pick a record to attach to");
      return false;
    }
    if (!id) {
      idField.setError("Paste a shared id or reference");
      idField.focus();
      return false;
    }
    const created = idmod.addRef(store, ownerType, ownerId, { app: memberField.value, type: entityField.value, id, label: labelField.value });
    if (!created) {
      idField.setError("That didn't look like a valid reference");
      return false;
    }
    toast("Reference linked", "success");
    if (onChange) onChange();
  };

  const { el } = formModal({
    title: "Add cross-app reference",
    subtitle: "Store a read-only link to a record that lives in another Project U tool.",
    className: "eco-modal",
    body: [fieldStack(ownerField, fieldGrid(memberField, entityField), idField, labelField)],
    acceptLabel: "Link reference",
    onAccept: save,
  });
  focusFirst(el);
  return { el };
}
