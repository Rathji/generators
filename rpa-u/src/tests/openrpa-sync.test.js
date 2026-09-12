import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import {
  OPENRPA_OWNERSHIP_VERSION,
  OWNERSHIP_PRIORITIES,
  OPENRPA_OWNED_TYPES,
  OPENRPA_FIELD_MODEL,
  OPENRPA_REMOTE_FIELDS,
  priorityOf,
  ownershipTable,
  registerOwnership,
} from "../core/openrpa/ownership.js";
import { OPENRPA_TARGET_TYPES, OPENRPA_PAYLOAD_REFERENCES } from "../core/openrpa/linking.js";
import { OPENRPA_DRIFT_KINDS } from "../core/openrpa/drift.js";
import { OPENRPA_SYNC_POLICIES, OPENRPA_SYNC_POLICY_LABELS } from "../core/openrpa/sync.js";
import { OPENRPA_DECISIONS } from "../core/openrpa/conflicts.js";
import { OPENRPA_COLLECTIONS, OPENRPA_LINKS_COLLECTION, OPENRPA_SYNC_COLLECTION } from "../core/openrpa/constants.js";

const BASE = Date.parse("2030-01-01T00:00:00.000Z");

async function readyHub() {
  return createHub({ kv: null }).ready();
}

async function connectedHub(overrides = {}) {
  const hub = await createHub({ kv: null, ...overrides }).ready();
  const or = hub.openrpa;
  await or.connect({ announce: false });
  await or.linking.refreshTargets();
  return { hub, or };
}

function northwind(hub) {
  return hub.identity.search("northwinddental.com", { type: "company" })[0] || hub.identity.all("company")[0];
}

suite("OpenRPA ownership model", () => {
  test("declares OpenRPA-owned fields on every mapped entity type", async () => {
    const hub = await readyHub();
    assertEquals(OPENRPA_OWNERSHIP_VERSION, 1);
    assertEquals(OPENRPA_OWNED_TYPES, ["company", "customer", "device", "ticket", "invoice"]);
    for (const typeId of OPENRPA_OWNED_TYPES) {
      assert(OPENRPA_FIELD_MODEL[typeId].length >= 3, `${typeId} should declare several automation fields`);
      for (const field of OPENRPA_FIELD_MODEL[typeId]) {
        assertEquals(field.owner, "openrpa");
        assert(hub.registry.field(typeId, field.key), `${typeId}.${field.key} should be merged into the registry`);
      }
    }
    const owned = hub.registry.fieldsOwnedBy("openrpa");
    assert(owned.length >= 18, `expected at least 18 OpenRPA-owned fields, got ${owned.length}`);
    assertEquals(hub.registry.connector("openrpa").entityTypes, OPENRPA_OWNED_TYPES);
    assertEquals(hub.registry.validate().counts.error, 0);
  });

  test("assigns a unique conflict priority to every connector", () => {
    const values = Object.values(OWNERSHIP_PRIORITIES);
    assertEquals(new Set(values).size, values.length, "priorities should be unique");
    assert(priorityOf("openrpa") > priorityOf("rmm-u"), "OpenRPA should outrank the operational tools");
    assert(priorityOf("rmm-u") > priorityOf("crm-u"), "RMM-U should outrank CRM-U");
    assert(priorityOf("ru") < priorityOf("crm-u"), "the hub's own fields should have the lowest priority");
    assertEquals(priorityOf("unknown-tool"), 0);
  });

  test("validates the ownership declaration against the shipped registry", async () => {
    const hub = await readyHub();
    const report = registerOwnership({ registry: hub.registry });
    assert(report.ok, JSON.stringify(report.issues));
    assertEquals(report.counts.error, 0);
    assertEquals(report.fields.length, Object.values(OPENRPA_FIELD_MODEL).reduce((total, list) => total + list.length, 0));
    const table = ownershipTable({ registry: hub.registry });
    assertEquals(table.length, hub.registry.entityTypes.length);
    const company = table.find((entry) => entry.typeId === "company");
    const status = company.fields.find((entry) => entry.key === "automationStatus");
    assertEquals(status.owner, "openrpa");
    assertEquals(status.direction, "push");
    assertEquals(status.priority, priorityOf("openrpa"));
    assert(company.fields.some((entry) => entry.automation));
  });

  test("maps hub automation fields to OpenFlow document values", () => {
    for (const key of ["automationStatus", "automationWorkflow", "automationQueue", "lastAutomationRun"]) {
      assert(OPENRPA_REMOTE_FIELDS[key], `${key} should have a remote mapping`);
      assert(typeof OPENRPA_REMOTE_FIELDS[key].read === "function");
      assert(typeof OPENRPA_REMOTE_FIELDS[key].write === "function");
    }
    const remote = { values: { state: "failed", wiqid: "qi_invoice" }, payloadValue: () => "wf_onboard" };
    assertEquals(OPENRPA_REMOTE_FIELDS.automationStatus.read(remote), "failed");
    assertEquals(OPENRPA_REMOTE_FIELDS.automationQueue.read(remote), "qi_invoice");
    assertEquals(OPENRPA_REMOTE_FIELDS.automationWorkflow.read(remote), "wf_onboard");
  });
});

