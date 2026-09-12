// src/tests/search.test.js — validation tests for Phase 11 task 45
// ("Search & relationship navigation"). Run in the live page:
//   await import("./src/tests/search.test.js").then((m) => m.run())
//
// Covers: `recordSearchText` flattening nested fields while skipping secrets;
// `buildSearchIndex` covering every searchable collection and attaching the
// classification and worst lifecycle state; `searchRecords` (AND semantics,
// name-over-body ranking, and every filter — collection, information model,
// provenance, client, lifecycle attention and expiry window); `searchFacets`;
// `buildCombinedIndex` across clients; `recordNeighbors` (both directions,
// grouped by kind); `relationshipGraph` (depth expansion, deduped edges);
// `shortestPath` (multi-hop route); `summarizeRecord`; and an end-to-end pass
// over the live documentation service.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { RECORD_TYPES } from "../framework/docsets.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import {
  SEARCHABLE_COLLECTIONS,
  recordSearchText,
  buildSearchIndex,
  buildCombinedIndex,
  searchRecords,
  searchFacets,
  recordNeighbors,
  relationshipGraph,
  shortestPath,
  summarizeRecord,
} from "../framework/search.js";

const CL = { informationModel: "core-asset", provenance: "authored" };
const NOW = Date.parse("2026-08-01T00:00:00Z");

// A hand-built documentation set with one record in every collection plus a
// small, known relationship graph (application → server → credential, and
// application → vendor). Construction bypasses the validators on purpose: the
// search engine is pure and must work on any set shape.
function makeSet() {
  const records = {};
  for (const t of RECORD_TYPES) records[t] = [];
  const put = (type, id, name, extra = {}) => {
    const r = { id, type, name, informationModel: "core-asset", provenance: "authored", createdAt: NOW, updatedAt: NOW, ...extra };
    records[type].push(r);
    return r;
  };
  put("organizations", "org-1", "Acme Corp", { orgKind: "organization" });
  put("locations", "loc-1", "Head Office", { locationType: "office" });
  put("contacts", "con-1", "Jane Doe", { contactRole: "owner" });
  put("configurations", "cfg-srv", "SRV-01", { configType: "server" });
  put("passwords", "pwd-1", "Billing DB password", { scope: "general", category: "user-account", secret: "sup3r-secret-value" });
  put("documents", "doc-rb", "Billing operations guide", { docType: "sop" });
  put("sites", "site-1", "Acme HQ site", { siteType: "head-office" });
  put("diagrams", "dia-1", "Network diagram", { diagramType: "network" });
  put("checklists", "chk-1", "Deploy checklist", { items: [] });
  put("flexibleAssets", "fx-app", "Acme Billing", {
    assetTypeId: "atype-applications",
    assetFields: { vendor: "Acme Software Ltd", environment: "production", url: "https://billing.acme.example" },
    informationModel: "flexible-asset",
    provenance: "imported",
    origin: { source: "CSV import" },
  });
  put("flexibleAssets", "fx-vendor", "Acme Software Ltd", { assetTypeId: "atype-vendor", informationModel: "flexible-asset" });
  put("trackers", "trk-1", "SSL renewal tracker");
  put("domains", "dom-1", "acme.example", { expiresAt: "2026-08-10" });
  put("certificates", "cert-1", "acme.example certificate", { validTo: "2026-07-15" });
  put("runbooks", "run-1", "Deploy Acme Billing", { runbookType: "deployment" });
  records.relationships.push(
    { id: "r1", type: "relationships", kind: "application-server", from: { type: "flexibleAssets", id: "fx-app" }, to: { type: "configurations", id: "cfg-srv" }, createdAt: NOW, updatedAt: NOW },
    { id: "r2", type: "relationships", kind: "configuration-credential", from: { type: "configurations", id: "cfg-srv" }, to: { type: "passwords", id: "pwd-1" }, createdAt: NOW, updatedAt: NOW },
    { id: "r3", type: "relationships", kind: "application-vendor", from: { type: "flexibleAssets", id: "fx-app" }, to: { type: "flexibleAssets", id: "fx-vendor" }, createdAt: NOW, updatedAt: NOW },
  );
  const set = { id: "docset-acme", name: "Acme", kind: "organization", schema: "itu-docset/1", createdAt: NOW, updatedAt: NOW, records };
  const index = buildSearchIndex(set, { client: { id: "docset-acme", name: "Acme" }, now: NOW });
  return { set, index, find: (collection, id) => index.entries.find((e) => e.collection === collection && e.ref.id === id) };
}

