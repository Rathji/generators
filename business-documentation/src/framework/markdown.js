// src/framework/markdown.js — compact markdown renderer used for article
// bodies. Supports headings (with ids for the TOC), paragraphs, emphasis,
// inline code, fenced code blocks, links (external + internal [[Title|id]]),
// images, nested ordered/unordered lists, task lists, blockquotes, tables,
// horizontal rules and hard line breaks. Returns rendered HTML plus a table
// of contents and a plain-text version for search.
//
// renderMarkdown(src) -> { html, toc, text }

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function slugify(text) {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "sec";
}

// Render inline markdown within a single line. Internal article links use the
// [[Title|art-id]] / [[art-id]] / [[Title]] syntax and become #/browse/article/
// anchors. Returns HTML (already escaped except for the structures we build).
function inline(src, links) {
  const out = [];
  let i = 0;
  let codeIdx = -1;
  // escape all, then re-insert structures
  let s = esc(src);
  const re =
    /(`[^`]+`)|(!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(\[\[([^\]|]+)(?:\|([a-z0-9-]+))?\]\])|(\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(~~([^~]+)~~)/g;
  let m;
  let last = 0;
  let n = 0;
  while ((m = re.exec(s))) {
    out.push(s.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(`<code>${m[1].slice(1, -1)}</code>`);
    } else if (m[2] !== undefined) {
      out.push(`<img src="${esc(m[4])}" alt="${esc(m[3])}" loading="lazy">`);
    } else if (m[5] !== undefined) {
      const title = m[6].trim();
      const id = m[7] ? m[7].trim() : (links && links.byTitle && links.byTitle[title.toLowerCase()]) || "";
      out.push(
        id
          ? `<a class="kb-internal-link" href="#/article/${encodeURIComponent(id)}">${esc(title)}</a>`
          : `<span class="kb-unresolved-link" title="Article not found">${esc(title)}</span>`,
      );
    } else if (m[8] !== undefined) {
      const url = m[10];
      const external = /^(https?:|mailto:)/.test(url);
      out.push(
        `<a href="${esc(url)}"${external ? ' target="_blank" rel="noopener"' : ""}>${esc(m[9])}</a>`,
      );
    } else if (m[11] !== undefined) {
      out.push(`<strong>${m[12]}</strong>`);
    } else if (m[13] !== undefined) {
      out.push(`<em>${m[14]}</em>`);
    } else if (m[15] !== undefined) {
      out.push(`<s>${m[16]}</s>`);
    }
    last = re.lastIndex;
    n++;
    if (n > 2000) break; // safety valve
  }
  out.push(s.slice(last));
  return out.join("");
}

function blockquoteHtml(lines) {
  return `<blockquote>${lines.map((l) => `<p>${inline(l)}</p>`).join("")}</blockquote>`;
}

function listHtml(rawBlocks) {
  // rawBlocks: array of {ordered, items: [ {marker, text, checked} ]}
  let html = "";
  for (const blk of rawBlocks) {
    const tag = blk.ordered ? "ol" : "ul";
    html += `<${tag}>`;
    for (const it of blk.items) {
      const cls = it.checked !== null ? ' class="kb-task-item"' : "";
      const box =
        it.checked !== null
          ? `<input type="checkbox"${it.checked ? " checked" : ""} onclick="this.disabled=true"> `
          : "";
      html += `<li${cls}>${box}${inline(it.text)}</li>`;
    }
    html += `</${tag}>`;
  }
  return html;
}

export function renderMarkdown(src, links = {}) {
  const text = String(src || "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const toc = [];
  const plain = [];
  const blocks = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // fenced code block
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const code = [];
      i++;
      while (i < n && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const body = esc(code.join("\n"));
      blocks.push(`<pre class="kb-code${lang ? ` language-${esc(lang)}` : ""}"><code>${body}</code></pre>`);
      plain.push(code.join("\n"));
      continue;
    }
    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const titleRaw = h[2].trim();
      const id = slugify(inline(titleRaw).replace(/<[^>]+>/g, ""));
      toc.push({ level, id, text: titleRaw.replace(/[*_`~]/g, "") });
      blocks.push(`<h${level} id="${id}" class="kb-h${level}">${inline(titleRaw)}</h${level}>`);
      plain.push(titleRaw);
      i++;
      continue;
    }
    // horizontal rule
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push("<hr>");
      i++;
      continue;
    }
    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const q = [];
      while (i < n && /^\s*>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(blockquoteHtml(q));
      plain.push(q.join("\n"));
      continue;
    }
    // lists (possibly contiguous, keep nesting simple: one level, but allow
    // indented continuation lines)
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const listBlocks = [];
      let cur = null;
      while (i < n) {
        const l = lines[i];
        let m = l.match(/^\s*([-*+])\s+(.*)$/);
        if (m) {
          const checked = /^\[( |x|X)\]\s+/.test(m[2]);
          const txt = checked ? m[2].replace(/^\[( |x|X)\]\s+/, "") : m[2];
          if (!cur || cur.ordered) {
            cur = { ordered: false, items: [] };
            listBlocks.push(cur);
          }
          cur.items.push({ text: txt, checked: checked ? /x/i.test(m[2].match(/^\[( |x|X)\]/)[1]) : null });
          i++;
          continue;
        }
        m = l.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (m) {
          if (!cur || !cur.ordered) {
            cur = { ordered: true, items: [] };
            listBlocks.push(cur);
          }
          cur.items.push({ text: m[2], checked: null });
          i++;
          continue;
        }
        // continuation line (indented) belongs to the previous item
        if (cur && /^\s{2,}\S/.test(l)) {
          const lastItem = cur.items[cur.items.length - 1];
          if (lastItem) lastItem.text += " " + l.trim();
          i++;
          continue;
        }
        break;
      }
      blocks.push(listHtml(listBlocks));
      continue;
    }
    // table: header row followed by a delimiter row
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < n && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const header = parseTableRow(line);
      const delim = lines[i + 1];
      const align = parseAlign(delim);
      i += 2;
      const rows = [];
      while (i < n && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      let th = "<thead><tr>";
      header.forEach((c, ci) => {
        th += `<th${align[ci] ? ` style="text-align:${align[ci]}"` : ""}>${inline(c)}</th>`;
      });
      th += "</tr></thead>";
      let tb = "<tbody>";
      for (const r of rows) {
        tb += "<tr>";
        r.forEach((c, ci) => {
          tb += `<td${align[ci] ? ` style="text-align:${align[ci]}"` : ""}>${inline(c)}</td>`;
        });
        tb += "</tr>";
      }
      tb += "</tbody>";
      blocks.push(`<table>${th}${tb}</table>`);
      for (const r of [header, ...rows]) plain.push(r.join(" | "));
      continue;
    }
    // paragraph: gather until a blank line or a new block start
    const para = [line];
    i++;
    while (
      i < n &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const joined = para
      .map((p, pi) => (pi > 0 ? p.trimStart() : p))
      .join("\n")
      .replace(/\n/g, "  \n");
    blocks.push(`<p>${inline(joined)}</p>`);
    plain.push(para.join(" "));
  }

  return { html: blocks.join("\n"), toc, text: plain.join("\n\n") };
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function parseAlign(delim) {
  return delim
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => {
      const t = c.trim();
      if (t.startsWith(":") && t.endsWith(":")) return "center";
      if (t.endsWith(":")) return "right";
      if (t.startsWith(":")) return "left";
      return null;
    });
}

// Build a title -> id lookup from a set of articles (for [[Title]] links).
export function titleLookup(articles) {
  const byTitle = {};
  for (const a of articles || []) {
    const k = String(a.title || "").trim().toLowerCase();
    if (k && !byTitle[k]) byTitle[k] = a.id;
  }
  return { byTitle };
}

// Find article ids referenced by internal links in a body.
export function extractArticleLinks(body) {
  const ids = new Set();
  const re = /\[\[([^\]|]+)(?:\|([a-z0-9-]+))?\]\]/g;
  let m;
  while ((m = re.exec(body || ""))) {
    if (m[2]) ids.add(m[2]);
  }
  return [...ids];
}

export function plainText(md) {
  return renderMarkdown(md).text;
}