suite("OpenRPA entity linking", () => {
  test("reads every OpenRPA target type from the live endpoint", async () => {
    const { or } = await connectedHub();
    await or.invocation.invoke({ workflowId: "wf_report", durationMs: 0 });
    await or.linking.refreshTargets();
    const targets = or.linking.targets({});
    assert(targets.length >= 10, `expected several targets, got ${targets.length}`);
    for (const typeId of OPENRPA_TARGET_TYPES.map((entry) => entry.id)) {
      assert(targets.some((entry) => entry.type === typeId), `expected a ${typeId} target`);
    }
    assert(targets.some((entry) => entry.type === "workflow" && entry.id === "wf_invoice"));
    or.disconnect();
  });

  test("links, browses and unlinks a canonical entity", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    const linked = await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workflow", targetId: "wf_onboard", origin: "manual" });
    assert(linked.ok, JSON.stringify(linked));
    assertEquals(or.linking.linksFor("company", company.id).length, 1);
    const browsed = or.linking.browse({ entityType: "company", entityId: company.id });
    assertEquals(browsed.length, 1);
    assertEquals(browsed[0].targetType, "workflow");
    assertEquals(browsed[0].resolved, true);
    assertEquals(browsed[0].missing, false);
    const removed = await or.linking.unlink(linked.link.id);
    assertEquals(removed.ok, true);
    assertEquals(or.linking.linksFor("company", company.id).length, 0);
    const missing = await or.linking.link({ entityType: "company", entityId: "co_missing", targetType: "workflow", targetId: "wf_onboard" });
    assertEquals(missing.ok, false);
    or.disconnect();
  });

  test("suggests targets and auto-links from work-item payloads", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    const references = or.linking.references();
    const onboard = references.find((entry) => entry.targetId === "wi_1005");
    assert(onboard, "expected wi_1005 to be indexed");
    const reference = onboard.references.find((entry) => entry.entityType === "company");
    assertEquals(reference.entityId, company.id);
    const result = await or.linking.autolink();
    assert(result.created >= 1, `expected at least one auto-link, got ${result.created}`);
    const edge = or.linking.browse({ entityType: "company", entityId: company.id, targetType: "workitem" })[0];
    assert(edge, "expected the company to be linked to its work item");
    assertEquals(edge.origin, "auto");
    assertEquals(edge.targetId, "wi_1005");
    or.disconnect();
  });

  test("reports work items that reference unknown entities as orphans", async () => {
    const { or } = await connectedHub();
    const orphans = or.linking.orphanReferences();
    assert(orphans.length >= 1, "expected at least one orphan reference");
    assert(orphans.every((entry) => entry.targetType === "workitem" && entry.entityId));
    assert(OPENRPA_PAYLOAD_REFERENCES.some((entry) => entry.key === "companyId"));
    or.disconnect();
  });

  test("a dangling target is flagged as unresolved after it disappears", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1007" });
    await or.documents.remove("openrpa_workitem", "wi_1007");
    await or.linking.refreshTargets();
    const edge = or.linking.browse({ entityType: "company", entityId: company.id })[0];
    assertEquals(edge.resolved, false);
    assertEquals(edge.missing, true);
    assertEquals(or.linking.stats().unresolved >= 1, true);
    or.disconnect();
  });
});