export async function run() {
  return runTests([
    {
      name: "recordSearchText flattens nested fields and never indexes secrets",
      fn: () => {
        const { set } = makeSet();
        const app = set.records.flexibleAssets.find((r) => r.id === "fx-app");
        const text = recordSearchText(app);
        assert(text.includes("Acme Billing"), "the name is indexed");
        assert(text.includes("Acme Software Ltd"), "a nested assetField is indexed");
        assert(text.includes("https://billing.acme.example"), "a nested URL is indexed");
        assert(text.includes("production"), "a select value is indexed");
        const pwd = set.records.passwords.find((r) => r.id === "pwd-1");
        const ptext = recordSearchText(pwd);
        assert(ptext.includes("Billing DB password"), "a credential's name is indexed");
        assert(!ptext.includes("sup3r-secret-value"), "a credential's secret is never indexed");
        assertEq(recordSearchText({}), "", "an empty record yields empty text");
      },
    },
    {
      name: "buildSearchIndex covers every searchable collection and carries the classification",
      fn: () => {
        const { index, set } = makeSet();
        const covered = new Set(index.entries.map((e) => e.collection));
        for (const c of SEARCHABLE_COLLECTIONS) assert(covered.has(c), `the ${c} collection is indexed`);
        assert(!covered.has("relationships"), "typed links are not indexed as records");
        assertEq(index.entries.length, SEARCHABLE_COLLECTIONS.reduce((n, c) => n + set.records[c].length, 0), "one entry per seeded record");
        assertEq(index.client.id, "docset-acme", "the client is attached to the index");
        const app = index.entries.find((e) => e.ref.id === "fx-app");
        assertEq(app.informationModel, "flexible-asset", "the information model is carried");
        assertEq(app.provenance, "imported", "the provenance is carried");
        assertEq(app.modelLabel, "Flexible Asset", "the model label is resolved");
        assertEq(app.provenanceLabel, "Imported once", "the provenance label is resolved");
        assertEq(app.key, "flexibleAssets:fx-app", "the entry key is the record ref");
        assert(typeof app.haystack === "string" && app.haystack.length > app.name.length, "the haystack carries more than the name");
      },
    },
    {
      name: "buildSearchIndex attaches the worst lifecycle state and the soonest expiry",
      fn: () => {
        const { find } = makeSet();
        const dom = find("domains", "dom-1");
        assertEq(dom.lifecycle, "due-soon", "a domain expiring in about a week is due soon");
        assert(dom.expiryDays >= 9 && dom.expiryDays <= 10, "the soonest expiry is about nine days away (got " + dom.expiryDays + ")");
        assertEq(dom.expiryDate, "2026-08-10", "the expiry date is carried");
        const cert = find("certificates", "cert-1");
        assertEq(cert.lifecycle, "overdue", "a lapsed certificate is overdue");
        assert(cert.expiryDays < 0, "the overdue expiry is negative");
        const org = find("organizations", "org-1");
        assertEq(org.lifecycle, "none", "an undated record has no lifecycle state");
        assertEq(org.expiryDays, null, "an undated record has no expiry window");
      },
    },
    {
      name: "searchRecords matches an AND of terms and ranks a name hit above a body-only hit",
      fn: () => {
        const { index } = makeSet();
        const r = searchRecords(index, "acme billing");
        assert(r.total >= 1, "the query matches");
        assertEq(r.results[0].name, "Acme Billing", "the closest name ranks first");
        assert(r.terms.length === 2, "the query is split into terms");

        assertEq(searchRecords(index, "SRV-01").total, 1, "an exact unique term finds one record");
        assertEq(searchRecords(index, "billing nonexistentzzz").total, 0, "every term must match");
        assertEq(searchRecords(index, "   ").total, index.entries.length, "a blank query returns everything");

        const byExample = searchRecords(index, "example");
        const bodyOnly = byExample.results.find((e) => e.collection === "flexibleAssets");
        const nameHit = byExample.results.find((e) => e.collection === "domains");
        assert(bodyOnly && nameHit, "both the name hit and the body-only hit are present");
        assert(byExample.results.indexOf(nameHit) < byExample.results.indexOf(bodyOnly), "a name hit outranks a body-only hit");
      },
    },
    {
      name: "searchRecords filters by collection, information model, provenance and client",
      fn: () => {
        const { index } = makeSet();
        assertEq(searchRecords(index, "", { collection: "domains" }).total, 1, "the collection filter narrows to one domain");
        assertEq(searchRecords(index, "", { informationModel: "flexible-asset" }).total, 2, "the model filter finds both flexible assets");
        assertEq(searchRecords(index, "", { provenance: "imported" }).total, 1, "the provenance filter finds the imported app");
        assertEq(searchRecords(index, "", { client: "docset-acme" }).total, index.entries.length, "the client filter keeps a matching client");
        assertEq(searchRecords(index, "", { client: "docset-other" }).total, 0, "a non-matching client finds nothing");
        assertEq(searchRecords(index, "", { collection: "domains", informationModel: "flexible-asset" }).total, 0, "filters combine with AND");
      },
    },
    {
      name: "searchRecords filters by lifecycle attention and expiry window",
      fn: () => {
        const { index } = makeSet();
        assertEq(searchRecords(index, "", { lifecycle: "attention" }).total, 2, "both dated records need attention");
        assertEq(searchRecords(index, "", { lifecycle: "overdue" }).total, 1, "the overdue filter finds the certificate");
        assertEq(searchRecords(index, "", { expiryDays: 0 }).total, 1, "a zero-day window means already expired");
        assertEq(searchRecords(index, "", { expiryDays: 30 }).total, 2, "a 30-day window covers both dated records");
        assertEq(searchRecords(index, "", { expiryWindow: 5 }).total, 1, "the expiryWindow alias works");
        assertEq(searchRecords(index, "", { expiryDays: 30, collection: "domains" }).total, 1, "a window combines with other filters");
      },
    },
    {
      name: "searchFacets reports the counts the filter controls need",
      fn: () => {
        const { index } = makeSet();
        const facets = searchFacets(index.entries);
        const domFacet = facets.collection.find((f) => f.value === "domains");
        assert(domFacet && domFacet.count === 1, "the collection facet counts one domain");
        assertEq(facets.collection.find((f) => f.value === "flexibleAssets").count, 2, "two flexible assets");
        assert(facets.informationModel.find((f) => f.value === "flexible-asset" && f.count === 2), "the model facet counts the flexible assets");
        assert(facets.provenance.find((f) => f.value === "imported" && f.count === 1), "the provenance facet counts the imported record");
        assert(facets.lifecycle.find((f) => f.value === "overdue" && f.count === 1), "the lifecycle facet counts the overdue record");
        assert(facets.client.find((f) => f.value === "docset-acme"), "the client facet names the client");
        const filtered = searchRecords(index, "", { collection: "domains" });
        assertEq(filtered.filteredFacets.collection.length, 1, "the filtered facets reflect the narrowed set");
      },
    },
    {
      name: "buildCombinedIndex searches across every client's sets",
      fn: () => {
        const a = makeSet();
        const beta = JSON.parse(JSON.stringify(a.set));
        beta.id = "docset-beta";
        beta.name = "Beta";
        const betaIndex = buildSearchIndex(beta, { client: { id: "docset-beta", name: "Beta" }, now: NOW });
        const combined = buildCombinedIndex([a.set, beta], { now: NOW });
        assertEq(combined.entries.length, a.index.entries.length + betaIndex.entries.length, "entries from both sets are combined");
        const clients = new Set(combined.entries.map((e) => e.client.id));
        assert(clients.has("docset-acme") && clients.has("docset-beta"), "both clients appear");
        const r = searchRecords(combined, "acme billing");
        assertEq(r.total, 4, "the term matches both records that carry it in both clients");
        assertEq(searchRecords(combined, "acme billing", { client: "docset-beta" }).total, 2, "the client filter narrows to one set");
      },
    },
    {
      name: "recordNeighbors groups a record's links by kind and direction",
      fn: () => {
        const { set } = makeSet();
        const groups = recordNeighbors(set, { type: "flexibleAssets", id: "fx-app" });
        const outKinds = groups.filter((g) => g.direction === "out").map((g) => g.kind);
        assert(outKinds.includes("application-server"), "the server link is a forward group");
        assert(outKinds.includes("application-vendor"), "the vendor link is a forward group");

        const srvGroups = recordNeighbors(set, { type: "configurations", id: "cfg-srv" });
        const inbound = srvGroups.find((g) => g.kind === "application-server" && g.direction === "in");
        assert(inbound && inbound.items[0].name === "Acme Billing", "the server sees the application inbound");
        const outbound = srvGroups.find((g) => g.kind === "configuration-credential" && g.direction === "out");
        assert(outbound && outbound.items[0].name === "Billing DB password", "the server sees its credential outbound");

        const none = recordNeighbors(set, { type: "organizations", id: "org-1" });
        assertEq(none.length, 0, "an unlinked record has no neighbours");
        assertEq(recordNeighbors(set, null).length, 0, "a null ref yields no neighbours");
      },
    },
    {
      name: "relationshipGraph expands to the requested depth without duplicating edges",
      fn: () => {
        const { set } = makeSet();
        const g1 = relationshipGraph(set, { type: "flexibleAssets", id: "fx-app" }, { depth: 1 });
        assertEq(g1.nodes.length, 3, "depth 1 reaches the server and the vendor");
        assertEq(g1.edges.length, 2, "depth 1 sees two links");
        assert(g1.root.isRoot, "the root node is marked");
        assert(g1.nodes.filter((n) => n.isRoot).length === 1, "exactly one root");

        const g2 = relationshipGraph(set, { type: "flexibleAssets", id: "fx-app" }, { depth: 2 });
        assertEq(g2.nodes.length, 4, "depth 2 also reaches the credential");
        assertEq(g2.edges.length, 3, "depth 2 sees all three links");
        const cred = g2.nodes.find((n) => n.ref.id === "pwd-1");
        assertEq(cred.depth, 2, "the credential is two hops away");

        const srv = relationshipGraph(set, { type: "configurations", id: "cfg-srv" }, { depth: 1 });
        assertEq(srv.edges.length, 2, "the same link is not duplicated when seen from either end");
      },
    },
    {
      name: "shortestPath finds the multi-hop route between two records",
      fn: () => {
        const { set } = makeSet();
        const app = { type: "flexibleAssets", id: "fx-app" };
        const cred = { type: "passwords", id: "pwd-1" };
        const path = shortestPath(set, app, cred);
        assertEq(path.length, 3, "the credential is two links from the application");
        assertEq(path[0].id, "fx-app", "the path starts at the application");
        assertEq(path[1].id, "cfg-srv", "the path passes through the server");
        assertEq(path[2].id, "pwd-1", "the path ends at the credential");

        assertEq(shortestPath(set, app, { type: "flexibleAssets", id: "fx-vendor" }).length, 2, "a directly linked record is one hop");
        assertEq(shortestPath(set, app, app).length, 1, "a record is trivially its own path");
        assertEq(shortestPath(set, app, { type: "organizations", id: "org-1" }), null, "a disconnected record has no path");
      },
    },
    {
      name: "summarizeRecord produces the one-line detail for a row or chip",
      fn: () => {
        const { set } = makeSet();
        const app = set.records.flexibleAssets.find((r) => r.id === "fx-app");
        const line = summarizeRecord(app, set, { assetTypes: [builtinAssetType("atype-applications")] });
        assert(line.includes("Applications"), "the asset type is named");
        assert(line.includes("Acme Software Ltd"), "a filled field is shown");
      },
    },
    {
      name: "the live documentation service produces an index whose links traverse end to end",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-search" });
        const set = await world.docs.create({ name: "Acme" });
        const app = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme Billing", assetTypeId: "atype-applications", assetFields: { vendor: "Acme Software Ltd" }, informationModel: "flexible-asset", provenance: "authored" })).record;
        const srv = (await world.docs.addRecord(set.id, { type: "configurations", name: "SRV-01", configType: "server-physical", ...CL })).record;
        const cred = (await world.docs.addRecord(set.id, { type: "passwords", name: "Billing DB password", scope: "general", category: "user-account", ...CL })).record;
        await world.docs.linkRecords(set.id, { from: { type: "flexibleAssets", id: app.id }, to: { type: "configurations", id: srv.id }, kind: "application-server", createdBy: "Tom" });
        await world.docs.linkRecords(set.id, { from: { type: "configurations", id: srv.id }, to: { type: "passwords", id: cred.id }, kind: "configuration-credential", createdBy: "Tom" });

        const fresh = await world.docs.get(set.id, { force: true });
        const index = buildSearchIndex(fresh, { client: { id: fresh.id, name: fresh.name }, now: NOW });
        assertEq(index.entries.length, 3, "all three records are indexed");
        const found = searchRecords(index, "acme billing");
        assertEq(found.total, 1, "the application is found");
        assertEq(found.results[0].ref.id, app.id, "the result is the application");

        const neighbors = recordNeighbors(fresh, { type: "flexibleAssets", id: app.id });
        assertEq(neighbors.length, 1, "the application has one neighbour group");
        assertEq(neighbors[0].items[0].ref.id, srv.id, "the neighbour is the server");

        const path = shortestPath(fresh, { type: "flexibleAssets", id: app.id }, { type: "passwords", id: cred.id });
        assertEq(path.length, 3, "the application reaches its credential through the server");
        assert((await world.docs.integrity(set.id)).ok, "the set's graph audit still passes");
      },
    },
  ]);
}
