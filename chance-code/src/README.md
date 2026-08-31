# Chance Code — a Perchance-focused code editor & agent

Converted from the old "tinker-chance" (Tampermonkey userscript builder) into a code-focused IDE for writing, running, and getting AI help with Perchance generators — modeled after perch-edit.

## What it is
- An in-browser code editor (CodeMirror 6, multi-language: pjs/js/html/css/json/md) for a small virtual file workspace.
- Files persist per-user in the browser via the kv-plugin (`window.root.kv.perchcode`, keys `ws/<path>`). The kv folder keeps the old `perchcode` name internally to preserve existing data across the rename.
- A **Run** button that actually evaluates the user's `main.pjs` (via the real engine's `createPerchanceTree`) and renders their `index.html` square blocks in a sandboxed preview iframe (mini-engine in `src/run.js`).
- An **AI assistant** grounded in the bundled official reference docs (`src/docs/*.md` — the platform reference + plugin skills).
- An **Agent mode** that autonomously plans, writes files, runs, and iterates (bounded loop) to build generators from a natural-language task.
- Terminal (commands + JS REPL), command palette, search-in-workspace, snapshot history (Ctrl+S) with restore/diff, reference library viewer, example generators.

## Architecture
- `main.pjs` — config + imports (`kv`, `ai-text-plugin`, `super-fetch-plugin`) + seed lists (`agentPresets`, `chatSuggestions`).
- `index.html` — IDE shell; loads `<script type="module" src="src/main.js">`.
- `src/main.js` — app controller: workspace/kv store, file tree, tabs, editor wiring, run/preview, panels, palette, search, history, docs, modals, keyboard shortcuts.
- `src/editor.js` — CodeMirror 6 wrapper (language per extension, dirty tracking, cursor reporting).
- `src/run.js` — the Perchance mini-engine: `buildTree` (createPerchanceTree wrapped in ignorePerchanceErrors), `evaluateTemplate` (square-block + `{a|b}` evaluation against the tree, with if/else support, `{a|b}` skipped inside `<style>`/`<script>`), `renderProject`.
- `src/ai.js` — AI chat + Agent loop (JSON-edit protocol), markdown-lite renderer, context selection (docs).
- `src/terminal.js` — command terminal + JS REPL.
- `src/docs/*.md` — the official reference library (platform reference, operating manual, plugin skills). Read-only, fetched at runtime.
- `src/examples/*/` — small real example generators that can be copied into the workspace.

## Notes / gotchas
- Module scripts can't use bare perchance globals: use `window.root.kv...`, `window.root.generateText(...)`, `window.createPerchanceTree(...)`.
- `window.root` is a function object carrying the tree properties (verified: `window.root.generateText` works; do not call `window.root()`).
- The mini-engine is best-effort: no `$meta` processing, no full plugin runtime, `{a|b}` ignored inside style/script, `update()` shimmed via postMessage to the parent (`pc-reroll`), re-renders the whole template.
- Snapshots cap at 30/file under `hist/<path>`.
- The workspace seeds `main.pjs` + `index.html` on first run.
- Delete flow gotcha (fixed): `closeTab()` writes the tab's content back to disk, so deleting a file must close the tab with `{skipWrite:true}` — otherwise the deleted file is immediately re-created.

## Status (verified)
- Editor, tabs, file tree, new-file, rename, duplicate, delete, context menu — all tested working.
- Run/preview evaluates real pjs (if/else, odds, re-roll via postMessage) — verified the seed and example output.
- Search, history (snapshot/view-diff/restore), command palette, docs browser, terminal, keyboard shortcuts (Ctrl+S / Ctrl+Enter / Ctrl+` / Ctrl+K / Ctrl+J / Ctrl+Shift+A / Ctrl+Shift+F / Ctrl+Shift+E / Ctrl+Shift+P) — all tested.
- Responsive: ≤720px sidebar collapses to 156px and preview becomes a full-width overlay; ≥720px side-by-side. Verified at phone & desktop sizes.
- Collapsible sidebar (VS Code-style): chevron in each sidebar header + clicking the active activity icon toggles; Ctrl+Shift+E/F reopen it.
- AI chat + Agent mode work, but the AI text server (`text-generation.perchance.org`) is intermittently slow/unresponsive in some environments. Mitigated with a 45s idle timeout + empty-response abort so chat/agent never hang forever. Not a code bug.
- The preview iframe is sandboxed (opaque origin) — its DOM can't be inspected; verify output via `pvframe.srcdoc` or visually.

## Settings & themes (adapted from rathji-template)
- Gear button (bottom of the activity bar) opens a Settings panel: Theme (dark/light), Accent color swatches (violet/cyan/pink/green/amber), Text size (13/15/16/18), and a Reduce-motion toggle, plus "Reset to defaults".
- Persisted per-user in `localStorage` under `chanceCodeSettings`; applied as an `html.light` class + CSS variables (`--accent`, `--accent-2`, `--fs` via html font-size) + `html.reduce-motion`.
- URL overrides win over saved settings: `?theme=light&accent=%23ec4899&size=16&motion=true`.
- Light theme also switches the CodeMirror editor to a light theme (custom `lightExt` in `src/editor.js`, via a theme `Compartment`) so syntax colors stay readable.
- `src/settings.js` owns load/apply/persist; `main.js` boots it (`initSettings({ toast })`) right after the editor is built. Note: `setTheme` remembers the preference before the first file opens (the view is created lazily), so the theme applies on view creation too.

## Rebuild note
The reference docs under `src/docs/` and examples under `src/examples/` were copied from the agent skill library (`scratch/skills/` in this workspace). Re-extract from the skills zip if needed.
