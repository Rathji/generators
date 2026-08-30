# Project Master — architecture notes

A local-first project management app built on the **rathji-template**
(https://perchance.org/rathji-template) — its badge/card components are vendored
into `main.pjs`, and its theme system / nav / toasts / modals are vendored into
`index.html`.

**Data rule:** everything lives in the browser (IndexedDB via the kv-plugin).
Nothing is ever uploaded to a server. See `TODO.pjs` for the full roadmap.

## Progress
- **Phase 1 (Tasks 1–16) — DONE.** Persistence layer (`src/store.js`), save
  indicator, settings, export/import backup, clear-all (double-confirm), theme
  (dark/light/system), fullscreen, responsive layout, Ctrl/Cmd+K palette,
  toasts, confirm dialogs, cached-state rendering, dashboard image cards.
- **Phase 2 (Tasks 17–21) — DONE.** `src/projects.js` adds the Projects hub
  (cards grouped by status, next-dated-task line, New project button),
  create/edit project modal (name, color swatches, status, target date,
  description), delete project with "move tasks to Default" vs "delete tasks
  too", and the project workspace (Overview/Tasks/Board/Timeline/Notes/
  Brainstorm tabs — Board/Notes are roadmap placeholders). The
  Overview tab shows 6 stat tiles, quick-add task (title/date/priority),
  due-today / upcoming / overdue-&-undated lists, a milestone manager (add,
  rename, link tasks, delete; auto-checks once all linked tasks are done) and
  project details.
- **Phase 2b (Tasks 22–23) — DONE.** Timeline tab — Gantt-style day strip
  (`timelineData`/`timelineHTML`): month band + day cells with today highlight
  and weekend tinting, one row per dated task/milestone with pill/diamond
  markers, vertical today line, summary chips (dated/overdue/due-today/
  upcoming/undated), undated list. Brainstorm tab — idea cards stored on the
  project record (`addIdea`/`removeIdea`/`promoteIdea`), tag chips, promote an
  idea into a real task (marks it adopted), confirm-delete.
- **Phase 3 (Tasks 24–26) — DONE.** `src/tasks.js` adds the global Tasks view:
  `filterAndSortTasks()` (pure) + `tasksViewHTML`/`wireTasksView`. Toolbar with
  text search, status/priority/project/tag/date-range filters, sort by
  due/priority/title/created/project/status with asc/desc toggle, quick
  done-toggle and confirm-delete per row. `tvState` holds in-session view state.
- **Phase 3b (Tasks 27–30) — DONE.** `src/taskEditor.js` adds the full task
  editor modal (title, status, priority, due date, tags, project, milestone,
  notes) + nested subtasks stored on the task record (`subtasks:
  [{id,title,done}]`, with add/toggle/remove + a progress chip in rows/cards).
  The workspace **Tasks** tab lists a project's tasks with the editor, and the
  workspace **Board** tab is a Kanban board (`boardColumns`, drag & drop +
  arrow buttons, per-column add). `dueHighlight()` (in `src/dates.js`) drives
  consistent overdue (red) / due-today (amber) accenting across the global
  tasks view, workspace tasks tab, Overview lists and board cards.
- **Phase 3c (Task 31) — DONE.** Completed-today tracking. Tasks store a
  `completedAt` timestamp when marked done; the global Tasks view gains a
  clickable stats strip (Open / Overdue / Due today / Completed today) and two
  new "When" filter options (`doneToday`, `doneAny`). Pure helpers:
  `tvStats()` in `src/tasks.js`, `msToIso()` in `src/dates.js`.
- **Phase 4 (Tasks 32–35) — DONE.** `src/calendar.js` adds the Calendar view:
  Monday-first 6×7 month grid (other-month days dimmed, today ring, weekend
  tinting, per-day task chips capped at 3 + "+N more"), a sticky day detail
  panel (open+completed tasks with done-toggle/edit/priority/project and a
  quick-add task box for the selected day), a 7-day week view (columns with
  weekday/day/month headers + today/selected highlighting), and
  prev/next/Today navigation plus a Month/Week toggle. Pure helpers
  (`monthGrid`, `weekDays`, `firstOfMonth`, `monthLabel`, `weekLabel`,
  `tasksByDue`, `eventsForDay`) are covered by `runPhase4Tests`.
