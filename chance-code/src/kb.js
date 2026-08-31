// tinker-chance knowledge base.
// A compact, accurate reference for writing tools (Tampermonkey userscripts,
// bots, extensions) that interact with Perchance generators.
window.PERCHANCE_KB = `
# PERCHANCE PLATFORM REFERENCE (for tool-builders)

## 1. PAGE ARCHITECTURE & IFRAMES (most important — read first)
- A generator's public page is https://perchance.org/<generatorName>. The top-level
  page is owned by perchance.org. The GENERATOR ITSELF does not render there.
- The generator renders inside an IFRAME whose URL is
  https://<generatorPublicId>.perchance.org/<generatorName> where generatorPublicId is a
  32-char hex string. This subdomain origin is DIFFERENT from perchance.org, so the
  iframe is CROSS-ORIGIN from the top page.
- Inside the iframe, the globals window.generatorName and window.generatorPublicId exist.
  window.generatorName is also editable by the owner (settings modal) and changes on fork.
- Consequence for userscripts:
  * A userscript matching only @match https://perchance.org/* CANNOT read or modify the
    generator DOM (cross-origin). You can see the iframe element but not its contents.
  * To interact with a generator, match the subdomain:
    @match https://*.perchance.org/*  (runs in the iframe too).
    Optionally exclude the editor: @exclude https://perchance.org/* (editor chrome).
    @noframes off (default) lets the script also run inside the iframe; keep it off.
  * The editor's live PREVIEW is also an iframe at the same subdomain
    (https://<publicId>.perchance.org/<name>#edit), so the same match covers testing.
- To embed a generator in your own page you can use src="https://null.perchance.org/<name>"
  (null resolves to the correct subdomain automatically).
- A userscript can also target the top-level page (e.g. to restyle the site UI around the
  generator, or inject buttons into the perchance.org chrome) — just know you can't reach
  the generator's DOM from there except via postMessage tricks, which generators don't
  implement. Match the subdomain for generator work.

## 2. EXECUTION MODEL & GLOBALS (what a script sees on the page)
- main.pjs is loaded before the HTML. Every top-level name in main.pjs becomes a global
  in the iframe page. The whole tree is reachable as window.root (root = top list).
- Order inside the iframe document:
  1. output HTML inserted WITHOUT running <script> tags,
  2. all <script> tags run top-to-bottom (type=module deferred),
  3. THEN all square blocks [...] in the HTML run, top-to-bottom, left-to-right.
  So a userscript @run-at document-idle sees everything already rendered. If you inject
  before then, note square blocks run AFTER scripts.
- window.update() re-runs the square blocks in the HTML (re-randomizes). It does NOT
  reset JS variables. update(elId) re-runs blocks inside one element only.
- Other useful globals in the iframe: generatorName, generatorPublicId,
  generatorIsInEditMode, generatorLastEditTime, ignorePerchanceErrors(fn) (runs fn with
  perchance errors suppressed, returns fn's return), clearPerchanceErrors().
- document.title = "x" works; history.replaceState({}, "", "/"+name+"?q=1") works to set
  query (pathname changes are blocked). window.location.hash works.
- The engine uses built-in Math.random() for all randomness — a userscript can wrap or
  replace Math.random to seed determinism (also sees the 'seeder-plugin' idea).

## 3. SELECTION / LIST-TREE API (how to drive a generator from JS)
- A "list" is a named subtree. Reading it as text = [listName] in the HTML, or in JS:
  root.listName.selectOne.evaluateItem  -> one random fully-evaluated string.
- Common methods on a list node: selectOne, selectMany(n), selectUnique(n), selectAll
  (-> array, the way to iterate), getLength, evaluateItem (fully evaluated string),
  joinItems(sep), getChildNames, getPropertyNames, getRawListText (raw source text),
  createClone, getOdds.
- [x = list.selectOne, ""] assigns and prints nothing; the comma trick runs commands and
  prints only the LAST expression. Dynamic-variable shorthand: name = [block] re-evals
  every mention.
- Odds: item ^2 (2x weight), ^0.3, ^[expr] re-evaluated per selection; booleans coerce
  (^[cond] => weight 1 or 0). Dynamic odds see earlier-assigned vars — used to exclude.
- Properties: hp = 10 parses to a NUMBER; isBald = true parses to boolean. Footgun:
  a string that looks like a number/boolean gets coerced. Use quotes if you need text.
- {a|b|c} inline alternation with odds; {1-10} number range; nests.
- if/else blocks: [if (cond) {A} else {B}] — branches are bare list names or quoted text.
  Cannot follow a comma-command in the SAME block (split into two blocks).
- $output overrides what a node evaluates to; $output = [this.joinItems("\\n")] joins a
  list's items with newlines.
- Imported plugins: pluginName = {import:plugin-name} at top of main.pjs; they become
  root.pluginName and are usable from scripts via root.pluginName(...).
- Gotcha: bare list names (e.g. animal.selectOne) work ONLY inside classic inline <script>
  tags, NOT in module scripts, NOT in src/ files. Use root.animal.selectOne everywhere else.

## 4. PUBLIC HTTP APIs (fetch from your tool)
All are GET, backwards-compatible, at https://perchance.org/api/... :
- getGeneratorStats?name=<name>  (or ?names=a,b) -> views, lastEditTime, metadata, publicId.
- downloadGenerator?generatorName=<name> -> whole generator as one HTML file
  (&listsOnly=true for just the lists/main.pjs source).
- getGeneratorHtml?generatorName=<name> -> just the HTML-panel source.
- getGeneratorsAndDependencies?generatorNames=a,b -> {success, generators:{a:{name, code,
  imports:[...]}}} transitively including all imports. BEST way to introspect a generator's
  real source (lists code + imports).
- getGeneratorScreenshot?generatorName=<name> -> screenshot image.
- getGeneratorList?max=123&tags=cool -> recently edited generators filtered by $meta.tags.
- CORS reality: the generator iframe origin (xxxx.perchance.org) is cross-origin to
  perchance.org/api. Plain fetch() from the iframe to those APIs FAILS CORS. Options:
  * In a userscript: use GM_xmlhttpRequest with @grant GM_xmlhttpRequest and
    @connect perchance.org (and @connect *.perchance.org if needed) — bypasses CORS.
  * Inside a generator: super-fetch-plugin (superFetch) proxies through a Perchance server.
- Viewer-side CSP flag: appending ?$csp to a generator URL restricts the page to known
  safe hosts (perchance.org, *.perchance.org, user.uploads.dev, esm.sh, cdn.jsdelivr.net,
  cdnjs.cloudflare.com...). May break generators calling external servers.

## 5. ENGINE GOTCHAS (common bugs to warn users about)
1. No HTML inside square blocks in the HTML panel: [p = "<p>hi</p>"] breaks (parse order).
   Workaround: build HTML in lists panel, or escape < as \\u003c.
2. if/else can't follow a comma-command in the same block.
3. Reading a list item EVALUATES it (re-randomizes inner blocks) — for raw text use a
   function or getRawListText.
4. x = {[a]|[b]} + selectOne yields evaluated TEXT, not the chosen list reference.
5. Setting innerText of the element CONTAINING a square block doubles the text (open
   engine issue) — use textContent on a child, or elements without blocks.
6. if (n = 1) assigns instead of comparing (classic JS footgun).
7. Element ids must not collide with list/variable names (checkbox footgun).
8. Reading [n] before [n = ...] in the same evaluation errors (left-to-right creation) —
   the most common new-user bug.
9. [{foo:1}] parses as a block/label — write [({foo:1})].
10. Backslash is kept before non-escapable chars; escape stripping is context-dependent.
11. Lists-editor strips indentation inside function bodies (HTML-panel JS unaffected).
12. Properties auto-parse to number/boolean when they look like one.

## 6. PLUGIN DIRECTORY (shortlist; import with name = {import:plugin-name})
- ai-text-plugin (generateText) — LLM text gen. kv-plugin — local IndexedDB key/value
  storage (set/get/delete, survives reloads). super-fetch-plugin (superFetch) — CORS-free
  fetch via Perchance proxy. upload-plugin — upload files / editable text files to a URL.
  comments-plugin — comments/chat widget. secret-plugin — public-key encryption.
  server-plugin — realtime multiplayer server. text-to-image-plugin (generateImage) —
  AI image gen. dynamic-import-plugin — import generators at runtime.
- Others worth knowing: literal-plugin (escape brackets in user text), remember-plugin
  (persist vars across reloads), goto-plugin (text adventure links), dice-plugin,
  seeder-plugin (seeded randomness), url-params-plugin (read query params),
  random-select-plugin (choose among inputs with odds), consumable-list-plugin
  (selectOne removes picks), select-leaf-plugin, markdown-plugin, docs-plugin,
  background-image-plugin, favicon-plugin, text-to-speech-plugin, font-plugin,
  rpg-icon-plugin, wheel-plugin, generator-stats-plugin (view counter), tabs-plugin,
  navbar-plugin, typewriter-plugin, p5js-basic-example etc.
- Community plugins have NO guarantee of staying available — fork before depending.

## 7. TAMPERMONKEY TECHNIQUE PATTERNS
- Metadata: @name, @namespace, @version, @description, @match, @run-at
  (document-idle for post-render), @grant (list the GM_ APIs you use; grant none + run
  with sandbox off gives you page globals directly but you lose GM_ APIs),
  @connect host (required for GM_xmlhttpRequest to non-* hosts; use @connect * to allow
  all), @noframes, @icon.
- Waiting for content: generators often build UI asynchronously. Poll for a sentinel
  element or for typeof root !== 'undefined' / a known selector before acting. E.g.
  for (let i=0;i<100;i++){ const el = document.querySelector(sel); if (el) break;
  await new Promise(r=>setTimeout(r,100)); }
- Dynamic content: use MutationObserver on document.body (childList + subtree) to react
  to re-renders, or observe the element holding the generator output (update() swaps its
  textContent).
- Calling update() re-rolls a generator: document.querySelector(button)?.click() or
  window.update() if exposed (it's a global in the iframe).
- Reading output: get the output element and read .textContent (not .innerText, which can
  double text). Re-rolls replace the text, so re-read after update().
- Cross-origin API calls: use GM_xmlhttpRequest with @connect perchance.org; see section 4.
- Persistence: GM_setValue/GM_getValue survive across page loads (per-userscript storage,
  one object each, can store JSON strings). Alternatively read/write the generator's own
  kv-plugin storage via its IndexedDB if you need the generator to see the data too.
- Styling: GM_addStyle(css) (with @grant GM_addStyle) injects a <style> tag — use it for
  injected UI so you don't fight the generator's CSS.
- Isolation: wrap code in an IIFE, 'use strict', catch errors so a failure doesn't break
  the host page. Avoid overriding page globals unless that's the point.
- Structure: metadata block -> IIFE -> constants/config (CSS, selectors) -> helper
  functions (waitFor, observe, api call) -> main() guarded by waitFor.
`.trim();
