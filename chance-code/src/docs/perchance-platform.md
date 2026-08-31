# Perchance platform reference

**How to use this knowledge.** For NEW code you write, plain JavaScript in index.html is almost always better than DSL features — keep main.pjs as random lists + a human-readable "config file" (parameters the user might tweak). This skill exists because you'll often need to *understand* the engine's behavior precisely: many generators you're asked to improve were written by humans who leaned heavily on DSL features and old plugins designed for non-coders. Nothing here is a recommendation to use a feature — it's what the feature *does*.

# Execution model

Page load order:
1. The output HTML is inserted into the page WITHOUT running `<script>` tags.
2. All `<script>` tags execute, top to bottom. (Per web standards, `<script type="module">` is deferred and may interleave due to top-level await — module scripts are not guaranteed to run one-after-another.)
3. All square blocks in the HTML execute, top to bottom, left-to-right within a line — i.e. only AFTER every script tag has run.

- `update()` just re-executes the square blocks in the HTML. It does NOT reload the page or reset variables. `update(someEl)` re-executes only the blocks inside the element with that id.
- main.pjs is implicitly loaded before index.html; its top-level names become globals on the page.
- Inside `<script type="module">` you cannot reference lists bare — write `root.animal.selectOne`, not `animal.selectOne`. (`root` = the root of the perchance tree, the list that contains all top-level lists.)
- Definitions in main.pjs are fully declarative (a line can reference a list defined below it), but *variable creation at evaluation time* is strictly left-to-right / top-to-bottom: `[n] said "My name is [n = name.selectOne]"` errors because `[n]` is read before the assignment. This applies across lists and across the HTML panel (a variable assigned inside `output2`'s items doesn't exist yet while `output1` evaluates, if `[output1]` appears earlier in the HTML).

# Evaluation & selection semantics

These are the rules that most often surprise people reading DSL-heavy code:

- Everything inside `[...]` is JavaScript, evaluated against the list tree. Quoted text is literal; a bare word is a list/variable lookup (error if it doesn't exist).
- `[word]` selects a random item AND prints it. `[w = word.selectOne]` selects, stores, AND prints. To store silently, chain a final empty string: `[w = word.selectOne, ""]` — a comma-separated block runs every command but prints only the LAST one's value.
- `w = word` (no `.selectOne`) makes `w` an alias for the whole list, not a stored item. Aliasing is used to shorten deep paths: `[b = universe.middleEarth.shire.bilbo]` then `[b.hitPoints]`.
- A list is only auto-executed when it's the FINAL thing in a square block (the engine must stringify it, which implicitly runs `.evaluateItem` → `selectOne` → evaluate that item's blocks). `[init, ""]` does NOT run `init` — it merely mentions it. Fixes: `[init.evaluateItem, ""]`, or make `init` the final expression, or use the dynamic-variable shorthand below.
- Dynamic-variable shorthand: `init = [a=1, b=2]` (a `=` list whose single item is a single square block) creates a variable whose block re-executes every time the name is *mentioned* — even mid-block. Distinct from a normal single-item list.
- Accessing a list item EVALUATES it: with `foo = [ "hello {1-100}" ]`, reading `foo` yields e.g. "hello 87", never the raw text. To carry raw text use a function (`foo() => return "hello {1-100}"`) or `getRawListText`.
- `[x = evaluateItem-result]` vs re-selection: use `.evaluateItem` (via `selectOne.evaluateItem`) to store a *fully evaluated string* — otherwise every re-read of a stored node's text may re-run its inner blocks.
- Properties parse types: `hp = 10` gives a real number (`typeof === "number"` when `Number(String(n)) === n`); `isBald = true`/`false` parse into booleans. This is convenient and a footgun (e.g. a "true" string you wanted).
- `{a|b^3|c}` inline alternation is nestable and takes odds. Items in inline lists like `num = {1-3}` don't always behave identically to normal list items under `selectOne` (they evaluate to plain text; `x = {[a]|[b]}` then `x.selectOne` returns evaluated text, NOT a reference to the chosen `a`/`b` list — use random-select-plugin if you need the list reference).
- Character escaping: `\[` and `\{` are literal brackets, `\s` is a space; a backslash before a NON-escapable character is kept as-is (`\o` stays `\o` — unlike most languages). Whether escapes get stripped depends on context (script tag vs square block). The `literal-plugin` auto-escapes brackets in text (useful when feeding user text into prompts).

