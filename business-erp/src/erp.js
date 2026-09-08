/* ============================================================
   BUSINESS ERP — application shell & module framework
   - module registry (registerModule / modules) — the contract
     every future ERP module plugs into
   - hash router (#/moduleId), role-aware route guards
   - role model (owner / manager / staff) with persisted choice
   - consistent loading / empty / error state renderers
   - theme + responsive drawer behaviour
   ============================================================ */

(function () {
  "use strict";

  const ERP = (window.ERP = {});
  const LS = {
    role: "erp.role.v1",
    theme: "erp.theme.v1",
  };

  /* ─────────────────────────── tiny utils ─────────────────────────── */

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  ERP.escapeHtml = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  ERP.toast = function (msg, type) {
    const ctn = $("#toastCtn");
    if (!ctn) return;
    const t = document.createElement("div");
    t.className = "toast" + (type ? " " + type : "");
    t.textContent = msg;
    ctn.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transition = "opacity .3s";
      setTimeout(() => t.remove(), 320);
    }, 2600);
  };

  /* read a dotted path from root.config, evaluating perchance items */
  function configVal(path, fallback) {
    try {
      let o = root && root.config;
      for (const k of String(path).split(".")) {
        if (o == null) return fallback;
        o = o[k];
      }
      if (o == null) return fallback;
      if (o.evaluateItem !== undefined) return o.evaluateItem;
      if (typeof o === "string" || typeof o === "number" || typeof o === "boolean") return o;
      return fallback;
    } catch (e) {
      return fallback;
    }
  }

  ERP.configVal = configVal;

  /* ─────────────────────────── icons ─────────────────────────── */

  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    crm: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    sales: '<path d="M5 3v18l2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1Z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>',
    purchasing: '<circle cx="9" cy="21" r="1.2"/><circle cx="20" cy="21" r="1.2"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
    inventory: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
    projects: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    finance: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
    reports: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    chev: '<path d="m9 18 6-6-6-6"/>',
  };

  ERP.icon = function (name, size) {
    const body = ICONS[name] || ICONS.dashboard;
    const s = size || 20;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  };

  /* ─────────────────────────── theme ─────────────────────────── */

  function hex(a) { return String(a || "").replace("#", ""); }
  function mix(hexA, hexB, t) {
    const pa = parseInt(hexA, 16), pb = parseInt(hexB, 16);
    if (![pa, pb].every((n) => isFinite(n) && n >= 0)) return hexA;
    const out = [0, 8, 16].map((s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t));
    return "#" + out.map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  function darken(c, t) { return mix(hex(c), "000000", t); }

  ERP.applyTheme = function (mode) {
    const isDark = mode === "dark";
    const r = document.documentElement.style;
    const c = {
      primary: configVal("colors.primary", "#0a58ca"),
      secondary: configVal("colors.secondary", "#6ea8fe"),
      accent: configVal("colors.accent", "#084298"),
      background: configVal("colors.background", "#f8f9fa"),
      surface: configVal("colors.surface", "#ffffff"),
      text: configVal("colors.text", "#212529"),
      textMuted: configVal("colors.textMuted", "#6c757d"),
    };
    r.setProperty("--primary", c.primary);
    r.setProperty("--secondary", c.secondary);
    r.setProperty("--accent", c.accent);
    r.setProperty("--grad", "linear-gradient(135deg," + c.primary + "," + c.secondary + ")");
    r.setProperty("--primary-strong", isDark ? darken(c.primary, -0.14) : darken(c.primary, 0.12));
    r.setProperty("--primary-soft", mix(hex(c.primary), hex(isDark ? "#141414" : c.background), isDark ? 0.8 : 0.9));
    r.setProperty("--ring", c.primary + "73");
    if (isDark) {
      r.setProperty("--bg", "#141414");
      r.setProperty("--surface", "#1d1d22");
      r.setProperty("--surface-2", "#26262c");
      r.setProperty("--border", "rgba(148,163,184,.2)");
      r.setProperty("--text", "#f1f5f9");
      r.setProperty("--text-muted", "#94a3b8");
      r.setProperty("--bg-glass", "rgba(20,20,20,.82)");
    } else {
      r.setProperty("--bg", c.background);
      r.setProperty("--surface", c.surface);
      r.setProperty("--surface-2", "#eef0f6");
      r.setProperty("--border", "rgba(15,23,42,.09)");
      r.setProperty("--text", c.text);
      r.setProperty("--text-muted", c.textMuted);
      r.setProperty("--bg-glass", "rgba(255,255,255,.82)");
    }
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    const iconEl = $("#themeToggleIcon");
    if (iconEl) iconEl.innerHTML = ERP.icon(isDark ? "sun" : "moon", 18);
    const btn = $("#themeToggle");
    if (btn) btn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  };

  function currentTheme() {
    const saved = (() => { try { return localStorage.getItem(LS.theme); } catch (e) { return null; } })();
    if (saved === "dark" || saved === "light") return saved;
    return configVal("theme.mode", "light") === "dark" ? "dark" : "light";
  }

  /* ─────────────────────────── role model ─────────────────────────── */

  ERP.ROLES = ["owner", "manager", "staff"];
  ERP.ROLE_LABELS = { owner: "Owner", manager: "Manager", staff: "Staff" };
  const DEFAULT_ROLE = "owner";

  function persist(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  let _role = null;

  function setRole(role) {
    if (ERP.ROLES.indexOf(role) === -1) role = DEFAULT_ROLE;
    _role = role;
    persist(LS.role, role);
    const chip = $("#roleChip");
    if (chip) chip.textContent = role;
    const sel = $("#roleSelect");
    if (sel) sel.value = role;
    renderNav();
    if (!ERP.canAccess(currentModuleId()) && currentModuleId()) {
      ERP.toast("That module isn't visible to the " + ERP.ROLE_LABELS[role] + " role.", "error");
      navigate("dashboard");
    }
  }

  Object.defineProperty(ERP, "role", {
    get() { return _role; },
    set(v) { setRole(v); },
  });

  ERP.canAccess = function (moduleId) {
    const m = getModule(moduleId);
    if (!m) return false;
    if (!m.roles || !m.roles.length) return true;
    return m.roles.indexOf(_role) !== -1;
  };

  /* ─────────────────────────── module registry ─────────────────────────── */

  ERP.modules = [];

  ERP.registerModule = function (def) {
    if (!def || !def.id) throw new Error("ERP module needs an id");
    if (getModule(def.id)) throw new Error("Duplicate ERP module id: " + def.id);
    def.roles = (def.roles || []).slice();
    ERP.modules.push(def);
    return def;
  };

  function getModule(id) {
    return ERP.modules.find((m) => m.id === id);
  }
  ERP.getModule = getModule;

  function currentModuleId() {
    const el = $("#view");
    return el ? el.getAttribute("data-module") : null;
  }

  /* ─────────────────────────── state renderers ─────────────────────────── */

  ERP.states = {
    loading(el, label) {
      el.className = "erp-content";
      el.innerHTML =
        '<div class="erp-state" role="status" data-state="loading">' +
        '<div class="spinner"></div>' +
        "<h2>" + ERP.escapeHtml(label || "Loading…") + "</h2>" +
        "<p>Please wait a moment.</p></div>";
    },
    empty(el, def) {
      const phase = def.phase
        ? '<span class="erp-phase-note">' + ERP.icon(def.phaseIcon || "reports", 14) + " " + ERP.escapeHtml(def.phase) + "</span>"
        : "";
      const action = def.action
        ? '<div class="erp-state-actions"><button class="btn btn-primary" data-empty-action>' + ERP.escapeHtml(def.action.label) + "</button></div>"
        : "";
      el.className = "erp-content";
      el.innerHTML =
        '<div class="erp-state" data-state="empty">' +
        '<div class="erp-state-icon">' + ERP.icon(def.icon || "reports", 26) + "</div>" +
        "<h2>" + ERP.escapeHtml(def.title || "Nothing here yet") + "</h2>" +
        "<p>" + ERP.escapeHtml(def.message || "") + "</p>" +
        phase +
        action +
        "</div>";
      if (def.action) {
        const b = el.querySelector("[data-empty-action]");
        b.addEventListener("click", () => def.action.onClick && def.action.onClick());
      }
    },
    error(el, opts) {
      el.className = "erp-content";
      el.innerHTML =
        '<div class="erp-state" data-state="error">' +
        '<div class="erp-state-icon err">' + ERP.icon("finance", 26) + "</div>" +
        "<h2>" + ERP.escapeHtml(opts.title || "Something went wrong") + "</h2>" +
        "<p>" + ERP.escapeHtml(opts.message || "An unexpected problem occurred.") + "</p>" +
        (opts.retry
          ? '<div class="erp-state-actions"><button class="btn btn-primary" data-error-retry>' + ERP.escapeHtml(opts.retry.label || "Try again") + "</button></div>"
          : "") +
        "</div>";
      if (opts.retry) {
        const b = el.querySelector("[data-error-retry]");
        b.addEventListener("click", () => opts.retry.onClick && opts.retry.onClick());
      }
    },
  };

  /* ─────────────────────────── navigation render ─────────────────────────── */

  const GROUPS = [
    { key: null, label: null },
    { key: "ops", label: "Operations" },
    { key: "fin", label: "Finance" },
  ];

  function visibleModules() {
    return ERP.modules.filter((m) => !m.hidden && ERP.canAccess(m.id));
  }

  function renderNav() {
    const nav = $("#nav");
    if (!nav) return;
    const active = currentModuleId();
    nav.innerHTML = GROUPS.map((g) => {
      const items = visibleModules().filter((m) => (m.group || null) === g.key);
      if (!items.length) return "";
      const label = g.label ? '<span class="erp-nav-group-label">' + ERP.escapeHtml(g.label) + "</span>" : "";
      const links = items
        .map((m) => {
          const cur = m.id === active ? ' aria-current="page"' : "";
          const href = "#/" + m.id;
          return (
            '<a class="erp-nav-link" href="' + href + '" data-module-link="' + m.id + '"' + cur + ">" +
            ERP.icon(m.icon || "dashboard", 19) +
            '<span>' + ERP.escapeHtml(m.label) + "</span></a>"
          );
        })
        .join("");
      return '<div class="erp-nav-group">' + label + links + "</div>";
    }).join("");
    $$("#nav [data-module-link]").forEach((a) =>
      a.addEventListener("click", () => {
        closeDrawer();
      })
    );
  }

  /* ─────────────────────────── drawer ─────────────────────────── */

  function openDrawer() {
    const sb = $("#sidebar"), ov = $("#overlay"), hb = $("#hamburgerBtn");
    sb.classList.add("open");
    ov.hidden = false;
    hb.setAttribute("aria-expanded", "true");
    hb.setAttribute("aria-label", "Close menu");
  }
  function closeDrawer() {
    const sb = $("#sidebar"), ov = $("#overlay"), hb = $("#hamburgerBtn");
    sb.classList.remove("open");
    ov.hidden = true;
    hb.setAttribute("aria-expanded", "false");
    hb.setAttribute("aria-label", "Open menu");
  }
  ERP.closeDrawer = closeDrawer;

  /* ─────────────────────────── router ─────────────────────────── */

  const LOAD_DELAY = 260;

  function setTitle(module) {
    const t = $("#pageTitle"), s = $("#pageSubtitle");
    if (t) t.textContent = module ? module.label : "Dashboard";
    if (s) s.textContent = module ? module.desc : "";
    document.title = (module ? module.label + " · " : "") + "Business ERP";
  }

  async function navigate(id) {
    const view = $("#view");
    if (!view) return;
    const sep = String(id).indexOf(":");
    const tab = sep > 0 ? String(id).slice(sep + 1) : "";
    const modId = sep > 0 ? String(id).slice(0, sep) : id;
    const module = getModule(modId);

    if (!module) {
      setTitle(null);
      ERP.states.error(view, {
        title: "Module not found",
        message: 'There is no module called "' + modId + '". It may have been removed or renamed.',
        retry: { label: "Back to dashboard", onClick: () => navigate("dashboard") },
      });
      view.setAttribute("data-module", "");
      renderNav();
      return;
    }

    if (!ERP.canAccess(module.id)) {
      ERP.toast("That module isn't visible to the " + ERP.ROLE_LABELS[_role] + " role.", "error");
      if (modId !== "dashboard") return navigate("dashboard");
    }

    view.setAttribute("data-module", module.id);
    setTitle(module);
    renderNav();
    ERP.states.loading(view, "Loading " + module.label);
    closeDrawer();
    view.scrollTop = 0;
    window.scrollTo(0, 0);

    await new Promise((r) => setTimeout(r, LOAD_DELAY));

    if (tab) view.__tab = tab; // deep-link into a module tab (e.g. #/finance:receivables)
    else view.__tab = ""; // plain route resets any previous tab deep-link

    const ctx = {
      el: view,
      module,
      navigate,
      toast: ERP.toast,
      empty() {
        ERP.states.empty(view, module.empty || { title: module.label, message: "This module has no content yet." });
      },
      error(opts) {
        ERP.states.error(view, Object.assign({ retry: { label: "Reload module", onClick: () => navigate(module.id) } }, opts));
      },
    };

    try {
      if (typeof module.render === "function") {
        await module.render(ctx);
      } else {
        ctx.empty();
      }
    } catch (e) {
      console.error("ERP module render failed:", module.id, e);
      ERP.states.error(view, {
        title: "This module hit a problem",
        message: (e && e.message) || "An unexpected error occurred while rendering.",
      });
    }
  }

  ERP.navigate = navigate;

  function onHashChange() {
    const m = (location.hash.match(/^#\/([a-z0-9-]+(?::[a-z0-9-]+)?)/i) || [])[1];
    navigate(m ? m.toLowerCase() : "dashboard");
  }

  /* ─────────────────────────── boot ─────────────────────────── */

  function bootProgress() {
    const p = $("#progressBar");
    if (!p) return;
    p.style.transition = "width .35s ease, opacity .4s ease";
    p.style.width = "100%";
    setTimeout(() => {
      p.style.opacity = "0";
      setTimeout(() => p.remove(), 450);
    }, 380);
  }

  function wire() {
    const hb = $("#hamburgerBtn");
    if (hb) hb.addEventListener("click", () => ($("#sidebar").classList.contains("open") ? closeDrawer() : openDrawer()));
    const ov = $("#overlay");
    if (ov) ov.addEventListener("click", closeDrawer);

    const tt = $("#themeToggle");
    if (tt) tt.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      persist(LS.theme, next);
      ERP.applyTheme(next);
    });

    const rs = $("#roleSelect");
    if (rs) rs.addEventListener("change", () => setRole(rs.value));

    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawer();
    });
  }

  function boot() {
    const brand = $("#brandName");
    if (brand) brand.textContent = configVal("branding.companyName", "Business ERP");
    const mark = $("#logoMark");
    if (mark) mark.textContent = configVal("branding.logoGlyph", "B").slice(0, 2);

    _role = (() => {
      try { const s = localStorage.getItem(LS.role); if (ERP.ROLES.indexOf(s) !== -1) return s; } catch (e) {}
      return configVal("erp.roleDefault", DEFAULT_ROLE);
    })();

    ERP.applyTheme(currentTheme());
    const rs = $("#roleSelect");
    if (rs) rs.value = _role;
    const chip = $("#roleChip");
    if (chip) chip.textContent = _role;

    wire();
    bootProgress();
    // Module scripts (src/erp.modules.js) execute right after this one; wait
    // until they've registered before the first navigation so the initial
    // route resolves to a real module (safety cap in case the registry is
    // genuinely empty, e.g. a module script failed to load).
    return waitForModules().then(onHashChange);
  }

  function waitForModules(maxMs) {
    return new Promise((resolve) => {
      if (ERP.modules.length > 0) return resolve();
      const deadline = Date.now() + (maxMs || 5000);
      const iv = setInterval(() => {
        if (ERP.modules.length > 0 || Date.now() > deadline) {
          clearInterval(iv);
          resolve();
        }
      }, 25);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
