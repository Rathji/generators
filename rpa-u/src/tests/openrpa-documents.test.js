import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { createPermissions } from "../core/permissions.js";
import { TOOL_ROLE_MAPS } from "../core/catalog.js";
import { createOpenRpaConnector } from "../core/openrpa/connector.js";
import {
  normalizeDocument,
  serializeDocument,
  describeDocument,
  summarizeDocument,
  documentType,
  documentTypeForCollection,
  collectionForType,
  templateFor,
  parseQueryText,
  parseOrderbyText,
  parseProjectionText,
  buildQuery,
  namedQueries,
  namedQuery,
  paginate,
  classifyError,
  OPENRPA_DOCUMENT_TYPES,
} from "../core/openrpa/documents.js";
import { normalizeWorkflow, presentWorkflow, workflowIssues, normalizeParameter } from "../core/openrpa/workflows.js";
import {
  normalizeAcl,
  decodeRights,
  hasRight,
  aceMatches,
  computeEffectiveRights,
  computeAction,
  aclStats,
  OPENRPA_FULL_RIGHTS,
} from "../core/openrpa/acl.js";
import { buildOpenRpaFixtures } from "../core/openrpa/fixtures.js";

function makeConnector() {
  return createOpenRpaConnector({ permissions: createPermissions(), roleMaps: TOOL_ROLE_MAPS });
}

suite("OpenRPA document model", () => {
  test("types are discoverable by id and by collection", () => {
    assertEquals(documentType("workflow").collection, "workflows");
    assertEquals(documentTypeForCollection("openrpa_workitem").id, "workitem");
    assertEquals(collectionForType("workitemqueue"), "openrpa_queue");
    assert(OPENRPA_DOCUMENT_TYPES.length >= 6, "expected the modelled document types");
    assertEquals(documentType("nope"), null);
  });

  test("normalisation splits modelled fields from unknown ones and preserves everything", () => {
    const raw = {
      _id: "co_9",
      _type: "company",
      name: "Acme",
      _version: 4,
      _created: "2024-01-01T00:00:00.000Z",
      _modified: "2024-02-01T00:00:00.000Z",
      _createdby: "crm-u",
      _modifiedby: "crm-u",
      domain: "acme.example",
      customFlag: true,
      nested: { a: [1, 2, 3] },
    };
    const record = normalizeDocument(raw);
    assertEquals(record.type, "company");
    assertEquals(record.version, 4);
    assertEquals(record.values.domain, "acme.example");
    assertEquals(record.unknownKeys.sort(), ["customFlag", "nested"]);
    assert(record.fields.find((entry) => entry.key === "domain").present);
    assertEquals(serializeDocument(record), raw, "round-trip must be lossless");
  });

  test("describeDocument exposes rows and formatted fields", () => {
    const record = normalizeDocument({ _id: "wf_x", _type: "workflow", name: "demo", filename: "demo.xaml", rpa: true, queue: null });
    const described = describeDocument(record);
    assertEquals(described.rows.find((row) => row.label === "Id").value, "wf_x");
    const rpa = described.fields.find((entry) => entry.key === "rpa");
    assertEquals(rpa.display, "yes");
    const queue = described.fields.find((entry) => entry.key === "queue");
    assertEquals(queue.present, true);
    assertEquals(queue.display, "—");
    assertEquals(summarizeDocument(record).includes("filename"), true);
  });

  test("templates omit large fields and seed the right shape", () => {
    const template = templateFor("workflows");
    assertEquals(template._type, "workflow");
    assertEquals(template.rpa, false);
    assertEquals("xaml" in template, false);
    assertEquals(template.parameters.length, 0);
  });
});

