// ChatNEX Deep Memory worker
// Runs a small local embedding model (MiniLM, ~25MB, quantized) entirely on-device.
// Rebuild recipe: this file IS the source; no build step. It imports transformers.js
// from a CDN at runtime. Recreate it as src/deepmemory-worker.js if it is ever lost.
// Protocol with the main thread (all messages carry an {id} echoed back):
//   client -> {type:"load", id}                     load the model (progress events in between)
//   worker -> {type:"progress", status, file, progress}   during load
//   worker -> {ok:true, id}                         load finished
//   client -> {type:"embed", id, texts:[string,...]}      embed one or more strings
//   worker -> {ok:true, id, result:[[num,...],...]}       one normalized vector per input
//   worker -> {ok:false, id, error:"..."}           any failure

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

const MODEL = "Xenova/all-MiniLM-L6-v2";

env.allowLocalModels = false;

let extractor = null;
let loadPromise = null;

function progressCb(p) {
  self.postMessage({
    type: "progress",
    status: p && p.status ? String(p.status) : "loading",
    file: (p && p.file) ? String(p.file) : "",
    progress: (p && typeof p.progress === "number") ? Math.round(p.progress * 100) : undefined
  });
}

function ensureModel() {
  if (extractor) return Promise.resolve(extractor);
  if (loadPromise) return loadPromise;
  loadPromise = pipeline("feature-extraction", MODEL, { progress_callback: progressCb })
    .then((p) => {
      extractor = p;
      return p;
    })
    .catch((err) => {
      loadPromise = null;
      throw err;
    });
  return loadPromise;
}

async function embedTexts(texts) {
  const fn = await ensureModel();
  const out = await fn(texts, { pooling: "mean", normalize: true });
  const dims = out && out.dims ? out.dims : [texts.length, 384];
  const data = out && out.data ? out.data : [];
  const batch = dims[0] || texts.length;
  const size = dims[1] || 384;
  const result = [];
  for (let i = 0; i < batch; i++) {
    const vec = [];
    const base = i * size;
    for (let j = 0; j < size; j++) {
      vec.push(data[base + j] || 0);
    }
    result.push(vec);
  }
  return result;
}

self.onmessage = async (ev) => {
  const d = ev.data || {};
  const { id, type } = d;
  const reply = (payload) => self.postMessage(Object.assign({ id }, payload));

  try {
    if (type === "load") {
      await ensureModel();
      reply({ ok: true });
      return;
    }
    if (type === "embed") {
      let texts = d.texts;
      if (!Array.isArray(texts)) texts = [texts];
      texts = texts.map((t) => String(t == null ? "" : t));
      const result = await embedTexts(texts);
      reply({ ok: true, result });
      return;
    }
    reply({ ok: false, error: "unknown message type: " + String(type) });
  } catch (err) {
    reply({ ok: false, error: String((err && err.message) || err || "worker error") });
  }
};
