# The Elder Archive — Atomic Ingestion Roadmap

This is the **process for ingesting and storing each game**. It is *atomic*: every step is
the smallest unit of work that delivers verifiable value, can be done alone, and is either
done or not done — no partial credit. A game is "in the archive" only when every step of
every phase is complete.

The same roadmap is rendered live in the generator's **Roadmap** tab; steps marked
**derived** turn green automatically from the actual stored data (record counts, validation,
resolved references, verification ratio), and steps marked **manual** are editorial
judgements ticked by hand (persisted in the browser).

## Principles

1. **One game at a time, one category at a time.** A category file
   (`src/data/<game>/<category>.json`) is the atomic commit unit — independently written,
   validated, reviewed and revertible.
2. **Schema before content.** Nothing is ingested until the game's terminology is mapped
   to `schema.json`. If the game needs a field, extend the schema first (Phase 2).
3. **No orphans.** A record that references an id that doesn't exist is a failed commit.
4. **Verified > full.** A small fully-verified dataset beats a huge draft heap.
5. **Storage is the source of truth.** The Roadmap's auto-steps read the JSON files, so
   progress can never drift from what's actually shipped.

---

## Phase 0 — Charter

| # | Step | Kind | Definition of done |
|---|------|------|--------------------|
| 0.1 | Register the game in `games.json` | derived | Record has `id`, `title`, `subtitle`, `year`, `era`, `province`, `engine` |
| 0.2 | Write description & accent colour | derived | `description` and `accent` set |
| 0.3 | Set status flag | derived | `status` ≠ `not-started` |

*Output:* one complete row in `src/data/games.json`.

## Phase 1 — Source Acquisition

| # | Step | Kind | Definition of done |
|---|------|------|--------------------|
| 1.1 | Enumerate canonical sources | derived | `sources[]` populated (UESP, Imperial Library, in-game dumps…) |
| 1.2 | Record retrieval metadata | manual | Date, license, scope noted per source |
| 1.3 | Choose extraction method | manual | Per category: manual · scripted · API dump |

*Rule:* every fact ingested in Phase 3 must be traceable to a source from 1.1.

## Phase 2 — Schema Alignment

| # | Step | Kind | Definition of done |
|---|------|------|--------------------|
| 2.1 | Map game terminology → canonical types | manual | e.g. "interior cell" → `locations`; "guild rank" → `factionRank` |
| 2.2 | Record field glossary & notes | manual | Game-specific notes captured |
| 2.3 | Identify extension fields | manual | Schema extended in `schema.json` if needed |

*Gate:* Phases 3–6 **cannot start** until Phase 2 is complete.

## Phase 3 — Atomic Ingestion  ⭐

For **each of the 9 categories** (`locations, npcs, factions, quests, items, spells,
creatures, books, races`) the same atomic unit is repeated:

| Step | Kind | Definition of done |
|------|------|--------------------|
| 3.C.1 Extract records | derived | Category file has > 0 records |
| 3.C.2 Normalize to canonical schema | derived | Every record passes required-field validation |
| 3.C.3 Validate | derived | No missing required fields; enum values legal |
| 3.C.4 Commit to `src/data/<game>/<category>.json` | derived | File loads in-app; records render |
| 3.C.5 Verify in-app | derived | Records searchable + open in detail scroll |

*DoD for a category:* file exists, validates, renders, and its records are cross-referenced.
A category is **complete** only when 100% of its records are `status: verified`.

## Phase 4 — Cross-linking

| # | Step | Kind | Definition of done |
|---|------|------|--------------------|
| 4.1 | Link across types by id | derived | NPC ↔ faction ↔ location ↔ quest links exist |
| 4.2 | Resolve every reference | derived | `linksResolved === linksTotal` — **zero orphans** |
| 4.3 | Confirm search coverage | derived | Game's whole dataset is searchable |

## Phase 5 — Quality & Lore

| # | Step | Kind | Definition of done |
|---|------|------|--------------------|
| 5.1 | Write lore/descriptions | derived | ≥ 60% of records carry lore/rich description |
| 5.2 | Fact-check against sources | manual | Spot-check complete |
| 5.3 | Mark records verified | derived | `verifiedRatio === 1` |
| 5.4 | Editorial pass | manual | Titles, subtitles, cross-reference depth reviewed |

