// ============================================================================
//  PRESENTATIONS APP (.pptx) — slide deck surface (T10 + T11 + T12)
//
//  A real, navigable deck: a linear sequence of slides backed by the SlideDeck
//  model (src/slidedeck.js), rendered as a 16:9 canvas. First / prev / next /
//  last controls, a live slide counter, and arrow / Home / End keyboard
//  navigation. The deck is stored in the registry as { slides: [...] } JSON so
//  it survives reloads.
//
//  Element layering (T11): each slide can carry discrete layers — text boxes
//  and shapes — positioned by percentage bounds (x/y/w/h) with a z-order. A
//  Layers toolbar adds elements; click selects, drag moves, the corner handle
//  resizes, arrow keys nudge, Delete removes, double-click edits text. Bounds
//  and z-order persist with the deck.
//
//  Presentation mode (T12): the "Present" button opens a fixed, full-viewport,
//  read-only overlay showing the current slide centered; click / arrow keys /
//  Home / End advance, Esc or × exits and restores the editor at the same
//  slide.
// ============================================================================

import { SlideDeck, defaultElement } from "../slidedeck.js";
import { documentRegistry } from "../registry.js";

const SLIDES_GLYPH = `<svg viewBox="0 0 24 24"><path fill="#fff" d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V6A1.5 1.5 0 0 1 4 4.5Z"/><path fill="none" stroke="rgba(25,45,85,.45)" stroke-width="1.2" d="M4 8h16"/><path fill="#C43E1C" d="M6.5 11.5h8.5a1.1 1.1 0 0 1 0 2.2H6.5a1.1 1.1 0 0 1 0-2.2Z"/></svg>`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function slidesHTML(name) {
  return `
  <div class="slides-app">
    <div class="sl-toolbar">
      <span class="sl-brand">${SLIDES_GLYPH}</span>
      <span class="sl-name">${esc(name)}</span>
      <span class="sl-spacer"></span>
      <button type="button" class="sl-present-btn" title="Present this deck — full screen, read-only" aria-label="Present">▶ Present</button>
      <span class="sl-count">Slide 1 / 1</span>
    </div>
    <div class="sl-eltbar">
      <span class="sl-eltbar-label">Layers</span>
      <button type="button" class="sl-elt-add" data-kind="text" title="Add a text box to this slide">＋ Text</button>
      <button type="button" class="sl-elt-add" data-kind="shape" title="Add a shape to this slide">＋ Shape</button>
      <span class="sl-elt-info">No element selected</span>
      <span class="sl-spacer"></span>
      <button type="button" class="sl-elt-del" disabled title="Delete the selected element (Del)" aria-label="Delete element">Delete</button>
    </div>
    <div class="sl-stage" tabindex="0">
      <div class="sl-canvas"></div>
    </div>
    <div class="sl-nav">
      <button type="button" class="sl-nav-btn" data-nav="first" title="First slide (Home)" aria-label="First slide">«</button>
      <button type="button" class="sl-nav-btn" data-nav="prev" title="Previous slide (Left)" aria-label="Previous slide">‹</button>
      <span class="sl-indicator">1 / 1</span>
      <button type="button" class="sl-nav-btn" data-nav="next" title="Next slide (Right)" aria-label="Next slide">›</button>
      <button type="button" class="sl-nav-btn" data-nav="last" title="Last slide (End)" aria-label="Last slide">»</button>
    </div>
    <div class="sl-status">
      <span class="sl-stat sl-stat-count">1 slide</span>
      <span class="sl-stat sl-stat-hint">click an element to select · drag to move · corner handle to resize · double-click text to edit · Del removes</span>
    </div>
  </div>`;
}

function slideHTML(slide, page, total) {
  const body = Array.isArray(slide.body) ? slide.body : slide.body ? [slide.body] : [];
  return `
  <div class="sl-slide">
    <div class="sl-slide-accent"></div>
    ${slide.kicker ? `<div class="sl-slide-kicker">${esc(slide.kicker)}</div>` : ""}
    <h2 class="sl-slide-title">${esc(slide.title || "Untitled Slide")}</h2>
    ${body.map((line) => `<p class="sl-slide-line">${esc(line)}</p>`).join("")}
    <div class="sl-elt-layer"></div>
    <div class="sl-slide-page">${page} / ${total}</div>
  </div>`;
}

