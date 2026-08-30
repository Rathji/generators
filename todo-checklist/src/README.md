# Checklist (Perchance)

A personal checklist app: sections, checkboxes, priorities, due dates, recurring
items, search, undo, import/export, cloud sync, sharing, stats & streaks.

- `main.pjs` — seed data (`checklist` list) + the upload-plugin import. The FEATURE
  TODO block at the top tracks shipped features; keep it updated.
- `index.html` — everything else (styles + all app JS in one classic script).

## Architecture

- **State** lives in `state = { sections: [...] }`, persisted to localStorage
  under `rathjiGeneratorChecklist`. Every item: `{ id, text, note, prio, due, rec,
  doneAt, done }`. Settings (theme/accent/size/motion/sync) under
  `rathjiChecklistSettings`.
- **Undo**: every mutating action wraps in `withUndo(msg, fn)` which snapshots the
  state to `undoStack` (cap 50) and shows a toast with an Undo button. Background
  maintenance (`applyRecurrence`, auto-sync) deliberately bypasses undo.
- **Render**: `render()` rebuilds `#sectionsCtn` innerHTML. Actions are handled by
  one delegated `click` listener on the container via `data-action` attributes.
  Sections split items into active + completed blocks; search filters with a
  match counter.
- **Per-item badges**: priority dot (`cycleprio`, cycle none→high→med→low),
  due-date (`setdue` opens a hidden `<input type="date">`, `cleardue`), recurrence
  (`cyclerec`, none→daily→weekly→monthly, auto-resets via `applyRecurrence` on
  load + every 60s).
- **Text suffixes** (`parseItemText`) round-trip through Markdown/import/add-box:
  `(high|med|low)`, `(due YYYY-MM-DD)`, `(daily|weekly|monthly)`, `(priv)`,
  `(N views)`, `📁 folder (N)`.
- **Import/export**: JSON (full fidelity incl. `rec`/`doneAt`) and Markdown
  (suffix-based). `doImport(text, forceJson)` merges sections by name or replaces
  (via `importReplace.checked`).
- **Share by URL**: Share button copies `https://perchance.org/<name>?share=<md>`.
  On boot, a `?share=` query param is detected and shown in a confirm modal
  (merge/replace). Works via the same Markdown round-trip.
- **Cloud sync**: upload-plugin editable file. First push creates a random
  `checklist-<hex>` name and stores the `editKey` in settings; later pushes update
  it. Restore pastes a link; optional auto-restore on load (`settings.syncAuto`).
  In an unsaved preview this returns `editable_requires_saved_generator` — the UI
  tells the user to save first.
- **Stats/streaks**: completions are appended to `state.history` (`{d,s,i}`,
  cap 2000) when items are checked. `computeStats()` derives totals, per-day,
  per-section, current & best streaks. Stats modal has a 14-day CSS bar chart.
  Confetti (DOM particles, respects reduce-motion) fires when a section hits 100%.
- **Keyboard shortcuts** (`?` to view): `/` search, `N` add item, `A` add section,
  `U` undo, `C` clear completed, `Esc` close/clear. Ignored while typing or a
  modal is open.

## Notes

- The preview iframe can wedge its `requestAnimationFrame` (platform quirk under
  investigation) — app logic is unaffected, but pixel captures may hang.
- New items added via the per-section add box parse suffixes, so
  `Buy milk (high) (due 2026-09-01) (daily)` works as plain text.
