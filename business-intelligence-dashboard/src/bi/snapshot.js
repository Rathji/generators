/* ============================================================
   BI snapshot bundles (task 29) — an optional compact publish
   of the key numbers (KPIs + executive headline metrics) as
   JSON, consumable by an AI assistant or voice assistant for
   numeric Q&A. Published as an editable file in the BI's own
   namespace with its own edit-count freshness tracking.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const snapshot = (BI.snapshot = {});
  const SCHEMA = "bi/snapshot/v1";

  function nsName() {
    const g = window.generatorPublicId || "";
    const seed = /^[0-9a-f]{6,}$/.test(g) ? g.slice(0, 8) : "local";
    return "bi1-" + seed + "-snapshot";
  }

  function sum(records, measure) { return records.filter((r) => r.measure === measure).reduce((s, r) => s + r.value, 0); }
  function last(records, measure) {
    const fs = records.filter((r) => r.measure === measure).sort((a, b) => a.period.localeCompare(b.period));
    return fs.length ? fs[fs.length - 1].value : null;
  }
  function avg(records, measure) {
    const fs = records.filter((r) => r.measure === measure);
    return fs.length ? fs.reduce((s, r) => s + r.value, 0) / fs.length : null;
  }

  /* Build the snapshot payload from the live fact store. */
  snapshot.build = function () {
    const R = BI.facts.records;
    const asOf = BI.reports.asOf();
    const kpis = {
      cash: last(R, "cash"),
      receivables: sum(R, "receivables"),
      payables: sum(R, "payables"),
      revenueLast3m: sum(BI.facts.filter(["revenue"], { from: BI.reports.dateRangeBounds({ type: "last3m" }).from, to: asOf }), "revenue"),
      pipelineValue: sum(R, "pipelineValue"),
      weightedForecast: sum(R, "weightedForecast"),
      utilization: avg(R, "utilization"),
      atRiskProjects: sum(R, "atRiskProjects"),
      inventoryLow: sum(R, "inventoryLow"),
      staleCount: sum(R, "staleCount"),
      articleCount: sum(R, "articleCount"),
      ideaCount: sum(R, "ideaCount"),
      unbilledHours: sum(R, "unbilledHours"),
      openWorkload: sum(R, "openWorkload"),
    };
    const sources = (BI.bus.tools || []).map((t) => ({
      tool: t.id,
      name: t.name,
      bundles: (t.bundles || []).map((b) => {
        const h = BI.bus.healthOf(t.id, b.type);
        return { type: b.type, status: h.status, editCount: h.editCount || 0, lastPull: h.lastPull || null, error: h.error || null };
      }),
    }));
    const payload = {
      schema: SCHEMA,
      version: 1,
      generatedAt: new Date().toISOString(),
      asOf,
      generator: window.generatorName || "",
      kpis,
      sources,
    };
    return payload;
  };

  /* Publish the snapshot (idempotent content is a free no-op on the
     editable host; freshness tracked by the file's own edit count). */
  snapshot.publish = async function () {
    const payload = snapshot.build();
    const text = JSON.stringify(payload, null, 1);
    const p = window.root && root.uploadPlugin;
    if (!p || !p.editable) return { ok: false, error: { code: "upload_plugin_missing", message: "uploadPlugin is not available." } };
    const name = nsName();
    let r;
    const existingKey = localStorage.getItem("bi.snapshot.key");
    if (existingKey) {
      r = await p.editable.set(name, text, { editKey: existingKey });
    } else {
      r = await p.editable.set(name, text);
      if (r.editKey) localStorage.setItem("bi.snapshot.key", r.editKey);
    }
    if (r.error) return { ok: false, error: { code: "snapshot_publish_failed", message: BI.errors.describe(r.error).text } };
    const url = "https://editable.uploads.dev/file/" + window.generatorName + "/" + name;
    localStorage.setItem("bi.snapshot.info", JSON.stringify({ editCount: r.editCount, publishedAt: new Date().toISOString(), url }));
    return { ok: true, url, editCount: r.editCount, name };
  };

  snapshot.status = function () {
    const info = (() => { try { return JSON.parse(localStorage.getItem("bi.snapshot.info") || "null"); } catch { return null; } })();
    const published = !!(info && info.publishedAt);
    const ageMs = published ? Date.now() - new Date(info.publishedAt).getTime() : null;
    return {
      published,
      editCount: info ? info.editCount : 0,
      url: info ? info.url : null,
      ageMs,
      ageLabel: ageMs == null ? "never" : ageMs < 3600000 ? Math.round(ageMs / 60000) + " min ago" : ageMs < 86400000 ? Math.round(ageMs / 3600000) + " h ago" : Math.round(ageMs / 86400000) + " d ago",
    };
  };

  snapshot.read = async function () {
    const p = window.root && root.uploadPlugin;
    if (!p || !p.editable) return { ok: false, error: { code: "upload_plugin_missing", message: "uploadPlugin is not available." } };
    try {
      const text = await p.editable.get(nsName());
      if (text == null) return { ok: true, payload: null };
      return { ok: true, payload: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: { code: "read_failed", message: String(e && e.message || e) } };
    }
  };
})();
