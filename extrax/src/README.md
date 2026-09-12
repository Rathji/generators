# Extrax

Extrax has two capabilities, each in its own tab.

> **Status:** feature-complete. All build-roadmap phases (foundation → markdown engine → preview/export → library → batch → AI enhancement → final polish) are done; the persisted roadmap checklist was removed once complete. User-facing instructions for every feature live in the in-app **"How to use Extrax"** panel on the page (`index.html`), and the technical reference below is for developers/agents maintaining it.

## Theme Vault

Captures the "theme" of any Perchance generator — its mood, aesthetic, color palette and vibe — and stores it in a personal, persistent reference library.

## How it works

- User enters a Perchance generator name or URL.
- App fetches its source via `https://perchance.org/api/getGeneratorsAndDependencies?generatorNames=<name>` (main.pjs).
- Fetches its HTML panel via `https://perchance.org/api/getGeneratorHtml?generatorName=<name>` — this endpoint is CORS-blocked to browser fetch, so it goes through `super-fetch-plugin`.
- Parses the generator's `$meta` block (title / description / image / tags) from its main.pjs.
- Deterministically extracts **fonts** and **CSS tokens** from main.pjs + HTML: distinct `font-family` stacks + Google Fonts `family=` params, `@import`/`<link>` font URLs, `:root` custom properties, and key `body`/`html` styles (background, color, font-family, size, radius, shadow, etc.).
- Sends truncated snippets (5000 chars each of main.pjs + HTML) + metadata to `generateText` (ai-text-plugin) which returns a structured theme reference:
  `GENRE / MOOD/VIBE / VISUAL AESTHETIC / COLOR PALETTE / CORE SUBJECT / THEME IN ONE LINE / TAGS`.
- Optionally generates a mood image (text-to-image-plugin) from the theme lines.
- Saves the card to the user's personal library.

## Storage

`kv-plugin`, folder `themeVault`:
- key `order` — array of card ids (newest first)
- key `card_<id>` — card object `{id, name, title, description, tags[], theme, image, notes, fonts[], fontLinks[], cssVars{}, keyStyles{}, createdAt}`

`image` is either the generator's own `$meta.image` URL or a `data:` URL from a generated mood image (stored locally, never uploaded).

The CSS snippet shown on a card is derived at render time from `fontLinks` + `cssVars` + `keyStyles` via `buildCssCode()` (resolves `var(--x)` references against the captured vars) — it isn't stored separately.

`kv-plugin`, folder `extraxDocs` (Web → Markdown saved documents):
- key `order` — array of document ids (newest first)
- key `doc_<id>` — `{id, title, url, site, author, published, tags[], notes, markdown, stats, options, createdAt}`

