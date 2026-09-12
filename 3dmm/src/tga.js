/*
 * tga.js - Truevision TGA (Targa) codec.
 *
 * Blender loves TGA: it is the default format for many packed .blend textures, for
 * baked renders, and for the "Save As Image" paths in older pipelines. Browsers,
 * however, cannot decode TGA at all - createImageBitmap / <img> / TextureLoader all
 * fail on it silently. So a .blend file whose material packs a .tga texture imports
 * with the mesh but *no* colour. This module is the missing decoder (and a matching
 * encoder so we can hand TGA back out).
 *
 * Supports every image type a real TGA file uses:
 *   type 0  no image data
 *   type 1  colour-mapped          (+ 9  RLE)
 *   type 2  true-colour            (+ 10 RLE)
 *   type 3  greyscale              (+ 11 RLE)
 * with 8 / 15 / 16 / 24 / 32 bpp pixels, 15/16/24/32-bit colour-map entries, both
 * origin conventions (bottom-up and top-down), and the header's right-to-left flag.
 * The optional "TRUEVISION-XFILE" footer is understood for format detection.
 *
 * Everything here is pure JS and DOM-free (the canvas helpers take a canvas factory
 * so they run on the main thread or inside a Worker).
 */

const FOOTER_SIG = "TRUEVISION-XFILE";

/* TGA has no leading magic number. Be conservative: require a plausible 18-byte header
   AND either the extension marker or the footer signature before claiming a blob is TGA,
   so we never hijack a PNG/JPEG that happens to start with small byte values. */
export function isTGA(bytes, name = "") {
  if (/\.(tga|icb|vda|vst)$/i.test(name)) return true;
  if (!bytes || bytes.length < 18) return false;
  return hasFooter(bytes) || plausibleHeader(bytes);
}

function hasFooter(bytes) {
  const n = bytes.length;
  if (n < 26) return false;
  // The footer's 16 signature bytes sit at the very end, optionally followed by a
  // zero byte and (for 2.0 files) a \\0 terminator, so scan the last ~40 bytes.
  const start = Math.max(0, n - 40);
  let s = "";
  for (let i = start; i < Math.min(n, start + 40); i++) s += String.fromCharCode(bytes[i]);
  return s.includes(FOOTER_SIG);
}

const VALID_TYPES = new Set([0, 1, 2, 3, 9, 10, 11]);

function plausibleHeader(bytes) {
  const type = bytes[2];
  if (!VALID_TYPES.has(type)) return false;
  const cmapType = bytes[1];
  if (cmapType !== 0 && cmapType !== 1) return false;
  const w = bytes[12] | (bytes[13] << 8);
  const h = bytes[14] | (bytes[15] << 8);
  if (!w || !h || w > 8192 || h > 8192) return false;
  const depth = bytes[16];
  if (![8, 15, 16, 24, 32].includes(depth)) return false;
  return true;
}

/* decodeTGA(bytes) -> { width, height, data (RGBA Uint8ClampedArray), bpp, imageType,
   hasAlpha, rle } or throws a descriptive Error. */
