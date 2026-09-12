import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { createPermissions } from "../core/permissions.js";
import { TOOL_ROLE_MAPS } from "../core/catalog.js";
import { createOpenRpaConnector } from "../core/openrpa/connector.js";
import {
  OPENRPA_WORK_STATES,
  OPENRPA_PRIORITIES,
  isTerminalState,
  canTransition,
  transition,
  parsePayloadText,
  serializePayload,
  normalizeQueue,
  normalizeWorkItem,
  normalizeAttachment,
  classifyOutcome,
  retryBudget,
  routeFor,
  planCompletion,
  validateEnqueueInput,
} from "../core/openrpa/workitems.js";
import {
  OPENRPA_FILE_LIMIT,
  OPENRPA_DEFAULT_CONTENT_TYPE,
  baseName,
  extensionOf,
  guessContentType,
  isTextContentType,
  isImageContentType,
  formatBytes,
  normalizeFile,
  resolveContent,
  toDataUrl,
} from "../core/openrpa/files.js";

function makeConnector() {
  return createOpenRpaConnector({ permissions: createPermissions(), roleMaps: TOOL_ROLE_MAPS });
}

async function connected() {
  const or = makeConnector();
  await or.connect({ announce: false });
  return or;
}

async function makeQueue(or, input = {}) {
  const result = await or.workitems.createQueue({ name: "test-queue", maxretries: 1, retrydelay: 0, ...input });
  assert(result.ok, `queue create failed: ${JSON.stringify(result)}`);
  return result.queue;
}

