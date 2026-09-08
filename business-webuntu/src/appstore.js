// Webuntu Business — Install apps (install any Perchance generator or website
// as an OS app)
// Lets the user turn any Perchance generator (embedded in-OS, exactly like the
// pre-installed business suite) or any website (iframe attempt with an
// always-available "open in a new tab" fallback, since some sites block
// framing) into an app that lives in the Start menu and Software Center.
//
// User-installed apps persist in localStorage ("webuntu.userapps") — they are
// machine-level installs, not per-user data. Every persisted app gets a
// window.AppContent[id] builder registered at boot (and on install), so the
// normal Apps.launch path in src/apps.js opens it. Install/uninstall notify the
// rest of the OS via Apps.refresh() + a "webuntu-appschange" event (the Start
// menu re-reads the catalog on every open; Software Center listens to rebuild).
//
// Exposes window.AppStore.

(function () {
  "use strict";

  const KEY = "webuntu.userapps";
  const COLOR_PALETTE = ["#22d3ee", "#34d399", "#8b5cf6", "#f59e0b", "#ec4899", "#22c55e", "#7c6cff", "#f97316", "#ef4444", "#3b82f6"];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ---------- persistence ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
    catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
    if (window.Apps && window.Apps.refresh) window.Apps.refresh();
    document.dispatchEvent(new CustomEvent("webuntu-appschange"));
  }

  // ---------- helpers ----------
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function autoColor(id) { return COLOR_PALETTE[hashStr(id) % COLOR_PALETTE.length]; }
  function validColor(c) { return /^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : null; }
  function prettify(slug) {
    return String(slug || "").split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || "App";
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ""); }
    catch (e) { return "Website"; }
  }

  // "perchance.org/the-ledger", "the-ledger", or a bare slug → "the-ledger".
  // Anything else (a full URL to another site) → null.
  function parseSlug(raw) {
    let s = String(raw || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    const m = /^(?:[\w-]+\.)*perchance\.org(?:\/([\w-]+))?$/i.exec(s);
    if (m) return m[1] || null;
    if (/^[\w-]+$/.test(s)) return s;
    return null;
  }

  // Normalize user-typed website input into a usable https URL, or null.
  function normalizeUrl(raw) {
    let s = String(raw || "").trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (!u.hostname) return null;
      return u.href;
    } catch (e) { return null; }
  }

  function isInstalled(id) {
    return !!load().find((a) => a.id === id);
  }

  function uniqueId(base) {
    const taken = new Set();
    if (root && root.appCatalog) {
      for (const n of root.appCatalog.selectAll) { try { taken.add(n.id.evaluateItem); } catch (e) {} }
    }
    for (const a of load()) taken.add(a.id);
    let id = base, i = 2;
    while (taken.has(id)) id = base + "-" + i++;
    return id;
  }

  // ---------- window builder (embed) ----------
  function buildEmbed(app) {
    const EMBED_URL = app.url;
    const PAGE_URL = app.type === "web" ? app.url : "https://perchance.org/" + app.slug;
    const root = el("div", "pe");

    const bar = el("div", "pe-bar");
    const id = el("span", "pe-id", (app.icon || "📦") + " " + app.name);
    const chip = el("span", "pe-chip", app.type === "web" ? "website" : "Perchance app");
    const sp = el("span", "pe-spacer");
    const relBtn = el("button", "pe-btn", "⟳");
    relBtn.type = "button"; relBtn.title = "Reload app";
    const extBtn = el("button", "pe-btn pe-ext", "↗");
    extBtn.type = "button"; extBtn.title = "Open in new tab";
    bar.append(id, chip, sp, relBtn, extBtn);

    const frameWrap = el("div", "pe-frame");
    const frame = el("iframe", "pe-iframe");
    frame.setAttribute("allow", "clipboard-write; autoplay; fullscreen");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frameWrap.appendChild(frame);

    const loading = el("div", "pe-loading");
    const spin = el("div", "pe-spinner");
    const loadTxt = el("div", "pe-loading-txt", "Opening " + app.name + "…");
    const loadBtns = el("div", "pe-loading-actions");
    loadBtns.hidden = true;
    const ext2 = el("button", "set-btn", "Open in new tab");
    ext2.type = "button";
    loadBtns.appendChild(ext2);
    loading.append(spin, loadTxt, loadBtns);

    const note = el("div", "pe-note",
      app.type === "web"
        ? app.name + " runs as a website — some sites block embedding, so if it stays blank use ↗ to open it in a new tab."
        : app.name + " runs as a live Perchance generator — your data saves inside the app itself.");

    root.append(bar, loading, frameWrap, note);

    let loaded = false;
    frame.addEventListener("load", () => { loaded = true; loading.hidden = true; });
    setTimeout(() => {
      if (!loaded) {
        loadTxt.textContent = "Still loading — " + app.name + " may take a moment.";
        loading.classList.add("slow");
        loadBtns.hidden = false;
      }
    }, 12000);

    function reload() {
      loaded = false;
      loading.hidden = false;
      loadTxt.textContent = "Opening " + app.name + "…";
      loading.classList.remove("slow");
      loadBtns.hidden = true;
      frame.src = "about:blank";
      setTimeout(() => { frame.src = EMBED_URL; }, 30);
    }

    relBtn.addEventListener("click", reload);
    extBtn.addEventListener("click", () => window.open(PAGE_URL, "_blank", "noopener"));
    ext2.addEventListener("click", () => window.open(PAGE_URL, "_blank", "noopener"));

    frame.src = EMBED_URL;

    return { root, frame };
  }

  function registerBuilder(app) {
    if (!window.AppContent) window.AppContent = {};
    if (window.AppContent[app.id]) return; // never clobber built-in builders
    window.AppContent[app.id] = function () {
      const built = buildEmbed(app);
      return {
        content: built.root,
        w: 1000, h: 680, minW: 480, minH: 360,
        // Blank the iframe on close so any embedded audio/work stops.
        onCloseRequest: () => { try { built.frame.src = "about:blank"; } catch (e) {} },
      };
    };
  }

  function registerAll() { for (const app of load()) registerBuilder(app); }

  // ---------- install / uninstall ----------
  function install(rec) {
    if (!rec || !rec.id) return { ok: false, error: "Missing app id." };
    const list = load();
    if (list.some((a) => a.id === rec.id) || (window.Apps && window.Apps.getById(rec.id)))
      return { ok: false, error: "An app with the id \"" + rec.id + "\" is already installed." };
    list.push(rec);
    save(list);
    registerBuilder(rec);
    return { ok: true, app: rec };
  }

  function installFromCatalog(app) {
    if (!app || !app.slug) return { ok: false, error: "Invalid catalog entry." };
    return install({
      id: app.slug,
      slug: app.slug,
      name: app.title || prettify(app.slug),
      icon: app.icon || "🧩",
      color: validColor(app.color) || autoColor(app.slug),
      category: "My Apps",
      blurb: app.blurb || "Installed from the Software Center",
      type: "perchance",
      url: "https://null.perchance.org/" + app.slug,
    });
  }

  function uninstall(id) {
    const list = load().filter((a) => a.id !== id);
    save(list);
    if (window.AppContent) delete window.AppContent[id];
    if (window.WM) {
      const w = window.WM.findByAppId(id);
      if (w && window.WM.close) window.WM.close(w.id);
    }
  }

  registerAll();

  window.AppStore = {
    getApps: load,
    isInstalled,
    install,
    installFromCatalog,
    uninstall,
    parseSlug,
    normalizeUrl,
    prettyName: prettify,
    autoColor,
    uniqueId,
    buildEmbed,
    registerBuilders: registerAll,
  };
})();
