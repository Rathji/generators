// ============================================================================
// GITHUB — Phase 10, Task 81
// github-data-plugin (root.gh) + GitHub REST API: search repos, trending, and
// a repo detail view (stars / issues / browse code / README). Repos, issues
// and files deep-link via window.Browser.navigate — external https URLs open
// in a real tab (the embed browser only renders Perchance generators).
// Search results are cached in memory (5 min) and trending in localStorage
// (6 h) to stay inside the unauthenticated API rate limits.
// ============================================================================
(function () {
  "use strict";

  const API = "https://api.github.com";
  const CACHE_TTL = 5 * 60 * 1000;
  const TREND_TTL = 6 * 60 * 60 * 1000;
  const SUGGESTIONS = ["react", "three.js", "rust", "llama.cpp", "ruff", "perchance", "docker", "flutter"];

  const cache = {}; // url-key -> { ts, data } (in-memory)

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(title, body, icon) {
    if (window.Notify) window.Notify.toast(title, body, { icon, app: "GitHub" });
  }
  function play(name) {
    if (window.Sounds && window.Sounds.play) { try { window.Sounds.play(name); } catch (e) {} }
  }

  // ---- GitHub API access ---------------------------------------------------
  // root.gh is the github-data-plugin's main() callable (the perchance import
  // proxy forwards calls but hides its .info/.raw/.list helpers), so we call
  // it in its (repo, path, opts) form and read .ok/.data/.text from the
  // result. Everything it doesn't cover (search, issues, trending) uses plain
  // fetch — api.github.com is CORS-open.
  function ghCall(repo, path, opts) {
    const g = window.root && window.root.gh;
    if (typeof g === "function") return g(repo, path, opts);
    return Promise.resolve({ ok: false, error: "github-data-plugin unavailable" });
  }
  async function apiFetch(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      let detail = "";
      try { const b = await res.clone().json(); if (b && b.message) detail = " — " + b.message; } catch (e) {}
      throw new Error("HTTP " + res.status + " " + res.statusText + detail);
    }
    return res;
  }
  async function apiJson(url, key, ttl) {
    const k = key || url;
    const hit = cache[k];
    if (hit && Date.now() - hit.ts < (ttl || CACHE_TTL)) return hit.data;
    const res = await apiFetch(url);
    const data = await res.json();
    cache[k] = { ts: Date.now(), data };
    return data;
  }
  function persistLoad(key, ttl) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (Date.now() - o.ts < ttl) return o.data;
    } catch (e) {}
    return null;
  }
  function persistSave(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
  }

  // ---- formatting ----------------------------------------------------------
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
  }
  function timeAgo(iso) {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
    const d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function openExternal(url) {
    if (window.Browser && window.Browser.navigate) window.Browser.navigate(url);
    else window.open(url, "_blank", "noopener");
  }

  const LANG_COLORS = {
    JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", Java: "#b07219",
    Go: "#00ADD8", Rust: "#dea584", C: "#555555", "C++": "#f34b7d", "C#": "#178600",
    Ruby: "#701516", PHP: "#4F5D95", HTML: "#e34c26", CSS: "#563d7c", Shell: "#89e051",
    Swift: "#F05138", Kotlin: "#A97BFF", Dart: "#00B4AB", Vue: "#41b883", Svelte: "#ff3e00",
    Lua: "#000080", Perl: "#0298c3", Scala: "#c22d40", Haskell: "#5e5086", Elixir: "#6e4a7e",
    Zig: "#ec915c", Nix: "#7e7eff", Markdown: "#083fa1", Dockerfile: "#384d54", JSON: "#f0db4f",
  };

  // ---- shared elements -----------------------------------------------------
  function avatarEl(url, alt) {
    const s = el("span", "gh-avatar");
    const im = document.createElement("img");
    im.src = (url || "") + (url && url.indexOf("?") === -1 ? "?s=64" : "&s=64");
    im.alt = alt || "";
    im.addEventListener("error", () => {
      im.remove();
      s.classList.add("gh-avatar-fallback");
      s.textContent = (alt || "?").slice(0, 1).toUpperCase();
    }, { once: true });
    s.appendChild(im);
    return s;
  }
  function chip(text, cls) {
    return el("span", "gh-chip" + (cls ? " " + cls : ""), text);
  }
  function langChip(lang) {
    const c = el("span", "gh-chip gh-lang");
    const dot = el("span", "gh-langdot");
    dot.style.background = LANG_COLORS[lang] || "#94a3b8";
    c.appendChild(dot);
    c.appendChild(document.createTextNode(lang));
    return c;
  }
  function fileIcon(name) {
    if (/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(name)) return "🖼️";
    if (/\.(md|markdown|rst|txt)$/i.test(name)) return "📝";
    if (/\.(js|mjs|cjs|jsx|ts|tsx)$/i.test(name)) return "🟨";
    if (/\.(py)$/i.test(name)) return "🐍";
    if (/\.(json|ya?ml|toml|xml|html|css|scss)$/i.test(name)) return "🧾";
    if (/\.(rs)$/i.test(name)) return "🦀";
    if (/\.(go)$/i.test(name)) return "🔵";
    if (/\.(java|kt)$/i.test(name)) return "☕";
    if (/\.(c|h|cc|cpp|hpp)$/i.test(name)) return "🧱";
    return "📄";
  }

  function repoCard(repo, onOpen) {
    const c = el("div", "gh-repo");
    c.tabIndex = 0;
    c.appendChild(avatarEl(repo.owner && repo.owner.avatar_url, (repo.owner && repo.owner.login) || repo.name));
    const mid = el("div", "gh-repo-mid");
    const nameRow = el("div", "gh-repo-namerow");
    const name = el("span", "gh-repo-name", repo.full_name || repo.name);
    if (repo.fork) name.appendChild(chip("forked", "gh-chip-sm"));
    nameRow.appendChild(name);
    mid.appendChild(nameRow);
    if (repo.description) mid.appendChild(el("div", "gh-repo-desc", repo.description));
    const meta = el("div", "gh-repo-meta");
    meta.appendChild(chip("⭐ " + fmt(repo.stargazers_count)));
    meta.appendChild(chip("🍴 " + fmt(repo.forks_count)));
    if (repo.language) meta.appendChild(langChip(repo.language));
    if (repo.license && repo.license.spdx_id && repo.license.spdx_id !== "NOASSERTION") meta.appendChild(chip(repo.license.spdx_id));
    meta.appendChild(chip("✏️ " + timeAgo(repo.pushed_at)));
    mid.appendChild(meta);
    const open = el("button", "gh-repo-open", "↗");
    open.type = "button";
    open.title = "Open on GitHub";
    open.addEventListener("click", (e) => { e.stopPropagation(); openExternal("https://github.com/" + (repo.full_name || repo.name)); });
    c.append(mid, open);
    c.addEventListener("click", () => {
      if (onOpen) { try { onOpen(repo.full_name || repo.name); } catch (e) {} }
    });
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" && onOpen) onOpen(repo.full_name || repo.name); });
    return c;
  }

  // ---- minimal safe markdown renderer --------------------------------------
  function renderMarkdown(md) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    function inline(s) {
      s = esc(s);
      s = s.replace(/&amp;(mdash|ndash|hellip|copy|nbsp|middot|raquo|laquo|quot|apos|times|divide);/g, (m, e) => ({ mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", copy: "\u00a9", nbsp: " ", middot: "\u00b7", raquo: "\u00bb", laquo: "\u00ab", quot: '"', apos: "'", times: "\u00d7", divide: "\u00f7" }[e]));
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, alt, url) => {
        const u = url.replace(/"/g, "&quot;");
        return '<img class="gh-md-img" alt="' + alt.replace(/"/g, "&quot;") + '" src="' + u + '" loading="lazy" onerror="this.remove()">';
      });
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s;
    }
    // resolve [text][ref] reference-style links from their definition lines
    const refs = {};
    const resolved = String(md || "")
      .replace(/^\[([^\]]+)\]:\s*(https?:\/\/\S+)[^\n]*$/gm, (m, id, url) => { refs[id.toLowerCase()] = url; return ""; })
      // badges wrapped in reference links: [![alt][ref]][ref2]
      .replace(/\[!\[([^\]]*)\]\[([^\]]+)\]\]\[([^\]]+)\]/g, (m, alt, id) => {
        const u = refs[id.toLowerCase()];
        return u ? "![" + alt + "](" + u + ")" : m;
      })
      // bare image references: ![alt][ref]
      .replace(/!\[([^\]]*)\]\[([^\]]+)\]/g, (m, alt, id) => {
        const u = refs[id.toLowerCase()];
        return u ? "![" + alt + "](" + u + ")" : m;
      })
      .replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (m, txt, id) => {
        const u = refs[id.toLowerCase()];
        return u ? "[" + txt + "](" + u + ")" : m;
      });
    const isSepRow = (t) => /^[|:\s-]+$/.test(t) && t.includes("-") && t.includes("|");
    const isTableRow = (t) => /^\s*\|.*\|\s*$/.test(t);

    const out = document.createElement("div");
    out.className = "gh-md";
    const lines = resolved.split(/\r?\n/);
    let i = 0, inCode = false, codeBuf = [], list = null;
    function flushList() { if (list) { out.appendChild(list); list = null; } }
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (t.startsWith("```")) {
        if (inCode) {
          const pre = el("pre", "gh-md-pre");
          pre.textContent = codeBuf.join("\n");
          out.appendChild(pre);
          codeBuf = [];
          inCode = false;
        } else { flushList(); inCode = true; }
        i++;
        continue;
      }
      if (inCode) { codeBuf.push(line); i++; continue; }
      if (!t) { flushList(); i++; continue; }
      if (isTableRow(t)) {
        // collect the table block
        const rows = [];
        while (i < lines.length && isTableRow(lines[i].trim())) {
          rows.push(lines[i].trim().replace(/^\|/, "").replace(/\|$/, ""));
          i++;
        }
        const tbl = document.createElement("table");
        tbl.className = "gh-md-tbl";
        const cells = rows.map((r) => r.split("|").map((c) => c.trim()));
        let start = 0;
        if (cells.length > 1 && isSepRow("|" + cells[1].join("|") + "|")) {
          const tr = document.createElement("tr");
          for (const c of cells[0]) {
            const th = document.createElement("th");
            th.innerHTML = inline(c);
            tr.appendChild(th);
          }
          tbl.appendChild(tr);
          start = 2;
        }
        for (let r = start; r < cells.length; r++) {
          const tr = document.createElement("tr");
          for (const c of cells[r]) {
            const td = document.createElement("td");
            td.innerHTML = inline(c);
            tr.appendChild(td);
          }
          tbl.appendChild(tr);
        }
        flushList();
        out.appendChild(tbl);
        continue;
      }
      if (/^#{1,6}\s/.test(t)) {
        flushList();
        const lvl = Math.min(t.match(/^#+/)[0].length, 4);
        const h = document.createElement("h" + (lvl + 1)); // h2..h5 under .gh-md
        h.innerHTML = inline(t.replace(/^#+\s*/, ""));
        out.appendChild(h);
      } else if (/^[-*]\s+/.test(t)) {
        if (!list || list.tagName !== "UL") { flushList(); list = document.createElement("ul"); }
        const li = document.createElement("li");
        li.innerHTML = inline(t.replace(/^[-*]\s+/, ""));
        list.appendChild(li);
      } else if (/^\d+\.\s+/.test(t)) {
        if (!list || list.tagName !== "OL") { flushList(); list = document.createElement("ol"); }
        const li = document.createElement("li");
        li.innerHTML = inline(t.replace(/^\d+\.\s+/, ""));
        list.appendChild(li);
      } else if (/^&gt;\s?/.test(t)) {
        flushList();
        const q = document.createElement("blockquote");
        q.innerHTML = inline(t.replace(/^&gt;\s?/, ""));
        out.appendChild(q);
      } else if (/^(-{3,}|\*{3,})$/.test(t)) {
        flushList();
        out.appendChild(document.createElement("hr"));
      } else {
        flushList();
        const p = document.createElement("p");
        p.innerHTML = inline(t);
        out.appendChild(p);
      }
      i++;
    }
    if (inCode) {
      const pre = el("pre", "gh-md-pre");
      pre.textContent = codeBuf.join("\n");
      out.appendChild(pre);
    }
    flushList();
    return out;
  }

  // ==========================================================================
  function build() {
    const view = el("div", "gh");
    const state = { view: "home", listKind: "search", period: "week", query: "" };
    let repoState = null;
    let returnTo = null;

    // ---- top bar ----
    const bar = el("div", "gh-bar");
    const backBtn = el("button", "gh-back", "←");
    backBtn.type = "button";
    backBtn.title = "Back to results";
    backBtn.hidden = true;
    const query = el("input", "gh-query");
    query.type = "text";
    query.placeholder = "Search GitHub repos…";
    query.spellcheck = false;
    const goBtn = el("button", "gh-go", "Search");
    goBtn.type = "button";
    bar.append(backBtn, query, goBtn);

    // ---- tabs ----
    const tabs = el("div", "gh-tabs");
    const tabSearch = el("button", "gh-tab on", "🔎 Search");
    const tabTrend = el("button", "gh-tab", "📈 Trending");
    tabSearch.type = tabTrend.type = "button";
    tabs.append(tabSearch, tabTrend);

    // ---- body + loading overlay ----
    const body = el("div", "gh-body");
    const load = el("div", "gh-load");
    load.hidden = true;
    load.appendChild(el("div", "gh-spin"));
    load.appendChild(el("div", "gh-load-txt", "Contacting GitHub…"));
    view.append(bar, tabs, body, load);

    const foot = el("div", "gh-foot", "Unofficial client — data via github-data-plugin + the GitHub REST API.");
    view.appendChild(foot);

    function setLoading(on) { load.hidden = !on; }
    function clearBody() { while (body.firstChild) body.firstChild.remove(); }
    function panelMsg(icon, text) {
      const m = el("div", "gh-panel-msg");
      m.appendChild(el("div", "gh-panel-icon", icon));
      m.appendChild(el("div", "gh-panel-text", text));
      return m;
    }

    function showError(err, retry) {
      clearBody();
      const msg = (err && err.message) || String(err);
      const isRate = /rate limit/i.test(msg) || /\b403\b/.test(msg);
      const box = el("div", "gh-err");
      box.appendChild(el("div", "gh-err-icon", isRate ? "⏳" : "⚠️"));
      box.appendChild(el("div", "gh-err-title", isRate ? "GitHub API rate limit" : "Something went wrong"));
      box.appendChild(el("div", "gh-err-msg", isRate
        ? "Unauthenticated GitHub search is capped at 10 requests a minute and core API at 60 an hour. Wait a moment and retry, or raise the limit with a token (root.gh.setToken)."
        : msg));
      if (retry) {
        const b = el("button", "set-btn", "↻ Retry");
        b.type = "button";
        b.addEventListener("click", retry);
        box.appendChild(b);
      }
      body.appendChild(box);
    }

    // ---- home view ----
    function goHome() {
      state.view = "home";
      state.listKind = "search";
      returnTo = null;
      backBtn.hidden = true;
      tabSearch.classList.add("on");
      tabTrend.classList.remove("on");
      query.focus();
      renderHome();
    }
    function renderHome() {
      clearBody();
      const hero = el("div", "gh-hero");
      hero.appendChild(el("div", "gh-hero-icon", "🐙"));
      hero.appendChild(el("div", "gh-hero-title", "GitHub, inside Webuntu"));
      hero.appendChild(el("div", "gh-hero-sub", "Search any public repository, browse its stars and issues, read the README, and dive into the code — right from your desktop."));
      const sug = el("div", "gh-sug");
      sug.appendChild(el("div", "gh-sug-lbl", "Try searching for"));
      const row = el("div", "gh-sug-row");
      for (const s of SUGGESTIONS) {
        const b = el("button", "gh-sug-chip", s);
        b.type = "button";
        b.addEventListener("click", () => { query.value = s; runSearch(s); });
        row.appendChild(b);
      }
      sug.appendChild(row);
      hero.appendChild(sug);
      body.appendChild(hero);

      // trending preview
      const prev = el("div", "gh-trendprev");
      const head = el("div", "gh-trendprev-head");
      head.appendChild(el("div", "gh-trendprev-lbl", "🔥 Trending this week"));
      const more = el("button", "gh-link", "See more →");
      more.type = "button";
      more.addEventListener("click", () => showTrend("week"));
      head.appendChild(more);
      prev.appendChild(head);
      const list = el("div", "gh-trendprev-list");
      prev.appendChild(list);
      body.appendChild(prev);
      loadTrendPreview(list);
    }
    async function loadTrendPreview(listEl) {
      listEl.appendChild(el("div", "gh-load-txt small", "Loading…"));
      try {
        const data = await fetchTrend("week");
        listEl.innerHTML = "";
        if (!data.items || !data.items.length) { listEl.appendChild(el("div", "gh-trendprev-empty", "Nothing trending this week.")); return; }
        for (const r of data.items.slice(0, 5)) listEl.appendChild(repoCard(r, openRepo));
      } catch (e) {
        listEl.innerHTML = "";
        listEl.appendChild(el("div", "gh-trendprev-empty", "Trending unavailable — " + ((e && e.message) || e)));
      }
    }

    // ---- search ----
    async function runSearch(q, push) {
      q = String(q || "").trim();
      if (!q) return;
      state.query = q;
      state.view = "list";
      state.listKind = "search";
      returnTo = null;
      backBtn.hidden = true;
      query.value = q;
      if (push) {
        tabSearch.classList.add("on");
        tabTrend.classList.remove("on");
      }
      clearBody();
      setLoading(true);
      try {
        const data = await apiJson(API + "/search/repositories?q=" + encodeURIComponent(q) + "&sort=stars&order=desc&per_page=20", "s:" + q.toLowerCase());
        clearBody();
        if (!data.items || !data.items.length) {
          body.appendChild(panelMsg("🔎", 'No repos match "' + q + '". Try different keywords.'));
          return;
        }
        body.appendChild(el("div", "gh-list-head", fmt(data.total_count) + " repos for “" + q + "” · sorted by stars"));
        for (const r of data.items) body.appendChild(repoCard(r, openRepo));
      } catch (e) {
        clearBody();
        showError(e, () => runSearch(q, push));
      } finally {
        setLoading(false);
      }
    }

    // ---- trending ----
    function fetchTrend(period) {
      const days = period === "day" ? 1 : period === "week" ? 7 : 30;
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const lsk = "webuntu.gh.trend." + period;
      const cached = persistLoad(lsk, TREND_TTL);
      if (cached && cached.items && cached.items.length) return Promise.resolve(cached);
      return apiJson(
        API + "/search/repositories?q=" + encodeURIComponent("created:>=" + since) + "&sort=stars&order=desc&per_page=20",
        "t:" + period + ":" + since
      ).then((data) => { persistSave(lsk, data); return data; });
    }
    async function showTrend(period) {
      state.view = "list";
      state.listKind = "trend";
      state.period = period;
      returnTo = null;
      backBtn.hidden = true;
      tabSearch.classList.remove("on");
      tabTrend.classList.add("on");
      clearBody();
      const labels = { day: "Today", week: "This week", month: "This month" };
      const per = el("div", "gh-per");
      for (const [p, l] of Object.entries(labels)) {
        const b = el("button", "gh-per-btn" + (p === period ? " on" : ""), l);
        b.type = "button";
        b.addEventListener("click", () => showTrend(p));
        per.appendChild(b);
      }
      body.appendChild(per);
      setLoading(true);
      try {
        const data = await fetchTrend(period);
        clearBody();
        body.appendChild(per);
        if (!data.items || !data.items.length) {
          body.appendChild(panelMsg("📈", "No new repos in this period."));
          return;
        }
        body.appendChild(el("div", "gh-list-head", "Trending " + labels[period].toLowerCase() + " · most-starred new repos"));
        for (const r of data.items) body.appendChild(repoCard(r, openRepo));
      } catch (e) {
        clearBody();
        body.appendChild(per);
        showError(e, () => showTrend(period));
      } finally {
        setLoading(false);
      }
    }

    // ---- repo detail ----
    function openRepo(fullName) {
      if (!returnTo) {
        returnTo = { kind: state.listKind, query: state.query, period: state.period };
      }
      state.view = "repo";
      backBtn.hidden = false;
      setLoading(true);
      (async () => {
        let info = null;
        const r = await ghCall(fullName);
        if (r && r.ok && r.data) info = r.data;
        if (!info) {
          const res = await apiFetch(API + "/repos/" + fullName);
          info = await res.json();
        }
        repoState = { fullName, data: info, tab: "readme" };
        renderRepo();
      })().catch((e) => {
        clearBody();
        showError(e, () => openRepo(fullName));
      }).finally(() => setLoading(false));
    }

    function renderRepo() {
      clearBody();
      const r = repoState.data;
      const head = el("div", "gh-rhead");
      head.appendChild(avatarEl(r.owner && r.owner.avatar_url, (r.owner && r.owner.login) || r.name));
      const title = el("div", "gh-rtitle");
      const name = el("div", "gh-rname", r.full_name || r.name);
      if (r.fork) name.appendChild(chip("forked", "gh-chip-sm"));
      title.appendChild(name);
      if (r.description) title.appendChild(el("div", "gh-rdesc", r.description));
      if (r.homepage) {
        const h = el("a", "gh-rsite", r.homepage);
        h.href = r.homepage;
        h.target = "_blank";
        h.rel = "noopener";
        title.appendChild(h);
      }
      const openBtn = el("button", "set-btn gh-rope", "Open on GitHub ↗");
      openBtn.type = "button";
      openBtn.addEventListener("click", () => openExternal("https://github.com/" + r.full_name));
      head.append(title, openBtn);

      const meta = el("div", "gh-rmeta");
      meta.appendChild(chip("⭐ " + fmt(r.stargazers_count) + " stars"));
      meta.appendChild(chip("🍴 " + fmt(r.forks_count) + " forks"));
      meta.appendChild(chip("🐛 " + fmt(r.open_issues_count) + " open issues"));
      if (r.language) meta.appendChild(langChip(r.language));
      if (r.license && r.license.spdx_id && r.license.spdx_id !== "NOASSERTION") meta.appendChild(chip("© " + r.license.spdx_id));
      if (r.topics && r.topics.length) for (const t of r.topics.slice(0, 5)) meta.appendChild(chip("🏷 " + t));
      meta.appendChild(chip("✏️ pushed " + timeAgo(r.pushed_at)));
      meta.appendChild(chip("🐣 " + timeAgo(r.created_at)));

      const rtabs = el("div", "gh-rtabs");
      const tReadme = el("button", "gh-rtab on", "README");
      const tIssues = el("button", "gh-rtab", "Issues (" + fmt(r.open_issues_count) + ")");
      const tCode = el("button", "gh-rtab", "Code");
      tReadme.type = tIssues.type = tCode.type = "button";
      rtabs.append(tReadme, tIssues, tCode);
      const panels = el("div", "gh-rpanel");

      function setRepoPanel(name) {
        repoState.tab = name;
        tReadme.classList.toggle("on", name === "readme");
        tIssues.classList.toggle("on", name === "issues");
        tCode.classList.toggle("on", name === "code");
        if (name === "readme") loadReadme();
        else if (name === "issues") loadIssues();
        else loadDir("");
      }
      tReadme.addEventListener("click", () => setRepoPanel("readme"));
      tIssues.addEventListener("click", () => setRepoPanel("issues"));
      tCode.addEventListener("click", () => setRepoPanel("code"));

      body.append(head, meta, rtabs, panels);
      setRepoPanel(repoState.tab);
    }

    function panelLoading() {
      const p = el("div", "gh-panel-msg");
      const sp = el("div", "gh-spin small");
      p.appendChild(sp);
      p.appendChild(el("div", "gh-panel-text", "Loading…"));
      return p;
    }

    async function loadReadme() {
      const panels = body.querySelector(".gh-rpanel");
      panels.innerHTML = "";
      panels.appendChild(panelLoading());
      let text = null;
      for (const name of ["README.md", "README", "Readme.md", "README.rst", "readme.md"]) {
        try {
          const r = await ghCall(repoState.fullName, name, { format: "text" });
          if (r && r.ok && typeof r.text === "string" && r.text.trim()) { text = r.text; break; }
        } catch (e) {}
      }
      panels.innerHTML = "";
      if (text == null) {
        panels.appendChild(panelMsg("📄", "This repository has no README."));
        return;
      }
      panels.appendChild(renderMarkdown(text));
      const imgs = panels.querySelectorAll(".gh-md-img");
      for (const im of imgs) {
        if (!im.complete) {
          const t = setTimeout(() => { if (!im.complete || im.naturalWidth === 0) im.remove(); }, 12000);
          im.addEventListener("load", () => clearTimeout(t), { once: true });
        }
      }
    }

    async function loadIssues() {
      const panels = body.querySelector(".gh-rpanel");
      panels.innerHTML = "";
      panels.appendChild(panelLoading());
      try {
        const list = await apiJson(
          API + "/repos/" + repoState.fullName + "/issues?state=open&per_page=15&sort=created&direction=desc",
          "i:" + repoState.fullName + ":open"
        );
        const issues = (Array.isArray(list) ? list : []).filter((x) => !x.pull_request);
        panels.innerHTML = "";
        if (!issues.length) {
          panels.appendChild(panelMsg("🎉", "No open issues — clean repository!"));
          return;
        }
        const listEl = el("div", "gh-iss");
        for (const is of issues) {
          const row = el("button", "gh-iss-row");
          row.type = "button";
          row.appendChild(el("span", "gh-iss-num", "#" + is.number));
          row.appendChild(el("span", "gh-iss-title", is.title));
          const meta2 = el("span", "gh-iss-meta", "👤 " + ((is.user && is.user.login) || "?") + " · 💬 " + is.comments + " · " + timeAgo(is.updated_at));
          row.appendChild(meta2);
          if (is.labels && is.labels.length) {
            const lbls = el("span", "gh-iss-labels");
            for (const l of is.labels.slice(0, 4)) {
              const b = el("span", "gh-iss-label", l.name);
              b.style.background = l.color ? "#" + l.color : "#94a3b8";
              lbls.appendChild(b);
            }
            row.appendChild(lbls);
          }
          row.addEventListener("click", () => openExternal("https://github.com/" + repoState.fullName + "/issues/" + is.number));
          listEl.appendChild(row);
        }
        panels.appendChild(listEl);
      } catch (e) {
        panels.innerHTML = "";
        panels.appendChild(panelMsg("⚠️", "Couldn't load issues: " + ((e && e.message) || e)));
      }
    }

    function crumbsEl(path, onCrumb) {
      const crumbs = el("div", "gh-crumbs");
      const rootC = el("button", "gh-crumb", repoState.data.name || repoState.fullName);
      rootC.type = "button";
      rootC.addEventListener("click", () => onCrumb(""));
      crumbs.appendChild(rootC);
      let acc = "";
      const parts = path ? path.split("/") : [];
      parts.forEach((p, i) => {
        crumbs.appendChild(el("span", "gh-crumb-sep", "/"));
        acc = acc ? acc + "/" + p : p;
        const b = el("button", "gh-crumb" + (i === parts.length - 1 ? " on" : ""), p);
        b.type = "button";
        b.addEventListener("click", () => onCrumb(acc));
        crumbs.appendChild(b);
      });
      return crumbs;
    }

    async function loadDir(path) {
      const panels = body.querySelector(".gh-rpanel");
      panels.innerHTML = "";
      panels.appendChild(panelLoading());
      let items = null;
      try {
        const r = await ghCall(repoState.fullName, path, { format: "list" });
        if (r && r.ok && Array.isArray(r.data)) items = r.data;
        if (!items) {
          const res = await apiFetch(API + "/repos/" + repoState.fullName + "/contents/" + encodeURIComponent(path) + "?ref=" + encodeURIComponent(repoState.data.default_branch || "HEAD"));
          const j = await res.json();
          items = Array.isArray(j) ? j : (j ? [j] : []);
        }
        panels.innerHTML = "";
        panels.appendChild(crumbsEl(path, loadDir));
        if (!items.length) {
          panels.appendChild(panelMsg("📂", "This folder is empty."));
          return;
        }
        const rows = el("div", "gh-code");
        for (const it of items) {
          const isDir = it.type === "dir";
          const row = el("button", "gh-frow");
          row.type = "button";
          row.appendChild(el("span", "gh-ficon", isDir ? "📁" : fileIcon(it.name)));
          row.appendChild(el("span", "gh-fname", it.name));
          if (!isDir && it.size != null) row.appendChild(el("span", "gh-fsize", fmtBytes(it.size)));
          row.addEventListener("click", () => (isDir ? loadDir(it.path) : openFile(it.path)));
          rows.appendChild(row);
        }
        panels.appendChild(rows);
      } catch (e) {
        panels.innerHTML = "";
        panels.appendChild(crumbsEl(path, loadDir));
        panels.appendChild(panelMsg("⚠️", "Couldn't list this folder: " + ((e && e.message) || e)));
      }
    }

    async function openFile(path) {
      const panels = body.querySelector(".gh-rpanel");
      panels.innerHTML = "";
      panels.appendChild(panelLoading());
      let text = null;
      try {
        const r = await ghCall(repoState.fullName, path, { format: "text" });
        if (r && r.ok && typeof r.text === "string") text = r.text;
        if (text == null) throw new Error("Couldn't fetch the file contents.");
        panels.innerHTML = "";
        panels.appendChild(crumbsEl(path, loadDir));
        if (/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(path)) {
          const im = document.createElement("img");
          im.className = "gh-fileimg";
          im.src = "https://raw.githubusercontent.com/" + repoState.fullName + "/" + encodeURIComponent(repoState.data.default_branch || "HEAD") + "/" + path.split("/").map(encodeURIComponent).join("/");
          panels.appendChild(im);
          return;
        }
        const pre = el("pre", "gh-codeview");
        const MAX = 200000;
        pre.textContent = text.length > MAX ? text.slice(0, MAX) + "\n\n… (file truncated at 200 KB)" : text;
        panels.appendChild(pre);
      } catch (e) {
        panels.innerHTML = "";
        panels.appendChild(crumbsEl(path, loadDir));
        panels.appendChild(panelMsg("⚠️", "Couldn't open this file: " + ((e && e.message) || e)));
      }
    }

    // ---- wiring ----
    function doSearch() {
      const q = query.value.trim();
      if (!q) { toast("Search", "Type something to search for.", "🔎"); query.focus(); return; }
      runSearch(q, true);
    }
    goBtn.addEventListener("click", doSearch);
    query.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSearch(); }
      else if (e.key === "Escape") { e.preventDefault(); query.blur(); }
    });
    tabSearch.addEventListener("click", goHome);
    tabTrend.addEventListener("click", () => showTrend(state.period || "week"));
    backBtn.addEventListener("click", () => {
      if (returnTo && returnTo.kind === "trend") showTrend(returnTo.period || "week");
      else if (returnTo && returnTo.kind === "search" && returnTo.query) runSearch(returnTo.query, true);
      else goHome();
    });

    goHome();
    return { root: view };
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["github"] = function () {
    const v = build();
    return { content: v.root, w: 920, h: 660, minW: 640, minH: 480 };
  };
})();