suite("OpenRPA work-item helpers", () => {
  test("the state machine only permits declared transitions", () => {
    assertEquals(OPENRPA_WORK_STATES, ["new", "processing", "success", "failed", "abandoned"]);
    assert(canTransition("new", "processing"));
    assert(canTransition("processing", "success"));
    assert(canTransition("failed", "new"));
    assert(!canTransition("success", "processing"), "a success cannot return to processing directly");
    assert(!canTransition("abandoned", "failed"));
    assert(isTerminalState("success") && isTerminalState("failed") && isTerminalState("abandoned"));
    assert(!isTerminalState("new"));
    const bad = transition("new", "success");
    assertEquals(bad.ok, false);
    assertEquals(bad.error.code, "invalid-transition");
    assertEquals(transition("processing", "failed").ok, true);
  });

  test("payload parsing is strict about JSON objects", () => {
    assertEquals(parsePayloadText("").ok, true);
    assertEquals(parsePayloadText("").value, {});
    assertEquals(parsePayloadText('{"a":1}').value, { a: 1 });
    assertEquals(parsePayloadText("{nope").error.code, "invalid-json");
    assertEquals(parsePayloadText("[1,2]").error.code, "invalid-payload");
    assertEquals(parsePayloadText("42").error.code, "invalid-payload");
    assertEquals(serializePayload({ a: 1 }), '{"a":1}');
    assertEquals(serializePayload("raw"), "raw");
    assertEquals(serializePayload(null), "{}");
  });

  test("queues and work items normalise OpenFlow spellings", () => {
    const queue = normalizeQueue({ _id: "qi_1", name: "q", workflowid: "wf_1", robotqueue: "rb", maxretries: "3", retrydelay: 30, initialdelay: 5, success_wiqid: "qi_ok", failed_wiqid: "qi_bad", success_wiq: "success", failed_wiq: "failed" });
    assertEquals(queue.id, "qi_1");
    assertEquals(queue.workflowId, "wf_1");
    assertEquals(queue.robotQueue, "rb");
    assertEquals(queue.maxRetries, 3);
    assertEquals(queue.retryDelay, 30);
    assertEquals(queue.initialDelay, 5);
    assertEquals(queue.successQueueId, "qi_ok");
    assertEquals(queue.failedQueueId, "qi_bad");

    const item = normalizeWorkItem({ _id: "wi_1", wiqid: "qi_1", state: "failed", priority: "bogus", retries: "2", payload: '{"a":1}', errormessage: "boom", errortype: "TimeoutException", files: [{ filename: "a.txt", length: "4" }] });
    assertEquals(item.id, "wi_1");
    assertEquals(item.queueId, "qi_1");
    assertEquals(item.state, "failed");
    assertEquals(item.priority, "normal", "an unknown priority falls back to normal");
    assertEquals(item.retries, 2);
    assertEquals(item.payload, { a: 1 });
    assertEquals(item.payloadValid, true);
    assertEquals(item.terminal, true);
    assertEquals(item.error.present, true);
    assertEquals(item.error.type, "TimeoutException");
    assertEquals(item.error.business, false);
    assertEquals(item.files.length, 1);
    assertEquals(item.files[0].filename, "a.txt");

    const broken = normalizeWorkItem({ payload: "{oops" });
    assertEquals(broken.payloadValid, false);
    assertEquals(broken.payloadError !== null, true);
    assertEquals(broken.state, "new", "an unknown state falls back to new");
  });

  test("an attachment normalises name, type and size", () => {
    const attachment = normalizeAttachment({ _id: "file_1", filename: "a.pdf", contenttype: "application/pdf", length: "12", refid: "wi_1", ref: "workitem" });
    assertEquals(attachment.id, "file_1");
    assertEquals(attachment.filename, "a.pdf");
    assertEquals(attachment.contentType, "application/pdf");
    assertEquals(attachment.length, 12);
    assertEquals(attachment.refId, "wi_1");
  });

  test("outcome classification splinters business-rule failures from retries", () => {
    assertEquals(classifyOutcome({}).outcome, "success");
    assertEquals(classifyOutcome({ error: { message: "timeout" } }).outcome, "retry");
    assertEquals(classifyOutcome({ error: { message: "duplicate invoice" }, businessRule: true }).outcome, "fail");
    assertEquals(classifyOutcome({ error: { message: "Invalid business rule: missing tax id" } }).outcome, "fail");
    assertEquals(classifyOutcome({ error: { type: "BusinessRuleException", message: "x" } }).business, true);
  });

  test("retry budget and routing read the queue policy", () => {
    const queue = normalizeQueue({ maxretries: 3, retrydelay: 10, success_wiqid: "qi_ok", failed_wiqid: "qi_bad", success_wiq: "success", failed_wiq: "failed" });
    const budget = retryBudget(queue, { retries: 3 });
    assertEquals(budget.maxRetries, 3);
    assertEquals(budget.remaining, 0);
    assertEquals(budget.exhausted, true);
    assertEquals(routeFor(queue, "success").queueId, "qi_ok");
    assertEquals(routeFor(queue, "fail").route, "failed");
    assertEquals(routeFor(normalizeQueue({}), "fail"), null);
  });

  test("planCompletion models success, retry and exhaustion", () => {
    const queue = normalizeQueue({ maxretries: 2, retrydelay: 5, failed_wiqid: "qi_bad", failed_wiq: "failed" });
    const success = planCompletion({ retries: 0 }, queue, { now: 1000 });
    assertEquals(success.state, "success");
    assertEquals(success.requeued, false);

    const retry = planCompletion({ retries: 0 }, queue, { error: { message: "boom" }, now: 1000 });
    assertEquals(retry.state, "new");
    assertEquals(retry.retries, 1);
    assertEquals(retry.requeued, true);
    assertEquals(Date.parse(retry.nextRun), 1000 + 5000);

    const exhausted = planCompletion({ retries: 2 }, queue, { error: { message: "boom" }, now: 1000 });
    assertEquals(exhausted.state, "failed");
    assertEquals(exhausted.exhausted, true);
    assertEquals(exhausted.route.queueId, "qi_bad");

    const business = planCompletion({ retries: 0 }, queue, { error: { message: "bad rule" }, businessRule: true, now: 1000 });
    assertEquals(business.state, "failed");
    assertEquals(business.exhausted, true);
  });

  test("enqueue input validation rejects bad payloads, priorities and dates", () => {
    assertEquals(validateEnqueueInput({}).ok, true);
    assertEquals(validateEnqueueInput({ payload: { a: 1 } }).item.payload, '{"a":1}');
    assertEquals(validateEnqueueInput({ payload: "{bad" }).error.code, "invalid-json");
    assertEquals(validateEnqueueInput({ payload: [1] }).error.code, "invalid-payload");
    assertEquals(validateEnqueueInput({ priority: "urgent" }).error.code, "invalid-priority");
    assertEquals(validateEnqueueInput({ nextRun: "not-a-date" }).error.code, "invalid-nextrun");
    assertEquals(validateEnqueueInput({ files: "no" }).error.code, "invalid-files");
    assertEquals(validateEnqueueInput(null).error.code, "invalid-item");
    const dated = validateEnqueueInput({ nextRun: "2030-01-01T00:00:00Z" });
    assertEquals(dated.ok, true);
    assertEquals(dated.item.nextrun, "2030-01-01T00:00:00.000Z");
  });

  test("file helpers classify names, sizes and encodings", () => {
    assertEquals(baseName("a/b/report.csv"), "report.csv");
    assertEquals(extensionOf("report.CSV"), "csv");
    assertEquals(guessContentType("a.json"), "application/json");
    assertEquals(guessContentType("a.unknown"), OPENRPA_DEFAULT_CONTENT_TYPE);
    assert(isTextContentType("text/plain"));
    assert(isTextContentType("application/json"));
    assert(isImageContentType("image/png"));
    assert(!isImageContentType("application/pdf"));
    assertEquals(formatBytes(2048), "2.0 KB");
    assertEquals(resolveContent("hello").length, 5);
    assertEquals(resolveContent("aGVsbG8=", "base64").length, 5);
    const file = normalizeFile({ _id: "f1", filename: "x.txt", contenttype: "text/plain", length: "5" });
    assertEquals(file.contentType, "text/plain");
    assert(toDataUrl(file, "hello").startsWith("data:text/plain;base64,"));
  });
});

