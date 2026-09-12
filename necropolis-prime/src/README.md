# Necropolis Prime

A fully explorable, procedurally generated **city of the dead** built with three.js, running as a
Perchance generator. Every seed builds a new city: radial avenues lined with tombs, concentric ring
roads, wedge-shaped wards, a glowing Sanctum at the heart, wandering spirits, readable epitaphs, and
seven collectible Soul Sigils.

- Public generator: `https://perchance.org/<generatorName>` (name lives in `window.generatorName`)
- Entry: `index.html` (body contents only) + `main.pjs` (Perchance lists/config) + `src/necropolis/*.js`
- three.js is loaded from `https://esm.sh/three@0.160.0` at runtime (no bundler).

## What the player does

1. **Explore** a first-person city (WASD + mouse look; Shift to run; on-screen touch controls on mobile).
2. **Read epitaphs** on tombs/monoliths (procedurally generated from name + deed fragments).
3. **Talk to spirits** (12 of them) — AI-generated dialogue via `ai-text-plugin` (`generateText`).
4. **Gather 7 Soul Sigils** from shrines scattered through the wards.
5. **Open the Sanctum** at the center: climb the steps to the sealed doors and the finale streams
   an AI "revelation" as the fog lifts and exposure ramps up.

## Mobile / touch controls

An on-screen control scheme that can be toggled on/off, for phones/tablets:

- **Toggle** from the menu (`Mobile Controls: ON/OFF`) or the in-game HUD pill (`TOUCH ON/OFF`,
  right edge mid-height). The choice is persisted in `localStorage["np-touch"]`.
- **Auto-enabled** on coarse-pointer / touch-capable devices the first time (`touchCapable` in
  `main.js`); otherwise defaults off. `document.body` gets a `.touch` class while enabled.
- **Overlay** (`#touchUI` in index.html, logic in `main.js`): a fixed visual joystick (`#joyBase` +
  `#joyKnob`) bottom-left, a round **ACT** button (`#actBtn`) bottom-right, and a smaller **RUN**
  (`#runBtn`) hold-to-sprint button beside it. ACT = the `E` key (interact, or close an open panel);
  prompts read "TAP" instead of "[E]" when touch is on.
- **Movement/look** live in `bindControls` (`player.js`): left 40% of the canvas is the joystick zone
  (drives `player.joy`), the rest is drag-to-look; both are gated by `setTouchEnabled(bool)`. While a
  panel is open the player is frozen (`player.frozen`) and `#touchUI` gets `.reading` (joystick +
  ACT/RUN hidden); a `CLOSE` button (`#panelClose`) appears on the panel.
- `#touchUI` is inert (`pointer-events:none`) unless `.active` (touch on AND in-game), so it never
  steals clicks from the canvas or the menu.

## Persistence, import & export

Progress persists through `kv-plugin` (IndexedDB, per-user, per-generator) — see `src/necropolis/save.js`.

- **Saved shape**: `seed`, `sigilsTaken` (indices into `city.shrines`), `finaleTriggered`/`finaleLit`,
  last `position` (`x`/`z`/`yaw`), plus version/generator/timestamp. The seed is stored too, so a
  reload rebuilds the exact same city.
- **Autosave**: on taking a sigil, when the finale triggers, every ~6s while playing, and when the tab
  is hidden (`visibilitychange`/`pagehide`). Written fire-and-forget to `kv.necropolisSave["progress"]`.
- **Restore on load**: `main.js` `await`s `loadSave(kv)` before resolving the seed, so the city is
  rebuilt from the saved seed first. Seed priority: pinned `config.seed` > saved run >
  `sessionStorage["np-seed"]` > random. Collected sigils, position and finale state are then reapplied
  by `applySavedProgress()`.
- **Export Save / Import Save** buttons live in the menu and on the pause screen (Esc). Export downloads
  `<generator>-<seed>.save.json`; Import reads a file, validates it (`parseSaveText`), writes it to kv,
  and reloads into that city. Imported values are sanitized (numeric seed, clamped index list).
- **New City** clears the stored run and reloads into a fresh random city.
- A `persistEnabled` flag is switched off immediately before the New City / Import reload, so the
  outgoing page's `pagehide` autosave can't overwrite the just-cleared/imported save.

