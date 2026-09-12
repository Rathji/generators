// ============================================================================
//  DOCUMENT EXPORT MODULE  (T5)
//
//  Turns the current document state (a RichText model from src/richtext.js)
//  into real downloadable files:
//    • .html — a standalone document (doctype, <title>, embedded print-ready
//      styles) whose body is EXACTLY the model's clean HTML (getHTML).
//    • .txt  — the document's plain text, preceded by a title header line so
//      the file still names itself when opened in a plain-text editor.
//  `downloadFile` does the browser plumbing (Blob → object URL → <a download>).
// ============================================================================

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Strip characters that are illegal in filenames; never return empty. */
export function sanitizeFilename(name, fallback = "document") {
  const s = String(name ?? "")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return s || fallback;
}

const DOC_STYLE = `
* { box-sizing: border-box; }
body { margin: 0; background: #eef1f7; color: #1d2942;
  font-family: Georgia, "Times New Roman", Times, serif; }
.doc { max-width: 760px; margin: 36px auto; padding: 56px 72px;
  background: #fff; border: 1px solid #e2e8f2; border-radius: 4px;
  box-shadow: 0 2px 18px rgba(20,40,90,.14); font-size: 16px; line-height: 1.7; }
p { margin: 0 0 1em; }
h1, h2, h3 { font-family: Lato, Arial, sans-serif; color: #0a2e63; }
p:last-child { margin-bottom: 0; }
@media print { body { background: #fff; }
  .doc { margin: 0; padding: 20mm; border: none; box-shadow: none; max-width: none; } }
`.trim();

/** A complete, standalone HTML file for the document. */
export function renderHTMLFile(rt, { title = "Untitled", style = DOC_STYLE } = {}) {
  const t = esc(title);
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${t}</title>`,
    `<style>${style}</style>`,
    "</head>",
    "<body>",
    `<main class="doc">${rt.getHTML()}</main>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Plain-text file: an optional title header line, then the exact plain text. */
export function renderTextFile(rt, { title = "" } = {}) {
  const text = rt.getPlainText();
  const head = title ? `# ${title}\n\n` : "";
  return head + text + (text && !text.endsWith("\n") ? "\n" : "");
}

/** Create a Blob and trigger a browser download. Returns the object URL. */
export function downloadFile({ name, content, mime = "text/plain" }) {
  const blob = new Blob([String(content)], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return url;
}

/** Export a RichText document as a download. Returns { url, filename, content, mime }. */
export function exportDocument(rt, { title = "Untitled", format = "html" } = {}) {
  const ext = format === "txt" ? "txt" : "html";
  const filename = sanitizeFilename(title, "document") + "." + ext;
  const mime = ext === "html" ? "text/html" : "text/plain";
  const content = ext === "html" ? renderHTMLFile(rt, { title }) : renderTextFile(rt, { title });
  const url = downloadFile({ name: filename, content, mime });
  return { url, filename, content, mime };
}