suite("OpenRPA queue management", () => {
  test("queues list, create, update and validate", async () => {
    const or = await connected();
    const invalid = await or.workitems.createQueue({ robotqueue: "x" });
    assertEquals(invalid.error.kind, "validation");
    const created = await or.workitems.createQueue({ name: "alpha", maxretries: 2, retrydelay: 15 });
    assert(created.ok, JSON.stringify(created));
    assertEquals(created.queue.name, "alpha");
    assertEquals(created.queue.maxRetries, 2);

    const updated = await or.workitems.updateQueue(created.queue.id, { maxretries: 5 });
    assert(updated.ok, JSON.stringify(updated));
    assertEquals(updated.queue.maxRetries, 5);

    const fetched = await or.workitems.getQueue(created.queue.id);
    assertEquals(fetched.queue.name, "alpha");
    assertEquals((await or.workitems.getQueue("nope")).queue, null);

    const all = await or.workitems.listQueues();
    assert(all.queues.some((queue) => queue.id === created.queue.id));
    assertEquals((await or.workitems.updateQueue(null, {})).error.kind, "validation");
    or.disconnect();
  });

  test("deleting a queue can purge its items first", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    await or.workitems.enqueue(queue.id, { payload: { a: 1 } });
    await or.workitems.enqueue(queue.id, { payload: { a: 2 } });

    const kept = await or.workitems.deleteQueue(queue.id, { purge: false });
    assert(kept.ok);
    assertEquals(kept.purged, 0);
    const orphans = await or.workitems.queryItems({ queueId: queue.id });
    assertEquals(orphans.items.length, 2, "without purge the items survive");

    const bust = await makeQueue(or, { name: "beta" });
    await or.workitems.enqueue(bust.id, { payload: { a: 1 } });
    await or.workitems.enqueue(bust.id, { payload: { a: 2 } });
    const cleared = await or.workitems.deleteQueue(bust.id, { purge: true });
    assertEquals(cleared.purged, 2);
    assertEquals((await or.workitems.queryItems({ queueId: bust.id })).items.length, 0);
    or.disconnect();
  });

  test("queue overview groups item counts per queue and reports orphans", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    await or.workitems.enqueue(queue.id, { payload: { a: 1 } });
    const item = (await or.workitems.queryItems({ queueId: queue.id })).items[0];
    await or.workitems.claim(queue.id, { worker: "tester" });
    await or.workitems.enqueue(queue.id, { payload: { a: 2 } });
    const overview = await or.workitems.queueOverview();
    assert(overview.ok);
    const bucket = overview.queues.find((entry) => entry.id === queue.id);
    assertEquals(bucket.counts.total, 2);
    assertEquals(bucket.counts.processing, 1);
    assertEquals(bucket.counts.new, 1);
    assert(Array.isArray(overview.orphans));
    or.disconnect();
  });
});

