# data-visualization-plugin — working notes

Dependency-free SVG chart plugin for Perchance (`https://perchance.org/data-visualization-plugin`).
Everything a host can call lives in **`main.pjs`** (Perchance only passes a generator's `main.pjs`
evaluation to importers — never its `index.html` scripts or `src/` files). `index.html` is the
public demo/landing page and is *not* part of the imported surface.

## Layout

- `main.pjs` — the whole plugin. Header comment block = the public API reference (keep in sync with
  `VERSION`, `$meta.description`/`tags`, and `index.html`). Sections:
  - helpers: `resolve` (primitives verbatim), `esc`, `escColor`, `fmt`, `num`, `themeColors`,
    `defaultOpts`, `mergeOpts` (+ `COLOUR_KEYS`/`TEXT_KEYS`), `niceNum`,
    `niceTicks`, `minMax`, `layout`, `svgHead`, `drawTitle`, `drawGrid`, `drawTicksY`,
    `drawLegend`, `yScale`, `xScale`, `polar`, `listItems`, `isListNode`, `nodeKeys`, `valOf`,
    `toObj`, `classifyObjects`, `classify`, `normData`,
    `allIntegers`, `autoBinCount`, `binSample`, `sampleDist`, `firstSeriesValues`
  - base renderers: `renderBars`, `renderBarsH`, `renderLine`, `renderPie`, `renderHisto`
  - new in v1.2: `arrOf, dataLabelsOn, clampText, hexToRgb, mixRgb, rgbCss, drawAxisLabels,
    bandLoUp, drawBand, stackedInfo, renderStackedBars, renderStackedBarsH, renderArea,
    pairsFrom, scatterFromRows, seriesNameOf, normScatter, axisRange, renderScatter,
    heatmapFromRows, normHeatmap, renderHeatmap, renderSpark, TYPE_CATALOG, TYPE_GROUPS,
    normalizeTypeId, typeMeta, mergeSpecStyle, normaliseSpec, specOpts, nFromSpec,
    dispatchRender, renderSpec, describeSpec, specFrom, fenceSpec, textOf, fenceToSpec,
    resolveCssVars, svgDims, specWithExportTheme, prepareSvg, loadImage, png, pngBytes,
    bytesToDataUrl, pngDataUrl`
  - guarded dispatch: `ph(name, msg)` → `(charts.<type>: <msg>)` placeholder, `safe(name, fn)`
  - `const api = {...}` (object, never callable) → `chartsApi` → `window.__chartsApi` cache →
    `dvCharts = [makeChartsApi()]`, `$output = [dvCharts]`
- `index.html` — the demo page: hero, dashboard of 14 live cells, `#types` catalogue section,
  `#formats` input-shape table, `#opts` option table, `#try` interactive try-it, `#export` PNG
  section. All UI/computation code is inline `<script>` at the bottom.

## Why the public face is a plain object

The Perchance import machinery strips properties off function-valued imports, so a callable would
lose `.bar`/`.line`/…. `chartsApi` must stay an **object** with the methods as properties. Never
change `$output = [dvCharts]`.

## Gotchas learned the hard way

1. **`resolve()` must never evaluate primitives.** The engine patches
   `String.prototype.evaluateItem`, so `resolve("a {b} c")` would template-evaluate the string: the
   engine pug-parses the braces, logs a `perchanceError`, and mangles the text. `resolve` therefore
   returns strings/numbers/booleans **verbatim** and only calls `.evaluateItem` on real objects.
   `textOf(v)` is the text-coercing wrapper for titles/labels. Any user-facing text (title, labels,
   xLabel, yLabel, centerText, series names, dataset names) is rendered exactly as given, and
   `selfCheck` asserts it. Keep it that way: never re-introduce `resolve()` on a primitive.
2. **`index.html` is pjs-templated.** Text nodes must not contain raw `[`, `]`, `{`, `}` outside
   `<script>`/`<style>` — the engine evaluates them. Verbose prose caused perchanceErrors before;
   reword or escape with `&lbrack;`-style entities if ever needed.
3. **`toObj()` skips `name` only for real Perchance nodes.** A node exposes
   `evaluateItem`/`selectAll`/`isList`/… and its `.name` is the node's *key* (hence `NODE_SKIP`), so
   for nodes it is still dropped; `seriesNameOf(rawObject, i)` reads series names off the raw object.
   A *plain* JS object `{name:"Mon", value:3}` keeps its `name` and uses it as the label.
