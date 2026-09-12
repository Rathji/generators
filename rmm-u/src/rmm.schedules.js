/* ============================================================
   RMM-U — schedules & maintenance windows  (Phase 4 · Task 21)

   The master configuration already owns the *catalogues*: named
   schedules, business-hours calendars and maintenance windows, in
   the `rmm-v1-config` document, with the primitives
   `M.zonedParts` / `M.inBusinessHours` / `M.maintenanceActive`
   (src/rmm.master.js). This module is the operational layer every
   later station asks: "is this device in business hours?", "which
   maintenance windows cover this device right now?", "may I run this
   job?", and — crucially — it records what it suppressed or deferred
   so there is an audit trail rather than a silent black hole.

   • Schedules resolve to a concrete next occurrence
     (`SCH.nextRun`) using the provider/schedule timezone, with a
     cron matcher (`SCH.cronMatch`) that understands `*`, lists,
     ranges, steps and weekday names. `SCH.isDue` answers "was this
     schedule due in the last N minutes?" — the hook the automation
     engine's `schedule` trigger uses.
   • Business hours are per-client: `SCH.calendarStatus(provider, at,
     calendarId)` resolves a calendar (explicit → master default →
     provider timezone) and reports weekend / in-hours / after-hours.
   • Maintenance windows are matched by SCOPE — global · provider ·
     site · group · device — so one window suppresses the right
     slice of the fleet (`SCH.windowsCovering`), and
     `SCH.isSuppressed` applies the severity rule: a window
     suppresses at-or-below the master `maintenanceSuppressSeverity`,
     unless it `allowCritical` and the alert is critical.
   • `SCH.gateJob` is the "defer non-essential jobs" gate: a job that
     is not essential is held while a deferring window covers its
     device, recorded, and later replayed by `SCH.releaseDeferred`.
   • The hidden `rmm-v1-suppressions` document holds the suppression
     log and the deferral queue.

   window.ERP.schedules is both the service and the Automations →
   "Schedules & windows" panel (it can also render standalone).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.masterConfig) return;
  const store = ERP.store;
  const M = ERP.masterConfig;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const SCH = (ERP.schedules = {});

  SCH.MODULE = "suppressions";
  SCH.KINDS = ["interval", "daily", "weekly", "monthly", "cron"];
  SCH.WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  SCH.WEEKEND = ["sat", "sun"];
  const PW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cap = () => Math.max(50, num(cfg("rmm.suppressionsCap", 500), 500));
  const G = () => window.ERP.groups || null;

  /* ═══════════════════════ time & schedules ═══════════════════════ */

  SCH.zoned = (date, tz) => M.zonedParts(date, tz);
  const zoned = (d, tz) => M.zonedParts(d, tz);

  SCH.timeToMinutes = function (t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  function pad(n) { return String(n).padStart(2, "0"); }
  SCH.minutesToTime = (m) => pad(Math.floor(((m % 1440) + 1440) % 1440 / 60)) + ":" + pad((((m % 1440) + 1440) % 1440) % 60);

  SCH.isWeekend = function (at, tz) {
    const p = zoned(at || new Date(), tz);
    return SCH.WEEKEND.indexOf(p.weekday) !== -1;
  };

  /* ── cron ──
     Five fields: minute hour day-of-month month day-of-week.
     Supports star, a, a,b, a-b, star-slash-n and a-b-slash-n steps,
     plus weekday names (mon…sun). */
  function fieldMatch(field, value, min, max, names) {
    const f = String(field == null ? "*" : field).trim();
    if (f === "*" || f === "") return true;
    const norm = (x) => {
      const s = low(x);
      if (names && Object.prototype.hasOwnProperty.call(names, s)) return names[s];
      const n = Number(s);
      return isFinite(n) ? n : NaN;
    };
    return f.split(",").some((part) => {
      part = part.trim();
      if (!part) return false;
      if (part === "*") return true;
      let step = 1;
      let range = part;
      const slash = part.indexOf("/");
      if (slash !== -1) { range = part.slice(0, slash); step = Math.max(1, Number(part.slice(slash + 1)) || 1); }
      if (range === "*") return (value - min) % step === 0;
      const dash = range.indexOf("-");
      if (dash > 0) {
        const a = norm(range.slice(0, dash));
        const b = norm(range.slice(dash + 1));
        if (!isFinite(a) || !isFinite(b)) return false;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        if (value < lo || value > hi) return false;
        return (value - lo) % step === 0;
      }
      const n = norm(range);
      if (!isFinite(n)) return false;
      if (n === 7 && max === 7 && value === 0) return true; // sunday as 7
      return value === n;
    });
  }

  SCH.cronMatch = function (expr, parts) {
    const f = String(expr || "").trim().split(/\s+/);
    if (f.length < 5) return false;
    const [mi, ho, dom, mo, dow] = f;
    parts = asObj(parts);
    if (!fieldMatch(mi, num(parts.minute, 0), 0, 59)) return false;
    if (!fieldMatch(ho, num(parts.hour, 0), 0, 23)) return false;
    if (!fieldMatch(mo, num(parts.month, 1), 1, 12)) return false;
    const domRestricted = String(dom).trim() !== "*";
    const dowRestricted = String(dow).trim() !== "*";
    const domOk = fieldMatch(dom, num(parts.day, 1), 1, 31);
    const dowOk = fieldMatch(dow, num(parts.weekday, 0), 0, 7, DOW);
    if (domRestricted && dowRestricted) return domOk || dowOk;
    return domOk && dowOk;
  };

  function monthDay(sched, date) {
    if (sched.startDate) { const d = Number(String(sched.startDate).slice(8, 10)); if (d >= 1 && d <= 31) return d; }
    return 1;
  }

  /* Whether a schedule's rule matches a zoned instant (minute precision). */
  SCH.scheduleMatches = function (sched, p) {
    sched = asObj(sched);
    const kind = SCH.KINDS.indexOf(sched.kind) !== -1 ? sched.kind : "interval";
    if (kind === "interval") return true;
    if (kind === "cron") return SCH.cronMatch(sched.cron, { minute: p.minutes % 60, hour: Math.floor(p.minutes / 60), day: Number(p.date.slice(8, 10)), month: Number(p.date.slice(5, 7)), weekday: PW[p.weekday] });
    const timeOk = p.time === (sched.timeOfDay || "02:00");
    if (kind === "daily") return timeOk;
    if (kind === "weekly") return timeOk && asArr(sched.daysOfWeek).map(low).indexOf(p.weekday) !== -1;
    return timeOk && Number(p.date.slice(8, 10)) === monthDay(sched, p.date);
  };

  SCH.nextRun = function (sched, from, tz) {
    sched = asObj(sched);
    if (sched.enabled === false) return null;
    const tz2 = tz || sched.timezone || cfg("rmm.defaultTimezone", "UTC");
    const f = from ? new Date(from) : new Date();
    const start = new Date(Math.floor(f.getTime() / 60000) * 60000 + 60000);
    const kind = SCH.KINDS.indexOf(sched.kind) !== -1 ? sched.kind : "interval";
    if (kind === "interval") {
      const iv = Math.max(1, num(sched.intervalMinutes, 15));
      const p0 = zoned(start, tz2);
      const delta = (iv - (p0.minutes % iv)) % iv || iv;
      return new Date(start.getTime() + delta * 60000).toISOString();
    }
    const steps = kind === "cron" ? 60 * 24 * 14 : 60 * 24 * 8;
    let cur = start;
    for (let i = 0; i < steps; i++) {
      const p = zoned(cur, tz2);
      if (SCH.scheduleMatches(sched, p)) return cur.toISOString();
      cur = new Date(cur.getTime() + 60000);
    }
    return null;
  };

  SCH.isDue = function (sched, at, tz, windowMinutes) {
    const atMs = at ? Date.parse(at) : Date.now();
    const w = Math.max(1, num(windowMinutes, 1));
    const n = SCH.nextRun(sched, new Date(atMs - w * 60000), tz);
    return !!n && Date.parse(n) <= atMs;
  };

  SCH.scheduleActive = function (sched, at, tz) { return SCH.isDue(sched, at, tz, 1); };

  SCH.scheduleDetail = function (sched) {
    sched = asObj(sched);
    const kind = sched.kind || "interval";
    if (kind === "interval") return "every " + num(sched.intervalMinutes, 15) + " min";
    if (kind === "cron") return sched.cron || "—";
    if (kind === "weekly") return (asArr(sched.daysOfWeek).join(", ") || "mon") + " at " + (sched.timeOfDay || "");
    if (kind === "monthly") return "day " + monthDay(sched) + " at " + (sched.timeOfDay || "");
    return sched.timeOfDay || "";
  };
  SCH.scheduleLabel = (sched) => (asObj(sched).label || asObj(sched).id || "schedule");

  /* ═══════════════════════ business hours ═══════════════════════ */

  async function defaultCalendarId() {
    try { const s = await M.settings(); return s.defaultCalendar || null; } catch (e) { return null; }
  }
  SCH.defaultCalendarId = defaultCalendarId;

  async function resolveCalendar(provider, calendarId) {
    const c = await M.current();
    const list = asArr(asObj(c.sections).calendars);
    let cal = calendarId ? list.find((x) => String(x.id) === String(calendarId)) : null;
    if (!cal) cal = list.find((x) => x.isDefault && x.enabled !== false) || list.find((x) => x.enabled !== false) || null;
    if (!cal) {
      const tz = (provider && provider.timezone) || cfg("rmm.defaultTimezone", "UTC");
      return { id: "", label: "24×7 (no calendar)", timezone: tz, workdays: [], startTime: "00:00", endTime: "23:59", holidays: [] };
    }
    return cal;
  }
  SCH.resolveCalendar = resolveCalendar;

  /* provider may be a provider object or a provider id. */
  SCH.calendarStatus = async function (provider, at, calendarId) {
    let p = provider;
    if (typeof provider === "string" || typeof provider === "number") {
      const g = await T.get(provider);
      p = g && !g.error ? g.provider : null;
    }
    const cal = await resolveCalendar(p, calendarId);
    const tz = cal.timezone || (p && p.timezone) || cfg("rmm.defaultTimezone", "UTC");
    const instant = at || now();
    const zp = zoned(instant, tz);
    const inHours = await M.inBusinessHours(instant, cal.id || null);
    return {
      calendarId: cal.id || "", label: cal.label || cal.id || "", timezone: tz,
      weekday: zp.weekday, date: zp.date, time: zp.time,
      weekend: SCH.WEEKEND.indexOf(zp.weekday) !== -1,
      inHours: !!inHours, afterHours: !inHours,
      opens: cal.startTime, closes: cal.endTime,
    };
  };

  SCH.inBusinessHours = async function (provider, at, calendarId) {
    return (await SCH.calendarStatus(provider, at, calendarId)).inHours;
  };

  /* ═══════════════════════ maintenance windows ═══════════════════════ */

  SCH.windowCovers = function (w, providerId, scope) {
    w = asObj(w); scope = asObj(scope);
    const type = w.scope || "global";
    if (type === "global") return true;
    const sid = String(w.scopeId || "");
    if (!sid) return false;
    if (type === "provider") return String(providerId || "") === sid;
    if (type === "site") return String(scope.siteId || "") === sid;
    if (type === "group") return asArr(scope.groupIds).map(String).indexOf(sid) !== -1;
    if (type === "device") return String(scope.deviceId || "") === sid;
    return false;
  };

  SCH.windowsCovering = async function (providerId, scope, at) {
    const c = await M.current();
    const instant = at || now();
    return asArr(asObj(c.sections).maintenanceWindows)
      .filter((w) => w.enabled !== false && SCH.windowCovers(w, providerId, scope) && M.maintenanceActive(w, instant))
      .map(clone);
  };

  SCH.deferWindows = async function (providerId, scope, at) {
    const wins = await SCH.windowsCovering(providerId, scope, at);
    return wins.filter((w) => w.deferJobs !== false);
  };

  SCH.alertWindows = async function (providerId, scope, at) {
    const wins = await SCH.windowsCovering(providerId, scope, at);
    return wins.filter((w) => w.suppressAlerts !== false);
  };

  /* ── severity helpers ── */
  async function severities() { return asArr((await M.current()).sections.severities); }

  SCH.severityInfo = async function (id) {
    const list = await severities();
    const it = list.find((s) => String(s.id) === String(id)) || null;
    if (!it) return null;
    return { id: it.id, label: it.label, rank: num(it.rank, 0), tone: it.tone || "info", notify: it.notify !== false, critical: low(it.tone) === "danger" };
  };

  SCH.suppressBelowRank = async function () {
    const s = await M.settings();
    const info = await SCH.severityInfo(s.maintenanceSuppressSeverity);
    return info ? info.rank : 20;
  };

  /* Does a severity get suppressed inside a window? */
  function windowSuppresses(w, info) {
    if (w.suppressAlerts === false) return false;
    if (!info) return true;
    if (w.allowCritical === false) return true;
    if (info.critical) return false;
    const below = num(w.__below, 20);
    return info.rank <= below;
  }

  /* scope may be {deviceId, siteId, groupIds}. */
  SCH.isSuppressed = async function (providerId, scope, at, severityId) {
    const wins = await SCH.alertWindows(providerId, scope, at);
    const deferWins = (await SCH.windowsCovering(providerId, scope, at)).filter((w) => w.deferJobs !== false);
    const out = { suppressed: false, windows: [], deferWindows: deferWins.map((w) => w.id), allowCritical: false, critical: false, reason: "no active window" };
    if (!wins.length) return out;
    const below = await SCH.suppressBelowRank();
    const info = severityId ? await SCH.severityInfo(severityId) : null;
    out.critical = !!(info && info.critical);
    out.allowCritical = wins.some((w) => w.allowCritical !== false);
    const hits = wins.filter((w) => windowSuppresses(Object.assign({ __below: below }, w), info));
    out.windows = hits.map((w) => w.id);
    out.suppressed = hits.length > 0;
    if (out.suppressed) {
      const names = hits.map((w) => w.label || w.id);
      out.reason = "maintenance window " + names.join(", ") + (info ? " (severity " + info.label + ")" : "");
    }
    return out;
  };

  /* ── scopes ── */

  SCH.scopeFor = async function (providerId, deviceId) {
    const g = await T.get(providerId);
    if (g.error) return { deviceId: String(deviceId), siteId: null, groupIds: [] };
    const dev = asArr(g.provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { deviceId: String(deviceId), siteId: null, groupIds: [] };
    let groupIds = asArr(dev.groupIds).map(String);
    const Gr = G();
    if (Gr && typeof Gr.membershipIds === "function") {
      try {
        const idx = typeof Gr.loadIndex === "function" ? await Gr.loadIndex(providerId) : { soft: {}, svc: {}, patches: {} };
        groupIds = Gr.membershipIds(g.provider, dev, { provider: g.provider, soft: idx.soft || {}, svc: idx.svc || {}, patches: idx.patches || {} });
      } catch (e) {}
    }
    return { deviceId: String(dev.id), siteId: dev.siteId != null && dev.siteId !== "" ? String(dev.siteId) : null, groupIds: groupIds.map(String) };
  };

  SCH.scopesFor = async function (providerId, deviceIds) {
    const ids = asArr(deviceIds).map(String);
    const out = {};
    const g = await T.get(providerId);
    if (g.error) { ids.forEach((id) => { out[id] = { deviceId: id, siteId: null, groupIds: [] }; }); return out; }
    const devices = asArr(g.provider.devices).map(D.normalizeDevice);
    const Gr = G();
    let ctx = null;
    if (Gr && typeof Gr.loadIndex === "function") {
      try { const idx = await Gr.loadIndex(providerId); ctx = { provider: g.provider, soft: idx.soft || {}, svc: idx.svc || {}, patches: idx.patches || {} }; } catch (e) {}
    }
    ids.forEach((id) => {
      const dev = devices.find((d) => String(d.id) === id);
      if (!dev) { out[id] = { deviceId: id, siteId: null, groupIds: [] }; return; }
      let groupIds = asArr(dev.groupIds).map(String);
      if (Gr && ctx && typeof Gr.membershipIds === "function") { try { groupIds = Gr.membershipIds(g.provider, dev, ctx); } catch (e) {} }
      out[id] = { deviceId: id, siteId: dev.siteId != null && dev.siteId !== "" ? String(dev.siteId) : null, groupIds: groupIds.map(String) };
    });
    return out;
  };

  /* ═══════════════════════ suppression audit log ═══════════════════════ */

  async function load() { const r = await store.loadDoc(SCH.MODULE); return asArr(r.error ? [] : r.records); }
  async function save(list) { return store.saveDoc(SCH.MODULE, list); }
  SCH.load = load;

  async function push(record) {
    const rows = await load();
    rows.push(record);
    const trimmed = rows.slice(Math.max(0, rows.length - cap()));
    const w = await save(trimmed);
    if (w && w.error) return { error: w.error, message: w.message };
    return { ok: true, record: clone(record) };
  }

  /* entry: { providerId, deviceId, scope, severityId, windowIds, reason, at, source, meta } */
  SCH.recordSuppression = function (entry) {
    entry = asObj(entry);
    return push({
      kind: "suppression",
      id: rid("sup"),
      providerId: entry.providerId || null,
      deviceId: entry.deviceId ? String(entry.deviceId) : null,
      severityId: entry.severityId || null,
      windowIds: asArr(entry.windowIds).map(String),
      reason: String(entry.reason || "").slice(0, 300),
      source: String(entry.source || "console").slice(0, 120),
      at: entry.at || now(),
      meta: asObj(entry.meta),
    });
  };

  SCH.suppressions = async function (providerId, opts) {
    opts = opts || {};
    let rows = (await load()).filter((r) => r.kind === "suppression");
    if (providerId) rows = rows.filter((r) => String(r.providerId) === String(providerId));
    if (opts.windowId) rows = rows.filter((r) => asArr(r.windowIds).map(String).indexOf(String(opts.windowId)) !== -1);
    rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return clone(rows);
  };

  SCH.clearSuppressions = async function (providerId) {
    const rows = await load();
    const kept = rows.filter((r) => !(r.kind === "suppression" && (!providerId || String(r.providerId) === String(providerId))));
    const w = await save(kept);
    if (w && w.error) return { error: w.error };
    return { ok: true, removed: rows.length - kept.length };
  };

  /* ═══════════════════════ job deferral ═══════════════════════ */

  /* payload is the DSP.enqueue options minus deviceIds. */
  SCH.defer = function (providerId, entry) {
    entry = asObj(entry);
    const deviceIds = asArr(entry.deviceIds).map(String).filter(Boolean);
    if (!deviceIds.length) return Promise.resolve({ error: "no_devices" });
    return push({
      kind: "deferral",
      id: rid("dfr"),
      providerId,
      deviceIds,
      payload: clone(entry.payload) || {},
      jobKind: String(entry.jobKind || entry.kind || "job").slice(0, 80),
      refId: entry.refId != null ? String(entry.refId) : null,
      windowIds: asArr(entry.windowIds).map(String),
      reason: String(entry.reason || "maintenance window").slice(0, 300),
      status: "pending",
      deferredAt: entry.at || now(),
      releasedAt: "",
      released: [],
    });
  };

  SCH.deferred = async function (providerId, opts) {
    opts = opts || {};
    let rows = (await load()).filter((r) => r.kind === "deferral");
    if (providerId) rows = rows.filter((r) => String(r.providerId) === String(providerId));
    if (!opts.all) rows = rows.filter((r) => r.status === "pending");
    rows.sort((a, b) => Date.parse(b.deferredAt) - Date.parse(a.deferredAt));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return clone(rows);
  };

  /* Pre-flight gate: split devices into allowed vs deferred-now. */
  SCH.gateJob = async function (providerId, opts) {
    opts = opts || {};
    const deviceIds = asArr(opts.deviceIds).map(String).filter(Boolean);
    const scopes = await SCH.scopesFor(providerId, deviceIds);
    const at = opts.at || now();
    const allowed = [], deferred = [];
    for (const id of deviceIds) {
      const sc = scopes[id] || { deviceId: id, groupIds: [] };
      const wins = opts.essential ? [] : await SCH.deferWindows(providerId, sc, at);
      if (wins.length) deferred.push({ deviceId: id, windowIds: wins.map((w) => w.id), reason: "maintenance window " + wins.map((w) => w.label || w.id).join(", ") });
      else allowed.push(id);
    }
    return { allowed, deferred, allowedDeviceIds: allowed, deferredDeviceIds: deferred.map((d) => d.deviceId), scopes };
  };

  /* Re-enqueue deferrals whose devices are no longer covered. */
  SCH.releaseDeferred = async function (providerId, at) {
    const rows = await load();
    const pending = rows.filter((r) => r.kind === "deferral" && r.status === "pending" && (!providerId || String(r.providerId) === String(providerId)));
    const DSP = window.ERP.dispatch;
    const scopeCache = {};
    let released = 0, jobs = 0, remaining = 0;
    for (const rec of pending) {
      const scopes = scopeCache[rec.providerId] || (scopeCache[rec.providerId] = await SCH.scopesFor(rec.providerId, rec.deviceIds));
      const instant = at || now();
      const free = [];
      for (const id of rec.deviceIds) {
        const wins = await SCH.deferWindows(rec.providerId, scopes[id] || { deviceId: id, groupIds: [] }, instant);
        if (!wins.length) free.push(id);
      }
      if (free.length && DSP && typeof DSP.enqueue === "function" && rec.payload) {
        try {
          const r = await DSP.enqueue(Object.assign({}, rec.payload, { deviceIds: free }));
          if (!r.error) jobs++;
          else free.length = 0;
        } catch (e) { free.length = 0; }
      } else if (free.length) {
        free.length = 0; // no dispatcher available — stay pending
      }
      if (free.length) {
        rec.released = asArr(rec.released).concat(free);
        rec.deviceIds = rec.deviceIds.filter((x) => free.indexOf(x) === -1);
        rec.releasedAt = instant;
        released += free.length;
        if (!rec.deviceIds.length) rec.status = "released";
      }
      if (rec.status === "pending") remaining++;
    }
    const w = await save(rows);
    if (w && w.error) return { error: w.error };
    return { ok: true, released, jobs, remaining };
  };

  SCH.deferralStats = async function (providerId) {
    const rows = await SCH.deferred(providerId, { all: true });
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      released: rows.filter((r) => r.status === "released").length,
      devices: rows.reduce((n, r) => n + asArr(r.deviceIds).length + asArr(r.released).length, 0),
    };
  };

  SCH.stats = async function (providerId) {
    const sup = await SCH.suppressions(providerId, {});
    const byWindow = {}, bySeverity = {};
    sup.forEach((r) => {
      asArr(r.windowIds).forEach((w) => { byWindow[w] = (byWindow[w] || 0) + 1; });
      if (r.severityId) bySeverity[r.severityId] = (bySeverity[r.severityId] || 0) + 1;
    });
    const def = await SCH.deferralStats(providerId);
    return { suppressions: sup.length, byWindow, bySeverity, lastAt: sup.length ? sup[0].at : null, deferred: def.pending, deferralsReleased: def.released, devices: def.devices };
  };

  /* ═══════════════════════ station UI ═══════════════════════ */

  SCH.currentProviderId = null;

  function scopedShowTab(el, id) {
    el.querySelectorAll(":scope > .erp-tabs > [data-tab]").forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === id));
    el.querySelectorAll(":scope > .erp-tabs-content > [data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === id));
  }
  SCH.scopedShowTab = scopedShowTab;

  /* ── panels ── */

  async function schedulesPanel(provider, state) {
    const ui = ERP.ui, esc = ui.esc;
    const schedules = await M.section("schedules");
    const status = await SCH.calendarStatus(provider, state.at);
    const rows = schedules.map((s) => ({
      name: '<b>' + esc(s.label) + "</b>" + (s.description ? '<div class="erp-sub">' + esc(s.description) + "</div>" : ""),
      kind: ui.badge(s.kind || "interval", "info"),
      detail: esc(SCH.scheduleDetail(s)),
      tz: esc(s.timezone || "—"),
      next: s.enabled === false ? ui.badge("disabled", "muted") : esc(SCH.nextRun(s, state.at) ? ui.dateTime(SCH.nextRun(s, state.at)) : "—"),
      state: ui.badge(s.enabled === false ? "disabled" : "enabled", s.enabled === false ? "muted" : "success"),
    }));
    return ui.summary([
      { label: "Schedules", value: String(schedules.length) },
      { label: "Enabled", value: String(schedules.filter((s) => s.enabled !== false).length) },
      { label: "Now", value: esc(status.time) + " " + esc(status.weekday) },
      { label: "This client", value: ui.badge(status.inHours ? "in business hours" : "after hours", status.inHours ? "success" : "warn") },
    ]) +
      ui.table([
        { key: "name", label: "Schedule", render: (r) => r.name },
        { key: "kind", label: "Kind", render: (r) => r.kind },
        { key: "detail", label: "Recurrence", render: (r) => r.detail },
        { key: "tz", label: "Timezone", render: (r) => r.tz },
        { key: "next", label: "Next run", render: (r) => r.next },
        { key: "state", label: "State", render: (r) => r.state },
      ], rows, { scroll: true, emptyText: "No schedules defined in the master configuration." });
  }

  async function hoursPanel(provider, state) {
    const ui = ERP.ui, esc = ui.esc;
    const c = await M.current();
    const calendars = asArr(asObj(c.sections).calendars);
    const status = await SCH.calendarStatus(provider, state.at);
    const defId = (await M.settings()).defaultCalendar;
    const rows = [];
    for (const cal of calendars) {
      const st = await SCH.calendarStatus(provider, state.at, cal.id);
      rows.push({
        name: '<b>' + esc(cal.label) + "</b>" + (String(cal.id) === String(defId) ? " " + ui.badge("default", "info") : "") + (cal.isDefault ? " " + ui.badge("default", "info") : ""),
        tz: esc(cal.timezone || "—"),
        days: asArr(cal.workdays).map((d) => ui.badge(d, "muted")).join(" ") || '<span class="erp-sub">every day</span>',
        hours: esc((cal.startTime || "00:00") + "–" + (cal.endTime || "23:59")),
        today: ui.badge(st.inHours ? "open now" : (st.weekend ? "weekend" : "closed"), st.inHours ? "success" : "muted"),
        state: ui.badge(cal.enabled === false ? "disabled" : "enabled", cal.enabled === false ? "muted" : "success"),
      });
    }
    const today = asArr(status.weekday) + ", " + status.date;
    return ui.grid([
      ui.statCard({ label: "Business-hours status", value: ui.badge(status.inHours ? "In hours" : (status.weekend ? "Weekend" : "After hours"), status.inHours ? "success" : "warn"), sub: esc(status.label) }),
      ui.statCard({ label: "Local time (" + esc(status.timezone) + ")", value: esc(status.time), sub: esc(today) }),
      ui.statCard({ label: "Calendar", value: esc(status.label), sub: esc(status.opens + "–" + status.closes) }),
    ], "cols-3") +
      ui.table([
        { key: "name", label: "Calendar", render: (r) => r.name },
        { key: "tz", label: "Timezone", render: (r) => r.tz },
        { key: "days", label: "Working days", render: (r) => r.days },
        { key: "hours", label: "Hours", render: (r) => r.hours },
        { key: "today", label: "Now", render: (r) => r.today },
        { key: "state", label: "State", render: (r) => r.state },
      ], rows, { scroll: true, emptyText: "No calendars defined in the master configuration." });
  }

  function scopeLabel(p, w) {
    const type = w.scope || "global";
    if (type === "global") return "every device";
    if (type === "provider") return "this client";
    if (type === "site") { const s = asArr(p.sites).find((x) => String(x.id) === String(w.scopeId)); return "site " + (s ? s.name : w.scopeId); }
    if (type === "group") { const g = asArr(p.deviceGroups).find((x) => String(x.id) === String(w.scopeId)); return "group " + (g ? g.name : w.scopeId); }
    if (type === "device") { const d = asArr(p.devices).map(D.normalizeDevice).find((x) => String(x.id) === String(w.scopeId)); return "device " + (d ? (d.hostname || d.displayName) : w.scopeId); }
    return type;
  }

  async function windowsPanel(provider, state) {
    const ui = ERP.ui, esc = ui.esc;
    const c = await M.current();
    const windows = asArr(asObj(c.sections).maintenanceWindows);
    const rows = [];
    for (const w of windows) {
      const active = w.enabled !== false && M.maintenanceActive(w, state.at);
      rows.push({
        name: '<b>' + esc(w.label) + "</b>" + (w.description ? '<div class="erp-sub">' + esc(w.description) + "</div>" : ""),
        scope: esc(scopeLabel(provider, w)),
        recur: esc(w.recurrence || "daily") + (asArr(w.daysOfWeek).length ? " · " + esc(asArr(w.daysOfWeek).join(", ")) : "") + " " + esc((w.startTime || "") + "–" + (w.endTime || "")),
        tz: esc(w.timezone || "—"),
        now: active ? ui.badge("active now", "warn") : ui.badge("idle", "muted"),
        suppress: w.suppressAlerts === false ? ui.badge("no", "muted") : (w.allowCritical === false ? ui.badge("all severities", "danger") : ui.badge("below critical", "info")),
        defer: w.deferJobs === false ? ui.badge("no", "muted") : ui.badge("yes", "info"),
        actions: ui.btn(w.enabled === false ? "Enable" : "Disable", { small: true, act: "sch-toggle-window", arg: w.id }),
      });
    }
    return ui.summary([
      { label: "Windows", value: String(windows.length) },
      { label: "Enabled", value: String(windows.filter((w) => w.enabled !== false).length) },
      { label: "Active now", value: String(rows.filter((r) => /active now/.test(r.now)).length) },
      { label: "Deferral", value: cfg("rmm.maintenanceDefersJobs", true) === false ? ui.badge("off", "muted") : ui.badge("on", "info") },
    ]) +
      ui.table([
        { key: "name", label: "Window", render: (r) => r.name },
        { key: "scope", label: "Scope", render: (r) => r.scope },
        { key: "recur", label: "When", render: (r) => r.recur },
        { key: "tz", label: "Timezone", render: (r) => r.tz },
        { key: "now", label: "Status", render: (r) => r.now },
        { key: "suppress", label: "Alerts", render: (r) => r.suppress },
        { key: "defer", label: "Defers jobs", render: (r) => r.defer },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No maintenance windows defined." }) +
      '<p class="erp-sub">A window suppresses alerts at or below the master “Maintenance suppresses below” severity, unless it is flagged to let critical alerts through. Windows marked “defers jobs” also hold non-essential scheduled jobs until the window ends — every suppression and deferral is recorded below.</p>';
  }

  async function logPanel(provider, state) {
    const ui = ERP.ui, esc = ui.esc;
    const sups = await SCH.suppressions(state.pid, { limit: 200 });
    const defs = await SCH.deferred(state.pid, { all: true, limit: 200 });
    const stats = await SCH.stats(state.pid);
    const deviceName = (id) => {
      const d = asArr(provider.devices).map(D.normalizeDevice).find((x) => String(x.id) === String(id));
      return d ? (d.hostname || d.displayName) : (id || "—");
    };
    const st = await severities();
    const sevLabel = (id) => { const s = st.find((x) => String(x.id) === String(id)); return s ? s.label : (id || "—"); };
    const winLabel = (id) => { const c = state.config && asArr(asObj(state.config.sections).maintenanceWindows).find((w) => String(w.id) === String(id)); return c ? (c.label || id) : id; };

    const supRows = sups.map((r) => ({
      at: esc(ui.dateTime(r.at)),
      device: esc(deviceName(r.deviceId)),
      severity: ui.badge(sevLabel(r.severityId), "muted"),
      windows: asArr(r.windowIds).map((w) => ui.badge(winLabel(w), "info")).join(" ") || "—",
      reason: '<span class="erp-sub">' + esc(r.reason || "") + "</span>",
    }));
    const defRows = defs.map((r) => ({
      at: esc(ui.dateTime(r.deferredAt)),
      kind: ui.badge(r.jobKind || "job", "info"),
      devices: esc(asArr(r.deviceIds).map(deviceName).join(", ")),
      windows: asArr(r.windowIds).map((w) => ui.badge(winLabel(w), "info")).join(" ") || "—",
      status: r.status === "pending" ? ui.badge("deferred", "warn") : ui.badge("released", "success"),
      actions: r.status === "pending" ? ui.btn("Release now", { small: true, act: "sch-release", arg: r.id }) : '<span class="erp-sub">' + esc(r.releasedAt ? ui.dateTime(r.releasedAt) : "") + "</span>",
    }));
    return ui.summary([
      { label: "Suppressions logged", value: String(stats.suppressions) },
      { label: "Pending deferrals", value: String(stats.deferred) },
      { label: "Released deferrals", value: String(stats.deferralsReleased) },
      { label: "Last suppression", value: stats.lastAt ? esc(ui.dateTime(stats.lastAt)) : "—" },
    ]) +
      ui.card("Suppression log", ui.table([
        { key: "at", label: "When", render: (r) => r.at },
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "severity", label: "Severity", render: (r) => r.severity },
        { key: "windows", label: "Window", render: (r) => r.windows },
        { key: "reason", label: "Reason", render: (r) => r.reason },
      ], supRows, { scroll: true, emptyText: "Nothing suppressed yet — suppressed alerts and deferred jobs appear here." }), {
        actions: sups.length ? ui.btn("Clear log", { small: true, act: "sch-clear-log" }) : "",
      }) +
      ui.card("Deferral queue", ui.table([
        { key: "at", label: "Deferred", render: (r) => r.at },
        { key: "kind", label: "Job", render: (r) => r.kind },
        { key: "devices", label: "Devices", render: (r) => r.devices },
        { key: "windows", label: "Window", render: (r) => r.windows },
        { key: "status", label: "Status", render: (r) => r.status },
        { key: "actions", label: "", render: (r) => r.actions },
      ], defRows, { scroll: true, emptyText: "No jobs deferred." }), {
        actions: defs.some((r) => r.status === "pending") ? ui.btn("Release all due", { small: true, primary: true, act: "sch-release-all" }) : "",
      });
  }

  async function mount(host, ctx, opts) {
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (host) host.innerHTML = '<div class="erp-alert">No service providers yet.</div>'; return; }
    const TABS = ["schedules", "hours", "windows", "log"];
    const state = {
      pid: (SCH.currentProviderId && providers.some((p) => p.id === SCH.currentProviderId)) ? SCH.currentProviderId : (opts.providerId || providers[0].id),
      tab: TABS.indexOf(opts.tab) !== -1 ? opts.tab : "schedules",
      at: opts.at || now(),
      testDevice: "",
      config: null,
    };
    SCH.currentProviderId = state.pid;

    const prov = async () => { const g = await T.get(state.pid); return g.error ? null : g.provider; };

    async function paint() {
      const p = await prov();
      if (!p) { host.innerHTML = '<div class="erp-alert">This tenant could not be loaded.</div>'; return; }
      state.config = await M.current();
      const tabs = ui.tabs([
        { id: "schedules", label: "Schedules" },
        { id: "hours", label: "Business hours" },
        { id: "windows", label: "Maintenance windows" },
        { id: "log", label: "Suppression log" },
      ], state.tab);
      const picker = providers.length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="pid">' +
          providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === state.pid ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      host.innerHTML = (opts.headHtml || "") + tabs.html + picker;
      host.querySelector('[data-panel="schedules"]').innerHTML = await schedulesPanel(p, state);
      host.querySelector('[data-panel="hours"]').innerHTML = await hoursPanel(p, state);
      host.querySelector('[data-panel="windows"]').innerHTML = await windowsPanel(p, state);
      host.querySelector('[data-panel="log"]').innerHTML = await logPanel(p, state);
      scopedShowTab(host, state.tab);
    }

    ui.bind(host, "click", "[data-tab]", (t) => {
      const ctn = t.parentElement && t.parentElement.parentElement;
      if (!ctn) return;
      scopedShowTab(ctn, t.getAttribute("data-tab"));
      state.tab = t.getAttribute("data-tab");
    });
    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      const toast = (ctx && ctx.toast) || ERP.toast;
      if (act === "sch-toggle-window") {
        const w = (state.config && asArr(asObj(state.config.sections).maintenanceWindows).find((x) => String(x.id) === String(arg)));
        const r = await M.setEnabled("maintenanceWindows", arg, !(w && w.enabled !== false));
        if (r.error) { toast("Update failed: " + r.error, "error"); return; }
        toast("Maintenance window updated"); return paint();
      }
      if (act === "sch-release") {
        const r = await SCH.releaseDeferred(state.pid, state.at);
        if (r.error) { toast("Release failed: " + r.error, "error"); return; }
        toast("Released " + r.released + " device(s) — " + r.jobs + " job(s) re-queued"); return paint();
      }
      if (act === "sch-release-all") {
        const r = await SCH.releaseDeferred(state.pid, state.at);
        if (r.error) { toast("Release failed: " + r.error, "error"); return; }
        toast("Released " + r.released + " device(s)"); return paint();
      }
      if (act === "sch-clear-log") {
        const ok = await ui.confirm({ title: "Clear suppression log", message: "Remove every recorded suppression for this client? The deferral queue is separate.", okLabel: "Clear", danger: true });
        if (!ok) return;
        await SCH.clearSuppressions(state.pid);
        toast("Suppression log cleared"); return paint();
      }
      if (act === "sch-admin") { ERP.navigate("admin"); if (M.showTab) M.showTab(arg); return; }
    });
    host.addEventListener("change", (e) => { if (e.target && e.target.name === "pid") { state.pid = e.target.value; SCH.currentProviderId = state.pid; paint(); } });
    if (opts.onChange) opts.onChange(state);

    await paint();
    return state;
  }

  SCH.renderInto = async function (host, opts) {
    if (!host) return null;
    const wrap = document.createElement("div");
    wrap.className = "rmm-schedules";
    host.innerHTML = "";
    host.appendChild(wrap);
    return mount(wrap, { toast: (typeof opts === "object" && opts.toast) || ERP.toast }, opts || {});
  };

  SCH.render = async function (ctx) {
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (ctx.empty) ctx.empty(); return; }
    const state = {
      pid: (SCH.currentProviderId && providers.some((p) => p.id === SCH.currentProviderId)) ? SCH.currentProviderId : providers[0].id,
      tab: ["schedules", "hours", "windows", "log"].indexOf(el.__tab) !== -1 ? el.__tab : "schedules",
    };
    const root = document.createElement("div");
    root.className = "rmm-schedules";
    el.innerHTML = "";
    el.appendChild(root);
    const head = ERP.ui.pageHead("Schedules & maintenance windows",
      "Per-client schedules and business-hours calendars, maintenance/blackout windows that suppress alerts and defer non-essential jobs, and the audit log of exactly what was suppressed or held.",
      ERP.ui.btn("Manage in Admin", { small: true, act: "sch-admin", arg: "schedules" }));
    await mount(root, ctx, { providers, providerId: state.pid, tab: state.tab, headHtml: head });
    return state;
  };
})();
