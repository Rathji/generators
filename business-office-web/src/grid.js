// ============================================================================
//  GRID DATA STRUCTURE  (T7 — Grid Data Structure)
//
//  A spreadsheet grid: a 2D array of cells addressed either by A1-style
//  references ("B3") or by zero-based {row, col} numbers. Cells store plain
//  values (strings, numbers, booleans) exactly as given; reading an empty or
//  out-of-bounds cell returns "". Writing past the current bounds grows the
//  grid to fit. Serialization (toJSON / fromJSON) is sparse — only non-empty
//  cells are persisted, so a mostly-blank sheet stays small.
//
//  Pure module — no DOM. The A1 coordinate helpers are exported too, so the
//  formula engine (T8) and cross-app links (T15) can reuse them.
// ============================================================================

/** "A" -> 0, "Z" -> 25, "AA" -> 26, "AZ" -> 51, "BA" -> 52. null if invalid. */
export function colToIndex(col) {
  if (typeof col !== "string") return null;
  const s = col.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return null;
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA", 701 -> "ZZ". null if invalid. */
export function indexToCol(index) {
  if (!Number.isInteger(index) || index < 0) return null;
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "B3" -> {row: 2, col: 1} (zero-based, case-insensitive). null if invalid. */
export function cellToRC(ref) {
  if (typeof ref !== "string") return null;
  const m = /^([A-Za-z]+)([1-9]\d*)$/.exec(ref.trim());
  if (!m) return null;
  const col = colToIndex(m[1]);
  if (col === null) return null;
  return { row: parseInt(m[2], 10) - 1, col };
}

/** {row: 2, col: 1} -> "B3". null if out of range. */
export function rcToCell(row, col) {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return null;
  return indexToCol(col) + (row + 1);
}

export class Grid {
  /** A blank grid of `rows` x `cols` empty cells. */
  constructor(rows = 100, cols = 26) {
    if (!Number.isInteger(rows) || rows < 0 || !Number.isInteger(cols) || cols < 0) {
      throw new TypeError("Grid dimensions must be non-negative integers");
    }
    this.rows = rows;
    this.cols = cols;
    this._data = [];
    for (let r = 0; r < rows; r++) this._data.push(new Array(cols).fill(""));
  }

  _coords(ref, col) {
    if (typeof ref === "number" && typeof col === "number") {
      if (!Number.isInteger(ref) || !Number.isInteger(col)) throw new TypeError("row/col must be integers");
      if (ref < 0 || col < 0) throw new RangeError("row/col out of bounds: " + ref + "," + col);
      return { row: ref, col };
    }
    const rc = cellToRC(ref);
    if (!rc) throw new RangeError("Invalid cell reference: " + ref);
    return rc;
  }

  _grow(row, col) {
    let changed = false;
    if (row >= this.rows) {
      for (let r = this.rows; r <= row; r++) this._data.push(new Array(this.cols).fill(""));
      this.rows = row + 1;
      changed = true;
    }
    if (col >= this.cols) {
      for (const rowArr of this._data) {
        for (let c = this.cols; c <= col; c++) rowArr.push("");
      }
      this.cols = col + 1;
      changed = true;
    }
    return changed;
  }

  /** Read a cell. Accepts "B3" or (row, col). Empty/out-of-bounds -> "". */
  get(ref, col) {
    const rc = this._coords(ref, col);
    if (rc.row >= this.rows || rc.col >= this.cols) return "";
    return this._data[rc.row][rc.col];
  }

  /** Write a cell ("" clears it). Grows the grid to fit. Returns previous value. */
  set(ref, col, value) {
    if (arguments.length === 2) {
      value = col;
      col = undefined;
    }
    const rc = this._coords(ref, col);
    this._grow(rc.row, rc.col);
    const prev = this._data[rc.row][rc.col];
    this._data[rc.row][rc.col] = value === "" ? "" : value;
    return prev;
  }

  /** Empty every cell (dimensions unchanged). */
  clear() {
    for (let r = 0; r < this.rows; r++) this._data[r].fill("");
  }

  /** Bottom-right corner of the used region (max row, max col). {-1,-1} when blank. */
  usedRange() {
    let maxRow = -1;
    let maxCol = -1;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this._data[r][c] !== "") {
          if (r > maxRow) maxRow = r;
          if (c > maxCol) maxCol = c;
        }
      }
    }
    return { row: maxRow, col: maxCol };
  }

  /** Number of non-empty cells. */
  nonEmptyCount() {
    let n = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this._data[r][c] !== "") n++;
      }
    }
    return n;
  }

  /** Visit every non-empty cell as (ref, value, row, col) in row-major order. */
  forEach(fn) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = this._data[r][c];
        if (v !== "") fn(rcToCell(r, c), v, r, c);
      }
    }
  }

  /** Grow or shrink the grid; shrinking discards data beyond the new bounds. */
  resize(rows, cols) {
    if (!Number.isInteger(rows) || rows < 0 || !Number.isInteger(cols) || cols < 0) {
      throw new TypeError("Grid dimensions must be non-negative integers");
    }
    if (rows < this.rows) this._data.length = rows;
    while (this._data.length < rows) this._data.push(new Array(Math.max(cols, this.cols)).fill(""));
    for (const rowArr of this._data) {
      if (cols < rowArr.length) rowArr.length = cols;
      while (rowArr.length < cols) rowArr.push("");
    }
    this.rows = rows;
    this.cols = cols;
  }

  /** Sparse serialization: {rows, cols, cells: {"A1": value, ...}} (non-empty only). */
  toJSON() {
    const cells = {};
    this.forEach((ref, v) => {
      cells[ref] = v;
    });
    return { rows: this.rows, cols: this.cols, cells };
  }

  /** Rebuild a grid from toJSON() output (or a blank grid for anything else). */
  static fromJSON(data) {
    if (!data || typeof data !== "object" || !Number.isInteger(data.rows) || !Number.isInteger(data.cols)) {
      return new Grid(0, 0);
    }
    const g = new Grid(Math.max(0, data.rows), Math.max(0, data.cols));
    if (data.cells && typeof data.cells === "object") {
      for (const ref of Object.keys(data.cells)) {
        const rc = cellToRC(ref);
        if (rc && data.cells[ref] !== "") g.set(rc.row, rc.col, data.cells[ref]);
      }
    }
    return g;
  }
}
