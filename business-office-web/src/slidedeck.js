// ============================================================================
//  SLIDE DECK MODEL  (T10 — Slide Navigation System)  +  (T11 — Element Layers)
//
//  A linear sequence of slides plus first/prev/next/last navigation. A slide
//  is a plain object { id, kicker, title, body, elements } — body is an array
//  of lines, and elements (T11) is an array of discrete layers — text boxes
//  and shapes — each positioned by percentage bounds (x/y/w/h) with a z-order
//  so they stack. Elements never touch the base content: they float above it.
//
//  The deck serializes to { slides: [...] } and is stored opaquely in the
//  registry, so a presentation survives reloads. Navigation state (current
//  index) is deliberately NOT persisted — a deck opens on its first slide.
//
//  Pure module — no DOM.
// ============================================================================

let slideCounter = 0;
let elementCounter = 0;

function defaultId() {
  return "slide_" + ++slideCounter;
}

function defaultElId() {
  return "elt_" + ++elementCounter;
}

const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

const SHAPES = ["rect", "circle", "pill"];
const ALIGNS = ["left", "center", "right"];

/** Normalize a discrete element (text box or shape) with defaulted bounds. */
function normalizeElement(e, fallbackZ) {
  const type = e && e.type === "shape" ? "shape" : "text";
  const base = {
    id: e && e.id ? String(e.id) : defaultElId(),
    type,
    x: clampNum(e && e.x, 0, 100, type === "text" ? 12 : 30),
    y: clampNum(e && e.y, 0, 100, type === "text" ? 14 : 30),
    w: clampNum(e && e.w, 1, 100, type === "text" ? 40 : 24),
    h: clampNum(e && e.h, 1, 100, type === "text" ? 12 : 18),
    z: Number.isFinite(e && e.z) ? Math.max(0, Math.floor(Number(e.z))) : fallbackZ,
  };
  if (type === "text") {
    base.text = e && e.text != null ? String(e.text) : "Text";
    base.fontSize = clampNum(e && e.fontSize, 6, 200, 22);
    base.bold = !!(e && e.bold);
    base.italic = !!(e && e.italic);
    base.color = e && e.color ? String(e.color) : "#1d2942";
    base.align = e && ALIGNS.includes(e.align) ? e.align : "left";
  } else {
    base.shape = e && SHAPES.includes(e.shape) ? e.shape : "rect";
    base.fill = e && e.fill ? String(e.fill) : "#C43E1C";
    base.color = e && e.color ? String(e.color) : "#ffffff";
    base.text = e && e.text != null ? String(e.text) : "";
    base.fontSize = clampNum(e && e.fontSize, 6, 200, 15);
  }
  return base;
}

/** A ready-to-add element of the given type ("text" | "shape") with defaults. */
export function defaultElement(type) {
  return normalizeElement({ type }, 1);
}

/** Normalize a raw slide object into {id, kicker, title, body:[...], elements:[...]}. */
function normalizeSlide(s) {
  const els = Array.isArray(s && s.elements)
    ? s.elements.map((e, i) => normalizeElement(e, i + 1))
    : [];
  return {
    id: s && s.id ? String(s.id) : defaultId(),
    kicker: s && s.kicker ? String(s.kicker) : "",
    title: s && s.title ? String(s.title) : "Untitled Slide",
    body: Array.isArray(s && s.body)
      ? s.body.map((l) => String(l))
      : s && s.body
        ? [String(s.body)]
        : [],
    elements: els,
  };
}

export const DEFAULT_DECK = [
  {
    id: "d1",
    kicker: "Q3 Business Review",
    title: "Growth & Outlook",
    body: ["A concise snapshot of the quarter", "Revenue up, costs down, pipeline strong"],
  },
  {
    id: "d2",
    kicker: "Agenda",
    title: "What we'll cover",
    body: ["Results and key numbers", "Customer momentum", "Roadmap for next quarter", "Open questions"],
  },
  {
    id: "d3",
    kicker: "Key Numbers",
    title: "The metrics that matter",
    body: ["Revenue up 24% quarter over quarter", "Retention holding at 91%", "Three new enterprise logos"],
  },
  {
    id: "d4",
    kicker: "Roadmap",
    title: "What's next",
    body: ["Ship the reporting module", "Expand the sales team", "Deepen the partner program"],
  },
  {
    id: "d5",
    kicker: "Thank You",
    title: "Questions welcome",
    body: ["Let's talk about what this means for your team"],
  },
];

