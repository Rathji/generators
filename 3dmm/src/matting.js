const TF_URL = "https://esm.sh/@huggingface/transformers@3.5.1";
const MODEL = "briaai/RMBG-1.4";

let tfPromise = null;
let pipePromise = null;

function loadTF() {
  if (!tfPromise) tfPromise = import(TF_URL);
  return tfPromise;
}

export async function getMattePipeline(onStatus) {
  if (!pipePromise) {
    pipePromise = (async () => {
      const tf = await loadTF();
      onStatus && onStatus("Loading cut-out model\u2026");
      return tf.pipeline("background-removal", MODEL, {
        device: "wasm",
        dtype: "q8",
        progress_callback: (p) => {
          if (!p || p.status !== "progress" || typeof p.progress !== "number") return;
          onStatus && onStatus(`Downloading cut-out model \u2026 ${Math.round(p.progress)}%`);
        },
      });
    })().catch((e) => {
      pipePromise = null;
      throw e;
    });
  }
  return pipePromise;
}

export async function warmUpMatte(onStatus) {
  await getMattePipeline(onStatus);
}

export async function estimateMatte(source, onStatus) {
  const tf = await loadTF();
  const pipe = await getMattePipeline(onStatus);
  onStatus && onStatus("Cutting out the subject\u2026");
  let input = source;
  if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
    const ctx = source.getContext("2d", { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, source.width, source.height);
    input = new tf.RawImage(id.data, source.width, source.height, 4);
  }
  const out = await pipe(input);
  const o = Array.isArray(out) ? out[0] : out;
  const data = o.data;
  const width = o.width;
  const height = o.height;
  const channels = o.channels;
  const mask = new Float32Array(width * height);
  const last = channels - 1;
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * channels + last] / 255;
  return { data: mask, width, height };
}

/* ---------------------------------------------------------------- silhouette */

function downscaleTo(source, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/* Keep only the biggest 4-connected blob. Generated images routinely carry a few stray
   specks (a watermark edge, a highlight on the backdrop) and a single detached speck is a
   real island of geometry to the mesh extractor, so it has to go. */
export function keepLargestComponent(mask, w, h) {
  const n = w * h;
  const lab = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let cur = 0, best = -1, bestN = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    cur++;
    let sp = 0;
    stack[sp++] = i;
    lab[i] = cur;
    let cnt = 0;
    while (sp) {
      const p = stack[--sp];
      cnt++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = cur; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = cur; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = cur; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = cur; stack[sp++] = p + w; }
    }
    if (cnt > bestN) { bestN = cnt; best = cur; }
  }
  const out = new Uint8Array(n);
  if (best < 0) return { mask: out, count: 0 };
  for (let i = 0; i < n; i++) if (lab[i] === best) out[i] = 1;
  return { mask: out, count: bestN };
}

/* Fill only *small* enclosed background regions. A learned matte speckles a subject with
   pinholes, and each one becomes a tunnel through the mesh, so those have to go. But a real
   hole - the eye of a teapot handle, the gap between a chair's legs - is part of the shape,
   so holes larger than `maxFraction` of the silhouette are left alone. */
