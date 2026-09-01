/* ============================================================
   RATHJI'S DASHBOARD — management logic
   Reads the project catalog from src/data/projects.js and renders:
   • live KPI row + category quick-nav
   • searchable/filterable/sortable Generator Manager
   • plugin cards with copy-ready import snippets
   • live usage stats (views, recent edits) via the Perchance API
   • top-generators chart + recently-updated list + live console
   ============================================================ */

(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString());

  const CATS = window.RATHJI_CATEGORIES || {};
  const RAW = window.RATHJI_PROJECTS || {};

  let projects = [];
  for (const [key, arr] of Object.entries(RAW)) {
    for (const p of arr || []) {
      const m = (p.url || "").match(/perchance\.org\/([a-z0-9-]+)/);
      projects.push({
        cat: key,
        slug: m ? m[1] : "",
        icon: p.icon || "📄",
        title: p.title || (m ? m[1] : "Untitled"),
        desc: p.desc || "",
        url: p.url || "",
        tags: p.tags || [],
        badge: p.badge || "",
        thumb: p.thumb || "",
      });
    }
  }
  const plugins = projects.filter((p) => p.cat === "plugins");

  const IMPORT_VARS = {
    "game-math-plugin": "gameMath",
    "rathji-plugin-template": "rathjiPluginTemplate",
    "card-deck-plugin": "cardDeck",
    "github-data-plugin": "githubData",
    "voice-tools-plugin": "voiceTools",
    "data-visualization-plugin": "charts",
    "zelda-audio-plugin": "zeldaAudio",
    "3d-dice-plugin": "dice3d",
  };
  const importVar = (slug) =>
    IMPORT_VARS[slug] ||
    "p" + slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^[0-9]+/, "");

  let stats = {}; // slug -> {views, lastEditTime, title, image, tags}
  const state = { filter: "all", query: "", sort: "title", dir: 1 };

  /* ---------------- small helpers ---------------- */

  function relTime(ms) {
    if (ms == null) return "never";
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.round(h / 24);
    if (d < 30) return d + "d ago";
    return new Date(ms).toLocaleDateString();
  }

  function toast(msg, type) {
    const ctn = $("#toastCtn");
    if (!ctn) return;
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " error" : " success");
    el.textContent = msg;
    ctn.appendChild(el);
    setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 320); }, 2400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("Copied to clipboard"); }
      catch (e2) { toast("Couldn't copy — select & copy manually", "error"); }
      ta.remove();
    }
  }

  function countUp(el, target) {
    const dur = 700, t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function projMedia(p, s, imgCls, emojiCls) {
    const src = (s && s.image) || p.thumb || "";
    if (src) return '<img class="' + imgCls + '" src="' + esc(src) + '" alt="" loading="lazy" onerror="this.classList.add(\'hide\')">';
    return '<span class="' + emojiCls + '">' + esc(p.icon) + "</span>";
  }

  function setStatus(text, ok) {
    const el = $("#genStatus");
    if (!el) return;
    el.innerHTML = '<span class="dot' + (ok === false ? " off" : "") + '"></span>' + esc(text);
  }

  /* ---------------- KPI row ---------------- */

  function renderKpi() {
    const el = $("#kpiRow");
    if (!el) return;
    const catCount = Object.keys(RAW).length;
    const plugCount = plugins.length;
    const templCount = projects.filter((p) => p.cat === "templates").length;
    const toolCount = projects.filter((p) => p.cat === "tools").length;
    const cards = [
      { v: projects.length, label: "Projects tracked", sub: "across " + catCount + " categories" },
      { v: plugCount, label: "Plugins", sub: "copy-ready imports" },
      { v: templCount, label: "Templates", sub: "start-from-a-shell" },
      { v: toolCount, label: "Tools", sub: "handy helpers" },
    ];
    el.innerHTML = cards.map((c) =>
      '<div class="kpi-card"><div class="kpi-num"><span data-kpi>0</span><small>' + esc(c.sub) + "</small></div><div class=\"kpi-label\">" + esc(c.label) + "</div></div>"
    ).join("");
    $$("#kpiRow [data-kpi]").forEach((n, i) => countUp(n, cards[i].v));
  }

  /* ---------------- category quick-nav ---------------- */

  function renderTrust() {
    const el = $("#trustList");
    if (!el) return;
    el.innerHTML = Object.entries(RAW).map(([key, arr]) => {
      const c = CATS[key] || {};
      return '<li class="cat-nav" data-cat="' + key + '" role="button" tabindex="0" title="Filter generators to ' + esc(c.label || key) + '">' +
        '<span class="cat-nav-ico">' + esc(c.icon || "•") + "</span>" +
        '<span class="cat-nav-label">' + esc(c.label || key) + "</span>" +
        '<span class="cat-nav-count">' + arr.length + "</span>" +
      "</li>";
    }).join("");
    el.querySelectorAll(".cat-nav").forEach((li) => {
      const go = () => { setFilter(li.dataset.cat); const sec = $("#generators"); if (sec) sec.scrollIntoView({ behavior: "smooth" }); };
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  /* ---------------- generator manager ---------------- */

  function catBadge(key) {
    const c = CATS[key] || { label: key, color: "var(--primary)" };
    return '<span class="cat-badge" style="--cat:' + c.color + '"><span class="cat-dot"></span>' + esc(c.label) + "</span>";
  }

  function rowHTML(p) {
    const s = stats[p.slug];
    const thumb = projMedia(p, s, "proj-thumb", "proj-emoji");
    const tags = (p.tags || []).slice(0, 3).map((t) => '<span class="mini-tag">' + esc(t) + "</span>").join("");
    const badge = p.badge ? '<span class="mini-tag badge-tag">' + esc(p.badge) + "</span>" : "";
    return "<tr>" +
      '<td><div class="proj-cell">' + thumb +
        '<div><a class="proj-title" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + "</a>" +
        '<div class="proj-slug">' + esc(p.slug || "no-slug") + "</div></div></div></td>" +
      "<td>" + catBadge(p.cat) + "</td>" +
      '<td><div class="tag-row">' + tags + badge + "</div></td>" +
      '<td><span class="views-num">' + fmt(s ? s.views : null) + "</span></td>" +
      '<td><span class="edit-time">' + (s && s.lastEditTime ? "<b>" + esc(relTime(s.lastEditTime)) + "</b>" : '<span class="muted">—</span>') + "</span></td>" +
      '<td><div class="row-actions">' +
        '<a class="row-action primary" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open</a>' +
        '<button class="row-action" data-copy="' + esc(p.url) + '" title="Copy link">Copy</button>' +
      "</div></td>" +
    "</tr>";
  }

  function filtered() {
    let list = projects.filter((p) => state.filter === "all" || p.cat === state.filter);
    const q = state.query.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.desc.toLowerCase().includes(q) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    const val = (p) =>
      state.sort === "views" ? (stats[p.slug] && stats[p.slug].views != null ? stats[p.slug].views : -1) :
      state.sort === "edit" ? (stats[p.slug] ? stats[p.slug].lastEditTime || 0 : 0) :
      p.title.toLowerCase();
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      return (x < y ? -1 : 1) * state.dir;
    });
  }

  function renderChips() {
    const el = $("#genChips");
    if (!el) return;
    const total = projects.length;
    const chip = (key, label, count) =>
      '<button class="mgr-chip' + (state.filter === key ? " active" : "") + '" data-cat="' + key + '">' + esc(label) +
      '<span class="chip-count">' + count + "</span></button>";
    let html = chip("all", "All", total);
    for (const [key, arr] of Object.entries(RAW)) {
      html += chip(key, (CATS[key] || {}).label || key, arr.length);
    }
    el.innerHTML = html;
    el.querySelectorAll(".mgr-chip").forEach((b) =>
      b.addEventListener("click", () => { setFilter(b.dataset.cat); })
    );
  }

  function setFilter(key) {
    state.filter = key;
    renderChips();
    renderTable();
  }

  function renderTable() {
    const tbody = $("#genTbody");
    const count = $("#genCount");
    const empty = $("#genEmpty");
    if (!tbody) return;
    const list = filtered();
    tbody.innerHTML = list.map(rowHTML).join("");
    if (count) {
      const what = state.filter === "all" ? "projects" : ((CATS[state.filter] || {}).label || state.filter).toLowerCase();
      count.textContent = list.length + " of " + projects.length + " " + what + (state.query ? " matching '" + state.query.trim() + "'" : "");
    }
    if (empty) empty.hidden = list.length > 0;
  }

  /* ---------------- plugins ---------------- */

  function renderPlugins() {
    const el = $("#pluginsGrid");
    if (!el) return;
    if (!plugins.length) { el.innerHTML = '<p class="hint">No plugins found in the catalog.</p>'; return; }
    el.innerHTML = plugins.map((p) => {
      const iv = importVar(p.slug);
      return '<article class="plugin-card">' +
        '<div class="plugin-top">' + projMedia(p, stats[p.slug], "plugin-thumb", "plugin-icon") +
        '<div><div class="plugin-name">' + esc(p.title) + '</div><div class="plugin-slug">' + esc(p.slug) + "</div></div></div>" +
        '<code class="import-code">' + esc(iv) + ' = {import:' + esc(p.slug) + "}</code>" +
        '<p class="plugin-desc">' + esc(p.desc) + "</p>" +
        '<div class="plugin-tags">' + (p.tags || []).slice(0, 4).map((t) => '<span class="mini-tag">' + esc(t) + "</span>").join("") + "</div>" +
        '<div class="plugin-actions">' +
        '<a class="row-action primary" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open ↗</a>' +
        '<button class="row-action" data-import="' + iv + ' = {import:' + esc(p.slug) + '}">Copy import</button>' +
        "</div></article>";
    }).join("");
  }

  /* ---------------- live API ---------------- */

  async function fetchStats() {
    const slugs = projects.map((p) => p.slug);
    const out = {};
    let okCount = 0;
    for (let i = 0; i < slugs.length; i += 25) {
      const chunk = slugs.slice(i, i + 25);
      try {
        const r = await fetch("https://perchance.org/api/getGeneratorStats?names=" + chunk.join(","));
        const j = await r.json();
        if (j && j.status === "success" && Array.isArray(j.data)) {
          for (const d of j.data) {
            if (d && d.name) {
              out[d.name] = {
                views: d.views,
                lastEditTime: d.lastEditTime,
                title: d.metaData && d.metaData.title,
                image: d.metaData && d.metaData.image,
                tags: d.metaData && d.metaData.tags,
              };
              okCount++;
            }
          }
        }
      } catch (e) { /* ignore per-chunk errors */ }
    }
    return { stats: out, ok: okCount };
  }

  function renderPerf() {
    const wrap = $("#liveStatsRow");
    const cards = $("#perfCards");
    const chartEl = $("#perfChart");
    if (!wrap || !cards) return;
    const withV = projects.map((p) => ({ p, v: (stats[p.slug] && stats[p.slug].views) || 0 }));
    const totalViews = withV.reduce((a, b) => a + b.v, 0);
    const top = [...withV].sort((a, b) => b.v - a.v)[0];
    const last24 = projects.filter((p) => stats[p.slug] && stats[p.slug].lastEditTime && Date.now() - stats[p.slug].lastEditTime < 86400000).length;
    const newest = projects.map((p) => ({ p, t: (stats[p.slug] && stats[p.slug].lastEditTime) || 0 })).sort((a, b) => b.t - a.t)[0];
    cards.innerHTML = [
      { k: "Combined views", v: fmt(totalViews), s: "across " + projects.length + " projects" },
      { k: "Top by views", v: top && top.v ? esc(top.p.title) : "—", s: top && top.v ? fmt(top.v) + " views" : "no data yet" },
      { k: "Updated · 24h", v: String(last24), s: "projects edited recently" },
      { k: "Newest edit", v: newest && newest.t ? esc(newest.p.title) : "—", s: newest && newest.t ? relTime(newest.t) : "no data yet" },
    ].map((c) => '<div class="perf-card"><span class="pk">' + c.k + '</span><span class="pv">' + c.v + '</span><span class="ps">' + c.s + "</span></div>").join("");
    wrap.hidden = false;

    if (chartEl && window.root && root.charts && typeof root.charts.bar === "function") {
      const top8 = withV.filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
      if (top8.length) {
        const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#7c3aed";
        const data = top8.map((x) => ({ label: x.p.title.length > 18 ? x.p.title.slice(0, 17) + "…" : x.p.title, value: x.v }));
        try {
          const svg = root.charts.bar(data, { height: 240, labels: false, colors: [primary], title: "" });
          chartEl.innerHTML = (typeof svg === "string" && svg.indexOf("<svg") >= 0) ? svg : '<p class="hint">No view data yet.</p>';
        } catch (e) { chartEl.innerHTML = '<p class="hint">Chart unavailable.</p>'; }
      } else {
        chartEl.innerHTML = '<p class="hint">Fetch live stats to see top generators.</p>';
      }
    } else if (chartEl) {
      chartEl.innerHTML = '<p class="hint">Chart plugin not loaded.</p>';
    }
  }

  function renderRecent() {
    const panel = $("#recentPanel");
    const list = $("#recentList");
    if (!panel || !list) return;
    const items = projects.map((p) => ({ p, t: (stats[p.slug] && stats[p.slug].lastEditTime) || 0 })).filter((x) => x.t).sort((a, b) => b.t - a.t).slice(0, 7);
    if (!items.length) { panel.hidden = true; return; }
    list.innerHTML = items.map(({ p, t }) => {
      const c = CATS[p.cat] || { label: p.cat, color: "var(--primary)" };
      const v = (stats[p.slug] && stats[p.slug].views) || 0;
      return '<li class="recent-item">' + projMedia(p, stats[p.slug], "recent-thumb", "recent-ico") +
        "<div><a class=\"recent-name\" href=\"" + esc(p.url) + "\" target=\"_blank\" rel=\"noopener\">" + esc(p.title) + "</a>" +
        '<div class="recent-meta">' + esc(c.label) + " · " + fmt(v) + " views</div></div>" +
        '<span class="recent-time">' + esc(relTime(t)) + "</span></li>";
    }).join("");
    panel.hidden = false;
  }

  function renderTerminal(okCount) {
    const el = $("#terminalBody");
    if (!el) return;
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const withV = projects.map((p) => ({ p, v: (stats[p.slug] && stats[p.slug].views) || 0 }));
    const total = withV.reduce((a, b) => a + b.v, 0);
    const top = [...withV].sort((a, b) => b.v - a.v)[0];
    const last24 = projects.filter((p) => stats[p.slug] && stats[p.slug].lastEditTime && Date.now() - stats[p.slug].lastEditTime < 86400000).length;
    const L = [];
    L.push('<p class="t-line"><span class="t-prompt">$</span> dashboard --scan</p>');
    L.push('<p class="t-line t-dim">→ reading catalog … ' + projects.length + " projects in " + Object.keys(RAW).length + " categories</p>");
    if (okCount === null) {
      L.push('<p class="t-line t-dim">→ getGeneratorStats … fetching…</p>');
    } else if (okCount > 0) {
      L.push('<p class="t-line t-dim">→ getGeneratorStats … ' + okCount + "/" + projects.length + " ok</p>");
      L.push('<p class="t-line"><span class="t-ok">✔ ' + last24 + " updated in the last 24h · combined views " + fmt(total) + "</span></p>");
      if (top && top.v) L.push('<p class="t-line t-muted"># top: ' + esc(top.p.title) + " · " + fmt(top.v) + " views</p>");
    } else {
      L.push('<p class="t-line"><span class="t-amber">●</span> <span class="t-muted">live API unreachable — showing catalog only</span></p>');
    }
    L.push('<p class="t-line t-muted"># scanned ' + now + " · press Refresh to re-scan</p>");
    L.push('<p class="t-line"><span class="t-prompt">$</span> <span class="t-cursor">▊</span></p>');
    el.innerHTML = L.join("\n");
  }

  async function loadStats(interactive) {
    if (interactive) setStatus("Scanning…", null);
    const res = await fetchStats();
    stats = res.stats;
    setStatus(res.ok > 0 ? "Live · API ok" : "Offline · catalog only", res.ok > 0);
    renderTerminal(res.ok);
    renderPerf();
    renderRecent();
    renderPlugins();
    renderTable();
    const st = $('[data-field="product.status"]');
    if (st) st.textContent = "Live · " + projects.length + " projects tracked";
  }

  /* ---------------- wiring ---------------- */

  function wireSort() {
    const toolbar = $(".mgr-toolbar");
    if (!toolbar || $("#genSort")) return;
    const wrap = document.createElement("div");
    wrap.className = "mgr-sort-wrap";
    const sel = document.createElement("select");
    sel.id = "genSort";
    sel.className = "mgr-sort";
    sel.setAttribute("aria-label", "Sort projects");
    sel.innerHTML =
      '<option value="title-asc">Name A–Z</option>' +
      '<option value="title-desc">Name Z–A</option>' +
      '<option value="views-desc">Most views</option>' +
      '<option value="edit-desc">Recently edited</option>' +
      '<option value="edit-asc">Stale / oldest</option>';
    wrap.appendChild(sel);
    toolbar.appendChild(wrap);
    sel.addEventListener("change", () => {
      const [sort, dir] = sel.value.split("-");
      state.sort = sort;
      state.dir = dir === "desc" ? -1 : 1;
      renderTable();
    });
  }

  function init() {
    renderKpi();
    renderTrust();
    renderChips();
    renderTable();
    renderPlugins();
    renderTerminal(null);
    wireSort();
    setStatus("Fetching live stats…", null);

    const search = $("#genSearch");
    if (search) search.addEventListener("input", () => { state.query = search.value; renderTable(); });

    const tbody = $("#genTbody");
    if (tbody) tbody.addEventListener("click", (e) => {
      const b = e.target.closest("[data-copy]");
      if (b) { e.preventDefault(); copyText(b.dataset.copy); }
    });

    const pGrid = $("#pluginsGrid");
    if (pGrid) pGrid.addEventListener("click", (e) => {
      const b = e.target.closest("[data-import]");
      if (b) copyText(b.dataset.import);
    });

    const refresh = $("#genRefreshBtn");
    if (refresh) refresh.addEventListener("click", () => loadStats(true));
    const recentRefresh = $("#recentRefreshBtn");
    if (recentRefresh) recentRefresh.addEventListener("click", () => loadStats(true));

    loadStats(false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
