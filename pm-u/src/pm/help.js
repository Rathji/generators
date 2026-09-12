// src/pm/help.js — per-section user instructions (Phase 8, task 37).
//
// Every section registers a HELP entry keyed by its registry id; `openHelp(id)`
// renders it into a modal so a first-time user always has in-context guidance.
// The header "?" button opens the entry for the section currently on screen
// (see src/app.js), and the `?` shortcut does the same. Entries are plain data
// (no functions) so they stay easy to audit and translate.

import { ICONS } from "./icons.js";
import { openModal, esc } from "./ui.js";

const SHORTCUTS = [
  ["Ctrl/Cmd + K", "Open the search palette (records, sections and /commands)"],
  ["N", "Quick capture a task, note or event"],
  ["?", "Show help for the section you're viewing"],
  ["Esc", "Close a modal, menu or the palette"],
];

export const HELP = {
  dashboard: {
    icon: "home",
    title: "Dashboard",
    intro: "Your home base — a live snapshot of everything in the workspace, plus import/export and reporting shortcuts.",
    steps: [
      { h: "Read your totals", p: "The stat cards count every project, task, event, checklist, note and habit you own. They update instantly as you add or complete things — nothing here is a stored snapshot." },
      { h: "Check in on habits", p: "The “Today's habits” strip shows the habits you've pinned to the dashboard. Tap a habit to mark it done for today (tap again to undo); the small badge shows its current streak. Opt a habit in from the Habits view." },
      { h: "Back up or restore", p: "“Export JSON backup” downloads a complete backup; “Import backup” reads one back. “Migrate from Project Master” upgrades data exported from the original app." },
      { h: "Generate a weekly report", p: "“Weekly report” streams an AI summary of the last seven days. When it finishes you can copy it or save it straight to Notes." },
    ],
    tips: [
      "Everything is stored locally in your browser — use Export regularly if the data matters.",
      "The search palette (Ctrl/Cmd + K) is the fastest way to jump anywhere.",
    ],
  },

  today: {
    icon: "timer",
    title: "Today",
    intro: "A focused, single-day planner combining your timed events, due tasks and logged focus time.",
    steps: [
      { h: "Move between days", p: "Use ‹ / › to step a day, or “Today” to snap back to the current date. The day summary shows what's due, what's overdue and total focus time." },
      { h: "Work the list", p: "Tick a task's checkbox to complete it in place. Overdue tasks carried over from earlier days appear at the top so nothing slips." },
      { h: "See your schedule", p: "Events with a start time are laid out on the timeline; all-day items sit in their own list. Click an entry to open its editor." },
    ],
    tips: ["Tasks with no due date never appear here — give them a date to plan them into a day."],
  },

  portfolio: {
    icon: "chart",
    title: "Portfolio",
    intro: "A roll-up view of all projects for spotting which ones need attention, across progress, effort and focus.",
    steps: [
      { h: "Scan the ledger", p: "The sortable table lists every project with its status, progress, task counts and health. Click a column header to sort, or use the search box to narrow the list." },
      { h: "Open a project", p: "Click any row to jump straight into that project's workspace." },
      { h: "Read the charts", p: "The burn-down and focus-heat panels summarise delivery over time — hover a bar or cell for its exact value." },
    ],
    tips: ["Set each project's status and target date in the project editor; the health column derives from those."],
  },

  projects: {
    icon: "folder",
    title: "Projects & workspaces",
    intro: "Projects are the containers everything else hangs off. Each one has a workspace with tabs for planning and review.",
    steps: [
      { h: "Create a project", p: "“New project” asks for a name, colour, status and optional target date. You can also link it to a shared company/customer identity from the Project U family." },
      { h: "Use the workspace tabs", p: "Overview shows stats, milestones and Project-U links; Tasks is the project's task list with quick-add; Board is a drag-and-drop kanban; Timeline plots tasks across dates; Gantt draws bars, milestones and dependencies; Notes holds notes attached to this project; Brainstorm captures and promotes ideas." },
      { h: "Track milestones", p: "Add named milestones with due dates, then tick the tasks that belong to each. A milestone counts as complete when its linked tasks are done." },
      { h: "Manage the project", p: "Edit or delete it from the workspace header. Deleting a project removes it and its attached notes/boards — tasks without a project survive." },
    ],
    tips: [
      "On touch devices, move cards with the ‹ › arrows on a kanban card — drag-and-drop is a desktop convenience.",
      "Use the Board's per-column “+” to add a task already placed in the right status.",
    ],
  },

  tasks: {
    icon: "check",
    title: "Tasks",
    intro: "Every task in one place, with filtering, sorting and a full editor for dependencies, subtasks and recurrence.",
    steps: [
      { h: "Add and edit", p: "“New task” opens the editor: title, project, status, priority, due date, tags, notes and optional subtasks. Click any task to reopen it." },
      { h: "Filter and sort", p: "Use the toolbar to filter by status or project and sort by due date, priority or created date. Search narrows by title and tag." },
      { h: "Chain work together", p: "Add prerequisites under “Depends on”. A task with unfinished prerequisites is flagged as blocked; completing a prerequisite clears the block." },
      { h: "Set up repeating work", p: "Give a task a recurrence and it re-schedules itself automatically the next time you mark it done." },
    ],
    tips: ["Mark tasks done from the checkbox in any list — you don't need to open the editor."],
  },

  calendar: {
    icon: "calendar",
    title: "Calendar",
    intro: "Month and week views over both deadlines (tasks) and appointments (events).",
    steps: [
      { h: "Switch views", p: "Toggle between Month and Week. Use ‹ / › / “Today” to navigate." },
      { h: "Read a day", p: "Each day cell shows chips for its tasks and events; click a day to open its side panel with the full list." },
      { h: "Add something", p: "Create a task or event from the day panel, or pick an existing entry to edit it." },
    ],
    tips: ["Events can be timed or all-day; tasks appear on their due date."],
  },

  checklists: {
    icon: "checkSquare",
    title: "Checklists",
    intro: "Reusable templates with items you tick off — ideal for repeatable processes.",
    steps: [
      { h: "Create a checklist", p: "“New checklist” takes a name and an optional starting template — weekly reset, packing, product launch and more — or you can create a blank list." },
      { h: "Tick items off", p: "Each card is its own list. Click an item's check button to mark it done (click again to reopen it); the progress bar and count fill as you go." },
      { h: "Add and rename", p: "Type into the “Add an item…” box at the bottom of a card to extend the list; click a card's title to rename the whole checklist." },
      { h: "Tidy up", p: "The × beside an item removes just that item; the trash button in a card's header deletes the entire checklist. “Export .md” writes every checklist to one Markdown file." },
    ],
    tips: ["Checklists are reusable templates, not dated tasks — tick them, then uncheck to run the process again from scratch."],
  },

  notes: {
    icon: "file",
    title: "Notes",
    intro: "A local notebook with tags, pinning, search and import/export. Notes can also be attached to a project.",
    steps: [
      { h: "Write and organise", p: "“New note” opens the editor: a title, a body, optional tags and an optional project. Pinned notes float to the top." },
      { h: "Search and filter", p: "Type in the search box to match title and body; the project dropdown filters to one project (or notes with no project)." },
      { h: "Import and export", p: "“Import” accepts .txt, .md, .docx and legacy .doc files. “Export .md” writes every note out as one Markdown file. Each card also has a download-as-.txt and delete button." },
      { h: "Notes inside projects", p: "A project's workspace has its own Notes tab showing just that project's notes; “New note” there pre-fills the project for you." },
    ],
    tips: ["Importing a .docx reads the document text — formatting is intentionally flattened to plain text."],
  },

  habits: {
    icon: "zap",
    title: "Habits",
    intro: "Daily check-ins with streaks and a heat grid, so consistency is visible at a glance.",
    steps: [
      { h: "Create a habit", p: "Give it a name, pick an icon and a colour — anything you want to do (or avoid) regularly." },
      { h: "Check in", p: "Tap a day cell in the current Mon–Sun week to mark the habit done (tap again to undo). Today's column is highlighted." },
      { h: "Watch your progress", p: "The stat row shows your current streak, best streak, this week's check-ins and lifetime total; the heat grid maps the last 84 days." },
      { h: "Pin to the dashboard", p: "Tick “Show on dashboard” to add the habit to the Dashboard's Today's-habits strip." },
    ],
    tips: [
      "Streak math only counts days you actually checked in — a missed day resets the run.",
      "Habits can't be edited after creation — delete and recreate one to change its name, icon or colour.",
    ],
  },

  focus: {
    icon: "play",
    title: "Focus",
    intro: "A Pomodoro timer that logs each session against a task so your effort shows up in reports.",
    steps: [
      { h: "Pick a task", p: "Choose a task from the dropdown (or leave it unassigned) so the session is credited correctly." },
      { h: "Start and pause", p: "“Start” begins the countdown; “Pause” holds it; “Reset” clears the current session. Work and break durations come from Settings." },
      { h: "Finish a session", p: "When the timer ends you'll get a toast offering to start a break — sessions are logged automatically and appear in Today and the Portfolio heat." },
    ],
    tips: ["The document title shows the live countdown, so you can run the timer in a background tab."],
  },

  boards: {
    icon: "grid",
    title: "Boards",
    intro: "Nine structured thinking tools for planning and decisions — mind map, Venn, pros/cons, SWOT, impact-effort, MoSCoW, RICE, decision matrix and affinity.",
    steps: [
      { h: "Create a board", p: "“New board” asks for a title and a type. Each type lays out a different framework for the same underlying data." },
      { h: "Add and edit entries", p: "Add items to the appropriate cells/lanes. RICE and decision-matrix boards score entries numerically so they can be ranked." },
      { h: "Review and delete", p: "Open a board any time to refine it; boards live in the Boards list and can be removed from there." },
    ],
    tips: ["SWOT / pros-cons / MoSCoW are great as quick project pre-mortems — create one from a project's Brainstorm tab and promote the winners to tasks."],
  },

  tags: {
    icon: "tag",
    title: "Tags",
    intro: "One manager for every tag used across tasks, notes and projects.",
    steps: [
      { h: "Colour and rename", p: "Assign a colour to a tag, or rename it — the change applies everywhere the tag is used." },
      { h: "Merge duplicates", p: "Merge one tag into another to consolidate near-duplicates without editing every record." },
      { h: "Find usage", p: "Each row shows how many records carry the tag, so you can spot strays." },
    ],
    tips: ["Tags with no colour fall back to the theme accent; new tags are never auto-coloured."],
  },

  ecosystem: {
    icon: "network",
    title: "Project U",
    intro: "The hub connecting PM-U to the other Project U members — reference-not-copy, by shared id.",
    steps: [
      { h: "See the family", p: "The registration card shows PM-U's member manifest (copy it as JSON to register the app elsewhere). Member cards link out to each sibling tool." },
      { h: "Share identities", p: "Companies and customers become shared identities with a `puid~…` id. A sibling can deep-link here with ?ref=<id>&name=<label> and PM-U adopts or reuses that identity." },
      { h: "Link records across apps", p: "Add cross-app references (CRM-U, PSA-U, Quote-U, IT-U, RMM-U and so on) to a project, task, event, checklist, note, habit or board. Each ref shows as a read-only chip that opens the record in its home app." },
    ],
    tips: ["Nothing about a sibling is copied in — PM-U only stores ids and links, so the apps stay independent."],
  },

  assistant: {
    icon: "sparkle",
    title: "Assistant",
    intro: "An AI assistant that can see a snapshot of your local workspace to plan, summarise and advise.",
    steps: [
      { h: "Ask or use a quick action", p: "Type a question, or pick one of the quick-action chips (what to do first, plan my week, and so on). Replies stream in as they're written." },
      { h: "Act on a reply", p: "Each reply has Copy, Save as note and Append to task buttons so you can keep what's useful." },
      { h: "Start over", p: "“New chat” clears the conversation; “Break down a goal” turns a goal into a set of tasks in a project." },
    ],
    tips: [
      "A snapshot of your workspace is sent with each request and nothing else leaves the browser — always verify important suggestions.",
      "The Assistant can be disabled in Settings if you don't want AI features.",
    ],
  },

  settings: {
    icon: "settings",
    title: "Settings",
    intro: "Appearance, branding, focus durations, storage and data management — all stored locally.",
    steps: [
      { h: "Appearance", p: "Choose a light or dark theme; the moon/sun button in the header switches instantly too." },
      { h: "Branding", p: "Set the primary and accent colours, the app title and the tagline. Overrides re-skin the app immediately and are remembered on this device; “Reset branding” restores the built-in look." },
      { h: "Profile & focus", p: "Set your display name and the work / short-break / long-break lengths the Focus timer uses." },
      { h: "Storage & data", p: "The Local-first storage panel shows how much you're using and confirms nothing is uploaded. Export or import JSON backups, migrate from Project Master, and manage Backup history (restore a snapshot or delete it) from the panels below." },
      { h: "Danger zone", p: "“Clear all data” permanently erases every local record (double-confirmed)." },
    ],
    tips: ["Branding overrides survive reloads and are stored under the `pu-pm` namespace."],
  },

  diagnostics: {
    icon: "help",
    title: "Diagnostics",
    intro: "Run the built-in validation suites in your browser to confirm the app and its data layer are healthy.",
    steps: [
      { h: "Run the suites", p: "“Run all tests” executes the framework suite and the feature/data suite, listing every assertion with a pass/fail mark and timing." },
      { h: "Read failures", p: "A failed assertion shows its message inline, which is the fastest way to report a problem accurately." },
    ],
    tips: ["The suites are read-only — running them never alters your real data."],
  },

  about: {
    icon: "briefcase",
    title: "About",
    intro: "What PM-U is, how it stores data, and a quick index of every section.",
    steps: [
      { h: "Learn the model", p: "PM-U is local-first: every record lives in your browser via the kv-plugin and is never uploaded." },
      { h: "Explore", p: "The “What's inside” grid links to every section; the keyboard-shortcut panel lists the global hotkeys." },
    ],
    tips: ["Press ? on any section for instructions specific to that screen."],
  },
};

