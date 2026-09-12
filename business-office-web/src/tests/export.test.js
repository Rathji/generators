// ============================================================================
//  VALIDATION TESTS — T5 Document Export Module
//
//  `runExportTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/export.test.js");
//    await m.runExportTests()
//
//  Pure tests cover the file-packaging functions in src/export.js; DOM-backed
//  tests drive the real docs-window export buttons and capture the Blobs the
//  download path actually produces.
// ============================================================================

import { RichText } from "../richtext.js";
import { documentRegistry } from "../registry.js";
import { renderHTMLFile, renderTextFile, sanitizeFilename, exportDocument } from "../export.js";

export async function runExportTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: filename sanitation ────────────────────────────────────────────
  await t("sanitizeFilename strips illegal characters and falls back", () => {
    if (sanitizeFilename('Report: Q3 "Final" 2027') !== "Report_ Q3 _Final_ 2027")
      throw new Error(sanitizeFilename('Report: Q3 "Final" 2027'));
    if (sanitizeFilename('a/b\\c:d*e?f"g<h>i|j') !== "a_b_c_d_e_f_g_h_i_j")
      throw new Error(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'));
    if (sanitizeFilename("   ") !== "document") throw new Error("ws");
    if (sanitizeFilename("") !== "document") throw new Error("empty");
    if (sanitizeFilename(undefined) !== "document") throw new Error("undef");
    const long = sanitizeFilename("x".repeat(200));
    if (long.length > 80) throw new Error("not truncated: " + long.length);
  });

  // ── Pure: HTML file packaging ────────────────────────────────────────────
  await t("renderHTMLFile wraps the clean body in a full standalone document", () => {
    const r = RichText.fromMarkdown("The **quick** brown fox");
    const html = renderHTMLFile(r, { title: 'Q3 & "Final" Report' });
    if (!html.startsWith("<!DOCTYPE html>")) throw new Error("no doctype");
    if (!/<title>Q3 &amp; &quot;Final&quot; Report<\/title>/.test(html))
      throw new Error("title not escaped");
    if (html.indexOf('<main class="doc">') === -1) throw new Error("no body wrapper");
    const body = html.split('<main class="doc">')[1].split("</main>")[0];
    if (body !== r.getHTML()) throw new Error("body drift: " + body);
  });

  await t("an empty document exports a valid empty page", () => {
    const r = new RichText();
    const html = renderHTMLFile(r, { title: "Empty" });
    if (html.indexOf('<main class="doc"><p></p></main>') === -1) throw new Error(html);
    const txt = renderTextFile(r, { title: "Empty" });
    if (txt !== "# Empty\n\n") throw new Error(JSON.stringify(txt));
  });

  // ── Pure: text file packaging ────────────────────────────────────────────
  await t("renderTextFile writes a title header then the exact plain text", () => {
    const r = RichText.fromMarkdown("Line one\n\nLine two");
    const withTitle = renderTextFile(r, { title: "Memo" });
    if (withTitle !== "# Memo\n\nLine one\n\nLine two\n")
      throw new Error(JSON.stringify(withTitle));
    const bare = renderTextFile(r);
    if (bare !== "Line one\n\nLine two\n") throw new Error(JSON.stringify(bare));
  });

  // ── Pure: round-trip ─────────────────────────────────────────────────────
  await t("exported HTML body re-parses back to the identical document", () => {
    const r = RichText.fromMarkdown("**Bold** and _italic_ and ~under~\n\nSecond paragraph");
    const html = renderHTMLFile(r, { title: "T" });
    const body = html.split('<main class="doc">')[1].split("</main>")[0];
    const r2 = RichText.fromHTML(body);
    if (r2.getHTML() !== r.getHTML()) throw new Error(r2.getHTML());
    if (r2.getPlainText() !== r.getPlainText()) throw new Error(r2.getPlainText());
  });

  // ── Editor surface (page only) ───────────────────────────────────────────
  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (domOk) {
    await t("exportDocument produces a real download with correct file + content", async () => {
      const realCRO = URL.createObjectURL;
      const realRVO = URL.revokeObjectURL;
      const realClick = HTMLAnchorElement.prototype.click;
      let clicked = null;
      window.__exportBlob = null;
      URL.createObjectURL = (b) => { window.__exportBlob = b; return "blob:stub"; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function () { clicked = { name: this.download, href: this.href }; };
      try {
        const r = RichText.fromMarkdown("Hello **world**");
        const html = exportDocument(r, { title: "My Doc", format: "html" });
        if (html.filename !== "My Doc.html") throw new Error(html.filename);
        if (html.mime !== "text/html") throw new Error(html.mime);
        if (!clicked || clicked.name !== "My Doc.html") throw new Error("anchor not clicked");
        const blobText = await window.__exportBlob.text();
        if (blobText.indexOf('<main class="doc"><p>Hello <strong>world</strong></p></main>') === -1)
          throw new Error(blobText.slice(0, 120));

        const txt = exportDocument(r, { title: "My Doc", format: "txt" });
        if (txt.filename !== "My Doc.txt") throw new Error(txt.filename);
        const txtText = await window.__exportBlob.text();
        if (txtText !== "# My Doc\n\nHello world\n") throw new Error(JSON.stringify(txtText));
      } finally {
        URL.createObjectURL = realCRO;
        URL.revokeObjectURL = realRVO;
        HTMLAnchorElement.prototype.click = realClick;
        window.__exportBlob = null;
      }
    });

    await t("docs toolbar export buttons download the live document", async () => {
      location.hash = "#/app/docs";
      let page = null;
      for (let i = 0; i < 40; i++) {
        page = document.querySelector(".desk-win.active .docs-app .doc-page");
        if (page) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!page) throw new Error("docs editor did not mount");
      const doc = documentRegistry.listByApp("docs")[0];
      if (!doc) throw new Error("no docs registry doc");
      const orig = doc.content;
      const title = (doc.meta && doc.meta.name) || "Untitled Documents";

      page.innerHTML = "<p>Export me</p>";
      page.dispatchEvent(new Event("input", { bubbles: true }));

      const realCRO = URL.createObjectURL;
      const realRVO = URL.revokeObjectURL;
      const realClick = HTMLAnchorElement.prototype.click;
      window.__exportBlob = null;
      URL.createObjectURL = (b) => { window.__exportBlob = b; return "blob:stub"; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function () {};
      try {
        const htmlBtn = document.querySelector('.desk-win.active .docs-app .doc-export-btn[data-ext="html"]');
        if (!htmlBtn) throw new Error("html export button missing");
        htmlBtn.click();
        const html = await window.__exportBlob.text();
        if (html.indexOf("<p>Export me</p>") === -1) throw new Error("body missing");
        if (!html.includes("<title>")) throw new Error("no title");

        const txtBtn = document.querySelector('.desk-win.active .docs-app .doc-export-btn[data-ext="txt"]');
        if (!txtBtn) throw new Error("txt export button missing");
        txtBtn.click();
        const txt = await window.__exportBlob.text();
        if (txt !== "# " + title + "\n\nExport me\n")
          throw new Error(JSON.stringify(txt));
      } finally {
        URL.createObjectURL = realCRO;
        URL.revokeObjectURL = realRVO;
        HTMLAnchorElement.prototype.click = realClick;
        window.__exportBlob = null;
        documentRegistry.update(doc.id, { content: orig });
      }
    });
  }

  return results;
}
