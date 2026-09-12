/* ============================================================
   PSA-U — agreements, coverage, billing, profitability & renewals
   (Phase 5 · Tasks 23–27)

   A managed-services agreement is the recurring contract under
   which a client buys service. This engine owns the whole life of
   that contract:

     • agreement    — the commercial record: type (managed /
                      per-device / per-user / block-of-hours /
                      one-off), term, billing cycle, automatic
                      renewal, price escalation, status and the
                      services it covers (Task 23).
     • coverage     — the tracked lines that state exactly what the
                      agreement covers: configurations, services or
                      users, each with a quantity, a unit price and
                      effective dates, so a mid-term add or
                      cancellation prorates correctly and a covered
                      device missing from the configuration records
                      is flagged (Task 24).
     • billing      — the recurring charge derived from base +
                      per-unit coverage + minimum + overage above
                      included hours + escalation + proration, shown
                      as a preview with every input exposed before it
                      posts, then posted idempotently to the
                      agreement-charge ledger Phase 6 assembles into
                      invoices (Task 25).
     • profitability— revenue against the burdened cost of
                      servicing it (labour at member hourly cost,
                      parts and third-party expenses), margin per
                      agreement and per client, included hours
                      consumed vs remaining, and overage or
                      unprofitable agreements (Task 26).
     • lifecycle    — the renewal queue (lead time, auto-renew vs
                      explicit renewal), renewal/upsell actions and
                      an archive of expired/terminated agreements
                      that keeps prior coverage intact for reporting
                      (Task 27).

   Storage: an agreement and its coverage live in the CLIENT
   COMPANY's document (kind "agreement"), which is also where the
   Phase 4 rate resolver looks for the agreement override rung —
   so the moment an agreement is active its rate rules apply.
   Posted charges live beside it (kind "agreementCharge") so Phase 6
   assembles each client's invoice from one document.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const A = (ERP.agreements = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("agreements requires the tenancy service");
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
  function round6(v) { return Math.round(num(v) * 1000000) / 1000000; }
  function fmtDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseDay(s) { const d = new Date(String(s) + "T12:00:00"); return isNaN(d.getTime()) ? null : d; }
  function monthStart(dateStr) { const d = parseDay(dateStr || ui.today()) || new Date(); d.setDate(1); return fmtDate(d); }

  A.addMonths = function (dateStr, n) {
    const d = parseDay(dateStr);
    if (!d) return dateStr || "";
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + Number(n || 0));
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return fmtDate(d);
  };

  function monthsBetween(a, b) {
    const da = parseDay(a), db = parseDay(b);
    if (!da || !db) return 0;
    return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth()) - (db.getDate() < da.getDate() ? 1 : 0);
  }
  A.monthsBetween = monthsBetween;

  async function putCompany(companyId, rec) {
    if (rec.id == null || rec.id === "" || !isFinite(rec.id)) rec.id = ten().nextId(await ten().records("company", companyId));
    rec.companyId = companyId;
    return ten().upsert("company", companyId, rec);
  }

  async function currencyFor(companyId) {
    try { const c = await ERP.companies.get(companyId); if (c && c.currency) return c.currency; } catch (e) {}
    try { const p = await ten().provider(); if (p && p.currency) return p.currency; } catch (e) {}
    return "";
  }

  /* ─────────────────────────── constants ─────────────────────────── */

  A.STATUSES = [
    { id: "draft", label: "Draft", tone: "muted" },
    { id: "active", label: "Active", tone: "success" },
    { id: "suspended", label: "Suspended", tone: "warn" },
    { id: "expired", label: "Expired", tone: "muted" },
    { id: "terminated", label: "Terminated", tone: "danger" },
    { id: "cancelled", label: "Cancelled", tone: "danger" },
  ];
  A.statusLabel = (id) => (A.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  A.statusTone = (id) => (A.STATUSES.find((s) => s.id === id) || {}).tone || "muted";
  A.ACTIVE_STATUSES = ["active", "suspended"];
  A.ARCHIVE_STATUSES = ["expired", "terminated", "cancelled"];

  A.CYCLES = [
    { id: "monthly", label: "Monthly", months: 1 },
    { id: "quarterly", label: "Quarterly", months: 3 },
    { id: "semiannual", label: "Semi-annual", months: 6 },
    { id: "annual", label: "Annual", months: 12 },
    { id: "one-off", label: "One-off", months: 0 },
  ];
  A.cycleMonths = (id) => { const c = A.CYCLES.find((x) => x.id === id); return c ? c.months : 1; };
  A.cycleLabel = (id) => (A.CYCLES.find((x) => x.id === id) || {}).label || id || "—";

  A.PRICING_MODELS = [
    { id: "flat", label: "Flat recurring fee" },
    { id: "per-unit", label: "Per-unit (device / user / service)" },
    { id: "block-hours", label: "Block of hours (with overage)" },
    { id: "one-off", label: "One-off" },
  ];
  A.pricingLabel = (id) => (A.PRICING_MODELS.find((x) => x.id === id) || {}).label || id || "—";

  A.COVERAGE_TYPES = [
    { id: "configuration", label: "Configuration / device" },
    { id: "service", label: "Service" },
    { id: "user", label: "User" },
  ];
  A.coverageTypeLabel = (id) => (A.COVERAGE_TYPES.find((x) => x.id === id) || {}).label || id || "—";

  /* ─────────────────────────── record model ─────────────────────────── */

  A.newEscalation = (over) => Object.assign({ enabled: false, percent: 0, everyMonths: 12, lastAppliedAt: null }, over || {});

  A.newAgreement = (over) => Object.assign({
    kind: "agreement", id: null, companyId: null, providerId: null, number: "",
    name: "", type: "managed", status: "draft",
    startDate: "", termMonths: 12, endDate: "", autoRenew: true, renewalTermMonths: 12, noticeDays: 30,
    billingCycle: "monthly", billingDay: 1, currency: "",
    pricingModel: "flat", baseAmount: 0, includedHours: 0, overageRate: 0, minimumAmount: 0, proration: true,
    escalation: null, serviceCodes: [], coverage: [], renewals: [],
    activatedAt: null, suspendedAt: null, expiredAt: null, terminatedAt: null, terminatedReason: "",
    notes: "", createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  A.newCoverage = (over) => Object.assign({
    id: null, type: "configuration", refId: "", name: "", quantity: 1, unitPrice: 0,
    included: true, effectiveFrom: "", effectiveTo: "", status: "active", cancelledAt: null, note: "",
  }, over || {});

  function nextCoverageId(coverage) {
    let max = 0;
    (coverage || []).forEach((l) => { if (isFinite(l.id)) max = Math.max(max, Number(l.id)); });
    return max + 1;
  }

  /* ─────────────────────────── reads ─────────────────────────── */

  async function companyEntries(pid, companyId) {
    try { return await ten().records("company", companyId, "agreement"); } catch (e) { return []; }
  }

  A.all = async function (companyId) { return companyEntries(null, companyId); };

  A.list = async function (pid, query) {
    query = query || {};
    const entries = await ERP.companies.list();
    const out = [];
    for (const e of entries) {
      if (query.companyId != null && query.companyId !== "" && String(e.id) !== String(query.companyId)) continue;
      const recs = await companyEntries(pid, e.id);
      for (const a of recs) {
        if (query.status && String(a.status) !== String(query.status)) continue;
        if (query.statusIn && query.statusIn.map(String).indexOf(String(a.status)) === -1) continue;
        if (query.type && String(a.type) !== String(query.type)) continue;
        out.push(Object.assign({}, a, { __companyName: e.name }));
      }
    }
    out.sort((a, b) => String(a.__companyName || "").localeCompare(String(b.__companyName || "")) || String(a.name || "").localeCompare(String(b.name || "")));
    return out;
  };

  A.get = async function (companyId, id) {
    if (companyId == null || id == null) return null;
    return (await companyEntries(null, companyId)).find((a) => String(a.id) === String(id)) || null;
  };

  A.locate = async function (pid, agreementId) {
    const entries = await ERP.companies.list();
    for (const e of entries) {
      const recs = await companyEntries(pid, e.id);
      const a = recs.find((x) => String(x.id) === String(agreementId));
      if (a) return { agreement: a, companyId: e.id, company: await ERP.companies.get(e.id) };
    }
    return null;
  };

  A.forCompany = function (companyId) { return companyEntries(null, companyId); };

  A.activeForCompany = async function (companyId) {
    return (await companyEntries(null, companyId)).filter((a) => A.ACTIVE_STATUSES.indexOf(String(a.status)) !== -1);
  };

  A.nextNumber = async function (pid) {
    let max = 0;
    const entries = await ERP.companies.list();
    for (const e of entries) {
      for (const a of await companyEntries(pid, e.id)) {
        const m = /(\d+)\s*$/.exec(String(a.number || ""));
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return "AGR-" + String(max + 1).padStart(4, "0");
  };

  /* ─────────────────────────── writes ─────────────────────────── */

  A.save = async function (pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("agreements.edit", { companyId: rec && rec.companyId })) return { error: "forbidden" };
    const companyId = rec && rec.companyId;
    if (companyId == null || companyId === "") return { error: "company_required", message: "Choose the client this agreement is with." };
    const existing = rec && rec.id != null ? await A.get(companyId, rec.id) : null;
    const a = Object.assign(A.newAgreement(), existing || {}, rec);
    if (!String(a.name || "").trim()) return { error: "name_required", message: "Give the agreement a name." };
    a.name = String(a.name).trim();
    a.type = a.type || "managed";
    a.status = a.status || "draft";
    if (!a.startDate) a.startDate = ui.today();
    a.termMonths = num(a.termMonths);
    a.renewalTermMonths = num(a.renewalTermMonths, a.termMonths || 12);
    a.billingDay = Math.min(28, Math.max(1, num(a.billingDay, 1)));
    a.billingCycle = a.billingCycle || "monthly";
    a.pricingModel = a.pricingModel || "flat";
    a.baseAmount = num(a.baseAmount);
    a.includedHours = num(a.includedHours);
    a.overageRate = num(a.overageRate);
    a.minimumAmount = num(a.minimumAmount);
    a.escalation = A.newEscalation(a.escalation);
    a.serviceCodes = (Array.isArray(a.serviceCodes) ? a.serviceCodes : String(a.serviceCodes || "").split(",")).map((s) => String(s).trim()).filter(Boolean);
    a.coverage = Array.isArray(a.coverage) ? a.coverage : [];
    a.renewals = Array.isArray(a.renewals) ? a.renewals : [];
    a.endDate = a.termMonths > 0 ? ui.addDays(A.addMonths(a.startDate, a.termMonths), -1) : (a.endDate || "");
    if (!existing) {
      a.number = await A.nextNumber(pid);
      a.status = "draft";
      a.createdAt = nowIso();
      a.createdBy = a.createdBy != null ? a.createdBy : actor().memberId || null;
    }
    a.providerId = pid;
    a.updatedAt = nowIso();
    await putCompany(companyId, a);
    return { record: a, created: !existing };
  };

  A.remove = async function (pid, companyId, id) {
    if (!ERP.security.enforce("agreements.edit")) return { error: "forbidden" };
    const a = await A.get(companyId, id);
    if (!a) return { error: "not_found" };
    const posted = (await A.charges(companyId, {})).some((c) => String(c.agreementId) === String(id));
    if (posted) return { error: "has_charges", message: "This agreement has posted charges; terminate it instead of deleting it." };
    await ten().remove("company", companyId, (r) => r.kind === "agreement" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* ─────────────────────────── coverage (Task 24) ─────────────────────────── */

  A.addCoverage = async function (pid, companyId, agreementId, line) {
    if (!ERP.security.enforce("agreements.edit", { companyId })) return { error: "forbidden" };
    const a = await A.get(companyId, agreementId);
    if (!a) return { error: "not_found" };
    const coverage = (a.coverage || []).slice();
    const rec = A.newCoverage(Object.assign({}, line, {
      id: nextCoverageId(coverage),
      effectiveFrom: line.effectiveFrom || ui.today(),
      status: "active", cancelledAt: null,
    }));
    rec.quantity = num(rec.quantity, 1) || 1;
    rec.unitPrice = num(rec.unitPrice);
    coverage.push(rec);
    const updated = Object.assign({}, a, { coverage: coverage, updatedAt: nowIso() });
    await putCompany(companyId, updated);
    return { record: rec, agreement: updated };
  };

  A.updateCoverage = async function (pid, companyId, agreementId, lineId, patch) {
    if (!ERP.security.enforce("agreements.edit", { companyId })) return { error: "forbidden" };
    const a = await A.get(companyId, agreementId);
    if (!a) return { error: "not_found" };
    const coverage = (a.coverage || []).slice();
    const i = coverage.findIndex((l) => String(l.id) === String(lineId));
    if (i < 0) return { error: "not_found" };
    coverage[i] = Object.assign({}, coverage[i], patch);
    coverage[i].quantity = num(coverage[i].quantity, 1) || 1;
    coverage[i].unitPrice = num(coverage[i].unitPrice);
    const updated = Object.assign({}, a, { coverage: coverage, updatedAt: nowIso() });
    await putCompany(companyId, updated);
    return { record: coverage[i], agreement: updated };
  };

  A.cancelCoverage = async function (pid, companyId, agreementId, lineId, endDate, note) {
    if (!ERP.security.enforce("agreements.edit", { companyId })) return { error: "forbidden" };
    const a = await A.get(companyId, agreementId);
    if (!a) return { error: "not_found" };
    const coverage = (a.coverage || []).slice();
    const i = coverage.findIndex((l) => String(l.id) === String(lineId));
    if (i < 0) return { error: "not_found" };
    const effectiveTo = endDate || ui.today();
    coverage[i] = Object.assign({}, coverage[i], {
      effectiveTo: effectiveTo, status: "cancelled", cancelledAt: nowIso(), note: note || coverage[i].note || "",
    });
    const updated = Object.assign({}, a, { coverage: coverage, updatedAt: nowIso() });
    await putCompany(companyId, updated);
    return { record: coverage[i], agreement: updated };
  };

  A.removeCoverage = async function (pid, companyId, agreementId, lineId) {
    if (!ERP.security.enforce("agreements.edit", { companyId })) return { error: "forbidden" };
    const a = await A.get(companyId, agreementId);
    if (!a) return { error: "not_found" };
    const coverage = (a.coverage || []).filter((l) => String(l.id) !== String(lineId));
    const updated = Object.assign({}, a, { coverage: coverage, updatedAt: nowIso() });
    await putCompany(companyId, updated);
    return { ok: true, agreement: updated };
  };

  /* A coverage line is billable within a period when its effective window
     overlaps it. Cancelled lines keep their expiry so history stays intact. */
  A.activeCoverage = function (agreement, asOf) {
    const day = asOf || ui.today();
    return (agreement.coverage || []).filter((l) => {
      if (l.effectiveFrom && l.effectiveFrom > day) return false;
      if (l.effectiveTo && l.effectiveTo < day) return false;
      return true;
    });
  };

  A.coverageUnits = function (agreement, asOf) {
    return A.activeCoverage(agreement, asOf).reduce((n, l) => n + num(l.quantity, 1), 0);
  };

  A.coverageValue = function (agreement, asOf) {
    return round2(A.activeCoverage(agreement, asOf).reduce((n, l) => n + num(l.unitPrice) * (num(l.quantity, 1) || 1), 0));
  };

  /* Warn when a covered configuration no longer exists in the client's
     configuration records (Task 24). The records are owned by
     ERP.configurations (Phase 10 · Task 47); a covered device with no
     matching record reports as uncatalogued so it can be added. */
  A.coverageWarnings = async function (companyId, agreement) {
    let configs = [];
    try { configs = await ten().records("company", companyId, "configuration"); } catch (e) {}
    const ids = configs.map((c) => String(c.id));
    const missing = [];
    for (const l of agreement.coverage || []) {
      if (l.type !== "configuration" || l.status === "cancelled") continue;
      const ref = l.refId == null ? "" : String(l.refId);
      if (!ref) continue;
      if (ids.indexOf(ref) === -1) missing.push({ lineId: l.id, refId: ref, name: l.name || ref });
    }
    return { missing: missing, configurationCount: configs.length };
  };

  /* ─────────────────────────── billing periods (Task 25) ─────────────────────────── */

  A.periodFor = function (agreement, asOf) {
    const day = asOf || ui.today();
    const cycle = A.cycleMonths(agreement.billingCycle);
    const anchor = agreement.startDate || monthStart(day);
    if (cycle === 0) {
      return { key: "one-off:" + anchor, start: anchor, end: anchor, days: 1, cycleMonths: 0 };
    }
    let start = anchor;
    if (start <= day) {
      let guard = 0;
      while (A.addMonths(start, cycle) <= day && guard < 1200) { start = A.addMonths(start, cycle); guard++; }
    }
    const end = ui.addDays(A.addMonths(start, cycle), -1);
    return { key: start, start: start, end: end, days: ui.diffDays(start, end) + 1, cycleMonths: cycle };
  };

  A.prorationFactor = function (from, to, period) {
    const s = from || period.start;
    const e = to || period.end;
    const start = s > period.start ? s : period.start;
    const end = e < period.end ? e : period.end;
    const totalDays = period.days || (ui.diffDays(period.start, period.end) + 1);
    if (!start || !end || start > end) return { days: 0, totalDays: totalDays, factor: 0 };
    const days = ui.diffDays(start, end) + 1;
    return { days: days, totalDays: totalDays, factor: round6(Math.max(0, Math.min(1, days / totalDays))) };
  };

  A.escalationFactor = function (agreement, periodStart) {
    const esc = agreement.escalation || {};
    if (esc.enabled !== true || num(esc.percent) <= 0) return { factor: 1, steps: 0, percent: 0 };
    const every = num(esc.everyMonths, 12) || 12;
    const start = agreement.startDate || periodStart;
    if (!start || start >= periodStart) return { factor: 1, steps: 0, percent: num(esc.percent) };
    const steps = Math.max(0, Math.floor(monthsBetween(start, periodStart) / every));
    return { factor: round6(Math.pow(1 + num(esc.percent) / 100, steps)), steps: steps, percent: num(esc.percent) };
  };

  A.consumedMinutes = async function (pid, agreement, period) {
    const entries = await ERP.time.entries(pid, { companyId: agreement.companyId, fromDate: period.start, toDate: period.end });
    const codes = (agreement.serviceCodes || []).map(String);
    const sel = codes.length ? entries.filter((e) => codes.indexOf(String(e.workType)) !== -1) : entries;
    return sel.reduce((n, e) => n + num(e.minutes), 0);
  };

  /* Derive the charge for one period from the agreement's inputs. Pure with
     respect to storage — it may read time entries for the included-hours
     overage, but writes nothing. Returns every line and every input so the
     preview UI (and an invoice) can explain the number. */
  A.deriveCharge = async function (pid, agreement, period, opts) {
    opts = opts || {};
    period = period || A.periodFor(agreement, opts.asOf || ui.today());
    const currency = agreement.currency || opts.currency || (agreement.companyId != null ? await currencyFor(agreement.companyId) : "");
    const lines = [];
    const model = agreement.pricingModel || "flat";
    const termStart = agreement.startDate || period.start;
    const termEnd = agreement.endDate || period.end;
    const termPror = A.prorationFactor(termStart, termEnd, period);

    let baseAndUnit = 0;

    if (model !== "per-unit" && num(agreement.baseAmount) > 0) {
      const factor = agreement.proration === false ? 1 : termPror.factor;
      const amount = round2(num(agreement.baseAmount) * factor);
      if (amount > 0) {
        lines.push({ kind: "base", label: "Base " + A.cycleLabel(agreement.billingCycle).toLowerCase() + " fee", qty: factor, unitPrice: num(agreement.baseAmount), amount: amount, prorated: factor < 1 });
        baseAndUnit += amount;
      }
    }

    for (const line of agreement.coverage || []) {
      const up = num(line.unitPrice);
      if (up <= 0) continue;
      const from = line.effectiveFrom || termStart;
      const to = line.effectiveTo || termEnd;
      const f = agreement.proration === false ? { days: 1, factor: 1 } : A.prorationFactor(from, to, period);
      if (f.days <= 0) continue;
      const qty = (num(line.quantity, 1) || 1) * f.factor;
      const amount = round2(up * qty);
      if (amount <= 0) continue;
      lines.push({
        kind: "unit",
        label: A.coverageTypeLabel(line.type) + ": " + (line.name || line.refId || "item"),
        qty: round6(qty), unitPrice: up, amount: amount, prorated: f.factor < 1,
      });
      baseAndUnit += amount;
    }

    let subtotal = round2(baseAndUnit);

    const esc = A.escalationFactor(agreement, period.start);
    if (esc.factor > 1 && subtotal > 0) {
      const amount = round2(subtotal * (esc.factor - 1));
      if (amount > 0) {
        lines.push({ kind: "escalation", label: "Price escalation (+" + esc.percent + "% × " + esc.steps + ")", qty: esc.steps, unitPrice: esc.percent, amount: amount });
        subtotal = round2(subtotal + amount);
      }
    }
    const contractSubtotal = subtotal;

    let minimumAdjusted = 0;
    if (num(agreement.minimumAmount) > subtotal) {
      minimumAdjusted = round2(num(agreement.minimumAmount) - subtotal);
      if (minimumAdjusted > 0) {
        lines.push({ kind: "minimum", label: "Minimum commitment adjustment", qty: 1, unitPrice: minimumAdjusted, amount: minimumAdjusted });
        subtotal = num(agreement.minimumAmount);
      }
    }

    const includedHours = num(agreement.includedHours);
    let consumedMinutes = opts.consumedMinutes != null ? num(opts.consumedMinutes) : null;
    if (consumedMinutes == null && includedHours > 0) {
      try { consumedMinutes = await A.consumedMinutes(pid, agreement, period); } catch (e) { consumedMinutes = 0; }
    }
    const consumedHours = consumedMinutes == null ? null : round2(consumedMinutes / 60);
    let overageHours = 0, overageAmount = 0;
    if (includedHours > 0 && consumedHours != null) {
      overageHours = round2(Math.max(0, consumedHours - includedHours));
      if (overageHours > 0 && num(agreement.overageRate) > 0) {
        overageAmount = round2(overageHours * num(agreement.overageRate));
        lines.push({ kind: "overage", label: "Overage (" + overageHours + "h beyond " + includedHours + "h included)", qty: overageHours, unitPrice: num(agreement.overageRate), amount: overageAmount });
      }
    }

    const total = round2(subtotal + overageAmount);

    const inputs = [
      { label: "Billing period", value: period.start + " → " + period.end + " (" + period.days + " days)" },
      { label: "Cycle", value: A.cycleLabel(agreement.billingCycle) + " · " + A.pricingLabel(model) },
      { label: "Base fee", value: ui.money(num(agreement.baseAmount), currency) },
      { label: "Covered units", value: String(A.coverageUnits(agreement, period.end)) + " · " + ui.money(A.coverageValue(agreement, period.end), currency) + "/cycle" },
      { label: "Minimum", value: ui.money(num(agreement.minimumAmount), currency) },
      { label: "Escalation", value: esc.factor > 1 ? "+" + esc.percent + "% × " + esc.steps + " → ×" + esc.factor : "none" },
    ];
    if (includedHours > 0) {
      inputs.push({ label: "Included hours", value: includedHours + "h · consumed " + (consumedHours == null ? "—" : consumedHours + "h") + " · overage " + overageHours + "h" });
      inputs.push({ label: "Overage rate", value: ui.money(num(agreement.overageRate), currency) + "/h" });
    }
    if (agreement.endDate) inputs.push({ label: "Term", value: agreement.startDate + " → " + agreement.endDate });

    return {
      agreementId: agreement.id, agreementName: agreement.name, companyId: agreement.companyId,
      currency: currency, period: period, lines: lines, inputs: inputs,
      subtotal: round2(contractSubtotal), minimumAdjusted: minimumAdjusted,
      escalation: esc.factor > 1 ? esc : null,
      overageHours: overageHours, overageAmount: overageAmount,
      includedHours: includedHours, consumedHours: consumedHours,
      total: total,
    };
  };

  A.previewCharge = async function (pid, companyId, agreementId, opts) {
    const a = await A.get(companyId, agreementId);
    if (!a) return { error: "not_found" };
    const period = A.periodFor(a, (opts && opts.asOf) || ui.today());
    return A.deriveCharge(pid, a, period, opts);
  };

  /* ─────────────────────────── posted charges ─────────────────────────── */

  A.charges = async function (companyId, query) {
    query = query || {};
    let list = [];
    try { list = await ten().records("company", companyId, "agreementCharge"); } catch (e) { list = []; }
    if (query.agreementId != null) list = list.filter((c) => String(c.agreementId) === String(query.agreementId));
    if (query.status) list = list.filter((c) => String(c.status) === String(query.status));
    if (query.from) list = list.filter((c) => String(c.periodStart) >= String(query.from));
    if (query.to) list = list.filter((c) => String(c.periodStart) <= String(query.to));
    return list.slice().sort((a, b) => String(b.periodStart || "").localeCompare(String(a.periodStart || "")) || (Number(b.id) - Number(a.id)));
  };

  A.allCharges = async function (pid, query) {
    query = query || {};
    const entries = await ERP.companies.list();
    const out = [];
    for (const e of entries) {
      if (query.companyId != null && query.companyId !== "" && String(e.id) !== String(query.companyId)) continue;
      for (const c of await A.charges(e.id, query)) out.push(Object.assign({}, c, { __companyName: e.name }));
    }
    return out;
  };

  /* Billing lock (Phase 6): stamp (or release) the invoice a posted charge was
     billed on, so a second billing run cannot invoice it again. Writes the
     company document directly — only billing may do this once posted. */
  A.markChargesInvoiced = async function (companyId, chargeIds, invoiceId) {
    const set = (chargeIds || []).map(String);
    if (!set.length) return { count: 0 };
    const list = await ten().records("company", companyId);
    let count = 0;
    const updated = list.map((r) => {
      if (r.kind !== "agreementCharge" || set.indexOf(String(r.id)) === -1) return r;
      count += 1;
      return Object.assign({}, r, { billedInvoiceId: invoiceId == null ? null : invoiceId, billedAt: invoiceId == null ? null : nowIso(), updatedAt: nowIso() });
    });
    if (count) await ten().save("company", companyId, updated);
    return { count: count };
  };

  A.unbilledCharges = async function (companyId) {
    return (await A.charges(companyId, {})).filter((c) => c.status === "posted" && c.billedInvoiceId == null);
  };

  A.postCharge = async function (pid, agreementId, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("agreements.bill")) return { error: "forbidden" };
    const loc = await A.locate(pid, agreementId);
    if (!loc) return { error: "not_found" };
    const a = loc.agreement;
    if (A.ARCHIVE_STATUSES.indexOf(String(a.status)) !== -1 && !opts.allowArchived) return { error: "archived", message: "This agreement is " + A.statusLabel(a.status).toLowerCase() + "." };
    const period = A.periodFor(a, opts.asOf || ui.today());
    const existing = (await A.charges(loc.companyId, {})).find((c) => String(c.agreementId) === String(a.id) && c.periodKey === period.key && c.status !== "void");
    if (existing && !opts.replace) return { error: "already_posted", charge: existing };
    if (existing && opts.replace) {
      await ten().remove("company", loc.companyId, (r) => r.kind === "agreementCharge" && String(r.id) === String(existing.id));
    }
    const derived = await A.deriveCharge(pid, a, period, opts);
    if (derived.total <= 0) return { error: "nothing_to_bill", derived: derived };
    const rec = {
      kind: "agreementCharge", id: null, providerId: pid, companyId: loc.companyId,
      agreementId: a.id, agreementNumber: a.number, agreementName: a.name,
      periodKey: period.key, periodStart: period.start, periodEnd: period.end, currency: derived.currency,
      lines: derived.lines, inputs: derived.inputs, subtotal: derived.subtotal, total: derived.total,
      status: "posted", postedAt: nowIso(), postedBy: actorName(), billedInvoiceId: null,
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    await putCompany(loc.companyId, rec);
    await emit(pid, "agreement.charge_posted", a, { charge: rec, company: loc.company });
    return { record: rec, derived: derived };
  };

  A.voidCharge = async function (pid, companyId, chargeId, reason) {
    if (!ERP.security.enforce("agreements.bill")) return { error: "forbidden" };
    const list = await A.charges(companyId, {});
    const c = list.find((x) => String(x.id) === String(chargeId));
    if (!c) return { error: "not_found" };
    if (c.billedInvoiceId != null) return { error: "invoiced", message: "This charge has been invoiced; raise a credit instead." };
    const rec = Object.assign({}, c, { status: "void", voidReason: reason || "", voidedAt: nowIso(), voidedBy: actorName(), updatedAt: nowIso() });
    await putCompany(companyId, rec);
    return { record: rec };
  };

  /* Run billing across every active agreement for the current period. This is
     the seam Phase 6 calls: it posts the agreement recurring charges and
     returns what it did, so invoicing can assemble them. */
  A.generateDue = async function (pid, opts) {
    opts = opts || {};
    const asOf = opts.asOf || ui.today();
    const entries = await ERP.companies.list();
    const posted = [], skipped = [], errors = [];
    for (const e of entries) {
      if (opts.companyId != null && opts.companyId !== "" && String(e.id) !== String(opts.companyId)) continue;
      for (const a of await companyEntries(pid, e.id)) {
        if (a.status !== "active") continue;
        const period = A.periodFor(a, asOf);
        const existing = (await A.charges(e.id, {})).find((c) => String(c.agreementId) === String(a.id) && c.periodKey === period.key && c.status !== "void");
        if (existing) { skipped.push({ agreementId: a.id, number: a.number, periodKey: period.key }); continue; }
        const res = await A.postCharge(pid, a.id, { asOf: asOf, replace: false });
        if (res.error === "nothing_to_bill") { skipped.push({ agreementId: a.id, number: a.number, periodKey: period.key, reason: "nothing_to_bill" }); continue; }
        if (res.error) errors.push({ agreementId: a.id, number: a.number, error: res.error });
        else posted.push(res.record);
      }
    }
    return { asOf: asOf, posted: posted, skipped: skipped, errors: errors };
  };

  /* ─────────────────────────── profitability (Task 26) ─────────────────────────── */

  async function companyCost(pid, companyId, from, to) {
    const [entries, expenses, members] = await Promise.all([
      ERP.time.entries(pid, { companyId: companyId, fromDate: from, toDate: to }),
      ERP.expenses.list(pid, { companyId: companyId, fromDate: from, toDate: to }),
      ERP.members.members(),
    ]);
    const costOf = {};
    members.forEach((m) => { costOf[String(m.id)] = num(m.hourlyCost); });
    const perEntry = entries.map((e) => ({ entry: e, cost: round2((num(e.minutes) / 60) * (costOf[String(e.memberId)] || 0)) }));
    const laborMinutes = entries.reduce((n, e) => n + num(e.minutes), 0);
    const laborCost = round2(perEntry.reduce((n, x) => n + x.cost, 0));
    const expenseCost = round2(expenses.reduce((n, x) => n + num(x.amount), 0));
    return { entries: perEntry, laborMinutes: laborMinutes, laborCost: laborCost, expenseCost: expenseCost };
  }

  A.profitability = async function (pid, opts) {
    opts = opts || {};
    const from = opts.from || monthStart(ui.today());
    const to = opts.to || ui.today();
    let agreements = await A.list(pid, { companyId: opts.companyId });
    if (opts.agreementId != null) agreements = agreements.filter((a) => String(a.id) === String(opts.agreementId));
    const charges = (await A.allCharges(pid, { from: from, to: to, companyId: opts.companyId })).filter((c) => c.status !== "void");

    const byCompany = {};
    agreements.forEach((a) => { (byCompany[a.companyId] = byCompany[a.companyId] || []).push(a); });

    const rows = [];
    const nameOf = {};
    for (const companyId of Object.keys(byCompany)) {
      const list = byCompany[companyId];
      const cost = await companyCost(pid, companyId, from, to);
      const revenueBy = {};
      list.forEach((a) => { revenueBy[String(a.id)] = 0; });
      charges.forEach((c) => {
        if (list.some((a) => String(a.id) === String(c.agreementId))) revenueBy[String(c.agreementId)] += num(c.total);
      });
      const totalRevenue = Object.keys(revenueBy).reduce((n, k) => n + revenueBy[k], 0);

      for (const a of list) {
        let revenue = round2(revenueBy[String(a.id)]);
        let estimated = false;
        if (revenue === 0 && opts.includeEstimate !== false) {
          const d = await A.deriveCharge(pid, a, A.periodFor(a, to), {});
          revenue = d.total;
          estimated = true;
        }
        const codes = (a.serviceCodes || []).map(String);
        let laborMinutes, laborCost, expenseCost, basis;
        if (codes.length) {
          const sel = cost.entries.filter((x) => codes.indexOf(String(x.entry.workType)) !== -1);
          laborMinutes = sel.reduce((n, x) => n + num(x.entry.minutes), 0);
          laborCost = round2(sel.reduce((n, x) => n + x.cost, 0));
          const share = totalRevenue > 0 ? revenue / totalRevenue : 1 / list.length;
          expenseCost = round2(cost.expenseCost * share);
          basis = "matched to covered services";
        } else if (list.length === 1) {
          laborMinutes = cost.laborMinutes;
          laborCost = cost.laborCost;
          expenseCost = cost.expenseCost;
          basis = "all work for this client";
        } else {
          const share = totalRevenue > 0 ? revenue / totalRevenue : 1 / list.length;
          laborMinutes = Math.round(cost.laborMinutes * share);
          laborCost = round2(cost.laborCost * share);
          expenseCost = round2(cost.expenseCost * share);
          basis = "pro-rata by revenue";
        }
        const costTotal = round2(laborCost + expenseCost);
        const margin = round2(revenue - costTotal);
        const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
        const includedHours = num(a.includedHours);
        const consumedHours = round2(laborMinutes / 60);
        const remainingHours = includedHours > 0 ? round2(Math.max(0, includedHours - consumedHours)) : 0;
        const overageHours = includedHours > 0 ? round2(Math.max(0, consumedHours - includedHours)) : 0;
        const flags = [];
        if (margin < 0) flags.push({ label: "Unprofitable", tone: "danger" });
        if (overageHours > 0) flags.push({ label: "Overage", tone: "warn" });
        if (includedHours > 0 && remainingHours <= includedHours * 0.15 && overageHours === 0) flags.push({ label: "Hours nearly used", tone: "warn" });
        if (a.status === "suspended") flags.push({ label: "Suspended", tone: "muted" });
        rows.push({
          agreementId: a.id, agreementName: a.name, agreementNumber: a.number, companyId: companyId,
          companyName: a.__companyName || nameOf[companyId] || companyId,
          type: a.type, status: a.status, currency: a.currency || "USD",
          revenue: revenue, estimated: estimated,
          laborMinutes: laborMinutes, laborHours: round2(laborMinutes / 60), laborCost: laborCost,
          expenseCost: expenseCost, costTotal: costTotal, margin: margin, marginPct: marginPct,
          includedHours: includedHours, consumedHours: consumedHours, remainingHours: remainingHours, overageHours: overageHours,
          basis: basis, flags: flags,
        });
      }
    }
    rows.sort((a, b) => a.margin - b.margin);

    const totals = rows.reduce((t, r) => {
      t.revenue += r.revenue; t.laborCost += r.laborCost; t.expenseCost += r.expenseCost;
      t.cost += r.costTotal; t.margin += r.margin; t.overageHours += r.overageHours;
      if (r.margin < 0) t.unprofitable += 1;
      return t;
    }, { revenue: 0, laborCost: 0, expenseCost: 0, cost: 0, margin: 0, overageHours: 0, unprofitable: 0 });
    Object.keys(totals).forEach((k) => { totals[k] = round2(totals[k]); });
    totals.marginPct = totals.revenue > 0 ? Math.round((totals.margin / totals.revenue) * 1000) / 10 : 0;

    return { from: from, to: to, rows: rows, totals: totals };
  };

  A.utilization = function (pid, opts) { return A.profitability(pid, opts); };

  /* ─────────────────────────── lifecycle & renewals (Task 27) ─────────────────────────── */

  async function emit(pid, event, agreement, extra) {
    if (!ERP.workflow) return;
    try {
      const company = agreement.companyId != null ? await ERP.companies.get(agreement.companyId) : null;
      await ERP.workflow.emit(event, Object.assign({ event: event, agreement: agreement, company: company, actor: actor() }, extra || {}));
    } catch (e) {}
  }
  A.emit = emit;

  A.setStatus = async function (pid, agreementId, status, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("agreements.edit")) return { error: "forbidden" };
    if (A.STATUSES.map((s) => s.id).indexOf(status) === -1) return { error: "bad_status" };
    if ((status === "terminated" || status === "cancelled") && !ERP.security.enforce("agreements.terminate")) return { error: "forbidden" };
    const loc = await A.locate(pid, agreementId);
    if (!loc) return { error: "not_found" };
    const a = loc.agreement;
    const now = nowIso();
    const rec = Object.assign({}, a, { status: status, updatedAt: now });
    if (status === "active") { rec.activatedAt = a.activatedAt || now; rec.suspendedAt = null; }
    if (status === "suspended") rec.suspendedAt = now;
    if (status === "expired") rec.expiredAt = now;
    if (status === "terminated" || status === "cancelled") {
      rec.terminatedAt = now;
      rec.terminatedReason = opts.reason || a.terminatedReason || "";
      const effectiveTo = opts.effectiveDate || ui.today();
      rec.coverage = (a.coverage || []).map((l) => {
        if (l.status === "cancelled") return l;
        if (!l.effectiveTo || l.effectiveTo > effectiveTo) return Object.assign({}, l, { effectiveTo: effectiveTo, status: "cancelled", cancelledAt: now });
        return l;
      });
    }
    await putCompany(loc.companyId, rec);
    const evt = status === "active" ? "agreement.activated" : status === "expired" ? "agreement.expired" : (status === "terminated" || status === "cancelled") ? "agreement.terminated" : null;
    if (evt && !opts.system) await emit(pid, evt, rec, { company: loc.company, reason: rec.terminatedReason });
    return { record: rec };
  };

  A.activate = (pid, id, opts) => A.setStatus(pid, id, "active", opts);
  A.suspend = (pid, id, opts) => A.setStatus(pid, id, "suspended", opts);
  A.resume = (pid, id, opts) => A.setStatus(pid, id, "active", opts);
  A.terminate = (pid, id, reason, opts) => A.setStatus(pid, id, "terminated", Object.assign({ reason: reason }, opts || {}));

  A.renew = async function (pid, agreementId, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("agreements.edit")) return { error: "forbidden" };
    const loc = await A.locate(pid, agreementId);
    if (!loc) return { error: "not_found" };
    const a = loc.agreement;
    const months = num(opts.months != null ? opts.months : a.renewalTermMonths, 12) || 12;
    const from = a.endDate || ui.today();
    let to = A.addMonths(from, months);
    if (opts.asOf) { let guard = 0; while (to < opts.asOf && guard < 120) { to = A.addMonths(to, months); guard++; } }
    const pct = num(opts.escalationPercent);
    const rec = Object.assign({}, a, { status: "active", endDate: to, suspendedAt: null, updatedAt: nowIso() });
    if (pct > 0) rec.baseAmount = round2(num(a.baseAmount) * (1 + pct / 100));
    rec.renewals = (a.renewals || []).concat([{
      at: nowIso(), by: actorName(), auto: !!opts.auto, months: months, from: from, to: to,
      escalationPercent: pct, note: opts.note || "",
    }]);
    await putCompany(loc.companyId, rec);
    await emit(pid, "agreement.renewed", rec, { company: loc.company, previous: a });
    return { record: rec };
  };

  A.renewalQueue = async function (pid, opts) {
    opts = opts || {};
    const asOf = opts.asOf || ui.today();
    const lead = opts.leadDays != null ? Number(opts.leadDays) : 60;
    const list = await A.list(pid, { companyId: opts.companyId });
    return list
      .filter((a) => a.status === "active" && a.endDate)
      .map((a) => ({ agreement: a, daysToExpiry: ui.diffDays(asOf, a.endDate) }))
      .filter((x) => x.daysToExpiry <= lead)
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  };

  A.archive = async function (pid, opts) {
    opts = opts || {};
    const list = await A.list(pid, { companyId: opts.companyId });
    return list.filter((a) => A.ARCHIVE_STATUSES.indexOf(String(a.status)) !== -1);
  };

  /* Expire or auto-renew everything past its end date, and report what is
     coming due. Non-auto-renewing agreements that pass their end date are
     archived as expired with their coverage intact. */
  A.runLifecycle = async function (pid, opts) {
    opts = opts || {};
    const asOf = opts.asOf || ui.today();
    const lead = opts.leadDays != null ? Number(opts.leadDays) : 60;
    const entries = await ERP.companies.list();
    const expired = [], renewed = [], due = [];
    for (const e of entries) {
      if (opts.companyId != null && opts.companyId !== "" && String(e.id) !== String(opts.companyId)) continue;
      for (const a of await companyEntries(pid, e.id)) {
        if (a.status !== "active") continue;
        const days = a.endDate ? ui.diffDays(asOf, a.endDate) : null;
        if (days == null) continue;
        if (days < 0) {
          if (a.autoRenew) {
            const r = await A.renew(pid, a.id, { asOf: asOf, system: true, auto: true, months: a.renewalTermMonths || a.termMonths || 12 });
            if (r && r.record) renewed.push(r.record);
          } else {
            const r = await A.setStatus(pid, a.id, "expired", { system: true });
            if (r && r.record) expired.push(r.record);
          }
        } else if (days <= lead) {
          due.push({ agreement: a, companyId: e.id, companyName: e.name, daysToExpiry: days });
        }
      }
    }
    due.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
    return { asOf: asOf, expired: expired, renewed: renewed, due: due };
  };

  A.ensureSeed = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    try { await ERP.taxonomy.ensureCategory(pid, "agreementType"); } catch (e) {}
    return { ok: true };
  };

  /* ═══════════════════════════ station ═══════════════════════════
     Five tabs: the agreement register; coverage & additions; billing
     with a live charge preview; profitability & utilisation; and the
     renewal / lifecycle queue. */

  function blankState() {
    return {
      tab: "agreements", companyId: "", status: "", agreementId: "",
      periodDate: ui.today(), from: monthStart(ui.today()), to: ui.today(),
    };
  }

  function maskedMoney(v, cur) { return ERP.security.canSeeFinancials() ? ui.money(v, cur) : "•••"; }

  async function clientOptions() { return ERP.companies.optionList(); }

  async function ensureSelection(pid, state) {
    const companies = await clientOptions();
    if ((!state.companyId || !companies.some((c) => String(c.value) === String(state.companyId))) && companies.length) state.companyId = companies[0].value;
    const ags = state.companyId ? await A.forCompany(state.companyId) : [];
    if (ags.length && !ags.some((a) => String(a.id) === String(state.agreementId))) state.agreementId = ags[0].id;
    if (!ags.length) state.agreementId = "";
    return { companies: companies, agreements: ags };
  }

  function agreementOptions(agreements) {
    return agreements.map((a) => ({ value: a.id, label: (a.number ? a.number + " · " : "") + a.name }));
  }

  /* ── agreements tab ── */

  async function renderAgreements(panel, pid) {
    const state = panel.__host.__agr;
    const companies = await clientOptions();
    const list = await A.list(pid, { companyId: state.companyId, status: state.status });
    const all = await A.list(pid, {});
    const active = all.filter((a) => a.status === "active");
    const canEdit = ERP.security.can("agreements.edit");
    const now = ui.today();
    const recurring = active.reduce((n, a) => n + num(a.baseAmount) + A.coverageValue(a, now), 0);
    const queue = await A.renewalQueue(pid, { leadDays: 60 });
    const units = active.reduce((n, a) => n + A.coverageUnits(a, now), 0);

    const rows = list.map((a) => {
      const acts = [];
      acts.push(ui.btn("Open", { small: true, act: "ag-open", arg: a.id }));
      if (canEdit && a.status === "draft") acts.push(ui.btn("Activate", { small: true, primary: true, act: "ag-activate", arg: a.id }));
      if (canEdit && a.status === "active") acts.push(ui.btn("Suspend", { small: true, act: "ag-suspend", arg: a.id }), ui.btn("Terminate", { small: true, danger: true, act: "ag-terminate", arg: a.id }));
      if (canEdit && a.status === "suspended") acts.push(ui.btn("Resume", { small: true, primary: true, act: "ag-resume", arg: a.id }));
      if (canEdit && A.ARCHIVE_STATUSES.indexOf(String(a.status)) === -1) acts.push(ui.btn("Edit", { small: true, act: "ag-edit", arg: a.id }));
      const term = a.startDate ? ui.esc(a.startDate) + " → " + ui.esc(a.endDate || "open") : "—";
      const value = ERP.security.canSeeFinancials()
        ? ui.esc(ui.money(num(a.baseAmount) + A.coverageValue(a, now), a.currency)) + '<span class="erp-sub">/' + ui.esc(A.cycleLabel(a.billingCycle).toLowerCase()) + "</span>"
        : "•••";
      return {
        number: ui.esc(a.number || "—"),
        name: ui.esc(a.name) + (a.autoRenew ? " " + ui.badge("auto-renew", "info") : ""),
        client: ui.esc(a.__companyName || ""),
        type: ui.esc(a.type),
        status: ui.badge(A.statusLabel(a.status), A.statusTone(a.status)),
        term: term,
        cycle: ui.esc(A.cycleLabel(a.billingCycle)),
        units: String(A.coverageUnits(a, now)),
        value: value,
        actions: acts.join(" "),
      };
    });

    panel.innerHTML =
      ui.summary([
        { label: "Active", value: String(active.length) },
        { label: "Recurring / cycle", value: maskedMoney(recurring) },
        { label: "Units covered", value: String(units) },
        { label: "Due ≤60 days", value: String(queue.length) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("ag-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.select("ag-status", "Status", [{ value: "", label: "Any status" }].concat(A.STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status) +
        '<span class="erp-db-hint">' + (canEdit ? "Preview the derived charge from the Billing tab" : "Read-only for your role") + "</span>" +
        (canEdit ? ui.btn("New agreement", { primary: true, act: "ag-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "number", label: "Number" },
        { key: "name", label: "Agreement" },
        { key: "client", label: "Client" },
        { key: "type", label: "Type" },
        { key: "status", label: "Status" },
        { key: "term", label: "Term" },
        { key: "cycle", label: "Cycle" },
        { key: "units", label: "Units", align: "right" },
        { key: "value", label: "Recurring", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No agreements yet — add the first recurring service contract." });

    const bind = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("agreements"); }); };
    bind('[name="ag-client"]', "companyId");
    bind('[name="ag-status"]', "status");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ag-new") return openAgreementModal(pid, null, () => renderTab("agreements"));
      if (act === "ag-edit" || act === "ag-open") return openAgreementModal(pid, await A.locate(pid, arg), () => renderTab("agreements"));
      if (act === "ag-activate") { const r = await A.activate(pid, arg); if (r.error) return ERP.toast(r.error, "error"); ERP.toast("Agreement activated.", "success"); return renderTab("agreements"); }
      if (act === "ag-suspend") { const r = await A.suspend(pid, arg); if (r.error) return ERP.toast(r.error, "error"); ERP.toast("Agreement suspended.", "success"); return renderTab("agreements"); }
      if (act === "ag-resume") { const r = await A.resume(pid, arg); if (r.error) return ERP.toast(r.error, "error"); ERP.toast("Agreement resumed.", "success"); return renderTab("agreements"); }
      if (act === "ag-terminate") return openTerminateModal(pid, arg, () => renderTab("agreements"));
    });
  }

  async function openAgreementModal(pid, located, refresh) {
    if (!ERP.security.enforce("agreements.edit", { companyId: located ? located.companyId : null })) return;
    const [companies, types] = await Promise.all([clientOptions(), ERP.taxonomy.list(pid, "agreementType")]);
    const editing = located && located.agreement && located.agreement.id != null;
    const a = (located && located.agreement) || A.newAgreement({ companyId: located ? located.companyId : (companies[0] ? companies[0].value : ""), startDate: ui.today() });
    const esc = a.escalation || {};
    const fields =
      '<div class="erp-form-row">' +
        ui.text("name", "Agreement name", a.name, "e.g. Acme managed services") +
        ui.select("companyId", "Client", companies, a.companyId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("type", "Agreement type", types.map((t) => ({ value: t.code, label: t.label })), a.type) +
        ui.select("status", "Status", A.STATUSES.map((s) => ({ value: s.id, label: s.label })), a.status) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("startDate", "Start date", a.startDate) +
        ui.number("termMonths", "Term (months, 0 = open)", a.termMonths, { min: 0, step: 1 }) +
        ui.number("renewalTermMonths", "Renewal term (months)", a.renewalTermMonths, { min: 1, step: 1 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("billingCycle", "Billing cycle", A.CYCLES.map((c) => ({ value: c.id, label: c.label })), a.billingCycle) +
        ui.number("billingDay", "Billing day", a.billingDay, { min: 1, step: 1 }) +
        ui.number("noticeDays", "Renewal notice (days)", a.noticeDays, { min: 0, step: 1 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("pricingModel", "Pricing model", A.PRICING_MODELS.map((m) => ({ value: m.id, label: m.label })), a.pricingModel) +
        ui.number("baseAmount", "Base amount / cycle", a.baseAmount, { min: 0, step: 0.01 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("includedHours", "Included hours / cycle", a.includedHours, { min: 0, step: 0.5 }) +
        ui.number("overageRate", "Overage rate / hour", a.overageRate, { min: 0, step: 0.01 }) +
        ui.number("minimumAmount", "Minimum amount / cycle", a.minimumAmount, { min: 0, step: 0.01 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.check("autoRenew", "Renew automatically", a.autoRenew !== false) +
        ui.check("proration", "Prorate mid-term adds & cancellations", a.proration !== false) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.check("escalationEnabled", "Apply price escalation", esc.enabled === true) +
        ui.number("escalationPercent", "Escalation (%)", esc.percent, { min: 0, step: 0.1 }) +
        ui.number("escalationMonths", "Escalate every (months)", esc.everyMonths == null ? 12 : esc.everyMonths, { min: 1, step: 1 }) +
      "</div>" +
      ui.text("serviceCodes", "Covered service codes (comma separated)", (a.serviceCodes || []).join(", "), "e.g. remote, onsite") +
      ui.textarea("notes", "Notes", a.notes || "", 2);
    const modal = ui.modal({
      title: editing ? "Edit agreement" : "New agreement",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "agm-cancel" }) + " " +
        (editing ? ui.btn("Delete", { small: true, danger: true, act: "agm-del" }) + " " : "") +
        ui.btn(editing ? "Save" : "Create agreement", { small: true, primary: true, act: "agm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=agm-cancel]").onclick = () => ui.closeModal();
    const delBtn = modal.querySelector("[data-act=agm-del]");
    if (delBtn) delBtn.onclick = async () => {
      if (!(await ui.confirm({ title: "Delete this agreement?", message: "Coverage and renewals will be removed with it.", danger: true, okLabel: "Delete" }))) return;
      const res = await A.remove(pid, a.companyId, a.id);
      if (res.error) { ERP.toast(res.message || res.error, "error"); return; }
      ui.closeModal(); ERP.toast("Agreement deleted.", "success"); refresh();
    };
    modal.querySelector("[data-act=agm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "companyId", "type", "status", "startDate", "termMonths", "renewalTermMonths", "billingCycle", "billingDay", "noticeDays", "pricingModel", "baseAmount", "includedHours", "overageRate", "minimumAmount", "autoRenew", "proration", "escalationEnabled", "escalationPercent", "escalationMonths", "serviceCodes", "notes"]);
      btn.disabled = true;
      const payload = Object.assign({}, a, {
        name: v.name, companyId: v.companyId, type: v.type, status: v.status,
        startDate: v.startDate, termMonths: v.termMonths, renewalTermMonths: v.renewalTermMonths,
        billingCycle: v.billingCycle, billingDay: v.billingDay, noticeDays: v.noticeDays,
        pricingModel: v.pricingModel, baseAmount: v.baseAmount, includedHours: v.includedHours,
        overageRate: v.overageRate, minimumAmount: v.minimumAmount,
        autoRenew: v.autoRenew !== false, proration: v.proration !== false,
        escalation: A.newEscalation({ enabled: v.escalationEnabled === true, percent: v.escalationPercent, everyMonths: v.escalationMonths }),
        serviceCodes: String(v.serviceCodes || "").split(",").map((s) => s.trim()).filter(Boolean),
        notes: v.notes,
      });
      if (editing) payload.id = a.id;
      const res = await A.save(pid, payload);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(editing ? "Agreement saved." : "Agreement created.", "success"); refresh();
    };
  }

  async function openTerminateModal(pid, agreementId, refresh) {
    const loc = await A.locate(pid, agreementId);
    if (!loc) return;
    const modal = ui.modal({
      title: "Terminate agreement",
      body: ui.form(ui.textarea("reason", "Reason", "", 3) + ui.dateInput("effectiveDate", "Coverage ends", ui.today())) +
        '<p class="erp-modal-note">Open coverage lines are closed as of the date you choose; the history is kept for reporting.</p>',
      foot: ui.btn("Keep it", { small: true, act: "tn-cancel" }) + " " + ui.btn("Terminate", { small: true, danger: true, act: "tn-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=tn-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=tn-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["reason", "effectiveDate"]);
      btn.disabled = true;
      const res = await A.terminate(pid, agreementId, v.reason, { effectiveDate: v.effectiveDate });
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Agreement terminated.", "success"); refresh();
    };
  }

  /* ── coverage tab ── */

  async function renderCoverage(panel, pid) {
    const state = panel.__host.__agr;
    const sel = await ensureSelection(pid, state);
    if (!state.companyId) { panel.innerHTML = ui.alert("Add a client and an agreement first.", "warn"); return; }
    const a = state.agreementId ? await A.get(state.companyId, state.agreementId) : null;
    const canEdit = ERP.security.can("agreements.edit");
    if (!a) {
      panel.innerHTML = ui.card("Coverage", ui.alert("This client has no agreements yet.", "info") +
        '<div class="erp-btn-row">' + (canEdit ? ui.btn("New agreement", { primary: true, act: "cv-new-agreement" }) : "") + "</div>");
      ui.bind(panel, "click", "[data-act]", () => openAgreementModal(pid, { agreement: null, companyId: state.companyId }, () => renderTab("coverage")));
      return;
    }
    const warns = await A.coverageWarnings(state.companyId, a);
    const period = A.periodFor(a, state.periodDate);
    const rows = (a.coverage || []).map((l) => {
      const f = A.prorationFactor(l.effectiveFrom || a.startDate, l.effectiveTo || "", period);
      const value = round2(num(l.unitPrice) * (num(l.quantity, 1) || 1));
      const acts = [];
      if (canEdit) {
        acts.push(ui.btn("Edit", { small: true, act: "cv-edit", arg: l.id }));
        if (l.status !== "cancelled") acts.push(ui.btn("End", { small: true, danger: true, act: "cv-cancel", arg: l.id }));
        else acts.push(ui.btn("Remove", { small: true, danger: true, act: "cv-remove", arg: l.id }));
      }
      return {
        type: ui.badge(A.coverageTypeLabel(l.type), "info"),
        item: ui.esc(l.name || l.refId || "—") + (l.refId ? '<span class="erp-sub">ref ' + ui.esc(l.refId) + "</span>" : ""),
        qty: ui.fmt(num(l.quantity, 1), 0),
        unit: maskedMoney(num(l.unitPrice), a.currency) + '<span class="erp-sub">/unit</span>',
        value: maskedMoney(value, a.currency),
        effective: ui.esc(l.effectiveFrom || a.startDate) + " → " + ui.esc(l.effectiveTo || "open"),
        thisPeriod: ui.esc(ui.money(round2(value * f.factor), a.currency)) + (f.factor < 1 ? ' <span class="erp-sub">' + ui.fmt(f.factor * 100, 0) + "%</span>" : ""),
        status: ui.badge(A.statusLabel(l.status === "cancelled" ? "cancelled" : "active"), l.status === "cancelled" ? "muted" : "success"),
        actions: acts.join(" "),
      };
    });

    panel.innerHTML =
      ui.alert("Coverage lines state exactly what this agreement covers. Mid-term adds and cancellations carry effective dates and are prorated into the next charge.", "info") +
      (warns.missing.length
        ? ui.alert(warns.missing.length + " covered device(s) are not in the client's configuration records: " + warns.missing.map((m) => m.name).join(", ") + (warns.configurationCount ? "" : " (no configuration records exist yet)."), "warn")
        : (warns.configurationCount ? ui.alert("Every covered device matches a configuration record.", "success") : "")) +
      '<div class="erp-db-toolbar">' +
        ui.select("cv-client", "Client", sel.companies, state.companyId) +
        ui.select("cv-agreement", "Agreement", agreementOptions(sel.agreements), state.agreementId) +
        '<span class="erp-db-hint">' + (canEdit ? "Additions & exclusions prorate from their effective date" : "Read-only for your role") + "</span>" +
        (canEdit ? ui.btn("Add coverage", { primary: true, act: "cv-add" }) : "") +
      "</div>" +
      ui.summary([
        { label: "Covered units", value: String(A.coverageUnits(a, state.periodDate)) },
        { label: "Unit value / cycle", value: maskedMoney(A.coverageValue(a, state.periodDate), a.currency) },
        { label: "Lines", value: String((a.coverage || []).length) },
        { label: "Missing devices", value: String(warns.missing.length) },
      ]) +
      ui.table([
        { key: "type", label: "Type" },
        { key: "item", label: "Covers" },
        { key: "qty", label: "Qty", align: "right" },
        { key: "unit", label: "Unit price", align: "right" },
        { key: "value", label: "Value", align: "right" },
        { key: "effective", label: "Effective" },
        { key: "thisPeriod", label: "Prorated (" + period.start + ")", align: "right" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No coverage defined. Add the devices, services or users this agreement covers." });

    const bind = (sel2, key) => { const el = panel.querySelector(sel2); if (el) el.addEventListener("change", () => { state[key] = el.value; if (key === "companyId") state.agreementId = ""; renderTab("coverage"); }); };
    bind('[name="cv-client"]', "companyId");
    bind('[name="cv-agreement"]', "agreementId");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "cv-add") return openCoverageModal(pid, state.companyId, a, null, () => renderTab("coverage"));
      if (act === "cv-edit") return openCoverageModal(pid, state.companyId, a, (a.coverage || []).find((l) => String(l.id) === String(arg)), () => renderTab("coverage"));
      if (act === "cv-cancel") return openEndCoverageModal(pid, state.companyId, a, arg, () => renderTab("coverage"));
      if (act === "cv-remove") {
        if (!(await ui.confirm({ title: "Remove this coverage line?", message: "It was never billed, so it can be removed entirely.", danger: true, okLabel: "Remove" }))) return;
        const res = await A.removeCoverage(pid, state.companyId, a.id, arg);
        if (res.error) return ERP.toast(res.error, "error");
        ERP.toast("Coverage removed.", "success"); return renderTab("coverage");
      }
      if (act === "cv-new-agreement") return openAgreementModal(pid, { agreement: null, companyId: state.companyId }, () => renderTab("coverage"));
    });
  }

  async function openCoverageModal(pid, companyId, agreement, line, refresh) {
    if (!ERP.security.enforce("agreements.edit", { companyId: companyId })) return;
    const l = line || A.newCoverage({ effectiveFrom: ui.today() });
    const fields =
      '<div class="erp-form-row">' +
        ui.select("type", "Coverage type", A.COVERAGE_TYPES.map((t) => ({ value: t.id, label: t.label })), l.type) +
        ui.text("name", "Name", l.name, "e.g. Office workstations") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("refId", "Configuration / service / user id", l.refId, "optional reference") +
        ui.number("quantity", "Quantity", l.quantity, { min: 0, step: 1 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("unitPrice", "Unit price / cycle", l.unitPrice, { min: 0, step: 0.01 }) +
        ui.check("included", "Included in the base fee", l.included !== false) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("effectiveFrom", "Effective from", l.effectiveFrom || ui.today()) +
        ui.dateInput("effectiveTo", "Effective to (blank = open)", l.effectiveTo || "") +
      "</div>" +
      ui.textarea("note", "Note", l.note || "", 2);
    const modal = ui.modal({
      title: line ? "Edit coverage line" : "Add coverage",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "cvm-cancel" }) + " " + ui.btn(line ? "Save" : "Add coverage", { small: true, primary: true, act: "cvm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=cvm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=cvm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["type", "name", "refId", "quantity", "unitPrice", "included", "effectiveFrom", "effectiveTo", "note"]);
      btn.disabled = true;
      const res = line
        ? await A.updateCoverage(pid, companyId, agreement.id, line.id, v)
        : await A.addCoverage(pid, companyId, agreement.id, v);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(line ? "Coverage updated." : "Coverage added.", "success"); refresh();
    };
  }

  async function openEndCoverageModal(pid, companyId, agreement, lineId, refresh) {
    if (!ERP.security.enforce("agreements.edit", { companyId: companyId })) return;
    const line = (agreement.coverage || []).find((l) => String(l.id) === String(lineId));
    const modal = ui.modal({
      title: "End coverage line",
      body: ui.form(ui.dateInput("effectiveTo", "Coverage ends", ui.today()) + ui.text("note", "Note", "", "e.g. device retired")) +
        '<p class="erp-modal-note">The line stops billing from this date and is prorated into the current period. Its history is kept.</p>',
      foot: ui.btn("Keep it", { small: true, act: "ce-cancel" }) + " " + ui.btn("End coverage", { small: true, danger: true, act: "ce-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=ce-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=ce-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["effectiveTo", "note"]);
      btn.disabled = true;
      const res = await A.cancelCoverage(pid, companyId, agreement.id, lineId, v.effectiveTo, v.note);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Coverage ended on " + (v.effectiveTo || ui.today()) + ".", "success"); refresh();
    };
  }

  /* ── billing tab ── */

  async function renderBilling(panel, pid) {
    const state = panel.__host.__agr;
    const sel = await ensureSelection(pid, state);
    if (!state.companyId) { panel.innerHTML = ui.alert("Add a client and an agreement first.", "warn"); return; }
    const a = state.agreementId ? await A.get(state.companyId, state.agreementId) : null;
    if (!a) { panel.innerHTML = ui.card("Billing", ui.alert("This client has no agreements yet.", "info")); return; }
    const canBill = ERP.security.can("agreements.bill");
    const period = A.periodFor(a, state.periodDate);
    const derived = await A.deriveCharge(pid, a, period, {});
    const posted = await A.charges(state.companyId, { agreementId: a.id });
    const already = posted.find((c) => c.periodKey === period.key && c.status !== "void");

    const lineRows = derived.lines.map((l) => ({
      kind: ui.badge(l.kind, l.kind === "overage" ? "warn" : l.kind === "minimum" ? "info" : "muted"),
      label: ui.esc(l.label) + (l.prorated ? " " + ui.badge("prorated", "info") : ""),
      qty: ui.fmt(l.qty, 2),
      unit: maskedMoney(l.unitPrice, derived.currency),
      amount: maskedMoney(l.amount, derived.currency),
    }));
    const inputRows = derived.inputs.map((i) => ({ label: ui.esc(i.label), value: ui.esc(i.value) }));

    const chargeRows = posted.map((c) => ({
      period: ui.esc(c.periodStart) + " → " + ui.esc(c.periodEnd),
      total: maskedMoney(c.total, c.currency),
      status: ui.badge(c.status, c.status === "posted" ? "success" : c.status === "void" ? "danger" : "info"),
      postedAt: ui.esc(ui.dateTime(c.postedAt)),
      by: ui.esc(c.postedBy || "—"),
      actions: canBill && c.status === "posted" && c.billedInvoiceId == null ? ui.btn("Void", { small: true, danger: true, act: "bl-void", arg: c.id }) : "",
    }));

    panel.innerHTML =
      '<div class="erp-db-toolbar">' +
        ui.select("bl-client", "Client", sel.companies, state.companyId) +
        ui.select("bl-agreement", "Agreement", agreementOptions(sel.agreements), state.agreementId) +
        ui.dateInput("bl-date", "As of", state.periodDate) +
        '<span class="erp-db-hint">Preview is derived live — nothing posts until you approve it</span>' +
      "</div>" +
      ui.card("Charge preview — " + period.start + " → " + period.end,
        (already ? ui.alert("A charge for this period is already posted (" + ui.money(already.total, already.currency) + "). Posting again is blocked unless you replace it.", "warn") : "") +
        ui.table([
          { key: "kind", label: "Type" },
          { key: "label", label: "Line" },
          { key: "qty", label: "Qty", align: "right" },
          { key: "unit", label: "Unit", align: "right" },
          { key: "amount", label: "Amount", align: "right" },
        ], lineRows, { emptyText: "Nothing to bill for this period." }) +
        ui.summary([
          { label: "Subtotal", value: maskedMoney(derived.subtotal, derived.currency) },
          { label: "Minimum top-up", value: maskedMoney(derived.minimumAdjusted, derived.currency) },
          { label: "Overage", value: maskedMoney(derived.overageAmount, derived.currency) },
          { label: "Total", value: maskedMoney(derived.total, derived.currency) },
        ]) +
        '<div class="erp-btn-row">' +
          (canBill ? ui.btn(already ? "Replace posted charge" : "Post charge", { primary: true, act: "bl-post", arg: already ? "replace" : "" }) : "") +
          (canBill ? ui.btn("Run due billing", { act: "bl-run" }) : "") +
        "</div>", { actions: ui.badge(A.statusLabel(a.status), A.statusTone(a.status)) }) +
      ui.grid([
        ui.card("Inputs", ui.table([{ key: "label", label: "Input" }, { key: "value", label: "Value" }], inputRows)),
        ui.card("Posted charges", ui.table([
          { key: "period", label: "Period" },
          { key: "total", label: "Total", align: "right" },
          { key: "status", label: "Status" },
          { key: "postedAt", label: "Posted" },
          { key: "by", label: "By" },
          { key: "actions", label: "", align: "right" },
        ], chargeRows, { emptyText: "No charges posted yet." })),
      ], "cols-2");

    const bind = (s, key) => { const el = panel.querySelector(s); if (el) el.addEventListener("change", () => { state[key] = el.value; if (key === "companyId") state.agreementId = ""; renderTab("billing"); }); };
    bind('[name="bl-client"]', "companyId");
    bind('[name="bl-agreement"]', "agreementId");
    bind('[name="bl-date"]', "periodDate");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "bl-post") {
        const replace = arg === "replace";
        if (replace && !(await ui.confirm({ title: "Replace the posted charge?", message: "The existing posted charge for this period will be voided by overwrite.", danger: true, okLabel: "Replace" }))) return;
        const res = await A.postCharge(pid, a.id, { asOf: state.periodDate, replace: replace });
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Charge posted: " + ui.money(res.record.total, res.record.currency), "success");
        return renderTab("billing");
      }
      if (act === "bl-run") {
        const res = await A.generateDue(pid, { asOf: state.periodDate });
        ERP.toast(res.posted.length + " charge(s) posted, " + res.skipped.length + " already current.", res.errors.length ? "error" : "success");
        return renderTab("billing");
      }
      if (act === "bl-void") {
        if (!(await ui.confirm({ title: "Void this charge?", message: "It will no longer count toward revenue.", danger: true, okLabel: "Void" }))) return;
        const res = await A.voidCharge(pid, state.companyId, arg, "voided from billing tab");
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Charge voided.", "success"); return renderTab("billing");
      }
    });
  }

  /* ── profitability tab ── */

  async function renderProfitability(panel, pid) {
    const state = panel.__host.__agr;
    const companies = await clientOptions();
    const rep = await A.profitability(pid, { from: state.from, to: state.to, companyId: state.companyId });
    const t = rep.totals;
    const rows = rep.rows.map((r) => ({
      agreement: ui.esc(r.agreementNumber || "") + " " + ui.esc(r.agreementName) + (r.estimated ? " " + ui.badge("est.", "muted") : ""),
      client: ui.esc(r.companyName || ""),
      revenue: maskedMoney(r.revenue, r.currency),
      labor: maskedMoney(r.laborCost, r.currency),
      other: maskedMoney(r.expenseCost, r.currency),
      cost: maskedMoney(r.costTotal, r.currency),
      margin: maskedMoney(r.margin, r.currency),
      marginPct: ui.fmt(r.marginPct, 1) + "%",
      hours: r.includedHours > 0 ? ui.fmt(r.consumedHours, 1) + " / " + ui.fmt(r.includedHours, 0) + "h" : ui.fmt(r.laborHours, 1) + "h",
      remaining: r.includedHours > 0 ? ui.fmt(r.remainingHours, 1) + "h" : "—",
      overage: r.overageHours > 0 ? ui.fmt(r.overageHours, 1) + "h" : "—",
      flags: r.flags.map((f) => ui.badge(f.label, f.tone)).join(" "),
      basis: '<span class="erp-sub">' + ui.esc(r.basis) + "</span>",
    }));

    panel.innerHTML =
      '<div class="erp-db-toolbar">' +
        ui.select("pf-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.dateInput("pf-from", "From", state.from) +
        ui.dateInput("pf-to", "To", state.to) +
        '<span class="erp-db-hint">Labour at member burdened cost + parts & third-party expenses</span>' +
      "</div>" +
      ui.summary([
        { label: "Revenue", value: maskedMoney(t.revenue) },
        { label: "Cost", value: maskedMoney(t.cost) },
        { label: "Margin", value: maskedMoney(t.margin) },
        { label: "Margin %", value: ui.fmt(t.marginPct, 1) + "%" },
        { label: "Overage hours", value: ui.fmt(t.overageHours, 1) },
        { label: "Unprofitable", value: String(t.unprofitable) },
      ]) +
      ui.card("Agreement profitability — " + rep.from + " → " + rep.to,
        ui.table([
          { key: "agreement", label: "Agreement" },
          { key: "client", label: "Client" },
          { key: "revenue", label: "Revenue", align: "right" },
          { key: "labor", label: "Labour", align: "right" },
          { key: "other", label: "Parts/3rd-party", align: "right" },
          { key: "margin", label: "Margin", align: "right" },
          { key: "marginPct", label: "Margin %", align: "right" },
          { key: "hours", label: "Hours (used/incl.)", align: "right" },
          { key: "remaining", label: "Remaining", align: "right" },
          { key: "overage", label: "Overage", align: "right" },
          { key: "flags", label: "Flags" },
        ], rows, { emptyText: "No agreements in this period." }) +
        '<div class="erp-rate-hint">Service cost is attributed per agreement: by covered work types when set, all client work when the client has a single agreement, otherwise pro-rata by revenue.</div>');

    const bind = (s, key) => { const el = panel.querySelector(s); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("profitability"); }); };
    bind('[name="pf-client"]', "companyId");
    bind('[name="pf-from"]', "from");
    bind('[name="pf-to"]', "to");
  }

  /* ── renewals tab ── */

  async function renderRenewals(panel, pid) {
    const state = panel.__host.__agr;
    const asOf = ui.today();
    const canEdit = ERP.security.can("agreements.edit");
    const queue = await A.renewalQueue(pid, { leadDays: 60, asOf: asOf });
    const archive = await A.archive(pid, {});
    const dueNow = queue.filter((x) => x.daysToExpiry < 0);
    const autoRenewCount = queue.filter((x) => x.agreement.autoRenew).length;

    const queueRows = queue.map((x) => {
      const a = x.agreement;
      const overdue = x.daysToExpiry < 0;
      return {
        agreement: ui.esc(a.number || "") + " " + ui.esc(a.name),
        client: ui.esc(a.__companyName || ""),
        endDate: ui.esc(a.endDate),
        days: overdue ? ui.badge(Math.abs(x.daysToExpiry) + "d overdue", "danger") : ui.badge(x.daysToExpiry + "d", x.daysToExpiry <= 30 ? "warn" : "info"),
        auto: a.autoRenew ? ui.badge("auto-renew", "info") : ui.badge("explicit", "muted"),
        value: maskedMoney(num(a.baseAmount) + A.coverageValue(a, asOf), a.currency),
        actions: canEdit
          ? ui.btn("Renew", { small: true, primary: true, act: "rn-renew", arg: a.id }) + " " + ui.btn("Terminate", { small: true, danger: true, act: "rn-terminate", arg: a.id })
          : "",
      };
    });
    const archiveRows = archive.map((a) => ({
      agreement: ui.esc(a.number || "") + " " + ui.esc(a.name),
      client: ui.esc(a.__companyName || ""),
      status: ui.badge(A.statusLabel(a.status), A.statusTone(a.status)),
      term: ui.esc(a.startDate || "") + " → " + ui.esc(a.endDate || "—"),
      coverage: String((a.coverage || []).length),
      units: String(A.coverageUnits(a, a.endDate || asOf)),
      reason: ui.esc(a.terminatedReason || "—"),
    }));

    panel.innerHTML =
      ui.summary([
        { label: "Due ≤60 days", value: String(queue.length) },
        { label: "Overdue", value: String(dueNow.length) },
        { label: "Auto-renew", value: String(autoRenewCount) },
        { label: "Archived", value: String(archive.length) },
      ]) +
      '<div class="erp-btn-row">' +
        (canEdit ? ui.btn("Run lifecycle sweep", { primary: true, act: "rn-run" }) : "") +
        '<span class="erp-db-hint">Sweep auto-renews agreements due, and expires those set to explicit renewal.</span>' +
      "</div>" +
      ui.card("Renewal queue (next 60 days)", ui.table([
        { key: "agreement", label: "Agreement" },
        { key: "client", label: "Client" },
        { key: "endDate", label: "Ends" },
        { key: "days", label: "Expiry" },
        { key: "auto", label: "Renewal" },
        { key: "value", label: "Recurring", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], queueRows, { emptyText: "Nothing expiring in the next 60 days." })) +
      ui.card("Archived agreements", ui.table([
        { key: "agreement", label: "Agreement" },
        { key: "client", label: "Client" },
        { key: "status", label: "Status" },
        { key: "term", label: "Term" },
        { key: "coverage", label: "Coverage lines", align: "right" },
        { key: "units", label: "Units", align: "right" },
        { key: "reason", label: "Reason" },
      ], archiveRows, { emptyText: "No expired or terminated agreements." }) +
        '<div class="erp-rate-hint">Archived agreements keep their coverage and charges so historical reporting stays intact.</div>');

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "rn-run") {
        const res = await A.runLifecycle(pid, { asOf: asOf });
        ERP.toast(res.renewed.length + " renewed, " + res.expired.length + " expired.", "success");
        return renderTab("renewals");
      }
      if (act === "rn-renew") {
        const loc = await A.locate(pid, arg);
        if (!loc) return;
        return openRenewModal(pid, loc, () => renderTab("renewals"));
      }
      if (act === "rn-terminate") return openTerminateModal(pid, arg, () => renderTab("renewals"));
    });
  }

  async function openRenewModal(pid, located, refresh) {
    if (!ERP.security.enforce("agreements.edit")) return;
    const a = located.agreement;
    const fields =
      '<div class="erp-form-row">' +
        ui.number("months", "Renew for (months)", a.renewalTermMonths || a.termMonths || 12, { min: 1, step: 1 }) +
        ui.dateInput("effectiveFrom", "Coverage continues from", ui.addDays(a.endDate || ui.today(), 1)) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("escalationPercent", "Price escalation on renewal (%)", 0, { min: 0, step: 0.1 }) +
      "</div>" +
      ui.textarea("note", "Note", "", 2);
    const modal = ui.modal({
      title: "Renew " + (a.number ? a.number + " · " : "") + a.name,
      size: "lg",
      body: ui.form(fields) + '<p class="erp-modal-note">The term extends from the current end date. An escalation updates the base amount for future cycles.</p>',
      foot: ui.btn("Cancel", { small: true, act: "rw-cancel" }) + " " + ui.btn("Renew agreement", { small: true, primary: true, act: "rw-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=rw-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=rw-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["months", "escalationPercent", "note"]);
      btn.disabled = true;
      const res = await A.renew(pid, a.id, { months: v.months, escalationPercent: v.escalationPercent, note: v.note });
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Agreement renewed to " + res.record.endDate + ".", "success"); refresh();
    };
  }

  /* ── station shell ── */

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
    ERP.states.loading(panel, "Loading agreements");
    try {
      if (id === "agreements") await renderAgreements(panel, await ten().providerId());
      else if (id === "coverage") await renderCoverage(panel, await ten().providerId());
      else if (id === "billing") await renderBilling(panel, await ten().providerId());
      else if (id === "profitability") await renderProfitability(panel, await ten().providerId());
      else if (id === "renewals") await renderRenewals(panel, await ten().providerId());
    } catch (e) {
      console.error("agreements tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }

  A.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "agreement", title: "Agreements", phase: "Phase 5 · Agreements & recurring services",
        message: "Create a service provider and a client company first — then define recurring agreements here.",
      });
      return;
    }
    try { await A.ensureSeed(pid); } catch (e) {}
    host.__agr = host.__agr || blankState();
    currentHost = host;

    const defs = [
      { id: "agreements", label: "Agreements" },
      { id: "coverage", label: "Coverage & additions" },
      { id: "billing", label: "Agreement billing" },
      { id: "profitability", label: "Profitability" },
      { id: "renewals", label: "Renewals & lifecycle" },
    ];
    const active = defs.find((d) => d.id === host.__agr.tab) ? host.__agr.tab : "agreements";

    host.innerHTML = ui.pageHead("Agreements", "Recurring service contracts, coverage, billing, margin and renewals.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__agr.tab = b.getAttribute("data-tab");
      await renderTab(host.__agr.tab);
    }));
    await renderTab(active);
  };
})();
