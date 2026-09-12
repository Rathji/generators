// src/tests/checklist.test.js — validation tests for Phase 2 task 11
// (checklists). Run in the live page:
//   await import("./src/tests/checklist.test.js").then((m) => m.run())
//
// Covers: the step shape and progress roll-up; the ordered step API (add,
// update, toggle, remove, move); validation (blank step text / duplicate ids
// refused, empty checklist allowed); the display line and the shareable text /
// CSV renderings; the integrity audit (empty checklist = warning, malformed
// step = error); cloning a checklist into another client's set (fresh ids,
// progress reset, de-duplicated name); and the checklist relationship kinds.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  makeChecklistItem,
  checklistItems,
  checklistProgress,
  checklistAssignees,
  checklistOutstandingAssignees,
  checklistDetailLine,
  formatChecklistText,
  checklistCsvRows,
  validateChecklist,
  checklistIssues,
} from "../framework/checklist.js";
import { validateRecordFields, standardizedIssues, STANDARDIZED_TYPES, recordDetailLine } from "../framework/standardized.js";
import { relationshipKind } from "../framework/relationships.js";

const CL = { informationModel: "document", provenance: "authored" };

async function withChecklist(items = []) {
  const world = makeWorld({ namespace: "kb-checklists" });
  const set = await world.docs.create({ name: "Acme" });
  const rec = (await world.docs.addRecord(set.id, { type: "checklists", name: "Onboarding", items, ...CL })).record;
  return { ...world, set, rec };
}

