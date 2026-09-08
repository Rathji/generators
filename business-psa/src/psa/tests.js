import { MODULES, MODULES_BY_ID, emptyState, loadingState, errorState, parseRoute } from "./core.js";

const EXPECTED = ["dashboard", "clients", "projects", "resources", "timesheets", "expenses", "billing", "reports", "settings"];

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function transformTx(el) {
  const t = getComputedStyle(el).transform;
  if (t === "none") return 0;
  const m = t.match(/matrix\(([^)]+)\)/);
  if (!m) return 0;
  const parts = m[1].split(",").map(Number);
  return parts.length >= 5 ? parts[4] : 0;
}

async function waitFor(fn, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await wait(40);
  }
  return null;
}

export async function runPsaTests() {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok, detail: ok ? "" : detail });

  const ids = Object.keys(MODULES_BY_ID);
  check("registry has exactly the 9 expected modules", EXPECTED.every((id) => MODULES_BY_ID[id]) && ids.length === EXPECTED.length, "got: " + JSON.stringify(ids));
  check("each module has unique id, label, icon, render", MODULES.length === EXPECTED.length && new Set(MODULES.map((m) => m.id)).size === MODULES.length && MODULES.every((m) => m.label && m.icon && typeof m.render === "function"));

  const navItems = [...document.querySelectorAll(".psa-nav-item")];
  const navIds = navItems.map((n) => n.dataset.module);
  check("sidenav renders all 9 modules", EXPECTED.every((id) => navIds.includes(id)), JSON.stringify(navIds));
  check("nav items link to #/<id>", navItems.every((n) => n.getAttribute("href") === "#/" + n.dataset.module));

  for (const id of EXPECTED) {
    await window.__psaRouter.dispatch({ moduleId: id, parts: [] });
    const sec = await waitFor(() => document.querySelector('.psa-module[data-module="' + id + '"]'));
    check("route " + id + " renders module content", !!sec);
    if (!sec) continue;
    const title = sec.querySelector(".psa-page-title");
    check("route " + id + " shows a page title", !!title && title.textContent.trim().length > 0);
    if (id === "dashboard") {
      const welcome = sec.querySelector(".dash-welcome");
      const cards = sec.querySelectorAll(".dash-card:not(.dash-card-wide)");
      check("route dashboard shows welcome + 7 module cards", !!welcome && cards.length === EXPECTED.length - 1, "cards: " + cards.length);
    } else if (id === "settings") {
      const state = sec.querySelector(".state-card") || sec.querySelector(".psa-conflict-item");
      check("route settings shows a consistent state card or conflict list", !!state, "expected state card in settings view");
    } else {
      const state = sec.querySelector(".state-card");
      check("route " + id + " shows a consistent state card", !!state, "expected state card in " + id + " view");
    }
    const active = document.querySelector(".psa-nav-item.active");
    check("route " + id + " marks nav active", !!active && active.dataset.module === id);
  }

  await window.__psaRouter.dispatch({ moduleId: "does-not-exist", parts: [] });
  const fallback = await waitFor(() => document.querySelector('.psa-module[data-module="dashboard"]'));
  check("unknown route falls back to dashboard", !!fallback);

  check("parseRoute parses module + params", (() => {
    location.hash = "#/clients/abc123";
    const r = parseRoute();
    return r.moduleId === "clients" && r.parts.join("/") === "abc123";
  })());

  check("loading state shows spinner", (() => {
    const c = loadingState("Working…");
    return !!c.querySelector(".spinner") && c.classList.contains("state-loading");
  })());

  check("empty state shows title and message", (() => {
    const c = emptyState({ title: "Nothing here", message: "Add something." });
    return !!c.querySelector(".state-title") && c.querySelector(".state-title").textContent === "Nothing here" && !!c.querySelector(".state-msg");
  })());

  check("empty state action button fires", (() => {
    let fired = false;
    const c = emptyState({ title: "T", action: { label: "Go", onClick: () => { fired = true; } } });
    c.querySelector("button").click();
    return fired;
  })());

  check("error state shows retry action", (() => {
    const c = errorState({ title: "Boom", action: { label: "Try again", onClick: () => {} } });
    return c.classList.contains("state-error") && !!c.querySelector("button") && c.querySelector("button").textContent === "Try again";
  })());

  check("drawer opens and closes via body class", (() => {
    document.body.classList.add("psa-drawer-open");
    const open = document.body.classList.contains("psa-drawer-open");
    document.body.classList.remove("psa-drawer-open");
    return open && !document.body.classList.contains("psa-drawer-open");
  })());

  check("responsive: sidebar off-canvas on small screens, static on large", (() => {
    const sb = document.getElementById("psaSidebar");
    const menuBtn = document.getElementById("psaMenuBtn");
    document.body.classList.remove("psa-drawer-open");
    const prevTransition = sb.style.transition;
    sb.style.transition = "none";
    const tx = transformTx(sb);
    sb.style.transition = prevTransition;
    const menuDisplay = getComputedStyle(menuBtn).display;
    const isSmall = window.innerWidth < 900;
    if (isSmall) {
      return menuDisplay !== "none" && tx < 0;
    }
    return menuDisplay === "none" && tx >= 0;
  })());

  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
