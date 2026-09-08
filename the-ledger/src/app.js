/* ============================================================================
   LEDGERLY — app.js
   App shell (top bar / sidebar / views), the dashboard, and the interactive
   FEATURES CHECKLIST UI (roadmap + per-module feature pages). Domain modules
   (ledger, ap, ar, …) each render a full feature view; the roadmap surfaces
   the completed backlog from main.pjs.
   ============================================================================ */
(function () {
  "use strict";

  const FW = window.FW;
  const esc = FW.esc;

  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    roadmap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="5" r="2.4"/><path d="M8.4 19H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.6"/></svg>',
    ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>',
    ap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    ar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    tax: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
    ocr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>',
    payroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
    manual: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M19.4 4.6l-1.8 1.8M6.4 17.6l-1.8 1.8"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  };
  const icon = k => ICONS[k] || ICONS.ledger;

  const state = {
    cfg: null, features: [], map: {}, // map: taskId -> effective status
    base: {},                          // map: taskId -> status from main.pjs
    overrides: {},                     // map: taskId -> user override
    view: null, mainEl: null, mode: "light",
  };

  const totals = () => {
    let done = 0, total = 0;
    for (const p of state.features) for (const it of p.items) { total++; if ((state.map[it.id] || it.status) === "done") done++; }
    return { done, total };
  };
  const phaseCounts = key => {
    const p = state.features.find(x => x.key === key) || { items: [] };
    let done = 0;
    for (const it of p.items) if ((state.map[it.id] || it.status) === "done") done++;
    return { done, total: p.items.length };
  };

  /* ── top-level chrome ────────────────────────────────────────────────── */
  function renderChrome() {
    const c = state.cfg;
    FW.$("#logoMark").textContent = c.branding.logoGlyph || "L";
    FW.$("#brandName").textContent = c.branding.companyShortName || c.branding.companyName;
    FW.$("#footName").textContent = c.branding.companyName;
    FW.$("#footVersion").textContent = "v" + c.app.version;
    FW.$("#footSchema").textContent = "schema " + c.schemaVersion;
    document.title = c.branding.companyName + " — Bookkeeping";

    FW.$("#brandBtn").addEventListener("click", () => openView("dashboard"));
    FW.$("#hamburgerBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
    FW.$("#backdrop").addEventListener("click", () => document.body.classList.remove("nav-open"));
    document.addEventListener("keydown", e => { if (e.key === "Escape") document.body.classList.remove("nav-open"); });
    FW.$("#themeBtn").addEventListener("click", toggleMode);

    buildNav();
    refreshBadges();
    applyModeIcon();
  }

  function buildNav() {
    const scroll = FW.$("#sideScroll");
    scroll.innerHTML = "";
    const group = label => {
      const g = FW.el("div");
      g.appendChild(FW.el("div", "nav-group-label", label));
      scroll.appendChild(g);
      return g;
    };
    const item = (key, label, chipTxt) => {
      const b = FW.el("button", "nav-item", null, { "data-nav": key, "data-key": key, "aria-label": label });
      b.innerHTML = '<span class="nav-icon">' + icon(key === "dashboard" ? "dashboard" : key === "roadmap" ? "roadmap" : key) + "</span>" +
        '<span class="nav-label">' + esc(label) + "</span>" +
        (chipTxt ? '<span class="nav-chip" data-chip="' + esc(key) + '"></span>' : "");
      b.addEventListener("click", () => { openView(key); document.body.classList.remove("nav-open"); });
      scroll.appendChild(b);
      return b;
    };
    const g1 = group("Workspace");
    item("dashboard", "Dashboard");
    item("roadmap", "Roadmap");
    const g2 = group("Modules");
    for (const p of state.features) item(p.key, p.nav || p.name);
    const g3 = group("Resources");
    item("manual", "Manual");
  }

  function refreshBadges() {
    const navBtns = FW.$$(".nav-item");
    navBtns.forEach(b => b.classList.toggle("active", b.getAttribute("data-key") === state.view));
  }

  /* ── view switching ──────────────────────────────────────────────────── */
  function openView(key) {
    try { if (location.hash !== "#" + key) history.replaceState(null, "", "#" + key); } catch (e) {}
    if (key === "roadmap") { renderRoadmap(); return; }
    if (key === "manual") { renderManual(); return; }
    if (key === "dashboard") { renderDashboard(); return; }
    const phase = state.features.find(p => p.key === key);
    if (phase) {
      if (key === "ledger" && window.Ledger && window.Ledger.render) {
        state.view = key;
        refreshBadges();
        window.Ledger.render(state.mainEl);
        return;
      }
      if (key === "ap" && window.AP && window.AP.render) {
        state.view = key;
        refreshBadges();
        window.AP.render(state.mainEl);
        return;
      }
      const mod = (window.Modules || {})[key];
      if (mod && mod.render) {
        state.view = key;
        refreshBadges();
        mod.render(state.mainEl);
        return;
      }
      renderModule(phase); return;
    }
    renderDashboard();
  }

  function setTitle(eyebrow, title, ledeHtml) {
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", esc(eyebrow)));
    head.appendChild(FW.el("h1", null, null, { text: title }));
    if (ledeHtml) head.appendChild(FW.el("p", "lede", ledeHtml));
    return head;
  }

  function bindCheckboxes(rootEl) {
    rootEl.addEventListener("change", e => {
      const input = e.target.closest && e.target.closest('input[type="checkbox"]');
      if (!input || !input.hasAttribute("data-id")) return;
      setFeatureStatus(Number(input.getAttribute("data-id")), input.checked ? "done" : "pending");
    });
  }

  /* ── views ───────────────────────────────────────────────────────────── */
  function renderDashboard() {
    const m = state.mainEl;
    state.view = "dashboard";
    refreshBadges();
    const c = state.cfg;

    let html = "";
    html += '<section class="welcome-card card">' +
      '<span class="eyebrow">Small-business bookkeeping</span>' +
      "<h1>Welcome to " + esc(c.branding.companyName) + "</h1>" +
      '<p class="lede">' + esc(c.branding.tagline) +
      " Everything runs in your browser: a double-entry general ledger, accounts payable &amp; receivable, multi-currency taxes, payroll, inventory, reports and project costing. No account, no server — your books live on this device." + "</p>" +
      '<div class="row-flex">' +
      '<button class="btn btn-primary" data-go="manual">Read the manual</button>' +
      '<button class="btn btn-ghost" data-go="ledger">Open the ledger</button>' +
      "</div></section>";

    html += '<div class="section-head"><h2>Features</h2><span class="muted small">' + state.features.length + " modules · " + featureCount() + " features</span></div>";
    html += '<div class="phase-grid">';
    for (const p of state.features) {
      const labels = p.items.map(it => stripVerb(it.task));
      html += '<div class="phase-card card">' +
        '<div class="phase-card-top"><span class="icon-tile">' + icon(p.icon) + "</span><div style='min-width:0'><h3>" + esc(p.nav) +
        "</h3><div class='small muted mono'>" + p.items[0].id + "–" + p.items[p.items.length - 1].id + "</div></div></div>" +
        '<p class="blurb">' + esc(p.blurb) + "</p>" +
        '<ul class="feat-list">' + labels.map(l => "<li>" + esc(l) + "</li>").join("") + "</ul>" +
        '<div class="phase-card-foot"><span class="phase-num">' + p.items.length + " features</span>" +
        '<button class="btn btn-ghost btn-sm" data-go="' + esc(p.key) + '">Open</button></div>' +
        "</div>";
    }
    html += "</div>";

    m.innerHTML = html;
    m.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => openView(b.getAttribute("data-go"))));
  }

  function featureCount() {
    let n = 0;
    for (const p of state.features) n += p.items.length;
    return n;
  }

  function stripVerb(s) {
    return String(s || "").replace(/^(Define|Create|Implement|Develop|Generate|Track|Manage|Automate|Integrate|Process|Establish|Calculate|Extract|Compute|Enable|Produce|Display|Aggregate|Compose)\s+/i, "").trim();
  }

  /* ── manual ──────────────────────────────────────────────────────────── */
  const MANUAL_OVERVIEW = [
    "The Ledger is a complete small-business bookkeeping application that runs entirely in your browser. Everything you record — accounts, journal entries, invoices, bills, pay runs — flows into one double-entry general ledger, so the books always balance.",
    "Every module is a workflow on top of that core. An invoice you send, a bill you pay, or a payroll run you post all create journal entries you can inspect in the General Ledger and see roll up in Reports."
  ];

  const MANUAL_DATA = [
    "All data is stored locally in this browser with the kv-plugin (IndexedDB). There is no server, no account and no login — your books live on this device and survive page reloads.",
    "Because storage is per-browser, opening the app in a different browser or device starts with fresh books. Nothing you enter is sent anywhere."
  ];

  const MANUAL_MODULES = [
    {
      key: "ledger",
      name: "General Ledger",
      what: "The double-entry core. Every transaction is a balanced journal entry (debits = credits) posted to the chart of accounts, with an append-only audit trail.",
      areas: ["Journal", "Balances", "Periods", "Trial balance", "Audit"],
      workflow: [
        "Record transactions in the Journal — an entry must balance (total debits = total credits) before it can be posted.",
        "Watch Balances update in real time as entries post, and run the Trial balance to confirm the books balance as of any date.",
        "Close a Period to lock a date range and carry net income into retained earnings.",
        "The Audit tab is the immutable trail of every entry created, edited, voided or posted."
      ],
      tip: "Posted entries can't be edited — void them instead. The voided entry stays in the audit trail, so nothing is ever silently removed."
    },
    {
      key: "ap",
      name: "Accounts Payable",
      what: "Pay what you owe: purchase orders, vendor bills, recurring expenses, payments by ACH or check, and A/P aging.",
      areas: ["Purchase orders", "Bills", "Recurring", "Aging"],
      workflow: [
        "Create a Purchase order, then convert it to a bill when it arrives — or enter a bill directly.",
        "Line-item matching flags quantity / price / amount variances between the PO and the bill.",
        "Pay a bill to mark it paid and post the ledger entry (DR A/P, CR cash) with an ACH or check reference.",
        "Aging groups unpaid bills by days past due so nothing slips."
      ],
      tip: "Attach a project to a bill to attribute the cost in Project Costing. Recurring rules auto-generate draft bills on schedule."
    },
    {
      key: "ar",
      name: "Accounts Receivable",
      what: "Get paid: quotes into invoices, recurring billing, payment capture, reminders and A/R aging.",
      areas: ["Invoices", "Quotes", "Customers", "Recurring", "Aging"],
      workflow: [
        "Add a Customer, then send a Quote and convert it to an invoice with one action (or create an invoice directly).",
        "Invoice line items compute tax automatically from your Tax & Currency rules.",
        "Posting records DR A/R, CR revenue + tax; Record payment captures card, bank, cash or check.",
        "Aging shows open and overdue invoices; reminders list what's due or past due."
      ],
      tip: "Invoices with inventory items automatically reduce stock and post a COGS entry (DR COGS, CR Inventory)."
    },
    {
      key: "tax",
      name: "Tax & Currency",
      what: "One global base currency with per-currency exchange rates, jurisdiction-aware sales-tax rules, and a tax preparation report.",
      areas: ["Currencies", "Tax rates", "Tax report"],
      workflow: [
        "Set the base currency and exchange rates — totals are always stored in the base currency.",
        "Define tax rules (GST / HST / PST / VAT / US Sales Tax) by jurisdiction, rate and validity date.",
        "Invoices and bills pick up the applicable rule automatically and route the tax to the Tax Payable (2100) liability account on posting.",
        "The Tax report aggregates output vs input tax by type and jurisdiction over a date range."
      ],
      tip: "Each AR/AP document keeps its own currency and exchange rate, so a foreign-currency invoice converts to the base currency at the rate in effect at entry."
    },
    {
      key: "ocr",
      name: "Receipt Capture",
      what: "Upload a photo of a receipt, invoice or bill; the AI extracts the fields, suggests a category, you verify, and it commits to the ledger.",
      areas: ["Documents", "How it works"],
      workflow: [
        "Upload or drag an image — the AI extracts vendor, date, total and line items (can take ~30 seconds).",
        "Review and correct the fields side-by-side with the original document.",
        "Commit as a draft bill (Accounts Payable) or a draft journal entry.",
        "The document stays linked to the resulting ledger entry for audit."
      ],
      tip: "Clear, well-lit photos extract more accurately — the app suggests a chart-of-accounts category from the vendor and keywords."
    },
    {
      key: "payroll",
      name: "Payroll",
      what: "Employees, timesheets, pay runs with withholdings, payslips, and payroll ledger integration.",
      areas: ["Employees", "Timesheets", "Pay runs", "Payslips"],
      workflow: [
        "Add employees with hourly or salary rates and federal / state / other withholding percentages.",
        "Record a Timesheet, submit it, then approve it.",
        "Run a pay period — gross pay, withholdings and net pay are computed per employee.",
        "Posting debits payroll expense and credits cash (net) plus the withholding liability accounts; read-only Payslips are generated for each employee."
      ],
      tip: "The posting is a single balanced entry (DR 5600, CR 1010 cash + CR 2210 / 2220 / 2200 liabilities), so a pay run lands in the ledger cleanly."
    },
    {
      key: "reports",
      name: "Reports & KPIs",
      what: "Financial statements built from posted ledger data: KPI dashboard, P&L, balance sheet, cash flow and aging.",
      areas: ["Dashboard", "P&L", "Balance Sheet", "Cash Flow", "Aging"],
      workflow: [
        "The KPI Dashboard shows revenue, expenses, cash, receivables and payables at a glance.",
        "Run the P&L over a date range; the Balance Sheet is point-in-time as of a chosen date.",
        "Cash Flow (indirect) reconciles net income to the change in cash across operating, investing and financing.",
        "Aging breaks receivables and payables into 0 / 1–30 / 31–60 / 61–90 / 90+ buckets."
      ],
      tip: "Reports include only posted entries dated on or before the as-of date, so future-dated entries don't distort them."
    },
    {
      key: "inventory",
      name: "Inventory & COGS",
      what: "A weighted-average item catalog: purchases raise stock and cost basis, posted invoices reduce stock and post COGS, and valuation prices on-hand at average cost.",
      areas: ["Items", "Movements", "Valuation & COGS"],
      workflow: [
        "Add items with a SKU, unit of measure and price.",
        "Record Movements — purchase in, sale out, or adjustment — which update quantity and weighted-average cost.",
        "The Valuation & COGS tab prices the on-hand quantity at average cost and reports COGS for a period."
      ],
      tip: "When a posted invoice contains inventory items, stock and COGS update automatically (DR 5000 / CR 1200); voiding the invoice reverses it."
    },
    {
      key: "projects",
      name: "Projects & Jobs",
      what: "Tag revenue and expenses to specific projects across invoices, bills and journal entries, then measure per-project profit.",
      areas: ["Projects", "How it works"],
      workflow: [
        "Create a project with a code, color and status.",
        "Pick the project when creating an invoice, bill or journal entry.",
        "The project page rolls up attributed revenue, expenses, profit and margin percentage."
      ],
      tip: "Attribution happens at entry time — a project only shows income and costs you explicitly tagged to it."
    }
  ];

  function renderManual() {
    const m = state.mainEl;
    state.view = "manual";
    refreshBadges();
    m.innerHTML = "";
    m.appendChild(setTitle("Documentation", "User manual",
      "How to use each module of " + esc(state.cfg.branding.companyName) + " — from the double-entry core to project costing."));

    const wrap = FW.el("div", "stack");
    m.appendChild(wrap);

    const overview = FW.el("div", "card stack", null);
    overview.style.cssText = "padding:18px";
    overview.innerHTML = "<h3 style='font-size:15px;margin:0'>Overview</h3>" +
      MANUAL_OVERVIEW.map(p => "<p class='small' style='margin:0'>" + esc(p) + "</p>").join("");
    wrap.appendChild(overview);

    for (const mod of MANUAL_MODULES) {
      const ph = state.features.find(p => p.key === mod.key);
      const sec = FW.el("div", "card", null);
      sec.style.cssText = "padding:18px";
      let h = '<div class="phase-card-top" style="margin-bottom:6px"><span class="icon-tile">' + icon(ph ? ph.icon : mod.key) + "</span>" +
        '<div style="min-width:0"><h3 style="margin:0">' + esc(mod.name) + "</h3>" +
        (ph ? "<div class='small muted mono'>" + ph.items[0].id + "–" + ph.items[ph.items.length - 1].id + "</div>" : "") +
        "</div></div>" +
        '<p class="small muted" style="margin:0 0 6px">' + esc(mod.what) + "</p>";
      h += '<div class="manual-h">Areas</div><div class="chip-row">' + mod.areas.map(a => '<span class="chip chip-muted">' + esc(a) + "</span>").join("") + "</div>";
      h += '<div class="manual-h">Typical workflow</div><ol class="manual-ol">' + mod.workflow.map(s => "<li>" + esc(s) + "</li>").join("") + "</ol>";
      h += '<div class="manual-h">Tip</div><p class="small" style="margin:0">' + esc(mod.tip) + "</p>";
      sec.innerHTML = h;
      wrap.appendChild(sec);
    }

    const dataSec = FW.el("div", "card stack", null);
    dataSec.style.cssText = "padding:18px";
    dataSec.innerHTML = "<h3 style='font-size:15px;margin:0'>Your data &amp; privacy</h3>" +
      MANUAL_DATA.map(p => "<p class='small' style='margin:0'>" + esc(p) + "</p>").join("");
    wrap.appendChild(dataSec);
  }

  function renderRoadmap() {
    const m = state.mainEl;
    state.view = "roadmap";
    refreshBadges();
    const { done, total } = totals();
    const pct = total ? Math.round((done / total) * 100) : 0;

    m.innerHTML = "";
    m.appendChild(setTitle("Development roadmap",
      "Features checklist",
      "The full atomic plan lives in <code class='mono'>src/ROADMAP.md</code> and is mirrored here from the <code class='mono'>features</code> list in main.pjs. Tick items to preview status; toggles are remembered in this browser (Reset restores main.pjs)."));

    const controls = FW.el("div", "spread card", null);
    controls.style.cssText = "padding:12px 16px;margin-bottom:18px";
    controls.innerHTML = '<div class="row-flex" style="flex:1;min-width:200px"><span class="stat-value" style="font-size:19px">' + done +
      '<span class="muted" style="font-weight:600"> / ' + total + "</span></span>" +
      '<div class="bar bar-lg" style="flex:1;min-width:120px"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="muted small mono">' + pct + "%</span></div>" +
      '<button class="btn btn-ghost btn-sm" id="resetProgressBtn">Reset browser toggles</button>';
    m.appendChild(controls);

    const wrap = FW.el("div", "stack");
    m.appendChild(wrap);
    for (const p of state.features) wrap.appendChild(phaseGroup(p, true));
    bindCheckboxes(m);

    m.querySelector("#resetProgressBtn").addEventListener("click", confirmReset);
  }

  function renderModule(phase) {
    const m = state.mainEl;
    state.view = phase.key;
    refreshBadges();
    m.innerHTML = "";
    const pc = phaseCounts(phase.key);
    const full = pc.total > 0 && pc.done === pc.total;
    m.appendChild(setTitle("Module — " + phase.name.replace(/^Phase \d+ ·\s*/, ""),
      phase.nav, esc(phase.blurb) + ' <span class="chip chip-phase" style="vertical-align:2px">' + (full ? "complete" : pc.done + " / " + pc.total + " built") + "</span>"));
    m.appendChild(FW.el("p", "note",
      "This module is complete — every task in its phase was implemented and validated, each flipping its <code class='mono'>status = done</code> entry in main.pjs. The checklist below is this module's feature map."));
    const wrap = FW.el("div", "stack");
    wrap.style.cssText = "margin-top:16px";
    wrap.appendChild(phaseGroup(phase, false));
    m.appendChild(wrap);
  }

  /* ── checklist building blocks ───────────────────────────────────────── */
  function phaseGroup(phase, collapsible) {
    const g = FW.el("div", "card cl-group");
    g.setAttribute("data-phase", phase.key);
    const pc = phaseCounts(phase.key);
    const allDone = pc.total > 0 && pc.done === pc.total;

    const head = FW.el("div", "cl-group-head");
    head.innerHTML =
      '<span class="icon-tile" style="width:38px;height:38px;border-radius:11px">' + icon(phase.icon) + "</span>" +
      '<div class="grow"><div class="cl-group-title"><h3>' + esc(phase.name) +
      (allDone ? ' <span class="chip chip-done">complete</span>' : "") + "</h3></div>" +
      '<div class="cl-blurb">' + esc(phase.blurb) + "</div></div>" +
      '<span class="cl-group-count" data-role="group-count">' + pc.done + " / " + pc.total + "</span>" +
      (collapsible ? '<span class="chev" style="display:grid;place-items:center;color:var(--text-muted);transition:transform .2s">' + icon("chev") + "</span>" : "");
    g.appendChild(head);
    head.style.cursor = collapsible ? "pointer" : "default";
    if (collapsible) head.addEventListener("click", () => {
      const open = !g.classList.contains("collapsed");
      g.classList.toggle("collapsed", open);
      const chev = head.querySelector(".chev");
      if (chev) chev.style.transform = open ? "rotate(180deg)" : "";
    });

    const body = FW.el("div", "cl-group-body");
    g.appendChild(body);
    const barRow = FW.el("div", "cl-progress");
    barRow.innerHTML = '<div class="bar"><div class="bar-fill" data-role="phase-bar" style="width:' +
      (pc.total ? Math.round((pc.done / pc.total) * 100) : 0) + '%"></div></div>';
    body.appendChild(barRow);

    for (const it of phase.items) {
      const doneSt = (state.map[it.id] || it.status) === "done";
      const row = FW.el("div", "cl-row" + (doneSt ? " done" : ""), null, { "data-id": it.id });
      row.innerHTML =
        '<label class="check" aria-label="Task ' + it.id + '"><input type="checkbox" data-id="' + it.id + '"' + (doneSt ? " checked" : "") + "><span class='box'></span></label>" +
        '<span class="cl-num">' + it.id + "</span>" +
        '<div class="cl-main"><div class="cl-task">' + esc(it.task) + "</div>" +
        '<div class="cl-detail">' + esc(it.detail) + "</div></div>" +
        '<span class="cl-side"><span class="chip ' + (doneSt ? "chip-done" : "chip-pending") + '" data-role="status-chip">' + (doneSt ? "done" : "pending") + "</span></span>";
      body.appendChild(row);
    }
    return g;
  }

  function updateGroupLocally(id, status) {
    const row = FW.$('#mainEl .cl-row[data-id="' + id + '"]');
    if (!row) return;
    row.classList.toggle("done", status === "done");
    const input = row.querySelector('input[type="checkbox"]');
    if (input) input.checked = status === "done";
    const chip = row.querySelector('[data-role="status-chip"]');
    if (chip) { chip.textContent = status; chip.className = "chip " + (status === "done" ? "chip-done" : "chip-pending"); }
    const g = row.closest(".cl-group");
    if (g) {
      const key = g.getAttribute("data-phase");
      const pc = phaseCounts(key);
      const count = g.querySelector('[data-role="group-count"]');
      if (count) count.textContent = pc.done + " / " + pc.total;
      const bar = g.querySelector('[data-role="phase-bar"]');
      if (bar) bar.style.width = (pc.total ? Math.round((pc.done / pc.total) * 100) : 0) + "%";
    }
  }

  /* ── status management ───────────────────────────────────────────────── */
  async function loadState() {
    state.cfg = FW.readConfig();
    state.features = FW.readFeatures();
    for (const p of state.features) for (const it of p.items) state.base[it.id] = it.status;
    try { state.overrides = (await FW.store.get("roadmap", {})) || {}; } catch (e) { state.overrides = {}; }
    rebuildMap();
    const ui = (await FW.store.get("ui", {})) || {};
    const sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    state.mode = ui.themeMode || (state.cfg.theme.mode === "light" && sysDark ? "dark" : state.cfg.theme.mode);
  }
  function rebuildMap() {
    state.map = {};
    for (const id in state.base) state.map[id] = state.overrides[id] || state.base[id];
  }
  async function setFeatureStatus(id, status) {
    if (status !== "done" && status !== "pending") return;
    const base = state.base[id];
    if (base == null) return;
    if (status === base) delete state.overrides[id];
    else state.overrides[id] = status;
    rebuildMap();
    try { await FW.store.set("roadmap", state.overrides); } catch (e) {}
    updateGroupLocally(id, status);
    refreshBadges();
    if (state.view === "dashboard") renderDashboard();
  }
  function confirmReset() {
    const modal = FW.modal(
      '<div class="modal-head"><h3>Reset browser toggles?</h3>' +
      '<button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body"><p style="margin-top:0">Clears the per-browser task toggles stored via kv-plugin, so the checklist returns to the statuses written in <code class="mono">main.pjs → features</code>.</p>' +
      '<div class="row-flex"><button class="btn btn-danger btn-sm" id="confirmResetBtn">Reset toggles</button>' +
      '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div></div>');
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#confirmResetBtn").addEventListener("click", async () => {
      try { await FW.store.del("roadmap"); } catch (e) {}
      state.overrides = {};
      rebuildMap();
      modal.closest(".modal-back").remove();
      renderRoadmap();
      refreshBadges();
      FW.toast("Roadmap restored to main.pjs statuses");
    });
  }

  /* ── theme mode ──────────────────────────────────────────────────────── */
  async function toggleMode() {
    state.mode = state.mode === "dark" ? "light" : "dark";
    FW.applyTheme(state.cfg, state.mode);
    applyModeIcon();
    try { await FW.store.set("ui", { themeMode: state.mode }); } catch (e) {}
    FW.toast(state.mode === "dark" ? "Dark mode on" : "Light mode on");
  }
  function applyModeIcon() {
    const t = FW.$("#themeIcon");
    if (t) {
      t.innerHTML = icon(state.mode === "dark" ? "sun" : "moon");
      FW.$("#themeBtn").setAttribute("aria-label", state.mode === "dark" ? "Switch to light mode" : "Switch to dark mode");
    }
  }

  /* ── boot ────────────────────────────────────────────────────────────── */
  async function boot() {
    state.mainEl = FW.$("#mainEl");
    if (!state.mainEl) return;
    await loadState();
    FW.applyTheme(state.cfg, state.mode);
    renderChrome();
    applyModeIcon();

    let start = state.cfg.app.defaultView || "dashboard";
    if (location.hash && location.hash.length > 1) start = decodeURIComponent(location.hash.slice(1));
    if (!state.features.some(p => p.key === start) && !["dashboard", "roadmap", "manual"].includes(start)) start = "dashboard";
    openView(start);

    window.addEventListener("hashchange", () => {
      const k = decodeURIComponent(location.hash.slice(1));
      if (k && (k === "dashboard" || k === "roadmap" || k === "manual" || state.features.some(p => p.key === k))) openView(k);
    });
  }

  window.Ledgerly = {
    get cfg() { return state.cfg; },
    get features() { return state.features; },
    get progress() { return totals(); },
    openView,
    setFeatureStatus,
    async resetProgress() {
      try { await FW.store.del("roadmap"); } catch (e) {}
      state.overrides = {}; rebuildMap();
      openView(state.view); refreshBadges();
    },
    currentView: () => state.view,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
