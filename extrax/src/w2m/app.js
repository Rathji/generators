import { fetchDocument, formatBytes } from "./fetcher.js";
import { extractContent } from "./extract.js";
import { convertHtmlToMarkdown } from "./convert.js";
import { extractMetadata, formatFrontmatter } from "./metadata.js";
import { buildDocument } from "./document.js";
import { markdownStats } from "./stats.js";
import { createDocStore, createDocRecord, docFilename, uniqueFilename, matchDoc, normalizeTag } from "./library.js";
import { W2MError, describeError } from "./errors.js";
import { limitsFor, limitOptions, truncationSummary } from "./truncate.js";
import { parseUrlList, runBatch, combineDocuments, stripFrontmatter } from "./batch.js";
import { crawlSite, crawlTree, crawlFilePaths, crawlManifest, crawlFilePath, createZip, normalizeCrawlUrl, crawlKey } from "./crawl.js";
import { buildExportFiles } from "./exports.js";
import { analyzeQuality, qualitySummary, qualityDelta, MESSY_THRESHOLD } from "./quality.js";
import { cleanupPresets, presetByKey, buildCleanupPrompt, normalizeCleanupOutput, runCleanup, fitToBudget, applyBody } from "./cleanup.js";
import { docsToJson, docsFromJson, docsToMarkdown, parseDocsMarkdown, makeImportedRecord } from "./docexport.js";
import { tablesFromHtml, tableFiles, tablesSummary, buildSchemaPrompt, parseSchemaOutput, defaultSchema } from "./structured.js";
import { inventoryFromHtml, inventorySummary, inventoryFiles, inventoryImageLinks } from "./inventory.js";
import { diffLines, changeSummary, diffToMarkdown, diffStats, createWatchRecord, createWatchStore, watchSummary } from "./watch.js";
import { buildContextBundle, bundleFileName, runAsk } from "./llmcontext.js";
import { buildEpub, epubFileName } from "./epub.js";
import { createJob, createJobStore, isResumable, jobProgress, jobSummary, serializeBatchResults, deserializeBatchResults, serializeCrawlPages, deserializeCrawlPages } from "./jobs.js";
import { parseLaunchHash, detectInput, bookmarkletCode } from "./launcher.js";
import { openModal, closeModal, el } from "../ui/modal.js";
import { runTests, summarize } from "./tests.js";

const $ = id => document.getElementById(id);

let lastCapture = null;
let docStore = null;
let docRecords = [];
let batchRun = null;
let cleanState = null;
let watchStore = null;
let jobStore = null;
let watchRecords = [];
let askState = null;

function getWatchStore() {
  if (!watchStore) watchStore = createWatchStore(window.root.kv.extraxWatch);
  return watchStore;
}

function getJobStore() {
  if (!jobStore) jobStore = createJobStore(window.root.kv.extraxJobs);
  return jobStore;
}


function getDocStore() {
  if (!docStore) docStore = createDocStore(window.root.kv.extraxDocs);
  return docStore;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function errorInfo(err) {
  const e = typeof err === "string" ? new W2MError(err) : err;
  return describeError(e);
}

function statsRow(label, value) {
  const wrap = document.createElement("span");
  wrap.className = "stat";
  const l = document.createElement("em");
  l.textContent = label + " ";
  const v = document.createElement("b");
  v.textContent = value;
  wrap.append(l, v);
  return wrap;
}

function showProgress(html, isError) {
  const box = $("w2mProgress");
  box.classList.toggle("err", !!isError);
  box.innerHTML = (isError ? "" : '<div class="spin"></div>') + `<div>${html}</div>`;
  box.hidden = false;
}

function hideProgress() {
  $("w2mProgress").hidden = true;
}

function setBusy(busy) {
  const btn = $("w2mCaptureBtn");
  btn.disabled = busy;
  btn.textContent = busy ? "Capturing…" : "Capture page";
}

function truncationWarning(doc) {
  if (!doc || !doc.truncation || !doc.truncation.any) return "";
  return "Large page: " + truncationSummary(doc.truncation) + ". Raise the size cap to capture more.";
}

const PREVIEW_CAP = 200000;

function previewText(text) {
  const value = String(text == null ? "" : text);
  if (value.length <= PREVIEW_CAP) return value;
  return value.slice(0, PREVIEW_CAP) + "\n\n… preview truncated at " + PREVIEW_CAP.toLocaleString() + " characters — use Download .md for the complete file.";
}

function renderResult(fetched, doc) {
  const s = doc.stats;
  const meta = doc.metadata || {};

  $("w2mTitle").textContent = doc.title || fetched.host;

  const stats = $("w2mStats");
  stats.textContent = "";
  stats.append(
    statsRow("Source", formatBytes(fetched.bytes)),
    statsRow("Markdown", doc.markdown.length.toLocaleString() + " chars"),
    statsRow("Readable text", s.contentChars.toLocaleString() + " chars"),
    statsRow("Chrome removed", s.removedNodes.toLocaleString() + " nodes"),
    statsRow("Status", "HTTP " + fetched.status),
    statsRow("Fetched in", fetched.elapsedMs + " ms")
  );
  if (meta.author) stats.append(statsRow("Author", meta.author));
  if (meta.published) stats.append(statsRow("Published", meta.published));
  if (meta.site) stats.append(statsRow("Site", meta.site));
  if (doc.truncation && doc.truncation.any) stats.append(statsRow("Truncated", truncationSummary(doc.truncation)));

  const warn = $("w2mTruncWarn");
  const warning = truncationWarning(doc);
  warn.textContent = warning;
  warn.hidden = !warning;

  const md = markdownStats(doc.markdown);
  $("w2mMdStats").textContent =
    md.words.toLocaleString() + " words · " +
    md.characters.toLocaleString() + " chars · " +
    md.lines.toLocaleString() + " lines · ~" +
    md.readingMinutes.toLocaleString() + " min read";

  const link = $("w2mSourceLink");
  link.href = fetched.finalUrl;
  link.textContent = fetched.finalUrl;

  $("w2mMdOut").textContent = previewText(doc.markdown);
  $("w2mSourcePre").textContent = previewText(doc.extracted.contentHtml);
  $("w2mResult").hidden = false;
}

function currentOptions() {
  return {
    includeImages: $("w2mOptImages").checked,
    includeFrontmatter: $("w2mOptFrontmatter").checked,
    linkMode: $("w2mOptLinkMode").value,
    limitPreset: $("w2mOptLimit").value
  };
}

function applyOptions() {
  if (lastCapture) {
    let doc = buildDocument(lastCapture.fetched.html, {
      url: lastCapture.fetched.finalUrl,
      ...currentOptions()
    });
    if (cleanState) {
      cleanState.baseDoc = doc;
      cleanState.originalQuality = analyzeQuality(doc, { html: lastCapture.fetched.html });
      if (lastCapture.cleanedBody != null) doc = applyBody(doc, lastCapture.cleanedBody);
    }
    lastCapture.doc = doc;
    renderResult(lastCapture.fetched, doc);
    renderQuality();
  }
  rebuildBatchDocs();
}

function renderError(err) {
  const info = describeError(err);
  console.error("Web-to-Markdown capture failed:", err);
  const box = $("w2mError");
  box.textContent = "";
  const h = document.createElement("div");
  h.className = "errtitle";
  h.textContent = info.title + (info.detail ? " — " + info.detail : "");
  const p = document.createElement("div");
  p.className = "errdetail";
  p.textContent = info.hint;
  box.append(h, p);
  box.hidden = false;
}

function clearResult() {
  $("w2mResult").hidden = true;
  $("w2mError").hidden = true;
  $("w2mTruncWarn").hidden = true;
}

async function capturePage() {
  const input = $("w2mUrlInput").value;
  clearResult();
  setBusy(true);
  showProgress("Fetching the page…");

  try {
    const limits = limitsFor(currentOptions());
    const fetched = await fetchDocument(input, { fetchImpl: window.root.superFetch, maxBytes: limits.maxBytes });
    showProgress("Extracting content and converting to Markdown…");
    await new Promise(r => setTimeout(r, 0));

    const doc = buildDocument(fetched.html, { url: fetched.finalUrl, ...currentOptions() });
    lastCapture = { fetched, doc, at: Date.now() };
    resetCleanState(fetched, doc);
    renderResult(fetched, doc);
    renderQuality();
    const warning = truncationWarning(doc);
    showProgress(`Captured <b>${esc(doc.title || fetched.host)}</b> — ${formatBytes(fetched.bytes)} of HTML turned into ${doc.markdown.length.toLocaleString()} characters of Markdown.` + (warning ? ` <em>${esc(warning)}</em>` : ""));
  } catch (err) {
    renderError(err);
    hideProgress();
  } finally {
    setBusy(false);
  }
}

/* ---------------- AI cleanup ---------------- */

function resetCleanState(fetched, doc) {
  cleanState = {
    fetched,
    baseDoc: doc,
    originalDoc: doc,
    originalBody: doc.body,
    originalStats: markdownStats(doc.body),
    originalQuality: analyzeQuality(doc, { html: fetched ? fetched.html : "" }),
    currentQuality: null,
    revisions: [],
    pendingId: null,
    activeId: null,
    running: false,
    pending: null
  };
  lastCapture.cleanedBody = null;
  $("w2mCleanReview").hidden = true;
  $("w2mCleanStatus").hidden = true;
  $("w2mCleanFeedback").value = "";
}

function showCleanStatus(html, isError) {
  const box = $("w2mCleanStatus");
  box.classList.toggle("err", !!isError);
  box.innerHTML = (isError ? "" : '<div class="spin"></div>') + `<div>${html}</div>`;
  box.hidden = false;
}

function hideCleanStatus() {
  $("w2mCleanStatus").hidden = true;
}

function activeRevision() {
  if (!cleanState) return null;
  return cleanState.revisions.find(r => r.id === cleanState.activeId) || null;
}

function pendingRevision() {
  if (!cleanState) return null;
  return cleanState.revisions.find(r => r.id === cleanState.pendingId) || null;
}

function renderQuality() {
  const box = $("w2mAi");
  if (!cleanState || !lastCapture) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const q = analyzeQuality(lastCapture.doc, { html: cleanState.fetched ? cleanState.fetched.html : "" });
  cleanState.currentQuality = q;

  const badge = $("w2mQuality");
  badge.textContent = q.label + " · " + q.score + "/100";
  badge.className = "qbadge q-" + q.tone;

  const accepted = activeRevision();
  const note = $("w2mQualityNote");
  if (accepted) {
    const d = qualityDelta(cleanState.originalQuality, q);
    note.textContent = "AI cleanup applied" + (d && d.improvement > 0 ? " — issues score dropped by " + d.improvement : "") + ".";
  } else if (q.messy) {
    note.textContent = "The automatic extraction looks messy — an AI cleanup pass can help.";
  } else if (q.signals.length) {
    note.textContent = "A few issues detected, but the text is usable as-is.";
  } else {
    note.textContent = "The extracted Markdown looks clean.";
  }

  const sig = $("w2mQualitySignals");
  sig.textContent = "";
  for (const s of q.signals) {
    const el = document.createElement("span");
    el.className = "signal";
    el.innerHTML = "<b>" + esc(s.label) + "</b> — " + esc(s.detail);
    sig.appendChild(el);
  }
  $("w2mCleanChip").hidden = !accepted;
}

function renderRevisionBar() {
  const bar = $("w2mRevBar");
  if (!cleanState || !cleanState.revisions.length) {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  bar.hidden = false;
  const chips = cleanState.revisions.map((r, i) => {
    const cls = "revchip" + (r.id === cleanState.pendingId ? " active" : "") + (r.id === cleanState.activeId ? " accepted" : "");
    return `<button class="${cls}" data-rev="${esc(r.id)}" title="${esc(r.preset)}">v${i + 1}</button>`;
  });
  chips.push('<button class="revchip" data-rev="__original" title="The original extraction">Original</button>');
  bar.innerHTML = chips.join("");
}

function renderCleanReview() {
  const review = $("w2mCleanReview");
  const rev = pendingRevision();
  if (!rev) {
    review.hidden = true;
    renderRevisionBar();
    return;
  }
  review.hidden = false;
  $("w2mCleanOut").textContent = previewText(rev.text);
  const st = markdownStats(rev.text);
  $("w2mCleanOutStats").textContent =
    st.words.toLocaleString() + " words · " + st.characters.toLocaleString() + " chars · ~" + st.readingMinutes.toLocaleString() + " min read";
  const before = cleanState.originalStats || markdownStats(cleanState.originalBody);
  const delta = st.words - before.words;
  $("w2mCleanDelta").textContent =
    "v" + (cleanState.revisions.indexOf(rev) + 1) +
    " · " + (delta >= 0 ? "+" : "") + delta.toLocaleString() + " words vs original" +
    (rev.feedback ? " · feedback: “" + rev.feedback + "”" : "");
  const accept = $("w2mCleanAccept");
  accept.disabled = rev.id === cleanState.activeId;
  accept.textContent = rev.id === cleanState.activeId ? "Applied" : "Use this version";
  renderRevisionBar();
}

function setCleanBusy(busy) {
  const btn = $("w2mCleanBtn");
  btn.disabled = busy;
  btn.textContent = busy ? "Cleaning…" : "Clean up with AI";
  $("w2mCleanStopBtn").hidden = !busy;
  $("w2mCleanPreset").disabled = busy;
  $("w2mCleanPrompt").disabled = busy;
  $("w2mCleanAccept").disabled = busy;
  $("w2mCleanReject").disabled = busy;
  $("w2mCleanCopy").disabled = busy;
  $("w2mCleanDownload").disabled = busy;
  $("w2mCleanRefine").disabled = busy;
  $("w2mCleanFeedback").disabled = busy;
}

function fitBodyToBudget(body) {
  try {
    const meta = window.root && window.root.generateText ? window.root.generateText({ getMetaObject: true }) : null;
    if (meta && typeof meta.countTokens === "function") {
      const room = Math.max(400, (meta.idealMaxContextTokens || 6000) - 1400);
      const fitted = fitToBudget(body, meta.countTokens, room);
      return { body: fitted.text, truncated: fitted.truncated };
    }
  } catch (err) {
    /* budgeting is best-effort */
  }
  return { body, truncated: false };
}

async function startCleanup(options = {}) {
  if (!cleanState || cleanState.running || !lastCapture) return;
  if (!window.root || typeof window.root.generateText !== "function") {
    showCleanStatus("AI text generation isn't available on this page.", true);
    return;
  }
  const preset = options.preset || $("w2mCleanPreset").value;
  const custom = $("w2mCleanPrompt").value;
  const feedback = options.feedback != null ? options.feedback : "";
  const revisions = cleanState.revisions.map(r => ({ text: r.text, preset: r.preset, feedback: r.feedback }));

  cleanState.running = true;
  cleanState.cancelled = false;
  setCleanBusy(true);
  $("w2mCleanReview").hidden = false;
  $("w2mRevBar").hidden = true;
  const stream = $("w2mCleanOut");
  stream.textContent = "";
  $("w2mCleanOutStats").textContent = "";
  showCleanStatus(feedback ? "Applying your feedback to the Markdown…" : "Asking the AI to clean up the Markdown…");

  const fitted = fitBodyToBudget(cleanState.originalBody);
  const source = {
    title: cleanState.originalDoc.title,
    url: cleanState.fetched ? cleanState.fetched.finalUrl : "",
    body: fitted.body
  };

  try {
    const result = await runCleanup({
      source,
      preset,
      custom,
      feedback,
      revisions,
      generateText: window.root.generateText,
      onChunk: data => {
        const text = data && data.fullTextSoFar != null ? data.fullTextSoFar : (data && data.textChunk) || "";
        stream.textContent = previewText(text);
      },
      onPending: p => { cleanState.pending = p; }
    });
    if (cleanState.cancelled) {
      hideCleanStatus();
      $("w2mCleanReview").hidden = true;
      showCleanStatus("Cleanup stopped.");
      return;
    }
    const rev = {
      id: "rev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      text: result.text,
      preset,
      feedback,
      createdAt: Date.now()
    };
    cleanState.revisions.push(rev);
    cleanState.pendingId = rev.id;
    renderCleanReview();
    showCleanStatus("Revision ready — review it below, then use it or discard it." + (fitted.truncated ? " The document was truncated to fit the model context." : ""));
  } catch (err) {
    if (cleanState.cancelled) {
      hideCleanStatus();
      $("w2mCleanReview").hidden = true;
      showCleanStatus("Cleanup stopped.");
      return;
    }
    console.error("AI cleanup failed:", err);
    $("w2mCleanReview").hidden = true;
    showCleanStatus("AI cleanup failed: " + esc((err && err.message) || err), true);
  } finally {
    cleanState.running = false;
    cleanState.pending = null;
    setCleanBusy(false);
  }
}

function stopCleanup() {
  if (!cleanState || !cleanState.running) return;
  cleanState.cancelled = true;
  if (cleanState.pending && typeof cleanState.pending.stop === "function") cleanState.pending.stop();
  showCleanStatus("Stopping…");
}

function acceptCleanup() {
  const rev = pendingRevision();
  if (!rev || !lastCapture || !cleanState) return;
  cleanState.activeId = rev.id;
  lastCapture.cleanedBody = rev.text;
  const doc = applyBody(cleanState.baseDoc, rev.text);
  lastCapture.doc = doc;
  renderResult(lastCapture.fetched, doc);
  renderQuality();
  renderCleanReview();
  showCleanStatus("Applied — the preview, copy, download and library actions now use the cleaned version.");
}

function rejectCleanup() {
  if (!cleanState) return;
  const id = cleanState.pendingId;
  cleanState.revisions = cleanState.revisions.filter(r => r.id !== id);
  cleanState.pendingId = null;
  hideCleanStatus();
  if (!cleanState.revisions.length) $("w2mCleanReview").hidden = true;
  renderCleanReview();
}

function revertCleanup() {
  if (!cleanState || !lastCapture) return;
  cleanState.activeId = null;
  cleanState.pendingId = null;
  lastCapture.cleanedBody = null;
  lastCapture.doc = cleanState.baseDoc;
  renderResult(lastCapture.fetched, lastCapture.doc);
  renderQuality();
  renderCleanReview();
  showCleanStatus("Reverted to the original extraction.");
}

async function copyCleanup() {
  const rev = pendingRevision();
  if (!rev) return;
  const btn = $("w2mCleanCopy");
  try {
    await copyText(rev.text);
    flashBtn(btn, "Copied!");
  } catch (err) {
    console.error("Copy failed:", err);
    flashBtn(btn, "Copy failed");
  }
}

function downloadCleanup() {
  const rev = pendingRevision();
  if (!rev || !cleanState) return;
  const doc = cleanState.originalDoc;
  const site = doc.metadata && doc.metadata.site;
  const base = docFilename({ title: doc.title, site, createdAt: Date.now() }).replace(/\.md$/i, "");
  const full = doc.frontmatter ? doc.frontmatter + "\n\n" + rev.text : rev.text;
  downloadText(base + "-cleaned.md", full, "text/markdown;charset=utf-8");
}

function updateCleanHint() {
  const preset = presetByKey($("w2mCleanPreset").value);
  $("w2mCleanHint").textContent = preset.hint;
  if (preset.key === "custom") $("w2mCleanPrompt").focus();
}

function cleanBatchItem(index) {
  if (!batchRun || batchRun.running) return;
  const entry = batchRun.results.find(r => r.index === index);
  const item = batchRun.items[index];
  if (!entry || entry.status !== "ok" || !entry.value || !item) return;
  if (!window.root || typeof window.root.generateText !== "function") {
    showBatchProgress("AI text generation isn't available on this page.", true);
    return;
  }

  batchRun.running = true;
  setBatchBusy(true, { stop: false });
  showBatchProgress(`Cleaning <b>${esc(item.host || item.raw)}</b> with AI…`);
  const cell = document.querySelector('#w2mBatchList .batchrow[data-index="' + index + '"] .bClean');
  if (cell) { cell.disabled = true; cell.textContent = "Cleaning…"; }

  const fitted = fitBodyToBudget(entry.value.doc.body);
  runCleanup({
    source: { title: entry.value.doc.title, url: entry.value.fetched.finalUrl, body: fitted.body },
    preset: $("w2mCleanPreset").value,
    custom: $("w2mCleanPrompt").value,
    generateText: window.root.generateText
  }).then(result => {
    entry.value.cleanedBody = result.text;
    entry.value.doc = applyBody(entry.value.baseDoc || entry.value.doc, result.text);
    entry.value.quality = analyzeQuality(entry.value.doc, { html: entry.value.fetched.html });
    renderBatchList();
    renderBatchCombined();
    const q = entry.value.quality;
    showBatchProgress(`Cleaned <b>${esc(item.host || item.raw)}</b> — quality ${q.label} (${q.score}/100).`);
  }).catch(err => {
    console.error("Batch AI cleanup failed:", err);
    showBatchProgress("AI cleanup failed: " + esc((err && err.message) || err), true);
    renderBatchList();
  }).finally(() => {
    batchRun.running = false;
    setBatchBusy(false);
  });
}

function initCleanup() {
  const select = $("w2mCleanPreset");
  for (const preset of cleanupPresets()) {
    const opt = document.createElement("option");
    opt.value = preset.key;
    opt.textContent = preset.label;
    select.appendChild(opt);
  }
  select.value = "tidy";
  select.addEventListener("change", updateCleanHint);
  updateCleanHint();

  $("w2mCleanBtn").addEventListener("click", () => startCleanup());
  $("w2mCleanStopBtn").addEventListener("click", stopCleanup);
  $("w2mCleanAccept").addEventListener("click", acceptCleanup);
  $("w2mCleanReject").addEventListener("click", rejectCleanup);
  $("w2mCleanCopy").addEventListener("click", copyCleanup);
  $("w2mCleanDownload").addEventListener("click", downloadCleanup);
  $("w2mCleanRefine").addEventListener("click", () => {
    const fb = $("w2mCleanFeedback").value.trim();
    if (!fb) { $("w2mCleanFeedback").focus(); return; }
    $("w2mCleanFeedback").value = "";
    startCleanup({ feedback: fb });
  });
  $("w2mCleanFeedback").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); $("w2mCleanRefine").click(); }
  });
  $("w2mRevBar").addEventListener("click", e => {
    const chip = e.target.closest("[data-rev]");
    if (!chip || !cleanState) return;
    if (chip.dataset.rev === "__original") { revertCleanup(); return; }
    cleanState.pendingId = chip.dataset.rev;
    renderCleanReview();
    renderQuality();
  });
}

