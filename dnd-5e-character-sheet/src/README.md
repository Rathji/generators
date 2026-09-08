# Runforge

A generic AI image run studio. Originally "Freya" (a single-character portrait production tool); fully stripped of character-specific features and rebuilt as a configurable, multi-run tool.

## Architecture

- **main.pjs** — `$meta` (title/description/tags/image) + three plugin imports:
  - `generateImage = {import:text-to-image-plugin}` — image generation
  - `generateText = {import:ai-text-plugin}` — AI QC gate + the Chat page
  - `superFetch = {import:super-fetch-plugin}` — CORS-free fetch used by the character-sheet importer
- **index.html** — the entire app (single file, module script). Renders 6 pages via `showPage(id)`:
  - **Runs** (`pageRuns`) — run tabs (Standard + add/duplicate/delete), per-run config form, toolbar (Start/Stop/Batch/Auto-run/Watchdog/Prompt), live generation grid, per-run review-sheet list, and collections (AI picks / Phoenix / My picks / Approved).
  - **Review Sheets** (`pageSheets`) — numbered contact sheets; approve / slay-to-tomb / phoenix / star / zoom per image; approve whole sheet; hide sheet. Supports a second-tab review mode (`?review=1` — generation buttons disabled, re-renders on `storage` events).
  - **Tomb** (`pageTomb`) — trashed images with 24h TTL (auto-purge interval), recover (→ recovered grid) or purge.
  - **Data** (`pageData`) — export all (JSON, split into ≤3.5MB part-files), import (merge), pinned backup (kept picks/phoenix/approved only) + restore.
  - **Chat** (`pageChat`) — generic AI companion with fully editable persona (name, system prompt, scene style), streaming replies, memory compaction via summary, scene image generation, log export.
  - **Sheet** (`pageSheet`) — D&D 5e character sheet importer + tracker (see `src/dndsheet.js` below).

## Character Sheet (`src/dndsheet.js`)

Loaded via `<script src="src/dndsheet.js"></script>` in index.html; an IIFE that exposes `window.dndImportFromInput`, `dndClear`, `dndExportChar`, `dndImportFile`, `dndSheetRefresh`, and wraps `window.showPage` to re-render the sheet whenever `pageSheet` opens.

- **Import**: paste a dndbeyond.com character URL or bare ID into `#dndUrlInput`. `extractId()` pulls the numeric ID; `dndImportFromInput()` fetches `https://www.dndbeyond.com/character/{id}/json` via `root.superFetch` (falls back to a `?sharetoken=` retry when the URL includes one). Friendly error if the character is private.
- **Parse** (`parseChar`): normalizes the D&D Beyond JSON — stats (base+bonus+override), proficiency/expertise sets (save subtypes are full names like `strength-saving-throws`; skill subtypes are like `acrobatics` — see `SAVE_FULL`), AC (armor/Unarmored Defense/equipment), initiative (includes flat bonuses like the Alert feat), speed (race + unarmored movement), attacks, hit dice, spell slots + Warlock pact slots (computed from warlock level when the JSON reports 0), spells, resources (class-feature `limitedUse`, only level-scaled or multi-charge ones), features/traits, inventory/coins/weight, notes.
- **Live state** persists to localStorage key **`rf_dnd_char`** (a `char.state` object: hp, temp HP, hit dice used, spell/pact slots used, death saves, inspiration, resources, save/skill prof toggles, stat overrides, alignment, notes). Buttons/dots use delegated `data-act` clicks (`onSheetClick`) and `change` events (`onSheetChange`); every change saves + re-renders.
- Layout is a 3-column CSS grid, collapsing to one column under 760px.

## Data storage

- **localStorage** (keys `rf_*`): `rf_runs` (run configs), `rf_sheets`, `rf_trash`, `rf_userPicks`, `rf_phoenix`, `rf_recovered`, `rf_aiPicks_<runId>` (QC-passed pool, capped 40/run), `rf_chatmem`, `rf_persona`, `rf_prefs` (slow-mode).
- **IndexedDB** `runforge-img` / store `pix` — full-res images by pid (pid = `<runId>-<seq>-<nnn>`). localStorage holds only pids/metadata; images are loaded async into `<img>` elements (`__loadSheetThumbs`, `__loadTrashThumbs`).

## Flow

`runStart(run, autoN)` → loop → `runBatch(run, batchSize)`:
1. Build prompt (run.prompt + cycled "looks" line) → `generateImage` (with retry).
2. If `run.gate` on → `gateImage` (vision call to generateText, expects `PASS`/`FAIL:<reason>`).
3. Accepted pids → persisted to IndexedDB → added to AI picks pool → new review sheet.
4. Anti-bot pacing: `paceDelay()` (slow-mode multiplier) + whole-batch-stall backoff (`blockedUntil`, 4/10/30/60 min, auto-retry) + optional watchdog interval.

## Verification notes

- Sheet/review cards are rendered by `sheetCard(s, idx, inRun)` with `idx` = index into the *full* `getSheets()` array (never a filtered index), so action buttons address the right sheet.
- Container ids are namespaced (`rc_` for review page, `rrc_` for run page) to avoid duplicate-id collisions that broke thumbnail loading.
- `window.runStart` is exposed for scripting/testing (fire-and-forget UI buttons: `runStartNow`, `runBatchNow`, `autoRunNow`, `runStopNow`).
