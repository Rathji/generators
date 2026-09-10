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
| Shared validation core (app + CLI) | `src/validate-core.js` |
| Standalone validator — `node src/validate.mjs` | `src/validate.mjs` |
| Theme (obsidian & gold, parchment scrolls) | `src/style.css`, `src/emblem.svg` |
| The process — atomic ingestion roadmap | `src/ROADMAP.md` (+ in-app Roadmap tab) |
| Schema specification | `src/SPEC.md` |

## Current state

- **Morrowind** carries all **9 categories**: spells (337 records), books (101), factions
  (24 — every Great House, Imperial guild and legion, cult, vampire clan and native faction),
  creatures (44 — every species from UESP's Beasts, Ash Creatures, Daedra, Dwemer
  Centurions, Kwama, Undead and Special Creatures lists) and locations (100 — every named
  region, town, village, Imperial fort, House stronghold, Ashlander camp, landmark, foyada
  and body of water on UESP's *Places* page, plus Vivec City and its cantons) freshly
  ingested from **UESP** and the **Elder Scrolls fandom wiki**, joining the original
  demonstration set (NPCs, races, items, quests). All 337
  spells are verified — the final 40 drafts (Dagoth Ur abilities, blessings, and
  standard spells) were filled from UESP's school tables and the fandom ability infoboxes,
  with costs, canonical effect names and durations; every record has at least one effect
  string. Books (101/101), factions (24/24), creatures (44/44) and locations (100/100) are
  fully verified, the factions carrying their favored attributes and skills, ten-rank
  ladders and joinable status from UESP, the creatures carrying sourced health, soul-gem
  tier, attacks, variant lists and drops, and the locations carrying their region, type,
  description and verified cross-references.
- **Skyrim** is in progress: spells (123) and books (91 skill books) ingested from the
  fandom wiki, all verified. The other seven categories are still open.
- **Oblivion** is in progress: spells (320, incl. 20 Shivering Isles) and books (109 skill
  books) ingested from the fandom wiki, all verified. The other seven categories are still open.
- The other three games (Arena, Daggerfall, Online) are registered but **empty**:
  their Roadmap shows exactly what must happen, atom by atom, to ingest them.
- Cross-cutting (archive-wide) work is tracked as **Phases 7–8** of the roadmap and in-app
  under **Cross-cutting Upgrades** (`ARCHIVE_ROADMAP` + `CAPABILITIES` in `src/app.js`).
  **Both phases are complete.** An **Integrity** tab validates every record (required
  fields, legal enum values, unique ids, resolved cross-references) and flags any issue;
  the derived roadmap steps are strict (a step only reads "done" when its full definition
  of done holds); and `node src/validate.mjs` runs the identical rules over `src/data`
  without a browser, sharing `src/validate-core.js` with the app so the two can never
  drift. The reading experience is deep-linkable (**game, category and open record are in
  the URL hash**, with back/forward), search is debounced, name-ranked, highlights matches,
  focuses on `/` and reports a result count, the UI is keyboard-navigable (dialog roles,
  focus trap/restore, cards and links activated with Enter/Space, labelled search), and any
  view can be shared as a link or exported as JSON (a single record or the whole archive).

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
