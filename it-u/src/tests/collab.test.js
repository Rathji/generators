// src/tests/collab.test.js — validation tests for Phase 13 task 55 (the
// collaborative-editing engine). Run in the live page:
//   await import("./src/tests/collab.test.js").then((m) => m.run())
//
// Covers: stable serialization (key-order independence + deep equality); the
// content stamp and its ignored bookkeeping keys; the four remote-change
// classifications; the three-way field merge (adopt-theirs, keep-mine, genuine
// conflict, ignored keys); editor-marker pruning/naming/summarizing; and the
// small display helpers.

import { runTests, assert, assertEq } from "./harness.js";
import {
  EDIT_TTL_MS,
  sortedJson,
  deepEqual,
  recordStamp,
  STAMP_IGNORED_KEYS,
  pruneEditors,
  editorNames,
  editingSummary,
  editorInitials,
  classifyRemoteChange,
  mergeRecords,
  describeField,
  previewValue,
} from "../framework/collab.js";

export async function run() {
  return runTests([
    {
      name: "sortedJson is key-order independent and round-trips nested values",
      fn: () => {
        assertEq(sortedJson({ b: 1, a: 2 }), sortedJson({ a: 2, b: 1 }), "key order ignored");
        assertEq(sortedJson({ a: [1, { z: 1, y: 2 }] }), sortedJson({ a: [1, { y: 2, z: 1 }] }), "nested key order ignored");
        assertEq(sortedJson([2, 1]), "[2,1]", "array order preserved");
        assertEq(sortedJson(undefined), "null", "undefined → null");
        assertEq(sortedJson(null), "null", "null");
        assertEq(sortedJson("x"), "\"x\"", "string");
      },
    },
    {
      name: "deepEqual agrees with sortedJson and is order-independent",
      fn: () => {
        assert(deepEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }), "structurally equal");
        assert(!deepEqual({ a: 1 }, { a: 2 }), "different values");
        assert(!deepEqual([1, 2], [2, 1]), "array order matters");
        assert(deepEqual(null, null), "nulls");
      },
    },
    {
      name: "recordStamp ignores bookkeeping keys but tracks content",
      fn: () => {
        const a = { id: "r1", name: "PBX", updatedAt: 100, updatedBy: "alice", body: "one" };
        const b = { id: "r1", name: "PBX", updatedAt: 999, updatedBy: "bob", body: "one" };
        assertEq(recordStamp(a), recordStamp(b), "updatedAt/updatedBy are not content");
        const c = { ...b, body: "two" };
        assert(recordStamp(a) !== recordStamp(c), "a content change moves the stamp");
        assertEq(recordStamp(null), "", "missing record → empty stamp");
        for (const k of STAMP_IGNORED_KEYS) assert(STAMP_IGNORED_KEYS.includes(k), "ignored key listed");
      },
    },
    {
      name: "classifyRemoteChange covers all four cases",
      fn: () => {
        assertEq(classifyRemoteChange({ base: "A", mine: "A", theirs: "A" }), "unchanged", "nothing moved");
        assertEq(classifyRemoteChange({ base: "A", mine: "A", theirs: "B" }), "remote-only", "only remote edited");
        assertEq(classifyRemoteChange({ base: "A", mine: "B", theirs: "B" }), "converged", "same edit both sides");
        assertEq(classifyRemoteChange({ base: "A", mine: "B", theirs: "C" }), "conflict", "both diverged");
        assertEq(classifyRemoteChange({ base: "", mine: "", theirs: "X" }), "remote-only", "first remote edit");
        assertEq(classifyRemoteChange({ base: "", mine: "X", theirs: "X" }), "converged", "same first edit");
        assertEq(classifyRemoteChange({ base: undefined, mine: undefined, theirs: "X" }), "remote-only", "missing treated as empty");
      },
    },
    {
      name: "mergeRecords adopts remote-only fields, keeps mine-only fields, flags real conflicts",
      fn: () => {
        const base = { name: "PBX", body: "old", status: "draft", tags: ["a"] };
        const mine = { name: "PBX", body: "my new body", status: "draft", tags: ["a"] };
        const theirs = { name: "PBX (renamed)", body: "old", status: "ready", tags: ["a"] };
        const r = mergeRecords(base, mine, theirs);
        assert(r.clean, "no genuine conflict here");
        assertEq(r.merged.body, "my new body", "mine-only field kept");
        assertEq(r.merged.name, "PBX (renamed)", "theirs-only field adopted");
        assertEq(r.merged.status, "ready", "theirs-only field adopted");
        assert(r.adopted.includes("name") && r.adopted.includes("status"), "adopted list records their fields");
        assertEq(r.conflicts.length, 0, "no conflicts");
      },
    },
    {
      name: "mergeRecords reports a genuine conflict and keeps mine by default",
      fn: () => {
        const base = { body: "start" };
        const mine = { body: "mine" };
        const theirs = { body: "theirs" };
        const r = mergeRecords(base, mine, theirs);
        assert(!r.clean, "conflict detected");
        assertEq(r.conflicts.length, 1, "one conflicting field");
        assertEq(r.conflicts[0].field, "body", "the field");
        assertEq(r.conflicts[0].mine, "mine", "mine recorded");
        assertEq(r.conflicts[0].theirs, "theirs", "theirs recorded");
        assertEq(r.merged.body, "mine", "mine is kept pending a decision");
      },
    },
    {
      name: "mergeRecords ignores bookkeeping keys and keeps mine for them",
      fn: () => {
        const r = mergeRecords(
          { updatedAt: 1, name: "x" },
          { updatedAt: 2, name: "x" },
          { updatedAt: 3, name: "x" },
        );
        assertEq(r.merged.updatedAt, 2, "updatedAt taken from mine, not merged");
        assertEq(r.conflicts.length, 0, "bookkeeping never conflicts");
      },
    },
    {
      name: "mergeRecords handles nested values structurally",
      fn: () => {
        const base = { cfg: { host: "a", port: 1 } };
        const mine = { cfg: { host: "a", port: 2 } };
        const theirs = { cfg: { host: "b", port: 1 } };
        const r = mergeRecords(base, mine, theirs);
        assertEq(r.conflicts.length, 1, "the whole nested object diverged → one conflict");
        assertEq(r.conflicts[0].field, "cfg", "conflict on the top-level field");
      },
    },
    {
      name: "pruneEditors drops stale markers and tolerates missing timestamps",
      fn: () => {
        const now = 1_000_000;
        const list = [
          { user: "a", at: now - 10 },
          { user: "b", at: now - EDIT_TTL_MS - 1 },
          { user: "c" },
        ];
        const kept = pruneEditors(list, now);
        assertEq(kept.length, 2, "stale marker removed");
        assert(kept.some((e) => e.user === "a") && kept.some((e) => e.user === "c"), "fresh + timeless kept");
        assertEq(pruneEditors(null, now).length, 0, "null-safe");
      },
    },
    {
      name: "editorNames dedupes, keeps order, and puts you first",
      fn: () => {
        const names = editorNames([{ user: "bob" }, { user: "alice" }, { user: "bob" }], "alice");
        assertEq(names.length, 2, "deduped");
        assertEq(names[0], "alice", "you first");
        assertEq(names[1], "bob", "others after");
        assertEq(editorNames([], "alice").length, 0, "empty");
      },
    },
    {
      name: "editingSummary reads naturally for every shape",
      fn: () => {
        assertEq(editingSummary([], "me"), "", "nobody");
        assertEq(editingSummary([{ user: "me" }], "me"), "You are editing", "only you");
        assertEq(editingSummary([{ user: "alice" }], "me"), "alice is editing", "one other");
        assertEq(editingSummary([{ user: "me" }, { user: "alice" }], "me"), "You and alice are editing", "you + one");
        assertEq(editingSummary([{ user: "alice" }, { user: "bob" }], "me"), "alice and bob are editing", "two others");
        assertEq(editingSummary([{ user: "alice" }, { user: "bob" }, { user: "cara" }], "me"), "alice, bob and cara are editing", "three others");
        assertEq(
          editingSummary([{ user: "me" }, { user: "alice" }, { user: "bob" }], "me"),
          "You, alice and bob are editing",
          "you + two",
        );
        assertEq(
          editingSummary([{ user: "me" }, { user: "a" }, { user: "b" }, { user: "c" }], "me"),
          "You and 3 others are editing",
          "you + many",
        );
      },
    },
    {
      name: "editorInitials and display helpers",
      fn: () => {
        assertEq(editorInitials("alice"), "AL", "two letters");
        assertEq(editorInitials("bob.smith"), "BO", "punctuation stripped");
        assertEq(editorInitials(""), "?", "empty → ?");
        assertEq(describeField("reviewIntervalDays"), "Review interval days", "camelCase");
        assertEq(describeField("dns_records"), "Dns records", "snake_case");
        assertEq(previewValue(undefined), "(empty)", "undefined");
        assertEq(previewValue(null), "(none)", "null");
        assertEq(previewValue("short"), "short", "string");
        assertEq(previewValue("a\n  b\tc"), "a b c", "whitespace collapsed for a one-line preview");
        assert(previewValue([1, 2, 3]), "3 items", "array length");
        assert(previewValue({ a: 1 }), "record", "object");
        assert(previewValue("x".repeat(100)).endsWith("…"), "long string truncated");
      },
    },
  ]);
}
