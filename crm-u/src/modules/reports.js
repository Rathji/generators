window.CRM_RENDERERS = window.CRM_RENDERERS || {};
window.CRM_REPORTS = (function () {
  const R = window.CRM_RECORDS;
  const BS = window.BcrmStore;
  const CSV = window.CRM_CSV;
  const TL = window.CRM_TIMELINE;
  const el = R.el;
  if (!R || !CSV) return null;
  const MOD = "reports";
  const DAY = 86400000;
  const WON = "won";
  const LOST = "lost";

  const DEFAULT_PIPE = {
    stages: [
      { id: "qualification", label: "Qualification" },
      { id: "discovery", label: "Discovery" },
      { id: "proposal", label: "Proposal" },
      { id: "negotiation", label: "Negotiation" }
    ],
    won: { id: WON, label: "Won" },
    lost: { id: LOST, label: "Lost" }
  };

  const TEMPLATES = [
    { id: "dealsByOwner", label: "Deals by owner", group: "Pipeline", desc: "Open pipeline value, weighted forecast and won/lost totals for every owner." },
    { id: "dealsByStage", label: "Deals by stage", group: "Pipeline", desc: "Count, expected value and weighted forecast for each open pipeline stage." },
    { id: "dealsByClosePeriod", label: "Deals by close period", group: "Pipeline", desc: "Open deals grouped by the month they are expected to close." },
    { id: "dealsBySource", label: "Deals by source", group: "Pipeline", desc: "Where deals come from — grouped by the lead source that produced them." },
    { id: "winLoss", label: "Win / loss", group: "Pipeline", desc: "Won and lost totals with win rate, and lost deals tallied by loss reason." },
    { id: "revenueForecast", label: "Revenue forecast", group: "Pipeline", desc: "Weighted revenue expected per close month from currently open deals." },
    { id: "activityByType", label: "Activity by type", group: "Activity", desc: "Calls, emails, meetings, notes and tasks logged, with time spent on each." },
    { id: "activityByOwner", label: "Activity by owner", group: "Activity", desc: "Each owner's logged activity mix plus completed follow-up tasks." },
    { id: "teamPerformance", label: "Team performance", group: "Activity", desc: "Deals opened and won, outreach and completed follow-ups for each owner." },
    { id: "servicesByCategory", label: "Services by category", group: "Services", desc: "Every service you provide, grouped by category, with active counts, MRR, ARR and share of recurring revenue." },
    { id: "mrrMovement", label: "MRR movement", group: "Services", desc: "A month-by-month waterfall of recurring revenue — opening MRR, new business, churn and the closing balance." },
    { id: "revenueByCustomer", label: "ARR by customer", group: "Services", desc: "Recurring revenue rolled up per account with active-service counts and each customer's share of MRR." },
    { id: "upcomingRenewals", label: "Upcoming renewals", group: "Services", desc: "Contracts renewing in the next 30/60/90 days, with the recurring revenue that is up for renewal." },
    { id: "ticketLoad", label: "Service desk load", group: "Service desk", desc: "Ticket volume by status with the priority mix, overdue and unassigned counts." },
    { id: "slaPerformance", label: "SLA performance", group: "Service desk", desc: "First-response and resolution attainment against each priority's targets, with average handle times." },
    { id: "assetUtilization", label: "Asset utilisation", group: "Assets", desc: "Inventory by asset kind — how much is assigned, reserved, spare, in repair or retired." }
  ];
  const TEMPLATE_MAP = {};
  TEMPLATES.forEach(t => { TEMPLATE_MAP[t.id] = t; });
  const TYPE_ORDER = ["call", "email", "meeting", "note", "task"];

  function localDateStr(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function todayLocal() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function monthKey(dateStr) {
    return String(dateStr || "").slice(0, 7);
  }
  function monthLabel(ym) {
    if (!ym) return "";
    const d = new Date(ym + "-01T00:00:00");
    if (isNaN(d.getTime())) return ym;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
  }
  function numOf(v) {
    const n = Number(v);
    return v !== undefined && v !== null && v !== "" && isFinite(n) ? n : 0;
  }
  function expectedOf(d) {
    if (window.CRM_DEALS) return window.CRM_DEALS.expectedOf(d);
    return numOf(d && d.expectedValue);
  }
  function probOf(d) {
    if (window.CRM_DEALS) return window.CRM_DEALS.probOf(d);
    const p = numOf(d && d.probability);
    if (!(d && d.probability !== undefined && d.probability !== null && d.probability !== "")) return 100;
    return Math.max(0, Math.min(100, p));
  }
  function weightedOf(d) {
    if (window.CRM_DEALS) return window.CRM_DEALS.weightedOf(d);
    return expectedOf(d) * probOf(d) / 100;
  }
  function sum(arr, fn) {
    return (arr || []).reduce((a, x) => a + (fn ? fn(x) : numOf(x)), 0);
  }

  function dom() { return window.CRM_DOMAIN; }
  function moneyChip(v) { return "$" + Math.round(Number(v) || 0).toLocaleString(); }
  function svcMonthly(rec) {
    const D = dom();
    return D ? D.monthlyOf(rec) : 0;
  }
  function svcIsBooked(rec) {
    const D = dom();
    if (!D || !rec) return false;
    const st = D.status(rec.status).id;
    if (st === "prospect" || st === "pending") return false;
    return D.moneyOf(rec.charge) > 0;
  }
  function mrrOf(list) { return sum(list, svcMonthly); }
  function monthIndex(ym) {
    const m = /^(\d{4})-(\d{2})/.exec(String(ym || ""));
    if (!m) return null;
    return Number(m[1]) * 12 + (Number(m[2]) - 1);
  }
  function ymFromIndex(idx) {
    const y = Math.floor(idx / 12), mo = idx % 12 + 1;
    return y + "-" + String(mo).padStart(2, "0");
  }
  function monthsAgoIndex(n) {
    const d = new Date();
    return d.getFullYear() * 12 + d.getMonth() - n;
  }
  function svcChurnIndex(rec) {
    const D = dom();
    if (!D || !rec) return null;
    if (D.status(rec.status).id !== "terminated") return null;
    const end = monthIndex(rec.endDate);
    if (end !== null) return end + 1;
    return monthIndex(rec.updatedAt || rec.createdAt);
  }
  function mrrMovementRows(services, backMonths, fwdMonths) {
    const cur = monthsAgoIndex(0);
    const start = cur - (backMonths - 1);
    const end = cur + fwdMonths;
    const recs = (services || []).filter(svcIsBooked).map(rec => ({
      rec,
      value: svcMonthly(rec),
      startIdx: monthIndex(rec.startDate),
      churnIdx: svcChurnIndex(rec)
    }));
    const rows = [];
    for (let i = start; i <= end; i++) {
      let opening = 0, added = 0, churned = 0, closing = 0, live = 0, addedN = 0, churnedN = 0;
      recs.forEach(x => {
        if ((x.startIdx === null || x.startIdx < i) && (x.churnIdx === null || x.churnIdx >= i)) opening += x.value;
        if (x.startIdx === i) { added += x.value; addedN++; }
        if (x.churnIdx === i) { churned += x.value; churnedN++; }
        if ((x.startIdx === null || x.startIdx <= i) && (x.churnIdx === null || x.churnIdx > i)) { closing += x.value; live++; }
      });
      rows.push({ idx: i, ym: ymFromIndex(i), opening, added, churned, closing, live, addedN, churnedN, future: i > cur });
    }
    return rows;
  }
  function renewalBucket(days) {
    if (days === null || days === undefined) return "No renewal date";
    if (days < 0) return "Overdue";
    if (days <= 30) return "Within 30 days";
    if (days <= 60) return "31–60 days";
    if (days <= 90) return "61–90 days";
    if (days <= 180) return "91–180 days";
    return "Later";
  }
  function slaStatsFor(tickets, D, nowMs) {
    const out = { total: 0, responded: 0, responseMet: 0, responseBreached: 0, resolved: 0, resolveMet: 0, resolveBreached: 0, respSum: 0, respN: 0, resSum: 0, resN: 0 };
    (tickets || []).forEach(t => {
      if (!t) return;
      out.total++;
      const st = D.ticketSlaState(t, nowMs);
      const sla = st.sla;
      const respDue = sla ? D.parseMs(sla.responseDueAt) : null;
      const resDue = sla ? D.parseMs(sla.resolveDueAt) : null;
      const opened = D.parseMs(t.openedAt || t.createdAt);
      const first = D.parseMs(t.firstResponseAt);
      const resolvedAt = D.parseMs(t.resolvedAt || t.closedAt);
      if (first !== null) {
        out.responded++;
        if (respDue === null || first <= respDue) out.responseMet++;
        else out.responseBreached++;
        if (opened !== null) { out.respSum += (first - opened) / 60000; out.respN++; }
      } else if (st.responseOverdue) {
        out.responseBreached++;
      }
      if (resolvedAt !== null) {
        out.resolved++;
        if (resDue === null || resolvedAt <= resDue) out.resolveMet++;
        else out.resolveBreached++;
        if (opened !== null) { out.resSum += (resolvedAt - opened) / 60000; out.resN++; }
      } else if (st.resolveOverdue) {
        out.resolveBreached++;
      }
    });
    out.avgResponseMin = out.respN ? Math.round(out.respSum / out.respN) : null;
    out.avgResolveMin = out.resN ? Math.round(out.resSum / out.resN) : null;
    const rDen = out.responseMet + out.responseBreached;
    const sDen = out.resolveMet + out.resolveBreached;
    out.responseAttain = rDen ? Math.round(1000 * out.responseMet / rDen) / 10 : null;
    out.resolveAttain = sDen ? Math.round(1000 * out.resolveMet / sDen) / 10 : null;
    return out;
  }
  function groupIcon(group) {
    const m = { Pipeline: "◈", Activity: "◔", Services: "⇄", "Service desk": "☎", Assets: "▣" };
    return m[group] || "▤";
  }

  function stageInfo(dealsDoc) {
    const pl = dealsDoc && dealsDoc.content && dealsDoc.content.pipeline;
    const stages = pl && Array.isArray(pl.stages) && pl.stages.length ? pl.stages : DEFAULT_PIPE.stages.slice();
    const labelOf = {};
    stages.forEach(s => { labelOf[s.id] = s.label; });
    const wonL = pl && pl.won && pl.won.label ? pl.won.label : "Won";
    const lostL = pl && pl.lost && pl.lost.label ? pl.lost.label : "Lost";
    const label = id => {
      if (!id) return "—";
      if (id === WON) return wonL;
      if (id === LOST) return lostL;
      return labelOf[id] !== undefined ? labelOf[id] : String(id);
    };
    const openStages = stages.map(s => s.id);
    const isOpen = id => !!id && id !== WON && id !== LOST;
    return { stages, openStages, label, isOpen, wonLabel: wonL, lostLabel: lostL };
  }

  async function loadAll(store) {
    const docs = {};
    const mods = ["companies", "contacts", "leads", "deals", "services", "sites", "assets", "tickets", "activities", "emails"];
    for (const m of mods) {
      try {
        docs[m] = await store.loadDoc(m);
      } catch (e) {
        docs[m] = null;
      }
    }
    const rec = m => (docs[m] && docs[m].content && Array.isArray(docs[m].content.records) ? docs[m].content.records : []);
    const maps = {};
    for (const m of ["companies", "contacts", "deals", "leads", "sites", "assets", "tickets"]) maps[m] = new Map(rec(m).map(x => [x.id, x]));
    return {
      docs,
      companies: rec("companies"),
      contacts: rec("contacts"),
      leads: rec("leads"),
      deals: rec("deals"),
      services: rec("services"),
      sites: rec("sites"),
      assets: rec("assets"),
      tickets: rec("tickets"),
      activities: rec("activities"),
      maps
    };
  }

  const MONEY = "money", NUM = "num", PCT = "pct", TXT = "text";
  const cols = list => list.map(c => Object.assign({ align: c.kind === TXT ? "left" : "right" }, c));

  function makeRpt(tid, title, c, note) {
    return { template: tid, title, generatedAt: new Date().toISOString(), cols: c.cols, rows: c.rows, chips: c.chips || [], note: note || "", empty: !c.rows.length };
  }

  async function runReport(store, templateId) {
    const meta = TEMPLATE_MAP[templateId];
    if (!meta) return { ok: false, error: "Unknown report type “" + templateId + "”." };
    const A = await loadAll(store);
    const st = stageInfo(A.docs.deals);
    const openD = A.deals.filter(d => st.isOpen(d.stage));
    const wonD = A.deals.filter(d => d.stage === WON);
    const lostD = A.deals.filter(d => d.stage === LOST);
    const leadsById = A.maps.leads;
    const today = todayLocal();

    function ownerName(o) {
      return String(o || "").trim() || "Unassigned";
    }
    function sourceOf(d) {
      const lead = d.leadId && leadsById.get(d.leadId);
      return (lead && lead.source && String(lead.source).trim()) ? lead.source : "No source";
    }
    function moneyRowsSort(list, fn) {
      return list.slice().sort((a, b) => (fn(b) - fn(a)) || String(a).localeCompare(String(b)));
    }

    let out;
    if (templateId === "dealsByOwner") {
      const groups = {};
      A.deals.forEach(d => {
        const o = ownerName(d.owner);
        (groups[o] = groups[o] || []).push(d);
      });
      const owners = Object.keys(groups).sort((a, b) => a.localeCompare(b));
      const rows = owners.map(o => {
        const g = groups[o];
        const op = g.filter(d => st.isOpen(d.stage));
        const w = g.filter(d => d.stage === WON);
        const l = g.filter(d => d.stage === LOST);
        return [o, op.length, sum(op, expectedOf), sum(op, weightedOf), w.length, sum(w, expectedOf), l.length, sum(l, expectedOf)];
      });
      const t = g => ({ o: g.filter(d => st.isOpen(d.stage)), w: g.filter(d => d.stage === WON), l: g.filter(d => d.stage === LOST) });
      const allT = t(A.deals);
      rows.push(["Total", allT.o.length, sum(allT.o, expectedOf), sum(allT.o, weightedOf), allT.w.length, sum(allT.w, expectedOf), allT.l.length, sum(allT.l, expectedOf)]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "owner", label: "Owner", kind: TXT },
          { k: "open", label: "Open deals", kind: NUM },
          { k: "openValue", label: "Open value", kind: MONEY },
          { k: "weighted", label: "Weighted forecast", kind: MONEY },
          { k: "won", label: "Won", kind: NUM },
          { k: "wonValue", label: "Won value", kind: MONEY },
          { k: "lost", label: "Lost", kind: NUM },
          { k: "lostValue", label: "Lost value", kind: MONEY }
        ]),
        rows,
        chips: [
          { k: "Open pipeline value", v: "$" + Math.round(sum(allT.o, expectedOf)).toLocaleString() },
          { k: "Weighted forecast", v: "$" + Math.round(sum(allT.o, weightedOf)).toLocaleString() },
          { k: "Won", v: allT.w.length + " · $" + Math.round(sum(allT.w, expectedOf)).toLocaleString() },
          { k: "Lost", v: allT.l.length + " · $" + Math.round(sum(allT.l, expectedOf)).toLocaleString() }
        ],
        note: "“Weighted forecast” is expected value × probability. Open deals sit in an active pipeline stage; won/lost rows show closed outcomes."
      });
    } else if (templateId === "dealsByStage") {
      const rows = [];
      st.stages.forEach(s => {
        const g = openD.filter(d => d.stage === s.id);
        rows.push([st.label(s.id), g.length, sum(g, expectedOf), sum(g, weightedOf)]);
      });
      const other = openD.filter(d => st.openStages.indexOf(d.stage) === -1);
      if (other.length) rows.push(["Other", other.length, sum(other, expectedOf), sum(other, weightedOf)]);
      rows.push(["Total open", sum(rows.map(r => r[1])), sum(rows.map(r => r[2])), sum(rows.map(r => r[3]))]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "stage", label: "Pipeline stage", kind: TXT },
          { k: "deals", label: "Deals", kind: NUM },
          { k: "expected", label: "Expected value", kind: MONEY },
          { k: "weighted", label: "Weighted forecast", kind: MONEY }
        ]),
        rows,
        chips: [
          { k: "Won", v: wonD.length + " deals · $" + Math.round(sum(wonD, expectedOf)).toLocaleString() },
          { k: "Lost", v: lostD.length + " deals · $" + Math.round(sum(lostD, expectedOf)).toLocaleString() }
        ],
        note: "Only open deals appear in the stage rows; won and lost totals are shown above."
      });
    } else if (templateId === "dealsByClosePeriod") {
      const groups = {};
      const noDate = [];
      openD.forEach(d => {
        const mk = monthKey(d.closeDate);
        if (!mk) noDate.push(d);
        else (groups[mk] = groups[mk] || []).push(d);
      });
      const keys = Object.keys(groups).sort();
      const rows = keys.map(k => [monthLabel(k), groups[k].length, sum(groups[k], expectedOf), sum(groups[k], weightedOf)]);
      if (noDate.length) rows.push(["No close date", noDate.length, sum(noDate, expectedOf), sum(noDate, weightedOf)]);
      rows.push(["Total", openD.length, sum(openD, expectedOf), sum(openD, weightedOf)]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "month", label: "Expected close month", kind: TXT },
          { k: "deals", label: "Deals", kind: NUM },
          { k: "expected", label: "Expected value", kind: MONEY },
          { k: "weighted", label: "Weighted forecast", kind: MONEY }
        ]),
        rows,
        chips: [
          { k: "Open deals", v: openD.length },
          { k: "Expected value", v: "$" + Math.round(sum(openD, expectedOf)).toLocaleString() },
          { k: "Weighted forecast", v: "$" + Math.round(sum(openD, weightedOf)).toLocaleString() }
        ],
        note: noDate.length ? noDate.length + " open deal(s) have no close date and are shown in their own row." : "Months with no expected closes are omitted."
      });
    } else if (templateId === "dealsBySource") {
      const groups = {};
      A.deals.forEach(d => {
        const s = sourceOf(d);
        (groups[s] = groups[s] || []).push(d);
      });
      const srcs = moneyRowsSort(Object.keys(groups), s => sum(groups[s].filter(d => st.isOpen(d.stage)), expectedOf));
      const rows = srcs.map(s => {
        const g = groups[s];
        const op = g.filter(d => st.isOpen(d.stage));
        const w = g.filter(d => d.stage === WON);
        const l = g.filter(d => d.stage === LOST);
        return [s, op.length, sum(op, expectedOf), w.length, sum(w, expectedOf), l.length];
      });
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "source", label: "Source", kind: TXT },
          { k: "open", label: "Open deals", kind: NUM },
          { k: "openValue", label: "Open value", kind: MONEY },
          { k: "won", label: "Won", kind: NUM },
          { k: "wonValue", label: "Won value", kind: MONEY },
          { k: "lost", label: "Lost", kind: NUM }
        ]),
        rows,
        chips: [
          { k: "Sources", v: srcs.length },
          { k: "Won from tracked sources", v: sum(wonD.filter(d => leadsById.get(d.leadId) && leadsById.get(d.leadId).source), expectedOf) ? "$" + Math.round(sum(wonD, expectedOf)).toLocaleString() : "—" }
        ],
        note: "A deal's source is taken from the lead it was converted from. Deals without a linked lead show as “No source”."
      });
    } else if (templateId === "winLoss") {
      const closed = wonD.length + lostD.length;
      const rate = closed ? Math.round(1000 * wonD.length / closed) / 10 : null;
      const groups = {};
      lostD.forEach(d => {
        const r = String(d.lossReason || "").trim() || "No reason recorded";
        (groups[r] = groups[r] || []).push(d);
      });
      const reasons = moneyRowsSort(Object.keys(groups), r => sum(groups[r], expectedOf));
      const rows = reasons.map(r => [r, groups[r].length, sum(groups[r], expectedOf)]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "reason", label: "Loss reason", kind: TXT },
          { k: "deals", label: "Lost deals", kind: NUM },
          { k: "value", label: "Lost value", kind: MONEY }
        ]),
        rows,
        chips: [
          { k: "Won", v: wonD.length + " deals · $" + Math.round(sum(wonD, expectedOf)).toLocaleString() },
          { k: "Lost", v: lostD.length + " deals · $" + Math.round(sum(lostD, expectedOf)).toLocaleString() },
          { k: "Win rate", v: rate === null ? "no closed deals yet" : rate + "%" }
        ],
        note: closed ? "Loss reasons are recorded when a deal is moved to Lost." : "No deals have been closed yet — mark deals Won or Lost in the pipeline to build this report."
      });
    } else if (templateId === "revenueForecast") {
      const groups = {};
      const noDate = [];
      openD.forEach(d => {
        const mk = monthKey(d.closeDate);
        if (!mk) noDate.push(d);
        else (groups[mk] = groups[mk] || []).push(d);
      });
      const keys = Object.keys(groups).sort();
      const rows = keys.map(k => [monthLabel(k), groups[k].length, sum(groups[k], expectedOf), sum(groups[k], weightedOf)]);
      if (noDate.length) rows.push(["No close date", noDate.length, sum(noDate, expectedOf), sum(noDate, weightedOf)]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "month", label: "Close month", kind: TXT },
          { k: "deals", label: "Deals", kind: NUM },
          { k: "expected", label: "Expected value", kind: MONEY },
          { k: "weighted", label: "Weighted revenue", kind: MONEY }
        ]),
        rows,
        chips: [
          { k: "Weighted forecast (open deals)", v: "$" + Math.round(sum(openD, weightedOf)).toLocaleString() },
          { k: "Upside at full value", v: "$" + Math.round(sum(openD, expectedOf)).toLocaleString() }
        ],
        note: noDate.length ? noDate.length + " open deal(s) without a close date are excluded from the month rows." : "Forecast weights each open deal's expected value by its probability."
      });
    } else if (templateId === "activityByType") {
      const rows = [];
      const total = A.activities.length || 0;
      TYPE_ORDER.forEach(t => {
        const g = A.activities.filter(a => a.type === t);
        const mins = sum(g, a => (t === "call" || t === "meeting") ? numOf(a.durationMin) : 0);
        rows.push([t.charAt(0).toUpperCase() + t.slice(1), g.length, total ? Math.round(10 * g.length / total) / 10 : 0, mins ? mins : ""]);
      });
      rows.push(["Total", total, "", ""]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "type", label: "Type", kind: TXT },
          { k: "count", label: "Count", kind: NUM },
          { k: "share", label: "Share of activity", kind: PCT },
          { k: "minutes", label: "Time logged (min)", kind: NUM }
        ]),
        rows,
        chips: [{ k: "Activities logged", v: total }, { k: "This week", v: A.activities.filter(a => (a.at || "").slice(0, 10) >= today).length }],
        note: "Minutes are summed from call and meeting durations; notes and tasks do not carry durations."
      });
    } else if (templateId === "activityByOwner") {
      const groups = {};
      A.activities.forEach(a => {
        const o = ownerName(a.owner);
        (groups[o] = groups[o] || []).push(a);
      });
      const owners = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
      const rows = owners.map(o => {
        const g = groups[o];
        const by = t => g.filter(a => a.type === t).length;
        return [o, g.length, by("call"), by("email"), by("meeting"), by("note"), by("task"), g.filter(a => a.type === "task" && a.status === "done").length];
      });
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "owner", label: "Owner", kind: TXT },
          { k: "total", label: "Total", kind: NUM },
          { k: "calls", label: "Calls", kind: NUM },
          { k: "emails", label: "Emails", kind: NUM },
          { k: "meetings", label: "Meetings", kind: NUM },
          { k: "notes", label: "Notes", kind: NUM },
          { k: "tasks", label: "Tasks", kind: NUM },
          { k: "done", label: "Tasks completed", kind: NUM }
        ]),
        rows,
        chips: [{ k: "Owners with activity", v: owners.length }],
        note: "Rows list every owner who has logged activity. “Unassigned” groups records with no owner."
      });
    } else if (templateId === "teamPerformance") {
      const owners = {};
      A.deals.forEach(d => {
        const o = ownerName(d.owner);
        owners[o] = owners[o] || { deals: [], acts: [] };
        owners[o].deals.push(d);
      });
      A.activities.forEach(a => {
        const o = ownerName(a.owner);
        (owners[o] = owners[o] || { deals: [], acts: [] }).acts.push(a);
      });
      const names = Object.keys(owners).sort((a, b) => {
        const x = owners[a], y = owners[b];
        return (y.deals.length - x.deals.length) || (y.acts.length - x.acts.length) || a.localeCompare(b);
      });
      const rows = names.map(o => {
        const x = owners[o];
        const op = x.deals.filter(d => st.isOpen(d.stage));
        const w = x.deals.filter(d => d.stage === WON);
        const acts = x.acts;
        const by = t => acts.filter(a => a.type === t).length;
        const doneTasks = acts.filter(a => a.type === "task" && a.status === "done").length;
        const todayActs = acts.filter(a => localDateStr(a.at || a.createdAt) === today).length;
        return [o, op.length, w.length, sum(w, expectedOf), by("call"), by("email"), doneTasks, todayActs];
      });
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "owner", label: "Owner", kind: TXT },
          { k: "open", label: "Deals open", kind: NUM },
          { k: "won", label: "Deals won", kind: NUM },
          { k: "wonValue", label: "Won value", kind: MONEY },
          { k: "calls", label: "Calls logged", kind: NUM },
          { k: "emails", label: "Emails logged", kind: NUM },
          { k: "followUps", label: "Follow-ups completed", kind: NUM },
          { k: "today", label: "Activity today", kind: NUM }
        ]),
        rows,
        chips: [{ k: "Team members", v: names.length }, { k: "Open pipeline", v: "$" + Math.round(sum(openD, expectedOf)).toLocaleString() }],
        note: "Follow-ups completed counts tasks marked done; activity today counts anything logged since local midnight."
      });
    } else if (templateId === "servicesByCategory") {
      const D = dom();
      const stat = list => ({
        count: list.length,
        active: list.filter(r => D.status(r.status).id === "active").length,
        pipeline: list.filter(r => { const s = D.status(r.status).id; return s === "prospect" || s === "pending"; }).length,
        stopped: list.filter(r => D.status(r.status).id === "terminated").length,
        mrr: mrrOf(list.filter(svcIsBooked))
      });
      const groups = {};
      A.services.forEach(rec => {
        const c = D.category(rec.category).id;
        (groups[c] = groups[c] || []).push(rec);
      });
      const cats = Object.keys(groups).sort((a, b) => stat(groups[b]).mrr - stat(groups[a]).mrr);
      const totalMrr = mrrOf(A.services.filter(svcIsBooked));
      const share = m => totalMrr ? Math.round(1000 * m / totalMrr) / 10 : 0;
      const rows = cats.map(c => {
        const s = stat(groups[c]);
        return [D.categoryLabel(c), s.count, s.active, s.pipeline, s.stopped, s.mrr, s.mrr * 12, share(s.mrr)];
      });
      const all = stat(A.services);
      rows.push(["Total", all.count, all.active, all.pipeline, all.stopped, all.mrr, all.mrr * 12, totalMrr ? 100 : 0]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "category", label: "Category", kind: TXT },
          { k: "services", label: "Services", kind: NUM },
          { k: "active", label: "Active", kind: NUM },
          { k: "pipeline", label: "Prospect / pending", kind: NUM },
          { k: "terminated", label: "Terminated", kind: NUM },
          { k: "mrr", label: "MRR", kind: MONEY },
          { k: "arr", label: "ARR", kind: MONEY },
          { k: "share", label: "Share of MRR", kind: PCT }
        ]),
        rows,
        chips: [
          { k: "Contracted MRR", v: moneyChip(totalMrr) },
          { k: "ARR", v: moneyChip(totalMrr * 12) },
          { k: "Active services", v: all.active },
          { k: "Categories in use", v: cats.length }
        ],
        note: "Recurring charges are normalised to a monthly figure, so a quarterly or annual contract contributes its monthly equivalent. Prospect and pending activations are listed but excluded from MRR."
      });
    } else if (templateId === "mrrMovement") {
      const months = mrrMovementRows(A.services, 12, 3);
      const curIdx = monthsAgoIndex(0);
      const curRow = months.filter(m => m.idx === curIdx)[0] || { opening: 0, added: 0, churned: 0, closing: 0 };
      const rows = months.map(m => [
        monthLabel(m.ym) + (m.future ? " (projected)" : ""),
        m.opening, m.added, m.churned, m.added - m.churned, m.closing, m.live
      ]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "month", label: "Month", kind: TXT },
          { k: "opening", label: "Opening MRR", kind: MONEY },
          { k: "added", label: "New MRR", kind: MONEY },
          { k: "churned", label: "Churned MRR", kind: MONEY },
          { k: "net", label: "Net change", kind: MONEY },
          { k: "closing", label: "Closing MRR", kind: MONEY },
          { k: "services", label: "Services", kind: NUM }
        ]),
        rows,
        chips: [
          { k: "MRR now", v: moneyChip(curRow.closing) },
          { k: "New this month", v: moneyChip(curRow.added) },
          { k: "Churned this month", v: moneyChip(curRow.churned) },
          { k: "Net this month", v: moneyChip(curRow.added - curRow.churned) }
        ],
        note: "Every contracted service counts — a suspended contract stays on the book, while prospects and pending activations don't. A terminated record leaves the book the month after its end date. Projected months simply carry today's contracts forward."
      });
    } else if (templateId === "revenueByCustomer") {
      const D = dom();
      const booked = A.services.filter(svcIsBooked);
      const totalMrr = mrrOf(booked);
      const groups = {};
      booked.forEach(rec => {
        const id = rec.companyId || "";
        (groups[id] = groups[id] || []).push(rec);
      });
      const cmap = A.maps.companies;
      const ids = Object.keys(groups).sort((a, b) => mrrOf(groups[b]) - mrrOf(groups[a]));
      const rows = ids.map(id => {
        const g = groups[id];
        const mrr = mrrOf(g);
        const active = g.filter(r => D.status(r.status).id === "active").length;
        const name = id && cmap.get(id) ? cmap.get(id).name : "Unassigned account";
        return [name, g.length, active, mrr, mrr * 12, totalMrr ? Math.round(1000 * mrr / totalMrr) / 10 : 0];
      });
      const totalActive = booked.filter(r => D.status(r.status).id === "active").length;
      rows.push(["Total", booked.length, totalActive, totalMrr, totalMrr * 12, totalMrr ? 100 : 0]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "customer", label: "Customer", kind: TXT },
          { k: "services", label: "Services", kind: NUM },
          { k: "active", label: "Active", kind: NUM },
          { k: "mrr", label: "MRR", kind: MONEY },
          { k: "arr", label: "ARR", kind: MONEY },
          { k: "share", label: "Share of MRR", kind: PCT }
        ]),
        rows,
        chips: [
          { k: "Total MRR", v: moneyChip(totalMrr) },
          { k: "Total ARR", v: moneyChip(totalMrr * 12) },
          { k: "Billed accounts", v: ids.length },
          { k: "Average ARR", v: ids.length ? moneyChip(totalMrr * 12 / ids.length) : "—" }
        ],
        note: "ARR is the monthly equivalent of every contracted service multiplied by twelve. Accounts are ranked by recurring revenue."
      });
    } else if (templateId === "upcomingRenewals") {
      const D = dom();
      const booked = A.services.filter(svcIsBooked);
      const baseMs = new Date(today + "T00:00:00").getTime();
      const list = booked.map(rec => {
        const date = D.renewalDateOf(rec);
        const days = date ? Math.round((new Date(date + "T00:00:00").getTime() - baseMs) / DAY) : null;
        return { rec, date, days, mrr: svcMonthly(rec) };
      });
      list.sort((a, b) => {
        if (a.days === null && b.days === null) return String(a.rec.name || "").localeCompare(String(b.rec.name || ""));
        if (a.days === null) return 1;
        if (b.days === null) return -1;
        return a.days - b.days;
      });
      const cmap = A.maps.companies;
      const rows = list.map(x => [
        x.rec.name || "(unnamed service)",
        x.rec.companyId && cmap.get(x.rec.companyId) ? cmap.get(x.rec.companyId).name : "—",
        D.categoryLabel(x.rec.category),
        x.mrr,
        x.date ? R.fmtDate(x.date) : "—",
        x.days === null ? "—" : x.days < 0 ? Math.abs(x.days) + " overdue" : String(x.days),
        renewalBucket(x.days)
      ]);
      const bucketChip = b => {
        const g = list.filter(x => renewalBucket(x.days) === b);
        return g.length + " · " + moneyChip(sum(g, x => x.mrr));
      };
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "service", label: "Service", kind: TXT },
          { k: "customer", label: "Customer", kind: TXT },
          { k: "category", label: "Category", kind: TXT },
          { k: "mrr", label: "MRR", kind: MONEY },
          { k: "date", label: "Renewal date", kind: TXT },
          { k: "days", label: "Days away", kind: TXT },
          { k: "bucket", label: "Bucket", kind: TXT }
        ]),
        rows,
        chips: [
          { k: "Overdue", v: bucketChip("Overdue") },
          { k: "Within 30 days", v: bucketChip("Within 30 days") },
          { k: "31–60 days", v: bucketChip("31–60 days") },
          { k: "61–90 days", v: bucketChip("61–90 days") }
        ],
        note: "The renewal date comes from the contract end, or is projected from the start date plus the contract term. Services with no renewal date are listed last."
      });
    } else if (templateId === "ticketLoad") {
      const D = dom();
      const nowMs = Date.now();
      const statOf = list => ({
        tickets: list.length,
        open: list.filter(t => D.isTicketOpen(t)).length,
        p1: list.filter(t => D.ticketPriority(t.priority).id === "urgent").length,
        p2: list.filter(t => D.ticketPriority(t.priority).id === "high").length,
        p3: list.filter(t => D.ticketPriority(t.priority).id === "medium").length,
        p4: list.filter(t => D.ticketPriority(t.priority).id === "low").length,
        overdue: list.filter(t => { const s = D.ticketSlaState(t, nowMs).state; return s === "overdue" || s === "response-overdue"; }).length,
        unassigned: list.filter(t => D.isTicketOpen(t) && !t.assignee).length
      });
      const rows = [];
      D.TICKET_STATUSES.forEach(s => {
        const st = statOf(A.tickets.filter(t => D.ticketStatus(t.status).id === s.id));
        rows.push([D.ticketStatusLabel(s.id), st.tickets, st.open, st.p1, st.p2, st.p3, st.p4, st.overdue, st.unassigned]);
      });
      const all = statOf(A.tickets);
      rows.push(["Total", all.tickets, all.open, all.p1, all.p2, all.p3, all.p4, all.overdue, all.unassigned]);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "status", label: "Status", kind: TXT },
          { k: "tickets", label: "Tickets", kind: NUM },
          { k: "open", label: "Open", kind: NUM },
          { k: "p1", label: "P1 urgent", kind: NUM },
          { k: "p2", label: "P2 high", kind: NUM },
          { k: "p3", label: "P3 medium", kind: NUM },
          { k: "p4", label: "P4 low", kind: NUM },
          { k: "overdue", label: "SLA overdue", kind: NUM },
          { k: "unassigned", label: "Unassigned", kind: NUM }
        ]),
        rows,
        chips: [
          { k: "Total tickets", v: all.tickets },
          { k: "Open", v: all.open },
          { k: "SLA overdue", v: all.overdue },
          { k: "Unassigned", v: all.unassigned }
        ],
        note: "Every ticket is grouped by its current status. “SLA overdue” counts open tickets past their response or resolution target, plus resolved tickets that missed theirs."
      });
    } else if (templateId === "slaPerformance") {
      const D = dom();
      const nowMs = Date.now();
      const rowFor = (label, list) => {
        const s = slaStatsFor(list, D, nowMs);
        return [label, s.total, s.responded, s.responseMet, s.responseBreached, s.resolved, s.resolveMet, s.resolveBreached,
          s.avgResponseMin === null ? "" : s.avgResponseMin, s.avgResolveMin === null ? "" : s.avgResolveMin];
      };
      const rows = D.TICKET_PRIORITIES.map(p => rowFor(D.ticketPriorityLabel(p.id), A.tickets.filter(t => D.ticketPriority(t.priority).id === p.id)));
      const all = slaStatsFor(A.tickets, D, nowMs);
      rows.push(rowFor("All priorities", A.tickets));
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "priority", label: "Priority", kind: TXT },
          { k: "tickets", label: "Tickets", kind: NUM },
          { k: "responded", label: "Responded", kind: NUM },
          { k: "respMet", label: "Response met", kind: NUM },
          { k: "respBreach", label: "Response breached", kind: NUM },
          { k: "resolved", label: "Resolved", kind: NUM },
          { k: "resMet", label: "Resolution met", kind: NUM },
          { k: "resBreach", label: "Resolution breached", kind: NUM },
          { k: "avgResp", label: "Avg response (min)", kind: NUM },
          { k: "avgRes", label: "Avg resolution (min)", kind: NUM }
        ]),
        rows,
        chips: [
          { k: "Response attainment", v: all.responseAttain === null ? "—" : all.responseAttain + "%" },
          { k: "Resolution attainment", v: all.resolveAttain === null ? "—" : all.resolveAttain + "%" },
          { k: "Total breaches", v: all.responseBreached + all.resolveBreached },
          { k: "Avg first response", v: all.avgResponseMin === null ? "—" : all.avgResponseMin + " min" }
        ],
        note: "Each priority's target comes from the service desk policy (P1 15 min / 4 h, P2 1 h / 8 h, P3 4 h / 24 h, P4 8 h / 48 h). A response is “met” when the first reply lands before the target; resolution is measured against the resolve target or the ticket's own due time."
      });
    } else if (templateId === "assetUtilization") {
      const D = dom();
      const statOf = list => ({
        total: list.length,
        assigned: list.filter(a => D.assetStatus(a.status).id === "assigned").length,
        reserved: list.filter(a => D.assetStatus(a.status).id === "reserved").length,
        available: list.filter(a => D.assetStatus(a.status).id === "available").length,
        repair: list.filter(a => D.assetStatus(a.status).id === "in-repair").length,
        retired: list.filter(a => D.assetStatus(a.status).id === "retired").length
      });
      const rowFor = (label, list) => {
        const s = statOf(list);
        const used = s.assigned + s.reserved;
        return [label, s.total, s.assigned, s.reserved, s.available, s.repair, s.retired, s.total ? Math.round(1000 * used / s.total) / 10 : 0];
      };
      const rows = [];
      D.ASSET_KINDS.forEach(k => {
        const g = A.assets.filter(a => D.assetKind(a.kind).id === k.id);
        if (g.length) rows.push(rowFor(D.assetKindLabel(k.id), g));
      });
      rows.push(rowFor("All assets", A.assets));
      const all = statOf(A.assets);
      out = makeRpt(templateId, meta.label, {
        cols: cols([
          { k: "kind", label: "Asset kind", kind: TXT },
          { k: "total", label: "Total", kind: NUM },
          { k: "assigned", label: "Assigned", kind: NUM },
          { k: "reserved", label: "Reserved", kind: NUM },
          { k: "available", label: "Available", kind: NUM },
          { k: "repair", label: "In repair", kind: NUM },
          { k: "retired", label: "Retired", kind: NUM },
          { k: "util", label: "Utilisation", kind: PCT }
        ]),
        rows,
        chips: [
          { k: "Total assets", v: all.total },
          { k: "In use", v: all.assigned + all.reserved },
          { k: "Utilisation", v: (all.total ? Math.round(1000 * (all.assigned + all.reserved) / all.total) / 10 : 0) + "%" },
          { k: "Out of service", v: all.repair + all.retired }
        ],
        note: "Utilisation is assigned plus reserved against the total. Number ranges and SIMs are inventory too — their count tells you how much of the pool is allocated versus spare."
      });
    } else {
      return { ok: false, error: "Report type not implemented." };
    }
    out.generatedAtLabel = R.fmtStamp(out.generatedAt);
    return { ok: true, rpt: out };
  }

  function fmtCell(col, v) {
    if (v === "" || v === null || v === undefined) return "—";
    if (col.kind === MONEY) return "$" + Math.round(Number(v)).toLocaleString();
    if (col.kind === NUM) return Number(v).toLocaleString();
    if (col.kind === PCT) return Number(v) + "%";
    return String(v);
  }

  function tableNode(rpt) {
    const tb = el("div", "rep-table-wrap");
    const table = document.createElement("table");
    table.className = "rep-table";
    table.dataset.repTable = "1";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    rpt.cols.forEach(c => {
      const th = document.createElement("th");
      th.textContent = c.label;
      if (c.align === "right") th.style.textAlign = "right";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rpt.rows.forEach((rowVals, i) => {
      const tr = document.createElement("tr");
      const last = i === rpt.rows.length - 1 && rowVals.length && String(rowVals[0]) === "Total";
      if (last) tr.classList.add("rep-total");
      rowVals.forEach((v, j) => {
        const td = document.createElement("td");
        const c = rpt.cols[j] || { kind: TXT };
        td.textContent = fmtCell(c, v);
        if (c.align === "right") td.style.textAlign = "right";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tb.appendChild(table);
    return tb;
  }

  function toCsv(rpt) {
    const head = rpt.cols.map(c => c.label);
    const body = rpt.rows.map(row => row.map(v => (v === "" || v === null || v === undefined ? "" : v)));
    return CSV.toCSV([head].concat(body));
  }

  async function loadDefs(store) {
    try {
      const doc = await store.loadDoc(MOD);
      const defs = (doc && doc.content && Array.isArray(doc.content.records) ? doc.content.records : []).filter(d => d && d.kind === "report");
      defs.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
      return defs;
    } catch (e) {
      return [];
    }
  }

  function defId() {
    return "rp-" + (BS && BS.randHex ? BS.randHex(6) : Math.floor(Math.random() * 0xffffff).toString(16));
  }

  async function saveDef(store, def) {
    def.name = String(def.name || "").trim();
    if (!def.name) return { ok: false, code: "validation", errors: { name: "Give this report a name." } };
    if (!TEMPLATE_MAP[def.template]) return { ok: false, code: "validation", errors: { template: "Pick a report type." } };
    const now = R.nowISO();
    const res = await R.persistUpdate(store, MOD, content => {
      if (!Array.isArray(content.records)) content.records = [];
      let rec = def.id ? R.getRecord(content, def.id) : null;
      const fresh = rec ? Object.assign({}, rec) : Object.assign({}, def);
      if (!fresh.id) fresh.id = defId();
      fresh.kind = "report";
      fresh.name = def.name;
      fresh.template = def.template;
      if (!fresh.createdAt) fresh.createdAt = now;
      fresh.updatedAt = now;
      if (rec) {
        const i = content.records.indexOf(rec);
        content.records[i] = fresh;
      } else {
        content.records.push(fresh);
      }
      def.id = fresh.id;
      return { changed: true, content };
    });
    return res;
  }

  async function deleteDef(store, id) {
    return R.persistUpdate(store, MOD, content => {
      const out = R.removeRecord(content, id);
      return { changed: out.removed, content };
    });
  }

  function printSheet(title, sub, bodyHtml) {
    let host = document.getElementById("printHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "printHost";
      host.className = "print-host";
      document.body.appendChild(host);
    }
    host.innerHTML = '<div class="ps-head"><h1 class="ps-title">' + R.esc(title) + "</h1>" + (sub ? '<p class="ps-sub">' + R.esc(sub) + "</p>" : "") + "</div>" + bodyHtml;
    document.body.classList.add("printing");
    try {
      window.print();
    } catch (e) {
      window.CRM.toast("Press Ctrl/Cmd+P (or the browser menu → Print) for the printable page.");
    }
    setTimeout(() => {
      document.body.classList.remove("printing");
    }, 1500);
  }
  window.addEventListener("afterprint", () => document.body.classList.remove("printing"));

  function printReport(rpt) {
    let body = "";
    if (rpt.chips && rpt.chips.length) {
      body += '<div class="ps-chips">' + rpt.chips.map(c => "<span class=\"ps-chip\"><b>" + R.esc(String(c.v)) + "</b> " + R.esc(c.k) + "</span>").join("") + "</div>";
    }
    body += "<table class=\"rep-table\"><thead><tr>" + rpt.cols.map(c => "<th>" + R.esc(c.label) + "</th>").join("") + "</tr></thead><tbody>";
    body += rpt.rows.map(row => "<tr>" + row.map((v, j) => {
      const c = rpt.cols[j] || { kind: "text" };
      return "<td>" + R.esc(fmtCell(c, v)) + "</td>";
    }).join("") + "</tr>").join("");
    body += "</tbody></table>";
    if (rpt.note) body += '<p class="ps-note">' + R.esc(rpt.note) + "</p>";
    printSheet("CRM-U — " + rpt.title, "Generated " + rpt.generatedAtLabel + " · Report", body);
  }

  function tabBar(active, navigate) {
    const tabs = el("div", "seg rep-tabs");
    tabs.dataset.repTabs = "1";
    const items = [
      ["", "Library"],
      ["new", "＋ New report"],
      ["import", "CSV import"],
      ["export", "Export"]
    ];
    items.forEach(pair => {
      const a = document.createElement("a");
      a.href = "#/reports" + (pair[0] ? "/" + pair[0] : "");
      a.className = "rep-tab" + (active === pair[0] ? " on" : "");
      a.textContent = pair[1];
      if (active !== pair[0]) a.dataset.repNav = "1";
      tabs.appendChild(a);
    });
    return tabs;
  }

  async function renderLibrary(ctx) {
    const store = ctx.store;
    const wrap = el("div");
    const defs = await loadDefs(store);
    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tb = el("div");
    tb.appendChild(el("h2", null, "Saved reports"));
    tb.appendChild(el("p", "hint", "Name and keep the report definitions you run often. Every one is downloadable as CSV and printable."));
    titleRow.appendChild(tb);
    const addBtn = document.createElement("a");
    addBtn.className = "btn btn-primary btn-sm";
    addBtn.href = "#/reports/new";
    addBtn.dataset.repNew = "1";
    addBtn.textContent = "＋ New report";
    titleRow.appendChild(addBtn);
    card.appendChild(titleRow);
    const seg = el("div", "rep-grid");
    if (!defs.length) {
      const empty = el("div", "state state-empty rep-empty");
      empty.innerHTML = '<div class="state-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-4"/><path d="M3 20h18"/></svg></div>';
      empty.appendChild(el("p", "state-title", "No saved reports yet"));
      empty.appendChild(el("p", "state-msg", "Save a report definition below — or run any built-in type straight from the catalog."));
      seg.appendChild(empty);
    }
    defs.forEach(def => {
      const meta = TEMPLATE_MAP[def.template];
      const t = el("div", "rep-card");
      t.dataset.repDef = def.id;
      const top = el("div", "rep-card-top");
      const icon = el("span", "mc-icon", meta ? groupIcon(meta.group) : "▤");
      top.appendChild(icon);
      const nm = el("div", "rep-card-name");
      nm.appendChild(el("div", "rep-name", def.name));
      nm.appendChild(el("div", "rep-sub", (meta ? meta.label : def.template) + (def.createdAt ? " · saved " + R.timeAgo(def.createdAt) : "")));
      top.appendChild(nm);
      t.appendChild(top);
      const acts = el("div", "rep-acts");
      const mk = (label, go, cls) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn " + (cls || "btn-ghost") + " btn-sm";
        b.textContent = label;
        acts.appendChild(b);
        b.addEventListener("click", () => go());
      };
      mk("Run", () => ctx.navigate("reports", ["run", def.id]), "btn-primary");
      mk("CSV", async () => {
        const res = await runReport(store, def.template);
        if (res.ok) CSV.download(CSV.slug(def.name) + ".csv", toCsv(res.rpt));
      });
      mk("Print", async () => {
        const res = await runReport(store, def.template);
        if (res.ok) printReport(res.rpt);
      });
      mk("Edit", () => ctx.navigate("reports", ["edit", def.id]));
      mk("Delete", () => {
        const conf = window.confirm("Delete the saved report “" + def.name + "”? The data it reads is untouched.");
        if (conf) {
          deleteDef(store, def.id).then(res => {
            if (res.ok) { window.CRM.toast("Report deleted."); window.CRM.rerender(); }
            else window.CRM.toast("Could not delete the report.");
          });
        }
      }, "btn-danger");
      t.appendChild(acts);
      seg.appendChild(t);
    });
    card.appendChild(seg);
    wrap.appendChild(card);

    const catCard = el("section", "card");
    const catRow = el("div", "card-title-row");
    catRow.appendChild(el("h2", null, "Built-in report catalog"));
    catRow.appendChild(el("p", "hint", "Run any type instantly or save it as one of your reports."));
    catCard.appendChild(catRow);
    const catGrid = el("div", "rep-grid");
    TEMPLATES.forEach(meta => {
      const t = el("div", "rep-card rep-cat");
      t.dataset.repCat = meta.id;
      const top = el("div", "rep-card-top");
      top.appendChild(el("span", "mc-icon", groupIcon(meta.group)));
      const nm = el("div", "rep-card-name");
      nm.appendChild(el("div", "rep-name", meta.label));
      nm.appendChild(el("div", "rep-sub", meta.group + " · " + meta.desc));
      top.appendChild(nm);
      t.appendChild(top);
      const acts = el("div", "rep-acts");
      const run = document.createElement("a");
      run.className = "btn btn-ghost btn-sm";
      run.href = "#/reports/run/" + meta.id;
      run.textContent = "Run now";
      const save = document.createElement("a");
      save.className = "btn btn-ghost btn-sm";
      save.href = "#/reports/new/" + meta.id;
      save.textContent = "Save…";
      acts.appendChild(run);
      acts.appendChild(save);
      t.appendChild(acts);
      catGrid.appendChild(t);
    });
    catCard.appendChild(catGrid);
    wrap.appendChild(catCard);
    wrap.appendChild(el("p", "hint", "Reports read your live documents the moment you run them — nothing is cached, so numbers always reflect the latest sync."));
    return wrap;
  }

  async function renderRun(ctx) {
    const store = ctx.store;
    const wrap = el("div");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/reports";
    back.textContent = "← All reports";
    wrap.appendChild(back);
    const id = (ctx.params || [])[1] || "";
    const defs = id ? await loadDefs(store) : [];
    const def = defs.find(d => d.id === id) || null;
    const tid = def ? def.template : (TEMPLATE_MAP[id] ? id : "");
    if (!tid) {
      const state = el("div", "state state-error");
      state.appendChild(el("p", "state-title", "Report not found"));
      state.appendChild(el("p", "state-msg", "That report definition no longer exists."));
      wrap.appendChild(state);
      return wrap;
    }
    const meta = TEMPLATE_MAP[tid];
    const res = await runReport(store, tid);
    if (!res.ok) {
      const state = el("div", "state state-error");
      state.appendChild(el("p", "state-title", "Couldn't run this report"));
      state.appendChild(el("p", "state-msg", res.error || "An unexpected error occurred."));
      wrap.appendChild(state);
      return wrap;
    }
    const rpt = res.rpt;
    const card = el("section", "card");
    card.dataset.repRun = "1";
    const titleRow = el("div", "card-title-row");
    const left = el("div");
    const h = el("h2");
    h.textContent = def ? def.name : meta.label;
    left.appendChild(h);
    left.appendChild(el("p", "hint", (meta ? meta.label + " · " : "") + "generated " + rpt.generatedAtLabel));
    titleRow.appendChild(left);
    const right = el("div", "detail-acts");
    const csvBtn = document.createElement("button");
    csvBtn.className = "btn btn-primary btn-sm";
    csvBtn.textContent = "Download CSV";
    csvBtn.dataset.repCsv = "1";
    csvBtn.addEventListener("click", () => CSV.download(CSV.slug(def ? def.name : meta.label) + ".csv", toCsv(rpt)));
    const printBtn = document.createElement("button");
    printBtn.className = "btn btn-ghost btn-sm";
    printBtn.textContent = "Print";
    printBtn.dataset.repPrint = "1";
    printBtn.addEventListener("click", () => printReport(rpt));
    right.appendChild(csvBtn);
    right.appendChild(printBtn);
    if (!def) {
      const saveA = document.createElement("a");
      saveA.className = "btn btn-ghost btn-sm";
      saveA.href = "#/reports/new/" + tid;
      saveA.textContent = "Save as report";
      saveA.dataset.repSaveAdhoc = "1";
      right.appendChild(saveA);
    } else {
      const editA = document.createElement("a");
      editA.className = "btn btn-ghost btn-sm";
      editA.href = "#/reports/edit/" + encodeURIComponent(def.id);
      editA.textContent = "Edit";
      right.appendChild(editA);
    }
    titleRow.appendChild(right);
    card.appendChild(titleRow);
    if (rpt.chips && rpt.chips.length) {
      const chips = el("div", "rep-chips");
      rpt.chips.forEach(c => {
        const s = el("div", "rep-chip");
        s.appendChild(el("span", "rep-chip-v", String(c.v)));
        s.appendChild(el("span", "rep-chip-k", c.k));
        chips.appendChild(s);
      });
      card.appendChild(chips);
    }
    card.appendChild(tableNode(rpt));
    if (rpt.note) card.appendChild(el("p", "hint rep-note", rpt.note));
    wrap.appendChild(card);
    return wrap;
  }

  async function renderBuilder(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isEdit = params[0] === "edit";
    const pre = isEdit ? params[1] : params[1] || "";
    const defs = await loadDefs(store);
    const existing = isEdit ? defs.find(d => d.id === params[1]) : null;
    const wrap = el("div");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/reports";
    back.textContent = "← All reports";
    wrap.appendChild(back);
    if (isEdit && !existing) {
      const state = el("div", "state state-error");
      state.appendChild(el("p", "state-title", "Report not found"));
      state.appendChild(el("p", "state-msg", "That report definition no longer exists."));
      wrap.appendChild(state);
      return wrap;
    }
    const card = el("section", "card");
    card.dataset.repBuilder = "1";
    const h2 = el("h2");
    h2.textContent = isEdit ? "Edit report" : "New report";
    card.appendChild(h2);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    card.appendChild(msg);
    const nameIn = document.createElement("input");
    nameIn.className = "inp";
    nameIn.placeholder = "Report name, e.g. “Q3 pipeline by owner”";
    nameIn.value = existing ? existing.name : (TEMPLATE_MAP[pre] ? TEMPLATE_MAP[pre].label + " (saved)" : "");
    const tplSel = document.createElement("select");
    tplSel.className = "sel rep-tpl-sel";
    TEMPLATES.forEach(t => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.label + " — " + t.group;
      if (t.id === (existing ? existing.template : pre)) o.selected = true;
      tplSel.appendChild(o);
    });
    const fld = (label, node) => {
      const f = el("div", "fld");
      f.appendChild(el("label", "fld-lbl", label));
      f.appendChild(node);
      return f;
    };
    card.appendChild(fld("Name", nameIn));
    card.appendChild(fld("Report type", tplSel));
    const desc = el("p", "hint");
    const refreshDesc = () => {
      const m = TEMPLATE_MAP[tplSel.value];
      desc.textContent = m ? m.desc : "";
    };
    tplSel.addEventListener("change", refreshDesc);
    refreshDesc();
    card.appendChild(desc);
    const foot = el("div", "form-acts");
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn btn-primary btn-sm";
    save.textContent = isEdit ? "Save changes" : "Save report";
    save.dataset.repSave = "1";
    const cancel = document.createElement("a");
    cancel.className = "btn btn-ghost btn-sm";
    cancel.href = "#/reports";
    cancel.textContent = "Cancel";
    foot.appendChild(save);
    foot.appendChild(cancel);
    card.appendChild(foot);
    save.addEventListener("click", async () => {
      save.disabled = true;
      const def = { id: existing ? existing.id : null, name: nameIn.value, template: tplSel.value };
      const res = await saveDef(store, def);
      if (res.ok) {
        window.CRM.toast("Report saved.");
        ctx.navigate("reports", ["run", def.id]);
      } else {
        save.disabled = false;
        msg.className = "bkp-msg err";
        msg.textContent = (res.errors && (res.errors.name || res.errors.template)) || "Could not save the report.";
        msg.hidden = false;
      }
    });
    wrap.appendChild(card);
    return wrap;
  }

  async function renderImport(ctx) {
    const store = ctx.store;
    const wrap = el("div");
    const card = el("section", "card");
    card.dataset.repImport = "1";
    const h = el("h2");
    h.textContent = "Import from CSV";
    card.appendChild(h);
    card.appendChild(el("p", "hint", "Map your spreadsheet columns onto " + (ctx.params && ctx.params[1] === "contacts" ? "contacts" : "companies") + " fields, review every row, then commit. Rows with problems are reported before anything is written."));
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    card.appendChild(msg);
    let module = (ctx.params || [])[1] === "contacts" ? "contacts" : "companies";

    const seg = el("div", "seg");
    const modBtns = {};
    [["companies", "Companies"], ["contacts", "Contacts"]].forEach(pair => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = pair[1];
      b.dataset.impMod = pair[0];
      if (pair[0] === module) b.classList.add("on");
      modBtns[pair[0]] = b;
      seg.appendChild(b);
    });
    const modRow = el("div", "fld");
    modRow.appendChild(el("label", "fld-lbl", "Import into"));
    modRow.appendChild(seg);
    card.appendChild(modRow);

    const srcCard = el("div", "imp-source");
    const fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.accept = ".csv,text/csv";
    fileIn.className = "inp";
    const textIn = document.createElement("textarea");
    textIn.className = "inp imp-ta";
    textIn.rows = 6;
    textIn.placeholder = "…or paste CSV here\nname,email,company\nAda Wong,ada@acme.example,Acme Industries";
    const parseBtn = document.createElement("button");
    parseBtn.type = "button";
    parseBtn.className = "btn btn-primary btn-sm";
    parseBtn.textContent = "Parse CSV";
    parseBtn.dataset.impParse = "1";
    const srcCard2 = el("div", "fld");
    srcCard2.appendChild(el("label", "fld-lbl", "CSV file"));
    srcCard2.appendChild(fileIn);
    srcCard2.appendChild(textIn);
    srcCard2.appendChild(parseBtn);
    srcCard.appendChild(srcCard2);
    card.appendChild(srcCard);

    const work = el("div");
    card.appendChild(work);

    function setModule(m) {
      module = m;
      Object.keys(modBtns).forEach(k => modBtns[k].classList.toggle("on", k === m));
      work.innerHTML = "";
      msg.hidden = true;
      fileIn.value = "";
      textIn.value = "";
    }
    Object.keys(modBtns).forEach(k => modBtns[k].addEventListener("click", () => setModule(k)));

    parseBtn.addEventListener("click", async () => {
      msg.hidden = true;
      let text = textIn.value;
      if (fileIn.files && fileIn.files[0]) {
        try {
          text = await fileIn.files[0].text();
        } catch (e) {
          msg.className = "bkp-msg err";
          msg.textContent = "Could not read that file — pick a .csv file.";
          msg.hidden = false;
          return;
        }
      }
      const parsed = CSV.parseCSV(text);
      if (!parsed.ok) {
        msg.className = "bkp-msg err";
        msg.textContent = parsed.error;
        msg.hidden = false;
        return;
      }
      if (parsed.headers.length < 1 || !parsed.data.length) {
        msg.className = "bkp-msg err";
        msg.textContent = "No data rows found under the header row.";
        msg.hidden = false;
        return;
      }
      work.innerHTML = "";
      const fieldMap = CSV.guessHeaderMap(module, parsed.headers);
      await renderMapping();
      return;

      async function renderMapping() {
        work.innerHTML = "";
        const existing = await CSV.loadModuleRecords(store, module);
        let existingLists = { companies: existing };
        let companyMap = CSV.companyByNameMap(module === "contacts" ? await CSV.loadModuleRecords(store, "companies").catch(() => []) : existing);
        if (module === "contacts") existingLists.companies = await CSV.loadModuleRecords(store, "companies").catch(() => []);
        const mapsBlock = el("div");
        const mapHead = el("div", "imp-map-head");
        mapHead.appendChild(el("span", "imp-map-col", "Your CSV column"));
        mapHead.appendChild(el("span", "imp-map-target", "Becomes field"));
        mapsBlock.appendChild(mapHead);
        const selects = {};
        parsed.headers.forEach((h, i) => {
          const row = el("div", "imp-map-row");
          const name = el("span", "imp-map-col");
          name.textContent = h || ("Column " + (i + 1));
          row.appendChild(name);
          const selWrap = el("span", "imp-map-target");
          const sel = document.createElement("select");
          sel.className = "sel";
          CSV.fieldOptions(module).forEach(o => {
            const op = document.createElement("option");
            op.value = o.v;
            op.textContent = o.label;
            sel.appendChild(op);
          });
          const guessed = Object.keys(fieldMap).find(k => fieldMap[k] === i);
          sel.value = guessed || "";
          selects[i] = sel;
          selWrap.appendChild(sel);
          row.appendChild(selWrap);
          mapsBlock.appendChild(row);
        });
        const remap = document.createElement("button");
        remap.type = "button";
        remap.className = "btn btn-ghost btn-sm";
        remap.textContent = "Auto-map columns";
        remap.dataset.impRemap = "1";
        remap.addEventListener("click", () => {
          const fm = CSV.guessHeaderMap(module, parsed.headers);
          Object.keys(selects).forEach(i => {
            const target = Object.keys(fm).find(k => fm[k] === Number(i));
            selects[i].value = target || "";
          });
          renderPreview();
        });
        mapsBlock.appendChild(el("div", "form-acts", "")).appendChild(remap);
        work.appendChild(mapsBlock);

        const statusOf = (rows, counts) => {
          const st = el("div", "rep-chips imp-stats");
          const chip = (n, lab, cls) => {
            const s = el("div", "rep-chip" + (cls ? " " + cls : ""));
            s.appendChild(el("span", "rep-chip-v", String(n)));
            s.appendChild(el("span", "rep-chip-k", lab));
            st.appendChild(s);
          };
          chip(counts.ok, "ready to import");
          chip(counts.dup, "already exist — skipped", "chip-warn");
          chip(counts.err, "rows with errors", "chip-bad");
          return st;
        };

        function currentFieldMap() {
          const fm = {};
          Object.keys(selects).forEach(i => {
            if (selects[i].value) fm[selects[i].value] = Number(i);
          });
          return fm;
        }

        function analyze() {
          const fm = currentFieldMap();
          const lookup = { companyByName: name => {
            const k = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
            return companyMap.get(k) || null;
          } };
          const rows = parsed.data.map(row => {
            const raw = CSV.buildRaw(module, fm, parsed.headers, row, lookup);
            const v = CSV.validateRaw(module, raw);
            const errs = v.ok ? {} : v.errors;
            const dup = v.ok && CSV.existingCheck(module, raw, existing);
            const nameMapped = fm.name !== undefined;
            if (!nameMapped) errs._ = "Map the “name” column to import this row.";
            return { raw, errs, dup, ok: v.ok && Object.keys(errs).length === 0 };
          });
          const counts = { ok: 0, dup: 0, err: 0 };
          rows.forEach(r => {
            if (!r.ok) counts.err++;
            else if (r.dup) counts.dup++;
            else counts.ok++;
          });
          return { rows, counts, fm };
        }

        function renderPreview() {
          const holder = el("div");
          const analysis = analyze();
          if (!analysis.fm.name) {
            const warn = el("p", "hint", "Map a CSV column to “Name” — rows without a mapped name column cannot be imported.");
            holder.appendChild(warn);
          }
          holder.appendChild(statusOf(analysis.rows, analysis.counts));
          const scroll = el("div", "imp-scroll");
          const table = document.createElement("table");
          table.className = "rep-table imp-table";
          const thead = document.createElement("thead");
          const hrow = document.createElement("tr");
          hrow.appendChild(Object.assign(document.createElement("th"), { textContent: "#" }));
          parsed.headers.forEach(h => {
            const th = document.createElement("th");
            th.textContent = h;
            hrow.appendChild(th);
          });
          const stCol = document.createElement("th");
          stCol.textContent = "Check";
          hrow.appendChild(stCol);
          thead.appendChild(hrow);
          table.appendChild(thead);
          const tbody = document.createElement("tbody");
          analysis.rows.forEach((r, i) => {
            const tr = document.createElement("tr");
            tr.dataset.impRow = i + 1;
            const tdN = document.createElement("td");
            tdN.textContent = i + 1;
            tr.appendChild(tdN);
            parsed.data[i].forEach(v => {
              const td = document.createElement("td");
              td.textContent = v;
              td.classList.add("imp-cell");
              tr.appendChild(td);
            });
            const tdS = document.createElement("td");
            tdS.className = "imp-check";
            if (!r.ok) {
              const bad = el("span", "badge inactive", "error");
              tdS.appendChild(bad);
              const reason = Object.keys(r.errs).map(k => r.errs[k]).join(" · ");
              tdS.appendChild(el("span", "imp-reason", reason));
            } else if (r.dup) {
              tdS.appendChild(el("span", "badge", "exists"));
              tdS.appendChild(el("span", "imp-reason", "already in your " + module + " — will be skipped"));
            } else {
              tdS.appendChild(el("span", "badge customer", "ok"));
            }
            tr.appendChild(tdS);
            if (!r.ok) tr.classList.add("imp-bad-row");
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          scroll.appendChild(table);
          holder.appendChild(scroll);

          const commitWrap = el("div", "imp-commit");
          const allowBad = document.createElement("label");
          allowBad.className = "chk";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = true;
          const lbl = document.createElement("span");
          lbl.textContent = "Import the rows that are ready and skip the " + analysis.counts.err + " with errors";
          allowBad.appendChild(cb);
          allowBad.appendChild(lbl);
          commitWrap.appendChild(allowBad);
          const commitBtn = document.createElement("button");
          commitBtn.type = "button";
          commitBtn.className = "btn btn-primary btn-sm";
          commitBtn.textContent = "Import " + analysis.counts.ok + " " + module;
          commitBtn.dataset.impCommit = "1";
          const disabled = analysis.counts.ok === 0 || (analysis.counts.err > 0 && !cb.checked);
          commitBtn.disabled = disabled;
          cb.addEventListener("change", () => {
            commitBtn.disabled = analysis.counts.ok === 0 || (analysis.counts.err > 0 && !cb.checked);
          });
          commitWrap.appendChild(commitBtn);
          holder.appendChild(commitWrap);
          const prevCard = work.querySelector(".imp-preview");
          if (prevCard) prevCard.remove();
          holder.className = "imp-preview";
          work.appendChild(holder);
          commitBtn.addEventListener("click", async () => {
            const rows = analysis.rows;
            const valid = rows.filter(r => r.ok && !r.dup).map(r => r.raw);
            const res = await importRows(store, module, valid);
            commitBtn.disabled = true;
            if (res.ok) {
              msg.className = "bkp-msg good";
              msg.textContent = "Imported " + res.imported + " " + module + (res.skippedDup ? " · " + res.skippedDup + " already existed and were skipped" : "") + (res.skippedBad ? " · " + res.skippedBad + " invalid row(s) skipped" : "") + ".";
              msg.hidden = false;
              window.CRM.toast(res.imported + " " + module + " imported.");
              setTimeout(() => ctx.navigate(module), 1200);
            } else {
              msg.className = "bkp-msg err";
              msg.textContent = "Import failed: " + ((res && res.detail) || "the document could not be written.");
              msg.hidden = false;
              commitBtn.disabled = false;
            }
          });
        }
        renderPreview();
        Object.keys(selects).forEach(i => {
          selects[i].addEventListener("change", renderPreview);
        });
      }
    });
    wrap.appendChild(card);
    return wrap;
  }

  async function importRows(store, module, raws) {
    const mod = module === "companies" ? window.CRM_COMPANIES : window.CRM_CONTACTS;
    if (!mod) return { ok: false, detail: "Module code not loaded." };
    const counts = { imported: 0, skippedDup: 0, skippedBad: 0 };
    const res = await R.persistUpdate(store, module, content => {
      if (!Array.isArray(content.records)) content.records = [];
      const skip = {};
      (content.records || []).forEach(c => {
        if (!c) return;
        skip[String(c.name || "").toLowerCase().replace(/\s+/g, " ").trim()] = 1;
        if (module === "contacts" && c.email) skip["e:" + String(c.email).toLowerCase().trim()] = 1;
      });
      raws.forEach(raw => {
        if (module === "companies") {
          const k = String(raw.name || "").toLowerCase().replace(/\s+/g, " ").trim();
          if (skip[k]) { counts.skippedDup++; return; }
        } else {
          const k = String(raw.name || "").toLowerCase().replace(/\s+/g, " ").trim();
          const ek = raw.email ? "e:" + String(raw.email).toLowerCase().trim() : "";
          if ((k && skip[k]) || (ek && skip[ek])) { counts.skippedDup++; return; }
        }
        const v = mod.validate(raw);
        if (!v.ok) { counts.skippedBad++; return; }
        let built = mod.applyForm(null, v.values);
        let attempts = 0;
        while (R.getRecord(content, built.id) && attempts < 6) {
          built.id = R.newId(module);
          attempts++;
        }
        if (attempts >= 6) { counts.skippedBad++; return; }
        R.upsertRecord(content, built);
        if (module === "companies") skip[String(built.name).toLowerCase().replace(/\s+/g, " ").trim()] = 1;
        else {
          skip[String(built.name).toLowerCase().replace(/\s+/g, " ").trim()] = 1;
          if (built.email) skip["e:" + String(built.email).toLowerCase().trim()] = 1;
        }
        counts.imported++;
      });
      return { changed: counts.imported > 0, content, imported: counts.imported, skippedDup: counts.skippedDup, skippedBad: counts.skippedBad };
    });
    if (!res.ok) return res;
    return { ok: true, imported: counts.imported, skippedDup: counts.skippedDup, skippedBad: counts.skippedBad };
  }

  async function renderExport(ctx) {
    const store = ctx.store;
    const wrap = el("div");
    const card = el("section", "card");
    card.dataset.repExport = "1";
    const h = el("h2");
    h.textContent = "Export lists & detail sheets";
    card.appendChild(h);
    card.appendChild(el("p", "hint", "Download any module's records as CSV or print a clean record sheet for a single company, contact, deal or lead."));
    let module = "companies";
    const seg = el("div", "seg");
    const modBtns = {};
    [["companies", "Companies"], ["contacts", "Contacts"], ["leads", "Leads"], ["deals", "Deals"], ["services", "Services"], ["sites", "Sites"], ["assets", "Assets"], ["tickets", "Tickets"], ["documents", "Documents"], ["activities", "Activities"]].forEach(pair => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = pair[1];
      b.dataset.expMod = pair[0];
      if (pair[0] === module) b.classList.add("on");
      modBtns[pair[0]] = b;
      seg.appendChild(b);
    });
    const body = el("div");
    card.appendChild(seg);
    card.appendChild(body);

    async function paint() {
      body.innerHTML = "";
      const records = await CSV.loadModuleRecords(store, module).catch(() => []);
      const maps = await CSV.buildMaps(store);
      const colsDef = CSV.moduleColumns(module);
      const outRow = el("div", "exp-out");
      const csvB = document.createElement("button");
      csvB.type = "button";
      csvB.className = "btn btn-primary btn-sm";
      csvB.textContent = "Download " + records.length + " rows as CSV";
      csvB.dataset.expCsv = "1";
      csvB.disabled = !records.length;
      csvB.addEventListener("click", () => {
        const t = CSV.renderTable(colsDef, records, maps);
        CSV.download(module + "-export.csv", CSV.toCSV([t.head].concat(t.rows)));
      });
      const allPrint = document.createElement("button");
      allPrint.type = "button";
      allPrint.className = "btn btn-ghost btn-sm";
      allPrint.textContent = "Print list";
      allPrint.disabled = !records.length;
      allPrint.dataset.expPrintList = "1";
      allPrint.addEventListener("click", () => {
        const t = CSV.renderTable(colsDef, records, maps);
        const html = "<table class=\"rep-table\"><thead><tr>" + t.head.map(h => "<th>" + R.esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
          t.rows.map(row => "<tr>" + row.map(c => "<td>" + R.esc(String(c === undefined || c === null ? "" : c)) + "</td>").join("") + "</tr>").join("") +
          "</tbody></table>";
        printSheet("CRM-U — " + R.moduleLabel(module) + " list", records.length + " records", html);
      });
      outRow.appendChild(csvB);
      outRow.appendChild(allPrint);
      body.appendChild(outRow);
      if (!records.length) {
        body.appendChild(el("p", "hint muted-line", "No " + module + " records yet — nothing to export."));
        return;
      }
      const search = document.createElement("input");
      search.className = "inp";
      search.type = "search";
      search.placeholder = "Find a record for its printable sheet…";
      search.dataset.expQ = "1";
      body.appendChild(search);
      const list = el("div", "exp-list");
      body.appendChild(list);
      function paintRows(q) {
        list.innerHTML = "";
        const shown = R.filterRecords(records, q);
        shown.slice(0, 60).forEach(rec => {
          const row = el("div", "exp-row");
          const main = el("div", "tl-main");
          main.appendChild(el("div", "tl-title", R.recordName(rec) || rec.id));
          const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
          const bits = [];
          if (co) bits.push(co.name);
          if (rec.role) bits.push(rec.role);
          if (rec.email) bits.push(rec.email);
          if (rec.type) bits.push((rec.type.charAt(0).toUpperCase() + rec.type.slice(1)) + (rec.subject ? ": " + rec.subject : ""));
          else if (rec.stage && window.CRM_DEALS) bits.push(window.CRM_DEALS.stageLabel(rec.stage));
          else if (module === "services" && window.CRM_DOMAIN) bits.push(window.CRM_DOMAIN.categoryLabel(rec.category) + (rec.status ? " · " + window.CRM_DOMAIN.statusLabel(rec.status) : ""));
          else if (module === "sites" && window.CRM_DOMAIN) bits.push(window.CRM_DOMAIN.siteTypeLabel(rec.siteType) + " · " + window.CRM_DOMAIN.siteStatusLabel(rec.status));
          else if (module === "assets" && window.CRM_DOMAIN) bits.push(window.CRM_DOMAIN.assetKindLabel(rec.kind) + " · " + window.CRM_DOMAIN.assetStatusLabel(rec.status));
          else if (module === "tickets" && window.CRM_DOMAIN) bits.push(window.CRM_DOMAIN.ticketPriorityLabel(rec.priority) + " · " + window.CRM_DOMAIN.ticketStatusLabel(rec.status));
          else if (rec.status && module === "leads") bits.push(rec.status);
          if (rec.owner) bits.push(rec.owner);
          main.appendChild(el("div", "tl-sub", bits.join(" · ")));
          row.appendChild(main);
          const sheetBtn = document.createElement("button");
          sheetBtn.type = "button";
          sheetBtn.className = "btn btn-ghost btn-sm";
          sheetBtn.textContent = "Printable sheet";
          sheetBtn.dataset.expSheet = module + "/" + rec.id;
          sheetBtn.addEventListener("click", async () => {
            const html = '<div class="ps-fields">' + CSV.recordSheetHtml(module, rec, maps) + "</div>";
            let tl = "";
            if (TL) {
              try {
                const scope = {};
                if (module === "companies") scope.companyId = rec.id;
                else if (module === "contacts") scope.contactId = rec.id;
                else if (module === "deals") scope.dealId = rec.id;
                else if (module === "leads") scope.leadId = rec.id;
                else if (module === "services" && rec.companyId) scope.companyId = rec.companyId;
                else if (module === "sites" && rec.companyId) scope.companyId = rec.companyId;
                else if (module === "tickets" && rec.companyId) scope.companyId = rec.companyId;
                const col = await TL.collect(store, scope);
                if (col.items.length) {
                  tl = '<div class="ps-tl"><h3>Recent activity</h3>' + col.items.slice(0, 20).map(it =>
                    "<div class=\"ps-tl-row\"><b>" + R.esc(it.title) + "</b><span>" + R.fmtStamp(it.at) + " · " + R.esc(it.sub || (TL.typeLabel ? TL.typeLabel(it.kind) : it.kind)) + "</span></div>"
                  ).join("") + "</div>";
                }
              } catch (e) {}
            }
            printSheet("CRM-U — " + R.moduleLabel(module) + " sheet", R.recordName(rec) || rec.id, html + tl);
          });
          row.appendChild(sheetBtn);
          list.appendChild(row);
        });
        if (!shown.length) list.appendChild(el("p", "hint muted-line", "No matches."));
        else if (shown.length > 60) list.appendChild(el("p", "hint", "Showing the first 60 matches — narrow your search for the exact record."));
      }
      search.addEventListener("input", () => paintRows(search.value));
      paintRows("");
    }
    Object.keys(modBtns).forEach(k => modBtns[k].addEventListener("click", () => {
      module = k;
      Object.keys(modBtns).forEach(x => modBtns[x].classList.toggle("on", x === module));
      paint();
    }));
    await paint();
    wrap.appendChild(card);
    return wrap;
  }

  async function view(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const wrap = el("div");
    if (params[0] === "" || params[0] === undefined || params[0] === "new" || params[0] === "import" || params[0] === "export") {
      wrap.appendChild(tabBar(params[0] === "new" ? "new" : params[0] === "import" ? "import" : params[0] === "export" ? "export" : "", ctx.navigate));
    }
    let content;
    if (params[0] === "new" || params[0] === "edit") content = await renderBuilder(ctx);
    else if (params[0] === "run") content = await renderRun(ctx);
    else if (params[0] === "import") content = await renderImport(ctx);
    else if (params[0] === "export") content = await renderExport(ctx);
    else content = await renderLibrary(ctx);
    wrap.appendChild(content);
    return wrap;
  }

  return {
    MOD,
    TEMPLATES,
    TEMPLATE_MAP,
    runReport,
    loadDefs,
    saveDef,
    deleteDef,
    importRows,
    toCsv,
    fmtCell,
    printReport,
    view,
    stageInfo,
    svcIsBooked,
    svcMonthly,
    mrrMovementRows,
    renewalBucket,
    slaStatsFor,
    monthIndex,
    monthsAgoIndex
  };
})();
window.CRM_RENDERERS.reports = function (ctx) {
  return window.CRM_REPORTS ? window.CRM_REPORTS.view(ctx) : null;
};
