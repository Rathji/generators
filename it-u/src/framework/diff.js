// src/framework/diff.js — line-level diff (LCS) between two texts, with an
// HTML renderer for the review "what changed" view (roadmap task 15).
//
// diffLines(a, b) -> [{type: "same"|"add"|"del", text}]
// renderDiffHtml(diff) -> html string with ins/del markers.

export function diffLines(aText, bText) {
  const a = String(aText || "").split("\n");
  const b = String(bText || "").split("\n");
  const n = a.length;
  const m = b.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    dp[i] = new Array(m + 1).fill(0);
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i++] });
  }
  while (j < m) {
    out.push({ type: "add", text: b[j++] });
  }
  return out;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function renderDiffHtml(diff) {
  let html = '<div class="kb-diff">';
  let lineNo = 1;
  for (const d of diff) {
    if (d.type === "same") {
      html += `<div class="kb-diff-line"><span class="kb-diff-num">${lineNo}</span><span class="kb-diff-text">${esc(d.text) || "&nbsp;"}</span></div>`;
      lineNo++;
    } else if (d.type === "del") {
      html += `<div class="kb-diff-line kb-diff-del"><span class="kb-diff-num">${lineNo}</span><span class="kb-diff-text">${esc(d.text) || "&nbsp;"}</span></div>`;
      lineNo++;
    } else {
      html += `<div class="kb-diff-line kb-diff-add"><span class="kb-diff-num">+</span><span class="kb-diff-text">${esc(d.text) || "&nbsp;"}</span></div>`;
    }
  }
  html += "</div>";
  return html;
}

export function diffSummary(diff) {
  let added = 0;
  let removed = 0;
  for (const d of diff) {
    if (d.type === "add") added++;
    else if (d.type === "del") removed++;
  }
  return { added, removed };
}
