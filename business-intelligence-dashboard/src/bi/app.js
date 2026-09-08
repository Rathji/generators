/* ============================================================
   BI app bootstrap — reads biConfig from main.pjs, builds the
   shell frame (sidebar nav + topbar), initialises the store, the
   bus (manifest discovery + first pull → facts), integrity checks,
   the realtime hub client, and the background scheduler, then
   hash-routes modules (#/dashboards, #/reports, #/dataSources,
   #/schedules, #/settings) and the standalone embed route
   (#/embed/<reportId>).
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  let routeToken = 0;
  let booted = false;

  const DEFAULT_MODULES = [
    { id: "dashboards", label: "Dashboards", icon: "layout", description: "" },
    { id: "reports", label: "Reports", icon: "chart", description: "" },
    { id: "dataSources", label: "Data Sources", icon: "cloud", description: "" },
    { id: "schedules", label: "Schedules", icon: "clock", description: "" },
    { id: "settings", label: "Settings", icon: "gear", description: "" },
  ];

  function readBiConfig() {
    const node = window.root && root.biConfig;
    const str = (v, d) => (v == null ? d : String(v));
    const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
    const cfg = {
      appName: str(node && node.appName, "Business Intelligence"),
      appShort: str(node && node.appShort, "BI"),
      tagline: str(node && node.tagline, "Reporting cockpit"),
      defaultModule: str(node && node.defaultModule, "dashboards"),
      store: {
        ceilingBytes: num(node && node.store && node.store.ceilingBytes, 1048576),
      },
      bus: {
        manifestUrl: str(node && node.bus && node.bus.manifestUrl, "src/bi/fixtures/manifest.json"),
        cadenceMs: num(node && node.bus && node.bus.cadenceMs, 21600000),
        stalenessMs: num(node && node.bus && node.bus.stalenessMs, 108000000),
      },
      realtime: {
        hubEnabled: !node || !node.realtime || node.realtime.hubEnabled !== false,
        pollFallbackMs: num(node && node.realtime && node.realtime.pollFallbackMs, 45000),
      },
      modules: [],
    };
    const mn = node && node.modules;
    for (const id of ["dashboards", "reports", "dataSources", "schedules", "settings"]) {
      const m = mn && mn[id];
      if (!m) continue;
      cfg.modules.push({
        id,
        label: str(m.label, id),
        icon: str(m.icon, "chart"),
        description: str(m.description, ""),
      });
    }
    if (!cfg.modules.length) cfg.modules = DEFAULT_MODULES;
    if (!cfg.modules.some((m) => m.id === cfg.defaultModule)) cfg.defaultModule = cfg.modules[0].id;
    return cfg;
  }

  function moduleMeta(id) {
    return BI.config.modules.find((m) => m.id === id) || { id, label: id, icon: "chart", description: "" };
  }

  /* ============================ sidebar ============================ */

  function buildSidebar() {
    const nav = BI.$("#biNav");
    nav.innerHTML = "";
    const label = document.createElement("div");
    label.className = "bi-nav-label";
    label.textContent = "Modules";
    nav.appendChild(label);
    for (const m of BI.config.modules) {
      const a = document.createElement("a");
      a.href = "#/" + m.id;
      a.className = "bi-nav-item";
      a.dataset.module = m.id;
      a.innerHTML = BI.icon(m.icon, 18) + "<span>" + BI.esc(m.label) + "</span>";
      nav.appendChild(a);
    }
    BI.$("#biBrandMark").textContent = BI.config.appShort;
    BI.$("#biBrandName").textContent = BI.config.appName;
    BI.$("#biBrandTag").textContent = BI.config.tagline;
    BI.$("#biVersion").textContent = "v" + BI.version;
  }

  function setActive(id) {
    BI.$$(".bi-nav-item").forEach((a) => a.classList.toggle("active", a.dataset.module === id));
  }

  /* ============================ routing ============================ */

  function routeParts() {
    const h = location.hash.replace(/^#\/?/, "");
    const parts = h.split("/");
    return { raw: h, first: parts[0] || "", rest: parts.slice(1) };
  }

  function currentModule() {
    const { first } = routeParts();
    const known = BI.config.modules.some((m) => m.id === first);
    return known ? first : BI.config.defaultModule;
  }

  async function showModule(id) {
    const mod = BI.modules[id];
    const meta = moduleMeta(id);
    const content = BI.$("#biContent");
    const token = ++routeToken;
    BI.state.current = id;
    setActive(id);
    BI.$("#biCrumb").innerHTML =
      '<span class="bi-crumb-home">' + BI.esc(BI.config.appName) + '</span><span class="bi-crumb-sep">/</span><span>' + BI.esc(meta.label) + "</span>";
    document.body.classList.remove("bi-embed-mode");
    closeDrawer();

    const ctx = { el: content, app: BI, meta, module: mod };
    content.innerHTML = "";
    content.appendChild(BI.ui.state({ type: "loading", title: "Loading " + meta.label + "…", message: "Preparing view." }));
    content.focus({ preventScroll: true });

    try {
      const data = await mod.load(ctx);
      if (token !== routeToken) return;
      content.innerHTML = "";
      mod.render(ctx, data);
    } catch (err) {
      if (token !== routeToken) return;
      content.innerHTML = "";
      content.appendChild(BI.ui.state({
        type: "error",
        title: "Couldn't load " + meta.label,
        message: (err && err.message ? err.message : "An unexpected error occurred.") + " You can retry.",
        actions: [{ label: "Retry", kind: "primary", onClick: () => showModule(id) }],
      }));
      console.error("[BI] failed to load module", id, err);
    }
  }

  /* Standalone embed route: one clean report card, no app chrome. */
  async function showEmbed(reportId) {
    const content = BI.$("#biContent");
    const token = ++routeToken;
    document.body.classList.add("bi-embed-mode");
    setActive("");
    BI.$("#biCrumb").innerHTML = "";
    BI.state.current = "embed";
    closeDrawer();
    content.innerHTML = "";
    content.appendChild(BI.ui.state({ type: "loading", title: "Loading report…", message: "Preparing embed." }));
    const theme = new URLSearchParams(location.hash.split("?")[1] || "").get("theme");
    if (theme === "dark" || theme === "light") BI.theme.set(theme);
    const report = BI.reports.get(decodeURIComponent(reportId));
    if (!report) {
      content.innerHTML = "";
      content.appendChild(BI.ui.state({ type: "error", title: "Unknown report", message: BI.errors.describe("unknown_report").text }));
      return;
    }
    const ctn = document.createElement("div");
    ctn.className = "bi-embed-ctn";
    ctn.appendChild(BI.cards.card({ report, overrides: {}, cardTitle: report.name, actions: [] }));
    content.innerHTML = "";
    content.appendChild(ctn);
  }

  function route() {
    const { first, rest } = routeParts();
    if (first === "embed" && rest[0]) { showEmbed(rest[0]); return; }
    showModule(currentModule());
  }

  /* ============================ mobile drawer ============================ */

  function openDrawer() {
    BI.$("#biSidebar").classList.add("open");
    BI.$("#biBackdrop").hidden = false;
    BI.$("#biHamburger").setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    BI.$("#biSidebar").classList.remove("open");
    BI.$("#biBackdrop").hidden = true;
    BI.$("#biHamburger").setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  /* ============================ background scheduler ============================ */

  function startScheduler() {
    /* fire due schedules (exports, snapshot publishes) */
    setInterval(() => {
      if (BI.schedules && BI.schedules.check) BI.schedules.check();
    }, 60000);
    /* re-check source freshness without exceeding each source's cadence */
    setInterval(() => {
      BI.bus.refreshAll().then(() => {
        if (BI.integrity) BI.integrity.refresh();
        if (BI.realtime && BI.realtime.reportIndex) BI.realtime.reportIndex();
      }).catch(() => { /* noop */ });
    }, Math.min(BI.config.bus.cadenceMs, 900000));
  }

  /* ============================ events ============================ */

  function bind() {
    window.addEventListener("hashchange", route);
    BI.$("#biHamburger").addEventListener("click", () => {
      if (BI.$("#biSidebar").classList.contains("open")) closeDrawer();
      else openDrawer();
    });
    BI.$("#biBackdrop").addEventListener("click", closeDrawer);
    BI.$("#biNav").addEventListener("click", (e) => {
      const a = e.target.closest(".bi-nav-item");
      if (a) closeDrawer();
    });
    BI.$("#biRefreshBtn").innerHTML = BI.icon("refresh", 18);
    BI.$("#biHamburger").innerHTML = BI.icon("menu", 18);
    BI.$("#biRefreshBtn").addEventListener("click", async () => {
      BI.ui.toast("Refreshing sources…");
      const res = await BI.bus.refreshAll({ force: true });
      if (BI.integrity) BI.integrity.refresh();
      if (BI.realtime && BI.realtime.reportIndex) BI.realtime.reportIndex();
      if (BI.state.current === "dataSources") {
        showModule("dataSources");
      } else {
        showModule(BI.state.current);
      }
      BI.ui.toast("Refreshed " + res.pulled + " bundle(s)" + (res.errors ? ", " + res.errors + " failed" : ""), res.errors ? "warn" : "success");
    });
    BI.$("#biThemeBtn").addEventListener("click", () => { BI.theme.toggle(); rerenderCharts(); });
    BI.$("#biThemeBtnTop").addEventListener("click", () => { BI.theme.toggle(); rerenderCharts(); });
    BI.$("#biHealthBadge").addEventListener("click", () => { location.hash = "#/settings"; });
  }

  function rerenderCharts() {
    if (BI.state.current && BI.state.current !== "embed" && BI.modules[BI.state.current]) showModule(BI.state.current);
  }

  /* ============================ boot ============================ */

  async function boot() {
    if (booted) return;
    booted = true;
    BI.config = readBiConfig();
    buildSidebar();
    BI.theme.set(BI.theme.get());
    if (BI.store && BI.store.init) BI.store.init({ ceilingBytes: BI.config.store.ceilingBytes });

    /* store reconcile (task 3) — surface conflicts, never drop silently */
    if (BI.store && BI.store.reconcileAll) {
      BI.store.reconcileAll().then((res) => {
        if (res && res.ok && res.conflicts && res.conflicts.length) {
          BI.ui.toast("Sync: " + res.conflicts.length + " document conflict(s) need resolution.", "warn");
          console.warn("[BI] boot reconcile found conflicts", res.conflicts.map((c) => c.id));
        }
      }).catch((e) => console.error("[BI] boot reconcile failed", e));
    }

    /* bus init: discover manifest + first pull → facts */
    if (BI.bus && BI.bus.init) {
      const m = await BI.bus.init({
        manifestUrl: BI.config.bus.manifestUrl,
        cadenceMs: BI.config.bus.cadenceMs,
        stalenessMs: BI.config.bus.stalenessMs,
      });
      if (!m.ok) {
        console.warn("[BI] bus init failed", m.error);
      }
      if (BI.integrity) BI.integrity.refresh();
      if (BI.realtime && BI.realtime.reportIndex) BI.realtime.reportIndex();
    }

    if (BI.realtime && BI.realtime.init) {
      BI.realtime.init({ hubEnabled: BI.config.realtime.hubEnabled, pollFallbackMs: BI.config.realtime.pollFallbackMs });
    }

    bind();
    startScheduler();

    try {
      if (!location.hash) history.replaceState(null, "", "#/" + BI.config.defaultModule);
    } catch (e) { /* ignore */ }
    route();
  }

  BI.navigate = showModule;
  BI.rerender = rerenderCharts;
  BI.runTests = async (name) => {
    const t = BI.tests[name];
    if (!t) return { ok: false, error: "No test suite named: " + name };
    const results = await t.run();
    return { ok: results.every((r) => r.pass), results };
  };
  BI.runAllTests = async () => {
    const out = {};
    for (const name of Object.keys(BI.tests)) {
      const res = await BI.runTests(name);
      out[name] = { ok: res.ok, count: res.results.length, results: res.results };
    }
    const allOk = Object.keys(out).every((n) => out[n].ok);
    return { ok: allOk, suites: out };
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
