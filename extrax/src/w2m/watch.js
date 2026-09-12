import { markdownStats } from "./stats.js";

export function contentHash(text) {
  const s = String(text == null ? "" : text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "same", value: a[i] }); i++; j++; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) { ops.push({ type: "del", value: a[i] }); i++; }
    else { ops.push({ type: "add", value: b[j] }); j++; }
  }
  while (i < n) { ops.push({ type: "del", value: a[i] }); i++; }
  while (j < m) { ops.push({ type: "add", value: b[j] }); j++; }
  return ops;
}

function coarseOps(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const ops = [];
  for (let k = 0; k < start; k++) ops.push({ type: "same", value: a[k] });
  for (let k = start; k <= endA; k++) ops.push({ type: "del", value: a[k] });
  for (let k = start; k <= endB; k++) ops.push({ type: "add", value: b[k] });
  for (let k = endA + 1; k < a.length; k++) ops.push({ type: "same", value: a[k] });
  return ops;
}

export function diffLines(oldText, newText, options = {}) {
  const oldLines = String(oldText == null ? "" : oldText).split(/\r?\n/);
  const newLines = String(newText == null ? "" : newText).split(/\r?\n/);
  if (oldLines.length > 1 && oldLines[oldLines.length - 1] === "") oldLines.pop();
  if (newLines.length > 1 && newLines[newLines.length - 1] === "") newLines.pop();

  const budget = options.budget || 4000000;
  const ops = oldLines.length * newLines.length <= budget ? lcsOps(oldLines, newLines) : coarseOps(oldLines, newLines);

  const added = ops.filter(o => o.type === "add").length;
  const removed = ops.filter(o => o.type === "del").length;
  const hunks = buildHunks(ops, options.context != null ? options.context : 3);
  return { ops, added, removed, hunks, oldLines: oldLines.length, newLines: newLines.length, changed: added + removed > 0 };
}

function buildHunks(ops, context) {
  const changedIdx = [];
  ops.forEach((o, i) => { if (o.type !== "same") changedIdx.push(i); });
  if (!changedIdx.length) return [];
  const hunks = [];
  let start = Math.max(0, changedIdx[0] - context);
  let end = Math.min(ops.length - 1, changedIdx[0] + context);
  for (let k = 1; k < changedIdx.length; k++) {
    const idx = changedIdx[k];
    if (idx - context <= end + 1) {
      end = Math.min(ops.length - 1, idx + context);
    } else {
      hunks.push({ start, end, lines: ops.slice(start, end + 1) });
      start = Math.max(0, idx - context);
      end = Math.min(ops.length - 1, idx + context);
    }
  }
  hunks.push({ start, end, lines: ops.slice(start, end + 1) });
  return hunks;
}

export function changeSummary(diff) {
  if (!diff) return "No comparison.";
  if (!diff.changed) return "No changes detected.";
  const bits = [];
  if (diff.added) bits.push("+" + diff.added + " line" + (diff.added === 1 ? "" : "s"));
  if (diff.removed) bits.push("-" + diff.removed + " line" + (diff.removed === 1 ? "" : "s"));
  return bits.join(", ");
}

export function diffToMarkdown(diff, options = {}) {
  if (!diff) return "";
  const lines = ["# Changes" + (options.title ? " — " + options.title : ""), ""];
  lines.push("**" + changeSummary(diff) + "**");
  if (options.from && options.to) {
    lines.push("");
    lines.push("- Before: " + options.from);
    lines.push("- After: " + options.to);
  }
  lines.push("");
  if (!diff.changed) {
    lines.push("The content is identical.");
    return lines.join("\n");
  }
  for (const hunk of diff.hunks) {
    lines.push("```diff");
    for (const op of hunk.lines) {
      const prefix = op.type === "add" ? "+ " : op.type === "del" ? "- " : "  ";
      lines.push(prefix + op.value);
    }
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

export function diffStats(diff) {
  const changedLines = diff ? diff.added + diff.removed : 0;
  const total = diff ? Math.max(1, diff.newLines) : 1;
  const percent = Math.round((changedLines / total) * 1000) / 10;
  return { added: diff ? diff.added : 0, removed: diff ? diff.removed : 0, changedLines, percent };
}

export function createWatchRecord(input = {}) {
  const markdown = String(input.markdown == null ? "" : input.markdown);
  return {
    id: input.id || watchId(),
    title: String(input.title || input.url || "Untitled"),
    url: String(input.url || ""),
    site: String(input.site || ""),
    markdown,
    previous: String(input.previous == null ? "" : input.previous),
    hash: contentHash(markdown),
    stats: markdownStats(markdown),
    createdAt: input.createdAt || Date.now(),
    checkedAt: input.checkedAt || 0,
    checkCount: input.checkCount || 0,
    lastDiff: input.lastDiff || null,
    note: String(input.note || "")
  };
}

function watchId() {
  return "watch-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

export function createWatchStore(folder) {
  const ORDER_KEY = "order";
  const keyOf = id => "watch_" + id;
  async function list() {
    const order = (await folder.get(ORDER_KEY)) || [];
    const out = [];
    for (const id of order) {
      const v = await folder.get(keyOf(id));
      if (v && typeof v === "object") out.push(v);
    }
    return out;
  }
  async function save(record) {
    const rec = createWatchRecord(record);
    await folder.set(keyOf(rec.id), rec);
    await folder.update(ORDER_KEY, order => {
      const arr = Array.isArray(order) ? order : [];
      if (!arr.includes(rec.id)) arr.unshift(rec.id);
      return arr;
    });
    return rec;
  }
  async function remove(id) {
    await folder.delete(keyOf(id));
    await folder.update(ORDER_KEY, order => (Array.isArray(order) ? order : []).filter(x => x !== id));
  }
  async function patch(id, changes) {
    const current = await folder.get(keyOf(id));
    if (!current) return null;
    const next = { ...current, ...changes };
    await folder.set(keyOf(id), next);
    return next;
  }
  return { list, save, remove, patch };
}

export function watchSummary(record) {
  if (!record) return "";
  const stats = record.stats || markdownStats(record.markdown || "");
  const parts = [stats.words.toLocaleString() + " words"];
  if (record.checkedAt) parts.push("checked " + new Date(record.checkedAt).toLocaleDateString());
  return parts.join(" · ");
}
