/*
 * TripoSR — single image -> mesh reconstruction, fully client-side on WebGPU.
 *
 * Runs in a dedicated Web Worker so ONNX Runtime's WebGPU session creation (a heavy,
 * long, largely synchronous step on multi-hundred-MB graphs) can never block the page's
 * main thread. Weight downloads are persisted in the Cache Storage API so the ~840 MB of
 * weights are fetched only once per origin.
 *
 * Model: the triplane graph is https://huggingface.co/cgb/triposr-onnx-webgpu (an int8
 *        weight-only / block-32 ONNX export of VAST-AI-Research/TripoSR, verified against
 *        the PyTorch reference at cosine 0.9998 on the triplane) and the field decoder is
 *        that repo's own float32 NeRFMLP, so the two graphs are a matched pair.
 *
 * Maths ported from VAST-AI-Research/TripoSR:
 *   tsr/system.py + tsr/utils.py + tsr/models/{isosurface,network_utils,nerf_renderer}.py
 * Pipeline: RGBA composited over 0.5 grey, foreground normalised to 85% of a 512x512
 *   frame -> the triplane graph runs DINOv2 ViT-B/16 + the 16-layer Transformer1D + the
 *   TriplaneUpsampleNetwork (the ±mean/±std normalisation is baked into that graph, so it
 *   is fed raw [0,1] RGB) -> 3x40x64x64 feature planes -> NeRFMLP queried on a regular
 *   grid in [-0.87, 0.87]^3 -> exp density + colour -> marching tetrahedra at density iso
 *   25 -> per-vertex colour from a second decoder pass.
 *
 * The raw iso-surface carries a small low-frequency ripple (the density is read from
 * bilinearly sampled triplane features, and that interpolation shows up as faint ridges
 * on thin parts). A volume-preserving (Taubin) relaxation of the extracted mesh removes
 * it without eating the silhouette — see smoothMesh().
 */

/* 1.23.0 is required: 1.22.0's WebGPU GridSample kernel emits invalid WGSL for fp16
   inputs ("no matching overload for 'operator * (f32, f16)"), which silently produced a
   flat density field. */
import { InferenceSession, Tensor, env } from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/webgpu/+esm";

/* volume.js lives in src/ alongside this worker, but a Worker in the unsaved editor preview
   cannot fetch a sibling src/ file (the editor's service worker serves src/* only to the page,
   so the request 404s). The main thread therefore hands us volume.js's source text and we import
   it from a blob URL — one source of truth (src/volume.js) whether the generator is saved or not. */