suite("OpenRPA enqueue", () => {
  test("a single item carries payload, priority, next-run and attachments", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    const result = await or.workitems.enqueue(queue.id, {
      payload: { hello: "world" },
      priority: "high",
      nextRun: "2030-01-01T00:00:00Z",
      files: [{ filename: "a.txt", length: 3 }],
    });
    assert(result.ok, JSON.stringify(result));
    assertEquals(result.item.state, "new");
    assertEquals(result.item.priority, "high");
    assertEquals(result.item.payload, { hello: "world" });
    assertEquals(result.item.files.length, 1);
    assertEquals(result.item.queueId, queue.id);
    or.disconnect();
  });

  test("enqueue rejects a bad payload and an unknown queue", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    assertEquals((await or.workitems.enqueue(queue.id, { payload: "{bad" })).error.code, "invalid-json");
    assertEquals((await or.workitems.enqueue("", { payload: {} })).error.code, "missing-queue");
    assertEquals((await or.workitems.enqueue("qi_missing", { payload: {} })).error.code, "queue-not-found");
    or.disconnect();
  });

  test("a bulk enqueue reports a result for every entry", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    const batch = await or.workitems.enqueueMany(queue.id, [{ payload: { n: 1 } }, { payload: "{bad" }, { payload: { n: 3 }, priority: "low" }]);
    assertEquals(batch.ok, true);
    assertEquals(batch.inserted, 2);
    assertEquals(batch.failed, 1);
    assertEquals(batch.results.length, 3);
    assertEquals(batch.results[1].ok, false);
    assertEquals(batch.results[1].index, 1);
    assertEquals(batch.results[2].item.priority, "low");
    assertEquals((await or.workitems.enqueueMany(queue.id, [])).error.code, "empty-batch");
    or.disconnect();
  });
});

