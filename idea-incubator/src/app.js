/* ====================================================================
   IDEA INCUBATOR — application logic
   Reads the `config` list from main.pjs, renders the page from it,
   and drives the whole workbench: idea → research → interview →
   compare → blueprint. The settings ⚙ panel lets the user re-theme,
   scan a website for colors, edit copy, and import/export the config.
   ==================================================================== */

(() => {
  "use strict";

  const el = (id) => document.getElementById(id);
  const KEY_CFG = "if_config_v1";
  const KEY_PROJ = "if_project_v1";

  const FONT_STACKS = {
    lato: "'Lato', system-ui, sans-serif",
    inter: "'Inter', system-ui, sans-serif",
    roboto: "'Roboto', system-ui, sans-serif",
    "open-sans": "'Open Sans', system-ui, sans-serif",
    "source-sans": "'Source Sans 3', system-ui, sans-serif",
    "ibm-plex": "'IBM Plex Sans', system-ui, sans-serif",
    "dm-sans": "'DM Sans', system-ui, sans-serif",
    manrope: "'Manrope', system-ui, sans-serif",
    "montserrat-lato": "'Montserrat', 'Lato', system-ui, sans-serif",
    "playfair-lato": "'Playfair Display', 'Lato', system-ui, sans-serif",
    "merriweather-inter": "'Merriweather', 'Inter', system-ui, sans-serif",
  };
  const FONT_NAMES = {
    lato: "Lato", inter: "Inter", roboto: "Roboto", "open-sans": "Open Sans",
    "source-sans": "Source Sans 3", "ibm-plex": "IBM Plex Sans", "dm-sans": "DM Sans",
    manrope: "Manrope", "montserrat-lato": "Montserrat + Lato",
    "playfair-lato": "Playfair Display + Lato", "merriweather-inter": "Merriweather + Inter",
  };

  const DEFAULT_RESEARCH_AREAS = [
    "what the idea is",
    "the real problem & who feels it",
    "the landscape & adjacent solutions",
    "target audience & willingness to pay",
    "key assumptions",
    "biggest risks & open questions",
    "what to validate first",
  ];

  const FALLBACK_INTERVIEWERS = [
    { name: "Maya Chen", role: "Venture partner", focus: "Market size, business model, defensibility, team", avatar: "MC" },
    { name: "Theo Rivera", role: "Target customer", focus: "Real pain, how they solve it today, willingness to pay", avatar: "TR" },
    { name: "Dr. Amara Osei", role: "Domain expert", focus: "Technical and industry feasibility, blind spots", avatar: "AO" },
    { name: "Sam Novak", role: "Critical friend", focus: "Logical holes, weak assumptions, contrarian angles", avatar: "SN" },
  ];

  const RESEARCHER_PERSONA = "You are the Research Analyst on the \"Idea Incubator\" team — a precise, evidence-first product researcher. You write tight, concrete, plain-language research briefs in Markdown using ## headings and short bullets. You never invent data: where numbers or facts are unknown you say so plainly.";
  const STRATEGIST_PERSONA = "You are the Competitive Strategist on the \"Idea Incubator\" team — a sharp analyst of markets and rivals. You write concise Markdown with ## headings and bullets. You are specific: you name real categories and real companies, and you always land on a clear, defensible gap for the founder's idea.";
  const PRODUCT_PERSONA = "You are the Head of Product on the \"Idea Incubator\" team — a rigorous operator who turns fuzzy ideas into crisp, testable concepts. You write polished, decisive Markdown with ## headings. You are concrete, never generic, and you always end on an actionable 30-day plan.";
  const PANEL_PERSONA = "You are one member of the \"Idea Incubator\" interviewer panel, pressure-testing a founder's idea. You are sharp but fair, you ask ONE focused question at a time, and you never lecture — you probe.";
  const ADVISOR_PERSONA = "You are the strategy advisor inside \"Idea Incubator\" — an experienced product strategist, investor and coach all at once. You know everything the founder has done in this session. You answer helpfully, concretely and briefly, and you always land on a next action.";

  let cfg = null;
  let activeSection = "idea";
  let currentGen = null;
  let askCounts = {};
  let aiBusy = false;

  const proj = {
    idea: { text: "", problem: "", audience: "", title: "" },
    research: { content: "", done: false },
    interview: { panel: [], rounds: 7, chat: [], debrief: "", done: false },
    compare: { cards: [], content: "", done: false },
    blueprint: { content: "", done: false },
  };

  function ev(v) {
    if (v == null) return v;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v.evaluateItem === "function") return v.evaluateItem;
    return v;
  }

  function toArray(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v.selectAll === "function") return v.selectAll.map((n) => ev(n));
    if (v && typeof v.evaluateItem === "function") { const e = v.evaluateItem; return Array.isArray(e) ? e : [e]; }
    if (v == null) return [];
    return [v];
  }

  function deepMerge(base, over) {
    if (over == null) return base;
    if (Array.isArray(base) || Array.isArray(over)) return over;
    if (typeof base === "object" && base !== null && typeof over === "object" && over !== null) {
      const out = { ...base };
      for (const k of Object.keys(over)) out[k] = k in out ? deepMerge(out[k], over[k]) : over[k];
      return out;
    }
    return over;
  }

  function readDefaults() {
    let interviewers = FALLBACK_INTERVIEWERS;
    try {
      const nodes = root.config.interviewers.selectAll;
      const mapped = nodes.map((n) => ({ name: ev(n.name), role: ev(n.role), focus: ev(n.focus), avatar: ev(n.avatar) })).filter((p) => p.name);
      if (mapped.length) interviewers = mapped;
    } catch (e) {}
    const areas = toArray(ev(root.config.researchAreas)).filter(Boolean);
    const c = root.config;
    return {
      schemaVersion: ev(c.schemaVersion) || "1.1.0",
      branding: {
        companyName: ev(c.branding.companyName) || "",
        companyShortName: ev(c.branding.companyShortName) || "",
        logoGlyph: ev(c.branding.logoGlyph) || "",
        tagline: ev(c.branding.tagline) || "",
        footerText: ev(c.branding.footerText) || "",
      },
      theme: {
        mode: ev(c.theme.mode) || "light",
        accentStyle: ev(c.theme.accentStyle) || "gradient",
        radius: ev(c.theme.radius) ?? 16,
        fontSize: ev(c.theme.fontSize) ?? 16,
        fontFamily: ev(c.theme.fontFamily) || "lato",
        reduceMotion: ev(c.theme.reduceMotion) === true,
      },
      colors: {
        primary: ev(c.colors.primary) || "#7c3aed",
        secondary: ev(c.colors.secondary) || "#a78bfa",
        accent: ev(c.colors.accent) || "#4c1d95",
        background: ev(c.colors.background) || "#f7f5fc",
        surface: ev(c.colors.surface) || "#ffffff",
        text: ev(c.colors.text) || "#221c35",
        textMuted: ev(c.colors.textMuted) || "#6b7280",
      },
      product: {
        name: ev(c.product.name) || "",
        badge: ev(c.product.badge) || "",
        headline: ev(c.product.headline) || "",
        headlineAccent: ev(c.product.headlineAccent) || "",
        subheadline: ev(c.product.subheadline) || "",
        primaryCta: ev(c.product.primaryCta) || "",
        primaryCtaUrl: ev(c.product.primaryCtaUrl) || "#idea",
        secondaryCta: ev(c.product.secondaryCta) || "",
        secondaryCtaUrl: ev(c.product.secondaryCtaUrl) || "#how",
        status: ev(c.product.status) || "",
      },
      copy: {
        heroEyebrow: ev(c.copy.heroEyebrow) || "",
        howEyebrow: ev(c.copy.howEyebrow) || "",
        howTitle: ev(c.copy.howTitle) || "",
        howLede: ev(c.copy.howLede) || "",
        ideaEyebrow: ev(c.copy.ideaEyebrow) || "",
        ideaTitle: ev(c.copy.ideaTitle) || "",
        ideaLede: ev(c.copy.ideaLede) || "",
        ideaProblemLabel: ev(c.copy.ideaProblemLabel) || "",
        ideaAudienceLabel: ev(c.copy.ideaAudienceLabel) || "",
        ideaTitleLabel: ev(c.copy.ideaTitleLabel) || "",
        ideaStartBtn: ev(c.copy.ideaStartBtn) || "",
        researchEyebrow: ev(c.copy.researchEyebrow) || "",
        researchTitle: ev(c.copy.researchTitle) || "",
        researchLede: ev(c.copy.researchLede) || "",
        researchRunBtn: ev(c.copy.researchRunBtn) || "",
        interviewEyebrow: ev(c.copy.interviewEyebrow) || "",
        interviewTitle: ev(c.copy.interviewTitle) || "",
        interviewLede: ev(c.copy.interviewLede) || "",
        interviewPanelLabel: ev(c.copy.interviewPanelLabel) || "",
        interviewRoundsLabel: ev(c.copy.interviewRoundsLabel) || "",
        interviewStartBtn: ev(c.copy.interviewStartBtn) || "",
        interviewAnswerBtn: ev(c.copy.interviewAnswerBtn) || "",
        interviewEndBtn: ev(c.copy.interviewEndBtn) || "",
        compareEyebrow: ev(c.copy.compareEyebrow) || "",
        compareTitle: ev(c.copy.compareTitle) || "",
        compareLede: ev(c.copy.compareLede) || "",
        compareRunBtn: ev(c.copy.compareRunBtn) || "",
        blueprintEyebrow: ev(c.copy.blueprintEyebrow) || "",
        blueprintTitle: ev(c.copy.blueprintTitle) || "",
        blueprintLede: ev(c.copy.blueprintLede) || "",
        blueprintRunBtn: ev(c.copy.blueprintRunBtn) || "",
        blueprintNote: ev(c.copy.blueprintNote) || "",
      },
      researchAreas: areas.length ? areas : DEFAULT_RESEARCH_AREAS,
      interviewers,
      admin: { showSettingsButton: ev(c.admin.showSettingsButton) !== false },
    };
  }

  function loadCfg() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY_CFG) || "null"); } catch (e) {}
    const defaults = readDefaults();
    if (saved && saved.schemaVersion && saved.schemaVersion !== defaults.schemaVersion) saved = null;
    let out = deepMerge(defaults, saved);
    const hash = (location.hash || "").match(/^#cfg=([A-Za-z0-9_-]+)$/);
    if (hash) {
      try { out = deepMerge(defaults, JSON.parse(b64uDecode(hash[1]))); } catch (e) {}
    }
    return out;
  }

  function saveCfg() {
    try { localStorage.setItem(KEY_CFG, JSON.stringify(cfg)); } catch (e) {}
    el("dirtyHint").style.visibility = "hidden";
  }

  function saveProj() {
    try { localStorage.setItem(KEY_PROJ, JSON.stringify(proj)); } catch (e) {}
  }

  function getCfg(path) {
    let o = cfg;
    for (const k of path.split(".")) o = o == null ? undefined : o[k];
    return o;
  }

  function setCfg(path, value) {
    const keys = path.split(".");
    let o = cfg;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
    o[keys[keys.length - 1]] = value;
    markDirty();
  }

  function markDirty() {
    el("dirtyHint").style.visibility = "visible";
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function toast(msg, type) {
    const t = document.createElement("div");
    t.className = "toast" + (type === "error" ? " error" : "");
    t.textContent = msg;
    el("toastCtn").appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
  }

  function download(filename, text, mime = "text/plain") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); return true; } catch (e2) { return false; }
      finally { ta.remove(); }
    }
  }

  function b64uEncode(s) {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64uDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }

  function md(src) {
    const escT = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (t) => t
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const lines = String(src || "").split("\n");
    const out = [];
    let listType = null;
    const closeList = () => { if (listType) { out.push("</" + listType + ">"); listType = null; } };
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (/^```/.test(t)) {
        closeList();
        const code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i++; }
        out.push("<pre><code>" + escT(code.join("\n")) + "</code></pre>");
        i++;
        continue;
      }
      if (!t) { closeList(); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { closeList(); out.push("<hr>"); i++; continue; }
      const h = t.match(/^(#{1,3})\s+(.*)$/);
      if (h) { closeList(); const lvl = h[1].length; out.push("<h" + lvl + ">" + inline(escT(h[2])) + "</h" + lvl + ">"); i++; continue; }
      const bq = t.match(/^>\s?(.*)$/);
      if (bq) { closeList(); out.push("<blockquote>" + inline(escT(bq[1])) + "</blockquote>"); i++; continue; }
      const ul = t.match(/^[-*+]\s+(.*)$/);
      const ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        const type = ul ? "ul" : "ol";
        if (listType !== type) { closeList(); listType = type; out.push("<" + type + ">"); }
        out.push("<li>" + inline(escT(ul ? ul[1] : ol[1])) + "</li>");
        i++;
        continue;
      }
      closeList();
      out.push("<p>" + inline(escT(t)) + "</p>");
      i++;
    }
    closeList();
    return out.join("\n");
  }

  function genText(opts) {
    return new Promise((resolve) => {
      if (!root.generateText) { resolve(""); return; }
      let full = "";
      let settled = false;
      const fin = () => { if (settled) return; settled = true; resolve(full); };
      let p;
      try {
        p = root.generateText({
          instruction: opts.instruction,
          startWith: opts.startWith,
          stopSequences: opts.stopSequences,
          onChunk: (d) => { full += (d && d.textChunk) || ""; if (opts.onChunk) opts.onChunk(full); },
        });
      } catch (e) { fin(); return; }
      p.then(fin, fin);
      if (opts.signal) opts.signal.onStop = () => { try { if (p && p.stop) p.stop(); } catch (e) {} };
      setTimeout(fin, 120000);
    });
  }

  function stopCurrent() {
    if (currentGen && currentGen.signal) {
      currentGen.signal.stopped = true;
      try { if (currentGen.signal.onStop) currentGen.signal.onStop(); } catch (e) {}
    }
  }

  function setRunBusy(btn, statusEl, busy, msg) {
    btn.dataset.busy = busy ? "1" : "0";
    if (busy) {
      if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span> Stop';
      statusEl.classList.add("busy");
      statusEl.innerHTML = '<span class="spinner"></span> ' + esc(msg);
    } else {
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
      statusEl.classList.remove("busy");
      statusEl.textContent = "";
    }
  }

  async function runStreamingModule(opts) {
    const signal = { stopped: false, onStop: null };
    currentGen = { signal };
    setRunBusy(opts.btn, opts.statusEl, true, opts.busyMsg || "Working…");
    const contentEl = opts.contentEl;
    const caret = document.createElement("span");
    caret.className = "stream-caret";
    let renderTimer = null;
    let lastRaw = "";
    const scheduleRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => {
        renderTimer = null;
        contentEl.innerHTML = md((opts.seed || "") + lastRaw);
        contentEl.appendChild(caret);
      }, 60);
    };
    const raw = await genText({
      instruction: opts.instruction,
      onChunk: (f) => { lastRaw = f; scheduleRender(); },
      signal,
    });
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    const full = (opts.seed || "") + (raw || lastRaw);
    contentEl.innerHTML = md(full);
    if (currentGen && currentGen.signal === signal) currentGen = null;
    setRunBusy(opts.btn, opts.statusEl, false, "");
    return { full, stopped: signal.stopped };
  }

  function ideaBrief() {
    const i = proj.idea;
    const parts = [];
    if (i.title.trim()) parts.push("Working name: " + i.title.trim());
    if (i.text.trim()) parts.push("The idea: " + i.text.trim());
    if (i.problem.trim()) parts.push("Problem it solves: " + i.problem.trim());
    if (i.audience.trim()) parts.push("Target audience: " + i.audience.trim());
    return parts.join("\n");
  }

  function hasIdea() {
    return !!proj.idea.text.trim();
  }

  function requireIdea() {
    if (hasIdea()) return true;
    toast("Write your idea in Step 1 first.", "error");
    document.getElementById("idea").scrollIntoView({ behavior: "smooth" });
    return false;
  }

  /* ── theme & branding ────────────────────────────────────────────── */

  function applyTheme() {
    const c = cfg.colors;
    const th = cfg.theme;
    const r = document.documentElement;
    r.style.setProperty("--primary", c.primary);
    r.style.setProperty("--secondary", c.secondary);
    r.style.setProperty("--accent", c.accent);
    r.style.setProperty("--background", c.background);
    r.style.setProperty("--surface", c.surface);
    r.style.setProperty("--text", c.text);
    r.style.setProperty("--text-muted", c.textMuted);
    r.style.setProperty("--border", "color-mix(in srgb, " + c.text + " 15%, transparent)");
    r.style.setProperty("--border-strong", "color-mix(in srgb, " + c.text + " 28%, transparent)");
    r.style.setProperty("--radius", Number(th.radius) + "px");
    r.style.setProperty("--font-size", Number(th.fontSize) + "px");
    r.style.setProperty("--font-family", FONT_STACKS[th.fontFamily] || FONT_STACKS.lato);
    if (th.accentStyle === "solid") {
      r.style.setProperty("--accent-gradient", "linear-gradient(135deg, " + c.primary + ", " + c.primary + ")");
    } else {
      r.style.setProperty("--accent-gradient", "linear-gradient(135deg, " + c.primary + ", " + c.secondary + ")");
    }
    r.setAttribute("data-theme", th.mode);
    r.setAttribute("data-motion", th.reduceMotion ? "off" : "on");
    el("themeToggleIcon").textContent = th.mode === "dark" ? "☀" : "☾";
  }

  function toggleTheme() {
    cfg.theme.mode = cfg.theme.mode === "dark" ? "light" : "dark";
    applyTheme();
    saveCfg();
    syncThemeFields();
  }

  function renderBranding() {
    const b = cfg.branding;
    const glyph = b.logoGlyph || (b.companyShortName || b.companyName || "I").charAt(0).toUpperCase();
    el("logoMark").textContent = glyph;
    el("logoText").textContent = b.companyName || "Idea Incubator";
    el("footerLogoMark").textContent = glyph;
    el("footerLogoText").textContent = b.companyName || "Idea Incubator";
    el("footerTagline").textContent = b.tagline || "";
    el("yearEl").textContent = (b.footerText || "")
      .replace("{year}", new Date().getFullYear())
      .replace("{companyName}", b.companyName || "Idea Incubator");
  }

  function renderCopy() {
    document.querySelectorAll("[data-field]").forEach((node) => {
      const v = getCfg(node.dataset.field);
      if (v != null) node.textContent = v;
    });
  }

  function renderHero() {
    const p = cfg.product;
    const h = p.headline || "Turn a rough idea into a sharp one.";
    const acc = p.headlineAccent || "";
    let html = esc(h);
    if (acc && h.indexOf(acc) !== -1) {
      html = esc(h.replace(acc, "")) + '<span class="accent">' + esc(acc) + "</span>";
    }
    el("heroTitle").innerHTML = html;
    el("heroSub").textContent = p.subheadline || "";
    el("heroStatus").style.display = p.status ? "" : "none";
  }

  function renderSteps() {
    const steps = [
      { n: 1, title: "Research", text: "The incubator studies your idea — the problem, the landscape, the audience and the assumptions it rests on." },
      { n: 2, title: "Interview", text: "A panel of fierce interviewers grills you one question at a time until your story holds up." },
      { n: 3, title: "Compare", text: "A strategist maps the field, names the rivals, and finds the whitespace you can own." },
      { n: 4, title: "Blueprint", text: "Every lesson is distilled into one sharp, polished concept you can act on." },
    ];
    el("stepsWrap").innerHTML = steps.map((s) =>
      '<div class="step"><span class="step-num">' + s.n + '</span><h3>' + s.title + "</h3><p>" + s.text + "</p></div>"
    ).join("");
  }

  const SECTIONS = ["idea", "research", "interview", "compare", "blueprint"];
  const SECTION_LABELS = { idea: "Idea", research: "Research", interview: "Interview", compare: "Compare", blueprint: "Blueprint" };
  const SECTION_SUBS = { idea: "Your idea", research: "Brief", interview: "Panel", compare: "Landscape", blueprint: "Refined" };

  function doneFlags() {
    return {
      idea: !!proj.idea.text.trim(),
      research: proj.research.done && !!proj.research.content,
      interview: proj.interview.done && !!proj.interview.debrief,
      compare: proj.compare.done && !!proj.compare.content,
      blueprint: proj.blueprint.done && !!proj.blueprint.content,
    };
  }

  function renderStepper() {
    const done = doneFlags();
    el("stepper").innerHTML = SECTIONS.map((sec, idx) =>
      '<button class="step-node' + (done[sec] ? " done" : "") + (activeSection === sec ? " active" : "") + '" data-target="' + sec + '" role="tab">' +
        '<span class="sn-ico">' + (done[sec] ? "✓" : idx + 1) + "</span>" +
        '<span class="sn-label">' + SECTION_LABELS[sec] + '</span><span class="sn-sub">' + SECTION_SUBS[sec] + "</span>" +
      "</button>"
    ).join("");
    el("stepper").querySelectorAll(".step-node").forEach((n) => {
      n.addEventListener("click", () => document.getElementById(n.dataset.target).scrollIntoView({ behavior: "smooth" }));
    });
    updateHint();
  }

  function updateHint() {
    const done = doneFlags();
    let hint = "";
    if (!done.idea) hint = "Step 1 — write your idea, then press “Into the incubator →”.";
    else if (!done.research) hint = "Next — run the research brief in Step 2.";
    else if (!done.interview) hint = "Next — run the interviewer panel in Step 3.";
    else if (!done.compare) hint = "Next — map the competitive landscape in Step 4.";
    else if (!done.blueprint) hint = "Everything is ready — hatch your blueprint in Step 5.";
    else hint = "All five steps complete. Export your blueprint or the full JSON backup from Step 5.";
    el("pipelineHint").textContent = hint;
  }

  function onScroll() {
    const y = window.scrollY;
    const total = document.documentElement.scrollHeight - window.innerHeight;
    el("progressBar").style.width = (total > 0 ? (y / total) * 100 : 0) + "%";
    let cur = "idea";
    for (const sec of SECTIONS) {
      const node = document.getElementById(sec);
      if (node && node.getBoundingClientRect().top <= window.innerHeight * 0.35) cur = sec;
    }
    if (activeSection !== cur) {
      activeSection = cur;
      const nodes = el("stepper").querySelectorAll(".step-node");
      nodes.forEach((n) => n.classList.toggle("active", n.dataset.target === cur));
    }
  }

  /* ── idea step ───────────────────────────────────────────────────── */

  let saveTimer = null;
  function onIdeaInput() {
    proj.idea.text = el("ideaTextarea").value;
    proj.idea.problem = el("ideaProblemInput").value;
    proj.idea.audience = el("ideaAudienceInput").value;
    proj.idea.title = el("ideaTitleInput").value;
    const hint = el("ideaSavedHint");
    hint.textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveProj();
      hint.textContent = "Idea is saved automatically in this browser.";
      renderStepper();
    }, 400);
  }

  function clearProject() {
    for (const k of Object.keys(proj)) {
      if (k === "idea") proj.idea = { text: "", problem: "", audience: "", title: "" };
      else if (k === "research") proj.research = { content: "", done: false };
      else if (k === "interview") proj.interview = { panel: [], rounds: proj.interview.rounds || 7, chat: [], debrief: "", done: false };
      else if (k === "compare") proj.compare = { cards: [], content: "", done: false };
      else if (k === "blueprint") proj.blueprint = { content: "", done: false };
    }
    localStorage.removeItem(KEY_PROJ);
    el("ideaTextarea").value = ""; el("ideaProblemInput").value = ""; el("ideaAudienceInput").value = ""; el("ideaTitleInput").value = "";
    el("ideaSavedHint").textContent = "Idea is saved automatically in this browser.";
    el("researchCtn").hidden = true; el("researchBody").innerHTML = "";
    el("interviewSetup").hidden = false; el("interviewLive").hidden = true; el("interviewDebriefCtn").hidden = true;
    el("interviewChat").innerHTML = ""; el("interviewDebrief").innerHTML = ""; el("interviewStatus").textContent = "";
    el("compareCtn").hidden = true; el("compareCards").innerHTML = ""; el("compareBody").innerHTML = "";
    el("blueprintCtn").hidden = true; el("blueprintBody").innerHTML = "";
    el("researchDigInput").value = ""; el("researchDigBtn").disabled = true;
    el("compareDigInput").value = ""; el("compareDigBtn").disabled = true;
    activeSection = "idea";
    renderStepper();
    toast("Started fresh — your project was cleared.");
  }

  /* ── research ────────────────────────────────────────────────────── */

  async function runResearch(dig) {
    if (!requireIdea()) return;
    const researchCtn = el("researchCtn");
    const researchBody = el("researchBody");
    researchCtn.hidden = false;
    const areas = (cfg.researchAreas && cfg.researchAreas.length ? cfg.researchAreas : DEFAULT_RESEARCH_AREAS)
      .map((a, i) => (i + 1) + ". " + a).join("\n");
    let instruction = RESEARCHER_PERSONA + "\n\nTASK: Produce a deep-dive research brief for the idea below. Cover, in order:\n" + areas + "\n\nUse ## headings and short bullets. Aim for 450-650 words. Do not invent facts or numbers; where something is unknown, say \"unknown\". End with a \"### TL;DR\" of 3 bullets.\n\nTHE IDEA:\n" + ideaBrief();
    let seed = "";
    if (dig) {
      seed = proj.research.content ? proj.research.content.trimEnd() + "\n\n---\n\n### Follow-up: " + dig.trim() + "\n\n" : "";
      instruction += "\n\nFOLLOW-UP QUESTION FROM THE FOUNDER:\n" + dig.trim();
    }
    const res = await runStreamingModule({
      btn: el("researchRunBtn"),
      statusEl: el("researchStatus"),
      contentEl: researchBody,
      instruction,
      seed,
      busyMsg: "Researching…",
    });
    if (dig ? true : res.full.trim()) {
      proj.research.content = res.full;
      proj.research.done = true;
      el("researchDigBtn").disabled = false;
      el("researchDigInput").value = "";
      saveProj();
      renderStepper();
    }
    if (!res.full && !seed) toast("Research didn't return anything — try again.", "error");
  }

  /* ── interview ───────────────────────────────────────────────────── */

  function panelists() {
    return cfg.interviewers && cfg.interviewers.length ? cfg.interviewers : FALLBACK_INTERVIEWERS;
  }

  function renderInterviewPanel() {
    const wrap = el("interviewPanel");
    if (!proj.interview.panel.length) proj.interview.panel = panelists().map((p) => p.name);
    wrap.innerHTML = panelists().map((p) =>
      '<button class="chip' + (proj.interview.panel.indexOf(p.name) !== -1 ? " on" : "") + '" data-name="' + esc(p.name) + '" type="button">' +
      esc(p.name) + '<span class="chip-role" style="font-weight:600;opacity:.7;font-size:11.5px"> · ' + esc(p.role) + "</span></button>"
    ).join("");
    wrap.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const name = chip.dataset.name;
        const idx = proj.interview.panel.indexOf(name);
        if (idx !== -1) { if (proj.interview.panel.length > 1) proj.interview.panel.splice(idx, 1); }
        else proj.interview.panel.push(name);
        renderInterviewPanel();
        saveProj();
      });
    });
  }

  function renderRoster() {
    const sel = panelists().filter((p) => proj.interview.panel.indexOf(p.name) !== -1);
    el("interviewRoster").innerHTML = sel.map((p) =>
      '<span class="roster-chip"><span class="avatar">' + esc(p.avatar || p.name.slice(0, 2)) + "</span>" + esc(p.name) + "</span>"
    ).join("");
  }

  function chatAdd(obj) {
    const m = document.createElement("div");
    m.className = "chat-msg " + (obj.who === "user" ? "user" : obj.who === "system" ? "system" : "ai");
    let inner = "";
    if (obj.who === "ai") inner += '<div class="msg-meta">' + esc(obj.name) + "</div>";
    else if (obj.who === "user") inner += '<div class="msg-meta">You</div>';
    inner += '<div class="msg-bubble"></div>';
    m.innerHTML = inner;
    const bubble = m.querySelector(".msg-bubble");
    if (obj.text) bubble.textContent = obj.text;
    el("interviewChat").appendChild(m);
    scrollChat();
    return m;
  }

  function scrollChat() {
    const c = el("interviewChat");
    c.scrollTop = c.scrollHeight;
  }

  function chatLog() {
    return proj.interview.chat.map((m) => (m.who === "user" ? "Founder" : m.name) + ": " + m.text).join("\n");
  }

  function setInterviewBusy(busy) {
    el("interviewAnswerBtn").disabled = busy;
    el("interviewInput").disabled = busy;
  }

  function nextPanelist() {
    const sel = panelists().filter((p) => proj.interview.panel.indexOf(p.name) !== -1);
    let best = sel[0];
    let bestCount = Infinity;
    for (const p of sel) {
      const c = askCounts[p.name] || 0;
      if (c < bestCount) { bestCount = c; best = p; }
    }
    const tied = sel.filter((p) => (askCounts[p.name] || 0) === bestCount);
    best = tied[Math.floor(Math.random() * tied.length)];
    askCounts[best.name] = (askCounts[best.name] || 0) + 1;
    return best;
  }

  function buildQuestionPrompt(p) {
    return PANEL_PERSONA + "\n\nYou are " + p.name + ", a " + p.role + ". Your angle: " + p.focus + ".\n\nTHE IDEA:\n" + ideaBrief() + "\n\nCONVERSATION SO FAR:\n" + (chatLog() || "(none yet)") + "\n\nTASK: It's your turn. Ask the founder exactly ONE sharp, specific question — the single most useful thing you want to know next. No preamble, no filler, no meta-commentary. Reply with only the question itself.";
  }

  async function aiAskNext() {
    const p = nextPanelist();
    proj.interview.asked = (proj.interview.asked || 0) + 1;
    el("interviewStatus").textContent = "Round " + proj.interview.asked + " of " + proj.interview.rounds + " — " + p.name + " is asking…";
    setInterviewBusy(true);
    const m = chatAdd({ who: "ai", name: p.name, text: "" });
    const bubble = m.querySelector(".msg-bubble");
    bubble.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    let first = true;
    const full = await genText({
      instruction: buildQuestionPrompt(p),
      onChunk: (f) => { if (first) { first = false; bubble.innerHTML = ""; } bubble.textContent = f; scrollChat(); },
    });
    if (first) { first = false; bubble.innerHTML = ""; }
    bubble.textContent = full || "(no question generated)";
    proj.interview.chat.push({ who: "ai", name: p.name, text: full });
    saveProj();
    setInterviewBusy(false);
    el("interviewInput").focus();
  }

  async function onInterviewAnswer() {
    const input = el("interviewInput");
    const val = input.value.trim();
    if (!val) return;
    input.value = "";
    proj.interview.chat.push({ who: "user", text: val });
    chatAdd({ who: "user", text: val });
    saveProj();
    if ((proj.interview.asked || 0) >= proj.interview.rounds) {
      el("interviewStatus").textContent = "All " + proj.interview.rounds + " rounds done — press “Wrap up & debrief” for the panel's summary.";
      chatAdd({ who: "system", text: "All " + proj.interview.rounds + " rounds done — press “Wrap up & debrief” for the panel's summary." });
      return;
    }
    await aiAskNext();
  }

  async function endInterview() {
    if (!proj.interview.chat.length) return;
    el("interviewStatus").textContent = "Writing the debrief…";
    el("interviewEndBtn").disabled = true;
    const debriefCtn = el("interviewDebriefCtn");
    debriefCtn.hidden = false;
    const instruction = PANEL_PERSONA + "\n\nTHE IDEA:\n" + ideaBrief() + "\n\nFULL TRANSCRIPT:\n" + chatLog() + "\n\nTASK: The interview is over. As the panel's note-taker, write a sharp debrief in Markdown. Use EXACTLY these headings, each as a level-2 markdown heading (## ) on its own line, in this order:\n## What we learned\n## Assumptions challenged\n## Top concerns\n## What to validate first\n\nAim for 200-300 words. Be specific to this idea — paraphrase or quote the founder's answers where it matters.";
    const res = await runStreamingModule({
      btn: el("interviewEndBtn"),
      statusEl: el("interviewStatus"),
      contentEl: el("interviewDebrief"),
      instruction,
      busyMsg: "Writing debrief…",
    });
    el("interviewEndBtn").disabled = false;
    if (res.full.trim()) {
      proj.interview.debrief = res.full;
      proj.interview.done = true;
      saveProj();
      renderStepper();
      toast("Interview wrapped — debrief saved.");
    } else {
      toast("Debrief failed — try again.", "error");
    }
  }

  async function startInterview() {
    if (!requireIdea()) return;
    const sel = panelists().filter((p) => proj.interview.panel.indexOf(p.name) !== -1);
    if (!sel.length) { toast("Pick at least one panelist.", "error"); return; }
    proj.interview.chat = [];
    proj.interview.debrief = "";
    proj.interview.done = false;
    proj.interview.asked = 0;
    proj.interview.rounds = Number(el("roundsNum").textContent) || 7;
    askCounts = {};
    el("interviewSetup").hidden = true;
    el("interviewLive").hidden = false;
    el("interviewDebriefCtn").hidden = true;
    el("interviewDebrief").innerHTML = "";
    el("interviewChat").innerHTML = "";
    renderRoster();
    chatAdd({ who: "system", text: "Interview starting — " + proj.interview.rounds + " rounds. Answer each question honestly; the panel records everything and will debrief you at the end." });
    saveProj();
    await aiAskNext();
  }

  /* ── compare ─────────────────────────────────────────────────────── */

  function parseCompare(text) {
    const src = String(text || "");
    const cards = [];
    const sections = src.split(/^###\s+/m).slice(1);
    for (const sec of sections) {
      const lines = sec.split("\n");
      const name = (lines.shift() || "").replace(/^Competitor:\s*/i, "").trim();
      const body = lines.join("\n");
      if (!name || !/\*\*Positioning:\*\*|\*\*Strengths:\*\*/.test(body)) continue;
      const get = (re) => { const m = body.match(re); return m ? m[1].trim() : ""; };
      const bullets = (re) => {
        const m = body.match(re);
        if (!m) return [];
        return m[1].split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
      };
      cards.push({
        name,
        positioning: get(/^\*\*Positioning:\*\*\s*(.+)$/im),
        strengths: bullets(/^\*\*Strengths:\*\*\s*([\s\S]*?)(?=\n\*\*|(?![\s\S]))/im),
        weaknesses: bullets(/^\*\*Weaknesses:\*\*\s*([\s\S]*?)(?=\n\*\*|(?![\s\S]))/im),
        opportunity: get(/^\*\*(?:Where we can win|Opportunity):\*\*\s*(.+)$/im),
      });
    }
    return cards;
  }

  function renderCompareCards(cards) {
    const ctn = el("compareCards");
    ctn.innerHTML = cards.map((c, i) => {
      const name = esc(c.name || "Competitor " + (i + 1));
      const pos = esc(c.positioning || c.position || "");
      let html = '<div class="comp-card"><div class="cc-name">' + name + "</div>";
      if (pos) html += '<div class="cc-pos">' + pos + "</div>";
      if (c.strengths && c.strengths.length) html += '<div class="cc-block cc-good"><b>Strengths</b><ul>' + c.strengths.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul></div>";
      if (c.weaknesses && c.weaknesses.length) html += '<div class="cc-block cc-bad"><b>Weaknesses</b><ul>' + c.weaknesses.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul></div>";
      if (c.opportunity) html += '<div class="cc-block cc-learn"><b>Where we can win</b>' + esc(c.opportunity) + "</div>";
      return html + "</div>";
    }).join("");
  }

  async function runCompare(dig) {
    if (!requireIdea()) return;
    const compareCtn = el("compareCtn");
    const compareBody = el("compareBody");
    compareCtn.hidden = false;
    let instruction = STRATEGIST_PERSONA + "\n\nTASK: Map the competitive landscape for the idea below. Write a short intro paragraph (## Competitive landscape) naming the main categories and real competitors. Then, for each of 4-6 competitors, write a section with this EXACT markdown structure:\n\n### Competitor: <name>\n**Positioning:** <one line>\n**Strengths:**\n- <bullet>\n- <bullet>\n**Weaknesses:**\n- <bullet>\n- <bullet>\n**Where we can win:** <one line on the gap this creates for the founder's idea>\n\nThen one final paragraph (### Where we can win overall) in plain prose — no lists, no markup.\n\nTHE IDEA:\n" + ideaBrief();
    let seed = "";
    if (dig) {
      seed = proj.compare.content ? proj.compare.content.trimEnd() + "\n\n---\n\n### Follow-up: " + dig.trim() + "\n\n" : "";
      instruction += "\n\nFOLLOW-UP COMPARISON FROM THE FOUNDER:\n" + dig.trim() + "\n\nReply with a focused Markdown analysis of this angle, adding any new competitors as ### Competitor: <name> sections using the same structure.";
    }
    const res = await runStreamingModule({
      btn: el("compareRunBtn"),
      statusEl: el("compareStatus"),
      contentEl: compareBody,
      instruction,
      seed,
      busyMsg: "Mapping the landscape…",
    });
    if (res.full.trim()) {
      proj.compare.content = res.full;
      proj.compare.done = true;
      if (!dig) proj.compare.cards = parseCompare(res.full);
      renderCompareCards(proj.compare.cards);
      el("compareDigBtn").disabled = false;
      el("compareDigInput").value = "";
      saveProj();
      renderStepper();
    }
    if (!res.full && !seed) toast("Nothing returned — try again.", "error");
  }

  /* ── blueprint ───────────────────────────────────────────────────── */

  function buildBlueprintInstruction() {
    let ctx = "## The idea\n" + (ideaBrief() || "(none)");
    ctx += "\n\n## Research brief\n" + (proj.research.content || "(not yet run)");
    ctx += "\n\n## Interview debrief\n" + (proj.interview.debrief || (proj.interview.chat.length ? chatLog() : "(not yet run)"));
    ctx += "\n\n## Competitive landscape\n" + (proj.compare.content || "(not yet run)");
    return PRODUCT_PERSONA + "\n\nTASK: Distill everything the incubator has learned into ONE polished, concrete product blueprint in Markdown with these exact ## sections:\n- The pitch (2-3 sentences)\n- The problem\n- The solution\n- Target user\n- Differentiators\n- Business model (if any)\n- Risks & how to mitigate\n- 30-day validation plan (concrete weekly steps)\n\nBe specific and decisive. 500-700 words.\n\nCONTEXT:\n" + ctx;
  }

  async function runBlueprint() {
    if (!requireIdea()) return;
    const blueprintCtn = el("blueprintCtn");
    blueprintCtn.hidden = false;
    const res = await runStreamingModule({
      btn: el("blueprintRunBtn"),
      statusEl: el("blueprintStatus"),
      contentEl: el("blueprintBody"),
      instruction: buildBlueprintInstruction(),
      busyMsg: "Hatching the blueprint…",
    });
    if (res.full.trim()) {
      proj.blueprint.content = res.full;
      proj.blueprint.done = true;
      saveProj();
      renderStepper();
      toast("Blueprint hatched. Copy it, download it, or export the full project.");
    } else {
      toast("Blueprint failed — try again.", "error");
    }
  }

  function fullProjectJSON() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      generator: "idea-incubator",
      schemaVersion: cfg.schemaVersion,
      idea: proj.idea,
      research: proj.research,
      interview: proj.interview,
      compare: proj.compare,
      blueprint: proj.blueprint,
      config: cfg,
    }, null, 2);
  }

  async function onCopyMd() {
    if (!proj.blueprint.content) return;
    const ok = await copyText(proj.blueprint.content);
    toast(ok ? "Blueprint copied to clipboard." : "Could not copy — select and copy manually.", ok ? "" : "error");
  }

  function onDownloadMd() {
    if (!proj.blueprint.content) return;
    const name = (proj.idea.title.trim() || "idea-blueprint").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "idea-blueprint";
    download(name + "-blueprint.md", proj.blueprint.content, "text/markdown");
    toast("Downloaded the blueprint as markdown.");
  }

  function onExportJson() {
    download("idea-incubator-project.json", fullProjectJSON(), "application/json");
    toast("Exported the full project (idea + all work + config).");
  }

  /* ── share ───────────────────────────────────────────────────────── */

  let currentShareLink = "";

  function sharePayload() {
    return JSON.stringify({
      v: 1,
      exportedAt: new Date().toISOString(),
      idea: proj.idea,
      research: proj.research,
      interview: proj.interview,
      compare: proj.compare,
      blueprint: proj.blueprint,
    });
  }

  async function buildShareLink() {
    const gen = window.generatorName || "idea-incubator";
    const base = "https://perchance.org/" + gen;
    const json = sharePayload();
    if (root.uploadPlugin && root.uploadPlugin.editable) {
      const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
      const name = "idea-" + Array.from({ length: 22 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
      const res = await root.uploadPlugin.editable.set(name, json);
      if (res && !res.error) {
        const raw = "https://editable.uploads.dev/file/" + gen + "/" + name;
        return { link: base + "#share=u" + b64uEncode(raw), mode: "saved" };
      }
      if (res && res.error === "editable_requires_saved_generator") {
        return { error: "This generator isn't saved yet — save it first, then share links will work." };
      }
    }
    return { link: base + "#share=d" + b64uEncode(json), mode: "inline" };
  }

  async function shareProject() {
    if (!hasIdea()) { toast("Nothing to share yet — add your idea in Step 1 first.", "error"); return; }
    el("shareLinkInput").value = "";
    el("shareHint").textContent = "";
    el("shareIntro").textContent = "Creating your shareable link…";
    el("shareCopyBtn").disabled = true;
    openModal(el("shareModal"));
    const res = await buildShareLink();
    el("shareCopyBtn").disabled = false;
    if (res.error) { el("shareIntro").textContent = res.error; toast(res.error, "error"); return; }
    currentShareLink = res.link;
    el("shareIntro").textContent = "Anyone with this link can open the full project — idea, research, interview, competitive analysis and blueprint — right in this app.";
    el("shareHint").textContent = res.mode === "saved"
      ? "Stored on the server — a fresh copy is uploaded each time you create a link."
      : "The whole project is embedded in the link, so it's long — it still works in modern browsers.";
    el("shareLinkInput").value = res.link;
    el("shareOpenLink").href = res.link;
    copyText(res.link).then((ok) => { if (ok) toast("Share link copied to clipboard."); });
  }

  async function loadShared() {
    const m = (location.hash || "").match(/^#share=([du])([A-Za-z0-9_-]+)$/);
    if (!m) return;
    let text = null;
    try {
      if (m[1] === "d") {
        text = b64uDecode(m[2]);
      } else {
        const url = b64uDecode(m[2]);
        if (root.superFetch) text = await root.superFetch(url).then((r) => r.text());
        else text = await fetch(url).then((r) => r.text());
      }
      const data = JSON.parse(text);
      if (data && data.idea) {
        proj.idea = Object.assign({ text: "", problem: "", audience: "", title: "" }, data.idea);
        proj.research = Object.assign({ content: "", done: false }, data.research);
        proj.interview = Object.assign({ panel: [], rounds: 7, chat: [], debrief: "", done: false }, data.interview);
        proj.compare = Object.assign({ cards: [], content: "", done: false }, data.compare);
        proj.blueprint = Object.assign({ content: "", done: false }, data.blueprint);
        restoreProject(false);
        saveProj();
        toast("Shared project loaded — it now replaces your saved project (Start fresh clears it).");
        return;
      }
    } catch (e) { console.error(e); }
    toast("Couldn't load that shared project link.", "error");
  }

  /* ── settings panel ──────────────────────────────────────────────── */

  const BRAND_SPECS = [
    ["companyName", "Company name"],
    ["companyShortName", "Short name (narrow screens)"],
    ["logoGlyph", "Logo mark (1–2 characters)"],
    ["tagline", "Tagline"],
    ["footerText", "Footer copyright line"],
  ];

  const COLOR_SPECS = [
    ["primary", "Primary (brand)"],
    ["secondary", "Secondary"],
    ["accent", "Accent"],
    ["background", "Background"],
    ["surface", "Surface (cards)"],
    ["text", "Text"],
    ["textMuted", "Muted text"],
  ];

  const CONTENT_GROUPS = [
    { label: "Hero / product", fields: [
      ["product.badge", "Badge"], ["product.headline", "Headline"], ["product.headlineAccent", "Highlighted words"],
      ["product.subheadline", "Sub-headline"], ["product.status", "Status chip (empty to hide)"],
      ["product.primaryCta", "Primary button"], ["product.secondaryCta", "Secondary button"],
    ]},
    { label: "How it works", fields: [
      ["copy.howEyebrow", "Eyebrow"], ["copy.howTitle", "Title"], ["copy.howLede", "Lede"],
    ]},
    { label: "Step 1 — Idea", fields: [
      ["copy.ideaEyebrow", "Eyebrow"], ["copy.ideaTitle", "Title"], ["copy.ideaLede", "Lede"],
      ["copy.ideaProblemLabel", "Problem label"], ["copy.ideaAudienceLabel", "Audience label"],
      ["copy.ideaTitleLabel", "Working name label"], ["copy.ideaStartBtn", "Continue button"],
    ]},
    { label: "Step 2 — Research", fields: [
      ["copy.researchEyebrow", "Eyebrow"], ["copy.researchTitle", "Title"], ["copy.researchLede", "Lede"], ["copy.researchRunBtn", "Run button"],
    ]},
    { label: "Step 3 — Interview", fields: [
      ["copy.interviewEyebrow", "Eyebrow"], ["copy.interviewTitle", "Title"], ["copy.interviewLede", "Lede"],
      ["copy.interviewPanelLabel", "Panel label"], ["copy.interviewRoundsLabel", "Rounds label"],
      ["copy.interviewStartBtn", "Start button"], ["copy.interviewAnswerBtn", "Answer button"], ["copy.interviewEndBtn", "End button"],
    ]},
    { label: "Step 4 — Compare", fields: [
      ["copy.compareEyebrow", "Eyebrow"], ["copy.compareTitle", "Title"], ["copy.compareLede", "Lede"], ["copy.compareRunBtn", "Run button"],
    ]},
    { label: "Step 5 — Blueprint", fields: [
      ["copy.blueprintEyebrow", "Eyebrow"], ["copy.blueprintTitle", "Title"], ["copy.blueprintLede", "Lede"],
      ["copy.blueprintRunBtn", "Run button"], ["copy.blueprintNote", "Note"],
    ]},
  ];

  const PRESETS = [
    { name: "Violet (default)", colors: { primary: "#7c3aed", secondary: "#a78bfa", accent: "#4c1d95", background: "#f7f5fc", surface: "#ffffff", text: "#221c35", textMuted: "#6b7280" } },
    { name: "Emerald", colors: { primary: "#059669", secondary: "#34d399", accent: "#064e3b", background: "#f0fdf7", surface: "#ffffff", text: "#0f2e22", textMuted: "#5b6b66" } },
    { name: "Ocean", colors: { primary: "#2563eb", secondary: "#60a5fa", accent: "#1e3a8a", background: "#f4f8ff", surface: "#ffffff", text: "#14213d", textMuted: "#64748b" } },
    { name: "Sunset", colors: { primary: "#ea580c", secondary: "#fb923c", accent: "#7c2d12", background: "#fff8f3", surface: "#ffffff", text: "#2b1a10", textMuted: "#8a6f5f" } },
    { name: "Rose", colors: { primary: "#e11d48", secondary: "#fb7185", accent: "#881337", background: "#fff5f7", surface: "#ffffff", text: "#2b1520", textMuted: "#8a6a72" } },
    { name: "Indigo slate", colors: { primary: "#6366f1", secondary: "#818cf8", accent: "#312e81", background: "#f5f5fa", surface: "#ffffff", text: "#1e1b2e", textMuted: "#6b7280" } },
    { name: "Midnight (dark)", colors: { primary: "#8b5cf6", secondary: "#a78bfa", accent: "#4c1d95", background: "#14121d", surface: "#1e1a2c", text: "#ece9f6", textMuted: "#a3a0b8" } },
    { name: "Mono", colors: { primary: "#18181b", secondary: "#52525b", accent: "#3f3f46", background: "#fafafa", surface: "#ffffff", text: "#18181b", textMuted: "#71717a" } },
  ];

  function buildSettings() {
    buildBrandFields();
    buildColorRows();
    buildThemeFields();
    buildPresetGrid();
    buildContentFields();
    buildFormatDocs();
  }

  function buildBrandFields() {
    el("brandFields").innerHTML = BRAND_SPECS.map(([k, label]) =>
      '<div class="field"><label for="brand_' + k + '">' + label + "</label><input type=\"text\" id=\"brand_" + k + "\" value=\"" + esc(cfg.branding[k] || "") + "\"></div>"
    ).join("");
    BRAND_SPECS.forEach(([k]) => {
      el("brand_" + k).addEventListener("input", (e) => {
        setCfg("branding." + k, e.target.value);
        renderBranding();
      });
    });
  }

  function buildColorRows() {
    el("colorRows").innerHTML = COLOR_SPECS.map(([k, label]) =>
      '<div class="color-row"><label for="color_' + k + '">' + label + '</label><input type="color" id="color_' + k + '" value="' + esc(cfg.colors[k]) + '"><span class="hex" id="hex_' + k + '">' + esc(cfg.colors[k]) + "</span></div>"
    ).join("");
    COLOR_SPECS.forEach(([k]) => {
      el("color_" + k).addEventListener("input", (e) => {
        const v = e.target.value;
        cfg.colors[k] = v;
        el("hex_" + k).textContent = v;
        applyTheme();
        markDirty();
      });
    });
  }

  function buildThemeFields() {
    const th = cfg.theme;
    el("themeFields").innerHTML =
      '<div class="form-grid">' +
      '<div class="field"><label for="th_mode">Mode</label><select id="th_mode" class="dig-input">' +
        '<option value="light"' + (th.mode === "light" ? " selected" : "") + ">Light</option>" +
        '<option value="dark"' + (th.mode === "dark" ? " selected" : "") + ">Dark</option></select></div>" +
      '<div class="field"><label for="th_accent">Accent style</label><select id="th_accent" class="dig-input">' +
        '<option value="gradient"' + (th.accentStyle === "gradient" ? " selected" : "") + ">Gradient</option>" +
        '<option value="solid"' + (th.accentStyle === "solid" ? " selected" : "") + ">Solid</option></select></div>" +
      '<div class="field"><label for="th_font">Font</label><select id="th_font" class="dig-input">' +
        Object.keys(FONT_STACKS).map((k) => '<option value="' + k + '"' + (th.fontFamily === k ? " selected" : "") + ">" + FONT_NAMES[k] + "</option>").join("") +
        "</select></div>" +
      '<div class="field"><label for="th_size">Base text size — <span id="th_size_val">' + th.fontSize + "</span>px</label><select id=\"th_size\" class=\"dig-input\">" +
        '<option value="15"' + (th.fontSize === 15 ? " selected" : "") + ">15 — compact</option>" +
        '<option value="16"' + (th.fontSize === 16 ? " selected" : "") + ">16 — normal</option>" +
        '<option value="18"' + (th.fontSize === 18 ? " selected" : "") + ">18 — large</option></select></div>" +
      '<div class="field"><label for="th_radius">Corner radius — <span id="th_radius_val">' + th.radius + "</span>px</label>" +
        '<input type="range" id="th_radius" min="8" max="24" step="1" value="' + th.radius + '"></div>' +
      '<div class="field"><label><input type="checkbox" id="th_motion"' + (th.reduceMotion ? " checked" : "") + '> Reduce motion (disable animations)</label></div>' +
      "</div>";
    const bind = (id, key, fn) => el(id).addEventListener("input", (e) => {
      cfg.theme[key] = fn(e.target.value);
      el("th_" + key + "_val") && (el("th_" + key + "_val").textContent = e.target.value);
      applyTheme();
      markDirty();
    });
    bind("th_mode", "mode", (v) => v);
    bind("th_accent", "accentStyle", (v) => v);
    bind("th_font", "fontFamily", (v) => v);
    bind("th_size", "fontSize", (v) => Number(v));
    bind("th_radius", "radius", (v) => Number(v));
    el("th_motion").addEventListener("change", (e) => {
      cfg.theme.reduceMotion = e.target.checked;
      applyTheme();
      markDirty();
    });
  }

  function syncThemeFields() {
    const th = cfg.theme;
    const mode = el("th_mode"); if (mode) mode.value = th.mode;
    const motion = el("th_motion"); if (motion) motion.checked = th.reduceMotion;
  }

  function buildPresetGrid() {
    el("presetGrid").innerHTML = PRESETS.map((p) =>
      '<button class="preset" data-name="' + esc(p.name) + '" type="button"><span class="p-swatches">' +
      ["primary", "secondary", "accent", "background", "surface"].map((k) => '<span style="background:' + p.colors[k] + '"></span>').join("") +
      '</span><span class="p-name">' + esc(p.name) + "</span></button>"
    ).join("");
    el("presetGrid").querySelectorAll(".preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = PRESETS.find((p) => p.name === btn.dataset.name);
        if (!preset) return;
        Object.assign(cfg.colors, preset.colors);
        buildColorRows();
        applyTheme();
        markDirty();
        toast("Applied “" + preset.name + "” — press Save configuration to keep it.");
      });
    });
  }

  function buildContentFields() {
    const html = CONTENT_GROUPS.map((g) =>
      '<h4 class="subhead">' + g.label + '</h4><div class="form-grid">' +
      g.fields.map(([path, label]) => {
        const key = path.replace(/\./g, "_");
        const v = getCfg(path) || "";
        return '<div class="field"><label for="ct_' + key + '">' + label + "</label><textarea id=\"ct_" + key + "\" rows=\"2\" style=\"min-height:52px\">" + esc(v) + "</textarea></div>";
      }).join("") + "</div>"
    ).join("");
    el("contentFields").innerHTML = html;
    CONTENT_GROUPS.forEach((g) => g.fields.forEach(([path]) => {
      const key = path.replace(/\./g, "_");
      el("ct_" + key).addEventListener("input", (e) => {
        setCfg(path, e.target.value);
        renderCopy();
        renderHero();
      });
    }));
  }

  function buildFormatDocs() {
    const doc = [
      "The configuration is a single JSON object. Every field is optional — missing fields fall back to the defaults in main.pjs.",
      "",
      "Top-level keys:",
      "  schemaVersion  — string, e.g. \"1.1.0\"",
      "  branding       — companyName, companyShortName, logoGlyph, tagline, footerText",
      "  theme          — mode (\"light\"|\"dark\"), accentStyle (\"gradient\"|\"solid\"), radius (px), fontSize (15|16|18), fontFamily, reduceMotion",
      "  colors         — primary, secondary, accent, background, surface, text, textMuted (hex)",
      "  product        — name, badge, headline, headlineAccent, subheadline, primaryCta, primaryCtaUrl, secondaryCta, secondaryCtaUrl, status",
      "  copy           — every text block on the page (see the example below)",
      "  researchAreas  — array of areas the research brief always covers",
      "  interviewers   — array of { name, role, focus, avatar }",
      "  admin          — showSettingsButton (true|false)",
      "",
      "You can edit this JSON directly and press “Import JSON”, or paste it into the box below and press “Export JSON” to pull the current configuration out.",
    ].join("\n");
    el("formatDocs").textContent = doc;
    el("formatExample").textContent = JSON.stringify({
      schemaVersion: "1.1.0",
      branding: { companyName: "Idea Incubator", companyShortName: "Incubator", logoGlyph: "I", tagline: "Where rough ideas hatch into products.", footerText: "© {year} {companyName}. All rights reserved." },
      theme: { mode: "light", accentStyle: "gradient", radius: 16, fontSize: 16, fontFamily: "lato", reduceMotion: false },
      colors: { primary: "#7c3aed", secondary: "#a78bfa", accent: "#4c1d95", background: "#f7f5fc", surface: "#ffffff", text: "#221c35", textMuted: "#6b7280" },
      product: { name: "Idea Incubator", badge: "Idea incubation studio", headline: "Turn a rough idea into a sharp one.", headlineAccent: "sharp one.", primaryCta: "Start incubating an idea", status: "Free · no signup" },
      copy: { howTitle: "One idea, four stages", ideaLede: "Describe your idea exactly as it is — messy is fine.", researchRunBtn: "Run research", interviewStartBtn: "Start the interview", compareRunBtn: "Map the landscape", blueprintRunBtn: "Hatch the blueprint" },
      researchAreas: ["what the idea is", "the real problem & who feels it"],
      interviewers: [{ name: "Maya Chen", role: "Venture partner", focus: "Market size, business model, defensibility, team", avatar: "MC" }],
      admin: { showSettingsButton: true },
    }, null, 2);
  }

  function buildSchema() {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Idea Incubator configuration",
      type: "object",
      properties: {
        schemaVersion: { type: "string" },
        branding: { type: "object", properties: { companyName: { type: "string" }, companyShortName: { type: "string" }, logoGlyph: { type: "string" }, tagline: { type: "string" }, footerText: { type: "string" } } },
        theme: { type: "object", properties: { mode: { type: "string", enum: ["light", "dark"] }, accentStyle: { type: "string", enum: ["gradient", "solid"] }, radius: { type: "number" }, fontSize: { type: "number", enum: [15, 16, 18] }, fontFamily: { type: "string" }, reduceMotion: { type: "boolean" } } },
        colors: { type: "object", properties: { primary: { type: "string" }, secondary: { type: "string" }, accent: { type: "string" }, background: { type: "string" }, surface: { type: "string" }, text: { type: "string" }, textMuted: { type: "string" } } },
        product: { type: "object" },
        copy: { type: "object" },
        researchAreas: { type: "array", items: { type: "string" } },
        interviewers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, focus: { type: "string" }, avatar: { type: "string" } } } },
        admin: { type: "object", properties: { showSettingsButton: { type: "boolean" } } },
      },
      additionalProperties: true,
    };
    return schema;
  }

  function importConfig(text) {
    const errs = el("importErrors");
    errs.textContent = "";
    let data;
    try { data = JSON.parse(text); } catch (e) { errs.textContent = "That's not valid JSON: " + e.message; return; }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const defaults = readDefaults();
      cfg = deepMerge(defaults, data);
      buildSettings();
      renderAll();
      markDirty();
      toast("Configuration imported — press Save configuration to keep it.");
    } else {
      errs.textContent = "Expected a JSON object at the top level.";
    }
  }

  function renderAll() {
    applyTheme();
    renderBranding();
    renderCopy();
    renderHero();
    renderSteps();
    renderStepper();
    renderInterviewPanel();
    el("settingsFab").style.display = cfg.admin.showSettingsButton === false ? "none" : "";
  }

  /* ── scanner ─────────────────────────────────────────────────────── */

  function mix(c1, c2, t) {
    const a = [parseInt(c1.slice(1, 3), 16), parseInt(c1.slice(3, 5), 16), parseInt(c1.slice(5, 7), 16)];
    const b = [parseInt(c2.slice(1, 3), 16), parseInt(c2.slice(3, 5), 16), parseInt(c2.slice(5, 7), 16)];
    const m = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return "#" + m.map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function saturation(rgb) {
    const max = Math.max(...rgb), min = Math.min(...rgb);
    return max === 0 ? 0 : (max - min) / max;
  }

  function hexToRgb(h) {
    let s = h.slice(1);
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    if (s.length === 4) s = s.split("").map((c) => c + c).join("");
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  function extractColors(text) {
    const hexes = text.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const cols = [];
    for (const h of hexes) {
      let s = h.slice(1);
      if (s.length === 3 || s.length === 4) s = s.split("").map((c) => c + c).join("");
      const rgb = [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
      const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      const mx = Math.max(...rgb), mn = Math.min(...rgb);
      if (lum > 40 && lum < 235 && (mx - mn) > 28) cols.push(rgb);
    }
    return cols;
  }

  function dominantColors(cols, topN) {
    const buckets = {};
    for (const c of cols) {
      const key = c.map((v) => Math.round(v / 32) * 32).join(",");
      buckets[key] = (buckets[key] || 0) + 1;
    }
    return Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, topN)
      .map(([key]) => key.split(",").map(Number));
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }

  function buildSchemesFromColors(primary, bgNeutral) {
    const pHex = rgbToHex(primary);
    const accent = mix(pHex, "#000000", 0.32);
    const secondary = mix(pHex, "#ffffff", 0.4);
    const darkBg = mix(pHex, "#0c0a14", 0.78);
    return [
      {
        name: "Light",
        colors: {
          primary: pHex, secondary, accent,
          background: bgNeutral || mix(pHex, "#ffffff", 0.93),
          surface: "#ffffff",
          text: mix(pHex, "#000000", 0.72),
          textMuted: mix(pHex, "#000000", 0.5),
        },
      },
      {
        name: "Dark",
        colors: {
          primary: mix(pHex, "#ffffff", 0.12), secondary: mix(pHex, "#ffffff", 0.35), accent: mix(pHex, "#ffffff", 0.04),
          background: darkBg, surface: mix(pHex, "#000000", 0.86),
          text: "#ece9f6", textMuted: "#a3a0b8",
        },
      },
    ];
  }

  async function runScanner() {
    const urlInput = el("scanUrlInput");
    const url = (urlInput.value || "").trim();
    const errEl = el("scanError");
    errEl.textContent = "";
    el("scanResult").innerHTML = "";
    if (!/^https?:\/\//i.test(url)) {
      errEl.textContent = "Enter a full URL, e.g. https://example.com";
      return;
    }
    if (!root.superFetch) {
      errEl.textContent = "The super-fetch plugin isn't loaded, so scanning is unavailable right now.";
      return;
    }
    el("scanLoading").hidden = false;
    el("scanBtn").disabled = true;
    try {
      const res = await root.superFetch(url);
      const html = await res.text();
      const cssUrls = [];
      const linkRe = /<link[^>]*rel=["']stylesheet["'][^>]*>/gi;
      let m;
      while ((m = linkRe.exec(html))) {
        const hrefM = m[0].match(/href=["']([^"']+)["']/i);
        if (hrefM) cssUrls.push(new URL(hrefM[1], url).href);
      }
      let cssText = "";
      const cssResults = await Promise.allSettled(cssUrls.slice(0, 3).map((u) => root.superFetch(u).then((r) => r.text())));
      cssResults.forEach((r) => { if (r.status === "fulfilled") cssText += r.value; });
      const cols = extractColors(html + cssText);
      if (!cols.length) { el("scanLoading").hidden = true; el("scanBtn").disabled = false; errEl.textContent = "Couldn't find any strong colors on that page — try another site."; return; }
      const dom = dominantColors(cols, 6);
      const sortedBySat = [...dom].sort((a, b) => saturation(b) - saturation(a));
      const primary = sortedBySat[0];
      const neutral = dom.find((c) => saturation(c) < 0.18) || null;
      const bg = neutral ? rgbToHex(mix(rgbToHex(neutral), "#ffffff", 0.82)) : null;
      const schemes = buildSchemesFromColors(primary, bg);
      el("scanResult").innerHTML = schemes.map((s, i) =>
        '<div class="scan-scheme" data-scheme="' + i + '"><div class="ss-head"><span class="ss-name">' + s.name + " scheme</span>" +
        '<span class="ss-swatches">' + ["primary", "secondary", "accent", "background", "surface"].map((k) => '<span style="background:' + s.colors[k] + '"></span>').join("") + "</span></div>" +
        '<button class="btn btn-ghost btn-sm" type="button">Apply this scheme</button></div>'
      ).join("");
      el("scanResult").querySelectorAll(".scan-scheme").forEach((card) => {
        card.querySelector("button").addEventListener("click", () => {
          const scheme = schemes[Number(card.dataset.scheme)];
          Object.assign(cfg.colors, scheme.colors);
          buildColorRows();
          applyTheme();
          markDirty();
          closeModal(el("scannerModal"));
          toast("Applied the " + scheme.name + " scheme from that site — press Save configuration to keep it.");
        });
      });
      el("scanLoading").hidden = true;
      el("scanBtn").disabled = false;
      toast("Analyzed the site — pick a scheme below.");
    } catch (e) {
      console.error(e);
      el("scanLoading").hidden = true;
      el("scanBtn").disabled = false;
      errEl.textContent = "Couldn't fetch that site (it may block automated requests). Try another URL.";
    }
  }

  /* ── ask-ai ──────────────────────────────────────────────────────── */

  function projectContext() {
    let ctx = "## Working idea\n" + (ideaBrief() || "(none yet)");
    if (proj.research.content) ctx += "\n\n## Research brief\n" + proj.research.content;
    if (proj.interview.debrief) ctx += "\n\n## Interview debrief\n" + proj.interview.debrief;
    else if (proj.interview.chat.length) ctx += "\n\n## Interview so far\n" + chatLog();
    if (proj.compare.content) ctx += "\n\n## Competitive landscape\n" + proj.compare.content;
    if (proj.blueprint.content) ctx += "\n\n## Blueprint\n" + proj.blueprint.content;
    return ctx;
  }

  function addAiMsg(who, text, bubble) {
    const m = document.createElement("div");
    m.className = "ask-ai-msg " + who;
    m.textContent = text || "";
    const wrap = bubble || el("askAiMsgs");
    wrap.appendChild(m);
    el("askAiMsgs").scrollTop = el("askAiMsgs").scrollHeight;
    return m;
  }

  const SUGGESTIONS = [
    "What's the biggest risk in this idea right now?",
    "How should we price this?",
    "Who should we talk to first to validate it?",
    "Draft a one-sentence pitch",
  ];

  function renderSuggestions() {
    el("askAiSuggest").innerHTML = SUGGESTIONS.map((s) => '<button class="ask-ai-suggest-chip" data-q="' + esc(s) + '" type="button">' + esc(s) + "</button>").join("");
    el("askAiSuggest").querySelectorAll(".ask-ai-suggest-chip").forEach((chip) => {
      chip.addEventListener("click", () => { el("askAiInput").value = chip.dataset.q; askAiSend(); });
    });
  }

  async function askAiSend() {
    const input = el("askAiInput");
    const q = input.value.trim();
    if (!q || aiBusy) return;
    input.value = "";
    autosizeAiInput();
    el("askAiSuggest").innerHTML = "";
    addAiMsg("user", q);
    aiBusy = true;
    el("askAiSendBtn").disabled = true;
    const bubble = addAiMsg("ai", "");
    bubble.innerHTML = '<span class="ask-ai-typing"><i class="typing-dots"><i></i><i></i><i></i></span>';
    let first = true;
    const full = await genText({
      instruction: ADVISOR_PERSONA + "\n\nCURRENT PROJECT CONTEXT:\n" + projectContext() + "\n\nTHE FOUNDER ASKS:\n" + q + "\n\nReply helpfully, concretely and briefly (under 180 words). Use plain text with short paragraphs; bold is not needed.",
      onChunk: (f) => { if (first) { first = false; bubble.textContent = ""; } bubble.textContent = f; el("askAiMsgs").scrollTop = el("askAiMsgs").scrollHeight; },
    });
    if (first) { first = false; bubble.textContent = ""; }
    bubble.textContent = full || "(no response)";
    aiBusy = false;
    el("askAiSendBtn").disabled = false;
    el("askAiInput").focus();
  }

  function autosizeAiInput() {
    const t = el("askAiInput");
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 110) + "px";
  }

  function openModal(modal) { modal.classList.add("open"); }
  function closeModal(modal) { modal.classList.remove("open"); }

  /* ── restore ─────────────────────────────────────────────────────── */

  function restoreProject(useSaved = true) {
    if (useSaved) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY_PROJ) || "null"); } catch (e) {}
      if (saved && saved.idea) Object.assign(proj.idea, saved.idea);
      if (saved && saved.research) Object.assign(proj.research, saved.research);
      if (saved && saved.interview) Object.assign(proj.interview, saved.interview);
      if (saved && saved.compare) Object.assign(proj.compare, saved.compare);
      if (saved && saved.blueprint) Object.assign(proj.blueprint, saved.blueprint);
    }
    el("ideaTextarea").value = proj.idea.text || "";
    el("ideaProblemInput").value = proj.idea.problem || "";
    el("ideaAudienceInput").value = proj.idea.audience || "";
    el("ideaTitleInput").value = proj.idea.title || "";
    if (proj.research.content) {
      el("researchCtn").hidden = false;
      el("researchBody").innerHTML = md(proj.research.content);
      el("researchDigBtn").disabled = false;
    }
    if (proj.compare.content) {
      el("compareCtn").hidden = false;
      el("compareBody").innerHTML = md(proj.compare.content);
      renderCompareCards(proj.compare.cards && proj.compare.cards.length ? proj.compare.cards : parseCompare(proj.compare.content));
      el("compareDigBtn").disabled = false;
    }
    if (proj.blueprint.content) {
      el("blueprintCtn").hidden = false;
      el("blueprintBody").innerHTML = md(proj.blueprint.content);
    }
    if (proj.interview.chat && proj.interview.chat.length) {
      el("interviewSetup").hidden = true;
      el("interviewLive").hidden = false;
      renderRoster();
      el("interviewChat").innerHTML = "";
      proj.interview.chat.forEach((m) => chatAdd(m));
      el("interviewStatus").textContent = proj.interview.done ? "Interview complete — debrief below." : (proj.interview.asked || 0) + " of " + (proj.interview.rounds || 7) + " rounds so far.";
      el("interviewInput").disabled = false;
    }
    if (proj.interview.debrief) {
      el("interviewDebriefCtn").hidden = false;
      el("interviewDebrief").innerHTML = md(proj.interview.debrief);
    }
    if (!proj.interview.panel.length) proj.interview.panel = panelists().map((p) => p.name);
    el("roundsNum").textContent = proj.interview.rounds || 7;
    renderStepper();
  }

  /* ── events ──────────────────────────────────────────────────────── */

  function bindEvents() {
    el("themeToggle").addEventListener("click", toggleTheme);
    el("hamburgerBtn").addEventListener("click", () => el("mobileMenu").classList.toggle("open"));
    el("ideaTextarea").addEventListener("input", onIdeaInput);
    el("ideaProblemInput").addEventListener("input", onIdeaInput);
    el("ideaAudienceInput").addEventListener("input", onIdeaInput);
    el("ideaTitleInput").addEventListener("input", onIdeaInput);
    el("ideaStartBtn").addEventListener("click", () => {
      if (!hasIdea()) { toast("Write your idea first — the incubator needs the raw spark.", "error"); return; }
      document.getElementById("research").scrollIntoView({ behavior: "smooth" });
    });
    el("ideaClearBtn").addEventListener("click", () => {
      if (confirm("Clear the saved project and start fresh? This can't be undone.")) clearProject();
    });
    el("researchRunBtn").addEventListener("click", () => {
      if (el("researchRunBtn").dataset.busy === "1") { stopCurrent(); return; }
      runResearch(false);
    });
    el("researchDigBtn").addEventListener("click", () => {
      const q = el("researchDigInput").value.trim();
      if (q) runResearch(q);
    });
    el("researchDigInput").addEventListener("keydown", (e) => { if (e.key === "Enter") el("researchDigBtn").click(); });
    el("roundsMinus").addEventListener("click", () => {
      let n = Number(el("roundsNum").textContent) || 7;
      n = Math.max(3, n - 1);
      el("roundsNum").textContent = n;
      proj.interview.rounds = n;
      saveProj();
    });
    el("roundsPlus").addEventListener("click", () => {
      let n = Number(el("roundsNum").textContent) || 7;
      n = Math.min(15, n + 1);
      el("roundsNum").textContent = n;
      proj.interview.rounds = n;
      saveProj();
    });
    el("interviewStartBtn").addEventListener("click", startInterview);
    el("interviewAnswerBtn").addEventListener("click", onInterviewAnswer);
    el("interviewInput").addEventListener("keydown", (e) => { if (e.key === "Enter") el("interviewAnswerBtn").click(); });
    el("interviewEndBtn").addEventListener("click", endInterview);
    el("compareRunBtn").addEventListener("click", () => {
      if (el("compareRunBtn").dataset.busy === "1") { stopCurrent(); return; }
      runCompare(false);
    });
    el("compareDigBtn").addEventListener("click", () => {
      const q = el("compareDigInput").value.trim();
      if (q) runCompare(q);
    });
    el("compareDigInput").addEventListener("keydown", (e) => { if (e.key === "Enter") el("compareDigBtn").click(); });
    el("blueprintRunBtn").addEventListener("click", () => {
      if (el("blueprintRunBtn").dataset.busy === "1") { stopCurrent(); return; }
      runBlueprint();
    });
    el("copyMdBtn").addEventListener("click", onCopyMd);
    el("downloadMdBtn").addEventListener("click", onDownloadMd);
    el("exportJsonBtn").addEventListener("click", onExportJson);

    el("headerShareBtn").addEventListener("click", shareProject);
    el("shareProjectBtn").addEventListener("click", shareProject);
    el("shareCopyBtn").addEventListener("click", async () => {
      if (!currentShareLink) return;
      const ok = await copyText(currentShareLink);
      toast(ok ? "Share link copied to clipboard." : "Could not copy.", ok ? "" : "error");
    });
    el("shareNewBtn").addEventListener("click", shareProject);
    el("shareCloseBtn").addEventListener("click", () => closeModal(el("shareModal")));
    el("shareModal").addEventListener("click", (e) => { if (e.target === el("shareModal")) closeModal(el("shareModal")); });
    el("shareLinkInput").addEventListener("focus", (e) => e.target.select());

    el("settingsFab").addEventListener("click", () => { buildSettings(); openModal(el("settingsModal")); });
    el("settingsCloseBtn").addEventListener("click", () => closeModal(el("settingsModal")));
    el("settingsModal").addEventListener("click", (e) => { if (e.target === el("settingsModal")) closeModal(el("settingsModal")); });
    el("settingsModal").querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        el("settingsModal").querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
        el("settingsModal").querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === tab.dataset.tab));
      });
    });
    el("resetStyleBtn").addEventListener("click", () => {
      const def = readDefaults();
      cfg.theme = def.theme;
      cfg.colors = def.colors;
      buildColorRows();
      buildThemeFields();
      applyTheme();
      markDirty();
      toast("Style reset to defaults — press Save configuration to keep it.");
    });
    el("openScannerBtn").addEventListener("click", () => openModal(el("scannerModal")));
    el("scannerCloseBtn").addEventListener("click", () => closeModal(el("scannerModal")));
    el("scannerModal").addEventListener("click", (e) => { if (e.target === el("scannerModal")) closeModal(el("scannerModal")); });
    el("scanBtn").addEventListener("click", runScanner);
    el("scanUrlInput").addEventListener("keydown", (e) => { if (e.key === "Enter") el("scanBtn").click(); });

    el("importBtn").addEventListener("click", () => importConfig(el("ioArea").value));
    el("exportBtn").addEventListener("click", () => { el("ioArea").value = JSON.stringify(cfg, null, 2); el("importErrors").textContent = ""; });
    el("copyBtn").addEventListener("click", async () => {
      const ok = await copyText(el("ioArea").value || JSON.stringify(cfg, null, 2));
      toast(ok ? "Copied the configuration JSON." : "Could not copy.", ok ? "" : "error");
    });
    el("downloadBtn").addEventListener("click", () => download("idea-incubator-config.json", JSON.stringify(cfg, null, 2), "application/json"));
    el("schemaBtn").addEventListener("click", () => download("idea-incubator-config.schema.json", JSON.stringify(buildSchema(), null, 2), "application/json"));
    el("resetBtn").addEventListener("click", () => {
      if (!confirm("Reset the configuration to the template defaults and clear the saved browser config?")) return;
      localStorage.removeItem(KEY_CFG);
      cfg = readDefaults();
      buildSettings();
      renderAll();
      el("dirtyHint").style.visibility = "hidden";
      toast("Configuration reset to defaults.");
    });
    el("saveConfigBtn").addEventListener("click", () => {
      saveCfg();
      renderAll();
      toast("Configuration saved.");
    });
    el("shareBtn").addEventListener("click", async () => {
      const link = "https://perchance.org/" + (window.generatorName || "idea-incubator") + "#cfg=" + b64uEncode(JSON.stringify(cfg));
      const ok = await copyText(link);
      toast(ok ? "Config link copied — it reproduces this theme, colors and text size." : "Could not copy the link.", ok ? "" : "error");
    });

    el("askAiBtn").addEventListener("click", () => {
      el("askAiShell").hidden = false;
      renderSuggestions();
      el("askAiInput").focus();
    });
    el("askAiCloseBtn").addEventListener("click", () => { el("askAiShell").hidden = true; });
    el("askAiSendBtn").addEventListener("click", askAiSend);
    el("askAiInput").addEventListener("input", autosizeAiInput);
    el("askAiInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAiSend(); }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal(el("settingsModal"));
        closeModal(el("scannerModal"));
        closeModal(el("shareModal"));
        el("askAiShell").hidden = true;
        el("mobileMenu").classList.remove("open");
      }
    });
  }

  function init() {
    cfg = loadCfg();
    renderAll();
    restoreProject();
    bindEvents();
    el("settingsFab").style.display = cfg.admin.showSettingsButton === false ? "none" : "";
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    loadShared();
    if (!root.generateText) console.warn("ai-text-plugin not available — generation features will show errors.");
    if (!root.superFetch) console.warn("super-fetch-plugin not available — website color scanning will be disabled.");
  }

  init();
})();
