# BrowserQuest 2 — project layout

A multiplayer browser-based ARPG, ported from Mozilla's BrowserQuest (2012) and running
on the Perchance platform with an authoritative `server-plugin` backend.

## Layout

- `main.pjs` — Perchance meta + the `server-plugin` import (top-level `root` globals).
- `index.html` — the entire app shell: intro/start screen, HUD, chat, settings,
  death screen, AND the authoritative game server (the `<script
  type="text/x-server-plugin">` block).
- `src/game.js` — client monolith: game loop, renderer (3-layer canvas), WebSocket
  message handling, input, achievements.
- `src/types.js` — shared wire protocol (`Types.Messages`) + per-game entity/stat
  tables (`kindInfo`, `Properties`, `Formulas`, `MobSpeeds`).
- `src/sprites.json` — sprite atlas layout (offsets + animations) for the entity atlas.
- `src/framework/` — **reusable, game-agnostic engine modules** (engine, pathfinder,
  infomanager, audio, voice). See `src/framework/README.md` for the full architecture,
  the client↔server message protocol, and the reskin checklist. These are stable and
  should be reusable for future themed projects.

## Architecture in one paragraph

The server in `index.html` runs authoritatively in Perchance's synchronous sandbox:
it owns the world (mobs, drops, combat, aggro/hate lists, zones, chat, rate limits),
persists a snapshot to durable byte state every ~10s (with self-healing of static
entities after restarts), and records handler crashes into a readable ring buffer.
Clients connect via `root.createServerSocket()` and exchange compact `[messageId, ...]`
JSON arrays; each client only receives entities in its zone group (adjacent map
cells + door-linked cells) to keep bandwidth low. The client (`src/game.js`) is a thin
renderer: it sends intents (move/attack/loot/open) and draws whatever the server
broadcasts.

## Running

`page_refresh` to load, enter a name, press the play button. WASD/arrows or click to
move, click mobs/items to interact, Enter to chat. Settings (gear icon) toggles
DECtalk voices and music/SFX.