export function decodeTGA(bytes) {
  if (!bytes) throw new Error("TGA: empty input");
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 18) throw new Error("TGA: file shorter than its header");

  const idLength = b[0];
  const cmapType = b[1];
  const imageType = b[2];
  const cmapFirst = b[3] | (b[4] << 8);
  const cmapLength = b[5] | (b[6] << 8);
  const cmapEntryBits = b[7];
  const width = b[12] | (b[13] << 8);
  const height = b[14] | (b[15] << 8);
  const pixelBits = b[16];
  const descriptor = b[17];

  const rle = imageType === 9 || imageType === 10 || imageType === 11;
  const baseType = rle ? imageType - 8 : imageType;

  if (imageType === 0) throw new Error("TGA: file contains no image data");
  if (baseType < 1 || baseType > 3) throw new Error("TGA: unsupported image type " + imageType);
  if (!width || !height) throw new Error("TGA: zero dimensions");

  const topDown = (descriptor & 0x20) !== 0;
  const rightToLeft = (descriptor & 0x10) !== 0;
  const alphaBits = descriptor & 0x0f;

  const bytesPerPixel = Math.ceil(pixelBits / 8);
  let pos = 18 + idLength;

  /* ---- colour map (only meaningful for baseType 1) ---- */
  let cmap = null;
  if (cmapType === 1 && cmapLength) {
    const entryBytes = Math.ceil(cmapEntryBits / 8);
    cmap = readColorMap(b, pos, cmapLength, cmapEntryBits);
    pos += cmapLength * entryBytes;
  }
  if (baseType === 1 && !cmap) throw new Error("TGA: colour-mapped image without a colour map");

  const data = new Uint8ClampedArray(width * height * 4);
  const pixel = new Uint8Array(bytesPerPixel);

  let out = 0;
  let anyAlpha16 = false;
  const writePixel = () => {
    let r, g, bl, a = 255;
    if (baseType === 2 && pixelBits === 16) {
      const v = pixel[0] | (pixel[1] << 8);
      if (v & 0x8000) anyAlpha16 = true;
    }
    if (baseType === 1) {
      const idx = bytesPerPixel === 2 ? pixel[0] | (pixel[1] << 8) : pixel[0];
      const e = cmap[idx - cmapFirst];
      if (e) {
        r = e[0]; g = e[1]; bl = e[2]; a = e[3];
      } else {
        r = g = bl = 0;
      }
    } else if (baseType === 3) {
      r = g = bl = pixel[0];
      if (bytesPerPixel === 2) a = pixel[1];
    } else {
      const packed = unpackTrueColor(pixel, pixelBits);
      r = packed[0]; g = packed[1]; bl = packed[2]; a = packed[3];
    }
    data[out] = r; data[out + 1] = g; data[out + 2] = bl; data[out + 3] = a;
    out += 4;
  };

  const total = width * height;
  if (!rle) {
    for (let i = 0; i < total; i++) {
      if (pos + bytesPerPixel > b.length) break;
      for (let k = 0; k < bytesPerPixel; k++) pixel[k] = b[pos++];
      writePixel();
    }
  } else {
    let i = 0;
    while (i < total) {
      if (pos >= b.length) break;
      const packet = b[pos++];
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        if (pos + bytesPerPixel > b.length) break;
        for (let k = 0; k < bytesPerPixel; k++) pixel[k] = b[pos++];
        for (let n = 0; n < count && i < total; n++, i++) writePixel();
      } else {
        for (let n = 0; n < count && i < total; n++, i++) {
          if (pos + bytesPerPixel > b.length) break;
          for (let k = 0; k < bytesPerPixel; k++) pixel[k] = b[pos++];
          writePixel();
        }
      }
    }
  }

  /* 16-bit "alpha" is a single bit that plenty of real files never set while still
     meaning "opaque". Only honour it if at least one pixel actually sets the bit. */
  const alpha16Real = pixelBits === 16 && anyAlpha16;
  if (baseType === 2 && pixelBits === 16 && !anyAlpha16) {
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
  }

  /* Normalise the two origin conventions into a top-down RGBA buffer. */
  if (!topDown) flipRows(data, width, height);
  if (rightToLeft) flipColumns(data, width, height);

  return {
    width,
    height,
    data,
    bpp: pixelBits,
    imageType,
    hasAlpha:
      (baseType === 2 && pixelBits === 32 && alphaBits > 0) ||
      (baseType === 1 && cmap && cmap.alpha) ||
      (baseType === 3 && pixelBits === 16 && alphaBits > 0) ||
      alpha16Real,
    rle,
  };
}

function readColorMap(b, pos, length, bits) {
  const entryBytes = Math.ceil(bits / 8);
  const map = new Array(length);
  let alpha = false;
  for (let i = 0; i < length; i++) {
    const o = pos + i * entryBytes;
    if (o + entryBytes > b.length) break;
    let r, g, bl, a = 255;
    if (bits === 15 || bits === 16) {
      const v = b[o] | (b[o + 1] << 8);
      r = expand5((v >> 10) & 0x1f);
      g = expand5((v >> 5) & 0x1f);
      bl = expand5(v & 0x1f);
      if (bits === 16) a = (v & 0x8000) ? 255 : 0;
    } else if (bits === 24) {
      bl = b[o]; g = b[o + 1]; r = b[o + 2];
    } else if (bits === 32) {
      bl = b[o]; g = b[o + 1]; r = b[o + 2]; a = b[o + 3];
      if (a !== 255) alpha = true;
    } else if (bits === 8) {
      r = g = bl = b[o];
    }
    map[i] = [r, g, bl, a];
  }
  map.alpha = alpha;
  return map;
}

function unpackTrueColor(pixel, bits) {
  if (bits === 15 || bits === 16) {
    const v = pixel[0] | (pixel[1] << 8);
    const a = bits === 16 ? ((v & 0x8000) ? 255 : 0) : 255;
    return [expand5((v >> 10) & 0x1f), expand5((v >> 5) & 0x1f), expand5(v & 0x1f), a];
  }
  if (bits === 24) return [pixel[2], pixel[1], pixel[0], 255];
  if (bits === 32) return [pixel[2], pixel[1], pixel[0], pixel[3]];
  return [pixel[0], pixel[0], pixel[0], 255];
}

