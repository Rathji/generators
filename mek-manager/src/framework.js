/* ============================================================
   BATTLETECH MERCENARY MANAGER — framework (src/framework.js)
   - reads `config` + `features` from main.pjs (root.config/root.features)
   - applies the theme as CSS custom properties on <html>
   - binds static text (data-field / data-href), renders the
     roadmap status panel, and exposes shared helpers on window.BT
   Pattern: business-template generator (config-driven pjs → src renderer).
   ============================================================ */
(function () {
  "use strict";

  /* ============================ utils ============================ */

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  function hexToRgb(hex) {
    let h = String(hex).replace("#", "").trim();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  function toHex(rgb) {
    return "#" + [rgb.r, rgb.g, rgb.b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  }
  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    if (!a || !b) return hexA;
    return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
  }
  const lighten = (hex, t) => mix(hex, "#ffffff", t);
  const darken = (hex, t) => mix(hex, "#000000", t);
  function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    return rgb ? "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + alpha + ")" : hex;
  }

  function toast(msg, type) {
    const ctn = $("#toastCtn");
    if (!ctn) return;
    const t = document.createElement("div");
    t.className = "toast" + (type ? " " + type : "");
    t.textContent = msg;
    ctn.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, 2800);
  }

  function rememberFocus(backEl) { if (backEl) backEl._prevFocus = document.activeElement; }
  function restoreFocus(backEl) {
    const pf = backEl && backEl._prevFocus;
    if (pf && pf.focus && document.contains(pf)) pf.focus();
  }
  function autofocusIn(backEl) {
    if (!backEl) return;
    let target = backEl.querySelector("[data-autofocus]");
    if (!target) target = backEl.querySelector(".modal[tabindex]");
    if (!target) target = backEl.querySelector("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]");
    if (!target) target = backEl.querySelector(".modal");
    if (target && typeof target.focus === "function") target.focus();
  }
  function topModal() {
    const backs = $$(".modal-back").filter((m) => !m.hidden);
    return backs.length ? backs[backs.length - 1] : null;
  }
  function openModal(backEl) {
    if (!backEl) return;
    rememberFocus(backEl);
    backEl.hidden = false;
    autofocusIn(backEl);
  }
  function closeModal(backEl) {
    if (!backEl) return;
    if (backEl.dataset.modalStatic === "1") backEl.hidden = true;
    else backEl.remove();
    restoreFocus(backEl);
  }
  function initModals() {
    $$("[data-modal-open]").forEach((btn) => on(btn, "click", () => openModal($(btn.dataset.modalOpen))));
    $$("[data-modal-close]").forEach((btn) => on(btn, "click", () => {
      const back = btn.closest(".modal-back");
      if (back) closeModal(back);
    }));
    $$(".modal-back").forEach((back) => on(back, "click", (e) => { if (e.target === back) closeModal(back); }));
    on(document, "keydown", (e) => { if (e.key === "Escape") closeModal(topModal()); });
  }
  function initTabs() {
    $$(".tabs").forEach((bar) => {
      const panels = $$(".tab-panel", bar.parentElement);
      on(bar, "click", (e) => {
        const tab = e.target.closest(".tab");
        if (!tab) return;
        $$(".tab", bar).forEach((t) => t.classList.toggle("active", t === tab));
        const target = tab.dataset.tab;
        panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === target));
      });
    });
  }

  const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
  const fmtMoney = (n) => fmtInt(n) + " C-bills";

  /* ============================ fonts ============================ */

  const FONTS = {
    "rajdhani-inter": { display: "Rajdhani", body: "Inter" },
    "lato": { display: "Lato", body: "Lato" },
    "inter": { display: "Inter", body: "Inter" }
  };

  function injectFonts(familyId) {
    const f = FONTS[familyId] || FONTS["rajdhani-inter"];
    const css2 = (fam, weights) => "family=" + fam.replace(/ /g, "+") + ":" + weights;
    const parts = [];
    if (f.body === f.display) parts.push(css2(f.body, "400;500;600;700"));
    else { parts.push(css2(f.display, "500;600;700")); parts.push(css2(f.body, "400;500;600;700")); }
    let link = $('link[data-fonts]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.fonts = "1";
      document.head.appendChild(link);
    }
    link.href = "https://fonts.googleapis.com/css2?" + parts.join("&") + "&display=swap";
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--font-display", '"' + f.display + '", var(--font-fallback)');
    rootStyle.setProperty("--font-body", '"' + f.body + '", var(--font-fallback)');
  }

  /* ============================ config read ============================ */

  const FALLBACK_CFG = {
    schemaVersion: "0.1.0",
    branding: {
      companyName: "BattleTech Mercenary Manager",
      companyShortName: "Merc Manager",
      logoGlyph: "M",
      tagline: "",
      footerText: ""
    },
    theme: { mode: "dark", accentStyle: "gradient", radius: 14, fontSize: 16, fontFamily: "rajdhani-inter", reduceMotion: false },
    colors: {
      primary: "#e2a63b", secondary: "#5f6f3f", accent: "#9aa75a",
      background: "#0f120b", surface: "#161a11", text: "#e7e1ce", textMuted: "#968e74"
    },
    admin: { showSettingsButton: false }
  };

  function readConfig() {
    const node = window.root && root.config ? root.config : undefined;
    const str = (v, d) => (v === undefined || v === null ? d || "" : String(v));
    const num = (v, d) => (v === undefined || v === null ? d : Number(v));
    const bool = (v, d) => (v === undefined ? d : !!v);
    const pick = (o, k, d) => (o && o[k] !== undefined && o[k] !== null ? o[k] : d);

    if (!node) {
      console.warn("framework: could not read `config` in main.pjs — using defaults");
      return JSON.parse(JSON.stringify(FALLBACK_CFG));
    }

    const B = node.branding || {}, T = node.theme || {}, C = node.colors || {}, A = node.admin || {};

    return {
      schemaVersion: str(node.schemaVersion, "0.1.0"),
      branding: {
        companyName: str(B.companyName, "BattleTech Mercenary Manager"),
        companyShortName: str(B.companyShortName, "Merc Manager"),
        logoGlyph: str(B.logoGlyph, "M"),
        tagline: str(B.tagline),
        footerText: str(B.footerText, "")
      },
      theme: {
        mode: ["light", "dark"].includes(str(T.mode, "dark")) ? str(T.mode, "dark") : "dark",
        accentStyle: ["gradient", "solid"].includes(str(T.accentStyle, "gradient")) ? str(T.accentStyle, "gradient") : "gradient",
        radius: clamp(num(T.radius, 14), 4, 28),
        fontSize: clamp(num(T.fontSize, 16), 14, 20),
        fontFamily: str(T.fontFamily, "rajdhani-inter") in FONTS ? str(T.fontFamily, "rajdhani-inter") : "rajdhani-inter",
        reduceMotion: bool(T.reduceMotion, false)
      },
      colors: {
        primary: str(pick(C, "primary", "#e2a63b"), "#e2a63b"),
        secondary: str(pick(C, "secondary", "#5f6f3f"), "#5f6f3f"),
        accent: str(pick(C, "accent", "#9aa75a"), "#9aa75a"),
        background: str(pick(C, "background", "#0f120b"), "#0f120b"),
        surface: str(pick(C, "surface", "#161a11"), "#161a11"),
        text: str(pick(C, "text", "#e7e1ce"), "#e7e1ce"),
        textMuted: str(pick(C, "textMuted", "#968e74"), "#968e74")
      },
      admin: { showSettingsButton: bool(A.showSettingsButton, false) }
    };
  }

  function readFeatures() {
    const node = window.root && root.features ? root.features : undefined;
    if (!node) { console.warn("framework: could not read `features` in main.pjs"); return []; }
    const out = [];
    for (let i = 1; i <= 60; i++) {
      const n = node["f" + i];
      if (n === undefined) break;
      out.push({
        task: i,
        phase: Number(n.phase) || 1,
        title: String(n.title || "Task " + i),
        desc: String(n.desc || ""),
        done: !!n.done
      });
    }
    return out;
  }

  /* ============================ theme apply ============================ */

  const PHASES = {
    1: "Personnel & Unit Foundation",
    2: "Financial & Resource Management",
    3: "Era & World Setting",
    4: "Mission Market & Contract Logic",
    5: "AI Battle Simulation & Reporting",
    6: "Salvage & Discovery",
    7: "Company Growth & Loop",
    8: "Personnel Development",
    9: "Combat & Simulation Depth",
    10: "Economy & Logistics",
    11: "World, Era & Factions",
    12: "Interface & Characterization",
    13: "Meta, Saves & Sharing",
    14: "Solaris Arena Mode"
  };

  function maxPhase(feats) {
    let m = 1;
    feats.forEach((f) => { if (f.phase > m) m = f.phase; });
    Object.keys(PHASES).forEach((k) => { if (Number(k) > m) m = Number(k); });
    return m;
  }

  function applyTheme(cfg) {
    const t = cfg.theme, c = cfg.colors;
    const isDark = t.mode === "dark";
    const bg = isDark ? c.background : "#f2efe8";
    const surface = isDark ? c.surface : "#ffffff";
    const text = isDark ? c.text : "#1d2530";
    const muted = isDark ? c.textMuted : "#5d6a78";
    const s2 = isDark ? mix(surface, "#ffffff", 0.06) : mix(surface, "#1d2530", 0.055);
    const r = document.documentElement.style;
    r.setProperty("--primary", c.primary);
    r.setProperty("--secondary", c.secondary);
    r.setProperty("--accent", c.accent);
    r.setProperty("--radius", t.radius + "px");
    r.setProperty("--bg", bg);
    r.setProperty("--surface", surface);
    r.setProperty("--surface-2", s2);
    r.setProperty("--border", isDark ? "rgba(178,186,132,.16)" : "rgba(20,30,45,.12)");
    r.setProperty("--border-strong", isDark ? "rgba(178,186,132,.34)" : "rgba(20,30,45,.3)");
    r.setProperty("--text", text);
    r.setProperty("--text-muted", muted);
    r.setProperty("--primary-strong", isDark ? lighten(c.primary, 0.14) : darken(c.primary, 0.12));
    r.setProperty("--primary-soft", mix(c.primary, bg, isDark ? 0.86 : 0.9));
    r.setProperty("--grad", t.accentStyle === "solid"
      ? "linear-gradient(135deg," + c.primary + "," + c.primary + ")"
      : "linear-gradient(135deg," + c.primary + "," + c.secondary + ")");
    r.setProperty("--ring", hexToRgba(c.primary, 0.5));
    r.setProperty("--ring-soft", hexToRgba(c.primary, 0.18));
    r.setProperty("--header-glass", hexToRgba(bg, isDark ? 0.82 : 0.85));
    r.setProperty("--text-scale", (t.fontSize / 16).toFixed(4));
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    document.documentElement.classList.toggle("reduce-motion", !!t.reduceMotion);
    document.body.style.fontSize = "calc(16px * var(--text-scale))";
  }

  /* ============================ static text binding ============================ */

  function bindStatic(cfg) {
    $$("[data-field]").forEach((el) => {
      const v = getPath(cfg, el.dataset.field);
      if (v != null) el.textContent = v;
    });
    $$("[data-href]").forEach((el) => {
      const v = getPath(cfg, el.dataset.href);
      if (v) el.setAttribute("href", v);
    });
    const mark = $("#logoMark");
    if (mark) mark.textContent = cfg.branding.logoGlyph || "M";
    const logoText = $("#logoText");
    if (logoText) logoText.textContent = cfg.branding.companyShortName;
    const tag = $("#footerTagline");
    if (tag) tag.textContent = cfg.branding.tagline || "";
    const yearEl = $("#yearEl");
    if (yearEl) {
      const t = String(cfg.branding.footerText || "")
        .replace("{year}", new Date().getFullYear())
        .replace("{companyName}", cfg.branding.companyName);
      yearEl.textContent = t;
    }
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  /* ============================ roadmap panel ============================ */

  function renderRoadmap(feats) {
    const matrix = $("#roadmapMatrix");
    if (!matrix) return;
    const byPhase = new Map();
    feats.forEach((f) => {
      if (!byPhase.has(f.phase)) byPhase.set(f.phase, []);
      byPhase.get(f.phase).push(f);
    });
    let html = "";
    const lastPhase = maxPhase(feats);
    for (let p = 1; p <= lastPhase; p++) {
      const list = byPhase.get(p) || [];
      const done = list.filter((f) => f.done).length;
      const name = PHASES[p] || ("Phase " + p);
      html += '<div class="phase-block">'
        + '<div class="ph-head"><span class="ph-tag">P' + p + '</span>'
        + '<span class="ph-name">' + esc(name) + '</span>'
        + '<span class="chip ph-count">' + done + ' / ' + list.length + '</span></div>';
      list.forEach((f) => {
        html += '<div class="task-row' + (f.done ? " done" : "") + '">'
          + '<span class="tick">' + (f.done ? "✓" : "") + '</span>'
          + '<div class="task-body"><strong>' + f.task + '. ' + esc(f.title) + '</strong>'
          + (f.desc ? '<p>' + esc(f.desc) + '</p>' : '')
          + '</div></div>';
      });
      html += "</div>";
    }
    matrix.innerHTML = html;

    const totalDone = feats.filter((f) => f.done).length;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText("systemsOnline", totalDone + " / " + feats.length);
    setText("phasesCleared", countClearedPhases(feats) + " / " + lastPhase);
    const meters = $("#phaseMeters");
    if (meters) {
      let mhtml = "";
      for (let p = 1; p <= lastPhase; p++) {
        const list = byPhase.get(p) || [];
        const done = list.filter((f) => f.done).length;
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        mhtml += '<div class="phase-meter"><div class="pm-head">'
          + '<span class="pm-name">P' + p + ' · ' + esc((PHASES[p] || "").split(" ")[0]) + '</span>'
          + '<span class="pm-count">' + done + '/' + list.length + '</span></div>'
          + '<div class="meter"><div class="meter-fill" style="width:' + pct + '%"></div></div></div>';
      }
      meters.innerHTML = mhtml;
    }
  }

  function countClearedPhases(feats) {
    const byPhase = new Map();
    feats.forEach((f) => { byPhase.set(f.phase, (byPhase.get(f.phase) || 0) + (f.done ? 1 : 0)); });
    const totals = new Map();
    feats.forEach((f) => totals.set(f.phase, (totals.get(f.phase) || 0) + 1));
    let cleared = 0;
    totals.forEach((total, p) => { if ((byPhase.get(p) || 0) === total) cleared++; });
    return cleared;
  }

  /* ============================ boot ============================ */

  const ICON_SVG = {
    dark: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    light: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg>'
  };

  function setToggleIcon(cfg) {
    const icon = $("#themeToggleIcon");
    if (icon) icon.innerHTML = ICON_SVG[cfg.theme.mode === "dark" ? "dark" : "light"];
  }

  function boot() {
    const cfg = readConfig();
    let features = readFeatures();
    injectFonts(cfg.theme.fontFamily);
    applyTheme(cfg);
    bindStatic(cfg);
    setToggleIcon(cfg);
    renderRoadmap(features);
    initModals();
    initTabs();
    const toggle = $("#themeToggle");
    if (toggle) on(toggle, "click", () => {
      cfg.theme.mode = cfg.theme.mode === "dark" ? "light" : "dark";
      applyTheme(cfg);
      setToggleIcon(cfg);
    });

    window.BT = {
      config: cfg,
      features: features,
      refreshFeatures: () => { features = readFeatures(); renderRoadmap(features); return features; },
      $: $, $$: $$, esc: esc, toast: toast,
      openModal: openModal, closeModal: closeModal,
      rememberFocus: rememberFocus, restoreFocus: restoreFocus, focusModal: autofocusIn,
      fmtInt: fmtInt, fmtMoney: fmtMoney,
      phases: PHASES
    };
  }

  if (document.readyState === "loading") on(document, "DOMContentLoaded", boot);
  else boot();
})();
