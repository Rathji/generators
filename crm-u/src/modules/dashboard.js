window.CRM_RENDERERS = window.CRM_RENDERERS || {};

async function renderDashboard(ctx) {
  const { moduleList } = ctx;

  const others = moduleList.filter(m => m.id !== "dashboard" && !m.hidden);
  const moduleCards = others.map(m => `
    <button class="module-card" data-go="${m.id}">
      <span class="mc-top"><span class="mc-icon">${m.icon}</span><span class="mc-name">${m.label}</span></span>
      <span class="mc-tag">${m.tagline}</span>
      <span class="mc-go">Open ${m.label} →</span>
    </button>
  `).join("");

  const st = window.SELFTEST.lastResults;
  const failing = st ? st.filter(r => !r.pass && !r.skip).length : 0;
  const stBadge = st
    ? (failing === 0
        ? '<span class="st-badge pass">All self-tests passing</span>'
        : `<span class="st-badge fail">${failing} self-test${failing === 1 ? "" : "s"} failing</span>`)
    : '<span class="st-badge idle">Never run</span>';
  const passN = st ? st.filter(r => r.pass).length : 0;
  const skipN = st ? st.filter(r => r.skip).length : 0;
  const totalN = st ? st.length : 0;

  let storeRow = '<span class="sys-v muted">no store</span>';
  let storeHint = "This is the CRM application frame. The document store, sync layer, records and pipeline logic arrive in the next build stages.";
  let buildStage = "module shell";
  let lastSync = "not yet";
  let storeOk = false;
  let conflictsZone = null;
  let backupZone = null;
  let capacityZone = null;
  let healthZone = null;
  const crm = window.CRM;
  if (crm && crm.store) {
    const ready = crm.storeReady || Promise.resolve(null);
    const boot = await ready.catch(() => null);
    if (boot && boot.ok !== false) {
      storeOk = true;
      let sum = await crm.store.statusSummary().catch(() => null);
      if (sum) {
        const c0 = sum.counts;
        if ((c0.pending > 0 || c0.conflict > 0) && crm.store.reconcileAll) {
          await crm.store.reconcileAll().catch(() => null);
          sum = await crm.store.statusSummary().catch(() => null);
        }
      }
      if (sum) {
        const c = sum.counts;
        if (c.total > 0 && c.none === c.total) {
          storeRow = '<span class="sys-v muted">not configured yet</span>';
        } else {
          const bits = [];
          if (c.synced) bits.push(c.synced + " synced");
          if (c.localOnly) bits.push(c.localOnly + " local-only");
          if (c.pending) bits.push(`<span class="txt-warn">${c.pending} pending</span>`);
          if (c.conflict) bits.push(`<span class="txt-danger">${c.conflict} conflict${c.conflict === 1 ? "" : "s"}</span>`);
          if (c.diverged) bits.push(c.diverged + " diverged");
          if (c.problem) bits.push(c.problem + " errors");
          storeRow = '<span class="sys-v">' + bits.join(" · ") + "</span>";
        }
        if (sum.info.lastReconcileAt) {
          lastSync = (window.CRM_SYNC ? window.CRM_SYNC.timeAgo(sum.info.lastReconcileAt) : new Date(sum.info.lastReconcileAt).toLocaleTimeString());
        }
        buildStage = "sync, conflict handling, backup & archive";
        storeHint = "Each module persists as a versioned JSON document (upload-plugin editable, auto-split when large) with a local kv cache. On startup every cache is reconciled against its canonical document: edits made here are published, and documents edited on more than one device since the last sync get keep-mine / keep-theirs / field-level-merge resolution — nothing is overwritten silently. Full backup & restore and the capacity & archival panels live below.";
        if (window.CRM_SYNC && window.CRM_SYNC.conflictBlocks) {
          conflictsZone = await window.CRM_SYNC.conflictBlocks(crm.store, {
            onChange: (module, res) => {
              if (window.CRM.rerender) window.CRM.rerender();
            }
          }).catch(() => null);
        }
        if (window.CRM_BACKUP && window.CRM_BACKUP.renderZone) {
          backupZone = await window.CRM_BACKUP.renderZone(crm.store).catch(() => null);
        }
        if (window.CRM_CAPACITY && window.CRM_CAPACITY.renderZone) {
          capacityZone = await window.CRM_CAPACITY.renderZone(crm.store).catch(() => null);
        }
        if (window.CRM_HEALTH && typeof window.CRM_HEALTH.zone === "function") {
          healthZone = await window.CRM_HEALTH.zone(crm.store).catch(() => null);
        }
      }
    } else if (boot && boot.code) {
      storeRow = '<span class="sys-v muted">store unavailable</span>';
      storeHint = "Document store failed to initialise: " + (boot.detail || boot.code) + ".";
    }
  }

  const syncActions = storeOk
    ? '<div style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-syncnow>Sync now</button></div>'
    : "";

  let kpiZone = null;
  let svcZone = null;
  if (storeOk) {
    try {
      const docs = {};
      for (const m of ["deals", "activities", "services"]) {
        try {
          docs[m] = await crm.store.loadDoc(m);
        } catch (e) {
          docs[m] = null;
        }
      }
      const drecs = (docs.deals && docs.deals.content && Array.isArray(docs.deals.content.records)) ? docs.deals.content.records : [];
      const arecs = (docs.activities && docs.activities.content && Array.isArray(docs.activities.content.records)) ? docs.activities.content.records : [];
      const srecs = (docs.services && docs.services.content && Array.isArray(docs.services.content.records)) ? docs.services.content.records : [];
      const isOpen = d => !!d && !!d.stage && d.stage !== "won" && d.stage !== "lost";
      const isWon = d => !!d && d.stage === "won";
      const isLost = d => !!d && d.stage === "lost";
      const expOf = d => {
        const n = Number(d && d.expectedValue);
        return d && d.expectedValue !== undefined && d.expectedValue !== null && d.expectedValue !== "" && isFinite(n) && n >= 0 ? n : 0;
      };
      const probOf = d => {
        const n = Number(d && d.probability);
        if (d && d.probability !== undefined && d.probability !== null && d.probability !== "" && isFinite(n)) return Math.max(0, Math.min(100, n));
        return 100;
      };
      const open = drecs.filter(isOpen);
      const won = drecs.filter(isWon);
      const lost = drecs.filter(isLost);
      const pipeValue = open.reduce((a, d) => a + expOf(d), 0);
      const weighted = open.reduce((a, d) => a + expOf(d) * probOf(d) / 100, 0);
      const winRate = won.length + lost.length ? Math.round(1000 * won.length / (won.length + lost.length)) / 10 : null;
      let cycle = null;
      if (won.length) {
        const days = won.map(d => {
          const w = new Date(d.wonAt).getTime();
          const c = new Date(d.createdAt).getTime();
          if (isNaN(w) || isNaN(c)) return null;
          return (w - c) / 86400000;
        }).filter(v => v !== null && v >= 0);
        if (days.length) cycle = Math.round(10 * days.reduce((a, b) => a + b, 0) / days.length) / 10;
      }
      let overdueN = 0;
      try {
        if (window.CRM_REMINDERS && typeof window.CRM_REMINDERS.counts === "function") {
          const rc = await window.CRM_REMINDERS.counts(crm.store);
          overdueN = rc.overdue || 0;
        }
      } catch (e) {}
      const d = new Date();
      const p = n => String(n).padStart(2, "0");
      const today = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
      const locDate = iso => {
        const x = new Date(iso);
        if (isNaN(x.getTime())) return "";
        return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
      };
      const todayActs = arecs.filter(a => locDate(a.at || a.createdAt) === today).length;
      const money = n => "$" + Math.round(n).toLocaleString();
      const kpi = (href, v, label, sub, cls) => `
        <a class="kpi-card ${cls || ""}" href="${href}" data-kpi="${href.replace(/[^a-z0-9]+/gi, "")}">
          <span class="kpi-v">${v}</span>
          <span class="kpi-l">${label}</span>
          <span class="kpi-s">${sub}</span>
        </a>`;
      const zone = document.createElement("section");
      zone.className = "card dash-kpis";
      zone.innerHTML = `
        <div class="card-title-row">
          <div>
            <h2>Pipeline at a glance</h2>
            <p class="hint" style="margin:2px 0 0">Live numbers from your documents — click any card for the list behind it.</p>
          </div>
        </div>
        <div class="kpi-grid">
          ${kpi("#/deals/open", money(pipeValue), "Pipeline value", "expected value of open deals")}
          ${kpi("#/deals/open", money(weighted), "Weighted forecast", "expected value × probability")}
          ${kpi("#/deals/open", open.length, "Open deals", "in an active pipeline stage")}
          ${kpi("#/deals/won", winRate === null ? "—" : winRate + "%", "Win rate", winRate === null ? "no closed deals yet" : won.length + " won · " + lost.length + " lost")}
          ${kpi("#/deals/won", cycle === null ? "—" : cycle + " days", "Avg deal cycle", cycle === null ? "no won deals yet" : "open to won, per won deal")}
          ${kpi("#/reminders/overdue", overdueN, "Overdue follow-ups", overdueN === 1 ? "task past its due date" : "tasks past their due date")}
          ${kpi("#/activities", todayActs, "Activities today", todayActs === 1 ? "interaction logged today" : "calls, emails, notes & tasks logged today")}
        </div>`;
      kpiZone = zone;

      const D = window.CRM_DOMAIN;
      if (D && typeof D.summarize === "function") {
        const ss = D.summarize(srecs);
        const svcKpi = (href, v, label, sub) => `
          <a class="kpi-card" href="${href}">
            <span class="kpi-v">${v}</span>
            <span class="kpi-l">${label}</span>
            <span class="kpi-s">${sub}</span>
          </a>`;
        const catBits = Object.keys(ss.byCategory).filter(k => ss.byCategory[k] > 0)
          .sort((a, b) => ss.byCategory[b] - ss.byCategory[a])
          .map(k => D.categoryShort(k) + " " + money(ss.byCategory[k])).join(" · ");
        const sz = document.createElement("section");
        sz.className = "card dash-kpis";
        sz.dataset.dashServices = "1";
        sz.innerHTML = `
          <div class="card-title-row">
            <div>
              <h2>Recurring revenue</h2>
              <p class="hint" style="margin:2px 0 0">Every service you provide, normalised to a monthly figure — internet circuits, VoIP seats, SIP trunks, managed IT, cloud and hardware.</p>
            </div>
            <a class="btn btn-ghost btn-sm" href="#/services" data-svc-open>Open service book</a>
          </div>
          <div class="kpi-grid">
            ${svcKpi("#/services", money(ss.mrr), "MRR", "monthly recurring revenue")}
            ${svcKpi("#/services", money(ss.arr), "ARR", "annual run rate")}
            ${svcKpi("#/services", ss.active, "Active services", ss.count + " in the book")}
            ${svcKpi("#/services", ss.renewingSoon, "Renewing soon", "inside the next 60 days")}
            ${svcKpi("#/services", ss.suspended, "Suspended", "paused but not terminated")}
          </div>
          ${catBits ? `<p class="hint" style="margin:10px 2px 0">By service type: ${catBits}</p>` : (ss.count ? "" : '<p class="hint" style="margin:10px 2px 0">No services yet — add the internet, VoIP and IT services you provide to see recurring revenue here.</p>')}`;
        svcZone = sz;
      }
    } catch (e) {
      kpiZone = null;
      console.error("dashboard KPI section failed:", e);
    }
  }

  let opsZone = null;
  if (storeOk) {
    try {
      const docMap = {};
      for (const m of ["tickets", "sites", "assets"]) {
        try { docMap[m] = await crm.store.loadDoc(m); } catch (e) { docMap[m] = null; }
      }
      const rr = m => (docMap[m] && docMap[m].content && Array.isArray(docMap[m].content.records)) ? docMap[m].content.records : [];
      const Dm = window.CRM_DOMAIN;
      const ts = Dm && Dm.summarizeTickets ? Dm.summarizeTickets(rr("tickets")) : { open: 0, overdue: 0, unassigned: 0, count: 0 };
      const sites = rr("sites");
      const assets = rr("assets");
      const openSites = sites.filter(s => s.status === "active").length;
      const assignedAssets = assets.filter(a => a.status === "assigned" || a.status === "reserved").length;
      const availAssets = assets.filter(a => a.status === "available").length;
      const okpi = (href, v, label, sub, cls) => `<a class="kpi-card ${cls || ""}" href="${href}"><span class="kpi-v">${v}</span><span class="kpi-l">${label}</span><span class="kpi-s">${sub}</span></a>`;
      const oz = document.createElement("section");
      oz.className = "card dash-kpis";
      oz.dataset.dashOps = "1";
      oz.innerHTML = `
        <div class="card-title-row">
          <div>
            <h2>Operations</h2>
            <p class="hint" style="margin:2px 0 0">The service desk and the estate behind it — open tickets, SLA pressure, sites and inventory.</p>
          </div>
          <a class="btn btn-ghost btn-sm" href="#/tickets" data-ops-open>Open service desk</a>
        </div>
        <div class="kpi-grid">
          ${okpi("#/tickets", ts.open, "Open tickets", ts.count + " in total")}
          ${okpi("#/tickets/overdue", ts.overdue, "SLA overdue", ts.overdue === 1 ? "ticket past its SLA" : "tickets past SLA", ts.overdue ? "danger" : "")}
          ${okpi("#/tickets/unassigned", ts.unassigned, "Unassigned", "open, nobody on it")}
          ${okpi("#/sites", sites.length, "Sites", openSites + " active")}
          ${okpi("#/assets", assets.length, "Assets", assignedAssets + " assigned · " + availAssets + " available")}
        </div>`;
      opsZone = oz;
    } catch (e) {
      console.error("dashboard operations section failed:", e);
    }
  }

  let radarZone = null;
  if (storeOk && window.CRM_REMINDERS && typeof window.CRM_REMINDERS.counts === "function") {
    try {
      const c = await window.CRM_REMINDERS.counts(crm.store);
      const alertCard = (n, label, sub, go, cls) => `
        <button class="alert-card ${cls || ""}" data-rmgo="${go}">
          <span class="alert-n">${n}</span>
          <span class="alert-t">${label}</span>
          <span class="alert-s">${sub}</span>
        </button>`;
      const radar = document.createElement("section");
      radar.className = "card dash-alerts";
      radar.innerHTML = `
        <div class="card-title-row">
          <div>
            <h2>Follow-up radar</h2>
            <p class="hint" style="margin:2px 0 0">What needs your attention right now — open tasks and deals closing in the next 7 days.</p>
          </div>
          <div class="detail-acts">
            <a class="btn btn-ghost btn-sm" href="#/reminders/digest" data-radar-digest>Daily digest</a>
            <a class="btn btn-primary btn-sm" href="#/reminders" data-radar-open>Open reminders</a>
          </div>
        </div>
        <div class="alert-grid">
          ${alertCard(c.overdue, "Overdue follow-ups", "Tasks past their due date", "overdue", "alert-bad")}
          ${alertCard(c.due, "Due in 7 days", "Follow-ups coming up", "due")}
          ${alertCard(c.closing, "Deals closing", "Close dates inside the window", "closing")}
        </div>
        <div class="form-acts" style="margin:0">
          <a class="quiet-btn" href="#/rules" data-radar-rules>Automation rules →</a>
        </div>`;
      radarZone = radar;
    } catch (e) {
      radarZone = null;
    }
  }

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="dash-main">
      <section class="card">
        <div class="card-title-row">
          <h2>Modules</h2>
          <span class="chip">${others.length} modules</span>
        </div>
        <div class="dash-grid">${moduleCards}</div>
      </section>
      <aside class="dash-side">
        <section class="card">
          <div class="card-title-row" style="margin-bottom:6px">
            <h2>Workspace</h2>
          </div>
          <div class="sys-row"><span class="sys-k">Application</span><span class="sys-v">CRM-U</span></div>
          <div class="sys-row"><span class="sys-k">Build stage</span><span class="sys-v muted">${buildStage}</span></div>
          <div class="sys-row"><span class="sys-k">Data store</span>${storeRow}</div>
          <div class="sys-row"><span class="sys-k">Last sync</span><span class="sys-v muted">${lastSync}</span></div>
          <div class="sys-row"><span class="sys-k">Health</span><span class="sys-v"><span class="health-dot"></span>Online</span></div>
          <p class="hint">${storeHint}</p>
          ${syncActions}
        </section>
        <section class="card">
          <h2>Self-tests</h2>
          <p class="hint" style="margin-top:6px">Validates navigation, routing, states, drawer behavior, the document store layer, the sync / conflict engine, and backup / archive storage.</p>
          <div class="st-summary">${st ? `${stBadge}${skipN ? `<span class="st-badge skip">${skipN} skipped</span>` : ""}<span class="st-badge idle">${totalN} total</span>` : stBadge}</div>
          <div style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-run="selftests">Run self-tests</button></div>
        </section>
      </aside>
    </div>
  `;

  wrap.querySelectorAll("[data-go]").forEach(b => {
    b.addEventListener("click", () => ctx.navigate(b.dataset.go));
  });
  wrap.querySelectorAll("[data-run]").forEach(b => {
    b.addEventListener("click", () => window.CRM.runSelftests());
  });
  const syncBtn = wrap.querySelector("[data-syncnow]");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing…";
      try {
        const res = await crm.store.reconcileAll();
        const conflictN = Object.keys(res).filter(m => res[m].state === "conflict").length;
        window.CRM.toast(conflictN ? `Sync complete — ${conflictN} document${conflictN === 1 ? "" : "s"} need conflict resolution` : "All documents in sync");
      } catch (e) {
        window.CRM.toast("Sync failed: " + ((e && e.message) || e));
      }
      if (window.CRM.rerender) window.CRM.rerender();
    });
  }
  if (radarZone) {
    radarZone.querySelectorAll("[data-rmgo]").forEach(b => {
      b.addEventListener("click", () => ctx.navigate("reminders", [b.dataset.rmgo]));
    });
    const dm = wrap.querySelector(".dash-main");
    if (dm) wrap.insertBefore(radarZone, dm);
    else wrap.appendChild(radarZone);
  }
  if (kpiZone) {
    const anchor = radarZone || wrap.querySelector(".dash-main");
    if (anchor) wrap.insertBefore(kpiZone, anchor);
    else wrap.appendChild(kpiZone);
  }
  if (svcZone) {
    const anchor2 = kpiZone || radarZone || wrap.querySelector(".dash-main");
    if (anchor2) wrap.insertBefore(svcZone, anchor2);
    else wrap.appendChild(svcZone);
  }
  if (opsZone) {
    const anchor3 = kpiZone || radarZone || wrap.querySelector(".dash-main");
    if (anchor3) wrap.insertBefore(opsZone, anchor3);
    else wrap.appendChild(opsZone);
  }
  if (conflictsZone) wrap.appendChild(conflictsZone);
  if (backupZone) wrap.appendChild(backupZone);
  if (capacityZone) wrap.appendChild(capacityZone);
  if (healthZone) wrap.insertBefore(healthZone, wrap.querySelector(".dash-main") || null);

  return wrap;
}

window.CRM_RENDERERS.dashboard = renderDashboard;
