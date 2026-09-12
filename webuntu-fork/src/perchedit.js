// Webuntu OS — Perch Edit app (Phase 10, Task 78, re-scoped)
// A first-class Start-menu app that opens the real perch-edit IDE
// (https://perchance.org/perch-edit) embedded in a Browser-style window via the
// standard in-OS generator embed (https://null.perchance.org/perch-edit — the
// platform auto-redirects to the generator's real subdomain). Toolbar: Reload
// and an "Open in new tab ↗" fallback; a 12s slow-load overlay offers the same
// fallback if the embed stalls (the Browser / Game Launcher model).
//
// Scope note (Task 78 re-scope): the perch-edit-plugin wrapper was evaluated
// live and found redundant — its embed() emits the very same iframe Webuntu
// already uses for every generator — so this app embeds the generator directly
// instead of importing the plugin. PerchEdit keeps its own project tree in the
// embed's own IndexedDB origin; it cannot open files from Webuntu's virtual FS,
// so the native Text Editor stays the handler for .txt/code files, and
// `open perch-edit` in the Terminal routes here via the app catalog.
//
// Registers window.AppContent["perch-edit"] (the apps.js launch path).
// Singleton: re-opening focuses the existing window instead of re-embedding.

(function () {
  "use strict";

  const SLUG = "perch-edit";
  const EMBED_URL = "https://null.perchance.org/" + SLUG;
  const PAGE_URL = "https://perchance.org/" + SLUG;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function openInTab() {
    window.open(PAGE_URL, "_blank", "noopener");
  }

  function build() {
    const root = el("div", "pe");

    const bar = el("div", "pe-bar");
    const id = el("span", "pe-id", "⌨️ Perch Edit");
    const chip = el("span", "pe-chip", "projects save in your browser");
    const sp = el("span", "pe-spacer");
    const relBtn = el("button", "pe-btn", "⟳");
    relBtn.type = "button"; relBtn.title = "Reload editor";
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
    const loadTxt = el("div", "pe-loading-txt", "Loading Perch Edit…");
    const loadBtns = el("div", "pe-loading-actions");
    loadBtns.hidden = true;
    const ext2 = el("button", "set-btn", "Open in new tab");
    ext2.type = "button";
    loadBtns.appendChild(ext2);
    loading.append(spin, loadTxt, loadBtns);

    const note = el("div", "pe-note",
      "Perch Edit keeps its own project files in the browser — use Webuntu's Text Editor (📝) for files on your virtual disk.");

    root.append(bar, loading, frameWrap, note);

    let loaded = false;
    frame.addEventListener("load", () => { loaded = true; loading.hidden = true; });
    setTimeout(() => {
      if (!loaded) {
        loadTxt.textContent = "Still loading — Perch Edit may take a moment.";
        loading.classList.add("slow");
        loadBtns.hidden = false;
      }
    }, 12000);

    function reload() {
      loaded = false;
      loading.hidden = false;
      loadTxt.textContent = "Loading Perch Edit…";
      loading.classList.remove("slow");
      loadBtns.hidden = true;
      frame.src = "about:blank";
      setTimeout(() => { frame.src = EMBED_URL; }, 30);
    }

    relBtn.addEventListener("click", reload);
    extBtn.addEventListener("click", openInTab);
    ext2.addEventListener("click", openInTab);

    frame.src = EMBED_URL;

    return { root, frame };
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["perch-edit"] = function () {
    const built = build();
    return {
      content: built.root,
      w: 1000, h: 680, minW: 480, minH: 360,
      // Blank the iframe on close so any embedded audio/work stops.
      onCloseRequest: () => { try { built.frame.src = "about:blank"; } catch (e) {} },
    };
  };

  window.PerchEdit = {
    open() {
      if (window.Apps) window.Apps.launch("perch-edit");
      return window.WM.findByAppId("perch-edit") || null;
    },
  };
})();
