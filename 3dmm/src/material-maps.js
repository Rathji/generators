/* Derived PBR detail maps for reconstructed meshes.
 *
 * The reconstruction pipeline gives a mesh one base-colour texture and a single roughness value --
 * i.e. a perfectly smooth surface wearing a photograph. That flatness is the main thing that keeps a
 * generated mesh reading as a "scan" instead of a real object: there is no micro-relief for the
 * light to catch and no crease darkening to ground the form.
 *
 * We derive the two missing maps from the base colour's luminance (a cheap stand-in for a height
 * field; the photo's own baked shading already encodes creases and surface texture):
 *
 *   normalMap -- tangent-space normals from a Sobel gradient of a denoised height field. Adds
 *                micro-detail (fabric weave, skin, grain) that the lighting responds to.
 *   aoMap     -- a cavity map: how far a pixel sits below its blurred neighbourhood. Darkens
 *                crevices, which is what makes a form read as solid.
 *
 * Roughness is left to the uniform slider: packing a metallicRoughness texture (G=roughness,
 * B=metalness) correctly is fiddly and easy to get subtly wrong, so we ship two clean maps.
 *
 * Everything runs on 2D canvases; a 512px derive is a few milliseconds on the main thread.
 */

import { THREE } from "./three.js";

function toCanvas(source, size) {
  const img = source && source.image ? source.image : source;
  const iw = img.naturalWidth || img.videoWidth || img.width || size;
  const ih = img.naturalHeight || img.videoHeight || img.height || size;
  const scale = Math.min(1, size / Math.max(iw, ih));
  const w = Math.max(2, Math.round(iw * scale));
  const h = Math.max(2, Math.round(ih * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: c, ctx, w, h };
}

function luminanceField(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const f = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    f[i] = (d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722) / 255;
  }
  return f;
}

/* Separable box blur; one pass is a decent low-pass for our purposes. */
function blurField(src, w, h, r) {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win;
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const sub = src[y * w + Math.max(0, x - r)];
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      acc += add - sub;
    }
  }
  return out;
}

/* Scale a field to unit standard deviation so the normal strength means the same thing on any
   image (a high-contrast photo would otherwise emboss much harder than a flat one). */
function normalizeField(f) {
  const n = f.length;
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { s += f[i]; s2 += f[i] * f[i]; }
  const mean = s / n;
  const sd = Math.sqrt(Math.max(1e-9, s2 / n - mean * mean));
  const inv = 1 / sd;
  for (let i = 0; i < n; i++) f[i] = (f[i] - mean) * inv;
  return f;
}

/* luminance minus a broad blur -> band-pass: keeps weave/pore/strand-scale detail while dropping
   the photo's big baked shading gradients. Embossing those would double the lighting "for free". */
function bandpass(field, w, h, r) {
  const broad = blurField(field, w, h, r);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = field[i] - broad[i];
  return normalizeField(out);
}

function normalCanvas(field, w, h, strength) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const out = ctx.createImageData(w, h);
  const d = out.data;
  const at = (x, y) => field[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function aoCanvas(field, blurred, w, h, strength) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const out = ctx.createImageData(w, h);
  const d = out.data;
  for (let i = 0; i < w * h; i++) {
    const cav = Math.max(0, blurred[i] - field[i]);
    const ao = Math.max(0, Math.min(1, 1 - cav * strength * 6));
    const v = ao * 255;
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/* source: a THREE texture, HTMLImageElement, ImageBitmap or canvas. `opts.size` is the derive
   resolution cap; strengths are multipliers around 1. Returns canvases (null on failure). */
export function deriveDetailMaps(source, opts = {}) {
  try {
    const img = source && source.image ? source.image : source;
    if (!img) return null;
    const size = opts.size || 640;
    const { ctx, w, h } = toCanvas(img, size);
    const lum = luminanceField(ctx, w, h);
    const detail = bandpass(lum, w, h, Math.max(2, Math.round(size / 48)));
    const normal = normalCanvas(detail, w, h, opts.normalStrength != null ? opts.normalStrength : 0.8);
    const broad = blurField(lum, w, h, Math.max(3, Math.round(size / 32)));
    const ao = aoCanvas(lum, broad, w, h, opts.aoStrength != null ? opts.aoStrength : 0.5);
    return { normal, ao, width: w, height: h };
  } catch (e) {
    console.warn("detail map derive failed", e);
    return null;
  }
}

/* Wrap a canvas as a three texture. Colour maps are sRGB, data maps (normal/AO) are linear. */
export function canvasTexture(canvas, srgb = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/* aoMap in this three build samples the second UV set (uv1). Give every geometry in `root` one if
   it is missing, mirroring uv0 so the two maps line up. Idempotent. */
export function ensureUv1(root) {
  root.traverse && root.traverse((o) => {
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.uv) return;
    if (!g.attributes.uv1) {
      g.setAttribute("uv1", g.attributes.uv);
      g.attributes.uv1.needsUpdate = true;
    }
  });
}
