// src/tests/completeness.test.js — validation tests for Phase 2 task 10
// (configuration completeness rules). Run in the live page:
//   await import("./src/tests/completeness.test.js").then((m) => m.run())
//
// Covers: the completeness-rule catalog and the classic default required set;
// flagging an incomplete configuration (with the precise missing rules) without
// blocking its save; a fully-specified configuration scoring complete; the
// credential rule satisfied through a typed link; the expiry rule satisfied by
// EITHER a warranty or a support date; recorded exceptions (who/why/when) and
// their removal; the per-set configurable required set (and unknown-rule
// refusal); and that an incomplete configuration never fails the graph audit.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  COMPLETENESS_RULES,
  DEFAULT_REQUIRED_FIELDS,
  completenessRule,
  configurationCompleteness,
  completenessReport,
  normalizeCompletenessConfig,
} from "../framework/configuration.js";

const C = { informationModel: "core-asset", provenance: "authored" };

// A configuration that satisfies every default rule, given a location + a
// credential link already in the set.
async function fullConfig(docs, set, loc, cred) {
  const cfg = (
    await docs.addRecord(set.id, {
      type: "configurations",
      name: "web-01",
      configType: "server-virtual",
      manufacturer: "Dell",
      model: "PowerEdge R750",
      serialNumber: "SN-1",
      hostname: "web-01",
      ipAddresses: "10.0.0.10",
      macAddress: "aa:bb:cc:dd:ee:ff",
      locationId: loc.id,
      supportExpiryDate: "2027-01-31",
      ...C,
    })
  ).record;
  if (cred) {
    await docs.linkRecords(set.id, { from: { type: "configurations", id: cfg.id }, to: { type: "passwords", id: cred.id }, kind: "configuration-credential" });
  }
  return cfg;
}

