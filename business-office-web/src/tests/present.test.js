// ============================================================================
//  VALIDATION TESTS — T12 Presentation Mode
//
//  `runPresentTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/present.test.js");
//    await m.runPresentTests()
//
//  DOM-backed tests drive the live presentations surface: the Present button
//  opens a fixed, full-viewport, read-only overlay showing the current slide
//  centered; click / arrow keys / Home / End advance; Escape or the × button
//  close it and restore the editor at the same slide. Elements render read-only
//  in the overlay.
// ============================================================================

import { documentRegistry } from "../registry.js";

export async function runPresentTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (!domOk) {
    return results;
  }

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
      if (slide) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!slide) throw new Error("slides surface did not mount");
    const doc = documentRegistry.listByApp("slides")[0];
    if (!doc) throw new Error("no slides registry doc");
    return { doc, orig: doc.content };
  };
  const open = async () => {
    document.querySelector(".desk-win.active .slides-app .sl-present-btn").click();
    let ov = null;
    for (let i = 0; i < 50; i++) {
      ov = document.querySelector(".sl-present");
      if (ov) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ov) throw new Error("presentation overlay did not open");
    return ov;
  };
  const close = () => {
    if (document.querySelector(".sl-present")) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    }
  };
  const ovCount = () => document.querySelector(".sl-present .sl-present-count").textContent.trim();
  const editorCount = () => document.querySelector(".desk-win.active .slides-app .sl-count").textContent.trim();
  const ovTitle = () => document.querySelector(".sl-present .sl-slide-title").textContent.trim();
  const press = (key) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

  await t("the toolbar has a Present button", async () => {
    const { doc, orig } = await waitSlides();
    try {
      if (!document.querySelector(".desk-win.active .slides-app .sl-present-btn")) throw new Error("no Present button");
    } finally {
      documentRegistry.update(doc.id, { content: orig });
    }
  });

  await t("Present opens a full-screen read-only overlay of the current slide", async () => {
    const { doc, orig } = await waitSlides();
    try {
      const ov = await open();
      const editorTitle = document.querySelector(".desk-win.active .slides-app .sl-slide-title").textContent.trim();
      if (ovTitle() !== editorTitle) throw new Error("overlay title differs: " + ovTitle() + " vs " + editorTitle);
      if (ovCount() !== "1 / 5") throw new Error("overlay count: " + ovCount());
      const cs = getComputedStyle(ov);
      if (cs.position !== "fixed") throw new Error("overlay not fixed: " + cs.position);
      if (ov.querySelector(".sl-elt-resize")) throw new Error("resize handles leaked into presentation");
      if (ov.querySelector(".sl-eltbar") || ov.querySelector(".sl-nav")) throw new Error("editor chrome leaked into presentation");
      if (!document.querySelector(".desk-win.active .slides-app")) throw new Error("editor should still exist underneath");
    } finally {
      close();
      documentRegistry.update(doc.id, { content: orig });
    }
  });

  await t("clicking the overlay advances to the next slide", async () => {
    const { doc, orig } = await waitSlides();
    try {
      const ov = await open();
      const first = ovTitle();
      ov.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      if (ovCount() !== "2 / 5") throw new Error("count after click: " + ovCount());
      if (ovTitle() === first) throw new Error("slide did not change");
    } finally {
      close();
      documentRegistry.update(doc.id, { content: orig });
    }
  });

  await t("arrow keys, Home and End navigate within the presentation", async () => {
    const { doc, orig } = await waitSlides();
    try {
      await open();
      press("ArrowRight");
      if (ovCount() !== "2 / 5") throw new Error("ArrowRight: " + ovCount());
      press("Home");
      if (ovCount() !== "1 / 5") throw new Error("Home: " + ovCount());
      press("End");
      if (ovCount() !== "5 / 5") throw new Error("End: " + ovCount());
      press("ArrowLeft");
      if (ovCount() !== "4 / 5") throw new Error("ArrowLeft: " + ovCount());
      press("PageDown");
      if (ovCount() !== "5 / 5") throw new Error("PageDown: " + ovCount());
    } finally {
      close();
      documentRegistry.update(doc.id, { content: orig });
    }
  });

  await t("Escape exits and restores the editor at the same slide", async () => {
    const { doc, orig } = await waitSlides();
    try {
      await open();
      press("ArrowRight");
      press("ArrowRight");
      if (ovCount() !== "3 / 5") throw new Error("setup: " + ovCount());
      press("Escape");
      if (document.querySelector(".sl-present")) throw new Error("overlay still present");
      if (editorCount() !== "Slide 3 / 5") throw new Error("editor restored wrong: " + editorCount());
    } finally {
      close();
      documentRegistry.update(doc.id, { content: orig });
    }
  });

  await t("the exit button closes the presentation", async () => {
    const { doc, orig } = await waitSlides();
    try {
      const ov = await open();
      const btn = ov.querySelector(".sl-present-exit");
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      if (document.querySelector(".sl-present")) throw new Error("overlay still present after ×");
      if (editorCount() !== "Slide 1 / 5") throw new Error("editor should be back at slide 1: " + editorCount());
    } finally {
      close();
      documentRegistry.update(doc.id, { content: orig });
    }
  });

  await t("layered elements render read-only inside the presentation", async () => {
    const { doc, orig } = await waitSlides();
    try {
      document.querySelector('.desk-win.active .slides-app .sl-elt-add[data-kind="text"]').click();
      const ov = await open();
      const elt = ov.querySelector(".sl-elt");
      if (!elt) throw new Error("element not rendered in presentation");
      if (elt.querySelector(".sl-elt-resize")) throw new Error("resize handle in presentation");
      if (elt.classList.contains("selected")) throw new Error("selection leaked into presentation");
      if (elt.style.zIndex === "") throw new Error("element lost its z-order in presentation");
    } finally {
      close();
      documentRegistry.update(doc.id, { content: orig });
    }
  });

  return results;
}
