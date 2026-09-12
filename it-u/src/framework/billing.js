// src/framework/billing.js — the reseller commercial model, usage and
// data-cap documentation for resold circuits (roadmap task 43).
//
// Tasks 40–42 modelled the resold circuit, its provisioning runbook and its
// addressing/firewall handover. Task 43 is the MONEY half: a resold circuit is
// bought wholesale and sold on, so the documentation must record the commercial
// arrangement — what it costs upstream versus what it is sold for, the billing
// cycle and how part-periods are prorated, any data cap/quota and how overage
// is treated, and where the usage figures come from — and it must reconcile the
// plan that was SOLD against the consumption and cost that actually occurred.
//
// This module is the shared vocabulary and the pure helpers behind that:
//   • the catalogs — billing cycles, proration policies, data-cap periods,
//     overage treatments and usage-monitoring sources;
//   • `parseUsageReadings` / `circuitUsage` — the per-period usage/cost history
//     a technician pastes from the carrier portal or a monitoring platform;
//   • `billingProfile(record)` — the normalised commercial picture (cost, sell,
//     margin, cycle, cap, overage), including per-cycle and annualised figures;
//   • `usageReconciliation(record)` — the reconciliation view that flags a
//     circuit whose consumption or cost has drifted from the sold plan; and
//   • `clientBillingSummary(set)` / `billingIssues(set)` — the per-client
//     rollup and the completeness audit the Linter folds in.
//
// Like ./circuit.js and ./addressing.js this module is PURE (no storage): the
// template (./assetLibrary.js) carries the fields, ./standardized.js runs the
// audit and ./modules/deployments.js renders it.

import { assetFieldsOf } from "./flexible.js";
import { circuitPricing, circuitContract, circuitProfile, WAN_CIRCUIT_TYPE_ID } from "./circuit.js";

const str = (v) => String(v == null ? "" : v).trim();
const blank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const round = (n) => Math.round(n * 100) / 100;
const numOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const fieldsOf = (record) => (record ? assetFieldsOf(record) : {});

// ---- billing cycles --------------------------------------------------------
// How often the reseller invoices the circuit. `months` normalises a per-month
// price to the amount invoiced per cycle.
export const BILLING_CYCLES = [
  { id: "monthly", label: "Monthly", months: 1, description: "Invoiced every month." },
  { id: "quarterly", label: "Quarterly", months: 3, description: "Invoiced every three months." },
  { id: "annual", label: "Annual", months: 12, description: "Invoiced once a year, often in advance." },
  { id: "other", label: "Other", months: null, description: "Any other invoicing cadence — record the detail in the notes." },
];

export const BILLING_CYCLE_IDS = BILLING_CYCLES.map((c) => c.id);
export const billingCycle = (id) => BILLING_CYCLES.find((c) => c.id === id) || null;
export const billingCycleLabel = (id) => (billingCycle(id) || {}).label || "";
export const billingCycleOptions = () => BILLING_CYCLES.map((c) => ({ id: c.id, label: c.label }));

// ---- proration -------------------------------------------------------------
// How a part-period (the first/last invoice of a term) is charged.
export const PRORATION_POLICIES = [
  { id: "actual-days", label: "Actual days", description: "Prorate by the actual number of days in the month." },
  { id: "thirty-day", label: "30-day month", description: "Prorate using a flat 30-day month." },
  { id: "full-period", label: "Full period", description: "The whole period is charged from the start — no proration." },
  { id: "none", label: "None", description: "The carrier does not part-charge; the first invoice is a full period." },
];

export const PRORATION_POLICY_IDS = PRORATION_POLICIES.map((p) => p.id);
export const prorationPolicy = (id) => PRORATION_POLICIES.find((p) => p.id === id) || null;
export const prorationPolicyLabel = (id) => (prorationPolicy(id) || {}).label || "";
export const prorationPolicyOptions = () => PRORATION_POLICIES.map((p) => ({ id: p.id, label: p.label }));

// ---- data caps / quotas ----------------------------------------------------
// The period a usage cap applies to. `months` converts the cap to a monthly
// allowance so circuits with different cap periods can be compared.
export const DATA_CAP_PERIODS = [
  { id: "monthly", label: "Monthly", months: 1 },
  { id: "quarterly", label: "Quarterly", months: 3 },
  { id: "annual", label: "Annual", months: 12 },
];