/* ---------------- batch mode ---------------- */

function showBatchProgress(html, isError) {
  const box = $("w2mBatchProgress");
  box.classList.toggle("err", !!isError);
  box.innerHTML = (isError ? "" : '<div class="spin"></div>') + `<div>${html}</div>`;
  box.hidden = false;
}

function hideBatchProgress() {
  $("w2mBatchProgress").hidden = true;
}

function batchEntriesByIndex() {
  const map = new Map();
  if (!batchRun) return map;
  for (const entry of batchRun.results) map.set(entry.index, entry);
  return map;
}

function entryQuality(entry) {
  if (!entry || !entry.value || !entry.value.doc) return null;
  if (!entry.value.quality) {
    entry.value.quality = analyzeQuality(entry.value.doc, { html: entry.value.fetched ? entry.value.fetched.html : "" });
  }
  return entry.value.quality;
}

function batchRowHTML(item, entry, index) {
  const status = entry ? (entry.invalid ? "invalid" : entry.status) : (item.valid ? "queued" : "invalid");
  const labels = { queued: "Queued", ok: "Done", error: "Failed", skipped: "Cancelled", invalid: "Invalid" };
  const icons = { queued: "•", ok: "✓", error: "✕", skipped: "–", invalid: "!" };
  const label = labels[status] || status;
  const canRemove = !(batchRun && batchRun.running);
  const removeBtn = canRemove ? '<button class="bRemove">Remove</button>' : "";
  const parts = [];
  const target = item.host && item.host !== item.raw ? item.host : item.raw;

  parts.push(`<div class="batchrow s-${status}" data-index="${index}">`);
  parts.push(`<div class="browhead"><span class="bstatus">${icons[status] || "•"}</span><span class="bindex">${index + 1}</span><span class="btarget">${esc(target)}</span><span class="bstate">${esc(label)}</span></div>`);

  if (item.host && item.host !== item.raw) {
    parts.push(`<div class="burl">${esc(item.url)}</div>`);
  }

  if (status === "ok" && entry.value) {
    const { doc, fetched } = entry.value;
    const md = markdownStats(doc.markdown);
    const q = entryQuality(entry);
    const cleaned = entry.value.cleanedBody != null;
    parts.push(`<div class="browtitle">${esc(doc.title || fetched.host)}</div>`);
    parts.push(`<div class="browmeta">${md.words.toLocaleString()} words · ${doc.markdown.length.toLocaleString()} chars${doc.truncation && doc.truncation.any ? " · truncated" : ""}${cleaned ? ' · <span class="bq q-ok">AI-cleaned</span>' : (q && q.signals.length ? ' · <span class="bq q-' + q.tone + '">' + esc(q.label) + " " + q.score + "</span>" : "")}${item.label ? " · " + esc(item.label) : ""}</div>`);
    parts.push(`<div class="browactions"><button class="bClean">${cleaned ? "Re-clean" : "Clean with AI"}</button><button class="bCopy">Copy</button><button class="bDownload">Download .md</button><button class="bSave">Save</button>${removeBtn}</div>`);
    parts.push(`<details class="srcbox bpreview"><summary>Preview</summary><pre></pre></details>`);
  } else if (status === "error" || status === "invalid") {
    const info = errorInfo(status === "invalid" ? item.error : entry.error);
    parts.push(`<div class="browmeta errline">${esc(info.title)}${info.detail ? " — " + esc(info.detail) : ""}</div>`);
    parts.push(`<div class="browhint">${esc(info.hint)}</div>`);
    const actions = [];
    if (status === "error") actions.push('<button class="bRetry">Retry</button>');
    if (removeBtn) actions.push(removeBtn);
    if (actions.length) parts.push(`<div class="browactions">${actions.join("")}</div>`);
  } else if (status === "skipped") {
    parts.push(`<div class="browmeta">Stopped before it was fetched.</div>`);
    if (removeBtn) parts.push(`<div class="browactions">${removeBtn}</div>`);
  } else {
    parts.push(`<div class="browmeta subtle">Waiting in the queue…</div>`);
    if (removeBtn) parts.push(`<div class="browactions">${removeBtn}</div>`);
  }

  parts.push(`</div>`);
  return parts.join("");
}

function renderBatchList() {
  const list = $("w2mBatchList");
  if (!batchRun || !batchRun.items.length) {
    list.innerHTML = "";
    return;
  }
  const entries = batchEntriesByIndex();
  list.innerHTML = batchRun.items.map((item, i) => batchRowHTML(item, entries.get(i), i)).join("");
}

function updateBatchRow(index) {
  const list = $("w2mBatchList");
  if (!batchRun || !list.children[index]) {
    renderBatchList();
    return;
  }
  const entry = batchRun.results.find(r => r.index === index);
  list.children[index].outerHTML = batchRowHTML(batchRun.items[index], entry, index);
}

function fillBatchPreview(detailsEl) {
  const pre = detailsEl.querySelector("pre");
  if (!pre || pre.dataset.filled) return;
  const row = detailsEl.closest(".batchrow");
  if (!row || !batchRun) return;
  const entry = batchRun.results.find(r => r.index === Number(row.dataset.index));
  if (!entry || entry.status !== "ok" || !entry.value) return;
  pre.textContent = previewText(entry.value.doc.markdown);
  pre.dataset.filled = "1";
}