suite("OpenRPA drift detection", () => {
  test("detects field, record and relationship drift against OpenFlow", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1005" });
    await or.drift.captureTargets();

    assertEquals(OPENRPA_DRIFT_KINDS, ["field", "record", "relationship"]);
    let summary = await or.drift.scan({ refresh: true });
    assertEquals(or.drift.open().filter((entry) => entry.kind === "field" && entry.entityId === company.id).length, 0);

    await hub.identity.setField("company", company.id, "automationStatus", "running", "openrpa");
    summary = await or.drift.scan({ refresh: false });
    assert(summary.found >= 1, "expected a drift signal");
    const field = or.drift.open().find((entry) => entry.kind === "field" && entry.entityId === company.id);
    assert(field, `expected field drift, got ${JSON.stringify(or.drift.open().map((entry) => entry.kind))}`);
    assertEquals(field.held, "running");
    assertEquals(field.expected, "failed");
    assertEquals(field.targetId, "wi_1005");

    const got = await or.documents.get("openrpa_workitem", "wi_1005");
    await or.documents.update("openrpa_workitem", { _id: "wi_1005", _version: got.document.version, name: "wi_1005_renamed" });
    await or.drift.scan({ refresh: true });
    const record = or.drift.open().find((entry) => entry.kind === "record" && entry.targetId === "wi_1005");
    assert(record, "expected record drift after the document version moved");

    await or.documents.remove("openrpa_workitem", "wi_1007");
    or.disconnect();
  });

  test("resolves drift once the hub adopts the OpenFlow value", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1005" });
    await hub.identity.setField("company", company.id, "automationStatus", "running", "openrpa");
    await or.drift.scan({ refresh: false });
    assertEquals(or.drift.open().some((entry) => entry.kind === "field" && entry.entityId === company.id), true);
    await hub.identity.setField("company", company.id, "automationStatus", "failed", "openrpa");
    await or.drift.scan({ refresh: false });
    assertEquals(or.drift.open().some((entry) => entry.kind === "field" && entry.entityId === company.id), false);
    assertEquals(or.drift.stats().resolved >= 1, true);
    or.disconnect();
  });

  test("flags relationship drift for a deleted work item and an orphan reference", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1006" });
    await or.documents.remove("openrpa_workitem", "wi_1006");
    await or.drift.scan({ refresh: true });
    const open = or.drift.open();
    assert(open.some((entry) => entry.kind === "relationship" && entry.targetId === "wi_1006"), "expected relationship drift for the deleted work item");
    assert(open.some((entry) => entry.kind === "relationship" && entry.entityName === "(unknown)"), "expected an orphan-reference relationship signal");
    or.disconnect();
  });

  test("hydrates and resets drift and its snapshots", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1005" });
    await hub.identity.setField("company", company.id, "automationStatus", "running", "openrpa");
    await or.drift.scan({ refresh: false });
    assert(or.drift.open().length >= 1);
    const before = or.drift.open().length;
    await hub.resetData();
    assertEquals(or.drift.open().length, 0);
    assertEquals(or.linking.stats().links, 0);
    assertEquals(hub.registry.validate().counts.error, 0);
    assert(before >= 1);
  });
});

suite("OpenRPA reconciliation", () => {
  test("adopts the OpenRPA value under prefer-openrpa and logs the change", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1005" });
    await hub.identity.setField("company", company.id, "automationStatus", "running", "openrpa");
    await or.drift.scan({ refresh: false });
    const result = await or.sync.reconcile({ policy: "prefer-openrpa" });
    assert(result.applied >= 1, JSON.stringify(result));
    assertEquals(hub.identity.get("company", company.id).fields.automationStatus, "failed");
    const change = or.sync.history()[0];
    assertEquals(change.action, "adopt");
    assertEquals(change.source, "openrpa");
    assertEquals(change.entityId, company.id);
    assertEquals(or.sync.stats().adopted >= 1, true);
    or.disconnect();
  });

  test("pushes the hub value into OpenFlow under prefer-hub", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1001" });
    await hub.identity.setField("company", company.id, "automationQueue", "qi_onboard", "openrpa");
    await or.drift.scan({ refresh: false });
    assert(or.drift.open().some((entry) => entry.kind === "field" && entry.field === "automationQueue"), "expected field drift on the queue");
    const result = await or.sync.reconcile({ policy: "prefer-hub" });
    assert(result.applied >= 1, JSON.stringify(result));
    const got = await or.documents.get("openrpa_workitem", "wi_1001");
    assertEquals(got.document.values.wiqid, "qi_onboard");
    assertEquals(or.sync.history()[0].action, "push");
    assertEquals(or.sync.history()[0].source, "hub");
    or.disconnect();
  });

  test("manual review leaves the proposals untouched", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1005" });
    await hub.identity.setField("company", company.id, "automationStatus", "running", "openrpa");
    await or.drift.scan({ refresh: false });
    const result = await or.sync.reconcile({ policy: "manual" });
    assertEquals(result.applied, 0);
    assertEquals(result.pending >= 1, true);
    assertEquals(hub.identity.get("company", company.id).fields.automationStatus, "running");
    const proposals = or.sync.proposals({ policy: "manual" });
    assertEquals(proposals.every((entry) => entry.auto === false), true);
    assertEquals(hub.registry.validate().counts.error, 0);
    or.disconnect();
  });

  test("exposes the policy vocabulary", () => {
    assertEquals(OPENRPA_SYNC_POLICIES, ["manual", "prefer-hub", "prefer-openrpa"]);
    for (const policy of OPENRPA_SYNC_POLICIES) assert(OPENRPA_SYNC_POLICY_LABELS[policy]);
  });
});