# Odds (`^`)

- Static: `item ^2` (2x default weight), fractional `^0.3` fine.
- Dynamic: `item ^[expr]` — re-evaluated EACH time an item is being selected from that list. Booleans coerce: `^[c != "Jamie"]` means weight 1 when true, 0 when false (`^false` ≡ `^0`, item unselectable). Arbitrary arithmetic works: `^[(t == 24)*8]`, `^[n1 + n2]`, `^[character.age]`, `^[mammal.getLength]`.
- Because dynamic odds see variables assigned earlier in the same evaluation, they're the idiomatic way old generators do "exclude B if A was picked": see the consumable-list-with-dynamic-odds pattern below.
- Boolean operator precedence in these expressions (highest first): brackets, `<`/`>`, `==`/`!=`, `&&`, `||` — parenthesize anything mixed: `^[x > 10 && (y < 12 || z == 1)]`.
- `getOdds` returns an item's current odds.

# if/else and ternaries

- Forms: `[if (cond) {thenThis} else {elseThis}]`, chainable `else if`, and ternary `[cond ? a : b]` (chainable: `[c1 ? r1 : c2 ? r2 : fallback]`). The `{}` here are JS braces, NOT Perchance `{a|b}` alternation.
- Branches: bare word = list reference, quoted = literal. A branch mixing text and blocks must be quoted whole: `{"There are a few [animal.pluralForm] here."}`.
- NO nested square brackets inside a block: `[if (n < 4) {[sad]} else {[happy]}]` is wrong; `[if (n < 4) {sad} else {happy}]` is right.
- **Engine bug**: if/else can't follow a comma-command in the SAME block. `[n=num.selectOne, if(n==4){"a"}else{"b"}]` fails — split it: `[n=num.selectOne, ""][if(n==4){"a"}else{"b"}]`.
- `=` vs `==` in a condition: `if (n = 1)` assigns (classic JS footgun) — a very common bug in old generators.
- "if without else": `else {""}`. Mutate without printing: `[if (a==4) {a=a+3, ""} else {""}]`.
- Object literal in a block needs parens: `[({foo:1})]` not `[{foo:1}]` (label/block parse).
- When an if/else chain just maps a value to same-named sublists, generators use **dynamic sub-list referencing** instead: `[name[r]]` fetches the sublist whose name equals `r`'s value (`names[g].selectOne`; chains like `world[a].country[b][c].town`; computed keys like `thing[a+"blah"]`).

# Hierarchies and the list-tree API

Lists nest arbitrarily deep; a "property" is an `=` item (`hp = 10`), a "sub-list" is an indented block.

- `this` = the PARENT of the item it's written in (`description = ... [this.height] ...` inside `person` reads `person.height`). `this.getParent` climbs one more level. `getName` returns a node's name — `a [this.getName] is a type of [this.getParent.getName]`.
- Selection/method surface: `selectOne`, `selectMany(n)`, `selectUnique(n)`, `selectAll` (→ array, the way to iterate a list in JS), `getLength`, `evaluateItem` (fully-evaluated string), `joinItems(sep)`, `pluralForm`/`upperCase`/`titleCase`/`pastTense` (string transforms; `pluralForm` can be overridden per item for made-up words), `getChildNames`, `getPropertyNames`, `getFunctionNames`, `getAllKeys`, `getRawListText` (raw source text), `createClone`, `getOdds`.
- `consumableList`: `[cl = character.consumableList, ""]` — a copy where each `selectOne` REMOVES the picked item, so successive picks are distinct. (consumable-list-loop-plugin auto-resets when empty; consumable-leaf-list-plugin consumes leaves of a hierarchy.)
- `$output` overrides what a node evaluates to. Inside a list: `$output = My name is [this.name]` makes `[person]` print that sentence while `person.name` still works. At top level it defines what `{import:this-generator}` returns. Common multi-line pattern: `$output = [this.joinItems("\n")]` (a list whose items are lines).
- `root` = the whole tree; `[root[location]]` (dynamic reference off root) is how goto-style adventures swap "current location" lists.
- `createPerchanceTree(text)` builds a new tree from DSL text at runtime: `[createPerchanceTree("name\n\tbob").name]` → "bob". Imports inside such text require the SAME `{import:foo}` to exist somewhere in the generator (preloading); see dynamic-import-plugin for the on-demand version.
- Passing "inputs" to lists: `[myList.foo=123, myList]` sets a property then evaluates — preferred in big generators over global temp variables (avoids two features fighting over one global name), since `[this.foo]` inside the list reads it.

