// ============================================================================
//  VALIDATION TESTS — T4 Rich Text Input Surface
//
//  `runRichTextTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/richtext.test.js");
//    await m.runRichTextTests()
//
//  Pure model tests cover the RichText engine in src/richtext.js; light fuzz
//  checks round-trip stability; a final DOM-backed test drives the real
//  editor in the live docs window.
//
//  Markdown conventions (distinct markers so round-trips are unambiguous):
//  bold **…**, italic _…_ (input also accepts *…*), underline ~…~.
// ============================================================================

import { RichText } from "../richtext.js";
import { documentRegistry } from "../registry.js";

export async function runRichTextTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Model: clean output ──────────────────────────────────────────────────
  await t("empty doc produces clean empty output", () => {
    const r = new RichText();
    if (r.getHTML() !== "<p></p>") throw new Error("html: " + r.getHTML());
    if (r.getMarkdown() !== "") throw new Error("md: " + r.getMarkdown());
    if (r.getPlainText() !== "") throw new Error("text: " + r.getPlainText());
    if (!r.isEmpty()) throw new Error("should be empty");
  });

  await t("fromHTML of an empty paragraph terminates cleanly", () => {
    const r = RichText.fromHTML("<p></p>");
    if (r.getHTML() !== "<p></p>") throw new Error(r.getHTML());
    if (!r.isEmpty()) throw new Error("should be empty");
  });

  await t("fromHTML parses strong/em/u into format flags", () => {
    const r = RichText.fromHTML(
      "<p>Hello <strong>world</strong> and <em>friends</em> and <u>more</u></p>"
    );
    if (r.getMarkdown() !== "Hello **world** and _friends_ and ~more~")
      throw new Error(r.getMarkdown());
    if (r.getPlainText() !== "Hello world and friends and more")
      throw new Error(r.getPlainText());
  });

  await t("getHTML emits only clean p/strong/em/u tags", () => {
    const r = RichText.fromHTML("<p>a<strong>b</strong><em>c</em><u>d</u></p>");
    const html = r.getHTML();
    if (html !== "<p>a<strong>b</strong><em>c</em><u>d</u></p>") throw new Error(html);
  });

  await t("combined formats nest cleanly", () => {
    const r = new RichText([{ runs: [{ t: "all", b: true, i: true, u: true }] }]);
    if (r.getHTML() !== "<p><u><em><strong>all</strong></em></u></p>") throw new Error(r.getHTML());
    if (r.getMarkdown() !== "~_**all**_~") throw new Error(r.getMarkdown());
  });

  await t("HTML entities are decoded (named + numeric)", () => {
    const r = RichText.fromHTML("<p>Tom &amp; Jerry &lt;3 &quot;hi&quot; &#65; &#x42; &nbsp;</p>");
    if (r.getPlainText() !== 'Tom & Jerry <3 "hi" A B \u00a0') throw new Error(r.getPlainText());
    if (r.getHTML() !== "<p>Tom &amp; Jerry &lt;3 &quot;hi&quot; A B \u00a0</p>")
      throw new Error(r.getHTML());
  });

  // ── Model: applyFormat ───────────────────────────────────────────────────
  await t("applyFormat makes a range bold", () => {
    const r = RichText.fromMarkdown("The quick brown fox");
    r.applyFormat(4, 9, "b");
    if (r.getMarkdown() !== "The **quick** brown fox") throw new Error(r.getMarkdown());
    if (r.getHTML() !== "<p>The <strong>quick</strong> brown fox</p>") throw new Error(r.getHTML());
  });

  await t("applyFormat toggles off an already-bold range", () => {
    const r = RichText.fromMarkdown("The **quick** brown fox");
    r.applyFormat(4, 9, "b");
    if (r.getMarkdown() !== "The quick brown fox") throw new Error(r.getMarkdown());
  });

  await t("partial re-selection toggles only the overlap", () => {
    const r = RichText.fromMarkdown("The **quick** brown fox");
    r.applyFormat(0, 6, "b");
    if (r.getMarkdown() !== "**The **qu**ick** brown fox") throw new Error(r.getMarkdown());
  });

  await t("italic and underline apply independently", () => {
    const r = RichText.fromMarkdown("plain text");
    r.applyFormat(0, 5, "i");
    r.applyFormat(6, 10, "u");
    if (r.getMarkdown() !== "_plain_ ~text~") throw new Error(r.getMarkdown());
    if (r.getHTML() !== "<p><em>plain</em> <u>text</u></p>") throw new Error(r.getHTML());
  });

  await t("applyFormat works across multiple blocks", () => {
    const r = RichText.fromMarkdown("aaa\n\nbbb");
    r.applyFormat(1, 6, "b");
    if (r.getMarkdown() !== "a**aa**\n\n**bbb**") throw new Error(r.getMarkdown());
  });

  await t("applyFormat clamps out-of-range selections instead of corrupting", () => {
    const a = RichText.fromMarkdown("abc");
    a.applyFormat(3, 3, "b");
    if (a.getMarkdown() !== "abc") throw new Error(a.getMarkdown());
    const b = RichText.fromMarkdown("abc");
    b.applyFormat(-5, 50, "b");
    if (b.getMarkdown() !== "**abc**") throw new Error(b.getMarkdown());
    const c = RichText.fromMarkdown("abc");
    c.applyFormat(10, 20, "b");
    if (c.getMarkdown() !== "abc") throw new Error(c.getMarkdown());
  });

  // ── Model: insert / delete ───────────────────────────────────────────────
  await t("insertText inserts at offsets and keeps run format", () => {
    const r = RichText.fromMarkdown("**bold**");
    r.insertText(0, "x");
    if (r.getMarkdown() !== "**xbold**") throw new Error(r.getMarkdown());
    r.insertText(5, "!");
    if (r.getMarkdown() !== "**xbold!**") throw new Error(r.getMarkdown());
    const p = RichText.fromMarkdown("abc");
    p.insertText(1, "X");
    if (p.getPlainText() !== "aXbc") throw new Error(p.getPlainText());
  });

  await t("insertText inside formatted text inherits the surrounding format", () => {
    const r = RichText.fromMarkdown("**bold** and _ital_");
    r.insertText(4, "!");
    if (r.getMarkdown() !== "**bold!** and _ital_") throw new Error(r.getMarkdown());
    r.insertText(10, "X");
    if (r.getMarkdown() !== "**bold!** and X_ital_") throw new Error(r.getMarkdown());
    if (r.getPlainText() !== "bold! and Xital") throw new Error(r.getPlainText());
  });

  await t("deleteRange removes text across blocks", () => {
    const r = RichText.fromMarkdown("abc\n\ndef");
    r.deleteRange(1, 5);
    if (r.getPlainText() !== "a\n\nf") throw new Error(r.getPlainText());
  });

  await t("deleteRange preserves formatting on boundary runs", () => {
    const r = RichText.fromMarkdown("a**bc**d");
    r.deleteRange(1, 3);
    if (r.getMarkdown() !== "ad") throw new Error(r.getMarkdown());
    const s = RichText.fromMarkdown("a**bc**d");
    s.deleteRange(1, 2);
    if (s.getMarkdown() !== "a**c**d") throw new Error(s.getMarkdown());
  });

  await t("deleteRange of everything leaves one empty block", () => {
    const r = RichText.fromMarkdown("abc");
    r.deleteRange(0, 3);
    if (r.getPlainText() !== "" || !r.isEmpty()) throw new Error(r.getPlainText());
  });

  // ── Model: cleanliness & robustness ──────────────────────────────────────
  await t("markdown special characters are escaped in output", () => {
    const r = RichText.fromHTML("<p>price 5 * 3</p>");
    r.applyFormat(6, 11, "b");
    if (r.getMarkdown() !== "price **5 \\* 3**") throw new Error(r.getMarkdown());
  });

  await t("messy input HTML is normalized to clean output", () => {
    const html = `<p style="margin:0"><b>B</b> <SPAN style="font-weight:bold">S</SPAN></p><div>D<br>E</div>`;
    const r = RichText.fromHTML(html);
    if (r.getMarkdown() !== "**B** **S**\n\nD\nE") throw new Error(r.getMarkdown());
    if (r.getHTML() !== "<p><strong>B</strong> <strong>S</strong></p><p>D<br>E</p>")
      throw new Error(r.getHTML());
  });

  await t("unknown/formatting tags are transparent (text preserved)", () => {
    const r = RichText.fromHTML('<p>Read the <a href="#">docs</a>.</p>');
    if (r.getPlainText() !== "Read the docs.") throw new Error(r.getPlainText());
  });

  await t("simple markdown round-trips to canonical markdown", () => {
    const r = RichText.fromMarkdown("**Bold** and *italic* and ~under~");
    if (r.getMarkdown() !== "**Bold** and _italic_ and ~under~") throw new Error(r.getMarkdown());
    if (r.getHTML() !== "<p><strong>Bold</strong> and <em>italic</em> and <u>under</u></p>")
      throw new Error(r.getHTML());
  });

  await t("nested markdown round-trips to the same document", () => {
    const r1 = RichText.fromMarkdown("**bold _nested_ bold**");
    const r2 = RichText.fromMarkdown(r1.getMarkdown());
    if (r1.getHTML() !== r2.getHTML()) {
      throw new Error(r1.getMarkdown() + " vs " + r2.getMarkdown());
    }
  });

  await t("adjacent italic-only and bold-italic runs round-trip", () => {
    const r1 = new RichText([{ runs: [{ t: "one", i: true }, { t: "two", b: true, i: true }] }]);
    if (r1.getMarkdown() !== "_one__**two**_") throw new Error(r1.getMarkdown());
    const r2 = RichText.fromMarkdown(r1.getMarkdown());
    if (r2.getHTML() !== r1.getHTML()) throw new Error(r2.getHTML());
  });

  await t("word and character counts ignore formatting markers", () => {
    const r = RichText.fromMarkdown("**Two** words");
    if (r.wordCount() !== 2) throw new Error("" + r.wordCount());
    if (r.charCount() !== 9) throw new Error("" + r.charCount());
  });

  await t("whitespace-only content is empty", () => {
    const r = RichText.fromMarkdown("   ");
    if (!r.isEmpty() || r.getPlainText() !== "") throw new Error(r.getPlainText());
  });

  // ── Fuzz: round-trip stability ───────────────────────────────────────────
  const FUZZ_WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
  const INLINE = ["strong", "em", "u"];
  const rnd = (n) => Math.floor(Math.random() * n);

  const htmlFrag = (depth) => {
    let s = FUZZ_WORDS[rnd(FUZZ_WORDS.length)];
    if (depth < 3 && Math.random() < 0.7) {
      const tag = INLINE[rnd(INLINE.length)];
      s = `<${tag}>${htmlFrag(depth + 1)}</${tag}>`;
    }
    return s;
  };
  const randomHTMLDoc = () => {
    const n = 1 + rnd(4);
    const frags = [];
    for (let i = 0; i < n; i++) frags.push(htmlFrag(0));
    return "<p>" + frags.join(" ") + "</p>";
  };

  await t("fuzz: 50 random HTML docs round-trip exactly", () => {
    for (let i = 0; i < 50; i++) {
      const html = randomHTMLDoc();
      const r1 = RichText.fromHTML(html);
      const h1 = r1.getHTML();
      const r2 = RichText.fromHTML(h1);
      if (r2.getHTML() !== h1) throw new Error("unstable html: " + h1);
      if (r2.getPlainText() !== r1.getPlainText()) throw new Error("plain drift: " + h1);
    }
  });

  const randomMDDoc = () => {
    const n = 1 + rnd(8);
    let out = "";
    for (let i = 0; i < n; i++) {
      let w = FUZZ_WORDS[rnd(FUZZ_WORDS.length)];
      const r = Math.random();
      if (r < 0.3) w = `**${w}**`;
      else if (r < 0.55) w = `_${w}_`;
      else if (r < 0.7) w = `~${w}~`;
      else if (r < 0.8) w = `**_${w}_**`;
      else if (r < 0.9) w = `**~${w}~**`;
      else w = `_~${w}~_`;
      out += w + (Math.random() < 0.5 ? " " : "");
    }
    return out;
  };

  await t("fuzz: 50 random Markdown docs are canonically idempotent", () => {
    for (let i = 0; i < 50; i++) {
      const md = randomMDDoc();
      const r1 = RichText.fromMarkdown(md);
      const r2 = RichText.fromMarkdown(r1.getMarkdown());
      if (r2.getHTML() !== r1.getHTML()) throw new Error("unstable md: " + r1.getMarkdown());
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
    await t("docs window mounts a live editor that formats and syncs to the registry", async () => {
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

      page.innerHTML = "<p>Hello world</p>";
      page.dispatchEvent(new Event("input", { bubbles: true }));

      const p = page.firstElementChild;
      const textNode = p && p.firstChild;
      if (!textNode) throw new Error("no text node to select");
      const range = document.createRange();
      range.setStart(textNode, 6);
      range.setEnd(textNode, 11);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      const boldBtn = document.querySelector('.desk-win.active .docs-app .doc-fmt-btn[data-fmt="b"]');
      if (!boldBtn) throw new Error("bold button missing");
      boldBtn.click();

      if (page.innerHTML.indexOf("<strong>world</strong>") === -1)
        throw new Error("bold not applied: " + page.innerHTML);

      const mdBtn = document.querySelector('.desk-win.active .docs-app .doc-view-btn[data-view="md"]');
      mdBtn.click();
      const pre = document.querySelector(".desk-win.active .docs-app .doc-out-pre");
      if (!pre || pre.textContent !== "Hello **world**")
        throw new Error("clean markdown wrong: " + (pre && pre.textContent));
      if (doc.content !== "Hello **world**")
        throw new Error("registry not synced: " + doc.content);

      const docBtn = document.querySelector('.desk-win.active .docs-app .doc-view-btn[data-view="doc"]');
      if (docBtn) docBtn.click();
      documentRegistry.update(doc.id, { content: orig });
    });
  }

  return results;
}
