import { store } from "./store.js";

export const AI_PROVIDERS = [
  { id: "perchance", label: "Perchance (free)" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "foundry", label: "Microsoft Foundry" },
  { id: "hf", label: "Hugging Face" },
  { id: "custom", label: "Custom (OpenAI-compatible)" },
];

const PROVIDER_URLS = {
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  hf: "https://router.huggingface.co/v1/chat/completions",
};

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
  hf: "meta-llama/Llama-3.3-70B-Instruct",
};

const MODEL_CHOICES = {
  openai: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4o", "o4-mini"],
  openrouter: [
    "openai/gpt-4o-mini",
    "openai/gpt-4.1-mini",
    "anthropic/claude-sonnet-4",
    "anthropic/claude-3.5-sonnet",
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.3-70b-instruct",
    "qwen/qwen-2.5-72b-instruct",
  ],
  hf: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-R1"],
};

export function providerInfo(id) {
  return AI_PROVIDERS.find((p) => p.id === id) || AI_PROVIDERS[0];
}

export function aiConfig() {
  if (!store.settings.ai) store.settings.ai = { provider: "perchance", model: "", key: "", baseUrl: "" };
  return store.settings.ai;
}

export function providerNeedsUrl(id) {
  return id === "foundry" || id === "custom";
}

export function usesPerchance() {
  const c = aiConfig();
  return c.provider === "perchance" || !c.key;
}

export function currentModel() {
  const c = aiConfig();
  if (usesPerchance()) return "Perchance AI";
  return c.model.trim() || DEFAULT_MODELS[c.provider] || "model";
}

export function modelChoices() {
  const c = aiConfig();
  const list = (MODEL_CHOICES[c.provider] || []).slice();
  const cur = c.model.trim();
  if (cur && !list.includes(cur)) list.unshift(cur);
  return list;
}

function rootApi() {
  return globalThis.root || null;
}

export function aiAvailable() {
  const r = rootApi();
  if (!r) return false;
  return usesPerchance() ? typeof r.generateText === "function" : typeof r.superFetch === "function";
}

function countApprox(t) {
  return Math.ceil(String(t).length / 4);
}

export function aiMeta() {
  if (usesPerchance()) {
    const r = rootApi();
    if (r && typeof r.generateText === "function") {
      try {
        const m = r.generateText({ getMetaObject: true });
        if (m && typeof m.countTokens === "function") return m;
      } catch (e) {}
    }
  }
  return { countTokens: countApprox, idealMaxContextTokens: 8000 };
}

let currentAbort = null;

export function cancelCurrent() {
  if (currentAbort) {
    try {
      currentAbort.abort();
    } catch (e) {}
    currentAbort = null;
  }
}

export function aiComplete(opts) {
  return usesPerchance() ? perchanceComplete(opts) : remoteComplete(opts);
}

async function perchanceComplete(opts) {
  const r = rootApi();
  if (!r || typeof r.generateText !== "function") throw new Error("Perchance AI is unavailable here");
  const call = { instruction: opts.instruction };
  if (opts.startWith) call.startWith = opts.startWith;
  if (opts.stopSequences) call.stopSequences = opts.stopSequences;
  if (opts.onChunk) call.onChunk = opts.onChunk;
  if (opts.onStart) call.onStart = opts.onStart;
  return r.generateText(call);
}

async function remoteComplete(opts) {
  const r = rootApi();
  if (!r || typeof r.superFetch !== "function") {
    throw new Error("This provider needs the network proxy, which is unavailable here");
  }
  const c = aiConfig();
  const url = (c.baseUrl && c.baseUrl.trim()) || PROVIDER_URLS[c.provider];
  if (!url) throw new Error("Set a base URL for this provider in Settings");
  const model = c.model.trim() || DEFAULT_MODELS[c.provider];
  if (!model) throw new Error("Set a model for this provider in Settings");

  const messages = [{ role: "user", content: opts.instruction }];
  if (opts.startWith) messages.push({ role: "assistant", content: opts.startWith });

  const body = { model, messages, stream: true };
  if (opts.stopSequences && opts.stopSequences.length) body.stop = opts.stopSequences.slice(0, 4);

  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + c.key };
  if (c.provider === "openrouter") {
    headers["HTTP-Referer"] = location.href;
    headers["X-Title"] = "PerchEdit";
  }

  const abort = new AbortController();
  currentAbort = abort;
  let resp;
  try {
    resp = await r.superFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: abort.signal });
  } finally {
    currentAbort = null;
  }

  if (!resp.ok) {
    let msg = "HTTP " + resp.status;
    try {
      const t = await resp.text();
      if (t) {
        const j = JSON.parse(t);
        if (j && j.error) msg = typeof j.error === "string" ? j.error : j.error.message || msg;
      }
    } catch (e) {}
    throw new Error(msg);
  }

  let full = "";
  const handleData = (data) => {
    if (data === "[DONE]") return;
    let j;
    try {
      j = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (j.error) throw new Error(typeof j.error === "string" ? j.error : j.error.message || "Provider error");
    const ch = j.choices && j.choices[0];
    const delta = ch && (ch.delta ? ch.delta.content : ch.message && ch.message.content);
    if (delta) {
      full += delta;
      if (opts.onChunk) opts.onChunk({ textChunk: delta, fullTextSoFar: full });
    }
  };

  const consume = (buf) => {
    let i = buf.indexOf("\n\n");
    while (i !== -1) {
      const ev = buf.slice(0, i);
      const dataLine = ev
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (dataLine) handleData(dataLine);
      buf = buf.slice(i + 2);
      i = buf.indexOf("\n\n");
    }
    return buf;
  };

  if (resp.body && typeof resp.body.getReader === "function") {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        buf = consume(buf);
      }
      if (buf.trim()) consume(buf + "\n\n");
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw e;
    }
  } else {
    consume((await resp.text()) + "\n\n");
  }

  return full;
}
