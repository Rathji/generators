// src/tests/billing.test.js — validation tests for Phase 10 task 43
// ("Reseller billing, usage & data-cap documentation"). Run in the live page:
//   await import("./src/tests/billing.test.js").then((m) => m.run())
//
// Covers: the billing-cycle / proration / data-cap-period / overage-treatment /
// usage-source catalogs and their option helpers; `normalizePeriod` and
// `parseUsageReadings` (comma-, pipe- and space-separated readings, GB/TB/MB
// units, junk-line tolerance); `circuitUsage` aggregation; `billingProfile`
// (per-cycle and annualised figures, cap normalised to a monthly allowance);
// `usageReconciliation` (over-cap detection and overage estimate, cost drift,
// stale readings, the balanced case); `clientBillingSummary` rollup;
// `billingIssues` and that the linter folds them in; both generators
// (`generateCircuitBillingRecord`, `generateClientBillingRecord`) and that a
// generated record round-trips through storage as a valid document; and that
// the WAN circuit template carries the new commercial fields.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { WAN_CIRCUIT_TYPE_ID } from "../framework/circuit.js";
import { standardizedIssues } from "../framework/standardized.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import {
  BILLING_CYCLES,
  billingCycle,
  billingCycleOptions,
  PRORATION_POLICIES,
  prorationPolicy,
  prorationPolicyOptions,
  DATA_CAP_PERIODS,
  dataCapPeriod,
  dataCapPeriodOptions,
  OVERAGE_TREATMENTS,
  overageTreatment,
  overageTreatmentOptions,
  USAGE_SOURCES,
  usageSourcesForText,
  normalizePeriod,
  parseUsageReadings,
  circuitUsage,
  billingProfile,
  usageReconciliation,
  clientBillingSummary,
  billingIssues,
  generateCircuitBillingRecord,
  generateClientBillingRecord,
} from "../framework/billing.js";

const CL = { informationModel: "document", provenance: "authored" };

const BILLED_FIELDS = {
  carrier: "Aurora Telecom",
  upstreamCarrier: "National Wholesale",
  accessTechnology: "fibre",
  serviceDefinition: "business",
  circuitId: "AUR-500-001",
  bandwidthDown: 100,
  bandwidthUp: 40,
  costPrice: 40,
  sellPrice: 100,
  currency: "GBP",
  billingCycle: "monthly",
  billingDay: 1,
  proration: "actual-days",
  dataCap: 500,
  dataCapPeriod: "monthly",
  overageRate: 1.5,
  overageTreatment: "charge",
  usageMonitoring: "Carrier portal and an RMM monitoring platform",
  usageReadings: "2026-05, 400 GB, 40.00\n2026-06, 460 GB, 40.00\n2026-07, 640 GB, 61.00",
};

async function seed(world, extra = {}) {
  const { docs } = world;
  const set = await docs.create({ name: "Aurora" });
  const circuit = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "Aurora 500 — HO",
    assetTypeId: WAN_CIRCUIT_TYPE_ID,
    assetFields: { ...BILLED_FIELDS, ...extra },
    ...CL,
  })).record;
  return { set, circuit };
}

