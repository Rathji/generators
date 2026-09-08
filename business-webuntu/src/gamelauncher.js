// Webuntu OS — Game Window launcher (Phase 6, Tasks 38-40)
// The double-click destination for BGN game shortcuts. Games open in their own
// themed window with an embedded generator iframe
// (https://null.perchance.org/<slug> — the platform auto-redirects to the
// generator's real subdomain), a toolbar (Reload / Open in new tab / Close),
// and a player-count chip. Coming-soon games get a themed dialog instead that
// offers "Visit the hub instead" (opens the BGN hub inside a Browser window)
// or "Back to games".
//
// Exposes window.GameLauncher:
//   open(node)        — launch a game shortcut node (dispatch on meta)
//   openEmbed(slug)   — open an embed window for any slug (hub fallback)
//   comingSoon(node)  — themed coming-soon dialog for a shortcut node

(function () {
  "use strict";

  const HUB_SLUG = "bgn-boardgame-network";

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
    const c = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!c) return { background: fallback };
    const hex = c[1];
    return { background: `linear-gradient(140deg, #${hex}cc, #${hex}55)` };
  }

  function openInTab(slug) {
    if (slug) window.open("https://perchance.org/" + slug, "_blank", "noopener");
  }

  // ---------- embed window (Task 38; arcade chrome Task 42) ----------
  function openEmbed(slug, opts) {
    opts = opts || {};
    const root = el("div", "gl");
    const bar = el("div", "gl-bar");

    const id = el("span", "gl-id", (opts.icon || "🎮") + "  " + (opts.title || slug));
    const eraChip = el("span", "gl-chip");
    eraChip.hidden = !opts.eraChip;
    if (opts.eraChip) eraChip.textContent = opts.eraChip;
    const chip = el("span", "gl-chip");
    chip.hidden = !opts.players;
    if (opts.players) chip.textContent = opts.players;
    const sp = el("span", "gl-spacer");
    const relBtn = el("button", "gl-btn", "⟳");
    relBtn.type = "button"; relBtn.title = "Reload game";
    const extBtn = el("button", "gl-btn", "↗");
    extBtn.type = "button"; extBtn.title = "Open in new tab";
    const clBtn = el("button", "gl-btn gl-close", "✕");
    clBtn.type = "button"; clBtn.title = "Close";
    bar.append(id, eraChip, chip, sp, relBtn, extBtn, clBtn);

    const frameWrap = el("div", "gl-frame");
    const frame = el("iframe", "gl-iframe");
    frame.setAttribute("allow", "clipboard-write; autoplay; fullscreen");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frameWrap.appendChild(frame);

    // Loading overlay: a spinner + hint, and after ~12s a slow-load affordance
    // (embed failures are hard to detect directly, so the overlay offers the
    // direct-link fallback instead of blocking forever).
    const loading = el("div", "gl-loading");
    const spin = el("div", "gl-spinner");
    const loadTxt = el("div", "gl-loading-txt", "Loading " + (opts.title || slug) + "…");
    const loadBtns = el("div", "gl-loading-actions");
    loadBtns.hidden = true;
    const ext2 = el("button", "set-btn", "Open in new tab");
    ext2.type = "button";
    const back2 = el("button", "set-btn", "Back to games");
    back2.type = "button";
    loadBtns.append(ext2, back2);
    loading.append(spin, loadTxt, loadBtns);

    root.append(bar, loading, frameWrap);

    let loaded = false;
    let slow = false;
    frame.addEventListener("load", () => {
      loaded = true;
      loading.hidden = true;
    });
    setTimeout(() => {
      if (!loaded) {
        slow = true;
        loadTxt.textContent = "Still loading — " + (opts.title || slug) + " may take a moment.";
        loading.classList.add("slow");
        loadBtns.hidden = false;
      }
    }, 12000);

    function reload() {
      loading.hidden = false;
      loadTxt.textContent = "Loading " + (opts.title || slug) + "…";
      loading.classList.remove("slow");
      loadBtns.hidden = true;
      frame.src = "about:blank";
      setTimeout(() => { frame.src = "https://null.perchance.org/" + slug; }, 30);
    }

    relBtn.addEventListener("click", reload);
    extBtn.addEventListener("click", () => openInTab(slug));
    ext2.addEventListener("click", () => openInTab(slug));
    back2.addEventListener("click", () => { if (w) window.WM.close(w.id); });
    clBtn.addEventListener("click", () => { if (w) window.WM.close(w.id); });

    frame.src = "https://null.perchance.org/" + slug;

    let w = window.WM.open({
      appId: "game:" + slug,
      title: opts.title || slug,
      icon: opts.icon || "🎮",
      singleton: false,
      w: opts.w || 900, h: opts.h || 620, minW: 480, minH: 360,
      content: root,
    });
    // Task 42 — VGN games get arcade-styled window chrome: a tinted title-bar
    // gradient driven by the game's color, plus the marquee scanline overlay.
    if (w && opts.arcade) {
      w.el.classList.add("gl-arcade");
      w.el.style.setProperty("--gl-tint", opts.color || "#7c6cff");
    }
    // Stop embedded audio/music when the window closes (iframe src reset).
    // WM.open doesn't carry extra window fields, so attach the hook directly.
    if (w) w.onCloseRequest = () => { try { frame.src = "about:blank"; } catch (e) {} };
    return w;
  }

  // ---------- coming-soon dialog (Tasks 38/40) ----------
  // A full-desktop overlay (never a native alert): themed card with the game's
  // tile, a "Soon" chip, and actions. "Visit the hub instead" opens the BGN
  // hub inside a Browser window; "Back to games" just dismisses.
  function comingSoon(node) {
    const m = node.meta || {};
    const hub = m.hubSlug || HUB_SLUG;
    const hubName = m.hubName || "Boardgame Network";
    const wrap = el("div", "gl-dialog-wrap");
    const box = el("div", "gl-dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    const tile = el("div", "gl-dialog-tile", node.icon || "🎮");
    Object.assign(tile.style, tileStyle(node.color));
    if (m.era) tile.classList.add("tile-vgn");
    const soon = el("span", "fm-soon", "Soon");
    const h = el("h3", null, node.name);
    const p = el("p", null,
      "This game is still being built on the " + hubName + ". " +
      "It'll show up here the moment it launches — until then, the hub is a " +
      "great place to explore what's already out there.");
    const actions = el("div", "gl-dialog-actions");
    const back = el("button", "set-btn", "Back to games");
    back.type = "button";
    const hubBtn = el("button", "set-btn", "Visit the hub instead");
    hubBtn.type = "button";
    actions.append(back, hubBtn);

    if (m.players) {
      const row = el("div", "gl-dialog-players");
      row.appendChild(el("span", "gl-chip", m.players));
      box.append(tile, soon, h, p, row, actions);
    } else {
      box.append(tile, soon, h, p, actions);
    }
    wrap.appendChild(box);

    const desktop = document.getElementById("desktop") || document.body;
    desktop.appendChild(wrap);

    function dismiss() { wrap.remove(); }
    back.addEventListener("click", dismiss);
    hubBtn.addEventListener("click", () => {
      dismiss();
      if (window.Browser && window.Browser.navigate) window.Browser.navigate(hub);
      else if (m.target) openInTab(m.target);
      else openInTab(hub);
    });
    wrap.addEventListener("mousedown", (ev) => { if (ev.target === wrap) dismiss(); });
    box.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); dismiss(); }
    });
    setTimeout(() => hubBtn.focus(), 30);
    return wrap;
  }

  // ---------- public API ----------
  function open(node) {
    const m = node.meta || {};
    if (m.comingSoon) return comingSoon(node);
    const eraChip = m.era
      ? (m.eraName || m.era) + (m.year && m.year !== "TBD" ? " · " + m.year : "")
      : null;
    return openEmbed(m.target, {
      title: node.name,
      icon: node.icon,
      players: m.players,
      color: node.color,
      eraChip,
      arcade: !!m.era,
    });
  }

  window.GameLauncher = { open, openEmbed, comingSoon };
})();