- **Phase 4b (Tasks 36–37) — DONE.** `src/events.js` adds event records
  (title/date/times/color/notes), a quick-add Event button in the calendar's
  day panel, and a full event editor modal. Events render as tinted chips in
  month cells and as rows in the day detail panel (edit/delete from there).
  Pure helpers `eventsByDate`/`eventsForDay`/`EVENT_COLORS` covered by
  `runPhase4bTests`.
- **Phase 5 (Tasks 38–42) — DONE.** `src/checklists.js` adds the Checklists
  view: multiple checklist cards with per-item add/toggle/remove, rename and
  delete, a per-card progress bar + counts, and 6 built-in templates (weekly
  reset, trip, moving, launch, standup, grocery). Exports `promptModal`, a
  reusable rename/prompt dialog used by habits/boards too. Covered by
  `runPhase5Tests`.
- **Phase 6 (Tasks 43–50) — DONE.** `src/notes.js` adds the Notes view: rich
  note editor modal (title/body/tags/project), grid list with text search +
  project filter (pinned-first, updated-desc), pin/unpin, delete,
  download-as-.txt, and import for .txt/.md (plain), .docx (mammoth via
  cdnjs, loaded on demand) and .doc (binary text-run extractor). Pure
  `filterNotes`/`togglePin` covered by `runPhase6Tests`.
- **Phase 7 (Tasks 51–56) — DONE.** `src/habits.js` adds the Habits view:
  create habit (name/color/icon), Mon–Sun weekly day grid, streak counter
  (alive through yesterday), lifetime check-in total, an 84-day heat grid
  (last 12 weeks), and a per-habit "show on dashboard" toggle. Pure helpers
  `habitWeek`/`heatGrid`/`habitStats` covered by `runPhase7Tests`.
- **Phase 8 (Tasks 57–62) — DONE.** `src/focus.js` adds the Focus (Pomodoro)
  view: work/short/long modes, an animated SVG ring with gradient, start/
  pause/reset, session completion (chime + toast + auto-advance: after 4 work
  sessions a long break, else short), optional task attachment, and
  configurable durations in Settings. Completed work sessions are logged to
  `focuslog` records for analytics. `modeDurations`/`sessionAdvance`/
  `focusTotals` covered by `runPhase8Tests`.
- **Phase 9 (Tasks 63–73) — DONE.** `src/boards.js` adds the Boards hub + 9
  brainstorming tools: mind map (draggable SVG nodes), Venn diagram (2–3
  sets), pros & cons, SWOT, impact/effort matrix (drag dots), MoSCoW, RICE
  (auto-score table), decision matrix (weighted criteria) and affinity map
  (clusters + tray). Board tool type is stored in `kind` (the record's `type`
  is reserved for the entity type). `boardDefaultData`/`riceScore`/
  `decisionTotals`/`boardCounts` covered by `runPhase9Tests`.
- **Phase 10 (Tasks 74–79) — DONE.** `src/assistant.js` adds the AI Assistant
  view: data-aware streaming chat (a compact workspace snapshot is sent with
  each request; replies stream chunk-by-chunk with a typing indicator),
  prefix-cache-friendly prompt (fixed persona → `<DATA>` → append-only
  `<MESSAGES>` log → `TASK` at the end) with automatic background compaction
  via `getMetaObject`, 6 quick actions, goal-breakdown modal (AI generates a
  numbered plan → one click adds the steps as real tasks with a project
  picker), and per-reply actions (Copy / Save as note / Append to a task).
  Requires `generateText = {import:ai-text-plugin}` in `main.pjs`. Pure
  `buildSnapshot`/`parsePlan`/`quickActionTask` covered by `runPhase10Tests`.