## Files

| File | Role |
| --- | --- |
| `main.pjs` | `$meta` (title/description/tags/image), plugin imports, `config` knobs, word lists, spirit prompt context. |
| `index.html` | Fonts + all CSS + HUD DOM (crosshair, sigil bar, objective, compass, prompt, toast, panels, menu, loading). |
| `src/necropolis/main.js` | Orchestrator: renderer, seed, builds city/atmosphere/spirits, HUD, targeting, interaction, panels, dialogue streaming, finale, bloom post-processing, main loop, `window.__np` debug handle. |
| `src/necropolis/city.js` | Procedural city: ground, ring roads, radial avenues, ward layout + fill, street frontage, perimeter wall + gates, the Sanctum, shrines, spirit spawns. Returns `{group, meshes, footprints, grounds, lanterns, shrines, spirits, wards, readables, spawn, radius, ...}`. |
| `src/necropolis/atmosphere.js` | Night rig: sky shader, stars, moon + glow, hemi/ambient/moon key light + bounce, drifting motes, mist layers, lantern light pool, fog. |
| `src/necropolis/player.js` | `Player` (collision grid, ground-height following, head bob, pointer-lock + touch controls) and `bindControls`. |
| `src/necropolis/materials.js` | `buildMaterials(seed)` — all shared `MeshStandardMaterial`s + stone/ground/road textures. |
| `src/necropolis/lib.js` | `buildGeometries`, `Batcher`, `part`, `makeNoiseTexture`, `makeBumpTexture`, `makeCobbleTexture`, `makeGlowTexture`. |
| `src/necropolis/spirits.js` | Spirit entities + movement/animation. |
| `src/necropolis/inscriptions.js` | Epitaph/text generation helpers. |
| `src/necropolis/rng.js` | Seeded RNG (wraps `Math.random` for deterministic cities). |
| `src/necropolis/audio.js` | `Soundtrack` — 3 hosted MP3 tracks (menu/explore/sanctum) with crossfade + mute. |
| `src/necropolis/save.js` | Persistent-progress helpers: sanitize/parse/serialize a save, and load/write/clear it in the kv-plugin folder `necropolisSave`. |
| `src/generator-ideas.md` | Unrelated original idea list (kept for reference). |

## City layout (important)

The city is a **wheel**: `avenueCount` straight avenues radiate from the center to the wall
(`cityRadius`), crossed by concentric **ring roads** at `ringRadii = [24, 62, 102, 150, 206, 250]`.
Wards are the wedge-shaped districts between avenues; each ward gets a theme (tint, grand-ness,
light color, building mix) and a name.

Geometry conventions (easy to get wrong):

- `polar(r, a) => [cos(a)*r, sin(a)*r]`. An avenue at angle `a` is a `PlaneGeometry(AVENUE_W, len)`
  whose **long axis is radial**, so it is rotated `rotation.y = Math.PI/2 - a` (NOT `-a`, which would
  make it tangential). Getting this wrong makes avenues render as arcs instead of spokes.
- A builder's facade faces **local +z**. For a frontage building on the street side `side`, the yaw is
  `side > 0 ? Math.PI - a : -a` so the facade turns toward the avenue centerline.
- `place(env, geoKey, matKey, lx, ly, lz, sx, sy, sz, lry, color, rx, rz)` transforms local → world by
  `env.yaw` around `env.x/env.z`; `builders.*(env)` add collision footprints via `addFoot(x,z,hw,hd,yaw)`
  and readables via `addReadable`.

### Street frontage

A dedicated pass lines every avenue with `builders.streetVault` (long, tall niche facades) plus
`tombRow`/`crypt`/`mausoleum`, at `off = AVENUE_W/2 + 5.0` from the centerline, with `lanternPost`s on
the curb. Buildings must **not** cross the avenue centerline: keep the ward-fill exclusion
(`(AVENUE_W/2 + 12.0)/midR` in the half-angle term) and the frontage scale in sync with `off` — a
larger building or a smaller `off` will put facades in the road (there is an automated check: sample
each avenue centerline and assert no footprint contains it).

## Tuning knobs

All in `main.pjs` under `config`:

