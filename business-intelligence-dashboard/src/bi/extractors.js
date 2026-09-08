/* ============================================================
   BI metric extractors — one per bundle type. Each turns a
   validated bundle's payload into uniform fact records
     { tool, bundleType, period, dimension, measure, value }
   where `period` is an ISO day ("2026-09-30"), `dimension` is
   "" (a pure period total) or "name:value" (a breakdown cell),
   and `measure` is a metric id from the catalog.

   A query never mixes dimension kinds: a report either groups a
   "" dimension (period totals) or a single named dimension
   ("stage", "owner", "project", ...), so nothing is double-counted.

   Adding a metric for a new tool = adding a catalog entry + this
   extractor — configuration, not plumbing.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const F = (tool, bundleType, period, dimension, measure, value) =>
    ({ tool, bundleType, period, dimension, measure, value });
  const monthP = (m) => m + "-01";
  const asOfP = (bundle) => (bundle.asOf || bundle.publishedAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);

  const extractors = {
    /* -------------------- the-ledger / ledger -------------------- */
    ledger: {
      schema: 1,
      extract(bundle) {
        const d = bundle.data;
        const facts = [];
        const errors = [];
        if (!d || !Array.isArray(d.months) || !Array.isArray(d.revenue) || !Array.isArray(d.expenses)) {
          return { facts, errors: ["ledger: missing months/revenue/expenses arrays"] };
        }
        for (let i = 0; i < d.months.length; i++) {
          const p = monthP(d.months[i]);
          if (d.revenue[i] != null) facts.push(F("the-ledger", "ledger", p, "", "revenue", Number(d.revenue[i])));
          if (d.expenses[i] != null) facts.push(F("the-ledger", "ledger", p, "", "expenses", Number(d.expenses[i])));
          if (d.cash && d.cash[i] != null) facts.push(F("the-ledger", "ledger", p, "", "cash", Number(d.cash[i])));
        }
        if (d.grossProfit == null && d.pAndL && d.pAndL.grossProfitTotal != null) d.grossProfit = d.pAndL.grossProfitTotal;
        const ap = asOfP(bundle);
        if (d.grossProfit != null) facts.push(F("the-ledger", "ledger", ap, "", "grossProfit", Number(d.grossProfit)));
        if (d.pAndL && d.pAndL.operatingExpenses != null) facts.push(F("the-ledger", "ledger", ap, "", "operatingExpenses", Number(d.pAndL.operatingExpenses)));
        if (d.pAndL && d.pAndL.netProfit != null) facts.push(F("the-ledger", "ledger", ap, "", "netProfit", Number(d.pAndL.netProfit)));
        for (const b of Array.isArray(d.receivables) ? d.receivables : []) {
          if (b && b.bucket != null && b.amount != null) facts.push(F("the-ledger", "ledger", ap, "bucket:" + b.bucket, "receivables", Number(b.amount)));
        }
        const recTotal = (Array.isArray(d.receivables) ? d.receivables : []).reduce((s, b) => s + (Number(b && b.amount) || 0), 0);
        if (recTotal) facts.push(F("the-ledger", "ledger", ap, "", "receivables", recTotal));
        for (const b of Array.isArray(d.payables) ? d.payables : []) {
          if (b && b.bucket != null && b.amount != null) facts.push(F("the-ledger", "ledger", ap, "bucket:" + b.bucket, "payables", Number(b.amount)));
        }
        const payTotal = (Array.isArray(d.payables) ? d.payables : []).reduce((s, b) => s + (Number(b && b.amount) || 0), 0);
        if (payTotal) facts.push(F("the-ledger", "ledger", ap, "", "payables", payTotal));
        return { facts, errors };
      },
    },

    /* -------------------- crm / crm -------------------- */
    crm: {
      schema: 1,
      extract(bundle) {
        const d = bundle.data;
        const facts = [];
        const errors = [];
        const probs = {};
        for (const s of Array.isArray(d.stages) ? d.stages : []) probs[s.stage || s] = s.prob != null ? s.prob : 0.3;
        for (const deal of Array.isArray(d.pipeline) ? d.pipeline : []) {
          const p = monthP(deal.closeMonth || bundle.asOf);
          const amount = Number(deal.amount) || 0;
          const prob = probs[deal.stage] != null ? probs[deal.stage] : 0.3;
          facts.push(F("crm", "crm", p, "", "pipelineValue", amount));
          if (deal.stage) facts.push(F("crm", "crm", p, "stage:" + deal.stage, "pipelineValue", amount));
          if (deal.owner) facts.push(F("crm", "crm", p, "owner:" + deal.owner, "pipelineValue", amount));
          facts.push(F("crm", "crm", p, "", "weightedForecast", amount * prob));
          if (deal.stage) facts.push(F("crm", "crm", p, "stage:" + deal.stage, "weightedForecast", amount * prob));
        }
        for (const w of Array.isArray(d.won) ? d.won : []) {
          const p = monthP(w.closeMonth || bundle.asOf);
          if (w.owner) facts.push(F("crm", "crm", p, "owner:" + w.owner, "wins", 1));
          if (w.customer) facts.push(F("crm", "crm", p, "customer:" + w.customer, "wins", 1));
          if (w.revenue != null) {
            facts.push(F("crm", "crm", p, "", "revenue", Number(w.revenue)));
            if (w.customer) facts.push(F("crm", "crm", p, "customer:" + w.customer, "revenue", Number(w.revenue)));
          }
        }
        for (const l of Array.isArray(d.lost) ? d.lost : []) {
          const p = monthP(l.closeMonth || bundle.asOf);
          if (l.owner) facts.push(F("crm", "crm", p, "owner:" + l.owner, "losses", 1));
        }
        for (const a of Array.isArray(d.activities) ? d.activities : []) {
          if (a.owner) facts.push(F("crm", "crm", monthP(a.month), "owner:" + a.owner, "activities", Number(a.count) || 0));
        }
        return { facts, errors };
      },
    },

    /* -------------------- psa / psa -------------------- */
    psa: {
      schema: 1,
      extract(bundle) {
        const d = bundle.data;
        const facts = [];
        const errors = [];
        for (const pr of Array.isArray(d.projects) ? d.projects : []) {
          const dim = "project:" + (pr.name || pr.id);
          if (pr.budgetVsActual != null) facts.push(F("psa", "psa", bundle.asOf, dim, "budgetVsActual", Number(pr.budgetVsActual)));
          if (pr.unbilledHours != null) facts.push(F("psa", "psa", bundle.asOf, dim, "unbilledHours", Number(pr.unbilledHours)));
          if (pr.margin != null) facts.push(F("psa", "psa", bundle.asOf, dim, "projectMargin", Number(pr.margin) * 100));
        }
        const utilByMonth = new Map();
        for (const u of Array.isArray(d.utilization) ? d.utilization : []) {
          if (!u.person) continue;
          const v = Number(u.pct) * 100;
          facts.push(F("psa", "psa", monthP(u.month), "person:" + u.person, "utilization", v));
          if (!utilByMonth.has(u.month)) utilByMonth.set(u.month, []);
          utilByMonth.get(u.month).push(v);
        }
        for (const [m, vals] of utilByMonth) {
          facts.push(F("psa", "psa", monthP(m), "", "utilization", vals.reduce((a, b) => a + b, 0) / vals.length));
        }
        return { facts, errors };
      },
    },

    /* -------------------- project-master / projects -------------------- */
    projects: {
      schema: 1,
      extract(bundle) {
        const d = bundle.data;
        const facts = [];
        const errors = [];
        for (const pr of Array.isArray(d.projects) ? d.projects : []) {
          const dim = "project:" + (pr.name || pr.id);
          if (pr.milestonesComplete != null) facts.push(F("project-master", "projects", bundle.asOf, dim, "milestonesCompleted", Number(pr.milestonesComplete)));
          if (pr.openWorkload != null) facts.push(F("project-master", "projects", bundle.asOf, dim, "openWorkload", Number(pr.openWorkload)));
          if (pr.status === "at-risk") {
            facts.push(F("project-master", "projects", bundle.asOf, dim, "atRiskProjects", 1));
            facts.push(F("project-master", "projects", bundle.asOf, "", "atRiskProjects", 1));
          }
          if (pr.openWorkload != null && pr.status) facts.push(F("project-master", "projects", bundle.asOf, "status:" + pr.status, "openWorkload", Number(pr.openWorkload)));
        }
        for (const w of Array.isArray(d.workload) ? d.workload : []) {
          if (w.status && w.count != null) facts.push(F("project-master", "projects", bundle.asOf, "status:" + w.status, "openWorkload", Number(w.count)));
        }
        return { facts, errors };
      },
    },

    /* -------------------- erp / erp -------------------- */
    erp: {
      schema: 1,
      extract(bundle) {
        const d = bundle.data;
        const facts = [];
        const errors = [];
        for (const it of Array.isArray(d.items) ? d.items : []) {
          if (it.onHand != null && it.reorderPoint != null && Number(it.onHand) < Number(it.reorderPoint)) {
            facts.push(F("erp", "erp", bundle.asOf, "item:" + (it.name || it.sku), "inventoryLow", 1));
            facts.push(F("erp", "erp", bundle.asOf, "", "inventoryLow", 1));
          }
        }
        for (const s of Array.isArray(d.purchaseSpend) ? d.purchaseSpend : []) {
          if (s.amount != null) facts.push(F("erp", "erp", monthP(s.month), "", "purchaseSpend", Number(s.amount)));
        }
        return { facts, errors };
      },
    },

    /* -------------------- kb-sop / kb -------------------- */
    kb: {
      schema: 1,
      extract(bundle) {
        const d = bundle.data;
        const facts = [];
        const errors = [];
        const asOf = new Date(bundle.asOf + "T00:00:00Z").getTime();
        for (const a of Array.isArray(d.articles) ? d.articles : []) {
          if (!a.category) continue;
          facts.push(F("kb-sop", "kb", bundle.asOf, "category:" + a.category, "articleCount", 1));
          const reviewed = a.lastReviewed ? new Date(a.lastReviewed + "T00:00:00Z").getTime() : null;
          const staleAfter = (a.staleDays != null ? Number(a.staleDays) : 180) * 86400000;
          if (reviewed && asOf - reviewed > staleAfter) {
            facts.push(F("kb-sop", "kb", bundle.asOf, "category:" + a.category, "staleCount", 1));
            facts.push(F("kb-sop", "kb", bundle.asOf, "", "staleCount", 1));
          }
        }
        return { facts, errors };
      },
    },

    /* -------------------- idea-incubator / ideas -------------------- */
    ideas: {
      schema: 1,
      extract(bundle) {
        const d = bundle.data;
        const facts = [];
        const errors = [];
        for (const id of Array.isArray(d.ideas) ? d.ideas : []) {
          if (id.stage) facts.push(F("idea-incubator", "ideas", bundle.asOf, "stage:" + id.stage, "ideaCount", 1));
          if (id.month) facts.push(F("idea-incubator", "ideas", monthP(id.month), "", "ideaCount", 1));
        }
        return { facts, errors };
      },
    },
  };

  BI.extractors = {
    all: extractors,
    get(type) { return extractors[type] || null; },
    has(type) { return !!extractors[type]; },
    maxSchema() { return 1; },
    extract(bundle) {
      const ex = extractors[bundle.bundleType];
      if (!ex) return { ok: false, error: { code: "no_extractor", message: "No metric extractor is registered for bundle type '" + bundle.bundleType + "'." } };
      if (bundle.schemaVersion != null && bundle.schemaVersion > ex.schema) {
        return { ok: false, error: { code: "unsupported_schema", message: "Bundle schema v" + bundle.schemaVersion + " is newer than this BI understands (v" + ex.schema + "). Update the extractor." } };
      }
      const gap = bundle.schemaVersion != null && bundle.schemaVersion < ex.schema;
      try {
        const r = ex.extract(bundle);
        return { ok: true, facts: r.facts, errors: r.errors || [], gap };
      } catch (e) {
        return { ok: false, error: { code: "extractor_failed", message: "The '" + bundle.bundleType + "' extractor failed on this bundle: " + (e && e.message ? e.message : e) } };
      }
    },
  };
})();
