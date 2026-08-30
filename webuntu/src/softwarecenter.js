// Webuntu OS — Software Center (Phase 9, Task 45)
// A windowed catalog of software for the OS. Two tabs:
//   Installed  — Webuntu's own apps, read live from the appCatalog list
//               (real apps only: stubs and link-type catalog entries are
//               excluded). Each card has an Open action.
//   Available  — external Perchance generators grouped by category (Tools,
//               AI & Images, Games & RPG, Audio & Music, Developer,
//               Community Hubs), each with a source tag (Rathji / BGN / VGN /
//               Community), a one-line blurb, and a Visit action that opens
//               the generator inside the Browser window (embed) with a
//               new-tab (↗) fallback.
//
// Exposes window.SoftwareCenter (helpers) and registers the `software-center`
// app builder in window.AppContent.

(function () {
  "use strict";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function tileStyle(color) {
    const fallback =
      getComputedStyle(document.documentElement).getPropertyValue("--tile-fallback").trim() ||
      "rgba(148,163,184,.35)";
    const m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return { background: fallback };
    return { background: `linear-gradient(140deg, #${m[1]}cc, #${m[1]}55)` };
  }

  function sourceTagClass(source) {
    return "swc-source " + (String(source || "webuntu").toLowerCase().replace(/[^a-z]/g, ""));
  }

  function openVisit(slug) {
    if (window.Browser && window.Browser.navigate) {
      window.Browser.navigate(slug);
      return;
    }
    window.open("https://perchance.org/" + slug, "_blank", "noopener");
  }
  function openTab(slug) {
    window.open("https://perchance.org/" + slug, "_blank", "noopener");
  }

  // ---------- data ----------
  function loadInstalled() {
    let apps = [];
    try {
      apps = (root && root.appCatalog)
        ? root.appCatalog.selectAll.map((n) => ({
            id: n.id.evaluateItem,
            name: n.name.evaluateItem,
            icon: n.icon.evaluateItem,
            color: n.color ? n.color.evaluateItem : null,
            category: n.category ? n.category.evaluateItem : "Other",
            blurb: n.blurb ? n.blurb.evaluateItem : "",
            type: n.type ? n.type.evaluateItem : "app",
            stub: n.stub ? n.stub.evaluateItem === true : false,
          }))
        : [];
    } catch (e) { apps = []; }
    return apps.filter((a) => a.type !== "link" && !a.stub);
  }

  function loadCategories() {
    let cats = [];
    try {
      cats = (root && root.swcCategories)
        ? root.swcCategories.selectAll.map((n) => ({
            key: n.key.evaluateItem,
            name: n.name.evaluateItem,
            icon: n.icon ? n.icon.evaluateItem : null,
          }))
        : [];
    } catch (e) { cats = []; }
    return cats;
  }

  function loadAvailable() {
    let apps = [];
    try {
      apps = (root && root.swcApps)
        ? root.swcApps.selectAll.map((n) => ({
            slug: n.slug.evaluateItem,
            title: n.title.evaluateItem,
            icon: n.icon ? n.icon.evaluateItem : null,
            color: n.color ? n.color.evaluateItem : null,
            category: n.category ? n.category.evaluateItem : null,
            source: n.source ? n.source.evaluateItem : "Community",
            blurb: n.blurb ? n.blurb.evaluateItem : "",
            comingSoon: n.comingSoon ? n.comingSoon.evaluateItem === true : false,
            planned: n.planned ? n.planned.evaluateItem === true : false,
          }))
        : [];
    } catch (e) { apps = []; }
    return apps.filter((a) => a.slug);
  }

  // ---------- card builders ----------
  function installedCard(app) {
    const card = el("div", "swc-card");
    const head = el("div", "swc-card-head");
    const tile = el("div", "swc-tile", app.icon);
    Object.assign(tile.style, tileStyle(app.color));
    const titleBox = el("div", "swc-card-titlebox");
    titleBox.appendChild(el("div", "swc-card-title", app.name));
    titleBox.appendChild(el("div", "swc-card-cat", app.category));
    const tag = el("span", sourceTagClass("Webuntu"), "Webuntu");
    head.append(tile, titleBox, tag);
    const blurb = el("div", "swc-blurb", app.blurb || "Installed with Webuntu.");
    const actions = el("div", "swc-actions");
    const go = el("button", "set-btn swc-go", "Open");
    go.type = "button";
    go.addEventListener("click", () => { if (window.Apps) window.Apps.launch(app.id); });
    actions.appendChild(go);
    card.append(head, blurb, actions);
    return card;
  }

  function availableCard(app) {
    const card = el("div", "swc-card" + (app.planned ? " swc-planned" : ""));
    const head = el("div", "swc-card-head");
    const tile = el("div", "swc-tile" + (app.planned || app.comingSoon ? " swc-tile-dim" : ""), app.icon);
    Object.assign(tile.style, tileStyle(app.color));
    const titleBox = el("div", "swc-card-titlebox");
    titleBox.appendChild(el("div", "swc-card-title", app.title));
    titleBox.appendChild(el("div", "swc-card-cat", app.blurb));
    const tag = el("span", sourceTagClass(app.source), app.source);
    head.append(tile, titleBox, tag);
    const actions = el("div", "swc-actions");
    if (app.planned) {
      card.appendChild(head);
      card.appendChild(el("div", "swc-soon-badge", "In development"));
      card.appendChild(actions);
      actions.appendChild(el("span", "swc-planned-note", "Coming in a later release"));
    } else {
      const go = el("button", "set-btn swc-go" + (app.comingSoon ? " swc-go-off" : ""), app.comingSoon ? "Soon" : "Visit");
      go.type = "button";
      if (app.comingSoon) go.disabled = true;
      else {
        go.title = "Open inside the OS browser";
        go.addEventListener("click", () => openVisit(app.slug));
      }
      const ext = el("button", "gl-btn swc-ext", "↗");
      ext.type = "button";
      ext.title = "Open in new tab";
      if (app.comingSoon) ext.disabled = true;
      else ext.addEventListener("click", () => openTab(app.slug));
      actions.append(go, ext);
      card.append(head, actions);
    }
    return card;
  }

  // ---------- views ----------
  function buildAvailableView(available, categories) {
    const main = el("div", "swc-main");
    const side = el("div", "swc-side");
    const allBtn = el("button", "swc-cat active", "🛒  All");
    allBtn.type = "button";
    allBtn.dataset.cat = "";
    side.appendChild(allBtn);
    for (const c of categories) {
      const b = el("button", "swc-cat", (c.icon || "•") + "  " + c.name);
      b.type = "button";
      b.dataset.cat = c.key;
      side.appendChild(b);
    }
    const body = el("div", "swc-body");
    const grid = el("div", "swc-grid");
    body.appendChild(grid);

    let currentCat = "";
    let query = "";

    function matches(app) {
      if (currentCat && app.category !== currentCat) return false;
      if (query && !(app.title + " " + app.blurb).toLowerCase().includes(query)) return false;
      return true;
    }
    function render() {
      grid.textContent = "";
      const shown = available.filter(matches);
      if (!shown.length) {
        grid.appendChild(el("div", "swc-empty", "Nothing here yet — try a different category or search."));
        return;
      }
      for (const app of shown) grid.appendChild(availableCard(app));
    }

    for (const b of side.querySelectorAll(".swc-cat")) {
      b.addEventListener("click", () => {
        currentCat = b.dataset.cat || "";
        for (const x of side.querySelectorAll(".swc-cat")) x.classList.toggle("active", x === b);
        render();
      });
    }
    render();
    main.append(side, body);
    return { node: main, setQuery: (q) => { query = q.toLowerCase(); render(); } };
  }

  function buildInstalledView(installed) {
    const body = el("div", "swc-body");
    // Group by category (folders-first-ish by first appearance in the catalog).
    const order = [];
    const groups = {};
    for (const app of installed) {
      if (!(app.category in groups)) { groups[app.category] = []; order.push(app.category); }
      groups[app.category].push(app);
    }
    let query = "";
    for (const cat of order) {
      const sec = el("div", "swc-section");
      sec.appendChild(el("div", "swc-section-title", cat));
      const grid = el("div", "swc-grid");
      for (const app of groups[cat]) grid.appendChild(installedCard(app));
      sec.appendChild(grid);
      body.appendChild(sec);
    }
    function render() {
      for (const sec of body.querySelectorAll(".swc-section")) {
        sec.hidden = !!query && !sec.querySelector(".swc-card").textContent.toLowerCase().includes(query);
      }
      const any = body.querySelector(".swc-section:not([hidden])");
      if (!any) body.appendChild(el("div", "swc-empty", "No installed apps match \"" + query + "\"."));
      else body.querySelector(".swc-empty")?.remove();
    }
    return { node: body, setQuery: (q) => { query = q.toLowerCase(); render(); } };
  }

  // ---------- app builder ----------
  function build() {
    const rootEl = el("div", "swc");
    const toolbar = el("div", "swc-toolbar");
    const tabInstalled = el("button", "swc-tab", "Installed");
    const tabAvailable = el("button", "swc-tab", "Available");
    tabInstalled.type = "button";
    tabAvailable.type = "button";
    const search = el("input", "swc-search");
    search.type = "search";
    search.placeholder = "Search software…";
    search.spellcheck = false;
    toolbar.append(tabInstalled, tabAvailable, el("span", "swc-spacer"), search);
    rootEl.appendChild(toolbar);

    const installed = loadInstalled();
    const available = loadAvailable();
    const categories = loadCategories();

    const installedView = buildInstalledView(installed);
    const availableView = buildAvailableView(available, categories);

    let mode = "available";
    function setMode(m) {
      mode = m;
      tabInstalled.classList.toggle("active", m === "installed");
      tabAvailable.classList.toggle("active", m === "available");
      installedView.node.hidden = m !== "installed";
      availableView.node.hidden = m !== "available";
    }
    tabInstalled.addEventListener("click", () => setMode("installed"));
    tabAvailable.addEventListener("click", () => setMode("available"));
    search.addEventListener("input", () => {
      installedView.setQuery(search.value);
      availableView.setQuery(search.value);
    });

    rootEl.append(availableView.node, installedView.node);
    setMode("available");
    return { content: rootEl, w: 920, h: 640, minW: 620, minH: 440 };
  }

  if (window.AppContent) window.AppContent["software-center"] = build;
  window.SoftwareCenter = { build, loadAvailable, loadInstalled, loadCategories };
})();
