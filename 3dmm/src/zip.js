/*
 * zip.js — a tiny, dependency-free ZIP writer (STORE method, no compression).
 *
 * Several export targets need to hand the user a *package* of files rather than a single
 * mesh: Tabletop Simulator wants .obj + .mtl + texture .png side by side, the game-engine
 * target wants a GLB plus collision/LOD variants, and the "everything" target bundles the
 * lot. The browser has no built-in archiver, and pulling a compression library in for a
 * handful of small files is overkill, so this writes the ZIP container itself.
 *
 * STORE (method 0) means the file bytes are copied verbatim — no DEFLATE — which is a
 * perfectly valid ZIP that every OS, Blender, Unity, TTS and slicer opens. The trade-off is
 * size, and that is fine: the archivable payload per target is at most a few MB.
 *
 * Verified against the format spec (local file header + central directory + EOCD) and by
 * round-tripping through `@zip.js/zip.js`.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* MS-DOS packed date/time. Only whole seconds exist, and the year is 1980-based. */
function dosStamp(d) {
  const date = d || new Date();
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

function asBytes(data, enc) {
  if (data == null) return new Uint8Array(0);
  if (typeof data === "string") return enc.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) throw new Error("zip: pass Blob data as a Uint8Array (use blobBytes first)");
  return enc.encode(String(data));
}

/*
 * files: [{ name, data, date? }] where `data` is a string, Uint8Array, ArrayBuffer or view.
 * Names use forward slashes for folders. An optional `folder` prefix is applied to every
 * entry, which is how each target nests its files under the model name.
 */
export function zipBytes(files, opts = {}) {
  const enc = new TextEncoder();
  const { time, date } = dosStamp(opts.date);
  const folder = opts.folder ? String(opts.folder).replace(/\/+$/, "") + "/" : "";
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    if (!f || !f.name) continue;
    const nameBytes = enc.encode(folder + f.name);
    const data = asBytes(f.data, enc);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true); // needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  for (const c of central) {
    out.set(c, p);
    p += c.length;
  }
  out.set(eocd, p);
  return out;
}

export function zipBlob(files, opts = {}) {
  return new Blob([zipBytes(files, opts)], { type: "application/zip" });
}

/* Convenience for callers that hold a Blob (e.g. a canvas render) rather than bytes. */
export async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