export class SlideDeck {
  /** @param {Array} [slides]  pre-built slides; defaults to the demo deck. */
  constructor(slides = []) {
    this._slides = [];
    this._index = 0;
    this.replace(Array.isArray(slides) && slides.length ? slides : DEFAULT_DECK);
  }

  get length() {
    return this._slides.length;
  }

  get currentIndex() {
    return this._index;
  }

  get current() {
    return this._slides[this._index] || null;
  }

  /** A copy of the slides array (normalized). */
  get slides() {
    return this._slides.map((s) =>
      Object.assign({}, s, {
        body: s.body.slice(),
        elements: (s.elements || []).map((e) => Object.assign({}, e)),
      })
    );
  }

  /** Replace the whole deck; clamps the index into range. */
  replace(slides) {
    this._slides = (Array.isArray(slides) ? slides : []).map(normalizeSlide);
    if (this._index >= this._slides.length) this._index = Math.max(0, this._slides.length - 1);
    return this._slides.length;
  }

  /** Append a slide; returns the normalized slide. */
  addSlide(slide) {
    const s = normalizeSlide(slide);
    this._slides.push(s);
    return s;
  }

  /** Jump to slide index i; returns true if moved. */
  goTo(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this._slides.length) return false;
    this._index = i;
    return true;
  }

  /** Advance one slide; returns true if moved. */
  next() {
    if (this._index >= this._slides.length - 1) return false;
    this._index++;
    return true;
  }

  /** Go back one slide; returns true if moved. */
  prev() {
    if (this._index <= 0) return false;
    this._index--;
    return true;
  }

  /** Jump to the first slide; returns true if moved. */
  first() {
    if (this._index === 0 || !this._slides.length) return false;
    this._index = 0;
    return true;
  }

  /** Jump to the last slide; returns true if moved. */
  last() {
    if (!this._slides.length) return false;
    if (this._index === this._slides.length - 1) return false;
    this._index = this._slides.length - 1;
    return true;
  }

  toJSON() {
    return { slides: this._slides };
  }

  static fromJSON(data) {
    return new SlideDeck(data && data.slides);
  }

  // ── T11 Element layers ─────────────────────────────────────────────────

  /** Elements of a slide ordered by z (ascending); copies, never live refs. */
  elementsOf(i) {
    const s = this._slides[i];
    if (!s || !Array.isArray(s.elements)) return [];
    return s.elements.map((e) => Object.assign({}, e)).sort((a, b) => (a.z || 0) - (b.z || 0));
  }

  /** Get one element by id from a slide, or null. */
  getElement(i, id) {
    const s = this._slides[i];
    if (!s || !Array.isArray(s.elements) || !id) return null;
    return s.elements.find((e) => e.id === id) || null;
  }

  /** Add a discrete element to a slide; stacks it above the others. Returns it. */
  addElement(i, elt) {
    const s = this._slides[i];
    if (!s) return null;
    if (!Array.isArray(s.elements)) s.elements = [];
    const maxZ = s.elements.reduce((m, e) => Math.max(m, Number.isFinite(e.z) ? e.z : 0), 0);
    const e = normalizeElement(elt, maxZ + 1);
    e.z = maxZ + 1;
    s.elements.push(e);
    return e;
  }

  /** Merge props into an element (bounds are clamped); returns it, or null. */
  updateElement(i, id, props) {
    const s = this._slides[i];
    if (!s || !Array.isArray(s.elements) || !id) return null;
    const idx = s.elements.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const e = s.elements[idx];
    s.elements[idx] = normalizeElement(Object.assign({}, e, props), e.z);
    return s.elements[idx];
  }

  /** Remove an element; returns true if it was removed. */
  removeElement(i, id) {
    const s = this._slides[i];
    if (!s || !Array.isArray(s.elements) || !id) return false;
    const idx = s.elements.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    s.elements.splice(idx, 1);
    return true;
  }
}
