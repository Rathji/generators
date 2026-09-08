# The Elder Archive

A canonical **Elder Scrolls database generator**. Every game — Arena, Daggerfall, Morrowind,
Oblivion, Skyrim, Online — is ingested into **one shared schema**, stored as JSON in
`src/data/<game>/<category>.json`, and rendered by a themed single-page app.

The project is deliberately split into **structure**, **theme**, and **process**:

| Concern | Where |
| --- | --- |
| Canonical schema (9 entity types) | `src/data/schema.json` |
| Game registry (metadata, status, sources) | `src/data/games.json` |
| Ingested records, one file per game+category | `src/data/<game>/<category>.json` |
| Application (loader, browse, search, detail, roadmap) | `src/app.js` |
| Theme (obsidian & gold, parchment scrolls) | `src/style.css`, `src/emblem.svg` |
| The process — atomic ingestion roadmap | `src/ROADMAP.md` (+ in-app Roadmap tab) |
| Schema specification | `src/SPEC.md` |

## Current state

- **Morrowind** carries all **9 categories**: spells (337 records) and books (101) freshly
  ingested from the **Elder Scrolls fandom wiki**, joining the original demonstration set
  (locations, factions, NPCs, races, creatures, items, quests). Spells are 297 verified /
  40 draft (draft = standard spells whose fandom pages don't exist, cost pending); books
  are 101/101 verified.
- **Skyrim** is in progress: spells (123) and books (91 skill books) ingested from the
  fandom wiki, all verified. The other seven categories are still open.
- **Oblivion** is in progress: spells (320, incl. 20 Shivering Isles) and books (109 skill
  books) ingested from the fandom wiki, all verified. The other seven categories are still open.
- The other three games (Arena, Daggerfall, Online) are registered but **empty**:
  their Roadmap shows exactly what must happen, atom by atom, to ingest them.

## How the data layer works

1. `src/app.js` fetches `schema.json`, `games.json`, then every
   `src/data/<game>/<category>.json` (missing file ⇒ empty category).
2. Records are cross-referenced by **id**: link fields (`"factions": ["blades"]`) resolve to
   other records at render time. The app builds a whole-archive index, so a search matches
   across every game, and every detail scroll links outward to related records.
3. The **Roadmap tab** derives per-game completion from real storage state (records present,
   required fields valid, references resolved, verification ratio) plus a few manual
   checkboxes for subjective editorial work (persisted in `localStorage`).

## Ingestion in one sentence

To add content, follow `src/ROADMAP.md`: register the game, lock sources, align its
terminology to the schema, then ingest **one category at a time** into
`src/data/<game>/<category>.json`, validate against `schema.json`, cross-link by id,
verify, and release.

See `src/SPEC.md` for the exact schema and `src/ROADMAP.md` for the full atomic process.
