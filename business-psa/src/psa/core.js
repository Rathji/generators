export const MODULES = [];
export const MODULES_BY_ID = {};

export function registerModule(mod) {
  if (MODULES_BY_ID[mod.id]) throw new Error("Duplicate module id: " + mod.id);
  MODULES.push(mod);
  MODULES_BY_ID[mod.id] = mod;
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  clients: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  projects: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  resources: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  timesheets: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  expenses: '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  billing: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  reports: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v13h16V8"/><path d="M10 12h4"/>',
  menu: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/>'
};

export function icon(name, size = 18) {
  const p = ICONS[name] || ICONS.box;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
}

export function h(text) {
  const d = document.createElement("div");
  d.textContent = String(text == null ? "" : text);
  return d.innerHTML;
}

export function el(tag, className, inner) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (inner != null) node.innerHTML = inner;
  return node;
}

export function moduleShell(id) {
  const sec = el("section", "psa-module");
  sec.dataset.module = id;
  return sec;
}

export function pageHeader(title, subtitle, actions = []) {
  const wrap = el("div", "psa-page-head");
  const left = el("div", "psa-page-head-text");
  left.appendChild(el("h1", "psa-page-title", h(title)));
  if (subtitle) left.appendChild(el("p", "psa-page-sub", h(subtitle)));
  wrap.appendChild(left);
  if (actions.length) {
    const row = el("div", "psa-page-actions");
    for (const a of actions) {
      const b = el("button", "btn " + (a.kind || "btn-ghost"), h(a.label));
      if (a.icon) b.prepend(el("span", "", icon(a.icon, 16)));
      if (a.onClick) b.addEventListener("click", a.onClick);
      row.appendChild(b);
    }
    wrap.appendChild(row);
  }
  return wrap;
}

export function stateCard(opts = {}) {
  const kind = opts.kind || "empty";
  const card = el("div", "state-card state-" + kind);
  const inner = el("div", "state-card-inner");
  const iconWrap = el("div", "state-icon");
  if (kind === "loading") iconWrap.appendChild(el("span", "spinner"));
  else iconWrap.innerHTML = icon(kind === "error" ? "alert" : "box");
  inner.appendChild(iconWrap);
  inner.appendChild(el("h3", "state-title", h(opts.title || "Nothing here")));
  if (opts.message) inner.appendChild(el("p", "state-msg", h(opts.message)));
  if (opts.action) {
    const btn = el("button", "btn btn-primary", h(opts.action.label));
    btn.addEventListener("click", opts.action.onClick);
    inner.appendChild(btn);
  }
  if (opts.hint) inner.appendChild(el("p", "state-hint", h(opts.hint)));
  card.appendChild(inner);
  return card;
}

export function emptyState(opts) {
  return stateCard(Object.assign({ kind: "empty" }, opts));
}

export function loadingState(message) {
  return stateCard({ kind: "loading", title: message || "Loading…", message: "Just a moment." });
}

export function errorState(opts) {
  return stateCard(Object.assign({ kind: "error", title: "Something went wrong" }, opts));
}

export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  return { moduleId: parts[0] || "dashboard", parts: parts.slice(1), raw };
}

export function startRouter({ view, onNavigate, frameDelay = 90 }) {
  function dispatch(routeOverride) {
    const route = routeOverride || parseRoute();
    const mod = MODULES_BY_ID[route.moduleId] || MODULES_BY_ID.dashboard;
    if (onNavigate) onNavigate(mod, route);
    const token = {};
    view.__psaToken = token;
    view.innerHTML = "";
    view.appendChild(loadingState("Loading " + mod.label + "…"));
    return new Promise((resolve) => {
      setTimeout(async () => {
        if (view.__psaToken !== token) return resolve(false);
        try {
          await mod.render({ view, route, module: mod });
        } catch (err) {
          console.error("[psa] module render failed:", err);
          if (view.__psaToken !== token) return resolve(false);
          view.innerHTML = "";
          view.appendChild(errorState({
            title: "Couldn't load " + mod.label,
            message: "This module hit an unexpected problem while rendering. Your data is safe — this is a display error, not a data error.",
            action: { label: "Try again", onClick: () => dispatch(routeOverride) }
          }));
          return resolve(false);
        }
        if (view.__psaToken !== token) return resolve(false);
        const load = view.querySelector(".state-loading");
        if (load) load.remove();
        resolve(true);
      }, frameDelay);
    });
  }
  window.addEventListener("hashchange", () => dispatch());
  return dispatch;
}

