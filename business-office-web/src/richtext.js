// ============================================================================
//  RICH TEXT MODEL  (T4 — Rich Text Input Surface)
//
//  A small, pure (DOM-free) rich-text content model for the Documents app.
//  A document is a list of blocks (paragraphs); each block is a list of runs
//  (spans of text sharing one set of inline formats). Inline formats are
//  bold (b), italic (i) and underline (u).
//
//  The model is the single source of truth: the contenteditable surface is
//  parsed into it (fromHTML / fromMarkdown) and everything else — clean HTML
//  (getHTML), Markdown (getMarkdown), plain text — is serialized from it, so
//  output is always clean. Editing operations (applyFormat / insertText /
//  deleteRange) work in a coordinate space of "characters of run text" that
//  matches the DOM text nodes of the editor, so toolbar selections map
//  straight through.
// ============================================================================

const FORMATS = ["b", "i", "u"];

function makeRun(text, f = {}) {
  return { t: String(text), b: !!f.b, i: !!f.i, u: !!f.u };
}

function runEq(a, b) {
  return a.b === b.b && a.i === b.i && a.u === b.u;
}

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.t) continue;
    const last = out[out.length - 1];
    if (last && runEq(last, r)) last.t += r.t;
    else out.push(makeRun(r.t, r));
  }
  return out;
}

function sliceRun(run, from, to) {
  return makeRun(run.t.slice(from, to), run);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

function decodeEntities(s) {
  if (s.indexOf("&") === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ent) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[ent] !== undefined ? NAMED_ENTITIES[ent] : m;
  });
}

function escapeMdText(s) {
  return String(s).replace(/[\\*_~]/g, (c) => "\\" + c);
}

function serializeRunHTML(run) {
  let t = esc(run.t).replace(/\n/g, "<br>");
  if (run.b) t = "<strong>" + t + "</strong>";
  if (run.i) t = "<em>" + t + "</em>";
  if (run.u) t = "<u>" + t + "</u>";
  return t;
}

function serializeRunMD(run) {
  let t = escapeMdText(run.t);
  if (run.b) t = "**" + t + "**";
  if (run.i) t = "_" + t + "_";
  if (run.u) t = "~" + t + "~";
  return t;
}

// ── HTML → blocks ──────────────────────────────────────────────────────────
const BLOCK_TAGS = new Set(["p", "div", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"]);

function inlineFormat(tag, attrs) {
  const f = { b: false, i: false, u: false };
  if (tag === "b" || tag === "strong") f.b = true;
  else if (tag === "i" || tag === "em") f.i = true;
  else if (tag === "u") f.u = true;
  else if (tag === "span") {
    const m = /style\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs);
    if (m) {
      const st = m[2].toLowerCase();
      if (/(^|;)\s*font-weight\s*:\s*(bold|700|800)\b/.test(st)) f.b = true;
      if (/(^|;)\s*font-style\s*:\s*italic\b/.test(st)) f.i = true;
      if (/(^|;)\s*text-decoration\s*:\s*[^;]*underline/.test(st)) f.u = true;
    }
  }
  return f;
}

function currentFormat(stack) {
  const f = { b: false, i: false, u: false };
  for (const e of stack) {
    if (e.b) f.b = true;
    if (e.i) f.i = true;
    if (e.u) f.u = true;
  }
  return f;
}

function pushRun(runs, fmt, text) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && runEq(last, fmt)) last.t += text;
  else runs.push(makeRun(text, fmt));
}

