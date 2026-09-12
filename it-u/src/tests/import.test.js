// src/tests/import.test.js — validation tests for roadmap task 29 ("Bulk
// import"). Run in the live page:
//   await import("./src/tests/import.test.js").then((m) => m.run())
//
// Covers: the import-target catalog (five types, each classified); CSV parsing
// (quotes, embedded delimiters/newlines, doubled quotes, CRLF, BOM, delimiter
// detection, ragged/trailing rows); header normalization and option resolution;
// automatic column mapping (key/label/alias/fuzzy); the dry-run plan (ready /
// duplicate / invalid / empty, required-field defaults, record-reference
// resolution, flexible-asset field collection, allow-duplicates) and its
// summary; and the whole thing end-to-end through the documentation-set service
// — ready rows become classified records in one write, duplicates are skipped,
// a bad row is reported rather than dropped, and every import is logged.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  IMPORT_TARGETS,
  importTarget,
  normalizeHeader,
  resolveOption,
  detectDelimiter,
  parseCsv,
  autoMapColumns,
  buildImportPlan,
  planSummary,
  readyRows,
} from "../framework/importer.js";

const orgCsv = () => "Name,Kind,Legal name,Website\nNorthwind Trading,organization,Northwind Trading Pty Ltd,https://northwind.example\nHarbour Freight,business unit,Harbour Freight Pty Ltd,";

const planFor = (csv, target = "organizations", opts = {}) => {
  const parsed = parseCsv(csv);
  const mapping = autoMapColumns(parsed.headers, target, opts.extraFields || []);
  return buildImportPlan({ target, headers: parsed.headers, rows: parsed.rows, mapping, ...opts });
};