// Project-workspace sub-tabs get their own names in the help title.
const TAB_TITLES = {
  overview: "Project · Overview",
  tasks: "Project · Tasks",
  board: "Project · Board",
  timeline: "Project · Timeline",
  gantt: "Project · Gantt",
  notes: "Project · Notes",
  brainstorm: "Project · Brainstorm",
};

export function helpFor(id) {
  return HELP[id] || HELP.dashboard;
}

function shortcutsHTML() {
  return `
    <section class="help-sec">
      <h4>Global shortcuts</h4>
      <div class="diag-rows">
        ${SHORTCUTS.map(([k, d]) => `<div class="diag-row"><span>${esc(d)}</span><span class="pchip">${esc(k)}</span></div>`).join("")}
      </div>
    </section>`;
}

// openHelp(id) → modal. `opts.tab` (a project workspace tab) only changes the
// displayed title so the guidance feels anchored to the screen it was opened on.
export function openHelp(id, opts = {}) {
  const entry = helpFor(id);
  const title = TAB_TITLES[opts.tab] && id === "projects" ? TAB_TITLES[opts.tab] : entry.title;
  const ico = ICONS[entry.icon] || ICONS.help;
  const { el, close } = openModal(`
    <div class="modal-card help-card" role="dialog" aria-modal="true" aria-label="Help: ${esc(title)}">
      <button class="modal-x" data-x title="Close" aria-label="Close help">${ICONS.x}</button>
      <div class="help-head">
        <span class="help-ico">${ico}</span>
        <div>
          <h3>${esc(title)}</h3>
          <p class="modal-sub">${esc(entry.intro)}</p>
        </div>
      </div>
      <div class="help-body">
        ${(entry.steps || []).map((s) => `<section class="help-sec"><h4>${esc(s.h)}</h4><p>${esc(s.p)}</p></section>`).join("")}
        ${(entry.tips && entry.tips.length) ? `<section class="help-sec"><h4>Tips</h4><ul class="help-tips">${entry.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></section>` : ""}
        ${shortcutsHTML()}
      </div>
      <div class="modal-btns">
        <button class="btn btn-primary" data-help-close>Got it</button>
      </div>
    </div>`);
  if (!el) return;
  el.querySelector("[data-help-close]")?.addEventListener("click", () => close());
  const first = el.querySelector("[data-x]");
  if (first) first.focus();
}