suite("OpenRPA claim & lifecycle", () => {
  test("claim pops by priority then age and marks the worker", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    await or.workitems.enqueue(queue.id, { payload: { tag: "normal" }, priority: "normal" });
    await or.workitems.enqueue(queue.id, { payload: { tag: "low" }, priority: "low" });
    await or.workitems.enqueue(queue.id, { payload: { tag: "high" }, priority: "high" });

    const first = await or.workitems.claim(queue.id, { worker: "ada" });
    assertEquals(first.item.priority, "high");
    assertEquals(first.item.state, "processing");
    assertEquals(first.item.createdBy, "ada");

    const second = await or.workitems.claim(queue.id, { worker: "ada" });
    assertEquals(second.item.priority, "normal");
    const third = await or.workitems.claim(queue.id, { worker: "ada" });
    assertEquals(third.item.priority, "low");
    const empty = await or.workitems.claim(queue.id, { worker: "ada" });
    assertEquals(empty.claimed, false);
    or.disconnect();
  });

  test("claim skips items whose next-run time is in the future", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    await or.workitems.enqueue(queue.id, { payload: { tag: "later" }, nextRun: new Date(Date.now() + 6 * 3600000).toISOString() });
    const claimed = await or.workitems.claim(queue.id, { worker: "ada" });
    assertEquals(claimed.claimed, false, "the only item is not due yet");

    await or.workitems.enqueue(queue.id, { payload: { tag: "now" } });
    const due = await or.workitems.claim(queue.id, { worker: "ada" });
    assert(due.claimed);
    assertEquals(due.item.payload.tag, "now");
    or.disconnect();
  });

  test("claimMany drains up to the requested count", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    await or.workitems.enqueue(queue.id, { payload: { n: 1 } });
    await or.workitems.enqueue(queue.id, { payload: { n: 2 } });
    await or.workitems.enqueue(queue.id, { payload: { n: 3 } });
    const many = await or.workitems.claimMany(queue.id, 2);
    assertEquals(many.claimed, 2);
    assertEquals(many.items.length, 2);
    or.disconnect();
  });

  test("complete retries within the policy, then fails and routes", async () => {
    const or = await connected();
    const failedQueue = await makeQueue(or, { name: "failed-target" });
    const queue = await makeQueue(or, { name: "retry-source", maxretries: 1, retrydelay: 0, failed_wiqid: failedQueue.id, failed_wiq: "failed" });

    const enqueued = await or.workitems.enqueue(queue.id, { payload: { n: 1 } });
    const claim = await or.workitems.claim(queue.id, { worker: "ada" });
    assert(claim.claimed);

    const retry = await or.workitems.complete(claim.item, { error: { message: "transient", type: "TimeoutException" } });
    assertEquals(retry.state, "new");
    assertEquals(retry.requeued, true);
    assertEquals(retry.item.retries, 1);
    assertEquals(retry.item.state, "new");
    assertEquals(retry.item.error.message, "transient");
    assert(retry.item.nextRun, "a retry gets a next-run time");

    const claim2 = await or.workitems.claim(queue.id, { worker: "ada" });
    assert(claim2.claimed, "the retry is due immediately with a zero delay");
    const failed = await or.workitems.complete(claim2.item, { error: { message: "still broken" } });
    assertEquals(failed.state, "failed");
    assertEquals(failed.routed, true);
    assertEquals(failed.route.queueId, failedQueue.id);
    assertEquals(failed.item.queueId, failedQueue.id, "the item moves to the failure queue");

    const routed = await or.workitems.get(enqueued.item.id);
    assertEquals(routed.item.queueId, failedQueue.id);
    or.disconnect();
  });

  test("a business-rule failure is terminal even with retries left", async () => {
    const or = await connected();
    const queue = await makeQueue(or, { maxretries: 5, retrydelay: 0 });
    await or.workitems.enqueue(queue.id, { payload: { n: 1 } });
    const claim = await or.workitems.claim(queue.id, { worker: "ada" });
    const done = await or.workitems.complete(claim.item, { error: { message: "duplicate invoice" }, businessRule: true });
    assertEquals(done.state, "failed");
    assertEquals(done.requeued, false);
    assertEquals(done.exhausted, true);
    or.disconnect();
  });

  test("setState, retry, requeue, cancel and delete honour the state machine", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    const enqueued = await or.workitems.enqueue(queue.id, { payload: { n: 1 } });

    const badMove = await or.workitems.setState(enqueued.item, "success");
    assertEquals(badMove.error.code, "invalid-transition");

    const success = await or.workitems.setState(enqueued.item, "processing");
    assertEquals(success.item.state, "processing");

    const retried = await or.workitems.retry(success.item);
    assertEquals(retried.item.state, "new");
    assertEquals((await or.workitems.retry(retried.item)).error.code, "already-pending");

    const requeued = await or.workitems.requeue(success.item);
    assertEquals(requeued.item.state, "new");
    assertEquals(requeued.item.retries, 0);

    const cancelled = await or.workitems.cancel(enqueued.item);
    assertEquals(cancelled.item.state, "abandoned");
    assertEquals((await or.workitems.cancel(cancelled.item)).error.code, "invalid-transition");

    const deleted = await or.workitems.deleteItem(enqueued.item.id);
    assertEquals(deleted.deleted, 1);
    assertEquals((await or.workitems.get(enqueued.item.id)).item, null);
    assertEquals((await or.workitems.deleteMany([])).error.code, "empty-batch");
    or.disconnect();
  });

  test("updateItem edits payload, priority, retries and error detail", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    const enqueued = await or.workitems.enqueue(queue.id, { payload: { n: 1 } });
    const updated = await or.workitems.updateItem(enqueued.item, { payload: { n: 2 }, priority: "high", retries: 3, errormessage: "manual", errortype: "Manual" });
    assert(updated.ok, JSON.stringify(updated));
    assertEquals(updated.item.payload.n, 2);
    assertEquals(updated.item.priority, "high");
    assertEquals(updated.item.retries, 3);
    assertEquals(updated.item.error.message, "manual");
    assertEquals((await or.workitems.updateItem(enqueued.item, { priority: "bogus" })).error.code, "invalid-priority");
    assertEquals((await or.workitems.updateItem(enqueued.item, { payload: "{bad" })).error.code, "invalid-json");
    or.disconnect();
  });

  test("the board groups, filters, searches and pages", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    for (let index = 0; index < 5; index += 1) {
      await or.workitems.enqueue(queue.id, { payload: { tag: index === 2 ? "needle" : `item-${index}` }, priority: index % 2 === 0 ? "high" : "low" });
    }
    await or.workitems.claim(queue.id, { worker: "ada" });

    const all = await or.workitems.board({ queueId: queue.id, page: 1, pageSize: 3 });
    assert(all.ok, JSON.stringify(all));
    assertEquals(all.total, 5);
    assertEquals(all.items.length, 3);
    assertEquals(all.pageCount, 2);
    assertEquals(all.hasNext, true);
    assertEquals(all.counts.new + all.counts.processing, 5);

    const processing = await or.workitems.board({ queueId: queue.id, state: "processing" });
    assertEquals(processing.total, 1);

    const high = await or.workitems.board({ queueId: queue.id, priority: "high" });
    assertEquals(high.total, 3);

    const searched = await or.workitems.board({ queueId: queue.id, search: "needle" });
    assertEquals(searched.total, 1);
    assertEquals(searched.items[0].payload.tag, "needle");

    const secondPage = await or.workitems.board({ queueId: queue.id, page: 2, pageSize: 3 });
    assertEquals(secondPage.items.length, 2);
    assertEquals(secondPage.hasPrev, true);
    const beyond = await or.workitems.board({ queueId: queue.id, page: 99, pageSize: 3 });
    assertEquals(beyond.page, 2);
    or.disconnect();
  });
});

