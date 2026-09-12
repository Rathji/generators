/* ============================================================================
   PSA-U — data-integrity linter (Phase 12 · Task 56)

   A PSA accumulates quiet inconsistencies over months of use: a ticket nobody
   ever assigned, an agreement still covering a device that was retired,
   billable time that was approved but never invoiced, an invoice posted with no
   source lines, a company with no billing terms. None of these break a single
   screen, but together they rot the books. The linter audits for them and
   reports each one **with the offending record**.

     • CHECKS   — a registry of independent audits, each declaring an id, a
                  label and a severity (error / warn / info). Checks never
                  write; a failed check is reported, not thrown, so one broken
                  audit cannot hide the rest.
     • lint()   — runs every check (or a named subset), returning the findings
                  grouped by check with totals, plus a flat list ready for a
                  table or an export.
     • summary()— the cheap counts, for a badge or a dashboard tile.

   The Admin "Data integrity" tab renders the report with a severity filter and
   the offending record on every row.
   ============================================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const I = (ERP.integrity = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("integrity requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function daysSince(iso) { if (!iso) return 0; const t = Date.parse(iso); return isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : 0; }

  I.SEVERITIES = [
    { id: "error", label: "Error", tone: "danger" },
    { id: "warn", label: "Warning", tone: "warn" },
    { id: "info", label: "Info", tone: "info" },
  ];
  I.severityMeta = (id) => I.SEVERITIES.find((s) => s.id === id) || { id: id, label: id, tone: "muted" };

  function finding(check, severity, message, ref) {
    return { check: check, severity: severity, message: message, ref: ref || {} };
  }

  /* ─────────────────────────── the checks ─────────────────────────── */

  I.CHECKS = [
    {
      id: "tickets.unassigned", label: "Open tickets with no owner", severity: "warn",
      run: async (pid) => {
        const open = await ERP.tickets.listAll({ open: true });
        return open.filter((t) => t.ownerId == null || t.ownerId === "").map((t) =>
          finding("tickets.unassigned", "warn", "Open ticket " + t.number + " has no owner.", { kind: "ticket", id: t.id, label: t.number + " — " + t.summary, companyId: t.companyId }));
      },
    },
    {
      id: "tickets.stale", label: "Open tickets untouched for a long time", severity: "info",
      run: async (pid, opts) => {
        const limit = opts.staleDays || 30;
        const open = await ERP.tickets.listAll({ open: true });
        return open.filter((t) => daysSince(t.updatedAt || t.createdAt) > limit).map((t) =>
          finding("tickets.stale", "info", "Ticket " + t.number + " has been open " + daysSince(t.createdAt) + " days with no update for " + daysSince(t.updatedAt || t.createdAt) + ".", { kind: "ticket", id: t.id, label: t.number + " — " + t.summary, companyId: t.companyId }));
      },
    },
    {
      id: "tickets.orphan", label: "Tickets whose client no longer exists", severity: "error",
      run: async (pid) => {
        const [tickets, companies] = await Promise.all([ERP.tickets.listAll({}), ERP.companies.list()]);
        const ids = companies.map((c) => String(c.id));
        return tickets.filter((t) => t.companyId != null && ids.indexOf(String(t.companyId)) === -1).map((t) =>
          finding("tickets.orphan", "error", "Ticket " + t.number + " references a missing client (" + t.companyId + ").", { kind: "ticket", id: t.id, label: t.number + " — " + t.summary, companyId: t.companyId }));
      },
    },
    {
      id: "agreements.orphan_devices", label: "Agreements covering devices that no longer exist", severity: "warn",
      run: async (pid) => {
        const agreements = await ERP.agreements.list(pid);
        const out = [];
        for (const a of agreements) {
          if (String(a.status) === "terminated" || String(a.status) === "cancelled") continue;
          let warns = { missing: [] };
          try { warns = await ERP.agreements.coverageWarnings(a.companyId, a); } catch (e) {}
          for (const m of warns.missing || []) {
            out.push(finding("agreements.orphan_devices", "warn", "Agreement " + (a.number || a.id) + " covers a device that is not in the client's configuration records (" + (m.name || m.refId) + ").", { kind: "agreement", id: a.id, label: a.number + " — " + (a.name || ""), companyId: a.companyId }));
          }
        }
        return out;
      },
    },
    {
      id: "agreements.active_expired", label: "Agreements active past their end date", severity: "warn",
      run: async (pid) => {
        const agreements = await ERP.agreements.list(pid);
        const today = ui.today();
        return agreements.filter((a) => String(a.status) === "active" && a.endDate && a.endDate < today).map((a) =>
          finding("agreements.active_expired", "warn", "Agreement " + (a.number || a.id) + " is still active but ended on " + a.endDate + ".", { kind: "agreement", id: a.id, label: a.number + " — " + (a.name || ""), companyId: a.companyId }));
      },
    },
    {
      id: "time.uninvoiced", label: "Approved billable time never invoiced", severity: "warn",
      run: async (pid, opts) => {
        const limit = opts.uninvoicedDays || 45;
        const list = await ERP.time.uninvoiced(pid, {});
        return list.filter((e) => daysSince(e.date) > limit).map((e) =>
          finding("time.uninvoiced", "warn", "Billable time of " + ERP.time.minutesLabel(e.minutes) + " on " + e.date + " is approved but has never been invoiced.", { kind: "timeEntry", id: e.id, label: (ERP.time.minutesLabel ? ERP.time.minutesLabel(e.minutes) : e.minutes) + " · " + e.date, companyId: e.companyId }));
      },
    },
    {
      id: "invoices.no_sources", label: "Posted invoices with no source lines", severity: "error",
      run: async (pid) => {
        const invoices = await ERP.billing.all(pid);
        return invoices.filter((inv) => String(inv.status) === "posted" && !(inv.lines || []).length).map((inv) =>
          finding("invoices.no_sources", "error", "Invoice " + (inv.number || inv.id) + " is posted with no source lines.", { kind: "invoice", id: inv.id, label: inv.number, companyId: inv.companyId }));
      },
    },
    {
      id: "invoices.overpaid", label: "Invoices with a negative balance", severity: "error",
      run: async (pid) => {
        const invoices = await ERP.billing.all(pid);
        return invoices.filter((inv) => num(inv.balance) < -0.01).map((inv) =>
          finding("invoices.overpaid", "error", "Invoice " + (inv.number || inv.id) + " is overpaid by " + ui.money(Math.abs(num(inv.balance)), inv.currency) + ".", { kind: "invoice", id: inv.id, label: inv.number, companyId: inv.companyId }));
      },
    },
    {
      id: "sla.dangling_reference", label: "SLA policies referencing missing records", severity: "error",
      run: async (pid) => {
        const policies = await ERP.sla.policies(pid);
        const [calendars, statuses, boards, priorities] = await Promise.all([
          ERP.members.calendars(), ERP.taxonomy.list(pid, "ticketStatus"),
          ERP.taxonomy.list(pid, "serviceBoard"), ERP.taxonomy.list(pid, "priority"),
        ]);
        const has = (list, code) => list.some((r) => String(r.code) === String(code));
        const out = [];
        for (const p of policies) {
          if (p.calendarId != null && p.calendarId !== "" && !calendars.some((c) => String(c.id) === String(p.calendarId))) {
            out.push(finding("sla.dangling_reference", "error", "SLA policy \"" + p.name + "\" references a missing business-hours calendar.", { kind: "slaPolicy", id: p.id, label: p.name, companyId: null }));
          }
          if (p.board && p.board !== "*" && !has(boards, p.board)) {
            out.push(finding("sla.dangling_reference", "error", "SLA policy \"" + p.name + "\" references a missing board (" + p.board + ").", { kind: "slaPolicy", id: p.id, label: p.name, companyId: null }));
          }
          if (p.priority && p.priority !== "*" && !has(priorities, p.priority)) {
            out.push(finding("sla.dangling_reference", "error", "SLA policy \"" + p.name + "\" references a missing priority (" + p.priority + ").", { kind: "slaPolicy", id: p.id, label: p.name, companyId: null }));
          }
        }
        return out;
      },
    },
    {
      id: "taxonomy.no_closed_status", label: "No closed ticket status configured", severity: "error",
      run: async (pid) => {
        const statuses = await ERP.taxonomy.list(pid, "ticketStatus");
        if (statuses.some((s) => s.closed === true)) return [];
        return [finding("taxonomy.no_closed_status", "error", "No ticket status is marked as closed, so tickets can never resolve.", { kind: "taxonomy", id: null, label: "ticketStatus", companyId: null })];
      },
    },
    {
      id: "companies.no_billing_terms", label: "Clients missing billing terms", severity: "warn",
      run: async (pid) => {
        const companies = await ERP.companies.list();
        const out = [];
        for (const entry of companies) {
          let co = entry;
          try { co = (await ERP.companies.get(entry.id)) || entry; } catch (e) {}
          if (!co.billingTerm) out.push(finding("companies.no_billing_terms", "warn", "Client \"" + entry.name + "\" has no billing terms set.", { kind: "company", id: entry.id, label: entry.name, companyId: entry.id }));
        }
        return out;
      },
    },
    {
      id: "configurations.duplicate_serial", label: "Duplicate device serial numbers", severity: "warn",
      run: async (pid) => {
        const companies = await ERP.companies.list();
        const out = [];
        for (const entry of companies) {
          let records = [];
          try { records = await ERP.configurations.allItems(pid, { companyId: entry.id }); } catch (e) { records = []; }
          const seen = {};
          for (const r of records) {
            const serial = (r.serial || "").trim();
            if (!serial) continue;
            if (seen[serial]) out.push(finding("configurations.duplicate_serial", "warn", "Device serial \"" + serial + "\" appears more than once for " + entry.name + ".", { kind: "configuration", id: r.id, label: r.name || serial, companyId: entry.id }));
            else seen[serial] = r.id;
          }
        }
        return out;
      },
    },
  ];

  I.checkIds = () => I.CHECKS.map((c) => c.id);
  I.check = (id) => I.CHECKS.find((c) => c.id === id) || null;

  /* Run the linter. Returns the findings grouped by check plus a flat list. */
  I.lint = async function (pid, opts) {
    opts = opts || {};
    if (!ERP.security.can("integrity.view")) return { error: "forbidden" };
    const checks = opts.checks && opts.checks.length ? I.CHECKS.filter((c) => opts.checks.indexOf(c.id) !== -1) : I.CHECKS;
    const reports = [];
    const findings = [];
    for (const c of checks) {
      let found = [], err = null;
      try { found = (await c.run(pid, opts)) || []; }
      catch (e) { err = (e && e.message) || String(e); }
      reports.push({ id: c.id, label: c.label, severity: c.severity, count: found.length, error: err });
      findings.push.apply(findings, found);
    }
    const totals = { error: 0, warn: 0, info: 0, total: findings.length };
    findings.forEach((f) => { totals[f.severity] = (totals[f.severity] || 0) + 1; });
    return { ranAt: nowIso(), providerId: pid, checks: reports, findings: findings, totals: totals };
  };

  /* Cheap counts without the full record detail, for a badge or tile. */
  I.summary = async function (pid, opts) {
    const r = await I.lint(pid, opts);
    if (r.error) return r;
    return { ranAt: r.ranAt, totals: r.totals, byCheck: r.checks.map((c) => ({ id: c.id, label: c.label, severity: c.severity, count: c.count })) };
  };

  /* ─────────────────────────── the Admin panel ─────────────────────────── */

  async function renderInto(panel, refresh) {
    const pid = await ten().providerId();
    if (pid == null) { ERP.states.empty(panel, { title: "No service provider yet", message: "Create your practice first." }); return; }
    const state = panel.__intState || (panel.__intState = { severity: "all" });
    ERP.states.loading(panel, "Running the integrity audit");
    const report = await I.lint(pid, state.opts || {});
    if (report.error) { panel.innerHTML = ui.alert("Your role cannot view the integrity report.", "warn"); return; }

    const sev = state.severity || "all";
    const rows = report.findings.filter((f) => sev === "all" || f.severity === sev).map((f) => ({
      severity: ui.badge(I.severityMeta(f.severity).label, I.severityMeta(f.severity).tone),
      check: ui.esc(I.check(f.check) ? I.check(f.check).label : f.check),
      record: ui.esc(f.ref.label || (f.ref.kind ? f.ref.kind + " #" + f.ref.id : "—")) + (f.ref.companyId ? '<span class="erp-sub"> client #' + ui.esc(String(f.ref.companyId)) + "</span>" : ""),
      detail: ui.esc(f.message),
    }));

    const checkRows = report.checks.map((c) => ({
      check: ui.esc(c.label),
      severity: ui.badge(I.severityMeta(c.severity).label, I.severityMeta(c.severity).tone),
      count: c.error ? "check failed" : String(c.count),
      state: c.error ? ui.badge("failed", "danger") : (c.count ? ui.badge("findings", "warn") : ui.badge("clean", "success")),
    }));

    panel.innerHTML =
      ui.pageHead("Data integrity", "Audit for the quiet failures a PSA accumulates over time.", "") +
      '<div class="erp-toolbar">' +
        ui.btn("Run audit", { act: "int-run", primary: true, small: true }) +
        ui.select("int-sev", "Severity", [{ value: "all", label: "All" }, { value: "error", label: "Errors" }, { value: "warn", label: "Warnings" }, { value: "info", label: "Info" }], sev) +
      "</div>" +
      ui.grid([
        ui.statCard({ label: "Errors", value: String(report.totals.error), tone: report.totals.error ? "danger" : "ok" }),
        ui.statCard({ label: "Warnings", value: String(report.totals.warn), tone: report.totals.warn ? "warn" : "ok" }),
        ui.statCard({ label: "Info", value: String(report.totals.info), tone: "info" }),
        ui.statCard({ label: "Checks run", value: String(report.checks.length), sub: ui.esc(ui.dateTime(report.ranAt)) }),
      ], "erp-kpi-grid") +
      ui.card("Findings", ui.table([
        { key: "severity", label: "Severity" }, { key: "check", label: "Check" },
        { key: "record", label: "Offending record" }, { key: "detail", label: "Detail" },
      ], rows, { emptyText: sev === "all" ? "Clean — no integrity problems found." : "Nothing at this severity." })) +
      ui.card("Checks", ui.table([
        { key: "check", label: "Check" }, { key: "severity", label: "Severity" },
        { key: "count", label: "Findings", align: "right" }, { key: "state", label: "State" },
      ], checkRows, { emptyText: "No checks." }));

    if (!panel.__intBound) {
      panel.__intBound = true;
      ui.bind(panel, "click", "[data-act=int-run]", async () => {
        state.opts = {};
        renderInto(panel, refresh);
      });
      ui.bind(panel, "change", '[name="int-sev"]', (el) => {
        state.severity = el.value;
        renderInto(panel, refresh);
      });
    }
  }

  I.renderPanel = function (panel, refresh) {
    renderInto(panel, refresh).catch((e) => {
      console.error("integrity tab failed", e);
      ERP.states.error(panel, { title: "Data integrity hit a problem", message: (e && e.message) || "Unexpected error." });
    });
    return panel;
  };
})();
