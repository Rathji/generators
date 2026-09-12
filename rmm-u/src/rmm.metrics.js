/* ============================================================
   RMM-U — performance metrics collection  (Phase 2 · Task 10)

   Metrics are high-volume, so the design goal is "bounded by
   construction":

     • The agent samples on a configurable interval
       (config.rmm.metricsSampleSeconds) and posts a BATCH of samples
       on its check-in, never one request per sample.
     • Each post is capped (config.rmm.metricsMaxSamplesPerPost).
     • The collector keeps three tiers per device — a raw ring of the
       most recent samples (config.rmm.metricsRawPoints), hourly
       roll-ups (config.rmm.metricsHourlyPoints) and daily roll-ups
       (config.rmm.metricsDailyPoints). Old data is pruned as new data
       arrives, so storage per device is a constant.
     • Roll-ups are incremental (count / min / max / sum / last), so an
       hourly bucket is maintained by merging samples, not by re-scanning
       history — the same aggregation `MET.rollup` exposes as a pure
       function for the agent and tests.

   Sample model (all optional except `at`):
     { at, cpuPct, memPct, memUsedBytes, memTotalBytes,
       diskPct, diskFreeBytes, diskTotalBytes,
       diskReadBps, diskWriteBps, netRxBps, netTxBps,
       latencyMs, uptimeSeconds, load1, load5, load15,
       custom:{ anyNumericCounter:number },
       disks:[{label,pct,freeBytes,sizeBytes,readBps,writeBps}],
       net:[{name,rxBps,txBps}], topProcesses:[{name,cpuPct,memBytes}] }

   Records live in the hidden `metrics` document (rmm-v1-metrics), one
   record per device:
     { kind:"series", id:"met-<deviceId>", deviceId, providerId,
       intervalSeconds, latest{}, latestAt, sampleCount,
       raw[], hourly[], daily[] }

   window.ERP.metrics is the service.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = ERP.enrollment;
  const MET = (ERP.metrics = {});

  MET.MODULE = "metrics";

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 120).trim();

  const pctOrNull = (v) => (v == null || v === "" ? null : Math.max(0, Math.min(100, num(v, 0))));
  const bytesOrNull = (v) => (v == null || v === "" ? null : Math.max(0, num(v, 0)));

  MET.SAMPLE_SECONDS = () => Math.max(10, num(cfg("rmm.metricsSampleSeconds", 60), 60));
  MET.RAW_LIMIT = () => Math.max(10, num(cfg("rmm.metricsRawPoints", 240), 240));
  MET.HOURLY_LIMIT = () => Math.max(6, num(cfg("rmm.metricsHourlyPoints", 168), 168));
  MET.DAILY_LIMIT = () => Math.max(2, num(cfg("rmm.metricsDailyPoints", 30), 30));
  MET.MAX_SAMPLES_PER_POST = () => Math.max(1, num(cfg("rmm.metricsMaxSamplesPerPost", 60), 60));

  /* ── metric catalogue: what the console can chart ── */
  MET.CATALOG = [
    { id: "cpuPct", label: "CPU", unit: "%", max: 100, decimals: 0, tone: "cpu" },
    { id: "memPct", label: "Memory", unit: "%", max: 100, decimals: 0, tone: "mem", bytesPair: ["memUsedBytes", "memTotalBytes"] },
    { id: "diskPct", label: "Disk usage", unit: "%", max: 100, decimals: 0, tone: "disk", bytesPair: ["diskFreeBytes", "diskTotalBytes"] },
    { id: "diskReadBps", label: "Disk read", unit: "B/s", bytes: true, tone: "disk" },
    { id: "diskWriteBps", label: "Disk write", unit: "B/s", bytes: true, tone: "disk" },
    { id: "netRxBps", label: "Network in", unit: "B/s", bytes: true, tone: "net" },
    { id: "netTxBps", label: "Network out", unit: "B/s", bytes: true, tone: "net" },
    { id: "latencyMs", label: "Latency", unit: "ms", decimals: 0, tone: "net" },
    { id: "load1", label: "Load (1m)", unit: "", decimals: 2, tone: "cpu" },
  ];
  MET.metricMeta = (id) => MET.CATALOG.find((m) => m.id === id) || null;
  MET.metricLabel = (id) => (MET.metricMeta(id) || {}).label || id;

  MET.formatValue = function (metric, v) {
    if (v == null || v === "") return "—";
    const m = MET.metricMeta(metric) || {};
    if (m.bytes) return D.bytesHuman(v) + "/s";
    if (m.unit === "%") return Math.round(num(v, 0)) + "%";
    const d = m.decimals == null ? 1 : m.decimals;
    return num(v, 0).toFixed(d).replace(/\.0+$/, (d ? "." : "") + "0".repeat(d)) + (m.unit || "");
  };
  MET.formatMetric = MET.formatValue;

  /* ─────────────────────── normalisation ─────────────────────── */

  /* Keep only finite numeric values, so a garbage payload can never
     inject NaN/Infinity/strings into the stored series. */
  function pickNums(obj, keys) {
    const out = {};
    keys.forEach((k) => { const v = asObj(obj)[k]; if (v != null && v !== "" && isFinite(Number(v))) out[k] = Number(v); });
    return out;
  }

  MET.normalizeSample = function (raw) {
    raw = asObj(raw);
    const at = raw.at || raw.t || raw.time || raw.timestamp;
    const t = typeof at === "number" ? at : Date.parse(at);
    if (!isFinite(t)) return null;
    const s = Object.assign({ at: new Date(t).toISOString() }, pickNums(raw, [
      "cpuPct", "memPct", "memUsedBytes", "memTotalBytes",
      "diskPct", "diskFreeBytes", "diskTotalBytes",
      "diskReadBps", "diskWriteBps", "netRxBps", "netTxBps",
      "latencyMs", "uptimeSeconds", "load1", "load5", "load15",
    ]));
    if (s.cpuPct != null) s.cpuPct = Math.max(0, Math.min(100, s.cpuPct));
    if (s.memPct != null) s.memPct = Math.max(0, Math.min(100, s.memPct));
    if (s.diskPct != null) s.diskPct = Math.max(0, Math.min(100, s.diskPct));
    const custom = {};
    Object.keys(asObj(raw.custom)).slice(0, 64).forEach((k) => { const v = Number(asObj(raw.custom)[k]); if (isFinite(v)) custom[S(k, 60)] = v; });
    s.custom = custom;
    if (Array.isArray(raw.disks)) s.disks = raw.disks.slice(0, 32).map((d) => Object.assign({ label: S(asObj(d).label, 80) }, pickNums(d, ["pct", "freeBytes", "sizeBytes", "readBps", "writeBps"])));
    if (Array.isArray(raw.net)) s.net = raw.net.slice(0, 32).map((n) => Object.assign({ name: S(asObj(n).name, 120) }, pickNums(n, ["rxBps", "txBps"])));
    if (Array.isArray(raw.topProcesses)) s.topProcesses = raw.topProcesses.slice(0, 20).map((p) => Object.assign({ name: S(asObj(p).name, 160) }, pickNums(p, ["cpuPct", "memBytes"])));
    return s;
  };

  MET.extract = function (sample) {
    const s = asObj(sample);
    const out = {};
    MET.CATALOG.forEach((m) => { if (s[m.id] != null && isFinite(Number(s[m.id]))) out[m.id] = Number(s[m.id]); });
    Object.keys(asObj(s.custom)).forEach((k) => { out["custom:" + k] = asObj(s.custom)[k]; });
    return out;
  };

  /* ─────────────────────── roll-ups ─────────────────────── */

  function emptyAgg() { return { count: 0, firstAt: "", lastAt: "", values: {} }; }

  /* Merge an extracted metric map into an incremental aggregate. */
  MET.mergeAgg = function (agg, metrics, at) {
    agg = agg || emptyAgg();
    Object.keys(metrics).forEach((k) => {
      const v = metrics[k];
      if (!isFinite(v)) return;
      let a = agg.values[k];
      if (!a) a = agg.values[k] = { min: v, max: v, sum: 0, count: 0, last: v, first: v };
      if (v < a.min) a.min = v;
      if (v > a.max) a.max = v;
      a.sum += v; a.count += 1; a.last = v;
    });
    agg.count += 1;
    if (!agg.firstAt || at < agg.firstAt) agg.firstAt = at;
    if (!agg.lastAt || at > agg.lastAt) agg.lastAt = at;
    return agg;
  };

  MET.rollup = function (samples) {
    const agg = emptyAgg();
    asArr(samples).forEach((s) => { const n = MET.normalizeSample(s); if (n) MET.mergeAgg(agg, MET.extract(n), n.at); });
    return agg;
  };

  /* Derive {avg,min,max,last} for each metric from an incremental agg. */
  MET.aggValues = function (agg) {
    const out = {};
    Object.keys(asObj(asObj(agg).values)).forEach((k) => {
      const a = agg.values[k];
      out[k] = { avg: a.count ? a.sum / a.count : null, min: a.min, max: a.max, last: a.last, count: a.count };
    });
    return out;
  };

  function hourBucket(iso) { const d = new Date(iso); d.setUTCMinutes(0, 0, 0); return d.toISOString(); }
  function dayBucket(iso) { return String(iso).slice(0, 10); }
  MET.hourBucket = hourBucket;
  MET.dayBucket = dayBucket;

  /* Append a sample to a tiered series record, merging into the current
     hourly/day bucket and pruning every tier to its configured bound. */
  MET.append = function (rec, sample) {
    rec = rec || {};
    const s = MET.normalizeSample(sample);
    if (!s) return { error: "invalid_sample" };
    const metrics = MET.extract(s);
    rec.raw = asArr(rec.raw);
    rec.raw.push(s);
    rec.raw.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (rec.raw.length > MET.RAW_LIMIT()) rec.raw = rec.raw.slice(-MET.RAW_LIMIT());

    const hb = hourBucket(s.at);
    rec.hourly = asArr(rec.hourly);
    let h = rec.hourly.find((b) => b.bucket === hb);
    if (!h) { h = { bucket: hb, agg: emptyAgg() }; rec.hourly.push(h); }
    MET.mergeAgg(h.agg, metrics, s.at);
    rec.hourly.sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
    if (rec.hourly.length > MET.HOURLY_LIMIT()) rec.hourly = rec.hourly.slice(-MET.HOURLY_LIMIT());

    const db = dayBucket(s.at);
    rec.daily = asArr(rec.daily);
    let dd = rec.daily.find((b) => b.bucket === db);
    if (!dd) { dd = { bucket: db, agg: emptyAgg() }; rec.daily.push(dd); }
    MET.mergeAgg(dd.agg, metrics, s.at);
    rec.daily.sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
    if (rec.daily.length > MET.DAILY_LIMIT()) rec.daily = rec.daily.slice(-MET.DAILY_LIMIT());

    rec.latest = s;
    rec.latestAt = s.at;
    rec.sampleCount = num(rec.sampleCount, 0) + 1;
    rec.intervalSeconds = MET.SAMPLE_SECONDS();
    return { ok: true, rec };
  };

  /* ─────────────────────── change notification ─────────────────────── */

  const listeners = [];
  MET.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  /* ─────────────────────── persistence ─────────────────────── */

  async function load() {
    const r = await ERP.store.loadDoc(MET.MODULE);
    return asArr(r.error ? [] : r.records);
  }
  async function save(list) { return ERP.store.saveDoc(MET.MODULE, list); }
  MET.load = load;

  function seriesFor(records, deviceId) {
    return records.find((r) => r.kind === "series" && String(r.deviceId) === String(deviceId)) || null;
  }
  function newSeries(deviceId, providerId) {
    return { kind: "series", id: "met-" + deviceId, deviceId, providerId, intervalSeconds: MET.SAMPLE_SECONDS(), latest: null, latestAt: "", sampleCount: 0, raw: [], hourly: [], daily: [] };
  }

  async function patchDevice(providerId, deviceId, rec) {
    const g = await D.get(providerId, deviceId);
    if (g.error) return g;
    const custom = Object.assign({}, asObj(g.device.custom), {
      metrics: {
        latestAt: rec.latestAt || "", intervalSeconds: num(rec.intervalSeconds, MET.SAMPLE_SECONDS()),
        sampleCount: num(rec.sampleCount, 0),
        cpuPct: rec.latest ? rec.latest.cpuPct : null, memPct: rec.latest ? rec.latest.memPct : null,
        diskPct: rec.latest ? rec.latest.diskPct : null, uptimeSeconds: rec.latest ? rec.latest.uptimeSeconds : null,
        netRxBps: rec.latest ? rec.latest.netRxBps : null, netTxBps: rec.latest ? rec.latest.netTxBps : null,
        latencyMs: rec.latest ? rec.latest.latencyMs : null,
      },
    });
    const patch = { custom };
    if (rec.latest && rec.latest.memTotalBytes && !g.device.ramBytes) patch.ramBytes = rec.latest.memTotalBytes;
    return D.update(providerId, deviceId, patch);
  }

  /* ─────────────────────── submit ─────────────────────── */

  /* req: { deviceId, credential, payload:{ samples:[...], intervalSeconds? } }
     Authenticated per device. Accepts a BATCH of samples, caps it, and
     folds each into the raw ring + hourly/day roll-ups. */
  MET.submit = async function (req) {
    req = req || {};
    const deviceId = req.deviceId;
    if (!deviceId) return { ok: false, error: "no_device", message: "No device id was supplied." };
    const auth = await E.authenticate(deviceId, req.credential);
    if (!auth.ok) return { ok: false, error: auth.reason, message: "The device did not authenticate.", deviceId };
    const providerId = auth.providerId || req.providerId || "";

    const payload = asObj(req.payload || req.data);
    let samples = asArr(payload.samples || payload.sample || (payload.at ? [payload] : []));
    if (!samples.length) return { ok: false, error: "no_samples", message: "No samples were supplied.", deviceId };
    const cap = MET.MAX_SAMPLES_PER_POST();
    let rejected = 0;
    const clipped = samples.length > cap;
    if (clipped) samples = samples.slice(-cap);

    const records = await load();
    let rec = seriesFor(records, deviceId);
    const isNew = !rec;
    if (!rec) { rec = newSeries(deviceId, providerId); records.push(rec); }
    rec.providerId = rec.providerId || providerId;
    if (payload.intervalSeconds) rec.intervalSeconds = Math.max(10, num(payload.intervalSeconds, MET.SAMPLE_SECONDS()));

    let accepted = 0;
    samples.forEach((s) => {
      const r = MET.append(rec, s);
      if (r.error) rejected += 1; else accepted += 1;
    });
    if (!accepted) return { ok: false, error: "no_valid_samples", message: "Every sample was invalid.", deviceId, rejected };

    const w = await save(records);
    if (w && w.error) return { ok: false, error: w.error, message: w.message, deviceId };
    await patchDevice(providerId, deviceId, rec);
    notify("metrics", { deviceId, providerId, accepted, latest: rec.latestAt });
    if (isNew) { try { if (ERP.master && ERP.master.audit) await ERP.master.audit({ action: "metrics_started", targetType: "device", targetId: deviceId, summary: "Performance metrics collection started for " + deviceId + "." }); } catch (e) {} }

    return {
      ok: true, deviceId, providerId, accepted, rejected, clipped,
      latest: rec.latest, latestAt: rec.latestAt,
      rawPoints: asArr(rec.raw).length, hourlyPoints: asArr(rec.hourly).length, dailyPoints: asArr(rec.daily).length,
      intervalSeconds: rec.intervalSeconds,
    };
  };

  /* ─────────────────────── reads ─────────────────────── */

  MET.series = async function (deviceId) {
    const records = await load();
    return seriesFor(records, deviceId);
  };
  MET.latest = async function (deviceId) { const r = await MET.series(deviceId); return r ? r.latest : null; };
  MET.summary = function (dev) { return asObj(asObj(dev && dev.custom).metrics); };

  MET.listSeries = async function (providerId) {
    const records = await load();
    return records.filter((r) => r.kind === "series" && (!providerId || String(r.providerId) === String(providerId)));
  };

  MET.range = function (series, metric, range) {
    const rec = series || {};
    const r = range || "auto";
    const span = (function () {
      const raw = asArr(rec.raw);
      if (raw.length < 2) return 0;
      return Date.parse(raw[raw.length - 1].at) - Date.parse(raw[0].at);
    })();
    const use = r === "auto" ? (span <= 6 * 3600000 ? "raw" : span <= 21 * 86400000 ? "hourly" : "daily") : r;
    if (use === "raw") {
      return asArr(rec.raw).map((s) => ({ at: s.at, value: s[metric] == null ? null : s[metric], min: s[metric], max: s[metric] })).filter((p) => p.value != null);
    }
    const buckets = asArr(rec[use]);
    return buckets.map((b) => { const v = MET.aggValues(b.agg)[metric]; return v && v.avg != null ? { at: b.bucket, value: v.avg, min: v.min, max: v.max, count: b.agg.count } : null; }).filter(Boolean);
  };

  /* Average a tenant's devices per bucket for one metric — the fleet
     trend the Metrics console charts. Weighted by each bucket's sample
     count so a device with more samples does not dominate. */
  MET.fleetSeries = function (seriesList, metric, use) {
    const map = new Map();
    (seriesList || []).forEach((rec) => {
      const buckets = use === "daily" ? asArr(rec.daily) : asArr(rec.hourly);
      buckets.forEach((b) => {
        const v = MET.aggValues(b.agg)[metric];
        if (!v || v.avg == null) return;
        const key = b.bucket;
        let e = map.get(key);
        if (!e) { e = { at: key, sum: 0, n: 0, min: v.min, max: v.max }; map.set(key, e); }
        e.sum += v.avg * b.agg.count; e.n += b.agg.count;
        if (v.min < e.min) e.min = v.min;
        if (v.max > e.max) e.max = v.max;
      });
    });
    return [...map.values()].sort((a, b) => (a.at < b.at ? -1 : 1)).map((e) => ({ at: e.at, value: e.sum / e.n, min: e.min, max: e.max }));
  };

  MET.stats = async function (providerId) {
    const records = await load();
    const series = records.filter((r) => r.kind === "series" && (!providerId || String(r.providerId) === String(providerId)));
    const devices = await D.list(providerId);
    let raw = 0, hourly = 0, daily = 0, samples = 0;
    series.forEach((r) => { raw += asArr(r.raw).length; hourly += asArr(r.hourly).length; daily += asArr(r.daily).length; samples += num(r.sampleCount, 0); });
    return {
      devices: devices.length, reporting: series.length, samples,
      raw, hourly, daily,
      bytes: raw * 220 + hourly * 340 + daily * 340,
      latestAt: series.reduce((a, r) => (r.latestAt > a ? r.latestAt : a), ""),
      retention: { sampleSeconds: MET.SAMPLE_SECONDS(), raw: MET.RAW_LIMIT(), hourly: MET.HOURLY_LIMIT(), daily: MET.DAILY_LIMIT() },
    };
  };

  /* Current fleet pressure: who is hot, and on what. */
  MET.pressure = async function (providerId, opts) {
    opts = opts || {};
    const devices = await D.list(providerId);
    const series = await MET.listSeries(providerId);
    const byId = new Map(series.map((r) => [String(r.deviceId), r]));
    const cpuThreshold = num(opts.cpuThreshold, 85), memThreshold = num(opts.memThreshold, 85), diskThreshold = num(opts.diskThreshold, 85);
    const rows = devices.map((d) => {
      const rec = byId.get(String(d.id));
      const latest = rec && rec.latest ? rec.latest : null;
      const p = (rec && MET.aggValues((asArr(rec.hourly).slice(-1)[0] || {}).agg)) || {};
      return {
        deviceId: d.id, hostname: d.hostname || d.displayName, latestAt: rec ? rec.latestAt : "",
        cpuPct: latest ? latest.cpuPct : null, memPct: latest ? latest.memPct : null, diskPct: latest ? latest.diskPct : null,
        netRxBps: latest ? latest.netRxBps : null, netTxBps: latest ? latest.netTxBps : null,
        latencyMs: latest ? latest.latencyMs : null, uptimeSeconds: latest ? latest.uptimeSeconds : null,
        hourCpuAvg: p.cpuPct ? p.cpuPct.avg : null, hourCpuMax: p.cpuPct ? p.cpuPct.max : null,
        hot: false,
      };
    });
    rows.forEach((r) => { r.hot = (r.cpuPct != null && r.cpuPct >= cpuThreshold) || (r.memPct != null && r.memPct >= memThreshold) || (r.diskPct != null && r.diskPct >= diskThreshold); });
    return { rows, cpuThreshold, memThreshold, diskThreshold, hot: rows.filter((r) => r.hot).length, reporting: series.length };
  };

  /* ─────────────────────── display ─────────────────────── */

  function chart(points, opts) {
    try {
      if (!points || !points.length) return '<p class="erp-sub">No samples in this window yet.</p>';
      const c = root.charts;
      if (!c) return '<p class="erp-sub">Charts unavailable.</p>';
      return c.timeSeries(points.map((p) => ({ t: p.at, v: p.value })), Object.assign({ height: 150, mode: "line", gridlines: true, dots: false }, opts || {}));
    } catch (e) { return '<p class="erp-sub">Chart error: ' + ERP.ui.esc(e.message) + "</p>"; }
  }
  MET.chart = chart;

  function kvRows(rows) {
    return '<div class="rmm-kv">' + rows.filter((x) => x[1] !== "" && x[1] != null && x[1] !== "—").map((x) => '<div class="rmm-kv-row"><span>' + ERP.ui.esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>";
  }

  function uptimeHuman(sec) {
    sec = num(sec, 0);
    if (!sec) return "—";
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return (d ? d + "d " : "") + (h ? h + "h " : "") + m + "m";
  }
  MET.uptimeHuman = uptimeHuman;

  /* The "Performance" section appended to the device modal. Async — it
     loads the device's series and draws the charts on demand. */
  MET.deviceSection = async function (dev, providerId) {
    const ui = ERP.ui, esc = ui.esc;
    const rec = await MET.series(dev.id);
    const head = '<h4 class="rmm-section-title">Performance</h4>';
    if (!rec || !rec.latest) {
      const sum = MET.summary(dev);
      return head + '<div class="erp-alert tone-info"><b>No performance samples yet.</b> ' + (sum.latestAt ? "Last sample " + ui.dateTime(sum.latestAt) + "." : "The agent has not reported metrics.") + "</div>";
    }
    const latest = rec.latest;
    const dayPoints = MET.range(rec, "cpuPct", "auto");
    const memPoints = MET.range(rec, "memPct", "auto");
    const diskPoints = MET.range(rec, "diskPct", "auto");
    const netIn = MET.range(rec, "netRxBps", "auto");
    const netOut = MET.range(rec, "netTxBps", "auto");

    const disks = asArr(latest.disks).map((dk) => ({
      label: "<b>" + esc(dk.label || "—") + "</b>",
      pct: dk.pct == null ? "—" : ui.badge(Math.round(dk.pct) + "%", dk.pct >= 90 ? "danger" : dk.pct >= 75 ? "warn" : "success"),
      free: ui.esc(D.bytesHuman(num(dk.freeBytes, 0))),
      io: ui.esc(D.bytesHuman(num(dk.readBps, 0)) + "/s · " + D.bytesHuman(num(dk.writeBps, 0)) + "/s"),
    }));
    const nics = asArr(latest.net).map((n) => ({
      name: "<b>" + esc(n.name || "—") + "</b>",
      rx: ui.esc(D.bytesHuman(num(n.rxBps, 0)) + "/s"),
      tx: ui.esc(D.bytesHuman(num(n.txBps, 0)) + "/s"),
    }));
    const procs = asArr(latest.topProcesses).slice(0, 10).map((p) => ({
      name: "<b>" + esc(p.name || "—") + "</b>",
      cpu: p.cpuPct == null ? "—" : Math.round(p.cpuPct) + "%",
      mem: p.memBytes == null ? "—" : ui.esc(D.bytesHuman(p.memBytes)),
    }));
    const customRows = Object.keys(asObj(latest.custom)).map((k) => {
      const series = MET.range(rec, "custom:" + k, "auto");
      const last = series.length ? series[series.length - 1].value : asObj(latest.custom)[k];
      return { name: "<b>" + esc(k) + "</b>", value: esc(String(Math.round(last * 100) / 100)), points: series.length };
    });

    const rawCount = asArr(rec.raw).length, hourlyCount = asArr(rec.hourly).length, dailyCount = asArr(rec.daily).length;

    return head +
      ui.grid([
        ui.statCard({ label: "CPU", value: latest.cpuPct == null ? "—" : Math.round(latest.cpuPct) + "%", tone: latest.cpuPct >= 85 ? "warn" : null, sub: "latest sample" }),
        ui.statCard({ label: "Memory", value: latest.memPct == null ? "—" : Math.round(latest.memPct) + "%", tone: latest.memPct >= 85 ? "warn" : null, sub: latest.memTotalBytes ? D.bytesHuman(latest.memTotalBytes) + " total" : "" }),
        ui.statCard({ label: "Disk usage", value: latest.diskPct == null ? "—" : Math.round(latest.diskPct) + "%", tone: latest.diskPct >= 90 ? "danger" : null, sub: latest.diskTotalBytes ? D.bytesHuman(latest.diskTotalBytes) + " total" : "" }),
        ui.statCard({ label: "Uptime", value: uptimeHuman(latest.uptimeSeconds), sub: "reported by agent" }),
      ], "erp-kpi-grid") +
      kvRows([
        ["Latest sample", ui.dateTime(latest.at)],
        ["Sampling interval", num(rec.intervalSeconds, MET.SAMPLE_SECONDS()) + "s"],
        ["Samples retained", rawCount + " raw · " + hourlyCount + " hourly · " + dailyCount + " daily"],
        ["Network", latest.netRxBps != null || latest.netTxBps != null ? esc("↓ " + D.bytesHuman(num(latest.netRxBps, 0)) + "/s · ↑ " + D.bytesHuman(num(latest.netTxBps, 0)) + "/s") : "—"],
        ["Latency", latest.latencyMs == null ? "—" : esc(Math.round(latest.latencyMs) + " ms")],
        ["Load", latest.load1 == null ? "—" : esc(num(latest.load1, 0).toFixed(2) + " / " + num(latest.load5, 0).toFixed(2) + " / " + num(latest.load15, 0).toFixed(2))],
      ]) +
      "<h4 class=\"rmm-section-title\">CPU &amp; memory</h4>" + chart(dayPoints, { title: "CPU %", max: 100, decimals: 0 }) +
      (memPoints.length > 1 ? chart(memPoints, { title: "Memory %", max: 100, decimals: 0 }) : "") +
      "<h4 class=\"rmm-section-title\">Disk &amp; network</h4>" + chart(diskPoints, { title: "Disk usage %", max: 100, decimals: 0 }) +
      (netIn.length > 1 || netOut.length > 1 ? chart(netIn.map((p, i) => ({ at: p.at, value: p.value + num((netOut[i] || {}).value, 0) })), { title: "Network throughput (B/s)", bytes: true }) : "") +
      (disks.length ? "<h4 class=\"rmm-section-title\">Volumes</h4>" + ui.table([{ key: "label", label: "Volume", render: (r) => r.label }, { key: "pct", label: "Used", render: (r) => r.pct }, { key: "free", label: "Free", align: "right" }, { key: "io", label: "Read / write" }], disks) : "") +
      (nics.length ? "<h4 class=\"rmm-section-title\">Interfaces</h4>" + ui.table([{ key: "name", label: "Interface", render: (r) => r.name }, { key: "rx", label: "In", align: "right" }, { key: "tx", label: "Out", align: "right" }], nics) : "") +
      (procs.length ? "<h4 class=\"rmm-section-title\">Top processes</h4>" + ui.table([{ key: "name", label: "Process", render: (r) => r.name }, { key: "cpu", label: "CPU", align: "right" }, { key: "mem", label: "Memory", align: "right" }], procs) : "") +
      (customRows.length ? "<h4 class=\"rmm-section-title\">Custom counters</h4>" + ui.table([{ key: "name", label: "Counter", render: (r) => r.name }, { key: "value", label: "Latest", align: "right" }, { key: "points", label: "Samples", align: "right" }], customRows) : "");
  };

  /* ─────────────────────── collection requests ─────────────────────── */

  MET.requestSample = async function (providerId, deviceIds) {
    const ids = asArr(deviceIds).length ? asArr(deviceIds) : (await D.list(providerId)).map((d) => d.id);
    let requested = 0, unsupported = 0;
    for (const id of ids) {
      const g = await D.get(providerId, id);
      if (g.error) continue;
      const caps = asArr(asObj(g.device.agent).capabilities);
      if (caps.length && caps.indexOf("metrics") === -1) { unsupported += 1; continue; }
      const custom = Object.assign({}, asObj(g.device.custom), { metricsRequestedAt: now() });
      await D.update(providerId, id, { custom });
      requested += 1;
    }
    if (requested) notify("request", { providerId, requested });
    return { ok: true, requested, unsupported };
  };

  /* ─────────────────────── Metrics console (Devices tab) ─────────────────────── */

  MET.renderMetrics = async function (panel, opts) {
    if (!panel) return;
    const ui = ERP.ui, esc = ui.esc;
    const providerId = opts.providerId;
    const toast = opts.toast || (() => {});
    const refresh = opts.refresh || (() => {});

    const stats = await MET.stats(providerId);
    const press = await MET.pressure(providerId);
    const series = await MET.listSeries(providerId);
    const use = stats.hourly > 12 ? "hourly" : "daily";
    const fleetCpu = MET.fleetSeries(series, "cpuPct", use);
    const fleetMem = MET.fleetSeries(series, "memPct", use);

    const rows = press.rows.map((r) => {
      const rec = series.find((x) => String(x.deviceId) === String(r.deviceId));
      const spark = rec ? MET.range(rec, "cpuPct", "auto").slice(-40) : [];
      return {
        host: "<b>" + esc(r.hostname || r.deviceId) + "</b>" + (r.hot ? " " + ui.badge("hot", "danger") : ""),
        cpu: r.cpuPct == null ? "—" : ui.badge(Math.round(r.cpuPct) + "%", r.cpuPct >= 85 ? "danger" : r.cpuPct >= 70 ? "warn" : "success") + (r.hourCpuAvg != null ? '<div class="erp-sub">1h avg ' + Math.round(r.hourCpuAvg) + "%</div>" : ""),
        mem: r.memPct == null ? "—" : ui.badge(Math.round(r.memPct) + "%", r.memPct >= 85 ? "danger" : r.memPct >= 70 ? "warn" : "success"),
        disk: r.diskPct == null ? "—" : ui.badge(Math.round(r.diskPct) + "%", r.diskPct >= 90 ? "danger" : r.diskPct >= 75 ? "warn" : "success"),
        net: r.netRxBps == null && r.netTxBps == null ? "—" : esc("↓ " + D.bytesHuman(num(r.netRxBps, 0)) + "/s ↑ " + D.bytesHuman(num(r.netTxBps, 0)) + "/s"),
        uptime: esc(uptimeHuman(r.uptimeSeconds)),
        spark: spark.length > 1 ? '<div class="rmm-spark">' + chart(spark, { height: 40, gridlines: false, dots: false }) + "</div>" : '<span class="erp-sub">—</span>',
        latest: r.latestAt ? ui.dateTime(r.latestAt) : "never",
      };
    });

    panel.innerHTML =
      ui.grid([
        ui.statCard({ label: "Reporting", value: press.reporting + "/" + stats.devices, tone: press.reporting ? "success" : null, sub: stats.samples + " samples retained" }),
        ui.statCard({ label: "Under pressure", value: String(press.hot), tone: press.hot ? "danger" : "success", sub: "≥" + press.cpuThreshold + "% CPU / RAM / disk" }),
        ui.statCard({ label: "Latest sample", value: stats.latestAt ? ui.dateTime(stats.latestAt) : "—", sub: MET.SAMPLE_SECONDS() + "s sampling interval" }),
        ui.statCard({ label: "Storage", value: String(stats.raw + stats.hourly + stats.daily), sub: stats.raw + " raw · " + stats.hourly + " hourly · " + stats.daily + " daily" }),
      ], "erp-kpi-grid") +
      '<div class="erp-btn-row">' + ui.btn("Request a sample from all agents", { primary: true, act: "met-sample-all" }) + "</div>" +
      '<p class="erp-sub">Retention: ' + stats.retention.raw + " raw · " + stats.retention.hourly + " hourly · " + stats.retention.daily + " daily samples per device. The agent aggregates locally and posts batches; the collector rolls up to hourly and daily buckets.</p>" +
      ui.card("Fleet CPU (average across reporting devices)", chart(fleetCpu, { title: "CPU %", max: 100, decimals: 0 })) +
      ui.card("Fleet memory (average across reporting devices)", chart(fleetMem, { title: "Memory %", max: 100, decimals: 0 })) +
      ui.card("Devices (" + rows.length + ")",
        ui.table([
          { key: "host", label: "Device", render: (r) => r.host },
          { key: "cpu", label: "CPU", render: (r) => r.cpu },
          { key: "mem", label: "Memory", render: (r) => r.mem },
          { key: "disk", label: "Disk", render: (r) => r.disk },
          { key: "net", label: "Network" },
          { key: "uptime", label: "Uptime" },
          { key: "spark", label: "CPU trend", render: (r) => r.spark },
          { key: "latest", label: "Last sample" },
        ], rows, { scroll: true, emptyText: "No devices yet." }));

    ui.bind(panel, "click", "[data-act]", async (t, e, act) => {
      if (act !== "met-sample-all") return;
      t.disabled = true;
      const r = await MET.requestSample(providerId, []);
      t.disabled = false;
      if (r.error) { toast("Request failed: " + r.error, "error"); return; }
      toast(r.requested + " device(s) will send a sample on their next check-in." + (r.unsupported ? " " + r.unsupported + " agent(s) do not report metrics." : ""), "success");
      refresh();
    });
  };

  /* ─────────────────────── demo seed ─────────────────────── */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Seed ~24h of plausible samples for the demo fleet so a fresh console
     has real-looking charts and roll-ups. Console-originated, like an
     import, so it bypasses authentication. */
  MET.seedDemo = async function () {
    const providers = await T.list();
    const records = await load();
    let changed = false;
    for (const p of providers) {
      if (!p.demo) continue;
      const g = await T.get(p.id);
      if (g.error) continue;
      for (const d of asArr(g.provider.devices).map(D.normalizeDevice)) {
        if (seriesFor(records, d.id)) continue;
        const caps = asArr(asObj(d.agent).capabilities);
        if (caps.length && caps.indexOf("metrics") === -1) continue;
        const rec = newSeries(d.id, p.id);
        const rnd = mulberry32(String(d.id).split("").reduce((a, c) => a + c.charCodeAt(0), 7));
        const isServer = d.role === "server";
        const baseCpu = isServer ? 18 : 9;
        const n = 288; /* 24h @ 5min */
        const nowMs = Date.now();
        for (let i = n; i >= 0; i--) {
          const at = new Date(nowMs - i * 5 * 60000).toISOString();
          const hour = new Date(at).getUTCHours();
          const wave = Math.max(0, Math.sin(((hour - 8) / 24) * Math.PI * 2));
          const cpu = Math.max(1, Math.min(100, baseCpu + wave * (isServer ? 22 : 26) + rnd() * 16 + (rnd() > 0.96 ? 40 : 0)));
          const mem = Math.max(12, Math.min(99, (isServer ? 55 : 48) + wave * 8 + rnd() * 10));
          const disk = d.disks && d.disks.length ? Math.max(5, Math.min(99, (1 - (num(d.disks[0].freeBytes, 0) / Math.max(1, num(d.disks[0].sizeBytes, 1)))) * 100)) : 40 + rnd() * 20;
          const rx = Math.round((isServer ? 400000 : 60000) * (0.4 + wave + rnd()));
          const tx = Math.round((isServer ? 260000 : 40000) * (0.4 + wave + rnd()));
          MET.append(rec, {
            at, cpuPct: cpu, memPct: mem,
            memUsedBytes: Math.round(num(d.ramBytes, 8 * 1024 * 1024 * 1024) * (mem / 100)), memTotalBytes: num(d.ramBytes, 8 * 1024 * 1024 * 1024),
            diskPct: disk, diskFreeBytes: d.disks && d.disks[0] ? num(d.disks[0].freeBytes, 0) : 0, diskTotalBytes: d.disks && d.disks[0] ? num(d.disks[0].sizeBytes, 0) : 0,
            diskReadBps: Math.round((isServer ? 900000 : 150000) * (0.3 + rnd())), diskWriteBps: Math.round((isServer ? 500000 : 90000) * (0.3 + rnd())),
            netRxBps: rx, netTxBps: tx, latencyMs: Math.round(4 + rnd() * 30), uptimeSeconds: Math.round((isServer ? 86400 * 41 : 86400 * 3.2) + rnd() * 3600),
            load1: Math.round((cpu / 100) * (isServer ? 4 : 2) * 100) / 100, load5: 0.4, load15: 0.3,
            custom: { queueDepth: Math.round(rnd() * 12), sessions: Math.round(rnd() * 30) },
          });
        }
        rec.latest.hostname = d.hostname;
        records.push(rec);
        await patchDevice(p.id, d.id, rec);
        changed = true;
      }
    }
    if (changed) {
      const w = await save(records);
      if (w && w.error) return { error: w.error };
    }
    return { ok: true, changed };
  };

  MET.init = async function () {
    try { await MET.seedDemo(); } catch (e) { console.error("metrics seed failed", e); }
    return MET;
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", MET.init);
  else MET.init();
})();
