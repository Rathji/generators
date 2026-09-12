# Tower Defense — Star Wars Edition

A complete, self-contained canvas tower-defense game for Perchance. Top-down grid maps,
path-following enemies, four turret families with 4 upgrade tiers each, shields/armour/status
effects, Force powers, a controllable Jedi hero, four planets, boss waves, endless mode, and a
full menu/select/brief/pause/result/settings/tutorial flow.

## How it loads

- `main.pjs` (generator root) holds only page metadata (`$meta`, including `$meta.image`), the
  roadmap checklist, and a couple of imports. No game logic.
- `index.html` is the HTML body: the HUD, canvas stage, build dock, tower panel, all overlays,
  and all CSS (the "holo" theme). It ends with `<script type="module" src="./src/main.js">`.
- `src/*.js` are plain ES modules. `src/main.js` boots `createApp()` from `src/ui.js` and exposes
  the app as `window.swtd` (used by tests/tools: `swtd.draw()`, `swtd.step(dt)`, `swtd.game`).

There are no `{import:...}` game dependencies — everything needed ships in `src/`.

## Module map

| File | Responsibility |
| --- | --- |
| `src/config.js` | All tunable data: `GRID` (16×10, 62px cells), `DIFFICULTIES`, `TOWERS` (blaster/laser/missile/ion × 4 tiers), `ENEMIES` (13 variants), `PLANETS` (Tatooine/Hoth/Endor/Death Star: palettes, waypoints, enemy pools, decor, boss), `ABILITIES`, `HERO`, `THEME`, `ACCENTS`. Balance changes belong here. |
| `src/game.js` | `Game` class — the whole simulation. Map building (`buildMap`, `pointAtDist`), phase machine, economy, wave composition, enemies, towers (place/upgrade/sell/targeting), projectiles (single/splash/chain/ion), damage & armour/shield resolution, status effects (slow/stun/break), Force abilities, hero, particles, `summary()`. |
| `src/render.js` | All canvas drawing. Pre-renders terrain per planet into an offscreen cache (`getTerrain`/`invalidateTerrain`), then draws path, decor, gates, towers, hero, enemies (procedural silhouettes per `shape`), projectiles, beams, particles, floaters, ghost previews and range circles. Also `draw()` (the frame entry point). |
| `src/ui.js` | `createApp({canvas, ctx})` — DOM wiring: overlays & screens, build dock, ability bar, tower panel, canvas input (pointer → cell), HUD updates, game lifecycle, toasts, settings, keyboard shortcuts, and the rAF loop (fixed 1/60s steps × game speed). Returns `{init, draw, step, get game}`. |
| `src/audio.js` | WebAudio synth SFX (`play(name)`) and procedural menu/combat music (`music(mode)`). No audio files. |
| `src/save.js` | localStorage persistence (`swtd.save.v1`): unlocked planets, stars per planet, best scores, lifetime totals, settings, tutorial-seen flag. |

## Key mechanics

- **Economy:** start credits 260; kills grant bounty; building/upgrading costs; selling refunds 70%.
- **Targeting:** `First` (furthest along path), `Closest`, `Strongest` (highest HP).
- **Damage model:** `damage` is reduced by `armor`; `ion` projectiles strip `shield` first and stun
  droids; `laser` pierces armour; `missile` does splash; `blaster` is cheap/rapid but ground-only.
- **Flying enemies** (TIE Fighter / Interceptor) follow the path with a hover offset; most turrets
  can still hit them except the blaster.
- **Bosses:** final wave of a planet (or every 5th wave in endless) spawns a boss with an ability
  (`forceChoke`, `lightning`).
- **Progression:** clearing a planet unlocks the next; stars are awarded by lives remaining.
- **Endless mode:** waves never stop; hp/speed scale indefinitely.

## Verifying changes

The live preview heavily throttles `requestAnimationFrame` while the editor is in the background,
so the game loop does not visually animate there. To exercise it programmatically:

```js
// in page_eval (after page_refresh)
const { Game, pointAtDist } = await import("./src/game.js");
const g = new Game(0, "normal");
for (let i = 0; i < 120; i++) g.update(1/60);
// render it to a temp canvas with render.js: draw(ctx, g, {hover:{c:-1,r:-1}, quality:"high"})
```

For UI flows, click the real buttons (`#btnPlay` → `#btnLaunch` → `#btnBegin`) and wait for a rAF
frame so the HUD refreshes. Sprites can be inspected in isolation by importing `body` from
`src/render.js` and drawing each `ENEMIES[id]` shape scaled up — this is how the unit art was
iterated (see NOTES below).

## Notes / art direction

- Enemy and tower sprites are drawn procedurally (no image assets). Each enemy `shape` string in
  `config.js` maps to a branch in `body()` in `render.js`; towers are drawn by `drawTower()`.
- Enemies get a soft light halo in `drawEnemy()` so dark units (Vader, Palpatine) stay readable on
  the dark Tatooine road.
- **Terrain** is baked once per planet into an offscreen cache by `makeTerrain()` (see
  `getTerrain`/`invalidateTerrain`). It is built from layers: a base gradient, large soft mottling
  blobs (organic variation), fine grain, a per-`decor` surface pass (`rock` → ripples/pebbles,
  `ice` → drifts/streaks, `tree` → grass blades/clutter/logs, `panel` → beveled metal plates with
  rivets), a **faint dotted placement grid** (alpha kept low so it reads as a guide, not a floor),
  then the path (drop shadow + edge + worn centre highlight + sandy edge-nibbling), decor
  (`drawDecor`, each prop with a soft contact shadow), a vignette, and the spawn/exit gates. Tune
  base colours in `config.js` `PALETTES` (`bg`/`bg2`/`tileA`/`path`/`pathEdge`/`grid`).
- The menu/overlay backgrounds use a CSS starfield (`#spaceBg` + `.overlay` background layers) and a
  corner planet; the in-game HUD/dock are glassy panels over the starfield.
- `$meta.image` is a full-page gameplay snapshot (HUD + map + dock).

## Rebuild / regeneration recipe (for the meta image)

Launch a game, spawn a wave, then snapshot the whole page with
`(await import("https://ai-agent.perchance.org/files/snapshot.js")).capture()`, save the PNG, and
`upload_file` it; put the returned URL in `main.pjs` under `$meta.image`. A known-good example:
`https://user.uploads.dev/file/52cba91c5c4b59591cd572c96f4fb90d.png`.

## Roadmap

The original task list is kept verbatim in
`src/tower-defense-star-wars-edition-atomic-roadmap.markdown`; the checklist in `main.pjs` maps every
item to the file that implements it.
