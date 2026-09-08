/* ============================================================================
   LEDGERLY — framework.js
   Reads the `config` and `features` lists from main.pjs, applies the theme
   (colors/mode/font from config, like business-template), and exposes small
   UI + persistence utilities used by app.js and future feature modules.
   ============================================================================ */
(function () {
  "use strict";

  const root = window.root;
  const FW = {};

  /* ── list/scalar helpers ─────────────────────────────────────────────── */
  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function scalar(v) {
    if (v == null) return null;
    let s;
    try { s = v.evaluateItem; } catch (e) { s = v; }
    if (typeof s === "string") {
      const t = s.trim();
      if (t === "true") return true;
      if (t === "false") return false;
      if (t !== "" && !isNaN(Number(t)) && String(Number(t)) === t) return Number(t);
      if (/^\[[^]*\]$/.test(t)) {
        try { return JSON.parse(t); } catch (e) { /* keep as string */ }
      }
      return t;
    }
    return s;
  }
  FW.scalar = scalar;
  FW.childList = (node, name) => {
    if (!node) return null;
    try { return node[name]; } catch (e) { return null; }
  };
  FW.itemsOf = listNode => {
    if (!listNode) return [];
    try { return listNode.selectAll || []; } catch (e) { return []; }
  };

  /* ── config (main.pjs `config` list) ─────────────────────────────────── */
  FW.readConfig = function () {
    const c = root && root.config;
    const pick = (path) => {
      let node = c;
      for (const p of path) { node = FW.childList(node, p); if (!node) return null; }
      return scalar(node);
    };
    return {
      schemaVersion: pick(["schemaVersion"]) || "1.0.0",
      branding: {
        companyName: pick(["branding", "companyName"]) || "The Ledger",
        companyShortName: pick(["branding", "companyShortName"]) || "Ledger",
        logoGlyph: pick(["branding", "logoGlyph"]) || "L",
        tagline: pick(["branding", "tagline"]) || "",
        footerText: pick(["branding", "footerText"]) || "",
      },
      theme: {
        mode: pick(["theme", "mode"]) || "light",
        accentStyle: pick(["theme", "accentStyle"]) || "gradient",
        radius: num(pick(["theme", "radius"]) || 14),
        fontSize: num(pick(["theme", "fontSize"]) || 15),
        fontFamily: pick(["theme", "fontFamily"]) || "inter",
        reduceMotion: !!pick(["theme", "reduceMotion"]),
      },
      colors: {
        primary: pick(["colors", "primary"]) || "#0f766e",
        secondary: pick(["colors", "secondary"]) || "#14b8a6",
        accent: pick(["colors", "accent"]) || "#134e4a",
        background: pick(["colors", "background"]) || "#f2f6f4",
        surface: pick(["colors", "surface"]) || "#ffffff",
        text: pick(["colors", "text"]) || "#17211f",
        textMuted: pick(["colors", "textMuted"]) || "#5c6b67",
      },
      app: {
        defaultView: pick(["app", "defaultView"]) || "dashboard",
        version: pick(["app", "version"]) || "0.0.0",
      },
    };
  };

  /* ── features checklist (main.pjs `features` list) ───────────────────── */
  FW.readFeatures = function () {
    const phasesList = root && root.features ? root.features.phases : null;
    const out = [];
    if (!phasesList) return out;
    for (const p of FW.itemsOf(phasesList)) {
      const phase = {
        key: scalar(FW.childList(p, "key")) || "",
        icon: scalar(FW.childList(p, "icon")) || "ledger",
        nav: scalar(FW.childList(p, "nav")) || "",
        name: scalar(FW.childList(p, "name")) || "",
        blurb: scalar(FW.childList(p, "blurb")) || "",
        items: [],
      };
      const itemsList = FW.childList(p, "items");
      for (const t of FW.itemsOf(itemsList)) {
        phase.items.push({
          id: num(scalar(FW.childList(t, "id"))),
          task: scalar(FW.childList(t, "task")) || "",
          detail: scalar(FW.childList(t, "detail")) || "",
          status: (scalar(FW.childList(t, "status")) || "pending").toLowerCase(),
        });
      }
      out.push(phase);
    }
    return out;
  };

  /* ── theme application ───────────────────────────────────────────────── */
  function hexToRgb(hex) {
    let h = String(hex || "").replace("#", "").trim();
    if (h.length === 3) h = h.split("").map(x => x + x).join("");
    const n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) { /* mix hex colors a→b, t in [0,1] */
    const A = hexToRgb(a), B = hexToRgb(b);
    if (!A || !B) return a;
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
    return "rgb(" + c.join(", ") + ")";
  }
  FW.mix = mix;

  const FONTS = {
    inter:        { fam: "Inter",         url: "Inter:wght@400;500;600;700;800" },
    lato:         { fam: "Lato",          url: "Lato:wght@400;700;900" },
    manrope:      { fam: "Manrope",       url: "Manrope:wght@400;500;600;700;800" },
    "dm-sans":    { fam: "DM Sans",       url: "DM+Sans:opsz,wght@9..40,400;500;600;700;800" },
    "ibm-plex":   { fam: "IBM Plex Sans", url: "IBM+Plex+Sans:wght@400;500;600;700" },
    "source-sans":{ fam: "Source Sans 3", url: "Source+Sans+3:wght@400;600;700" },
    "open-sans":  { fam: "Open Sans",     url: "Open+Sans:wght@400;600;700;800" },
  };

  function ensureFont(key) {
    const f = FONTS[key] || FONTS.inter;
    if (document.getElementById("ledgerly-font")) {
      document.getElementById("ledgerly-font").setAttribute("href",
        "https://fonts.googleapis.com/css2?family=" + f.url + "&display=swap");
    } else {
      const link = document.createElement("link");
      link.id = "ledgerly-font";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=" + f.url + "&display=swap";
      document.head.appendChild(link);
    }
    return f.fam;
  }

  FW.applyTheme = function (cfg, modeOverride) {
    const c = cfg.colors, th = cfg.theme;
    const mode = modeOverride || th.mode;
    const r = document.documentElement;
    r.setAttribute("data-mode", mode);
    r.setAttribute("data-accent", th.accentStyle);

    let vars;
    if (mode === "dark") {
      const surface = mix(c.background, "#0c1311", 0.86);
      vars = {
        "--bg": mix(c.background, "#0b1210", 0.9),
        "--surface": surface,
        "--surface-2": mix(surface, "#ffffff", 0.07),
        "--text": mix(c.text, "#ffffff", 0.88),
        "--text-muted": mix(c.textMuted, "#ffffff", 0.56),
        "--border": "rgba(235, 246, 243, 0.13)",
        "--shadow-color": "rgba(0, 0, 0, 0.4)",
        "--primary": mix(c.primary, "#7ee8d8", 0.24),
        "--secondary": mix(c.secondary, "#9af0e4", 0.16),
        "--accent": mix(c.accent, "#57d6c4", 0.14),
      };
    } else {
      vars = {
        "--bg": c.background,
        "--surface": c.surface,
        "--surface-2": mix(c.surface, "#000000", 0.025),
        "--text": c.text,
        "--text-muted": c.textMuted,
        "--border": mix(c.text, c.surface, 0.88),
        "--shadow-color": "rgba(19, 42, 37, 0.09)",
        "--primary": c.primary,
        "--secondary": c.secondary,
        "--accent": c.accent,
      };
    }
    for (const k in vars) r.style.setProperty(k, vars[k]);
    r.style.setProperty("--radius", th.radius + "px");
    r.style.setProperty("--font-size", th.fontSize + "px");
    r.style.setProperty("--btn-grad", th.accentStyle === "solid"
      ? c.primary
      : "linear-gradient(135deg, " + vars["--primary"] + ", " + vars["--secondary"] + ")");

    const fam = ensureFont(th.fontFamily);
    r.style.setProperty("--font-family", '"' + fam + '", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');

    if (th.reduceMotion) {
      const st = document.createElement("style");
      st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
      document.head.appendChild(st);
    }
    return mode;
  };

  /* ── DOM helpers ─────────────────────────────────────────────────────── */
  FW.$ = (sel, el) => (el || document).querySelector(sel);
  FW.$$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  FW.el = function (tag, cls, html, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (attrs) for (const k in attrs) {
      if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    return e;
  };
  FW.esc = s => String(s == null ? "" : s)
    .replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  FW.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  FW.toast = function (msg, type) {
    let ctn = FW.$(".toast-ctn");
    if (!ctn) {
      ctn = FW.el("div", "toast-ctn");
      document.body.appendChild(ctn);
    }
    const t = FW.el("div", "toast" + (type === "err" ? " err" : ""), FW.esc(msg));
    ctn.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, 3600);
  };

  FW.modal = function (html) {
    const back = FW.el("div", "modal-back");
    const modal = FW.el("div", "modal");
    modal.innerHTML = html;
    back.appendChild(modal);
    back.addEventListener("click", e => { if (e.target === back) back.remove(); });
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add("open"));
    return modal;
  };

  FW.money = function (n, currency, digits) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency", currency: currency || "USD",
        minimumFractionDigits: digits == null ? 2 : digits,
        maximumFractionDigits: digits == null ? 2 : digits,
      }).format(Number(n) || 0);
    } catch (e) { return (Number(n) || 0).toFixed(digits == null ? 2 : digits); }
  };

  /* ── persistence (kv-plugin, folder "ledgerly"; localStorage fallback) ─ */
  const mem = {};
  function ls() { try { return window.localStorage; } catch (e) { return null; } }
  FW.store = {
    folder: "ledgerly",
    async get(key, def) {
      try {
        if (root && root.kv) {
          const v = await root.kv[this.folder].get(key);
          return v === undefined || v === null ? def : v;
        }
      } catch (e) { /* fall through to localStorage */ }
      try {
        const s = ls() && ls().getItem("ledgerly_" + key);
        return s == null ? def : JSON.parse(s);
      } catch (e) { return key in mem ? mem[key] : def; }
    },
    async set(key, val) {
      mem[key] = val;
      try {
        if (root && root.kv) { await root.kv[this.folder].set(key, val); return; }
      } catch (e) { /* fall through */ }
      try { ls() && ls().setItem("ledgerly_" + key, JSON.stringify(val)); } catch (e) {}
    },
    async del(key) {
      delete mem[key];
      try {
        if (root && root.kv) { await root.kv[this.folder].delete(key); return; }
      } catch (e) {}
      try { ls() && ls().removeItem("ledgerly_" + key); } catch (e) {}
    },
  };

  window.FW = FW;
})();