function setBatchBusy(busy, options = {}) {
  if (batchRun) batchRun.running = busy;
  const btn = $("w2mBatchBtn");
  btn.disabled = busy || validBatchCount() === 0;
  btn.textContent = busy ? "Processing…" : "Process all";
  $("w2mBatchStopBtn").hidden = !busy || options.stop === false;
  $("w2mBatchInput").readOnly = busy;
}

function validBatchCount() {
  return parseUrlList($("w2mBatchInput").value).filter(i => i.valid).length;
}

function updateBatchCount() {
  const items = parseUrlList($("w2mBatchInput").value);
  const valid = items.filter(i => i.valid).length;
  const bad = items.length - valid;
  const el = $("w2mBatchCount");
  el.textContent = items.length === 0
    ? "No URLs yet"
    : items.length + " URL" + (items.length === 1 ? "" : "s") + (bad ? " · " + bad + " invalid" : "");
  el.classList.toggle("bad", bad > 0 && valid === 0);
  const running = !!(batchRun && batchRun.running);
  $("w2mBatchBtn").disabled = running || valid === 0;
}

async function processBatchItem(item) {
  const opts = currentOptions();
  const limits = limitsFor(opts);
  const fetched = await fetchDocument(item.url, { fetchImpl: window.root.superFetch, maxBytes: limits.maxBytes });
  const doc = buildDocument(fetched.html, { url: fetched.finalUrl, ...opts });
  return { fetched, doc, baseDoc: doc, cleanedBody: null, quality: null };
}

async function startBatch() {
  if (batchRun && batchRun.running) return;
  const items = parseUrlList($("w2mBatchInput").value);
  const valid = items.filter(i => i.valid).length;
  if (!valid) {
    showBatchProgress("Add at least one valid web address first.", true);
    return;
  }

  batchRun = { items, results: [], running: true, stop: false, combined: null, startedAt: Date.now(), jobId: null };
  $("w2mBatchResult").hidden = true;
  setBatchBusy(true);
  renderBatchList();
  showBatchProgress(`Queued <b>${items.length}</b> URL${items.length === 1 ? "" : "s"} (${valid} to fetch) — starting…`);
  await saveBatchJob("running");

  const outcome = await runBatch(items, {
    delayMs: 300,
    shouldStop: () => batchRun.stop,
    onStart: (item, index, total) => {
      showBatchProgress(`Fetching <b>${esc(item.host || item.raw)}</b> — ${index + 1} of ${total}…`);
    },
    onItem: entry => {
      batchRun.results.push(entry);
      updateBatchRow(entry.index);
      saveBatchJob();
    },
    process: processBatchItem
  });

  batchRun.outcome = outcome;
  setBatchBusy(false);
  renderBatchList();
  renderBatchCombined();
  await saveBatchJob(outcome.stopped ? "paused" : "done");
  if (!outcome.stopped) await clearJob();
  await showResumeBar();
  if (outcome.stopped) {
    showBatchProgress(`Stopped — captured <b>${outcome.ok}</b> of ${outcome.total}. Export what's ready below, or resume above.`);
  } else {
    showBatchProgress(`Captured <b>${outcome.ok}</b> of ${outcome.total} page${outcome.total === 1 ? "" : "s"}` + (outcome.failed ? `, <b>${outcome.failed}</b> failed` : "") + ".");
  }
}

async function retryBatchItem(index) {
  if (!batchRun || batchRun.running) return;
  const item = batchRun.items[index];
  if (!item) return;
  batchRun.results = batchRun.results.filter(r => r.index !== index);
  setBatchBusy(true, { stop: false });
  renderBatchList();
  showBatchProgress(`Retrying <b>${esc(item.host || item.raw)}</b>…`);

  let entry;
  try {
    entry = { item, index, status: "ok", value: await processBatchItem(item) };
  } catch (err) {
    entry = { item, index, status: "error", error: err };
  }
  batchRun.results.push(entry);
  setBatchBusy(false);
  renderBatchList();
  renderBatchCombined();
  const ok = batchRun.results.filter(r => r.status === "ok").length;
  showBatchProgress(`Retry finished — <b>${ok}</b> page${ok === 1 ? "" : "s"} ready.`);
}

function rebuildBatchDocs() {
  if (!batchRun) return;
  const opts = currentOptions();
  for (const entry of batchRun.results) {
    if (entry.status === "ok" && entry.value && entry.value.fetched) {
      const base = buildDocument(entry.value.fetched.html, { url: entry.value.fetched.finalUrl, ...opts });
      entry.value.baseDoc = base;
      entry.value.doc = entry.value.cleanedBody != null ? applyBody(base, entry.value.cleanedBody) : base;
      entry.value.quality = null;
    }
  }
  renderBatchList();
  renderBatchCombined();
}

function batchDocs() {
  if (!batchRun) return [];
  return batchRun.results
    .filter(r => r.status === "ok" && r.value)
    .map(r => ({
      title: r.value.doc.title,
      host: r.value.fetched.host,
      url: r.value.fetched.finalUrl,
      markdown: r.value.doc.markdown,
      doc: r.value.doc,
      fetched: r.value.fetched
    }));
}

function renderBatchCombined() {
  const result = $("w2mBatchResult");
  if (!batchRun) {
    result.hidden = true;
    return;
  }
  const docs = batchDocs();
  if (!docs.length) {
    result.hidden = true;
    batchRun.combined = null;
    return;
  }

  const opts = currentOptions();
  const combined = combineDocuments(docs, {
    title: "Combined capture — " + docs.length + " page" + (docs.length === 1 ? "" : "s"),
    includeToc: $("w2mBatchToc").checked,
    includeFrontmatter: opts.includeFrontmatter,
    createdAt: batchRun.startedAt
  });
  batchRun.combined = combined;

  $("w2mBatchMdOut").textContent = previewText(combined.markdown);
  const s = combined.stats;
  $("w2mBatchMdStats").textContent =
    docs.length + " doc" + (docs.length === 1 ? "" : "s") + " · " +
    s.words.toLocaleString() + " words · " +
    s.characters.toLocaleString() + " chars · ~" +
    s.readingMinutes.toLocaleString() + " min read";

  const truncated = docs.filter(d => d.doc.truncation && d.doc.truncation.any).length;
  const stats = $("w2mBatchStats");
  stats.textContent = "";
  stats.append(
    statsRow("Captured", docs.length + " of " + batchRun.items.length),
    statsRow("Combined", combined.markdown.length.toLocaleString() + " chars"),
    statsRow("Words", s.words.toLocaleString()),
    statsRow("Read time", "~" + s.readingMinutes.toLocaleString() + " min")
  );
  if (truncated) stats.append(statsRow("Truncated", truncated + " page" + (truncated === 1 ? "" : "s")));

  result.hidden = false;
}

function batchStamp() {
  const when = batchRun && batchRun.startedAt ? new Date(batchRun.startedAt) : new Date();
  return Number.isNaN(when.getTime()) ? new Date().toISOString().slice(0, 10) : when.toISOString().slice(0, 10);
}

async function downloadExportFiles(docs, options, btn) {
  const out = buildExportFiles(docs, options);
  if (!out.files.length) {
    if (btn) flashBtn(btn, "Nothing to save");
    return out;
  }
  const restore = btn ? btn.textContent : "";
  if (btn) btn.disabled = true;
  for (let i = 0; i < out.files.length; i++) {
    const file = out.files[i];
    if (btn) btn.textContent = out.files.length > 1 ? "Saving " + (i + 1) + "/" + out.files.length + "…" : "Saving…";
    downloadText(file.name, file.text, file.mime);
    if (i < out.files.length - 1) await new Promise(r => setTimeout(r, 400));
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = restore;
    flashBtn(btn, out.files.length > 1 ? "Saved " + out.files.length + " files!" : "Saved!");
  }
  return out;
}

function batchSaveAllFiles() {
  if (!batchRun) return;
  const docs = batchDocs();
  const stamp = batchStamp();
  return downloadExportFiles(docs, {
    format: $("w2mBatchFormat").value,
    individual: $("w2mBatchEach").checked,
    baseName: "combined-capture-" + stamp,
    title: "Combined capture — " + docs.length + " page" + (docs.length === 1 ? "" : "s"),
    includeToc: $("w2mBatchToc").checked,
    includeFrontmatter: currentOptions().includeFrontmatter,
    createdAt: batchRun.startedAt,
    docOptions: currentOptions()
  }, $("w2mBatchSaveAllBtn"));
}

function removeBatchItem(index) {
  if (!batchRun || batchRun.running) return;
  if (!(index >= 0) || index >= batchRun.items.length) return;
  const item = batchRun.items[index];
  batchRun.items.splice(index, 1);
  batchRun.results = batchRun.results
    .filter(r => r.index !== index)
    .map(r => (r.index > index ? { ...r, index: r.index - 1 } : r));
  dropBatchLine(item);
  renderBatchList();
  renderBatchCombined();
  const ok = batchRun.results.filter(r => r.status === "ok").length;
  showBatchProgress(`Removed a page — <b>${ok}</b> ready to export.`);
}

function dropBatchLine(item) {
  const raw = String((item && item.raw) || "").trim();
  if (!raw) return;
  const ta = $("w2mBatchInput");
  const lines = ta.value.split(/\r?\n/);
  const idx = lines.findIndex(line => line.trim() === raw);
  if (idx === -1) return;
  lines.splice(idx, 1);
  ta.value = lines.join("\n");
  updateBatchCount();
}

async function batchCopyCombined() {
  const combined = batchRun && batchRun.combined;
  if (!combined) return;
  const btn = $("w2mBatchCopyBtn");
  try {
    await copyText(combined.markdown);
    flashBtn(btn, "Copied!");
  } catch (err) {
    console.error("Copy failed:", err);
    flashBtn(btn, "Copy failed");
  }
}

async function batchSaveAll() {
  const docs = batchDocs();
  if (!docs.length) return;
  const btn = $("w2mBatchSaveBtn");
  btn.disabled = true;
  let saved = 0;
  for (const d of docs) {
    const rec = createDocRecord({
      title: d.title,
      url: d.url,
      site: (d.doc.metadata && d.doc.metadata.site) || d.host,
      author: d.doc.metadata && d.doc.metadata.author,
      published: d.doc.metadata && d.doc.metadata.published,
      markdown: d.markdown,
      stats: markdownStats(d.markdown),
      options: currentOptions()
    });
    try {
      await getDocStore().save(rec);
      docRecords.unshift(rec);
      saved++;
    } catch (err) {
      console.error("Save failed:", err);
    }
  }
  renderDocLibrary();
  btn.disabled = false;
  flashBtn(btn, saved ? `Saved ${saved}!` : "Save failed");
}

function handleBatchListClick(e) {
  const row = e.target.closest(".batchrow");
  if (!row || !batchRun) return;
  const index = Number(row.dataset.index);
  const entry = batchRun.results.find(r => r.index === index);
  const item = batchRun.items[index];
  if (!item) return;

  if (e.target.closest(".bRetry")) {
    retryBatchItem(index);
    return;
  }
  if (e.target.closest(".bRemove")) {
    removeBatchItem(index);
    return;
  }
  if (e.target.closest(".bClean")) {
    cleanBatchItem(index);
    return;
  }
  if (!entry || entry.status !== "ok" || !entry.value) return;
  const { doc, fetched } = entry.value;

  if (e.target.closest(".bCopy")) {
    const btn = e.target.closest(".bCopy");
    copyText(doc.markdown).then(() => flashBtn(btn, "Copied!")).catch(err => { console.error(err); flashBtn(btn, "Copy failed"); });
  } else if (e.target.closest(".bDownload")) {
    const rec = createDocRecord({ title: doc.title, site: fetched.host, url: fetched.finalUrl, markdown: doc.markdown });
    downloadText(docFilename(rec), doc.markdown, "text/markdown;charset=utf-8");
  } else if (e.target.closest(".bSave")) {
    const btn = e.target.closest(".bSave");
    const rec = createDocRecord({
      title: doc.title, url: fetched.finalUrl, site: (doc.metadata && doc.metadata.site) || fetched.host,
      author: doc.metadata && doc.metadata.author, published: doc.metadata && doc.metadata.published,
      markdown: doc.markdown, stats: markdownStats(doc.markdown), options: currentOptions()
    });
    btn.disabled = true;
    getDocStore().save(rec).then(() => {
      docRecords.unshift(rec);
      renderDocLibrary();
      flashBtn(btn, "Saved!");
    }).catch(err => { console.error(err); flashBtn(btn, "Save failed"); });
  }
}

function setMode(mode) {
  const single = mode === "single";
  const batch = mode === "batch";
  const crawl = mode === "crawl";
  const watch = mode === "watch";
  $("w2mModeSingle").classList.toggle("active", single);
  $("w2mModeBatch").classList.toggle("active", batch);
  $("w2mModeCrawl").classList.toggle("active", crawl);
  $("w2mModeWatch").classList.toggle("active", watch);
  $("w2mModeSingle").setAttribute("aria-selected", String(single));
  $("w2mModeBatch").setAttribute("aria-selected", String(batch));
  $("w2mModeCrawl").setAttribute("aria-selected", String(crawl));
  $("w2mModeWatch").setAttribute("aria-selected", String(watch));
  $("w2mSingleBox").hidden = !single;
  $("w2mBatchBox").hidden = !batch;
  $("w2mCrawlBox").hidden = !crawl;
  $("w2mWatchBox").hidden = !watch;
}

