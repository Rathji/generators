// src/tests/relationships.test.js — validation tests for roadmap Phase 1
// task 4 (relationship engine). Run in the live page:
//   await import("./src/tests/relationships.test.js").then((m) => m.run())
//
// Covers: the typed-link catalog; link validation (kind, direction, self-link,
// duplicates); bidirectional visibility from both endpoints; cascade on record
// deletion; refusing free-form duplicates and suggesting links instead; the
// "suggest existing records to link" helper; and the graph integrity audit.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  RELATIONSHIP_KINDS,
  relationshipKind,
  validateLink,
  checkIntegrity,
} from "../framework/relationships.js";

const CORE = { informationModel: "core-asset", provenance: "authored" };
const FLEX = { informationModel: "flexible-asset", provenance: "authored" };

async function seed(docs) {
  const set = await docs.create({ name: "Acme" });
  const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Billing App", assetTypeId: "atype-applications", ...FLEX })).record;
  const server = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "other", ...CORE })).record;
  const fw = (await docs.addRecord(set.id, { type: "configurations", name: "fw-01", configType: "other", ...CORE })).record;
  const doc = (await docs.addRecord(set.id, { type: "documents", name: "Security baseline", docType: "reference", ...CORE })).record;
  const pwd = (await docs.addRecord(set.id, { type: "passwords", name: "Billing admin", scope: "general", category: "domain-admin", ...CORE })).record;
  return { set, app, server, fw, doc, pwd };
}