## Phase 6 — Release

| # | Step | Kind | Definition of done |
|---|------|------|--------------------|
| 6.1 | Set `status: complete` | derived | Registry updated |
| 6.2 | Bump `version` | derived | Version string set |
| 6.3 | Snapshot & ship | derived | Data ships with the generator |

---

## Phase 7 — Archive Integrity  (cross-cutting)

Applies to the **whole archive**, not to one game: these steps make the stored data
provably conform to `schema.json`. They are derived from the app's own capabilities
(feature flags in `app.js`), not from any single game's data.

| # | Step | Kind | Definition of done |
|---|------|------|--------------------|
| 7.1 | Validate enum values & unique ids | derived | Every `enum` field holds a legal option; no duplicate id within a game+category |
| 7.2 | Surface an Integrity report | derived | The app lists missing-required, illegal-enum, duplicate-id and orphan-link issues |
| 7.3 | Tighten derived roadmap steps | derived | A step cannot read "done" until its full definition of done holds |
| 7.4 | Standalone validation script | derived | `src/data` can be validated without a browser |
| 7.5 | Every ingested record verified | derived | For every game with data, `verifiedRatio === 1` (this finishes Morrowind's 40 drafts) |

*The defect-fixing half of 7.5 is data work; the rest is app work. Both are tracked
together because "the archive is trustworthy" is one promise.*

## Phase 8 — Archive Experience  (cross-cutting)

| # | Step | Kind | Definition of done |
|---|------|------|--------------------|
| 8.1 | Deep-linkable state | derived | Game, category and open record are encoded in the URL; back/forward work |
| 8.2 | Search upgrade | derived | Debounced, ranked by name, matches highlighted, `/` focuses, result count shown |
| 8.3 | Accessibility | derived | Dialog roles + focus trap/restore; keyboard-activatable cards; labelled search |
| 8.4 | Share & export | derived | Copy a share link and download a record or the whole archive as JSON |

---

## Status vocabulary

`not-started` → no phases begun · `in-progress` → at least one step done ·
`sample` → a demonstration dataset (schema proven, not complete) ·
`complete` → Phase 6.3 done.

## Current state

| Game | Phase | Notes |
| --- | --- | --- |
| Arena | 0 | Registered; nothing ingested |
| Daggerfall | 0 | Registered; nothing ingested |
| **Morrowind** | 3 | All 9 categories populated from UESP & fandom. Spells 337v (all base-game spells incl. abilities & blessings) · Books 101v · Factions 24v (every Great House, guild, cult, legion, vampire clan and native faction) · Creatures 44v (every species: beasts, ash creatures, daedra, Dwemer centurions, kwama, undead, specials) · Locations 100v (every named region, town, village, fort, stronghold, Ashlander camp, landmark, foyada and body of water, plus Vivec's cantons) · demo set in the other four |
| **Oblivion** | 3 | Spells 320v (incl. 20 Shivering Isles) · Books 109v (skill books), both fully verified from fandom; 7 categories open |
| **Skyrim** | 3 | Spells 123v · Books 91v (skill books), both fully verified from fandom; 7 categories open |
| Online | 0 | Registered; nothing ingested |

## Cross-cutting upgrades (Phases 7–8)

Tracked in the app's Roadmap tab under **Cross-cutting Upgrades**, and in `app.js` as
`ARCHIVE_ROADMAP` + `CAPABILITIES`. These apply to the whole archive:

| Phase | Done | Remaining |
| --- | --- | --- |
| P7 Archive Integrity | 7.1 enum/unique-id validation · 7.2 Integrity tab · 7.3 strict derived steps · 7.4 standalone validator (`src/validate.mjs`, shares `src/validate-core.js` with the app) · 7.5 Morrowind fully verified (every record across all ingesting categories) | — (Phase 7 complete) |
| P8 Archive Experience | 8.1 deep links (game/category/record in the hash, back/forward) · 8.2 search (debounced, name-ranked, highlighted, “/” shortcut, result count) · 8.3 accessibility (dialog roles + focus trap/restore, keyboard-activatable cards, labelled search) · 8.4 share/export (copy a deep link, download a record or the whole archive as JSON) | — (Phase 8 complete) |