const tests = [
  ["the import catalog holds the five importable record types, each classified", () => {
    assertEq(IMPORT_TARGETS.length, 5, "five targets");
    assertEq(IMPORT_TARGETS.map((t) => t.id).join(","), "organizations,contacts,configurations,passwords,flexibleAssets");
    assertEq(importTarget("organizations").recordType, "organizations");
    assertEq(importTarget("organizations").informationModel, "core-asset");
    assertEq(importTarget("passwords").provenance, "imported");
    assertEq(importTarget("flexibleAssets").informationModel, "flexible-asset");
    assertEq(importTarget("nope"), null);
  }],

  ["parseCsv handles quotes, embedded delimiters, doubled quotes and CRLF", () => {
    const csv = 'Name,Notes\r\n"Doe, Jane","She said ""hi"", loudly"\r\nBob,"multi\nline"\r\n';
    const p = parseCsv(csv);
    assertEq(p.delimiter, ",");
    assertEq(p.headers.join("|"), "Name|Notes");
    assertEq(p.rows.length, 2);
    assertEq(p.rows[0][0], "Doe, Jane", "quoted comma");
    assertEq(p.rows[0][1], 'She said "hi", loudly', "doubled quotes");
    assertEq(p.rows[1][1], "multi\nline", "embedded newline");
  }],

  ["parseCsv strips a BOM, detects the delimiter and pads ragged rows", () => {
    const p = parseCsv("\uFEFFName;Type;Owner\nNW-DC01;Server\nNW-FW01;Firewall;Jo");
    assertEq(p.delimiter, ";");
    assertEq(p.headers.length, 3);
    assertEq(p.rows[0].length, 3, "short row padded");
    assertEq(p.rows[0][2], "", "missing cell is blank");
    assertEq(p.rows[1][2], "Jo");
    const tabbed = parseCsv("A\tB\n1\t2\n3\t4");
    assertEq(tabbed.delimiter, "\t");
    assertEq(detectDelimiter("a|b|c"), "|");
  }],

  ["parseCsv drops trailing blank rows and empty input yields nothing", () => {
    const p = parseCsv("Name,Type\nA,Server\nB,Server\n,\n\n");
    assertEq(p.rows.length, 2, "blank trailing rows dropped");
    const empty = parseCsv("");
    assertEq(empty.rows.length, 0);
    assertEq(empty.headers.length, 0);
  }],

  ["header normalization and option resolution match ids, labels and synonyms", () => {
    assertEq(normalizeHeader("Legal Name_1"), "legal name 1");
    assertEq(normalizeHeader("  E-mail  "), "e mail");
    const opts = [{ id: "server-physical", label: "Physical server" }, { id: "firewall", label: "Firewall" }];
    assertEq(resolveOption(opts, "server-physical").id, "server-physical", "by id");
    assertEq(resolveOption(opts, "Firewall").id, "firewall", "by label");
    assertEq(resolveOption(opts, "physical server").id, "server-physical", "case-insensitive label");
    assertEq(resolveOption(opts, "nonsense"), null);
  }],

  ["autoMapColumns proposes a mapping from keys, labels and aliases", () => {
    const p = parseCsv("Hostname,Make,Serial No,IP address,Warranty\nnw-dc01,Dell,SN1,10.0.0.5,2027-01-01");
    const map = autoMapColumns(p.headers, "configurations");
    assertEq(map.hostname, 0);
    assertEq(map.manufacturer, 1, "Make → manufacturer via alias");
    assertEq(map.serialNumber, 2, "Serial No → serialNumber via alias");
    assertEq(map.ipAddresses, 3);
    assertEq(map.warrantyExpiryDate, 4, "Warranty → warrantyExpiryDate via alias");
    assertEq(map.name, undefined, "no name column present");
  }],

  ["a dry run classifies ready, duplicate, invalid and empty rows", () => {
    const parsed = parseCsv("Name,Kind,Legal name\nNorthwind Trading,organization,Northwind Trading Pty Ltd\nHarbour Freight,business unit,Harbour Freight Pty Ltd\n,organization,No Name Co\n\nBad Kind Corp,not-a-kind,\n");
    const mapping = autoMapColumns(parsed.headers, "organizations");
    const plan = buildImportPlan({
      target: "organizations",
      headers: parsed.headers,
      rows: parsed.rows,
      mapping,
      existing: [{ id: "org_x", type: "organizations", name: "Harbour Freight" }],
    });
    assertEq(plan.counts.total, 5);
    assertEq(plan.counts.ready, 1, "first row is ready");
    assertEq(plan.counts.duplicate, 1, "second row duplicates an existing record");
    assertEq(plan.counts.invalid, 2, "no-name + bad kind");
    assertEq(plan.counts.empty, 1, "blank row");
    const ready = plan.rows.find((r) => r.status === "ready");
    assertEq(ready.candidate.name, "Northwind Trading");
    assertEq(ready.candidate.informationModel, "core-asset");
    assertEq(ready.candidate.provenance, "imported");
    assertEq(ready.candidate.origin.source, "CSV import");
    const invalid = plan.rows.find((r) => r.status === "invalid" && r.candidate.name === "Bad Kind Corp");
    assert(/kind/i.test(invalid.errors.join(" ")), "the bad kind is named in the error");
    assert(/already exists/.test(plan.rows.find((r) => r.status === "duplicate").errors.join(" ")));
  }],

  ["required standardized fields fall back to sensible defaults", () => {
    const plan = planFor("Name\nMystery Org\n");
    assertEq(plan.counts.ready, 1);
    const c = plan.rows[0].candidate;
    assertEq(c.orgKind, "organization", "organization kind defaulted");
    const contacts = planFor("Name,Email\nJo Bloggs,jo@example.com\n", "contacts");
    assertEq(contacts.rows[0].candidate.contactRole, "client-primary", "contact role defaulted");
    const configs = planFor("Name,Manufacturer\nNW-X,Dell\n", "configurations");
    assertEq(configs.rows[0].candidate.configType, "workstation", "config type defaulted");
  }],

  ["select values resolve from ids or labels; unknown values are rejected", () => {
    const plan = planFor("Name,Type,Warranty expiry\nNW-DC01,Physical server,2027-01-01\nNW-Z,Time Machine,\n", "configurations");
    assertEq(plan.rows[0].candidate.configType, "server-physical", "label resolved to id");
    assertEq(plan.rows[0].candidate.warrantyExpiryDate, "2027-01-01");
    assertEq(plan.rows[1].status, "invalid");
    assert(/allowed values/.test(plan.rows[1].errors.join(" ")));
  }],

  ["record-reference columns resolve by name against the set, or fail loudly", () => {
    const records = { organizations: [{ id: "org_n", type: "organizations", name: "Northwind" }] };
    const parsed = parseCsv("Name,Organization\nJo,Northwind\nDana,Ghost Corp\n");
    const mapping = autoMapColumns(parsed.headers, "contacts");
    const plan = buildImportPlan({ target: "contacts", headers: parsed.headers, rows: parsed.rows, mapping, records });
    assertEq(plan.rows[0].candidate.organizationId, "org_n", "resolved by name");
    assertEq(plan.rows[1].status, "invalid");
    assert(/no existing record named/i.test(plan.rows[1].errors.join(" ")));
  }],

  ["flexible assets collect their template fields into assetFields", () => {
    const assetType = { id: "t1", name: "Domain / certificate", fields: [{ key: "owner", label: "Owner", type: "text" }, { key: "expiryDate", label: "Expiry date", type: "date", required: true }] };
    const parsed = parseCsv("Name,Owner,Expiry date\nExample asset,Jo,2027-01-01\nNo Expiry,Jo,\n");
    const mapping = autoMapColumns(parsed.headers, "flexibleAssets", assetType.fields);
    const plan = buildImportPlan({ target: "flexibleAssets", headers: parsed.headers, rows: parsed.rows, mapping, extraFields: assetType.fields, assetType });
    const ok = plan.rows[0];
    assertEq(ok.status, "ready");
    assertEq(ok.candidate.assetTypeId, "t1");
    assertEq(ok.candidate.assetFields.owner, "Jo");
    assertEq(ok.candidate.assetFields.expiryDate, "2027-01-01");
    assertEq(ok.candidate.owner, undefined, "template fields are not top-level");
    assertEq(plan.rows[1].status, "invalid", "required template field enforced");
  }],

  ["allowDuplicates turns duplicate rows ready, and helpers summarize", () => {
    const parsed = parseCsv("Name\nNorthwind Trading\n");
    const mapping = autoMapColumns(parsed.headers, "organizations");
    const existing = [{ id: "org_x", type: "organizations", name: "northwind trading" }];
    const strict = buildImportPlan({ target: "organizations", headers: parsed.headers, rows: parsed.rows, mapping, existing });
    assertEq(strict.rows[0].status, "duplicate");
    const loose = buildImportPlan({ target: "organizations", headers: parsed.headers, rows: parsed.rows, mapping, existing, allowDuplicates: true });
    assertEq(loose.rows[0].status, "ready");
    assertEq(readyRows(loose).length, 1);
    assert(/1 ready/.test(planSummary(loose)));
  }],

  ["the service imports ready rows, skips duplicates and reports failures per row", async () => {
    const { docs } = makeWorld("kb-import-svc");
    const set = await docs.create({ name: "Northwind", createdBy: "tester" });
    await docs.addRecord(set.id, { type: "organizations", name: "Existing Co", orgKind: "organization", informationModel: "core-asset", provenance: "authored" }, { updatedBy: "tester" });

    const csv = "Name,Kind,Legal name\nNorthwind Trading,organization,Northwind Trading Pty Ltd\nHarbour Freight,business unit,Harbour Freight Pty Ltd\nExisting Co,organization,\nBad Kind Co,nonsense,\n";
    const parsed = parseCsv(csv);
    const mapping = autoMapColumns(parsed.headers, "organizations");
    const existing = (await docs.get(set.id, { force: true })).records.organizations;
    const plan = buildImportPlan({ target: "organizations", headers: parsed.headers, rows: parsed.rows, mapping, existing, source: "Old RMM export" });

    const res = await docs.importRecords(set.id, { target: "organizations", plan, source: "Old RMM export" }, { updatedBy: "tester" });
    assertEq(res.created, 2, "two ready rows imported");
    assertEq(res.skipped, 1, "the duplicate is skipped, not dropped");
    assertEq(res.failed, 0, "invalid rows are never attempted");
    assertEq(res.results.length, 3, "each attempted row reports its outcome");
    assertEq(res.results.find((r) => r.name === "Existing Co").status, "duplicate");

    const after = await docs.get(set.id, { force: true });
    assertEq(after.records.organizations.length, 3, "existing + two imported");
    const imported = after.records.organizations.find((r) => r.name === "Northwind Trading");
    assertEq(imported.informationModel, "core-asset");
    assertEq(imported.provenance, "imported");
    assertEq(imported.origin.source, "Old RMM export", "the source is recorded");
    assertEq(imported.orgKind, "organization");

    // the plan's dry run named the invalid row before anything was written
    assertEq(plan.rows.find((r) => r.candidate.name === "Bad Kind Co").status, "invalid");

    // re-importing the same plan now skips everything (idempotent-ish, no dupes)
    const again = await docs.importRecords(set.id, { target: "organizations", plan }, { updatedBy: "tester" });
    assertEq(again.created, 0);
    assertEq(again.skipped, 3);
    assertEq((await docs.get(set.id, { force: true })).records.organizations.length, 3);
  }],

  ["the service imports an existing set's records and logs every import", async () => {
    const { docs } = makeWorld("kb-import-log");
    const set = await docs.create({ name: "Harbour", createdBy: "tester" });
    const parsed = parseCsv("Name,Role,Email\nJo Bloggs,Client technical,jo@harbour.example\nDana Lee,Client billing,dana@harbour.example\n");
    const mapping = autoMapColumns(parsed.headers, "contacts");
    const plan = buildImportPlan({ target: "contacts", headers: parsed.headers, rows: parsed.rows, mapping, source: "Contacts spreadsheet" });
    const res = await docs.importRecords(set.id, { target: "contacts", plan }, { updatedBy: "alice" });
    assertEq(res.created, 2);
    const contacts = (await docs.get(set.id, { force: true })).records.contacts;
    assertEq(contacts[0].contactRole, "client-technical");
    assertEq(contacts[0].email, "jo@harbour.example");
    assertEq(contacts[0].createdBy, "alice");
    assertEq(contacts[1].contactRole, "client-billing");

    const history = await docs.importHistory(set.id);
    assertEq(history.length, 1);
    assertEq(history[0].target, "contacts");
    assertEq(history[0].created, 2);
    assertEq(history[0].source, "Contacts spreadsheet");
    assertEq(history[0].attempted, 2);
  }],

  ["an unknown target or a missing plan is refused by the service", async () => {
    const { docs } = makeWorld("kb-import-guard");
    const set = await docs.create({ name: "Guard", createdBy: "tester" });
    let threw = null;
    try {
      await docs.importRecords(set.id, { target: "widgets", plan: { rows: [] } }, { updatedBy: "tester" });
    } catch (e) {
      threw = e;
    }
    assert(threw, "unknown target throws");
    let threw2 = null;
    try {
      await docs.importRecords(set.id, { target: "organizations" }, { updatedBy: "tester" });
    } catch (e) {
      threw2 = e;
    }
    assert(threw2, "missing plan throws");
  }],
];

export async function run() {
  return runTests(tests.map(([name, fn]) => ({ name, fn })));
}