// ---- shared UI building blocks (used by every module) ----

export function tabs(activeId, items) {
  const bar = el("div", "psa-tabs");
  bar.setAttribute("role", "tablist");
  for (const it of items) {
    const a = el("a", "psa-tab" + (it.id === activeId ? " active" : ""), h(it.label));
    a.href = "#/" + it.href;
    a.dataset.tab = it.id;
    if (it.count != null) a.appendChild(el("span", "psa-tab-count", h(String(it.count))));
    bar.appendChild(a);
  }
  return bar;
}

export function toast(message, kind = "ok", ms = 3200) {
  const host = document.getElementById("psaToastHost");
  if (!host) return;
  const t = el("div", "psa-toast psa-toast-" + kind);
  t.innerHTML = '<span class="psa-toast-ic">' + icon(kind === "err" ? "alert" : "check", 16) + "</span><span>" + h(message) + "</span>";
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function modal({ title, body, actions = [], onClose, wide = false }) {
  const overlay = el("div", "psa-modal-overlay");
  const box = el("div", "psa-modal" + (wide ? " psa-modal-wide" : ""));
  const head = el("div", "psa-modal-head");
  head.appendChild(el("h3", "psa-modal-title", h(title)));
  const closeBtn = el("button", "psa-icon-btn psa-modal-close", icon("close", 18));
  closeBtn.setAttribute("aria-label", "Close");
  head.appendChild(closeBtn);
  box.appendChild(head);
  const bodyWrap = el("div", "psa-modal-body");
  if (typeof body === "string") bodyWrap.innerHTML = body;
  else if (body) bodyWrap.appendChild(body);
  box.appendChild(bodyWrap);
  if (actions.length) {
    const foot = el("div", "psa-modal-foot");
    for (const a of actions) {
      const b = el("button", "btn " + (a.kind || "btn-ghost"), h(a.label));
      if (a.icon) b.prepend(el("span", "", icon(a.icon, 16)));
      if (a.disabled) b.disabled = true;
      if (a.onClick) b.addEventListener("click", () => a.onClick(b));
      if (a.className) b.className += " " + a.className;
      foot.appendChild(b);
    }
    box.appendChild(foot);
  }
  overlay.appendChild(box);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  closeBtn.addEventListener("click", close);
  function close() {
    if (onClose) onClose();
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  document.getElementById("psaView").appendChild(overlay);
  return { overlay, box, close };
}

export function confirmModal({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  modal({
    title,
    body: el("p", "psa-confirm-msg", h(message)),
    actions: [
      { label: "Cancel", onClick: (b) => b.closest(".psa-modal-overlay").remove() },
      { label: confirmLabel, kind: danger ? "btn-danger" : "btn-primary", onClick: (b) => {
          onConfirm();
          b.closest(".psa-modal-overlay").remove();
        } }
    ]
  });
}

// ---- formatting helpers ----

export function moneyFmt(n, currency) {
  const v = Number(n) || 0;
  const cur = currency || "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(v);
  } catch (e) {
    return cur + " " + v.toFixed(2);
  }
}

export function numFmt(n, digits = 1) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function pctFmt(n, digits = 0) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return (v * 100).toFixed(digits) + "%";
}

export function dateFmt(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function dateShort(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function isoDay(date) {
  const dt = date instanceof Date ? date : new Date(date);
  if (isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

export function todayIso() {
  return isoDay(new Date());
}

export function addDays(iso, days) {
  const dt = new Date(iso + "T00:00:00");
  dt.setDate(dt.getDate() + days);
  return isoDay(dt);
}

export function parseIso(iso) {
  return new Date(iso + "T00:00:00");
}

export function daysBetween(aIso, bIso) {
  const a = parseIso(aIso).getTime();
  const b = parseIso(bIso).getTime();
  return Math.round((b - a) / 86400000);
}

// ---- CSV helpers ----

export function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

export function downloadFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch === "\r") {}
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}
