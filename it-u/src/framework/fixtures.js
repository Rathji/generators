// src/framework/fixtures.js — the fixture documentation sets (roadmap task 52).
//
// Task 52 needs documentation sets to run the integrity suite against: sets that
// exercise all four information models, the integration-managed and imported
// provenance cases, and an older schema. These fixtures are shipped, pure data
// builders — no store, no network — so a test (or the user) can audit them
// instantly, or seed one into the repository to explore.
//
//   • `fixture-tsp-demo` — a healthy, fully-classified client set covering every
//     information model (Core Asset, Flexible Asset, Document, Integration-
//     managed) plus an imported record, wired with real relationships. The
//     integrity suite is expected to PASS it.
//   • `fixture-legacy` — an older-schema set (schema `itu-docset/0`, missing
//     record buckets, an unclassified record, a missing required field and a
//     dangling relationship). The integrity suite is expected to CATCH each gap,
//     which is what makes the suite trustworthy.
//
// Keeping the fixtures here (rather than inline in a test) means the legacy
// fixture documents the migration contract: `ensureRecordBuckets` brings the
// shape forward, and the suite reports whatever remains.

import { emptyDocSet, RECORD_TYPES } from "./docsets.js";
import { makeRelationship } from "./relationships.js";

const FIXED_NOW = 1767225600000; // 2026-01-01T00:00:00Z

const CORE = { informationModel: "core-asset", provenance: "authored" };
const FLEX = { informationModel: "flexible-asset", provenance: "authored" };
const DOC = { informationModel: "document", provenance: "authored" };

// ---- the healthy fixture ----------------------------------------------------
function tspDemoRecords() {
  return [
    {
      id: "org_acme", type: "organizations", name: "Acme Demo Co", ...CORE,
      orgKind: "organization", industry: "Manufacturing", website: "https://acme-demo.example",
    },
    {
      id: "org_imported", type: "organizations", name: "Imported Legacy Dept", ...CORE,
      provenance: "imported", origin: { source: "Old-tool CSV export" }, orgKind: "department",
    },
    {
      id: "loc_hq", type: "locations", name: "Head Office", ...CORE,
      locationType: "office", city: "Brisbane", region: "QLD",
    },
    {
      id: "con_jo", type: "contacts", name: "Jo Bloggs", ...CORE,
      contactRole: "client-primary", email: "jo@acme-demo.example",
    },
    {
      id: "cfg_srv", type: "configurations", name: "DC-SRV-01", ...CORE,
      configType: "server-virtual", hostname: "dc-srv-01.acme-demo.example", ipAddresses: ["10.0.0.10"],
    },
    {
      id: "cfg_rmm", type: "configurations", name: "RMM Agent Host", ...CORE,
      informationModel: "integration", provenance: "synchronized",
      origin: { source: "Acme RMM", authority: "Acme RMM", synced: { hostname: "rmm-01.acme-demo.example" } },
      configType: "server-physical", hostname: "rmm-01.acme-demo.example",
    },
    {
      id: "fx_crm", type: "flexibleAssets", name: "Line-of-business CRM", ...FLEX,
      assetTypeId: "application", assetFields: { vendor: "Contoso", environment: "cloud" },
    },
    {
      id: "doc_sop", type: "documents", name: "Server build SOP", ...DOC,
      docType: "sop", tags: ["sop"], body: "# Purpose\n\nHow a server is built.\n\n## Procedure\n\n1. Rack it.\n2. Patch it.\n",
    },
    {
      id: "chk_onboard", type: "checklists", name: "New user onboarding", ...DOC,
      items: [{ id: "s1", text: "Create the account", done: false }, { id: "s2", text: "Assign a licence", done: false }],
    },
    {
      id: "pwd_crm", type: "passwords", name: "CRM service account", ...CORE,
      scope: "general", category: "service-account", username: "svc-crm", secret: "placeholder-not-a-real-secret",
    },
    { id: "dom_site", type: "domains", name: "acme-demo.example", ...CORE, expiresAt: "2027-03-01" },
    { id: "cert_site", type: "certificates", name: "www.acme-demo.example", ...CORE, validTo: "2027-03-01" },
  ];
}

function tspDemoLinks() {
  const L = (kind, from, to) => ({ kind, from, to });
  return [
    L("organization-location", { type: "organizations", id: "org_acme" }, { type: "locations", id: "loc_hq" }),
    L("organization-contact", { type: "organizations", id: "org_acme" }, { type: "contacts", id: "con_jo" }),
    L("organization-configuration", { type: "organizations", id: "org_acme" }, { type: "configurations", id: "cfg_srv" }),
    L("organization-configuration", { type: "organizations", id: "org_acme" }, { type: "configurations", id: "cfg_rmm" }),
    L("organization-document", { type: "organizations", id: "org_acme" }, { type: "documents", id: "doc_sop" }),
    L("organization-flexible-asset", { type: "organizations", id: "org_acme" }, { type: "flexibleAssets", id: "fx_crm" }),
    L("organization-checklist", { type: "organizations", id: "org_acme" }, { type: "checklists", id: "chk_onboard" }),
    L("configuration-location", { type: "configurations", id: "cfg_srv" }, { type: "locations", id: "loc_hq" }),
    L("configuration-credential", { type: "configurations", id: "cfg_srv" }, { type: "passwords", id: "pwd_crm" }),
    L("document-asset", { type: "documents", id: "doc_sop" }, { type: "configurations", id: "cfg_srv" }),
    L("domain-asset", { type: "domains", id: "dom_site" }, { type: "configurations", id: "cfg_srv" }),
    L("certificate-service", { type: "certificates", id: "cert_site" }, { type: "domains", id: "dom_site" }),
  ];
}

