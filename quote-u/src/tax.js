// ============================================================================
// quote-u — indicative tax display policy (roadmap task 20)
// ----------------------------------------------------------------------------
// quote-u NEVER asserts an authoritative tax figure. The invoicing/accounting
// system owns the real computation; this module only produces an INDICATIVE
// estimate for the client-facing surfaces so a proposal can show a GST line.
//
//   • the rate is configurable (main.pjs `quoteTaxPolicy` / basis points)
//   • the line is always labelled "indicative" and never "total"
//   • the DTO records which system is authoritative, and carries the disclaimer
//   • the estimate is derived from the shared QU_TOTALS pre-tax totals through
//     QU_MONEY.tax, so every surface shows the same indicative number
//
// It is pure and dependency-light: QU_MONEY is required only when a summary is
// computed, so the policy helpers work even before the money engine loads.
// ============================================================================
window.QU_TAX = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DEFAULT_RATE_BP = 500;            // 5% GST
  const DEFAULT_LABEL = "GST";
  const MAX_RATE_BP = 100000;             // a sanity ceiling (1000%), not a tax rule
  const AUTHORITATIVE_SYSTEM = "invoicing/accounting system";
  const DEFAULT_DISCLAIMER = "Tax is shown as an indicative estimate only. The invoicing/accounting system computes the authoritative tax on the final invoice.";

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizeRateBp(value) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_RATE_BP) return DEFAULT_RATE_BP;
    return n;
  }

  // → { rate_bp, label, disclaimer, show }. Junk falls back to the defaults.
  // Accepts both the config spelling (gst_rate_bp/gst_label) and its own output
  // (rate_bp/label), so a normalized policy can be re-normalized safely.
  function normalizePolicy(input) {
    const p = Object.assign({}, isPlainObject(input) ? input : {});
    const rawRate = p.gst_rate_bp === undefined ? p.rate_bp : p.gst_rate_bp;
    const rawLabel = p.gst_label === undefined ? p.label : p.gst_label;
    return {
      rate_bp: normalizeRateBp(rawRate),
      label: rawLabel === undefined || rawLabel === null ? DEFAULT_LABEL : String(rawLabel),
      disclaimer: p.disclaimer === undefined || p.disclaimer === null ? DEFAULT_DISCLAIMER : String(p.disclaimer),
      show: p.show !== false
    };
  }

  function defaultPolicy() {
    const cfg = (typeof window !== "undefined" && window.root && window.root.quoteTaxPolicy) || null;
    return normalizePolicy(cfg);
  }

  // Basis points → a percent label: 500 → "5%", 525 → "5.25%", 0 → "0%".
  function percentLabel(rateBp) {
    const bp = normalizeRateBp(rateBp);
    const whole = Math.floor(bp / 100);
    const frac = bp % 100;
    if (frac === 0) return whole + "%";
    return (bp / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "%";
  }

  function lineLabel(policy) {
    const p = normalizePolicy(policy);
    return p.label + " (indicative, " + percentLabel(p.rate_bp) + ")";
  }

  function taxOf(cents, rateBp) {
    const M = window.QU_MONEY;
    if (!M || typeof M.tax !== "function") return 0;
    return M.tax(cents, rateBp);
  }

  // The indicative-estimate DTO derived from a QU_TOTALS result (pre-tax
  // totals). `indicative: true` and the disclaimer make the non-authoritative
  // nature explicit; `authoritative_system` names who owns the real figure.
  function summary(totals, policy) {
    if (!totals) return null;
    const p = normalizePolicy(policy);
    const rate = p.rate_bp;
    return {
      indicative: true,
      label: p.label,
      line_label: lineLabel(p),
      rate_bp: rate,
      rate_percent: percentLabel(rate),
      one_time_cents: taxOf(totals.one_time_cents, rate),
      mrr_cents: taxOf(totals.mrr_cents, rate),
      twelve_month_value_cents: taxOf(totals.twelve_month_value_cents, rate),
      deal_value_cents: taxOf(totals.deal_value_cents, rate),
      authoritative_system: AUTHORITATIVE_SYSTEM,
      disclaimer: p.disclaimer
    };
  }

  return {
    VERSION,
    DEFAULT_RATE_BP,
    DEFAULT_LABEL,
    MAX_RATE_BP,
    AUTHORITATIVE_SYSTEM,
    DEFAULT_DISCLAIMER,
    normalizeRateBp,
    normalizePolicy,
    defaultPolicy,
    percentLabel,
    lineLabel,
    summary
  };
})();