# Functions in main.pjs

```pjs
calculateDamage(num, joiner) =>
  d = dice.selectOne
  if (d >= 5) {
    d = d * 2
  }
  return d
```

- Header syntax `name(args) =>` with an indented body; NO outer braces. Only the `return` value prints — no `, ""` needed anywhere inside. `async name() =>` works (promises fine).
- All of JavaScript is valid inside functions and square blocks.
- Gotcha: the lists-panel editor STRIPS indentation inside function bodies (HTML-panel JS is unaffected) — don't rely on meaningful whitespace there.
- Functions can mutate outer variables and be stored like anything else: `[d = calculateDamage()]`.

# HTML panel specifics

- Square-bracket templating works in text nodes and non-event attributes. Event attributes (`onclick="..."`) are plain JS.
- **No HTML inside square blocks** in the HTML panel: output HTML is parsed FIRST (plain innerHTML), then blocks in text nodes evaluate — `[p = "<p>hi</p>"]` breaks. Workarounds: build the HTML in the lists panel instead, or replace every `<` with the JS escape `\u003c` (e.g. `[p = "\u003cp>hi\u003c/p>"]`).
- Inputs set variables directly: `<input oninput="name = this.value">` — but you MUST define a default (`name = Default Name` in main.pjs) or the first evaluation errors. Numeric inputs need `Number(this.value)` or comparisons/odds silently misbehave on strings.
- `<select oninput="country = this.value, update()">` — value attribute is what lands in the variable.
- Checkboxes are read via id: `[animalBox.checked]` — and a checkbox id must NOT collide with any list/variable name.
- Elements with an `id` are directly referenceable in JS (no getElementById).
- Setting `innerText` of the element CONTAINING a square block yields doubled text (open engine issue) — use textContent on a child, or elements without blocks.
- `update(elId)` re-randomizes one element; several buttons can funnel into one output by setting a `clicked` variable and using dynamic odds on it.
- Tabs break indent-wrapping alignment in output; use `&#9;` (HTML editor) / `\t` (lists editor) if it matters.

# Page/window control & error handling