export async function run() {
  return runTests([
    {
      name: "a checklist step carries text, completion, delegation, a due date and the who/when it was ticked",
      fn: () => {
        const step = makeChecklistItem({ text: "  Install RMM agent  ", assignee: " Sam ", dueDate: "2026-01-05", notes: "Site access first" }, 1000);
        assertEq(step.text, "Install RMM agent", "text is trimmed");
        assertEq(step.assignee, "Sam", "assignee trimmed");
        assertEq(step.done, false, "starts open");
        assertEq(step.doneAt, null, "no completion time while open");
        assert(step.id, "every step gets an id");
        const done = makeChecklistItem({ text: "x", done: true, doneBy: "owner" }, 2000);
        assertEq(done.doneAt, 2000, "a done step records when");
        assertEq(done.doneBy, "owner", "a done step records who");
        assertEq(checklistItems({ items: [step, done] }).length, 2, "items read back");
        assertEq(checklistItems({}).length, 0, "a missing items array reads as empty");
      },
    },
    {
      name: "progress rolls up total / done / remaining / percent / complete",
      fn: () => {
        const items = [makeChecklistItem({ text: "a", done: true }), makeChecklistItem({ text: "b" }), makeChecklistItem({ text: "c", done: true }), makeChecklistItem({ text: "d" })];
        const p = checklistProgress(items);
        assertEq(p.total, 4, "total");
        assertEq(p.done, 2, "done");
        assertEq(p.remaining, 2, "remaining");
        assertEq(p.percent, 50, "percent");
        assertEq(p.complete, false, "not complete");
        const empty = checklistProgress({ items: [] });
        assertEq(empty.total, 0, "empty total");
        assertEq(empty.complete, false, "an empty checklist is not 'complete'");
        assertEq(empty.empty, true, "empty flag");
        assertEq(checklistProgress({ items: [makeChecklistItem({ text: "a", done: true })] }).complete, true, "all done is complete");
      },
    },
    {
      name: "the ordered step API adds, edits, ticks, reorders and removes steps; save refuses blank text",
      fn: async () => {
        const { docs, set, rec } = await withChecklist();
        const a = (await docs.addChecklistItem(set.id, { type: "checklists", id: rec.id }, { text: "Step A", assignee: "Sam" })).item;
        const b = (await docs.addChecklistItem(set.id, { type: "checklists", id: rec.id }, { text: "Step B" })).item;
        const c = (await docs.addChecklistItem(set.id, { type: "checklists", id: rec.id }, { text: "Step C" })).item;
        assertEq((await docs.get(set.id)).records.checklists[0].items.length, 3, "three steps");

        let live = await docs.get(set.id, { force: true });
        assertEq(checklistItems(live.records.checklists[0]).map((s) => s.text).join(","), "Step A,Step B,Step C", "insertion order");

        await docs.moveChecklistItem(set.id, { type: "checklists", id: rec.id }, c.id, 0);
        live = await docs.get(set.id, { force: true });
        assertEq(checklistItems(live.records.checklists[0])[0].id, c.id, "step C moved first");

        const toggled = await docs.toggleChecklistItem(set.id, { type: "checklists", id: rec.id }, a.id, true, { updatedBy: "owner" });
        assertEq(toggled.item.done, true, "ticked");
        assertEq(toggled.item.doneBy, "owner", "records the ticker");
        assert(toggled.item.doneAt, "records the time");
        const flipped = await docs.toggleChecklistItem(set.id, { type: "checklists", id: rec.id }, a.id);
        assertEq(flipped.item.done, false, "toggle with no argument flips");
        assertEq(flipped.item.doneAt, null, "flipping back clears the time");

        await docs.updateChecklistItem(set.id, { type: "checklists", id: rec.id }, b.id, { text: "Step B (revised)", dueDate: "2026-02-01" });
        live = await docs.get(set.id, { force: true });
        const edited = checklistItems(live.records.checklists[0]).find((s) => s.id === b.id);
        assertEq(edited.text, "Step B (revised)", "edited text");
        assertEq(edited.dueDate, "2026-02-01", "edited due date");

        let threw = null;
        try {
          await docs.addChecklistItem(set.id, { type: "checklists", id: rec.id }, { text: "   " });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "a blank step is refused");

        await docs.removeChecklistItem(set.id, { type: "checklists", id: rec.id }, c.id);
        live = await docs.get(set.id, { force: true });
        assertEq(checklistItems(live.records.checklists[0]).length, 2, "removed");
      },
    },
    {
      name: "a checklist must be an array of non-blank, uniquely-identified steps (validation + refused save)",
      fn: async () => {
        assert(!validateChecklist({ items: "nope" }).ok, "a non-array items field is refused");
        assert(!validateChecklist({ items: [{ text: "" }] }).ok, "a blank step is refused");
        assert(!validateChecklist({ items: [{ id: "x", text: "a" }, { id: "x", text: "b" }] }).ok, "duplicate ids are refused");
        assert(validateChecklist({ name: "Empty", items: [] }).ok, "an empty checklist is valid (steps added later)");
        assert(validateRecordFields("checklists", { name: "Empty", items: [] }).ok, "the combined registry validates checklists");
        assert(STANDARDIZED_TYPES.includes("checklists"), "checklists are a standardized (detail-line) type");

        const { docs } = makeWorld({ namespace: "kb-checklists" });
        const set = await docs.create({ name: "Acme" });
        let threw = null;
        try {
          await docs.addRecord(set.id, { type: "checklists", name: "Bad", items: [{ text: "" }], ...CL });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "the docs service refuses a malformed checklist");
      },
    },
    {
      name: "the display line, shareable text and CSV report progress, delegation and completion",
      fn: async () => {
        const { set, rec } = await withChecklist([
          makeChecklistItem({ text: "Order circuit", assignee: "Jen", dueDate: "2026-03-01", done: true, doneBy: "owner", doneAt: 5000 }),
          makeChecklistItem({ text: "Configure firewall", assignee: "Sam" }),
        ]);
        const line = checklistDetailLine(rec);
        assert(line.includes("1 of 2 complete"), "detail line reports progress");
        assert(line.includes("Sam"), "detail line names the outstanding assignee");
        assertEq(recordDetailLine(rec, set), line, "the registry dispatches checklist detail lines");
        assertEq(checklistAssignees(rec).join(","), "Jen,Sam", "assignees union in first-seen order");
        assertEq(checklistOutstandingAssignees(rec).join(","), "Sam", "outstanding assignees only");

        const text = formatChecklistText(rec, set);
        assert(text.includes("# Onboarding"), "text has a heading");
        assert(text.includes("Client: Acme"), "text names the client");
        assert(text.includes("- [x] Order circuit"), "done step ticked");
        assert(text.includes("- [ ] Configure firewall"), "open step unticked");
        assert(text.includes("@Sam"), "assignee shown");

        const rows = checklistCsvRows(rec);
        assertEq(rows[0][0], "Step", "csv header");
        assertEq(rows[1][1], "yes", "csv done column");
        assertEq(rows[2][1], "no", "csv open column");
      },
    },
    {
      name: "the integrity audit flags an empty checklist as a warning and a malformed step as an error",
      fn: async () => {
        const { docs, set } = await withChecklist([makeChecklistItem({ text: "One" })]);
        const issues = standardizedIssues(await docs.get(set.id));
        assert(!issues.some((i) => i.code === "empty-checklist"), "a non-empty checklist is not flagged");

        await docs.addRecord(set.id, { type: "checklists", name: "Blank", items: [], ...CL });
        const afterEmpty = await docs.integrity(set.id);
        assert(afterEmpty.issues.some((i) => i.code === "empty-checklist" && i.level === "warning"), "empty checklist is a warning");
        assert(afterEmpty.ok, "a warning does not fail the graph audit");

        const live = await docs.get(set.id, { force: true });
        live.records.checklists.find((r) => r.name === "Blank").items = [{ id: "x", text: "ok" }, { id: "x", text: "dupe" }];
        const bad = checklistIssues(live);
        assert(bad.some((i) => i.code === "invalid-checklist" && i.level === "error"), "malformed step is an error");
        assert(!(await docs.integrity(set.id)).ok, "an error fails the set's integrity audit");
      },
    },
    {
      name: "a checklist can be reused on another client: fresh step ids, progress reset, name de-duplicated",
      fn: async () => {
        const { docs, set, rec } = await withChecklist([
          makeChecklistItem({ text: "Book site visit", assignee: "Jen", done: true, doneBy: "owner" }),
          makeChecklistItem({ text: "Photograph rack" }),
        ]);
        const other = await docs.create({ name: "Beta Corp" });
        const res = await docs.cloneChecklist(set.id, { type: "checklists", id: rec.id }, other.id, { updatedBy: "owner" });
        assertEq(res.itemCount, 2, "both steps copied");
        assertEq(res.record.items.every((s) => !s.done), true, "progress reset by default");
        assert(res.record.items.every((s) => s.id && s.id !== rec.items[0].id), "fresh step ids");
        assert(res.record.items[0].id !== res.record.items[1].id, "distinct ids");
        assertEq(res.record.informationModel, "document", "classification carried over");
        const target = await docs.get(other.id, { force: true });
        assertEq(target.records.checklists.length, 1, "copied into the target set");
        const source = await docs.get(set.id, { force: true });
        assertEq(source.records.checklists[0].items[0].done, true, "the source checklist is untouched");

        const again = await docs.cloneChecklist(set.id, { type: "checklists", id: rec.id }, other.id, { updatedBy: "owner" });
        assert(again.record.name.includes("(copy 2)"), "a same-name copy is de-duplicated: " + again.record.name);
        const keep = await docs.cloneChecklist(set.id, { type: "checklists", id: rec.id }, other.id, { updatedBy: "owner", resetProgress: false });
        assertEq(keep.record.items[0].done, true, "resetProgress false keeps the ticks");
      },
    },
    {
      name: "checklists participate in the link graph (attached to a site, referring to configurations)",
      fn: async () => {
        const { docs, set } = await withChecklist([makeChecklistItem({ text: "One" })]);
        const site = (await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", informationModel: "core-asset", provenance: "authored" })).record;
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "fw-01", configType: "firewall", informationModel: "core-asset", provenance: "authored" })).record;
        const cl = (await docs.get(set.id)).records.checklists[0];
        await docs.linkRecords(set.id, { from: { type: "locations", id: site.id }, to: { type: "checklists", id: cl.id }, kind: "location-checklist" });
        await docs.linkRecords(set.id, { from: { type: "checklists", id: cl.id }, to: { type: "configurations", id: cfg.id }, kind: "checklist-configuration" });
        assertEq((await docs.relations(set.id, { type: "checklists", id: cl.id })).length, 2, "the checklist sees both links");
        assert(relationshipKind("organization-checklist"), "organization → checklist kind exists");
        assert(relationshipKind("asset-reference"), "the generic flexible-asset reference kind exists");

        let threw = null;
        try {
          await docs.linkRecords(set.id, { from: { type: "configurations", id: cfg.id }, to: { type: "checklists", id: cl.id }, kind: "location-checklist" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "a wrong-direction checklist link is refused");
        assert((await docs.integrity(set.id)).ok, "the checklist graph is consistent");
      },
    },
  ]);
}