Everything the Web → Markdown side saves lives in this browser-local KV store — no capture content is uploaded anywhere. (Checked by instrumenting `window.fetch`: saving a document + adding tags + copying produced zero network calls; the only request on the storage path is perchance's own `securityData` GET, which carries no body/user data.)

`kv-plugin`, folder `extraxWatch` (Watch mode):
- key `order` — array of watch ids (newest first)
- key `watch_<id>` — `{id, url, title, hash, markdown, addedAt, checkedAt, changed}`

`kv-plugin`, folder `extraxJobs` (resumable batch / crawl jobs):
- key `current` — the one in-progress job `{id, kind, input, results[], createdAt, updatedAt}`, cleared automatically when the run finishes

## Features

- Capture a generator theme by name/URL
- Font chips (the exact `font-family` stacks + Google Fonts families the generator uses)
- "Recreate CSS" snippet per card: `@import` font links + `:root` custom properties + key `body` styles, copyable — enough to restyle a project to match the captured theme
- Optional mood image at capture time (checkbox), or per-card "Mood image" button
- Search across title/name/theme/fonts/CSS values/tags/notes
- Editable notes per card (debounced autosave)
- Copy theme text to clipboard (reuse it as a design reference)
- **Export / Import** — back up or move your vault:
  - *Export JSON* — lossless full backup (all fields, incl. embedded mood images)
  - *Export Markdown* — a readable reference document (one section per theme: fields, theme lines, notes, fonts, CSS, mood image) that can be imported back
  - *Import* — accepts either format; JSON restores original cards (existing ids are skipped), Markdown is parsed into new cards
- Two-step delete (click → "Confirm?" → click)

### Theme extras

- **Design tokens** (`src/theme/tokens.js`) — from a card's captured palette + CSS vars + key styles, derive a design-token set (colors, background, text, font, radius, shadow) and export it as **JSON / CSS custom-properties / SCSS variables / Tailwind config / Markdown**. `Tokens` opens a modal with all five tabs and a copy/download button per format.
- **Starter scaffold** (`src/theme/scaffold.js`) — `Starter` opens a modal with a four-file starter project (`index.html`, `main.pjs`, `theme.css`, `README.md`) pre-themed from the card (colors, fonts, palette, mood) plus a live in-modal preview and a **Download .zip** (via `src/lib/zip.js`).
- **Similar themes** (`src/theme/compare.js`) — `Similar` ranks the other cards by a token-overlap similarity score (`themeSimilarity`, `findSimilar`) and shows the closest matches; `Compare` opens a side-by-side field table (`compareCards`) that flags which fields differ.
- **Generator inspector** (`src/theme/inspector.js`) — `Inspect source` fetches a generator's main.pjs + HTML via the public API, parses it into a list tree (`parsePjsTree`), and shows title/description/imports/`$output`/list & function counts (`generatorOverview`, `overviewSummary`) alongside a live `<iframe>` preview of the generator.

## Web-to-Markdown

A second capability (tab "Web → Markdown") captures any web page and turns it into clean Markdown, using the same `super-fetch-plugin` proxy and `kv-plugin` storage.

Pipeline (Phases 1–6 complete: fetch → validate → extract → convert → front-matter → preview/export → library → batch → size caps → quality analysis → AI cleanup/refinement → doc import/export):

1. **Fetch** — `src/w2m/fetcher.js` `fetchDocument(input, {fetchImpl})` normalizes the URL, fetches through `root.superFetch` with an `AbortController` timeout (default 30s) and an 8 MB size cap, and returns `{url, finalUrl, host, status, contentType, html, bytes, elapsedMs}`.
2. **Validate** — non-HTML content types (PDF/image/JSON), binary bodies, empty bodies, non-2xx statuses and unreachable hosts are rejected with a typed `W2MError` code (`src/w2m/errors.js`).
3. **Extract** — `src/w2m/extract.js` parses with the browser `DOMParser` (inert: no scripts run), prunes boilerplate (`script/style/nav/footer/aside/iframe/form/...`, ARIA chrome roles, hidden nodes, ad/social/comment class-pattern nodes), then picks the main content root (`article`/`main`/`[role=main]`/common content ids & classes, else `<body>`). Metadata is scraped from `<head>` **before** pruning.
4. **Metadata** — `src/w2m/metadata.js` `extractMetadata(doc, {url})` returns `{title, author, published, modified, site, canonical, description, lang, source}` (OG/Twitter/JSON-LD-style meta tags, `<time>`, byline selectors; canonical resolved against the final URL; site falls back to the host).
5. **Convert** — `src/w2m/convert.js` `convertHtmlToMarkdown(root, options)` maps the content DOM to GitHub-flavored Markdown: headings, paragraphs, nested ordered/unordered lists, blockquotes, fenced code (language detected), inline code/bold/italic/strikethrough, links + images (absolute or relative, resolvable titles), GFM tables (with column alignment), `<hr>`, definition lists, `<br>` hard breaks, and Markdown-significant-character escaping. Permalink glyph anchors (`¶`/`§`/`#`) are dropped.
6. **Front-matter + assemble** — `src/w2m/metadata.js` `formatFrontmatter()` emits a YAML block of the non-empty metadata fields; `src/w2m/document.js` `buildDocument(html, options)` orchestrates extract → convert → front-matter and returns `{title, metadata, frontmatter, body, markdown, stats}`.

**Preview & export options (Phase 3):** after a capture, the result panel shows a read-only Markdown preview plus a live stats line (`markdownStats`). Three controls re-render the Markdown in place (re-running `buildDocument` on the captured HTML, no refetch): an **Images** checkbox (`includeImages`), a **Front-matter** checkbox (`includeFrontmatter`), and a **Links** dropdown choosing `absolute` / `relative` / `footnote` URLs.

**Output & library (Phase 4):** the result panel has **Download .md** / **Copy Markdown** / **Save to library** actions. Saved documents appear in a library below the capture box, backed by `src/w2m/library.js` over the `extraxDocs` KV folder — with search across title/url/site/tags/notes/body, editable tags (add via the `+ tag` input, remove via a chip's ×), per-document notes, a collapsible Markdown view, Copy/Download/Delete, and a two-step delete confirm.

**Batch processing (Phase 5):** the Web tab has a **Single / Batch / Site crawl** mode switch. Batch mode:

- **Input** — `src/w2m/batch.js` `parseUrlList(text)` accepts one URL per line and also splits on commas, strips bullet markers (`- * + 1.`), blockquote `>` and `#`/`//` comments, unwraps Markdown links `[label](url)` (URLs with parens included), dedupes by normalized URL, and keeps invalid entries flagged `valid:false` (listed with an "invalid" state, no Retry).
- **Orchestrator** — `runBatch(entries, handlers)` processes URLs **sequentially** (one at a time, 300 ms gap) so the proxy isn't hammered. Each item reports `onStart` / `onItem`; `shouldStop()` aborts the loop; the **Stop** button cancels mid-run.
- **Per-row UI** — each row shows status (queued / fetching / ok / error / invalid), byte + word counts, and Copy / Download .md / Save / Retry actions, plus a **Remove** button that drops the page from the run (and its line from the textarea) so it's excluded from every export. Row previews are **lazy** (`fillBatchPreview` runs on `<details>` toggle via a delegated capture-phase listener) so a large run never builds huge hidden DOM.
- **Combined export** — `combineDocuments(docs)` merges every successful result into one Markdown file: shared YAML front-matter, a `# Combined` title, a TOC linking to `#doc-N` anchors, then `## N. Title` sections with each document's own front-matter stripped. **Download combined .md** / **Copy combined**.
- **Export all (`src/w2m/exports.js`)** — the result panel's **Save all** control builds a list of files from every kept page (removed pages excluded): a single combined document, or one file per page when the **Individual files** checkbox is ticked; the **Format** dropdown picks **Markdown** or **JSON** (JSON uses the same `docsToJson` envelope as the library export, so it re-imports). `buildExportFiles(docs, {format, individual, baseName, title, includeToc, includeFrontmatter, createdAt})` is pure (returns `[{name, mime, text}]`) so it's unit-tested; `downloadExportFiles()` staggers the downloads (400 ms apart, collision-safe names) and flashes progress on the button. **Copy combined** / **Copy index** and **Add all to library** round out the row.

**Large-page handling (`src/w2m/truncate.js`):** a shared **size cap** dropdown (`#w2mOptLimit`, applies to both modes) chooses an HTML-byte ceiling — `small` 600 KB / `balanced` 2.5 MB (default) / `large` 6 MB / `unlimited` 8 MB (`LIMIT_PRESETS`, `DEFAULT_LIMIT`, `resolveLimits`, `limitsFor`). `buildDocument` truncates HTML at a tag boundary before extraction and, if needed, caps the resulting Markdown with a `> **Truncated.**` note; it returns a `truncation` object `{html:{truncated,fullChars,keptChars}, markdown:{...}, limit, any}`. The UI shows an amber warning box (`#w2mTruncWarn`) and a TRUNCATED stat pill in single mode. Batch row previews are also capped (`PREVIEW_CAP` = 200 KB of text) so rendering never hangs. Benchmark on synthetic 890 KB HTML: `small` ≈ 49 ms, `balanced` ≈ 124 ms, both truncating correctly.

**Quality analysis & AI cleanup (Phase 6):**

- **Ambiguity / quality detection** — `src/w2m/quality.js` `analyzeQuality(markdown, {stats, metadata, html})` scores 0–100 (lower = cleaner) and returns `{score, level, signals[]}` where each signal is `{key, label, weight, detail}`. Signals: `no_content_root`, `low_text_ratio`, `js_heavy`, `stub_content`, `link_soup`, `fragmented`, `thin_prose`, `boilerplate`, `duplicate_lines`, `empty_headings`, `mojibake`. `qualityLevel(score)` buckets into `clean` / `fair` / `messy` / `broken` (`QUALITY_LEVELS`); `MESSY_THRESHOLD = 45` is where the UI nudges toward AI cleanup. `qualitySummary()` / `qualityDelta(before, after)` produce the human line + the before→after chip in the review panel, and `qualitySummary().signals` drive the per-signal chips under the badge.
- **AI cleanup bridge** — `src/w2m/cleanup.js`. `CLEANUP_PRESETS` (tidy / article / readable / outline / summary / custom) each carry a label + instruction; `buildCleanupPrompt({markdown, metadata, preset, feedback, revisions, maxTokens})` assembles a **prefix-cache-friendly** prompt: constant system preamble + document metadata + the source Markdown first, then the append-only prior revisions, and the specific instruction (preset text + user feedback) last, so repeated refinement calls share a cacheable prefix. `fitToBudget(text, maxTokens, {countTokens})` binary-searches to fit the token budget (using the plugin's token counting). `normalizeCleanupOutput()` strips a single wrapping code fence if the model added one. `runCleanup()` calls `root.generateText` (streaming via `onChunk`, exposes the pending promise via `onPending` so `.stop()` works) and resolves the cleaned Markdown.
- **Refinement loop** — after capturing a page (or an AI clean), the result panel's AI box shows the quality badge + signals, a preset dropdown, a custom-instruction input, and a **Clean up with AI** button (with a working **Stop**). The returned revision opens a **review panel** (`#w2mCleanReview`) that streams the proposed Markdown live, shows the quality delta, and has **Use this version** / **Discard** / **Copy** / **Download** actions plus a **feedback + Refine again** input. Each AI pass becomes a numbered revision (`v1`, `v2`, …) with an `Original` baseline in a revision bar (`#w2mRevBar`); clicking a chip swaps the preview between revisions, and accepting a revision re-applies it to the options/preview and (for saved docs) the library record. **Reject** removes the pending revision. Nothing is overwritten until the user accepts.
- **Batch AI clean** — each batch row has a **Clean** action (`.bClean`) running the same pipeline for that row; a row shows its quality badge and an "AI-cleaned" state with a **Re-clean** button. `cleanBatchItem(index)` re-applies a cleaned body across option changes via `rebuildBatchDocs`.
- **Document export / import** — `src/w2m/docexport.js`. **Export JSON** (`docsToJson`) is the lossless back-up of all saved docs; **Export Markdown** (`docsToMarkdown`) writes a readable reference doc carrying a machine-readable marker (`<!-- extrax-doc {json} -->`) plus a `<document>…</document>` fence per doc, so it round-trips back losslessly. **Import** (`handleDocImportFiles`) accepts both JSON and `.md` files, parses front-matter + markers (`docsFromMarkdown`), dedupes against existing docs, and reports a summary (`#docIoMsg`). `library.js` `createDocRecord` honours imported ids/createdAt/notes and normalises/dedupes tags.

**Secret audit (task 35):** grepped all of `src/`, `main.pjs` and `index.html` for key/token/secret/password patterns (`api_key`, `secret`, `token`, `password`, `bearer`, `sk-`, `AIza…`, `ghp_…`, PEM blocks). No hardcoded credentials exist — all AI/image/fetch/storage work goes through the imported Perchance plugins, which are keyless and proxy through the platform server-side. (The only `token`/`secret` matches are tokenizer variable names in `cleanup.js`/`batch.js`.)

**Site crawl (Phase 7):** the third mode (**Site crawl**) follows the links on a start page and turns every page it reaches into its own Markdown file — one `.md` per page, in folders that mirror the site's URL paths.

- **Engine** — `src/w2m/crawl.js` `crawlSite(start, options)` does a breadth-first walk from a normalized start URL. Options: `maxDepth` (link hops, default 2), `maxPages` (default 25), `sameHostOnly` (default true), `include`/`exclude` URL-substring filters, `delayMs` politeness gap (UI uses 300 ms), and injected `fetchPage(url, node)` + `buildDoc(html, url)` so it reuses the single-page fetch/convert pipeline. Hooks: `onStart`, `onVisit`, and `shouldStop()`. URLs already seen are deduped by `crawlKey()`; once `maxPages` is hit, the remaining queue is reported `status:"skipped"`; per-page failures are captured as `status:"error"` without aborting the run. Returns `{pages, start, host, maxDepth, maxPages, stopped, total, ok, failed, skipped}`.
- **Link extraction** — `linksFromHtml(html, baseUrl, options)` parses anchors/areas, resolves relative URLs against the page's final URL, and drops fragments, non-http schemes, non-HTML file extensions, self-links, and (unless disabled) off-host links; `include`/`exclude` filter on the absolute URL. `extractLinks(doc)` is the DOM-level helper.
- **Tree + filenames** — `crawlTree(pages)` nests pages under their `parent` for indented rendering; `crawlFilePath(url)` maps a URL to a path like `host/path/…​.md` (directory URLs → `index.md`, `.html`/extension pages → `name.md`, host as the top folder); `crawlFilePaths(pages)` builds a `url → unique path` Map for the `ok` pages (collision-safe via `uniqueZipName`).
- **Exports** — `crawlManifest(pages, {paths, startUrl, title, createdAt})` writes the `_index.md` table of contents (indented by depth, relative links). `createZip(files)` is a dependency-free store-method ZIP writer (CRC32 + local headers + central directory + EOCD) so **Download .zip** produces one archive with every `.md` in its folder structure. The result panel also offers the shared **Save all** control (combined or one file per page · Markdown or JSON, via `src/w2m/exports.js`), **Add all to library** (tagged with the site host) and **Copy index**; each tree row has Copy / Download .md / Save plus a **Remove** button that drops the page from the export (tree, manifest, zip and downloads all update), and a lazy Markdown preview.
- **UI** — `#w2mCrawlBox` (input, **Crawl site** / **Stop**, depth & max-page selects, same-host checkbox, URL filter, progress line, live tree `#w2mCrawlTree`, and a `#w2mCrawlResult` stats/export panel). `startCrawl`/`stopCrawl` + `initCrawl` in `app.js`; the tree re-renders on every visited page so progress is visible during the run.

**Watch mode (Phase 8):** the fourth mode (**Watch**) keeps a list of pages and shows exactly what changed between visits.

- **Diff engine** (`src/w2m/watch.js`) — `contentHash()` (stable FNV-style hash of the normalised Markdown), `diffLines(old, new)` (LCS-based line diff returning added/removed/changed hunks), `changeSummary()`, `diffStats()` and `diffToMarkdown()` (a downloadable/`viewable` change log). `createWatchRecord()` / `createWatchStore(folder)` persist records in the `extraxWatch` kv folder.
- **UI** — `#w2mWatchBox` (add the current page or a URL, **Check now**, **Check all**, per-row Open/Check/Diff/Remove). Each row shows when it was last checked and whether it changed; **Diff** renders the line diff with `.diffadd` / `.diffdel` styling and offers copy/download.

**Structured data (Phase 9):** the single-result panel's **Tables & CSV** button (`src/w2m/structured.js`) scrapes every `<table>` on the captured page (`tablesFromHtml`, handling colspan/rowspan), shows them, and exports each as **CSV** or **JSON** (combined or per-table, via the shared zip/download helpers). A **Schema prompt** builder (`buildSchemaPrompt`) + `parseSchemaOutput` support AI structured extraction — the model returns a JSON array of records for a chosen schema, which is previewed and downloadable.

**Resource inventory (Phase 10):** the **Resources** button (`src/w2m/inventory.js`) inventories every link, image (incl. `srcset`/`data-src`), media file, downloadable file and email on the captured page (`inventoryFromHtml`), classified and summarised (`inventorySummary`), exportable as JSON/CSV plus a copyable list of images/files.

**Context bundles & Ask-your-library (Phase 11):** `src/w2m/llmcontext.js` builds an LLM-ready bundle from the saved documents (`buildContextBundle` — numbered sources + concatenated bodies, honouring a token budget and reporting dropped docs; `bundleFileName`) and powers **Ask your library** (`buildAskPrompt` — a prefix-cache-friendly grounding prompt instructing the model to cite `[n]`; `runAsk` streams the answer and `parseAskAnswer` extracts the `[n]` citations so they render as source chips). A **Context bundle** button downloads the bundle as Markdown.

**EPUB export (Phase 12):** `src/w2m/epub.js` (`markdownToXhtml`, `buildEpub`, `epubFileName`) turns one document, a batch run, a crawl, or the whole library into a valid EPUB 3 archive (correct `mimetype` entry stored first, `container.xml`, OPF manifest/spine, per-chapter XHTML) downloadable as `.epub`.

**Resumable jobs (Phase 13):** batch and crawl runs persist their in-progress state through `src/w2m/jobs.js` (`createJob`, `createJobStore` over the `extraxJobs` kv folder, `serializeBatchResults` / `serializeCrawlPages` and their deserializers). If a run is stopped or the tab is closed, a **resume bar** (`#w2mResumeBar`) appears on reload offering **Resume** (re-runs the unfinished items into the same report) or **Discard**; the job is cleared once every item finishes.

**Launcher & bookmarklet (Phase 14):** `src/w2m/launcher.js` powers the inbox bar at the top of the Web tab (`#w2mInboxInput` + **Go**) — paste a page URL, a list of URLs, or a Perchance generator name/URL and `detectInput` + `routeInput` send it to the right mode. `handleLaunchHash` reads a `#…` launch payload (`parseLaunchHash`) so links can pre-fill the tool. The **Bookmarklet** button opens a modal with a drag-to-bookmarks-bar script (`bookmarkletForGenerator` / `launchUrl` / `encodeLaunch`) that sends the current page (or selection) straight into Extrax.

Error taxonomy (`W2MError.code`): `empty`, `invalid`, `invalid_host`, `unsupported_scheme`, `no_fetch`, `unreachable`, `timeout`, `http_error`, `blocked` (401/403/429/451 or a bot-challenge page), `paywall` (402 or paywall copy), `non_html`, `binary`, `too_large`, `parse_error`, `empty_content`. `describeError()` maps them to a title + hint shown in the UI.

## Code layout

- `index.html` — app shell: styles, markup, the theme-vault logic (inline classic script), and the tab switcher. The Web-to-Markdown feature lives in ES modules under `src/w2m/` loaded via `<script type="module" src="src/w2m/app.js">`.
- `src/lib/zip.js` — dependency-free store-method ZIP writer (`crc32`, `toBytes`, `uniqueZipName`, `createZip`) shared by the starter-scaffold and EPUB exports.
- `src/ui/modal.js` — reusable modal helper (`openModal`, `closeModal`, `modalBody`, `isModalOpen`, `el`) with its own injected styles.
- `src/theme/bridge.js` — the Theme Vault UI layer: per-card action buttons (Tokens / Starter / Similar / Compare), the tokens / starter / similar / compare / inspector modals, the inspector source fetch + preview, and the mood-image action. Exposed to the inline page script as `window.extraxTheme`.
- `src/theme/tokens.js` — design tokens extracted from a card (`designTokens`, `cardColors`, `normalizeColor`, `colorsFromText`, `resolveVars`) and their serialisers (`tokensToJson/CssVars/Scss/Tailwind/Markdown`).
- `src/theme/scaffold.js` — `starterScaffold(card)` (four themed starter files) + `scaffoldZipName()`.
- `src/theme/compare.js` — theme similarity & comparison (`themeFields`, `themeSimilarity`, `findSimilar`, `compareCards`, `compareToText`).
- `src/theme/inspector.js` — generator source parsing: `parsePjsTree`, `listNames`, `functionNames`, `generatorImports`, `generatorMeta`, `generatorOverview`, `overviewSummary`, `extractGeneratorName`, and the generator API/HTML/page/preview URL builders.
- `src/w2m/urls.js` — URL normalization + content-type/HTML sniffing helpers (pure).
- `src/w2m/errors.js` — `W2MError` class + `describeError()`.
- `src/w2m/fetcher.js` — `fetchDocument()`, barrier (blocked/paywall) detection, capped streaming reader.
- `src/w2m/extract.js` — `parseHtml()`, `pruneBoilerplate()`, `findContentRoot()`, `extractContent()`.
- `src/w2m/metadata.js` — `extractMetadata()`, `formatFrontmatter()`, `FRONTMATTER_FIELDS`, `normalizeDate()`.
- `src/w2m/convert.js` — `convertHtmlToMarkdown()` (the GFM conversion engine) + `CONVERT_DEFAULTS`. `linkMode` accepts `absolute` / `relative` / `footnote` (footnote mode emits `[^n]` markers and appends deduplicated `[^n]: url` definitions).
- `src/w2m/stats.js` — `markdownStats()` (words / characters / lines / reading time) for the live preview header.
- `src/w2m/library.js` — saved-document store (`createDocStore(folder)` over a kv folder) + record helpers (`createDocRecord`, `docFilename`, `slugifyTitle`, `normalizeTag`, `matchDoc`, `uniqueFilename`).
- `src/w2m/batch.js` — batch helpers: `parseUrlList()`, `runBatch()` (sequential orchestrator with stop/callbacks), `combineDocuments()`, `stripFrontmatter()`.
- `src/w2m/crawl.js` — site-crawl engine: `crawlSite()`, link extraction (`extractLinks`, `linksFromHtml`), tree/path mapping (`crawlTree`, `crawlFilePath`, `crawlFilePaths`, `uniqueZipName`), the `_index.md` builder (`crawlManifest`), and the dependency-free `createZip()` writer (`crc32`).
- `src/w2m/exports.js` — pure export builder for the batch/crawl **Save all** control: `exportRecord()` (a doc → library record) and `buildExportFiles(docs, {format, individual, …})` returning `[{name, mime, text}]` (combined or one file per page, Markdown or JSON).
- `src/w2m/truncate.js` — size-cap presets + truncation: `LIMIT_PRESETS`, `DEFAULT_LIMIT`, `resolveLimits`, `limitOptions`, `limitsFor`, `formatCount`, `truncateText`, `truncateHtml`, `truncateMarkdown`, `truncationSummary`.
- `src/w2m/document.js` — `buildDocument()` orchestrator (extract → metadata → convert → front-matter → size-cap truncation).
- `src/w2m/quality.js` — Markdown quality scoring + levels + signals (`analyzeQuality`, `qualityLevel`, `qualitySummary`, `qualityDelta`, `QUALITY_LEVELS`, `MESSY_THRESHOLD`).
- `src/w2m/cleanup.js` — AI cleanup bridge (`CLEANUP_PRESETS`, `cleanupPresets`, `presetByKey`, `buildCleanupPrompt`, `normalizeCleanupOutput`, `fitToBudget`, `runCleanup`, `applyBody`).
- `src/w2m/docexport.js` — document export/import (`docsToJson`, `docsFromJson`, `docsToMarkdown`, `docsFromMarkdown`, `parseDocsMarkdown`, `docFromMarkdown`, `parseFrontmatter`, `makeImportedRecord`, `hasDocMarkers`, `DOC_FORMAT`).
- `src/w2m/structured.js` — table scraping/export + AI schema extraction (`tablesFromHtml`, `tableToCsv`, `tablesToJson`, `tableFiles`, `tablesSummary`, `buildSchemaPrompt`, `parseSchemaOutput`, `defaultSchema`).
- `src/w2m/inventory.js` — page resource inventory (`inventoryFromHtml`, `inventorySummary`, `inventoryToJson/Csv`, `inventoryFiles`, `inventoryImageLinks`).
- `src/w2m/watch.js` — Watch mode (`contentHash`, `diffLines`, `changeSummary`, `diffToMarkdown`, `diffStats`, `createWatchRecord`, `createWatchStore`, `watchSummary`).
- `src/w2m/llmcontext.js` — context bundles + Ask-your-library (`buildContextBundle`, `bundleFileName`, `buildAskPrompt`, `parseAskAnswer`, `runAsk`).
- `src/w2m/epub.js` — EPUB 3 export (`escapeXml`, `markdownToXhtml`, `buildEpub`, `epubFileName`).
- `src/w2m/jobs.js` — resumable batch/crawl jobs (`createJob`, `createJobStore`, `isResumable`, `jobProgress`, `jobSummary`, `serializeBatchResults`/`deserializeBatchResults`, `serializeCrawlPages`/`deserializeCrawlPages`).
- `src/w2m/launcher.js` — inbox routing + bookmarklet/share links (`encodeLaunch`, `decodeLaunch`, `parseLaunchHash`, `detectInput`, `launchUrl`, `bookmarkletCode`, `bookmarkletForGenerator`, `payloadForInput`).
- `src/w2m/tests.js` — `runTests()` validation suite (189 tests, pure + DOM + mocked fetch + fake kv folder).
- `src/w2m/app.js` — UI wiring; exposes `window.w2m` (`fetchDocument`, `extractContent`, `convertHtmlToMarkdown`, `extractMetadata`, `formatFrontmatter`, `buildDocument`, `markdownStats`, `createDocRecord`, `docFilename`, `matchDoc`, `loadDocs`, `renderDocLibrary`, `runTests`, `capturePage`, `applyOptions`, `downloadCurrent`, `copyCurrent`, `saveToLibrary`, `docs()`, `runSelfTests`, `last()`, `buildExportFiles`, `removeBatchItem`, `removeCrawlPage`, plus batch helpers `parseUrlList`, `runBatch`, `combineDocuments`, `startBatch`, `batchSaveAllFiles`, `batchCopyCombined`, `batchSaveAll`; crawl helpers `crawlSite`, `crawlTree`, `crawlFilePaths`, `crawlManifest`, `crawlFilePath`, `createZip`, `normalizeCrawlUrl`, `startCrawl`, `stopCrawl`, `crawlDocs`, `crawlDownloadZip`, `crawlSaveAllFiles`, `crawlSaveAll`, `crawlCopyIndex`, `crawlTreeRender`; extras `opTables`, `opInventory`, `libraryBundle`, `libraryEpub`, `askLibrary`, `stopAsk`, `tablesFromHtml`, `inventoryFromHtml`, `buildContextBundle`, `buildEpub`, `diffLines`; watch helpers `addWatchCurrent`, `addWatchUrl`, `checkWatch`, `checkAllWatches`, `removeWatch`, `viewWatchDiff`, `loadWatch`, `watches()`; job/launch helpers `resumeJob`, `showResumeBar`, `saveBatchJob`, `saveCrawlJob`, `inboxGo`, `routeInput`, `showBookmarklet`, `handleLaunchHash`; and `setMode`, `renderResult`, `currentOptions`, `batch()`, `crawl()`, `clean()`, `ask()`) for console/testing.
- `main.pjs` — `$meta` + plugin imports (`ai-text-plugin`, `text-to-image-plugin`, `kv-plugin`, `super-fetch-plugin`).

## Notes / gotchas

- Generators that don't exist or aren't public return "Couldn't find a generator".
- `getGeneratorHtml` fails for generators that aren't public/editable; when it does, the card is still captured from main.pjs alone (fonts/CSS sections will be sparse).
- The theme prompt slices main.pjs and HTML to 5000 chars each and escapes `${` so it can't be evaluated as a JS template literal.
- AI + image generation each take up to a minute; the progress bar shows the current step.
- The `Mood image` buttons and capture checkbox both call `makeMoodImage()` (no throttle — quota/queueing is handled by the plugin).
- Web-to-Markdown modules are ES modules under `src/`; previewing unsaved `src/` files needs the service worker (in-app browsers without one must save first).
- `index.html` includes `[hidden]{display:none !important}` so the `hidden` attribute wins over the flex/display rules used by panels.
- The extractor is deliberately heuristic; messy pages (JS-heavy SPAs, homepages with many teaser links) may need the Phase 6 AI cleanup pass.
- **Gotcha:** Perchance evaluates `[...]` inside HTML attributes — a textarea placeholder containing a Markdown link like `[Go](url)` breaks pjs parsing. Never put square brackets in HTML attributes in `index.html`.
