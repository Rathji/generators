# Categorizing themes — the process

The depot's category slicer works off **precomputed categories** shipped in
`src/categories.json`, so the whole catalog is sliced correctly on first load —
not just the themes a visitor happens to open. This file documents how that data
is produced, when to re-run it, and how to extend the category system.

## Sources & pipeline

1. **Store list** — `community-css-themes.json` (the official Obsidian community
   theme store, ~730 themes): name, author, repo, modes, legacy, screenshot.
2. **Hub index** — the hub vault's `🗂️ Themes.md`: which themes have hub pages.
3. **Descriptions (the bulk step)** — each hub-documented theme's page
   (`publish-01.obsidian.md/access/…/Themes/<Name>.md`) is fetched and parsed for
   its intro/features text. This is the work the app would otherwise do lazily,
   one theme at a time; the script does all ~400 of them up front.
4. **Classification** — `classifyTheme()` (src/data.js) matches each theme's
   name + repo + author + description against keyword tables:
   - Style/palette (`CATEGORIES`): Minimal, Colorful, Gruvbox, Dracula,
     Catppuccin, Tokyo Night, Nord, Solarized, Ayu, Neon / Synthwave, Nature,
     Retro / CRT, Anime.
   - Structural (`STRUCTURAL_CATEGORIES`): Legacy, Hub-documented.
5. **Output** — `src/categories.json`: `{ generatedAt, counts, themes: { "<Theme Name>": ["gruvbox","hub"], … } }`.
   The app fetches it once at load and overlays it onto the catalog.

## Running it

Two ways:

**1. With the execute_js worker** (this is what writes the file directly — it has
the live workspace filesystem):

```js
const code = await fs.readTextFile("src/tools/categorize.js");
const mod = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(code))));
await mod.main();
```

**2. In a browser console** on the running generator (no `fs`, so it prints the
JSON instead — copy it into `src/categories.json`):

```js
const code = await (await fetch("src/tools/categorize.js")).text();
const mod = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(code))));
await mod.main();
```

The script fetches hub pages concurrently (8 at a time, 80 ms stagger), tolerates
per-page failures, and reports how many themes were categorized and how many hub
fetches failed.

**Test mode** — validate the pipeline on a subset without touching the real
output file:

```js
await mod.main({ limit: 100, outPath: "scratch/categories-sample.json" });
```

Runs the full pipeline on the first `limit` themes (alphabetical) and writes to
`scratch/` instead of `src/categories.json`. This is how the classifier bugs were
caught (author-username noise, substring matches like "sea" in "research") — see
`classifyTheme()` in src/data.js: keywords match name + repo basename (username
stripped) + hub description, and "noisy" substrings use word boundaries.

## When to re-run

- The store grows (new themes) or the hub index changes.
- You edit the keyword tables in `CATEGORIES` / `STRUCTURAL_CATEGORIES` (src/data.js).
- You want fresher descriptions to feed the classifier.

Re-running is cheap (~1 minute) and replaces `src/categories.json` atomically.
If a theme has no entry in `categories.json` (e.g. brand-new and the script
hasn't been re-run), the app falls back to the same `classifyTheme()` keyword
logic on the static fields, so nothing is ever uncategorized.

## Adding a category

1. Add an entry to `CATEGORIES` in src/data.js, e.g.
   `{ key: "monochrome", label: "Monochrome", re: /\bmono(chrome)?\b|grayscale|b&w/i }`.
2. Re-run the script (above) to regenerate `src/categories.json`.
3. Verify the new chip appears in the slicer (chips with fewer than 2 members are
   hidden — `MIN_SLICE_COUNT` in src/app.js).

## Future work (optional)

The deterministic keyword classifier is a cheap, transparent baseline. An
AI-assisted pass (feeding each description to `root.generateText` asking for a
category label from the fixed set) could be layered on top of the same pipeline
for much higher precision — run it in the page via `page_eval`, then write the
results back to `src/categories.json` the same way.