- **Phase 11 (Tasks 80–88) — DONE.** `src/taskTools.js` (80–82) adds recurring
  tasks (daily/weekly/monthly with interval, `nextRecurrenceDate`,
  `spawnNextInstance`, hooked into `markTaskDone`), task dependencies
  (`depRecords`/`isBlocked`/auto Blocked status + auto-restore on completion,
  used by tasks view, board cards and the Gantt), and per-task time tracking
  (`timeEntries`/`addTimeEntry`/`logManualTime`/`startTracking`/`stopTracking`,
  live tickers in the tasks view and task editor). `src/gantt.js` (83) is a
  real Gantt tab in each project workspace: day-grid columns, planned bars
  (created → due, project target date as fallback end), an "actual" overlay for
  completed tasks, milestone diamonds, dependency arrows (SVG), a today line
  and a legend; row click opens the task editor. `src/today.js` (84) is a
  daily planner view: a 24h timeline (2px/min) with timed events + focus
  sessions and a red "now" line that auto-scrolls into view, plus all-day /
  anytime tasks (priority-sorted) and overdue carry-over on the side.
  `src/portfolio.js` (85) is a cross-project dashboard: progress bars per
  project, a 14-day overdue burn-down, and a focus-minutes capacity heat map;
  project cards navigate to the workspace. `src/attachments.js` (86) lets
  tasks and notes carry files stored locally as data-URLs on the record
  (max 4 MB each, images preview inline, everything else downloads; section
  renders inside the task & note editors). `src/tags.js` (87) is a global tag
  manager: per-tag colors persisted in `settings.tagColors` and applied to
  every task/note chip (`--tcol` + `color-mix`), plus rename/merge and remove
  across all entities (case-insensitive, original casing preserved) in a Tags
  sidebar view. `src/backup.js` (88) adds versioned backups: full-workspace
  snapshots into a per-store `pm_backups` kv folder, auto-taken at most every
  5 minutes (throttled in localStorage), pruned to the latest 30, with
  restore/delete from a Backup history panel in Settings. All pure helpers
  covered by `runPhase11Tests` (90 asserts).
- **Phase 11 (Tasks 89–91) — DONE.** `src/exports.js` (89) exports real file
  formats: tasks/events CSV (proper RFC-style quoting), notes/checklists
  Markdown, and a standards-compliant `.ics` calendar (VEVENTs for events as
  floating local times, VTODOs for dated tasks with DUE;VALUE=DATE and
  COMPLETED status). Export buttons live on the Dashboard panel and on each
  relevant view (Tasks · CSV, Calendar · .ics, Notes · .md, Checklists · .md).
  `src/report.js` (90) generates a weekly report: `weekRange` + a pure
  `buildReportSnapshot` (last-7-days completions, created, overdue, focus
  minutes, habit streaks, per-project progress, events, checklist totals) fed
  to a prefix-cache-friendly prompt; `openWeeklyReportModal` streams the AI
  reply with Copy / Save-as-note. `src/quickcapture.js` (91) adds a floating
  "Add anything" pill + the `N` hotkey; `parseQuickInput` routes text by
  prefix (`t:`/`n:`/`e:`, `@project`, `#tag`, `p:high|med|low`, `!high`,
  date words like `tomorrow` / `in 2d` / `next monday` / `YYYY-MM-DD`, and a
  `HH:MM` time for events) and `commitQuickCapture` creates the entity. All
  pure helpers covered by `runPhase12Tests` (36 asserts).
- Next: Tasks 92–101 — remaining Phase 11 backlog (keyboard nav, print mode,
  project templates, focus analytics, archive & review, smart inbox, PWA,
  a11y/polish, sync via upload/server plugins, iframe embed + .ics + REST bus).

## Files
- `main.pjs` — `$meta` (incl. the listing-page image), the
  `kv = {import:kv-plugin}` and `generateText = {import:ai-text-plugin}`
  imports, and the vendored rathji `rathjiTemplate()` / `rathjiCard()`
  components.
- `index.html` — app shell: theme system (light/dark/system via
  `html[data-theme]`), top nav (save indicator, search, theme, fullscreen,
  settings, hamburger), responsive sidebar (label-only sleek menu — active item
  is a purple→cyan gradient pill; narrower at ≤980px, drawer at ≤760px), main
  content area, toast/modal/palette containers. Holds all CSS (hub cards,
  workspace tabs, stat tiles, task/milestone rows, project modal, timeline,
  brainstorm, tasks-view toolbar/rows, task editor + subtasks, kanban board,
  overdue/today highlighting).
- `src/store.js` — the persistence layer (Task 1). Exports `Store`,
  `SCHEMA_VERSION`, `ENTITY_TYPES`, `DEFAULT_SETTINGS`, `uid()`.
