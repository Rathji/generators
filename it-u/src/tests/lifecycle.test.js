// src/tests/lifecycle.test.js — validation tests for roadmap task 26
// ("Expiry aggregation"). Run in the live page:
//   await import("./src/tests/lifecycle.test.js").then((m) => m.run())
//
// Covers: the lifecycle-kind catalog (every dated thing IT-U knows about, with
// its default lead/due-soon window); the state classifier; effective lead-time
// resolution (per-kind config and per-record override); extraction of every
// dated item from a documentation set — domain expiry, certificate expiry,
// warranty / support / end-of-life dates on configurations, a flexible asset's
// expiry field (via its template) and a document's computed next-review date;
// and the roll-ups the station needs — by state, by kind, by group and PER
// ASSET. Ends by running the whole aggregate through the docs service.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  LIFECYCLE_KINDS,
  LIFECYCLE_GROUPS,
  LIFECYCLE_STATES,
  lifecycleKind,
  kindsOfGroup,
  lifecycleStateDef,
  classifyLifecycle,
  kindLeadDays,
  kindDueSoonDays,
  recordLeadDays,
  daysUntil,
  makeLifecycleItem,
  lifecycleItemId,
  extractLifecycleItems,
  sortLifecycle,
  lifecycleCounts,
  worstState,
  groupByAsset,
  rollUpLifecycle,
  collectLifecycle,
  lifecyclePhrase,
  lifecycleSourceLine,
} from "../framework/lifecycle.js";

const C = { informationModel: "core-asset", provenance: "authored" };
// Local midnight, 15 June 2026.
const NOW = new Date(2026, 5, 15).getTime();
const iso = (d) => new Date(d).toISOString().slice(0, 10);

// A template with an expiry-flagged date field, for the asset-expiry kind.
const LICENCE_TYPE = {
  id: "licence",
  name: "Licence",
  fields: [
    { key: "vendor", label: "Vendor", type: "text" },
    { key: "expiryDate", label: "Renewal / expiry date", type: "date", expiry: true },
  ],
};
const typeOf = (record) => (record && record.type === "flexibleAssets" ? LICENCE_TYPE : null);

async function seed(ns = "kb-lifecycle-1") {
  const { docs } = await makeWorld(ns);
  const set = await docs.create({ name: "Acme Corp", createdBy: "tester" });
  const id = set.id;
  const add = (type, input) => docs.addRecord(id, { type, ...C, ...input }, { updatedBy: "tester" });
  await add("domains", { name: "example.com", expiresAt: "2026-06-20", registrar: "Namecheap" });
  await add("domains", { name: "lapsed.com", expiresAt: "2026-05-01" });
  await add("certificates", { name: "www.example.com", validTo: "2026-07-01", issuer: "Let’s Encrypt" });
  await add("configurations", { name: "web-01", configType: "server-physical", warrantyExpiryDate: "2026-06-10", supportExpiryDate: "2026-12-31", endOfLifeDate: "2027-06-01" });
  await add("configurations", { name: "fw-01", configType: "firewall" });
  await add("flexibleAssets", { name: "M365 Business", assetTypeId: "licence", assetFields: { vendor: "Microsoft", expiryDate: "2026-06-25" } });
  await add("documents", { name: "Rebuild runbook", docType: "reference", reviewIntervalDays: 365, reviewedAt: "2025-06-01" });
  const set2 = await docs.get(id, { force: true });
  return { docs, id, set: set2 };
}

