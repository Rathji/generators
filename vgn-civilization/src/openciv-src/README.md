# OpenCiv — perchance port

This generator runs **OpenCiv** (https://github.com/RyanGrieb/OpenCiv, MIT license) entirely in
the browser. The original game is a server-authoritative Civ-5-inspired hex strategy game;
this port runs BOTH the Node server and the browser client in one page, wired together by an
in-page transport shim.

## Layout

- `src/game.js` — the shipped engine: esbuild IIFE bundle of the client + server + shims.
- `src/openciv-src/` — the vendored TypeScript source (client/, server/) plus port shims (shims/).
- `src/assets/` — the original image assets (spritesheet, UI skins, fonts, logos).
- `index.html` — page shell (loading element + two canvases) and the game.js script tag.

## Rebuilding game.js

The bundle is built from `src/openciv-src/` with esbuild-wasm inside an execute_js worker.
Load esbuild, initialize with the esm.sh wasm build, and run with a resolve/load plugin that
reads workspace files, aliasing the node packages to the shims:

- `ws` → `shims/ws.ts` (in-page WebSocket transport)
- `random` → `shims/random.ts`
- `crypto` → `shims/crypto.ts`
- `fs` → `shims/fs.ts` (serves inlined config JSON)
- `yaml` → `shims/yaml.ts`
- `node-schedule` → `shims/node-schedule.ts`
- `ts-priority-queue` → `shims/ts-priority-queue.ts` (vendored package)

Entry: `entry.ts` (installs browser globals, boots server module, boots client module).
Output: `format: "iife"`, `target: "es2021"`, `bundle: true`.

## Port-specific patches (vs upstream)

- `client/src/Assets.ts` — assetList uses page-relative `./src/assets/*.png` URLs.
- `client/src/Index.ts` — removed the `?test=true` scenario harness.
- `server/src/map/GameMap.ts` — guards against infinite loops in river/biome generation
  (upstream can hang on small maps / unlucky seeds).
- `shims/ws.ts` — no "message" forwarding listener on the client socket (it echoed the
  client's own outbound sends back to itself, breaking `JSON.parse(event.data)`).
  esbuild must resolve `ws` and `./ws` to the same module id (extension-less paths).

## Gameplay

Single-player (the in-page server only has one connection). Play → Join → pick a civ →
Ready Up. Left-click your unit, right-click a tile to move; select the Settler and use its
settle action to found a city. Next Turn / 60s timer advance the turn.
