import { suite, test, assert, assertEquals } from "./harness.js";
import { EVENT_TYPES, TOPICS, topicMatches, eventType } from "../core/event-catalog.js";
import { validateEnvelope, validatePayload, samplePayload, describePayload } from "../core/event-schema.js";

function envelope(overrides = {}) {
  const type = overrides.type || "ticket.opened";
  return {
    id: "ev_test01",
    type,
    version: 1,
    source: "psa-u",
    time: new Date().toISOString(),
    seq: 1,
    payload: samplePayload(type),
    ...overrides,
  };
}

suite("Event schema", () => {
  test("accepts a well-formed envelope", () => {
    const report = validateEnvelope(envelope());
    assertEquals(report.counts.error, 0);
    assert(report.ok, `expected ok, got ${JSON.stringify(report.issues)}`);
  });

  test("flags missing envelope fields", () => {
    const report = validateEnvelope(envelope({ id: "", type: "", seq: null }));
    assert(!report.ok, "expected the envelope to be rejected");
    const codes = report.issues.map((i) => i.code);
    assert(codes.includes("missing-field"), `expected missing-field, got ${codes.join(", ")}`);
  });

  test("rejects unknown event types", () => {
    const report = validateEnvelope(envelope({ type: "nope.happened" }));
    assert(!report.ok);
    assert(report.issues.some((i) => i.code === "unknown-type"));
  });

  test("warns — but does not fail — on an unknown source", () => {
    const report = validateEnvelope(envelope({ source: "outsider" }));
    assert(report.ok, "an unknown source should be a warning, not an error");
    assert(report.issues.some((i) => i.code === "unknown-source" && i.level === "warn"));
  });

  test("enforces payload types, enums and required fields", () => {
    const report = validateEnvelope({ ...envelope(), payload: { ticketId: "tk_1", companyId: "co_1", priority: "whenever" } });
    assert(!report.ok);
    assert(report.issues.some((i) => i.code === "enum" && i.path.includes("priority")));
    assertEquals(validatePayload("ticket.opened", {}).filter((i) => i.code === "required").length, 3);
  });

  test("enforces numeric bounds, string length and patterns", () => {
    const bounds = validatePayload("invoice.issued", { invoiceId: "iv_1", companyId: "co_1", amount: -5, currency: "dollars" });
    assert(bounds.some((i) => i.code === "min"), "expected a minimum violation");
    assert(bounds.some((i) => i.code === "pattern"), "expected a currency pattern violation");
    const length = validatePayload("audit.note", { message: "x".repeat(600) });
    assert(length.some((i) => i.code === "maxLength"), "expected a length violation");
  });

  test("warns when the envelope version is ahead of the catalog", () => {
    const report = validateEnvelope(envelope({ version: 9 }));
    assert(report.ok, "a version mismatch should not be fatal");
    assert(report.issues.some((i) => i.code === "version-mismatch"));
  });

  test("every catalog event has a sample payload that validates", () => {
    for (const entry of EVENT_TYPES) {
      const report = validateEnvelope(envelope({ type: entry.type, payload: samplePayload(entry.type) }));
      assert(report.ok, `${entry.type} sample failed: ${JSON.stringify(report.issues)}`);
    }
  });

  test("describes payload fields for the composer", () => {
    const fields = describePayload("device.offline");
    assertEquals(fields.map((f) => f.key), ["deviceId", "minutes"]);
    assertEquals(fields.filter((f) => f.required).map((f) => f.key), ["deviceId"]);
    assertEquals(fields.find((f) => f.key === "minutes").type, "number");
  });

  test("topic matching understands wildcards", () => {
    assert(topicMatches("*", "anything.at.all"));
    assert(topicMatches("device.*", "device.offline"));
    assert(!topicMatches("device.*", "identity.upserted"));
    assert(topicMatches("ticket.opened", "ticket.opened"));
    assert(TOPICS.includes("identity") && TOPICS.includes("sync"));
    assertEquals(eventType("connector.health").category, "monitor");
  });
});
