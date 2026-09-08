(function () {
  const rootEl = document.getElementById("viewRoot");
  const sideNav = document.getElementById("sideNav");
  const layout = document.getElementById("layout");
  const sidebarEl = document.getElementById("sidebar");
  const navToggleBtn = document.getElementById("navToggleBtn");
  const navBackdrop = document.getElementById("navBackdrop");

  const modules = new Map();
  (window.CRM_MODULES || []).forEach(def => modules.set(def.id, Object.assign({}, def)));
  const renderers = window.CRM_RENDERERS || {};
  Object.keys(renderers).forEach(id => {
    const def = modules.get(id);
    if (def) def.render = renderers[id];
  });

  const STORE_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];

  modules.set("selftest", {
    id: "selftest",
    label: "Self-tests",
    tagline: "Automated checks for the application shell",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16"/><path d="M8 3v4l-3.5 9A2 2 0 0 0 6.3 20h11.4a2 2 0 0 0 1.8-4L16 7V3"/></svg>',
    render: renderSelftestReport
  });

  modules.set("segments", {
    id: "segments",
    label: "Segments",
    hidden: true,
    tagline: "Reusable named filters across companies, contacts and deals",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>',
    render: ctx => (window.CRM_SEGMENTS ? window.CRM_SEGMENTS.managerView(ctx) : null)
  });

  modules.set("emails", {
    id: "emails",
    label: "Email templates",
    hidden: true,
    tagline: "Reusable templates and one-off message compose",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
    render: ctx => (window.CRM_EMAILS ? window.CRM_EMAILS.view(ctx) : null)
  });

  modules.set("reminders", {
    id: "reminders",
    label: "Reminders",
    hidden: true,
    tagline: "Overdue follow-ups, upcoming deal closures and the daily digest",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    render: ctx => (window.CRM_REMINDERS ? window.CRM_REMINDERS.view(ctx) : null)
  });

  modules.set("rules", {
    id: "rules",
    label: "Automation",
    hidden: true,
    tagline: "When-then rules that run your follow-ups",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    render: ctx => (window.CRM_RULES ? window.CRM_RULES.view(ctx) : null)
  });

  let currentId = null;
  let lastKey = null;
  let navGeneration = 0;
  let settleWaiters = [];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function envInfo() {
    const name = window.generatorName || "";
    const unsaved = !!window.generatorIsUnsaved;
    return {
      name,
      unsaved,
      label: name ? (unsaved ? name + " · unpublished" : name) : "Unpublished workspace",
      ok: !unsaved && !!name
    };
  }

  function buildSideNav() {
    const html = ['<p class="side-label">Modules</p>'];
    modules.forEach(def => {
      if (def.id === "selftest" || def.hidden) return;
      html.push(`<a class="side-link" href="#/${esc(def.id)}" data-id="${esc(def.id)}">${def.icon}<span>${esc(def.label)}</span></a>`);
    });
    sideNav.innerHTML = html.join("");
    sideNav.querySelectorAll(".side-link").forEach(a => a.addEventListener("click", closeDrawer));
  }

  function setActiveNav(id) {
    sideNav.querySelectorAll(".side-link").forEach(a => {
      if (a.dataset.id === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  const MOBILE_BP = 920;

  function applyDrawer() {
    const open = layout.classList.contains("drawer-open");
    if (window.innerWidth <= MOBILE_BP) {
      sidebarEl.style.transform = open ? "translateX(0px)" : "translateX(-103%)";
    } else {
      sidebarEl.style.transform = "";
    }
  }

  function openDrawer() {
    layout.classList.add("drawer-open");
    navToggleBtn.setAttribute("aria-expanded", "true");
    navToggleBtn.setAttribute("aria-label", "Close module navigation");
    applyDrawer();
  }
  function closeDrawer() {
    layout.classList.remove("drawer-open");
    navToggleBtn.setAttribute("aria-expanded", "false");
    navToggleBtn.setAttribute("aria-label", "Open module navigation");
    applyDrawer();
  }
  navToggleBtn.addEventListener("click", () => {
    if (layout.classList.contains("drawer-open")) closeDrawer();
    else openDrawer();
  });
  navBackdrop.addEventListener("click", closeDrawer);
  window.addEventListener("resize", applyDrawer);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && layout.classList.contains("drawer-open")) closeDrawer();
  });

  function pageShell(def) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title"></h1>
          <p class="page-sub"></p>
        </div>
        <div class="page-actions"></div>
      </div>
      <div class="page-body"></div>`;
    wrap.querySelector(".page-title").textContent = def.label;
    wrap.querySelector(".page-sub").textContent = def.tagline || "";
    return wrap;
  }

  function emptyState(def) {
    const empty = def.empty || {};
    const card = document.createElement("div");
    card.className = "state state-empty";
    card.innerHTML = `
      <div class="state-icon">${def.icon || ""}</div>
      <p class="state-title"></p>
      <p class="state-msg"></p>`;
    card.querySelector(".state-title").textContent = empty.title || "Nothing here yet";
    card.querySelector(".state-msg").textContent = empty.message || `The ${def.label.toLowerCase()} module has no records yet.`;
    return card;
  }

  function errorState(def, err, opts) {
    const card = document.createElement("div");
    card.className = "state state-error view-error";
    card.innerHTML = `
      <div class="state-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>
      <p class="state-kicker">Something went wrong</p>
      <p class="state-title"></p>
      <p class="state-msg"></p>
      <div class="state-actions"></div>`;
    card.querySelector(".state-title").textContent = opts.title || `Couldn't load ${def.label}`;
    card.querySelector(".state-msg").textContent = err && err.message ? err.message : "An unexpected error occurred.";
    const actions = card.querySelector(".state-actions");
    const retry = document.createElement("button");
    retry.className = "btn btn-primary btn-sm";
    retry.dataset.retry = "1";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => go(opts.id || def.id));
    actions.appendChild(retry);
    const home = document.createElement("button");
    home.className = "btn btn-ghost btn-sm";
    home.textContent = "Go to Dashboard";
    home.addEventListener("click", () => go("dashboard"));
    actions.appendChild(home);
    return card;
  }

  function loadShell(def) {
    const el = document.createElement("div");
    el.className = "load-shell";
    el.setAttribute("role", "status");
    el.innerHTML = `<div class="spinner"></div><p>Loading ${esc(def.label)}…</p>`;
    return el;
  }

  const MIN_LOAD_MS = 220;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function notifySettled() {
    const w = settleWaiters;
    settleWaiters = [];
    w.forEach(fn => fn());
  }

  function routeKey(id, params) {
    return id + "/" + (params || []).join("/");
  }

  async function renderRoute(id, params) {
    const key = routeKey(id, params);
    lastKey = key;
    const gen = ++navGeneration;
    const def = modules.get(id);
    if (!def) {
      currentId = null;
      setActiveNav(null);
      rootEl.dataset.state = "error";
      rootEl.innerHTML = "";
      rootEl.appendChild(errorState({ label: "That page" }, new Error(`No CRM module named "${id}".`), { title: "Module not found", id: "dashboard" }));
      notifySettled();
      return;
    }
    currentId = id;
    setActiveNav(id);
    const started = performance.now();
    rootEl.dataset.state = "loading";
    rootEl.innerHTML = "";
    rootEl.appendChild(loadShell(def));
    document.title = `${def.label} · Business CRM`;
    try {
      const ctx = {
        id: def.id,
        def,
        params: params || [],
        moduleList: Array.from(modules.values()).filter(m => m.id !== "selftest"),
        env: envInfo(),
        store: (window.CRM && window.CRM.store) || null,
        navigate: go
      };
      const content = def.render ? await def.render(ctx) : null;
      if (gen !== navGeneration) { notifySettled(); return; }
      const wait = Math.max(0, MIN_LOAD_MS - (performance.now() - started));
      if (wait > 0) await sleep(wait);
      if (gen !== navGeneration) { notifySettled(); return; }
      rootEl.innerHTML = "";
      rootEl.appendChild(pageShell(def));
      rootEl.querySelector(".page-body").appendChild(content || emptyState(def));
      rootEl.dataset.state = "ready";
    } catch (err) {
      console.error(`CRM module "${def.id}" failed to render:`, err);
      if (gen !== navGeneration) { notifySettled(); return; }
      rootEl.dataset.state = "error";
      rootEl.innerHTML = "";
      rootEl.appendChild(errorState(def, err, { title: `Couldn't load ${def.label}`, id: def.id }));
    }
    notifySettled();
  }

  function parseRoute(hash) {
    let h = (hash || "").replace(/^#/, "").replace(/^\/+/, "");
    if (!h) return { id: "dashboard", params: [] };
    const parts = h.split("/").filter(Boolean);
    return { id: parts[0].toLowerCase(), params: parts.slice(1) };
  }

  function go(id, params) {
    params = params || [];
    const targetHash = "#/" + [id].concat(params).join("/");
    try { history.replaceState(null, "", targetHash); } catch (e) {}
    const key = routeKey(id, params);
    if (key !== lastKey || rootEl.dataset.state === "error") {
      renderRoute(id, params);
      return new Promise(resolve => settleWaiters.push(resolve));
    }
    return Promise.resolve();
  }

  window.addEventListener("hashchange", () => {
    const { id, params } = parseRoute(location.hash);
    if (routeKey(id, params) !== lastKey) renderRoute(id, params);
  });

  async function runSelftests() {
    await window.SELFTEST.run();
    go("selftest");
  }

  function selftestBadgeMarkup(st) {
    if (!st) return '<span class="st-badge idle">Never run</span>';
    const fail = st.filter(r => !r.pass && !r.skip).length;
    return fail === 0
      ? '<span class="st-badge pass">All self-tests passing</span>'
      : `<span class="st-badge fail">${fail} failing</span>`;
  }

  function renderSelftestReport(ctx) {
    const wrap = document.createElement("div");
    const st = window.SELFTEST.lastResults;
    const pass = st ? st.filter(r => r.pass && !r.skip).length : 0;
    const skip = st ? st.filter(r => r.skip).length : 0;
    const fail = st ? st.filter(r => !r.pass && !r.skip).length : 0;
    const rows = st ? st.map(r => `
      <div class="st-row">
        <span class="st-chip ${r.skip ? "skip" : r.pass ? "pass" : "fail"}">${r.skip ? "skipped" : r.pass ? "pass" : "fail"}</span>
        <div style="min-width:0">
          <div class="st-name">${esc(r.name)}</div>
          ${r.detail ? `<div class="st-detail">${esc(r.detail)}</div>` : ""}
        </div>
        <span style="margin-left:auto;flex:none;font-size:11px;color:var(--muted)">${r.ms}ms</span>
      </div>`).join("") : "";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-title-row">
        <h2>Results</h2>
        <div class="st-summary" style="margin-top:0">
          ${selftestBadgeMarkup(st)}
          ${st ? `<span class="st-badge pass">${pass} passed</span>` : ""}
          ${fail ? `<span class="st-badge fail">${fail} failed</span>` : ""}
          ${skip ? `<span class="st-badge skip">${skip} skipped</span>` : ""}
        </div>
      </div>
      ${st ? `<div class="st-list">${rows}</div>` : '<p class="hint">Self-tests have not been run in this session yet.</p>'}
      <div style="margin-top:16px"><button class="btn btn-primary btn-sm" id="stRunBtn">${st ? "Run again" : "Run self-tests"}</button></div>`;
    card.querySelector("#stRunBtn").addEventListener("click", () => window.CRM.runSelftests());
    wrap.appendChild(card);
    return wrap;
  }

  function setupFooter() {
    const btn = document.getElementById("selftestBtn");
    if (btn) btn.addEventListener("click", () => window.CRM.runSelftests());
  }

  function setupEnvPill() {
    const env = envInfo();
    const dot = document.getElementById("envDot");
    const text = document.getElementById("envText");
    const pill = document.getElementById("envPill");
    dot.classList.toggle("ok", env.ok);
    dot.classList.toggle("unsaved", !env.ok);
    text.textContent = env.label;
    pill.title = env.unsaved
      ? "This workspace is not published yet — data will be stored under the generator name once you save."
      : "Business CRM workspace. Rename the generator in settings to rebrand.";
  }

  window.CRM = {
    modules,
    get current() { return currentId; },
    go,
    rerender() {
      const { id, params } = parseRoute(location.hash);
      return renderRoute(id, params);
    },
    ready() {
      return new Promise(resolve => {
        if (rootEl.dataset.state !== "loading") resolve();
        else settleWaiters.push(resolve);
      });
    },
    addModule(def) {
      modules.set(def.id, Object.assign({}, def));
      buildSideNav();
    },
    removeModule(id) {
      modules.delete(id);
      buildSideNav();
      if (currentId === id) go("dashboard");
    },
    runSelftests,
    toast(msg) {
      const ctn = document.querySelector(".toast-ctn") || (() => {
        const c = document.createElement("div");
        c.className = "toast-ctn";
        document.body.appendChild(c);
        return c;
      })();
      const t = document.createElement("div");
      t.className = "toast";
      t.textContent = msg;
      ctn.appendChild(t);
      setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2600);
      setTimeout(() => t.remove(), 3000);
    }
  };

  buildSideNav();
  setupFooter();
  setupEnvPill();
  try {
    if (window.BcrmStore) {
      const store = window.BcrmStore.createDefault({ modules: STORE_MODULES });
      window.CRM.store = store;
      window.CRM.storeReady = store.ready().catch(err => ({ ok: false, code: "boot_failed", detail: (err && err.message) || String(err) }));
      (window.CRM_BOOT_HOOKS || []).forEach(fn => {
        try { fn(store); } catch (e) { console.error("CRM boot hook failed:", e); }
      });
    }
  } catch (err) {
    window.CRM.store = null;
    window.CRM.storeReady = Promise.resolve(null);
    console.error("Document store failed to initialise:", err);
  }
  applyDrawer();
  const initial = parseRoute(location.hash);
  renderRoute(initial.id, initial.params);
})();
