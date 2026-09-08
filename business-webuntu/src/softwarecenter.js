// Webuntu OS — Software Center (Phase 9, Task 45)
// A windowed catalog of software for the OS. Three tabs:
//   Installed  — Webuntu's own apps, read live from the appCatalog list, plus
//               any user-installed apps (src/appstore.js, tagged "User" with an
//               Uninstall action). Real apps only: stubs and link-type catalog
//               entries are excluded. Each card has an Open action.
//   Available  — external Perchance generators grouped by category (Tools,
//               AI & Images, Games & RPG, Audio & Music, Developer,
//               Community Hubs), each with a source tag (Rathji / BGN / VGN /
//               Community), a one-line blurb, and a Visit action that opens
//               the generator inside the Browser window (embed) with a
//               new-tab (↗) fallback — plus an Install action that adds the
//               generator to the OS as a user app.
//   Install    — a form to install any Perchance generator or website as an
//               app (name / icon / color / category), powered by AppStore.
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
    apps = apps.filter((a) => a.type !== "link" && !a.stub);
    // Built-ins the user "uninstalled" (hidden via AppStore) drop off the
    // Installed list — they show up in the Hidden-apps section instead.
    apps = apps.filter((a) => !(window.AppStore && window.AppStore.isHidden && window.AppStore.isHidden(a.id)));
    // User-installed apps ride on top (uninstallable, tagged "User").
    if (window.AppStore && window.AppStore.getApps) {
      for (const u of window.AppStore.getApps()) {
        if (apps.some((a) => a.id === u.id)) continue;
        apps.push({
          id: u.id,
          name: u.name || u.id,
          icon: u.icon || "📦",
          color: u.color || null,
          category: u.category || "My Apps",
          blurb: u.blurb || "Installed as an app",
          type: "app",
          stub: false,
          uninstallable: true,
        });
      }
    }
    return apps;
  }

  // Built-in apps the user has "uninstalled" (hidden via AppStore) — shown in
  // the Installed tab's Hidden-apps section so they can be restored any time.
  function loadHidden() {
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
    return apps.filter((a) => a.type !== "link" && !a.stub &&
      window.AppStore && window.AppStore.isHidden && window.AppStore.isHidden(a.id));
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
    const tag = el("span", sourceTagClass(app.uninstallable ? "User" : "Webuntu"), app.uninstallable ? "User" : "Webuntu");
    head.append(tile, titleBox, tag);
    const blurb = el("div", "swc-blurb", app.blurb || "Installed with Webuntu.");
    const actions = el("div", "swc-actions");
    const go = el("button", "set-btn swc-go", "Open");
    go.type = "button";
    go.addEventListener("click", () => { if (window.Apps) window.Apps.launch(app.id); });
    actions.appendChild(go);
    // "Move to desktop" — toggles a real desktop shortcut for this app
    // (window.Desktop.addToDesktop / removeFromDesktop persist in the FS).
    let onDesk = !!(window.Desktop && window.Desktop.isOnDesktop && window.Desktop.isOnDesktop(app.id));
    const dk = el("button", "swc-desk" + (onDesk ? " swc-desk-on" : ""), onDesk ? "On desktop ✓" : "Add to desktop");
    dk.type = "button";
    dk.title = onDesk
      ? "Remove this app's shortcut from the desktop"
      : "Add this app as a shortcut on the desktop";
    dk.addEventListener("click", () => {
      if (!window.Desktop) {
        if (window.Notify) window.Notify.push("Desktop unavailable", "The desktop isn't ready yet.");
        return;
      }
      const res = onDesk ? window.Desktop.removeFromDesktop(app.id) : window.Desktop.addToDesktop(app);
      if (res && res.ok) {
        onDesk = !onDesk;
        dk.textContent = onDesk ? "On desktop ✓" : "Add to desktop";
        dk.classList.toggle("swc-desk-on", onDesk);
        dk.title = onDesk
          ? "Remove this app's shortcut from the desktop"
          : "Add this app as a shortcut on the desktop";
        if (window.Notify) window.Notify.push(
          onDesk ? "Added to desktop" : "Removed from desktop",
          onDesk ? app.name + " now appears on your desktop." : app.name + "'s desktop shortcut was removed.");
      } else if (window.Notify) {
        window.Notify.push("Couldn't update desktop", (res && res.error) || "Something went wrong.");
      }
    });
    actions.appendChild(dk);
    const rm = el("button", "set-btn danger", "Uninstall");
    rm.type = "button";
    if (app.uninstallable) {
      rm.title = "Remove this installed app";
      rm.addEventListener("click", () => {
        if (window.AppStore) {
          window.AppStore.uninstall(app.id);
          if (window.Notify) window.Notify.push("Uninstalled " + app.name, "The app was removed from the OS.");
        }
      });
    } else if (window.AppStore && window.AppStore.isCore && window.AppStore.isCore(app.id)) {
      rm.disabled = true;
      rm.title = "This core system app can't be uninstalled.";
    } else {
      rm.title = "Uninstall this built-in app — restore it any time from Hidden apps below";
      rm.addEventListener("click", () => {
        if (window.AppStore) {
          window.AppStore.hideBuiltin(app.id);
          if (window.Notify) window.Notify.push("Uninstalled " + app.name, "It's been removed from the Start menu — restore it from Hidden apps below.");
        }
      });
    }
    actions.appendChild(rm);
    card.append(head, blurb, actions);
    return card;
  }

  function hiddenCard(app) {
    const card = el("div", "swc-card swc-hidden-card");
    const head = el("div", "swc-card-head");
    const tile = el("div", "swc-tile swc-tile-dim", app.icon);
    Object.assign(tile.style, tileStyle(app.color));
    const titleBox = el("div", "swc-card-titlebox");
    titleBox.appendChild(el("div", "swc-card-title", app.name));
    titleBox.appendChild(el("div", "swc-card-cat", app.category));
    const tag = el("span", "swc-source webuntu", "Uninstalled");
    head.append(tile, titleBox, tag);
    const blurb = el("div", "swc-blurb", app.blurb || "Built-in Webuntu app.");
    const actions = el("div", "swc-actions");
    const restore = el("button", "set-btn swc-go", "Restore");
    restore.type = "button";
    restore.title = "Reinstall this built-in app";
    restore.addEventListener("click", () => {
      if (window.AppStore) window.AppStore.restoreBuiltin(app.id);
      if (window.Notify) window.Notify.push("Restored " + app.name, "The app is back in the Start menu and Software Center.");
    });
    actions.appendChild(restore);
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
      const already = window.AppStore && window.AppStore.isInstalled(app.slug);
      const go = el("button", "set-btn swc-go" + (app.comingSoon ? " swc-go-off" : ""), app.comingSoon ? "Soon" : "Visit");
      go.type = "button";
      if (app.comingSoon) go.disabled = true;
      else {
        go.title = "Open inside the OS browser";
        go.addEventListener("click", () => openVisit(app.slug));
      }
      const inst = el("button", "gl-btn swc-inst" + (already ? " swc-inst-done" : ""), already ? "Installed ✓" : "Install");
      inst.type = "button";
      inst.title = already ? "Already installed — open it from the Installed tab" : "Install as an app";
      if (app.comingSoon) inst.disabled = true;
      else inst.addEventListener("click", () => {
        if (already) { openVisit(app.slug); return; }
        const res = window.AppStore && window.AppStore.installFromCatalog(app);
        if (res && res.ok) {
          inst.textContent = "Installed ✓";
          inst.classList.add("swc-inst-done");
          inst.title = "Already installed — open it from the Installed tab";
          if (window.Notify) window.Notify.push("Installed " + app.title, "It's now in the Start menu under My Apps.");
        } else if (res && res.error && window.Notify) {
          window.Notify.push("Could not install", res.error);
        }
      });
      const ext = el("button", "gl-btn swc-ext", "↗");
      ext.type = "button";
      ext.title = "Open in new tab";
      if (app.comingSoon) ext.disabled = true;
      else ext.addEventListener("click", () => openTab(app.slug));
      actions.append(go, inst, ext);
      card.append(head, actions);
    }
    return card;
  }

  // ---------- Install form ----------
  function buildInstallView() {
    const view = el("div", "swc-install");
    const card = el("div", "swc-install-card");

    card.appendChild(el("h3", "swc-install-title", "Install an app"));
    card.appendChild(el("p", "swc-install-intro",
      "Turn any Perchance generator or website into an app in the Start menu. Perchance generators open embedded in the OS; websites open in a window (with a new-tab fallback for sites that block embedding)."));

    const fSource = el("div", "swc-install-field");
    fSource.appendChild(el("label", "swc-install-label", "Source type"));
    const toggle = el("div", "swc-type-toggle");
    const btnP = el("button", "swc-type active", "🧩  Perchance generator");
    const btnW = el("button", "swc-type", "🌐  Website");
    btnP.type = "button"; btnW.type = "button";
    toggle.append(btnP, btnW);
    fSource.appendChild(toggle);
    card.appendChild(fSource);

    const fUrl = el("div", "swc-install-field");
    const urlLabel = el("label", "swc-install-label", "Generator slug or URL");
    const urlInput = el("input", "swc-install-input");
    urlInput.type = "text";
    urlInput.placeholder = "e.g. the-ledger  or  perchance.org/the-ledger";
    urlInput.spellcheck = false;
    fUrl.append(urlLabel, urlInput);
    card.appendChild(fUrl);

    const fName = el("div", "swc-install-field");
    fName.appendChild(el("label", "swc-install-label", "App name"));
    const nameInput = el("input", "swc-install-input");
    nameInput.type = "text";
    nameInput.placeholder = "Optional — defaults to the generator / site name";
    nameInput.spellcheck = false;
    fName.appendChild(nameInput);
    card.appendChild(fName);

    const row = el("div", "swc-install-row");
    const fIcon = el("div", "swc-install-field");
    fIcon.appendChild(el("label", "swc-install-label", "Icon (emoji)"));
    const iconInput = el("input", "swc-install-input");
    iconInput.type = "text";
    iconInput.value = "🧩";
    fIcon.appendChild(iconInput);
    const iconPresets = el("div", "swc-install-icons");
    for (const g of ["🧩", "📦", "🌐", "📊", "🗂️", "💼", "📈", "🤖", "🎯", "🛒", "🧰", "✍️"]) {
      const b = el("button", "swc-inst-icon", g);
      b.type = "button";
      b.title = g;
      b.addEventListener("click", () => { iconInput.value = g; });
      iconPresets.appendChild(b);
    }
    fIcon.appendChild(iconPresets);
    const fColor = el("div", "swc-install-field");
    fColor.appendChild(el("label", "swc-install-label", "Color"));
    const colorInput = el("input", "swc-install-input");
    colorInput.type = "text";
    colorInput.placeholder = "hex, e.g. #22d3ee";
    colorInput.spellcheck = false;
    fColor.appendChild(colorInput);
    const fCat = el("div", "swc-install-field");
    fCat.appendChild(el("label", "swc-install-label", "Category"));
    const catInput = el("input", "swc-install-input");
    catInput.type = "text";
    catInput.value = "My Apps";
    catInput.spellcheck = false;
    fCat.appendChild(catInput);
    row.append(fIcon, fColor, fCat);
    card.appendChild(row);

    const actions = el("div", "swc-install-actions");
    const status = el("span", "swc-install-status", "");
    const installBtn = el("button", "set-btn swc-install-go", "Install app");
    installBtn.type = "button";
    actions.append(status, installBtn);
    card.appendChild(actions);
    view.appendChild(card);

    let kind = "perchance";
    function setKind(k) {
      kind = k;
      btnP.classList.toggle("active", k === "perchance");
      btnW.classList.toggle("active", k === "web");
      if (k === "perchance") {
        urlLabel.textContent = "Generator slug or URL";
        urlInput.placeholder = "e.g. the-ledger  or  perchance.org/the-ledger";
        if (iconInput.value === "🌐") iconInput.value = "🧩";
      } else {
        urlLabel.textContent = "Website URL";
        urlInput.placeholder = "e.g. https://www.quickbooks.com  or  quickbooks.com";
        if (iconInput.value === "🧩") iconInput.value = "🌐";
      }
    }
    btnP.addEventListener("click", () => setKind("perchance"));
    btnW.addEventListener("click", () => setKind("web"));
    urlInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); installBtn.click(); }
    });

    function fail(msg) { status.textContent = msg; status.classList.add("err"); status.classList.remove("ok"); }
    function ok(msg) { status.textContent = msg; status.classList.add("ok"); status.classList.remove("err"); }

    function doInstall() {
      const raw = urlInput.value.trim();
      const name = nameInput.value.trim();
      const icon = iconInput.value.trim();
      const color = colorInput.value.trim();
      const cat = catInput.value.trim() || "My Apps";
      const AS = window.AppStore;
      if (!AS) { fail("The app store isn't ready yet."); return; }
      if (!raw) { fail("Enter a generator slug or a website URL."); return; }
      let rec = null;
      if (kind === "perchance") {
        const slug = AS.parseSlug(raw);
        if (!slug) {
          fail("That doesn't look like a Perchance generator — try a slug like \"the-ledger\", or switch to Website for other URLs.");
          return;
        }
        rec = {
          id: slug, slug,
          name: name || AS.prettyName(slug),
          icon: icon || "🧩",
          color: /^#[0-9a-f]{6}$/i.test(color) ? color : AS.autoColor(slug),
          category: cat,
          blurb: "A Perchance generator installed as an app (" + slug + ")",
          type: "perchance",
          url: "https://null.perchance.org/" + slug,
        };
      } else {
        const url = AS.normalizeUrl(raw);
        if (!url) { fail("That doesn't look like a valid website URL."); return; }
        const id = AS.uniqueId("web-" + String(url).replace(/^https?:\/\//i, "").replace(/[^a-z0-9]+/ig, "-").replace(/^-+|-+$/g, "").slice(0, 24));
        rec = {
          id, slug: null,
          name: name || (() => { try { return new URL(url).hostname.replace(/^www\./i, ""); } catch (e) { return "Website"; } })(),
          icon: icon || "🌐",
          color: /^#[0-9a-f]{6}$/i.test(color) ? color : AS.autoColor(id),
          category: cat,
          blurb: "A website installed as an app (" + (() => { try { return new URL(url).hostname.replace(/^www\./i, ""); } catch (e) { return "website"; } })() + ")",
          type: "web",
          url,
        };
      }
      const res = AS.install(rec);
      if (!res.ok) { fail(res.error || "Could not install the app."); return; }
      ok("Installed ✓ — " + rec.name + " is now in the Start menu.");
      installBtn.textContent = "Install another";
      nameInput.value = "";
      colorInput.value = "";
    }
    installBtn.addEventListener("click", doInstall);

    return view;
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
    return { node: main, setQuery: (q) => { query = q.toLowerCase(); render(); }, refresh: render };
  }

  function buildInstalledView(loader) {
    const body = el("div", "swc-body");
    let query = "";
    function render() {
      body.textContent = "";
      const installed = loader();
      const order = [];
      const groups = {};
      for (const app of installed) {
        const cat = app.category || "Other";
        if (!(cat in groups)) { groups[cat] = []; order.push(cat); }
        groups[cat].push(app);
      }
      for (const cat of order) {
        const sec = el("div", "swc-section");
        sec.appendChild(el("div", "swc-section-title", cat));
        const grid = el("div", "swc-grid");
        for (const app of groups[cat]) grid.appendChild(installedCard(app));
        sec.appendChild(grid);
        body.appendChild(sec);
        sec.hidden = !!query && !sec.textContent.toLowerCase().includes(query);
      }
      // Uninstalled built-ins live here so they can always be restored.
      const hidden = loadHidden();
      if (hidden.length) {
        const sec = el("div", "swc-section");
        const head = el("div", "swc-section-head");
        head.appendChild(el("div", "swc-section-title", "Hidden apps"));
        head.appendChild(el("div", "swc-section-note", "Uninstalled built-ins — restore to bring them back."));
        sec.appendChild(head);
        const grid = el("div", "swc-grid");
        for (const app of hidden) grid.appendChild(hiddenCard(app));
        sec.appendChild(grid);
        body.appendChild(sec);
        sec.hidden = !!query && !sec.textContent.toLowerCase().includes(query);
      }
      const any = body.querySelector(".swc-section:not([hidden])");
      if (!any) body.appendChild(el("div", "swc-empty", 'No installed apps match "' + query + '".'));
    }
    render();
    return { node: body, setQuery: (q) => { query = q.toLowerCase(); render(); }, refresh: render };
  }

  // ---------- app builder ----------
  function build() {
    const rootEl = el("div", "swc");
    const toolbar = el("div", "swc-toolbar");
    const tabInstalled = el("button", "swc-tab", "Installed");
    const tabAvailable = el("button", "swc-tab", "Available");
    const tabInstall = el("button", "swc-tab", "Install");
    tabInstalled.type = "button";
    tabAvailable.type = "button";
    tabInstall.type = "button";
    const search = el("input", "swc-search");
    search.type = "search";
    search.placeholder = "Search software…";
    search.spellcheck = false;
    toolbar.append(tabInstalled, tabAvailable, tabInstall, el("span", "swc-spacer"), search);
    rootEl.appendChild(toolbar);

    const available = loadAvailable();
    const categories = loadCategories();

    const installedView = buildInstalledView(loadInstalled);
    const availableView = buildAvailableView(available, categories);
    const installView = buildInstallView();

    let mode = "installed";
    function setMode(m) {
      mode = m;
      tabInstalled.classList.toggle("active", m === "installed");
      tabAvailable.classList.toggle("active", m === "available");
      tabInstall.classList.toggle("active", m === "install");
      installedView.node.hidden = m !== "installed";
      availableView.node.hidden = m !== "available";
      installView.hidden = m !== "install";
      if (m === "installed") installedView.refresh();
      if (m === "available") availableView.refresh();
    }
    tabInstalled.addEventListener("click", () => setMode("installed"));
    tabAvailable.addEventListener("click", () => setMode("available"));
    tabInstall.addEventListener("click", () => setMode("install"));
    search.addEventListener("input", () => {
      installedView.setQuery(search.value);
      availableView.setQuery(search.value);
    });
    // Install / uninstall (from any tab) → live-update the lists.
    document.addEventListener("webuntu-appschange", () => {
      installedView.refresh();
      availableView.refresh();
    });

    rootEl.append(availableView.node, installedView.node, installView);
    setMode("installed");
    return { content: rootEl, w: 920, h: 640, minW: 620, minH: 440 };
  }

  if (window.AppContent) window.AppContent["software-center"] = build;
  window.SoftwareCenter = { build, loadAvailable, loadInstalled, loadHidden, loadCategories };
})();