suite("OpenRPA query builder", () => {
  test("query text parses JSON objects and rejects everything else", () => {
    assertEquals(parseQueryText("").query, null);
    assertEquals(parseQueryText('{"state":"new"}').query, { state: "new" });
    assertEquals(parseQueryText("{nope").error.code, "invalid-json");
    assertEquals(parseQueryText("[1,2]").error.code, "invalid-query");
    assertEquals(parseQueryText("42").error.code, "invalid-query");
  });

  test("order by and projection text parse into OpenFlow shapes", () => {
    assertEquals(parseOrderbyText("").orderby, null);
    assertEquals(parseOrderbyText("name, -_modified").orderby, { name: 1, _modified: -1 });
    assertEquals(parseOrderbyText("severity:desc").orderby, { severity: -1 });
    assertEquals(parseOrderbyText("a:1, b:2").orderby, { a: 1, b: 2 });
    assertEquals(parseOrderbyText("a:sideways").error.code, "invalid-orderby");
    assertEquals(parseProjectionText("_id, name").projection, ["_id", "name"]);
    assertEquals(parseProjectionText("").projection, null);
  });

  test("buildQuery combines its three parts and stops on the first bad one", () => {
    const good = buildQuery({ queryText: '{"a":1}', orderbyText: "-a", projectionText: "_id" });
    assert(good.ok);
    assertEquals(good.query, { a: 1 });
    assertEquals(good.orderby, { a: -1 });
    assertEquals(good.projection, ["_id"]);
    const bad = buildQuery({ queryText: "{oops" });
    assertEquals(bad.ok, false);
    assertEquals(bad.error.code, "invalid-json");
  });

  test("named queries are aliases scoped to a collection", () => {
    const workflowQueries = namedQueries("workflows");
    assert(workflowQueries.some((entry) => entry.id === "all"), "the global alias always applies");
    assert(workflowQueries.some((entry) => entry.id === "workflows-bound"));
    assert(!workflowQueries.some((entry) => entry.id === "workitems-new"), "other collections' aliases are excluded");
    assertEquals(namedQuery("workitems-failed").query, { state: "failed" });
    assertEquals(namedQuery("missing"), null);
  });

  test("pagination clamps the page and reports its window", () => {
    const first = paginate({ total: 23, page: 1, pageSize: 10 });
    assertEquals(first.pageCount, 3);
    assertEquals(first.from, 1);
    assertEquals(first.to, 10);
    assertEquals(first.hasNext, true);
    assertEquals(first.hasPrev, false);
    const beyond = paginate({ total: 23, page: 99, pageSize: 10 });
    assertEquals(beyond.page, 3);
    assertEquals(beyond.to, 23);
    const empty = paginate({ total: 0, page: 4, pageSize: 10 });
    assertEquals(empty.page, 1);
    assertEquals(empty.from, 0);
  });
});