function initBatch() {
  const limit = $("w2mOptLimit");
  for (const opt of limitOptions()) {
    const el = document.createElement("option");
    el.value = opt.key;
    el.textContent = opt.label;
    limit.appendChild(el);
  }
  limit.value = "balanced";

  $("w2mModeSingle").addEventListener("click", () => setMode("single"));
  $("w2mModeBatch").addEventListener("click", () => setMode("batch"));
  $("w2mBatchBtn").addEventListener("click", startBatch);
  $("w2mBatchStopBtn").addEventListener("click", () => {
    if (batchRun) batchRun.stop = true;
    $("w2mBatchStopBtn").disabled = true;
    showBatchProgress("Stopping after the current page…");
  });
  $("w2mBatchInput").addEventListener("input", updateBatchCount);
  $("w2mBatchList").addEventListener("click", handleBatchListClick);
  $("w2mBatchList").addEventListener("toggle", e => {
    if (e.target.classList && e.target.classList.contains("bpreview") && e.target.open) fillBatchPreview(e.target);
  }, true);
  $("w2mBatchSaveAllBtn").addEventListener("click", batchSaveAllFiles);
  $("w2mBatchCopyBtn").addEventListener("click", batchCopyCombined);
  $("w2mBatchSaveBtn").addEventListener("click", batchSaveAll);
  $("w2mBatchToc").addEventListener("change", renderBatchCombined);
  updateBatchCount();
}

/* ---------------- site crawl ---------------- */

const CRAWL_DEPTHS = [
  { value: 1, label: "1 hop — start page + its links" },
  { value: 2, label: "2 hops (default)" },
  { value: 3, label: "3 hops" },
  { value: 4, label: "4 hops" }
];
const CRAWL_MAX = [
  { value: 10, label: "10 pages" },
  { value: 25, label: "25 pages (default)" },
  { value: 50, label: "50 pages" },
  { value: 100, label: "100 pages" }
];
const CRAWL_ICONS = { ok: "✓", error: "✕", skipped: "–", fetching: "•", queued: "•" };
const CRAWL_LABELS = { ok: "Done", error: "Failed", skipped: "Not visited", fetching: "Fetching…", queued: "Queued" };

let crawlRun = null;

function showCrawlProgress(html, isError) {
  const box = $("w2mCrawlProgress");
  box.classList.toggle("err", !!isError);
  box.innerHTML = (isError ? "" : '<div class="spin"></div>') + `<div>${html}</div>`;
  box.hidden = false;
}

function hideCrawlProgress() {
  $("w2mCrawlProgress").hidden = true;
}

function setCrawlBusy(busy, options = {}) {
  if (crawlRun) crawlRun.running = busy;
  const btn = $("w2mCrawlBtn");
  btn.disabled = busy;
  btn.textContent = busy ? "Crawling…" : "Crawl site";
  const stop = $("w2mCrawlStopBtn");
  stop.hidden = !busy || options.stop === false;
  if (busy) stop.disabled = false;
  $("w2mCrawlInput").readOnly = busy;
  for (const id of ["w2mCrawlDepth", "w2mCrawlMax", "w2mCrawlSameHost", "w2mCrawlInclude"]) $(id).disabled = busy;
}

function crawlPageByUrl(url) {
  if (!crawlRun) return null;
  return crawlRun.pages.find(p => p.url === url) || null;
}

function crawlNameFor(page) {
  if (!crawlRun) return crawlFilePath(page.finalUrl || page.url);
  const paths = crawlRun.paths || crawlFilePaths(crawlRun.pages);
  crawlRun.paths = paths;
  return paths.get(page.url) || crawlFilePath(page.finalUrl || page.url);
}

function crawlNodeHTML(page) {
  const status = page.status || "queued";
  const depth = Math.max(0, Math.min(6, page.depth || 0));
  const target = page.title || page.finalUrl || page.url;
  const canRemove = !(crawlRun && crawlRun.running);
  const removeBtn = canRemove ? '<button class="cRemove">Remove</button>' : "";
  const parts = [];
  parts.push(`<div class="crawlnode s-${status}" data-url="${esc(page.url)}" style="margin-left:${depth * 16}px">`);
  parts.push(`<div class="browhead"><span class="bstatus">${CRAWL_ICONS[status] || "•"}</span><span class="btarget">${esc(target)}</span><span class="bstate">${esc(CRAWL_LABELS[status] || status)}</span></div>`);
  if (page.title && (page.finalUrl || page.url)) parts.push(`<div class="burl">${esc(page.finalUrl || page.url)}</div>`);
  if (status === "ok") {
    const md = markdownStats(page.markdown || "");
    const name = crawlNameFor(page);
    parts.push(`<div class="browmeta">${md.words.toLocaleString()} words · ${(page.markdown || "").length.toLocaleString()} chars · <span class="crawlmeta">${esc(name)}</span></div>`);
    parts.push(`<div class="browactions"><button class="cCopy">Copy</button><button class="cDownload">Download .md</button><button class="cSave">Save</button>${removeBtn}</div>`);
    parts.push(`<details class="srcbox bpreview"><summary>Preview</summary><pre></pre></details>`);
  } else if (status === "error") {
    const info = errorInfo(page.error);
    parts.push(`<div class="browmeta errline">${esc(info.title)}${info.detail ? " — " + esc(info.detail) : ""}</div>`);
    if (removeBtn) parts.push(`<div class="browactions">${removeBtn}</div>`);
  } else if (status === "skipped") {
    parts.push(`<div class="browmeta subtle">Beyond the page limit — not fetched. Raise “Max pages” to include it.</div>`);
    if (removeBtn) parts.push(`<div class="browactions">${removeBtn}</div>`);
  } else {
    parts.push(`<div class="browmeta subtle">Waiting…</div>`);
    if (removeBtn) parts.push(`<div class="browactions">${removeBtn}</div>`);
  }
  parts.push(`</div>`);
  return parts.join("");
}

function renderCrawlTree() {
  const tree = $("w2mCrawlTree");
  if (!crawlRun || !crawlRun.pages.length) { tree.innerHTML = ""; return; }
  crawlRun.paths = crawlFilePaths(crawlRun.pages);
  tree.innerHTML = crawlRun.pages.map(crawlNodeHTML).join("");
}

function renderCrawlResult() {
  const result = $("w2mCrawlResult");
  const pages = (crawlRun && crawlRun.pages) || [];
  const ok = pages.filter(p => p.status === "ok");
  if (!crawlRun || !ok.length) { result.hidden = true; return; }

  const paths = crawlFilePaths(pages);
  crawlRun.paths = paths;
  crawlRun.manifest = crawlManifest(pages, {
    paths,
    startUrl: crawlRun.start,
    title: (crawlRun.host || "Site") + " — site export",
    createdAt: crawlRun.startedAt
  }).markdown;
  const combined = combineDocuments(ok.map(p => ({ title: p.title, url: p.finalUrl || p.url, host: p.host, markdown: p.markdown })), {
    title: (crawlRun.host || "Site") + " — " + ok.length + " page" + (ok.length === 1 ? "" : "s"),
    includeToc: true,
    includeFrontmatter: true,
    createdAt: crawlRun.startedAt
  });
  crawlRun.combined = combined;

  const failed = pages.filter(p => p.status === "error").length;
  const skipped = pages.filter(p => p.status === "skipped").length;
  const stats = $("w2mCrawlStats");
  stats.textContent = "";
  stats.append(
    statsRow("Pages", ok.length + " captured"),
    statsRow("Files", ok.length + " .md"),
    statsRow("Markdown", combined.markdown.length.toLocaleString() + " chars"),
    statsRow("Words", combined.stats.words.toLocaleString())
  );
  if (failed) stats.append(statsRow("Failed", String(failed)));
  if (skipped) stats.append(statsRow("Skipped", String(skipped)));
  result.hidden = false;
}

function fillCrawlPreview(detailsEl) {
  const pre = detailsEl.querySelector("pre");
  if (!pre || pre.dataset.filled) return;
  const node = detailsEl.closest(".crawlnode");
  if (!node || !crawlRun) return;
  const page = crawlPageByUrl(node.dataset.url);
  if (!page || page.status !== "ok") return;
  pre.textContent = previewText(page.markdown || "");
  pre.dataset.filled = "1";
}

async function startCrawl() {
  if (crawlRun && crawlRun.running) return;
  const input = $("w2mCrawlInput").value;
  const startNorm = normalizeCrawlUrl(input);
  if (!startNorm.ok) {
    showCrawlProgress("Enter a valid web address to start from (e.g. <code>example.com/docs</code>).", true);
    return;
  }
  const opts = currentOptions();
  const limits = limitsFor(opts);
  const sameHostOnly = $("w2mCrawlSameHost").checked;
  const include = $("w2mCrawlInclude").value.trim();
  const depth = Number($("w2mCrawlDepth").value) || 2;
  const maxPages = Number($("w2mCrawlMax").value) || 25;

  crawlRun = {
    running: true, stop: false, startedAt: Date.now(), jobId: null,
    pages: [], start: startNorm.url, host: startNorm.host,
    options: { ...opts, depth, maxPages, sameHostOnly, include },
    paths: null, manifest: null, combined: null, outcome: null,
    seenSet: new Set(), queueSnapshot: [], seenSnapshot: []
  };
  $("w2mCrawlResult").hidden = true;
  $("w2mCrawlTree").innerHTML = "";
  setCrawlBusy(true);
  showCrawlProgress(`Starting crawl of <b>${esc(startNorm.host)}</b>…`);
  await saveCrawlJob("running");

  try {
    const outcome = await crawlSite(startNorm.url, {
      maxDepth: depth,
      maxPages,
      sameHostOnly,
      include,
      delayMs: 300,
      shouldStop: () => !!(crawlRun && crawlRun.stop),
      fetchPage: url => fetchDocument(url, { fetchImpl: window.root.superFetch, maxBytes: limits.maxBytes }),
      buildDoc: (html, url) => buildDocument(html, { url, ...opts }),
      onStart: (page, count, max) => {
        showCrawlProgress(`Fetching <b>${esc(page.url)}</b> — ${count} of ${max}…`);
      },
      onQueue: queue => {
        crawlRun.queueSnapshot = queue;
        for (const n of queue) crawlRun.seenSet.add(crawlKey(n.url));
        saveCrawlJob();
      },
      onVisit: page => {
        crawlRun.pages.push(page);
        crawlRun.seenSet.add(crawlKey(page.url));
        renderCrawlTree();
        saveCrawlJob();
      }
    });
    crawlRun.pages = outcome.pages;
    crawlRun.outcome = outcome;
    crawlRun.seenSnapshot = Array.from(crawlRun.seenSet);
    renderCrawlTree();
    renderCrawlResult();
    await saveCrawlJob(outcome.stopped ? "paused" : "done");
    if (!outcome.stopped) await clearJob();
    await showResumeBar();
    if (outcome.stopped) {
      showCrawlProgress(`Stopped — captured <b>${outcome.ok}</b> page${outcome.ok === 1 ? "" : "s"}.`);
    } else {
      showCrawlProgress(
        `Captured <b>${outcome.ok}</b> of ${outcome.total} page${outcome.total === 1 ? "" : "s"}` +
        (outcome.failed ? `, <b>${outcome.failed}</b> failed` : "") +
        (outcome.skipped ? ` — <b>${outcome.skipped}</b> not visited (page limit reached)` : "") + "."
      );
    }
  } catch (err) {
    console.error("Site crawl failed:", err);
    showCrawlProgress("Crawl failed: " + esc((err && err.message) || err), true);
  } finally {
    crawlRun.running = false;
    setCrawlBusy(false);
    renderCrawlTree();
  }
}

function stopCrawl() {
  if (!crawlRun || !crawlRun.running) return;
  crawlRun.stop = true;
  $("w2mCrawlStopBtn").disabled = true;
  showCrawlProgress("Stopping after the current page…");
}

function crawlDocs() {
  if (!crawlRun) return [];
  const paths = crawlRun.paths || crawlFilePaths(crawlRun.pages);
  crawlRun.paths = paths;
  return crawlRun.pages.filter(p => p.status === "ok").map(page => ({
    page,
    name: paths.get(page.url) || crawlFilePath(page.finalUrl || page.url),
    title: page.title,
    url: page.finalUrl || page.url,
    host: page.host,
    markdown: page.markdown || ""
  }));
}

function crawlDownloadZip() {
  const docs = crawlDocs();
  if (!docs.length) return;
  if (!crawlRun.manifest) renderCrawlResult();
  const files = docs.map(d => ({ name: d.name, data: d.markdown }));
  if (crawlRun.manifest) files.unshift({ name: "_index.md", data: crawlRun.manifest });
  const zipName = (crawlRun.host || "site") + "-markdown-" + dateStamp() + ".zip";
  downloadBlob(zipName, new Blob([createZip(files)], { type: "application/zip" }));
}

function crawlSaveAllFiles() {
  if (!crawlRun) return;
  const docs = crawlDocs();
  const host = crawlRun.host || "site";
  return downloadExportFiles(docs.map(d => ({
    title: d.title,
    url: d.url,
    host: d.host,
    markdown: d.markdown,
    filename: d.name,
    doc: d.page.doc
  })), {
    format: $("w2mCrawlFormat").value,
    individual: $("w2mCrawlEach").checked,
    baseName: host + "-markdown-" + dateStamp(),
    title: host + " — " + docs.length + " page" + (docs.length === 1 ? "" : "s"),
    includeToc: true,
    includeFrontmatter: currentOptions().includeFrontmatter,
    createdAt: crawlRun.startedAt,
    docOptions: currentOptions()
  }, $("w2mCrawlSaveAllBtn"));
}

function removeCrawlPage(url) {
  if (!crawlRun || crawlRun.running) return;
  const idx = crawlRun.pages.findIndex(p => p.url === url);
  if (idx === -1) return;
  crawlRun.pages.splice(idx, 1);
  crawlRun.paths = null;
  renderCrawlTree();
  renderCrawlResult();
  showCrawlProgress("Removed a page from the export.");
}

