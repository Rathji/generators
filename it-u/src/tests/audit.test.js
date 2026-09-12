// src/tests/audit.test.js — validation tests for Phase 13 task 56 (multi-user
// audit & rate control). Run in the live page:
//   await import("./src/tests/audit.test.js").then((m) => m.run())
//
// Covers: the audit-action classification (fixed actions, the "action:<id>" /
// "denied:<id>" forms resolved through the IT-U action catalog, and unknown
// actions); the human sentence builder; the run summary; the group/actor/query
// filters; and the rate-snapshot summary (group and network roll-ups). Also
// guards against drift between the audit labels and ./roles.js ACTIONS.

import { runTests, assert, assertEq } from "./harness.js";
import { ACTIONS } from "../framework/roles.js";
import {
  AUDIT_ACTIONS,
  AUDIT_GROUPS,
  classifyAudit,
  actionLabel,
  describeAudit,
  summarizeAudit,
  filterAudit,
  networkLabel,
  rateSummary,
  rateLabel,
} from "../framework/audit.js";

export async function run() {
  return runTests([
    {
      name: "classifyAudit maps the fixed server actions to group + tone",
      fn: () => {
        const reg = classifyAudit("register");
        assertEq(reg.group, "account", "register is an account event");
        assertEq(reg.tone, "info", "register is informational");
        assertEq(reg.label, "Registered", "register label");
        assertEq(classifyAudit("grant-role").group, "access", "grant-role is access");
        assertEq(classifyAudit("grant-role").tone, "ok", "grant is positive");
        assertEq(classifyAudit("ban").tone, "danger", "ban is a danger action");
        assertEq(classifyAudit("announce").group, "change", "announce is a change event");
      },
    },
    {
      name: "classifyAudit resolves action:<id> and denied:<id> through the IT-U catalog",
      fn: () => {
        const edit = classifyAudit("action:edit");
        assertEq(edit.kind, "action", "action kind");
        assertEq(edit.group, "action", "action group");
        assertEq(edit.label, "Edit", "edit label from roles.js");
        assertEq(classifyAudit("action:manageGroups").label, "Manage groups", "camelCase action label");
        const denied = classifyAudit("denied:delete");
        assertEq(denied.kind, "denied", "denied kind");
        assertEq(denied.group, "denied", "denied group");
        assertEq(denied.tone, "danger", "denied tone");
        assertEq(denied.label, "Delete", "denied label");
      },
    },
    {
      name: "classifyAudit tolerates unknown and empty actions",
      fn: () => {
        assertEq(classifyAudit("").group, "action", "empty degrades to action");
        assertEq(classifyAudit(undefined).label, "Activity", "undefined label");
        const odd = classifyAudit("something-new");
        assertEq(odd.group, "action", "unknown group");
        assertEq(odd.kind, "action", "unknown kind");
      },
    },
    {
      name: "actionLabel uses the catalog and falls back to title case",
      fn: () => {
        assertEq(actionLabel("edit"), "Edit", "catalog label");
        assertEq(actionLabel("rotateCredential"), "Rotate a credential", "catalog camelCase");
        assertEq(actionLabel("foo-bar"), "Foo bar", "kebab fallback");
        assertEq(actionLabel(""), "Activity", "empty fallback");
      },
    },
    {
      name: "describeAudit builds a readable sentence for each event shape",
      fn: () => {
        assertEq(describeAudit({ action: "login", actor: "alice" }), "alice signed in", "login");
        assertEq(
          describeAudit({ action: "grant-role", actor: "alice", scope: "client:acme", target: "bob" }),
          "alice granted a role to “bob” at client:acme",
          "grant with target + scope",
        );
        assertEq(describeAudit({ action: "ban", actor: "alice", target: "bob" }), "alice disabled “bob”", "ban with target");
        assertEq(
          describeAudit({ action: "announce", actor: "bob", scope: "client:acme", target: "docset-acme" }),
          "bob published a change to “docset-acme” at client:acme",
          "announce",
        );
        assertEq(describeAudit({ action: "denied:delete", actor: "carol", target: "run_1" }), "carol was denied delete “run_1”", "denied");
        assertEq(describeAudit({ action: "action:edit", actor: "carol", target: "run_1" }), "carol edit “run_1”", "action");
        assertEq(describeAudit(null), "", "null-safe");
      },
    },
    {
      name: "summarizeAudit counts groups, denials and actors",
      fn: () => {
        const recs = [
          { action: "login", actor: "a" },
          { action: "login", actor: "a" },
          { action: "announce", actor: "b" },
          { action: "action:edit", actor: "b" },
          { action: "denied:delete", actor: "c" },
          { action: "grant-role", actor: "a" },
        ];
        const s = summarizeAudit(recs);
        assertEq(s.total, 6, "total");
        assertEq(s.byGroup.account, 2, "accounts");
        assertEq(s.byGroup.change, 1, "changes");
        assertEq(s.byGroup.action, 1, "actions");
        assertEq(s.byGroup.denied, 1, "denied");
        assertEq(s.byGroup.access, 1, "access");
        assertEq(s.denied, 1, "denied total");
        assertEq(s.topActors[0].actor, "a", "busiest actor");
        assertEq(s.topActors[0].count, 3, "busiest count");
        assertEq(summarizeAudit([]).total, 0, "empty");
      },
    },
    {
      name: "filterAudit narrows by group, actor and free-text query",
      fn: () => {
        const recs = [
          { action: "login", actor: "a", target: "", scope: "" },
          { action: "grant-role", actor: "alice", target: "bob", scope: "client:acme" },
          { action: "denied:delete", actor: "carol", target: "run_1", scope: "client:acme" },
          { action: "announce", actor: "carol", target: "docset-acme", scope: "client:acme" },
        ];
        assertEq(filterAudit(recs, { group: "denied" }).length, 1, "group filter");
        assertEq(filterAudit(recs, { actor: "carol" }).length, 2, "actor filter");
        assertEq(filterAudit(recs, { query: "run_1" }).length, 1, "query on target");
        assertEq(filterAudit(recs, { query: "acme" }).length, 3, "query on scope");
        assertEq(filterAudit(recs, { group: "access", query: "bob" }).length, 1, "combined filters");
        assertEq(filterAudit(recs, { query: "nothing-here" }).length, 0, "no matches");
      },
    },
    {
      name: "networkLabel shortens the coarse group and defaults to local",
      fn: () => {
        assertEq(networkLabel("8f2a1c99ffff"), "net 8f2a1c99", "truncated to 8");
        assertEq(networkLabel(""), "net local", "empty → local");
        assertEq(networkLabel(null), "net local", "null → local");
      },
    },
    {
      name: "rateSummary rolls up buckets by activity and by network",
      fn: () => {
        const r = rateSummary({
          buckets: 3,
          events: 9,
          byPrefix: { login: 4, ann: 5 },
          byNetwork: { "8f2a1c": 7 },
          openNetworks: { "8f2a1c": 2, abcdef01: 1 },
        });
        assertEq(r.buckets, 3, "buckets");
        assertEq(r.events, 9, "events");
        assertEq(r.groups[0].prefix, "ann", "busiest activity first");
        assertEq(r.groups[0].label, "Change broadcasts", "activity label");
        assertEq(r.byNetwork[0].label, "net 8f2a1c", "network label");
        assertEq(r.openNetworks[0].connections, 2, "busiest network first");
        assertEq(r.topNetwork.net, "8f2a1c", "top network");
        assertEq(rateLabel("zzz"), "zzz", "unknown prefix passthrough");
        assertEq(rateSummary(null).buckets, 0, "null-safe");
      },
    },
    {
      name: "the audit catalog and labels do not drift from ./roles.js ACTIONS",
      fn: () => {
        for (const a of ACTIONS) {
          const c = classifyAudit("action:" + a.id);
          assertEq(c.label, a.label, "label for action:" + a.id);
        }
        const ids = AUDIT_ACTIONS.map((a) => a.id);
        assertEq(new Set(ids).size, ids.length, "fixed action ids are unique");
        for (const a of AUDIT_ACTIONS) assert(a.label && a.group && a.tone, "action is fully described: " + a.id);
        const groups = AUDIT_GROUPS.map((g) => g.id);
        for (const g of ["all", "change", "action", "denied", "access", "account"]) assert(groups.includes(g), "group present: " + g);
      },
    },
  ]);
}
