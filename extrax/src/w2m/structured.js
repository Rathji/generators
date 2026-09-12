function cleanText(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function parseIntAttr(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function tableMatrix(table) {
  const rowEls = Array.from(table.querySelectorAll("tr"));
  const grid = [];
  const occupied = new Set();
  rowEls.forEach((tr, r) => {
    let c = 0;
    for (const cell of Array.from(tr.children)) {
      const tag = String(cell.tagName || "").toUpperCase();
      if (tag !== "TD" && tag !== "TH") continue;
      while (occupied.has(r + "," + c)) c++;
      const cs = parseIntAttr(cell.getAttribute("colspan"));
      const rs = parseIntAttr(cell.getAttribute("rowspan"));
      const text = cleanText(cell.textContent);
      const isHeader = tag === "TH";
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          occupied.add(rr + "," + cc);
          if (!grid[rr]) grid[rr] = [];
          grid[rr][cc] = dr === 0 && dc === 0 ? { text, isHeader } : { text: "", isHeader, spanned: true };
        }
      }
      c += cs;
    }
  });
  const width = grid.reduce((max, row) => Math.max(max, row ? row.length : 0), 0);
  const cells = [];
  for (let r = 0; r < grid.length; r++) {
    const row = [];
    for (let c = 0; c < width; c++) {
      const cell = grid[r] && grid[r][c];
      row.push(cell ? { text: cell.text, isHeader: !!cell.isHeader } : { text: "", isHeader: false });
    }
    cells.push(row);
  }
  return cells;
}

export function tablesFromHtml(html, options = {}) {
  const parse = options.parse || (h => new DOMParser().parseFromString(String(h == null ? "" : h), "text/html"));
  let doc;
  try { doc = parse(html); } catch (err) { return []; }
  const tables = Array.from(doc.querySelectorAll("table"));
  const out = [];
  tables.forEach((table, i) => {
    const cells = tableMatrix(table);
    const nonEmpty = cells.filter(row => row.some(c => c.text !== ""));
    if (!nonEmpty.length) return;
    const captionEl = table.querySelector("caption");
    const heading = table.previousElementSibling && /^H[1-6]$/i.test(table.previousElementSibling.tagName)
      ? cleanText(table.previousElementSibling.textContent)
      : "";
    const first = cells[0] || [];
    const headerFromTags = first.length > 0 && first.every(c => c.isHeader || c.text === "");
    const headerFromContent = first.length > 0 && first.filter(c => c.text !== "").some(c => c.isHeader);
    const hasHeader = headerFromTags || headerFromContent;
    const headers = hasHeader ? first.map(c => c.text) : first.map((_, idx) => "Column " + (idx + 1));
    const dataRows = (hasHeader ? cells.slice(1) : cells).map(row => row.map(c => c.text));
    out.push({
      index: i,
      caption: captionEl ? cleanText(captionEl.textContent) : "",
      heading,
      headers,
      rows: dataRows,
      rowCount: dataRows.length,
      colCount: headers.length,
      hasHeader
    });
  });
  return out;
}