4. **Never throw, never reject.** Every public method is wrapped in `safe(...)` and returns a
   placeholder string. `png`/`pngBytes`/`pngDataUrl` are the only async/browser-only surface and they
   resolve to that same `(charts.png: …)` placeholder instead of rejecting, so callers must treat a
   **string result as an error message** (the demo's export panel does exactly this).
5. **`render(type)` dispatch** goes through `normalizeTypeId` (catalogue ids, method names, plus
   `TYPE_ALIASES` — `heat`/`matrix`/`grid` → heatmap, `spark` → sparkline, `column` → bar,
   `time`/`ts` → timeseries — case/underscore tolerant) and `typeMeta(id).method`; unknown ids fall
   back to `bar`. Empty data yields a placeholder, not an axis-only chart.
6. **Histograms bin raw samples honestly.** `histogram([3,3,4,4,5,5,6])` (or any spec with a
   numeric `values` array and no `dist`) goes through `binSample`: a small-range *integer* sample
   snaps to one bar per value (2d6 → bars 2…12); otherwise it uses Sturges' rule, honours
   `{bins:n}`, and draws a **count** y-axis with a `N values · B bins · μ · σ` footer. The
   `{outcomes:[{v,p}]}` / `{values,probs}` forms are probability distributions and keep their
   0–100% axis. Colours from a spec's `series[i].color` are honoured via `specColors(s)`.
7. **Perchance list nodes: `selectAll` is an ARRAY, not a function.** Measured live on a real
   generator list: `typeof node.selectAll === "object"` / `Array.isArray(node.selectAll) === true`.
   The old `typeof v.selectAll === "function"` guard therefore matched *nothing*, so every
   list-input branch was dead code — a list passed to `bar`/`line`/`render`/`spec` produced a
   placeholder. Use the `listItems(v)` / `isListNode(v)` helpers (they accept either shape).
8. **Node items hide their keys from `Object.keys()`.** `Object.keys(node)` returns only internals
   (`$perchanceCode`, `getParent`, …); the item's own data keys live on **`$valueChildren`**
   (`$allKeys` is a fallback), and the values themselves are readable straight off the proxy
   (`node.label`, `node.value`). `toObj` uses `nodeKeys(e)`, and `arrOf`/`valOf` keep such objects
   instead of collapsing them to `evaluateItem` (which for a node item is just the item's own key
   text, e.g. `"row"`). `arrOf` also checks `isListNode` *before* resolving, since resolving a list
   node would flatten the whole list into one string.

## Verify after changes

`page_refresh` must be clean (no console errors, no `perchanceErrors`, no `syntaxErrors`), then:

```js
root.charts.selfCheck()   // 95 assertions — all must pass (textOverflows containment included)
await root.charts.png(root.charts.bar([3,7,2]))          // Blob, type image/png, size > 0
await root.charts.pngDataUrl(root.charts.bar([3,7,2]))   // "data:image/png;base64,..."
```

Extend `selfCheck()` whenever a renderer or type is added (assert `<svg` prefix + long-label
containment via `textOverflows(...).length === 0`). For visual verification, snapshot a demo cell
element (e.g. `#dashHeat`, `#dashScatter`) and inspect it; PNG export can be checked by loading the
blob URL into an `<img>` and confirming it is not blank.

## Adding a new chart type (recipe)

1. Write the renderer as a plain-SVG-string function (reuse `layout`/`svgHead`/`xScale`/`yScale`/
   `drawAxisLabels`), wrapped so it returns `{ svg, labels }` like the others.
2. Add an entry to `TYPE_CATALOG` (`{id, label, group, description, method}`) and, if needed, a
   group to `TYPE_GROUPS`; keep the catalogue ordered as listed there.
3. Add the method to the `api` object (and it is mirrored onto `chartsApi`).
4. Wire the id → method in `dispatchRender`/`typeMeta`.
5. Add a `selfCheck` assertion (`<svg` prefix + `textOverflows(...).length === 0` with long labels).
6. Add a live demo cell in `index.html` and a line in the header comment block; bump `VERSION`.
- `png*` uses `OffscreenCanvas` when available, else a DOM canvas; no SVG-taint issues because the
  SVG is self-contained (no external images/fonts).