function expand5(v) {
  return (v << 3) | (v >> 2);
}

function flipRows(data, w, h) {
  const row = w * 4;
  const tmp = new Uint8ClampedArray(row);
  for (let y = 0; y < h >> 1; y++) {
    const a = y * row;
    const b = (h - 1 - y) * row;
    tmp.set(data.subarray(a, a + row));
    data.copyWithin(a, b, b + row);
    data.set(tmp, b);
  }
}

function flipColumns(data, w, h) {
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w >> 1; x++) {
      const a = row + x * 4;
      const b = row + (w - 1 - x) * 4;
      for (let k = 0; k < 4; k++) {
        const t = data[a + k];
        data[a + k] = data[b + k];
        data[b + k] = t;
      }
    }
  }
}

/* ---- canvas / three.js bridges ------------------------------------------------ */

/* makeCanvas defaults to OffscreenCanvas when present (workers), else a <canvas>. Returns
   a canvas whose pixels are the decoded image, top-down, ready for a texture upload. */
export function tgaToCanvas(bytes, makeCanvas) {
  const img = decodeTGA(bytes);
  const canvas = makeCanvas
    ? makeCanvas(img.width, img.height)
    : typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(img.width, img.height)
      : Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(img.width, img.height);
  out.data.set(img.data);
  ctx.putImageData(out, 0, 0);
  return canvas;
}

export function tgaToDataURL(bytes, makeCanvas) {
  const canvas = tgaToCanvas(bytes, makeCanvas);
  return typeof canvas.convertToBlob === "function"
    ? canvas.convertToBlob({ type: "image/png" }).then((blob) => blobToDataURL(blob))
    : canvas.toDataURL("image/png");
}

export function tgaToBlob(bytes, makeCanvas, mime = "image/png") {
  const canvas = tgaToCanvas(bytes, makeCanvas);
  return typeof canvas.convertToBlob === "function"
    ? canvas.convertToBlob({ type: mime })
    : new Promise((resolve) => canvas.toBlob(resolve, mime));
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/* ---- encoder ----------------------------------------------------------------- */

/* encodeTGA({width,height,data}, {rle=false, alpha=true, bottomUp=false}) -> Uint8Array.
   `data` is RGBA (Uint8ClampedArray/Uint8Array/Array), interpreted top-down (row 0 = top)
   by default; pass bottomUp:true to flip it into the classic TGA bottom-left origin.
   Emits image type 2 (or 10 with RLE). */
export function encodeTGA(image, opts = {}) {
  const width = image.width | 0;
  const height = image.height | 0;
  if (!width || !height) throw new Error("TGA encode: zero dimensions");
  const src = image.data;
  const rle = !!opts.rle;
  const alpha = opts.alpha !== false;

  const bpp = alpha ? 4 : 3;
  const out = [];
  const push16 = (v) => { out.push(v & 0xff, (v >> 8) & 0xff); };

  out.push(0, 0, rle ? 10 : 2);
  for (let i = 0; i < 5; i++) out.push(0);
  push16(0); push16(0);
  push16(width); push16(height);
  // Row 0 of `data` is the top row, so the descriptor's top-origin bit is set unless
  // the caller explicitly wants the classic bottom-up layout.
  out.push(bpp * 8, (alpha ? 8 : 0) | (opts.bottomUp ? 0 : 0x20));

  const srcRow = (i) => (opts.bottomUp ? (height - 1 - Math.floor(i / width)) * width + (i % width) : i);
  const pixelAt = (i) => {
    const o = srcRow(i) * 4;
    const a = alpha ? src[o + 3] : 255;
    return [src[o + 2], src[o + 1], src[o], a]; // BGR(A)
  };
  const same = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3];
  const pushPixel = (p) => { for (let k = 0; k < bpp; k++) out.push(p[k]); };

  const total = width * height;
  if (!rle) {
    for (let i = 0; i < total; i++) pushPixel(pixelAt(i));
  } else {
    let i = 0;
    while (i < total) {
      const first = pixelAt(i);
      let run = 1;
      while (i + run < total && run < 128 && same(first, pixelAt(i + run))) run++;
      if (run > 1) {
        out.push(0x80 | (run - 1));
        pushPixel(first);
        i += run;
      } else {
        let raw = 1;
        while (i + raw < total && raw < 128 && !same(pixelAt(i + raw - 1), pixelAt(i + raw))) raw++;
        out.push(raw - 1);
        for (let n = 0; n < raw; n++) pushPixel(pixelAt(i + n));
        i += raw;
      }
    }
  }
  return new Uint8Array(out);
}