export function fillHoles(mask, w, h, maxFraction = 0.01) {
  const n = w * h;
  const reach = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const visit = (i) => { if (!mask[i] && !reach[i]) { reach[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (y > 0) visit(p - w);
    if (y < h - 1) visit(p + w);
  }
  let fg = 0;
  for (let i = 0; i < n; i++) if (mask[i]) fg++;
  const limit = Math.max(1, fg * maxFraction);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] ? 1 : 0;
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (mask[start] || reach[start] || seen[start]) continue;
    let head = 0, tail = 0;
    stack[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const p = stack[head++];
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && !mask[p - 1] && !reach[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[tail++] = p - 1; }
      if (x < w - 1 && !mask[p + 1] && !reach[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[tail++] = p + 1; }
      if (y > 0 && !mask[p - w] && !reach[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[tail++] = p - w; }
      if (y < h - 1 && !mask[p + w] && !reach[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[tail++] = p + w; }
    }
    if (tail <= limit) for (let k = 0; k < tail; k++) out[stack[k]] = 1;
  }
  return out;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const cl = (v, m) => (v < 0 ? 0 : v > m ? m : v);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + cl(x, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc -= src[y * w + cl(x - r, w - 1)];
      acc += src[y * w + cl(x + r + 1, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[cl(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc -= tmp[cl(y - r, h - 1) * w + x];
      acc += tmp[cl(y + r + 1, h - 1) * w + x];
    }
  }
  return out;
}

/* Flat-backdrop key. Generated images almost always sit on a seamless studio sweep, and on
   a backdrop like that a colour-distance key is dramatically more reliable than a learned
   matte: it follows the silhouette exactly, and - the part that matters - it throws away the
   soft ground shadow, which a matte model happily promotes to "subject". Left in, that
   shadow is read by the encoder as a sheet of real surface and the reconstruction inflates
   into a blob. Returns null when the border is not uniform (a real scene / a busy photo). */
export function flatBackgroundKey(imageData, opts = {}) {
  const { width: w, height: h, data } = imageData;
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.015));
  const stride = Math.max(1, Math.round(Math.min(w, h) / 220));
  const rs = [], gs = [], bs = [];
  const sample = (i) => { rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  for (let y = 0; y < h; y += stride) {
    for (let b = 0; b < band; b++) { sample((y * w + b) * 4); sample((y * w + w - 1 - b) * 4); }
  }
  for (let x = 0; x < w; x += stride) {
    for (let b = 0; b < band; b++) { sample((b * w + x) * 4); sample(((h - 1 - b) * w + x) * 4); }
  }
  const median = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const bg = [median(rs), median(gs), median(bs)];
  let dev = 0;
  for (let i = 0; i < rs.length; i++) {
    dev += Math.abs(rs[i] - bg[0]) + Math.abs(gs[i] - bg[1]) + Math.abs(bs[i] - bg[2]);
  }
  dev /= Math.max(1, rs.length) * 3;
  if (dev > (opts.maxDeviation || 18)) return null;
  const threshold = Math.max(opts.minThreshold || 32, dev * 4.5);
  const n = w * h;
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = data[o] - bg[0], dg = data[o + 1] - bg[1], db = data[o + 2] - bg[2];
    mask[i] = Math.sqrt(dr * dr + dg * dg + db * db) > threshold ? 1 : 0;
  }
  const largest = keepLargestComponent(mask, w, h);
  mask = fillHoles(largest.mask, w, h, opts.maxHoleFraction ?? 0.004);
  return { mask, width: w, height: h, background: bg, deviation: dev, coverage: largest.count / n };
}

/* The entry point the app uses: hand it a canvas, get a clean 0..1 coverage mask at that
   canvas' resolution, plus which method won. */
export async function cutoutSubject(canvas, onStatus, opts = {}) {
  const w = canvas.width, h = canvas.height;
  let mask = null, method = "none";

  if (opts.preferFlat !== false) {
    const id = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
    const key = flatBackgroundKey(id, opts);
    if (key && key.coverage > 0.01 && key.coverage < 0.985) {
      mask = key.mask;
      method = "flat";
    }
  }

  if (!mask) {
    const m = await estimateMatte(canvas, onStatus);
    const small = new Uint8Array(m.width * m.height);
    for (let i = 0; i < small.length; i++) small[i] = m.data[i] > 0.5 ? 1 : 0;
    let shaped = keepLargestComponent(small, m.width, m.height).mask;
    shaped = fillHoles(shaped, m.width, m.height);
    const mc = document.createElement("canvas");
    mc.width = m.width;
    mc.height = m.height;
    const mctx = mc.getContext("2d");
    const img = mctx.createImageData(m.width, m.height);
    for (let i = 0; i < small.length; i++) {
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = shaped[i] ? 255 : 0;
    }
    mctx.putImageData(img, 0, 0);
    const id = downscaleTo(mc, w, h);
    mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = id.data[i * 4 + 3] > 127 ? 1 : 0;
    method = "neural";
  }

  const n = w * h;
  const soft = new Float32Array(n);
  for (let i = 0; i < n; i++) soft[i] = mask[i];
  const blurred = boxBlur(soft, w, h, 1);
  let covered = 0;
  for (let i = 0; i < n; i++) if (mask[i]) covered++;
  return { data: blurred, mask, width: w, height: h, method, coverage: covered / n };
}
