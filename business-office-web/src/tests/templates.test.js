// ============================================================================
//  VALIDATION TESTS — T6 Template Loader
//
//  `runTemplateTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/templates.test.js");
//    await m.runTemplateTests()
//
//  Pure tests cover the template catalog in src/templates.js; DOM-backed tests
//  drive the live docs-window Templates menu and assert that loading each
//  template puts exactly its content into the editor and the registry.
// ============================================================================

import { RichText } from "../richtext.js";
import { documentRegistry } from "../registry.js";
import { documentTemplates, findTemplate } from "../templates.js";

export async function runTemplateTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: catalog integrity ──────────────────────────────────────────────
  await t("templates have unique ids and non-empty names", () => {
    const ids = new Set();
    for (const tpl of documentTemplates) {
      if (!tpl.id || !tpl.name || !tpl.content || !tpl.category) throw new Error("incomplete: " + JSON.stringify(tpl.id));
      if (ids.has(tpl.id)) throw new Error("duplicate id: " + tpl.id);
      ids.add(tpl.id);
    }
    if (documentTemplates.length < 2) throw new Error("need at least 2 templates");
  });

  await t("findTemplate resolves every catalog id and rejects unknown ids", () => {
    for (const tpl of documentTemplates) {
      if (findTemplate(tpl.id) !== tpl) throw new Error("miss: " + tpl.id);
    }
    if (findTemplate("nope") !== undefined) throw new Error("unknown id resolved");
  });

  // ── Pure: every template parses to a real, non-empty document ───────────
  await t("every template parses to a valid non-empty document", () => {
    for (const tpl of documentTemplates) {
      let r;
      try {
        r = RichText.fromMarkdown(tpl.content);
      } catch (e) {
        throw new Error(tpl.id + " threw: " + e.message);
      }
      if (r.isEmpty()) throw new Error(tpl.id + " parsed empty");
      if (r.wordCount() < 10) throw new Error(tpl.id + " too thin: " + r.wordCount() + " words");
      if (!r.getPlainText().trim()) throw new Error(tpl.id + " no plain text");
    }
  });

  // ── Pure: templates live in the canonical Markdown subset ───────────────
  await t("template markdown round-trips through the model byte-exact", () => {
    for (const tpl of documentTemplates) {
      const out = RichText.fromMarkdown(tpl.content).getMarkdown();
      if (out !== tpl.content) throw new Error(tpl.id + " drift:\n---\n" + out + "\n---\n" + tpl.content);
    }
  });

  await t("templates avoid unsupported constructs (headings, lists, pipes)", () => {
    for (const tpl of documentTemplates) {
      const firsts = new Set(
        tpl.content
          .split("\n")
          .map((l) => l.trimStart().slice(0, 1))
          .filter((c) => c)
      );
      for (const bad of ["#", "-", "|"]) {
        if (firsts.has(bad)) throw new Error(tpl.id + " starts a line with " + bad);
      }
      if (/\[[^\]\n]*\n[^\]]*\]/.test(tpl.content)) throw new Error(tpl.id + " may contain unbalanced brackets");
    }
  });

  await t("each template carries its expected placeholder content", () => {
    const expect = {
      memo: ["MEMORANDUM", "SUBJECT", "Action required"],
      letter: ["Sincerely", "Dear", "Re:"],
      agenda: ["MEETING AGENDA", "Action items", "Attendees"],
      report: ["WEEKLY STATUS REPORT", "Blockers", "Planned for next week"],
    };
    for (const tpl of documentTemplates) {
      const text = RichText.fromMarkdown(tpl.content).getPlainText();
      for (const word of expect[tpl.id] || []) {
        if (!text.includes(word)) throw new Error(tpl.id + " missing '" + word + "'");
      }
    }
  });

  // ── Editor surface (page only) ───────────────────────────────────────────
  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (domOk) {
    await t("Templates menu exists in the docs toolbar", async () => {
      location.hash = "#/app/docs";
      let sel = null;
      for (let i = 0; i < 40; i++) {
        sel = document.querySelector(".desk-win.active .docs-app .doc-template-select");
        if (sel) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!sel) throw new Error("template select did not mount");
      const opts = [...sel.options].map((o) => o.value).filter(Boolean);
      for (const tpl of documentTemplates) {
        if (!opts.includes(tpl.id)) throw new Error("option missing: " + tpl.id);
      }
      if (opts.length !== documentTemplates.length) throw new Error("extra options: " + opts.join(","));
    });

    await t("loading each template puts its exact content in the editor + registry", async () => {
      location.hash = "#/app/docs";
      let page = null;
      for (let i = 0; i < 40; i++) {
        page = document.querySelector(".desk-win.active .docs-app .doc-page");
        if (page) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!page) throw new Error("docs editor did not mount");
      const sel = document.querySelector(".desk-win.active .docs-app .doc-template-select");
      const doc = documentRegistry.listByApp("docs")[0];
      if (!doc) throw new Error("no docs registry doc");
      const orig = doc.content;
      const realConfirm = window.confirm;
      window.confirm = () => true;
      try {
        for (const tpl of documentTemplates) {
          sel.value = tpl.id;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          const want = RichText.fromMarkdown(tpl.content);
          if (page.innerHTML !== want.getHTML())
            throw new Error(tpl.id + " page mismatch:\n" + page.innerHTML + "\n---\n" + want.getHTML());
          if (doc.content !== tpl.content)
            throw new Error(tpl.id + " registry mismatch:\n" + doc.content + "\n---\n" + tpl.content);
          if (sel.value !== "") throw new Error(tpl.id + " select not reset");
        }
      } finally {
        window.confirm = realConfirm;
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("loading a template onto an empty document does not prompt", async () => {
      location.hash = "#/app/docs";
      let page = null;
      for (let i = 0; i < 40; i++) {
        page = document.querySelector(".desk-win.active .docs-app .doc-page");
        if (page) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!page) throw new Error("docs editor did not mount");
      const sel = document.querySelector(".desk-win.active .docs-app .doc-template-select");
      const doc = documentRegistry.listByApp("docs")[0];
      const orig = doc.content;
      documentRegistry.update(doc.id, { content: "" });
      page.innerHTML = "";
      page.dispatchEvent(new Event("input", { bubbles: true }));
      const realConfirm = window.confirm;
      let prompted = 0;
      window.confirm = () => { prompted++; return true; };
      try {
        const tpl = documentTemplates[0];
        sel.value = tpl.id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        if (prompted !== 0) throw new Error("prompted on empty doc");
        if (doc.content !== tpl.content) throw new Error("not loaded");
      } finally {
        window.confirm = realConfirm;
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("cancelling the overwrite prompt keeps the current document", async () => {
      location.hash = "#/app/docs";
      let page = null;
      for (let i = 0; i < 40; i++) {
        page = document.querySelector(".desk-win.active .docs-app .doc-page");
        if (page) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!page) throw new Error("docs editor did not mount");
      const sel = document.querySelector(".desk-win.active .docs-app .doc-template-select");
      const doc = documentRegistry.listByApp("docs")[0];
      const orig = doc.content;
      const keepText = "My precious draft";
      documentRegistry.update(doc.id, { content: keepText });
      page.innerHTML = "<p>" + keepText + "</p>";
      page.dispatchEvent(new Event("input", { bubbles: true }));
      const realConfirm = window.confirm;
      let prompted = 0;
      window.confirm = () => { prompted++; return false; };
      try {
        const tpl = documentTemplates[0];
        sel.value = tpl.id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        if (prompted !== 1) throw new Error("did not prompt on non-empty doc");
        if (doc.content !== keepText) throw new Error("content replaced despite cancel");
        if (page.innerHTML !== "<p>" + keepText + "</p>") throw new Error("page replaced despite cancel");
        if (sel.value !== "") throw new Error("select not reset after cancel");
      } finally {
        window.confirm = realConfirm;
        documentRegistry.update(doc.id, { content: orig });
      }
    });
  }

  return results;
}