export const DATA_CAP_PERIOD_IDS = DATA_CAP_PERIODS.map((p) => p.id);
export const dataCapPeriod = (id) => DATA_CAP_PERIODS.find((p) => p.id === id) || null;
export const dataCapPeriodLabel = (id) => (dataCapPeriod(id) || {}).label || "";
export const dataCapPeriodOptions = () => DATA_CAP_PERIODS.map((p) => ({ id: p.id, label: p.label }));

// ---- overage treatment -----------------------------------------------------
// What happens when consumption exceeds the cap.
export const OVERAGE_TREATMENTS = [
  { id: "charge", label: "Charge per GB over", description: "The excess is billed at the recorded overage rate." },
  { id: "throttle", label: "Throttle", description: "Speed is reduced to the committed rate once the cap is exceeded." },
  { id: "notify", label: "Notify only", description: "The provider is alerted; no automatic charge or throttle." },
  { id: "block", label: "Suspend", description: "The service is suspended until the next period." },
  { id: "none", label: "None", description: "No defined overage handling." },
];

export const OVERAGE_TREATMENT_IDS = OVERAGE_TREATMENTS.map((o) => o.id);
export const overageTreatment = (id) => OVERAGE_TREATMENTS.find((o) => o.id === id) || null;
export const overageTreatmentLabel = (id) => (overageTreatment(id) || {}).label || "";
export const overageTreatmentOptions = () => OVERAGE_TREATMENTS.map((o) => ({ id: o.id, label: o.label }));

// ---- usage monitoring sources ----------------------------------------------
// Where the usage/cost figures come from. The record carries a free-text field
// so more than one source can be named; `usageSourcesForText` matches it to the
// catalog for display.
export const USAGE_SOURCES = [
  { id: "carrier-portal", label: "Carrier portal", keywords: ["carrier", "portal", "wholesale", "web console"] },
  { id: "cpe", label: "CPE / SNMP counters", keywords: ["cpe", "snmp", "router", "firewall", "interface counters"] },
  { id: "rmm", label: "RMM / monitoring platform", keywords: ["rmm", "monitoring", "n-able", "nable", "datto", "solarwinds", "a uv", "auvik", "zabbix", "prtg", "grafana"] },
  { id: "provider-api", label: "Provider API", keywords: ["api", "feed", "export"] },
  { id: "manual", label: "Manual meter reading", keywords: ["manual", "spreadsheet", "invoice", "reading"] },
  { id: "other", label: "Other", keywords: [] },
];

export const USAGE_SOURCE_IDS = USAGE_SOURCES.map((s) => s.id);
export const usageSource = (id) => USAGE_SOURCES.find((s) => s.id === id) || null;
export const usageSourceLabel = (id) => (usageSource(id) || {}).label || "";
export const usageSourceOptions = () => USAGE_SOURCES.map((s) => ({ id: s.id, label: s.label }));

// Every catalog source whose keywords appear in the free text (most specific
// first, catalog order), so "RMM (Datton) + carrier portal" yields both.
export function usageSourcesForText(text) {
  const t = str(text);
  if (!t) return [];
  const out = [];
  for (const s of USAGE_SOURCES) {
    for (const kw of s.keywords || []) {
      if (new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(t)) {
        out.push(s);
        break;
      }
    }
  }
  return out;
}

// ---- usage readings --------------------------------------------------------
const MONTH_ABBREVS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Normalise a period to "YYYY-MM" (or "YYYY" for a year-only entry). Accepts
// 2026-07, 2026/7, 2026.07, "Jul 2026" and "July 2026"; returns null otherwise.
export function normalizePeriod(text) {
  const s = str(text);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) {
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return m[1] + "-" + String(mo).padStart(2, "0");
    return null;
  }
  m = s.match(/^([A-Za-z]{3,9})[\s,-]+(\d{4})$/);
  if (m) {
    const idx = MONTH_ABBREVS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return m[2] + "-" + String(idx + 1).padStart(2, "0");
  }
  m = s.match(/^(\d{4})$/);
  if (m) return m[1];
  return null;
}

