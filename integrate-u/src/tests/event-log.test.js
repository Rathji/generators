import { suite, test, assert, assertEquals } from "./harness.js";
import { createDb } from "../core/db.js";
import { createEventLog } from "../core/event-log.js";

function makeEvent(seq, type = "audit.note", source = "iu") {
  return {
    id: `ev_log${String(seq).padStart(2, "0")}`,
    type,
    version: 1,
    source,
    time: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    seq,
    payload: { message: `event ${seq}` },
  };
}

function makeLog(options = {}) {
  const db = createDb({ kv: null, namespace: "test-log", collections: ["events", "checkpoints"] });
  return createEventLog({ db, ...options });
}

suite("Event log", () => {
  test("appends events and reports the sequence", async () => {
    const log = makeLog();
    for (let i = 1; i <= 4; i++) await log.append(makeEvent(i));
    assertEquals(log.size(), 4);
    assertEquals(log.lastSeq(), 4);
    assertEquals(log.get("ev_log03").seq, 3);
  });

  test("ignores duplicate event ids", async () => {
    const log = makeLog();
    await log.append(makeEvent(1));
    await log.append(makeEvent(1));
    assertEquals(log.size(), 1);
  });

  test("recent, since and range slice the log", async () => {
    const log = makeLog();
    for (let i = 1; i <= 6; i++) await log.append(makeEvent(i));
    assertEquals(log.recent(2).map((e) => e.seq), [5, 6]);
    assertEquals(log.since(4).map((e) => e.seq), [5, 6]);
    assertEquals(log.since(4, { inclusive: true }).map((e) => e.seq), [4, 5, 6]);
    assertEquals(log.range(2, 4).map((e) => e.seq), [2, 3, 4]);
  });

  test("filters by type, topic and source", async () => {
    const log = makeLog();
    await log.append(makeEvent(1, "device.offline", "rmm-u"));
    await log.append(makeEvent(2, "device.checkin", "rmm-u"));
    await log.append(makeEvent(3, "ticket.opened", "psa-u"));
    assertEquals(log.byType("device.checkin").length, 1);
    assertEquals(log.byTopic("device.*").length, 2);
    assertEquals(log.bySource("rmm-u").length, 2);
    assertEquals(log.stats().bySource["rmm-u"], 2);
  });

  test("prunes the oldest events beyond the limit", async () => {
    const log = makeLog({ limit: 3 });
    for (let i = 1; i <= 5; i++) await log.append(makeEvent(i));
    assertEquals(log.size(), 3);
    assertEquals(log.all().map((e) => e.seq), [3, 4, 5]);
    assertEquals(log.stats().dropped, 2);
  });

  test("checkpoints let a connector recover only what it missed", async () => {
    const log = makeLog();
    for (let i = 1; i <= 3; i++) await log.append(makeEvent(i));
    await log.saveCheckpoint("psa-u", 3);
    for (let i = 4; i <= 5; i++) await log.append(makeEvent(i));
    const recovery = log.recover("psa-u");
    assertEquals(recovery.from, 3);
    assertEquals(recovery.replayed, 2);
    assertEquals(recovery.events.map((e) => e.seq), [4, 5]);
  });

  test("a connector with no checkpoint replays the whole log", async () => {
    const log = makeLog();
    for (let i = 1; i <= 3; i++) await log.append(makeEvent(i));
    const recovery = log.recover("newcomer");
    assertEquals(recovery.from, 0);
    assertEquals(recovery.replayed, 3);
  });

  test("replay walks the log in order", async () => {
    const log = makeLog();
    for (let i = 1; i <= 4; i++) await log.append(makeEvent(i));
    const seen = [];
    const handled = log.replay((e) => seen.push(e.seq), { since: 2 });
    assertEquals(handled, 2);
    assertEquals(seen, [3, 4]);
  });

  test("clear empties the log and its checkpoints", async () => {
    const log = makeLog();
    for (let i = 1; i <= 3; i++) await log.append(makeEvent(i));
    await log.saveCheckpoint("psa-u", 2);
    await log.clear();
    assertEquals(log.size(), 0);
    assertEquals(log.checkpointOf("psa-u"), null);
  });
});
