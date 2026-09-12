/* ============================================================
   RMM-U — retention, batching & scale  (Phase 3 · Task 17)

   A collector that only ever appends is a collector that eventually
   stops. This module defines and enforces the retention policy that
   bounds every durable region, and provides the batching/compression
   primitives that keep the wire small.

   Retention (all configurable in `config.rmm`):
     • metrics — raw samples in a bounded window, folded into running
       hourly and daily roll-ups (so history outlives the raw ring).
     • jobs    — finished jobs pruned after jobRetentionHours.
     • logs    — diagnostic log uploads capped per device.
     • self-tests — capped per device.
     • inventory deltas — capped per device (enforced on write, Task 9).
     • alerts  — a bounded history window (wired when Phase 5 lands).
   The collector enforces the same policy on its durable state through
   `COL.applyRetention`; the console enforces the ERP document side here.

   Batching & compression:
     • the collector's `batch` device op coalesces inventory + metrics +
       job results into one authenticated round-trip.
     • the shared core's pack/unpack codec (dictionary substitution over
       repeated JSON string literals) shrinks large bodies; `RET.wireBody`
       compresses on the way out and the hub inflates on the way in.

   Scale:
     • a per-device rate cap (collector) plus the hub's per-connection
       rate limits bound how much work one endpoint can demand.
     • `RET.capacity()` reports every document against the storage ceiling
       so an operator can see the headroom before it runs out.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP) return;
  const COL = ERP.collector;
  const DSP = ERP.dispatch;
  const MET = ERP.metrics;
  const DIAG = ERP.diagnostics;
  const RET = (ERP.retention = {});

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const asArr = (v) => (Array.isArray(v) ? v : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();

  /* ─────────────────────── policy ─────────────────────── */

  RET.policy = function () {
    return {
      metrics: {
        raw: MET ? MET.RAW_LIMIT() : Math.max(10, num(cfg("rmm.metricsRawPoints", 240), 240)),
        hourly: MET ? MET.HOURLY_LIMIT() : Math.max(6, num(cfg("rmm.metricsHourlyPoints", 168), 168)),
        daily: MET ? MET.DAILY_LIMIT() : Math.max(2, num(cfg("rmm.metricsDailyPoints", 30), 30)),
        maxSamplesPerPost: MET ? MET.MAX_SAMPLES_PER_POST() : 60,
      },
      jobs: {
        retentionHours: Math.max(1, num(cfg("rmm.jobRetentionHours", 168), 168)),
        deliveryTimeoutMinutes: Math.max(1, num(cfg("rmm.jobDeliveryTimeoutMinutes", 30), 30)),
        expiryMinutes: Math.max(1, num(cfg("rmm.jobExpiryMinutes", 1440), 1440)),
        maxAttempts: Math.max(1, num(cfg("rmm.jobMaxAttempts", 2), 2)),
      },
      logs: {
        keep: DIAG ? DIAG.logKeep() : Math.max(1, num(cfg("rmm.diagnosticLogKeep", 10), 10)),
        maxBytes: DIAG ? DIAG.logMaxBytes() : Math.max(4096, num(cfg("rmm.diagnosticLogMaxBytes", 262144), 262144)),
        selfTestKeep: DIAG ? DIAG.selfTestKeep() : Math.max(1, num(cfg("rmm.diagnosticSelfTestKeep", 20), 20)),
      },
      inventory: { deltaLimit: Math.max(1, num(cfg("rmm.inventoryDeltaLimit", 25), 25)) },
      alerts: { retentionDays: Math.max(1, num(cfg("rmm.alertRetentionDays", 30), 30)) },
      scale: {
        deviceOpsPerMinute: COL && COL.createCore ? COL.createCore({}).limits.deviceOpsPerMinute : 900,
        maxBatchOps: COL && COL.createCore ? COL.createCore({}).limits.maxBatchOps : 32,
        packThreshold: COL && COL.PACK_THRESHOLD ? COL.PACK_THRESHOLD : 4096,
      },
      events: { history: Math.max(20, num(cfg("rmm.eventHistory", 200), 200)), pollSeconds: Math.max(5, num(cfg("rmm.eventPollSeconds", 15), 15)) },
      version: 1,
    };
  };

  /* ─────────────────────── batching & compression ─────────────────────── */

  RET.pack = function (text) { try { return COL.packText(text); } catch (e) { return String(text == null ? "" : text); } };
  RET.unpack = function (text) { try { return COL.unpackText(text); } catch (e) { return String(text == null ? "" : text); } };

  /* Compress a body into the packed wire form when it pays for itself. */
  RET.wireBody = function (obj) {
    if (obj == null || typeof obj !== "object") return obj;
    try {
      const json = JSON.stringify(obj);
      if (json.length < RET.policy().scale.packThreshold) return obj;
      const packed = RET.pack(json);
      return packed.length < json.length ? packed : obj;
    } catch (e) { return obj; }
  };

  /* Measure the codec's effect on a representative payload. */
  RET.codecStats = function (obj) {
    const json = typeof obj === "string" ? obj : JSON.stringify(obj == null ? {} : obj);
    const packed = RET.pack(json);
    return { rawBytes: json.length, packedBytes: packed.length, ratio: json.length ? Math.round((packed.length / json.length) * 100) : 100, roundTrip: RET.unpack(packed) === json };
  };

  /* Batch N device ops into one round-trip. */
  RET.batch = function (ops) {
    return { ops: asArr(ops).slice(0, RET.policy().scale.maxBatchOps) };
  };
  RET.sendBatch = async function (ops) {
    try { return await COL.deviceOp("batch", RET.batch(ops)); }
    catch (e) { return { ok: false, error: "batch_failed", message: String(e && e.message || e) }; }
  };

  /* ─────────────────────── roll-ups ─────────────────────── */

  /* Fold raw samples into hourly and daily aggregates using the metrics
     service's own incremental aggregator, so ERP and collector agree. */
  RET.rollup = function (samples) {
    if (!MET || typeof MET.rollup !== "function") return { hourly: [], daily: [] };
    const byHour = {}, byDay = {};
    asArr(samples).forEach((s) => {
      const n = MET.normalizeSample(s);
      if (!n) return;
      const hb = MET.hourBucket(n.at), db = MET.dayBucket(n.at);
      byHour[hb] = byHour[hb] || []; byHour[hb].push(s);
      byDay[db] = byDay[db] || []; byDay[db].push(s);
    });
    return {
      hourly: Object.keys(byHour).sort().map((b) => ({ bucket: b, agg: MET.rollup(byHour[b]) })),
      daily: Object.keys(byDay).sort().map((b) => ({ bucket: b, agg: MET.rollup(byDay[b]) })),
    };
  };

  /* ─────────────────────── ERP-side pruning ─────────────────────── */

  async function pruneMetrics(providerId) {
    if (!MET || typeof MET.load !== "function") return { pruned: 0 };
    const p = RET.policy().metrics;
    const list = await MET.load();
    let pruned = 0;
    list.forEach((rec) => {
      if (rec.kind !== "series") return;
      if (providerId && String(rec.providerId) !== String(providerId)) return;
      if (asArr(rec.raw).length > p.raw) { rec.raw = rec.raw.slice(-p.raw); pruned++; }
      if (asArr(rec.hourly).length > p.hourly) { rec.hourly = rec.hourly.slice(-p.hourly); pruned++; }
      if (asArr(rec.daily).length > p.daily) { rec.daily = rec.daily.slice(-p.daily); pruned++; }
    });
    if (pruned) await ERP.store.saveDoc(MET.MODULE, list);
    return { pruned };
  }

  async function pruneDiagnostics(providerId) {
    if (!DIAG || typeof DIAG.load !== "function") return { pruned: 0 };
    const p = RET.policy().logs;
    const list = await DIAG.load();
    const byDevice = {};
    list.forEach((rec) => { const id = String(rec.deviceId || ""); (byDevice[id] = byDevice[id] || []).push(rec); });
    let pruned = 0;
    const kept = [];
    Object.keys(byDevice).forEach((id) => {
      const rows = byDevice[id];
      const logs = rows.filter((r) => r.kind === "log");
      const tests = rows.filter((r) => r.kind === "selftest");
      const keepLogs = logs.slice(-p.keep), keepTests = tests.slice(-p.selfTestKeep);
      pruned += rows.length - keepLogs.length - keepTests.length;
      kept.push(...keepLogs, ...keepTests);
    });
    if (pruned) await ERP.store.saveDoc(DIAG.MODULE, kept);
    return { pruned };
  }

  /* ─────────────────────── apply ─────────────────────── */

  /* Enforce the whole policy: the collector's durable regions and the
     console's documents. Safe to call on a schedule or on demand. */
  RET.apply = async function (providerId, opts) {
    opts = opts || {};
    const p = RET.policy();
    const report = { at: now(), providerId: providerId || "", collector: null, metrics: null, diagnostics: null, jobs: null, dispatch: null };
    try {
      report.collector = await COL.applyRetention({
        rawMax: p.metrics.raw, hourlyMax: p.metrics.hourly, dailyMax: p.metrics.daily,
        logKeep: p.logs.keep, selfTestKeep: p.logs.selfTestKeep,
        updateKeep: Math.max(1, num(cfg("rmm.updateHistoryLimit", 20), 20)),
        historyKeep: Math.max(1, num(cfg("rmm.jobHistoryKeep", 50), 50)),
        jobRetentionHours: p.jobs.retentionHours,
      });
    } catch (e) { report.collector = { ok: false, error: String(e && e.message || e) }; }
    try { report.metrics = await pruneMetrics(providerId); } catch (e) { report.metrics = { pruned: 0, error: String(e && e.message || e) }; }
    try { report.diagnostics = await pruneDiagnostics(providerId); } catch (e) { report.diagnostics = { pruned: 0, error: String(e && e.message || e) }; }
    try { report.jobs = await ERP.jobs.reap(providerId); } catch (e) { report.jobs = { error: String(e && e.message || e) }; }
    try { report.dispatch = await DSP.sync(providerId); } catch (e) { report.dispatch = { error: String(e && e.message || e) }; }
    return report;
  };

  /* ─────────────────────── capacity ─────────────────────── */

  RET.capacity = async function () {
    let cap = null;
    try { if (ERP.continuity && ERP.continuity.capacity) cap = await ERP.continuity.capacity(); } catch (e) {}
    const docs = asArr(cap && cap.rows);
    let collectorBytes = 0, collectorCounts = null;
    try {
      const st = COL.localCore().state();
      collectorBytes = JSON.stringify(st).length;
      collectorCounts = { devices: Object.keys(st.devices || {}).length, jobs: Object.keys(st.jobs || {}).length, credentials: Object.keys(st.creds || {}).length, tokens: Object.keys(st.tokens || {}).length, source: "in-page" };
    } catch (e) {}
    /* When the hub socket is live, report its authoritative fleet instead of
       the in-page core (and never block on a connect that isn't open). */
    try {
      const status = COL.status();
      if (status && status.mode === "socket" && status.state === "open") {
        const fleet = await COL.fleet();
        if (fleet && fleet.ok && fleet.counts) {
          const jobsRes = await COL.jobs({});
          collectorCounts = Object.assign({}, collectorCounts, {
            devices: num(fleet.counts.total, 0), online: num(fleet.counts.online, 0),
            jobs: num(jobsRes && jobsRes.ok && jobsRes.jobs && jobsRes.jobs.length, 0),
            source: "hub",
          });
        }
      }
    } catch (e) {}
    return { docs: docs, total: cap ? num(cap.total, 0) : 0, ceiling: cap ? cap.ceiling : null, collector: { bytes: collectorBytes, counts: collectorCounts } };
  };

  RET.stats = async function (providerId) {
    const p = RET.policy();
    const capacity = await RET.capacity();
    const totalBytes = asArr(capacity.docs).reduce((n, d) => n + num(d.bytes, 0), 0);
    return { policy: p, capacity, totalBytes, docCount: asArr(capacity.docs).length };
  };

  /* ─────────────────────── display ─────────────────────── */

  RET.renderRetention = async function (panel, opts) {
    if (!panel) return;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const p = RET.policy();
    const capacity = await RET.capacity();
    const docs = asArr(capacity.docs);
    const total = docs.reduce((n, d) => n + num(d.bytes, 0), 0);

    const docRows = docs.map((d) => ({
      doc: "<code>" + esc(d.label || d.name || d.doc || "") + "</code>",
      records: esc(String(d.recordCount == null ? (d.records == null ? "—" : d.records) : d.recordCount)),
      bytes: esc(human(d.bytes)),
      share: '<div class="rmm-bar"><span style="width:' + (total ? Math.min(100, Math.round((num(d.bytes, 0) / total) * 100)) : 0) + '%"></span></div>',
    }));

    const policyRows = [
      ["Metrics — raw window", p.metrics.raw + " samples/device"],
      ["Metrics — hourly roll-ups", p.metrics.hourly + " buckets/device"],
      ["Metrics — daily roll-ups", p.metrics.daily + " buckets/device"],
      ["Metrics — max samples / post", String(p.metrics.maxSamplesPerPost)],
      ["Jobs — retention", p.jobs.retentionHours + " hours"],
      ["Jobs — delivery timeout", p.jobs.deliveryTimeoutMinutes + " min"],
      ["Jobs — expiry", p.jobs.expiryMinutes + " min"],
      ["Logs — kept / cap", p.logs.keep + " / " + human(p.logs.maxBytes)],
      ["Self-tests — kept", String(p.logs.selfTestKeep)],
      ["Inventory — delta log", p.inventory.deltaLimit + " / device"],
      ["Alerts — history", p.alerts.retentionDays + " days"],
      ["Collector — device ops / min", String(p.scale.deviceOpsPerMinute)],
      ["Collector — batch size cap", String(p.scale.maxBatchOps)],
      ["Event stream — history / poll", p.events.history + " / " + p.events.pollSeconds + "s"],
    ];

    panel.innerHTML =
      ui.grid([
        ui.statCard({ label: "Documents", value: String(docs.length), sub: human(total) + " tracked" }),
        ui.statCard({ label: "Collector state", value: human(capacity.collector.bytes), sub: capacity.collector.counts ? capacity.collector.counts.devices + " devices · " + capacity.collector.counts.jobs + " jobs" : "—" }),
        ui.statCard({ label: "Metrics policy", value: p.metrics.raw + "/" + p.metrics.hourly + "/" + p.metrics.daily, sub: "raw / hourly / daily" }),
        ui.statCard({ label: "Job + log retention", value: p.jobs.retentionHours + "h", sub: "logs keep " + p.logs.keep + " · self-tests " + p.logs.selfTestKeep }),
      ], "erp-kpi-grid") +
      '<div class="erp-btn-row">' +
        ui.btn("Apply retention now", { primary: true, act: "ret-apply" }) +
        ui.btn("Prune collector queue", { act: "ret-reap" }) +
        ui.btn("Measure codec", { act: "ret-codec" }) +
      "</div>" +
      ui.card("Capacity", ui.table([
        { key: "doc", label: "Document", render: (r) => r.doc }, { key: "records", label: "Records", render: (r) => r.records },
        { key: "bytes", label: "Size", render: (r) => r.bytes }, { key: "share", label: "Share", render: (r) => r.share },
      ], docRows, { scroll: true, emptyText: "No documents tracked yet." })) +
      ui.card("Retention & scale policy", ui.table([
        { key: "k", label: "Setting" }, { key: "v", label: "Value" },
      ], policyRows.map((r) => ({ k: r[0], v: esc(r[1]) })))) +
      '<p class="erp-sub">Retention is enforced on the collector\'s durable state and on the console documents alike. Large bodies travel compressed with the shared pack/unpack codec; the collector accepts them batched.</p>';

    ui.bind(panel, "click", "[data-act]", async (t, e, act) => {
      if (act === "ret-apply") {
        const r = await RET.apply(opts.providerId);
        (opts.toast || (() => {}))("Retention applied — collector pruned " + ((r.collector && (r.collector.jobs || 0) + (r.collector.logs || 0)) || 0) + " item(s).", "success");
        return opts.refresh ? opts.refresh() : undefined;
      }
      if (act === "ret-reap") {
        const r = await ERP.jobs.reap(opts.providerId);
        (opts.toast || (() => {}))("Queue reaped — requeued " + num(r.requeued, 0) + ", expired " + num(r.expired, 0) + ", pruned " + num(r.pruned, 0) + ".", "success");
        return opts.refresh ? opts.refresh() : undefined;
      }
      if (act === "ret-codec") {
        const demo = { deviceId: "dev-demo", providerId: "prov-demo", payload: { samples: new Array(40).fill({ at: now(), cpuPct: 12.5, memPct: 64.2, diskPct: 71.1, netRxBps: 10240, netTxBps: 2048 }), inventory: { system: { os: { family: "Windows", name: "Windows 11 Pro", version: "10.0.22631" }, manufacturer: "Dell Inc.", model: "Latitude 5540" } } } };
        const s = RET.codecStats(demo);
        (opts.toast || (() => {}))("Codec: " + s.rawBytes + " → " + s.packedBytes + " chars (" + s.ratio + "%), round-trip " + (s.roundTrip ? "exact" : "FAILED") + ".", s.roundTrip ? "success" : "error");
      }
    });
  };

  function human(bytes) {
    const n = num(bytes, 0);
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KiB";
    return (n / 1048576).toFixed(2) + " MiB";
  }
  RET.human = human;

  RET.init = function () { return RET; };
})();
