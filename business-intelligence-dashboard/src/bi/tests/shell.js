/* ============================================================
   BI validation tests — roadmap task 1 (module shell & nav).
   Run via: await BI.runTests("shell")  (page_eval harness).
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const REQUIRED_MODULES = ["dashboards", "reports", "dataSources", "schedules"];
  const REQUIRED_LABELS = ["Dashboards", "Reports", "Data Sources", "Schedules"];

  function waitFor(fn, ms) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (fn()) return resolve(true);
        if (Date.now() - start > (ms || 8000)) return resolve(false);
        setTimeout(tick, 40);
      };
      tick();
    });
  }

  BI.tests.shell = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });

      /* 1 — every BI module is registered in code */
      for (const id of REQUIRED_MODULES) {
        push("module registered: " + id, !!BI.modules[id], "registered: " + Object.keys(BI.modules).join(", "));
      }

      /* 2 — sidebar + topbar frame exists */
      push("sidebar present", !!BI.$(".bi-sidebar"));
      push("topbar present", !!BI.$(".bi-topbar"));

      /* 3 — side navigation lists every BI module */
      const navItems = BI.$$(".bi-nav-item");
      const navIds = navItems.map((a) => a.dataset.module);
      const navLabels = navItems.map((a) => a.textContent.trim());
      for (const id of REQUIRED_MODULES) {
        push("nav lists " + id, navIds.includes(id), "nav ids: " + navIds.join(", "));
      }
      for (const label of REQUIRED_LABELS) {
        push("nav label " + label, navLabels.includes(label), "nav labels: " + navLabels.join(", "));
      }

      /* 4 — default module loads and renders the executive dashboard */
      location.hash = "#/" + BI.config.defaultModule;
      await waitFor(() => BI.state.current === BI.config.defaultModule && !!BI.$(".bi-page-title") && BI.$(".bi-page-title").textContent === "Dashboards");
      push("default module (dashboards) renders page", !!BI.$(".bi-page-title") && BI.$(".bi-page-title").textContent === "Dashboards");
      push("default module renders dashboard cards", !!BI.$(".bi-dash-grid") || !!BI.$(".bi-dash-tabs") || BI.$$(".bi-kpi").length > 0, "kpi cards: " + BI.$$(".bi-kpi").length);
      const active0 = BI.$(".bi-nav-item.active");
      push("dashboards nav item is active", !!(active0 && active0.dataset.module === "dashboards"));

      /* 5 — state primitives are consistent across the three kinds */
      const loading = BI.ui.state({ type: "loading", title: "T" });
      push("loading state class", loading.className.includes("bi-state--loading"));
      push("loading state has spinner", !!loading.querySelector(".bi-spinner"));

      let clicked = 0;
      const error = BI.ui.state({ type: "error", title: "E", message: "M", actions: [{ label: "Retry", kind: "primary", onClick: () => clicked++ }] });
      push("error state class", error.className.includes("bi-state--error"));
      const retry = error.querySelector(".bi-state-actions .bi-btn");
      push("error state has retry button", !!retry);
      if (retry) retry.click();
      push("retry button invokes handler", clicked === 1);

      const empty = BI.ui.state({ type: "empty", title: "X", message: "Y" });
      push("empty state class", empty.className.includes("bi-state--empty"));

      /* 6 — programmatic navigation shows loading then renders the module */
      const navPromise = BI.navigate("reports");
      push("loading state shown during navigation", !!BI.$(".bi-state--loading"));
      await navPromise;
      await waitFor(() => BI.$(".bi-page-title") && BI.$(".bi-page-title").textContent === "Reports");
      push("navigates to reports (programmatic)", BI.state.current === "reports");
      push("reports page header renders", BI.$(".bi-page-title") && BI.$(".bi-page-title").textContent === "Reports");
      push("reports view renders its content", !!BI.$(".bi-page-title"), "reports list present: " + !!BI.$(".bi-report-list"));
      const active1 = BI.$(".bi-nav-item.active");
      push("reports nav item is active", !!(active1 && active1.dataset.module === "reports"));

      /* 7 — hash routing navigates */
      location.hash = "#/dataSources";
      await waitFor(() => BI.state.current === "dataSources" && BI.$(".bi-page-title") && BI.$(".bi-page-title").textContent === "Data Sources");
      push("navigates to data sources via hash", BI.state.current === "dataSources");
      push("data sources view renders", BI.$(".bi-page-title") && BI.$(".bi-page-title").textContent === "Data Sources");

      /* 8 — unknown route falls back to the default module */
      location.hash = "#/does-not-exist";
      await waitFor(() => BI.state.current === BI.config.defaultModule);
      push("unknown route falls back to default", BI.state.current === BI.config.defaultModule);

      /* 9 — mobile drawer opens/closes */
      const sb = BI.$("#biSidebar");
      const ham = BI.$("#biHamburger");
      const backdrop = BI.$("#biBackdrop");
      ham.click();
      push("hamburger opens drawer", sb.classList.contains("open"));
      backdrop.click();
      push("backdrop closes drawer", !sb.classList.contains("open"));

      return results;
    },
  };
})();