/** One layered element (text box or shape). readOnly omits the resize handle. */
function eltHTML(e, readOnly) {
  const style = "left:" + e.x + "%;top:" + e.y + "%;width:" + e.w + "%;height:" + e.h + "%;z-index:" + e.z + ";";
  const resize = readOnly ? "" : '<div class="sl-elt-resize" title="Resize (drag corner)"></div>';
  if (e.type === "shape") {
    const inner =
      "background:" + e.fill +
      ";border-radius:" + (e.shape === "circle" ? "50%" : e.shape === "pill" ? "999px" : "10px") +
      ";color:" + e.color + ";font-size:" + e.fontSize + "px;";
    const label = e.text ? '<div class="sl-elt-shape-label">' + esc(e.text) + "</div>" : "";
    return '<div class="sl-elt" data-id="' + esc(e.id) + '" style="' + style + '" tabindex="0"><div class="sl-elt-shape" style="' + inner + '">' + label + "</div>" + resize + "</div>";
  }
  const inner =
    "font-size:" + e.fontSize + "px;font-weight:" + (e.bold ? "700" : "400") +
    ";font-style:" + (e.italic ? "italic" : "normal") +
    ";color:" + e.color + ";text-align:" + e.align + ";";
  return '<div class="sl-elt sl-elt-text" data-id="' + esc(e.id) + '" style="' + style + '" tabindex="0"><div class="sl-elt-body" style="' + inner + '">' + esc(e.text) + "</div>" + resize + "</div>";
}

