// ============================================================================
//  CELL STYLES  (T9 — Cell Formatting Engine)
//
//  Per-cell formatting stored SEPARATELY from cell values, so restyling a cell
//  never touches its data. A style is a plain object with optional properties:
//    align  - "left" | "center" | "right"  (overrides the numeric/text default)
//    bg     - CSS background color, e.g. "#fff3cd"
//    color  - CSS font color
//    bold   - boolean
//    italic - boolean
//
//  The map is sparse (only styled cells appear in toJSON), keyed by A1-style
//  references ("B3"). The spreadsheets surface (src/apps/sheets.js) keeps the
//  values in the Grid (src/grid.js) and the styles here, persisting styles in
//  the document's meta — the two never share storage.
//
//  Pure module — no DOM.
// ============================================================================

const DEFAULT_STYLE = {};

export class CellStyles {
  constructor() {
    this._m = new Map(); // ref -> style object
  }

  /** The style object for a ref ({} when unstyled). Never returns null. */
  get(ref) {
    return this._m.get(ref) || DEFAULT_STYLE;
  }

  /**
   * Merge `props` into the cell's style; a prop given as null/""/false removes
   * that property, and a cell left with no properties is dropped from the map.
   * Returns the previous style object.
   */
  set(ref, props) {
    if (!props || typeof props !== "object") throw new TypeError("style props must be an object");
    const prev = this._m.get(ref) || {};
    const next = Object.assign({}, prev);
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v === undefined || v === null || v === "" || v === false) delete next[key];
      else next[key] = v;
    }
    if (Object.keys(next).length > 0) this._m.set(ref, next);
    else this._m.delete(ref);
    return prev;
  }

  /** Remove all styling from a cell. */
  clear(ref) {
    const prev = this._m.get(ref) || {};
    this._m.delete(ref);
    return prev;
  }

  /** Remove every style. */
  clearAll() {
    this._m.clear();
  }

  /** Number of styled cells. */
  count() {
    return this._m.size;
  }

  /** Visit every styled cell as (ref, style). */
  forEach(fn) {
    for (const [ref, style] of this._m) fn(ref, style);
  }

  /** Sparse serialization: {"A1": {align, bg, bold, ...}, ...} (styled cells only). */
  toJSON() {
    const out = {};
    this.forEach((ref, style) => {
      out[ref] = Object.assign({}, style);
    });
    return out;
  }

  /** Rebuild from toJSON() output (empty map for anything else). */
  static fromJSON(data) {
    const s = new CellStyles();
    if (data && typeof data === "object") {
      for (const ref of Object.keys(data)) {
        const st = data[ref];
        if (st && typeof st === "object") s.set(ref, st);
      }
    }
    return s;
  }
}
