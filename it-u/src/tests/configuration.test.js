// src/tests/configuration.test.js — validation tests for Phase 2 task 9
// (configurations). Run in the live page:
//   await import("./src/tests/configuration.test.js").then((m) => m.run())
//
// Covers: the configuration-type catalog (every device type the roadmap lists);
// the standardized-field rule that a configuration must declare its type; the
// full attribute set (manufacturer, model, serial, hostname, IP address(es), MAC,
// location, support/warranty expiry); IP parsing/validation; the configuration
// display line; the configuration relationship kinds (→ location, → credential,
// → hosted-on, → responsible contact) and wrong-direction refusal; and the
// configuration reference integrity audit (unknown type, dangling location,
// malformed IP as a warning that does not break the graph audit).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  CONFIGURATION_TYPES,
  configurationType,
  configurationDetailLine,
  configurationIssues,
  parseIpAddresses,
  isValidIpAddress,
} from "../framework/configuration.js";
import { validateRecordFields } from "../framework/standardized.js";

const C = { informationModel: "core-asset", provenance: "authored" };

export async function run() {
  return runTests([
    {
      name: "the configuration-type catalog covers every device type the roadmap lists",
      fn: () => {
        for (const id of [
          "server-physical",
          "server-virtual",
          "workstation",
          "laptop",
          "firewall",
          "switch",
          "access-point",
          "printer",
          "display",
          "camera",
          "security-panel",
          "ups",
          "storage",
          "other",
        ]) {
          assert(CONFIGURATION_TYPES.some((t) => t.id === id), "type " + id);
        }
        assertEq(configurationType("firewall").label, "Firewall", "type lookup");
        assert(CONFIGURATION_TYPES.every((t) => t.group), "every type declares a group");
      },
    },
    {
      name: "a configuration must declare its type — on add and edit",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-configs" });
        const set = await docs.create({ name: "Acme" });
        assert(!validateRecordFields("configurations", { name: "web-01" }).ok, "type-less config refused by the validator");
        let threw = null;
        try {
          await docs.addRecord(set.id, { type: "configurations", name: "web-01", ...C });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "untyped config refused by the service");
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        assertEq(cfg.configType, "server-virtual", "type stored");
        threw = null;
        try {
          await docs.updateRecord(set.id, { type: "configurations", id: cfg.id }, { configType: "" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "blanking the type on edit refused");
      },
    },
    {
      name: "the full attribute set is stored and the detail line is consistent",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-configs" });
        const set = await docs.create({ name: "Acme" });
        const loc = (await docs.addRecord(set.id, { type: "locations", name: "Brisbane DC", locationType: "datacentre", ...C })).record;
        const cfg = (
          await docs.addRecord(set.id, {
            type: "configurations",
            name: "web-01",
            configType: "server-virtual",
            manufacturer: "Dell",
            model: "PowerEdge R750",
            serialNumber: "SN-12345",
            hostname: "web-01",
            ipAddresses: "10.0.0.10, 10.0.0.11",
            macAddress: "aa:bb:cc:dd:ee:ff",
            locationId: loc.id,
            supportExpiryDate: "2027-01-31",
            warrantyExpiryDate: "2026-06-30",
            ...C,
          })
        ).record;
        assertEq(cfg.manufacturer, "Dell", "manufacturer stored");
        assertEq(cfg.serialNumber, "SN-12345", "serial stored");
        assertEq(cfg.hostname, "web-01", "hostname stored");
        assertEq(parseIpAddresses(cfg.ipAddresses).length, 2, "two IP addresses");
        assertEq(cfg.macAddress, "aa:bb:cc:dd:ee:ff", "mac stored");
        const line = configurationDetailLine(cfg, await docs.get(set.id));
        assert(line.startsWith("Virtual server (VM)"), "leads with the type");
        assert(line.includes("Dell PowerEdge R750"), "includes manufacturer + model");
        assert(line.includes("Brisbane DC"), "includes the location");
      },
    },
    {
      name: "IP parsing and validation accept real addresses and reject malformed ones",
      fn: () => {
        assertEq(parseIpAddresses("10.0.0.1\n10.0.0.2, 10.0.0.3").length, 3, "newline + comma split");
        assertEq(parseIpAddresses(["10.0.0.1", "10.0.0.2"]).length, 2, "array tolerated");
        assert(isValidIpAddress("192.168.1.1"), "valid IPv4");
        assert(isValidIpAddress("2001:db8::1"), "valid IPv6");
        assert(!isValidIpAddress("999.1.1.1"), "invalid IPv4 octet");
        assert(!isValidIpAddress("not-an-ip"), "garbage rejected");
      },
    },
    {
      name: "configuration relationships link correctly and refuse the wrong direction",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-configs" });
        const set = await docs.create({ name: "Acme" });
        const loc = (await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", ...C })).record;
        const con = (await docs.addRecord(set.id, { type: "contacts", name: "Jane", contactRole: "site-manager", ...C })).record;
        const pwd = (await docs.addRecord(set.id, { type: "passwords", name: "web-01 local admin", scope: "general", category: "local-admin", ...C })).record;
        const host = (await docs.addRecord(set.id, { type: "configurations", name: "esxi-01", configType: "server-physical", ...C })).record;
        const vm = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        await docs.linkRecords(set.id, { from: { type: "configurations", id: vm.id }, to: { type: "locations", id: loc.id }, kind: "configuration-location" });
        await docs.linkRecords(set.id, { from: { type: "configurations", id: vm.id }, to: { type: "passwords", id: pwd.id }, kind: "configuration-credential" });
        await docs.linkRecords(set.id, { from: { type: "configurations", id: vm.id }, to: { type: "configurations", id: host.id }, kind: "configuration-hosted-on" });
        await docs.linkRecords(set.id, { from: { type: "configurations", id: vm.id }, to: { type: "contacts", id: con.id }, kind: "configuration-contact" });
        assertEq((await docs.relations(set.id, { type: "configurations", id: vm.id })).length, 4, "the VM sees all four links");
        assertEq((await docs.relations(set.id, { type: "passwords", id: pwd.id })).length, 1, "the credential sees its configuration");

        let threw = null;
        try {
          await docs.linkRecords(set.id, { from: { type: "locations", id: loc.id }, to: { type: "configurations", id: vm.id }, kind: "configuration-location" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "wrong-direction link refused");
      },
    },
    {
      name: "the configuration audit flags an unknown type and a dangling location; a malformed IP is only a warning",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-configs" });
        const set = await docs.create({ name: "Acme" });
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        const live = await docs.get(set.id);
        live.records.configurations[0].configType = "made-up";
        live.records.configurations[0].locationId = "loc-nope";
        live.records.configurations[0].ipAddresses = "10.0.0.1, 999.9.9.9";
        const issues = configurationIssues(live);
        assert(issues.some((i) => i.code === "unknown-config-type" && i.level === "error"), "unknown type flagged as an error");
        assert(issues.some((i) => i.code === "missing-config-location" && i.level === "error"), "dangling location flagged as an error");
        assert(issues.some((i) => i.code === "invalid-ip" && i.level === "warning"), "malformed IP flagged as a warning");
        const integ = await docs.integrity(set.id);
        assert(!integ.ok, "the error makes the graph audit fail");
        assert(integ.issues.some((i) => i.recordId === cfg.id), "the issues name the record");
      },
    },
  ]);
}
