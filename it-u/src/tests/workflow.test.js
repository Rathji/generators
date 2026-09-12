// src/tests/workflow.test.js — validation tests for roadmap task 27
// ("Expiry workflow & notification engine"). Run in the live page:
//   await import("./src/tests/workflow.test.js").then((m) => m.run())
//
// Covers: the workflow config (per-kind lead-time overrides + the escalation
// rule, with unknown/negative values rejected); the workflow state shape; the
// action log (bounded, ordered); owner assignment and clearing; snoozing
// (days / ISO / timestamp) and its effect on the queues; recording an action
// (renewed resolves an item and clears a snooze, escalated stamps it, an
// unknown action is refused); escalation of long-overdue items (never within
// the grace window, never once snoozed or resolved); the DUE-SOON / OVERDUE /
// unassigned / escalated queues; the exportable renewal schedule and its CSV;
// and the whole thing persisted on the documentation set through the docs
// service.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { extractLifecycleItems, lifecycleKind } from "../framework/lifecycle.js";
import {
  DEFAULT_LIFECYCLE_CONFIG,
  LIFECYCLE_ACTIONS,
  lifecycleActionDef,
  normalizeLifecycleConfig,
  normalizeWorkflowState,
  makeAction,
  appendAction,
  assignOwner,
  snoozeItem,
  recordItemAction,
  lastActionFor,
  isSnoozed,
  escalationFor,
  enrichItems,
  buildWorkflow,
  renewalScheduleRows,
  scheduleToCsv,
  workflowSummary,
} from "../framework/workflow.js";

const C = { informationModel: "core-asset", provenance: "authored" };
const NOW = new Date(2026, 5, 15).getTime(); // 15 June 2026

// Four items: one long-overdue, one soon, one healthy, one certificate soon.
function sampleSet() {
  return {
    records: {
      domains: [
        { id: "d1", type: "domains", name: "overdue.com", expiresAt: "2026-05-01" },
        { id: "d2", type: "domains", name: "soon.com", expiresAt: "2026-06-20" },
        { id: "d3", type: "domains", name: "ok.com", expiresAt: "2027-01-01" },
      ],
      certificates: [{ id: "c1", type: "certificates", name: "cert.example.com", validTo: "2026-06-18" }],
    },
  };
}
const sampleItems = () => extractLifecycleItems(sampleSet(), { now: NOW });
const emptyState = (config) => normalizeWorkflowState({ config });

function state() {
  return emptyState(null);
}

