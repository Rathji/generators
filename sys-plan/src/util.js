export const uid = (p) => p + Math.floor(Math.random() * 1e9).toString(36) + Math.random().toString(36).slice(2, 6);

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);

export const debounce = (fn, ms) => {
  let t = null;
  const g = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  g.flush = () => { if (t) { clearTimeout(t); fn(); } };
  g.cancel = () => clearTimeout(t);
  return g;
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];
export const shuffle = (arr, rnd = Math.random) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export const fmtClock = (d) =>
  (d ? new Date(d) : new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function toast(msg, isErr) {
  const ctn = $("#toastCtn");
  if (!ctn) return;
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  ctn.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2300);
  setTimeout(() => el.remove(), 2700);
}