function htmlToBlocks(html) {
  const blocks = [{ runs: [] }];
  const stack = [];
  const s = String(html ?? "");
  const n = s.length;
  let i = 0;

  // Drop whitespace-only text at the top level while the current block is
  // still empty (that is inter-block formatting); preserve everything else.
  const addText = (text) => {
    if (!text) return;
    text = decodeEntities(text);
    if (stack.length === 0 && text.trim() === "" && blocks[blocks.length - 1].runs.length === 0) return;
    pushRun(blocks[blocks.length - 1].runs, currentFormat(stack), text);
  };

  // Parse one tag (comment, open or close) at s[pos] === "<". Returns null
  // when it is not a real tag, so the "<" can be kept as literal text.
  const nextTag = (pos) => {
    if (s.startsWith("<!--", pos)) {
      const end = s.indexOf("-->", pos + 4);
      return end === -1 ? null : { name: "#comment", closing: false, attrs: "", end: end + 3 };
    }
    let j = pos + 1;
    const closing = s[j] === "/";
    if (closing) j++;
    const nameStart = j;
    while (j < n && /[a-zA-Z0-9-]/.test(s[j])) j++;
    const name = s.slice(nameStart, j);
    if (!name || !/[a-zA-Z]/.test(name[0])) return null;
    let attrs = "";
    let closed = false;
    while (j < n) {
      const c = s[j];
      if (c === ">") { closed = true; j++; break; }
      if (c === '"' || c === "'") {
        attrs += c;
        j++;
        while (j < n && s[j] !== c) { attrs += s[j]; j++; }
        if (j >= n) return null;
        attrs += c;
        j++;
      } else {
        attrs += c;
        j++;
      }
    }
    if (!closed) return null;
    return { name: name.toLowerCase(), closing, attrs, end: j };
  };

  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt === -1) {
      addText(s.slice(i));
      break;
    }
    if (lt > i) {
      addText(s.slice(i, lt));
      i = lt;
    }
    const tag = nextTag(i);
    if (!tag) {
      addText("<");
      i++;
      continue;
    }
    i = tag.end;
    if (tag.name === "#comment") continue;
    if (tag.closing) {
      if (BLOCK_TAGS.has(tag.name)) {
        if (blocks[blocks.length - 1].runs.length) blocks.push({ runs: [] });
      } else {
        let found = -1;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tag === tag.name) { found = k; break; }
        }
        if (found >= 0) stack.length = found;
      }
    } else {
      if (tag.name === "br") {
        pushRun(blocks[blocks.length - 1].runs, currentFormat(stack), "\n");
      } else if (BLOCK_TAGS.has(tag.name)) {
        if (blocks[blocks.length - 1].runs.length) blocks.push({ runs: [] });
      } else {
        const f = inlineFormat(tag.name, tag.attrs);
        stack.push({ tag: tag.name, b: f.b, i: f.i, u: f.u });
      }
    }
  }
  while (blocks.length && !blocks[blocks.length - 1].runs.length) blocks.pop();
  if (!blocks.length) blocks.push({ runs: [] });
  return blocks;
}

// ── Markdown (our subset) → runs ───────────────────────────────────────────
function parseInline(line) {
  const runs = [];
  let f = { b: false, i: false, u: false };
  let buf = "";
  const flush = () => {
    if (buf) {
      pushRun(runs, f, buf);
      buf = "";
    }
  };
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === "\\" && i + 1 < n && "\\*_~".includes(line[i + 1])) {
      buf += line[i + 1];
      i += 2;
      continue;
    }
    if (line.startsWith("**", i)) { flush(); f.b = !f.b; i += 2; continue; }
    if (c === "*" || c === "_") { flush(); f.i = !f.i; i += 1; continue; }
    if (c === "~") { flush(); f.u = !f.u; i += 1; continue; }
    buf += c;
    i += 1;
  }
  flush();
  if (!runs.length) runs.push(makeRun(""));
  return mergeRuns(runs);
}

// ── Formatting / editing helpers (operate in run-text coordinates) ─────────
function applyFormatToRuns(runs, s, e, fmt) {
  const total = runs.reduce((a, r) => a + r.t.length, 0);
  s = Math.max(0, s);
  e = Math.min(e, total);
  if (s >= e) return runs;
  const out = [];
  let pos = 0;
  for (const run of runs) {
    const len = run.t.length;
    const rs = pos;
    const re = pos + len;
    pos = re;
    if (re <= s || rs >= e) { out.push(run); continue; }
    const a = Math.max(s, rs);
    const b = Math.min(e, re);
    if (a > rs) out.push(sliceRun(run, 0, a - rs));
    const mid = sliceRun(run, a - rs, b - rs);
    mid[fmt] = !mid[fmt];
    out.push(mid);
    if (b < re) out.push(sliceRun(run, b - rs, len));
  }
  return mergeRuns(out);
}

function insertIntoRuns(runs, at, text) {
  const out = [];
  let pos = 0;
  let done = false;
  for (const run of runs) {
    const len = run.t.length;
    if (!done && at >= pos && at <= pos + len) {
      const local = at - pos;
      const ins = makeRun(text, run);
      if (local === 0) {
        out.push(ins);
        out.push(run);
      } else if (local === len) {
        out.push(run);
        out.push(ins);
      } else {
        out.push(sliceRun(run, 0, local));
        out.push(ins);
        out.push(sliceRun(run, local, len));
      }
      done = true;
    } else {
      out.push(run);
    }
    pos += len;
  }
  if (!done) {
    const last = out[out.length - 1] || makeRun("");
    out.push(makeRun(text, last));
  }
  return mergeRuns(out);
}

