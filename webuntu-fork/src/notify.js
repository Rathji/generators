// Webuntu OS — Notifications center (POST-52, Task 58)
// A tray bell (#trayBell) with an unseen-count badge, a popover notification
// center (#notifPanel), and transient toast popups (#toastHost). Apps push
// through window.Notify.push({app, icon, title, body, onClick, silent}).
// Notifications are in-session only (they clear on reload, like a real quick
// panel); the toggles persist in webuntu.settings (uiNotifications controls
// toasts, notifySounds controls the toast blip).

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";
  const MAX_ITEMS = 50;
  const MAX_TOASTS = 4;
  const TOAST_MS = 6000;

  let idSeq = 1;
  let items = [];
  let unseen = 0;

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(loadSettings(), patch))); }
    catch (e) {}
  }
  function toastsEnabled() { return loadSettings().uiNotifications !== false; }
  function toastSoundOn() { return loadSettings().notifySounds !== false; }

  const bellBtn = document.getElementById("trayBell");
  const bellBadge = bellBtn && bellBtn.querySelector(".to-badge");
  const panel = document.getElementById("notifPanel");
  const listEl = document.getElementById("notifList");
  const emptyEl = document.getElementById("notifEmpty");
  const clearBtn = document.getElementById("notifClear");
  const toastHost = document.getElementById("toastHost");

  // ---------- rendering ----------
  function renderBadge() {
    if (!bellBadge) return;
    bellBadge.textContent = unseen > 9 ? "9+" : unseen || "";
    bellBadge.hidden = unseen === 0;
  }

  function whenStr(ts) {
    const d = new Date(ts);
    const sameDay = d.toDateString() === new Date().toDateString();
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return sameDay ? hm
      : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + hm;
  }

  function renderPanel() {
    if (!listEl) return;
    listEl.textContent = "";
    if (emptyEl) emptyEl.hidden = items.length > 0;
    if (clearBtn) clearBtn.disabled = items.length === 0;
    for (const it of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "notif-item";
      row.title = it.app + " — " + (it.title || "");
      const ico = document.createElement("span");
      ico.className = "n-ico";
      ico.textContent = it.icon;
      const body = document.createElement("span");
      body.className = "n-body";
      const app = document.createElement("span");
      app.className = "n-app";
      app.textContent = it.app;
      const title = document.createElement("span");
      title.className = "n-title";
      title.textContent = it.title || "";
      body.append(app, title);
      if (it.body) {
        const txt = document.createElement("span");
        txt.className = "n-txt";
        txt.textContent = it.body;
        body.appendChild(txt);
      }
      const when = document.createElement("span");
      when.className = "n-when";
      when.textContent = whenStr(it.ts);
      row.append(ico, body, when);
      row.addEventListener("click", () => {
        items = items.filter((x) => x !== it);
        closePanel();
        renderPanel();
        if (it.onClick) { try { it.onClick(); } catch (e) {} }
      });
      listEl.appendChild(row);
    }
  }

  function openPanel() {
    if (window.StartMenu) window.StartMenu.close();
    if (window.SystemBar) window.SystemBar.closePopups();
    unseen = 0;
    panel.hidden = false;
    if (bellBtn) bellBtn.classList.add("active");
    renderPanel();
    renderBadge();
  }
  function closePanel() {
    panel.hidden = true;
    if (bellBtn) bellBtn.classList.remove("active");
  }

  if (bellBtn) bellBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (panel.hidden) openPanel(); else closePanel();
  });
  if (clearBtn) clearBtn.addEventListener("click", () => {
    items = [];
    renderPanel();
  });

  // ---------- toasts ----------
  let activeToasts = [];
  function showToast(it) {
    if (!toastHost) return;
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "alert");
    const ico = document.createElement("div");
    ico.className = "toast-ico";
    ico.textContent = it.icon;
    const body = document.createElement("div");
    body.className = "toast-body";
    const app = document.createElement("div");
    app.className = "toast-app";
    app.textContent = it.app;
    const title = document.createElement("div");
    title.className = "toast-title";
    title.textContent = it.title || "";
    body.append(app, title);
    if (it.body) {
      const txt = document.createElement("div");
      txt.className = "toast-txt";
      txt.textContent = it.body;
      body.appendChild(txt);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.className = "toast-x";
    x.textContent = "✕";
    x.setAttribute("aria-label", "Dismiss notification");
    const bar = document.createElement("div");
    bar.className = "toast-progress";
    t.append(ico, body, x, bar);

    let done = false;
    function dismiss() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      t.classList.remove("in");
      t.classList.add("out");
      setTimeout(() => t.remove(), 420);
      activeToasts = activeToasts.filter((el) => el !== t);
    }
    function fire() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      t.remove();
      activeToasts = activeToasts.filter((el) => el !== t);
      if (it.onClick) { try { it.onClick(); } catch (e) {} }
    }
    const timer = setTimeout(dismiss, TOAST_MS);
    x.addEventListener("click", (ev) => { ev.stopPropagation(); dismiss(); });
    t.addEventListener("click", fire);
    toastHost.appendChild(t);
    activeToasts.push(t);
    while (activeToasts.length > MAX_TOASTS) {
      const old = activeToasts.shift();
      old.classList.add("out");
      setTimeout(() => old.remove(), 420);
    }
    // add .in a tick after append so the entry transition actually plays
    setTimeout(() => t.classList.add("in"), 25);
    // Fallback for a wedged renderer (rAF/compositor frozen): if the slide-in
    // transition can't advance, force the final position after its window so
    // the toast is still visible.
    setTimeout(() => {
      if (t.isConnected && !t.classList.contains("out")) {
        t.style.transform = "none";
        t.style.opacity = "1";
      }
    }, 600);
  }

  // ---------- API ----------
  function push(opts) {
    opts = opts || {};
    const it = {
      id: idSeq++,
      app: String(opts.app || "Webuntu"),
      icon: String(opts.icon || "🔔"),
      title: String(opts.title || ""),
      body: String(opts.body || ""),
      ts: Date.now(),
      onClick: typeof opts.onClick === "function" ? opts.onClick : null,
    };
    items.unshift(it);
    if (items.length > MAX_ITEMS) items.pop();
    if (toastsEnabled() && opts.silent !== true) {
      showToast(it);
      if (window.Sounds && toastSoundOn()) window.Sounds.blip(880, 1320, 0.12, 0.22);
    }
    if (panel.hidden) unseen++; else unseen = 0;
    renderPanel();
    renderBadge();
    return it;
  }

  window.Notify = {
    push,
    clear() { items = []; renderPanel(); },
    open() { openPanel(); },
    // Transient toast only — no notification-center entry (Task 67 uses it
    // for clipboard feedback so file ops don't spam the bell).
    toast(title, body, opts) {
      opts = opts || {};
      const it = {
        id: idSeq++,
        app: String(opts.app || "Webuntu"),
        icon: String(opts.icon || "🔔"),
        title: String(title || ""),
        body: String(body || ""),
        ts: Date.now(),
        onClick: typeof opts.onClick === "function" ? opts.onClick : null,
      };
      if (toastsEnabled()) showToast(it);
      return it;
    },
    get items() { return items.slice(); },
    get unseen() { return unseen; },
  };
})();
