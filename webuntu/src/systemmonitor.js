// Webuntu OS — System Monitor (Phase 6, Task 36)
// A fictional-but-alive performance monitor: per-core CPU bars, RAM usage that
// grows with the number of open windows, a network sparkline, uptime, and a
// live process table built from the WM's open windows. Everything animates on
// a setInterval (never requestAnimationFrame — the preview iframe can be a
// hidden/backgrounded tab where rAF never fires). The interval is torn down
// when the window closes (apps.js attaches this builder's onCloseRequest to
// the live window).

(function () {
  "use strict";

  const TOTAL_RAM = 8;            // GB, fictional machine
  const TICK_MS = 200;
  const HISTORY = 44;             // sparkline samples
  const bootTime = Date.now();
  const CORES = 4;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function walk(v, lo, hi, step, bias) {
    return clamp(v + rand(-step, step) + (bias || 0), lo, hi);
  }
  function fmtUptime(ms) {
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return hh + ":" + mm + ":" + ss;
  }

  // Per-process stats persist per window id so numbers drift smoothly.
  const procState = new Map();

  function procStats(w) {
    let st = procState.get(w.id);
    if (!st) {
      let ram;
      if (w.appId === "browser") ram = rand(240, 420);
      else if (w.appId && String(w.appId).startsWith("game:")) ram = rand(380, 720);
      else if (w.appId === "system-monitor") ram = rand(70, 120);
      else if (w.appId === "notes" || w.appId === "calculator") ram = rand(40, 90);
      else ram = rand(90, 260);
      st = { cpu: rand(2, 14), ram };
      procState.set(w.id, st);
    }
    st.cpu = walk(st.cpu, 0.4, 42, 2.4, 0);
    st.ram = walk(st.ram, 30, 900, 6, 0);
    return st;
  }

  function buildDom() {
    const root = el("div", "sm");

    // ---- stat cards ----
    const cards = el("div", "sm-cards");
    function statCard(label) {
      const c = el("div", "sm-card");
      c.appendChild(el("div", "sm-card-label", label));
      const big = el("div", "sm-card-big", "—");
      const sub = el("div", "sm-card-sub", "");
      c.append(big, sub);
      return { card: c, big, sub };
    }
    const cpuCard = statCard("CPU");
    const memCard = statCard("Memory");
    const netCard = statCard("Network");
    const upCard = statCard("Uptime");
    const winCard = statCard("Windows");
    cards.append(cpuCard.card, memCard.card, netCard.card, upCard.card, winCard.card);
    root.appendChild(cards);

    // ---- CPU cores ----
    const cpuWrap = el("div", "sm-panel");
    cpuWrap.appendChild(el("div", "sm-panel-title", "CPU — " + CORES + " cores"));
    const coreRows = [];
    const coreLoad = [];
    for (let i = 0; i < CORES; i++) {
      coreLoad.push(rand(14, 46));
      const row = el("div", "sm-core");
      row.appendChild(el("span", "sm-core-name", "CPU" + (i + 1)));
      const barWrap = el("div", "sm-bar-wrap");
      const bar = el("div", "sm-bar");
      bar.style.width = "0%";
      const pct = el("span", "sm-pct", "0%");
      barWrap.appendChild(bar);
      row.append(barWrap, pct);
      cpuWrap.appendChild(row);
      coreRows.push({ bar, pct });
    }
    root.appendChild(cpuWrap);

    // ---- RAM ----
    const ramWrap = el("div", "sm-panel");
    ramWrap.appendChild(el("div", "sm-panel-title", "Memory"));
    const ramRow = el("div", "sm-core");
    ramRow.appendChild(el("span", "sm-core-name", "Used"));
    const ramBarWrap = el("div", "sm-bar-wrap");
    const ramBar = el("div", "sm-bar");
    ramBar.style.width = "0%";
    const ramPct = el("span", "sm-pct", "0%");
    ramBarWrap.appendChild(ramBar);
    ramRow.append(ramBarWrap, ramPct);
    ramWrap.appendChild(ramRow);
    const ramDetail = el("div", "sm-net-detail",
      "Webuntu reserves 8.0 GB of virtual memory.");
    ramWrap.appendChild(ramDetail);
    root.appendChild(ramWrap);

    // ---- Network ----
    const netWrap = el("div", "sm-panel");
    netWrap.appendChild(el("div", "sm-panel-title", "Network"));
    const netDetail = el("div", "sm-net-detail", "↓ 0 KB/s · ↑ 0 KB/s");
    const canvas = el("canvas", "sm-spark");
    canvas.width = 600;
    canvas.height = 90;
    netWrap.append(netDetail, canvas);
    root.appendChild(netWrap);

    // ---- Processes ----
    const procWrap = el("div", "sm-panel sm-procs");
    procWrap.appendChild(el("div", "sm-panel-title", "Processes"));
    const procBody = el("div", "sm-proc-body");
    procWrap.appendChild(procBody);
    root.appendChild(procWrap);

    // ---------- animation state ----------
    let netUp = rand(60, 220);
    let netDown = rand(200, 520);
    const history = [];

    // ---------- rendering ----------
    function paintSpark() {
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (history.length < 2) return;
      const max = Math.max(8, ...history.map((p) => Math.max(p.up, p.down)));
      const step = W / HISTORY;
      for (const key of ["down", "up"]) {
        ctx.beginPath();
        history.forEach((p, i) => {
          const x = (i - history.length + 1) * step + W;
          const y = H - (p[key] / max) * (H - 6) - 3;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = key === "down" ? "#22d3ee" : "#8b5cf6";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }

    function tick() {
      // CPU
      let total = 0;
      for (let i = 0; i < CORES; i++) {
        coreLoad[i] = walk(coreLoad[i], 6, 96, 6, rand(-1.2, 1.2));
        total += coreLoad[i];
        coreRows[i].bar.style.width = coreLoad[i].toFixed(0) + "%";
        coreRows[i].pct.textContent = coreLoad[i].toFixed(0) + "%";
      }
      const cpuAvg = total / CORES;
      cpuCard.big.textContent = cpuAvg.toFixed(0) + "%";
      cpuCard.sub.textContent = "System load · " + (cpuAvg > 70 ? "high" : cpuAvg > 40 ? "moderate" : "normal");

      // RAM — grows with open windows, drifts smoothly
      const winCount = window.WM ? window.WM.windows.length : 0;
      const target = clamp(1.6 + winCount * 0.22 + rand(-0.05, 0.05), 0.9, 7.5);
      ramBase = ramBase + (target - ramBase) * 0.12;
      const used = ramBase;
      const pct = (used / TOTAL_RAM) * 100;
      ramBar.style.width = pct.toFixed(0) + "%";
      ramPct.textContent = used.toFixed(1) + " / " + TOTAL_RAM.toFixed(0) + " GB";
      memCard.big.textContent = used.toFixed(1) + " GB";
      memCard.sub.textContent = "of " + TOTAL_RAM.toFixed(0) + " GB · " + winCount + " window" + (winCount === 1 ? "" : "s") + " open";

      // Network
      netUp = walk(netUp, 10, 2600, 220, 0);
      netDown = walk(netDown, 40, 7200, 520, 0);
      history.push({ up: netUp, down: netDown });
      if (history.length > HISTORY) history.shift();
      netDetail.textContent = "↓ " + netDown.toFixed(0) + " KB/s · ↑ " + netUp.toFixed(0) + " KB/s";
      netCard.big.textContent = (netDown / 1024).toFixed(1) + " MB/s";
      netCard.sub.textContent = "down · " + (netUp / 1024).toFixed(2) + " up";
      paintSpark();

      // Uptime / windows
      upCard.big.textContent = fmtUptime(Date.now() - bootTime);
      upCard.sub.textContent = "since session start";
      winCard.big.textContent = winCount;
      winCard.sub.textContent = winCount === 1 ? "1 window open" : winCount + " windows open";

      // Processes (one row per open WM window)
      procBody.textContent = "";
      const wins = window.WM ? window.WM.windows.slice() : [];
      for (const w of wins) {
        const st = procStats(w);
        const row = el("div", "sm-proc");
        row.appendChild(el("span", "sm-proc-ico", w.icon || "📄"));
        row.appendChild(el("span", "sm-proc-name", w.title));
        row.appendChild(el("span", "sm-proc-num", st.cpu.toFixed(0) + "%"));
        row.appendChild(el("span", "sm-proc-num", st.ram.toFixed(0) + " MB"));
        procBody.appendChild(row);
      }
      if (!wins.length) {
        procBody.appendChild(el("div", "sm-proc-empty", "No processes — the desktop is idle."));
      }
    }

    tick();
    const timer = setInterval(tick, TICK_MS);
    return { root, timer };
  }

  let ramBase = 2.1;

  window.AppContent = window.AppContent || {};
  window.AppContent["system-monitor"] = function () {
    const built = buildDom();
    return {
      content: built.root,
      w: 580, h: 640, minW: 400, minH: 420,
      onCloseRequest: () => { clearInterval(built.timer); },
    };
  };

  // Task 86 — live snapshot for other surfaces (e.g. the Control Center's
  // Developer view), driven by the same fictional per-window stats the app
  // draws. Each call walks the open windows forward, exactly like a tick.
  window.SystemMonitor = {
    // Task 88 — the Task Manager shares the same per-window CPU/memory walk so
    // both surfaces report identical numbers for the same window.
    procStats,
    snapshot() {
      const wins = (window.WM && window.WM.windows) ? window.WM.windows.slice() : [];
      let cpuTotal = 0;
      for (const w of wins) cpuTotal += procStats(w).cpu;
      ramBase = walk(ramBase, 1.2, 6.6, 0.12, 0);
      return {
        cpu: Math.round(cpuTotal / Math.max(1, CORES)),
        ram: ramBase,
        ramTotal: TOTAL_RAM,
        uptimeMs: Date.now() - bootTime,
        windows: wins.length,
      };
    },
  };
})();