suite("OpenRPA conflict review", () => {
  test("approves a proposal, applying it and recording the decision", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1005" });
    await hub.identity.setField("company", company.id, "automationStatus", "running", "openrpa");
    await or.drift.scan({ refresh: false });
    const proposals = or.conflicts.proposals({ policy: "manual" });
    const field = proposals.find((entry) => entry.kind === "field" && entry.entityId === company.id);
    assert(field, "expected a field proposal");
    const diff = or.conflicts.diff(field);
    assertEquals(diff.hub, "running");
    assertEquals(diff.openrpa, "failed");
    const result = await or.conflicts.approve(field.id, { policy: "prefer-openrpa" });
    assert(result.ok, JSON.stringify(result));
    assertEquals(hub.identity.get("company", company.id).fields.automationStatus, "failed");
    assertEquals(or.conflicts.decisionRecords()[0].decision, "approved");
    assertEquals(or.conflicts.stats().approved, 1);
    or.disconnect();
  });

  test("rejects a proposal without applying it and keeps the history", async () => {
    const { hub, or } = await connectedHub();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1005" });
    await hub.identity.setField("company", company.id, "automationStatus", "running", "openrpa");
    await or.drift.scan({ refresh: false });
    const proposal = or.conflicts.proposals({ policy: "manual" }).find((entry) => entry.kind === "field" && entry.entityId === company.id);
    assert(proposal, "expected a field proposal");
    const result = await or.conflicts.reject(proposal.id, { reason: "keep the hub value" });
    assertEquals(result.ok, true);
    assertEquals(hub.identity.get("company", company.id).fields.automationStatus, "running");
    const records = or.conflicts.decisionRecords();
    assertEquals(records[0].decision, "rejected");
    assertEquals(records[0].note, "keep the hub value");
    assertEquals(or.conflicts.proposals({ policy: "manual" }).some((entry) => entry.id === proposal.id), false);
    assertEquals(or.conflicts.stats().rejected, 1);
    await or.conflicts.undo(proposal.id);
    assertEquals(or.conflicts.decisionRecords().length, 0);
    assertEquals(OPENRPA_DECISIONS, ["approved", "rejected"]);
    or.disconnect();
  });
});

suite("OpenRPA sync hub integration", () => {
  test("the ready hub exposes linking, drift, sync and conflicts", async () => {
    const hub = await readyHub();
    for (const name of ["linking", "drift", "sync", "conflicts"]) {
      assert(hub.openrpa[name], `hub.openrpa.${name} should exist`);
    }
    const status = hub.openrpa.status();
    for (const name of ["linking", "drift", "sync", "conflicts"]) {
      assert(status[name], `status should report ${name}`);
    }
    for (const name of [OPENRPA_LINKS_COLLECTION, OPENRPA_SYNC_COLLECTION]) {
      assert(OPENRPA_COLLECTIONS.includes(name), `${name} should be a hub collection`);
      assert(hub.db.collections().includes(name), `${name} should be registered on the database`);
    }
    assertEquals(hub.registry.validate().counts.error, 0);
  });

  test("links, drift and decisions survive a hydrate round trip", async () => {
    const hub = await readyHub();
    const or = hub.openrpa;
    await or.connect({ announce: false });
    await or.linking.refreshTargets();
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workitem", targetId: "wi_1005" });
    await hub.identity.setField("company", company.id, "automationStatus", "running", "openrpa");
    await or.drift.scan({ refresh: false });
    await or.drift.captureTargets();
    const proposal = or.conflicts.proposals({ policy: "manual" })[0];
    assert(proposal, "expected a pending proposal before persisting a decision");
    await or.conflicts.reject(proposal.id, { reason: "deferred" });
    assert(or.linking.stats().links >= 1);
    await or.linking.hydrate();
    await or.drift.hydrate();
    await or.sync.hydrate();
    await or.conflicts.hydrate();
    assert(or.linking.stats().links >= 1);
    assert(or.drift.entries().length >= 1);
    assert(or.conflicts.decisionRecords().length >= 1);
    or.disconnect();
  });
});