- `seed` — any non-zero integer pins a fixed city (config wins). `0` = a random city chosen on the
  first load and then kept stable for the session (`sessionStorage` `np-seed`); the **New City** button
  re-rolls it. `seed`/`avenueCount` also feed `buildMaterials`, `buildAtmosphere`, and spirit placement.
- `avenueCount` (14), `cityRadius` (250), `fogDensity` (0.0072), `sigilsRequired` (7),
  `spiritCount` (12), `walkSpeed` (5.2), `sprintSpeed` (9.0), `eyeHeight` (1.7), `bloom` (1/0).
- `quality` — `auto` (default), `1` (full), or `0` (reduced). All numeric config values are clamped
  on read (`clamp()` in `main.js`) so bad input can't break the build.

## Performance / quality tier

- `quality` auto-detects a coarse pointer / small viewport / low-memory or few-core device and, when
  `0`, reduces cost: no MSAA, `1.25` max pixel ratio (vs `1.75`), `PCFShadowMap` (vs `PCFSoft`),
  `1024²` moon shadow map (vs `2048²`, `shadowRes` in `atmosphere.js`), fewer motes (`900` → `420`),
  and a lower bloom-composer pixel ratio (`1.0` vs `1.5`). Forcing `quality = 1` overrides detection.
- Road meshes share one cloned material/texture pair per rounded tile repeat (`roadMatCache` in
  `city.js`) instead of cloning per strip.
- `makeCobbleTexture` (`lib.js`) computes the nearest/second-nearest cell over a 5×5 wrapped
  neighbourhood instead of every cell — visually identical, ~8× faster at `cells=14`.

## Build / verification notes

- Hard reload to apply code: `page_refresh` (or `page_eval` with `reload:true`).
- `window.__np` exposes `{ THREE, scene, camera, renderer, city, atmo, player, spirits, geos, mats,
  CFG, soundtrack, controls, composer, debug }`. `debug` has `findTarget, interact, takeSigil, talkToSpirit,
  showEpitaph, closePanel, updateFinale(dt), saveNow, buildSaveData, exportSave, importFromFile,
  seedHex, setPersist(v)`, `seed`, `savedProgress`, `sigilsFound`, and `finale`.
- `updateFinale(dt)` is extracted from `animate()` so the finale effect can be stepped manually in a
  `page_eval` (useful because the hidden editor preview pauses `requestAnimationFrame`). Calling it
  while the player is >70m from the heart restores fog density + exposure — the finale no longer
  leaves the world permanently brightened.
- **Avenue clearance check** (run from `page_eval` or `execute_js`): for each avenue angle, sample the
  centerline `r = 26..235` and confirm no `city.footprints[i]` box contains the point.
- **Visual checks**: menu/panel/pause/loading overlays sit above the scene, so hide
  `#menu,#pause,#panel,#loading` first, then capture with
  `await import("https://ai-agent.perchance.org/files/snapshot.js")` → `capture()`. `#hud` starts at
  `opacity:0` and only gets `.show` after "Enter the City", so it never bleeds through the menu. The
  vision model is inconsistent on this stylized render; trust geometry checks over single vision ratings.
- **Menu layout**: `#menu` is a flex scroll container; content lives in a `.wrap` with `margin:auto`
  so it stays centred on tall screens but scrolls (never clips the title) on short ones. Short-viewport
  rules live in the `@media (max-height: 680px/520px)` blocks. The footer is in-flow (not absolute) so
  it can't overlap the lore text.
- The distant Sanctum only stays visible through the fog at the current `fogDensity`; raising fog much
  above `~0.008` hides it as a focal point.
- `preserveDrawingBuffer: true` is set on the renderer so canvas captures work.

## Audio

Three tracks are hosted (generated for this project) and referenced in `src/necropolis/audio.js`:

- menu: `https://user.uploads.dev/file/fec9a0872e7051ea99b3ebbfdda00847.mp3`
- explore: `https://user.uploads.dev/file/58d55088569cc6b08f8f2488fffe58f5.mp3`
- sanctum: `https://user.uploads.dev/file/6ba1ecdbea1db9f2741379c6acf50aeb.mp3`

`$meta.image` and the menu backdrop both use the hero render:
`https://user.uploads.dev/file/a0df3bd817c7072b39fda30976eb498b.png`
