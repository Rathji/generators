// Webuntu OS — Browser app (Phase 6, Task 34)
// An address-bar "web browser" that navigates the OS to any Perchance
// generator: the target is embedded via the null-perchance embed URL
// (https://null.perchance.org/<slug> — the platform auto-redirects to the
// generator's real subdomain), with Back/Forward/Reload/Home plus an
// always-available "Open in new tab" fallback. A local start page
// (browser://home) shows quick links to hubs, plugins and tools.
//
// Singleton: launching the app again focuses the open window.

(function () {
  "use strict";

  const HOME_URL = "browser://home";

  // Most recently created browser instance — lets external callers (window.Browser)
  // drive navigation in the live window even though the content object lives
  // inside a closure (Task 39 hub navigation).
  let activeBrowser = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Extract a perchance generator slug from a URL/address string, or null.
  function slugify(raw) {
    let s = String(raw || "").trim();
    if (!s) return null;
    // internal start page
    if (s === "home" || s === "browser://home" || s === "start") return "home";
    s = s.replace(/^https?:\/\//i, "");
    s = s.replace(/^www\./i, "");
    // any subdomain of perchance.org → take the path
    const m = /^(?:[\w-]+\.)*perchance\.org(?:\/([\w-]+))?$/i.exec(s);
    if (m) return m[1] || "home";
    // plain slug
    if (/^[\w-]+$/.test(s)) return s;
    return null;
  }

  const START_LINKS = [
    { slug: "bgn-boardgame-network", icon: "🎲", label: "The Boardgame Network", sub: "Board game hub" },
    { slug: "vgn-video-game-network", icon: "🕹️", label: "The Video Game Network", sub: "Video game hub" },
    { slug: "plugins", icon: "🧩", label: "Perchance Plugins", sub: "Official plugin directory" },
    { slug: "ai-text-plugin", icon: "✍️", label: "ai-text-plugin", sub: "Official AI text docs" },
    { slug: "text-to-image-plugin", icon: "🎨", label: "text-to-image-plugin", sub: "Official image docs" },
    { slug: "query-archive", icon: "🔎", label: "Perchance Archive Search", sub: "Search 110k+ generators" },
    { slug: "perch-edit", icon: "⌨️", label: "Perch Edit", sub: "Code editor for Perchance" },
    { slug: "easy-uploads", icon: "📤", label: "Easy Uploads", sub: "Host files & images" },
    { slug: "file-format-converter", icon: "🔁", label: "File Format Converter", sub: "Convert anything" },
    { slug: "atomic-roadmap", icon: "🗺️", label: "Atomic Roadmap", sub: "Plan big builds" },
  ];

  function createBrowser() {
    const b = {
      root: el("div", "br"),
      frame: null,
      history: [],
      idx: -1,
      current: HOME_URL,
      w: null,
    };

    // ---- toolbar ----
    const bar = el("div", "br-bar");
    const backBtn = el("button", "br-btn", "←");
    backBtn.type = "button"; backBtn.title = "Back (Alt+←)";
    const fwdBtn = el("button", "br-btn", "→");
    fwdBtn.type = "button"; fwdBtn.title = "Forward (Alt+→)";
    const relBtn = el("button", "br-btn", "⟳");
    relBtn.type = "button"; relBtn.title = "Reload (Ctrl+R)";
    const homeBtn = el("button", "br-btn", "⌂");
    homeBtn.type = "button"; homeBtn.title = "Home — start page";
    const addr = el("input", "br-addr");
    addr.type = "text";
    addr.placeholder = "perchance.org/<generator> or a generator name…";
    addr.spellcheck = false;
    const goBtn = el("button", "set-btn", "Go");
    goBtn.type = "button"; goBtn.title = "Navigate";
    const extBtn = el("button", "br-btn br-ext", "↗");
    extBtn.type = "button"; extBtn.title = "Open in new tab";
    bar.append(backBtn, fwdBtn, relBtn, homeBtn, addr, goBtn, extBtn);

    // ---- start page ----
    const start = el("div", "br-start");
    const stTitle = el("h2", "br-start-title", "Webuntu Browser");
    const stSub = el("p", "br-start-sub",
      "Browse any Perchance generator right inside the OS. Pick a shortcut below or type an address.");
    const grid = el("div", "br-start-grid");
    for (const link of START_LINKS) {
      const card = el("button", "br-card", "");
      card.type = "button";
      card.appendChild(el("span", "br-card-icon", link.icon));
      const txt = el("span", "br-card-text");
      txt.appendChild(el("span", "br-card-label", link.label));
      txt.appendChild(el("span", "br-card-sub", link.sub));
      card.appendChild(txt);
      card.addEventListener("click", () => go(link.slug, true));
      grid.appendChild(card);
    }
    start.append(stTitle, stSub, grid);

    // ---- iframe ----
    const frameWrap = el("div", "br-frame");
    const frame = el("iframe", "br-iframe");
    frame.setAttribute("allow", "clipboard-write; autoplay; fullscreen");
    frame.setAttribute("referrerpolicy", "no-referrer");
    b.frame = frame;
    frameWrap.appendChild(frame);

    // ---- loading state ----
    const loading = el("div", "br-loading");
    const loadSpin = el("div", "br-spinner");
    const loadTxt = el("div", "br-loading-txt", "Loading generator…");
    const loadBtns = el("div", "br-loading-actions");
    loadBtns.hidden = true;
    const ext2 = el("button", "set-btn", "Open in new tab ↗");
    ext2.type = "button";
    ext2.addEventListener("click", () => {
      if (b.current && b.current !== HOME_URL) {
        window.open("https://perchance.org/" + b.current, "_blank", "noopener");
      }
    });
    loadBtns.appendChild(ext2);
    loading.append(loadSpin, loadTxt, loadBtns);
    loading.hidden = true;
    let slowTimer = null;

    b.root.append(bar, loading, start, frameWrap);

    // Dismiss the overlay once the embed actually loads (ignoring the
    // about:blank reset between navigations); a slow embed (~12s) gets the
    // "open in new tab" fallback instead of a forever-spinning overlay.
    frame.addEventListener("load", () => {
      if (frame.src === "about:blank") return;
      clearTimeout(slowTimer);
      loading.hidden = true;
    });

    // ---------- navigation ----------
    function pushHistory(url) {
      b.history = b.history.slice(0, b.idx + 1);
      b.history.push(url);
      if (b.history.length > 100) b.history.shift();
      b.idx = b.history.length - 1;
    }
    function render() {
      const isHome = b.current === HOME_URL;
      start.hidden = !isHome;
      frameWrap.hidden = isHome;
      loading.hidden = isHome || b.current === null;
      addr.value = b.current === HOME_URL ? "" : b.current;
      backBtn.disabled = b.idx <= 0;
      fwdBtn.disabled = b.idx >= b.history.length - 1;
      if (b.w) window.WM.setTitle(b.w.id, isHome ? "Browser" : "Browser — " + b.current);
    }
    function loadFrame() {
      if (b.current === HOME_URL || b.current === null) { render(); return; }
      loading.hidden = false;
      loadTxt.textContent = "Loading generator…";
      loading.classList.remove("slow");
      loadBtns.hidden = true;
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => {
        if (loading.hidden) return;
        loadTxt.textContent = "Still loading — " + b.current + " may take a moment.";
        loading.classList.add("slow");
        loadBtns.hidden = false;
      }, 12000);
      // Reset src to force a fresh load even for the same URL (Reload).
      frame.src = "about:blank";
      setTimeout(() => {
        frame.src = "https://null.perchance.org/" + b.current;
      }, 30);
      render();
    }
    function go(target, push) {
      const slug = slugify(target);
      if (slug === null) {
        addr.value = b.current === HOME_URL ? "" : b.current;
        return;
      }
      const url = slug === "home" ? HOME_URL : slug;
      if (push) pushHistory(url);
      b.current = url;
      loadFrame();
    }
    function goBack() {
      if (b.idx <= 0) return;
      b.idx--;
      b.current = b.history[b.idx];
      loadFrame();
    }
    function goForward() {
      if (b.idx >= b.history.length - 1) return;
      b.idx++;
      b.current = b.history[b.idx];
      loadFrame();
    }
    function reload() { if (b.current !== HOME_URL) loadFrame(); }
    function goHome() {
      b.current = HOME_URL;
      pushHistory(HOME_URL);
      loadFrame();
    }

    backBtn.addEventListener("click", goBack);
    fwdBtn.addEventListener("click", goForward);
    relBtn.addEventListener("click", reload);
    homeBtn.addEventListener("click", goHome);
    goBtn.addEventListener("click", () => go(addr.value, true));
    addr.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); go(addr.value, true); }
      else if (ev.key === "Escape") { ev.preventDefault(); addr.blur(); }
    });
    extBtn.addEventListener("click", () => {
      const slug = slugify(addr.value);
      if (slug && slug !== "home") {
        window.open("https://perchance.org/" + slug, "_blank", "noopener");
      } else if (b.current && b.current !== HOME_URL) {
        window.open("https://perchance.org/" + b.current, "_blank", "noopener");
      }
    });

    // "Open in new tab" also offered on a failed embed: if the iframe can't
    // load within ~12s the user can still reach the generator directly via the
    // ↗ button, which always reflects the address bar / current page.

    // start page cards
    goHome();

    b.onMount = function () {
      const winEl = b.root.closest(".window");
      if (!winEl) return;
      const win = (window.WM.windows || []).find((x) => x.el === winEl);
      if (win) b.w = win;
    };
    // External navigation entry point (window.Browser.navigate, hub shortcuts).
    b.go = go;
    b.reload = reload;
    b.goHome = goHome;
    activeBrowser = b;
    return b;
  }

  // Task 39 — the BGN hub shortcut opens INSIDE a Browser window (with a
  // new-tab fallback). Launches/focuses the singleton Browser then navigates
  // it to the slug; returns the window.
  function navigate(slug, opts) {
    opts = opts || {};
    // External https URLs can't render inside the embed browser (X-Frame-
    // Options etc.) — deep-link them to a real tab, the OS's standard "↗"
    // fallback. Perchance URLs keep the in-OS embed flow.
    if (slug && /^https?:\/\//i.test(String(slug))) {
      if (slugify(slug) === null) {
        window.open(slug, "_blank", "noopener");
        return null;
      }
    }
    let win = window.WM.findByAppId("browser");
    if (opts.forceNew || !win) {
      if (window.Apps) window.Apps.launch("browser");
      win = window.WM.findByAppId("browser");
    } else {
      if (win.minimized) window.WM.restore(win.id); else window.WM.focus(win.id);
    }
    setTimeout(() => { if (activeBrowser) activeBrowser.go(slug, true); }, 90);
    return win || null;
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["browser"] = function () {
    const b = createBrowser();
    setTimeout(() => b.onMount(), 60);
    return { content: b.root, w: 900, h: 620, minW: 480, minH: 340 };
  };

  window.Browser = {
    navigate,
    getWindow: () => ({ win: window.WM.findByAppId("browser"), browser: activeBrowser }),
  };
})();
