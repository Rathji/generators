// Webuntu OS — Image Viewer (Phase 6, Task 32)
// A windowed image viewer with fit / 1:1 / zoom-in / zoom-out / pan, and
// prev/next navigation when several images are open together. Can open:
//   • any image URL (http/https/data/blob) pasted in the address bar,
//   • a virtual-FS image file (a file whose meta.content is an image URL),
//     which also collects its sibling image files in the same folder for
//     prev/next (window.ImageViewer.openPath),
//   • the built-in wallpapers (window.ImageViewer.openUrl with a
//     "wallpaper:<name>" source).
// Unloadable images show a graceful error state instead of a broken frame.
// The Start-menu launch (catalog builder) opens the viewer on the current
// wallpaper as a demo.

(function () {
  "use strict";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function baseName(path) {
    const p = String(path || "").split("/").filter(Boolean);
    return p.length ? p[p.length - 1] : (path || "");
  }
  function isImageUrl(s) {
    return typeof s === "string" && /^(https?:|data:image|blob:)/i.test(s);
  }

  // A built-in wallpaper as an inline SVG data-URI, painted from the *current*
  // theme/accent tokens so it always matches the active palette.
  function wallpaperDataUri(name) {
    function tok(t) {
      return getComputedStyle(document.documentElement).getPropertyValue(t).trim();
    }
    const accent = tok("--accent") || "#7c6cff";
    const accent2 = tok("--accent2") || "#22d3ee";
    const isLight = (document.documentElement.getAttribute("data-theme") || "dark") === "light";
    const bg = isLight ? "#f5f6fa" : "#0a0e17";
    const g1 = isLight ? "#ffffff" : "#141b2d";
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='800' viewBox='0 0 1280 800'>";
    if (name === "gradient") {
      s += "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
        "<stop offset='0' stop-color='" + accent + "'/><stop offset='0.55' stop-color='" + accent2 + "'/><stop offset='1' stop-color='" + bg + "'/></linearGradient></defs>";
      s += "<rect width='1280' height='800' fill='url(#g)'/>";
    } else if (name === "grid") {
      s += "<rect width='1280' height='800' fill='" + bg + "'/>";
      s += "<defs><pattern id='p' width='64' height='64' patternUnits='userSpaceOnUse'>" +
        "<path d='M64 0H0V64' fill='none' stroke='" + accent2 + "' stroke-opacity='0.18'/></pattern></defs>";
      s += "<rect width='1280' height='800' fill='url(#p)'/>";
      s += "<circle cx='380' cy='260' r='230' fill='" + accent + "' fill-opacity='0.22'/>";
      s += "<circle cx='900' cy='560' r='260' fill='" + accent2 + "' fill-opacity='0.16'/>";
    } else { // radial (default)
      s += "<defs><radialGradient id='r' cx='50%' cy='38%' r='75%'>" +
        "<stop offset='0' stop-color='" + accent + "'/><stop offset='0.55' stop-color='" + accent2 + "' stop-opacity='0.55'/><stop offset='1' stop-color='" + bg + "'/></radialGradient></defs>";
      s += "<rect width='1280' height='800' fill='url(#r)'/>";
    }
    // vignette + a soft card grid for the radial look
    s += "<rect width='1280' height='800' fill='" + g1 + "' fill-opacity='" + (isLight ? "0.10" : "0.14") + "'/>";
    s += "</svg>";
    return "data:image/svg+xml;utf8," + encodeURIComponent(s);
  }

  const BUILTIN_WALLPAPERS = ["radial", "gradient", "grid", "network"];

  // ---------- instance ----------
  function createViewer(opts) {
    const v = {
      root: el("div", "iv"),
      url: null,          // current src ("" = none)
      images: [],         // [{src, label}]
      index: 0,
      scale: 1,           // CSS transform scale
      fit: true,          // fit-to-window mode
      w: null,
      _img: null,         // <img> element
    };

    // ---- toolbar ----
    const bar = el("div", "iv-bar");
    const addr = el("input", "iv-addr");
    addr.type = "text";
    addr.placeholder = "Paste an image URL (or wallpaper:radial, wallpaper:gradient, wallpaper:grid, wallpaper:network)…";
    addr.spellcheck = false;
    const goBtn = el("button", "set-btn", "Open");
    goBtn.type = "button";
    const nav = el("div", "iv-nav");
    const prevBtn = el("button", "set-btn", "‹");
    prevBtn.type = "button"; prevBtn.title = "Previous image";
    const countEl = el("span", "iv-count", "");
    const nextBtn = el("button", "set-btn", "›");
    nextBtn.type = "button"; nextBtn.title = "Next image";
    nav.append(prevBtn, countEl, nextBtn);
    const tools = el("div", "iv-tools");
    const fitBtn = el("button", "set-btn", "⤢ Fit");
    fitBtn.type = "button"; fitBtn.title = "Fit to window";
    const oneBtn = el("button", "set-btn", "1:1");
    oneBtn.type = "button"; oneBtn.title = "Actual size";
    const ziBtn = el("button", "set-btn", "＋");
    ziBtn.type = "button"; ziBtn.title = "Zoom in (wheel up / +)";
    const zoBtn = el("button", "set-btn", "−");
    zoBtn.type = "button"; zoBtn.title = "Zoom out (wheel down / −)";
    tools.append(fitBtn, oneBtn, ziBtn, zoBtn);
    bar.append(addr, goBtn, nav, tools);

    // ---- stage ----
    const stage = el("div", "iv-stage");
    const img = el("img", "iv-img");
    img.alt = "";
    img.draggable = false;
    v._img = img;
    const empty = el("div", "iv-empty",
      "No image open.\nPaste an image URL above, or open one from the File Manager.");
    const errBox = el("div", "iv-err", "That image couldn't be loaded.");
    errBox.hidden = true;
    stage.append(img, empty, errBox);

    v.root.append(bar, stage);

    // ---------- rendering ----------
    function label(i) { return v.images[i] ? v.images[i].label : ""; }

    function setError(on) {
      errBox.hidden = !on;
      img.hidden = on;
      empty.hidden = on ? true : !v.url;
    }

    function applyTransform() {
      const stageW = stage.clientWidth, stageH = stage.clientHeight;
      if (v.fit && v.images[v.index]) {
        const natW = img.naturalWidth || v.images[v.index].width || stageW;
        const natH = img.naturalHeight || v.images[v.index].height || stageH;
        const s = Math.min(stageW / natW, stageH / natH, 1);
        img.style.transform = "translate(-50%,-50%) scale(" + s + ")";
        v.scale = s;
      } else {
        img.style.transform = "translate(-50%,-50%) scale(" + (v.scale || 1) + ")";
      }
    }

    function showImage() {
      if (!v.images.length) {
        v.url = null;
        img.hidden = true; empty.hidden = false; errBox.hidden = true;
        countEl.textContent = "";
        addr.value = "";
        return;
      }
      v.index = Math.max(0, Math.min(v.index, v.images.length - 1));
      const entry = v.images[v.index];
      v.url = entry.src;
      addr.value = entry.src;
      countEl.textContent = v.images.length > 1 ? (v.index + 1) + " / " + v.images.length : "";
      empty.hidden = true; errBox.hidden = true; img.hidden = false;
      img.onload = () => {
        img.hidden = false; errBox.hidden = true;
        applyTransform();
      };
      img.onerror = () => {
        img.hidden = true; errBox.hidden = false; empty.hidden = true;
      };
      img.src = entry.src;
      if (v.w) window.WM.setTitle(v.w.id, entry.label || baseName(entry.src) || "Image Viewer");
    }

    function openUrls(urls, start, title) {
      v.images = urls.map((u) => (typeof u === "string" ? { src: u, label: title } : u));
      v.index = start || 0;
      v.scale = 1; v.fit = true;
      showImage();
    }

    // ---------- actions ----------
    function navigate(dir) {
      if (v.images.length < 2) return;
      v.index = (v.index + dir + v.images.length) % v.images.length;
      v.scale = 1; v.fit = true;
      showImage();
    }
    function setFit() { v.fit = true; applyTransform(); }
    function setOne() { v.fit = false; v.scale = 1; applyTransform(); }
    function zoom(delta) {
      v.fit = false;
      v.scale = Math.max(0.05, Math.min(16, (v.scale || 1) * delta));
      applyTransform();
    }
    function fitZoom() {
      if (v.fit) return;
      const stageW = stage.clientWidth, stageH = stage.clientHeight;
      const natW = img.naturalWidth || stageW, natH = img.naturalHeight || stageH;
      const s = Math.min(stageW / natW, stageH / natH, 1);
      v.scale = s;
      applyTransform();
    }

    // wheel zoom (centered on pointer, best-effort)
    stage.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      if (!v.images[v.index] || img.hidden) return;
      zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    // pan by dragging
    let dragging = null;
    img.addEventListener("pointerdown", (ev) => {
      if (v.fit) return;
      dragging = { x: ev.clientX, y: ev.clientY, tx: 0, ty: 0 };
      img.setPointerCapture(ev.pointerId);
    });
    img.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - dragging.x, dy = ev.clientY - dragging.y;
      dragging.x = ev.clientX; dragging.y = ev.clientY;
      const m = new DOMMatrix(getComputedStyle(img).transform);
      img.style.transform = "translate(calc(-50% + " + (m.e + dx) + "px), calc(-50% + " + (m.f + dy) + "px)) scale(" + (v.scale || 1) + ")";
    });
    img.addEventListener("pointerup", () => { dragging = null; });

    fitBtn.addEventListener("click", setFit);
    oneBtn.addEventListener("click", setOne);
    ziBtn.addEventListener("click", () => zoom(1.25));
    zoBtn.addEventListener("click", () => zoom(1 / 1.25));
    prevBtn.addEventListener("click", () => navigate(-1));
    nextBtn.addEventListener("click", () => navigate(1));
    goBtn.addEventListener("click", () => openFromAddress());
    addr.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); openFromAddress(); }
    });
    window.addEventListener("resize", () => { if (v.fit) applyTransform(); });
    stage.addEventListener("dblclick", () => { setFit(); });

    function openFromAddress() {
      const raw = addr.value.trim();
      if (!raw) return;
      if (raw.startsWith("wallpaper:")) {
        const name = raw.slice("wallpaper:".length).trim();
        if (BUILTIN_WALLPAPERS.includes(name)) {
          openUrls([{ src: wallpaperDataUri(name), label: "Wallpaper — " + name }], 0, "Wallpaper — " + name);
          return;
        }
      }
      if (isImageUrl(raw)) {
        openUrls([raw], 0);
        return;
      }
      // not a URL — try a FS path
      const res = window.FSPath.lookup(raw);
      if (res.ok && window.FS.isFile(res.node)) {
        const src = res.node.meta && res.node.meta.content;
        if (isImageUrl(src)) { openUrls([{ src, label: res.node.name }], 0, res.node.name); return; }
      }
      setError(true);
    }

    // keyboard: +/- zoom, arrows prev/next, 0 fit (only while this viewer's
    // window is focused — routed by a shared listener, see below)
    v.onKey = function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (document.activeElement === addr) return;
      switch (ev.key) {
        case "+": case "=": ev.preventDefault(); zoom(1.25); break;
        case "-": case "_": ev.preventDefault(); zoom(1 / 1.25); break;
        case "0": ev.preventDefault(); setFit(); break;
        case "ArrowLeft": ev.preventDefault(); navigate(-1); break;
        case "ArrowRight": ev.preventDefault(); navigate(1); break;
        case "f": case "F": ev.preventDefault(); setFit(); break;
        default: return;
      }
    };

    v.openUrl = function (src, title) {
      openUrls([{ src, label: title || baseName(src) }], 0, title || baseName(src));
    };
    v.openUrls = openUrls;

    showImage();
    return v;
  }

  // ---------- shared document keyboard handler (routes to focused viewer) ----------
  const viewers = new Set();
  function onDocKeydown(ev) {
    const w = window.WM && window.WM.getFocused && window.WM.getFocused();
    if (!w || w.closed) return;
    for (const v of viewers) {
      if (v.root.closest && v.root.closest(".window") === w.el) {
        v.onKey(ev);
        return;
      }
    }
  }
  if (!window.__ivKeyListener) {
    window.__ivKeyListener = true;
    document.addEventListener("keydown", onDocKeydown);
  }

  function mountViewer(v) {
    setTimeout(() => {
      const winEl = v.root.closest(".window");
      const win = (window.WM.windows || []).find((x) => x.el === winEl);
      if (win) {
        v.w = win;
        viewers.add(v);
        win.onCloseRequest = () => { viewers.delete(v); };
      }
    }, 60);
  }

  function launch(content, opts) {
    opts = opts || {};
    const w = window.WM.open({
      appId: opts.appId || "image-viewer:" + (opts.url || "none"),
      title: opts.title || "Image Viewer",
      icon: "🖼️",
      singleton: opts.singleton === true,
      w: 720, h: 520, minW: 380, minH: 300,
      content,
    });
    return w;
  }

  // Open one URL (public API).
  function openUrl(src, opts) {
    opts = opts || {};
    const v = createViewer({});
    const w = launch(v.root, { appId: opts.appId || "image-viewer:" + src, title: opts.title || baseName(src), singleton: opts.singleton });
    mountViewer(v);
    setTimeout(() => v.openUrl(src, opts.title), 60);
    return w;
  }

  // Open a virtual-FS image file, collecting sibling image files for prev/next.
  function openPath(path, opts) {
    opts = opts || {};
    const res = window.FSPath.lookup(path);
    if (!res.ok || !window.FS.isFile(res.node)) return null;
    const src = res.node.meta && res.node.meta.content;
    if (!isImageUrl(src)) return null;
    const parent = window.FS.getParent(res.node);
    const siblings = (parent && parent.children || [])
      .filter((c) => window.FS.isFile(c) && isImageUrl(c.meta && c.meta.content))
      .map((c) => ({ src: c.meta.content, label: c.name }));
    const idx = Math.max(0, siblings.findIndex((s) => s.src === src));
    const v = createViewer({});
    const w = launch(v.root, { appId: "image-viewer:" + res.path, title: res.node.name, singleton: opts.singleton === true });
    mountViewer(v);
    setTimeout(() => v.openUrls(siblings, idx, res.node.name), 60);
    return w;
  }

  // The app's content builder (Start-menu launch): opens the current wallpaper.
  window.AppContent = window.AppContent || {};
  window.AppContent["image-viewer"] = function () {
    const v = createViewer({});
    mountViewer(v);
    setTimeout(() => v.openUrls([{ src: wallpaperDataUri("radial"), label: "Wallpaper — Radial Glow" }], 0, "Wallpaper — Radial Glow"), 60);
    return { content: v.root, w: 720, h: 520, minW: 380, minH: 300 };
  };

  window.ImageViewer = { openUrl, openPath };
})();
