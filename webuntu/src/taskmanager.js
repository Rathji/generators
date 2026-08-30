// --- TASK 88: System Task Manager (Ctrl+Shift+Esc) ---------------------------
// A windowed process manager listing every open WM window with fictional-but-
// live CPU/memory stats (shared with the System Monitor via
// SystemMonitor.procStats), stable PIDs, desktop + state chips, sortable
// columns, a filter box, and row actions: Switch to / Minimize / Restore /
// Maximize / End process (a force-close that bypasses the app's close-confirm
// hook, GNOME-kill-style). Rebuilds every TICK_MS; self-stops when detached.
(function () {
  "use strict";

  const TICK_MS = 1500;
  const PID_BASE = 1000;
  const RAM_SCALE = 900; // MB that fills a memory bar

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Reuse the System Monitor's random-walk model so both apps agree; fall back
  // to a local walk if that surface isn't loaded yet.
  const local = new Map();
  function procStats(w) {
    if (window.SystemMonitor && window.SystemMonitor.procStats) {
      return window.SystemMonitor.procStats(w);
    }
    let st = local.get(w.id);
    if (!st) {
      st = { cpu: 2 + Math.random() * 12, ram: 90 + Math.random() * 170 };
      local.set(w.id, st);
    }
    st.cpu = Math.max(0, Math.min(95, st.cpu + (Math.random() - 0.5) * 6));
    st.ram = Math.max(0, Math.min(900, st.ram + (Math.random() - 0.5) * 60));
    return st;
  }

  function stateOf(w) {
    if (w.minimized) return ["Minimized", "min"];
    if (w.maximized) return ["Maximized", "max"];
    if (w.snap) return ["Snapped", "snap"];
    if (window.WM && window.WM.focusedId === w.id) return ["Focused", "focus"];
    return ["Running", "run"];
  }

  // A fixed-track gauge (aligned bar + fixed-width right-aligned number) so
  // CPU and Memory columns line up perfectly across rows.
  function gauge(kind, value, scale) {
    const g = el("div", "tm-gauge");
    const track = el("div", "tm-track");
    const fill = el("div", "tm-fill " + kind);
    fill.style.width = Math.max(2, Math.min(100, (value / (scale || 100)) * 100)) + "%";
    track.appendChild(fill);
    const label = kind === "cpu" ? value.toFixed(0) + "%" : value.toFixed(0) + " MB";
    g.append(track, el("span", "tm-mini-text", label));
    return g;
  }

  const COLUMNS = [
    { key: "name", label: "Process", cls: "tm-flex" },
    { key: "pid", label: "PID", cls: "tm-num tm-col-pid" },
    { key: "cpu", label: "CPU", cls: "tm-num tm-col-cpu" },
    { key: "ram", label: "Memory", cls: "tm-num tm-col-ram" },
    { key: "desktop", label: "Desktop", cls: "tm-num tm-col-desktop" },
    { key: "state", label: "State", cls: "tm-num tm-col-state" },
  ];

  function build() {
    const root = el("div", "tm");

    // ---- filter box ----
    const toolbar = el("div", "tm-toolbar");
    const search = el("input", "tm-search");
    search.type = "search";
    search.placeholder = "Filter processes…";
    search.setAttribute("aria-label", "Filter processes");
    search.addEventListener("input", () => { renderBody(); });
    toolbar.appendChild(search);
    root.appendChild(toolbar);

    // ---- sortable column headers ----
    const sort = { key: "name", dir: 1 };
    const head = el("div", "tm-head");
    const headCells = [];
    for (const c of COLUMNS) {
      const h = el("button", "tm-head-cell " + c.cls);
      h.type = "button";
      h.dataset.key = c.key;
      h.setAttribute("aria-label", "Sort by " + c.label);
      h.appendChild(el("span", "tm-head-label", c.label));
      h.appendChild(el("span", "tm-head-arrow", "↕"));
      h.addEventListener("click", () => {
        if (sort.key === c.key) sort.dir = -sort.dir;
        else { sort.key = c.key; sort.dir = 1; }
        refreshHead();
        renderBody();
        if (window.Sounds) window.Sounds.play("ok");
      });
      headCells.push(h);
      head.appendChild(h);
    }
    function refreshHead() {
      for (const h of headCells) {
        const on = h.dataset.key === sort.key;
        h.classList.toggle("sorted", on);
        h.querySelector(".tm-head-arrow").textContent = on ? (sort.dir > 0 ? "↑" : "↓") : "↕";
      }
    }
    root.appendChild(head);

    // ---- process rows ----
    const body = el("div", "tm-body");
    body.tabIndex = 0;
    body.setAttribute("role", "listbox");
    body.setAttribute("aria-label", "Running processes");
    root.appendChild(body);

    // ---- action bar ----
    const actions = el("div", "tm-actions");
    const switchBtn = el("button", "tm-btn", "🔀 Switch to");
    const minBtn = el("button", "tm-btn", "▁ Minimize");
    const maxBtn = el("button", "tm-btn", "⛶ Maximize");
    const endBtn = el("button", "tm-btn tm-danger", "✕ End process…");
    actions.append(switchBtn, minBtn, maxBtn, el("span", "tm-spacer"), endBtn);
    root.appendChild(actions);

    // ---- two-step end-process confirm (GNOME style) ----
    const confirm = el("div", "tm-confirm");
    confirm.hidden = true;
    const confirmText = el("span", "tm-confirm-text", "");
    const confirmYes = el("button", "tm-btn tm-danger", "End process");
    const confirmNo = el("button", "tm-btn", "Cancel");
    confirm.append(confirmText, confirmYes, confirmNo);
    root.appendChild(confirm);

    // ---- footer summary ----
    const footer = el("div", "tm-footer", "");
    root.appendChild(footer);

    let rows = [];
    let selectedId = null;
    let confirmingId = null;

    // ---------- rendering ----------
    function visibleWindows() {
      const q = search.value.trim().toLowerCase();
      let wins = (window.WM && window.WM.windows) ? window.WM.windows.slice() : [];
      if (q) {
        wins = wins.filter((w) => (w.title + " " + (w.appId || "")).toLowerCase().includes(q));
      }
      return wins;
    }

    function sortRows(list) {
      const dir = sort.dir;
      const a = list.slice();
      a.sort((x, y) => {
        const k = sort.key;
        let v = 0;
        if (k === "pid") v = x.w.id - y.w.id;
        else if (k === "cpu") v = x.st.cpu - y.st.cpu;
        else if (k === "ram") v = x.st.ram - y.st.ram;
        else if (k === "desktop") v = (x.w.desktop || 1) - (y.w.desktop || 1);
        else if (k === "state") v = String(x.state[0]).localeCompare(String(y.state[0]));
        else v = String(x.w.title).localeCompare(String(y.w.title));
        return v * dir;
      });
      return a;
    }

    function rowFor(w) {
      const st = procStats(w);
      const state = stateOf(w);
      const row = el("div", "tm-row");
      row.dataset.wid = w.id;
      row.setAttribute("role", "option");

      const name = el("div", "tm-cell tm-flex");
      name.appendChild(el("span", "tm-ico", w.icon || "📄"));
      const title = el("span", "tm-name", w.title);
      title.title = w.title;
      name.appendChild(title);
      row.appendChild(name);

      row.appendChild(el("div", "tm-cell tm-num tm-col-pid tm-pid", String(PID_BASE + w.id)));

      const cpu = el("div", "tm-cell tm-num tm-col-cpu");
      cpu.appendChild(gauge("cpu", st.cpu));
      row.appendChild(cpu);

      const mem = el("div", "tm-cell tm-num tm-col-ram");
      mem.appendChild(gauge("ram", st.ram, RAM_SCALE));
      row.appendChild(mem);

      const desk = el("div", "tm-cell tm-num tm-col-desktop");
      const cur = window.Workspaces && window.Workspaces.current === w.desktop;
      desk.appendChild(el("span", "tm-chip" + (cur ? " tm-chip-cur" : ""), "Desktop " + (w.desktop || 1)));
      row.appendChild(desk);

      const stc = el("div", "tm-cell tm-num tm-col-state");
      stc.appendChild(el("span", "tm-chip tm-state " + state[1], state[0]));
      row.appendChild(stc);

      return { w, st, state, row };
    }

    function renderBody() {
      if (!document.body.contains(root)) return false;
      const wins = visibleWindows();
      const keyed = new Map(wins.map((w) => [String(w.id), w]));
      if (selectedId !== null && !keyed.has(String(selectedId))) selectedId = null;
      if (confirmingId !== null && !keyed.has(String(confirmingId))) {
        confirmingId = null;
        confirm.hidden = true;
      }
      rows = sortRows(wins.map((w) => rowFor(w)));
      body.textContent = "";
      for (const r of rows) {
        r.row.addEventListener("click", () => select(r.w.id));
        r.row.addEventListener("dblclick", () => { select(r.w.id); switchTo(r.w.id); });
        body.appendChild(r.row);
      }
      if (!rows.length) {
        const q = search.value.trim();
        const msg = q
          ? 'No processes match "' + q + '".'
          : "No processes are running — the desktop is idle.";
        body.appendChild(el("div", "tm-empty", msg));
      }
      syncSelection();
      syncActions();
      updateFooter();
      return true;
    }

    // ---------- selection + actions ----------
    function select(id) {
      selectedId = id;
      confirmingId = null;
      confirm.hidden = true;
      syncSelection();
      syncActions();
      if (window.Sounds) window.Sounds.play("ok");
    }

    function syncSelection() {
      let found = false;
      for (const r of rows) {
        const on = String(r.w.id) === String(selectedId);
        r.row.classList.toggle("sel", on);
        r.row.setAttribute("aria-selected", String(on));
        if (on) { found = true; r.row.scrollIntoView({ block: "nearest" }); }
      }
      if (!found) selectedId = null;
    }

    function selectedWindow() {
      const r = rows.find((x) => String(x.w.id) === String(selectedId));
      return r ? window.WM.getById(r.w.id) : null;
    }

    function switchTo(id) {
      const w = window.WM.getById(id);
      if (!w) return;
      if (window.Workspaces && window.Workspaces.current !== w.desktop) {
        window.Workspaces.switchTo(w.desktop);
      }
      if (w.minimized) window.WM.restore(w.id);
      else window.WM.focus(w.id);
      if (window.Sounds) window.Sounds.play("open");
    }

    function syncActions() {
      const w = selectedWindow();
      switchBtn.disabled = !w;
      minBtn.disabled = !w;
      maxBtn.disabled = !w;
      endBtn.disabled = !w;
      minBtn.textContent = w && w.minimized ? "▢ Restore" : "▁ Minimize";
      maxBtn.textContent = w && w.maximized ? "❐ Restore size" : "⛶ Maximize";
    }

    switchBtn.addEventListener("click", () => { if (selectedId !== null) switchTo(selectedId); });
    minBtn.addEventListener("click", () => {
      const w = selectedWindow();
      if (!w) return;
      if (w.minimized) window.WM.restore(w.id); else window.WM.minimize(w.id);
      syncActions();
    });
    maxBtn.addEventListener("click", () => {
      const w = selectedWindow();
      if (!w) return;
      if (w.maximized) window.WM.unmaximize(w.id); else window.WM.maximize(w.id);
      syncActions();
    });
    endBtn.addEventListener("click", () => beginEnd());
    confirmNo.addEventListener("click", () => {
      confirmingId = null;
      confirm.hidden = true;
    });
    confirmYes.addEventListener("click", () => endProcess());

    function beginEnd() {
      const r = rows.find((x) => String(x.w.id) === String(selectedId));
      if (!r) return;
      confirmingId = r.w.id;
      confirmText.textContent = 'End "' + r.w.title + '"? Its window will close and unsaved changes will be lost.';
      confirm.hidden = false;
      if (window.Sounds) window.Sounds.play("error");
    }

    function endProcess() {
      const id = confirmingId;
      confirmingId = null;
      confirm.hidden = true;
      if (id === null) return;
      const w = window.WM.getById(id);
      if (!w) return;
      const name = w.title;
      if (window.WM.forceClose) window.WM.forceClose(id);
      if (window.Notify && window.Notify.toast) {
        window.Notify.toast("Task Manager", '"' + name + '" was terminated.', { icon: "🗂️" });
      }
      if (window.Sounds) window.Sounds.play("close");
      renderBody();
    }

    // ---------- keyboard navigation ----------
    body.addEventListener("keydown", (ev) => {
      if (!rows.length) return;
      const k = ev.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        ev.preventDefault();
        const idx = rows.findIndex((r) => String(r.w.id) === String(selectedId));
        let n;
        if (k === "ArrowDown") n = idx < 0 ? 0 : (idx + 1) % rows.length;
        else n = idx <= 0 ? rows.length - 1 : idx - 1;
        select(rows[n].w.id);
      } else if (k === "Home") {
        ev.preventDefault();
        select(rows[0].w.id);
      } else if (k === "End") {
        ev.preventDefault();
        select(rows[rows.length - 1].w.id);
      } else if (k === "Enter") {
        ev.preventDefault();
        if (selectedId !== null) switchTo(selectedId);
      } else if (k === "Delete" || k === "Backspace") {
        ev.preventDefault();
        if (selectedId !== null) beginEnd();
      }
    });

    // ---------- footer ----------
    function updateFooter() {
      const snap = (window.SystemMonitor && window.SystemMonitor.snapshot) ? window.SystemMonitor.snapshot() : null;
      const n = (window.WM && window.WM.windows) ? window.WM.windows.length : 0;
      const proc = n + " process" + (n === 1 ? "" : "es");
      if (snap) {
        footer.textContent = proc + " · CPU " + snap.cpu + "% · " +
          snap.ram.toFixed(1) + " GB of " + snap.ramTotal.toFixed(1) +
          " GB memory · refreshing every " + (TICK_MS / 1000) + " s";
      } else {
        footer.textContent = proc + " · refreshing every " + (TICK_MS / 1000) + "s";
      }
    }

    refreshHead();
    renderBody();
    const timer = setInterval(() => {
      if (!document.body.contains(root)) { clearInterval(timer); return; }
      renderBody();
    }, TICK_MS);

    return { root, timer };
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["task-manager"] = function () {
    const built = build();
    return {
      content: built.root,
      w: 780, h: 540, minW: 580, minH: 380,
      onCloseRequest: () => { clearInterval(built.timer); },
    };
  };
  window.TaskManager = { build };
})();
