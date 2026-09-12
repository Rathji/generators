(function () {
  const APP = "quote-u";
  const rootEl = document.getElementById("viewRoot");
  const sideNav = document.getElementById("sideNav");
  const layout = document.getElementById("layout");
  const sidebarEl = document.getElementById("sidebar");
  const navToggleBtn = document.getElementById("navToggleBtn");
  const navBackdrop = document.getElementById("navBackdrop");

  const modules = new Map();
  (window.QU_MODULES || []).forEach(def => modules.set(def.id, Object.assign({}, def)));
  const renderers = window.QU_RENDERERS || {};
  Object.keys(renderers).forEach(id => {
    const def = modules.get(id);
    if (def) def.render = renderers[id];
  });

  modules.set("selftest", {
    id: "selftest",
    label: "Self-tests",
    tagline: "Automated checks for the application shell",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16"/><path d="M8 3v4l-3.5 9A2 2 0 0 0 6.3 20h11.4a2 2 0 0 0 1.8-4L16 7V3"/></svg>',
    render: renderSelftestReport
  });

  const DEFAULT_STATION = "quotes";

  // The entity documents of the quoting system of record. The store is seeded
  // from the same list it was built with, so a new entity just needs adding in
  // src/store.js (QU_ENTITIES).
  const STORE_MODULES = (window.QU_STORE && window.QU_STORE.DEFAULT_MODULES) || [];

  let currentId = null;
  let lastKey = null;
  let navGeneration = 0;
  let settleWaiters = [];
  let auditService = null;
  let numberingService = null;
  let connectorGateway = null;
  let quoteService = null;
  let catalogService = null;
  let priceSnapshotService = null;
  let versionService = null;
  let portalTokenService = null;
  let portalEventService = null;
  let approvalService = null;
  let recomputeService = null;
  let outboxService = null;
  let oppSyncService = null;
  let oppNoteService = null;
  let revenueService = null;
  let invoiceIntentService = null;
  let invoiceDirectService = null;
  let invoicePsaService = null;
  let invoiceMappingService = null;
  let invoicePathRouter = null;
  let distributorService = null;
  let pricingService = null;
  let reconciliationService = null;
  let featureService = null;
  let gatedService = null;
  let contentService = null;
  let mailService = null;
  let fieldMapService = null;
  let busService = null;
  let sendService = null;
  let esignService = null;
  let artifactService = null;
  let bundleService = null;
  let advisoryService = null;
  let migrateService = null;
  let prospectService = null;
  let reportsService = null;
  let quoteReadService = null;
  let analyticsService = null;
  let legacyService = null;
  let integrityService = null;
  let observabilityService = null;
  let verificationService = null;
  let roleService = null;
  let hubService = null;
  let versionSocket = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Task 45: the transport the content connector uses for its free/open sources.
  // superFetch (when present) proxies the request so the free APIs' CORS policy
  // never blocks the generator; plain fetch is the fallback.
  function contentTransport(url) {
    const sf = window.root && window.root.superFetch;
    if (typeof sf === "function") {
      return Promise.resolve(sf(url)).then(r => (r && typeof r.text === "function" ? r.text() : r));
    }
    return fetch(url).then(r => r.text());
  }

  // Task 46: declare a connector's allowlist for the gateway manifest — every
  // function with its effect (read|write), the gateway key NAME it uses (never a
  // credential) and the roles permitted to call it. The declared set is the
  // allowlist: an adapter function that is not declared is refused.
  function declareConnector(manifest, gateway, name, opts) {
    opts = opts || {};
    const connector = gateway && gateway.connectors ? gateway.connectors[name] : null;
    if (!connector) return;
    const functions = {};
    Object.keys(connector.functions || {}).forEach(fn => {
      const kind = window.QU_FEATURES && typeof window.QU_FEATURES.classify === "function"
        ? window.QU_FEATURES.classify(name, fn).kind
        : "write";
      functions[fn] = { effect: kind };
    });
    const d = connector.descriptor || {};
    manifest[name] = {
      label: d.label || connector.label || connector.name || name,
      kind: opts.kind || d.kind || (connector.readOnly ? "read" : "mixed"),
      gateway_key: opts.key !== undefined ? opts.key : (d.gateway_key || null),
      roles: opts.roles !== undefined ? opts.roles : (Array.isArray(d.roles) ? d.roles : null),
      functions: functions
    };
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
    const html = ['<p class="side-label">Stations</p>'];
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

  function applyDrawer() {
    // The off-canvas drawer is driven by CSS media queries. Never set an inline
    // transform here: inline styles outrank the media query, so a shell that
    // loads narrow (or a viewport that later grows) would leave the sidebar
    // permanently translated off-screen on desktop.
    sidebarEl.style.transform = "";
  }

  function openDrawer() {
    layout.classList.add("drawer-open");
    navToggleBtn.setAttribute("aria-expanded", "true");
    navToggleBtn.setAttribute("aria-label", "Close station navigation");
    applyDrawer();
  }
  function closeDrawer() {
    layout.classList.remove("drawer-open");
    navToggleBtn.setAttribute("aria-expanded", "false");
    navToggleBtn.setAttribute("aria-label", "Open station navigation");
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
    card.querySelector(".state-msg").textContent = empty.message || `The ${def.label.toLowerCase()} station has no records yet.`;
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
    home.textContent = "Go to Quotes";
    home.addEventListener("click", () => go(DEFAULT_STATION));
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
    if (id === "q") {
      await renderPortalRoute(params, gen);
      notifySettled();
      return;
    }
    document.body.classList.remove("portal-mode");
    const def = modules.get(id);
    if (!def) {
      currentId = null;
      setActiveNav(null);
      rootEl.dataset.state = "error";
      rootEl.innerHTML = "";
      rootEl.appendChild(errorState({ label: "That page" }, new Error(`No ${APP} station named "${id}".`), { title: "Station not found", id: DEFAULT_STATION }));
      notifySettled();
      return;
    }
    currentId = id;
    setActiveNav(id);
    const started = performance.now();
    rootEl.dataset.state = "loading";
    rootEl.innerHTML = "";
    rootEl.appendChild(loadShell(def));
    document.title = `${def.label} · ${APP}`;
    try {
      const ctx = {
        id: def.id,
        def,
        params: params || [],
        moduleList: Array.from(modules.values()).filter(m => m.id !== "selftest"),
        env: envInfo(),
        store: (window.QU && window.QU.store) || null,
        navigate: go
      };
      const content = def.render ? await def.render(ctx) : null;
      if (gen !== navGeneration) return;
      const wait = Math.max(0, MIN_LOAD_MS - (performance.now() - started));
      if (wait > 0) await sleep(wait);
      if (gen !== navGeneration) return;
      rootEl.innerHTML = "";
      rootEl.appendChild(pageShell(def));
      rootEl.querySelector(".page-body").appendChild(content || emptyState(def));
      rootEl.dataset.state = "ready";
    } catch (err) {
      console.error(`${APP} station "${def.id}" failed to render:`, err);
      if (gen !== navGeneration) return;
      rootEl.dataset.state = "error";
      rootEl.innerHTML = "";
      rootEl.appendChild(errorState(def, err, { title: `Couldn't load ${def.label}`, id: def.id }));
    }
    notifySettled();
  }

  // The standalone, tokenized client portal at #/q/<secret>. It deliberately
  // renders OUTSIDE the internal station shell (no sidebar, no station chrome)
  // and delegates the actual page to QU_PORTALPAGE, which talks to the portal
  // API (QU.portal.handle). Default-deny: a missing/garbage secret simply
  // produces the "link isn't valid" state from the API's 404.
  async function renderPortalRoute(params, gen) {
    document.body.classList.add("portal-mode");
    currentId = "q";
    setActiveNav(null);
    document.title = "Your quote · " + APP;
    rootEl.dataset.state = "loading";
    rootEl.innerHTML = "";
    rootEl.appendChild(loadShell({ label: "Your quote" }));
    let secret = "";
    try { secret = params && params.length ? decodeURIComponent(params.join("/")) : ""; }
    catch (e) { secret = params ? params.join("/") : ""; }
    try {
      let content;
      if (window.QU_PORTALPAGE && typeof window.QU_PORTALPAGE.render === "function") {
        content = await window.QU_PORTALPAGE.render({ secret, api: window.QU && window.QU.portal });
      } else {
        content = errorState({ label: "Portal" }, new Error("The portal page is not loaded."), { title: "Portal unavailable", id: DEFAULT_STATION });
      }
      if (gen !== navGeneration) return;
      rootEl.innerHTML = "";
      rootEl.appendChild(content);
      rootEl.dataset.state = "ready";
    } catch (err) {
      console.error("quote-u portal route failed:", err);
      if (gen !== navGeneration) return;
      rootEl.dataset.state = "error";
      rootEl.innerHTML = "";
      rootEl.appendChild(errorState({ label: "Portal" }, err, { title: "Couldn't open the portal", id: DEFAULT_STATION }));
    }
  }

  function parseRoute(hash) {
    let h = (hash || "").replace(/^#/, "").replace(/^\/+/, "");
    if (!h) return { id: DEFAULT_STATION, params: [] };
    const parts = h.split("/").filter(Boolean);
    const id = parts[0].toLowerCase();
    // #/q/<secret> is the tokenized client portal — a standalone, chrome-less
    // route (roadmap task 23), not an internal station.
    if (id === "q") return { id: "q", params: parts.slice(1), portal: true };
    return { id, params: parts.slice(1) };
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
    await window.QU_SELFTEST.run();
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
    const st = window.QU_SELFTEST.lastResults;
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
    card.querySelector("#stRunBtn").addEventListener("click", () => window.QU.runSelftests());
    wrap.appendChild(card);
    return wrap;
  }

  function setupFooter() {
    const btn = document.getElementById("selftestBtn");
    if (btn) btn.addEventListener("click", () => window.QU.runSelftests());
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
      : "quote-u workspace. Rename the generator in settings to rebrand.";
  }

  // The version freeze registry and the portal-token registry are kept
  // authoritatively by the server plugin (a copy the client cannot rewrite).
  // Connecting is best-effort: with no socket each service still works locally
  // and marks its authority "local"; a connected server that refuses wins.
  let serverCallPromise = null;
  function getServerCall() {
    if (!serverCallPromise) {
      serverCallPromise = (async () => {
        if (!window.root || typeof window.root.createServerSocket !== "function") return null;
        try {
          const sock = window.root.createServerSocket();
          await sock.opened;
          const asText = r => (typeof r === "string" ? r : new TextDecoder().decode(r));
          versionSocket = sock;
          return async (name, obj) => JSON.parse(asText(await sock.rpc[name](obj === undefined ? "" : JSON.stringify(obj))));
        } catch (e) {
          return null;
        }
      })();
    }
    return serverCallPromise;
  }

  async function attachVersionServer(svc) {
    const call = await getServerCall();
    if (!call) return;
    try {
      if (typeof svc.attachServerCheck === "function") svc.attachServerCheck(req => call("immutabilityCheck", req));
      if (typeof svc.attachServerRegister === "function") svc.attachServerRegister(req => call("freezeRegister", req));
      if (typeof svc.attachServerVerify === "function") svc.attachServerVerify(req => call("frozenVerify", req));
    } catch (e) {
      // No authoritative server available — the local seal remains the backstop.
    }
  }

  async function attachTokenServer(svc) {
    const call = await getServerCall();
    if (!call || !svc || typeof svc.attachServer !== "function") return;
    try {
      svc.attachServer({
        register: req => call("tokenRegister", req),
        verify: req => call("tokenVerify", req),
        revoke: req => call("tokenRevoke", req),
        markUsed: req => call("tokenMarkUsed", req)
      });
    } catch (e) {
      // The document remains the system of record without the server.
    }
  }

  // The lifecycle transition table lives in QU_LIFECYCLE on the client and in
  // the server plugin (roadmap task 5). Attaching the server validator makes
  // every portal approve/decline/expire transition authoritative: a server
  // refusal wins, and an unreachable server degrades to a marked-local result.
  async function attachLifecycleServer() {
    const call = await getServerCall();
    if (!call || !window.QU_LIFECYCLE || typeof window.QU_LIFECYCLE.attachServerValidator !== "function") return;
    try { window.QU_LIFECYCLE.attachServerValidator(req => call("lifecycleValidate", req)); }
    catch (e) { /* the local table remains the fallback */ }
  }

  window.QU = {
    modules,
    get money() { return window.QU_MONEY || null; },
    get totals() { return window.QU_TOTALS || null; },
    get lineitems() { return window.QU_LINEITEMS || null; },
    get optiongroups() { return window.QU_OPTIONGROUPS || null; },
    get catalog() { return catalogService; },
    get priceSnapshots() { return priceSnapshotService; },
    get lifecycle() { return window.QU_LIFECYCLE || null; },
    get versions() { return versionService; },
    get portalTokens() { return portalTokenService; },
    get portalEvents() { return portalEventService; },
    get approvals() { return approvalService; },
    get recompute() { return recomputeService; },
    get outbox() { return outboxService; },
    get oppSync() { return oppSyncService; },
    get oppNote() { return oppNoteService; },
    get revenue() { return revenueService; },
    get invoiceIntents() { return invoiceIntentService; },
    get invoiceDirect() { return invoiceDirectService; },
    get invoicePsa() { return invoicePsaService; },
    get invoiceMapping() { return invoiceMappingService; },
    get invoicePaths() { return invoicePathRouter; },
    get distributors() { return distributorService; },
    get pricing() { return pricingService; },
    get reconciliation() { return reconciliationService; },
    get features() { return featureService; },
    get gated() { return gatedService; },
    get content() { return contentService; },
    get mail() { return mailService; },
    get fieldMaps() { return fieldMapService; },
    get secrets() { return window.QU_SECRETS || null; },
    get bus() { return busService; },
    get send() { return sendService; },
    get esign() { return esignService; },
    get artifacts() { return artifactService; },
    get bundles() { return bundleService; },
    get advisory() { return advisoryService; },
    get migrate() { return migrateService; },
    get prospect() { return prospectService; },
    get reports() { return reportsService; },
    get quoteRead() { return quoteReadService; },
    get analytics() { return analyticsService; },
    get legacy() { return legacyService; },
    get integrity() { return integrityService; },
    get observability() { return observabilityService; },
    get verification() { return verificationService; },
    get roles() { return roleService; },
    get hub() { return hubService; },
    get audit() { return auditService; },
    get numbering() { return numberingService; },
    get gateway() { return connectorGateway; },
    get quotes() { return quoteService; },
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
      if (currentId === id) go(DEFAULT_STATION);
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
  window.QU.store = null;
  window.QU.storeReady = Promise.resolve(null);
  try {
    if (window.QU_STORE) {
      const store = window.QU_STORE.createDefault({ modules: STORE_MODULES });
      window.QU.store = store;
      window.QU.storeReady = store.ready().catch(err => ({ ok: false, code: "boot_failed", detail: (err && err.message) || String(err) }));
      (window.QU_BOOT_HOOKS || []).forEach(fn => {
        try { fn(store, window.QU); } catch (e) { console.error("quote-u boot hook failed:", e); }
      });
      if (window.QU_AUDIT) {
        auditService = window.QU_AUDIT.createService({ store });
        window.QU.auditReady = auditService.ready().catch(err => ({ ok: false, code: "audit_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 68: the internal role & access model. Built before the connector
      // gateway so the gateway can be wrapped with the authenticated identity,
      // and its storage guards are installed immediately so a write that bypasses
      // the UI is refused at the store boundary (fail-closed). The default local
      // identity is the policy's default role (owner).
      if (window.QU_ROLES) {
        roleService = window.QU_ROLES.createService({
          store,
          policy: (window.root && window.root.quoteRolePolicy) || null,
          scope: (window.root && window.root.quoteAccessScope) || "*"
        });
        roleService.registerGuards(store);
        window.QU.rolesReady = Promise.resolve({ ok: true, role: roleService.current().role });
        // Task 70: attribute every internal audit record to the AUTHENTICATED hub
        // member. Installed BEFORE the bus wrapper below, so the bus publishes the
        // corrected actor. A signed-out (local) user keeps the caller's actor.
        if (auditService && typeof auditService.append === "function") {
          const appendAudit = auditService.append.bind(auditService);
          auditService.append = async (input) => {
            try {
              const id = roleService.current();
              if (input && input.actor_type === "internal" && id && id.source === "hub" && id.name) {
                input = Object.assign({}, input, { actor: id.name });
              }
            } catch (e) {}
            return appendAudit(input);
          };
        }
      }
      // Tasks 69–70: the optional realtime hub. It authenticates to the
      // authoritative server, streams document changes and presence between open
      // sessions, and reports each write attributed to the real member. Without
      // it everything still works locally (it degrades to polling).
      if (window.QU_HUB) {
        hubService = window.QU_HUB.createService({
          store,
          roles: roleService,
          audit: auditService,
          kv: (window.root && window.root.kv && window.root.kv.qu) || null,
          policy: (window.root && window.root.quoteRolePolicy) || null
        });
        window.QU.hubReady = hubService.boot(store)
          .catch(err => ({ ok: false, code: "hub_boot_failed", detail: (err && err.message) || String(err) }));
      }
      if (window.QU_NUMBERING) {
        const cfg = (window.root && window.root.quoteNumberScheme) || null;
        numberingService = window.QU_NUMBERING.createService({ store, scheme: cfg && cfg.pattern ? cfg : undefined });
        window.QU.numberingReady = numberingService.ready().catch(err => ({ ok: false, code: "numbering_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 38: the operational flags + data-mode guard. It wraps the connector
      // gateway so every external call is checked at one boundary (kill switch,
      // per-feature write flags, and the live/mock/lockdown data mode).
      if (window.QU_FEATURES) {
        featureService = window.QU_FEATURES.createService({
          store,
          policy: (window.root && window.root.quoteFeaturePolicy) || null,
          actor: "admin"
        });
        window.QU.featuresReady = featureService.ready()
          .catch(err => ({ ok: false, code: "features_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 37: the admin company↔customer / product↔PSA-catalog mappings.
      if (window.QU_INVOICEMAPPING) {
        invoiceMappingService = window.QU_INVOICEMAPPING.createService({
          store,
          policy: (window.root && window.root.quoteInvoicePolicy) || null
        });
        window.QU.invoiceMappingReady = invoiceMappingService.ready()
          .catch(err => ({ ok: false, code: "invoice_mapping_boot_failed", detail: (err && err.message) || String(err) }));
      }
      if (window.QU_CONNECTORS && window.QU_QUOTES) {
        // Task 46: the gateway manifest + identity roles. The gateway holds only
        // KEY NAMES (never credentials) and role assignments; a live connector
        // resolves its credential from the host keystore (window.QU_KEYSTORE).
        const gwPolicy = (window.root && window.root.quoteGatewayPolicy) || {};
        const gwKeys = gwPolicy.gateway_keys || {};
        const manifest = {};
        // Task 48: the send-as-rep permission gate. The mail connector calls it
        // before any delivery; the permission service itself is built just below
        // (once the rep directory is readable), so a mutable holder bridges them.
        const mailGuard = { authorize: null };
        const baseGateway = window.QU_CONNECTORS.createDefault({
          manifest,
          roles: gwPolicy.roles || null,
          keystore: window.QU_KEYSTORE || null,
          mailOpts: { authorize: o => (mailGuard.authorize ? mailGuard.authorize(o) : { ok: true }) }
        });
        // Tasks 40–41: the read-only distributor connectors. They are mock by
        // default (live:false) so the app runs end-to-end without credentials;
        // a live transport is supplied from the fleet secret store. They are
        // registered BEFORE the gateway is wrapped so the feature/data-mode
        // guard covers distributor reads too.
        if (window.QU_DISTRIBUTORA && window.QU_DISTRIBUTORB) {
          baseGateway.register(window.QU_DISTRIBUTORA.NAME, window.QU_DISTRIBUTORA.create());
          baseGateway.register(window.QU_DISTRIBUTORB.NAME, window.QU_DISTRIBUTORB.create());
        }
        // Task 45: the pluggable product-content connector — the free/open
        // sources (Wikidata, Open Food Facts) reached through the gateway like
        // every other cross-system read.
        if (window.QU_CONTENT && typeof window.QU_CONTENT.createConnector === "function") {
          baseGateway.register(window.QU_CONTENT.CONNECTOR, window.QU_CONTENT.createConnector({ transport: contentTransport, live: true }));
        }
        // Task 59: the read-only quote connector. Its functions delegate to a
        // service built after the quote/version/approval services exist (boot is
        // synchronous and no call happens before then), so a holder bridges them.
        if (window.QU_QUOTEREAD && typeof window.QU_QUOTEREAD.createConnector === "function") {
          const readHolder = {
            search: (q, f) => (quoteReadService ? quoteReadService.search(q, f) : { ok: false, code: "not_ready", detail: "The read-only quote API is still starting." }),
            getQuote: (id) => (quoteReadService ? quoteReadService.getQuote(id) : { ok: false, code: "not_ready", detail: "The read-only quote API is still starting." }),
            getQuoteEvents: (id, f) => (quoteReadService ? quoteReadService.getQuoteEvents(id, f) : { ok: false, code: "not_ready", detail: "The read-only quote API is still starting." })
          };
          baseGateway.register(window.QU_QUOTEREAD.CONNECTOR, window.QU_QUOTEREAD.createConnector({ service: readHolder }));
        }
        // Declare each connector's allowlist, key NAME and permitted roles.
        declareConnector(manifest, baseGateway, "psa", { kind: "mixed", key: null, roles: ["owner", "manager"] });
        declareConnector(manifest, baseGateway, "mail", { kind: "mixed", key: null, roles: ["owner", "manager"] });
        declareConnector(manifest, baseGateway, "accounting", { kind: "mixed", key: null, roles: ["owner", "manager"] });
        declareConnector(manifest, baseGateway, window.QU_DISTRIBUTORA ? window.QU_DISTRIBUTORA.NAME : "distributor_a", { kind: "read", key: gwKeys.distributor_a, roles: null });
        declareConnector(manifest, baseGateway, window.QU_DISTRIBUTORB ? window.QU_DISTRIBUTORB.NAME : "distributor_b", { kind: "read", key: gwKeys.distributor_b, roles: null });
        declareConnector(manifest, baseGateway, window.QU_CONTENT ? window.QU_CONTENT.CONNECTOR : "content", { kind: "read", key: null, roles: ["owner", "manager", "viewer"] });
        declareConnector(manifest, baseGateway, window.QU_QUOTEREAD ? window.QU_QUOTEREAD.CONNECTOR : "quoteread", { kind: "read", key: null, roles: ["owner", "manager", "viewer"] });
        declareConnector(manifest, baseGateway, "bus", { kind: "mixed", key: null, roles: ["owner", "manager"] });
        // Task 48: the mail send-as-rep permission, built over the mail
        // connector's rep directory (actor → own mailbox → group). The connector
        // now calls `mailGuard.authorize` before delivering anything.
        if (window.QU_MAIL) {
          const repsRes = baseGateway.call("mail", "listReps", {}, { scope: "*" });
          const reps = repsRes && repsRes.ok && Array.isArray(repsRes.result)
            ? repsRes.result.map(r => ({ actor: r.id, name: r.name, mailbox: r.mailbox, group: r.group }))
            : null;
          mailService = window.QU_MAIL.createService({
            store,
            directory: reps,
            policy: (window.root && window.root.quoteMailPolicy) || null,
            audit: auditService
          });
          mailGuard.authorize = o => mailService.authorize(o);
          window.QU.mailReady = mailService.ready()
            .catch(err => ({ ok: false, code: "mail_permission_boot_failed", detail: (err && err.message) || String(err) }));
        }
        // Task 49: the external field-map registry (declarations derived from the
        // shared distributor SCHEMA) and its capture-verification gate.
        if (window.QU_FIELDMAPS) {
          fieldMapService = window.QU_FIELDMAPS.createService({});
          window.QU.fieldMapsReady = fieldMapService.ready()
            .catch(err => ({ ok: false, code: "field_maps_boot_failed", detail: (err && err.message) || String(err) }));
        }
        const featureWrapped = featureService && typeof featureService.wrap === "function"
          ? featureService.wrap(baseGateway)
          : baseGateway;
        // Task 47: every external WRITE is gated — it must be approved by the
        // write policy and carry an explicit confirmation. The gate wraps the
        // feature/data-mode-guarded gateway, so a write is checked at both
        // boundaries and a read passes straight through.
        if (window.QU_GATED) {
          gatedService = window.QU_GATED.createService({
            store,
            gateway: featureWrapped,
            policy: (window.root && window.root.quoteWritePolicy) || null,
            actor: "admin"
          });
          window.QU.gatedReady = gatedService.ready()
            .catch(err => ({ ok: false, code: "gated_boot_failed", detail: (err && err.message) || String(err) }));
          connectorGateway = gatedService.wrap(featureWrapped);
        } else {
          connectorGateway = featureWrapped;
        }
        // Task 68: inject the AUTHENTICATED role + account scope into every
        // outbound connector call, so the gateway's own role allowlist enforces
        // reads vs writes for the real identity — a viewer cannot drive an
        // external write, and the caller cannot pass its own role.
        if (roleService && typeof roleService.wrapGateway === "function") {
          connectorGateway = roleService.wrapGateway(connectorGateway);
        }
        const scope = (window.root && window.root.quoteAccessScope) || "*";
        quoteService = window.QU_QUOTES.createService({ store, gateway: connectorGateway, numbering: numberingService, audit: auditService, scope });
        // Task 40: the distributor service the builder uses to compare sources
        // and capture an immutable price snapshot.
        if (window.QU_DISTRIBUTORS) {
          distributorService = window.QU_DISTRIBUTORS.createService({
            gateway: connectorGateway,
            names: [
              window.QU_DISTRIBUTORA ? window.QU_DISTRIBUTORA.NAME : "distributor_a",
              window.QU_DISTRIBUTORB ? window.QU_DISTRIBUTORB.NAME : "distributor_b"
            ],
            priceSnapshots: priceSnapshotService
          });
          window.QU.distributorsReady = Promise.resolve({ ok: true });
        }
      }
      if (window.QU_CATALOG) {
        catalogService = window.QU_CATALOG.createService({ store });
        // Install the bundled pipeline catalog exactly once, after the store has
        // loaded. Seeding is non-fatal: a failed seed still leaves a usable
        // (if empty) catalog and surfaces through QU.catalogReady.
        window.QU.catalogReady = window.QU.storeReady
          .then(() => catalogService.seedIfEmpty((window.root && window.root.catalogSeed) || []))
          .catch(err => ({ ok: false, code: "catalog_seed_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 45: the pluggable product content service — registers the free/open
      // providers and resolves enrichment for a catalog item through the gateway.
      if (window.QU_CONTENT && connectorGateway) {
        contentService = window.QU_CONTENT.createService({ catalog: catalogService, gateway: connectorGateway });
        window.QU.contentReady = Promise.resolve({ ok: true, providers: contentService.providers() });
      }
      // Task 50: the pipeline bus — quote/approval events are published in the
      // versioned envelope to the `bus-quote-events` stream and fanned out to
      // the outbound webhook, through the same wrapped gateway. The audit log is
      // wrapped so a publishable event is emitted as it is recorded.
      if (window.QU_BUS && connectorGateway) {
        busService = window.QU_BUS.createService({
          store,
          gateway: connectorGateway,
          audit: auditService,
          policy: (window.root && window.root.quoteBusPolicy) || null,
          generatorName: (window.root && window.root.generatorName) || window.generatorName || null
        });
        window.QU.busReady = busService.ready()
          .catch(err => ({ ok: false, code: "bus_boot_failed", detail: (err && err.message) || String(err) }));
        if (auditService && typeof auditService.append === "function") {
          const appendAudit = auditService.append.bind(auditService);
          auditService.append = async (input) => {
            const res = await appendAudit(input);
            try {
              if (busService && res && res.ok !== false && window.QU_BUS.isPublishable(res.record || input)) {
                busService.publish(res.record || input).catch(() => {});
              }
            } catch (e) {}
            return res;
          };
        }
      }
      if (window.QU_PRICESNAPSHOTS) {
        priceSnapshotService = window.QU_PRICESNAPSHOTS.createService({ store });
        window.QU.priceSnapshotsReady = priceSnapshotService.ready()
          .catch(err => ({ ok: false, code: "price_snapshots_boot_failed", detail: (err && err.message) || String(err) }));
      }
      if (window.QU_VERSIONS) {
        versionService = window.QU_VERSIONS.createService({ store, audit: auditService, priceSnapshots: priceSnapshotService });
        window.QU.versionReady = versionService.ready()
          .catch(err => ({ ok: false, code: "versions_boot_failed", detail: (err && err.message) || String(err) }));
        attachVersionServer(versionService);
      }
      // Tasks 42–44: the distributor pricing service — one action to search the
      // sources, pick an offer, capture its price as an immutable snapshot and
      // add the snapshot-priced line to the version.
      if (window.QU_PRICING && versionService) {
        pricingService = window.QU_PRICING.createService({
          versions: versionService,
          distributors: distributorService,
          policy: (window.root && window.root.quoteDistributorPolicy) || null
        });
        window.QU.pricingReady = pricingService.ready()
          .catch(err => ({ ok: false, code: "pricing_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 29: the authoritative approval recompute (frozen data only).
      if (window.QU_RECOMPUTE) {
        recomputeService = window.QU_RECOMPUTE.createService({ versions: versionService, optionGroups: window.QU_OPTIONGROUPS || null, totals: window.QU_TOTALS || null });
      }
      // Task 54: the bundle cost-composition / margin roll-up (internal only).
      if (window.QU_BUNDLES) {
        bundleService = window.QU_BUNDLES.createService({ versions: versionService, optionGroups: window.QU_OPTIONGROUPS || null });
        window.QU.bundlesReady = Promise.resolve({ ok: true });
      }
      attachLifecycleServer();
      if (window.QU_PORTALTOKENS) {
        portalTokenService = window.QU_PORTALTOKENS.createService({ store });
        window.QU.portalTokensReady = portalTokenService.ready()
          .catch(err => ({ ok: false, code: "portal_tokens_boot_failed", detail: (err && err.message) || String(err) }));
        attachTokenServer(portalTokenService);
      }
      // Portal event capture (task 26) and the acceptance record (task 28).
      if (window.QU_PORTALEVENTS) {
        portalEventService = window.QU_PORTALEVENTS.createService({ audit: auditService });
      }
      if (window.QU_APPROVALS) {
        approvalService = window.QU_APPROVALS.createService({ store });
        window.QU.approvalsReady = approvalService.ready()
          .catch(err => ({ ok: false, code: "approvals_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Tasks 51–52: the typed-name e-signature gate (a scope sign-off in the
      // `esignature` document enables it) and the immutable acceptance-artifact
      // store. Task 56: the deprecation migration over the live data set.
      if (window.QU_ESIGN) {
        esignService = window.QU_ESIGN.createService({ store, policy: (window.root && window.root.quoteSignaturePolicy) || null });
        window.QU.esignReady = esignService.ready()
          .catch(err => ({ ok: false, code: "esign_boot_failed", detail: (err && err.message) || String(err) }));
      }
      if (window.QU_ARTIFACTS) {
        artifactService = window.QU_ARTIFACTS.createService({ store });
        window.QU.artifactsReady = artifactService.ready()
          .catch(err => ({ ok: false, code: "artifacts_boot_failed", detail: (err && err.message) || String(err) }));
      }
      if (window.QU_MIGRATE) {
        migrateService = window.QU_MIGRATE.createService({ store, audit: auditService });
        window.QU.migrateReady = migrateService.ready()
          .catch(err => ({ ok: false, code: "migrate_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Tasks 30–31: the idempotent side-effect outbox, plus the opportunity
      // sync that registers the `opp_update` handler and enqueues the gated,
      // audited deal update when a quote is approved.
      if (window.QU_OUTBOX) {
        const approvalPolicy = (window.root && window.root.quoteApprovalPolicy) || null;
        outboxService = window.QU_OUTBOX.createService({
          store,
          maxAttempts: approvalPolicy && approvalPolicy.max_attempts,
          baseBackoffMs: approvalPolicy && approvalPolicy.base_backoff_ms,
          maxBackoffMs: approvalPolicy && approvalPolicy.max_backoff_ms
        });
        window.QU.outboxReady = outboxService.ready()
          .catch(err => ({ ok: false, code: "outbox_boot_failed", detail: (err && err.message) || String(err) }));
        if (window.QU_OPPSYNC && connectorGateway && quoteService) {
          oppSyncService = window.QU_OPPSYNC.createService({ outbox: outboxService, gateway: connectorGateway, quotes: quoteService, audit: auditService, policy: approvalPolicy, scope: "*" });
        }
        // Tasks 32–33: the products/costs/part-numbers note and the
        // revenue/product-line write, both enqueued on the same outbox.
        if (window.QU_OPPNOTE && connectorGateway && versionService) {
          oppNoteService = window.QU_OPPNOTE.createService({
            outbox: outboxService, gateway: connectorGateway, quotes: quoteService,
            versions: versionService, priceSnapshots: priceSnapshotService,
            audit: auditService, policy: approvalPolicy, scope: "*"
          });
        }
        if (window.QU_REVENUE && connectorGateway && versionService) {
          revenueService = window.QU_REVENUE.createService({
            outbox: outboxService, gateway: connectorGateway, quotes: quoteService,
            versions: versionService, audit: auditService, policy: approvalPolicy, scope: "*"
          });
        }
      }
      // Task 34: the invoice-intent double-billing guard.
      if (window.QU_INVOICEINTENTS) {
        invoiceIntentService = window.QU_INVOICEINTENTS.createService({ store, policy: (window.root && window.root.quoteInvoicePolicy) || null });
        window.QU.invoiceIntentsReady = invoiceIntentService.ready()
          .catch(err => ({ ok: false, code: "invoice_intents_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 35: the DIRECT accounting invoice path, gated by the intent guard.
      if (window.QU_INVOICEDIRECT) {
        invoiceDirectService = window.QU_INVOICEDIRECT.createService({
          outbox: outboxService, gateway: connectorGateway, invoiceIntents: invoiceIntentService,
          quotes: quoteService, versions: versionService, audit: auditService,
          mapping: invoiceMappingService,
          policy: (window.root && window.root.quoteAccountingPolicy) || null, scope: "*"
        });
        window.QU.invoiceDirectReady = window.QU.invoiceDirectReady || Promise.resolve({ ok: true });
      }
      // Task 36: the PSA invoice path (the PSA's accounting sync owns the invoice).
      if (window.QU_INVOICEPSA) {
        invoicePsaService = window.QU_INVOICEPSA.createService({
          outbox: outboxService, gateway: connectorGateway, invoiceIntents: invoiceIntentService,
          quotes: quoteService, versions: versionService, audit: auditService,
          mapping: invoiceMappingService,
          policy: (window.root && window.root.quotePsaInvoicingPolicy) || null, scope: "*"
        });
        window.QU.invoicePsaReady = Promise.resolve({ ok: true });
      }
      // Task 37: the path-selection router over both invoicing paths (explicit →
      // company mapping → default → only-enabled). The intent guard stays the
      // authority on which path a version actually used.
      if (window.QU_INVOICEPATHS && invoiceDirectService && invoicePsaService) {
        invoicePathRouter = window.QU_INVOICEPATHS.createRouter({
          invoiceDirect: invoiceDirectService,
          invoicePsa: invoicePsaService,
          invoiceIntents: invoiceIntentService,
          mapping: invoiceMappingService,
          policy: (window.root && window.root.quoteInvoicePolicy) || null
        });
        window.QU.invoicePathsReady = Promise.resolve({ ok: true });
      }
      // Task 39: finance reconciliation. For each invoice intent it compares the
      // amount the client accepted against the invoice the external system
      // produced (read back through the gated gateway) and reports a verdict.
      if (window.QU_RECONCILIATION && connectorGateway) {
        reconciliationService = window.QU_RECONCILIATION.createService({
          gateway: connectorGateway,
          invoiceIntents: invoiceIntentService,
          approvals: approvalService,
          audit: auditService,
          policy: (window.root && window.root.quoteInvoicePolicy) || null
        });
        window.QU.reconciliationReady = Promise.resolve({ ok: true });
      }
      // Task 55: the non-blocking advisory send-time completeness checks.
      if (window.QU_ADVISORY) {
        advisoryService = window.QU_ADVISORY.createService({ policy: (window.root && window.root.quoteAdvisoryPolicy) || null });
        window.QU.advisoryReady = Promise.resolve({ ok: true });
      }
      if (window.QU_SEND) {
        sendService = window.QU_SEND.createService({
          quotes: quoteService,
          versions: versionService,
          portalTokens: portalTokenService,
          priceSnapshots: priceSnapshotService,
          gateway: connectorGateway,
          audit: auditService,
          features: featureService,
          advisory: advisoryService,
          policy: (window.root && window.root.quoteSendPolicy) || null,
          generatorName: (window.root && window.root.generatorName) || window.generatorName || null
        });
        window.QU.sendReady = sendService.ready()
          .catch(err => ({ ok: false, code: "send_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 57: prospect mode — a mode flag plus a bound-template / bespoke
      // authoring flow over the shared send/portal/e-signature/artifact spine.
      if (window.QU_PROSPECT && quoteService && versionService) {
        prospectService = window.QU_PROSPECT.createService({
          quotes: quoteService,
          versions: versionService,
          artifacts: artifactService,
          audit: auditService,
          scope: (window.root && window.root.quoteAccessScope) || "*"
        });
        window.QU.prospectReady = prospectService.ready()
          .catch(err => ({ ok: false, code: "prospect_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // The tokenized portal API (roadmap tasks 23–25). The dispatcher is
      // default-deny and rate-limits by IP and token; the read + action services
      // mount their routes onto it. The page (QU_PORTALPAGE) is a client of it.
      if (window.QU_PORTAL && portalTokenService && versionService && quoteService) {
        const portalApi = window.QU_PORTAL.createApi({
          verify: (secret, at) => portalTokenService.verify(secret, at),
          ipRate: { window_ms: 60000, max: 120 },
          tokenRate: { window_ms: 60000, max: 60 }
        });
        const taxPolicy = (window.root && window.root.quoteTaxPolicy) || null;
        if (window.QU_PORTALREAD) {
          const readService = window.QU_PORTALREAD.createService({ quotes: quoteService, versions: versionService, portalTokens: portalTokenService, taxPolicy, events: portalEventService });
          portalApi.mountService(readService);
          window.QU.portalRead = readService;
        }
        if (window.QU_PORTALACTIONS) {
          const actionService = window.QU_PORTALACTIONS.createService({ quotes: quoteService, versions: versionService, portalTokens: portalTokenService, audit: auditService, lifecycle: window.QU_LIFECYCLE, taxPolicy, events: portalEventService, approvals: approvalService, recompute: recomputeService, outbox: outboxService, oppSync: oppSyncService, oppNote: oppNoteService, revenue: revenueService, esign: esignService, artifacts: artifactService });
          portalApi.mountService(actionService);
          window.QU.portalActions = actionService;
        }
        window.QU.portal = portalApi;
      }
      // Task 58: the reports engine (dashboards over the system of record).
      if (window.QU_REPORTS) {
        reportsService = window.QU_REPORTS.createService({
          quotes: quoteService,
          versions: versionService,
          approvals: approvalService,
          audit: auditService,
          store: store,
          scope: (window.root && window.root.quoteAccessScope) || "*"
        });
        window.QU.reportsReady = Promise.resolve({ ok: true });
      }
      // Task 59: the read-only quote API/connector (search, getQuote,
      // getQuoteEvents). Its connector is registered above; this builds the
      // service the connector delegates to.
      if (window.QU_QUOTEREAD) {
        quoteReadService = window.QU_QUOTEREAD.createService({
          quotes: quoteService,
          versions: versionService,
          approvals: approvalService,
          audit: auditService,
          scope: (window.root && window.root.quoteAccessScope) || "*"
        });
        window.QU.quoteReadReady = Promise.resolve({ ok: true });
      }
      // Task 60: the schema-stable analytics extract + BI handoff.
      if (window.QU_ANALYTICS) {
        analyticsService = window.QU_ANALYTICS.createService({
          gateway: connectorGateway,
          store: store,
          quotes: quoteService,
          versions: versionService,
          approvals: approvalService,
          audit: auditService,
          policy: (window.root && window.root.quoteAnalyticsPolicy) || null,
          generatorName: (window.root && window.root.generatorName) || window.generatorName || null,
          scope: (window.root && window.root.quoteAccessScope) || "*"
        });
        window.QU.analyticsReady = Promise.resolve({ ok: true, schema: window.QU_ANALYTICS.fingerprint() });
      }
      // Task 61: the legacy quoting migration (CSV/JSON adapter + reconciliation).
      if (window.QU_LEGACY) {
        legacyService = window.QU_LEGACY.createService({
          store: store,
          catalog: catalogService,
          quotes: quoteService,
          versions: versionService,
          audit: auditService,
          policy: (window.root && window.root.quoteLegacyPolicy) || null
        });
        window.QU.legacyReady = Promise.resolve({ ok: true });
      }
      // Task 64: live verification gates — every external integration is probed
      // through the connector gateway and proven with recorded evidence.
      if (window.QU_VERIFICATION) {
        verificationService = window.QU_VERIFICATION.createService({
          store: store,
          gateway: connectorGateway,
          audit: auditService,
          policy: (window.root && window.root.quoteVerificationPolicy) || null
        });
        window.QU.verificationReady = verificationService.ready()
          .catch(err => ({ ok: false, code: "verification_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 65: observability — health probes over portal-link age, the outbox
      // and the portal rate limiters, plus a structured log persisted to ops_log.
      if (window.QU_OBSERVABILITY) {
        observabilityService = window.QU_OBSERVABILITY.createService({
          store: store,
          portalTokens: portalTokenService,
          outbox: outboxService,
          portal: window.QU.portal || null,
          policy: (window.root && window.root.quoteObservabilityPolicy) || null
        });
        window.QU.observabilityReady = observabilityService.ready()
          .catch(err => ({ ok: false, code: "observability_boot_failed", detail: (err && err.message) || String(err) }));
      }
      // Task 66: the invariant & integrity engine over the live documents.
      if (window.QU_INTEGRITY) {
        integrityService = window.QU_INTEGRITY.createService({ store: store });
        window.QU.integrityReady = integrityService.ready()
          .catch(err => ({ ok: false, code: "integrity_boot_failed", detail: (err && err.message) || String(err) }));
      }
    }
  } catch (err) {
    console.error("quote-u document store failed to initialise:", err);
  }
  applyDrawer();
  const initial = parseRoute(location.hash);
  renderRoute(initial.id, initial.params);
})();
