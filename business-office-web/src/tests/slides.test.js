// ============================================================================
//  VALIDATION TESTS — T10 Slide Navigation System
//
//  `runSlideTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/slides.test.js");
//    await m.runSlideTests()
//
//  Pure tests cover the SlideDeck model in src/slidedeck.js (linear slide
//  list + first/prev/next/last navigation with clamping). DOM-backed tests
//  drive the live presentations window and assert the controls, counter,
//  keyboard navigation and registry round-trip all work.
// ============================================================================

import { SlideDeck } from "../slidedeck.js";
import { documentRegistry } from "../registry.js";

export async function runSlideTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: the SlideDeck model ──────────────────────────────────────────
  await t("a new deck is a non-empty linear sequence", () => {
    const d = new SlideDeck();
    if (!(d.length >= 3)) throw new Error("default deck too small: " + d.length);
    if (d.currentIndex !== 0) throw new Error("should start at 0");
    if (!d.current || !d.current.title) throw new Error("current slide missing title");
  });

  await t("next() and prev() move the index and report whether they moved", () => {
    const d = new SlideDeck();
    const start = d.currentIndex;
    if (!d.next() || d.currentIndex !== start + 1) throw new Error("next failed");
    if (!d.prev() || d.currentIndex !== start) throw new Error("prev failed");
  });

  await t("next() clamps at the last slide", () => {
    const d = new SlideDeck();
    d.last();
    if (d.next() !== false) throw new Error("next at end should return false");
    if (d.currentIndex !== d.length - 1) throw new Error("index moved past end");
  });

  await t("prev() clamps at the first slide", () => {
    const d = new SlideDeck();
    if (d.prev() !== false) throw new Error("prev at start should return false");
    if (d.currentIndex !== 0) throw new Error("index went negative");
  });

  await t("first() and last() jump to the ends", () => {
    const d = new SlideDeck();
    d.next();
    d.next();
    if (!d.first() || d.currentIndex !== 0) throw new Error("first failed");
    if (!d.last() || d.currentIndex !== d.length - 1) throw new Error("last failed");
  });

  await t("goTo() is bounds-checked", () => {
    const d = new SlideDeck();
    if (d.goTo(-1) !== false) throw new Error("negative goTo accepted");
    if (d.goTo(d.length) !== false) throw new Error("out-of-range goTo accepted");
    if (!d.goTo(1) || d.currentIndex !== 1) throw new Error("valid goTo failed");
  });

  await t("toJSON/fromJSON round-trips the deck", () => {
    const d = new SlideDeck([
      { id: "a", kicker: "K1", title: "One", body: ["line a", "line b"] },
      { id: "b", title: "Two", body: "single line" },
    ]);
    const json = JSON.parse(JSON.stringify(d.toJSON()));
    if (json.slides.length !== 2) throw new Error("json length");
    const d2 = SlideDeck.fromJSON(json);
    if (d2.length !== 2) throw new Error("round-trip length");
    if (d2.current.title !== "One") throw new Error("round-trip order");
    if (d2.goTo(1) && d2.current.title !== "Two") throw new Error("second slide");
    if (!Array.isArray(d2.slides[1].body) || d2.slides[1].body[0] !== "single line") throw new Error("body normalization");
  });

  await t("fromJSON of bad/empty input falls back to the demo deck", () => {
    if (SlideDeck.fromJSON(null).length < 3) throw new Error("null should fall back");
    if (SlideDeck.fromJSON({ slides: [] }).length < 3) throw new Error("empty should fall back");
  });

  await t("addSlide appends and last() reaches it", () => {
    const d = new SlideDeck();
    const n = d.length;
    const s = d.addSlide({ title: "New", body: ["x"] });
    if (d.length !== n + 1) throw new Error("addSlide did not append");
    if (!s.id || s.title !== "New") throw new Error("normalized slide wrong");
    d.last();
    if (d.current.title !== "New") throw new Error("last should be the new slide");
  });

  await t("the slides getter returns normalized copies, not live references", () => {
    const d = new SlideDeck([{ title: "T" }]);
    const list = d.slides;
    list[0].title = "MUTATED";
    if (d.current.title === "MUTATED") throw new Error("getter leaked a live reference");
  });

  // ── Editor surface (page only) ─────────────────────────────────────────
  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (domOk) {
    const waitSlides = async () => {
      if (location.hash !== "#/home") location.hash = "#/home";
      for (let i = 0; i < 60; i++) {
        if (!document.querySelector(".desk-win.active .slides-app")) break;
        await new Promise((r) => setTimeout(r, 30));
      }
      await new Promise((r) => setTimeout(r, 80));
      location.hash = "#/app/slides";
      let canvas = null;
      for (let i = 0; i < 60; i++) {
        canvas = document.querySelector(".desk-win.active .slides-app .sl-canvas .sl-slide");
        if (canvas) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!canvas) throw new Error("slides surface did not mount");
      const doc = documentRegistry.listByApp("slides")[0];
      if (!doc) throw new Error("no slides registry doc");
      const stage = document.querySelector(".desk-win.active .slides-app .sl-stage");
      return { stage, doc, orig: doc.content };
    };
    const count = () => document.querySelector(".desk-win.active .slides-app .sl-count").textContent.trim();
    const indicator = () => document.querySelector(".desk-win.active .slides-app .sl-indicator").textContent.trim();
    const title = () => document.querySelector(".desk-win.active .slides-app .sl-slide-title").textContent.trim();
    const btn = (kind) => document.querySelector('.desk-win.active .slides-app .sl-nav-btn[data-nav="' + kind + '"]');
    const key = (stage, k) => stage.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

    await t("slides window mounts a deck with a counter and controls", async () => {
      const { doc, orig } = await waitSlides();
      try {
        const n = document.querySelectorAll(".desk-win.active .slides-app .sl-nav-btn").length;
        if (n !== 4) throw new Error("expected 4 nav buttons, got " + n);
        if (count() !== "Slide 1 / 5") throw new Error("counter: " + count());
        if (indicator() !== "1 / 5") throw new Error("indicator: " + indicator());
        if (!title()) throw new Error("first slide has no title");
        if (btn("prev").disabled !== true || btn("first").disabled !== true) throw new Error("first slide should disable prev/first");
        if (btn("next").disabled !== false) throw new Error("next should be enabled");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("next/prev/last/first controls navigate and update the counter", async () => {
      const { stage, doc, orig } = await waitSlides();
      try {
        const t1 = title();
        btn("next").click();
        if (count() !== "Slide 2 / 5" || indicator() !== "2 / 5") throw new Error("after next: " + count());
        if (title() === t1) throw new Error("slide content did not change");
        btn("last").click();
        if (count() !== "Slide 5 / 5") throw new Error("after last: " + count());
        if (!btn("next").disabled || !btn("last").disabled) throw new Error("last slide should disable next/last");
        btn("prev").click();
        if (count() !== "Slide 4 / 5") throw new Error("after prev: " + count());
        btn("first").click();
        if (count() !== "Slide 1 / 5") throw new Error("after first: " + count());
        if (!btn("prev").disabled || !btn("first").disabled) throw new Error("first slide should disable prev/first");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("arrow keys, Home and End navigate the deck", async () => {
      const { stage, doc, orig } = await waitSlides();
      try {
        key(stage, "ArrowRight");
        if (count() !== "Slide 2 / 5") throw new Error("ArrowRight: " + count());
        key(stage, "ArrowLeft");
        if (count() !== "Slide 1 / 5") throw new Error("ArrowLeft: " + count());
        key(stage, "End");
        if (count() !== "Slide 5 / 5") throw new Error("End: " + count());
        key(stage, "Home");
        if (count() !== "Slide 1 / 5") throw new Error("Home: " + count());
        key(stage, "PageDown");
        key(stage, "PageDown");
        if (count() !== "Slide 3 / 5") throw new Error("PageDown x2: " + count());
        key(stage, "PageUp");
        if (count() !== "Slide 2 / 5") throw new Error("PageUp: " + count());
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("a saved deck loads from the registry and navigates its own slides", async () => {
      const { doc, orig } = await waitSlides();
      const saved = JSON.stringify({
        slides: [
          { id: "x", kicker: "K", title: "Custom One", body: ["a"] },
          { id: "y", kicker: "K2", title: "Custom Two", body: ["b"] },
        ],
      });
      try {
        documentRegistry.update(doc.id, { content: saved });
        location.hash = "#/app/docs";
        let loaded = false;
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 100));
          if (document.querySelector(".desk-win.active .docs-app")) break;
        }
        location.hash = "#/app/slides";
        let canvas = null;
        for (let i = 0; i < 40; i++) {
          canvas = document.querySelector(".desk-win.active .slides-app .sl-canvas .sl-slide");
          if (canvas) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!canvas) throw new Error("slides did not remount");
        if (count() !== "Slide 1 / 2") throw new Error("custom deck counter: " + count());
        if (title() !== "Custom One") throw new Error("custom first title: " + title());
        btn("next").click();
        if (count() !== "Slide 2 / 2" || title() !== "Custom Two") throw new Error("custom second slide: " + count() + " " + title());
        loaded = true;
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });
  }

  return results;
}