function matchUnit(field) {
  const m = str(field).match(/^([\d,]+(?:\.\d+)?)\s*(TB|T|GB|G|MB|M)\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toUpperCase();
  if (unit.startsWith("T")) return round(n * 1024);
  if (unit.startsWith("M")) return round(n / 1024);
  return round(n);
}

function matchNumber(field) {
  const m = str(field).match(/^[$£€]?\s*([\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Parse a "usage readings" textarea into per-period entries. Each line may be
// comma-, pipe- or space-separated and may name a period, a usage figure (with
// an optional GB/TB/MB unit) and a cost, e.g.
//   "2026-07, 812 GB, 120.50"
//   "2026-08 | 940 | 138.25"
//   "2026-09 1020 GB"
// Never throws; unparseable numbers are simply left null.
export function parseUsageReadings(value) {
  const out = [];
  for (const rawLine of String(value == null ? "" : value).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.replace(/\|/g, ",").split(",").map((p) => p.trim()).filter(Boolean);
    let period = null;
    let periodIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      const p = normalizePeriod(parts[i]);
      if (p) {
        period = p;
        periodIdx = i;
        break;
      }
    }
    let rest;
    if (periodIdx >= 0) {
      rest = parts.filter((_, i) => i !== periodIdx);
    } else {
      const m = line.match(/^([A-Za-z]{3,9}[\s-]+\d{4}|\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?)\s+(.*)$/);
      if (m) {
        period = normalizePeriod(m[1]);
        rest = [m[2]];
      } else {
        rest = parts;
      }
    }
    let usageGb = null;
    let cost = null;
    for (const field of rest) {
      const u = matchUnit(field);
      if (u != null && usageGb == null) {
        usageGb = u;
        continue;
      }
      const n = matchNumber(field);
      if (n == null) continue;
      if (usageGb == null) usageGb = n;
      else if (cost == null) cost = n;
    }
    if (period == null && usageGb == null && cost == null) continue;
    out.push({ period, usageGb, cost, raw: line });
  }
  return out;
}

// The parsed usage history of a circuit: the readings in period order, the
// totals and averages, and the latest reading (used by the reconciliation).
export function circuitUsage(circuit) {
  const readings = parseUsageReadings(fieldsOf(circuit).usageReadings).sort((a, b) => String(a.period || "").localeCompare(String(b.period || "")));
  const withUsage = readings.filter((r) => r.usageGb != null);
  const withCost = readings.filter((r) => r.cost != null);
  const totalUsageGb = withUsage.reduce((s, r) => s + r.usageGb, 0);
  const totalCost = withCost.reduce((s, r) => s + r.cost, 0);
  const latest = readings.length ? readings[readings.length - 1] : null;
  return {
    readings,
    count: readings.length,
    usageCount: withUsage.length,
    costCount: withCost.length,
    totalUsageGb: withUsage.length ? round(totalUsageGb) : null,
    totalCost: withCost.length ? round(totalCost) : null,
    avgUsageGb: withUsage.length ? round(totalUsageGb / withUsage.length) : null,
    avgCost: withCost.length ? round(totalCost / withCost.length) : null,
    latest,
    first: readings.length ? readings[0] : null,
    latestPeriod: latest ? latest.period : null,
    latestUsageGb: latest && latest.usageGb != null ? latest.usageGb : null,
    latestCost: latest && latest.cost != null ? latest.cost : null,
    hasUsage: withUsage.length > 0,
  };
}

// ---- the normalised commercial profile -------------------------------------
// Everything the UI, the reconciliation and the generated record read: the
// wholesale cost, the sell price and margin, the invoicing cadence and
// proration, the data cap (normalised to a monthly allowance) and overage
// treatment, and the usage-monitoring sources.
export function billingProfile(circuit) {
  const f = fieldsOf(circuit);
  const pricing = circuitPricing(circuit);
  const contract = circuitContract(circuit);
  const cycle = billingCycle(str(f.billingCycle));
  const cycleMonths = cycle && cycle.months ? cycle.months : 1;
  const billingDay = numOrNull(f.billingDay);
  const proration = prorationPolicy(str(f.proration));
  const cap = numOrNull(f.dataCap);
  const capPeriod = dataCapPeriod(str(f.dataCapPeriod)) || cycle;
  const capPeriodMonths = capPeriod && capPeriod.months ? capPeriod.months : 1;
  const capMonthly = cap != null ? round(cap / capPeriodMonths) : null;
  const overageRate = numOrNull(f.overageRate);
  const overage = overageTreatment(str(f.overageTreatment));
  const usageMonitoring = str(f.usageMonitoring) || null;
  return {
    id: circuit ? circuit.id : null,
    currency: pricing.currency,
    pricing,
    contract,
    cycle,
    cycleLabel: cycle ? cycle.label : "",
    cycleMonths,
    billingDay,
    proration,
    prorationLabel: proration ? proration.label : "",
    cap,
    capPeriod,
    capPeriodLabel: capPeriod ? capPeriod.label : "",
    capPeriodMonths,
    capMonthly,
    overageRate,
    overage,
    overageLabel: overage ? overage.label : "",
    usageMonitoring,
    usageSources: usageSourcesForText(usageMonitoring),
    cycleCost: pricing.cost != null ? round(pricing.cost * cycleMonths) : null,
    cycleSell: pricing.sell != null ? round(pricing.sell * cycleMonths) : null,
    annualCost: pricing.cost != null ? round(pricing.cost * 12) : null,
    annualSell: pricing.sell != null ? round(pricing.sell * 12) : null,
    annualMargin: pricing.margin != null ? round(pricing.margin * 12) : null,
    hasPricing: pricing.hasPricing,
    hasCap: cap != null,
    hasBilling: pricing.hasPricing || !!cycle || billingDay != null || cap != null || !!usageMonitoring,
  };
}

// ---- the reconciliation view -----------------------------------------------
function monthsBetween(period, now) {
  const m = str(period).match(/^(\d{4})-(\d{2})$/);
  const d = new Date(now);
  if (m) return (d.getFullYear() - Number(m[1])) * 12 + (d.getMonth() + 1 - Number(m[2]));
  const y = str(period).match(/^(\d{4})$/);
  if (y) return (d.getFullYear() - Number(y[1])) * 12;
  return null;
}

// Reconcile a circuit's sold plan against what actually happened: whether the
// average billed cost has drifted from the expected cost, whether the latest
// usage has hit (or is close to) the cap, the estimated overage, and whether
// the readings are missing or stale. Returns the figures plus `flags` (each
// `{code, level, message}`) and `ok` (no warning-level findings).
export function usageReconciliation(circuit, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const tolerancePct = opts.tolerancePct != null ? opts.tolerancePct : 15;
  const nearCapPct = opts.nearCapPct != null ? opts.nearCapPct : 85;
  const staleMonths = opts.staleMonths != null ? opts.staleMonths : 2;
  const profile = billingProfile(circuit);
  const usage = circuitUsage(circuit);
  const name = circuit && circuit.name ? circuit.name : "this circuit";
  const flags = [];
  const flag = (code, level, message) => flags.push({ code, level, message });

  const expectedCost = profile.pricing.cost;
  const avgCost = usage.avgCost;
  let costDelta = null;
  let costDeltaPct = null;
  let drifted = false;
  if (expectedCost != null && expectedCost > 0 && avgCost != null) {
    costDelta = round(avgCost - expectedCost);
    costDeltaPct = round((costDelta / expectedCost) * 100);
    drifted = Math.abs(costDeltaPct) >= tolerancePct;
  }

  const capMonthly = profile.capMonthly;
  const latestUsageGb = usage.latestUsageGb;
  let utilisationPct = null;
  let overCap = false;
  let nearCap = false;
  let overageGb = 0;
  let overageEstimate = 0;
  if (capMonthly != null && capMonthly > 0 && latestUsageGb != null) {
    utilisationPct = round((latestUsageGb / capMonthly) * 100);
    overCap = latestUsageGb > capMonthly;
    nearCap = !overCap && utilisationPct >= nearCapPct;
    if (overCap) {
      overageGb = round(latestUsageGb - capMonthly);
      overageEstimate = profile.overageRate != null ? round(overageGb * profile.overageRate) : 0;
    }
  }

  let stale = false;
  let monthsOld = null;
  if (usage.latestPeriod) {
    monthsOld = monthsBetween(usage.latestPeriod, now);
    stale = monthsOld != null && monthsOld > staleMonths;
  }

  if (!profile.pricing.hasPricing) flag("billing-no-pricing", "warning", `Circuit “${name}” records no wholesale cost or sell price.`);
  if (profile.hasPricing && !profile.cycle) flag("billing-no-cycle", "warning", `Circuit “${name}” has pricing but records no billing cycle.`);
  if (profile.cycle && !profile.proration) flag("billing-no-proration", "warning", `Circuit “${name}” records a billing cycle but no proration policy.`);
  if (profile.pricing.margin != null && profile.pricing.margin < 0) flag("billing-negative-margin", "warning", `Circuit “${name}” is sold below cost (margin ${profile.pricing.margin} ${profile.currency}).`);
  if (profile.hasBilling && !profile.usageMonitoring) flag("billing-no-usage-monitoring", "warning", `Circuit “${name}” records no usage-monitoring or reporting source.`);
  if (profile.hasCap && !profile.overage) flag("billing-no-overage-treatment", "warning", `Circuit “${name}” has a data cap but no overage treatment.`);
  if (profile.hasCap && usage.count === 0) flag("billing-cap-no-readings", "warning", `Circuit “${name}” has a data cap but records no usage readings.`);
  if (stale) flag("billing-stale-readings", "warning", `Circuit “${name}” usage readings are stale (latest ${usage.latestPeriod}).`);
  if (overCap) flag("billing-usage-over-cap", "warning", `Circuit “${name}” latest usage ${latestUsageGb} GB exceeds its ${capMonthly} GB monthly cap (${overageGb} GB over).`);
  else if (nearCap) flag("billing-usage-near-cap", "info", `Circuit “${name}” latest usage is at ${utilisationPct}% of its ${capMonthly} GB monthly cap.`);
  if (drifted) flag("billing-cost-drift", "warning", `Circuit “${name}” average billed cost ${avgCost} ${profile.currency} drifted ${costDeltaPct}% from the expected ${expectedCost}.`);

  return {
    profile,
    usage,
    expectedCost,
    avgCost,
    costDelta,
    costDeltaPct,
    drifted,
    capMonthly,
    latestUsageGb,
    utilisationPct,
    overCap,
    nearCap,
    overageGb,
    overageEstimate,
    stale,
    monthsOld,
    flags,
    ok: flags.every((f) => f.level !== "warning"),
  };
}

// ---- the client rollup -----------------------------------------------------
// Every circuit in a set rolled up to one commercial picture: the monthly and
// annualised cost/sell/margin, how many circuits are capped / over cap, the
// estimated overage and the reconciliation findings. This is what the client
// billing card renders and the client billing record is generated from.
export function clientBillingSummary(set, opts = {}) {
  const circuits = ((set && set.records && set.records.flexibleAssets) || []).filter((r) => r.assetTypeId === WAN_CIRCUIT_TYPE_ID);
  const rows = circuits.map((c) => {
    const profile = billingProfile(c);
    const recon = usageReconciliation(c, opts);
    return {
      id: c.id,
      name: c.name,
      currency: profile.currency,
      cost: profile.pricing.cost,
      sell: profile.pricing.sell,
      margin: profile.pricing.margin,
      marginPct: profile.pricing.marginPct,
      cycleLabel: profile.cycleLabel,
      cap: profile.cap,
      capPeriodLabel: profile.capPeriodLabel,
      capMonthly: profile.capMonthly,
      overageRate: profile.overageRate,
      overageLabel: profile.overageLabel,
      latestUsageGb: recon.latestUsageGb,
      utilisationPct: recon.utilisationPct,
      overCap: recon.overCap,
      nearCap: recon.nearCap,
      overageEstimate: recon.overageEstimate,
      drifted: recon.drifted,
      stale: recon.stale,
      profile,
      recon,
      flags: recon.flags,
      ok: recon.ok,
    };
  });
  const numSum = (fn) => round(rows.reduce((s, r) => s + (typeof fn(r) === "number" ? fn(r) : 0), 0));
  const currencies = [...new Set(rows.map((r) => r.currency).filter(Boolean))];
  const monthlyCost = numSum((r) => r.cost);
  const monthlySell = numSum((r) => r.sell);
  const monthlyMargin = numSum((r) => r.margin);
  const byCycleMap = new Map();
  for (const r of rows) {
    const id = r.profile.cycle ? r.profile.cycle.id : "unspecified";
    const label = r.profile.cycle ? r.profile.cycle.label : "Unspecified";
    const entry = byCycleMap.get(id) || { id, label, count: 0 };
    entry.count += 1;
    byCycleMap.set(id, entry);
  }
  return {
    circuits: rows,
    count: rows.length,
    currency: currencies[0] || "GBP",
    mixedCurrency: currencies.length > 1,
    monthlyCost,
    monthlySell,
    monthlyMargin,
    monthlyMarginPct: monthlySell ? round((monthlyMargin / monthlySell) * 100) : null,
    annualCost: round(monthlyCost * 12),
    annualSell: round(monthlySell * 12),
    annualMargin: round(monthlyMargin * 12),
    cappedCount: rows.filter((r) => r.capMonthly != null).length,
    overCapCount: rows.filter((r) => r.overCap).length,
    nearCapCount: rows.filter((r) => r.nearCap).length,
    driftCount: rows.filter((r) => r.drifted).length,
    staleCount: rows.filter((r) => r.stale).length,
    overageEstimate: numSum((r) => r.overageEstimate),
    flagCount: rows.reduce((s, r) => s + r.flags.filter((f) => f.level === "warning").length, 0),
    byCycle: [...byCycleMap.values()],
    hasBilling: rows.some((r) => r.profile.hasBilling),
  };
}

// ---- the completeness audit ------------------------------------------------
// Folded in by ./standardized.js. Warnings never fail the graph audit.
export function billingIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const rec = (code, recordId, message) => issues.push({ level: "warning", code, recordId, message });
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== WAN_CIRCUIT_TYPE_ID) continue;
    const recon = usageReconciliation(r, opts);
    const p = recon.profile;
    if (p.hasPricing && !p.cycle) rec("circuit-no-billing-cycle", r.id, `Circuit “${r.name}” has pricing but records no billing cycle.`);
    if (p.cycle && !p.proration) rec("circuit-no-proration", r.id, `Circuit “${r.name}” records a billing cycle but no proration policy.`);
    if (p.pricing.margin != null && p.pricing.margin < 0) rec("circuit-negative-margin", r.id, `Circuit “${r.name}” is sold below its wholesale cost (margin ${p.pricing.margin} ${p.currency}).`);
    if (p.hasBilling && !p.usageMonitoring) rec("circuit-no-usage-monitoring", r.id, `Circuit “${r.name}” records no usage-monitoring or reporting source.`);
    if (p.hasCap && !p.overage) rec("circuit-cap-no-overage-treatment", r.id, `Circuit “${r.name}” has a data cap but no overage treatment.`);
    if (p.hasCap && recon.usage.count === 0) rec("circuit-cap-no-readings", r.id, `Circuit “${r.name}” has a data cap but records no usage readings.`);
    if (recon.overCap) rec("circuit-usage-over-cap", r.id, `Circuit “${r.name}” latest usage ${recon.latestUsageGb} GB exceeds its ${recon.capMonthly} GB monthly cap.`);
    if (recon.drifted) rec("circuit-cost-drift", r.id, `Circuit “${r.name}” average billed cost ${recon.avgCost} ${p.currency} drifted ${recon.costDeltaPct}% from the expected ${recon.expectedCost}.`);
    if (recon.stale) rec("circuit-usage-stale", r.id, `Circuit “${r.name}” usage readings are stale (latest ${recon.usage.latestPeriod}).`);
  }
  return issues;
}

// ---- the generated billing & usage records ---------------------------------
function factLines(pairs) {
  return pairs.filter(([, v]) => !blank(v)).map(([k, v]) => `- **${k}:** ${Array.isArray(v) ? v.join(", ") : v}`);
}
const money = (amount, currency) => (amount == null ? "" : `${amount} ${currency || ""}`.trim());
const isoDay = (now) => new Date(now).toISOString().slice(0, 10);
const section = (L, heading) => L.push("", "## " + heading, "");

// Assemble a client-technical referencing document that documents a circuit's
// reseller commercial model, billing cycle/proration, data cap and overage
// treatment, usage-monitoring sources and the reconciliation against the sold
// plan. Returns markdown plus any gaps flagged as warnings.
export function generateCircuitBillingRecord({ circuit, set, title, now = Date.now() } = {}) {
  if (!circuit) throw new Error("A circuit is required to generate a billing record.");
  const profile = billingProfile(circuit);
  const circuitInfo = circuitProfile(circuit);
  const recon = usageReconciliation(circuit, { now });
  const usage = recon.usage;
  const pricing = profile.pricing;
  const contract = profile.contract;
  const warnings = recon.flags
    .filter((f) => f.level === "warning")
    .map((f) => ({ code: f.code, message: f.message }));

  const generatedOn = isoDay(now);
  const L = [];
  L.push(`# Reseller billing & usage — ${circuit.name}`, "");
  L.push(`The reseller commercial model, billing cadence, data cap and usage reconciliation for **${circuit.name}**${profile.upstreamCarrier ? " on the " + profile.upstreamCarrier + " network" : ""}.`, "");
  L.push(`_Generated from the Internet/WAN circuit asset on ${generatedOn}. Figures follow the circuit's recorded pricing and usage; gaps are marked TO COMPLETE._`);

  section(L, "Circuit");
  L.push(...factLines([
    ["Carrier (branded)", circuitInfo.carrier],
    ["Upstream / wholesale carrier", circuitInfo.upstreamCarrier],
    ["Service definition", circuitInfo.serviceDefinitionLabel],
    ["Contract", contract.hasTerm ? `${contract.start || "?"} → ${contract.end || "?"}${contract.termMonths ? " (" + contract.termMonths + " months)" : ""}` : ""],
    ["Contract end", contract.end ? `${contract.end}${contract.daysLeft != null ? " (" + contract.daysLeft + " days)" : ""}` : ""],
  ]));

  section(L, "Commercial summary");
  if (pricing.hasPricing) {
    L.push("| Item | Amount |", "| --- | --- |");
    L.push(`| Wholesale cost (per month) | ${money(pricing.cost, profile.currency) || "_[TO COMPLETE]_"} |`);
    L.push(`| Sell price (per month) | ${money(pricing.sell, profile.currency) || "_[TO COMPLETE]_"} |`);
    L.push(`| Margin (per month) | ${money(pricing.margin, profile.currency) || "—"}${pricing.marginPct != null ? " (" + pricing.marginPct + "%)" : ""} |`);
    if (profile.cycleCost != null || profile.cycleSell != null) L.push(`| Invoiced per ${(profile.cycleLabel || "cycle").toLowerCase()} | cost ${money(profile.cycleCost, profile.currency) || "?"} · sell ${money(profile.cycleSell, profile.currency) || "?"} |`);
    L.push(`| Annualised | cost ${money(profile.annualCost, profile.currency) || "?"} · sell ${money(profile.annualSell, profile.currency) || "?"} · margin ${money(profile.annualMargin, profile.currency) || "?"} |`);
  } else {
    L.push("_[TO COMPLETE: record the wholesale cost and the sell price on the circuit.]_");
  }

  section(L, "Billing cycle & proration");
  L.push(...factLines([
    ["Billing cycle", profile.cycleLabel],
    ["Billing day", profile.billingDay != null ? "day " + profile.billingDay + " of the period" : ""],
    ["Proration", profile.prorationLabel],
    ["Currency", profile.currency],
  ]));
  if (!profile.cycle) L.push("", "_[TO COMPLETE: record how often this circuit is invoiced.]_");
  if (profile.cycle && !profile.proration) L.push("", "_[TO COMPLETE: record the proration policy for the first/last invoice.]_");

  section(L, "Data cap & overage");
  if (profile.hasCap) {
    L.push(...factLines([
      ["Data cap", profile.cap + " GB per " + (profile.capPeriodLabel || "period").toLowerCase() + (profile.capMonthly != null && profile.capPeriodMonths > 1 ? ` (${profile.capMonthly} GB/month)` : "")],
      ["Overage rate", profile.overageRate != null ? money(profile.overageRate, profile.currency) + " per GB over" : ""],
      ["Overage treatment", profile.overageLabel],
    ]));
    if (!profile.overage) L.push("", "_[TO COMPLETE: record what happens when the cap is exceeded.]_");
  } else {
    L.push("_[TO COMPLETE: record the data cap/quota, or note that the service is uncapped.]_");
  }

  section(L, "Usage monitoring & reporting");
  L.push(...factLines([
    ["Sources", profile.usageSources.length ? profile.usageSources.map((s) => s.label).join(", ") : profile.usageMonitoring],
    ["Reported by", profile.usageMonitoring],
  ]));
  if (!profile.usageMonitoring) L.push("", "_[TO COMPLETE: record where the usage and cost figures are obtained (carrier portal, CPE counters, RMM, provider API).]_");

  section(L, "Usage readings");
  if (usage.readings.length) {
    L.push("| Period | Usage | Cost |", "| --- | --- | --- |");
    for (const r of usage.readings) {
      L.push(`| ${r.period || "_?_"} | ${r.usageGb != null ? r.usageGb + " GB" : "_[TO COMPLETE]_"} | ${r.cost != null ? money(r.cost, profile.currency) : ""} |`);
    }
    L.push("", `_${usage.count} reading(s); average usage ${usage.avgUsageGb != null ? usage.avgUsageGb + " GB" : "?"}, average cost ${usage.avgCost != null ? money(usage.avgCost, profile.currency) : "?"}._`);
  } else {
    L.push("_[TO COMPLETE: record the per-period usage readings (period, usage, cost).]_");
  }

  section(L, "Reconciliation against the sold plan");
  const lines = [];
  if (profile.capMonthly != null && usage.latestUsageGb != null) {
    lines.push(`Latest usage is **${usage.latestUsageGb} GB** against a **${profile.capMonthly} GB/month** cap (${recon.utilisationPct}%)${recon.overCap ? ` — **${recon.overageGb} GB over**` : ""}.`);
    if (recon.overCap) lines.push(recon.overageEstimate ? `Estimated overage charge at the recorded rate: **${money(recon.overageEstimate, profile.currency)}**.` : "No overage rate is recorded, so the overage charge cannot be estimated.");
  }
  if (recon.drifted) lines.push(`Average billed cost **${money(recon.avgCost, profile.currency)}** has drifted **${recon.costDeltaPct}%** from the expected **${money(recon.expectedCost, profile.currency)}**.`);
  if (recon.stale) lines.push(`Readings are stale — the latest period is **${usage.latestPeriod}**.`);
  if (lines.length) for (const line of lines) L.push("- " + line);
  else L.push(usage.count ? "_Consumption and cost are within the sold plan._" : "_No usage readings available to reconcile._");
  if (recon.flags.length) {
    L.push("", "**Findings**", "");
    for (const f of recon.flags) L.push(`- ${f.level === "warning" ? "⚠" : "ℹ"} ${f.message}`);
  }

  const name = !blank(title) ? title : `Billing & usage — ${circuit.name}`;
  const summary = `Reseller billing, billing cycle/proration, data cap and usage reconciliation for ${circuit.name}${profile.cycleLabel ? " (" + profile.cycleLabel.toLowerCase() + ")" : ""}.`;
  return { name, docType: "client-technical", summary, body: L.join("\n"), warnings, generatedAt: now, circuitId: circuit.id, source: "circuit-asset" };
}

// Assemble a client-technical document that rolls up the commercial picture and
// reconciliation across every resold circuit in the set — the per-client half
// of the billing documentation.
export function generateClientBillingRecord({ set, title, now = Date.now(), opts = {} } = {}) {
  if (!set) throw new Error("A documentation set is required to generate a client billing record.");
  const summary = clientBillingSummary(set, { ...opts, now });
  const currency = summary.currency;
  const generatedOn = isoDay(now);
  const L = [];
  L.push(`# Reseller billing & usage summary — ${set.name}`, "");
  L.push(`The reseller commercial model and usage position across **${summary.count}** resold circuit${summary.count === 1 ? "" : "s"} documented for **${set.name}**.`, "");
  L.push(`_Generated from the set's Internet/WAN circuit assets on ${generatedOn}._`);

  section(L, "Commercial summary");
  L.push("| Metric | Monthly | Annualised |", "| --- | --- | --- |");
  L.push(`| Wholesale cost | ${money(summary.monthlyCost, currency)} | ${money(summary.annualCost, currency)} |`);
  L.push(`| Sell price | ${money(summary.monthlySell, currency)} | ${money(summary.annualSell, currency)} |`);
  L.push(`| Margin | ${money(summary.monthlyMargin, currency)}${summary.monthlyMarginPct != null ? " (" + summary.monthlyMarginPct + "%)" : ""} | ${money(summary.annualMargin, currency)} |`);
  L.push("", `${summary.count} circuit(s) · ${summary.cappedCount} capped · ${summary.overCapCount} over cap · ${summary.driftCount} with cost drift · ${summary.flagCount} finding(s).`);
  if (summary.overageEstimate) L.push("", `Estimated overage charges this period: **${money(summary.overageEstimate, currency)}**.`);

  section(L, "Circuits");
  L.push("| Circuit | Cost/mo | Sell/mo | Margin | Cycle | Cap | Latest usage | Status |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of summary.circuits) {
    const status = r.overCap ? "Over cap" : r.nearCap ? "Near cap" : r.drifted ? "Cost drift" : r.ok ? "OK" : "Review";
    L.push(
      `| ${r.name} | ${money(r.cost, currency) || "?"} | ${money(r.sell, currency) || "?"} | ${money(r.margin, currency) || "—"} | ${r.cycleLabel || "?"} | ${r.capMonthly != null ? r.capMonthly + " GB/mo" : "—"} | ${r.latestUsageGb != null ? r.latestUsageGb + " GB" : "—"} | ${status} |`,
    );
  }

  section(L, "Billing cycles");
  if (summary.byCycle.length) {
    L.push("| Cycle | Circuits |", "| --- | --- |");
    for (const c of summary.byCycle) L.push(`| ${c.label} | ${c.count} |`);
  } else {
    L.push("_No billing cycles recorded._");
  }

  section(L, "Findings");
  const findings = summary.circuits.flatMap((r) => r.flags.map((f) => ({ ...f, circuit: r.name })));
  if (findings.length) {
    for (const f of findings) L.push(`- ${f.level === "warning" ? "⚠" : "ℹ"} **${f.circuit}** — ${f.message}`);
  } else {
    L.push("_Every circuit is within its sold plan._");
  }

  const name = !blank(title) ? title : `Billing & usage summary — ${set.name}`;
  const docSummary = `Reseller commercial model and usage reconciliation across ${summary.count} circuit${summary.count === 1 ? "" : "s"} for ${set.name}.`;
  return { name, docType: "client-technical", summary: docSummary, body: L.join("\n"), warnings: findings.filter((f) => f.level === "warning").map((f) => ({ code: f.code, message: f.message })), generatedAt: now, source: "docset" };
}
