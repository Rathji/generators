// ============================================================================
//  Validation tests — shared utility library (Phase 1, task 4)
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import * as U from "../framework/utils.js";

export function utilsSuite() {
  return createSuite("utils · shared library")
    .test("escapeHtml neutralises markup", () => {
      assertEqual(U.escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      assertEqual(U.escapeHtml(null), "");
    })
    .test("titleCase / slugify / truncate", () => {
      assertEqual(U.titleCase("monthly_retainer"), "Monthly Retainer");
      assertEqual(U.titleCase("camelCase"), "Camel Case");
      assertEqual(U.slugify("Riverbend Bakery & Café"), "riverbend-bakery-cafe");
      assertEqual(U.truncate("abcdefghij", 6), "abcde…");
      assertEqual(U.truncate("short", 10), "short");
    })
    .test("pluralize / clamp", () => {
      assertEqual(U.pluralize(1, "invoice"), "invoice");
      assertEqual(U.pluralize(2, "invoice"), "invoices");
      assertEqual(U.clamp(15, 0, 10), 10);
      assertEqual(U.clamp(-3, 0, 10), 0);
    })
    .test("number + currency + bytes formatting", () => {
      assertEqual(U.formatNumber(1234567), "1,234,567");
      assertEqual(U.formatCurrency(1250), "$1,250.00");
      assertEqual(U.formatBytes(0), "0 B");
      assertEqual(U.formatBytes(1024), "1 KB");
      assertEqual(U.formatBytes(1536), "1.5 KB");
    })
    .test("relative time formatting", () => {
      const now = Date.UTC(2026, 0, 1, 12, 0, 0);
      assertEqual(U.formatRelativeTime(now - 2 * 3600000, now), "2 hours ago");
      assertEqual(U.formatRelativeTime(now - 86400000, now), "yesterday");
    })
    .test("debounce collapses calls", async () => {
      let calls = 0;
      const fn = U.debounce(() => calls++, 10);
      fn();
      fn();
      fn();
      await new Promise((r) => setTimeout(r, 30));
      assertEqual(calls, 1);
    })
    .test("deepMerge / deepClone / pick / omit", () => {
      assertDeepEqual(U.deepMerge({ a: 1, b: { c: 2 } }, { b: { d: 3 } }), { a: 1, b: { c: 2, d: 3 } });
      const source = { a: { b: 1 } };
      const clone = U.deepClone(source);
      clone.a.b = 9;
      assertEqual(source.a.b, 1);
      assertDeepEqual(U.pick({ a: 1, b: 2 }, ["a"]), { a: 1 });
      assertDeepEqual(U.omit({ a: 1, b: 2 }, ["a"]), { b: 2 });
    })
    .test("collection helpers", () => {
      const items = [
        { name: "b", amount: 10 },
        { name: "a", amount: 30 },
        { name: "a", amount: 5 },
      ];
      assertEqual(U.unique(items, (i) => i.name).length, 2);
      assertEqual(U.groupBy(items, "name").get("a").length, 2);
      assertEqual(U.sortBy(items, "name")[0].name, "a");
      assertEqual(U.sum(items, (i) => i.amount), 45);
      assertEqual(U.average([2, 4, 6]), 4);
    })
    .test("query + misc helpers", () => {
      assertDeepEqual(U.parseQuery("?a=1&b=two"), { a: "1", b: "two" });
      assertEqual(U.buildQuery({ a: 1, b: "" }), "a=1");
      assertEqual(U.initials("Riverbend Bakery"), "RB");
      assertEqual(U.cx("a", false, ["b", null], { c: true, d: false }), "a b c");
      assert(U.uid("x").startsWith("x-"));
    });
}