async function crawlSaveAll() {
  const docs = crawlDocs();
  if (!docs.length) return;
  const btn = $("w2mCrawlSaveBtn");
  const tag = crawlRun.host || "";
  btn.disabled = true;
  let saved = 0;
  for (const d of docs) {
    const rec = createDocRecord({
      title: d.title || d.url,
      url: d.url,
      site: (d.page.doc && d.page.doc.metadata && d.page.doc.metadata.site) || d.host || tag,
      author: d.page.doc && d.page.doc.metadata && d.page.doc.metadata.author,
      published: d.page.doc && d.page.doc.metadata && d.page.doc.metadata.published,
      tags: tag ? [tag] : [],
      markdown: d.markdown,
      stats: markdownStats(d.markdown),
      options: currentOptions()
    });
    try {
      await getDocStore().save(rec);
      docRecords.unshift(rec);
      saved++;
    } catch (err) {
      console.error("Save failed:", err);
    }
  }
  renderDocLibrary();
  btn.disabled = false;
  flashBtn(btn, saved ? `Saved ${saved}!` : "Save failed");
}

async function crawlCopyIndex() {
  if (!crawlRun) return;
  if (!crawlRun.manifest) renderCrawlResult();
  if (!crawlRun.manifest) return;
  const btn = $("w2mCrawlCopyBtn");
  try {
    await copyText(crawlRun.manifest);
    flashBtn(btn, "Copied!");
  } catch (err) {
    console.error("Copy failed:", err);
    flashBtn(btn, "Copy failed");
  }
}

function handleCrawlTreeClick(e) {
  const node = e.target.closest(".crawlnode");
  if (!node || !crawlRun) return;
  if (e.target.closest(".cRemove")) {
    removeCrawlPage(node.dataset.url);
    return;
  }
  const page = crawlPageByUrl(node.dataset.url);
  if (!page || page.status !== "ok") return;

  if (e.target.closest(".cCopy")) {
    const btn = e.target.closest(".cCopy");
    copyText(page.markdown).then(() => flashBtn(btn, "Copied!")).catch(err => { console.error(err); flashBtn(btn, "Copy failed"); });
  } else if (e.target.closest(".cDownload")) {
    downloadText(crawlNameFor(page).replace(/\//g, "__"), page.markdown, "text/markdown;charset=utf-8");
  } else if (e.target.closest(".cSave")) {
    const btn = e.target.closest(".cSave");
    const meta = (page.doc && page.doc.metadata) || {};
    const rec = createDocRecord({
      title: page.title || page.finalUrl || page.url,
      url: page.finalUrl || page.url,
      site: meta.site || page.host || (crawlRun && crawlRun.host) || "",
      author: meta.author, published: meta.published,
      tags: crawlRun && crawlRun.host ? [crawlRun.host] : [],
      markdown: page.markdown,
      stats: markdownStats(page.markdown),
      options: currentOptions()
    });
    btn.disabled = true;
    getDocStore().save(rec).then(() => {
      docRecords.unshift(rec);
      renderDocLibrary();
      flashBtn(btn, "Saved!");
    }).catch(err => { console.error(err); flashBtn(btn, "Save failed"); });
  }
}

function initCrawl() {
  const depth = $("w2mCrawlDepth");
  for (const opt of CRAWL_DEPTHS) {
    const el = document.createElement("option");
    el.value = String(opt.value);
    el.textContent = opt.label;
    depth.appendChild(el);
  }
  depth.value = "2";
  const max = $("w2mCrawlMax");
  for (const opt of CRAWL_MAX) {
    const el = document.createElement("option");
    el.value = String(opt.value);
    el.textContent = opt.label;
    max.appendChild(el);
  }
  max.value = "25";

  $("w2mModeCrawl").addEventListener("click", () => setMode("crawl"));
  $("w2mCrawlBtn").addEventListener("click", startCrawl);
  $("w2mCrawlInput").addEventListener("keydown", e => { if (e.key === "Enter") startCrawl(); });
  $("w2mCrawlStopBtn").addEventListener("click", stopCrawl);
  $("w2mCrawlZipBtn").addEventListener("click", crawlDownloadZip);
  $("w2mCrawlSaveAllBtn").addEventListener("click", crawlSaveAllFiles);
  $("w2mCrawlSaveBtn").addEventListener("click", crawlSaveAll);
  $("w2mCrawlCopyBtn").addEventListener("click", crawlCopyIndex);
  $("w2mCrawlTree").addEventListener("click", handleCrawlTreeClick);
  $("w2mCrawlTree").addEventListener("toggle", e => {
    if (e.target.classList && e.target.classList.contains("bpreview") && e.target.open) fillCrawlPreview(e.target);
  }, true);
}

/* ---------------- self tests ---------------- */

async function runSelfTests() {
  const out = $("w2mTestOut");
  out.hidden = false;
  out.textContent = "Running…";
  const result = await runTests();
  const lines = [summarize(result)];
  for (const r of result.results) {
    lines.push((r.pass ? "PASS  " : "FAIL  ") + r.name + (r.pass ? "" : "\n      " + r.error));
  }
  out.textContent = lines.join("\n");
  console.log("Web-to-Markdown self-tests:", result);
  return result;
}

function flashBtn(btn, txt) {
  const old = btn.textContent;
  btn.textContent = txt;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1300);
}

function copyText(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function downloadText(name, text, mime) {
  downloadBlob(name, new Blob([text], { type: mime || "text/markdown;charset=utf-8" }));
}

function downloadCurrent() {
  if (!lastCapture) return;
  const title = lastCapture.doc.title;
  const site = lastCapture.doc.metadata && lastCapture.doc.metadata.site;
  downloadText(docFilename({ title, site, createdAt: Date.now() }), lastCapture.doc.markdown, "text/markdown;charset=utf-8");
}

async function copyCurrent() {
  if (!lastCapture) return;
  const btn = $("w2mCopyBtn");
  try {
    await copyText(lastCapture.doc.markdown);
    flashBtn(btn, "Copied!");
  } catch (err) {
    console.error("Copy failed:", err);
    flashBtn(btn, "Copy failed");
  }
}

async function saveToLibrary() {
  if (!lastCapture) return;
  const { fetched, doc } = lastCapture;
  const meta = doc.metadata || {};
  const record = createDocRecord({
    title: doc.title || fetched.finalUrl,
    url: fetched.finalUrl,
    site: meta.site || fetched.host,
    author: meta.author,
    published: meta.published,
    markdown: doc.markdown,
    stats: markdownStats(doc.markdown),
    options: currentOptions()
  });
  const btn = $("w2mSaveBtn");
  btn.disabled = true;
  try {
    await getDocStore().save(record);
    docRecords.unshift(record);
    renderDocLibrary();
    flashBtn(btn, "Saved!");
  } catch (err) {
    console.error("Save to library failed:", err);
    flashBtn(btn, "Save failed");
  }
}

/* ---------------- documents library ---------------- */

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (err) { return ""; }
}

function docCardHTML(d) {
  const stat = d.stats || {};
  const rows = [];
  if (d.site) rows.push(["Source", d.site]);
  if (d.author) rows.push(["Author", d.author]);
  if (d.published) rows.push(["Published", d.published]);
  if (stat.words) rows.push(["Words", stat.words.toLocaleString()]);
  if (stat.characters) rows.push(["Chars", stat.characters.toLocaleString()]);
  rows.push(["Saved", new Date(d.createdAt).toLocaleDateString()]);
  const rowHTML = rows.map(([lab, val]) =>
    `<div class="row"><span class="lab">${esc(lab)}</span><span class="val">${esc(String(val))}</span></div>`).join("");
  const tags = (d.tags || []).map(t =>
    `<span class="chip" data-tag="${esc(t)}">${esc(t)} <b class="tagx" title="Remove tag">×</b></span>`).join("");
  const host = hostOf(d.url);
  const head = d.url
    ? `<a class="title" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>${host ? `<span class="slug">${esc(host)}</span>` : ""}`
    : `<span class="title">${esc(d.title)}</span>`;
  return `<article class="card" data-id="${esc(d.id)}">
    <div class="body">
      <div class="head">${head}</div>
      <div class="rows">${rowHTML}</div>
      <div class="tags" data-tags>${tags}<input class="taginput" placeholder="+ tag" /></div>
      <textarea class="notes" rows="2" placeholder="Your notes for this document...">${esc(d.notes || "")}</textarea>
      <details class="cssbox docview"><summary>Markdown <span class="subtle">${(stat.words || 0).toLocaleString()} words</span></summary><pre>${esc(d.markdown || "")}</pre></details>
      <div class="actions">
        <button class="copyBtn">Copy</button>
        <button class="downloadBtn">Download .md</button>
        <button class="delBtn">Delete</button>
      </div>
    </div>
  </article>`;
}

function renderDocLibrary() {
  const q = $("docSearchInput") ? $("docSearchInput").value : "";
  const list = docRecords.filter(d => matchDoc(d, q));
  $("docGrid").innerHTML = list.map(docCardHTML).join("");
  $("docCountEl").textContent = docRecords.length;
  $("docToolbar").hidden = docRecords.length === 0;
  $("docEmpty").hidden = docRecords.length > 0;
  bindDocEvents();
}

async function loadDocs() {
  try {
    docRecords = await getDocStore().list();
  } catch (err) {
    console.error("Failed to load saved documents:", err);
    docRecords = [];
  }
  renderDocLibrary();
}

function focusTagInput(id) {
  const card = document.querySelector('#docGrid .card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  if (card) {
    const input = card.querySelector(".taginput");
    if (input) input.focus();
  }
}

function bindDocEvents() {
  document.querySelectorAll("#docGrid .card").forEach(cardEl => {
    const id = cardEl.dataset.id;
    const rec = docRecords.find(d => d.id === id);
    if (!rec) return;

    const copyBtn = cardEl.querySelector(".copyBtn");
    copyBtn.addEventListener("click", async () => {
      try { await copyText(rec.markdown); flashBtn(copyBtn, "Copied!"); }
      catch (err) { console.error("Copy failed:", err); flashBtn(copyBtn, "Copy failed"); }
    });

    cardEl.querySelector(".downloadBtn").addEventListener("click", () => {
      downloadText(docFilename(rec), rec.markdown, "text/markdown;charset=utf-8");
    });

    const notesTa = cardEl.querySelector(".notes");
    let notesTimer;
    notesTa.addEventListener("input", () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(async () => {
        rec.notes = notesTa.value;
        try { await getDocStore().patch(id, { notes: rec.notes }); } catch (err) { console.error(err); }
      }, 400);
    });

    cardEl.querySelectorAll(".tagx").forEach(x => {
      x.addEventListener("click", async () => {
        const tag = x.parentElement.dataset.tag;
        rec.tags = (rec.tags || []).filter(t => t !== tag);
        try { await getDocStore().patch(id, { tags: rec.tags }); } catch (err) { console.error(err); }
        renderDocLibrary();
      });
    });

    const tagInput = cardEl.querySelector(".taginput");
    tagInput.addEventListener("keydown", async e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const tag = normalizeTag(tagInput.value);
      tagInput.value = "";
      if (!tag || (rec.tags || []).includes(tag)) return;
      rec.tags = (rec.tags || []).concat(tag);
      try { await getDocStore().patch(id, { tags: rec.tags }); } catch (err) { console.error(err); }
      renderDocLibrary();
      focusTagInput(id);
    });

    const delBtn = cardEl.querySelector(".delBtn");
    delBtn.addEventListener("click", async () => {
      if (!delBtn.classList.contains("armed")) {
        delBtn.classList.add("armed");
        delBtn.textContent = "Confirm?";
        setTimeout(() => { delBtn.classList.remove("armed"); delBtn.textContent = "Delete"; }, 2500);
        return;
      }
      try {
        await getDocStore().remove(id);
        docRecords = docRecords.filter(d => d.id !== id);
        renderDocLibrary();
      } catch (err) { console.error("Delete failed:", err); }
    });
  });
}

/* ---------------- document export / import ---------------- */

