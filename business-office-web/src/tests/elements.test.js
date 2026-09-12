// ============================================================================
//  VALIDATION TESTS — T11 Element Layering System
//
//  `runElementTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/elements.test.js");
//    await m.runElementTests()
//
//  Pure tests cover the SlideDeck element API in src/slidedeck.js (add/update/
//  remove elements, percentage bounds clamped 0–100, z-order stacking, sparse
//  round-trip). DOM-backed tests drive the live presentations surface: the
//  Layers toolbar adds text boxes and shapes, click selects, drag moves, the
//  corner handle resizes, Delete removes, double-click edits text, and bounds
//  + z-order persist to the registry and across a re-mount.
// ============================================================================

import { SlideDeck, defaultElement } from "../slidedeck.js";
import { documentRegistry } from "../registry.js";

export async function runElementTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: the element model ────────────────────────────────────────────
  await t("addElement appends and stacks new layers above the last", () => {
    const d = new SlideDeck([{ title: "A" }]);
    const e1 = d.addElement(0, { type: "text" });
    const e2 = d.addElement(0, { type: "shape" });
    if (!e1.id || !e2.id) throw new Error("missing ids");
    if (e1.z !== 1 || e2.z !== 2) throw new Error("z should stack 1,2: " + e1.z + "," + e2.z);
    if (d.elementsOf(0).length !== 2) throw new Error("elements not appended");
    if (e1.x < 0 || e1.w < 1 || e1.h < 1) throw new Error("default bounds invalid");
  });

  await t("elementsOf orders by z and returns copies, not live refs", () => {
    const d = new SlideDeck([{ title: "A" }]);
    const t1 = d.addElement(0, { type: "text" });
    const s1 = d.addElement(0, { type: "shape" });
    d.updateElement(0, t1.id, { z: 9 });
    const arr = d.elementsOf(0);
    if (arr.length !== 2 || arr[0].type !== "shape" || arr[1].type !== "text") throw new Error("z order wrong");
    arr[0].x = 77;
    if (d.elementsOf(0)[0].x === 77) throw new Error("elementsOf leaked a live reference");
  });

  await t("updateElement merges props and clamps bounds into 0–100", () => {
    const d = new SlideDeck([{ title: "A" }]);
    const e = d.addElement(0, { type: "text" });
    const u = d.updateElement(0, e.id, { x: -40, w: 250, h: 0, color: "#ff0000" });
    if (!u || u.x !== 0 || u.w !== 100 || u.h !== 1) throw new Error("clamp failed: " + JSON.stringify(u));
    if (u.color !== "#ff0000") throw new Error("prop merge failed");
    if (d.updateElement(0, "missing", { x: 5 }) !== null) throw new Error("missing id should return null");
  });

  await t("removeElement removes exactly the target and reports", () => {
    const d = new SlideDeck([{ title: "A" }]);
    const e1 = d.addElement(0, { type: "text" });
    d.addElement(0, { type: "shape" });
    if (!d.removeElement(0, e1.id)) throw new Error("remove should return true");
    if (d.elementsOf(0).length !== 1 || d.elementsOf(0)[0].type !== "shape") throw new Error("wrong element removed");
    if (d.removeElement(0, "nope") !== false) throw new Error("missing remove should be false");
  });

  await t("elements (bounds + z) round-trip through toJSON/fromJSON", () => {
    const d = new SlideDeck([
      {
        title: "A",
        elements: [
          { type: "text", x: 20, y: 30, w: 50, h: 10, z: 3, text: "hi", bold: true, color: "#0a58ca" },
          { type: "shape", shape: "pill", fill: "#333333", x: 5, y: 5, w: 12, h: 8, z: 1 },
        ],
      },
    ]);
    const d2 = SlideDeck.fromJSON(JSON.parse(JSON.stringify(d.toJSON())));
    const els = d2.elementsOf(0);
    if (els.length !== 2) throw new Error("round-trip length: " + els.length);
    if (els[0].z !== 1 || els[0].shape !== "pill" || els[0].fill !== "#333333") throw new Error("shape lost: " + JSON.stringify(els[0]));
    if (els[1].z !== 3 || els[1].x !== 20 || els[1].w !== 50 || els[1].bold !== true || els[1].color !== "#0a58ca") throw new Error("text lost: " + JSON.stringify(els[1]));
  });

  await t("defaultElement produces valid text and shape elements", () => {
    const t1 = defaultElement("text");
    if (t1.type !== "text" || t1.text === undefined || t1.fontSize < 6) throw new Error("bad text default: " + JSON.stringify(t1));
    const s1 = defaultElement("shape");
    if (s1.type !== "shape" || s1.shape !== "rect" || !s1.fill) throw new Error("bad shape default: " + JSON.stringify(s1));
  });

  await t("slides without elements read empty and normalize to []", () => {
    const d = new SlideDeck([{ title: "plain" }]);
    if (d.elementsOf(0).length !== 0) throw new Error("plain slide should have no elements");
    if (!Array.isArray(d.slides[0].elements) || d.slides[0].elements.length !== 0) throw new Error("elements should default to []");
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
      let slide = null;
      for (let i = 0; i < 60; i++) {
        slide = document.querySelector(".desk-win.active .slides-app .sl-canvas .sl-slide");
        if (slide && document.querySelector(".desk-win.active .slides-app .sl-eltbar")) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!slide) throw new Error("slides surface did not mount");
      const doc = documentRegistry.listByApp("slides")[0];
      if (!doc) throw new Error("no slides registry doc");
      return { stage: document.querySelector(".desk-win.active .slides-app .sl-stage"), canvas: document.querySelector(".desk-win.active .slides-app .sl-canvas"), doc, orig: doc.content };
    };
    const eltsOf = (doc) => (JSON.parse(doc.content).slides[0] || {}).elements || [];
    const eltsOnSlide = () => Array.from(document.querySelectorAll(".desk-win.active .slides-app .sl-elt"));
    const selected = () => document.querySelector(".desk-win.active .slides-app .sl-elt.selected");
    const addBtn = (kind) => document.querySelector('.desk-win.active .slides-app .sl-elt-add[data-kind="' + kind + '"]');

    await t("the Layers toolbar mounts with add and delete controls", async () => {
      const { doc, orig } = await waitSlides();
      try {
        const adds = document.querySelectorAll(".desk-win.active .slides-app .sl-elt-add").length;
        if (adds !== 2) throw new Error("expected 2 add buttons, got " + adds);
        const del = document.querySelector(".desk-win.active .slides-app .sl-elt-del");
        if (!del || !del.disabled) throw new Error("delete should start disabled");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("adding a text box renders a selectable element and persists it", async () => {
      const { doc, orig } = await waitSlides();
      try {
        addBtn("text").click();
        const el = selected();
        if (!el || !el.classList.contains("sl-elt-text")) throw new Error("text element not rendered/selected");
        if (parseFloat(el.style.width) <= 0 || !el.style.left.endsWith("%")) throw new Error("element not %-positioned");
        const els = eltsOf(doc);
        if (els.length !== 1 || els[0].type !== "text") throw new Error("not persisted: " + JSON.stringify(els));
        if (document.querySelector(".desk-win.active .slides-app .sl-elt-del").disabled) throw new Error("delete should enable with selection");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("adding a shape stacks it above the existing text box", async () => {
      const { doc, orig } = await waitSlides();
      try {
        addBtn("text").click();
        addBtn("shape").click();
        const els = eltsOf(doc);
        if (els.length !== 2) throw new Error("expected 2 elements");
        const text = els.find((e) => e.type === "text");
        const shape = els.find((e) => e.type === "shape");
        if (!text || !shape || shape.z <= text.z) throw new Error("shape should have higher z");
        const domEls = eltsOnSlide();
        if (domEls.length !== 2) throw new Error("expected 2 DOM elements");
        const tEl = domEls.find((e) => e.classList.contains("sl-elt-text"));
        const sEl = domEls.find((e) => !e.classList.contains("sl-elt-text"));
        if (!tEl || !sEl) throw new Error("DOM element split failed");
        if (parseInt(sEl.style.zIndex, 10) <= parseInt(tEl.style.zIndex, 10)) throw new Error("z-index ordering wrong in DOM");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("clicking an element selects it; clicking the canvas deselects", async () => {
      const { canvas, doc, orig } = await waitSlides();
      try {
        addBtn("text").click();
        const el = selected();
        if (!el) throw new Error("element not selected after add");
        canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 4, clientY: 4 }));
        if (document.querySelector(".desk-win.active .slides-app .sl-elt.selected")) throw new Error("canvas click should deselect");
        if (!document.querySelector(".desk-win.active .slides-app .sl-elt-del").disabled) throw new Error("delete should disable after deselect");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("dragging moves the element and persists the new bounds", async () => {
      const { doc, orig } = await waitSlides();
      try {
        addBtn("text").click();
        const el = selected();
        const slide = document.querySelector(".desk-win.active .slides-app .sl-canvas .sl-slide");
        const srect = slide.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = 40;
        const dy = 25;
        el.dispatchEvent(new PointerEvent("pointerdown", { clientX: cx, clientY: cy, bubbles: true }));
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: cx + dx, clientY: cy + dy, bubbles: true }));
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: cx + dx, clientY: cy + dy, bubbles: true }));
        const expX = 12 + (dx / srect.width) * 100;
        const expY = 14 + (dy / srect.height) * 100;
        if (Math.abs(parseFloat(el.style.left) - expX) > 0.5) throw new Error("left: " + el.style.left + " expected ~" + expX);
        if (Math.abs(parseFloat(el.style.top) - expY) > 0.5) throw new Error("top: " + el.style.top + " expected ~" + expY);
        const e = eltsOf(doc)[0];
        if (Math.abs(e.x - expX) > 0.5 || Math.abs(e.y - expY) > 0.5) throw new Error("not persisted: " + JSON.stringify(e));
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("the corner handle resizes the element and persists the size", async () => {
      const { doc, orig } = await waitSlides();
      try {
        addBtn("text").click();
        const el = selected();
        const slide = document.querySelector(".desk-win.active .slides-app .sl-canvas .sl-slide");
        const srect = slide.getBoundingClientRect();
        const handle = el.querySelector(".sl-elt-resize");
        if (!handle) throw new Error("resize handle missing");
        const hrect = handle.getBoundingClientRect();
        const cx = hrect.left + hrect.width / 2;
        const cy = hrect.top + hrect.height / 2;
        const dx = 30;
        const dy = 20;
        handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: cx, clientY: cy, bubbles: true }));
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: cx + dx, clientY: cy + dy, bubbles: true }));
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: cx + dx, clientY: cy + dy, bubbles: true }));
        const expW = 40 + (dx / srect.width) * 100;
        const expH = 12 + (dy / srect.height) * 100;
        if (Math.abs(parseFloat(el.style.width) - expW) > 0.5) throw new Error("width: " + el.style.width + " expected ~" + expW);
        if (Math.abs(parseFloat(el.style.height) - expH) > 0.5) throw new Error("height: " + el.style.height + " expected ~" + expH);
        const e = eltsOf(doc)[0];
        if (Math.abs(e.w - expW) > 0.5 || Math.abs(e.h - expH) > 0.5) throw new Error("size not persisted: " + JSON.stringify(e));
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("Delete removes the selected element (button and key)", async () => {
      const { stage, doc, orig } = await waitSlides();
      try {
        addBtn("text").click();
        document.querySelector(".desk-win.active .slides-app .sl-elt-del").click();
        if (eltsOnSlide().length !== 0 || eltsOf(doc).length !== 0) throw new Error("button delete failed");
        addBtn("text").click();
        stage.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
        if (eltsOnSlide().length !== 0 || eltsOf(doc).length !== 0) throw new Error("key delete failed");
        if (!document.querySelector(".desk-win.active .slides-app .sl-elt-del").disabled) throw new Error("delete should disable after removal");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("double-click edits an element's text and persists it", async () => {
      const { doc, orig } = await waitSlides();
      try {
        addBtn("text").click();
        const el = selected();
        const body = el.querySelector(".sl-elt-body");
        body.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        if (!body.isContentEditable) throw new Error("element not editable after dblclick");
        body.textContent = "Quarterly goals";
        body.dispatchEvent(new FocusEvent("blur"));
        await new Promise((r) => setTimeout(r, 30));
        const e = eltsOf(doc)[0];
        if (!e || e.text !== "Quarterly goals") throw new Error("text not persisted: " + JSON.stringify(e));
        const rendered = document.querySelector(".desk-win.active .slides-app .sl-elt-body");
        if (!rendered || rendered.textContent.trim() !== "Quarterly goals") throw new Error("text not re-rendered");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });

    await t("elements survive a re-mount from the registry", async () => {
      const { doc, orig } = await waitSlides();
      try {
        addBtn("text").click();
        addBtn("shape").click();
        const before = JSON.stringify(eltsOf(doc));
        if (JSON.parse(before).length !== 2) throw new Error("setup failed");
        location.hash = "#/home";
        for (let i = 0; i < 60; i++) {
          if (!document.querySelector(".desk-win.active .slides-app")) break;
          await new Promise((r) => setTimeout(r, 30));
        }
        await new Promise((r) => setTimeout(r, 80));
        location.hash = "#/app/slides";
        let slide = null;
        for (let i = 0; i < 60; i++) {
          slide = document.querySelector(".desk-win.active .slides-app .sl-canvas .sl-slide");
          if (slide) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!slide) throw new Error("did not remount");
        if (eltsOnSlide().length !== 2) throw new Error("elements not re-rendered after remount");
        if (JSON.stringify(eltsOf(doc)) !== before) throw new Error("registry content changed by remount");
      } finally {
        documentRegistry.update(doc.id, { content: orig });
      }
    });
  }

  return results;
}