function csvCell(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function tableToCsv(table, options = {}) {
  if (!table) return "";
  const delimiter = options.delimiter || ",";
  const lines = [];
  if (table.hasHeader !== false) lines.push(table.headers.map(csvCell).join(delimiter));
  for (const row of table.rows) lines.push(row.map(csvCell).join(delimiter));
  return lines.join("\n") + "\n";
}

export function tablesToJson(tables) {
  return JSON.stringify(
    (Array.isArray(tables) ? tables : []).map(t => ({
      title: t.caption || t.heading || "Table " + (t.index + 1),
      columns: t.headers,
      rows: t.rows
    })),
    null,
    2
  );
}

function slug(name, fallback) {
  return String(name || fallback || "table").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || (fallback || "table");
}

export function tableFiles(tables, options = {}) {
  const list = Array.isArray(tables) ? tables : [];
  const base = String(options.baseName || "tables").replace(/[\\/:*?"<>|]+/g, "-");
  const format = options.format === "json" ? "json" : "csv";
  const used = new Set();
  const files = [];
  const unique = name => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate)) { candidate = name.replace(/(\.[a-z]+)$/i, "-" + n + "$1"); n++; }
    used.add(candidate);
    return candidate;
  };
  if (!list.length) return { files, count: 0, format };

  if (!options.individual) {
    if (format === "json") {
      files.push({ name: base + ".json", mime: "application/json", text: tablesToJson(list) });
    } else {
      const text = list.map(t => {
        const title = t.caption || t.heading || "Table " + (t.index + 1);
        return "# " + title + "\n\n" + tableToCsv(t);
      }).join("\n");
      files.push({ name: base + ".csv", mime: "text/csv;charset=utf-8", text });
    }
    return { files, count: list.length, format };
  }

  list.forEach((t, i) => {
    const title = t.caption || t.heading || "table-" + (i + 1);
    if (format === "json") {
      files.push({ name: unique(base + "-" + slug(title, "table-" + (i + 1)) + ".json"), mime: "application/json", text: tablesToJson([t]) });
    } else {
      files.push({ name: unique(base + "-" + slug(title, "table-" + (i + 1)) + ".csv"), mime: "text/csv;charset=utf-8", text: tableToCsv(t) });
    }
  });
  return { files, count: list.length, format };
}

export function tablesSummary(tables) {
  const list = Array.isArray(tables) ? tables : [];
  if (!list.length) return "No tables found.";
  const cells = list.reduce((sum, t) => sum + t.rowCount * Math.max(1, t.colCount), 0);
  return list.length + " table" + (list.length === 1 ? "" : "s") + " · " + cells.toLocaleString() + " cells";
}

const SCHEMA_PREAMBLE = [
  "You are a precise data-extraction engine. You receive the Markdown of a web page and must return structured data as strict JSON.",
  "",
  "Rules:",
  "- Output ONLY valid JSON — no commentary, no explanation, no surrounding code fence.",
  "- Use exactly the field names given in the TASK. Do not invent fields.",
  "- If a field's value is not present in the page, use null (or an empty array for list fields).",
  "- Never invent facts, numbers, names or quotes that are not in the document.",
  "- Preserve the original language of the values."
].join("\n");

export function buildSchemaPrompt(options = {}) {
  const schema = options.schema || {};
  const instruction = String(options.instruction || "").trim();
  const parts = [SCHEMA_PREAMBLE, ""];
  parts.push("DOCUMENT METADATA:");
  parts.push("- Title: " + (options.title || "(untitled)"));
  parts.push("- URL: " + (options.url || "(unknown)"));
  parts.push("");
  parts.push("<DOCUMENT>");
  parts.push(String(options.markdown == null ? "" : options.markdown));
  parts.push("</DOCUMENT>");
  parts.push("");
  parts.push("TASK:");
  if (instruction) parts.push(instruction);
  parts.push("Return JSON matching this shape (field names are exact):");
  parts.push(typeof schema === "string" ? schema : JSON.stringify(schema, null, 2));
  return parts.join("\n");
}

export function parseSchemaOutput(raw) {
  let text = String(raw == null ? "" : raw).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start === -1) return { ok: false, error: "No JSON found in the response.", value: null };
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return { ok: false, error: "The JSON looked incomplete.", value: null };
  const slice = text.slice(start, end + 1);
  try {
    return { ok: true, value: JSON.parse(slice), error: "", raw: slice };
  } catch (err) {
    return { ok: false, error: "Could not parse the JSON: " + (err && err.message), value: null, raw: slice };
  }
}

export function defaultSchema() {
  return {
    title: "",
    summary: "",
    author: "",
    published: "",
    items: [{ name: "", value: "" }]
  };
}
