# Mechanics the Gatherer

A browsable archive of board-game **feature references** — system-level mechanics only, no lore/content detail. Built as a Perchance generator (single-page app in `index.html`, data embedded as `GAME_DATA`).

## Files
- `index.html` — the whole app (CSS + JS + embedded `GAME_DATA` JSON with all games/mechanics).
- `main.pjs` — stub (comment only).
- `src/*-features.md` — one reference file per game: `# Title — Feature Reference`, intro paragraph, then `## Category` sections with `-` bullets. **These are the source of truth**; `GAME_DATA` is generated from them.
- `src/BACKLOG.md` — the BGG geeklist (91 games) with per-game status: which are done, which remain, which variants merge into existing entries.
- `src/geeklist-all.txt` — the full 91-item BGG geeklist with URLs (source list).
- `src/bgg-geeklist-pull.user.js` — Tampermonkey script to re-pull a geeklist from boardgamegeek.com (all pages: rank, title, link, comment, optional mechanics tags).

## JSON interchange format (import/export)
- `src/mechanics.schema.json` — the canonical **JSON Schema (draft-07)** defining the format.
- `src/mechanics.example.json` — a valid example payload (wrapper + games, plain strings and structured mechanics).
- Shape: `{schema:"mechanics-gatherer", version:1, games:[ {id, title, intro?, url?, tags?, categories:[{name, items:[string | {text, id?, tags?}]}]} ]}`.
- A bare game object or bare array of games is accepted on import (auto-wrapped). Every game in the current `GAME_DATA` already validates against the `game` definition.
- The page has **Export JSON** (downloads the whole archive in this format) and **Import JSON** (paste or load a file; adds/replaces games by id, validates structurally, persists imported games in localStorage).

## How to add a game
1. Write `src/<slug>-features.md` in the established format.
2. Re-parse all `src/*-features.md` → JSON and re-inject into `index.html`'s `const GAME_DATA = [...]` (safety: escape `</` as `<\/` when injecting).
3. `page_refresh` and verify search, category filters, counters.

## Conventions
- System-level mechanics ONLY. No lore, story, or content flavor.
- Category names stay consistent across files (e.g. Resource Management, Worker Placement, Deck Building, Player Interaction, Win Condition…).
