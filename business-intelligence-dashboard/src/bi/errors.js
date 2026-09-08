/* ============================================================
   BI error copy & recovery (task 33) — every failure mode maps
   to plain-language, actionable copy with the exact next step.

   Codes covered:
     source 404 / network error, malformed bundle, unsupported
     schema version, older schema (gap), quota reached, lost edit
     key, offline divergence, unknown metric, missing extractor,
     manifest unreachable, remote document newer (conflict),
     document not found, invalid args, unknown chart type.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const COPY = {
    /* bus / sources */
    manifest_unreachable: {
      title: "Manifest unreachable",
      message: "The shared pipeline manifest could not be fetched.",
      nextStep: "Check the manifest URL in biConfig.bus (main.pjs), then refresh Data Sources.",
    },
    network_error: {
      title: "Network error",
      message: "The source could not be reached.",
      nextStep: "Check your connection, then use the per-source Refresh button to retry.",
    },
    source_http_error: {
      title: "Source responded with an error",
      message: "The tool's bundle URL returned an HTTP error.",
      nextStep: "Confirm the tool still publishes the bundle at its manifest URL, then refresh this source.",
    },
    malformed_bundle: {
      title: "Malformed bundle",
      message: "The tool published a bundle that is not valid JSON or is missing required fields.",
      nextStep: "Ask the tool owner to republish; the BI skipped it and kept other sources running.",
    },
    unsupported_schema: {
      title: "Bundle schema too new",
      message: "The bundle uses a newer schema than this BI understands.",
      nextStep: "Update this BI (or the extractor) to support the new schema. The source is paused until then.",
    },
    schema_gap: {
      title: "Older bundle schema",
      message: "The bundle uses an older schema version. Data is read best-effort.",
      nextStep: "Ask the tool owner to upgrade the bundle to the current schema.",
    },
    no_extractor: {
      title: "No extractor for this bundle type",
      message: "The manifest lists a bundle type the BI has no metric extractor for.",
      nextStep: "Add a catalog entry and extractor for the bundle type (see the README playbook).",
    },
    extractor_failed: {
      title: "Extractor failed on this bundle",
      message: "The extractor hit an unexpected shape in the payload.",
      nextStep: "The source is flagged with this error; other sources are unaffected. Fix or replace the bundle.",
    },
    no_bundle: {
      title: "Bundle type not registered",
      message: "The tool's manifest entry no longer lists this bundle type.",
      nextStep: "Re-discover the manifest, or add the bundle type back in the source tool.",
    },
    unknown_tool: {
      title: "Unknown tool",
      message: "The manifest has no tool with that id.",
      nextStep: "Check the manifest; new tools appear automatically once they register.",
    },

    /* store */
    quota_exceeded: {
      title: "Storage ceiling reached",
      message: "This write would exceed the canonical store's storage ceiling.",
      nextStep: "Archive or delete documents in Settings → Capacity, or raise store.ceilingBytes in biConfig.",
    },
    need_edit_key: {
      title: "Missing edit key",
      message: "This device has no edit key for that document, so it can only read it.",
      nextStep: "Export edit keys from the creating device and import them here (Settings → Backup & keys).",
    },
    invalid_edit_key: {
      title: "Edit key mismatch",
      message: "The stored edit key no longer matches the document on the cloud.",
      nextStep: "Import the correct key from the creating device, or restore from a backup.",
    },
    remote_newer: {
      title: "Changed on another device",
      message: "This document was edited elsewhere since your last sync; your change is kept but not yet written.",
      nextStep: "Resolve the conflict — keep yours, keep theirs, or field-merge — before continuing.",
    },
    version_conflict: {
      title: "Document changed since you loaded it",
      message: "Another edit landed while you were working.",
      nextStep: "Refresh and re-apply your change.",
    },
    not_found: {
      title: "Document not found",
      message: "The document no longer exists in the local store or the cloud.",
      nextStep: "Refresh; if it was deleted on another device, reconcile will adopt the deletion.",
    },
    malformed_document: {
      title: "Malformed document",
      message: "The cloud copy of this document is not a valid BI envelope.",
      nextStep: "Restore it from a backup, or remove it and recreate it.",
    },
    exists: {
      title: "Document already exists",
      message: "A document with that id already exists.",
      nextStep: "Use a different id, or update the existing document instead.",
    },
    invalid_id: {
      title: "Invalid document id",
      message: "Ids must be 1-60 chars of lowercase letters, digits and hyphens.",
      nextStep: "Rename it and try again.",
    },
    invalid_kind: {
      title: "Invalid document kind",
      message: "The kind is not one the store accepts.",
      nextStep: "Use report, dashboard, metricCatalog, settings, view, schedule, backup or archive.",
    },
    editable_requires_saved_generator: {
      title: "Save the generator first",
      message: "The generator isn't saved yet, so documents stay local until then.",
      nextStep: "Save the generator to publish documents to the cloud store.",
    },
    over_daily_allowance: {
      title: "Upload quota used up for today",
      message: "The storage service is rate-limiting today's uploads.",
      nextStep: "Wait until tomorrow, or archive old documents to free quota.",
    },
    file_too_big: {
      title: "File too large for the storage service",
      message: "The document exceeds the storage service's per-file limit.",
      nextStep: "Split the document or archive content.",
    },
    upload_plugin_missing: {
      title: "Upload plugin unavailable",
      message: "The storage backend isn't available on this page.",
      nextStep: "Reload the page, or check that uploadPlugin is imported in main.pjs.",
    },
    backend_missing: {
      title: "Storage backend not initialised",
      message: "The store hasn't been initialised.",
      nextStep: "Reload the page.",
    },
    read_failed: {
      title: "Could not read a cloud document",
      message: "Reading the document from the storage service failed.",
      nextStep: "Refresh again; the local cache is still available meanwhile.",
    },

    /* backup / restore */
    invalid_backup: {
      title: "Invalid backup file",
      message: "The file is not a valid BI backup.",
      nextStep: "Choose a backup exported from the BI (schema bi/backup/v1).",
    },
    backup_quota: {
      title: "Restore would exceed the ceiling",
      message: "The backup contains more data than the store ceiling allows.",
      nextStep: "Restore a partial backup, or raise store.ceilingBytes in biConfig.",
    },
    backup_invalid_doc: {
      title: "Backup contains an invalid document",
      message: "One of the documents in the backup is malformed.",
      nextStep: "Fix or remove that document from the backup, then restore again.",
    },

    /* snapshot */
    snapshot_publish_failed: {
      title: "Snapshot could not be published",
      message: "Publishing the snapshot bundle to the storage service failed.",
      nextStep: "Check the upload quota, then retry.",
    },

    /* reports / charts */
    unknown_metric: {
      title: "Unknown metric",
      message: "The report references a metric that isn't in the catalog.",
      nextStep: "Pick a metric from the catalog, or add the metric to the catalog (admin).",
    },
    unknown_chart: {
      title: "Unknown chart type",
      message: "The report references a chart type the adapter doesn't support.",
      nextStep: "Choose one of: timeSeries, bar, line, pie, donut, histogram, kpi, table.",
    },
    no_data: {
      title: "No data in range",
      message: "No facts matched this report's measures, filters and date range.",
      nextStep: "Widen the date range, clear filters, or check the source's freshness.",
    },
    no_conflict: {
      title: "Nothing to resolve",
      message: "There is no pending conflict for that document.",
      nextStep: "Nothing needed — the document is in sync.",
    },
    unknown_report: {
      title: "Unknown report",
      message: "No report exists with that id.",
      nextStep: "Choose a report from the Reports module.",
    },

    /* realtime */
    hub_unreachable: {
      title: "Realtime hub unreachable",
      message: "Live updates are paused; the BI has switched to polling.",
      nextStep: "Check that the generator is saved (the hub runs in production), or accept polling mode.",
    },
    role_denied: {
      title: "Not allowed",
      message: "Your role doesn't permit that action.",
      nextStep: "Ask an admin to grant you a higher role, or use a viewer-only workflow.",
    },
  };

  BI.errors = {
    describe(code, ctx) {
      ctx = ctx || {};
      const c = COPY[code] || {
        title: ctx.title || "Something went wrong",
        message: ctx.message || String(code || "unknown"),
        nextStep: ctx.nextStep || "Retry the action, or reload the page.",
      };
      return {
        code,
        title: c.title,
        message: c.message,
        nextStep: c.nextStep,
        text: c.title + ". " + c.message + " " + c.nextStep,
      };
    },
    from(err) {
      const code = err && err.error && err.error.code ? err.error.code : (err && err.code ? err.code : "unknown");
      return BI.errors.describe(code, err && err.error ? err.error : err);
    },
  };
})();
