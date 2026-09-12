import { normalizeUrl, isHtmlContentType, describeMime, sniffHtml, looksBinary, mimeOf } from "./urls.js";
import { W2MError, describeError } from "./errors.js";
import { fetchDocument, detectBarrier, formatBytes } from "./fetcher.js";
import { extractContent, parseHtml, pruneBoilerplate, findContentRoot } from "./extract.js";
import { convertHtmlToMarkdown } from "./convert.js";
import { extractMetadata, formatFrontmatter } from "./metadata.js";
import { buildDocument } from "./document.js";
import { markdownStats } from "./stats.js";
import { createDocStore, createDocRecord, docFilename, uniqueFilename, matchDoc, normalizeTag, slugifyTitle } from "./library.js";
import { LIMIT_PRESETS, DEFAULT_LIMIT, resolveLimits, limitsFor, truncateText, truncateHtml, truncateMarkdown, truncationSummary } from "./truncate.js";
import { parseUrlList, runBatch, combineDocuments, stripFrontmatter } from "./batch.js";
import { sameSite, normalizeCrawlUrl, crawlKey, extractLinks, linksFromHtml, crawlTree, slugSegment, crawlFilePath, uniqueZipName, crawlFilePaths, crawlSite, crawlManifest, crc32, createZip } from "./crawl.js";
import { buildExportFiles, exportRecord } from "./exports.js";
import { analyzeQuality, qualityLevel, qualitySummary, qualityDelta, MESSY_THRESHOLD } from "./quality.js";
import { CLEANUP_PRESETS, cleanupPresets, presetByKey, buildCleanupPrompt, normalizeCleanupOutput, fitToBudget, runCleanup, applyBody } from "./cleanup.js";
import { docsToJson, docsFromJson, docsToMarkdown, docsFromMarkdown, docFromMarkdown, parseDocsMarkdown, parseFrontmatter, makeImportedRecord, hasDocMarkers, DOC_FORMAT } from "./docexport.js";
import { normalizeColor, colorsFromText, cardColors, designTokens, tokensToJson, tokensToCssVars, tokensToScss, tokensToTailwind, resolveVars } from "../theme/tokens.js";
import { starterScaffold, scaffoldZipName } from "../theme/scaffold.js";
import { themeFields, tokenize, themeSimilarity, findSimilar, compareCards, compareToText } from "../theme/compare.js";
import { parsePjsTree, generatorImports, generatorMeta, generatorOverview, treeToText, extractGeneratorName, generatorApiUrl, generatorPageUrl, listNames, functionNames } from "../theme/inspector.js";
import { tablesFromHtml, tableToCsv, tablesToJson, tableFiles, tablesSummary, buildSchemaPrompt, parseSchemaOutput, defaultSchema } from "./structured.js";
import { inventoryFromHtml, inventoryToJson, inventoryToCsv, inventorySummary, inventoryFiles } from "./inventory.js";
import { contentHash, diffLines, changeSummary, diffToMarkdown, diffStats, createWatchRecord, createWatchStore, watchSummary } from "./watch.js";
import { buildContextBundle, buildAskPrompt, parseAskAnswer, bundleFileName } from "./llmcontext.js";
import { markdownToXhtml, buildEpub, epubFileName, escapeXml } from "./epub.js";
import { createJob, createJobStore, isResumable, jobProgress, jobSummary, serializeBatchResults, deserializeBatchResults, serializeCrawlPages, deserializeCrawlPages } from "./jobs.js";
import { encodeLaunch, decodeLaunch, parseLaunchHash, detectInput, launchUrl, bookmarkletCode, payloadForInput } from "./launcher.js";

function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
}
function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message ? message + " — " : "") + `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function includes(haystack, needle, message) {
  if (String(haystack).indexOf(needle) === -1) {
    throw new Error((message ? message + " — " : "") + `expected to include ${JSON.stringify(needle)}`);
  }
}
function excludes(haystack, needle, message) {
  if (String(haystack).indexOf(needle) !== -1) {
    throw new Error((message ? message + " — " : "") + `expected NOT to include ${JSON.stringify(needle)}`);
  }
}

async function expectReject(fn, code, label) {
  try {
    await fn();
  } catch (err) {
    if (code && err.code !== code) {
      throw new Error(`${label || "expected rejection"}: expected code ${code}, got ${err.code || err.name} (${err.message})`);
    }
    return err;
  }
  throw new Error((label || "expected rejection") + `: nothing was thrown (wanted ${code})`);
}

function mockResponse(body, opts = {}) {
  const { status = 200, contentType = "text/html; charset=utf-8", url = "" } = opts;
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  const res = new Response(body, { status, headers });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

function fakeFolder() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, value); return value; },
    async delete(key) { map.delete(key); },
    async update(key, fn) { const next = fn(map.has(key) ? map.get(key) : undefined); map.set(key, next); return next; }
  };
}

const ARTICLE_HTML = `<!DOCTYPE html>
<html><head>
  <title>Markdown</title>
  <meta property="og:title" content="Markdown — the language">
  <style>body{color:red}</style>
  <script>window.x=1;</script>
</head>
<body>
  <header role="banner"><nav class="site-nav"><a href="/">Home</a> <a href="/about">About</a></nav></header>
  <main>
    <article class="post-content">
      <h1>Markdown</h1>
      <p>Markdown is a lightweight markup language for creating formatted text using a plain-text editor.</p>
      <p>It was created by John Gruber in 2004, and is now widely used across the web.</p>
      <h2>History</h2>
      <p>Markdown was inspired by existing conventions for marking up plain text in email.</p>
    </article>
    <aside class="sidebar"><h3>Related</h3><ul><li><a href="/a">Alpha</a></li><li><a href="/b">Beta</a></li></ul></aside>
  </main>
  <div class="advertisement">Buy stuff now</div>
  <footer class="site-footer"><p>Copyright 2024 Example Inc</p></footer>
