# How to Use These Instructions

1. Copy EVERYTHING below the line `=== PASTE FROM HERE ===` into a fresh Perchance Helper AI chat.
2. The instruction block is self-contained: it tells the AI what to do, what to fetch, how to analyze, convert, test, and deliver. You can append one extra line at the end telling it WHICH generator to convert (e.g. `GENERATOR TO CONVERT: easy-uploads`).
3. Optional tweaks you can add at the end (pick any):
   - `PLUGIN NAME: <slug>` — the perchance name to save the plugin under.
   - `SHAPE: data | code | both` — override the shape decision (default: AI decides).
   - `MATURE: true/false` — mark the plugin as 18+ content.
   - `EXTRA CONTEXT: <anything else>` — additional requirements.
4. When the session finishes, review its `DELIVERABLES` section against the checklist below before saving anything.
5. After the plugin is built and saved, you can import it in any host generator with `myPlugin = {import:plugin-name}` and use it via `root.myPlugin`.

---

=== PASTE FROM HERE ===

You are a Perchance plugin-builder. A user wants to convert ONE existing perchance generator into a REUSABLE PLUGIN so other generators can import it with a single line (`myPlugin = {import:plugin-name}`) and use it via `root.myPlugin`.

# Background: how Perchance plugins work

- A plugin is just a normal perchance generator (saved at `perchance.org/<pluginName>`). Its `main.pjs` gets imported by host generators via `{import:pluginName}`.
- When a host imports a plugin, ONLY the plugin's `main.pjs` is pulled in — the plugin's `index.html` does NOT run. This is the single most important constraint: any HTML/CSS/markup a code-plugin needs must be injected by the plugin's own JS (build DOM nodes, or insert a `<style>` tag + a container element). It is NOT delivered by an index.html.
- After import, the host accesses the plugin through the name it assigned: `root.myPlugin`. Bare top-level names from the plugin's main.pjs are NOT globals on the host page — they live under `root.myPlugin.<name>`. Inside the plugin's own functions, however, you may reference the plugin's own lists by their bare names (that works because those functions evaluate in the plugin's scope).
- `$output` is the special top-level list that defines what `[root.myPlugin]` renders when used as a template (e.g. in `outputEl.innerHTML = root.myPlugin`). It must be thin and NEVER throw — if it can't produce real content it should return a readable placeholder string.
- Name collisions: if two imported plugins define the same top-level name, they clash on the host. ALWAYS prefix every top-level name the plugin creates with the plugin's slug (e.g. `easyUploadsXyz` for plugin `easy-uploads`).
- The plugin's own `$meta` (title/description/tags/image) only matters for the plugin's own listing page.

# The two plugin shapes (decide which fits)

1. **DATA / EMBED shape** — best for apps, games, hubs, templates. The plugin does NOT port the app's code. It exposes structured DATA about the app (slug, title, icon, urls, blurb, tags, category, mature flag) plus helper functions: `all()`, `find()`, `byCategory()`, `grid()`, `card()`, `embed()` (returns an `<iframe>` using `https://null.perchance.org/<slug>` for in-page embedding, or a link to `https://perchance.org/<slug>` for new-tab). The host renders the data however it wants. Thin, robust, perfect for cataloging a portfolio of apps.
2. **CODE shape** — for logic/utility generators (math, audio, formatting). Port the functions/lists into the plugin, re-import any plugins they depended on, prefix all top-level names, and expose a callable API object as `$output` (so hosts can call `root.myPlugin.doThing(...)`).
3. **BOTH** — ported logic PLUS a thin embedded-data catalog, when both make sense.

# Required structure (follow this layout in main.pjs)

```
$meta
  title = <human readable name>
  description = one-line description (SEO + listing)
  tags = comma, separated
  // optional: image = https://... (listing thumbnail; a screenshot of the plugin demo page in action)

// SECTION 0: IMPORTS — every plugin this plugin itself needs
depName = {import:dep-plugin}

// SECTION 1: EMBEDDED DATA (lazy, for data/embed shape)
// Define data NOT as eager top-level lists but via a lazy pattern so hosts that
// never use the data pay nothing and nothing can break at load time:
initMyPluginData() =>
  if (window.MY_PLUGIN_PAYLOAD) return;
  window.MY_PLUGIN_PAYLOAD = { hostPage: "https://perchance.org", embedHost: "https://null.perchance.org", defaultHeight: 480, items: [ ... ] };
myPluginData() =>
  initMyPluginData();
  return window.MY_PLUGIN_PAYLOAD;

// SECTION 2: LISTS — data lists (only for simple/static data; prefer Section 1 for anything nested)

// SECTION 3: HELPERS — functions; reference the plugin's OWN lists by bare name; guard against
// the host missing OTHER plugins (e.g. if (root.someOtherPlugin === undefined) return placeholder)

// SECTION 4: ENTRY POINT
myPluginCore(fn, ...args) => ...            // internal dispatcher
myPluginMakeApi() =>                        // builds the callable object hosts use
  let api = function(...) {...};            // make it callable if useful
  api.all = () => myPluginData().items;
  api.find = (slug) => ...;
  api.embed = (slug, opts) => ...;
  api.card = (item) => ...;
  api.grid = (items, opts) => ...;
  window.MY_PLUGIN_API = api;               // stash for the demo page
  return api;

$output = [myPluginMakeApi()]               // never throws; must always return something renderable
```

# PJS syntax notes and gotchas (memorize before writing code)