export function buildTspDemoFixture() {
  const set = emptyDocSet({ id: "docset-fixture-tsp-demo", name: "Fixture — TSP Demo Co", now: FIXED_NOW });
  for (const record of tspDemoRecords()) set.records[record.type].push(record);
  set.records.relationships = tspDemoLinks().map((l, i) => makeRelationship({ from: l.from, to: l.to, kind: l.kind, id: "rel_fx_" + i, now: FIXED_NOW }));
  return set;
}

// ---- the legacy fixture -----------------------------------------------------
export function buildLegacyFixture() {
  return {
    schema: "itu-docset/0",
    id: "docset-fixture-legacy",
    name: "Fixture — Legacy (old schema)",
    kind: "organization",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    createdBy: "legacy-import",
    updatedBy: "legacy-import",
    records: {
      // Only two buckets exist — a set written before later record types shipped.
      organizations: [
        { id: "org_old", type: "organizations", name: "Old Corp", orgKind: "organization" }, // no classification
      ],
      locations: [
        { id: "loc_old", type: "locations", name: "Old Site", locationType: "branch", ...CORE },
      ],
      contacts: [
        { id: "con_bad", type: "contacts", name: "Bad Role Contact", contactRole: "not-a-role", ...CORE },
      ],
      relationships: [
        { id: "rel_dangling", type: "relationships", kind: "organization-location", from: { type: "organizations", id: "org_old" }, to: { type: "locations", id: "loc_missing" }, createdAt: FIXED_NOW, updatedAt: FIXED_NOW, createdBy: "legacy-import" },
      ],
    },
  };
}

// ---- the catalog ------------------------------------------------------------
export const FIXTURE_SPECS = [
  {
    id: "tsp-demo",
    label: "TSP Demo Co",
    description: "A healthy, fully-classified client set covering all four information models, an imported record and a synchronized (integration-managed) record.",
    covers: ["core-asset", "flexible-asset", "document", "integration-managed", "imported", "current-schema"],
    build: buildTspDemoFixture,
  },
  {
    id: "legacy",
    label: "Legacy (old schema)",
    description: "An older-schema set: missing record buckets, an unclassified record, an invalid required field and a dangling relationship — the gaps the integrity suite must catch.",
    covers: ["legacy-schema", "unclassified", "dangling-relationship"],
    build: buildLegacyFixture,
  },
];

export const fixtureSpec = (id) => FIXTURE_SPECS.find((f) => f.id === id) || null;

export function buildFixtureSet(id) {
  const spec = fixtureSpec(id);
  return spec ? spec.build() : null;
}

export function buildFixtureSets() {
  return FIXTURE_SPECS.map((spec) => spec.build());
}

export function fixtureCatalog() {
  return FIXTURE_SPECS.map((f) => ({ id: f.id, label: f.label, description: f.description, covers: [...f.covers] }));
}

// The information models each fixture covers, rolled up — handy for reporting
// "the fixture suite covers every model".
export function fixtureModelCoverage() {
  const models = new Set();
  for (const spec of FIXTURE_SPECS) for (const c of spec.covers) models.add(c);
  return [...models];
}

// Seed a fixture into a real documentation service (`ctx.docs`). Returns the
// created set's id/name and how many records and links landed. The fixture's
// records are added through the normal addRecord/linkRecords path, so a fixture
// is validated exactly like user data.
export async function seedFixture(docs, id, { name, createdBy = "fixture" } = {}) {
  const spec = fixtureSpec(id);
  if (!spec) throw new Error(`Unknown fixture “${id}”.`);
  const built = spec.build();
  const created = await docs.create({ name: name || built.name, kind: built.kind || "organization", createdBy });
  const idMap = new Map();
  let recordCount = 0;
  for (const type of RECORD_TYPES) {
    if (type === "relationships") continue;
    for (const record of built.records[type] || []) {
      const input = { ...record };
      delete input.id;
      const res = await docs.addRecord(created.id, input, { updatedBy: createdBy });
      idMap.set(record.id, res.record.id);
      recordCount += 1;
    }
  }
  let linkCount = 0;
  const remap = (ref) => ({ type: ref.type, id: idMap.get(ref.id) || ref.id });
  for (const rel of built.records.relationships || []) {
    try {
      await docs.linkRecords(created.id, { from: remap(rel.from), to: remap(rel.to), kind: rel.kind, createdBy }, { updatedBy: createdBy });
      linkCount += 1;
    } catch {
      // A legacy fixture's dangling link is expected to be refused — skip it.
    }
  }
  return { id: created.id, name: created.name, records: recordCount, links: linkCount };
}
