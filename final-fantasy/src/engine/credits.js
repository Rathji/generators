// Task #165: Credit Roll Sequence — a scrollable text listing of the
// development team. Pure math: the credits flatten into timed rows that
// drift from the bottom of a viewport to the top at a fixed pixel rate.
// A UI layer (src/ui/credits.js) paints `frame()` each animation tick.

export class CreditRoll {
  constructor(sections = [], opts = {}) {
    this.sections = sections;
    this.cps = opts.cps ?? 48; // pixels per second of scroll
    this.spacing = opts.spacing ?? 4; // px between rows
    this.rowH = opts.rowH ?? 26; // px per name row (titles/sections taller)
  }

  // Flatten sections into renderable rows: {kind, text, size}.
  rows() {
    const out = [];
    for (const s of this.sections) {
      if (s.title) {
        out.push({ kind: "title", text: s.title, size: 1.8 });
        if (s.subtitle) out.push({ kind: "subtitle", text: s.subtitle, size: 1.05 });
        out.push({ kind: "blank", text: "", size: 0.6 });
        continue;
      }
      out.push({ kind: "section", text: s.section, size: 1.1 });
      for (const n of s.names ?? []) out.push({ kind: "name", text: n, size: 1 });
      out.push({ kind: "blank", text: "", size: 0.6 });
    }
    return out;
  }

  // Total content height in px.
  contentHeight() {
    let h = 0;
    for (const r of this.rows()) h += this.rowH * r.size + this.spacing;
    return h;
  }

  // Total scroll time to push the whole block past the top of the viewport.
  durationMs(viewportH = 300) {
    return Math.ceil(((this.contentHeight() + viewportH) / this.cps) * 1000);
  }

  // y-offset of the credit block at time t (ms) — negative means scrolled up.
  scrollY(tMs) {
    return (tMs / 1000) * this.cps;
  }

  // Which rows are currently inside the viewport, with their on-screen
  // position (y measured from the viewport bottom).
  frame(tMs, viewportH = 300) {
    const rows = this.rows();
    const y = this.scrollY(tMs);
    const out = [];
    let blockBottom = 0; // content y from viewport bottom at t=0
    for (const r of rows) {
      const top = viewportH + (blockBottom - y);
      const height = this.rowH * r.size;
      const visible = top < viewportH && top + height > 0;
      if (visible) out.push({ ...r, top, height, visible: true });
      blockBottom += height + this.spacing;
    }
    return { tMs, y, rows: out, done: y >= this.contentHeight() + viewportH };
  }

  isDone(tMs, viewportH = 300) {
    return this.scrollY(tMs) >= this.contentHeight() + viewportH;
  }
}