suite("OpenRPA document service", () => {
  test("collections list with their counts and modelled type", async () => {
    const or = makeConnector();
    await or.connect({ announce: false });
    const collections = await or.documents.listCollections();
    assert(Array.isArray(collections));
    const workflows = collections.find((entry) => entry.name === "workflows");
    assertEquals(workflows.count, 4);
    assertEquals(workflows.type, "workflow");
    or.disconnect();
  });

  test("query applies filters, projection and ordering", async () => {
    const or = makeConnector();
    await or.connect({ announce: false });
    const docs = await or.documents.query("openrpa_workitem", { query: { state: "new" }, projection: ["_id", "state"], orderby: { _created: -1 } });
    assert(Array.isArray(docs));
    assert(docs.length >= 2);
    assert(docs.every((doc) => doc.id && doc.values.state === "new"));
    assertEquals(docs[0].type, "workitem");
    or.disconnect();
  });

  test("page returns documents with a paging window", async () => {
    const or = makeConnector();
    await or.connect({ announce: false });
    const result = await or.documents.page("openrpa_workitem", { page: 1, pageSize: 3 });
    assertEquals(result.ok, true);
    assertEquals(result.total, 7);
    assertEquals(result.pageCount, 3);
    assertEquals(result.documents.length, 3);
    assertEquals(result.hasNext, true);
    or.disconnect();
  });

  test("insert, upsert, update and delete round-trip with optimistic concurrency", async () => {
    const or = makeConnector();
    await or.connect({ announce: false });

    const inserted = await or.documents.insert("companies", { name: "Gadget Co", domain: "gadget.example" });
    assert(inserted.ok, JSON.stringify(inserted));
    assert(inserted.document.id, "the server assigns an id");
    assertEquals(inserted.document.version, 1);

    const first = await or.documents.upsert("companies", { name: "Gadget Ltd", domain: "gadget.example" }, { uniq: { domain: "gadget.example" } });
    assert(first.ok, JSON.stringify(first));
    assertEquals(first.document.id, inserted.document.id, "upsert matches on the uniqueness key");
    assertEquals(first.document.name, "Gadget Ltd");
    assertEquals(first.document.version, 2);

    const stale = await or.documents.update("companies", { ...first.document.raw, name: "Gadget PLC" }, { expectedVersion: 1 });
    assertEquals(stale.ok, false);
    assertEquals(stale.error.kind, "conflict");

    const updated = await or.documents.update("companies", { ...first.document.raw, name: "Gadget PLC" }, { expectedVersion: first.document.version });
    assert(updated.ok, JSON.stringify(updated));
    assertEquals(updated.document.name, "Gadget PLC");
    assertEquals(updated.document.version, 3);

    const fetched = await or.documents.get("companies", inserted.document.id);
    assert(fetched.ok);
    assertEquals(fetched.document.name, "Gadget PLC");

    const removed = await or.documents.remove("companies", inserted.document.id);
    assertEquals(removed.deleted, 1);
    const gone = await or.documents.get("companies", inserted.document.id);
    assertEquals(gone.document, null);
    or.disconnect();
  });

  test("bulk insert and delete report their counts", async () => {
    const or = makeConnector();
    await or.connect({ announce: false });
    const batch = await or.documents.insertMany("companies", [
      { name: "North", domain: "n.example" },
      { name: "South", domain: "s.example" },
    ]);
    assert(batch.ok);
    assertEquals(batch.inserted, 2);
    const ids = (await or.documents.query("companies", { query: { domain: { $in: ["n.example", "s.example"] } } })).map((doc) => doc.id);
    const cleared = await or.documents.removeMany("companies", ids);
    assert(cleared.ok);
    assertEquals(cleared.deleted, ids.length);
    or.disconnect();
  });

  test("validation, not-found and transport failures are classified distinctly", async () => {
    const or = makeConnector();
    await or.connect({ announce: false });

    const noId = await or.documents.update("companies", { name: "Nameless" });
    assertEquals(noId.error.kind, "validation");
    const notAnObject = await or.documents.insert("companies", 7);
    assertEquals(notAnObject.error.kind, "validation");
    const missing = await or.documents.update("companies", { _id: "co_missing", name: "x" });
    assertEquals(missing.error.kind, "not-found");

    or.emulator.setOnline(false);
    const offline = await or.documents.query("companies");
    assertEquals(offline.ok, false);
    assertEquals(offline.error.kind, "transport");
    assert(offline.error.retryable, "a transport failure is retryable");
    or.emulator.setOnline(true);
    or.disconnect();
  });

  test("classifyError maps codes and messages to a kind", () => {
    assertEquals(classifyError({ code: "timeout", message: "no reply" }).error.kind, "transport");
    assertEquals(classifyError({ code: "protocol-error", message: "Version conflict: stored is at 4." }).error.kind, "conflict");
    assertEquals(classifyError({ code: "protocol-error", message: 'Document "x" was not found.' }).error.kind, "not-found");
    assertEquals(classifyError({ code: "protocol-error", message: "A collection name is required." }).error.kind, "validation");
    assertEquals(classifyError({ code: "protocol-error", message: "Something odd happened." }).error.kind, "server");
  });
});

