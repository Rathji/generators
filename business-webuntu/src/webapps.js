// Webuntu Business — embedded Perchance suite (Business edition)
// One generic embed builder for every business generator installed in the
// catalog: The Ledger, Project Master, Atomic Roadmap, sys-plan, Diagram It,
// Chance Code, Todo Checklist, File Format Converter, AI Voice Assistant and
// Voice Assistant (Perch Edit has its own builder in src/perchedit.js).
//
// Each app embeds the generator via the standard in-OS generator embed
// (https://null.perchance.org/<slug> — the platform auto-redirects to the
// generator's real subdomain) in a Browser-style window. Toolbar: Reload and
// an "Open in new tab ↗" fallback; a 12s slow-load overlay offers the same
// fallback if the embed stalls (the Browser / Perch Edit model). Voice apps
// get microphone permission on the iframe.
//
// Registers window.AppContent[id] for each slug (the apps.js launch path).

(function () {
  "use strict";

  const APPS = {
    "the-ledger":            { chip: "books · invoices · chart of accounts" },
    "project-master":        { chip: "projects · tasks · kanban · releases" },
    "atomic-roadmap":        { chip: "AI-assisted roadmaps & backlogs" },
    "sys-plan":              { chip: "system & architecture planning boards" },
    "diagram-it":            { chip: "IT, network & flowchart diagrams" },
    "chance-code":           { chip: "a Perchance project IDE" },
    "todo-checklist":        { chip: "simple daily checklists" },
    "file-format-converter": { chip: "convert between file formats" },
    "ai-voice-assistant":    { chip: "manage your day by voice", mic: true },
    "voice-assistant":       { chip: "an OS voice assistant", mic: true },
    "business-intelligence-dashboard": { chip: "KPIs · dashboards · reports" },
    "business-crm":          { chip: "customers · leads · deals · pipelines" },
    "business-documentation":{ chip: "docs · wikis · knowledge base" },
    "business-psa":          { chip: "projects · time · billing · services" },
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function openInTab(slug) {
    window.open("https://perchance.org/" + slug, "_blank", "noopener");
  }

  function build(app) {
    const cfg = APPS[app.id] || { chip: "embedded Perchance app" };
    const EMBED_URL = "https://null.perchance.org/" + app.id;
    const PAGE_URL = "https://perchance.org/" + app.id;
    const root = el("div", "pe");

    const bar = el("div", "pe-bar");
    const id = el("span", "pe-id", (app.icon || "🧩") + " " + app.name);
    const chip = el("span", "pe-chip", cfg.chip);
    const sp = el("span", "pe-spacer");
    const relBtn = el("button", "pe-btn", "⟳");
    relBtn.type = "button"; relBtn.title = "Reload app";
    const extBtn = el("button", "pe-btn pe-ext", "↗");
    extBtn.type = "button"; extBtn.title = "Open in new tab";
    bar.append(id, chip, sp, relBtn, extBtn);

    const frameWrap = el("div", "pe-frame");
    const frame = el("iframe", "pe-iframe");
    const allow = cfg.mic
      ? "clipboard-write; autoplay; fullscreen; microphone"
      : "clipboard-write; autoplay; fullscreen";
    frame.setAttribute("allow", allow);
    frame.setAttribute("referrerpolicy", "no-referrer");
    frameWrap.appendChild(frame);

    const loading = el("div", "pe-loading");
    const spin = el("div", "pe-spinner");
    const loadTxt = el("div", "pe-loading-txt", "Opening " + app.name + "…");
    const loadBtns = el("div", "pe-loading-actions");
    loadBtns.hidden = true;
    const ext2 = el("button", "set-btn", "Open in new tab");
    ext2.type = "button";
    loadBtns.appendChild(ext2);
    loading.append(spin, loadTxt, loadBtns);

    const note = el("div", "pe-note",
      app.name + " runs as a live Perchance generator — your data saves inside the app itself.");

    root.append(bar, loading, frameWrap, note);

    let loaded = false;
    frame.addEventListener("load", () => { loaded = true; loading.hidden = true; });
    setTimeout(() => {
      if (!loaded) {
        loadTxt.textContent = "Still loading — " + app.name + " may take a moment.";
        loading.classList.add("slow");
        loadBtns.hidden = false;
      }
    }, 12000);

    function reload() {
      loaded = false;
      loading.hidden = false;
      loadTxt.textContent = "Opening " + app.name + "…";
      loading.classList.remove("slow");
      loadBtns.hidden = true;
      frame.src = "about:blank";
      setTimeout(() => { frame.src = EMBED_URL; }, 30);
    }

    relBtn.addEventListener("click", reload);
    extBtn.addEventListener("click", () => openInTab(app.id));
    ext2.addEventListener("click", () => openInTab(app.id));

    frame.src = EMBED_URL;

    return { root, frame };
  }

  window.AppContent = window.AppContent || {};
  for (const id of Object.keys(APPS)) {
    if (window.AppContent[id]) continue;
    window.AppContent[id] = function (app) {
      const built = build(app);
      return {
        content: built.root,
        w: 1000, h: 680, minW: 480, minH: 360,
        // Blank the iframe on close so any embedded audio/work stops.
        onCloseRequest: () => { try { built.frame.src = "about:blank"; } catch (e) {} },
      };
    };
  }

  window.WebApps = {
    open(id) {
      if (window.Apps) window.Apps.launch(id);
      return (window.WM && window.WM.findByAppId(id)) || null;
    },
  };
})();