- `src/app.js` — boot/shell wiring (theme, save indicator, sidebar, router)
  and the Dashboard view. Routes `projects` (hub vs workspace via viewParams),
  `tasks`, `calendar`, `checklists`, `notes`, `habits`, `focus`, `boards`
  (hub vs board workspace), `today`, `portfolio`, `tags` and `assistant`
  (dynamic import of `src/assistant.js`); re-renders on store change. The
  Dashboard's quick-access grid is built from a curated `CARD_TYPES` list and
  carries the Export & weekly report panel; boot also mounts the quick-capture
  pill via `src/quickcapture.js`.
- `src/dates.js` — local-TZ date helpers (`todayLocal`, `isoDay`, `parseIso`,
  `addDays`, `dayDiff`, `formatDay`, `formatWeekday`, `relDay`,
  `dueHighlight`).
- `src/projects.js` — Phase 2/2b module: project stats, hub, project modal,
  delete modal, workspace, Overview tab, milestone manager, timeline
  (task 22), brainstorm (task 23), workspace Tasks tab + Kanban board
  (`boardColumns`, tasks 27/29), overdue/today row highlighting.
- `src/tasks.js` — Phase 3 module: `filterAndSortTasks`, `tvState`, `tvStats`,
  tasks view + wiring (tasks 24–26, 31) with edit-button wiring to the editor.
- `src/calendar.js` — Phase 4/4b module: Calendar view (tasks 32–37) — month
  grid, day detail panel, week view, prev/next/Today + Month/Week toggle,
  event chips + day-panel event rows and the event editor wiring. Pure
  helpers `monthGrid`/`weekDays`/`tasksByDue`/`eventsForDay` etc.
- `src/events.js` — Phase 4b module (tasks 36–37): `EVENT_COLORS`,
  `eventsByDate`, `eventsForDay`, the event editor modal (`openEventEditor`).
- `src/checklists.js` — Phase 5 module (tasks 38–42): `CHECKLIST_TEMPLATES`
  (6), `templateById`, `checklistStats`, `addItem`/`toggleItem`/`removeItem`/
  `renameChecklist`, the checklists view + `newChecklistModal`, and the
  reusable `promptModal` (shared with habits/boards).
- `src/notes.js` — Phase 6 module (tasks 43–50): `filterNotes`, `togglePin`,
  note editor modal, notes view, download-as-txt, and the .txt/.md/.docx/.doc
  import pipeline.
- `src/habits.js` — Phase 7 module (tasks 51–56): `habitWeek`, `heatGrid`,
  `habitStats`, `toggleDay`, habit cards + `newHabitModal`, `HABIT_COLORS`,
  `HABIT_ICONS`.
- `src/focus.js` — Phase 8 module (tasks 57–62): `MODES`, `modeDurations`,
  `sessionAdvance`, `focusState`, `focusTotals`, ring + focus view, chime.
- `src/boards.js` — Phase 9 module (tasks 63–73): `BOARD_TYPES` (9),
  `boardDefaultData`, `riceScore`, `decisionTotals`, `boardCounts`, the hub +
  `newBoardModal`, `boardViewHTML`/`wireBoardView`, and one section per tool
  (`mindmapHTML`/`wireMindmap`, `venn…`, `proscons…`, `swot…`, `matrix…`,
  `moscow…`, `rice…`, `decision…`, `affinity…`).
- `src/assistant.js` — Phase 10 module (tasks 74–79): `buildSnapshot` (pure),
  `parsePlan` (pure), `QUICK_ACTIONS`/`QUICK_ACTION_LIST` +
  `quickActionTask`/`quickActionLabel` (pure), `chatState`/`clearChat`,
  `buildPrompt` + `maybeCompact` (prefix-cache-friendly, background
  compaction), `assistantViewHTML`/`wireAssistantView` (streaming chat,
  quick actions, goal-breakdown modal, reply actions Copy/Save-as-note/
  Append-to-task). Reply-action listener is bound once per page load via a
  module-level `replyActionsBound` guard.
- `src/taskEditor.js` — Phase 3b module: `openTaskEditor` modal (task 27),
  subtask helpers `parseTags`/`subtaskStats`/`addSubtask`/`toggleSubtask`/
  `removeSubtask`/`updateTask` (task 28). Since Phase 11 it also carries the
  Repeats (recurrence), Depends-on, and Time-tracked sections of the editor.