suite("OpenRPA workflow presentation", () => {
  test("a workflow document normalises its flags, binding and parameters", () => {
    const fixtures = buildOpenRpaFixtures({ now: 1000 });
    const workflow = normalizeWorkflow(fixtures.documents.workflows.find((doc) => doc._id === "wf_invoice"));
    assertEquals(workflow.filename, "nightly-invoice-run.xaml");
    assertEquals(workflow.queue, "qi_invoice");
    assertEquals(workflow.rpa, true);
    assertEquals(workflow.web, false);
    assertEquals(workflow.background, true);
    assertEquals(workflow.serializable, true);
    assertEquals(workflow.parameterCount, 3);
    assertEquals(workflow.parameters[0].name, "invoiceId");
    assertEquals(workflow.parameters[0].direction, "in");
    assertEquals(workflow.parameters[2].direction, "out");
    assertEquals(workflow.hasSource, true);
    assert(workflow.sourceLength > 0);
    assertEquals("xaml" in workflow, false, "the raw XAML must not be exposed by the normalised workflow");
  });

  test("parameters normalise aliases and flag unknown directions", () => {
    assertEquals(normalizeParameter({ name: "a", direction: "Input" }).direction, "in");
    assertEquals(normalizeParameter({ name: "b", direction: "output" }).direction, "out");
    const odd = normalizeParameter({ name: "c", direction: "sideways" });
    assertEquals(odd.knownDirection, false);
    assertEquals(normalizeParameter({ name: "d", required: true, default: 2 }).hasDefault, true);
  });

  test("workflow checks surface real problems and an absent source", () => {
    const workflow = normalizeWorkflow({ _id: "wf_1", name: "unbound", filename: "unbound.xaml", rpa: false, web: false, parameters: [] });
    const issues = workflowIssues(workflow, { queueIds: ["qi_1"] });
    assert(issues.some((issue) => issue.code === "no-execution-mode"));
    assert(issues.some((issue) => issue.code === "no-source"));
    assert(issues.some((issue) => issue.code === "no-queue"));

    const bound = normalizeWorkflow({ _id: "wf_2", name: "bound", filename: "b.xaml", rpa: true, queue: "qi_9", parameters: [] });
    assert(workflowIssues(bound, { queueIds: ["qi_1"] }).some((issue) => issue.code === "missing-queue"));

    const duplicated = normalizeWorkflow({
      _id: "wf_3",
      name: "dup",
      filename: "d.xaml",
      rpa: true,
      queue: "qi_1",
      xaml: "<x/>",
      parameters: [
        { name: "p", type: "string", direction: "in" },
        { name: "p", type: "string", direction: "sideways" },
        { name: "", type: "string", direction: "in" },
        { name: "q", type: "string", direction: "in", required: true, default: 1 },
      ],
    });
    const report = presentWorkflow(duplicated, { queueIds: ["qi_1"] });
    assertEquals(report.ok, false);
    assert(report.errors.some((issue) => issue.code === "duplicate-parameter"));
    assert(report.errors.some((issue) => issue.code === "unnamed-parameter"));
    assert(report.warnings.some((issue) => issue.code === "unknown-direction"));
    assert(report.warnings.some((issue) => issue.code === "required-with-default"));
    assert(report.summary.includes("RPA"));
    assertEquals(report.parameters.length, 4);
  });
});

