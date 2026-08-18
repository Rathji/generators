/* ════════════════════════════════════════════════════════════════
   BGN GAME REFERENCE TEMPLATE — src/app.js (Boardgame Network)
   ─────────────────────────────────────────────────────────────────
   A fully generic search/reference engine. Nothing in this file
   knows what game it's serving — everything game-specific lives in
   src/config.js (categories, sources, dice, theming, copy, etc.).

   The engine provides:
     · search across any number of "sources" (bundled JSON, live APIs)
     · grouped results, favorites, copy results + references
     · a detail renderer for the standard entry/block model
     · Sources modal, Import (custom content) modal, GM tools
     · per-game theming, share links and URL-state handling

   Block types understood by the renderer (entry.blocks[]):
     p, sec, kv, kvrow, list, table, feat, quote, abil, hr
   ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search || "");
  const GAME_ID = window.BGN_REF.resolve(params);
  const game = window.BGN_REF.games[GAME_ID];
  const H = window.BGN_REF.helpers;
  const SOURCES = game.sources;
  const CUSTOM = game.custom || null;
  const GROUP_ICONS = game.groupIcons || {};
  const ALL = "All", FAVS = "Favorites";

  const $ = (id) => document.getElementById(id);
  const searchInput = $("searchInput"), clearBtn = $("clearBtn");
  const statusEl = $("statusEl"), suggestCtn = $("suggestCtn");
  const refLayout = $("refLayout"), resultsEl = $("resultsEl"), countEl = $("countEl");
  const detailEl = $("detailEl"), detailEmpty = $("detailEmpty");
  const groupBar = $("groupBar"), chipBar = $("chipBar");

  const ctx = { state: null, customId: CUSTOM ? CUSTOM.id : null, kv, isFav, game: GAME_ID };
  let state = null;
  function initState() {
    const s = { sources: {}, books: new Set(), group: ALL, query: "", selId: null };
    for (const src of SOURCES) s.sources[src.id] = src.defaultOn !== false;
    if (CUSTOM) s.sources[CUSTOM.id] = CUSTOM.defaultOn !== false;
    return s;
  }
  state = initState();
  ctx.state = state;
  function kv() { return (window.root && root.kv) || null; }
  function ensureSource(src) {
    if (!src.ensure) return Promise.resolve();
    if (src.ensureNote && !src._ready) statusEl.textContent = src.ensureNote;
    const p = Promise.resolve(src.ensure(ctx)).catch(() => {});
    src._ready = p; return p;
  }

  /* ═══════════ favorites ═══════════ */
  const favSet = new Set();
  function favIdent(kind, entry) {
    if (kind === CUSTOM.id) return GAME_ID + ":hb:" + entry.id;
    const src = SOURCES.find((s) => s.id === kind);
    const key = src && src.favKey ? src.favKey(entry) : (entry.id || entry.name || "");
    return GAME_ID + ":" + kind + ":" + key;
  }
  function isFav(kind, entry) { return favSet.has(favIdent(kind, entry)); }
  async function loadFavs() {
    try {
      const k = kv(); if (!k) return;
      const saved = await k.favorites.get("entries");
      if (Array.isArray(saved)) { favSet.clear(); for (const id of saved) favSet.add(id); }
    } catch (e) { console.error("favorites load failed", e); }
  }
  function saveFavs() {
    const k = kv(); if (!k) return;
    k.favorites.set("entries", [...favSet]).catch(() => {});
  }
  function toggleFav(kind, entry) {
    const id = favIdent(kind, entry);
    if (favSet.has(id)) favSet.delete(id); else favSet.add(id);
    saveFavs();
    refreshStars();
    if (state.group === FAVS) runSearch();
  }

  /* ═══════════ homebrew / custom content (generic) ═══════════ */
  let homebrewItems = [];
  async function loadHomebrew() {
    try {
      const k = kv(); if (!k) return;
      const saved = await k.homebrew.get("entries");
      if (Array.isArray(saved)) homebrewItems = saved.filter((e) => e && e.name);
    } catch (e) { console.error("homebrew load failed", e); }
  }
  function saveHomebrew() {
    const k = kv(); if (!k) return;
    k.homebrew.set("entries", homebrewItems).catch(() => {});
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item"; }
  function makeHomebrewEntry(src, group) {
    const validGroup = game.groups.includes(src.group) ? src.group : (game.groups.includes(group) ? group : game.groups[0] || "Rules");
    return {
      id: "hb-" + slug(src.name) + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 999),
      name: String(src.name || "Untitled").trim(),
      category: src.category || "", group: validGroup, edition: "Custom",
      chapter: "Custom", subtitle: src.subtitle || "", tags: Array.isArray(src.tags) ? src.tags : [],
      meta: {}, blocks: Array.isArray(src.blocks) ? src.blocks : [{ type: "p", t: "" }],
      refs: [], homebrew: true, text: "",
    };
  }
  function finalizeHomebrewEntry(e) { e.text = H.buildSearchText(e); return e; }
  function parseRuleText(text, group) {
    const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
    const bodyStart = lines.findIndex((l) => l.trim() !== "");
    if (bodyStart === -1) throw new Error("Nothing to import — paste some rule text first.");
    const titleLine = lines[bodyStart].trim().replace(/^[-*•]\s*/, "");
    const dash = titleLine.search(/\s+[—–-]\s+/);
    const name = (dash === -1 ? titleLine : titleLine.slice(0, dash)).trim();
    const subtitle = dash === -1 ? "" : titleLine.slice(dash + 1).replace(/^[—–-]\s*/, "").trim();
    const blocks = [];
    let para = [], list = [], listOrdered = false;
    const flushPara = () => { if (para.length) { blocks.push({ type: "p", t: para.join("\n") }); para = []; } };
    const flushList = () => { if (list.length) { blocks.push({ type: "list", ordered: listOrdered, items: list }); list = []; } };
    for (let i = bodyStart + 1; i < lines.length; i++) {
      const raw = lines[i], line = raw.trim();
      if (line === "") { flushPara(); flushList(); continue; }
      if (/^(#{1,3}\s+|=+$)/.test(line) || /^={3,}\s*$/.test(line)) {
        flushPara(); flushList();
        blocks.push({ type: "sec", t: line.replace(/^#{1,3}\s+/, "").replace(/=+$/, "").trim() });
        continue;
      }
      if (/^>\s?/.test(line)) { flushPara(); flushList(); blocks.push({ type: "quote", t: line.replace(/^>\s?/, "") }); continue; }
      const m = line.match(/^([-*•])\s+(.*)$/) || line.match(/^(\d+)[.)]\s+(.*)$/);
      if (m) {
        flushPara();
        const ordered = !!m[2] && /^\d+[.)]/.test(line) ? true : false;
        if (!list.length) { list = []; listOrdered = ordered; }
        list.push(m[2]);
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara(); flushList();
    if (!blocks.length) blocks.push({ type: "p", t: para.join("\n") || titleLine });
    if (!name) throw new Error("Couldn't find a title — put the rule's name on the first line.");
    const entry = makeHomebrewEntry({ name, subtitle, category: "rule", blocks }, group);
    return finalizeHomebrewEntry(entry);
  }
  function parseJsonImport(text, group) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error("That's not valid JSON — " + e.message); }
    const raws = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [data]);
    if (!raws.length) throw new Error("No entries found in that JSON.");
    const out = [];
    for (const raw of raws) {
      if (!raw || typeof raw !== "object") continue;
      const name = raw.name || raw.title || raw.n;
      if (!name) continue;
      const blocks = [];
      for (const b of Array.isArray(raw.blocks) ? raw.blocks : []) {
        if (!b || typeof b !== "object" || !b.type) continue;
        const type = String(b.type).replace("text", "t");
        if (type === "p" || type === "sec" || type === "seclist" || type === "quote" || type === "feat") {
          const t = b.t ?? b.text ?? b.content ?? "";
          if (t === "") continue;
          const blk = { type };
          if (type === "feat") blk.name = b.name || raw.name || "";
          blk.t = String(t);
          blocks.push(blk);
        } else if (type === "kv") {
          const k = b.k ?? b.key ?? "";
          const v = b.v ?? b.value ?? "";
          if (k === "") continue;
          blocks.push({ type: "kv", k: String(k), v: String(v) });
        } else if (type === "kvrow") {
          if (Array.isArray(b.pairs)) blocks.push({ type: "kvrow", pairs: b.pairs });
        } else if (type === "list") {
          if (Array.isArray(b.items)) blocks.push({ type: "list", ordered: !!b.ordered, items: b.items.map((x) => String(x)) });
        } else if (type === "table") {
          if (Array.isArray(b.rows)) blocks.push({ type: "table", headers: Array.isArray(b.headers) ? b.headers : [], rows: b.rows.map((r) => Array.isArray(r) ? r : [String(r)]) });
        } else if (type === "abil") {
          if (b.abilities) blocks.push({ type: "abil", abilities: b.abilities });
        } else if (type === "hr") blocks.push({ type: "hr" });
      }
      if (!blocks.length) blocks.push({ type: "p", t: raw.text || raw.desc || raw.description || "" });
      const e = makeHomebrewEntry({ name, subtitle: raw.subtitle || "", category: raw.category || "", tags: raw.tags, blocks, refs: raw.refs }, raw.group || group);
      out.push(finalizeHomebrewEntry(e));
    }
    if (!out.length) throw new Error("No valid entries in that JSON — each needs at least a \"name\".");
    return out;
  }
  function importEntries(entries) {
    let added = 0;
    for (const e of entries) {
      if (homebrewItems.some((x) => x.id === e.id)) continue;
      homebrewItems.push(e); added++;
    }
    if (added) saveHomebrew();
    return added;
  }
  function deleteEntry(id) {
    const before = homebrewItems.length;
    homebrewItems = homebrewItems.filter((e) => e.id !== id);
    if (homebrewItems.length !== before) saveHomebrew();
    return homebrewItems.length !== before;
  }
  function cleanEntry(e) {
    const o = { name: e.name };
    if (e.subtitle) o.subtitle = e.subtitle;
    o.group = e.group || game.groups[0] || "Rules";
    if (e.category) o.category = e.category;
    if (e.tags && e.tags.length) o.tags = e.tags;
    if (e.refs && e.refs.length) o.refs = e.refs.map((r) => ({ book: r.book, chapter: r.chapter || "", license: r.license || "" }));
    o.blocks = (e.blocks || []).map((b) => ({ ...b }));
    return o;
  }
  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function exportCustom() {
    if (!homebrewItems.length) throw new Error("Nothing to export yet — import some content first.");
    downloadJSON(game.exportName + ".json", { version: 1, entries: homebrewItems.map(cleanEntry) });
  }
  async function publishEntry(entry, btn) {
    const up = (window.root && root.uploadPlugin) || null;
    if (!up) { flashBtn(btn, "⚠ Upload unavailable", 2000); return; }
    try {
      const res = await up(JSON.stringify({ version: 1, entries: [cleanEntry(entry)] }), {});
      if (res.error) {
        flashBtn(btn, res.error === "another_upload_in_progress" ? "⏳ Wait a moment, then retry" : "⚠ Upload failed", 2400);
        return;
      }
      const url = "https://perchance.org/" + (window.generatorName || "") + "?import=" + encodeURIComponent(res.url);
      copyText(btn, url, "✓ Link copied!");
    } catch (e) {
      console.error("publish failed", e);
      flashBtn(btn, "⚠ Upload failed", 2000);
    }
  }
  function flashBtn(btn, msg, ms) {
    const old = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = old; }, ms || 1400);
  }

  /* ═══════════ search ═══════════ */
  function matchCustom(q, group, limit) {
    const out = [];
    for (const e of homebrewItems) {
      if (group === FAVS) { if (!isFav(CUSTOM.id, e)) continue; }
      else if (group !== ALL && group !== CUSTOM.id && e.group !== group) continue;
      if (q && H.buildSearchText(e).indexOf(q) === -1) continue;
      out.push(e);
    }
    if (q) {
      const score = (e) => e.name.toLowerCase().startsWith(q) ? 0 : e.name.toLowerCase().indexOf(q) !== -1 ? 1 : 2;
      out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
    }
    return limit ? out.slice(0, limit) : out;
  }
  async function runSearch() {
    const q = state.query.trim().toLowerCase();
    const group = state.group;
    if (!q && group !== FAVS) { suggestCtn.hidden = false; refLayout.hidden = true; return; }
    suggestCtn.hidden = true;
    refLayout.hidden = false;

    for (const s of SOURCES) if (state.sources[s.id] && s.ensure) await ensureSource(s);

    const items = [];
    for (const s of SOURCES) {
      if (state.sources[s.id] !== true || !s.match) continue;
      for (const e of s.match(q, group, ctx, 60)) items.push({ kind: s.id, entry: e, name: e.name || "" });
    }
    if (CUSTOM && state.sources[CUSTOM.id]) for (const e of matchCustom(q, group, 60)) items.push({ kind: CUSTOM.id, entry: e, name: e.name });

    const byName = new Map();
    for (const it of items) {
      const k = (it.kind === CUSTOM.id || (SOURCES.find((s) => s.id === it.kind) && SOURCES.find((s) => s.id === it.kind).id === "ex")) ? it.kind + "::" : "";
      const key = k + it.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(it);
    }
    const merged = [...byName.values()].sort((a, b) => {
      const an = a[0].name.toLowerCase(), bn = b[0].name.toLowerCase();
      const sa = q && an.startsWith(q) ? 0 : an.indexOf(q) !== -1 ? 1 : 2;
      const sb = q && bn.startsWith(q) ? 0 : bn.indexOf(q) !== -1 ? 1 : 2;
      return sa - sb || an.localeCompare(bn);
    }).map((g) => ({ key: (g[0].kind === CUSTOM.id ? CUSTOM.id + "::" : "") + g[0].name, name: g[0].name, items: g })).slice(0, 60);

    renderResults(merged);
    if (merged.length) select(merged[0]);
    else {
      detailEl.hidden = true; detailEmpty.hidden = false;
      detailEmpty.innerHTML = group === FAVS ? game.favEmpty : (game.noResults ? game.noResults(q) : "");
    }
  }

  function badgeFor(kind) {
    if (CUSTOM && kind === CUSTOM.id) return CUSTOM.badge;
    const s = SOURCES.find((x) => x.id === kind);
    return (s && s.badge) || { cls: "ed-expanded", text: kind };
  }
  function primaryOf(group) {
    let best = group.items[0];
    for (const it of group.items) {
      const r = (SOURCES.find((s) => s.id === it.kind) || { rank: 99 }).rank;
      if (r < (SOURCES.find((s) => s.id === best.kind) || { rank: 99 }).rank) best = it;
    }
    return best;
  }
  function renderResults(merged) {
    countEl.textContent = merged.length + " result" + (merged.length === 1 ? "" : "s");
    resultsEl.innerHTML = "";
    for (const g of merged) {
      const row = document.createElement("div");
      row.className = "result-row";
      row.dataset.name = g.key;
      const primary = primaryOf(g);
      row.dataset.fav = favIdent(primary.kind, primary.entry);
      const entry = primary.entry;
      const sub = entry.subtitle || "";
      const grp = entry.group || "Rules";
      const kinds = g.items.map((i) => i.kind);
      const badgeTexts = [...new Set(kinds.map((k) => badgeFor(k).text))];
      const badgeCls = badgeFor(primary.kind).cls;
      const badge = '<span class="ed-badge ' + badgeCls + '" title="' + H.esc(badgeTexts.join(" + ")) + '">' + H.esc(badgeTexts.join("+")) + "</span>";
      const main = document.createElement("button");
      main.type = "button";
      main.className = "row-main";
      let tags = '<span class="r-cat">' + (GROUP_ICONS[grp] || "•") + " " + H.esc(grp) + "</span>";
      if (entry.category) tags += '<span class="r-cat">' + H.esc(entry.category) + "</span>";
      const ex = SOURCES.find((s) => s.id === primary.kind);
      if (ex && ex.rowExtra) tags += ex.rowExtra(entry);
      main.innerHTML =
        '<div class="r-top"><span class="r-name"></span>' + badge + "</div>" +
        (sub ? '<div class="r-sub"></div>' : "") +
        '<div class="r-tags">' + tags + "</div>";
      main.querySelector(".r-name").textContent = g.name;
      if (sub) main.querySelector(".r-sub").textContent = sub;
      main.addEventListener("click", () => select(g));
      const star = document.createElement("button");
      star.type = "button";
      star.className = "star-btn";
      star.title = isFav(primary.kind, primary.entry) ? "Remove from favorites" : "Save to favorites";
      star.textContent = "☆";
      star.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(primary.kind, primary.entry); });
      row.appendChild(main);
      row.appendChild(star);
      resultsEl.appendChild(row);
    }
    refreshStars();
  }
  function refreshStars() {
    for (const row of resultsEl.children) {
      const star = row.querySelector(".star-btn");
      if (!star) continue;
      const on = favSet.has(row.dataset.fav);
      star.textContent = on ? "★" : "☆";
      star.classList.toggle("on", on);
      star.title = on ? "Remove from favorites" : "Save to favorites";
    }
    const favBtn = $("favBtn");
    if (favBtn && currentFavIdent) {
      const on = favSet.has(currentFavIdent);
      favBtn.textContent = on ? "★ Saved" : "☆ Save";
      favBtn.classList.toggle("on", on);
    }
  }
  let currentFavIdent = null;

  /* ═══════════ selection + detail ═══════════ */
  function select(group) {
    state.selId = group.key;
    for (const el of resultsEl.children) el.classList.toggle("sel", el.dataset.name === group.key);
    renderDetail(group);
  }
  function entryFor(group, kind) {
    return group.items.find((i) => i.kind === kind) || null;
  }
  function sourceOf(kind) {
    return (CUSTOM && kind === CUSTOM.id) ? CUSTOM : SOURCES.find((s) => s.id === kind) || null;
  }
  async function renderDetail(group) {
    detailEl.hidden = false;
    detailEmpty.hidden = true;
    const primary = primaryOf(group);
    const src = sourceOf(primary.kind);
    if (!src || !src.fetchDetail) { drawEntry(group, primary.entry, primary.kind); return; }
    detailEl.innerHTML = '<div class="detail-loading"><div class="spin"></div><div>Fetching ' + H.esc(group.name) + "…</div></div>";
    try {
      const entry = await src.fetchDetail(primary.entry);
      drawEntry(group, entry, primary.kind);
    } catch (e) {
      console.error("detail fetch failed", primary.entry, e);
      detailEl.innerHTML = '<div class="detail-loading muted">Couldn\'t load <b>' + H.esc(group.name) + "</b> from " + H.esc(src.label) + ". Check your connection and try again.</div>";
    }
  }
  async function showSourceTab(group, kind) {
    const item = entryFor(group, kind);
    if (!item) return;
    const src = sourceOf(kind);
    if (!src.fetchDetail) { drawEntry(group, item.entry, kind); return; }
    detailEl.innerHTML = '<div class="detail-loading"><div class="spin"></div><div>Fetching ' + H.esc(group.name) + "…</div></div>";
    try {
      drawEntry(group, await src.fetchDetail(item.entry), kind);
    } catch (e) {
      detailEl.innerHTML = '<div class="detail-loading muted">Couldn\'t load <b>' + H.esc(group.name) + "</b> from " + H.esc(src.label) + ". Check your connection and try again.</div>";
    }
  }

  /* ═══════════ rendering ═══════════ */
  function renderBlocks(container, blocks) {
    for (const b of blocks) {
      const wrap = document.createElement("div");
      wrap.className = "block";
      switch (b.type) {
        case "kv":
          wrap.className = "block block-kv";
          wrap.innerHTML = "<b>" + H.esc(b.k) + "</b><span>" + H.inlineHTML(b.v) + "</span>";
          break;
        case "kvrow": {
          wrap.className = "block kvrow";
          for (const p of b.pairs) {
            const s = document.createElement("span");
            s.className = "kv";
            s.innerHTML = "<b>" + H.esc(p.k) + "</b> " + H.inlineHTML(p.v);
            wrap.appendChild(s);
          }
          break;
        }
        case "p": {
          wrap.className = "block block-p";
          const leadM = b.t.match(/^_([^_]{2,70}?)\\._ (.*)$/s);
          if (leadM) wrap.innerHTML = '<em class="lead">' + H.esc(H.inlineText(leadM[1])) + ".</em> " + H.inlineHTML(leadM[2]);
          else if (b.t.match(/^_([^_]+)_$/)) wrap.innerHTML = "<i>" + H.inlineHTML(b.t) + "</i>";
          else wrap.innerHTML = H.inlineHTML(b.t);
          break;
        }
        case "feat":
          wrap.className = "block block-feat";
          wrap.innerHTML = "<b><i>" + H.esc(H.inlineText(b.name)) + ".</i></b> " + H.inlineHTML(b.t);
          break;
        case "sec":
          wrap.className = "block block-sec";
          wrap.textContent = H.inlineText(b.t);
          break;
        case "seclist":
          wrap.className = "block block-sec";
          wrap.style.marginTop = "14px";
          wrap.textContent = H.inlineText(b.t);
          break;
        case "hr":
          wrap.innerHTML = '<hr style="border:none;border-top:1px solid var(--bgn-line)">';
          break;
        case "list": {
          wrap.className = "block block-list";
          const ul = document.createElement(b.ordered ? "ol" : "ul");
          for (const it of b.items) {
            const li = document.createElement("li");
            li.innerHTML = H.inlineHTML(it);
            ul.appendChild(li);
          }
          wrap.appendChild(ul);
          break;
        }
        case "quote":
          wrap.className = "block block-quote";
          wrap.innerHTML = H.inlineHTML(b.t);
          break;
        case "table": {
          wrap.className = "block block-table";
          const table = document.createElement("table");
          if (b.headers && b.headers.length) {
            const thead = document.createElement("thead");
            const tr = document.createElement("tr");
            for (const h of b.headers) { const th = document.createElement("th"); th.innerHTML = H.inlineHTML(h); tr.appendChild(th); }
            thead.appendChild(tr);
            table.appendChild(thead);
          }
          const tbody = document.createElement("tbody");
          for (const r of b.rows) {
            if (r.length === 1) {
              const tr = document.createElement("tr");
              const td = document.createElement("td");
              td.colSpan = Math.max(b.headers ? b.headers.length : 4, 1);
              td.className = "muted";
              td.style.fontStyle = "italic";
              td.innerHTML = H.inlineHTML(r[0]);
              tr.appendChild(td);
              tbody.appendChild(tr);
              continue;
            }
            const tr = document.createElement("tr");
            for (const c of r) { const td = document.createElement("td"); td.innerHTML = H.inlineHTML(c); tr.appendChild(td); }
            tbody.appendChild(tr);
          }
          table.appendChild(tbody);
          wrap.appendChild(table);
          break;
        }
        case "abil": {
          wrap.className = "block abil-grid";
          const order = ["str", "dex", "con", "int", "wis", "cha"];
          const names = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
          for (const key of order) {
            const a = b.abilities[key];
            if (!a) continue;
            const d = document.createElement("div");
            d.className = "abil";
            let html = '<div class="ab">' + names[key] + "</div>";
            if (a.score !== "" && a.score != null) html += '<div class="sc">' + H.esc(String(a.score)) + "</div>";
            html += '<div class="md">' + H.esc(String(a.mod ?? "")) + "</div>";
            if (a.save) html += '<div class="sv">save ' + H.esc(String(a.save)) + "</div>";
            d.innerHTML = html;
            wrap.appendChild(d);
          }
          break;
        }
        default:
          break;
      }
      if (wrap.childNodes.length || wrap.textContent) container.appendChild(wrap);
    }
  }
  function blocksToPlain(blocks) {
    const lines = [];
    for (const b of blocks) {
      switch (b.type) {
        case "kv": lines.push(H.inlineText(b.k) + ": " + H.inlineText(b.v)); break;
        case "kvrow": lines.push(b.pairs.map((p) => H.inlineText(p.k) + " " + H.inlineText(p.v)).join("  ·  ")); break;
        case "p": lines.push(H.inlineText(b.t)); break;
        case "feat": lines.push(H.inlineText(b.name) + ". " + H.inlineText(b.t)); break;
        case "sec": case "seclist": lines.push(""); lines.push("— " + H.inlineText(b.t).toUpperCase() + " —"); break;
        case "list": lines.push(b.items.map((it) => (b.ordered ? "1. " : "• ") + H.inlineText(it)).join("\n")); break;
        case "quote": lines.push("> " + H.inlineText(b.t)); break;
        case "hr": break;
        case "table": {
          if (b.headers && b.headers.length) lines.push(b.headers.map((h) => H.inlineText(h)).join("\t"));
          for (const r of b.rows) lines.push(r.map((c) => H.inlineText(c)).join("\t"));
          break;
        }
        case "abil": {
          const names = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
          const order = ["str", "dex", "con", "int", "wis", "cha"];
          lines.push(order.filter((k) => b.abilities[k]).map((k) => {
            const a = b.abilities[k];
            return names[k] + " " + (a.score ? a.score + " (" + a.mod + ")" : a.mod) + (a.save ? ", save " + a.save : "");
          }).join("  "));
          break;
        }
        default: break;
      }
    }
    return lines.join("\n").replace(/−/g, "-");
  }

  /* ═══════════ detail drawing + copy ═══════════ */
  function drawEntry(group, entry, kind) {
    const src = sourceOf(kind);
    const isCustom = CUSTOM && kind === CUSTOM.id;
    const badge = badgeFor(kind);
    currentFavIdent = favIdent(kind, entry);
    detailEl.innerHTML = "";
    const head = document.createElement("div");
    head.className = "detail-head";

    const titleRow = document.createElement("div");
    titleRow.className = "detail-title";
    const title = document.createElement("div");
    const h = document.createElement("div");
    h.className = "detail-name";
    h.textContent = group.name;
    title.appendChild(h);
    if (entry.subtitle) {
      const s = document.createElement("div");
      s.className = "detail-sub";
      s.textContent = entry.subtitle;
      title.appendChild(s);
    }
    titleRow.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "detail-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn btn-gold btn-sm";
    copyBtn.textContent = "📋 Copy results + references";
    const refBtn = document.createElement("button");
    refBtn.className = "btn btn-ghost btn-sm";
    refBtn.textContent = "🔗 Reference only";
    const favBtn = document.createElement("button");
    favBtn.className = "btn btn-ghost btn-sm star-detail";
    favBtn.id = "favBtn";
    favBtn.title = "Save to favorites";
    actions.appendChild(copyBtn);
    actions.appendChild(refBtn);
    actions.appendChild(favBtn);
    favBtn.addEventListener("click", () => toggleFav(kind, entry));
    if (isCustom) {
      const shareBtn = document.createElement("button");
      shareBtn.className = "btn btn-sm";
      shareBtn.id = "shareHbBtn";
      shareBtn.style.borderColor = "rgba(212,175,55,.4)";
      shareBtn.style.color = "var(--bgn-accent2)";
      shareBtn.textContent = "🌐 Share";
      shareBtn.title = "Upload this and copy a link anyone can import";
      actions.appendChild(shareBtn);
      shareBtn.addEventListener("click", () => publishEntry(entry, shareBtn));
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm";
      delBtn.id = "deleteHbBtn";
      delBtn.style.borderColor = "rgba(220,90,90,.5)";
      delBtn.style.color = "#e08a8a";
      delBtn.textContent = "🗑 Delete";
      actions.appendChild(delBtn);
      delBtn.addEventListener("click", () => {
        if (!confirm("Delete \"" + group.name + "\"? This only removes it from your browser.")) return;
        deleteEntry(entry.id);
        runSearch();
      });
    }
    titleRow.appendChild(actions);
    head.appendChild(titleRow);

    const tags = document.createElement("div");
    tags.className = "detail-tags";
    const edBadge = document.createElement("span");
    edBadge.className = "ed-badge " + badge.cls;
    edBadge.textContent = badge.text;
    tags.appendChild(edBadge);
    if (group.items && group.items.length > 1) {
      const tabCtn = document.createElement("span");
      tabCtn.className = "ed-tabs";
      for (const it of group.items) {
        if (it.kind === kind) continue;
        const s2 = sourceOf(it.kind);
        if (!s2) continue;
        const b = document.createElement("button");
        b.className = "chip edtab";
        b.textContent = s2.tabLabel + " version";
        b.title = s2.label;
        b.addEventListener("click", () => showSourceTab(group, it.kind));
        tabCtn.appendChild(b);
      }
      tags.appendChild(tabCtn);
    }
    if (entry.group) {
      const t1 = document.createElement("span");
      t1.className = "r-cat";
      t1.textContent = (GROUP_ICONS[entry.group] || "•") + " " + entry.group;
      tags.appendChild(t1);
    }
    for (const t of (entry.tags || []).slice(0, 6)) {
      const s = document.createElement("span");
      s.className = "r-cat";
      s.textContent = t;
      tags.appendChild(s);
    }
    head.appendChild(tags);
    detailEl.appendChild(head);

    const body = document.createElement("div");
    body.className = "blocks";
    renderBlocks(body, entry.blocks || []);
    detailEl.appendChild(body);

    const foot = document.createElement("div");
    foot.className = "ref-foot";
    const ft = document.createElement("div");
    ft.className = "ref-title";
    ft.textContent = "Reference";
    foot.appendChild(ft);
    const refStr = isCustom ? "Custom content · " + (CUSTOM.label || "your table")
      : (src && src.refFor ? (src.refFor(entry) || "") : "") || (entry.refs && entry.refs.length ? entry.refs.map((r) => r.book).join(" · ") : "") || (src ? src.label : "SRD");
    const fl = document.createElement("div");
    fl.className = "ref-line";
    fl.textContent = group.name + " — " + refStr;
    foot.appendChild(fl);
    const lic = document.createElement("div");
    lic.className = "ref-license";
    if (isCustom) lic.textContent = CUSTOM.license || "Added by you — stored in your browser only.";
    else lic.textContent = (entry.refs && entry.refs[0] && entry.refs[0].license) || (src && src.license) || "";
    foot.appendChild(lic);
    detailEl.appendChild(foot);

    const fullRef = group.name + " — " + refStr;
    copyBtn.addEventListener("click", () => {
      const text = group.name.toUpperCase() + (entry.subtitle ? "\n" + H.inlineText(entry.subtitle) : "") + "\n\n" + blocksToPlain(entry.blocks || []) + "\n\n— Reference: " + fullRef;
      copyText(copyBtn, text, "✓ Copied!");
    });
    refBtn.addEventListener("click", () => copyText(refBtn, "Reference: " + fullRef, "✓ Copied!"));
  }

  function copyText(btn, text, doneMsg) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = doneMsg;
      setTimeout(() => { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { alert("Couldn't copy — select the text above and copy manually."); }
  }

  /* ═══════════ chips + groups + popular (rendered from config) ═══════════ */
  function renderGroupChips() {
    if (!groupBar) return;
    groupBar.innerHTML = "";
    const add = (label, value, on) => {
      const c = document.createElement("button");
      c.className = "chip" + (on ? " on" : "");
      c.dataset.g = value;
      c.textContent = label;
      c.addEventListener("click", () => {
        groupBar.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        state.group = value;
        if (state.query.trim()) runSearch();
      });
      groupBar.appendChild(c);
    };
    add("All", ALL, state.group === ALL);
    for (const g of game.groups) add(GROUP_ICONS[g] ? GROUP_ICONS[g] + " " + g : g, g, state.group === g);
    if (CUSTOM) add(CUSTOM.chipIcon + " " + CUSTOM.chipLabel, CUSTOM.id, state.group === CUSTOM.id);
    add("★ " + FAVS, FAVS, state.group === FAVS);
  }
  function renderChipBar() {
    if (!chipBar) return;
    chipBar.innerHTML = "";
    if (!game.chips || !game.chips.length) { chipBar.hidden = true; return; }
    chipBar.hidden = false;
    for (const chip of game.chips) {
      const c = document.createElement("button");
      c.className = "chip";
      c.dataset.chip = chip.id;
      c.textContent = chip.label;
      c.addEventListener("click", () => {
        for (const [id, on] of Object.entries(chip.set)) if (id in state.sources) state.sources[id] = on;
        syncChips();
        savePrefs();
        if (state.query.trim()) runSearch();
      });
      chipBar.appendChild(c);
    }
    syncChips();
  }
  function syncChips() {
    if (!chipBar) return;
    for (const c of chipBar.children) {
      const chip = (game.chips || []).find((x) => x.id === c.dataset.chip);
      if (!chip) continue;
      const on = Object.entries(chip.set).every(([id, v]) => state.sources[id] === v);
      c.classList.toggle("on", on);
    }
  }
  function renderPopular() {
    if (!suggestCtn) return;
    const label = document.createElement("span");
    label.className = "muted small";
    label.style.letterSpacing = ".1em";
    label.style.textTransform = "uppercase";
    label.textContent = "Popular:";
    const wrap = document.createElement("div");
    wrap.className = "flex center";
    wrap.style.cssText = "gap:8px;flex-wrap:wrap;justify-content:center";
    wrap.appendChild(label);
    for (const q of game.popular || []) {
      const b = document.createElement("button");
      b.className = "chip";
      b.dataset.s = q;
      b.textContent = q;
      wrap.appendChild(b);
    }
    suggestCtn.innerHTML = "";
    suggestCtn.appendChild(wrap);
  }

  /* ═══════════ wiring ═══════════ */
  let debounce = null;
  searchInput.addEventListener("input", () => {
    clearBtn.hidden = !searchInput.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.query = searchInput.value; runSearch(); }, 130);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = resultsEl.querySelector(".result-row");
      if (first) first.click();
    }
  });
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.hidden = true;
    state.query = "";
    runSearch();
    searchInput.focus();
  });
  $("linkBtn").addEventListener("click", () => copyText($("linkBtn"), shareUrl(), "✓ Link copied!"));
  function shareUrl() {
    if (game.shareQuery) {
      const p = game.shareQuery(ctx);
      if (GAME_ID !== window.BGN_REF.defaultGame) p.set("game", GAME_ID);
      const qs = p.toString();
      return "https://perchance.org/" + (window.generatorName || "") + (qs ? "?" + qs : "");
    }
    const p = new URLSearchParams();
    const q = state.query.trim();
    if (q) p.set("q", q);
    const on = SOURCES.filter((s) => state.sources[s.id]).map((s) => s.id);
    if (CUSTOM && state.sources[CUSTOM.id]) on.push(CUSTOM.id);
    if (on.length !== SOURCES.length + (CUSTOM ? 1 : 0)) p.set("src", on.join(","));
    if (GAME_ID !== window.BGN_REF.defaultGame) p.set("game", GAME_ID);
    const qs = p.toString();
    return "https://perchance.org/" + (window.generatorName || "") + (qs ? "?" + qs : "");
  }
  function applyUrlState(p) {
    if (game.allowSrcParam !== false) {
      const src = p.get("src");
      if (src) {
        const ids = new Set(String(src).split(",").filter(Boolean));
        for (const s of SOURCES) state.sources[s.id] = ids.has(s.id);
        if (CUSTOM) state.sources[CUSTOM.id] = ids.has(CUSTOM.id);
      }
    }
    if (game.urlState) game.urlState(p, ctx);
  }

  async function savePrefs() {
    const k = kv(); if (!k) return;
    try { await k.prefs.set("sources", { s: state.sources, b: [...state.books], g: GAME_ID }); } catch (e) { /* non-fatal */ }
  }
  async function loadPrefs() {
    const k = kv(); if (!k) return;
    try {
      const p = await k.prefs.get("sources");
      if (p && p.g === GAME_ID && p.s) {
        state.sources = { ...initState().sources, ...p.s };
        state.books = new Set(Array.isArray(p.b) ? p.b : []);
      }
    } catch (e) { /* defaults */ }
  }
  groupBar && groupBar.addEventListener("click", (e) => { /* handled per chip */ });
  suggestCtn.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-s]");
    if (!btn) return;
    searchInput.value = btn.dataset.s;
    clearBtn.hidden = false;
    state.query = btn.dataset.s;
    runSearch();
    searchInput.focus();
  });

  /* ═══════════ sources modal ═══════════ */
  const sourcesModal = $("sourcesModal"), sourcesStatus = $("sourcesStatus");
  const setSourcesStatus = (msg, ok) => { sourcesStatus.textContent = msg; sourcesStatus.style.color = ok ? "var(--bgn-accent2)" : "#e08a8a"; };
  function syncSourcesUI() {
    for (const c of sourcesModal.querySelectorAll("input[type=checkbox][data-src]")) c.checked = !!state.sources[c.dataset.src];
    const ws = $("srcBooksWrap");
    if (ws) ws.style.opacity = state.sources.ex ? "1" : ".45";
  }
  function renderSourceCheckboxes() {
    const officialEl = $("srcOfficial");
    if (!officialEl) return;
    officialEl.innerHTML = "";
    for (const s of SOURCES) {
      const label = document.createElement("label");
      label.className = "src-check";
      label.innerHTML = '<input type="checkbox" data-src="' + s.id + '"><span><b>' + H.esc(s.label) + '</b><em>' + H.esc(s.desc || "") + "</em></span>";
      label.querySelector("input").checked = !!state.sources[s.id];
      label.querySelector("input").addEventListener("change", () => {
        state.sources[s.id] = label.querySelector("input").checked;
        syncChips();
        syncSourcesUI();
        savePrefs();
        if (state.query.trim()) runSearch();
      });
      officialEl.appendChild(label);
    }
    const customEl = $("srcCustom");
    if (customEl && CUSTOM) {
      customEl.innerHTML = "";
      const label = document.createElement("label");
      label.className = "src-check";
      label.innerHTML = '<input type="checkbox" data-src="' + CUSTOM.id + '"><span><b>' + H.esc(CUSTOM.label) + '</b><em>' + H.esc(CUSTOM.desc || "") + "</em></span>";
      label.querySelector("input").checked = !!state.sources[CUSTOM.id];
      label.querySelector("input").addEventListener("change", () => {
        state.sources[CUSTOM.id] = label.querySelector("input").checked;
        syncChips();
        syncSourcesUI();
        savePrefs();
        if (state.query.trim()) runSearch();
      });
      customEl.appendChild(label);
    }
  }
  function bookSource() { return SOURCES.find((s) => s.books) || null; }
  function updateBookStates() {
    const el = $("exBooks");
    const src = bookSource();
    if (!el || !src) return;
    let total = 0;
    for (const row of el.querySelectorAll(".src-book")) {
      const slug = row.querySelector("input").dataset.book;
      const st = src.books.state(slug);
      const txt = row.querySelector(".b-state");
      if (!txt) continue;
      if (st.state === "loading") txt.textContent = "… loading";
      else if (st.state === "ready") txt.textContent = "· " + st.n.toLocaleString() + " entries ✓";
      else if (st.state === "error") txt.textContent = "⚠ failed";
      else txt.textContent = "";
      if (st.state === "ready") total += st.n;
    }
    const cnt = $("exCount");
    if (cnt) cnt.textContent = "· " + total.toLocaleString() + " loaded";
    const loading = [...(src._loading || new Map()).keys()].length;
    if (loading) {
      setSourcesStatus("Loading book(s)… (first time only — then cached in your browser)", true);
    } else setSourcesStatus("", true);
  }
  async function renderBookList() {
    const src = bookSource();
    const el = $("exBooks");
    if (!el || !src) return;
    const all = await src.books.list().catch(() => new Map());
    el.innerHTML = "";
    for (const [slug, meta] of all) {
      const label = document.createElement("label");
      label.className = "src-book";
      label.innerHTML = '<input type="checkbox" data-book="' + H.esc(slug) + '"><span>' + H.esc(meta.title) + (meta.org ? ' <em class="muted">(' + H.esc(meta.org) + ")</em>" : "") + '</span><span class="b-state"></span>';
      label.querySelector("input").checked = state.books.has(slug);
      label.querySelector("input").addEventListener("change", async () => {
        const on = label.querySelector("input").checked;
        if (on) { state.books.add(slug); updateBookStates(); await src.books.load(slug, ctx); }
        else { state.books.delete(slug); }
        savePrefs();
        updateBookStates();
        if (state.query.trim()) runSearch();
      });
      el.appendChild(label);
    }
    updateBookStates();
  }
  function openSources() {
    sourcesModal.hidden = false;
    sourcesStatus.textContent = "";
    syncSourcesUI();
    const src = bookSource();
    if (src) renderBookList().catch(() => setSourcesStatus("Couldn't load the book list — check your connection.", false));
  }
  $("sourcesBtn").addEventListener("click", openSources);
  $("sourcesClose").addEventListener("click", () => { sourcesModal.hidden = true; });
  sourcesModal.addEventListener("click", (e) => { if (e.target === sourcesModal) sourcesModal.hidden = true; });
  $("exAll").addEventListener("click", async () => {
    const src = bookSource();
    if (!src) return;
    const all = await src.books.list().catch(() => new Map());
    for (const slug of all.keys()) state.books.add(slug);
    savePrefs();
    await renderBookList();
    for (const slug of all.keys()) await src.books.load(slug, ctx);
    updateBookStates();
    if (state.query.trim()) runSearch();
  });
  $("exNone").addEventListener("click", () => {
    state.books.clear();
    savePrefs();
    renderBookList();
    if (state.query.trim()) runSearch();
  });
  $("sourcesReset").addEventListener("click", () => {
    state = initState();
    ctx.state = state;
    state.books.clear();
    savePrefs();
    syncChips();
    syncSourcesUI();
    renderSourceCheckboxes();
    renderBookList();
    setSourcesStatus("Reset to defaults.", true);
    if (state.query.trim()) runSearch();
  });
  $("sourcesDone").addEventListener("click", () => { sourcesModal.hidden = true; if (state.query.trim()) runSearch(); });

  /* ═══════════ import modal ═══════════ */
  const importModal = $("importModal"), importStatus = $("importStatus");
  const importText = $("importText"), importJson = $("importJson");
  const importRun = $("importRun"), importGroup = $("importGroup");
  let importMode = "text";
  const setStatus = (msg, ok) => { importStatus.textContent = msg; importStatus.style.color = ok ? "var(--bgn-accent2)" : "#e08a8a"; };
  const syncTextareas = () => { importText.hidden = importMode !== "text"; importJson.hidden = importMode !== "json"; };
  function fillImportGroup() {
    if (!importGroup) return;
    importGroup.innerHTML = "";
    for (const g of game.groups) {
      const o = document.createElement("option");
      o.value = g; o.textContent = g;
      importGroup.appendChild(o);
    }
  }
  $("importBtn").addEventListener("click", () => { importModal.hidden = false; importStatus.textContent = ""; syncTextareas(); setTimeout(() => (importMode === "text" ? importText : importJson).focus(), 50); });
  $("modalClose").addEventListener("click", () => { importModal.hidden = true; });
  importModal.addEventListener("click", (e) => { if (e.target === importModal) importModal.hidden = true; });
  document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    importMode = b.dataset.mode;
    syncTextareas();
  }));
  $("importSample").addEventListener("click", () => {
    const s = game.sample || {};
    if (importMode === "json") importJson.value = JSON.stringify(s.json || { entries: [] }, null, 2);
    else importText.value = s.text || "My rule — a one-line summary\n\nWrite the rule here. Lines starting with ## become sections, and - makes a list.";
    setStatus("Sample ready — hit Import to add it.", true);
  });
  importRun.addEventListener("click", () => {
    const group = importGroup.value;
    try {
      const entries = importMode === "json"
        ? parseJsonImport(importJson.value, group)
        : [parseRuleText(importText.value, group)];
      const added = importEntries(entries);
      if (!added) { setStatus("Nothing new — that entry is already imported.", true); return; }
      setStatus("✓ Imported " + added + " entr" + (added === 1 ? "y" : "ies") + " — filed under " + entries[0].group + ". Search for it below.", true);
      importModal.hidden = true;
      groupBar.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
      const allChip = groupBar.querySelector('[data-g="All"]');
      if (allChip) allChip.classList.add("on");
      state.group = ALL;
      state.sources = initState().sources;
      syncChips();
      savePrefs();
      if (state.query.trim()) runSearch();
      else {
        searchInput.value = entries[0].name;
        clearBtn.hidden = false;
        state.query = entries[0].name;
        runSearch();
      }
    } catch (e) {
      setStatus(e.message, false);
    }
  });
  $("importExport").addEventListener("click", () => {
    try {
      exportCustom();
      setStatus("✓ Downloaded " + game.exportName + ".json — re-import it here or share the file with your table.", true);
    } catch (e) {
      setStatus(e.message, false);
    }
  });

  /* ═══════════ GM tools ═══════════ */
  const GM_GROUP_OPTIONS = [ALL].concat(game.groups, CUSTOM ? [CUSTOM.id] : []);
  const GM_SRC_OPTIONS = [["all", "Any source"]].concat(SOURCES.map((s) => [s.id, s.badge.text]), CUSTOM ? [[CUSTOM.id, CUSTOM.badge.text]] : []);
  let gmPrefs = {
    dice: (game.gm.dice || []).map((d) => ({ ...d })),
    lookups: (game.gm.lookups || []).map((l) => ({ ...l })),
    sections: { dice: true, random: true, favs: true },
  };
  async function loadGmPrefs() {
    const k = kv(); if (!k) return;
    try {
      const p = await k.prefs.get("gm");
      if (p && p.g === GAME_ID && Array.isArray(p.dice) && p.dice.length) {
        gmPrefs.dice = p.dice.map((d) => ({ label: String(d.label || "").trim(), sides: parseInt(d.sides, 10) || 6, count: d.count || 1 })).filter((d) => d.label);
        if (Array.isArray(p.lookups)) gmPrefs.lookups = p.lookups.map((l) => ({ label: String(l.label || "").trim(), group: GM_GROUP_OPTIONS.includes(l.group) ? l.group : ALL, src: l.src || "all" })).filter((l) => l.label);
        if (p.sections) gmPrefs.sections = { dice: true, random: true, favs: true, ...p.sections };
      }
    } catch (e) { /* defaults */ }
  }
  function saveGmPrefs() {
    const k = kv(); if (!k) return;
    k.prefs.set("gm", { ...gmPrefs, g: GAME_ID }).catch(() => {});
  }
  const gmModal = $("gmModal"), gmStatus = $("gmStatus");
  const diceInput = $("diceInput"), diceResult = $("diceResult"), diceHistory = $("diceHistory");
  const gmDiceBtns = $("gmDiceBtns"), gmLookupBtns = $("gmLookupBtns");
  let diceHist = [];
  let gmCfgMode = false;
  const setGmStatus = (msg, ok) => { gmStatus.textContent = msg; gmStatus.style.color = ok ? "var(--bgn-accent2)" : "#e08a8a"; };
  function rollDice(expr) {
    const m = String(expr).trim().toLowerCase().match(/^(\d*)\s*d\s*(\d+)(?:\s*([+-])\s*(\d+))?$/);
    if (!m) return null;
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    const mod = (m[3] === "-" ? -1 : 1) * (m[4] ? parseInt(m[4], 10) : 0);
    if (!count || count > 100 || sides < 2 || sides > 1000) return null;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    let detail = rolls.join(" + ");
    if (mod) detail += (mod < 0 ? " − " : " + ") + Math.abs(mod);
    return { label: String(expr).trim().toLowerCase(), rolls, sides, total, detail };
  }
  function showRoll(r) {
    if (!r) { diceResult.textContent = ""; return; }
    diceResult.innerHTML = '<span class="dice-num">' + r.total + '</span><span class="muted">' + r.label + " · " + r.detail + "</span>";
    diceHist.unshift({ label: r.label, total: r.total });
    if (diceHist.length > 8) diceHist.pop();
    diceHistory.innerHTML = diceHist.map((h) => '<div class="roll-line">' + h.label + " = <b>" + h.total + "</b></div>").join("");
  }
  function doRoll(expr) {
    if (!expr) { setGmStatus("Type a roll like 2d6+3, or tap a die.", false); return; }
    const r = rollDice(expr);
    if (!r) { setGmStatus("Couldn't read that — try 2d6+3, 1d20, or d100.", false); return; }
    setGmStatus("", true);
    showRoll(r);
  }
  function renderGmDice() {
    gmDiceBtns.innerHTML = "";
    const dice = gmPrefs.dice.filter((d) => d.label);
    if (!dice.length) {
      gmDiceBtns.innerHTML = '<span class="gm-cfg-hint">No dice yet — add some in ⚙ Customize.</span>';
      return;
    }
    for (const d of dice) {
      const b = document.createElement("button");
      b.className = "chip dice-chip";
      b.textContent = d.label;
      const count = d.count || 1;
      b.title = "Roll " + (count > 1 ? count + "d" : "1d") + d.sides;
      b.addEventListener("click", () => doRoll(count + "d" + d.sides));
      gmDiceBtns.appendChild(b);
    }
  }
  async function randomEntry(group, src) {
    const okSrc = (s) => src === "all" || src === s;
    const pool = [];
    for (const s of SOURCES) {
      if (state.sources[s.id] !== true || !okSrc(s.id) || !s.match) continue;
      await ensureSource(s);
      for (const e of s.match("", group, ctx, 0)) pool.push({ kind: s.id, entry: e });
    }
    if (CUSTOM && state.sources[CUSTOM.id] && okSrc(CUSTOM.id)) {
      for (const e of homebrewItems) {
        if (group === ALL || group === CUSTOM.id || e.group === group) pool.push({ kind: CUSTOM.id, entry: e });
      }
    }
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function renderGmLookups() {
    gmLookupBtns.innerHTML = "";
    const lookups = gmPrefs.lookups.filter((l) => l.label);
    if (!lookups.length) {
      gmLookupBtns.innerHTML = '<span class="gm-cfg-hint">No random lookups yet — add some in ⚙ Customize.</span>';
      return;
    }
    for (const l of lookups) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = l.label;
      b.title = "Random " + l.group + (l.src !== "all" ? " · " + l.src : "");
      b.addEventListener("click", async () => {
        const item = await randomEntry(l.group, l.src);
        if (!item) { setGmStatus("No content in that category with your current sources — check ⚙ Sources.", false); return; }
        gmModal.hidden = true;
        openEntry(item);
      });
      gmLookupBtns.appendChild(b);
    }
  }
  function renderGmSections() {
    if (gmCfgMode) return;
    $("gmSecDice").hidden = !gmPrefs.sections.dice;
    $("gmSecRandom").hidden = !gmPrefs.sections.random;
    $("gmSecFavs").hidden = !gmPrefs.sections.favs;
  }
  function renderGmCfg() {
    gmCfgDice.innerHTML = "";
    if (!gmPrefs.dice.length) gmCfgDice.innerHTML = '<p class="gm-cfg-hint">No dice — the roller still works via the expression box.</p>';
    gmPrefs.dice.forEach((d, i) => {
      const row = document.createElement("div");
      row.className = "gm-cfg-row";
      row.innerHTML = '<input class="field" data-f="label" placeholder="Label, e.g. d6"><input class="field" data-f="sides" type="number" min="2" max="1000" placeholder="Sides"><input class="field" data-f="count" type="number" min="1" max="10" placeholder="Rolls" title="How many of this die to roll"><button type="button" class="gm-cfg-x" title="Remove">✕</button>';
      const lbl = row.querySelector('[data-f="label"]'), sides = row.querySelector('[data-f="sides"]'), cnt = row.querySelector('[data-f="count"]');
      lbl.value = d.label;
      sides.value = d.sides;
      cnt.value = d.count || 1;
      lbl.addEventListener("change", () => { d.label = lbl.value.trim(); saveGmPrefs(); renderGmDice(); });
      sides.addEventListener("change", () => { d.sides = Math.min(1000, Math.max(2, parseInt(sides.value, 10) || 6)); sides.value = d.sides; saveGmPrefs(); renderGmDice(); });
      cnt.addEventListener("change", () => { d.count = Math.min(10, Math.max(1, parseInt(cnt.value, 10) || 1)); cnt.value = d.count; saveGmPrefs(); renderGmDice(); });
      row.querySelector(".gm-cfg-x").addEventListener("click", () => { gmPrefs.dice.splice(i, 1); saveGmPrefs(); renderGmCfg(); renderGmDice(); });
      gmCfgDice.appendChild(row);
    });
    gmCfgLookups.innerHTML = "";
    if (!gmPrefs.lookups.length) gmCfgLookups.innerHTML = '<p class="gm-cfg-hint">No lookups — the dice section still works.</p>';
    gmPrefs.lookups.forEach((l, i) => {
      const row = document.createElement("div");
      row.className = "gm-cfg-row";
      row.innerHTML = '<input class="field" data-f="lbl" placeholder="Label, e.g. Random Dragon">' +
        '<select class="field" data-f="grp">' + GM_GROUP_OPTIONS.map((g) => '<option value="' + g + '">' + g + "</option>").join("") + "</select>" +
        '<select class="field" data-f="src">' + GM_SRC_OPTIONS.map(([v, t]) => '<option value="' + v + '">' + t + "</option>").join("") + "</select>" +
        '<button type="button" class="gm-cfg-x" title="Remove">✕</button>';
      const lbl = row.querySelector('[data-f="lbl"]'), grp = row.querySelector('[data-f="grp"]'), src = row.querySelector('[data-f="src"]');
      lbl.value = l.label;
      grp.value = l.group;
      src.value = l.src;
      lbl.addEventListener("change", () => { l.label = lbl.value.trim(); saveGmPrefs(); renderGmLookups(); });
      grp.addEventListener("change", () => { l.group = grp.value; saveGmPrefs(); renderGmLookups(); });
      src.addEventListener("change", () => { l.src = src.value; saveGmPrefs(); renderGmLookups(); });
      row.querySelector(".gm-cfg-x").addEventListener("click", () => { gmPrefs.lookups.splice(i, 1); saveGmPrefs(); renderGmCfg(); renderGmLookups(); });
      gmCfgLookups.appendChild(row);
    });
    gmModal.querySelectorAll("[data-gmsec]").forEach((c) => { c.checked = !!gmPrefs.sections[c.dataset.gmsec]; });
  }
  function setGmCfgMode(on) {
    gmCfgMode = on;
    $("gmCustomize").hidden = !on;
    if (on) { renderGmCfg(); $("gmSecDice").hidden = $("gmSecRandom").hidden = $("gmSecFavs").hidden = true; }
    else renderGmSections();
    $("gmCfgBtn").textContent = on ? "← Back" : "⚙ Customize";
  }
  function openEntry(item) {
    suggestCtn.hidden = true;
    refLayout.hidden = false;
    detailEl.hidden = false;
    detailEmpty.hidden = true;
    state.selId = null;
    renderDetail({ key: "gm-" + (item.entry.id || Math.random()), name: item.entry.name || "Entry", items: [item] });
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }
  function resolveFavorites() {
    const out = [];
    for (const s of SOURCES) {
      if (s.all) for (const e of s.all(ctx)) if (isFav(s.id, e)) out.push({ kind: s.id, entry: e, name: e.name || "" });
    }
    if (CUSTOM) for (const e of homebrewItems) if (isFav(CUSTOM.id, e)) out.push({ kind: CUSTOM.id, entry: e, name: e.name });
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  function badgeHTML(kind) {
    const b = badgeFor(kind);
    return '<span class="ed-badge ' + b.cls + '">' + H.esc(b.text) + "</span>";
  }
  function renderGmFavs() {
    const favs = resolveFavorites();
    $("gmFavCount").textContent = favs.length ? "· " + favs.length + " saved" : "";
    gmFavs.innerHTML = "";
    if (!favs.length) {
      gmFavs.innerHTML = '<p class="muted small" style="margin:4px 0">Nothing pinned yet — use the ★ on results or in detail panels.</p>';
      return;
    }
    for (const item of favs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gm-fav";
      b.innerHTML = '<span class="r-name" style="font-weight:600;color:var(--bgn-cream);font-size:.85rem"></span>' + badgeHTML(item.kind) + '<span class="muted" style="font-size:.7rem;margin-left:auto">' + H.esc(item.entry.group || "") + "</span>";
      b.querySelector(".r-name").textContent = item.name;
      b.addEventListener("click", () => { gmModal.hidden = true; openEntry(item); });
      gmFavs.appendChild(b);
    }
  }
  const gmFavs = $("gmFavs");
  const gmCfgDice = $("gmCfgDice"), gmCfgLookups = $("gmCfgLookups");
  $("gmBtn").addEventListener("click", () => {
    gmModal.hidden = false;
    setGmStatus("");
    diceResult.textContent = "";
    setGmCfgMode(false);
    renderGmDice();
    renderGmLookups();
    renderGmSections();
    renderGmFavs();
  });
  $("gmClose").addEventListener("click", () => { gmModal.hidden = true; });
  gmModal.addEventListener("click", (e) => { if (e.target === gmModal) gmModal.hidden = true; });
  $("gmDone").addEventListener("click", () => { gmModal.hidden = true; });
  $("gmCfgBtn").addEventListener("click", () => setGmCfgMode(!gmCfgMode));
  $("gmCfgAddDie").addEventListener("click", () => { gmPrefs.dice.push({ label: "", sides: 6, count: 1 }); renderGmCfg(); });
  $("gmCfgAddLookup").addEventListener("click", () => { gmPrefs.lookups.push({ label: "", group: ALL, src: "all" }); renderGmCfg(); });
  $("gmCfgReset").addEventListener("click", () => {
    gmPrefs.dice = (game.gm.dice || []).map((d) => ({ ...d }));
    gmPrefs.lookups = (game.gm.lookups || []).map((l) => ({ ...l }));
    gmPrefs.sections = { dice: true, random: true, favs: true };
    saveGmPrefs();
    renderGmCfg();
    renderGmDice();
    renderGmLookups();
    setGmStatus("Restored the default GM layout.", true);
  });
  gmModal.querySelectorAll("[data-gmsec]").forEach((c) => c.addEventListener("change", () => {
    gmPrefs.sections[c.dataset.gmsec] = c.checked;
    saveGmPrefs();
    renderGmSections();
  }));
  $("diceBtn").addEventListener("click", () => doRoll(diceInput.value));
  diceInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doRoll(diceInput.value); } });

  /* ═══════════ init ═══════════ */
  function applyTheme() {
    const a = game.accent || {};
    document.body.style.setProperty("--bgn-accent", a.a || "#d4af37");
    if (a.a2) document.body.style.setProperty("--bgn-accent2", a.a2);
    if (a.a3) document.body.style.setProperty("--bgn-accent3", a.a3);
    const hero = $("gameHero");
    if (hero) {
      if (game.heroImage) {
        hero.classList.add("has-img");
        hero.style.setProperty("--bgn-hero-img", "url('" + game.heroImage + "')");
      }
      const fill = (id, v) => { const el = $(id); if (el && v) el.textContent = v; };
      fill("heroTitle", game.name);
      fill("heroSub", game.tagline);
      fill("heroKicker", game.kicker);
      fill("heroGenre", game.genre);
      fill("heroPlayers", game.players);
    }
    const navTitle = $("navTitle");
    if (navTitle) navTitle.textContent = game.name;
    document.title = game.name + " · The Boardgame Network";
    const footerC = $("copyrightLine");
    if (footerC && game.copyright) footerC.textContent = game.copyright;
    const searchField = $("searchInput");
    if (searchField && game.placeholder) searchField.placeholder = game.placeholder;
    const detailEmptyEl = $("detailEmpty");
    if (detailEmptyEl && game.detailEmpty) detailEmptyEl.innerHTML = game.detailEmpty;
  }
  (async function init() {
    applyTheme();
    renderGroupChips();
    renderChipBar();
    renderPopular();
    renderSourceCheckboxes();
    fillImportGroup();
    const bookSrc = bookSource();
    if (bookSrc) {
      const wrap = $("srcBooksWrap");
      if (wrap) {
        wrap.hidden = false;
        const t = $("exTitle"), h = $("exHint");
        if (t && bookSrc.books.title) t.innerHTML = bookSrc.books.title + ' <span class="muted small" id="exCount"></span>';
        if (h && bookSrc.books.hint) h.textContent = bookSrc.books.hint;
      }
    }
    const chipWrap = $("chipBarWrap");
    if (chipWrap) {
      chipWrap.hidden = !(game.chips && game.chips.length);
      const lbl = $("chipBarLabel");
      if (lbl && game.chipsLabel) lbl.textContent = game.chipsLabel;
    }
    searchInput.placeholder = game.placeholder || searchInput.placeholder;
    try { await loadPrefs(); } catch (e) { console.error("prefs load failed", e); }
    syncChips();
    try { await loadHomebrew(); } catch (e) { console.error("custom content load failed", e); }
    try { await loadFavs(); } catch (e) { console.error("favorites load failed", e); }
    try { await loadGmPrefs(); } catch (e) { console.error("gm prefs load failed", e); }
    for (const s of SOURCES) if (state.sources[s.id]) await ensureSource(s);
    if (bookSource() && state.sources.ex && state.books.size) {
      try { await renderBookList(); for (const slug of state.books) await bookSource().books.load(slug, ctx); updateBookStates(); } catch (e) { /* non-fatal */ }
    }
    applyUrlState(params);
    syncChips();
    const q0 = (params.get("q") || "").trim().slice(0, 120);
    if (q0) {
      searchInput.value = q0;
      clearBtn.hidden = false;
      state.query = q0;
      runSearch();
    }
    const impUrl = params.get("import") || "";
    if (impUrl) {
      (async () => {
        try {
          statusEl.textContent = "Importing shared content…";
          const r = await fetch(impUrl);
          if (!r.ok) throw new Error("http " + r.status);
          const data = await r.json();
          const entries = parseJsonImport(JSON.stringify(data), game.groups[0] || "Rules");
          const added = importEntries(entries);
          if (added) {
            searchInput.value = entries[0].name;
            clearBtn.hidden = false;
            state.query = entries[0].name;
            runSearch();
            statusEl.textContent = "✓ Imported " + added + " entr" + (added === 1 ? "y" : "ies") + " from a shared link.";
          } else {
            statusEl.textContent = "That link didn't contain any new content.";
          }
        } catch (e) {
          console.error("import-from-url failed", e);
          statusEl.textContent = "Couldn't import from that link — it may have expired or been deleted.";
        }
      })();
    }
    const loaded = SOURCES.filter((s) => state.sources[s.id] && s.count && s.count())
      .map((s) => s.count().toLocaleString() + " " + s.tabLabel.toLowerCase() + " entries");
    const customN = CUSTOM ? homebrewItems.length : 0;
    if (loaded.length) {
      statusEl.textContent = "Ready — " + loaded.join(" + ") + (customN ? " · " + customN + " custom" : "") + ". Try a lookup above.";
    } else if (homebrewItems.length) {
      statusEl.textContent = "Ready — " + homebrewItems.length + " custom entr" + (homebrewItems.length === 1 ? "y" : "ies") + " loaded.";
    } else {
      statusEl.textContent = "Loading…";
      setTimeout(() => {
        const l2 = SOURCES.filter((s) => state.sources[s.id] && s.count && s.count()).map((s) => s.count().toLocaleString() + " " + s.tabLabel.toLowerCase() + " entries");
        statusEl.textContent = l2.length ? "Ready — " + l2.join(" + ") + (customN ? " · " + customN + " custom" : "") + ". Try a lookup above." : "Couldn't load data — please reload.";
      }, 1500);
    }
  })();

  /* ═══════════ BGN chrome bridge — used by the save/share/link layer in index.html ═══════════ */
  window.__bgnRefBridge = {
    getState: () => ({ game: GAME_ID, query: state.query, group: state.group, sel: state.selId, sources: { ...state.sources }, books: Array.from(state.books || []) }),
    restore: (o) => {
      if (!o || (o.game && o.game !== GAME_ID)) return;
      try {
        if (o.sources && typeof o.sources === "object") { state.sources = { ...initState().sources, ...o.sources }; syncChips(); syncSourcesUI(); }
        if (Array.isArray(o.books)) state.books = new Set(o.books);
      } catch (e) { /* non-fatal */ }
      const q = String(o.query || "").trim().slice(0, 120);
      searchInput.value = q;
      clearBtn.hidden = !q;
      state.query = q;
      if (q) runSearch();
    },
    openSel: (key) => {
      for (const row of resultsEl.children) if (row.dataset.name === key) { row.querySelector(".row-main").click(); return true; }
      return false;
    },
    runSearch: () => runSearch(),
  };
})();