- `src/taskTools.js` — Phase 11 module (tasks 80–82): recurring
  (`nextRecurrenceDate`, `recurrenceLabel`, `spawnNextInstance`,
  `onTaskCompleted`), dependencies (`depRecords`, `openDeps`, `isBlocked`,
  `blockDependents`, `unblockDependents`), time (`timeEntries`, `taskTimeMs`,
  `formatMs`, `addTimeEntry`, `logManualTime`, `startTracking`, `stopTracking`,
  `runningTrackers`). All pure — covered by `runPhase11Tests`.
- `src/gantt.js` — Phase 11 module (task 83): `ganttRows`/`ganttSpan` (pure,
  tested) + `ganttHTML`/`wireGantt` — the per-project Gantt tab.
- `src/today.js` — Phase 11 module (task 84): `todayState`, `todayData` (pure,
  tested) + `todayViewHTML`/`wireTodayView` — the Today / daily planner view.
- `src/portfolio.js` — Phase 11 module (task 85): `portfolioData`,
  `overdueBurnDown`, `focusHeat` (pure, tested) + `portfolioViewHTML`/
  `wirePortfolioView` — the cross-project Portfolio view.
- `src/attachments.js` — Phase 11 module (task 86): `attachData`,
  `removeAttachment`, `isImage`, `fileSizeLabel` (pure, tested) +
  `attachmentSectionHTML`/`wireAttachmentSection`/`fileToDataUrl` — the file
  attachment section rendered inside task & note editors.
- `src/tags.js` — Phase 11 module (task 87): `allTags`, `setTagColor`,
  `tagColor`, `renameTag`, `removeTag` (pure, tested) +
  `tagsViewHTML`/`wireTagsView` — the global tag manager view (sidebar item
  under Notes; re-renders via `window.pm.renderView`).
- `src/backup.js` — Phase 11 module (task 88): `backupFolder`,
  `snapshotKey`, `listSnapshots`, `takeSnapshot`, `restoreSnapshot`,
  `deleteSnapshot`, `maybeAutoSnapshot` (pure-ish, tested) +
  `backupHistoryHTML`/`wireBackupHistory` — versioned snapshots in a per-store
  `pm_backups` kv folder, surfaced in Settings.
- `src/exports.js` — Phase 11 module (task 89): `tasksToCSV`, `eventsToCSV`,
  `notesToMD`, `checklistsToMD`, `icsCalendar` (all pure, tested) +
  `downloadTasksCSV`/`downloadEventsCSV`/`downloadNotesMD`/
  `downloadChecklistsMD`/`downloadICS` — format exports surfaced on the
  Dashboard and each relevant view.
- `src/report.js` — Phase 11 module (task 90): `weekRange`,
  `buildReportSnapshot` (pure, tested), `buildReportPrompt` +
  `generateWeeklyReport` (streams via `root.generateText`) +
  `openWeeklyReportModal` (Copy / Save-as-note) — the weekly report modal,
  opened from the Dashboard.
- `src/quickcapture.js` — Phase 11 module (task 91): `parseDateWord`,
  `parseQuickInput`, `commitQuickCapture` (pure, tested) +
  `initQuickCapture` (floating pill + `N` hotkey, mounted from app.js boot).
- `src/icons.js` — SVG icon set (plus, pencil, link, arrowLeft, flag,
  lightbulb, arrowUp, arrowDown, filter, target, arrowRight, clock, pin,
  repeat, link2, stopwatch, play, pause, refresh, copy, send, eye, printer,
  archive, inbox, tag, paperclip, camera, help, chart, briefcase, music, …).
- `src/tests.js` — validation tests (`runDataLayerTests`, `runPhase1Tests`,
  `runPhase2Tests`, `runPhase2bTests`, `runPhase3Tests`, `runPhase3bTests`,
  `runPhase3cTests`, `runPhase4Tests`, `runPhase4bTests`, `runPhase5Tests`,
  `runPhase6Tests`, `runPhase7Tests`, `runPhase8Tests`, `runPhase9Tests`,
  `runPhase10Tests`, `runPhase11Tests`, `runPhase12Tests`,
  `runAllTests` — 397 asserts total), run against a throwaway kv folder so the
  user's real data is never touched.

## Running the tests
In the live preview console (via `page_eval`):

```js
return await (await import("./src/tests.js")).runAllTests();
```

Each run uses a random `pm_test_*` kv folder so the user's real data is never
touched.
