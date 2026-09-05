# Gotham City Builder

A SimCity-style isometric city builder set in Gotham City, with a dark Batman-noir UI (gold/teal on near-black). Playable in the perchance editor preview, on desktop browsers, and on mobile/touch.

## How to run / save state
- Autosaves every ~12s to the browser's IndexedDB via the `kv-plugin` under `gothamBuilder/gothamCitySave1` (format `{v:3, ...}`). The start screen offers "Continue Saved City" when a save exists. `New City` asks for confirmation, then wipes the save.
- Ships as a perchance generator: `main.pjs` (imports + flavor lists), `index.html` (UI shell), `src/render.js` (isometric canvas renderer), `src/game.js` (sim + input + IO). All four are required.

## Architecture
- `main.pjs` — kv-plugin import; flavor text lists (districts, headlines, mayor speeches). Not much logic lives here.
- `index.html` — fixed top stat bar (scrollable on narrow screens, with right-edge fade via CSS mask), left tool rail (becomes a bottom scroll strip ≤560px, also mask-faded), right inspector + legend (hidden ≤560px), bottom control bar (pause / speed 1-4 / tax slider), news ticker, modal dialog system, start screen. Loads `src/render.js` then `src/game.js`. Top-bar overlay toggles: `◉` crime heatmap, `⚡` power & water coverage map.
- `src/render.js` — `window.Render` IIFE. 40×40 isometric diamond map, `HW 24 / HH 12` per tile. World→screen: `px = (x−y)·24`, `py = (x+y)·12` (Render units) then camera `translate(ox,oy) scale(z)`. Caches a per-city ground layer (`buildGround`) that is re-built only when land/water changes; per-frame pass draws roads, zone development and ~13 building types with extruded boxes. Lighting: `nightDark` ramps building faces darker at night, sky gradient + warm sun overlay + grass palette brighten at day; night adds an additive pass (`drawNightLights`) that glows lit windows (powered, dev≥3) via a cached radial-gradient sprite, plus a sweeper beacon for the Gotham Light (screen-space, post-night-overlay). Overlays: `st.crimeView` heatmap and `st.coverView` coverage map (reads `st.power`/`st.water` = powerCov/waterCov refs; green P+W, yellow no water, blue no power, red neither), each with a screen-space legend chip.
- `src/game.js` — `window.GOTHAM` IIFE holding all state and logic:
  - `S` = public sim state (money, tax, day, hour, cam, hover, …). Arrays `land` (0 grass/1 water), `road`, `zone` (R/C/I), `type` (service/landmark ids), `dev` (1-4 density level), `crime`, `poll` — all `Uint8Array(W*H)`.
  - Sim: 1 game-hour per `HOUR_REAL = 1.5s` of running time; `dailyRoll()` collects taxes, pays upkeep, rolls events (villains/disasters/Bat), may trigger the Riddler riddle modal (day > 2).
  - Services: power plants & water towers flood-fill reachable road-connected tiles (`recomputeNetworks`); buildings/dev need power+water+road. Crime: police/GCPD/Arkham/Batcave project suppression (Arkham & Batcave strongest). Land value = crime, pollution, parks, industrial proximity → drives density dev level & happiness.
  - Events: Joker chaos, Riddler money-grab, Catwoman heists, Scarecrow fear gas, arson, floods… `EVENTS` list weighted; `tryRiddler` opens a Q&A modal (reward −400/+1400). Building GCPD+Arkham+Batcave sets `S.hasLegend` → periodic "Dark Knight" flavor + a red bat flash.
  - Input: pointer events (mouse + touch). Left-drag paints the selected tool (Bresenham line), right-drag bulldozes, middle/space drag pans, wheel zooms; touch: single-finger drag paints or pans (when no tool), two-finger pinch zooms about the gesture midpoint (tracked via a `ptrs` map). Clicking the active tool deselects it (needed to pan on touch). Keys 1-9/0 select tools.
  - Loop robustness: rAF + a 100ms setTimeout watchdog (`armNext`) so the sim keeps running even when the preview iframe is hidden/throttled (rAF dead); per-tick `dt` capped at 0.25s.
  - Camera clamp `updateCameraBounds()` keeps the map diamond reachable; `fitView()` fits the whole 40×40 map (min zoom 0.18 so it fits a ~400px-wide pane).

## Exposed test/debug API (`window.GOTHAM`)
`S` (state), `place(x,y,toolId,silent)`, `selectTool(id)`, `newCity()`, `simHour()`, `dailyRoll()`, `simHourFrac(n)`, `expose.{W,H,idx,TYPE,ZONE}`, `arrays()` (live Uint8Array refs), `landVal()`, `zoneArr()`, `devArr()`.

## Known quirks / gotchas
- The editor preview iframe is often `visibilityState "hidden"` (rAF dead) — the watchdog timer keeps the sim and rendering alive; screenshots during hidden state may catch stale frames.
- `page_refresh` drops all in-page state (the kv save is the only persistence) — after a refresh, click "Continue Saved City" to restore.
- The inspector panel is hidden ≤560px; on phones, tile inspection happens via hover-on-tap but there's no visible panel (tool placement feedback + news ticker carry the info).
- Road building on water tiles is allowed only when adjacent to an existing road tile → that's how bridges work (no extra cost).

## Build/test notes
- The kv save currently holds a FRESH city ($30,000, day 1) — the old showcase/test city was wiped via `newCity()` during the polish pass. To regenerate a showcase city for visual checks, build it in one page_eval: write `S.road/zone/type/dev` arrays directly for a 6×6 road grid (cols `[5,11,17,23,29,35]`) with zones in the 5×5 blocks and services/landmarks on road-adjacent block corners (power 2 / wtower 3 / police 4 / park 1 / landmarks 8-13), then `G.place(0,0,"park",true)` to trigger `recomputeNetworks` and `G.simHourFrac(600)` to develop (needs both power AND water sources near roads or nothing grows — water towers must sit on a tile adjacent to a road, i.e. a block corner, or they fail road-access placement).
- Visual checks done via full-page snapshot helper: `(await import("https://ai-agent.perchance.org/files/snapshot.js")).capture()` in page_eval with `resultPath: scratch/shots/*.png`, judged with the vision tool.