suite("OpenRPA file storage", () => {
  test("upload stores metadata plus content and lists it", async () => {
    const or = await connected();
    const uploaded = await or.files.upload({ filename: "notes.txt", content: "hello world" });
    assert(uploaded.ok, JSON.stringify(uploaded));
    assertEquals(uploaded.file.filename, "notes.txt");
    assertEquals(uploaded.file.contentType, "text/plain");
    assertEquals(uploaded.file.length, 11);

    const listed = await or.files.list({});
    assert(listed.ok);
    assert(listed.files.some((file) => file.id === uploaded.file.id));
    const searched = await or.files.list({ search: "notes" });
    assertEquals(searched.files.length, 1);

    const fetched = await or.files.get(uploaded.file.id);
    assertEquals(fetched.content, "hello world");

    const verified = await or.files.verify(uploaded.file.id);
    assertEquals(verified.valid, true);

    const dataUrl = await or.files.dataUrl(uploaded.file.id);
    assert(dataUrl.url.startsWith("data:text/plain;base64,"));
    or.disconnect();
  });

  test("upload validates its inputs and enforces the size limit", async () => {
    const or = await connected();
    assertEquals((await or.files.upload({ content: "x" })).error.code, "missing-filename");
    assertEquals((await or.files.upload({ filename: "x.txt" })).error.code, "missing-content");
    assertEquals((await or.files.upload(null)).error.code, "invalid-file");
    assertEquals((await or.files.upload({ filename: "big.bin", content: "x".repeat(OPENRPA_FILE_LIMIT + 1) })).error.code, "file-too-big");
    assertEquals((await or.files.get("file_missing")).error.kind, "not-found");
    assertEquals((await or.files.remove("")).error.code, "missing-id");
    or.disconnect();
  });

  test("base64 content reports its decoded size", async () => {
    const or = await connected();
    const uploaded = await or.files.upload({ filename: "blob.bin", content: "aGVsbG8=", encoding: "base64" });
    assertEquals(uploaded.file.length, 5);
    assertEquals(uploaded.file.encoding, "base64");
    assertEquals((await or.files.dataUrl(uploaded.file.id)).url, "data:application/octet-stream;base64,aGVsbG8=");
    or.disconnect();
  });

  test("files attach to and detach from a work item", async () => {
    const or = await connected();
    const queue = await makeQueue(or);
    const enqueued = await or.workitems.enqueue(queue.id, { payload: { n: 1 } });

    const attached = await or.files.attachToWorkItem(enqueued.item.id, { filename: "proof.txt", content: "evidence" });
    assert(attached.ok, JSON.stringify(attached));
    assertEquals(attached.attachments, 1);

    const item = await or.workitems.get(enqueued.item.id);
    assertEquals(item.item.files.length, 1);
    assertEquals(item.item.files[0].filename, "proof.txt");

    const detached = await or.files.detachFromWorkItem(enqueued.item.id, attached.file.id);
    assertEquals(detached.removed, 1);
    assertEquals((await or.workitems.get(enqueued.item.id)).item.files.length, 0);

    assertEquals((await or.files.attachToWorkItem("wi_missing", { filename: "a", content: "b" })).error.code, "item-not-found");
    or.disconnect();
  });

  test("file counters reset", async () => {
    const or = await connected();
    await or.files.upload({ filename: "a.txt", content: "a" });
    assert(or.files.stats().uploads > 0);
    or.files.reset();
    assertEquals(or.files.stats().uploads, 0);
    or.disconnect();
  });

  test("the emulator stores metadata and content the caller supplies", async () => {
    const or = await connected();
    const stored = await or.request("uploadfile", { filename: "a.bin", content: "abcd", encoding: "utf8", length: 99, checksum: "sum-1" });
    assertEquals(stored.length, 99);
    assertEquals(stored.checksum, "sum-1");
    const roundTrip = await or.request("getfile", { id: stored._id });
    assertEquals(roundTrip.content, "abcd");
    or.disconnect();
  });
});

