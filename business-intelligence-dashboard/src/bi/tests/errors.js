/* ============================================================
   BI validation tests — roadmap task 33 (error copy & recovery).
   Run via: await BI.runTests("errors")  (page_eval harness).

   Every failure mode the app can hit must map to plain-language,
   actionable copy: title, message and a concrete next step. This
   suite pins the whole copy table and the describe()/from()
   fallbacks.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const KNOWN_CODES = [
    "manifest_unreachable", "network_error", "source_http_error", "malformed_bundle",
    "unsupported_schema", "schema_gap", "no_extractor", "extractor_failed", "no_bundle", "unknown_tool",
    "quota_exceeded", "need_edit_key", "invalid_edit_key", "remote_newer", "version_conflict",
    "not_found", "malformed_document", "exists", "invalid_id", "invalid_kind",
    "editable_requires_saved_generator", "over_daily_allowance", "file_too_big", "upload_plugin_missing",
    "backend_missing", "read_failed",
    "invalid_backup", "backup_quota", "backup_invalid_doc",
    "snapshot_publish_failed",
    "unknown_metric", "unknown_chart", "no_data", "no_conflict", "unknown_report",
    "hub_unreachable", "role_denied",
  ];

  BI.tests.errors = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });

      /* 1 — every known code produces copy with all three parts */
      for (const code of KNOWN_CODES) {
        const d = BI.errors.describe(code);
        push("describe(" + code + ") has title", !!d.title && d.title.length > 0);
        push("describe(" + code + ") has message", !!d.message && d.message.length > 0);
        push("describe(" + code + ") has nextStep", !!d.nextStep && d.nextStep.length > 0);
      }

      /* 2 — the combined text is usable in a toast/modal */
      const d = BI.errors.describe("malformed_bundle");
      push("text combines title+message+nextStep", d.text.indexOf(d.title) === 0 && d.text.indexOf(d.nextStep) > 0);

      /* 3 — describe falls back gracefully for unknown codes */
      const u = BI.errors.describe("definitely_not_a_real_code");
      push("unknown code falls back to generic copy", !!u.title && !!u.message && !!u.nextStep);
      const uctx = BI.errors.describe("weird", { title: "Custom", message: "Detail", nextStep: "Do X" });
      push("unknown code honours context overrides", uctx.title === "Custom" && uctx.message === "Detail" && uctx.nextStep === "Do X");

      /* 4 — from() unwraps both {error:{code}} and {code} shapes */
      const e1 = BI.errors.from({ error: { code: "quota_exceeded" } });
      push("from unwraps error.code", e1.code === "quota_exceeded" && e1.nextStep.indexOf("ceiling") >= 0);
      const e2 = BI.errors.from({ code: "role_denied" });
      push("from reads top-level code", e2.code === "role_denied");
      const e3 = BI.errors.from(new Error("boom"));
      push("from falls back for raw errors", e3.code === "unknown");

      /* 5 — every code is distinct (no accidental aliasing) */
      const seen = new Set(KNOWN_CODES.map((c) => BI.errors.describe(c).title));
      push("all known codes have distinct titles", seen.size === KNOWN_CODES.length, seen.size + " titles for " + KNOWN_CODES.length + " codes");

      /* 6 — the two newest codes exist (table chart type + unknown report) */
      push("unknown_chart lists the table type", BI.errors.describe("unknown_chart").nextStep.indexOf("table") >= 0);
      push("unknown_report copy points at Reports module", BI.errors.describe("unknown_report").nextStep.indexOf("Reports") >= 0);

      return results;
    },
  };
})();