const tests = [
  ["the lifecycle-kind catalog covers every dated thing, with sane defaults", () => {
    assertEq(LIFECYCLE_KINDS.length, 8, "expected eight lifecycle kinds");
    for (const k of LIFECYCLE_KINDS) {
      assert(k.id && k.label && k.subject && k.collection, `kind ${k.id} has identity fields`);
      assert(typeof k.defaultLeadDays === "number" && k.defaultLeadDays >= 0, `kind ${k.id} lead days`);
      assert(typeof k.dueSoonDays === "number" && k.dueSoonDays >= 0, `kind ${k.id} due-soon window`);
    }
    assert(lifecycleKind("certificate-expiry"), "certificate kind is found");
    assertEq(lifecycleKind("nope"), null, "unknown kind is null");
    assertEq(kindsOfGroup("Hardware").length, 3, "warranty + support + EOL live under Hardware");
    assert(LIFECYCLE_GROUPS.includes("Domains & certificates"), "the domains group exists");
    // task 39 added the number-port kind: a voice-PBX asset's port date.
    const port = lifecycleKind("number-port");
    assert(port && port.dynamic === "voice-port", "the number-port kind exists");
    assertEq(kindsOfGroup("Voice & numbering").length, 1, "the voice & numbering group holds it");
    assertEq(port.dueSoonDays, 7, "port dates escalate sooner than most");
  }],

  ["the state classifier maps day-counts to the five states", () => {
    assertEq(classifyLifecycle(null), "none");
    assertEq(classifyLifecycle(-1, { leadDays: 60, dueSoonDays: 14 }), "overdue");
    assertEq(classifyLifecycle(0, { leadDays: 60, dueSoonDays: 14 }), "due-soon");
    assertEq(classifyLifecycle(14, { leadDays: 60, dueSoonDays: 14 }), "due-soon");
    assertEq(classifyLifecycle(15, { leadDays: 60, dueSoonDays: 14 }), "upcoming");
    assertEq(classifyLifecycle(60, { leadDays: 60, dueSoonDays: 14 }), "upcoming");
    assertEq(classifyLifecycle(61, { leadDays: 60, dueSoonDays: 14 }), "ok");
    assertEq(LIFECYCLE_STATES.map((s) => s.id).join(","), "overdue,due-soon,upcoming,ok,none");
    assertEq(lifecycleStateDef("overdue").tone, "danger");
  }],

  ["lead times resolve kind-default → config → per-record", () => {
    const cert = lifecycleKind("certificate-expiry");
    assertEq(kindLeadDays(cert, null), 30, "certificate default lead");
    assertEq(kindLeadDays(cert, { leadDays: { "certificate-expiry": 45 } }), 45, "configured lead wins");
    assertEq(kindDueSoonDays(cert, { dueSoonDays: { "certificate-expiry": 7 } }), 7, "configured due-soon wins");
    // a domain may carry its own alert window
    const dom = lifecycleKind("domain-expiry");
    assertEq(recordLeadDays({ renewalAlertDays: 120 }, dom, null), 120, "per-record override");
    assertEq(recordLeadDays({}, dom, null), 60, "falls back to kind default");
    // a configuration kind does not honour a record-level override
    const war = lifecycleKind("warranty-expiry");
    assertEq(recordLeadDays({ renewalAlertDays: 5 }, war, null), 60, "config warranty ignores per-record lead");
    assertEq(recordLeadDays({}, war, { leadDays: { "warranty-expiry": 90 } }), 90, "but honours config");
  }],

  ["daysUntil is measured from local midnight", () => {
    assertEq(daysUntil(new Date(2026, 5, 20), NOW), 5);
    assertEq(daysUntil(new Date(2026, 5, 1), NOW), -14);
    assertEq(daysUntil(null, NOW), null);
  }],

  ["an item carries its kind, source, field, date and state", () => {
    const kindDef = lifecycleKind("domain-expiry");
    const record = { id: "dom-1", type: "domains", name: "example.com", expiresAt: "2026-06-20" };
    const item = makeLifecycleItem({ kindDef, record, field: "expiresAt", fieldLabel: "Expiry date", date: new Date(2026, 5, 20), now: NOW, config: null });
    assertEq(item.kind, "domain-expiry");
    assertEq(item.sourceName, "example.com");
    assertEq(item.iso, "2026-06-20");
    assertEq(item.daysUntil, 5);
    assertEq(item.state, "due-soon");
    assertEq(item.undated, false);
    assertEq(item.id, lifecycleItemId("domain-expiry", { type: "domains", id: "dom-1" }, "expiresAt"));
    assertEq(lifecyclePhrase(item), "in 5 days");
  }],

  ["extraction reads every dated item across the record types", async () => {
    const { set } = await seed("kb-lifecycle-2");
    const items = extractLifecycleItems(set, { now: NOW, typeOf });
    const byKind = (k) => items.filter((i) => i.kind === k);
    assertEq(byKind("domain-expiry").length, 2, "two domains");
    assertEq(byKind("certificate-expiry").length, 1, "one certificate");
    assertEq(byKind("warranty-expiry").length, 1, "web-01 has a warranty");
    assertEq(byKind("support-expiry").length, 1, "web-01 has support");
    assertEq(byKind("hardware-eol").length, 1, "web-01 has an EOL date");
    assertEq(byKind("asset-expiry").length, 1, "the licence template has an expiry field");
    assertEq(byKind("document-review").length, 1, "the document has a review cadence");
    // The firewall has no dates, so it contributes nothing.
    assert(!items.some((i) => i.sourceName === "fw-01"), "an undated configuration contributes no items");
    // A domain with no expiry date IS surfaced (a missing date is itself a finding)…
    const undatedSet = { records: { domains: [{ id: "dom-x", type: "domains", name: "nodate.com" }] } };
    const withUndated = extractLifecycleItems(undatedSet, { now: NOW });
    assertEq(withUndated.length, 1, "an undated domain is flagged");
    assert(withUndated[0].state === "none" && withUndated[0].undated, "…as an undated item");
    assertEq(extractLifecycleItems(undatedSet, { now: NOW, includeUndated: false }).length, 0, "undated items can be dropped");
    // …but an optional date (warranty/EOL/…) that was never recorded yields nothing.
    const cfgSet = { records: { configurations: [{ id: "cfg-x", type: "configurations", name: "spare", configType: "server-physical" }] } };
    assertEq(extractLifecycleItems(cfgSet, { now: NOW, typeOf }).length, 0, "optional undated dates contribute nothing");
  }],

  ["a flexible asset is only watched when its template tracks expiry", () => {
    const set = { records: { flexibleAssets: [{ id: "fx-1", type: "flexibleAssets", name: "Server build", assetTypeId: "server", assetFields: {} }] } };
    assertEq(extractLifecycleItems(set, { now: NOW, typeOf: () => ({ id: "server", name: "Server", fields: [{ key: "cpu", type: "text" }] }) }).length, 0, "no expiry field → not a lifecycle item");
    assertEq(extractLifecycleItems(set, { now: NOW, typeOf: () => null }).length, 0, "unknown template → skipped");
  }],

  ["the license item takes its label from the template field", async () => {
    const { set } = await seed("kb-lifecycle-3");
    const item = extractLifecycleItems(set, { now: NOW, typeOf }).find((i) => i.kind === "asset-expiry");
    assertEq(item.field, "expiryDate");
    assertEq(item.fieldLabel, "Renewal / expiry date");
    assertEq(item.typeName, "Licence");
    assertEq(item.daysUntil, 10);
    assertEq(item.state, "due-soon");
  }],

  ["the document item uses its computed next-review date", async () => {
    const { set } = await seed("kb-lifecycle-4");
    const item = extractLifecycleItems(set, { now: NOW, typeOf }).find((i) => i.kind === "document-review");
    assertEq(item.iso, "2026-06-01");
    assertEq(item.daysUntil, -14);
    assertEq(item.state, "overdue");
  }],

  ["the roll-up counts, groups, and orders by urgency", async () => {
    const { set } = await seed("kb-lifecycle-5");
    const agg = rollUpLifecycle(extractLifecycleItems(set, { now: NOW, typeOf }));
    assertEq(agg.counts.overdue, 3, "lapsed.com + warranty + doc review are overdue");
    assertEq(agg.counts["due-soon"], 2, "example.com + licence are due soon");
    assertEq(agg.counts.upcoming, 1, "the certificate is upcoming");
    assertEq(agg.counts.total, 8, "eight items in total");
    assertEq(agg.counts.tracked, 8, "all dated");
    // urgency order: -14, -5, -14 sorted ascending → negative first
    const first = agg.items[0];
    assert(first.daysUntil < 0, "the list starts with the most overdue item");
    for (let i = 1; i < agg.items.length; i += 1) assert(agg.items[i - 1].daysUntil <= agg.items[i].daysUntil, "items are soonest-first");
    assertEq(agg.attention.length, 6, "overdue + due-soon + upcoming = attention");
    assertEq(agg.groups[0].label, "Domains & certificates", "groups keep catalog order");
    assertEq(agg.byKind["warranty-expiry"].counts.overdue, 1, "warranty roll-up");
  }],

  ["items group per asset, with the soonest and worst state surfaced", async () => {
    const { set } = await seed("kb-lifecycle-6");
    const agg = rollUpLifecycle(extractLifecycleItems(set, { now: NOW, typeOf }));
    const web = agg.assets.find((a) => a.name === "web-01");
    assert(web, "web-01 is one asset");
    assertEq(web.items.length, 3, "warranty + support + EOL share one asset");
    assertEq(web.state, "overdue", "the worst state wins");
    assertEq(web.next.field, "warrantyExpiryDate", "soonest item surfaced");
    // assets are ordered by their soonest item
    assertEq(agg.assets[0].state, "overdue", "an overdue asset leads");
    assert(agg.assets.some((a) => a.name === "M365 Business"), "the licence is its own asset");
    assertEq(worstState([]), "none");
    assertEq(groupByAsset([]).length, 0);
  }],

  ["the docs service exposes the per-client lifecycle aggregate", async () => {
    const { docs, id } = await seed("kb-lifecycle-7");
    const agg = await docs.lifecycle(id, { now: NOW, typeOf });
    assertEq(agg.counts.total, 8, "service aggregate matches");
    assertEq(agg.counts.overdue, 3);
    let threw = false;
    try {
      await docs.lifecycle("docset-nope", { now: NOW });
    } catch (e) {
      threw = /No documentation set/.test(e.message);
    }
    assert(threw, "an unknown set is refused");
  }],

  ["lifecycleSourceLine describes an item's source", async () => {
    const { set } = await seed("kb-lifecycle-8");
    const items = extractLifecycleItems(set, { now: NOW, typeOf });
    const domain = items.find((i) => i.kind === "domain-expiry");
    assert(/example\.com/.test(lifecycleSourceLine(domain)), "domain source line names the record");
    const licence = items.find((i) => i.kind === "asset-expiry");
    assert(/M365 Business · Licence/.test(lifecycleSourceLine(licence)), "licence source line names the template");
  }],
];

export async function run() {
  return runTests(tests.map(([name, fn]) => ({ name, fn })));
}