function deleteFromRuns(runs, s, e) {
  const total = runs.reduce((a, r) => a + r.t.length, 0);
  s = Math.max(0, s);
  e = Math.min(e, total);
  if (s >= e) return runs;
  const out = [];
  let pos = 0;
  for (const run of runs) {
    const len = run.t.length;
    const rs = pos;
    const re = pos + len;
    pos = re;
    if (re <= s || rs >= e) { out.push(run); continue; }
    const a = Math.max(s, rs);
    const b = Math.min(e, re);
    if (a > rs) out.push(sliceRun(run, 0, a - rs));
    if (b < re) out.push(sliceRun(run, b - rs, len));
  }
  return mergeRuns(out);
}

// ── The document model ─────────────────────────────────────────────────────
export class RichText {
  constructor(blocks = null) {
    this.blocks = blocks || [{ runs: [makeRun("")] }];
  }

  static fromHTML(html) {
    return new RichText(htmlToBlocks(html));
  }

  static fromMarkdown(md) {
    const blocks = [];
    const segs = String(md ?? "").split(/\r?\n{2,}/);
    for (const seg of segs) {
      if (!seg.trim()) continue;
      blocks.push({ runs: parseInline(seg) });
    }
    if (!blocks.length) blocks.push({ runs: [makeRun("")] });
    return new RichText(blocks);
  }

  _editLength() {
    let n = 0;
    for (const b of this.blocks) for (const r of b.runs) n += r.t.length;
    return n;
  }

  /** Paragraph-aware plain text (paragraphs separated by a blank line). */
  getPlainText() {
    return this.blocks.map((b) => b.runs.map((r) => r.t).join("")).join("\n\n");
  }

  /** Clean HTML: only <p>, <strong>, <em>, <u>, <br> and escaped text. */
  getHTML() {
    return this.blocks.map((b) => "<p>" + b.runs.map(serializeRunHTML).join("") + "</p>").join("");
  }

  /** Clean Markdown: **bold**, *italic*, __underline__, paragraphs by blank line. */
  getMarkdown() {
    return this.blocks.map((b) => b.runs.map(serializeRunMD).join("")).join("\n\n");
  }

  wordCount() {
    const t = this.getPlainText().trim();
    return t ? t.split(/\s+/).filter(Boolean).length : 0;
  }

  charCount() {
    return this._editLength();
  }

  isEmpty() {
    return this.getPlainText().trim() === "";
  }

  /** Toggle an inline format over a plain-text character range [start, end). */
  applyFormat(start, end, fmt) {
    if (!FORMATS.includes(fmt)) throw new Error("Unknown format: " + fmt);
    if (start > end) { const t = start; start = end; end = t; }
    const total = this._editLength();
    start = Math.max(0, Math.min(start, total));
    end = Math.max(0, Math.min(end, total));
    if (start >= end) return this;
    let offset = 0;
    for (const b of this.blocks) {
      const blen = b.runs.reduce((a, r) => a + r.t.length, 0);
      if (start < offset + blen && end > offset) {
        b.runs = applyFormatToRuns(b.runs, start - offset, end - offset, fmt);
      }
      offset += blen;
    }
    return this;
  }

  /** Insert text at a plain-text offset, inheriting the surrounding format. */
  insertText(offset, text) {
    const total = this._editLength();
    offset = Math.max(0, Math.min(offset, total));
    const s = String(text);
    if (!s) return this;
    let pos = 0;
    for (const b of this.blocks) {
      const blen = b.runs.reduce((a, r) => a + r.t.length, 0);
      if (offset >= pos && offset <= pos + blen) {
        b.runs = insertIntoRuns(b.runs, offset - pos, s);
        break;
      }
      pos += blen;
    }
    return this;
  }

  /** Delete the plain-text character range [start, end). */
  deleteRange(start, end) {
    if (start > end) { const t = start; start = end; end = t; }
    const total = this._editLength();
    start = Math.max(0, Math.min(start, total));
    end = Math.max(0, Math.min(end, total));
    if (start >= end) return this;
    let offset = 0;
    for (const b of this.blocks) {
      const blen = b.runs.reduce((a, r) => a + r.t.length, 0);
      if (start < offset + blen && end > offset) {
        b.runs = deleteFromRuns(b.runs, start - offset, end - offset);
      }
      offset += blen;
    }
    const kept = this.blocks.filter((b) => b.runs.some((r) => r.t.length > 0));
    this.blocks = kept.length ? kept : [{ runs: [makeRun("")] }];
    return this;
  }
}
