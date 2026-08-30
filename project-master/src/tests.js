// src/tests.js — validation tests for the local-first persistence layer
// (Roadmap Task 1). Run via:  await (await import("./src/tests.js")).runDataLayerTests()
//
// Each test runs against a throwaway kv folder (random name) so it never
// touches the user's real data.

import { Store, SCHEMA_VERSION, ENTITY_TYPES } from "./store.js";
import { fuzzyScore } from "./palette.js";
import { todayLocal, addDays } from "./dates.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runDataLayerTests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_" + Math.random().toString(36).slice(2, 9);
  const log = []; // each entry = array of keys written in one save
  let store = new Store({ kv: root.kv, folder, writeLog: (keys) => log.push([...keys]), debounceMs: 5 });

  try {
    await store.load();
    ok(true, "load on empty folder succeeds, ready=" + store.ready);
    ok(Object.keys(store.settings).length > 0, "default settings present on fresh store");

    // 1. create one record of each entity type
    const created = {};
    for (const t of ENTITY_TYPES) {
      created[t] = store.create(t, { title: "Test " + t, name: "Test " + t });
      ok(created[t] && typeof created[t].id === "string" && created[t].id.length > 0, "create " + t + " assigns an id");
      ok(created[t].v === SCHEMA_VERSION, "create " + t + " is a versioned record (v=" + SCHEMA_VERSION + ")");
      ok(created[t].created > 0 && created[t].updated >= created[t].created, "create " + t + " stamps created/updated timestamps");
    }
    ok(store.count("task") === 1 && store.count("project") === 1, "counts reflect created records");

    // 2. upsert merges fields without losing the rest of the record
    const t1 = created.task;
    const before = store.get("task", t1.id);
    const updated = store.upsert("task", t1.id, { status: "Doing", priority: "high" });
    ok(updated.title === "Test task" && updated.status === "Doing" && updated.priority === "high", "upsert merges fields into the existing record");
    ok(updated.updated >= before.updated && updated.created === before.created, "upsert bumps updated, preserves created");

    // 3. first save writes the changed records; later saves write ONLY changed records
    await store.save();
    ok(log.length === 1, "first save happened (1 batch in write log)");
    const firstBatch = log[0];
    ok(firstBatch.length >= ENTITY_TYPES.length + 1, "first batch wrote all created records (+meta), got " + firstBatch.length);
    ok(firstBatch.includes(store.key("task", t1.id)) && firstBatch.includes(store.key("project", created.project.id)), "first batch includes each created record's key");

    // touch one record, save again, and assert ONLY that record is rewritten
    log.length = 0;
    const t2 = store.upsert("task", t1.id, { title: "Renamed task" });
    await store.save();
    ok(log.length === 1 && log[0].includes(store.key("task", t1.id)), "second batch includes the changed record");
    const nonMeta = log[0].filter((k) => !k.startsWith("__"));
    ok(nonMeta.length === 1 && nonMeta[0] === store.key("task", t1.id), "second batch writes ONLY the changed record — got " + JSON.stringify(nonMeta));    ok(store.get("task", t1.id).title === "Renamed task", "in-memory cache reflects the change immediately");

    // 4. debounce: rapid mutations collapse into one save ~debounceMs after the last
    log.length = 0;
    store.create("note", { title: "A" });
    store.create("note", { title: "B" });
    store.create("note", { title: "C" });
    await sleep(40);
    ok(log.length === 1 && log[0].filter((k) => k.startsWith("r:note:")).length === 3, "three rapid creates debounce into a single save of 3 records");

    // 5. delete writes a removal and drops the record
    log.length = 0;
    const victim = created.checklist;
    store.remove("checklist", victim.id);
    ok(store.get("checklist", victim.id) === null, "removed record is gone from the cache immediately");
    await store.save();
    let entries = await store.kvFolder.entries();
    ok(!entries.some(([k]) => k === store.key("checklist", victim.id)), "removed record is gone from IndexedDB after save");

    // 6. persistence across reloads (new Store instance, same folder)
    const store2 = new Store({ kv: root.kv, folder });
    await store2.load();
    ok(store2.count("task") === 1 && store2.get("task", t1.id).title === "Renamed task", "reload restores records with their latest data");
    ok(store2.count("note") === 4, "reload restores all records (notes = " + store2.count("note") + ")");
    ok(store2.count("project") === 1 && store2.get("project", created.project.id).name === "Test project", "reload restores project record intact");
    ok(store2.count("checklist") === 0, "reload reflects the deletion");

    // 7. settings persist through the same pipeline
    store2.setSetting("profileName", "Tester");
    store2.setSetting("theme", "dark");
    await store2.save();
    const store3 = new Store({ kv: root.kv, folder });
    await store3.load();
    ok(store3.settings.profileName === "Tester" && store3.settings.theme === "dark", "settings persist across reloads");

    // 8. save-state lifecycle
    const states = [];
    store3.subscribe((e) => { if (e.type === "savestate") states.push(e.state); });
    store3.create("habit", { name: "H" });
    await store3.save();
    ok(states.includes("saving") && states.includes("saved"), "save state transitions through saving → saved (" + states.join(",") + ")");

    // cleanup test folder
    const all = await store3.kvFolder.entries();
    for (const [k] of all) await store3.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }

  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 1 tests: backup export/restore, palette scoring, theme ──