</body></html>`;

export async function runTests() {
  const results = [];
  const test = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (err) {
      results.push({ name, pass: false, error: (err && err.message) || String(err) });
    }
  };

  await test("normalizeUrl: bare domain gains https", () => {
    const r = normalizeUrl("example.com/path?q=1");
    eq(r.ok, true);
    eq(r.url, "https://example.com/path?q=1");
    eq(r.host, "example.com");
  });

  await test("normalizeUrl: strips wrapping brackets and whitespace", () => {
    const r = normalizeUrl('  <https://Example.COM/A>  ');
    eq(r.ok, true);
    eq(r.url, "https://example.com/A");
  });

  await test("normalizeUrl: rejects empty input", () => {
    eq(normalizeUrl("   ").error, "empty");
  });

  await test("normalizeUrl: rejects unsupported schemes", () => {
    eq(normalizeUrl("mailto:a@b.com").error, "unsupported_scheme");
    eq(normalizeUrl("ftp://files.example.com").error, "unsupported_scheme");
    eq(normalizeUrl("javascript:alert(1)").error, "unsupported_scheme");
  });

  await test("normalizeUrl: rejects host without a dot", () => {
    eq(normalizeUrl("just-a-word").error, "invalid_host");
  });

  await test("normalizeUrl: allows localhost with port", () => {
    const r = normalizeUrl("localhost:3000/app");
    eq(r.ok, true);
    eq(r.host, "localhost");
  });

  await test("normalizeUrl: a malformed scheme falls back to a domain check", () => {
    eq(normalizeUrl("htp:/bad").error, "invalid_host");
  });

  await test("isHtmlContentType", () => {
    eq(isHtmlContentType("text/html; charset=utf-8"), true);
    eq(isHtmlContentType("application/xhtml+xml"), true);
    eq(isHtmlContentType("application/pdf"), false);
    eq(isHtmlContentType("image/png"), false);
    eq(isHtmlContentType("text/plain"), null);
    eq(isHtmlContentType(""), null);
  });

  await test("describeMime produces friendly labels", () => {
    eq(describeMime("application/pdf"), "a PDF document");
    includes(describeMime("image/webp"), "image");
    eq(mimeOf("text/HTML; charset=UTF-8"), "text/html");
  });

  await test("sniffHtml recognises documents and rejects data", () => {
    eq(sniffHtml("<!DOCTYPE html><html><body>hi</body></html>"), true);
    eq(sniffHtml("<div class=x>hello</div>"), true);
    eq(sniffHtml('{"a":1,"b":2}'), false);
  });

  await test("looksBinary detects NUL bytes", () => {
    eq(looksBinary("hello\u0000world"), true);
    eq(looksBinary("plain text"), false);
  });

  await test("W2MError carries title and hint", () => {
    const err = new W2MError("non_html", "a PDF document");
    eq(err.code, "non_html");
    eq(err.title, "Not a web page");
    includes(err.hint, "a PDF document");
    const info = describeError(err);
    eq(info.code, "non_html");
  });

  await test("detectBarrier: 403 is blocked, 402 is paywall", () => {
    eq(detectBarrier("", 403), "blocked");
    eq(detectBarrier("", 402), "paywall");
    eq(detectBarrier("<html><body><p>ok</p></body></html>", 200), null);
  });

  await test("detectBarrier: challenge page is flagged", () => {
    eq(detectBarrier("<html><head><title>Just a moment...</title></head><body></body></html>", 200), "blocked");
  });

  await test("detectBarrier: paywall copy is flagged", () => {
    const page = "<html><body><h1>Story</h1><p>Please subscribe to continue reading this article.</p></body></html>";
    eq(detectBarrier(page, 200), "paywall");
  });

  await test("detectBarrier: a real article is not flagged", () => {
    const paras = Array.from({ length: 20 }, (_, i) => `<p>Paragraph ${i} with real article content.</p>`).join("");
    eq(detectBarrier("<html><body>" + paras + "</body></html>", 200), null);
  });

  await test("formatBytes", () => {
    eq(formatBytes(512), "512 B");
    eq(formatBytes(2048), "2.0 KB");
    eq(formatBytes(3 * 1024 * 1024), "3.0 MB");
  });

  await test("fetchDocument: happy path", async () => {
    const impl = async (url) => mockResponse(ARTICLE_HTML, { url });
    const r = await fetchDocument("https://example.com/a", { fetchImpl: impl });
    eq(r.status, 200);
    includes(r.html, "lightweight markup language");
    assert(r.bytes > 100, "byte count");
    eq(r.host, "example.com");
  });

  await test("fetchDocument: rejects non-HTML content type", async () => {
    const impl = async () => mockResponse("%PDF-1.4", { contentType: "application/pdf" });
    await expectReject(() => fetchDocument("https://example.com/file.pdf", { fetchImpl: impl }), "non_html");
  });

  await test("fetchDocument: hides the proxy URL from finalUrl", async () => {
    const impl = async () => mockResponse(ARTICLE_HTML, { url: "https://fetch-plugin.perchance.org/proxy1/https%3A%2F%2Fexample.com%2Fa?origin=x" });
    const r = await fetchDocument("https://example.com/a", { fetchImpl: impl });
    eq(r.finalUrl, "https://example.com/a");
  });

  await test("fetchDocument: rejects unreachable host", async () => {
    const impl = async () => { throw new Error("Failed to fetch"); };
    await expectReject(() => fetchDocument("https://nope.example", { fetchImpl: impl }), "unreachable");
  });

  await test("fetchDocument: rejects HTTP 403 as blocked", async () => {
    const impl = async () => mockResponse("<html></html>", { status: 403 });
    await expectReject(() => fetchDocument("https://example.com/x", { fetchImpl: impl }), "blocked");
  });

  await test("fetchDocument: rejects HTTP 500 as http_error", async () => {
    const impl = async () => mockResponse("<html></html>", { status: 500 });
    await expectReject(() => fetchDocument("https://example.com/x", { fetchImpl: impl }), "http_error");
  });

  await test("fetchDocument: times out slow requests", async () => {
    const impl = (url, opts) => new Promise((resolve, reject) => {
      const signal = opts && opts.signal;
      if (signal) signal.addEventListener("abort", () => {
        const e = new Error("Aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
    await expectReject(() => fetchDocument("https://slow.example", { fetchImpl: impl, timeoutMs: 40 }), "timeout");
  });

  await test("fetchDocument: enforces the size cap from content-length", async () => {
    const impl = async () => {
      const res = mockResponse("<html><body><p>hi</p></body></html>");
      res.headers.set("content-length", String(50 * 1024 * 1024));
      return res;
    };
    await expectReject(() => fetchDocument("https://big.example", { fetchImpl: impl }), "too_large");
  });

  await test("fetchDocument: streams and caps an oversized body", async () => {
    const big = "<html><body><p>" + "x".repeat(600000) + "</p></body></html>";
    const impl = async () => mockResponse(big, { contentType: "text/html" });
    await expectReject(() => fetchDocument("https://big.example", { fetchImpl: impl, maxBytes: 100000 }), "too_large");
  });

  await test("fetchDocument: rejects binary payloads", async () => {
    const impl = async () => mockResponse("\u0000\u0001\u0002binary", { contentType: "text/html" });
    await expectReject(() => fetchDocument("https://example.com/blob", { fetchImpl: impl }), "binary");
  });

  await test("fetchDocument: rejects empty bodies", async () => {
    const impl = async () => mockResponse("   ", { contentType: "text/html" });
    await expectReject(() => fetchDocument("https://example.com/empty", { fetchImpl: impl }), "empty_content");
  });

  await test("fetchDocument: rejects invalid URLs before fetching", async () => {
    let called = false;
    const impl = async () => { called = true; return mockResponse("x"); };
    await expectReject(() => fetchDocument("", { fetchImpl: impl }), "empty");
    assert(!called, "fetch should not run for invalid input");
  });

  await test("parseHtml + pruneBoilerplate remove chrome", () => {
    const doc = parseHtml(ARTICLE_HTML);
    const removal = pruneBoilerplate(doc);
    assert(removal.removedTotal > 0, "should remove nodes");
    eq(doc.querySelectorAll("script").length, 0);
    eq(doc.querySelectorAll("nav").length, 0);
    eq(doc.querySelectorAll("footer").length, 0);
    eq(doc.querySelectorAll("aside").length, 0);
    eq(doc.querySelectorAll("article").length, 1);
  });

  await test("findContentRoot prefers the article", () => {
    const doc = parseHtml(ARTICLE_HTML);
    pruneBoilerplate(doc);
    const root = findContentRoot(doc);
    assert(!!root, "root found");
    eq(root.tagName.toLowerCase() === "article" || root.tagName.toLowerCase() === "main", true);
  });

  await test("extractContent isolates the article and its title", () => {
    const result = extractContent(ARTICLE_HTML);
    eq(result.title, "Markdown — the language");
    includes(result.contentHtml, "lightweight markup language");
    includes(result.contentHtml, "John Gruber");
    includes(result.contentHtml, "History");
    excludes(result.contentHtml, "Copyright");
    excludes(result.contentHtml, "Buy stuff");
    excludes(result.contentHtml, "window.x");
    excludes(result.contentHtml, "color:red");
    excludes(result.contentHtml, "Home");
    assert(result.stats.removedNodes > 0, "removed nodes counted");
    assert(result.stats.contentChars > 100, "content chars");
  });

  await test("extractContent finds a #content container", () => {
    const html = `<html><head><title>Blog</title></head><body>
      <nav><a href="/">Home</a></nav>
      <div id="content"><h1>Post</h1><p>Hello world, this is the post body text that should be captured.</p></div>
      <footer>footer junk</footer></body></html>`;
    const result = extractContent(html);
    eq(result.title, "Blog");
    includes(result.contentHtml, "post body text");
    excludes(result.contentHtml, "footer junk");
  });

  await test("extractContent falls back to body content", () => {
    const html = `<html><head><title>Plain</title></head><body>
      <h1>Hi there</h1><p>Some paragraph text here so that extraction can succeed cleanly.</p></body></html>`;
    const result = extractContent(html);
    eq(result.title, "Plain");
    includes(result.contentHtml, "Some paragraph text here");
    includes(result.contentHtml, "Hi there");
  });

  await test("extractContent rejects empty pages", () => {
    const html = `<html><head><title>Nothing</title></head><body><script>x</script></body></html>`;
    let threw = false;
    try { extractContent(html); } catch (err) { threw = true; eq(err.code, "empty_content"); }
    assert(threw, "should throw empty_content");
  });

  const CONVERT_HTML = `<html><head><title>T</title></head><body><article>
    <h1>Title &amp; Heading</h1>
    <script>window.bad = 1;</script>
    <style>.x{color:red}</style>
    <p>Hello <strong>bold</strong> and <em>italic</em> and <code>a*b</code>.</p>
    <p>Literal *stars* and [brackets] and under_score.</p>
    <p># not a heading</p>
    <p>A <a href="/rel/path?q=1" title="T">relative link</a> and an <a href="https://ext.example/x">absolute one</a>.</p>
    <p><img src="/img/pic.png" alt="A [pic]" title="Cap"></p>
    <h2>Lists</h2>
    <ul><li>First</li><li>Second<ul><li>Nested</li></ul></li><li>Third</li></ul>
    <ol><li>One</li><li>Two</li></ol>
    <blockquote><p>Quoted line</p><p>Second para</p></blockquote>
    <pre><code class="language-js">const x = 1;
  const y = 2;</code></pre>
    <p>Inline <code>with \`tick\`</code> code.</p>
    <hr>
    <table>
      <thead><tr><th>Name</th><th align="right">Qty</th></tr></thead>
      <tbody><tr><td>Apple</td><td>3</td></tr><tr><td>Pear</td><td>5</td></tr></tbody>
    </table>
    <p>Line one<br>Line two</p>
  </article></body></html>`;

  const conv = (html, opts) => convertHtmlToMarkdown(parseHtml(html), opts);

  await test("convert: headings and paragraphs", () => {
    const md = conv(CONVERT_HTML);
    includes(md, "# Title & Heading");
    includes(md, "## Lists");
    includes(md, "Hello **bold** and *italic* and `a*b`.");
  });

  await test("convert: escapes markdown significant characters", () => {
    const md = conv(CONVERT_HTML);
    includes(md, "Literal \\*stars\\* and \\[brackets\\] and under_score.");
    includes(md, "\\# not a heading");
  });

  await test("convert: links resolve to absolute URLs", () => {
    const md = conv(CONVERT_HTML, { baseUrl: "https://example.com/post" });
    includes(md, '[relative link](https://example.com/rel/path?q=1 "T")');
    includes(md, "[absolute one](https://ext.example/x)");
  });

  await test("convert: relative link mode keeps hrefs untouched", () => {
    const md = conv(CONVERT_HTML, { baseUrl: "https://example.com/post", linkMode: "relative" });
    includes(md, '[relative link](/rel/path?q=1 "T")');
  });

  await test("convert: footnote link mode moves URLs into definitions", () => {
    const html = `<html><body><article><p>See <a href="/a" title="Doc A">Alpha</a> and <a href="https://b.example/b">Beta</a>.</p></article></body></html>`;
    const md = conv(html, { baseUrl: "https://example.com/post", linkMode: "footnote" });
    includes(md, "See Alpha[^1] and Beta[^2].");
    includes(md, '[^1]: https://example.com/a "Doc A"');
    includes(md, "[^2]: https://b.example/b");
  });

  await test("convert: footnote mode reuses a marker for the same link", () => {
    const html = `<html><body><article><p><a href="https://x.example/p">one</a> and <a href="https://x.example/p">two</a>.</p></article></body></html>`;
    const md = conv(html, { linkMode: "footnote" });
    includes(md, "one[^1] and two[^1].");
    eq((md.match(/\[\^1\]:/g) || []).length, 1);
    eq((md.match(/\[\^/g) || []).length, 3);
  });

  await test("convert: footnote mode keeps internal anchors inline", () => {
    const html = `<html><body><article><p>Jump to <a href="#sec">Section</a>.</p></article></body></html>`;
    const md = conv(html, { baseUrl: "https://example.com/post", linkMode: "footnote" });
    includes(md, "[Section](#sec)");
    excludes(md, "[^1]");
  });

  await test("convert: images with alt and title", () => {
    const md = conv(CONVERT_HTML, { baseUrl: "https://example.com/post" });
    includes(md, '![A \\[pic\\]](https://example.com/img/pic.png "Cap")');
  });

  await test("convert: images can be excluded", () => {
    const md = conv(CONVERT_HTML, { baseUrl: "https://example.com/post", includeImages: false });
    excludes(md, "![");
  });

  await test("convert: unordered, nested and ordered lists", () => {
    const md = conv(CONVERT_HTML);
    includes(md, "- First\n- Second\n  - Nested\n- Third");
    includes(md, "1. One\n2. Two");
  });

  await test("convert: blockquotes", () => {
    const md = conv(CONVERT_HTML);
    includes(md, "> Quoted line\n>\n> Second para");
  });

  await test("convert: fenced code block keeps language and whitespace", () => {
    const md = conv(CONVERT_HTML);
    includes(md, "```js\nconst x = 1;\n  const y = 2;\n```");
  });

  await test("convert: inline code with backticks", () => {
    const md = conv(CONVERT_HTML);
    includes(md, "`` with `tick` ``");
  });

  await test("convert: horizontal rule", () => {
    includes(conv(CONVERT_HTML), "\n---\n");
  });

  await test("convert: GFM table with alignment", () => {
    const md = conv(CONVERT_HTML);
    includes(md, "| Name | Qty |");
    includes(md, "| --- | ---: |");
    includes(md, "| Apple | 3 |");
    includes(md, "| Pear | 5 |");
  });

  await test("convert: br becomes a hard line break", () => {
    includes(conv(CONVERT_HTML), "Line one  \nLine two");
  });

  await test("convert: scripts and styles are dropped", () => {
    const md = conv(CONVERT_HTML);
    excludes(md, "window.bad");
    excludes(md, "color:red");
  });

  await test("convert: empty container yields empty string", () => {
    eq(conv("<html><body><div><span></span></div></body></html>").trim(), "");
  });

  await test("convert: leading list lookalikes use a valid escape", () => {
    const md = conv(`<html><body><article><h2>3. Intro</h2><p>3. Not a list item.</p></article></body></html>`);
    includes(md, "## 3\\. Intro");
    includes(md, "3\\. Not a list item.");
    excludes(md, "\\3");
  });

  await test("convert: drops permalink glyph anchors", () => {
    const html = `<html><body><article>
      <h2>Using Python<a class="headerlink" href="#using-python" title="Permalink to this heading">\u00b6</a></h2>
      <p>See <a href="#using-python">\u00b6</a> and a real <a href="/docs">link</a> here.</p>
    </article></body></html>`;
    const md = conv(html, { baseUrl: "https://docs.example.com/guide" });
    includes(md, "## Using Python");
    excludes(md, "\u00b6");
    includes(md, "[link](https://docs.example.com/docs)");
  });

  await test("convert: keeps links whose text merely contains a glyph", () => {
    const html = `<html><body><article><p>Read <a href="/s">Section \u00b6 one</a> now.</p></article></body></html>`;
    const md = conv(html, { baseUrl: "https://example.com/x" });
    includes(md, "[Section \u00b6 one](https://example.com/s)");
  });

  const META_HTML = `<html lang="en"><head>
    <title>Fallback Title</title>
    <meta property="og:title" content="OG &quot;Title&quot;">
    <meta name="author" content="Ada Lovelace">
    <meta property="article:published_time" content="2024-03-05T10:00:00Z">
    <meta property="og:site_name" content="Example Site">
    <meta name="description" content="A description &amp; more">
    <link rel="canonical" href="/canonical/page">
  </head><body><article><h1>Heading</h1>
    <p>Body text long enough to be extracted as the main content of this page.</p>
  </article></body></html>`;

  await test("metadata: extracts title, author, date, site, canonical, description, lang", () => {
    const doc = parseHtml(META_HTML);
    const meta = extractMetadata(doc, { url: "https://example.com/post" });
    eq(meta.title, 'OG "Title"');
    eq(meta.author, "Ada Lovelace");
    eq(meta.site, "Example Site");
    eq(meta.description, "A description & more");
    eq(meta.lang, "en");
    eq(meta.canonical, "https://example.com/canonical/page");
    eq(meta.source, "https://example.com/post");
  });

  await test("metadata: is captured before boilerplate pruning", () => {
    const result = extractContent(META_HTML, { url: "https://example.com/post" });
    eq(result.metadata.canonical, "https://example.com/canonical/page");
    eq(result.metadata.author, "Ada Lovelace");
    eq(result.title, 'OG "Title"');
  });

  await test("metadata: site falls back to the host", () => {
    const html = `<html><head><title>X</title></head><body><p>Some content that is long enough to extract here.</p></body></html>`;
    const meta = extractMetadata(parseHtml(html), { url: "https://www.example.org/a/b" });
    eq(meta.site, "example.org");
  });

  await test("metadata: head link rel=author href is not used as an author name", () => {
    const html = `<html><head><title>Post</title>
      <link rel="author" href="/about.html">
    </head><body><article><p>Content long enough to extract here for the test.</p></article></body></html>`;
    const meta = extractMetadata(parseHtml(html), { url: "https://example.com/post" });
    eq(meta.author, "");
    excludes(meta.author, "about.html");
  });

  await test("metadata: a[rel=author] with visible text is used", () => {
    const html = `<html><head><title>Post</title></head><body><article>
      <p>By <a rel="author" href="/about">Jane Doe</a></p>
      <p>Content long enough to extract here for the test.</p>
    </article></body></html>`;
    const meta = extractMetadata(parseHtml(html), { url: "https://example.com/post" });
    eq(meta.author, "Jane Doe");
  });

  await test("metadata: canonical ignores an author link in head", () => {
    const html = `<html><head><title>Post</title>
      <link rel="author" href="/about.html">
      <link rel="canonical" href="/real/page">
    </head><body><article><p>Content long enough to extract here for the test.</p></article></body></html>`;
    const meta = extractMetadata(parseHtml(html), { url: "https://example.com/post" });
    eq(meta.canonical, "https://example.com/real/page");
  });

  await test("frontmatter: formats fields as YAML", () => {
    const meta = extractMetadata(parseHtml(META_HTML), { url: "https://example.com/post" });
    const yaml = formatFrontmatter(meta);
    assert(yaml.startsWith("---\n"), "starts with fence");
    assert(yaml.endsWith("\n---"), "ends with fence");
    includes(yaml, 'title: "OG \\"Title\\""');
    includes(yaml, 'author: "Ada Lovelace"');
    includes(yaml, 'published: "2024-03-05"');
    includes(yaml, 'site: "Example Site"');
    includes(yaml, 'source: "https://example.com/post"');
    includes(yaml, 'canonical: "https://example.com/canonical/page"');
  });

  await test("frontmatter: omits empty fields and can be disabled", () => {
    const sparse = extractMetadata(parseHtml("<html><head><title>Only title</title></head><body><p>x</p></body></html>"), { url: "https://a.example/x" });
    const yaml = formatFrontmatter(sparse);
    includes(yaml, 'title: "Only title"');
    excludes(yaml, "author:");
    eq(formatFrontmatter(sparse, { includeFrontmatter: false }), "");
  });

  await test("document: builds frontmatter + converted body", () => {
    const doc = buildDocument(META_HTML, { url: "https://example.com/post" });
    assert(doc.markdown.startsWith("---\n"), "frontmatter first");
    includes(doc.markdown, "\n---\n\n# Heading");
    includes(doc.markdown, "Body text long enough");
    eq(doc.metadata.author, "Ada Lovelace");
  });

  await test("document: frontmatter can be omitted", () => {
    const doc = buildDocument(META_HTML, { url: "https://example.com/post", includeFrontmatter: false });
    excludes(doc.markdown, "---");
    includes(doc.markdown, "# Heading");
  });

  await test("document: relative link mode flows through", () => {
    const doc = buildDocument(CONVERT_HTML, { url: "https://example.com/post", linkMode: "relative" });
    includes(doc.markdown, "[relative link](/rel/path?q=1");
  });

  await test("document: footnote link mode flows through", () => {
    const doc = buildDocument(`<html><body><article><h1>T</h1><p>This paragraph is long enough to survive extraction, and it shows that See <a href="https://x.example/a">A</a> works.</p></article></body></html>`, {
      url: "https://example.com/p", linkMode: "footnote", includeFrontmatter: false
    });
    includes(doc.markdown, "See A[^1] works");
    includes(doc.markdown, "[^1]: https://x.example/a");
  });

  await test("document: image toggle flows through", () => {
    const html = `<html><body><article><p>This paragraph is deliberately long enough to be extracted as readable content, with an image <img src="/i.png" alt="pic"> embedded in it for the test.</p></article></body></html>`;
    const withImg = buildDocument(html, { url: "https://example.com/p", includeFrontmatter: false });
    includes(withImg.markdown, "![pic](https://example.com/i.png)");
    const noImg = buildDocument(html, { url: "https://example.com/p", includeFrontmatter: false, includeImages: false });
    excludes(noImg.markdown, "![");
  });

  await test("markdownStats counts words, characters and lines", () => {
    const text = "# Title\n\nHello world, this is a test.\n";
    const s = markdownStats(text);
    eq(s.words, 8);
    eq(s.lines, 4);
    eq(s.characters, text.length);
    assert(s.readingMinutes >= 1, "reading time");
  });

  await test("markdownStats handles empty input", () => {
    const s = markdownStats("");
    eq(s.words, 0);
    eq(s.characters, 0);
    eq(s.lines, 0);
    eq(s.readingMinutes, 0);
  });

  await test("library: createDocRecord fills defaults", () => {
    const rec = createDocRecord({ title: "Hello World!", url: "https://x.example/a", markdown: "# Hi", stats: { words: 2 } });
    assert(rec.id, "id assigned");
    eq(rec.title, "Hello World!");
    eq(rec.url, "https://x.example/a");
    assert(Array.isArray(rec.tags) && rec.tags.length === 0, "tags default to []");
    eq(rec.notes, "");
    eq(rec.stats.words, 2);
    assert(typeof rec.createdAt === "number", "createdAt set");
  });

  await test("library: slugifyTitle and docFilename", () => {
    eq(slugifyTitle("Hello, World! — A Test"), "hello-world-a-test");
    eq(slugifyTitle(""), "document");
    eq(slugifyTitle("!!!"), "document");
    eq(docFilename({ title: "My Doc", createdAt: Date.UTC(2024, 0, 5) }), "my-doc-2024-01-05.md");
  });

  await test("library: uniqueFilename avoids collisions", () => {
    const used = new Set(["page-2024-01-05.md"]);
    eq(uniqueFilename("other-2024-01-05.md", used), "other-2024-01-05.md");
    eq(uniqueFilename("page-2024-01-05.md", used), "page-2024-01-05-2.md");
    used.add("page-2024-01-05-2.md");
    eq(uniqueFilename("page-2024-01-05.md", used), "page-2024-01-05-3.md");
    eq(uniqueFilename("no-extension", new Set(["no-extension"])), "no-extension-2");
    eq(uniqueFilename("", new Set()), "document.md");
  });

  await test("library: store saves, lists and removes", async () => {
    const store = createDocStore(fakeFolder());
    const a = createDocRecord({ title: "A" });
    const b = createDocRecord({ title: "B" });
    await store.save(a);
    await store.save(b);
    const docs = await store.list();
    eq(docs.length, 2);
    eq(docs[0].title, "B");
    await store.remove(a.id);
    const after = await store.list();
    eq(after.length, 1);
    eq(after[0].title, "B");
  });

  await test("library: patch updates tags and notes", async () => {
    const store = createDocStore(fakeFolder());
    const a = createDocRecord({ title: "A" });
    await store.save(a);
    await store.patch(a.id, { tags: ["web", "ref"], notes: "hello" });
    const docs = await store.list();
    eq(docs[0].tags.length, 2);
    eq(docs[0].tags[1], "ref");
    eq(docs[0].notes, "hello");
    eq(await store.patch("missing-id", { notes: "x" }), null);
  });

  await test("library: matchDoc searches every field", () => {
    const d = createDocRecord({ title: "Markdown Guide", url: "https://wiki.example/Markdown", markdown: "body about syntax basics" });
    d.tags = ["reference"];
    d.notes = "read later";
    eq(matchDoc(d, ""), true);
    eq(matchDoc(d, "markdown"), true);
    eq(matchDoc(d, "wiki.example"), true);
    eq(matchDoc(d, "reference"), true);
    eq(matchDoc(d, "syntax"), true);
    eq(matchDoc(d, "read later"), true);
    eq(matchDoc(d, "zzz-nope"), false);
  });

  await test("library: normalizeTag trims, lowercases and caps length", () => {
    eq(normalizeTag("  Web   Dev "), "web dev");
    eq(normalizeTag(""), "");
    eq(normalizeTag("x".repeat(50)).length, 32);
  });

  /* ---- Phase 5: batch processing, scaling & large-page handling ---- */

  await test("limits: presets resolve with a balanced default", () => {
    eq(DEFAULT_LIMIT, "balanced");
    eq(resolveLimits("small").key, "small");
    eq(resolveLimits("nonsense").key, "balanced");
    eq(limitsFor({}).preset.key, "balanced");
    eq(limitsFor({ limitPreset: "small" }).maxBytes, LIMIT_PRESETS.small.maxBytes);
    eq(limitsFor({ limitPreset: "small" }).maxMarkdownChars, LIMIT_PRESETS.small.maxMarkdownChars);
    eq(limitsFor({ limitPreset: "unlimited" }).maxHtmlChars, 0);
  });

  await test("limits: per-call overrides beat the preset", () => {
    const l = limitsFor({ limitPreset: "unlimited", maxBytes: 1234, maxHtmlChars: 99 });
    eq(l.maxBytes, 1234);
    eq(l.maxHtmlChars, 99);
    eq(l.maxMarkdownChars, 0);
  });

  await test("truncateText: leaves short text untouched", () => {
    const r = truncateText("hello", 10);
    eq(r.truncated, false);
    eq(r.text, "hello");
    eq(r.keptChars, 5);
    eq(truncateText("hello world", 0).truncated, false);
  });

  await test("truncateText: caps long text at a line boundary", () => {
    const r = truncateText("a\nb\nc\nd\ne", 5);
    eq(r.truncated, true);
    eq(r.fullChars, 9);
    assert(r.keptChars <= 5, "kept within cap");
    eq(r.text, "a\nb…");
  });

  await test("truncateHtml: cuts back to a tag boundary", () => {
    const html = "<div><p>one</p><p>two</p></div>";
    eq(truncateHtml(html, 1000).truncated, false);
    const r = truncateHtml(html, 12);
    eq(r.truncated, true);
    assert(r.text.endsWith(">"), "ends on a tag boundary");
    assert(r.text.length <= 12, "within cap");
  });

  await test("truncateMarkdown: appends an explanatory note", () => {
    const r = truncateMarkdown("x".repeat(100), 10);
    eq(r.truncated, true);
    includes(r.text, "Truncated");
    includes(r.text, "100");
    const clean = truncateMarkdown("short", 10);
    eq(clean.truncated, false);
    excludes(clean.text, "Truncated");
  });

  await test("truncationSummary describes the cut", () => {
    eq(truncationSummary(null), "");
    eq(truncationSummary({ any: false }), "");
    includes(truncationSummary({ any: true, html: { truncated: true, keptChars: 10, fullChars: 20 }, markdown: { truncated: false } }), "10");
    includes(truncationSummary({ any: true, html: { truncated: false }, markdown: { truncated: true, keptChars: 5, fullChars: 50 } }), "5");
  });

  await test("buildDocument: honours a markdown size cap and flags truncation", () => {
    const paras = Array.from({ length: 60 }, (_, i) => `<p>Paragraph number ${i} with a reasonably long sentence so the markdown keeps growing.</p>`).join("");
    const html = `<html><head><title>Big</title></head><body><article><h1>Big</h1>${paras}</article></body></html>`;
    const doc = buildDocument(html, { url: "https://example.com/big", includeFrontmatter: false, maxMarkdownChars: 400 });
    eq(doc.truncation.markdown.truncated, true);
    eq(doc.truncation.any, true);
    includes(doc.markdown, "**Truncated.**");
    excludes(doc.markdown, "Paragraph number 59");
    assert(doc.markdown.length < 700, "kept near the cap");
  });

  await test("buildDocument: caps the HTML it parses", () => {
    const html = `<html><head><title>Big</title></head><body><article><h1>Big</h1>` +
      Array.from({ length: 200 }, (_, i) => `<p>Paragraph ${i} with enough text to make this document quite long indeed.</p>`).join("") +
      `</article></body></html>`;
    const doc = buildDocument(html, { url: "https://example.com/big", includeFrontmatter: false, maxHtmlChars: 800 });
    eq(doc.truncation.html.truncated, true);
    assert(doc.truncation.html.keptChars <= 800, "kept within the HTML cap");
    eq(doc.truncation.any, true);
    assert(doc.extracted.stats.contentChars > 20, "still extracted readable content");
  });

  await test("buildDocument: default limits leave normal pages alone", () => {
    const doc = buildDocument(ARTICLE_HTML, { url: "https://example.com/a" });
    eq(doc.truncation.any, false);
    includes(doc.markdown, "lightweight markup language");
  });

  await test("parseUrlList: splits lines and commas, dedupes duplicates", () => {
    const items = parseUrlList("https://a.example/x\nhttps://b.example/y, https://a.example/x\n\n  https://c.example/z  ");
    eq(items.length, 3);
    eq(items[0].url, "https://a.example/x");
    eq(items[1].url, "https://b.example/y");
    eq(items[2].url, "https://c.example/z");
    eq(items[0].host, "a.example");
    eq(items[0].valid, true);
  });

  await test("parseUrlList: handles bullets, markdown links, comments and junk", () => {
    const items = parseUrlList([
      "- https://a.example/1",
      "1. [Go](https://en.wikipedia.org/wiki/Go_(programming_language))",
      "# not a url",
      "// also not a url",
      "mailto:x@y.com",
      "just-a-word",
      "example.com"
    ].join("\n"));
    eq(items.length, 5);
    eq(items[0].url, "https://a.example/1");
    eq(items[1].url, "https://en.wikipedia.org/wiki/Go_(programming_language)");
    eq(items[1].label, "Go");
    eq(items[2].valid, false);
    eq(items[2].url, "mailto:x@y.com");
    eq(items[3].valid, false);
    eq(items[4].url, "https://example.com/");
    eq(items[4].valid, true);
  });

  await test("parseUrlList: empty input yields no items", () => {
    eq(parseUrlList("").length, 0);
    eq(parseUrlList("   \n\n  ").length, 0);
    eq(parseUrlList(null).length, 0);
  });

  const batchItem = (i, valid) => ({ url: "https://site" + i + ".example/x", host: "site" + i + ".example", raw: "https://site" + i + ".example/x", valid: valid !== false, error: valid === false ? "invalid_host" : "" });

  await test("runBatch: processes items one at a time, in order", async () => {
    const order = [];
    let active = 0;
    let peak = 0;
    const out = await runBatch([batchItem(1), batchItem(2), batchItem(3)], {
      process: async item => {
        active++;
        peak = Math.max(peak, active);
        order.push(item.url);
        await new Promise(r => setTimeout(r, 5));
        active--;
        return item.url;
      }
    });
    eq(peak, 1);
    eq(order.length, 3);
    eq(order[0], "https://site1.example/x");
    eq(out.total, 3);
    eq(out.ok, 3);
    eq(out.failed, 0);
    eq(out.skipped, 0);
    eq(out.results[1].index, 1);
    eq(out.results[1].value, "https://site2.example/x");
  });

  await test("runBatch: invalid entries are recorded without being fetched", async () => {
    const items = [batchItem(1), batchItem(2, false)];
    let calls = 0;
    const out = await runBatch(items, { process: async () => { calls++; return 1; } });
    eq(calls, 1);
    eq(out.results[0].status, "ok");
    eq(out.results[1].status, "error");
    eq(out.results[1].invalid, true);
    eq(out.results[1].error, "invalid_host");
    eq(out.failed, 1);
    eq(out.ok, 1);
  });

  await test("runBatch: captures thrown errors and keeps going", async () => {
    const seen = [];
    const out = await runBatch([batchItem(1), batchItem(2), batchItem(3)], {
      process: async item => {
        seen.push(item.url);
        if (item.url.includes("site2")) throw new Error("boom");
        return "done";
      }
    });
    eq(seen.length, 3);
    eq(out.results[1].status, "error");
    assert(!out.results[1].invalid, "a fetch failure is not an invalid URL");
    eq(out.results[1].error.message, "boom");
    eq(out.results[2].status, "ok");
    eq(out.failed, 1);
    eq(out.ok, 2);
  });

  await test("runBatch: stop request skips the remaining work", async () => {
    let n = 0;
    const out = await runBatch([batchItem(1), batchItem(2), batchItem(3)], {
      process: async () => { n++; return n; },
      shouldStop: () => n >= 1
    });
    eq(n, 1);
    eq(out.ok, 1);
    eq(out.skipped, 2);
    eq(out.stopped, true);
    eq(out.results[1].status, "skipped");
  });

  await test("runBatch: reports lifecycle callbacks", async () => {
    const starts = [];
    const items = [];
    await runBatch([batchItem(1), batchItem(2)], {
      process: async () => "v",
      onStart: (item, index, total) => starts.push(index + "/" + total),
      onItem: (entry, index) => items.push(entry.status + ":" + index)
    });
    eq(starts.join(","), "0/2,1/2");
    eq(items.join(","), "ok:0,ok:1");
  });

  await test("runBatch: an empty list is a no-op", async () => {
    const out = await runBatch([], { process: async () => 1 });
    eq(out.total, 0);
    eq(out.ok, 0);
    eq(out.results.length, 0);
  });

  await test("combineDocuments: merges docs with a TOC and combined front-matter", () => {
    const docs = [
      { title: "Alpha", url: "https://a.example/1", markdown: '---\ntitle: "Alpha"\n---\n\n# Alpha\n\nBody A.' },
      { title: "Beta", url: "https://b.example/2", markdown: "# Beta\n\nBody B." }
    ];
    const c = combineDocuments(docs, { title: "My Set", createdAt: Date.UTC(2024, 0, 5) });
    includes(c.markdown, 'title: "My Set"');
    includes(c.markdown, "documents: 2");
    includes(c.markdown, "created: 2024-01-05");
    includes(c.markdown, "## Contents");
    includes(c.markdown, "1. [Alpha](#doc-1)");
    includes(c.markdown, "2. [Beta](#doc-2)");
    includes(c.markdown, 'id="doc-2"');
    includes(c.markdown, "## 2. Beta");
    includes(c.markdown, "Body A.");
    includes(c.markdown, "Body B.");
    excludes(c.markdown, 'title: "Alpha"');
    eq(c.count, 2);
    assert(c.stats.words > 5, "combined stats counted");
  });

  await test("combineDocuments: toc and front-matter can be disabled", () => {
    const c = combineDocuments([{ title: "Solo", url: "https://a.example/1", markdown: "### Solo\n\nHi." }], {
      includeToc: false,
      includeFrontmatter: false
    });
    excludes(c.markdown, "## Contents");
    excludes(c.markdown, "documents:");
    includes(c.markdown, "# Combined capture");
  });

  await test("combineDocuments: skips empty documents and counts them", () => {
    const c = combineDocuments([
      { title: "Good", markdown: "Real content here." },
      { title: "Empty", markdown: "   " },
      null
    ]);
    eq(c.count, 1);
    eq(c.skipped, 2);
    includes(c.markdown, "Real content here.");
  });

  await test("stripFrontmatter removes only a leading YAML block", () => {
    eq(stripFrontmatter('---\ntitle: "X"\n---\n\n# Body'), "\n# Body");
    eq(stripFrontmatter("# Body only"), "# Body only");
    eq(stripFrontmatter(""), "");
  });

  /* ---------------- phase 6: quality detection, AI cleanup, doc export ---------------- */

  const CLEAN_DOC = {
    body: "# Title\n\nA normal paragraph with several words in it that reads well.\n\n- one item\n- two items\n- three items\n\n## Section\n\nAnother paragraph of reasonable length to keep the analysis calm.",
    markdown: "# Title\n\nA normal paragraph.",
    stats: { sourceChars: 2000, contentChars: 900, root: "article" }
  };

  await test("analyzeQuality: clean content scores zero and is not messy", () => {
    const q = analyzeQuality(CLEAN_DOC);
    eq(q.score, 0);
    eq(q.level, "clean");
    eq(q.messy, false);
    eq(q.signals.length, 0);
    eq(q.jsHeavy, false);
  });

  await test("analyzeQuality: chrome, link soup and fragments raise the score", () => {
    const body = [
      "Cookie notice: we use cookies to improve your experience.",
      "Subscribe to our newsletter for updates.",
      "Sign in to continue reading.",
      "Read more",
      "Related articles you may also like",
      "[Home](/home) [About](/about) [Shop](/shop) [Blog](/blog) [One](/1) [Two](/2) [Three](/3) [Four](/4) [Five](/5) [Six](/6)",
      "Tiny fragment.",
      "Another tiny bit.",
      "Yet another line.",
      "Short line here.",
      "More small text.",
      "Even more fragments.",
      "Final small fragment."
    ].join("\n\n");
    const q = analyzeQuality({ body, markdown: body, stats: { sourceChars: 5000, contentChars: 800, root: "body" } });
    assert(q.score >= MESSY_THRESHOLD, "messy score expected, got " + q.score);
    eq(q.messy, true);
    assert(q.signals.some(s => s.key === "boilerplate"), "boilerplate signal expected");
    assert(q.signals.some(s => s.key === "link_soup"), "link soup signal expected");
    assert(qualitySummary(q).indexOf("Messy") !== -1, "summary should mention Messy");
  });

  await test("analyzeQuality: detects JS-heavy pages with little readable text", () => {
    const html = Array.from({ length: 10 }, () => "<script src=\"/app.js\"></script>").join("");
    const q = analyzeQuality({ body: "Just a little.", markdown: "Just a little.", stats: { sourceChars: 240000, contentChars: 300, root: "body" } }, { html });
    eq(q.jsHeavy, true);
    assert(q.signals.some(s => s.key === "no_content_root"), "no_content_root expected");
    assert(q.signals.some(s => s.key === "low_text_ratio"), "low_text_ratio expected");
  });

  await test("qualityLevel: maps scores to levels at the thresholds", () => {
    eq(qualityLevel(0).level, "clean");
    eq(qualityLevel(19).level, "clean");
    eq(qualityLevel(20).level, "fair");
    eq(qualityLevel(MESSY_THRESHOLD).level, "messy");
    eq(qualityLevel(70).level, "very-messy");
    eq(qualityLevel(100).level, "very-messy");
  });

  await test("qualityDelta: reports the improvement between two analyses", () => {
    const d = qualityDelta({ score: 62, level: "messy" }, { score: 14, level: "clean" });
    eq(d.scoreBefore, 62);
    eq(d.scoreAfter, 14);
    eq(d.improvement, 48);
    eq(d.levelAfter, "clean");
    eq(qualityDelta(null, null), null);
  });

  await test("applyBody: swaps the body while keeping the front-matter", () => {
    const doc = { frontmatter: '---\ntitle: "X"\n---', body: "old", markdown: '---\ntitle: "X"\n---\n\nold', stats: {} };
    const next = applyBody(doc, "\n\n# New\n\nClean body.\n");
    eq(next.body, "# New\n\nClean body.");
    includes(next.markdown, '---\ntitle: "X"\n---');
    includes(next.markdown, "# New");
    eq(next.cleaned, true);
    excludes(next.markdown, "\nold");
  });

  await test("cleanupPresets / presetByKey: expose the presets and fall back safely", () => {
    const presets = cleanupPresets();
    assert(presets.length >= 4, "several presets expected");
    assert(presets.every(p => p.key && p.label), "every preset needs a key and label");
    eq(presetByKey("summary").key, "summary");
    eq(presetByKey("nope").key, CLEANUP_PRESETS[0].key);
  });

  await test("buildCleanupPrompt: source stays constant, revisions and task come last", () => {
    const base = { source: { title: "Hello", url: "https://e.example/a", body: "# Hello\n\ntext" }, preset: "tidy" };
    const first = buildCleanupPrompt(base);
    includes(first, "<SOURCE_DOCUMENT>");
    includes(first, "# Hello");
    includes(first, "SOURCE METADATA:");
    includes(first, "- Title: Hello");
    assert(first.indexOf("TASK:") > first.indexOf("</SOURCE_DOCUMENT>"), "task must follow the source");
    assert(first.lastIndexOf("TASK:") > first.lastIndexOf("SOURCE METADATA:"), "task is last");

    const withRevision = buildCleanupPrompt({ ...base, feedback: "shorten it", revisions: [{ text: "# Hello\n\nv1", preset: "tidy", feedback: "add more" }] });
    includes(withRevision, '<revision n="1" preset="tidy">');
    includes(withRevision, "<feedback>add more</feedback>");
    includes(withRevision, 'shorten it');
    assert(withRevision.indexOf("<revision") > withRevision.indexOf("</SOURCE_DOCUMENT>"), "revisions follow the source");

    const custom = buildCleanupPrompt({ ...base, preset: "custom", custom: "translate to French" });
    includes(custom, "translate to French");
  });

  await test("normalizeCleanupOutput: unwraps a single outer fence only", () => {
    eq(normalizeCleanupOutput("```markdown\n# Hi\n\nBody.\n```"), "# Hi\n\nBody.");
    eq(normalizeCleanupOutput("```\n# Hi\n```"), "# Hi");
    eq(normalizeCleanupOutput("# Hi\n\nNo fence."), "# Hi\n\nNo fence.");
    const inner = "# Hi\n\n```js\ncode();\n```\n\ndone";
    eq(normalizeCleanupOutput(inner), inner);
    eq(normalizeCleanupOutput("   "), "");
  });

  await test("fitToBudget: passes through under budget and trims with a note over it", () => {
    const countTokens = t => Math.ceil(String(t).length / 4);
    const small = "short text";
    eq(fitToBudget(small, countTokens, 100).truncated, false);
    const big = Array.from({ length: 40 }, (_, i) => "Line number " + i + " with some words.").join("\n");
    const out = fitToBudget(big, countTokens, 12);
    eq(out.truncated, true);
    includes(out.text, "[The document was truncated");
    assert(out.text.length < big.length, "trimmed below the original");
    eq(fitToBudget(big, null, 0).truncated, false);
  });

  await test("runCleanup: streams, normalizes the reply and reports progress", async () => {
    const chunks = [];
    const seen = [];
    const generateText = opts => {
      seen.push(opts);
      opts.onChunk && opts.onChunk({ textChunk: "```markdown" });
      return Promise.resolve({ text: "```markdown\n# Clean\n\nBody.\n```", generatedText: "# Clean\n\nBody." });
    };
    const result = await runCleanup({
      source: { title: "T", url: "https://e.example/x", body: "# T\n\nmess" },
      preset: "tidy",
      generateText,
      onChunk: d => chunks.push(d.textChunk),
      onPending: p => assert(typeof p.then === "function", "pending promise exposed")
    });
    eq(result.text, "# Clean\n\nBody.");
    eq(result.preset, "tidy");
    eq(chunks.length, 1);
    eq(seen.length, 1);
    includes(seen[0].instruction, "<SOURCE_DOCUMENT>");
    assert(result.stats.words > 0, "recomputed stats");
  });

  await test("runCleanup: rejects an empty reply and a missing generator", async () => {
    await expectReject(() => runCleanup({ source: { body: "x" }, generateText: () => Promise.resolve({ text: "   " }) }), null, "empty reply");
    await expectReject(() => runCleanup({ source: { body: "x" } }), null, "no generator");
  });

  await test("docsToJson / docsFromJson: round-trips the document list", () => {
    const docs = [{ id: "a", title: "A", markdown: "# A", tags: ["x"] }, { id: "b", title: "B", markdown: "# B" }];
    const payload = docsToJson(docs);
    eq(payload.format, DOC_FORMAT);
    eq(payload.version, 1);
    eq(payload.documents.length, 2);
    eq(docsFromJson(payload).length, 2);
    eq(docsFromJson(docs).length, 2);
    eq(docsFromJson({ nope: 1 }), null);
  });

  await test("docsToMarkdown / docsFromMarkdown: round-trips metadata and bodies", () => {
    const docs = [
      { id: "a", title: "Alpha", url: "https://a.example/1", site: "a.example", author: "Ann", tags: ["one", "two"], notes: "note A", markdown: "---\ntitle: \"Alpha\"\n---\n\n# Alpha\n\nBody A with --- inside.\n\n## Sub\n\nMore." },
      { id: "b", title: "Beta", url: "https://b.example/2", markdown: "# Beta\n\nBody B." }
    ];
    const md = docsToMarkdown(docs, { title: "My Docs", date: Date.UTC(2024, 0, 5) });
    includes(md, "# My Docs");
    includes(md, "<!-- extrax-doc ");
    includes(md, "<document>");
    assert(md.indexOf("Body A") !== -1, "body A present");
    excludes(md, 'title: "Alpha"');
    eq(hasDocMarkers(md), true);

    const back = docsFromMarkdown(md);
    eq(back.length, 2);
    eq(back[0].title, "Alpha");
    eq(back[0].url, "https://a.example/1");
    eq(back[0].author, "Ann");
    eq(back[0].tags.join(","), "one,two");
    eq(back[0].notes, "note A");
    includes(back[0].markdown, "# Alpha");
    includes(back[0].markdown, "Body A with --- inside.");
    includes(back[0].markdown, "## Sub");
    includes(back[1].markdown, "Body B.");
    eq(hasDocMarkers("# plain"), false);
  });

  await test("docFromMarkdown: reads front-matter, first heading or filename for the title", () => {
    const withFm = docFromMarkdown('---\ntitle: "From FM"\nurl: https://e.example/x\nauthor: Bob\npublished: 2024-02-03\n---\n\n# Heading\n\nBody.');
    eq(withFm.title, "From FM");
    eq(withFm.url, "https://e.example/x");
    eq(withFm.author, "Bob");
    eq(withFm.published, "2024-02-03");
    includes(withFm.markdown, "# Heading");
    eq(docFromMarkdown("# Just Heading\n\nBody.").title, "Just Heading");
    eq(docFromMarkdown("plain body only", { filename: "My Capture.md" }).title, "My Capture");
  });

  await test("parseDocsMarkdown: multi-doc export vs a plain markdown file", () => {
    const md = docsToMarkdown([{ title: "Solo", markdown: "# Solo\n\nHi." }]);
    eq(parseDocsMarkdown(md).length, 1);
    const plain = parseDocsMarkdown("# Plain\n\nstuff");
    eq(plain.length, 1);
    eq(plain[0].title, "Plain");
    includes(plain[0].markdown, "stuff");
  });

  await test("parseFrontmatter: reads simple key/value pairs", () => {
    const p = parseFrontmatter('---\ntitle: "Hello"\nempty:\n---\n\nBody');
    eq(p.fields.title, "Hello");
    eq(p.fields.empty, "");
    eq(p.body.trim(), "Body");
    eq(parseFrontmatter("no fm").body, "no fm");
  });

  await test("createDocRecord: honours imported id/createdAt/notes and normalises tags", () => {
    const rec = createDocRecord({ id: "keep-me", title: "T", createdAt: 12345, notes: "hi", tags: [" Big ", "BIG", "two"] });
    eq(rec.id, "keep-me");
    eq(rec.createdAt, 12345);
    eq(rec.notes, "hi");
    eq(rec.tags.join(","), "big,two");
    assert(createDocRecord({}).id, "generates an id when absent");
  });

  await test("makeImportedRecord: turns parsed markdown into a saveable record", () => {
    const rec = makeImportedRecord(docFromMarkdown("# Title\n\nBody.", { filename: "t.md" }));
    assert(rec.id, "has an id");
    eq(rec.title, "Title");
    eq(rec.tags.length, 0);
    includes(rec.markdown, "Body.");
    assert(Number.isFinite(rec.createdAt), "has a timestamp");
  });

  await test("sameSite: compares hosts ignoring www", () => {
    eq(sameSite("https://www.example.com/a", "https://example.com/b"), true);
    eq(sameSite("https://example.com/a", "https://other.com/b"), false);
    eq(sameSite("not a url", "https://example.com"), false);
  });

  await test("normalizeCrawlUrl: strips hash and trailing slash, keeps query", () => {
    const a = normalizeCrawlUrl("example.com/docs/#top");
    eq(a.ok, true);
    eq(a.url, "https://example.com/docs");
    const b = normalizeCrawlUrl("https://example.com/a/b/");
    eq(b.url, "https://example.com/a/b");
    eq(b.host, "example.com");
    const c = normalizeCrawlUrl("https://example.com/a//b///c/");
    eq(c.url, "https://example.com/a/b/c");
    eq(normalizeCrawlUrl("   ").ok, false);
  });

  await test("crawlKey: dedupes case, hash and trailing slash", () => {
    eq(crawlKey("https://Example.com/A/"), crawlKey("https://example.com/A#x"));
    eq(crawlKey("https://example.com/A"), crawlKey("https://example.com/a"));
    eq(crawlKey("https://example.com/"), crawlKey("https://example.com"));
  });

  const CRAWL_HTML = `<html><body>
    <a href="/relative">Rel</a>
    <a href="https://site.test/abs">Abs</a>
    <a href="#frag">Frag</a>
    <a href="mailto:a@b.com">Mail</a>
    <a href="https://other.test/x">Ext</a>
    <a href="/doc.pdf">Pdf</a>
    <a href="/img.png">Img</a>
    <a href="https://site.test/">Self</a>
    <a href="/api">Api</a>
    <a href="https://site.test/abs">Dup</a>
    <a href="  /space  ">Space</a>
    <area href="/map">
  </body></html>`;

  await test("linksFromHtml: resolves, filters schemes/extensions/self/off-host and dedupes", () => {
    const links = linksFromHtml(CRAWL_HTML, "https://site.test/");
    const urls = links.map(l => l.url);
    includes(urls.join(" "), "https://site.test/relative");
    includes(urls.join(" "), "https://site.test/api");
    includes(urls.join(" "), "https://site.test/space");
    includes(urls.join(" "), "https://site.test/map");
    eq(urls.length, 5);
    excludes(urls.join(" "), "other.test");
    excludes(urls.join(" "), "mailto");
    excludes(urls.join(" "), "doc.pdf");
    excludes(urls.join(" "), "img.png");
    eq(urls.filter(u => u === "https://site.test/abs").length, 1);
  });

  await test("linksFromHtml: sameHostOnly=false keeps external links", () => {
    const links = linksFromHtml(CRAWL_HTML, "https://site.test/", { sameHostOnly: false });
    includes(links.map(l => l.url).join(" "), "https://other.test/x");
  });

  await test("linksFromHtml: include and exclude substring filters", () => {
    const only = linksFromHtml(CRAWL_HTML, "https://site.test/", { include: "/api" });
    eq(only.length, 1);
    eq(only[0].url, "https://site.test/api");
    const not = linksFromHtml(CRAWL_HTML, "https://site.test/", { exclude: "/api" });
    eq(not.map(l => l.url).indexOf("https://site.test/api"), -1);
  });

  await test("linksFromHtml: swallows parser errors", () => {
    eq(linksFromHtml("<html/>", "https://site.test/", { parse: () => { throw new Error("boom"); } }).length, 0);
  });

  await test("extractLinks: reads anchors and areas, normalises text", () => {
    const doc = new DOMParser().parseFromString(CRAWL_HTML, "text/html");
    const links = extractLinks(doc);
    eq(links.length, 12);
    includes(links.map(l => l.text).join("|"), "Rel");
  });

  await test("slugSegment: lowercases, strips unsafe chars, falls back to page", () => {
    eq(slugSegment("About Us"), "about-us");
    eq(slugSegment("  ...  "), "page");
    eq(slugSegment("a".repeat(80)).length, 60);
  });

  await test("crawlFilePath: maps URLs to host/path folders", () => {
    eq(crawlFilePath("https://site.test/"), "site.test/index.md");
    eq(crawlFilePath("https://site.test/docs/"), "site.test/docs/index.md");
    eq(crawlFilePath("https://site.test/about"), "site.test/about.md");
    eq(crawlFilePath("https://site.test/a.html"), "site.test/a.md");
    eq(crawlFilePath("https://site.test/a.php?q=1"), "site.test/a.md");
    eq(crawlFilePath("https://www.site.test/x/y.html"), "site.test/x/y.md");
    eq(crawlFilePath("https://site.test/About Us/"), "site.test/about-us/index.md");
    eq(crawlFilePath("nonsense"), "site/index.md");
  });

  await test("uniqueZipName: appends a numeric suffix before the extension", () => {
    eq(uniqueZipName("a.md", new Set(["a.md"])), "a-2.md");
    eq(uniqueZipName("dir/a.md", new Set(["dir/a.md"])), "dir/a-2.md");
    eq(uniqueZipName("dir/a.md", new Set(["dir/a.md", "dir/a-2.md"])), "dir/a-3.md");
    eq(uniqueZipName("fresh.md", new Set()), "fresh.md");
    eq(uniqueZipName("", new Set()), "page.md");
  });

  await test("crawlFilePaths: skips non-ok pages and uniquifies collisions", () => {
    const paths = crawlFilePaths([
      { url: "https://site.test/a", status: "ok" },
      { url: "https://site.test/a.html", status: "ok" },
      { url: "https://site.test/b", status: "error" }
    ]);
    eq(paths.size, 2);
    eq(paths.get("https://site.test/a"), "site.test/a.md");
    eq(paths.get("https://site.test/a.html"), "site.test/a-2.md");
    eq(paths.has("https://site.test/b"), false);
  });

  await test("crawlTree: nests children under their parents", () => {
    const roots = crawlTree([
      { url: "https://site.test/", title: "Home", depth: 0, status: "ok" },
      { url: "https://site.test/a", title: "A", depth: 1, status: "ok", parent: "https://site.test/" },
      { url: "https://site.test/b", title: "B", depth: 1, status: "ok", parent: "https://site.test/" }
    ]);
    eq(roots.length, 1);
    eq(roots[0].title, "Home");
    eq(roots[0].children.length, 2);
    eq(roots[0].children.map(c => c.title).join(","), "A,B");
  });

  function fakeCrawlSite() {
    const pages = {
      "https://site.test/": `<html><head><title>Home</title></head><body><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></body></html>`,
      "https://site.test/a": `<html><head><title>A</title></head><body><a href="/d">D</a></body></html>`,
      "https://site.test/b": `<html><head><title>B</title></head><body><a href="/d">D</a><a href="https://other.test/x">X</a></body></html>`,
      "https://site.test/d": `<html><head><title>D</title></head><body>leaf</body></html>`
    };
    const fetchPage = async url => {
      if (url === "https://site.test/c") throw new Error("no c");
      const html = pages[url];
      if (html == null) return { html: "", finalUrl: url, host: "site.test" };
      return { html, finalUrl: url, host: "site.test" };
    };
    const buildDoc = (html, url) => {
      const m = /<title>([^<]*)<\/title>/.exec(html || "");
      return { title: m ? m[1] : url, markdown: "# " + (m ? m[1] : url) };
    };
    return { fetchPage, buildDoc };
  }

  await test("crawlSite: walks within maxDepth and records errors", async () => {
    const s = fakeCrawlSite();
    const out = await crawlSite("https://site.test/", { maxDepth: 1, maxPages: 10, fetchPage: s.fetchPage, buildDoc: s.buildDoc });
    eq(out.ok, 3);
    eq(out.failed, 1);
    eq(out.pages.length, 4);
    eq(out.host, "site.test");
    const c = out.pages.find(p => p.url === "https://site.test/c");
    eq(c.status, "error");
    includes(String(c.error && c.error.message), "no c");
    eq(out.pages.some(p => p.url === "https://site.test/d"), false);
    const a = out.pages.find(p => p.url === "https://site.test/a");
    eq(a.title, "A");
    eq(a.depth, 1);
    eq(a.parent, "https://site.test/");
  });

  await test("crawlSite: maxDepth 2 follows grandchildren, sameHostOnly drops external", async () => {
    const s = fakeCrawlSite();
    const out = await crawlSite("https://site.test/", { maxDepth: 2, maxPages: 10, fetchPage: s.fetchPage, buildDoc: s.buildDoc });
    eq(out.ok, 4);
    eq(out.pages.some(p => p.url === "https://site.test/d"), true);
    eq(out.pages.some(p => p.url === "https://other.test/x"), false);
  });

  await test("crawlSite: maxPages caps fetches and marks leftovers skipped", async () => {
    const s = fakeCrawlSite();
    const out = await crawlSite("https://site.test/", { maxDepth: 5, maxPages: 2, fetchPage: s.fetchPage, buildDoc: s.buildDoc });
    eq(out.ok, 2);
    eq(out.skipped, 3);
    eq(out.total, 5);
    eq(out.pages.filter(p => p.status === "skipped").every(p => p.markdown === ""), true);
  });

  await test("crawlSite: shouldStop halts and leaves the queue skipped", async () => {
    const s = fakeCrawlSite();
    let seen = 0;
    const out = await crawlSite("https://site.test/", {
      maxDepth: 2, maxPages: 10, fetchPage: s.fetchPage, buildDoc: s.buildDoc,
      shouldStop: () => seen >= 1,
      onVisit: () => { seen++; }
    });
    eq(out.stopped, true);
    eq(out.ok, 1);
    assert(out.skipped >= 1, "leftover queue is skipped");
  });

  await test("crawlSite: rejects an invalid start url", async () => {
    await expectReject(() => crawlSite("   ", { fetchPage: async () => ({}) }), "empty", "blank url");
  });

  await test("crawlManifest: lists ok pages with relative links", () => {
    const pages = [
      { url: "https://site.test/", title: "Home", depth: 0, status: "ok" },
      { url: "https://site.test/a", title: "A [note]", depth: 1, status: "ok" },
      { url: "https://site.test/b", title: "B", depth: 2, status: "error" }
    ];
    const m = crawlManifest(pages, { title: "My Site", startUrl: "https://site.test/", createdAt: Date.UTC(2024, 4, 6) });
    includes(m.markdown, "# My Site");
    includes(m.markdown, "**Captured:** 2024-05-06");
    includes(m.markdown, "- **Pages:** 2");
    includes(m.markdown, "[Home](site.test/index.md)");
    includes(m.markdown, "[A note](site.test/a.md)");
    excludes(m.markdown, "B");
    eq(m.count, 2);
    eq(m.start, "https://site.test/");
  });

  await test("crc32: matches known vectors", () => {
    const enc = new TextEncoder();
    eq(crc32(enc.encode("")), 0);
    eq(crc32(enc.encode("a")), 0xe8b7be43);
    eq(crc32(enc.encode("123456789")), 0xcbf43926);
  });

  await test("createZip: writes a well-formed store-method archive", () => {
    const zip = createZip([
      { name: "site/index.md", data: "# Home\n" },
      { name: "site/about.md", data: "# About\n" }
    ]);
    assert(zip instanceof Uint8Array, "returns bytes");
    const head = new DataView(zip.buffer, zip.byteOffset, 4);
    eq(head.getUint32(0, true), 0x04034b50);
    const eocdStart = zip.length - 22;
    const eocd = new DataView(zip.buffer, zip.byteOffset + eocdStart, 22);
    eq(eocd.getUint32(0, true), 0x06054b50);
    eq(eocd.getUint16(8, true), 2);
    eq(eocd.getUint16(10, true), 2);
    const text = new TextDecoder("latin1").decode(zip);
    includes(text, "site/index.md");
    includes(text, "site/about.md");
    includes(text, "# Home");
  });

  await test("createZip: keeps byte content intact and crc32 matches", () => {
    const data = new TextEncoder().encode("hello zip");
    const zip = createZip([{ name: "a.txt", data }]);
    const dv = new DataView(zip.buffer, zip.byteOffset, 30);
    eq(dv.getUint32(14, true), crc32(data));
    const start = 30 + "a.txt".length;
    eq(new TextDecoder().decode(zip.slice(start, start + data.length)), "hello zip");
  });

  await test("exportRecord: pulls metadata from the built document", () => {
    const rec = exportRecord({
      title: "Title", url: "https://e.example/x", host: "e.example", markdown: "# Title\n\nBody",
      doc: { metadata: { site: "Example", author: "Ann", published: "2024-01-02" } }
    });
    eq(rec.site, "Example");
    eq(rec.author, "Ann");
    eq(rec.published, "2024-01-02");
    eq(rec.title, "Title");
    includes(rec.markdown, "Body");
  });

  await test("buildExportFiles: empty input yields no files", () => {
    const out = buildExportFiles([]);
    eq(out.count, 0);
    eq(out.files.length, 0);
    eq(buildExportFiles(null).files.length, 0);
  });

  await test("buildExportFiles: combined markdown is a single file with a TOC", () => {
    const out = buildExportFiles(
      [{ title: "Alpha", url: "https://e.example/a", markdown: "# Alpha\n\nA body." },
       { title: "Beta", url: "https://e.example/b", markdown: "# Beta\n\nB body." }],
      { format: "markdown", baseName: "combined-capture-2024-01-02", title: "Combined capture" }
    );
    eq(out.count, 2);
    eq(out.files.length, 1);
    eq(out.files[0].name, "combined-capture-2024-01-02.md");
    includes(out.files[0].text, "# Combined capture");
    includes(out.files[0].text, "A body.");
    includes(out.files[0].text, "B body.");
    includes(out.files[0].text, "## Contents");
  });

  await test("buildExportFiles: combined JSON round-trips through docsFromJson", () => {
    const out = buildExportFiles(
      [{ title: "Alpha", url: "https://e.example/a", markdown: "# Alpha\n\nA body." },
       { title: "Beta", url: "https://e.example/b", markdown: "# Beta\n\nB body." }],
      { format: "json", baseName: "site" }
    );
    eq(out.files.length, 1);
    eq(out.files[0].name, "site.json");
    eq(out.files[0].mime, "application/json");
    const data = JSON.parse(out.files[0].text);
    eq(data.format, "extrax-documents");
    eq(data.documents.length, 2);
    includes(data.documents[0].markdown, "A body.");
    const back = docsFromJson(data);
    eq(back.length, 2);
    eq(back[1].title, "Beta");
  });

  await test("buildExportFiles: individual markdown writes one file per page", () => {
    const out = buildExportFiles(
      [{ title: "Alpha", url: "https://e.example/a", markdown: "# Alpha\n\nA body." },
       { title: "Beta", url: "https://e.example/b", markdown: "# Beta\n\nB body." }],
      { format: "markdown", individual: true }
    );
    eq(out.count, 2);
    eq(out.files.length, 2);
    assert(out.files.every(f => /\.md$/.test(f.name)), "all files end in .md");
    assert(out.files[0].name !== out.files[1].name, "names are unique");
    const text = out.files.map(f => f.text).join("|");
    includes(text, "A body.");
    includes(text, "B body.");
  });

  await test("buildExportFiles: individual JSON writes one JSON document per page", () => {
    const out = buildExportFiles(
      [{ title: "Alpha", url: "https://e.example/a", markdown: "# Alpha\n\nA body." },
       { title: "Beta", url: "https://e.example/b", markdown: "# Beta\n\nB body." }],
      { format: "json", individual: true }
    );
    eq(out.files.length, 2);
    assert(out.files.every(f => /\.json$/.test(f.name)), "all files end in .json");
    const first = JSON.parse(out.files[0].text);
    eq(first.documents.length, 1);
  });

  await test("buildExportFiles: flattens folder names and de-duplicates collisions", () => {
    const out = buildExportFiles(
      [{ title: "Same", filename: "site.test/a", markdown: "A" },
       { title: "Same", filename: "site.test/a", markdown: "B" }],
      { format: "markdown", individual: true }
    );
    eq(out.files.length, 2);
    assert(out.files[0].name.indexOf("__") !== -1, "slashes become double underscores");
    assert(out.files[0].name !== out.files[1].name, "collisions get a suffix");
    eq(out.files[0].text, "A");
    eq(out.files[1].text, "B");
  });

  /* ---------------- theme tokens ---------------- */

  await test("normalizeColor: hex, rgb, hsl and named values", () => {
    eq(normalizeColor("#abc"), "#aabbcc");
    eq(normalizeColor("#AABBCCDD"), "#aabbcc");
    eq(normalizeColor("rgb(255, 0, 0)"), "#ff0000");
    eq(normalizeColor("rgba(0, 0, 0, 0.5)"), "#000000");
    eq(normalizeColor("hsl(0, 100%, 50%)"), "#ff0000");
    eq(normalizeColor("blue"), "#0000ff");
    eq(normalizeColor("transparent"), null);
    eq(normalizeColor("definitely-not-a-color"), null);
  });

  await test("colorsFromText: picks hex and named colors in order", () => {
    eq(colorsFromText("#ff0000 and blue").join(","), "#ff0000,#0000ff");
  });

  await test("cardColors: dedupes vars, styles and the palette line", () => {
    const colors = cardColors({
      cssVars: { "--a": "#111111", "--b": "var(--a)" },
      keyStyles: { background: "#222222" },
      theme: "COLOR PALETTE: #333333, red"
    });
    eq(colors.length, 4);
    assert(colors.includes("#111111") && colors.includes("#222222") && colors.includes("#333333") && colors.includes("#ff0000"), "all four colors present");
  });

  await test("designTokens: resolves vars into background, text and radius", () => {
    const t = designTokens({
      name: "demo", title: "Demo",
      cssVars: { "--bg": "#101018", "--fg": "#e0e0ff" },
      keyStyles: { "background-color": "var(--bg)", color: "var(--fg)", "border-radius": "10px" },
      fonts: ["Inter"]
    });
    eq(t.colors.length, 2);
    eq(t.background, "#101018");
    eq(t.textColor, "#e0e0ff");
    eq(t.radius, "10px");
    eq(t.fontFamily, "Inter, sans-serif");
  });

  await test("resolveVars: substitutes variables and honours fallbacks", () => {
    eq(resolveVars("1px solid var(--x, red)", { "--x": "blue" }), "1px solid blue");
    eq(resolveVars("var(--missing, green)", {}), "green");
  });

  await test("token exports serialise to JSON, CSS, SCSS and Tailwind", () => {
    const t = designTokens({ cssVars: { "--accent": "#ff8800" }, keyStyles: { "border-radius": "8px" }, fonts: ["Inter"] });
    assert(JSON.parse(tokensToJson(t)).colors.length >= 1, "json round-trips");
    includes(tokensToCssVars(t), ":root {");
    includes(tokensToCssVars(t), t.colors[0].value);
    includes(tokensToScss(t), "$" + t.colors[0].name + ":");
    includes(tokensToTailwind(t), "module.exports = {");
    includes(tokensToTailwind(t), t.colors[0].value);
  });

  /* ---------------- theme scaffold ---------------- */

  const SAMPLE_CARD = {
    id: "x1", name: "cozy-forest-quest", title: "Cozy Forest Quest",
    theme: "GENRE: adventure\nMOOD/VIBE: warm and calm\nVISUAL AESTHETIC: soft flat illustration\nCOLOR PALETTE: #2cb67d, #f5e6c8\nCORE SUBJECT: a forest journey\nTHEME IN ONE LINE: a gentle woodland adventure\nTAGS: cozy, forest",
    tags: ["cozy", "forest"], fonts: ["Inter"], fontLinks: [],
    cssVars: { "--bg": "#15130f", "--fg": "#f5e6c8" },
    keyStyles: { "background-color": "var(--bg)", color: "var(--fg)", "border-radius": "14px" },
    description: "A cozy forest adventure."
  };

  await test("starterScaffold: emits index.html, main.pjs, theme.css and README", () => {
    const s = starterScaffold(SAMPLE_CARD);
    eq(s.files.length, 4);
    const names = s.files.map(f => f.name).join(",");
    includes(names, "index.html");
    includes(names, "main.pjs");
    eq(s.slug, "cozy-forest-quest");
  });

  await test("starterScaffold: index.html carries the theme and a live demo", () => {
    const html = starterScaffold(SAMPLE_CARD).files.find(f => f.name === "index.html").text;
    includes(html, "<style>");
    includes(html, "--bg: #15130f;");
    includes(html, "[sentence]");
    includes(html, "evaluateItem");
  });

  await test("starterScaffold: main.pjs is themed and README notes the mood", () => {
    const s = starterScaffold(SAMPLE_CARD);
    includes(s.files.find(f => f.name === "main.pjs").text, "title = Cozy Forest Quest");
    includes(s.files.find(f => f.name === "README.md").text, "warm and calm");
    assert(/starter\.zip$/.test(scaffoldZipName(SAMPLE_CARD)), "zip name ends in -starter.zip");
  });

  /* ---------------- theme compare ---------------- */

  await test("themeFields: pulls the labelled lines out of a theme", () => {
    const f = themeFields(SAMPLE_CARD);
    eq(f.genre, "adventure");
    eq(f.mood, "warm and calm");
    eq(f.oneline, "a gentle woodland adventure");
  });

  await test("themeSimilarity: related themes score higher than unrelated ones", () => {
    const twin = { ...SAMPLE_CARD, id: "x2", name: "cozy-forest-quest-2" };
    const other = { id: "x3", name: "neon-shooter", title: "Neon Shooter", theme: "GENRE: shooter\nMOOD/VIBE: aggressive", tags: ["action"], fonts: ["Orbitron"], cssVars: {}, keyStyles: {} };
    const close = themeSimilarity(SAMPLE_CARD, twin).score;
    const far = themeSimilarity(SAMPLE_CARD, other).score;
    assert(close > far, `expected ${close} > ${far}`);
    assert(close >= 90, "identical themes score near 100");
  });

  await test("findSimilar: ranks the closest cards and excludes the target", () => {
    const twin = { ...SAMPLE_CARD, id: "x2", name: "twin" };
    const other = { id: "x3", name: "other", theme: "GENRE: shooter", tags: ["action"], fonts: ["Orbitron"], cssVars: {}, keyStyles: {} };
    const out = findSimilar([SAMPLE_CARD, twin, other], "x1", 2);
    assert(out.length >= 1, "returns candidates");
    eq(out[0].card.id, "x2");
  });

  await test("compareCards: field rows flag differences", () => {
    const twin = { ...SAMPLE_CARD, id: "x2", title: "Different Title" };
    const cmp = compareCards(SAMPLE_CARD, twin);
    const titleRow = cmp.rows.find(r => r.key === "title");
    eq(titleRow.changed, true);
    const genreRow = cmp.rows.find(r => r.key === "genre");
    eq(genreRow.changed, false);
    includes(compareToText(SAMPLE_CARD, twin, cmp), "| Field |");
  });

  /* ---------------- generator inspector ---------------- */

  const PJS_SAMPLE = [
    "animal",
    "  cat",
    "  dog",
    "fruit",
    "  apple",
    "foo(x) =>",
    "  let y = x + 1;",
    "  return y;",
    "$meta",
    "  title = Hi",
    "color = {1-20}",
    "imp = {import:kv-plugin}",
    "$output = [fruit]"
  ].join("\n");

  await test("parsePjsTree: builds a tree with kinds, items and functions", () => {
    const tree = parsePjsTree(PJS_SAMPLE);
    const animal = tree.find(n => n.name === "animal");
    eq(animal.kind, "list");
    eq(animal.items, 2);
    const fn = tree.find(n => n.name === "foo");
    eq(fn.kind, "function");
    eq(fn.body.length, 2);
    assert(tree.some(n => n.kind === "output"), "finds $output");
  });

  await test("generatorImports / generatorMeta / overview", () => {
    eq(generatorImports(PJS_SAMPLE)[0].name, "kv-plugin");
    eq(generatorMeta(PJS_SAMPLE).title, "Hi");
    const ov = generatorOverview(PJS_SAMPLE);
    eq(ov.hasOutput, true);
    includes(listNames(ov.tree).join(","), "animal");
    includes(functionNames(ov.tree).join(","), "foo");
    includes(treeToText(ov.tree), "animal  [list, 2 items]");
  });

  await test("extractGeneratorName + api urls", () => {
    eq(extractGeneratorName("perchance.org/cozy-forest-quest"), "cozy-forest-quest");
    eq(extractGeneratorName("https://cozy.perchance.org/x"), "cozy");
    includes(generatorApiUrl("foo"), "generatorNames=foo");
    includes(generatorPageUrl("foo"), "perchance.org/foo");
  });

  /* ---------------- structured extraction ---------------- */

  const TABLE_HTML = '<table><caption>People</caption><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Ada</td><td>36</td></tr><tr><td>Bob</td><td>40</td></tr></tbody></table>';

  await test("tablesFromHtml: reads headers and rows", () => {
    const tables = tablesFromHtml(TABLE_HTML);
    eq(tables.length, 1);
    eq(tables[0].headers.join(","), "Name,Age");
    eq(tables[0].rowCount, 2);
    eq(tables[0].caption, "People");
    eq(tables[0].hasHeader, true);
  });

  await test("tablesFromHtml: handles colspan and rowspan cells", () => {
    const tables = tablesFromHtml('<table><tr><th rowspan="2">A</th><th>B</th></tr><tr><td>C</td></tr></table>');
    eq(tables[0].headers.join(","), "A,B");
    eq(tables[0].rows.length, 1);
    eq(tables[0].rows[0][1], "C");
  });

  await test("tableToCsv: quotes fields containing commas or quotes", () => {
    const tables = tablesFromHtml('<table><tr><th>X</th></tr><tr><td>a,b</td></tr><tr><td>he said "hi"</td></tr></table>');
    const csv = tableToCsv(tables[0]);
    includes(csv, '"a,b"');
    includes(csv, '"he said ""hi"""');
  });

  await test("tableFiles: combined and individual CSV/JSON", () => {
    const tables = tablesFromHtml(TABLE_HTML);
    const combined = tableFiles(tables, { baseName: "people" });
    eq(combined.files.length, 1);
    eq(combined.files[0].name, "people.csv");
    const each = tableFiles(tables, { baseName: "people", individual: true, format: "json" });
    assert(each.files.length === 1 && /\.json$/.test(each.files[0].name), "json per table");
    includes(tablesToJson(tables), '"columns"');
    includes(tablesSummary(tables), "1 table");
  });

  await test("buildSchemaPrompt + parseSchemaOutput", () => {
    const prompt = buildSchemaPrompt({ markdown: "# Doc\n\nhello", schema: defaultSchema(), instruction: "Extract people." });
    includes(prompt, "<DOCUMENT>");
    includes(prompt, '"summary"');
    const ok = parseSchemaOutput('Here you go:\n```json\n{"title":"X","items":[1]}\n```');
    eq(ok.ok, true);
    eq(ok.value.title, "X");
    eq(parseSchemaOutput("no json here").ok, false);
  });

  /* ---------------- inventory ---------------- */

  const INV_HTML = '<a href="/a">A</a><a href="https://other.com/b">B</a><a href="mailto:x@y.com">mail</a>'
    + '<a href="/doc.pdf">PDF</a><img src="/img.png" alt="pic">'
    + '<img srcset="/x.png 1x, /y.png 2x"><video src="/v.mp4"></video>';

  await test("inventoryFromHtml: classifies links, images, media, files and emails", () => {
    const inv = inventoryFromHtml(INV_HTML, "https://site.test/page");
    eq(inv.counts.links, 3);
    eq(inv.counts.internal, 2);
    eq(inv.counts.external, 1);
    eq(inv.counts.images, 3);
    eq(inv.counts.media, 1);
    eq(inv.counts.files, 1);
    eq(inv.emails[0], "x@y.com");
  });

  await test("inventory exports: JSON, CSV and summary", () => {
    const inv = inventoryFromHtml(INV_HTML, "https://site.test/page");
    includes(JSON.parse(inventoryToJson(inv)).counts.links, 3);
    assert(inventoryToCsv(inv).startsWith("type,url,text,host,internal"), "csv header");
    includes(inventorySummary(inv), "link");
    eq(inventoryFiles(inv, { baseName: "res" }).length, 2);
  });

  /* ---------------- watch / diff ---------------- */

  await test("contentHash: stable and text-sensitive", () => {
    eq(contentHash("hello"), contentHash("hello"));
    assert(contentHash("hello") !== contentHash("hello!"), "different text hashes differently");
  });

  await test("diffLines: detects added and removed lines", () => {
    const d = diffLines("a\nb\nc", "a\nB\nc");
    eq(d.added, 1);
    eq(d.removed, 1);
    eq(d.changed, true);
    includes(changeSummary(d), "+1 line");
    includes(diffToMarkdown(d), "```diff");
    eq(diffStats(d).changedLines, 2);
  });

  await test("diffLines: identical text reports no changes", () => {
    const d = diffLines("same\nlines", "same\nlines");
    eq(d.changed, false);
    eq(changeSummary(d), "No changes detected.");
  });

  await test("createWatchStore: save, patch and remove over a kv folder", async () => {
    const store = createWatchStore(fakeFolder());
    const rec = await store.save(createWatchRecord({ url: "https://e.test", title: "E", markdown: "hello" }));
    eq((await store.list()).length, 1);
    await store.patch(rec.id, { note: "check" });
    eq((await store.list())[0].note, "check");
    await store.remove(rec.id);
    eq((await store.list()).length, 0);
    includes(watchSummary(rec), "words");
  });

  /* ---------------- LLM context + Q&A ---------------- */

  await test("buildContextBundle: lists sources and concatenates docs", () => {
    const bundle = buildContextBundle([{ title: "A", url: "https://a", markdown: "# A\n\nalpha" }]);
    eq(bundle.included, 1);
    includes(bundle.markdown, "alpha");
    eq(bundle.sources.length, 1);
  });

  await test("buildContextBundle: honours a token budget and drops the overflow", () => {
    const countTokens = s => Math.ceil(String(s).length / 4);
    const big = "word ".repeat(2000);
    const bundle = buildContextBundle(
      [{ title: "A", markdown: big }, { title: "B", markdown: big }, { title: "C", markdown: big }],
      { maxTokens: 500, countTokens }
    );
    assert(bundle.included < 3, "does not include everything");
    assert(bundle.dropped >= 1, "reports dropped documents");
  });

  await test("buildAskPrompt + parseAskAnswer", () => {
    const built = buildAskPrompt({ docs: [{ title: "A", markdown: "alpha" }], question: "What is alpha?" });
    includes(built.prompt, "QUESTION: What is alpha?");
    includes(built.prompt, "SOURCES:");
    const parsed = parseAskAnswer("See [1] and also [2].");
    eq(parsed.citations.join(","), "1,2");
    assert(/\.md$/.test(bundleFileName("my bundle")), "bundle filename ends .md");
  });

  /* ---------------- EPUB ---------------- */

  await test("markdownToXhtml: headings, emphasis, code and escaping", () => {
    includes(markdownToXhtml("# Hi\n\nSome **bold** text."), "<h1>Hi</h1>");
    includes(markdownToXhtml("Some **bold** text."), "<strong>bold</strong>");
    includes(markdownToXhtml("```js\nconst x = 1;\n```"), '<pre><code class="language-js">');
    includes(markdownToXhtml("a < b"), "a &lt; b");
    includes(markdownToXhtml("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
  });

  await test("buildEpub: produces a zip with mimetype first and required parts", () => {
    const bytes = buildEpub([{ title: "One", markdown: "# One\n\nHello world." }], { title: "Book" });
    assert(bytes instanceof Uint8Array, "returns bytes");
    eq(bytes[0], 0x50);
    eq(bytes[1], 0x4b);
    eq(bytes[2], 0x03);
    eq(bytes[3], 0x04);
    const dv = new DataView(bytes.buffer);
    const nameLen = dv.getUint16(26, true);
    const firstName = new TextDecoder().decode(bytes.slice(30, 30 + nameLen));
    eq(firstName, "mimetype");
    const text = new TextDecoder().decode(bytes);
    includes(text, "OEBPS/content.opf");
    includes(text, "OEBPS/toc.ncx");
    includes(text, "chapter-1.xhtml");
    includes(escapeXml("<x>"), "&lt;x&gt;");
    eq(epubFileName("My Book!"), "my-book.epub");
  });

  /* ---------------- resume jobs ---------------- */

  await test("createJob + jobProgress + isResumable", () => {
    const job = createJob({ mode: "batch", items: [1, 2, 3, 4], done: [1, 2] });
    assert(job.id.startsWith("job-"), "has an id");
    eq(jobProgress(job).percent, 50);
    eq(isResumable(job), true);
    eq(isResumable({ ...job, status: "done" }), false);
    includes(jobSummary(job), "Batch");
  });

  await test("serialize/deserialize batch results round-trip the markdown", () => {
    const entry = {
      index: 0, status: "ok", item: { url: "https://e.test", host: "e.test", raw: "e.test", valid: true },
      value: { fetched: { host: "e.test", finalUrl: "https://e.test" }, doc: { title: "T", markdown: "# T\n\nbody", body: "# T\n\nbody", metadata: {}, stats: markdownStats("# T\n\nbody") }, cleanedBody: null }
    };
    const serialized = serializeBatchResults([entry]);
    eq(serialized[0].markdown, "# T\n\nbody");
    const back = deserializeBatchResults(serialized);
    eq(back[0].status, "ok");
    eq(back[0].value.doc.markdown, "# T\n\nbody");
  });

  await test("serialize/deserialize crawl pages round-trip", () => {
    const pages = [{ url: "https://e.test/a", finalUrl: "https://e.test/a", host: "e.test", title: "A", markdown: "hello", depth: 0, parent: null, status: "ok", doc: { metadata: { site: "E" } } }];
    const back = deserializeCrawlPages(serializeCrawlPages(pages));
    eq(back.length, 1);
    eq(back[0].markdown, "hello");
    eq(back[0].doc.metadata.site, "E");
  });

  await test("createJobStore: persists one current job", async () => {
    const store = createJobStore(fakeFolder());
    eq(await store.get(), null);
    await store.save(createJob({ mode: "crawl", start: "https://e.test" }));
    const got = await store.get();
    eq(got.mode, "crawl");
    await store.clear();
    eq(await store.get(), null);
  });

  /* ---------------- launcher / bookmarklet ---------------- */

  await test("detectInput: routes URLs, generators and lists", () => {
    eq(detectInput("example.com/a").kind, "url");
    eq(detectInput("cozy-forest-quest").kind, "generator");
    eq(detectInput("https://perchance.org/foo").name, "foo");
    eq(detectInput("a.com\nb.com").kind, "urls");
    eq(detectInput("a.com\nb.com").count, 2);
    eq(detectInput("").kind, "empty");
  });

  await test("encodeLaunch/decodeLaunch round-trips unicode", () => {
    const payload = { kind: "url", value: "https://e.test/héllo—世界" };
    eq(decodeLaunch(encodeLaunch(payload)).value, payload.value);
  });

  await test("parseLaunchHash: base64, URI-encoded JSON and plain value", () => {
    eq(parseLaunchHash("#extrax=" + encodeLaunch({ kind: "url", value: "https://x.test" })).value, "https://x.test");
    eq(parseLaunchHash("#extrax=" + encodeURIComponent(JSON.stringify({ kind: "generator", value: "foo" }))).kind, "generator");
    eq(parseLaunchHash("#extrax=" + encodeURIComponent("https://plain.test")).value, "https://plain.test");
    eq(parseLaunchHash(""), null);
  });

  await test("launchUrl + bookmarklet embed the hash", () => {
    includes(launchUrl("foo", { kind: "url", value: "u" }), "https://perchance.org/foo#extrax=");
    includes(bookmarkletCode("foo"), "https://perchance.org/foo#extrax=");
    includes(bookmarkletCode("foo"), "location.href");
    eq(payloadForInput("https://example.com").kind, "url");
  });

  const passed = results.filter(r => r.pass).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}

export function summarize(result) {
  return `${result.passed}/${result.total} passed` + (result.failed ? ` — ${result.failed} failed` : "");
}
