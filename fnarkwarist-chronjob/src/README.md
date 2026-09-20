# Fnarkwarist Chronjob — Character Console

A play-manager for a Level 17 Deep Gnome Artillerist / Chronurgy Wizard, built from a D&D Beyond
character sheet. Everything the player tracks during a session lives here: HP/temp HP/death saves,
spell slots, feature uses, companion & summon trackers, consumables, conditions/exhaustion, d20 and
damage rolls, an inventory view, and a journal. All progress auto-saves to `localStorage`
(key `fnarkwarist-sheet-v1`).

## Files

- `main.pjs` — `$meta` (title/description/tags/header) only; this generator is almost entirely DOM app.
- `index.html` — all styling (CSS custom properties at the top define the palette) plus the static
  shell: header/vitals bar, `#tabsnav`, the five `<section class="tabsec">` panes, the dice-roll
  overlay (`#rollOverlay` / `#rollCoreEl`), and the footer.
- `src/data.js` — the character data object (`window.CHAR`): abilities, skills, HP, features,
  spell slots, spells, magic items, consumables, trackers, backstory.
- `src/app.js` — rendering + interactions. Loaded as a classic script, so every top-level function
  is also a global (handy for debugging / `page_eval`).

## Architecture notes

- **State**: a single `S` object (defaults from `defState()`) persisted by `save()`; `load()` merges
  it over the defaults so new fields don't break old saves.
- **Rendering**: one `renderX()` per tab, each blowing away that section's `innerHTML`. All
  interactions are handled by a single delegated `click` listener on `document` that dispatches on
  `[data-act]` attributes (`tab`, `hp`, `slot-inc`, `roll`, `atk-hit`, …). To add a control, give
  it a `data-act` and add a `case` to that switch.
- **Tabs**: `switchTab(name)` toggles `.on` on the nav buttons and the matching `#tab-<name>`
  section, then calls the matching renderer.

## Fullscreen tabs

`#fsBtn` in the tab bar toggles a fullscreen view of whichever tab is active.

- On enter, the active `.tabsec` gets the `.fs` class (fixed overlay covering the viewport,
  `animation: none` so the tab's `fadein` transform can't turn it into a containing block) and a
  `.fsbar` sticky header is prepended, showing the tab title and an "Exit fullscreen" button.
  A native `requestFullscreen()` is attempted first; if it is unavailable/rejected the CSS overlay
  alone is used, so the feature works either way (both paths style through `.fs`).
- `body.fs-open` (set while active) raises `main.wrap`'s `z-index` above the sticky `#topbar`
  (otherwise `main.wrap`'s own `z-index: 1` stacking context would trap the overlay *under* the
  header) and locks body scrolling.
- `#rollOverlay` is re-parented into the fullscreen section while active — dice rolls and toasts
  must stay on screen, and in native fullscreen nothing outside the fullscreen element is rendered.
  It is moved back to `<body>` on exit.
- A `MutationObserver` on the sections re-adds the `.fsbar` and re-parents `#rollOverlay` if a
  render (which replaces `innerHTML`) wipes them out.
- Exit paths: the bar's button, the nav's `#fsBtn` (toggles), `Escape` (CSS mode), or the browser's
  own fullscreen exit (`fullscreenchange`); switching tabs also exits. `stripFs()` restores
  `body.fs-open`, the inline body overflow, and `#rollOverlay`'s parent.

## Player handout

The "📜 View original handout" link in the Journal tab (next to the *Backstory* header) opens the
original two-page campaign handout in an in-app viewer (`#imgOverlay`): a dim backdrop, a titled
bar with an "Open in new tab ↗" link and a close button, and a scrollable/pannable image area.

- The image URL lives in `CHAR.meta.handout` (`src/data.js`). It is a re-encoded 1403×1816 WebP
  (~490 KB) uploaded to `user.uploads.dev`; the source PNG it was made from was a 3 MB screenshot
  of the handout. `#imgEl` keeps a `min`-ish width of 720 px so it stays legible on phones (the
  viewer pans instead of squashing the page down to an unreadable size).
- Closes via the ✕ button, clicking the backdrop, or `Esc`. Like `#rollOverlay` it is one of the
  `FLOATERS` re-parented into the fullscreen tab section, so it also works while a tab is
  fullscreened.

## Gotchas

- `#rollOverlay` has `pointer-events: none`, so it never appears in `elementFromPoint` checks —
  verify it via `getBoundingClientRect` + the `.show` class instead.
- The platform screenshot helper (snapDOM) cannot render `position: fixed` subtrees correctly and
  chokes on `backdrop-filter`; visual checks of the fullscreen overlay need the `.fs` class
  temporarily overridden to `position: static`.
- The platform's normalize.css resets `button { color: inherit }` with *higher* specificity
  (`button:not([disabled])`) than a bare class, so button-styled links must be styled with a
  compound selector (e.g. `.sechead .linkbtn`) or their colour is inherited from the parent.
