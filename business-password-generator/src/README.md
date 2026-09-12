# Business Password Generator — Project Notes

A highly configurable password & passphrase generator for business/security teams,
built on Perchance. All 20 roadmap tasks (4 phases) plus the post-roadmap extras
are complete. Theme adapted from the business-template; name requested by the user.

## Roadmap
The source spec lives at `scratch/message-attachments/password-generator-roadmap.md`
(ephemeral — will not persist to a future session). Completed checklists are kept in
`main.pjs` (search "ATOMIC ROADMAP CHECKLIST" and "POST-ROADMAP EXTRAS").

## Architecture
- **main.pjs** — `$meta` (title/description/tags/image/header minimal mode) + the
  roadmap and extras checklists. No logic lives here.
- **index.html** — all page markup + the entire UI wiring script (generation flow,
  masking, persistence, live config, export, history rendering, appearance popover,
  keyboard shortcuts, mobile menu, FAQ accordion, scroll progress, `?test` UI suite).
- **src/passgen.js** — pure, DOM-free engine exposed as `window.Passgen`:
  - `generate(opts)` — character passwords (classes, exact length 8–64, ambiguous
    filter, min-per-class, no-repeat, pronounceable, `custom` char sets).
    Returns `{value, poolSize, entropy}`.
  - `generatePassphrase(opts)` — word lists (common/technical/random), word count,
    separator, word case, injection (digits/symbols, start/end/between/startEnd).
  - `generateBatch({type, count, ...opts})` — up to 50 items.
  - `entropyBits(poolSize, length)` (Task 13), `strengthOf(bits)` (Task 14).
  - `logHistory/getHistory/clearHistory/restoreHistory` — log capped at 50 (Task 15);
    `restoreHistory` + UI localStorage persistence = history survives tab closes (E1).
  - `runSelfTests()` — 39 tests covering all tasks + extras; `Passgen.runSelfTests()`.
- **src/passgen.css** — business-template theme (light/dark via `[data-theme]`, accent
  palettes via `[data-accent]` on `<html>`), all component styles, responsive
  breakpoints (920/640/520px), accessibility styles (skip link, focus-visible,
  prefers-reduced-motion), appearance popover, UI-test panel.

## UI state (index.html)
- `mode` — "password" | "passphrase"
- `maskEnabled` — bullets mask output when on (Task 17); copy/export always use real values
- `lastValue`, `lastBulkItems` — real values backing masked display
- Settings persist to `localStorage["bpg.settings.v1"]` (Task 16): mode, toggles,
  sliders, selects, qty, theme, accent, copy-on-generate, custom char set. Only explicit
  Generate/regen/mode-switch/per-row-regen actions write to history; live config updates
  don't. History persists to `localStorage["bpg.history.v1"]` (E1).

## Post-roadmap extras
- History survives tab closes (E1). Per-row regenerate in bulk list (E2).
- Export TXT/CSV/JSON via `buildExport(fmt, items)` (E3).
- Copy-on-generate checkbox (E4). Custom character sets (E5).
- `?test` or `#test` URL flag → automated UI suite in a bottom-right panel (E6).
- Accessibility: skip link, `:focus-visible`, `role="status"` live output, aria-hidden
  icons, prefers-reduced-motion (E7). Keyboard shortcuts G/C/M/P/? (E8).
- Appearance popover (gear icon in header): light/dark + accent swatches (E9).
- `$meta.image` hosted at `https://user.uploads.dev/file/1e70841689257b883699918c26b91f41.jpg` (E10).

## Testing
- Engine: `Passgen.runSelfTests()` → 39/39.
- UI suite: load the generator with `?test` (or `#test`) in the URL → panel reports
  engine tests, single/batch generation, class constraints, masking, persistence
  round-trips, custom charsets, export builders, keyboard shortcut, mode switch,
  appearance popover/accent. Dismiss with the × button.
- UI flows verified in live preview at desktop + 390px mobile: bulk panel with
  per-row copy/regen, copy-all, TXT/CSV/JSON export, mask/unmask, persistence across
  reload (settings + history), live regeneration on slider/checkbox/select/custom input.