function showDocIo(text, isError) {
  const el = $("docIoMsg");
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.classList.toggle("err", !!isError);
  el.textContent = text;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function docExportJson() {
  if (!docRecords.length) {
    showDocIo("Nothing to export yet — capture a page and save it to the library first.", true);
    return;
  }
  const payload = docsToJson(docRecords);
  downloadText("extrax-documents-" + dateStamp() + ".json", JSON.stringify(payload, null, 2), "application/json");
  showDocIo("Exported " + docRecords.length + " document" + (docRecords.length === 1 ? "" : "s") + " as JSON — a full backup you can import anywhere.");
}

function docExportMarkdown() {
  if (!docRecords.length) {
    showDocIo("Nothing to export yet — capture a page and save it to the library first.", true);
    return;
  }
  const markdown = docsToMarkdown(docRecords, { title: "Extrax Documents" });
  downloadText("extrax-documents-" + dateStamp() + ".md", markdown, "text/markdown;charset=utf-8");
  showDocIo("Exported " + docRecords.length + " document" + (docRecords.length === 1 ? "" : "s") + " as Markdown.");
}

async function handleDocImportFiles(files) {
  const list = files ? Array.from(files) : [];
  if (!list.length) return;
  const existing = new Set(docRecords.map(d => d.id));
  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of list) {
    try {
      const text = await file.text();
      const name = (file.name || "").toLowerCase();
      const looksJson = name.endsWith(".json") || (!name.endsWith(".md") && !name.endsWith(".markdown") && /^\s*[[{]/.test(text));
      let partials;
      if (looksJson) {
        const docs = docsFromJson(JSON.parse(text));
        if (!docs) throw new Error("that JSON isn't an Extrax documents export");
        partials = docs;
      } else {
        partials = parseDocsMarkdown(text, { filename: file.name });
      }
      for (const partial of partials) {
        const rec = makeImportedRecord(partial);
        if (!String(rec.markdown).trim()) { skipped++; continue; }
        if (existing.has(rec.id)) { skipped++; continue; }
        await getDocStore().save(rec);
        docRecords.unshift(rec);
        existing.add(rec.id);
        added++;
      }
    } catch (err) {
      console.error("Document import failed:", file.name, err);
      failed++;
    }
  }

  renderDocLibrary();
  const bits = [];
  if (added) bits.push("Imported " + added + " document" + (added === 1 ? "" : "s"));
  if (skipped) bits.push(skipped + " skipped");
  if (failed) bits.push(failed + " file" + (failed === 1 ? "" : "s") + " failed");
  showDocIo(bits.length ? bits.join(" · ") + "." : "Nothing new to import.", failed > 0 && !added);
}

function initDocIo() {
  $("docExportJsonBtn").addEventListener("click", docExportJson);
  $("docExportMdBtn").addEventListener("click", docExportMarkdown);
  $("docImportBtn").addEventListener("click", () => $("docFileInput").click());
  $("docFileInput").addEventListener("change", () => {
    const files = $("docFileInput").files ? Array.from($("docFileInput").files) : [];
    handleDocImportFiles(files);
    $("docFileInput").value = "";
  });
}

/* ---------------- structured data, resources & EPUB ---------------- */

function currentHtml() {
  return lastCapture && lastCapture.fetched ? (lastCapture.fetched.html || "") : "";
}

function baseNameFor(url, fallback) {
  const host = hostOf(url);
  return host || fallback || "export";
}

function opTables() {
  if (!lastCapture) return;
  const tables = tablesFromHtml(currentHtml());
  const body = openModal({ title: "Tables & structured data", wide: true });
  const tabs = el("div", { class: "exrow" });
  const pane = el("div");
  const btnTables = el("button", { class: "exbtn prim", text: "Tables found (" + tables.length + ")" });
  const btnAI = el("button", { class: "exbtn", text: "Extract with AI" });
  const renderTables = () => {
    pane.textContent = "";
    if (!tables.length) {
      pane.appendChild(el("p", { class: "exmuted", text: "No table elements were found in this page. Try the AI extraction tab to pull structured fields out of the text." }));
      return;
    }
    const base = baseNameFor(lastCapture.fetched.finalUrl, "tables");
    pane.appendChild(el("p", { class: "exmuted", text: tablesSummary(tables) + " — download every table as one file, or copy an individual table below." }));
    pane.appendChild(el("div", { class: "exrow" }, [
      el("button", { class: "exbtn prim", text: "Download CSV", onClick: () => { const f = tableFiles(tables, { baseName: base }).files[0]; downloadText(f.name, f.text, f.mime); } }),
      el("button", { class: "exbtn", text: "Download JSON", onClick: () => { const f = tableFiles(tables, { baseName: base, format: "json" }).files[0]; downloadText(f.name, f.text, f.mime); } }),
      el("button", { class: "exbtn", text: "Copy CSV", onClick: e => { const f = tableFiles(tables, { baseName: base }).files[0]; copyText(f.text).then(() => flashBtn(e.currentTarget, "Copied!")); } })
    ]));
    tables.forEach((t, i) => {
      const title = t.caption || t.heading || ("Table " + (i + 1));
      pane.appendChild(el("h4", { text: title + " — " + t.rowCount + " row" + (t.rowCount === 1 ? "" : "s") + " × " + t.colCount + " col" }));
      const table = el("table", { class: "extable" });
      const thead = el("thead");
      thead.appendChild(el("tr", {}, t.headers.map(h => el("th", { text: h }))));
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const row of t.rows.slice(0, 40)) tbody.appendChild(el("tr", {}, row.map(c => el("td", { text: c }))));
      table.appendChild(tbody);
      pane.appendChild(table);
      if (t.rows.length > 40) pane.appendChild(el("p", { class: "exmuted", text: "Showing the first 40 rows — the download contains all of them." }));
      const csv = tableFiles([t], { baseName: "table-" + (i + 1) }).files[0];
      pane.appendChild(el("div", { class: "exrow" }, [
        el("button", { class: "exbtn", text: "Copy CSV", onClick: e => copyText(csv.text).then(() => flashBtn(e.currentTarget, "Copied!")) }),
        el("button", { class: "exbtn", text: "Download CSV", onClick: () => downloadText(csv.name, csv.text, csv.mime) }),
        el("button", { class: "exbtn", text: "Download JSON", onClick: () => { const f = tableFiles([t], { baseName: "table-" + (i + 1), format: "json" }).files[0]; downloadText(f.name, f.text, f.mime); } })
      ]));
    });
  };
  const renderAI = () => {
    pane.textContent = "";
    pane.appendChild(el("p", { class: "exmuted", text: "Describe the fields you want. The page's Markdown is sent to the AI, which returns strict JSON you can copy or download." }));
    const schemaTa = el("textarea", { rows: "7", spellcheck: "false", style: "width:100%; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px; margin-bottom:10px;" });
    schemaTa.value = JSON.stringify(defaultSchema(), null, 2);
    const instr = el("input", { type: "text", placeholder: "e.g. Extract every product with its name, price and rating", style: "width:100%; margin-bottom:10px;" });
    const out = el("pre", { class: "extrax-pre", hidden: "1" });
    const go = el("button", { class: "exbtn prim", text: "Extract structured JSON" });
    const dlRow = el("div", { class: "exrow", hidden: "1" });
    go.addEventListener("click", async () => {
      let schema;
      try { schema = JSON.parse(schemaTa.value); }
      catch (err) { out.hidden = false; out.textContent = "The schema isn't valid JSON: " + err.message; return; }
      go.disabled = true;
      out.hidden = false;
      out.textContent = "Thinking…";
      dlRow.hidden = true;
      try {
        const prompt = buildSchemaPrompt({
          markdown: lastCapture.doc.markdown,
          title: lastCapture.doc.title,
          url: lastCapture.fetched.finalUrl,
          schema,
          instruction: instr.value
        });
        const res = await window.root.generateText(prompt);
        const parsed = parseSchemaOutput(res && res.text != null ? res.text : String(res == null ? "" : res));
        if (parsed.ok) {
          out.textContent = JSON.stringify(parsed.value, null, 2);
          dlRow.hidden = false;
        } else {
          out.textContent = "Couldn't parse the AI response as JSON:\n\n" + (parsed.raw || "");
        }
      } catch (err) {
        out.textContent = "Extraction failed: " + ((err && err.message) || err);
      }
      go.disabled = false;
    });
    dlRow.append(
      el("button", { class: "exbtn", text: "Copy JSON", onClick: e => copyText(out.textContent).then(() => flashBtn(e.currentTarget, "Copied!")) }),
      el("button", { class: "exbtn", text: "Download .json", onClick: () => downloadText(baseNameFor(lastCapture.fetched.finalUrl, "extract") + "-extract.json", out.textContent, "application/json") })
    );
    pane.append(
      el("div", { class: "exfield" }, [el("label", { text: "Schema (field names are exact)" }), schemaTa]),
      el("div", { class: "exfield" }, [el("label", { text: "Instruction" }), instr]),
      el("div", { class: "exrow" }, [go]),
      dlRow,
      out
    );
  };
  btnTables.addEventListener("click", () => { btnTables.classList.add("prim"); btnAI.classList.remove("prim"); renderTables(); });
  btnAI.addEventListener("click", () => { btnAI.classList.add("prim"); btnTables.classList.remove("prim"); renderAI(); });
  tabs.append(btnTables, btnAI);
  body.append(tabs, pane);
  renderTables();
}

function opInventory() {
  if (!lastCapture) return;
  const inv = inventoryFromHtml(currentHtml(), lastCapture.fetched.finalUrl);
  const body = openModal({ title: "Page resources", wide: true });
  body.appendChild(el("p", { class: "exmuted", text: inventorySummary(inv) }));
  const files = inventoryFiles(inv, { baseName: baseNameFor(lastCapture.fetched.finalUrl, "resources") });
  const row = el("div", { class: "exrow" }, [
    el("button", { class: "exbtn prim", text: "Download JSON", onClick: () => downloadText(files[0].name, files[0].text, files[0].mime) }),
    el("button", { class: "exbtn", text: "Download CSV", onClick: () => downloadText(files[1].name, files[1].text, files[1].mime) }),
    el("button", { class: "exbtn", text: "Copy all URLs", onClick: e => copyText(inv.links.map(l => l.url).concat(inv.images.map(i => i.src), inv.media.map(m => m.src)).join("\n")).then(() => flashBtn(e.currentTarget, "Copied!")) })
  ]);
  if (inv.images.length) row.appendChild(el("button", { class: "exbtn", text: "Copy image URLs", onClick: e => copyText(inventoryImageLinks(inv).join("\n")).then(() => flashBtn(e.currentTarget, "Copied!")) }));
  body.appendChild(row);
  const sections = [
    ["Links", inv.links, l => l.url + (l.text ? "  —  " + l.text : "") + (l.internal ? "" : "  ↗")],
    ["Images", inv.images, i => i.src + (i.alt ? "  —  " + i.alt : "")],
    ["Media", inv.media, m => m.src],
    ["Files", inv.files, f => f.url],
    ["Emails", inv.emails, e => e],
    ["Phone numbers", inv.phones, p => p]
  ];
  for (const [label, list, fmt] of sections) {
    if (!list || !list.length) continue;
    body.appendChild(el("h4", { text: label + " (" + list.length + ")" }));
    const box = el("div", { class: "exlist" });
    for (const item of list.slice(0, 80)) {
      const text = fmt(item);
      const cell = el("div", { class: "exitem" }, [el("span", { class: "exgrow exmuted", style: "word-break:break-all;", text })]);
      if (/^https?:/i.test(text)) cell.appendChild(el("a", { class: "exbtn", href: text.split("  ")[0], target: "_blank", rel: "noopener", text: "Open" }));
      box.appendChild(cell);
    }
    if (list.length > 80) box.appendChild(el("p", { class: "exmuted", text: "…and " + (list.length - 80) + " more (see the JSON/CSV download)." }));
    body.appendChild(box);
  }
}

function crawlEpub() {
  if (!crawlRun) return;
  const docs = crawlDocs();
  if (!docs.length) return;
  const chassis = docs.map(d => ({ title: d.title, markdown: d.markdown }));
  const title = (crawlRun.host || "Site") + " — site export";
  const bytes = buildEpub(chassis, { title, author: crawlRun.host || "Extrax" });
  downloadBlob(epubFileName(crawlRun.host || "extrax-export"), new Blob([bytes], { type: "application/epub+zip" }));
}

function libraryEpub() {
  if (!docRecords.length) {
    showDocIo("Nothing to export yet — capture a page and save it to the library first.", true);
    return;
  }
  const chapters = docRecords.map(d => ({ title: d.title, markdown: d.markdown }));
  const bytes = buildEpub(chapters, { title: "Extrax Documents" });
  downloadBlob(epubFileName("extrax-documents"), new Blob([bytes], { type: "application/epub+zip" }));
  showDocIo("Exported " + docRecords.length + " document" + (docRecords.length === 1 ? "" : "s") + " as an EPUB (reflowable, with a table of contents).");
}

/* ---------------- LLM context bundle + library Q&A ---------------- */

const countTokens = text => Math.ceil(String(text == null ? "" : text).length / 4);

function libraryBundle() {
  if (!docRecords.length) {
    showDocIo("Save a few documents first — the bundle is built from your library.", true);
    return;
  }
  const body = openModal({ title: "LLM context bundle", wide: true });
  const budget = el("select", {}, [
    el("option", { value: "0", text: "No budget — everything" }),
    el("option", { value: "4000", text: "≈4k tokens" }),
    el("option", { value: "8000", text: "≈8k tokens" }),
    el("option", { value: "16000", text: "≈16k tokens" }),
    el("option", { value: "32000", text: "≈32k tokens" })
  ]);
  budget.value = "8000";
  const info = el("p", { class: "exmuted" });
  const pre = el("pre", { class: "extrax-pre" });
  let current = null;
  const render = () => {
    current = buildContextBundle(docRecords, { maxTokens: Number(budget.value) || 0, countTokens, title: "Extrax library context" });
    info.textContent = current.included + " of " + docRecords.length + " document" + (docRecords.length === 1 ? "" : "s") + " included · ≈" + current.tokens.toLocaleString() + " tokens" + (current.dropped ? " · " + current.dropped + " dropped" : "") + (current.truncated ? " · last document truncated" : "");
    pre.textContent = current.markdown;
  };
  budget.addEventListener("change", render);
  body.append(el("div", { class: "exrow" }, [el("span", { class: "exmuted", text: "Token budget:" }), budget]), info, pre);
  body.appendChild(el("div", { class: "exrow" }, [
    el("button", { class: "exbtn prim", text: "Copy bundle", onClick: e => copyText(current.markdown).then(() => flashBtn(e.currentTarget, "Copied!")) }),
    el("button", { class: "exbtn", text: "Download .md", onClick: () => downloadText(bundleFileName("extrax-context"), current.markdown, "text/markdown;charset=utf-8") })
  ]));
  render();
}

async function askLibrary() {
  if (!docRecords.length) {
    showDocIo("Save some documents first, then you can ask questions about them.", true);
    return;
  }
  const input = $("docAskInput");
  const question = input.value.trim();
  if (!question) { input.focus(); return; }
  const out = $("docAskOut");
  out.hidden = false;
  out.textContent = "";
  const answer = document.createElement("div");
  answer.className = "askanswer";
  answer.innerHTML = '<span class="spin"></span> Searching your ' + docRecords.length + " document" + (docRecords.length === 1 ? "" : "s") + "…";
  out.appendChild(answer);
  const askBtn = $("docAskBtn");
  const stopBtn = $("docAskStopBtn");
  askBtn.disabled = true;
  stopBtn.hidden = false;
  stopBtn.disabled = false;

  const history = (askState && askState.history) ? askState.history : [];
  let streamed = "";
  try {
    const res = await runAsk({
      docs: docRecords,
      question,
      history,
      maxTokens: 24000,
      countTokens,
      generateText: opts => window.root.generateText(opts),
      onPending: pending => { askState = Object.assign(askState || {}, { pending }); },
      onChunk: chunk => {
        streamed += (chunk && chunk.textChunk) || "";
        answer.textContent = streamed;
      }
    });
    answer.textContent = res.answer;
    if (res.citations.length) {
      const srcs = el("div", { class: "asksources" });
      for (const n of res.citations) {
        const s = res.bundle.sources[n - 1];
        if (!s) continue;
        srcs.appendChild(el("span", { class: "asksource", text: "[" + n + "] " + s.title + (s.url ? " — " + s.url : "") }));
      }
      out.appendChild(srcs);
    }
    const row = el("div", { class: "exrow", style: "margin-top:10px;" }, [
      el("button", { class: "exbtn", text: "Copy answer", onClick: e => copyText(res.answer).then(() => flashBtn(e.currentTarget, "Copied!")) }),
      el("button", { class: "exbtn", text: "Save answer to library", onClick: async e => {
        const rec = createDocRecord({ title: "Q: " + question.slice(0, 80), markdown: res.answer, stats: markdownStats(res.answer) });
        await getDocStore().save(rec);
        docRecords.unshift(rec);
        renderDocLibrary();
        flashBtn(e.currentTarget, "Saved!");
      } })
    ]);
    out.appendChild(row);
    askState = Object.assign(askState || {}, { history: history.concat([{ role: "user", text: question }, { role: "assistant", text: res.answer }]) });
    input.value = "";
  } catch (err) {
    console.error("Ask failed:", err);
    answer.textContent = "Couldn't answer that: " + ((err && err.message) || err);
  }
  askBtn.disabled = false;
  stopBtn.hidden = true;
  askState = Object.assign(askState || {}, { pending: null });
}

function stopAsk() {
  if (askState && askState.pending && typeof askState.pending.stop === "function") {
    askState.pending.stop();
    $("docAskStopBtn").disabled = true;
  }
}

/* ---------------- watch / diff ---------------- */

function showWatchProgress(html, isError) {
  const box = $("w2mWatchProgress");
  box.classList.toggle("err", !!isError);
  box.innerHTML = (isError ? "" : '<div class="spin"></div>') + "<div>" + html + "</div>";
  box.hidden = false;
}

function watchCardHTML(rec) {
  const stats = rec.stats || markdownStats(rec.markdown || "");
  const diff = rec.previous ? diffStats(diffLines(stripFrontmatter(rec.previous), stripFrontmatter(rec.markdown))) : null;
  const state = !rec.previous
    ? '<span class="browmeta subtle">Not checked since it was added.</span>'
    : diff.changed
      ? '<span class="bq q-warn">Changed — ' + changeSummary(diffLines(stripFrontmatter(rec.previous), stripFrontmatter(rec.markdown))) + "</span>"
      : '<span class="bq q-ok">No changes since last check</span>';
  return '<div class="batchrow s-ok" data-id="' + esc(rec.id) + '">' +
    '<div class="browhead"><span class="bstatus">' + (diff && diff.changed ? "!" : "✓") + "</span>" +
    '<span class="btarget">' + esc(rec.title || rec.url) + "</span>" +
    '<span class="bstate">' + (rec.checkCount ? "checked " + rec.checkCount + "×" : "never checked") + "</span></div>" +
    '<div class="burl">' + esc(rec.url) + "</div>" +
    '<div class="browmeta">' + esc(watchSummary(rec)) + " · " + state + "</div>" +
    (rec.note ? '<div class="browhint">' + esc(rec.note) + "</div>" : "") +
    '<div class="browactions">' +
    '<button class="wCheck" data-id="' + esc(rec.id) + '">Check now</button>' +
    '<button class="wDiff" data-id="' + esc(rec.id) + '"' + (rec.previous ? "" : " disabled") + ">View diff</button>" +
    '<button class="wCopyDiff" data-id="' + esc(rec.id) + '"' + (rec.previous ? "" : " disabled") + ">Copy diff</button>" +
    '<button class="wOpen" data-id="' + esc(rec.id) + '">Open</button>' +
    (rec.checkCount ? '<button class="wDownload" data-id="' + esc(rec.id) + '">Download</button>' : "") +
    '<button class="bRemove wRemove" data-id="' + esc(rec.id) + '">Remove</button>' +
    "</div></div>";
}

function renderWatch() {
  const list = $("w2mWatchList");
  const empty = $("w2mWatchEmpty");
  list.innerHTML = watchRecords.map(watchCardHTML).join("");
  empty.hidden = watchRecords.length > 0;
}

async function loadWatch() {
  try {
    watchRecords = await getWatchStore().list();
  } catch (err) {
    console.error("Failed to load watched pages:", err);
    watchRecords = [];
  }
  renderWatch();
  updateWatchCount();
}

function updateWatchCount() {
  const btn = $("w2mWatchCheckBtn");
  if (btn) btn.disabled = watchRecords.length === 0;
}

async function watchPage(url, title, markdown, fetched) {
  const rec = createWatchRecord({
    url,
    title: title || url,
    site: (fetched && fetched.host) || hostOf(url),
    markdown
  });
  await getWatchStore().save(rec);
  watchRecords.unshift(rec);
  renderWatch();
  updateWatchCount();
  return rec;
}

async function addWatchCurrent() {
  if (!lastCapture) return;
  const btn = $("w2mWatchThisBtn");
  try {
    const rec = await watchPage(lastCapture.fetched.finalUrl, lastCapture.doc.title, lastCapture.doc.markdown, lastCapture.fetched);
    flashBtn(btn, "Watching!");
    setMode("watch");
    renderWatch();
  } catch (err) {
    console.error("Watch failed:", err);
    flashBtn(btn, "Failed");
  }
}

async function addWatchUrl() {
  const input = $("w2mWatchInput");
  const norm = normalizeCrawlUrl(input.value);
  if (!norm.ok) {
    showWatchProgress("Enter a valid web address to watch (e.g. <code>example.com/price</code>).", true);
    return;
  }
  const btn = $("w2mWatchAddBtn");
  btn.disabled = true;
  showWatchProgress("Fetching <b>" + esc(norm.host) + "</b>…");
  try {
    const opts = currentOptions();
    const limits = limitsFor(opts);
    const fetched = await fetchDocument(norm.url, { fetchImpl: window.root.superFetch, maxBytes: limits.maxBytes });
    const doc = buildDocument(fetched.html, { url: fetched.finalUrl, ...opts });
    await watchPage(fetched.finalUrl, doc.title, doc.markdown, fetched);
    input.value = "";
    showWatchProgress("Now watching <b>" + esc(doc.title || norm.host) + "</b>. Hit <b>Check now</b> later to see what changed.");
  } catch (err) {
    console.error("Watch add failed:", err);
    showWatchProgress("Couldn't watch that page: " + esc((err && err.message) || err), true);
  }
  btn.disabled = false;
}

function watchDiffFor(rec) {
  return diffLines(stripFrontmatter(rec.previous || ""), stripFrontmatter(rec.markdown || ""));
}

function viewWatchDiff(id) {
  const rec = watchRecords.find(r => r.id === id);
  if (!rec || !rec.previous) return;
  const diff = watchDiffFor(rec);
  const body = openModal({ title: "Changes — " + (rec.title || rec.url), wide: true });
  body.appendChild(el("p", { class: "exmuted", text: (diff.changed ? changeSummary(diff) : "No changes detected.") + " · last checked " + new Date(rec.checkedAt || Date.now()).toLocaleString() }));
  const pre = el("pre", { class: "extrax-pre diffpre" });
  pre.textContent = diffToMarkdown(diff);
  body.appendChild(pre);
  body.appendChild(el("div", { class: "exrow" }, [
    el("button", { class: "exbtn", text: "Copy diff", onClick: e => copyText(diffToMarkdown(diff)).then(() => flashBtn(e.currentTarget, "Copied!")) }),
    el("button", { class: "exbtn", text: "Download diff", onClick: () => downloadText((rec.title || "watch") + "-diff.md", diffToMarkdown(diff), "text/markdown;charset=utf-8") })
  ]));
}

async function checkWatch(id) {
  const rec = watchRecords.find(r => r.id === id);
  if (!rec) return;
  const btn = document.querySelector('#w2mWatchList .wCheck[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
  showWatchProgress("Checking <b>" + esc(rec.url) + "</b>…");
  try {
    const opts = currentOptions();
    const limits = limitsFor(opts);
    const fetched = await fetchDocument(rec.url, { fetchImpl: window.root.superFetch, maxBytes: limits.maxBytes });
    const doc = buildDocument(fetched.html, { url: fetched.finalUrl, ...opts });
    const oldMd = rec.markdown || "";
    const newMd = doc.markdown || "";
    const diff = diffLines(stripFrontmatter(oldMd), stripFrontmatter(newMd));
    const next = {
      previous: oldMd,
      markdown: newMd,
      title: doc.title || rec.title,
      checkedAt: Date.now(),
      checkCount: (rec.checkCount || 0) + 1,
      lastDiff: { added: diff.added, removed: diff.removed, changed: diff.changed, at: Date.now() }
    };
    await getWatchStore().patch(id, next);
    Object.assign(rec, next);
    renderWatch();
    showWatchProgress(diff.changed ? "Changed — <b>" + changeSummary(diff) + "</b>." : "No changes — the content is identical.");
  } catch (err) {
    console.error("Watch check failed:", err);
    showWatchProgress("Check failed for <b>" + esc(rec.url) + "</b>: " + esc((err && err.message) || err), true);
    if (btn) { btn.disabled = false; btn.textContent = "Check now"; }
  }
}

async function checkAllWatches() {
  if (!watchRecords.length) return;
  const btn = $("w2mWatchCheckBtn");
  if (btn) btn.disabled = true;
  let changed = 0;
  for (const rec of watchRecords.slice()) {
    try {
      const opts = currentOptions();
      const limits = limitsFor(opts);
      showWatchProgress("Checking " + esc(rec.url) + "…");
      const fetched = await fetchDocument(rec.url, { fetchImpl: window.root.superFetch, maxBytes: limits.maxBytes });
      const doc = buildDocument(fetched.html, { url: fetched.finalUrl, ...opts });
      const diff = diffLines(stripFrontmatter(rec.markdown || ""), stripFrontmatter(doc.markdown || ""));
      if (diff.changed) changed++;
      const next = { previous: rec.markdown || "", markdown: doc.markdown || "", checkedAt: Date.now(), checkCount: (rec.checkCount || 0) + 1 };
      await getWatchStore().patch(rec.id, next);
      Object.assign(rec, next);
    } catch (err) {
      console.error("Check failed for", rec.url, err);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  renderWatch();
  showWatchProgress("Checked " + watchRecords.length + " page" + (watchRecords.length === 1 ? "" : "s") + " — <b>" + changed + "</b> changed.");
  if (btn) btn.disabled = false;
}

async function removeWatch(id) {
  const btn = document.querySelector('#w2mWatchList .wRemove[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  if (btn && !btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.textContent = "Confirm?";
    setTimeout(() => { btn.classList.remove("armed"); btn.textContent = "Remove"; }, 2500);
    return;
  }
  await getWatchStore().remove(id);
  watchRecords = watchRecords.filter(r => r.id !== id);
  renderWatch();
  updateWatchCount();
}

function handleWatchListClick(event) {
  const btn = event.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  if (!id) return;
  if (btn.classList.contains("wCheck")) checkWatch(id);
  else if (btn.classList.contains("wDiff")) viewWatchDiff(id);
  else if (btn.classList.contains("wCopyDiff")) { const rec = watchRecords.find(r => r.id === id); if (rec && rec.previous) copyText(diffToMarkdown(watchDiffFor(rec))).then(() => flashBtn(btn, "Copied!")); }
  else if (btn.classList.contains("wOpen")) { const rec = watchRecords.find(r => r.id === id); if (rec) window.open(rec.url, "_blank", "noopener"); }
  else if (btn.classList.contains("wDownload")) { const rec = watchRecords.find(r => r.id === id); if (rec) downloadText((rec.title || "watched-page") + ".md", rec.markdown || "", "text/markdown;charset=utf-8"); }
  else if (btn.classList.contains("wRemove")) removeWatch(id);
}

/* ---------------- resumable jobs ---------------- */

function jobItemsSnapshot() {
  if (!batchRun) return [];
  return batchRun.items.map(i => ({ raw: i.raw, label: i.label, url: i.url, host: i.host, valid: i.valid, error: i.error }));
}

async function saveBatchJob(status) {
  if (!batchRun) return;
  try {
    const saved = await getJobStore().save(createJob({
      id: batchRun.jobId,
      mode: "batch",
      status: status || (batchRun.running ? "running" : "paused"),
      createdAt: batchRun.startedAt,
      start: "batch",
      host: "",
      items: jobItemsSnapshot(),
      done: serializeBatchResults(batchRun.results),
      total: batchRun.items.length,
      options: currentOptions()
    }));
    batchRun.jobId = saved.id;
  } catch (err) {
    console.error("Could not save job:", err);
  }
}

async function saveCrawlJob(status) {
  if (!crawlRun) return;
  try {
    const saved = await getJobStore().save(createJob({
      id: crawlRun.jobId,
      mode: "crawl",
      status: status || (crawlRun.running ? "running" : "paused"),
      createdAt: crawlRun.startedAt,
      start: crawlRun.start,
      host: crawlRun.host,
      pages: serializeCrawlPages(crawlRun.pages),
      queue: crawlRun.queueSnapshot || [],
      seen: crawlRun.seenSnapshot || [],
      total: (crawlRun.pages || []).length,
      options: crawlRun.options || {}
    }));
    crawlRun.jobId = saved.id;
  } catch (err) {
    console.error("Could not save crawl job:", err);
  }
}

async function clearJob() {
  try { await getJobStore().clear(); } catch (err) { /* nothing */ }
}

async function showResumeBar() {
  const bar = $("w2mResumeBar");
  if (!bar) return;
  let job = null;
  try { job = await getJobStore().get(); } catch (err) { job = null; }
  if (!job || !isResumable(job)) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
    "<span>Unfinished run: <b>" + esc(jobSummary(job)) + "</b></span>" +
    '<button id="w2mResumeBtn" style="border:1px solid var(--line);background:var(--panel2);color:var(--text);border-radius:8px;padding:7px 13px;font-size:13px;cursor:pointer;font-weight:600;">Resume</button>' +
    '<button id="w2mDiscardBtn" style="border:1px solid var(--line);background:var(--panel2);color:#ff9a9a;border-radius:8px;padding:7px 13px;font-size:13px;cursor:pointer;">Discard</button>' +
    "</div>";
  const resume = document.getElementById("w2mResumeBtn");
  const discard = document.getElementById("w2mDiscardBtn");
  if (resume) resume.addEventListener("click", () => resumeJob(job));
  if (discard) discard.addEventListener("click", async () => { await clearJob(); bar.hidden = true; });
}

async function resumeJob(job) {
  const bar = $("w2mResumeBar");
  if (bar) bar.hidden = true;
  if (!job) return;
  if (job.mode === "batch") await resumeBatchJob(job);
  else if (job.mode === "crawl") await resumeCrawlJob(job);
  else await clearJob();
}

async function resumeBatchJob(job) {
  const prior = deserializeBatchResults(job.done);
  const priorByIndex = new Map(prior.map(r => [r.index, r]));
  const items = (job.items || []).map(i => ({ ...i }));
  batchRun = { items, results: prior.slice(), running: true, stop: false, combined: null, startedAt: Date.now(), jobId: job.id, resumed: true };
  setMode("batch");
  $("w2mBatchResult").hidden = true;
  setBatchBusy(true);
  renderBatchList();
  showBatchProgress("Resuming — <b>" + prior.length + "</b> already captured, <b>" + Math.max(0, items.length - prior.length) + "</b> to go…");
  const outcome = await runBatch(items, {
    delayMs: 300,
    shouldStop: () => batchRun.stop,
    onStart: (item, index, total) => showBatchProgress("Fetching <b>" + esc(item.host || item.raw) + "</b> — " + (index + 1) + " of " + total + "…"),
    onItem: entry => {
      batchRun.results = batchRun.results.filter(r => r.index !== entry.index);
      batchRun.results.push(entry);
      updateBatchRow(entry.index);
      saveBatchJob();
    },
    process: (item, index) => priorByIndex.has(index) ? priorByIndex.get(index).value : processBatchItem(item)
  });
  batchRun.outcome = outcome;
  setBatchBusy(false);
  renderBatchList();
  renderBatchCombined();
  const complete = outcome.ok + outcome.failed >= items.length;
  await saveBatchJob(complete ? "done" : "paused");
  if (complete) await clearJob();
  await showResumeBar();
  showBatchProgress("Resumed and finished — captured <b>" + outcome.ok + "</b> of " + outcome.total + " page" + (outcome.total === 1 ? "" : "s") + ".");
}

async function resumeCrawlJob(job) {
  const prior = deserializeCrawlPages(job.pages);
  const opts = job.options || {};
  const limits = limitsFor(opts);
  crawlRun = {
    running: true, stop: false, startedAt: Date.now(), jobId: job.id, resumed: true,
    pages: prior.slice(), start: job.start, host: job.host, options: { ...opts },
    paths: null, manifest: null, combined: null, outcome: null,
    seenSet: new Set(job.seen || []), queueSnapshot: job.queue || []
  };
  setMode("crawl");
  $("w2mCrawlResult").hidden = true;
  renderCrawlTree();
  setCrawlBusy(true);
  showCrawlProgress("Resuming crawl of <b>" + esc(job.host) + "</b> — " + prior.length + " already captured…");
  const newPages = [];
  try {
    const outcome = await crawlSite(job.start, {
      maxDepth: opts.depth, maxPages: opts.maxPages, sameHostOnly: opts.sameHostOnly, include: opts.include,
      delayMs: 300,
      seed: job.queue, seen: job.seen,
      shouldStop: () => !!(crawlRun && crawlRun.stop),
      fetchPage: url => fetchDocument(url, { fetchImpl: window.root.superFetch, maxBytes: limits.maxBytes }),
      buildDoc: (html, url) => buildDocument(html, { url, ...opts }),
      onStart: (page, count, max) => showCrawlProgress("Fetching <b>" + esc(page.url) + "</b> — " + count + " of " + max + "…"),
      onQueue: queue => { crawlRun.queueSnapshot = queue; for (const n of queue) crawlRun.seenSet.add(crawlKey(n.url)); saveCrawlJob(); },
      onVisit: page => {
        newPages.push(page);
        crawlRun.pages = prior.concat(newPages);
        crawlRun.seenSet.add(crawlKey(page.url));
        renderCrawlTree();
        saveCrawlJob();
      }
    });
    crawlRun.pages = prior.concat(outcome.pages);
    crawlRun.outcome = outcome;
    crawlRun.seenSnapshot = Array.from(crawlRun.seenSet);
    renderCrawlTree();
    renderCrawlResult();
    const complete = !outcome.stopped;
    await saveCrawlJob(complete ? "done" : "paused");
    if (complete) await clearJob();
    await showResumeBar();
    showCrawlProgress("Resumed crawl finished — captured <b>" + outcome.ok + "</b> page" + (outcome.ok === 1 ? "" : "s") + ".");
  } catch (err) {
    console.error("Resume crawl failed:", err);
    showCrawlProgress("Resume failed: " + esc((err && err.message) || err), true);
  } finally {
    crawlRun.running = false;
    setCrawlBusy(false);
    renderCrawlTree();
  }
}

/* ---------------- inbox launcher + bookmarklet ---------------- */

function switchTab(name) {
  const btn = document.getElementById(name === "theme" ? "tabThemeBtn" : "tabWebBtn");
  if (btn) btn.click();
}

function routeInput(text) {
  const detected = detectInput(text);
  const inbox = $("w2mInboxInput");
  if (inbox) inbox.value = detected.value;
  if (detected.kind === "generator") {
    switchTab("theme");
    const input = document.getElementById("genInput");
    if (input) input.value = detected.value;
    return detected;
  }
  if (detected.kind === "urls") {
    switchTab("web");
    setMode("batch");
    $("w2mBatchInput").value = detected.value;
    updateBatchCount();
    return detected;
  }
  if (detected.kind === "url") {
    switchTab("web");
    setMode("single");
    $("w2mUrlInput").value = detected.value;
    return detected;
  }
  return detected;
}

function inboxGo() {
  const text = $("w2mInboxInput").value;
  if (!text.trim()) { $("w2mInboxInput").focus(); return; }
  const detected = routeInput(text);
  const btn = $("w2mInboxBtn");
  if (detected.kind === "generator") flashBtn(btn, "Theme tab");
  else if (detected.kind === "urls") flashBtn(btn, "Batch: " + detected.count + " URLs");
  else if (detected.kind === "url") flashBtn(btn, "Ready to capture");
  else flashBtn(btn, "Not a URL");
}

function showBookmarklet() {
  const code = bookmarkletCode(window.generatorName);
  const body = openModal({ title: "Bookmarklet — send any page to Extrax" });
  body.appendChild(el("p", { class: "exmuted", text: "Drag the button below to your bookmarks bar. On any web page, clicking it opens Extrax with that page ready to capture. You can also copy the code and paste it as a new bookmark's URL." }));
  const link = el("a", { class: "exbtn prim", href: code, text: "Send to Extrax", style: "text-decoration:none; display:inline-block;" });
  body.appendChild(el("div", { class: "exrow" }, [link]));
  const pre = el("pre", { class: "extrax-pre" });
  pre.textContent = code;
  body.appendChild(pre);
  body.appendChild(el("div", { class: "exrow" }, [
    el("button", { class: "exbtn prim", text: "Copy bookmarklet code", onClick: e => copyText(code).then(() => flashBtn(e.currentTarget, "Copied!")) })
  ]));
}

function handleLaunchHash() {
  const payload = parseLaunchHash(window.location.hash);
  if (!payload || !payload.value) return false;
  const inbox = $("w2mInboxInput");
  if (inbox) inbox.value = payload.value;
  if (payload.kind === "generator") {
    switchTab("theme");
    const input = document.getElementById("genInput");
    if (input) input.value = payload.value;
    return true;
  }
  switchTab("web");
  if (payload.kind === "urls") {
    setMode("batch");
    $("w2mBatchInput").value = payload.value;
    updateBatchCount();
    return true;
  }
  setMode("single");
  $("w2mUrlInput").value = payload.value;
  if (payload.auto) capturePage();
  return true;
}

/* ---------------- shell ---------------- */

function initTabs() {
  const themeBtn = $("tabThemeBtn");
  const webBtn = $("tabWebBtn");
  const themePane = $("paneTheme");
  const webPane = $("paneWeb");
  if (!themeBtn || !webBtn) return;

  const select = name => {
    const web = name === "web";
    themeBtn.classList.toggle("active", !web);
    webBtn.classList.toggle("active", web);
    themeBtn.setAttribute("aria-selected", String(!web));
    webBtn.setAttribute("aria-selected", String(web));
    themePane.hidden = web;
    webPane.hidden = !web;
  };

  themeBtn.addEventListener("click", () => select("theme"));
  webBtn.addEventListener("click", () => select("web"));
  select("theme");
}

function initExtras() {
  $("w2mModeWatch").addEventListener("click", () => setMode("watch"));

  $("w2mTablesBtn").addEventListener("click", opTables);
  $("w2mInventoryBtn").addEventListener("click", opInventory);
  $("w2mWatchThisBtn").addEventListener("click", addWatchCurrent);
  $("w2mBundleBtn").addEventListener("click", libraryBundle);
  $("w2mCrawlEpubBtn").addEventListener("click", crawlEpub);

  $("docBundleBtn").addEventListener("click", libraryBundle);
  $("docEpubBtn").addEventListener("click", libraryEpub);
  $("docAskBtn").addEventListener("click", askLibrary);
  $("docAskStopBtn").addEventListener("click", stopAsk);
  $("docAskInput").addEventListener("keydown", e => { if (e.key === "Enter") askLibrary(); });

  $("w2mWatchAddBtn").addEventListener("click", addWatchUrl);
  $("w2mWatchInput").addEventListener("keydown", e => { if (e.key === "Enter") addWatchUrl(); });
  $("w2mWatchCheckBtn").addEventListener("click", checkAllWatches);
  $("w2mWatchList").addEventListener("click", handleWatchListClick);

  $("w2mInboxBtn").addEventListener("click", inboxGo);
  $("w2mInboxInput").addEventListener("keydown", e => { if (e.key === "Enter") inboxGo(); });
  $("w2mBookmarkletBtn").addEventListener("click", showBookmarklet);

  loadWatch();
  showResumeBar();
  handleLaunchHash();
  window.addEventListener("hashchange", handleLaunchHash);
}

function init() {
  initTabs();
  initBatch();
  initCleanup();
  initCrawl();
  initDocIo();
  initExtras();
  $("w2mCaptureBtn").addEventListener("click", capturePage);
  $("w2mUrlInput").addEventListener("keydown", e => { if (e.key === "Enter") capturePage(); });
  $("w2mTestBtn").addEventListener("click", runSelfTests);
  for (const id of ["w2mOptImages", "w2mOptFrontmatter", "w2mOptLinkMode", "w2mOptLimit"]) {
    $(id).addEventListener("change", applyOptions);
  }
  $("w2mDownloadBtn").addEventListener("click", downloadCurrent);
  $("w2mCopyBtn").addEventListener("click", copyCurrent);
  $("w2mSaveBtn").addEventListener("click", saveToLibrary);
  $("docSearchInput").addEventListener("input", renderDocLibrary);

  loadDocs();

  window.w2m = {
    fetchDocument,
    extractContent,
    convertHtmlToMarkdown,
    extractMetadata,
    formatFrontmatter,
    buildDocument,
    markdownStats,
    createDocRecord,
    docFilename,
    uniqueFilename,
    matchDoc,
    limitsFor,
    truncationSummary,
    parseUrlList,
    runBatch,
    combineDocuments,
    analyzeQuality,
    qualitySummary,
    qualityDelta,
    cleanupPresets,
    presetByKey,
    buildCleanupPrompt,
    normalizeCleanupOutput,
    fitToBudget,
    applyBody,
    docsToJson,
    docsFromJson,
    docsToMarkdown,
    parseDocsMarkdown,
    makeImportedRecord,
    loadDocs,
    renderDocLibrary,
    runTests,
    capturePage,
    renderResult,
    renderQuality,
    resetCleanState,
    renderCleanReview,
    renderRevisionBar,
    startCleanup,
    stopCleanup,
    acceptCleanup,
    rejectCleanup,
    revertCleanup,
    copyCleanup,
    downloadCleanup,
    cleanBatchItem,
    docExportJson,
    docExportMarkdown,
    handleDocImportFiles,
    startBatch,
    retryBatchItem,
    applyOptions,
    rebuildBatchDocs,
    downloadCurrent,
    copyCurrent,
    saveToLibrary,
    batchSaveAllFiles,
    removeBatchItem,
    batchCopyCombined,
    batchSaveAll,
    buildExportFiles,
    setMode,
    currentOptions,
    crawlSite,
    crawlTree,
    crawlFilePaths,
    crawlManifest,
    crawlFilePath,
    createZip,
    normalizeCrawlUrl,
    startCrawl,
    stopCrawl,
    crawlDocs,
    crawlDownloadZip,
    crawlSaveAllFiles,
    removeCrawlPage,
    crawlSaveAll,
    crawlCopyIndex,
    crawlTreeRender: renderCrawlTree,
    opTables,
    opInventory,
    libraryBundle,
    libraryEpub,
    askLibrary,
    stopAsk,
    addWatchCurrent,
    addWatchUrl,
    checkWatch,
    checkAllWatches,
    removeWatch,
    viewWatchDiff,
    loadWatch,
    resumeJob,
    showResumeBar,
    saveBatchJob,
    saveCrawlJob,
    inboxGo,
    routeInput,
    showBookmarklet,
    handleLaunchHash,
    tablesFromHtml,
    inventoryFromHtml,
    diffLines,
    buildContextBundle,
    buildEpub,
    docs: () => docRecords,
    batch: () => batchRun,
    crawl: () => crawlRun,
    clean: () => cleanState,
    watches: () => watchRecords,
    ask: () => askState,
    runSelfTests,
    last: () => lastCapture
  };
}

init();