export async function run() {
  return runTests([
    {
      name: "the relationship catalog defines typed links between record collections",
      fn: async () => {
        assert(RELATIONSHIP_KINDS.length >= 10, "a useful catalog");
        const k = relationshipKind("application-server");
        assert(k, "application-server defined");
        assertEq(k.from.join(","), "flexibleAssets", "from types");
        assertEq(k.to.join(","), "configurations", "to types");
        assert(relationshipKind("circuit-firewall"), "circuit → firewall defined");
        assertEq(relationshipKind("does-not-exist"), null, "unknown kind resolves to null");
      },
    },
    {
      name: "validateLink enforces kind, direction, endpoint existence and self-links",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const { set, app, server, fw, doc } = await seed(docs);
        const full = await docs.get(set.id);
        assert(validateLink(full, { from: app, to: server, kind: "application-server" }).ok, "valid link");
        assert(!validateLink(full, { from: app, to: server, kind: "nope" }).ok, "unknown kind refused");
        assert(!validateLink(full, { from: server, to: app, kind: "application-server" }).ok, "wrong direction refused");
        assert(!validateLink(full, { from: app, to: app, kind: "application-server" }).ok, "self-link refused");
        assert(!validateLink(full, { from: app, to: { type: "configurations", id: "missing" }, kind: "application-server" }).ok, "missing endpoint refused");
        assert(validateLink(full, { from: fw, to: doc, kind: "firewall-security-doc" }).ok, "firewall → doc valid");
      },
    },
    {
      name: "a link is visible from BOTH endpoints (bidirectional) and lists once",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const { set, app, server } = await seed(docs);
        const { relationship } = await docs.linkRecords(set.id, {
          from: { type: "flexibleAssets", id: app.id },
          to: { type: "configurations", id: server.id },
          kind: "application-server",
        });
        const fromApp = await docs.relations(set.id, { type: "flexibleAssets", id: app.id });
        const fromServer = await docs.relations(set.id, { type: "configurations", id: server.id });
        assertEq(fromApp.length, 1, "app sees one link");
        assertEq(fromServer.length, 1, "server sees the same one link");
        assertEq(fromApp[0].relationship.id, relationship.id, "same relationship id");
        assertEq(fromApp[0].direction, "out", "app is the 'from' side");
        assertEq(fromServer[0].direction, "in", "server is the 'to' side");
        assertEq(fromServer[0].other.id, app.id, "server's 'other' is the app");
      },
    },
    {
      name: "duplicate links are refused",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const { set, app, server } = await seed(docs);
        const link = { from: { type: "flexibleAssets", id: app.id }, to: { type: "configurations", id: server.id }, kind: "application-server" };
        await docs.linkRecords(set.id, link);
        let threw = null;
        try {
          await docs.linkRecords(set.id, link);
        } catch (e) {
          threw = e;
        }
        assert(threw, "duplicate refused");
        assert(String(threw.message).toLowerCase().includes("already linked"), "explains the duplicate");
        const set2 = await docs.get(set.id);
        assertEq(set2.records.relationships.length, 1, "only one link stored");
      },
    },
    {
      name: "deleting a record cascades its links away (graph stays consistent)",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const { set, app, server, fw, doc } = await seed(docs);
        await docs.linkRecords(set.id, { from: { type: "flexibleAssets", id: app.id }, to: { type: "configurations", id: server.id }, kind: "application-server" });
        await docs.linkRecords(set.id, { from: { type: "configurations", id: fw.id }, to: { type: "documents", id: doc.id }, kind: "firewall-security-doc" });
        assertEq((await docs.get(set.id)).records.relationships.length, 2, "two links");
        const res = await docs.removeRecord(set.id, { type: "configurations", id: server.id });
        assertEq(res.cascaded, 1, "one link cascaded with the server");
        const after = await docs.get(set.id);
        assertEq(after.records.relationships.length, 1, "the unrelated link survives");
        assertEq(after.records.relationships[0].kind, "firewall-security-doc", "the correct link survived");
        const integrity = checkIntegrity(after);
        assert(integrity.ok, "no dangling links: " + JSON.stringify(integrity.issues));
      },
    },
    {
      name: "free-form duplicates are refused and the existing record is suggested instead",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const { set, server } = await seed(docs);
        let threw = null;
        try {
          await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "other", ...CORE });
        } catch (e) {
          threw = e;
        }
        assert(threw, "duplicate refused");
        assertEq(threw.code, "DUPLICATE_RECORD", "typed code");
        assertEq(threw.existing.id, server.id, "names the existing record");
        assert(String(threw.hint).toLowerCase().includes("link"), "suggests linking instead");
        assertEq((await docs.get(set.id)).records.configurations.length, 2, "no duplicate written");
        // an explicit override is allowed (with a different, clearly-intended record)
        const ok = await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "other", ...CORE }, { allowDuplicate: true });
        assertEq(ok.record.name, "web-01", "override creates it on request");
      },
    },
    {
      name: "suggestLinks offers the existing records a link could point at",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const { set, app, server } = await seed(docs);
        const candidates = await docs.linksFor(set.id, { type: "flexibleAssets", id: app.id }, "application-server");
        assertEq(candidates.length, 2, "both configurations are candidates");
        assert(candidates.some((c) => c.id === server.id), "web-01 offered");
        await docs.linkRecords(set.id, { from: { type: "flexibleAssets", id: app.id }, to: { type: "configurations", id: server.id }, kind: "application-server" });
        const after = await docs.linksFor(set.id, { type: "flexibleAssets", id: app.id }, "application-server");
        assertEq(after.length, 1, "already-linked record is no longer suggested");
        assert(!after.some((c) => c.id === server.id), "web-01 removed from suggestions");
      },
    },
    {
      name: "checkIntegrity audits the graph for dangling links and unknown kinds",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const { set, app } = await seed(docs);
        const full = await docs.get(set.id);
        assert(checkIntegrity(full).ok, "a healthy graph is clean");
        // forge a dangling link + an unknown kind directly into the record bag
        full.records.relationships.push(
          { id: "rel_bad1", type: "relationships", kind: "application-server", from: { type: "flexibleAssets", id: app.id }, to: { type: "configurations", id: "ghost" } },
          { id: "rel_bad2", type: "relationships", kind: "made-up", from: { type: "flexibleAssets", id: app.id }, to: { type: "configurations", id: "ghost" } },
        );
        const audit = checkIntegrity(full);
        assert(!audit.ok, "problems detected");
        assert(audit.issues.some((i) => i.code === "dangling-to"), "dangling endpoint found");
        assert(audit.issues.some((i) => i.code === "unknown-kind"), "unknown kind found");
      },
    },
  ]);
}