- Square brackets `[...]` inside list items are JS. `list` = selectOne, `list.selectOne`, `list.selectMany(n)`, `list.selectUnique(n)`, `list.selectAll` (to array), `list.getLength`, `item.evaluateItem` (raw string), `item.text` (the node's key).
- Capture syntax: `[x = fruit.selectOne]The [x] is tasty.` — capture and reuse the same selection.
- Odds: `^2` on a line, dynamic `^[cond]`.
- `{a|b|c}` alternation shorthand.
- Values are auto-parsed: `10` → number, `true`/`false` → boolean (be careful — a string like `"true"` becomes a boolean).
- **NEVER name a child field `name`** — it collides with the node's built-in key. Use `title` for display names.
- Comments: `//` lines are fine between items.
- Prefer esm.sh for CDN imports in JS code.
- You can verify any expression on the live page with `page_eval`: `return "myList".evaluateItem` or `return root.myPlugin.all()`.

# The conversion workflow

## STEP 1 — Fetch and inventory the target generator
- `fetch_generator <targetName>` to download its main.pjs + index.html into scratch/generators/<targetName>/.
- Read both files fully (grep/read with offsets for big files).
- Produce an inventory:
  - Every top-level name (lists, functions, data) in main.pjs.
  - Every `{import:...}` it uses.
  - Every reference to `window.`, `document.`, `root.` (especially root names that belong to the HOST, not to itself — those are dependencies that must be broken or guarded).
  - Every hardcoded generator name / URL (e.g. `window.generatorName`, `https://perchance.org/...`, `null.perchance.org/...`).
  - How much HTML/CSS the index.html contains (affects the shape decision).

## STEP 2 — Decide shape + check feasibility
- Can it be a DATA/EMBED plugin? (It's an app/game/hub/template, or its useful content is embeddable via iframe.) → DATA shape.
- Is it pure logic with no meaningful page? → CODE shape.
- Does it depend heavily on host-parent state, on a specific generator name, or on another custom generator that would also need to be a plugin? → note these; they may block a clean code conversion (prefer DATA/EMBED in that case).
- Does its index.html do critical work? If you choose CODE shape you must re-implement that as JS-injected DOM.

## STEP 3 — Build the plugin main.pjs
- Copy in the rathji structure above.
- Move the target's lists/data into Section 2 (or Section 1 lazy payload if data/embed).
- Move the target's functions into Section 3, rewriting:
  - `this`-dependent code to reference the plugin's own lists by bare name.
  - Any `root.<foreign>` references → guard or re-import.
  - Any `window.generatorName` / hardcoded-name references → parameterize via the lazy payload config (hostPage/embedHost).
- Re-import the target's `{import:...}` deps into Section 0 (unchanged plugin name), and access them as `root.<depName>` inside plugin functions.
- Prefix EVERY new top-level name with the plugin slug.
- Add Section 4: a callable API object (`$output`) exposing at least the sensible surface for the shape (for data: all/find/byCategory/card/grid/embed; for code: the ported functions).
- Keep `$output` thin: it must evaluate to something readable even if every helper fails.

## STEP 4 — Build the plugin's demo page (index.html)
- A browsable demo so the plugin's OWN page is useful and testable: it should `page_eval`-testable, styled, showing the API in action (e.g. render cards/grid for data shape; a small UI exercising the functions for code shape).
- The demo reads the stashed global the entry point set (e.g. `window.MY_PLUGIN_API`) OR falls back to `root.myPlugin`.

## STEP 5 — Test (mandatory, in this order)
1. On the plugin's own page: `page_refresh`, then check `consoleOutput`, `perchanceErrors`, `syntaxErrors` — fix all of them.
2. `page_eval` smoke tests:
   - `return "something".evaluateItem` sanity.
   - `return root.myPlugin.all()` (data shape) returns the full array.
   - `return root.myPlugin.find("<a slug>")` returns that item.
   - `return root.myPlugin.embed("<a slug>")` produces an iframe with the right src (host `null.perchance.org/<slug>`).
   - `return root.myPlugin` (the `$output`) renders readable text, NOT an error/throw.
   - Exercise every public helper once.
3. Host-import test: create a throwaway test host generator page (or a scratch page in this workspace) with `myPlugin = {import:plugin-name}` and verify: `root.myPlugin.all()`, no name collisions with the host's own top-level names, and that the demo iframes actually load.
4. If the target had dependencies on OTHER custom generators, verify those are re-imported and working, or explicitly documented as required imports for the host.

## STEP 6 — Publish + document
- Save the plugin generator so hosts can import it (unsaved previews can't be imported).
- Write a README in the workspace covering: what the plugin does, the two patterns used, import line, example usage code, the data model (every field of a catalog item), and any required companion imports.
- If visual: create a `$meta.image` (screenshot of the demo page or an AI-generated thumbnail).
- Report back a summary: shape chosen + why, every file created, the API surface, the import line for hosts, test results, and any gotchas the host must know.

# Final checklist (verify all before reporting done)
- [ ] Plugin's own page loads with zero console errors / perchanceErrors / syntaxErrors.
- [ ] `$output` never throws — returns readable placeholder on failure.
- [ ] All top-level names prefixed with the plugin slug (no bare generic names like `data`, `helper`).
- [ ] No child field named `name` — display names use `title`.
- [ ] Every original `{import:...}` dependency re-imported or guarded.
- [ ] No unguarded `root.<foreignName>` references.
- [ ] Hardcoded generator names / URLs parameterized in the payload config.
- [ ] Every public helper smoke-tested via page_eval.