export function mountSlides(zone, ctx) {
  const doc = ctx.doc || null;
  zone.innerHTML = slidesHTML((doc && doc.meta && doc.meta.name) || "Untitled Presentation");
  const canvas = zone.querySelector(".sl-canvas");
  const countEl = zone.querySelector(".sl-count");
  const indicator = zone.querySelector(".sl-indicator");
  const statEl = zone.querySelector(".sl-stat-count");
  const nav = zone.querySelector(".sl-nav");
  const stage = zone.querySelector(".sl-stage");
  const addTextBtn = zone.querySelector('.sl-elt-add[data-kind="text"]');
  const addShapeBtn = zone.querySelector('.sl-elt-add[data-kind="shape"]');
  const delBtn = zone.querySelector(".sl-elt-del");
  const eltInfo = zone.querySelector(".sl-elt-info");
  const presentBtn = zone.querySelector(".sl-present-btn");

  let deck;
  try {
    deck = doc && doc.content ? SlideDeck.fromJSON(JSON.parse(doc.content)) : new SlideDeck();
  } catch {
    deck = new SlideDeck();
  }
  let selId = null;
  let presentOverlay = null;

  const sync = () => {
    if (!doc) return;
    documentRegistry.update(doc.id, { content: JSON.stringify(deck.toJSON()) });
  };

  const slideEl = () => canvas.querySelector(".sl-slide");
  const elementsOf = () => deck.elementsOf(deck.currentIndex);

  const setNavDisabled = () => {
    const atFirst = deck.currentIndex <= 0;
    const atLast = deck.currentIndex >= deck.length - 1;
    nav.querySelector('[data-nav="first"]').disabled = atFirst;
    nav.querySelector('[data-nav="prev"]').disabled = atFirst;
    nav.querySelector('[data-nav="next"]').disabled = atLast;
    nav.querySelector('[data-nav="last"]').disabled = atLast;
  };

  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".sl-nav-btn");
    if (!b || b.disabled) return;
    const k = b.dataset.nav;
    const fn = { first: () => deck.first(), prev: () => deck.prev(), next: () => deck.next(), last: () => deck.last() }[k];
    if (fn) {
      go(fn);
      stage.focus();
    }
  });

  const updateEltBar = () => {
    const elt = selId ? deck.getElement(deck.currentIndex, selId) : null;
    delBtn.disabled = !elt;
    eltInfo.textContent = elt
      ? (elt.type === "text" ? "Text box" : "Shape") + " · " + Math.round(elt.w) + " × " + Math.round(elt.h)
      : "No element selected";
  };

  const renderElements = () => {
    const slide = slideEl();
    if (!slide) return;
    const layer = slide.querySelector(".sl-elt-layer");
    layer.innerHTML = elementsOf().map((e) => eltHTML(e, false)).join("");
    if (selId) {
      const el = layer.querySelector('.sl-elt[data-id="' + CSS.escape(selId) + '"]');
      if (el) el.classList.add("selected");
    }
    updateEltBar();
  };

  const render = () => {
    const i = deck.currentIndex;
    const n = deck.length;
    canvas.innerHTML = deck.current ? slideHTML(deck.current, i + 1, n) : '<div class="sl-empty">No slides in this deck.</div>';
    countEl.textContent = "Slide " + (i + 1) + " / " + n;
    indicator.textContent = (i + 1) + " / " + n;
    statEl.textContent = n + " slide" + (n === 1 ? "" : "s");
    setNavDisabled();
    renderElements();
  };

  const go = (fn) => {
    if (fn()) {
      selId = null;
      render();
    }
  };

  // ── Element selection & manipulation (T11) ─────────────────────────────
  const selectElement = (id) => {
    selId = id;
    const slide = slideEl();
    if (slide) {
      const layer = slide.querySelector(".sl-elt-layer");
      layer.querySelectorAll(".sl-elt.selected").forEach((el) => el.classList.remove("selected"));
      if (id) {
        const el = layer.querySelector('.sl-elt[data-id="' + CSS.escape(id) + '"]');
        if (el) el.classList.add("selected");
      }
    }
    updateEltBar();
  };

  /** Update the model + live DOM for an element (no full re-render). */
  const applyLive = (id, props) => {
    const elt = deck.updateElement(deck.currentIndex, id, props);
    if (!elt) return;
    const el = slideEl().querySelector('.sl-elt[data-id="' + CSS.escape(id) + '"]');
    if (el) {
      el.style.left = elt.x + "%";
      el.style.top = elt.y + "%";
      el.style.width = elt.w + "%";
      el.style.height = elt.h + "%";
      el.style.zIndex = String(elt.z);
    }
    updateEltBar();
  };

  const startDrag = (eltEl, e) => {
    const slide = slideEl();
    if (!slide) return;
    const rect = slide.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const id = eltEl.dataset.id;
    const elt = deck.getElement(deck.currentIndex, id);
    if (!elt) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = elt.x;
    const oy = elt.y;
    const ow = elt.w;
    const oh = elt.h;
    const move = (ev) => {
      applyLive(id, {
        x: Math.min(Math.max(0, ox + ((ev.clientX - sx) / rect.width) * 100), 100 - ow),
        y: Math.min(Math.max(0, oy + ((ev.clientY - sy) / rect.height) * 100), 100 - oh),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      sync();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  };

  const startResize = (eltEl, e) => {
    const slide = slideEl();
    if (!slide) return;
    const rect = slide.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const id = eltEl.dataset.id;
    const elt = deck.getElement(deck.currentIndex, id);
    if (!elt) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const ow = elt.w;
    const oh = elt.h;
    const move = (ev) => {
      applyLive(id, {
        w: Math.max(3, Math.min(100, ow + ((ev.clientX - sx) / rect.width) * 100)),
        h: Math.max(3, Math.min(100, oh + ((ev.clientY - sy) / rect.height) * 100)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      sync();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  };

  const deleteSelected = () => {
    if (!selId) return;
    deck.removeElement(deck.currentIndex, selId);
    selId = null;
    render();
    sync();
  };

  const addElement = (kind) => {
    const elt = deck.addElement(deck.currentIndex, defaultElement(kind));
    if (!elt) return;
    selId = elt.id;
    render();
    sync();
    stage.focus();
  };

  canvas.addEventListener("pointerdown", (e) => {
    const resizeEl = e.target.closest(".sl-elt-resize");
    const elt = e.target.closest(".sl-elt");
    if (resizeEl) {
      e.stopPropagation();
      const wrap = resizeEl.closest(".sl-elt");
      selectElement(wrap.dataset.id);
      startResize(wrap, e);
      return;
    }
    if (elt) {
      e.stopPropagation();
      selectElement(elt.dataset.id);
      startDrag(elt, e);
      return;
    }
    selectElement(null);
  });

  canvas.addEventListener("dblclick", (e) => {
    const elt = e.target.closest(".sl-elt");
    if (!elt) return;
    const id = elt.dataset.id;
    if (!deck.getElement(deck.currentIndex, id)) return;
    selectElement(id);
    const inner = elt.querySelector(".sl-elt-body, .sl-elt-shape");
    if (!inner) return;
    inner.contentEditable = "true";
    inner.focus();
    const sel = window.getSelection();
    if (sel && sel.selectAllChildren) sel.selectAllChildren(inner);
    const commit = () => {
      if (!inner.isConnected) return;
      inner.contentEditable = "false";
      deck.updateElement(deck.currentIndex, id, { text: inner.textContent });
      render();
      sync();
    };
    inner.addEventListener("blur", commit, { once: true });
    inner.addEventListener("keydown", (e2) => {
      if (e2.key === "Enter" && !e2.shiftKey) {
        e2.preventDefault();
        inner.blur();
      }
      e2.stopPropagation();
    });
  });

  addTextBtn.addEventListener("click", () => addElement("text"));
  addShapeBtn.addEventListener("click", () => addElement("shape"));
  delBtn.addEventListener("click", deleteSelected);

  stage.addEventListener("keydown", (e) => {
    const k = e.key;
    if (e.target.isContentEditable) return;
    if ((k === "Delete" || k === "Backspace") && selId) {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (selId && (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown")) {
      e.preventDefault();
      const elt = deck.getElement(deck.currentIndex, selId);
      if (!elt) return;
      const step = e.shiftKey ? 5 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
      applyLive(selId, {
        x: Math.min(Math.max(0, elt.x + d[0]), 100 - elt.w),
        y: Math.min(Math.max(0, elt.y + d[1]), 100 - elt.h),
      });
      sync();
      return;
    }
    if (k === "ArrowRight" || k === "PageDown" || k === " ") {
      e.preventDefault();
      go(() => deck.next());
    } else if (k === "ArrowLeft" || k === "PageUp") {
      e.preventDefault();
      go(() => deck.prev());
    } else if (k === "Home") {
      e.preventDefault();
      go(() => deck.first());
    } else if (k === "End") {
      e.preventDefault();
      go(() => deck.last());
    }
  });

  // ── Presentation mode (T12) ────────────────────────────────────────────
  const presentHTML = `
    <div class="sl-present-stage">
      <div class="sl-present-slide sl-slide"></div>
    </div>
    <button type="button" class="sl-present-exit" title="Exit presentation (Esc)" aria-label="Exit presentation">×</button>
    <div class="sl-present-count"></div>
    <div class="sl-present-hint">click or → to advance · Esc to exit</div>`;

  const renderPresent = () => {
    if (!presentOverlay) return;
    const i = deck.currentIndex;
    const n = deck.length;
    const slide = presentOverlay.querySelector(".sl-present-slide");
    const count = presentOverlay.querySelector(".sl-present-count");
    slide.innerHTML = deck.current ? slideHTML(deck.current, i + 1, n) : '<div class="sl-empty">Empty deck</div>';
    const layer = slide.querySelector(".sl-elt-layer");
    if (layer) layer.innerHTML = elementsOf().map((e) => eltHTML(e, true)).join("");
    count.textContent = (i + 1) + " / " + n;
  };

  const presentKey = (e) => {
    const k = e.key;
    if (k === "Escape") {
      exitPresent();
      return;
    }
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") {
      e.preventDefault();
      if (deck.next()) renderPresent();
    } else if (k === "ArrowLeft" || k === "PageUp") {
      e.preventDefault();
      if (deck.prev()) renderPresent();
    } else if (k === "Home") {
      e.preventDefault();
      if (deck.first()) renderPresent();
    } else if (k === "End") {
      e.preventDefault();
      if (deck.last()) renderPresent();
    }
  };

  const enterPresent = () => {
    if (presentOverlay) return;
    const ov = document.createElement("div");
    ov.className = "sl-present";
    ov.innerHTML = presentHTML;
    document.body.appendChild(ov);
    presentOverlay = ov;
    ov.querySelector(".sl-present-exit").addEventListener("click", (e) => {
      e.stopPropagation();
      exitPresent();
    });
    ov.addEventListener("click", () => {
      if (deck.next()) renderPresent();
    });
    renderPresent();
    document.addEventListener("keydown", presentKey);
    try {
      if (ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
    } catch {
      /* fullscreen may be unavailable in embedded previews */
    }
  };

  const exitPresent = () => {
    if (!presentOverlay) return;
    document.removeEventListener("keydown", presentKey);
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch {
      /* ignore */
    }
    presentOverlay.remove();
    presentOverlay = null;
    render();
  };

  presentBtn.addEventListener("click", enterPresent);

  render();
  sync();

  return () => {
    if (presentOverlay) {
      document.removeEventListener("keydown", presentKey);
      presentOverlay.remove();
      presentOverlay = null;
    }
  };
}

export const slidesApp = {
  key: "slides",
  roadTitle: "Presentations build",
  roadmap: [
    "Slide sorter (thumbnails) + slide add/duplicate/delete",
    "Themes, layouts and speaker notes",
    "Transitions & build animations",
    "Export slides as PNG / PDF for sharing",
    "Speaker view with a notes pane beside the live slide",
    "Slide master: edit global placeholders once, apply everywhere",
  ],
  workspaceNote:
    "A full deck editor is live: a linear navigable deck (T10), discrete layered elements — text boxes and shapes that can be added, dragged, resized, re-ordered and deleted per slide, with bounds and z-order persisting (T11) — and a full-screen read-only presentation mode with click / keyboard navigation (T12).",
  mountFile: "src/apps/slides.js",
  hasSurface: true,
  mount: mountSlides,
  seedHints: [
    "The deck is a SlideDeck (src/slidedeck.js); elements live on each slide as percentage-bounded layers with a z-order — they never touch the base content",
    "Element math is all percentage-based (0–100) so layers scale with the 16:9 slide",
    "Presentation mode (T12) is a fixed overlay appended to body — read-only, no selection or resize handles, Esc / × exits",
  ],
};