const tests = [
  ["the workflow config normalizes, keeping only real per-kind overrides", () => {
    const c = normalizeLifecycleConfig({ leadDays: { "certificate-expiry": 90, bogus: 10, "domain-expiry": -5 }, dueSoonDays: { "domain-expiry": 7 }, escalation: { afterDays: 21, to: "Help desk" } });
    assertEq(c.leadDays["certificate-expiry"], 90, "a real override is kept");
    assertEq(c.leadDays.bogus, undefined, "an unknown kind is dropped");
    assertEq(c.leadDays["domain-expiry"], undefined, "a negative override is dropped");
    assertEq(c.dueSoonDays["domain-expiry"], 7, "due-soon override kept");
    assertEq(c.escalation.afterDays, 21);
    assertEq(c.escalation.to, "Help desk");
    const d = normalizeLifecycleConfig(null);
    assertEq(d.escalation.afterDays, DEFAULT_LIFECYCLE_CONFIG.escalation.afterDays, "defaults apply");
    assertEq(Object.keys(d.leadDays).length, 0);
  }],

  ["workflow state normalizes to config + assignments + actions", () => {
    const s = normalizeWorkflowState({ config: { leadDays: { "domain-expiry": 10 } }, assignments: { "x:y:z:w": { owner: "Bob" } }, actions: [{ itemId: "a", action: "noted" }, { junk: true }] });
    assertEq(s.config.leadDays["domain-expiry"], 10);
    assertEq(s.assignments["x:y:z:w"].owner, "Bob");
    assertEq(s.actions.length, 1, "malformed log entries are dropped");
    assertEq(normalizeWorkflowState(undefined).actions.length, 0);
  }],

  ["the action catalog names real actions", () => {
    assert(LIFECYCLE_ACTIONS.length >= 6, "action catalog");
    assertEq(lifecycleActionDef("renewed").resolves, true);
    assertEq(lifecycleActionDef("nope"), null);
  }],

  ["the action log appends in order", () => {
    let s = state();
    s = appendAction(s, makeAction({ itemId: "i1", action: "noted", note: "first", now: 1000 }));
    s = appendAction(s, makeAction({ itemId: "i1", action: "renewed", note: "second", now: 2000 }));
    assertEq(s.actions.length, 2);
    assertEq(lastActionFor(s, "i1").action, "renewed", "the last action wins");
    assertEq(lastActionFor(s, "i2"), null, "no action for an untouched item");
  }],

  ["assigning an owner records the action; clearing removes it", () => {
    const r1 = assignOwner(state(), "i1", "Bob", { by: "me", now: 1000 });
    assertEq(r1.state.assignments.i1.owner, "Bob");
    assertEq(r1.action.action, "assigned");
    assertEq(r1.state.actions.length, 1);
    const r2 = assignOwner(r1.state, "i1", "", { by: "me", now: 2000 });
    assertEq(r2.assignment, null, "clearing returns no assignment");
    assertEq(r2.state.assignments.i1, undefined, "the assignment is gone");
    assertEq(r2.state.actions.length, 2, "the clearing is still logged");
    assertEq(r2.state.actions[1].action, "unassigned");
  }],

  ["snoozing accepts days, an ISO date or a timestamp", () => {
    const byDays = snoozeItem(state(), "i1", 10, { now: NOW });
    assertEq(byDays.assignment.snoozedUntil, NOW + 10 * 86400000);
    assert(isSnoozed(byDays.assignment, NOW), "snoozed now");
    assert(!isSnoozed(byDays.assignment, NOW + 11 * 86400000), "not snoozed once it lapses");
    const byIso = snoozeItem(state(), "i1", "2026-07-01", { now: NOW });
    assert(isSnoozed(byIso.assignment, NOW));
    const byTs = snoozeItem(state(), "i1", NOW + 1000, { now: NOW });
    assert(isSnoozed(byTs.assignment, NOW));
    const cleared = snoozeItem(byDays.state, "i1", 0, { now: NOW });
    assert(!isSnoozed(cleared.assignment, NOW), "a falsy value clears the snooze");
    assertEq(cleared.action.action, "unsnoozed");
  }],

  ["renewing resolves an item and clears its snooze", () => {
    const s = snoozeItem(assignOwner(state(), "i1", "Bob", { now: NOW }).state, "i1", 30, { now: NOW }).state;
    assert(isSnoozed(s.assignments.i1, NOW));
    const r = recordItemAction(s, "i1", "renewed", { by: "me", note: "paid", now: NOW });
    assertEq(r.action.action, "renewed");
    assertEq(r.state.assignments.i1.snoozedUntil, undefined, "snooze cleared on resolve");
    assertEq(r.state.assignments.i1.owner, "Bob", "owner is kept");
    let threw = false;
    try {
      recordItemAction(s, "i1", "teleported");
    } catch (e) {
      threw = /Unknown lifecycle action/.test(e.message);
    }
    assert(threw, "an unknown action is refused");
  }],

  ["overdue items escalate once past the grace window", () => {
    const items = sampleItems();
    const overdue = items.find((i) => i.sourceName === "overdue.com");
    const soon = items.find((i) => i.sourceName === "soon.com");
    // default grace is 14 days; overdue.com is 45 days overdue
    assert(escalationFor(overdue, state(), NOW), "a long-overdue item escalates");
    assertEq(escalationFor(soon, state(), NOW), null, "a due-soon item does not");
    // a generous grace window suppresses escalation
    const generous = emptyState(normalizeLifecycleConfig({ escalation: { afterDays: 90 } }));
    assertEq(escalationFor(overdue, generous, NOW), null, "within grace");
    // snoozing suppresses it
    const snoozed = snoozeItem(state(), overdue.id, 30, { now: NOW }).state;
    assertEq(escalationFor(overdue, snoozed, NOW), null, "snoozed");
    // resolving suppresses it
    const resolved = recordItemAction(state(), overdue.id, "renewed", { now: NOW }).state;
    assertEq(escalationFor(overdue, resolved, NOW), null, "resolved");
    // the escalation names the recipient
    const cfg = emptyState(normalizeLifecycleConfig({ escalation: { afterDays: 14, to: "Help desk" } }));
    assertEq(escalationFor(overdue, cfg, NOW).to, "Help desk");
  }],

  ["the workflow builds the due-soon / overdue / unassigned / escalated queues", () => {
    const items = sampleItems();
    const wf = buildWorkflow(items, state(), { now: NOW });
    assertEq(wf.queues.overdue.length, 1, "one overdue");
    assertEq(wf.queues.dueSoon.length, 2, "two due soon");
    assertEq(wf.queues.upcoming.length, 0);
    assertEq(wf.counts.unassigned, 3, "attention items with no owner");
    assertEq(wf.counts.escalated, 1, "the long-overdue item escalates");
    assertEq(wf.counts.attention, 3);
    assertEq(wf.counts.tracked, 4);
    // assigning and resolving change the picture
    let s = assignOwner(state(), items[0].id, "Bob", { now: NOW }).state;
    s = recordItemAction(s, items.find((i) => i.sourceName === "overdue.com").id, "renewed", { now: NOW }).state;
    const wf2 = buildWorkflow(items, s, { now: NOW });
    assertEq(wf2.counts.escalated, 0, "resolved items no longer escalate");
    assertEq(wf2.counts.unassigned, 2, "the assigned item drops out of unassigned");
    assertEq(wf2.queues.resolved.length, 1);
  }],

  ["snoozed items leave the active queues but stay listed", () => {
    const items = sampleItems();
    const soon = items.find((i) => i.sourceName === "soon.com");
    const s = snoozeItem(state(), soon.id, 30, { now: NOW }).state;
    const wf = buildWorkflow(items, s, { now: NOW });
    assertEq(wf.queues.dueSoon.length, 1, "the snoozed item left the due-soon queue");
    assertEq(wf.queues.snoozed.length, 1, "but it is still listed as snoozed");
    assertEq(wf.counts.dueSoon, 1);
  }],

  ["the renewal schedule exports one row per dated item", () => {
    const items = sampleItems();
    const s = assignOwner(state(), items.find((i) => i.sourceName === "overdue.com").id, "Bob", { now: NOW }).state;
    const rows = renewalScheduleRows(items, s, { now: NOW });
    assertEq(rows.length, 4, "four dated items");
    const overdue = rows.find((r) => r.asset === "overdue.com");
    assertEq(overdue.kind, "Domain renewal");
    assertEq(overdue.dueDate, "2026-05-01");
    assertEq(overdue.daysUntil, -45);
    assertEq(overdue.status, "Overdue");
    assertEq(overdue.owner, "Bob");
    const csv = scheduleToCsv(rows);
    const lines = csv.split("\n");
    assertEq(lines.length, 5, "header + four rows");
    assert(lines[0].startsWith("Kind,Subject,Asset"), "header row");
    assert(/overdue\.com/.test(lines.find((l) => /overdue\.com/.test(l))), "the overdue row is present");
    // a value with a comma is quoted; the row carries all 13 columns
    assertEq(scheduleToCsv([{ kind: "K", subject: "a,b", asset: "x" }]).split("\n")[1], 'K,"a,b",x' + ",".repeat(10));
  }],

  ["the summary surfaces the next date", () => {
    const sum = workflowSummary(sampleItems(), state(), { now: NOW });
    assertEq(sum.counts.overdue, 1);
    assertEq(sum.next.sourceName, "overdue.com", "the soonest item is the most overdue");
  }],

  ["the docs service persists the whole workflow on the set", async () => {
    const { docs } = await makeWorld("kb-workflow-svc");
    const created = await docs.create({ name: "Acme", createdBy: "tester" });
    const id = created.id;
    const add = (type, input) => docs.addRecord(id, { type, ...C, ...input }, { updatedBy: "tester" });
    await add("domains", { name: "overdue.com", expiresAt: "2026-05-01" });
    await add("domains", { name: "soon.com", expiresAt: "2026-06-20" });
    await add("certificates", { name: "cert.example.com", validTo: "2026-06-18" });

    // configure per-kind lead time + escalation
    const cfg = await docs.configureLifecycle(id, { leadDays: { "certificate-expiry": 90 }, escalation: { afterDays: 7, to: "Help desk" } }, { updatedBy: "tester" });
    assertEq(cfg.config.leadDays["certificate-expiry"], 90);
    assertEq((await docs.lifecycleConfig(id)).escalation.to, "Help desk", "config persisted");

    const agg = await docs.lifecycle(id, { now: NOW });
    assertEq(agg.counts.total, 3);

    const wf = await docs.lifecycleWorkflow(id, { now: NOW });
    assertEq(wf.counts.overdue, 1);
    assertEq(wf.counts.escalated, 1, "overdue by 45 days, grace 7");
    assertEq(wf.queues.escalated[0].sourceName, "overdue.com");
    const target = wf.items.find((i) => i.sourceName === "overdue.com");

    // assign, snooze, then renew
    const assigned = await docs.assignLifecycle(id, target.id, "Bob", { updatedBy: "tester" });
    assertEq(assigned.assignment.owner, "Bob");
    const snoozed = await docs.snoozeLifecycle(id, target.id, 10, { updatedBy: "tester" });
    assert(snoozed.assignment.snoozedUntil, "snooze set");
    const renewed = await docs.recordLifecycleAction(id, target.id, "renewed", { updatedBy: "tester", note: "paid" });
    assertEq(renewed.action.action, "renewed");

    const after = await docs.lifecycleWorkflow(id, { now: NOW });
    const item = after.items.find((i) => i.id === target.id);
    assertEq(item.owner, "Bob", "owner survives");
    assertEq(after.counts.escalated, 0, "renewal cleared the escalation");
    assertEq(item.snoozed, false, "renewal cleared the snooze");
    assertEq(after.actions.length, 3, "assign + snooze + renew = 3 actions");

    const sched = await docs.renewalSchedule(id, { now: NOW });
    assertEq(sched.rows.length, 3);
    assert(/Kind,Subject,Asset/.test(sched.csv));
    assert(/overdue\.com/.test(sched.csv));
  }],
];

export async function run() {
  return runTests(tests.map(([name, fn]) => ({ name, fn })));
}
