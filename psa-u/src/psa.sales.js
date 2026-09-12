/* ============================================================
   PSA-U — sales & CRM: opportunities, quotes, activities,
   forecasting and leads (Phase 8 · Tasks 38–41)

   The growth engine that feeds the rest of the practice. This
   module owns:

     • opportunities — a deal in the pipeline with a value, an
                       expected close, a stage (from the taxonomy
                       opportunity stages, each carrying a
                       probability), a source, an owner and a
                       win/loss reason, plus a full stage-change
                       history and weighted forecast value (Task 38).
     • quotes        — a priced proposal built from product/service
                       lines (quantity, unit cost, unit sell,
                       discount), with margin visibility, a
                       printable proposal, and conversion of an
                       ACCEPTED quote into a project, an agreement
                       and/or procurement records (Task 39).
     • activities    — calls, meetings, emails, demos, follow-ups
                       and tasks logged against a company, an
                       opportunity or a lead, with scheduled next
                       steps, an overdue queue and a forecast by
                       stage / owner / period (Task 40).
     • leads         — inbound prospects with contact details and a
                       source, de-duplicated against existing
                       companies, contacts and other leads, then
                       converted into a company + opportunity with
                       the original lead history preserved (Task 41).

   Storage:
     opportunities + quotes   → the CLIENT COMPANY's document
                                (kinds "opportunity" / "quote")
     leads + activities +     → the PROVIDER document
     procurement intents        (kinds "lead" / "salesActivity" /
                                "procurementIntent")

   The opportunity stages are PSA-U taxonomy (category
   "opportunityStage"), so a provider can rename stages or edit
   their probability and the pipeline, forecast and quote math all
   follow. Quotes read catalog items (provider records of kind
   "catalogItem") when present — the catalog itself is Phase 9 — and
   fall back to free-form lines, so quotes are usable before (and
   after) the catalog lands. Converted product lines raise
   procurement intents that Phase 9 turns into purchase orders.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const S = (ERP.sales = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("sales requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, num(v))); }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const maskedMoney = (v, cur) => (ERP.security.canSeeFinancials() ? ui.money(v, cur) : "•••");
  const providerRecords = (pid, kind) => ten().records("provider", pid, kind);
  const companyRecords = (cid, kind) => ten().records("company", cid, kind);
  const membersList = () => (ERP.members ? ERP.members.members() : Promise.resolve([]));
  const clientOptions = () => ERP.companies.optionList();
  function memberName(members, id) { const m = (members || []).find((x) => String(x.id) === String(id)); return m ? m.name : (id != null && id !== "" ? "#" + id : "—"); }
  const monthKey = (iso) => String(iso || "").slice(0, 7);
  function quarterKey(iso) { const s = String(iso || ""); if (!/^\d{4}-\d{2}/.test(s)) return ""; const y = s.slice(0, 4); const m = Number(s.slice(5, 7)); return y + "-Q" + (Math.floor((m - 1) / 3) + 1); }
  function norm(s) { return String(s || "").toLowerCase().trim(); }
  function emailNorm(s) { return norm(s).replace(/\s+/g, ""); }
  function phoneNorm(s) { return String(s || "").replace(/[^0-9]/g, ""); }
  function domainOf(url) {
    const s = norm(url);
    if (!s) return "";
    const m = /(?:https?:\/\/)?(?:www\.)?([^\/\s@]+)/.exec(s);
    return m ? m[1] : "";
  }
  function emailDomain(e) { const s = emailNorm(e); const i = s.indexOf("@"); return i >= 0 ? s.slice(i + 1) : ""; }

  /* ─────────────────────────── constants ─────────────────────────── */

  S.LEAD_STATUSES = [
    { id: "new", label: "New", tone: "muted" },
    { id: "working", label: "Working", tone: "info" },
    { id: "qualified", label: "Qualified", tone: "success" },
    { id: "disqualified", label: "Disqualified", tone: "danger" },
    { id: "converted", label: "Converted", tone: "info" },
  ];
  S.leadStatusLabel = (id) => (S.LEAD_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  S.leadStatusTone = (id) => (S.LEAD_STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  S.OPPORTUNITY_STATUSES = [
    { id: "open", label: "Open", tone: "info" },
    { id: "won", label: "Won", tone: "success" },
    { id: "lost", label: "Lost", tone: "danger" },
  ];
  S.oppStatusLabel = (id) => (S.OPPORTUNITY_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  S.oppStatusTone = (id) => (S.OPPORTUNITY_STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  S.QUOTE_STATUSES = [
    { id: "draft", label: "Draft", tone: "muted" },
    { id: "sent", label: "Sent", tone: "info" },
    { id: "accepted", label: "Accepted", tone: "success" },
    { id: "declined", label: "Declined", tone: "danger" },
    { id: "expired", label: "Expired", tone: "warn" },
    { id: "converted", label: "Converted", tone: "success" },
  ];
  S.quoteStatusLabel = (id) => (S.QUOTE_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  S.quoteStatusTone = (id) => (S.QUOTE_STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  S.ACTIVITY_TYPES = [
    { id: "call", label: "Call", icon: "phone" },
    { id: "meeting", label: "Meeting", icon: "calendar" },
    { id: "email", label: "Email", icon: "mail" },
    { id: "demo", label: "Demo", icon: "screen" },
    { id: "follow_up", label: "Follow-up", icon: "clock" },
    { id: "task", label: "Task", icon: "check" },
    { id: "note", label: "Note", icon: "note" },
  ];
  S.activityLabel = (id) => (S.ACTIVITY_TYPES.find((t) => t.id === id) || {}).label || id || "—";

  S.LINE_KINDS = [
    { id: "service", label: "Service" },
    { id: "product", label: "Product" },
    { id: "subscription", label: "Subscription" },
    { id: "labor", label: "Labour" },
  ];
  S.lineKindLabel = (id) => (S.LINE_KINDS.find((k) => k.id === id) || {}).label || "Service";

  /* Fallback stage ladder, used only if a provider has no
     opportunityStage taxonomy (e.g. a brand-new, unseeded tenant). */
  S.DEFAULT_STAGES = [
    { code: "lead", label: "Lead", probability: 10, closed: false, tone: "muted", color: "#64748b" },
    { code: "qualified", label: "Qualified", probability: 30, closed: false, tone: "info", color: "#0a58ca" },
    { code: "proposal", label: "Proposal", probability: 50, closed: false, tone: "info", color: "#7c3aed" },
    { code: "negotiation", label: "Negotiation", probability: 75, closed: false, tone: "warn", color: "#d97706" },
    { code: "won", label: "Won", probability: 100, closed: true, tone: "success", color: "#16a34a" },
    { code: "lost", label: "Lost", probability: 0, closed: true, tone: "danger", color: "#dc2626" },
  ];

  /* ─────────────────────────── stage metadata ─────────────────────────── */

  S.stages = async function (pid) {
    let list = [];
    try { if (ERP.taxonomy) list = await ERP.taxonomy.list(pid, "opportunityStage"); } catch (e) { list = []; }
    if (list && list.length) {
      return list.map((r) => ({ code: r.code, label: r.label || r.code, probability: num(r.probability), closed: !!r.closed, tone: r.tone || "muted", color: r.color || "" }));
    }
    return S.DEFAULT_STAGES.map((s) => Object.assign({}, s));
  };
  S.stageInfo = async function (pid, code) { const s = await S.stages(pid); return s.find((x) => String(x.code) === String(code)) || null; };
  S.stageLabel = async function (pid, code) { const s = await S.stageInfo(pid, code); return s ? s.label : (code || "—"); };
  S.stageOptions = async function (pid) { const s = await S.stages(pid); return s.map((x) => ({ value: x.code, label: x.label })); };
  S.probOf = function (stages, o) {
    if (o && o.probability != null && o.probability !== "") return clamp(o.probability, 0, 100);
    const s = (stages || []).find((x) => String(x.code) === String(o && o.stage));
    return s ? num(s.probability) : 0;
  };
  S.isClosed = function (stages, o) {
    if (o && (o.status === "won" || o.status === "lost")) return true;
    const s = (stages || []).find((x) => String(x.code) === String(o && o.stage));
    return !!(s && s.closed);
  };
  S.weightedValue = function (stages, o) { return round2(num(o && o.value) * S.probOf(stages, o) / 100); };

  /* ─────────────────────────── emit (workflow) ─────────────────────────── */

  async function emit(pid, event, payload, extra) {
    if (!ERP.workflow) return;
    try { await ERP.workflow.emit(event, Object.assign({ event: event, actor: actor() }, payload || {}, extra || {})); } catch (e) {}
  }

  /* ─────────────────────────── record models ─────────────────────────── */

  S.newOpportunity = (over) => Object.assign({
    kind: "opportunity", id: null, providerId: null, companyId: null, number: "",
    name: "", contactId: null, stage: "lead", status: "open", probability: null,
    value: 0, currency: "", source: "", ownerId: null, expectedClose: "",
    winLossReason: "", notes: "", origin: null, stageHistory: [],
    wonAt: null, lostAt: null, createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  S.newQuote = (over) => Object.assign({
    kind: "quote", id: null, providerId: null, companyId: null, number: "",
    title: "", contactId: null, opportunityId: null, status: "draft",
    issuedDate: "", validUntil: "", currency: "", terms: "", notes: "",
    lines: [], taxRate: 0,
    subtotal: 0, costTotal: 0, discountTotal: 0, tax: 0, total: 0, margin: 0, marginPct: null,
    acceptedAt: null, declinedAt: null, decisionReason: "",
    converted: { projectId: null, agreementId: null, procurement: [] }, convertedAt: null,
    createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  S.newLine = (over) => Object.assign({
    id: null, kind: "service", itemId: null, description: "", unit: "",
    qty: 1, unitCost: 0, unitPrice: 0, discountPct: 0,
  }, over || {});

  S.newLead = (over) => Object.assign({
    kind: "lead", id: null, providerId: null, number: "",
    name: "", contactName: "", email: "", phone: "", website: "", source: "",
    status: "new", ownerId: null, value: 0, currency: "", interest: "", notes: "",
    convertedCompanyId: null, convertedOpportunityId: null, convertedAt: null,
    history: [], createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  S.newActivity = (over) => Object.assign({
    kind: "salesActivity", id: null, providerId: null,
    companyId: null, opportunityId: null, leadId: null,
    type: "call", subject: "", notes: "", dueDate: "", done: false, doneAt: null,
    ownerId: null, at: null, createdBy: null,
  }, over || {});

  S.newProcurementIntent = (over) => Object.assign({
    kind: "procurementIntent", id: null, providerId: null, quoteId: null, companyId: null,
    itemId: null, description: "", qty: 1, unit: "", unitCost: 0, currency: "",
    status: "pending", poId: null, createdAt: null,
  }, over || {});

  /* ─────────────────────────── numbering ─────────────────────────── */

  S.nextNumber = async function (pid, kind, prefix) {
    let max = 0;
    const companies = await ERP.companies.list();
    for (const e of companies) {
      for (const r of await companyRecords(e.id, kind)) {
        const m = /(\d+)\s*$/.exec(String(r.number || ""));
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return prefix + String(max + 1).padStart(4, "0");
  };
  async function nextLeadNumber(pid) {
    const list = await providerRecords(pid, "lead");
    let max = 0;
    list.forEach((l) => { const m = /(\d+)\s*$/.exec(String(l.number || "")); if (m) max = Math.max(max, Number(m[1])); });
    return "LEAD-" + String(max + 1).padStart(4, "0");
  }

  /* ═══════════════════════════ OPPORTUNITIES (Task 38) ═══════════════════════════ */

  S.all = async function (companyId) { try { return await companyRecords(companyId, "opportunity"); } catch (e) { return []; } };

  S.get = async function (companyId, id) {
    if (companyId == null || id == null) return null;
    return (await S.all(companyId)).find((o) => String(o.id) === String(id)) || null;
  };

  S.forCompany = (companyId) => S.all(companyId);

  S.list = async function (pid, query) {
    query = query || {};
    const out = [];
    const companies = await ERP.companies.list();
    const q = norm(query.q);
    for (const e of companies) {
      if (query.companyId != null && query.companyId !== "" && String(e.id) !== String(query.companyId)) continue;
      const recs = await S.all(e.id);
      for (const o of recs) {
        if (query.stage && String(o.stage) !== String(query.stage)) continue;
        if (query.status && String(o.status) !== String(query.status)) continue;
        if (query.ownerId && String(o.ownerId) !== String(query.ownerId)) continue;
        if (q && (norm(o.name).indexOf(q) === -1 && norm(e.name).indexOf(q) === -1 && norm(o.notes).indexOf(q) === -1)) continue;
        out.push(Object.assign({}, o, { __companyName: e.name }));
      }
    }
    out.sort((a, b) => (num(b.value) - num(a.value)) || String(a.__companyName || "").localeCompare(String(b.__companyName || "")));
    return out;
  };

  S.locate = async function (pid, opportunityId) {
    if (opportunityId == null) return null;
    const companies = await ERP.companies.list();
    for (const e of companies) {
      const found = (await S.all(e.id)).find((o) => String(o.id) === String(opportunityId));
      if (found) return { opportunity: found, companyId: e.id, company: await ERP.companies.get(e.id) };
    }
    return null;
  };

  function normaliseOpp(o) {
    o.value = num(o.value);
    o.probability = (o.probability === "" || o.probability == null) ? null : clamp(o.probability, 0, 100);
    o.stage = o.stage || "lead";
    o.status = o.status || "open";
    o.stageHistory = Array.isArray(o.stageHistory) ? o.stageHistory : [];
    return o;
  }

  S.save = async function (pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("sales.edit", { companyId: rec && rec.companyId })) return { error: "forbidden" };
    const companyId = rec && rec.companyId;
    if (companyId == null || companyId === "") return { error: "company_required", message: "Choose the client this opportunity is for." };
    const existing = rec && rec.id != null && rec.id !== "" ? await S.get(companyId, rec.id) : null;
    const o = normaliseOpp(Object.assign(S.newOpportunity(), existing || {}, rec));
    if (!String(o.name || "").trim()) return { error: "name_required", message: "Give the opportunity a name." };
    o.name = String(o.name).trim();

    const stages = await S.stages(pid);
    const stageRec = stages.find((s) => String(s.code) === String(o.stage));

    if (!existing) {
      o.id = o.id != null && o.id !== "" ? o.id : ten().nextId(await companyRecords(companyId));
      o.number = o.number || await S.nextNumber(pid, "opportunity", "OPP-");
      o.createdAt = nowIso();
      o.createdBy = o.createdBy != null ? o.createdBy : (actor().memberId || null);
      o.stageHistory = [{ at: nowIso(), from: null, to: o.stage, by: actorName(), note: "Created" }];
    } else if (String(existing.stage) !== String(o.stage)) {
      o.stageHistory = (o.stageHistory || []).concat([{ at: nowIso(), from: existing.stage, to: o.stage, by: actorName(), note: (opts.stageNote || rec.stageNote || "") }]);
    }

    const wasClosed = existing ? (existing.status === "won" || existing.status === "lost") : false;
    if (stageRec && stageRec.closed) {
      if (o.stage === "lost") { o.status = "lost"; o.lostAt = o.lostAt || nowIso(); }
      else { o.status = "won"; o.wonAt = o.wonAt || nowIso(); }
    } else if (!wasClosed) {
      o.status = "open";
    }

    o.providerId = pid;
    o.updatedAt = nowIso();
    await ten().upsert("company", companyId, o);

    if (!existing) {
      await emit(pid, "opportunity.created", { opportunity: o });
    } else {
      if (String(existing.stage) !== String(o.stage)) {
        await emit(pid, "opportunity.stage_changed", { opportunity: o }, { from: existing.stage, to: o.stage });
        if (o.status === "won" && existing.status !== "won") await emit(pid, "opportunity.won", { opportunity: o });
        if (o.status === "lost" && existing.status !== "lost") await emit(pid, "opportunity.lost", { opportunity: o });
      }
    }
    return { record: o, created: !existing };
  };

  S.setStage = async function (pid, companyId, id, stage, note) {
    const o = await S.get(companyId, id);
    if (!o) return { error: "not_found" };
    o.stage = stage;
    return S.save(pid, o, { stageNote: note || "" });
  };

  S.win = async function (pid, companyId, id, reason) {
    const o = await S.get(companyId, id);
    if (!o) return { error: "not_found" };
    o.stage = "won"; o.winLossReason = reason || o.winLossReason || "";
    return S.save(pid, o, { stageNote: reason || "Won" });
  };

  S.lose = async function (pid, companyId, id, reason) {
    const o = await S.get(companyId, id);
    if (!o) return { error: "not_found" };
    o.stage = "lost"; o.winLossReason = reason || o.winLossReason || "";
    return S.save(pid, o, { stageNote: reason || "Lost" });
  };

  S.remove = async function (pid, companyId, id) {
    if (!ERP.security.enforce("sales.edit")) return { error: "forbidden" };
    const o = await S.get(companyId, id);
    if (!o) return { error: "not_found" };
    const quotes = (await S.quotesForCompany(companyId)).filter((q) => String(q.opportunityId) === String(id));
    if (quotes.length) return { error: "has_quotes", message: "This opportunity has quotes; remove them first or mark it lost." };
    await ten().remove("company", companyId, (r) => r.kind === "opportunity" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* Pipeline board: opportunities grouped by stage, with per-column and
     overall totals. `includeClosed` adds the won/lost columns. */
  S.pipeline = async function (pid, query) {
    query = query || {};
    const stages = await S.stages(pid);
    const list = await S.list(pid, { companyId: query.companyId, ownerId: query.ownerId, q: query.q });
    const columns = stages.map((st) => ({ code: st.code, label: st.label, tone: st.tone, color: st.color, closed: !!st.closed, opportunities: [], value: 0, weighted: 0 }));
    const map = {};
    columns.forEach((c) => { map[c.code] = c; });
    list.forEach((o) => {
      const prob = S.probOf(stages, o);
      const weighted = round2(num(o.value) * prob / 100);
      const c = map[o.stage];
      if (!c) return;
      if (!c.closed || query.includeClosed) c.opportunities.push(Object.assign({}, o, { __probability: prob, __weighted: weighted }));
      c.value = round2(c.value + num(o.value));
      c.weighted = round2(c.weighted + weighted);
    });
    const openList = list.filter((o) => !S.isClosed(stages, o));
    const totals = {
      count: list.length, open: openList.length,
      value: round2(list.reduce((n, o) => n + num(o.value), 0)),
      openValue: round2(openList.reduce((n, o) => n + num(o.value), 0)),
      weighted: round2(openList.reduce((n, o) => n + S.weightedValue(stages, o), 0)),
    };
    return { stages: stages, columns: columns, openColumns: columns.filter((c) => !c.closed), totals: totals, list: list };
  };

  /* Forecast by stage / owner / period, over a date window, with weighted
     (probability-adjusted) and committed (won) values. */
  S.forecast = async function (pid, query) {
    query = query || {};
    const stages = await S.stages(pid);
    const all = await S.list(pid, { companyId: query.companyId, ownerId: query.ownerId });
    const from = query.from || "", to = query.to || "";
    const list = all.filter((o) => {
      const d = o.expectedClose || "";
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      return true;
    });
    const periodOf = (o) => (query.grain === "quarter" ? quarterKey(o.expectedClose) : monthKey(o.expectedClose));
    const byStage = {}, byOwner = {}, byPeriod = {};
    let openValue = 0, openWeighted = 0, wonValue = 0, lostValue = 0, won = 0, lost = 0;
    list.forEach((o) => {
      const prob = S.probOf(stages, o);
      const weighted = round2(num(o.value) * prob / 100);
      if (o.status === "won") { won += 1; wonValue += num(o.value); }
      else if (o.status === "lost") { lost += 1; lostValue += num(o.value); }
      else { openValue += num(o.value); openWeighted += weighted; }
      const st = stages.find((x) => String(x.code) === String(o.stage)) || { code: o.stage, label: o.stage };
      const sb = byStage[o.stage] = byStage[o.stage] || { stage: o.stage, label: st.label, count: 0, value: 0, weighted: 0 };
      sb.count += 1; sb.value = round2(sb.value + num(o.value)); sb.weighted = round2(sb.weighted + weighted);
      const ok = String(o.ownerId == null || o.ownerId === "" ? "—" : o.ownerId);
      const ob = byOwner[ok] = byOwner[ok] || { ownerId: o.ownerId, count: 0, value: 0, weighted: 0 };
      ob.count += 1; ob.value = round2(ob.value + num(o.value)); ob.weighted = round2(ob.weighted + weighted);
      const pk = periodOf(o);
      if (pk) {
        const pb = byPeriod[pk] = byPeriod[pk] || { period: pk, count: 0, value: 0, weighted: 0 };
        pb.count += 1; pb.value = round2(pb.value + num(o.value)); pb.weighted = round2(pb.weighted + weighted);
      }
    });
    const stageOrder = stages.map((s) => s.code);
    return {
      rows: list,
      byStage: Object.keys(byStage).map((k) => byStage[k]).sort((a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage)),
      byOwner: Object.keys(byOwner).map((k) => byOwner[k]).sort((a, b) => b.weighted - a.weighted),
      byPeriod: Object.keys(byPeriod).map((k) => byPeriod[k]).sort((a, b) => String(a.period).localeCompare(String(b.period))),
      totals: {
        count: list.length, open: list.length - won - lost, won: won, lost: lost,
        openValue: round2(openValue), weighted: round2(openWeighted),
        wonValue: round2(wonValue), lostValue: round2(lostValue),
        winRate: (won + lost) ? Math.round(won / (won + lost) * 100) : null,
      },
    };
  };

  S.summary = async function (pid, query) {
    const f = await S.forecast(pid, query || {});
    const quotes = await S.listQuotes(pid, query || {});
    const open = f.rows.filter((o) => o.status === "open");
    return {
      openCount: open.length,
      openValue: round2(open.reduce((n, o) => n + num(o.value), 0)),
      weighted: f.totals.weighted,
      wonValue: f.totals.wonValue,
      winRate: f.totals.winRate,
      quotes: quotes.length,
      quoteValue: round2(quotes.filter((q) => ["draft", "sent"].indexOf(q.status) !== -1).reduce((n, q) => n + num(q.total), 0)),
    };
  };

  /* ═══════════════════════════ QUOTES (Task 39) ═══════════════════════════ */

  S.computeQuote = function (q) {
    const rec = Object.assign({}, q);
    rec.lines = (Array.isArray(rec.lines) ? rec.lines : []).map((l) => Object.assign(S.newLine(), l));
    let subtotal = 0, costTotal = 0, discountTotal = 0, gross = 0;
    rec.lines.forEach((l) => {
      l.qty = num(l.qty, 1);
      l.unitCost = num(l.unitCost);
      l.unitPrice = num(l.unitPrice);
      l.discountPct = clamp(l.discountPct, 0, 100);
      const lineGross = round2(l.qty * l.unitPrice);
      const lineDiscount = round2(lineGross * l.discountPct / 100);
      const lineNet = round2(lineGross - lineDiscount);
      l.cost = round2(l.qty * l.unitCost);
      l.discount = lineDiscount;
      l.net = lineNet;
      gross = round2(gross + lineGross);
      discountTotal = round2(discountTotal + lineDiscount);
      subtotal = round2(subtotal + lineNet);
      costTotal = round2(costTotal + l.cost);
    });
    const taxRate = num(rec.taxRate);
    rec.taxRate = taxRate;
    rec.subtotal = subtotal;
    rec.costTotal = costTotal;
    rec.discountTotal = discountTotal;
    rec.tax = round2(subtotal * taxRate / 100);
    rec.total = round2(subtotal + rec.tax);
    rec.gross = gross;
    rec.margin = round2(subtotal - costTotal);
    rec.marginPct = subtotal > 0 ? Math.round((subtotal - costTotal) / subtotal * 100) : null;
    return rec;
  };
  const recalc = S.computeQuote;

  S.quotesForCompany = async function (companyId) { try { return await companyRecords(companyId, "quote"); } catch (e) { return []; } };
  S.allQuotes = S.quotesForCompany;

  S.getQuote = async function (companyId, id) {
    if (companyId == null || id == null) return null;
    return (await S.quotesForCompany(companyId)).find((q) => String(q.id) === String(id)) || null;
  };

  S.listQuotes = async function (pid, query) {
    query = query || {};
    const out = [];
    const companies = await ERP.companies.list();
    const q = norm(query.q);
    for (const e of companies) {
      if (query.companyId != null && query.companyId !== "" && String(e.id) !== String(query.companyId)) continue;
      for (const rec of await S.quotesForCompany(e.id)) {
        if (query.status && String(rec.status) !== String(query.status)) continue;
        if (query.statusIn && query.statusIn.map(String).indexOf(String(rec.status)) === -1) continue;
        if (q && (norm(rec.title).indexOf(q) === -1 && norm(rec.number).indexOf(q) === -1 && norm(e.name).indexOf(q) === -1)) continue;
        out.push(Object.assign({}, rec, { __companyName: e.name }));
      }
    }
    out.sort((a, b) => String(b.number || "").localeCompare(String(a.number || "")));
    return out;
  };

  S.locateQuote = async function (pid, quoteId) {
    if (quoteId == null) return null;
    const companies = await ERP.companies.list();
    for (const e of companies) {
      const found = (await S.quotesForCompany(e.id)).find((q) => String(q.id) === String(quoteId));
      if (found) return { quote: found, companyId: e.id, company: await ERP.companies.get(e.id) };
    }
    return null;
  };

  async function persistQuote(pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("sales.edit", { companyId: rec && rec.companyId })) return { error: "forbidden" };
    const companyId = rec && rec.companyId;
    if (companyId == null || companyId === "") return { error: "company_required", message: "Choose the client this quote is for." };
    const existing = rec && rec.id != null && rec.id !== "" ? await S.getQuote(companyId, rec.id) : null;
    let q = Object.assign(S.newQuote(), existing || {}, rec);
    if (!String(q.title || "").trim()) return { error: "title_required", message: "Give the quote a title." };
    q.title = String(q.title).trim();
    q.lines = (Array.isArray(q.lines) ? q.lines : []).map((l) => Object.assign(S.newLine(), l));
    let seq = q.lines.reduce((n, l) => Math.max(n, num(String(l.id || "").replace(/[^0-9]/g, ""))), 0);
    q.lines = q.lines.map((l) => { if (l.id == null || l.id === "") { seq += 1; l.id = "L" + seq; } return l; });
    q = recalc(q);
    if (!existing) {
      q.id = q.id != null && q.id !== "" ? q.id : ten().nextId(await companyRecords(companyId));
      q.number = q.number || await S.nextNumber(pid, "quote", "QTE-");
      q.issuedDate = q.issuedDate || ui.today();
      q.status = "draft";
      q.createdAt = nowIso();
      q.createdBy = q.createdBy != null ? q.createdBy : (actor().memberId || null);
    }
    q.providerId = pid;
    q.updatedAt = nowIso();
    await ten().upsert("company", companyId, q);
    if (!existing) await emit(pid, "quote.created", { quote: q });
    return { record: q, created: !existing };
  }
  S.saveQuote = persistQuote;

  S.addLine = async function (pid, companyId, id, line) {
    const q = await S.getQuote(companyId, id);
    if (!q) return { error: "not_found" };
    if (q.status !== "draft") return { error: "locked", message: "Only a draft quote can be changed." };
    const lines = (q.lines || []).concat([S.newLine(line)]);
    return persistQuote(pid, Object.assign({}, q, { lines: lines }));
  };
  S.updateLine = async function (pid, companyId, id, lineId, patch) {
    const q = await S.getQuote(companyId, id);
    if (!q) return { error: "not_found" };
    if (q.status !== "draft") return { error: "locked", message: "Only a draft quote can be changed." };
    const lines = (q.lines || []).map((l) => (String(l.id) === String(lineId) ? Object.assign(S.newLine(), l, patch) : l));
    return persistQuote(pid, Object.assign({}, q, { lines: lines }));
  };
  S.removeLine = async function (pid, companyId, id, lineId) {
    const q = await S.getQuote(companyId, id);
    if (!q) return { error: "not_found" };
    if (q.status !== "draft") return { error: "locked", message: "Only a draft quote can be changed." };
    const lines = (q.lines || []).filter((l) => String(l.id) !== String(lineId));
    return persistQuote(pid, Object.assign({}, q, { lines: lines }));
  };

  S.setQuoteStatus = async function (pid, companyId, id, status, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("sales.edit", { companyId })) return { error: "forbidden" };
    if (S.QUOTE_STATUSES.map((s) => s.id).indexOf(status) === -1) return { error: "bad_status" };
    const q = await S.getQuote(companyId, id);
    if (!q) return { error: "not_found" };
    if (q.status === "converted" && status !== "converted") return { error: "converted", message: "A converted quote cannot be reopened." };
    /* Margin floor gate (Phase 9 · Task 45): a quote below the floor cannot be
       sent or accepted without a recorded owner override. */
    if ((status === "sent" || status === "accepted") && ERP.catalog) {
      const check = await ERP.catalog.checkQuoteFloors(pid, q);
      if (!check.ok) {
        if (!opts.override) return { error: "margin_floor", message: "A line is below the " + check.floorPct + "% margin floor. Record an override to proceed.", violations: check.violations, floorPct: check.floorPct };
        const settings = await ERP.catalog.settings(pid);
        if (settings.allowOverride === false) return { error: "no_override", message: "Margin-floor overrides are disabled." };
        const ov = await ERP.catalog.overrideRecord(pid, { refType: "quote", refId: q.id, refNumber: q.number, companyId: companyId, type: "margin", floorPct: check.floorPct, violations: check.violations, reason: opts.overrideReason });
        if (ov.error) return ov;
      }
    }
    q.status = status;
    if (status === "accepted") q.acceptedAt = q.acceptedAt || nowIso();
    if (status === "declined") { q.declinedAt = q.declinedAt || nowIso(); q.decisionReason = opts.reason || q.decisionReason || ""; }
    q.updatedAt = nowIso();
    await ten().upsert("company", companyId, q);
    await emit(pid, "quote." + status, { quote: q }, { reason: opts.reason || "" });
    return { record: q };
  };
  S.acceptQuote = (pid, companyId, id, opts) => S.setQuoteStatus(pid, companyId, id, "accepted", opts);
  S.declineQuote = (pid, companyId, id, reason) => S.setQuoteStatus(pid, companyId, id, "declined", { reason: reason });

  S.removeQuote = async function (pid, companyId, id) {
    if (!ERP.security.enforce("sales.edit")) return { error: "forbidden" };
    const q = await S.getQuote(companyId, id);
    if (!q) return { error: "not_found" };
    if (q.status === "converted") return { error: "converted", message: "This quote has been converted; it is kept for the audit trail." };
    await ten().remove("company", companyId, (r) => r.kind === "quote" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* Convert an accepted quote. Each target is independent and optional:
       opts.project     = {templateId?, name?, ownerId?}  → a project
       opts.agreement   = {name?, type?, activate?}       → an agreement
       opts.procurement = true                            → procurement intents
     Returns the created ids and records them on the quote. */
  S.convertQuote = async function (pid, companyId, id, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("sales.convert", { companyId })) return { error: "forbidden" };
    const q = await S.getQuote(companyId, id);
    if (!q) return { error: "not_found" };
    if (q.status !== "accepted") return { error: "not_accepted", message: "Only an accepted quote can be converted." };
    const out = { projectId: null, project: null, agreementId: null, agreement: null, procurement: [] };

    if (opts.project && ERP.projects) {
      const projOpts = opts.project === true ? {} : opts.project;
      try {
        if (projOpts.templateId && ERP.projects.instantiate) {
          const res = await ERP.projects.instantiate(pid, { templateId: projOpts.templateId, companyId: companyId, name: projOpts.name || q.title, ownerId: projOpts.ownerId || null });
          if (!res.error) { out.project = res.project || res.record; out.projectId = out.project && out.project.id; }
        } else {
          const rec = ERP.projects.newProject({
            companyId: companyId, name: projOpts.name || q.title, description: "Created from quote " + q.number,
            billingMethod: "fixed", fixedFee: num(q.total), estimatedHours: 0, ownerId: projOpts.ownerId || null,
          });
          const res = await ERP.projects.save(pid, rec, { system: false });
          if (!res.error) { out.project = res.record; out.projectId = out.project && out.project.id; }
        }
      } catch (e) {}
    }

    if (opts.agreement && ERP.agreements) {
      const agrOpts = opts.agreement === true ? {} : opts.agreement;
      try {
        const rec = ERP.agreements.newAgreement({
          companyId: companyId, name: agrOpts.name || q.title, type: agrOpts.type || "one-off",
          startDate: ui.today(), termMonths: num(agrOpts.termMonths, 12), billingCycle: agrOpts.billingCycle || "monthly",
          pricingModel: "one-off", baseAmount: num(q.total), currency: q.currency || "",
          serviceCodes: (q.lines || []).filter((l) => l.kind !== "product").map((l) => l.description).filter(Boolean).slice(0, 8),
        });
        const res = await ERP.agreements.save(pid, rec);
        if (!res.error) {
          out.agreement = res.record; out.agreementId = out.agreement && out.agreement.id;
          if (agrOpts.activate && ERP.agreements.activate) await ERP.agreements.activate(pid, out.agreementId);
        }
      } catch (e) {}
    }

    if (opts.procurement) {
      const productLines = (q.lines || []).filter((l) => l.kind === "product");
      for (const l of productLines) {
        const intent = S.newProcurementIntent({
          providerId: pid, quoteId: q.id, companyId: companyId, itemId: l.itemId,
          description: l.description || "Product", qty: num(l.qty, 1), unit: l.unit || "",
          unitCost: num(l.unitCost), currency: q.currency || "", status: "pending", createdAt: nowIso(),
        });
        intent.id = ten().nextId(await providerRecords(pid));
        await ten().upsert("provider", pid, intent);
        out.procurement.push({ id: intent.id, description: intent.description, qty: intent.qty, unitCost: intent.unitCost, status: intent.status });
      }
    }

    q.converted = Object.assign({ projectId: null, agreementId: null, procurement: [] }, q.converted || {}, {
      projectId: out.projectId, agreementId: out.agreementId, procurement: out.procurement,
    });
    q.convertedAt = nowIso();
    q.status = "converted";
    q.updatedAt = nowIso();
    await ten().upsert("company", companyId, q);
    await emit(pid, "quote.converted", { quote: q, project: out.project, agreement: out.agreement }, { procurement: out.procurement.length });
    return Object.assign({ record: q, quote: q }, out);
  };

  /* ── catalog seam (Phase 9 owns the catalog; quotes read it if present) ── */

  S.catalogItems = async function (pid) {
    try { return await providerRecords(pid, "catalogItem"); } catch (e) { return []; }
  };

  /* ── procurement seam (Phase 9 turns these intents into POs) ── */

  S.procurementQueue = async function (pid, query) {
    query = query || {};
    const list = await providerRecords(pid, "procurementIntent");
    let out = list.filter((r) => (query.status ? String(r.status) === String(query.status) : r.status === "pending"));
    if (query.companyId) out = out.filter((r) => String(r.companyId) === String(query.companyId));
    return out.slice().sort((a, b) => num(b.id) - num(a.id));
  };
  S.markProcurementOrdered = async function (pid, intentId, poId) {
    const list = await providerRecords(pid, "procurementIntent");
    const rec = list.find((r) => String(r.id) === String(intentId));
    if (!rec) return { error: "not_found" };
    rec.status = "ordered"; rec.poId = poId != null ? poId : null;
    await ten().upsert("provider", pid, rec);
    return { record: rec };
  };

  /* ── proposal / PDF output (reuses the AR print frame) ── */

  S.proposalHtml = async function (pid, companyId, id) {
    const q = await S.getQuote(companyId, id);
    if (!q) return "";
    const company = await ERP.companies.get(companyId);
    const lines = (q.lines || []).map((l) => "<tr><td>" + ui.esc(l.description || "—") + "</td><td>" + ui.esc(S.lineKindLabel(l.kind)) + "</td><td class=\"num\">" + ui.fmt(l.qty, 2) + "</td><td class=\"num\">" + maskedMoney(l.unitPrice) + "</td><td class=\"num\">" + (num(l.discountPct) ? ui.esc(l.discountPct) + "%" : "—") + "</td><td class=\"num\">" + maskedMoney(l.net) + "</td></tr>").join("");
    return "<h1>Proposal " + ui.esc(q.number || "") + "</h1>" +
      "<p class=\"meta\">" + ui.esc(q.title || "") + " · " + ui.esc(company ? company.name : "") + " · issued " + ui.esc(q.issuedDate || "") +
      (q.validUntil ? " · valid until " + ui.esc(q.validUntil) : "") + "</p>" +
      "<table><thead><tr><th>Description</th><th>Type</th><th class=\"num\">Qty</th><th class=\"num\">Unit</th><th class=\"num\">Disc.</th><th class=\"num\">Amount</th></tr></thead><tbody>" +
      (lines || '<tr><td colspan="6">No lines.</td></tr>') + "</tbody></table>" +
      "<table><tbody>" +
      "<tr><td>Subtotal</td><td class=\"num\">" + maskedMoney(q.subtotal) + "</td></tr>" +
      (num(q.taxRate) ? "<tr><td>Tax (" + ui.esc(q.taxRate) + "%)</td><td class=\"num\">" + maskedMoney(q.tax) + "</td></tr>" : "") +
      "<tr><th>Total</th><th class=\"num\">" + maskedMoney(q.total) + "</th></tr></tbody></table>" +
      (q.terms ? "<h2>Terms</h2><p>" + ui.esc(q.terms) + "</p>" : "") +
      (q.notes ? "<h2>Notes</h2><p>" + ui.esc(q.notes) + "</p>" : "") +
      "<p class=\"meta\">Prepared by " + ui.esc(actorName()) + ". Acceptance: sign and return, or reply to confirm.</p>";
  };
  S.printProposal = async function (pid, companyId, id) {
    const q = await S.getQuote(companyId, id);
    if (!q) return { error: "not_found" };
    const html = await S.proposalHtml(pid, companyId, id);
    if (ERP.ar && ERP.ar.printHtml) return ERP.ar.printHtml("Proposal " + (q.number || ""), html);
    try { const w = window.open("", "_blank"); if (w) { w.document.write("<html><body>" + html + "</body></html>"); w.document.close(); w.print(); return { ok: true }; } } catch (e) {}
    return { error: "print_failed" };
  };

  /* ═══════════════════════════ ACTIVITIES (Task 40) ═══════════════════════════ */

  S.activities = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "salesActivity");
    if (query.companyId) list = list.filter((r) => String(r.companyId) === String(query.companyId));
    if (query.opportunityId) list = list.filter((r) => String(r.opportunityId) === String(query.opportunityId));
    if (query.leadId) list = list.filter((r) => String(r.leadId) === String(query.leadId));
    if (query.ownerId) list = list.filter((r) => String(r.ownerId) === String(query.ownerId));
    if (query.type) list = list.filter((r) => String(r.type) === String(query.type));
    if (query.open === true) list = list.filter((r) => !r.done);
    if (query.open === false) list = list.filter((r) => !!r.done);
    if (query.from) list = list.filter((r) => !r.dueDate || String(r.dueDate) >= String(query.from));
    if (query.to) list = list.filter((r) => !r.dueDate || String(r.dueDate) <= String(query.to));
    const today = ui.today();
    list = list.map((r) => Object.assign({}, r, { __overdue: !r.done && !!r.dueDate && String(r.dueDate) < today }));
    list.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")) || (num(b.id) - num(a.id)));
    return list;
  };

  S.logActivity = async function (pid, rec) {
    if (!ERP.security.enforce("sales.activity", { companyId: rec && rec.companyId })) return { error: "forbidden" };
    const a = Object.assign(S.newActivity(), rec);
    if (!String(a.subject || "").trim()) return { error: "subject_required", message: "Give the activity a subject." };
    a.subject = String(a.subject).trim();
    if (!a.companyId && !a.leadId) return { error: "target_required", message: "Log the activity against a client or a lead." };
    if (a.id == null || a.id === "") a.id = ten().nextId(await providerRecords(pid));
    a.providerId = pid;
    a.at = a.at || nowIso();
    a.createdBy = a.createdBy != null ? a.createdBy : (actor().memberId || null);
    await ten().upsert("provider", pid, a);
    await emit(pid, "activity.logged", { activity: a });
    return { record: a, created: true };
  };

  S.updateActivity = async function (pid, id, patch) {
    if (!ERP.security.enforce("sales.activity")) return { error: "forbidden" };
    const list = await providerRecords(pid, "salesActivity");
    const found = list.find((r) => String(r.id) === String(id));
    if (!found) return { error: "not_found" };
    const a = Object.assign({}, found, patch || {});
    await ten().upsert("provider", pid, a);
    return { record: a };
  };

  S.completeActivity = function (pid, id) {
    return S.updateActivity(pid, id, { done: true, doneAt: nowIso() });
  };
  S.reopenActivity = function (pid, id) {
    return S.updateActivity(pid, id, { done: false, doneAt: null });
  };

  S.removeActivity = async function (pid, id) {
    if (!ERP.security.enforce("sales.activity")) return { error: "forbidden" };
    await ten().remove("provider", pid, (r) => r.kind === "salesActivity" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* Open follow-ups with a due date, soonest first, overdue flagged. */
  S.nextSteps = async function (pid, query) {
    const list = await S.activities(pid, Object.assign({ open: true }, query || {}));
    return list.filter((r) => !!r.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  };

  /* ═══════════════════════════ LEADS (Task 41) ═══════════════════════════ */

  S.leads = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "lead");
    if (query.status) list = list.filter((l) => String(l.status) === String(query.status));
    if (query.ownerId) list = list.filter((l) => String(l.ownerId) === String(query.ownerId));
    const q = norm(query.q);
    if (q) list = list.filter((l) => norm(l.name).indexOf(q) !== -1 || norm(l.contactName).indexOf(q) !== -1 || norm(l.email).indexOf(q) !== -1);
    const today = ui.today();
    return list.map((l) => Object.assign({}, l, { __stale: !l.convertedAt && l.status !== "converted" && l.status !== "disqualified" && l.createdAt && (Date.now() - Date.parse(l.createdAt)) > 1000 * 60 * 60 * 24 * 14, __overdue: false }))
      .sort((a, b) => num(b.id) - num(a.id));
  };

  S.getLead = async function (pid, id) {
    if (id == null) return null;
    const list = await providerRecords(pid, "lead");
    return list.find((l) => String(l.id) === String(id)) || null;
  };

  /* De-duplicate a lead against existing companies, contacts and other leads.
     Matches on domain / email / phone / normalised name. */
  S.dedupe = async function (pid, lead) {
    lead = lead || {};
    const out = { companies: [], contacts: [], leads: [], any: false };
    const name = norm(lead.name), email = emailNorm(lead.email), phone = phoneNorm(lead.phone), dom = domainOf(lead.website) || emailDomain(lead.email);
    const companies = await ERP.companies.list();
    for (const e of companies) {
      const reasons = [];
      if (name && norm(e.name) === name) reasons.push("same name");
      const full = await ERP.companies.get(e.id);
      if (dom && full && (domainOf(full.website) === dom)) reasons.push("same website");
      if (email && full && emailNorm(full.email) === email) reasons.push("same email");
      if (phone && full && phoneNorm(full.phone) && phoneNorm(full.phone) === phone) reasons.push("same phone");
      if (reasons.length) out.companies.push({ id: e.id, name: e.name, reasons: reasons });
      const contacts = await ERP.companies.contacts(e.id);
      for (const c of contacts) {
        const cr = [];
        if (email && emailNorm(c.email) === email) cr.push("same email");
        if (phone && phoneNorm(c.phone) && phoneNorm(c.phone) === phone) cr.push("same phone");
        if (name && norm(c.name) === name) cr.push("same contact name");
        if (cr.length) out.contacts.push({ companyId: e.id, companyName: e.name, id: c.id, name: c.name, reasons: cr });
      }
    }
    const leads = await providerRecords(pid, "lead");
    for (const l of leads) {
      if (lead.id != null && String(l.id) === String(lead.id)) continue;
      const lr = [];
      if (email && emailNorm(l.email) === email) lr.push("same email");
      if (phone && phoneNorm(l.phone) && phoneNorm(l.phone) === phone) lr.push("same phone");
      if (name && norm(l.name) === name) lr.push("same name");
      if (lr.length) out.leads.push({ id: l.id, name: l.name, status: l.status, reasons: lr });
    }
    out.any = out.companies.length > 0 || out.contacts.length > 0 || out.leads.length > 0;
    return out;
  };

  S.saveLead = async function (pid, rec, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("sales.edit")) return { error: "forbidden" };
    const existing = rec && rec.id != null && rec.id !== "" ? await S.getLead(pid, rec.id) : null;
    const l = Object.assign(S.newLead(), existing || {}, rec);
    if (!String(l.name || "").trim()) return { error: "name_required", message: "Give the lead a name." };
    l.name = String(l.name).trim();
    l.value = num(l.value);
    if (!existing) {
      l.number = l.number || await nextLeadNumber(pid);
      l.status = l.status || "new";
      l.createdAt = nowIso();
      l.createdBy = l.createdBy != null ? l.createdBy : (actor().memberId || null);
      l.history = [{ at: nowIso(), by: actorName(), type: "created", text: "Lead captured" }];
      l.id = l.id != null && l.id !== "" ? l.id : ten().nextId(await providerRecords(pid));
    } else {
      l.history = Array.isArray(l.history) ? l.history : [];
      if (rec && rec.status && existing.status !== rec.status) {
        l.history = l.history.concat([{ at: nowIso(), by: actorName(), type: "status", text: "Status → " + S.leadStatusLabel(rec.status) }]);
      }
    }
    l.providerId = pid;
    l.updatedAt = nowIso();
    await ten().upsert("provider", pid, l);
    if (!existing) await emit(pid, "lead.created", { lead: l });
    void opts;
    return { record: l, created: !existing };
  };

  S.removeLead = async function (pid, id) {
    if (!ERP.security.enforce("sales.edit")) return { error: "forbidden" };
    const l = await S.getLead(pid, id);
    if (!l) return { error: "not_found" };
    if (l.convertedAt) return { error: "converted", message: "A converted lead is kept as history." };
    await ten().remove("provider", pid, (r) => r.kind === "lead" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  S.addLeadNote = async function (pid, id, text, type) {
    const l = await S.getLead(pid, id);
    if (!l) return { error: "not_found" };
    l.history = (l.history || []).concat([{ at: nowIso(), by: actorName(), type: type || "note", text: text || "" }]);
    l.updatedAt = nowIso();
    await ten().upsert("provider", pid, l);
    return { record: l };
  };

  /* Convert a qualified lead into a company + opportunity, preserving the
     lead's history and re-pointing its activities at the new opportunity. */
  S.convertLead = async function (pid, id, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("sales.convert")) return { error: "forbidden" };
    const lead = await S.getLead(pid, id);
    if (!lead) return { error: "not_found" };
    if (lead.convertedAt) return { error: "already_converted", message: "This lead has already been converted." };

    let companyId = opts.companyId || null;
    let company = companyId ? await ERP.companies.get(companyId) : null;
    if (!company) {
      const res = await ERP.companies.saveCompany({
        name: lead.name, legalName: lead.name, email: lead.email, phone: lead.phone,
        website: lead.website, type: "client", status: "prospect",
        notes: lead.interest || lead.notes || "",
      });
      if (res.error) return res;
      company = res.record; companyId = company.id;
    }

    let contact = null;
    if (opts.createContact !== false && (lead.contactName || lead.email)) {
      const contacts = await ERP.companies.contacts(companyId);
      const clash = contacts.find((c) => (lead.email && emailNorm(c.email) === emailNorm(lead.email)));
      if (!clash) {
        const cres = await ERP.companies.saveContact(companyId, { name: lead.contactName || lead.name, email: lead.email, phone: lead.phone, roles: ["decision-maker"], isPrimary: true });
        if (!cres.error) contact = cres.record;
      } else contact = clash;
    }

    const opp = S.newOpportunity({
      companyId: companyId, name: lead.name, value: lead.value, currency: lead.currency,
      source: lead.source, ownerId: opts.ownerId || lead.ownerId || null,
      stage: opts.stage || "qualified", contactId: contact ? contact.id : null,
      expectedClose: opts.expectedClose || "",
      notes: lead.interest || lead.notes || "",
      origin: { leadId: lead.id, leadNumber: lead.number, leadName: lead.name, contactName: lead.contactName, email: lead.email, history: clone(lead.history || []) },
    });
    if (opts.value != null && opts.value !== "") opp.value = num(opts.value);
    const ores = await S.save(pid, opp);
    if (ores.error) return ores;
    const opportunity = ores.record;

    /* Re-point the lead's activities (and its history) at the new opportunity. */
    const acts = await providerRecords(pid, "salesActivity");
    for (const a of acts) {
      if (String(a.leadId) !== String(lead.id)) continue;
      a.opportunityId = opportunity.id; a.companyId = companyId;
      await ten().upsert("provider", pid, a);
    }

    lead.status = "converted";
    lead.convertedCompanyId = companyId;
    lead.convertedOpportunityId = opportunity.id;
    lead.convertedAt = nowIso();
    lead.updatedAt = nowIso();
    lead.history = (lead.history || []).concat([{ at: nowIso(), by: actorName(), type: "converted", text: "Converted to " + company.name + " / opportunity " + (opportunity.number || opportunity.id) }]);
    await ten().upsert("provider", pid, lead);

    await emit(pid, "lead.converted", { lead: lead, opportunity: opportunity, company: company });
    return { lead: lead, companyId: companyId, company: company, contact: contact, opportunity: opportunity };
  };

  /* ═══════════════════════════ station ═══════════════════════════
     Four tabs: the pipeline board & opportunity register; quotes &
     proposals; activities & the forecast; and lead capture. */

  function blankState() {
    return { tab: "pipeline", companyId: "", ownerId: "", status: "", view: "board", includeClosed: false, quoteId: "", leadId: "", showDone: false, grain: "month" };
  }

  let currentHost = null;

  async function renderTab(id) {
    const host = currentHost;
    if (!host) return;
    const old = host.querySelector('[data-panel="' + id + '"]');
    if (!old) return;
    const panel = document.createElement("div");
    panel.className = old.className;
    panel.setAttribute("data-panel", id);
    panel.__host = host;
    old.replaceWith(panel);
    ERP.states.loading(panel, "Loading sales");
    try {
      const pid = await ten().providerId();
      if (id === "pipeline") await renderPipeline(panel, pid);
      else if (id === "quotes") await renderQuotes(panel, pid);
      else if (id === "activities") await renderActivities(panel, pid);
      else if (id === "leads") await renderLeads(panel, pid);
    } catch (e) {
      console.error("sales tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }
  const st = (panel) => panel.__host.__sales;
  const memberOptions = (members, blank) => [{ value: "", label: blank || "Unassigned" }].concat((members || []).map((m) => ({ value: m.id, label: m.name })));

  S.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "sales", title: "Sales", phase: "Phase 8 · Sales & CRM",
        message: "Create a service provider and a client company first — then work the pipeline here.",
      });
      return;
    }
    host.__sales = host.__sales || blankState();
    currentHost = host;
    const defs = [
      { id: "pipeline", label: "Pipeline" },
      { id: "quotes", label: "Quotes" },
      { id: "activities", label: "Activities & forecast" },
      { id: "leads", label: "Leads" },
    ];
    const active = defs.find((d) => d.id === host.__sales.tab) ? host.__sales.tab : "pipeline";
    host.innerHTML = ui.pageHead("Sales & CRM", "Pipeline, quotes & proposals, activities and lead conversion.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__sales.tab = b.getAttribute("data-tab");
      await renderTab(host.__sales.tab);
    }));
    await renderTab(active);
  };

  /* ── pipeline tab ── */

  async function renderPipeline(panel, pid) {
    const state = st(panel);
    const [companies, members, pipe] = await Promise.all([clientOptions(), membersList(), S.pipeline(pid, { companyId: state.companyId, ownerId: state.ownerId })]);
    const canEdit = ERP.security.can("sales.edit");
    const stageMeta = {};
    pipe.stages.forEach((s) => { stageMeta[s.code] = s; });

    const board = pipe.columns.filter((c) => state.includeClosed || !c.closed).map((c) => {
      const cards = c.opportunities.map((o) => '<div class="erp-sales-card" data-act="op-open" data-arg="' + o.id + '">' +
        '<span class="erp-sales-card-name">' + ui.esc(o.name) + "</span>" +
        '<span class="erp-sales-card-meta">' + ui.esc(o.__companyName || "") + "</span>" +
        '<span class="erp-sales-card-meta">' + maskedMoney(o.value, o.currency) + " · " + o.__probability + "% · " + ui.esc(o.expectedClose || "no date") + "</span>" +
        '<span class="erp-sales-card-meta">' + ui.esc(memberName(members, o.ownerId)) + "</span></div>").join("");
      return '<div class="erp-sales-col"><div class="erp-sales-col-head"><span>' + ui.esc(c.label) + "</span><span>" + c.opportunities.length + "</span></div>" +
        '<div class="erp-sales-card-meta">' + maskedMoney(c.value) + " · forecast " + maskedMoney(c.weighted) + "</div>" +
        '<div class="erp-sales-cards">' + (cards || '<div class="erp-sales-card-meta">Nothing here.</div>') + "</div></div>";
    }).join("");

    const rows = pipe.list.map((o) => {
      const prob = S.probOf(pipe.stages, o);
      return {
        number: ui.esc(o.number || ""),
        name: ui.esc(o.name),
        client: ui.esc(o.__companyName || ""),
        stage: ui.badge((stageMeta[o.stage] || {}).label || o.stage, (stageMeta[o.stage] || {}).tone || "muted"),
        value: maskedMoney(o.value, o.currency),
        probability: prob + "%",
        weighted: maskedMoney(round2(num(o.value) * prob / 100)),
        expected: ui.esc(o.expectedClose || "—"),
        owner: ui.esc(memberName(members, o.ownerId)),
        actions: ui.btn("Open", { small: true, act: "op-open", arg: o.id }) + (canEdit ? " " + ui.btn("Edit", { small: true, act: "op-edit", arg: o.id }) : ""),
      };
    });

    panel.innerHTML =
      ui.summary([
        { label: "Open deals", value: String(pipe.totals.open) },
        { label: "Open value", value: maskedMoney(pipe.totals.openValue) },
        { label: "Weighted forecast", value: maskedMoney(pipe.totals.weighted) },
        { label: "All value", value: maskedMoney(pipe.totals.value) },
        { label: "Deals", value: String(pipe.totals.count) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("op-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.select("op-owner", "Owner", memberOptions(members, "Anyone"), state.ownerId) +
        ui.select("op-view", "View", [{ value: "board", label: "Pipeline board" }, { value: "list", label: "List" }], state.view) +
        ui.select("op-closed", "Closed", [{ value: "", label: "Open stages" }, { value: "yes", label: "Include won/lost" }], state.includeClosed ? "yes" : "") +
        (canEdit ? ui.btn("New opportunity", { small: true, primary: true, act: "op-new" }) : "") +
      "</div>" +
      (state.view === "list"
        ? ui.table([
            { key: "number", label: "Number" }, { key: "name", label: "Opportunity" }, { key: "client", label: "Client" },
            { key: "stage", label: "Stage" }, { key: "value", label: "Value", align: "right" },
            { key: "probability", label: "Prob.", align: "right" }, { key: "weighted", label: "Weighted", align: "right" },
            { key: "expected", label: "Expected" }, { key: "owner", label: "Owner" }, { key: "actions", label: "", align: "right" },
          ], rows, { emptyText: "No opportunities match." })
        : '<div class="erp-sales-board">' + board + "</div>");

    const bindSel = (sel, key, cast) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = cast ? cast(el.value) : el.value; renderTab("pipeline"); }); };
    bindSel('[name="op-client"]', "companyId");
    bindSel('[name="op-owner"]', "ownerId");
    bindSel('[name="op-view"]', "view");
    bindSel('[name="op-closed"]', "includeClosed", (v) => v === "yes");
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "op-new") return openOpportunityModal(pid, null, () => renderTab("pipeline"));
      if (act === "op-open" || act === "op-edit") { const loc = await S.locate(pid, arg); if (loc) return openOpportunityModal(pid, loc.opportunity, () => renderTab("pipeline")); }
    });
  }

  /* ── quotes tab ── */

  async function renderQuotes(panel, pid) {
    const state = st(panel);
    const [companies, quotes] = await Promise.all([clientOptions(), S.listQuotes(pid, { companyId: state.companyId, status: state.status })]);
    const canEdit = ERP.security.can("sales.edit");
    const open = quotes.filter((q) => ["draft", "sent"].indexOf(q.status) !== -1);
    const rows = quotes.map((q) => ({
      number: ui.esc(q.number || ""),
      client: ui.esc(q.__companyName || ""),
      title: ui.esc(q.title || ""),
      status: ui.badge(S.quoteStatusLabel(q.status), S.quoteStatusTone(q.status)),
      total: maskedMoney(q.total, q.currency),
      margin: maskedMoney(q.margin) + (q.marginPct != null ? ' <span class="erp-sub">' + q.marginPct + "%</span>" : ""),
      valid: ui.esc(q.validUntil || "—"),
      actions: ui.btn("Open", { small: true, act: "q-open", arg: q.id }) + (canEdit && q.status === "draft" ? " " + ui.btn("Edit", { small: true, act: "q-edit", arg: q.id }) : "") + (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "q-del", arg: q.id }) : ""),
    }));
    panel.innerHTML =
      ui.summary([
        { label: "Quotes", value: String(quotes.length) },
        { label: "Open value", value: maskedMoney(round2(open.reduce((n, q) => n + num(q.total), 0))) },
        { label: "Accepted", value: String(quotes.filter((q) => q.status === "accepted").length) },
        { label: "Converted", value: String(quotes.filter((q) => q.status === "converted").length) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("q-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.select("q-status", "Status", [{ value: "", label: "Any status" }].concat(S.QUOTE_STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status) +
        (canEdit ? ui.btn("New quote", { small: true, primary: true, act: "q-new" }) : "") +
        '<span class="erp-db-hint">Accept a quote to enable conversion into a project, agreement or procurement.</span>' +
      "</div>" +
      ui.table([
        { key: "number", label: "Number" }, { key: "client", label: "Client" }, { key: "title", label: "Title" },
        { key: "status", label: "Status" }, { key: "total", label: "Total", align: "right" },
        { key: "margin", label: "Margin", align: "right" }, { key: "valid", label: "Valid until" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No quotes yet." });

    const bindSel = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("quotes"); }); };
    bindSel('[name="q-client"]', "companyId");
    bindSel('[name="q-status"]', "status");
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "q-new") return openQuoteModal(pid, null, () => renderTab("quotes"));
      if (act === "q-open") { const loc = await S.locateQuote(pid, arg); if (loc) return openQuoteDetail(pid, loc.quote, () => renderTab("quotes")); }
      if (act === "q-edit") { const loc = await S.locateQuote(pid, arg); if (loc) return openQuoteModal(pid, loc.quote, () => renderTab("quotes")); }
      if (act === "q-del") {
        const loc = await S.locateQuote(pid, arg);
        if (!loc) return;
        ui.confirm({ title: "Delete quote", message: "Delete " + (loc.quote.number || "this quote") + "?", onConfirm: async () => {
          const r = await S.removeQuote(pid, loc.companyId, arg);
          if (r.error) return ERP.toast(r.message || r.error, "error");
          ERP.toast("Quote deleted.", "success"); renderTab("quotes");
        } });
      }
    });
  }

  /* ── activities & forecast tab ── */

  async function renderActivities(panel, pid) {
    const state = st(panel);
    const members = await membersList();
    const [activities, next, forecast] = await Promise.all([
      S.activities(pid, { ownerId: state.ownerId, open: state.showDone ? undefined : true }),
      S.nextSteps(pid, { ownerId: state.ownerId }),
      S.forecast(pid, { companyId: state.companyId, ownerId: state.ownerId, grain: state.grain }),
    ]);
    const canAct = ERP.security.can("sales.activity");
    const today = ui.today();
    const actRows = activities.map((a) => ({
      type: ui.badge(S.activityLabel(a.type), a.type === "call" ? "info" : "muted"),
      subject: ui.esc(a.subject),
      target: a.opportunityId ? "opportunity #" + ui.esc(a.opportunityId) : (a.leadId ? "lead #" + ui.esc(a.leadId) : (a.companyId ? "client #" + ui.esc(a.companyId) : "—")),
      owner: ui.esc(memberName(members, a.ownerId)),
      due: a.dueDate ? (a.__overdue ? ui.badge(a.dueDate, "danger") : ui.esc(a.dueDate)) : "—",
      status: a.done ? ui.badge("Done", "success") : (a.dueDate && String(a.dueDate) < today ? ui.badge("Overdue", "danger") : ui.badge("Open", "info")),
      actions: canAct ? (a.done ? ui.btn("Reopen", { small: true, act: "ac-reopen", arg: a.id }) : ui.btn("Complete", { small: true, primary: true, act: "ac-done", arg: a.id })) + " " + ui.btn("Delete", { small: true, danger: true, act: "ac-del", arg: a.id }) : "",
    }));
    const sum = forecast.totals;
    const stageRows = forecast.byStage.map((r) => ({ stage: ui.esc(r.label), count: String(r.count), value: maskedMoney(r.value), weighted: maskedMoney(r.weighted) }));
    const ownerRows = forecast.byOwner.map((r) => ({ owner: ui.esc(memberName(members, r.ownerId)), count: String(r.count), value: maskedMoney(r.value), weighted: maskedMoney(r.weighted) }));
    const periodRows = forecast.byPeriod.map((r) => ({ period: ui.esc(r.period), count: String(r.count), value: maskedMoney(r.value), weighted: maskedMoney(r.weighted) }));

    panel.innerHTML =
      ui.summary([
        { label: "Open next steps", value: String(next.length) },
        { label: "Overdue", value: String(next.filter((a) => a.__overdue).length) },
        { label: "Weighted forecast", value: maskedMoney(sum.weighted) },
        { label: "Committed (won)", value: maskedMoney(sum.wonValue) },
        { label: "Win rate", value: sum.winRate == null ? "—" : sum.winRate + "%" },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("ac-owner", "Owner", memberOptions(members, "Anyone"), state.ownerId) +
        ui.select("ac-done", "Show", [{ value: "", label: "Open only" }, { value: "yes", label: "Include completed" }], state.showDone ? "yes" : "") +
        ui.select("ac-grain", "Forecast grain", [{ value: "month", label: "By month" }, { value: "quarter", label: "By quarter" }], state.grain) +
        (canAct ? ui.btn("Log activity", { small: true, primary: true, act: "ac-new" }) : "") +
      "</div>" +
      ui.card("Next steps", ui.table([
        { key: "type", label: "Type" }, { key: "subject", label: "Subject" }, { key: "target", label: "Against" },
        { key: "owner", label: "Owner" }, { key: "due", label: "Due" }, { key: "status", label: "Status" }, { key: "actions", label: "", align: "right" },
      ], actRows, { emptyText: "No activities logged." })) +
      ui.card("Forecast by stage", ui.table([
        { key: "stage", label: "Stage" }, { key: "count", label: "Deals", align: "right" }, { key: "value", label: "Value", align: "right" }, { key: "weighted", label: "Weighted", align: "right" },
      ], stageRows, { emptyText: "No opportunities." })) +
      ui.grid([
        ui.card("Forecast by owner", ui.table([
          { key: "owner", label: "Owner" }, { key: "count", label: "Deals", align: "right" }, { key: "value", label: "Value", align: "right" }, { key: "weighted", label: "Weighted", align: "right" },
        ], ownerRows, { emptyText: "Nothing to forecast." })),
        ui.card("Forecast by period", ui.table([
          { key: "period", label: "Period" }, { key: "count", label: "Deals", align: "right" }, { key: "value", label: "Value", align: "right" }, { key: "weighted", label: "Weighted", align: "right" },
        ], periodRows, { emptyText: "No dated opportunities." })),
      ]);

    const bindSel = (sel, key, cast) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = cast ? cast(el.value) : el.value; renderTab("activities"); }); };
    bindSel('[name="ac-owner"]', "ownerId");
    bindSel('[name="ac-done"]', "showDone", (v) => v === "yes");
    bindSel('[name="ac-grain"]', "grain");
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ac-new") return openActivityModal(pid, null, () => renderTab("activities"));
      if (act === "ac-done") { await S.completeActivity(pid, arg); ERP.toast("Activity completed.", "success"); return renderTab("activities"); }
      if (act === "ac-reopen") { await S.reopenActivity(pid, arg); return renderTab("activities"); }
      if (act === "ac-del") { await S.removeActivity(pid, arg); ERP.toast("Activity removed.", "success"); return renderTab("activities"); }
    });
  }

  /* ── leads tab ── */

  async function renderLeads(panel, pid) {
    const state = st(panel);
    const members = await membersList();
    const leads = await S.leads(pid, { status: state.status, ownerId: state.ownerId });
    const canEdit = ERP.security.can("sales.edit");
    const rows = [];
    for (const l of leads) {
      const dup = await S.dedupe(pid, l);
      rows.push({
        number: ui.esc(l.number || ""),
        name: ui.esc(l.name) + (l.__stale ? " " + ui.badge("stale", "warn") : ""),
        contact: ui.esc(l.contactName || "—") + (l.email ? ' <span class="erp-sub">' + ui.esc(l.email) + "</span>" : ""),
        source: ui.esc(l.source || "—"),
        status: ui.badge(S.leadStatusLabel(l.status), S.leadStatusTone(l.status)),
        value: maskedMoney(l.value, l.currency),
        owner: ui.esc(memberName(members, l.ownerId)),
        dup: dup.any ? ui.badge("possible duplicate", "warn") : "—",
        actions: ui.btn("Open", { small: true, act: "ld-open", arg: l.id }) + (canEdit && !l.convertedAt ? " " + ui.btn("Convert", { small: true, primary: true, act: "ld-convert", arg: l.id }) : "") + (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "ld-del", arg: l.id }) : ""),
      });
    }
    const all = await S.leads(pid, {});
    panel.innerHTML =
      ui.summary([
        { label: "Leads", value: String(all.length) },
        { label: "New", value: String(all.filter((l) => l.status === "new").length) },
        { label: "Qualified", value: String(all.filter((l) => l.status === "qualified").length) },
        { label: "Converted", value: String(all.filter((l) => l.convertedAt).length) },
        { label: "Pipeline value", value: maskedMoney(round2(all.filter((l) => !l.convertedAt).reduce((n, l) => n + num(l.value), 0))) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("ld-status", "Status", [{ value: "", label: "Any status" }].concat(S.LEAD_STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status) +
        ui.select("ld-owner", "Owner", memberOptions(members, "Anyone"), state.ownerId) +
        (canEdit ? ui.btn("New lead", { small: true, primary: true, act: "ld-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "number", label: "Number" }, { key: "name", label: "Lead" }, { key: "contact", label: "Contact" },
        { key: "source", label: "Source" }, { key: "status", label: "Status" }, { key: "value", label: "Value", align: "right" },
        { key: "owner", label: "Owner" }, { key: "dup", label: "Dedupe" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No leads captured yet." });

    const bindSel = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("leads"); }); };
    bindSel('[name="ld-status"]', "status");
    bindSel('[name="ld-owner"]', "ownerId");
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ld-new") return openLeadModal(pid, null, () => renderTab("leads"));
      if (act === "ld-open") { const l = await S.getLead(pid, arg); if (l) return openLeadModal(pid, l, () => renderTab("leads")); }
      if (act === "ld-convert") { const l = await S.getLead(pid, arg); if (l) return openConvertLeadModal(pid, l, () => renderTab("leads")); }
      if (act === "ld-del") {
        const l = await S.getLead(pid, arg);
        if (!l) return;
        ui.confirm({ title: "Delete lead", message: "Delete " + l.name + "?", onConfirm: async () => {
          const r = await S.removeLead(pid, arg);
          if (r.error) return ERP.toast(r.message || r.error, "error");
          ERP.toast("Lead deleted.", "success"); renderTab("leads");
        } });
      }
    });
  }

  /* ═══════════════════════════ modals ═══════════════════════════ */

  async function openReasonModal(title, label, value, onConfirm) {
    const modal = ui.modal({
      title: title, body: ui.form(ui.text("reason", label, value || "", "")),
      foot: ui.btn("Cancel", { small: true, act: "rs-cancel" }) + " " + ui.btn("Confirm", { small: true, primary: true, act: "rs-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=rs-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=rs-save]").onclick = async () => {
      const v = ui.collect(form, ["reason"]);
      ui.closeModal();
      await onConfirm(v.reason || "");
    };
  }

  async function openOpportunityModal(pid, opp, refresh) {
    if (!ERP.security.enforce("sales.edit", { companyId: opp ? opp.companyId : null })) return;
    const [companies, members, stages] = await Promise.all([clientOptions(), membersList(), S.stageOptions(pid)]);
    const o = opp || S.newOpportunity();
    const isNew = !opp;
    const history = (o.stageHistory || []).slice().reverse().slice(0, 8).map((h) => '<div class="erp-timeline-item"><span class="erp-timeline-when">' + ui.dateTime(h.at) + "</span> " + ui.esc(h.from || "—") + " → <b>" + ui.esc(h.to) + "</b>" + (h.note ? " · " + ui.esc(h.note) : "") + "</div>").join("");
    const activities = opp ? await S.activities(pid, { opportunityId: opp.id }) : [];
    const actHtml = activities.slice(0, 8).map((a) => '<div class="erp-timeline-item"><span class="erp-timeline-when">' + ui.dateTime(a.at) + "</span> " + ui.badge(S.activityLabel(a.type), "muted") + " " + ui.esc(a.subject) + (a.done ? " " + ui.badge("done", "success") : (a.dueDate ? " · due " + ui.esc(a.dueDate) : "")) + "</div>").join("");

    const fields =
      ui.select("companyId", "Client", companies, o.companyId, "— choose a client —") +
      ui.text("name", "Opportunity", o.name, "e.g. Network refresh") +
      '<div class="erp-form-row">' +
        ui.number("value", "Value", o.value, { min: 0, step: 0.01 }) +
        ui.select("stage", "Stage", stages, o.stage) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("probability", "Probability %", o.probability == null ? "" : o.probability, { min: 0, max: 100, step: 1, hint: "Blank = the stage's default" }) +
        ui.dateInput("expectedClose", "Expected close", o.expectedClose) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("ownerId", "Owner", memberOptions(members, "Unassigned"), o.ownerId) +
        ui.select("source", "Source", [{ value: "", label: "— unknown —" }].concat(await sourceOptions(pid)), o.source) +
      "</div>" +
      ui.text("winLossReason", "Win / loss reason", o.winLossReason, "Why it was won or lost") +
      ui.textarea("notes", "Notes", o.notes || "", 3) +
      (opp ? '<dl class="erp-defs"><dt>Number</dt><dd>' + ui.esc(o.number || "") + "</dd><dt>Created</dt><dd>" + ui.esc(ui.date(o.createdAt)) + "</dd></dl>" : "");
    const body = ui.form(fields) +
      (opp ? ui.card("Stage history", history || '<p class="erp-alert">No stage changes yet.</p>') + ui.card("Activity", actHtml || '<p class="erp-alert">No activity yet.</p>') : "");
    const foot = ui.btn("Cancel", { small: true, act: "opm-cancel" }) +
      (opp && ERP.security.can("sales.edit") ? " " + ui.btn("Mark won", { small: true, primary: true, act: "opm-won" }) + " " + ui.btn("Mark lost", { small: true, danger: true, act: "opm-lost" }) : "") +
      " " + ui.btn(isNew ? "Create" : "Save", { small: true, primary: true, act: "opm-save" });
    const modal = ui.modal({ title: isNew ? "New opportunity" : "Opportunity", size: "lg", body: body, foot: foot });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=opm-cancel]").onclick = () => ui.closeModal();
    if (modal.querySelector("[data-act=opm-won]")) modal.querySelector("[data-act=opm-won]").onclick = () => openReasonModal("Mark won", "Win reason", o.winLossReason, async (reason) => {
      const r = await S.win(pid, o.companyId, o.id, reason);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ERP.toast("Marked won.", "success"); refresh();
    });
    if (modal.querySelector("[data-act=opm-lost]")) modal.querySelector("[data-act=opm-lost]").onclick = () => openReasonModal("Mark lost", "Loss reason", o.winLossReason, async (reason) => {
      const r = await S.lose(pid, o.companyId, o.id, reason);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ERP.toast("Marked lost.", "success"); refresh();
    });
    modal.querySelector("[data-act=opm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["companyId", "name", "value", "stage", "probability", "expectedClose", "ownerId", "source", "winLossReason", "notes"]);
      if (!v.companyId || !v.name) return ERP.toast("Choose a client and name the opportunity.", "error");
      btn.disabled = true;
      const payload = Object.assign({}, o, v, { id: o.id, ownerId: v.ownerId === "" ? null : v.ownerId, probability: v.probability });
      const r = await S.save(pid, payload);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(isNew ? "Opportunity created." : "Opportunity saved.", "success"); refresh();
    };
  }

  async function sourceOptions(pid) {
    try { const list = await ERP.taxonomy.optionList(pid, "source"); return list.length ? list : defaultSources(); } catch (e) { return defaultSources(); }
  }
  function defaultSources() {
    return [{ value: "referral", label: "Referral" }, { value: "inbound", label: "Inbound" }, { value: "outbound", label: "Outbound" }, { value: "existing-client", label: "Existing client" }, { value: "partner", label: "Partner" }];
  }

  async function openQuoteModal(pid, quote, refresh) {
    if (!ERP.security.enforce("sales.edit", { companyId: quote ? quote.companyId : null })) return;
    const [companies, opps] = await Promise.all([clientOptions(), S.list(pid, {})]);
    const q = quote ? clone(quote) : S.newQuote({ issuedDate: ui.today(), validUntil: ui.addDays(ui.today(), 30) });
    q.lines = (q.lines || []).map((l) => Object.assign(S.newLine(), l));
    let lineSeq = q.lines.length;

    const oppOptions = [{ value: "", label: "— none —" }].concat(opps.map((o) => ({ value: o.id, label: (o.number || "") + " " + o.name })));
    const head =
      ui.select("companyId", "Client", companies, q.companyId, "— choose a client —") +
      ui.text("title", "Title", q.title, "e.g. Managed services proposal") +
      '<div class="erp-form-row">' +
        ui.select("opportunityId", "Opportunity", oppOptions, q.opportunityId) +
        ui.select("contactId", "Contact", [{ value: "", label: "— none —" }], q.contactId || "") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("issuedDate", "Issued", q.issuedDate) +
        ui.dateInput("validUntil", "Valid until", q.validUntil) +
        ui.number("taxRate", "Tax %", q.taxRate, { min: 0, step: 0.1 }) +
      "</div>" +
      ui.textarea("terms", "Terms", q.terms || "", 2) +
      ui.textarea("notes", "Notes", q.notes || "", 2);

    const body = ui.form(head) +
      ui.card("Line items",
        '<div class="erp-proj-add-row">' + ui.btn("Add line", { small: true, act: "qm-addline" }) +
          (ERP.catalog ? " " + ui.btn("Add from catalog", { small: true, act: "qm-cat" }) : "") + "</div>" +
        '<div data-q-catalog hidden></div>' +
        "<div data-q-lines></div>") +
      '<div data-q-totals></div>';
    const modal = ui.modal({
      title: quote ? "Edit quote" : "New quote", size: "lg", body: body,
      foot: ui.btn("Cancel", { small: true, act: "qm-cancel" }) + " " + ui.btn(quote ? "Save" : "Create", { small: true, primary: true, act: "qm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const linesCtn = modal.querySelector("[data-q-lines]");
    const catCtn = modal.querySelector("[data-q-catalog]");
    const totalsCtn = modal.querySelector("[data-q-totals]");

    function readLines() {
      const rows = linesCtn.querySelectorAll("[data-line]");
      const out = [];
      rows.forEach((row) => {
        out.push({
          id: row.getAttribute("data-line"),
          itemId: row.getAttribute("data-item") || null,
          kind: row.querySelector('[data-lf="kind"]').value,
          description: row.querySelector('[data-lf="description"]').value,
          qty: num(row.querySelector('[data-lf="qty"]').value, 1),
          unit: row.querySelector('[data-lf="unit"]').value,
          unitCost: num(row.querySelector('[data-lf="unitCost"]').value),
          unitPrice: num(row.querySelector('[data-lf="unitPrice"]').value),
          discountPct: num(row.querySelector('[data-lf="discountPct"]').value),
        });
      });
      return out;
    }
    function drawTotals() {
      const read = S.computeQuote(Object.assign({}, q, { lines: readLines(), taxRate: num((form.querySelector('[name="taxRate"]') || {}).value) }));
      totalsCtn.innerHTML = ui.summary([
        { label: "Subtotal", value: maskedMoney(read.subtotal) },
        { label: "Discount", value: maskedMoney(read.discountTotal) },
        { label: "Tax", value: maskedMoney(read.tax) },
        { label: "Total", value: maskedMoney(read.total) },
        { label: "Cost", value: maskedMoney(read.costTotal) },
        { label: "Margin", value: maskedMoney(read.margin) + (read.marginPct != null ? '<span class="erp-sub">' + read.marginPct + "%</span>" : "") },
      ]);
    }
    function drawLines() {
      linesCtn.innerHTML = (q.lines.length ? q.lines.map((l) => '<div class="erp-sales-line" data-line="' + ui.esc(l.id) + '" data-item="' + ui.esc(l.itemId || "") + '">' +
        '<input class="erp-input" data-lf="description" value="' + ui.esc(l.description) + '" placeholder="Description">' +
        '<select class="erp-input" data-lf="kind">' + S.LINE_KINDS.map((k) => '<option value="' + k.id + '"' + (k.id === l.kind ? " selected" : "") + ">" + ui.esc(k.label) + "</option>").join("") + "</select>" +
        '<input class="erp-input" type="number" data-lf="qty" value="' + ui.esc(l.qty) + '" placeholder="Qty">' +
        '<input class="erp-input" data-lf="unit" value="' + ui.esc(l.unit) + '" placeholder="Unit">' +
        '<input class="erp-input" type="number" data-lf="unitCost" value="' + ui.esc(l.unitCost) + '" placeholder="Cost">' +
        '<input class="erp-input" type="number" data-lf="unitPrice" value="' + ui.esc(l.unitPrice) + '" placeholder="Price">' +
        '<input class="erp-input" type="number" data-lf="discountPct" value="' + ui.esc(l.discountPct) + '" placeholder="Disc %">' +
        '<button type="button" class="btn small danger" data-act="qm-rmline" data-arg="' + ui.esc(l.id) + '">×</button></div>').join("")
        : '<p class="erp-alert">No lines yet — add one.</p>');
      drawTotals();
    }
    drawLines();
    form.addEventListener("input", drawTotals);
    linesCtn.addEventListener("input", drawTotals);
    modal.querySelector("[data-act=qm-addline]").onclick = () => {
      q.lines = readLines();
      lineSeq += 1;
      q.lines.push(S.newLine({ id: "L" + lineSeq }));
      drawLines();
    };
    let catalogCache = null;
    async function toggleCatalog() {
      if (!catCtn.hidden) { catCtn.hidden = true; return; }
      if (!catalogCache) catalogCache = await ERP.catalog.items(pid, { active: "active" });
      if (!catalogCache.length) { ERP.toast("The catalog is empty — add items in the Products station.", "error"); return; }
      const companyId = (form.querySelector('[name="companyId"]') || {}).value || "";
      const rows = [];
      for (const it of catalogCache) {
        const r = await ERP.catalog.resolvePrice(pid, { itemId: it.id, companyId: companyId });
        rows.push({
          sku: ui.esc(it.sku || ""),
          name: ui.esc(it.name),
          unit: ui.esc(it.unit || ""),
          cost: maskedMoney(it.cost),
          price: maskedMoney(r.price),
          source: ui.esc(r.source),
          pick: ui.btn("Add", { small: true, primary: true, act: "cp-add", arg: it.id }),
        });
      }
      catCtn.innerHTML = ui.table([
        { key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "unit", label: "Unit" },
        { key: "cost", label: "Cost", align: "right" }, { key: "price", label: "Price", align: "right" },
        { key: "source", label: "Priced by" }, { key: "pick", label: "", align: "right" },
      ], rows, { emptyText: "No catalog items." });
      catCtn.hidden = false;
    }
    ui.bind(modal, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "qm-rmline") { q.lines = readLines().filter((l) => String(l.id) !== String(arg)); drawLines(); return; }
      if (act === "qm-cat") { await toggleCatalog(); return; }
      if (act === "cp-add") {
        const it = (catalogCache || []).find((x) => String(x.id) === String(arg));
        if (!it) return;
        const companyId = (form.querySelector('[name="companyId"]') || {}).value || "";
        const price = await ERP.catalog.priceFor(pid, it.id, { companyId: companyId });
        q.lines = readLines();
        lineSeq += 1;
        q.lines.push(S.newLine({ id: "L" + lineSeq, itemId: it.id, kind: it.type === "product" ? "product" : (it.type === "labor" ? "labor" : "service"), description: it.name, qty: 1, unit: it.unit || "each", unitCost: it.cost, unitPrice: price }));
        drawLines();
      }
    });
    modal.querySelector("[data-act=qm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=qm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["companyId", "title", "opportunityId", "contactId", "issuedDate", "validUntil", "taxRate", "terms", "notes"]);
      if (!v.companyId || !v.title) return ERP.toast("Choose a client and give the quote a title.", "error");
      btn.disabled = true;
      const payload = Object.assign({}, q, v, { lines: readLines(), id: q.id, opportunityId: v.opportunityId === "" ? null : v.opportunityId });
      const r = await S.saveQuote(pid, payload);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(quote ? "Quote saved." : "Quote created.", "success"); refresh();
    };
  }

  async function openQuoteDetail(pid, quote, refresh) {
    const company = await ERP.companies.get(quote.companyId);
    const opp = quote.opportunityId ? await S.get(quote.companyId, quote.opportunityId) : null;
    const canEdit = ERP.security.can("sales.edit");
    const canConvert = ERP.security.can("sales.convert");
    const stages = {}; (await S.stages(pid)).forEach((s) => { stages[s.code] = s; });
    const lineRows = (quote.lines || []).map((l) => ({
      description: ui.esc(l.description || "—"),
      kind: ui.badge(S.lineKindLabel(l.kind), "muted"),
      qty: ui.fmt(l.qty, 2),
      unitCost: maskedMoney(l.unitCost),
      unitPrice: maskedMoney(l.unitPrice),
      discount: num(l.discountPct) ? l.discountPct + "%" : "—",
      net: maskedMoney(l.net),
      margin: maskedMoney(round2(num(l.net) - num(l.cost))),
    }));
    const body =
      ui.summary([
        { label: "Status", value: ui.badge(S.quoteStatusLabel(quote.status), S.quoteStatusTone(quote.status)) },
        { label: "Subtotal", value: maskedMoney(quote.subtotal) },
        { label: "Tax", value: maskedMoney(quote.tax) },
        { label: "Total", value: maskedMoney(quote.total) },
        { label: "Margin", value: maskedMoney(quote.margin) + (quote.marginPct != null ? '<span class="erp-sub">' + quote.marginPct + "%</span>" : "") },
      ]) +
      '<dl class="erp-defs">' +
        "<dt>Number</dt><dd>" + ui.esc(quote.number || "") + "</dd>" +
        "<dt>Client</dt><dd>" + ui.esc(company ? company.name : "") + "</dd>" +
        "<dt>Opportunity</dt><dd>" + (opp ? ui.esc(opp.name) : "—") + "</dd>" +
        "<dt>Issued</dt><dd>" + ui.esc(quote.issuedDate || "—") + "</dd>" +
        "<dt>Valid until</dt><dd>" + ui.esc(quote.validUntil || "—") + "</dd>" +
        "<dt>Cost</dt><dd>" + maskedMoney(quote.costTotal) + "</dd>" +
      "</dl>" +
      (quote.converted && (quote.converted.projectId || quote.converted.agreementId || (quote.converted.procurement || []).length)
        ? ui.alert("Converted" + (quote.converted.projectId ? " → project #" + ui.esc(quote.converted.projectId) : "") + (quote.converted.agreementId ? " · agreement #" + ui.esc(quote.converted.agreementId) : "") + ((quote.converted.procurement || []).length ? " · " + quote.converted.procurement.length + " procurement line(s)" : "") + ".", "info")
        : "") +
      ui.table([
        { key: "description", label: "Description" }, { key: "kind", label: "Type" }, { key: "qty", label: "Qty", align: "right" },
        { key: "unitCost", label: "Cost", align: "right" }, { key: "unitPrice", label: "Price", align: "right" },
        { key: "discount", label: "Disc.", align: "right" }, { key: "net", label: "Net", align: "right" }, { key: "margin", label: "Margin", align: "right" },
      ], lineRows, { emptyText: "No lines." }) +
      (quote.terms ? ui.card("Terms", "<p>" + ui.esc(quote.terms) + "</p>") : "") +
      (quote.notes ? ui.card("Notes", "<p>" + ui.esc(quote.notes) + "</p>") : "");

    const foot =
      ui.btn("Close", { small: true, act: "qd-close" }) +
      " " + ui.btn("Print proposal", { small: true, act: "qd-print" }) +
      (canEdit && quote.status === "draft" ? " " + ui.btn("Send", { small: true, act: "qd-send" }) : "") +
      (canEdit && (quote.status === "draft" || quote.status === "sent") ? " " + ui.btn("Accept", { small: true, primary: true, act: "qd-accept" }) + " " + ui.btn("Decline", { small: true, danger: true, act: "qd-decline" }) : "") +
      (canConvert && quote.status === "accepted" ? " " + ui.btn("Convert", { small: true, primary: true, act: "qd-convert" }) : "") +
      (canEdit && quote.status !== "converted" ? " " + ui.btn("Edit", { small: true, act: "qd-edit" }) : "");
    const modal = ui.modal({ title: "Quote " + (quote.number || ""), size: "lg", body: body, foot: foot });
    modal.querySelector("[data-act=qd-close]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=qd-print]").onclick = () => S.printProposal(pid, quote.companyId, quote.id);
    if (modal.querySelector("[data-act=qd-send]")) modal.querySelector("[data-act=qd-send]").onclick = async () => {
      const r = await S.setQuoteStatus(pid, quote.companyId, quote.id, "sent");
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ui.closeModal(); ERP.toast("Quote sent.", "success"); refresh();
    };
    if (modal.querySelector("[data-act=qd-accept]")) modal.querySelector("[data-act=qd-accept]").onclick = async () => {
      const r = await S.acceptQuote(pid, quote.companyId, quote.id);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ui.closeModal(); ERP.toast("Quote accepted — ready to convert.", "success"); refresh();
    };
    if (modal.querySelector("[data-act=qd-decline]")) modal.querySelector("[data-act=qd-decline]").onclick = () => openReasonModal("Decline quote", "Reason", "", async (reason) => {
      const r = await S.declineQuote(pid, quote.companyId, quote.id, reason);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ERP.toast("Quote declined.", "success"); refresh();
    });
    if (modal.querySelector("[data-act=qd-convert]")) modal.querySelector("[data-act=qd-convert]").onclick = () => { ui.closeModal(); openConvertQuoteModal(pid, quote, refresh); };
    if (modal.querySelector("[data-act=qd-edit]")) modal.querySelector("[data-act=qd-edit]").onclick = () => { ui.closeModal(); openQuoteModal(pid, quote, refresh); };
  }

  async function openConvertQuoteModal(pid, quote, refresh) {
    if (!ERP.security.enforce("sales.convert", { companyId: quote.companyId })) return;
    const projects = ERP.projects ? await ERP.projects.templates(await ten().providerId()) : [];
    const productLines = (quote.lines || []).filter((l) => l.kind === "product").length;
    const body = ui.form(
      ui.check("doProject", "Create a project from this quote", false) +
      ui.select("templateId", "Project template (optional)", [{ value: "", label: "— blank project —" }].concat((projects || []).map((t) => ({ value: t.id, label: t.name }))), "") +
      ui.text("projectName", "Project name", quote.title, "") +
      ui.check("doAgreement", "Create an agreement for the total", false) +
      ui.select("agreementType", "Agreement type", [{ value: "one-off", label: "One-off" }, { value: "managed", label: "Managed / recurring" }, { value: "block-hours", label: "Block of hours" }], "one-off") +
      ui.check("doProcurement", "Raise procurement for product lines" + (productLines ? " (" + productLines + ")" : ""), productLines > 0)
    ) + ui.alert("Conversion records the created ids on the quote and marks it converted. Procurement intents are picked up by the Phase 9 purchasing station.", "info");
    const modal = ui.modal({
      title: "Convert quote " + (quote.number || ""), size: "lg", body: body,
      foot: ui.btn("Cancel", { small: true, act: "cq-cancel" }) + " " + ui.btn("Convert", { small: true, primary: true, act: "cq-go" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=cq-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=cq-go]").onclick = async (btn) => {
      const v = ui.collect(form, ["doProject", "templateId", "projectName", "doAgreement", "agreementType", "doProcurement"]);
      if (!v.doProject && !v.doAgreement && !v.doProcurement) return ERP.toast("Choose at least one conversion target.", "error");
      btn.disabled = true;
      const r = await S.convertQuote(pid, quote.companyId, quote.id, {
        project: v.doProject ? { templateId: v.templateId || null, name: v.projectName || quote.title } : false,
        agreement: v.doAgreement ? { type: v.agreementType } : false,
        procurement: !!v.doProcurement,
      });
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal();
      ERP.toast("Quote converted" + (r.projectId ? " → project" : "") + (r.agreementId ? " → agreement" : "") + (r.procurement.length ? " → " + r.procurement.length + " procurement line(s)" : "") + ".", "success");
      refresh();
    };
  }

  async function openActivityModal(pid, activity, refresh, preset) {
    if (!ERP.security.enforce("sales.activity")) return;
    const [companies, members, opps] = await Promise.all([clientOptions(), membersList(), S.list(pid, {})]);
    const a = activity || S.newActivity(Object.assign({ dueDate: ui.today(), ownerId: (actor().memberId || null) }, preset || {}));
    const leads = await S.leads(pid, {});
    const body = ui.form(
      ui.select("type", "Type", S.ACTIVITY_TYPES.map((t) => ({ value: t.id, label: t.label })), a.type) +
      ui.text("subject", "Subject", a.subject, "e.g. Discovery call") +
      '<div class="erp-form-row">' +
        ui.select("companyId", "Client", [{ value: "", label: "— none —" }].concat(companies), a.companyId) +
        ui.select("opportunityId", "Opportunity", [{ value: "", label: "— none —" }].concat(opps.map((o) => ({ value: o.id, label: o.name }))), a.opportunityId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("leadId", "Lead", [{ value: "", label: "— none —" }].concat(leads.map((l) => ({ value: l.id, label: l.name }))), a.leadId) +
        ui.select("ownerId", "Owner", memberOptions(members, "Unassigned"), a.ownerId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("dueDate", "Due / next step", a.dueDate) +
        ui.check("done", "Done", a.done) +
      "</div>" +
      ui.textarea("notes", "Notes", a.notes || "", 3)
    );
    const modal = ui.modal({
      title: activity ? "Edit activity" : "Log activity", size: "lg", body: body,
      foot: ui.btn("Cancel", { small: true, act: "am-cancel" }) + " " + ui.btn(activity ? "Save" : "Log", { small: true, primary: true, act: "am-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=am-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=am-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["type", "subject", "companyId", "opportunityId", "leadId", "ownerId", "dueDate", "done", "notes"]);
      if (!v.subject) return ERP.toast("Give the activity a subject.", "error");
      btn.disabled = true;
      const payload = {
        type: v.type, subject: v.subject, notes: v.notes, dueDate: v.dueDate, done: !!v.done,
        companyId: v.companyId === "" ? null : v.companyId, opportunityId: v.opportunityId === "" ? null : v.opportunityId,
        leadId: v.leadId === "" ? null : v.leadId, ownerId: v.ownerId === "" ? null : v.ownerId,
        doneAt: v.done ? (a.doneAt || nowIso()) : null,
      };
      const r = activity ? await S.updateActivity(pid, activity.id, payload) : await S.logActivity(pid, payload);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(activity ? "Activity saved." : "Activity logged.", "success"); refresh();
    };
  }

  async function openLeadModal(pid, lead, refresh) {
    if (!ERP.security.enforce("sales.edit")) return;
    const members = await membersList();
    const l = lead || S.newLead();
    const isNew = !lead;
    let dup = { any: false };
    if (isNew && (l.name || l.email || l.website || l.phone)) dup = await S.dedupe(pid, l);
    const history = (l.history || []).slice().reverse().slice(0, 10).map((h) => '<div class="erp-timeline-item"><span class="erp-timeline-when">' + ui.dateTime(h.at) + "</span> <b>" + ui.esc(h.type || "note") + "</b> — " + ui.esc(h.text) + (h.by ? ' <span class="erp-sub">by ' + ui.esc(h.by) + "</span>" : "") + "</div>").join("");
    const fields =
      ui.text("name", "Lead / company name", l.name, "") +
      '<div class="erp-form-row">' +
        ui.text("contactName", "Contact name", l.contactName, "") +
        ui.text("email", "Email", l.email, "") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("phone", "Phone", l.phone, "") +
        ui.text("website", "Website", l.website, "") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("status", "Status", S.LEAD_STATUSES.map((s) => ({ value: s.id, label: s.label })), l.status) +
        ui.select("source", "Source", [{ value: "", label: "— unknown —" }].concat(await sourceOptions(pid)), l.source) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("value", "Est. value", l.value, { min: 0, step: 0.01 }) +
        ui.select("ownerId", "Owner", memberOptions(members, "Unassigned"), l.ownerId) +
      "</div>" +
      ui.textarea("interest", "Interest", l.interest || "", 2) +
      ui.textarea("notes", "Notes", l.notes || "", 2);
    const body = ui.form(fields) +
      (isNew && dup.any ? ui.alert("Possible duplicate: " + dupSummary(dup) + ". Save and convert to the matching company to avoid a duplicate record.", "warn") : "") +
      (lead && l.convertedAt ? ui.alert("Converted" + (l.convertedCompanyId ? " → client #" + ui.esc(l.convertedCompanyId) : "") + (l.convertedOpportunityId ? ", opportunity #" + ui.esc(l.convertedOpportunityId) : "") + ".", "info") : "") +
      (lead ? ui.card("History", history || '<p class="erp-alert">No history yet.</p>') : "");
    const foot = ui.btn("Cancel", { small: true, act: "lm-cancel" }) +
      (lead && !l.convertedAt && ERP.security.can("sales.convert") ? " " + ui.btn("Convert", { small: true, primary: true, act: "lm-convert" }) : "") +
      " " + ui.btn(isNew ? "Capture lead" : "Save", { small: true, primary: true, act: "lm-save" });
    const modal = ui.modal({ title: isNew ? "New lead" : "Lead", size: "lg", body: body, foot: foot });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=lm-cancel]").onclick = () => ui.closeModal();
    if (modal.querySelector("[data-act=lm-convert]")) modal.querySelector("[data-act=lm-convert]").onclick = () => { ui.closeModal(); openConvertLeadModal(pid, lead, refresh); };
    modal.querySelector("[data-act=lm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "contactName", "email", "phone", "website", "status", "source", "value", "ownerId", "interest", "notes"]);
      if (!v.name) return ERP.toast("Give the lead a name.", "error");
      btn.disabled = true;
      const payload = Object.assign({}, l, v, { id: l.id, ownerId: v.ownerId === "" ? null : v.ownerId });
      const r = await S.saveLead(pid, payload);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(isNew ? "Lead captured." : "Lead saved.", "success"); refresh();
    };
  }

  function dupSummary(dup) {
    const parts = [];
    if (dup.companies.length) parts.push("client " + dup.companies.map((c) => c.name).join(", "));
    if (dup.contacts.length) parts.push("contact " + dup.contacts.map((c) => c.name).join(", "));
    if (dup.leads.length) parts.push("lead " + dup.leads.map((l) => l.name).join(", "));
    return parts.join(" · ");
  }

  async function openConvertLeadModal(pid, lead, refresh) {
    if (!ERP.security.enforce("sales.convert")) return;
    const [companies, members] = await Promise.all([clientOptions(), membersList()]);
    const dup = await S.dedupe(pid, lead);
    const stages = await S.stageOptions(pid);
    const recommended = dup.companies.length ? String(dup.companies[0].id) : "";
    const body = ui.form(
      ui.select("companyId", "Client", [{ value: "", label: "— create a new client —" }].concat(companies), lead.convertedCompanyId || recommended) +
      ui.select("stage", "Opening stage", stages, "qualified") +
      '<div class="erp-form-row">' +
        ui.number("value", "Value", lead.value, { min: 0, step: 0.01 }) +
        ui.select("ownerId", "Owner", memberOptions(members, "Unassigned"), lead.ownerId || null) +
      "</div>" +
      ui.dateInput("expectedClose", "Expected close", "") +
      ui.check("createContact", "Create the contact on the client", true)
    ) + (dup.any ? ui.alert("Matched existing records: " + dupSummary(dup) + ". Pick a client above to attach the opportunity, or leave blank to create a new one.", "info") : "");
    const modal = ui.modal({
      title: "Convert lead — " + lead.name, size: "lg", body: body,
      foot: ui.btn("Cancel", { small: true, act: "cl-cancel" }) + " " + ui.btn("Convert", { small: true, primary: true, act: "cl-go" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=cl-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=cl-go]").onclick = async (btn) => {
      const v = ui.collect(form, ["companyId", "stage", "value", "ownerId", "expectedClose", "createContact"]);
      btn.disabled = true;
      const r = await S.convertLead(pid, lead.id, {
        companyId: v.companyId === "" ? null : v.companyId,
        stage: v.stage, value: v.value, ownerId: v.ownerId === "" ? null : v.ownerId,
        expectedClose: v.expectedClose, createContact: !!v.createContact,
      });
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal();
      ERP.toast("Lead converted → " + r.company.name + " / " + (r.opportunity.number || r.opportunity.name) + ".", "success");
      refresh();
    };
  }
})();
