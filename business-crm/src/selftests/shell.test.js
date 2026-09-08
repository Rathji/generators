(function () {
  const T = window.SELFTEST;
  if (!T) return;

  const EXPECTED = ["dashboard", "companies", "contacts", "leads", "deals", "activities", "reports", "bus"];

  function sideNavLinks() {
    return Array.from(document.querySelectorAll("#sideNav .side-link")).map(a => a.dataset.id);
  }

  T.register("phone layout uses an off-canvas sidebar", async () => {
    if (window.innerWidth >= 920) return { pass: true, skip: true, detail: `viewport is ${window.innerWidth}px; run at ≤920px to exercise` };
    const layout = document.getElementById("layout");
    const sidebar = document.getElementById("sidebar");
    const btn = document.getElementById("navToggleBtn");
    await ensureClosed();
    const closed = await waitFor(() => sidebar.getBoundingClientRect().right <= 1);
    btn.click();
    const opened = await waitFor(() => sidebar.getBoundingClientRect().left >= -1);
    const backdropVisible = getComputedStyle(document.getElementById("navBackdrop")).pointerEvents === "auto";
    btn.click();
    const closedAgain = await waitFor(() => sidebar.getBoundingClientRect().right <= 1);
    return closed && opened && backdropVisible && closedAgain ? { pass: true, detail: "off-canvas drawer verified" } : { pass: false, detail: `closed=${closed} opened=${opened} backdrop=${backdropVisible} closedAgain=${closedAgain}` };
  });

  T.register("side navigation lists every CRM module", () => {
    const links = sideNavLinks();
    const missing = EXPECTED.filter(id => !links.includes(id));
    if (missing.length) return { pass: false, detail: "missing: " + missing.join(", ") };
    if (links.length !== EXPECTED.length) return { pass: false, detail: `expected ${EXPECTED.length} links, found ${links.length}` };
    return { pass: true, detail: links.join(", ") };
  });

  T.register("side navigation labels match module names", () => {
    const bad = [];
    for (const m of window.CRM_MODULES) {
      const a = document.querySelector(`#sideNav .side-link[data-id="${m.id}"]`);
      if (!a || a.textContent.trim() !== m.label) bad.push(m.id);
    }
    return bad.length ? { pass: false, detail: "label mismatch: " + bad.join(", ") } : true;
  });

  T.register("default landing is the dashboard", async () => {
    window.CRM.go("dashboard");
    await window.CRM.ready();
    const el = document.getElementById("viewRoot");
    const ok = el.dataset.state === "ready" && el.querySelector(".page-title") && el.querySelector(".page-title").textContent === "Dashboard";
    return ok ? true : { pass: false, detail: "state=" + el.dataset.state };
  });

  T.register("every module navigates without error", async () => {
    const fails = [];
    for (const id of EXPECTED) {
      window.CRM.go(id);
      await window.CRM.ready();
      const el = document.getElementById("viewRoot");
      const label = window.CRM_MODULES.find(m => m.id === id).label;
      if (el.dataset.state !== "ready") fails.push(id + " state=" + el.dataset.state);
      else if (el.querySelector(".view-error")) fails.push(id + " shows error");
      else if (!el.querySelector(".page-title") || el.querySelector(".page-title").textContent.trim() !== label) fails.push(id + " wrong title");
    }
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return fails.length ? { pass: false, detail: fails.join(" | ") } : true;
  });

  T.register("loading state shows while a module renders", async () => {
    const view = document.getElementById("viewRoot");
    const p = window.CRM.go("deals");
    const showed = !!view.querySelector(".load-shell") && view.dataset.state === "loading";
    await p;
    const el = document.getElementById("viewRoot");
    const cleared = el.dataset.state === "ready" && !el.querySelector(".load-shell");
    return showed && cleared ? { pass: true, detail: "loading shown, then cleared" } : { pass: false, detail: `loadingShown=${showed} cleared=${cleared}` };
  });

  T.register("placeholder modules render the empty state", async () => {
    const id = "emptytest";
    window.CRM.addModule({ id, label: "Empty test", icon: "", empty: { title: "Nothing here yet", message: "This temporary module has no renderer, so the shell shows its empty state." } });
    window.CRM.go(id);
    await window.CRM.ready();
    const el = document.getElementById("viewRoot");
    const empty = el.querySelector(".state-empty");
    const ok = !!(empty && empty.querySelector(".state-title"));
    const detail = ok ? empty.querySelector(".state-title").textContent : "no .state-empty found";
    window.CRM.removeModule(id);
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return ok ? { pass: true, detail } : { pass: false, detail };
  });

  T.register("a failing module render shows the error state", async () => {
    window.CRM.addModule({ id: "boomtest", label: "Boom test", icon: "", render: () => { throw new Error("deliberate test failure"); } });
    window.CRM.go("boomtest");
    await window.CRM.ready();
    const el = document.getElementById("viewRoot");
    const errCard = el.querySelector(".view-error");
    const textOk = errCard && errCard.textContent.includes("deliberate test failure");
    const hasRetry = errCard && errCard.querySelector("[data-retry]");
    window.CRM.removeModule("boomtest");
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return errCard && textOk && hasRetry ? true : { pass: false, detail: "error card missing or incomplete" };
  });

  T.register("unknown routes show an actionable error", async () => {
    window.CRM.go("nonexistent-module");
    await window.CRM.ready();
    const el = document.getElementById("viewRoot");
    const errCard = el.querySelector(".view-error");
    const mentions = errCard && errCard.textContent.includes("nonexistent-module");
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return errCard && mentions ? true : { pass: false, detail: "unknown-route error card missing" };
  });

  async function waitFor(fn, timeout) {
    const t0 = performance.now();
    const limit = timeout || 2500;
    while (performance.now() - t0 < limit) {
      if (fn()) return true;
      await new Promise(r => setTimeout(r, 60));
    }
    return fn();
  }

  async function ensureClosed() {
    const layout = document.getElementById("layout");
    const btn = document.getElementById("navToggleBtn");
    if (layout.classList.contains("drawer-open")) {
      btn.click();
      await waitFor(() => !layout.classList.contains("drawer-open"));
    }
  }

  T.register("nav drawer opens and closes", async () => {
    const layout = document.getElementById("layout");
    const btn = document.getElementById("navToggleBtn");
    await ensureClosed();
    btn.click();
    const opened = await waitFor(() => layout.classList.contains("drawer-open")) && btn.getAttribute("aria-expanded") === "true";
    btn.click();
    const closed = await waitFor(() => !layout.classList.contains("drawer-open")) && btn.getAttribute("aria-expanded") === "false";
    return opened && closed ? true : { pass: false, detail: `opened=${opened} closed=${closed}` };
  });

  T.register("active nav item tracks the current module", async () => {
    window.CRM.go("contacts");
    await window.CRM.ready();
    const active = document.querySelectorAll('#sideNav .side-link[aria-current="page"]');
    const ok = active.length === 1 && active[0].dataset.id === "contacts";
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return ok ? true : { pass: false, detail: "expected exactly one active link on contacts" };
  });

  T.register("per-module pages have consistent page-head structure", async () => {
    const fails = [];
    for (const id of ["dashboard", "leads", "reports"]) {
      window.CRM.go(id);
      await window.CRM.ready();
      const el = document.getElementById("viewRoot");
      if (!el.querySelector(".page-title") || !el.querySelector(".page-sub")) fails.push(id);
    }
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return fails.length ? { pass: false, detail: fails.join(", ") + " missing title or subtitle" } : true;
  });
})();
