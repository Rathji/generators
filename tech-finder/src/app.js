(function () {
  "use strict";

  const DB = window.TFDB;
  if (!DB) { console.error("TFDB missing"); return; }

  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const nums = (s) => (String(s || "").match(/\d+/g) || []).join("");
  const fmtDate = () => new Date().toISOString().slice(0, 10);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mapPool = async (items, limit, fn) => {
    const out = new Array(items.length);
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  };

  const VENDORS = [
    { id: "oem", label: "OEM page", note: "manufacturer / support" },
    { id: "memoryexpress", label: "Memory Express", currency: "CAD" },
    { id: "amazon", label: "Amazon.ca", currency: "CAD" },
    { id: "shopbot", label: "Shopbot.ca", currency: "CAD" }
  ];

  function vendorUrl(id, term) {
    const q = encodeURIComponent(term);
    if (id === "amazon") return "https://www.amazon.ca/s?k=" + q;
    if (id === "memoryexpress") return "https://www.memoryexpress.com/Search/Products?Search=" + q;
    if (id === "shopbot") return "https://www.shopbot.ca/search?q=" + q;
    return null;
  }

  function cadUrl(u) {
    try {
      const url = new URL(u);
      if (url.hostname.replace(/^www\./, "") === "dell.com" && /^\/en-us\/(shop|laptop)\//.test(url.pathname)) {
        url.pathname = url.pathname.replace(/^\/en-us\//, "/en-ca/");
        return url.href;
      }
    } catch (e) {}
    return u;
  }

  function buyLinksFor(term, oemUrl, oemLabel) {
    const out = [];
    if (oemUrl) {
      const ca = cadUrl(oemUrl);
      out.push({ id: "oem", label: (oemLabel || "OEM page") + (ca !== oemUrl ? " · CAD" : ""), url: ca, primary: true });
    }
    if (term) for (const v of VENDORS.filter((x) => x.id !== "oem")) {
      const u = vendorUrl(v.id, term);
      if (u) out.push({ id: v.id, label: v.label + " · " + v.currency, url: u, primary: false });
    }
    return out;
  }

  const BRAND_WORDS = { dell: ["dell", "latitude", "precision", "vostro", "inspiron", "xps", "alienware"], hp: ["hp", "hewlett", "probook", "elitebook", "envy", "pavilion", "omen"], lenovo: ["lenovo", "thinkpad", "thinkbook", "ideapad", "yoga", "legion"], apple: ["apple", "macbook", "macbook air", "macbook pro", "imac", "mac"], asus: ["asus", "rog", "zenbook", "vivobook"], acer: ["acer", "aspire", "predator", "swift"], samsung: ["samsung", "galaxy"], microsoft: ["microsoft", "surface"] };

  const PWR_WORDS = ["charger", "adapter", "power supply", "power brick", "ac adapter", "power adapter", "psu", "chargin", "65w", "90w", "45w", "100w", "130w", "usb-c charger", "usbc charger", "cable"];
  const PART_WORDS = { ram: ["ram", "memory", "sodimm", "ddr4", "ddr3", "dimm"], ssd: ["ssd", "hard drive", "harddrive", "nvme", "storage", "m.2", "m2", "2.5"], battery: ["battery", "cell"] };
  const CONN_WORDS = { usbc: ["usb-c", "usbc", "type-c", "type c", "pd"], dell74: ["7.4", "7.4mm", "large tip", "dell barrel"], hpSmart: ["4.5", "4.5mm", "blue tip", "hp smart"], lenovoSlim: ["slim tip", "rectangular"] };

  const SUGGESTIONS = [
    "Dell Latitude 5420 — need a charger",
    "Charger for my HP Envy x360 13",
    "ThinkPad T470 RAM upgrade",
    "MacBook Air M1 specs",
    "Dell 65W adapter",
    "Photo of my laptop's spec label",
    "Photo of my charger's barrel tip"
  ];

  const state = {
    product: null,
    adapterMode: false,
    lastQuery: "",
    sessionSources: new Map(),
    liveCache: new Map(),
    vendorCache: new Map(),
    vendorHealth: new Map(),
    extracting: false,
    confirmedLive: new Map()
  };

  const OEM_DOMAINS = { dell: "dell.com", hp: "hp.com", lenovo: "lenovo.com", apple: "apple.com", asus: "asus.com", acer: "acer.com", samsung: "samsung.com", microsoft: "microsoft.com" };
  const LIVE_STOP = ["charger", "adapter", "power", "supply", "brick", "for", "the", "my", "and", "with", "need", "laptop", "computer", "notebook", "specs", "spec", "sheet", "original", "compatible", "buy", "what", "does", "fit", "fits", "canada", "help", "wants", "want", "please", "its", "it", "a", "an", "of", "to", "in", "on", "is", "are", "chargers", "adapters", "psu", "chargin", "cable", "cables", "wire", "cord", "genuine", "oem", "replacement"];
  const BRAND_ONLY = { dell: ["dell"], hp: ["hp", "hewlett"], lenovo: ["lenovo"], apple: ["apple"], asus: ["asus"], acer: ["acer"], samsung: ["samsung"], microsoft: ["microsoft"] };
  const race = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  const hostOnly = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const BOT_BLOCK_HOSTS = ["shopbot.ca"];
  const liveTokens = (t) => String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 2 && !LIVE_STOP.includes(x));
  const focusQuery = (text) => liveTokens(text).join(" ");

  function lineWordOf(text) {
    const t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ") + " ";
    for (const b of Object.keys(BRAND_WORDS)) {
      const excl = BRAND_ONLY[b] || [];
      for (const w of BRAND_WORDS[b]) {
        if (excl.includes(w)) continue;
        const p = w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, "[^a-z0-9]+");
        if (new RegExp("(^|[^a-z0-9])" + p + "($|[^a-z0-9])").test(t)) return w;
      }
    }
    return null;
  }
  const deviceish = (text) => !!(lineWordOf(text) || /(?:^|[^0-9a-z])\d{3,}(?:$|[^0-9a-z])/i.test(" " + text + " "));

  function toast(msg, kind) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "toast show " + (kind || "");
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.className = "toast"), 2600);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand("copy");
        ta.remove(); return ok;
      } catch (e2) { return false; }
    }
  }

  function partTypeOf(text) {
    const t = " " + text.toLowerCase() + " ";
    for (const k of Object.keys(PART_WORDS)) {
      if (PART_WORDS[k].some((w) => t.includes(" " + w + " ") || t.includes(" " + w))) return k;
    }
    if (PWR_WORDS.some((w) => t.includes(w))) return "power";
    return "spec";
  }

  function brandOf(text) {
    const t = text.toLowerCase();
    for (const b of Object.keys(BRAND_WORDS)) {
      if (BRAND_WORDS[b].some((w) => t.includes(w))) return b;
    }
    return null;
  }

  function scoreProduct(p, query) {
    const t = " " + query.toLowerCase() + " ";
    const qn = norm(query);
    let score = 0, reasons = [];
    const brand = brandOf(query);
    if (brand && brand === p.brand) { score += 22; reasons.push("brand: " + p.brand); }

    const pn = norm([p.brand, p.line, p.name, p.model].join(" "));
    if (qn.length >= 3 && pn.includes(qn)) { score += 34; reasons.push("name contains query"); }

    const modelN = norm(p.model);
    if (qn.length >= 3 && modelN.includes(qn)) { score += 42; reasons.push("model prefix: " + p.model); }
    else if (qn.length >= 3 && qn.includes(modelN)) { score += 40; reasons.push("model matched: " + p.model); }
    else {
      const pCore = nums(p.model), qCore = nums(query);
      if (pCore.length >= 3 && qCore.length >= 3 && (pCore.startsWith(qCore) || qCore.startsWith(pCore))) { score += 26; reasons.push("model number " + qCore); }
      else if (pCore.length >= 3 && qCore.length >= 3 && qCore.includes(pCore)) { score += 24; reasons.push("model number in query"); }
    }
    for (const a of p.aliases) {
      const an = norm(a);
      if (an.length >= 3 && qn.includes(an)) { score += 40; reasons.push("alias: " + a); break; }
    }
    const lineN = norm(p.line);
    if (qn.length >= 4 && lineN.length >= 3 && qn.includes(lineN)) { score += 14; reasons.push("line: " + p.line); }
    if (p.year && qn.includes(p.year)) score += 4;
    if (norm(p.brand) === qn) score += 8;
    if (score > 100) score = 100;
    return { p, score, reasons };
  }

  function identifyProduct(text) {
    const scored = DB.PROD.map((p) => scoreProduct(p, text)).sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top || top.score < 45) return { kind: "none", top: scored.slice(0, 3) };
    const pt = partTypeOf(text);
    const wantsPower = pt === "power";
    const wantsParts = pt === "ram" || pt === "ssd" || pt === "battery";
    const second = scored[1];
    const ambiguous = top.score < 88 && second && second.score >= top.score - 14 && second.score > 30;
    return { kind: "product", product: top.p, conf: top.score, wantsPower, wantsParts, partType: pt, ambiguous: ambiguous && !wantsPower ? { second: second.p } : null };
  }

  function identifyAdapterProduct(text) {
    const scored = DB.ADAPTERS.map((a) => {
      let score = 0, reasons = [];
      const t = " " + text.toLowerCase() + " ";
      const qn = norm(text);
      const an = norm(a.name + " " + a.shortName);
      if (qn.length >= 3 && an.includes(qn)) { score += 60; reasons.push("adapter name"); }
      const watts = nums(text);
      if (watts && String(a.watts).startsWith(watts)) { score += 30; reasons.push(a.watts + "W class"); }
      const b = brandOf(text);
      if (b && b === a.brand.toLowerCase()) { score += 20; reasons.push("brand " + a.brand); }
      if (a.conn === "usbc" && /usb-?c/i.test(text)) score += 16;
      for (const c of Object.keys(CONN_WORDS)) {
        if (CONN_WORDS[c].some((w) => t.includes(w))) { score += a.conn === c ? 14 : 4; reasons.push("connector hint"); }
      }
      if (a.kind === "oem") score += 3;
      return { a, score: Math.min(100, score), reasons };
    }).sort((x, y) => y.score - x.score);
    const top = scored[0];
    if (!top || top.score < 28) return null;
    const list = scored.filter((s) => s.score >= 28 && s.score >= top.score - 18);
    return { matches: list.map((s) => s.a) };
  }

  async function llmExtract(text) {
    const instruction = [
      "You are a hardware-model parser for a tech-finder tool. Extract structured fields from free-text user queries about laptops/consumer tech.",
      "Respond with ONLY a JSON object, no markdown fences, no commentary. Use null when a field is unknown.",
      "Fields: {\"brand\": \"Dell|HP|Lenovo|Apple|ASUS|Acer|Samsung|other|null\", \"line\": \"e.g. Latitude, Envy x360, ThinkPad, MacBook Air\", \"model\": \"the exact model string as typed, e.g. 5420, E6420, 13-bf0xxx, A2337\", \"partType\": \"adapter|charger|ram|ssd|battery|specs|other\", \"wattage\": \"e.g. 65 or null\", \"connectorHint\": \"usb-c|barrel|7.4mm|4.5mm|slim tip|magsafe|null\", \"question\": \"short restatement\"}",
      "Examples:\nQ: \"find the exact spec sheet for my Dell Latitude 5420\" → {\"brand\":\"Dell\",\"line\":\"Latitude\",\"model\":\"5420\",\"partType\":\"specs\",\"wattage\":null,\"connectorHint\":null,\"question\":\"Dell Latitude 5420 spec sheet\"}\nQ: \"what charger fits my hp envy x360 13-bf0xxx\" → {\"brand\":\"HP\",\"line\":\"Envy x360\",\"model\":\"13-bf0xxx\",\"partType\":\"charger\",\"wattage\":null,\"connectorHint\":null,\"question\":\"charger for HP Envy x360 13-bf0xxx\"}\nQ: \"dell 65w adapter 7.4mm\" → {\"brand\":\"Dell\",\"line\":null,\"model\":null,\"partType\":\"adapter\",\"wattage\":\"65\",\"connectorHint\":\"7.4mm\",\"question\":\"Dell 65W adapter with 7.4mm tip\"}",
      "TASK: parse this user query: " + text
    ].join("\n\n");
    const res = await root.generateText({ instruction, stopSequences: ["```"] });
    const raw = String(res && res.text ? res.text : "").trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }

  function matchProductViaFields(f) {
    if (!f) return null;
    const parts = [f.brand, f.line, f.model, f.question].filter(Boolean).join(" ");
    return identifyProduct(parts);
  }

  async function searchText(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    state.lastQuery = trimmed;
    const at = partTypeOf(trimmed);
    const adapterLook = /charger|adapter|power/i.test(trimmed) && !/\b(laptop|computer|specs|spec sheet)\b/i.test(trimmed);

    const ident = identifyProduct(trimmed);
    if (ident.kind === "product") {
      if (ident.ambiguous && !ident.wantsPower) {
        renderDisambiguation([ident.product, ident.ambiguous.second], trimmed, ident);
        return;
      }
      state.product = ident.product;
      state.adapterMode = false;
      renderProduct(ident.product, { query: trimmed, conf: ident.conf, focus: ident.wantsPower ? "power" : (ident.wantsParts ? ident.partType : "all") });
      return;
    }

    const adMatch = identifyAdapterProduct(trimmed);
    if (adMatch) {
      renderAdapterResults(adMatch.matches, trimmed);
      return;
    }

    if (adapterLook && brandOf(trimmed)) {
      if (deviceish(trimmed)) renderNotFound(trimmed, [], { wantsPower: true });
      else renderAdapterResults(null, trimmed);
      return;
    }

    showBusy("Parsing your query…");
    let f = null;
    try {
      f = await llmExtract(trimmed);
      const retry = matchProductViaFields(f);
      hideBusy();
      if (retry && retry.kind === "product" && !retry.ambiguous) {
        state.product = retry.product;
        renderProduct(retry.product, { query: trimmed, conf: retry.conf, focus: "all", viaAi: true });
        return;
      }
    } catch (e) { hideBusy(); }
    renderNotFound(trimmed, ident.top, { wantsPower: at === "power" || (f && f.partType === "adapter"), note: f && f.question ? "AI parse: “" + f.question + "”" : null });
  }

  function showBusy(label) {
    const b = $("#busy");
    b.hidden = false;
    $("#busyLabel").textContent = label || "Working…";
    $("#results").innerHTML = "";
  }
  function hideBusy() { $("#busy").hidden = true; }
  function stepBusy(label) { const l = $("#busyLabel"); l.textContent = label; l.classList.add("pulse"); setTimeout(() => l.classList.remove("pulse"), 400); }

  function renderDisambiguation(list, query, ident) {
    state.product = null;
    const out = $("#results");
    let h = '<section class="card result-card">';
    h += '<div class="result-kicker">Several models match</div>';
    h += "<h2>Which one did you mean?</h2>";
    h += '<p class="muted" style="margin-top:4px">I never guess silently — pick the exact model, or type more of the full model name (e.g. include the series letter).</p>';
    h += '<div class="choice-grid">';
    for (const p of list) {
      h += `<button class="choice" data-pick="${esc(p.id)}">
        <span class="choice-brand">${esc(p.brand)}</span>
        <strong>${esc(p.line)} ${esc(p.model)}</strong>
        <span class="choice-sub">${esc(p.year || "")} · needs ${esc(p.power.watts)}W ${esc(connLabel(p.power.conn))}</span>
      </button>`;
    }
    h += "</div></section>";
    out.innerHTML = h;
    $$(".choice", out).forEach((b) => b.addEventListener("click", () => {
      const p = DB.PROD.find((x) => x.id === b.dataset.pick);
      state.product = p;
      renderProduct(p, { query: query, conf: 90, focus: "all" });
    }));
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function decodeBingUrl(href) {
    try {
      const u = new URL(href);
      if (!/bing\.com$/.test(u.hostname)) return href;
      const enc = u.searchParams.get("u");
      if (!enc) return null;
      const pad = enc.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (enc.length % 4)) % 4);
      const bytes = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
      const dec = new TextDecoder().decode(bytes);
      const m = dec.match(/https?:\/\/[^\x00-\x1f\s]+/);
      return m ? m[0] : (dec.startsWith("http") ? dec : null);
    } catch (e) { return null; }
  }

  function parseBingResults(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    for (const li of doc.querySelectorAll("li.b_algo")) {
      let a = li.querySelector("h2 a[href], .b_title a[href]");
      if (!a) {
        let best = null;
        for (const cand of li.querySelectorAll("a[href]")) {
          if (cand.closest(".b_tpcn, .tpic, .b_attribution, .b_rich, .b_ans, .b_factrow, .b_caption")) continue;
          if (cand.classList.contains("tilk")) continue;
          const tl = (cand.textContent || "").trim().length;
          if (tl >= 12 && (!best || tl > (best.textContent || "").trim().length)) best = cand;
        }
        a = best;
      }
      if (!a) continue;
      const url = decodeBingUrl(a.href);
      if (!url || !/^https?:/.test(url)) continue;
      const host = hostOnly(url);
      if (!host) continue;
      const title = (a.textContent || "").trim().replace(/\s+/g, " ");
      if (title.length < 8) continue;
      const snipEl = li.querySelector(".b_caption p, .b_lineclamp2, .b_caption, .b_snippet");
      let snip = snipEl ? (snipEl.textContent || "").trim().replace(/\s+/g, " ") : "";
      if (snip.length > 200) { const cut = snip.lastIndexOf(" ", 200); snip = (cut > 60 ? snip.slice(0, cut) : snip.slice(0, 200)).replace(/[…,.]+$/, "") + " …"; }
      out.push({ title, url, host, snip });
    }
    return out;
  }

  function rankLiveResults(list, query, brand) {
    const toks = liveTokens(query);
    const brandToks = brand ? (BRAND_ONLY[brand] || []) : [];
    const prodToks = toks.filter((t) => !brandToks.includes(t));
    return list.map((r) => {
      const hay = (r.title + " " + r.url + " " + (r.snip || "")).toLowerCase();
      let s = 0;
      if (brand && OEM_DOMAINS[brand] && r.host.endsWith(OEM_DOMAINS[brand])) s += 40;
      else if (brand && r.host.includes(brand)) s += 22;
      for (const t of toks) { if (hay.includes(t)) s += 7; }
      if (/support|specs?|product|docs|manuals?/i.test(r.url)) s += 5;
      if (/\d{3,}/.test(r.url)) s += 4;
      if (/^en\.wikipedia|notebookcheck|\.edu\b/i.test(r.host)) s += 3;
      if (prodToks.length && !prodToks.some((t) => hay.includes(t))) s = Math.min(s, 8);
      return { r, s };
    }).filter((x) => x.s >= 10 && !/(^|\.)(bing\.com|microsoft\.com|go\.microsoft|msn\.com|youtube\.com)$/.test(x.r.host))
      .sort((a, b) => b.s - a.s).slice(0, 9).map((x) => x.r);
  }

  async function liveSearch(query, brand) {
    if (!window.root || !root.superFetch) return { ok: false, error: "live fetcher not loaded" };
    if (state.liveCache.has(query)) return state.liveCache.get(query);
    const tries = [query];
    const fq = focusQuery(query);
    if (fq && fq !== query.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim()) tries.push(fq);
    let lastErr = "no results";
    for (const tryQ of tries) {
      const serp = "https://www.bing.com/search?q=" + encodeURIComponent(tryQ) + "&setlang=en&cc=CA";
      try {
        const r = await race(root.superFetch(serp, { redirect: "follow" }), 15000);
        if (!r || !(r.status >= 200 && r.status < 300)) { lastErr = "HTTP " + (r && r.status || "?"); continue; }
        const html = await race(r.text(), 8000);
        if (!html || html.length > 3000000) { lastErr = "page too large or empty"; continue; }
        const items = rankLiveResults(parseBingResults(html), tryQ === query ? query : fq, brand);
        if (items.length) {
          const res = { ok: true, items, fetchedAt: new Date().toISOString(), usedQuery: tryQ };
          state.liveCache.set(query, res);
          return res;
        }
        lastErr = "no relevant results";
      } catch (e) {
        lastErr = (e && e.message === "timeout") ? "search timed out" : String((e && e.message) || e).slice(0, 80);
      }
    }
    return { ok: false, error: lastErr };
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const n of doc.querySelectorAll("script,style,noscript,svg,canvas,iframe,form,button,nav,footer,header,aside,[role=navigation],.nav,#nav,.footer,.menu,.cookie,.ad,.advertisement,.social,.breadcrumb,.search-form")) n.remove();
    const txt = (doc.body && (doc.body.innerText || doc.body.textContent)) || "";
    return txt.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function fetchPageReadable(url) {
    if (!window.root || !root.superFetch) return { ok: false, error: "live fetcher not loaded" };
    try {
      const r = await race(root.superFetch(url, { redirect: "follow" }), 20000);
      if (!r) return { ok: false, error: "no response" };
      const st = r.status || 0;
      if (!(st >= 200 && st < 300)) return { ok: false, error: "HTTP " + st + " (many vendors block automated fetches — the link still opens in your browser)" };
      const html = await race(r.text(), 15000);
      if (!html || html.length > 5000000) return { ok: false, error: "page too large or unreadable" };
      const text = htmlToText(html);
      if (!text || text.length < 400) return { ok: false, error: "page returned no readable text (likely a JavaScript-only page)" };
      return { ok: true, text: text.slice(0, 18000), bytes: html.length };
    } catch (e) {
      return { ok: false, error: (e && e.message === "timeout") ? "page fetch timed out" : String((e && e.message) || e).slice(0, 90) };
    }
  }

  async function extractPageSpecs(text, url) {
    const instruction = [
      "You extract hardware facts from the TEXT of ONE web page for a tech-finder tool (laptop specs / chargers). The text is the page's visible content with boilerplate partly removed.",
      "HARD RULES: report only values that appear LITERALLY in the text — never infer, complete or guess. If the page is a search-results list, a product landing page with no real specs, a forum covering many machines, a paywall, or mostly unreadable noise, set kind accordingly and leave the rest empty.",
      "Respond with ONLY one JSON object, no markdown fences:",
      '{"kind":"product|search-list|not-a-product|noise","pageTitle":"short real title or null","device":"the exact full model THIS page describes — only if exactly one device, else null","specs":[{"l":"label","v":"value exactly as written","g":"Power|Display|Processor|Memory|Storage|Ports|Battery|Dimensions|Wireless|Other"}],"partNumbers":[{"pn":"part number literally on the page","what":"what the page says it is"}],"adapter":{"wattage":"as written, e.g. 65W, or null","voltage":"as written, e.g. 19.5V, or null","connector":"usb-c|dell 7.4mm barrel|hp 4.5mm barrel|lenovo slim rectangular|other round barrel|magsafe|null","tipNote":"any tip/plug sentence, verbatim"},"warnings":"contradictions or unclear bits, else null"}',
      "specs: up to 16 rows, chosen for a buyer of parts/chargers (power input, included adapter wattage, connectors, battery, memory/storage type, display). Use the page's exact wording. If an adapter wattage or voltage appears anywhere, include it under Power.",
      "partNumbers is the ONLY place for part numbers, and only ones literally present.",
      "TASK: analyze this page text, fetched live:"
    ].join("\n\n");
    const res = await root.generateText({ instruction: instruction + "\n\nPAGE URL: " + url + "\n\nPAGE TEXT:\n" + text });
    const raw = String(res && res.text ? res.text : "").trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }

  function kbFromAdapterHint(s) {
    s = String(s || "").toLowerCase();
    if (s.includes("usb")) return "usbc";
    if (s.includes("7.4") || s.includes("dell")) return "dell74";
    if (s.includes("4.5") || s.includes("hp")) return "hpSmart";
    if (s.includes("lenovo") || s.includes("slim") || s.includes("rectangular")) return "lenovoSlim";
    return null;
  }

  function findPageWatt(parsed) {
    let best = null;
    if (parsed && parsed.adapter && parsed.adapter.wattage) {
      const n = +nums(parsed.adapter.wattage);
      if (n >= 30 && n <= 240) best = n;
    }
    if (parsed && Array.isArray(parsed.specs)) {
      for (const sp of parsed.specs) {
        if (!/watt|output|adapter|power/i.test(sp.l || "")) continue;
        const m = String(sp.v || "").match(/(\d{2,3})\s*W/gi);
        if (m) for (const mm of m) {
          const n = +mm.replace(/\D/g, "");
          if (n >= 30 && n <= 240 && (best == null || n < best)) best = n;
        }
      }
    }
    return best;
  }

  const VENDOR_HOSTS = ["amazon.ca", "memoryexpress.com", "shopbot.ca", "canadacomputers.com", "newegg.ca", "bestbuy.ca", "staples.ca", "dell.com", "hp.com", "lenovo.com"];
  const htmlDecode = (s) => { if (!s) return ""; const t = document.createElement("textarea"); t.innerHTML = String(s); return t.value; };

  function parseAmazonResults(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [], seen = new Set();
    for (const li of doc.querySelectorAll('[data-component-type="s-search-result"]')) {
      const asin = li.getAttribute("data-asin");
      if (!asin || asin.length < 10 || seen.has(asin)) continue;
      let title = "";
      const pEl = li.querySelector("[data-payload]");
      if (pEl) {
        try { const j = JSON.parse(htmlDecode(pEl.getAttribute("data-payload"))); title = j.title || ""; } catch (e) {}
      }
      if (!title) { const h2 = li.querySelector("h2"); if (h2) title = h2.getAttribute("aria-label") || h2.textContent || ""; }
      title = htmlDecode(title).replace(/\s+/g, " ").trim();
      if (title.length < 8 || /more like this/i.test(title)) continue;
      seen.add(asin);
      out.push({ title, url: "https://www.amazon.ca/dp/" + asin, host: "amazon.ca", asin });
      if (out.length >= 8) break;
    }
    return out;
  }

  async function liveVendorSearch(term) {
    if (state.vendorCache.has(term)) return state.vendorCache.get(term);
    if (!window.root || !root.superFetch) return { ok: false, error: "live fetcher not loaded" };
    let lastErr = "no results";
    try {
      const url = "https://www.amazon.ca/s?k=" + encodeURIComponent(term) + "&i=electronics";
      const r = await race(root.superFetch(url, { redirect: "follow" }), 20000);
      if (r && r.status >= 200 && r.status < 300) {
        const html = await race(r.text(), 12000);
        if (html && html.length < 5000000) {
          const items = parseAmazonResults(html);
          if (items.length) {
            const res = { ok: true, items, source: "amazon", fetchedAt: new Date().toISOString() };
            state.vendorCache.set(term, res);
            return res;
          }
          lastErr = "no Amazon.ca product results for this phrasing";
        }
      } else {
        lastErr = "HTTP " + ((r && r.status) || "?") + " from Amazon.ca";
      }
    } catch (e) {
      lastErr = (e && e.message === "timeout") ? "Amazon.ca search timed out" : String((e && e.message) || e).slice(0, 80);
    }
    try {
      const q = "(" + VENDOR_HOSTS.map((h) => "site:" + h).join(" OR ") + ") " + term;
      const serp = "https://www.bing.com/search?q=" + encodeURIComponent(q) + "&setlang=en&cc=CA";
      const r = await race(root.superFetch(serp, { redirect: "follow" }), 15000);
      if (r && r.status >= 200 && r.status < 300) {
        const html = await race(r.text(), 8000);
        if (html && html.length < 3000000) {
          const items = parseBingResults(html).filter((it) => VENDOR_HOSTS.some((h) => it.host === h || it.host.endsWith("." + h))).slice(0, 8);
          if (items.length) {
            const res = { ok: true, items, source: "bing-vendors", fetchedAt: new Date().toISOString() };
            state.vendorCache.set(term, res);
            return res;
          }
          lastErr = "no vendor-site results via search fallback";
        }
      }
    } catch (e) {
      lastErr = (e && e.message === "timeout") ? "vendor search timed out" : String((e && e.message) || e).slice(0, 80);
    }
    return { ok: false, error: lastErr };
  }

  function renderVendorResults(container, res, term, health) {
    if (!container) return;
    if (!res.ok) {
      container.innerHTML = '<div class="vendor-note">Live vendor search couldn\u2019t run right now (' + esc(res.error || "network error") + '). The deep-search links above always work.</div>';
      return;
    }
    const stamp = new Date(res.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    let items = res.items.slice();
    const rank = (u) => {
      const h = health && health.get(u);
      if (!h) return 3;
      if (h.cls === "ok") return 0;
      if (h.cls === "oog" || h.cls === "warn") return 1;
      return 2;
    };
    if (health) items.sort((a, b) => rank(a.url) - rank(b.url));
    const liveCount = items.filter((i) => rank(i.url) === 0).length;
    const oogCount = items.filter((i) => { const h = health && health.get(i.url); return h && h.cls === "oog"; }).length;
    const deadCount = items.filter((i) => { const h = health && health.get(i.url); return h && h.cls === "dead"; }).length;
    let h = '<div class="vendor-head"><span class="dot-g"></span> Live listings for “' + esc(term) + '” · fetched ' + stamp +
      (res.source === "amazon" ? " · Amazon.ca" : " · vendor sites via search");
    if (health) h += '<span class="vendor-avail">availability: ' + liveCount + "/" + items.length + " responding" + (oogCount ? " · " + oogCount + " out of stock" : "") + (deadCount ? " · " + deadCount + " gone (404)" : "") + "</span>";
    h += "</div>";
    h += '<div class="vendor-list">';
    for (const it of items) {
      const hth = health ? health.get(it.url) : null;
      const dot = hth ? '<span class="src-dot ' + hth.cls + '" title="' + esc(hth.label) + '"></span>' : '<span class="src-dot na" title="availability not checked"></span>';
      h += '<div class="vendor-row">' + dot + '<span class="vendor-body"><a class="vendor-title' + (hth && hth.cls === "dead" ? " is-dead" : "") + '" target="_blank" rel="noopener" href="' + esc(it.url) + '">' + esc(it.title) + "</a>";
      h += '<div class="vendor-meta">' + esc(it.host) + (it.asin ? " · ASIN " + esc(it.asin) : "") + (hth ? " · " + esc(hth.label) : "") + "</div></span></div>";
    }
    h += "</div>";
    h += '<div class="vendor-note">Ranked by live availability (responding first; out-of-stock and dead listings dropped to the bottom). Prices are never shown or claimed. Stock wording is quoted only from the vendor\\u2019s own page. A search hit is not a fit verdict: only the rules above decide compatibility.</div>';
    container.innerHTML = h;
  }

  function amazonAvailability(html) {
    if (!html) return null;
    let t = "";
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const av = doc.getElementById("availability");
      if (av) t = (av.textContent || "").trim();
    } catch (e) {}
    if (!t) {
      const m = String(html).match(/"availability"\s*:\s*"([^"]{2,80})"/);
      if (m) t = m[1].replace(/\\u0027/g, "'").trim();
    }
    t = t.replace(/\s+/g, " ").trim();
    if (!t) return null;
    const low = t.toLowerCase();
    if (/currently unavailable|out of stock|temporarily|no longer available/i.test(low)) return { oog: true, text: t };
    if (/in stock|only \d+ left|ships in/i.test(low)) return { oog: false, text: t };
    return null;
  }

  async function checkVendorHealth(urls) {
    if (!window.root || !root.superFetch) return state.vendorHealth;
    const todo = urls.filter((u) => !state.vendorHealth.has(u)).slice(0, 8);
    await mapPool(todo, 3, async (url) => {
      let cls = "unreach", label = "✗ link not responding", oog = false;
      try {
        const r = await race(root.superFetch(url, { redirect: "follow" }), 12000);
        const st = r && r.status ? r.status : 0;
        if (st >= 200 && st < 300) {
          cls = "ok"; label = "listing responding";
          if (hostOnly(url) === "amazon.ca") {
            try {
              const html = await race(r.text(), 8000);
              const av = html ? amazonAvailability(html) : null;
              if (av) {
                oog = av.oog;
                if (oog) { cls = "oog"; label = "Amazon.ca page says: “" + av.text.slice(0, 64) + "”"; }
              }
            } catch (e) {}
          }
        }
        else if ((st === 404 || st === 410 || st === 451) && !BOT_BLOCK_HOSTS.includes(hostOnly(url))) { cls = "dead"; label = "✕ dead — HTTP " + st + " (listing removed/moved)"; }
        else if (st === 403 || st === 401 || st === 429 || st === 503 || BOT_BLOCK_HOSTS.includes(hostOnly(url))) { cls = "warn"; label = "HTTP " + st + " — may block bots"; }
        else { cls = "warn"; label = "HTTP " + st + " — may block bots"; }
      } catch (e) {
        label = (e && e.message === "timeout") ? "availability check timed out" : "✗ link not responding";
      }
      state.vendorHealth.set(url, { cls, label, oog, at: Date.now() });
    });
    return state.vendorHealth;
  }

  function attachVendorSearch(scope) {
    $$(".live-vendor", scope).forEach((b) => b.addEventListener("click", async () => {
      const term = b.dataset.term, out = $(b.dataset.out);
      if (!term || !out || b.dataset.busy) return;
      b.dataset.busy = "1";
      const old = b.innerHTML;
      b.disabled = true;
      b.innerHTML = '<span class="spinner" style="border-width:2px;width:13px;height:13px"></span> searching…';
      out.innerHTML = '<div class="vendor-note">Querying Amazon.ca + vendor sites for “' + esc(term) + '”…</div>';
      try {
        const res = await liveVendorSearch(term);
        renderVendorResults(out, res, term);
        if (res.ok && res.items && res.items.length) {
          const health = await checkVendorHealth(res.items.map((i) => i.url));
          renderVendorResults(out, res, term, health);
        }
      } catch (e) {
        out.innerHTML = '<div class="vendor-note">Live vendor search failed — use the deep-search links above.</div>';
      } finally {
        delete b.dataset.busy;
        b.disabled = false;
        b.innerHTML = old;
      }
    }));
    paintKnownDots(scope);
  }

  function manufacturerSearchRows(query) {
    const brand = brandOf(query);
    const q = encodeURIComponent(query);
    const manual = [
      { label: "Dell support — search “" + query + "”", url: "https://www.dell.com/support/search/en-us?q=" + q },
      { label: "HP support — search “" + query + "”", url: "https://support.hp.com/us-en/search?q=" + q },
      { label: "Lenovo support — search “" + query + "”", url: "https://pcsupport.lenovo.com/us/en/search?q=" + q },
      { label: "Apple support — search “" + query + "”", url: "https://support.apple.com/en-us/search?q=" + q }
    ];
    const pref = brand ? manual.filter((m) => m.label.toLowerCase().startsWith(brand)) : [];
    return (pref.length ? pref : manual).slice(0, 3).map((s) =>
      '<a class="source" target="_blank" rel="noopener" href="' + esc(s.url) + '"><span class="src-dot na"></span><span><strong>' + esc(s.label) + "</strong><small>" + esc(s.url) + "</small></span></a>"
    ).join("");
  }

  function selectConnOpt(conn) {
    $$(".conn-opt").forEach((b) => b.classList.toggle("sel", b.dataset.conn === conn));
  }

  function fitFormHtml(open) {
    let h = '<details class="method" ' + (open ? "open" : "") + ' id="fitDetails"><summary>' + (open ? "Match an adapter to this device — answer two questions" : "I need an adapter/charger for this device (match from two facts I know)") + "</summary>";
    h += '<div class="method-body">';
    h += '<p class="muted small">Fit is decided by the <strong>deterministic rules engine</strong>, never the AI. You supply the two facts every rule needs: the <strong>connector family</strong> (look at the laptop\u2019s charging port, or the tip of your current adapter) and the <strong>wattage</strong> printed on the current adapter (e.g. 65W).</p>';
    h += '<label class="muted small" style="font-weight:700">1 · Connector family — pick the one that matches your port / tip:</label>';
    h += '<div class="conn-guide" style="margin:8px 0 12px">';
    for (const id of Object.keys(DB.CONN_KB)) {
      const k = DB.CONN_KB[id];
      h += '<button type="button" class="choice conn-opt" data-conn="' + id + '"><span class="choice-brand">' + esc(k.label) + "</span>";
      h += '<span class="choice-sub">' + esc(k.tip || k.sub || "") + "</span>";
      h += '<span class="choice-sub">' + esc(k.detail || "") + "</span></button>";
    }
    h += "</div>";
    h += '<label class="muted small" style="font-weight:700">2 · Wattage on the old adapter\u2019s label:</label>';
    h += '<div class="fit-facts"><input id="fitWatts" inputmode="numeric" value="65"><span class="muted small">W</span>';
    h += '<span class="quickw">' + [45, 65, 90, 100, 130].map((w) => '<button type="button" class="chipbtn" data-w="' + w + '">' + w + "W</button>").join("") + "</span></div>";
    h += '<label class="muted small" style="font-weight:700">Device label (optional — shows up in the result):</label>';
    h += '<div class="fit-facts"><input id="fitName" style="width:auto;min-width:220px;flex:1" placeholder="e.g. Acer Aspire 5 (A515-54)"></div>';
    h += '<button class="btn primary" id="fitGo">Show adapters that pass every rule</button>';
    h += '<div id="fitOut" style="margin-top:14px"></div>';
    h += "</div></details>";
    return h;
  }

  function fitOutHtml(name, conn, watts) {
    const synth = { id: "live-device", name: name || "your device", brand: brandOf(name) || "", power: { conn, watts }, sources: [] };
    const { fits, notFits } = rankedAdapters(synth);
    let h = '<div class="banner">Fit is computed by rules from the facts <strong>you</strong> entered — ' + esc(connLabel(conn)) + " plug, " + watts + "W. The web-extracted sheet above plays no part in this decision.</div>";
    h += renderAdapterListHtml(synth, fits, notFits, true);
    if (!fits.length) {
      h += '<p class="muted small" style="margin-top:8px">No catalog adapter passes every rule. Either your wattage is above what the catalog covers, the connector family is misidentified (double-check the tip shape), or the device takes a proprietary plug — in the last case only the OEM adapter is safe. A <button class="linklike" data-act="photo">photo of the tip</button> helps double-check the geometry.</p>';
    }
    return h;
  }

  function wireFitForm(scope, query) {
    $$(".conn-opt", scope).forEach((b) => b.addEventListener("click", () => selectConnOpt(b.dataset.conn)));
    $$(".quickw .chipbtn", scope).forEach((b) => b.addEventListener("click", () => { const i = $("#fitWatts", scope); if (i) i.value = b.dataset.w; }));
    const go = $("#fitGo", scope);
    if (go) go.addEventListener("click", () => {
      const connEl = $(".conn-opt.sel", scope);
      if (!connEl) { toast("Step 1 first — pick the connector family that matches your port"); return; }
      const conn = connEl.dataset.conn;
      const wi = $("#fitWatts", scope);
      const w = +nums(wi ? wi.value : "65");
      if (!(w >= 30 && w <= 240)) { toast("Wattage looks off — it is printed on the old adapter, e.g. 65"); return; }
      const ni = $("#fitName", scope);
      const name = (ni && ni.value.trim()) || query;
      const out = $("#fitOut", scope);
      if (out) out.innerHTML = fitOutHtml(name, conn, w);
      if (out) { attachVendorSearch(out); out.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    });
    const ph = scope.querySelector('[data-act="photo"]');
    if (ph) ph.addEventListener("click", () => { $("#fileBtn").click(); });
  }

  function renderLiveRows(zone, res, query) {
    zone.innerHTML = res.items.map((r) =>
      '<div class="live-row"><div class="live-body"><strong>' + esc(r.title) + "</strong><small>" + esc(r.host) + " · " + esc(r.url) + "</small>" +
      (r.snip ? '<div class="live-snip">' + esc(r.snip) + "</div>" : "") + "</div>" +
      '<button type="button" class="btn live-use">Fetch &amp; extract</button></div>'
    ).join("");
    $$(".live-use", zone).forEach((b, i) => b.addEventListener("click", () => beginExtraction(res.items[i].url, query)));
  }

  async function beginExtraction(url, query) {
    if (state.extracting) { toast("One page at a time — wait for the current fetch"); return; }
    state.extracting = true;
    const btns = $$(".live-use");
    btns.forEach((b) => { b.disabled = true; b.textContent = "fetching…"; });
    const status = $("#liveStatus");
    if (status) status.textContent = "Fetching " + hostOnly(url) + " — this can take 10–25 s…";
    try {
      const pg = await fetchPageReadable(url);
      if (!pg.ok) throw new Error(pg.error || "fetch failed");
      if (status) status.textContent = "Fetched " + (pg.bytes / 1024).toFixed(0) + " KB — extracting only what the page literally says…";
      const parsed = await extractPageSpecs(pg.text, url);
      if (status) status.textContent = "";
      if (!parsed) throw new Error("could not parse the extraction output");
      renderLiveSheetCard(parsed, url, query);
    } catch (e) {
      if (status) status.textContent = "Couldn\u2019t use that page: " + String((e && e.message) || e).slice(0, 150);
      toast("That page couldn\u2019t be extracted");
    } finally {
      state.extracting = false;
      btns.forEach((b) => { b.disabled = false; b.textContent = "Fetch & extract"; });
    }
  }

  function renderLiveSheetCard(parsed, url, query) {
    const out = $("#results");
    const usable = parsed.kind === "product" && (parsed.device || (parsed.specs && parsed.specs.length) || (parsed.partNumbers && parsed.partNumbers.length));
    const host = hostOnly(url);
    const fetched = new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    let h = '<section class="card result-card live-sheet">';
    h += '<div class="result-kicker">Live-extracted sheet · from a fetched page</div>';
    h += '<div class="result-top"><div><h2 class="prod-title">' + esc(parsed.device || parsed.pageTitle || "Spec extraction") + "</h2>";
    h += '<div class="muted small">Page: <a target="_blank" rel="noopener" href="' + esc(url) + '">' + esc(host) + "</a> · fetched " + esc(fetched) + "</div></div>";
    h += '<div class="result-actions no-print"><button class="btn ghost" id="sheetCopy">Copy report (MD)</button>';
    h += '<button class="btn ghost" id="sheetClose">Dismiss</button></div></div>';
    if (!usable) {
      h += '<div class="banner warn">This page is not a usable spec source — the extractor read it as “' + esc(parsed.kind || "unknown") + '”. It may be a search list, a JS-only page, or text that names no single product. Nothing was turned into facts.</div>';
      if (parsed.warnings) h += '<p class="muted small">' + esc(parsed.warnings) + "</p>";
      h += "</section>";
      out.insertAdjacentHTML("afterbegin", h);
      const card = out.firstElementChild;
      $("#sheetClose", card).addEventListener("click", () => card.remove());
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    h += '<div class="banner warn"><strong>Unverified — read moments ago, not yet trusted.</strong> Every row below is auto-extracted from the page above and shows an amber dot until <em>you</em> confirm it matches your machine. Part numbers here are <strong>never order-safe</strong>: verify the exact number on the OEM page first.</div>';
    if (parsed.specs && parsed.specs.length) {
      h += '<div class="spec-table">';
      const groups = [];
      for (const r of parsed.specs) { (groups[r.g || "Other"] = groups[r.g || "Other"] || []).push(r); }
      for (const g of Object.keys(groups)) {
        h += '<div class="spec-group"><h4>' + esc(g) + "</h4>";
        groups[g].forEach((r) => {
          const ci = parsed.specs.indexOf(r);
          const ok = state.confirmedLive.has(r.l + "::" + r.v);
          h += '<div class="spec-row"><div class="spec-label">' + esc(r.l) + "</div>";
          h += '<div class="spec-val"><span class="' + (ok ? "dot-g" : "dot-a") + '" title="' + (ok ? "you confirmed this matches your device" : "auto-extracted from the fetched page — unverified") + '"></span>' + esc(r.v) + "</div>";
          h += '<div class="spec-src"><a target="_blank" rel="noopener" href="' + esc(url) + '">' + esc(host) + "</a> · <span class='row-confirm'>" + (ok ? '<span class="confirm-chip">you confirmed ✓</span>' : '<button class="linklike" data-c="' + ci + '">looks right — confirm</button>') + "</span></div></div>";
        });
        h += "</div>";
      }
      h += "</div>";
    }
    const watt = findPageWatt(parsed);
    const conn = kbFromAdapterHint(parsed.adapter && parsed.adapter.connector);
    if ((parsed.adapter && (parsed.adapter.wattage || parsed.adapter.voltage || parsed.adapter.connector || parsed.adapter.tipNote)) || conn || watt) {
      h += '<div class="banner" style="margin-top:12px"><strong>What the page says about power:</strong> ';
      const bits = [];
      if (parsed.adapter && parsed.adapter.wattage) bits.push(esc(parsed.adapter.wattage));
      if (parsed.adapter && parsed.adapter.voltage) bits.push(esc(parsed.adapter.voltage));
      if (parsed.adapter && parsed.adapter.connector) bits.push(esc(parsed.adapter.connector));
      if (parsed.adapter && parsed.adapter.tipNote) bits.push("“" + esc(parsed.adapter.tipNote) + "”");
      h += bits.join(" · ") + ".</div>";
      if (conn || watt) {
        h += '<div class="result-actions no-print" style="margin-top:8px"><button class="btn primary" id="sheetPrefill">' + ((conn && watt) ? "Both facts found — use them in the fit check" : "Use what was found in the fit check") + "</button>";
        h += '<span class="muted small">Fit still needs <em>your</em> yes — the button pre-fills the connector + wattage questions below, and you review them before the rules run.</span></div>';
      }
    }
    if (parsed.partNumbers && parsed.partNumbers.length) {
      h += '<h4 style="margin:16px 0 4px">Part numbers seen on the page</h4>';
      h += '<div class="cand-list">';
      for (const p of parsed.partNumbers.slice(0, 8)) {
        h += '<div class="cand"><div><strong>' + esc(p.pn) + "</strong><div class='muted small'>" + esc(p.what || "") + '</div><div class="no-part">⚠ unverified against any vendor — look this exact number up on the OEM site before buying.</div></div></div>';
      }
      h += "</div>";
    }
    if (parsed.warnings) h += '<p class="tiny">Extractor\u2019s note: ' + esc(parsed.warnings) + "</p>";
    h += '<p class="tiny">A “confirmed” row only means <em>you</em> said it matches your machine — it is session-local and never implies the vendor verified anything.</p>';
    h += "</section>";
    out.insertAdjacentHTML("afterbegin", h);
    wireLiveSheet(out.firstElementChild, parsed, url, query);
    out.firstElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function liveSheetMarkdown(parsed, url, query) {
    const lines = [];
    lines.push("# Live-extracted sheet (unverified) — " + (parsed.device || parsed.pageTitle || "unknown device"));
    lines.push("Extracted: " + fmtDate() + " from " + url);
    lines.push("Status: auto-extracted from one fetched page. Rows marked [x] were confirmed by the user as matching their device.");
    lines.push("");
    lines.push("| Group | Item | Value | Status |");
    lines.push("|---|---|---|---|");
    for (const r of (parsed.specs || [])) {
      const ok = state.confirmedLive.has(r.l + "::" + r.v);
      lines.push("| " + escMd(r.g || "Other") + " | " + escMd(r.l) + " | " + escMd(r.v) + " | " + (ok ? "[x] you confirmed" : "[ ] unverified") + " |");
    }
    if (parsed.partNumbers && parsed.partNumbers.length) {
      lines.push("");
      lines.push("## Part numbers on the page (NOT order-safe)");
      for (const p of parsed.partNumbers) lines.push("- " + p.pn + (p.what ? " — " + p.what : ""));
    }
    lines.push("");
    lines.push("Source: " + url + " · generated " + fmtDate() + " · never order a part on an unverified number.");
    return lines.join("\n");
  }

  function wireLiveSheet(card, parsed, url, query) {
    const close = $("#sheetClose", card);
    if (close) close.addEventListener("click", () => card.remove());
    const copyBtn = $("#sheetCopy", card);
    if (copyBtn) copyBtn.addEventListener("click", async () => {
      toast((await copyText(liveSheetMarkdown(parsed, url, query))) ? "Markdown report copied" : "copy failed", "ok");
    });
    $$("[data-c]", card).forEach((b) => b.addEventListener("click", () => {
      const r = parsed.specs[+b.dataset.c];
      if (!r) return;
      const key = r.l + "::" + r.v;
      state.confirmedLive.set(key, { l: r.l, v: r.v, g: r.g, url, at: new Date().toISOString() });
      const row = b.closest(".spec-row");
      const dot = row.querySelector(".spec-val > span");
      if (dot) { dot.className = "dot-g"; dot.title = "you confirmed this matches your device"; }
      const wrap = b.closest(".row-confirm");
      if (wrap) wrap.innerHTML = '<span class="confirm-chip">you confirmed ✓</span>';
    }));
    const pf = $("#sheetPrefill", card);
    if (pf) pf.addEventListener("click", () => {
      const watt = findPageWatt(parsed);
      const conn = kbFromAdapterHint(parsed.adapter && parsed.adapter.connector);
      const details = $("#fitDetails");
      if (!details) { toast("The fit-check card isn\u2019t on screen — re-run your search"); return; }
      details.open = true;
      if (conn) selectConnOpt(conn);
      const wi = $("#fitWatts");
      if (wi && watt) wi.value = watt;
      const ni = $("#fitName");
      if (ni) ni.value = parsed.device || query;
      if (!conn || !watt) toast(conn ? "Wattage not found on the page — read it from your old adapter" : "Connector not found on the page — pick the family that matches your port");
      details.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function renderNotFound(query, near, opts) {
    opts = opts || {};
    state.lastQuery = query;
    state.product = null;
    state.adapterMode = false;
    const out = $("#results");
    let h = '<section class="card result-card">';
    h += '<div class="result-kicker">No exact match in the curated catalog</div>';
    h += "<h2>I couldn't identify “" + esc(query) + "” from the catalog</h2>";
    h += '<p class="muted">The catalog covers 10 curated laptop models — outside it this tool <strong>searches the live web for official sources</strong> instead of guessing. Anything read from a fetched page is marked unverified until you confirm it against your machine.</p>';
    if (opts.note) h += '<div class="banner">' + esc(opts.note) + "</div>";

    const nearList = (near || []).filter((s) => s.score > 12).map((s) => s.p);
    if (nearList.length) {
      h += '<h3 style="margin-top:18px">Closest catalog devices (for reference specs &amp; parts)</h3>';
      h += '<div class="choice-grid">';
      for (const p of nearList.slice(0, 3)) {
        h += '<button class="choice" data-pick="' + esc(p.id) + '"><span class="choice-brand">' + esc(p.brand) + "</span><strong>" + esc(p.line) + " " + esc(p.model) + '</strong><span class="choice-sub">' + esc(p.year || "") + "</span></button>";
      }
      h += "</div>";
    }

    h += '<div class="live-head"><h3 style="margin:0">Live source search</h3><span class="muted small" id="liveStamp"></span></div>';
    h += '<p class="muted small" id="liveStatus">Searching live results for “' + esc(query) + "”…</p>";
    h += '<div id="liveZone"></div>';

    h += '<div style="margin-top:16px">' + fitFormHtml(opts.wantsPower) + "</div>";

    h += '<details class="method" style="margin-top:14px"><summary>Search the manufacturer directly</summary><div class="source-list" style="margin-top:8px">' + manufacturerSearchRows(query) + "</div></details>";

    h += '<p class="muted" style="margin-top:14px">Tip: photo flows (<button class="linklike" data-act="photo">upload a spec-label or connector photo</button>) work best for models whose exact number you do not know.</p>';
    h += "</section>";
    out.innerHTML = h;
    const pick = (b) => {
      const p = DB.PROD.find((x) => x.id === b.dataset.pick);
      if (p) { state.product = p; renderProduct(p, { query: query, conf: 80, focus: "all" }); }
    };
    $$(".choice", out).forEach((b) => b.addEventListener("click", () => pick(b)));
    wireFitForm(out, query);
    const brand = brandOf(query);
    liveSearch(query, brand).then((res) => {
      const status = $("#liveStatus"), zone = $("#liveZone");
      if (!zone || !status) return;
      if (res && res.ok) {
        const stamp = $("#liveStamp");
        if (stamp && res.fetchedAt) stamp.textContent = "live · fetched " + new Date(res.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (!res.items.length) { status.textContent = "The live search returned no readable results for this phrasing — use the manufacturer links below, or rephrase with the full model number."; return; }
        status.innerHTML = '<span class="dot-a"></span>' + res.items.length + " search results — I have not read these pages yet. Click <strong>Fetch this page</strong> on the one that looks like yours and I'll only report what it literally says.";
        renderLiveRows(zone, res, query);
      } else {
        status.textContent = "Live search is unavailable right now (" + ((res && res.error) || "network error") + ") — the manufacturer links below always work.";
      }
    }).catch(() => {
      const status = $("#liveStatus");
      if (status) status.textContent = "Live search failed — the manufacturer links below always work.";
    });
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function connLabel(conn) { const k = DB.CONN_KB[conn]; return k ? k.label + (k.tip ? " · " + k.tip : "") : conn; }

  function fitRules(product, adapter) {
    const pw = product.power, ak = DB.CONN_KB[adapter.conn];
    const rules = [];
    if (adapter.conn === "usbc" && pw.conn === "usbc") {
      rules.push({ t: "USB-C socket on " + product.name + " accepts a USB-C PD plug", ok: true });
      rules.push({ t: "Power: " + adapter.watts + "W ≥ " + pw.watts + "W the machine is rated for", ok: adapter.watts >= pw.watts });
      rules.push({ t: "Voltage negotiated automatically (PD)", ok: true });
    } else if (adapter.conn === pw.conn) {
      rules.push({ t: "Tip geometry: " + ak.tip + " matches the laptop's " + pw.tip + " jack", ok: true });
      if (pw.volts) rules.push({ t: "Voltage: adapter " + adapter.volts + " vs. required " + pw.volts, ok: String(adapter.volts).startsWith(String(pw.volts)) });
      rules.push({ t: "Polarity: center-positive (standard for " + product.brand + ")", ok: true });
      rules.push({ t: "Power: " + adapter.watts + "W ≥ " + pw.watts + "W rated demand", ok: adapter.watts >= pw.watts });
    } else {
      rules.push({ t: "Connector: " + connLabel(adapter.conn) + " does not fit a " + connLabel(pw.conn) + " jack", ok: false });
    }
    const fits = rules.every((r) => r.ok);
    return { fits, rules };
  }

  function rankedAdapters(product) {
    const out = [];
    for (const a of DB.ADAPTERS) {
      const { fits, rules } = fitRules(product, a);
      const brandFirst = a.kind === "oem" ? (a.brand === product.brand ? 0 : 1) : 2;
      out.push({ a, fits, rules, rank: brandFirst * 1000 + Math.abs(a.watts - product.power.watts) });
    }
    out.sort((x, y) => x.rank - y.rank);
    const fits = out.filter((o) => o.fits);
    const notFits = out.filter((o) => !o.fits);
    return { fits, notFits };
  }

  function sourceFor(product, row) {
    const si = row && row.s != null ? row.s : 0;
    return product.sources[si] || product.sources[0];
  }

  function renderProduct(product, ctx) {
    state.product = product;
    state.adapterMode = false;
    const out = $("#results");
    const conf = ctx && ctx.conf != null ? ctx.conf : 85;
    const confLbl = conf >= 85 ? "high" : conf >= 55 ? "medium" : "low";
    const confCls = "conf-" + confLbl;
    const { fits, notFits } = rankedAdapters(product);
    const src0 = product.sources[0];

    let h = "";
    h += '<section class="card result-card">';

    if (ctx && ctx.viaAi) h += '<div class="banner">Identified with AI assistance from your phrasing — verify the model line below.</div>';
    if (ctx && ctx.photo) h += '<div class="banner">' + esc(ctx.photo.note || "Identified from photo") + "</div>";

    h += '<div class="result-top">';
    h += '<div><div class="result-kicker">' + esc(product.brand) + " · " + esc(product.line) + (product.year ? " · " + product.year : "") + "</div>";
    h += "<h2 class=\"prod-title\">" + esc(product.name) + "</h2>";
    h += '<div class="chips">';
    h += '<span class="chip ' + confCls + '">confidence ' + confLbl + "</span>";
    h += '<span class="chip">power: <strong>' + product.power.watts + "W</strong> · " + esc(connLabel(product.power.conn)) + "</span>";
    h += "</div></div>";
    h += '<div class="result-actions no-print">';
    h += '<button class="btn ghost" data-copy="md">Copy report (MD)</button>';
    h += '<button class="btn ghost" data-copy="csv">Copy CSV</button>';
    h += '<button class="btn ghost" data-act="print">Print</button>';
    h += '<button class="btn ghost" data-act="link">Result link</button>';
    h += "</div></div>";

    h += '<div class="power-need">';
    h += '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>';
    h += "<div><strong>What this device needs:</strong><br>" + esc(product.power.note || "") + "</div>";
    h += "</div>";

    h += '<div class="tabs no-print" role="tablist">';
    h += '<button class="tab on" data-tab="specs">Spec sheet (' + product.specs.length + ")</button>";
    h += '<button class="tab" data-tab="power">Adapters — ' + fits.length + ' fit</button>';
    h += '<button class="tab" data-tab="parts">Parts & upgrades</button>';
    h += '<button class="tab" data-tab="sources">Sources & method</button>';
    h += "</div>";

    h += '<div class="tab-body" data-body="specs">';
    h += '<p class="muted small">Every row is linked to its source. <span class="dot-g"></span> = value verified against the cited page at build time · <span class="dot-a"></span> = curated from the OEM page family — check the source before relying on it.</p>';
    h += '<div class="spec-table">';
    const groups = [];
    for (const r of product.specs) { (groups[r.g] = groups[r.g] || []).push(r); }
    for (const g of Object.keys(groups)) {
      h += '<div class="spec-group"><h4>' + esc(g) + "</h4>";
      for (const r of groups[g]) {
        const s = sourceFor(product, r);
        h += '<div class="spec-row"><div class="spec-label">' + esc(r.l) + "</div>";
        h += '<div class="spec-val"><span class="' + (r.vf ? "dot-g" : "dot-a") + '" title="' + (r.vf ? "verified against source" : "unverified — curated") + '"></span>' + esc(r.v) + "</div>";
        h += '<div class="spec-src"><a target="_blank" rel="noopener" href="' + esc(s.url) + '">' + esc(s.label) + "</a></div></div>";
      }
      h += "</div>";
    }
    h += "</div></div>";

    h += '<div class="tab-body" data-body="power" hidden>';
    h += renderAdapterListHtml(product, fits, notFits, true);
    h += "</div>";

    h += '<div class="tab-body" data-body="parts" hidden>';
    h += renderPartsHtml(product);
    h += "</div>";

    h += '<div class="tab-body" data-body="sources" hidden>';
    h += renderSourcesHtml(product, ctx);
    h += "</div>";
    h += "</section>";

    out.innerHTML = h;
    const s = out.querySelector(".result-card");
    wireResultInteractions(s, product, ctx);
    attachVendorSearch(s);

    if (location.hash) {
      try { history.replaceState(null, "", "#p=" + product.id); } catch (e) { location.hash = "p=" + product.id; }
    } else {
      try { history.replaceState(null, "", "#p=" + product.id); } catch (e) {}
    }
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderAdapterListHtml(product, fits, notFits, insideProduct) {
    let h = "";
    h += '<p class="muted small">Matching is deterministic, not guessed: connector geometry + voltage + wattage must all pass (see per-card rules). OEM first, then reputable third-party. Part numbers are only shown when they appear in a cited source — otherwise check the listing.</p>';
    if (!fits.length) {
      h += '<div class="empty">No adapter in the catalog passes every rule for this device. Try a photo of the barrel tip, or check the manufacturer page.</div>';
    }
    for (const o of fits) {
      const a = o.a;
      h += '<div class="adapter-card">';
      h += '<div class="adapter-head"><div class="adapter-ident">';
      h += '<span class="conn-badge">' + connBadge(a.conn) + "</span>";
      h += '<div><div class="adapter-name">' + esc(a.name) + "</div>";
      h += '<div class="adapter-meta">' + a.watts + "W · " + esc(a.volts) + " · " + esc(connLabel(a.conn)) + "</div></div></div>";
      h += '<span class="pill ' + (a.brand === product.brand && a.kind === "oem" ? "pill-rec" : a.kind === "oem" ? "pill-oem" : "pill-3p") + '">' + (a.kind === "oem" ? "OEM" : "3rd-party") + "</span>";
      h += "</div>";
      h += '<div class="why-fit"><strong>Why this fits:</strong> <span class="why-line">' + esc(whyFitLine(product, a)) + "</span></div>";
      h += '<div class="rules">' + o.rules.map((r) => ruleChip(r)).join("") + "</div>";
      h += '<div class="note-line">' + esc(a.note || "") + "</div>";
      h += '<div class="buy-row no-print">';
      const oemUrl = a.sources && a.sources.length ? a.sources[0].url : null;
      const oemLabel = a.sources && a.sources.length ? a.sources[0].label : null;
      for (const l of buyLinksFor(a.term, oemUrl, oemLabel)) {
        h += '<a class="buy-btn ' + (l.primary ? "primary" : "") + '" target="_blank" rel="noopener" href="' + esc(l.url) + '">' + linkDot(l.url) + esc(l.label) + "</a>";
      }
      if (a.term) {
        h += '<button type="button" class="btn ghost live-vendor" data-term="' + esc(a.term) + '" data-out="#vendor-' + esc(a.id) + '">Find live listings</button>';
      }
      h += "</div>";
      if (a.term) h += '<div id="vendor-' + esc(a.id) + '" class="vendor-out"></div>';
      h += '<div class="no-part">No part number in the DB for this adapter — it appears on the OEM listing / product label. Never trust a part number from an uncited source.</div>';
      h += "</div>";
    }
    if (notFits.length && insideProduct) {
      h += '<details class="notfit"><summary>Also checked — ' + notFits.length + ' adapters that do NOT fit (why)</summary>';
      for (const o of notFits) {
        const a = o.a;
        h += '<div class="nf-row"><div><strong>' + esc(a.name) + "</strong> <span class=\"muted\">(" + a.watts + "W · " + esc(connLabel(a.conn)) + ")</span></div>";
        h += '<div class="nf-why">' + o.rules.filter((r) => !r.ok).map((r) => "<span class=\"x-line\">✕ " + esc(r.t) + "</span>").join(" ") + "</div></div>";
      }
      h += "</details>";
    }
    return h;
  }

  function whyFitLine(product, a) {
    if (a.conn === "usbc" && product.power.conn === "usbc") {
      if (a.watts >= product.power.watts) return a.watts + "W of USB-C PD meets the " + product.power.watts + "W this model is rated for — plug into either USB-C port.";
      return "same connector, but " + a.watts + "W is below the " + product.power.watts + "W this model is rated for.";
    }
    return "same " + connLabel(a.conn) + " connector family as this model's jack, with enough wattage.";
  }

  function ruleChip(r) {
    return '<span class="rule ' + (r.ok ? "ok" : "bad") + '"><span class="rule-ic">' + (r.ok ? "✓" : "✕") + "</span>" + esc(r.t) + "</span>";
  }

  function connBadge(conn) {
    const k = DB.CONN_KB[conn];
    if (!k) return "?";
    if (conn === "usbc") {
      return '<svg width="34" height="20" viewBox="0 0 36 20"><rect x="1" y="4" width="34" height="12" rx="6" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="12" y="8" width="12" height="4" rx="1.6" fill="currentColor"/></svg>';
    }
    return '<svg width="30" height="26" viewBox="0 0 30 26"><circle cx="15" cy="13" r="10.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15" cy="13" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="15" cy="13" r="2" fill="currentColor"/></svg>';
  }

  function renderPartsHtml(product) {
    let h = "";
    h += '<p class="muted small">Compatibility here is a <strong>rules engine</strong>, not AI guesswork: form factor + interface + the OEM max spec. Batteries are the exception — they are matched by exact OEM part number only.</p>';
    const P = product.parts;
    for (const key of ["ram", "ssd", "battery"]) {
      const part = P[key];
      if (!part) continue;
      h += '<div class="part-card">';
      h += '<div class="part-head"><strong>' + esc(part.title) + "</strong>";
      if (part.strict) h += '<span class="pill pill-strict">exact part # only</span>';
      h += "</div>";
      h += '<div class="part-detail">' + esc(part.detail) + "</div>";
      if (part.term) {
        const oemSource = product.sources[0];
        h += '<div class="buy-row no-print">';
        const links = buyLinksFor(part.term, key === "battery" ? oemSource.url : null, key === "battery" ? oemSource.label : null);
        for (const l of links) h += '<a class="buy-btn ' + (l.primary ? "primary" : "") + '" target="_blank" rel="noopener" href="' + esc(l.url) + '">' + linkDot(l.url) + esc(l.label) + "</a>";
        h += '<button type="button" class="btn ghost live-vendor" data-term="' + esc(part.term) + '" data-out="#vendor-part-' + esc(key) + '">Find live listings</button>';
        h += "</div>";
        h += '<div id="vendor-part-' + esc(key) + '" class="vendor-out"></div>';
      } else {
        h += '<div class="muted small">Not sold as a user part — service or config-at-purchase only.</div>';
      }
      h += "</div>";
    }
    return h;
  }

  function renderSourcesHtml(product, ctx) {
    let h = "";
    h += '<p class="muted">Provenance ledger: every spec row and every adapter claim points at the source it came from. Rows the AI or catalog could not tie to a source are marked "unverified" — they are never presented as fact.</p>';
    h += '<div class="source-list">';
    product.sources.forEach((s, i) => {
      h += sourceRow(s, i === 0);
    });
    h += "</div>";
    const allAdapters = rankedAdapters(product).fits.map((o) => o.a);
    const extra = [];
    for (const a of allAdapters) for (const s of a.sources) if (!extra.includes(s)) extra.push(s);
    if (extra.length) {
      h += '<h4 style="margin:14px 0 6px">Sources behind the matched adapters</h4><div class="source-list">';
      for (const s of extra) h += sourceRow(s, false);
      h += "</div>";
    }
    h += '<div class="verify-row no-print">';
    h += '<button class="btn" data-act="verify">Re-check every source &amp; vendor link (live HTTP)</button>';
    h += '<span class="muted small" id="verifyStatus"></span>';
    h += "</div>";
    h += '<div id="deadWarn" class="banner warn" hidden></div>';
    h += '<details class="method"><summary>How matching works (read me)</summary>';
    h += "<div class='method-body'>";
    h += "<p><strong>1 · Identify.</strong> Your text is matched against the curated catalog (brand → line → model → aliases). If several models score closely, you get a pick list instead of a guess. Unrecognized queries are routed to AI extraction, then re-matched, then — if still unknown — honestly reported as outside the catalog.</p>";
    h += "<p><strong>2 · Rules, not vibes.</strong> Adapter fit is computed: connector family + tip geometry + voltage + polarity + wattage ≥ rated demand. The LLM never decides fit.</p>";
    h += "<p><strong>3 · Part-number rule.</strong> Part numbers are only ever displayed when they appear in the cited source. The prototype catalog currently contains no unverified part numbers — you'll see 'check the OEM listing' instead.</p>";
    h += "<p><strong>4 · Shop links.</strong> Every result links to the OEM page first, then Memory Express, Amazon.ca and Shopbot.ca searches for the exact part term. All shopping links open Canadian (CAD) stores — Dell OEM store pages are normalized to dell.com/en-ca. Links are live-checked on demand: 404s are flagged as dead, and Amazon stock wording is quoted from the vendor page only.</p>";
    h += "</div></details>";
    h += '<p class="tiny">Currency &amp; links: every shopping link opens a Canadian (CAD) store — Dell OEM store pages are normalized to dell.com/en-ca. Prices are never shown or claimed: amounts exist only on the vendor pages you open. Stock/condition is only ever quoted from the vendor\\u2019s own page.</p>';
    h += '<p class="tiny">Report generated ' + fmtDate() + ' · dead-link and availability checks run live on demand (Re-check button) and are cached for the session.</p>';
    return h;
  }

  function linkDot(url) {
    const prior = state.sessionSources.get(url);
    if (!prior) return "";
    return '<span class="src-dot ' + prior.cls + '" title="' + esc(prior.label) + '"></span>';
  }

  function sourceRow(s, isPrimary) {
    const prior = state.sessionSources.get(s.url);
    const cls = prior ? prior.cls : (s.ok === true ? "ok" : s.ok === null ? "na" : "unreach");
    const title = prior ? prior.label : (s.ok === true ? "reachable at build time" : s.ok === null ? "not auto-checked — re-check to confirm live" : "unreachable at build time");
    const dot = '<span class="src-dot ' + cls + '" title="' + esc(title) + '"></span>';
    return '<a class="source' + (isPrimary ? " primary" : "") + (cls === "dead" ? " is-dead" : "") + '" target="_blank" rel="noopener" href="' + esc(s.url) + '">' + dot + "<span><strong>" + esc(s.label) + "</strong><small>" + esc(s.url) + "</small></span></a>";
  }

  function paintLinkDots(url, cls, label) {
    $$("a[href]", document).forEach((a) => {
      if (a.href !== url) return;
      let dot = a.querySelector(".src-dot");
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "src-dot " + cls;
        dot.title = label;
        a.insertBefore(dot, a.firstChild);
      } else {
        dot.className = "src-dot " + cls;
        dot.title = label;
      }
      a.classList.toggle("is-dead", cls === "dead");
    });
  }

  function paintKnownDots(scope) {
    $$("a[href]", scope).forEach((a) => {
      const prior = state.sessionSources.get(a.href);
      if (!prior) return;
      let dot = a.querySelector(".src-dot");
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "src-dot " + prior.cls;
        dot.title = prior.label;
        a.insertBefore(dot, a.firstChild);
      } else {
        dot.className = "src-dot " + prior.cls;
        dot.title = prior.label;
      }
      a.classList.toggle("is-dead", prior.cls === "dead");
    });
  }

  async function checkLink(url) {
    const prior = state.sessionSources.get(url);
    if (prior && Date.now() - prior.at < 600000) return prior;
    let cls = "unreach", label = "✗ unreachable";
    try {
      const r = await race(root.superFetch(url, { redirect: "follow" }), 15000);
      const st = r && r.status ? r.status : 0;
      const bb = BOT_BLOCK_HOSTS.includes(hostOnly(url));
      if (st >= 200 && st < 300) { cls = "ok"; label = "✓ HTTP " + st; }
      else if ((st === 404 || st === 410 || st === 451) && !bb) { cls = "dead"; label = "✕ dead — HTTP " + st + " (page removed/moved)"; }
      else if (st === 403 || st === 401 || st === 429 || st === 503 || bb) { cls = "warn"; label = "⚠ HTTP " + st + (bb ? " — vendor blocks bots (usually fine in a browser)" : " (vendor blocks bots — often still fine in a browser)"); }
      else { cls = "warn"; label = "⚠ HTTP " + st + " (unusual — open in a browser to confirm)"; }
    } catch (e) {
      cls = "unreach"; label = "✗ fetch failed — treat as down / moved";
    }
    const rec = { cls, label, at: Date.now() };
    state.sessionSources.set(url, rec);
    paintLinkDots(url, cls, label);
    return rec;
  }

  async function verifyAllLinks(product) {
    const set = new Map();
    const addUrl = (u) => { if (u) set.set(u, true); };
    for (const s of product.sources) addUrl(s.url);
    const fits = rankedAdapters(product).fits.map((o) => o.a);
    for (const a of fits) {
      for (const s of a.sources) addUrl(s.url);
      const oem = a.sources[0];
      for (const l of buyLinksFor(a.term, oem && oem.url, oem && oem.label)) addUrl(l.url);
    }
    const P = product.parts || {};
    const oem0 = product.sources[0];
    for (const key of ["ram", "ssd", "battery"]) {
      const part = P[key];
      if (!part) continue;
      for (const l of buyLinksFor(part.term, key === "battery" ? oem0.url : null, key === "battery" ? oem0.label : null)) addUrl(l.url);
    }
    const urls = [...set.keys()].slice(0, 40);
    const statusEl = $("#verifyStatus");
    const deadEl = $("#deadWarn");
    if (!statusEl) return;
    if (!window.root || !root.superFetch) { statusEl.textContent = "live checker unavailable (superFetch not loaded)"; return; }
    statusEl.textContent = "checking " + urls.length + " links (sources + vendor/part buy links) — can take ~20–40 s…";
    let done = 0;
    const results = await mapPool(urls, 3, async (u) => {
      const r = await checkLink(u);
      done++;
      statusEl.textContent = "checked " + done + "/" + urls.length + " — " + (r.cls === "ok" ? "reachable" : r.cls === "dead" ? "dead" : "needs attention");
      return r;
    });
    const pairs = urls.map((u, i) => ({ u, r: results[i] }));
    const okCount = pairs.filter((p) => p.r.cls === "ok").length;
    const warnCount = pairs.filter((p) => p.r.cls === "warn" || p.r.cls === "unreach").length;
    const deadPairs = pairs.filter((p) => p.r.cls === "dead");
    statusEl.textContent = "done — " + okCount + "/" + urls.length + " reachable · " + warnCount + " need attention · " + deadPairs.length + " dead";
    if (deadEl) {
      if (deadPairs.length) {
        deadEl.hidden = false;
        const hosts = deadPairs.map((p) => hostOnly(p.u)).filter((h, i, a) => h && a.indexOf(h) === i);
        deadEl.innerHTML = "<strong>" + deadPairs.length + " dead link" + (deadPairs.length > 1 ? "s" : "") + " (HTTP 404/gone):</strong> " + esc(hosts.join(", ")) + " — the pages were removed or moved. For a dead buy link use another vendor above or the OEM page; for a dead source, weigh it accordingly.";
      } else deadEl.hidden = true;
    }
  }

  function renderAdapterResults(matches, query) {
    state.product = null;
    state.adapterMode = true;
    const out = $("#results");
    let h = '<section class="card result-card">';
    h += '<div class="result-kicker">Adapter-family lookup</div>';
    h += "<h2>Adapters matching “" + esc(query) + "”</h2>";
    if (!matches || !matches.length) {
      h += '<p class="muted">No adapter record in the catalog matches that description yet. Try a full laptop model instead, or a photo of your tip.</p>';
      const cands = DB.ADAPTERS.filter((a) => a.conn === "usbc").slice(0, 3);
      h += '<h3 style="margin-top:12px">Common USB-C adapters (any PD laptop ≥ listed wattage)</h3>' + listAdapterCandidates(cands);
      h += "</section>";
      out.innerHTML = h;
      wireGeneric(out);
      attachVendorSearch(out);
      out.scrollIntoView({ behavior: "smooth" });
      return;
    }
    h += '<p class="muted">"65W adapter" is not one product — wattage is shared across many models with <strong>different tips</strong>. Match your tip before buying:</p>';
    h += '<div class="conn-guide">';
    for (const a of matches.slice(0, 4)) {
      const k = DB.CONN_KB[a.conn];
      h += '<div class="conn-card"><span class="conn-badge big">' + connBadge(a.conn) + "</span>";
      h += "<div><strong>" + esc(k.label) + "</strong><div class='small muted'>" + esc(k.sub || "") + "</div>";
      h += "<div class='small'>" + esc(k.detail) + "</div></div></div>";
    }
    h += "</div>";
    h += '<h3 style="margin:18px 0 8px">Catalog adapters in this family</h3>';
    h += '<div class="cand-list">' + listAdapterCandidates(matches) + "</div>";
    h += '<p class="muted small" style="margin-top:12px">Don\'t see your tip? Upload a photo of it — I can classify barrel/USB-C/MagSafe style geometry from a clear picture.</p>';
    h += "</section>";
    out.innerHTML = h;
    wireGeneric(out);
    attachVendorSearch(out);
    out.scrollIntoView({ behavior: "smooth" });
  }

  function listAdapterCandidates(list) {
    return list.map((a) => {
      const oem = a.sources[0];
      let buy = "";
      if (a.term) {
        const links = buyLinksFor(a.term, oem.url, oem.label);
        buy = '<div class="buy-row">' + links.map((l) => '<a class="buy-btn ' + (l.primary ? "primary" : "") + '" target="_blank" rel="noopener" href="' + esc(l.url) + '">' + linkDot(l.url) + esc(l.label) + "</a>").join("") +
          '<button type="button" class="btn ghost live-vendor" data-term="' + esc(a.term) + '" data-out="#vendor-cand-' + esc(a.id) + '">Find live listings</button></div>';
        buy += '<div id="vendor-cand-' + esc(a.id) + '" class="vendor-out"></div>';
      }
      return '<div class="cand"><div><strong>' + esc(a.name) + '</strong><div class="muted small">' + a.watts + "W · " + esc(a.volts) + " · " + esc(connLabel(a.conn)) + "</div></div>" + buy + "</div>";
    }).join("");
  }

  function renderAdapterResultsFromConn(conn, note) {
    const matches = DB.ADAPTERS.filter((a) => a.conn === conn);
    renderAdapterResults(matches, note || "adapters with a " + connLabel(conn) + " plug");
  }

  function renderProductFromPhoto(text, photoCtx) {
    const ident = identifyProduct(text);
    if (ident.kind === "product" && !ident.ambiguous) {
      state.product = ident.product;
      renderProduct(ident.product, { query: text, conf: Math.max(60, ident.conf), focus: ident.wantsPower ? "power" : "all", photo: photoCtx });
      return;
    }
    if (brandOf(text) && deviceish(text)) {
      renderNotFound(text, null, { wantsPower: true, note: photoCtx && photoCtx.note ? photoCtx.note + " — I couldn't match the model to the catalog, so I'm looking it up live." : "Read from your photo — I couldn't match the model to the catalog, so I'm looking it up live." });
      return;
    }
    renderAdapterResults(null, text);
  }

  function wireResultInteractions(s, product, ctx) {
    $$('[data-tab]', s).forEach((b) => b.addEventListener("click", () => {
      $$('[data-tab]', s).forEach((x) => x.classList.toggle("on", x === b));
      $$(".tab-body", s).forEach((x) => { x.hidden = x.dataset.body !== b.dataset.tab; });
    }));
    const focusTab = ctx && ctx.focus ? ctx.focus : "all";
    if (focusTab === "power") clickTab(s, "power");
    else if (focusTab === "ram" || focusTab === "ssd" || focusTab === "battery") clickTab(s, "parts");

    const acts = {
      print: () => window.print(),
      link: async () => {
        const url = location.href.split("#")[0] + "#p=" + product.id;
        toast((await copyText(url)) ? "Result link copied — it re-renders this device's card" : "copy failed", "ok");
      },
      verify: () => verifyAllLinks(product)
    };
    const ctrls = {
      md: buildReport(product, "md"),
      csv: buildReport(product, "csv"),
      txt: buildReport(product, "txt")
    };
    $$("[data-copy]", s).forEach((b) => b.addEventListener("click", async () => {
      const text = ctrls[b.dataset.copy];
      toast((await copyText(text)) ? (b.dataset.copy === "csv" ? "CSV copied" : "Markdown report copied") : "copy failed", "ok");
    }));
    $$("[data-act]", s).forEach((b) => {
      const fn = acts[b.dataset.act];
      if (fn) b.addEventListener("click", fn);
    });
  }

  function clickTab(s, name) {
    const b = s.querySelector('[data-tab="' + name + '"]');
    if (b) b.click();
  }

  function wireGeneric(scope) {
    $$("[data-copy]", scope).forEach((b) => b.addEventListener("click", async () => {
      const text = b.dataset.copy;
      toast((await copyText(text)) ? "copied" : "copy failed", "ok");
    }));
  }

  function buildReport(product, fmt) {
    const lines = [];
    const sep = fmt === "csv" ? "," : " | ";
    const head = (t) => (fmt === "md" ? "## " + t + "\n" : fmt === "csv" ? "\n" + t + "\n" : "\n== " + t + " ==\n");
    lines.push(fmt === "md" ? "# " + product.name : product.name);
    lines.push("Device: " + product.brand + " " + product.line + " " + product.model + " · power: " + product.power.watts + "W " + connLabel(product.power.conn));
    lines.push("Reported: " + fmtDate());
    lines.push("");
    lines.push(head("Specifications"));
    if (fmt === "md") lines.push("| Group | Item | Value | Source |", "|---|---|---|---|");
    if (fmt === "csv") lines.push("group,item,value,source");
    for (const r of product.specs) {
      const s = sourceFor(product, r);
      if (fmt === "md") lines.push("| " + [r.g, r.l, r.v, "[" + s.label + "](" + s.url + ")"].map(escMd).join(" | ") + " |");
      else if (fmt === "csv") lines.push(csvCell(r.g) + "," + csvCell(r.l) + "," + csvCell(r.v) + "," + csvCell(s.url));
      else lines.push(sep + [r.l, r.v, s.url].join(" — "));
    }
    const { fits } = rankedAdapters(product);
    lines.push("");
    lines.push(head("Compatible power adapters"));
    for (const o of fits) {
      const a = o.a;
      const why = o.rules.filter((r) => r.ok).map((r) => r.t).join("; ");
      if (fmt === "md") lines.push("- **" + a.name + "** (" + a.watts + "W " + connLabel(a.conn) + ") — " + why);
      else if (fmt === "csv") lines.push(csvCell(a.name) + "," + a.watts + "," + csvCell(connLabel(a.conn)) + "," + csvCell(why));
      else lines.push("• " + a.name + " — " + a.watts + "W " + connLabel(a.conn) + " (" + why + ")");
    }
    if (product.parts) {
      lines.push("");
      lines.push(head("Compatible parts"));
      if (fmt === "md") lines.push("| Category | Detail |", "|---|---|");
      if (fmt === "csv") lines.push("part,detail");
      for (const k of ["ram", "ssd", "battery"]) {
        const p = product.parts[k];
        if (!p) continue;
        if (fmt === "md") lines.push("| " + escMd(p.title) + " | " + escMd(p.detail) + " |");
        else if (fmt === "csv") lines.push(csvCell(p.title) + "," + csvCell(p.detail));
        else lines.push("• " + p.title + ": " + p.detail);
      }
    }
    lines.push("");
    lines.push(head("Sources"));
    for (const s of product.sources) lines.push("- " + s.label + ": " + s.url);
    lines.push("");
    lines.push("Notes: part numbers only from cited sources; fit computed by deterministic rules; verify price/stock at the vendor. Generated " + fmtDate() + ".");
    return lines.join("\n");
  }

  const escMd = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const csvCell = (s) => '"' + String(s).replace(/"/g, '""') + '"';

  async function runVision(file) {
    if (!window.root || !root.generateText) {
      alert("The AI photo reader isn't available yet (plugin still loading). Please type the model instead.");
      return;
    }
    $("#results").innerHTML = "";
    showBusy("Reading photo…");
    stepBusy("Extracting text from the label / measuring the connector…");
    const instruction = [
      "You read hardware photos for a tech-finder tool. The photo shows a laptop spec label, a charger label, or a power connector (barrel tip / USB-C port).",
      "Extract ONLY what you can actually see. Do not invent characters. If something is blurry, say so in ocr_text and set confidence low.",
      "Respond with ONLY one JSON object, no markdown fences. All fields required; use null when unknown.",
      "{\"kind\": \"spec-label|connector|laptop-port|other\", \"ocr_text\": \"the raw readable text, verbatim lines separated by \\n\", \"brand\": null, \"model\": \"e.g. Latitude 5420 or E6420\", \"wattage\": null, \"voltage\": null, \"amps\": null, \"part_number\": null, \"connector\": \"usb-c|dell-7.4mm-barrel|hp-4.5mm-blue-barrel|lenovo-slim-barrel|round-barrel-other|magsafe|unknown\", \"connector_measurement_note\": \"anything printed or inferable about tip size, e.g. 7.4mm\", \"confidence\": \"high|medium|low\", \"reason\": \"why confidence is high/medium/low\"}",
      "For a BARREL TIP photo: say whether it is hollow with a center pin (barrel) vs flat USB-C; note any printed number; a label photo showing '7.4mm' or '19.5V 3.34A' is the most reliable — read it exactly.",
      "TASK: analyze this photo."
    ].join("\n\n");
    try {
      const res = await root.generateText({ instruction: [instruction, file] });
      hideBusy();
      const raw = String(res && res.text ? res.text : "");
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) { renderVisionFail(file); return; }
      let f;
      try { f = JSON.parse(m[0]); } catch (e) { renderVisionFail(file); return; }
      renderVisionResult(f, file);
    } catch (e) {
      hideBusy();
      renderVisionFail(file, e && e.message ? e.message : "");
    }
  }

  function renderVisionResult(f, file) {
    const out = $("#results");
    const modelText = [f.brand, f.model].filter(Boolean).join(" ");
    const lowConf = f.confidence === "low" || (f.confidence === "medium" && !f.model && !f.connector);
    if (lowConf || !f.ocr_text) {
      let h = '<section class="card result-card">';
      h += '<div class="banner warn">The photo reader is not confident — show it to you instead of guessing. (OCR-vs-LLM cross-check: digits like 65W vs 85W need a confirm step.)</div>';
      h += "<h2>What the photo reader saw</h2>";
      h += '<div class="ocr-box">' + esc(f.ocr_text || "(no text readable)") + "</div>";
      h += '<div class="ocr-note muted">' + esc(f.reason || "") + "</div>";
      h += '<h4>Confirm the model to continue</h4>';
      h += '<div class="confirm-row"><input id="confBrand" placeholder="Brand (e.g. Dell)" value="' + esc(f.brand || "") + '"><input id="confModel" placeholder="Model (e.g. Latitude 5420)" value="' + esc(f.model || "") + '"></div>';
      h += '<div class="result-actions"><button class="btn primary" id="confGo">Search that model</button><button class="btn ghost" id="confConn">Only a connector — show me adapters</button></div>';
      h += "</section>";
      out.innerHTML = h;
      const go = () => {
        const b = $("#confBrand").value.trim(), mo = $("#confModel").value.trim();
        if (mo) { searchText((b ? b + " " : "") + mo); }
      };
      $("#confGo").addEventListener("click", go);
      $("#confConn").addEventListener("click", () => renderAdapterResults(null, "connector"));
      out.scrollIntoView({ behavior: "smooth" });
      return;
    }

    const note = "Read from your photo · confidence " + esc(f.confidence || "medium");
    if (f.kind === "connector" || (!modelText && f.connector)) {
      const map = { "usb-c": "usbc", "dell-7.4mm-barrel": "dell74", "hp-4.5mm-blue-barrel": "hpSmart", "lenovo-slim-barrel": "lenovoSlim" };
      const conn = map[f.connector];
      if (conn) {
        let h = '<section class="card result-card">';
        h += '<div class="banner">' + note + (f.connector_measurement_note ? " · " + esc(f.connector_measurement_note) : "") + "</div>";
        h += '<div class="result-kicker">Connector identified from photo</div>';
        h += "<h2>Your plug looks like: " + esc(DB.CONN_KB[conn].label) + "</h2>";
        h += '<p class="muted">' + esc(DB.CONN_KB[conn].detail) + "</p>";
        h += '<div class="cand-list">';
        const fam = DB.PROD.filter((p) => p.power.conn === conn);
        h += "<div>Compatible catalog devices with this jack: <strong>" + (fam.length ? fam.map((p) => p.name).join(", ") : "none in catalog yet") + "</strong></div>";
        h += "</div>";
        h += '<div class="result-actions"><button class="btn primary" id="connAdapters">Show matching adapters</button><button class="btn ghost" id="connDevice">I know the laptop model</button></div>';
        h += "</section>";
        out.innerHTML = h;
        $("#connAdapters").addEventListener("click", () => renderAdapterResultsFromConn(conn, DB.CONN_KB[conn].label + " plug"));
        $("#connDevice").addEventListener("click", () => { $("#queryInput").focus(); });
        out.scrollIntoView({ behavior: "smooth" });
        return;
      }
    }
    if (modelText) {
      renderProductFromPhoto(modelText, { note, photo: true });
      return;
    }
    renderVisionFail(file, "No model or connector could be read.");
  }

  function renderVisionFail(file, msg) {
    const out = $("#results");
    out.innerHTML = '<section class="card result-card"><div class="banner warn">Photo reading failed' + (msg ? " — " + esc(msg) : "") + "</div><p class='muted'>Try a sharper photo, or just type the model — the catalog lookup doesn't need AI.</p></section>";
  }

  async function verifyRun() {
    if (state.product) await verifyAllLinks(state.product);
  }

  function bootFromHash() {
    const m = location.hash.match(/p=([a-z0-9-]+)/);
    if (!m) return false;
    const p = DB.PROD.find((x) => x.id === m[1]);
    if (!p) return false;
    state.product = p;
    renderProduct(p, { query: p.name, conf: 100, focus: "all" });
    return true;
  }

  function wireHome() {
    const input = $("#queryInput");
    const go = () => searchText(input.value);
    $("#searchBtn").addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const chips = $("#chips");
    for (const c of SUGGESTIONS) {
      const b = document.createElement("button");
      b.className = "chipbtn";
      b.textContent = c;
      b.addEventListener("click", () => {
        if (c.startsWith("Photo")) { $("#fileBtn").click(); return; }
        input.value = c;
        searchText(c);
      });
      chips.appendChild(b);
    }
    const fileBtn = $("#fileBtn"), fileInput = $("#fileInput");
    fileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) { previewAndRead(f); }
    });
    document.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) { previewAndRead(f); break; }
        }
      }
    });
    $("#photoZone").addEventListener("click", () => fileInput.click());
  }

  function previewAndRead(file) {
    const img = $("#photoPreview");
    const zone = $("#photoZone");
    img.src = URL.createObjectURL(file);
    zone.classList.add("has-img");
    $("#photoZoneLabel").textContent = "Photo loaded — reading…";
    runVision(file);
  }

  function init() {
    wireHome();
    $("#busy").hidden = true;
    if (!bootFromHash()) {
      $("#results").innerHTML = renderIdleHint();
    }
  }

  function renderIdleHint() {
    let h = '<section class="card result-card idle">';
    h += '<div class="result-kicker">How this prototype stays honest</div>';
    h += "<h2>Cited specs. Rules-based fit. No invented part numbers.</h2>";
    h += '<div class="idle-grid">';
    const items = [
      ["Catalog-first", "10 curated laptop models (Dell · HP · Lenovo · Apple). Typed queries match deterministically — the LLM only helps when the catalog can't."],
      ["Every claim sourced", "Spec rows link to the OEM page they came from. Values not confirmed at build time are visibly marked “unverified”."],
      ["Adapters by rules", "Connector + tip geometry + voltage + wattage must all pass before an adapter is shown as compatible."],
      ["Photos, honestly", "Upload a spec label or barrel tip. The vision model reads it; low-confidence reads force a confirm step instead of a guess."]
    ];
    for (const [t, d] of items) h += "<div><strong>" + esc(t) + "</strong><p class='muted'>" + esc(d) + "</p></div>";
    h += "</div>";
    h += "</section>";
    return h;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