- Globals: `generatorName`, `generatorPublicId` (32-hex), `generatorLastEditTime`, `generatorIsInEditMode`.
- `document.title = "foo"`, `window.location.hash = "#foo"`, and `history.replaceState({}, "", "/" + generatorName + "?foo=123")` all work as if top-frame. Changing the PATHNAME via replaceState is blocked (generator spoofing).
- `window.ignorePerchanceErrors(() => { ... })` runs code with Perchance errors suppressed (returns the callback's return value) — used when evaluating user-provided DSL text that may be buggy. `window.clearPerchanceErrors()` clears the error log.
- Infinite recursion in a list (e.g. a self-referencing `battle` item whose terminating item's odds never become selectable) freezes the tab. A generator SAVED in that state can be rescued: open `perchance.org/<name>#debugFreeze` — loads the editor without executing the code.
- The engine uses the built-in `Math.random()` for all randomness — wrap/replace it for seeded determinism (or see seeder-plugin).

# $meta and preprocessors

```pjs
$meta
  title = My Thing            // browser tab + listings; overrides <h1>. Default: first <h1>, else URL slug
  description = For SEO and the generator listing page.
  image = https://user.uploads.dev/file/....jpg  // listings + social cards. Default: an auto-screenshot
  tags = example, metadata, very cool             // comma-separated; getGeneratorList can filter on these
  header
    mode = minimal            // 'minimal' hides the site header behind a small hover button (edit mode still shows it)
    background = light-dark(lightblue, #003e84)  // any CSS background value; gradients/images/multi-layer fine
```

For query-dependent titles/descriptions/social images there's `$meta.dynamic` — see the `dynamic-metadata` skill file.

Preprocessors transform the lists-panel SOURCE before compilation (syntax extensions). Must be at the TOP of main.pjs — either inline:

```pjs
$preprocess(text) =>
  text = text.replaceAll(":smile:", "😊");
  return text;
```

or imported: `$preprocess = {import:inline-dent-preprocessor}`. A generator whose top-level `$output` is a function publishes itself as an importable preprocessor. Official: inline-dent-preprocessor; admin-hosted community ones: inferno-shorthand-preprocessor-v1, eatham-emoji-preprocessor-v1.

# Public HTTP APIs

Backwards-compatible forever, never deprecated — safe to call from generator code:

- `perchance.org/api/getGeneratorScreenshot?generatorName=name` — screenshot image.
- `perchance.org/api/getGeneratorList` — recently edited generators; `?max=123`; `?tags=cool,nice` filters on `$meta.tags`.
- `perchance.org/api/getGeneratorStats?name=animal` (or `?names=a,b,c`) — views, last edit time, metadata, public id.
- `perchance.org/api/downloadGenerator?generatorName=animal` — whole generator as one HTML file; `&listsOnly=true` for just the lists code.
- `perchance.org/api/getGeneratorHtml?generatorName=animal` — just the HTML-panel source.
- `perchance.org/api/getGeneratorsAndDependencies?generatorNames=animal,adjective` — `{success, generators:{animal:{name, code, imports:[...]}, ...}}`, transitively including all imports. (This is what dynamic-import-plugin uses; also the best way for code to introspect other generators.)

Viewer-side privacy feature (not a generator API): appending `?$csp` to any generator URL applies a Content-Security-Policy restricting the page to known-safe hosts (`perchance.org text-generation.perchance.org image-generation.perchance.org user.uploads.dev aigc.uploads.dev esm.sh cdn.jsdelivr.net cdnjs.cloudflare.com`); `?$csp=foo.com *.foo.com` customizes, `?$csp=... extra.com` extends the defaults. May legitimately break generators that call external servers.

# Official plugin directory

Import syntax: `pluginName = {import:plugin-name}` at top level of main.pjs. Officials are guaranteed never deleted / no breaking changes. Community plugins (Fandom list etc.) carry no such guarantee — fork your own copy before depending on one. When you meet an unfamiliar plugin in an old generator, fetch its page source (`fetch_generator <plugin-name>`) — plugin pages document themselves.

The ones with full skill files in this folder (load before non-trivial use): `text-to-image-plugin`, `ai-text-plugin`, `comments-plugin`, `upload-plugin`, `secret-plugin`, `kv-plugin`, `super-fetch-plugin`, `server-plugin` (multiplayer), `dynamic-metadata`, `music-generation`.

Frequently seen in old generators:

- **create-instance-plugin** — `[c = createInstance(blueprint), ""]`: runs selectOne on each PROPERTY (`=` items only) and fixes the results on a new object; sub-LISTS stay random unless `"deep"` mode (`createInstance(x, "deep")`, which is quirky — in deep mode child lists should only contain properties). Properties fix in declaration order, so later ones can depend on earlier via `[this.gender]` dynamic odds / `[names[this.gender]]`. create-instances-plugin makes a list of instances.
- **select-leaf-plugin** — `[selectLeaf(list)]` walks selectOne down the hierarchy until a childless node; result behaves like a normal selection (`.pluralForm` etc.). Each BRANCH is equally likely per level (leaves in bushy branches individually less likely). Siblings: select-leaves-plugin, select-all-leaves-plugin, consumable-leaf-list-plugin.
- **dynamic-import-plugin** — `[animal = dynamicImport('animal')]` imports at call time via getGeneratorsAndDependencies + createPerchanceTree. Default sync mode FREEZES the page during download; `'preload'` warms the cache in background; `'async'` returns a promise (`root.noun = await dynamicImport('noun','async')`). Results cached (same instance every call). Downloaded generators using it won't work offline.
- **remember-plugin** — `[remember(root, "location,hp,name")]` persists variables across reloads; `remember(root, '@forget')` clears. First-use pattern: `[if (name == undefined) {name = nameList.selectOne} else {name}]`.
- **goto-plugin** — `[goto(targetList, "link text")]` renders a link that swaps in another list's content; paired with a `location` variable + `[root[location]]` for text adventures.
- **literal-plugin** — escapes `{`/`[` in text so user-provided strings aren't parsed as DSL (important when injecting text into prompt lists).
- **dice-plugin** — `[dice("2d8")]` standard dice notation.

Rest of the directory (name → purpose): docs-plugin (markdown multi-page docs) · image-layer-combiner-plugin (layered random images, picrew-style) · pattern-maker-plugin (procedural patterns) · tap-plugin (randomize an output by tapping it) · tap-anywhere-plugin · press-enter-plugin · favicon-plugin · layout-maker-plugin (no-code layouts) · select-range-plugin · wheel-plugin (spinning wheel) · random-integer-plugin · random-decimal-plugin · seeder-plugin (same seed = same output) · url-params-plugin (read query params) · tooltip-plugin · generator-stats-plugin (view counter) · tldraw-plugin (collab canvas) · rpg-icon-plugin (~500 icons) · font-plugin (Google Fonts; custom: custom-font-importer) · google-sheets-plugin (lists from Sheets) · sum-odds-plugin (merge lists preserving odds) · background-image-plugin · background-audio-plugin · select-until-plugin (retry selectOne until predicate) · random-select-plugin (choose among inputs with odds, returns list refs) · typewriter-plugin · make-table-plugin · lockable-list-plugin / locker-plugin (lock selections while re-randomizing the rest) · fixed-until-reload-plugin · number-set-plugin (numbers summing to a target) · numerals-to-words-plugin / numerals-to-ordinal-words-plugin / numerals-to-ordinals-plugin / roman-numerals-plugin · text-to-speech-plugin · join-lists-plugin · exclude-items-plugin · filter-list-plugin · markov-chain-plugin · roll-table-plugin (dice-range item selection) · nested-plugin (hierarchical worlds) · navbar-plugin · markdown-plugin · consumable-list-loop-plugin · download-button-plugin · print-button-plugin · copy-text-plugin · fullscreen-button-plugin · tabs-plugin · conjugate-plugin · title-case-plugin · random-image-plugin · image-plugin · flat-avatar-plugin · a-an-plugin (`{a}` that survives partial updates) · be-plugin (is/are agreement) · plural-plugin (custom plurals) · date-plugin · bug-report-plugin · pride-plugin · tornado-plugin.

# Known engine gotchas (quick list)

1. No HTML inside HTML-panel square blocks (parse order) — `\u003c` workaround.
2. if/else needs its own square block after comma-commands.
3. Reading a list item evaluates it (raw text needs a function or getRawListText).
4. `x = {[a]|[b]}` + selectOne yields evaluated text, not the chosen list reference.
5. Lists-editor strips indentation inside function bodies.
6. Backslash kept before non-escapable chars; escape stripping is context-dependent.
7. `[{foo:1}]` parses as a block/label — write `[({foo:1})]`.
8. Setting `innerText` of a block-containing element doubles the text.
9. `if (n = 1)` assigns instead of comparing.
10. Checkbox/element ids must not shadow list/variable names.
11. Properties auto-parse to number/boolean when they look like one.
12. `[n]` before `[n = ...]` (left-to-right creation) — the most common bug in old generators.

# Studying examples

You can pull any generator's source with `fetch_generator <name>` (or the getGeneratorsAndDependencies API). Worth knowing: `perchance.org/examples` is the platform's walkthrough index. Useful named examples when you need a working reference for a pattern: `storing-selections-example-1/-2`, `simple-if-else-example` (+`-2/-3/-4`), `dynamic-sublist-referencing-example`, `matching-pronouns-with-genders-example`, `hierarchy-example`/`-2`, `multiline-pro-example`/`multiline-pro-simple-example`, `battle-simulator-example` (state mutation + recursion-with-odds loop), `consumable-list-with-dynamic-odds-example` (distinct picks + mutual exclusion), `create-instance-plugin-example`, `select-leaf-plugin-example`, `goto-and-remember-plugins-example` (text adventure), `output-history-example`, `multiple-independent-outputs-example`, `drop-down-list-example`, `simple-checkbox-example`, `seed-from-url-example`, `pass-variable-via-url-example`, `remember-user-inputs-basic-example`, `question-and-answer-example`, `sequential-pages-example`, `permutations-counter-example`, `commas-in-numbers-example`, `three-percentages-example`, `p5js-basic-example`.
