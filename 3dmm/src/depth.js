const TF_URL = "https://esm.sh/@huggingface/transformers@3.5.1";
const MODEL = "onnx-community/depth-anything-v2-small";

let tfPromise = null;
let pipePromise = null;

function loadTF() {
  if (!tfPromise) tfPromise = import(TF_URL);
  return tfPromise;
}

export async function getDepthPipeline(onStatus) {
  if (!pipePromise) {
    pipePromise = (async () => {
      const tf = await loadTF();
      onStatus && onStatus("Loading depth model\u2026");
      return tf.pipeline("depth-estimation", MODEL, {
        device: "wasm",
        dtype: "q8",
        progress_callback: (p) => {
          if (!p || p.status !== "progress" || typeof p.progress !== "number") return;
          onStatus && onStatus(`Downloading depth model \u2026 ${Math.round(p.progress)}%`);
        },
      });
    })().catch((e) => {
      pipePromise = null;
      throw e;
    });
  }
  return pipePromise;
}

export async function warmUpDepth(onStatus) {
  await getDepthPipeline(onStatus);
}

export async function estimateDepth(source, onStatus) {
  const pipe = await getDepthPipeline(onStatus);
  onStatus && onStatus("Estimating depth\u2026");
  const res = await pipe(source);
  const pd = res.predicted_depth;
  return { data: pd.data, width: pd.dims[1], height: pd.dims[0] };
}

export function normalizeDepth(data, width, height, invert) {
  const n = width * height;
  const sorted = Float32Array.from(data).sort();
  let lo = sorted[Math.floor(n * 0.02)];
  let hi = sorted[Math.floor(n * 0.98)];
  if (!(hi > lo)) { lo = sorted[0]; hi = sorted[n - 1]; }
  const span = (hi - lo) || 1;
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    let t = (data[i] - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (invert) t = 1 - t;
    out[i] = Math.round(t * 255);
  }
  return out;
}