export async function run() {
  return runTests([
    {
      name: "the rule catalog and the classic default required set are published",
      fn: () => {
        for (const key of ["name", "manufacturer", "model", "locationId", "serialNumber", "macAddress", "ipAddresses", "expiry", "credential"]) {
          assert(DEFAULT_REQUIRED_FIELDS.includes(key), "default includes " + key);
          assert(completenessRule(key), "rule exists for " + key);
        }
        assert(completenessRule("credential").kind === "relationship", "credential is a relationship rule");
        assert(completenessRule("ipAddresses").kind === "field", "ip is a field rule");
        assertEq(normalizeCompletenessConfig(undefined).required.length, DEFAULT_REQUIRED_FIELDS.length, "missing config → defaults");
        assertEq(normalizeCompletenessConfig({ required: [] }).required.length, 0, "an explicit empty set is honoured");
      },
    },
    {
      name: "an incomplete configuration is flagged with the precise missing rules — but still saved",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-complete" });
        const set = await docs.create({ name: "Acme" });
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        const comp = configurationCompleteness(cfg, await docs.get(set.id), undefined);
        assert(!comp.complete, "flags as incomplete");
        for (const key of ["manufacturer", "model", "locationId", "serialNumber", "macAddress", "ipAddresses", "expiry", "credential"]) {
          assert(comp.missingKeys.includes(key), "missing " + key);
        }
        // The save was NOT blocked — the record exists.
        assertEq((await docs.get(set.id)).records.configurations.length, 1, "incomplete config still saved");
        const rep = await docs.completeness(set.id);
        assertEq(rep.incompleteCount, 1, "report counts it incomplete");
        assertEq(rep.records[0].id, cfg.id, "report names it");
      },
    },
    {
      name: "a fully-specified configuration (credential linked) scores complete",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-complete" });
        const set = await docs.create({ name: "Acme" });
        const loc = (await docs.addRecord(set.id, { type: "locations", name: "DC", locationType: "datacentre", ...C })).record;
        const cred = (await docs.addRecord(set.id, { type: "passwords", name: "web-01 admin", scope: "general", category: "local-admin", ...C })).record;
        await fullConfig(docs, set, loc, cred);
        const rep = await docs.completeness(set.id);
        assertEq(rep.incompleteCount, 0, "complete");
        assert(rep.ok, "report ok");
        assertEq(rep.completeCount, 1, "one complete");
      },
    },
    {
      name: "the credential rule is satisfied by a configuration → credential link",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-complete" });
        const set = await docs.create({ name: "Acme" });
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        let comp = configurationCompleteness(cfg, await docs.get(set.id), { required: ["credential"] });
        assert(!comp.complete, "no link → incomplete");
        const cred = (await docs.addRecord(set.id, { type: "passwords", name: "admin", scope: "general", category: "local-admin", ...C })).record;
        await docs.linkRecords(set.id, { from: { type: "configurations", id: cfg.id }, to: { type: "passwords", id: cred.id }, kind: "configuration-credential" });
        comp = configurationCompleteness(cfg, await docs.get(set.id), { required: ["credential"] });
        assert(comp.complete, "link satisfies the credential rule");
      },
    },
    {
      name: "the expiry rule is satisfied by EITHER a warranty or a support date",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-complete" });
        const set = await docs.create({ name: "Acme" });
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        const current = async () => (await docs.get(set.id)).records.configurations[0];
        assert(!configurationCompleteness(cfg, await docs.get(set.id), { required: ["expiry"] }).complete, "no dates → incomplete");
        await docs.updateRecord(set.id, { type: "configurations", id: cfg.id }, { warrantyExpiryDate: "2026-01-01" });
        assert(configurationCompleteness(await current(), await docs.get(set.id), { required: ["expiry"] }).complete, "warranty alone satisfies");
        await docs.updateRecord(set.id, { type: "configurations", id: cfg.id }, { warrantyExpiryDate: "", supportExpiryDate: "2027-01-01" });
        assert(configurationCompleteness(await current(), await docs.get(set.id), { required: ["expiry"] }).complete, "support alone satisfies");
      },
    },
    {
      name: "an explicit exception (with reason) is recorded and clears the flag; removing it re-flags",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-complete" });
        const set = await docs.create({ name: "Acme" });
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        const res = await docs.setExemption(set.id, { type: "configurations", id: cfg.id }, "macAddress", "Virtual NIC — MAC is assigned by the hypervisor.", { updatedBy: "tester" });
        assertEq(res.exemption.by, "tester", "records who");
        assert(res.exemption.reason.includes("hypervisor"), "records why");
        assert(res.exemption.at > 0, "records when");
        let comp = configurationCompleteness(res.record, await docs.get(set.id), { required: ["macAddress"] });
        assert(comp.complete && comp.exemptKeys.includes("macAddress"), "exemption clears the missing rule");
        await docs.clearExemption(set.id, { type: "configurations", id: cfg.id }, "macAddress");
        comp = configurationCompleteness((await docs.get(set.id)).records.configurations[0], await docs.get(set.id), { required: ["macAddress"] });
        assert(!comp.complete, "removing the exception re-flags the rule");
        // The UI path sets exemptions through updateRecord.
        await docs.updateRecord(set.id, { type: "configurations", id: cfg.id }, { exemptions: { macAddress: { reason: "ok", by: "ui", at: Date.now() } } });
        comp = configurationCompleteness((await docs.get(set.id)).records.configurations[0], await docs.get(set.id), { required: ["macAddress"] });
        assert(comp.complete, "exemption set via updateRecord works");
      },
    },
    {
      name: "the required set is configurable per set, and unknown rules are refused",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-complete" });
        const set = await docs.create({ name: "Acme" });
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        await docs.configureCompleteness(set.id, { required: ["name"] });
        const rep = await docs.completeness(set.id);
        assert(rep.ok, "with a minimal required set the config is complete");
        assertEq(rep.config.required.join(","), "name", "required set stored");
        // The set's own record reflects the persisted config.
        assertEq((await docs.get(set.id)).completeness.required.length, 1, "config persisted on the set");
        let threw = null;
        try {
          await docs.configureCompleteness(set.id, { required: ["not-a-rule"] });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "unknown rule refused");
        // Restoring the defaults re-flags the record.
        await docs.configureCompleteness(set.id, { required: DEFAULT_REQUIRED_FIELDS });
        assert(!(await docs.completeness(set.id)).ok, "defaults flag it again");
        assertEq(cfg.id, (await docs.get(set.id)).records.configurations[0].id, "record untouched throughout");
      },
    },
    {
      name: "an incomplete configuration never fails the set's graph audit",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-complete" });
        const set = await docs.create({ name: "Acme" });
        await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C });
        const integ = await docs.integrity(set.id);
        assert(integ.ok, "incomplete config is a quality flag, not a graph error");
        assert(!integ.issues.some((i) => /incomplete/i.test(i.message || "")), "no completeness issue in the graph audit");
        const rep = completenessReport(await docs.get(set.id));
        assert(!rep.ok, "but the completeness report flags it");
      },
    },
  ]);
}
