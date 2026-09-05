# Theme Depo

A browser tool that pulls Obsidian community themes from the **Obsidian Hub** (`publish.obsidian.md/hub`)
and lets you browse, live-preview, and grab them for use in your own generators.

## How it works

- **Catalog**: fetched from the official community theme store
  (`https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json`,
  726 themes) — this is the same machine-readable list the hub's theme-store guide points at, and it
  carries each theme's `repo`, `modes`, `screenshot`, and `legacy` flags. Cached in localStorage for a day.
- **Hub enrichment**: the hub vault's `🗂️ Themes.md` index is fetched once to know which themes are
  documented in the hub and get their page URLs. When you open a theme, its hub page is fetched on
  demand to extract the description (and cross-check author/modes).
- **CSS**: `https://raw.githubusercontent.com/{repo}/HEAD/theme.css` (the theme-store convention) with
  a couple of fallback name variants for legacy themes. Relative `url()`/`@import` references in the CSS
  are rewritten to absolute against the stylesheet's directory so backgrounds/fonts resolve.
- **Preview**: a fake Obsidian workspace (ribbon, file explorer, note in reading mode with headings,
  code, tables, callouts, task lists, tags, properties) is rendered in an iframe. A minimal
  "Obsidian default" base stylesheet (`src/obsidian-base.js`) is injected first so themes that only
  override some CSS variables still look right; the theme's own CSS comes after and wins. The body gets
  `theme-dark`/`theme-light` like real Obsidian, so the Dark/Light toggle is just a class swap.

## Files

- `main.pjs` — config ($meta, kv-plugin import for favorites)
- `index.html` — UI shell (no logic; all code lives in `src/`)
- `src/app.js` — app controller: catalog rendering, search/filter/sort, favorites (kv-plugin, stored
  in the `themeDepo` folder keyed by theme name), detail view, copy/download/embed actions
- `src/data.js` — data layer: fetching + parsing the store JSON, hub index, and hub theme pages
- `src/preview.js` — builds the themed Obsidian iframe document
- `src/obsidian-base.js` — the Obsidian-default base CSS injected under every theme
- `src/style.css` — the depot UI's own styling

## Notes

- The hub access base URL (`publish-01.obsidian.md/access/e25082da…`) is the Obsidian Publish content
  endpoint for the hub; it's stable and allows CORS.
- `github.com/…/raw/…` redirects are blocked by CORS in browsers — always use `raw.githubusercontent.com`.
- Theme CSS is fetched by the user's browser directly (raw.githubusercontent allows CORS). Screenshots
  are `<img loading="lazy">` thumbs served from the same host.