suite("OpenRPA work hub integration", () => {
  test("the ready hub exposes the work-item and file services", async () => {
    const hub = await createHub({ kv: null }).ready();
    assert(hub.openrpa.workitems, "hub.openrpa.workitems should exist");
    assert(hub.openrpa.files, "hub.openrpa.files should exist");
    const queues = await hub.openrpa.workitems.listQueues();
    assert(queues.ok && queues.queues.length >= 3);
    const files = await hub.openrpa.files.list({});
    assert(files.ok);
    assertEquals(hub.registry.validate().counts.error, 0);
    const status = hub.openrpa.status();
    assert(status.workitems && status.files, "status should report work-item and file counters");
  });

  test("working a queue through the hub leaves the canonical directory untouched", async () => {
    const hub = await createHub({ kv: null }).ready();
    const before = hub.identity.stats().total;
    const queue = await hub.openrpa.workitems.createQueue({ name: "hub-queue", maxretries: 1, retrydelay: 0 });
    assert(queue.ok);
    const enqueued = await hub.openrpa.workitems.enqueue(queue.queue.id, { payload: { n: 1 } });
    const claim = await hub.openrpa.workitems.claim(queue.queue.id, { worker: "ada" });
    assert(claim.claimed);
    const done = await hub.openrpa.workitems.complete(claim.item, { error: { message: "boom" } });
    assertEquals(done.state, "new");
    assertEquals(hub.identity.stats().total, before);
    assertEquals(hub.registry.validate().counts.error, 0);
  });

  test("resetting the hub clears work-item and file counters", async () => {
    const hub = await createHub({ kv: null }).ready();
    await hub.openrpa.connect({ announce: false });
    await hub.openrpa.workitems.enqueue("qi_backup", { payload: { n: 1 } });
    await hub.openrpa.files.upload({ filename: "a.txt", content: "a" });
    assert(hub.openrpa.workitems.stats().enqueued > 0);
    assert(hub.openrpa.files.stats().uploads > 0);
    await hub.resetData();
    assertEquals(hub.openrpa.workitems.stats().enqueued, 0);
    assertEquals(hub.openrpa.files.stats().uploads, 0);
  });
});