let analyzeMesh = null;
let integrateDensityVolume = null;
let flipDensityX = null;
let fuseDensity = null;
let volumeReady = null;
function ensureVolume(source) {
  if (!volumeReady) {
    volumeReady = (async () => {
      let src = source;
      if (!src) src = await fetch("./volume.js").then((r) => r.text());
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      try {
        const m = await import(url);
        analyzeMesh = m.analyzeMesh;
        integrateDensityVolume = m.integrateDensityVolume;
        flipDensityX = m.flipDensityX;
        fuseDensity = m.fuseDensity;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
  }
  return volumeReady;
}

env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/";
env.wasm.numThreads = 1;

const MODEL_ROOT =
  "https://huggingface.co/cgb/triposr-onnx-webgpu/resolve/048725e957f485cc6bc082a9d6a239fcf7d8880a/";
const CACHE_NAME = "triposr-webgpu-cgb-v1";

/* The triplane graph consumes the image and returns the 3x40x64x64 feature planes. Its
   weights live in a sidecar (triplane_q8.onnx.data), passed to onnxruntime-web through the
   `externalData` session option. The decoder is the float32 NeRFMLP, which takes the 120
   features gathered by sampleFeatures() and bakes exp(density + bias) and sigmoid(colour). */
const ASSETS = {
  triplane: { path: "triplane_q8.onnx", bytes: 885712, name: "triplane model" },
  triplaneData: { path: "triplane_q8.onnx.data", bytes: 483785728, name: "triplane weights" },
  decoder: { path: "decoder.onnx", bytes: 173796, name: "field decoder" },
};

const LOAD_ORDER = ["triplane", "triplaneData", "decoder"];

const INPUT_SIZE = 512;
const TRIPLANE_PLANES = 3;
const TRIPLANE_CHANNELS = 40;
const TRIPLANE_GRID = 64;
const POINTS_RADIUS = 0.87;
const ISO_THRESHOLD = 25;
const DEFAULT_RESOLUTION = 192;
const DEFAULT_SMOOTH = 0.022;
const DECODE_BATCH = 16384;

function sessionOpts(ep, extra) {
  return {
    executionProviders: [ep === "wasm" ? "wasm" : "webgpu"],
    graphOptimizationLevel: "all",
    enableMemPattern: true,
    ...(extra || {}),
  };
}

/* Marching-tetrahedra triangle table, indexed by the 4-bit "inside" mask of a tet's four
   corners (edge order 01, 02, 03, 12, 13, 23). -1 terminates each triangle list. */
const TRIANGLE_TABLE = [
  [-1, -1, -1, -1, -1, -1], [1, 0, 2, -1, -1, -1], [4, 0, 3, -1, -1, -1], [1, 4, 2, 1, 3, 4],
  [3, 1, 5, -1, -1, -1], [2, 3, 0, 2, 5, 3], [1, 4, 0, 1, 5, 4], [4, 2, 5, -1, -1, -1],
  [4, 5, 2, -1, -1, -1], [4, 1, 0, 4, 5, 1], [3, 2, 0, 3, 5, 2], [1, 3, 5, -1, -1, -1],
  [4, 1, 2, 4, 3, 1], [3, 0, 4, -1, -1, -1], [2, 0, 1, -1, -1, -1], [-1, -1, -1, -1, -1, -1],
];

/* Kuhn decomposition of a cube into 6 tetrahedra that all share the 000-111 body diagonal.
   Every cube uses the same diagonal orientation, so the decomposition stays watertight.
   Corner order inside a cube: 0=(0,0,0) 1=(0,0,1) 2=(0,1,0) 3=(0,1,1)
                              4=(1,0,0) 5=(1,0,1) 6=(1,1,0) 7=(1,1,1) */
const CUBE_TETS = [
  [0, 4, 6, 7],
  [0, 4, 5, 7],
  [0, 2, 6, 7],
  [0, 2, 3, 7],
  [0, 1, 5, 7],
  [0, 1, 3, 7],
];

/* local corner pair of each of the six tet edges: 0:01 1:02 2:03 3:12 4:13 5:23 */
const EDGE_CORNERS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

let sessions = null;
let loadedEp = null;
let loadedKey = null;
let loadDone = 0;
let loadTotal = 0;
let lastLoadPost = 0;
let cached = null;

const send = (msg, transfer) => self.postMessage(msg, transfer || []);
const progress = (phase, label, frac, extra) => send({ type: "progress", phase, label, frac, ...(extra || {}) });

/* --------------------------------------------------------------------- tensor utils */

function f16ToF32(view) {
  const out = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) {
    const h = view[i];
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    if (e === 0) out[i] = s * m * 5.9604644775390625e-8;
    else if (e === 31) out[i] = m ? NaN : s * Infinity;
    else out[i] = s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}

function asF32(tensor) {
  if (!tensor) throw new Error("ONNX graph returned no tensor");
  const t = tensor.type || "float32";
  if (t === "float32") return tensor.data;
  if (t === "float16") return f16ToF32(tensor.data);
  throw new Error(`Unsupported ONNX output type ${t}`);
}

function stats(arr, cap = 400000) {
  const n = Math.min(arr.length, cap);
  let min = Infinity, max = -Infinity, sum = 0, sum2 = 0, nan = 0;
  let inf = 0, negInf = 0;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (Number.isNaN(v)) { nan++; continue; }
    if (v === Infinity) { inf++; continue; }
    if (v === -Infinity) { negInf++; continue; }
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sum2 += v * v;
  }
  const finite = Math.max(1, n - nan - inf - negInf);
  const mean = sum / finite;
  return {
    length: arr.length,
    min,
    max,
    mean,
    std: Math.sqrt(Math.max(0, sum2 / finite - mean * mean)),
    nan,
    inf,
    negInf,
  };
}

function pick(names, preferred, index) {
  for (const p of preferred) if (names.includes(p)) return p;
  return names[index];
}

function pickOutput(outputs, preferred, index = 0) {
  for (const p of preferred) if (outputs[p]) return outputs[p];
  const keys = Object.keys(outputs);
  if (!keys[index]) throw new Error("ONNX graph returned no output tensor");
  return outputs[keys[index]];
}

function declaredRank(session, name) {
  try {
    const dims = session.inputMetadata?.[name]?.dimensions;
    if (dims && dims.length) return dims.length;
  } catch {}
  return 0;
}

function rankUpdims(flat, rank) {
  if (rank <= 1) return flat;
  const out = flat.slice();
  while (out.length < rank) out.unshift(1);
  return out;
}

function tensorFor(session, name, data, dims, fallbackRank) {
  const rank = declaredRank(session, name) || fallbackRank;
  return new Tensor("float32", data, rankUpdims(dims, rank));
}

function metaDump(session) {
  const out = {};
  try {
    for (const n of session.inputNames) out[n] = session.inputMetadata?.[n]?.dimensions || null;
    for (const n of session.outputNames) out[n] = session.outputMetadata?.[n]?.dimensions || null;
  } catch {}
  return out;
}

/* ------------------------------------------------------------------- downloads */

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function fetchAsset(key, cache) {
  const asset = ASSETS[key];
  const url = asset.url || (asset.root || MODEL_ROOT) + asset.path;
  const report = () => {
    const now = performance.now();
    if (now - lastLoadPost > 120) {
      lastLoadPost = now;
      progress("load", `Loading AI model · ${asset.name}`, loadTotal ? loadDone / loadTotal : 0, { done: loadDone, total: loadTotal });
    }
  };

  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        loadDone += buf.byteLength;
        progress("load", `Loading AI model · ${asset.name} (cached)`, loadTotal ? loadDone / loadTotal : 0, { done: loadDone, total: loadTotal });
        return buf;
      }
    } catch {}
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the AI model (${res.status})`);
  const total = Number(res.headers.get("content-length")) || asset.bytes || 0;
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  const reader = res.body.getReader();
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, offset);
    offset += value.byteLength;
    loadDone += value.byteLength;
    report();
  }
  const out = offset === total ? buffer : bytes.subarray(0, offset).slice().buffer;
  if (cache) {
    try {
      await cache.put(url, new Response(out.slice(0)));
    } catch {}
  }
  return out;
}

/* --------------------------------------------------------------------- loading */

function planTotal() {
  loadTotal = LOAD_ORDER.reduce((n, k) => n + ASSETS[k].bytes, 0);
  loadDone = 0;
}

async function ensureLoaded(ep = "webgpu", opts = null) {
  const key = ep + (opts ? "|" + JSON.stringify(opts) : "");
  if (sessions && loadedKey === key) return;
  if (sessions) {
    for (const s of Object.values(sessions)) { try { await s.release?.(); } catch {} }
    sessions = null;
  }
  planTotal();
  const cache = await openCache();

  let buf = await fetchAsset("decoder", cache);
  const decoder = await InferenceSession.create(buf, sessionOpts(ep, opts));
  buf = null;

  const triplaneBuf = await fetchAsset("triplane", cache);
  const dataBuf = await fetchAsset("triplaneData", cache);
  const triplane = await InferenceSession.create(triplaneBuf, {
    ...sessionOpts(ep, opts),
    externalData: [{ path: "triplane_q8.onnx.data", data: new Uint8Array(dataBuf) }],
  });

  sessions = { triplane, decoder };
  loadedEp = ep;
  loadedKey = key;
  send({
    type: "debug",
    tag: "ready",
    ep,
    triplane: metaDump(triplane),
    decoder: metaDump(decoder),
  });
}

/* ------------------------------------------------------------------- inference */

/* Horizontally mirror the planar [3, H, W] RGB the network consumes (row-major, three
   channel planes). Used by the multi-view volume pass: the mirrored image reconstructs a
   mirror image of the object, which flipDensityX() then folds back into canonical space
   before the two density fields are averaged. */
function flipRgbX(rgb, size = INPUT_SIZE) {
  const out = new Float32Array(rgb.length);
  const plane = size * size;
  for (let c = 0; c < 3; c++) {
    const base = c * plane;
    for (let y = 0; y < size; y++) {
      const row = base + y * size;
      for (let x = 0; x < size; x++) out[row + x] = rgb[row + (size - 1 - x)];
    }
  }
  return out;
}

async function encodeScene(rgb) {
  progress("encode", "Reading the image (AI)", 0);
  progress("shape", "Reconstructing 3D shape (AI)", 0);
  const name = pick(sessions.triplane.inputNames, ["image"], 0);
  const out = await sessions.triplane.run({
    [name]: tensorFor(sessions.triplane, name, rgb, [1, 3, INPUT_SIZE, INPUT_SIZE], 4),
  });
  const sceneCodes = pickOutput(out, ["triplane", "scene_codes"]);
  progress("shape", "Reconstructing 3D shape (AI)", 1);
  return { sceneCodes, tokens: { dims: sceneCodes.dims, stats: stats(asF32(sceneCodes)) } };
}

function triplaneOf(sceneCodes) {
  const dims = sceneCodes.dims || [];
  const data = asF32(sceneCodes);
  let planes = TRIPLANE_PLANES, channels = TRIPLANE_CHANNELS, grid = TRIPLANE_GRID;
  if (dims.length === 5) { planes = dims[1]; channels = dims[2]; grid = dims[3]; }
  else if (dims.length === 4) { planes = dims[0]; channels = dims[1]; grid = dims[2]; }
  return { data, planes, channels, grid };
}

const TRIPLANE_FEATURES = 120;

/* grid_sample, done by hand: each point (in [-0.87, 0.87]) is mapped to [-1, 1], turned
   into a pixel coordinate with align_corners=false, and bilinearly sampled from the three
   planes with zero padding outside the grid. The (x,y), (x,z) and (y,z) results are
   concatenated in that order to form the 120 features the NeRFMLP consumes. Sampling in
   the caller keeps GridSample (patchy on the WebGPU EP) out of the graphs entirely. */
function sampleFeatures(plane, pts, count) {
  const { data, channels, grid } = plane;
  const stack = 3;
  const feats = new Float32Array(count * channels * stack);
  const half = grid / 2;
  const scale = 1 / POINTS_RADIUS;
  const stride = grid * grid;
  for (let n = 0; n < count; n++) {
    const px = pts[n * 3] * scale, py = pts[n * 3 + 1] * scale, pz = pts[n * 3 + 2] * scale;
    const u = [(px + 1) * half - 0.5, (px + 1) * half - 0.5, (py + 1) * half - 0.5];
    const v = [(py + 1) * half - 0.5, (pz + 1) * half - 0.5, (pz + 1) * half - 0.5];
    for (let p = 0; p < stack; p++) {
      const ix = Math.floor(u[p]), iy = Math.floor(v[p]);
      const fx = u[p] - ix, fy = v[p] - iy;
      const xA = ix >= 0 && ix < grid, xB = ix >= -1 && ix < grid - 1;
      const yA = iy >= 0 && iy < grid, yB = iy >= -1 && iy < grid - 1;
      const w00 = xA && yA ? (1 - fx) * (1 - fy) : 0;
      const w10 = xB && yA ? fx * (1 - fy) : 0;
      const w01 = xA && yB ? (1 - fx) * fy : 0;
      const w11 = xB && yB ? fx * fy : 0;
      const i00 = iy * grid + ix, i10 = i00 + 1, i01 = i00 + grid, i11 = i01 + 1;
      const outBase = (n * stack + p) * channels;
      const planeBase = p * channels * stride;
      for (let c = 0; c < channels; c++) {
        const cb = planeBase + c * stride;
        let val = 0;
        if (w00) val += data[cb + i00] * w00;
        if (w10) val += data[cb + i10] * w10;
        if (w01) val += data[cb + i01] * w01;
        if (w11) val += data[cb + i11] * w11;
        feats[outBase + c] = val;
      }
    }
  }
  return feats;
}

async function runDecoder(plane, values, dims, outName) {
  const count = dims[0];
  const feats = sampleFeatures(plane, values, count);
  const name = pick(sessions.decoder.inputNames, ["features"], 0);
  const out = await sessions.decoder.run({
    [name]: tensorFor(sessions.decoder, name, feats, [count, TRIPLANE_FEATURES], 2),
  });
  return asF32(pickOutput(out, [outName]));
}

/* The decoder gathers column pairs [0,1],[0,2],[1,2] (axis=1) to form the three triplane
   planes (xy, xz, yz), so `points` is laid out [N, 3] with x, y, z in columns 0, 1, 2. */
async function decodeDensity(plane, resolution, onProgress) {
  const R = resolution;
  const N = R * R * R;
  const density = new Float32Array(N);
  const buf = new Float32Array(DECODE_BATCH * 3);
  const inv = 1 / (R - 1);
  let lastPost = 0;
  for (let start = 0; start < N; start += DECODE_BATCH) {
    const count = Math.min(DECODE_BATCH, N - start);
    for (let t = 0; t < count; t++) {
      const n = start + t;
      const k = n % R;
      const j = ((n / R) | 0) % R;
      const i = (n / (R * R)) | 0;
      buf[t * 3] = POINTS_RADIUS * (2 * i * inv - 1);
      buf[t * 3 + 1] = POINTS_RADIUS * (2 * j * inv - 1);
      buf[t * 3 + 2] = POINTS_RADIUS * (2 * k * inv - 1);
    }
    if (count < DECODE_BATCH) {
      buf.fill(0, count * 3, DECODE_BATCH * 3);
    }
    const d = await runDecoder(plane, buf, [DECODE_BATCH, 3], "density");
    density.set(d.subarray(0, count), start);
    const now = performance.now();
    if (now - lastPost > 120 || start + count >= N) {
      lastPost = now;
      onProgress((start + count) / N);
    }
  }
  return density;
}

async function decodeColor(plane, positions, onProgress) {
  const total = positions.length / 3;
  const out = new Float32Array(total * 3);
  const buf = new Float32Array(DECODE_BATCH * 3);
  let lastPost = 0;
  for (let start = 0; start < total; start += DECODE_BATCH) {
    const count = Math.min(DECODE_BATCH, total - start);
    for (let t = 0; t < count; t++) {
      const p = (start + t) * 3;
      buf[t * 3] = positions[p];
      buf[t * 3 + 1] = positions[p + 1];
      buf[t * 3 + 2] = positions[p + 2];
    }
    if (count < DECODE_BATCH) {
      buf.fill(0, count * 3, DECODE_BATCH * 3);
    }
    const c = await runDecoder(plane, buf, [DECODE_BATCH, 3], "color");
    out.set(c.subarray(0, count * 3), start * 3);
    const now = performance.now();
    if (now - lastPost > 150 || start + count >= total) {
      lastPost = now;
      onProgress((start + count) / total);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- mesh extraction */

function buildMesh(density, resolution, threshold) {
  const R = resolution;
  const N = R * R * R;
  const r2 = R * R;
  const inside = new Uint8Array(N);
  let insideCount = 0;
  for (let i = 0; i < N; i++) if (density[i] > threshold) { inside[i] = 1; insideCount++; }
  if (!insideCount) throw new Error("The AI found no surface — try an image with one clear, centred subject");

  const positions = [];
  const faces = [];
  const edgeMap = new Map();
  const inv = 1 / (R - 1);

  const coord = (index, axis) => {
    const k = index % R;
    const j = ((index / R) | 0) % R;
    const i = (index / r2) | 0;
    const v = axis === 0 ? i : axis === 1 ? j : k;
    return POINTS_RADIUS * (2 * v * inv - 1);
  };

  const edgeVertex = (a, b) => {
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    const key = low * N + high;
    const existing = edgeMap.get(key);
    if (existing !== undefined) return existing;
    const s0 = density[a] - threshold;
    const s1 = density[b] - threshold;
    const denom = s0 - s1 || 1e-9;
    let t = s0 / denom;
    if (!(t >= 0)) t = 0;
    else if (t > 1) t = 1;
    const index = positions.length / 3;
    positions.push(
      coord(a, 0) + (coord(b, 0) - coord(a, 0)) * t,
      coord(a, 1) + (coord(b, 1) - coord(a, 1)) * t,
      coord(a, 2) + (coord(b, 2) - coord(a, 2)) * t
    );
    edgeMap.set(key, index);
    return index;
  };

  const corners = new Int32Array(8);
  const slot = new Int32Array(6);
  const limit = R - 1;
  for (let i = 0; i < limit; i++) {
    for (let j = 0; j < limit; j++) {
      for (let k = 0; k < limit; k++) {
        const a = i * r2 + j * R + k;
        corners[0] = a;
        corners[1] = a + 1;
        corners[2] = a + R;
        corners[3] = a + R + 1;
        corners[4] = a + r2;
        corners[5] = a + r2 + 1;
        corners[6] = a + r2 + R;
        corners[7] = a + r2 + R + 1;
        for (let t = 0; t < 6; t++) {
          const tet = CUBE_TETS[t];
          const c0 = corners[tet[0]];
          const c1 = corners[tet[1]];
          const c2 = corners[tet[2]];
          const c3 = corners[tet[3]];
          const mask = inside[c0] | (inside[c1] << 1) | (inside[c2] << 2) | (inside[c3] << 3);
          if (mask === 0 || mask === 15) continue;
          const table = TRIANGLE_TABLE[mask];

          /* Constant density gradient within the tet. "Inside" is high density, so an
             outward normal must oppose the gradient; orient every triangle by that rule so
             the winding is consistent no matter how the table/tet corners are handed. */
          const p0x = coord(c0, 0), p0y = coord(c0, 1), p0z = coord(c0, 2);
          const e1x = coord(c1, 0) - p0x, e1y = coord(c1, 1) - p0y, e1z = coord(c1, 2) - p0z;
          const e2x = coord(c2, 0) - p0x, e2y = coord(c2, 1) - p0y, e2z = coord(c2, 2) - p0z;
          const e3x = coord(c3, 0) - p0x, e3y = coord(c3, 1) - p0y, e3z = coord(c3, 2) - p0z;
          const d1 = density[c1] - density[c0];
          const d2 = density[c2] - density[c0];
          const d3 = density[c3] - density[c0];
          const c23x = e2y * e3z - e2z * e3y, c23y = e2z * e3x - e2x * e3z, c23z = e2x * e3y - e2y * e3x;
          const c31x = e3y * e1z - e3z * e1y, c31y = e3z * e1x - e3x * e1z, c31z = e3x * e1y - e3y * e1x;
          const c12x = e1y * e2z - e1z * e2y, c12y = e1z * e2x - e1x * e2z, c12z = e1x * e2y - e1y * e2x;
          const det = e1x * c23x + e1y * c23y + e1z * c23z;
          const invDet = det ? 1 / det : 0;
          const gx = (c23x * d1 + c31x * d2 + c12x * d3) * invDet;
          const gy = (c23y * d1 + c31y * d2 + c12y * d3) * invDet;
          const gz = (c23z * d1 + c31z * d2 + c12z * d3) * invDet;

          slot[0] = -1; slot[1] = -1; slot[2] = -1; slot[3] = -1; slot[4] = -1; slot[5] = -1;
          for (let e = 0; e < 6 && table[e] !== -1; e++) {
            const s = table[e];
            if (slot[s] < 0) {
              const ec = EDGE_CORNERS[s];
              slot[s] = edgeVertex(corners[tet[ec[0]]], corners[tet[ec[1]]]);
            }
          }
          for (let e = 0; e < 6 && table[e] !== -1; e += 3) {
            let i0 = slot[table[e]], i1 = slot[table[e + 1]], i2 = slot[table[e + 2]];
            const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
            const ux = positions[i1 * 3] - ax, uy = positions[i1 * 3 + 1] - ay, uz = positions[i1 * 3 + 2] - az;
            const vx = positions[i2 * 3] - ax, vy = positions[i2 * 3 + 1] - ay, vz = positions[i2 * 3 + 2] - az;
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            if (nx * gx + ny * gy + nz * gz > 0) { const tmp = i1; i1 = i2; i2 = tmp; }
            faces.push(i0, i1, i2);
          }
        }
      }
    }
  }
  if (!faces.length) throw new Error("The AI found no surface — try an image with one clear, centred subject");
  return { positions: new Float32Array(positions), faces: new Uint32Array(faces) };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function oriented(mesh, flip) {
  if (flip) {
    const f = mesh.faces;
    for (let i = 0; i < f.length; i += 3) { const t = f[i + 1]; f[i + 1] = f[i + 2]; f[i + 2] = t; }
  }
  return mesh;
}

function emit(id, mesh, colors, flip, metrics) {
  oriented(mesh, flip);
  progress("done", "Framing the model (AI)", 1);
  const transfer = [mesh.positions.buffer, mesh.faces.buffer];
  if (colors) transfer.push(colors.buffer);
  send(
    { type: "result", id, positions: mesh.positions, faces: mesh.faces, colors, vertices: mesh.positions.length / 3, triangles: mesh.faces.length / 3, metrics: metrics || null },
    transfer
  );
}

/* Measure the reconstructed volume two independent ways — by summing the occupancy of the
   density field the network decoded (before any surface exists), and from the extracted,
   smoothed mesh — so the panel can show that the two agree. Must run BEFORE emit(), which
   transfers (detaches) the mesh buffers. */
function measureAi(mesh, density, resolution, threshold) {
  const spacing = (2 * POINTS_RADIUS) / Math.max(1, resolution - 1);
  const densityVolume = integrateDensityVolume(density, resolution, threshold, spacing);
  let meshReport = null;
  try {
    meshReport = analyzeMesh({ positions: mesh.positions, indices: mesh.faces });
  } catch (e) {
    console.warn("AI mesh measure failed", e);
  }
  return { density: densityVolume, mesh: meshReport };
}

function meanEdgeLength(mesh) {
  const { positions, faces } = mesh;
  const V = positions.length / 3;
  const seen = new Set();
  let total = 0, count = 0;
  for (let i = 0; i < faces.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = faces[i + e];
      const b = faces[i + ((e + 1) % 3)];
      const low = a < b ? a : b;
      const high = a < b ? b : a;
      const key = low * V + high;
      if (seen.has(key)) continue;
      seen.add(key);
      const dx = positions[a * 3] - positions[b * 3];
      const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
      const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
      count++;
    }
  }
  return count ? total / count : 0;
}

/* Volume-preserving (Taubin) relaxation of the extracted mesh. Marching tetrahedra over a
   bilinearly-interpolated triplane field leaves a low-frequency ripple on thin surfaces
   (the "washboard" ridges) that is inherent to the field, not to the extractor. A plain
   Laplacian smoothing shrinks the model; alternating a positive (λ=0.5) and a slightly
   larger negative (μ=−0.53) pass is a low-pass filter with passband gain ≈ 1, so the
   ripple is removed while the silhouette and blade edges stay put. `target` is the
   desired world-space smoothing radius (never a pass count), so the amount of smoothing
   is resolution-independent: doubling the grid resolution doubles the pass count. */
function smoothMesh(mesh, target) {
  const { positions, faces } = mesh;
  const V = positions.length / 3;
  if (!(target > 0) || V === 0 || faces.length === 0) return mesh;
  const avgEdge = meanEdgeLength(mesh);
  if (!(avgEdge > 0)) return mesh;
  let passes = Math.round((target / avgEdge) ** 2);
  if (passes < 1) return mesh;
  if (passes > 80) passes = 80;

  const counts = new Uint32Array(V);
  for (let i = 0; i < faces.length; i++) counts[faces[i]] += 2;
  const offsets = new Uint32Array(V + 1);
  for (let v = 0; v < V; v++) offsets[v + 1] = offsets[v] + counts[v];
  const cursor = offsets.slice(0, V);
  const adj = new Uint32Array(offsets[V]);
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i], b = faces[i + 1], c = faces[i + 2];
    adj[cursor[a]++] = b; adj[cursor[a]++] = c;
    adj[cursor[b]++] = c; adj[cursor[b]++] = a;
    adj[cursor[c]++] = a; adj[cursor[c]++] = b;
  }

  const next = new Float32Array(positions.length);
  const lambda = 0.5, mu = -0.53;
  const step = (src, dst, factor) => {
    for (let v = 0; v < V; v++) {
      const s = offsets[v], e = offsets[v + 1];
      const o = v * 3;
      if (s === e) {
        dst[o] = src[o]; dst[o + 1] = src[o + 1]; dst[o + 2] = src[o + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (let k = s; k < e; k++) {
        const w = adj[k] * 3;
        sx += src[w]; sy += src[w + 1]; sz += src[w + 2];
      }
      const inv = 1 / (e - s);
      dst[o] = src[o] + factor * (sx * inv - src[o]);
      dst[o + 1] = src[o + 1] + factor * (sy * inv - src[o + 1]);
      dst[o + 2] = src[o + 2] + factor * (sz * inv - src[o + 2]);
    }
  };
  for (let p = 0; p < passes; p++) {
    step(positions, next, lambda);
    step(next, positions, mu);
  }
  return mesh;
}

async function makeMesh(plane, density, resolution, threshold, color, smooth) {
  progress("mesh", "Extracting surface (AI)", 0);
  const mesh = smoothMesh(buildMesh(density, resolution, threshold), smooth);
  let colors = null;
  if (color) {
    const raw = await decodeColor(plane, mesh.positions, (f) => progress("color", "Colouring the model (AI)", f));
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      raw[i] = srgbToLinear(v < 0 ? 0 : v > 1 ? 1 : v);
    }
    colors = raw;
  }
  return { mesh, colors };
}

/* ------------------------------------------------------------------- messages */

async function onLoad(id, msg) {
  progress("load", "Loading AI model", 0, { done: 0, total: 1 });
  await ensureLoaded(msg.ep, msg.opts);
  send({ type: "loaded", id });
}

async function onProbe(id, msg) {
  await ensureLoaded(msg.ep, msg.opts);
  const { sceneCodes, tokens } = await encodeScene(msg.rgb);
  const plane = triplaneOf(sceneCodes);
  send({
    type: "result",
    id,
    probe: {
      ep: loadedEp,
      tokens,
      sceneCodes: {
        dims: sceneCodes.dims,
        type: sceneCodes.type,
        planes: plane.planes,
        channels: plane.channels,
        grid: plane.grid,
        stats: stats(plane.data, plane.data.length),
      },
      meta: { triplane: metaDump(sessions.triplane), decoder: metaDump(sessions.decoder) },
    },
  });
}

async function onReconstruct(id, msg) {
  await ensureLoaded(msg.ep, msg.opts);
  const { sceneCodes } = await encodeScene(msg.rgb);
  const plane = triplaneOf(sceneCodes);
  const resolution = Math.max(32, Math.min(320, msg.resolution || DEFAULT_RESOLUTION));
  const threshold = msg.threshold == null ? ISO_THRESHOLD : msg.threshold;
  const smooth = msg.smooth == null ? DEFAULT_SMOOTH : Math.max(0, msg.smooth);
  let density;
  if (msg.multiView) {
    /* Multi-view volume: reconstruct the mirror view too and average its density (folded
       back into canonical space) with the front view's. A single view can only infer the
       visible half, so the fused field/volume is fuller and more symmetric. */
    progress("shape", "Reconstructing 3D shape (AI) · mirror view", 0.5);
    const alt = await encodeScene(flipRgbX(msg.rgb));
    const plane2 = triplaneOf(alt.sceneCodes);
    const d2 = await decodeDensity(plane2, resolution, (f) => progress("decode", "Decoding the surface (AI) · mirror view", f));
    const d1 = await decodeDensity(plane, resolution, (f) => progress("decode", "Decoding the surface (AI)", f));
    density = fuseDensity([d1, flipDensityX(d2, resolution)]);
  } else {
    density = await decodeDensity(plane, resolution, (f) => progress("decode", "Decoding the surface (AI)", f));
  }
  cached = { density, resolution, plane, threshold, smooth };
  const { mesh, colors } = await makeMesh(plane, density, resolution, threshold, msg.color, smooth);
  emit(id, mesh, colors, msg.flip, measureAi(mesh, density, resolution, threshold));
}

async function onRebuild(id, msg) {
  if (!cached) throw new Error("Nothing to rebuild yet — generate a model first");
  const resolution = Math.max(32, Math.min(320, msg.resolution || cached.resolution));
  const threshold = msg.threshold == null ? cached.threshold : msg.threshold;
  const smooth = msg.smooth == null ? cached.smooth : Math.max(0, msg.smooth);
  let density = cached.density;
  const plane = cached.plane;
  if (resolution !== cached.resolution) {
    density = await decodeDensity(plane, resolution, (f) => progress("decode", "Decoding the surface (AI)", f));
  }
  cached = { density, resolution, plane, threshold, smooth };
  const { mesh, colors } = await makeMesh(plane, density, resolution, threshold, msg.color !== false, smooth);
  emit(id, mesh, colors, msg.flip, measureAi(mesh, density, resolution, threshold));
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === "load" || msg.type === "reconstruct" || msg.type === "rebuild") {
      await ensureVolume(msg.volumeSource);
    }
    if (msg.type === "load") await onLoad(msg.id, msg);
    else if (msg.type === "reconstruct") await onReconstruct(msg.id, msg);
    else if (msg.type === "probe") await onProbe(msg.id, msg);
    else if (msg.type === "rebuild") await onRebuild(msg.id, msg);
    else throw new Error(`Unknown request: ${msg.type}`);
  } catch (error) {
    send({ type: "error", id: msg.id, message: String((error && error.message) || error) });
  }
};
