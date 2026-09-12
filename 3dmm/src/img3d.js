/*
 * TripoSR — single image -> mesh reconstruction, fully client-side on WebGPU.
 *
 * This module is the main-thread client. All ONNX Runtime work (weight downloads, WebGPU
 * session creation, the image encoder, the triplane transformer, the grid decode, mesh
 * extraction and per-vertex colouring) happens in img3d-worker.js so the page never
 * blocks. Downloads are cached in the Cache Storage API, so the ~485 MB of weights are
 * fetched once per origin.
 *
 * Model: https://huggingface.co/cgb/triposr-onnx-webgpu — an int8 (block-32 weight-only)
 *        ONNX export of VAST-AI-Research/TripoSR (Tripo AI + Stability AI, Apache-2.0).
 *        <https://huggingface.co/cgb/triposr-onnx-webgpu/tree/048725e957f485cc6bc082a9d6a239fcf7d8880a>
 */

const INPUT_SIZE = 512;
const BACKGROUND_COLOR = 0.5;
const FOREGROUND_RATIO = 0.85;

export const IMG3D_BYTES = 885712 + 483785728 + 173796;

/* overall progress span for each worker phase: [start, length] */
const SPANS = {
  load: [0.02, 0.46],
  encode: [0.48, 0.05],
  shape: [0.53, 0.12],
  decode: [0.65, 0.2],
  mesh: [0.85, 0.02],
  color: [0.87, 0.11],
  done: [1, 0],
};

const device = { gpu: false, adapter: "", reason: "" };
let worker = null;
let msgId = 0;
let activeProgress = null;
let loaded = false;
const pending = new Map();

export function img3dSupported() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

export function img3dStatus() {
  return { ...device, loaded, weights: IMG3D_BYTES };
}

export function totalBytes() {
  return IMG3D_BYTES;
}

export async function probeDevice() {
  if (device.reason) return device;
  if (!img3dSupported()) {
    device.reason = "WebGPU is not available in this browser";
    return device;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no GPU adapter");
    const info = adapter.info || {};
    device.gpu = true;
    device.adapter = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ");
  } catch {
    device.reason = "WebGPU adapter unavailable";
  }
  return device;
}

function spawnWorker() {
  const url = new URL("/src/img3d-worker.js", location.origin);
  try {
    return new Worker(url, { type: "module" });
  } catch {
    return null;
  }
}

function ensureWorker() {
  if (worker) return worker;
  worker = spawnWorker();
  if (!worker) throw new Error("Could not start the AI worker");
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      if (activeProgress) activeProgress(data);
      return;
    }
    if (data.type === "debug") {
      (window.__img3dDebug = window.__img3dDebug || []).push(data);
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.type === "error") entry.reject(new Error(data.message));
    else entry.resolve(data);
  };
  worker.onerror = (event) => {
    const message = (event && event.message) || "The AI worker crashed";
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(new Error(message));
    }
    worker = null;
    loaded = false;
  };
  return worker;
}

/* src/volume.js is the single source of truth for the volume math, but a Worker can't fetch a
   sibling src/ file in the unsaved preview, so we read it here (the page can) and hand its text
   to the worker, which imports it from a blob URL. Fetched once. */
let volumeSrcPromise = null;
function volumeSource() {
  if (!volumeSrcPromise) {
    volumeSrcPromise = fetch(new URL("./volume.js", import.meta.url), { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error("volume.js " + r.status);
        return r.text();
      })
      .catch((e) => {
        volumeSrcPromise = null;
        throw e;
      });
  }
  return volumeSrcPromise;
}

async function send(message, transfer) {
  let volumeSourceText = null;
  try {
    volumeSourceText = await volumeSource();
  } catch {
    /* the worker will fall back to fetching ./volume.js itself (works once saved) */
  }
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ ...message, id, volumeSource: volumeSourceText }, transfer || []);
  });
}

function mapProgress(cb) {
  return (p) => {
    if (!cb) return;
    if (p.phase === "load") {
      const frac = p.total ? p.done / p.total : 0;
      const span = SPANS.load;
      const suffix = p.total ? ` · ${fmtBytes(p.done)} / ${fmtBytes(p.total)}` : "";
      cb(p.label + suffix, span[0] + frac * span[1]);
    } else {
      const span = SPANS[p.phase] || [0.4, 0.1];
      cb(p.label, span[0] + p.frac * span[1]);
    }
  };
}

export async function loadModels(onProgress, ep = "webgpu") {
  if (loaded) return;
  activeProgress = mapProgress(onProgress);
  try {
    await send({ type: "load", ep });
    loaded = true;
  } finally {
    activeProgress = null;
  }
}

export function modelsLoaded() {
  return loaded;
}

export function releaseModels() {
  if (worker) worker.terminate();
  worker = null;
  loaded = false;
  pending.clear();
}

/* ------------------------------------------------------------------ input prep */

/* Bounding box of the subject's alpha. A naive min/max over every non-zero alpha pixel is
   not robust: the alpha a text-to-image model (or an auto-matting pass) produces often has
   a faint halo above the subject and a few disconnected specks/streaks off to one side.
   Those drag the box far wider than the subject, so prepareInput frames a small, off-centre
   subject and TripoSR reconstructs a blob. Instead: threshold to a real foreground mask
   (drops the faint halo), take the 8-connected components, and union only the ones at least
   5% the size of the largest (drops isolated specks while keeping genuine multi-part or
   detached thin subjects). */