suite("OpenRPA ACL, users & roles", () => {
  test("rights bitmasks decode into named permissions", () => {
    const full = decodeRights(OPENRPA_FULL_RIGHTS);
    assertEquals(full.full, true);
    assert(full.granted.includes("read") && full.granted.includes("delete"));
    assertEquals(hasRight(2, "write"), true);
    assertEquals(hasRight(2, "delete"), false);
    assertEquals(decodeRights(["read", "execute"]).granted.sort(), ["execute", "read"]);
    const extended = decodeRights(65535);
    assertEquals(extended.extended > 0, true);
  });

  test("ACL entries normalise and match by everyone, user or role", () => {
    const acl = normalizeAcl({
      _id: "acl_1",
      name: "Restricted",
      ace: [
        { _id: "a1", name: "Administrator", deny: false, rights: 65535 },
        { _id: "a2", name: "Vera", deny: true, rights: 8 },
      ],
    });
    assertEquals(acl.restricted, true);
    assertEquals(acl.members, 2);
    assertEquals(acl.denied, 1);
    assert(aceMatches({ name: "Everyone" }, { user: { username: "anyone" } }));
    assert(aceMatches({ name: "Administrator" }, { user: { username: "ada" }, roles: ["Administrator"] }));
    assert(!aceMatches({ name: "Administrator" }, { user: { username: "vera" }, roles: ["Viewer"] }));
    const stats = aclStats(acl);
    assertEquals(stats.members, 2);
    assert(stats.rightKeys.includes("read"));
  });

  test("effective rights grant, deny by default and let deny win", () => {
    const restricted = normalizeAcl(buildOpenRpaFixtures().documents.companies.find((doc) => doc._id === "co_4400")._acl);
    const admin = computeEffectiveRights(restricted, { user: { username: "ada" }, roles: ["Administrator"] });
    assertEquals(admin.full, true);
    assertEquals(admin.actions.delete, true);

    const viewer = computeEffectiveRights(restricted, { user: { username: "vera" }, roles: ["Viewer"] });
    assertEquals(viewer.defaulted, true);
    assertEquals(viewer.granted.length, 0);
    assertEquals(viewer.actions.read, false);

    const contested = normalizeAcl({ name: "Contested", ace: [{ name: "Everyone", deny: false, rights: 65535 }, { name: "vera", deny: true, rights: 8 }] });
    const vera = computeEffectiveRights(contested, { user: { username: "Vera" }, roles: ["Viewer"] });
    assertEquals(hasRight(vera.rights, "read"), true);
    assertEquals(hasRight(vera.rights, "delete"), false, "a deny entry removes the right");
    assert(!vera.defaulted, "matching entries means it is not the deny-by-default case");
  });

  test("computeAction explains the decision", () => {
    const restricted = normalizeAcl(buildOpenRpaFixtures().documents.companies.find((doc) => doc._id === "co_4400")._acl);
    const allowed = computeAction(restricted, { user: { username: "ada" }, roles: ["Administrator"] }, "delete");
    assertEquals(allowed.allowed, true);
    assert(/grant/i.test(allowed.reason));
    const denied = computeAction(restricted, { user: { username: "vera" }, roles: ["Viewer"] }, "update");
    assertEquals(denied.allowed, false);
    assert(/denies by default/i.test(denied.reason));
    const unknown = computeAction(restricted, {}, "fly");
    assertEquals(unknown.allowed, false);
  });

  test("the mirror syncs users and roles and evaluates a document for a subject", async () => {
    const or = makeConnector();
    await or.connect({ announce: false });
    const sync = await or.acl.sync();
    assert(sync.ok, sync.error);
    assertEquals(sync.users, 3);
    assertEquals(sync.roles, 5);
    assert(or.acl.synced());

    await or.signIn({ username: "ada", password: "demo" });
    const subject = or.acl.subjectFor(or.session.sessionInfo());
    assertEquals(subject.user.username, "ada");
    assert(subject.roles.includes("Administrator"));

    const company = (await or.documents.query("companies", { query: { _id: "co_4400" } }))[0];
    assert(or.acl.actionForDocument(company.raw, subject, "delete").allowed);
    const vera = or.acl.users().find((user) => user.username === "vera");
    assertEquals(or.acl.actionForDocument(company.raw, or.acl.subjectForUser(vera), "update").allowed, false);
    assertEquals(or.acl.stats().users, 3);
    or.acl.reset();
    assertEquals(or.acl.synced(), false);
    or.disconnect();
  });
});

suite("OpenRPA documents hub integration", () => {
  test("the ready hub exposes document and ACL services", async () => {
    const hub = await createHub({ kv: null }).ready();
    assert(hub.openrpa.documents, "hub.openrpa.documents should exist");
    assert(hub.openrpa.acl, "hub.openrpa.acl should exist");
    const collections = await hub.openrpa.documents.listCollections();
    assert(Array.isArray(collections) && collections.length >= 6);
    const sync = await hub.openrpa.acl.sync();
    assert(sync.ok);
    assertEquals(hub.registry.validate().counts.error, 0);
  });

  test("writing documents through the hub leaves the canonical directory untouched", async () => {
    const hub = await createHub({ kv: null }).ready();
    const before = hub.identity.stats().total;
    const inserted = await hub.openrpa.documents.insert("companies", { name: "Hub Co", domain: "hub.example" });
    assert(inserted.ok, JSON.stringify(inserted));
    const updated = await hub.openrpa.documents.update("companies", { ...inserted.document.raw, name: "Hub Co Ltd" }, { expectedVersion: inserted.document.version });
    assert(updated.ok);
    assertEquals(updated.document.version, 2);
    const removed = await hub.openrpa.documents.remove("companies", inserted.document.id);
    assertEquals(removed.deleted, 1);
    assertEquals(hub.identity.stats().total, before, "OpenFlow documents must not touch the canonical identity store");
    assertEquals(hub.registry.validate().counts.error, 0);
  });

  test("resetting the hub clears document and mirror state", async () => {
    const hub = await createHub({ kv: null }).ready();
    await hub.openrpa.connect({ announce: false });
    await hub.openrpa.acl.sync();
    await hub.openrpa.documents.insert("companies", { name: "Temp", domain: "temp.example" });
    assert(hub.openrpa.documents.stats().writes > 0);
    await hub.resetData();
    assertEquals(hub.openrpa.documents.stats().writes, 0);
    assertEquals(hub.openrpa.acl.synced(), false);
  });
});
