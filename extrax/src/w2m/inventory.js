const SCHEME_SKIP = /^(?:data|blob|javascript|about):/i;
const FILE_EXT = /\.(pdf|zip|gz|tgz|tar|rar|7z|csv|xlsx?|docx?|pptx?|txt|rtf|epub|mp3|wav|ogg|flac|m4a|mp4|m4v|mov|avi|webm|mkv|png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;
const MEDIA_EXT = /\.(mp3|wav|ogg|flac|m4a|mp4|m4v|mov|avi|webm|mkv)$/i;

function resolveUrl(href, base) {
  const raw = String(href == null ? "" : href).trim();
  if (!raw || SCHEME_SKIP.test(raw)) return null;
  try { return new URL(raw, base).href; } catch (err) { return null; }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); } catch (err) { return ""; }
}

function extOf(url) {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(String(url || ""));
  return m ? m[1].toLowerCase() : "";
}

function srcsetUrls(value) {
  return String(value || "")
    .split(",")
    .map(part => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export function inventoryFromHtml(html, baseUrl, options = {}) {
  const parse = options.parse || (h => new DOMParser().parseFromString(String(h == null ? "" : h), "text/html"));
  let doc;
  try { doc = parse(html); } catch (err) { doc = null; }
  const base = resolveUrl(baseUrl, baseUrl) || String(baseUrl || "");
  const baseHost = hostOf(base);
  const internalOnly = !!options.internalOnly;

  const links = [];
  const images = [];
  const media = [];
  const files = [];
  const emails = [];
  const phones = [];
  const seenLinks = new Set();
  const seenImages = new Set();

  if (doc) {
    for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
      const href = a.getAttribute("href") || "";
      const text = String(a.textContent || "").replace(/\s+/g, " ").trim();
      if (/^mailto:/i.test(href)) {
        const addr = href.slice(7).split("?")[0].trim();
        if (addr && !emails.includes(addr)) emails.push(addr);
        continue;
      }
      if (/^tel:/i.test(href)) {
        const num = href.slice(4).trim();
        if (num && !phones.includes(num)) phones.push(num);
        continue;
      }
      const url = resolveUrl(href, base);
      if (!url) continue;
      const internal = hostOf(url) === baseHost;
      if (internalOnly && !internal) continue;
      if (seenLinks.has(url)) continue;
      seenLinks.add(url);
      const ext = extOf(url);
      const isFile = FILE_EXT.test(ext ? "." + ext : "");
      links.push({ url, text, host: hostOf(url), internal, ext, isFile, rel: a.getAttribute("rel") || "" });
      if (isFile) files.push({ url, text, ext });
    }

    for (const img of Array.from(doc.querySelectorAll("img"))) {
      const alt = String(img.getAttribute("alt") || "").trim();
      const addImage = raw => {
        const url = resolveUrl(raw, base);
        if (!url || seenImages.has(url)) return;
        seenImages.add(url);
        images.push({
          src: url,
          alt,
          width: img.getAttribute("width") || "",
          height: img.getAttribute("height") || "",
          internal: hostOf(url) === baseHost
        });
      };
      addImage(img.getAttribute("src") || "");
      for (const candidate of srcsetUrls(img.getAttribute("srcset"))) addImage(candidate);
    }

    for (const el of Array.from(doc.querySelectorAll("video, audio, source, track"))) {
      const raw = el.getAttribute("src") || "";
      const url = resolveUrl(raw, base);
      if (!url) continue;
      media.push({ src: url, tag: String(el.tagName || "").toLowerCase(), type: el.getAttribute("type") || "", internal: hostOf(url) === baseHost });
    }
  }

  const resolvedCount = (files.length ? files : []).length;
  return {
    base,
    host: baseHost,
    links,
    images,
    media,
    files,
    emails,
    phones,
    counts: {
      links: links.length,
      internal: links.filter(l => l.internal).length,
      external: links.filter(l => !l.internal).length,
      images: images.length,
      media: media.length,
      files: resolvedCount,
      emails: emails.length,
      phones: phones.length
    }
  };
}

export function inventorySummary(inv) {
  if (!inv) return "";
  const c = inv.counts;
  const bits = [];
  if (c.links) bits.push(c.links + " link" + (c.links === 1 ? "" : "s") + " (" + c.internal + " internal / " + c.external + " external)");
  if (c.images) bits.push(c.images + " image" + (c.images === 1 ? "" : "s"));
  if (c.media) bits.push(c.media + " media file" + (c.media === 1 ? "" : "s"));
  if (c.files) bits.push(c.files + " downloadable file" + (c.files === 1 ? "" : "s"));
  if (c.emails) bits.push(c.emails + " email" + (c.emails === 1 ? "" : "s"));
  return bits.length ? bits.join(" · ") : "Nothing found.";
}

export function inventoryToJson(inv) {
  return JSON.stringify(
    {
      base: inv.base,
      host: inv.host,
      counts: inv.counts,
      links: inv.links,
      images: inv.images,
      media: inv.media,
      files: inv.files,
      emails: inv.emails,
      phones: inv.phones
    },
    null,
    2
  );
}

function csvCell(value) {
  const s = String(value == null ? "" : value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function inventoryToCsv(inv) {
  const lines = ["type,url,text,host,internal"];
  for (const l of inv.links) lines.push(["link", l.url, l.text, l.host, l.internal].map(csvCell).join(","));
  for (const f of inv.files) lines.push(["file", f.url, f.text, hostOf(f.url), ""].map(csvCell).join(","));
  for (const i of inv.images) lines.push(["image", i.src, i.alt, hostOf(i.src), i.internal].map(csvCell).join(","));
  for (const m of inv.media) lines.push(["media", m.src, m.type, hostOf(m.src), m.internal].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

export function inventoryFiles(inv, options = {}) {
  if (!inv) return [];
  const base = String(options.baseName || "resources").replace(/[\\/:*?"<>|]+/g, "-");
  return [
    { name: base + ".json", mime: "application/json", text: inventoryToJson(inv) },
    { name: base + ".csv", mime: "text/csv;charset=utf-8", text: inventoryToCsv(inv) }
  ];
}

export function inventoryImageLinks(inv) {
  return (inv && Array.isArray(inv.images) ? inv.images : []).map(i => i.src);
}
