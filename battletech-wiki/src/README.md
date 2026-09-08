# BattleTech Wiki (fan wiki)

An unofficial, editable fan wiki for the BattleTech universe & game system, built on the `custom-wiki-plugin`. Live at `https://perchance.org/battletech-wiki`.

## How it's put together

- **main.pjs** — imports the plugin: `wiki = {import:custom-wiki-plugin}` and `uploadPlugin = {import:upload-plugin}` (the wiki's storage dependency). Everything else lives in index.html.
- **index.html** — three parts:
  1. A `<style>` block with host-level theme overrides (see "Customizations" below).
  2. The **119-page seed inlined** as `window.BATTLE_WIKI_PAGES` (13 `concat` blocks) — deliberately NOT loaded from a `src/` file, because the platform's src manifest was once wiped (which erased the wiki); inlining makes the seed part of the core saved files and un-loseable. **This is the only source of truth for the seed** — there is no `src/wiki-pages.js` anymore.
  3. The init script: overrides `root.wiki._wiki_splitRow` (table fix), then calls `root.wiki.wiki({...})` with the full config (`skin:"classic"`, `theme:"dark"`, `accent:"#ff8a1e"` — the BattleTech HUD palette — plus title, channel, storage, admin hash, permission gates), then wires up sidebar auto-scroll to the active page.

## Storage & editing (WORKING)

- Storage is **editable-upload**, channel **"battletech"** → shared public editable file `wiki-battletech-wiki-battletech`. All visitors read/write the same file, so edits persist for everyone.
- Verified working end-to-end (saved generator): the file loads (~267 KB, 119 pages), `setPage` writes persist across a full page reload, no `anti_bot_verification_needed` errors. The earlier platform bug (report 5fdf22cd) is resolved — the old "BROKEN" status and the planned server-plugin fallback are obsolete and were reverted; **do not** re-add the server-plugin.
- The seed in `initialPages` is only written when the wiki file is **empty** (first-ever load), so if the file is ever wiped, deleting it on the upload side (or changing the channel) re-seeds.
- Permissions: anyone can **edit**; logged-in users can **create**; moderators/admins can **delete**. Accounts are on.
- **Admin:** username `Admin`, password hash embedded in index.html config (`adminPasswordHash`). The plaintext admin password was given to the user in chat — the file intentionally stores only the SHA-256 hash.

## Customizations (host-level, in the index.html `<style>` + init script)

- **BattleTech HUD theme (adopted from the `battletech-theme` aesthetic)**: the wiki uses `skin:"classic"`, `theme:"dark"`, `accent:"#ff8a1e"` (amber), and the host `<style>` block re-themes the whole app to the battletech HUD look — dark navy-black radial glow background with a masked amber grid (`body::before`) and CRT scanlines (`body::after`); `--wiki-*` vars overridden to the battletech palette (`--wiki-bg:#0c1015`, `--wiki-fg:#cdd6de`, `--wiki-accent:#ff8a1e`, ...); fonts **Rajdhani** (UI/headings) + **Share Tech Mono** (mono bits) loaded from Google Fonts; amber **inset corner brackets** on all four panel corners (`.wiki-app::before/::after`, z-index 5); header as a status bar with amber diamond logo mark + uppercase letterspaced glow title; chamfered buttons via `clip-path:polygon(...)` with amber-gradient primary; amber nav-active state; amber content links; a fully-styled `.wiki-table` (dark header row, amber-tinted alternating rows — the plugin ships **no** base `.wiki-table` styles, so all table styling lives here); amber blockquote/category chips/tab underline; dark mono textarea; webkit scrollbars. Previous crimson/Wikipedia-skin overrides were removed when this theme was adopted.
- **Sticky sidebar**: the sidebar lists ~120 nav items and otherwise stretches the page to ~4000 px; on desktop (≥761px) it is `position:sticky` + `max-height:100vh` with its own scrollbar. On mobile it falls back to the plugin's standard stacked 32vh panel.
- **Sidebar auto-scroll**: on load and on every `pageChange`, the sidebar scrolls the active page's nav entry into view.
- **Table wikilink fix**: the plugin's `_wiki_splitRow` splits table rows on every `|`, breaking cells like `| [[Page|Label]] | more |`. The init script replaces it (on `root.wiki._wiki_splitRow`) with a pipe-aware splitter that ignores `|` inside `[[...]]`. This is plain JS in a `<script>` — it must stay there, not in main.pjs (pjs forbids dotted top-level names).

## Re-seeding / editing the seed

The seed lives only **inline in index.html** (`window.BATTLE_WIKI_PAGES`). To edit page content: find the page object (`title:`, `body:`) in one of the 13 concat blocks. Page titles/categories are greppable with `grep -n 'title:' index.html`. Note: changing the seed does NOT update already-stored pages — the shared file wins once seeded. To force re-seed of a specific page, delete the wiki file (or change the channel) and reload.

## Incident log

- **Wiki erased (restored):** the generator's `main.pjs` and `index.html` were reset to the Perchance starter template, and the platform's **src manifest** was wiped (so `src/wiki-pages.js` was no longer served). Restored `main.pjs` + `index.html`, and **inlined the 119-page seed into `index.html`** so the wiki no longer depends on the src manifest at all. If the wiki ever shows "no pages yet", first check that `index.html` still contains the inline seed block.
- **editable-upload write failures (resolved):** the platform's `/api/editableSet` briefly rejected every write with `anti_bot_verification_needed` while plain uploads succeeded (filed as platform bug 5fdf22cd). Now verified working; the wiki persists shared edits across reloads. A server-plugin fallback implemented during that window was **reverted** once the backend recovered.