export async function runPhase1Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p1_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  try {
    await store.load();
    store.create("project", { name: "Alpha", color: "#8b5cf6", status: "Active" });
    store.create("task", { title: "Ship v1", projectId: "x", priority: "high", status: "Active", tags: ["ship", "urgent"] });
    store.create("task", { title: "Write docs", projectId: "x", priority: "low", status: "Active", tags: ["docs"] });
    store.create("note", { title: "Ideas", body: "hello", pinned: true, tags: ["brainstorm"] });
    store.create("event", { title: "Standup", date: "2026-08-28", startTime: "09:00", endTime: "09:15" });
    await store.save();

    // export shape (task 4)
    const dump = store.exportAll();
    ok(dump.app === "project-master" && dump.schemaVersion === SCHEMA_VERSION, "export includes app marker + schema version");
    ok(dump.entities.project.length === 1 && dump.entities.task.length === 2 && dump.entities.note.length === 1, "export groups entities by type");
    ok(typeof dump.exportedAt === "number", "export includes a timestamp");

    // validation (task 5)
    ok(store.validateBackup(dump) === undefined, "valid backup passes validation");
    let threw = false; try { store.validateBackup({ app: "other" }); } catch (e) { threw = true; }
    ok(threw, "wrong app marker is rejected");
    threw = false; try { store.validateBackup({ app: "project-manager", entities: { task: "nope" } }); } catch (e) { threw = true; }
    ok(threw, "non-array entity list is rejected");
    threw = false; try { store.validateBackup({ app: "project-manager", entities: {}, schemaVersion: 999 }); } catch (e) { threw = true; }
    ok(threw, "future schema version is rejected");
    threw = false; try { store.validateBackup({ app: "project-manager", entities: { task: [] } }); } catch (e) { threw = true; }
    ok(threw, "missing schema version is rejected");

    // restore replaces data (task 5)
    const backup = { app: "project-manager", schemaVersion: SCHEMA_VERSION, entities: { task: [{ id: "t9", type: "task", title: "Restored task", v: SCHEMA_VERSION, created: 1, updated: 1 }] }, settings: { profileName: "Restored" } };
    store.restoreFromBackup(backup);
    ok(store.count("task") === 1 && store.get("task", "t9").title === "Restored task", "restore replaces records with backup contents");
    ok(store.count("project") === 0 && store.count("note") === 0, "restore drops records not in the backup");
    await store.save();
    const store2 = new Store({ kv: root.kv, folder });
    await store2.load();
    ok(store2.count("task") === 1 && store2.settings.profileName === "Restored", "restore persists across a reload");

    // wipeAll (task 6)
    store.wipeAll();
    await store.save();
    const store3 = new Store({ kv: root.kv, folder });
    await store3.load();
    ok(store3.count("task") === 0 && store3.count("project") === 0 && store3.records.size === 0, "wipeAll removes every record");

    // palette fuzzy scoring (tasks 11–12)
    ok(fuzzyScore("ship", "Ship v1") > 0 && fuzzyScore("docs", "Write docs") > 0, "fuzzy score matches title text");
    ok(fuzzyScore("zzz", "anything") < 0, "non-matching query scores -1");
    ok(fuzzyScore("", "anything") === 0, "empty query scores 0");
    ok(fuzzyScore("s", "ship") > fuzzyScore("s", "write docs"), "fuzzy score prefers prefix/start matches");

    // theme setting round-trips (task 7)
    store3.setSetting("theme", "light");
    await store3.save();
    const store4 = new Store({ kv: root.kv, folder });
    await store4.load();
    ok(store4.settings.theme === "light", "theme setting persists across reloads");

    // cleanup
    for (const [k] of await store4.kvFolder.entries()) await store4.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 2 tests: projects hub logic, milestones, delete-with-move ──
export async function runPhase2Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p2_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const P = await import("./projects.js");
  try {
    await store.load();
    const today = new Date();
    const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const yest = new Date(today); yest.setDate(yest.getDate() - 1);
    const tmrw = new Date(today); tmrw.setDate(tmrw.getDate() + 1);

    const proj = store.create("project", { name: "Alpha", color: "#8b5cf6", status: "Active", targetDate: iso(tmrw), description: "desc" });
    const tOver = store.create("task", { title: "Late", projectId: proj.id, status: "Active", due: iso(yest), priority: "high" });
    const tToday = store.create("task", { title: "Now", projectId: proj.id, status: "Active", due: iso(today), priority: "med" });
    const tNext = store.create("task", { title: "Soon", projectId: proj.id, status: "Active", due: iso(tmrw), priority: "low" });
    const tDone = store.create("task", { title: "Finished", projectId: proj.id, status: "Done", due: iso(yest), priority: "low" });

    // projectStats (task 17)
    const st = P.projectStats(store, proj.id);
    ok(st.total === 4 && st.open === 3 && st.done === 1, "projectStats counts total/open/done (4/3/1)");
    ok(st.overdue === 1, "projectStats counts the single overdue task");
    ok(st.dueToday.length === 1 && st.dueToday[0].id === tToday.id, "projectStats collects due-today list");
    ok(st.upcoming.length === 1 && st.upcoming[0].id === tNext.id, "projectStats collects upcoming list (sorted)");
    ok(st.nearest && st.nearest.id === tToday.id, "nearest upcoming dated task is the due-today one");
    ok(st.progress === 25, "progress = done/total (25%)");
    ok(st.milestonesTotal === 0 && st.milestonesDone === 0, "no milestones → 0/0");
    ok(st.completedToday === 0, "completedToday is 0 (task pre-dates today's window)");

    // markTaskDone + completedToday (task 21 stat)
    P.markTaskDone(store, tToday, true);
    const after = P.projectStats(store, proj.id);
    ok(store.get("task", tToday.id).status === "Done" && store.get("task", tToday.id).completedAt > 0, "markTaskDone sets Done + completedAt");
    ok(after.open === 2 && after.done === 2 && after.completedToday === 1, "completing a task updates open/done + completedToday");
    P.markTaskDone(store, tToday, false);
    ok(store.get("task", tToday.id).status === "Active" && store.get("task", tToday.id).completedAt === null, "markTaskDone(false) restores Active and clears completedAt");

    // milestones (tasks 17 & 21)
    const m1 = P.addMilestone(store, proj.id, "Milestone A", iso(tmrw));
    ok(m1 && m1.id && store.get("project", proj.id).milestones.length === 1, "addMilestone appends to project.milestones");
    ok(P.milestoneMeta(store, m1).linked === 0 && P.milestoneDone(store, proj.id, m1) === false, "milestone with no linked tasks is not done");
    P.linkTaskToMilestone(store, tOver.id, m1.id);
    P.linkTaskToMilestone(store, tDone.id, m1.id);
    ok(P.milestoneMeta(store, m1).linked === 2 && P.milestoneMeta(store, m1).doneCount === 1, "milestone meta counts linked + done tasks");
    ok(P.milestoneDone(store, proj.id, m1) === false, "milestone not done while a linked task is open");
    P.markTaskDone(store, tOver, true);
    ok(P.milestoneDone(store, proj.id, m1) === true, "milestone auto-completes when ALL linked tasks are done");
    P.markTaskDone(store, tOver, false);
    ok(P.milestoneDone(store, proj.id, m1) === false, "milestone re-opens when a linked task is un-done");
    P.updateMilestone(store, proj.id, m1.id, { name: "Milestone A2" });
    ok(store.get("project", proj.id).milestones[0].name === "Milestone A2", "updateMilestone renames a milestone");
    P.removeMilestone(store, proj.id, m1.id);
    ok(store.get("project", proj.id).milestones.length === 0, "removeMilestone drops the milestone");
    ok(store.get("task", tOver.id).milestoneId === null && store.get("task", tDone.id).milestoneId === null, "removeMilestone unlinks its tasks");

    // delete with move (task 19)
    const st2 = P.projectStats(store, proj.id);
    const moved = P.deleteProject(store, proj, "move");
    ok(moved === 4 && store.get("project", proj.id) === null, "deleteProject(move) removes the project");
    ok(store.all("task").length === 4 && store.all("task").every((t) => (t.projectId ?? null) === null), "deleteProject(move) reassigns ALL tasks to Default (projectId null)");
    ok(st2.total === 4, "stats captured before deletion");

    // delete with tasks too (task 19)
    const proj2 = store.create("project", { name: "Beta", color: "#22d3ee", status: "Active" });
    const tA = store.create("task", { title: "A", projectId: proj2.id, status: "Active" });
    const tB = store.create("task", { title: "B", projectId: proj2.id, status: "Active" });
    const delCount = P.deleteProject(store, proj2, "delete");
    ok(delCount === 2 && store.get("project", proj2.id) === null, "deleteProject(delete) removes the project");
    ok(store.get("task", tA.id) === null && store.get("task", tB.id) === null, "deleteProject(delete) removes its tasks too");

    // resolveTab (task 20)
    ok(P.resolveTab("x", "notes") === "notes", "resolveTab prefers the explicit param");
    ok(P.resolveTab("x", "") === "overview", "resolveTab defaults to overview");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

export async function runAllTests() {
  const a = await runDataLayerTests();
  const b = await runPhase1Tests();
  const c = await runPhase2Tests();
  const d = await runPhase2bTests();
  const e = await runPhase3Tests();
  const f = await runPhase3bTests();
  const g = await runPhase3cTests();
  const h = await runPhase4Tests();
  const i = await runPhase4bTests();
  const j = await runPhase5Tests();
  const k = await runPhase6Tests();
  const l = await runPhase7Tests();
  const m = await runPhase8Tests();
  const n = await runPhase9Tests();
  const o = await runPhase10Tests();
  const p = await runPhase11Tests();
  const q = await runPhase12Tests();
  const suites = [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q];
  const total = suites.reduce((x, s) => x + s.total, 0);
  const passed = suites.reduce((x, s) => x + s.passed, 0);
  return { dataLayer: a.passed + "/" + a.total, phase1: b.passed + "/" + b.total, phase2: c.passed + "/" + c.total, phase2b: d.passed + "/" + d.total, phase3: e.passed + "/" + e.total, phase3b: f.passed + "/" + f.total, phase3c: g.passed + "/" + g.total, phase4: h.passed + "/" + h.total, phase4b: i.passed + "/" + i.total, phase5: j.passed + "/" + j.total, phase6: k.passed + "/" + k.total, phase7: l.passed + "/" + l.total, phase8: m.passed + "/" + m.total, phase9: n.passed + "/" + n.total, phase10: o.passed + "/" + o.total, phase11: p.passed + "/" + p.total, phase12: q.passed + "/" + q.total, total: passed + "/" + total };
}

// ── Phase 2b tests: timeline data + brainstorm logic (tasks 22–23) ──
export async function runPhase2bTests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p2b_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const P = await import("./projects.js");
  const D = await import("./dates.js");
  try {
    await store.load();
    const today = D.todayLocal();
    const yest = D.addDays(today, -1), tmrw = D.addDays(today, 1), in3 = D.addDays(today, 3);
    const proj = store.create("project", { name: "Alpha", color: "#8b5cf6", status: "Active" });
    store.create("task", { title: "Overdue task", projectId: proj.id, status: "Active", due: yest, priority: "high" });
    store.create("task", { title: "Today task", projectId: proj.id, status: "Active", due: today, priority: "med" });
    store.create("task", { title: "Upcoming task", projectId: proj.id, status: "Active", due: in3, priority: "low" });
    store.create("task", { title: "Done task", projectId: proj.id, status: "Done", due: yest, priority: "low" });
    store.create("task", { title: "Undated task", projectId: proj.id, status: "Active", due: "" });
    store.create("task", { title: "Other project", projectId: "zzz", status: "Active", due: tmrw });
    P.addMilestone(store, proj.id, "M1", in3);
    P.addMilestone(store, proj.id, "M2", "");

    const tl = P.timelineData(store, proj.id);
    ok(tl.dayCount > 0 && tl.start <= today && tl.end >= in3, "timeline range covers today and the furthest due date");
    ok(tl.items.length === 4, "timeline items = dated tasks only (4, excl. other project + undated)");
    ok(tl.items.every((i) => i.idx >= 0 && i.idx < tl.dayCount), "every item has a valid day index");
    const overdue = tl.items.filter((i) => i.title === "Overdue task")[0];
    ok(overdue && overdue.overdue === true, "past-due task flagged overdue");
    ok(tl.items.find((i) => i.title === "Done task").done === true, "done task flagged done");
    ok(tl.ms.length === 1 && tl.ms[0].title === "M1", "timeline includes dated milestones only");
    ok(tl.undatedTasks.length === 1 && tl.undatedTasks[0].title === "Undated task", "undated tasks collected separately");
    ok(tl.undatedMs.length === 1 && tl.undatedMs[0].name === "M2", "undated milestones collected separately");
    ok(tl.counts.overdue === 1 && tl.counts.todayCount === 1 && tl.counts.upcoming === 2 && tl.counts.undated === 2, "timeline summary counts correct (overdue/today/upcoming/undated = 1/1/2/2)");

    // brainstorm (task 23)
    const idea = P.addIdea(store, proj.id, "  Ship it faster  ", ["ship", "speed"]);
    ok(idea && idea.text === "Ship it faster" && idea.tags.join(",") === "ship,speed" && idea.adopted === false, "addIdea trims text + tags, starts unadopted");
    ok(P.ideasByProject(store, proj.id).length === 1, "ideasByProject lists ideas for the project");
    const task = P.promoteIdea(store, proj.id, idea.id);
    ok(task && store.get("task", task.id).title === "Ship it faster" && store.get("task", task.id).projectId === proj.id, "promoteIdea creates a task in the project from the idea");
    const adopted = P.ideasByProject(store, proj.id)[0];
    ok(adopted.adopted === true && adopted.taskId === task.id, "promoteIdea marks the idea adopted with the new task id");
    ok(P.promoteIdea(store, proj.id, idea.id) === null, "promoteIdea refuses to double-promote an adopted idea");
    P.removeIdea(store, proj.id, idea.id);
    ok(P.ideasByProject(store, proj.id).length === 0, "removeIdea deletes the idea");
    P.addIdea(store, proj.id, "Keep me");
    const keep = P.ideasByProject(store, proj.id);
    P.removeIdea(store, proj.id, keep[0].id);
    ok(P.ideasByProject(store, proj.id).length === 0, "promote then remove leaves no ideas behind");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 3 tests: global tasks view filter + sort logic (tasks 24–26) ──
export async function runPhase3Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const T = await import("./tasks.js");
  const D = await import("./dates.js");
  const today = D.todayLocal();
  const yest = D.addDays(today, -1), tmrw = D.addDays(today, 1);
  const mk = (id, patch) => Object.assign({ id, type: "task", title: id, status: "Active", priority: "low", due: "", tags: [], notes: "", projectId: null, milestoneId: null, created: 0 }, patch);
  const tasks = [
    mk("a", { title: "Alpha urgent", status: "Active", priority: "high", due: yest, tags: ["work"], projectId: "p1", created: 1 }),
    mk("b", { title: "Beta today", status: "Doing", priority: "med", due: today, tags: ["work", "home"], projectId: "p1", created: 2 }),
    mk("c", { title: "Gamma later", status: "Active", priority: "low", due: tmrw, tags: [], projectId: "p2", created: 3 }),
    mk("d", { title: "Delta done", status: "Done", priority: "high", due: yest, tags: ["home"], projectId: "p2", created: 4, completedAt: 9 }),
    mk("e", { title: "Epsilon undated", status: "Active", priority: "med", due: "", tags: [], projectId: null, created: 5 }),
    mk("f", { title: "Zulu find me", status: "Active", priority: "low", due: tmrw, tags: [], projectId: "p2", created: 6 }),
  ];
  const S = (patch) => Object.assign({ q: "", status: "all", priority: "all", project: "all", tag: "all", daterange: "all", sort: "due", dir: "asc" }, patch);

  ok(T.filterAndSortTasks(tasks, S({})).length === 6, "no filters → all tasks");
  ok(T.filterAndSortTasks(tasks, S({ status: "done" })).map((t) => t.id).join() === "d", "status=done keeps only done tasks");
  ok(T.filterAndSortTasks(tasks, S({ status: "active" })).length === 5, "status=active excludes done tasks");
  ok(T.filterAndSortTasks(tasks, S({ priority: "high" })).map((t) => t.id).join() === "a,d", "priority=high filters correctly");
  ok(T.filterAndSortTasks(tasks, S({ project: "p1" })).map((t) => t.id).join() === "a,b", "project filter isolates a project");
  ok(T.filterAndSortTasks(tasks, S({ project: "none" })).map((t) => t.id).join() === "e", "project=none isolates unassigned tasks");
  ok(T.filterAndSortTasks(tasks, S({ tag: "home" })).map((t) => t.id).join() === "d,b", "tag filter matches the tag list (due-date order)");
  ok(T.filterAndSortTasks(tasks, S({ daterange: "overdue" })).map((t) => t.id).join() === "a", "daterange=overdue keeps open past-due only (excludes done d)");
  ok(T.filterAndSortTasks(tasks, S({ daterange: "today" })).map((t) => t.id).join() === "b", "daterange=today matches due today");
  ok(T.filterAndSortTasks(tasks, S({ daterange: "upcoming" })).map((t) => t.id).join() === "c,f", "daterange=upcoming matches future due dates");
  ok(T.filterAndSortTasks(tasks, S({ daterange: "undated" })).map((t) => t.id).join() === "e", "daterange=undated matches no-date tasks");
  ok(T.filterAndSortTasks(tasks, S({ daterange: "past" })).map((t) => t.id).join() === "a,d", "daterange=past matches any past due date (incl. done)");
  ok(T.filterAndSortTasks(tasks, S({ q: "find" })).map((t) => t.id).join() === "f", "text search matches title");
  ok(T.filterAndSortTasks(tasks, S({ q: "  WORK  " })).map((t) => t.id).join() === "a,b", "text search is case-insensitive and trims query");
  ok(T.filterAndSortTasks(tasks, S({ q: "work" })).map((t) => t.id).join() === "a,b", "text search also matches tags");

  const byDueAsc = T.filterAndSortTasks(tasks, S({ sort: "due" })).map((t) => t.id);
  ok(byDueAsc[0] === "a" && byDueAsc[byDueAsc.length - 1] === "e", "sort=due asc puts overdue first, undated last");
  const byDueDesc = T.filterAndSortTasks(tasks, S({ sort: "due", dir: "desc" })).map((t) => t.id);
  ok(byDueDesc[0] === "e", "sort=due desc puts undated (9999) first");
  ok(T.filterAndSortTasks(tasks, S({ sort: "priority" })).map((t) => t.id).join() === "a,d,b,e,c,f", "sort=priority orders high before low (ties broken by title)");
  ok(T.filterAndSortTasks(tasks, S({ sort: "title" }))[0].id === "a", "sort=title orders alphabetically");
  ok(T.filterAndSortTasks(tasks, S({ sort: "created" }))[0].id === "a", "sort=created orders by creation time");
  const combined = T.filterAndSortTasks(tasks, S({ status: "active", priority: "med", sort: "title" })).map((t) => t.id);
  ok(combined.join() === "b,e", "filters compose (active+med)");
  await import("./projects.js");
  const { todayLocal: tl2 } = await import("./dates.js");
  ok(tl2() === today, "dates.todayLocal matches");
  return { total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, folder: "n/a" };
}

// ── Phase 3b tests: task editor fields, subtasks, kanban, highlighting (tasks 27–30) ──
export async function runPhase3bTests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p3b_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const E = await import("./taskEditor.js");
  const P = await import("./projects.js");
  const D = await import("./dates.js");
  try {
    await store.load();
    const today = D.todayLocal();
    const yest = D.addDays(today, -1), tmrw = D.addDays(today, 1);
    const proj = store.create("project", { name: "Beta", color: "#22d3ee", status: "Active" });
    const other = store.create("project", { name: "Other", color: "#8b5cf6", status: "Active" });
    P.addMilestone(store, proj.id, "Launch", tmrw);

    // task 27 — full task editor fields round-trip
    const created = store.create("task", {
      title: "Build the thing", status: "Doing", priority: "high", due: tmrw,
      tags: E.parseTags(" design,  urgent ,"), notes: "Acceptance: it works",
      projectId: proj.id, milestoneId: null, subtasks: [],
    });
    ok(created && created.title === "Build the thing" && created.status === "Doing" && created.priority === "high", "create task accepts every editor field");
    ok(created.tags.join(",") === "design,urgent" && created.due === tmrw && created.notes === "Acceptance: it works", "create task stores parsed tags + notes + due");
    const saved = E.updateTask(store, created.id, { title: "Build the thing (v2)", status: "Active" });
    ok(saved.title === "Build the thing (v2)" && saved.status === "Active" && saved.priority === "high" && saved.due === tmrw, "updateTask merges a patch without losing other fields");
    ok(E.updateTask(store, "missing-id", { title: "x" }) === null, "updateTask on unknown id returns null");
    ok(E.parseTags("") .length === 0 && E.parseTags("  a , b , ") .join() === "a,b", "parseTags trims + drops empties");

    // task 28 — nested subtasks
    const tk = store.get("task", created.id);
    ok(E.subtaskStats(tk).total === 0 && E.subtaskStats({}).total === 0, "subtaskStats empty for no subtasks");
    ok(E.addSubtask(store, created.id, "  Write spec  ") && E.subtaskStats(store.get("task", created.id)).total === 1, "addSubtask trims + appends");
    ok(E.addSubtask(store, created.id, "   ") === null, "addSubtask ignores blank titles");
    const sub2 = E.addSubtask(store, created.id, "Implement");
    E.addSubtask(store, created.id, "Test");
    ok(E.subtaskStats(store.get("task", created.id)).total === 3 && E.subtaskStats(store.get("task", created.id)).done === 0, "subtaskStats counts total/done");
    E.toggleSubtask(store, created.id, sub2.id);
    ok(E.subtaskStats(store.get("task", created.id)).done === 1, "toggleSubtask marks a subtask done");
    E.toggleSubtask(store, created.id, sub2.id);
    ok(E.subtaskStats(store.get("task", created.id)).done === 0, "toggleSubtask un-marks a subtask");
    E.removeSubtask(store, created.id, sub2.id);
    ok(E.subtaskStats(store.get("task", created.id)).total === 2, "removeSubtask deletes one subtask");
    const subs = store.get("task", created.id).subtasks;
    ok(Array.isArray(subs) && subs.every((s) => s.id && s.title && typeof s.done === "boolean"), "subtasks persist on the task record with id/title/done");

    // task 29 — kanban board columns
    store.create("task", { title: "Active one", projectId: proj.id, status: "Active", due: today });
    store.create("task", { title: "Active two", projectId: proj.id, status: "Active", due: "" });
    store.create("task", { title: "Doing card", projectId: proj.id, status: "Doing", due: tmrw });
    store.create("task", { title: "Done card", projectId: proj.id, status: "Done", due: "" });
    store.create("task", { title: "Foreign", projectId: other.id, status: "Active", due: "" });
    const cols = P.boardColumns(store, proj.id);
    ok(cols.length === 4 && cols.map((c) => c.status).join() === "Active,Doing,Blocked,Done", "boardColumns has the four status columns in order");
    ok(cols[0].tasks.map((t) => t.title).join() === "Active one,Build the thing (v2),Active two", "active column sorts by due (undated last), excludes other projects");
    ok(cols[1].tasks.length === 1 && cols[2].tasks.length === 0 && cols[3].tasks.length === 1, "Doing/Blocked/Done columns populated correctly (Blocked empty)");
    const card = cols[0].tasks[0];
    store.upsert("task", card.id, { status: "Blocked" });
    const moved = P.boardColumns(store, proj.id);
    ok(moved[2].tasks.some((t) => t.id === card.id), "moving a task = setting its status → appears in the target column");

    // task 30 — overdue & due-today highlighting
    ok(D.dueHighlight(yest).over === true && D.dueHighlight(yest).today === false, "past due → overdue highlight");
    ok(D.dueHighlight(today).today === true && D.dueHighlight(today).over === false, "due today → today highlight");
    ok(D.dueHighlight(today, true).over === false && D.dueHighlight(today, true).today === false, "done task gets no highlight");
    ok(D.dueHighlight("").over === false && D.dueHighlight("").today === false, "undated task gets no highlight");
    ok(D.dueHighlight(tmrw).over === false && D.dueHighlight(tmrw).today === false, "future due gets no highlight");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 3c tests: completed-today tracking (task 31) ──
export async function runPhase3cTests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p3c_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const T = await import("./tasks.js");
  const D = await import("./dates.js");
  try {
    await store.load();
    const today = D.todayLocal();
    const S = (patch) => Object.assign({ q: "", status: "all", priority: "all", project: "all", tag: "all", daterange: "all", sort: "due", dir: "asc" }, patch);
    const mk = (id, patch) => Object.assign({ id, type: "task", title: id, status: "Active", priority: "low", due: "", tags: [], notes: "", projectId: null, milestoneId: null, created: 0 }, patch);
    const tasks = [
      mk("nowDone", { title: "Done now", status: "Done", due: today, completedAt: Date.now() }),
      mk("yestDone", { title: "Done yesterday", status: "Done", due: D.addDays(today, -1), completedAt: Date.parse(D.addDays(today, -1) + "T12:00:00") }),
      mk("noStamp", { title: "Done but unstamped", status: "Done", due: today }),
      mk("open1", { title: "Open today", status: "Active", due: today }),
      mk("open2", { title: "Open no date", status: "Active", due: "" }),
    ];
    ok(T.filterAndSortTasks(tasks, S({ daterange: "doneToday" })).map((t) => t.id).join() === "nowDone", "daterange=doneToday keeps only tasks completed today (local-day stamp)");
    ok(T.filterAndSortTasks(tasks, S({ daterange: "doneAny" })).map((t) => t.id).join() === "yestDone,nowDone", "daterange=doneAny keeps every task with a completedAt stamp (excludes unstamped + open; due-date order)");
    ok(D.msToIso(Date.now()) === today, "msToIso converts a now timestamp to today's local ISO day");

    const proj = store.create("project", { name: "P", color: "#22d3ee", status: "Active" });
    store.create("task", { title: "open overdue", projectId: proj.id, status: "Active", due: D.addDays(today, -1) });
    store.create("task", { title: "open today", projectId: proj.id, status: "Active", due: today });
    store.create("task", { title: "open future", projectId: proj.id, status: "Active", due: D.addDays(today, 2) });
    store.create("task", { title: "open undated", projectId: proj.id, status: "Active", due: "" });
    store.create("task", { title: "done today", projectId: proj.id, status: "Done", due: today, completedAt: Date.now() });
    store.create("task", { title: "done old", projectId: proj.id, status: "Done", due: D.addDays(today, -3), completedAt: Date.now() - 5 * 86400000 });
    const st = T.tvStats(store);
    ok(st.open === 4 && st.overdue === 1 && st.dueToday === 1 && st.doneToday === 1 && st.total === 6, "tvStats counts open/overdue/due-today/completed-today over a real store");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 4 tests: calendar month grid, week view, day data (tasks 32–35) ──
export async function runPhase4Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p4_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const C = await import("./calendar.js");
  const D = await import("./dates.js");
  try {
    await store.load();
    const today = D.todayLocal();
    const yest = D.addDays(today, -1);

    // task 32 — month grid (Monday-first, 6×7)
    const g = C.monthGrid("2024-02");
    ok(g.length === 42, "monthGrid returns 42 cells (6 weeks × 7 days)");
    ok(g[0] === "2024-01-29", "monthGrid starts on the Monday before the 1st (Feb 2024 starts Thursday → Monday Jan 29)");
    ok(g[3] === "2024-02-01", "monthGrid places the 1st at the correct Monday-first offset (index 3)");
    ok(g.includes("2024-02-29"), "monthGrid covers a leap day (Feb 2024)");
    ok(g.every((iso, i) => i === 0 || D.dayDiff(g[i - 1], iso) === 1), "monthGrid cells are consecutive days");
    ok(D.parseIso(g[0]).getDay() === 1, "monthGrid's first cell is always a Monday");

    // task 34 — 7-day week view helper
    const w = C.weekDays("2024-02-14");
    ok(w.length === 7 && w[0] === "2024-02-12" && w[6] === "2024-02-18", "weekDays returns the Mon–Sun week containing the given day (Wed Feb 14 → Mon Feb 12…Sun Feb 18)");
    ok(D.dayDiff(C.weekDays(today)[0], C.weekDays(today)[6]) === 6, "weekDays(today) is a full Mon–Sun week");
    ok(C.firstOfMonth("2026-08-14") === "2026-08-01", "firstOfMonth normalizes to the 1st");
    ok(C.monthLabel("2026-08-14").includes("2026") && C.monthLabel("2026-08-14").length > 6, "monthLabel renders a readable month+year label");
    const wl = C.weekLabel("2026-08-14");
    ok(wl.includes("2026") && wl.includes("16") && wl.includes("–"), "weekLabel spans Mon 10 – Sun 16 Aug 2026");
    ok(C.weekDays("2024-02-14")[0] === C.weekDays("2024-02-18")[0], "any day in the same week shares the same week start");

    // task 33 — day detail data
    const proj = store.create("project", { name: "Alpha", color: "#8b5cf6", status: "Active" });
    store.create("task", { title: "Low first", projectId: proj.id, status: "Active", due: today, priority: "low" });
    store.create("task", { title: "High second", projectId: proj.id, status: "Active", due: today, priority: "high" });
    store.create("task", { title: "Done one", projectId: proj.id, status: "Done", due: today, priority: "high", completedAt: Date.now() });
    store.create("task", { title: "Open yest", projectId: proj.id, status: "Active", due: yest, priority: "med" });
    store.create("task", { title: "No date", projectId: proj.id, status: "Active", due: "" });
    const byDue = C.tasksByDue(store);
    ok(byDue.size === 2 && byDue.has(today) && byDue.has(yest) && !byDue.has(""), "tasksByDue groups only dated tasks by due day");
    ok(byDue.get(today).length === 3, "tasksByDue includes both open and done tasks for a day");
    const ev = C.eventsForDay(store, today);
    ok(ev.map((t) => t.title).join() === "High second,Low first,Done one", "eventsForDay sorts open-first, then priority (high→low), done last");
    ok(C.eventsForDay(store, D.addDays(today, 5)).length === 0, "eventsForDay returns empty for a day with nothing due");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 4b tests: events CRUD helpers + tasks-on-calendar (tasks 36–37) ──
export async function runPhase4bTests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p4b_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const E = await import("./events.js");
  const D = await import("./dates.js");
  try {
    await store.load();
    ok(E.EVENT_COLORS.length === 8, "EVENT_COLORS provides 8 palette colours");

    store.create("event", { title: "Late", date: "2026-08-28", startTime: "10:00", color: "#8b5cf6" });
    store.create("event", { title: "Early", date: "2026-08-28", startTime: "08:30", color: "#22d3ee" });
    store.create("event", { title: "No time", date: "2026-08-28", startTime: "", color: "#ec4899" });
    store.create("event", { title: "Other day", date: "2026-08-29", startTime: "09:00", color: "#22c55e" });

    const byDate = E.eventsByDate(store);
    ok(byDate.size === 2 && byDate.has("2026-08-28") && byDate.has("2026-08-29"), "eventsByDate groups events by date");
    ok(byDate.get("2026-08-28").map((e) => e.title).join() === "Early,Late,No time", "eventsByDate sorts a day's events by start time (blank-late)");
    ok(E.eventsForDay(store, "2026-08-28").length === 3, "eventsForDay lists all events on a day");
    ok(E.eventsForDay(store, "2026-08-30").length === 0, "eventsForDay empty for a day with no events");

    // records carry the editor's fields
    const ev = store.create("event", { title: "Standup", date: D.todayLocal(), startTime: "09:15", endTime: "09:30", color: "#f59e0b", notes: "in the meeting room" });
    ok(ev.title === "Standup" && ev.date === D.todayLocal() && ev.startTime === "09:15" && ev.endTime === "09:30" && ev.color === "#f59e0b" && ev.notes === "in the meeting room", "event record stores title/date/times/color/notes");
    store.remove("event", ev.id);
    ok(store.get("event", ev.id) === null, "event removal drops the record");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 5 tests: checklists (tasks 38–42) ──
export async function runPhase5Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p5_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const C = await import("./checklists.js");
  try {
    await store.load();
    ok(C.CHECKLIST_TEMPLATES.length === 6, "6 built-in templates offered (weekly-reset, trip, moving, launch, standup, grocery)");
    const trip = C.templateById("trip");
    ok(trip && trip.items.length > 0, "templateById('trip') resolves with items");
    ok(C.templateById("nope") === null, "templateById unknown id returns null");

    // stats + item mutations (tasks 38–41)
    ok(C.checklistStats({ items: [{ done: true }, { done: false }, { done: true }] }).done === 2 && C.checklistStats({ items: [{ done: true }, { done: false }, { done: true }] }).total === 3, "checklistStats counts done/total");
    ok(C.checklistStats({}).total === 0, "checklistStats handles missing items");
    const cl = store.create("checklist", { name: "Launch", items: [], template: "launch" });
    ok(cl && cl.name === "Launch" && Array.isArray(cl.items), "checklist record has name + items array");
    const item = C.addItem(store, cl.id, "  Write spec  ");
    ok(item && item.text === "Write spec" && item.done === false, "addItem trims the text and appends an unchecked item");
    ok(C.addItem(store, cl.id, "   ") === null, "addItem ignores blank text");
    C.addItem(store, cl.id, "Build");
    const sub = C.addItem(store, cl.id, "Test");
    ok(store.get("checklist", cl.id).items.length === 3, "items accumulate on the record");
    C.toggleItem(store, cl.id, sub.id);
    ok(C.checklistStats(store.get("checklist", cl.id)).done === 1, "toggleItem marks an item done");
    C.toggleItem(store, cl.id, sub.id);
    ok(C.checklistStats(store.get("checklist", cl.id)).done === 0, "toggleItem un-marks an item");
    C.removeItem(store, cl.id, sub.id);
    ok(store.get("checklist", cl.id).items.length === 2, "removeItem deletes one item");
    C.renameChecklist(store, cl.id, "  Big launch  ");
    ok(store.get("checklist", cl.id).name === "Big launch", "renameChecklist trims + renames");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 6 tests: notes (tasks 43–50) — pure filter/sort helpers ──
export async function runPhase6Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const N = await import("./notes.js");
  const mk = (id, patch) => Object.assign({ id, type: "note", title: "n" + id, body: "", pinned: false, tags: [], projectId: null, created: 1, updated: 1 }, patch);
  const notes = [
    mk("b", { title: "Beta", body: "buy milk and eggs", tags: ["grocery"], projectId: "p1", updated: 5 }),
    mk("a", { title: "Alpha", body: "research plan", tags: ["work"], projectId: "p2", updated: 9, pinned: true }),
    mk("c", { title: "Gamma", body: "nothing here", tags: [], projectId: null, updated: 3 }),
    mk("d", { title: "Delta", body: "alpha ideas", tags: ["ideas"], projectId: "p1", updated: 7 }),
  ];
  ok(N.filterNotes(notes, "", "all").map((n) => n.id).join() === "a,d,b,c", "filterNotes sorts pinned-first then updated desc (a pinned, then d(7), b(5), c(3))");
  ok(N.filterNotes(notes, "milk", "all").map((n) => n.id).join() === "b", "filterNotes searches body text");
  ok(N.filterNotes(notes, "ALPHA", "all").map((n) => n.id).join() === "a,d", "filterNotes search is case-insensitive and matches title/body");
  ok(N.filterNotes(notes, "grocery", "all").map((n) => n.id).join() === "b", "filterNotes searches tags");
  ok(N.filterNotes(notes, "", "p1").map((n) => n.id).join() === "d,b", "filterNotes filters by project");
  ok(N.filterNotes(notes, "", "none").map((n) => n.id).join() === "c", "filterNotes project=none keeps only unassigned");
  ok(N.filterNotes(notes, "zzz", "all").length === 0, "filterNotes empty result for no match");

  // pin toggle on a real store
  const folder = "pm_test_p6_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  try {
    await store.load();
    const note = store.create("note", { title: "T", body: "", pinned: false, tags: [] });
    ok(N.togglePin(store, note) === true && store.get("note", note.id).pinned === true, "togglePin flips pinned on");
    ok(N.togglePin(store, store.get("note", note.id)) === false && store.get("note", note.id).pinned === false, "togglePin flips pinned off");
    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder: "n/a" };
}

// ── Phase 7 tests: habits (tasks 51–56) ──
export async function runPhase7Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p7_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const H = await import("./habits.js");
  const D = await import("./dates.js");
  try {
    await store.load();
    const today = "2026-08-28"; // a Friday
    ok(H.habitWeek(today).join() === "2026-08-24,2026-08-25,2026-08-26,2026-08-27,2026-08-28,2026-08-29,2026-08-30", "habitWeek returns Mon–Sun around a Friday");
    const heat = H.heatGrid(today);
    ok(heat.length === 84, "heatGrid covers the last 12 weeks (84 days)");
    ok(heat[0] === D.addDays(today, -83) && heat[83] === today, "heatGrid runs oldest → today");
    ok(heat.every((d, i) => i === 0 || D.dayDiff(heat[i - 1], d) === 1), "heatGrid cells are consecutive");

    const h = store.create("habit", { name: "Read", color: "#8b5cf6", icon: "zap", history: {}, showDashboard: false });
    const day = (iso) => H.toggleDay(store, h.id, iso);
    ok(H.toggleDay(store, h.id, today) === true && !!store.get("habit", h.id).history[today], "toggleDay checks a day in");
    ok(H.toggleDay(store, h.id, today) === false && !store.get("habit", h.id).history[today], "toggleDay un-checks a day");

    // build history: 3-day live streak (25/26/27), 4-day best (10–13), today unchecked
    for (const iso of ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"]) day(iso);
    const s = H.habitStats(store.get("habit", h.id), today);
    ok(s.total === 7, "habitStats total = lifetime check-ins (7)");
    ok(s.streak === 3, "habitStats current streak counts back from yesterday when today unchecked (3)");
    ok(s.best === 4, "habitStats best streak = longest run (4)");
    ok(s.thisWeek === 3 && s.checkedToday === false, "habitStats thisWeek counts Mon–Sun check-ins, checkedToday false");
    day(today);
    ok(H.habitStats(store.get("habit", h.id), today).checkedToday === true && H.habitStats(store.get("habit", h.id), today).streak === 4, "checking today extends the live streak to 4");
    // streak alive when today unchecked but yesterday checked
    const h2 = store.create("habit", { name: "Jog", color: "#22d3ee", icon: "zap", history: { [D.addDays(today, -1)]: true }, showDashboard: false });
    ok(H.habitStats(store.get("habit", h2.id), today).streak === 1, "streak stays alive when only yesterday is checked");
    // record shape (task 51)
    const h3 = store.create("habit", { name: "No sugar", color: "#ec4899", icon: "target", history: {}, showDashboard: false });
    ok(h3.history && typeof h3.history === "object" && h3.color && h3.icon, "habit record stores name/color/icon/history");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 8 tests: focus timer (tasks 57–62) — pure helpers ──
export async function runPhase8Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p8_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const F = await import("./focus.js");
  const D = await import("./dates.js");
  try {
    await store.load();
    // task 62 — durations from settings
    store.setSetting("focusWork", 50); store.setSetting("focusShort", 7); store.setSetting("focusLong", 20);
    const d = F.modeDurations(store.settings);
    ok(d.work === 50 && d.short === 7 && d.long === 20, "modeDurations reads live settings");
    ok(F.modeDurations({ focusWork: "abc" }).work === 25, "modeDurations falls back to defaults for bad input");
    ok(F.modeDurations({}).short === 5, "modeDurations default short break is 5 min");

    // task 57 — auto-cycle
    ok(F.sessionAdvance("short", 0) === "work", "short break always returns to work");
    ok(F.sessionAdvance("long", 0) === "work", "long break returns to work");
    ok(F.sessionAdvance("work", 0) === "short" && F.sessionAdvance("work", 3) === "short", "work sessions 1–3 take a short break");
    ok(F.sessionAdvance("work", 4) === "long", "4th consecutive work session earns the long break");
    ok(F.MODES.length === 3, "three timer modes exist");

    // task 60 — focuslog summaries drive the side panel
    const now = Date.now();
    store.create("focuslog", { started: now, durationMin: 25, taskId: null, mode: "work" });
    store.create("focuslog", { started: now, durationMin: 15, taskId: null, mode: "work" });
    store.create("focuslog", { started: now - 2 * 86400000, durationMin: 50, taskId: null, mode: "work" });
    store.create("focuslog", { started: now, durationMin: 5, taskId: null, mode: "short" });
    const t = F.focusTotals(store);
    ok(t.todayMin === 40 && t.sessionsToday === 2, "focusTotals sums only today's work sessions");
    ok(t.totalMin === 90 && t.sessionsTotal === 3, "focusTotals all-time counts work sessions only (excludes breaks)");
    ok(D.msToIso(now) === D.todayLocal(), "focuslog uses started timestamp → local today");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 9 tests: boards (tasks 63–73) — pure helpers ──
export async function runPhase9Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const folder = "pm_test_p9_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  const B = await import("./boards.js");
  try {
    await store.load();
    ok(B.BOARD_TYPES.length === 9, "nine board types offered (mindmap, venn, proscons, swot, matrix, moscow, rice, decision, affinity)");
    ok(B.BOARD_TYPES.every(([t, n, h]) => t && n && h), "every board type has a label + hint");

    // task 63 — default data per type
    const d = (t) => B.boardDefaultData(t);
    ok(d("mindmap").center === "Main idea" && Array.isArray(d("mindmap").nodes), "mindmap default: center + nodes array");
    ok(d("venn").items.length === 0 && d("venn").setA === "Set A", "venn default: sets + items");
    ok(d("proscons").pros.length === 0 && d("proscons").cons.length === 0, "proscons default: pros + cons arrays");
    ok(["S", "W", "O", "T"].every((k) => Array.isArray(d("swot")[k])), "swot default: S/W/O/T quadrants");
    ok(Array.isArray(d("matrix").items), "matrix default: items array");
    ok(["must", "should", "could", "wont"].every((k) => Array.isArray(d("moscow")[k])), "moscow default: four priority columns");
    ok(Array.isArray(d("rice").rows), "rice default: rows array");
    ok(Array.isArray(d("decision").options) && Array.isArray(d("decision").criteria), "decision default: options + criteria arrays");
    ok(Array.isArray(d("affinity").clusters) && Array.isArray(d("affinity").notes), "affinity default: clusters + notes arrays");

    // task 71 — RICE scoring
    ok(B.riceScore({ reach: 1000, impact: 3, confidence: 100, effort: 10 }) === 300, "RICE = reach × impact × conf% ÷ effort (1000×3×1÷10 = 300)");
    ok(B.riceScore({ reach: 1000, impact: 3, confidence: 50, effort: 10 }) === 150, "RICE halves when confidence is 50%");
    ok(B.riceScore({ reach: 0, impact: 3, confidence: 100, effort: 10 }) === 0, "RICE zero reach → 0");
    ok(Number.isFinite(B.riceScore({ reach: 100, impact: 2, confidence: 80, effort: 0 })), "RICE guards a 0 effort (no NaN)");

    // task 72 — decision matrix weighted totals
    const board = store.create("board", { name: "Pick a stack", kind: "decision", desc: "", data: { options: [{ id: "o1", name: "A" }, { id: "o2", name: "B" }], criteria: [{ id: "c1", name: "Speed", weight: 2 }, { id: "c2", name: "Cost", weight: 3 }], scores: { o1: { c1: 5, c2: 1 }, o2: { c1: 1, c2: 2 } } } });
    const totals = B.decisionTotals(board);
    ok(totals.o1 === 13 && totals.o2 === 8, "decisionTotals = Σ weight×score (o1: 5·2+1·3=13, o2: 1·2+2·3=8)");
    ok(B.decisionTotals(store.create("board", { name: "x", kind: "decision", data: {} })).o1 === undefined, "decisionTotals handles empty data");
    ok(store.get("board", board.id).type === "board" && store.get("board", board.id).kind === "decision", "board record keeps entity type='board' with tool type in kind");

    // task 63 — per-type item counts
    const count = (type, data) => B.boardCounts({ type, data });
    ok(count("mindmap", { nodes: [1, 2] }) === 2, "boardCounts mindmap counts nodes");
    ok(count("proscons", { pros: [1], cons: [2, 3] }) === 3, "boardCounts proscons sums both columns");
    ok(count("swot", { S: [1], W: [], O: [2, 3], T: [] }) === 3, "boardCounts swot sums all quadrants");
    ok(count("moscow", { must: [1], should: [], wont: [2] }) === 2, "boardCounts moscow sums all columns");
    ok(count("venn", { items: [1, 2, 3] }) === 3, "boardCounts venn counts items");
    ok(count("rice", { rows: [1] }) === 1, "boardCounts rice counts rows");
    ok(count("decision", { options: [1, 2] }) === 2, "boardCounts decision counts options");
    ok(count("affinity", { notes: [1, 2] }) === 2, "boardCounts affinity counts notes");
    ok(count("matrix", { items: [1] }) === 1, "boardCounts matrix counts items");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 11 tests: recurring tasks, dependencies, time tracking (80–82) ──
export async function runPhase11Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const TT = await import("./taskTools.js");
  const P = await import("./projects.js");
  const folder = "pm_test_p11_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  try {
    await store.load();
    const t = todayLocal();

    // 80 ─ recurring ────────────────────────────────────────────────
    ok(TT.nextRecurrenceDate("2026-08-28", { freq: "daily" }) === "2026-08-29", "daily recurrence = next day");
    ok(TT.nextRecurrenceDate("2026-08-28", { freq: "daily", interval: 2 }) === "2026-08-30", "daily interval 2 = +2 days");
    ok(TT.nextRecurrenceDate("2026-08-28", { freq: "weekly" }) === "2026-09-04", "weekly recurrence = +7 days");
    ok(TT.nextRecurrenceDate("2026-08-28", { freq: "weekly", interval: 2 }) === "2026-09-11", "weekly interval 2 = +14 days");
    ok(TT.nextRecurrenceDate("2026-01-31", { freq: "monthly" }) === "2026-02-28", "monthly clamps short months (Jan 31 -> Feb 28)");
    ok(TT.nextRecurrenceDate("2026-08-31", { freq: "monthly" }) === "2026-09-30", "monthly clamps 30-day months (Aug 31 -> Sep 30)");
    ok(TT.nextRecurrenceDate("2026-08-31", { freq: "monthly", interval: 2 }) === "2026-10-31", "monthly interval 2 skips a month");
    ok(TT.nextRecurrenceDate("", { freq: "daily" }) === addDays(t, 1), "undated recurring falls back to tomorrow");
    ok(TT.recurrenceLabel({ freq: "daily" }) === "Every day", "label: daily");
    ok(TT.recurrenceLabel({ freq: "weekly", interval: 2 }) === "Every 2 weeks", "label: every 2 weeks");
    ok(TT.recurrenceLabel({ freq: "monthly" }) === "Every month", "label: monthly");
    ok(TT.recurrenceLabel(null) === "", "label: no recurrence");

    const rec = store.create("task", { title: "Water plants", status: "Active", due: addDays(t, 1), priority: "med", recurrence: { freq: "weekly", interval: 1, count: 1 } });
    const recId = rec.id;
    ok(store.all("task").length === 1, "recurring task created alone");
    P.markTaskDone(store, rec, true);
    const afterDone = store.all("task");
    ok(afterDone.length === 2, "completing a recurring task spawns the next instance");
    const next = afterDone.find((x) => x.id !== recId);
    ok(next && next.title === "Water plants" && next.status === "Active", "next instance: same title, starts Active");
    ok(next && next.due === addDays(addDays(t, 1), 7), "next instance due = +1 week from previous due");
    ok(next && next.recurrence.count === 2 && next.recurringSeriesId === recId, "next instance bumps count and keeps series id");
    P.markTaskDone(store, next, true);
    ok(store.all("task").length === 3, "completing the next instance continues the series");
    const third = store.all("task").find((x) => x.id !== recId && x.id !== next.id);
    ok(third && third.recurringSeriesId === recId && third.recurrence.count === 3, "series continues (count 3, same series)");

    // 81 ─ dependencies ─────────────────────────────────────────────
    const dep = store.create("task", { title: "Dep task", status: "Active" });
    const depend = store.create("task", { title: "Depends on dep", status: "Active", dependsOn: [dep.id] });
    ok(TT.openDeps(store, depend).length === 1 && TT.isBlocked(store, depend) === true, "dependent is blocked while its prerequisite is open");
    ok(TT.depRecords(store, depend)[0].id === dep.id, "depRecords resolves the prerequisite record");
    ok(TT.isBlocked(store, dep) === false, "prerequisite itself is not blocked");
    P.markTaskDone(store, dep, true);
    ok(TT.openDeps(store, depend).length === 0 && TT.isBlocked(store, depend) === false, "closing the prerequisite unblocks the dependent");
    store.upsert("task", depend.id, { status: "Blocked", autoBlocked: true });
    P.markTaskDone(store, store.get("task", dep.id), false);
    ok(store.get("task", depend.id).status === "Blocked" && store.get("task", depend.id).autoBlocked === true, "reopening the prerequisite re-blocks dependents (autoBlocked flagged)");
    P.markTaskDone(store, dep, true);
    ok(store.get("task", depend.id).status === "Active" && store.get("task", depend.id).autoBlocked === false, "auto-blocked dependent restores to Active when prerequisites close");

    // 82 ─ time tracking ────────────────────────────────────────────
    const timed = store.create("task", { title: "Timed task", status: "Active" });
    ok(TT.taskTimeMs(timed) === 0, "new task has no tracked time");
    const end = Date.now();
    TT.addTimeEntry(store, timed.id, { start: end - 60000, end });
    ok(TT.taskTimeMs(store.get("task", timed.id)) === 60000, "addTimeEntry contributes its duration");
    TT.logManualTime(store, timed.id, 5);
    ok(TT.taskTimeMs(store.get("task", timed.id)) === 60000 + 5 * 60000, "logManualTime adds minutes");
    TT.startTracking(store, timed.id, "deep work");
    ok(!!store.get("task", timed.id).tracking, "startTracking opens a session");
    await sleep(30);
    const stopped = TT.stopTracking(store, timed.id);
    ok(stopped && stopped.ms >= 20 && !store.get("task", timed.id).tracking, "stopTracking closes the session with elapsed ms");
    ok(TT.timeEntries(store.get("task", timed.id)).length === 2, "two entries after stop (manual + tracked)");
    ok(TT.formatMs(0) === "0m", "formatMs 0");
    ok(TT.formatMs(5000) === "5s", "formatMs seconds");
    ok(TT.formatMs(45000) === "45s", "formatMs seconds");
    ok(TT.formatMs(2700000) === "45m", "formatMs minutes");
    ok(TT.formatMs(8100000) === "2h 15m", "formatMs hours+minutes");
    ok(TT.runningTrackers(store).length === 0, "no running trackers after stopping");

    // 84 ─ todayData ────────────────────────────────────────────────
    const TD = await import("./today.js");
    const eve = store.create("event", { title: "Morning call", date: t, startTime: "09:30", durationMin: 30, color: "#22d3ee" });
    store.create("event", { title: "No time", date: t, startTime: "" });
    const duetask = store.create("task", { title: "Due today", status: "Active", due: t, priority: "high" });
    store.create("task", { title: "Due today low", status: "Active", due: t, priority: "low" });
    store.create("task", { title: "Overdue one", status: "Active", due: addDays(t, -2) });
    store.create("task", { title: "Done today", status: "Done", due: t, completedAt: Date.now() });
    store.create("focuslog", { started: new Date(t + "T10:00:00").getTime(), durationMin: 25, mode: "work" });
    const td = TD.todayData(store, t);
    ok(td.timed.length === 2, "todayData: timed events + focus sessions are both timed");
    ok(td.timed[0].kind === "event" && td.timed[0].t === "09:30", "todayData: timed sorted by time (event 09:30 first)");
    ok(td.timed[1].kind === "focus", "todayData: focus session after the morning event");
    ok(td.anytime.length === 1 && td.anytime[0].rec.title === "No time", "todayData: untimed event goes to anytime");
    ok(td.tasks.length === 2 && td.tasks[0].title === "Due today", "todayData: due tasks sorted by priority (high first), excludes Done");
    ok(td.overdueCount === 1 && td.overdue[0].title === "Overdue one", "todayData: overdue tasks carried in");
    ok(td.focusMinutes === 25 && td.focusCount === 1, "todayData: focus minutes summed");

    // 85 ─ overdueBurnDown + focusHeat ─────────────────────────────
    const PF = await import("./portfolio.js");
    store.create("task", { title: "Burn task", status: "Active", due: addDays(t, -3) });
    store.create("task", { title: "Burn task done", status: "Done", due: addDays(t, -5), completedAt: new Date(t + "T08:00:00").getTime() });
    const burn = PF.overdueBurnDown(store, 14);
    ok(burn.length === 14 && burn[13].day === t, "overdueBurnDown: 14 days ending today");
    ok(burn[12].count === 3, "overdueBurnDown: three overdue tasks count yesterday (including the one completed today)");
    ok(burn[13].count === 2, "overdueBurnDown: only still-open tasks count today (the completed one stops)");
    ok(burn[9].count === 1, "overdueBurnDown: completed task stops counting from its completion day onward");
    store.create("focuslog", { started: new Date(addDays(t, -5) + "T14:00:00").getTime(), durationMin: 40, mode: "work" });
    const heat = PF.focusHeat(store, 14);
    ok(heat.length === 14 && heat[heat.length - 1].day === t, "focusHeat: 14 days ending today");
    ok(heat[8].mins === 40, "focusHeat: focus minutes attributed to their day (today-5)");

    // 83 ─ ganttRows + ganttSpan ────────────────────────────────────
    const G = await import("./gantt.js");
    const gp = store.create("project", { name: "Gantt proj", status: "Active", color: "#8b5cf6", targetDate: addDays(t, 10) });
    const gt1 = store.create("task", { title: "Plan", projectId: gp.id, status: "Active", plannedStart: addDays(t, -2), due: addDays(t, 1) });
    const gt2 = store.create("task", { title: "Build", projectId: gp.id, status: "Active", plannedStart: addDays(t, 1), due: addDays(t, 5), dependsOn: [gt1.id] });
    store.create("task", { title: "Ship", projectId: gp.id, status: "Done", plannedStart: addDays(t, -4), due: addDays(t, -1), completedAt: new Date(t + "T12:00:00").getTime() });
    const gproj = store.get("project", gp.id);
    gproj.milestones = (gproj.milestones || []).concat([{ id: "gm1", name: "Launch", due: addDays(t, 9) }]);
    store.upsert("project", gp.id, gproj);
    const rows = G.ganttRows(store, gp.id);
    ok(rows.length === 4, "ganttRows: 3 tasks + 1 milestone for the project");
    ok(rows.some((r) => r.kind === "milestone" && r.title === "Launch"), "ganttRows: milestone row included");
    const plan = rows.find((r) => r.title === "Plan");
    ok(plan.start === addDays(t, -2) && plan.end === addDays(t, 1), "ganttRows: planned start→due");
    const ship = rows.find((r) => r.title === "Ship");
    ok(ship.done && ship.actualEnd === addDays(t, 0), "ganttRows: completed task gets actualEnd from completedAt");
    const build = rows.find((r) => r.title === "Build");
    ok(build.deps.includes(gt1.id), "ganttRows: dependency ids resolved into the row");
    const span = G.ganttSpan(rows, gproj);
    ok(span.start <= addDays(t, -7) && span.end >= addDays(t, 14), "ganttSpan: spans the padding window");
    ok(span.start <= ship.start, "ganttSpan: starts at or before the earliest row start");
    ok(span.end >= addDays(t, 9), "ganttSpan: reaches at least the milestone date");

    // 86 ─ attachments ─────────────────────────────────────────────
    const AT = await import("./attachments.js");
    const aTask = store.create("task", { title: "Attached task", status: "Active" });
    ok(AT.attachmentsOf(store.get("task", aTask.id)).length === 0, "attachmentsOf: none initially");
    const att = AT.attachData(store, "task", aTask.id, { name: "design.png", mime: "image/png", size: 2048, dataUrl: "data:image/png;base64,AAAA" });
    ok(!!att && att.name === "design.png" && att.mime === "image/png", "attachData returns the new attachment entry");
    ok(AT.attachmentsOf(store.get("task", aTask.id)).length === 1 && AT.attachmentsOf(store.get("task", aTask.id))[0].size === 2048, "attachData persisted the attachment on the record");
    ok(AT.isImage("image/png") === true && AT.isImage("image/jpeg") === true && AT.isImage("image/svg+xml") === true, "isImage: png/jpeg/svg true");
    ok(AT.isImage("application/pdf") === false, "isImage: pdf false");
    ok(AT.fileSizeLabel(900) === "900 B", "fileSizeLabel: bytes");
    ok(AT.fileSizeLabel(2048) === "2.0 KB", "fileSizeLabel: KB with one decimal under 10KB");
    ok(AT.fileSizeLabel(1048576) === "1.0 MB", "fileSizeLabel: MB");
    ok(AT.attachmentHTML(att).includes("design.png") && AT.attachmentHTML(att).includes("data:image/png"), "attachmentHTML renders name + data URL");
    ok(AT.removeAttachment(store, "task", aTask.id, att.id) === true, "removeAttachment returns true");
    ok(AT.attachmentsOf(store.get("task", aTask.id)).length === 0, "removeAttachment removed it");
    ok(AT.removeAttachment(store, "task", aTask.id, "nope") === true, "removeAttachment is a no-op for a missing id");

    // 87 ─ tags ─────────────────────────────────────────────────────
    const T = await import("./tags.js");
    store.create("task", { title: "Tagged task", status: "Active", tags: ["Design", "urgent"] });
    store.create("note", { title: "Tagged note", tags: ["design", "research"] });
    const tags = T.allTags(store);
    ok(tags.length === 3, "allTags: counts distinct normalized tags (design, urgent, research)");
    const design = tags.find((x) => x.tag === "design");
    ok(design && design.count === 2, "allTags: case-insensitive merge (Design + design = 2)");
    ok(design && design.color === null, "allTags: no color until assigned");
    ok(design && design.count === 2 && tags.find((x) => x.tag === "urgent").count === 1, "allTags: counts per tag");
    T.setTagColor(store, "design", "#22d3ee");
    ok(T.tagColor(store, "Design") === "#22d3ee", "setTagColor + tagColor: stored normalized, read case-insensitively");
    ok(T.allTags(store).find((x) => x.tag === "design").color === "#22d3ee", "allTags: color surfaces after setTagColor");
    const taggedTask = store.all("task").find((x) => x.title === "Tagged task");
    const touched = T.renameTag(store, "urgent", "design");
    ok(touched === 1, "renameTag: touches the one record that used the tag");
    const ttTags = store.get("task", taggedTask.id).tags.map((x) => x.toLowerCase());
    ok(ttTags.includes("design") && !ttTags.includes("urgent"), "renameTag: merged into the target tag");
    ok(T.allTags(store).length === 2, "renameTag: merging removed the old tag");
    const touched2 = T.removeTag(store, "research");
    ok(touched2 === 1, "removeTag: touches the note that used it");
    ok(T.allTags(store).find((x) => x.tag === "research") === undefined, "removeTag: tag gone from allTags");
    ok(T.allTags(store).length === 1, "removeTag: only the merged design tag remains");

    // 88 ─ backup / snapshots ──────────────────────────────────────
    const B = await import("./backup.js");
    const bstore = new Store({ kv: root.kv, folder: folder + "_b", debounceMs: 5 });
    await bstore.load();
    bstore.create("task", { title: "Backup task", status: "Active" });
    bstore.create("project", { name: "Backup proj", status: "Active", color: "#8b5cf6" });
    await bstore.save();
    const snap = await B.takeSnapshot(bstore);
    ok(!!snap && snap.count === 2, "takeSnapshot: returns key + record count");
    const snaps = await B.listSnapshots(bstore);
    ok(snaps.length === 1 && snaps[0].key === snap.key && snaps[0].count === 2, "listSnapshots: newest first, count parsed");
    ok(snaps[0].ms > Date.now() - 60000 && snaps[0].ms <= Date.now(), "listSnapshots: ms parsed from exportedAt (recent, not epoch)");
    ok(B.snapshotKey(1234567890000).startsWith("snap-"), "snapshotKey has snap- prefix");
    bstore.create("note", { title: "After snapshot", body: "extra" });
    await bstore.save();
    ok(await B.restoreSnapshot(bstore, snap.key) === true, "restoreSnapshot returns true for a known key");
    ok(bstore.all("note").length === 0 && bstore.all("task").length === 1 && bstore.all("project").length === 1, "restoreSnapshot: rolls back to the snapshot's records");
    for (let i = 0; i < 32; i++) await B.takeSnapshot(bstore);
    const many = await B.listSnapshots(bstore);
    ok(many.length <= 30, "takeSnapshot prunes to MAX_SNAPSHOTS (30)");
    await B.deleteSnapshot(bstore, many[0].key);
    ok((await B.listSnapshots(bstore)).length === many.length - 1, "deleteSnapshot removes a snapshot");
    for (const [k] of await bstore.kvFolder.entries()) await bstore.kvFolder.delete(k);

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}


export async function runPhase10Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const A = await import("./assistant.js");
  const folder = "pm_test_p10_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  try {
    await store.load();
    const t = todayLocal();
    store.create("project", { name: "Website", status: "Active", color: "#8b5cf6" });
    const p2 = store.create("project", { name: "Podcast", status: "Active", color: "#22d3ee" });
    const p1 = store.all("project").find((p) => p.name === "Website");
    store.create("task", { title: "Fix the hero", projectId: p1.id, due: addDays(t, -1), priority: "high", status: "todo", tags: ["design"] });
    store.create("task", { title: "Write intro", projectId: p1.id, due: t, priority: "medium", status: "todo" });
    store.create("task", { title: "Record episode", projectId: p2.id, due: addDays(t, 3), priority: "low", status: "todo" });
    store.create("task", { title: "Done task", status: "Done", completedAt: Date.now() });
    store.create("event", { title: "Standup", date: t, startTime: "09:15", color: "#8b5cf6" });
    const hb = store.create("habit", { name: "Run", history: {} });
    hb.history[t] = true;
    store.upsert("habit", hb.id, { history: hb.history });
    store.create("focuslog", { started: Date.now(), durationMin: 25, mode: "work" });

    const snap = A.buildSnapshot(store);
    ok(snap.includes("Website") && snap.includes("Podcast"), "snapshot lists project names");
    ok(snap.includes("Fix the hero") && snap.includes("Write intro"), "snapshot lists open task titles");
    ok(snap.includes("overdue"), "snapshot flags overdue tasks");
    ok(snap.includes("Standup"), "snapshot lists today's events");
    ok(snap.includes("Run") && snap.includes("done today"), "snapshot shows habits + today's check-in");
    ok(snap.includes("25 minutes logged"), "snapshot sums focus minutes");
    ok(snap.includes("Completed today: 1"), "snapshot counts completed-today");
    ok(!snap.includes("Done task"), "snapshot excludes completed tasks from the open list");

    ok(A.QUICK_ACTION_LIST.length === 6, "six quick actions offered");
    for (const [k] of [["today"], ["review"], ["overdue"], ["focus"], ["plan"], ["wins"]]) ok(A.quickActionTask(k) && A.quickActionLabel(k), "quick action '" + k + "' has a task + label");
    ok(A.quickActionTask("nope") === null, "unknown quick action returns null");

    ok(JSON.stringify(A.parsePlan("1. Draft outline\n- 2. Record audio\n3) Edit the episode\n\nHere are some extra words")) === JSON.stringify(["Draft outline", "Record audio", "Edit the episode"]), "parsePlan strips bullets/numbers/short headings");
    ok(A.parsePlan("1. Only one step").length === 1, "parsePlan handles a single step");
    ok(A.parsePlan("").length === 0, "parsePlan empty input");

    ok(typeof A.assistantViewHTML === "function", "assistantViewHTML exists");
    ok(typeof A.wireAssistantView === "function", "wireAssistantView exists");
    const html = A.assistantViewHTML();
    ok(html.includes("as-msgs") && html.includes("as-input"), "assistant view has messages area + input");
    ok(html.includes("Break down a goal"), "assistant view offers goal breakdown");

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

// ── Phase 12 tests: exports (89), weekly report (90), quick capture (91) ──
export async function runPhase12Tests() {
  const results = [];
  const ok = (cond, name, extra) => results.push({ ok: !!cond, name, extra });
  const X = await import("./exports.js");
  const R = await import("./report.js");
  const Q = await import("./quickcapture.js");
  const D = await import("./dates.js");
  const folder = "pm_test_p12_" + Math.random().toString(36).slice(2, 9);
  const store = new Store({ kv: root.kv, folder, debounceMs: 5 });
  try {
    await store.load();
    const t = todayLocal();
    const proj = store.create("project", { name: "Website, v2", status: "Active", color: "#8b5cf6" });
    proj.milestones = [{ id: "m1", name: "Launch" }];
    store.upsert("project", proj.id, proj);

    // 89 ─ exports ────────────────────────────────────────────────
    store.create("task", { title: "Ship, it!", projectId: proj.id, status: "Active", priority: "high", due: addDays(t, 1), tags: ["ship", "v2"], milestoneId: "m1", notes: "quote \" here, comma, and\nnewline" });
    store.create("task", { title: "Done task", projectId: proj.id, status: "Done", due: t, completedAt: Date.now() });
    store.create("event", { title: "Standup, weekly", date: t, startTime: "09:00", endTime: "09:15", color: "#22d3ee", notes: "Sprint, review" });
    store.create("note", { title: "Ideas, part 1", body: "Some body\nwith lines", pinned: true, tags: ["idea"] });
    store.create("note", { title: "Second note", body: "", tags: [] });
    store.create("checklist", { name: "Launch prep", items: [{ id: "i1", text: "Do a thing", done: false }, { id: "i2", text: "Another, thing", done: true }] });

    const csv = X.tasksToCSV(store);
    ok(csv.startsWith("title,project,status,priority,due,tags,milestone,dependsOn,notes,created,updated,completedAt"), "tasksToCSV: header row");
    ok(csv.includes('"Ship, it!"') && csv.includes("Website, v2") && csv.includes("Launch"), "tasksToCSV: CSV-escapes commas + resolves project + milestone");
    ok(csv.includes('"quote "" here, comma, and\nnewline"'), "tasksToCSV: escapes quotes + newlines in notes");
    const evCsv = X.eventsToCSV(store);
    ok(evCsv.startsWith("title,date,startTime,endTime,color,notes"), "eventsToCSV: header row");
    ok(evCsv.includes('"Standup, weekly"') && evCsv.includes("Sprint, review"), "eventsToCSV: escapes title + notes commas");

    const md = X.notesToMD(store);
    ok(md.startsWith("# Project Master — Notes export"), "notesToMD: title line");
    ok(md.includes("## Ideas, part 1") && md.includes("Some body") && md.includes("_pinned"), "notesToMD: note section with pinned marker + body");
    const cm = X.checklistsToMD(store);
    ok(cm.includes("## Launch prep (1/2 done)") && cm.includes("- [ ] Do a thing") && cm.includes("- [x] Another, thing"), "checklistsToMD: counts + checkbox syntax");

    const ics = X.icsCalendar(store);
    ok(ics.startsWith("BEGIN:VCALENDAR") && ics.trimEnd().endsWith("END:VCALENDAR"), "ics: calendar wrapper");
    ok(ics.includes("BEGIN:VEVENT") && ics.includes("DTSTART:") && ics.includes("SUMMARY:Standup\\, weekly"), "ics: VEVENT for the event with escaped summary");
    ok(ics.includes("BEGIN:VTODO") && ics.includes("DUE;VALUE=DATE:") && ics.includes("STATUS:COMPLETED"), "ics: VTODO for dated tasks, completed status");
    ok(ics.includes("\r\n"), "ics: CRLF line endings");
    const uidLine = ics.split("\r\n").find((l) => l.startsWith("UID:pm-event-"));
    ok(!!uidLine && uidLine.endsWith("@project-master"), "ics: UIDs are stable + namespaced");

    // 90 ─ weekly report ──────────────────────────────────────────
    const range = R.weekRange(t);
    ok(range.start === addDays(t, -6) && range.end === t, "weekRange: 7-day window ending today");
    store.create("task", { title: "Done this week", projectId: proj.id, status: "Done", priority: "high", completedAt: new Date(t + "T09:00:00").getTime() });
    store.create("task", { title: "Overdue task", projectId: proj.id, status: "Active", due: addDays(t, -1) });
    store.create("task", { title: "Old done", status: "Done", completedAt: new Date(addDays(t, -10) + "T09:00:00").getTime() });
    const hb = store.create("habit", { name: "Run", history: {} });
    hb.history[t] = true; hb.history[addDays(t, -1)] = true;
    store.upsert("habit", hb.id, { history: hb.history });
    store.create("focuslog", { started: Date.now(), durationMin: 25, mode: "work" });
    const snap = R.buildReportSnapshot(store);
    ok(snap.includes("Report window: " + range.start) && snap.includes("7 days"), "report snapshot: window header");
    ok(snap.includes("2 completed this week") && snap.includes("Done this week") && !snap.includes("Old done"), "report snapshot: counts only in-window completions");
    ok(snap.includes("1 overdue right now") && snap.includes("Overdue task"), "report snapshot: overdue count + name");
    ok(snap.includes("Website, v2 [Active]"), "report snapshot: project line");
    ok(snap.includes("Focus: 1 work session, 25 minutes this week"), "report snapshot: focus minutes");
    ok(snap.includes("Run — streak 2, 2 total") && snap.includes("done today"), "report snapshot: habit streak");
    const prompt = R.buildReportPrompt(store);
    ok(prompt.includes("weekly report") && prompt.includes("<DATA>") && prompt.includes("TASK: Write the weekly report."), "report prompt: persona + data + task at the end");

    // 91 ─ quick capture ──────────────────────────────────────────
    ok(Q.parseDateWord("today", t) === t, "parseDateWord: today");
    ok(Q.parseDateWord("tomorrow", t) === addDays(t, 1), "parseDateWord: tomorrow");
    ok(Q.parseDateWord("in 3d", t) === addDays(t, 3) && Q.parseDateWord("in 2 days", t) === addDays(t, 2), "parseDateWord: in Nd / in N days");
    ok(Q.parseDateWord(addDays(t, 5), t) === addDays(t, 5), "parseDateWord: raw ISO day");
    const nm = Q.parseDateWord("next monday", t);
    ok(!!nm && D.dayDiff(t, nm) >= 1 && D.dayDiff(t, nm) <= 7 && D.parseIso(nm).getDay() === 1, "parseDateWord: next monday is the coming Monday");
    ok(Q.parseDateWord("banana", t) === null, "parseDateWord: unknown word is null");

    const d1 = Q.parseQuickInput("pay rent tomorrow @home p:high #bills");
    ok(d1 && d1.type === "task" && d1.title === "pay rent" && d1.project === "home" && d1.priority === "high" && d1.due === addDays(t, 1) && JSON.stringify(d1.tags) === JSON.stringify(["bills"]), "parseQuickInput: task with project/tags/priority/due");
    const d2 = Q.parseQuickInput("n: idea for the landing page #ideas");
    ok(d2 && d2.type === "note" && d2.title === "idea for the landing page" && JSON.stringify(d2.tags) === JSON.stringify(["ideas"]), "parseQuickInput: note prefix");
    const d3 = Q.parseQuickInput("e: dentist 09:30 tomorrow");
    ok(d3 && d3.type === "event" && d3.title === "dentist" && d3.startTime === "09:30" && d3.date === addDays(t, 1), "parseQuickInput: event with time + date");
    const d4 = Q.parseQuickInput("t: buy milk");
    ok(d4 && d4.type === "task" && d4.title === "buy milk", "parseQuickInput: explicit task prefix");
    ok(Q.parseQuickInput("   ") === null && Q.parseQuickInput("") === null, "parseQuickInput: empty input is null");
    const d5 = Q.parseQuickInput("!high pay invoice");
    ok(d5 && d5.priority === "high" && d5.title === "pay invoice", "parseQuickInput: leading !priority");

    const qc = new Store({ kv: root.kv, folder: folder + "_qc", debounceMs: 5 });
    await qc.load();
    qc.create("project", { name: "Home", status: "Active", color: "#22d3ee" });
    const c1 = Q.commitQuickCapture(qc, Q.parseQuickInput("pay rent tomorrow @home p:high #bills"));
    ok(c1 && c1.type === "task" && c1.title === "pay rent" && c1.due === addDays(t, 1) && c1.priority === "high" && qc.get("project", c1.projectId).name === "Home", "commitQuickCapture: task created with resolved project");
    const c2 = Q.commitQuickCapture(qc, Q.parseQuickInput("n: quick idea"));
    ok(c2 && c2.type === "note" && c2.title === "quick idea", "commitQuickCapture: note created");
    const c3 = Q.commitQuickCapture(qc, Q.parseQuickInput("e: dentist 09:30 tomorrow"));
    ok(c3 && c3.type === "event" && c3.date === addDays(t, 1) && c3.startTime === "09:30", "commitQuickCapture: event created");
    for (const [k] of await qc.kvFolder.entries()) await qc.kvFolder.delete(k);

    await store.save();
    for (const [k] of await store.kvFolder.entries()) await store.kvFolder.delete(k);
  } catch (e) {
    ok(false, "test run threw: " + e.message, e.stack);
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, folder };
}

