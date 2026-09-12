import { createZip, uniqueZipName } from "../lib/zip.js";
import { contentHash } from "./watch.js";

export function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(text) {
  const codes = [];
  let out = String(text == null ? "" : text).replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return "\u0000C" + (codes.length - 1) + "\u0000";
  });
  out = escapeHtml(out);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, src) => '<img src="' + src + '" alt="' + alt + '"/>');
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, label, href) => '<a href="' + href + '">' + label + '</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/\u0000C(\d+)\u0000/g, (m, i) => "<code>" + escapeHtml(codes[Number(i)]) + "</code>");
  return out;
}

function splitTableRow(line) {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
}

function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && /-/.test(line);
}

export function markdownToXhtml(markdown) {
  const lines = String(markdown == null ? "" : markdown).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    let m = /^```(.*)$/.exec(line);
    if (m) {
      const lang = m[1].trim();
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push("<pre><code" + (lang ? ' class="language-' + escapeXml(lang) + '"' : "") + ">" + escapeHtml(buf.join("\n")) + "</code></pre>");
      continue;
    }

    m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const level = m[1].length;
      out.push("<h" + level + ">" + inlineMarkdown(m[2].trim()) + "</h" + level + ">");
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr/>"); i++; continue; }

    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push("<blockquote>" + markdownToXhtml(buf.join("\n")) + "</blockquote>");
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) { rows.push(splitTableRow(lines[i])); i++; }
      out.push(
        "<table><thead><tr>" + headers.map(h => "<th>" + inlineMarkdown(h) + "</th>").join("") + "</tr></thead><tbody>" +
        rows.map(r => "<tr>" + r.map(c => "<td>" + inlineMarkdown(c) + "</td>").join("") + "</tr>").join("") +
        "</tbody></table>"
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      out.push("<ul>" + items.map(t => "<li>" + inlineMarkdown(t) + "</li>").join("") + "</ul>");
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "")); i++; }
      out.push("<ol>" + items.map(t => "<li>" + inlineMarkdown(t) + "</li>").join("") + "</ol>");
      continue;
    }

    const para = [line.trim()];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^```/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !isTableRow(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push("<p>" + inlineMarkdown(para.join(" ")) + "</p>");
  }

  return out.join("\n");
}

function pseudoUuid(seed) {
  const h = (contentHash(seed) + contentHash(seed + "x") + contentHash(seed + "y") + contentHash(seed + "z")).slice(0, 32);
  return h.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

function chapterTitle(chapter, index) {
  return chapter.title || chapter.name || "Chapter " + (index + 1);
}

export function buildEpub(chapters, options = {}) {
  const list = (Array.isArray(chapters) ? chapters : []).filter(c => c && String(c.markdown || "").trim());
  const title = options.title || "Extrax export";
  const author = options.author || "Extrax";
  const lang = options.lang || "en";
  const identifier = "urn:uuid:" + pseudoUuid(title + "|" + list.length + "|" + (options.createdAt || ""));
  const modified = new Date(options.createdAt || Date.now()).toISOString().replace(/\.\d+Z$/, "Z");

  const used = new Set();
  const items = [];
  const chaptersMeta = list.map((c, index) => {
    const name = uniqueZipName("chapter-" + (index + 1) + ".xhtml", used);
    used.add(name);
    return { id: "chap" + (index + 1), file: name, title: chapterTitle(c, index), chapter: c };
  });

  const css = [
    "body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; margin: 5%; }",
    "h1, h2, h3, h4, h5, h6 { font-family: system-ui, sans-serif; line-height: 1.25; }",
    "pre { background: #f4f4f4; padding: 0.8em; overflow-x: auto; }",
    "code { font-family: ui-monospace, Menlo, Consolas, monospace; }",
    "table { border-collapse: collapse; width: 100%; }",
    "th, td { border: 1px solid #bbb; padding: 0.4em 0.6em; text-align: left; }",
    "blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #444; }",
    "img { max-width: 100%; }"
  ].join("\n");

  const files = [
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n'
    },
    { name: "OEBPS/style.css", data: css },
    { name: "OEBPS/nav.xhtml", data: navXhtml(chaptersMeta, title) },
    { name: "OEBPS/toc.ncx", data: tocNcx(chaptersMeta, title, identifier) }
  ];

  for (const meta of chaptersMeta) {
    files.push({ name: "OEBPS/" + meta.file, data: chapterXhtml(meta, lang) });
  }

  const manifest = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '    <item id="css" href="style.css" media-type="text/css"/>'
  ];
  for (const meta of chaptersMeta) {
    manifest.push('    <item id="' + meta.id + '" href="' + escapeXml(meta.file) + '" media-type="application/xhtml+xml"/>');
  }
  const spine = chaptersMeta.map(meta => '    <itemref idref="' + meta.id + '"/>').join("\n");

  const opf = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '    <dc:identifier id="bookid">' + escapeXml(identifier) + "</dc:identifier>",
    "    <dc:title>" + escapeXml(title) + "</dc:title>",
    "    <dc:language>" + escapeXml(lang) + "</dc:language>",
    "    <dc:creator>" + escapeXml(author) + "</dc:creator>",
    '    <meta property="dcterms:modified">' + modified + "</meta>",
    "  </metadata>",
    "  <manifest>",
    manifest.join("\n"),
    "  </manifest>",
    '  <spine toc="ncx">',
    spine,
    "  </spine>",
    "</package>"
  ].join("\n");

  files.push({ name: "OEBPS/content.opf", data: opf });

  return createZip(files);
}

function chapterXhtml(meta, lang) {
  const body = markdownToXhtml(meta.chapter.markdown);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!DOCTYPE html>",
    '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + escapeXml(lang) + '" lang="' + escapeXml(lang) + '">',
    "<head>",
    "  <title>" + escapeXml(meta.title) + "</title>",
    '  <link rel="stylesheet" type="text/css" href="style.css"/>',
    "</head>",
    "<body>",
    "<h1>" + escapeXml(meta.title) + "</h1>",
    body,
    "</body>",
    "</html>"
  ].join("\n");
}

function navXhtml(chaptersMeta, title) {
  const items = chaptersMeta.map(m => '      <li><a href="' + escapeXml(m.file) + '">' + escapeXml(m.title) + "</a></li>").join("\n");
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!DOCTYPE html>",
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">',
    "<head><title>" + escapeXml(title) + "</title></head>",
    "<body>",
    '  <nav epub:type="toc" id="toc">',
    "    <h1>" + escapeXml(title) + "</h1>",
    "    <ol>",
    items,
    "    </ol>",
    "  </nav>",
    "</body>",
    "</html>"
  ].join("\n");
}

function tocNcx(chaptersMeta, title, identifier) {
  const points = chaptersMeta.map((m, i) => [
    '    <navPoint id="navPoint-' + (i + 1) + '" playOrder="' + (i + 1) + '">',
    "      <navLabel><text>" + escapeXml(m.title) + "</text></navLabel>",
    '      <content src="' + escapeXml(m.file) + '"/>',
    "    </navPoint>"
  ].join("\n")).join("\n");
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    "  <head>",
    '    <meta name="dtb:uid" content="' + escapeXml(identifier) + '"/>',
    '    <meta name="dtb:depth" content="1"/>',
    "  </head>",
    "  <docTitle><text>" + escapeXml(title) + "</text></docTitle>",
    "  <navMap>",
    points,
    "  </navMap>",
    "</ncx>"
  ].join("\n");
}

export function epubFileName(title) {
  return String(title || "extrax-export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) + ".epub";
}
