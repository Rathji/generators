// ============================================================================
//  DOM EDITING HELPERS
//
//  Caret/selection utilities shared by the suite's contenteditable surfaces
//  (the Documents editor and the Mail compose pane). They translate between the
//  live DOM selection and the plain-text offsets the RichText model uses, so a
//  toolbar can apply a format to exactly the selection the user sees.
//
//  DOM-touching by nature — the pure document model stays in src/richtext.js.
// ============================================================================

/** Plain-text selection offsets within `container`, matching the model's
 *  coordinate space (min/max of anchor & focus). */
export function selectionOffsets(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
  const nodes = [];
  {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
  }
  const total = nodes.reduce((a, n) => a + (n.textContent || "").length, 0);
  const posOf = (node, off) => {
    if (node === container) return off;
    let pos = 0;
    for (const n of nodes) {
      if (n === node) return pos + off;
      pos += (n.textContent || "").length;
    }
    return total;
  };
  const a = posOf(sel.anchorNode, sel.anchorOffset);
  const b = posOf(sel.focusNode, sel.focusOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** Restore a selection at plain-text offsets [start, end] within `container`. */
export function setSelectionAt(container, start, end) {
  const nodes = [];
  {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
  }
  if (!nodes.length) {
    container.focus();
    return;
  }
  let anchor = null, anchorOff = 0, focus = null, focusOff = 0;
  let pos = 0;
  for (const n of nodes) {
    const len = (n.textContent || "").length;
    if (anchor === null && start <= pos + len) { anchor = n; anchorOff = Math.min(len, start - pos); }
    if (focus === null && end <= pos + len) { focus = n; focusOff = Math.min(len, end - pos); }
    pos += len;
    if (anchor && focus) break;
  }
  if (!anchor && nodes.length) {
    anchor = focus = nodes[nodes.length - 1];
    anchorOff = focusOff = (anchor.textContent || "").length;
  }
  if (anchor && !focus) { focus = anchor; focusOff = anchorOff; }
  const range = document.createRange();
  range.setStart(anchor, anchorOff);
  range.setEnd(focus, focusOff);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
