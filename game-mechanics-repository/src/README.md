# Game Mechanics Repository

A perchance generator that acts as a living, browsable **archive of game mechanics and ideas**. Each game is catalogued as a structured *mechanic inventory* — the reusable system skeleton with hard numbers — deliberately stripped of flavor (story, lore, names) so systems can be reused and compared across projects.

## How it's organized

- **Categories** (primary grouping, free-form but keep consistent): Simulation & Management, RPG & Narrative, Strategy & Tactics, Puzzle & Logic, Action & Sandbox, Multiplayer & Social, Experimental.
- **Status**: Concept → Prototype → Complete → Archived.
- Each entry has: `id`, `title`, `category`, `status`, `date`, `tagline`, `summary`, `tags`, a `stats` block (key-number chips), and `sections` — each a labeled *system* with individual mechanic bullets.

## Files

- `main.pjs` — all repo data (single `repo` list). Add new games here. Header comment has the full instructions + a note that **bullets must be plain items** (no `key = ` prefix — pjs treats those as properties, not list items, so the UI won't see them).
- `index.html` — the entire UI: index grid with search + category filters, per-game detail view (stat chips + collapsible system accordions), hash routing (`#/game/<id>`), an "Add an entry" modal that offers a copyable template, and **JSON import/export**. Data is read from `root.repo` in a classic script.

## JSON import / export

Header buttons provide data portability:

- **⇩ Export JSON** — downloads the whole dataset (base + any imported entries) as a schema-wrapped `.json` file: `{schema, version, exportedAt, source, games:[...]}`.
- **⇧ Import JSON** — modal to paste JSON or pick a `.json` file. Accepts a wrapped export, a bare array, or a single entry. Valid entries are added (or replaced by matching `id`); invalid ones are skipped and reported. Imports persist in `localStorage` (`game-mechanics-repository-imports-v1`) and are re-applied on every load.

Implementation notes (all in `index.html`): only the *imported* entries (the delta) are stored in localStorage, so base data in `main.pjs` keeps being the source of truth and can be edited freely without being overridden by a stale snapshot. Imported entries are normalized into the in-memory shape (`normalizeImported`) with defaults for missing optional fields (category→Experimental, status→Concept, etc.), so partial/foreign JSON still renders. The import modal is injected via JS (`insertAdjacentHTML`) rather than static HTML to avoid Perchance's curly/square-bracket escaping footgun in HTML text nodes/attributes — keep any JSON sample text inside the script block, never in index.html markup.

## Adding a game

Paste the new inventory, duplicate the `village-sim` block under `games`, replace its contents. The UI picks it up automatically on reload. The "＋ Add an entry" button in the page header shows the exact template with a copy button.

**Naming convention:** entry titles describe the *mechanics*, never the game's name — e.g. "Farming & Life-Sim" (not the game's title), "AI Visual-Novel Engine". This keeps the repo a catalog of reusable systems rather than a list of named games.

## Board-game references (src/*-features.md)

`src/` also holds the 20 board-game feature-reference markdown files (7-wonders, agricola, android-netrunner, arkham-horror, bang, battlestar-galactica, blokus, charterstone, dixit, fallout, gloomhaven, lords-of-waterdeep, lotr-card-game, power-grid, saboteur, shadows-over-camelot, stone-age, the-resistance, wingspan, zombies). They were the source for 20 repo entries (one per file) and are kept as raw reference material. When ingesting a new one: read the file, then add an entry to `main.pjs` following the conventions above. `stardew-features.md` was removed as a duplicate of the already-ingested Farming & Life-Sim entry.

## Theme

"Basic" blueprint/codex aesthetic — paper surface with a faint engineering-grid background, monospace accents, one blue accent color, semantic status colors, and dark-mode support via `prefers-color-scheme`.
