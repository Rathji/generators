/* ============================================================
   PSA-U — billing setup, invoice assembly, runs & safety
   (Phase 6 · Tasks 28, 29, 30, 32)

   Billing turns the work a provider has done into money owed.
   This engine owns:

     • billing setup  — the provider-wide defaults (billing terms,
                        tax code, currency, invoice cycle, numbering
                        and the invoice template) plus a per-company
                        override, so every invoice is governed by a
                        documented, inspectable configuration
                        (Task 28).
     • assembly       — reading the correct sources (posted
                        agreement charges, approved billable time at
                        its resolved rate, approved billable
                        expenses with markup, project milestones) and
                        building invoice lines grouped per the
                        template, each line traceable back to the
                        source record that produced it (Task 29).
     • generation     — a dry-run that shows what would be invoiced,
                        readiness gates that catch unbilled time or
                        unapproved expenses, and the run that creates
                        draft invoices for pre-invoice review, then
                        approve/post (Task 30).
     • safety         — a posted invoice is immutable (changes go
                        through a credit or adjustment), re-running
                        billing cannot double-bill a period, and every
                        action is idempotent and audited (Task 32).

   Storage: invoices live in the CLIENT COMPANY document (kind
   "invoice"), beside the agreement charges and the client's time
   and expenses they assemble. Payments, credits and the AR reports
   live in psa.payments.js and psa.ar.js. Posted invoices stamp
   `invoiceId` on every source record they consumed, which is the
   lock that makes a second run a no-op rather than a double-bill.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const B = (ERP.billing = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("billing requires the tenancy service");
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
  function maskedMoney(v, cur) { return ERP.security.canSeeFinancials() ? ui.money(v, cur) : "•••"; }

  async function putCompany(companyId, rec) {
    if (rec.id == null || rec.id === "" || !isFinite(rec.id)) rec.id = ten().nextId(await ten().records("company", companyId));
    rec.companyId = companyId;
    return ten().upsert("company", companyId, rec);
  }
  async function putProvider(pid, rec) {
    if (rec.id == null || rec.id === "" || !isFinite(rec.id)) rec.id = ten().nextId(await ten().records("provider", pid));
    rec.providerId = pid;
    return ten().upsert("provider", pid, rec);
  }
  async function emit(pid, event, invoice, extra) {
    if (!ERP.workflow) return;
    try {
      const company = invoice && invoice.companyId != null ? await ERP.companies.get(invoice.companyId) : null;
      await ERP.workflow.emit(event, Object.assign({ event: event, invoice: invoice, company: company, actor: actor() }, extra || {}));
    } catch (e) {}
  }
  function audit(action, invoice, summary) {
    if (!ERP.master || typeof ERP.master.audit !== "function") return;
    try { ERP.master.audit({ action: action, targetType: "invoice", targetId: invoice ? invoice.id : null, summary: summary || "" }); } catch (e) {}
  }

  /* ─────────────────────────── constants ─────────────────────────── */

  B.STATUSES = [
    { id: "draft", label: "Draft", tone: "muted" },
    { id: "approved", label: "Approved", tone: "info" },
    { id: "posted", label: "Posted", tone: "success" },
    { id: "void", label: "Void", tone: "danger" },
  ];
  B.statusLabel = (id) => (B.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  B.statusTone = (id) => (B.STATUSES.find((s) => s.id === id) || {}).tone || "muted";
  B.EDITABLE_STATUSES = ["draft", "approved"];
  B.isImmutable = (inv) => !inv || B.EDITABLE_STATUSES.indexOf(String(inv.status)) === -1;

  B.SOURCE_TYPES = [
    { id: "agreement", label: "Agreement" },
    { id: "time", label: "Time" },
    { id: "expense", label: "Expense" },
    { id: "project", label: "Project milestone" },
    { id: "product", label: "Product / service" },
    { id: "manual", label: "Manual" },
    { id: "carryover", label: "Carry-over" },
  ];
  B.sourceLabel = (id) => (B.SOURCE_TYPES.find((s) => s.id === id) || {}).label || id || "—";

  B.CYCLES = [
    { id: "on-demand", label: "On demand" },
    { id: "weekly", label: "Weekly" },
    { id: "monthly", label: "Monthly" },
    { id: "quarterly", label: "Quarterly" },
  ];
  B.cycleLabel = (id) => (B.CYCLES.find((c) => c.id === id) || {}).label || id || "—";

  B.PAYMENT_STATUSES = [
    { id: "unpaid", label: "Unpaid", tone: "warn" },
    { id: "partial", label: "Part paid", tone: "info" },
    { id: "paid", label: "Paid", tone: "success" },
    { id: "overpaid", label: "Overpaid", tone: "info" },
  ];
  B.paymentStatusLabel = (id) => (B.PAYMENT_STATUSES.find((p) => p.id === id) || {}).label || id || "—";
  B.paymentStatusTone = (id) => (B.PAYMENT_STATUSES.find((p) => p.id === id) || {}).tone || "muted";

  /* ─────────────────────────── billing setup (Task 28) ───────────────────────────
     Provider-wide defaults live in the provider document (kind
     "billingSettings"). A client may carry its own override
     (kind "billingProfile" in the company document). `configFor`
     merges the two with the platform defaults and reports which
     layer supplied each value. */

  B.SETTINGS_KIND = "billingSettings";
  B.PROFILE_KIND = "billingProfile";

  B.newSettings = (over) => Object.assign({
    kind: "billingSettings", id: "billing", providerId: null,
    termDays: 30, currency: "", defaultTaxCode: "NONE", pricesIncludeTax: false,
    invoiceCycle: "on-demand", cycleDay: 1, autoApprove: false,
    template: { groupBy: "source", showTimeDetail: true, showTicketRef: true, dueDays: null, notes: "", footer: "" },
    updatedAt: null, updatedBy: null,
  }, over || {});

  B.newCompanyProfile = (over) => Object.assign({
    kind: "billingProfile", id: "billing", companyId: null, overrideEnabled: true,
    termDays: null, currency: "", defaultTaxCode: "", pricesIncludeTax: null,
    invoiceCycle: "", dueDays: null, poNumber: "", notes: "", footer: "",
    updatedAt: null, updatedBy: null,
  }, over || {});

  B.settings = async function (pid) {
    let list = [];
    try { list = await ten().records("provider", pid, B.SETTINGS_KIND); } catch (e) { list = []; }
    const rec = list.find((r) => r.id === "billing") || list[0];
    return Object.assign(B.newSettings(), rec || {});
  };

  B.saveSettings = async function (pid, patch, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("billing.edit")) return { error: "forbidden" };
    const cur = await B.settings(pid);
    const rec = Object.assign(B.newSettings(), cur, patch || {}, {
      kind: B.SETTINGS_KIND, id: "billing", providerId: pid,
      template: Object.assign({}, cur.template, (patch && patch.template) || {}),
      updatedAt: nowIso(), updatedBy: actorName(),
    });
    await putProvider(pid, rec);
    return { record: rec };
  };

  B.companyProfile = async function (companyId) {
    if (companyId == null) return null;
    let list = [];
    try { list = await ten().records("company", companyId, B.PROFILE_KIND); } catch (e) { list = []; }
    return list.find((r) => r.id === "billing") || list[0] || null;
  };

  B.saveCompanyProfile = async function (companyId, patch, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("billing.edit", { companyId })) return { error: "forbidden" };
    if (companyId == null || companyId === "") return { error: "company_required" };
    const cur = (await B.companyProfile(companyId)) || B.newCompanyProfile({ companyId: companyId });
    const rec = Object.assign(B.newCompanyProfile(), cur, patch || {}, {
      kind: B.PROFILE_KIND, id: "billing", companyId: companyId,
      updatedAt: nowIso(), updatedBy: actorName(),
    });
    await putCompany(companyId, rec);
    return { record: rec };
  };

  B.taxRates = async function () {
    try {
      const list = (await ERP.master.taxes()).filter((t) => t.active !== false);
      if (list.length) return list;
      return (ERP.master.DEFAULT_TAXES || []).filter((t) => t.active !== false);
    } catch (e) { return (ERP.master && ERP.master.DEFAULT_TAXES) || []; }
  };
  B.taxFor = async function (code) {
    const list = await B.taxRates();
    return list.find((t) => String(t.code) === String(code)) || { code: code || "NONE", name: "No tax", rate: 0 };
  };
  B.taxOptions = async function () {
    const list = await B.taxRates();
    return list.map((t) => ({ value: t.code, label: t.name + " (" + num(t.rate) + "%)" }));
  };

  B.numbering = async function () {
    try { const s = await ERP.master.settings(); return s.numbering; } catch (e) { return null; }
  };
  B.saveNumbering = async function (patch, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("billing.edit")) return { error: "forbidden" };
    try {
      const list = await ERP.master.settingsList();
      const profile = list.find((r) => r.kind === "profile") || ERP.master.DEFAULT_PROFILE;
      const numbering = Object.assign({}, list.find((r) => r.kind === "numbering") || ERP.master.DEFAULT_NUMBERING, patch || {});
      numbering.prefixes = Object.assign({}, ERP.master.DEFAULT_NUMBERING.prefixes, (list.find((r) => r.kind === "numbering") || {}).prefixes, (patch && patch.prefixes) || {});
      const res = await ERP.master.saveSettings([profile, numbering]);
      return { record: numbering, res: res };
    } catch (e) { return { error: "numbering_failed", message: (e && e.message) || String(e) }; }
  };

  /* The effective billing configuration for a client. Every value names the
     layer it came from, so the setup screen can explain the precedence:
     company override → provider default → platform default. */
  B.configFor = async function (pid, companyId) {
    const settings = await B.settings(pid);
    const profile = companyId != null ? await B.companyProfile(companyId) : null;
    const company = companyId != null ? await ERP.companies.get(companyId) : null;
    const use = !!(profile && profile.overrideEnabled !== false);

    function field(companyVal, providerVal, fallback) {
      if (use && companyVal !== null && companyVal !== undefined && companyVal !== "") return { value: companyVal, source: "company" };
      if (providerVal !== null && providerVal !== undefined && providerVal !== "") return { value: providerVal, source: "provider" };
      return { value: fallback, source: "default" };
    }

    const fTerm = field(profile && profile.termDays, settings.termDays, 30);
    const fTax = field(profile && profile.defaultTaxCode, settings.defaultTaxCode, "NONE");
    const fCycle = field(profile && profile.invoiceCycle, settings.invoiceCycle, "on-demand");
    const fCurrency = field(profile && profile.currency, settings.currency, "");

    let currency = fCurrency.value;
    if (!currency) currency = (company && company.currency) || "";
    if (!currency) { try { const p = await ten().provider(); currency = (p && p.currency) || ""; } catch (e) {} }
    if (!currency) { try { currency = await ERP.master.currency(); } catch (e) {} }
    if (!currency) currency = "USD";

    const template = Object.assign(
      { groupBy: "source", showTimeDetail: true, showTicketRef: true, dueDays: null, notes: "", footer: "" },
      settings.template || {},
      use && profile.template ? profile.template : {}
    );

    const incl = use && profile && profile.pricesIncludeTax != null
      ? profile.pricesIncludeTax === true
      : settings.pricesIncludeTax === true;

    return {
      settings: settings, profile: profile, company: company,
      currency: currency, termDays: num(fTerm.value, 30), taxCode: String(fTax.value || "NONE"),
      pricesIncludeTax: incl, invoiceCycle: String(fCycle.value || "on-demand"), cycleDay: num(settings.cycleDay, 1),
      autoApprove: settings.autoApprove === true,
      dueDays: use && profile && profile.dueDays != null ? num(profile.dueDays) : (template.dueDays != null ? num(template.dueDays) : null),
      template: template,
      notes: (use && profile && profile.notes) || template.notes || "",
      footer: (use && profile && profile.footer) || template.footer || "",
      poNumber: (use && profile && profile.poNumber) || "",
      source: { termDays: fTerm.source, taxCode: fTax.source, invoiceCycle: fCycle.source, currency: fCurrency.source },
    };
  };

  /* ─────────────────────────── invoice model ─────────────────────────── */

  B.newLine = (over) => Object.assign({
    lineId: null, source: "manual", sourceId: null, sources: [],
    description: "", details: "", qty: 1, unit: "", unitPrice: 0, amount: 0,
    taxCode: "", taxRate: 0, taxAmount: 0, date: "",
    ticketId: null, projectId: null, agreementId: null, memberId: null,
    meta: null,
  }, over || {});

  B.newInvoice = (over) => Object.assign({
    kind: "invoice", id: null, providerId: null, companyId: null, number: "", status: "draft",
    issueDate: "", dueDate: "", currency: "", termsDays: 30, pricesIncludeTax: false,
    periodKey: "", periodStart: "", periodEnd: "", runKey: "",
    lines: [], subtotal: 0, taxTotal: 0, total: 0,
    amountPaid: 0, credits: 0, adjustments: 0, writeOff: 0, balance: 0, paymentStatus: "unpaid",
    payments: [], creditNotes: [], adjustmentsList: [],
    poNumber: "", notes: "", footer: "",
    approvedAt: null, approvedBy: null, postedAt: null, postedBy: null,
    voidedAt: null, voidedBy: null, voidReason: "",
    createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  /* Pure: recompute every derived figure from the lines and the applied
     payments / credits / adjustments / write-off. Mutates and returns inv. */
  B.recalc = function (inv) {
    const incl = inv.pricesIncludeTax === true;
    let sub = 0, tax = 0;
    inv.lines = (inv.lines || []).map((l, i) => {
      const q = num(l.qty, 1) || 1;
      const up = num(l.unitPrice);
      const amount = round2(q * up);
      const rate = num(l.taxRate);
      const taxAmount = rate > 0 ? (incl ? round2(amount - amount / (1 + rate / 100)) : round2(amount * rate / 100)) : 0;
      sub += amount; tax += taxAmount;
      return Object.assign({}, l, { lineId: l.lineId == null ? i + 1 : l.lineId, qty: q, unitPrice: up, amount: amount, taxRate: rate, taxAmount: taxAmount });
    });
    inv.subtotal = round2(sub);
    inv.taxTotal = round2(tax);
    inv.total = incl ? inv.subtotal : round2(inv.subtotal + inv.taxTotal);

    const payments = (inv.payments || []).filter((p) => p.status !== "void");
    inv.amountPaid = round2(payments.reduce((n, p) => n + num(p.amount), 0));
    const credits = (inv.creditNotes || []).filter((c) => c.status !== "void");
    inv.credits = round2(credits.reduce((n, c) => n + num(c.amount), 0));
    const adjList = (inv.adjustmentsList || []).filter((a) => a.status !== "void");
    inv.adjustments = round2(adjList.filter((a) => a.type !== "writeoff").reduce((n, a) => n + num(a.amount), 0));
    inv.writeOff = round2(adjList.filter((a) => a.type === "writeoff").reduce((n, a) => n + num(a.amount), 0));
    inv.balance = round2(inv.total - inv.credits - inv.adjustments - inv.writeOff - inv.amountPaid);
    if (inv.balance <= 0.005) inv.paymentStatus = (inv.amountPaid + inv.credits + inv.adjustments) > inv.total + 0.005 ? "overpaid" : "paid";
    else inv.paymentStatus = (inv.amountPaid > 0 || inv.credits > 0) ? "partial" : "unpaid";
    return inv;
  };

  /* ─────────────────────────── reads ─────────────────────────── */

  async function invoiceEntries(companyId) {
    try { return await ten().records("company", companyId, "invoice"); } catch (e) { return []; }
  }

  B.forCompany = (companyId) => invoiceEntries(companyId);

  B.all = async function (pid, query) {
    query = query || {};
    const entries = await ERP.companies.list();
    const out = [];
    for (const e of entries) {
      if (query.companyId != null && query.companyId !== "" && String(e.id) !== String(query.companyId)) continue;
      for (const inv of await invoiceEntries(e.id)) {
        if (query.status && String(inv.status) !== String(query.status)) continue;
        if (query.statusIn && query.statusIn.map(String).indexOf(String(inv.status)) === -1) continue;
        if (query.paymentStatus && String(inv.paymentStatus) !== String(query.paymentStatus)) continue;
        if (query.from && String(inv.issueDate) < String(query.from)) continue;
        if (query.to && String(inv.issueDate) > String(query.to)) continue;
        if (query.open && num(inv.balance) <= 0.005) continue;
        out.push(Object.assign({}, inv, { __companyName: e.name }));
      }
    }
    out.sort((a, b) => String(b.issueDate || "").localeCompare(String(a.issueDate || "")) || (Number(b.id) - Number(a.id)));
    return out;
  };

  B.get = async function (companyId, id) {
    if (companyId == null || id == null) return null;
    return (await invoiceEntries(companyId)).find((i) => String(i.id) === String(id)) || null;
  };

  B.locate = async function (pid, invoiceId) {
    const entries = await ERP.companies.list();
    for (const e of entries) {
      const found = (await invoiceEntries(e.id)).find((i) => String(i.id) === String(invoiceId));
      if (found) return { invoice: found, companyId: e.id, company: await ERP.companies.get(e.id) };
    }
    return null;
  };

  B.nextNumber = async function (pid) {
    try {
      if (ERP.master && typeof ERP.master.allocateNumber === "function") return await ERP.master.allocateNumber("invoice");
    } catch (e) {}
    const s = await B.settings(pid);
    const next = num(s.invoiceSeq) + 1;
    try { await B.saveSettings(pid, { invoiceSeq: next }, { system: true }); } catch (e) {}
    const pref = (s.template && s.template.prefix) || "INV";
    return pref + "-" + String(next).padStart(4, "0");
  };

  /* ─────────────────────────── writes & safety (Task 32) ─────────────────────────── */

  B.save = async function (pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("billing.edit", { companyId: rec && rec.companyId })) return { error: "forbidden" };
    const companyId = rec && rec.companyId;
    if (companyId == null || companyId === "") return { error: "company_required", message: "Choose the client this invoice is for." };
    const existing = rec && rec.id != null ? await B.get(companyId, rec.id) : null;
    if (existing && B.isImmutable(existing) && !opts.system) {
      return { error: "immutable", message: "A " + B.statusLabel(existing.status).toLowerCase() + " invoice can't be edited — raise a credit or adjustment instead." };
    }
    const inv = Object.assign(B.newInvoice(), existing || {}, rec || {});
    if (!opts.system && existing && B.isImmutable(existing)) return { error: "immutable" };

    const config = await B.configFor(pid, companyId);
    if (!inv.currency) inv.currency = config.currency;
    if (!inv.pricesIncludeTax && config.pricesIncludeTax) inv.pricesIncludeTax = config.pricesIncludeTax;
    inv.termsDays = num(inv.termsDays, config.termDays || 30);
    if (!inv.issueDate) inv.issueDate = ui.today();
    if (!inv.dueDate) inv.dueDate = ui.addDays(inv.issueDate, inv.termsDays);
    if (inv.issueDate && !inv.dueDate) inv.dueDate = ui.addDays(inv.issueDate, inv.termsDays);
    inv.lines = Array.isArray(inv.lines) ? inv.lines : [];
    inv.payments = Array.isArray(inv.payments) ? inv.payments : [];
    inv.creditNotes = Array.isArray(inv.creditNotes) ? inv.creditNotes : [];
    inv.adjustmentsList = Array.isArray(inv.adjustmentsList) ? inv.adjustmentsList : [];
    if (!existing) {
      inv.number = inv.number || await B.nextNumber(pid);
      inv.status = "draft";
      inv.createdAt = nowIso();
      inv.createdBy = inv.createdBy != null ? inv.createdBy : actor().memberId || null;
    } else if (inv.status !== "approved") {
      inv.status = existing.status;
    }
    B.recalc(inv);
    inv.providerId = pid;
    inv.updatedAt = nowIso();
    await putCompany(companyId, inv);
    return { record: inv, created: !existing };
  };

  B.remove = async function (pid, companyId, id) {
    if (!ERP.security.enforce("billing.edit", { companyId })) return { error: "forbidden" };
    const inv = await B.get(companyId, id);
    if (!inv) return { error: "not_found" };
    if (B.isImmutable(inv)) return { error: "immutable", message: "Only a draft or approved invoice can be deleted." };
    await ten().remove("company", companyId, (r) => r.kind === "invoice" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  B.addLine = async function (pid, companyId, invoiceId, line) {
    if (!ERP.security.enforce("billing.edit", { companyId })) return { error: "forbidden" };
    const inv = await B.get(companyId, invoiceId);
    if (!inv) return { error: "not_found" };
    if (B.isImmutable(inv)) return { error: "immutable" };
    inv.lines = (inv.lines || []).concat([B.newLine(line)]);
    B.recalc(inv);
    inv.updatedAt = nowIso();
    await putCompany(companyId, inv);
    return { record: inv };
  };

  B.removeLine = async function (pid, companyId, invoiceId, lineId) {
    if (!ERP.security.enforce("billing.edit", { companyId })) return { error: "forbidden" };
    const inv = await B.get(companyId, invoiceId);
    if (!inv) return { error: "not_found" };
    if (B.isImmutable(inv)) return { error: "immutable" };
    inv.lines = (inv.lines || []).filter((l) => String(l.lineId) !== String(lineId));
    inv.lines.forEach((l, i) => { l.lineId = i + 1; });
    B.recalc(inv);
    inv.updatedAt = nowIso();
    await putCompany(companyId, inv);
    return { record: inv };
  };

  /* ─────────────────────────── assembly (Task 29) ─────────────────────────── */

  B.defaultPeriod = function (asOf) {
    const day = parseDay(asOf || ui.today()) || new Date();
    const start = fmtDate(new Date(day.getFullYear(), day.getMonth(), 1));
    const end = fmtDate(new Date(day.getFullYear(), day.getMonth() + 1, 0));
    return { key: start.slice(0, 7), start: start, end: end };
  };

  B.resolvePeriod = function (opts) {
    opts = opts || {};
    if (opts.period && opts.period.start && opts.period.end) return opts.period;
    if (opts.fromDate && opts.toDate) return { key: opts.fromDate + "_" + opts.toDate, start: opts.fromDate, end: opts.toDate };
    return B.defaultPeriod(opts.asOf);
  };

  function lineTotals(lines, incl) {
    let sub = 0, tax = 0;
    for (const l of lines) {
      const amount = round2((num(l.qty, 1) || 1) * num(l.unitPrice));
      const rate = num(l.taxRate);
      const taxAmount = rate > 0 ? (incl ? round2(amount - amount / (1 + rate / 100)) : round2(amount * rate / 100)) : 0;
      sub += amount; tax += taxAmount;
    }
    return { subtotal: round2(sub), taxTotal: round2(tax), total: incl ? round2(sub) : round2(sub + tax) };
  }
  B.lineTotals = lineTotals;

  async function workTypeLabel(pid, code) {
    try { const rec = await ERP.taxonomy.find(pid, "workType", code); return rec ? rec.label : (code || "Work"); } catch (e) { return code || "Work"; }
  }

  function groupLines(lines, groupBy) {
    if (groupBy !== "worktype" && groupBy !== "summary") return lines;
    const groups = [];
    const index = {};
    for (const l of lines) {
      let key;
      if (groupBy === "summary") key = l.source;
      else key = l.source + "|" + String((l.meta && l.meta.workType) || (l.meta && l.meta.category) || "");
      if (key == null || l.source === "agreement" || l.source === "manual" || l.source === "project") { groups.push(l); continue; }
      if (!index[key]) {
        const g = Object.assign({}, l, { sources: (l.sources || [l.sourceId]).filter((x) => x != null), sourceId: l.sourceId });
        index[key] = g;
        groups.push(g);
      } else {
        const g = index[key];
        g.qty = round2(g.qty + num(l.qty, 1));
        g.amount = round2(g.amount + num(l.amount));
        g.sources = g.sources.concat((l.sources || [l.sourceId]).filter((x) => x != null));
      }
    }
    return groups.map((g) => Object.assign({}, g, { unitPrice: g.qty ? round2(num(g.amount) / g.qty) : num(g.unitPrice), unit: g.unit || (String(g.source) === "time" ? "h" : "") }));
  }

  /* Read every unbilled source for a client and period and build the lines a
     template would group. Pure with respect to storage — it writes nothing. */
  B.assemble = async function (pid, opts) {
    opts = opts || {};
    const companyId = opts.companyId;
    if (companyId == null || companyId === "") return { error: "company_required" };
    const config = opts.config || await B.configFor(pid, companyId);
    const period = B.resolvePeriod(opts);
    const taxCode = config.taxCode;
    const tax = await B.taxFor(taxCode);
    const taxRate = num(tax.rate);
    const lines = [];
    const sources = { agreement: [], time: [], expense: [], project: [] };
    const company = await ERP.companies.get(companyId);

    /* agreement recurring charges already posted by Phase 5 */
    try {
      const charges = await ERP.agreements.charges(companyId, {});
      for (const c of charges) {
        if (c.status !== "posted" || c.billedInvoiceId != null) continue;
        lines.push(B.newLine({
          source: "agreement", sourceId: c.id, sources: [c.id],
          description: "Agreement " + (c.agreementNumber ? c.agreementNumber + " " : "") + (c.agreementName || "") + " (" + c.periodStart + " → " + c.periodEnd + ")",
          qty: 1, unit: "", unitPrice: num(c.total), amount: num(c.total),
          taxCode: taxCode, taxRate: taxRate, date: c.periodStart, agreementId: c.agreementId,
          meta: { periodKey: c.periodKey, chargeTotal: num(c.total), lineCount: (c.lines || []).length },
        }));
        sources.agreement.push(c.id);
      }
    } catch (e) {}

    /* approved billable time at its resolved rate */
    try {
      const entries = await ERP.time.entries(pid, { companyId: companyId, fromDate: period.start, toDate: period.end });
      for (const e of entries) {
        if (!e.billable || e.writtenOff) continue;
        if (["approved", "locked"].indexOf(String(e.status)) === -1) continue;
        if (e.invoiceId != null) continue;
        const rate = (e.rate && num(e.rate.amount)) || num((await ERP.time.resolveFor(pid, e)).amount);
        const hours = round6(num(e.minutes) / 60);
        const amount = round2(hours * rate);
        if (amount <= 0) continue;
        const wt = await workTypeLabel(pid, e.workType);
        const member = (await ERP.members.members()).find((m) => String(m.id) === String(e.memberId));
        lines.push(B.newLine({
          source: "time", sourceId: e.id, sources: [e.id],
          description: wt + (member ? " — " + member.name : "") + (e.notes ? " · " + e.notes : ""),
          qty: hours, unit: "h", unitPrice: rate, amount: amount,
          taxCode: taxCode, taxRate: taxRate, date: e.date, ticketId: e.ticketId, memberId: e.memberId,
          projectId: e.projectId != null ? e.projectId : null, taskId: e.taskId != null ? e.taskId : null,
          meta: { minutes: num(e.minutes), rate: rate, rateSource: e.rate && e.rate.source, workType: e.workType, workTypeLabel: wt, memberName: member ? member.name : "" },
        }));
        sources.time.push(e.id);
      }
    } catch (e) {}

    /* approved billable expenses with their markup applied */
    try {
      const expenses = await ERP.expenses.list(pid, { companyId: companyId, fromDate: period.start, toDate: period.end });
      for (const x of expenses) {
        if (!x.billable || x.writtenOff) continue;
        if (["approved", "reimbursed"].indexOf(String(x.status)) === -1) continue;
        if (x.invoiceId != null) continue;
        const amount = ERP.expenses.billableAmount(x);
        if (amount <= 0) continue;
        lines.push(B.newLine({
          source: "expense", sourceId: x.id, sources: [x.id],
          description: "Expense — " + (x.description || x.category || "expense"),
          qty: 1, unit: "", unitPrice: amount, amount: amount,
          taxCode: taxCode, taxRate: taxRate, date: x.date, ticketId: x.ticketId, memberId: x.memberId,
          projectId: x.projectId != null ? x.projectId : null, taskId: x.taskId != null ? x.taskId : null,
          meta: { category: x.category, cost: num(x.amount), markup: ERP.expenses.markupLabelFor(x), billable: true },
        }));
        sources.expense.push(x.id);
      }
    } catch (e) {}

    /* project milestones (Phase 7 seam — only when the engine is present) */
    if (ERP.projects && typeof ERP.projects.billableMilestones === "function") {
      try {
        for (const m of await ERP.projects.billableMilestones(pid, companyId, period)) {
          lines.push(B.newLine({
            source: "project", sourceId: m.id, sources: [m.id],
            description: "Project milestone — " + (m.name || m.projectName || ""),
            qty: 1, unitPrice: num(m.amount), amount: num(m.amount),
            taxCode: taxCode, taxRate: taxRate, date: m.date || period.end, projectId: m.projectId,
            meta: m,
          }));
          sources.project.push(m.id);
        }
      } catch (e) {}
    }

    const grouped = groupLines(lines, config.template && config.template.groupBy);
    const totals = lineTotals(grouped, config.pricesIncludeTax);
    return {
      companyId: companyId, company: company, config: config, period: period,
      currency: config.currency, taxCode: taxCode, taxRate: taxRate, pricesIncludeTax: config.pricesIncludeTax,
      lines: grouped, subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
      sources: sources,
    };
  };

  B.dryRun = async function (pid, opts) {
    const asm = await B.assemble(pid, opts);
    if (asm.error) return asm;
    const readiness = await B.readiness(pid, asm.companyId, asm.period, { assemble: asm });
    return { assemble: asm, readiness: readiness };
  };

  /* ─────────────────────────── readiness gates (Task 30) ─────────────────────────── */

  B.readiness = async function (pid, companyId, period, opts) {
    opts = opts || {};
    period = period || B.defaultPeriod(ui.today());
    const runKey = String(companyId) + ":" + period.key;
    const blockers = [], warnings = [];

    const existing = (await invoiceEntries(companyId)).find((i) => i.runKey === runKey && i.status === "posted");
    if (existing) blockers.push({ code: "period_invoiced", message: "Invoice " + (existing.number || "#" + existing.id) + " already covers " + period.start + " → " + period.end + "." });

    let entries = [];
    try { entries = await ERP.time.entries(pid, { companyId: companyId, fromDate: period.start, toDate: period.end }); } catch (e) {}
    const unapprovedTime = entries.filter((e) => e.billable && !e.writtenOff && e.invoiceId == null && ["draft", "submitted", "rejected"].indexOf(String(e.status)) !== -1);
    if (unapprovedTime.length) warnings.push({ code: "unapproved_time", message: unapprovedTime.length + " billable time entr" + (unapprovedTime.length === 1 ? "y" : "ies") + " in this period are not approved." });
    const unrated = entries.filter((e) => e.billable && !e.writtenOff && e.invoiceId == null && ["approved", "locked"].indexOf(String(e.status)) !== -1 && !(e.rate && num(e.rate.amount) > 0));
    if (unrated.length) warnings.push({ code: "unrated_time", message: unrated.length + " approved time entr" + (unrated.length === 1 ? "y has" : "ies have") + " no resolved rate." });

    let expenses = [];
    try { expenses = await ERP.expenses.list(pid, { companyId: companyId, fromDate: period.start, toDate: period.end }); } catch (e) {}
    const unapprovedExp = expenses.filter((x) => x.billable && !x.writtenOff && x.invoiceId == null && ["draft", "submitted", "rejected"].indexOf(String(x.status)) !== -1);
    if (unapprovedExp.length) warnings.push({ code: "unapproved_expense", message: unapprovedExp.length + " billable expense" + (unapprovedExp.length === 1 ? " is" : "s are") + " not approved." });

    try {
      const agreements = await ERP.agreements.list(pid, { companyId: companyId, status: "active" });
      const charges = await ERP.agreements.charges(companyId, {});
      const due = agreements.filter((a) => {
        const billable = num(a.baseAmount) > 0 || ERP.agreements.coverageValue(a, period.end) > 0;
        const posted = charges.some((c) => String(c.agreementId) === String(a.id) && c.periodKey === period.key && c.status !== "void");
        return billable && !posted;
      });
      if (due.length) warnings.push({ code: "agreement_unposted", message: due.length + " active agreement" + (due.length === 1 ? " has" : "s have") + " no posted charge for this period." });
    } catch (e) {}

    return { ok: blockers.length === 0, blockers: blockers, warnings: warnings, counts: { unapprovedTime: unapprovedTime.length, unapprovedExpense: unapprovedExp.length, unratedTime: unrated.length } };
  };

  /* ─────────────────────────── generation runs (Task 30) ─────────────────────────── */

  B.generate = async function (pid, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("billing.edit", { companyId: opts.companyId })) return { error: "forbidden" };
    const companyId = opts.companyId;
    if (companyId == null || companyId === "") return { error: "company_required" };
    const period = B.resolvePeriod(opts);
    const runKey = String(companyId) + ":" + period.key;
    const existing = (await invoiceEntries(companyId)).find((i) => i.runKey === runKey && i.status !== "void");
    if (existing && !opts.replace) return { invoice: existing, existing: true, period: period };

    const asm = await B.assemble(pid, Object.assign({}, opts, { companyId: companyId, period: period }));
    if (asm.error) return asm;
    if (!asm.lines.length) return { error: "nothing_to_bill", period: period, assemble: asm };

    if (existing && opts.replace) {
      const v = await B.void(pid, existing.id, "Replaced by a billing re-run");
      if (v.error) return v;
    }

    const res = await B.save(pid, B.newInvoice({
      companyId: companyId,
      periodKey: period.key, periodStart: period.start, periodEnd: period.end, runKey: runKey,
      lines: asm.lines, currency: asm.currency, termsDays: asm.config.termDays,
      pricesIncludeTax: asm.pricesIncludeTax, poNumber: asm.config.poNumber,
      notes: asm.config.notes, footer: asm.config.footer,
      status: asm.config.autoApprove ? "approved" : "draft",
    }), { system: true });
    if (res.error) return res;
    audit(res.created ? "invoice_generated" : "invoice_updated", res.record, "Draft invoice " + (res.record.number || "") + " for " + period.start + " → " + period.end + " (" + maskedMoney(res.record.total, res.record.currency) + ").");
    if (res.created) await emit(pid, "invoice.created", res.record, { period: period });
    return { invoice: res.record, assemble: asm, period: period, created: res.created };
  };

  /* A non-writing preview of a run: what each client would be invoiced, and
     whether it is already covered or gated. `run` is the only thing that
     writes drafts. */
  B.preview = async function (pid, opts) {
    opts = opts || {};
    const period = B.resolvePeriod(opts);
    const entries = await ERP.companies.list();
    const runs = [];
    for (const e of entries) {
      if (opts.companyId != null && opts.companyId !== "" && String(e.id) !== String(opts.companyId)) continue;
      const asm = await B.assemble(pid, { companyId: e.id, period: period });
      const readiness = await B.readiness(pid, e.id, period);
      const existing = (await invoiceEntries(e.id)).find((i) => i.runKey === String(e.id) + ":" + period.key && i.status !== "void");
      if (asm.error) runs.push({ companyId: e.id, companyName: e.name, status: "error", error: asm.error, total: 0, readiness: readiness });
      else if (!asm.lines.length) runs.push({ companyId: e.id, companyName: e.name, status: "empty", total: 0, readiness: readiness, lineCount: 0 });
      else runs.push({ companyId: e.id, companyName: e.name, status: existing ? "existing" : (readiness.ok ? "draft" : "blocked"), total: asm.total, readiness: readiness, lineCount: asm.lines.length });
    }
    const totals = runs.reduce((t, r) => {
      t.total += num(r.total);
      if (r.status === "draft") t.draft += 1;
      else if (r.status === "existing") t.existing += 1;
      else if (r.status === "blocked") t.blocked += 1;
      return t;
    }, { total: 0, draft: 0, existing: 0, blocked: 0 });
    totals.total = round2(totals.total);
    return { asOf: opts.asOf || ui.today(), period: period, runs: runs, totals: totals };
  };

  B.run = async function (pid, opts) {
    opts = opts || {};
    const period = B.resolvePeriod(opts);
    const entries = await ERP.companies.list();
    const runs = [];
    for (const e of entries) {
      if (opts.companyId != null && opts.companyId !== "" && String(e.id) !== String(opts.companyId)) continue;
      const asm = await B.assemble(pid, { companyId: e.id, period: period });
      const readiness = await B.readiness(pid, e.id, period);
      if (asm.error) { runs.push({ companyId: e.id, companyName: e.name, status: "error", error: asm.error, readiness: readiness }); continue; }
      if (!asm.lines.length) { runs.push({ companyId: e.id, companyName: e.name, status: "empty", total: 0, readiness: readiness }); continue; }
      const gen = await B.generate(pid, { companyId: e.id, period: period, replace: opts.replace });
      runs.push({
        companyId: e.id, companyName: e.name,
        status: gen.error ? (gen.error === "forbidden" ? "forbidden" : "empty") : (gen.existing ? "existing" : (readiness.ok ? "draft" : "blocked")),
        invoice: gen.invoice || null, total: gen.invoice ? gen.invoice.total : asm.total,
        readiness: readiness, error: gen.error || null,
      });
    }
    const totals = runs.reduce((t, r) => {
      t.total += num(r.total);
      if (r.status === "draft") t.draft += 1;
      else if (r.status === "existing") t.existing += 1;
      else if (r.status === "blocked") t.blocked += 1;
      return t;
    }, { total: 0, draft: 0, existing: 0, blocked: 0 });
    totals.total = round2(totals.total);
    return { asOf: opts.asOf || ui.today(), period: period, runs: runs, totals: totals };
  };

  B.approve = async function (pid, invoiceId) {
    if (!ERP.security.enforce("billing.edit")) return { error: "forbidden" };
    const loc = await B.locate(pid, invoiceId);
    if (!loc) return { error: "not_found" };
    if (loc.invoice.status === "void") return { error: "void", message: "This invoice is void." };
    if (loc.invoice.status === "posted") return { invoice: loc.invoice, already: true };
    const rec = Object.assign({}, loc.invoice, { status: "approved", approvedAt: nowIso(), approvedBy: actorName(), updatedAt: nowIso() });
    B.recalc(rec);
    await putCompany(loc.companyId, rec);
    audit("invoice_approved", rec, "Invoice " + (rec.number || "") + " approved.");
    return { invoice: rec };
  };

  B.post = async function (pid, invoiceId, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("billing.post")) return { error: "forbidden" };
    const loc = await B.locate(pid, invoiceId);
    if (!loc) return { error: "not_found" };
    const inv = loc.invoice;
    if (inv.status === "void") return { error: "void", message: "A void invoice cannot be posted." };
    if (inv.status === "posted") return { invoice: inv, already: true };
    if (!opts.viaApproval && ERP.approvals) {
      const gate = await ERP.approvals.gateFor(pid, "invoice", inv.id);
      if (gate) return { error: "awaiting_approval", message: "This invoice is awaiting approval.", approval: gate };
    }
    if (!opts.force) {
      const r = await B.readiness(pid, inv.companyId, { start: inv.periodStart, end: inv.periodEnd, key: inv.periodKey });
      if (!r.ok) return { error: "blocked", blockers: r.blockers, readiness: r };
    }
    if (!inv.number) inv.number = await B.nextNumber(pid);
    const rec = Object.assign({}, inv, { status: "posted", postedAt: nowIso(), postedBy: actorName(), updatedAt: nowIso() });
    B.recalc(rec);
    await putCompany(loc.companyId, rec);
    await B.markInvoiced(pid, rec, true);
    audit("invoice_posted", rec, "Invoice " + (rec.number || "") + " posted for " + maskedMoney(rec.total, rec.currency) + ".");
    await emit(pid, "invoice.posted", rec, { company: loc.company });
    return { invoice: rec };
  };

  B.void = async function (pid, invoiceId, reason) {
    if (!ERP.security.enforce("billing.post")) return { error: "forbidden" };
    const loc = await B.locate(pid, invoiceId);
    if (!loc) return { error: "not_found" };
    const inv = loc.invoice;
    if (inv.status === "void") return { invoice: inv, already: true };
    if ((num(inv.amountPaid) > 0 || num(inv.credits) > 0) && !(arguments[3] && arguments[3].force)) {
      return { error: "has_payments", message: "Reverse the payments and credits before voiding this invoice." };
    }
    const rec = Object.assign({}, inv, { status: "void", voidedAt: nowIso(), voidedBy: actorName(), voidReason: reason || "", updatedAt: nowIso() });
    await putCompany(loc.companyId, rec);
    await B.markInvoiced(pid, rec, false);
    audit("invoice_voided", rec, "Invoice " + (rec.number || "") + " voided — " + (reason || "no reason given") + ".");
    await emit(pid, "invoice.void", rec, { company: loc.company, reason: reason || "" });
    return { invoice: rec };
  };

  /* Stamp (or release) the invoice lock on every source record the invoice
     consumed. This is what makes a re-run idempotent. */
  B.markInvoiced = async function (pid, inv, on) {
    const invoiceId = on ? inv.id : null;
    for (const l of inv.lines || []) {
      const ids = (l.sources && l.sources.length ? l.sources : [l.sourceId]).filter((x) => x != null);
      if (!ids.length) continue;
      try {
        if (l.source === "time" && ERP.time.markInvoiced) await ERP.time.markInvoiced(pid, ids, invoiceId);
        else if (l.source === "expense" && ERP.expenses.markInvoiced) await ERP.expenses.markInvoiced(pid, ids, invoiceId);
        else if (l.source === "agreement" && ERP.agreements.markChargesInvoiced) await ERP.agreements.markChargesInvoiced(inv.companyId, ids, invoiceId);
        else if (l.source === "project" && ERP.projects && ERP.projects.markMilestonesInvoiced) await ERP.projects.markMilestonesInvoiced(inv.companyId, ids, invoiceId);
      } catch (e) {}
    }
    return { ok: true };
  };

  B.companyBalance = async function (pid, companyId) {
    const invoices = await invoiceEntries(companyId);
    const open = invoices.filter((i) => i.status === "posted" && num(i.balance) > 0.005);
    return { balance: round2(open.reduce((n, i) => n + num(i.balance), 0)), openInvoices: open.length, totalInvoices: invoices.length };
  };

  B.balances = async function (pid) {
    const entries = await ERP.companies.list();
    const rows = [];
    for (const e of entries) {
      const b = await B.companyBalance(pid, e.id);
      if (b.totalInvoices) rows.push(Object.assign({ companyId: e.id, companyName: e.name }, b));
    }
    return rows;
  };

  /* ═══════════════════════════ station ═══════════════════════════
     Five tabs: the invoice register; billing runs (dry-run + review +
     post); payments & credits (delegated to ERP.payments); financial
     reports (delegated to ERP.ar); and billing setup. */

  function blankState() {
    return {
      tab: "invoices", companyId: "", status: "", invoiceId: "",
      periodDate: ui.today(), from: B.defaultPeriod(ui.today()).start, to: B.defaultPeriod(ui.today()).end,
      setupCompanyId: "",
    };
  }

  async function clientOptions() { return ERP.companies.optionList(); }

  async function ensureSelection(state) {
    const companies = await clientOptions();
    if ((!state.companyId || !companies.some((c) => String(c.value) === String(state.companyId))) && companies.length) state.companyId = companies[0].value;
    if ((!state.setupCompanyId || !companies.some((c) => String(c.value) === String(state.setupCompanyId))) && companies.length) state.setupCompanyId = companies[0].value;
    return companies;
  }

  function periodLabel(period) { return period.start + " → " + period.end; }

  /* ── invoices tab ── */

  async function renderInvoices(panel, pid) {
    const state = panel.__host.__bill;
    await ensureSelection(state);
    const list = await B.all(pid, { companyId: state.companyId, status: state.status });
    const canEdit = ERP.security.can("billing.edit");
    const canPost = ERP.security.can("billing.post");
    const all = await B.all(pid, {});
    const open = all.filter((i) => i.status === "posted" && num(i.balance) > 0.005);
    const overdue = open.filter((i) => i.dueDate && ui.diffDays(ui.today(), i.dueDate) < 0);
    const posted = all.filter((i) => i.status === "posted");
    const arTotal = round2(open.reduce((n, i) => n + num(i.balance), 0));

    const rows = list.map((inv) => {
      const acts = [ui.btn("Open", { small: true, act: "iv-open", arg: inv.id })];
      if (canPost && inv.status === "draft") acts.push(ui.btn("Post", { small: true, primary: true, act: "iv-post", arg: inv.id }));
      if (canEdit && B.EDITABLE_STATUSES.indexOf(String(inv.status)) !== -1) acts.push(ui.btn("Delete", { small: true, danger: true, act: "iv-del", arg: inv.id }));
      if (canPost && inv.status === "posted" && num(inv.amountPaid) === 0 && num(inv.credits) === 0) acts.push(ui.btn("Void", { small: true, danger: true, act: "iv-void", arg: inv.id }));
      return {
        number: ui.esc(inv.number || (inv.status === "draft" ? "(draft)" : "—")),
        client: ui.esc(inv.__companyName || ""),
        period: ui.esc(inv.periodStart ? inv.periodStart + " → " + inv.periodEnd : "—"),
        issue: ui.esc(inv.issueDate || ""),
        due: ui.esc(inv.dueDate || "") + (inv.dueDate && inv.status === "posted" && num(inv.balance) > 0.005 && ui.diffDays(ui.today(), inv.dueDate) < 0 ? " " + ui.badge("overdue", "danger") : ""),
        total: maskedMoney(inv.total, inv.currency),
        balance: maskedMoney(inv.balance, inv.currency),
        status: ui.badge(B.statusLabel(inv.status), B.statusTone(inv.status)),
        payment: inv.status === "posted" ? ui.badge(B.paymentStatusLabel(inv.paymentStatus), B.paymentStatusTone(inv.paymentStatus)) : ui.badge("—", "muted"),
        actions: acts.join(" "),
      };
    });

    panel.innerHTML =
      ui.summary([
        { label: "Invoices", value: String(all.length) },
        { label: "Posted", value: String(posted.length) },
        { label: "Open AR", value: maskedMoney(arTotal) },
        { label: "Overdue", value: String(overdue.length) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("iv-client", "Client", [{ value: "", label: "All clients" }].concat(await clientOptions()), state.companyId) +
        ui.select("iv-status", "Status", [{ value: "", label: "Any status" }].concat(B.STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status) +
        '<span class="erp-db-hint">Drafts are assembled from agreements, approved time and expenses</span>' +
        (canEdit ? ui.btn("New invoice", { primary: true, act: "iv-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "number", label: "Number" },
        { key: "client", label: "Client" },
        { key: "period", label: "Period" },
        { key: "issue", label: "Issued" },
        { key: "due", label: "Due" },
        { key: "total", label: "Total", align: "right" },
        { key: "balance", label: "Balance", align: "right" },
        { key: "status", label: "Status" },
        { key: "payment", label: "Payment" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No invoices yet — run billing to assemble drafts from unbilled work." });

    const bind = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("invoices"); }); };
    bind('[name="iv-client"]', "companyId");
    bind('[name="iv-status"]', "status");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "iv-open") return openInvoiceModal(pid, arg, () => renderTab("invoices"));
      if (act === "iv-new") return openInvoiceModal(pid, null, () => renderTab("invoices"));
      if (act === "iv-post") {
        const res = await B.post(pid, arg);
        if (res.error === "blocked") return ERP.toast("Cannot post: " + res.blockers.map((b) => b.message).join(" "), "error");
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Invoice " + (res.invoice.number || "") + " posted.", "success");
        return renderTab("invoices");
      }
      if (act === "iv-void") {
        if (!(await ui.confirm({ title: "Void this invoice?", message: "Its source records are released so they can be re-billed.", danger: true, okLabel: "Void" }))) return;
        const res = await B.void(pid, arg, "Voided from the register");
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Invoice voided.", "success"); return renderTab("invoices");
      }
      if (act === "iv-del") {
        if (!(await ui.confirm({ title: "Delete this invoice?", message: "Only a draft or approved invoice can be deleted.", danger: true, okLabel: "Delete" }))) return;
        const inv = await B.locate(pid, arg);
        if (!inv) return;
        const res = await B.remove(pid, inv.companyId, arg);
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Invoice deleted.", "success"); return renderTab("invoices");
      }
    });
  }

  async function openInvoiceModal(pid, invoiceId, refresh) {
    const canEdit = ERP.security.can("billing.edit");
    const canPost = ERP.security.can("billing.post");
    let companyId = null, inv = null;
    if (invoiceId != null) {
      const loc = await B.locate(pid, invoiceId);
      if (!loc) return;
      inv = loc.invoice; companyId = loc.companyId;
    } else {
      const companies = await clientOptions();
      companyId = companies[0] ? companies[0].value : "";
      if (!companyId) return ERP.toast("Add a client first.", "error");
      const period = B.defaultPeriod(ui.today());
      const asm = await B.assemble(pid, { companyId: companyId, period: period });
      if (!asm || !asm.lines.length) return ERP.toast("Nothing unbilled for this client.", "warn");
      inv = B.newInvoice({
        companyId: companyId, periodKey: period.key, periodStart: period.start, periodEnd: period.end,
        runKey: String(companyId) + ":" + period.key, lines: asm.lines, currency: asm.currency,
        termsDays: asm.config.termDays, pricesIncludeTax: asm.pricesIncludeTax,
        notes: asm.config.notes, footer: asm.config.footer,
      });
    }
    const readiness = inv.id != null ? await B.readiness(pid, companyId, { start: inv.periodStart, end: inv.periodEnd, key: inv.periodKey }) : { blockers: [], warnings: [] };

    const lineRows = (inv.lines || []).map((l) => ({
      source: ui.badge(B.sourceLabel(l.source), l.source === "manual" ? "muted" : "info"),
      description: ui.esc(l.description),
      qty: ui.fmt(l.qty, 2),
      unit: ui.esc(l.unit || ""),
      unitPrice: maskedMoney(l.unitPrice, inv.currency),
      amount: maskedMoney(l.amount, inv.currency),
      trace: '<span class="erp-sub">' + ui.esc((l.sources && l.sources.length ? l.sources : [l.sourceId]).filter((x) => x != null).map((x) => B.sourceLabel(l.source).toLowerCase() + "#" + x).join(", ")) + "</span>",
      action: canEdit && B.EDITABLE_STATUSES.indexOf(String(inv.status)) !== -1 ? ui.btn("Remove", { small: true, danger: true, act: "ivm-rmline", arg: l.lineId }) : "",
    }));

    const fields =
      '<div class="erp-form-row">' +
        ui.text("number", "Invoice number", inv.number || "(auto on save)") +
        ui.dateInput("issueDate", "Issue date", inv.issueDate || ui.today()) +
        ui.dateInput("dueDate", "Due date", inv.dueDate || "") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("currency", "Currency", Object.keys(ui.CURRENCIES), inv.currency || "USD") +
        ui.number("termsDays", "Terms (days)", inv.termsDays, { min: 0, step: 1 }) +
        ui.text("poNumber", "Client PO", inv.poNumber || "") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("period", "Period", inv.periodStart ? inv.periodStart + " → " + inv.periodEnd : "") +
        ui.check("pricesIncludeTax", "Prices include tax", inv.pricesIncludeTax === true) +
      "</div>" +
      ui.textarea("notes", "Notes", inv.notes || "", 2) +
      ui.textarea("footer", "Footer", inv.footer || "", 2);

    const modal = ui.modal({
      title: invoiceId != null ? "Invoice " + (inv.number || "#" + inv.id) : "New invoice",
      size: "lg",
      body:
        (readiness.blockers.length ? ui.alert(readiness.blockers.map((b) => b.message).join(" "), "error") : "") +
        (readiness.warnings.length ? ui.alert(readiness.warnings.map((w) => w.message).join(" "), "warn") : "") +
        (B.isImmutable(inv) ? ui.alert("This invoice is " + B.statusLabel(inv.status).toLowerCase() + " and locked. Changes go through a credit or adjustment.", "info") : "") +
        ui.form(fields) +
        ui.card("Lines",
          ui.table([
            { key: "source", label: "Source" },
            { key: "description", label: "Description" },
            { key: "qty", label: "Qty", align: "right" },
            { key: "unit", label: "Unit" },
            { key: "unitPrice", label: "Rate", align: "right" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "trace", label: "Traceable to" },
            { key: "action", label: "", align: "right" },
          ], lineRows, { emptyText: "No lines yet." })) +
        ui.summary([
          { label: "Subtotal", value: maskedMoney(inv.subtotal, inv.currency) },
          { label: "Tax", value: maskedMoney(inv.taxTotal, inv.currency) },
          { label: "Total", value: maskedMoney(inv.total, inv.currency) },
          { label: "Balance", value: maskedMoney(inv.balance, inv.currency) },
        ]),
      foot:
        ui.btn("Close", { small: true, act: "ivm-cancel" }) + " " +
        (canEdit && B.EDITABLE_STATUSES.indexOf(String(inv.status)) !== -1 ? ui.btn("Add line", { small: true, act: "ivm-addline" }) + " " : "") +
        (canEdit && B.EDITABLE_STATUSES.indexOf(String(inv.status)) !== -1 ? ui.btn("Save", { small: true, primary: true, act: "ivm-save" }) : "") + " " +
        (canPost && inv.status === "draft" && inv.id != null ? ui.btn("Post", { small: true, primary: true, act: "ivm-post" }) : "") + " " +
        (canPost && inv.status === "approved" && inv.id != null ? ui.btn("Post", { small: true, primary: true, act: "ivm-post" }) : ""),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=ivm-cancel]").onclick = () => ui.closeModal();

    const rm = modal.querySelector("[data-act=ivm-rmline]");
    if (rm) ui.bind(modal, "click", "[data-act=ivm-rmline]", async (el) => {
      const res = await B.removeLine(pid, companyId, inv.id, el.getAttribute("data-arg"));
      if (res.error) return ERP.toast(res.message || res.error, "error");
      ui.closeModal(); refresh();
    });
    ui.bind(modal, "click", "[data-act=ivm-addline]", async () => {
      const res = await B.addLine(pid, companyId, inv.id, { source: "manual", description: "Additional charge", qty: 1, unitPrice: 0 });
      if (res.error) return ERP.toast(res.message || res.error, "error");
      ui.closeModal(); refresh();
    });
    ui.bind(modal, "click", "[data-act=ivm-save]", async (btn) => {
      const v = ui.collect(form, ["number", "issueDate", "dueDate", "currency", "termsDays", "poNumber", "pricesIncludeTax", "notes", "footer"]);
      btn.disabled = true;
      const payload = Object.assign({}, inv, {
        companyId: companyId, number: v.number, issueDate: v.issueDate, dueDate: v.dueDate,
        currency: v.currency, termsDays: v.termsDays, poNumber: v.poNumber,
        pricesIncludeTax: v.pricesIncludeTax === true, notes: v.notes, footer: v.footer,
      });
      if (inv.id != null) payload.id = inv.id;
      const res = await B.save(pid, payload);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Invoice saved.", "success"); refresh();
    });
    ui.bind(modal, "click", "[data-act=ivm-post]", async (btn) => {
      btn.disabled = true;
      const saved = await B.save(pid, Object.assign({}, inv, { companyId: companyId, id: inv.id }));
      if (saved.error) { ERP.toast(saved.message || saved.error, "error"); btn.disabled = false; return; }
      const res = await B.post(pid, saved.record.id);
      if (res.error === "blocked") { ERP.toast("Cannot post: " + res.blockers.map((b) => b.message).join(" "), "error"); btn.disabled = false; return; }
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Invoice " + (res.invoice.number || "") + " posted.", "success"); refresh();
    });
  }

  /* ── billing runs tab ── */

  async function renderRuns(panel, pid) {
    const state = panel.__host.__bill;
    await ensureSelection(state);
    const canRun = ERP.security.can("billing.edit");
    const period = B.resolvePeriod({ fromDate: state.from, toDate: state.to });
    const dry = await B.preview(pid, { fromDate: state.from, toDate: state.to, companyId: state.companyId }).catch(() => null);
    const runs = dry ? dry.runs : [];

    const rows = runs.map((r) => ({
      client: ui.esc(r.companyName || ""),
      status: ui.badge(r.status === "draft" ? "Draft ready" : r.status === "existing" ? "Already invoiced" : r.status === "blocked" ? "Blocked" : r.status === "forbidden" ? "Not permitted" : "Nothing to bill",
        r.status === "draft" ? "success" : r.status === "existing" ? "info" : r.status === "blocked" ? "warn" : "muted"),
      total: r.total != null ? maskedMoney(r.total) : "—",
      gates: ((r.readiness && r.readiness.blockers) || []).map((b) => ui.badge(b.message, "danger")).concat(((r.readiness && r.readiness.warnings) || []).map((w) => ui.badge(w.message, "warn"))).join(" ") || '<span class="erp-sub">clear</span>',
    }));

    panel.innerHTML =
      ui.alert("Billing runs assemble drafts from unbilled agreements, approved time and expenses. Nothing posts until you review and post it — and a client already invoiced for this period is flagged, never billed twice.", "info") +
      '<div class="erp-db-toolbar">' +
        ui.select("run-client", "Client", [{ value: "", label: "All clients" }].concat(await clientOptions()), state.companyId) +
        ui.dateInput("run-from", "From", state.from) +
        ui.dateInput("run-to", "To", state.to) +
        '<span class="erp-db-hint">Period ' + ui.esc(periodLabel(period)) + "</span>" +
        (canRun ? ui.btn("Dry run", { act: "run-dry" }) + " " + ui.btn("Generate drafts", { primary: true, act: "run-generate" }) : "") +
      "</div>" +
      ui.summary([
        { label: "Ready to draft", value: String(dry ? dry.totals.draft : 0) },
        { label: "Already invoiced", value: String(dry ? dry.totals.existing : 0) },
        { label: "Blocked", value: String(dry ? dry.totals.blocked : 0) },
        { label: "Proposed value", value: maskedMoney(dry ? dry.totals.total : 0) },
      ]) +
      ui.card("Clients — " + periodLabel(period), ui.table([
        { key: "client", label: "Client" },
        { key: "status", label: "Run" },
        { key: "total", label: "Proposed", align: "right" },
        { key: "gates", label: "Readiness gates" },
      ], rows, { emptyText: "No clients to bill for this period." }));

    const bind = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("runs"); }); };
    bind('[name="run-client"]', "companyId");
    bind('[name="run-from"]', "from");
    bind('[name="run-to"]', "to");

    ui.bind(panel, "click", "[data-act]", async (el, e, act) => {
      if (act === "run-dry") { ERP.toast("Dry run refreshed — nothing was written.", "success"); return renderTab("runs"); }
      if (act === "run-generate") {
        const res = await B.run(pid, { fromDate: state.from, toDate: state.to, companyId: state.companyId });
        ERP.toast(res.totals.draft + " draft(s) created, " + res.totals.existing + " already current, " + res.totals.blocked + " blocked.", res.totals.blocked ? "warn" : "success");
        state.tab = "invoices";
        return renderTab("invoices");
      }
    });
  }

  /* ── setup tab (Task 28) ── */

  async function renderSetup(panel, pid) {
    const state = panel.__host.__bill;
    await ensureSelection(state);
    const canEdit = ERP.security.can("billing.edit");
    const settings = await B.settings(pid);
    const taxOptions = await B.taxOptions();
    const taxes = await B.taxRates();
    const numbering = await B.numbering();
    const config = await B.configFor(pid, state.setupCompanyId);
    const profile = config.profile || B.newCompanyProfile({ companyId: state.setupCompanyId });

    const sourceBadge = (s) => ui.badge(s === "company" ? "client override" : s === "provider" ? "provider default" : "platform default", s === "company" ? "info" : s === "provider" ? "success" : "muted");

    panel.innerHTML =
      ui.alert("Provider defaults govern every client; a client can override any of them. The effective value and the layer that supplied it are shown per client below.", "info") +
      ui.grid([
        ui.card("Provider billing defaults",
          ui.form(
            '<div class="erp-form-row">' +
              ui.number("termDays", "Payment terms (days)", settings.termDays, { min: 0, step: 1 }) +
              ui.select("currency", "Default currency", [{ value: "", label: "(follow client / provider)" }].concat(Object.keys(ui.CURRENCIES).map((c) => ({ value: c, label: c }))), settings.currency) +
            "</div>" +
            '<div class="erp-form-row">' +
              ui.select("defaultTaxCode", "Default tax code", taxOptions, settings.defaultTaxCode) +
              ui.select("invoiceCycle", "Invoice cycle", B.CYCLES.map((c) => ({ value: c.id, label: c.label })), settings.invoiceCycle) +
            "</div>" +
            '<div class="erp-form-row">' +
              ui.number("cycleDay", "Cycle day", settings.cycleDay, { min: 1, step: 1 }) +
              ui.check("pricesIncludeTax", "Prices include tax", settings.pricesIncludeTax === true) +
              ui.check("autoApprove", "Auto-approve generated drafts", settings.autoApprove === true) +
            "</div>" +
            '<div class="erp-form-row">' +
              ui.select("groupBy", "Template grouping", [{ value: "source", label: "One line per source (most traceable)" }, { value: "worktype", label: "Group by work type / category" }, { value: "summary", label: "One summary line per source type" }], settings.template.groupBy) +
              ui.number("dueDays", "Due days override", settings.template.dueDays, { min: 0, step: 1 }) +
            "</div>" +
            ui.textarea("notes", "Invoice notes", settings.template.notes, 2) +
            ui.textarea("footer", "Invoice footer", settings.template.footer, 2),
            canEdit ? ui.btn("Save provider defaults", { small: true, primary: true, act: "setup-save" }) : ""
          )) +
        ui.card("Numbering",
          ui.form(
            '<div class="erp-form-row">' +
              ui.text("prefix", "Invoice prefix", numbering ? (numbering.prefixes && numbering.prefixes.invoice) || "INV" : "INV") +
              ui.number("pad", "Digits", numbering ? numbering.pad : 4, { min: 1, step: 1 }) +
            "</div>" +
            '<div class="erp-rate-hint">The counter never reuses a number, even after a draft is deleted. Next number: ' + ui.esc((numbering && numbering.pattern ? numbering.pattern.replace("{prefix}", (numbering.prefixes && numbering.prefixes.invoice) || "INV").replace("{seq}", String(((numbering.counters && numbering.counters.invoice) || 0) + 1).padStart(numbering.pad || 4, "0")) : "INV-0001")) + "</div>",
            canEdit ? ui.btn("Save numbering", { small: true, primary: true, act: "setup-numbering" }) : ""
          ))
      ], "cols-2") +
      ui.card("Tax codes & rates", ui.table([
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "rate", label: "Rate", align: "right" },
      ], taxes.map((t) => ({ code: ui.esc(t.code), name: ui.esc(t.name), rate: ui.fmt(t.rate, 2) + "%" })), { emptyText: "No tax codes defined." }) +
        (canEdit ? '<div class="erp-btn-row">' + ui.btn("Edit tax rates", { small: true, act: "setup-tax" }) + "</div>" : "")) +
      ui.card("Client override — " + ui.esc((config.company && config.company.name) || ""),
        '<div class="erp-db-toolbar">' +
          ui.select("setup-client", "Client", await clientOptions(), state.setupCompanyId) +
          '<span class="erp-db-hint">Effective terms ' + config.termDays + "d · tax " + ui.esc(config.taxCode) + " · " + ui.esc(config.currency) + " · " + ui.esc(B.cycleLabel(config.invoiceCycle)) + "</span>" +
          (canEdit ? ui.check("overrideEnabled", "Use a client override", profile.overrideEnabled !== false) : "") +
        "</div>" +
        '<div class="erp-summary">' +
          '<div class="erp-summary-item"><span>Terms</span><b>' + config.termDays + "d " + sourceBadge(config.source.termDays) + "</b></div>" +
          '<div class="erp-summary-item"><span>Tax code</span><b>' + ui.esc(config.taxCode) + " " + sourceBadge(config.source.taxCode) + "</b></div>" +
          '<div class="erp-summary-item"><span>Currency</span><b>' + ui.esc(config.currency) + " " + sourceBadge(config.source.currency) + "</b></div>" +
          '<div class="erp-summary-item"><span>Cycle</span><b>' + ui.esc(B.cycleLabel(config.invoiceCycle)) + " " + sourceBadge(config.source.invoiceCycle) + "</b></div>" +
        "</div>" +
        ui.form(
          '<div class="erp-form-row">' +
            ui.number("termDays", "Override terms (days)", profile.termDays, { min: 0, step: 1 }) +
            ui.select("currency", "Override currency", [{ value: "", label: "(inherit)" }].concat(Object.keys(ui.CURRENCIES).map((c) => ({ value: c, label: c }))), profile.currency) +
          "</div>" +
          '<div class="erp-form-row">' +
            ui.select("defaultTaxCode", "Override tax code", [{ value: "", label: "(inherit)" }].concat(taxOptions), profile.defaultTaxCode) +
            ui.select("invoiceCycle", "Override cycle", [{ value: "", label: "(inherit)" }].concat(B.CYCLES.map((c) => ({ value: c.id, label: c.label }))), profile.invoiceCycle) +
          "</div>" +
          '<div class="erp-form-row">' +
            ui.text("poNumber", "Client PO", profile.poNumber) +
            ui.number("dueDays", "Due days", profile.dueDays, { min: 0, step: 1 }) +
          "</div>" +
          ui.textarea("notes", "Invoice notes", profile.notes, 2),
          canEdit ? ui.btn("Save client override", { small: true, primary: true, act: "setup-profile" }) : ""
        ));

    const bind = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("setup"); }); };
    bind('[name="setup-client"]', "setupCompanyId");

    ui.bind(panel, "click", "[data-act]", async (el, e, act) => {
      if (act === "setup-save") {
        const form = panel.querySelector(".erp-card [data-ui-form]");
        const v = ui.collect(form, ["termDays", "currency", "defaultTaxCode", "invoiceCycle", "cycleDay", "pricesIncludeTax", "autoApprove", "groupBy", "dueDays", "notes", "footer"]);
        const res = await B.saveSettings(pid, {
          termDays: v.termDays, currency: v.currency, defaultTaxCode: v.defaultTaxCode, invoiceCycle: v.invoiceCycle,
          cycleDay: v.cycleDay, pricesIncludeTax: v.pricesIncludeTax === true, autoApprove: v.autoApprove === true,
          template: { groupBy: v.groupBy, dueDays: v.dueDays, notes: v.notes, footer: v.footer },
        });
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Provider billing defaults saved.", "success"); return renderTab("setup");
      }
      if (act === "setup-numbering") {
        const cards = panel.querySelectorAll(".erp-card");
        const form = cards[1] ? cards[1].querySelector("[data-ui-form]") : null;
        const v = ui.collect(form, ["prefix", "pad"]);
        const res = await B.saveNumbering({ prefixes: Object.assign({}, (numbering && numbering.prefixes) || {}, { invoice: v.prefix }), pad: v.pad });
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Invoice numbering saved.", "success"); return renderTab("setup");
      }
      if (act === "setup-tax") return openTaxModal(pid, () => renderTab("setup"));
      if (act === "setup-profile") {
        const cards = panel.querySelectorAll(".erp-card");
        const card = cards[3];
        const form = card ? card.querySelector("[data-ui-form]") : null;
        const v = ui.collect(form, ["termDays", "currency", "defaultTaxCode", "invoiceCycle", "poNumber", "dueDays", "notes"]);
        const overrideEl = panel.querySelector('[name="overrideEnabled"]');
        const res = await B.saveCompanyProfile(state.setupCompanyId, {
          overrideEnabled: overrideEl ? overrideEl.checked : true,
          termDays: v.termDays, currency: v.currency, defaultTaxCode: v.defaultTaxCode,
          invoiceCycle: v.invoiceCycle, poNumber: v.poNumber, dueDays: v.dueDays, notes: v.notes,
        });
        if (res.error) return ERP.toast(res.message || res.error, "error");
        ERP.toast("Client billing override saved.", "success"); return renderTab("setup");
      }
    });
  }

  async function openTaxModal(pid, refresh) {
    if (!ERP.security.enforce("billing.edit")) return;
    const taxes = await B.taxRates();
    const body = ui.table([
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "rate", label: "Rate %", align: "right" },
    ], taxes.map((t) => ({ code: ui.esc(t.code), name: ui.esc(t.name), rate: ui.fmt(t.rate, 2) })), { emptyText: "No tax codes." }) +
      ui.form(
        '<div class="erp-form-row">' +
          ui.text("code", "Code", "") + ui.text("name", "Name", "") + ui.number("rate", "Rate %", 0, { min: 0, step: 0.01 }) +
        "</div>",
        ui.btn("Add tax code", { small: true, primary: true, act: "tax-add" })
      );
    const modal = ui.modal({
      title: "Tax codes & rates",
      size: "lg", body: body,
      foot: ui.btn("Close", { small: true, act: "tax-close" }),
    });
    modal.querySelector("[data-act=tax-close]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=tax-add]").onclick = async (btn) => {
      const form = modal.querySelector("[data-ui-form]");
      const v = ui.collect(form, ["code", "name", "rate"]);
      if (!v.code) return ERP.toast("A tax code is required.", "error");
      btn.disabled = true;
      const list = await B.taxRates();
      if (list.some((t) => String(t.code) === String(v.code))) { ERP.toast("That code already exists.", "error"); btn.disabled = false; return; }
      const rec = { id: Math.max(0, ...list.map((t) => num(t.id))) + 1, code: v.code, name: v.name || v.code, rate: num(v.rate), active: true };
      await ERP.master.saveTaxes(list.concat([rec]));
      ui.closeModal(); ERP.toast("Tax code added.", "success"); refresh();
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
    ERP.states.loading(panel, "Loading billing");
    try {
      const pid = await ten().providerId();
      if (id === "invoices") await renderInvoices(panel, pid);
      else if (id === "runs") await renderRuns(panel, pid);
      else if (id === "payments") await (ERP.payments ? ERP.payments.render(panel, pid) : Promise.resolve(ERP.states.empty(panel, { title: "Payments", message: "Payments engine unavailable." })));
      else if (id === "reports") await (ERP.ar ? ERP.ar.render(panel, pid) : Promise.resolve(ERP.states.empty(panel, { title: "Reports", message: "Reporting engine unavailable." })));
      else if (id === "setup") await renderSetup(panel, pid);
    } catch (e) {
      console.error("billing tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }

  B.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "finance", title: "Billing", phase: "Phase 6 · Billing & invoicing",
        message: "Create a service provider and a client company first — then invoice their work here.",
      });
      return;
    }
    try { await B.settings(pid); } catch (e) {}
    host.__bill = host.__bill || blankState();
    currentHost = host;

    const defs = [
      { id: "invoices", label: "Invoices" },
      { id: "runs", label: "Billing runs" },
      { id: "payments", label: "Payments & credits" },
      { id: "reports", label: "Financial reports" },
      { id: "setup", label: "Billing setup" },
    ];
    const active = defs.find((d) => d.id === host.__bill.tab) ? host.__bill.tab : "invoices";

    host.innerHTML = ui.pageHead("Billing", "Invoice assembly, billing runs, payments and financial reporting.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__bill.tab = b.getAttribute("data-tab");
      await renderTab(host.__bill.tab);
    }));
    await renderTab(active);
  };
})();