export async function run() {
  return runTests([
    {
      name: "the billing catalogs and their option helpers are populated and consistent",
      fn: () => {
        assert(BILLING_CYCLES.length >= 3, "the cycle catalog is populated");
        assertEq(billingCycle("monthly").months, 1, "monthly is one month");
        assertEq(billingCycle("annual").months, 12, "annual is twelve months");
        assertEq(billingCycle("bogus"), null, "an unknown cycle is null");
        assertEq(billingCycleOptions().length, BILLING_CYCLES.length, "cycle options mirror the catalog");
        assertEq(prorationPolicy("actual-days").label, "Actual days", "proration lookup");
        assertEq(prorationPolicyOptions().length, PRORATION_POLICIES.length, "proration options mirror the catalog");
        assertEq(dataCapPeriod("quarterly").months, 3, "a quarterly cap period is three months");
        assertEq(dataCapPeriodOptions().length, DATA_CAP_PERIODS.length, "cap-period options mirror the catalog");
        assertEq(overageTreatment("throttle").label, "Throttle", "overage lookup");
        assertEq(overageTreatmentOptions().length, OVERAGE_TREATMENTS.length, "overage options mirror the catalog");
        assert(USAGE_SOURCES.length >= 4, "the usage-source catalog is populated");
        const sources = usageSourcesForText("Carrier portal + RMM (Datton)");
        assert(sources.some((s) => s.id === "carrier-portal"), "the carrier portal is recognised");
        assert(sources.some((s) => s.id === "rmm"), "the RMM platform is recognised");
        assertEq(usageSourcesForText("").length, 0, "no text yields no sources");
      },
    },
    {
      name: "normalizePeriod and parseUsageReadings handle the common reading formats and units",
      fn: () => {
        assertEq(normalizePeriod("2026-07"), "2026-07", "year-month");
        assertEq(normalizePeriod("2026/7"), "2026-07", "slash and single-digit month");
        assertEq(normalizePeriod("2026.07.15"), "2026-07", "a dropped day is ignored");
        assertEq(normalizePeriod("Jul 2026"), "2026-07", "an abbreviated month");
        assertEq(normalizePeriod("July 2026"), "2026-07", "a full month name");
        assertEq(normalizePeriod("2026"), "2026", "a year-only period");
        assertEq(normalizePeriod("wat"), null, "unparseable text is null");

        const parsed = parseUsageReadings("2026-07, 812 GB, 120.50\n2026-08 | 940 | 138.25\n2026-09 1020 GB\n2026-10, 1.5 TB, 200\n# comment\n\njunk line here");
        assertEq(parsed.length, 4, "blank lines, comments and unparseable lines are dropped");
        assertEq(parsed[0].period, "2026-07", "the comma format period");
        assertEq(parsed[0].usageGb, 812, "the comma format usage");
        assertEq(parsed[0].cost, 120.5, "the comma format cost");
        assertEq(parsed[1].period, "2026-08", "the pipe format period");
        assertEq(parsed[1].usageGb, 940, "the pipe format usage");
        assertEq(parsed[1].cost, 138.25, "the pipe format cost");
        assertEq(parsed[2].usageGb, 1020, "the space format usage");
        assertEq(parsed[2].cost, null, "a missing cost is null");
        assertEq(parsed[3].usageGb, 1536, "TB is converted to GB");
        assertEq(parseUsageReadings("").length, 0, "empty text yields no entries");
      },
    },
    {
      name: "circuitUsage aggregates the readings into totals, averages and the latest period",
      fn: () => {
        const usage = circuitUsage({ assetFields: BILLED_FIELDS });
        assertEq(usage.count, 3, "three readings");
        assertEq(usage.totalUsageGb, 1500, "the usage total");
        assertEq(usage.avgUsageGb, 500, "the average usage");
        assertEq(usage.totalCost, 141, "the cost total");
        assertEq(usage.avgCost, 47, "the average cost");
        assertEq(usage.latestPeriod, "2026-07", "the latest period");
        assertEq(usage.latestUsageGb, 640, "the latest usage");
        assertEq(usage.hasUsage, true, "it has usage");
        const empty = circuitUsage({ assetFields: {} });
        assertEq(empty.count, 0, "an unread circuit has no readings");
        assertEq(empty.latest, null, "there is no latest reading");
      },
    },
    {
      name: "billingProfile derives the cycle, cap allowance and annualised figures",
      fn: () => {
        const p = billingProfile({ assetFields: BILLED_FIELDS });
        assertEq(p.cycleLabel, "Monthly", "the billing cycle is labelled");
        assertEq(p.cycleMonths, 1, "a monthly cycle is one month");
        assertEq(p.prorationLabel, "Actual days", "the proration policy is labelled");
        assertEq(p.billingDay, 1, "the billing day is read");
        assertEq(p.cap, 500, "the raw data cap");
        assertEq(p.capMonthly, 500, "a monthly cap is 500 GB/month");
        assertEq(p.capPeriodLabel, "Monthly", "the cap period is labelled");
        assertEq(p.overageRate, 1.5, "the overage rate");
        assertEq(p.overageLabel, "Charge per GB over", "the overage treatment is labelled");
        assertEq(p.cycleSell, 100, "the amount invoiced per month");
        assertEq(p.annualSell, 1200, "the annualised sell price");
        assertEq(p.annualMargin, 720, "the annualised margin");
        assertEq(p.hasCap, true, "it has a cap");
        assertEq(p.hasBilling, true, "it has billing terms");
        assert(p.usageSources.some((s) => s.id === "carrier-portal"), "the carrier portal source is derived");

        const q = billingProfile({ assetFields: { dataCap: 3000, dataCapPeriod: "quarterly" } });
        assertEq(q.capMonthly, 1000, "a quarterly cap normalises to a monthly allowance");
      },
    },
    {
      name: "usageReconciliation flags over-cap consumption, estimates overage and detects cost drift",
      fn: () => {
        const recon = usageReconciliation({ name: "Aurora 500", assetFields: BILLED_FIELDS });
        assertEq(recon.capMonthly, 500, "the monthly cap");
        assertEq(recon.latestUsageGb, 640, "the latest usage");
        assertEq(recon.utilisationPct, 128, "the utilisation against the cap");
        assertEq(recon.overCap, true, "the cap is exceeded");
        assertEq(recon.nearCap, false, "it is over, not merely near, cap");
        assertEq(recon.overageGb, 140, "the overage in GB");
        assertEq(recon.overageEstimate, 210, "the estimated overage charge at the recorded rate");
        assertEq(recon.expectedCost, 40, "the expected monthly cost");
        assertEq(recon.avgCost, 47, "the average billed cost");
        assertEq(recon.costDelta, 7, "the cost delta");
        assertEq(recon.costDeltaPct, 17.5, "the cost drift percentage");
        assertEq(recon.drifted, true, "the cost has drifted beyond tolerance");
        assertEq(recon.ok, false, "findings mean the circuit is not balanced");
        const codes = recon.flags.map((f) => f.code);
        assert(codes.includes("billing-usage-over-cap"), "the over-cap flag is raised");
        assert(codes.includes("billing-cost-drift"), "the cost-drift flag is raised");
        assert(recon.flags.every((f) => f.level === "warning" || f.level === "info"), "flags carry a level");
      },
    },
    {
      name: "usageReconciliation reports a within-plan circuit as balanced and flags stale/uncapped gaps",
      fn: () => {
        const clean = usageReconciliation({
          name: "Clean",
          assetFields: { costPrice: 40, sellPrice: 80, currency: "GBP", billingCycle: "monthly", proration: "actual-days", usageMonitoring: "carrier portal", usageReadings: "2026-07, 300 GB, 40.00" },
        }, { now: Date.parse("2026-08-01T00:00:00Z") });
        assertEq(clean.overCap, false, "no cap is exceeded");
        assertEq(clean.drifted, false, "the cost matches the expected value");
        assertEq(clean.stale, false, "the reading is current");
        assertEq(clean.ok, true, "a within-plan circuit is balanced: " + JSON.stringify(clean.flags));

        const stale = usageReconciliation({
          name: "Stale",
          assetFields: { costPrice: 40, sellPrice: 80, currency: "GBP", billingCycle: "monthly", proration: "actual-days", usageMonitoring: "carrier portal", dataCap: 500, dataCapPeriod: "monthly", overageTreatment: "notify", usageReadings: "2026-01, 300 GB, 40.00" },
        }, { now: Date.parse("2026-08-01T00:00:00Z") });
        assert(stale.stale, "an old reading is stale");
        assert(stale.flags.some((f) => f.code === "billing-stale-readings"), "the stale flag is raised");

        const near = usageReconciliation({
          name: "Near",
          assetFields: { costPrice: 40, sellPrice: 80, currency: "GBP", billingCycle: "monthly", proration: "actual-days", usageMonitoring: "carrier portal", dataCap: 500, dataCapPeriod: "monthly", overageTreatment: "throttle", usageReadings: "2026-07, 450 GB, 40.00" },
        }, { now: Date.parse("2026-08-01T00:00:00Z") });
        assert(near.nearCap, "450/500 is near the cap");
        assert(near.flags.some((f) => f.code === "billing-usage-near-cap" && f.level === "info"), "the near-cap finding is informational");
        assertEq(near.ok, true, "an informational finding keeps the circuit balanced");
      },
    },
    {
      name: "clientBillingSummary rolls the commercial picture up across circuits",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-billing" });
        const s = await seed(world);
        await world.docs.addRecord(s.set.id, { type: "flexibleAssets", name: "Aurora 100 — Branch", assetTypeId: WAN_CIRCUIT_TYPE_ID, assetFields: { costPrice: 20, sellPrice: 55, currency: "GBP", billingCycle: "annual", proration: "none", usageMonitoring: "carrier portal" }, ...CL });
        const set = await world.docs.get(s.set.id, { force: true });
        const summary = clientBillingSummary(set);
        assertEq(summary.count, 2, "both circuits are rolled up");
        assertEq(summary.monthlyCost, 60, "the combined monthly cost");
        assertEq(summary.monthlySell, 155, "the combined monthly sell");
        assertEq(summary.monthlyMargin, 95, "the combined monthly margin");
        assertEq(summary.annualMargin, 1140, "the combined annual margin");
        assertEq(summary.cappedCount, 1, "one circuit is capped");
        assertEq(summary.overCapCount, 1, "one circuit is over cap");
        assertEq(summary.overageEstimate, 210, "the estimated overage is summed");
        assert(summary.byCycle.some((c) => c.id === "monthly" && c.count === 1), "the monthly cycle is counted");
        assert(summary.byCycle.some((c) => c.id === "annual" && c.count === 1), "the annual cycle is counted");
        assert(summary.hasBilling, "the rollup has billing terms");
      },
    },
    {
      name: "billingIssues flags the commercial gaps and folds into the standardized linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-billing" });
        const s = await seed(world);
        const bad = (await world.docs.addRecord(s.set.id, {
          type: "flexibleAssets",
          name: "Bad billing",
          assetTypeId: WAN_CIRCUIT_TYPE_ID,
          assetFields: { carrier: "X", costPrice: 50, sellPrice: 30, currency: "GBP", dataCap: 100, dataCapPeriod: "monthly", usageReadings: "2026-07, 250 GB, 60.00" },
          ...CL,
        })).record;
        const set = await world.docs.get(s.set.id, { force: true });
        const codes = billingIssues(set).map((i) => i.code);
        assert(codes.includes("circuit-no-billing-cycle"), "pricing without a cycle is flagged");
        assert(codes.includes("circuit-negative-margin"), "selling below cost is flagged");
        assert(codes.includes("circuit-cap-no-overage-treatment"), "a cap without overage treatment is flagged");
        assert(codes.includes("circuit-no-usage-monitoring"), "missing monitoring is flagged");
        assert(codes.includes("circuit-usage-over-cap"), "usage over the cap is flagged");
        assert(billingIssues(set).every((i) => i.level === "warning"), "billing findings are warnings");
        assert(billingIssues(set).some((i) => i.recordId === bad.id), "the finding names the circuit");

        const folded = standardizedIssues(set).map((i) => i.code);
        assert(folded.includes("circuit-no-billing-cycle"), "the linter folds the billing audit in");
        assert((await world.docs.integrity(s.set.id)).ok, "billing gaps never fail the graph audit");
      },
    },
    {
      name: "generateCircuitBillingRecord assembles the commercial record with the recorded values",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-billing" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateCircuitBillingRecord({ circuit: s.circuit, set, now: Date.parse("2026-08-01T00:00:00Z") });
        assertEq(gen.docType, "client-technical", "the generated record is client technical documentation");
        assertEq(gen.circuitId, s.circuit.id, "it references the circuit");
        assertEq(gen.warnings.length, 2, "over-cap and cost-drift are flagged: " + JSON.stringify(gen.warnings));
        assert(gen.body.startsWith("# Reseller billing & usage"), "the title is the first line");
        assert(gen.body.includes("40 GBP"), "the wholesale cost is substituted");
        assert(gen.body.includes("100 GBP"), "the sell price is substituted");
        assert(gen.body.includes("500 GB"), "the data cap is substituted");
        assert(gen.body.includes("1.5 GBP per GB over"), "the overage rate is substituted");
        assert(gen.body.includes("Carrier portal"), "the usage source is named");
        assert(gen.body.includes("640 GB"), "the latest usage is substituted");
        assert(gen.body.includes("140 GB over"), "the overage is described");
        for (const heading of ["Circuit", "Commercial summary", "Billing cycle & proration", "Data cap & overage", "Usage monitoring & reporting", "Usage readings", "Reconciliation against the sold plan"]) {
          assert(gen.body.includes("## " + heading), `the body contains the “${heading}” section`);
        }

        const bare = generateCircuitBillingRecord({ circuit: { id: "x", type: "flexibleAssets", name: "Bare", assetFields: { carrier: "X" } }, set });
        assert(bare.warnings.some((w) => w.code === "billing-no-pricing"), "a bare circuit warns about missing pricing");
        assert(bare.body.includes("TO COMPLETE"), "the gaps are marked TO COMPLETE");
      },
    },
    {
      name: "generateClientBillingRecord rolls the whole client up, and a generated record round-trips through storage",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-billing" });
        const s = await seed(world);
        let set = await world.docs.get(s.set.id, { force: true });
        const gen = generateClientBillingRecord({ set, now: Date.parse("2026-08-01T00:00:00Z") });
        assertEq(gen.docType, "client-technical", "the client record is client technical documentation");
        assert(gen.body.startsWith("# Reseller billing & usage summary"), "the title is the first line");
        assert(gen.body.includes("Aurora 500 — HO"), "the circuit is named in the table");
        assert(gen.body.includes("Annualised"), "the annualised summary is present");
        for (const heading of ["Commercial summary", "Circuits", "Billing cycles", "Findings"]) {
          assert(gen.body.includes("## " + heading), `the body contains the “${heading}” section`);
        }

        const r = (await world.docs.addDocument(s.set.id, {
          name: gen.name,
          docType: gen.docType,
          summary: gen.summary,
          body: gen.body,
          tags: ["circuit", "billing", "usage", "reseller"],
          origin: { source: "docset", warnings: gen.warnings, generatedAt: gen.generatedAt },
          ...CL,
        }, { updatedBy: "Tom", actor: "Tom" })).record;
        set = await world.docs.get(s.set.id, { force: true });
        const stored = set.records.documents.find((x) => x.id === r.id);
        assertEq(stored.body.length, gen.body.length, "the full generated body is stored");
        assertEq(stored.docType, "client-technical", "the document type is stored");
        assert((await world.docs.integrity(s.set.id)).ok, "the set's graph audit still passes");
      },
    },
    {
      name: "the WAN circuit template carries the new billing fields",
      fn: () => {
        const type = builtinAssetType(WAN_CIRCUIT_TYPE_ID);
        assert(type, "the WAN circuit template exists");
        const keys = type.fields.map((f) => f.key);
        for (const key of ["billingCycle", "billingDay", "proration", "dataCap", "dataCapPeriod", "overageRate", "overageTreatment", "usageMonitoring", "usageReadings"]) {
          assert(keys.includes(key), `the template has the ${key} field`);
        }
        assert(type.fields.find((f) => f.key === "billingCycle").options.length >= 3, "the billing cycle is a select of the cycle catalog");
        assert(type.fields.find((f) => f.key === "overageTreatment").options.length >= 4, "the overage treatment is a select of the overage catalog");
      },
    },
  ]);
}