export function alphaBounds(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  const n = width * height;
  const FLOOR = 25;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] > FLOOR ? 1 : 0;

  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comps = [];
  for (let s = 0; s < n; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    let cnt = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    while (sp > 0) {
      const p = stack[--sp];
      cnt++;
      const x = p % width;
      const y = (p / width) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (!dx && !dy)) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
    }
    comps.push({ cnt, minX, minY, maxX, maxY });
  }
  if (!comps.length) return { x: 0, y: 0, width, height };
  comps.sort((a, b) => b.cnt - a.cnt);
  const keep = comps[0].cnt * 0.05;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (const c of comps) {
    if (c.cnt < keep) continue;
    if (c.minX < minX) minX = c.minX;
    if (c.minY < minY) minY = c.minY;
    if (c.maxX > maxX) maxX = c.maxX;
    if (c.maxY > maxY) maxY = c.maxY;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/* Render a (possibly out-of-bounds) source rectangle to destW x destH, halving the size
   in steps so the bilinear filter never has to skip texels — large downscales done in a
   single drawImage alias badly, and the foreground silhouette is what the network sees. */
function drawScaled(dest, source, sx, sy, sw, sh, destW, destH) {
  const cap = Math.max(destW, destH) * 4;
  let cw = Math.max(1, Math.min(Math.round(sw), cap));
  let ch = Math.max(1, Math.min(Math.round(sh), cap));
  let canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  let ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, cw, ch);
  while (cw > destW * 1.5 && ch > destH * 1.5) {
    const nw = Math.max(destW, Math.floor(cw / 2));
    const nh = Math.max(destH, Math.floor(ch / 2));
    const next = document.createElement("canvas");
    next.width = nw;
    next.height = nh;
    const nctx = next.getContext("2d");
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(canvas, 0, 0, cw, ch, 0, 0, nw, nh);
    canvas = next;
    cw = nw;
    ch = nh;
  }
  const dctx = dest.getContext("2d");
  dctx.clearRect(0, 0, destW, destH);
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(canvas, 0, 0, cw, ch, 0, 0, destW, destH);
}

/* TripoSR's own framing: cut the subject out, crop to its alpha bounds, pad to a square,
   then pad again so the subject covers `ratio` (85%) of the frame. */
export function prepareInput(source, ratio = FOREGROUND_RATIO) {
  const sctx = source.getContext("2d", { willReadFrequently: true });
  const bounds = alphaBounds(sctx, source.width, source.height);
  const side = Math.max(bounds.width, bounds.height) / ratio;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  drawScaled(canvas, source, cx - side / 2, cy - side / 2, side, side, INPUT_SIZE, INPUT_SIZE);
  return canvas;
}

function canvasToRgb(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  const rgb = new Float32Array(plane * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const a = data[i + 3] / 255;
    const inv = BACKGROUND_COLOR * (1 - a);
    rgb[j] = inv + (data[i] / 255) * a;
    rgb[plane + j] = inv + (data[i + 1] / 255) * a;
    rgb[2 * plane + j] = inv + (data[i + 2] / 255) * a;
  }
  return rgb;
}

/* ---------------------------------------------------------------------- public */

export async function reconstructFromCanvas(source, { onProgress, color = true, debug = false, ep = "webgpu", resolution, threshold, smooth, flip, multiView } = {}) {
  if (!img3dSupported()) throw new Error("This browser has no WebGPU, so the AI model can't run");
  const canvas = prepareInput(source);
  const rgb = canvasToRgb(canvas);
  activeProgress = mapProgress(onProgress);
  try {
    const result = await send({ type: "reconstruct", rgb, color, debug, ep, resolution, threshold, smooth, flip, multiView }, [rgb.buffer]);
    loaded = true;
    if (onProgress) onProgress("Framing the model (AI)", 1);
    return result;
  } finally {
    activeProgress = null;
  }
}

/* Run only the image encoder + triplane backbone and report tensor statistics — for
   diagnosing the export without paying for the full grid decode. */
export async function probeBackbone(source, { ep = "webgpu", onProgress, opts } = {}) {
  const canvas = prepareInput(source);
  const rgb = canvasToRgb(canvas);
  activeProgress = mapProgress(onProgress);
  try {
    const result = await send({ type: "probe", rgb, ep, opts }, [rgb.buffer]);
    loaded = true;
    return result.probe;
  } finally {
    activeProgress = null;
  }
}

/* Re-extract the surface at a different iso threshold / grid resolution without re-running
   the image encoder or the triplane backbone. */
export async function rebuildMesh({ threshold, resolution, smooth, color = true, onProgress, flip, debug } = {}) {
  activeProgress = mapProgress(onProgress);
  try {
    return await send({ type: "rebuild", threshold, resolution, smooth, color, flip, debug });
  } finally {
    activeProgress = null;
  }
}

export async function reconstructFromBlob(blob, opts) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return await reconstructFromCanvas(canvas, opts);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
